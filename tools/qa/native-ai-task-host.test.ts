import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { CampaignSession, initializeCampaignSession, type CampaignSessionOptions, type CampaignSessionInput } from "../../src/engine/campaign-session";
import { authenticateNativeAiTaskConfiguration, configureTransportHostNativeAiTasks, receiveTransportHostAiPolicy,
  initializeTransportHostNativeAiTasks, allocateTransportProductionExit, reserveTransportProductionExit,
  consumeTransportFifo, createTransportHostAdapter, updateTransportHostUnit,
  stepTransportHost, advanceTransportHost, transportHostState, type NativeAiTaskConfiguration } from "../../src/engine/transport-host";
import type { CampaignWorld } from "../../src/engine/campaign-world";
import type { PlannedMissionCommand } from "../../src/engine/mission-controller";
import { decodeLegacyAiTaskStack, type LegacyAiRegisteredWorld, type LegacyAiGroundWrite } from "../../src/engine/legacy-ai-task";
import type { TriggerResult } from "../../src/engine/trigger-runtime";
import { parseScenario } from "../extractors/data/scenario";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { parseMapBundle } from "../extractors/maps/map";

interface Evidence {
  slot: number; unitType: number; counter: number; order: number; before: number[]; received: number[]; stream: string;
  world: LegacyAiRegisteredWorld; fin: LegacyAiRegisteredWorld["fin"];
  nearbyEnemy: unknown; runtimeIntercepts: unknown[];
  binarySha256: string; sourceInitialization: { freshGame: boolean; scn: string; pth: string };
  stopReceipt: null | { visit: number; stream: string; before: number[]; after: number[] };
  visits: { raw: number[]; stack: { task: number }[]; rngCursor: number; task6Budget: number; groundWrites: LegacyAiGroundWrite[];
    before: { rngCursor: number; task6Budget: number } }[];
}
const trace = process.env.DC_NATIVE_ACTOR_MOVEMENT_TRACE;
const corpus: Evidence[] = (trace ? readFileSync(trace, "utf8") : execFileSync("python3", [
  new URL("nativeactor-task-native.py", import.meta.url).pathname, "--movement-suite",
], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...process.env,
  PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918", PYTHONDONTWRITEBYTECODE: "1" } }))
  .trim().split("\n").map(line => JSON.parse(line));

function unwrap<Value>(result: TriggerResult<Value>): Value {
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}

function packetFor(stream: string): Uint8Array {
  const payload = Buffer.from(stream, "hex"), packet = Buffer.alloc(payload.length + 2);
  packet.writeUInt16LE(packet.length, 0);
  packet.set(payload, 2);
  return packet;
}

function optionsFor(current: Evidence): CampaignSessionOptions {
  const read = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url));
  const mission = (extension: string) => read(`SCENARIO/HUMAN/HUMAN02.${extension}`);
  const source = parseScenario(mission("SCN").toString());
  const map = parseMapBundle(mission("MAP"), mission("MTG"), mission("PTH"));
  const raw = Buffer.from(current.before);
  return { sessionId: `native-task-${current.unitType}`, source: { ...source,
    placementRows: [...source.placementRows, [raw.readUInt16LE(0) >>> 8, raw.readUInt16LE(4) >>> 8, current.unitType, raw[7], -1, 0]] },
  units: parseUnitStats(read("GAMESTAT/GAMESTAT.TXT").toString()), weapons: parseWeaponStats(read("GAMESTAT/WEAPSTAT.TXT").toString()),
  triggers: [], messages: [], map: { width: map.width, height: map.height }, pathGrid: map.pathGrid, tags: map.tagGrid,
  commanders: [{ team: 0, unitType: 69, sprite: "TRSC" }], directionBits: [], fixedStepMilliseconds: 16,
  orientationSteps: 1, resourceScales: "configured-startup" };
}

function sourceValue(configuration: NativeAiTaskConfiguration): string {
  return JSON.stringify({ profiles: configuration.profiles,
    bindings: configuration.bindings.map(({ slot, profile, raw }) => ({ slot, profile, raw })),
    counter: configuration.counter, rngCursor: configuration.rngCursor, task6Budget: configuration.task6Budget },
  (_key, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
}

async function configurationFor(current: Evidence, world: CampaignWorld) {
  const actor = transportHostState(world).slots[current.slot]!;
  assert.equal(actor.unitType, current.unitType);
  const configuration: NativeAiTaskConfiguration = { scope: "source-separated-bounded", sourceId: "",
    profiles: [{ ...current.world, fin: current.fin }], bindings: [{ slot: actor.slot, generation: actor.generation, key: actor.key,
      profile: 0, raw: current.before, expectedRaw: Array.from(world.entityBytes!.slice(actor.slot * 220, (actor.slot + 1) * 220)) }],
    counter: current.counter, rngCursor: current.visits[0].before.rngCursor, task6Budget: current.visits[0].before.task6Budget };
  return authenticateNativeAiTaskConfiguration({ ...configuration,
    sourceId: `nativeactor-v1:${createHash("sha256").update(sourceValue(configuration)).digest("hex")}` });
}

async function fixture(current: Evidence) {
  const options = optionsFor(current), initial = unwrap(initializeCampaignSession(options));
  const authenticated = await configurationFor(current, initial.world);
  return { options: { ...options, nativeAiTasks: authenticated }, configuration: authenticated, initial };
}

function inputFor(session: CampaignSession, current: Evidence, index: number): CampaignSessionInput {
  const actor = transportHostState(session.snapshot.world).slots[current.slot]!;
  const stream = index === 0 ? current.stream : current.stopReceipt?.visit === index ? current.stopReceipt.stream : null;
  return { clockMilliseconds: (session.snapshot.cycleCounter + 1) * 16,
    nativeAiFrame: { counter: current.counter, task6Budget: current.visits[index]?.before.task6Budget ?? 0 },
    ...(stream ? { nativeAiReceipt: { id: `native:${index}`, packets: [Array.from(packetFor(stream))],
      expected: [{ slot: actor.slot, generation: actor.generation, key: actor.key, raw: actor.nativeAiTask!.raw }] } } : {}) };
}

for (const [index, current] of corpus.entries()) {
  if (current.nearbyEnemy) continue;
  test(`native host ${index}: type ${current.unitType}, order ${current.order}, stop ${current.stopReceipt?.visit ?? "none"}`, async () => {
    assert.deepEqual(current.runtimeIntercepts, []);
    assert.equal(current.binarySha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
    assert.equal(current.sourceInitialization.freshGame, true);
    assert.equal(current.sourceInitialization.scn, "0x41b920");
    assert.equal(current.sourceInitialization.pth, "0x442b7c");
    if ([8, 73].includes(current.unitType)) {
      const remapped = optionsFor(current);
      const options = { ...remapped, source: { ...remapped.source, placementRows: remapped.source.placementRows.slice(0, -1) } };
      const initial = unwrap(initializeCampaignSession(options));
      let world = unwrap(allocateTransportProductionExit(initial.world, { key: JSON.stringify([options.sessionId, 1, 0, "native"]),
        team: 1, queue: 0, ticket: "native", unitType: current.unitType, tile: { x: 67, y: 48 } }));
      const configuration = await configurationFor(current, world);
      world = unwrap(initializeTransportHostNativeAiTasks(world, configuration));
      assert.equal(initializeCampaignSession({ ...remapped, nativeAiTasks: configuration }).ok, false,
        "SCN race-remapped actor must not be rewritten to the direct constructor type");
      world = receiveTransportHostAiPolicy(world, world.entityBytes!, [packetFor(current.stream)], "initial", "deferred");
      let ground = [...current.world.ground];
      for (const [visitIndex, visit] of current.visits.entries()) {
        if (current.stopReceipt?.visit === visitIndex) world = receiveTransportHostAiPolicy(world, world.entityBytes!,
          [packetFor(current.stopReceipt.stream)], "stop", "deferred");
        const saved = structuredClone(world);
        const result = stepTransportHost(world, undefined, { counter: current.counter, task6Budget: visit.before.task6Budget });
        if (visit.stack[0].task === 13) {
          assert.equal(result.ok, false);
          assert.match(JSON.stringify(result), /native-special-stop-owner-required/);
          assert.deepEqual(world, saved);
          return;
        }
        world = unwrap(result);
        const host = transportHostState(world);
        assert.deepEqual(host.slots[current.slot]!.nativeAiTask!.raw, visit.raw);
        assert.equal(host.nativeAiTasks!.rngCursor, visit.rngCursor);
        assert.equal(host.nativeAiTasks!.task6Budget, visit.task6Budget);
        for (const write of visit.groundWrites) ground[write.cell] = write.size === 4 ? write.after : ((ground[write.cell] & 0xffff0000) | write.after) >>> 0;
        assert.deepEqual(host.nativeAiTasks!.ground, ground);
      }
      return;
    }
    const { options, initial } = await fixture(current);
    const session = new CampaignSession(options);
    let ground = [...current.world.ground];
    const lowSlots = session.snapshot.world.entityBytes!.slice(0, 152 * 220);
    assert.equal(configureTransportHostNativeAiTasks(initial.world, options.nativeAiTasks!).ok, false, "generic task/FIN raw rejects");
    const receiptWorld = receiveTransportHostAiPolicy(session.snapshot.world, session.snapshot.world.entityBytes!,
      [packetFor(current.stream)], "native-receipt", "deferred");
    assert.deepEqual(Array.from(receiptWorld.entityBytes!.slice(current.slot * 220, (current.slot + 1) * 220)), current.received);
    for (const [visitIndex, visit] of current.visits.entries()) {
      const before = session.checkpoint();
      const result = session.step(inputFor(session, current, visitIndex));
      if (visit.stack[0].task === 13) {
        assert.equal(result.ok, false);
        assert.match(JSON.stringify(result), /native-special-stop-owner-required/);
        assert.deepEqual(session.checkpoint(), before);
        return;
      }
      const frame = unwrap(result), host = transportHostState(frame.world), owner = host.nativeAiTasks!;
      const actor = host.slots[current.slot]!;
      assert.deepEqual(actor.nativeAiTask!.raw, visit.raw, `visit ${visitIndex} raw220`);
      assert.deepEqual(Array.from(frame.world.entityBytes!.slice(current.slot * 220, (current.slot + 1) * 220)), visit.raw);
      assert.equal(owner.rngCursor, visit.rngCursor);
      assert.equal(owner.task6Budget, visit.task6Budget);
      assert.equal(!!actor.pendingNativeAi, visit.raw[0x36] === 1);
      for (const write of visit.groundWrites) ground[write.cell] = write.size === 4 ? write.after : ((ground[write.cell] & 0xffff0000) | write.after) >>> 0;
      assert.deepEqual(owner.ground, ground);
      assert.deepEqual(frame.world.entityBytes!.slice(0, 152 * 220), lowSlots);
      assert.deepEqual(host.productionExits, before.state.world.transportState.productionExits);
      assert.deepEqual(host.resourceTileFlags, before.state.world.transportState.resourceTileFlags);
    }
    assert.equal(decodeLegacyAiTaskStack(transportHostState(session.snapshot.world).slots[current.slot]!.nativeAiTask!.raw)[0].task, 1);
  });
}

test("source authentication, late failure, unsupported handoff and elapsed time are fail closed", async () => {
  const current = corpus[0], { options, configuration, initial } = await fixture(current);
  const forged = structuredClone(configuration);
  (forged.profiles[0].typeBytes as number[])[12] ^= 1;
  await assert.rejects(authenticateNativeAiTaskConfiguration(forged), /verified constructor/);
  assert.equal(initializeCampaignSession({ ...options, nativeAiTasks: forged }).ok, false);
  const session = new CampaignSession(options), before = session.checkpoint();
  assert.equal(session.step({ ...inputFor(session, current, 0), reservations: [{ slot: 799, generation: 0, tileX: 1, tileY: 1 }] }).ok, false);
  assert.deepEqual(session.checkpoint(), before);
  const pending = receiveTransportHostAiPolicy(initial.world, initial.world.entityBytes!, [packetFor(current.stream)], "unowned", "deferred");
  const saved = structuredClone(pending);
  assert.equal(stepTransportHost(pending).ok, false);
  assert.equal(advanceTransportHost(pending, 1000).ok, false);
  assert.deepEqual(pending, saved);
  const owned = session.snapshot.world;
  assert.equal(advanceTransportHost(owned, 16).ok, false);
  assert.deepEqual(session.checkpoint(), before);
  const poisoned = structuredClone(configuration);
  (poisoned.bindings[0].expectedRaw as number[])[0x19] = 7;
  const poisonedWorld = structuredClone(initial.world);
  poisonedWorld.entityBytes![current.slot * 220 + 0x19] = 7;
  assert.equal(initializeTransportHostNativeAiTasks(poisonedWorld, poisoned).ok, false);
});

test("direct native host calls authenticate cloned content and reject profile index changes atomically", async () => {
  const current = corpus[0], { options } = await fixture(current);
  const world = new CampaignSession(options).snapshot.world;
  const frame = { counter: current.counter, task6Budget: current.visits[0].before.task6Budget };
  assert.equal(stepTransportHost(structuredClone(world), undefined, frame).ok, true);
  for (const poison of [
    (state: ReturnType<typeof transportHostState>) => (state.nativeAiTasks!.configuration.profiles[0].randomTable as number[]).fill(0),
    (state: ReturnType<typeof transportHostState>) => { state.slots[current.slot]!.nativeAiTask!.profile = 999; },
    (state: ReturnType<typeof transportHostState>) => { state.nativeAiTasks!.rngCursor = 256; },
  ]) {
    const state = transportHostState(world);
    poison(state);
    const poisoned = { ...structuredClone(world), transportState: state };
    const before = structuredClone(poisoned);
    for (const invoke of [
      () => stepTransportHost(poisoned, undefined, frame),
      () => advanceTransportHost(poisoned, 0, undefined, []),
      () => advanceTransportHost(poisoned, 1, undefined, []),
      () => advanceTransportHost(poisoned, 16, undefined, [frame]),
    ]) {
      const result = invoke();
      assert.equal(result.ok, false);
      assert.match(JSON.stringify(result), /Native AI source authentication required|Native AI raw\/identity owner conflict|Invalid native AI owner cursor\/visits/);
      assert.deepEqual(poisoned, before);
    }
    assert.deepEqual(unwrap(stepTransportHost(world, undefined, frame)),
      unwrap(stepTransportHost(structuredClone(world), undefined, frame)));
  }
});

test("direct AI receipts authenticate legacy source content before accepting an empty receipt", async () => {
  const { options } = await fixture(corpus[0]);
  const world = new CampaignSession(options).snapshot.world;
  const state = transportHostState(world);
  (state.nativeAiTasks!.configuration.profiles[0].typeBytes as number[])[8] ^= 1;
  const changed = { ...structuredClone(world), transportState: state }, before = structuredClone(changed);
  for (const timing of ["deferred", "synchronous"] as const) {
    assert.throws(() => receiveTransportHostAiPolicy(changed, changed.entityBytes!, [], "empty", timing),
      /Native AI source authentication required/);
    assert.deepEqual(changed, before);
  }
});

test("native owner rejects production allocation and unknown occupancy changes without consuming reservations or FIFO", async () => {
  const current = corpus[0], { options, initial } = await fixture(current);
  const world = new CampaignSession(options).snapshot.world;
  const state = transportHostState(world), cell = 31;
  assert.equal(state.ground[cell], -1);
  assert.equal(state.nativeAiTasks!.ground[cell] & 1023, 1023);
  assert.ok(state.groundEligible[cell]);
  const request = { key: JSON.stringify([world.sessionId, 1, 0, "blocked-native-production"]), team: 1, queue: 0 as const,
    ticket: "blocked-native-production", unitType: 0, tile: { x: cell % state.width, y: Math.floor(cell / state.width) } };
  for (const candidate of [world, unwrap(reserveTransportProductionExit(world, request))]) {
    const before = structuredClone(candidate);
    const result = allocateTransportProductionExit(candidate, request);
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result), /native-ai-occupancy-owner-required/);
    assert.deepEqual(candidate, before);
    assert.equal(stepTransportHost(candidate, undefined, { counter: current.counter, task6Budget: 0 }).ok, true);
  }
  for (const kind of ["reinforce", "reinforce2"] as const) {
    const planned: PlannedMissionCommand = { id: `native-occupancy-${kind}`, triggerId: 1, actionIndex: 0,
      action: { name: kind, arguments: [] }, command: { kind, team: 1, tileX: request.tile.x, tileY: request.tile.y,
        groups: [{ unitType: 0, count: 1 }] } };
    const before = structuredClone(world);
    const result = createTransportHostAdapter().prepare(world, planned);
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result), /native-ai-occupancy-owner-required/);
    assert.deepEqual(world, before);
    if (kind === "reinforce2") assert.equal(createTransportHostAdapter().prepare(initial.world, planned).ok, true);
  }
  const queuedState = transportHostState(world);
  queuedState.fifos.push({ tile: request.tile, types: [0, 0] });
  const queued = { ...structuredClone(world), transportState: queuedState }, queuedBefore = structuredClone(queued);
  const consumed = consumeTransportFifo(queued, queuedState.fifos.length - 1, 1);
  assert.equal(consumed.ok, false);
  assert.match(JSON.stringify(consumed), /native-ai-occupancy-owner-required/);
  assert.deepEqual(queued, queuedBefore);
  const unowned = state.slots.find(actor => actor && actor.slot >= 152 && actor.team !== 8 && !actor.nativeAiTask)!;
  assert.ok(unowned);
  for (const type of ["position", "combat-death", "complete-removal"] as const) {
    const before = structuredClone(world);
    const result = updateTransportHostUnit(world, { type, slot: unowned.slot, generation: unowned.generation,
      position: { x: request.tile.x * 256 + 128, y: request.tile.y * 256 + 128 } });
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result), /native-ai-occupancy-owner-required/);
    assert.deepEqual(world, before);
  }
  const flying = state.definitions.find(entry => entry.plane === "flying")!;
  assert.ok(flying);
  const before = structuredClone(world);
  const airReservation = reserveTransportProductionExit(world, { ...request, unitType: flying.unitType });
  assert.equal(airReservation.ok, false);
  assert.match(JSON.stringify(airReservation), /native-ai-occupancy-owner-required/);
  assert.deepEqual(world, before);
});

test("native elapsed frames are absent without an owner and exactly match zero, one and multiple updates", async () => {
  const current = corpus[0], { options, initial } = await fixture(current);
  const world = new CampaignSession(options).snapshot.world;
  const frame = { counter: current.counter, task6Budget: 0 };
  for (const milliseconds of [0, 1, 16, 32]) {
    const before = structuredClone(initial.world);
    for (const frames of [[], [frame]]) {
      const result = advanceTransportHost(initial.world, milliseconds, undefined, frames);
      assert.equal(result.ok, false);
      assert.match(JSON.stringify(result), /Native AI frames require explicit source owner/);
      assert.deepEqual(initial.world, before);
    }
    assert.equal(advanceTransportHost(initial.world, milliseconds).ok, true);
  }
  for (const milliseconds of [0, 1, 15, 16, 17, 32]) {
    const steps = Math.floor(milliseconds / 16), before = structuredClone(world);
    for (const frames of [undefined, [], [frame], [frame, frame], [frame, frame, frame]]) {
      const result = advanceTransportHost(world, milliseconds, undefined, frames);
      assert.equal(result.ok, frames?.length === steps, `${milliseconds}ms, ${frames?.length} frames`);
      if (!result.ok) assert.match(JSON.stringify(result), /one actual frame per fixed update/);
      else {
        assert.equal(transportHostState(result.value).tick, steps);
        assert.equal(transportHostState(result.value).remainderMilliseconds, milliseconds % 16);
      }
      assert.deepEqual(world, before);
    }
  }
  const partial = unwrap(advanceTransportHost(world, 15, undefined, [])), before = structuredClone(partial);
  assert.equal(advanceTransportHost(partial, 1, undefined, []).ok, false);
  assert.deepEqual(partial, before);
  assert.deepEqual(unwrap(advanceTransportHost(partial, 1, undefined, [frame])),
    unwrap(advanceTransportHost(world, 16, undefined, [frame])));
  const next = unwrap(advanceTransportHost(partial, 17, undefined, [frame, frame]));
  assert.equal(transportHostState(next).tick, 2);
  assert.equal(transportHostState(next).remainderMilliseconds, 0);
});

test("native visits preserve actual production reservation and resource planes", async () => {
  const current = corpus[0], { options } = await fixture(current);
  const session = new CampaignSession(options);
  let world = session.snapshot.world;
  const host = transportHostState(world);
  const cell = host.ground.findIndex((slot, index) => slot === -1 && host.groundEligible[index]
    && (current.world.ground[index] & 1023) === 1023 && Math.abs(index % host.width - 67) > 8);
  assert.ok(cell >= 0);
  const reservation = { key: JSON.stringify([world.sessionId, 1, 0, "preserved"]), team: 1, queue: 0 as const,
    ticket: "preserved", unitType: 0, tile: { x: cell % host.width, y: Math.floor(cell / host.width) } };
  world = unwrap(reserveTransportProductionExit(world, reservation));
  world = receiveTransportHostAiPolicy(world, world.entityBytes!, [packetFor(current.stream)], "move", "deferred");
  const resources = transportHostState(world).resourceTileFlags;
  world = unwrap(stepTransportHost(world, undefined, { counter: current.counter, task6Budget: 0 }));
  const after = transportHostState(world);
  assert.equal(after.ground[cell], 1022);
  assert.equal(after.nativeAiTasks!.ground[cell] & 1023, 1022);
  assert.deepEqual(after.productionExits, [reservation]);
  assert.deepEqual(after.resourceTileFlags, resources);
  assert.deepEqual(after.slots[current.slot]!.nativeAiTask!.raw, current.visits[0].raw);
});

test("midturn and midstep strict JSON restore replays and continues 100 updates", async () => {
  const current = corpus[2], { options, configuration } = await fixture(current);
  const session = new CampaignSession(options);
  let checkedTurn = false, checkedStep = false;
  for (let index = 0; index < current.visits.length; index++) {
    unwrap(session.step(inputFor(session, current, index)));
    const stack = decodeLegacyAiTaskStack(transportHostState(session.snapshot.world).slots[current.slot]!.nativeAiTask!.raw);
    const top = stack.at(-1)!.task;
    if ((top === 4 && !checkedTurn) || (top === 5 && !checkedStep)) {
      checkedTurn ||= top === 4; checkedStep ||= top === 5;
      const checkpoint = JSON.parse(JSON.stringify(session.checkpoint()));
      assert.throws(() => CampaignSession.restore(checkpoint), /expected source configuration/);
      const restored = CampaignSession.restore(checkpoint, undefined, configuration);
      const fork = session.fork();
      for (let tick = 0; tick < 100; tick++) {
        const input = inputFor(fork, current, index + tick + 1);
        assert.deepEqual(unwrap(restored.step(input)), unwrap(fork.step(input)));
      }
      const forged = structuredClone(checkpoint);
      forged.state.world.transportState.slots[current.slot].nativeAiTask.raw[0x19] ^= 1;
      forged.state.world.entityBytes[current.slot * 220 + 0x19] ^= 1;
      assert.throws(() => CampaignSession.restore(forged, undefined, configuration), /complete caller replay/);
    }
  }
  assert.ok(checkedTurn && checkedStep);
});

test("actual elapsed visits and unsupported routes preserve transaction boundaries", async () => {
  const current = corpus[0], { options } = await fixture(current);
  const session = new CampaignSession(options), before = session.checkpoint();
  const input = inputFor(session, current, 0);
  const packet = Uint8Array.from(input.nativeAiReceipt!.packets[0]), words = new DataView(packet.buffer);
  words.setUint16(10, 72 * 256 + 128, true);
  assert.equal(session.step({ ...input, nativeAiReceipt: { ...input.nativeAiReceipt!, packets: [Array.from(packet)] } }).ok, false);
  assert.deepEqual(session.checkpoint(), before);
  assert.equal(session.step({ ...input, updates: [{ type: "position", slot: current.slot, generation: 0,
    position: { x: 68 * 256 + 128, y: 48 * 256 + 128 } }] }).ok, false);
  assert.deepEqual(session.checkpoint(), before);
  const world = receiveTransportHostAiPolicy(session.snapshot.world, session.snapshot.world.entityBytes!, [packetFor(current.stream)], "elapsed", "deferred");
  const frames = current.visits.slice(0, 3).map(visit => ({ counter: current.counter, task6Budget: visit.before.task6Budget }));
  const advanced = unwrap(advanceTransportHost(world, 48, undefined, frames));
  assert.deepEqual(transportHostState(advanced).slots[current.slot]!.nativeAiTask!.raw, current.visits[2].raw);
  assert.equal(transportHostState(advanced).tick, 3);
  assert.equal(transportHostState(advanced).remainderMilliseconds, 0);
  const saved = structuredClone(world);
  assert.equal(advanceTransportHost(world, 48, undefined, [frames[0], frames[1], { counter: current.counter, task6Budget: 10 }]).ok, false);
  assert.deepEqual(world, saved);
});

test("mode7 alone stores waypoints without authorizing an owned initializer", async () => {
  const current = corpus[0], { options, initial } = await fixture(current);
  const session = new CampaignSession(options);
  const payload = Buffer.from(current.stream, "hex").subarray(4).toString("hex");
  const world = receiveTransportHostAiPolicy(session.snapshot.world, session.snapshot.world.entityBytes!, [packetFor(payload)], "route-only", "deferred");
  const actor = transportHostState(world).slots[current.slot]!;
  assert.equal(actor.nativeAiTask!.raw[0x36], 0);
  assert.equal(actor.pendingNativeAi, undefined);
  assert.equal(decodeLegacyAiTaskStack(actor.nativeAiTask!.raw)[0].task, 1);
  assert.equal(actor.nativeAiTask!.raw[0xc6], 1);
  const unknown = receiveTransportHostAiPolicy(initial.world, initial.world.entityBytes!, [packetFor(payload)], "unowned-route", "deferred");
  assert.equal(stepTransportHost(unknown).ok, false, "unconfigured actor keeps conservative handoff barrier");
});
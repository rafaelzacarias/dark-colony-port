import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { constructSourceNativeTaskActor, createSourceNativeTaskOptions, isAuthenticatedSourceNativeTaskConfiguration,
  isImmutableSourceNativeTaskConfiguration, retainSourceNativeTaskConfiguration,
  validateSourceNativeWorld, type SourceNativeTaskAssets } from "../../src/engine/source-native-task-options";
import type { LegacyAiRegisteredWorld } from "../../src/engine/legacy-ai-task";
import { initializeCampaignSession } from "../../src/engine/campaign-session";
import { parseScenario } from "../extractors/data/scenario";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { parseMapBundle } from "../extractors/maps/map";
import { authenticateNativeAiTaskConfiguration, initializeTransportHostNativeAiTasks, transportHostState,
  stepTransportHost, advanceTransportHost, allocateTransportProductionExit, receiveTransportHostAiPolicy,
  reserveTransportProductionExit, createTransportHostAdapter } from "../../src/engine/transport-host";

interface NativeEvidence {
  mission: string;
  binarySha256: string;
  sourceProof: { entry: string; scenarioSha256: string; linesRead: number };
  runtimeIntercepts: unknown[];
  world: { ground: number[]; air: number[]; extra: number[]; families: number[];
    teams: { teamControl: number; enemyMask: number }[] };
  actors: { slot: number; raw: number[] }[];
  created: { slot: number; raw: number[] }[];
  types: { typeId: number; typeBytes: number[]; fin: LegacyAiRegisteredWorld["fin"] }[];
}

function fixture(mission: string) {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
  const scenario = (extension: string) => read(`raw_cd/DC/SCENARIO/${mission.slice(0, -2)}/${mission}.${extension}`);
  const assets: SourceNativeTaskAssets = { executable: read("raw_cd/DC/DC.EXE"),
    gameStat: read("raw_cd/DC/GAMESTAT/GAMESTAT.TXT"), weaponStat: read("raw_cd/DC/GAMESTAT/WEAPSTAT.TXT"),
    scenario: scenario("SCN"), map: scenario("MAP"), mtg: scenario("MTG"), pth: scenario("PTH"),
    animations: Object.fromEntries(["TRSC", "GRAY", "REAP", "BARR"].map(stem =>
      [stem, read(`public/assets/generated/animations/${stem}.json`)])) };
  const text = new TextDecoder(), source = parseScenario(text.decode(assets.scenario));
  const map = parseMapBundle(assets.map, assets.mtg, assets.pth);
  const result = initializeCampaignSession({ sessionId: `source-task-${mission}`, source,
    units: parseUnitStats(text.decode(assets.gameStat)), weapons: parseWeaponStats(text.decode(assets.weaponStat)),
    triggers: [], messages: [], map, pathGrid: map.pathGrid, tags: map.tagGrid,
    commanders: [{ team: 0, unitType: mission.startsWith("HUMAN") ? 69 : 73,
      sprite: mission.startsWith("HUMAN") ? "TRSC" : "GRAY" }],
    directionBits: [], fixedStepMilliseconds: 16, orientationSteps: 1, resourceScales: "configured-startup" });
  assert.ok(result.ok, JSON.stringify(result));
  return { assets, world: result.value.world };
}

const nativeTrace = process.env.DC_SOURCE_NATIVE_OPTIONS_TRACE;
const nativeEvidence: NativeEvidence[] = (nativeTrace ? readFileSync(nativeTrace, "utf8") : execFileSync("python3", [
  new URL("source-native-task-options-native.py", import.meta.url).pathname,
], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, env: { ...process.env,
  PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918", PYTHONDONTWRITEBYTECODE: "1" } }))
  .trim().split("\n").map(line => JSON.parse(line));

for (const evidence of nativeEvidence) {
  test(`full original x86 ${evidence.mission}: source actors and dynamic constructors`, async () => {
    assert.equal(evidence.binarySha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
    assert.equal(evidence.sourceProof.entry, "0x41b920");
    assert.ok(evidence.sourceProof.linesRead > 150);
    assert.deepEqual(evidence.runtimeIntercepts, []);
    const input = fixture(evidence.mission), configuration = await createSourceNativeTaskOptions(input);
    assert.deepEqual(configuration.profiles[0].ground, evidence.world.ground, "original complete ground plane");
    assert.deepEqual(configuration.profiles[0].air, evidence.world.air, "original complete air/MTG plane");
    assert.deepEqual(configuration.profiles[0].extra, evidence.world.extra, "original complete extra plane");
    assert.deepEqual(configuration.profiles[0].families, evidence.world.families, "original complete PTH families");
    for (const [team, original] of evidence.world.teams.entries()) {
      assert.equal(configuration.profiles[team].teamControl, original.teamControl, `native team ${team} control`);
      assert.equal(configuration.profiles[team].enemyMask, original.enemyMask, `native team ${team} mask`);
    }
    for (const original of evidence.types) {
      const profile = configuration.profiles.find(profile => profile.typeId === original.typeId)!;
      const nativeView = new DataView(Uint8Array.from(original.typeBytes).buffer);
      const profileView = new DataView(Uint8Array.from(profile.typeBytes).buffer);
      for (const offset of [4, 8, 12, 16, 20, 24, 28, 32, 0x40, 0x44, 0x60, 0x64, 0xdc, 0xe0, 0xf8]) {
        assert.equal(profileView.getInt32(offset, true), nativeView.getInt32(offset, true), `type ${original.typeId} column ${offset}`);
      }
      for (const offset of [0x7c, 0x80]) assert.deepEqual(profile.fin[profileView.getUint32(offset, true)],
        original.fin[nativeView.getUint32(offset, true)], `type ${original.typeId} all32 FIN bank ${offset}`);
    }
    for (const binding of configuration.bindings) {
      const actual = evidence.actors.find(actor => actor.slot === binding.slot)!;
      assert.ok(actual, `original registered slot ${binding.slot}`);
      const profile = configuration.profiles[binding.profile], original = evidence.types.find(type => type.typeId === actual.raw[6])!;
      const nativeView = new DataView(Uint8Array.from(original.typeBytes).buffer);
      const profileView = new DataView(Uint8Array.from(profile.typeBytes).buffer);
      const raw = Buffer.from(actual.raw);
      for (const offset of [0x14, 0x1c, 0x24]) {
        assert.equal(raw.readUInt32LE(offset), nativeView.getUint32(0x80, true));
        raw.writeUInt32LE(profileView.getUint32(0x80, true), offset);
      }
      assert.deepEqual(binding.raw, [...raw], `source raw220 slot ${binding.slot}`);
      for (const offset of [4, 8, 12, 16, 20, 24, 28, 32, 0x40, 0x44, 0x60, 0x64, 0xdc, 0xe0, 0xf8]) {
        assert.equal(profileView.getInt32(offset, true), nativeView.getInt32(offset, true), `source column ${offset}`);
      }
      assert.deepEqual(profile.typeBytes.slice(0x30, 0x40), original.typeBytes.slice(0x30, 0x40));
      for (const offset of [0x7c, 0x80]) assert.deepEqual(profile.fin[profileView.getUint32(offset, true)],
        original.fin[nativeView.getUint32(offset, true)], `all32 FIN directions type ${actual.raw[6]} field ${offset}`);
    }
    assert.ok(evidence.created.length >= 12);
    assert.ok(evidence.created.some(actor => Buffer.from(actor.raw).readInt32LE(12) === 197));
    for (const actor of evidence.created) {
      const profile = configuration.profiles.find(profile => profile.typeId === actor.raw[6])!;
      const expected = Buffer.from(actor.raw), bank = new DataView(Uint8Array.from(profile.typeBytes).buffer).getUint32(0x80, true);
      for (const offset of [0x14, 0x1c, 0x24]) expected.writeUInt32LE(bank, offset);
      assert.deepEqual(constructSourceNativeTaskActor(actor.raw, profile), [...expected], `dynamic raw220 slot ${actor.slot}`);
    }
  });
}

test("source-owned dynamic production and reinforcement preserve bounds and roll back blocked legs", async () => {
  const input = fixture("ALIEN01"), configuration = await createSourceNativeTaskOptions(input);
  const installed = initializeTransportHostNativeAiTasks(input.world, configuration);
  assert.ok(installed.ok, JSON.stringify(installed));
  const state = transportHostState(installed.value), profile = configuration.profiles[0];
  const cell = state.ground.findIndex((slot, index) => slot === -1 && state.groundEligible[index]
    && index % state.width > 1 && index % state.width < state.width - 3
    && Math.floor(index / state.width) < state.height - 2 && profile.families[index] !== 0
    && [0, 1, 2, state.width + 1].every(offset => state.ground[index + offset] === -1
      && state.groundEligible[index + offset] && (profile.air[index + offset] >>> 10) === 0
      && profile.families[index + offset] === profile.families[index]));
  assert.ok(cell >= 0);
  const tile = { x: cell % state.width, y: Math.floor(cell / state.width) };
  const request = { key: JSON.stringify([input.world.sessionId, 0, 0, "move"]), team: 0, queue: 0 as const,
    ticket: "move", unitType: 3, tile };
  const reservation = reserveTransportProductionExit(installed.value, request);
  assert.ok(reservation.ok, JSON.stringify(reservation));
  const allocated = allocateTransportProductionExit(reservation.value, request);
  assert.ok(allocated.ok, JSON.stringify(allocated));
  const actor = transportHostState(allocated.value).slots.find(actor => actor?.key.startsWith("transport:"))!;
  assert.equal(actor.health, 400);
  const packet = (targetX: number, targetY: number) => {
    const payload = Buffer.alloc(15);
    payload[0] = 5; payload.writeInt16LE(actor.slot, 1); payload[3] = 2;
    payload[4] = 7; payload[5] = 1; payload.writeInt16LE(1, 6);
    payload.writeUInt16LE(targetX * 256 + 128, 8); payload.writeUInt16LE(targetY * 256 + 128, 10);
    payload.writeInt16LE(actor.slot, 12);
    const result = Buffer.alloc(17); result.writeUInt16LE(17); result.set(payload, 2);
    return result;
  };
  const diagonal = receiveTransportHostAiPolicy(allocated.value, allocated.value.entityBytes!,
    [packet(tile.x + 1, tile.y + 1)], "diagonal", "deferred");
  const diagonalBefore = structuredClone(diagonal);
  const denied = stepTransportHost(diagonal, undefined, { counter: 1, task6Budget: 0 });
  assert.equal(denied.ok, false);
  assert.match(JSON.stringify(denied), /native-general-path-owner-required/);
  assert.deepEqual(diagonal, diagonalBefore);
  const move = receiveTransportHostAiPolicy(allocated.value, allocated.value.entityBytes!,
    [packet(tile.x + 2, tile.y)], "horizontal", "deferred");
  const moved = stepTransportHost(move, undefined, { counter: 1, task6Budget: 0 });
  assert.ok(moved.ok, JSON.stringify(moved));
  const blocker = allocateTransportProductionExit(move, { ...request,
    key: JSON.stringify([input.world.sessionId, 0, 0, "blocker"]), ticket: "blocker", unitType: 0,
    tile: { x: tile.x + 1, y: tile.y } });
  assert.ok(blocker.ok, JSON.stringify(blocker));
  const blockedBefore = structuredClone(blocker.value);
  const blocked = stepTransportHost(blocker.value, undefined, { counter: 1, task6Budget: 0 });
  assert.equal(blocked.ok, false);
  assert.match(JSON.stringify(blocked), /native-obstructed-path-owner-required/);
  assert.deepEqual(blocker.value, blockedBefore);
  const reinforcement = createTransportHostAdapter().prepare(installed.value, { id: "source-reinforce", triggerId: 1,
    actionIndex: 0, action: { name: "reinforce2", arguments: [] }, command: { kind: "reinforce2", team: 1,
      tileX: tile.x, tileY: tile.y, groups: [{ unitType: 2, count: 1 }] } });
  assert.ok(reinforcement.ok, JSON.stringify(reinforcement));
  const reinforced = transportHostState(reinforcement.value.world).slots.find(actor => actor?.key.startsWith("transport:"))!;
  assert.equal(reinforced.unitType, 2);
  assert.ok(reinforced.nativeAiTask);
  const badRequest = { ...request, unitType: 92 };
  const before = structuredClone(reservation.value);
  assert.equal(allocateTransportProductionExit(reservation.value, badRequest).ok, false);
  assert.deepEqual(reservation.value, before);
});

for (const mission of ["HUMAN01", "ALIEN01", "HUMAN02", "ALIEN02"]) {
  test(`source factory owns actual ${mission} input actors`, async () => {
    const input = fixture(mission), before = structuredClone(input.world);
    const configuration = await createSourceNativeTaskOptions(input);
    assert.ok(configuration.bindings.length > 0);
    assert.doesNotThrow(() => validateSourceNativeWorld(structuredClone(configuration), structuredClone(input.world)));
    assert.doesNotThrow(() => validateSourceNativeWorld(JSON.parse(JSON.stringify(configuration)), input.world));
    let nextSlot = 152;
    for (const [sourceRow, row] of input.world.source.placementRows.entries()) {
      const entity = input.world.entities.find(entity => entity.sourceRow === sourceRow);
      if (row[3] === -1) assert.equal(entity, undefined, "RENAT consumes no actor slot");
      else {
        assert.equal(entity?.rawSlot, nextSlot++, `source row ${sourceRow} native slot`);
        assert.equal(entity?.key, `placement:${sourceRow}`);
      }
    }
    assert.equal(input.world.placementState.nextSlot, nextSlot);
    assert.ok(isAuthenticatedSourceNativeTaskConfiguration(structuredClone(configuration)));
    assert.ok(Object.isFrozen(configuration.profiles[0].typeBytes));
    const authenticated = await authenticateNativeAiTaskConfiguration(structuredClone(configuration));
    const installed = initializeTransportHostNativeAiTasks(input.world, authenticated);
    assert.ok(installed.ok, JSON.stringify(installed));
    const host = transportHostState(installed.value);
    assert.equal(host.slots.filter(actor => actor?.nativeAiTask).length, configuration.bindings.length);
    assert.equal(advanceTransportHost(installed.value, 16, undefined, []).ok, false);
    const cell = host.ground.findIndex((slot, index) => slot === -1 && host.groundEligible[index]
      && (host.nativeAiTasks!.ground[index] & 1023) === 1023);
    const allocated = allocateTransportProductionExit(installed.value, { key: JSON.stringify([input.world.sessionId, 0, 0, "source"]),
      team: 0, queue: 0, ticket: "source", unitType: 0, tile: { x: cell % host.width, y: Math.floor(cell / host.width) } });
    assert.ok(allocated.ok, JSON.stringify(allocated));
    const created = transportHostState(allocated.value).slots.find(actor => actor?.key.startsWith("transport:"))!;
    assert.ok(created.nativeAiTask);
    assert.equal(created.nativeAiTask.raw[6], 0);
    const forgedWorld = structuredClone(installed.value), forgedHost = transportHostState(forgedWorld);
    (forgedHost.nativeAiTasks!.configuration.profiles[0].typeBytes as number[])[8] ^= 1;
    const rejected = stepTransportHost({ ...forgedWorld, transportState: forgedHost }, undefined, { counter: 1, task6Budget: 0 });
    assert.equal(rejected.ok, false);
    assert.deepEqual(input.world, before);
    const poisoned = structuredClone(configuration);
    (poisoned.profiles[0].typeBytes as number[])[8] ^= 1;
    assert.equal(isAuthenticatedSourceNativeTaskConfiguration(poisoned), false);
    const changedSource = structuredClone(input);
    changedSource.assets.gameStat[30] ^= 1;
    await assert.rejects(createSourceNativeTaskOptions(changedSource), /hash mismatch/);
  });
}

test("immutable authentication caches only verified private data and never warms mutable clones", async () => {
  const configuration = await createSourceNativeTaskOptions(fixture("HUMAN02"));
  assert.ok(isImmutableSourceNativeTaskConfiguration(configuration));
  assert.equal(retainSourceNativeTaskConfiguration(configuration), configuration);
  const external = structuredClone(configuration);
  assert.ok(isAuthenticatedSourceNativeTaskConfiguration(external));
  assert.equal(isImmutableSourceNativeTaskConfiguration(external), false);
  const retained = retainSourceNativeTaskConfiguration(external);
  assert.notEqual(retained, external);
  assert.ok(Object.isFrozen(retained.profiles[0].fin));
  assert.ok(Object.isFrozen(retained.profiles[0].ground));
  (external.profiles[0].typeBytes as number[])[8] ^= 1;
  assert.equal(isAuthenticatedSourceNativeTaskConfiguration(external), false);
  assert.throws(() => retainSourceNativeTaskConfiguration(external), /authentication/);
  assert.ok(isAuthenticatedSourceNativeTaskConfiguration(retained));
  assert.throws(() => { (retained.profiles[0].typeBytes as number[])[8] ^= 1; }, TypeError);
  assert.throws(() => { (retained.bindings[0].raw as number[])[0] ^= 1; }, TypeError);
  const originalStringify = JSON.stringify;
  let serializations = 0;
  JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => {
    serializations++;
    return originalStringify(...args);
  }) as typeof JSON.stringify;
  try {
    for (let index = 0; index < 20; index++) assert.ok(isAuthenticatedSourceNativeTaskConfiguration(retained));
    assert.equal(serializations, 0);
  } finally { JSON.stringify = originalStringify; }
  let executed = false;
  for (const forged of [
    Object.create(configuration),
    { ...configuration, toJSON() { executed = true; return configuration; } },
    Object.defineProperty({ ...configuration }, "profiles", { get() { executed = true; return configuration.profiles; } }),
    { ...configuration, profiles: [{ ...configuration.profiles[0], ground: new Uint16Array(new SharedArrayBuffer(16)) }] },
    { ...configuration, profiles: [{ ...configuration.profiles[0], fin: Object.create(configuration.profiles[0].fin) }] },
  ]) {
    assert.equal(isAuthenticatedSourceNativeTaskConfiguration(forged), false);
    assert.throws(() => retainSourceNativeTaskConfiguration(forged));
  }
  assert.equal(executed, false);
});

test("source factory rejects coherent native slot permutations without repairing the world", async () => {
  const input = fixture("HUMAN01"), state = transportHostState(input.world);
  const firstSlot = 155, secondSlot = 156;
  const swap = (slot: number) => slot === firstSlot ? secondSlot : slot === secondSlot ? firstSlot : slot;
  assert.ok(state.slots[firstSlot] && state.slots[secondSlot]);
  const bytes = input.world.entityBytes!;
  const firstRaw = bytes.slice(firstSlot * 220, (firstSlot + 1) * 220);
  bytes.copyWithin(firstSlot * 220, secondSlot * 220, (secondSlot + 1) * 220);
  bytes.set(firstRaw, secondSlot * 220);
  for (const table of [state.slots, state.registry, state.generations]) {
    [table[firstSlot], table[secondSlot]] = [table[secondSlot], table[firstSlot]];
  }
  state.slots[firstSlot]!.slot = firstSlot;
  state.slots[secondSlot]!.slot = secondSlot;
  state.ground = state.ground.map(swap);
  state.flying = state.flying.map(swap);
  const world = { ...input.world, transportState: state, entities: input.world.entities.map(entity =>
    ({ ...entity, rawSlot: entity.rawSlot === null ? null : swap(entity.rawSlot) })) };
  const before = structuredClone(world);
  await assert.rejects(createSourceNativeTaskOptions({ assets: input.assets, world }), /native SCN slot allocation/);
  assert.deepEqual(world, before);
});

test("source world attestation covers unowned actors, all raw records and full host tables", async () => {
  const input = fixture("HUMAN01"), configuration = await createSourceNativeTaskOptions(input);
  const boundSlots = new Set(configuration.bindings.map(binding => binding.slot));
  const obstacle = input.world.entities.find(entity => entity.sourceRow !== null && !boundSlots.has(entity.rawSlot!))!;
  const city = input.world.entities.find(entity => entity.sourceRow === null)!;
  assert.ok(obstacle && city);
  for (const slot of [configuration.bindings[0].slot, obstacle.rawSlot!, city.rawSlot!, 799]) {
    for (const offset of [0, 2, 4, 6, 7, 12, 0x2c, 0xcb, 219]) {
      const world = structuredClone(input.world);
      world.entityBytes![slot * 220 + offset] ^= 1;
      assert.throws(() => validateSourceNativeWorld(configuration, world), /source world attestation mismatch/,
        `raw slot ${slot} byte ${offset}`);
    }
  }
  for (const table of ["registry", "generations", "slots", "ground", "flying"] as const) {
    const world = structuredClone(input.world), state = transportHostState(world);
    if (table === "registry") state.registry[799] = "synthetic";
    else if (table === "generations") state.generations[799] = 0;
    else if (table === "slots") state.slots[799] = { ...state.slots[obstacle.rawSlot!]!, slot: 799 };
    else state[table][state[table].length - 1] = 799;
    assert.throws(() => validateSourceNativeWorld(configuration, { ...world, transportState: state }),
      /source world attestation mismatch/, table);
  }
  const world = structuredClone(input.world), state = transportHostState(world);
  const slot = obstacle.rawSlot!, actor = state.slots[slot]!;
  actor.health = 197;
  new DataView(world.entityBytes!.buffer).setInt32(slot * 220 + 12, 197, true);
  const changed = { ...world, transportState: state, entities: world.entities.map(entity => entity.rawSlot === slot
    ? { ...entity, health: 197 } : entity) };
  const changedConfiguration = await createSourceNativeTaskOptions({ assets: input.assets, world: changed });
  assert.notEqual(changedConfiguration.sourceId, configuration.sourceId, "unowned HP is part of source identity");
  assert.throws(() => validateSourceNativeWorld(configuration, changed), /source world attestation mismatch/);
  const refused = initializeTransportHostNativeAiTasks(changed, configuration);
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.match(refused.diagnostics.map(entry => entry.message).join("; "), /source world attestation mismatch/);
  assert.throws(() => validateSourceNativeWorld(changedConfiguration, input.world), /source world attestation mismatch/);
  assert.doesNotThrow(() => validateSourceNativeWorld(configuration, input.world));
  assert.doesNotThrow(() => validateSourceNativeWorld(changedConfiguration, changed));
  const forged = { ...configuration, sourceId: `${configuration.sourceId}:forged` };
  assert.throws(() => validateSourceNativeWorld(forged, input.world), /source authentication required/);
});

test("source factory rejects changed source identity, allocation metadata and occupancy", async () => {
  const input = fixture("HUMAN02");
  assert.ok(input.world.placementState.renatSources.length > 0);
  for (const poison of [
    (world: typeof input.world) => ({ ...world, placementState: { ...world.placementState,
      highWater: world.placementState.highWater + 1 } }),
    (world: typeof input.world) => {
      world.placementState.renatBytes[4] ^= 1;
      return world;
    },
    (world: typeof input.world) => {
      const state = transportHostState(world);
      state.ground[state.ground.length - 1] = 799;
      return { ...world, transportState: state };
    },
    (world: typeof input.world) => {
      const state = transportHostState(world), actor = state.slots[152]!;
      actor.key = "synthetic-source";
      state.registry[152] = actor.key;
      return { ...world, transportState: state, entities: world.entities.map(entity => entity.rawSlot === 152
        ? { ...entity, key: actor.key } : entity) };
    },
    (world: typeof input.world) => ({ ...world, entities: world.entities.map(entity => entity.rawSlot === 152
      ? { ...entity, maxHealth: entity.maxHealth + 1 } : entity) }),
  ]) {
    const world = poison(structuredClone(input.world)), before = structuredClone(world);
    await assert.rejects(createSourceNativeTaskOptions({ assets: input.assets, world }),
      /native SCN|source host occupancy/);
    assert.deepEqual(world, before);
  }
});

test("source factory rejects forged source worlds and preserves live HP and generation", async () => {
  const input = fixture("HUMAN01"), baseline = await createSourceNativeTaskOptions(input);
  for (const poison of [
    (world: typeof input.world) => { world.entityBytes![15 * 220] ^= 1; },
    (world: typeof input.world) => {
      const state = transportHostState(world);
      state.groundEligible[0] = !state.groundEligible[0];
      return { ...world, transportState: state };
    },
    (world: typeof input.world) => {
      const state = transportHostState(world);
      state.definitions = state.definitions.map(definition => definition.unitType === 3 ? { ...definition, movementSpeed: 99 } : definition);
      return { ...world, transportState: state };
    },
    (world: typeof input.world) => ({ ...world, source: { ...world.source,
      placementRows: world.source.placementRows.slice(1) } }),
  ]) {
    const world = structuredClone(input.world);
    await assert.rejects(createSourceNativeTaskOptions({ assets: input.assets, world: poison(world) ?? world }),
      /raw\/host|eligibility|GAMESTAT|parsed actual SCN/);
  }
  const binding = baseline.bindings[0], world = structuredClone(input.world), state = transportHostState(world);
  const actor = state.slots[binding.slot]!;
  actor.health = 197; actor.generation = 23; state.generations[actor.slot] = 23;
  new DataView(world.entityBytes!.buffer).setInt32(actor.slot * 220 + 12, 197, true);
  const current = { ...world, transportState: state, entities: world.entities.map(entity => entity.rawSlot === actor.slot
    ? { ...entity, health: 197, generation: 23 } : entity) };
  const configuration = await createSourceNativeTaskOptions({ assets: input.assets, world: current });
  assert.doesNotThrow(() => validateSourceNativeWorld(configuration, current));
  assert.throws(() => validateSourceNativeWorld(baseline, current), /source world attestation mismatch/);
  assert.equal(configuration.bindings[0].generation, 23);
  assert.equal(Buffer.from(configuration.bindings[0].raw).readInt32LE(12), 197);
  const installed = initializeTransportHostNativeAiTasks(current, configuration);
  assert.ok(installed.ok, JSON.stringify(installed));
  assert.equal(transportHostState(installed.value).slots[actor.slot]!.health, 197);
});

const trace = process.env.DC_SOURCE_NATIVE_TASK_TRACE;
if (trace) {
  const records = readFileSync(trace, "utf8").trim().split("\n").map(line => JSON.parse(line)) as {
    before: number[]; world: LegacyAiRegisteredWorld; fin: LegacyAiRegisteredWorld["fin"];
  }[];
  for (const [index, record] of records.entries()) {
    test(`original constructor raw220 ${index}`, () => {
      assert.deepEqual(constructSourceNativeTaskActor(record.before, { ...record.world, fin: record.fin }), record.before);
    });
  }
}
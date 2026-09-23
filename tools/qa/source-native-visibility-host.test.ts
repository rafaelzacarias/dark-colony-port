import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CampaignSession, initializeCampaignSession, type CampaignSessionInput } from "../../src/engine/campaign-session";
import { createSourceNativeTaskOptions, withSourceNativeCombatTasks } from "../../src/engine/source-native-task-options";
import { createSourceNativeCombatProof, createSourceNativeCombatSoundProof } from "../../src/engine/source-native-combat-options";
import { createSourceNativeCombatOptions } from "../../src/engine/source-native-combat-host";
import { createSourceNativeVisibilityHostConfiguration, validateSourceNativeVisibilityHostConfiguration, stageSourceNativeVisibility,
  type SourceNativeVisibilityFrame } from "../../src/engine/source-native-visibility-host";
import { cloneTransportHostWorld, stepTransportHostVisibility, transportHostState, type TransportHostState } from "../../src/engine/transport-host";
import { createNativeCombatMissionFixture, nativeCombatPacket } from "./fixtures/native-combat-mission";
import { reduceLegacyNativeVisibility, type LegacyNativeVisibilityFrame } from "../../src/engine/legacy-native-visibility";
import type { SourceNativeVisibilityAssets } from "../../src/engine/source-native-visibility";

interface FreshVisibilitySnapshot {
  actors: string; ground: number[]; air: number[]; extra: number[]; rngCursor: number; crtSeed: number;
}
interface FreshVisibilityTrace {
  name: string; fresh: boolean; bounded: boolean; faction: string; counter: number; daylight: number;
  highWater: number; selected: number[]; excluded: number[]; skipped: number[]; registry: number[];
  terrain: number[]; initial: FreshVisibilitySnapshot; caller: FreshVisibilitySnapshot;
  persistent: FreshVisibilitySnapshot; recomputed: FreshVisibilitySnapshot;
  writes: { plane: string; index: number; before: number; after: number }[];
}

function freshTrace(): FreshVisibilityTrace {
  const path = process.env.DC_VISIBILITY_GROUND_MATRIX;
  if (path) {
    const trace = readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line) as FreshVisibilityTrace)
      .find(trace => trace.name === "HUMAN-fresh-full-0");
    assert.ok(trace, "Missing full fresh HUMAN02 oracle");
    return trace;
  }
  return JSON.parse(execFileSync("python3", ["-B", fileURLToPath(new URL("./native-visibility-native.py", import.meta.url)),
    "--fresh", "--faction", "HUMAN"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" } }));
}

async function fixture() {
  const base = await createNativeCombatMissionFixture(true);
  const { nativeAiTasks: _tasks, nativeCombat: _combat, ...options } = base.mission.sourceNativeCombat!.options;
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
  const raw = (path: string) => read(`raw_cd/DC/${path}`);
  const animationRegistry = raw("ANIM.DAT");
  const assets = { executable: raw("DC.EXE"), gameStat: raw("GAMESTAT/GAMESTAT.TXT"), weaponStat: raw("GAMESTAT/WEAPSTAT.TXT"),
    boomStat: raw("GAMESTAT/BOOMSTAT.TXT"), damageMatrix: raw("GAMESTAT/MBULLET.TXT"), scenario: raw("SCENARIO/HUMAN/HUMAN02.SCN"),
    troopFin: raw("ANIMATE/TRSC.FIN"), troopSprite: raw("SPRITES/TRSC.SPR"), animationRegistry,
    registryFins: Object.fromEntries(animationRegistry.toString().trim().split(/\s+/).map(name => [name.toUpperCase(), raw(`ANIMATE/${name.toUpperCase()}`)])),
    map: raw("SCENARIO/HUMAN/HUMAN02.MAP"), mtg: raw("SCENARIO/HUMAN/HUMAN02.MTG"), pth: raw("SCENARIO/HUMAN/HUMAN02.PTH"),
    bts: raw("SCENARIO/DESERT.BTS"),
    animations: Object.fromEntries(["TRSC", "GRAY", "REAP", "BARR"].map(stem => [stem, read(`public/assets/generated/animations/${stem}.json`)])) };
  const initial = initializeCampaignSession(options);
  assert.ok(initial.ok, JSON.stringify(initial));
  const configuration = await createSourceNativeTaskOptions({ assets, world: initial.value.world });
  const proof = await createSourceNativeCombatProof(assets);
  const tasks = await withSourceNativeCombatTasks(configuration, proof);
  const visibility = await createSourceNativeVisibilityHostConfiguration({ assets, tasks, world: initial.value.world,
    localTeam: 0, localMask: 0x40000000, daylight: 0, crtSeed: 1 });
  const soundFrame = { initialized: true, disabled: false, listener: { x: base.column * 256 + 128, y: base.row * 256 + 128 } };
  const sound = await createSourceNativeCombatSoundProof({ executable: assets.executable,
    soundTable: raw("SOUND/SOUND2.DAT"), bindings: raw("SOUND/SLIST.DAT") }, {
    policy: "explicit-caller-boundary", state: { descriptor: [4, 0, 0, 28, 90, 153, 154, 0, 0, 0, 0, 0, 0], randomSeed: 1 }, ...soundFrame });
  const providers = await createSourceNativeCombatOptions({ configuration, proof, death: true, sound, visibility });
  return { options: { ...options, ...providers }, visibility, assets, tasks, configuration, proof,
    initial: initial.value.world, soundFrame, column: base.column, row: base.row };
}

function selection(session: CampaignSession, sequence: number, counter: number, producers: readonly number[] = []): SourceNativeVisibilityFrame {
  const bytes = session.snapshot.world.entityBytes!;
  const eligible = Array.from({ length: 800 }, (_, slot) => slot).filter(slot => bytes[slot * 220 + 0x2c]
    && bytes[slot * 220 + 7] <= 7 && ![1, 2].includes(bytes[slot * 220 + 0xcb]));
  return { sequence, counter, producerSlots: producers, excludedProducerSlots: eligible.filter(slot => !producers.includes(slot)) };
}

test("visibility host: full fresh HUMAN02 selects all original eligible producers", async context => {
  const started = performance.now(), data = await fixture(), session = new CampaignSession(data.options);
  const trace = freshTrace(), initial = session.checkpoint(), initialHost = initial.state.world.transportState;
  const producers = selection(session, 1, 0).excludedProducerSlots;
  assert.equal(trace.fresh, true); assert.equal(trace.bounded, false); assert.equal(trace.faction, "HUMAN");
  assert.deepEqual(trace.excluded, []); assert.deepEqual(trace.skipped, []);
  assert.equal(initial.state.world.entities.length, 21);
  assert.deepEqual(producers, [0, 1, 5, 152, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165]);
  assert.deepEqual(producers, trace.selected);
  assert.equal(initialHost.highWater, trace.highWater);
  assert.deepEqual(initialHost.registry.map((key, slot) => key === null ? -1 : slot), trace.registry);
  assert.equal(trace.registry.filter(slot => slot >= 0).length, 21);
  assert.deepEqual(initialHost.nativeAiTasks!.ground, trace.initial.ground);
  assert.deepEqual(initialHost.nativeAiTasks!.configuration.profiles[0].air, trace.initial.air);
  assert.deepEqual(initialHost.nativeAiTasks!.configuration.profiles[0].extra, trace.initial.extra);
  assert.equal(initialHost.nativeAiTasks!.rngCursor, trace.initial.rngCursor);
  const nativeActors = [...Buffer.from(trace.initial.actors, "base64")];
  const visibilityOffsets = [0, 1, 2, 3, 4, 5, 6, 7, 0x10, 0x2c, 0xca, 0xcb];
  for (const slot of trace.registry.filter(slot => slot >= 0)) for (const offset of visibilityOffsets)
    assert.equal(initial.state.world.entityBytes![slot * 220 + offset], nativeActors[slot * 220 + offset], `slot ${slot} +${offset}`);
  const oracleFrame: LegacyNativeVisibilityFrame = { configuration: data.visibility.source, phase: "caller", counter: trace.counter,
    highWater: trace.highWater, actors: nativeActors, registry: trace.registry, ground: trace.initial.ground,
    air: trace.initial.air, extra: trace.initial.extra, terrain: trace.terrain, localTeam: 0, localMask: 0x40000000,
    daylight: 0, revealAll: 0, revealLocal: 0, rngCursor: trace.initial.rngCursor, crtSeed: trace.initial.crtSeed,
    producerSlots: producers, excludedProducerSlots: [] };
  const pure = reduceLegacyNativeVisibility(oracleFrame);
  assert.ok(pure.supported, JSON.stringify(pure));
  assert.deepEqual(pure.actors, [...Buffer.from(trace.caller.actors, "base64")]);
  assert.deepEqual(pure.ground, trace.caller.ground);
  assert.equal(pure.crtSeed, trace.initial.crtSeed);
  assert.equal(pure.crtSeed, trace.caller.crtSeed);
  assert.deepEqual(pure.writes, trace.writes.map(({ plane, index, before, after }) => ({ plane, index, before, after })));
  const normalized = reduceLegacyNativeVisibility({ ...oracleFrame, actors: [...initial.state.world.entityBytes!],
    crtSeed: data.visibility.crtSeed });
  assert.ok(normalized.supported, JSON.stringify(normalized));
  assert.deepEqual(normalized.ground, pure.ground);
  assert.deepEqual(normalized.writes, pure.writes);
  const frame = selection(session, 1, trace.counter, producers), computeStarted = performance.now();
  assert.deepEqual(frame.excludedProducerSlots, []);
  const result = session.stepVisibilityForNativeView({ visibilityFrame: frame });
  const computeMilliseconds = performance.now() - computeStarted;
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.value.visibility.groundWords, Uint32Array.from(trace.caller.ground));
  assert.deepEqual(session.snapshot.world.entityBytes, Uint8Array.from(normalized.actors));
  assert.equal(result.value.visibility.groundWords.filter(word => word >>> 31).length, 411);
  assert.equal(result.value.visibility.groundWords.filter(word => word & 0x40000000).length, 411);
  assert.deepEqual(result.value.visibilityEvent, { ...frame, executed: true, phases: ["clear", "compute"],
    writes: pure.writes.length, rngCursor: trace.caller.rngCursor, crtSeed: normalized.crtSeed });
  const fresh = await fixture();
  assert.notEqual(fresh.visibility, data.visibility);
  assert.notEqual(fresh.visibility.source, data.visibility.source);
  assert.deepEqual(fresh.visibility, data.visibility);
  const restore = () => {
    const checkpoint = session.checkpoint();
    assert.deepEqual(CampaignSession.restore(checkpoint, undefined, fresh.options.nativeAiTasks, undefined,
      fresh.options.nativeCombat).checkpoint(), checkpoint);
  };
  restore();
  const computed = session.checkpoint();
  const cleared = session.stepVisibilityForNativeView({ visibilityFrame: selection(session, 2, 32) });
  assert.ok(cleared.ok, JSON.stringify(cleared));
  assert.deepEqual(cleared.value.visibility.groundWords, Uint32Array.from(trace.persistent.ground));
  assert.equal(cleared.value.visibility.groundWords.filter(word => word >>> 31).length, 411);
  assert.equal(cleared.value.visibility.groundWords.filter(word => word & 0x7f800000).length, 0);
  assert.deepEqual(cleared.value.visibilityEvent.excludedProducerSlots, producers);
  restore();
  const recomputed = session.stepVisibilityForNativeView({ visibilityFrame: selection(session, 3, 48, producers) });
  assert.ok(recomputed.ok, JSON.stringify(recomputed));
  assert.deepEqual(recomputed.value.visibility.groundWords, Uint32Array.from(trace.recomputed.ground));
  assert.deepEqual(recomputed.value.visibilityEvent.excludedProducerSlots, []);
  restore();
  const final = session.checkpoint(), finalHost = final.state.world.transportState;
  assert.deepEqual(final.state.world.entities, initial.state.world.entities);
  assert.deepEqual(final.state.world.entityBytes, computed.state.world.entityBytes);
  assert.deepEqual(finalHost.registry, initialHost.registry);
  assert.deepEqual(finalHost.slots, initialHost.slots);
  assert.equal(finalHost.highWater, initialHost.highWater);
  assert.deepEqual(finalHost.nativeCombat!.soundState, initialHost.nativeCombat!.soundState);
  assert.deepEqual(finalHost.nativeCombat!.projectiles, initialHost.nativeCombat!.projectiles);
  assert.deepEqual(finalHost.nativeAiTasks!.configuration, initialHost.nativeAiTasks!.configuration);
  assert.equal(finalHost.nativeAiTasks!.rngCursor, initialHost.nativeAiTasks!.rngCursor);
  assert.equal(final.state.cycleCounter, initial.state.cycleCounter);
  assert.equal(finalHost.tick, initialHost.tick);
  assert.deepEqual(final.state.controller, initial.state.controller);
  assert.deepEqual(final.state.nativeSourceInputs, [frame, selection(session, 2, 32), selection(session, 3, 48, producers)]
    .map(visibilityFrame => ({ visibilityFrame })));
  result.value.visibility.groundWords.fill(0);
  assert.deepEqual((session.snapshot.world.transportState as TransportHostState).nativeAiTasks!.ground, trace.recomputed.ground);
  assert.equal(session.snapshot.world.entities.length, 21);
  context.diagnostic(JSON.stringify({ producers, excluded: [], actors: 21, explored: 411, sight: 411,
    writes: pure.writes.length, computeMilliseconds, milliseconds: performance.now() - started }));
});

test("visibility host: source snapshot binds SCN, profiles and shared input bytes", async () => {
  const data = await fixture();
  const input = { assets: data.assets, tasks: data.tasks, world: data.initial,
    localTeam: 0, localMask: 0x40000000, daylight: 0, crtSeed: 1 };
  const fields = ["executable", "gameStat", "scenario", "map", "bts", "mtg", "pth"] as const;
  const shared = Object.fromEntries(fields.map(field => {
    const bytes = new Uint8Array(new SharedArrayBuffer(data.assets[field].length));
    bytes.set(data.assets[field]);
    return [field, bytes];
  })) as unknown as SourceNativeVisibilityAssets;
  let scenarioReads = 0;
  const assets = { ...shared, get scenario() { scenarioReads++; return shared.scenario; } };
  const pending = createSourceNativeVisibilityHostConfiguration({ ...input, assets });
  for (const field of fields) shared[field].fill(0);
  const configuration = await pending;
  assert.equal(scenarioReads, 1);
  assert.deepEqual(configuration, data.visibility);
  assert.ok(Object.isFrozen(configuration.source.producerProfiles));
  assert.deepEqual(Object.keys(configuration.source.producerProfiles).map(Number),
    [0, 2, 8, 10, 16, 17, 28, 29, 41, 69, 73, 81, 84, 86, 89, 91]);
  assert.equal(configuration.source.mission, "HUMAN02");
  assert.throws(() => validateSourceNativeVisibilityHostConfiguration({ ...configuration,
    source: { ...configuration.source, producerProfiles: { ...configuration.source.producerProfiles, 5: "ground-occluded" } } }), /identity/);
  const alienScenario = readFileSync(new URL("../../raw_cd/DC/SCENARIO/ALIEN/ALIEN02.SCN", import.meta.url));
  await assert.rejects(createSourceNativeVisibilityHostConfiguration({ ...input,
    assets: { ...data.assets, scenario: alienScenario } }), /scenario fingerprint/);
  const changedWorld = structuredClone(data.initial);
  changedWorld.entityBytes![152 * 220 + 6] ^= 1;
  await assert.rejects(createSourceNativeVisibilityHostConfiguration({ ...input, world: changedWorld }), /source|world|attest/i);
  const changedTypes = structuredClone(data.initial);
  changedTypes.typeMovementClasses![16] ^= 1;
  await assert.rejects(createSourceNativeVisibilityHostConfiguration({ ...input, world: changedTypes }), /attestation/);
  await assert.rejects(createSourceNativeVisibilityHostConfiguration({ ...input,
    assets: { ...data.assets, scenario: [...data.assets.scenario] as unknown as Uint8Array } }), /source bytes/);
});

test("visibility host: full producer admission retains unsupported runtime guards", async context => {
  const data = await fixture(), session = new CampaignSession(data.options);
  const producers = selection(session, 1, 0).excludedProducerSlots, frame = selection(session, 1, 0, producers);
  const initial = session.checkpoint();
  const controlledWorld = () => cloneTransportHostWorld(session.snapshot.world);
  for (const kind of [1, 5, 13, 45, 46, 92]) await context.test(`unsupported actor type ${kind}`, () => {
    const world = controlledWorld(), host = world.transportState as TransportHostState;
    world.entityBytes![6] = kind;
    const before = structuredClone(world);
    assert.throws(() => stageSourceNativeVisibility(world, host, frame), /unowned-native-visibility-producer/);
    assert.deepEqual(world, before);
    assert.equal(stepTransportHostVisibility(world, frame).ok, false);
  });
  for (const [name, offset, value] of [["dying", 0x2c, 10], ["city altitude", 2, 1],
    ["ineligible detection", 0xcb, 1]] as const) await context.test(name, () => {
    const world = controlledWorld(), host = world.transportState as TransportHostState;
    world.entityBytes![offset] = value;
    const before = structuredClone(world);
    assert.throws(() => stageSourceNativeVisibility(world, host, frame), /unowned-native-visibility-producer|partition/);
    assert.deepEqual(world, before);
    assert.equal(stepTransportHostVisibility(world, frame).ok, false);
  });
  for (const [name, kind, offset] of [["night radius", 16, 0x10], ["day radius", 16, 0x14],
    ["city dispatch", 16, 0x60], ["special detection", 16, 0x6c], ["selected metadata", 16, 0x78],
    ["ineligible actor metadata", 86, 0x78]] as const) await context.test(name, () => {
    const world = controlledWorld(), host = world.transportState as TransportHostState;
    const configuration = host.nativeCombat!.configuration, typeTable = [...configuration.tables.typeTable];
    typeTable[kind * 280 + offset] ^= 1;
    host.nativeCombat!.configuration = { ...configuration, tables: { ...configuration.tables, typeTable } };
    const before = structuredClone(world);
    assert.throws(() => stageSourceNativeVisibility(world, host, frame), /source upgrade|metadata/);
    assert.deepEqual(world, before);
    assert.equal(stepTransportHostVisibility(world, frame).ok, false);
  });
  for (const flag of ["revealAll", "revealLocal"]) {
    assert.equal(session.stepVisibility({ visibilityFrame: { ...frame, [flag]: 1 } }).ok, false);
    assert.deepEqual(session.checkpoint(), initial);
  }
  const world = controlledWorld(), host = world.transportState as TransportHostState;
  host.resourceTileFlags[0] = 0x20000000;
  const before = structuredClone(world);
  assert.throws(() => stageSourceNativeVisibility(world, host, frame), /terrain mutation/);
  assert.deepEqual(world, before);
  assert.deepEqual(session.checkpoint(), initial);
});

test("visibility host: authenticated source, independent caller sequence, partial frames and rollback", async () => {
  const data = await fixture(), session = new CampaignSession(data.options);
  const initial = session.checkpoint(), initialHost = initial.state.world.transportState;
  assert.equal(initial.state.world.entities.length, 21);
  assert.ok(Object.isFrozen(data.visibility) && Object.isFrozen(data.visibility.source.terrain));
  assert.throws(() => validateSourceNativeVisibilityHostConfiguration(structuredClone(data.visibility)), /identity/);
  assert.throws(() => new CampaignSession({ ...data.options,
    nativeCombat: structuredClone(data.options.nativeCombat) }), /identity/);
  assert.equal(initializeCampaignSession({ ...data.options, nativeCombat: structuredClone(data.options.nativeCombat) }).ok, false);
  const controlledWorld = session.snapshot.world, controlledHost = controlledWorld.transportState as TransportHostState;
  const owned = controlledHost.slots.find(actor => actor?.nativeAiTask)!;
  const unowned = controlledHost.slots.find(actor => actor?.status && !actor.nativeAiTask)!;
  for (const actor of [owned, unowned]) {
    controlledWorld.entityBytes![actor.slot * 220 + 0xca] = 0xa5;
    if (actor.nativeAiTask) (actor.nativeAiTask.raw as number[])[0xca] = 0xa5;
  }
  const controlledBefore = structuredClone(controlledWorld);
  const controlledReset = stepTransportHostVisibility(controlledWorld, selection(session, 1, 0));
  assert.ok(controlledReset.ok, JSON.stringify(controlledReset));
  assert.deepEqual(controlledWorld, controlledBefore);
  for (const actor of [owned, unowned]) assert.equal(controlledReset.value.world.entityBytes![actor.slot * 220 + 0xca], 0);
  assert.equal((controlledReset.value.world.transportState as TransportHostState).slots[owned.slot]!.nativeAiTask!.raw[0xca], 0);
  assert.deepEqual(session.checkpoint(), initial);
  for (const counter of [15, 17, 31, 0xffffffff]) {
    const fork = session.fork();
    const result = fork.stepVisibilityForNativeView({ visibilityFrame: selection(fork, 1, counter) });
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value.visibilityEvent.executed, false);
    assert.deepEqual(fork.snapshot.world.entityBytes, session.snapshot.world.entityBytes);
    assert.deepEqual(result.value.visibility.groundWords, Uint32Array.from(initialHost.nativeAiTasks!.ground));
  }
  const partial = session.stepVisibilityForNativeView({ visibilityFrame: selection(session, 1, 1) });
  assert.ok(partial.ok, JSON.stringify(partial));
  assert.equal(partial.value.visibilityEvent.executed, false);
  assert.equal(partial.value.visibilityEvent.writes, 0);
  const after = session.checkpoint(), host = after.state.world.transportState;
  assert.deepEqual(after.state.world.entityBytes, initial.state.world.entityBytes);
  assert.deepEqual(host.nativeAiTasks, initialHost.nativeAiTasks);
  assert.deepEqual(host.nativeCombat!.soundState, initialHost.nativeCombat!.soundState);
  assert.equal(host.tick, 0); assert.equal(after.state.cycleCounter, 0);
  assert.deepEqual(after.state.controller, initial.state.controller);
  for (const visibilityFrame of [selection(session, 1, 0), selection(session, 3, 0),
    { ...selection(session, 2, 0), excludedProducerSlots: [] }, selection(session, 2, 0, [153])]) {
    const result = session.stepVisibility({ visibilityFrame });
    assert.equal(result.ok, false, JSON.stringify(result));
    if (visibilityFrame.producerSlots.includes(153)) assert.match(JSON.stringify(result), /partition/);
    assert.deepEqual(session.checkpoint(), after);
  }
  assert.equal(session.stepVisibility({ visibilityFrame: selection(session, 2, 0), nativeAiFrame: {} } as never).ok, false);
  const computed = session.stepVisibility({ visibilityFrame: selection(session, 2, 0) });
  assert.ok(computed.ok, JSON.stringify(computed));
  assert.deepEqual(computed.value.entry.visibility!.phases, ["clear", "compute"]);
  const repeated = session.stepVisibility({ visibilityFrame: selection(session, 3, 0) });
  assert.ok(repeated.ok, JSON.stringify(repeated));
  assert.equal(session.snapshot.cycleCounter, 0);
  const frame = session.stepForNativeView({ clockMilliseconds: 16,
    nativeAiFrame: { counter: 1, task6Budget: 0, registeredSlots: [], sound: data.soundFrame } });
  assert.ok(frame.ok, JSON.stringify(frame));
  const checkpoint = session.checkpoint();
  const fresh = await fixture();
  const restore = (value: unknown) => CampaignSession.restore(value, undefined, fresh.options.nativeAiTasks, undefined, fresh.options.nativeCombat);
  assert.deepEqual(restore(checkpoint).checkpoint(), checkpoint);
  for (const field of ["ground", "rng", "detection", "sequence", "history"] as const) {
    const changed = structuredClone(checkpoint), changedHost = changed.state.world.transportState;
    if (field === "ground") changedHost.nativeAiTasks!.ground[0] = (changedHost.nativeAiTasks!.ground[0] ^ 0x80000000) >>> 0;
    if (field === "rng") changedHost.nativeAiTasks!.rngCursor ^= 1;
    if (field === "detection") {
      const slot = changedHost.slots.find(actor => actor?.nativeAiTask)!.slot;
      (changed.state.world.entityBytes as number[])[slot * 220 + 0xca] = 1;
      (changedHost.slots[slot]!.nativeAiTask!.raw as number[])[0xca] = 1;
    }
    if (field === "sequence") changedHost.nativeCombat!.visibility!.sequence++;
    if (field === "history") (changed.state.nativeSourceInputs as unknown[]).reverse();
    assert.throws(() => restore(changed), field === "history" ? /sequence/ : /caller replay/);
  }
  const privateHost = (value: CampaignSession) => (Reflect.get(value, "current") as CampaignSession["snapshot"]).world.transportState as TransportHostState;
  const fork = session.fork();
  assert.equal(privateHost(fork).nativeCombat!.configuration.visibility, privateHost(session).nativeCombat!.configuration.visibility);
  assert.notEqual(privateHost(fork).nativeCombat!.visibility!.journal, privateHost(session).nativeCombat!.visibility!.journal);
  assert.deepEqual(transportHostState(session.snapshot.world).nativeCombat!.visibility!.sequence, 3);
});

test("visibility host: natural exploration publishes real lethal sound with replayable CRT history", async context => {
  const data = await fixture(), session = new CampaignSession(data.options);
  const state = () => Reflect.get(session, "current") as CampaignSession["snapshot"];
  const host = () => state().world.transportState as TransportHostState;
  let registeredSlots: number[] = [];
  const next = (packets?: number[][]): CampaignSessionInput => {
    const counter = state().cycleCounter + 1;
    return { clockMilliseconds: counter * 16,
      nativeAiFrame: { counter, task6Budget: 0, registeredSlots: [...registeredSlots], sound: data.soundFrame },
      ...(packets ? { nativeAiReceipt: { id: `visibility-combat:${counter}`, packets,
        expected: host().slots.flatMap(actor => actor?.nativeAiTask ? [{ slot: actor.slot, generation: actor.generation,
          key: actor.key, raw: actor.nativeAiTask.raw }] : []) } } : {}) };
  };
  for (let counter = 1; counter <= 16; counter++) {
    const result = session.stepForNativeView(next()); assert.ok(result.ok, JSON.stringify(result));
  }
  assert.equal(state().world.entities.length, 23);
  const added = host().slots.filter(actor => actor?.key.startsWith("transport:"));
  const source = added.find(actor => actor!.team === 0)!, target = added.find(actor => actor!.team === 5)!;
  registeredSlots = [source.slot, target.slot].sort((left, right) => left - right);
  assert.ok(session.stepForNativeView(next([nativeCombatPacket(source.slot, data.column + 2, data.row, 7)])).ok);
  for (let count = 0; count < 40; count++) assert.ok(session.stepForNativeView(next()).ok);
  assert.ok(session.stepForNativeView(next([nativeCombatPacket(target.slot, data.column, data.row)])).ok);
  while (state().cycleCounter < 613) {
    const result = session.stepForNativeView(next()); assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value.entry.requests.some(request => request.type === "native-death-sound"), false);
  }
  const victim = host().slots[target.slot]!, cell = (victim.position.y >>> 8) * host().width + (victim.position.x >>> 8);
  assert.equal(victim.health, 25);
  assert.equal(host().nativeCombat!.journal.flatMap(entry => entry.impacts).length, 31);
  assert.equal(host().nativeAiTasks!.ground[cell] >>> 31, 0);
  const rngBefore = host().nativeAiTasks!.rngCursor;
  const originalRaw = [...state().world.entityBytes!];
  const visible = session.stepVisibilityForNativeView({ visibilityFrame: selection(session, 1, 0, [source.slot]) });
  assert.ok(visible.ok, JSON.stringify(visible));
  assert.equal(visible.value.visibility.groundWords[cell] >>> 31, 1);
  assert.notEqual(visible.value.visibility.groundWords[cell] & 0x40000000, 0);
  assert.equal(host().nativeAiTasks!.rngCursor, rngBefore);
  assert.deepEqual(host().nativeCombat!.soundState, data.options.nativeCombat.sound!.initial);
  assert.equal(state().cycleCounter, 613);
  for (let index = 0; index < originalRaw.length; index++)
    if (index % 220 !== 0xca) assert.equal(state().world.entityBytes![index], originalRaw[index]);
  for (const actor of host().slots) if (actor?.nativeAiTask)
    assert.deepEqual(actor.nativeAiTask.raw, [...state().world.entityBytes!.subarray(actor.slot * 220, (actor.slot + 1) * 220)]);
  const cleared = session.stepVisibilityForNativeView({ visibilityFrame: selection(session, 2, 16) });
  assert.ok(cleared.ok, JSON.stringify(cleared));
  assert.equal(cleared.value.visibility.groundWords[cell] >>> 31, 1);
  assert.equal(cleared.value.visibility.groundWords[cell] & 0x7f800000, 0);
  const before = session.checkpoint(), journal = session.journal;
  const failed = session.stepForNativeView({ ...next(), reservations: [{ slot: 799, generation: 0, tileX: 0, tileY: 0 }] });
  assert.equal(failed.ok, false);
  assert.deepEqual(session.checkpoint(), before); assert.deepEqual(session.journal, journal);
  const result = session.stepForNativeView(next()); assert.ok(result.ok, JSON.stringify(result));
  const requests = result.value.entry.requests.filter(request => request.type === "native-death-sound");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].id, 28); assert.equal(requests[0].slot, target.slot);
  assert.equal(requests[0].counter, 614); assert.equal(requests[0].generation, target.generation);
  assert.equal(host().slots[target.slot]!.health, 0);
  assert.equal(host().nativeCombat!.soundState!.randomSeed, 1103527590);
  assert.equal(host().nativeCombat!.soundState!.descriptor[1], 2);
  const fresh = await fixture(), checkpoint = session.checkpoint();
  const restored = CampaignSession.restore(checkpoint, undefined, fresh.options.nativeAiTasks, undefined, fresh.options.nativeCombat);
  assert.deepEqual(restored.checkpoint(), checkpoint);
  registeredSlots = [target.slot];
  const continuation = restored.stepForNativeView(next()); assert.ok(continuation.ok, JSON.stringify(continuation));
  assert.equal(continuation.value.entry.requests.some(request => request.type === "native-death-sound"), false);
  context.diagnostic(JSON.stringify({ caller: "explicit separate phase, not original scheduler", producers: [source.slot], victim: target.slot,
    cell, visibilityCounters: [0, 16], actorCounter: 614, naturalExploration: true, persistentAfterClear: true,
    sourceCrtBoundary: 1, crtAfter: 1103527590, requests, completeReplay: true }));
});
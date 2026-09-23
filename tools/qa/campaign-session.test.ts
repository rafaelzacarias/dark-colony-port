import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CampaignSession, createCampaignSession, initializeCampaignSession, type CampaignSessionOptions } from "../../src/engine/campaign-session.ts";
import { projectLegacyColony } from "../../src/engine/legacy-colony.ts";
import { transportHostState } from "../../src/engine/transport-host.ts";
import { planMissionStep } from "../../src/engine/mission-controller.ts";
import type { TriggerResult } from "../../src/engine/trigger-runtime.ts";
import { parseScenario } from "../extractors/data/scenario.ts";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables.ts";
import { parseTriggerScript } from "../extractors/data/triggers.ts";
import { parseMissionMessages } from "../extractors/data/messages.ts";
import { parseMapBundle } from "../extractors/maps/map.ts";

function unwrap<Value>(result: TriggerResult<Value>): Value {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("Expected success");
  return result.value;
}

function fixture(faction: "HUMAN" | "ALIEN"): CampaignSessionOptions {
  const read = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url));
  const mission = (extension: string) => read(`SCENARIO/${faction}/${faction}01.${extension}`);
  const map = parseMapBundle(mission("MAP"), mission("MTG"), mission("PTH"));
  return {
    sessionId: faction, source: parseScenario(mission("SCN").toString()),
    units: parseUnitStats(read("GAMESTAT/GAMESTAT.TXT").toString()),
    weapons: parseWeaponStats(read("GAMESTAT/WEAPSTAT.TXT").toString()),
    triggers: parseTriggerScript(mission("TRO").toString()), messages: parseMissionMessages(mission("MSG").toString()),
    map, pathGrid: map.pathGrid, tags: map.tagGrid,
    commanders: faction === "HUMAN" ? [{ team: 0, unitType: 69, sprite: "TRSC" }]
      : [{ team: 0, unitType: 73, sprite: "GRAY" }, { team: 1, unitType: 69, sprite: "TRSC" }],
    directionBits: Array.from({ length: 64 }, () => [0, 0] as const), fixedStepMilliseconds: 16, orientationSteps: 1,
  };
}

for (const faction of ["HUMAN", "ALIEN"] as const) test(`${faction}01 initializes native source and colony slots without startup expansion`, () => {
  const options = fixture(faction);
  const before = structuredClone(options);
  const session = unwrap(initializeCampaignSession(options));
  const colony = projectLegacyColony(options.source.teams, options.units);
  assert.equal(session.world.entities.length, options.source.placementRows.length + colony.buildings.length);
  assert.deepEqual(session.world.buildingSlots, colony.buildingSlots);
  assert.deepEqual(session.controller.blocks, options.triggers);
  const bytes = session.world.entityBytes!;
  const view = new DataView(bytes.buffer);
  for (const entity of session.world.entities) {
    const offset = entity.rawSlot! * 220;
    assert.equal(bytes[offset + 6], entity.unitType);
    assert.equal(bytes[offset + 7], entity.team);
    assert.equal(view.getUint32(offset + 12, true), entity.health);
    if (entity.sourceRow !== null) {
      assert.equal(entity.rawSlot, 152 + entity.sourceRow);
      const row = options.source.placementRows[entity.sourceRow];
      assert.equal(entity.health, row[4] === -1 ? entity.maxHealth : row[4]);
      assert.deepEqual(entity.rawTail, row.slice(4));
    }
  }
  const host = transportHostState(session.world);
  for (const building of colony.buildings) {
    assert.equal(host.slots[building.nativeId]?.key, `colony:${building.nativeId}`);
    assert.equal(host.ground.includes(building.nativeId), false);
    assert.equal(view.getUint16(building.nativeId * 220, true), building.nativePosition.x);
    assert.equal(view.getUint16(building.nativeId * 220 + 4, true), building.nativePosition.y);
  }
  assert.equal(host.reducer.carriers.length, 0);
  assert.deepEqual(options, before);
});

function advance(session: CampaignSession, count: number) {
  let frame;
  for (let tick = 0; tick < count; tick += 1) frame = unwrap(session.step({ clockMilliseconds: (session.snapshot.cycleCounter + 1) * 16 }));
  return frame!;
}

function idleFixture(): CampaignSessionOptions {
  const original = fixture("HUMAN");
  return { ...original, map: { width: 8, height: 8 },
    units: original.units.filter(({ index }) => index === 0),
    commanders: [{ team: 0, unitType: 0, sprite: original.units.find(({ index }) => index === 0)!.sprite }],
    pathGrid: new Uint8Array(64).fill(1), tags: new Uint8Array(64), triggers: [], messages: [],
    source: { ...original.source, placementRows: [],
      teams: original.source.teams.map((team) => ({ ...team, coordinateRows: [[0, 0], [0, 0]] })) } };
}

test("journal limits preserve detached chronological diagnostics and reset only on direct restore", () => {
  for (const journalLimit of [0, 1, 3, "all"] as const) {
    const session = new CampaignSession({ ...idleFixture(), journalLimit });
    const inputs = Array.from({ length: 9 }, (_, index) => ({ clockMilliseconds: (index + 1) * 16 }));
    for (const input of inputs) {
      const frame = unwrap(session.step(input));
      (frame.entry.fired as number[]).push(999);
    }
    const retained = journalLimit === "all" ? inputs.length : journalLimit;
    const stats = { total: 9, retained, dropped: 9 - retained };
    assert.deepEqual(session.journalStats, stats);
    assert.deepEqual(session.journal.map(({ cycleCounter }) => cycleCounter),
      Array.from({ length: retained }, (_, index) => 10 - retained + index));
    const journal = session.journal;
    if (journal.length) (journal[0].fired as number[]).push(888);
    assert.ok(session.journal.every(({ fired }) => fired.length === 0));
    const before = session.journal;
    assert.equal(session.step({ clockMilliseconds: -1 }).ok, false);
    assert.equal(session.step({ clockMilliseconds: 160, reservations: [{ slot: 799, generation: 0, tileX: 0, tileY: 0 }] }).ok, false);
    assert.deepEqual(session.journal, before);
    assert.deepEqual(session.journalStats, stats);
    const checkpoint = JSON.parse(JSON.stringify(session.checkpoint()));
    assert.equal(checkpoint.options.journalLimit, journalLimit);
    const restored = CampaignSession.restore(checkpoint);
    assert.deepEqual(restored.journalStats, { total: 0, retained: 0, dropped: 0 });
    assert.deepEqual(unwrap(restored.step({ clockMilliseconds: 160 })), unwrap(session.step({ clockMilliseconds: 160 })));
    assert.deepEqual(restored.journalStats, { total: 1, retained: journalLimit === 0 ? 0 : 1, dropped: journalLimit === 0 ? 1 : 0 });
    const migrated = CampaignSession.restore({ schemaVersion: 1, kind: "campaign-session-replay", options: checkpoint.options, inputs });
    assert.deepEqual(migrated.journalStats, stats);
    assert.deepEqual(migrated.journal, before);
    assert.deepEqual(migrated.checkpoint(), checkpoint);
  }
});

test("journal limits reject non-JSON and invalid capacities in constructors and checkpoints", () => {
  const options = idleFixture();
  const checkpoint = new CampaignSession(options).checkpoint();
  for (const journalLimit of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, null, "unlimited"]) {
    assert.throws(() => new CampaignSession({ ...options, journalLimit } as CampaignSessionOptions), /Journal limit/);
    assert.throws(() => CampaignSession.restore({ ...checkpoint, options: { ...checkpoint.options, journalLimit } }));
  }
});

function deliver(session: CampaignSession) {
  for (let tick = 0; tick < 1000; tick += 1) {
    const frame = advance(session, 1);
    const delivered = frame.world.entities.filter((entity) => entity.team === 0 && entity.key.startsWith("transport:"));
    if (delivered.length === 5) return frame;
  }
  assert.fail("Five initial units were not delivered within 1000 native cycles");
}

test("campaign checkpoint reconstructs an in-flight carrier and future journal exactly", () => {
  const session = unwrap(createCampaignSession(fixture("HUMAN")));
  advance(session, 35);
  const checkpoint = session.checkpoint();
  const restored = CampaignSession.restore(JSON.parse(JSON.stringify(checkpoint)));
  assert.deepEqual(restored.snapshot, session.snapshot);
  assert.deepEqual(restored.journal, []);
  for (let tick = 0; tick < 75; tick += 1) assert.deepEqual(advance(restored, 1), advance(session, 1));
  assert.equal(JSON.stringify(restored.checkpoint()), JSON.stringify(session.checkpoint()));
  assert.equal(checkpoint.state.cycleCounter, 35);
  assert.equal("inputs" in checkpoint, false);
  assert.throws(() => CampaignSession.restore({ ...checkpoint, schemaVersion: 99 }), /version/);
  assert.throws(() => CampaignSession.restore({ ...checkpoint,
    options: { ...checkpoint.options, tags: [-1] } }), /integer/);
  assert.throws(() => CampaignSession.restore({ ...checkpoint, inputs: [{ clockMilliseconds: -1 }] }), /unknown field/);
});

test("journal eviction preserves transport identity provenance and checkpoint continuation", () => {
  const session = new CampaignSession({ ...fixture("HUMAN"), journalLimit: 3 });
  deliver(session);
  advance(session, 8);
  assert.equal(session.journal.length, 3);
  assert.equal(session.journal.some(({ requests }) => requests.some(({ type }) => type === "create")), false);
  assert.equal(session.identityProvenance.filter(({ type }) => type === "create").length, 5);
  const restored = CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint())));
  assert.deepEqual(restored.identityProvenance, session.identityProvenance);
  for (let tick = 0; tick < 8; tick += 1) assert.deepEqual(advance(restored, 1), advance(session, 1));
  assert.deepEqual(restored.journal, session.journal);
  assert.deepEqual(restored.journalStats, { total: 8, retained: 3, dropped: 5 });
});

test("failed session inputs do not change direct state and checkpoint arrays are detached", () => {
  const session = unwrap(createCampaignSession(fixture("ALIEN")));
  advance(session, 16);
  const saved = session.checkpoint();
  assert.equal(session.step({ clockMilliseconds: -1 }).ok, false);
  assert.deepEqual(session.checkpoint(), saved);
  const copy = JSON.parse(JSON.stringify(session.checkpoint()));
  copy.options.tags.fill(0);
  copy.state.world.clockMilliseconds = 999;
  assert.deepEqual(session.checkpoint(), saved);
  const restored = CampaignSession.restore(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored.snapshot, session.snapshot);
});

test("schema 1 remains readable and migrates to direct schema 2 on the next save", () => {
  const session = unwrap(createCampaignSession(fixture("HUMAN")));
  const inputs = Array.from({ length: 35 }, (_, index) => ({ clockMilliseconds: (index + 1) * 16 }));
  for (const input of inputs) unwrap(session.step(input));
  const legacy = { schemaVersion: 1, kind: "campaign-session-replay", options: session.checkpoint().options, inputs };
  const restored = CampaignSession.restore(JSON.parse(JSON.stringify(legacy)));
  assert.deepEqual(restored.snapshot, session.snapshot);
  assert.deepEqual(restored.journal, session.journal);
  assert.deepEqual(restored.checkpoint(), session.checkpoint());
  assert.equal(restored.checkpoint().schemaVersion, 2);
});

test("direct checkpoint rejects corrupt native slots, source profiles, controllers and unknown fields", () => {
  const session = unwrap(createCampaignSession(fixture("HUMAN")));
  advance(session, 35);
  const saved = session.checkpoint();
  const reject = (edit: (copy: any) => void) => {
    const copy = JSON.parse(JSON.stringify(saved));
    edit(copy);
    assert.throws(() => CampaignSession.restore(copy));
    assert.deepEqual(session.checkpoint(), saved);
  };
  reject((copy) => { copy.state.world.transportState.slots[152].generation += 1; });
  reject((copy) => { copy.state.world.transportState.registry[152] = "wrong"; });
  reject((copy) => { copy.state.world.transportState.slots[152].unknown = true; });
  reject((copy) => { copy.state.world.transportState.highWater = 152; });
  reject((copy) => { copy.state.world.entityBytes.pop(); });
  reject((copy) => { copy.state.world.entityBytes[152 * 220 + 6] = 109; });
  reject((copy) => { copy.state.world.transportState.definitions[0].health += 1; });
  reject((copy) => { copy.state.world.transportState.ground[0] = 152; });
  reject((copy) => { copy.state.controller.blocks[0].condition = "1"; });
  reject((copy) => { copy.state.controller.runtime.lives[0] = 256; });
  reject((copy) => { copy.state.world.entities[0].maxHealth += 1; });
  reject((copy) => { copy.state.controller.runtime.statistics["0,3"] += 1; });
  reject((copy) => { copy.options.unknown = true; });
  reject((copy) => { copy.options.units[0].unknown = true; });
  assert.throws(() => CampaignSession.restore({ ...saved, get state() { throw new Error("must not execute"); } }), /data property/);
});

test("20k idle ticks bound live history, keep direct save size constant and restore never calls step", (context) => {
  const session = new CampaignSession(idleFixture());
  const samples: { tick: number; bytes: number; restoreMilliseconds: number }[] = [];
  const start = performance.now();
  for (let tick = 1; tick <= 20000; tick += 1) {
    unwrap(session.step({ clockMilliseconds: tick * 16 }));
    if (![220, 1000, 20000].includes(tick)) continue;
    const json = JSON.stringify(session.checkpoint());
    const saved = JSON.parse(json);
    const step = CampaignSession.prototype.step;
    let restored: CampaignSession;
    const before = performance.now();
    try {
      CampaignSession.prototype.step = () => { throw new Error("direct restore must not replay"); };
      restored = CampaignSession.restore(saved);
    } finally { CampaignSession.prototype.step = step; }
    samples.push({ tick, bytes: Buffer.byteLength(json), restoreMilliseconds: performance.now() - before });
    assert.deepEqual(restored!.snapshot, session.snapshot);
    assert.deepEqual(restored!.journal, []);
    assert.deepEqual(restored!.journalStats, { total: 0, retained: 0, dropped: 0 });
    assert.deepEqual(session.journalStats, { total: tick, retained: Math.min(tick, 4096), dropped: Math.max(0, tick - 4096) });
    if (tick === 20000) for (let update = 1; update <= 100; update += 1) {
      const input: { clockMilliseconds: number } = { clockMilliseconds: (tick + update) * 16 };
      assert.deepEqual(unwrap(restored!.step(input)), unwrap(session.step(input)));
    }
  }
  assert.ok(samples[2].bytes - samples[1].bytes < 128, JSON.stringify(samples));
  assert.ok(samples[2].bytes < 2 * 1024 * 1024);
  assert.deepEqual(session.journalStats, { total: 20100, retained: 4096, dropped: 16004 });
  assert.deepEqual(session.journal.map(({ cycleCounter, clockMilliseconds }) => [cycleCounter, clockMilliseconds]),
    Array.from({ length: 4096 }, (_, index) => [16005 + index, (16005 + index) * 16]));
  context.diagnostic(JSON.stringify({ samples, journalStats: session.journalStats, totalMilliseconds: performance.now() - start }));
});

test("source session retention at 1000 and 10000 frames", { skip: process.env.DC_SESSION_RETENTION !== "1" }, (context) => {
  const session = new CampaignSession(fixture("HUMAN"));
  const start = performance.now();
  for (let tick = 1; tick <= 10000; tick += 1) {
    unwrap(session.step({ clockMilliseconds: tick * 16 }));
    if (tick !== 1000 && tick !== 10000) continue;
    globalThis.gc?.();
    const heapUsed = process.memoryUsage().heapUsed;
    const journal = session.journal;
    const snapshot = session.snapshot;
    const host = transportHostState(snapshot.world);
    assert.deepEqual(session.journalStats, { total: tick, retained: Math.min(tick, 4096), dropped: Math.max(0, tick - 4096) });
    assert.deepEqual(journal.map(({ cycleCounter }) => cycleCounter),
      Array.from({ length: Math.min(tick, 4096) }, (_, index) => Math.max(1, tick - 4095) + index));
    context.diagnostic(JSON.stringify({ tick, journalStats: session.journalStats,
      journalBytes: Buffer.byteLength(JSON.stringify(journal)), checkpointBytes: Buffer.byteLength(JSON.stringify(session.checkpoint())),
      heapUsed, explicitGc: typeof globalThis.gc === "function", hostRequests: host.requests.length,
      hostReceipts: host.receipts.length, identityEvents: session.identityProvenance.length,
      messages: snapshot.world.messages.length, productionJournal: snapshot.production?.journal.length ?? null,
      elapsedMilliseconds: performance.now() - start }));
  }
});

for (const faction of ["HUMAN", "ALIEN"] as const) test(`${faction}01 starts through a real carrier and delivers five source units over time`, () => {
  const options = fixture(faction);
  const session = unwrap(createCampaignSession(options));
  const initial = session.snapshot;
  assert.equal(advance(session, 8).entry.commands.length, 0);
  assert.equal(advance(session, 7).world.messages.length, 0);
  const startup = advance(session, 1);
  assert.equal(startup.cycleCounter, 16);
  assert.equal(startup.world.messages[0].messageId, 1);
  assert.equal(startup.world.messages[0].clockMilliseconds, 256);
  assert.deepEqual(startup.entry.messages, startup.world.messages);
  assert.equal(startup.world.entities.filter((entity) => entity.team === 0 && entity.key.startsWith("transport:")).length, 0);
  assert.equal(transportHostState(startup.world).reducer.carriers.length, 1);
  if (faction === "ALIEN") {
    const direct = startup.world.entities.filter((entity) => entity.key.startsWith("transport:"));
    assert.deepEqual(direct.map(({ team, unitType }) => [team, unitType]), [[1, 69]]);
    assert.equal(startup.entry.requests.filter(({ type }) => type === "create").length, 1);
  }
  const delivered = deliver(session);
  const troops = delivered.world.entities.filter((entity) => entity.team === 0 && entity.key.startsWith("transport:"));
  assert.deepEqual(troops.map(({ unitType }) => unitType).sort((left, right) => left - right),
    faction === "HUMAN" ? [0, 0, 0, 0, 69] : [8, 8, 8, 8, 73]);
  assert.ok(session.journal.filter(({ requests }) => requests.some(({ type }) => type === "create")).length > 1);
  assert.ok(delivered.world.commanderSlots[0] >= 152);
  for (const entity of initial.world.entities) {
    assert.ok(delivered.world.entities.some(({ key, rawSlot }) => key === entity.key && rawSlot === entity.rawSlot), `Lost source entity ${entity.key}`);
  }
  assert.deepEqual(delivered.controller.blocks, options.triggers);
});

test("explicit HUMAN01 trip-7 reservation preserves beacon team and synchronizes newtype through later host ticks", () => {
  const session = unwrap(createCampaignSession(fixture("HUMAN")));
  const initial = deliver(session);
  const soldier = initial.world.entities.find((entity) => entity.team === 0 && entity.unitType === 0)!;
  const beacon = initial.world.entities.find((entity) => entity.tileX === 26 && entity.tileY === 59)!;
  const movementOnly = unwrap(session.step({ clockMilliseconds: 3000, updates: [{ type: "position", slot: soldier.rawSlot!,
    generation: soldier.generation, position: { x: 25 * 256 + 128, y: 59 * 256 + 128 } }] }));
  assert.equal(movementOnly.controller.runtime.lives[7], 1);
  assert.equal(movementOnly.world.entities.find(({ key }) => key === beacon.key)!.unitType, 95);
  const tripped = unwrap(session.step({ clockMilliseconds: 3016, reservations: [{ slot: soldier.rawSlot!, generation: soldier.generation, tileX: 25, tileY: 59 }] }));
  assert.deepEqual(tripped.entry.fired, [7]);
  assert.ok(tripped.entry.trace.some(({ action }) => action.name === "setlifes"));
  assert.equal(tripped.controller.runtime.lives[4], 1);
  assert.equal(tripped.controller.runtime.lives[7], 0);
  const after = advance(session, 3);
  const changed = after.world.entities.find(({ key }) => key === beacon.key)!;
  assert.equal(changed.unitType, 84);
  assert.equal(changed.team, beacon.team);
  assert.equal(after.world.entityBytes![beacon.rawSlot! * 220 + 6], 84);
  assert.equal(transportHostState(after.world).slots[beacon.rawSlot!]!.unitType, 84);
  assert.equal(after.world.messages.at(-1)!.messageId, 4);
});

test("ALIEN01 eleven objective losses schedule real commander pickup and clock-injected bail", () => {
  const session = unwrap(createCampaignSession(fixture("ALIEN")));
  const initial = deliver(session);
  const objectives = initial.world.entities.filter(({ team, unitType }) => team === 1 && unitType === 82);
  assert.equal(objectives.length, 11);
  const updates = objectives.map((entity) => ({ type: "combat-death" as const, slot: entity.rawSlot!, generation: entity.generation }));
  const dead = unwrap(session.step({ clockMilliseconds: 4000, updates }));
  assert.equal(dead.controller.runtime.statistics["1,0,82"], 11);
  assert.equal(dead.controller.runtime.statistics["1,3"], 11);
  assert.equal(dead.controller.runtime.statistics["1,1,82"], 11);
  const duplicate = unwrap(session.step({ clockMilliseconds: 4000, updates }));
  assert.equal(duplicate.controller.runtime.statistics["1,3"], 11);
  let frame = duplicate;
  while (frame.cycleCounter % 8 !== 0) frame = unwrap(session.step({ clockMilliseconds: 4000 }));
  assert.deepEqual(frame.controller.runtime.bail, { resultCode: 0, reasonCode: 1, deadlineMilliseconds: 14000 });
  assert.ok(session.journal.some(({ commands }) => commands.some(({ command }) => command.kind === "abduct")));
  assert.ok(transportHostState(frame.world).reducer.carriers.length >= 2);
  const unregistered = unwrap(session.step({ clockMilliseconds: 14000, updates: objectives.map((entity) => ({
    type: "complete-removal", slot: entity.rawSlot!, generation: entity.generation })) }));
  assert.equal(unregistered.controller.runtime.statistics["1,1,82"], 0);
  assert.equal(unregistered.controller.runtime.statistics["1,3"], 11);
  assert.equal(unregistered.bailExpired, false);
  assert.equal(unwrap(session.step({ clockMilliseconds: 14001 })).bailExpired, true);
});

test("ordered resumption observes real reinforce2 census and newtype, retaining setlifes and bail", () => {
  const options = fixture("HUMAN");
  const triggers = parseTriggerScript(`
3 norm 0 (s(1,1,84)==1)
bail 0 1
end
2 norm 1 (s(1,1,69)==1)
newtype 26 59 84
end
1 norm 1 (c>0)
reinforce2 1 66 67 69 1 0 0 0 0 0 0 0 0
setlifes 3 1
end
`);
  const session = unwrap(createCampaignSession({ ...options, triggers }));
  const initial = session.snapshot;
  const pending = planMissionStep(initial.controller, { cycleCounter: 16, clockMilliseconds: 256,
    buildingSlots: initial.world.buildingSlots }, { kind: "normal" });
  assert.equal(pending.pendingEvaluation?.triggerId, 2);
  const frame = advance(session, 16);
  assert.deepEqual(frame.entry.fired, [1, 2, 3]);
  assert.deepEqual(frame.entry.trace.map(({ action }) => action.name), ["setlifes", "reinforce2", "newtype", "bail"]);
  assert.equal(frame.controller.runtime.statistics["1,1,84"], 1);
  assert.equal(frame.controller.runtime.bail?.resultCode, 0);
  assert.deepEqual(frame.controller.blocks, triggers);
});

test("same-block source actions refresh census and retain arrays without repeating reinforcement", () => {
  const options = fixture("HUMAN");
  const triggers = parseTriggerScript(`1 norm 1 (c>0)
setarray 2 (s(1,1,84))
newtype 26 59 84
setarray 1 (s(1,1,69))
reinforce2 1 66 67 69 1 0 0 0 0 0 0 0 0
setarray 0 (s(0,2,0)+1)
setarray 3 (s(1,1,69))
exomoney 0 17
msg 2 0 1 3 8
end
2 norm 1 (s(1,1,84)==1)
bail 0 1
end`);
  const session = new CampaignSession({ ...options, triggers });
  advance(session, 15);
  const before = session.snapshot;
  const frame = advance(session, 1);
  assert.deepEqual(frame.entry.fired, [1, 2]);
  assert.deepEqual(frame.entry.trace.map(({ action }) => action.name),
    ["msg", "exomoney", "setarray", "setarray", "reinforce2", "setarray", "newtype", "setarray", "bail"]);
  assert.equal(frame.world.exomoney[0], 17);
  assert.equal(frame.entry.messages.length, 1);
  assert.equal(frame.world.entities.length, before.world.entities.length + 1);
  assert.equal(frame.entry.requests.filter(({ type }) => type === "create").length, 1);
  for (const index of [0, 1, 2]) {
    assert.equal(frame.controller.runtime.statistics[`0,2,${index}`], 1);
    assert.equal(frame.world.statistics[`0,2,${index}`], 1);
  }
  assert.equal(frame.controller.runtime.statistics["1,1,84"], 1);
  assert.equal(frame.world.statistics["0,2,3"], 0);
  assert.deepEqual(frame.controller.runtime.lives, { 1: 0, 2: 0 });
  assert.equal(frame.controller.revision, before.controller.revision + 1);
  assert.deepEqual(frame.entry.commands.map(({ id }) => id),
    [7, 6, 3, 1].map((index) => `${before.controller.revision}:1:${index}`));
  assert.deepEqual(frame.entry.receipts.map(({ commandId }) => commandId), frame.entry.commands.map(({ id }) => id));
  const next = advance(session, 8);
  assert.equal(next.world.entities.length, frame.world.entities.length);
  assert.deepEqual(next.entry.fired, []);
  assert.equal(next.world.statistics["0,2,2"], 1);
});

test("batched movement supports swaps and rejects a stale update atomically", () => {
  const session = unwrap(createCampaignSession(fixture("HUMAN")));
  const initial = session.snapshot;
  const host = transportHostState(initial.world);
  const soldiers = initial.world.entities.filter(({ unitType }) => unitType === 8).slice(0, 2);
  const updates = soldiers.map((entity, index) => ({ type: "position" as const, slot: entity.rawSlot!, generation: entity.generation,
    position: host.slots[soldiers[1 - index].rawSlot!]!.position }));
  const swapped = unwrap(session.step({ clockMilliseconds: 16, updates }));
  for (const update of updates) assert.deepEqual(transportHostState(swapped.world).slots[update.slot]!.position, update.position);
  const before = session.snapshot;
  const journal = session.journal;
  const rejected = session.step({ clockMilliseconds: 32, updates: [...updates, { ...updates[0], generation: 99 }] });
  assert.equal(rejected.ok, false);
  assert.deepEqual(session.snapshot, before);
  assert.deepEqual(session.journal, journal);
});

test("commander mapping is required and checked against the source definition", () => {
  const options = fixture("ALIEN");
  assert.equal(createCampaignSession({ ...options, commanders: [] }).ok, false);
  assert.equal(createCampaignSession({ ...options, commanders: [{ team: 0, unitType: 73, sprite: "TRSC" }] }).ok, false);
});

test("removing a static source entity frees its slot for mobile host allocation", () => {
  const options = fixture("ALIEN");
  const session = unwrap(createCampaignSession(options));
  const initial = session.snapshot;
  const target = initial.world.entities.filter(({ unitType }) => unitType === 82).at(-1)!;
  const reference = { slot: target.rawSlot!, generation: target.generation };
  unwrap(session.step({ clockMilliseconds: 16, updates: [{ type: "combat-death", ...reference }] }));
  const removed = unwrap(session.step({ clockMilliseconds: 32, updates: [{ type: "complete-removal", ...reference }] }));
  assert.equal(removed.staticSlots.includes(reference.slot), false);
  const startup = advance(session, 14);
  const replacement = startup.world.entities.find(({ rawSlot }) => rawSlot === reference.slot)!;
  assert.equal(replacement.unitType, 69);
  assert.equal(replacement.generation, reference.generation + 1);
  assert.equal(startup.controller.runtime.statistics["1,0,82"], 1);
  assert.equal(session.step({ clockMilliseconds: 300, updates: [{ type: "combat-death", ...reference }] }).ok, false);
});

test("identical inputs replay deterministically and source/snapshot edits cannot mutate session ownership", () => {
  const options = fixture("ALIEN");
  const first = unwrap(createCampaignSession(options));
  const second = unwrap(createCampaignSession(options));
  options.pathGrid.fill(0);
  const detached = first.snapshot;
  detached.world.entityBytes!.fill(0);
  for (let tick = 1; tick <= 16; tick += 1) {
    assert.deepEqual(unwrap(first.step({ clockMilliseconds: tick * 91 })), unwrap(second.step({ clockMilliseconds: tick * 91 })));
  }
  assert.deepEqual(first.journal, second.journal);
});

test("unsupported source actions retain exact diagnostics and roll back the whole tick", () => {
  const options = fixture("ALIEN");
  const triggers = [...options.triggers, { id: 127, flag: 1, mode: "norm", condition: "(c>0)", actions: [{ name: "unknown", arguments: [] }] }];
  const session = unwrap(createCampaignSession({ ...options, triggers }));
  advance(session, 15);
  const before = session.snapshot;
  const result = session.step({ clockMilliseconds: 256 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.diagnostics.map(({ code, triggerId, actionIndex }) => ({ code, triggerId, actionIndex })),
    [{ code: "unsupported-action", triggerId: 127, actionIndex: 0 }]);
  assert.deepEqual(session.snapshot, before);
  assert.equal(session.journal.length, 15);
});
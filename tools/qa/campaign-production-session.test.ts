import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CampaignSession, createCampaignSession, type CampaignSessionInput, type CampaignSessionOptions } from "../../src/engine/campaign-session.ts";
import { createCampaignProduction, reduceCampaignProduction, type ProductionSourceProfile, type ProductionUnitSource } from "../../src/engine/campaign-production.ts";
import { projectLegacyColony } from "../../src/engine/legacy-colony.ts";
import { transportHostState, type ResourceHostOptions, type ResourceHostBinding } from "../../src/engine/transport-host.ts";
import type { TriggerResult } from "../../src/engine/trigger-runtime.ts";
import { finSourceDuration } from "../../src/render/fin-animation.ts";
import { parseFin } from "../extractors/animations/fin.ts";
import { parseDependencies, parseUnitStats, parseWeaponStats } from "../extractors/data/tables.ts";
import { parseScenario } from "../extractors/data/scenario.ts";
import { parseTriggerScript } from "../extractors/data/triggers.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url));
const units = parseUnitStats(read("GAMESTAT/GAMESTAT.TXT").toString());
const weapons = parseWeaponStats(read("GAMESTAT/WEAPSTAT.TXT").toString());
const records = parseDependencies(read("GAMESTAT/DEPEND.TXT").toString());
const native = JSON.parse(process.env.DC_PRODUCTION_SESSION_TRACE ? readFileSync(process.env.DC_PRODUCTION_SESSION_TRACE, "utf8")
  : execFileSync("python3", ["tools/qa/campaign-production-session-native.py"], { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: [process.env.PYTHONPATH, "/tmp/dc-re-capstone-20260918", "/tmp/dc-trigger-unicorn-20260918"].filter(Boolean).join(":") } })) as {
      sha256: string; units: ProductionUnitSource[]; cases: { profile: ProductionSourceProfile; source: { source: string; name: string; delays: number[]; sourceField2: number[] };
        trace: { frame: number; delay: number; mode: number; ready: number; producerDelay: number; count: number; credits: number; accounting: number }[] }[];
    };

function unwrap<Value>(result: TriggerResult<Value>): Value {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("Expected production session success");
  return result.value;
}

function fixture(race: 0 | 1 = 0, placementRows: number[][] = []): CampaignSessionOptions {
  const original = parseScenario(read("SCENARIO/HUMAN/HUMAN02.SCN").toString());
  const source = { ...original, placementRows, teams: original.teams.map((team) => ({ ...team, race,
    money: 1000, coordinateRows: [[0, 0], team.index === 1 ? [50, 50] : [0, 0]] as const,
    cityRows: [[1, -1, 1, -1, 0, 0, 0, 0, 0, 0]] })) };
  const colony = projectLegacyColony(source.teams, units);
  return {
    sessionId: `production-session:${race}`, source, units, weapons, triggers: [], messages: [],
    map: { width: 128, height: 128 }, pathGrid: new Uint8Array(128 * 128).fill(1), tags: new Uint8Array(128 * 128),
    commanders: [{ team: 1, unitType: race === 0 ? 69 : 73, sprite: race === 0 ? "TRSC" : "GRAY" }],
    directionBits: Array.from({ length: 64 }, () => [0, 0] as const), fixedStepMilliseconds: 16, orientationSteps: 1,
    production: { records, units: native.units,
    sourceProfiles: [native.cases[race].profile], teams: [{ team: 1, race, credits: 1000, costAccumulator: 0,
      base: { x: 50, y: 50 }, slots: Array.from({ length: 5 }, (_, slot) => {
        const projected = colony.slots.find((entry) => entry.nativeId === 15 + slot)!;
        return { health: projected.health, level: projected.upgradeLevel, busy: 0 as const };
      }), restrictions: [], upgrades: [], producerDelays: [0, 0, 0, 0] }] },
  };
}

function dependency(race: 0 | 1): number {
  return records.find((entry) => entry.rawFields[0] === 1 && entry.rawFields[1] === (race === 0 ? 0 : 8))!.id;
}

function commands(race: 0 | 1 = 0): NonNullable<CampaignSessionInput["productionCommands"]> {
  return [{ id: "buy", team: 1, action: { type: "reserve", dependency: dependency(race) } },
    { id: "dispatch", team: 1, action: { type: "dispatch", dependency: dependency(race) } }];
}

function input(session: CampaignSession, extra: Partial<CampaignSessionInput> = {}): CampaignSessionInput {
  return { clockMilliseconds: (session.snapshot.cycleCounter + 1) * 16,
    productionVisits: [{ team: 1, queue: 0, population: 0, populationLimit: 10 }], ...extra };
}

function reject(session: CampaignSession, extra: Partial<CampaignSessionInput>, pattern: RegExp) {
  const checkpoint = session.checkpoint();
  const snapshot = session.snapshot;
  const journal = session.journal;
  const result = session.step(input(session, extra));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(JSON.stringify(result.diagnostics), pattern);
  assert.deepEqual(session.checkpoint(), checkpoint);
  assert.deepEqual(session.snapshot, snapshot);
  assert.deepEqual(session.journal, journal);
}

test("original FIN decoder duration and +0x98 profiles match x86 for every direction", () => {
  assert.equal(native.sha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  assert.equal(createHash("sha256").update(read("DC.EXE")).digest("hex"), native.sha256);
  for (const entry of native.cases) {
    const bytes = readFileSync(new URL(`../../${entry.source.source}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.profile.finSha256);
    const decoded = parseFin(bytes);
    const selected = decoded.states.find((state) => state.name === entry.profile.id)!;
    assert.equal(selected.validRange, true);
    const fields = decoded.timeline.slice(selected.firstTimelineIndex, selected.lastTimelineIndex + 1).map((frame) => frame.field2);
    assert.deepEqual(fields, entry.source.sourceField2);
    assert.deepEqual(fields.map(finSourceDuration), entry.source.delays);
    for (const timeline of entry.profile.directions) assert.deepEqual(timeline, entry.source.delays);
  }
});

for (const race of [0, 1] as const) test(`race ${race}: native-clock transaction, exact slot spawn and mid-animation JSON replay`, () => {
  const options = fixture(race);
  const session = unwrap(createCampaignSession(options));
  const before = structuredClone(options);
  let frame = unwrap(session.step(input(session, { productionCommands: commands(race) })));
  const cost = records.find((entry) => entry.id === dependency(race))!.cost;
  assert.equal(frame.production!.teams[0].credits, 1000 - cost);
  assert.equal(frame.world.exomoney[1], 1000 - cost);
  assert.equal(frame.production!.teams[0].costAccumulator, cost);
  assert.equal(transportHostState(frame.world).ground[47 * 128 + 50], 1022);
  assert.equal(transportHostState(frame.world).productionExits!.length, 1);
  assert.equal(Object.isFrozen(frame.production!.teams[0].queues[0]), true);
  let restored: CampaignSession | undefined;
  for (let index = 0; index < native.cases[race].trace.length; index += 1) {
    if (index > 0) {
      const next = input(session);
      frame = unwrap(session.step(next));
      if (restored) assert.deepEqual(unwrap(restored.step(next)), frame);
    }
    const expected = native.cases[race].trace[index];
    const queue = frame.production!.teams[0].queues[0];
    assert.deepEqual([queue.animation!.frame, queue.animation!.delay, queue.animation!.mode, queue.ready, queue.items.length],
      [expected.frame, expected.delay, expected.mode, expected.ready, expected.count]);
    if (index === 7) {
      restored = CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint())));
      assert.deepEqual(restored.snapshot, session.snapshot);
      assert.deepEqual(restored.journal, []);
    }
  }
  const created = frame.entry.requests.filter((request) => request.type === "create");
  assert.equal(created.length, 1);
  assert.deepEqual(created[0], { type: "create", slot: 152, generation: 0, team: 1, unitType: race === 0 ? 0 : 8,
    position: { x: 50 * 256 + 128, y: 47 * 256 + 128 } });
  assert.equal(transportHostState(frame.world).ground[47 * 128 + 50], 152);
  assert.deepEqual(transportHostState(frame.world).productionExits, []);
  assert.deepEqual(frame.entry.productionRequests!.map((request) => request.type), ["allocate-unit", "unit-allocated"]);
  assert.equal(frame.production!.teams[0].costAccumulator, cost);
  assert.equal(frame.world.exomoney[1], 1000 - cost);
  assert.deepEqual(options, before);
  const checkpoint = JSON.parse(JSON.stringify(session.checkpoint()));
  checkpoint.state.production.teams[0].credits += 1;
  assert.throws(() => CampaignSession.restore(checkpoint), /production state/);
  const missing = JSON.parse(JSON.stringify(session.checkpoint()));
  delete missing.state.production;
  assert.throws(() => CampaignSession.restore(missing), /saved native production state/);
});

test("direct production snapshot pins profiles and retains input command deduplication", () => {
  const session = new CampaignSession(fixture());
  unwrap(session.step(input(session, { productionCommands: commands() })));
  for (let count = 0; count < 7; count += 1) unwrap(session.step(input(session)));
  const saved = session.checkpoint();
  const restored = CampaignSession.restore(JSON.parse(JSON.stringify(saved)));
  const repeated = input(session, { productionCommands: commands() });
  assert.deepEqual(unwrap(restored.step(repeated)), unwrap(session.step(repeated)));
  const corruptions = [
    (copy: any) => { copy.state.production.sourceProfiles[0].directions[0][0] += 1; },
    (copy: any) => { copy.options.production.sourceProfiles[0].finSha256 = "wrong"; },
    (copy: any) => { copy.state.production.teams[0].queues[0].animation.profile = "wrong"; },
    (copy: any) => { copy.state.production.teams[0].queues[0].activeTicket = "wrong"; },
    (copy: any) => { copy.state.world.transportState.productionExits[0].ticket = "wrong"; },
    (copy: any) => { copy.state.production.teams[0].queues[0].items[0].unitType = 109; },
  ];
  for (const edit of corruptions) {
    const copy = JSON.parse(JSON.stringify(saved)); edit(copy);
    assert.throws(() => CampaignSession.restore(copy));
  }
});

test("20k idle producer visits retain bounded bookkeeping and checkpoint size", (context) => {
  const options = fixture();
  const session = new CampaignSession({ ...options, map: { width: 16, height: 16 },
    pathGrid: new Uint8Array(256).fill(1), tags: new Uint8Array(256),
    source: { ...options.source, teams: options.source.teams.map((team) => ({ ...team,
      coordinateRows: [[0, 0], team.index === 1 ? [8, 8] : [0, 0]] })) },
    production: { ...options.production!, teams: options.production!.teams.map((team) => ({ ...team, base: { x: 8, y: 8 } })) } });
  const samples: { tick: number; bytes: number; restoreMilliseconds: number }[] = [];
  const start = performance.now();
  for (let tick = 1; tick <= 20000; tick += 1) {
    unwrap(session.step({ clockMilliseconds: tick * 16, productionVisits: [{ team: 1, queue: 0, population: 0, populationLimit: 10 }] }));
    if (tick !== 1000 && tick !== 20000) continue;
    const json = JSON.stringify(session.checkpoint()), saved = JSON.parse(json);
    const before = performance.now();
    const restored = CampaignSession.restore(saved);
    samples.push({ tick, bytes: Buffer.byteLength(json), restoreMilliseconds: performance.now() - before });
    assert.deepEqual(restored.snapshot, session.snapshot);
    assert.equal(restored.snapshot.production!.journal.length, 0);
  }
  assert.ok(samples[1].bytes - samples[0].bytes < 128, JSON.stringify(samples));
  context.diagnostic(JSON.stringify({ samples, totalMilliseconds: performance.now() - start }));
});

test("occupied exit waits before cap refund, clears blocker +35 and preserves unrelated movement", () => {
  const session = unwrap(createCampaignSession(fixture(0, [[50, 47, 0, 1, -1]])));
  const cap = [{ team: 1, queue: 0 as const, population: 10, populationLimit: 10 }];
  const blocked = unwrap(session.step(input(session, { productionCommands: commands(), productionVisits: cap })));
  assert.equal(blocked.production!.teams[0].queues[0].items.length, 1);
  assert.equal(blocked.production!.teams[0].credits, 650);
  assert.equal(blocked.world.entityBytes![152 * 220 + 0x35], 0);
  const refunded = unwrap(session.step(input(session, { productionVisits: cap, updates: [
    { type: "position", slot: 152, generation: 0, position: { x: 51 * 256 + 128, y: 47 * 256 + 128 } },
  ] })));
  assert.equal(refunded.production!.teams[0].queues[0].items.length, 0);
  assert.equal(refunded.production!.teams[0].credits, 1000);
  assert.equal(refunded.production!.teams[0].costAccumulator, 0);
  assert.equal(refunded.world.exomoney[1], 1000);
  assert.deepEqual(refunded.entry.productionRequests!.map((request) => request.type), ["population-message"]);
  assert.equal(refunded.entry.requests.some((request) => request.type === "create"), false);
});

test("native delay 1 expires and starts in the same visit; active reservation survives occupancy rebuild", () => {
  const options = fixture(0, [[55, 47, 0, 1, -1]]);
  const configured = { ...options, production: { ...options.production!, teams: options.production!.teams.map((team) =>
    ({ ...team, producerDelays: [1, 0, 0, 0] })) } };
  const session = unwrap(createCampaignSession(configured));
  unwrap(session.step(input(session, { productionCommands: commands() })));
  const moved = unwrap(session.step(input(session, { updates: [{ type: "position", slot: 152, generation: 0,
    position: { x: 56 * 256 + 128, y: 47 * 256 + 128 } }] })));
  assert.equal(transportHostState(moved.world).ground[47 * 128 + 50], 1022);
  reject(session, { updates: [{ type: "position", slot: 152, generation: 0,
    position: { x: 50 * 256 + 128, y: 47 * 256 + 128 } }] }, /Occupied/);
});

test("profile rejection precedes costs; source clock rejects callbacks and failed inputs never commit", () => {
  const options = fixture();
  const altered = structuredClone(options);
  (altered.production!.sourceProfiles[0].directions[0] as number[])[1] = 2;
  assert.equal(createCampaignSession(altered).ok, false);
  const session = unwrap(createCampaignSession(options));
  reject(session, { productionCommands: [{ id: "unverified", team: 1, action: { type: "reserve", dependency: 7 } }] }, /validated native source production profile/);
  reject(session, { productionCommands: [{ id: "fake", team: 1,
    action: { type: "producer-completed", queue: 0, ticket: "fake", animationMode: 2 } }] } as unknown as CampaignSessionInput, /rejects native production callbacks/);
  reject(session, { productionVisits: undefined }, /native census/);
  reject(session, { productionCommands: commands(), productionVisits: [{ team: 1, queue: 0, population: -1, populationLimit: 10 }] }, /native census/);
  const saved = JSON.parse(JSON.stringify(session.checkpoint()));
  saved.state.production.fabricatedComplete = true;
  assert.throws(() => CampaignSession.restore(saved), /unknown field/);
});

test("ordered feedback commits production credits only after every action succeeds", () => {
  for (const invalidLastAction of [true, false]) {
    const options = fixture();
    const session = new CampaignSession({ ...options, messages: [{ id: 1, text: "Ordered feedback" }],
      triggers: parseTriggerScript(`1 norm 1 (c==0)
${invalidLastAction ? "msg 2 0 29 3 8" : ""}
setarray 1 (s(1,1,0))
reinforce2 1 60 60 0 1 0 0 0 0 0 0 0 0
setlifes 1 0
bail 0 1
exomoney 1 17
msg 2 0 1 3 8
end`) });
    for (let tick = 1; tick < 8; tick += 1) unwrap(session.step(input(session)));
    if (invalidLastAction) {
      const before = session.snapshot;
      reject(session, { productionCommands: commands() }, /Missing message 29/);
      const result = session.step(input(session, { productionCommands: commands() }));
      assert.equal(result.ok, false);
      if (!result.ok) assert.deepEqual([result.diagnostics[0].triggerId, result.diagnostics[0].actionIndex], [1, 0]);
      assert.deepEqual(session.snapshot, before);
      assert.equal(session.snapshot.production!.teams[0].credits, 1000);
      assert.equal(session.snapshot.controller.runtime.lives[1], 1);
      assert.equal(session.snapshot.controller.runtime.bail, null);
    } else {
      const frame = unwrap(session.step(input(session, { productionCommands: commands() })));
      assert.equal(frame.production!.teams[0].credits, 17);
      assert.equal(frame.world.exomoney[1], 17);
      assert.equal(frame.world.statistics["0,2,1"], 1);
      assert.equal(frame.controller.runtime.lives[1], 255);
      assert.equal(frame.controller.runtime.bail!.reasonCode, 1);
      assert.equal(frame.entry.messages.length, 1);
      assert.equal(frame.entry.requests.filter(({ type }) => type === "create").length, 1);
    }
  }
});

test("full32 checked economy synchronization preserves pending reservations and cost accumulator", () => {
  const options = fixture();
  let state = createCampaignProduction({ ...options.production!, sessionId: options.sessionId });
  state = reduceCampaignProduction(state, { id: "reserve", team: 1, action: { type: "reserve", dependency: 9 } });
  const reserved = state;
  state = reduceCampaignProduction(state, { id: "income", team: 1,
    action: { type: "sync-credits", expectedPreviousCredits: 650, credits: 65536 } });
  assert.equal(state.teams[0].credits, 65536);
  assert.deepEqual(state.teams[0].pending, reserved.teams[0].pending);
  assert.equal(state.teams[0].costAccumulator, 0);
  assert.throws(() => reduceCampaignProduction(state, { id: "stale", team: 1,
    action: { type: "sync-credits", expectedPreviousCredits: 650, credits: 1 } }), /Stale/);
  state = reduceCampaignProduction(state, { id: "wrapped", team: 1,
    action: { type: "sync-credits", expectedPreviousCredits: 65536, credits: -2147483648 } });
  state = reduceCampaignProduction(state, { id: "release", team: 1, action: { type: "release-pending", dependency: 9 } });
  assert.equal(state.teams[0].credits, -2147483298);
  assert.equal(state.teams[0].pending[9], 0);
});

test("slot exhaustion rolls back completion without cap refund and retries after real slot release", () => {
  const rows = Array.from({ length: 647 }, (_, index) => [5 + index % 30, 5 + Math.floor(index / 30), 0, 1, -1]);
  const session = unwrap(createCampaignSession(fixture(0, rows)));
  unwrap(session.step(input(session, { productionCommands: commands() })));
  for (let update = 1; update < native.cases[0].trace.length - 1; update += 1) unwrap(session.step(input(session)));
  const fullPopulation = [{ team: 1, queue: 0 as const, population: 10, populationLimit: 10 }];
  reject(session, { productionVisits: fullPopulation }, /high-water assertion/);
  assert.equal(session.snapshot.production!.teams[0].credits, 650);
  assert.equal(session.snapshot.production!.teams[0].costAccumulator, 350);
  assert.equal(session.snapshot.production!.teams[0].queues[0].items.length, 1);
  assert.equal(transportHostState(session.snapshot.world).ground[47 * 128 + 50], 1022);
  const restored = CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint())));
  const next = input(session, { productionVisits: fullPopulation, updates: [
    { type: "combat-death", slot: 152, generation: 0 }, { type: "complete-removal", slot: 152, generation: 0 },
  ] });
  const retried = unwrap(session.step(next));
  assert.deepEqual(unwrap(restored.step(next)), retried);
  const created = retried.entry.requests.find((request) => request.type === "create")!;
  assert.equal(created.slot, 152);
  assert.equal(created.generation, 1);
  assert.equal(retried.production!.teams[0].credits, 650);
  assert.equal(retried.entry.productionRequests!.some((request) => request.type === "population-message"), false);
});

interface ResourceEntity {
  direction: number; pendingOrder: number; order: number; taskWords: number[]; type: number; hp: number;
  animation: { bank: number; frame: number; delay: number; mode: 0 | 1 | 2 | 3 };
}

test("resource lifecycle income synchronizes actual world funds without losing pending UI reservations, with replay", () => {
  const trace = JSON.parse(process.env.DC_RESOURCE_LIFECYCLE_TRACE ? readFileSync(process.env.DC_RESOURCE_LIFECYCLE_TRACE, "utf8")
    : execFileSync("python3", ["tools/research/resource-lifecycle-20260919.py"], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" } })) as {
        cases: { race: number; trace: { source: ResourceEntity; extractor: ResourceEntity }[]; animations: ResourceHostOptions["animations"];
          profiles: { bindings: { unitType: number; standBank: number; deployBank: number; deathBank: number;
            deathVariants: number; removalHoldField: number; selectedWeapon: number }[] } }[] };
  const nativeResource = trace.cases.find((entry) => entry.race === 0)!;
  const initial = nativeResource.trace[0];
  const binding = (entity: ResourceEntity, slot: number): ResourceHostBinding => ({ slot, generation: 0, state: {
    direction: entity.direction, pendingOrder: entity.pendingOrder, order: entity.order,
    animation: { profile: String(entity.animation.bank), frame: entity.animation.frame, delay: entity.animation.delay, mode: entity.animation.mode },
    stack: [{ opcode: 1, words: entity.taskWords.slice(0, 3) }], released: false,
  } });
  const options: CampaignSessionOptions = { ...fixture(0, [[60, 60, 40, 22, 10000], [60, 60, initial.extractor.type, 1, initial.extractor.hp]]),
    resourceScales: { rateScale: 256, reserveScale: 256 }, resourceInitialIncome: Array(8).fill(0), resourceLifecycle: {
      animations: nativeResource.animations, types: nativeResource.profiles.bindings.map((profile) => ({ unitType: profile.unitType,
        stand: String(profile.standBank), deploy: String(profile.deployBank), death: String(profile.deathBank),
        deathVariants: profile.deathVariants, removalHoldField: profile.removalHoldField, selectedWeapon: profile.selectedWeapon | 0 })),
      bindings: [binding(initial.source, 152), binding(initial.extractor, 153)],
    } };
  const session = unwrap(createCampaignSession(options));
  const resourceFrameSource = { teams: options.source.teams.map(({ index }) => ({ index, ai: 0 })),
    aiMultipliers: Array(8).fill(256), localTeam: 1, cancellationGate: 0 };
  let restored: CampaignSession | undefined;
  for (let update = 0; update < 40; update += 1) {
    const next = input(session, { resourceFrameSource, ...(update === 0 ? { productionCommands: [commands()[0]] } : {}),
      ...(update === 16 ? { productionCommands: [commands()[1]] } : {}) });
    const frame = unwrap(session.step(next));
    if (restored) assert.deepEqual(unwrap(restored.step(next)), frame);
    const income = frame.world.statistics["1,1"];
    assert.equal(frame.production!.teams[0].credits, 650 + income);
    assert.equal(frame.world.exomoney[1], 650 + income);
    assert.equal(frame.production!.teams[0].pending[9], update < 16 ? 1 : 0);
    assert.equal(frame.production!.teams[0].costAccumulator, update < 16 ? 0 : 350);
    if (update === 24) restored = CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint())));
  }
  assert.ok(session.snapshot.world.statistics["1,1"] > 0);
  assert.equal(session.snapshot.production!.teams[0].queues[0].items.length, 0);
});
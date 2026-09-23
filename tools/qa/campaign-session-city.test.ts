import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cityProof, cityConfiguration, relocatedRaw } from "./campaign-session-city-raw.test";
import { CampaignSession, type CampaignSessionOptions, type CampaignSessionInput } from "../../src/engine/campaign-session";
import { nativeConstructionRegisteredSlots } from "../../src/engine/native-construction-host";
import { transportHostState } from "../../src/engine/transport-host";
import type { ResourceHostOptions, ResourceHostBinding } from "../../src/engine/transport-host";
import type { CampaignAiSessionRequest, CampaignAiConfiguration } from "../../src/engine/campaign-ai";
import { parseDamageMatrix, parseDependencies, parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { parseScenario } from "../extractors/data/scenario";
import { parseTriggerScript } from "../extractors/data/triggers";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(`raw_cd/DC/${path}`, root), "utf8");
const units = parseUnitStats(read("GAMESTAT/GAMESTAT.TXT"));
const weapons = parseWeaponStats(read("GAMESTAT/WEAPSTAT.TXT"));
const records = parseDependencies(read("GAMESTAT/DEPEND.TXT"));
const original = parseScenario(read("SCENARIO/HUMAN/HUMAN02.SCN"));

function fixture(golden: any, full = false) {
  const source = cityConfiguration(golden);
  const config = { ...source, fixedSlots: source.fixedSlots.map((actor, slot) => slot === 5
    ? { nativeId: 20, unitType: 81, health: 1 } : actor) };
  const bytes = new DataView(Uint8Array.from(golden.beforeTeam).buffer);
  const types = new DataView(Uint8Array.from(golden.types).buffer), race = config.race;
  const troop = golden.profiles.bindings.find((binding: any) => binding.unitType === race * 8).constructionState;
  const options: CampaignSessionOptions = { sessionId: `session-city-${race}`, units, weapons, triggers: [], messages: [], journalLimit: 1,
    source: { ...original, placementRows: Array.from({ length: 6 }, (_, index) => [40 + index, 40,
      (index === 0 ? 6 : 0) + race * 8, 1, units[(index === 0 ? 6 : 0) + race * 8].health]),
      teams: original.teams.map(team => ({ ...team, race, money: 6000, coordinateRows: [[0, 0], team.index === 1 ? [32, 32] : [0, 0]],
        cityRows: [[1, config.fixedSlots[0]!.health, 1, config.fixedSlots[1]!.health, 0, 0, 0, 0, 0, 0]] })) },
    map: config.map, pathGrid: new Uint8Array(16384).fill(1), tags: new Uint8Array(16384),
    commanders: [{ team: 1, unitType: race === 0 ? 69 : 73, sprite: race === 0 ? "TRSC" : "GRAY" }],
    directionBits: Array.from({ length: 64 }, () => [0, 0] as const), fixedStepMilliseconds: 16, orientationSteps: 1,
    production: { records, constructionSources: [config],
      units: records.filter(record => record.rawFields[0] === 1).map(record => ({ unitType: record.rawFields[1],
        queue: types.getInt32(record.rawFields[1] * 280 + 0xec, true) as 0 | 1 | 2 | 3,
        exitSelector: types.getInt32(record.rawFields[1] * 280 + 0xf0, true) as 0 | 1, exitOffset: { x: 0, y: -3 } })),
      sourceProfiles: [{ unitType: race * 8 as 0 | 8, bankField: 152, id: troop.name,
        finSha256: golden.profiles.sources.find((source: any) => source.source === troop.source).sha256,
        directions: Array.from({ length: 32 }, () => [...troop.delays]) }],
      teams: [{ team: 1, race, credits: 6000, costAccumulator: 17, base: config.base, producerDelays: [0, 0, 0, 0],
        slots: Array.from({ length: 5 }, (_, slot) => ({ health: bytes.getInt32(0x3c + slot * 4, true), level: 0, busy: 0 })),
        restrictions: Array.from({ length: 110 }, (_, index) => index).filter(index => golden.beforeTeam[0xda4 + index]), upgrades: [] }] } };
  const world = new CampaignSession(options).snapshot.world;
  const campaignAi: CampaignAiConfiguration = { scope: "source-separated-bounded", sourceId: options.sessionId,
    sourceSha256: cityProof.sha256, team: 1,
    sources: { types: golden.types, weapons: Array(80 * 72).fill(0), dependencies: golden.dependencies,
      cityDependencies: golden.cityDependencies, matrix: full ? parseDamageMatrix(read("GAMESTAT/MBULLET.TXT")).coefficients : [], navigation: { width: 128, height: 128,
        families: [...options.pathGrid], nextFamily: Array(65536).fill(0) } },
    ...(full ? { fullPolicy: { neighbors: Array(8192).fill(0), rngTable: cityProof.rngTable,
      ruleTable: golden.aiBefore.policy.slice(0x6a94, 0x6a94 + 216), policyAddress: 0xa00000, actorTransport: "deferred" as const } } : {}),
    initial: { entities: full ? [...world.entityBytes!] : golden.aiBefore.entities,
      policy: full ? Array(0x6c40).fill(0) : golden.aiBefore.policy, teamBytes: golden.beforeTeam,
      ...(full ? { rngCursor: 0 } : {}),
      forceOrder: 0, population: 6, populationLimit: 10, relations: Array(100).fill(0), visibilityMasks: Array(8).fill(0),
      occupancy: transportHostState(world).ground.map(slot => slot < 0 ? 1023 : slot) } };
  return { ...options, campaignAi };
}

function input(session: CampaignSession, extra: Partial<CampaignSessionInput> = {}): CampaignSessionInput {
  const state = session.snapshot;
  return { clockMilliseconds: 7, productionVisits: [{ team: 1, queue: 0, population: 6, populationLimit: 10 }],
    constructionVisits: state.production!.constructionHosts!.filter(host => host.receiptId && !host.ready).map(host => ({ team: 1,
      visit: { sequence: host.visits, counter: 4, mainHealth: 2400, auxiliaryHealth: host.actors[6]?.health ?? 0,
        registeredSlots: nativeConstructionRegisteredSlots(host) } })), ...extra };
}

function request(session: CampaignSession, id: string): CampaignAiSessionRequest {
  const state = session.snapshot, buffers = state.campaignAi!.buffers;
  return { id, sourceId: state.campaignAi!.sourceId, sequence: state.campaignAi!.history.length,
    stage: buffers.rngCursor === undefined ? "demand" : "full-policy",
    observation: { entities: buffers.entities, forceOrder: buffers.forceOrder, population: 6, populationLimit: 10,
      relations: buffers.relations, visibilityMasks: buffers.visibilityMasks, occupancy: buffers.occupancy } };
}

function step(session: CampaignSession, extra: Partial<CampaignSessionInput> = {}) {
  const result = session.step(input(session, extra));
  if (!result.ok) assert.fail(JSON.stringify(result.diagnostics));
  return result.value;
}

for (const golden of cityProof.cases) test(`session CITY race ${golden.race}: paid receipt, real raw/registry, next command`, () => {
  const options = fixture(golden, true), session = new CampaignSession(options);
  const initial = session.snapshot, first = request(session, "science");
  let state = step(session, { campaignAiRequest: first });
  assert.equal(state.entry.campaignAiReceipt!.selectedRule, 5);
  assert.deepEqual(state.entry.campaignAiReceipt!.intents[0].packet, golden.packets[0]);
  assert.equal(state.world.exomoney[1], 4000);
  assert.equal(state.production!.teams[0].costAccumulator, 2017);
  for (const [index, expected] of golden.trace.entries()) {
    if (index) state = step(session);
    const host = transportHostState(state.world), city = state.production!.constructionHosts![0];
    assert.deepEqual([...state.world.entityBytes!.slice(18 * 220, 19 * 220)], relocatedRaw(expected.main), `main ${index}`);
    assert.deepEqual([...state.world.entityBytes!.slice(21 * 220, 22 * 220)], relocatedRaw(expected.auxiliary), `auxiliary ${index}`);
    assert.equal(host.highWater, transportHostState(initial.world).highWater);
    assert.equal(host.registry[18], "city:18:0");
    assert.equal(state.world.buildingSlots["1,3"], 2400);
    assert.deepEqual([city.busy, city.latch], [expected.busy, expected.latch]);
    for (const cell of city.footprint) assert.equal(host.ground[cell.y * 128 + cell.x], 18);
    if (index === 52) assert.equal(host.registry[21], null);
  }
  assert.equal(state.production!.constructionHosts![0].ready, true);
  assert.equal(transportHostState(state.world).generations[21], 1);
  assert.equal(state.entry.requests.length, 0);
  state = step(session, { campaignAiRequest: request(session, "next") });
  assert.deepEqual(state.entry.campaignAiReceipt!.intents[0].packet, golden.packets[1]);
  assert.equal(state.world.exomoney[1], 3650);
  assert.equal(state.production!.teams[0].costAccumulator, 2367);
  assert.equal(state.production!.teams[0].queues[0].items.length, 1);
  const saved = session.checkpoint();
  assert.throws(() => CampaignSession.restore(saved, options.campaignAi), /independently expected/);
  assert.deepEqual(CampaignSession.restore(saved, options.campaignAi, undefined, options.production!.constructionSources).checkpoint(), saved);
});

test("CITY rejects late AI, TRO, missing visits, legal phase3 death and cancel without committing", () => {
  const options = fixture(cityProof.cases[0], true);
  const session = new CampaignSession({ ...options, triggers: parseTriggerScript("1 norm 1 (c==0)\nmsg 2 0 29 3 8\nend") });
  for (let index = 0; index < 7; index++) step(session);
  const before = session.checkpoint(), first = request(session, "late-city");
  const failed = session.step(input(session, { campaignAiRequest: first }));
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.match(JSON.stringify(failed.diagnostics), /message/i);
  assert.deepEqual(session.checkpoint(), before);
  const active = new CampaignSession(options);
  step(active, { campaignAiRequest: request(active, "science") });
  while (active.snapshot.production!.constructionHosts![0].actors[3]!.phase !== 3) step(active);
  const pristine = active.checkpoint(), registry = transportHostState(active.snapshot.world);
  const badInputs: Partial<CampaignSessionInput>[] = [
    { campaignAiRequest: { ...request(active, "late-ai"), sourceId: "wrong-source" } },
    { constructionVisits: [] },
    { updates: [{ type: "combat-death", slot: 18, generation: 0 }] },
    { updates: [{ type: "combat-death", slot: 21, generation: registry.generations[21] }] },
    { updates: [{ type: "combat-death", slot: 16, generation: 0 }] },
    { productionCommands: [{ id: "cancel", team: 1, action: { type: "release-pending", dependency: 2 } }] },
    { constructionVisits: input(active).constructionVisits!.map(entry => ({ ...entry, visit: { ...entry.visit, mainHealth: 0 } })) },
    { constructionVisits: input(active).constructionVisits!.map(entry => ({ ...entry, visit: { ...entry.visit,
      registeredSlots: [...entry.visit.registeredSlots].reverse() } })) },
  ];
  for (const extra of badInputs) {
    const rejected = active.step(input(active, extra));
    assert.equal(rejected.ok, false);
    assert.deepEqual(active.checkpoint(), pristine);
  }
  assert.equal(active.snapshot.production!.teams[0].latch, 1);
  assert.equal(active.snapshot.production!.constructionHosts![0].ready, false);
});

test("CITY checkpoint independently authenticates sources, raw, registry, money and reserved identities", () => {
  const options = fixture(cityProof.cases[0], true), session = new CampaignSession(options);
  const initial = session.checkpoint();
  assert.deepEqual(CampaignSession.restore(initial, options.campaignAi, undefined, options.production!.constructionSources).checkpoint(), initial);
  step(session, { campaignAiRequest: request(session, "science") });
  const saved = session.checkpoint();
  const mutations: ((copy: any) => void)[] = [
    copy => { copy.options.production.constructionSources[0].profiles.build.directions[0][0]++; },
    copy => { copy.state.world.entityBytes[18 * 220 + 76]++; },
    copy => { copy.state.world.transportState.generations[21] = 0; },
    copy => { copy.state.world.transportState.registry[18] = null; },
    copy => { copy.state.world.exomoney[1]++; },
    copy => { copy.state.production.teams[0].costAccumulator++; },
    copy => { copy.state.production.constructionHosts[0].ready = true; },
    copy => { copy.state.staticSlots = copy.state.staticSlots.filter((slot: number) => slot !== 18); },
    copy => { copy.state.world.transportState.ground[32 * 128 + 33] = 152; },
    copy => { copy.state.constructionInputs[0].clockMilliseconds++; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(saved); mutate(copy);
    assert.throws(() => CampaignSession.restore(copy, options.campaignAi, undefined, options.production!.constructionSources));
  }
  const sources = structuredClone(options.production!.constructionSources!);
  (sources[0].base as { x: number }).x++;
  assert.throws(() => CampaignSession.restore(saved, options.campaignAi, undefined, sources));
});

test("CITY mid phase2 and phase3 restore matches the next 100 caller steps", () => {
  const options = fixture(cityProof.cases[0], true), session = new CampaignSession(options);
  step(session, { campaignAiRequest: request(session, "science") });
  for (const phase of [2, 3]) {
    while (session.snapshot.production!.constructionHosts![0].actors[3]!.phase !== phase) step(session);
    const saved = session.checkpoint();
    const restored = CampaignSession.restore(saved, options.campaignAi, undefined, options.production!.constructionSources);
    const original = session.fork();
    for (let index = 0; index < 100; index++) {
      const frame = input(original);
      const left = original.step(frame), right = restored.step(frame);
      assert.equal(left.ok, true); assert.equal(right.ok, true);
      assert.deepEqual(right, left, `phase ${phase}, next ${index}`);
    }
    assert.deepEqual(restored.checkpoint(), original.checkpoint());
  }
});

test("CITY late producer pool exhaustion rolls back the registered visit and all owner state", () => {
  const options = fixture(cityProof.cases[0]);
  const placements = [...options.source.placementRows];
  for (let index = 0; placements.length < 647; index++) placements.push([index % 100 + 1, Math.floor(index / 100) + 50, 0, 1, units[0].health]);
  const session = new CampaignSession({ ...options, source: { ...options.source, placementRows: placements } });
  step(session, { campaignAiRequest: request(session, "science") });
  const dependency = records.find(record => record.rawFields[0] === 1 && record.rawFields[1] === 0)!.id;
  step(session, { productionVisits: [{ team: 1, queue: 0, population: 647, populationLimit: 1000 }],
    productionCommands: [{ id: "reserve", team: 1, action: { type: "reserve", dependency } },
      { id: "dispatch", team: 1, action: { type: "dispatch", dependency } }] });
  let failed = false;
  for (let index = 0; index < 100; index++) {
    const before = session.checkpoint();
    const result = session.step(input(session, { productionVisits: [{ team: 1, queue: 0, population: 647, populationLimit: 1000 }] }));
    if (result.ok) continue;
    assert.match(JSON.stringify(result.diagnostics), /high-water assertion/);
    assert.deepEqual(session.checkpoint(), before);
    failed = true; break;
  }
  assert.equal(failed, true, "must reach actual allocation failure");
});

test("CITY registered visits coexist with actual resource income, pending purchases and native production", () => {
  const proof = JSON.parse(process.env.DC_CITY_RESOURCE_TRACE ? readFileSync(process.env.DC_CITY_RESOURCE_TRACE, "utf8")
    : execFileSync("python3", ["-B", new URL("tools/research/resource-lifecycle-20260919.py", root).pathname], {
      encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
    }));
  const evidence = proof.cases.find((entry: any) => entry.race === 0), initial = evidence.trace[0];
  const bind = (entity: any, slot: number): ResourceHostBinding => ({ slot, generation: 0, state: {
    direction: entity.direction, pendingOrder: entity.pendingOrder, order: entity.order,
    animation: { profile: String(entity.animation.bank), frame: entity.animation.frame, delay: entity.animation.delay, mode: entity.animation.mode },
    stack: [{ opcode: 1, words: entity.taskWords.slice(0, 3) }], released: false } });
  const base = fixture(cityProof.cases[0]);
  const lifecycle: ResourceHostOptions = { animations: evidence.animations,
    types: evidence.profiles.bindings.map((profile: any) => ({ unitType: profile.unitType,
      stand: String(profile.standBank), deploy: String(profile.deployBank), death: String(profile.deathBank),
      deathVariants: profile.deathVariants, removalHoldField: profile.removalHoldField, selectedWeapon: profile.selectedWeapon | 0 })),
    bindings: [bind(initial.source, 158), bind(initial.extractor, 159)] };
  const options = { ...base, source: { ...base.source, placementRows: [...base.source.placementRows,
    [60, 60, 40, 22, 10000], [60, 60, initial.extractor.type, 1, initial.extractor.hp]] },
    resourceScales: { rateScale: 256, reserveScale: 256 }, resourceInitialIncome: Array(8).fill(70000), resourceLifecycle: lifecycle };
  const session = new CampaignSession(options);
  const resourceFrameSource = { teams: options.source.teams.map(({ index }) => ({ index, ai: 0 })),
    aiMultipliers: Array(8).fill(256), localTeam: 1, cancellationGate: 0 };
  step(session, { resourceFrameSource, campaignAiRequest: request(session, "science") });
  const dependency = records.find(record => record.rawFields[0] === 1 && record.rawFields[1] === 0)!.id;
  step(session, { resourceFrameSource, productionCommands: [
    { id: "produce", team: 1, action: { type: "reserve", dependency } },
    { id: "dispatch", team: 1, action: { type: "dispatch", dependency } },
    { id: "pending", team: 1, action: { type: "reserve", dependency } },
  ] });
  for (let index = 0; index < 60; index++) step(session, { resourceFrameSource });
  const state = session.snapshot, earned = state.world.statistics["1,1"] - 70000;
  assert.ok(earned > 0);
  assert.equal(state.world.exomoney[1], 3300 + earned);
  assert.equal(state.production!.teams[0].credits, 3300 + earned);
  assert.equal(state.production!.teams[0].costAccumulator, 2367);
  assert.equal(state.production!.teams[0].pending[dependency], 1);
  assert.equal(state.production!.constructionHosts![0].actors[3]!.phase, 2);
  assert.ok(transportHostState(state.world).requests.some(event => event.type === "create" && event.slot === 160 && event.unitType === 0));
  const saved = session.checkpoint();
  const restored = CampaignSession.restore(saved, options.campaignAi, undefined, options.production!.constructionSources);
  assert.deepEqual(restored.checkpoint(), saved);
  const frame = input(session, { resourceFrameSource });
  assert.deepEqual(restored.step(frame), session.step(frame));
});

for (const golden of cityProof.cases) test(`full-policy CITY race ${golden.race}: actual shared pool and mode9 receipt`, () => {
  const options = fixture(golden, true), session = new CampaignSession(options);
  const state = step(session, { campaignAiRequest: request(session, "full-science") });
  assert.deepEqual(state.entry.campaignAiReceipt!.intents[0].packet, golden.packets[0]);
  assert.equal(state.entry.campaignAiReceipt!.fullPolicy!.computation.runtimeReady, false);
  assert.deepEqual(state.campaignAi!.buffers.entities, [...state.world.entityBytes!]);
  assert.equal(state.world.exomoney[1], 4000);
  assert.equal(state.production!.teams[0].costAccumulator, 2017);
  step(session);
});
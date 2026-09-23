import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CampaignSession, type CampaignSessionInput, type CampaignSessionOptions } from "../../src/engine/campaign-session";
import { ADAPTED_UNIT_PRODUCTION_SOURCES, productionChoices, productionProducerSlot } from "../../src/engine/campaign-production";
import { createBrowserAiSelectorConfiguration } from "../../src/engine/browser-campaign-runtime";
import { producerProfiles, sourceProductionTeamSeeds } from "../../src/engine/source-production-options";
import { transportHostState } from "../../src/engine/transport-host";
import { parseScenario } from "../extractors/data/scenario";
import { parseDependencies, parseUnitStats, parseWeaponStats } from "../extractors/data/tables";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const units = parseUnitStats(read("raw_cd/DC/GAMESTAT/GAMESTAT.TXT"));
const weapons = parseWeaponStats(read("raw_cd/DC/GAMESTAT/WEAPSTAT.TXT"));
const records = parseDependencies(read("raw_cd/DC/GAMESTAT/DEPEND.TXT"));

function fixture(race: 0 | 1 = 0, mode: "roster" | "collectors" | "strict" = "roster", absent: number[] = []): CampaignSessionOptions {
  const original = parseScenario(read("raw_cd/DC/SCENARIO/HUMAN/HUMAN02.SCN"));
  const source = { ...original, placementRows: [], teams: original.teams.map(team => ({ ...team, race,
    money: 20000, dependencies: [], coordinateRows: [[0, 0], team.index === 0 ? [16, 16] : [0, 0]] as const,
    cityRows: [Array.from({ length: 5 }, (_, slot) => [absent.includes(slot) ? 0 : slot === 2 || slot === 3 ? 2 : 1, -1]).flat(),
      ...team.cityRows.slice(1)] })) };
  const offsets = [[[0, -3], [0, -3]], [[2, 3], [-5, -1]], [[-4, 0], [-5, -1]], [[-4, 3], [-4, 3]]];
  return { sessionId: `roster-session:${race}`, source, units, weapons, triggers: [], messages: [],
    ...(mode === "strict" ? {} : { runtimeProfile: "browser-adapted", browserAi: createBrowserAiSelectorConfiguration(source) }),
    map: { width: 32, height: 32 }, pathGrid: new Uint8Array(1024).fill(1), tags: new Uint8Array(1024),
    commanders: [{ team: 0, unitType: race ? 73 : 69, sprite: race ? "GRAY" : "TRSC" }],
    directionBits: Array.from({ length: 64 }, () => [0, 0] as const), fixedStepMilliseconds: 16, orientationSteps: 1,
    production: { records, units: records.filter(entry => entry.rawFields[0] === 1).map(entry => {
      const unitType = entry.rawFields[1], raw = units[unitType].rawTail;
      const queue = raw[10] as 0 | 1 | 2 | 3, exitSelector = raw[12] as 0 | 1;
      const [x, y] = offsets[queue][exitSelector];
      return { unitType, queue, exitSelector, exitOffset: { x, y } };
    }), sourceProfiles: producerProfiles(JSON.parse(read(`public/assets/generated/animations/${race ? "ALBU" : "HUBU"}.json`)), race),
    ...(mode === "roster" ? { adaptedUnitProfiles: ADAPTED_UNIT_PRODUCTION_SOURCES.filter(entry => entry.race === race)
      .map(entry => ({ runtimeProfile: "browser-adapted" as const, unitType: entry.unitType, completionVisits: 3 })) } : {}),
    ...(mode === "collectors" ? { adaptedCollectorProfiles: [{ runtimeProfile: "browser-adapted" as const,
      unitType: race ? 14 as const : 6 as const, completionVisits: 3 }] } : {}),
    teams: [sourceProductionTeamSeeds(source, units)[0]] } };
}

function input(session: CampaignSession, extra: Partial<CampaignSessionInput> = {}): CampaignSessionInput {
  const productionVisits = session.runtimeProfile === "browser-adapted" ? session.browserFrameContext(150).productionVisits
    : [{ team: 0, queue: 0 as const, population: 0, populationLimit: 150 }];
  return { clockMilliseconds: session.snapshot.world.clockMilliseconds + 16, productionVisits, ...extra };
}

function advance(session: CampaignSession, extra: Partial<CampaignSessionInput> = {}) {
  const result = session.step(input(session, extra));
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}

function commands(dependencies: readonly number[]): NonNullable<CampaignSessionInput["productionCommands"]> {
  return dependencies.flatMap(dependency => ([{ id: `reserve:${dependency}`, team: 0,
    action: { type: "reserve" as const, dependency } }, { id: `dispatch:${dependency}`, team: 0,
    action: { type: "dispatch" as const, dependency } }]));
}

function roundTrip(session: CampaignSession) {
  const checkpoint = JSON.parse(JSON.stringify(session.checkpoint()));
  const restored = CampaignSession.restore(checkpoint);
  assert.deepEqual(restored.checkpoint(), checkpoint);
  return restored;
}

for (const race of [0, 1] as const) {
  for (const source of ADAPTED_UNIT_PRODUCTION_SOURCES.filter(entry => entry.race === race)) {
    test(`roster session ${source.unitType}: paid source queue, active and allocated checkpoint replay`, () => {
      const session = new CampaignSession(fixture(race));
      advance(session, { productionCommands: commands([source.dependency]) });
      advance(session);
      const active = session.snapshot.production!.teams[0];
      assert.equal(active.credits, 20000 - source.cost);
      assert.equal(active.costAccumulator, source.cost);
      assert.equal(active.queues[source.queue].adaptedElapsedVisits, 1);
      assert.equal(active.queues[source.queue].animation, undefined);
      const restored = roundTrip(session);
      for (let count = 0; count < 2; count++) assert.deepEqual(advance(restored), advance(session));
      const state = session.snapshot, host = transportHostState(state.world);
      const actor = host.slots[152]!;
      assert.equal(actor.unitType, source.unitType);
      assert.equal(host[source.plane === "flying" ? "flying" : "ground"][(16 + source.exitOffset.y) * 32 + 16 + source.exitOffset.x], 152);
      assert.equal(state.production!.teams[0].queues[source.queue].adaptedElapsedVisits, undefined);
      assert.deepEqual(host.productionExits, []);
      roundTrip(session);
    });
  }

  test(`roster session ${race}: simultaneous queues have distinct retained event IDs`, () => {
    const session = new CampaignSession(fixture(race));
    const entries = ADAPTED_UNIT_PRODUCTION_SOURCES.filter(entry => entry.race === race && entry.unitType !== (race ? 11 : 3));
    const infantry = records.find(entry => entry.rawFields[0] === 1 && entry.rawFields[1] === race * 8)!;
    advance(session, { productionCommands: commands([infantry.id, ...entries.map(entry => entry.dependency)]) });
    const starts = session.snapshot.production!.journal.filter(event => event.action.type === "producer-started");
    assert.equal(starts.length, 4);
    assert.equal(new Set(starts.map(event => event.id)).size, 4);
    assert.deepEqual(starts.map(event => event.id), ["session:1:0:producer:start", "session:1:0:producer:1:start",
      "session:1:0:producer:2:start", "session:1:0:producer:3:start"]);
    const restored = roundTrip(session);
    for (let count = 0; count < 3; count++) assert.deepEqual(advance(restored), advance(session));
    assert.equal(session.snapshot.world.entities.filter(entity => entity.rawSlot! >= 152).length, 3);
    roundTrip(session);
  });

  for (const phase of ["pending", "active", "spawned"] as const) for (const queue of [1, 2, 3] as const) {
    test(`roster session ${race}: queue ${queue} producer destruction ${phase} replays`, () => {
      const session = new CampaignSession(fixture(race));
      const source = ADAPTED_UNIT_PRODUCTION_SOURCES.find(entry => entry.race === race && entry.queue === queue)!;
      advance(session, { productionCommands: phase === "pending" ? commands([source.dependency]).slice(0, 1) : commands([source.dependency]) });
      if (phase === "spawned") for (let count = 0; count < 3; count++) advance(session);
      const restored = roundTrip(session);
      const slot = productionProducerSlot(queue);
      const victim = session.snapshot.world.entities.find(entity => entity.rawSlot === slot)!;
      const extra = { updates: [{ type: "combat-death" as const, slot, generation: victim.generation! }] };
      assert.deepEqual(advance(restored, extra), advance(session, extra));
      const state = session.snapshot, team = state.production!.teams[0];
      assert.equal(team.credits, phase === "pending" ? 20000 : 20000 - source.cost);
      assert.equal(team.costAccumulator, phase === "pending" ? 0 : source.cost);
      assert.equal(team.queues[queue].items.length, 0);
      assert.equal(team.queues[queue].adaptedElapsedVisits, undefined);
      assert.equal(transportHostState(state.world).productionExits?.length ?? 0, 0);
      assert.equal(state.world.entities.filter(entity => entity.rawSlot! >= 152).length, phase === "spawned" ? 1 : 0);
      assert.equal(productionChoices(state.production!, 0).find(choice => choice.dependency === source.dependency)!.maxAdditional, 0);
      roundTrip(session);
    });
  }

  test(`roster session ${race}: collector and aircraft share queue 2 with exact session replay`, () => {
    const options = fixture(race);
    const session = new CampaignSession({ ...options, production: { ...options.production!,
      adaptedCollectorProfiles: [{ runtimeProfile: "browser-adapted", unitType: race ? 14 : 6, completionVisits: 3 }] } });
    advance(session, { productionCommands: commands([race ? 21 : 7, race ? 24 : 10]) });
    assert.equal(session.snapshot.production!.teams[0].queues[2].items.length, 2);
    assert.deepEqual(session.browserFrameContext(150).productionVisits!.map(visit => visit.queue), [0, 1, 2, 3]);
    const restored = roundTrip(session);
    for (let count = 0; count < 7; count++) assert.deepEqual(advance(restored), advance(session));
    const state = session.snapshot, host = transportHostState(state.world);
    assert.deepEqual([host.slots[152]!.unitType, host.slots[153]!.unitType], [race ? 14 : 6, race ? 13 : 5]);
    assert.equal(state.production!.teams[0].credits, 17900);
    assert.equal(state.production!.teams[0].costAccumulator, 2100);
    assert.equal(state.production!.teams[0].queues[2].items.length, 0);
    assert.deepEqual(host.productionExits, []);
    roundTrip(session);
  });

  for (const mode of ["strict", "collectors"] as const) test(`roster compatibility ${race}: ${mode} snapshots retain absent roster`, () => {
    const session = new CampaignSession(fixture(race, mode));
    const dependency = mode === "collectors" ? race ? 21 : 7 : race ? 23 : 9;
    advance(session, { productionCommands: commands([dependency]) });
    const restored = roundTrip(session);
    assert.equal(session.checkpoint().options.production!.adaptedUnitProfiles, undefined);
    assert.equal(session.snapshot.production!.adaptedUnitProfiles, undefined);
    assert.deepEqual(advance(restored), advance(session));
    assert.equal(productionChoices(session.snapshot.production!, 0).find(choice => choice.dependency === (race ? 25 : 11))!.supported, false);
  });
}

test("roster session: admission without base infantry factory requires a live matching producer", () => {
  const session = new CampaignSession(fixture(0, "roster", [0, 1, 3, 4]));
  assert.deepEqual(session.browserFrameContext(150).productionVisits!.map(visit => visit.queue), [1]);
  advance(session);
  roundTrip(session);
  assert.throws(() => new CampaignSession(fixture(0, "roster", [0, 1, 2, 3, 4])), /existing base producer/);
});

test("roster session: wrong ownership and source profile metadata are rejected", () => {
  const options = fixture();
  assert.throws(() => new CampaignSession({ ...options, runtimeProfile: "strict-native", browserAi: undefined }), /browser-adapted/);
  assert.throws(() => new CampaignSession({ ...options, production: { ...options.production!,
    adaptedUnitProfiles: [{ runtimeProfile: "browser-adapted", unitType: 2, completionVisits: 0 }] } }), /profile/);
  assert.throws(() => new CampaignSession({ ...options, production: { ...options.production!,
    adaptedUnitProfiles: [...options.production!.adaptedUnitProfiles!, options.production!.adaptedUnitProfiles![0]] } }), /unique/);
});

test("roster session: exact queue census and callback rejection are atomic", () => {
  const session = new CampaignSession(fixture());
  const visits = session.browserFrameContext(150).productionVisits!;
  for (const productionVisits of [visits.slice(1), [...visits].reverse(), [...visits, visits[0]],
    visits.map(visit => ({ ...visit, population: visit.population + 1 }))]) {
    const before = session.checkpoint();
    assert.equal(session.step(input(session, { productionVisits })).ok, false);
    assert.deepEqual(session.checkpoint(), before);
  }
  const forged = { productionCommands: [{ id: "forged", team: 0,
    action: { type: "producer-completed", queue: 1, ticket: "fake", animationMode: 2 } }] } as unknown as Partial<CampaignSessionInput>;
  assert.equal(session.step(input(session, forged)).ok, false);
  advance(session);
});

test("roster session: checkpoint profile, progress, retained actions and input history cannot be forged", () => {
  const session = new CampaignSession(fixture());
  advance(session, { productionCommands: commands([11]) });
  advance(session);
  const saved = session.checkpoint();
  const corruptions: ((copy: any) => void)[] = [
    copy => { copy.options.production.adaptedUnitProfiles[0].completionVisits = 0; },
    copy => { copy.options.production.adaptedUnitProfiles[0].runtimeProfile = "strict-native"; },
    copy => { copy.options.production.adaptedUnitProfiles[0].unitType = 6; },
    copy => { copy.options.production.adaptedUnitProfiles[0].unexpected = true; },
    copy => { delete copy.options.production.adaptedUnitProfiles; },
    copy => { copy.state.production.adaptedUnitProfiles[0].completionVisits++; },
    copy => { delete copy.state.production.adaptedUnitProfiles; },
    copy => { copy.state.production.teams[0].queues[1].adaptedElapsedVisits = 4; },
    copy => { copy.state.production.teams[0].queues[1].adaptedElapsedVisits = 0; },
    copy => { delete copy.state.production.teams[0].queues[1].adaptedElapsedVisits; },
    copy => { copy.state.production.journal.find((event: any) => event.action.type === "producer-started").action.queue = 3; },
    copy => { copy.state.production.journal.find((event: any) => event.action.type === "producer-started").id = "session:0:0:producer:start"; },
    copy => { copy.state.aiSelectorInputs[0].productionVisits.pop(); },
    copy => { copy.state.aiSelectorInputs[0].productionCommands[0].action.type = "producer-completed"; },
  ];
  for (const corrupt of corruptions) {
    const copy = JSON.parse(JSON.stringify(saved));
    corrupt(copy);
    assert.throws(() => CampaignSession.restore(copy), corrupt.toString());
  }
  roundTrip(session);
});
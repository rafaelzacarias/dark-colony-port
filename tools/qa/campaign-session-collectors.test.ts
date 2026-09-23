import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CampaignSession, type CampaignSessionInput, type CampaignSessionOptions } from "../../src/engine/campaign-session";
import { createBrowserAiSelectorConfiguration } from "../../src/engine/browser-campaign-runtime";
import { projectLegacyColony } from "../../src/engine/legacy-colony";
import { producerProfiles, sourceProductionVisits } from "../../src/engine/source-production-options";
import { transportHostState } from "../../src/engine/transport-host";
import { parseScenario } from "../extractors/data/scenario";
import { parseDependencies, parseUnitStats, parseWeaponStats } from "../extractors/data/tables";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const units = parseUnitStats(read("raw_cd/DC/GAMESTAT/GAMESTAT.TXT"));
const weapons = parseWeaponStats(read("raw_cd/DC/GAMESTAT/WEAPSTAT.TXT"));
const records = parseDependencies(read("raw_cd/DC/GAMESTAT/DEPEND.TXT"));

function fixture(race: 0 | 1, infantry = true): CampaignSessionOptions {
  const original = parseScenario(read("raw_cd/DC/SCENARIO/HUMAN/HUMAN02.SCN"));
  const source = { ...original, placementRows: [], teams: original.teams.map(team => ({ ...team, race,
    money: 4000, coordinateRows: [[0, 0], team.index === 1 ? [16, 16] : [0, 0]] as const,
    cityRows: [[1, -1, infantry ? 1 : 0, -1, 0, 0, 0, 0, 0, 0]] })) };
  const colony = projectLegacyColony(source.teams, units);
  const offsets = [[[0, -3], [0, -3]], [[2, 3], [-5, -1]], [[-4, 0], [-5, -1]], [[-4, 3], [-4, 3]]];
  return { sessionId: `session-collectors:${race}`, runtimeProfile: "browser-adapted",
    browserAi: createBrowserAiSelectorConfiguration(source), source, units, weapons, triggers: [], messages: [],
    map: { width: 32, height: 32 }, pathGrid: new Uint8Array(1024).fill(1), tags: new Uint8Array(1024),
    commanders: [{ team: 1, unitType: race ? 73 : 69, sprite: race ? "GRAY" : "TRSC" }],
    directionBits: Array.from({ length: 64 }, () => [0, 0] as const),
    fixedStepMilliseconds: 16, orientationSteps: 1,
    production: { records, units: records.filter(entry => entry.rawFields[0] === 1).map(entry => {
      const unitType = entry.rawFields[1], raw = units[unitType].rawTail;
      const queue = raw[10] as 0 | 1 | 2 | 3, exitSelector = raw[12] as 0 | 1;
      const [x, y] = offsets[queue][exitSelector];
      return { unitType, queue, exitSelector, exitOffset: { x, y } };
    }), sourceProfiles: producerProfiles(JSON.parse(read(`public/assets/generated/animations/${race ? "ALBU" : "HUBU"}.json`)), race),
    adaptedCollectorProfiles: [{ runtimeProfile: "browser-adapted", unitType: race ? 14 : 6, completionVisits: 3 }],
    teams: [{ team: 1, race, credits: 4000, costAccumulator: 0, base: { x: 16, y: 16 },
      slots: Array.from({ length: 5 }, (_, slot) => {
        const projected = colony.slots.find(entry => entry.nativeId === 15 + slot)!;
        return { health: projected.health, level: projected.upgradeLevel, busy: 0 as const };
      }), restrictions: [], upgrades: [], producerDelays: [0, 0, 0, 0] }] } };
}

function input(session: CampaignSession, extra: Partial<CampaignSessionInput> = {}): CampaignSessionInput {
  const state = session.snapshot;
  return { clockMilliseconds: (state.cycleCounter + 1) * 16,
    productionVisits: sourceProductionVisits(state.world, state.production!, 150), ...extra };
}

function step(session: CampaignSession, extra: Partial<CampaignSessionInput> = {}) {
  const result = session.step(input(session, extra));
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}

function buy(dependency: number): NonNullable<CampaignSessionInput["productionCommands"]> {
  return [{ id: `reserve:${dependency}`, team: 1, action: { type: "reserve", dependency } },
    { id: `dispatch:${dependency}`, team: 1, action: { type: "dispatch", dependency } }];
}

function reject(session: CampaignSession, extra: Partial<CampaignSessionInput>, pattern: RegExp) {
  const checkpoint = session.checkpoint(), journal = session.journal;
  const result = session.step(input(session, extra));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(JSON.stringify(result.diagnostics), pattern);
  assert.deepEqual(session.checkpoint(), checkpoint);
  assert.deepEqual(session.journal, journal);
}

for (const race of [0, 1] as const) test(`session collectors ${race}: queue clock, JSON replay and actual allocation`, () => {
  const session = new CampaignSession(fixture(race));
  const commands = [...buy(race ? 21 : 7), ...buy(race ? 23 : 9)];
  let frame = step(session, { productionCommands: commands });
  assert.deepEqual(frame.production!.teams[0].queues.filter(queue => queue.activeTicket).map(queue => queue.items[0].unitType),
    [race * 8, race ? 14 : 6]);
  assert.equal(frame.production!.teams[0].queues[2].adaptedElapsedVisits, 0);
  frame = step(session);
  assert.equal(frame.production!.teams[0].queues[2].adaptedElapsedVisits, 1);
  const restored = CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint())));
  assert.deepEqual(restored.snapshot, session.snapshot);
  assert.deepEqual(restored.journal, session.journal);
  for (let visit = 2; visit <= 3; visit += 1) {
    const next = input(session);
    frame = step(session);
    assert.deepEqual(restored.step(next), { ok: true, value: frame });
  }
  const created = frame.entry.requests.filter(request => request.type === "create");
  assert.deepEqual(created, [{ type: "create", slot: 152, generation: 0, team: 1, unitType: race ? 14 : 6,
    position: { x: 12 * 256 + 128, y: 16 * 256 + 128 } }]);
  const host = transportHostState(frame.world);
  assert.equal(host.ground[16 * 32 + 12], 152);
  assert.equal(host.registry[152], host.slots[152]!.key);
  assert.equal(frame.world.entityBytes![152 * 220 + 6], race ? 14 : 6);
  assert.deepEqual(frame.production!.teams[0].queues[2].items, []);
  assert.equal(frame.production!.teams[0].queues[2].adaptedElapsedVisits, undefined);
  assert.deepEqual(frame.entry.productionRequests!.map(request => request.type), ["allocate-unit", "unit-allocated"]);
  const completed = CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint())));
  assert.deepEqual(completed.snapshot, session.snapshot);
  assert.deepEqual(step(completed, { productionCommands: commands }), step(session, { productionCommands: commands }));
  assert.equal(session.snapshot.world.exomoney[1], 4000 - 1500 - records.find(entry => entry.id === (race ? 23 : 9))!.cost);
});

for (const race of [0, 1] as const) test(`session collectors ${race}: collector-only base and producer destruction census`, () => {
  const session = new CampaignSession(fixture(race, false));
  assert.deepEqual(input(session).productionVisits!.map(visit => visit.queue), [2]);
  step(session, { productionCommands: buy(race ? 21 : 7) });
  const restored = CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint())));
  assert.deepEqual(restored.snapshot, session.snapshot);
  const extra = { updates: [{ type: "combat-death" as const, slot: 15, generation: 0 }] };
  assert.deepEqual(step(restored, extra), step(session, extra));
  assert.deepEqual(input(session).productionVisits, []);
  const state = session.snapshot;
  assert.equal(state.production!.teams[0].queues[2].adaptedElapsedVisits, undefined);
  assert.deepEqual(state.production!.teams[0].queues[2].items, []);
  assert.deepEqual(transportHostState(state.world).productionExits, []);
  assert.equal(state.world.exomoney[1], 2500);
  assert.deepEqual(CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint()))).snapshot, state);
  step(session);
});

test("session collectors: strict/native admission remains closed", () => {
  const options = fixture(0);
  for (const runtimeProfile of [undefined, "strict-native"] as const) {
    assert.throws(() => new CampaignSession({ ...options, runtimeProfile, browserAi: undefined }), /Adapted collectors.*browser-adapted/);
  }
  for (const owner of ["aiSelector", "aiSelectorOwner", "campaignAi", "nativeAiTasks", "nativeCombat", "resourceLifecycle"] as const) {
    assert.throws(() => new CampaignSession({ ...options, [owner]: {} } as CampaignSessionOptions));
  }
  assert.throws(() => new CampaignSession({ ...options, production: { ...options.production!, constructionSources: [] } }),
    /Adapted collectors.*native owners/);
  const strict = new CampaignSession({ ...options, runtimeProfile: "strict-native", browserAi: undefined,
    production: { ...options.production!, adaptedCollectorProfiles: undefined } });
  reject(strict, { productionCommands: buy(7) }, /validated native source production profile/);
  reject(strict, { productionVisits: [{ team: 1, queue: 2, population: 0, populationLimit: 150 }] }, /ordered native base producers/);
  const saved = JSON.parse(JSON.stringify(strict.checkpoint()));
  saved.state.production.teams[0].queues[2].adaptedElapsedVisits = 0;
  assert.throws(() => CampaignSession.restore(saved), /adapted collector progress/);
  delete saved.state.production.teams[0].queues[2].adaptedElapsedVisits;
  saved.state.production.adaptedCollectorProfiles = options.production!.adaptedCollectorProfiles;
  assert.throws(() => CampaignSession.restore(saved), /production state/);
});

test("session collectors: ordered actual census and no caller completion callbacks", () => {
  const session = new CampaignSession(fixture(0));
  const visits = input(session).productionVisits!;
  reject(session, { productionVisits: undefined }, /native census/);
  reject(session, { productionVisits: visits.slice(0, 1) }, /native census/);
  reject(session, { productionVisits: [visits[0], visits[0]] }, /ordered native base producers/);
  reject(session, { productionVisits: [...visits].reverse() }, /ordered native base producers/);
  reject(session, { productionVisits: visits.map(visit => ({ ...visit, population: visit.population + 1 })) }, /actual source census/);
  reject(session, { productionVisits: visits.map(visit => ({ ...visit, populationLimit: -1 })) }, /ceiling/);
  reject(session, { productionVisits: visits.map(visit => ({ ...visit, adaptedElapsedVisits: 3 })) }, /without completion flags/);
  for (const type of ["producer-started", "producer-advance", "producer-completed", "allocated"] as const) {
    reject(session, { productionCommands: [...buy(7), { id: "forged", team: 1,
      action: { type, queue: 2, ticket: "forged", animationMode: 2 } }] } as unknown as Partial<CampaignSessionInput>,
    /rejects native production callbacks/);
  }
  step(session, { productionCommands: buy(7) });
  reject(session, { productionVisits: [visits[0]] }, /native census/);
  assert.equal(session.snapshot.production!.teams[0].queues[2].adaptedElapsedVisits, 0);
});

test("session collectors: checkpoint profiles, progress, actions and caller history are pinned", () => {
  const session = new CampaignSession(fixture(0));
  step(session, { productionCommands: buy(7) });
  step(session);
  const saved = JSON.parse(JSON.stringify(session.checkpoint()));
  const edits: ((checkpoint: typeof saved) => void)[] = [
    checkpoint => { checkpoint.options.production.adaptedCollectorProfiles[0].completionVisits = 4; },
    checkpoint => { checkpoint.state.production.adaptedCollectorProfiles[0].completionVisits = 4; },
    checkpoint => { checkpoint.options.production.adaptedCollectorProfiles[0].runtimeProfile = "strict-native"; },
    checkpoint => { checkpoint.state.production.adaptedCollectorProfiles[0].unitType = 0; },
    checkpoint => { checkpoint.options.production.adaptedCollectorProfiles[0].extra = true; },
    checkpoint => { delete checkpoint.options.production.adaptedCollectorProfiles; },
    checkpoint => { delete checkpoint.state.production.adaptedCollectorProfiles; },
    checkpoint => { checkpoint.state.production.teams[0].queues[2].adaptedElapsedVisits = 0; },
    checkpoint => { checkpoint.state.production.teams[0].queues[2].adaptedElapsedVisits = 65536; },
    checkpoint => { checkpoint.state.production.teams[0].queues[2].adaptedElapsedVisits = -1; },
    checkpoint => { checkpoint.state.production.teams[0].queues[2].adaptedElapsedVisits = 0.5; },
    checkpoint => { delete checkpoint.state.production.teams[0].queues[2].adaptedElapsedVisits; },
    checkpoint => { checkpoint.state.production.teams[0].queues[0].adaptedElapsedVisits = 1; },
    checkpoint => { checkpoint.state.production.journal.find((event: { action: { type: string } }) => event.action.type === "producer-started").action.queue = 0; },
    checkpoint => { checkpoint.state.production.journal[0].action.adaptedElapsedVisits = 1; },
    checkpoint => { checkpoint.state.aiSelectorInputs[0].productionVisits.pop(); },
    checkpoint => { checkpoint.state.aiSelectorInputs[1].productionVisits[1].population += 1; },
    checkpoint => { checkpoint.options.runtimeProfile = "strict-native"; delete checkpoint.options.browserAi; },
  ];
  for (const edit of edits) {
    const checkpoint = structuredClone(saved);
    edit(checkpoint);
    assert.throws(() => CampaignSession.restore(checkpoint));
  }
  for (const schemaVersion of [2, 3] as const) {
    const restored = CampaignSession.restore({ ...structuredClone(saved), schemaVersion });
    assert.deepEqual(restored.snapshot, session.snapshot);
    assert.deepEqual(restored.journal, session.journal);
  }
  assert.deepEqual(session.checkpoint(), saved);
});
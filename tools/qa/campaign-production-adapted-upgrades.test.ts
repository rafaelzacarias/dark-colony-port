import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCampaignProduction, productionChoices, productionSnapshot, reduceCampaignProduction,
  type CampaignProductionState, type ProductionAction, type ProductionUnitSource } from "../../src/engine/campaign-production";
import { loadSourceProductionOptions, producerProfiles, sourceProductionUi, sourceProductionUpgradeLevels } from "../../src/engine/source-production-options";
import type { CampaignMissionData } from "../../src/game-data";
import type { LegacyProductionSourceRecord } from "../../src/engine/legacy-production";
import { parseDependencies } from "../extractors/data/tables";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
const records: LegacyProductionSourceRecord[] = JSON.parse(read("public/assets/generated/data/dependencies.json").toString()).records;
const units: CampaignMissionData["units"] = JSON.parse(read("public/assets/generated/data/units.json").toString()).records;
const upgradeTypes = [[0, 2, 3, 4, 5, 41], [8, 10, 11, 12, 13, 42]];

function options(race: 0 | 1) {
  const offsets = [[[0, -3], [0, -3]], [[2, 3], [-5, -1]], [[-4, 0], [-5, -1]], [[-4, 3], [-4, 3]]];
  return { sessionId: "adapted-upgrades", records,
    units: records.filter(entry => entry.rawFields[0] === 1).map(entry => {
      const unitType = entry.rawFields[1], raw = units[unitType].rawTail!;
      const queue = raw[10] as ProductionUnitSource["queue"], exitSelector = raw[12] as 0 | 1;
      const [x, y] = offsets[queue][exitSelector];
      return { unitType, queue, exitSelector, exitOffset: { x, y } };
    }),
    sourceProfiles: producerProfiles(JSON.parse(read(`public/assets/generated/animations/${race ? "ALBU" : "HUBU"}.json`).toString()), race),
    adaptedUpgrades: { runtimeProfile: "browser-adapted" as const },
    teams: [{ team: 0, race, credits: 20000, costAccumulator: 0, base: { x: 20, y: 20 }, restrictions: [] as number[],
      upgrades: [] as { unitType: number; weapon: number; armor: number }[],
      slots: [4800, 2400, 2400, 2400, 2400].map(health => ({ health, level: 1, busy: 0 as const })) }] };
}

function act(state: CampaignProductionState, action: ProductionAction) {
  return reduceCampaignProduction(state, { id: `upgrade:${state.journal.length}`, team: 0, action });
}

for (const race of [0, 1] as const) {
  test(`adapted upgrades ${race}: opt-in preserves strict snapshots and gates faction`, () => {
    const setup = options(race);
    const { adaptedUpgrades, ...strictOptions } = setup;
    const strict = createCampaignProduction(strictOptions);
    assert.equal(JSON.stringify(createCampaignProduction({ ...strictOptions, adaptedUpgrades: undefined })), JSON.stringify(strict));
    assert.equal(Object.hasOwn(strict, "adaptedUpgrades"), false);
    const adapted = createCampaignProduction({ ...strictOptions, adaptedUpgrades });
    const own = records.filter(entry => entry.rawFields[0] === 2 && upgradeTypes[race].includes(entry.rawFields[1]));
    assert.ok(own.length > 0);
    assert.deepEqual(productionChoices(adapted, 0).filter(choice => choice.kind === "upgrade" && choice.supported).map(choice => choice.dependency),
      own.map(entry => entry.id));
    for (const entry of records.filter(candidate => candidate.rawFields[0] === 2)) {
      assert.throws(() => act(strict, { type: "reserve", dependency: entry.id }), /eligible|profile/);
      if (!own.includes(entry)) assert.throws(() => act(adapted, { type: "reserve", dependency: entry.id }), /eligible|profile/);
    }
    assert.deepEqual(productionSnapshot(JSON.parse(JSON.stringify(adapted))), adapted);
    assert.equal(sourceProductionUpgradeLevels(strict, 0, race * 8), undefined);
    assert.equal(sourceProductionUpgradeLevels(undefined, 0, race * 8), undefined);
    assert.equal(sourceProductionUpgradeLevels(adapted, 1, race * 8), undefined);
    assert.equal(sourceProductionUpgradeLevels(adapted, 0, (1 - race) * 8), undefined);
    assert.equal(sourceProductionUpgradeLevels(adapted, 0, race * 8 + 6), undefined);
  });
}

test("adapted upgrades: exact original catalog and explicit ownership required", () => {
  assert.deepEqual(records, parseDependencies(read("raw_cd/DC/GAMESTAT/DEPEND.TXT").toString()));
  assert.equal(records.filter(entry => entry.rawFields[0] === 2).length, 48);
  assert.deepEqual([...new Set(records.filter(entry => entry.rawFields[0] === 2).map(entry => entry.rawFields[1]))].sort((left, right) => left - right),
    upgradeTypes.flat().sort((left, right) => left - right));
  const setup = options(0);
  assert.throws(() => createCampaignProduction({ ...setup, sourceProfiles: undefined }), /Adapted upgrades/);
  assert.throws(() => createCampaignProduction({ ...setup, adaptedUpgrades: { runtimeProfile: "strict-native" as "browser-adapted" } }), /Adapted upgrades/);
  assert.throws(() => createCampaignProduction({ ...setup, adaptedUpgrades: null! }), /Adapted upgrades/);
  assert.throws(() => createCampaignProduction({ ...setup, constructionSources: [{} as never] }), /Adapted upgrades/);
  const state = createCampaignProduction(setup);
  assert.notEqual(state.adaptedUpgrades, setup.adaptedUpgrades);
  assert.ok(Object.isFrozen(state.adaptedUpgrades));
});

for (const race of [0, 1] as const) {
  for (const unitType of upgradeTypes[race]) {
    for (const selector of [0, 1] as const) {
      test(`adapted upgrades ${unitType}/${selector}: source costs, reserve/release, dispatch, max level and replay`, () => {
        const initial = createCampaignProduction(options(race));
        let state = initial;
        const entries = records.filter(entry => entry.rawFields[0] === 2 && entry.rawFields[1] === unitType && entry.rawFields[2] === selector)
          .sort((left, right) => left.rawFields[3] - right.rawFields[3]);
        assert.deepEqual(entries.map(entry => entry.rawFields[3]), [1, 2]);
        assert.throws(() => act(state, { type: "reserve", dependency: entries[1].id }), /eligible/);
        for (const entry of entries) {
          const level = entry.rawFields[3], before = state;
          const choice = sourceProductionUi(state, 0).find(candidate => candidate.dependency === entry.id)!;
          assert.equal(choice.cost, level * 1000);
          assert.equal(choice.unitType, unitType);
          assert.equal(choice.maxAdditional, 1);
          assert.throws(() => act(state, { type: "dispatch", dependency: entry.id }), /No reserved/);
          const reserve = { id: `reserve:${entry.id}`, team: 0, action: { type: "reserve" as const, dependency: entry.id } };
          state = reduceCampaignProduction(state, reserve);
          assert.equal(state.teams[0].credits, before.teams[0].credits - entry.cost);
          assert.equal(state.teams[0].costAccumulator, before.teams[0].costAccumulator);
          assert.deepEqual(state.teams[0].upgrades, before.teams[0].upgrades);
          assert.deepEqual(state.requests, before.requests);
          assert.equal(state.teams[0].pending[entry.id], 1);
          assert.equal(sourceProductionUi(state, 0).find(candidate => candidate.dependency === entry.id)!.canDispatch, true);
          assert.deepEqual(reduceCampaignProduction(state, reserve), state);
          assert.throws(() => reduceCampaignProduction(state, { ...reserve, action: { type: "dispatch", dependency: entry.id } }), /ID reused/);
          assert.throws(() => act(state, { type: "reserve", dependency: entry.id }), /pending limit/);
          const release = { id: `release:${entry.id}`, team: 0, action: { type: "release-pending" as const, dependency: entry.id } };
          const released = reduceCampaignProduction(state, release);
          assert.equal(released.teams[0].credits, before.teams[0].credits);
          assert.deepEqual(reduceCampaignProduction(released, release), released);
          assert.throws(() => act(released, release.action), /No pending/);
          const restored = productionSnapshot(JSON.parse(JSON.stringify(state)));
          const dispatch = { id: `dispatch:${entry.id}`, team: 0, action: { type: "dispatch" as const, dependency: entry.id } };
          state = reduceCampaignProduction(state, dispatch);
          assert.deepEqual(reduceCampaignProduction(restored, dispatch), state);
          assert.equal(state.teams[0].credits, before.teams[0].credits - entry.cost);
          assert.equal(state.teams[0].costAccumulator, before.teams[0].costAccumulator + entry.cost);
          assert.equal(state.teams[0].pending[entry.id], 0);
          assert.deepEqual(state.teams[0].queues, before.teams[0].queues);
          assert.equal(state.teams[0].construction, null);
          assert.deepEqual(state.requests.at(-1), { type: "upgrade-applied", id: dispatch.id, team: 0, unitType, selector, level });
          assert.equal(state.requests.length, before.requests.length + 1);
          assert.deepEqual(sourceProductionUpgradeLevels(state, 0, unitType), selector === 0
            ? { weaponLevel: level, armorLevel: 0 } : { weaponLevel: 0, armorLevel: level });
          assert.deepEqual(reduceCampaignProduction(state, dispatch), state);
          for (const type of ["reserve", "dispatch", "release-pending"] as const) assert.throws(() => act(state, { type, dependency: entry.id }), /eligible/);
          assert.equal(sourceProductionUi(state, 0).find(candidate => candidate.dependency === entry.id)!.maxAdditional, 0);
          let replay = initial;
          for (const event of state.journal) replay = reduceCampaignProduction(replay, event);
          assert.equal(JSON.stringify(replay), JSON.stringify(state));
        }
        assert.equal(state.teams[0].credits, 17000);
        assert.equal(state.teams[0].costAccumulator, 3000);
      });
    }
  }
}

for (const entry of records.filter(candidate => candidate.rawFields[0] === 2)) {
  test(`adapted upgrade ${entry.id}: credit, restriction and exact source dependency guards`, () => {
    const [, unitType, selector, level] = entry.rawFields;
    const race = upgradeTypes[0].includes(unitType) ? 0 : 1;
    const setup = options(race);
    const team = { ...setup.teams[0], upgrades: [{ unitType, weapon: selector === 0 ? level - 1 : 0,
      armor: selector === 1 ? level - 1 : 0 }] };
    const eligible = createCampaignProduction({ ...setup, teams: [team] });
    assert.equal(productionChoices(eligible, 0).find(choice => choice.dependency === entry.id)!.maxAdditional, 1);
    for (const credits of [-1, 0, entry.cost - 1]) {
      const poor = createCampaignProduction({ ...setup, teams: [{ ...team, credits }] });
      const before = JSON.stringify(poor);
      assert.equal(productionChoices(poor, 0).find(choice => choice.dependency === entry.id)!.maxAdditional, 0);
      assert.throws(() => act(poor, { type: "reserve", dependency: entry.id }), /underflow/);
      assert.equal(JSON.stringify(poor), before);
    }
    let exact = createCampaignProduction({ ...setup, teams: [{ ...team, credits: entry.cost }] });
    exact = act(exact, { type: "reserve", dependency: entry.id });
    assert.equal(exact.teams[0].credits, 0);
    exact = act(exact, { type: "dispatch", dependency: entry.id });
    assert.equal(exact.teams[0].credits, 0);
    assert.equal(exact.teams[0].costAccumulator, entry.cost);
    const restricted = createCampaignProduction({ ...setup, teams: [{ ...team, restrictions: [entry.id] }] });
    assert.equal(productionChoices(restricted, 0).find(choice => choice.dependency === entry.id)!.nativeState, 2);
    assert.throws(() => act(restricted, { type: "reserve", dependency: entry.id }), /eligible/);
    for (const dependency of entry.dependencies) {
      const prerequisite = records.find(candidate => candidate.id === dependency)!;
      const missing = prerequisite.rawFields[0] === 0
        ? { ...team, slots: team.slots.map((slot, index) => index === prerequisite.rawFields[1] ? { ...slot, health: 0 } : slot) }
        : { ...team, upgrades: [] };
      const blocked = createCampaignProduction({ ...setup, teams: [missing] });
      assert.equal(productionChoices(blocked, 0).find(choice => choice.dependency === entry.id)!.maxAdditional, 0);
      assert.throws(() => act(blocked, { type: "reserve", dependency: entry.id }), /eligible/);
      if (prerequisite.rawFields[0] === 0 && prerequisite.rawFields[2] === 1) {
        const notUpgraded = createCampaignProduction({ ...setup, teams: [{ ...team,
          slots: team.slots.map((slot, index) => index === prerequisite.rawFields[1] ? { ...slot, level: 0 } : slot) }] });
        assert.throws(() => act(notUpgraded, { type: "reserve", dependency: entry.id }), /eligible/);
      }
    }
  });
}

for (const race of [0, 1] as const) {
  test(`adapted upgrades ${race}: scenario seeds remain authoritative until dispatch and branches replay`, () => {
    const setup = options(race), unitType = race * 8;
    const initial = createCampaignProduction({ ...setup, teams: [{ ...setup.teams[0], upgrades: [{ unitType, weapon: 1, armor: 2 }] }] });
    assert.deepEqual(sourceProductionUpgradeLevels(initial, 0, unitType), { weaponLevel: 1, armorLevel: 2 });
    const entry = records.find(candidate => candidate.rawFields[0] === 2 && candidate.rawFields[1] === unitType
      && candidate.rawFields[2] === 0 && candidate.rawFields[3] === 2)!;
    let state = act(initial, { type: "reserve", dependency: entry.id });
    assert.deepEqual(sourceProductionUpgradeLevels(state, 0, unitType), { weaponLevel: 1, armorLevel: 2 });
    const pending = productionSnapshot(JSON.parse(JSON.stringify(state)));
    state = act(state, { type: "release-pending", dependency: entry.id });
    state = act(state, { type: "reserve", dependency: entry.id });
    state = act(state, { type: "sync-credits", expectedPreviousCredits: 18000, credits: 0 });
    assert.throws(() => act(state, { type: "sync-credits", expectedPreviousCredits: 18000, credits: 20000 }), /Stale/);
    state = act(state, { type: "dispatch", dependency: entry.id });
    assert.deepEqual(sourceProductionUpgradeLevels(state, 0, unitType), { weaponLevel: 2, armorLevel: 2 });
    let replay = pending;
    for (const event of state.journal.slice(pending.journal.length)) replay = reduceCampaignProduction(replay, event);
    assert.equal(JSON.stringify(replay), JSON.stringify(state));
    assert.deepEqual(sourceProductionUpgradeLevels(pending, 0, unitType), { weaponLevel: 1, armorLevel: 2 });
    const strict = createCampaignProduction({ ...setup, adaptedUpgrades: undefined,
      teams: [{ ...setup.teams[0], upgrades: [{ unitType, weapon: 1, armor: 2 }] }] });
    assert.throws(() => reduceCampaignProduction(strict, state.journal[0]), /profile/);
  });
}

function input(faction: "human" | "alien") {
  const stem = `${faction.toUpperCase()}/${faction.toUpperCase()}02`;
  return { sessionId: `adapted-upgrades:${stem}`, mission: { faction, units,
    scenario: JSON.parse(read(`public/assets/generated/data/scenarios/${stem}.json`).toString()) },
  rawScenario: read(`raw_cd/DC/SCENARIO/${stem}.SCN`),
  configuration: { profile: "user-selected-source-campaign-fresh" as const, mode: 0 as const,
    localTeam: 0 as const, race: faction === "human" ? 0 as const : 1 as const },
  loadBytes: async (url: string) => read(`public${url}`) };
}

for (const faction of ["human", "alien"] as const) {
  test(`adapted upgrades ${faction}: loader is opt-in with exact absent/explicit snapshot semantics`, async () => {
    const request = input(faction);
    const strict = await loadSourceProductionOptions(request);
    const absent = await loadSourceProductionOptions({ ...request, adaptedUpgrades: undefined });
    assert.equal(JSON.stringify(absent), JSON.stringify(strict));
    assert.equal(Object.hasOwn(strict.production!, "adaptedUpgrades"), false);
    assert.equal(Object.hasOwn(strict.state!, "adaptedUpgrades"), false);
    assert.deepEqual(strict.choices.map(choice => choice.kind), ["unit"]);
    const adaptedUpgrades = { runtimeProfile: "browser-adapted" as const };
    const adapted = await loadSourceProductionOptions({ ...request, adaptedUpgrades });
    assert.equal(adapted.status, "available");
    assert.deepEqual(adapted.production!.adaptedUpgrades, adaptedUpgrades);
    assert.deepEqual(adapted.state!.adaptedUpgrades, adaptedUpgrades);
    assert.deepEqual(adapted.state!.teams, strict.state!.teams);
    assert.deepEqual(adapted.production!.sourceProfiles, strict.production!.sourceProfiles);
    assert.equal(adapted.choices.filter(choice => choice.kind === "upgrade").length, 24);
    assert.ok(adapted.choices.filter(choice => choice.kind === "upgrade").every(choice => choice.maxAdditional === 0));
    assert.deepEqual(createCampaignProduction({ ...adapted.production!, sessionId: request.sessionId }), adapted.state);
    assert.equal(JSON.stringify(productionSnapshot(JSON.parse(JSON.stringify(adapted.state)))), JSON.stringify(adapted.state));
    await assert.rejects(loadSourceProductionOptions({ ...request, adaptedUpgrades: { runtimeProfile: "strict-native" as "browser-adapted" } }), /browser-adapted/);
    await assert.rejects(loadSourceProductionOptions({ ...request, adaptedUpgrades: null! }), /browser-adapted/);
    const withUnits = await loadSourceProductionOptions({ ...request, adaptedUpgrades,
      adaptedUnits: { runtimeProfile: "browser-adapted", completionVisits: 3 },
      adaptedCollectors: { runtimeProfile: "browser-adapted", completionVisits: 3 } });
    assert.equal(withUnits.choices.filter(choice => choice.kind === "upgrade").length, 24);
    assert.equal(withUnits.choices.filter(choice => choice.kind === "unit").length, 6);
  });
}
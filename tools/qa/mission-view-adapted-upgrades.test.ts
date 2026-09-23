import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { CampaignSession, initializeCampaignSession } from "../../src/engine/campaign-session";
import { createBrowserCampaignAiConfiguration } from "../../src/engine/browser-campaign-ai";
import { createBrowserCampaignEconomyProfile } from "../../src/engine/browser-campaign-economy-source";
import { sourceBrowserCampaignSessionOptions, type SourceBrowserCampaignMission } from "../../src/engine/source-browser-campaign-options";
import { sourceProductionTeamSeeds } from "../../src/engine/source-production-options";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { NavigationGrid } from "../../src/engine/grid";
import { calculateLegacyDamage, copyLegacyDamageProfile, defenseOptionsFromLegacy, unitOptionsFromLegacy } from "../../src/engine/legacy-balance";
import type { DependencyRecord } from "../extractors/data/tables";
import { parseScenario } from "../extractors/data/scenario";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
const records: DependencyRecord[] = JSON.parse(read("public/assets/generated/data/dependencies.json").toString()).records;
const callbacks = { onStats() {}, onUnitsChanged() {} };
const json = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value));
const canvas = () => ({ width: 512, height: 452, getContext: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) }) as unknown as HTMLCanvasElement;

type ControlledMission = Omit<SourceBrowserCampaignMission, "scenario"> & {
  scenario: SourceBrowserCampaignMission["scenario"] & ReturnType<typeof parseScenario>;
};

async function controlled(faction: "human" | "alien", credits = 20000): Promise<ControlledMission> {
  const loaded = await loadCampaignMission(faction, 3, "browser-adapted");
  const race = faction === "human" ? 0 : 1;
  const source = loaded.sourceProduction!.production!;
  const parsed = parseScenario(atob(loaded.scenario.rawScenario!));
  const scenario = { ...loaded.scenario, ...parsed, placementRows: [[8, 8, race * 8, 0, 800, 0], [12, 8, race ? 42 : 41, 0, 800, 0]],
    teams: parsed.teams.map(team => ({ ...team, money: credits, dependencies: [],
      coordinateRows: [[0, 0], team.index === 0 ? [20, 20] : [0, 0]] as const,
      cityRows: [Array.from({ length: 5 }, () => [2, -1]).flat(), ...team.cityRows.slice(1).map(row => row.map(() => 0))] })) };
  const mission: ControlledMission = { ...loaded, scenario, triggers: [], sourceResource: undefined,
    browserAi: undefined, browserEconomy: undefined,
    map: { ...loaded.map, width: 32, height: 32 }, pathGrid: new Uint8Array(1024).fill(1), tags: new Uint8Array(1024),
    sourceProduction: { ...loaded.sourceProduction!, production: { ...source,
      teams: [sourceProductionTeamSeeds(scenario, loaded.units)[0]],
      adaptedUpgrades: { runtimeProfile: "browser-adapted" } } } };
  const initial = initializeCampaignSession(sourceBrowserCampaignSessionOptions(mission));
  assert.ok(initial.ok, JSON.stringify(initial));
  const browserAi = await createBrowserCampaignAiConfiguration({ scenario, units: mission.units, weapons: mission.weapons,
    dependencies: records, pathGrid: new NavigationGrid(32, 32) });
  const browserEconomy = await createBrowserCampaignEconomyProfile({ scope: "browser-adapted-economy-v1",
    world: initial.value.world, teams: scenario.teams, units: mission.units });
  return { ...mission, browserAi, browserEconomy };
}

function equipment(mission: SourceBrowserCampaignMission, unitType: number, weaponLevel: number, armorLevel: number) {
  const stat = mission.units.find(stat => stat.index === unitType)!;
  const source = mission.weapons.find(weapon => weapon.id === stat.weapons[weaponLevel])!;
  const weapon = stat.movementSpeed === 0 ? { damage: source.damage, rangeCells: source.range, cooldownTicks: source.rateOfFire,
    sourceDamage: copyLegacyDamageProfile({ coefficients: mission.damageMatrix![source.rawPrefix!], callerFactor: 256, specialFlag: false }) }
    : unitOptionsFromLegacy(stat, mission.weapons, weaponLevel, { matrix: mission.damageMatrix!, armorLevel,
    callerFactor: 256, specialFlag: false }).weapon!;
  return { weapon, sourceDefense: defenseOptionsFromLegacy(stat, armorLevel) };
}

for (const faction of ["human", "alien"] as const) {
  test(`upgrade consumer ${faction}: paid levels, live stats, new spawn and JSON continuation`, async context => {
    context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => new Response(read(`public${String(input)}`)));
    const mission = await controlled(faction), original = JSON.stringify(mission);
    const views: MissionView[] = [];
    const view = new MissionView(canvas(), {} as HTMLElement, callbacks, mission);
    views.push(view);
    let mirror: MissionView | undefined, clock = 0;
    const step = () => {
      clock += 50;
      for (const current of [view, ...(mirror ? [mirror] : [])]) {
        current.update(clock);
        assert.equal(current.missionDiagnostic, undefined);
      }
    };
    const restore = () => {
      if (mirror) { assert.deepEqual(mirror.checkpoint(), view.checkpoint()); mirror.dispose(); }
      const saved = json(view.checkpoint());
      mirror = MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, saved);
      views.push(mirror);
      assert.deepEqual(mirror.checkpoint(), saved);
      clock = 0;
      for (const current of [view, mirror]) { current.resetClock(); current.update(0); }
    };
    const buy = (dependency: number) => {
      for (const current of [view, ...(mirror ? [mirror] : [])]) assert.equal(current.purchaseProduction(dependency), true);
      step();
    };
    try {
      assert.equal(view.missionDiagnostic, undefined);
      view.update(0);
      const unitType = faction === "human" ? 0 : 8;
      const mobileId = view.checkpoint().state.unitStats.find(entry => entry.type === unitType)!.id;
      const before = view.simulation.checkpoint().units.find(unit => unit.id === mobileId)!;
      const entries = records.filter(entry => entry.rawFields[0] === 2 && entry.rawFields[1] === unitType);
      const secondLevel = entries.find(entry => entry.rawFields[2] === 0 && entry.rawFields[3] === 2)!;
      assert.equal(view.purchaseProduction(secondLevel.id), false, "source dependency blocks level two before level one");
      restore();
      for (const selector of [0, 1]) for (const level of [1, 2]) {
        const entry = entries.find(entry => entry.rawFields[2] === selector && entry.rawFields[3] === level)!;
        const priorCredits = view.resourceWorkflow.credits[0];
        if (selector === 0 && level === 1) {
          for (const current of [view, mirror!]) assert.equal(current.purchaseProduction(entry.id), true);
          restore();
          step();
        } else buy(entry.id);
        assert.equal(view.resourceWorkflow.credits[0], priorCredits - entry.cost);
        const actual = view.simulation.checkpoint().units.find(unit => unit.id === mobileId)!;
        const expected = equipment(mission, unitType, selector === 0 ? level : 2, selector === 1 ? level : 0);
        assert.deepEqual(actual.weapon, expected.weapon);
        assert.deepEqual(actual.sourceDefense, expected.sourceDefense);
        assert.equal(actual.health, before.health);
        assert.equal(actual.maxHealth, before.maxHealth);
        assert.equal(actual.xSubcells, before.xSubcells);
        assert.equal(actual.ySubcells, before.ySubcells);
        assert.equal(view.purchaseProduction(entry.id), false, "completed levels cannot be repurchased");
        restore();
      }
      const saved = view.checkpoint();
      for (const mutate of [
        (copy: typeof saved) => { Object.assign(copy.simulation.units.find(unit => unit.id === mobileId)!.weapon!, { damage: 100 }); },
        (copy: typeof saved) => { Object.assign(copy.simulation.units.find(unit => unit.id === mobileId)!.sourceDefense!, { armorFactor: 256 }); },
        (copy: typeof saved) => { Object.assign(copy.session!.state.production!.teams[0].upgrades.find(upgrade => upgrade.unitType === unitType)!, { weapon: 0 }); },
        (copy: typeof saved) => { Reflect.deleteProperty(copy.session!.state.production!, "adaptedUpgrades"); },
      ]) {
        const invalid = json(saved); mutate(invalid);
        assert.throws(() => MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, invalid));
      }
      const unitEntry = records.find(entry => entry.rawFields[0] === 1 && entry.rawFields[1] === unitType)!;
      const originalIds = new Set(saved.simulation.units.map(unit => unit.id));
      buy(unitEntry.id);
      for (let count = 0; count < 100 && !view.simulation.snapshot.units.some(unit => !originalIds.has(unit.id)); count++) step();
      const spawned = view.simulation.checkpoint().units.find(unit => !originalIds.has(unit.id));
      assert.ok(spawned, "source production allocates a new mobile");
      assert.deepEqual(spawned.weapon, equipment(mission, unitType, 2, 2).weapon);
      assert.deepEqual(spawned.sourceDefense, equipment(mission, unitType, 2, 2).sourceDefense);
      restore();
      const turretType = faction === "human" ? 41 : 42;
      const turretId = view.checkpoint().state.unitStats.find(entry => entry.type === turretType)!.id;
      for (const selector of [0, 1]) {
        const entry = records.find(entry => entry.rawFields[0] === 2 && entry.rawFields[1] === turretType
          && entry.rawFields[2] === selector && entry.rawFields[3] === 1)!;
        buy(entry.id);
      }
      const turret = view.simulation.checkpoint().staticTargets.find(target => target.id === turretId)!;
      assert.deepEqual(turret.weapon, equipment(mission, turretType, 1, 1).weapon);
      assert.deepEqual(turret.sourceDefense, equipment(mission, turretType, 1, 1).sourceDefense);
      restore();
      for (let count = 0; count < 8; count++) step();
      assert.deepEqual(mirror!.checkpoint(), view.checkpoint());
      assert.equal(JSON.stringify(mission), original, "initial source definitions are never mutated");
    } finally { for (const current of views) current.dispose(); }
  });

  test(`upgrade equipment ${faction}: source combat damage, survivor HP and unchanged runtime state`, async context => {
    context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => new Response(read(`public${String(input)}`)));
    const mission = await controlled(faction), unitType = faction === "human" ? 0 : 8;
    const simulation = new DeterministicSimulation(new NavigationGrid(16, 16));
    const basic = equipment(mission, unitType, 0, 0), upgraded = equipment(mission, unitType, 2, 2);
    const attacker = simulation.addUnit({ faction, team: 0, cell: { x: 5, y: 5 }, health: 200, maxHealth: 400, ...basic });
    const victim = simulation.addUnit({ faction: faction === "human" ? "alien" : "human", team: 1,
      cell: { x: 6, y: 5 }, health: 300, maxHealth: 400, ...basic });
    simulation.queue({ type: "attack", unitIds: [attacker], targetId: victim });
    simulation.advance();
    const before = simulation.checkpoint();
    assert.ok(before.units.find(unit => unit.id === attacker)!.attackCooldown > 0);
    const initialHealth = before.units.find(unit => unit.id === victim)!.health;
    simulation.updateUnitEquipment(attacker, upgraded);
    simulation.updateUnitEquipment(victim, upgraded);
    const after = simulation.checkpoint();
    assert.deepEqual(after, { ...before, units: before.units.map(unit => ({ ...unit, ...upgraded })) },
      "only equipment changes, including on wounded actors with active cooldown and orders");
    assert.equal(after.units.find(unit => unit.id === victim)!.health, initialHealth);
    const mirror = DeterministicSimulation.restore(json(after));
    let hit = false;
    for (let tick = 0; tick <= upgraded.weapon.cooldownTicks; tick++) {
      simulation.advance(); mirror.advance();
      assert.deepEqual(mirror.checkpoint(), simulation.checkpoint());
      const event = simulation.combatEvents.find(event => event.attackerId === attacker && event.targetId === victim);
      if (event) {
        const profile = upgraded.weapon.sourceDamage!;
        assert.ok(!("mode" in profile));
        const damage = calculateLegacyDamage(upgraded.weapon.damage, profile, upgraded.sourceDefense);
        assert.equal(event.damage, damage);
        assert.equal(simulation.snapshot.units.find(unit => unit.id === victim)!.health, initialHealth - damage);
        assert.ok(initialHealth - damage > 0);
        hit = true; break;
      }
    }
    assert.equal(hit, true);
    const unchanged = simulation.checkpoint();
    assert.throws(() => simulation.updateUnitEquipment(attacker, { ...upgraded, weapon: { ...upgraded.weapon, cooldownTicks: 0 } }));
    assert.throws(() => simulation.updateUnitEquipment(attacker, { ...upgraded, sourceDefense: { targetClass: -1, armorFactor: 256 } }));
    assert.deepEqual(simulation.checkpoint(), unchanged, "invalid equipment is atomic");
  });

  test(`upgrade session ${faction}: strict admission and marker state are authenticated`, async context => {
    context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => new Response(read(`public${String(input)}`)));
    const mission = await controlled(faction);
    const options = sourceBrowserCampaignSessionOptions(mission);
    assert.throws(() => new CampaignSession({ ...options, runtimeProfile: "strict-native", browserAi: undefined, browserEconomy: undefined }), /Adapted/);
    const session = new CampaignSession(options);
    const saved = json(session.checkpoint());
    assert.deepEqual(CampaignSession.restore(saved).checkpoint(), saved);
    Reflect.deleteProperty(saved.state.production!, "adaptedUpgrades");
    assert.throws(() => CampaignSession.restore(saved));
    const poor = new CampaignSession(sourceBrowserCampaignSessionOptions(await controlled(faction, 999)));
    const entry = records.find(entry => entry.rawFields[0] === 2 && entry.rawFields[1] === (faction === "human" ? 0 : 8)
      && entry.rawFields[2] === 0 && entry.rawFields[3] === 1)!;
    const before = poor.checkpoint();
    const result = poor.step({ clockMilliseconds: 50, productionVisits: poor.browserFrameContext(150).productionVisits,
      productionCommands: [{ id: "unfunded-upgrade", team: 0, action: { type: "reserve", dependency: entry.id } }] });
    assert.equal(result.ok, false);
    assert.deepEqual(poor.checkpoint(), before, "insufficient credit must reject the entire frame atomically");
  });
}
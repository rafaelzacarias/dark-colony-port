import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MISSION02_GOALS, classifyMission02, mission02CasualtyMismatches, mission02ArmyTarget, mission02ArmyGroups, mission02Purchase, mission02Approach, mission02ExpeditionLeader, mission02VisibleTarget, mission02ClearedGoals, mission02AssaultLeg } from "./fixtures/browser-campaign-playthrough";
import { parseTriggerScript } from "../extractors/data/triggers";
import { parseScenario } from "../extractors/data/scenario";
import { evaluateTriggerCondition, recordTriggerVictimLoss } from "../../src/engine/trigger-runtime";
import { loadSourceProductionOptions } from "../../src/engine/source-production-options";
import { productionChoices } from "../../src/engine/campaign-production";
import { NavigationGrid } from "../../src/engine/grid";

for (const faction of ["human", "alien"] as const) {
  test(`M02 production: ${faction} adapted collector is source-priced and publicly supported`, async () => {
    const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
    const stem = `${faction.toUpperCase()}/${faction.toUpperCase()}02`;
    const options = await loadSourceProductionOptions({ sessionId: `qa:${stem}`,
      mission: { faction, scenario: JSON.parse(read(`public/assets/generated/data/scenarios/${stem}.json`).toString()),
        units: JSON.parse(read("public/assets/generated/data/units.json").toString()).records },
      rawScenario: read(`raw_cd/DC/SCENARIO/${stem}.SCN`),
      configuration: { profile: "user-selected-source-campaign-fresh", mode: 0, localTeam: 0, race: faction === "human" ? 0 : 1 },
      adaptedCollectors: { runtimeProfile: "browser-adapted", completionVisits: 120 },
      loadBytes: async url => read(`public${url}`) });
    const unitType = MISSION02_GOALS[faction].harvester;
    const dependency = faction === "human" ? 7 : 21;
    assert.deepEqual(options.production!.units.find(unit => unit.unitType === unitType),
      { unitType, queue: 2, exitSelector: 0, exitOffset: { x: -4, y: 0 } });
    assert.equal(options.state!.catalog.find(entry => entry.id === dependency)!.cost, 1500);
    assert.equal(productionChoices(options.state!, 0).find(choice => choice.dependency === dependency)!.supported, true);
    assert.equal(options.choices.some(choice => choice.unitType === unitType), true);
    assert.deepEqual(options.production!.sourceProfiles.map(profile => profile.unitType), [faction === "human" ? 0 : 8]);
    assert.equal(options.state!.teams[0].credits, 0);
  });
  test(`M02 source contract: ${faction} exact original casualty objective`, () => {
    const name = faction.toUpperCase();
    const blocks = parseTriggerScript(readFileSync(new URL(
      `../../raw_cd/DC/SCENARIO/${name}/${name}02.TRO`, import.meta.url), "utf8"));
    const goal = MISSION02_GOALS[faction];
    const wins = blocks.filter(block => block.actions.some(action => action.name === "bail" && action.arguments[0] === 0));
    assert.equal(wins.length, 1);
    assert.equal(wins[0].id, goal.trigger);
    assert.equal(wins[0].condition, goal.condition);
    assert.ok(wins[0].actions.some(action => action.name === "bail" && action.arguments[1] === 1));
    assert.equal(blocks.some(block => block.mode === "trip"), false);
    const inputs = { cycleCounter: 0, clockMilliseconds: 0, buildingSlots: {} };
    assert.deepEqual(evaluateTriggerCondition(goal.condition, { [goal.statistic]: goal.required - 1 }, inputs), { ok: true, value: 0 });
    assert.deepEqual(evaluateTriggerCondition(goal.condition, { [goal.statistic]: goal.required }, inputs), { ok: true, value: 1 });
    const losses = blocks.filter(block => block.actions.some(action => action.name === "bail" && action.arguments[0] === 1));
    assert.deepEqual(losses.map(block => block.condition), faction === "human" ? [
      "((b(0,0)==0)&&(b(0,1)==0)&&(b(0,2)==0)&&(b(0,3)==0)&&(b(0,4)==0))", "(s(0,0,86)>0)",
    ] : ["((b(0,0)==0)&&(b(0,1)==0)&&(b(0,2)==0)&&(b(0,3)==0)&&(b(0,4)==0))"]);
    const unitType = goal.unitType ?? 8;
    const updated = recordTriggerVictimLoss({ [`${goal.team},3`]: 0, [`${goal.team},0,${unitType}`]: 0 }, goal.team, unitType);
    assert.equal(updated.ok, true);
    if (updated.ok) assert.equal(updated.value[goal.statistic], 1);
  });
}

test("M02 results: no pending, limit or diagnostic is reported as ready victory", () => {
  assert.equal(classifyMission02(null, undefined, 36000, 36000), "UNKNOWN");
  assert.equal(classifyMission02({ resultCode: 0, reasonCode: 1, ready: false }, undefined, 20, 36000), "RUNNING");
  assert.equal(classifyMission02({ resultCode: 0, reasonCode: 1, ready: true }, undefined, 20, 36000), "WIN");
  assert.equal(classifyMission02({ resultCode: 1, reasonCode: 3, ready: true }, undefined, 20, 36000), "LOSS");
  assert.equal(classifyMission02(null, "source failure", 20, 36000), "FAIL");
});

test("M02 strategy: replacement collector precedes infantry and respects funds, source gates, queue and exit", () => {
  for (const faction of ["human", "alien"] as const) {
    const collector = { dependency: faction === "human" ? 7 : 21, cost: 1500, enabled: true, pending: 0, queued: 0 };
    const infantry = { ...collector, dependency: MISSION02_GOALS[faction].dependency, cost: 350 };
    const menu = [infantry, collector];
    assert.equal(mission02Purchase(menu, faction, 0, 2, 24, 1500, () => true), collector);
    assert.equal(mission02Purchase(menu, faction, 0, 2, 24, 1499, () => true), undefined);
    for (const blocked of [{ enabled: false }, { pending: 1 }, { queued: 1 }]) {
      assert.equal(mission02Purchase([infantry, { ...collector, ...blocked }], faction, 0, 2, 24, 3000, () => true), undefined);
    }
    assert.equal(mission02Purchase(menu, faction, 0, 2, 24, 3000, dependency => dependency === infantry.dependency), undefined);
    assert.equal(mission02Purchase([infantry], faction, 0, 2, 24, 3000, () => true), undefined);
    assert.equal(mission02Purchase(menu, faction, 1, 10, 24, 1849, () => true), undefined);
    assert.equal(mission02Purchase(menu, faction, 1, 10, 24, 1850, () => true), infantry);
    assert.equal(mission02Purchase(menu, faction, 1, 6, 24, 1205, () => true), infantry);
    assert.equal(mission02Purchase(menu, faction, 1, 5, 24, 350, () => true), infantry);
    assert.equal(mission02Purchase(menu, faction, 1, 24, 24, 3000, () => true), undefined);
  }
});

test("M02 strategy: scouts approach a blocked resource footprint through passable cells", () => {
  const grid = new NavigationGrid(12, 12);
  const resource = { x: 8, y: 8 };
  const blocked = new Set([grid.index(resource.x, resource.y)]);
  const point = mission02Approach(grid, blocked, { x: 5, y: 5 }, resource)!;
  assert.ok(point);
  assert.equal(blocked.has(grid.index(point.x, point.y)), false);
  assert.equal(Math.abs(point.x - resource.x) + Math.abs(point.y - resource.y), 1);
  assert.deepEqual(mission02Approach(grid, new Set(), { x: 2, y: 2 }, { x: 0, y: 0 }), { x: 0, y: 0 });
  assert.equal(mission02Approach(new NavigationGrid(12, 12, new Uint16Array(144)), blocked,
    { x: 5, y: 5 }, resource), undefined);
});

test("M02 HUMAN s(0,10) is not a building-slot alias", () => {
  assert.deepEqual(evaluateTriggerCondition("s(0,10)==0", { "0,10": 0 },
    { cycleCounter: 0, clockMilliseconds: 0, buildingSlots: { "0,0": 500 } }), { ok: true, value: 1 });
  assert.deepEqual(evaluateTriggerCondition("s(0,10)==0", { "0,10": 1 },
    { cycleCounter: 0, clockMilliseconds: 0, buildingSlots: { "0,0": 0 } }), { ok: true, value: 0 });
});

test("M02 HUMAN source census: ten initial goal victims plus seventeen at the natural late event", () => {
  const scenario = parseScenario(readFileSync(new URL("../../raw_cd/DC/SCENARIO/HUMAN/HUMAN02.SCN", import.meta.url), "utf8"));
  const initial = scenario.placementRows.filter(row => row[3] === 2);
  assert.equal(initial.length, 10);
  const blocks = parseTriggerScript(readFileSync(new URL("../../raw_cd/DC/SCENARIO/HUMAN/HUMAN02.TRO", import.meta.url), "utf8"));
  const additions = blocks.flatMap(block => block.actions.filter(action =>
    action.name === "reinforce" && action.arguments[0] === 2).map(action => ({ block, action })));
  assert.equal(additions.length, 1);
  assert.equal(additions[0].block.condition, "((c>880)&&(s(0,10)==0))");
  assert.deepEqual(additions[0].action.arguments.slice(3, 7), [8, 10, 10, 7]);
  assert.equal(initial.length + 10 + 7, MISSION02_GOALS.human.required);
});

test("M02 casualty feedback: consumed deaths cannot silently lose goal or commander counters", () => {
  assert.deepEqual(mission02CasualtyMismatches({ "0,3": 1, "0,0,69": 1 }, { "0,3": 0, "0,0,69": 0 }), [
    { key: "0,3", expected: 1, actual: 0 }, { key: "0,0,69", expected: 1, actual: 0 },
  ]);
  assert.deepEqual(mission02CasualtyMismatches({ "1,3": 6, "1,0,86": 6 }, { "1,3": 6, "1,0,86": 6 }), []);
  assert.deepEqual(mission02CasualtyMismatches({ "2,3": 27 }, {}), [{ key: "2,3", expected: 27, actual: null }]);
});

test("M02 strategy: army adapts to objectives, armed statics and losses within a fixed cap", () => {
  assert.equal(mission02ArmyTarget(18, 27, 0, 0), 28);
  assert.equal(mission02ArmyTarget(18, 6, 2, 0), 24);
  assert.equal(mission02ArmyTarget(18, 1, 0, 0), 18);
  assert.equal(mission02ArmyTarget(18, 6, 8, 60), 40);
});

test("M02 strategy: rear guard remains separate from expedition without mutating the eligible army", () => {
  const troops = Array.from({ length: 24 }, (_, index) => ({ id: index + 10, cellX: 30 - index, cellY: 5 }));
  const before = structuredClone(troops);
  const groups = mission02ArmyGroups(troops, { x: 7, y: 5 });
  assert.equal(groups.guards.length, 15);
  assert.equal(groups.expedition.length, 9);
  assert.equal(new Set([...groups.guards, ...groups.expedition].map(actor => actor.id)).size, 24);
  assert.deepEqual(groups.expedition.map(actor => actor.id), [31, 30, 29, 28, 27, 26, 25, 24, 23]);
  assert.deepEqual(troops, before);
  assert.deepEqual(mission02ArmyGroups(troops.slice(0, 3), { x: 7, y: 5 }).expedition, []);
});

test("M02 strategy: launch eight assembled troops and retain survivors without admitting distant recruits", () => {
  const troops = Array.from({ length: 10 }, (_, index) => ({ id: index + 1, cellX: 5, cellY: 5 }));
  const home = { x: 5, y: 5 };
  assert.equal(mission02ArmyGroups(troops, home).expedition.length, 8);
  assert.equal(mission02ArmyGroups(troops.slice(0, 9), home).expedition.length, 0);
  const deployed = [3, 4, 5, 6];
  const distant = troops.map(actor => deployed.includes(actor.id) ? { ...actor, cellX: 50 } : actor);
  assert.deepEqual(mission02ArmyGroups(distant, home, deployed).expedition.map(actor => actor.id), deployed);
  assert.deepEqual(mission02ArmyGroups(distant.filter(actor => actor.id !== 3), home, deployed).expedition.map(actor => actor.id), [4, 5, 6]);
  assert.deepEqual(mission02ArmyGroups(distant.filter(actor => ![3, 4, 5].includes(actor.id)), home, deployed).expedition, []);
  assert.equal(mission02ArmyGroups(distant, home).expedition.length, 0);
});

test("M02 strategy: route the expedition from its rear instead of a lone forward soldier", () => {
  const troops = [{ id: 84, cellX: 20, cellY: 48 }, { id: 92, cellX: 14, cellY: 48 },
    { id: 93, cellX: 26, cellY: 21 }];
  const before = structuredClone(troops);
  assert.equal(mission02ExpeditionLeader(troops, { x: 26, y: 22 }).id, 92);
  assert.deepEqual(troops, before);
});

test("M02 strategy: nearby visible goals precede escorts but absent and distant goals cannot be targeted", () => {
  const escort = { id: 32, cellX: 29, cellY: 22, health: 338 };
  const goal = { id: 14, cellX: 26, cellY: 22, health: 300 };
  const farGoal = { id: 10, cellX: 93, cellY: 53, health: 250 };
  const objectives = new Set([14, 10]);
  assert.equal(mission02VisibleTarget([escort, goal, farGoal], { x: 29, y: 22 }, objectives), goal);
  assert.equal(mission02VisibleTarget([escort, farGoal], { x: 29, y: 22 }, objectives), escort);
  assert.equal(mission02VisibleTarget([farGoal], { x: 29, y: 22 }, objectives), undefined);
});

test("M02 strategy: exact objective casualty survives fog, escorts and checkpoint resume", () => {
  const goals = [{ key: "placement:13", type: 86 }, { key: "placement:14", type: 86 }];
  const bindings = [{ key: "placement:13", generation: 0, simulationId: 14 },
    { key: "placement:14", generation: 0, simulationId: 15 }];
  const loss = { id: JSON.stringify(["alien02:browser", "placement:13", 0]), victimTeam: 1, victimType: 86 };
  assert.deepEqual(mission02ClearedGoals(goals, bindings, [loss], 1), ["placement:13"]);
  assert.deepEqual(mission02ClearedGoals(goals, bindings, [], 1, [{ targetId: 14 }]), ["placement:13"]);
  for (const invalid of [{ ...loss, victimTeam: 2 }, { ...loss, victimType: 0 },
    { ...loss, id: JSON.stringify(["alien02:browser", "placement:13", 1]) }]) {
    assert.deepEqual(mission02ClearedGoals(goals, bindings, [invalid], 1), []);
  }
  assert.deepEqual(mission02ClearedGoals(goals, bindings, [], 1, [{ targetId: 99 }]), []);
  assert.deepEqual(mission02ClearedGoals(goals, bindings, [], 1), []);
});

test("M02 strategy: persistent assault legs wait for the rear without pulling back the front", () => {
  const destination = { x: 30, y: 5 }, point = { x: 15, y: 5 };
  const troops = [{ id: 1, cellX: 5, cellY: 5, activity: "idle" },
    { id: 2, cellX: 20, cellY: 5, activity: "move" }];
  const first = mission02AssaultLeg(troops, destination, "goal", 0, undefined, () => point);
  assert.deepEqual(first.ids, [1]);
  const moving = troops.map(actor => ({ ...actor, activity: "move" }));
  for (const tick of [20, 200, 380]) {
    const next = mission02AssaultLeg(moving, destination, "goal", tick, first.leg, () => assert.fail("unfinished leg was replanned"));
    assert.deepEqual(next.ids, []);
    assert.deepEqual(next.leg, first.leg);
  }
  const arrived = [{ ...troops[0], cellX: 14 }, troops[1]];
  const next = mission02AssaultLeg(arrived, destination, "goal", 200, first.leg, () => ({ x: 24, y: 5 }));
  assert.deepEqual(next.ids, [1, 2]);
  assert.deepEqual(next.leg?.point, { x: 24, y: 5 });
  assert.deepEqual(mission02AssaultLeg(moving, destination, "goal", 400, first.leg, () => point).ids, [1]);
  assert.deepEqual(mission02AssaultLeg(moving, destination, "next-goal", 20, first.leg, () => point).ids, [1]);
  const progress = mission02AssaultLeg([{ ...moving[0], cellX: 8 }, moving[1]], destination, "goal", 380, first.leg, () => point);
  assert.equal(progress.leg?.progressTick, 380);
  assert.deepEqual(mission02AssaultLeg([{ ...moving[0], cellX: 8 }, moving[1]], destination, "goal", 500,
    structuredClone(progress.leg), () => assert.fail("restored moving leg was replanned")).ids, []);
});

test("M02 loss control: commander death triggers recovery, not a rewritten original LOSS", () => {
  for (const faction of ["human", "alien"] as const) {
    const name = faction.toUpperCase(), commander = MISSION02_GOALS[faction].commander;
    const blocks = parseTriggerScript(readFileSync(new URL(
      `../../raw_cd/DC/SCENARIO/${name}/${name}02.TRO`, import.meta.url), "utf8"));
    const statistics = { ...Object.fromEntries([0, 1, 2, 3].map(offset => [`0,0,${commander + offset}`, 0])),
      [`0,0,${commander}`]: 1, "0,0,86": 0 };
    const inputs = { cycleCounter: 100, clockMilliseconds: 0,
      buildingSlots: Object.fromEntries([0, 1, 2, 3, 4].map(slot => [`0,${slot}`, 500])) };
    for (const loss of blocks.filter(block => block.actions.some(action => action.name === "bail" && action.arguments[0] === 1))) {
      assert.deepEqual(evaluateTriggerCondition(loss.condition, statistics, inputs), { ok: true, value: 0 });
    }
    const recovery = blocks.find(block => block.condition.includes(`s(0,0,${commander})==1`))!;
    assert.deepEqual(evaluateTriggerCondition(recovery.condition, statistics, inputs), { ok: true, value: 1 });
    assert.ok(recovery.actions.some(action => action.name === "setlifes"));
  }
});
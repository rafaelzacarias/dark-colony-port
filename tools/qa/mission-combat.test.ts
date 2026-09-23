import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MissionView } from "../../src/mission-view";
import type { CampaignMissionData } from "../../src/game-data";
import { evaluateTriggerCondition } from "../../src/engine/trigger-runtime";
import { sourceScenarioUpgradeLevels, verifiedNativeDefenseFromLegacy } from "../../src/engine/legacy-balance";

function json(relative: string) {
  return JSON.parse(readFileSync(new URL(`../../public/assets/generated/${relative}`, import.meta.url), "utf8"));
}

function words(relative: string): Uint16Array {
  const bytes = readFileSync(new URL(`../../public/assets/generated/${relative}`, import.meta.url));
  return Uint16Array.from({ length: bytes.length / 2 }, (_, index) => bytes.readUInt16LE(index * 2));
}

function mission(faction: "ALIEN" | "HUMAN" = "ALIEN"): CampaignMissionData {
  const stem = `${faction}/${faction}01`;
  const map = json(`maps/${stem}.json`);
  return {
    faction: faction === "ALIEN" ? "alien" : "human", map,
    scenario: json(`data/scenarios/${stem}.json`),
    triggers: json(`data/triggers/${stem}.json`).blocks,
    messages: json(`data/messages/${stem}.json`).messages,
    briefing: json(`data/briefings/${stem}.json`),
    units: json("data/units.json").records,
    weapons: json("data/weapons.json").records,
    terrain: json("terrain/DESERT.json"), terrainAtlasUrl: "",
    tileReferences: words(`maps/${faction}/${map.files.tileReferences}`),
    tileRecordIndices: words(`maps/${faction}/${map.files.tileRecordIndices}`),
    attributes: words(`maps/${faction}/${map.files.attributes}`),
    tags: readFileSync(new URL(`../../public/assets/generated/maps/${faction}/${map.files.tags}`, import.meta.url)),
    pathGrid: readFileSync(new URL(`../../public/assets/generated/maps/${faction}/${map.files.pathGrid}`, import.meta.url)),
  };
}

function createView(data: CampaignMissionData): MissionView {
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) } as HTMLCanvasElement;
  const view = new MissionView(canvas, {} as HTMLElement,
    { onStats() {}, onUnitsChanged() {} }, data);
  assert.equal(view.missionDiagnostic, undefined);
  view.render = () => {};
  return view;
}

function deliver(view: MissionView): number {
  let time = 0;
  view.update(time);
  for (let tick = 0; tick < 1000; tick += 1) {
    if (view.simulation.snapshot.units.filter(({ id }) => view.isOwnedUnit(id)).length === 5) return time;
    time += 50;
    view.update(time);
    assert.equal(view.missionDiagnostic, undefined);
  }
  assert.fail("Five source units must arrive through the session carrier");
}

function outcomeReady(view: MissionView): boolean {
  return view.missionOutcome?.ready ?? false;
}

for (const faction of ["HUMAN", "ALIEN"] as const) test(`${faction} live source damage uses initial upgrades, target class and current phase`, () => {
  const source = mission(faction);
  const data = { ...source, damageMatrix: json("data/damage-matrix.json").coefficients };
  assert.ok(data.damageMatrix);
  const view = createView(data);
  let time = deliver(view);
  const type = faction === "HUMAN" ? 0 : 8;
  const native = view.campaignSnapshot!.world.entities.find((entity) => entity.team === 0 && entity.unitType === type)!;
  const id = view.nativeBindings.find(({ key }) => key === native.key)!.simulationId;
  const attacker = view.simulation.snapshot.units.find((unit) => unit.id === id)!;
  view.replaceSelection([id]);
  const occupied = new Set([...view.simulation.snapshot.units, ...view.simulation.snapshot.staticTargets]
    .map((unit) => unit.cellY * view.grid.width + unit.cellX));
  const targetCell = view.grid.point(view.grid.neighbors(view.grid.index(attacker.cellX, attacker.cellY)).find((index) => !occupied.has(index))!);
  const targetType = faction === "HUMAN" ? 82 : 8;
  const team = faction === "HUMAN" ? 2 : 0;
  const stat = data.units.find(({ index }) => index === targetType)!;
  const defense = verifiedNativeDefenseFromLegacy(stat, sourceScenarioUpgradeLevels(data.scenario.teams[team], targetType));
  if (!defense.supported) assert.fail(defense.diagnostic);
  const targetId = view.simulation.addStaticTarget({ faction: faction === "HUMAN" ? "alien" : "human", team: faction === "HUMAN" ? 2 : 1,
    cell: targetCell, maxHealth: 1000, sourceDefense: defense.profile });
  view.setCameraCenter(targetCell.x + 0.5, targetCell.y + 0.5);
  view.commandAt(256, 226);
  time += 50; view.update(time);
  assert.equal(view.missionDiagnostic, undefined);
  const shot = view.simulation.combatEvents.find((event) => event.attackerId === id && event.targetId === targetId)!;
  assert.ok(shot);
  const phase = view.simulation.sourceDayNight!.phase;
  assert.equal(shot.damage, faction === "HUMAN" ? (phase === 0 ? 4 : 3) : (phase === 1 ? 24 : 18));
});

test("controlled combat fixture: eleven source objective deaths drive pickup and delayed bail, not a gameplay win", () => {
  const data = mission();
  const view = createView(data);
  const placements = data.scenario.placementRows.filter((row) => row[2] === 82 && row[3] === 1);
  assert.equal(placements.length, 11);
  const targets = placements.map(([x, y]) => view.simulation.snapshot.staticTargets.find(
    (target) => target.cellX === x && target.cellY === y)!);
  assert.ok(targets.every((target) => target.maxHealth === data.units[82].health));
  assert.equal(view.simulation.snapshot.units.filter((unit) => view.isOwnedUnit(unit.id)).length, 0);
  let time = deliver(view);
  const player = view.simulation.snapshot.units.filter((unit) => view.isOwnedUnit(unit.id));
  assert.equal(player.length, 5);
  assert.ok(player.every((unit) => unit.health === 800));
  const occupied = new Set(view.simulation.snapshot.units.map((unit) => unit.cellY * data.map.width + unit.cellX));
  const free = view.grid.costs.findIndex((cost, index) => cost > 0 && !occupied.has(index));
  const attacker = view.simulation.addUnit({
    faction: "alien", cell: { x: free % data.map.width, y: Math.floor(free / data.map.width) },
    weapon: { damage: data.units[82].health, rangeCells: 200, cooldownTicks: 1 },
  });
  for (const [index, target] of targets.entries()) {
    view.simulation.queue({ type: "attack", unitIds: [attacker], targetId: target.id });
    time += 50;
    view.update(time);
    assert.equal(view.missionDiagnostic, undefined);
    assert.equal(view.simulation.snapshot.staticTargets.find(({ id }) => id === target.id)?.health, 0);
    assert.equal(view.missionStatistics["1,0,82"], index + 1);
    const predicate = evaluateTriggerCondition("s(1,0,82)>10", view.missionStatistics,
      { cycleCounter: view.simulation.snapshot.tick, clockMilliseconds: time, buildingSlots: {} });
    assert.deepEqual(predicate, { ok: true, value: Number(index === 10) });
  }
  time += 50;
  view.update(time);
  assert.equal(view.missionStatistics["1,0,82"], 11);
  const copy = view.missionStatistics as Record<string, number>;
  copy["1,0,82"] = 99;
  assert.equal(view.missionStatistics["1,0,82"], 11);
  while (!view.missionOutcome && time < 60_000) {
    time += 50;
    view.update(time);
    assert.equal(view.missionDiagnostic, undefined);
  }
  assert.deepEqual(view.missionOutcome, { resultCode: 0, reasonCode: 1, ready: false });
  const bail = view.campaignSnapshot!.controller.runtime.bail!;
  const commander = view.campaignSnapshot!.world.entities.find(({ team, unitType }) => team === 0 && unitType === 73)!;
  const identity = view.nativeBindings.find(({ key }) => key === commander.key)!;
  while (time < bail.deadlineMilliseconds) {
    time += 50;
    view.update(time);
    assert.equal(view.missionDiagnostic, undefined);
  }
  assert.equal(view.missionOutcome!.ready, false);
  assert.equal(view.simulation.snapshot.units.some(({ id }) => id === identity.simulationId), false);
  assert.ok(view.campaignSnapshot!.world.entities.some(({ key }) => key === commander.key));
  assert.deepEqual(view.nativeBindings.find(({ key }) => key === commander.key), identity);
  assert.equal(view.missionStatistics["0,0,73"], 0);
  assert.equal(view.missionStatistics["1,0,82"], 11);
  const traces = view.campaignJournal.flatMap(({ trace }) => trace);
  assert.ok(traces.some(({ action }) => action.name === "abduct"));
  assert.ok(traces.some(({ action }) => action.name === "bail"));
  assert.ok(view.campaignJournal.some(({ requests }) => requests.some(({ type }) => type === "remove-noncombat")));
  assert.ok(view.campaignJournal.every(({ commands, receipts }) => commands.length === receipts.length));
  time += 50;
  view.update(time);
  assert.equal(view.missionDiagnostic, undefined);
  assert.deepEqual(view.missionOutcome, { resultCode: 0, reasonCode: 1, ready: true });
  const finished = view.simulation.snapshot.tick;
  view.update(time + 250);
  assert.equal(view.simulation.snapshot.tick, finished);
});

test("mission commands cannot attack unrevealed source targets", () => {
  const view = createView(mission());
  let time = deliver(view);
  view.selectAllPlayerUnits();
  assert.equal(view.selectedIds.length, 5);
  const target = view.simulation.snapshot.staticTargets.find((entry) =>
    entry.faction === "human" && view.visibility[entry.cellY * view.grid.width + entry.cellX] === 0)!;
  assert.ok(target);
  view.setCameraCenter(target.cellX + 0.5, target.cellY + 0.5);
  view.commandAt(256, 226);
  time += 50;
  view.update(time);
  assert.equal(view.missionDiagnostic, undefined);
  assert.ok(view.simulation.snapshot.units.filter((unit) => view.isOwnedUnit(unit.id)).every((unit) => unit.targetId === null));
});

test("source team race owns the Alien mind link despite its generic asset faction", () => {
  const data = mission();
  assert.equal(data.units[89].faction, 0);
  const view = createView(data);
  const mindLink = view.simulation.snapshot.staticTargets.find((target) => target.cellX === 23 && target.cellY === 25)!;
  assert.equal(mindLink.faction, "alien");
  assert.equal(view.isOwnedUnit(mindLink.id), true);
  assert.equal(view.simulation.snapshot.staticTargets.filter((target) => target.faction === "human").length, 11);
});

for (const faction of ["ALIEN", "HUMAN"] as const) {
  test(`${faction} controlled commander loss triggers the source failure and delayed result`, () => {
    const data = mission(faction);
    const view = createView(data);
    let time = deliver(view);
    const type = faction === "ALIEN" ? 73 : 69;
    const commander = view.campaignSnapshot!.world.entities.find((entity) => entity.team === 0 && entity.unitType === type)!;
    const targetId = view.nativeBindings.find((binding) => binding.key === commander.key)!.simulationId;
    const occupied = new Set(view.simulation.snapshot.units.map((unit) => unit.cellY * view.grid.width + unit.cellX));
    const free = view.grid.costs.findIndex((cost, index) => cost > 0 && !occupied.has(index));
    const attacker = view.simulation.addUnit({ faction: faction === "ALIEN" ? "human" : "alien",
      cell: { x: free % view.grid.width, y: Math.floor(free / view.grid.width) },
      weapon: { damage: 800, rangeCells: 200, cooldownTicks: 1 } });
    view.simulation.queue({ type: "attack", unitIds: [attacker], targetId });
    for (let tick = 0; tick < 220 && !outcomeReady(view); tick += 1) {
      time += 50; view.update(time);
      assert.equal(view.missionDiagnostic, undefined);
    }
    assert.deepEqual(view.missionOutcome, { resultCode: 1, reasonCode: faction === "ALIEN" ? 2 : 3, ready: true });
    assert.equal(view.missionStatistics[`0,0,${type}`], 1);
  });
}

test("HUMAN controlled colony-security losses require source beacon trip arming before victory", () => {
  const view = createView(mission("HUMAN"));
  let time = deliver(view);
  const teamFour = view.campaignSnapshot!.world.entities.filter((entity) => entity.team === 4);
  assert.equal(teamFour.length, 3);
  const occupied = new Set(view.simulation.snapshot.units.map((unit) => unit.cellY * view.grid.width + unit.cellX));
  const free = view.grid.costs.findIndex((cost, index) => cost > 0 && !occupied.has(index));
  const attacker = view.simulation.addUnit({ faction: "human",
    cell: { x: free % view.grid.width, y: Math.floor(free / view.grid.width) },
    weapon: { damage: 800, rangeCells: 200, cooldownTicks: 1 } });
  for (const entity of teamFour) {
    const targetId = view.nativeBindings.find((binding) => binding.key === entity.key)!.simulationId;
    view.simulation.queue({ type: "attack", unitIds: [attacker], targetId });
    time += 50; view.update(time);
    assert.equal(view.missionDiagnostic, undefined);
  }
  assert.equal(view.missionStatistics["4,3"], 3);
  assert.equal(view.missionOutcome, null);
  assert.equal(view.campaignSnapshot!.controller.runtime.lives[4], 0);
  const soldier = view.simulation.snapshot.units.find((unit) => view.isOwnedUnit(unit.id))!;
  view.recordDestinationReservation(soldier.id, 25, 59);
  for (let tick = 0; tick < 220 && !outcomeReady(view); tick += 1) {
    time += 50; view.update(time);
    assert.equal(view.missionDiagnostic, undefined);
  }
  assert.deepEqual(view.missionOutcome, { resultCode: 0, reasonCode: 1, ready: true });
  const beacon = view.campaignSnapshot!.world.entities.find((entity) => entity.tileX === 26 && entity.tileY === 59)!;
  assert.equal(beacon.unitType, 84);
  assert.equal(beacon.team, 1);
});
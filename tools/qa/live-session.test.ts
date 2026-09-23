import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MissionView, MISSION_BROWSER_POLICY, missionVisualSprites, missionAnimationArchives } from "../../src/mission-view";
import type { CampaignMissionData } from "../../src/game-data";
import { projectLegacyColony } from "../../src/engine/legacy-colony";
import { SUBCELLS_PER_CELL } from "../../src/engine";
import { parseScenario } from "../extractors/data/scenario";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { parseTriggerScript } from "../extractors/data/triggers";
import { parseMissionMessages } from "../extractors/data/messages";
import { parseMapBundle } from "../extractors/maps/map";

function fixture(faction: "HUMAN" | "ALIEN"): CampaignMissionData {
  const read = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url));
  const source = (extension: string) => read(`SCENARIO/${faction}/${faction}01.${extension}`);
  const map = parseMapBundle(source("MAP"), source("MTG"), source("PTH"));
  const generated = (path: string) => JSON.parse(readFileSync(new URL(`../../public/assets/generated/${path}`, import.meta.url), "utf8"));
  return {
    faction: faction === "HUMAN" ? "human" : "alien",
    scenario: { ...generated(`data/scenarios/${faction}/${faction}01.json`), ...parseScenario(source("SCN").toString()) },
    map: generated(`maps/${faction}/${faction}01.json`),
    triggers: parseTriggerScript(source("TRO").toString()), messages: parseMissionMessages(source("MSG").toString()),
    units: parseUnitStats(read("GAMESTAT/GAMESTAT.TXT").toString()),
    weapons: parseWeaponStats(read("GAMESTAT/WEAPSTAT.TXT").toString()),
    briefing: generated(`data/briefings/${faction}/${faction}01.json`),
    terrain: generated("terrain/DESERT.json"), terrainAtlasUrl: "",
    pathGrid: map.pathGrid, tags: map.tagGrid,
    tileReferences: new Uint16Array(0), tileRecordIndices: new Uint16Array(0), attributes: new Uint16Array(0),
  };
}

function createView(data: CampaignMissionData): MissionView {
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) } as HTMLCanvasElement;
  const view = new MissionView(canvas, {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, data);
  view.render = () => {};
  assert.equal(view.missionDiagnostic, undefined);
  view.update(0);
  return view;
}

function step(view: MissionView, count = 1): void {
  for (let tick = 0; tick < count; tick += 1) {
    view.update((view.simulation.snapshot.tick + 1) * MISSION_BROWSER_POLICY.fixedStepMilliseconds);
    assert.equal(view.missionDiagnostic, undefined);
  }
}

function deliver(view: MissionView): void {
  for (let count = 0; count < 1000; count += 1) {
    if (view.simulation.snapshot.units.filter(({ id }) => view.isOwnedUnit(id)).length === 5) return;
    step(view);
  }
  assert.fail("Real session did not deliver five player units");
}

for (const faction of ["HUMAN", "ALIEN"] as const) {
  test(`${faction}01 live source startup has zero troops before real delayed delivery`, () => {
    const data = fixture(faction);
    const view = createView(data);
    assert.equal(view.simulation.snapshot.units.filter(({ id }) => view.isOwnedUnit(id)).length, 0);
    const initial = view.campaignSnapshot!;
    assert.deepEqual(initial.controller.blocks, data.triggers);
    assert.equal(initial.world.entities.length, data.scenario.placementRows.length + projectLegacyColony(data.scenario.teams, data.units).buildings.length);
    for (const entity of initial.world.entities.filter(({ health }) => health > 0)) {
      const binding = view.nativeBindings.find(({ slot, generation }) => slot === entity.rawSlot && generation === entity.generation)!;
      assert.equal(binding.key, entity.key);
      assert.equal(binding.sourceRow, entity.sourceRow);
      if (entity.sourceRow !== null) assert.equal(binding.slot, 152 + entity.sourceRow);
      const simulated = [...view.simulation.snapshot.units, ...view.simulation.snapshot.staticTargets].find(({ id }) => id === binding.simulationId)!;
      assert.equal(simulated.health, entity.health);
      assert.equal(simulated.maxHealth, entity.maxHealth);
      assert.equal(simulated.team, entity.team);
    }
    step(view, 15);
    assert.equal(view.campaignSnapshot!.world.messages.length, 0);
    assert.equal(view.selectedIds.length, 0);
    step(view);
    assert.equal(view.campaignSnapshot!.cycleCounter, 16);
    assert.equal(view.campaignSnapshot!.world.messages[0].clockMilliseconds, 800);
    assert.equal(view.campaignSnapshot!.world.messages[0].messageId, 1);
    assert.equal(view.simulation.snapshot.units.filter(({ id }) => view.isOwnedUnit(id)).length, 0);
    assert.equal(view.carrierVisuals.length, 1);
    assert.equal(view.carrierVisuals[0].sprite, faction === "HUMAN" ? "DROP" : "SAUC");
    deliver(view);
    const player = view.simulation.snapshot.units.filter(({ id }) => view.isOwnedUnit(id));
    assert.equal(player.length, 5);
    assert.ok(player.every(({ health }) => health === 800));
    const delivered = view.campaignSnapshot!.world.entities.filter(({ key, team }) => key.startsWith("transport:") && team === 0);
    assert.deepEqual(delivered.map(({ unitType }) => unitType).sort((left, right) => left - right),
      faction === "HUMAN" ? [0, 0, 0, 0, 69] : [8, 8, 8, 8, 73]);
    assert.ok(view.campaignJournal.filter(({ requests }) => requests.some(({ type }) => type === "create")).length > 1);
    const startup = view.campaignJournal.find(({ cycleCounter }) => cycleCounter === 16)!;
    assert.equal(startup.trace.length, data.triggers.filter(({ mode, condition }) => mode === "norm" && condition === "(c>0)")
      .reduce((count, block) => count + block.actions.length, 0));
    assert.equal(startup.commands.length, startup.receipts.length);
    assert.ok(startup.trace.some(({ action }) => action.name === "reinforce"));
    view.replaceSelection([player[0].id, -1]);
    assert.deepEqual(view.selectedIds, [player[0].id]);
    assert.equal(view.visibility[player[0].cellY * view.grid.width + player[0].cellX], 1);
    view.setCameraCenter(player[0].cellX + 0.5, player[0].cellY + 0.5);
    assert.equal(view.cameraView.width, 16);
    view.clearSelection();
    view.commandAt(256, 226);
    assert.deepEqual(view.selectedIds, [player[0].id]);
    view.selectAllPlayerUnits();
    assert.equal(view.selectedIds.length, 5);
    assert.equal(view.missionOutcome, null);
  });
}

test("HUMAN01 live colony uses native slots, exact positions, HP and footprints", () => {
  const data = fixture("HUMAN");
  const view = createView(data);
  const colony = projectLegacyColony(data.scenario.teams, data.units);
  assert.deepEqual(view.campaignSnapshot!.world.buildingSlots, colony.buildingSlots);
  for (const building of colony.buildings) {
    const binding = view.nativeBindings.find(({ slot }) => slot === building.nativeId)!;
    assert.equal(binding.key, `colony:${building.nativeId}`);
    const target = view.simulation.snapshot.staticTargets.find(({ id }) => id === binding.simulationId)!;
    assert.equal(target.xSubcells, building.nativePosition.x * SUBCELLS_PER_CELL / 256);
    assert.equal(target.ySubcells, building.nativePosition.y * SUBCELLS_PER_CELL / 256);
    assert.equal(target.health, building.health);
    for (const point of building.footprint) assert.equal(view.grid.isPassable(point.x, point.y), false);
  }
});

test("full TRO preload includes dormant newtype, reinforcements and both composite carriers", () => {
  const data = fixture("HUMAN");
  const sprites = missionVisualSprites(data);
  assert.ok(sprites.includes(data.units[84].sprite));
  assert.ok(sprites.includes("DROP"));
  assert.ok(sprites.includes("SAUC"));
  for (const block of data.triggers) for (const action of block.actions) {
    if (action.name === "reinforce" || action.name === "reinforce2") {
      for (let index = 3; index + 1 < action.arguments.length; index += 2) {
        if (Number(action.arguments[index + 1]) > 0) assert.ok(sprites.includes(data.units[Number(action.arguments[index])].sprite));
      }
    }
  }
});

test("colony definitions resolve shared source FIN archives instead of nonexistent filenames", () => {
  for (const sprite of ["EXCOPOD", "BRRKPOD"]) {
    const states = missionAnimationArchives(sprite).flatMap((name) => {
      const metadata = JSON.parse(readFileSync(new URL(`../../public/assets/generated/animations/${name}.json`, import.meta.url), "utf8"));
      return metadata.states.map((state: { name: string }) => state.name);
    });
    assert.ok(states.includes(`${sprite}STAND0`));
    assert.ok(states.includes(`${sprite}DIE0`));
  }
});

test("HUMAN01 explicit successful reservation changes beacon render type and keeps its identity", () => {
  const view = createView(fixture("HUMAN"));
  deliver(view);
  const soldier = view.simulation.snapshot.units.find(({ id }) => view.isOwnedUnit(id))!;
  const beacon = view.campaignSnapshot!.world.entities.find(({ tileX, tileY }) => tileX === 26 && tileY === 59)!;
  const binding = view.nativeBindings.find(({ key }) => key === beacon.key)!;
  assert.equal(view.campaignSnapshot!.controller.runtime.lives[7], 1);
  view.recordDestinationReservation(soldier.id, 25, 59);
  step(view);
  assert.equal(view.campaignSnapshot!.controller.runtime.lives[7], 0);
  assert.equal(view.campaignSnapshot!.world.entities.find(({ key }) => key === beacon.key)!.unitType, 84);
  assert.equal(view.unitName(binding.simulationId), view.mission.units[84].sprite);
  assert.deepEqual(view.nativeBindings.find(({ key }) => key === beacon.key), binding);
  const trace = view.campaignJournal.at(-1)!;
  assert.ok(trace.fired.includes(7));
  assert.ok(trace.trace.some(({ action }) => action.name === "setlifes"));
  assert.ok(trace.trace.some(({ action }) => action.name === "newtype"));
  step(view, 3);
  assert.equal(view.unitName(binding.simulationId), view.mission.units[84].sprite);
});

test("invalid reservation stops further mission ticks with a visible diagnostic contract", () => {
  const view = createView(fixture("HUMAN"));
  view.recordDestinationReservation(-1, 0, 0);
  assert.match(view.missionDiagnostic!, /Reservation has no active source identity/);
  const before = view.simulation.snapshot.tick;
  view.update(250);
  assert.equal(view.simulation.snapshot.tick, before);
});

for (const combat of [false, true]) test(`player patrol repeats both endpoints${combat ? " after combat" : ""} and Stop removes the route`, () => {
  const view = createView(fixture("HUMAN"));
  deliver(view);
  const units = view.simulation.snapshot.units;
  const occupied = new Set(units.map((unit) => unit.cellY * view.grid.width + unit.cellX));
  const pair = units.filter((unit) => view.isOwnedUnit(unit.id)).flatMap((unit) =>
    view.grid.neighbors(view.grid.index(unit.cellX, unit.cellY)).filter((index) => !occupied.has(index))
      .map((index) => ({ unit, target: view.grid.point(index) })))[0];
  assert.ok(pair);
  view.replaceSelection([pair.unit.id]);
  view.setCameraCenter(pair.unit.cellX + 0.5, pair.unit.cellY + 0.5);
  view.setOrderMode("patrol");
  const camera = view.cameraView;
  view.commandAt((pair.target.x + 0.5 - camera.x) * 32,
    (camera.y + camera.height - pair.target.y - 0.5) * 32);
  const enemy = combat ? view.simulation.addStaticTarget({ faction: "alien", cell: pair.target, maxHealth: 1 }) : null;
  if (enemy !== null) {
    step(view);
    assert.equal(view.simulation.snapshot.units.find(({ id }) => id === pair.unit.id)!.activity, "attack");
  }
  const visited: string[] = [];
  for (let tick = 0; tick < 80; tick += 1) {
    step(view);
    const unit = view.simulation.snapshot.units.find(({ id }) => id === pair.unit.id)!;
    if (unit.xSubcells % 1024 === 512 && unit.ySubcells % 1024 === 512) {
      const cell = `${unit.cellX},${unit.cellY}`;
      if (visited.at(-1) !== cell) visited.push(cell);
    }
  }
  assert.ok(visited.length >= 4, JSON.stringify(visited));
  if (enemy !== null) assert.equal(view.simulation.snapshot.staticTargets.find(({ id }) => id === enemy)!.health, 0);
  view.stopSelected();
  step(view);
  const stopped = view.simulation.snapshot.units.find(({ id }) => id === pair.unit.id)!;
  step(view, 30);
  assert.deepEqual(view.simulation.snapshot.units.find(({ id }) => id === pair.unit.id), stopped);
});

for (const combat of [false, true]) test(`plotted player waypoints wait for confirmation then finish in order${combat ? " after combat" : ""} without restarting`, () => {
  const view = createView(fixture("HUMAN"));
  deliver(view);
  const units = view.simulation.snapshot.units;
  const occupied = new Set(units.map((unit) => unit.cellY * view.grid.width + unit.cellX));
  const unit = units.find((entry) => view.isOwnedUnit(entry.id) &&
    view.grid.neighbors(view.grid.index(entry.cellX, entry.cellY)).some((index) => !occupied.has(index)))!;
  const first = view.grid.point(view.grid.neighbors(view.grid.index(unit.cellX, unit.cellY)).find((index) => !occupied.has(index))!);
  view.replaceSelection([unit.id]);
  view.setCameraCenter(unit.cellX + 0.5, unit.cellY + 0.5);
  view.setOrderMode("waypoints");
  const camera = view.cameraView;
  const click = (x: number, y: number) => view.commandAt((x + 0.5 - camera.x) * 32,
    (camera.y + camera.height - y - 0.5) * 32);
  click(first.x, first.y);
  click(unit.cellX, unit.cellY);
  assert.deepEqual(view.plottedWaypoints, [first, { x: unit.cellX, y: unit.cellY }]);
  step(view, 20);
  assert.deepEqual(view.simulation.snapshot.units.find(({ id }) => id === unit.id), unit);
  click(unit.cellX, unit.cellY);
  assert.deepEqual(view.plottedWaypoints, []);
  assert.equal(view.orderMode, "context");
  const enemy = combat ? view.simulation.addStaticTarget({ faction: "alien", cell: first, maxHealth: 1 }) : null;
  let sawFirst = false;
  for (let tick = 0; tick < 70; tick += 1) {
    step(view);
    const current = view.simulation.snapshot.units.find(({ id }) => id === unit.id)!;
    if (current.cellX === first.x && current.cellY === first.y) sawFirst = true;
  }
  assert.equal(sawFirst, true);
  if (enemy !== null) assert.equal(view.simulation.snapshot.staticTargets.find(({ id }) => id === enemy)!.health, 0);
  const final = view.simulation.snapshot.units.find(({ id }) => id === unit.id)!;
  assert.deepEqual([final.cellX, final.cellY, final.activity], [unit.cellX, unit.cellY, "idle"]);
  step(view, 20);
  assert.deepEqual(view.simulation.snapshot.units.find(({ id }) => id === unit.id), final);
});

test("live mission cursor agrees with visible sprite hit tests and order modes", () => {
  const view = createView(fixture("HUMAN"));
  deliver(view);
  const soldier = view.simulation.snapshot.units.filter((unit) => view.isOwnedUnit(unit.id)).at(-1)!;
  view.setCameraCenter(soldier.cellX + 0.5, soldier.cellY + 0.5);
  assert.equal(view.cursorAt(256, 226), "select");
  const bodyX = 256 + (soldier.xSubcells / 1024 - soldier.cellX - 0.5) * 32;
  const bodyY = 226 - (soldier.ySubcells / 1024 - soldier.cellY - 0.5) * 32;
  assert.equal(view.cursorAt(bodyX, bodyY - 24), "select");
  assert.equal(view.cursorAt(256, 226, true), "drag");
  const occupied = new Set(view.simulation.snapshot.units.map((unit) => unit.cellY * view.grid.width + unit.cellX));
  const free = view.grid.neighbors(view.grid.index(soldier.cellX, soldier.cellY)).find((index) => !occupied.has(index))!;
  const point = view.grid.point(free);
  const camera = view.cameraView;
  const screenX = (point.x + 0.5 - camera.x) * 32;
  const screenY = (camera.y + camera.height - point.y - 0.5) * 32;
  view.setOrderMode("move");
  assert.equal(view.cursorAt(screenX, screenY), "move");
  view.setOrderMode("assault");
  assert.equal(view.cursorAt(screenX, screenY), "attack");
  const targetId = view.simulation.addStaticTarget({ faction: "alien", cell: point, maxHealth: 100 });
  assert.equal(view.cursorAt(screenX, screenY), "attack");
  view.commandAt(screenX, screenY);
  step(view);
  assert.ok(view.simulation.snapshot.units.some((unit) => view.isOwnedUnit(unit.id) && unit.targetId === targetId));
  view.clearSelection();
  assert.equal(view.cursorAt(screenX, screenY), "default");
});

test("unfinished waypoint plots cancel without issuing movement or leaking to a new selection", () => {
  const view = createView(fixture("HUMAN"));
  deliver(view);
  const unit = view.simulation.snapshot.units.find((entry) => view.isOwnedUnit(entry.id))!;
  view.setCameraCenter(unit.cellX + 0.5, unit.cellY + 0.5);
  const cancellations = [
    () => view.clearSelection(),
    () => view.replaceSelection([unit.id]),
    () => view.selectUnit(unit.id),
    () => view.selectAllPlayerUnits(),
    () => view.selectVisibleInfantry(),
    () => view.selectUnitsInClientRect(0, 0, 512, 452),
    () => view.setOrderMode("move"),
    () => view.setOrderMode("patrol"),
    () => view.stopSelected(),
  ];
  for (const cancel of cancellations) {
    view.replaceSelection([unit.id]);
    view.setOrderMode("waypoints");
    view.commandAt(256, 226);
    assert.equal(view.plottedWaypoints.length, 1);
    cancel();
    assert.deepEqual(view.plottedWaypoints, []);
    step(view);
    assert.deepEqual(view.simulation.snapshot.units.find(({ id }) => id === unit.id), unit);
  }
});

test("plotting and canceling a new route preserves an existing movement order", () => {
  const view = createView(fixture("HUMAN"));
  deliver(view);
  const units = view.simulation.snapshot.units;
  const occupied = new Set(units.map((unit) => unit.cellY * view.grid.width + unit.cellX));
  const unit = units.find((entry) => view.isOwnedUnit(entry.id) &&
    view.grid.neighbors(view.grid.index(entry.cellX, entry.cellY)).some((index) => !occupied.has(index)))!;
  const target = view.grid.point(view.grid.neighbors(view.grid.index(unit.cellX, unit.cellY)).find((index) => !occupied.has(index))!);
  view.replaceSelection([unit.id]);
  view.setCameraCenter(unit.cellX + 0.5, unit.cellY + 0.5);
  view.setOrderMode("move");
  const camera = view.cameraView;
  view.commandAt((target.x + 0.5 - camera.x) * 32, (camera.y + camera.height - target.y - 0.5) * 32);
  view.setOrderMode("waypoints");
  view.commandAt(256, 226);
  assert.equal(view.plottedWaypoints.length, 1);
  view.clearSelection();
  step(view, 30);
  const final = view.simulation.snapshot.units.find(({ id }) => id === unit.id)!;
  assert.deepEqual([final.cellX, final.cellY, final.activity], [target.x, target.y, "idle"]);
});

test("unsupported full-source actions stop transactionally instead of being ignored", () => {
  const data = fixture("HUMAN");
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) } as HTMLCanvasElement;
  const view = new MissionView(canvas, {} as HTMLElement, { onStats() {}, onUnitsChanged() {} },
    { ...data, triggers: [...data.triggers,
      { id: 127, mode: "norm", flag: 1, condition: "(c>0)", actions: [{ name: "unknown", arguments: [] }] }] });
  view.render = () => {};
  view.update(800);
  assert.match(view.missionDiagnostic!, /TRO 127: unknown:.*not verified/);
  assert.equal(view.campaignSnapshot, null);
  assert.equal(view.campaignJournal.length, 0);
  view.update(1000);
  assert.equal(view.simulation.snapshot.tick, 0);
});

test("mission exploration persists without rendering and is isolated from callers and new sessions", () => {
  const view = createView(fixture("HUMAN"));
  assert.equal(view.explored.some(Boolean), false);
  deliver(view);
  const visible = view.visibility;
  const visited = visible.findIndex(Boolean);
  assert.ok(visited >= 0);
  assert.equal(view.explored[visited], 1);
  const copy = view.explored;
  copy.fill(0);
  assert.equal(view.explored[visited], 1);
  for (const unit of view.simulation.snapshot.units.filter(({ id }) => view.isOwnedUnit(id))) view.simulation.removeUnit(unit.id);
  assert.equal(view.visibility[visited], 0);
  assert.equal(view.explored[visited], 1);
  assert.ok(view.explored.some((value, index) => value === 0 && visible[index] === 0));
  assert.equal(createView(fixture("HUMAN")).explored.some(Boolean), false);
});

test("live commands distinguish same-race enemies from cross-race allies", () => {
  const source = fixture("HUMAN");
  const view = createView({ ...source, scenario: { ...source.scenario, teams: source.scenario.teams.map((team) =>
    team.index === 0 ? { ...team, allies: team.allies.map((value, index) => index === 1 ? 0 : index === 2 ? 1 : value) } : team) } });
  deliver(view);
  const unit = view.simulation.snapshot.units.find((entry) => view.isOwnedUnit(entry.id))!;
  view.replaceSelection([unit.id]);
  const occupied = new Set([...view.simulation.snapshot.units, ...view.simulation.snapshot.staticTargets]
    .map((entity) => entity.cellY * view.grid.width + entity.cellX));
  const index = view.grid.neighbors(view.grid.index(unit.cellX, unit.cellY)).find((cell) => !occupied.has(cell))!;
  const cell = view.grid.point(index);
  view.setCameraCenter(cell.x + 0.5, cell.y + 0.5);
  const ally = view.simulation.addUnit({ faction: "alien", team: 2, cell });
  assert.notEqual(view.cursorAt(256, 226), "attack");
  view.commandAt(256, 226);
  step(view);
  assert.notEqual(view.simulation.snapshot.units.find(({ id }) => id === unit.id)!.targetId, ally);
  view.simulation.removeUnit(ally);
  const enemy = view.simulation.addUnit({ faction: "human", team: 1, cell });
  assert.equal(view.cursorAt(256, 226), "attack");
  view.commandAt(256, 226);
  step(view);
  assert.equal(view.simulation.snapshot.units.find(({ id }) => id === unit.id)!.targetId, enemy);
});
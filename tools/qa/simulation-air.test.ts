import assert from "node:assert/strict";
import test from "node:test";
import { NavigationGrid } from "../../src/engine/grid";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { calculateLegacyDamage, unitOptionsFromLegacy } from "../../src/engine/legacy-balance";
import { loadCampaignMission } from "../../src/game-data";
import { readFileSync } from "node:fs";

test("air plane: explicit bounded admission leaves ground terrain unchanged", () => {
  const grid = new NavigationGrid(4, 4, new Uint16Array(16));
  const simulation = new DeterministicSimulation(grid);
  const options = { faction: "alien" as const, cell: { x: 1, y: 1 } };
  assert.throws(() => simulation.addUnit(options), /not passable/);
  simulation.addUnit({ ...options, movementPlane: "air" });
  assert.throws(() => simulation.addUnit({ ...options, movementPlane: "air", cell: { x: 4, y: 1 } }), /not passable/);
  assert.deepEqual([...grid.costs], new Array(16).fill(0));
  const saved = simulation.checkpoint();
  assert.equal(saved.units[0].movementPlane, "air");
  assert.deepEqual(DeterministicSimulation.restore(JSON.parse(JSON.stringify(saved))).checkpoint(), saved);
  const invalid = structuredClone(saved);
  Object.assign(invalid.units[0], { movementPlane: "water" });
  assert.throws(() => DeterministicSimulation.restore(invalid), /checkpoint/);
});

test("air plane: omitted legacy plane remains ground with unchanged JSON shape", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(4, 4));
  const id = simulation.addUnit({ faction: "human", cell: { x: 1, y: 1 } });
  simulation.queue({ type: "move", unitIds: [id], target: { x: 3, y: 1 } });
  simulation.advance();
  const saved = simulation.checkpoint();
  assert.equal(Object.hasOwn(saved.units[0], "movementPlane"), false);
  assert.ok(saved.movementReservations.every(entry => !Object.hasOwn(entry, "plane")));
  assert.deepEqual(DeterministicSimulation.restore(JSON.parse(JSON.stringify(saved))).checkpoint(), saved);
});

test("air plane: mixed formation, reservations and JSON continuation stay plane-local", () => {
  const grid = new NavigationGrid(8, 5);
  const simulation = new DeterministicSimulation(grid);
  const ground = simulation.addUnit({ faction: "human", cell: { x: 1, y: 2 } });
  const air = simulation.addUnit({ faction: "human", cell: { x: 1, y: 2 }, movementPlane: "air" });
  simulation.queue({ type: "move", unitIds: [air, ground], target: { x: 6, y: 2 } });
  simulation.advance();
  const saved = simulation.checkpoint();
  assert.deepEqual(saved.units[0].path, saved.units[1].path);
  assert.ok(saved.movementReservations.some(entry => entry.plane === "air"));
  const restored = DeterministicSimulation.restore(JSON.parse(JSON.stringify(saved)));
  for (let tick = 0; tick < 30; tick++) {
    simulation.advance(); restored.advance();
    assert.deepEqual(restored.checkpoint(), simulation.checkpoint());
  }
  assert.ok(simulation.snapshot.units.every(unit => unit.cellX === 6 && unit.cellY === 2 && unit.activity === "idle"));
  const invalid = structuredClone(saved);
  Object.assign(invalid.movementReservations.find(entry => entry.plane === "air")!, { plane: "ground" });
  assert.throws(() => DeterministicSimulation.restore(invalid), /checkpoint/);
});

test("air plane: airborne formations cross terrain and static footprints without overlapping each other", () => {
  const grid = new NavigationGrid(8, 5, new Uint16Array(40));
  const simulation = new DeterministicSimulation(grid);
  const ids = [1, 3].map(y => simulation.addUnit({ faction: "human", movementPlane: "air", cell: { x: 0, y } }));
  simulation.addStaticTarget({ faction: "human", cell: { x: 3, y: 2 }, footprint: [{ x: 3, y: 2 }], maxHealth: 10 });
  simulation.queue({ type: "move", unitIds: ids, target: { x: 7, y: 2 } });
  for (let tick = 0; tick < 100; tick++) {
    simulation.advance();
    const [first, second] = simulation.snapshot.units;
    assert.notDeepEqual([first.xSubcells, first.ySubcells], [second.xSubcells, second.ySubcells]);
  }
  assert.ok(simulation.snapshot.units.every(unit => unit.cellX >= 6 && unit.activity === "idle"));
  assert.deepEqual([...grid.costs], new Array(40).fill(0));
});

test("air plane: diagonal floating movement reserves swept corners and replays mid-segment", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(6, 6));
  const first = simulation.addUnit({ faction: "human", movementPlane: "air", cell: { x: 1, y: 1 } });
  const second = simulation.addUnit({ faction: "human", movementPlane: "air", cell: { x: 2, y: 1 } });
  simulation.queue({ type: "move", unitIds: [first], target: { x: 4, y: 4 } });
  simulation.queue({ type: "move", unitIds: [second], target: { x: 1, y: 4 } });
  simulation.advance();
  const restored = DeterministicSimulation.restore(JSON.parse(JSON.stringify(simulation.checkpoint())));
  for (let tick = 0; tick < 60; tick++) {
    simulation.advance(); restored.advance();
    assert.deepEqual(restored.checkpoint(), simulation.checkpoint());
    const [left, right] = simulation.snapshot.units;
    assert.notDeepEqual([left.xSubcells, left.ySubcells], [right.xSubcells, right.ySubcells]);
  }
  assert.ok(simulation.snapshot.units.every(unit => unit.activity === "idle"));
  const direct = new DeterministicSimulation(new NavigationGrid(6, 6, new Uint16Array(36)));
  const id = direct.addUnit({ faction: "human", movementPlane: "air", cell: { x: 1, y: 1 } });
  direct.queue({ type: "move", unitIds: [id], target: { x: 4, y: 4 } });
  direct.advance();
  const unit = direct.snapshot.units[0];
  assert.ok(unit.xSubcells > 1536);
  assert.equal(unit.xSubcells, unit.ySubcells);
  assert.equal(direct.checkpoint().units[0].path.length, 4);
});

test("air plane: ground attackers approach a hovering target over impassable terrain and stop before firing", () => {
  const grid = new NavigationGrid(10, 3);
  for (let cellY = 0; cellY < 3; cellY++) for (let cellX = 6; cellX < 10; cellX++) grid.costs[grid.index(cellX, cellY)] = 0;
  const simulation = new DeterministicSimulation(grid);
  const attacker = simulation.addUnit({ faction: "human", cell: { x: 0, y: 1 },
    weapon: { damage: 10, rangeCells: 3, cooldownTicks: 2 } });
  const target = simulation.addUnit({ faction: "alien", cell: { x: 8, y: 1 }, movementPlane: "air", maxHealth: 1000 });
  simulation.queue({ type: "attack", unitIds: [attacker], targetId: target });
  let shots = 0;
  for (let tick = 0; tick < 50; tick++) {
    const before = simulation.snapshot.units[0];
    simulation.advance();
    const after = simulation.snapshot.units[0];
    assert.ok(grid.isPassable(after.cellX, after.cellY));
    if (simulation.combatEvents.length) {
      shots++;
      assert.deepEqual([after.xSubcells, after.ySubcells], [before.xSubcells, before.ySubcells]);
      assert.equal(after.cellX, 5);
    }
  }
  assert.ok(shots > 1);
});

test("air plane: source SCGM/ORTU hover fire and class2 matrix damage, including zero and static shots", async context => {
  const root = new URL("../../public/", import.meta.url);
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) =>
    new Response(readFileSync(new URL(String(input).slice(1), root))));
  const mission = await loadCampaignMission("alien", 6, "browser-adapted");
  const combat = { matrix: mission.damageMatrix!, armorLevel: 0, callerFactor: 256, specialFlag: false };
  for (const type of [5, 13]) {
    const stat = mission.units.find(unit => unit.index === type)!;
    assert.equal(stat.rawTail[2], 1);
    const options = unitOptionsFromLegacy(stat, mission.weapons, 0, combat);
    assert.equal(options.sourceDefense?.targetClass, 2);
    const grid = new NavigationGrid(20, 3, new Uint16Array(60));
    const simulation = new DeterministicSimulation(grid);
    const id = simulation.addUnit({ ...options, movementPlane: "air", cell: { x: 0, y: 1 } });
    const target = simulation.addStaticTarget({ faction: options.faction === "human" ? "alien" : "human",
      cell: { x: 18, y: 1 }, maxHealth: 100000, sourceDefense: { targetClass: 9, armorFactor: 256 } });
    simulation.queue({ type: "attack", unitIds: [id], targetId: target });
    let moved = false, shots = 0;
    for (let tick = 0; tick < 200; tick++) {
      const before = simulation.snapshot.units[0];
      simulation.advance();
      const after = simulation.snapshot.units[0];
      const changed = before.xSubcells !== after.xSubcells || before.ySubcells !== after.ySubcells;
      moved ||= changed;
      if (changed) assert.equal(simulation.combatEvents.length, 0);
      for (const shot of simulation.combatEvents) {
        shots++;
        assert.equal(changed, false);
        assert.equal(simulation.checkpoint().units[0].path.length, 0);
        assert.equal(shot.damage, calculateLegacyDamage(options.weapon!.damage, options.weapon!.sourceDamage as Parameters<typeof calculateLegacyDamage>[1],
          { targetClass: 9, armorFactor: 256 }));
      }
    }
    assert.ok(moved && shots > 1, `type ${type} must approach then fire while hovering`);
  }
  for (const type of [0, 2, 12]) {
    const options = unitOptionsFromLegacy(mission.units.find(unit => unit.index === type)!, mission.weapons, 0, combat);
    const simulation = new DeterministicSimulation(new NavigationGrid(4, 3));
    const target = simulation.addUnit({ ...unitOptionsFromLegacy(mission.units.find(unit => unit.index === 13)!, mission.weapons, 0, combat),
      faction: options.faction === "human" ? "alien" : "human", movementPlane: "air", cell: { x: 2, y: 1 } });
    const attacker = simulation.addUnit({ ...options, cell: { x: 1, y: 1 } });
    simulation.queue({ type: "attack", unitIds: [attacker], targetId: target });
    simulation.advance();
    const expected = calculateLegacyDamage(options.weapon!.damage, options.weapon!.sourceDamage as Parameters<typeof calculateLegacyDamage>[1],
      { targetClass: 2, armorFactor: 256 });
    assert.equal(simulation.combatEvents.find(shot => shot.attackerId === attacker)?.damage, expected);
    if (type === 2) assert.equal(expected, 0);
    assert.equal(simulation.snapshot.units[0].health, 800 - expected);
  }
  const simulation = new DeterministicSimulation(new NavigationGrid(4, 3));
  const target = simulation.addUnit({ faction: "alien", movementPlane: "air", cell: { x: 2, y: 1 }, maxHealth: 800,
    sourceDefense: { targetClass: 2, armorFactor: 256 } });
  const towerWeapon = mission.weapons.find(weapon => weapon.id === 34)!;
  const sourceDamage = { coefficients: mission.damageMatrix![towerWeapon.rawPrefix!], callerFactor: 256, specialFlag: false };
  simulation.addStaticTarget({ faction: "human", cell: { x: 1, y: 1 }, maxHealth: 800,
    weapon: { damage: towerWeapon.damage, rangeCells: towerWeapon.range, cooldownTicks: towerWeapon.rateOfFire, sourceDamage } });
  simulation.advance();
  assert.equal(simulation.combatEvents[0]?.targetId, target);
  assert.equal(simulation.combatEvents[0]?.damage, calculateLegacyDamage(towerWeapon.damage, sourceDamage, { targetClass: 2, armorFactor: 256 }));
});
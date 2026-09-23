import assert from "node:assert/strict";
import test from "node:test";
import { CombatMovementOrders } from "../../src/engine/combat-movement";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { NavigationGrid } from "../../src/engine/grid";

function run(engage: boolean) {
  const simulation = new DeterministicSimulation(new NavigationGrid(16, 3));
  const soldier = simulation.addUnit({ faction: "human", cell: { x: 1, y: 1 }, speedSubcellsPerTick: 256,
    weapon: { damage: 50, rangeCells: 2, cooldownTicks: 2 } });
  const enemy = simulation.addUnit({ faction: "alien", cell: { x: 6, y: 2 }, maxHealth: 100 });
  const orders = new CombatMovementOrders();
  const target = { x: 13, y: 1 };
  orders.move([soldier], target, engage);
  simulation.queue({ type: "move", unitIds: [soldier], target });
  const trace = [];
  for (let tick = 0; tick < 130; tick += 1) {
    const commands = orders.update(simulation.snapshot,
      [{ id: soldier, dayRangeCells: 3, nightRangeCells: 3 }], simulation.combatEvents);
    commands.forEach((command) => simulation.queue(command));
    const before = simulation.snapshot.units[0];
    simulation.advance();
    if (simulation.combatEvents.some(({ attackerId }) => attackerId === soldier)) {
      const after = simulation.snapshot.units[0];
      assert.deepEqual([after.xSubcells, after.ySubcells], [before.xSubcells, before.ySubcells]);
      assert.deepEqual(simulation.checkpoint().units[0].path, []);
      assert.equal(simulation.checkpoint().units[0].reservedDestination, null);
    }
    trace.push(simulation.snapshot);
  }
  return { trace, soldier, enemy, simulation };
}

test("assault engages targets en route, closes weapon range and resumes destination", () => {
  const result = run(true);
  const final = result.simulation.snapshot;
  assert.equal(final.units.find(({ id }) => id === result.enemy)!.health, 0);
  const soldier = final.units.find(({ id }) => id === result.soldier)!;
  assert.deepEqual([soldier.cellX, soldier.cellY, soldier.activity], [13, 1, "idle"]);
  assert.ok(result.trace.some((frame) => frame.units[0].activity === "attack"));
  assert.deepEqual(run(true).trace, result.trace);
});

test("direct Move ignores targets along its route", () => {
  const result = run(false);
  assert.equal(result.simulation.snapshot.units[1].health, 100);
  assert.ok(result.trace.every((frame) => frame.units[0].activity !== "attack"));
  assert.equal(result.simulation.snapshot.units[0].cellX, 13);
});

test("Stop discards an interrupted assault destination", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(8, 2));
  const soldier = simulation.addUnit({ faction: "human", cell: { x: 0, y: 0 },
    weapon: { damage: 25, rangeCells: 1, cooldownTicks: 1 } });
  const enemy = simulation.addUnit({ faction: "alien", cell: { x: 2, y: 1 } });
  const orders = new CombatMovementOrders();
  orders.move([soldier], { x: 7, y: 0 }, true);
  simulation.queue({ type: "move", unitIds: [soldier], target: { x: 7, y: 0 } });
  simulation.advance();
  const observers = [{ id: soldier, dayRangeCells: 4, nightRangeCells: 4 }];
  orders.update(simulation.snapshot, observers, []).forEach((command) => simulation.queue(command));
  assert.equal(orders.interrupted(soldier), true);
  orders.cancel([soldier]);
  simulation.queue({ type: "stop", unitIds: [soldier] });
  simulation.removeUnit(enemy);
  simulation.advance();
  assert.deepEqual(orders.update(simulation.snapshot, observers, []), []);
});

test("an enemy present at the moment Assault is issued does not erase the destination", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(10, 2));
  const soldier = simulation.addUnit({ faction: "human", cell: { x: 0, y: 0 },
    weapon: { damage: 100, rangeCells: 2, cooldownTicks: 1 } });
  simulation.addUnit({ faction: "alien", cell: { x: 1, y: 1 } });
  const orders = new CombatMovementOrders();
  orders.move([soldier], { x: 8, y: 0 }, true);
  simulation.queue({ type: "move", unitIds: [soldier], target: { x: 8, y: 0 } });
  for (let tick = 0; tick < 70; tick += 1) {
    orders.update(simulation.snapshot, [{ id: soldier, dayRangeCells: 4, nightRangeCells: 4 }], [])
      .forEach((command) => simulation.queue(command));
    simulation.advance();
  }
  assert.equal(simulation.snapshot.units[1].health, 0);
  assert.deepEqual([simulation.snapshot.units[0].cellX, simulation.snapshot.units[0].activity], [8, "idle"]);
});

test("Move Only issued beside an enemy is not overridden before movement starts", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(10, 2));
  const soldier = simulation.addUnit({ faction: "human", cell: { x: 0, y: 0 },
    weapon: { damage: 100, rangeCells: 2, cooldownTicks: 1 } });
  simulation.addUnit({ faction: "alien", cell: { x: 1, y: 1 } });
  const orders = new CombatMovementOrders();
  orders.move([soldier], { x: 8, y: 0 }, false);
  simulation.queue({ type: "move", unitIds: [soldier], target: { x: 8, y: 0 } });
  for (let tick = 0; tick < 50; tick += 1) {
    orders.update(simulation.snapshot, [{ id: soldier, dayRangeCells: 4, nightRangeCells: 4 }], [])
      .forEach((command) => simulation.queue(command));
    simulation.advance();
    assert.equal(simulation.snapshot.units[0].activity === "attack", false);
  }
  assert.equal(simulation.snapshot.units[1].health, 100);
  assert.equal(simulation.snapshot.units[0].cellX, 8);
});

test("explicit Attack and Stop take precedence over same-tick automatic acquisition", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(12, 2));
  const soldier = simulation.addUnit({ faction: "human", cell: { x: 0, y: 0 },
    weapon: { damage: 10, rangeCells: 1, cooldownTicks: 1 } });
  simulation.addUnit({ faction: "alien", cell: { x: 1, y: 1 } });
  const chosen = simulation.addUnit({ faction: "alien", cell: { x: 10, y: 0 } });
  const orders = new CombatMovementOrders();
  const observers = [{ id: soldier, dayRangeCells: 4, nightRangeCells: 4 }];
  orders.cancel([soldier]);
  simulation.queue({ type: "attack", unitIds: [soldier], targetId: chosen });
  assert.deepEqual(orders.update(simulation.snapshot, observers, []), []);
  simulation.advance();
  assert.equal(simulation.snapshot.units[0].targetId, chosen);
  assert.deepEqual(orders.update(simulation.snapshot, observers, []), []);
  orders.cancel([soldier]);
  simulation.queue({ type: "stop", unitIds: [soldier] });
  assert.deepEqual(orders.update(simulation.snapshot, observers, []), []);
  simulation.advance();
  assert.equal(simulation.snapshot.units[0].activity, "idle");
  assert.equal(orders.update(simulation.snapshot, observers, [])[0]?.type, "attack");
});

for (const blocked of [false, true]) test(`Move Only under fire does not retaliate while ${blocked ? "blocked with a pending path" : "walking or arriving"}`, () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(6, 1));
  const soldier = simulation.addUnit({ faction: "human", cell: { x: 0, y: 0 }, maxHealth: 1000,
    speedSubcellsPerTick: 1024, weapon: { damage: 10, rangeCells: 5, cooldownTicks: 2 } });
  const enemy = simulation.addUnit({ faction: "alien", cell: { x: 5, y: 0 },
    weapon: { damage: 1, rangeCells: 5, cooldownTicks: 1 } });
  if (blocked) simulation.addUnit({ faction: "human", cell: { x: 1, y: 0 } });
  const orders = new CombatMovementOrders();
  const destination = { x: 3, y: 0 };
  const observers = [{ id: soldier, dayRangeCells: 5, nightRangeCells: 5 }];
  orders.move([soldier], destination, false);
  simulation.queue({ type: "move", unitIds: [soldier], target: destination });
  simulation.queue({ type: "attack", unitIds: [enemy], targetId: soldier });
  for (let tick = 0; tick < 3; tick += 1) {
    assert.deepEqual(orders.update(simulation.snapshot, observers, simulation.combatEvents), []);
    simulation.advance();
    assert.ok(simulation.combatEvents.some(({ attackerId }) => attackerId === enemy));
    assert.equal(simulation.combatEvents.some(({ attackerId }) => attackerId === soldier), false);
  }
  if (blocked) {
    assert.equal(simulation.snapshot.units[0].cellX, 0);
    assert.equal(simulation.snapshot.units[0].activity, "move");
    assert.ok(simulation.checkpoint().units[0].path.length > 0);
    assert.deepEqual(orders.update(simulation.snapshot, observers, simulation.combatEvents), []);
  } else {
    const before = simulation.snapshot.units[0];
    assert.equal(before.cellX, 3);
    assert.equal(before.activity, "idle");
    orders.update(simulation.snapshot, observers, simulation.combatEvents).forEach((command) => simulation.queue(command));
    simulation.advance();
    assert.equal(simulation.snapshot.units[0].xSubcells, before.xSubcells);
    assert.ok(simulation.combatEvents.some(({ attackerId }) => attackerId === soldier));
  }
});
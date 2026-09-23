import assert from "node:assert/strict";
import test from "node:test";

import { SUBCELLS_PER_CELL } from "../../src/engine/constants";
import { NavigationGrid } from "../../src/engine/grid";
import { DeterministicSimulation } from "../../src/engine/simulation";

function assertSeparated(simulation: DeterministicSimulation): void {
  const occupied = new Set<number>();
  for (const unit of simulation.snapshot.units) {
    if (unit.activity === "die") continue;
    assert.ok(Number.isInteger(unit.xSubcells) && Number.isInteger(unit.ySubcells));
    const centerX = (unit.xSubcells - SUBCELLS_PER_CELL / 2) / SUBCELLS_PER_CELL;
    const centerY = (unit.ySubcells - SUBCELLS_PER_CELL / 2) / SUBCELLS_PER_CELL;
    for (const cellY of new Set([Math.floor(centerY), Math.ceil(centerY)])) {
      for (const cellX of new Set([Math.floor(centerX), Math.ceil(centerX)])) {
        assert.ok(simulation.grid.isPassable(cellX, cellY), `unit ${unit.id} touches blocked cell ${cellX},${cellY}`);
        const index = simulation.grid.index(cellX, cellY);
        assert.ok(!occupied.has(index), `units overlap cell ${cellX},${cellY} at tick ${simulation.snapshot.tick}`);
        occupied.add(index);
      }
    }
  }
}

function advanceSeparated(simulation: DeterministicSimulation, ticks: number): void {
  for (let tick = 0; tick < ticks; tick += 1) {
    simulation.advance();
    assertSeparated(simulation);
  }
}

test("blocked rear attacker circles a firing ally to reach an open firing cell", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(9, 5));
  const weapon = { damage: 1, rangeCells: 3, cooldownTicks: 15 };
  const front = simulation.addUnit({ faction: "human", cell: { x: 3, y: 2 }, weapon });
  const rear = simulation.addUnit({ faction: "human", cell: { x: 1, y: 2 }, speedSubcellsPerTick: 188, weapon });
  const target = simulation.addUnit({ faction: "alien", cell: { x: 6, y: 2 }, health: 1000, maxHealth: 1000 });
  simulation.queue({ type: "attack", unitIds: [front, rear], targetId: target });
  let wentAround = false;
  let fired = false;
  for (let tick = 0; tick < 100; tick++) {
    const before = simulation.snapshot.units.find(unit => unit.id === rear)!;
    advanceSeparated(simulation, 1);
    const after = simulation.snapshot.units.find(unit => unit.id === rear)!;
    wentAround ||= after.cellY !== 2;
    if (simulation.combatEvents.some(event => event.attackerId === rear)) {
      assert.equal(after.xSubcells, before.xSubcells, "rear attacker stops before firing");
      assert.equal(after.ySubcells, before.ySubcells, "rear attacker stops before firing");
      fired = true;
    }
  }
  assert.ok(wentAround, "rear attacker must use neighboring cells instead of pushing forward");
  assert.ok(fired, "rear attacker must find a reachable firing position");
  const saved = simulation.checkpoint();
  const restored = DeterministicSimulation.restore(JSON.parse(JSON.stringify(saved)));
  for (let tick = 0; tick < 20; tick++) {
    advanceSeparated(simulation, 1);
    advanceSeparated(restored, 1);
    assert.deepEqual(restored.checkpoint(), simulation.checkpoint());
  }
});

test("attacker selects another firing cell when its planned endpoint becomes occupied", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(9, 5));
  const attacker = simulation.addUnit({ faction: "human", cell: { x: 0, y: 2 }, speedSubcellsPerTick: 256,
    weapon: { damage: 1, rangeCells: 2, cooldownTicks: 15 } });
  const target = simulation.addUnit({ faction: "alien", cell: { x: 6, y: 2 }, maxHealth: 1000 });
  simulation.queue({ type: "attack", unitIds: [attacker], targetId: target });
  advanceSeparated(simulation, 1);
  const destination = simulation.checkpoint().units.find(unit => unit.id === attacker)!.path.at(-1)!;
  simulation.addUnit({ faction: "human", cell: destination });
  const restored = DeterministicSimulation.restore(JSON.parse(JSON.stringify(simulation.checkpoint())));
  let fired = false;
  for (let tick = 0; tick < 100; tick++) {
    advanceSeparated(simulation, 1);
    advanceSeparated(restored, 1);
    assert.deepEqual(restored.checkpoint(), simulation.checkpoint());
    fired ||= simulation.combatEvents.some(event => event.attackerId === attacker);
  }
  assert.ok(fired, "an occupied firing destination must not trap the attacker");
});

test("attacker abandons an isolated firing cell when its approach becomes blocked", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(9, 5));
  const attacker = simulation.addUnit({ faction: "human", cell: { x: 0, y: 2 }, speedSubcellsPerTick: 256,
    weapon: { damage: 1, rangeCells: 2, cooldownTicks: 15 } });
  const target = simulation.addUnit({ faction: "alien", cell: { x: 6, y: 2 }, maxHealth: 1000 });
  simulation.queue({ type: "attack", unitIds: [attacker], targetId: target });
  advanceSeparated(simulation, 1);
  assert.deepEqual(simulation.checkpoint().units.find(unit => unit.id === attacker)!.path.at(-1), { x: 4, y: 2 });
  for (const cell of [{ x: 3, y: 2 }, { x: 4, y: 1 }, { x: 4, y: 3 }, { x: 5, y: 2 }]) {
    simulation.addUnit({ faction: "human", cell });
  }
  let fired = false;
  for (let tick = 0; tick < 100; tick++) {
    advanceSeparated(simulation, 1);
    fired ||= simulation.combatEvents.some(event => event.attackerId === attacker);
  }
  assert.ok(fired, "attacker must route around the blockage to a different firing cell");
});

test("enclosed attacker waits without overlapping and retries when a route opens", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(7, 1));
  const attacker = simulation.addUnit({ faction: "human", cell: { x: 0, y: 0 }, speedSubcellsPerTick: 333,
    weapon: { damage: 1, rangeCells: 1, cooldownTicks: 15 } });
  const blocker = simulation.addUnit({ faction: "human", cell: { x: 2, y: 0 } });
  const target = simulation.addUnit({ faction: "alien", cell: { x: 6, y: 0 } });
  simulation.queue({ type: "attack", unitIds: [attacker], targetId: target });
  advanceSeparated(simulation, 20);
  assert.equal(simulation.combatEvents.length, 0);
  assert.equal(simulation.snapshot.units.find(unit => unit.id === attacker)!.targetId, target);
  simulation.removeUnit(blocker);
  let fired = false;
  for (let tick = 0; tick < 40; tick++) {
    advanceSeparated(simulation, 1);
    fired ||= simulation.combatEvents.some(event => event.attackerId === attacker);
  }
  assert.ok(fired, "opening a route allows the original Attack order to resume");
});

test("group moves assign distinct stable destinations regardless of selection order", () => {
  const run = (reverse: boolean) => {
    const simulation = new DeterministicSimulation(new NavigationGrid(8, 5));
    const unitIds = [1, 2, 3].map((y) =>
      simulation.addUnit({ faction: "human", cell: { x: 0, y }, speedSubcellsPerTick: 1024 }),
    );
    simulation.queue({
      type: "move",
      unitIds: reverse ? [...unitIds].reverse().concat(unitIds[0]) : unitIds,
      target: { x: 6, y: 2 },
    });
    const trace = [];
    for (let tick = 0; tick < 40; tick += 1) {
      advanceSeparated(simulation, 1);
      trace.push(simulation.snapshot);
    }
    return trace;
  };
  const trace = run(false);
  assert.deepEqual(run(true), trace);
  const snapshot = trace[trace.length - 1];
  assert.deepEqual(snapshot.units.map(({ cellX, cellY }) => [cellX, cellY]), [
    [6, 2],
    [6, 1],
    [5, 2],
  ]);
  assert.ok(snapshot.units.every((unit) => unit.activity === "idle"));
});

test("head-on units cannot swap through each other in a one-cell corridor", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(4, 1));
  const left = simulation.addUnit({ faction: "human", cell: { x: 1, y: 0 }, speedSubcellsPerTick: 4096 });
  const right = simulation.addUnit({ faction: "alien", cell: { x: 2, y: 0 }, speedSubcellsPerTick: 4096 });
  simulation.queue({ type: "move", unitIds: [left], target: { x: 3, y: 0 } });
  simulation.queue({ type: "move", unitIds: [right], target: { x: 0, y: 0 } });
  for (let tick = 0; tick < 8; tick += 1) {
    advanceSeparated(simulation, 1);
    assert.deepEqual(simulation.snapshot.units.map(({ cellX }) => cellX), [1, 2]);
  }
});

test("head-on units yield deterministically when a side route exists", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(6, 5));
  const left = simulation.addUnit({ faction: "human", cell: { x: 2, y: 2 }, speedSubcellsPerTick: 300 });
  const right = simulation.addUnit({ faction: "alien", cell: { x: 3, y: 2 }, speedSubcellsPerTick: 333 });
  simulation.queue({ type: "move", unitIds: [left], target: { x: 3, y: 2 } });
  simulation.queue({ type: "move", unitIds: [right], target: { x: 2, y: 2 } });
  advanceSeparated(simulation, 60);
  assert.deepEqual(simulation.snapshot.units.map(({ cellX, cellY, activity }) => [cellX, cellY, activity]), [
    [3, 2, "idle"],
    [2, 2, "idle"],
  ]);
});

test("units detour around occupied cells and blocked terrain at fractional speeds", () => {
  const grid = new NavigationGrid(7, 5);
  grid.costs[grid.index(3, 1)] = 0;
  const simulation = new DeterministicSimulation(grid);
  const mover = simulation.addUnit({ faction: "human", cell: { x: 0, y: 2 }, speedSubcellsPerTick: 333 });
  simulation.addUnit({ faction: "alien", cell: { x: 3, y: 2 } });
  simulation.queue({ type: "move", unitIds: [mover], target: { x: 6, y: 2 } });
  advanceSeparated(simulation, 60);
  const unit = simulation.snapshot.units[0];
  assert.deepEqual([unit.cellX, unit.cellY, unit.activity], [6, 2, "idle"]);
});

test("an occupied destination waits until its live occupant leaves", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(5, 1));
  const mover = simulation.addUnit({ faction: "human", cell: { x: 0, y: 0 }, speedSubcellsPerTick: 1024 });
  const occupant = simulation.addUnit({ faction: "alien", cell: { x: 2, y: 0 }, speedSubcellsPerTick: 1024 });
  simulation.queue({ type: "move", unitIds: [mover], target: { x: 2, y: 0 } });
  advanceSeparated(simulation, 8);
  assert.deepEqual(simulation.snapshot.units.map(({ cellX }) => cellX), [1, 2]);
  simulation.queue({ type: "move", unitIds: [occupant], target: { x: 4, y: 0 } });
  advanceSeparated(simulation, 8);
  assert.deepEqual(simulation.snapshot.units.map(({ cellX, activity }) => [cellX, activity]), [[2, "idle"], [4, "idle"]]);
});

test("fast crossing paths reserve swept cells for the entire tick", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(5, 5));
  const horizontal = simulation.addUnit({ faction: "human", cell: { x: 0, y: 2 }, speedSubcellsPerTick: 8192 });
  const vertical = simulation.addUnit({ faction: "human", cell: { x: 2, y: 0 }, speedSubcellsPerTick: 8192 });
  simulation.queue({ type: "move", unitIds: [horizontal], target: { x: 4, y: 2 } });
  simulation.queue({ type: "move", unitIds: [vertical], target: { x: 2, y: 4 } });
  advanceSeparated(simulation, 1);
  assert.deepEqual(simulation.snapshot.units.map(({ cellX, cellY }) => [cellX, cellY]), [[4, 2], [2, 1]]);
  advanceSeparated(simulation, 1);
  assert.deepEqual(simulation.snapshot.units.map(({ cellX, cellY }) => [cellX, cellY]), [[4, 2], [2, 4]]);
});

test("formation slots exclude blocked cells and nonselected live occupants", () => {
  const grid = new NavigationGrid(7, 5);
  grid.costs[grid.index(4, 2)] = 0;
  const simulation = new DeterministicSimulation(grid);
  const first = simulation.addUnit({ faction: "human", cell: { x: 0, y: 2 }, speedSubcellsPerTick: 1024 });
  const second = simulation.addUnit({ faction: "human", cell: { x: 0, y: 3 }, speedSubcellsPerTick: 1024 });
  simulation.addUnit({ faction: "alien", cell: { x: 4, y: 1 } });
  simulation.queue({ type: "move", unitIds: [first, second, -1], target: { x: 4, y: 2 } });
  advanceSeparated(simulation, 50);
  assert.deepEqual(simulation.snapshot.units.slice(0, 2).map(({ cellX, cellY, activity }) => [cellX, cellY, activity]), [
    [3, 2, "idle"],
    [5, 2, "idle"],
  ]);
});

test("formation slots are reachable even when the clicked region is disconnected", () => {
  const grid = new NavigationGrid(7, 4);
  for (let row = 0; row < grid.height; row += 1) grid.costs[grid.index(3, row)] = 0;
  const simulation = new DeterministicSimulation(grid);
  const unitIds = [1, 2].map((y) => simulation.addUnit({ faction: "human", cell: { x: 0, y }, speedSubcellsPerTick: 1024 }));
  simulation.queue({ type: "move", unitIds, target: { x: 6, y: 1 } });
  advanceSeparated(simulation, 30);
  assert.deepEqual(simulation.snapshot.units.map(({ cellX, cellY, activity }) => [cellX, cellY, activity]), [
    [2, 1, "idle"],
    [2, 0, "idle"],
  ]);
});

test("stop preserves mid-cell occupancy but releases the old destination", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(7, 4));
  const stopped = simulation.addUnit({ faction: "human", cell: { x: 0, y: 1 }, speedSubcellsPerTick: 300 });
  const first = simulation.addUnit({ faction: "human", cell: { x: 6, y: 0 }, speedSubcellsPerTick: 1024 });
  const second = simulation.addUnit({ faction: "human", cell: { x: 6, y: 3 }, speedSubcellsPerTick: 1024 });
  simulation.queue({ type: "move", unitIds: [stopped], target: { x: 4, y: 1 } });
  advanceSeparated(simulation, 1);
  const position = simulation.snapshot.units[0];
  simulation.queue({ type: "stop", unitIds: [stopped] });
  simulation.queue({ type: "move", unitIds: [first, second], target: { x: 4, y: 1 } });
  advanceSeparated(simulation, 30);
  assert.deepEqual(simulation.snapshot.units[0], { ...position, activity: "idle" });
  assert.deepEqual(simulation.snapshot.units.slice(1).map(({ cellX, cellY, activity }) => [cellX, cellY, activity]), [
    [4, 1, "idle"],
    [4, 0, "idle"],
  ]);
});

test("a stopped unit spanning two cells cannot be crossed", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(5, 1));
  const stopped = simulation.addUnit({ faction: "human", cell: { x: 0, y: 0 }, speedSubcellsPerTick: 700 });
  const follower = simulation.addUnit({ faction: "human", cell: { x: 4, y: 0 }, speedSubcellsPerTick: 4096 });
  simulation.queue({ type: "move", unitIds: [stopped], target: { x: 3, y: 0 } });
  advanceSeparated(simulation, 1);
  simulation.queue({ type: "stop", unitIds: [stopped] });
  simulation.queue({ type: "move", unitIds: [follower], target: { x: 0, y: 0 } });
  advanceSeparated(simulation, 20);
  assert.deepEqual(simulation.snapshot.units.map(({ xSubcells }) => xSubcells), [1212, 2560]);
});

test("retargeting mid-cell recenters before turning around blocked corners", () => {
  const grid = new NavigationGrid(5, 4);
  grid.costs[grid.index(0, 0)] = 0;
  const simulation = new DeterministicSimulation(grid);
  const mover = simulation.addUnit({ faction: "human", cell: { x: 0, y: 1 }, speedSubcellsPerTick: 700 });
  simulation.queue({ type: "move", unitIds: [mover], target: { x: 4, y: 1 } });
  advanceSeparated(simulation, 1);
  simulation.queue({ type: "move", unitIds: [mover], target: { x: 1, y: 0 } });
  advanceSeparated(simulation, 10);
  const unit = simulation.snapshot.units[0];
  assert.deepEqual([unit.cellX, unit.cellY, unit.activity], [1, 0, "idle"]);
});

test("death releases occupancy on the following tick and clears movement orders", () => {
  const grid = new NavigationGrid(5, 2, new Uint16Array([1, 1, 1, 1, 1, 0, 0, 1, 0, 0]));
  const simulation = new DeterministicSimulation(grid);
  const mover = simulation.addUnit({ faction: "human", cell: { x: 0, y: 0 }, speedSubcellsPerTick: 1024 });
  const victim = simulation.addUnit({ faction: "alien", cell: { x: 2, y: 0 } });
  const attacker = simulation.addUnit({
    faction: "human", cell: { x: 2, y: 1 }, weapon: { damage: 100, rangeCells: 1, cooldownTicks: 1 },
  });
  simulation.queue({ type: "move", unitIds: [mover], target: { x: 4, y: 0 } });
  simulation.queue({ type: "move", unitIds: [victim], target: { x: 0, y: 0 } });
  simulation.queue({ type: "attack", unitIds: [attacker], targetId: victim }, 1);
  advanceSeparated(simulation, 2);
  assert.equal(simulation.snapshot.units[0].cellX, 1);
  const dead = simulation.snapshot.units[1];
  assert.equal(dead.activity, "die");
  assert.equal(dead.targetId, null);
  simulation.queue({ type: "move", unitIds: [victim], target: { x: 3, y: 0 } });
  simulation.queue({ type: "stop", unitIds: [victim] });
  advanceSeparated(simulation, 1);
  assert.equal(simulation.snapshot.units[0].cellX, 2);
  advanceSeparated(simulation, 5);
  assert.equal(simulation.snapshot.units[0].cellX, 4);
  assert.deepEqual(simulation.snapshot.units[1], dead);
});

test("mixed formation, collision, stop and combat commands replay byte-for-byte", () => {
  const run = () => {
    const simulation = new DeterministicSimulation(new NavigationGrid(9, 7), { seed: 123 });
    const unitIds = [1, 3, 5].map((y) => simulation.addUnit({
      faction: "human", cell: { x: 0, y }, speedSubcellsPerTick: 333,
      weapon: { damage: 10, rangeCells: 1, cooldownTicks: 2 },
    }));
    const enemy = simulation.addUnit({ faction: "alien", cell: { x: 5, y: 3 }, maxHealth: 20 });
    simulation.queue({ type: "move", unitIds, target: { x: 7, y: 3 } });
    simulation.queue({ type: "stop", unitIds: [unitIds[1]] }, 8);
    simulation.queue({ type: "move", unitIds: [unitIds[1]], target: { x: 6, y: 5 } }, 14);
    simulation.queue({ type: "attack", unitIds, targetId: enemy }, 40);
    simulation.queue({ type: "move", unitIds, target: { x: 0, y: 0 } }, 70);
    const trace = [];
    for (let tick = 0; tick < 140; tick += 1) {
      advanceSeparated(simulation, 1);
      trace.push(JSON.stringify(simulation.snapshot));
    }
    assert.equal(simulation.snapshot.units[3].activity, "die");
    assert.ok(simulation.snapshot.units.slice(0, 3).every((unit) => unit.activity === "idle"), JSON.stringify(simulation.snapshot.units));
    return trace;
  };
  assert.deepEqual(run(), run());
});
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { NavigationGrid } from "../../src/engine/grid";
import { findPath } from "../../src/engine/pathfinding";
import { DeterministicSimulation } from "../../src/engine/simulation";

const create = (grid = new NavigationGrid(12, 12)) =>
  new DeterministicSimulation(grid, { groundMovement: "eight-way-v1" });

function separated(simulation: DeterministicSimulation): void {
  const occupied = new Set<number>();
  for (const unit of simulation.snapshot.units) {
    if (unit.activity === "die") continue;
    const x = (unit.xSubcells - 512) / 1024, y = (unit.ySubcells - 512) / 1024;
    assert.ok(Number.isInteger(unit.xSubcells) && Number.isInteger(unit.ySubcells));
    for (const row of new Set([Math.floor(y), Math.ceil(y)])) for (const col of new Set([Math.floor(x), Math.ceil(x)])) {
      assert.ok(simulation.grid.isPassable(col, row), `blocked terrain touched: ${col},${row}`);
      const cell = simulation.grid.index(col, row);
      assert.ok(!occupied.has(cell), `overlapping units at ${col},${row} on tick ${simulation.snapshot.tick}`);
      occupied.add(cell);
    }
  }
}

test("eight-way A* uses diagonal routes while the legacy four-way API remains unchanged", () => {
  const grid = new NavigationGrid(6, 6);
  assert.deepEqual(findPath(grid, { x: 0, y: 0 }, { x: 4, y: 4 }, { diagonal: true }),
    Array.from({ length: 5 }, (_, index) => ({ x: index, y: index })));
  assert.equal(findPath(grid, { x: 0, y: 0 }, { x: 4, y: 4 })!.length, 9);
  assert.equal(grid.neighbors(grid.index(2, 2)).length, 4);
  assert.equal(grid.neighbors(grid.index(2, 2), true).length, 8);
});

test("diagonal A* cannot cut impassable or occupied corners and respects terrain weights", () => {
  const grid = new NavigationGrid(4, 4);
  grid.costs[grid.index(1, 0)] = 0;
  let path = findPath(grid, { x: 0, y: 0 }, { x: 2, y: 2 }, { diagonal: true })!;
  assert.deepEqual(path[1], { x: 0, y: 1 });
  const blocked = new Set([grid.index(0, 1)]);
  assert.equal(findPath(grid, { x: 0, y: 0 }, { x: 2, y: 2 }, { diagonal: true, blocked }), null);
  grid.costs.fill(1); grid.costs[grid.index(1, 1)] = 100;
  path = findPath(grid, { x: 0, y: 0 }, { x: 2, y: 2 }, { diagonal: true })!;
  assert.ok(!path.some(point => point.x === 1 && point.y === 1));
});

test("a boxed-in endpoint is rejected without searching the whole open map", context => {
  const grid = new NavigationGrid(100, 100);
  const blocked = new Set([[49, 50], [51, 50], [50, 49], [50, 51]].map(([x, y]) => grid.index(x, y)));
  const neighbors = context.mock.method(grid, "neighbors");
  assert.equal(findPath(grid, { x: 1, y: 1 }, { x: 50, y: 50 }, { diagonal: true, blocked }), null);
  assert.equal(neighbors.mock.callCount(), 1);
});

for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
  test(`ground units move simultaneously on both axes (${dx},${dy}), with normalized speed`, () => {
    const simulation = create();
    const id = simulation.addUnit({ faction: "human", cell: { x: 5, y: 5 }, speedSubcellsPerTick: 100 });
    simulation.queue({ type: "move", unitIds: [id], target: { x: 5 + dx * 4, y: 5 + dy * 4 } });
    let previous = simulation.snapshot.units[0];
    for (let tick = 0; tick < 70; tick++) {
      simulation.advance(); separated(simulation);
      const unit = simulation.snapshot.units[0];
      const moveX = unit.xSubcells - previous.xSubcells, moveY = unit.ySubcells - previous.ySubcells;
      if (unit.activity !== "idle") {
        assert.equal(Math.sign(moveX), dx);
        assert.equal(Math.sign(moveY), dy);
        assert.equal(Math.abs(moveX), Math.abs(moveY), "no alternating horizontal/vertical staircase");
        assert.ok(Math.abs(Math.hypot(moveX, moveY) - 100) <= 1, "no sqrt(2) speed boost");
      }
      previous = unit;
    }
    assert.deepEqual([previous.cellX, previous.cellY, previous.activity], [5 + dx * 4, 5 + dy * 4, "idle"]);
  });
}

test("diagonal reservations prevent crossing paths and retain exact mid-segment save continuation", () => {
  const simulation = create();
  const first = simulation.addUnit({ faction: "human", cell: { x: 1, y: 1 }, speedSubcellsPerTick: 333 });
  const second = simulation.addUnit({ faction: "human", cell: { x: 2, y: 1 }, speedSubcellsPerTick: 300 });
  simulation.queue({ type: "move", unitIds: [first], target: { x: 6, y: 6 } });
  simulation.queue({ type: "move", unitIds: [second], target: { x: 1, y: 6 } });
  simulation.advance();
  const restored = DeterministicSimulation.restore(JSON.parse(JSON.stringify(simulation.checkpoint())));
  for (let tick = 0; tick < 100; tick++) {
    simulation.advance(); restored.advance(); separated(simulation);
    assert.deepEqual(restored.checkpoint(), simulation.checkpoint());
  }
  assert.ok(simulation.snapshot.units.every(unit => unit.activity === "idle"));
});

test("fast diagonal crossings reserve the whole swept square for the tick", () => {
  const simulation = create();
  const first = simulation.addUnit({ faction: "human", cell: { x: 1, y: 1 }, speedSubcellsPerTick: 8192 });
  const second = simulation.addUnit({ faction: "human", cell: { x: 6, y: 1 }, speedSubcellsPerTick: 8192 });
  simulation.queue({ type: "move", unitIds: [first], target: { x: 6, y: 6 } });
  simulation.queue({ type: "move", unitIds: [second], target: { x: 1, y: 6 } });
  simulation.advance(); separated(simulation);
  for (const reservation of simulation.checkpoint().movementReservations) {
    assert.equal(reservation.owners.length, 1, "crossing sweeps cannot share a tile during the same tick");
  }
  for (let tick = 0; tick < 20; tick++) { simulation.advance(); separated(simulation); }
  assert.ok(simulation.snapshot.units.every(unit => unit.activity === "idle"));
});

test("retargeting a partly completed diagonal recenters without cutting a blocked corner", () => {
  const grid = new NavigationGrid(8, 8), simulation = create(grid);
  grid.costs[grid.index(0, 0)] = 0;
  const id = simulation.addUnit({ faction: "human", cell: { x: 1, y: 1 }, speedSubcellsPerTick: 333 });
  simulation.queue({ type: "move", unitIds: [id], target: { x: 5, y: 5 } });
  simulation.advance();
  simulation.queue({ type: "stop", unitIds: [id] });
  simulation.advance(); separated(simulation);
  simulation.queue({ type: "move", unitIds: [id], target: { x: 0, y: 1 } });
  for (let tick = 0; tick < 40; tick++) { simulation.advance(); separated(simulation); }
  assert.deepEqual([simulation.snapshot.units[0].cellX, simulation.snapshot.units[0].cellY], [0, 1]);
});

test("a reinforced unit can leave an already shared origin without an infinite replan loop", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { NavigationGrid } from "./src/engine/grid.ts";
    import { DeterministicSimulation } from "./src/engine/simulation.ts";
    const simulation = new DeterministicSimulation(new NavigationGrid(5, 4), { groundMovement: "eight-way-v1" });
    simulation.addUnit({ faction: "human", cell: { x: 1, y: 1 }, positionSubcells: { x: 1536, y: 1736 } });
    const mover = simulation.addUnit({ faction: "human", cell: { x: 1, y: 1 }, speedSubcellsPerTick: 100 });
    simulation.queue({ type: "move", unitIds: [mover], target: { x: 3, y: 1 } });
    for (let tick = 0; tick < 30; tick++) simulation.advance();
    console.log(JSON.stringify(simulation.snapshot.units.find(unit => unit.id === mover)));
  `], { cwd: fileURLToPath(new URL("../../", import.meta.url)), timeout: 5000, encoding: "utf8" });
  assert.equal(result.error, undefined, "pathfinding must not trap the entire frame in a synchronous loop");
  assert.equal(result.status, 0, result.stderr);
  const unit = JSON.parse(result.stdout);
  assert.deepEqual([unit.cellX, unit.cellY, unit.activity], [3, 1, "idle"]);
});

test("diagonal terrain detours, stopped mid-tile bodies, and formation destinations do not overlap", () => {
  const grid = new NavigationGrid(12, 12);
  for (let y = 1; y < 9; y++) grid.costs[grid.index(5, y)] = 0;
  const simulation = create(grid);
  const ids = [1, 3, 5].map(y => simulation.addUnit({ faction: "human", cell: { x: 1, y }, speedSubcellsPerTick: 333 }));
  simulation.queue({ type: "move", unitIds: ids, target: { x: 9, y: 9 } });
  for (let tick = 0; tick < 240; tick++) { simulation.advance(); separated(simulation); }
  assert.ok(simulation.snapshot.units.every(unit => unit.activity === "idle"));
  assert.equal(new Set(simulation.snapshot.units.map(unit => `${unit.cellX},${unit.cellY}`)).size, 3);
  simulation.queue({ type: "move", unitIds: ids, target: { x: 1, y: 1 } });
  simulation.advance();
  simulation.queue({ type: "stop", unitIds: [ids[0]] });
  for (let tick = 0; tick < 150; tick++) { simulation.advance(); separated(simulation); }
});

test("nearby squad orders do not flood the entire map for every formation slot", context => {
  const grid = new NavigationGrid(100, 100), simulation = create(grid);
  const ids = Array.from({ length: 20 }, (_, index) => simulation.addUnit({
    faction: "human", cell: { x: 45 + index % 4, y: 45 + Math.floor(index / 4) }, speedSubcellsPerTick: 100,
  }));
  const neighbors = grid.neighbors.bind(grid);
  let visits = 0;
  context.mock.method(grid, "neighbors", (index: number, diagonal = false) => {
    visits++;
    return neighbors(index, diagonal);
  });
  simulation.queue({ type: "move", unitIds: ids, target: { x: 55, y: 55 } });
  simulation.advance();
  const goals = simulation.checkpoint().units.map(unit => unit.path.at(-1));
  assert.ok(goals.every(Boolean), "every squad member receives a route");
  assert.equal(new Set(goals.map(goal => `${goal!.x},${goal!.y}`)).size, ids.length);
  assert.ok(visits < 40_000, `${visits} neighbor expansions; nearby commands must not do 200,000 full-map visits`);
});

test("legacy saved paths round-trip exactly and opt into diagonal routing without losing progress", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(8, 8));
  const id = simulation.addUnit({ faction: "human", cell: { x: 1, y: 1 }, speedSubcellsPerTick: 333 });
  simulation.queue({ type: "move", unitIds: [id], target: { x: 6, y: 6 } });
  simulation.advance();
  const before = simulation.checkpoint();
  assert.equal(Object.hasOwn(before, "groundMovement"), false);
  const restored = DeterministicSimulation.restore(JSON.parse(JSON.stringify(before)));
  assert.deepEqual(restored.checkpoint(), before);
  restored.enableDiagonalGroundMovement();
  assert.deepEqual(restored.checkpoint(), { ...before, groundMovement: "eight-way-v1" });
  restored.queue({ type: "move", unitIds: [id], target: { x: 6, y: 6 } });
  for (let tick = 0; tick < 80; tick++) { restored.advance(); separated(restored); }
  assert.deepEqual([restored.snapshot.units[0].cellX, restored.snapshot.units[0].cellY], [6, 6]);
  const invalid = { ...before, groundMovement: "free-flight" };
  assert.throws(() => DeterministicSimulation.restore(invalid), /checkpoint/);
});

test("diagonal attack pursuit stops before firing and harvest round trips retain the movement policy", () => {
  const simulation = create();
  const id = simulation.addUnit({ faction: "human", cell: { x: 1, y: 1 }, speedSubcellsPerTick: 333,
    weapon: { damage: 1, cooldownTicks: 3, rangeCells: 2 }, harvester: { cargoCapacity: 10, harvestPerTick: 5 } });
  const enemy = simulation.addUnit({ faction: "alien", cell: { x: 8, y: 8 }, maxHealth: 1000 });
  simulation.queue({ type: "attack", unitIds: [id], targetId: enemy });
  let diagonalSteps = 0, shots = 0;
  for (let tick = 0; tick < 80; tick++) {
    const before = simulation.snapshot.units[0];
    simulation.advance(); separated(simulation);
    const after = simulation.snapshot.units[0];
    if (after.xSubcells !== before.xSubcells && after.ySubcells !== before.ySubcells) diagonalSteps++;
    if (simulation.combatEvents.length) {
      shots++;
      assert.deepEqual([after.xSubcells, after.ySubcells], [before.xSubcells, before.ySubcells]);
    }
  }
  assert.ok(diagonalSteps > 5 && shots > 2);
  const node = simulation.addResourceNode({ cell: { x: 3, y: 3 }, amount: 20 });
  simulation.queue({ type: "harvest", unitIds: [id], resourceId: node, dropoff: { x: 1, y: 1 } });
  for (let tick = 0; tick < 200; tick++) { simulation.advance(); separated(simulation); }
  assert.ok(simulation.snapshot.resources.human > 0);
});

import assert from "node:assert/strict";
import test from "node:test";
import { NavigationGrid } from "../../src/engine/grid";
import { DeterministicSimulation, withinSourceWeaponRange } from "../../src/engine/simulation";

const melee = { damage: 50, rangeCells: 1, cooldownTicks: 15 };
const create = (grid = new NavigationGrid(14, 14)) => new DeterministicSimulation(grid, { groundMovement: "eight-way-v1" });
const unit = (simulation: DeterministicSimulation, id: number) => simulation.snapshot.units.find(entry => entry.id === id)!;

function separated(simulation: DeterministicSimulation): void {
  const occupied = new Set<number>();
  for (const entry of simulation.snapshot.units) {
    if (entry.activity === "die") continue;
    const x = (entry.xSubcells - 512) / 1024, y = (entry.ySubcells - 512) / 1024;
    for (const row of new Set([Math.floor(y), Math.ceil(y)])) for (const col of new Set([Math.floor(x), Math.ceil(x)])) {
      const cell = simulation.grid.index(col, row);
      assert.ok(!occupied.has(cell), `overlapping units at ${col},${row} on tick ${simulation.snapshot.tick}`);
      occupied.add(cell);
    }
  }
}

test("weapon range follows the DC.EXE 0x434090 acquisition rings, not Manhattan distance", () => {
  // Ring 1 is all eight neighbors and ring 2 the full 5x5 square; radius 4 accepts (3,3) but not (4,3).
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) assert.ok(withinSourceWeaponRange(dx, dy, 1));
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) assert.ok(withinSourceWeaponRange(dx, dy, 2));
  assert.equal(withinSourceWeaponRange(2, 0, 1), false);
  assert.equal(withinSourceWeaponRange(3, 3, 4), true);
  assert.equal(withinSourceWeaponRange(3, 3, 3), false);
  assert.equal(withinSourceWeaponRange(4, 3, 4), false);
  assert.equal(withinSourceWeaponRange(3, 2, 3), true);
});

test("a melee attacker closes to a free diagonal slot when the target's orthogonal sides are occupied", () => {
  const simulation = create();
  const target = simulation.addUnit({ faction: "human", team: 0, cell: { x: 8, y: 6 }, speedSubcellsPerTick: 100, maxHealth: 800 });
  for (const [x, y] of [[7, 6], [9, 6], [8, 5], [8, 7]]) simulation.addUnit({ faction: "human", team: 0, cell: { x, y }, speedSubcellsPerTick: 100 });
  const scythe = simulation.addUnit({ faction: "alien", team: 1, cell: { x: 2, y: 6 }, speedSubcellsPerTick: 100, weapon: melee });
  simulation.queue({ type: "attack", unitIds: [scythe], targetId: target });
  let firstHit: number | undefined;
  for (let tick = 0; tick < 200 && firstHit === undefined; tick++) {
    simulation.advance();
    separated(simulation);
    if (unit(simulation, target).health < 800) firstHit = tick;
  }
  assert.ok(firstHit !== undefined && firstHit < 120, "melee attacker never reached a legal range cell");
  const attacker = unit(simulation, scythe);
  assert.equal(Math.max(Math.abs(attacker.cellX - 8), Math.abs(attacker.cellY - 6)), 1);
});

test("an idle ally in a one-cell gap steps one cell aside so an allied mover can pass (DC.EXE +0x35)", () => {
  const grid = new NavigationGrid(14, 14);
  for (let y = 0; y < 14; y++) if (y !== 6) grid.costs[grid.index(6, y)] = 0;
  const simulation = create(grid);
  const ally = simulation.addUnit({ faction: "human", team: 0, cell: { x: 6, y: 6 }, speedSubcellsPerTick: 100 });
  const mover = simulation.addUnit({ faction: "human", team: 0, cell: { x: 2, y: 6 }, speedSubcellsPerTick: 100 });
  simulation.queue({ type: "move", unitIds: [mover], target: { x: 11, y: 6 } });
  for (let tick = 0; tick < 250; tick++) { simulation.advance(); separated(simulation); }
  const moved = unit(simulation, mover), displaced = unit(simulation, ally);
  assert.deepEqual([moved.cellX, moved.cellY, moved.activity], [11, 6, "idle"]);
  // Perpendicular tries are walls here, so the first legal source try is the forward diagonal.
  assert.deepEqual([displaced.cellX, displaced.cellY, displaced.activity], [7, 7, "idle"]);
});

test("an idle ally standing on a destination yields it, while hostile occupants are never displaced", () => {
  const simulation = create();
  const ally = simulation.addUnit({ faction: "human", team: 0, cell: { x: 8, y: 6 }, speedSubcellsPerTick: 100 });
  const mover = simulation.addUnit({ faction: "human", team: 0, cell: { x: 3, y: 6 }, speedSubcellsPerTick: 100 });
  simulation.queue({ type: "move", unitIds: [mover], target: { x: 8, y: 6 } });
  for (let tick = 0; tick < 150; tick++) { simulation.advance(); separated(simulation); }
  assert.deepEqual([unit(simulation, mover).cellX, unit(simulation, mover).cellY], [8, 6]);
  const displaced = unit(simulation, ally);
  assert.equal(Math.max(Math.abs(displaced.cellX - 8), Math.abs(displaced.cellY - 6)), 1);

  const hostile = create();
  const enemy = hostile.addUnit({ faction: "alien", team: 1, cell: { x: 8, y: 6 }, speedSubcellsPerTick: 100 });
  const walker = hostile.addUnit({ faction: "human", team: 0, cell: { x: 3, y: 6 }, speedSubcellsPerTick: 100 });
  hostile.queue({ type: "move", unitIds: [walker], target: { x: 8, y: 6 } });
  for (let tick = 0; tick < 150; tick++) hostile.advance();
  assert.deepEqual([unit(hostile, enemy).cellX, unit(hostile, enemy).cellY], [8, 6]);
});

test("pending displacement and the blocked-mover wait survive checkpoint restore", () => {
  const grid = new NavigationGrid(14, 14);
  for (let y = 0; y < 14; y++) if (y !== 6) grid.costs[grid.index(6, y)] = 0;
  const simulation = create(grid);
  simulation.addUnit({ faction: "human", team: 0, cell: { x: 6, y: 6 }, speedSubcellsPerTick: 100 });
  const mover = simulation.addUnit({ faction: "human", team: 0, cell: { x: 2, y: 6 }, speedSubcellsPerTick: 100 });
  simulation.queue({ type: "move", unitIds: [mover], target: { x: 11, y: 6 } });
  let saved;
  for (let tick = 0; tick < 100 && !saved; tick++) {
    simulation.advance();
    const checkpoint = simulation.checkpoint();
    if (checkpoint.units.some(entry => entry.moveWait !== undefined)) saved = checkpoint;
  }
  assert.ok(saved, "mover never waited for the blocking ally");
  const restored = DeterministicSimulation.restore(saved);
  for (let tick = 0; tick < 120; tick++) { simulation.advance(); restored.advance(); }
  assert.deepEqual(restored.checkpoint(), simulation.checkpoint());
});

test("a moving ally is marked like DC.EXE and steps aside only once idle, resolving a head-on gap", () => {
  const grid = new NavigationGrid(14, 14);
  for (let y = 0; y < 14; y++) if (y !== 6) grid.costs[grid.index(6, y)] = 0;
  const simulation = create(grid);
  const ally = simulation.addUnit({ faction: "human", team: 0, cell: { x: 9, y: 6 }, speedSubcellsPerTick: 60 });
  const mover = simulation.addUnit({ faction: "human", team: 0, cell: { x: 3, y: 6 }, speedSubcellsPerTick: 100 });
  simulation.queue({ type: "move", unitIds: [ally], target: { x: 6, y: 6 } });
  simulation.queue({ type: "move", unitIds: [mover], target: { x: 11, y: 6 } });
  let markedWhileMoving = false;
  for (let tick = 0; tick < 400; tick++) {
    simulation.advance();
    separated(simulation);
    const record = simulation.checkpoint().units.find(entry => entry.id === ally)!;
    if (record.activity === "move" && record.displacement !== undefined) markedWhileMoving = true;
  }
  assert.ok(markedWhileMoving, "the moving ally was never marked");
  assert.ok(unit(simulation, mover).cellX >= 10, "the mover never passed the gap");
  assert.ok(simulation.snapshot.units.every(entry => entry.activity === "idle"));
});

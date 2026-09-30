import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { NavigationGrid } from "../../src/engine/grid";

// DC.EXE: route leg pushes turn task 4 (0x4120fc, <= turnSpeed per update) above move task 5.
function make(turnSpeed?: number) {
  const sim = new DeterministicSimulation(new NavigationGrid(8, 8));
  const id = sim.addUnit({ faction: "human", cell: { x: 1, y: 1 }, speedSubcellsPerTick: 64, ...(turnSpeed ? { turnSpeed } : {}) });
  return { sim, id };
}

test("unit turns toward the leg (shortest way) before moving", () => {
  const { sim, id } = make(10);
  assert.equal(sim.snapshot.units[0].facing, 64);
  sim.queue({ type: "move", unitIds: [id], target: { x: 4, y: 1 } });
  const start = sim.snapshot.units[0].xSubcells;
  let ticks = 0;
  while ((sim.snapshot.units[0].facing as number) !== 0) { sim.advance(); ticks++; assert.ok(ticks < 20); }
  assert.equal(ticks, 7);
  assert.equal(sim.snapshot.units[0].xSubcells > start, true);
  assert.equal(DeterministicSimulation.restore(sim.checkpoint()).snapshot.units[0].facing, 0);
});

test("units without turn speed have no facing state", () => {
  assert.equal(make().sim.snapshot.units[0].facing, undefined);
});

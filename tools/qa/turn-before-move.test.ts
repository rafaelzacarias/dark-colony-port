import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { NavigationGrid } from "../../src/engine/grid";
import { missionUnitAction } from "../../src/mission-view";

// DC.EXE: route leg pushes turn task 4 (0x4120fc, <= turnSpeed per update) above move task 5.
function make(turnSpeed?: number) {
  const sim = new DeterministicSimulation(new NavigationGrid(8, 8));
  const id = sim.addUnit({ faction: "human", cell: { x: 1, y: 1 }, speedSubcellsPerTick: 64, ...(turnSpeed ? { turnSpeed } : {}) });
  return { sim, id };
}

test("unit turns toward the leg (shortest way) before moving", () => {
  const { sim, id } = make(10);
  assert.equal(sim.snapshot.units[0].facing, 64);
  assert.equal(sim.checkpoint().units[0].pathIndex, 0);
  sim.queue({ type: "move", unitIds: [id], target: { x: 4, y: 1 } });
  const start = sim.snapshot.units[0].xSubcells;
  let ticks = 0;
  while ((sim.snapshot.units[0].facing as number) !== 0) {
    const previous = sim.snapshot.units[0];
    sim.advance();
    const current = sim.snapshot.units[0];
    ticks++;
    assert.ok(ticks < 20);
    if (current.xSubcells === previous.xSubcells && current.ySubcells === previous.ySubcells) {
      assert.equal(missionUnitAction(current, previous, true), "Stand");
    } else {
      assert.equal(missionUnitAction(current, previous, true), "Move");
    }
  }
  assert.equal(ticks, 7);
  assert.equal(sim.snapshot.units[0].xSubcells > start, true);
  assert.equal(DeterministicSimulation.restore(sim.checkpoint()).snapshot.units[0].facing, 0);
});

test("unit already walking in-stride transitions across a 45-degree bend without freezing at the waypoint", () => {
  const sim = new DeterministicSimulation(new NavigationGrid(20, 20), { groundMovement: "eight-way-v1" });
  const id = sim.addUnit({ faction: "human", cell: { x: 15, y: 15 }, speedSubcellsPerTick: 256, turnSpeed: 10 });
  sim.queue({ type: "move", unitIds: [id], target: { x: 17, y: 16 } });
  let startedMoving = false;
  let crossedBend = false;
  for (let tick = 0; tick < 30; tick++) {
    const previous = sim.snapshot.units[0];
    sim.advance();
    const current = sim.snapshot.units[0];
    const displaced = current.xSubcells !== previous.xSubcells || current.ySubcells !== previous.ySubcells;
    if (!startedMoving) {
      if (!displaced) {
        assert.equal(missionUnitAction(current, previous, true), "Stand");
        continue;
      }
      startedMoving = true;
      assert.equal(current.facing, 32);
    }
    assert.equal(displaced, true, `in-stride mover must not freeze at intermediate waypoint on tick ${tick}`);
    assert.equal(missionUnitAction(current, previous, true), "Move");
    if (current.facing === 0) crossedBend = true;
    if (current.activity === "idle") break;
  }
  assert.equal(startedMoving, true);
  assert.equal(crossedBend, true);
  assert.deepEqual([sim.snapshot.units[0].cellX, sim.snapshot.units[0].cellY, sim.snapshot.units[0].activity], [17, 16, "idle"]);

  // Checkpoint/restore right at the intermediate cell center before a 45° bend preserves in-stride continuation.
  const cardinalGrid = new NavigationGrid(20, 20);
  cardinalGrid.costs[cardinalGrid.index(14, 16)] = 0;
  const cardinalToDiag = new DeterministicSimulation(cardinalGrid, { groundMovement: "eight-way-v1" });
  const moverId = cardinalToDiag.addUnit({ faction: "human", cell: { x: 14, y: 15 }, speedSubcellsPerTick: 256, turnSpeed: 10 });
  cardinalToDiag.queue({ type: "move", unitIds: [moverId], target: { x: 16, y: 16 } });
  let restoredAtWaypoint: DeterministicSimulation | undefined;
  for (let tick = 0; tick < 30; tick++) {
    cardinalToDiag.advance();
    if (restoredAtWaypoint) {
      restoredAtWaypoint.advance();
      assert.deepEqual(restoredAtWaypoint.checkpoint(), cardinalToDiag.checkpoint());
    }
    const unit = cardinalToDiag.snapshot.units[0];
    const savedUnit = cardinalToDiag.checkpoint().units[0];
    if (!restoredAtWaypoint && unit.xSubcells === 15 * 1024 + 512 && unit.ySubcells === 15 * 1024 + 512 && savedUnit.pathIndex === 2) {
      assert.equal(unit.facing, 0);
      restoredAtWaypoint = DeterministicSimulation.restore(cardinalToDiag.checkpoint());
    }
    if (unit.activity === "idle") break;
  }
  assert.ok(restoredAtWaypoint, "mover must reach intermediate waypoint (15,15) before 45-degree bend");
  assert.deepEqual([cardinalToDiag.snapshot.units[0].cellX, cardinalToDiag.snapshot.units[0].cellY], [16, 16]);
});

test("unit stopped by moveWait at an intermediate 45-degree bend turns using turnSpeed after resuming from rest", () => {
  const grid = new NavigationGrid(6, 4);
  grid.costs.fill(0);
  for (const [x, y] of [[1, 1], [2, 1], [3, 1], [2, 2], [3, 2], [4, 2]]) {
    grid.costs[grid.index(x, y)] = 1;
  }
  const sim = new DeterministicSimulation(grid, { groundMovement: "eight-way-v1" });
  const mover = sim.addUnit({ faction: "human", cell: { x: 1, y: 1 }, speedSubcellsPerTick: 256, turnSpeed: 10 });
  sim.queue({ type: "move", unitIds: [mover], target: { x: 4, y: 2 } });
  while (!(sim.snapshot.units[0].xSubcells === 2 * 1024 + 512 && sim.snapshot.units[0].ySubcells === 1 * 1024 + 512)) {
    sim.advance();
  }
  assert.equal(sim.snapshot.units[0].facing, 0);
  assert.equal(sim.checkpoint().units[0].pathIndex, 2);
  const blocker = sim.addUnit({ faction: "human", cell: { x: 3, y: 2 } });
  const beforeWait = sim.snapshot.units[0];
  sim.advance();
  const waiting = sim.snapshot.units[0];
  assert.equal(waiting.moveWait, 5);
  assert.equal(sim.checkpoint().units[0].pathIndex, 1);
  assert.equal(missionUnitAction(waiting, beforeWait, true), "Stand");
  sim.removeUnit(blocker);
  while (sim.snapshot.units[0].moveWait !== undefined) {
    const prev = sim.snapshot.units[0];
    sim.advance();
    assert.equal(missionUnitAction(sim.snapshot.units[0], prev, true), "Stand");
  }
  // On the first tick after moveWait expires, the unit is starting from rest (pathIndex === 1) and must step by turnSpeed (10), not snap to 32.
  const prev = sim.snapshot.units[0];
  sim.advance();
  const resumed = sim.snapshot.units[0];
  assert.equal(resumed.facing, 10);
  assert.equal(resumed.xSubcells, prev.xSubcells);
  assert.equal(resumed.ySubcells, prev.ySubcells);
  assert.equal(missionUnitAction(resumed, prev, true), "Stand");
});

test("units without turn speed have no facing state", () => {
  assert.equal(make().sim.snapshot.units[0].facing, undefined);
});

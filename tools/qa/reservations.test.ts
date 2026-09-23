import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { NavigationGrid } from "../../src/engine/grid";

test("mobile source overrides preserve HP and fixed-point position", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(3, 3));
  const id = simulation.addUnit({ faction: "human", cell: { x: 1, y: 1 }, maxHealth: 800,
    health: 300, positionSubcells: { x: 1200, y: 1700 } });
  const unit = simulation.snapshot.units.find((unit) => unit.id === id)!;
  assert.deepEqual([unit.health, unit.maxHealth, unit.xSubcells, unit.ySubcells], [300, 800, 1200, 1700]);
  assert.throws(() => simulation.addUnit({ faction: "human", cell: { x: 1, y: 1 }, health: 0 }), RangeError);
  assert.throws(() => simulation.addUnit({ faction: "human", cell: { x: 1, y: 1 },
    positionSubcells: { x: 500, y: 1500 } }), RangeError);
});

test("destination reservation fires once per claimed path segment, not every partial tick", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(4, 1));
  const unitId = simulation.addUnit({ faction: "human", cell: { x: 0, y: 0 }, speedSubcellsPerTick: 256 });
  simulation.queue({ type: "move", unitIds: [unitId], target: { x: 2, y: 0 } });
  simulation.advance();
  assert.deepEqual(simulation.reservationEvents, [{ unitId, tileX: 1, tileY: 0 }]);
  const saved = simulation.reservationEvents;
  for (let tick = 0; tick < 3; tick += 1) {
    simulation.advance();
    assert.deepEqual(simulation.reservationEvents, []);
  }
  simulation.advance();
  assert.deepEqual(simulation.reservationEvents, [{ unitId, tileX: 2, tileY: 0 }]);
  assert.deepEqual(saved, [{ unitId, tileX: 1, tileY: 0 }]);
});

test("blocked and stopped units do not emit successful reservations", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(3, 1));
  const unitId = simulation.addUnit({ faction: "human", cell: { x: 0, y: 0 } });
  simulation.addUnit({ faction: "human", cell: { x: 1, y: 0 } });
  simulation.queue({ type: "move", unitIds: [unitId], target: { x: 2, y: 0 } });
  simulation.advance();
  assert.deepEqual(simulation.reservationEvents, []);
  simulation.queue({ type: "stop", unitIds: [unitId] });
  simulation.advance();
  assert.deepEqual(simulation.reservationEvents, []);
});
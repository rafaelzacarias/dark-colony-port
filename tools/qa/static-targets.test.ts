import assert from "node:assert/strict";
import test from "node:test";

import { NavigationGrid } from "../../src/engine/grid";
import { DeterministicSimulation } from "../../src/engine/simulation";

test("simultaneous lethal shots at a static target emit one death and clear events next tick", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(3, 1));
  const targetId = simulation.addStaticTarget({
    faction: "alien", cell: { x: 1, y: 0 }, maxHealth: 100,
    footprint: [{ x: 1, y: 0 }, { x: 1, y: 0 }],
  });
  const attackers = [0, 2].map((cellX) => simulation.addUnit({
    faction: "human",
    cell: { x: cellX, y: 0 },
    weapon: { damage: 100, rangeCells: 1, cooldownTicks: 1 },
  }));
  assert.deepEqual(simulation.deathEvents, []);
  simulation.queue({ type: "attack", unitIds: [...attackers].reverse(), targetId });
  simulation.advance();
  assert.deepEqual(simulation.combatEvents, attackers.map((attackerId) => ({
    type: "shot", tick: 0, attackerId, targetId, damage: 100,
  })));
  assert.equal(simulation.snapshot.staticTargets[0].health, 0);
  assert.deepEqual(simulation.grid.costs, new Uint16Array([1, 1, 1]));
  const deaths = simulation.deathEvents;
  assert.deepEqual(deaths, [{ type: "death", tick: 0, targetId }]);
  assert.notEqual(deaths, simulation.deathEvents);
  assert.notEqual(deaths[0], simulation.deathEvents[0]);
  assert.ok(Object.isFrozen(deaths));
  assert.ok(Object.isFrozen(deaths[0]));
  assert.equal(Reflect.set(deaths[0], "targetId", -1), false);
  assert.equal("deathEvents" in simulation.snapshot, false);
  for (let tick = 0; tick < 3; tick += 1) {
    simulation.queue({ type: "attack", unitIds: attackers, targetId });
    simulation.advance();
    assert.deepEqual(simulation.combatEvents, []);
    assert.deepEqual(simulation.deathEvents, []);
    assert.ok(simulation.snapshot.units.every((unit) => unit.activity === "idle" && unit.targetId === null));
  }
  assert.deepEqual(deaths, [{ type: "death", tick: 0, targetId }]);
});

test("static targets have global IDs and detached snapshots, not mobile or production state", () => {
  const grid = new NavigationGrid(5, 1);
  const simulation = new DeterministicSimulation(grid);
  const unitId = simulation.addUnit({ faction: "human", cell: { x: 0, y: 0 } });
  const cell = { x: 1, y: 0 };
  const firstId = simulation.addStaticTarget({ faction: "alien", cell, maxHealth: 120 });
  const resourceId = simulation.addResourceNode({ cell: { x: 2, y: 0 }, amount: 10 });
  const buildingId = simulation.addBuilding({ faction: "human", kind: "core", cell: { x: 3, y: 0 } });
  const secondId = simulation.addStaticTarget({ faction: "human", cell: { x: 4, y: 0 }, maxHealth: 200 });
  assert.deepEqual([unitId, firstId, resourceId, buildingId, secondId], [1, 2, 3, 4, 5]);
  cell.x = 4;
  const snapshot = simulation.snapshot;
  assert.deepEqual(snapshot.staticTargets, [
    { id: firstId, faction: "alien", xSubcells: 1536, ySubcells: 512, cellX: 1, cellY: 0, health: 120, maxHealth: 120 },
    { id: secondId, faction: "human", xSubcells: 4608, ySubcells: 512, cellX: 4, cellY: 0, health: 200, maxHealth: 200 },
  ]);
  assert.equal(snapshot.entityCount, 4);
  assert.deepEqual(snapshot.units.map(({ id }) => id), [unitId]);
  assert.deepEqual(snapshot.buildings.map(({ id }) => id), [buildingId]);
  Reflect.set(snapshot.staticTargets[0], "health", 0);
  assert.equal(simulation.snapshot.staticTargets[0].health, 120);
  assert.deepEqual(grid.costs, new Uint16Array(5).fill(1));
});

test("static target validation rejects invalid coordinates and health without consuming IDs", () => {
  const grid = new NavigationGrid(3, 2);
  grid.costs[1] = 0;
  const simulation = new DeterministicSimulation(grid);
  for (const invalid of [-1, 0.5, NaN, Infinity, -Infinity]) {
    for (const cell of [{ x: invalid, y: 0 }, { x: 0, y: invalid }]) {
      assert.throws(() => simulation.addStaticTarget({ faction: "alien", cell, maxHealth: 100 }), RangeError);
    }
  }
  for (const cell of [{ x: 3, y: 0 }, { x: 0, y: 2 }]) {
    assert.throws(() => simulation.addStaticTarget({ faction: "alien", cell, maxHealth: 100 }), RangeError);
  }
  for (const maxHealth of [0, -1, 0.5, NaN, Infinity, -Infinity]) {
    assert.throws(() => simulation.addStaticTarget({ faction: "alien", cell: { x: 0, y: 0 }, maxHealth }), RangeError);
  }
  assert.deepEqual(simulation.snapshot.staticTargets, []);
  assert.equal(simulation.addStaticTarget({ faction: "alien", cell: { x: 1, y: 0 }, maxHealth: 1 }), 1);
  assert.equal(grid.isPassable(1, 0), false);
});

test("static targets preserve health overrides and precise positions independently of source cells", () => {
  const grid = new NavigationGrid(4, 2);
  grid.costs[2] = 0;
  const simulation = new DeterministicSimulation(grid);
  for (const health of [25, 175]) {
    const positionSubcells = { x: 2048.5, y: 1023.75 };
    const id = simulation.addStaticTarget({
      faction: "alien", cell: { x: 0, y: 1 }, maxHealth: 100, health, positionSubcells,
    });
    positionSubcells.x = 0;
    positionSubcells.y = 0;
    assert.deepEqual(simulation.snapshot.staticTargets.find((target) => target.id === id), {
      id, faction: "alien", cellX: 2, cellY: 0, xSubcells: 2048.5, ySubcells: 1023.75, health, maxHealth: 100,
    });
  }
  assert.deepEqual(grid.costs, new Uint16Array([1, 1, 0, 1, 1, 1, 1, 1]));
});

test("invalid overrides and footprints leave IDs, targets and grid costs untouched", () => {
  const grid = new NavigationGrid(3, 2, new Uint16Array([1, 7, 0, 2, 3, 4]));
  const simulation = new DeterministicSimulation(grid);
  const options = { faction: "alien" as const, cell: { x: 0, y: 0 }, maxHealth: 100 };
  const existingId = simulation.addStaticTarget({ ...options, footprint: [{ x: 1, y: 0 }] });
  const before = simulation.snapshot;
  const costs = grid.costs.slice();
  const footprint = [{ x: 1, y: 0 }, { x: 0, y: 1 }];
  for (const health of [0, -1, 0.5, NaN, Infinity, -Infinity]) {
    assert.throws(() => simulation.addStaticTarget({ ...options, health, footprint }), RangeError);
  }
  for (const invalid of [-1, NaN, Infinity, -Infinity]) {
    for (const positionSubcells of [{ x: invalid, y: 0 }, { x: 0, y: invalid }]) {
      assert.throws(() => simulation.addStaticTarget({ ...options, positionSubcells, footprint }), RangeError);
    }
  }
  for (const positionSubcells of [{ x: 3072, y: 0 }, { x: 0, y: 2048 }]) {
    assert.throws(() => simulation.addStaticTarget({ ...options, positionSubcells, footprint }), RangeError);
  }
  for (const invalid of [-1, 0.5, NaN, Infinity, -Infinity, 3]) {
    for (const cell of [{ x: invalid, y: 0 }, { x: 0, y: invalid }]) {
      assert.throws(() => simulation.addStaticTarget({ ...options, footprint: [...footprint, cell] }), RangeError);
    }
  }
  assert.deepEqual(simulation.snapshot, before);
  assert.deepEqual(grid.costs, costs);
  const attackerId = simulation.addUnit({
    faction: "human", cell: { x: 0, y: 1 },
    weapon: { damage: 100, rangeCells: 2, cooldownTicks: 1 },
  });
  assert.equal(attackerId, existingId + 1);
  simulation.queue({ type: "attack", unitIds: [attackerId], targetId: existingId });
  simulation.advance();
  assert.deepEqual(grid.costs, new Uint16Array([1, 7, 0, 2, 3, 4]));
});

for (const reverseDeaths of [false, true]) {
  test(`overlapping footprints restore original costs only after the last death, reverse=${reverseDeaths}`, () => {
    const sourceCosts = new Uint16Array([1, 9, 0, 5, 1]);
    const grid = new NavigationGrid(5, 1, sourceCosts);
    const simulation = new DeterministicSimulation(grid);
    const attackerId = simulation.addUnit({
      faction: "human", cell: { x: 0, y: 0 },
      weapon: { damage: 100, rangeCells: 5, cooldownTicks: 1 },
    });
    const footprint = [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 0 }];
    const firstId = simulation.addStaticTarget({
      faction: "alien", cell: { x: 2, y: 0 }, maxHealth: 100, footprint,
    });
    footprint[0].x = 4;
    footprint.pop();
    const secondId = simulation.addStaticTarget({
      faction: "alien", cell: { x: 3, y: 0 }, maxHealth: 100,
      footprint: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }],
    });
    assert.deepEqual(grid.costs, new Uint16Array([1, 0, 0, 0, 1]));
    const victims = reverseDeaths ? [secondId, firstId] : [firstId, secondId];
    simulation.queue({ type: "attack", unitIds: [attackerId], targetId: victims[0] });
    simulation.advance();
    assert.deepEqual(grid.costs, new Uint16Array([1, 0, 0, reverseDeaths ? 5 : 0, 1]));
    simulation.queue({ type: "attack", unitIds: [attackerId], targetId: victims[1] });
    simulation.advance();
    assert.deepEqual(grid.costs, sourceCosts);
    simulation.advance();
    assert.deepEqual(grid.costs, sourceCosts);
    assert.deepEqual(simulation.deathEvents, []);
  });
}

for (const blockedTargetCell of [false, true]) {
  test(`static target pursuit stops in range with blocked target cell=${blockedTargetCell}`, () => {
    const grid = new NavigationGrid(5, 1);
    if (blockedTargetCell) grid.costs[4] = 0;
    const simulation = new DeterministicSimulation(grid);
    const attackerId = simulation.addUnit({
      faction: "human", cell: { x: 0, y: 0 }, speedSubcellsPerTick: 1024,
      weapon: { damage: 25, rangeCells: 1, cooldownTicks: 2 },
    });
    const targetId = simulation.addStaticTarget({ faction: "alien", cell: { x: 4, y: 0 }, maxHealth: 100 });
    simulation.queue({ type: "attack", unitIds: [attackerId], targetId });
    for (let tick = 0; tick < 3; tick += 1) {
      simulation.advance();
      assert.deepEqual(simulation.combatEvents, []);
      assert.equal(simulation.snapshot.units[0].cellX, tick + 1);
      assert.equal(simulation.snapshot.staticTargets[0].health, 100);
    }
    simulation.advance();
    assert.deepEqual(simulation.combatEvents, [{ type: "shot", tick: 3, attackerId, targetId, damage: 25 }]);
    assert.equal(simulation.snapshot.staticTargets[0].health, 75);
    assert.equal(simulation.snapshot.units[0].cellX, 3);
    simulation.advance();
    assert.deepEqual(simulation.combatEvents, []);
    simulation.advance();
    assert.deepEqual(simulation.combatEvents, [{ type: "shot", tick: 5, attackerId, targetId, damage: 25 }]);
    assert.equal(simulation.snapshot.staticTargets[0].cellX, 4);
  });
}

for (const health of [25, 125]) {
  test(`precise static pursuit reaches actual firing range and damages overridden health=${health}`, () => {
    const simulation = new DeterministicSimulation(new NavigationGrid(5, 3));
    const attackerId = simulation.addUnit({
      faction: "human", cell: { x: 0, y: 1 }, speedSubcellsPerTick: 1024,
      weapon: { damage: 25, rangeCells: 1, cooldownTicks: 1 },
    });
    const targetId = simulation.addStaticTarget({
      faction: "alien", cell: { x: 4, y: 2 }, maxHealth: 100, health,
      positionSubcells: { x: 3071, y: 1536 }, footprint: [{ x: 2, y: 1 }],
    });
    simulation.queue({ type: "move", unitIds: [targetId], target: { x: 0, y: 2 } });
    simulation.queue({ type: "attack", unitIds: [attackerId], targetId });
    let shots = 0;
    let deaths = 0;
    for (let tick = 0; tick < 20; tick += 1) {
      simulation.advance();
      const target = simulation.snapshot.staticTargets[0];
      assert.equal(target.xSubcells, 3071);
      assert.equal(target.ySubcells, 1536);
      assert.equal(target.cellX, 2);
      assert.equal(target.cellY, 1);
      assert.equal(target.maxHealth, 100);
      if (simulation.combatEvents.length) {
        shots += simulation.combatEvents.length;
        const attacker = simulation.snapshot.units[0];
        assert.equal(attacker.cellX, 3);
        assert.equal(attacker.cellY, 1);
      }
      deaths += simulation.deathEvents.length;
      assert.equal(target.health, Math.max(0, health - shots * 25));
    }
    assert.equal(shots, health / 25);
    assert.equal(deaths, 1);
    assert.equal(simulation.grid.isPassable(2, 1), true);
    assert.equal(simulation.snapshot.units[0].activity, "idle");
  });
}

test("navigation crosses released footprints but never opens native source blockers", () => {
  const grid = new NavigationGrid(6, 1, new Uint16Array([1, 1, 7, 1, 1, 0]));
  const simulation = new DeterministicSimulation(grid);
  const attackerId = simulation.addUnit({
    faction: "human", cell: { x: 0, y: 0 }, speedSubcellsPerTick: 1024,
    weapon: { damage: 100, rangeCells: 6, cooldownTicks: 1 },
  });
  const options = {
    faction: "alien" as const, cell: { x: 5, y: 0 }, maxHealth: 100,
    footprint: [{ x: 2, y: 0 }, { x: 5, y: 0 }],
  };
  const firstId = simulation.addStaticTarget(options);
  const secondId = simulation.addStaticTarget(options);
  const move = () => simulation.queue({ type: "move", unitIds: [attackerId], target: { x: 4, y: 0 } });
  move();
  simulation.advance();
  assert.equal(simulation.snapshot.units[0].cellX, 0);
  simulation.queue({ type: "attack", unitIds: [attackerId], targetId: firstId });
  simulation.advance();
  move();
  simulation.advance();
  assert.equal(simulation.snapshot.units[0].cellX, 0);
  simulation.queue({ type: "attack", unitIds: [attackerId], targetId: secondId });
  simulation.advance();
  assert.deepEqual(grid.costs, new Uint16Array([1, 1, 7, 1, 1, 0]));
  move();
  for (let tick = 0; tick < 4; tick += 1) simulation.advance();
  assert.equal(simulation.snapshot.units[0].cellX, 4);
  simulation.queue({ type: "move", unitIds: [attackerId], target: { x: 5, y: 0 } });
  simulation.advance();
  assert.equal(simulation.snapshot.units[0].cellX, 4);
  const replacementId = simulation.addStaticTarget(options);
  assert.equal(grid.isPassable(2, 0), false);
  simulation.queue({ type: "attack", unitIds: [attackerId], targetId: replacementId });
  simulation.advance();
  assert.deepEqual(grid.costs, new Uint16Array([1, 1, 7, 1, 1, 0]));
});

test("unreachable static targets do not cause movement or shots", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(4, 1, new Uint16Array([1, 0, 1, 1])));
  const attackerId = simulation.addUnit({
    faction: "human", cell: { x: 0, y: 0 },
    weapon: { damage: 100, rangeCells: 1, cooldownTicks: 1 },
  });
  const targetId = simulation.addStaticTarget({ faction: "alien", cell: { x: 3, y: 0 }, maxHealth: 100 });
  simulation.queue({ type: "attack", unitIds: [attackerId], targetId });
  for (let tick = 0; tick < 3; tick += 1) simulation.advance();
  assert.equal(simulation.snapshot.units[0].cellX, 0);
  assert.equal(simulation.snapshot.staticTargets[0].health, 100);
  assert.deepEqual(simulation.combatEvents, []);
});

test("static targets ignore mobile and build commands and do not reserve cells or grant vision", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(4, 1), { initialResources: { alien: 100 } });
  const targetId = simulation.addStaticTarget({ faction: "alien", cell: { x: 1, y: 0 }, maxHealth: 100 });
  const unitId = simulation.addUnit({ faction: "human", cell: { x: 0, y: 0 }, speedSubcellsPerTick: 1024 });
  const resourceId = simulation.addResourceNode({ cell: { x: 3, y: 0 }, amount: 100 });
  const before = simulation.snapshot.staticTargets;
  simulation.queue({ type: "move", unitIds: [targetId, unitId], target: { x: 2, y: 0 } });
  simulation.queue({ type: "attack", unitIds: [targetId], targetId: unitId });
  simulation.queue({ type: "harvest", unitIds: [targetId], resourceId, dropoff: { x: 1, y: 0 } });
  simulation.queue({ type: "build", builderId: targetId, kind: "turret", target: { x: 3, y: 0 }, cost: 10, buildTicks: 1, maxHealth: 100 });
  simulation.queue({ type: "stop", unitIds: [targetId] });
  simulation.advance();
  assert.equal(simulation.snapshot.units[0].cellX, 1);
  simulation.advance();
  assert.equal(simulation.snapshot.units[0].cellX, 2);
  assert.deepEqual(simulation.snapshot.staticTargets, before);
  assert.deepEqual(simulation.snapshot.buildings, []);
  assert.equal(simulation.snapshot.resourceNodes[0].remaining, 100);
  assert.equal(simulation.snapshot.resources.alien, 100);
  assert.deepEqual(simulation.visibilityMask("alien", 10), new Uint8Array(4));
  assert.deepEqual(simulation.combatEvents, []);
  assert.deepEqual(simulation.deathEvents, []);
});

test("friendly, missing and wrong-kind targets are ignored without replacing valid orders", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(5, 1));
  const attackerId = simulation.addUnit({
    faction: "human", cell: { x: 0, y: 0 },
    weapon: { damage: 10, rangeCells: 4, cooldownTicks: 1 },
    harvester: { cargoCapacity: 10, harvestPerTick: 1 },
  });
  const enemyId = simulation.addStaticTarget({ faction: "alien", cell: { x: 1, y: 0 }, maxHealth: 100 });
  const friendlyId = simulation.addStaticTarget({ faction: "human", cell: { x: 2, y: 0 }, maxHealth: 100 });
  const buildingId = simulation.addBuilding({ faction: "alien", kind: "core", cell: { x: 3, y: 0 } });
  const resourceId = simulation.addResourceNode({ cell: { x: 4, y: 0 }, amount: 100 });
  simulation.queue({ type: "attack", unitIds: [attackerId], targetId: enemyId });
  for (const targetId of [friendlyId, buildingId, resourceId, 999]) {
    simulation.queue({ type: "attack", unitIds: [attackerId], targetId });
  }
  simulation.queue({ type: "harvest", unitIds: [attackerId], resourceId: enemyId, dropoff: { x: 0, y: 0 } });
  simulation.advance();
  assert.equal(simulation.snapshot.units[0].targetId, enemyId);
  assert.deepEqual(simulation.snapshot.staticTargets.map(({ health }) => health), [90, 100]);
  assert.equal(simulation.snapshot.buildings[0].health, 500);
  assert.deepEqual(simulation.combatEvents, [{ type: "shot", tick: 0, attackerId, targetId: enemyId, damage: 10 }]);
});

test("units and static targets die in one simultaneous resolution ordered by victim ID", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(3, 1));
  const staticId = simulation.addStaticTarget({ faction: "alien", cell: { x: 2, y: 0 }, maxHealth: 100 });
  const humanId = simulation.addUnit({
    faction: "human", cell: { x: 0, y: 0 },
    weapon: { damage: 100, rangeCells: 2, cooldownTicks: 1 },
  });
  const alienId = simulation.addUnit({
    faction: "alien", cell: { x: 1, y: 0 },
    weapon: { damage: 100, rangeCells: 2, cooldownTicks: 1 },
  });
  simulation.queue({ type: "attack", unitIds: [alienId], targetId: humanId });
  simulation.queue({ type: "attack", unitIds: [humanId], targetId: staticId });
  simulation.advance();
  assert.deepEqual(simulation.combatEvents.map(({ attackerId, targetId }) => [attackerId, targetId]), [
    [humanId, staticId], [alienId, humanId],
  ]);
  assert.deepEqual(simulation.deathEvents, [staticId, humanId].map((targetId) => ({ type: "death", tick: 0, targetId })));
  assert.equal(simulation.snapshot.units[0].activity, "die");
  assert.equal(simulation.snapshot.staticTargets[0].health, 0);
  simulation.advance();
  assert.deepEqual(simulation.deathEvents, []);
});

test("transport removal removes only units, emits no death, and never reuses IDs", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(3, 1));
  const attackerId = simulation.addUnit({
    faction: "human", cell: { x: 0, y: 0 },
    weapon: { damage: 100, rangeCells: 2, cooldownTicks: 1 },
  });
  const removedId = simulation.addUnit({ faction: "alien", cell: { x: 1, y: 0 } });
  const staticId = simulation.addStaticTarget({ faction: "alien", cell: { x: 2, y: 0 }, maxHealth: 100 });
  simulation.queue({ type: "attack", unitIds: [attackerId], targetId: removedId });
  simulation.advance();
  const deaths = simulation.deathEvents;
  assert.deepEqual(deaths, [{ type: "death", tick: 0, targetId: removedId }]);
  assert.equal(simulation.removeUnit(removedId), true);
  assert.deepEqual(simulation.deathEvents, deaths);
  assert.equal(simulation.removeUnit(removedId), false);
  assert.equal(simulation.removeUnit(staticId), false);
  assert.equal(simulation.removeUnit(999), false);
  const nextId = simulation.addUnit({ faction: "alien", cell: { x: 1, y: 0 } });
  assert.equal(nextId, staticId + 1);
  simulation.queue({ type: "attack", unitIds: [attackerId], targetId: nextId });
  assert.equal(simulation.removeUnit(nextId), true);
  simulation.advance();
  assert.deepEqual(simulation.combatEvents, []);
  assert.deepEqual(simulation.deathEvents, []);
  assert.deepEqual(simulation.snapshot.units.map(({ id }) => id), [attackerId]);
  assert.equal(simulation.snapshot.units[0].activity, "idle");
  assert.equal(simulation.snapshot.entityCount, 2);
});

test("static target snapshots and both event streams replay byte-for-byte", () => {
  const replay = () => {
    const simulation = new DeterministicSimulation(new NavigationGrid(6, 1, new Uint16Array([1, 1, 1, 1, 1, 9])), { seed: 99 });
    const options = {
      faction: "alien" as const, cell: { x: 5, y: 0 },
      positionSubcells: { x: 5532, y: 512 }, footprint: [{ x: 5, y: 0 }],
    };
    const targetId = simulation.addStaticTarget({ ...options, maxHealth: 40, health: 60 });
    const attackerId = simulation.addUnit({
      faction: "human", cell: { x: 0, y: 0 }, speedSubcellsPerTick: 1024,
      weapon: { damage: 30, rangeCells: 1, cooldownTicks: 2 },
    });
    const secondId = simulation.addStaticTarget({ ...options, maxHealth: 90, health: 30 });
    simulation.queue({ type: "attack", unitIds: [attackerId], targetId }, 1);
    simulation.queue({ type: "stop", unitIds: [attackerId] }, 3);
    simulation.queue({ type: "attack", unitIds: [attackerId], targetId }, 5);
    simulation.queue({ type: "attack", unitIds: [attackerId], targetId: secondId }, 11);
    return Array.from({ length: 14 }, () => {
      simulation.advance();
      return {
        snapshot: simulation.snapshot, shots: simulation.combatEvents, deaths: simulation.deathEvents,
        costs: [...simulation.grid.costs],
      };
    });
  };
  const first = replay();
  assert.equal(JSON.stringify(replay()), JSON.stringify(first));
  assert.deepEqual(first.flatMap(({ deaths }) => deaths), [
    { type: "death", tick: 9, targetId: 1 }, { type: "death", tick: 11, targetId: 3 },
  ]);
  assert.deepEqual(first.flatMap(({ shots }) => shots.map(({ tick }) => tick)), [7, 9, 11]);
  assert.equal(first[9].costs[5], 0);
  assert.equal(first[11].costs[5], 9);
});
import assert from "node:assert/strict";
import test from "node:test";

import { NavigationGrid } from "../../src/engine/grid";
import { DeterministicSimulation, type CombatEvent } from "../../src/engine/simulation";

function createCombat() {
  const simulation = new DeterministicSimulation(new NavigationGrid(2, 1), { seed: 99 });
  const attackerId = simulation.addUnit({
    faction: "human",
    cell: { x: 0, y: 0 },
    weapon: { damage: 25, rangeCells: 1, cooldownTicks: 3 },
  });
  const targetId = simulation.addUnit({ faction: "alien", cell: { x: 1, y: 0 } });
  return { simulation, attackerId, targetId };
}

test("combat events follow exact cooldown ticks, not attack commands", () => {
  const { simulation, attackerId, targetId } = createCombat();
  assert.deepEqual(simulation.combatEvents, []);
  simulation.queue({ type: "attack", unitIds: [attackerId], targetId });
  assert.deepEqual(simulation.combatEvents, []);

  const eventsByTick: (readonly CombatEvent[])[] = [];
  const healthByTick: number[] = [];
  for (let tick = 0; tick < 7; tick += 1) {
    simulation.advance();
    eventsByTick.push(simulation.combatEvents);
    healthByTick.push(simulation.snapshot.units[1].health);
  }
  assert.deepEqual(eventsByTick, [
    [{ type: "shot", tick: 0, attackerId, targetId, damage: 25 }],
    [],
    [],
    [{ type: "shot", tick: 3, attackerId, targetId, damage: 25 }],
    [],
    [],
    [{ type: "shot", tick: 6, attackerId, targetId, damage: 25 }],
  ]);
  assert.deepEqual(healthByTick, [75, 75, 75, 50, 50, 50, 25]);
  assert.equal(simulation.snapshot.tick, 7);
  assert.equal("combatEvents" in simulation.snapshot, false);
});

test("combat event getter returns immutable copies that survive later advances", () => {
  const { simulation, attackerId, targetId } = createCombat();
  simulation.queue({ type: "attack", unitIds: [attackerId], targetId });
  simulation.advance();
  const events = simulation.combatEvents;
  const secondRead = simulation.combatEvents;
  assert.notEqual(events, secondRead);
  assert.notEqual(events[0], secondRead[0]);
  assert.deepEqual(events, secondRead);
  assert.ok(Object.isFrozen(events));
  assert.ok(Object.isFrozen(events[0]));
  assert.equal(Reflect.set(events[0], "damage", 999), false);
  assert.equal(Reflect.set(events, "length", 0), false);
  assert.deepEqual(simulation.combatEvents, secondRead);

  simulation.queue({ type: "stop", unitIds: [attackerId] });
  assert.deepEqual(simulation.combatEvents, events);
  simulation.advance();
  assert.deepEqual(simulation.combatEvents, []);
  assert.deepEqual(events, [{ type: "shot", tick: 0, attackerId, targetId, damage: 25 }]);
});

test("command replay produces identical per-tick combat events and snapshots", () => {
  const replay = () => {
    const { simulation, attackerId, targetId } = createCombat();
    simulation.queue({ type: "attack", unitIds: [attackerId], targetId }, 2);
    simulation.queue({ type: "stop", unitIds: [attackerId] }, 6);
    simulation.queue({ type: "attack", unitIds: [attackerId], targetId }, 9);
    return Array.from({ length: 16 }, () => {
      simulation.advance();
      return { snapshot: simulation.snapshot, events: simulation.combatEvents };
    });
  };
  const first = replay();
  assert.deepEqual(first.flatMap(({ events }) => events.map(({ tick }) => tick)), [2, 5, 9, 12]);
  assert.equal(JSON.stringify(replay()), JSON.stringify(first));
});

test("mutual lethal shots both emit before simultaneous damage resolution", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(2, 1));
  const human = simulation.addUnit({
    faction: "human",
    cell: { x: 0, y: 0 },
    weapon: { damage: 100, rangeCells: 1, cooldownTicks: 1 },
  });
  const alien = simulation.addUnit({
    faction: "alien",
    cell: { x: 1, y: 0 },
    weapon: { damage: 100, rangeCells: 1, cooldownTicks: 1 },
  });
  simulation.queue({ type: "attack", unitIds: [alien], targetId: human });
  simulation.queue({ type: "attack", unitIds: [human], targetId: alien });
  simulation.advance();
  assert.deepEqual(simulation.combatEvents, [
    { type: "shot", tick: 0, attackerId: human, targetId: alien, damage: 100 },
    { type: "shot", tick: 0, attackerId: alien, targetId: human, damage: 100 },
  ]);
  assert.deepEqual(simulation.snapshot.units.map(({ health, activity }) => ({ health, activity })), [
    { health: 0, activity: "die" },
    { health: 0, activity: "die" },
  ]);
  simulation.queue({ type: "attack", unitIds: [human], targetId: alien });
  simulation.queue({ type: "attack", unitIds: [alien], targetId: human });
  simulation.advance();
  assert.deepEqual(simulation.combatEvents, []);
});

test("dead targets emit no further shots", () => {
  const { simulation, attackerId, targetId } = createCombat();
  simulation.queue({ type: "attack", unitIds: [attackerId], targetId });
  for (let tick = 0; tick < 10; tick += 1) simulation.advance();
  assert.deepEqual(simulation.combatEvents, [{ type: "shot", tick: 9, attackerId, targetId, damage: 25 }]);
  assert.equal(simulation.snapshot.units[1].health, 0);
  for (let tick = 0; tick < 5; tick += 1) {
    simulation.queue({ type: "attack", unitIds: [attackerId], targetId });
    simulation.advance();
    assert.deepEqual(simulation.combatEvents, []);
  }
});

test("out-of-range pursuit emits only after the range check passes", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(4, 1));
  const attackerId = simulation.addUnit({
    faction: "human",
    cell: { x: 0, y: 0 },
    speedSubcellsPerTick: 1024,
    weapon: { damage: 25, rangeCells: 1, cooldownTicks: 1 },
  });
  const targetId = simulation.addUnit({ faction: "alien", cell: { x: 3, y: 0 } });
  simulation.queue({ type: "attack", unitIds: [attackerId], targetId });
  for (let tick = 0; tick < 2; tick += 1) {
    simulation.advance();
    assert.deepEqual(simulation.combatEvents, []);
    assert.equal(simulation.snapshot.units[1].health, 100);
  }
  assert.equal(simulation.snapshot.units[0].cellX, 2);
  simulation.advance();
  assert.deepEqual(simulation.combatEvents, [{ type: "shot", tick: 2, attackerId, targetId, damage: 25 }]);
  assert.equal(simulation.snapshot.units[1].health, 75);
});

test("pursuit stops its partial leg before firing without same-step displacement", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(6, 1));
  const attackerId = simulation.addUnit({ faction: "human", cell: { x: 0, y: 0 },
    speedSubcellsPerTick: 600, weapon: { damage: 10, rangeCells: 2, cooldownTicks: 2 } });
  const targetId = simulation.addUnit({ faction: "alien", cell: { x: 3, y: 0 } });
  simulation.queue({ type: "attack", unitIds: [attackerId], targetId });
  const shotTicks: number[] = [];
  for (let tick = 0; tick < 7; tick += 1) {
    const before = simulation.snapshot.units[0];
    simulation.advance();
    const after = simulation.snapshot.units[0];
    if (simulation.combatEvents.length === 0) continue;
    shotTicks.push(tick);
    assert.deepEqual([after.xSubcells, after.ySubcells], [before.xSubcells, before.ySubcells]);
    const attacker = simulation.checkpoint().units.find(({ id }) => id === attackerId)!;
    assert.deepEqual(attacker.path, []);
    assert.equal(attacker.pathIndex, 0);
    assert.equal(attacker.reservedDestination, null);
    assert.equal(simulation.reservationEvents.length, 0);
  }
  assert.deepEqual(shotTicks, [2, 4, 6]);
});

test("Attack interrupts an in-progress Move in range before any further displacement", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(8, 2));
  const attackerId = simulation.addUnit({ faction: "human", cell: { x: 0, y: 0 },
    speedSubcellsPerTick: 256, weapon: { damage: 25, rangeCells: 4, cooldownTicks: 3 } });
  const targetId = simulation.addUnit({ faction: "alien", cell: { x: 2, y: 1 } });
  simulation.queue({ type: "move", unitIds: [attackerId], target: { x: 6, y: 0 } });
  simulation.advance();
  const before = simulation.snapshot.units[0];
  assert.equal(before.activity, "move");
  assert.notEqual(simulation.checkpoint().units[0].reservedDestination, null);
  simulation.queue({ type: "attack", unitIds: [attackerId], targetId });
  simulation.advance();
  const after = simulation.snapshot.units[0];
  assert.deepEqual([after.xSubcells, after.ySubcells], [before.xSubcells, before.ySubcells]);
  assert.equal(after.activity, "attack");
  assert.deepEqual(simulation.combatEvents, [{ type: "shot", tick: 1, attackerId, targetId, damage: 25 }]);
  assert.deepEqual(simulation.checkpoint().units[0].path, []);
  assert.equal(simulation.checkpoint().units[0].reservedDestination, null);
});

test("Move interrupts fire while cooldown elapses and stopped fire resumes exactly once with deterministic restore", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(10, 2), { seed: 99 });
  const attackerId = simulation.addUnit({ faction: "human", cell: { x: 0, y: 0 },
    speedSubcellsPerTick: 256, weapon: { damage: 10, rangeCells: 10, cooldownTicks: 3 } });
  const targetId = simulation.addUnit({ faction: "alien", cell: { x: 7, y: 1 } });
  const attack = { type: "attack" as const, unitIds: [attackerId], targetId };
  simulation.queue(attack, 0);
  simulation.queue({ type: "move", unitIds: [attackerId], target: { x: 3, y: 0 } }, 1);
  simulation.queue(attack, 3);
  simulation.queue({ type: "move", unitIds: [attackerId], target: { x: 5, y: 0 } }, 4);
  simulation.queue(attack, 8);
  const initialRandomState = simulation.snapshot.randomState;
  const restored = DeterministicSimulation.restore(simulation.checkpoint());
  const shotTicks: number[] = [];
  for (let tick = 0; tick < 14; tick += 1) {
    const before = simulation.snapshot.units[0];
    simulation.advance();
    restored.advance();
    assert.deepEqual(restored.checkpoint(), simulation.checkpoint());
    assert.equal(simulation.snapshot.randomState, initialRandomState);
    const after = simulation.snapshot.units[0];
    if (after.activity === "move") {
      assert.notEqual(after.xSubcells, before.xSubcells);
      assert.equal(simulation.combatEvents.length, 0);
    }
    for (const shot of simulation.combatEvents) {
      shotTicks.push(shot.tick);
      assert.deepEqual([after.xSubcells, after.ySubcells], [before.xSubcells, before.ySubcells]);
      assert.equal(simulation.checkpoint().units[0].attackCooldown, 3);
    }
    if (tick === 7) assert.equal(simulation.checkpoint().units[0].attackCooldown, 0);
  }
  assert.deepEqual(shotTicks, [0, 3, 8, 11]);
  assert.equal(simulation.snapshot.units[1].health, 60);
});

for (const last of ["move", "attack"] as const) test(`same-tick Move/Attack respects final ${last} command without walking fire`, () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(6, 2));
  const attackerId = simulation.addUnit({ faction: "human", cell: { x: 0, y: 0 },
    weapon: { damage: 25, rangeCells: 4, cooldownTicks: 3 } });
  const targetId = simulation.addUnit({ faction: "alien", cell: { x: 1, y: 1 } });
  const move = { type: "move" as const, unitIds: [attackerId], target: { x: 5, y: 0 } };
  const attack = { type: "attack" as const, unitIds: [attackerId], targetId };
  const before = simulation.snapshot.units[0];
  for (const command of last === "move" ? [attack, move] : [move, attack]) simulation.queue(command);
  simulation.advance();
  const after = simulation.snapshot.units[0];
  assert.equal(after.activity, last);
  assert.equal(after.xSubcells === before.xSubcells, last === "attack");
  assert.equal(simulation.combatEvents.length, last === "attack" ? 1 : 0);
});

test("a completed static-target approach cannot fire on its arrival step", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(5, 1));
  const attackerId = simulation.addUnit({ faction: "human", cell: { x: 0, y: 0 },
    speedSubcellsPerTick: 2048, weapon: { damage: 25, rangeCells: 1, cooldownTicks: 3 } });
  const targetId = simulation.addStaticTarget({ faction: "alien", cell: { x: 3, y: 0 }, maxHealth: 100 });
  simulation.queue({ type: "attack", unitIds: [attackerId], targetId });
  simulation.advance();
  const arrived = simulation.snapshot.units[0];
  assert.equal(arrived.cellX, 2);
  assert.deepEqual(simulation.checkpoint().units[0].path, []);
  assert.equal(simulation.movementFinishedEvents.length, 1);
  assert.equal(simulation.combatEvents.length, 0);
  simulation.advance();
  assert.equal(simulation.snapshot.units[0].xSubcells, arrived.xSubcells);
  assert.deepEqual(simulation.combatEvents, [{ type: "shot", tick: 1, attackerId, targetId, damage: 25 }]);
});

test("a target leaving range causes pursuit without shots then stopped fire resumes", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(10, 1));
  const targetId = simulation.addUnit({ faction: "alien", cell: { x: 2, y: 0 }, speedSubcellsPerTick: 1024 });
  const attackerId = simulation.addUnit({ faction: "human", cell: { x: 0, y: 0 },
    speedSubcellsPerTick: 1024, weapon: { damage: 10, rangeCells: 2, cooldownTicks: 2 } });
  simulation.queue({ type: "attack", unitIds: [attackerId], targetId });
  simulation.advance();
  assert.equal(simulation.combatEvents.length, 1);
  simulation.queue({ type: "move", unitIds: [targetId], target: { x: 5, y: 0 } });
  const shotTicks: number[] = [];
  for (let tick = 1; tick < 7; tick += 1) {
    const before = simulation.snapshot.units[1];
    simulation.advance();
    const after = simulation.snapshot.units[1];
    if (tick <= 3) {
      assert.notEqual(after.xSubcells, before.xSubcells);
      assert.equal(simulation.combatEvents.length, 0);
    }
    for (const shot of simulation.combatEvents) {
      shotTicks.push(shot.tick);
      assert.equal(after.xSubcells, before.xSubcells);
    }
  }
  assert.deepEqual(shotTicks, [4, 6]);
});
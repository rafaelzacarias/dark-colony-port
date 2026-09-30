import assert from "node:assert/strict";
import test from "node:test";

import { NavigationGrid } from "../../src/engine/grid";
import { boom2Percent, projectileLifetime } from "../../src/engine/projectiles";
import { DeterministicSimulation } from "../../src/engine/simulation";

// WEAPSTAT weapon 1: rate 15, speed 60, range 4.
const weapon = { damage: 100, rangeCells: 4, cooldownTicks: 15, projectileSpeed: 60, weaponId: 1, splash: 0 };

function duel(distance: number) {
  const simulation = new DeterministicSimulation(new NavigationGrid(16, 4), { seed: 5 });
  const attackerId = simulation.addUnit({ faction: "human", team: 0, cell: { x: 1, y: 1 }, weapon, maxHealth: 5000 });
  const targetId = simulation.addUnit({ faction: "alien", team: 1, cell: { x: 1 + distance, y: 1 }, maxHealth: 5000 });
  simulation.queue({ type: "attack", unitIds: [attackerId], targetId });
  return { simulation, attackerId, targetId };
}

test("native lifetime arithmetic (0x43b935): (4,60)->35, (12,60)->69, (2,15)->103", () => {
  assert.equal(projectileLifetime(4, 60), 35);
  assert.equal(projectileLifetime(12, 60), 69);
  assert.equal(projectileLifetime(2, 15), 103);
});

test("damage applies at impact, after flight, and launches repeat at native ticks 0,17,34,51", () => {
  const { simulation, attackerId, targetId } = duel(3);
  const launches: number[] = [], impacts: number[] = [];
  let healthAtFirstLaunch = 0;
  for (let tick = 0; tick < 60; tick++) {
    simulation.advance();
    for (const event of simulation.launchEvents) {
      launches.push(event.tick);
      if (!healthAtFirstLaunch) healthAtFirstLaunch = simulation.snapshot.units.find(unit => unit.id === targetId)!.health;
    }
    for (const event of simulation.combatEvents) {
      assert.equal(event.attackerId, attackerId);
      assert.equal(event.targetId, targetId);
      impacts.push(event.tick);
    }
  }
  assert.deepEqual(launches, [0, 17, 34, 51]);
  assert.equal(healthAtFirstLaunch, 5000);
  assert.ok(impacts[0] > 0 && impacts[0] < 17, `first impact after launch: ${impacts}`);
  assert.equal(impacts.length, 4);
});

test("projectiles are not homing: a hostile unit on the flight line is struck instead of the aimed target", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(16, 4), { seed: 5 });
  const attackerId = simulation.addUnit({ faction: "human", team: 0, cell: { x: 1, y: 1 }, weapon, maxHealth: 5000 });
  const blockerId = simulation.addUnit({ faction: "alien", team: 1, cell: { x: 3, y: 1 }, maxHealth: 5000 });
  const targetId = simulation.addUnit({ faction: "alien", team: 1, cell: { x: 5, y: 1 }, maxHealth: 5000 });
  simulation.queue({ type: "attack", unitIds: [attackerId], targetId });
  const hit: (number | null)[] = [];
  for (let tick = 0; tick < 8; tick++) {
    simulation.advance();
    hit.push(...simulation.impactEvents.map(event => event.targetId));
  }
  assert.equal(hit[0], blockerId);
  assert.equal(simulation.snapshot.units.find(unit => unit.id === targetId)!.health, 5000);
});

test("in-flight projectiles round-trip through checkpoint/restore", () => {
  const { simulation } = duel(4);
  simulation.advance();
  assert.ok(simulation.projectiles.length > 0);
  const restored = DeterministicSimulation.restore(JSON.parse(JSON.stringify(simulation.checkpoint())));
  assert.deepEqual(restored.projectiles, simulation.projectiles);
  for (let tick = 0; tick < 40; tick++) {
    simulation.advance();
    restored.advance();
    assert.deepEqual(restored.snapshot, simulation.snapshot);
    assert.deepEqual(restored.combatEvents, simulation.combatEvents);
    assert.deepEqual(restored.projectiles, simulation.projectiles);
  }
});

test("BOOMSTAT record 2 weights", () => {
  assert.equal(boom2Percent(0, 0), 100);
  assert.equal(boom2Percent(1, 0), 90);
  assert.equal(boom2Percent(3, 3), 5);
  assert.equal(boom2Percent(4, 0), 0);
});

import assert from "node:assert/strict";
import test from "node:test";
import { browserMineOptions, validateBrowserMineOptions } from "../../src/engine/browser-mines";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { NavigationGrid } from "../../src/engine/grid";
import { auditFireMovement } from "./fixtures/source-fire-movement-audit";

const source = { runtimeProfile: "browser-adapted", weapons: [
  { id: 38, rawPrefix: 6, damage: 1300, range: 1, shots: 2, rateOfFire: 150 },
], damageMatrix: Array.from({ length: 9 }, () => Array(10).fill(256)) };
const stat = { index: 45, sprite: "HMINE", faction: 0, movementSpeed: 0, observationDay: 1, observationNight: 1,
  weapons: [38, 38, 38] as const, health: 100 };

test("adapted mines: explicit source contract excludes strict, other types and invented BOOM radius", () => {
  assert.equal(browserMineOptions({ ...source, runtimeProfile: undefined }, stat), undefined);
  assert.equal(browserMineOptions(source, { ...stat, index: 41 }), undefined);
  for (const index of [45, 46]) {
    const mine = browserMineOptions(source, { ...stat, index })!;
    assert.equal(mine.sourceTypeIndex, index);
    assert.equal(mine.boomId, 2);
    // BOOMSTAT record 2 is a 7x7 grid of cell offsets, so the blast reaches 3 cells.
    assert.equal(mine.splashRange, 3);
    assert.equal(mine.radiusPolicy, "boom2-7x7-cell-grid");
    assert.notEqual(mine.weapon.sourceDamage.coefficients, source.damageMatrix[6]);
    validateBrowserMineOptions(JSON.parse(JSON.stringify(mine)));
    assert.throws(() => validateBrowserMineOptions({ ...mine, splashRange: 2 }));
    assert.throws(() => validateBrowserMineOptions({ ...mine, falloff: "hard-cutoff" } as unknown as typeof mine));
    assert.throws(() => validateBrowserMineOptions({ ...mine, sourceTypeIndex: 41 } as unknown as typeof mine));
    assert.throws(() => validateBrowserMineOptions({ ...mine, cooldown: 0 } as typeof mine));
  }
});

test("adapted mines: legal approach, simultaneous splash/self death, one shot per victim and JSON replay", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(9, 7));
  const mine = simulation.addStaticTarget({ faction: "human", team: 0, cell: { x: 4, y: 3 }, maxHealth: 100,
    mine: browserMineOptions(source, stat) });
  const neighbor = simulation.addStaticTarget({ faction: "human", team: 0, cell: { x: 4, y: 3 }, maxHealth: 100 });
  const enemy = simulation.addUnit({ faction: "alien", team: 1, cell: { x: 2, y: 3 }, maxHealth: 2000,
    speedSubcellsPerTick: 1024, sourceDefense: { targetClass: 0, armorFactor: 128 } });
  const second = simulation.addUnit({ faction: "alien", team: 1, cell: { x: 4, y: 4 }, maxHealth: 1000 });
  simulation.queue({ type: "move", unitIds: [enemy], target: { x: 3, y: 3 } });
  const restored = DeterministicSimulation.restore(JSON.parse(JSON.stringify(simulation.checkpoint())));
  const before = simulation.checkpoint();
  simulation.queue({ type: "move", unitIds: [mine], target: { x: 0, y: 0 } });
  restored.queue({ type: "move", unitIds: [mine], target: { x: 0, y: 0 } });
  simulation.advance(); restored.advance();
  assert.equal(auditFireMovement(before, simulation.checkpoint()).shots.length, 2);
  const displaced = simulation.checkpoint();
  Object.assign(displaced.staticTargets[0], { xSubcells: displaced.staticTargets[0].xSubcells + 1 });
  assert.throws(() => auditFireMovement(before, displaced), /shot X displacement/);
  assert.deepEqual(restored.checkpoint(), simulation.checkpoint());
  assert.deepEqual(simulation.combatEvents.map(event => [event.attackerId, event.targetId, event.damage]),
    // BOOM2 weights: cardinal neighbour 90% (1300/2 * 0.9 = 585 after armor), centre-adjacent second victim 90% of 1300.
    [[mine, enemy, 585], [mine, second, 1170]]);
  assert.deepEqual(simulation.deathEvents.map(event => event.targetId), [mine, second]);
  assert.equal(simulation.snapshot.staticTargets[0].health, 0);
  assert.equal(simulation.snapshot.staticTargets[1].id, neighbor);
  assert.equal(simulation.snapshot.staticTargets[1].health, 100);
  assert.equal(simulation.snapshot.staticTargets[0].xSubcells, 4.5 * 1024);
  assert.deepEqual(simulation.staticObstacleCells, []);
  const after = DeterministicSimulation.restore(JSON.parse(JSON.stringify(simulation.checkpoint())));
  for (let tick = 0; tick < 155; tick++) {
    simulation.advance(); after.advance();
    assert.deepEqual(after.checkpoint(), simulation.checkpoint());
    assert.deepEqual(simulation.combatEvents, []);
    assert.deepEqual(simulation.deathEvents, []);
  }
});

test("adapted mines: air, friendly, allied, neutral, absent-team and out-of-range controls", () => {
  for (const control of ["air", "friendly", "allied", "neutral", "neutral-mine", "absent-team", "outside"] as const) {
    const simulation = new DeterministicSimulation(new NavigationGrid(9, 7), { teamAlliances: [[1, 1, 0]] });
    simulation.addStaticTarget({ faction: "human", team: control === "neutral-mine" ? 8 : 0,
      cell: { x: 4, y: 3 }, maxHealth: 800, mine: browserMineOptions(source, { ...stat, index: 46 }) });
    simulation.addUnit({ faction: "alien", team: control === "friendly" ? 0 : control === "allied" ? 1
      : control === "neutral" ? 8 : control === "absent-team" ? undefined : 2,
      movementPlane: control === "air" ? "air" : "ground",
      cell: { x: control === "outside" ? 6 : 5, y: 3 }, maxHealth: 2000 });
    for (let tick = 0; tick < 152; tick++) {
      simulation.advance();
      assert.deepEqual(simulation.combatEvents, [], control);
      assert.deepEqual(simulation.deathEvents, [], control);
    }
    assert.equal(simulation.snapshot.staticTargets[0].health, 800, control);
  }
});

test("adapted mines: observer alliances update live; blast excludes allies/air/neutrals/statics and uses class1 armor", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(9, 7), { teamAlliances: [[1, 1], [0, 1]] });
  simulation.addStaticTarget({ faction: "human", team: 0, cell: { x: 4, y: 3 }, maxHealth: 800,
    mine: browserMineOptions(source, stat) });
  const ground = simulation.addUnit({ faction: "human", team: 1, cell: { x: 5, y: 3 }, maxHealth: 2000,
    sourceDefense: { targetClass: 1, armorFactor: 128 } });
  const air = simulation.addUnit({ faction: "alien", team: 1, movementPlane: "air", cell: { x: 5, y: 3 }, maxHealth: 2000,
    sourceDefense: { targetClass: 2, armorFactor: 256 } });
  const neutral = simulation.addUnit({ faction: "alien", team: 8, cell: { x: 4, y: 4 }, maxHealth: 2000 });
  const friend = simulation.addUnit({ faction: "alien", team: 0, cell: { x: 3, y: 3 }, maxHealth: 2000 });
  simulation.addStaticTarget({ faction: "alien", team: 1, cell: { x: 4, y: 2 }, maxHealth: 2000 });
  simulation.advance();
  assert.equal(simulation.combatEvents.length, 0);
  simulation.setTeamAlliances([[1, 0], [1, 1]]);
  simulation.advance();
  assert.deepEqual(simulation.combatEvents.map(event => [event.targetId, event.damage]), [[ground, 585]]);
  assert.ok(simulation.snapshot.units.filter(unit => [air, neutral, friend].includes(unit.id)).every(unit => unit.health === 2000));
  assert.equal(simulation.snapshot.staticTargets[1].health, 2000);
});

test("adapted mines: simultaneous lethal fire does not cancel detonation; strict checkpoint and admission guards", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(9, 7));
  const options = { faction: "human" as const, team: 0, cell: { x: 4, y: 3 }, maxHealth: 800,
    mine: browserMineOptions(source, stat)! };
  const mine = simulation.addStaticTarget(options);
  const enemy = simulation.addUnit({ faction: "alien", team: 1, cell: { x: 5, y: 3 }, maxHealth: 2000,
    weapon: { damage: 800, rangeCells: 1, cooldownTicks: 1 } });
  assert.throws(() => simulation.addStaticTarget({ ...options, weapon: options.mine.weapon }));
  assert.throws(() => simulation.addStaticTarget({ ...options, footprint: [options.cell] }));
  const saved = simulation.checkpoint();
  for (const mutate of [
    (state: typeof saved) => Object.assign(state.staticTargets[0].mine!, { sourceTypeIndex: 42 }),
    (state: typeof saved) => Object.assign(state.staticTargets[0].mine!, { repeat: true }),
    (state: typeof saved) => Object.assign(state.staticTargets[0], { attackCooldown: 0 }),
    (state: typeof saved) => Object.assign(state.staticTargets[0], { footprint: [3] }),
  ]) {
    const invalid = structuredClone(saved); mutate(invalid);
    assert.throws(() => DeterministicSimulation.restore(invalid));
  }
  simulation.queue({ type: "attack", unitIds: [enemy], targetId: mine });
  simulation.advance();
  assert.equal(simulation.snapshot.units[0].targetId, null);
  assert.deepEqual(simulation.combatEvents.map(event => event.attackerId), [mine]);
  assert.deepEqual(simulation.deathEvents.map(event => event.targetId), [mine]);
  assert.equal(simulation.snapshot.units[0].health, 830); // 2000 - 1300 * 90% (BOOM2 cardinal neighbour)
});

test("adapted mines: burrowing drops enemy target lock, prevents auto-targeting and emits detonation impactEvents", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(12, 5));
  const mobileMine = simulation.addUnit({ faction: "human", team: 0, cell: { x: 6, y: 2 }, maxHealth: 500 });
  const chaser = simulation.addUnit({ faction: "alien", team: 1, cell: { x: 1, y: 2 }, maxHealth: 2000,
    speedSubcellsPerTick: 1024, weapon: { damage: 50, rangeCells: 1, cooldownTicks: 2 } });
  const rangedShooter = simulation.addUnit({ faction: "alien", team: 1, cell: { x: 2, y: 1 }, maxHealth: 2000,
    weapon: { damage: 50, rangeCells: 5, cooldownTicks: 1 } });
  const turret = simulation.addStaticTarget({ faction: "alien", team: 1, cell: { x: 6, y: 0 }, maxHealth: 500,
    weapon: { damage: 50, rangeCells: 5, cooldownTicks: 1 } });
  const artillery = simulation.addUnit({ faction: "alien", team: 1, cell: { x: 0, y: 2 }, maxHealth: 1000,
    unitType: 11, weapon: { damage: 100, rangeCells: 10, cooldownTicks: 5 },
    vision: { dayRangeCells: 10, nightRangeCells: 10 } });

  assert.equal(simulation.canAutoTarget(chaser, mobileMine), true);
  assert.equal(simulation.canAutoTarget(rangedShooter, mobileMine), true);
  assert.equal(simulation.canAutoTarget(turret, mobileMine), true);
  assert.equal(simulation.canArtilleryAcquireTarget(artillery, mobileMine), true);

  simulation.queue({ type: "attack", unitIds: [chaser, rangedShooter], targetId: mobileMine });
  simulation.advance();
  assert.equal(simulation.snapshot.units.find(u => u.id === chaser)!.targetId, mobileMine);
  assert.equal(simulation.snapshot.units.find(u => u.id === chaser)!.activity, "attack");
  assert.equal(simulation.snapshot.units.find(u => u.id === rangedShooter)!.targetId, mobileMine);
  assert.equal(simulation.snapshot.units.find(u => u.id === rangedShooter)!.activity, "attack");
  assert.equal(simulation.snapshot.staticTargets.find(t => t.id === turret)!.targetId, mobileMine);

  const mineOptions = browserMineOptions(source, stat)!;
  assert.equal(simulation.deployUnitToStaticTarget(mobileMine, { maxHealth: 100, mine: mineOptions }), true);
  assert.doesNotThrow(() => simulation.checkpoint());

  // Burrowed mines cannot be auto-targeted by units, turrets, or artillery.
  assert.equal(simulation.canAutoTarget(chaser, mobileMine), false);
  assert.equal(simulation.canAutoTarget(rangedShooter, mobileMine), false);
  assert.equal(simulation.canAutoTarget(turret, mobileMine), false);
  assert.equal(simulation.canArtilleryAcquireTarget(artillery, mobileMine), false);

  // Chaser with remaining path drops target lock and transitions to "move"; stationary ranged shooter transitions to "idle".
  const chaserAfterBurrow = simulation.snapshot.units.find(u => u.id === chaser)!;
  const shooterAfterBurrow = simulation.snapshot.units.find(u => u.id === rangedShooter)!;
  assert.equal(chaserAfterBurrow.targetId, null);
  assert.equal(chaserAfterBurrow.activity, "move");
  assert.equal(shooterAfterBurrow.targetId, null);
  assert.equal(shooterAfterBurrow.activity, "idle");
  assert.equal(simulation.snapshot.staticTargets.find(t => t.id === turret)!.targetId, null);

  // Explicit attack command queued after burrowing is rejected at command admission.
  simulation.queue({ type: "attack", unitIds: [rangedShooter], targetId: mobileMine });

  // As chaser continues walking along its path into trigger range (cell 5,2), the mine activates and detonates.
  let detonated = false;
  for (let step = 0; step < 6; step++) {
    simulation.advance();
    assert.equal(simulation.snapshot.units.find(u => u.id === rangedShooter)!.targetId, null);
    assert.equal(simulation.snapshot.units.find(u => u.id === rangedShooter)!.activity, "idle");
    // Neither rangedShooter, turret, nor artillery fires at the burrowed mine.
    assert.ok(simulation.combatEvents.every(event => event.targetId !== mobileMine));
    assert.equal(simulation.snapshot.units.find(u => u.id === artillery)!.targetId, null);
    const mineShots = simulation.combatEvents.filter(event => event.attackerId === mobileMine);
    if (mineShots.length > 0) {
      detonated = true;
      assert.deepEqual(mineShots.map(event => [event.targetId, event.damage]), [[chaser, 1170]]);
      assert.deepEqual(simulation.impactEvents, [{
        type: "impact",
        tick: simulation.snapshot.tick - 1,
        projectileId: 0,
        attackerId: mobileMine,
        targetId: chaser,
        weaponId: 38,
        xQ8: (6 * 1024 + 512) >> 2,
        yQ8: (2 * 1024 + 512) >> 2,
      }]);
      assert.deepEqual(simulation.deathEvents.map(event => event.targetId), [mobileMine]);
      break;
    }
  }
  assert.equal(detonated, true);
});

test("adapted mines: deployed 3-charge mine detonates 3 times (3->2->1->0, -300 HP clamped to 1, 150-tick cooldown, dies on 3rd charge)", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(9, 7));
  const mobileMine = simulation.addUnit({ faction: "human", team: 0, cell: { x: 4, y: 3 }, maxHealth: 800, health: 800 });
  const mineOptions = { ...browserMineOptions(source, stat)!, chargesRemaining: 3 };
  assert.equal(simulation.deployUnitToStaticTarget(mobileMine, { maxHealth: 800, health: 800, mine: mineOptions }), true);

  const enemy = simulation.addUnit({ faction: "alien", team: 1, cell: { x: 5, y: 3 }, maxHealth: 5000, health: 5000 });

  // Charge 1: triggers immediately, charges 3 -> 2, cooldown = 150, HP 800 -> 500, mine survives.
  simulation.advance();
  let mineTarget = simulation.snapshot.staticTargets.find(t => t.id === mobileMine)!;
  assert.equal(mineTarget.health, 500);
  assert.equal(mineTarget.mine?.chargesRemaining, 2);
  assert.equal(mineTarget.mine?.cooldownRemaining, 150);
  assert.deepEqual(simulation.combatEvents.map(e => [e.attackerId, e.targetId, e.damage]), [[mobileMine, enemy, 1170]]);
  assert.equal(simulation.impactEvents.length, 1);
  assert.equal(simulation.deathEvents.length, 0);

  //Checkpoint & restore mid-cooldown preserves chargesRemaining and cooldownRemaining.
  const midCheckpoint = JSON.parse(JSON.stringify(simulation.checkpoint()));
  const restored = DeterministicSimulation.restore(midCheckpoint);
  assert.deepEqual(restored.checkpoint(), simulation.checkpoint());

  // During the 150-tick re-arm cooldown, the mine does not detonate even with the enemy still in range.
  for (let tick = 0; tick < 150; tick++) {
    simulation.advance();
    assert.equal(simulation.combatEvents.length, 0);
    assert.equal(simulation.deathEvents.length, 0);
    mineTarget = simulation.snapshot.staticTargets.find(t => t.id === mobileMine)!;
    assert.equal(mineTarget.mine?.cooldownRemaining, 149 - tick);
  }

  // Charge 2: triggers on the tick after cooldown reaches 0, charges 2 -> 1, cooldown = 150, HP 500 -> 200.
  simulation.advance();
  mineTarget = simulation.snapshot.staticTargets.find(t => t.id === mobileMine)!;
  assert.equal(mineTarget.health, 200);
  assert.equal(mineTarget.mine?.chargesRemaining, 1);
  assert.equal(mineTarget.mine?.cooldownRemaining, 150);
  assert.deepEqual(simulation.combatEvents.map(e => [e.attackerId, e.targetId, e.damage]), [[mobileMine, enemy, 1170]]);
  assert.equal(simulation.impactEvents.length, 1);
  assert.equal(simulation.deathEvents.length, 0);

  // Wait out the second 150-tick re-arm cooldown.
  for (let tick = 0; tick < 150; tick++) {
    simulation.advance();
    assert.equal(simulation.combatEvents.length, 0);
    assert.equal(simulation.deathEvents.length, 0);
  }

  // Charge 3 (final): charges 1 -> 0, HP 200 -> 0, mine dies and emits deathEvent.
  simulation.advance();
  mineTarget = simulation.snapshot.staticTargets.find(t => t.id === mobileMine)!;
  assert.equal(mineTarget.health, 0);
  assert.equal(mineTarget.mine?.chargesRemaining, 0);
  assert.deepEqual(simulation.combatEvents.map(e => [e.attackerId, e.targetId, e.damage]), [[mobileMine, enemy, 1170]]);
  assert.equal(simulation.impactEvents.length, 1);
  assert.deepEqual(simulation.deathEvents.map(e => e.targetId), [mobileMine]);

  // Also verify 0x41310F clamping to 1 HP when mine starts with <= 300 HP and still has remaining charges.
  const lowHpSim = new DeterministicSimulation(new NavigationGrid(9, 7));
  const lowMine = lowHpSim.addStaticTarget({ faction: "human", team: 0, cell: { x: 4, y: 3 }, maxHealth: 800, health: 250,
    mine: { ...browserMineOptions(source, stat)!, chargesRemaining: 2 } });
  lowHpSim.addUnit({ faction: "alien", team: 1, cell: { x: 5, y: 3 }, maxHealth: 5000 });
  lowHpSim.advance();
  assert.equal(lowHpSim.snapshot.staticTargets.find(t => t.id === lowMine)!.health, 1);
  assert.equal(lowHpSim.snapshot.staticTargets.find(t => t.id === lowMine)!.mine?.chargesRemaining, 1);
  assert.deepEqual(lowHpSim.deathEvents, []);
});


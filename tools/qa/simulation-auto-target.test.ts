import assert from "node:assert/strict";
import test from "node:test";
import { NavigationGrid } from "../../src/engine/grid";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { calculateLegacyDamage, VERIFIED_NATIVE_ORDINARY_COEFFICIENTS, type LegacyDamageProfile } from "../../src/engine/legacy-balance";

const sourceDamage = { coefficients: VERIFIED_NATIVE_ORDINARY_COEFFICIENTS, callerFactor: 256, specialFlag: false };
const weapon = { damage: 100, rangeCells: 5, cooldownTicks: 2, sourceDamage };

test("automatic aim: skips class8 decoration and fires exact positive source damage", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(8, 3));
  const tower = simulation.addStaticTarget({ faction: "human", team: 0, cell: { x: 1, y: 1 }, maxHealth: 100, weapon });
  const decoration = simulation.addStaticTarget({ faction: "alien", team: 1, cell: { x: 2, y: 1 }, maxHealth: 100,
    sourceDefense: { targetClass: 8, armorFactor: 256, sourceTypeIndex: 84 } });
  const enemy = simulation.addUnit({ faction: "alien", team: 1, cell: { x: 3, y: 1 }, maxHealth: 100,
    sourceDefense: { targetClass: 0, armorFactor: 204 } });
  assert.equal(simulation.canAutoTarget(tower, decoration), false);
  assert.equal(simulation.canAutoTarget(tower, enemy), true);
  simulation.advance();
  assert.deepEqual(simulation.combatEvents, [{ type: "shot", tick: 0, attackerId: tower, targetId: enemy, damage: 19 }]);
  assert.equal(simulation.snapshot.staticTargets[1].health, 100);
  assert.equal(simulation.snapshot.staticTargets[0].targetId, enemy);
});

test("automatic aim: exact truncation includes matrix, caller, armor and special factors", () => {
  const cases: { damage: number; profile: LegacyDamageProfile; armor: number; expected: number }[] = [
    { damage: 3, profile: sourceDamage, armor: 256, expected: 0 },
    { damage: 4, profile: { ...sourceDamage, callerFactor: 255 }, armor: 256, expected: 0 },
    { damage: 4, profile: sourceDamage, armor: 204, expected: 0 },
    { damage: 4, profile: { ...sourceDamage, specialFlag: true }, armor: 256, expected: 0 },
    { damage: 0, profile: sourceDamage, armor: 256, expected: 0 },
    { damage: 100, profile: sourceDamage, armor: 0, expected: 0 },
    { damage: 8, profile: { ...sourceDamage, specialFlag: true }, armor: 256, expected: 1 },
  ];
  for (const entry of cases) {
    const simulation = new DeterministicSimulation(new NavigationGrid(4, 3));
    const tower = simulation.addStaticTarget({ faction: "human", cell: { x: 1, y: 1 }, maxHealth: 100,
      weapon: { ...weapon, damage: entry.damage, sourceDamage: entry.profile } });
    const defense = { targetClass: 0, armorFactor: entry.armor };
    const target = simulation.addUnit({ faction: "alien", cell: { x: 2, y: 1 }, sourceDefense: defense });
    assert.equal(calculateLegacyDamage(entry.damage, entry.profile, defense), entry.expected);
    const before = simulation.checkpoint();
    assert.equal(simulation.canAutoTarget(tower, target), entry.expected > 0);
    assert.deepEqual(simulation.checkpoint(), before, "eligibility must not mutate cooldown, orders or events");
    simulation.advance();
    assert.deepEqual(simulation.combatEvents.map(shot => shot.damage), entry.expected > 0 ? [entry.expected] : []);
    assert.equal(simulation.snapshot.staticTargets[0].attackCooldown, entry.expected > 0 ? weapon.cooldownTicks : 0);
    assert.equal(simulation.snapshot.staticTargets[0].targetId, entry.expected > 0 ? target : null);
  }
});

test("automatic aim: retained targets are rechecked against current defense and replay exactly", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(8, 3));
  const tower = simulation.addStaticTarget({ faction: "human", cell: { x: 1, y: 1 }, maxHealth: 100, weapon });
  const first = simulation.addStaticTarget({ faction: "alien", cell: { x: 2, y: 1 }, maxHealth: 100,
    sourceDefense: { targetClass: 0, armorFactor: 256 } });
  const second = simulation.addStaticTarget({ faction: "alien", cell: { x: 3, y: 1 }, maxHealth: 100,
    sourceDefense: { targetClass: 9, armorFactor: 256 } });
  simulation.advance();
  assert.equal(simulation.snapshot.staticTargets[0].targetId, first);
  simulation.updateStaticSourceDefense(first, { targetClass: 8, armorFactor: 256 });
  const restored = DeterministicSimulation.restore(JSON.parse(JSON.stringify(simulation.checkpoint())));
  for (let tick = 0; tick < 4; tick++) {
    simulation.advance();
    restored.advance();
    assert.deepEqual(restored.checkpoint(), simulation.checkpoint());
    assert.equal(simulation.snapshot.staticTargets[0].targetId, second);
    assert.ok(simulation.combatEvents.every(shot => shot.targetId === second && shot.damage === 4));
  }
  simulation.updateStaticSourceDefense(second, { targetClass: 8, armorFactor: 256 });
  simulation.advance();
  assert.equal(simulation.snapshot.staticTargets[0].targetId, null);
  assert.deepEqual(simulation.combatEvents, []);
  assert.equal(simulation.canAutoTarget(tower, second), false);
});

test("automatic aim: allied, neutral, dead, missing and unarmed actors remain ineligible", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(10, 3), { teamAlliances: [[1, 1, 0]] });
  const tower = simulation.addStaticTarget({ faction: "human", team: 0, cell: { x: 1, y: 1 }, maxHealth: 100, weapon });
  const ally = simulation.addUnit({ faction: "alien", team: 1, cell: { x: 2, y: 1 } });
  const neutral = simulation.addStaticTarget({ faction: "alien", team: 8, cell: { x: 3, y: 1 }, maxHealth: 100 });
  const enemy = simulation.addUnit({ faction: "human", team: 2, cell: { x: 4, y: 1 }, maxHealth: 25,
    sourceDefense: { targetClass: 0, armorFactor: 256 } });
  assert.equal(simulation.canAutoTarget(tower, tower), false);
  assert.equal(simulation.canAutoTarget(tower, ally), false);
  assert.equal(simulation.canAutoTarget(tower, neutral), false);
  assert.equal(simulation.canAutoTarget(ally, tower), false);
  assert.equal(simulation.canAutoTarget(tower, 999), false);
  assert.equal(simulation.canAutoTarget(999, enemy), false);
  assert.equal(simulation.canAutoTarget(tower, enemy), true);
  simulation.advance();
  assert.deepEqual(simulation.deathEvents.map(event => event.targetId), [enemy]);
  assert.equal(simulation.canAutoTarget(tower, enemy), false);
  simulation.advance();
  assert.deepEqual(simulation.combatEvents, []);
});

test("automatic aim: fallback damage stays compatible when source metadata is absent", () => {
  for (const sourceWeapon of [weapon, { damage: 100, rangeCells: 5, cooldownTicks: 2 }]) {
    const simulation = new DeterministicSimulation(new NavigationGrid(4, 3));
    const tower = simulation.addStaticTarget({ faction: "human", cell: { x: 1, y: 1 }, maxHealth: 100, weapon: sourceWeapon });
    const enemy = simulation.addUnit({ faction: "alien", cell: { x: 2, y: 1 }, maxHealth: 200,
      ...("sourceDamage" in sourceWeapon ? {} : { sourceDefense: { targetClass: 8, armorFactor: 256 } }) });
    assert.equal(simulation.canAutoTarget(tower, enemy), true);
    simulation.advance();
    assert.equal(simulation.combatEvents[0].damage, 100);
  }
});

test("automatic aim: air uses actual target class and statics retain sight and range gates", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(12, 3));
  const tower = simulation.addStaticTarget({ faction: "human", cell: { x: 1, y: 1 }, maxHealth: 100,
    weapon: { ...weapon, sourceDamage: { ...sourceDamage, coefficients: [256, 64, 0, 64, 128, 256, 25, 128, 0, 25] } },
    vision: { dayRangeCells: 3, nightRangeCells: 3 } });
  const air = simulation.addUnit({ faction: "alien", cell: { x: 2, y: 1 }, movementPlane: "air",
    sourceDefense: { targetClass: 2, armorFactor: 256 } });
  const hidden = simulation.addUnit({ faction: "alien", cell: { x: 5, y: 1 }, sourceDefense: { targetClass: 0, armorFactor: 256 } });
  assert.equal(simulation.canAutoTarget(tower, air), false);
  assert.equal(simulation.canAutoTarget(tower, hidden), true, "eligibility does not grant visibility");
  simulation.advance();
  assert.equal(simulation.combatEvents.length, 0);
  const antiAir = simulation.addStaticTarget({ faction: "human", cell: { x: 1, y: 0 }, maxHealth: 100, weapon });
  simulation.advance();
  assert.deepEqual(simulation.combatEvents.filter(shot => shot.attackerId === antiAir).map(shot => [shot.targetId, shot.damage]), [[air, 25]]);
  const distant = simulation.addStaticTarget({ faction: "human", cell: { x: 11, y: 1 }, maxHealth: 100,
    weapon, vision: { dayRangeCells: 20, nightRangeCells: 20 } });
  simulation.advance();
  assert.equal(simulation.combatEvents.some(shot => shot.attackerId === distant), false);
});

for (const movementPlane of ["ground", "air"] as const) {
  test(`automatic aim: ${movementPlane} mobile eligibility supports static pursuit without movement fire`, () => {
    const simulation = new DeterministicSimulation(new NavigationGrid(14, 3));
    const attacker = simulation.addUnit({ faction: "human", cell: { x: 0, y: 1 }, movementPlane,
      weapon: { ...weapon, rangeCells: 2 }, speedSubcellsPerTick: 512 });
    const decoration = simulation.addStaticTarget({ faction: "alien", cell: { x: 1, y: 0 }, maxHealth: 100,
      sourceDefense: { targetClass: 8, armorFactor: 256 } });
    const enemy = simulation.addStaticTarget({ faction: "alien", cell: { x: 10, y: 1 }, maxHealth: 1000,
      footprint: [{ x: 10, y: 1 }], sourceDefense: { targetClass: 9, armorFactor: 256 } });
    const target = [decoration, enemy].find(id => simulation.canAutoTarget(attacker, id));
    assert.equal(target, enemy);
    simulation.queue({ type: "attack", unitIds: [attacker], targetId: target! });
    let moves = 0, shots = 0;
    for (let tick = 0; tick < 30; tick++) {
      const before = simulation.snapshot.units[0];
      simulation.advance();
      const after = simulation.checkpoint().units[0];
      const moved = before.xSubcells !== after.xSubcells || before.ySubcells !== after.ySubcells;
      if (moved) moves++;
      for (const shot of simulation.combatEvents) {
        shots++;
        assert.equal(moved, false);
        assert.equal(shot.targetId, enemy);
        assert.equal(shot.damage, 4);
        assert.deepEqual(after.path, []);
        assert.equal(after.reservedDestination, null);
      }
    }
    assert.ok(moves > 0 && shots > 0);
  });
}

for (const targetKind of ["mobile", "static"] as const) {
  test(`automatic aim: explicit attack preserves intentional zero damage against ${targetKind} targets`, () => {
    const simulation = new DeterministicSimulation(new NavigationGrid(6, 3));
    const attacker = simulation.addUnit({ faction: "human", cell: { x: 1, y: 1 }, weapon });
    const options = { faction: "alien" as const, cell: { x: 2, y: 1 }, maxHealth: 100,
      sourceDefense: { targetClass: 8, armorFactor: 256 } };
    const target = targetKind === "mobile" ? simulation.addUnit(options) : simulation.addStaticTarget(options);
    simulation.addUnit({ faction: "alien", cell: { x: 3, y: 1 }, sourceDefense: { targetClass: 0, armorFactor: 256 } });
    assert.equal(simulation.canAutoTarget(attacker, target), false);
    simulation.queue({ type: "attack", unitIds: [attacker], targetId: target });
    for (let tick = 0; tick < 5; tick++) {
      simulation.advance();
      assert.equal(simulation.snapshot.units[0].targetId, target);
      assert.deepEqual(simulation.combatEvents.map(shot => [shot.targetId, shot.damage]), tick % 2 === 0 ? [[target, 0]] : []);
    }
  });
}

test("automatic aim: native profiles do not auto-acquire a zero-damage TOWR once the phase is known", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(6, 3), { sourceDayNightHeader: ["fixture", "0", "10", "4", "2"] });
  const attacker = simulation.addUnit({ faction: "human", team: 0, cell: { x: 1, y: 1 },
    weapon: { ...weapon, sourceDamage: { mode: "verified-native-ordinary", coefficients: VERIFIED_NATIVE_ORDINARY_COEFFICIENTS,
      sourceTypeIndex: 0, sourceTypeFaction: 0, weaponId: 1 } } });
  const towr = simulation.addStaticTarget({ faction: "alien", team: 1, cell: { x: 2, y: 1 }, maxHealth: 1,
    sourceDefense: { targetClass: 8, armorFactor: 256, sourceTypeIndex: 81 } });
  const building = simulation.addStaticTarget({ faction: "alien", team: 1, cell: { x: 3, y: 1 }, maxHealth: 800,
    sourceDefense: { targetClass: 9, armorFactor: 256, sourceTypeIndex: 16 } });
  assert.equal(simulation.canAutoTarget(attacker, towr), false, "class 8 takes zero, so it would pin the attacker forever");
  assert.equal(simulation.canAutoTarget(attacker, building), true);
});

test("automatic aim: native profiles retain existing diagnostic and zero-damage eligibility", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(6, 3));
  const attacker = simulation.addStaticTarget({ faction: "human", team: 0, cell: { x: 1, y: 1 }, maxHealth: 100,
    weapon: { ...weapon, sourceDamage: { mode: "verified-native-ordinary", coefficients: VERIFIED_NATIVE_ORDINARY_COEFFICIENTS,
      sourceTypeIndex: 0, sourceTypeFaction: 0, weaponId: 1 } } });
  const decoration = simulation.addStaticTarget({ faction: "alien", team: 1, cell: { x: 2, y: 1 }, maxHealth: 100,
    sourceDefense: { targetClass: 8, armorFactor: 256, sourceTypeIndex: 84 } });
  simulation.addUnit({ faction: "alien", team: 1, cell: { x: 3, y: 1 } });
  assert.equal(simulation.canAutoTarget(attacker, decoration), true);
  assert.deepEqual(simulation.sourceDamageDiagnostics, []);
  simulation.advance();
  assert.equal(simulation.snapshot.staticTargets[0].targetId, decoration);
  assert.deepEqual(simulation.combatEvents, []);
  assert.deepEqual(simulation.sourceDamageDiagnostics, [{ tick: 0, attackerId: attacker, targetId: decoration, reason: "missing-native-phase" }]);
});
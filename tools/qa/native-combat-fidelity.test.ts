import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  calculateLegacyDamage,
  defenseOptionsFromLegacy,
  parseLegacyDamageMatrix,
  unitOptionsFromLegacy,
} from "../../src/engine/legacy-balance";
import { NavigationGrid } from "../../src/engine/grid";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables";

const source = (name: string) => readFileSync(new URL(`../../raw_cd/DC/GAMESTAT/${name}.TXT`, import.meta.url), "ascii");
const units = parseUnitStats(source("GAMESTAT"));
const weapons = parseWeaponStats(source("WEAPSTAT"));
const matrix = parseLegacyDamageMatrix(source("MBULLET"));

test("native damage arithmetic matches the six executable audit probes", () => {
  for (const [coefficient, baseDamage, callerFactor, armorFactor, specialFlag, expected] of [
    [256, 100, 256, 256, false, 100],
    [256, 100, 256, 204, false, 79],
    [256, 100, 256, 170, false, 66],
    [217, 125, 129, 204, false, 41],
    [256, 100, 256, 204, true, 59],
    [1, 1, 256, 256, false, 0],
  ] as const) {
    assert.equal(calculateLegacyDamage(baseDamage, {
      coefficients: Array(10).fill(coefficient), callerFactor, specialFlag,
    }, { targetClass: 0, armorFactor }), expected);
  }
});

test("source matrix and armor use evidenced class indices and reciprocal factors", () => {
  assert.equal(matrix.length, 9);
  assert.ok(matrix.every((row) => row.length === 10));
  const soldier = units.find(({ sprite }) => sprite === "TRSC")!;
  const weapon = weapons.find(({ id }) => id === soldier.weapons[0])!;
  assert.equal(soldier.health, 800);
  assert.equal(matrix[weapon.rawPrefix][soldier.targetClass], 64);
  assert.deepEqual([0, 1, 2].map((level) => defenseOptionsFromLegacy(soldier, level).armorFactor), [256, 204, 170]);
  assert.equal(calculateLegacyDamage(100, {
    coefficients: matrix[weapon.rawPrefix], callerFactor: 256, specialFlag: false,
  }, defenseOptionsFromLegacy(soldier, 1)), 19);
});

test("unsupported matrix shapes, defense inputs and overflowing arithmetic fail closed", () => {
  assert.throws(() => parseLegacyDamageMatrix("10\n9\n25"), /MBULLET/);
  assert.throws(() => parseLegacyDamageMatrix(source("MBULLET").replace(/\b25\b/, "-1")), /percentage/);
  assert.throws(() => defenseOptionsFromLegacy({}, 0), /requires/);
  assert.throws(() => defenseOptionsFromLegacy(units[0], 3), /armor level/);
  assert.throws(() => defenseOptionsFromLegacy({ targetClass: 10, armorUpgradePercentages: [125, 150] }, 0), /target class/);
  assert.throws(() => defenseOptionsFromLegacy({ targetClass: 0, armorUpgradePercentages: [0, 150] }, 0), /positive/);
  assert.throws(() => calculateLegacyDamage(0x7fffffff, {
    coefficients: matrix[0], callerFactor: 256, specialFlag: false,
  }, { targetClass: 0, armorFactor: 256 }), /intermediate product/);
});

const combatOptions = { matrix, armorLevel: 1, callerFactor: 256, specialFlag: false };

test("source adapter selects explicit weapon IDs, requires named fields, and remains opt-in", () => {
  const soldier = units.find(({ sprite }) => sprite === "TRSC")!;
  const generic = unitOptionsFromLegacy(soldier, weapons);
  assert.equal(Object.hasOwn(generic, "sourceDefense"), false);
  assert.equal(Object.hasOwn(generic.weapon!, "sourceDamage"), false);
  for (const level of [0, 1, 2]) {
    const adapted = unitOptionsFromLegacy(soldier, [...weapons].reverse(), level, combatOptions);
    const weapon = weapons.find(({ id }) => id === soldier.weapons[level])!;
    assert.equal(adapted.weapon!.damage, weapon.damage);
    assert.deepEqual(adapted.weapon!.sourceDamage!.coefficients, matrix[weapon.rawPrefix]);
    assert.deepEqual(adapted.sourceDefense, { targetClass: soldier.targetClass, armorFactor: 204 });
  }
  assert.throws(() => unitOptionsFromLegacy({ ...soldier, targetClass: undefined }, weapons, 0, combatOptions), /requires/);
  assert.throws(() => unitOptionsFromLegacy(soldier, weapons.map((weapon) => ({ ...weapon, rawPrefix: undefined })), 0, combatOptions), /weapon class/);
  const unarmed = unitOptionsFromLegacy({ ...soldier, weapons: [-1, -1, -1] }, [], 0, combatOptions);
  assert.equal(unarmed.weapon, undefined);
  assert.equal(unarmed.sourceDefense!.armorFactor, 204);
});

for (const staticTarget of [false, true]) {
  test(`opt-in class and armor affect ${staticTarget ? "static" : "mobile"} health and shot events`, () => {
    const simulation = new DeterministicSimulation(new NavigationGrid(8, 2));
    const soldier = units.find(({ sprite }) => sprite === "TRSC")!;
    const options = unitOptionsFromLegacy(soldier, weapons, 0, combatOptions);
    const attacker = simulation.addUnit({ ...options, team: 0, cell: { x: 0, y: 0 } });
    const targetOptions = {
      faction: "human" as const, team: 1, cell: { x: 1, y: 0 }, maxHealth: 800,
      sourceDefense: defenseOptionsFromLegacy(soldier, 1),
    };
    const targetId = staticTarget ? simulation.addStaticTarget(targetOptions) : simulation.addUnit(targetOptions);
    simulation.queue({ type: "attack", unitIds: [attacker], targetId });
    simulation.advance();
    assert.equal(simulation.combatEvents[0].damage, 19);
    const target = [...simulation.snapshot.units, ...simulation.snapshot.staticTargets].find(({ id }) => id === targetId)!;
    assert.equal(target.health, 781);
    assert.deepEqual(simulation.deathEvents, []);
  });
}

test("generic and mixed-profile combat retain flat damage", () => {
  for (const sourceAttacker of [false, true]) {
    for (const sourceTarget of [false, true]) {
      const simulation = new DeterministicSimulation(new NavigationGrid(4, 1));
      const attacker = simulation.addUnit({ faction: "human", cell: { x: 0, y: 0 }, weapon: {
        damage: 100, rangeCells: 4, cooldownTicks: 1,
        ...(sourceAttacker ? { sourceDamage: { coefficients: matrix[0], callerFactor: 256, specialFlag: false } } : {}),
      } });
      const targetId = simulation.addStaticTarget({ faction: "alien", cell: { x: 1, y: 0 }, maxHealth: 800,
        ...(sourceTarget ? { sourceDefense: { targetClass: 0, armorFactor: 204 } } : {}),
      });
      simulation.queue({ type: "attack", unitIds: [attacker], targetId });
      simulation.advance();
      const expected = sourceAttacker && sourceTarget ? 19 : 100;
      assert.equal(simulation.combatEvents[0].damage, expected);
      assert.equal(simulation.snapshot.staticTargets[0].health, 800 - expected);
    }
  }
});

test("zero source damage still fires on schedule without a minimum-one clamp", () => {
  for (const baseDamage of [0, 1]) {
    const simulation = new DeterministicSimulation(new NavigationGrid(4, 1));
    const attacker = simulation.addUnit({ faction: "human", cell: { x: 0, y: 0 }, weapon: {
      damage: baseDamage, rangeCells: 4, cooldownTicks: 2,
      sourceDamage: { coefficients: Array(10).fill(1), callerFactor: 256, specialFlag: false },
    } });
    const targetId = simulation.addStaticTarget({ faction: "alien", cell: { x: 1, y: 0 }, maxHealth: 1,
      sourceDefense: { targetClass: 0, armorFactor: 256 },
    });
    simulation.queue({ type: "attack", unitIds: [attacker], targetId });
    for (const expectedShots of [1, 0, 1]) {
      simulation.advance();
      assert.equal(simulation.combatEvents.length, expectedShots);
      assert.ok(simulation.combatEvents.every(({ damage }) => damage === 0));
      assert.equal(simulation.snapshot.staticTargets[0].health, 1);
      assert.deepEqual(simulation.deathEvents, []);
    }
  }
});

test("source profiles are validated and detached at registration", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(4, 1));
  const sourceDamage = { coefficients: Array(10).fill(256), callerFactor: 256, specialFlag: false };
  const sourceDefense = { targetClass: 0, armorFactor: 204 };
  const weapon = { damage: 100, rangeCells: 4, cooldownTicks: 1, sourceDamage };
  assert.throws(() => simulation.addUnit({ faction: "human", cell: { x: 0, y: 0 },
    weapon: { ...weapon, sourceDamage: { ...sourceDamage, coefficients: [256] } },
  }), /10 coefficients/);
  assert.throws(() => simulation.addStaticTarget({ faction: "alien", cell: { x: 1, y: 0 }, maxHealth: 100,
    sourceDefense: { targetClass: -1, armorFactor: 256 },
  }), /target class/);
  assert.equal(simulation.snapshot.entityCount, 0);
  const attacker = simulation.addUnit({ faction: "human", cell: { x: 0, y: 0 }, weapon });
  const targetId = simulation.addStaticTarget({ faction: "alien", cell: { x: 1, y: 0 }, maxHealth: 100, sourceDefense });
  sourceDamage.coefficients.fill(0);
  sourceDamage.callerFactor = 0;
  sourceDefense.armorFactor = 0;
  weapon.damage = 1;
  simulation.queue({ type: "attack", unitIds: [attacker], targetId });
  simulation.advance();
  assert.equal(simulation.combatEvents[0].damage, 79);
  assert.equal(simulation.snapshot.staticTargets[0].health, 21);
});

test("source damage indexes the target class and preserves explicit caller inputs", () => {
  const coefficients = [0, 64, 256, 512, 128, 128, 128, 128, 128, 128];
  const profile = { coefficients, callerFactor: 128, specialFlag: true };
  assert.equal(calculateLegacyDamage(100, profile, { targetClass: 0, armorFactor: 256 }), 0);
  assert.equal(calculateLegacyDamage(100, profile, { targetClass: 1, armorFactor: 256 }), 9);
  assert.equal(calculateLegacyDamage(100, profile, { targetClass: 2, armorFactor: 256 }), 37);
  assert.equal(calculateLegacyDamage(100, profile, { targetClass: 3, armorFactor: 256 }), 75);
  for (const callerFactor of [-1, 1.5, NaN, Infinity]) {
    assert.throws(() => calculateLegacyDamage(100, { ...profile, callerFactor }, { targetClass: 0, armorFactor: 256 }), /caller factor/);
  }
  assert.throws(() => calculateLegacyDamage(100, { ...profile, callerFactor: 0x7fffffff },
    { targetClass: 1, armorFactor: 256 }), /intermediate product/);
});

test("source profiles do not bypass same-team or directed alliance checks", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(4, 1), { teamAlliances: [[0, 1]] });
  const weapon = { damage: 100, rangeCells: 4, cooldownTicks: 1,
    sourceDamage: { coefficients: matrix[0], callerFactor: 256, specialFlag: false } };
  const sourceDefense = { targetClass: 0, armorFactor: 256 };
  const attacker = simulation.addUnit({ faction: "human", team: 0, cell: { x: 0, y: 0 }, weapon, sourceDefense });
  const ally = simulation.addUnit({ faction: "alien", team: 1, cell: { x: 1, y: 0 }, weapon, sourceDefense });
  const ownTeam = simulation.addStaticTarget({ faction: "alien", team: 0, cell: { x: 2, y: 0 }, maxHealth: 100, sourceDefense });
  for (const targetId of [ally, ownTeam]) {
    simulation.queue({ type: "attack", unitIds: [attacker], targetId });
    simulation.advance();
    assert.deepEqual(simulation.combatEvents, []);
  }
  simulation.queue({ type: "attack", unitIds: [ally], targetId: attacker });
  simulation.advance();
  assert.equal(simulation.combatEvents[0].damage, 25);
  assert.equal(simulation.snapshot.units[0].health, 75);
});

test("source damage accumulates simultaneously with deterministic death and footprint release", () => {
  const run = () => {
    const simulation = new DeterministicSimulation(new NavigationGrid(4, 2));
    const attackers = [0, 1].map((row) => simulation.addUnit({
      faction: "human", team: 0, cell: { x: 0, y: row }, weapon: {
        damage: 100, rangeCells: 4, cooldownTicks: 1,
        sourceDamage: { coefficients: matrix[0], callerFactor: 256, specialFlag: false },
      },
    }));
    const cell = { x: 2, y: 0 };
    const previousCost = simulation.grid.costs[2];
    const targetId = simulation.addStaticTarget({ faction: "human", team: 1, cell, maxHealth: 38,
      footprint: [cell], sourceDefense: { targetClass: 0, armorFactor: 204 },
    });
    simulation.queue({ type: "attack", unitIds: attackers, targetId });
    simulation.advance();
    assert.deepEqual(simulation.combatEvents.map(({ damage }) => damage), [19, 19]);
    assert.deepEqual(simulation.deathEvents, [{ type: "death", tick: 0, targetId }]);
    assert.equal(simulation.snapshot.staticTargets[0].health, 0);
    assert.equal(simulation.grid.costs[2], previousCost);
    const result = { snapshot: simulation.snapshot, shots: simulation.combatEvents, deaths: simulation.deathEvents };
    simulation.advance();
    assert.deepEqual(simulation.combatEvents, []);
    assert.deepEqual(simulation.deathEvents, []);
    return result;
  };
  assert.deepEqual(run(), run());
});
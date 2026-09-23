import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHash } from "node:crypto";
import { parseLegacyDamageMatrix, VERIFIED_NATIVE_MBULLET_SHA256 } from "../../../src/engine/legacy-balance";

import { LegacyTableError, parseDamageMatrix, parseDependencies, parseUnitStats, parseWeaponStats } from "./tables";

test("MBULLET preserves native percentages and uses the verified Q8 parser", () => {
  const source = readFileSync(new URL("../../../raw_cd/DC/GAMESTAT/MBULLET.TXT", import.meta.url));
  assert.equal(createHash("sha256").update(source).digest("hex"), VERIFIED_NATIVE_MBULLET_SHA256);
  const matrix = parseDamageMatrix(source.toString("ascii"));
  assert.equal(matrix.percentages.length, 9);
  assert.ok(matrix.percentages.every((row) => row.length === 10));
  assert.deepEqual(matrix.coefficients, parseLegacyDamageMatrix(source.toString("ascii")));
  for (const [rowIndex, row] of matrix.percentages.entries()) {
    for (const [columnIndex, percentage] of row.entries()) {
      assert.equal(matrix.coefficients[rowIndex][columnIndex], Math.trunc(percentage * 0.01 * 256));
    }
  }
  assert.deepEqual(matrix.coefficients[0], [64, 30, 64, 46, 64, 230, 12, 128, 0, 12]);
});

test("MBULLET rejects malformed dimensions, percentages and overflowing Q8 coefficients", () => {
  const rows = Array.from({ length: 9 }, () => Array(10).fill("100").join(" "));
  const source = `10\n9\n${rows.join("\n")}\n`;
  assert.deepEqual(parseDamageMatrix(source).coefficients, Array.from({ length: 9 }, () => Array(10).fill(256)));
  for (const invalid of [source.replace("10\n9", "9\n9"), source.replace("10\n9", "10\n8"),
    `10\n9\n${rows.slice(1).join("\n")}`, source.replace("100 100", "100"),
    ...["-1", "1.5", "NaN", "12800"].map((token) => source.replace("100", token))]) {
    assert.throws(() => parseDamageMatrix(invalid), RangeError);
  }
});

test("parses source-labeled unit and weapon columns while preserving tails", () => {
  const unit = parseUnitStats(`1\nTRSC 0 10 25 7 4 1 2 3 125 150 0 800 0 31 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 8 0\n`)[0];
  assert.deepEqual(
    {
      sprite: unit.sprite,
      faction: unit.faction,
      speed: unit.movementSpeed,
      day: unit.observationDay,
      night: unit.observationNight,
      weapons: unit.weapons,
      armor: unit.armorUpgradePercentages,
      targetClass: unit.targetClass,
      health: unit.health,
      tail: unit.rawTail.length,
    },
    {
      sprite: "TRSC",
      faction: 0,
      speed: 25,
      day: 7,
      night: 4,
      weapons: [1, 2, 3],
      armor: [125, 150],
      targetClass: 0,
      health: 800,
      tail: 22,
    },
  );
  const weapon = parseWeaponStats("1\n1 weapons 0 1 15 100 60 4 0 -1 -1 0 0\n")[0];
  assert.deepEqual(
    { id: weapon.id, rate: weapon.rateOfFire, damage: weapon.damage, range: weapon.range },
    { id: 1, rate: 15, damage: 100, range: 4 },
  );
});

test("source HP and short troop dependency rows match native loader destinations", () => {
  const units = parseUnitStats(readFileSync(new URL("../../../raw_cd/DC/GAMESTAT/GAMESTAT.TXT", import.meta.url), "ascii"));
  assert.deepEqual([units[0].health, units[8].health, units[16].health], [800, 800, 4800]);
  const dependencies = parseDependencies(readFileSync(new URL("../../../raw_cd/DC/GAMESTAT/DEPEND.TXT", import.meta.url), "ascii"));
  for (const [id, expected] of [[7, [0]], [9, [1]], [83, [4, 3, 6]], [84, [18, 15, 20]]] as const) {
    const record = dependencies.find((entry) => entry.id === id)!;
    assert.equal(record.rawFields.length, 2);
    assert.deepEqual(record.dependencies, expected);
  }
  assert.equal(dependencies.filter((entry) => entry.rawFields[0] === 1).length, 18);
  assert.throws(() => parseDependencies("1\n7 1500 87 1 6 -1 0 -1\n"), LegacyTableError);
});

test("parses dependency costs and terminated prerequisite lists", () => {
  assert.deepEqual(parseDependencies("1\n3 2000 82 0 2 0 0 2 1 -1\n"), [
    {
      id: 3,
      cost: 2000,
      interfaceId: 82,
      rawFields: [0, 2, 0, 0],
      dependencies: [2, 1],
    },
  ]);
  assert.throws(() => parseDependencies("1\n3 2000 82 0 2 0 0\n"), LegacyTableError);
});

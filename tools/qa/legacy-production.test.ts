import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createLegacyProductionCatalog, checkLegacyProductionRequirements } from "../../src/engine/legacy-production";

const source = readFileSync(new URL("../../raw_cd/DC/GAMESTAT/DEPEND.TXT", import.meta.url), "ascii");
const rows = source.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("%"));
const records = rows.slice(1).map((line) => {
  const values = line.split(/\s+/).map(Number);
  const start = values[3] === 1 ? 5 : 7;
  assert.equal(values.at(-1), -1);
  return { id: values[0], cost: values[1], interfaceId: values[2], rawFields: values.slice(3, start), dependencies: values.slice(start, -1) };
});

test("native DEPEND grammar preserves all 80 records and short troop prerequisites", () => {
  assert.equal(Number(rows[0]), records.length);
  const catalog = createLegacyProductionCatalog(records);
  assert.equal(catalog.size, 80);
  assert.equal([...catalog.values()].filter((entry) => entry.kind === "building").length, 14);
  assert.equal([...catalog.values()].filter((entry) => entry.kind === "unit").length, 18);
  assert.equal([...catalog.values()].filter((entry) => entry.kind === "upgrade").length, 48);
  assert.deepEqual(catalog.get(7)?.dependencies, [0]);
  assert.deepEqual(catalog.get(9)?.dependencies, [1]);
  assert.deepEqual(catalog.get(83)?.dependencies, [4, 3, 6]);
  assert.deepEqual(catalog.get(84)?.dependencies, [18, 15, 20]);
  assert.equal(catalog.get(9)?.unitType, 0);
  assert.equal(catalog.get(9)?.cost, 350);
  assert.equal(catalog.get(83)?.unitType, 49);
  assert.equal(catalog.get(0)?.unitType, null);
  assert.ok([...catalog.values()].every((entry) => entry.buildTimeTicks === null));
});

test("rejects old fixed-width parser records instead of permitting missing prerequisites", () => {
  assert.throws(() => createLegacyProductionCatalog([
    { id: 7, cost: 1500, interfaceId: 87, rawFields: [1, 6, 0, -1], dependencies: [] },
  ]), /reparse DEPEND/);
  assert.throws(() => createLegacyProductionCatalog([
    { id: 83, cost: 900, interfaceId: 135, rawFields: [1, 49, 4, 3], dependencies: [6] },
  ]), /reparse DEPEND/);
});

test("checks every supplied prerequisite and exact cost without mutating resources", () => {
  const catalog = createLegacyProductionCatalog(records);
  const satisfied = new Set([4, 6]);
  assert.deepEqual(checkLegacyProductionRequirements(catalog, 83, 899, satisfied), {
    status: "blocked", missingDependencies: [3], creditShortfall: 1,
  });
  satisfied.add(3);
  assert.deepEqual(checkLegacyProductionRequirements(catalog, 83, 900, satisfied), {
    status: "satisfied", missingDependencies: [], creditShortfall: 0,
  });
  assert.equal(satisfied.size, 3);
  assert.equal(checkLegacyProductionRequirements(catalog, 9, 350, new Set()).status, "blocked");
});

test("unknown IDs and kinds stay unknown; raw metadata is copied without inventing mappings", () => {
  const rawFields = [99, 123, -1];
  const catalog = createLegacyProductionCatalog([{ id: 100, cost: 10, interfaceId: 2, rawFields, dependencies: [] }]);
  rawFields[1] = 0;
  assert.deepEqual(catalog.get(100)?.rawFields, [99, 123, -1]);
  assert.equal(catalog.get(100)?.unitType, null);
  assert.equal(checkLegacyProductionRequirements(catalog, 100, 10, new Set()).status, "unknown");
  assert.equal(checkLegacyProductionRequirements(catalog, 101, 10, new Set()).status, "unknown");
});

test("rejects malformed catalog identities, references, metadata and credits", () => {
  assert.throws(() => createLegacyProductionCatalog([records[0], records[0]]), /duplicate/);
  assert.throws(() => createLegacyProductionCatalog([records.find((record) => record.id === 9)!]), /missing/);
  for (const cost of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createLegacyProductionCatalog([{ ...records[0], cost }]), RangeError);
    assert.throws(() => checkLegacyProductionRequirements(new Map(), 0, cost, new Set()), RangeError);
  }
  assert.throws(() => createLegacyProductionCatalog([{ ...records[0], rawFields: [] }]), RangeError);
});
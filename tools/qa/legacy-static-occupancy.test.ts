import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  findLegacyStaticRemoval, markLegacyResourceTile, projectLegacyStaticOccupancy,
  registerLegacyOccupancyCell, type LegacyOccupancyPlane,
} from "../../src/engine/legacy-static-occupancy.ts";

const input = { slot: 152, owner: 0, tileX: 0, tileY: 0, width: 96, height: 84,
  movementClassByte: 0, auxiliaryField: 0 };

test("native plane priority, owner-8 exception, bounds and preserved flags", () => {
  assert.deepEqual(projectLegacyStaticOccupancy(input), { plane: "ground", x: 0, y: 0 });
  assert.equal(projectLegacyStaticOccupancy({ ...input, owner: 8 }), null);
  assert.equal(projectLegacyStaticOccupancy({ ...input, owner: 9 })?.plane, "ground");
  assert.equal(projectLegacyStaticOccupancy({ ...input, movementClassByte: 7 })?.plane, "air");
  assert.equal(projectLegacyStaticOccupancy({ ...input, movementClassByte: 7, auxiliaryField: -1 })?.plane, "auxiliary");
  assert.equal(registerLegacyOccupancyCell(0xf234abff, 152, "ground"), 0xf234a898);
  assert.equal(registerLegacyOccupancyCell(0xa7fe, 799, "auxiliary"), 0xa71f);
  assert.equal(markLegacyResourceTile(0x80001234), 0x84001234);
  for (const invalid of [{ slot: 119 }, { slot: 800 }, { tileX: 96 }, { tileY: -1 },
    { width: 256 }, { movementClassByte: 256 }, { owner: 10 }]) {
    assert.throws(() => projectLegacyStaticOccupancy({ ...input, ...invalid }), RangeError);
  }
});

test("removal is first match in clipped X/Y/plane order, not a rectangle clear", () => {
  const visits: string[] = [];
  const result = findLegacyStaticRemoval({ slot: 152, xQ8: 128, yQ8: 128, width: 2, height: 2 },
    (plane, cellX, cellY) => {
      visits.push(`${cellX},${cellY}:${plane}`);
      return plane === "auxiliary" ? 0xa498 : 0x3ff;
    });
  assert.deepEqual(visits, ["0,0:ground", "0,0:air", "0,0:auxiliary"]);
  assert.deepEqual(result, { plane: "auxiliary", x: 0, y: 0, before: 0xa498, after: 0xa7ff });
  assert.throws(() => findLegacyStaticRemoval({ slot: 152, xQ8: 128, yQ8: 128, width: 2, height: 2 },
    () => 0x3fe), /no matching slot/);
});

interface NativeCell { plane: LegacyOccupancyPlane | "map"; x: number; y: number; before: number; after: number }
interface NativeCase {
  type: number | null; owner: number; x: number; y: number; slot?: number;
  row?: number[]; cells: NativeCell[];
  removal?: { cells: NativeCell[]; outcome: string };
}
interface NativeReport {
  sources: { path: string; sha256: string }[];
  actions?: { raw: string; nativePayload?: { groups: number[][]; unconsumed: string } }[];
  types: { type: number; flyByte: number; auxiliary: number }[];
  scenarios: { name: string }[];
  constructorCases?: NativeCase[];
  reinforcementCases?: (NativeCase & { width: number; height: number })[];
  nativeScenarios?: { name: string; width: number; height: number; records: NativeCase[] }[];
}

test("source-hashed native constructor and SCN plane traces", {
  skip: !process.env.DC_STATIC_NATIVE_TRACE,
}, () => {
  const report: NativeReport = JSON.parse(readFileSync(process.env.DC_STATIC_NATIVE_TRACE!, "utf8"));
  const expressions = report.actions?.filter(action => action.raw.includes("63+r%5")) ?? [];
  assert.equal(expressions.length, 4);
  for (const expression of expressions) {
    assert.deepEqual(expression.nativePayload?.groups, [[63, 0], [0, 0], [0, 0], [0, 0], [0, 0]]);
    assert.ok(expression.nativePayload?.unconsumed.startsWith("+r%5"));
  }
  for (const source of report.sources) {
    const bytes = readFileSync(new URL(`../../${source.path}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256, source.path);
  }
  let checked = 0;
  const compare = (record: NativeCase, width: number, height: number) => {
    if (record.type === null) {
      assert.deepEqual(record.cells, []);
      return;
    }
    const definition = report.types[record.type];
    const tileX = record.row?.[0] ?? record.x;
    const tileY = record.row?.[1] ?? record.y;
    const slot = record.slot ?? 152;
    const projected = projectLegacyStaticOccupancy({ slot, owner: record.owner, tileX, tileY,
      width, height, movementClassByte: definition.flyByte, auxiliaryField: definition.auxiliary });
    const occupancy = record.cells.filter(cell => cell.plane !== "map");
    assert.deepEqual(occupancy.map(({ plane, x, y }) => ({ plane, x, y })), projected ? [projected] : []);
    for (const cell of record.cells) {
      assert.equal(cell.after, cell.plane === "map" ? markLegacyResourceTile(cell.before)
        : registerLegacyOccupancyCell(cell.before, slot, cell.plane));
    }
    if (record.removal) {
      const remove = () => findLegacyStaticRemoval({ slot, xQ8: tileX * 256 + 128,
        yQ8: tileY * 256 + 128, width, height }, (plane, x, y) =>
        occupancy.find(cell => cell.plane === plane && cell.x === x && cell.y === y)?.after ?? 1023);
      if (record.removal.outcome === "removed") assert.deepEqual(remove(), record.removal.cells[0]);
      else assert.throws(remove, /no matching slot/);
    }
    checked += 1;
  };
  if (report.constructorCases) {
    const map = readFileSync(new URL(`../../raw_cd/DC/SCENARIO/${report.scenarios[0].name.replace(/\.SCN$/, ".MAP")}`, import.meta.url));
    for (const record of report.constructorCases) compare(record, map.readUInt32LE(0), map.readUInt32LE(4));
    assert.equal(report.constructorCases.length, 138);
  }
  if (report.nativeScenarios) {
    assert.equal(report.nativeScenarios.length, 108);
    for (const scenario of report.nativeScenarios) {
      for (const record of scenario.records) compare(record, scenario.width, scenario.height);
    }
  }
  for (const record of report.reinforcementCases ?? []) compare(record, record.width, record.height);
  assert.ok(checked >= 138);
});
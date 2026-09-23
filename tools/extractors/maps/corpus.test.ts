import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const source = fileURLToPath(new URL("../../../raw_cd/DC/SCENARIO/", import.meta.url));

test("all 108 source MAPs obey the two-reference plane equation and legacy lookup", {
  skip: !existsSync(source),
}, () => {
  const result = spawnSync(process.execPath, [
    "--import", "tsx", fileURLToPath(new URL("./audit.ts", import.meta.url)), source,
  ], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  const records = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(records.at(-1), {
    maps: 108,
    totals: [
      { count: 1345872, zero: 0, hit: 1344489, max: 5791 },
      { count: 1345872, zero: 1230788, hit: 115038, max: 5765 },
      { count: 1345872, zero: 3, hit: 88224, max: 24106 },
    ],
  });
  const missingCombinations = new Set<string>();
  let backgroundMissing = 0;
  let foregroundMissing = 0;
  for (const record of records.filter((entry) => entry.map)) {
    for (const missing of record.missingKeys) {
      missingCombinations.add(`${record.bankName.toUpperCase()}:${missing.key}`);
      backgroundMissing += missing.backgroundCount;
      foregroundMissing += missing.foregroundCount;
    }
  }
  assert.equal(missingCombinations.size, 44);
  assert.equal(backgroundMissing, 1383);
  assert.equal(foregroundMissing, 46);
  assert.deepEqual(records.find((record) => record.map === "HUMAN/HUMAN01.MAP").missingKeys, [
    { key: 4092, backgroundCount: 2, foregroundCount: 0 },
    { key: 4132, backgroundCount: 2, foregroundCount: 0 },
  ]);
  assert.deepEqual(records.find((record) => record.map === "ALIEN/ALIEN01.MAP").missingKeys, []);
});
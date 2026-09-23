import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { projectLegacyColony } from "../../src/engine/legacy-colony.ts";
import { sourceScenarioUpgradeLevels, validateScenarioCityRow } from "../../src/engine/legacy-scenario-levels.ts";
import { parseScenario } from "../extractors/data/scenario.ts";
import { parseUnitStats } from "../extractors/data/tables.ts";

const root = new URL("../../", import.meta.url);
const digest = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const read = (path: string) => readFileSync(new URL(path, root));
const mappings = [[0, 2, 3, 6, 43, 5, 1, 4], [8, 10, 11, 14, 44, 13, 9, 12]];
const units = parseUnitStats(read("raw_cd/DC/GAMESTAT/GAMESTAT.TXT").toString());
const syntheticUnits = units.map((unit) => ({ ...unit, health: 10000 + unit.index }));
const sourceRoot = "raw_cd/DC/SCENARIO/";
const paths = readdirSync(new URL(sourceRoot, root), { recursive: true })
  .map(String).filter((path) => path.endsWith(".SCN")).sort().map((path) => sourceRoot + path);

interface NativeTeam {
  team: number;
  race: number;
  base: number[];
  city: number[];
  scanned: number[];
  unconsumedCity: string;
  lineReads: number;
  unitRows: number[][];
  scannedUnitRows: number[][];
  levelBytesSha256: string;
  health: number[];
  upgradeLevels: number[];
}

test("all 108 unchanged SCNs preserve City and eight following unit rows across all four banks", () => {
  assert.equal(paths.length, 108);
  const manifest = paths.map((path) => ({ path, sha256: digest(read(path)) }));
  assert.equal(digest(JSON.stringify(manifest)), "b9bad691618169a72b3f43a75cb77be8776b95881d1addcfcbf7b97b9fe86c88");
  const banks: Record<string, number> = {};
  const widths: Record<string, number> = {};
  for (const path of paths) {
    const text = read(path).toString();
    const scenario = parseScenario(text);
    const before = structuredClone(scenario);
    const lines = text.split(/\r?\n/).map((line) => line.trim());
    const markers = lines.flatMap((line, index) => line === "%City" ? [index] : []);
    assert.equal(markers.length, 8, path);
    banks[scenario.terrainBank] = (banks[scenario.terrainBank] ?? 0) + 1;
    for (const team of scenario.teams) {
      const rows = lines.slice(markers[team.index] + 1, markers[team.index] + 10)
        .map((line) => line.split(/\s+/).map(Number));
      assert.deepEqual(team.cityRows, rows, `${path} team ${team.index}`);
      widths[rows[0].length] = (widths[rows[0].length] ?? 0) + 1;
      for (let typeIndex = 0; typeIndex < 106; typeIndex += 1) {
        const rowIndex = mappings[team.race].indexOf(typeIndex);
        assert.deepEqual(sourceScenarioUpgradeLevels(team, typeIndex), {
          team: team.index, sourceTypeIndex: typeIndex,
          weaponLevel: rowIndex < 0 ? 0 : rows[rowIndex + 1][2],
          armorLevel: rowIndex < 0 ? 0 : rows[rowIndex + 1][3],
          origin: rowIndex < 0 ? "type-initialization" : "scenario-unit-row",
        });
      }
    }
    projectLegacyColony(scenario.teams, units);
    assert.deepEqual(scenario, before);
  }
  assert.deepEqual(banks, { "desert.bts": 45, "jungle.bts": 42, "htrain.bts": 15, "atlantis.bts": 6 });
  assert.deepEqual(widths, { "10": 776, "12": 88 });
});

test("native scanners consume ten City fields and eight fresh unit lines for the entire corpus", () => {
  const report = JSON.parse(process.env.DC_SCENARIO_CITY_NATIVE_TRACE
    ? readFileSync(process.env.DC_SCENARIO_CITY_NATIVE_TRACE, "utf8")
    : execFileSync("python3", [new URL("tools/research/scenario-city-layout.py", root).pathname], {
      encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, PYTHONPATH: process.env.DC_COLONY_PYTHONPATH
        ?? "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
    })) as {
      executableSha256: string;
      mapping: number[][];
      scenarios: { path: string; sha256: string; bank: string; teams: NativeTeam[] }[];
      synthetic: NativeTeam[];
    };
  assert.equal(report.executableSha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  assert.equal(digest(read("raw_cd/DC/DC.EXE")), report.executableSha256);
  assert.deepEqual(report.mapping, mappings);
  assert.deepEqual(report.scenarios.map(({ path }) => path), paths);
  const compare = (native: NativeTeam) => {
    const team = { index: native.team, race: native.race, coordinateRows: [[0, 0], native.base] as const,
      cityRows: [native.city, ...native.unitRows] };
    assert.deepEqual(native.scanned, native.city.slice(0, 10));
    assert.deepEqual(native.unconsumedCity.split(/\s+/).filter(Boolean).map(Number), native.city.slice(10));
    assert.equal(native.lineReads, 9);
    assert.deepEqual(native.scannedUnitRows, native.unitRows);
    const projected = projectLegacyColony([team], syntheticUnits);
    assert.deepEqual(projected.slots.map(({ health }) => health), native.health);
    assert.deepEqual(projected.slots.map(({ upgradeLevel }) => upgradeLevel), native.upgradeLevels);
    assert.equal(projected.slots[5].sourceLevel, null);
    const levelBytes = Buffer.alloc(106 * 16);
    for (let typeIndex = 0; typeIndex < 106; typeIndex += 1) {
      const levels = sourceScenarioUpgradeLevels(team, typeIndex);
      levelBytes[typeIndex * 16 + team.index] = levels.weaponLevel;
      levelBytes[typeIndex * 16 + team.index + 8] = levels.armorLevel;
    }
    assert.equal(digest(levelBytes), native.levelBytesSha256);
  };
  for (const source of report.scenarios) {
    assert.equal(digest(read(source.path)), source.sha256);
    const parsed = parseScenario(read(source.path).toString());
    assert.equal(source.bank, parsed.terrainBank);
    assert.equal(source.teams.length, 8);
    for (const [index, native] of source.teams.entries()) {
      const team = parsed.teams[index];
      assert.equal(native.team, team.index);
      assert.equal(native.race, team.race);
      assert.deepEqual(native.base, team.coordinateRows[1]);
      assert.deepEqual([native.city, ...native.unitRows], team.cityRows);
      compare(native);
    }
  }
  assert.equal(report.synthetic.length, 2);
  for (const native of report.synthetic) {
    assert.deepEqual(native.city.slice(10), [0x7fffffff, -0x80000000]);
    assert.deepEqual(native.health, [10016, 123, 0, 10021, 0, 1]);
    assert.deepEqual(native.upgradeLevels, [0, 1, 0, 1, 0, 0]);
    compare(native);
  }
});

test("sixth City pair neither configures TOWR nor shifts asymmetric unit upgrades", () => {
  for (const race of [0, 1]) {
    const city = [1, -1, 2, 123, 0, 999, 2, -1, 1, 0];
    const team = { index: 3, race, coordinateRows: [[0, 0], [76, 65]] as const,
      cityRows: [city, ...mappings[race].map((_, row) => [10 + row, 20 + row, row % 3, (row + 1) % 3, 30 + row])] };
    const baseline = projectLegacyColony([team], units);
    for (const suffix of [[0, -1], [2, 98765], [0, 0], [0x7fffffff, -0x80000000]]) {
      const variant = { ...team, cityRows: [[...city, ...suffix], ...team.cityRows.slice(1)] };
      assert.deepEqual(projectLegacyColony([variant], units), baseline);
      for (const [row, typeIndex] of mappings[race].entries()) {
        const levels = sourceScenarioUpgradeLevels(variant, typeIndex);
        assert.equal(levels.weaponLevel, row % 3);
        assert.equal(levels.armorLevel, (row + 1) % 3);
        assert.ok(Object.isFrozen(levels));
      }
    }
  }
});

test("malformed City and unit blocks fail closed without mutating source input", () => {
  const team = parseScenario(read("raw_cd/DC/SCENARIO/HUMAN/HUMAN02.SCN").toString()).teams[0];
  const original = structuredClone(team);
  for (const width of [0, 1, 8, 9, 11, 13, 14]) {
    assert.throws(() => validateScenarioCityRow(Array(width).fill(0)), /City pairs/);
  }
  for (const value of [NaN, Infinity, 0.5, 0x80000000, -0x80000001, Number.MAX_SAFE_INTEGER]) {
    for (const column of [0, 1, 10, 11]) {
      const city = [...team.cityRows[0]];
      city[column] = value;
      const candidate = { ...team, cityRows: [city, ...team.cityRows.slice(1)] };
      assert.throws(() => projectLegacyColony([candidate], units), /integer/);
      assert.throws(() => sourceScenarioUpgradeLevels(candidate, 0), /integer/);
    }
  }
  for (const [column, value, message] of [[0, -1, /level/], [2, 3, /level/], [9, -2, /health/]] as const) {
    const city = [...team.cityRows[0]];
    city[column] = value;
    assert.throws(() => validateScenarioCityRow(city), message);
  }
  for (const cityRows of [[], team.cityRows.slice(1), [...team.cityRows, [0, 0, 0, 0, 0]]]) {
    assert.throws(() => sourceScenarioUpgradeLevels({ ...team, cityRows }, 0), /city row/);
  }
  for (const row of [[0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 3, 0, 0],
    [0, 0, 0, -1, 0], [NaN, 0, 0, 0, 0], [0, 0, 0, 0, 0x80000000]]) {
    assert.throws(() => sourceScenarioUpgradeLevels({ ...team,
      cityRows: [team.cityRows[0], row, ...team.cityRows.slice(2)] }, 105));
  }
  for (const index of [-1, 8, 0.5]) assert.throws(() => sourceScenarioUpgradeLevels({ ...team, index }, 0), /team/);
  for (const race of [-1, 2, NaN]) assert.throws(() => sourceScenarioUpgradeLevels({ ...team, race }, 0), /race/);
  for (const type of [-1, 106, 0.5]) assert.throws(() => sourceScenarioUpgradeLevels(team, type), /type/);
  assert.deepEqual(team, original);
  const text = read("raw_cd/DC/SCENARIO/HUMAN/HUMAN02.SCN").toString();
  assert.throws(() => parseScenario(text.replace(/(%City\s+)-?\d+/, "$1not-an-integer")), /non-integer/);
});
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createLegacyInfantryFamilyMask } from "../../src/engine/legacy-navigation.ts";
import { NavigationGrid, type GridPoint } from "../../src/engine/grid.ts";
import { findPath } from "../../src/engine/pathfinding.ts";
import { parseScenario } from "../extractors/data/scenario.ts";
import { parseUnitStats } from "../extractors/data/tables.ts";
import { parseMapBundle } from "../extractors/maps/map.ts";

const sourceRoot = new URL("../../raw_cd/DC/", import.meta.url);

test("infantry navigation caller evidence matches the audited executable", () => {
  const binary = readFileSync(new URL("DC.EXE", sourceRoot));
  assert.equal(createHash("sha256").update(binary).digest("hex"),
    "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  const anchors: readonly (readonly [number, string])[] = [
    [0x43bb87, "ba80184f00c1e00301c2"],
    [0x43bc5c, "8d45e850"],
    [0x43bccc, "e8e1500000"],
    [0x43bd08, "8b55fc8a45e8884260"],
    [0x414d39, "8a5006"],
    [0x414d4a, "8a04c5e0184f00"],
    [0x414d54, "8845f8"],
    [0x4151d0, "8a4806"],
    [0x4151e8, "8a04c5e0184f00"],
    [0x4151f2, "8845fc"],
    [0x4152d1, "8b45f9c1f8188945d850"],
    [0x415301, "e84adf0200"],
    [0x415306, "8b45d88b5de850"],
    [0x415321, "e81af20200"],
    [0x415086, "8b45f5c1f818"],
    [0x4150a4, "e883f80200"],
    [0x442c78, "31d2"],
    [0x442c83, "31c9"],
    [0x442cd8, "884808"],
    [0x442ce2, "885009"],
    [0x442cf3, "e85036fcff"],
    [0x442d03, "4188430c"],
    [0x442d0c, "42e968ffffff"],
    [0x45344c, "8b96b4a4090029c2"],
    [0x45345a, "4a0fafd1c1e202"],
    [0x453466, "89948604040000"],
    [0x453481, "89948604080000"],
    [0x41c48b, "8d45a4508d45a05068043a4700"],
    [0x41c4a4, "e809490200"],
    [0x41c66c, "8b55a08b4da8508b5da489f0e897e8ffff"],
    [0x41c68d, "8b55a0538b4da88b5da4e878e8ffff"],
    [0x41af1e, "8955fc895df8894df4"],
    [0x41b184, "8b45fc66c746020000c1e008"],
    [0x41b197, "05800000006689068b45f8"],
    [0x41b1a9, "c1e008c6461200058000000066894604"],
    [0x41b1cb, "8a45f4884606"],
    [0x4151cd, "668b308a4806668b7804"],
    [0x4151e5, "c1fe08"],
    [0x4151ef, "c1ff08"],
    [0x444569, "baff000000"],
    [0x44457a, "88255ce64f00"],
    [0x444587, "88355be74f00"],
  ];
  for (const [address, bytes] of anchors) {
    const offset = address - 0x400c00;
    assert.equal(binary.subarray(offset, offset + bytes.length / 2).toString("hex"),
      bytes, `instruction at 0x${address.toString(16)}`);
  }
  const scanFormat = "%s " + Array<string>(32).fill("%d").join(" ");
  const scanOffset = 0x476734 - 0x402400;
  assert.equal(binary.subarray(scanOffset, scanOffset + scanFormat.length + 1).toString("ascii"),
    `${scanFormat}\0`);
  const placementFormat = "%d %d %d %d %d %d";
  const placementOffset = 0x473a04 - 0x402400;
  assert.equal(binary.subarray(placementOffset, placementOffset + placementFormat.length + 1).toString("ascii"),
    `${placementFormat}\0`);
});

test("TRSC and GRAY use source column 13, not the first raw tail value", () => {
  const units = parseUnitStats(readFileSync(new URL("GAMESTAT/GAMESTAT.TXT", sourceRoot), "utf8"));
  assert.deepEqual([units[0].sprite, units[8].sprite], ["TRSC", "GRAY"]);
  assert.deepEqual([units[0].rawTail[2], units[8].rawTail[2]], [0, 0]);
  const reaper = units.find(({ sprite }) => sprite === "REAP")!;
  const scout = units.find(({ sprite }) => sprite === "SCGM")!;
  assert.deepEqual([reaper.rawTail[0], reaper.rawTail[2]], [1, 0]);
  assert.deepEqual([scout.rawTail[0], scout.rawTail[2]], [2, 1]);
});

test("infantry family mask rejects only 0 and 255 without flipping or weighting families", () => {
  const pathGrid = Uint8Array.from({ length: 256 }, (_, family) => family);
  const mask = createLegacyInfantryFamilyMask({ width: 16, height: 16, pathGrid });
  assert.deepEqual([...mask], [0, ...Array<number>(254).fill(1), 0]);
  assert.equal(pathGrid[254], 254);
  assert.notEqual(mask, pathGrid);
  assert.deepEqual([...createLegacyInfantryFamilyMask({
    width: 3, height: 2, pathGrid: Uint8Array.of(0, 9, 255, 250, 0, 1),
  })], [0, 1, 0, 1, 0, 1]);
  for (const [width, height] of [[0, 1], [1, -1], [1.5, 1], [256, 1], [1, NaN]]) {
    assert.throws(() => createLegacyInfantryFamilyMask({ width, height, pathGrid }), RangeError);
  }
  assert.throws(() => createLegacyInfantryFamilyMask({ width: 2, height: 2, pathGrid }), RangeError);
});

for (const faction of ["HUMAN", "ALIEN"]) {
  test(`${faction}01 actual infantry placements and browser-policy routes use unflipped PTH rows`, (context) => {
    const stem = `SCENARIO/${faction}/${faction}01`;
    const read = (extension: string) => readFileSync(new URL(`${stem}.${extension}`, sourceRoot));
    const scenario = parseScenario(read("SCN").toString("utf8"));
    assert.equal(createHash("sha256").update(read("SCN")).digest("hex"), faction === "HUMAN"
      ? "af82c538181ca182481562dfa75ff1f39038a58445b019cd6a52426b33e968e7"
      : "3a971792a6661c6595ea22a5fa071abe12d03392ab3d8ec40c212328c1298b1e");
    const bundle = parseMapBundle(read("MAP"), read("MTG"), read("PTH"));
    const mask = createLegacyInfantryFamilyMask(bundle);
    const infantry = scenario.placementRows.filter((row) => row[2] === 0 || row[2] === 8);
    assert.equal(infantry.length, faction === "HUMAN" ? 30 : 32);
    let flippedBlocked = 0;
    for (const [x, y] of infantry) {
      assert.equal(mask[y * bundle.width + x], 1, `${stem} spawn ${x},${y}`);
      const terrainCell = (bundle.height - 1 - y) * bundle.width + x;
      assert.equal(bundle.attributes[terrainCell] & 0x200, 0, `${stem} terrain at spawn ${x},${y}`);
      if (mask[(bundle.height - 1 - y) * bundle.width + x] === 0) flippedBlocked += 1;
    }
    assert.equal(flippedBlocked, faction === "HUMAN" ? 11 : 13);
    const start = faction === "HUMAN" ? { x: 41, y: 12 } : { x: 49, y: 72 };
    const goal = faction === "HUMAN" ? { x: 40, y: 14 } : { x: 40, y: 70 };
    assert.ok(infantry.some(([x, y]) => x === start.x && y === start.y));
    if (faction === "HUMAN") assert.match(read("TRO").toString("utf8"), /waypoint 41 12 2 40 14 41 12/);
    else assert.ok(infantry.some(([x, y]) => x === goal.x && y === goal.y));
    const browserPolicyCosts = Uint16Array.from(mask);
    const grid = new NavigationGrid(bundle.width, bundle.height, browserPolicyCosts);
    const route = findPath(grid, start, goal);
    assert.ok(route, `${stem}: browser unit-cost cardinal route`);
    assert.equal(route.length, faction === "HUMAN" ? 4 : 12);
    assert.deepEqual(route[0], start);
    assert.deepEqual(route.at(-1), goal);
    for (let index = 0; index < route.length; index += 1) {
      const point: GridPoint = route[index];
      assert.equal(mask[point.y * bundle.width + point.x], 1);
      if (index > 0) {
        const previous: GridPoint = route[index - 1];
        assert.equal(Math.abs(previous.x - point.x) + Math.abs(previous.y - point.y), 1);
      }
    }
    context.diagnostic(JSON.stringify({ faction, width: bundle.width, height: bundle.height,
      spawns: infantry.length, flippedBlocked, start, goal, routeCells: route.length }));
  });
}
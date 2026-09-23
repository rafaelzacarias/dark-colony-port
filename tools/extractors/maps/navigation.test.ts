import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseMapBundle } from "./map.ts";

const executable = fileURLToPath(new URL("../../../raw_cd/DC/DC.EXE", import.meta.url));
const source = fileURLToPath(new URL("../../../raw_cd/DC/SCENARIO/", import.meta.url));

test("navigation evidence matches the original executable and instruction anchors", {
  skip: !existsSync(executable),
}, () => {
  const binary = readFileSync(executable);
  assert.equal(createHash("sha256").update(binary).digest("hex"),
    "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  const anchors: readonly (readonly [number, string])[] = [
    [0x442bfa, "8d8ea4700800"],
    [0x442c00, "ba00000100"],
    [0x442d04, "88430c"],
    [0x442df1, "c1e008"],
    [0x442dfd, "8a80a4700800"],
    [0x444989, "0fb67c010c"],
    [0x4449a4, "8a44c20c"],
    [0x444a79, "0fb6bfa4700800"],
    [0x444afc, "39df"],
    [0x444569, "baff000000"],
    [0x44457a, "88255ce64f00"],
    [0x444587, "88355be74f00"],
    [0x443344, "8a99c4f0ffff"],
    [0x443353, "8a9b5ce64f00"],
    [0x44348c, "81fbff030000"],
    [0x44558d, "beff030000"],
    [0x4455a3, "8971fc"],
    [0x4455c7, "09f7"],
    [0x45391f, "c1e00a"],
    [0x453999, "8b8486000c0000"],
    [0x4539a5, "668910"],
    [0x445136, "83f905"],
    [0x445139, "0f8414020000"],
    [0x44524b, "8b82e8ab4700"],
    [0x445259, "8b82ecab4700"],
    [0x4452a6, "f644020380"],
    [0x445213, "80e7fc"],
    [0x445227, "093c82"],
    [0x44540e, "66810c90ff03"],
    [0x415e63, "c1fa0a"],
  ];
  for (const [address, bytes] of anchors) {
    const offset = address - 0x400c00;
    assert.equal(binary.subarray(offset, offset + bytes.length / 2).toString("hex"),
      bytes, `instruction at 0x${address.toString(16)}`);
  }
  for (const [address, text] of [
    [0x476e6c, "path.c"],
    [0x476ee4, "current_family!=0"],
    [0x476ef8, "destination_family!=0"],
    [0x476f10, "There is no path\n"],
    [0x476ffc, "gs->map->load[gs->map->ysize-1-zs][xs]&0x80000000"],
  ] as const) {
    const offset = address - 0x402400;
    assert.equal(binary.subarray(offset, offset + text.length + 1).toString("ascii"), `${text}\0`);
  }
});

test("the executable contains the documented 15 static footprint records", {
  skip: !existsSync(executable),
}, () => {
  const binary = readFileSync(executable);
  const firstFive = [
    [[-3, 0], [-2, 0], [-3, 1], [-2, 1]],
    [[-1, -1], [0, -1], [-1, -2], [0, -2]],
    [[0, 2], [1, 2], [0, 3], [1, 3]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[-1, 2], [-1, 3], [-2, 2], [-2, 3]],
  ];
  for (let slot = 0; slot < 15; slot += 1) {
    const actual = Array.from({ length: 8 }, (_, entry) => {
      const offset = 0x47abe8 - 0x402400 + slot * 64 + entry * 8;
      return [binary.readInt32LE(offset), binary.readInt32LE(offset + 4)];
    });
    const prefix = slot < 5 ? firstFive[slot]
      : slot < 13 ? [[0, 0], [-1, 0], [-1, -1], [0, -1]] : [[0, 0]];
    const padding = slot < 5 ? prefix[3] : [0, 0];
    const expected = [...prefix, ...Array.from({ length: 8 - prefix.length }, () => padding)];
    assert.deepEqual(actual, expected, `static footprint slot ${slot}`);
  }
});

function mapPaths(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? mapPaths(path) : entry.name.endsWith(".MAP") ? [path] : [];
  }).sort();
}

test("all source PTH routing chains terminate; MAP bit 9 is not a complete family-zero rule", {
  skip: !existsSync(source),
}, () => {
  const paths = mapPaths(source);
  let cells = 0;
  let zeroFamilies = 0;
  let routes = 0;
  let maxHops = 0;
  const bit9ByFamily = [0, 0, 0, 0];
  const observedFamilies = new Set<number>();
  for (const path of paths) {
    const stem = path.slice(0, -4);
    const mapSource = readFileSync(path);
    const mtgSource = readFileSync(`${stem}.MTG`);
    const pthSource = readFileSync(`${stem}.PTH`);
    const bundle = parseMapBundle(mapSource, mtgSource, pthSource);
    const area = bundle.width * bundle.height;
    cells += area;
    assert.deepEqual(Buffer.from(bundle.pathPreamble), pthSource.subarray(0, 65_536), path);
    assert.deepEqual(Buffer.from(bundle.pathGrid), pthSource.subarray(65_536), path);
    assert.deepEqual(Buffer.from(bundle.tagGrid), mtgSource.subarray(2), path);
    for (let cell = 0; cell < area; cell += 1) {
      const family = bundle.pathGrid[cell];
      observedFamilies.add(family);
      if (family === 0) zeroFamilies += 1;
      const sourceRow = bundle.height - 1 - Math.floor(cell / bundle.width);
      const sourceCell = sourceRow * bundle.width + cell % bundle.width;
      const attribute = mapSource.readUInt16LE(8 + 4 * area + 2 * sourceCell);
      assert.equal(bundle.attributes[sourceCell], attribute, path);
      bit9ByFamily[Number((attribute & 0x200) !== 0) * 2 + Number(family !== 0)] += 1;
    }
    const families = [...new Set(bundle.pathGrid)].filter((family) => family !== 0 && family !== 255);
    const visited = new Uint32Array(256);
    let generation = 0;
    for (const origin of families) {
      for (const destination of families) {
        if (origin === destination || bundle.pathPreamble[origin * 256 + destination] === 0) continue;
        generation += 1;
        let current = origin;
        let hops = 0;
        while (current !== destination) {
          assert.notEqual(current, 0, `${path}: ${origin} -> ${destination} reaches zero`);
          assert.notEqual(visited[current], generation, `${path}: ${origin} -> ${destination} cycles`);
          visited[current] = generation;
          current = bundle.pathPreamble[current * 256 + destination];
          hops += 1;
          assert.ok(hops < 256, `${path}: routing chain exceeds the executable limit`);
        }
        routes += 1;
        maxHops = Math.max(maxHops, hops);
      }
    }
  }
  assert.deepEqual({ maps: paths.length, cells, zeroFamilies, routes, maxHops }, {
    maps: 108, cells: 1_345_872, zeroFamilies: 416_598, routes: 6_246_720, maxHops: 89,
  });
  assert.deepEqual([...observedFamilies].sort((left, right) => left - right),
    [0, ...Array.from({ length: 242 }, (_, index) => index + 9)]);
  assert.deepEqual(bit9ByFamily, [95_157, 929_274, 321_441, 0]);
});
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseTerrainBank, resolveTerrainReferences } from "../extractors/maps/bts.ts";
import { parseMap } from "../extractors/maps/map.ts";
import { createMissionMode3Terrain, type MissionTerrainInput, type MissionIndexedTerrain } from "../../src/render/mission-terrain.ts";
import { readNativeGifPalette, RemapTable } from "../../src/render/palette.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const native = JSON.parse(process.env.DC_MODE3_TRACE ? readFileSync(process.env.DC_MODE3_TRACE, "utf8") :
  execFileSync("python3", [new URL("../research/mode3-effect-20260920.py", import.meta.url).pathname], {
    encoding: "utf8", maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
  }));
const bank = parseTerrainBank(read("raw_cd/DC/SCENARIO/DESERT.BTS"));
const map = parseMap(read("raw_cd/DC/SCENARIO/HUMAN/HUMAN01.MAP"));
const mission: MissionTerrainInput = { map: { ...JSON.parse(read("public/assets/generated/maps/HUMAN/HUMAN01.json").toString()), ...map },
  scenario: JSON.parse(read("public/assets/generated/data/scenarios/HUMAN/HUMAN01.json").toString()),
  attributes: map.attributes, tileReferences: map.tileReferences,
  tileRecordIndices: resolveTerrainReferences(bank, map.tileReferences).recordIndices };
const atlas = Uint8Array.from(bank.tiles.flatMap(tile => Array.from(tile.indices)));
const indexed: MissionIndexedTerrain = { schemaVersion: 1, palette: "DESERT", keySpace: 0, keyToRecord: [],
  indices: { path: "fixture", width: 32, height: bank.tiles.length * 32, bytes: atlas.length, sha256: "", format: "R8UI" },
  atlas: { width: 32, height: bank.tiles.length * 32 }, tiles: bank.tiles.map((_, recordIndex) => ({
  recordIndex, key: recordIndex, x: 0, y: recordIndex * 32, width: 32, height: 32,
})) };

test("bounded terrain consumes original BTS indices and sampled bank0 filter for all 192 native frames", () => {
  let frames = 0;
  for (const entry of native.cases) {
    const palette = readNativeGifPalette(read(entry.gif.path));
    const consumer = createMissionMode3Terrain(mission, indexed, atlas, palette, new RemapTable(read(entry.remap.path)));
    for (const fixture of entry.raster.frames) for (const variant of fixture.variants) {
      const size = fixture.camera.width * variant.height;
      const output = consumer.renderIllumination({ ...fixture.camera, height: variant.height,
        indices: Buffer.from(variant.filter, "base64").subarray(0, size) });
      assert.deepEqual(Buffer.from(output.terrainIndices), Buffer.from(fixture.terrain, "base64").subarray(0, size));
      const expected = Buffer.from(variant.output, "base64").subarray(0, size);
      assert.deepEqual(Buffer.from(output.indices), expected);
      for (let offset = 0; offset < size; offset++) {
        assert.equal(output.rgba[offset * 4], palette[expected[offset] * 3]);
        assert.equal(output.rgba[offset * 4 + 1], palette[expected[offset] * 3 + 1]);
        assert.equal(output.rgba[offset * 4 + 2], palette[expected[offset] * 3 + 2]);
        assert.equal(output.rgba[offset * 4 + 3], 255);
      }
      frames++;
    }
  }
  assert.equal(frames, 192);
});
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import {
  createMissionTerrain, cropMissionTerrainTile, initializeMissionTerrainPalette, MissionTerrainTileCache,
  planMissionTerrainFrame, type MissionIndexedTerrain, type MissionTerrainInput, type MissionTerrainTile,
} from "../../src/render/mission-terrain.js";
import { IndexedWebGLUnavailableError, prepareIndexedUpload, type IndexedImage, type IndexedSource } from "../../src/render/indexed-webgl.js";
import { initializeDesertMissionPalette } from "../../src/render/palette-init.js";

function fixture(): MissionTerrainInput {
  return {
    scenario: {
      schemaVersion: 1, source: { path: "fixture.SCN", sha256: "" }, terrainBank: "desert.bts",
      id: "fixture", title: "fixture", rawHeader: ["desert.bts", "1"],
      teams: [], placementRows: [],
    },
    map: {
      schemaVersion: 2, width: 2, height: 2, terrainBank: "desert.bts", referencesPerCell: 2,
      files: { tileReferences: "", tileRecordIndices: "", attributes: "", pathGrid: "", tags: "" },
    },
    tileReferences: Uint16Array.from([10, 0, 20, 99, 30, 40, 50, 60]),
    tileRecordIndices: Uint16Array.from([1, 0, 2, 0, 3, 4, 5, 6]),
    attributes: Uint16Array.from([0, 0x20, 0x40, 0x60]),
  };
}

const frame = { cameraX: 1, cameraY: 1, visible: Uint8Array.from([1, 0, 0, 1]) };

test("frame array preserves source-row flip, upward world Y, layer flags and native phase", () => {
  const plan = planMissionTerrainFrame(fixture(), frame);
  assert.deepEqual(plan.map(({ cellX, worldY, sourceY, sourceKey, recordIndex, layer, mirrorX, coverage, x, y, row }) =>
    [cellX, worldY, sourceY, sourceKey, recordIndex, layer, mirrorX, coverage, x, y, row]), [
    [0, 0, 1, 30, 3, 0, false, "opaque", 224, 226, 135],
    [0, 0, 1, 40, 4, 1, true, "source-zero", 224, 226, 135],
    [1, 0, 1, 50, 5, 0, true, "opaque", 256, 226, 135],
    [1, 0, 1, 60, 6, 1, true, "source-zero", 256, 226, 135],
    [0, 1, 0, 10, 1, 0, false, "opaque", 224, 194, 135],
    [1, 1, 0, 20, 2, 0, true, "opaque", 256, 194, 135],
  ]);
});

test("palette fog is opt-in, world-ordered and uses uniform 16/10/0 brightness", () => {
  const plan = planMissionTerrainFrame(fixture(), {
    ...frame, blend: 128, fog: "palette", explored: Uint8Array.from([0, 1, 0, 0]),
  });
  assert.deepEqual(plan.filter(({ layer }) => layer === 0).map(({ row }) => row), [131, 83, 3, 131]);
  assert.ok(planMissionTerrainFrame(fixture(), { ...frame, phase: 0 }).every(({ row }) => row === 128));
  for (let blend = 0; blend <= 256; blend++) {
    assert.equal(planMissionTerrainFrame(fixture(), { ...frame, blend })[0].row, 128 + Math.trunc(7 * blend / 256));
  }
});

test("camera quantizes to shared pixel edges and culls outside the 512x452 surface", () => {
  const plan = planMissionTerrainFrame(fixture(), { ...frame, cameraX: 1.01, cameraY: 1.02 });
  assert.deepEqual(plan.slice(0, 3).map(({ x, y }) => [x, y]), [[224, 227], [224, 227], [256, 227]]);
  assert.deepEqual(planMissionTerrainFrame(fixture(), { ...frame, cameraX: -100 }), []);
  const edge = planMissionTerrainFrame(fixture(), { ...frame, cameraX: 9 });
  assert.ok(edge.every(({ cellX, x }) => cellX === 1 && x === 0));
  assert.equal(edge.length, 3);
});

test("invalid frame inputs fail explicitly", () => {
  assert.throws(() => planMissionTerrainFrame(fixture(), { ...frame, cameraY: NaN }), /camera/);
  assert.throws(() => planMissionTerrainFrame(fixture(), { ...frame, visible: new Uint8Array(1) }), /lengths/);
  assert.throws(() => planMissionTerrainFrame(fixture(), { ...frame, phase: 0, blend: 0 }), /not both/);
  assert.throws(() => planMissionTerrainFrame(fixture(), { ...frame, blend: 257 }), /blend/);
  const mission = fixture();
  assert.throws(() => planMissionTerrainFrame({ ...mission, scenario: { ...mission.scenario, rawHeader: [] } }, frame), /phase/);
});

const generated = new URL("../../public/assets/generated/", import.meta.url);
const native = new URL("../../raw_cd/DC/", import.meta.url);
const readGenerated = (path: string): Uint8Array => Uint8Array.from(readFileSync(new URL(path, generated)));
const jsonGenerated = <Value>(path: string): Value => JSON.parse(new TextDecoder().decode(readGenerated(path))) as Value;

function stubDocument(context: TestContext, value: unknown): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { value, configurable: true });
  context.after(() => {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  });
}

function corpusMission(faction: "HUMAN" | "ALIEN"): MissionTerrainInput {
  const stem = `${faction}/${faction}01`;
  const scenario = jsonGenerated<MissionTerrainInput["scenario"]>(`data/scenarios/${stem}.json`);
  const map = jsonGenerated<MissionTerrainInput["map"]>(`maps/${stem}.json`);
  function layer(path: string): Uint16Array {
    const bytes = readGenerated(`maps/${faction}/${path}`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Uint16Array.from({ length: bytes.length / 2 }, (_, index) => view.getUint16(index * 2, true));
  }
  return { scenario, map, tileReferences: layer(map.files.tileReferences),
    tileRecordIndices: layer(map.files.tileRecordIndices), attributes: layer(map.files.attributes) };
}

test("published RGB8 adapter exactly matches original GIF/RMP initialization for both missions", () => {
  const display = readGenerated("indexed/palettes/DESERT.palette.rgb8");
  const remap = readGenerated("indexed/palettes/DESERT.rmp.r8");
  const beforeDisplay = display.slice();
  const beforeRemap = remap.slice();
  for (const faction of ["HUMAN", "ALIEN"] as const) {
    const mission = corpusMission(faction);
    const expected = initializeDesertMissionPalette(mission.scenario,
      readFileSync(new URL("DESERT.GIF", native)), readFileSync(new URL("DESERT.RMP", native)));
    const actual = initializeMissionTerrainPalette(mission, display, remap);
    assert.deepEqual(actual.palette, expected.palette);
    assert.deepEqual(actual.remap.toTextureBytes(), expected.remap.toTextureBytes());
    assert.deepEqual(actual.teamSelectors, expected.teamSelectors);
    assert.deepEqual(actual.visibleTerrain, expected.visibleTerrain);
    assert.equal(actual.dayNightBlend, faction === "HUMAN" ? 0 : 256);
  }
  assert.deepEqual(display, beforeDisplay);
  assert.deepEqual(remap, beforeRemap);
  assert.throws(() => initializeMissionTerrainPalette(corpusMission("HUMAN"), new Uint8Array(768), remap), /endpoints/);
});

test("cropping keeps source rows and zero indices intact; only foreground zero loses coverage", () => {
  const atlas = Uint8Array.from({ length: 64 * 64 }, (_, index) => (Math.floor(index / 64) * 7 + index % 64 * 3) % 256);
  const before = atlas.slice();
  const tile: MissionTerrainTile = { recordIndex: 0, key: 17, x: 32, y: 32, width: 32, height: 32 };
  atlas[32 * 64 + 32] = 0;
  before[32 * 64 + 32] = 0;
  for (const layer of [0, 1] as const) {
    const source = cropMissionTerrainTile(atlas, 64, 64, tile, layer);
    const upload = prepareIndexedUpload(source);
    for (let row = 0; row < 32; row++) {
      assert.deepEqual(source.indices.subarray(row * 32, (row + 1) * 32), atlas.subarray((row + 32) * 64 + 32, (row + 33) * 64));
    }
    assert.equal(upload.coverage[0], layer === 0 ? 255 : 0);
    assert.equal(upload.coverage[1], 255);
  }
  assert.deepEqual(atlas, before);
  assert.throws(() => cropMissionTerrainTile(atlas, 64, 64, { ...tile, x: 33 }, 0), /rectangle/);
});

test("bounded LRU uploads each resident tile/layer once, pins the frame and releases on eviction/dispose", () => {
  const terrain = jsonGenerated<MissionIndexedTerrain>("indexed/terrain/DESERT.json");
  const atlas = readGenerated("indexed/terrain/DESERT.indices.r8");
  const uploads: IndexedSource[] = [];
  const released: IndexedImage[] = [];
  const cache = new MissionTerrainTileCache({
    upload(source) {
      uploads.push(source);
      return { width: source.width, height: source.height };
    },
    releaseImage(image) { released.push(image); },
  }, terrain, atlas, 2);
  const base = planMissionTerrainFrame(fixture(), frame)[0];
  const first = { ...base, recordIndex: 0 };
  const second = { ...base, recordIndex: 1 };
  const third = { ...base, recordIndex: 2 };
  const original = cache.layers([first, second]);
  const repeat = cache.layers([first, second]);
  assert.equal(uploads.length, 2);
  assert.equal(original[0].image, repeat[0].image);
  assert.equal(original[1].image, repeat[1].image);
  cache.layers([first]);
  cache.layers([third, first]);
  assert.equal(uploads.length, 3);
  assert.deepEqual(released, [original[1].image]);
  assert.equal(cache.stats.cachedImages, 2);
  assert.equal(cache.stats.evictions, 1);
  assert.throws(() => cache.layers([first, second, third]), /capacity/);
  assert.equal(uploads.length, 3);
  cache.layers([{ ...first, layer: 1 }, first]);
  assert.deepEqual(uploads.at(-1)?.coverage, { mode: "source-zero" });
  assert.equal(cache.stats.cachedImages, 2);
  cache.dispose();
  cache.dispose();
  assert.equal(released.length, uploads.length);
  assert.equal(new Set(released).size, released.length);
  assert.equal(cache.stats.cachedImages, 0);
  assert.equal(cache.stats.retainedIndexBytes, 0);
  assert.throws(() => cache.layers([first]), /disposed/);
});

test("large panned frame plans remain inside the documented cache budget with no offscreen draws", () => {
  const mission = fixture();
  const width = 64;
  const height = 64;
  const large = { ...mission, map: { ...mission.map, width, height },
    tileReferences: new Uint16Array(width * height * 2).fill(1),
    tileRecordIndices: Uint16Array.from({ length: width * height * 2 }, (_, index) => index),
    attributes: new Uint16Array(width * height),
  };
  const plan = planMissionTerrainFrame(large, { cameraX: 32.5, cameraY: 32, visible: new Uint8Array(width * height) });
  assert.equal(plan.length, 17 * 16 * 2);
  assert.ok(plan.every(({ x, y, width, height }) => x < 512 && x + width > 0 && y < 452 && y + height > 0));
});

test("published loader validates both real missions before explicit WebGL-unavailable fallback", async (context) => {
  const requests: string[] = [];
  const canvas = { width: 0, height: 0, getContext: () => null };
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const path = String(input).replace("/assets/generated/", "");
    requests.push(path);
    return new Response(Uint8Array.from(readGenerated(path)).buffer);
  });
  stubDocument(context, { createElement: () => canvas });
  for (const faction of ["HUMAN", "ALIEN"] as const) {
    await assert.rejects(createMissionTerrain(corpusMission(faction)), IndexedWebGLUnavailableError);
  }
  assert.equal(canvas.width, 512);
  assert.equal(canvas.height, 452);
  assert.deepEqual([...new Set(requests)].sort(), [
    "indexed/index.json", "indexed/index.sha256", "indexed/palettes/DESERT.json",
    "indexed/palettes/DESERT.palette.rgb8", "indexed/palettes/DESERT.rmp.r8",
    "indexed/terrain/DESERT.indices.r8", "indexed/terrain/DESERT.json",
  ].sort());
});

test("published loader rejects altered bytes and mismatched map records without silently substituting assets", async (context) => {
  stubDocument(context, { createElement: () => { throw new Error("Should not create canvas"); } });
  let corrupt = false;
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const path = String(input).replace("/assets/generated/", "");
    const bytes = readGenerated(path);
    if (corrupt && path.endsWith(".indices.r8")) bytes[0] ^= 1;
    return new Response(Uint8Array.from(bytes).buffer);
  });
  const mission = corpusMission("HUMAN");
  const records = mission.tileRecordIndices.slice();
  records[0] = (records[0] + 1) % 1000;
  await assert.rejects(createMissionTerrain({ ...mission, tileRecordIndices: records }), /key map/);
  corrupt = true;
  await assert.rejects(createMissionTerrain(mission), /size\/hash mismatch/);
});
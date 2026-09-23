import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseFin } from "../extractors/animations/fin.ts";
import { parseTerrainBank, resolveTerrainReferences } from "../extractors/maps/bts.ts";
import { parseMap } from "../extractors/maps/map.ts";
import { parseSprite } from "../extractors/sprites/spr.ts";
import { composeFinSample } from "../../src/render/fin-composition.ts";
import { registerNativePaletteImage } from "../../src/render/mode1-canvas.ts";
import { drawNativeMode3Canvas, registerNativeMode3Mission } from "../../src/render/mode3-canvas.ts";
import { composeNativeMode3, drawNativeMode3Indexed, nativeMode3Filter } from "../../src/render/mode3-effect.ts";
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
const pairs = resolveTerrainReferences(bank, map.tileReferences).recordIndices;
const masks = bank.tiles.map(tile => Uint32Array.from({ length: 32 }, (_, row) => {
  let mask = 0;
  for (let column = 0; column < 32; column++) if (tile.indices[row * 32 + column]) mask |= 1 << (31 - column);
  return mask >>> 0;
}));
const terrain = Array.from(map.attributes, (attributes, index) => ({
  kind: "terrain" as const, column: index % map.width, row: Math.floor(index / map.width),
  backgroundIndex: pairs[index * 2], foregroundIndex: pairs[index * 2 + 1], attributes,
  foregroundMask: masks[pairs[index * 2 + 1]],
}));

test("mode3 original source and all-byte carry/quantization proof", () => {
  assert.equal(native.sha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  assert.equal(createHash("sha256").update(read("raw_cd/DC/DC.EXE")).digest("hex"), native.sha256);
  assert.equal(native.runtimeInterceptions, 0);
  assert.deepEqual([...new Set(native.cases.map((entry: { bank: string }) => entry.bank))].sort(), ["ATLANTIS", "DESERT", "HTRAIN", "JUNGLE"]);
  const proof = Buffer.from(native.pixelProof.output, "base64");
  assert.equal(native.pixelProof.pairs, 65536);
  assert.equal(proof.length, 65536);
  for (let source = 0; source < 256; source++) for (let filter = 0; filter < 256; filter++) {
    assert.equal(nativeMode3Filter(source, filter), proof[source * 256 + filter], `${source}:${filter}`);
  }
  for (const entry of native.cases) for (const source of [entry.fin, entry.remap, entry.gif, ...entry.raster.sources]) {
    assert.equal(createHash("sha256").update(read(source.path)).digest("hex"), source.sha256);
  }
});

for (const entry of native.cases) test(`mode3 native frames ${entry.bank} controlledMirror=${entry.controlledMirror}`, () => {
  const sourceChild = parseFin(read(entry.fin.path)).timeline[entry.fin.timeline].children[entry.childIndex];
  assert.deepEqual(sourceChild, entry.sourceChild);
  assert.equal(sourceChild.sprite.toUpperCase(), "SMSP");
  assert.equal(sourceChild.valueA, 3);
  assert.equal(sourceChild.flags, 16);
  const child = { ...sourceChild, valueB: entry.controlledMirror ? 1 : sourceChild.valueB };
  const source = parseSprite(read(`raw_cd/DC/SPRITES/${child.sprite.toUpperCase()}.SPR`)).frames[child.frame];
  const sprite = { ...source, coverage: source.alpha };
  const part = composeFinSample({ children: [child], timelineIndex: entry.fin.timeline, finished: false },
    () => ({ ...source, index: child.frame, x: 0, y: 0, empty: false }))[0];
  const remap = new RemapTable(read(entry.remap.path));
  const palette = readNativeGifPalette(read(entry.gif.path));
  const mission = {}, image = {} as CanvasImageSource;
  const dispose = registerNativeMode3Mission(mission, { sources: new Map([[child.sprite.toUpperCase(), sprite]]), palette, remap });
  registerNativePaletteImage(image, { ...sprite, palette, remap, selector: 7 });
  let changed = 0, clipped = 0;
  for (const fixture of entry.raster.frames) {
    assert.deepEqual(child, fixture.child);
    assert.deepEqual(fixture.postpassCalls, ["0x4548c3", "0x454c22"]);
    const plan = composeNativeMode3({ part, sprite, terrain,
      position: { x: fixture.queuedX, y: fixture.baseline, heightOffset: 0 } });
    for (const variant of fixture.variants) {
      assert.ok(variant.calls.includes("0x4621a0"));
      const expectedFilters = Buffer.from(variant.filter, "base64");
      const expected = Buffer.from(variant.output, "base64");
      const size = fixture.camera.width * variant.height;
      const filters = new Uint8Array(size).fill(128);
      const surface = { ...fixture.camera, height: variant.height, indices: Buffer.from(fixture.before, "base64").subarray(0, size) };
      drawNativeMode3Indexed({ surface, filters, plan, remap, enabled: variant.enabled,
        terrainIndices: Buffer.from(fixture.terrain, "base64").subarray(0, size) });
      const differences = Array.from(filters.keys()).filter(offset => filters[offset] !== expectedFilters[offset]);
      assert.equal(differences.length, 0, JSON.stringify({ phase: fixture.phase, reflection: fixture.reflection, height: variant.height,
        differences: differences.slice(0, 10).map(offset => ({ offset, actual: filters[offset], expected: expectedFilters[offset] })) }));
      assert.deepEqual(surface.indices, expected.subarray(0, size));
      assert.ok(expectedFilters.subarray(size).every(value => value === 128));
      assert.deepEqual(expected.subarray(size), Buffer.from(fixture.before, "base64").subarray(size));
      const rgba = (indices: Uint8Array) => Uint8ClampedArray.from({ length: indices.length * 4 }, (_, offset) =>
        offset % 4 === 3 ? 255 : palette[indices[Math.floor(offset / 4)] * 3 + offset % 4]);
      const pixels = rgba(Buffer.from(fixture.before, "base64").subarray(0, size));
      const counts = { reads: 0, writes: 0, pixels: 0 };
      const context = {
        globalAlpha: 1, globalCompositeOperation: "source-over", filter: "none", shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
        getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
        getImageData(left: number, top: number, width: number, height: number) {
          counts.reads++; counts.pixels += width * height;
          const data = new Uint8ClampedArray(width * height * 4);
          for (let row = 0; row < height; row++) data.set(pixels.subarray(((top + row) * surface.width + left) * 4,
            ((top + row) * surface.width + left + width) * 4), row * width * 4);
          return { width, height, data };
        },
        putImageData(data: ImageData, left: number, top: number) {
          counts.writes++;
          for (let row = 0; row < data.height; row++) pixels.set(data.data.subarray(row * data.width * 4, (row + 1) * data.width * 4),
            ((top + row) * surface.width + left) * 4);
        },
      } as unknown as CanvasRenderingContext2D;
      const canvasFilters = { ...surface, indices: new Uint8Array(size).fill(128) };
      const result = drawNativeMode3Canvas({ context, image, mission: entry.controlledMirror ? undefined : mission, part, terrain,
        position: { x: fixture.queuedX, y: fixture.baseline, heightOffset: 0 }, filters: canvasFilters, enabled: variant.enabled,
        terrainIndices: Buffer.from(fixture.terrain, "base64").subarray(0, size) });
      assert.equal(result.exact, true, JSON.stringify(result));
      assert.deepEqual(pixels, rgba(expected.subarray(0, size)));
      assert.deepEqual(canvasFilters.indices, filters);
      assert.ok(counts.reads <= 1); assert.equal(counts.writes, counts.reads);
      assert.equal(counts.pixels, result.readbackPixels); assert.ok(counts.pixels <= 128 * 1024);
      changed += filters.filter(value => value !== 128).length;
      if (variant.enabled && variant.height !== fixture.camera.height && variant.filter !== fixture.variants[0].filter) clipped++;
    }
  }
  assert.ok(changed > 0);
  assert.ok(clipped > 0);
  dispose();
});
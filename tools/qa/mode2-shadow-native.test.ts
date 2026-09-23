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
import { composeNativeMode2, drawNativeMode2Indexed } from "../../src/render/mode2-shadow.ts";
import type { NativeIndexedSurface } from "../../src/render/mode1-shadow.ts";
import { readNativeGifPalette, RemapTable } from "../../src/render/palette.ts";
import { drawNativeMode2Canvas, registerNativeMode2Mission } from "../../src/render/mode2-canvas.ts";
import { canvas, rgba } from "./mode2-test-helpers.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const native = JSON.parse(process.env.DC_MODE2_TRACE ? readFileSync(process.env.DC_MODE2_TRACE, "utf8") :
  execFileSync("python3", [new URL("../research/mode2-effect-20260919.py", import.meta.url).pathname], {
    encoding: "utf8", maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
  }));
const bank = parseTerrainBank(read("raw_cd/DC/SCENARIO/DESERT.BTS"));
const map = parseMap(read("raw_cd/DC/SCENARIO/HUMAN/HUMAN01.MAP"));
const pairs = resolveTerrainReferences(bank, map.tileReferences).recordIndices;
const coverage = bank.tiles.map(tile => Uint32Array.from({ length: 32 }, (_, row) => {
  let mask = 0;
  for (let column = 0; column < 32; column++) if (tile.indices[row * 32 + column]) mask |= 1 << (31 - column);
  return mask >>> 0;
}));
const terrain = Array.from(map.attributes, (attributes, index) => ({
  kind: "terrain" as const, column: index % map.width, row: Math.floor(index / map.width),
  backgroundIndex: pairs[index * 2], foregroundIndex: pairs[index * 2 + 1], attributes,
  foregroundMask: coverage[pairs[index * 2 + 1]],
}));

test("mode2 original EXE and genuine ALBU FIN/SPR/MAP/GIF/RMP provenance", () => {
  assert.equal(native.sha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  assert.equal(createHash("sha256").update(read("raw_cd/DC/DC.EXE")).digest("hex"), native.sha256);
  assert.equal(native.runtimeInterceptions, 0);
  assert.equal(native.cases.length, 16);
  assert.ok(native.cases.some((entry: { raster: { frames: { clipped: string; output: string }[] } }) =>
    entry.raster.frames.some(frame => frame.clipped !== frame.output)));
  assert.ok(native.cases.some((entry: { raster: { frames: { clipped: string; before: string }[] } }) =>
    entry.raster.frames.some(frame => frame.clipped !== frame.before)));
  for (const entry of native.cases) {
    for (const source of [entry.fin, entry.remap, entry.gif, ...entry.raster.sources]) {
      assert.equal(createHash("sha256").update(read(source.path)).digest("hex"), source.sha256);
    }
    assert.deepEqual(parseFin(read(entry.fin.path)).timeline[entry.fin.timeline].children[entry.childIndex], entry.sourceChild);
    assert.equal(entry.raster.frames.length, 8);
    for (const fixture of entry.raster.frames) {
      assert.deepEqual(fixture.calls, [fixture.child.valueB ? "0x461d14" : "0x4618c0", "0x461090"]);
      assert.ok(fixture.remapOffsets.length > 0);
      assert.ok(fixture.remapOffsets.every((offset: number) => offset >= 72 * 256 && offset < 73 * 256));
      assert.notEqual(fixture.before, fixture.output);
    }
  }
});

for (const entry of native.cases) test(`${entry.bank} ALBU:${entry.fin.timeline} mirror-control:${entry.controlledMirror} exact mode2 framebuffer`, () => {
  const child = entry.raster.frames[0].child;
  const source = parseSprite(read(`raw_cd/DC/SPRITES/${child.sprite.toUpperCase()}.SPR`)).frames[child.frame];
  const sprite = { ...source, coverage: source.alpha };
  const part = composeFinSample({ children: [child], timelineIndex: entry.fin.timeline, finished: false },
    () => ({ ...source, index: child.frame, x: 0, y: 0, empty: false }))[0];
  const remap = new RemapTable(read(entry.remap.path));
  const palette = readNativeGifPalette(read(entry.gif.path)), mission = {};
  const dispose = registerNativeMode2Mission(mission, { sources: new Map([[child.sprite.toUpperCase(), sprite]]), palette, remap });
  for (const fixture of entry.raster.frames) {
    const plan = composeNativeMode2({ part, sprite, terrain,
      position: { x: fixture.queuedX, y: fixture.baseline, heightOffset: 0 } });
    const surface: NativeIndexedSurface = { ...fixture.camera, indices: Buffer.from(fixture.before, "base64") };
    drawNativeMode2Indexed(surface, plan, remap);
    const expected = Buffer.from(fixture.output, "base64");
    const differences = Array.from(surface.indices.keys()).filter(offset => surface.indices[offset] !== expected[offset]);
    assert.equal(differences.length, 0, JSON.stringify({ camera: fixture.camera, reflection: fixture.reflection,
      phase: fixture.phase, differences: differences.slice(0, 12) }));
    const clipped: NativeIndexedSurface = { ...fixture.camera, height: fixture.clipHeight,
      indices: Buffer.from(fixture.before, "base64").subarray(0, fixture.camera.width * fixture.clipHeight) };
    drawNativeMode2Indexed(clipped, plan, remap);
    const clippedExpected = Buffer.from(fixture.clipped, "base64").subarray(0, clipped.indices.length);
    const clipDifferences = Array.from(clipped.indices.keys()).filter(offset => clipped.indices[offset] !== clippedExpected[offset]);
    assert.equal(clipDifferences.length, 0, JSON.stringify({ clipHeight: fixture.clipHeight,
      phase: fixture.phase, differences: clipDifferences.slice(0, 12) }));
    for (const height of [fixture.camera.height, fixture.clipHeight]) {
      const pixels = rgba(Buffer.from(fixture.before, "base64"), palette), drawing = canvas(pixels, fixture.camera.width);
      const result = drawNativeMode2Canvas({ ...drawing, mission, part, terrain,
        position: { x: fixture.queuedX, y: fixture.baseline, heightOffset: 0 }, camera: { ...fixture.camera, height } });
      assert.equal(result.exact, true, JSON.stringify(result));
      assert.deepEqual(pixels, rgba(Buffer.from(height === fixture.clipHeight ? fixture.clipped : fixture.output, "base64"), palette));
      assert.ok(drawing.counts.reads <= 1); assert.equal(drawing.counts.writes, drawing.counts.reads);
      assert.equal(result.readbackPixels, drawing.counts.readPixels);
      assert.ok(result.readbackPixels <= 128 * 1024);
    }
  }
  dispose();
});
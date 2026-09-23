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
import { composeNativeMode1, drawNativeMode1Indexed, type NativeIndexedSurface } from "../../src/render/mode1-shadow.ts";
import { readNativeGifPalette, RemapTable, RgbLookupTable } from "../../src/render/palette.ts";
import { drawNativeMode1CanvasShadow, registerNativePaletteImage } from "../../src/render/mode1-canvas.ts";
import { createMissionSceneFrame } from "../../src/render/mission-scene-frame.ts";
import type { MissionIndexedTerrain } from "../../src/render/mission-terrain.ts";
import type { SceneTerrainCommand } from "../../src/render/scene-composition.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const hash = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const native = JSON.parse(process.env.DC_MODE1_TRACE ? readFileSync(process.env.DC_MODE1_TRACE, "utf8") :
  execFileSync("python3", [new URL("../research/mode1-shadow-20260919.py", import.meta.url).pathname], {
    encoding: "utf8", maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
  }));
const bank = parseTerrainBank(read("raw_cd/DC/SCENARIO/DESERT.BTS"));
const map = parseMap(read("raw_cd/DC/SCENARIO/HUMAN/HUMAN01.MAP"));
const pairs = resolveTerrainReferences(bank, map.tileReferences).recordIndices;
const indexedMetadata = JSON.parse(read("public/assets/generated/indexed/terrain/DESERT.json").toString()) as MissionIndexedTerrain;
const coverage = bank.tiles.map((tile) => Uint32Array.from({ length: 32 }, (_, row) => {
  let mask = 0;
  for (let column = 0; column < 32; column++) if (tile.indices[row * 32 + column]) mask |= 1 << (31 - column);
  return mask >>> 0;
}));
const terrain: SceneTerrainCommand[] = Array.from(map.attributes, (attributes, index) => ({
  kind: "terrain", column: index % map.width, row: Math.floor(index / map.width),
  backgroundIndex: pairs[index * 2], foregroundIndex: pairs[index * 2 + 1], attributes,
  foregroundMask: coverage[pairs[index * 2 + 1]],
}));

test("mode1 original executable, source FIN/SPR/MAP/RMP provenance and dispatch", () => {
  assert.equal(native.sha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  assert.equal(native.runtimeInterceptions, 0);
  assert.ok(native.cases.length >= 4);
  for (const entry of native.cases) {
    for (const source of [entry.fin, entry.remap, ...entry.raster.sources]) assert.equal(hash(read(source.path)), source.sha256);
    assert.equal(entry.raster.frames.length, 8);
    assert.deepEqual(entry.raster.frames.map((fixture: { selector: number }) => fixture.selector).sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
    for (const fixture of entry.raster.frames) {
      assert.deepEqual(fixture.calls, fixture.child.valueB ? ["0x461d14", "0x46152c"] : ["0x4618c0", "0x461170"]);
      assert.deepEqual(fixture.cutoffs, ["0x461090", "0x461090"]);
      const rows = [...new Set(fixture.remapOffsets.map((offset: number) => offset >> 8))];
      assert.ok(rows.every((row) => row === 72 || row === 640 + fixture.selector));
      if (fixture.before !== fixture.shadow) assert.ok(rows.includes(72));
    }
    assert.ok(entry.raster.frames.some((fixture: { before: string; shadow: string }) => fixture.before !== fixture.shadow));
  }
});

test("original source palette generator proves row72 coefficient and source RGB quantization", () => {
  for (const entry of native.cases) {
    for (const source of [entry.palette.gif, entry.palette.rgb]) assert.equal(hash(read(source.path)), source.sha256);
    const palette = readNativeGifPalette(read(entry.palette.gif.path));
    const rgb = new RgbLookupTable(read(entry.palette.rgb.path));
    const remap = new RemapTable(read(entry.remap.path));
    for (let index = 0; index < 256; index++) {
      const selected = index >= 138 && index < 144 ? index - 42 : index;
      const channels = Array.from(palette.subarray(selected * 3, selected * 3 + 3), (value) => Math.floor(value * 9 / 16));
      assert.deepEqual(channels, entry.palette.channels[index]);
      assert.equal(remap.lookup(0, 72, index), entry.palette.sourceRow[index]);
      assert.equal(rgb.lookup(channels[0], channels[1], channels[2]), entry.palette.quantized[index]);
      assert.equal(remap.lookup(0, 72, index), entry.palette.pixels[index]);
    }
  }
});

for (const entry of native.cases) test(`${entry.bank} source timeline ${entry.fin.path}:${entry.fin.timeline} exact shadow then body`, () => {
  const children = parseFin(read(entry.fin.path)).timeline[entry.fin.timeline].children;
  const source = parseSprite(read(`raw_cd/DC/SPRITES/${children[0].sprite.toUpperCase()}.SPR`)).frames[children[0].frame];
  const sprite = { ...source, coverage: source.alpha };
  const part = composeFinSample({ children, timelineIndex: entry.fin.timeline, finished: false },
    () => ({ ...source, index: children[0].frame, x: 0, y: 0, empty: false }))[0];
  const remap = new RemapTable(read(entry.remap.path));
  for (const fixture of entry.raster.frames) {
    assert.deepEqual(children[0], fixture.child);
    const plan = composeNativeMode1({ part, sprite, terrain,
      position: { x: fixture.queuedX, y: fixture.baseline, heightOffset: 0 } });
    const surface: NativeIndexedSurface = { ...fixture.camera, indices: Buffer.from(fixture.before, "base64") };
    for (const pass of ["shadow", "body"] as const) {
      drawNativeMode1Indexed(surface, plan, sprite, remap, fixture.selector, pass);
      const expected = Buffer.from(fixture[pass === "shadow" ? "shadow" : "output"], "base64");
      const differences = Array.from(surface.indices.keys()).filter((offset) => surface.indices[offset] !== expected[offset]);
      assert.equal(differences.length, 0, JSON.stringify({ pass, mirror: part.mirrored, reflection: fixture.reflection,
        phase: fixture.phase, differences: differences.slice(0, 15).map((offset) => ({
          x: offset % surface.width, y: Math.floor(offset / surface.width),
          actual: surface.indices[offset], expected: expected[offset],
        })) }));
    }
    const crop = { x: plan.body.topLeft.x + Math.floor(source.width / 2),
      y: plan.body.topLeft.y + Math.floor(source.height / 2), width: 17, height: 13 };
    const cropped = (data: Uint8Array) => Uint8Array.from({ length: crop.width * crop.height }, (_, offset) =>
      data[(crop.y - fixture.camera.y + Math.floor(offset / crop.width)) * surface.width + crop.x - fixture.camera.x + offset % crop.width]);
    const small = { ...crop, indices: cropped(Buffer.from(fixture.before, "base64")) };
    drawNativeMode1Indexed(small, plan, sprite, remap, fixture.selector);
    assert.deepEqual(small.indices, cropped(Buffer.from(fixture.output, "base64")));
  }
});

function rgba(indices: Uint8Array, palette: Uint8Array) {
  return Uint8ClampedArray.from({ length: indices.length * 4 }, (_, offset) => offset % 4 === 3 ? 255 : palette[indices[Math.floor(offset / 4)] * 3 + offset % 4]);
}

for (const entry of native.cases) test(`${entry.bank} timeline ${entry.fin.timeline} automatic Canvas adapter matches native RGBA`, () => {
  const children = parseFin(read(entry.fin.path)).timeline[entry.fin.timeline].children;
  const source = parseSprite(read(`raw_cd/DC/SPRITES/${children[0].sprite.toUpperCase()}.SPR`)).frames[children[0].frame];
  const sample = { children, timelineIndex: entry.fin.timeline, finished: false };
  const parts = composeFinSample(sample, () => ({ ...source, index: children[0].frame, x: 0, y: 0, empty: false }));
  const palette = readNativeGifPalette(read(entry.palette.gif.path));
  const remap = new RemapTable(read(entry.remap.path));
  const image = {} as CanvasImageSource;
  for (const fixture of entry.raster.frames) {
    const { width, height } = fixture.camera;
    const pixels = rgba(Buffer.from(fixture.before, "base64"), palette);
    const expected = rgba(Buffer.from(fixture.output, "base64"), palette);
    registerNativePaletteImage(image, { width: source.width, height: source.height, indices: source.indices,
      coverage: source.alpha, palette, remap, selector: fixture.selector });
    let state = { horizontal: 1, vertical: 1, x: 0, y: 0, clip: null as Set<number> | null };
    const stack: typeof state[] = [];
    let path = new Set<number>(), readbacks = 0, writes = 0, drawn = 0, readbackPixels = 0;
    const context = {
      globalAlpha: 1, globalCompositeOperation: "source-over",
      filter: "none", shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      getImageData(left: number, top: number, spanWidth: number, spanHeight: number) {
        readbacks++; readbackPixels += spanWidth * spanHeight;
        const data = new Uint8ClampedArray(spanWidth * spanHeight * 4);
        for (let row = 0; row < spanHeight; row++) data.set(pixels.subarray(((top + row) * width + left) * 4,
          ((top + row) * width + left + spanWidth) * 4), row * spanWidth * 4);
        return { width: spanWidth, height: spanHeight, data };
      },
      putImageData(data: ImageData, left: number, top: number) {
        writes++;
        for (let row = 0; row < data.height; row++) pixels.set(data.data.subarray(row * data.width * 4, (row + 1) * data.width * 4),
          ((top + row) * width + left) * 4);
      },
      save() { stack.push({ ...state }); }, restore() { state = stack.pop()!; },
      beginPath() { path = new Set(); },
      rect(left: number, top: number, spanWidth: number, spanHeight: number) {
        for (let row = top; row < top + spanHeight; row++) for (let column = left; column < left + spanWidth; column++) {
          if (row >= 0 && row < height && column >= 0 && column < width) path.add(row * width + column);
        }
      },
      clip() { state.clip = path; },
      translate(horizontal: number, vertical: number) { state.x += state.horizontal * horizontal; state.y += state.vertical * vertical; },
      scale(horizontal: number, vertical: number) { state.horizontal *= horizontal; state.vertical *= vertical; },
      drawImage(actualImage: CanvasImageSource) {
        drawn++; assert.equal(actualImage, image);
        for (let row = 0; row < source.height; row++) for (let column = 0; column < source.width; column++) {
          const offset = row * source.width + column;
          if (!source.alpha[offset]) continue;
          const targetX = Math.floor(state.x + state.horizontal * (column + 0.5));
          const targetY = Math.floor(state.y + state.vertical * (row + 0.5));
          const target = targetY * width + targetX;
          if (targetX < 0 || targetX >= width || targetY < 0 || targetY >= height || !state.clip?.has(target)) continue;
          const color = remap.lookup(2, 128 + fixture.selector, source.indices[offset]);
          pixels.set([palette[color * 3], palette[color * 3 + 1], palette[color * 3 + 2], 255], target * 4);
        }
      },
    } as unknown as CanvasRenderingContext2D;
    const frame = createMissionSceneFrame({ mission: { map, attributes: map.attributes, tileRecordIndices: pairs },
      indexed: { ...indexedMetadata, sourceForegroundCoverage: coverage }, camera: fixture.camera,
      entities: [{ rawSlot: 152, sample, parts, heightSubcells: 0,
        xSubcells: (fixture.queuedX - children[0].x) * 32,
        ySubcells: (map.height * 32 - 1 - fixture.baseline + children[0].y) * 32,
        fallbackOrigin: { x: 0, y: 0 } }] });
    frame.drawEntity(context, 152, () => image);
    assert.equal(frame.mode1Results.get("152:0")?.exact, true, JSON.stringify(frame.mode1Results.get("152:0")));
    assert.deepEqual(pixels, expected);
    assert.equal(drawn, 1); assert.equal(stack.length, 0);
    assert.ok(readbacks <= 1); assert.equal(writes, readbacks); assert.ok(readbackPixels <= 128 * 1024);
    assert.equal(frame.globalOrder, null); assert.equal(frame.orderingVerified, false);
    assert.ok(frame.diagnostics.some((diagnostic) => diagnostic.startsWith("native-global-order-unverified")));
  }
});

test("Canvas refusal is atomic for unknown colors, ambiguous aliases, alpha, transforms and unavailable readback", () => {
  const entry = native.cases[0];
  const fixture = entry.raster.frames.find((item: { before: string; shadow: string }) => item.before !== item.shadow);
  const children = parseFin(read(entry.fin.path)).timeline[entry.fin.timeline].children;
  const source = parseSprite(read(`raw_cd/DC/SPRITES/${children[0].sprite.toUpperCase()}.SPR`)).frames[children[0].frame];
  const part = composeFinSample({ children, timelineIndex: entry.fin.timeline, finished: false },
    () => ({ ...source, index: children[0].frame, x: 0, y: 0, empty: false }))[0];
  const image = {} as CanvasImageSource;
  const palette = new Uint8Array(768);
  const sourceInput = { part, sprite: { ...source, coverage: source.alpha }, terrain,
    position: { x: fixture.queuedX, y: fixture.baseline, heightOffset: 0 } };
  assert.throws(() => composeNativeMode1({ ...sourceInput, position: { ...sourceInput.position, x: 0.5 } }), /signed words/);
  assert.throws(() => composeNativeMode1({ ...sourceInput, position: { ...sourceInput.position, heightOffset: 1 } }), /Unsupported/);
  assert.throws(() => composeNativeMode1({ ...sourceInput, part: { ...part, child: { ...part.child, flags: 0 } } }), /Unsupported/);
  palette.set([255, 255, 255], 6); palette.set([255, 0, 0], 9);
  const bytes = new Uint8Array(196608);
  bytes[72 * 256] = 2; bytes[72 * 256 + 1] = 3;
  registerNativePaletteImage(image, { ...source, coverage: source.alpha, palette, remap: new RemapTable(bytes), selector: 0 });
  for (const variant of ["unknown", "aliases", "alpha", "transform", "readback"] as const) {
    let writes = 0;
    const context = {
      globalAlpha: 1, globalCompositeOperation: "source-over", filter: "none", shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
      getTransform: () => ({ a: variant === "transform" ? 2 : 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      getImageData(_left: number, _top: number, width: number, height: number) {
        if (variant === "readback") throw new Error("readback unavailable");
        const data = new Uint8ClampedArray(width * height * 4);
        for (let offset = 0; offset < data.length; offset += 4) {
          data[offset] = variant === "unknown" ? 1 : 0;
          data[offset + 3] = variant === "alpha" ? 0 : 255;
        }
        return { data, width, height };
      },
      putImageData() { writes++; },
    } as unknown as CanvasRenderingContext2D;
    const result = drawNativeMode1CanvasShadow({ context, image, part, terrain, camera: fixture.camera,
      position: { x: fixture.queuedX, y: fixture.baseline, heightOffset: 0 } });
    assert.ok(result.diagnostic?.startsWith("mode1-shadow-"));
    assert.equal(writes, 0, variant);
  }
});
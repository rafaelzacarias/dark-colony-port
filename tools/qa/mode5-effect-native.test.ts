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
import { composeNativeMode5, drawNativeMode5Indexed } from "../../src/render/mode5-effect.ts";
import { readNativeGifPalette, RemapTable } from "../../src/render/palette.ts";
import type { NativeIndexedSurface } from "../../src/render/mode1-shadow.ts";
import { drawNativeMode5Canvas, registerNativeEffectMission } from "../../src/render/mode5-canvas.ts";
import { nativePaletteImage } from "../../src/render/mode1-canvas.ts";
import { createMissionSceneFrame } from "../../src/render/mission-scene-frame.ts";
import { createMissionSpritePalettes } from "../../src/render/mission-sprites.ts";
import type { CampaignMissionData } from "../../src/game-data.ts";
import type { MissionIndexedTerrain } from "../../src/render/mission-terrain.ts";
import { composeSceneBodyMasks } from "../../src/render/scene-composition.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const actualSources = Boolean(process.env.DC_MODE5_SOURCE_TRACE) || process.env.DC_MODE5_SOURCE_EFFECTS === "1";
const trace = actualSources ? process.env.DC_MODE5_SOURCE_TRACE : process.env.DC_MODE5_TRACE;
const native = JSON.parse(trace ? readFileSync(trace, "utf8") :
  execFileSync("python3", [new URL("../research/mode5-effect-20260919.py", import.meta.url).pathname,
    ...(actualSources ? ["--source-effects"] : [])], {
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

test("mode5 original executable and unchanged FIN/SPR/MAP/GIF/RMP provenance", () => {
  assert.equal(native.sha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  assert.equal(createHash("sha256").update(read("raw_cd/DC/DC.EXE")).digest("hex"), native.sha256);
  assert.equal(native.runtimeInterceptions, 0);
  assert.equal(native.cases.length, actualSources ? 44 : 16);
  for (const entry of native.cases) {
    for (const source of [entry.fin, entry.remap, entry.gif, ...entry.raster.sources]) {
      assert.equal(createHash("sha256").update(read(source.path)).digest("hex"), source.sha256);
    }
    assert.equal(entry.raster.frames.length, 8);
    for (const fixture of entry.raster.frames) {
      assert.equal(fixture.calls[0], fixture.child.valueB ? "0x4627e4" : "0x462444");
      assert.ok(fixture.calls.includes("0x461090"));
      assert.ok(fixture.remapOffsets.every((offset: number) => offset >= 65536 && offset < 131072));
      if (actualSources) {
        assert.deepEqual(fixture.maskBypassAtDispatch, [0]);
        assert.equal(fixture.remapRestored, true);
      }
    }
    assert.ok(entry.raster.frames.some((fixture: { before: string; output: string }) => fixture.before !== fixture.output));
  }
});

if (actualSources) test("mode5 source preflight: unchanged layer1 masks match original caller before admission", () => {
  let frames = 0, occluded = 0;
  for (const entry of native.cases) {
    const children = [parseFin(read(entry.fin.path)).timeline[entry.fin.timeline].children[entry.childIndex]];
    const child = children[0];
    const allChildren = parseFin(read(entry.fin.path)).timeline[entry.fin.timeline].children;
    const ordinary = entry.admission.find((item: { name: string }) => item.name === "ordinary");
    assert.equal(ordinary.accepted, allChildren.length);
    assert.deepEqual(ordinary.queued.map((item: { position: number[] }) => item.position),
      allChildren.map(item => [48 + item.x, 4047 + item.y]));
    if (child.layer !== 1 || child.valueB !== 0) continue;
    const source = parseSprite(read(`raw_cd/DC/SPRITES/${child.sprite.toUpperCase()}.SPR`)).frames[child.frame];
    const part = composeFinSample({ children, timelineIndex: entry.fin.timeline, finished: false },
      () => ({ ...source, index: child.frame, x: 0, y: 0, empty: false }))[0];
    const bodyPart = { ...part, child: { ...child, valueA: 0 }, diagnostics: [] };
    const remap = new RemapTable(read(entry.remap.path));
    for (const fixture of entry.raster.frames) {
      const body = composeSceneBodyMasks({ terrain, sprites: [{ part: bodyPart,
        position: { x: fixture.queuedX, y: fixture.baseline, heightOffset: 0 } }] })[0];
      assert.ok(body.clips, body.diagnostics.join(","));
      const surface = { ...fixture.camera, indices: Buffer.from(fixture.before, "base64") };
      const pixels = body.clips.flatMap(span => Array.from({ length: span.width }, (_, column) => ({
        x: body.topLeft.x + span.x + column, y: body.topLeft.y + span.y,
        sourceOffset: span.y * source.width + span.x + column,
      }))).filter(pixel => source.alpha[pixel.sourceOffset]).map(pixel => ({
        x: pixel.x, y: pixel.y, sourceIndex: source.indices[pixel.sourceOffset],
      }));
      occluded += source.alpha.filter(value => value !== 0).length - pixels.length;
      drawNativeMode5Indexed(surface, { body, pixels }, remap);
      assert.deepEqual(surface.indices, Buffer.from(fixture.output, "base64"), `${entry.bank}:${entry.fin.timeline}`);
      frames++;
    }
  }
  assert.equal(frames, 96);
  assert.ok(occluded > 0, "Native golden must discriminate masked layer1 from an unmasked body");
  const vent = native.cases.find((entry: { fin: { path: string; timeline: number }; childIndex: number }) =>
    entry.fin.path.endsWith("VENT.FIN") && entry.fin.timeline === 19 && entry.childIndex === 2);
  assert.deepEqual(vent.raster.frames[0].child,
    { sprite: "glit", frame: 6, x: -54, y: 11, layer: 1, flags: 16, valueA: 5, valueB: 0 });
  assert.ok(vent.raster.frames.some((frame: { writers: { masked: number } }) => frame.writers.masked > 0));
  assert.deepEqual(native.excluded, [{ name: "VENT", timeline: 38, childIndex: 0,
    child: { sprite: "puff", frame: 18, x: -39, y: -17, layer: 2, flags: 16, valueA: 5, valueB: 0 } }]);
  for (const excluded of native.excluded) {
    const child = parseFin(read(`raw_cd/DC/ANIMATE/${excluded.name}.FIN`)).timeline[excluded.timeline].children[excluded.childIndex];
    assert.deepEqual(child, excluded.child);
    const source = parseSprite(read(`raw_cd/DC/SPRITES/${child.sprite.toUpperCase()}.SPR`)).frames[child.frame];
    const part = composeFinSample({ children: [child], timelineIndex: excluded.timeline, finished: false },
      () => ({ ...source, index: child.frame, x: 0, y: 0, empty: false }))[0];
    assert.throws(() => composeNativeMode5({ part, terrain, sprite: { ...source, coverage: source.alpha },
      position: { x: 1024, y: 1024, heightOffset: 0 } }), /Unsupported native mode5 source/);
  }
});

for (const entry of native.cases) test(`${entry.bank} ${entry.fin.path}:${entry.fin.timeline}:${entry.childIndex} ${entry.raster.frames[0].child.valueB ? "mirror rejection" : "exact mode5 framebuffer and crop"}`, () => {
  const children = [parseFin(read(entry.fin.path)).timeline[entry.fin.timeline].children[entry.childIndex]];
  const source = parseSprite(read(`raw_cd/DC/SPRITES/${children[0].sprite.toUpperCase()}.SPR`)).frames[children[0].frame];
  const sprite = { ...source, coverage: source.alpha };
  const part = composeFinSample({ children, timelineIndex: entry.fin.timeline, finished: false },
    () => ({ ...source, index: children[0].frame, x: 0, y: 0, empty: false }))[0];
  const remap = new RemapTable(read(entry.remap.path));
  for (const fixture of entry.raster.frames) {
    assert.deepEqual(children[0], fixture.child);
    if (part.mirrored) {
      assert.throws(() => composeNativeMode5({ part, sprite, terrain,
        position: { x: fixture.queuedX, y: fixture.baseline, heightOffset: 0 } }), /Unsupported native mode5/);
      continue;
    }
    const plan = composeNativeMode5({ part, sprite, terrain,
      position: { x: fixture.queuedX, y: fixture.baseline, heightOffset: 0 } });
    const surface: NativeIndexedSurface = { ...fixture.camera, indices: Buffer.from(fixture.before, "base64") };
    drawNativeMode5Indexed(surface, plan, remap);
    const expected = Buffer.from(fixture.output, "base64");
    const differences = Array.from(surface.indices.keys()).filter(offset => surface.indices[offset] !== expected[offset]);
    assert.equal(differences.length, 0, JSON.stringify({ fixture: fixture.camera, mirror: part.mirrored,
      reflection: fixture.reflection, phase: fixture.phase, differences: differences.slice(0, 12).map(offset => ({
        x: offset % surface.width, y: Math.floor(offset / surface.width), actual: surface.indices[offset], expected: expected[offset] })) }));
    const crop = { x: plan.body.topLeft.x + Math.floor(source.width / 2),
      y: plan.body.topLeft.y + Math.floor(source.height / 2), width: 7, height: 5 };
    const cropped = (data: Uint8Array) => Uint8Array.from({ length: crop.width * crop.height }, (_, offset) =>
      data[(crop.y - surface.y + Math.floor(offset / crop.width)) * surface.width + crop.x - surface.x + offset % crop.width]);
    const small = { ...crop, indices: cropped(Buffer.from(fixture.before, "base64")) };
    drawNativeMode5Indexed(small, plan, remap);
    assert.deepEqual(small.indices, cropped(expected));
  }
});

test("original bank1 writer executes all source/destination pairs including zero and ignores incoming brightness", () => {
  for (const name of ["DESERT", "JUNGLE", "ATLANTIS", "HTRAIN"]) {
    const proof = native.pixelProofs[name];
    assert.equal(proof.pairs, 65536);
    assert.deepEqual(Buffer.from(proof.output, "base64"), read(`raw_cd/DC/${name}.RMP`).subarray(65536, 131072));
  }
});

function rgba(indices: Uint8Array, palette: Uint8Array) {
  return Uint8ClampedArray.from({ length: indices.length * 4 }, (_, offset) =>
    offset % 4 === 3 ? 255 : palette[indices[Math.floor(offset / 4)] * 3 + offset % 4]);
}

function canvas(pixels: Uint8ClampedArray, width: number) {
  const counts = { reads: 0, writes: 0, drawn: 0, strokes: 0, readPixels: 0, depth: 0 };
  const context = {
    globalAlpha: 1, globalCompositeOperation: "source-over", filter: "none", shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    getImageData(left: number, top: number, spanWidth: number, spanHeight: number) {
      counts.reads++; counts.readPixels += spanWidth * spanHeight;
      const data = new Uint8ClampedArray(spanWidth * spanHeight * 4);
      for (let row = 0; row < spanHeight; row++) data.set(pixels.subarray(((top + row) * width + left) * 4,
        ((top + row) * width + left + spanWidth) * 4), row * spanWidth * 4);
      return { width: spanWidth, height: spanHeight, data };
    },
    putImageData(data: ImageData, left: number, top: number) {
      counts.writes++;
      for (let row = 0; row < data.height; row++) pixels.set(data.data.subarray(row * data.width * 4, (row + 1) * data.width * 4),
        ((top + row) * width + left) * 4);
    },
    save() { counts.depth++; }, restore() { counts.depth--; },
    translate() {}, scale() {}, drawImage() { counts.drawn++; }, strokeRect() { counts.strokes++; },
    beginPath() {}, rect() {}, clip() {}, moveTo() {}, lineTo() {}, stroke() {},
  } as unknown as CanvasRenderingContext2D;
  return { context, counts };
}

for (const name of ["DESERT", "JUNGLE", "ATLANTIS", "HTRAIN"]) test(`${name} published mission loader automatically renders native effects through existing frame adapter`, async context => {
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/indexed/"));
    return new Response(Uint8Array.from(read(`public${path}`)).buffer);
  });
  const mission = { map, attributes: map.attributes, tileRecordIndices: pairs,
    scenario: { terrainBank: `${name}.BTS`, rawHeader: ["", "0"], teams: Array.from({ length: 8 }, (_, index) => ({ index, teamColor: index })) },
  } as unknown as CampaignMissionData;
  const palettes = await createMissionSpritePalettes(mission, ["BEAC", "glit", "glat", "GLAT", "PUFF"]);
  assert.ok(palettes.indexedImage("glat", 0));
  assert.deepEqual(palettes.indexedImage("glat", 0), palettes.indexedImage("GLAT", 0));
  const png = {} as CanvasImageSource;
  assert.equal(nativePaletteImage(png), undefined);
  const indexed = { ...JSON.parse(read("public/assets/generated/indexed/terrain/DESERT.json").toString()),
    sourceForegroundCoverage: coverage } as MissionIndexedTerrain;
  try {
    for (const entry of native.cases.filter((item: { bank: string; raster: { frames: { child: { valueB: number } }[] } }) =>
      item.bank === name && item.raster.frames[0].child.valueB === 0)) {
      const children = [parseFin(read(entry.fin.path)).timeline[entry.fin.timeline].children[entry.childIndex]];
      const source = parseSprite(read(`raw_cd/DC/SPRITES/${children[0].sprite.toUpperCase()}.SPR`)).frames[children[0].frame];
      const metadata = JSON.parse(read(`public/assets/generated/sprites/SPRITES/${children[0].sprite.toUpperCase()}.json`).toString());
      const sample = { children, timelineIndex: entry.fin.timeline, finished: false };
      const parts = composeFinSample(sample, () => metadata.frames[children[0].frame]);
      const palette = readNativeGifPalette(read(entry.gif.path));
      for (const fixture of entry.raster.frames) {
        const pixels = rgba(Buffer.from(fixture.before, "base64"), palette);
        const drawing = canvas(pixels, fixture.camera.width);
        const frame = createMissionSceneFrame({ mission, indexed, camera: fixture.camera, entities: [{
          rawSlot: 152, sample, parts, heightSubcells: 0,
          xSubcells: (fixture.queuedX - children[0].x) * 32,
          ySubcells: (map.height * 32 - 1 - fixture.baseline + children[0].y) * 32,
          fallbackOrigin: { x: 0, y: 0 },
        }] });
        const unregistered = drawNativeMode5Canvas({ context: drawing.context, image: png, mission: { ...mission },
          part: parts[0], position: { x: fixture.queuedX, y: fixture.baseline, heightOffset: 0 }, terrain,
          camera: fixture.camera });
        assert.equal(unregistered.exact, false);
        if (!unregistered.exact) assert.equal(unregistered.diagnostic, "mode5-effect-indexed-source-required");
        assert.equal(drawing.counts.reads, 0);
        frame.drawEntity(drawing.context, 152, () => png);
        assert.equal(frame.mode5Results.get("152:0")?.exact, true, JSON.stringify(frame.mode5Results.get("152:0")));
        assert.deepEqual(pixels, rgba(Buffer.from(fixture.output, "base64"), palette));
        assert.equal(drawing.counts.drawn, 0); assert.equal(drawing.counts.strokes, 0); assert.equal(drawing.counts.depth, 0);
        assert.ok(drawing.counts.reads <= 1); assert.equal(drawing.counts.writes, drawing.counts.reads);
        assert.ok(drawing.counts.readPixels <= 128 * 1024);
        assert.equal(frame.commands[0].diagnostics.length, 0);
        assert.equal(frame.orderingVerified, false); assert.equal(frame.globalOrder, null);
        assert.ok(frame.diagnostics.some(issue => issue.startsWith("native-global-order-unverified")));
        assert.ok(source.alpha.some(value => value === 0));
        const crop = { x: fixture.queuedX + source.anchorX + Math.floor(source.width / 2),
          y: fixture.baseline - source.height + Math.floor(source.height / 2), width: 7, height: 5 };
        const cropped = (data: Uint8Array) => Uint8Array.from({ length: crop.width * crop.height }, (_, offset) =>
          data[(crop.y - fixture.camera.y + Math.floor(offset / crop.width)) * fixture.camera.width
            + crop.x - fixture.camera.x + offset % crop.width]);
        const cropPixels = rgba(cropped(Buffer.from(fixture.before, "base64")), palette);
        const cropDrawing = canvas(cropPixels, crop.width);
        const cropResult = drawNativeMode5Canvas({ context: cropDrawing.context, mission, part: parts[0],
          position: { x: fixture.queuedX, y: fixture.baseline, heightOffset: 0 }, terrain, camera: crop });
        assert.equal(cropResult.exact, true, JSON.stringify(cropResult));
        assert.deepEqual(cropPixels, rgba(cropped(Buffer.from(fixture.output, "base64")), palette));
        assert.ok(cropDrawing.counts.readPixels <= crop.width * crop.height);
      }
    }
  } finally { palettes.dispose(); }
});

test("CENT real source children resolve GLAT from the loader and preserve native admission", async context => {
  const sourceNative = JSON.parse(execFileSync("python3", [new URL("../research/mode5-effect-20260919.py", import.meta.url).pathname,
    "--source-effects"], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" } }));
  assert.equal(sourceNative.sha256, native.sha256);
  assert.equal(sourceNative.runtimeInterceptions, 0);
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/indexed/"));
    return new Response(Uint8Array.from(read(`public${path}`)).buffer);
  });
  const mission = { map, attributes: map.attributes, tileRecordIndices: pairs,
    scenario: { terrainBank: "DESERT.BTS", rawHeader: ["", "0"],
      teams: Array.from({ length: 8 }, (_, index) => ({ index, teamColor: index })) },
  } as unknown as CampaignMissionData;
  const palettes = await createMissionSpritePalettes(mission, ["cent", "glat"]);
  let exact = 0, rejected = 0;
  try {
    for (const entry of sourceNative.cases.filter((item: { bank: string; fin: { path: string } }) =>
      item.bank === "DESERT" && item.fin.path.endsWith("/CENT.FIN"))) {
      for (const source of [entry.fin, entry.remap, entry.gif, ...entry.raster.sources]) {
        assert.equal(createHash("sha256").update(read(source.path)).digest("hex"), source.sha256);
      }
      const child = parseFin(read(entry.fin.path)).timeline[entry.fin.timeline].children[entry.childIndex];
      assert.equal(child.sprite.toLowerCase(), "glat");
      const metadata = JSON.parse(read("public/assets/generated/sprites/SPRITES/GLAT.json").toString());
      const part = composeFinSample({ children: [child], timelineIndex: entry.fin.timeline, finished: false },
        () => metadata.frames[child.frame])[0];
      const palette = readNativeGifPalette(read(entry.gif.path));
      for (const fixture of entry.raster.frames) {
        assert.deepEqual(child, fixture.child);
        const pixels = rgba(Buffer.from(fixture.before, "base64"), palette), before = pixels.slice();
        const drawing = canvas(pixels, fixture.camera.width);
        const result = drawNativeMode5Canvas({ context: drawing.context, image: {} as CanvasImageSource, mission, part,
          position: { x: fixture.queuedX, y: fixture.baseline, heightOffset: 0 }, terrain, camera: fixture.camera });
        if (child.layer !== 0 || child.valueB !== 0) {
          assert.equal(result.exact, false);
          if (!result.exact) assert.equal(result.diagnostic, "mode5-effect-unverified:Unsupported native mode5 source");
          assert.deepEqual(pixels, before);
          assert.equal(drawing.counts.reads, 0);
          rejected++;
        } else {
          assert.equal(result.exact, true, JSON.stringify({ child, result }));
          assert.deepEqual(pixels, rgba(Buffer.from(fixture.output, "base64"), palette));
          exact++;
        }
      }
    }
    assert.ok(exact > 0);
    assert.ok(rejected > 0);
    context.diagnostic(`CENT source frames: ${exact} exact Canvas goldens; ${rejected} unsupported variants rejected`);
  } finally { palettes.dispose(); }
});

function tinyFixture(layer = 0) {
  const child = { sprite: "ZERO", frame: 0, x: 0, y: 0, layer, flags: 16, valueA: 5, valueB: 0 };
  const sample = { children: [child], timelineIndex: 0, finished: false };
  const part = composeFinSample(sample, () => ({ index: 0, x: 0, y: 0, width: 3, height: 1, anchorX: 0, anchorY: 0, empty: false }))[0];
  const palette = Uint8Array.from({ length: 768 }, (_, offset) => Math.floor(offset / 3));
  const table = new Uint8Array(196608);
  table[65536 + 7] = 0;
  table[65536 + 256 + 7] = 19;
  const sprite = { width: 3, height: 1, indices: Uint8Array.of(0, 1, 1), coverage: Uint8Array.of(255, 0, 255) };
  const remap = new RemapTable(table), mission = {};
  const unregister = registerNativeEffectMission(mission, { sources: new Map([["ZERO", sprite]]), palette, remap });
  return { mission, sprite, palette, table, remap, part, sample, unregister, position: { x: 2, y: 4, heightOffset: 0 },
    terrain: [{ kind: "terrain" as const, column: 0, row: 0, backgroundIndex: 0, foregroundIndex: 0, attributes: 0 }],
    camera: { x: 0, y: 0, width: 8, height: 8 } };
}

for (const layer of [0, 1]) test(`layer${layer} covered source zero produces opaque palette zero while a SPR hole preserves destination`, () => {
  const fixture = tinyFixture(layer);
  const pixels = rgba(new Uint8Array(64).fill(7), fixture.palette), drawing = canvas(pixels, 8);
  assert.equal(drawNativeMode5Canvas({ ...fixture, context: drawing.context }).exact, true);
  assert.deepEqual([...pixels.slice(26 * 4, 29 * 4)], [0, 0, 0, 255, 7, 7, 7, 255, 19, 19, 19, 255]);
  fixture.unregister();
  const disposed = drawNativeMode5Canvas({ ...fixture, context: drawing.context });
  assert.ok(!disposed.exact);
  assert.match(disposed.diagnostic, /indexed-source-required/);
});

for (const layer of [0, 1]) test(`layer${layer} mode5 Canvas rejection is atomic, including late unknown/translucent/ambiguous destination and budgets`, () => {
  for (const variant of ["unknown", "alpha", "alias", "transform", "readback", "budget", "mirror", "flags", "elevation", "frame"] as const) {
    const fixture = tinyFixture(layer);
    if (variant === "alias") {
      fixture.palette.set([7, 7, 7], 8 * 3);
      fixture.table[65536 + 256 + 8] = 20;
      registerNativeEffectMission(fixture.mission, { sources: new Map([["ZERO", fixture.sprite]]), palette: fixture.palette, remap: new RemapTable(fixture.table) });
    }
    const pixels = rgba(new Uint8Array(64).fill(7), fixture.palette);
    if (variant === "unknown") pixels.set([1, 2, 3, 255], 28 * 4);
    if (variant === "alpha") pixels[28 * 4 + 3] = 254;
    const before = pixels.slice(), drawing = canvas(pixels, 8);
    if (variant === "transform") drawing.context.globalAlpha = 0.5;
    if (variant === "readback") drawing.context.getImageData = () => { throw new Error("unavailable"); };
    const part = variant === "mirror" ? { ...fixture.part, mirrored: true, child: { ...fixture.part.child, valueB: 1 } }
      : variant === "flags" ? { ...fixture.part, child: { ...fixture.part.child, flags: 0 } }
      : variant === "frame" ? { ...fixture.part, frame: { ...fixture.part.frame!, width: 353 } } : fixture.part;
    const result = drawNativeMode5Canvas({ ...fixture, context: drawing.context, part,
      position: { ...fixture.position, heightOffset: variant === "elevation" ? 1 : 0 }, pixelBudget: variant === "budget" ? 2 : undefined });
    assert.equal(result.exact, false, variant); assert.equal(drawing.counts.writes, 0, variant);
    assert.deepEqual(pixels, before, variant);
    assert.equal(result.readbackPixels, ["unknown", "alpha", "alias", "readback"].includes(variant) ? 3 : 0, variant);
    fixture.unregister();
  }
});

for (const layer of [0, 1]) test(`layer${layer} frame adapter preserves whole-part fallback and reports runtime mode5 rejection`, () => {
  const fixture = tinyFixture(layer);
  const mission = { map: { width: 1, height: 1 }, attributes: new Uint16Array(1), tileRecordIndices: new Uint16Array(2) };
  const unregister = registerNativeEffectMission(mission, { sources: new Map([["ZERO", fixture.sprite]]), palette: fixture.palette, remap: fixture.remap });
  const pixels = rgba(new Uint8Array(64).fill(7), fixture.palette), drawing = canvas(pixels, 8);
  pixels.set([1, 2, 3, 255], 28 * 4);
  const before = pixels.slice();
  const frame = createMissionSceneFrame({ mission, indexed: undefined, camera: fixture.camera, entities: [{
    rawSlot: 152, sample: fixture.sample, parts: [fixture.part], heightSubcells: 0,
    xSubcells: 64, ySubcells: (32 - 1 - 4) * 32, fallbackOrigin: { x: 2, y: 4 },
  }] });
  frame.drawEntity(drawing.context, 152, () => ({} as CanvasImageSource));
  assert.equal(frame.mode5Results.get("152:0")?.exact, false);
  assert.equal(drawing.counts.writes, 0); assert.equal(drawing.counts.drawn, 1); assert.equal(drawing.counts.depth, 0);
  assert.deepEqual(pixels, before);
  assert.ok(frame.commands[0].diagnostics.includes("mode5-effect-destination-palette-unknown"));
  unregister(); fixture.unregister();
});

for (const layer of [0, 1]) for (const rejectDestination of [false, true]) test(`layer${layer} frame readback budget charges ${rejectDestination ? "rejected" : "accepted"} destinations cumulatively`, () => {
  const fixture = tinyFixture(layer);
  const mission = { map: { width: 16, height: 15 }, attributes: new Uint16Array(240), tileRecordIndices: new Uint16Array(480) };
  const sprite = { width: 352, height: 240, indices: new Uint8Array(352 * 240), coverage: new Uint8Array(352 * 240).fill(255) };
  const unregister = registerNativeEffectMission(mission, { sources: new Map([["ZERO", sprite]]), palette: fixture.palette, remap: fixture.remap });
  const children = [{ ...fixture.part.child }, { ...fixture.part.child }];
  const sample = { ...fixture.sample, children };
  const parts = composeFinSample(sample, () => ({ ...fixture.part.frame!, width: sprite.width, height: sprite.height }));
  const pixels = rgba(new Uint8Array(512 * 480).fill(7), fixture.palette), drawing = canvas(pixels, 512);
  if (rejectDestination) pixels.set([1, 2, 3, 255], (240 * 512 + 352) * 4);
  const before = pixels.slice();
  const frame = createMissionSceneFrame({ mission, indexed: undefined, camera: { x: 0, y: 0, width: 512, height: 480 }, entities: [{
    rawSlot: 152, sample, parts, heightSubcells: 0, xSubcells: 32, ySubcells: (480 - 1 - 241) * 32,
    fallbackOrigin: { x: 1, y: 241 },
  }] });
  frame.drawEntity(drawing.context, 152, () => ({} as CanvasImageSource));
  assert.equal(frame.mode5Results.get("152:0")?.exact, !rejectDestination);
  if (rejectDestination) {
    const rejected = frame.mode5Results.get("152:0")!;
    assert.ok(!rejected.exact);
    assert.equal(rejected.diagnostic, "mode5-effect-destination-palette-unknown");
    assert.deepEqual(pixels, before);
  }
  const refused = frame.mode5Results.get("152:1")!;
  assert.ok(!refused.exact);
  assert.equal(refused.diagnostic, "mode5-effect-readback-budget");
  assert.equal(drawing.counts.reads, 1); assert.equal(drawing.counts.writes, rejectDestination ? 0 : 1);
  assert.equal(drawing.counts.readPixels, 352 * 240); assert.equal(drawing.counts.drawn, rejectDestination ? 2 : 1);
  assert.deepEqual(frame.effectBudget, { mode3AllocatedPixels: 0, readbackPixels: 352 * 240, remainingPixels: 128 * 1024 - 352 * 240 });
  frame.drawEntity(drawing.context, 152, () => ({} as CanvasImageSource));
  assert.equal(drawing.counts.reads, 1);
  assert.ok(frame.commands.every(command => command.diagnostics.includes("mode5-effect-readback-budget")));
  unregister(); fixture.unregister();
});

for (const layer of [0, 1]) test(`layer${layer} mode3, unsupported layer, missing masks and malformed indexed plans stay atomic and outside mode5 admission`, () => {
  const fixture = tinyFixture(layer);
  for (const child of [{ ...fixture.part.child, valueA: 3 }, ...[-1, 2, 256, 257, 1.5].map(value => ({ ...fixture.part.child, layer: value }))]) {
    assert.throws(() => composeNativeMode5({ ...fixture, part: { ...fixture.part, child } }), /Unsupported/);
  }
  assert.throws(() => composeNativeMode5({ ...fixture, terrain: [{ ...fixture.terrain[0], foregroundIndex: 1, attributes: 15 }] }), /coverage/);
  const plan = composeNativeMode5(fixture);
  const surface = { ...fixture.camera, indices: new Uint8Array(64).fill(7) };
  assert.throws(() => drawNativeMode5Indexed(surface, { ...plan, pixels: [...plan.pixels, { x: 1, y: 1, sourceIndex: 256 }] }, fixture.remap), /pixel/);
  assert.ok(surface.indices.every(value => value === 7));
  fixture.unregister();
});

test("layer1 equivalent destination aliases commit once and indexed source registration remains mission-bound", () => {
  const fixture = tinyFixture(1);
  fixture.palette.set([7, 7, 7], 8 * 3);
  fixture.table[65536 + 256 + 8] = 19;
  const unregister = registerNativeEffectMission(fixture.mission, {
    sources: new Map([["ZERO", fixture.sprite]]), palette: fixture.palette, remap: new RemapTable(fixture.table),
  });
  const pixels = rgba(new Uint8Array(64).fill(7), fixture.palette), drawing = canvas(pixels, 8);
  const unregistered = drawNativeMode5Canvas({ ...fixture, mission: {}, context: drawing.context });
  assert.deepEqual(unregistered, { exact: false, diagnostic: "mode5-effect-indexed-source-required", readbackPixels: 0 });
  assert.equal(drawing.counts.reads, 0);
  const result = drawNativeMode5Canvas({ ...fixture, context: drawing.context });
  assert.deepEqual(result, { exact: true, readbackPixels: 3 });
  assert.equal(drawing.counts.reads, 1); assert.equal(drawing.counts.writes, 1);
  assert.deepEqual([...pixels.slice(26 * 4, 29 * 4)], [0, 0, 0, 255, 7, 7, 7, 255, 19, 19, 19, 255]);
  unregister(); fixture.unregister();
});

test("layer1 missing foreground coverage rejects before readback and offscreen effects do not read", () => {
  const fixture = tinyFixture(1);
  const pixels = rgba(new Uint8Array(64).fill(7), fixture.palette), drawing = canvas(pixels, 8);
  const missing = drawNativeMode5Canvas({ ...fixture, context: drawing.context,
    terrain: [{ ...fixture.terrain[0], foregroundIndex: 1, attributes: 15 }] });
  assert.ok(!missing.exact);
  assert.match(missing.diagnostic, /scene-missing-foreground-coverage/);
  assert.equal(missing.readbackPixels, 0);
  assert.equal(drawing.counts.reads, 0); assert.equal(drawing.counts.writes, 0);
  assert.deepEqual(drawNativeMode5Canvas({ ...fixture, context: drawing.context,
    camera: { ...fixture.camera, x: 16 } }), { exact: true, readbackPixels: 0 });
  assert.equal(drawing.counts.reads, 0); assert.equal(drawing.counts.writes, 0);
  fixture.unregister();
});
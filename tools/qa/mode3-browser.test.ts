import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compareMode3BrowserPixels, loadMode3BrowserSource, mode3BrowserLabel, prepareMode3BrowserScene, renderMode3BrowserPass } from "./fixtures/mode3-browser";
import { loadCampaignMission, type CampaignMissionData } from "../../src/game-data";
import { MissionView, type MissionViewMode3Frame } from "../../src/mission-view";
import { createMissionMode3Terrain, withMissionTerrainCoverage } from "../../src/render/mission-terrain";
import { createMissionSpritePalettes, remapSpritePixels } from "../../src/render/mission-sprites";
import { registerNativePaletteImage } from "../../src/render/mode1-canvas";
import { canvas as pixelCanvas, rgba } from "./mode2-test-helpers";

const root = new URL("../../public/assets/generated/indexed/", import.meta.url);
const mission = { map: { width: 64, height: 64 } } as CampaignMissionData;

test("mode3 browser authenticates all four source atlases and retains unchanged native-fit VENT19 children", async context => {
  context.mock.method(globalThis, "fetch", async (url: string) => new Response(Uint8Array.from(readFileSync(
    new URL(url.replace("/assets/generated/indexed/", ""), root)))));
  const source = await loadMode3BrowserSource(), before = JSON.stringify(source.animation);
  const prepared = prepareMode3BrowserScene(mission, source);
  assert.equal(prepared.entity.sample.children, source.animation.timeline[19].children);
  assert.equal(prepared.entity.parts.length, 4);
  assert.equal(source.verified.length, 13);
  assert.deepEqual(prepared.queue.map(entry => entry.sourceChildIndex), [0, 1, 2, 3]);
  for (const child of prepared.entity.sample.children) assert.equal(prepared.entity.parts.filter(part => part.child === child).length, 1);
  assert.ok(prepared.frames.every(frame => frame.coverage.some(Boolean)));
  assert.deepEqual(prepared.camera, { x: 480, y: 192, width: 320, height: 256 });
  assert.ok(prepared.camera.width * prepared.camera.height <= 128 * 1024);
  assert.equal(JSON.stringify(source.animation), before);
  assert.match(mode3BrowserLabel, /not original world queue/);
  const changed = structuredClone(source);
  Object.assign(changed.animation.timeline[19].children[0], { x: changed.animation.timeline[19].children[0].x + 1 });
  assert.throws(() => prepareMode3BrowserScene(mission, changed), /unchanged VENT/);
});

test("mode3 browser rejects modified manifest, FIN, sprite indices and coverage", async context => {
  let corrupt = "";
  context.mock.method(globalThis, "fetch", async (url: string) => {
    const path = url.replace("/assets/generated/indexed/", "");
    const bytes = Uint8Array.from(readFileSync(new URL(path, root)));
    if (path === corrupt) bytes[0] ^= 1;
    return new Response(bytes);
  });
  for (const path of ["index.json", "animations/VENT.json", "sprites/SPRITES/VENT2.json",
    "sprites/SPRITES/PUFF.indices.r8", "sprites/SPRITES/GLIT.coverage.r8", "sprites/SPRITES/SMSP.indices.r8"]) {
    corrupt = path;
    await assert.rejects(loadMode3BrowserSource(), /checksum mismatch|hash mismatch/);
  }
});

test("mode3 comparison requires changed native pixels to survive final body composition", () => {
  const baseline = new Uint8ClampedArray([1, 2, 3, 255, 1, 2, 3, 255]);
  const lit = new Uint8ClampedArray([4, 5, 6, 255, 4, 5, 6, 255]);
  assert.deepEqual(compareMode3BrowserPixels(baseline, lit, baseline, lit), {
    changedPixels: 2, nativePlaneChangedPixels: 2, visibleNativePositivePixels: 2,
  });
  const covered = new Uint8ClampedArray([7, 8, 9, 255, 7, 8, 9, 255]);
  assert.equal(compareMode3BrowserPixels(baseline, covered, baseline, lit).visibleNativePositivePixels, 0);
  assert.equal(compareMode3BrowserPixels(covered, lit, baseline, lit).visibleNativePositivePixels, 0);
  assert.throws(() => compareMode3BrowserPixels(baseline, lit.slice(4), baseline, lit), /RGBA planes/);
});

test("mode3 fixture pass uses actual loaded HUMAN01 MissionView, native terrain and complete source composition without state mutation", async context => {
  context.mock.method(console, "warn", () => {});
  const assets = new URL("../../public/", import.meta.url);
  context.mock.method(globalThis, "fetch", async (url: string) => new Response(Uint8Array.from(readFileSync(new URL(url.replace(/^\//, ""), assets)))));
  const loaded = await loadCampaignMission("human"), source = await loadMode3BrowserSource();
  const prepared = prepareMode3BrowserScene(loaded, source);
  const palettes = await createMissionSpritePalettes(loaded, [...source.sprites.keys()]);
  const read = (path: string) => Uint8Array.from(readFileSync(new URL(path, root)));
  const metadata = JSON.parse(new TextDecoder().decode(read("terrain/DESERT.json")));
  const atlas = read(metadata.indices.path), palette = palettes.indexedImage("VENT2", 0)!;
  const terrain = createMissionMode3Terrain(loaded, withMissionTerrainCoverage(metadata, atlas), atlas, palette.palette, palette.remap);
  const { width, height } = prepared.camera;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const surface = pixelCanvas(pixels, width);
  let drawingState = { x: 0, y: 0, clip: null as number[][] | null }, path: number[][] = [];
  const stack: typeof drawingState[] = [];
  const art = new Map<CanvasImageSource, { width: number; rgba: Uint8ClampedArray }>();
  const names = new Map<CanvasImageSource, string>();
  const images = new Map<string, CanvasImageSource>();
  for (const [name] of source.sprites) {
    const indexed = palettes.indexedImage(name, 0)!;
    const image = {} as CanvasImageSource;
    registerNativePaletteImage(image, indexed);
    const colors = name === "VENT2" ? remapSpritePixels(indexed.indices, indexed.coverage, indexed.remap, indexed.palette, indexed.selector)
      : rgba(indexed.indices, indexed.palette);
    for (let pixel = 0; pixel < indexed.coverage.length; pixel++) if (!indexed.coverage[pixel]) colors[pixel * 4 + 3] = 0;
    art.set(image, { width: indexed.width, rgba: colors });
    images.set(name, image); names.set(image, name);
  }
  Object.assign(surface.context, {
    createImageData: (spanWidth: number, spanHeight: number) => ({ width: spanWidth, height: spanHeight, data: new Uint8ClampedArray(spanWidth * spanHeight * 4) }),
    save() { stack.push({ ...drawingState }); }, restore() { drawingState = stack.pop()!; },
    translate(horizontal: number, vertical: number) { drawingState.x += horizontal; drawingState.y += vertical; },
    scale(horizontal: number, vertical: number) { assert.equal(horizontal, 1); assert.equal(vertical, 1); },
    beginPath() { path = []; }, rect(...bounds: number[]) { path.push(bounds); }, clip() { drawingState.clip = path; },
    strokeRect() {}, moveTo() {}, lineTo() {}, stroke() {},
    drawImage(image: CanvasImageSource, sourceX: number, sourceY: number, spanWidth: number, spanHeight: number,
      left: number, top: number, targetWidth: number, targetHeight: number) {
      assert.equal(spanWidth, targetWidth); assert.equal(spanHeight, targetHeight);
      const sprite = art.get(image)!;
      for (let row = 0; row < spanHeight; row++) for (let column = 0; column < spanWidth; column++) {
        const destinationX = drawingState.x + left + column, destinationY = drawingState.y + top + row;
        if (destinationX < 0 || destinationY < 0 || destinationX >= width || destinationY >= height) continue;
        if (drawingState.clip && !drawingState.clip.some(([clipX, clipY, clipWidth, clipHeight]) => destinationX >= clipX
          && destinationY >= clipY && destinationX < clipX + clipWidth && destinationY < clipY + clipHeight)) continue;
        const offset = ((sourceY + row) * sprite.width + sourceX + column) * 4;
        if (sprite.rgba[offset + 3]) pixels.set(sprite.rgba.subarray(offset, offset + 4), (destinationY * width + destinationX) * 4);
      }
    },
  });
  const canvas = { width, height, getContext: () => surface.context } as unknown as HTMLCanvasElement;
  Object.assign(surface.context, { canvas });
  const view = new MissionView(canvas, {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, loaded);
  const before = view.checkpoint(), simulationBefore = view.simulation.checkpoint();
  const initial = new Uint8Array(width * height).fill(128);
  const input: MissionViewMode3Frame = { terrain, surface: { ...prepared.camera, indices: initial }, enabled: false,
    queue: prepared.queue, capture: () => [prepared.entity], sprite: body => prepared.frames.find(frame => frame.child === body.part.child),
    image: name => images.get(name.toUpperCase()) };
  try {
    const baseline = renderMode3BrowserPass(view, input, names), baselineRgba = pixels.slice();
    const enabled = renderMode3BrowserPass(view, { ...input, enabled: true }, names), finalRgba = pixels.slice();
    assert.ok(baseline.native.exact); assert.ok(enabled.native.exact);
    for (const pass of [baseline, enabled]) {
      assert.ok(pass.native.exact);
      assert.equal(pass.native.scope, "bounded-terrain-prepass");
      assert.equal(pass.native.frame.commands.length, 4);
      assert.equal(pass.counts.snapshots, 1); assert.equal(pass.counts.captures, 1);
      assert.equal(pass.counts.preTerrainReads, 0);
      assert.equal(pass.counts.mode3SpriteCalls, 0);
      assert.equal(pass.counts.sourceBodyCalls, 1);
      assert.equal(pass.events[0], "terrain-publication");
      assert.equal(pass.native.frame.effectBudget.mode3AllocatedPixels, width * height);
      assert.equal(pass.native.frame.effectBudget.readbackPixels, pass.counts.readPixels);
      assert.ok(pass.native.frame.effectBudget.remainingPixels >= 0);
      assert.ok(pass.native.owned.has("0:3"));
      assert.equal(pass.native.frame.orderingVerified, false);
      assert.equal(pass.native.frame.mode5Results.size, 2);
      for (const result of pass.native.frame.mode5Results.values()) {
        if (!result.exact) assert.ok(pass.native.frame.commands.some(command => command.diagnostics.includes(result.diagnostic)));
      }
    }
    const comparison = compareMode3BrowserPixels(baselineRgba, finalRgba, baseline.native.output.rgba, enabled.native.output.rgba);
    assert.ok(comparison.visibleNativePositivePixels > 0, JSON.stringify(comparison));
    assert.ok(enabled.native.illumination.indices.some(value => value !== 128));
    assert.deepEqual(enabled.native.output.terrainIndices, baseline.native.output.terrainIndices);
    const reset = renderMode3BrowserPass(view, input, names);
    assert.ok(reset.native.exact);
    assert.deepEqual(pixels, baselineRgba);
    assert.ok(initial.every(value => value === 128));
    assert.deepEqual(view.checkpoint(), before);
    assert.deepEqual(view.simulation.checkpoint(), simulationBefore);
    assert.equal(Object.hasOwn(view.simulation, "snapshot"), false);
    context.diagnostic(`Software contract only: ${comparison.visibleNativePositivePixels} native-positive final pixels; actual browser screenshot pending`);
    context.diagnostic(`Mode5 outcomes: ${JSON.stringify(Object.fromEntries(enabled.native.frame.mode5Results))}`);
  } finally { view.dispose(); palettes.dispose(); }
});
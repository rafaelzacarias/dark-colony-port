import assert from "node:assert/strict";
import test from "node:test";
import { composeFinSample } from "../../src/render/fin-composition.ts";
import { registerNativePaletteImage } from "../../src/render/mode1-canvas.ts";
import { drawNativeMode2Canvas, registerNativeMode2Mission } from "../../src/render/mode2-canvas.ts";
import { composeNativeMode2, drawNativeMode2Indexed } from "../../src/render/mode2-shadow.ts";
import { RemapTable } from "../../src/render/palette.ts";
import { canvas, rgba } from "./mode2-test-helpers.ts";

function fixture() {
  const child = { sprite: "ZERO", frame: 0, x: 0, y: 0, layer: 0, flags: 16, valueA: 2, valueB: 0 };
  const part = composeFinSample({ children: [child], timelineIndex: 0, finished: false },
    () => ({ index: 0, x: 0, y: 0, width: 3, height: 1, anchorX: 0, anchorY: 0, empty: false }))[0];
  const palette = Uint8Array.from({ length: 768 }, (_, offset) => Math.floor(offset / 3));
  const table = new Uint8Array(196608);
  table[72 * 256 + 7] = 19;
  const sprite = { width: 3, height: 1, indices: Uint8Array.of(0, 1, 255), coverage: Uint8Array.of(255, 0, 255) };
  const remap = new RemapTable(table), mission = {};
  const data = { sources: new Map([["ZERO", sprite]]), palette, remap };
  const dispose = registerNativeMode2Mission(mission, data);
  const pixels = rgba(new Uint8Array(32 * 32).fill(7), palette);
  return { part, palette, table, sprite, remap, mission, data, dispose, pixels, ...canvas(pixels, 32),
    position: { x: 10, y: 10, heightOffset: 0 }, camera: { x: 0, y: 0, width: 32, height: 32 },
    terrain: [{ kind: "terrain" as const, column: 0, row: 0, backgroundIndex: 0, foregroundIndex: 0, attributes: 0 }] };
}

test("mode2 covered index zero shadows opaquely, SPR holes remain unchanged, source colors never copy", () => {
  const input = fixture();
  assert.equal(drawNativeMode2Canvas(input).exact, true);
  assert.deepEqual([...input.pixels.slice((9 * 32 + 10) * 4, (9 * 32 + 13) * 4)],
    [19, 19, 19, 255, 7, 7, 7, 255, 19, 19, 19, 255]);
  assert.deepEqual(input.counts, { reads: 1, writes: 1, readPixels: 3 });
  input.dispose();
  assert.equal(drawNativeMode2Canvas(input).exact, false);
});

test("mode2 consumes existing registered indexed image metadata and atlas frame offsets", () => {
  const input = fixture(), image = {} as CanvasImageSource;
  const indices = new Uint8Array(15), coverage = new Uint8Array(15);
  indices.set(input.sprite.indices, 6); coverage.set(input.sprite.coverage, 6);
  registerNativePaletteImage(image, { width: 5, height: 3, indices, coverage, palette: input.palette, remap: input.remap, selector: 7 });
  input.dispose();
  const part = { ...input.part, frame: { ...input.part.frame!, x: 1, y: 1 } };
  assert.equal(drawNativeMode2Canvas({ ...input, image, part }).exact, true);
  assert.equal(input.pixels[(9 * 32 + 10) * 4], 19);
});

test("mode2 palette aliases are accepted only when every alias has the same output RGB", () => {
  const input = fixture();
  input.palette.set([7, 7, 7], 8 * 3);
  input.palette.set([19, 19, 19], 20 * 3);
  input.table[72 * 256 + 8] = 20;
  registerNativeMode2Mission(input.mission, { ...input.data, remap: new RemapTable(input.table) });
  assert.equal(drawNativeMode2Canvas(input).exact, true);
});

for (const variant of ["unknown", "alpha", "alias", "transform", "filter", "shadow", "composite", "readback", "invalid-readback",
  "budget", "invalid-budget", "flags", "elevation", "mode", "layer", "frame", "viewport", "top-clip", "left-clip", "right-clip", "missing-mask"] as const) {
  test(`mode2 ${variant} fallback is atomic`, () => {
    const input = fixture();
    if (variant === "alias") {
      input.palette.set([7, 7, 7], 8 * 3);
      input.table[72 * 256 + 8] = 20;
      registerNativeMode2Mission(input.mission, { ...input.data, remap: new RemapTable(input.table) });
    }
    if (variant === "unknown") input.pixels.set([1, 2, 3, 255], (9 * 32 + 12) * 4);
    if (variant === "alpha") input.pixels[(9 * 32 + 12) * 4 + 3] = 254;
    if (variant === "transform") input.context.getTransform = () => ({ a: 2, b: 0, c: 0, d: 1, e: 0, f: 0 } as DOMMatrix);
    if (variant === "filter") input.context.filter = "blur(1px)";
    if (variant === "shadow") input.context.shadowOffsetX = 1;
    if (variant === "composite") input.context.globalCompositeOperation = "multiply";
    if (variant === "readback") input.context.getImageData = () => { throw new Error("unavailable"); };
    if (variant === "invalid-readback") input.context.getImageData = () => ({ width: 3, height: 1, data: new Uint8ClampedArray(4) } as ImageData);
    const child = { ...input.part.child, flags: variant === "flags" ? 0 : 16,
      valueA: variant === "mode" ? 5 : 2, layer: variant === "layer" ? 2 : 0 };
    const part = { ...input.part, child,
      frame: variant === "frame" ? { ...input.part.frame!, width: 353 } : input.part.frame };
    const before = input.pixels.slice();
    const result = drawNativeMode2Canvas({ ...input, part,
      pixelBudget: variant === "budget" ? 2 : variant === "invalid-budget" ? 131073 : undefined,
      camera: variant === "viewport" ? { ...input.camera, x: 1 } : input.camera,
      position: { x: variant === "left-clip" ? -1 : variant === "right-clip" ? 30 : 10,
        y: variant === "top-clip" ? 0 : 10, heightOffset: variant === "elevation" ? 1 : 0 },
      terrain: variant === "missing-mask" ? [{ ...input.terrain[0], foregroundIndex: 1, attributes: 15 }] : input.terrain });
    assert.equal(result.exact, false); assert.equal(input.counts.writes, 0); assert.deepEqual(input.pixels, before);
    if (variant === "unknown" || variant === "alpha" || variant === "alias" || variant === "readback") assert.equal(result.readbackPixels, 3);
  });
}

test("mode2 native bottom viewport row is preserved and an empty plan performs no readback", () => {
  const input = fixture(), before = input.pixels.slice();
  assert.equal(drawNativeMode2Canvas({ ...input, camera: { ...input.camera, height: 10 } }).exact, true);
  assert.deepEqual(input.pixels, before); assert.equal(input.counts.reads, 0);
});

test("mode2 stale registration cleanup cannot remove newer mission data", () => {
  const input = fixture();
  const dispose = registerNativeMode2Mission(input.mission, { ...input.data });
  input.dispose();
  assert.equal(drawNativeMode2Canvas(input).exact, true);
  dispose();
  assert.equal(drawNativeMode2Canvas(input).exact, false);
});

test("mode2 indexed malformed plans and surfaces reject without partial writes", () => {
  const input = fixture(), plan = composeNativeMode2(input);
  const surface = { ...input.camera, indices: new Uint8Array(1024).fill(7) };
  assert.throws(() => drawNativeMode2Indexed(surface, { ...plan, shadow: [...plan.shadow, { x: NaN, y: 4 }] }, input.remap), /pixel/);
  assert.ok(surface.indices.every(value => value === 7));
  assert.throws(() => drawNativeMode2Indexed({ ...surface, width: 1 }, plan, input.remap), /surface/);
});
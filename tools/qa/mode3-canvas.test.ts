import assert from "node:assert/strict";
import test from "node:test";
import { composeFinSample } from "../../src/render/fin-composition.ts";
import { registerNativePaletteImage } from "../../src/render/mode1-canvas.ts";
import { drawNativeMode3Canvas, registerNativeMode3Mission } from "../../src/render/mode3-canvas.ts";
import { composeNativeMode3, drawNativeMode3Indexed } from "../../src/render/mode3-effect.ts";
import { RemapTable } from "../../src/render/palette.ts";

function fixture() {
  const child = { sprite: "TEST", frame: 0, x: 0, y: 0, layer: 1, flags: 16, valueA: 3, valueB: 0 };
  const frame = { index: 0, x: 0, y: 0, width: 4, height: 1, anchorX: 0, anchorY: 0, empty: false };
  const part = composeFinSample({ children: [child], timelineIndex: 0, finished: false }, () => frame)[0];
  const sprite = { width: 4, height: 1, indices: Uint8Array.of(0, 16, 8, 16), coverage: Uint8Array.of(255, 255, 0, 255) };
  const palette = Uint8Array.from({ length: 768 }, (_, offset) => Math.floor(offset / 3));
  const table = Uint8Array.from({ length: 196608 }, (_, offset) => offset & 255);
  table[144 * 256 + 7] = 19;
  const remap = new RemapTable(table), mission = {};
  const registration = { sources: new Map([["TEST", sprite]]), palette, remap };
  const dispose = registerNativeMode3Mission(mission, registration);
  const filters = { x: 0, y: 0, width: 32, height: 8, indices: new Uint8Array(256).fill(128) };
  const terrain = [{ kind: "terrain" as const, column: 0, row: 0, backgroundIndex: 0, foregroundIndex: 1,
    attributes: 32, foregroundMask: new Uint32Array(32).fill(0xffffffff) }];
  const pixels = new Uint8ClampedArray(256 * 4);
  for (let index = 0; index < 256; index++) pixels.set([7, 7, 7, 255], index * 4);
  const counts = { reads: 0, writes: 0, readPixels: 0 };
  const context = {
    globalAlpha: 1, globalCompositeOperation: "source-over", filter: "none", shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    getImageData(left: number, top: number, width: number, height: number) {
      counts.reads++; counts.readPixels += width * height;
      const data = new Uint8ClampedArray(width * height * 4);
      for (let row = 0; row < height; row++) data.set(pixels.subarray(((top + row) * 32 + left) * 4,
        ((top + row) * 32 + left + width) * 4), row * width * 4);
      return { width, height, data };
    },
    putImageData(data: ImageData, left: number, top: number) {
      counts.writes++;
      for (let row = 0; row < data.height; row++) pixels.set(data.data.subarray(row * data.width * 4, (row + 1) * data.width * 4),
        ((top + row) * 32 + left) * 4);
    },
  } as unknown as CanvasRenderingContext2D;
  return { part, sprite, palette, table, remap, mission, registration, dispose, filters, terrain, context, pixels, counts,
    enabled: true, position: { x: 2, y: 4, heightOffset: 0 } };
}

test("mode3 Canvas commits RGB and filter plane together, covered zero and holes stay distinct", () => {
  const input = fixture();
  input.filters.indices[98] = 131;
  const result = drawNativeMode3Canvas(input);
  assert.deepEqual(result, { exact: true, readbackPixels: 4 });
  assert.deepEqual([...input.filters.indices.slice(98, 102)], [128, 144, 128, 144]);
  assert.deepEqual([...input.pixels.slice(98 * 4, 102 * 4)], [7, 7, 7, 255, 19, 19, 19, 255, 7, 7, 7, 255, 19, 19, 19, 255]);
  assert.equal(input.counts.writes, 1);
  input.dispose();
});

test("mode3 registered image shares indexed metadata, including nonzero atlas origin and disposal", () => {
  const input = fixture();
  input.dispose();
  assert.equal(drawNativeMode3Canvas(input).exact, false);
  const image = {} as CanvasImageSource;
  const indices = new Uint8Array(18), coverage = new Uint8Array(18);
  indices.set(input.sprite.indices, 7); coverage.set(input.sprite.coverage, 7);
  registerNativePaletteImage(image, { width: 6, height: 3, indices, coverage, palette: input.palette, remap: input.remap, selector: 7 });
  const part = { ...input.part, frame: { ...input.part.frame!, x: 1, y: 1 } };
  assert.equal(drawNativeMode3Canvas({ ...input, image, part }).exact, true);
  assert.equal(input.filters.indices[99], 144);
  const obsolete = registerNativeMode3Mission(input.mission, input.registration);
  registerNativeMode3Mission(input.mission, { ...input.registration });
  obsolete();
  assert.equal(drawNativeMode3Canvas({ ...input, enabled: false }).exact, true);
});

test("mode3 Canvas late rejection leaves RGB and filters unchanged", () => {
  for (const variant of ["unknown", "alpha", "alias", "transform", "blend", "filter", "shadow", "readback", "shape", "budget", "flags", "elevated", "top", "side", "missing", "frame"] as const) {
    const input = fixture();
    if (variant === "unknown") input.pixels.set([1, 2, 3, 255], 101 * 4);
    if (variant === "alpha") input.pixels[101 * 4 + 3] = 254;
    if (variant === "alias") {
      input.palette.set([7, 7, 7], 8 * 3);
      input.table[144 * 256 + 8] = 20;
      input.registration.remap = new RemapTable(input.table);
    }
    if (variant === "transform") input.context.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 1, f: 0 } as DOMMatrix);
    if (variant === "blend") input.context.globalAlpha = 0.5;
    if (variant === "filter") input.context.filter = "blur(1px)";
    if (variant === "shadow") input.context.shadowOffsetX = 1;
    if (variant === "readback") input.context.getImageData = () => { throw new Error("tainted"); };
    if (variant === "shape") input.context.getImageData = () => ({ width: 1, height: 1, data: new Uint8ClampedArray(0) } as ImageData);
    const part = variant === "flags" ? { ...input.part, child: { ...input.part.child, flags: 0 } }
      : variant === "frame" ? { ...input.part, frame: { ...input.part.frame!, width: 353 } } : input.part;
    const pixels = input.pixels.slice(), filters = input.filters.indices.slice();
    const result = drawNativeMode3Canvas({ ...input, part, terrain: variant === "missing" ? [] : input.terrain,
      position: { x: variant === "side" ? 29 : 2, y: variant === "top" ? 0 : 4, heightOffset: variant === "elevated" ? 1 : 0 },
      pixelBudget: variant === "budget" ? 2 : undefined });
    assert.equal(result.exact, false, variant);
    assert.equal(input.counts.writes, 0, variant);
    assert.deepEqual(input.pixels, pixels, variant);
    assert.deepEqual(input.filters.indices, filters, variant);
    input.dispose();
  }
});

test("mode3 alias equivalence is RGB-based; explicit terrain indices disambiguate safely", () => {
  for (const explicit of [false, true]) {
    const input = fixture();
    input.palette.set([7, 7, 7], 8 * 3);
    input.table[144 * 256 + 8] = 20;
    if (!explicit) input.palette.set([19, 19, 19], 20 * 3);
    input.registration.remap = new RemapTable(input.table);
    const terrainIndices = explicit ? new Uint8Array(256).fill(7) : undefined;
    assert.equal(drawNativeMode3Canvas({ ...input, terrainIndices }).exact, true);
    assert.deepEqual([...input.pixels.slice(99 * 4, 99 * 4 + 4)], [19, 19, 19, 255]);
    input.dispose();
  }
});

test("mode3 disabled and invisible odd filter updates require no readback", () => {
  const input = fixture();
  assert.equal(drawNativeMode3Canvas({ ...input, enabled: false, pixelBudget: 0 }).exact, true);
  assert.equal(input.counts.reads, 0);
  const terrain = [{ ...input.terrain[0], attributes: 0 }];
  assert.equal(drawNativeMode3Canvas({ ...input, terrain, pixelBudget: 0 }).exact, true);
  assert.equal(input.counts.reads, 0);
  assert.equal(input.filters.indices[99], 144);
  input.dispose();
});

test("mode3 indexed invalid late pixels and aliased planes reject atomically", () => {
  const input = fixture();
  const plan = composeNativeMode3(input);
  const surface = { ...input.filters, indices: new Uint8Array(256).fill(7) };
  const terrainIndices = surface.indices.slice(), filters = input.filters.indices;
  const invalid = { ...plan, pixels: [...plan.pixels, { x: 3, y: 3, sourceIndex: 256 }] };
  assert.throws(() => drawNativeMode3Indexed({ surface, filters, terrainIndices, plan: invalid, remap: input.remap }), /pixel/);
  assert.ok(surface.indices.every(value => value === 7));
  assert.ok(filters.every(value => value === 128));
  assert.throws(() => drawNativeMode3Indexed({ surface, filters: surface.indices, terrainIndices, plan, remap: input.remap }), /planes/);
  input.dispose();
});
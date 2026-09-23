import assert from "node:assert/strict";
import test from "node:test";
import { RemapTable, RMP_TABLE_BYTES, lookupPaletteColor } from "../../src/render/palette.js";
import {
  INDEXED_TEXTURE_LAYOUT, IndexedWebGLRenderer, IndexedWebGLUnavailableError,
  lookupIndexedPixel, prepareIndexedUpload, preparePaletteUpload, resolvePaletteLookup,
  type PaletteLookup,
} from "../../src/render/indexed-webgl.js";

const remapBytes = Uint8Array.from({ length: RMP_TABLE_BYTES }, (_, offset) =>
  ((offset >>> 16) * 71 + ((offset >>> 8) & 255) * 13 + (offset & 255)) & 255);
const palette = Uint8Array.from({ length: 768 }, (_, offset) => (offset * 43 + 17) & 255);
const remap = new RemapTable(remapBytes);
const tables = preparePaletteUpload({ remap, palette });

test("upload layouts preserve all RMP bank/row/index addresses and RGB8 components", () => {
  assert.deepEqual(INDEXED_TEXTURE_LAYOUT.remap, {
    internalFormat: "R8UI", format: "RED_INTEGER", channels: 1, width: 256, height: 768,
  });
  assert.deepEqual(INDEXED_TEXTURE_LAYOUT.palette, {
    internalFormat: "RGB8UI", format: "RGB_INTEGER", channels: 3, width: 256, height: 1,
  });
  assert.equal(INDEXED_TEXTURE_LAYOUT.indices.internalFormat, "R8UI");
  assert.equal(INDEXED_TEXTURE_LAYOUT.coverage.internalFormat, "R8UI");
  const source = prepareIndexedUpload({
    width: 256, height: 1, indices: Uint8Array.from({ length: 256 }, (_, index) => index),
    coverage: { mode: "opaque" },
  });
  for (const bank of [0, 1, 2] as const) {
    for (let row = 0; row < 256; row++) {
      const lookup: PaletteLookup = bank === 1 ? { bank, row }
        : { bank, brightness: row >>> 3, selector: row & 7 };
      assert.deepEqual(resolvePaletteLookup(lookup), { bank, row });
      for (let index = 0; index < 256; index++) {
        const expected = remap.lookup(bank, row, index);
        assert.equal(tables.remap[(bank * 256 + row) * 256 + index], expected);
        assert.deepEqual(lookupIndexedPixel(source, tables, lookup, index, 0, false),
          [...lookupPaletteColor(palette, expected), 255]);
      }
    }
  }
});

test("source coverage is independent of remapped zero and mask values are binary", () => {
  const localRemap = new Uint8Array(RMP_TABLE_BYTES);
  localRemap[0] = 7;
  const localTables = preparePaletteUpload({ remap: new RemapTable(localRemap), palette });
  const base = { width: 2, height: 1, indices: Uint8Array.of(0, 9) };
  const lookup = { bank: 0, brightness: 0, selector: 0 } as const;
  const opaque = prepareIndexedUpload({ ...base, coverage: { mode: "opaque" } });
  const sprite = prepareIndexedUpload({ ...base, coverage: { mode: "source-zero" } });
  const masked = prepareIndexedUpload({ ...base, coverage: { mode: "mask", bytes: Uint8Array.of(1, 0) } });
  assert.deepEqual(lookupIndexedPixel(opaque, localTables, lookup, 0, 0, false), [...lookupPaletteColor(palette, 7), 255]);
  assert.deepEqual(lookupIndexedPixel(sprite, localTables, lookup, 0, 0, false), [0, 0, 0, 0]);
  assert.deepEqual(lookupIndexedPixel(sprite, localTables, lookup, 1, 0, false), [...lookupPaletteColor(palette, 0), 255]);
  assert.deepEqual(masked.coverage, Uint8Array.of(255, 0));
  assert.equal(lookupIndexedPixel(masked, localTables, lookup, 0, 0, false)[3], 255);
  assert.equal(lookupIndexedPixel(masked, localTables, lookup, 1, 0, false)[3], 0);
});

test("independent horizontal mirrors move source-order masks and never reverse rows", () => {
  const background = prepareIndexedUpload({
    width: 3, height: 2, indices: Uint8Array.of(1, 2, 3, 4, 5, 6), coverage: { mode: "opaque" },
  });
  const foreground = prepareIndexedUpload({
    width: 3, height: 2, indices: Uint8Array.of(7, 8, 9, 10, 11, 12),
    coverage: { mode: "mask", bytes: Uint8Array.of(0, 1, 1, 1, 0, 0) },
  });
  const lookup = { bank: 2, brightness: 16, selector: 6 } as const;
  for (const backgroundMirror of [false, true]) {
    for (const foregroundMirror of [false, true]) {
      for (let row = 0; row < 2; row++) {
        for (let column = 0; column < 3; column++) {
          const back = lookupIndexedPixel(background, tables, lookup, column, row, backgroundMirror);
          const front = lookupIndexedPixel(foreground, tables, lookup, column, row, foregroundMirror);
          const frontOffset = row * 3 + (foregroundMirror ? 2 - column : column);
          const backOffset = row * 3 + (backgroundMirror ? 2 - column : column);
          const index = foreground.coverage[frontOffset] ? foreground.indices[frontOffset] : background.indices[backOffset];
          assert.deepEqual(front[3] ? front : back, [...lookupPaletteColor(palette, remap.lookup(2, 134, index)), 255]);
        }
      }
    }
  }
});

test("uploads own their bytes without palette endpoint overrides or index translation", () => {
  const indices = Uint8Array.of(0, 255);
  const mask = Uint8Array.of(2, 255);
  const source = prepareIndexedUpload({ width: 2, height: 1, indices, coverage: { mode: "mask", bytes: mask } });
  const colors = Uint8Array.from(palette);
  const upload = preparePaletteUpload({ remap, palette: colors });
  indices.fill(99);
  mask.fill(0);
  colors.fill(0);
  assert.deepEqual(source.indices, Uint8Array.of(0, 255));
  assert.deepEqual(source.coverage, Uint8Array.of(255, 255));
  assert.deepEqual(upload.palette, palette);
  upload.remap.fill(0);
  assert.equal(remap.lookup(2, 255, 255), remapBytes[RMP_TABLE_BYTES - 1]);
});

test("malformed data and implicit or out-of-range palette selectors are rejected", () => {
  for (const invalid of [-1, 1.5, NaN, Infinity, 32]) {
    assert.throws(() => resolvePaletteLookup({ bank: 2, brightness: invalid, selector: 0 }), RangeError);
  }
  for (const invalid of [-1, 1.5, NaN, Infinity, 8, undefined]) {
    assert.throws(() => resolvePaletteLookup({ bank: 0, brightness: 16, selector: invalid as number }), RangeError);
  }
  assert.throws(() => resolvePaletteLookup({ bank: 3 } as unknown as PaletteLookup), RangeError);
  assert.throws(() => resolvePaletteLookup({ bank: 1, row: 256 }), RangeError);
  assert.throws(() => preparePaletteUpload({ remap, palette: new Uint8Array(767) }), RangeError);
  const source = { width: 2, height: 1, indices: Uint8Array.of(0, 1), coverage: { mode: "opaque" } } as const;
  for (const invalid of [0, -1, 1.5, NaN, Infinity, 16385]) {
    assert.throws(() => prepareIndexedUpload({ ...source, width: invalid }), RangeError);
  }
  assert.throws(() => prepareIndexedUpload({ ...source, indices: new Uint8Array(1) }), RangeError);
  assert.throws(() => prepareIndexedUpload({ ...source, coverage: { mode: "mask", bytes: new Uint8Array(1) } }), RangeError);
});

test("unsupported WebGL2 rejects construction so the owner can choose fallback", () => {
  const canvas = { getContext: (kind: string) => { assert.equal(kind, "webgl2"); return null; } };
  assert.throws(() => new IndexedWebGLRenderer(canvas as unknown as HTMLCanvasElement, { remap, palette }),
    IndexedWebGLUnavailableError);
});
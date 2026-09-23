import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import {
  RGB_TABLE_BYTES, RMP_BANK_BYTES, RMP_TABLE_BYTES,
  RemapTable, RgbLookupTable, lightingRow, translatePaletteIndex,
  readNativeGifPalette, lookupPaletteColor,
} from "../../src/render/palette.js";

const sourceRoot = fileURLToPath(new URL("../../raw_cd/DC/", import.meta.url));

function sourceFiles(directory: string, extension: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path, extension) : entry.name.endsWith(extension) ? [path] : [];
  });
}

test("RGB quantization is red-major RGB555, including low-bit truncation", () => {
  const bytes = Uint8Array.from({ length: RGB_TABLE_BYTES }, (_, index) =>
    ((index >>> 10) * 17 + ((index >>> 5) & 31) * 7 + (index & 31) * 3) & 255);
  const table = new RgbLookupTable(bytes);
  for (let red = 0; red < 32; red++) {
    for (let green = 0; green < 32; green++) {
      for (let blue = 0; blue < 32; blue++) {
        const expected = bytes[red * 1024 + green * 32 + blue];
        assert.equal(table.lookup(red * 8, green * 8, blue * 8), expected);
        assert.equal(table.lookup(red * 8 + 7, green * 8 + 7, blue * 8 + 7), expected);
      }
    }
  }
});

test("RMP has three byte banks, row-major indexing, and explicit lighting selectors", () => {
  const bytes = Uint8Array.from({ length: RMP_TABLE_BYTES }, (_, index) =>
    ((index >>> 16) * 71 + ((index >>> 8) & 255) * 13 + (index & 255)) & 255);
  const table = new RemapTable(bytes);
  for (const bank of [0, 1, 2] as const) {
    for (let brightness = 0; brightness < 32; brightness++) {
      for (let variant = 0; variant < 8; variant++) {
        const row = lightingRow(brightness, variant);
        for (let sourceIndex = 0; sourceIndex < 256; sourceIndex++) {
          assert.equal(table.lookup(bank, row, sourceIndex), bytes[bank * RMP_BANK_BYTES + row * 256 + sourceIndex]);
        }
      }
    }
  }
});

test("parsers own their bytes and reject invalid tables and selectors", () => {
  const rgb = new Uint8Array(RGB_TABLE_BYTES);
  const rmp = new Uint8Array(RMP_TABLE_BYTES);
  const rgbTable = new RgbLookupTable(rgb);
  const remap = new RemapTable(rmp);
  rgb.fill(123);
  rmp.fill(123);
  rgbTable.toTextureBytes().fill(99);
  remap.toTextureBytes().fill(99);
  assert.equal(rgbTable.lookup(0, 0, 0), 0);
  assert.equal(remap.lookup(0, 0, 0), 0);
  for (const invalid of [-1, 256, 1.5, NaN, Infinity]) {
    assert.throws(() => rgbTable.lookup(invalid, 0, 0), RangeError);
    assert.throws(() => rgbTable.lookup(0, invalid, 0), RangeError);
    assert.throws(() => rgbTable.lookup(0, 0, invalid), RangeError);
    assert.throws(() => remap.lookup(0, invalid, 0), RangeError);
    assert.throws(() => remap.lookup(0, 0, invalid), RangeError);
  }
  assert.throws(() => lightingRow(32, 0), RangeError);
  assert.throws(() => lightingRow(16, 8), RangeError);
  assert.throws(() => remap.lookup(3 as 0, 0, 0), RangeError);
  for (const length of [0, RGB_TABLE_BYTES - 1, RGB_TABLE_BYTES + 1]) {
    assert.throws(() => new RgbLookupTable(new Uint8Array(length)), RangeError);
  }
  for (const length of [0, 67584, RMP_TABLE_BYTES - 1, RMP_TABLE_BYTES + 1]) {
    assert.throws(() => new RemapTable(new Uint8Array(length)), RangeError);
  }
});

test("RGB file indices can be translated separately from RMP output indices", () => {
  const indexMap = Uint8Array.from({ length: 256 }, (_, index) => 255 - index);
  assert.equal(translatePaletteIndex(0, indexMap), 255);
  assert.equal(translatePaletteIndex(255, indexMap), 0);
  assert.throws(() => translatePaletteIndex(1, new Uint8Array(255)), RangeError);
  assert.throws(() => translatePaletteIndex(-1, indexMap), RangeError);
});

test("native GIF palette uses RGB8 and forces only black/white endpoints", () => {
  const bytes = readFileSync(join(sourceRoot, "PALETTE.GIF"));
  const palette = readNativeGifPalette(bytes);
  assert.equal(palette.length, 768);
  assert.deepEqual(lookupPaletteColor(palette, 0), [0, 0, 0]);
  assert.deepEqual(lookupPaletteColor(palette, 255), [255, 255, 255]);
  assert.deepEqual(palette.subarray(3, 765), Uint8Array.from(bytes.subarray(16, 778)));
  const modified = Buffer.from(bytes);
  modified.fill(17, 13, 16);
  modified.fill(19, 778, 781);
  assert.deepEqual(readNativeGifPalette(modified), palette);
  modified[10] &= 0x7f;
  assert.throws(() => readNativeGifPalette(modified), RangeError);
  assert.throws(() => readNativeGifPalette(bytes.subarray(0, 780)), RangeError);
  assert.throws(() => readNativeGifPalette(new Uint8Array(781)), RangeError);
  assert.throws(() => lookupPaletteColor(palette, 256), RangeError);
  assert.throws(() => lookupPaletteColor(new Uint8Array(767), 0), RangeError);
});

test("every source RGB and supported RMP preserves every byte in shader layout", () => {
  const rgbFiles = sourceFiles(sourceRoot, ".RGB");
  const rmpFiles = sourceFiles(sourceRoot, ".RMP");
  assert.ok(rgbFiles.length >= 21);
  assert.ok(rmpFiles.length >= 21);
  for (const path of rgbFiles) {
    const bytes = readFileSync(path);
    const table = new RgbLookupTable(bytes);
    assert.deepEqual(table.toTextureBytes(), Uint8Array.from(bytes));
    for (let index = 0; index < RGB_TABLE_BYTES; index++) {
      assert.equal(table.lookup((index >>> 10) * 8, ((index >>> 5) & 31) * 8, (index & 31) * 8), bytes[index]);
    }
  }
  for (const path of rmpFiles) {
    const bytes = readFileSync(path);
    if (path === join(sourceRoot, "SCENARIO/MPLAYER/PALETTE.RMP")) {
      assert.equal(bytes.length, 67584);
      assert.throws(() => new RemapTable(bytes), RangeError);
      continue;
    }
    const table = new RemapTable(bytes);
    assert.deepEqual(table.toTextureBytes(), Uint8Array.from(bytes));
    for (const bank of [0, 1, 2] as const) {
      for (let row = 0; row < 256; row++) {
        for (let index = 0; index < 256; index++) {
          assert.equal(table.lookup(bank, row, index), bytes[bank * RMP_BANK_BYTES + row * 256 + index]);
        }
      }
    }
  }
});
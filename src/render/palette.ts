export const RGB_TABLE_BYTES = 32 * 32 * 32;
export const RMP_BANK_BYTES = 256 * 256;
export const RMP_TABLE_BYTES = 3 * RMP_BANK_BYTES;

export type RemapBank = 0 | 1 | 2;

function integerInRange(value: number, maximum: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${label} must be an integer in 0..${maximum}`);
  }
}

function copyTable(bytes: Uint8Array, length: number, label: string): Uint8Array {
  if (bytes.length !== length) {
    throw new RangeError(`${label} must contain exactly ${length} bytes; got ${bytes.length}`);
  }
  return Uint8Array.from(bytes);
}

export class RgbLookupTable {
  readonly #bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.#bytes = copyTable(bytes, RGB_TABLE_BYTES, "RGB table");
  }

  lookup(red: number, green: number, blue: number): number {
    integerInRange(red, 255, "red");
    integerInRange(green, 255, "green");
    integerInRange(blue, 255, "blue");
    return this.#bytes[((red >>> 3) << 10) | ((green >>> 3) << 5) | (blue >>> 3)];
  }

  toTextureBytes(): Uint8Array {
    return Uint8Array.from(this.#bytes);
  }
}

export class RemapTable {
  readonly #bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.#bytes = copyTable(bytes, RMP_TABLE_BYTES, "RMP table");
  }

  lookup(bank: RemapBank, row: number, sourceIndex: number): number {
    integerInRange(bank, 2, "bank");
    integerInRange(row, 255, "row");
    integerInRange(sourceIndex, 255, "source index");
    return this.#bytes[bank * RMP_BANK_BYTES + row * 256 + sourceIndex];
  }

  toTextureBytes(): Uint8Array {
    return Uint8Array.from(this.#bytes);
  }
}

export function lightingRow(brightness: number, variant: number): number {
  integerInRange(brightness, 31, "brightness");
  integerInRange(variant, 7, "variant");
  return brightness * 8 + variant;
}

export function translatePaletteIndex(index: number, indexMap: Uint8Array): number {
  integerInRange(index, 255, "palette index");
  if (indexMap.length !== 256) throw new RangeError("Index map must contain 256 bytes");
  return indexMap[index];
}

export function readNativeGifPalette(bytes: Uint8Array): Uint8Array {
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  if (signature !== "GIF87a" && signature !== "GIF89a") {
    throw new RangeError("Expected GIF87a or GIF89a palette source");
  }
  if (bytes.length < 13 || (bytes[10] & 0x87) !== 0x87) {
    throw new RangeError("Expected a 256-entry GIF global color table");
  }
  if (bytes.length < 13 + 768) throw new RangeError("Truncated GIF global color table");
  const palette = Uint8Array.from(bytes.subarray(13, 13 + 768));
  palette.fill(0, 0, 3);
  palette.fill(255, 765, 768);
  return palette;
}

export function lookupPaletteColor(palette: Uint8Array, index: number): readonly [number, number, number] {
  if (palette.length !== 768) throw new RangeError("RGB8 palette must contain 768 bytes");
  integerInRange(index, 255, "palette index");
  const offset = index * 3;
  return [palette[offset], palette[offset + 1], palette[offset + 2]];
}
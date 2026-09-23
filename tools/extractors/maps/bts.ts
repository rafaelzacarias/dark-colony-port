const BTS_HEADER_BYTES = 8;
const BTS_PALETTE_BYTES = 256 * 3;
const BTS_TILE_SIZE = 32;
const BTS_TILE_PIXELS = BTS_TILE_SIZE * BTS_TILE_SIZE;
const BTS_TILE_RECORD_BYTES = 4 + BTS_TILE_PIXELS;

export const BTS_DATA_OFFSET = BTS_HEADER_BYTES + BTS_PALETTE_BYTES;

export interface TerrainColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

export interface TerrainTile {
  readonly key: number;
  readonly indices: Uint8Array;
}

export interface TerrainBank {
  readonly keySpace: number;
  readonly palette: readonly TerrainColor[];
  readonly paletteScale: "6-bit" | "8-bit";
  readonly tiles: readonly TerrainTile[];
}

export class TerrainBankFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerrainBankFormatError";
  }
}

export interface MissingTerrainKey {
  readonly key: number;
  readonly backgroundCount: number;
  readonly foregroundCount: number;
}

export function resolveTerrainReferences(bank: TerrainBank, references: Uint16Array): {
  readonly recordIndices: Uint16Array;
  readonly missingKeys: readonly MissingTerrainKey[];
} {
  if (references.length % 2 !== 0) throw new TerrainBankFormatError("terrain references must be pairs");
  if (bank.tiles.length > 0x10000) throw new TerrainBankFormatError("too many BTS records for u16 indices");
  const lookup = new Uint16Array(bank.keySpace);
  const keys = new Set<number>();
  bank.tiles.forEach((tile, index) => {
    lookup[tile.key] = index;
    keys.add(tile.key);
  });
  const missing = new Map<number, { key: number; backgroundCount: number; foregroundCount: number }>();
  const recordIndices = references.map((key, index) => {
    if (key >= bank.keySpace) {
      throw new TerrainBankFormatError(`MAP key ${key} exceeds BTS key space ${bank.keySpace}`);
    }
    if (key !== 0 && !keys.has(key)) {
      const counts = missing.get(key) ?? { key, backgroundCount: 0, foregroundCount: 0 };
      if (index % 2 === 0) counts.backgroundCount += 1;
      else counts.foregroundCount += 1;
      missing.set(key, counts);
    }
    return lookup[key];
  });
  return { recordIndices, missingKeys: [...missing.values()].sort((left, right) => left.key - right.key) };
}

export function parseTerrainBank(source: Uint8Array): TerrainBank {
  const buffer = Buffer.from(source.buffer, source.byteOffset, source.byteLength);
  if (buffer.length < BTS_DATA_OFFSET) {
    throw new TerrainBankFormatError("BTS header and palette are truncated");
  }

  const keySpace = buffer.readUInt32LE(0);
  const tileCount = buffer.readUInt32LE(4);
  if (keySpace === 0 || tileCount === 0) {
    throw new TerrainBankFormatError(`invalid BTS counts: keySpace=${keySpace}, tiles=${tileCount}`);
  }
  const expectedBytes = BTS_DATA_OFFSET + tileCount * BTS_TILE_RECORD_BYTES;
  if (buffer.length !== expectedBytes) {
    throw new TerrainBankFormatError(
      `BTS size ${buffer.length} does not match ${tileCount} tile records (${expectedBytes})`,
    );
  }

  const palette: TerrainColor[] = [];
  let sixBit = true;
  for (let index = 0; index < 256; index += 1) {
    const offset = BTS_HEADER_BYTES + index * 3;
    const color = { red: buffer[offset], green: buffer[offset + 1], blue: buffer[offset + 2] };
    if (color.red > 0x3f || color.green > 0x3f || color.blue > 0x3f) sixBit = false;
    palette.push(color);
  }

  const keys = new Set<number>();
  const tiles = Array.from({ length: tileCount }, (_, index): TerrainTile => {
    const offset = BTS_DATA_OFFSET + index * BTS_TILE_RECORD_BYTES;
    const key = buffer.readUInt32LE(offset);
    if (key >= keySpace) {
      throw new TerrainBankFormatError(`tile ${index} key ${key} exceeds key space ${keySpace}`);
    }
    if (keys.has(key)) throw new TerrainBankFormatError(`duplicate BTS tile key ${key}`);
    keys.add(key);
    return {
      key,
      indices: Uint8Array.from(buffer.subarray(offset + 4, offset + BTS_TILE_RECORD_BYTES)),
    };
  });

  return { keySpace, palette, paletteScale: sixBit ? "6-bit" : "8-bit", tiles };
}

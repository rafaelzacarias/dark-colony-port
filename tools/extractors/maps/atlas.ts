import type { TerrainBank } from "./bts";

export interface TerrainAtlasTile {
  readonly key: number;
  readonly recordIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: 32;
  readonly height: 32;
}

export interface TerrainAtlas {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  readonly tiles: readonly TerrainAtlasTile[];
}

export function createTerrainAtlas(bank: TerrainBank, columns = 32): TerrainAtlas {
  if (!Number.isInteger(columns) || columns <= 0) {
    throw new RangeError("terrain atlas columns must be a positive integer");
  }
  const rows = Math.ceil(bank.tiles.length / columns);
  const width = columns * 32;
  const height = Math.max(1, rows * 32);
  const rgba = new Uint8Array(width * height * 4);
  const sixBit = bank.paletteScale === "6-bit";
  const scale = (value: number) => (sixBit ? Math.round((value * 255) / 63) : value);
  const tiles: TerrainAtlasTile[] = [];

  bank.tiles.forEach((tile, index) => {
    const x = (index % columns) * 32;
    const y = Math.floor(index / columns) * 32;
    tiles.push({ key: tile.key, recordIndex: index, x, y, width: 32, height: 32 });
    for (let pixel = 0; pixel < tile.indices.length; pixel += 1) {
      const paletteIndex = tile.indices[pixel];
      const color = bank.palette[paletteIndex];
      const output = ((y + Math.floor(pixel / 32)) * width + x + (pixel % 32)) * 4;
      rgba[output] = scale(color.red);
      rgba[output + 1] = scale(color.green);
      rgba[output + 2] = scale(color.blue);
      rgba[output + 3] = paletteIndex === 0 ? 0 : 0xff;
    }
  });

  return { width, height, rgba, tiles };
}

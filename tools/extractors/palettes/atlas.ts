import { createTerrainAtlas } from "../maps/atlas";
import type { TerrainBank } from "../maps/bts";
import { createSpriteAtlas, type SpriteAtlasOptions } from "../sprites/atlas";
import type { SpriteArchive } from "../sprites/spr";

function copyRows(
  target: Uint8Array, width: number, source: Uint8Array,
  rectangle: { x: number; y: number; width: number; height: number },
): void {
  for (let row = 0; row < rectangle.height; row += 1) {
    target.set(source.subarray(row * rectangle.width, (row + 1) * rectangle.width),
      (rectangle.y + row) * width + rectangle.x);
  }
}

export function createIndexedSpriteAtlas(archive: SpriteArchive, options: SpriteAtlasOptions = {}) {
  const { width, height, frames } = createSpriteAtlas(archive, options);
  const indices = new Uint8Array(width * height);
  const coverage = new Uint8Array(width * height);
  for (const placement of frames) {
    if (placement.empty) continue;
    const frame = archive.frames[placement.index];
    copyRows(indices, width, frame.indices, placement);
    copyRows(coverage, width, frame.alpha, placement);
  }
  return { width, height, frames, indices, coverage };
}

export function createIndexedTerrainAtlas(bank: TerrainBank, columns = 32) {
  const { width, height, tiles } = createTerrainAtlas(bank, columns);
  const indices = new Uint8Array(width * height);
  const backgroundCoverage = new Uint8Array(width * height);
  const foregroundCoverage = new Uint8Array(width * height);
  const opaqueTile = new Uint8Array(1024).fill(255);
  const keyToRecord = new Array<number>(bank.keySpace).fill(0);
  for (const placement of tiles) {
    const tile = bank.tiles[placement.recordIndex];
    copyRows(indices, width, tile.indices, placement);
    copyRows(backgroundCoverage, width, opaqueTile, placement);
    copyRows(foregroundCoverage, width, tile.indices.map((value) => value === 0 ? 0 : 255), placement);
    keyToRecord[tile.key] = placement.recordIndex;
  }
  return { width, height, tiles, indices, backgroundCoverage, foregroundCoverage, keyToRecord };
}
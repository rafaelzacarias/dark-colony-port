export interface TerrainTileRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function terrainLayerMirrored(attributes: number, layer: 0 | 1): boolean {
  return (attributes & (layer === 0 ? 0x20 : 0x40)) !== 0;
}

export function drawTerrainLayer(
  context: CanvasRenderingContext2D,
  atlas: CanvasImageSource,
  tile: TerrainTileRect,
  destination: TerrainTileRect,
  attributes: number,
  layer: 0 | 1,
): void {
  if (!terrainLayerMirrored(attributes, layer)) {
    context.drawImage(atlas, tile.x, tile.y, tile.width, tile.height,
      destination.x, destination.y, destination.width, destination.height);
    return;
  }
  context.save();
  try {
    context.translate(destination.x + destination.width, destination.y);
    context.scale(-1, 1);
    context.drawImage(atlas, tile.x, tile.y, tile.width, tile.height,
      0, 0, destination.width, destination.height);
  } finally {
    context.restore();
  }
}
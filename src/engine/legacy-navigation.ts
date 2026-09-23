export interface LegacyNavigationSource {
  readonly width: number;
  readonly height: number;
  readonly pathGrid: Uint8Array;
}

export function createLegacyInfantryFamilyMask(source: LegacyNavigationSource): Uint8Array {
  const { width, height, pathGrid } = source;
  if (!Number.isInteger(width) || !Number.isInteger(height)
    || width <= 0 || height <= 0 || width > 255 || height > 255) {
    throw new RangeError(`invalid legacy navigation dimensions ${width}x${height}`);
  }
  if (pathGrid.length !== width * height) {
    throw new RangeError(`family grid needs ${width * height} entries; received ${pathGrid.length}`);
  }
  return Uint8Array.from(pathGrid, (family) => Number(family !== 0 && family !== 255));
}
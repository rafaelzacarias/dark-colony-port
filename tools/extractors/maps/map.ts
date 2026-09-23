const MAP_HEADER_BYTES = 8;
const MAP_REFERENCES_PER_CELL = 2;
const MTG_HEADER_BYTES = 2;
const PTH_PREAMBLE_BYTES = 65_536;
const MAX_MAP_CELLS = 1_000_000;

export interface MapData {
  readonly width: number;
  readonly height: number;
  readonly tileReferences: Uint16Array;
  readonly attributes: Uint16Array;
}

export interface MapCompanions {
  readonly tagGrid: Uint8Array;
  readonly pathPreamble: Uint8Array;
  readonly pathGrid: Uint8Array;
}

export interface MapBundle extends MapData, MapCompanions {}

export class MapFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MapFormatError";
  }
}

function mapArea(width: number, height: number): number {
  if (width === 0 || height === 0) {
    throw new MapFormatError(`invalid map dimensions ${width}x${height}`);
  }
  const area = width * height;
  if (!Number.isSafeInteger(area) || area > MAX_MAP_CELLS) {
    throw new MapFormatError(`map dimensions are too large: ${width}x${height}`);
  }
  return area;
}

export function parseMap(source: Uint8Array): MapData {
  const buffer = Buffer.from(source.buffer, source.byteOffset, source.byteLength);
  if (buffer.length < MAP_HEADER_BYTES) throw new MapFormatError("MAP header is truncated");
  const width = buffer.readUInt32LE(0);
  const height = buffer.readUInt32LE(4);
  const area = mapArea(width, height);
  const expectedBytes = MAP_HEADER_BYTES + area * (MAP_REFERENCES_PER_CELL + 1) * 2;
  if (buffer.length !== expectedBytes) {
    throw new MapFormatError(`MAP size ${buffer.length} does not match ${width}x${height} (${expectedBytes})`);
  }

  const tileReferences = new Uint16Array(area * MAP_REFERENCES_PER_CELL);
  for (let index = 0; index < tileReferences.length; index += 1) {
    tileReferences[index] = buffer.readUInt16LE(MAP_HEADER_BYTES + index * 2);
  }
  const attributes = new Uint16Array(area);
  const attributesOffset = MAP_HEADER_BYTES + tileReferences.length * 2;
  for (let index = 0; index < area; index += 1) {
    attributes[index] = buffer.readUInt16LE(attributesOffset + index * 2);
  }
  return { width, height, tileReferences, attributes };
}

export function mapCellIndex(map: Pick<MapData, "width" | "height">, x: number, y: number): number {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= map.width || y >= map.height) {
    throw new RangeError(`map coordinate is out of bounds: ${x},${y}`);
  }
  return y * map.width + x;
}

export function mapCellReferences(map: MapData, x: number, y: number): readonly [number, number] {
  const offset = mapCellIndex(map, x, y) * MAP_REFERENCES_PER_CELL;
  return [
    map.tileReferences[offset],
    map.tileReferences[offset + 1],
  ];
}

export function parseMapBundle(
  mapSource: Uint8Array,
  mtgSource: Uint8Array,
  pthSource: Uint8Array,
): MapBundle {
  const map = parseMap(mapSource);
  const area = mapArea(map.width, map.height);
  const mtg = Buffer.from(mtgSource.buffer, mtgSource.byteOffset, mtgSource.byteLength);
  const pth = Buffer.from(pthSource.buffer, pthSource.byteOffset, pthSource.byteLength);

  if (map.width > 0xff || map.height > 0xff) {
    throw new MapFormatError(`MTG cannot represent dimensions ${map.width}x${map.height}`);
  }
  if (mtg.length !== MTG_HEADER_BYTES + area) {
    throw new MapFormatError(`MTG size ${mtg.length} does not match ${map.width}x${map.height}`);
  }
  if (mtg[0] !== map.width || mtg[1] !== map.height) {
    throw new MapFormatError(
      `MTG dimensions ${mtg[0]}x${mtg[1]} do not match MAP ${map.width}x${map.height}`,
    );
  }
  if (pth.length !== PTH_PREAMBLE_BYTES + area) {
    throw new MapFormatError(`PTH size ${pth.length} does not match ${map.width}x${map.height}`);
  }

  return {
    ...map,
    tagGrid: Uint8Array.from(mtg.subarray(MTG_HEADER_BYTES)),
    pathPreamble: Uint8Array.from(pth.subarray(0, PTH_PREAMBLE_BYTES)),
    pathGrid: Uint8Array.from(pth.subarray(PTH_PREAMBLE_BYTES)),
  };
}

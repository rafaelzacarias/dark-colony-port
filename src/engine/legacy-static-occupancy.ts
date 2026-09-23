export type LegacyOccupancyPlane = "ground" | "air" | "auxiliary";

export interface LegacyStaticOccupancyInput {
  readonly slot: number;
  readonly owner: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly width: number;
  readonly height: number;
  readonly movementClassByte: number;
  readonly auxiliaryField: number;
}

export interface LegacyOccupancyCell {
  readonly plane: LegacyOccupancyPlane;
  readonly x: number;
  readonly y: number;
}

export function legacyStaticOccupancyFieldsFromSource(source: { readonly rawTail: readonly number[] }):
  Pick<LegacyStaticOccupancyInput, "movementClassByte" | "auxiliaryField"> {
  if (!Array.isArray(source.rawTail) || source.rawTail.length !== 22) {
    throw new Error("Static occupancy requires the original 33-column GAMESTAT shape (22 rawTail values)");
  }
  for (const value of source.rawTail) integer(value, -2147483648, 2147483647, "GAMESTAT rawTail value");
  return { movementClassByte: source.rawTail[2] & 0xff, auxiliaryField: source.rawTail[4] };
}

function integer(value: number, minimum: number, maximum: number, name: string): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer in ${minimum}..${maximum}`);
  }
}

function bounds(slot: number, width: number, height: number): void {
  integer(slot, 120, 799, "noncolony slot");
  integer(width, 1, 255, "width");
  integer(height, 1, 255, "height");
}

export function projectLegacyStaticOccupancy(input: LegacyStaticOccupancyInput): LegacyOccupancyCell | null {
  bounds(input.slot, input.width, input.height);
  integer(input.owner, 0, 9, "owner");
  integer(input.tileX, 0, input.width - 1, "tileX");
  integer(input.tileY, 0, input.height - 1, "tileY");
  integer(input.movementClassByte, 0, 255, "movementClassByte");
  integer(input.auxiliaryField, -2147483648, 2147483647, "auxiliaryField");
  if (input.owner === 8) return null;
  return {
    plane: input.auxiliaryField !== 0 ? "auxiliary" : input.movementClassByte !== 0 ? "air" : "ground",
    x: input.tileX,
    y: input.tileY,
  };
}

export function registerLegacyOccupancyCell(previous: number, slot: number, plane: LegacyOccupancyPlane): number {
  integer(slot, 120, 799, "noncolony slot");
  integer(previous, 0, plane === "ground" ? 0xffffffff : 0xffff, "previous cell");
  return ((previous & ~0x3ff) | slot) >>> 0;
}

export function markLegacyResourceTile(previous: number): number {
  integer(previous, 0, 0xffffffff, "packed MAP cell");
  return (previous | 0x04000000) >>> 0;
}

export function findLegacyStaticRemoval(
  input: { readonly slot: number; readonly xQ8: number; readonly yQ8: number;
    readonly width: number; readonly height: number },
  readCell: (plane: LegacyOccupancyPlane, x: number, y: number) => number,
): LegacyOccupancyCell & { readonly before: number; readonly after: number } {
  bounds(input.slot, input.width, input.height);
  integer(input.xQ8, 0, 65535, "xQ8");
  integer(input.yQ8, 0, 65535, "yQ8");
  const tileX = input.xQ8 >>> 8;
  const tileY = input.yQ8 >>> 8;
  for (let cellX = Math.max(0, tileX - 1); cellX <= Math.min(input.width - 1, tileX + 1); cellX += 1) {
    for (let cellY = Math.max(0, tileY - 1); cellY <= Math.min(input.height - 1, tileY + 1); cellY += 1) {
      for (const plane of ["ground", "air", "auxiliary"] as const) {
        const before = readCell(plane, cellX, cellY);
        integer(before, 0, plane === "ground" ? 0xffffffff : 0xffff, "previous cell");
        if ((before & 0x3ff) === input.slot) {
          return { plane, x: cellX, y: cellY, before, after: (before | 0x3ff) >>> 0 };
        }
      }
    }
  }
  throw new Error("Native noncolony removal found no matching slot in its bounded 3x3 scan");
}
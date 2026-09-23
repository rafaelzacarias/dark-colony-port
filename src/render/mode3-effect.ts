import type { FinCompositionPart } from "./fin-composition";
import type { NativeIndexedSprite, NativeIndexedSurface } from "./mode1-shadow";
import type { RemapTable } from "./palette";
import { composeSceneBodyMasks, type NativeScenePosition, type SceneTerrainCommand } from "./scene-composition";

export const MODE3_PIXEL_BUDGET = 128 * 1024;

export function nativeMode3Filter(sourceIndex: number, filter: number): number {
  if (![sourceIndex, filter].every(value => Number.isInteger(value) && value >= 0 && value <= 255)) {
    throw new RangeError("Invalid native mode3 byte");
  }
  const sum = sourceIndex + filter;
  return ((sum > 255 ? sum | 0xf8 : sum) & 0xfc);
}

export function composeNativeMode3(input: {
  readonly part: FinCompositionPart;
  readonly position: NativeScenePosition;
  readonly sprite: NativeIndexedSprite;
  readonly terrain: readonly SceneTerrainCommand[];
}) {
  const { part, position, sprite } = input;
  const frame = part.frame;
  if (![position.x, position.y, position.heightOffset].every(value => Number.isInteger(value) && value >= -32768 && value <= 32767)
    || !frame || part.child.flags !== 16 || part.child.valueA !== 3 || ![0, 1].includes(part.child.layer)
    || position.heightOffset !== 0 || (part.child.valueB !== 0 && part.child.valueB !== 1)
    || part.mirrored !== Boolean(part.child.valueB) || part.x !== part.child.x + (part.mirrored ? 1 : frame.anchorX)
    || part.y !== part.child.y - frame.height || sprite.width !== frame.width || sprite.height !== frame.height
    || sprite.indices.length !== frame.width * frame.height || sprite.coverage.length !== sprite.indices.length
    || sprite.indices.length > MODE3_PIXEL_BUDGET) throw new RangeError("Unsupported native mode3 source");
  const bodyPart = { ...part, x: part.child.x + frame.anchorX, mirrored: false,
    child: { ...part.child, valueA: 0, valueB: 0, layer: 2 },
    diagnostics: part.diagnostics.filter(issue => issue !== "native-draw-mode:3") };
  const body = composeSceneBodyMasks({ terrain: input.terrain, sprites: [{ part: bodyPart, position }] })[0];
  if (body.clips === null) throw new RangeError(body.diagnostics.join(","));
  const pixels: { x: number; y: number; sourceIndex: number }[] = [];
  for (const span of body.clips) for (let column = span.x; column < span.x + span.width; column++) {
    const source = span.y * sprite.width + column;
    if (sprite.coverage[source]) pixels.push({ x: body.topLeft.x + column, y: body.topLeft.y + span.y,
      sourceIndex: sprite.indices[source] });
  }
  return { body, terrain: input.terrain, bounds: { ...body.topLeft, width: sprite.width, height: sprite.height }, pixels };
}

export function validateNativeMode3Surface(surface: NativeIndexedSurface): void {
  if (![surface.x, surface.y, surface.width, surface.height].every(Number.isInteger)
    || surface.x < 0 || surface.y < 0 || surface.x % 32 !== 0 || surface.y % 32 !== 0
    || surface.width < 32 || surface.width % 32 !== 0 || surface.height < 1
    || surface.width > 8192 || surface.height > 8192 || surface.width * surface.height > MODE3_PIXEL_BUDGET
    || surface.indices.length !== surface.width * surface.height) throw new RangeError("Invalid native mode3 surface");
}

export function stageNativeMode3Filters(surface: NativeIndexedSurface, plan: ReturnType<typeof composeNativeMode3>, enabled = true): Uint8Array {
  validateNativeMode3Surface(surface);
  if (typeof enabled !== "boolean" || plan.pixels.length > MODE3_PIXEL_BUDGET
    || ![plan.bounds.x, plan.bounds.y, plan.bounds.width, plan.bounds.height].every(Number.isInteger)
    || plan.bounds.width < 1 || plan.bounds.height < 1
    || plan.bounds.x < surface.x || plan.bounds.y < surface.y
    || plan.bounds.x + plan.bounds.width >= surface.x + surface.width - 1) {
    throw new RangeError("Native mode3 top/side clipping unverified");
  }
  const next = Uint8Array.from(surface.indices);
  const seen = new Set<number>();
  for (const pixel of plan.pixels) {
    if (![pixel.x, pixel.y, pixel.sourceIndex].every(Number.isInteger) || pixel.sourceIndex < 0 || pixel.sourceIndex > 255
      || pixel.x < plan.bounds.x || pixel.x >= plan.bounds.x + plan.bounds.width
      || pixel.y < plan.bounds.y || pixel.y >= plan.bounds.y + plan.bounds.height) {
      throw new RangeError("Invalid native mode3 pixel");
    }
    if (pixel.y >= surface.y + surface.height - 1) continue;
    const offset = (pixel.y - surface.y) * surface.width + pixel.x - surface.x;
    if (seen.has(offset)) throw new RangeError("Duplicate native mode3 pixel");
    seen.add(offset);
    if (enabled) next[offset] = nativeMode3Filter(pixel.sourceIndex, next[offset]);
  }
  return next;
}

export function drawNativeMode3Indexed(input: {
  readonly surface: NativeIndexedSurface;
  readonly filters: Uint8Array;
  readonly terrainIndices: Uint8Array;
  readonly plan: ReturnType<typeof composeNativeMode3>;
  readonly remap: RemapTable;
  readonly enabled?: boolean;
}): void {
  const { surface, filters, terrainIndices, plan, remap } = input;
  validateNativeMode3Surface(surface);
  if (filters.length !== surface.indices.length || terrainIndices.length !== filters.length
    || filters.buffer === surface.indices.buffer || filters.buffer === terrainIndices.buffer) {
    throw new RangeError("Invalid native mode3 planes");
  }
  const next = stageNativeMode3Filters({ ...surface, indices: filters }, plan, input.enabled);
  const offsets = nativeMode3FilterOffsets(surface, plan.terrain);
  const output = new Uint8Array(surface.indices.length);
  for (let offset = 0; offset < output.length; offset++) output[offset] = remap.lookup(0, next[offsets[offset]], terrainIndices[offset]);
  surface.indices.set(output);
  filters.set(next);
}

export function nativeMode3FilterOffsets(surface: NativeIndexedSurface, terrain: readonly SceneTerrainCommand[]): Uint32Array {
  validateNativeMode3Surface(surface);
  const cells = new Map<string, SceneTerrainCommand>();
  for (const cell of terrain) {
    const key = `${cell.column},${cell.row}`;
    if (![cell.column, cell.row, cell.foregroundIndex, cell.attributes].every(Number.isInteger)
      || cell.column < 0 || cell.column > 255 || cell.row < 0 || cell.row > 255
      || cell.foregroundIndex < 0 || cell.foregroundIndex > 2047 || cell.attributes < 0 || cell.attributes > 65535
      || cells.has(key)) throw new RangeError("Invalid native mode3 terrain");
    cells.set(key, cell);
  }
  const offsets = new Uint32Array(surface.indices.length);
  for (let row = 0; row < surface.height; row++) for (let column = 0; column < surface.width; column += 32) {
    const cell = cells.get(`${(surface.x + column) / 32},${Math.floor((surface.y + row) / 32)}`);
    if (!cell) throw new RangeError("Native mode3 missing terrain cell");
    const selector = cell.foregroundIndex ? (cell.attributes >> 5) & 3 : 0;
    for (let local = 0; local < 32; local++) {
      const sample = selector === 0 ? local & ~1 : selector === 3 ? local | 1 : local;
      offsets[row * surface.width + column + local] = row * surface.width + column + sample;
    }
  }
  return offsets;
}
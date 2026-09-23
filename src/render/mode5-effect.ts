import type { FinCompositionPart } from "./fin-composition";
import type { NativeIndexedSprite, NativeIndexedSurface } from "./mode1-shadow";
import type { RemapTable } from "./palette";
import { composeSceneBodyMasks, type NativeScenePosition, type SceneTerrainCommand } from "./scene-composition";

export const MODE5_PIXEL_BUDGET = 128 * 1024;

export function composeNativeMode5(input: {
  readonly part: FinCompositionPart;
  readonly position: NativeScenePosition;
  readonly sprite: NativeIndexedSprite;
  readonly terrain: readonly SceneTerrainCommand[];
}) {
  const { part, position, sprite } = input;
  const frame = part.frame;
  if (![position.x, position.y, position.heightOffset].every(value => Number.isInteger(value) && value >= -32768 && value <= 32767)
    || !frame || part.child.flags !== 16 || part.child.valueA !== 5 || (part.child.layer !== 0 && part.child.layer !== 1)
    || position.heightOffset !== 0 || part.child.valueB !== 0
    || part.mirrored !== Boolean(part.child.valueB) || sprite.width !== frame.width || sprite.height !== frame.height
    || sprite.indices.length !== frame.width * frame.height || sprite.coverage.length !== sprite.indices.length
    || sprite.indices.length > MODE5_PIXEL_BUDGET) throw new RangeError("Unsupported native mode5 source");
  const bodyPart = { ...part, child: { ...part.child, valueA: 0 },
    diagnostics: part.diagnostics.filter(issue => issue !== "native-draw-mode:5") };
  const body = composeSceneBodyMasks({ terrain: input.terrain, sprites: [{ part: bodyPart, position }] })[0];
  if (body.clips === null) throw new RangeError(body.diagnostics.join(","));
  const pixels: { x: number; y: number; sourceIndex: number }[] = [];
  for (const span of body.clips) for (let column = span.x; column < span.x + span.width; column++) {
    const source = span.y * sprite.width + (part.mirrored ? sprite.width - 1 - column : column);
    if (sprite.coverage[source]) pixels.push({ x: body.topLeft.x + column, y: body.topLeft.y + span.y,
      sourceIndex: sprite.indices[source] });
  }
  return { body, pixels };
}

export function drawNativeMode5Indexed(surface: NativeIndexedSurface, plan: ReturnType<typeof composeNativeMode5>, remap: RemapTable): void {
  if (![surface.x, surface.y, surface.width, surface.height].every(Number.isInteger)
    || surface.width < 1 || surface.height < 1 || surface.width * surface.height > 8192 * 8192
    || surface.indices.length !== surface.width * surface.height || plan.pixels.length > MODE5_PIXEL_BUDGET) {
    throw new RangeError("Invalid native mode5 surface");
  }
  const writes: { offset: number; value: number }[] = [];
  for (const pixel of plan.pixels) {
    if (![pixel.x, pixel.y, pixel.sourceIndex].every(Number.isInteger) || pixel.sourceIndex < 0 || pixel.sourceIndex > 255) {
      throw new RangeError("Invalid native mode5 pixel");
    }
    const column = pixel.x - surface.x, row = pixel.y - surface.y;
    if (column < 0 || row < 0 || column >= surface.width || row >= surface.height) continue;
    const offset = row * surface.width + column;
    writes.push({ offset, value: remap.lookup(1, pixel.sourceIndex, surface.indices[offset]) });
  }
  for (const write of writes) surface.indices[write.offset] = write.value;
}
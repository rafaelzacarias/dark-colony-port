import type { FinCompositionPart } from "./fin-composition";
import { composeNativeMode1, type NativeIndexedSprite, type NativeIndexedSurface } from "./mode1-shadow";
import type { RemapTable } from "./palette";
import type { NativeScenePosition, SceneTerrainCommand } from "./scene-composition";

export const MODE2_PIXEL_BUDGET = 128 * 1024;

export function composeNativeMode2(input: {
  readonly part: FinCompositionPart;
  readonly position: NativeScenePosition;
  readonly sprite: NativeIndexedSprite;
  readonly terrain: readonly SceneTerrainCommand[];
}) {
  if (input.part.child.valueA !== 2 || (input.part.child.layer !== 0 && input.part.child.layer !== 1)
    || input.sprite.indices.length > MODE2_PIXEL_BUDGET) throw new RangeError("Unsupported native mode2 source");
  const part = { ...input.part, child: { ...input.part.child, valueA: 1 },
    diagnostics: input.part.diagnostics.filter(issue => issue !== "native-draw-mode:2") };
  const plan = composeNativeMode1({ ...input, part });
  const height = input.sprite.height + Math.floor(input.sprite.height * 40 / 256);
  return { shadow: plan.shadow, bounds: {
    x: plan.body.topLeft.x - Math.floor(height / 2), y: input.position.y - height,
    width: input.sprite.width + Math.floor((height - 1) / 2), height,
  } };
}

export function drawNativeMode2Indexed(
  surface: NativeIndexedSurface, plan: ReturnType<typeof composeNativeMode2>, remap: RemapTable,
): void {
  if (![surface.x, surface.y, surface.width, surface.height].every(Number.isInteger)
    || surface.width < 1 || surface.height < 1 || surface.width * surface.height > 8192 * 8192
    || surface.indices.length !== surface.width * surface.height || plan.shadow.length > MODE2_PIXEL_BUDGET) {
    throw new RangeError("Invalid native mode2 surface");
  }
  if (plan.bounds.x < surface.x || plan.bounds.y < surface.y
    || plan.bounds.x + plan.bounds.width >= surface.x + surface.width - 1) {
    throw new RangeError("Native mode2 top/horizontal clipping unverified");
  }
  const writes = new Map<number, number>();
  for (const pixel of plan.shadow) {
    if (![pixel.x, pixel.y].every(Number.isInteger)) throw new RangeError("Invalid native mode2 pixel");
    const column = pixel.x - surface.x, row = pixel.y - surface.y;
    if (column < 0 || row < 0 || column >= surface.width || row >= surface.height - 1) continue;
    const offset = row * surface.width + column;
    writes.set(offset, remap.lookup(0, 72, writes.get(offset) ?? surface.indices[offset]));
  }
  for (const [offset, value] of writes) surface.indices[offset] = value;
}
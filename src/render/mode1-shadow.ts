import type { FinCompositionPart } from "./fin-composition";
import type { RemapTable } from "./palette";
import { composeSceneBodyMasks, nativeSceneCutoff, type NativeScenePosition, type SceneTerrainCommand } from "./scene-composition";

export interface NativeIndexedSprite {
  readonly width: number;
  readonly height: number;
  readonly indices: Uint8Array;
  readonly coverage: Uint8Array;
}

export interface NativeIndexedSurface {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly indices: Uint8Array;
}

export function composeNativeMode1(input: {
  readonly part: FinCompositionPart;
  readonly position: NativeScenePosition;
  readonly sprite: NativeIndexedSprite;
  readonly terrain: readonly SceneTerrainCommand[];
}) {
  const { part, position, sprite } = input;
  const frame = part.frame;
  if (![position.x, position.y, position.heightOffset].every((value) => Number.isInteger(value) && value >= -32768 && value <= 32767)) {
    throw new RangeError("Native mode1 coordinates must be signed words");
  }
  if (!frame || part.child.flags !== 16 || part.child.valueA !== 1 || position.heightOffset !== 0
    || (part.child.valueB !== 0 && part.child.valueB !== 1) || part.mirrored !== Boolean(part.child.valueB)
    || sprite.width !== frame.width || sprite.height !== frame.height
    || sprite.indices.length !== frame.width * frame.height || sprite.coverage.length !== sprite.indices.length) {
    throw new RangeError("Unsupported native mode1 source");
  }
  const bodyPart = { ...part, child: { ...part.child, valueA: 0 },
    diagnostics: part.diagnostics.filter((issue) => issue !== "native-shadow-pass-unimplemented") };
  const body = composeSceneBodyMasks({ terrain: input.terrain, sprites: [{ part: bodyPart, position }] })[0];
  if (body.clips === null) throw new RangeError(body.diagnostics.join(","));
  const cells = new Map(input.terrain.map((cell) => [`${cell.column},${cell.row}`, cell]));
  const outputHeight = frame.height + Math.floor(frame.height * 40 / 256);
  const left = body.topLeft.x - Math.floor(outputHeight / 2);
  const top = position.y - outputHeight;
  if (left < 0 || top < 0) throw new RangeError("Native mode1 physical edge unverified");
  const shadow: { x: number; y: number }[] = [];
  let sourceRow = 0;
  let repeat = false;
  let stretch = 0;
  for (let row = 0; row < outputHeight; row++) {
    for (let column = 0; column < frame.width; column++) {
      const source = sourceRow * frame.width + (part.mirrored ? frame.width - 1 - column : column);
      if (!sprite.coverage[source]) continue;
      const worldX = left + column + Math.floor(row / 2);
      const worldY = top + row;
      const maskX = worldX - (part.mirrored ? 1 : 0);
      const baseline = cells.get(`${Math.floor(maskX / 32)},${Math.floor(position.y / 32)}`);
      if (!baseline) throw new RangeError("Native mode1 missing shadow baseline");
      const cutoff = nativeSceneCutoff(frame.height, position.y, baseline.attributes, baseline.foregroundIndex);
      if (row > cutoff) {
        const ground = cells.get(`${Math.floor(maskX / 32)},${Math.floor(worldY / 32)}`);
        if (!ground || (ground.foregroundIndex && !ground.foregroundMask)) throw new RangeError("Native mode1 missing shadow ground mask");
        const bit = ground.attributes & 0x40 ? maskX & 31 : 31 - (maskX & 31);
        if (ground.foregroundIndex && ((ground.foregroundMask![worldY & 31] >>> bit) & 1)) continue;
      }
      shadow.push({ x: worldX, y: worldY });
    }
    if (repeat) { repeat = false; sourceRow++; }
    else {
      stretch += 40;
      if (stretch >= 256) { stretch -= 256; repeat = true; }
      else sourceRow++;
    }
  }
  return { body, shadow };
}

export function drawNativeMode1Indexed(
  surface: NativeIndexedSurface, plan: ReturnType<typeof composeNativeMode1>, sprite: NativeIndexedSprite,
  remap: RemapTable, selector: number, pass: "shadow" | "body" | "both" = "both",
): void {
  if (![surface.x, surface.y, surface.width, surface.height, selector].every(Number.isInteger)
    || surface.width < 1 || surface.height < 1 || surface.width * surface.height > 8192 * 8192
    || surface.indices.length !== surface.width * surface.height || selector < 0 || selector > 7
    || (pass !== "shadow" && pass !== "body" && pass !== "both")) {
    throw new RangeError("Invalid native indexed surface");
  }
  const offset = (worldX: number, worldY: number) => {
    const column = worldX - surface.x, row = worldY - surface.y;
    return column >= 0 && row >= 0 && column < surface.width && row < surface.height ? row * surface.width + column : -1;
  };
  if (pass !== "body") for (const pixel of plan.shadow) {
    const target = offset(pixel.x, pixel.y);
    if (target >= 0) surface.indices[target] = remap.lookup(0, 72, surface.indices[target]);
  }
  if (pass !== "shadow") for (const span of plan.body.clips!) {
    for (let column = span.x; column < span.x + span.width; column++) {
      const source = span.y * sprite.width + (plan.body.source.part.mirrored ? sprite.width - 1 - column : column);
      if (!sprite.coverage[source]) continue;
      const target = offset(plan.body.topLeft.x + column, plan.body.topLeft.y + span.y);
      if (target >= 0) surface.indices[target] = remap.lookup(2, 128 + selector, sprite.indices[source]);
    }
  }
}
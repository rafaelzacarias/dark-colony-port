import type { FinCompositionPart } from "./fin-composition";
import { nativePaletteImage, type NativePaletteAtlas } from "./mode1-canvas";
import type { NativeIndexedSprite, NativeIndexedSurface } from "./mode1-shadow";
import { composeNativeMode3, MODE3_PIXEL_BUDGET, nativeMode3FilterOffsets, stageNativeMode3Filters } from "./mode3-effect";
import type { RemapTable } from "./palette";
import type { NativeScenePosition, SceneTerrainCommand } from "./scene-composition";

export interface NativeMode3Mission {
  readonly sources: ReadonlyMap<string, NativeIndexedSprite>;
  readonly palette: Uint8Array;
  readonly remap: RemapTable;
}

const missions = new WeakMap<object, NativeMode3Mission>();

export function registerNativeMode3Mission(mission: object, data: NativeMode3Mission): () => void {
  missions.set(mission, data);
  return () => { if (missions.get(mission) === data) missions.delete(mission); };
}

export function drawNativeMode3Canvas(input: {
  readonly context: CanvasRenderingContext2D;
  readonly image?: CanvasImageSource;
  readonly mission?: object;
  readonly part: FinCompositionPart;
  readonly position: NativeScenePosition;
  readonly terrain: readonly SceneTerrainCommand[];
  readonly filters: NativeIndexedSurface;
  readonly terrainIndices?: Uint8Array;
  readonly enabled: boolean;
  readonly pixelBudget?: number;
}) {
  const fail = (reason: string, readbackPixels = 0) => ({ exact: false as const, diagnostic: `mode3-effect-${reason}`, readbackPixels });
  const { context, part, filters } = input;
  const mission = input.mission && missions.get(input.mission);
  const source = mission && mission.sources.get(part.child.sprite.toUpperCase());
  const atlas: NativePaletteAtlas | undefined = source && mission ? { ...source, ...mission, selector: 0 }
    : input.image ? nativePaletteImage(input.image) : undefined;
  if (!atlas) return fail("indexed-source-required");
  const frame = part.frame;
  if (!frame || ![frame.x, frame.y, frame.width, frame.height, atlas.width, atlas.height].every(Number.isInteger)
    || frame.x < 0 || frame.y < 0 || frame.width < 1 || frame.height < 1 || frame.width > 352 || frame.height > 240
    || atlas.width < 1 || atlas.height < 1 || frame.x + frame.width > atlas.width || frame.y + frame.height > atlas.height
    || atlas.indices.length !== atlas.width * atlas.height || atlas.coverage.length !== atlas.indices.length || atlas.palette.length !== 768) {
    return fail("atlas-frame-invalid");
  }
  const budget = input.pixelBudget ?? MODE3_PIXEL_BUDGET;
  if (!Number.isInteger(budget) || budget < 0 || budget > MODE3_PIXEL_BUDGET) return fail("readback-budget");
  const transform = context.getTransform?.();
  if (!transform || transform.a !== 1 || transform.b !== 0 || transform.c !== 0 || transform.d !== 1
    || transform.e !== 0 || transform.f !== 0 || context.globalAlpha !== 1 || context.globalCompositeOperation !== "source-over"
    || context.filter !== "none" || context.shadowBlur !== 0 || context.shadowOffsetX !== 0 || context.shadowOffsetY !== 0) {
    return fail("canvas-state-unverified");
  }
  if (input.terrainIndices && (input.terrainIndices.length !== filters.indices.length
    || input.terrainIndices.buffer === filters.indices.buffer)) return fail("terrain-plane-invalid");
  const indices = new Uint8Array(frame.width * frame.height), coverage = new Uint8Array(indices.length);
  for (let row = 0; row < frame.height; row++) {
    const start = (frame.y + row) * atlas.width + frame.x;
    indices.set(atlas.indices.subarray(start, start + frame.width), row * frame.width);
    coverage.set(atlas.coverage.subarray(start, start + frame.width), row * frame.width);
  }
  let next: Uint8Array, offsets: Uint32Array;
  try {
    const plan = composeNativeMode3({ ...input, sprite: { width: frame.width, height: frame.height, indices, coverage } });
    next = stageNativeMode3Filters(filters, plan, input.enabled);
    offsets = nativeMode3FilterOffsets(filters, input.terrain);
  } catch (error) { return fail(`unverified:${error instanceof Error ? error.message : String(error)}`); }
  const affected: number[] = [];
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (let offset = 0; offset < offsets.length; offset++) if (next[offsets[offset]] !== filters.indices[offsets[offset]]) {
    affected.push(offset);
    const column = offset % filters.width, row = Math.floor(offset / filters.width);
    left = Math.min(left, column); top = Math.min(top, row);
    right = Math.max(right, column); bottom = Math.max(bottom, row);
  }
  if (!affected.length) {
    filters.indices.set(next);
    return { exact: true as const, readbackPixels: 0 };
  }
  const width = right - left + 1, height = bottom - top + 1, readbackPixels = width * height;
  if (readbackPixels > budget) return fail("readback-budget");
  let data: ImageData;
  try { data = context.getImageData(left, top, width, height); }
  catch { return fail("readback-unavailable", readbackPixels); }
  if (data.width !== width || data.height !== height || data.data.length !== readbackPixels * 4) return fail("readback-invalid", readbackPixels);
  const color = (index: number) => atlas.palette[index * 3] * 65536 + atlas.palette[index * 3 + 1] * 256 + atlas.palette[index * 3 + 2];
  const transitions = new Map<number, Map<number, number>>();
  for (const offset of affected) {
    const target = ((Math.floor(offset / filters.width) - top) * width + offset % filters.width - left) * 4;
    const rgb = data.data[target] * 65536 + data.data[target + 1] * 256 + data.data[target + 2];
    if (data.data[target + 3] !== 255) return fail("destination-translucent", readbackPixels);
    const previous = filters.indices[offsets[offset]], filter = next[offsets[offset]];
    let result: number | undefined;
    if (input.terrainIndices) {
      const index = input.terrainIndices[offset];
      if (color(atlas.remap.lookup(0, previous, index)) !== rgb) return fail("destination-palette-unknown", readbackPixels);
      result = color(atlas.remap.lookup(0, filter, index));
    } else {
      const key = previous * 256 + filter;
      let mapping = transitions.get(key);
      if (!mapping) {
        mapping = new Map<number, number>();
        for (let index = 0; index < 256; index++) {
          const from = color(atlas.remap.lookup(0, previous, index)), to = color(atlas.remap.lookup(0, filter, index));
          mapping.set(from, mapping.has(from) && mapping.get(from) !== to ? -1 : to);
        }
        transitions.set(key, mapping);
      }
      result = mapping.get(rgb);
      if (result === undefined) return fail("destination-palette-unknown", readbackPixels);
      if (result < 0) return fail("destination-palette-ambiguous", readbackPixels);
    }
    data.data[target] = result >>> 16; data.data[target + 1] = (result >>> 8) & 255; data.data[target + 2] = result & 255;
  }
  context.putImageData(data, left, top);
  filters.indices.set(next);
  return { exact: true as const, readbackPixels };
}
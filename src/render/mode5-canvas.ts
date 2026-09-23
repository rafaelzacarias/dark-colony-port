import type { FinCompositionPart } from "./fin-composition";
import { nativePaletteImage, type NativePaletteAtlas } from "./mode1-canvas";
import type { NativeIndexedSprite } from "./mode1-shadow";
import { composeNativeMode5, MODE5_PIXEL_BUDGET } from "./mode5-effect";
import type { RemapTable } from "./palette";
import type { NativeScenePosition, SceneTerrainCommand } from "./scene-composition";

interface MissionEffects {
  readonly sources: ReadonlyMap<string, NativeIndexedSprite>;
  readonly palette: Uint8Array;
  readonly remap: RemapTable;
}

const missions = new WeakMap<object, MissionEffects>();
const aliases = new WeakMap<Uint8Array, ReadonlyMap<number, readonly number[]>>();

export function registerNativeEffectMission(mission: object, data: MissionEffects): () => void {
  missions.set(mission, data);
  return () => { if (missions.get(mission) === data) missions.delete(mission); };
}

function paletteColor(palette: Uint8Array, index: number): number {
  return palette[index * 3] * 65536 + palette[index * 3 + 1] * 256 + palette[index * 3 + 2];
}

function paletteAliases(palette: Uint8Array): ReadonlyMap<number, readonly number[]> {
  const cached = aliases.get(palette);
  if (cached) return cached;
  const result = new Map<number, number[]>();
  for (let index = 0; index < 256; index++) {
    const color = paletteColor(palette, index);
    const entries = result.get(color) ?? [];
    entries.push(index); result.set(color, entries);
  }
  aliases.set(palette, result);
  return result;
}

export function drawNativeMode5Canvas(input: {
  readonly context: CanvasRenderingContext2D;
  readonly image?: CanvasImageSource;
  readonly mission: object;
  readonly part: FinCompositionPart;
  readonly position: NativeScenePosition;
  readonly terrain: readonly SceneTerrainCommand[];
  readonly camera: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly pixelBudget?: number;
}) {
  const fail = (reason: string, readbackPixels = 0) => ({ exact: false as const, diagnostic: `mode5-effect-${reason}`, readbackPixels });
  const { context, part, camera } = input;
  const mission = missions.get(input.mission);
  const source = mission?.sources.get(part.child.sprite.toUpperCase());
  const atlas: NativePaletteAtlas | undefined = source && mission ? { ...source, ...mission, selector: 0 }
    : input.image ? nativePaletteImage(input.image) : undefined;
  if (!atlas) return fail("indexed-source-required");
  const frame = part.frame;
  if (!frame || ![frame.x, frame.y, frame.width, frame.height].every(Number.isInteger)
    || frame.x < 0 || frame.y < 0 || frame.width < 1 || frame.height < 1
    || frame.width > 352 || frame.height > 240 || frame.x + frame.width > atlas.width || frame.y + frame.height > atlas.height
    || atlas.indices.length !== atlas.width * atlas.height || atlas.coverage.length !== atlas.indices.length || atlas.palette.length !== 768) {
    return fail("atlas-frame-invalid");
  }
  if (![camera.x, camera.y, camera.width, camera.height].every(Number.isInteger)
    || camera.x < 0 || camera.y < 0 || camera.width < 1 || camera.height < 1 || camera.width > 8192 || camera.height > 8192) {
    return fail("viewport-invalid");
  }
  const budget = input.pixelBudget ?? MODE5_PIXEL_BUDGET;
  if (!Number.isInteger(budget) || budget < 0 || budget > MODE5_PIXEL_BUDGET) return fail("readback-budget");
  const transform = context.getTransform?.();
  if (!transform || transform.a !== 1 || transform.b !== 0 || transform.c !== 0 || transform.d !== 1
    || transform.e !== 0 || transform.f !== 0 || context.globalAlpha !== 1 || context.globalCompositeOperation !== "source-over"
    || context.filter !== "none" || context.shadowBlur !== 0 || context.shadowOffsetX !== 0 || context.shadowOffsetY !== 0) {
    return fail("canvas-state-unverified");
  }
  const indices = new Uint8Array(frame.width * frame.height), coverage = new Uint8Array(indices.length);
  for (let row = 0; row < frame.height; row++) {
    const start = (frame.y + row) * atlas.width + frame.x;
    indices.set(atlas.indices.subarray(start, start + frame.width), row * frame.width);
    coverage.set(atlas.coverage.subarray(start, start + frame.width), row * frame.width);
  }
  let plan: ReturnType<typeof composeNativeMode5>;
  try { plan = composeNativeMode5({ ...input, sprite: { width: frame.width, height: frame.height, indices, coverage } }); }
  catch (error) { return fail(`unverified:${error instanceof Error ? error.message : String(error)}`); }
  const pixels = plan.pixels.filter(pixel => pixel.x >= camera.x && pixel.y >= camera.y
    && pixel.x < camera.x + camera.width && pixel.y < camera.y + camera.height);
  if (!pixels.length) return { exact: true as const, readbackPixels: 0 };
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const pixel of pixels) {
    left = Math.min(left, pixel.x); top = Math.min(top, pixel.y);
    right = Math.max(right, pixel.x); bottom = Math.max(bottom, pixel.y);
  }
  const width = right - left + 1, height = bottom - top + 1, readbackPixels = width * height;
  if (readbackPixels > budget) return fail("readback-budget");
  let data: ImageData;
  try { data = context.getImageData(left - camera.x, top - camera.y, width, height); }
  catch { return fail("readback-unavailable", readbackPixels); }
  if (data.width !== width || data.height !== height || data.data.length !== width * height * 4) return fail("readback-invalid", readbackPixels);
  const colors = paletteAliases(atlas.palette);
  for (const pixel of pixels) {
    const offset = ((pixel.y - top) * width + pixel.x - left) * 4;
    const color = data.data[offset] * 65536 + data.data[offset + 1] * 256 + data.data[offset + 2];
    const candidates = colors.get(color);
    if (data.data[offset + 3] !== 255 || !candidates) return fail("destination-palette-unknown", readbackPixels);
    const result = paletteColor(atlas.palette, atlas.remap.lookup(1, pixel.sourceIndex, candidates[0]));
    if (candidates.some(index => paletteColor(atlas.palette, atlas.remap.lookup(1, pixel.sourceIndex, index)) !== result)) {
      return fail("destination-palette-ambiguous", readbackPixels);
    }
    data.data[offset] = result >>> 16; data.data[offset + 1] = (result >>> 8) & 255; data.data[offset + 2] = result & 255;
  }
  context.putImageData(data, left - camera.x, top - camera.y);
  return { exact: true as const, readbackPixels };
}
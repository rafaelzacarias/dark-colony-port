import type { FinCompositionPart } from "./fin-composition";
import { mirroredRegion, nativePaletteImage, writeMirroredRegion, type NativePaletteAtlas } from "./mode1-canvas";
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
const browserColors = new WeakMap<Uint8Array, Map<number, number>>();

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

function browserPaletteIndex(palette: Uint8Array, red: number, green: number, blue: number): number {
  const color = red * 65536 + green * 256 + blue;
  const exact = paletteAliases(palette).get(color);
  if (exact) return exact[0];
  let cache = browserColors.get(palette);
  if (!cache) { cache = new Map(); browserColors.set(palette, cache); }
  const cached = cache.get(color);
  if (cached !== undefined) return cached;
  let best = 0, distance = Infinity;
  for (let index = 0; index < 256; index++) {
    const error = (palette[index * 3] - red) ** 2 + (palette[index * 3 + 1] - green) ** 2 + (palette[index * 3 + 2] - blue) ** 2;
    if (error < distance) { distance = error; best = index; }
  }
  if (cache.size >= 4096) cache.clear();
  cache.set(color, best);
  return best;
}

/** Screen-space browser fallback, not a claim of native mirrored/elevated mask parity. */
export function drawBrowserMode5Canvas(input: {
  readonly context: CanvasRenderingContext2D;
  readonly mission: object;
  readonly part: FinCompositionPart;
  readonly origin: { readonly x: number; readonly y: number };
  readonly scale: number;
}): { readonly drawn: true } | { readonly drawn: false; readonly diagnostic: string } {
  const { context, part, origin, scale } = input, effect = missions.get(input.mission);
  const source = effect?.sources.get(part.child.sprite.toUpperCase()), frame = part.frame;
  if (!effect || !source || !frame) return { drawn: false, diagnostic: "browser-effect-indexed-source-required" };
  if (part.child.valueA !== 5 || scale !== 1 || !Number.isFinite(origin.x + origin.y) ||
    part.child.flags !== 16 || (part.child.valueB !== 0 && part.child.valueB !== 1) ||
    ![frame.x, frame.y, frame.width, frame.height].every(Number.isInteger) ||
    frame.x < 0 || frame.y < 0 || frame.width < 1 || frame.height < 1 ||
    frame.x + frame.width > source.width || frame.y + frame.height > source.height ||
    frame.width * frame.height > MODE5_PIXEL_BUDGET) {
    return { drawn: false, diagnostic: "browser-effect-frame-invalid" };
  }
  if (!context.canvas || !Number.isInteger(context.canvas.width) || !Number.isInteger(context.canvas.height)) {
    return { drawn: false, diagnostic: "browser-effect-canvas-unavailable" };
  }
  const x = Math.round(origin.x + part.x), y = Math.round(origin.y + part.y);
  const left = Math.max(0, x), top = Math.max(0, y);
  const right = Math.min(context.canvas.width, x + frame.width), bottom = Math.min(context.canvas.height, y + frame.height);
  if (right <= left || bottom <= top) return { drawn: true };
  const region = { x: left, y: top, width: right - left, height: bottom - top };
  const mirror = mirroredRegion(context, region);
  const image = mirror ?? context.getImageData(left, top, region.width, region.height);
  if (!image || !image.data || image.data.length !== image.width * image.height * 4) {
    return { drawn: false, diagnostic: "browser-effect-readback-unavailable" };
  }
  const offsetX = mirror ? 0 : left, offsetY = mirror ? 0 : top;
  for (let row = top; row < bottom; row++) for (let column = left; column < right; column++) {
    const sourceX = part.mirrored ? frame.width - 1 - (column - x) : column - x;
    const sourceOffset = (frame.y + row - y) * source.width + frame.x + sourceX;
    if (!source.coverage[sourceOffset]) continue;
    const offset = ((row - offsetY) * image.width + column - offsetX) * 4;
    // Fog and antialiased overlays are RGB, so only this browser fallback quantizes their destination.
    const destination = browserPaletteIndex(effect.palette, image.data[offset], image.data[offset + 1], image.data[offset + 2]);
    const result = effect.remap.lookup(1, source.indices[sourceOffset], destination) * 3;
    image.data[offset] = effect.palette[result];
    image.data[offset + 1] = effect.palette[result + 1];
    image.data[offset + 2] = effect.palette[result + 2];
    image.data[offset + 3] = 255;
  }
  if (mirror) writeMirroredRegion(context, mirror, region);
  else context.putImageData(image, left, top);
  return { drawn: true };
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
  const region = { x: left - camera.x, y: top - camera.y, width, height };
  let mirror: ImageData | undefined;
  try { mirror = mirroredRegion(context, region); }
  catch { return fail("readback-unavailable", readbackPixels); }
  if (mirror) {
    // Same pixel order as the readback path; an undo log keeps a mid-effect diagnostic from touching mirror or canvas.
    const colors = paletteAliases(atlas.palette), stride = mirror.width, rows = mirror.height, bytes = mirror.data;
    const undo: number[] = [];
    const abort = (reason: string) => {
      for (let index = undo.length - 4; index >= 0; index -= 4) {
        bytes[undo[index]] = undo[index + 1]; bytes[undo[index] + 1] = undo[index + 2]; bytes[undo[index] + 2] = undo[index + 3];
      }
      return fail(reason, readbackPixels);
    };
    for (const pixel of pixels) {
      const x = pixel.x - camera.x, y = pixel.y - camera.y;
      if (x >= stride || y >= rows) return abort("destination-palette-unknown");
      const offset = (y * stride + x) * 4;
      const color = bytes[offset] * 65536 + bytes[offset + 1] * 256 + bytes[offset + 2];
      const candidates = colors.get(color);
      if (bytes[offset + 3] !== 255 || !candidates) return abort("destination-palette-unknown");
      const result = paletteColor(atlas.palette, atlas.remap.lookup(1, pixel.sourceIndex, candidates[0]));
      if (candidates.some(index => paletteColor(atlas.palette, atlas.remap.lookup(1, pixel.sourceIndex, index)) !== result)) {
        return abort("destination-palette-ambiguous");
      }
      undo.push(offset, bytes[offset], bytes[offset + 1], bytes[offset + 2]);
      bytes[offset] = result >>> 16; bytes[offset + 1] = (result >>> 8) & 255; bytes[offset + 2] = result & 255;
    }
    writeMirroredRegion(context, mirror, region);
    return { exact: true as const, readbackPixels };
  }
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
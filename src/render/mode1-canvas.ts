import type { FinCompositionPart } from "./fin-composition";
import { composeNativeMode1, type NativeIndexedSprite } from "./mode1-shadow";
import type { RemapTable } from "./palette";
import type { NativeScenePosition, SceneTerrainCommand } from "./scene-composition";

export interface NativePaletteAtlas extends NativeIndexedSprite {
  readonly palette: Uint8Array;
  readonly remap: RemapTable;
  readonly selector: number;
}

const images = new WeakMap<CanvasImageSource, NativePaletteAtlas>();
const shadeMaps = new WeakMap<RemapTable, WeakMap<Uint8Array, ReadonlyMap<number, number>>>();
export const MODE1_CANVAS_PIXEL_BUDGET = 128 * 1024;

export function registerNativePaletteImage(image: CanvasImageSource, atlas: NativePaletteAtlas): void {
  if (!Number.isInteger(atlas.width) || !Number.isInteger(atlas.height) || atlas.width < 1 || atlas.height < 1
    || atlas.indices.length !== atlas.width * atlas.height || atlas.coverage.length !== atlas.indices.length
    || atlas.palette.length !== 768 || !Number.isInteger(atlas.selector) || atlas.selector < 0 || atlas.selector > 7) {
    throw new RangeError("Invalid native palette atlas");
  }
  images.set(image, atlas);
}

export function nativePaletteImage(image: CanvasImageSource): NativePaletteAtlas | undefined {
  return images.get(image);
}

function shadeMap(atlas: NativePaletteAtlas): ReadonlyMap<number, number> {
  let palettes = shadeMaps.get(atlas.remap);
  if (!palettes) { palettes = new WeakMap(); shadeMaps.set(atlas.remap, palettes); }
  const cached = palettes.get(atlas.palette);
  if (cached) return cached;
  const color = (index: number) => atlas.palette[index * 3] * 65536 + atlas.palette[index * 3 + 1] * 256 + atlas.palette[index * 3 + 2];
  const result = new Map<number, number>();
  for (let index = 0; index < 256; index++) {
    const source = color(index), target = color(atlas.remap.lookup(0, 72, index));
    result.set(source, result.has(source) && result.get(source) !== target ? -1 : target);
  }
  palettes.set(atlas.palette, result);
  return result;
}

export function drawNativeMode1CanvasShadow(input: {
  readonly context: CanvasRenderingContext2D;
  readonly image: CanvasImageSource;
  readonly part: FinCompositionPart;
  readonly position: NativeScenePosition;
  readonly terrain: readonly SceneTerrainCommand[];
  readonly camera: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}) {
  const atlas = images.get(input.image);
  if (!atlas) return { diagnostic: "mode1-shadow-indexed-image-required" } as const;
  const { context, part, camera } = input;
  if (![camera.x, camera.y, camera.width, camera.height].every(Number.isInteger)
    || camera.width < 1 || camera.height < 1 || camera.width > 8192 || camera.height > 8192) {
    return { diagnostic: "mode1-shadow-viewport-invalid" } as const;
  }
  const frame = part.frame;
  if (!frame || ![frame.x, frame.y, frame.width, frame.height].every(Number.isInteger)
    || frame.x < 0 || frame.y < 0 || frame.width < 1 || frame.height < 1
    || frame.x + frame.width > atlas.width || frame.y + frame.height > atlas.height) {
    return { diagnostic: "mode1-shadow-atlas-frame-invalid" } as const;
  }
  const transform = context.getTransform?.();
  if (!transform || transform.a !== 1 || transform.b !== 0 || transform.c !== 0 || transform.d !== 1
    || transform.e !== 0 || transform.f !== 0 || context.globalAlpha !== 1 || context.globalCompositeOperation !== "source-over"
    || context.filter !== "none" || context.shadowBlur !== 0 || context.shadowOffsetX !== 0 || context.shadowOffsetY !== 0) {
    return { diagnostic: "mode1-shadow-canvas-state-unverified" } as const;
  }
  const indices = new Uint8Array(frame.width * frame.height), coverage = new Uint8Array(indices.length);
  for (let row = 0; row < frame.height; row++) {
    const start = (frame.y + row) * atlas.width + frame.x;
    indices.set(atlas.indices.subarray(start, start + frame.width), row * frame.width);
    coverage.set(atlas.coverage.subarray(start, start + frame.width), row * frame.width);
  }
  let plan: ReturnType<typeof composeNativeMode1>;
  try { plan = composeNativeMode1({ ...input, sprite: { width: frame.width, height: frame.height, indices, coverage } }); }
  catch (error) { return { diagnostic: `mode1-shadow-unverified:${error instanceof Error ? error.message : String(error)}` } as const; }
  const pixels = plan.shadow.filter(({ x, y }) => x >= camera.x && y >= camera.y
    && x < camera.x + camera.width && y < camera.y + camera.height);
  if (!pixels.length) return { plan, readbackPixels: 0 } as const;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const pixel of pixels) {
    left = Math.min(left, pixel.x); top = Math.min(top, pixel.y);
    right = Math.max(right, pixel.x); bottom = Math.max(bottom, pixel.y);
  }
  const width = right - left + 1, height = bottom - top + 1;
  if (width * height > MODE1_CANVAS_PIXEL_BUDGET) return { diagnostic: "mode1-shadow-readback-budget" } as const;
  let imageData: ImageData;
  try { imageData = context.getImageData(left - camera.x, top - camera.y, width, height); }
  catch { return { diagnostic: "mode1-shadow-readback-unavailable" } as const; }
  const colors = shadeMap(atlas);
  for (const pixel of pixels) {
    const target = ((pixel.y - top) * width + pixel.x - left) * 4;
    const source = imageData.data[target] * 65536 + imageData.data[target + 1] * 256 + imageData.data[target + 2];
    const shade = colors.get(source);
    if (imageData.data[target + 3] !== 255 || shade === undefined || shade < 0) {
      return { diagnostic: "mode1-shadow-destination-palette-ambiguous" } as const;
    }
    imageData.data[target] = shade >>> 16;
    imageData.data[target + 1] = (shade >>> 8) & 255;
    imageData.data[target + 2] = shade & 255;
  }
  context.putImageData(imageData, left - camera.x, top - camera.y);
  return { plan, readbackPixels: width * height } as const;
}
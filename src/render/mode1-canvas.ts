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

type Rect = { x: number; y: number; width: number; height: number };
interface ShadowSurface { active: boolean; image: ImageData | null; dirty: Rect[] }
const surfaces = new WeakMap<CanvasRenderingContext2D, ShadowSurface>();
const prototype = typeof CanvasRenderingContext2D === "undefined" ? undefined : CanvasRenderingContext2D.prototype;
let mirrorEnabled = true;

/** QA switch: false restores one readback per shadow so the two paths can be compared pixel for pixel. */
export function setMode1ShadowMirror(enabled: boolean): void { mirrorEnabled = enabled; }

// A getImageData call costs ~0.2 ms however small; a frame with ten shadows spent 5 ms reading back. One mirror of the
// canvas is read per frame and only rectangles drawn since the last shadow are re-read, so results stay pixel-identical.
export function beginMode1ShadowFrame(context: CanvasRenderingContext2D): void {
  if (!prototype || !(context instanceof CanvasRenderingContext2D)) return;
  let surface = surfaces.get(context);
  if (!surface) {
    surface = { active: false, image: null, dirty: [] };
    surfaces.set(context, surface);
    const state = surface;
    const all = () => { if (state.active) { state.image = null; state.dirty.length = 0; } };
    const mark = (x: number, y: number, width: number, height: number) => {
      if (!state.active || !state.image) return;
      const t = context.getTransform();
      if (!Number.isFinite(x + y + width + height)) { all(); return; }
      const xs = [x, x + width], ys = [y, y + height];
      const px = xs.flatMap(cx => ys.map(cy => t.a * cx + t.c * cy + t.e)), py = xs.flatMap(cx => ys.map(cy => t.b * cx + t.d * cy + t.f));
      const left = Math.floor(Math.min(...px)) - 1, top = Math.floor(Math.min(...py)) - 1;
      state.dirty.push({ x: left, y: top, width: Math.ceil(Math.max(...px)) + 2 - left, height: Math.ceil(Math.max(...py)) + 2 - top });
    };
    const wrap = <Name extends keyof CanvasRenderingContext2D>(name: Name, dirty: (...args: any[]) => void) => {
      const original = prototype[name] as unknown as (...args: unknown[]) => unknown;
      Object.defineProperty(context, name, { configurable: true, writable: true,
        value(...args: unknown[]) { dirty(...args); return original.apply(context, args); } });
    };
    wrap("drawImage", (image: CanvasImageSource & { width?: number; height?: number }, ...rest: number[]) => {
      if (rest.length === 2) mark(rest[0], rest[1], Number(image.width), Number(image.height));
      else if (rest.length === 4) mark(rest[0], rest[1], rest[2], rest[3]);
      else if (rest.length === 8) mark(rest[4], rest[5], rest[6], rest[7]);
      else all();
    });
    for (const name of ["fillRect", "strokeRect", "clearRect"] as const) {
      wrap(name, (x: number, y: number, width: number, height: number) => mark(x - 2, y - 2, width + 4, height + 4));
    }
    for (const name of ["fill", "stroke", "fillText", "strokeText", "putImageData", "reset"] as const) {
      if (name in prototype) wrap(name, all);
    }
  }
  surface.active = true; surface.image = null; surface.dirty.length = 0;
}

export function endMode1ShadowFrame(context: CanvasRenderingContext2D): void {
  const surface = surfaces.get(context);
  if (surface) { surface.active = false; surface.image = null; surface.dirty.length = 0; }
}

/** Canvas-sized mirror whose pixels inside `region` match the canvas, or undefined outside a shadow frame. */
export function mirroredRegion(context: CanvasRenderingContext2D, region: Rect): ImageData | undefined {
  const surface = surfaces.get(context);
  if (!surface?.active || !prototype || !mirrorEnabled) return undefined;
  const width = context.canvas.width, height = context.canvas.height;
  // The first shadow of a frame reads the whole canvas once; later shadows only re-read what was drawn since.
  if (!surface.image || surface.image.width !== width || surface.image.height !== height) {
    surface.image = prototype.getImageData.call(context, 0, 0, width, height);
    surface.dirty.length = 0;
    return surface.image;
  }
  const image = surface.image;
  // One read covers every stale rectangle the region touches; clean pixels inside that box already match the canvas.
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const rect of surface.dirty) {
    const l = Math.max(0, rect.x, region.x), t = Math.max(0, rect.y, region.y);
    const r = Math.min(width, rect.x + rect.width, region.x + region.width), b = Math.min(height, rect.y + rect.height, region.y + region.height);
    if (r <= l || b <= t) continue;
    left = Math.min(left, l); top = Math.min(top, t); right = Math.max(right, r); bottom = Math.max(bottom, b);
  }
  if (right <= left || bottom <= top) return image;
  surface.dirty = surface.dirty.flatMap(rect => {
    const l = Math.max(rect.x, left), t = Math.max(rect.y, top), r = Math.min(rect.x + rect.width, right), b = Math.min(rect.y + rect.height, bottom);
    if (r <= l || b <= t) return [rect];
    return [{ x: rect.x, y: rect.y, width: rect.width, height: t - rect.y },
      { x: rect.x, y: b, width: rect.width, height: rect.y + rect.height - b },
      { x: rect.x, y: t, width: l - rect.x, height: b - t },
      { x: r, y: t, width: rect.x + rect.width - r, height: b - t }].filter(part => part.width > 0 && part.height > 0);
  });
  const fresh = prototype.getImageData.call(context, left, top, right - left, bottom - top);
  for (let row = 0; row < bottom - top; row++) {
    image.data.set(fresh.data.subarray(row * (right - left) * 4, (row + 1) * (right - left) * 4), ((top + row) * width + left) * 4);
  }
  return image;
}

/** Writes a mirror rectangle back without invalidating the mirror (the written pixels are the mirror's own). */
export function writeMirroredRegion(context: CanvasRenderingContext2D, mirror: ImageData, region: Rect): void {
  prototype!.putImageData.call(context, mirror, 0, 0, region.x, region.y, region.width, region.height);
}

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
  const colors = shadeMap(atlas);
  let mirror: ImageData | undefined;
  try { mirror = mirroredRegion(context, { x: left - camera.x, y: top - camera.y, width, height }); }
  catch { return { diagnostic: "mode1-shadow-readback-unavailable" } as const; }
  if (mirror) {
    const stride = mirror.width, targets = new Int32Array(pixels.length), shades = new Int32Array(pixels.length);
    for (let index = 0; index < pixels.length; index++) {
      const target = ((pixels[index].y - camera.y) * stride + pixels[index].x - camera.x) * 4;
      const source = mirror.data[target] * 65536 + mirror.data[target + 1] * 256 + mirror.data[target + 2];
      const shade = colors.get(source);
      if (mirror.data[target + 3] !== 255 || shade === undefined || shade < 0) {
        return { diagnostic: "mode1-shadow-destination-palette-ambiguous" } as const;
      }
      targets[index] = target; shades[index] = shade;
    }
    for (let index = 0; index < targets.length; index++) {
      mirror.data[targets[index]] = shades[index] >>> 16;
      mirror.data[targets[index] + 1] = (shades[index] >>> 8) & 255;
      mirror.data[targets[index] + 2] = shades[index] & 255;
    }
    prototype!.putImageData.call(context, mirror, 0, 0, left - camera.x, top - camera.y, width, height);
    return { plan, readbackPixels: width * height } as const;
  }
  let imageData: ImageData;
  try { imageData = context.getImageData(left - camera.x, top - camera.y, width, height); }
  catch { return { diagnostic: "mode1-shadow-readback-unavailable" } as const; }
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
import type { SpriteArchive, SpriteColor } from "./spr";

export interface SpriteAtlasFrame {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly encodedBytes: number;
  readonly empty: boolean;
}

export interface SpriteAtlas {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  readonly paletteScale: "6-bit" | "8-bit";
  readonly frames: readonly SpriteAtlasFrame[];
}

export interface SpriteAtlasOptions {
  readonly maximumWidth?: number;
  readonly padding?: number;
}

function scalePaletteChannel(value: number, sixBit: boolean): number {
  return sixBit ? Math.round((value * 255) / 63) : value;
}

function rgbaPalette(
  palette: readonly SpriteColor[],
): { readonly colors: readonly [number, number, number][]; readonly scale: "6-bit" | "8-bit" } {
  const sixBit = palette.every(
    ({ red, green, blue }) => red <= 0x3f && green <= 0x3f && blue <= 0x3f,
  );
  return {
    scale: sixBit ? "6-bit" : "8-bit",
    colors: palette.map(({ red, green, blue }) => [
      scalePaletteChannel(red, sixBit),
      scalePaletteChannel(green, sixBit),
      scalePaletteChannel(blue, sixBit),
    ]),
  };
}

export function createSpriteAtlas(
  archive: SpriteArchive,
  options: SpriteAtlasOptions = {},
): SpriteAtlas {
  const maximumWidth = options.maximumWidth ?? 2048;
  const padding = options.padding ?? 1;
  if (!Number.isInteger(maximumWidth) || maximumWidth <= 0) {
    throw new RangeError("maximumWidth must be a positive integer");
  }
  if (!Number.isInteger(padding) || padding < 0) {
    throw new RangeError("padding must be a non-negative integer");
  }

  const nonEmptyFrames = archive.frames.filter(({ width, height }) => width > 0 && height > 0);
  const widestFrame = Math.max(1, ...nonEmptyFrames.map(({ width }) => width));
  if (widestFrame > maximumWidth) {
    throw new RangeError(`frame width ${widestFrame} exceeds atlas limit ${maximumWidth}`);
  }

  const footprint = nonEmptyFrames.reduce(
    (total, frame) => total + (frame.width + padding) * (frame.height + padding),
    0,
  );
  const targetWidth = Math.max(
    widestFrame,
    Math.min(maximumWidth, Math.ceil(Math.sqrt(Math.max(1, footprint)))),
  );

  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  let usedWidth = 1;
  let usedHeight = 1;
  const frames: SpriteAtlasFrame[] = [];

  for (const [index, frame] of archive.frames.entries()) {
    if (frame.width === 0 || frame.height === 0) {
      frames.push({
        index,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        anchorX: frame.anchorX,
        anchorY: frame.anchorY,
        encodedBytes: frame.encodedBytes,
        empty: true,
      });
      continue;
    }

    if (cursorX > 0 && cursorX + frame.width > targetWidth) {
      cursorX = 0;
      cursorY += rowHeight + padding;
      rowHeight = 0;
    }

    frames.push({
      index,
      x: cursorX,
      y: cursorY,
      width: frame.width,
      height: frame.height,
      anchorX: frame.anchorX,
      anchorY: frame.anchorY,
      encodedBytes: frame.encodedBytes,
      empty: false,
    });
    usedWidth = Math.max(usedWidth, cursorX + frame.width);
    usedHeight = Math.max(usedHeight, cursorY + frame.height);
    cursorX += frame.width + padding;
    rowHeight = Math.max(rowHeight, frame.height);
  }

  const rgba = new Uint8Array(usedWidth * usedHeight * 4);
  const palette = rgbaPalette(archive.palette);

  for (const placement of frames) {
    if (placement.empty) continue;
    const frame = archive.frames[placement.index];
    for (let sourceY = 0; sourceY < frame.height; sourceY += 1) {
      for (let sourceX = 0; sourceX < frame.width; sourceX += 1) {
        const sourceOffset = sourceY * frame.width + sourceX;
        const outputOffset =
          ((placement.y + sourceY) * usedWidth + placement.x + sourceX) * 4;
        const [red, green, blue] = palette.colors[frame.indices[sourceOffset]];
        rgba[outputOffset] = red;
        rgba[outputOffset + 1] = green;
        rgba[outputOffset + 2] = blue;
        rgba[outputOffset + 3] = frame.alpha[sourceOffset];
      }
    }
  }

  return {
    width: usedWidth,
    height: usedHeight,
    rgba,
    paletteScale: palette.scale,
    frames,
  };
}

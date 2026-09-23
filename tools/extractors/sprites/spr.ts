const HEADER_BYTES = 8;
const PALETTE_COLORS = 256;
const PALETTE_BYTES = PALETTE_COLORS * 3;
const FRAME_RECORD_BYTES = 8;
const MAX_FRAME_PIXELS = 64 * 1024 * 1024;

export const SPRITE_DATA_OFFSET = HEADER_BYTES + PALETTE_BYTES;
export const SPRITE_FLAG_RAW = 0x0001;
export const SPRITE_FLAG_COMPRESSED = 0x0081;

export interface SpriteColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

export interface SpriteFrame {
  readonly width: number;
  readonly height: number;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly indices: Uint8Array;
  readonly alpha: Uint8Array;
  readonly encodedBytes: number;
}

export interface SpriteArchive {
  readonly flags: number;
  readonly encoding: "compressed" | "raw";
  readonly storedByteCount: number;
  readonly palette: readonly SpriteColor[];
  readonly frames: readonly SpriteFrame[];
}

export class SpriteFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpriteFormatError";
  }
}

function assertAvailable(buffer: Buffer, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > buffer.length) {
    throw new SpriteFormatError(
      `${label} is truncated at byte ${offset}; need ${length} bytes, file has ${buffer.length}`,
    );
  }
}

function frameArea(width: number, height: number, index: number): number {
  if (width === 0 && height === 0) return 0;
  if (width === 0 || height === 0) {
    throw new SpriteFormatError(`frame ${index} has invalid dimensions ${width}x${height}`);
  }

  const area = width * height;
  if (!Number.isSafeInteger(area) || area > MAX_FRAME_PIXELS) {
    throw new SpriteFormatError(`frame ${index} is too large: ${width}x${height}`);
  }
  return area;
}

function decodeCompressedFrame(
  payload: Buffer,
  width: number,
  height: number,
  frameIndex: number,
): Pick<SpriteFrame, "indices" | "alpha"> {
  const area = frameArea(width, height, frameIndex);
  const indices = new Uint8Array(area);
  const alpha = new Uint8Array(area);
  let inputOffset = 0;
  let outputOffset = 0;

  while (inputOffset < payload.length) {
    const control = payload.readInt8(inputOffset);
    inputOffset += 1;

    if (control < 0) {
      const transparentPixels = -control;
      if (outputOffset + transparentPixels > area) {
        throw new SpriteFormatError(
          `frame ${frameIndex} transparent run exceeds ${width}x${height} output`,
        );
      }
      outputOffset += transparentPixels;
      continue;
    }

    const literalPixels = control + 1;
    if (inputOffset + literalPixels > payload.length) {
      throw new SpriteFormatError(`frame ${frameIndex} literal run exceeds its payload`);
    }
    if (outputOffset + literalPixels > area) {
      throw new SpriteFormatError(
        `frame ${frameIndex} literal run exceeds ${width}x${height} output`,
      );
    }

    indices.set(payload.subarray(inputOffset, inputOffset + literalPixels), outputOffset);
    alpha.fill(0xff, outputOffset, outputOffset + literalPixels);
    inputOffset += literalPixels;
    outputOffset += literalPixels;
  }

  if (outputOffset !== area) {
    throw new SpriteFormatError(
      `frame ${frameIndex} decoded ${outputOffset} pixels; expected ${area}`,
    );
  }

  return { indices, alpha };
}

export function parseSprite(source: Uint8Array): SpriteArchive {
  const buffer = Buffer.from(source.buffer, source.byteOffset, source.byteLength);
  assertAvailable(buffer, 0, SPRITE_DATA_OFFSET, "SPR header and palette");

  const flags = buffer.readUInt16LE(0);
  const frameCount = buffer.readUInt16LE(2);
  const storedByteCount = buffer.readUInt32LE(4);

  if (flags !== SPRITE_FLAG_RAW && flags !== SPRITE_FLAG_COMPRESSED) {
    throw new SpriteFormatError(`unsupported SPR flags 0x${flags.toString(16).padStart(4, "0")}`);
  }
  if (frameCount === 0) {
    throw new SpriteFormatError("SPR archive contains no frames");
  }

  const palette: SpriteColor[] = [];
  for (let index = 0; index < PALETTE_COLORS; index += 1) {
    const offset = HEADER_BYTES + index * 3;
    palette.push({
      red: buffer[offset],
      green: buffer[offset + 1],
      blue: buffer[offset + 2],
    });
  }

  const frameTableBytes = frameCount * FRAME_RECORD_BYTES;
  assertAvailable(buffer, SPRITE_DATA_OFFSET, frameTableBytes, "SPR frame table");

  const records = Array.from({ length: frameCount }, (_, index) => {
    const offset = SPRITE_DATA_OFFSET + index * FRAME_RECORD_BYTES;
    const width = buffer.readUInt16LE(offset);
    const height = buffer.readUInt16LE(offset + 2);
    frameArea(width, height, index);
    return {
      width,
      height,
      anchorX: buffer.readUInt16LE(offset + 4),
      anchorY: buffer.readUInt16LE(offset + 6),
    };
  });

  let dataOffset = SPRITE_DATA_OFFSET + frameTableBytes;
  let encodedByteCount = 0;
  const frames: SpriteFrame[] = [];

  for (const [index, record] of records.entries()) {
    const area = frameArea(record.width, record.height, index);

    if (flags === SPRITE_FLAG_RAW) {
      assertAvailable(buffer, dataOffset, area, `raw frame ${index}`);
      const indices = Uint8Array.from(buffer.subarray(dataOffset, dataOffset + area));
      frames.push({
        ...record,
        indices,
        alpha: Uint8Array.from(indices, (paletteIndex) => (paletteIndex === 0 ? 0 : 0xff)),
        encodedBytes: area,
      });
      dataOffset += area;
      continue;
    }

    assertAvailable(buffer, dataOffset, 4, `compressed frame ${index} length`);
    const encodedBytes = buffer.readUInt32LE(dataOffset);
    dataOffset += 4;
    assertAvailable(buffer, dataOffset, encodedBytes, `compressed frame ${index}`);
    const decoded = decodeCompressedFrame(
      buffer.subarray(dataOffset, dataOffset + encodedBytes),
      record.width,
      record.height,
      index,
    );
    frames.push({ ...record, ...decoded, encodedBytes });
    encodedByteCount += encodedBytes;
    dataOffset += encodedBytes;
  }

  if (dataOffset !== buffer.length) {
    throw new SpriteFormatError(
      `SPR archive has ${buffer.length - dataOffset} trailing bytes after ${frameCount} frames`,
    );
  }
  if (flags === SPRITE_FLAG_COMPRESSED && encodedByteCount !== storedByteCount) {
    throw new SpriteFormatError(
      `compressed payload total ${encodedByteCount} does not match header ${storedByteCount}`,
    );
  }

  return {
    flags,
    encoding: flags === SPRITE_FLAG_RAW ? "raw" : "compressed",
    storedByteCount,
    palette,
    frames,
  };
}

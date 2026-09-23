import assert from "node:assert/strict";
import test from "node:test";

import {
  parseSprite,
  SPRITE_DATA_OFFSET,
  SPRITE_FLAG_COMPRESSED,
  SPRITE_FLAG_RAW,
  SpriteFormatError,
} from "./spr";

interface TestFrame {
  readonly width: number;
  readonly height: number;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly payload: readonly number[];
}

function fixture(flags: number, frames: readonly TestFrame[]): Buffer {
  const compressed = flags === SPRITE_FLAG_COMPRESSED;
  const payloadBytes = frames.reduce(
    (total, frame) => total + frame.payload.length + (compressed ? 4 : 0),
    0,
  );
  const buffer = Buffer.alloc(SPRITE_DATA_OFFSET + frames.length * 8 + payloadBytes);
  buffer.writeUInt16LE(flags, 0);
  buffer.writeUInt16LE(frames.length, 2);
  buffer.writeUInt32LE(
    compressed ? frames.reduce((total, frame) => total + frame.payload.length, 0) : 0,
    4,
  );

  for (let index = 0; index < 256; index += 1) {
    buffer[8 + index * 3] = index & 0x3f;
    buffer[8 + index * 3 + 1] = (index + 1) & 0x3f;
    buffer[8 + index * 3 + 2] = (index + 2) & 0x3f;
  }

  let dataOffset = SPRITE_DATA_OFFSET + frames.length * 8;
  for (const [index, frame] of frames.entries()) {
    const recordOffset = SPRITE_DATA_OFFSET + index * 8;
    buffer.writeUInt16LE(frame.width, recordOffset);
    buffer.writeUInt16LE(frame.height, recordOffset + 2);
    buffer.writeUInt16LE(frame.anchorX, recordOffset + 4);
    buffer.writeUInt16LE(frame.anchorY, recordOffset + 6);
    if (compressed) {
      buffer.writeUInt32LE(frame.payload.length, dataOffset);
      dataOffset += 4;
    }
    buffer.set(frame.payload, dataOffset);
    dataOffset += frame.payload.length;
  }
  return buffer;
}

test("parses raw indexed frames and their anchors", () => {
  const archive = parseSprite(
    fixture(SPRITE_FLAG_RAW, [
      { width: 2, height: 1, anchorX: 3, anchorY: 4, payload: [0, 2] },
      { width: 1, height: 2, anchorX: 5, anchorY: 6, payload: [3, 4] },
    ]),
  );

  assert.equal(archive.encoding, "raw");
  assert.equal(archive.frames.length, 2);
  assert.deepEqual([...archive.frames[0].indices], [0, 2]);
  assert.deepEqual([...archive.frames[0].alpha], [0, 255]);
  assert.deepEqual([...archive.frames[1].alpha], [255, 255]);
  assert.deepEqual(
    { x: archive.frames[1].anchorX, y: archive.frames[1].anchorY },
    { x: 5, y: 6 },
  );
  assert.deepEqual(archive.palette[1], { red: 1, green: 2, blue: 3 });
});

test("decodes signed controls into literals and transparent spans", () => {
  const archive = parseSprite(
    fixture(SPRITE_FLAG_COMPRESSED, [
      {
        width: 5,
        height: 2,
        anchorX: 9,
        anchorY: 10,
        payload: [0xff, 0x02, 5, 6, 7, 0xff, 0x04, 8, 9, 10, 11, 12],
      },
    ]),
  );

  assert.equal(archive.encoding, "compressed");
  assert.deepEqual([...archive.frames[0].indices], [0, 5, 6, 7, 0, 8, 9, 10, 11, 12]);
  assert.deepEqual([...archive.frames[0].alpha], [0, 255, 255, 255, 0, 255, 255, 255, 255, 255]);
  assert.equal(archive.frames[0].encodedBytes, 12);
});

test("rejects malformed and unsupported archives", () => {
  assert.throws(() => parseSprite(Buffer.alloc(12)), SpriteFormatError);

  const unsupported = fixture(SPRITE_FLAG_RAW, [
    { width: 1, height: 1, anchorX: 0, anchorY: 0, payload: [1] },
  ]);
  unsupported.writeUInt16LE(2, 0);
  assert.throws(() => parseSprite(unsupported), /unsupported SPR flags/);

  const overrun = fixture(SPRITE_FLAG_COMPRESSED, [
    { width: 1, height: 1, anchorX: 0, anchorY: 0, payload: [0x01, 4] },
  ]);
  assert.throws(() => parseSprite(overrun), /literal run exceeds its payload/);
});

test("preserves intentional empty placeholder frames", () => {
  const archive = parseSprite(
    fixture(SPRITE_FLAG_COMPRESSED, [
      { width: 0, height: 0, anchorX: 15, anchorY: 15, payload: [] },
    ]),
  );

  assert.equal(archive.frames[0].indices.length, 0);
  assert.equal(archive.frames[0].alpha.length, 0);
  assert.deepEqual(
    { x: archive.frames[0].anchorX, y: archive.frames[0].anchorY },
    { x: 15, y: 15 },
  );
});
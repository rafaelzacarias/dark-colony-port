import assert from "node:assert/strict";
import test from "node:test";
import { inflateSync } from "node:zlib";

import { encodeRgbaPng } from "./png";

function chunks(png: Buffer): Map<string, Buffer> {
  const result = new Map<string, Buffer>();
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    result.set(type, png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  return result;
}

test("encodes deterministic RGBA PNG scanlines without metadata", () => {
  const rgba = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 0]);
  const first = encodeRgbaPng(2, 1, rgba);
  const second = encodeRgbaPng(2, 1, rgba);
  const parsed = chunks(first);

  assert.deepEqual(first, second);
  assert.deepEqual([...first.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(parsed.get("IHDR")?.readUInt32BE(0), 2);
  assert.equal(parsed.get("IHDR")?.readUInt32BE(4), 1);
  assert.deepEqual([...inflateSync(parsed.get("IDAT")!)], [0, ...rgba]);
  assert.deepEqual([...parsed.keys()], ["IHDR", "IDAT", "IEND"]);
});

test("rejects invalid dimensions and RGBA lengths", () => {
  assert.throws(() => encodeRgbaPng(0, 1, new Uint8Array()), /positive integers/);
  assert.throws(() => encodeRgbaPng(2, 1, new Uint8Array(4)), /needs 8 RGBA bytes/);
});

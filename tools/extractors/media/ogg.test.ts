import assert from "node:assert/strict";
import test from "node:test";

import { canonicalizeOgg, OggFormatError } from "./ogg";

function emptyPage(serial: number): Buffer {
  const page = Buffer.alloc(27);
  page.write("OggS", 0, "ascii");
  page[4] = 0;
  page.writeUInt32LE(serial, 14);
  return page;
}

test("canonicalizes Ogg serials and CRCs deterministically", () => {
  const first = canonicalizeOgg(emptyPage(1), 0x1234_5678);
  const second = canonicalizeOgg(emptyPage(2), 0x1234_5678);
  assert.deepEqual(first, second);
  assert.equal(first.readUInt32LE(14), 0x1234_5678);
  assert.notEqual(first.readUInt32LE(22), 0);
});

test("rejects truncated and invalid Ogg pages", () => {
  assert.throws(() => canonicalizeOgg(Buffer.alloc(10), 1), OggFormatError);
  const invalid = emptyPage(1);
  invalid.write("Nope", 0, "ascii");
  assert.throws(() => canonicalizeOgg(invalid, 1), /missing Ogg capture pattern/);
});

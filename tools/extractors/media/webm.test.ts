import assert from "node:assert/strict";
import test from "node:test";

import { canonicalizeWebm, WebmFormatError } from "./webm";

function fixture(first: number, second: number): Buffer {
  const track = (value: number) => Buffer.concat([Buffer.from([0x73, 0xc5, 0x88]), Buffer.alloc(8, value)]);
  const tag = (value: number) => Buffer.concat([Buffer.from([0x63, 0xc5, 0x88]), Buffer.alloc(8, value)]);
  return Buffer.concat([track(first), track(second), tag(first), tag(second), Buffer.from([0x1f, 0x43, 0xb6, 0x75])]);
}

test("canonicalizes WebM track UIDs and tag copies deterministically", () => {
  const identity = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1));
  const first = canonicalizeWebm(fixture(1, 2), identity);
  const second = canonicalizeWebm(fixture(3, 4), identity);
  assert.deepEqual(first, second);
  assert.deepEqual(first.subarray(3, 11), identity.subarray(0, 8));
  assert.deepEqual(first.subarray(14, 22), identity.subarray(8, 16));
});

test("rejects WebM data without tracks or clusters", () => {
  assert.throws(() => canonicalizeWebm(Buffer.alloc(20), Buffer.alloc(32)), /cluster/);
  assert.throws(
    () => canonicalizeWebm(Buffer.from([0x1f, 0x43, 0xb6, 0x75]), Buffer.alloc(32)),
    WebmFormatError,
  );
});
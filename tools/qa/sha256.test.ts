import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import test, { type TestContext } from "node:test";
import { sha256Hex } from "../../src/sha256";

function stubCrypto(context: TestContext, value: unknown): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value });
  context.after(() => {
    if (original) Object.defineProperty(globalThis, "crypto", original);
    else Reflect.deleteProperty(globalThis, "crypto");
  });
}

const vectors = [
  new Uint8Array(),
  new TextEncoder().encode("abc"),
  Uint8Array.of(255, 0, 1, 127, 128, 254).subarray(1, 5),
  Buffer.from("prefix:mission:suffix").subarray(7, 14),
  ...[55, 56, 63, 64, 65, 127, 128, 1024 * 1024].map(length =>
    Uint8Array.from({ length }, (_, index) => index % 256)),
];

for (const [name, crypto] of [
  ["native Web Crypto", webcrypto],
  ["HTTP crypto without subtle", {}],
  ["missing crypto", undefined],
  ["missing digest", { subtle: {} }],
] as const) {
  test(`SHA-256 matches standard hashes and byte slices with ${name}`, async context => {
    stubCrypto(context, crypto);
    for (const bytes of vectors) {
      const before = bytes.slice();
      const actual = await sha256Hex(bytes);
      assert.match(actual, /^[0-9a-f]{64}$/);
      assert.equal(actual, createHash("sha256").update(bytes).digest("hex"));
      assert.deepEqual(bytes, before);
    }
  });
}

test("SHA-256 uses native digest when available", async context => {
  stubCrypto(context, webcrypto);
  const digest = context.mock.method(webcrypto.subtle, "digest");
  assert.equal(await sha256Hex(new TextEncoder().encode("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(digest.mock.callCount(), 1);
  assert.equal(digest.mock.calls[0].this, webcrypto.subtle);
});

test("SHA-256 propagates native failures instead of masking them with a fallback", async context => {
  stubCrypto(context, webcrypto);
  const failure = new Error("native digest failed");
  context.mock.method(webcrypto.subtle, "digest", async () => { throw failure; });
  await assert.rejects(sha256Hex(Uint8Array.of(1, 2, 3)), error => error === failure);
});

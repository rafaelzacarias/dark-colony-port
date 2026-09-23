import assert from "node:assert/strict";
import test from "node:test";

import { createSpriteAtlas } from "./atlas";
import type { SpriteArchive } from "./spr";

function archive(): SpriteArchive {
  const palette = Array.from({ length: 256 }, (_, index) => ({
    red: index === 1 ? 63 : 0,
    green: index === 2 ? 63 : 0,
    blue: 0,
  }));
  return {
    flags: 0x81,
    encoding: "compressed",
    storedByteCount: 4,
    palette,
    frames: [
      {
        width: 2,
        height: 1,
        anchorX: 3,
        anchorY: 4,
        indices: Uint8Array.from([1, 2]),
        alpha: Uint8Array.from([255, 0]),
        encodedBytes: 3,
      },
      {
        width: 0,
        height: 0,
        anchorX: 7,
        anchorY: 8,
        indices: new Uint8Array(),
        alpha: new Uint8Array(),
        encodedBytes: 0,
      },
      {
        width: 1,
        height: 1,
        anchorX: 5,
        anchorY: 6,
        indices: Uint8Array.from([2]),
        alpha: Uint8Array.from([255]),
        encodedBytes: 1,
      },
    ],
  };
}

test("packs frames deterministically and preserves palette indices and transparency", () => {
  const atlas = createSpriteAtlas(archive(), { maximumWidth: 2, padding: 1 });

  assert.equal(atlas.paletteScale, "6-bit");
  assert.deepEqual(
    atlas.frames.map(({ x, y, width, height, empty }) => ({ x, y, width, height, empty })),
    [
      { x: 0, y: 0, width: 2, height: 1, empty: false },
      { x: 0, y: 0, width: 0, height: 0, empty: true },
      { x: 0, y: 2, width: 1, height: 1, empty: false },
    ],
  );
  assert.equal(atlas.width, 2);
  assert.equal(atlas.height, 3);
  assert.deepEqual([...atlas.rgba.subarray(0, 8)], [255, 0, 0, 255, 0, 255, 0, 0]);
  assert.deepEqual([...atlas.rgba.subarray(16, 20)], [0, 255, 0, 255]);
});
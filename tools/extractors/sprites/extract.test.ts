import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { extractSpriteTree } from "./extract";
import { SPRITE_DATA_OFFSET, SPRITE_FLAG_COMPRESSED } from "./spr";

function onePixelSprite(): Buffer {
  const buffer = Buffer.alloc(SPRITE_DATA_OFFSET + 8 + 4 + 2);
  buffer.writeUInt16LE(SPRITE_FLAG_COMPRESSED, 0);
  buffer.writeUInt16LE(1, 2);
  buffer.writeUInt32LE(2, 4);
  buffer[8 + 4 * 3] = 63;
  buffer.writeUInt16LE(1, SPRITE_DATA_OFFSET);
  buffer.writeUInt16LE(1, SPRITE_DATA_OFFSET + 2);
  buffer.writeUInt16LE(2, SPRITE_DATA_OFFSET + 4);
  buffer.writeUInt16LE(3, SPRITE_DATA_OFFSET + 6);
  buffer.writeUInt32LE(2, SPRITE_DATA_OFFSET + 8);
  buffer[SPRITE_DATA_OFFSET + 12] = 0;
  buffer[SPRITE_DATA_OFFSET + 13] = 4;
  return buffer;
}

test("extracts a sprite tree into deterministic PNG and JSON artifacts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dark-colony-sprites-"));
  const source = path.join(root, "source");
  const output = path.join(root, "output");

  try {
    await import("node:fs/promises").then(({ mkdir }) => mkdir(path.join(source, "SPRITES"), { recursive: true }));
    await writeFile(path.join(source, "SPRITES", "DOT.SPR"), onePixelSprite());

    const first = await extractSpriteTree(source, output);
    const firstPng = await readFile(path.join(output, "SPRITES", "DOT.png"));
    const firstMetadata = await readFile(path.join(output, "SPRITES", "DOT.json"), "utf8");
    const second = await extractSpriteTree(source, output);
    const secondPng = await readFile(path.join(output, "SPRITES", "DOT.png"));
    const secondMetadata = await readFile(path.join(output, "SPRITES", "DOT.json"), "utf8");

    assert.deepEqual(second, first);
    assert.deepEqual(secondPng, firstPng);
    assert.equal(secondMetadata, firstMetadata);
    assert.equal(first.archiveCount, 1);
    assert.equal(first.frameCount, 1);
    assert.match(first.archives[0].sourceSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(JSON.parse(firstMetadata).frames[0], {
      index: 0,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      anchorX: 2,
      anchorY: 3,
      encodedBytes: 2,
      empty: false,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

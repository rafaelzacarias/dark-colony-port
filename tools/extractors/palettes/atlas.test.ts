import assert from "node:assert/strict";
import { test } from "node:test";
import { createSpriteAtlas } from "../sprites/atlas";
import { parseSprite, SPRITE_DATA_OFFSET } from "../sprites/spr";
import { parseTerrainBank, BTS_DATA_OFFSET } from "../maps/bts";
import { createIndexedSpriteAtlas, createIndexedTerrainAtlas } from "./atlas";

function sprite(compressed: boolean) {
  const payload = Buffer.from(compressed ? [1, 0, 7, 255, 2, 9, 0, 3] : [0, 7, 0, 9, 0, 3]);
  const bytes = Buffer.alloc(SPRITE_DATA_OFFSET + 16 + (compressed ? 8 : 0) + payload.length);
  bytes.writeUInt16LE(compressed ? 0x81 : 1, 0);
  bytes.writeUInt16LE(2, 2);
  bytes.writeUInt32LE(compressed ? payload.length : 0, 4);
  bytes.writeUInt16LE(3, SPRITE_DATA_OFFSET);
  bytes.writeUInt16LE(2, SPRITE_DATA_OFFSET + 2);
  bytes.writeUInt16LE(11, SPRITE_DATA_OFFSET + 4);
  bytes.writeUInt16LE(17, SPRITE_DATA_OFFSET + 6);
  const offset = SPRITE_DATA_OFFSET + 16;
  if (compressed) bytes.writeUInt32LE(payload.length, offset);
  payload.copy(bytes, offset + (compressed ? 4 : 0));
  return parseSprite(bytes);
}

test("indexed SPR keeps asymmetric source rows, literal-zero coverage, anchors and empty frames", () => {
  for (const compressed of [true, false]) {
    const archive = sprite(compressed);
    const atlas = createIndexedSpriteAtlas(archive);
    const existing = createSpriteAtlas(archive);
    assert.equal(atlas.width, existing.width);
    assert.equal(atlas.height, existing.height);
    assert.deepEqual(atlas.frames, existing.frames);
    assert.deepEqual([...atlas.indices], [0, 7, 0, 9, 0, 3]);
    assert.deepEqual([...atlas.coverage], compressed ? [255, 255, 0, 255, 255, 255] : [0, 255, 0, 255, 0, 255]);
    assert.equal(atlas.frames[0].anchorY, 17);
    assert.equal(atlas.frames[1].empty, true);
  }
});

test("indexed BTS keeps source record order, key fallback and distinct layer coverage", () => {
  const bytes = Buffer.alloc(BTS_DATA_OFFSET + 2 * 1028);
  bytes.writeUInt32LE(8, 0);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(5, BTS_DATA_OFFSET);
  bytes.writeUInt32LE(2, BTS_DATA_OFFSET + 1028);
  bytes[BTS_DATA_OFFSET + 4 + 1] = 7;
  bytes[BTS_DATA_OFFSET + 4 + 32] = 19;
  bytes[BTS_DATA_OFFSET + 1028 + 4] = 31;
  const atlas = createIndexedTerrainAtlas(parseTerrainBank(bytes), 1);
  assert.deepEqual([atlas.width, atlas.height], [32, 64]);
  assert.deepEqual([atlas.indices[0], atlas.indices[1], atlas.indices[32], atlas.indices[1024]], [0, 7, 19, 31]);
  assert.equal(atlas.backgroundCoverage[0], 255);
  assert.equal(atlas.foregroundCoverage[0], 0);
  assert.equal(atlas.foregroundCoverage[1], 255);
  assert.deepEqual(atlas.keyToRecord, [0, 0, 1, 0, 0, 0, 0, 0]);
  assert.deepEqual(atlas.tiles.map(({ key }) => key), [5, 2]);
});
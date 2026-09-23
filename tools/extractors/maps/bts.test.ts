import assert from "node:assert/strict";
import test from "node:test";

import { BTS_DATA_OFFSET, parseTerrainBank, resolveTerrainReferences, TerrainBankFormatError } from "./bts";

function fixture(): Buffer {
  const buffer = Buffer.alloc(BTS_DATA_OFFSET + 2 * 1028);
  buffer.writeUInt32LE(20, 0);
  buffer.writeUInt32LE(2, 4);
  buffer[8 + 3] = 63;
  buffer.writeUInt32LE(3, BTS_DATA_OFFSET);
  buffer.fill(1, BTS_DATA_OFFSET + 4, BTS_DATA_OFFSET + 1028);
  buffer.writeUInt32LE(19, BTS_DATA_OFFSET + 1028);
  buffer.fill(2, BTS_DATA_OFFSET + 1032);
  return buffer;
}

test("parses keyed raw 32x32 BTS tiles and embedded palettes", () => {
  const bank = parseTerrainBank(fixture());
  assert.equal(bank.keySpace, 20);
  assert.equal(bank.paletteScale, "6-bit");
  assert.deepEqual(bank.tiles.map(({ key }) => key), [3, 19]);
  assert.equal(bank.tiles[0].indices.length, 1024);
  assert.equal(bank.tiles[1].indices[1023], 2);
});

test("rejects truncated, duplicate, and out-of-range BTS records", () => {
  assert.throws(() => parseTerrainBank(Buffer.alloc(20)), TerrainBankFormatError);
  const duplicate = fixture();
  duplicate.writeUInt32LE(3, BTS_DATA_OFFSET + 1028);
  assert.throws(() => parseTerrainBank(duplicate), /duplicate BTS tile key/);
  const outOfRange = fixture();
  outOfRange.writeUInt32LE(20, BTS_DATA_OFFSET);
  assert.throws(() => parseTerrainBank(outOfRange), /exceeds key space/);
});

test("reproduces the executable's zero-initialized key-to-record lookup without hiding missing keys", () => {
  const bank = parseTerrainBank(fixture());
  const result = resolveTerrainReferences(bank, Uint16Array.from([19, 0, 3, 9, 9, 19]));
  assert.deepEqual([...result.recordIndices], [1, 0, 0, 0, 0, 1]);
  assert.deepEqual(result.missingKeys, [{ key: 9, backgroundCount: 1, foregroundCount: 1 }]);
  assert.throws(() => resolveTerrainReferences(bank, Uint16Array.from([20, 0])), /exceeds BTS key space/);
  assert.throws(() => resolveTerrainReferences(bank, Uint16Array.from([3])), /must be pairs/);
});
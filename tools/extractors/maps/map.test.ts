import assert from "node:assert/strict";
import test from "node:test";

import { mapCellIndex, mapCellReferences, MapFormatError, parseMapBundle } from "./map";

function fixtures() {
  const width = 2;
  const height = 2;
  const map = Buffer.alloc(8 + width * height * 6);
  map.writeUInt32LE(width, 0);
  map.writeUInt32LE(height, 4);
  const references = [1, 0, 2, 0, 3, 0, 4, 5, 0x1ce0, 0x1c81, 0x1cc0, 0x5e2a];
  references.forEach((value, index) => map.writeUInt16LE(value, 8 + index * 2));
  const mtg = Buffer.from([width, height, 10, 11, 12, 13]);
  const pth = Buffer.alloc(65_536 + width * height);
  pth.set([20, 21, 22, 23], 65_536);
  return { map, mtg, pth };
}

test("parses MAP background/foreground pairs followed by a separate attribute plane", () => {
  const source = fixtures();
  const map = parseMapBundle(source.map, source.mtg, source.pth);

  assert.deepEqual([map.width, map.height], [2, 2]);
  assert.equal(mapCellIndex(map, 1, 1), 3);
  assert.deepEqual(mapCellReferences(map, 0, 0), [1, 0]);
  assert.deepEqual(mapCellReferences(map, 0, 1), [3, 0]);
  assert.deepEqual(mapCellReferences(map, 1, 1), [4, 5]);
  assert.deepEqual([...map.tileReferences], [1, 0, 2, 0, 3, 0, 4, 5]);
  assert.deepEqual([...map.attributes], [0x1ce0, 0x1c81, 0x1cc0, 0x5e2a]);
  assert.deepEqual([...map.tagGrid], [10, 11, 12, 13]);
  assert.deepEqual([...map.pathGrid], [20, 21, 22, 23]);
  assert.equal(map.pathPreamble.length, 65_536);
});

test("rejects malformed dimensions, lengths, and coordinates", () => {
  const source = fixtures();
  assert.throws(() => parseMapBundle(source.map.subarray(0, 7), source.mtg, source.pth), MapFormatError);
  assert.throws(() => parseMapBundle(source.map, source.mtg.subarray(0, 5), source.pth), /MTG size/);
  assert.throws(() => parseMapBundle(source.map, source.mtg, source.pth.subarray(1)), /PTH size/);
  const map = parseMapBundle(source.map, source.mtg, source.pth);
  assert.throws(() => mapCellIndex(map, 2, 0), RangeError);
});

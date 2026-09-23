import assert from "node:assert/strict";
import test from "node:test";

import { MdsFormatError, parseMds } from "./mds";
import { mdsFixture } from "./test-fixtures";

test("parses MDS audio geometry with sector-aligned image ranges", () => {
  const layout = parseMds(mdsFixture(), 2 * 2448);
  assert.equal(layout.audioTracks.length, 1);
  assert.deepEqual(layout.audioTracks[0], {
    number: 2,
    mode: 0xa9,
    adrControl: 0x10,
    sectorSize: 2448,
    startSector: 150,
    startOffset: 0,
    endOffset: 4896,
    sectorCount: 2,
  });
});

test("rejects invalid signatures and unaligned track ranges", () => {
  assert.throws(() => parseMds(Buffer.alloc(100), 100), MdsFormatError);
  assert.throws(() => parseMds(mdsFixture(), 4895), /not sector aligned/);
});

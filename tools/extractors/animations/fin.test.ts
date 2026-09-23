import assert from "node:assert/strict";
import test from "node:test";

import { FinFormatError, parseFin, UnsupportedFinVariantError } from "./fin";

function writeName(buffer: Buffer, offset: number, length: number, value: string): void {
  buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), "ascii");
}

function fixture(includeOrphan = false): Buffer {
  const headerBytes = 8;
  const spriteBytes = 8;
  const stateBytes = 20;
  const timelineBytes = 164;
  const childBytes = includeOrphan ? 44 : 22;
  const buffer = Buffer.alloc(headerBytes + spriteBytes + stateBytes + timelineBytes + childBytes);
  buffer.writeInt16LE(29, 0);
  buffer.writeUInt16LE(1, 2);
  buffer.writeUInt16LE(1, 4);
  buffer.writeUInt16LE(1, 6);
  writeName(buffer, 8, 8, "dott");
  writeName(buffer, 16, 16, "DOTTSTAND0");
  buffer.writeUInt16LE(0, 32);
  buffer.writeUInt16LE(0, 34);
  buffer.writeUInt16LE(1, 36);
  buffer.writeUInt16LE(7, 38);
  writeName(buffer, 40, 16, "FLASH");
  buffer.writeUInt16LE(2, 56);
  buffer.writeUInt16LE(3, 58);

  const childOffset = 200;
  writeName(buffer, childOffset, 8, "dott");
  buffer.writeUInt16LE(4, childOffset + 8);
  buffer.writeInt16LE(-5, childOffset + 10);
  buffer.writeInt16LE(6, childOffset + 12);
  buffer.writeInt16LE(2, childOffset + 14);
  buffer.writeUInt16LE(16, childOffset + 16);
  buffer.writeUInt16LE(1, childOffset + 18);
  buffer.writeUInt16LE(9, childOffset + 20);
  if (includeOrphan) writeName(buffer, childOffset + 22, 8, "extra");
  return buffer;
}

test("parses standard FIN states, timeline events, and child sprite placements", () => {
  const animation = parseFin(fixture());

  assert.deepEqual(animation.spriteNames, ["dott"]);
  assert.deepEqual(animation.states, [
    { name: "DOTTSTAND0", firstTimelineIndex: 0, lastTimelineIndex: 0, validRange: true },
  ]);
  assert.deepEqual(animation.timeline[0], {
    index: 0,
    field2: 7,
    events: [{ slot: 0, name: "FLASH", valueA: 2, valueB: 3 }],
    children: [
      {
        sprite: "dott",
        frame: 4,
        x: -5,
        y: 6,
        layer: 2,
        flags: 16,
        valueA: 1,
        valueB: 9,
      },
    ],
  });
  assert.deepEqual(animation.orphanChildren, []);
});

test("preserves orphan child records from shipped authoring anomalies", () => {
  const animation = parseFin(fixture(true));
  assert.equal(animation.orphanChildren.length, 1);
  assert.equal(animation.orphanChildren[0].sprite, "extra");
});

test("rejects legacy variants and truncated child tables", () => {
  const legacy = fixture();
  legacy.writeInt16LE(-3, 0);
  assert.throws(() => parseFin(legacy), UnsupportedFinVariantError);

  const truncated = fixture().subarray(0, 210);
  assert.throws(() => parseFin(truncated), FinFormatError);
});
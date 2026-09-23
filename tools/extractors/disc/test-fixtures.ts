import assert from "node:assert/strict";

export function mdsFixture(startOffset = 0, sectors = 2): Buffer {
  const sessionOffset = 0x58;
  const blocksOffset = 0x70;
  const trackOffset = blocksOffset + 3 * 0x50;
  const buffer = Buffer.alloc(trackOffset + 0x50);
  buffer.write("MEDIA DESCRIPTOR", 0, "ascii");
  buffer.writeUInt32LE(sessionOffset, 0x50);
  buffer.writeUInt16LE(1, sessionOffset + 8);
  buffer[sessionOffset + 10] = 4;
  buffer[sessionOffset + 11] = 3;
  buffer.writeUInt16LE(2, sessionOffset + 12);
  buffer.writeUInt16LE(2, sessionOffset + 14);
  buffer.writeUInt32LE(blocksOffset, sessionOffset + 20);
  buffer[trackOffset] = 0xa9;
  buffer[trackOffset + 2] = 0x10;
  buffer[trackOffset + 4] = 2;
  buffer.writeUInt16LE(2448, trackOffset + 16);
  buffer.writeUInt32LE(150, trackOffset + 36);
  buffer.writeBigUInt64LE(BigInt(startOffset), trackOffset + 40);
  buffer.writeUInt32LE(1, trackOffset + 48);
  assert.equal(startOffset + sectors * 2448, sectors * 2448);
  return buffer;
}
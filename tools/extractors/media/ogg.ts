const OGG_CAPTURE_PATTERN = "OggS";
const OGG_HEADER_BYTES = 27;
const OGG_CRC_POLYNOMIAL = 0x04c1_1db7;

const OGG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index << 24;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 0x8000_0000) !== 0 ? (value << 1) ^ OGG_CRC_POLYNOMIAL : value << 1;
  }
  return value >>> 0;
});

export class OggFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OggFormatError";
  }
}

function pageCrc(page: Uint8Array): number {
  let crc = 0;
  for (const byte of page) {
    crc = ((crc << 8) ^ OGG_CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]) >>> 0;
  }
  return crc;
}

export function canonicalizeOgg(source: Uint8Array, serial: number): Buffer {
  const output = Buffer.from(source);
  let offset = 0;
  while (offset < output.length) {
    if (offset + OGG_HEADER_BYTES > output.length) {
      throw new OggFormatError(`truncated Ogg page header at byte ${offset}`);
    }
    if (output.toString("ascii", offset, offset + 4) !== OGG_CAPTURE_PATTERN) {
      throw new OggFormatError(`missing Ogg capture pattern at byte ${offset}`);
    }
    const segmentCount = output[offset + 26];
    if (offset + OGG_HEADER_BYTES + segmentCount > output.length) {
      throw new OggFormatError(`truncated Ogg lacing table at byte ${offset}`);
    }
    let bodyBytes = 0;
    for (let index = 0; index < segmentCount; index += 1) {
      bodyBytes += output[offset + OGG_HEADER_BYTES + index];
    }
    const pageBytes = OGG_HEADER_BYTES + segmentCount + bodyBytes;
    if (offset + pageBytes > output.length) {
      throw new OggFormatError(`truncated Ogg page body at byte ${offset}`);
    }

    output.writeUInt32LE(serial >>> 0, offset + 14);
    output.writeUInt32LE(0, offset + 22);
    output.writeUInt32LE(pageCrc(output.subarray(offset, offset + pageBytes)), offset + 22);
    offset += pageBytes;
  }
  return output;
}

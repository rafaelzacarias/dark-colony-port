const MDS_SIGNATURE = "MEDIA DESCRIPTOR";
const MDS_SESSION_OFFSET_FIELD = 0x50;
const MDS_TRACK_BLOCK_BYTES = 0x50;
const AUDIO_MODE = 0xa9;

export interface MdsTrack {
  readonly number: number;
  readonly mode: number;
  readonly adrControl: number;
  readonly sectorSize: number;
  readonly startSector: number;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly sectorCount: number;
}

export interface MdsLayout {
  readonly sessionNumber: number;
  readonly firstTrack: number;
  readonly lastTrack: number;
  readonly tracks: readonly MdsTrack[];
  readonly audioTracks: readonly MdsTrack[];
}

type RawMdsTrack = Omit<MdsTrack, "endOffset" | "sectorCount">;

export class MdsFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MdsFormatError";
  }
}

function assertAvailable(buffer: Buffer, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > buffer.length) {
    throw new MdsFormatError(`${label} is truncated at byte ${offset}`);
  }
}

export function parseMds(source: Uint8Array, imageBytes: number): MdsLayout {
  const buffer = Buffer.from(source.buffer, source.byteOffset, source.byteLength);
  assertAvailable(buffer, 0, 16, "MDS signature");
  if (buffer.toString("ascii", 0, 16) !== MDS_SIGNATURE) {
    throw new MdsFormatError("invalid MDS signature");
  }
  assertAvailable(buffer, MDS_SESSION_OFFSET_FIELD, 4, "MDS session pointer");
  const sessionOffset = buffer.readUInt32LE(MDS_SESSION_OFFSET_FIELD);
  assertAvailable(buffer, sessionOffset, 24, "MDS session block");
  const sessionNumber = buffer.readUInt16LE(sessionOffset + 8);
  const nonTrackBlocks = buffer[sessionOffset + 11];
  const firstTrack = buffer.readUInt16LE(sessionOffset + 12);
  const lastTrack = buffer.readUInt16LE(sessionOffset + 14);
  const blocksOffset = buffer.readUInt32LE(sessionOffset + 20);
  if (firstTrack === 0 || lastTrack < firstTrack) {
    throw new MdsFormatError(`invalid MDS track range ${firstTrack}-${lastTrack}`);
  }

  const rawTracks: RawMdsTrack[] = [];
  for (let number = firstTrack; number <= lastTrack; number += 1) {
    const offset =
      blocksOffset + (nonTrackBlocks + number - firstTrack) * MDS_TRACK_BLOCK_BYTES;
    assertAvailable(buffer, offset, MDS_TRACK_BLOCK_BYTES, `MDS track ${number}`);
    const startOffsetBig = buffer.readBigUInt64LE(offset + 40);
    if (startOffsetBig > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new MdsFormatError(`track ${number} offset exceeds JavaScript integer range`);
    }
    rawTracks.push({
      number,
      mode: buffer[offset],
      adrControl: buffer[offset + 2],
      sectorSize: buffer.readUInt16LE(offset + 16),
      startSector: buffer.readUInt32LE(offset + 36),
      startOffset: Number(startOffsetBig),
    });
  }

  const tracks: MdsTrack[] = rawTracks.map((track, index) => {
    const endOffset = rawTracks[index + 1]?.startOffset ?? imageBytes;
    if (track.sectorSize === 0 || track.startOffset < 0 || endOffset > imageBytes || endOffset < track.startOffset) {
      throw new MdsFormatError(`invalid byte range for track ${track.number}`);
    }
    const byteCount = endOffset - track.startOffset;
    if (byteCount % track.sectorSize !== 0) {
      throw new MdsFormatError(`track ${track.number} byte range is not sector aligned`);
    }
    return { ...track, endOffset, sectorCount: byteCount / track.sectorSize };
  });

  return {
    sessionNumber,
    firstTrack,
    lastTrack,
    tracks,
    audioTracks: tracks.filter(({ mode }) => mode === AUDIO_MODE),
  };
}

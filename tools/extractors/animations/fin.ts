const FIN_HEADER_BYTES = 8;
const SPRITE_NAME_BYTES = 8;
const STATE_RECORD_BYTES = 20;
const TIMELINE_RECORD_BYTES = 164;
const EVENT_SLOT_COUNT = 8;
const EVENT_RECORD_BYTES = 20;
const CHILD_RECORD_BYTES = 22;
const STANDARD_FORMAT_TAG = 29;

export interface FinState {
  readonly name: string;
  readonly firstTimelineIndex: number;
  readonly lastTimelineIndex: number;
  readonly validRange: boolean;
}

export interface FinEvent {
  readonly slot: number;
  readonly name: string;
  readonly valueA: number;
  readonly valueB: number;
}

export interface FinChild {
  readonly sprite: string;
  readonly frame: number;
  readonly x: number;
  readonly y: number;
  readonly layer: number;
  readonly flags: number;
  readonly valueA: number;
  readonly valueB: number;
}

export interface FinTimelineEntry {
  readonly index: number;
  readonly field2: number;
  readonly events: readonly FinEvent[];
  readonly children: readonly FinChild[];
}

export interface FinAnimation {
  readonly formatTag: 29;
  readonly spriteNames: readonly string[];
  readonly states: readonly FinState[];
  readonly timeline: readonly FinTimelineEntry[];
  readonly orphanChildren: readonly FinChild[];
}

export class FinFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinFormatError";
  }
}

export class UnsupportedFinVariantError extends FinFormatError {
  readonly formatTag: number;

  constructor(formatTag: number) {
    super(`unsupported FIN format tag ${formatTag}`);
    this.name = "UnsupportedFinVariantError";
    this.formatTag = formatTag;
  }
}

function assertAvailable(buffer: Buffer, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > buffer.length) {
    throw new FinFormatError(
      `${label} is truncated at byte ${offset}; need ${length} bytes, file has ${buffer.length}`,
    );
  }
}

function fixedAscii(buffer: Buffer, offset: number, length: number): string {
  assertAvailable(buffer, offset, length, "FIN string");
  const bytes = buffer.subarray(offset, offset + length);
  const terminator = bytes.indexOf(0);
  return bytes.subarray(0, terminator < 0 ? bytes.length : terminator).toString("ascii");
}

function parseChild(buffer: Buffer, offset: number): FinChild {
  assertAvailable(buffer, offset, CHILD_RECORD_BYTES, "FIN child record");
  return {
    sprite: fixedAscii(buffer, offset, SPRITE_NAME_BYTES),
    frame: buffer.readUInt16LE(offset + 8),
    x: buffer.readInt16LE(offset + 10),
    y: buffer.readInt16LE(offset + 12),
    layer: buffer.readInt16LE(offset + 14),
    flags: buffer.readUInt16LE(offset + 16),
    valueA: buffer.readUInt16LE(offset + 18),
    valueB: buffer.readUInt16LE(offset + 20),
  };
}

export function parseFin(source: Uint8Array): FinAnimation {
  const buffer = Buffer.from(source.buffer, source.byteOffset, source.byteLength);
  assertAvailable(buffer, 0, FIN_HEADER_BYTES, "FIN header");

  const formatTag = buffer.readInt16LE(0);
  if (formatTag !== STANDARD_FORMAT_TAG) throw new UnsupportedFinVariantError(formatTag);

  const timelineCount = buffer.readUInt16LE(2);
  const stateCount = buffer.readUInt16LE(4);
  const spriteCount = buffer.readUInt16LE(6);
  const spriteTableOffset = FIN_HEADER_BYTES;
  const stateTableOffset = spriteTableOffset + spriteCount * SPRITE_NAME_BYTES;
  const timelineOffset = stateTableOffset + stateCount * STATE_RECORD_BYTES;
  const childTableOffset = timelineOffset + timelineCount * TIMELINE_RECORD_BYTES;
  assertAvailable(buffer, spriteTableOffset, spriteCount * SPRITE_NAME_BYTES, "FIN sprite table");
  assertAvailable(buffer, stateTableOffset, stateCount * STATE_RECORD_BYTES, "FIN state table");
  assertAvailable(buffer, timelineOffset, timelineCount * TIMELINE_RECORD_BYTES, "FIN timeline table");

  const spriteNames = Array.from({ length: spriteCount }, (_, index) =>
    fixedAscii(buffer, spriteTableOffset + index * SPRITE_NAME_BYTES, SPRITE_NAME_BYTES),
  );
  const states = Array.from({ length: stateCount }, (_, index): FinState => {
    const offset = stateTableOffset + index * STATE_RECORD_BYTES;
    const firstTimelineIndex = buffer.readUInt16LE(offset + 16);
    const lastTimelineIndex = buffer.readUInt16LE(offset + 18);
    return {
      name: fixedAscii(buffer, offset, 16),
      firstTimelineIndex,
      lastTimelineIndex,
      validRange:
        firstTimelineIndex <= lastTimelineIndex && lastTimelineIndex < timelineCount,
    };
  });

  const timelineHeaders = Array.from({ length: timelineCount }, (_, index) => {
    const offset = timelineOffset + index * TIMELINE_RECORD_BYTES;
    const childCount = buffer.readUInt16LE(offset);
    const events: FinEvent[] = [];
    for (let slot = 0; slot < EVENT_SLOT_COUNT; slot += 1) {
      const eventOffset = offset + 4 + slot * EVENT_RECORD_BYTES;
      const name = fixedAscii(buffer, eventOffset, 16);
      const valueA = buffer.readUInt16LE(eventOffset + 16);
      const valueB = buffer.readUInt16LE(eventOffset + 18);
      if ((name !== "" && name !== "NONAME") || valueA !== 0 || valueB !== 0) {
        events.push({ slot, name, valueA, valueB });
      }
    }
    return {
      index,
      childCount,
      field2: buffer.readUInt16LE(offset + 2),
      events,
    };
  });

  const expectedChildCount = timelineHeaders.reduce((total, entry) => total + entry.childCount, 0);
  const childBytes = buffer.length - childTableOffset;
  if (childBytes < 0 || childBytes % CHILD_RECORD_BYTES !== 0) {
    throw new FinFormatError(`FIN child table has invalid size ${childBytes}`);
  }
  const actualChildCount = childBytes / CHILD_RECORD_BYTES;
  if (actualChildCount < expectedChildCount) {
    throw new FinFormatError(
      `FIN timeline needs ${expectedChildCount} child records; file contains ${actualChildCount}`,
    );
  }

  const allChildren = Array.from({ length: actualChildCount }, (_, index) =>
    parseChild(buffer, childTableOffset + index * CHILD_RECORD_BYTES),
  );
  let childIndex = 0;
  const timeline = timelineHeaders.map(({ index, childCount, field2, events }) => {
    const children = allChildren.slice(childIndex, childIndex + childCount);
    childIndex += childCount;
    return { index, field2, events, children };
  });

  return {
    formatTag: STANDARD_FORMAT_TAG,
    spriteNames,
    states,
    timeline,
    orphanChildren: allChildren.slice(childIndex),
  };
}

export interface LegacyNativePendingMoveFrame {
  readonly boundary: 0x4157ec;
  readonly index: number;
  readonly slot: number;
  readonly registeredSlot: number;
  readonly raw: Uint8Array;
  readonly rngCursor: number;
  readonly task6Budget: number;
}

export interface LegacyNativePendingMoveCommand {
  readonly kind: "native-pending-move-task8";
  readonly boundary: 0x416104;
  readonly nextOwner: "native-registered-rnat-task8";
  readonly registeredVisitComplete: false;
  readonly index: number;
  readonly slot: number;
  readonly expectedRaw: readonly number[];
  readonly raw: readonly number[];
  readonly rngCursor: number;
  readonly budgetBefore: number;
  readonly task6Budget: number;
}

const integer = (value: number, maximum: number) => Number.isInteger(value) && value >= 0 && value <= maximum;
const commands = new WeakSet<LegacyNativePendingMoveCommand>();

export function reduceLegacyNativePendingMove(frame: LegacyNativePendingMoveFrame): LegacyNativePendingMoveCommand {
  const { raw } = frame;
  if (frame.boundary !== 0x4157ec || !integer(frame.index, 799) || !integer(frame.slot, 799)
    || frame.slot < 152 || frame.registeredSlot !== frame.slot || !integer(frame.rngCursor, 255)
    || !integer(frame.task6Budget, 9) || raw.length !== 220)
    throw new RangeError("Invalid native pending move caller");
  const actor = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const depth = raw[0x38], start = raw[0x3a + depth * 2], end = raw[0x3c + depth * 2];
  if (raw[6] !== 25 || raw[7] !== 9 || raw[0x2c] !== 1 || actor.getInt32(12, true) <= 0
    || raw[0x36] !== 1 || raw[0x37] !== 7 || raw[0xcb] !== 0 || raw[0xc6] < 1 || raw[0xc6] > 8
    || depth > 4 || raw[0x39 + depth * 2] !== 6 || start > 24 || end - start !== 8)
    throw new RangeError("Unsupported native task6 pending move");
  const next = Uint8Array.from(raw), record = new DataView(next.buffer);
  next[0x39] = 7; next[0x3a] = 0; next[0x38] = 1; next[0x36] = 0;
  next[0x3b] = 8; next[0x3c] = 0; next[0x3e] = 2;
  record.setUint16(0x46, 0, true); record.setUint16(0x48, 1, true);
  next[0x37] = 255;
  const command: LegacyNativePendingMoveCommand = Object.freeze({ kind: "native-pending-move-task8", boundary: 0x416104,
    nextOwner: "native-registered-rnat-task8", registeredVisitComplete: false, index: frame.index, slot: frame.slot,
    expectedRaw: Object.freeze([...raw]), raw: Object.freeze([...next]), rngCursor: frame.rngCursor,
    budgetBefore: frame.task6Budget, task6Budget: frame.task6Budget + 1 });
  commands.add(command);
  return command;
}

export function resolveLegacyNativePendingMove(command: LegacyNativePendingMoveCommand,
  current: LegacyNativePendingMoveFrame): LegacyNativePendingMoveCommand {
  if (!commands.has(command) || current.boundary !== 0x4157ec || current.index !== command.index
    || current.slot !== command.slot || current.registeredSlot !== command.slot || current.rngCursor !== command.rngCursor
    || current.task6Budget !== command.budgetBefore || current.raw.length !== 220
    || command.expectedRaw.some((value, offset) => current.raw[offset] !== value))
    throw new RangeError("Stale or unauthenticated native pending move command");
  return command;
}
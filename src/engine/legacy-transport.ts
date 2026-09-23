export type TransportPosition = Readonly<{ x: number; y: number }>;
export type TransportGroup = Readonly<{ type: number; count: number }>;
export type TransportGroups = readonly [TransportGroup, TransportGroup, TransportGroup, TransportGroup, TransportGroup];
export type TransportCommander = Readonly<{ slot: number; status: number; position: TransportPosition }>;
export type TransportPhase = "descent" | "orientation" | "approach" | "deliver" | "pickup" | "departure" | "pool-release" | "released";

export interface TransportCarrier {
  readonly id: number;
  readonly poolIndex: number;
  readonly slot: number;
  readonly team: number;
  readonly entityTeam: 8;
  readonly type: 92 | 93;
  readonly originTile: TransportPosition;
  readonly position: TransportPosition;
  readonly destination: TransportPosition;
  readonly height: number;
  readonly step: number;
  readonly phase: TransportPhase;
  readonly payloadPhase: 0 | 1 | 2;
  readonly groups: readonly TransportGroup[];
  readonly cursor: number;
  readonly commanderSlot: number | null;
  readonly awaiting: "occupancy" | "creation" | "position" | "commander" | null;
}

export interface TransportState {
  readonly nextId: number;
  readonly carriers: readonly TransportCarrier[];
}

type RequestOptions = {
  readonly team: number;
  readonly side: number;
  readonly directionBits: readonly [0 | 1, 0 | 1];
};

export type TransportCommand =
  | (RequestOptions & { readonly type: "reinforce"; readonly tile: TransportPosition; readonly groups: TransportGroups })
  | (RequestOptions & { readonly type: "abduct"; readonly commander: TransportCommander | null })
  | { readonly type: "invoke" | "oriented" | "arrived"; readonly id: number }
  | { readonly type: "occupancy"; readonly id: number; readonly vacant: boolean }
  | { readonly type: "created"; readonly id: number; readonly success: boolean }
  | { readonly type: "next-position"; readonly id: number; readonly position: TransportPosition | null }
  | { readonly type: "commander"; readonly id: number; readonly commander: TransportCommander | null };

export type TransportEffect =
  | { readonly type: "diagnostic"; readonly code: "invalid-request" | "invalid-commander" | "pool-full" | "no-match" | "unexpected-reply" | "no-position" | "creation-failed"; readonly id?: number }
  | { readonly type: "initialize-carrier"; readonly carrier: TransportCarrier }
  | { readonly type: "height"; readonly id: number; readonly height: number }
  | { readonly type: "descent-complete" | "approach-complete" | "ascent-complete"; readonly id: number }
  | { readonly type: "orient" | "move"; readonly id: number; readonly destination: TransportPosition }
  | { readonly type: "inspect-occupancy"; readonly id: number; readonly position: TransportPosition }
  | { readonly type: "create-unit"; readonly id: number; readonly team: number; readonly unitType: number; readonly position: TransportPosition }
  | { readonly type: "select-position"; readonly id: number; readonly originTile: TransportPosition; readonly plane: "ground" }
  | { readonly type: "inspect-commander"; readonly id: number; readonly slot: number }
  | { readonly type: "remove-noncombat"; readonly id: number; readonly slot: number; readonly status: 10; readonly task: 10; readonly taskWords: readonly [1, 0]; readonly combatLoss: false }
  | { readonly type: "clear-collision"; readonly id: number; readonly slot: number }
  | { readonly type: "carrier-released"; readonly id: number; readonly team: number; readonly poolIndex: number; readonly slot: number; readonly idleTask: 3; readonly idleCount: 60 };

export interface TransportResult {
  readonly state: TransportState;
  readonly effects: readonly TransportEffect[];
  readonly redispatch: boolean;
}

const unsigned = (value: number, maximum: number): boolean => Number.isInteger(value) && value >= 0 && value <= maximum;
const validPosition = (position: TransportPosition, maximum = 65535): boolean => unsigned(position.x, maximum) && unsigned(position.y, maximum);
const inactive = (commander: TransportCommander): boolean => commander.status === 0 || commander.status === 10;
const validCommander = (commander: TransportCommander | null): commander is TransportCommander => commander !== null
  && unsigned(commander.slot, 65535) && unsigned(commander.status, 255) && validPosition(commander.position);

export function tileToNative256(tile: TransportPosition): TransportPosition {
  if (!validPosition(tile, 255)) throw new RangeError("Native tile coordinates must be integers in 0..255");
  return { x: tile.x * 256 + 128, y: tile.y * 256 + 128 };
}

export function native256ToTile(position: TransportPosition): TransportPosition {
  if (!validPosition(position)) throw new RangeError("Native coordinates must be unsigned words");
  return { x: Math.floor(position.x / 256), y: Math.floor(position.y / 256) };
}

export function native256ToSubcells(position: TransportPosition, subcellsPerTile: number): TransportPosition {
  if (!validPosition(position) || !Number.isSafeInteger(subcellsPerTile) || subcellsPerTile <= 0) {
    throw new RangeError("Expected native coordinates and a positive integer subcell scale");
  }
  return { x: position.x * subcellsPerTile / 256, y: position.y * subcellsPerTile / 256 };
}

export function createTransportState(): TransportState {
  return { nextId: 1, carriers: [] };
}

export function reduceTransport(state: TransportState, command: TransportCommand): TransportResult {
  const diagnostic = (code: Extract<TransportEffect, { type: "diagnostic" }>["code"], id?: number): TransportResult => ({
    state, effects: [{ type: "diagnostic", code, ...(id === undefined ? {} : { id }) }], redispatch: false,
  });

  if (command.type === "reinforce" || command.type === "abduct") {
    if (!unsigned(command.team, 7) || !unsigned(command.side, 255)
      || command.directionBits.length !== 2 || command.directionBits.some((bit) => bit !== 0 && bit !== 1)) {
      return diagnostic("invalid-request");
    }
    if (command.type === "abduct" && !validCommander(command.commander)) return diagnostic("invalid-commander");
    if (command.type === "abduct" && inactive(command.commander!)) return { state, effects: [], redispatch: false };
    if (command.type === "reinforce" && (!validPosition(command.tile, 255) || command.groups.length !== 5
      || command.groups.some((group) => !unsigned(group.type, 255) || !unsigned(group.count, 255))
      || (command.groups[0].type === 0 && command.groups[0].count === 0)
      || command.groups[0].type === 255)) return diagnostic("invalid-request");
    const poolIndex = Array.from({ length: 8 }, (_, index) => index).find((index) => !state.carriers.some(
      (carrier) => carrier.team === command.team && carrier.poolIndex === index && carrier.phase !== "released",
    ));
    if (poolIndex === undefined) return diagnostic("pool-full");
    const originTile = command.type === "reinforce" ? { ...command.tile } : native256ToTile(command.commander!.position);
    const destination = tileToNative256(originTile);
    const carrier: TransportCarrier = {
      id: state.nextId, team: command.team, entityTeam: 8, type: command.side === 1 ? 93 : 92,
      poolIndex, slot: 15 * command.team + 7 + poolIndex, originTile, destination,
      position: {
        x: (destination.x + 512 * command.directionBits[0] - 256) & 0xffff,
        y: (destination.y + 512 * command.directionBits[1] - 256) & 0xffff,
      },
      height: (command.side === 1 ? 1200 : 600) + 7500,
      step: 50, phase: "descent", payloadPhase: 0, cursor: 0, awaiting: null,
      groups: command.type === "reinforce" ? command.groups.map((group) => ({ ...group })) : [],
      commanderSlot: command.type === "abduct" ? command.commander!.slot : null,
    };
    return {
      state: { nextId: state.nextId + 1, carriers: [...state.carriers.filter((existing) => existing.slot !== carrier.slot), carrier] },
      effects: [{ type: "initialize-carrier", carrier }], redispatch: false,
    };
  }

  const carrier = state.carriers.find((candidate) => candidate.id === command.id && candidate.phase !== "released");
  if (!carrier) return diagnostic("no-match", command.id);
  const effects: TransportEffect[] = [];
  let next = { ...carrier };
  let redispatch = false;
  const departure = (): void => {
    next = { ...next, phase: "departure", payloadPhase: 2, step: 0, awaiting: null };
  };
  const selectPosition = (): void => {
    next.awaiting = "position";
    effects.push({ type: "select-position", id: carrier.id, originTile: carrier.originTile, plane: "ground" });
  };
  const orient = (destination: TransportPosition): void => {
    next = { ...next, phase: "orientation", destination: { ...destination }, awaiting: null };
    effects.push({ type: "orient", id: carrier.id, destination: next.destination });
  };

  switch (command.type) {
    case "invoke": {
      if (carrier.awaiting !== null) return { state, effects: [], redispatch: false };
      if (carrier.phase === "descent" || carrier.phase === "departure") {
        if (carrier.phase === "descent" && carrier.step === 0) {
          effects.push({ type: "descent-complete", id: carrier.id });
          orient(carrier.destination);
        } else {
          next.height = (carrier.type === 93 ? 1200 : 600) + 3 * carrier.step * carrier.step;
          effects.push({ type: "height", id: carrier.id, height: next.height });
          next.step += carrier.phase === "descent" ? -1 : 1;
          if (carrier.phase === "departure" && next.step === 50) {
            next.phase = "pool-release";
            effects.push({ type: "ascent-complete", id: carrier.id });
          }
        }
      } else if (carrier.phase === "pool-release") {
        next.phase = "released";
        effects.push({ type: "carrier-released", id: carrier.id, team: carrier.team, poolIndex: carrier.poolIndex,
          slot: carrier.slot, idleTask: 3, idleCount: 60 });
      } else if (carrier.phase === "deliver") {
        next.payloadPhase = 1;
        while (next.cursor < 5 && next.groups[next.cursor].count === 0) next.cursor += 1;
        if (next.cursor === 5) departure();
        else {
          next.awaiting = "occupancy";
          effects.push({ type: "inspect-occupancy", id: carrier.id, position: carrier.destination });
        }
      } else if (carrier.phase === "pickup") {
        next.payloadPhase = 1;
        if (carrier.cursor === 0) {
          next.cursor = 1;
          redispatch = true;
        } else {
          next.awaiting = "commander";
          effects.push({ type: "inspect-commander", id: carrier.id, slot: carrier.commanderSlot! });
        }
      } else return { state, effects: [], redispatch: false };
      break;
    }
    case "oriented":
      if (carrier.phase !== "orientation") return diagnostic("unexpected-reply", carrier.id);
      next.phase = "approach";
      effects.push({ type: "move", id: carrier.id, destination: carrier.destination });
      redispatch = true;
      break;
    case "arrived":
      if (carrier.phase !== "approach") return diagnostic("unexpected-reply", carrier.id);
      next.position = { ...carrier.destination };
      next.phase = carrier.commanderSlot === null ? "deliver" : "pickup";
      effects.push({ type: "approach-complete", id: carrier.id });
      redispatch = true;
      break;
    case "occupancy":
      if (carrier.phase !== "deliver" || carrier.awaiting !== "occupancy") return diagnostic("unexpected-reply", carrier.id);
      if (command.vacant) {
        next.awaiting = "creation";
        effects.push({ type: "create-unit", id: carrier.id, team: carrier.team,
          unitType: carrier.groups[carrier.cursor].type, position: carrier.destination });
      } else selectPosition();
      break;
    case "created": {
      if (carrier.phase !== "deliver" || carrier.awaiting !== "creation") return diagnostic("unexpected-reply", carrier.id);
      if (!command.success) return diagnostic("creation-failed", carrier.id);
      next.groups = carrier.groups.map((group, index) => index === carrier.cursor ? { ...group, count: group.count - 1 } : group);
      while (next.cursor < 5 && next.groups[next.cursor].count === 0) next.cursor += 1;
      if (next.cursor === 5) departure();
      else selectPosition();
      break;
    }
    case "next-position":
      if (carrier.phase !== "deliver" || carrier.awaiting !== "position") return diagnostic("unexpected-reply", carrier.id);
      if (command.position === null) return diagnostic("no-position", carrier.id);
      if (!validPosition(command.position)) return diagnostic("invalid-request", carrier.id);
      orient(command.position);
      break;
    case "commander": {
      if (carrier.phase !== "pickup" || carrier.awaiting !== "commander") return diagnostic("unexpected-reply", carrier.id);
      if (!validCommander(command.commander) || command.commander.slot !== carrier.commanderSlot) {
        return diagnostic("invalid-commander", carrier.id);
      }
      const target = command.commander;
      if (!inactive(target) && Math.abs(carrier.position.x - target.position.x) + Math.abs(carrier.position.y - target.position.y) > 256) {
        orient(target.position);
      } else {
        if (!inactive(target)) {
          effects.push({ type: "remove-noncombat", id: carrier.id, slot: target.slot, status: 10, task: 10, taskWords: [1, 0], combatLoss: false });
          effects.push({ type: "clear-collision", id: carrier.id, slot: target.slot });
        }
        next.cursor = 2;
        departure();
      }
      break;
    }
  }
  return { state: { ...state, carriers: state.carriers.map((existing) => existing.id === carrier.id ? next : existing) }, effects, redispatch };
}
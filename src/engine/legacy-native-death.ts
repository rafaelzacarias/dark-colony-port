import { advanceLegacyResourceAnimation } from "./legacy-resource";
import { legacyCueCatalog } from "../audio/legacy-cues";
import type { LegacySound } from "../audio/cues";

export interface LegacyNativeDeathSoundState {
  readonly descriptor: readonly number[];
  readonly randomSeed: number;
}

export interface LegacyNativeDeathSound {
  readonly configuration: {
    readonly executableSha256: string;
    readonly soundTableSha256: string;
    readonly bindingsSha256: string;
    readonly categoryCount: number;
    readonly sounds: readonly LegacySound[];
  };
  readonly state: LegacyNativeDeathSoundState;
  readonly initialized: boolean;
  readonly disabled: boolean;
  readonly listener: { readonly x: number; readonly y: number };
}

export interface LegacyNativeDeathSoundRequest {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly slot: number;
  readonly category: 0;
  readonly event: 3;
  readonly volume: number;
  readonly pan: number;
  readonly source: LegacySound;
}

export interface LegacyNativeDeathState {
  readonly registry: readonly number[];
  readonly typeStatistics: readonly number[];
  readonly commanderSlots: readonly number[];
  readonly pending: readonly { readonly slot: number; readonly startedAt: number; readonly lastCounter: number; readonly visits: number }[];
}

export interface LegacyNativeDeathFrame {
  readonly actors: readonly number[];
  readonly statistics: readonly number[];
  readonly state: LegacyNativeDeathState;
  readonly counter: number;
  readonly rngCursor: number;
  readonly sound?: LegacyNativeDeathSound;
  readonly world: {
    readonly width: number; readonly height: number;
    readonly ground: readonly number[]; readonly air: readonly number[]; readonly extra: readonly number[];
  };
  readonly tables: {
    readonly typeTable: readonly number[];
    readonly randomTable: readonly number[];
    readonly fin: Readonly<Record<number, readonly (readonly number[])[]>>;
  };
}

export type LegacyNativeDeathResult =
  | { readonly supported: false; readonly diagnostic: string }
  | { readonly supported: true; readonly actors: readonly number[]; readonly statistics: readonly number[];
      readonly state: LegacyNativeDeathState; readonly ground: readonly number[]; readonly air: readonly number[];
      readonly extra: readonly number[]; readonly rngCursor: number; readonly randomAdvances: readonly number[];
      readonly soundRequests: readonly LegacyNativeDeathSoundRequest[]; readonly soundState?: LegacyNativeDeathSoundState;
      readonly removed: readonly number[] };

const integer = (value: number, low: number, high: number) => Number.isInteger(value) && value >= low && value <= high;
const bytes = (value: readonly number[], length: number) => value.length === length && value.every(item => integer(item, 0, 255));

export function validLegacyNativeDeathSound(sound: LegacyNativeDeathSound): boolean {
  const configuration = sound?.configuration, state = sound?.state;
  if (!configuration || !state || sound.initialized !== true || typeof sound.disabled !== "boolean"
    || !integer(sound.listener?.x, -2147483648, 2147483647) || !integer(sound.listener?.y, -2147483648, 2147483647)
    || configuration.executableSha256 !== "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b"
    || configuration.soundTableSha256 !== legacyCueCatalog.provenance[0].sha256
    || configuration.bindingsSha256 !== legacyCueCatalog.provenance[1].sha256
    || configuration.categoryCount !== 106
    || !integer(state.randomSeed, 0, 0xffffffff) || !Array.isArray(state.descriptor) || !bytes(state.descriptor, 13)
    || !integer(state.descriptor[1], 0, 3)
    || ![4, 0, 0, 28, 90, 153, 154, 0, 0, 0, 0, 0, 0].every((value, index) => index === 1 || value === state.descriptor[index])
    || !Array.isArray(configuration.sounds) || configuration.sounds.length !== 4) return false;
  return [28, 90, 153, 154].every((id, index) => {
    const actual = configuration.sounds[index], expected = legacyCueCatalog.sounds.find(item => item.id === id)!;
    return actual?.id === id && actual.source === expected.source && Array.isArray(actual.parameters)
      && actual.parameters.length === 4 && expected.parameters.every((value, parameter) => value === actual.parameters[parameter]);
  });
}

function validate(frame: LegacyNativeDeathFrame, slot: number): string | undefined {
  const { state, world, tables } = frame, cells = world.width * world.height;
  if (frame.sound !== undefined && !validLegacyNativeDeathSound(frame.sound)) return "invalid-native-death-source-sound";
  if (!integer(slot, 152, 799) || !bytes(frame.actors, 800 * 220) || !bytes(tables.typeTable, 110 * 280)
    || !integer(frame.counter, 0, 0xffffffff) || !integer(frame.rngCursor, 0, 255)
    || tables.randomTable.length !== 256 || tables.randomTable.some(value => !integer(value, 0, 0x7fffffff))
    || frame.statistics.length !== 96 || frame.statistics.some(value => !integer(value, -2147483648, 2147483647)))
    return "invalid-native-death-frame";
  if (state.registry.length !== 800 || state.registry.some((value, index) => value !== -1 && value !== index)
    || state.registry[slot] !== slot || state.typeStatistics.length !== 4400
    || state.typeStatistics.some(value => !integer(value, -2147483648, 2147483647))
    || state.commanderSlots.length !== 8 || state.commanderSlots.some(value => !integer(value, -1, 799))
    || new Set(state.pending.map(item => item.slot)).size !== state.pending.length
    || state.pending.some(item => !integer(item.slot, 152, 799) || state.registry[item.slot] !== item.slot
      || !integer(item.startedAt, 0, item.lastCounter) || !integer(item.lastCounter, 0, frame.counter)
      || !integer(item.visits, 0, 149))) return "invalid-native-death-state";
  if (!integer(world.width, 1, 256) || !integer(world.height, 1, 256)
    || world.ground.length !== cells || world.ground.some(value => !integer(value, 0, 0xffffffff))
    || [world.air, world.extra].some(plane => plane.length !== cells || plane.some(value => !integer(value, 0, 65535))))
    return "invalid-native-death-world";
  const raw = frame.actors.slice(slot * 220, (slot + 1) * 220), actor = new DataView(Uint8Array.from(raw).buffer);
  const type = new DataView(Uint8Array.from(tables.typeTable).buffer);
  if (raw[6] !== 0 || raw[7] > 7 || actor.getUint16(2, true) !== 0 || type.getInt32(0x100, true) !== 0
    || type.getUint8(0x60) !== 0 || type.getInt32(0xe8, true) !== 3 || type.getInt32(0xd8, true) !== 7
    || raw[0xd0] !== 0 || raw[0xd6] !== 0 || actor.getUint16(0, true) >= world.width * 256
    || actor.getUint16(4, true) >= world.height * 256) return "unowned-native-death-profile";
  const banks = [0x7c, 0x80, 0xa0, 0xa4, 0xac, 0xb0, 0xb4, 0xbc, 0xc0, 0xc4, 0xc8, 0xcc, 0xd0, 0xd4]
    .map(offset => type.getUint32(offset, true));
  for (const bank of banks) {
    const directions = tables.fin[bank];
    if (!bank || !directions || directions.length !== 32 || directions.some(delays => !delays.length || delays.length > 255
      || delays.some(delay => !integer(delay, 0, 255)))) return "native-death-source-fin-required";
  }
  for (const offset of [0x14, 0x1c, 0x24]) {
    const bank = actor.getUint32(offset, true);
    if (!banks.includes(bank) || ![0, 1, 2].includes(raw[offset + 6])
      || raw[offset + 4] >= tables.fin[bank][(((raw[9] + 8) & 255) >>> 4) * 2].length)
      return "unowned-native-death-animation";
  }
  return undefined;
}

export function beginLegacyNativeDeath(frame: LegacyNativeDeathFrame & {
  readonly source: number; readonly target: number; readonly weapon: number; readonly damage: number;
}): LegacyNativeDeathResult {
  const reject = (diagnostic: string): LegacyNativeDeathResult => ({ supported: false, diagnostic });
  const invalid = validate(frame, frame.target);
  if (invalid) return reject(invalid);
  const { source, target, state, world } = frame, offset = target * 220;
  const actors = Uint8Array.from(frame.actors), actor = new DataView(actors.buffer);
  const team = actors[offset + 7], killer = actors[source * 220 + 7];
  if (!integer(source, 152, 799) || state.registry[source] !== source || actors[source * 220 + 6] !== 0
    || actors[source * 220 + 0x2c] !== 1 || killer > 7 || killer === team || frame.weapon !== 1
    || state.commanderSlots[killer] !== -1) return reject("native-death-killer-branch-unowned");
  const health = actor.getInt32(offset + 12, true);
  if (!integer(frame.damage, 1, 0x7fffffff) || health <= 0 || health > frame.damage || actors[offset + 0x2c] !== 1
    || state.pending.some(item => item.slot === target)) return reject("invalid-native-lethal-transition");
  if (actors[offset + 0x38] > 1 || actors[offset + 0x39] !== 1 || actors[offset + 0x3a] !== 0
    || (actors[offset + 0x38] === 1 && actors[offset + 0x3b] !== 3)) return reject("native-death-active-task-unowned");
  const column = actor.getUint16(offset, true) >> 8, row = actor.getUint16(offset + 4, true) >> 8;
  const cell = row * world.width + column;
  if ((world.ground[cell] & 0x80000000) && !frame.sound) return reject("native-death-visible-sound-owner-required");
  if ((world.ground[cell] & 1023) !== target || world.ground.some((value, index) => index !== cell && (value & 1023) === target)
    || [world.air, world.extra].some(plane => plane.some(value => (value & 1023) === target)))
    return reject("native-death-occupancy-owner-required");
  const soundRequests: LegacyNativeDeathSoundRequest[] = [];
  let soundState = frame.sound ? { descriptor: [...frame.sound.state.descriptor], randomSeed: frame.sound.state.randomSeed } : undefined;
  if ((world.ground[cell] & 0x80000000) && frame.sound && soundState && !frame.sound.disabled) {
    const x = actor.getUint16(offset, true), y = actor.getUint16(offset + 4, true);
    const horizontal = (frame.sound.listener.x - x) | 0, vertical = (frame.sound.listener.y - y) | 0;
    const volume = -((Math.imul(horizontal, horizontal) + Math.imul(vertical, vertical)) >> 17) | 0;
    if (volume >= -8000) {
      const id = soundState.descriptor[3 + soundState.descriptor[1]];
      const source = frame.sound.configuration.sounds.find(item => item.id === id)!;
      soundRequests.push({ id, x, y, slot: target, category: 0, event: 3, volume,
        pan: frame.sound.listener.x > x ? volume : -volume | 0,
        source: { ...source, parameters: [...source.parameters] } });
      const randomSeed = (Math.imul(soundState.randomSeed, 0x41c64e6d) + 0x3039) >>> 0;
      soundState.descriptor[1] = ((randomSeed >>> 16) & 0x7fff) % soundState.descriptor[0];
      soundState = { ...soundState, randomSeed };
    }
  }
  actor.setInt32(offset + 12, health - frame.damage, true);
  actors[offset + 0xc7] = ((actors[offset + 0xc7] + health - frame.damage) | 0) < 255
    ? actors[offset + 0xc7] - (health - frame.damage) : 255;
  actors[offset + 0xc8] = 1; actors[offset + 0xc9] = 1;
  actors[offset + 0x38] = 0; actors[offset + 0x39] = 10; actors[offset + 0x3a] = 0;
  actors[offset + 0x3c] = 2; actors[offset + 0x2c] = 10; actors[offset + 0x13] = 0;
  actors[offset + 0x12] &= ~(1 << team);
  actor.setUint16(offset + 0x46, 0, true); actor.setUint16(offset + 0x48, 0, true);
  const statistics = [...frame.statistics], typeStatistics = [...state.typeStatistics], ground = [...world.ground];
  statistics[killer * 12 + 2] = (statistics[killer * 12 + 2] + 1) | 0;
  statistics[team * 12 + 3] = (statistics[team * 12 + 3] + 1) | 0;
  typeStatistics[killer * 440 + 3] = (typeStatistics[killer * 440 + 3] + 1) | 0;
  typeStatistics[team * 440] = (typeStatistics[team * 440] + 1) | 0;
  ground[cell] = (ground[cell] | 1023) >>> 0;
  return { supported: true, actors: [...actors], statistics, ground, air: [...world.air], extra: [...world.extra],
    rngCursor: frame.rngCursor, randomAdvances: [], removed: [], soundRequests, ...(soundState ? { soundState } : {}),
    state: { registry: [...state.registry], commanderSlots: [...state.commanderSlots], typeStatistics,
      pending: [...state.pending, { slot: target, startedAt: frame.counter, lastCounter: frame.counter, visits: 0 }] } };
}

export function reduceLegacyNativeDeathVisit(frame: LegacyNativeDeathFrame & { readonly slot: number }): LegacyNativeDeathResult {
  const reject = (diagnostic: string): LegacyNativeDeathResult => ({ supported: false, diagnostic });
  const invalid = validate(frame, frame.slot);
  if (invalid) return reject(invalid);
  const { slot, state, tables, world } = frame, offset = slot * 220;
  const pending = state.pending.find(item => item.slot === slot);
  const actors = Uint8Array.from(frame.actors), actor = new DataView(actors.buffer);
  const type = new DataView(Uint8Array.from(tables.typeTable).buffer);
  if (!pending || frame.counter <= pending.lastCounter || actors[offset + 0x2c] !== 10 || actor.getInt32(offset + 12, true) > 0
    || actors[offset + 0x38] !== 0 || actors[offset + 0x39] !== 10 || actors[offset + 0x3a] !== 0
    || actors[offset + 0x3c] !== 2 || actor.getUint16(offset + 0x46, true) !== pending.visits
    || actor.getUint16(offset + 0x48, true) !== 0) return reject("invalid-native-death-visit");
  if ([world.ground, world.air, world.extra].some(plane => plane.some(value => (value & 1023) === slot)))
    return reject("native-death-occupancy-not-released");
  let rngCursor = frame.rngCursor;
  const randomAdvances: number[] = [];
  const random = () => { rngCursor = (rngCursor + 1) & 255; randomAdvances.push(rngCursor); return tables.randomTable[rngCursor]; };
  const reset = (animationOffset: number, bank: number) => {
    if (actor.getUint32(offset + animationOffset, true) !== bank || actors[offset + animationOffset + 6] !== 1) {
      actor.setUint32(offset + animationOffset, bank, true);
      actors[offset + animationOffset + 4] = 0; actors[offset + animationOffset + 5] = 0; actors[offset + animationOffset + 6] = 1;
    }
  };
  actors[offset + 0x12] = 0;
  if (!(frame.counter & 31)) actors[offset + 0xa] = Math.min(255, actors[offset + 0xa] + type.getInt32(0xf8, true));
  if (actors[offset + 0x22] === 2 && actors[offset + 0xc7]) {
    reset(0x1c, type.getUint32(0xbc + (random() % 7) * 4, true)); actors[offset + 0xc7] = 0;
  }
  for (const animationOffset of [0x14, 0x1c, 0x24]) {
    const bank = actor.getUint32(offset + animationOffset, true);
    const next = advanceLegacyResourceAnimation({ profile: String(bank), frame: actors[offset + animationOffset + 4],
      delay: actors[offset + animationOffset + 5], mode: actors[offset + animationOffset + 6] as 0 | 1 | 2 },
    { id: String(bank), directions: tables.fin[bank] }, actors[offset + 9]);
    actors[offset + animationOffset + 4] = next.frame; actors[offset + animationOffset + 5] = next.delay;
    actors[offset + animationOffset + 6] = next.mode;
  }
  if (actors[offset + 0x10] & 31) actors[offset + 0x10] = (actors[offset + 0x10] & 224) | ((actors[offset + 0x10] & 31) - 1);
  if (!pending.visits) reset(0x14, type.getUint32(0xac + (random() % 3) * 4, true));
  const visits = pending.visits + 1, removed = visits === 150;
  actor.setUint16(offset + 0x46, visits, true);
  const registry = [...state.registry];
  if (removed) { actors[offset + 0x2c] = 0; registry[slot] = -1; }
  return { supported: true, actors: [...actors], statistics: [...frame.statistics], ground: [...world.ground],
    air: [...world.air], extra: [...world.extra], rngCursor, randomAdvances, soundRequests: [], removed: removed ? [slot] : [],
    ...(frame.sound ? { soundState: { descriptor: [...frame.sound.state.descriptor], randomSeed: frame.sound.state.randomSeed } } : {}),
    state: { registry, commanderSlots: [...state.commanderSlots], typeStatistics: [...state.typeStatistics],
      pending: state.pending.flatMap(item => item.slot !== slot ? [item] : removed ? []
        : [{ ...item, visits, lastCounter: frame.counter }]) } };
}
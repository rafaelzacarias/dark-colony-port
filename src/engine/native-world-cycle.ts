import { requireSourceNativeWorldPrefixSource, sourceNativeWorldStartupBlocker,
  type NativeWorldSourceInputs, type SourceNativeWorldPrefixSource } from "./source-native-world-state";

export interface NativeWorldPrefixState extends NativeWorldSourceInputs {
  readonly game: Uint8Array;
  readonly statistics: Uint8Array;
  readonly typeStatistics: Uint8Array;
  readonly rngCursor: number;
  readonly crtSeed: number;
}

export type NativeWorldPrefixStep = "census-and-commander-flags" | "clock-cap-relations-daylight";
export interface NativeWorldPrefixWrite {
  readonly region: "game" | "statistics" | "typeStatistics";
  readonly offset: number;
  readonly size: 1 | 4;
  readonly value: number;
}

const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const actorOffset = (slot: number) => 0x7d28 + slot * 220;
const integer = (value: number, minimum: number, maximum: number) =>
  Number.isInteger(value) && value >= minimum && value <= maximum;

function validate(state: NativeWorldPrefixState): void {
  for (const [bytes, length] of [[state.game, 0x471b0], [state.statistics, 8 * 48],
    [state.typeStatistics, 10 * 110 * 16], [state.alliances, 8], [state.sharedVision, 8],
    [state.renat, 25 * 40]] as const) {
    if (!(bytes instanceof Uint8Array) || bytes.length !== length
      || typeof SharedArrayBuffer !== "undefined" && bytes.buffer instanceof SharedArrayBuffer) {
      throw new RangeError("Complete unshared native prefix buffers required");
    }
  }
  if (!integer(state.rngCursor, 0, 255) || !integer(state.crtSeed, 0, 0xffffffff)
    || !integer(state.renatCount, 0, 25)) throw new RangeError("Invalid native prefix globals");
  const game = viewOf(state.game);
  if (!integer(game.getUint32(0x94c, true), 1, 4)) throw new RangeError("Only explicit original cycles 1..4 are owned");
  for (let slot = 0; slot < 800; slot++) {
    if (!integer(game.getInt16(0x468ec + slot * 2, true), -1, 799)) throw new RangeError("Invalid current registry");
    const offset = actorOffset(slot);
    if (state.game[offset + 7] > 9 || state.game[offset + 6] > 109) throw new RangeError("Invalid current raw actor identity");
  }
}

export function reduceNativeWorldPrefix(source: SourceNativeWorldPrefixSource, current: NativeWorldPrefixState,
  step: NativeWorldPrefixStep) {
  try {
    requireSourceNativeWorldPrefixSource(source);
    validate(current);
    if (step !== "census-and-commander-flags" && step !== "clock-cap-relations-daylight") {
      throw new RangeError("Unknown concrete world-prefix reducer");
    }
    const state = structuredClone(current), game = viewOf(state.game);
    const statistics = viewOf(state.statistics), typeStatistics = viewOf(state.typeStatistics);
    const writes: NativeWorldPrefixWrite[] = [];
    const write = (region: NativeWorldPrefixWrite["region"], offset: number, size: 1 | 4, value: number) => {
      if (size === 1) state[region][offset] = value;
      else viewOf(state[region]).setInt32(offset, value, true);
      writes.push({ region, offset, size, value: size === 1 ? value & 255 : value >>> 0 });
    };
    if (step === "census-and-commander-flags") {
      for (let team = 0; team < 8; team++) {
        for (let type = 0; type < 110; type++) write("typeStatistics", team * 1760 + type * 16 + 4, 4, 0);
        write("statistics", team * 48 + 24, 4, 0);
      }
      for (let slot = 152; slot < 800; slot++) {
        const offset = actorOffset(slot), team = state.game[offset + 7], type = state.game[offset + 6];
        if (game.getInt16(0x468ec + slot * 2, true) === -1 || team >= 8) continue;
        const typeOffset = team * 1760 + type * 16 + 4, populationOffset = team * 48 + 24;
        write("typeStatistics", typeOffset, 4, typeStatistics.getInt32(typeOffset, true) + 1);
        write("statistics", populationOffset, 4, statistics.getInt32(populationOffset, true) + 1);
      }
      for (let team = 0; team < 8; team++) {
        if (statistics.getInt32(team * 48 + 24, true) < game.getInt32(0x528, true)) continue;
        for (let commander = 0; commander < 4; commander++) {
          const slot = game.getInt16(0x1934 + team * 0xe30 + commander * 2, true);
          if (slot === -1) continue;
          if (!integer(slot, 0, 799)) throw new RangeError("Invalid current commander slot");
          write("game", actorOffset(slot) + 10, 1, 0xe6);
        }
      }
    } else {
      const tro = game.getInt32(0x52c, true), elapsed = game.getInt32(0x530, true);
      const period = game.getInt32(0x534, true), transition = game.getInt32(0x538, true);
      const day = game.getInt32(0x53c, true);
      if (!integer(tro, 0, 0x7ffffffe) || !integer(elapsed, 0, 0x7ffffe)
        || period <= 0 || transition <= 0 || !integer(day, 0, 1)) throw new RangeError("Unsupported native clock arithmetic");
      write("game", 0x530, 4, elapsed + 1);
      write("game", 0x52c, 4, tro + 1);
      const colony = Array<boolean>(10).fill(false), population = Array<number>(10).fill(0);
      let available = 648, colonies = 0;
      for (let index = 0; index < state.renatCount; index++) {
        available = (available - viewOf(state.renat).getInt32(index * 40 + 16, true)) | 0;
      }
      for (let team = 0; team < 8; team++) {
        for (let city = 0; city < 5; city++) {
          if (game.getInt32(0xbd4 + team * 0xe30 + city * 4, true) !== 0) colony[team] = true;
        }
        if (colony[team]) colonies++;
      }
      for (let slot = 152; slot < 800; slot++) {
        const offset = actorOffset(slot);
        if (state.game[offset + 0x2c] !== 0) population[state.game[offset + 7]]++;
      }
      for (let team = 0; team <= 8; team++) if (!colony[team]) available = (available - population[team]) | 0;
      available = (available - 100) | 0;
      if (colonies > 0) available = Math.trunc(available / colonies);
      write("game", 0x528, 4, Math.min(available, game.getInt32(4, true)));
      const mutual = (rows: Uint8Array, team: number, other: number) =>
        (rows[team] & (1 << other)) !== 0 && (rows[other] & (1 << team)) !== 0;
      for (let team = 0; team < 8; team++) {
        const maskOffset = 0x19c0 + team * 0xe30;
        write("game", maskOffset, 4, 0);
        for (let other = 0; other < 8; other++) {
          write("game", 0x46f34 + team * 10 + other, 1, mutual(state.alliances, team, other) ? 1 : 0);
          if (mutual(state.sharedVision, team, other)) {
            write("game", maskOffset, 4, game.getInt32(maskOffset, true) | (0x40000000 >> other));
          }
        }
        write("game", maskOffset, 4, game.getInt32(maskOffset, true) | (0x40000000 >> team));
      }
      if (game.getInt32(0x530, true) > period) {
        write("game", 0x530, 4, 0);
        write("game", 0x53c, 4, 1 - day);
      }
      const clock = game.getInt32(0x530, true);
      if (clock <= transition) {
        const ratio = Math.trunc((clock << 8) / transition);
        write("game", 0x540, 4, game.getInt32(0x53c, true) === 0 ? 256 - ratio : ratio);
      }
    }
    return { ok: true as const, scope: "explicit-native-world-prefix" as const, admitted: false as const,
      executableWholeGame: false as const, completedWholeCycles: 0 as const, step, state, writes };
  } catch (error) {
    return { ok: false as const, admitted: false as const, completedWholeCycles: 0 as const, step,
      message: error instanceof Error ? error.message : String(error) };
  }
}

export function transactNativeWorldCycle(source: SourceNativeWorldPrefixSource, current: NativeWorldPrefixState) {
  requireSourceNativeWorldPrefixSource(source);
  return { ok: false as const, admitted: false as const, executableWholeGame: false as const,
    completedWholeCycles: 0 as const, counter: viewOf(current.game).getUint32(0x94c, true),
    blockers: [sourceNativeWorldStartupBlocker] };
}
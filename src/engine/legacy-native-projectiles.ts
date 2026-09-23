import { isLegacyNativeFireWeapon, validLegacyNativeProjectileState, type LegacyNativeProjectileState } from "./legacy-native-fire";
import { beginLegacyNativeDeath, validLegacyNativeDeathSound, type LegacyNativeDeathState, type LegacyNativeDeathSound,
  type LegacyNativeDeathSoundState, type LegacyNativeDeathSoundRequest } from "./legacy-native-death";

export const LEGACY_NATIVE_PROJECTILE_SOURCE_PROJECTIONS = {
  typeTable: { address: 0x4f1880, count: 110, stride: 280, required: ["normalized-armor", "scenario-team-levels", "fin-spr-collision-rectangles"] },
  weapons: { address: 0x4f0200, count: 80, stride: 72 },
  boom: { address: 0x4f90d0, count: 13, stride: 136 },
  damageTable: { pointerAddress: 0x4f98d0, format: "signed16-native-q8" },
  fin: { format: "relocated-bank-to-all32-delay-arrays", optionalOnlyForBankZero: true },
  randomTable: { address: 0x478e04, count: 256 },
  sourceInspire: "actor+d6-must-be-zero",
  authentication: "external-source-provider-required",
} as const;

export interface LegacyNativeProjectileTables {
  readonly typeTable: readonly number[];
  readonly weapons: readonly number[];
  readonly boom: readonly number[];
  readonly damageTable: readonly (readonly number[])[];
  readonly fin: Readonly<Record<number, readonly (readonly number[])[]>>;
  readonly randomTable: readonly number[];
}

export interface LegacyNativeProjectileFrame {
  readonly phase: "after-actor-visits";
  readonly projectiles: LegacyNativeProjectileState;
  readonly actors: readonly number[];
  readonly rngCursor: number;
  readonly death?: { readonly counter: number; readonly state: LegacyNativeDeathState; readonly sound?: LegacyNativeDeathSound };
  readonly world: {
    readonly width: number; readonly height: number;
    readonly ground: readonly number[]; readonly air: readonly number[]; readonly extra: readonly number[];
    readonly families: readonly number[]; readonly relations: readonly number[];
    readonly policy: number;
  };
  readonly tables: LegacyNativeProjectileTables;
}

export type LegacyNativeProjectileResult =
  | { readonly supported: false; readonly diagnostic: string }
  | { readonly supported: true; readonly projectiles: LegacyNativeProjectileState; readonly actors: readonly number[];
      readonly rngCursor: number; readonly randomAdvances: readonly number[];
      readonly soundRequests: readonly LegacyNativeDeathSoundRequest[];
      readonly impacts: readonly { readonly projectile: number; readonly source: number; readonly target: number;
        readonly substep: number; readonly damage: number; readonly health: number }[];
      readonly reclaimed: readonly number[];
      readonly death?: { readonly state: LegacyNativeDeathState; readonly ground: readonly number[];
        readonly air: readonly number[]; readonly extra: readonly number[]; readonly soundState?: LegacyNativeDeathSoundState };
      readonly requiredOwners: readonly ["authenticated-source-projectile-tables", "session-atomic-projectile-commit"] };

const integer = (value: number, low: number, high: number) => Number.isInteger(value) && value >= low && value <= high;
const bytes = (value: readonly number[], length: number) => value.length === length && value.every(item => integer(item, 0, 255));

export function reduceLegacyNativeProjectiles(input: LegacyNativeProjectileFrame): LegacyNativeProjectileResult {
  const reject = (diagnostic: string): LegacyNativeProjectileResult => ({ supported: false, diagnostic });
  if (input.phase !== "after-actor-visits") return reject("native-projectile-caller-phase-required");
  if (input.death?.sound !== undefined && !validLegacyNativeDeathSound(input.death.sound)) return reject("invalid-native-death-source-sound");
  if (!validLegacyNativeProjectileState(input.projectiles)) return reject("invalid-native-projectile-pool");
  let world = input.world;
  const { tables } = input, cells = world.width * world.height;
  if (!bytes(input.actors, 800 * 220) || !integer(world.width, 1, 256) || !integer(world.height, 1, 256)
    || world.ground.length !== cells || world.ground.some(value => !integer(value, 0, 0xffffffff))
    || [world.air, world.extra].some(plane => plane.length !== cells || plane.some(value => !integer(value, 0, 65535)))
    || !bytes(world.families, cells) || !bytes(world.relations, 100) || !integer(world.policy, 0, 1))
    return reject("invalid-native-projectile-world");
  if (!bytes(tables.typeTable, 110 * 280) || !bytes(tables.weapons, 80 * 72) || !bytes(tables.boom, 13 * 136)
    || !integer(input.rngCursor, 0, 255) || tables.randomTable.length !== 256
    || tables.randomTable.some(value => !integer(value, 0, 0x7fffffff))
    || !tables.damageTable.length || tables.damageTable.some(row => row.length < 3 || row.some(value => !integer(value, -32768, 32767))))
    return reject("invalid-native-projectile-tables");
  const records = Uint8Array.from(input.projectiles.records), pool = new DataView(records.buffer);
  const actors = Uint8Array.from(input.actors), actor = new DataView(actors.buffer);
  const types = new DataView(Uint8Array.from(tables.typeTable).buffer);
  const weapons = new DataView(Uint8Array.from(tables.weapons).buffer);
  const randomAdvances: number[] = [], reclaimed: number[] = [];
  const impacts: { projectile: number; source: number; target: number; substep: number; damage: number; health: number }[] = [];
  let deathState = input.death?.state, statistics = [...input.projectiles.statistics];
  let soundState = input.death?.sound?.state;
  const soundRequests: LegacyNativeDeathSoundRequest[] = [];
  let rngCursor = input.rngCursor, [free, active] = input.projectiles.heads;
  const random = () => { rngCursor = (rngCursor + 1) & 255; randomAdvances.push(rngCursor); return tables.randomTable[rngCursor]; };
  const fin = (bank: number, heading: number) => {
    const directions = tables.fin[bank];
    if (!directions || directions.length !== 32 || directions.some(frames => !frames.length || frames.length > 255
      || frames.some(delay => !integer(delay, 0, 255)))) throw new Error("native-projectile-fin-required");
    return directions[heading >> 3];
  };
  const collision = (horizontal: number, vertical: number, source: number, damageClass: number): number => {
    const column = horizontal >> 8, row = vertical >> 8;
    if (column >= world.width || row >= world.height) return -1;
    const owner = actors[source * 220 + 7];
    let selected = -1, best = 0;
    for (let cellX = column - 1; cellX <= column + 1; cellX++) {
      for (let cellY = row - 1; cellY <= row + 1; cellY++) {
        if (cellX < 0 || cellX >= world.width || cellY < 0 || cellY >= world.height) continue;
        const cell = cellY * world.width + cellX;
        for (const [plane, values] of [world.air, world.ground, world.extra].entries()) {
          if (plane === 0 && tables.damageTable[damageClass][2] === 0) continue;
          const slot = values[cell] & 1023;
          if (slot >= 1022) continue;
          if (slot >= 800) throw new Error("invalid-native-projectile-occupant");
          const offset = slot * 220, team = actors[offset + 7], type = actors[offset + 6] * 280;
          if (team === owner || team === 8) continue;
          if (type >= tables.typeTable.length || team > 9) throw new Error("invalid-native-projectile-target");
          if (types.getInt32(type + 0x68, true) !== 0 && !(actors[offset + 0xca] & (1 << owner))) continue;
          if (types.getUint8(type) !== 0) continue;
          if (slot < 152) throw new Error("native-projectile-city-collision-unowned");
          if (types.getInt32(type + 0x48, true) >= types.getInt32(type + 0x50, true)
            || types.getInt32(type + 0x4c, true) >= types.getInt32(type + 0x54, true))
            throw new Error("native-projectile-source-geometry-required");
          const targetX = actor.getUint16(offset, true), targetY = actor.getUint16(offset + 4, true);
          if (horizontal < targetX + types.getInt32(type + 0x48, true)
            || horizontal >= targetX + types.getInt32(type + 0x50, true)
            || vertical < targetY + types.getInt32(type + 0x4c, true)
            || vertical >= targetY + types.getInt32(type + 0x54, true)) continue;
          const score = 4 + Number(cellX === column) + Number(cellY === row);
          if (score > best) { selected = slot; best = score; }
        }
      }
    }
    if (selected === source || (selected >= 0 && world.relations[owner * 10 + actors[selected * 220 + 7]] !== 0)) return -1;
    return selected;
  };
  try {
    for (let slot = active; slot !== -1; slot = pool.getInt16(slot * 40 + 20, true)) {
      const offset = slot * 40, source = pool.getInt16(offset + 14, true), weapon = pool.getInt16(offset + 12, true);
      if (!integer(source, 152, 799) || !isLegacyNativeFireWeapon(actors[source * 220 + 6], weapon)
        || actors[source * 220 + 7] > 7 || actors[source * 220 + 0x2c] !== 1 || actors[source * 220 + 0xd0] !== 0
        || actor.getUint16(source * 220 + 2, true) !== 0)
        return reject("unowned-native-projectile-source");
      if (actors[source * 220 + 0xd6] !== 0) return reject("native-projectile-source-inspire-unowned");
      const profile = weapon * 72, damageClass = weapons.getInt32(profile, true);
      if (!tables.damageTable[damageClass] || weapons.getInt32(profile + 28, true) !== 0 || tables.boom[16] !== 1
        || weapons.getInt32(profile + 12, true) <= 0 || weapons.getInt32(profile + 24, true) < 0
        || !integer(weapons.getInt32(profile + 64, true), 0, 4)
        || pool.getInt16(offset + 24, true) !== -1 || pool.getUint8(offset + 30) !== 0
        || pool.getInt16(offset + 4, true) !== 0 || pool.getInt16(offset + 10, true) !== 0
        || ![1, 2, 4].includes(pool.getInt16(offset + 28, true)) || pool.getUint16(offset + 26, true) > 255)
        return reject("unowned-native-projectile-profile");
      const bank = pool.getUint32(offset + 32, true), status = pool.getInt16(offset + 28, true);
      if (bank && records[offset + 38] > 2) return reject("unowned-native-projectile-fin-mode");
      if (status === 2) {
        const variants = weapons.getInt32(profile + 64, true);
        if (!bank || records[offset + 38] === 0 || !Array.from({ length: variants }, (_, index) =>
          weapons.getUint32(profile + 48 + index * 4, true)).includes(bank)) return reject("unowned-native-projectile-impact-bank");
      } else if (bank !== weapons.getUint32(profile + 44, true)) return reject("unowned-native-projectile-travel-bank");
    }
    for (let substep = 0; substep < 4; substep++) {
      for (let slot = active; slot !== -1; slot = pool.getInt16(slot * 40 + 20, true)) {
        const offset = slot * 40;
        if (pool.getInt16(offset + 28, true) !== 1) continue;
        const source = pool.getInt16(offset + 14, true), profile = pool.getInt16(offset + 12, true) * 72;
        pool.setUint16(offset, pool.getUint16(offset, true) + pool.getInt16(offset + 6, true), true);
        pool.setUint16(offset + 2, pool.getUint16(offset + 2, true) + pool.getInt16(offset + 8, true), true);
        const damageClass = weapons.getInt32(profile, true);
        const target = collision(pool.getUint16(offset, true), pool.getUint16(offset + 2, true), source, damageClass);
        if (target !== -1) {
          const targetOffset = target * 220, type = actors[targetOffset + 6] * 280, team = actors[targetOffset + 7];
          if (actors[targetOffset + 0x2c] !== 1 || team > 7) return reject("unowned-native-projectile-target-status");
          if (actor.getUint16(targetOffset + 2, true) !== 0) return reject("native-projectile-airborne-target-unowned");
          const armorClass = types.getInt32(type + 0x40, true), level = types.getUint8(type + 0x38 + team);
          const multiplier = tables.damageTable[damageClass][armorClass];
          if (multiplier === undefined || level > 2 || multiplier < 0) return reject("native-projectile-healing-unowned");
          let damage = Math.imul(multiplier, weapons.getInt32(profile + 12, true)) >> 8;
          damage = Math.imul(damage, 256) >> 8;
          damage = Math.imul(damage, types.getInt32(type + 0x24 + level * 4, true)) >> 8;
          const sourceRace = types.getInt32(actors[source * 220 + 6] * 280 + 4, true);
          if ((sourceRace === 0 && world.policy === 1) || (sourceRace === 1 && world.policy === 0)) damage = Math.imul(damage, 3) >> 2;
          if (damage <= 0) return reject("native-projectile-positive-damage-required");
          const health = actor.getInt32(targetOffset + 12, true);
          if (health <= damage) {
            if (!input.death || !deathState) return reject("native-projectile-death-owner-required");
            const death = beginLegacyNativeDeath({ actors: [...actors], statistics, state: deathState,
              counter: input.death.counter, rngCursor, world, tables, source, target,
              ...(input.death.sound ? { sound: { ...input.death.sound, state: soundState! } } : {}),
              weapon: profile / 72, damage });
            if (!death.supported) return reject(death.diagnostic);
            actors.set(death.actors); statistics = [...death.statistics]; deathState = death.state;
            rngCursor = death.rngCursor; randomAdvances.push(...death.randomAdvances);
            soundState = death.soundState; soundRequests.push(...death.soundRequests);
            world = { ...world, ground: death.ground, air: death.air, extra: death.extra };
          } else {
            actor.setInt32(targetOffset + 12, health - damage, true);
            actors[targetOffset + 0xc7] = ((actors[targetOffset + 0xc7] + health - damage) | 0) < 255
              ? actors[targetOffset + 0xc7] - (health - damage) : 255;
            actors[targetOffset + 0xc8] = 1; actors[targetOffset + 0xc9] = 1;
          }
          impacts.push({ projectile: slot, source, target, substep, damage, health: health - damage });
          const variants = weapons.getInt32(profile + 64, true);
          if (variants > 0) {
            pool.setUint16(offset, actor.getUint16(targetOffset, true), true);
            pool.setUint16(offset + 2, actor.getUint16(targetOffset + 4, true), true);
            pool.setUint16(offset + 4, actor.getUint16(targetOffset + 2, true), true);
            const bank = weapons.getUint32(profile + 48 + (random() % variants) * 4, true);
            if (pool.getUint32(offset + 32, true) !== bank || records[offset + 38] !== 1) {
              records[offset + 36] = 0; records[offset + 37] = 0; records[offset + 38] = 1;
            }
            pool.setUint32(offset + 32, bank, true); pool.setUint16(offset + 28, 2, true);
          }
        }
        pool.setUint16(offset + 16, pool.getUint16(offset + 16, true) + 1, true);
        if ((pool.getInt16(offset + 16, true) > weapons.getInt32(profile + 24, true) || target !== -1)
          && pool.getInt16(offset + 28, true) === 1) pool.setUint16(offset + 28, 4, true);
      }
    }
    for (let slot = active; slot !== -1; slot = pool.getInt16(slot * 40 + 20, true)) {
      const offset = slot * 40, bank = pool.getUint32(offset + 32, true);
      if (!bank) continue;
      const delays = fin(bank, pool.getUint16(offset + 26, true));
      if (records[offset + 38] !== 2) {
        let changed = records[offset + 37] === 0;
        if (changed) records[offset + 36]++;
        if (records[offset + 36] >= delays.length) {
          changed = true; records[offset + 36] = 0;
          if (records[offset + 38] === 1) records[offset + 38] = 2;
        }
        if (records[offset + 38] !== 2) {
          if (changed) records[offset + 37] = delays[records[offset + 36]];
          records[offset + 37]--;
        }
      }
      if (pool.getInt16(offset + 28, true) === 2 && records[offset + 38] === 2) pool.setUint16(offset + 28, 4, true);
    }
    let previous = -1, slot = active;
    while (slot !== -1) {
      const offset = slot * 40, next = pool.getInt16(offset + 20, true);
      if (pool.getInt16(offset + 28, true) === 4) {
        if (previous === -1) active = next;
        else pool.setInt16(previous * 40 + 20, next, true);
        pool.setInt16(offset + 20, free, true); free = slot; reclaimed.push(slot);
      } else previous = slot;
      slot = next;
    }
  } catch (error) {
    return reject(error instanceof Error ? error.message : "invalid-native-projectile-frame");
  }
  return { supported: true, projectiles: { records: [...records], highWater: input.projectiles.highWater,
    heads: [free, active], statistics }, actors: [...actors], rngCursor,
    ...(deathState ? { death: { state: deathState, ground: world.ground, air: world.air, extra: world.extra,
      ...(soundState ? { soundState: { descriptor: [...soundState.descriptor], randomSeed: soundState.randomSeed } } : {}) } } : {}),
    randomAdvances, soundRequests, impacts, reclaimed, requiredOwners: ["authenticated-source-projectile-tables", "session-atomic-projectile-commit"] };
}
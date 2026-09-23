import { legacyHarvesterMotionTables } from "./legacy-harvester-movement";

export interface LegacyNativeProjectileState {
  readonly records: readonly number[];
  readonly highWater: number;
  readonly heads: readonly [number, number];
  readonly statistics: readonly number[];
}

export interface LegacyNativeFireTables {
  readonly spread: readonly number[];
  readonly frames: Readonly<Record<number, readonly (readonly (readonly number[])[])[]>>;
}

export interface LegacyNativeFireSpawn {
  readonly slot: number;
  readonly source: number;
  readonly weapon: number;
  readonly raw: readonly number[];
  readonly sound: { readonly id: number; readonly x: number; readonly y: number };
}

export type LegacyNativeFireResult =
  | { readonly supported: false; readonly diagnostic: string }
  | { readonly supported: true; readonly raw: readonly number[]; readonly projectiles: LegacyNativeProjectileState;
      readonly spawns: readonly LegacyNativeFireSpawn[]; readonly rngCursor: number; readonly randomAdvances: readonly number[];
      readonly reload: number };

const integer = (value: number, low: number, high: number) => Number.isInteger(value) && value >= low && value <= high;
const byteArray = (values: readonly number[], length: number) => values.length === length && values.every(value => integer(value, 0, 255));

export function isLegacyNativeFireWeapon(type: number, weapon: number): boolean {
  return ({ 0: [1, 2, 3], 8: [15, 16, 17], 69: [5], 73: [62] }[type] ?? []).includes(weapon);
}

export function validLegacyNativeProjectileState(pool: LegacyNativeProjectileState): boolean {
  if (!byteArray(pool.records, 2024 * 40) || !integer(pool.highWater, 0, 2023) || pool.heads.length !== 2
    || pool.heads.some(head => !integer(head, -1, pool.highWater - 1)) || pool.statistics.length !== 96
    || pool.statistics.some(value => !integer(value, -2147483648, 2147483647))) return false;
  const data = new DataView(Uint8Array.from(pool.records).buffer), visited = new Set<number>();
  for (let slot of pool.heads) {
    while (slot !== -1) {
      if (!integer(slot, 0, pool.highWater - 1) || visited.has(slot)) return false;
      visited.add(slot); slot = data.getInt16(slot * 40 + 20, true);
    }
  }
  return visited.size === pool.highWater;
}

function direction(deltaX: number, deltaY: number): number {
  const absoluteX = Math.abs(deltaX), absoluteY = Math.abs(deltaY);
  if (!absoluteX && !absoluteY) return 0;
  if (absoluteX === absoluteY) return deltaX > 0 ? (deltaY > 0 ? 32 : 224) : (deltaY > 0 ? 96 : 160);
  const base = legacyHarvesterMotionTables.atanQ13[Math.trunc(Math.min(absoluteX, absoluteY) * 256 / Math.max(absoluteX, absoluteY))];
  const angle = absoluteY > absoluteX
    ? deltaX < 0 ? (deltaY >= 0 ? 2048 + base : 6144 - base) : (deltaY < 0 ? 6144 + base : 2048 - base)
    : deltaX < 0 ? (deltaY >= 0 ? 4096 - base : 4096 + base) : (deltaY < 0 && base !== 0 ? 8192 - base : base);
  return Math.trunc(angle / 32) & 255;
}

function sine(heading: number): number {
  const wrapped = heading & 255, quadrant = wrapped >> 6, offset = wrapped & 63;
  return legacyHarvesterMotionTables.sineQuarterQ11[quadrant & 1 ? 64 - offset : offset] * (quadrant >= 2 ? -1 : 1);
}

export function launchLegacyNativeFire(input: {
  readonly slot: number; readonly raw: readonly number[]; readonly target: readonly number[];
  readonly typeBytes: readonly number[]; readonly weapons: readonly number[];
  readonly tables: LegacyNativeFireTables; readonly projectiles: LegacyNativeProjectileState;
  readonly rngCursor: number; readonly randomTable: readonly number[];
}): LegacyNativeFireResult {
  const reject = (diagnostic: string): LegacyNativeFireResult => ({ supported: false, diagnostic });
  if (!byteArray(input.raw, 220) || !byteArray(input.target, 220) || !byteArray(input.typeBytes, 280)
    || !integer(input.slot, 152, 799) || ![0, 8, 69, 73].includes(input.raw[6])
    || input.raw[7] > 7 || input.target[0x2c] !== 1 || input.raw[0xd6] !== 0
    || input.raw[2] || input.raw[3] || input.target[2] || input.target[3]) return reject("unowned-native-fire-actor");
  if (!integer(input.rngCursor, 0, 255) || input.randomTable.length !== 256
    || input.randomTable.some(value => !integer(value, 0, 2147483647))) return reject("invalid-native-fire-rng");
  const pool = input.projectiles;
  if (!validLegacyNativeProjectileState(pool)) return reject("invalid-native-projectile-pool");
  const bytes = Uint8Array.from(input.raw), actor = new DataView(bytes.buffer);
  const target = new DataView(Uint8Array.from(input.target).buffer);
  const type = new DataView(Uint8Array.from(input.typeBytes).buffer);
  if (direction(target.getUint16(0, true) - actor.getUint16(0, true), target.getUint16(4, true) - actor.getUint16(4, true)) !== bytes[9])
    return reject("native-fire-alignment-required");
  const selected = input.typeBytes[0x30 + input.raw[7]];
  if (selected > 5 || input.weapons.length % 72 || input.weapons.some(value => !integer(value, 0, 255))) return reject("invalid-native-fire-weapon");
  const weaponId = type.getInt32(0x18 + selected * 4, true);
  if (selected > 2 || !isLegacyNativeFireWeapon(input.raw[6], weaponId)
    || weaponId * 72 + 72 > input.weapons.length) return reject("unverified-native-fire-weapon");
  const weapon = new DataView(Uint8Array.from(input.weapons.slice(weaponId * 72, (weaponId + 1) * 72)).buffer);
  const speed = weapon.getInt32(16, true), range = weapon.getInt32(20, true), boom = weapon.getInt32(28, true);
  const variants = type.getInt32(0xe4, true);
  if (!integer(speed, 1, 1024) || !integer(range, 1, 32) || !integer(boom, 0, 12)
    || !integer(variants, 1, 4) || weapon.getInt32(32, true) > 0 || weapon.getInt32(8, true) !== 15)
    return reject("unowned-native-fire-profile");
  if (boom !== 0) return reject("unverified-native-fire-spread-profile");
  if (Math.max(Math.abs(target.getUint16(0, true) - actor.getUint16(0, true)),
    Math.abs(target.getUint16(4, true) - actor.getUint16(4, true))) > range * 256) return reject("unverified-native-fire-range");
  let rngCursor = input.rngCursor;
  const randomAdvances: number[] = [];
  const random = () => { rngCursor = (rngCursor + 1) & 255; randomAdvances.push(rngCursor); return input.randomTable[rngCursor]; };
  const bank = type.getUint32(0xa0 + (random() % variants) * 4, true);
  const directions = input.tables.frames[bank];
  if (!bank || !directions || directions.length !== 32 || directions.some(frames => !frames.length || frames.length > 255
    || frames.some(frame => !byteArray(frame, 72)))) return reject("invalid-native-fire-fin");
  const frames = directions[(((bytes[9] + 8) & 255) >> 4) * 2];
  const muzzles: { x: number; y: number; delay: number }[] = [];
  let delay = 0;
  for (const frame of frames) {
    const record = new DataView(Uint8Array.from(frame).buffer);
    if (record.getUint32(64, true)) muzzles.push({ x: record.getInt16(68, true) * 8, y: -record.getInt16(70, true) * 8, delay });
    delay += record.getInt16(2, true);
  }
  if (muzzles.length > 8) return reject("unowned-native-fire-muzzles");
  if (muzzles.length) return reject("unverified-native-fire-muzzle-profile");
  if (!muzzles.length) muzzles.push({ x: 0, y: 0, delay: 0 });
  if (boom && (!input.tables.spread.length || input.tables.spread.some(value => !integer(value, 0, 255))
    || input.tables.spread.length < boom * 136 + 18)) return reject("invalid-native-fire-spread");
  if (actor.getUint32(0x14, true) !== bank || bytes[0x1a] !== 1) {
    actor.setUint32(0x14, bank, true); bytes[0x18] = 0; bytes[0x19] = 0; bytes[0x1a] = 1;
  }
  const records = Uint8Array.from(pool.records), data = new DataView(records.buffer);
  const statistics = [...pool.statistics];
  let highWater = pool.highWater, free = pool.heads[0], active = pool.heads[1];
  const spawns: LegacyNativeFireSpawn[] = [];
  for (const muzzle of muzzles) {
    let targetX = target.getUint16(0, true) - muzzle.x, targetY = target.getUint16(4, true) - muzzle.y;
    if (boom) {
      let weight = random() & 255, column = 0, row = 0;
      const spread = new DataView(Uint8Array.from(input.tables.spread).buffer);
      for (; row < 3; row++) {
        for (column = 0; column < 3; column++) {
          const probability = spread.getInt16(boom * 136 + row * 6 + column * 2, true);
          if (probability < 0) return reject("invalid-native-fire-spread");
          if (probability > weight) break;
          weight -= probability;
        }
        if (column < 3) break;
      }
      targetX += (column - 1) * 256; targetY += (row - 1) * 256;
    }
    const heading = direction(targetX - actor.getUint16(0, true), targetY - actor.getUint16(4, true));
    const velocityX = Math.trunc(sine(heading + 64) * speed / 2048), velocityY = Math.trunc(sine(heading) * speed / 2048);
    let lifetime = -1;
    if (boom) {
      if (velocityX * velocityX + velocityY * velocityY > range * range * 65536) return reject("unowned-native-fire-range-reduction");
      const horizontal = Math.abs(velocityX) > Math.abs(velocityY);
      const velocity = horizontal ? velocityX : velocityY;
      if (!velocity) return reject("invalid-native-fire-velocity");
      lifetime = Math.trunc(((horizontal ? targetX : targetY) - actor.getUint16(horizontal ? 0 : 4, true)) / velocity);
    }
    let slot = free;
    if (slot === -1) {
      if (highWater + 1 >= 2024) return reject("native-projectile-pool-exhausted");
      slot = highWater++;
    } else {
      free = data.getInt16(slot * 40 + 20, true);
      if (!integer(free, -1, pool.highWater - 1) || free === slot) return reject("invalid-native-projectile-free-list");
    }
    const offset = slot * 40;
    statistics[input.raw[7] * 12 + 8] = (statistics[input.raw[7] * 12 + 8] + 1) | 0;
    const put = (field: number, value: number) => data.setUint16(offset + field, value, true);
    put(0, actor.getUint16(0, true) + muzzle.x); put(2, actor.getUint16(4, true) + muzzle.y); put(4, actor.getUint16(2, true));
    records[offset + 31] = random() & 255;
    put(22, weapon.getUint16(4, true)); records[offset + 30] = weapon.getUint8(68);
    put(16, 0); put(6, velocityX); put(8, velocityY); put(10, 0); put(14, input.slot); put(12, weaponId);
    put(20, active); put(24, lifetime); put(26, heading); put(28, muzzle.delay ? 0 : 1);
    if (muzzle.delay) put(18, muzzle.delay * 4);
    const projectileBank = weapon.getUint32(44, true);
    if (projectileBank && (data.getUint32(offset + 32, true) !== projectileBank || records[offset + 38] !== 0)) {
      records[offset + 36] = 0; records[offset + 37] = 0; records[offset + 38] = 0;
    }
    data.setUint32(offset + 32, projectileBank, true);
    active = slot;
    spawns.push({ slot, source: input.slot, weapon: weaponId, raw: [...records.slice(offset, offset + 40)],
      sound: { id: weapon.getInt16(4, true), x: actor.getUint16(0, true), y: actor.getUint16(4, true) } });
    if (weapon.getUint8(40)) bytes[10] = 0;
  }
  return { supported: true, raw: [...bytes], projectiles: { records: [...records], highWater, heads: [free, active], statistics },
    spawns, rngCursor, randomAdvances, reload: weapon.getInt32(8, true) };
}
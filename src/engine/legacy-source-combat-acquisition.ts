import { legacyHarvesterMotionTables, legacyHarvesterTurnDirection } from "./legacy-harvester-movement";

export interface LegacySourceCombatTables {
  readonly typeTable: readonly number[];
  readonly relations: readonly number[];
  readonly actors: Readonly<Record<number, readonly number[]>>;
  readonly cityFlags: readonly number[];
  readonly damageTable: readonly (readonly number[])[];
  readonly scanOffsets: readonly (readonly number[])[];
}

export interface LegacySourceCombatWorld extends LegacySourceCombatTables {
  readonly width: number;
  readonly height: number;
  readonly ground: readonly number[];
  readonly air: readonly number[];
  readonly extra: readonly number[];
  readonly enemyMask: number;
  readonly weapons: readonly number[];
}

export interface LegacySourceCombatCandidate {
  readonly cell: number;
  readonly plane: "ground" | "air" | "extra";
  readonly slot: number;
  readonly disposition: "hidden-class" | "excluded-type" | "city-flag" | "neutral" | "self" | "allied" | "immune" | "eligible";
  readonly score?: number;
}

export type LegacySourceCombatAcquisition =
  | { readonly supported: false; readonly diagnostic: string }
  | { readonly supported: true; readonly target: number; readonly candidates: readonly LegacySourceCombatCandidate[];
      readonly randomAdvances: readonly never[]; readonly targetWrites: readonly never[] };

const integer = (value: number, low: number, high: number) => Number.isInteger(value) && value >= low && value <= high;
const byteArray = (values: readonly number[], length: number) => values.length === length && values.every(value => integer(value, 0, 255));

export function acquireLegacySourceCombatTarget(slot: number, raw: readonly number[], world: LegacySourceCombatWorld,
  radius?: number): LegacySourceCombatAcquisition {
  const reject = (diagnostic: string): LegacySourceCombatAcquisition => ({ supported: false, diagnostic });
  if (!integer(slot, 0, 799) || !byteArray(raw, 220) || raw[6] >= 110 || raw[7] > 7
    || !byteArray(world.typeTable, 110 * 280) || !byteArray(world.relations, 100)
    || !byteArray(world.cityFlags, 120) || !world.weapons.length || world.weapons.length % 72
    || world.weapons.some(value => !integer(value, 0, 255))) return reject("invalid-source-combat-tables");
  const types = new DataView(Uint8Array.from(world.typeTable).buffer);
  const weapons = new DataView(Uint8Array.from(world.weapons).buffer);
  const typeOffset = raw[6] * 280;
  const selection = world.typeTable[typeOffset + 0x30 + raw[7]];
  if (selection > 5) return reject("invalid-source-weapon-selection");
  const weapon = types.getInt32(typeOffset + 0x18 + selection * 4, true);
  const candidates: LegacySourceCombatCandidate[] = [];
  const result = (target: number): LegacySourceCombatAcquisition => ({ supported: true, target, candidates, randomAdvances: [], targetWrites: [] });
  if (weapon === -1) return result(-1);
  if (!integer(weapon, 0, world.weapons.length / 72 - 1)) return reject("invalid-source-weapon-record");
  const range = radius ?? weapons.getInt32(weapon * 72 + 20, true);
  const damage = world.damageTable[weapons.getInt32(weapon * 72, true)];
  const size = world.width * world.height;
  if (!integer(range, 0, 32) || !integer(world.width, 1, 256) || !integer(world.height, 1, 256)
    || !integer(world.enemyMask, 0, 0xffffffff) || !damage || damage.some(value => !integer(value, -32768, 32767))
    || world.ground.length !== size || world.ground.some(value => !integer(value, 0, 0xffffffff))
    || [world.air, world.extra].some(plane => plane.length !== size || plane.some(value => !integer(value, 0, 65535)))) {
    return reject("invalid-source-combat-world");
  }
  const originX = (raw[0] | raw[1] << 8) >> 8, originY = (raw[4] | raw[5] << 8) >> 8;
  if (originX >= world.width || originY >= world.height) return reject("invalid-source-combat-origin");
  let ring = 0, target = -1, bestScore = -1;
  for (const point of world.scanOffsets) {
    if (point.length !== 2 || point.some(value => !integer(value, -32768, 32767))) return reject("invalid-source-scan-offsets");
    if (point[0] === 99) { if (++ring > range) return result(target); continue; }
    const column = originX + point[0], row = originY + point[1];
    if (column < 0 || row < 0 || column >= world.width || row >= world.height) continue;
    const cell = row * world.width + column;
    if (!(world.ground[cell] & world.enemyMask)) continue;
    for (const plane of ["ground", "air", "extra"] as const) {
      const candidateSlot = world[plane][cell] & 1023;
      if (candidateSlot === 1023 || candidateSlot === 1022) continue;
      const candidate = candidateSlot === slot ? raw : world.actors[candidateSlot];
      if (!candidate || !byteArray(candidate, 220) || candidate[6] >= 110 || candidate[7] > 9) return reject("missing-source-candidate-actor");
      const offset = candidate[6] * 280;
      const record = (disposition: LegacySourceCombatCandidate["disposition"], score?: number) => {
        candidates.push({ cell, plane, slot: candidateSlot, disposition, ...(score === undefined ? {} : { score }) });
      };
      if (types.getInt32(offset + 0x68, true) && raw[7] !== candidate[7] && !(candidate[0xca] & (1 << raw[7]))) { record("hidden-class"); continue; }
      if (world.typeTable[offset]) { record("excluded-type"); continue; }
      if (candidate[0x2c] === 0 || candidate[0x2c] === 10) return reject("native-candidate-status-assertion");
      if (candidateSlot < 120 && world.cityFlags[candidateSlot]) { record("city-flag"); continue; }
      if (candidate[7] >= 8) { record("neutral"); continue; }
      if (candidateSlot === slot) { record("self"); continue; }
      const allied = world.relations[raw[7] * 10 + candidate[7]] !== 0;
      if (!raw[0xd0] && allied) { record("allied"); continue; }
      const armor = types.getInt32(offset + 0x40, true);
      if (!integer(armor, 0, damage.length - 1)) return reject("invalid-source-armor-class");
      if (!damage[armor]) { record("immune"); continue; }
      let score = types.getInt32(offset + 0x18, true) === -1 ? 50 : 150;
      if (world.typeTable[offset + 0x60]) score += 200;
      if (weapons.getInt32(weapon * 72 + 0x1c, true)) {
        for (let nearbyX = Math.max(0, column - 1); nearbyX <= Math.min(world.width - 1, column + 1); nearbyX++) {
          for (let nearbyY = Math.max(0, row - 1); nearbyY <= Math.min(world.height - 1, row + 1); nearbyY++) {
            const nearbySlot = world.ground[nearbyY * world.width + nearbyX] & 1023;
            if (nearbySlot !== 1022 && nearbySlot !== 1023) score += allied ? -15 : 10;
          }
        }
      } else {
        const health = new DataView(Uint8Array.from(candidate).buffer).getInt32(12, true);
        let factor = (1024 - health) | 0;
        if (factor < 1024) factor = 0;
        score = Math.imul(score, ((factor + 1024) | 0) >> 11);
      }
      record("eligible", score);
      if (score > bestScore) { bestScore = score; target = candidateSlot; }
    }
  }
  return reject("incomplete-source-scan-offsets");
}

export function stageLegacySourceCombatFire(raw: readonly number[], target: readonly number[], typeTable: readonly number[]):
  | { readonly supported: false; readonly diagnostic: string }
  | { readonly supported: true; readonly raw: readonly number[]; readonly boundary: 0x412e13 | 0x4131ae;
      readonly randomAdvances: readonly never[]; readonly targetWrites: readonly never[] } {
  if (!byteArray(raw, 220) || !byteArray(target, 220) || !byteArray(typeTable, 110 * 280)
    || raw[6] >= 110 || target[7] > 9) return { supported: false, diagnostic: "invalid-native-fire-input" };
  const bytes = Uint8Array.from(raw);
  if (!target[0x2c]) return { supported: true, raw: [...bytes], boundary: 0x4131ae, randomAdvances: [], targetWrites: [] };
  const turn = new DataView(Uint8Array.from(typeTable).buffer).getInt32(raw[6] * 280 + 8, true);
  if (!integer(turn, 1, 128)) return { supported: false, diagnostic: "unowned-native-fire-turn" };
  if (target[7] < 8) bytes[0x10] = (target[7] << 5) | typeTable[raw[6] * 280 + 0x64];
  const deltaX = (target[0] | target[1] << 8) - (raw[0] | raw[1] << 8);
  const deltaY = (target[4] | target[5] << 8) - (raw[4] | raw[5] << 8);
  const absoluteX = Math.abs(deltaX), absoluteY = Math.abs(deltaY);
  let angle = 0;
  if (absoluteX || absoluteY) {
    if (absoluteX === absoluteY) angle = deltaX > 0 ? (deltaY > 0 ? 1024 : 7168) : (deltaY > 0 ? 3072 : 5120);
    else {
      const base = legacyHarvesterMotionTables.atanQ13[Math.trunc(Math.min(absoluteX, absoluteY) * 256 / Math.max(absoluteX, absoluteY))];
      if (absoluteY > absoluteX) angle = deltaX < 0 ? (deltaY >= 0 ? 2048 + base : 6144 - base)
        : (deltaY < 0 ? 6144 + base : 2048 - base);
      else angle = deltaX < 0 ? (deltaY >= 0 ? 4096 - base : 4096 + base)
        : (deltaY < 0 && base !== 0 ? 8192 - base : base);
    }
  }
  const direction = Math.trunc(angle / 32) & 255;
  bytes[9] = legacyHarvesterTurnDirection(bytes[9], direction, turn);
  return { supported: true, raw: [...bytes], boundary: bytes[9] === direction ? 0x412e13 : 0x4131ae,
    randomAdvances: [], targetWrites: [] };
}
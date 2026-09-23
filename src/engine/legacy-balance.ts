import { SUBCELLS_PER_CELL } from "./constants";
import { sourceScenarioUpgradeLevels as readScenarioUpgradeLevels } from "./legacy-scenario-levels";
import type { AddUnitOptions, Faction } from "./simulation";

export const LEGACY_MOVEMENT_UNITS_PER_CELL = 256;

export type LegacyDamageMatrix = readonly (readonly number[])[];

export interface LegacyDamageProfile {
  readonly coefficients: readonly number[];
  readonly callerFactor: number;
  readonly specialFlag: boolean;
}

export interface NativeOrdinaryDamageProfile {
  readonly mode: "verified-native-ordinary";
  readonly coefficients: readonly number[];
  readonly sourceTypeIndex: 0 | 2 | 4 | 8 | 10 | 12 | 69 | 73;
  readonly sourceTypeFaction: 0 | 1;
  readonly weaponId: 1 | 2 | 3 | 5 | 7 | 8 | 9 | 13 | 14 | 15 | 16 | 17 | 21 | 22 | 23 | 27 | 28 | 30 | 62;
}

export type SourceDamageProfile = LegacyDamageProfile | NativeOrdinaryDamageProfile;

export const VERIFIED_NATIVE_TARGET_TYPES: readonly number[] = Object.freeze([
  0, 2, 4, 8, 10, 12, 16, 17, 18, 19, 20, 21, 22, 28, 29, 30, 31, 32, 33, 34, 35, 69, 73, 81, 82, 83, 84, 87, 88, 89, 95, 97, 98,
]);

export const VERIFIED_NATIVE_ORDINARY_COEFFICIENTS = Object.freeze([64, 30, 64, 46, 64, 230, 12, 128, 0, 12] as const);
export const VERIFIED_NATIVE_MBULLET_SHA256 = "2244665ec4fc4f344b4ad32ec47e209c79a1a240d48f8f43a6035ceab0ae1d22";

const NATIVE_ORDINARY_SOURCES = [
  { type: 0, faction: 0, weaponClass: 0, weapons: [1, 2, 3], damage: [100, 125, 150] },
  { type: 2, faction: 0, weaponClass: 1, weapons: [7, 8, 9], damage: [100, 125, 150] },
  { type: 4, faction: 0, weaponClass: 4, weapons: [13, 14, 14], damage: [200, 250, 250] },
  { type: 8, faction: 1, weaponClass: 0, weapons: [15, 16, 17], damage: [100, 125, 150] },
  { type: 10, faction: 1, weaponClass: 1, weapons: [21, 22, 23], damage: [100, 125, 150] },
  { type: 12, faction: 1, weaponClass: 4, weapons: [30, 27, 28], damage: [200, 250, 300] },
  { type: 69, faction: 0, weaponClass: 0, weapons: [5], damage: [160] },
  { type: 73, faction: 1, weaponClass: 0, weapons: [62], damage: [160] },
] as const;

export const VERIFIED_NATIVE_SOURCE_TYPES = Object.freeze(NATIVE_ORDINARY_SOURCES.map(source => source.type));
export const VERIFIED_NATIVE_WEAPON_IDS = Object.freeze([...new Set(NATIVE_ORDINARY_SOURCES.map(source => source.weapons).flat())]);

const NATIVE_ORDINARY_COEFFICIENT_ROWS = {
  0: VERIFIED_NATIVE_ORDINARY_COEFFICIENTS,
  1: Object.freeze([256, 64, 0, 64, 128, 256, 25, 128, 0, 25]),
  4: Object.freeze([256, 64, 64, 64, 128, 256, 25, 512, 0, 25]),
} as const;

const NATIVE_DEFENSE_GROUPS: readonly {
  types: readonly number[]; targetClass: number; percentages: readonly [number, number]; factors: readonly number[];
}[] = [
  { types: [0, 8], targetClass: 0, percentages: [125, 150], factors: [256, 204, 170] },
  { types: [2, 10], targetClass: 1, percentages: [125, 150], factors: [256, 204, 170] },
  { types: [4, 12], targetClass: 4, percentages: [125, 150], factors: [256, 204, 170] },
  { types: [16, 17, 18, 19, 20, 21, 22, 28, 29, 30, 31, 32, 33, 34, 35],
    targetClass: 9, percentages: [120, 140], factors: [256, 213, 182] },
  { types: [69, 73], targetClass: 6, percentages: [125, 150], factors: [256, 204, 170] },
  { types: [82, 83, 87], targetClass: 6, percentages: [120, 140], factors: [256, 213, 182] },
  { types: [88], targetClass: 0, percentages: [120, 140], factors: [256, 213, 182] },
  { types: [81, 84, 89, 95, 97, 98], targetClass: 8, percentages: [120, 140], factors: [256, 213, 182] },
];

function nativeSourceRecord(profile: NativeOrdinaryDamageProfile) {
  return NATIVE_ORDINARY_SOURCES.find((source) => source.type === profile.sourceTypeIndex &&
    source.faction === profile.sourceTypeFaction && source.weapons.some((weapon) => weapon === profile.weaponId));
}

export function copySourceDamageProfile(profile: SourceDamageProfile): SourceDamageProfile {
  if (!("mode" in profile)) return copyLegacyDamageProfile(profile);
  const source = nativeSourceRecord(profile);
  if (profile.mode !== "verified-native-ordinary" || !source) {
    throw new RangeError("unsupported native ordinary source type/faction/weapon");
  }
  const copied = copyLegacyDamageProfile({ coefficients: profile.coefficients, callerFactor: 256, specialFlag: false });
  if (copied.coefficients.some((coefficient, index) => coefficient !== NATIVE_ORDINARY_COEFFICIENT_ROWS[source.weaponClass][index])) {
    throw new RangeError("unsupported native ordinary coefficient row");
  }
  return Object.freeze({ ...profile, coefficients: copied.coefficients });
}

export function nativeOrdinaryHitDamage(
  baseDamage: number,
  profile: NativeOrdinaryDamageProfile,
  defense: LegacyDefenseProfile | null,
  phase: 0 | 1 | undefined,
  sourceTeam: number | undefined,
  targetTeam: number | undefined,
  inspireFactorQ8 = 256,
): { readonly damage: number } | { readonly diagnostic: string } {
  copySourceDamageProfile(profile);
  boundedInteger(inspireFactorQ8, 0x7fffffff, "per-hit Inspire factor");
  if (phase !== 0 && phase !== 1) return { diagnostic: "missing-native-phase" };
  if (![sourceTeam, targetTeam].every((team) => Number.isInteger(team) && team! >= 0 && team! <= 7)) {
    return { diagnostic: "unsupported-native-team" };
  }
  const target = NATIVE_DEFENSE_GROUPS.find((group) => group.types.some((type) => type === defense?.sourceTypeIndex));
  if (!defense || !target || !target.factors.includes(defense.armorFactor) || defense.targetClass !== target.targetClass) {
    return { diagnostic: "unsupported-native-defense" };
  }
  const source = nativeSourceRecord(profile)!;
  if (source.weaponClass !== 0 && inspireFactorQ8 !== 256) {
    return { diagnostic: "unsupported-native-caller-or-inspire" };
  }
  if (baseDamage !== source.damage[source.weapons.findIndex((weapon) => weapon === profile.weaponId)]) {
    return { diagnostic: "unsupported-native-base-damage" };
  }
  return { damage: calculateLegacyDamage(baseDamage, {
    coefficients: profile.coefficients,
    callerFactor: inspireFactorQ8,
    specialFlag: profile.sourceTypeFaction !== phase,
  }, defense) };
}

export interface LegacyDefenseProfile {
  readonly targetClass: number;
  readonly armorFactor: number;
  readonly sourceTypeIndex?: number;
}

export interface LegacyCombatOptions {
  readonly matrix: LegacyDamageMatrix;
  readonly armorLevel: number;
  readonly callerFactor: number;
  readonly specialFlag: boolean;
}

function boundedInteger(value: number, maximum: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${label} must be an integer in 0..${maximum}`);
  }
}

export function parseLegacyDamageMatrix(text: string): LegacyDamageMatrix {
  const rows = text.split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("%"))
    .map((line) => line.split(/\s+/));
  if (rows.length !== 11 || rows[0].length !== 1 || rows[0][0] !== "10" ||
    rows[1].length !== 1 || rows[1][0] !== "9") {
    throw new RangeError("MBULLET must declare 10 target classes and 9 weapon classes");
  }
  return Object.freeze(rows.slice(2).map((row) => {
    if (row.length !== 10) throw new RangeError("MBULLET row must contain 10 percentages");
    return Object.freeze(row.map((token) => {
      if (!/^\d+$/.test(token)) throw new RangeError("MBULLET percentage must be a non-negative integer");
      const coefficient = Math.trunc(Number(token) * 0.01 * 256);
      boundedInteger(coefficient, 32767, "MBULLET coefficient");
      return coefficient;
    }));
  }));
}

export function copyLegacyDamageProfile(profile: LegacyDamageProfile): LegacyDamageProfile {
  if (profile.coefficients.length !== 10) throw new RangeError("damage profile requires 10 coefficients");
  const coefficients = Array.from(profile.coefficients, (coefficient) => {
    boundedInteger(coefficient, 32767, "damage coefficient");
    return coefficient;
  });
  boundedInteger(profile.callerFactor, 0x7fffffff, "caller factor");
  if (typeof profile.specialFlag !== "boolean") throw new RangeError("special flag must be explicit");
  return Object.freeze({ ...profile, coefficients: Object.freeze(coefficients) });
}

export function copyLegacyDefenseProfile(profile: LegacyDefenseProfile): LegacyDefenseProfile {
  boundedInteger(profile.targetClass, 9, "target class");
  boundedInteger(profile.armorFactor, 0x7fffffff, "armor factor");
  return Object.freeze({ ...profile });
}

export function defenseOptionsFromLegacy(
  unit: Pick<LegacyUnitStat, "targetClass" | "armorUpgradePercentages">,
  armorLevel: number,
): LegacyDefenseProfile {
  boundedInteger(armorLevel, 2, "armor level");
  if (unit.targetClass === undefined || !unit.armorUpgradePercentages ||
    unit.armorUpgradePercentages.length !== 2) {
    throw new RangeError("source defense requires target class and armor percentages");
  }
  for (const percentage of unit.armorUpgradePercentages) {
    boundedInteger(percentage, 0x7fffffff, "armor percentage");
    if (percentage === 0) throw new RangeError("armor percentage must be positive");
  }
  return copyLegacyDefenseProfile({
    targetClass: unit.targetClass,
    armorFactor: armorLevel === 0 ? 256 : Math.trunc(25600 / unit.armorUpgradePercentages[armorLevel - 1]),
  });
}

export function calculateLegacyDamage(
  baseDamage: number,
  profile: LegacyDamageProfile,
  defense: LegacyDefenseProfile,
): number {
  boundedInteger(baseDamage, 0x7fffffff, "base damage");
  copyLegacyDamageProfile(profile);
  copyLegacyDefenseProfile(defense);
  const multiplyShift = (left: number, right: number, bits: number): number => {
    const product = left * right;
    boundedInteger(product, 0x7fffffff, "damage intermediate product");
    return product >> bits;
  };
  let damage = multiplyShift(profile.coefficients[defense.targetClass], baseDamage, 8);
  damage = multiplyShift(damage, profile.callerFactor, 8);
  damage = multiplyShift(damage, defense.armorFactor, 8);
  return profile.specialFlag ? multiplyShift(damage, 3, 2) : damage;
}

export interface LegacyUnitStat {
  readonly index: number;
  readonly sprite: string;
  readonly faction: number;
  readonly movementSpeed: number;
  readonly observationDay: number;
  readonly observationNight: number;
  readonly weapons: readonly [number, number, number];
  readonly health: number;
  readonly targetClass?: number;
  readonly armorUpgradePercentages?: readonly [number, number];
}

export interface LegacyWeaponStat {
  readonly id: number;
  readonly rateOfFire: number;
  readonly damage: number;
  readonly range: number;
  readonly rawPrefix?: number;
  readonly shots?: number;
  readonly reload?: number;
  readonly magicChewing?: number;
}

export interface SourceScenarioUpgradeTeam {
  readonly index: number;
  readonly race: number;
  readonly cityRows: readonly (readonly number[])[];
}

export interface SourceScenarioUpgradeLevels {
  readonly team: number;
  readonly sourceTypeIndex: number;
  readonly weaponLevel: number;
  readonly armorLevel: number;
  readonly origin: "type-initialization" | "scenario-unit-row";
}

export function sourceScenarioUpgradeLevels(
  team: SourceScenarioUpgradeTeam,
  sourceTypeIndex: number,
): SourceScenarioUpgradeLevels {
  return readScenarioUpgradeLevels(team, sourceTypeIndex);
}

type NativeProfileResult<Profile> =
  | { readonly supported: true; readonly profile: Profile }
  | { readonly supported: false; readonly diagnostic: string };

export function verifiedNativeDefenseFromLegacy(
  unit: LegacyUnitStat,
  levels: SourceScenarioUpgradeLevels,
): NativeProfileResult<LegacyDefenseProfile> {
  if (levels.sourceTypeIndex !== unit.index || !Number.isInteger(levels.team) || levels.team < 0 || levels.team > 7) {
    return { supported: false, diagnostic: "unsupported-native-team-or-type" };
  }
  const target = NATIVE_DEFENSE_GROUPS.find((group) => group.types.includes(unit.index));
  if (!target || unit.targetClass !== target.targetClass) {
    return { supported: false, diagnostic: "unsupported-native-target-type" };
  }
  if (!Number.isInteger(levels.armorLevel) || levels.armorLevel < 0 || levels.armorLevel > 2) {
    return { supported: false, diagnostic: "unsupported-native-armor-level" };
  }
  if (unit.armorUpgradePercentages?.length !== 2 ||
    target.percentages.some((percentage, index) => percentage !== unit.armorUpgradePercentages![index])) {
    return { supported: false, diagnostic: "unsupported-native-defense" };
  }
  return { supported: true, profile: Object.freeze({ ...defenseOptionsFromLegacy(unit, levels.armorLevel), sourceTypeIndex: unit.index }) };
}

export function verifiedNativeDamageFromLegacy(
  unit: LegacyUnitStat,
  weapon: LegacyWeaponStat,
  matrix: LegacyDamageMatrix,
  levels: SourceScenarioUpgradeLevels,
  state: { readonly caller: string; readonly inspireTimer: number },
): NativeProfileResult<NativeOrdinaryDamageProfile> {
  if (levels.sourceTypeIndex !== unit.index || !Number.isInteger(levels.team) || levels.team < 0 || levels.team > 7) {
    return { supported: false, diagnostic: "unsupported-native-team-or-type" };
  }
  const source = NATIVE_ORDINARY_SOURCES.find((record) => record.type === unit.index);
  if (!Number.isInteger(levels.weaponLevel) || levels.weaponLevel < 0 || levels.weaponLevel > 2 ||
    (source && levels.weaponLevel >= source.weapons.length)) {
    return { supported: false, diagnostic: "unsupported-native-weapon-level" };
  }
  if (state.caller !== "ordinary-direct" || state.inspireTimer !== 0) {
    return { supported: false, diagnostic: "unsupported-native-caller-or-inspire" };
  }
  if (!source || unit.faction !== source.faction || weapon.id !== source.weapons[levels.weaponLevel] ||
    unit.weapons[levels.weaponLevel] !== weapon.id || weapon.rawPrefix !== source.weaponClass ||
    weapon.damage !== source.damage[levels.weaponLevel] || weapon.shots !== 0 ||
    (weapon.reload !== undefined && weapon.reload !== -1) ||
    (weapon.magicChewing !== undefined && weapon.magicChewing !== -1) ||
    (source.weaponClass !== 0 && (weapon.reload !== -1 || weapon.magicChewing !== -1))) {
    return { supported: false, diagnostic: "unsupported-native-source-or-weapon" };
  }
  if (matrix.length !== 9 || matrix.some((row) => row.length !== 10) ||
    matrix[source.weaponClass].some((coefficient, index) => coefficient !== NATIVE_ORDINARY_COEFFICIENT_ROWS[source.weaponClass][index])) {
    return { supported: false, diagnostic: "unsupported-native-matrix" };
  }
  const profile: NativeOrdinaryDamageProfile = {
    mode: "verified-native-ordinary", sourceTypeIndex: source.type,
    sourceTypeFaction: source.faction, weaponId: source.weapons[levels.weaponLevel], coefficients: matrix[source.weaponClass],
  };
  return { supported: true, profile: copySourceDamageProfile(profile) as NativeOrdinaryDamageProfile };
}

export type LegacyUnitOptions = Omit<AddUnitOptions, "cell">;

function faction(value: number): Faction {
  if (value === 0) return "human";
  if (value === 1) return "alien";
  throw new RangeError(`unsupported legacy faction: ${value}`);
}

export function unitOptionsFromLegacy(
  unit: LegacyUnitStat,
  weapons: readonly LegacyWeaponStat[],
  weaponLevel = 0,
  sourceCombat?: LegacyCombatOptions,
): LegacyUnitOptions {
  if (!Number.isInteger(unit.movementSpeed) || unit.movementSpeed <= 0) {
    throw new RangeError(`legacy unit ${unit.index} has invalid movement speed`);
  }
  if (!Number.isInteger(unit.health) || unit.health <= 0) {
    throw new RangeError(`legacy unit ${unit.index} has invalid health`);
  }
  if (!Number.isInteger(weaponLevel) || weaponLevel < 0 || weaponLevel >= unit.weapons.length) {
    throw new RangeError(`invalid weapon level: ${weaponLevel}`);
  }

  const weaponId = unit.weapons[weaponLevel];
  const weapon = weaponId < 0 ? null : weapons.find(({ id }) => id === weaponId);
  if (weaponId >= 0 && !weapon) {
    throw new RangeError(`legacy unit ${unit.index} references missing weapon ${weaponId}`);
  }

  const sourceDefense = sourceCombat ? defenseOptionsFromLegacy(unit, sourceCombat.armorLevel) : undefined;
  let sourceDamage: LegacyDamageProfile | undefined;
  if (sourceCombat) {
    if (sourceCombat.matrix.length !== 9) throw new RangeError("damage matrix requires 9 weapon classes");
    for (const row of sourceCombat.matrix) {
      copyLegacyDamageProfile({ coefficients: row, callerFactor: sourceCombat.callerFactor, specialFlag: sourceCombat.specialFlag });
    }
    if (weapon) {
      if (weapon.rawPrefix === undefined) throw new RangeError("source weapon requires a weapon class");
      boundedInteger(weapon.rawPrefix, 8, "weapon class");
      sourceDamage = copyLegacyDamageProfile({
        coefficients: sourceCombat.matrix[weapon.rawPrefix],
        callerFactor: sourceCombat.callerFactor,
        specialFlag: sourceCombat.specialFlag,
      });
    }
  }

  return {
    faction: faction(unit.faction),
    speedSubcellsPerTick: Math.max(
      1,
      Math.round((unit.movementSpeed * SUBCELLS_PER_CELL) / LEGACY_MOVEMENT_UNITS_PER_CELL),
    ),
    maxHealth: unit.health,
    ...(sourceDefense ? { sourceDefense } : {}),
    vision: {
      dayRangeCells: unit.observationDay,
      nightRangeCells: unit.observationNight,
    },
    ...(weapon
      ? {
          weapon: {
            damage: weapon.damage,
            rangeCells: weapon.range,
            cooldownTicks: weapon.rateOfFire,
            ...(sourceDamage ? { sourceDamage } : {}),
          },
        }
      : {}),
  };
}

import { copyLegacyDamageProfile, type LegacyDamageMatrix, type LegacyDamageProfile,
  type LegacyUnitStat, type LegacyWeaponStat } from "./legacy-balance";
import type { WeaponStats } from "./simulation";

export interface BrowserMineOptions {
  readonly runtimeProfile: "browser-adapted";
  readonly sourceTypeIndex: 45 | 46;
  readonly weaponId: 38;
  readonly boomId: 2;
  readonly initiallyArmed: true;
  readonly triggerRange: number;
  readonly splashRange: number;
  readonly radiusPolicy: "weapon-range-fallback";
  readonly relations: "hostile-ground-mobiles-only";
  readonly falloff: "hard-cutoff";
  readonly weapon: WeaponStats & { readonly sourceDamage: LegacyDamageProfile };
}

export interface BrowserMineSource {
  readonly runtimeProfile?: string;
  readonly weapons: readonly LegacyWeaponStat[];
  readonly damageMatrix?: LegacyDamageMatrix;
}

export function browserMineOptions(source: BrowserMineSource, unit: LegacyUnitStat): BrowserMineOptions | undefined {
  if (source.runtimeProfile !== "browser-adapted" || (unit.index !== 45 && unit.index !== 46)) return undefined;
  const weapon = source.weapons.find(entry => entry.id === 38);
  if (unit.movementSpeed !== 0 || unit.weapons.some(id => id !== 38) || !weapon || weapon.rawPrefix !== 6
    || weapon.shots !== 2 || !source.damageMatrix?.[6]) throw new RangeError("Unsupported adapted mine source profile");
  const options: BrowserMineOptions = {
    runtimeProfile: "browser-adapted", sourceTypeIndex: unit.index, weaponId: 38, boomId: 2, initiallyArmed: true,
    triggerRange: weapon.range, splashRange: weapon.range, radiusPolicy: "weapon-range-fallback",
    relations: "hostile-ground-mobiles-only", falloff: "hard-cutoff",
    weapon: { damage: weapon.damage, rangeCells: weapon.range, cooldownTicks: weapon.rateOfFire,
      sourceDamage: copyLegacyDamageProfile({ coefficients: source.damageMatrix[6], callerFactor: 256, specialFlag: false }) },
  };
  validateBrowserMineOptions(options);
  return options;
}

export function validateBrowserMineOptions(options: BrowserMineOptions): void {
  const keys = (value: object, expected: readonly string[]) => {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype
      || Reflect.ownKeys(value).length !== expected.length || expected.some(key => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return !descriptor || !("value" in descriptor) || !descriptor.enumerable;
      })) throw new RangeError("Invalid adapted mine shape");
  };
  keys(options, ["runtimeProfile", "sourceTypeIndex", "weaponId", "boomId", "initiallyArmed", "triggerRange",
    "splashRange", "radiusPolicy", "relations", "falloff", "weapon"]);
  keys(options.weapon, ["damage", "rangeCells", "cooldownTicks", "sourceDamage"]);
  keys(options.weapon.sourceDamage, ["coefficients", "callerFactor", "specialFlag"]);
  if (options.runtimeProfile !== "browser-adapted" || ![45, 46].includes(options.sourceTypeIndex)
    || options.weaponId !== 38 || options.boomId !== 2 || options.initiallyArmed !== true
    || options.radiusPolicy !== "weapon-range-fallback" || options.relations !== "hostile-ground-mobiles-only"
    || options.falloff !== "hard-cutoff" || options.triggerRange !== options.weapon.rangeCells
    || options.splashRange !== options.triggerRange || options.weapon.damage !== 1300
    || options.weapon.rangeCells !== 1 || options.weapon.cooldownTicks !== 150
    || options.weapon.sourceDamage.callerFactor !== 256 || options.weapon.sourceDamage.specialFlag !== false) {
    throw new RangeError("Invalid adapted mine policy");
  }
  copyLegacyDamageProfile(options.weapon.sourceDamage);
}
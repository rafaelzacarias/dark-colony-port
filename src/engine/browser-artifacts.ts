import type { LegacyUnitStat } from "./legacy-balance";
import type { LegacyWeaponStat } from "./legacy-balance";

export function browserExcavationArtifact(stat: LegacyUnitStat & { readonly rawTail?: readonly number[] },
  weapons: readonly LegacyWeaponStat[]): boolean {
  const weapon = weapons.find(entry => entry.id === 46);
  return stat.index === 63 && stat.sprite === "LENS" && stat.faction === 0 && stat.health === 400
    && stat.movementSpeed === 47 && stat.weapons.every(entry => entry === 46)
    && stat.rawTail?.length === 22 && stat.rawTail[2] === 1 && stat.rawTail[3] === 7
    && weapon?.range === -1 && weapon.rateOfFire === 15 && weapon.damage === 8000
    && weapon.rawPrefix === 6 && weapon.shots === 11;
}

export function browserVisionArtifact(stat: LegacyUnitStat & { readonly rawTail?: readonly number[] }): boolean {
  return stat.index === 94 && stat.sprite === "DOTT" && stat.faction === -1
    && stat.movementSpeed === 0 && stat.health === 300 && stat.weapons.every(weapon => weapon === -1)
    && stat.rawTail?.length === 22 && stat.rawTail[2] === 7 && stat.rawTail[4] === 0;
}
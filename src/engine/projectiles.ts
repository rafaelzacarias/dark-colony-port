import { direction, sine } from "./legacy-native-fire";

/**
 * DC.EXE projectile model (docs/legacy-native-projectiles, native wrapper 0x44293c): positions are Q8 cells (256 per
 * cell), velocity is fixed at launch from the heading to the target's launch position (not homing), and the pool is
 * advanced four substeps per update after all actors have been visited.
 */
export const PROJECTILE_SUBSTEPS_PER_TICK = 4;

export interface ProjectileState {
  readonly id: number;
  readonly attackerId: number;
  readonly attackerTeam?: number;
  readonly targetId: number;
  readonly weaponId: number;
  readonly damage: number;
  readonly sourceDamage?: import("./simulation").WeaponStats["sourceDamage"];
  readonly inspireQ8: number;
  /** WEAPSTAT `shots` (BOOM profile): positional projectile that ends at the launch-time target position. */
  readonly splash: boolean;
  xQ8: number;
  yQ8: number;
  readonly vxQ8: number;
  readonly vyQ8: number;
  readonly heading: number;
  age: number;
  readonly life: number;
  readonly launchTick: number;
}

export interface ProjectileLaunchEvent {
  readonly type: "launch";
  readonly tick: number;
  readonly projectileId: number;
  readonly attackerId: number;
  readonly targetId: number;
  readonly weaponId: number;
  readonly xQ8: number;
  readonly yQ8: number;
  readonly vxQ8: number;
  readonly vyQ8: number;
  readonly heading: number;
}

export interface ProjectileImpactEvent {
  readonly type: "impact";
  readonly tick: number;
  readonly projectileId: number;
  readonly attackerId: number;
  /** Victim actually struck, or null when the projectile expired without hitting anything. */
  readonly targetId: number | null;
  readonly weaponId: number;
  readonly xQ8: number;
  readonly yQ8: number;
}

export interface ProjectileSnapshot {
  readonly id: number;
  readonly attackerId: number;
  readonly targetId: number;
  readonly weaponId: number;
  readonly xQ8: number;
  readonly yQ8: number;
  readonly vxQ8: number;
  readonly vyQ8: number;
  readonly heading: number;
  readonly age: number;
  readonly launchTick: number;
}

/** DC.EXE 0x43b935..0x43b952: substeps a projectile survives, derived from weapon range and speed. */
export function projectileLifetime(rangeCells: number, speed: number): number {
  return Math.trunc((2 * ((rangeCells << 8) + 1024) + 1) / (2 * speed)) + 1;
}

/** Launch geometry from an origin toward an aim point (all Q8 cells), per native launch routine 0x412d00. */
export function projectileLaunchVector(originX: number, originY: number, aimX: number, aimY: number, speed: number,
  rangeCells: number, splash: boolean): { vxQ8: number; vyQ8: number; heading: number; life: number } {
  const heading = direction(aimX - originX, aimY - originY);
  const vxQ8 = Math.trunc(sine(heading + 64) * speed / 2048) + 0; // +0 normalizes -0 so JSON checkpoints round-trip
  const vyQ8 = Math.trunc(sine(heading) * speed / 2048) + 0;
  let life = projectileLifetime(rangeCells, speed);
  if (splash) {
    const horizontal = Math.abs(vxQ8) > Math.abs(vyQ8);
    const velocity = horizontal ? vxQ8 : vyQ8;
    if (velocity) life = Math.max(0, Math.trunc(((horizontal ? aimX - originX : aimY - originY)) / velocity));
  }
  return { vxQ8, vyQ8, heading, life };
}

/** BOOMSTAT.TXT record 2 ("Mine"): percent of weapon damage by cell offset from the blast cell (7x7). */
export const BOOM2_WEIGHTS: readonly (readonly number[])[] = Object.freeze([
  [5, 10, 15, 20, 15, 10, 5],
  [10, 15, 30, 50, 30, 15, 10],
  [15, 30, 75, 90, 75, 30, 15],
  [20, 50, 90, 100, 90, 50, 20],
  [15, 30, 75, 90, 75, 30, 15],
  [10, 15, 30, 50, 30, 15, 10],
  [5, 10, 15, 20, 15, 10, 5],
].map(row => Object.freeze(row)));

export function boom2Percent(deltaCellX: number, deltaCellY: number): number {
  return BOOM2_WEIGHTS[deltaCellY + 3]?.[deltaCellX + 3] ?? 0;
}

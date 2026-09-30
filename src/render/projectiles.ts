import type { FinStateData } from "./fin-animation";
import type { ProjectileImpactEvent, ProjectileLaunchEvent, ProjectileSnapshot } from "../engine/projectiles";

export interface ProjectileVisualHost {
  /** WEAPSTAT visual class (token 1) for a weapon id, e.g. "TURR", "SMOK", or "weapons". */
  weaponClass(weaponId: number): string | undefined;
  /** Case-insensitive FIN state lookup across the loaded animation archives (DC.EXE binds weapon banks by name, 0x43b84f). */
  finState(name: string): { readonly sprite: string; readonly state: FinStateData } | undefined;
  /** Draws a FIN state at screen coordinates; returns true once the timeline has finished. */
  draw(sprite: string, state: FinStateData, since: number, screenX: number, screenY: number): boolean;
}

export interface ProjectileSource {
  readonly projectiles: readonly ProjectileSnapshot[];
  readonly launchEvents: readonly ProjectileLaunchEvent[];
  readonly impactEvents: readonly ProjectileImpactEvent[];
}

interface ImpactEffect {
  readonly sprite: string;
  readonly state: FinStateData;
  readonly since: number;
  readonly xQ8: number;
  readonly yQ8: number;
}

export type ProjectileProjection = (worldX: number, worldY: number) => { readonly x: number; readonly y: number };

/**
 * Weapon banks per DC.EXE 0x43b84f: travel `<class>BULLET0`, impact `<class>EXPLODE0` falling back to `<class>EXPL0`.
 * The generic "weapons" class has neither bank in the original, so those bullets have no travel/impact art.
 */
export function weaponBankNames(visualClass: string): { readonly travel: string; readonly impact: readonly string[] } {
  const prefix = visualClass.toUpperCase();
  return { travel: `${prefix}BULLET0`, impact: [`${prefix}EXPLODE0`, `${prefix}EXPL0`] };
}

export class ProjectileEffects {
  readonly #impacts: ImpactEffect[] = [];
  #lastTick = -1;
  readonly #states = new Map<string, { readonly sprite: string; readonly state: FinStateData } | null>();

  #find(host: ProjectileVisualHost, name: string) {
    let found = this.#states.get(name);
    if (found === undefined) {
      found = host.finState(name) ?? null;
      // Archives load progressively; only cache hits so late-loaded banks are still found.
      if (found) this.#states.set(name, found);
    }
    return found ?? undefined;
  }

  /** Call once per simulation step, after advance. */
  observe(source: ProjectileSource, tick: number, host: ProjectileVisualHost): void {
    if (tick === this.#lastTick) return;
    this.#lastTick = tick;
    for (const event of source.impactEvents) {
      const visualClass = host.weaponClass(event.weaponId);
      if (!visualClass) continue;
      for (const name of weaponBankNames(visualClass).impact) {
        const found = this.#find(host, name);
        if (!found) continue;
        this.#impacts.push({ ...found, since: event.tick, xQ8: event.xQ8, yQ8: event.yQ8 });
        break;
      }
    }
  }

  reset(): void {
    this.#impacts.length = 0;
    this.#lastTick = -1;
    this.#states.clear();
  }

  /** Depth-sorted draw callbacks; `y` uses the same subcell scale as unit drawables. */
  drawables(source: ProjectileSource, host: ProjectileVisualHost, project: ProjectileProjection,
    interpolation: number, visible: (worldX: number, worldY: number) => boolean = () => true): { y: number; draw: () => void }[] {
    const out: { y: number; draw: () => void }[] = [];
    for (const projectile of source.projectiles) {
      const visualClass = host.weaponClass(projectile.weaponId);
      const found = visualClass ? this.#find(host, weaponBankNames(visualClass).travel) : undefined;
      if (!found) continue;
      // Positions are stepped four substeps per tick; interpolate back from the current tick like unit movement.
      const back = Math.min(projectile.age, 4) * (1 - interpolation);
      const xQ8 = projectile.xQ8 - projectile.vxQ8 * back, yQ8 = projectile.yQ8 - projectile.vyQ8 * back;
      if (!visible(xQ8 / 256, yQ8 / 256)) continue;
      out.push({ y: yQ8 * 4, draw: () => {
        const screen = project(xQ8 / 256, yQ8 / 256);
        host.draw(found.sprite, found.state, projectile.launchTick, screen.x, screen.y);
      } });
    }
    for (const effect of [...this.#impacts]) {
      // An impact in fog is never drawn, so it would never finish; drop it instead of keeping it for the whole mission.
      if (!visible(effect.xQ8 / 256, effect.yQ8 / 256)) { this.#impacts.splice(this.#impacts.indexOf(effect), 1); continue; }
      out.push({ y: effect.yQ8 * 4, draw: () => {
        const screen = project(effect.xQ8 / 256, effect.yQ8 / 256);
        if (host.draw(effect.sprite, effect.state, effect.since, screen.x, screen.y)) {
          const index = this.#impacts.indexOf(effect);
          if (index >= 0) this.#impacts.splice(index, 1);
        }
      } });
    }
    return out;
  }
}

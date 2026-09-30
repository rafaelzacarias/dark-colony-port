import { areHostile } from "./diplomacy";
import { LEGACY_SCAN_OFFSETS } from "./legacy-scan-offsets";
import type { SimulationSnapshot } from "./simulation";

export interface AcquisitionTraits {
  readonly armed: boolean;
  readonly priority: boolean;
  readonly excluded?: boolean;
}

export interface BrowserAcquisitionRequest {
  readonly snapshot: SimulationSnapshot;
  readonly guardId: number;
  readonly radiusCells: number;
  readonly splash?: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly canDamage: (targetId: number) => boolean;
  readonly traits?: (targetId: number) => AcquisitionTraits;
  readonly isCellVisible?: (x: number, y: number) => boolean;
  readonly cellsOf?: (targetId: number) => readonly { readonly x: number; readonly y: number }[] | undefined;
}

type Occupant = SimulationSnapshot["units"][number] | SimulationSnapshot["staticTargets"][number];
interface Entry { readonly actor: Occupant; readonly plane: "ground" | "air" }

/** Per-snapshot occupancy so several guards share one cell index. */
export class AcquisitionIndex {
  readonly #cells = new Map<number, Entry[]>();
  readonly #width: number;

  constructor(readonly snapshot: SimulationSnapshot, width = 256, readonly height = 256,
    cellsOf?: BrowserAcquisitionRequest["cellsOf"]) {
    this.#width = width;
    const add = (actor: Occupant, plane: "ground" | "air", x: number, y: number) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const key = y * width + x;
      const list = this.#cells.get(key);
      if (list) list.push({ actor, plane }); else this.#cells.set(key, [{ actor, plane }]);
    };
    for (const unit of snapshot.units) {
      if (unit.health <= 0 || unit.activity === "die") continue;
      add(unit, unit.movementPlane === "air" ? "air" : "ground", unit.cellX, unit.cellY);
    }
    for (const target of snapshot.staticTargets) {
      if (target.health <= 0 || target.activity === "die") continue;
      const cells = cellsOf?.(target.id);
      if (cells?.length) for (const cell of cells) add(target, "ground", cell.x, cell.y);
      else add(target, "ground", target.cellX, target.cellY);
    }
    for (const list of this.#cells.values()) {
      list.sort((left, right) => (left.plane === right.plane ? 0 : left.plane === "ground" ? -1 : 1) || left.actor.id - right.actor.id);
    }
  }

  at(x: number, y: number): readonly Entry[] {
    return this.#cells.get(y * this.#width + x) ?? [];
  }

  get width(): number { return this.#width; }
}

const noTraits: AcquisitionTraits = { armed: true, priority: false };

/**
 * Browser-state equivalent of DC.EXE 0x435570: scan the 0x434090 rings out to `radiusCells`, filter neutral/self/allied
 * and immune candidates, score (unarmed 50 / armed 150, +200 priority, splash neighbour bonus, otherwise the original
 * signed health factor) and replace only on a strictly greater score so ring/cell/plane order breaks ties.
 */
export function acquireBrowserTarget(request: BrowserAcquisitionRequest, index?: AcquisitionIndex): number | null {
  const { snapshot, guardId } = request;
  const guard = snapshot.units.find(unit => unit.id === guardId);
  if (!guard) return null;
  const width = request.width ?? index?.width ?? 256, height = request.height ?? index?.height ?? 256;
  const cells = index ?? new AcquisitionIndex(snapshot, width, height, request.cellsOf);
  const eligibility = new Map<number, boolean>();
  const canDamage = (id: number): boolean => {
    let value = eligibility.get(id);
    if (value === undefined) { value = request.canDamage(id); eligibility.set(id, value); }
    return value;
  };
  let ring = 0, best: number | null = null, bestScore = -1;
  for (const [dx, dy] of LEGACY_SCAN_OFFSETS) {
    if (dx === 99) { if (++ring > request.radiusCells) break; continue; }
    const x = guard.cellX + dx, y = guard.cellY + dy;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const occupants = cells.at(x, y);
    if (!occupants.length) continue;
    if (request.isCellVisible && !request.isCellVisible(x, y)) continue;
    for (const { actor } of occupants) {
      const traits = request.traits?.(actor.id) ?? noTraits;
      if (traits.excluded) continue;
      if (actor.id === guardId || (actor.team !== undefined && actor.team >= 8)) continue;
      if (!areHostile(guard, actor, snapshot.teamAlliances) || !canDamage(actor.id)) continue;
      let score = traits.armed ? 150 : 50;
      if (traits.priority) score += 200;
      if (request.splash) {
        for (let nearbyX = Math.max(0, x - 1); nearbyX <= Math.min(width - 1, x + 1); nearbyX++) {
          for (let nearbyY = Math.max(0, y - 1); nearbyY <= Math.min(height - 1, y + 1); nearbyY++) {
            if (cells.at(nearbyX, nearbyY).some(entry => entry.plane === "ground")) score += 10;
          }
        }
      } else {
        // 0x435570 signed health factor: any living candidate scores zero here, so scan order decides.
        let factor = (1024 - Math.trunc(actor.health)) | 0;
        if (factor < 1024) factor = 0;
        score = Math.imul(score, ((factor + 1024) | 0) >> 11);
      }
      if (score > bestScore) { bestScore = score; best = actor.id; }
    }
  }
  return best;
}

export type FinAction = "Stand" | "Move" | "Attack" | "Die";
export type CompassDirection = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
export type FinDirections = Readonly<Record<CompassDirection, string>>;

export interface FinStateData {
  readonly name: string;
  readonly firstTimelineIndex: number;
  readonly lastTimelineIndex: number;
  readonly validRange?: boolean;
}

export interface FinChildData {
  readonly sprite: string;
  readonly frame: number;
  readonly x: number;
  readonly y: number;
  readonly layer: number;
  readonly flags?: number;
  readonly valueA?: number;
  readonly valueB?: number;
}

export interface FinTimelineData {
  readonly field2?: number;
  readonly children: readonly FinChildData[];
}

export interface FinAnimationData {
  readonly states: readonly FinStateData[];
  readonly timeline: readonly FinTimelineData[];
}

export interface FinAtlasFrame {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly empty: boolean;
}

export interface FinPoint {
  readonly x: number;
  readonly y: number;
}

export interface FinSelection {
  readonly state: FinStateData;
  readonly action: FinAction;
  readonly direction: CompassDirection | null;
  readonly fallback: boolean;
}

export interface FinSample {
  readonly timelineIndex: number;
  readonly finished: boolean;
  readonly children: readonly FinChildData[];
}

export interface FinPlacement extends FinPoint {
  readonly child: FinChildData;
  readonly frame: FinAtlasFrame;
}

export interface FinSelectorOptions {
  readonly prefix: string;
  readonly directions: FinDirections;
  readonly families?: Readonly<Record<FinAction, readonly string[]>>;
  readonly layerOrder: "ascending" | "descending" | "source";
}

const COMPASS: readonly CompassDirection[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export const TRSC_GRAY_VISUAL_DIRECTIONS: FinDirections = Object.freeze({
  N: "8", NE: "10", E: "12", SE: "14", S: "0", SW: "2", W: "4", NW: "6",
});

export const FIN_STATE_FAMILIES: Readonly<Record<FinAction, readonly string[]>> = {
  Stand: ["STAND"],
  Move: ["MOVE"],
  Attack: ["FIREA", "FIREB", "FIRE", "ATTACK"],
  Die: ["DIEA", "DIEB", "DIEC", "DIE2", "DIE"],
};

function finite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

export function finSourceDuration(field2: number): number {
  if (!Number.isInteger(field2) || field2 < 0 || field2 > 65535) {
    throw new RangeError("FIN field2 must be an unsigned word");
  }
  const word = field2 === 0 ? 15 : field2;
  const signed = word >= 32768 ? word - 65536 : word;
  return Math.trunc((signed + 3) * 15 / 100) & 255;
}

export function directionFromMotion(dx: number, dy: number, stationary: CompassDirection): CompassDirection {
  finite(dx, "dx");
  finite(dy, "dy");
  if (dx === 0 && dy === 0) return stationary;
  const octant = Math.round(Math.atan2(dx, -dy) / (Math.PI / 4));
  return COMPASS[(octant + 8) % 8];
}

export function worldYSubcells(y: number, units: "cells" | "subcells"): number {
  finite(y, "y");
  return units === "cells" ? y * 1024 : y;
}

export function createFinSelector(animation: FinAnimationData, options: FinSelectorOptions) {
  const families = options.families ?? FIN_STATE_FAMILIES;
  const states = new Map<string, FinStateData>();
  for (const state of animation.states) {
    if (state.validRange === false || !Number.isInteger(state.firstTimelineIndex)
      || !Number.isInteger(state.lastTimelineIndex) || state.firstTimelineIndex < 0
      || state.lastTimelineIndex < state.firstTimelineIndex
      || state.lastTimelineIndex >= animation.timeline.length) continue;
    const key = state.name.toUpperCase();
    if (!states.has(key)) states.set(key, state);
  }
  const children = animation.timeline.map((entry) => {
    const ordered = [...entry.children];
    if (options.layerOrder !== "source") {
      const sign = options.layerOrder === "ascending" ? 1 : -1;
      ordered.sort((left, right) => sign * (left.layer - right.layer));
    }
    return Object.freeze(ordered);
  });
  const selections = new Map<string, FinSelection | undefined>();
  for (const action of Object.keys(families) as FinAction[]) {
    for (const direction of COMPASS) {
      const requestedIndex = COMPASS.indexOf(direction);
      const nearest = [...COMPASS].sort((left, right) => {
        const leftDelta = (COMPASS.indexOf(left) - requestedIndex + 8) % 8;
        const rightDelta = (COMPASS.indexOf(right) - requestedIndex + 8) % 8;
        return Math.min(leftDelta, 8 - leftDelta) - Math.min(rightDelta, 8 - rightDelta)
          || leftDelta - rightDelta;
      });
      const actions: readonly FinAction[] = action === "Move" || action === "Attack" ? [action, "Stand"] : [action];
      let selection: FinSelection | undefined;
      for (const candidateAction of actions) {
        for (const candidateDirection of [...nearest, null]) {
          for (const family of families[candidateAction]) {
            const suffix = candidateDirection === null ? "" : options.directions[candidateDirection];
            const state = states.get(`${options.prefix}${family}${suffix}`.toUpperCase());
            if (state) {
              selection = {
                state, action: candidateAction, direction: candidateDirection,
                fallback: candidateAction !== action || candidateDirection !== direction,
              };
              break;
            }
          }
          if (selection) break;
        }
        if (selection) break;
      }
      selections.set(`${action}:${direction}`, selection);
    }
  }

  return {
    select(action: FinAction, direction: CompassDirection): FinSelection | undefined {
      return selections.get(`${action}:${direction}`);
    },
    sample(selection: FinSelection, elapsedTicks: number, framesPerSecond: number, ticksPerSecond: number): FinSample {
      finite(elapsedTicks, "elapsedTicks");
      finite(framesPerSecond, "framesPerSecond");
      finite(ticksPerSecond, "ticksPerSecond");
      if (framesPerSecond <= 0 || ticksPerSecond <= 0) throw new RangeError("Rates must be positive");
      const { firstTimelineIndex, lastTimelineIndex } = selection.state;
      const count = lastTimelineIndex - firstTimelineIndex + 1;
      const step = Math.floor(Math.max(0, elapsedTicks) * (framesPerSecond / ticksPerSecond));
      finite(step, "timeline step");
      const dying = selection.action === "Die";
      const timelineIndex = firstTimelineIndex + (dying ? Math.min(step, count - 1) : step % count);
      return { timelineIndex, finished: dying && step >= count, children: children[timelineIndex] ?? [] };
    },
  };
}

export function createFinFrameLookup(atlases: Readonly<Record<string, { readonly frames: readonly FinAtlasFrame[] }>>) {
  const sprites = new Map(Object.entries(atlases).map(([sprite, atlas]) => [
    sprite.toUpperCase(), new Map(atlas.frames.map((frame) => [frame.index, frame])),
  ]));
  return (sprite: string, frameId: number): FinAtlasFrame | undefined => sprites.get(sprite.toUpperCase())?.get(frameId);
}

export function finChildPlacements(
  sample: FinSample,
  frameLookup: (sprite: string, frameId: number) => FinAtlasFrame | undefined,
  place: (child: FinChildData, frame: FinAtlasFrame) => FinPoint,
): readonly FinPlacement[] {
  const placements: FinPlacement[] = [];
  for (const child of sample.children) {
    const frame = frameLookup(child.sprite, child.frame);
    if (!frame || frame.empty || frame.width <= 0 || frame.height <= 0) continue;
    placements.push({ child, frame, ...place(child, frame) });
  }
  return placements;
}

export function finCanvasPlacement(origin: FinPoint, anchorMode: "add" | "subtract" | "ignore") {
  const sign = anchorMode === "add" ? 1 : anchorMode === "subtract" ? -1 : 0;
  return (child: FinChildData, frame: FinAtlasFrame): FinPoint => ({
    x: child.x + sign * frame.anchorX - origin.x,
    y: child.y + sign * frame.anchorY - origin.y,
  });
}
export type LegacyFireSourceType = 0 | 8 | 69 | 70 | 71 | 72 | 73 | 74 | 75 | 76;

export type LegacyFireHandoff = "pending-order" | "target-gone";

export type LegacyFireCycle = Readonly<{
  sourceType: LegacyFireSourceType;
}> & (
  | Readonly<{ phase: "ready" }>
  | Readonly<{ phase: "reload"; remaining: number }>
  | Readonly<{ phase: "handoff"; reason: LegacyFireHandoff }>
);

export interface LegacyFireObservation {
  readonly targetSlot: number;
  readonly targetStatus: 0 | 1;
  readonly pendingOrder: boolean;
  readonly facingAligned: boolean;
}

export interface LegacyFireStep {
  readonly state: LegacyFireCycle;
  readonly launch: Readonly<{ weaponId: number; targetSlot: number }> | null;
}

function baseWeapon(sourceType: LegacyFireSourceType): number {
  switch (sourceType) {
    case 0: return 1;
    case 8: return 15;
    case 69: case 70: case 71: case 72: return 5;
    case 73: case 74: case 75: case 76: return 62;
    default: throw new RangeError("Unsupported native ordinary fire source type");
  }
}

export function createLegacyFireCycle(sourceType: LegacyFireSourceType): LegacyFireCycle {
  baseWeapon(sourceType);
  return Object.freeze({ sourceType, phase: "ready" });
}

export function stepLegacyFireCycle(
  state: LegacyFireCycle,
  observation: LegacyFireObservation,
): LegacyFireStep {
  const weaponId = baseWeapon(state.sourceType);
  if (
    !Number.isInteger(observation.targetSlot) || observation.targetSlot < 0 || observation.targetSlot >= 800 ||
    (observation.targetStatus !== 0 && observation.targetStatus !== 1) ||
    typeof observation.pendingOrder !== "boolean" || typeof observation.facingAligned !== "boolean"
  ) {
    throw new RangeError("Unsupported native fire observation");
  }
  if (state.phase === "handoff") {
    if (state.reason !== "pending-order" && state.reason !== "target-gone") {
      throw new RangeError("Invalid native fire handoff");
    }
    return { state, launch: null };
  }
  if (state.phase === "reload") {
    if (!Number.isInteger(state.remaining) || state.remaining < 0 || state.remaining > 15) {
      throw new RangeError("Invalid native reload countdown");
    }
    return {
      state: Object.freeze(state.remaining === 0
        ? { sourceType: state.sourceType, phase: "ready" }
        : { ...state, remaining: state.remaining - 1 }),
      launch: null,
    };
  }
  if (state.phase !== "ready") throw new RangeError("Invalid native fire phase");
  if (observation.pendingOrder || observation.targetStatus === 0) {
    return {
      state: Object.freeze({ sourceType: state.sourceType, phase: "handoff",
        reason: observation.pendingOrder ? "pending-order" : "target-gone" }),
      launch: null,
    };
  }
  if (!observation.facingAligned) return { state, launch: null };
  return {
    state: Object.freeze({ sourceType: state.sourceType, phase: "reload", remaining: 15 }),
    launch: Object.freeze({ weaponId, targetSlot: observation.targetSlot }),
  };
}
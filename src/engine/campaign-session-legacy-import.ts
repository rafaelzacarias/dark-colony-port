export const CURRENT_CAMPAIGN_REPLAY_POLICY = "current-population-v1" as const;

export interface LegacyCampaignImportConsent {
  readonly policy: "legacy-unmaintained-population-v0";
  readonly acknowledgeAmbiguousUnversionedSave: true;
}

export interface CampaignReplayDifference {
  readonly path: readonly string[];
  readonly saved: unknown;
  readonly replayed: unknown;
}

export function campaignReplayDifferences(saved: unknown, replayed: unknown,
  path: readonly string[] = []): CampaignReplayDifference[] {
  if (Object.is(saved, replayed)) return [];
  if (saved === null || replayed === null || typeof saved !== "object" || typeof replayed !== "object"
    || Array.isArray(saved) !== Array.isArray(replayed)) return [{ path, saved, replayed }];
  const previous = saved as Record<string, unknown>, current = replayed as Record<string, unknown>;
  const differences: CampaignReplayDifference[] = [];
  for (const key of new Set([...Object.keys(previous), ...Object.keys(current)])) {
    if (!Object.hasOwn(previous, key) || !Object.hasOwn(current, key)) {
      differences.push({ path: [...path, key], saved: previous[key], replayed: current[key] });
    } else differences.push(...campaignReplayDifferences(previous[key], current[key], [...path, key]));
  }
  return differences;
}

export function isPopulationReplayDifference(difference: CampaignReplayDifference): boolean {
  const path = difference.path;
  return (path.length === 3 && path[0] === "world" && path[1] === "statistics"
    || path.length === 4 && path[0] === "controller" && path[1] === "runtime" && path[2] === "statistics")
    && /^[0-7],6$/.test(path.at(-1)!);
}

export function firstNonPopulationReplayDifference(saved: unknown, replayed: unknown,
  path: readonly string[] = []): CampaignReplayDifference | undefined {
  if (Object.is(saved, replayed)) return undefined;
  const difference = { path, saved, replayed };
  const commandPopulation = path.length === 5 && path[0] === "journal" && path[1] === "commands"
    && /^\d+$/.test(path[2]) && path[3] === "statistics" && /^[0-7],6$/.test(path[4]);
  if ((isPopulationReplayDifference(difference) || commandPopulation)
    && typeof saved === "number" && typeof replayed === "number") return undefined;
  if (saved === null || replayed === null || typeof saved !== "object" || typeof replayed !== "object") return difference;
  if (ArrayBuffer.isView(saved) || ArrayBuffer.isView(replayed)) {
    if (!(saved instanceof Uint8Array) || !(replayed instanceof Uint8Array) || saved.length !== replayed.length) return difference;
    for (let index = 0; index < saved.length; index++) {
      if (saved[index] !== replayed[index]) return { path: [...path, String(index)], saved: saved[index], replayed: replayed[index] };
    }
    return undefined;
  }
  if (Array.isArray(saved) !== Array.isArray(replayed)) return difference;
  const previous = saved as Record<string, unknown>, current = replayed as Record<string, unknown>;
  const keys = Object.keys(previous);
  if (keys.length !== Object.keys(current).length) return difference;
  for (const key of keys) {
    if (!Object.hasOwn(current, key)) return { path: [...path, key], saved: previous[key], replayed: undefined };
    const found = firstNonPopulationReplayDifference(previous[key], current[key], [...path, key]);
    if (found) return found;
  }
  return undefined;
}

export class LegacyCampaignImportError extends Error {
  constructor(readonly code: "legacy-authentication-failed" | "behavior-diverged",
    readonly differences: readonly CampaignReplayDifference[], readonly cycleCounter: number) {
    super(`Legacy import ${code} at tick ${cycleCounter}: ${differences[0]?.path.join(".") ?? "replay failed"}. `
      + "Restart this mission from current sources; the checkpoint has not been changed.");
    this.name = "LegacyCampaignImportError";
  }
}
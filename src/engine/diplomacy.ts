import type { Faction } from "./simulation";

export interface TeamAffiliation {
  readonly faction: Faction;
  readonly team?: number;
}

export type TeamAlliances = readonly (readonly number[])[];

export const SOURCE_ALLIANCE_POLICY = "observer-row" as const;

export function validateTeam(team: number | undefined): void {
  if (team !== undefined && (!Number.isSafeInteger(team) || team < 0)) {
    throw new RangeError("team must be a non-negative safe integer");
  }
}

export function copyTeamAlliances(alliances: TeamAlliances = []): TeamAlliances {
  return Object.freeze(alliances.map((row) => {
    if (row.some((value) => value !== 0 && value !== 1)) {
      throw new RangeError("team alliance values must be 0 or 1");
    }
    return Object.freeze([...row]);
  }));
}

export function areHostile(
  observer: TeamAffiliation,
  target: TeamAffiliation,
  alliances: TeamAlliances = [],
): boolean {
  if (observer.team === undefined || target.team === undefined) return observer.faction !== target.faction;
  return observer.team !== target.team && alliances[observer.team]?.[target.team] !== 1;
}
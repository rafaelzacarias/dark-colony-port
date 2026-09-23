import type { CampaignMissionData } from "../game-data";
import { projectLegacyColony, type LegacyColonyBuilding, type LegacyColonyTeam } from "./legacy-colony";
import { createLegacyProductionCatalog, type LegacyProductionSourceRecord } from "./legacy-production";

export interface SourceBuildingOption {
  readonly dependency: number;
  readonly cost: number;
  readonly prerequisites: readonly number[];
  readonly level: number;
  readonly maximumLevel: number;
  readonly building: LegacyColonyBuilding;
}

export function sourceBuildingOptions(mission: Pick<CampaignMissionData, "units"> & { readonly scenario: { readonly teams: readonly LegacyColonyTeam[] } },
  records: readonly LegacyProductionSourceRecord[], teamIndex = 0): readonly SourceBuildingOption[] {
  const team = mission.scenario.teams[teamIndex];
  if (!team || team.index !== teamIndex || ![0, 1].includes(team.race)) throw new TypeError("Source buildings: invalid team");
  const entries = [...createLegacyProductionCatalog(records).values()].filter(entry =>
    entry.kind === "building" && entry.rawFields[3] === team.race);
  return entries.map(entry => {
    const slot = entry.rawFields[1], level = entry.rawFields[2];
    if (!Number.isInteger(slot) || slot < 0 || slot > 4 || ![0, 1].includes(level)) {
      throw new TypeError("Source buildings: invalid slot/level");
    }
    const city = [...team.cityRows[0]];
    city[slot * 2] = level + 1;
    city[slot * 2 + 1] = -1;
    const building = projectLegacyColony([{ ...team, cityRows: [city, ...team.cityRows.slice(1)] }], mission.units)
      .buildings.find(candidate => candidate.slot === slot);
    if (!building || building.health !== building.maxHealth) throw new TypeError("Source buildings: absent home or inconsistent source HP");
    return { dependency: entry.id, cost: entry.cost, prerequisites: entry.dependencies, level,
      maximumLevel: Math.max(...entries.filter(candidate => candidate.rawFields[1] === slot).map(candidate => candidate.rawFields[2])),
      building };
  });
}

export function sourceBuildingRequirements(option: SourceBuildingOption, options: readonly SourceBuildingOption[],
  slots: readonly { readonly health: number; readonly level: number; readonly busy: number }[]): readonly number[] {
  return option.prerequisites.filter(dependency => {
    const prerequisite = options.find(candidate => candidate.dependency === dependency);
    const slot = prerequisite && slots[prerequisite.building.slot];
    return !prerequisite || !slot || slot.health <= 0 || slot.busy !== 0 || slot.level < prerequisite.level;
  });
}
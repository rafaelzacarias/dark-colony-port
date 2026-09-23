import type { CampaignMissionData } from "../game-data";
import type { DependencyRecord } from "../../tools/extractors/data/tables";
import { parseScenario } from "../../tools/extractors/data/scenario";
import { createBrowserCampaignAiConfiguration, type BrowserCampaignAiConfiguration } from "./browser-campaign-ai";
import { createBrowserCampaignEconomyProfile } from "./browser-campaign-economy-source";
import type { BrowserEconomyProfile } from "./browser-campaign-economy";
import type { BrowserConstructionConfiguration } from "./browser-construction";
import { createBrowserAiSelectorConfiguration } from "./browser-campaign-runtime";
import { initializeCampaignSession, type CampaignSessionOptions } from "./campaign-session";
import { NavigationGrid } from "./grid";
import { createLegacyInfantryFamilyMask } from "./legacy-navigation";
import { DeterministicRandom } from "./random";
import { sourceUnitIsCommander } from "./browser-casualty-pickup";
import { decodeMissionWorldAction } from "./mission-controller";
import { loadSourceBrowserResearchConfiguration } from "./source-browser-research";
import type { BrowserResearchConfiguration } from "./browser-research";

export interface SourceBrowserCampaignMission extends CampaignMissionData {
  readonly runtimeProfile?: "browser-adapted";
  readonly browserAi?: BrowserCampaignAiConfiguration;
  readonly browserEconomy?: BrowserEconomyProfile;
  readonly browserConstruction?: BrowserConstructionConfiguration;
  readonly browserResearch?: BrowserResearchConfiguration;
}

function sourceCommanders(mission: SourceBrowserCampaignMission): CampaignSessionOptions["commanders"] {
  const mappings = mission.faction === "human" ? [{ team: 0, unitType: 69, sprite: "TRSC" }]
    : [{ team: 0, unitType: 73, sprite: "GRAY" }, { team: 1, unitType: 69, sprite: "TRSC" }];
  const commands = mission.triggers.flatMap(block => block.actions.flatMap(action => {
    if (!["abduct", "reinforce", "reinforce2"].includes(action.name)) return [];
    const decoded = decodeMissionWorldAction(action, { runtimeProfile: "browser-adapted" });
    if (!decoded.ok) throw new TypeError(`Commander source command ${block.id}: ${JSON.stringify(decoded.diagnostics)}`);
    return [decoded.value];
  }));
  const required = new Set(commands.flatMap(command => command.kind === "abduct" ? [command.selectedSide] : []));
  const roles = new Map<number, Set<number>>();
  const record = (team: number, unitType: number) => {
    if (!required.has(team) || !sourceUnitIsCommander(unitType)) return;
    const unit = mission.units.find(candidate => candidate.index === unitType);
    const side = mission.scenario.teams.find(candidate => candidate.index === team);
    if (!unit || !side || unit.faction !== side.race || !unit.sprite) {
      throw new TypeError(`Commander source definition mismatch for team ${team}, type ${unitType}`);
    }
    const types = roles.get(team) ?? new Set<number>();
    types.add(unitType);
    roles.set(team, types);
  };
  const queues = new Set<string>();
  for (const [tileX, tileY, sourceType, team] of mission.scenario.placementRows) {
    if (team === -1) continue;
    const unit = mission.units.find(candidate => candidate.index === sourceType);
    const side = mission.scenario.teams.find(candidate => candidate.index === team);
    const counterpart = unit && side && unit.faction !== side.race ? unit.rawTail[20] : -1;
    if (required.has(team) && sourceUnitIsCommander(sourceType) && !Number.isInteger(counterpart)) {
      throw new TypeError(`Missing commander counterpart metadata for team ${team}, type ${sourceType}`);
    }
    const unitType = counterpart === -1 ? sourceType : counterpart;
    if (unitType === 37) queues.add(`${tileX},${tileY}`);
    else if (team >= 0 && team < 8 && !queues.has(`${tileX},${tileY}`)) record(team, unitType);
  }
  for (const command of commands) {
    if (command.kind !== "reinforce" && command.kind !== "reinforce2") continue;
    if (command.kind === "reinforce2" && queues.has(`${command.tileX},${command.tileY}`)) continue;
    for (const group of command.groups) if (group.count > 0) record(command.team, group.unitType);
  }
  for (const team of [...required].sort((left, right) => left - right)) {
    const types = roles.get(team);
    if (!types || types.size !== 1) {
      throw new TypeError(`Unresolved or ambiguous commander source role for team ${team}: ${JSON.stringify([...(types ?? [])])}`);
    }
    const unitType = [...types][0];
    const existing = mappings.find(mapping => mapping.team === team);
    if (existing) {
      if (existing.unitType !== unitType || existing.sprite !== mission.units.find(unit => unit.index === unitType)!.sprite) {
        throw new TypeError(`Commander source role conflicts with existing mapping for team ${team}`);
      }
    } else mappings.push({ team, unitType, sprite: mission.units.find(unit => unit.index === unitType)!.sprite });
  }
  return mappings;
}

export function sourceBrowserCampaignSessionOptions(mission: SourceBrowserCampaignMission): CampaignSessionOptions {
  const { rawScenario: _rawScenario, ...source } = mission.scenario;
  const random = new DeterministicRandom(0xdc1997);
  if (mission.sourceResource?.resourceLifecycle.nativeHarvest) throw new TypeError("Browser economy excludes native harvest ownership");
  return {
    sessionId: `${source.id}:browser`, source, units: mission.units, weapons: mission.weapons,
    triggers: mission.triggers, messages: mission.messages, map: mission.map, pathGrid: mission.pathGrid, tags: mission.tags,
    commanders: sourceCommanders(mission),
    directionBits: Array.from({ length: 256 }, () => [random.nextInt(2) as 0 | 1, random.nextInt(2) as 0 | 1] as const),
    fixedStepMilliseconds: 50, orientationSteps: 1, resourceScales: mission.sourceResource?.resourceScales ?? "configured-startup",
    runtimeProfile: "browser-adapted", browserAi: createBrowserAiSelectorConfiguration(source),
    ...(mission.browserEconomy ? { browserEconomy: mission.browserEconomy } : {}),
    ...(mission.browserConstruction ? { browserConstruction: mission.browserConstruction } : {}),
    ...(mission.sourceProduction?.production ? { production: mission.sourceProduction.production } : {}),
  };
}

export async function prepareSourceBrowserCampaignMission(mission: CampaignMissionData,
  dependencies: readonly DependencyRecord[]): Promise<Required<Pick<SourceBrowserCampaignMission,
    "runtimeProfile" | "browserAi" | "browserEconomy" | "browserResearch">>> {
  if (!mission.scenario.rawScenario) throw new TypeError("Browser campaign requires original SCN bytes");
  const scenario = parseScenario(atob(mission.scenario.rawScenario));
  const prepared = { ...mission, scenario: { ...mission.scenario, ...scenario } };
  const initial = initializeCampaignSession(sourceBrowserCampaignSessionOptions(prepared));
  if (!initial.ok) throw new Error(JSON.stringify(initial.diagnostics));
  const [browserAi, browserEconomy, browserResearch] = await Promise.all([
    createBrowserCampaignAiConfiguration({ scenario, units: mission.units, weapons: mission.weapons, dependencies,
      pathGrid: new NavigationGrid(mission.map.width, mission.map.height,
        Uint16Array.from(createLegacyInfantryFamilyMask({ ...mission.map, pathGrid: mission.pathGrid }))) }),
    createBrowserCampaignEconomyProfile({ scope: "browser-adapted-economy-v1", world: initial.value.world,
      teams: scenario.teams, units: mission.units }),
    loadSourceBrowserResearchConfiguration(mission),
  ]);
  return { runtimeProfile: "browser-adapted", browserAi, browserEconomy, browserResearch };
}
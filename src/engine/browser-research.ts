import type { DependencyRecord, UnitStatRecord } from "../../tools/extractors/data/tables";
import { aiSelectorSourceCanonical } from "./ai-command-selector";
import type { CampaignWorld } from "./campaign-world";
import { transportHostState } from "./transport-host";

export interface BrowserResearchConfiguration {
  readonly kind: "browser-research-source-v1";
  readonly runtimeProfile: "browser-adapted";
  readonly sourceCanonical: string;
  readonly scienceOwner: string;
  readonly activation: "source-city-slot4-health";
  readonly sourceTablesCanonical: string;
}

export interface BrowserResearchState {
  readonly kind: "browser-research-state-v1";
  readonly sourceCanonical: string;
  readonly scienceOwner: string;
  readonly sessionId: string;
  readonly clockMilliseconds: number;
  readonly teams: readonly {
    readonly team: number;
    readonly dependency: 6 | 20;
    readonly unitType: 22 | 34;
    readonly health: number;
    readonly actor: { readonly key: string; readonly slot: number; readonly generation: number } | null;
  }[];
  readonly spyTeams: readonly boolean[];
}

const configurations = new WeakSet<BrowserResearchConfiguration>();

function requireResearch(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(`Browser research: ${message}`);
}

export function createBrowserResearchConfiguration(input: {
  readonly runtimeProfile: "browser-adapted";
  readonly activation: "source-city-slot4-health";
  readonly scienceOwner: string;
  readonly source: CampaignWorld["source"];
  readonly units: readonly Pick<UnitStatRecord, "index" | "sprite" | "faction" | "health" | "movementSpeed" | "weapons">[];
  readonly dependencies: readonly DependencyRecord[];
}): BrowserResearchConfiguration {
  requireResearch(input.runtimeProfile === "browser-adapted" && input.activation === "source-city-slot4-health",
    "explicit adapted source-health profile required");
  requireResearch(typeof input.scienceOwner === "string" && input.scienceOwner.trim().length > 0
    && input.scienceOwner.length <= 128, "declared science owner required");
  const units = [22, 34].map(index => {
    const records = input.units.filter(unit => unit.index === index), unit = records[0];
    requireResearch(records.length === 1 && unit.sprite === (index === 22 ? "RSCHPOD" : "RSCHIV")
      && unit.faction === (index === 22 ? 0 : 1) && unit.health === 3600 && unit.movementSpeed === 0
      && unit.weapons.length === 3 && unit.weapons.every(weapon => weapon === -1), "source research definition mismatch");
    return unit;
  });
  const dependencies = [0, 2, 4, 6, 14, 16, 18, 20].map(id => {
    const records = input.dependencies.filter(entry => entry.id === id), entry = records[0];
    const race = id >= 14 ? 1 : 0, local = id - race * 14;
    const slot = local === 0 ? 0 : local === 6 ? 4 : 3;
    const prerequisites = local === 0 ? [] : [race * 14 + (local === 2 ? 0 : local === 4 ? 2 : 4)];
    requireResearch(records.length === 1 && entry.cost === (local === 6 ? 3000 : 2000)
      && JSON.stringify(entry.rawFields) === JSON.stringify([0, slot, local === 4 ? 1 : 0, race])
      && JSON.stringify(entry.dependencies) === JSON.stringify(prerequisites), "source research dependency mismatch");
    return entry;
  });
  const configuration: BrowserResearchConfiguration = Object.freeze({ kind: "browser-research-source-v1",
    runtimeProfile: input.runtimeProfile, activation: input.activation, scienceOwner: input.scienceOwner,
    sourceCanonical: aiSelectorSourceCanonical(input.source), sourceTablesCanonical: JSON.stringify({ units, dependencies }) });
  configurations.add(configuration);
  return configuration;
}

export function validateBrowserResearchConfiguration(source: CampaignWorld["source"], configuration: BrowserResearchConfiguration): void {
  requireResearch(configurations.has(configuration) && configuration.runtimeProfile === "browser-adapted"
    && configuration.sourceCanonical === aiSelectorSourceCanonical(source), "source/profile mismatch");
}

export function observeBrowserResearch(world: CampaignWorld, configuration: BrowserResearchConfiguration,
  scienceOwner: string): BrowserResearchState {
  validateBrowserResearchConfiguration(world.source, configuration);
  requireResearch(scienceOwner === configuration.scienceOwner, "science owner mismatch");
  const host = transportHostState(world);
  const teams = Array.from({ length: 8 }, (_, team) => {
    const sourceTeams = world.source.teams.filter(entry => entry.index === team), race = sourceTeams[0]?.race;
    requireResearch(sourceTeams.length === 1 && (race === 0 || race === 1), "source team/race mismatch");
    const slot = team * 15 + 4, health = world.buildingSlots[`${team},4`];
    requireResearch(Number.isInteger(health) && health >= 0 && health <= 3600, "missing or invalid slot-4 health");
    const unitType = race === 0 ? 22 as const : 34 as const;
    const entities = world.entities.filter(entry => entry.rawSlot === slot);
    requireResearch(entities.length <= 1, "duplicate research actor");
    const entity = entities[0], actor = host.slots[slot];
    if (health > 0) {
      requireResearch(entity && actor && entity.team === team && entity.unitType === unitType
        && entity.health === health && actor.health === health && actor.team === team && actor.unitType === unitType
        && actor.key === entity.key && actor.generation === entity.generation && host.generations[slot] === entity.generation
        && actor.status !== 0 && actor.status !== 10 && host.registry[slot] === entity.key, "stale research actor/health");
    } else {
      requireResearch(!entity || entity.health === 0, "slot-4 health disagrees with actor");
      requireResearch(!actor || actor.health === 0 || actor.status === 0 || actor.status === 10, "slot-4 health disagrees with host");
    }
    return { team, dependency: race === 0 ? 6 as const : 20 as const, unitType, health,
      actor: health > 0 ? { key: entity.key, slot, generation: entity.generation } : null };
  });
  return { kind: "browser-research-state-v1", sourceCanonical: configuration.sourceCanonical,
    scienceOwner, sessionId: world.sessionId, clockMilliseconds: world.clockMilliseconds,
    teams, spyTeams: teams.map(team => team.health !== 0) };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function restoreBrowserResearch(world: CampaignWorld, configuration: BrowserResearchConfiguration,
  saved: unknown): BrowserResearchState {
  const expected = observeBrowserResearch(world, configuration, configuration.scienceOwner);
  requireResearch(canonical(saved) === canonical(expected), "saved research does not match committed city owner");
  return expected;
}
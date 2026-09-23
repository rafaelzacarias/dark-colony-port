import { assetUrl } from "../asset-url";
import type { CampaignMissionData } from "../game-data";
import { finSourceDuration, type FinAnimationData } from "../render/fin-animation";
import { parseScenario, type ScenarioDefinition } from "../../tools/extractors/data/scenario";
import { ADAPTED_UNIT_PRODUCTION_SOURCES, createCampaignProduction, productionChoices, productionProducerSlot, type CampaignProductionState,
  type AdaptedProductionUpgrades, type ProductionProducerVisit, type ProductionSourceProfile, type ProductionTeamSeed,
  type ProductionUnitSource } from "./campaign-production";
import type { CampaignWorld } from "./campaign-world";
import { projectLegacyColony } from "./legacy-colony";
import { sourceScenarioUpgradeLevels } from "./legacy-scenario-levels";
import type { LegacyProductionSourceRecord } from "./legacy-production";
import { transportHostState } from "./transport-host";

export { productionUpgradeLevels as sourceProductionUpgradeLevels } from "./campaign-production";

export interface SourceProductionBootConfiguration {
  readonly profile: "user-selected-source-campaign-fresh";
  readonly mode: 0;
  readonly localTeam: 0;
  readonly race: 0 | 1;
}

export type SourceProductionOptions = Omit<Parameters<typeof createCampaignProduction>[0], "sessionId"> & {
  readonly sourceProfiles: readonly ProductionSourceProfile[];
};

type Mission = Pick<CampaignMissionData, "faction" | "scenario" | "units">;
type Metadata = FinAnimationData & {
  readonly schemaVersion: number;
  readonly formatTag: number;
  readonly source: { readonly path: string; readonly sha256: string };
};

const ASSETS = {
  dependencies: ["data/dependencies.json", "a5d620693198f650a4bcc265d5908de2a6e31241611d43907c138833420410ec"],
  units: ["data/units.json", "547dc37143a8b889ca6bf963043da6f9afc2fb1b065fb965ef4a28ffd277a794"],
  human: ["animations/HUBU.json", "883cdcf414bc3935d76580ea920aa2792af0f3008260cd8c102c6b671633d47e"],
  alien: ["animations/ALBU.json", "a254a8534cbc212e4692b10ea3bef1ee247d54c36f299fd5009f0a37ff31c46f"],
} as const;

function requireSource(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Source production: ${message}`);
}

function integer(value: number, maximum: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= maximum;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export function producerProfiles(metadata: Metadata, race: 0 | 1): readonly ProductionSourceProfile[] {
  requireSource(race === 0 || race === 1, "invalid producer race");
  const human = race === 0;
  const id = human ? "TRSCBUILD0" : "GRAYBUILDSTAND0";
  const hash = human ? "b27b20282999188e37a74872b70a273b370cc1dd219f2f8fa84f5f2f2ca3a5a4"
    : "99c3d4e4fa0badeb2cd68361a6f1b57dcf9dfbdd027f820a68d806aa18773fa1";
  requireSource(metadata.schemaVersion === 1 && metadata.formatTag === 29
    && metadata.source.path === (human ? "HUBU.FIN" : "ALBU.FIN") && metadata.source.sha256 === hash,
  "unverified producer FIN metadata");
  const states = metadata.states.filter((state) => state.name.startsWith(human ? "TRSCBUILD" : "GRAYBUILDSTAND"));
  const state = states[0];
  requireSource(states.length === 1 && state.name === id && state.validRange === true
    && state.firstTimelineIndex === (human ? 26 : 303) && state.lastTimelineIndex === (human ? 47 : 334),
  "unverified +0x98 directional bank binding");
  const delays = metadata.timeline.slice(state.firstTimelineIndex, state.lastTimelineIndex + 1)
    .map((frame) => finSourceDuration(frame.field2!));
  const expected = human ? Array<number>(22).fill(1) : [2, ...Array<number>(26).fill(1), ...Array<number>(5).fill(2)];
  requireSource(JSON.stringify(delays) === JSON.stringify(expected), "modified producer timeline");
  return [{ unitType: human ? 0 : 8, id, bankField: 152, finSha256: hash,
    directions: Array.from({ length: 32 }, () => [...delays]) }];
}

export function sourceProductionTeamSeeds(source: ScenarioDefinition, units: Mission["units"]): readonly ProductionTeamSeed[] {
  requireSource(source.teams.length === 8 && source.teams.every((team, index) => team.index === index), "require all eight SCN teams");
  const colony = projectLegacyColony(source.teams, units);
  return source.teams.map((team) => {
    requireSource(team.race === 0 || team.race === 1, "invalid SCN race");
    requireSource(Number.isInteger(team.money) && team.money >= -2147483648 && team.money <= 2147483647, "invalid SCN credits");
    requireSource(Array.isArray(team.dependencies) && team.dependencies.every((value) => integer(value, 109)), "missing full SCN restrictions");
    const [baseX, baseY] = team.coordinateRows[1];
    return { team: team.index, race: team.race, credits: team.money, costAccumulator: 0,
      base: { x: baseX, y: baseY },
      slots: colony.slots.filter((slot) => slot.team === team.index && slot.slot < 5)
        .map((slot) => ({ health: slot.health, level: slot.upgradeLevel, busy: 0 as const })),
      restrictions: [...new Set([...team.dependencies, ...(baseX === 0 || baseY === 0 ? [0, 14] : [])])].sort((left, right) => left - right),
      upgrades: units.map((unit) => {
        const levels = sourceScenarioUpgradeLevels(team, unit.index);
        return { unitType: unit.index, weapon: levels.weaponLevel, armor: levels.armorLevel };
      }), producerDelays: [0, 0, 0, 0] };
  });
}

export function sourceProductionPopulation(world: CampaignWorld, team: number): number {
  requireSource(integer(team, 7), "invalid census team");
  const host = transportHostState(world);
  requireSource(host.slots.length === 800 && host.registry.length === 800, "require complete native registry");
  let population = 0;
  for (let slot = 152; slot < 800; slot += 1) {
    const entity = host.slots[slot];
    if (host.registry[slot] === null) continue;
    requireSource(entity && entity.key === host.registry[slot] && entity.slot === slot, "inconsistent census registry");
    if (entity.team === team) population += 1;
  }
  return population;
}

export function sourceProductionPopulationLimit(world: CampaignWorld, ceiling: number): number {
  requireSource(integer(ceiling, 150), "require explicit current game+4 ceiling in 0..150");
  requireSource(world.placementState.renatBytes.length === 1000 && world.placementState.renatSources.length <= 25,
    "require complete native RENAT records");
  const renat = new DataView(world.placementState.renatBytes.buffer,
    world.placementState.renatBytes.byteOffset, world.placementState.renatBytes.byteLength);
  let reserve = 0;
  for (let index = 0; index < world.placementState.renatSources.length; index += 1) {
    const count = renat.getInt32(index * 40 + 16, true);
    requireSource(integer(count, 9), "invalid native RENAT reserve");
    reserve += count;
  }
  const host = transportHostState(world);
  const colonies = Array.from({ length: 8 }, (_, team) => {
    return Array.from({ length: 5 }, (_, slot) => {
      const health = world.buildingSlots[`${team},${slot}`];
      requireSource(Number.isInteger(health), "missing native City health for cap");
      return health !== 0;
    }).some(Boolean);
  });
  let otherUnits = 0;
  requireSource(host.slots.length === 800, "require all native slots for cap");
  for (let slot = 152; slot < 800; slot += 1) {
    const entity = host.slots[slot];
    if (!entity || entity.status === 0) continue;
    requireSource(integer(entity.team, 9), "invalid native cap owner");
    if (entity.team <= 8 && !colonies[entity.team]) otherUnits += 1;
  }
  const colonyCount = colonies.filter(Boolean).length;
  const limit = Math.min(ceiling, Math.trunc((648 - reserve - otherUnits - 100) / Math.max(1, colonyCount)));
  requireSource(limit >= 0, "negative native population cap is outside session admission");
  return limit;
}

export function sourceProductionVisits(world: CampaignWorld, state: CampaignProductionState,
  currentCeiling: number): readonly ProductionProducerVisit[] {
  requireSource(world.sessionId === state.sessionId, "production/world session mismatch");
  const populationLimit = sourceProductionPopulationLimit(world, currentCeiling);
  return [...state.teams].sort((left, right) => left.team - right.team).flatMap(team => {
    const adaptedCollector = state.adaptedCollectorProfiles?.some(profile => profile.unitType === 6 + team.race * 8);
    const adaptedUnits = ADAPTED_UNIT_PRODUCTION_SOURCES.filter(source => source.race === team.race
      && state.adaptedUnitProfiles?.some(profile => profile.unitType === source.unitType));
    const admitted = new Set<ProductionProducerVisit["queue"]>([0, ...(adaptedCollector ? [2 as const] : []), ...adaptedUnits.map(source => source.queue)]);
    const queues = adaptedCollector || adaptedUnits.length ? [...admitted].sort().filter(queue => {
      const slot = team.slots[productionProducerSlot(queue)];
      return slot.health > 0 && slot.busy === 0;
    }) : [0 as const];
    return queues.map(queue => ({ team: team.team, queue,
      population: sourceProductionPopulation(world, team.team), populationLimit }));
  });
}

export function sourceProductionUi(state: CampaignProductionState, localTeam: number) {
  const team = state.teams.find((entry) => entry.team === localTeam);
  requireSource(team, "local team does not own admitted production");
  return productionChoices(state, localTeam).filter((choice) => choice.supported).map((choice) => {
    const entry = state.catalog.find((candidate) => candidate.id === choice.dependency)!;
    return { ...choice, cost: entry.cost, unitType: entry.unitType, credits: team.credits,
      costAccumulator: team.costAccumulator, producerNativeSlot: localTeam * 15
        + (entry.kind === "unit" ? productionProducerSlot(state.units.find(unit => unit.unitType === entry.unitType)!.queue) : 1) };
  });
}

export async function loadSourceProductionOptions(input: {
  readonly sessionId: string;
  readonly mission: Mission;
  readonly rawScenario: Uint8Array;
  readonly configuration: SourceProductionBootConfiguration;
  readonly adaptedCollectors?: { readonly runtimeProfile: "browser-adapted"; readonly completionVisits: number };
  readonly adaptedUnits?: { readonly runtimeProfile: "browser-adapted"; readonly completionVisits: number };
  readonly adaptedUpgrades?: AdaptedProductionUpgrades;
  readonly deferEmptyCentralBase?: boolean;
  readonly loadBytes?: (url: string) => Promise<Uint8Array>;
}) {
  const { mission, configuration } = input;
  if (input.adaptedUpgrades !== undefined) requireSource(input.adaptedUpgrades?.runtimeProfile === "browser-adapted",
    "adapted upgrades require explicit browser-adapted profile");
  if (input.adaptedCollectors) requireSource(input.adaptedCollectors.runtimeProfile === "browser-adapted"
    && integer(input.adaptedCollectors.completionVisits, 65535) && input.adaptedCollectors.completionVisits > 0,
  "adapted collectors require explicit browser-adapted profile and completionVisits in 1..65535");
  if (input.adaptedUnits) requireSource(input.adaptedUnits.runtimeProfile === "browser-adapted"
    && integer(input.adaptedUnits.completionVisits, 65535) && input.adaptedUnits.completionVisits > 0,
  "adapted units require explicit browser-adapted profile and completionVisits in 1..65535");
  requireSource(configuration?.profile === "user-selected-source-campaign-fresh" && configuration.mode === 0
    && configuration.localTeam === 0 && configuration.race === (mission.faction === "human" ? 0 : 1),
  "explicit user-selected source campaign configuration required");
  requireSource(await sha256(input.rawScenario) === mission.scenario.source.sha256, "raw SCN hash mismatch");
  const source = parseScenario(new TextDecoder("ascii").decode(input.rawScenario));
  for (const field of ["id", "title", "terrainBank", "rawHeader", "placementRows"] as const) {
    requireSource(JSON.stringify(source[field]) === JSON.stringify(mission.scenario[field]), `mission ${field} differs from full SCN`);
  }
  requireSource(mission.scenario.teams.length === 8, "mission needs eight SCN teams");
  for (const team of source.teams) {
    const loaded = mission.scenario.teams[team.index];
    for (const field of ["index", "enabled", "race", "money", "ai", "teamColor", "coordinateRows", "cityRows", "allies"] as const) {
      requireSource(JSON.stringify(team[field]) === JSON.stringify(loaded[field]), `mission team ${team.index} ${field} differs from full SCN`);
    }
  }
  requireSource(source.teams[0].race === configuration.race, "player race differs from source configuration");
  const loadBytes = input.loadBytes ?? (async (url: string) => {
    const response = await fetch(url);
    requireSource(response.ok, `cannot load ${url}: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  });
  async function asset<Value>(key: keyof typeof ASSETS): Promise<Value> {
    const [path, hash] = ASSETS[key];
    const bytes = await loadBytes(assetUrl(`/assets/generated/${path}`));
    requireSource(await sha256(bytes) === hash, `generated ${path} hash mismatch`);
    return JSON.parse(new TextDecoder().decode(bytes)) as Value;
  }
  const [dependencies, unitData, metadata] = await Promise.all([
    asset<{ records: readonly LegacyProductionSourceRecord[] }>("dependencies"),
    asset<{ records: Mission["units"] }>("units"), asset<Metadata>(mission.faction),
  ]);
  requireSource(mission.units.length === unitData.records.length && mission.units.every((unit, index) => {
    const original = unitData.records[index];
    return unit.index === original.index && unit.sprite === original.sprite && unit.health === original.health
      && JSON.stringify(unit.rawTail) === JSON.stringify(original.rawTail);
  }), "mission GAMESTAT differs from verified source");
  const seeds = sourceProductionTeamSeeds(source, unitData.records);
  const player = seeds[configuration.localTeam];
  const profiles = producerProfiles(metadata, configuration.race);
  const units: ProductionUnitSource[] = dependencies.records.filter((record) => record.rawFields[0] === 1).map((record) => {
    const unitType = record.rawFields[1];
    const raw = unitData.records[unitType].rawTail!;
    const queue = raw[10];
    const exitSelector = raw[12];
    requireSource(integer(queue, 3) && integer(exitSelector, 1), "invalid source queue selectors");
    const offsets = [[[0, -3], [0, -3]], [[2, 3], [-5, -1]], [[-4, 0], [-5, -1]], [[-4, 3], [-4, 3]]];
    const [x, y] = offsets[queue][exitSelector];
    return { unitType, queue: queue as ProductionUnitSource["queue"],
      exitSelector: exitSelector as ProductionUnitSource["exitSelector"], exitOffset: { x, y } };
  });
  const common = { source, configuration: { ...configuration }, initialPopulationCeiling: 150 as const,
    missionAdmission: "not-evaluated" as const };
  const adaptedUnitProfiles = input.adaptedUnits ? ADAPTED_UNIT_PRODUCTION_SOURCES.filter(source => source.race === configuration.race)
    .map(source => ({ ...input.adaptedUnits!, unitType: source.unitType })) : undefined;
  if (!input.deferEmptyCentralBase && player.slots[1].health === 0 && (!input.adaptedCollectors || player.slots[0].health === 0)
    && !adaptedUnitProfiles?.some(profile => player.slots[productionProducerSlot(units.find(unit => unit.unitType === profile.unitType)!.queue)].health > 0)) {
    return { ...common, status: "no-owned-factory" as const, production: undefined, state: undefined, choices: [] };
  }
  const production: SourceProductionOptions = { records: dependencies.records, units, sourceProfiles: profiles, teams: [player],
    ...(input.adaptedUpgrades !== undefined ? { adaptedUpgrades: { runtimeProfile: "browser-adapted" as const } } : {}),
    ...(adaptedUnitProfiles ? { adaptedUnitProfiles } : {}),
    ...(input.adaptedCollectors ? { adaptedCollectorProfiles: [{ ...input.adaptedCollectors,
      unitType: configuration.race === 0 ? 6 as const : 14 as const }] } : {}) };
  const state = createCampaignProduction({ ...production, sessionId: input.sessionId });
  return { ...common, status: "available" as const, production, state,
    choices: sourceProductionUi(state, configuration.localTeam) };
}
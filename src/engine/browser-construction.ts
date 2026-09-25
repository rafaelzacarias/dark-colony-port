import { assetUrl } from "../asset-url";
import { sha256Hex as digest } from "../sha256";
import type { CampaignMissionData } from "../game-data";
import { parseScenario, type ScenarioDefinition } from "../../tools/extractors/data/scenario";
import type { CampaignWorld } from "./campaign-world";
import { projectLegacyColony, type LegacyColonyBuilding } from "./legacy-colony";
import { createLegacyProductionCatalog, type LegacyProductionSourceRecord } from "./legacy-production";
import { createLegacyInfantryFamilyMask } from "./legacy-navigation";
import { readTransportHostState, transportHostState } from "./transport-host";
import { sourceBuildingOptions, sourceBuildingRequirements, type SourceBuildingOption } from "./source-building-options";

export interface BrowserConstructionPolicy {
  readonly completionVisits: number;
  readonly supportedSlots?: readonly number[];
  readonly supportedActions?: readonly ("purchase" | "upgrade")[];
}

export interface BrowserConstructionConfiguration {
  readonly kind: "browser-construction-source-v1";
  readonly runtimeProfile: "browser-adapted";
  readonly sourceId: string;
  readonly team: 0;
  readonly race: 0 | 1;
  readonly dependency: number;
  readonly configurationVersion?: 2;
  readonly supportedSlots?: readonly number[];
  readonly supportedActions?: readonly ("purchase" | "upgrade")[];
  readonly buildings?: readonly SourceBuildingOption[];
  readonly cost: number;
  readonly home: { readonly x: number; readonly y: number };
  readonly building: LegacyColonyBuilding;
  readonly policy: {
    readonly timing: "adapted-not-native";
    readonly completionVisits: number;
    readonly placement: "original-scn-home-only";
    readonly health: "source-max-at-receipt";
    readonly upgradeHealth?: "adapted-preserve-hp-capped-new-max";
  };
}

export interface BrowserConstructionState {
  readonly kind: "browser-construction-state-v1";
  readonly sourceId: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly receiptId: string | null;
  readonly phase: "empty" | "building" | "ready";
  readonly elapsedVisits: number;
  readonly paid: number;
  readonly costAccumulator: number;
  readonly slots?: Readonly<Record<number, BrowserConstructionState>>;
  readonly upgrades?: Readonly<Record<number, BrowserBuildingUpgradeState>>;
}

export interface BrowserBuildingUpgradeState {
  readonly receiptId: string;
  readonly dependency: number;
  readonly key: string;
  readonly generation: 0;
  readonly fromLevel: 0;
  readonly level: 1;
  readonly phase: "building" | "ready" | "destroyed";
  readonly elapsedVisits: number;
  readonly paid: number;
  readonly health: number;
}

export type BrowserConstructionRequest =
  | { readonly type: "purchase"; readonly sequence: number; readonly id: string;
      readonly dependency: number; readonly home: { readonly x: number; readonly y: number } }
  | { readonly type: "upgrade"; readonly sequence: number; readonly id: string;
      readonly dependency: number; readonly home: { readonly x: number; readonly y: number } }
  | { readonly type: "visit"; readonly sequence: number };

export interface BrowserConstructionTransition {
  readonly state: BrowserConstructionState;
  readonly world: CampaignWorld;
  readonly effects: readonly {
    readonly type: "construction-started" | "construction-ready";
    readonly slot: number;
    readonly generation: 0;
    readonly key: string;
    readonly receiptId: string;
    readonly dependency: number;
    readonly busy: 0 | 1;
    readonly action?: "upgrade";
    readonly level?: number;
    readonly unitType?: number;
    readonly maxHealth?: number;
    readonly health?: number;
  }[];
}

interface Source {
  readonly scenario: ScenarioDefinition;
  readonly width: number;
  readonly height: number;
  readonly eligible: readonly boolean[];
  readonly units: CampaignMissionData["units"];
  readonly records: readonly LegacyProductionSourceRecord[];
  readonly pathGrid: Uint8Array;
  readonly tags: Uint8Array;
}

const sources = new WeakMap<BrowserConstructionConfiguration, Source>();
const slotConfigurations = new WeakMap<BrowserConstructionConfiguration, ReadonlyMap<number, BrowserConstructionConfiguration>>();
const SCENARIO_HASH = "8055810eaa2db00c6f07b64e806540f054514dfb616afad886d89f71ed8c00b7";
const UNIT_HASH = "547dc37143a8b889ca6bf963043da6f9afc2fb1b065fb965ef4a28ffd277a794";
const DEPEND_HASH = "a5d620693198f650a4bcc265d5908de2a6e31241611d43907c138833420410ec";
const PATH_HASH = "b62ebdb40004f49691636f8e97aca17bc226cb55da05c81ca55dc936228648e9";
const TAG_HASH = "90b446c6472fde83a94e15bcef5e4b2ea20522db2c242448f6a825bb2a3f42b1";

function requireConstruction(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(`Browser construction: ${message}`);
}

function integer(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 0x7fffffff;
}

function freeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export async function createBrowserConstructionConfiguration(input: {
  readonly runtimeProfile: "browser-adapted";
  readonly mission: CampaignMissionData;
  readonly completionVisits: number;
  readonly supportedSlots?: readonly number[];
  readonly supportedActions?: readonly ("purchase" | "upgrade")[];
  readonly loadBytes?: (url: string) => Promise<Uint8Array>;
}): Promise<BrowserConstructionConfiguration> {
  const { mission, completionVisits, runtimeProfile } = structuredClone({ ...input, loadBytes: undefined });
  requireConstruction(runtimeProfile === "browser-adapted" && integer(completionVisits)
    && completionVisits > 0 && completionVisits <= 65535, "explicit adapted duration policy required");
  const supportedSlots = input.supportedSlots === undefined ? undefined : [...input.supportedSlots];
  const supportedActions = input.supportedActions === undefined ? undefined : [...input.supportedActions];
  requireConstruction(!supportedActions || supportedSlots && supportedActions.length > 0
    && supportedActions.every((action, index) => ["purchase", "upgrade"].includes(action)
      && (index === 0 || action > supportedActions[index - 1])), "actions require fixed slots and sorted unique purchase/upgrade capabilities");
  requireConstruction(!supportedSlots || completionVisits === 120 && supportedSlots.length > 0
    && supportedSlots.every((slot, index) => integer(slot) && slot <= 4 && (index === 0 || slot > supportedSlots[index - 1])),
  "fixed slots require sorted unique slots 0..4 and explicit 120 adapted visits");
  requireConstruction(mission.scenario.rawScenario && (supportedSlots || mission.faction === "alien"
    && mission.map.width === 128 && mission.map.height === 112), "only original ALIEN10 is admitted without fixed-slot capabilities");
  const raw = Uint8Array.from(atob(mission.scenario.rawScenario), character => character.charCodeAt(0));
  const load = input.loadBytes ?? (async (url: string) => {
    const response = await fetch(url);
    requireConstruction(response.ok, `cannot load ${url}`);
    return new Uint8Array(await response.arrayBuffer());
  });
  const [unitsBytes, dependencyBytes] = await Promise.all([
    load(assetUrl("/assets/generated/data/units.json")).then(bytes => Uint8Array.from(bytes)),
    load(assetUrl("/assets/generated/data/dependencies.json")).then(bytes => Uint8Array.from(bytes)),
  ]);
  const hashes = await Promise.all([raw, unitsBytes, dependencyBytes, mission.pathGrid, mission.tags].map(digest));
  if (!supportedSlots) requireConstruction(JSON.stringify(hashes) === JSON.stringify([SCENARIO_HASH, UNIT_HASH, DEPEND_HASH, PATH_HASH, TAG_HASH]),
    "source hash mismatch");
  else {
    const stem = mission.scenario.source.path.replace(/\.SCN$/i, "");
    requireConstruction(new RegExp(`^${mission.faction.toUpperCase()}/${mission.faction.toUpperCase()}\\d{2}$`).test(stem), "invalid source mission path");
    const [scenarioBytes, mapBytes] = await Promise.all([
      load(assetUrl(`/assets/generated/data/scenarios/${stem}.json`)), load(assetUrl(`/assets/generated/maps/${stem}.json`)),
    ]);
    const originalScenario = JSON.parse(new TextDecoder().decode(scenarioBytes));
    const originalMap = JSON.parse(new TextDecoder().decode(mapBytes));
    requireConstruction(JSON.stringify(originalScenario) === JSON.stringify(mission.scenario)
      && hashes[0] === originalScenario.source.sha256 && hashes[1] === UNIT_HASH && hashes[2] === DEPEND_HASH
      && JSON.stringify(originalMap) === JSON.stringify(mission.map), "source hash or metadata mismatch");
    const directory = stem.split("/")[0];
    const [path, tags] = await Promise.all(["pathGrid", "tags"].map(field =>
      load(assetUrl(`/assets/generated/maps/${directory}/${originalMap.files[field]}`))));
    requireConstruction(await digest(path) === hashes[3] && await digest(tags) === hashes[4], "source terrain hash mismatch");
  }
  const scenario = parseScenario(new TextDecoder().decode(raw));
  for (const field of ["id", "title", "terrainBank", "rawHeader", "teams", "placementRows"] as const) {
    requireConstruction(JSON.stringify(mission.scenario[field]) === JSON.stringify(scenario[field]), `modified SCN ${field}`);
  }
  const units: CampaignMissionData["units"] = JSON.parse(new TextDecoder().decode(unitsBytes)).records;
  requireConstruction(JSON.stringify(units) === JSON.stringify(mission.units), "modified GAMESTAT");
  const records: LegacyProductionSourceRecord[] = JSON.parse(new TextDecoder().decode(dependencyBytes)).records;
  const entry = createLegacyProductionCatalog(records).get(14)!;
  requireConstruction(entry.kind === "building" && entry.cost === 2000 && entry.dependencies.length === 0
    && JSON.stringify(entry.rawFields) === "[0,0,0,1]", "unproven central-base dependency");
  const team = scenario.teams[0];
  requireConstruction(team.race === (mission.faction === "human" ? 0 : 1) && team.enabled === 1
    && (supportedSlots || !team.dependencies.includes(14)), "source player/race restrictions");
  const original = projectLegacyColony(scenario.teams, units);
  if (!supportedSlots) requireConstruction(original.slots.filter(slot => slot.team === 0 && slot.slot < 5).every(slot => !slot.entity), "requires empty player city");
  const projectedTeam = { ...team, cityRows: team.cityRows.map((row, index) => index === 0 ? [1, -1, ...row.slice(2)] : row) };
  const building = projectLegacyColony([projectedTeam], units).buildings.find(candidate => candidate.slot === 0)!;
  requireConstruction(building.unitType === (team.race === 0 ? 16 : 28) && building.health === building.maxHealth && building.health === 4800,
    "source slot-0 health mismatch");
  const configuration: BrowserConstructionConfiguration = freeze({
    kind: "browser-construction-source-v1", runtimeProfile,
    sourceId: supportedSlots ? `${hashes.join(":")}:fixed-slots-v2:${supportedSlots.join(",")}:${completionVisits}${supportedActions ? `:actions:${supportedActions.join(",")}:preserve-hp-v1` : ""}` : `${SCENARIO_HASH}:central0:${completionVisits}`,
    team: 0, race: team.race as 0 | 1, dependency: team.race === 0 ? 0 : 14, cost: entry.cost,
    ...(supportedSlots ? { configurationVersion: 2 as const, supportedSlots, buildings: sourceBuildingOptions({ scenario: mission.scenario, units }, records) } : {}),
    ...(supportedActions ? { supportedActions } : {}),
    home: { x: team.coordinateRows[1][0], y: team.coordinateRows[1][1] }, building,
    policy: { timing: "adapted-not-native", completionVisits, placement: "original-scn-home-only", health: "source-max-at-receipt",
      ...(supportedActions?.includes("upgrade") ? { upgradeHealth: "adapted-preserve-hp-capped-new-max" as const } : {}) },
  });
  sources.set(configuration, { scenario: freeze(scenario), width: mission.map.width, height: mission.map.height,
    units: freeze(units), records: freeze(records), pathGrid: Uint8Array.from(mission.pathGrid), tags: Uint8Array.from(mission.tags),
    eligible: freeze(Array.from(createLegacyInfantryFamilyMask({ ...mission.map, pathGrid: mission.pathGrid }), Boolean)) });
  if (supportedSlots) slotConfigurations.set(configuration, new Map(configuration.buildings!.filter(option =>
    option.level === 0 && supportedSlots.includes(option.building.slot)).map(option => {
    const child: BrowserConstructionConfiguration = freeze({ kind: configuration.kind, runtimeProfile,
      sourceId: `${configuration.sourceId}:slot${option.building.slot}`, team: 0, race: configuration.race,
      dependency: option.dependency, cost: option.cost, building: option.building, home: configuration.home, policy: configuration.policy });
    sources.set(child, sources.get(configuration)!);
    return [option.building.slot, child];
  })));
  return configuration;
}

function sourceOf(configuration: BrowserConstructionConfiguration): Source {
  const source = sources.get(configuration);
  requireConstruction(source && configuration.runtimeProfile === "browser-adapted", "authenticated adapted configuration required");
  return source;
}

export function validateBrowserConstructionSessionSource(configuration: BrowserConstructionConfiguration, input: {
  readonly units: CampaignMissionData["units"];
  readonly pathGrid: Uint8Array;
  readonly tags: Uint8Array;
  readonly fixedStepMilliseconds: number;
  readonly production?: { readonly records: readonly LegacyProductionSourceRecord[] };
}): void {
  const source = sourceOf(configuration);
  requireConstruction(input.fixedStepMilliseconds === 50 && JSON.stringify(input.units) === JSON.stringify(source.units)
    && input.pathGrid.length === source.pathGrid.length && input.pathGrid.every((value, index) => value === source.pathGrid[index])
    && input.tags.length === source.tags.length && input.tags.every((value, index) => value === source.tags[index])
    && (!input.production || JSON.stringify(input.production.records) === JSON.stringify(source.records)),
  "session differs from authenticated source or adapted 50ms cadence");
}

function actorKey(state: BrowserConstructionState, slot = 0): string {
  return `browser-construction:${slot}:0:${state.receiptId}`;
}

function rawBuilding(configuration: BrowserConstructionConfiguration): Uint8Array {
  const bytes = new Uint8Array(220), view = new DataView(bytes.buffer);
  view.setUint16(0, configuration.building.nativePosition.x, true);
  view.setUint16(4, configuration.building.nativePosition.y, true);
  bytes[6] = configuration.building.unitType;
  bytes[7] = configuration.team;
  view.setInt32(12, configuration.building.maxHealth, true);
  bytes[0x2c] = 1;
  bytes[0x38] = 255;
  view.setInt16(0xd2, -2, true);
  view.setInt16(0xd4, -2, true);
  return bytes;
}

export function validateBrowserConstruction(configuration: BrowserConstructionConfiguration,
  state: BrowserConstructionState, world: CampaignWorld, journaledCombat = false, checkEmptyFootprint = true): void {
  if (configuration.configurationVersion === 2) {
    validateFixedSlots(configuration, state, world, journaledCombat);
    return;
  }
  const source = sourceOf(configuration), host = readTransportHostState(world);
  const slot = configuration.building.slot;
  requireConstruction(!state.slots && !state.upgrades, "unexpected nested slot state");
  requireConstruction(state.kind === "browser-construction-state-v1" && state.sourceId === configuration.sourceId
    && state.sessionId === world.sessionId && world.sessionId.length > 0, "state/source/session mismatch");
  for (const field of ["id", "teams", "placementRows"] as const) requireConstruction(
    JSON.stringify(world.source[field]) === JSON.stringify(source.scenario[field]), `world source ${field} mismatch`);
  requireConstruction(world.browserCasualtyPickup?.runtimeProfile === "browser-adapted"
    && !host.nativeAiTasks && !host.nativeCombat && !host.resourceLifecycle
    && !host.slots.some(actor => actor?.nativeConstruction || actor?.nativeAiTask || actor?.pendingNativeAi || actor?.resourceTask),
  "native or unowned world cannot admit adapted construction");
  requireConstruction(host.width === source.width && host.height === source.height
    && world.entityBytes?.length === 800 * 220 && host.slots.length === 800 && host.generations.length === 800
    && host.registry.length === 800 && host.ground.length === source.width * source.height
    && host.groundEligible.length === host.ground.length && host.resourceTileFlags.length === host.ground.length,
  "incomplete host/map");
  requireConstruction(integer(world.exomoney[0]), "current player credits must be owned by world.exomoney");
  const empty = state.phase === "empty";
  requireConstruction(integer(state.sequence) && integer(state.elapsedVisits) && state.elapsedVisits <= configuration.policy.completionVisits
    && state.paid === (empty ? 0 : configuration.cost) && state.costAccumulator === state.paid,
  "invalid progress/accounting");
  requireConstruction(empty ? state.sequence === 0 && state.elapsedVisits === 0 && state.receiptId === null
    : typeof state.receiptId === "string" && state.receiptId.length > 0 && state.receiptId.length <= 128
      && state.sequence === state.elapsedVisits + 1
      && state.phase === (state.elapsedVisits === configuration.policy.completionVisits ? "ready" : "building"),
  "invalid construction phase/receipt");
  const actor = host.slots[slot], entities = world.entities.filter(entity => entity.rawSlot === slot);
  if (empty) {
    requireConstruction(!actor && entities.length === 0 && host.generations[slot] === -1 && host.registry[slot] === null
      && world.buildingSlots[`0,${slot}`] === 0 && world.entityBytes.slice(slot * 220, (slot + 1) * 220).every(value => value === 0), "fixed slot occupied");
  } else {
    const building = configuration.building, key = actorKey(state, slot), entity = entities[0];
    const health = journaledCombat ? actor?.health : building.maxHealth;
    const status = health === 0 ? 10 : 1;
    const expectedRaw = rawBuilding(configuration);
    if (journaledCombat && health !== undefined) {
      requireConstruction(integer(health) && health <= building.maxHealth, "invalid combat health");
      new DataView(expectedRaw.buffer).setInt32(12, health, true);
      expectedRaw[0x2c] = status;
    }
    requireConstruction(entities.length === 1 && actor && actor.key === key && entity.key === key
      && actor.slot === slot && actor.generation === 0 && entity.generation === 0 && host.generations[slot] === 0
      && host.registry[slot] === key && actor.team === 0 && entity.team === 0 && actor.unitType === building.unitType
      && entity.unitType === building.unitType && actor.status === status && actor.health === health
      && entity.health === health && entity.maxHealth === building.maxHealth
      && actor.position.x === building.nativePosition.x && actor.position.y === building.nativePosition.y
      && actor.height === 0 && actor.task === (health === 0 ? "death" : "unit") && actor.taskWords.length === 0
      && entity.tileX === Math.floor(building.position.x) && entity.tileY === Math.floor(building.position.y)
      && entity.sourceRow === null && entity.rawTail.length === 0 && !entity.resource
      && world.buildingSlots[`0,${slot}`] === health
      && expectedRaw.every((value, index) => world.entityBytes![slot * 220 + index] === value),
    "construction identity/HP/raw mutation requires an integration owner");
  }
  if (empty && !checkEmptyFootprint) return;
  for (const cell of configuration.building.footprint) {
    requireConstruction(cell.x >= 0 && cell.y >= 0 && cell.x < host.width && cell.y < host.height, "footprint outside map");
    const index = cell.y * host.width + cell.x;
    requireConstruction(host.groundEligible[index] === (empty ? source.eligible[index] : false)
      && host.ground[index] === (empty || journaledCombat && actor?.health === 0 ? -1 : slot) && host.resourceTileFlags[index] === 0
      && !(host.productionExits ?? []).some(exit => exit.tile.x === cell.x && exit.tile.y === cell.y), "occupied/reserved home footprint");
    requireConstruction(!world.entities.some(entity => entity.rawSlot !== slot && entity.health > 0
      && entity.tileX === cell.x && entity.tileY === cell.y
      && (entity.resource || entity.rawSlot === null || !host.definitions.some(definition =>
        definition.unitType === entity.unitType && definition.plane === "flying" && definition.movementSpeed > 0))), "source entity occupies home footprint");
    requireConstruction(!host.slots.some(record => record && record.slot !== slot && record.health > 0
      && record.status !== 0 && record.status !== 10 && record.position.x >>> 8 === cell.x && record.position.y >>> 8 === cell.y
      && !host.definitions.some(definition => definition.unitType === record.unitType && definition.plane === "flying"
        && definition.movementSpeed > 0)),
    "host entity occupies home footprint");
  }
}

export function createBrowserConstruction(configuration: BrowserConstructionConfiguration, world: CampaignWorld): BrowserConstructionState {
  if (configuration.configurationVersion === 2) {
    const slots = Object.fromEntries(emptySourceSlots(configuration).map(slot => {
      const child = slotConfigurations.get(configuration)!.get(slot)!;
      return [slot, { kind: "browser-construction-state-v1" as const, sourceId: child.sourceId,
        sessionId: world.sessionId, sequence: 0, receiptId: null, phase: "empty" as const, elapsedVisits: 0, paid: 0, costAccumulator: 0 }];
    }));
    const state = aggregateSlots(configuration, world.sessionId, 0, slots,
      configuration.supportedActions?.includes("upgrade") ? {} : undefined);
    validateFixedSlots(configuration, state, world, false);
    return freeze(state);
  }
  const state: BrowserConstructionState = { kind: "browser-construction-state-v1", sourceId: configuration.sourceId,
    sessionId: world.sessionId, sequence: 0, receiptId: null, phase: "empty", elapsedVisits: 0, paid: 0, costAccumulator: 0 };
  validateBrowserConstruction(configuration, state, world);
  return freeze(state);
}

export function restoreBrowserConstruction(configuration: BrowserConstructionConfiguration,
  checkpoint: BrowserConstructionState, world: CampaignWorld): BrowserConstructionState {
  const state = structuredClone(checkpoint);
  requireConstruction(Object.keys(state).sort().join() === (configuration.configurationVersion === 2
    ? `costAccumulator,elapsedVisits,kind,paid,phase,receiptId,sequence,sessionId,slots,sourceId${configuration.supportedActions?.includes("upgrade") ? ",upgrades" : ""}`
    : "costAccumulator,elapsedVisits,kind,paid,phase,receiptId,sequence,sessionId,sourceId"),
    "checkpoint schema mismatch");
  validateBrowserConstruction(configuration, state, world, configuration.supportedActions?.includes("upgrade") === true);
  return freeze(state);
}

export function reduceBrowserConstruction(configuration: BrowserConstructionConfiguration,
  previous: BrowserConstructionState, world: CampaignWorld, request: BrowserConstructionRequest,
  journaledCombat = false): BrowserConstructionTransition {
  if (configuration.configurationVersion === 2) return reduceFixedSlots(configuration, previous, world, request, journaledCombat);
  validateBrowserConstruction(configuration, previous, world, journaledCombat);
  const slot = configuration.building.slot;
  requireConstruction(integer(request.sequence) && request.sequence === previous.sequence + 1, "duplicate/stale sequence");
  if (request.type === "visit") {
    requireConstruction(previous.phase === "building", "no active construction visit");
    const elapsedVisits = previous.elapsedVisits + 1;
    const state: BrowserConstructionState = freeze({ ...previous, sequence: request.sequence, elapsedVisits,
      phase: elapsedVisits === configuration.policy.completionVisits ? "ready" : "building" });
    validateBrowserConstruction(configuration, state, world, journaledCombat);
    return { state, world, effects: state.phase === "ready" ? [{ type: "construction-ready", slot, generation: 0,
      key: actorKey(state, slot), receiptId: state.receiptId!, dependency: configuration.dependency, busy: 0 }] : [] };
  }
  requireConstruction(request.type === "purchase" && previous.phase === "empty", "duplicate/unsupported purchase");
  requireConstruction(typeof request.id === "string" && request.id.length > 0 && request.id.length <= 128
    && request.dependency === configuration.dependency && request.home.x === configuration.home.x
    && request.home.y === configuration.home.y, "invalid dependency or placement; original home only");
  const restrictions = world.adaptedTro?.dependencyRestrictions[0] ?? sourceOf(configuration).scenario.teams[0].dependencies;
  requireConstruction(!restrictions.includes(configuration.dependency), "source dependency restricted");
  requireConstruction(world.exomoney[0] >= configuration.cost, "insufficient credits");
  const state: BrowserConstructionState = freeze({ ...previous, sequence: request.sequence, receiptId: request.id,
    phase: "building", paid: configuration.cost, costAccumulator: configuration.cost });
  const host = transportHostState(world), bytes = Uint8Array.from(world.entityBytes!);
  const building = configuration.building, key = actorKey(state, slot), position = { ...building.nativePosition };
  host.slots[slot] = { slot, generation: 0, key, team: 0, unitType: building.unitType, status: 1,
    health: building.maxHealth, position, height: 0, task: "unit", taskWords: [] };
  host.generations[slot] = 0;
  host.registry[slot] = key;
  host.requests.push({ type: "create", slot, generation: 0, team: 0, unitType: building.unitType, position });
  for (const cell of building.footprint) {
    const index = cell.y * host.width + cell.x;
    host.ground[index] = slot;
    host.groundEligible[index] = false;
  }
  bytes.set(rawBuilding(configuration), slot * 220);
  const candidate: CampaignWorld = { ...world, transportState: host, entityBytes: bytes,
    exomoney: { ...world.exomoney, 0: world.exomoney[0] - configuration.cost },
    buildingSlots: { ...world.buildingSlots, [`0,${slot}`]: building.maxHealth },
    entities: [...world.entities, { key, generation: 0, sourceRow: null, team: 0, unitType: building.unitType,
      tileX: Math.floor(building.position.x), tileY: Math.floor(building.position.y), rawTail: [],
      health: building.maxHealth, maxHealth: building.maxHealth, rawSlot: slot, simulationId: null }] };
  validateBrowserConstruction(configuration, state, candidate);
  return { state, world: candidate, effects: [{ type: "construction-started", slot, generation: 0,
    key, receiptId: request.id, dependency: configuration.dependency, busy: 1 }] };
}

function emptySourceSlots(configuration: BrowserConstructionConfiguration): readonly number[] {
  const source = sourceOf(configuration);
  const colony = projectLegacyColony(source.scenario.teams, source.units);
  return configuration.supportedSlots!.filter(slot => {
    const original = colony.slots.find(candidate => candidate.team === 0 && candidate.slot === slot)!;
    return original.sourceLevel === 0 && !original.entity;
  });
}

function aggregateSlots(configuration: BrowserConstructionConfiguration, sessionId: string, sequence: number,
  slots: Readonly<Record<number, BrowserConstructionState>>,
  upgrades?: Readonly<Record<number, BrowserBuildingUpgradeState>>): BrowserConstructionState {
  const states = [...Object.values(slots), ...Object.values(upgrades ?? {})], paid = states.reduce((sum, state) => sum + state.paid, 0);
  return { kind: "browser-construction-state-v1", sourceId: configuration.sourceId, sessionId, sequence, receiptId: null,
    phase: states.some(state => state.phase === "building") ? "building" : states.some(state => state.phase === "ready" || state.phase === "destroyed") ? "ready" : "empty",
    elapsedVisits: states.reduce((sum, state) => sum + state.elapsedVisits, 0), paid, costAccumulator: paid, slots,
    ...(upgrades ? { upgrades } : {}) };
}

function fixedSlotConfiguration(configuration: BrowserConstructionConfiguration, state: BrowserConstructionState,
  slot: number): BrowserConstructionConfiguration {
  const child = slotConfigurations.get(configuration)!.get(slot)!;
  if (state.upgrades?.[slot]?.phase !== "ready") return child;
  const building = configuration.buildings!.find(option => option.level === 1 && option.building.slot === slot)!.building;
  const upgraded = freeze({ ...child, building });
  sources.set(upgraded, sourceOf(configuration));
  return upgraded;
}

function validateUpgradeActor(configuration: BrowserConstructionConfiguration, state: BrowserConstructionState,
  world: CampaignWorld, slot: number, journaledCombat: boolean): void {
  const source = sourceOf(configuration), host = transportHostState(world), upgrade = state.upgrades?.[slot];
  const options = configuration.buildings!;
  const base = options.find(option => option.level === 0 && option.building.slot === slot)!;
  const target = options.find(option => option.level === 1 && option.building.slot === slot)!;
  requireConstruction(base && target && JSON.stringify(base.building.nativePosition) === JSON.stringify(target.building.nativePosition)
    && JSON.stringify(base.building.footprint) === JSON.stringify(target.building.footprint), "unproven upgrade geometry");
  const original = projectLegacyColony(source.scenario.teams, source.units).slots.find(candidate => candidate.team === 0 && candidate.slot === slot)!;
  const receipt = state.slots?.[slot];
  requireConstruction(receipt ? receipt.phase === "ready" : original.sourceLevel === 1 && original.entity,
    "upgrade requires existing ready level0 source building");
  const building = upgrade?.phase === "ready" ? target.building : base.building;
  const key = receipt ? actorKey(receipt, slot) : `colony:${slot}`;
  const actor = host.slots[slot], entities = world.entities.filter(entity => entity.rawSlot === slot), entity = entities[0];
  requireConstruction(actor && entities.length === 1 && entity && world.entityBytes?.length === 800 * 220,
    "missing/duplicate upgrade actor");
  const health = actor.health, status = health === 0 ? 10 : 1;
  requireConstruction(integer(health) && health <= building.maxHealth && (!upgrade ? health > 0
    : integer(upgrade.health) && upgrade.health <= base.building.maxHealth && upgrade.key === key
      && (journaledCombat ? health <= upgrade.health : health === upgrade.health)), "upgrade cannot heal or change actor health");
  const bytes = new DataView(world.entityBytes.buffer, world.entityBytes.byteOffset, world.entityBytes.byteLength);
  requireConstruction(actor.slot === slot && actor.key === key && entity.key === key && actor.generation === 0
    && entity.generation === 0 && host.generations[slot] === 0 && (host.registry[slot] === key || health === 0 && host.registry[slot] === null)
    && actor.team === 0 && entity.team === 0 && actor.unitType === building.unitType && entity.unitType === building.unitType
    && entity.maxHealth === building.maxHealth && entity.health === health && world.buildingSlots[`0,${slot}`] === health
    && actor.status === status && actor.position.x === building.nativePosition.x && actor.position.y === building.nativePosition.y
    && actor.height === 0 && actor.task === (health === 0 ? "death" : "unit") && actor.taskWords.length === 0
    && !actor.nativeConstruction && !actor.nativeAiTask && !actor.pendingNativeAi && !actor.resourceTask
    && entity.tileX === Math.floor(building.position.x) && entity.tileY === Math.floor(building.position.y)
    && entity.sourceRow === null && entity.rawTail.length === 0 && !entity.resource
    && bytes.getUint16(slot * 220, true) === building.nativePosition.x && bytes.getUint16(slot * 220 + 4, true) === building.nativePosition.y
    && bytes.getUint8(slot * 220 + 6) === building.unitType && bytes.getUint8(slot * 220 + 7) === 0
    && bytes.getInt32(slot * 220 + 12, true) === health && bytes.getUint8(slot * 220 + 0x2c) === status,
  "upgrade actor identity/type/HP/raw mismatch");
  for (const cell of building.footprint) {
    const index = cell.y * host.width + cell.x;
    requireConstruction(cell.x >= 0 && cell.x < host.width && cell.y >= 0 && cell.y < host.height
      && host.groundEligible[index] === false && host.ground[index] === (receipt && health > 0 ? slot : -1)
      && host.resourceTileFlags[index] === 0
      && !(host.productionExits ?? []).some(exit => exit.tile.x === cell.x && exit.tile.y === cell.y),
    "upgrade footprint ownership mismatch");
  }
}

function upgradeEffect(configuration: BrowserConstructionConfiguration, slot: number,
  upgrade: BrowserBuildingUpgradeState): BrowserConstructionTransition["effects"][number] {
  const level = upgrade.phase === "ready" ? 1 : 0;
  const building = configuration.buildings!.find(option => option.level === level && option.building.slot === slot)!.building;
  return { type: upgrade.phase === "building" ? "construction-started" : "construction-ready", action: "upgrade",
    slot, generation: 0, key: upgrade.key, receiptId: upgrade.receiptId, dependency: upgrade.dependency,
    busy: upgrade.phase === "building" ? 1 : 0, level, unitType: building.unitType, maxHealth: building.maxHealth, health: upgrade.health };
}

function validateFixedSlots(configuration: BrowserConstructionConfiguration, state: BrowserConstructionState,
  world: CampaignWorld, journaledCombat: boolean): void {
  const source = sourceOf(configuration), host = readTransportHostState(world);
  requireConstruction(world.browserCasualtyPickup?.runtimeProfile === "browser-adapted" && !host.nativeAiTasks
    && !host.nativeCombat && !host.resourceLifecycle
    && !host.slots.some(actor => actor?.nativeConstruction || actor?.nativeAiTask || actor?.pendingNativeAi || actor?.resourceTask),
  "native or unowned world cannot admit adapted construction");
  for (const field of ["id", "teams", "placementRows"] as const) requireConstruction(
    JSON.stringify(world.source[field]) === JSON.stringify(source.scenario[field]), `world source ${field} mismatch`);
  requireConstruction(state.slots && Object.keys(state.slots).join() === emptySourceSlots(configuration).join(), "fixed-slot checkpoint schema mismatch");
  requireConstruction(configuration.supportedActions?.includes("upgrade") ? state.upgrades && typeof state.upgrades === "object"
    && !Array.isArray(state.upgrades) : state.upgrades === undefined, "upgrade checkpoint capability mismatch");
  const aggregate = aggregateSlots(configuration, world.sessionId, state.sequence, state.slots, state.upgrades);
  requireConstruction(integer(state.sequence) && Object.keys(state).sort().join() === Object.keys(aggregate).sort().join()
    && Object.entries(aggregate).every(([key, value]) => key === "slots" || key === "upgrades" || state[key as keyof BrowserConstructionState] === value), "invalid fixed-slot aggregate");
  const children = Object.values(state.slots);
  const upgrades = Object.values(state.upgrades ?? {});
  requireConstruction(state.sequence >= Math.max(0, ...children.map(child => child.sequence))
    && state.sequence >= Math.max(0, ...upgrades.map(upgrade => upgrade.elapsedVisits + 1))
    && state.sequence <= children.reduce((sum, child) => sum + child.sequence, 0)
      + upgrades.reduce((sum, upgrade) => sum + upgrade.elapsedVisits + 1, 0), "invalid fixed-slot sequence");
  const receipts = [...children.flatMap(child => child.receiptId === null ? [] : [child.receiptId]), ...upgrades.map(upgrade => upgrade.receiptId)];
  requireConstruction(new Set(receipts).size === receipts.length, "duplicate fixed-slot receipt");
  for (const [slot, child] of Object.entries(state.slots)) {
    requireConstruction(Object.keys(child).sort().join() === "costAccumulator,elapsedVisits,kind,paid,phase,receiptId,sequence,sessionId,sourceId", "slot checkpoint schema mismatch");
    validateBrowserConstruction(fixedSlotConfiguration(configuration, state, Number(slot)), child, world,
      journaledCombat || state.upgrades?.[Number(slot)] !== undefined, false);
  }
  if (state.upgrades) {
    requireConstruction(integer(world.exomoney[0]) && world.sessionId.length > 0
      && host.width === source.width && host.height === source.height && world.entityBytes?.length === 800 * 220,
    "invalid upgrade world/accounting");
    for (const [slot, upgrade] of Object.entries(state.upgrades)) {
      const option = configuration.buildings!.find(option => option.level === 1 && option.building.slot === Number(slot));
      requireConstruction(option && configuration.supportedSlots!.includes(Number(slot)) && String(Number(slot)) === slot
        && upgrade && Object.keys(upgrade).sort().join() === "dependency,elapsedVisits,fromLevel,generation,health,key,level,paid,phase,receiptId"
        && upgrade.dependency === option.dependency && upgrade.paid === option.cost && upgrade.fromLevel === 0 && upgrade.level === 1
        && upgrade.generation === 0 && typeof upgrade.receiptId === "string" && upgrade.receiptId.length > 0 && upgrade.receiptId.length <= 128
        && integer(upgrade.elapsedVisits) && upgrade.elapsedVisits <= configuration.policy.completionVisits
        && (upgrade.phase === "destroyed" ? upgrade.health === 0 && upgrade.elapsedVisits > 0
          : upgrade.phase === (upgrade.elapsedVisits === configuration.policy.completionVisits ? "ready" : "building")),
      "invalid upgrade receipt/progress");
      validateUpgradeActor(configuration, state, world, Number(slot), journaledCombat);
    }
  }
}

export function browserConstructionSlots(configuration: BrowserConstructionConfiguration, state: BrowserConstructionState,
  world: CampaignWorld): readonly { readonly health: number; readonly level: number; readonly busy: 0 | 1 }[] {
  const source = sourceOf(configuration);
  const colony = projectLegacyColony(source.scenario.teams, source.units);
  return Array.from({ length: 5 }, (_, slot) => ({ health: world.buildingSlots[`0,${slot}`],
    level: state.upgrades?.[slot]?.phase === "ready" ? 1 : colony.slots.find(candidate => candidate.team === 0 && candidate.slot === slot)!.upgradeLevel,
    busy: world.buildingSlots[`0,${slot}`] > 0 && (state.upgrades?.[slot]?.phase === "building"
      || (state.slots ? state.slots[slot]?.phase === "building" : slot === 0 && state.phase === "building")) ? 1 : 0 }));
}

export function browserConstructionChoices(configuration: BrowserConstructionConfiguration, state: BrowserConstructionState,
  world: CampaignWorld) {
  const source = sourceOf(configuration);
  const options = configuration.buildings ?? sourceBuildingOptions({ scenario: source.scenario, units: source.units }, source.records);
  const slots = browserConstructionSlots(configuration, state, world);
  const restrictions = world.adaptedTro?.dependencyRestrictions[0] ?? source.scenario.teams[0].dependencies;
  return options.filter(option => (option.level === 0 ? (configuration.supportedActions ?? ["purchase"]).includes("purchase")
    : configuration.supportedActions?.includes("upgrade")) && (configuration.supportedSlots ?? [0]).includes(option.building.slot)).map(option => {
    const slot = option.building.slot, receipt = state.slots ? state.slots[slot] : state;
    const missingDependencies = sourceBuildingRequirements(option, options, slots);
    if (option.level === 1) {
      const upgrade = state.upgrades?.[slot];
      let reason = slots[slot].health <= 0 ? "Missing or destroyed building" : slots[slot].level !== 0 ? "Current level already satisfied"
        : upgrade ? upgrade.phase === "building" ? "Under construction" : "Upgrade already allocated"
        : slots[slot].busy ? "Under construction" : restrictions.includes(option.dependency) ? "Source restriction"
        : missingDependencies.length ? "Source prerequisites" : world.exomoney[0] < option.cost ? "Insufficient credits" : "";
      if (!reason) {
        try { validateUpgradeActor(configuration, state, world, slot, true); }
        catch (error) { reason = error instanceof Error ? error.message : "Unavailable upgrade actor"; }
      }
      return { ...option, slot, state: receipt, upgradeState: upgrade, action: "upgrade" as const,
        health: slots[slot].health, credits: world.exomoney[0], missingDependencies, requestEnabled: reason === "", reason };
    }
    let reason = !receipt ? "Source building already allocated" : receipt.phase !== "empty"
      ? slots[slot].health === 0 ? "Destroyed" : receipt.phase === "building" ? "Under construction" : "Complete"
      : restrictions.includes(option.dependency) ? "Source restriction" : missingDependencies.length ? "Source prerequisites"
      : world.exomoney[0] < option.cost ? "Insufficient credits" : "";
    if (!reason && receipt && configuration.configurationVersion === 2) {
      try {
        validateBrowserConstruction(slotConfigurations.get(configuration)!.get(slot)!, receipt, world);
      } catch (error) {
        reason = error instanceof Error ? error.message : "Unavailable fixed slot";
      }
    }
    return { ...option, slot, state: receipt, ...(configuration.supportedActions ? { action: "purchase" as const } : {}),
      health: slots[slot].health, credits: world.exomoney[0], missingDependencies,
      requestEnabled: reason === "", reason };
  });
}

function reduceFixedSlots(configuration: BrowserConstructionConfiguration, previous: BrowserConstructionState,
  world: CampaignWorld, request: BrowserConstructionRequest, journaledCombat: boolean): BrowserConstructionTransition {
  validateFixedSlots(configuration, previous, world, journaledCombat);
  requireConstruction(integer(request.sequence) && request.sequence === previous.sequence + 1, "duplicate/stale sequence");
  const slots = { ...previous.slots! };
  const upgrades = previous.upgrades ? { ...previous.upgrades } : undefined;
  let candidate = world;
  const effects: BrowserConstructionTransition["effects"][number][] = [];
  if (request.type === "purchase") {
    const choice = browserConstructionChoices(configuration, previous, world).find(option => option.level === 0 && option.dependency === request.dependency);
    requireConstruction(choice?.requestEnabled, choice?.reason || "unsupported dependency/upgrade");
    requireConstruction(!Object.values(slots).some(state => state.receiptId === request.id)
      && !Object.values(upgrades ?? {}).some(state => state.receiptId === request.id), "duplicate fixed-slot receipt");
    const slot = choice.slot, child = slots[slot];
    const transition = reduceBrowserConstruction(slotConfigurations.get(configuration)!.get(slot)!, child, candidate,
      { ...request, sequence: child.sequence + 1 }, journaledCombat);
    slots[slot] = transition.state;
    candidate = transition.world;
    effects.push(...transition.effects);
  } else if (request.type === "upgrade") {
    const choice = browserConstructionChoices(configuration, previous, world).find(option => option.level === 1 && option.dependency === request.dependency);
    requireConstruction(upgrades && choice?.requestEnabled, choice?.reason || "unsupported dependency/upgrade");
    requireConstruction(typeof request.id === "string" && request.id.length > 0 && request.id.length <= 128
      && request.home.x === configuration.home.x && request.home.y === configuration.home.y, "invalid upgrade receipt or original home");
    requireConstruction(!Object.values(slots).some(state => state.receiptId === request.id)
      && !Object.values(upgrades).some(state => state.receiptId === request.id), "duplicate fixed-slot receipt");
    const actor = transportHostState(world).slots[choice.slot]!;
    upgrades[choice.slot] = { receiptId: request.id, dependency: choice.dependency, key: actor.key, generation: 0,
      fromLevel: 0, level: 1, phase: "building", elapsedVisits: 0, paid: choice.cost, health: actor.health };
    candidate = { ...world, exomoney: { ...world.exomoney, 0: world.exomoney[0] - choice.cost } };
    effects.push(upgradeEffect(configuration, choice.slot, upgrades[choice.slot]));
  } else {
    requireConstruction(request.type === "visit" && previous.phase === "building", "no active construction or unsupported cancellation");
  }
  for (const [slot, child] of Object.entries(previous.slots!)) {
    if (child.phase !== "building") continue;
    const transition = reduceBrowserConstruction(slotConfigurations.get(configuration)!.get(Number(slot))!, child, candidate,
      { type: "visit", sequence: child.sequence + 1 }, journaledCombat);
    slots[Number(slot)] = transition.state;
    effects.push(...transition.effects);
  }
  for (const [slotText, upgrade] of Object.entries(previous.upgrades ?? {})) {
    if (upgrade.phase !== "building") continue;
    const slot = Number(slotText), health = transportHostState(candidate).slots[slot]!.health;
    const elapsedVisits = upgrade.elapsedVisits + 1;
    const phase = health === 0 ? "destroyed" : elapsedVisits === configuration.policy.completionVisits ? "ready" : "building";
    const option = configuration.buildings!.find(option => option.dependency === upgrade.dependency)!;
    const currentHealth = phase === "ready" ? Math.min(health, option.building.maxHealth) : health;
    upgrades![slot] = { ...upgrade, phase, elapsedVisits, health: currentHealth };
    if (phase === "ready") {
      const host = transportHostState(candidate), bytes = Uint8Array.from(candidate.entityBytes!);
      host.slots[slot]!.unitType = option.building.unitType;
      host.slots[slot]!.health = currentHealth;
      bytes[slot * 220 + 6] = option.building.unitType;
      new DataView(bytes.buffer).setInt32(slot * 220 + 12, currentHealth, true);
      candidate = { ...candidate, transportState: host, entityBytes: bytes,
        buildingSlots: { ...candidate.buildingSlots, [`0,${slot}`]: currentHealth },
        entities: candidate.entities.map(entity => entity.rawSlot === slot ? { ...entity,
          unitType: option.building.unitType, maxHealth: option.building.maxHealth, health: currentHealth } : entity) };
    }
    if (phase !== "building") effects.push(upgradeEffect(configuration, slot, upgrades![slot]));
  }
  const state = freeze(aggregateSlots(configuration, world.sessionId, request.sequence, slots, upgrades));
  validateFixedSlots(configuration, state, candidate, journaledCombat);
  return { state, world: candidate, effects };
}
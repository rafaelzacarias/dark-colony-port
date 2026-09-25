import { assetUrl } from "./asset-url";
import {
  DeterministicSimulation,
  DeterministicRandom,
  FixedStepClock,
  NavigationGrid,
  SIMULATION_TICKS_PER_SECOND,
  SUBCELLS_PER_CELL,
  unitOptionsFromLegacy,
  type Faction,
  type LegacyMissionEntity,
  type LegacyUnitStat,
  type SimulationSnapshot,
  type UnitSnapshot,
} from "./engine";
import type { MovementPlane, ResourceActorStateProfile, WeaponStats } from "./engine/simulation";
import { campaignPreflight } from "./game-data";
import type { SkirmishCallbacks } from "./simulation-view";
import type { MissionCursor } from "./ui/mission-cursor";
import { worldYToScreen, screenYToWorld } from "./render/coordinates";
import { drawTerrainLayer } from "./render/terrain";
import { createMissionTerrain, type MissionMode3Terrain } from "./render/mission-terrain";
import { createMissionSpritePalettes } from "./render/mission-sprites";
import { beginMode1ShadowFrame, endMode1ShadowFrame } from "./render/mode1-canvas";
import { createLegacyInfantryFamilyMask } from "./engine/legacy-navigation";
import { projectLegacyColony } from "./engine/legacy-colony";
import { legacyStaticOccupancyFieldsFromSource, projectLegacyStaticOccupancy } from "./engine/legacy-static-occupancy";
import { createCampaignSession, CampaignSession, type CampaignSessionFrame, type CampaignReservation,
  type CampaignVisibilityInput, type BrowserViewFrame } from "./engine/campaign-session";
import type { LegacyCampaignImportConsent } from "./engine/campaign-session-legacy-import";
import { sourceProductionUi, sourceProductionVisits, sourceProductionUpgradeLevels } from "./engine/source-production-options";
import type { CampaignProductionState } from "./engine/campaign-production";
import { sourceBrowserCampaignSessionOptions, type SourceBrowserCampaignMission } from "./engine/source-browser-campaign-options";
import { initializeBrowserCampaignView, planBrowserCampaignViewFrame, restoreBrowserCampaignView,
  type BrowserCampaignViewState } from "./engine/browser-campaign-runtime";
import { BrowserCampaignEconomy, type BrowserEconomyCheckpoint } from "./engine/browser-campaign-economy";
import { browserMineOptions } from "./engine/browser-mines";
import { browserVisionArtifact, browserExcavationArtifact } from "./engine/browser-artifacts";
import { sourceBrowserEconomyHarvesters } from "./engine/browser-campaign-economy-source";
import { browserScenarioMarkerPresentation, browserType37PlacementHidden, browserType37SourceMatches,
  observeBrowserType37Frame, projectBrowserType37Discovery,
  projectBrowserType37Presentation, isBrowserScenarioMarker } from "./engine/browser-type37-presentation";
import { createBrowserResearchConfiguration, observeBrowserResearch, restoreBrowserResearch, validateBrowserResearchConfiguration,
  type BrowserResearchConfiguration, type BrowserResearchState } from "./engine/browser-research";
import { sourceConstructionSources, sourceConstructionSample, type SourceConstructionMission,
  type SourceConstructionFrame } from "./engine/source-construction-options";
import { sourceNativeCombatSessionOptions, sourceNativeCombatFrame, sourceNativeVisibilityPlane,
  type SourceNativeCombatMission, type SourceNativeCombatFrame, type SourceNativeQueuedPlayerCommand } from "./engine/source-native-combat-mission";
import { createSourceNativePlayerOrder, previewSourceNativePlayerOrder, sourceNativePlayerAcquiredTarget,
  type SourceNativePlayerOrder, type SourceNativePlayerOrderPreview } from "./engine/source-native-player-orders";
import { createSourceNativeCombatPresentation, type SourceNativeCombatPresentation } from "./engine/source-native-combat-presentation";
import { nativeViewResourceIdentity, type NativeViewProjection, type NativeViewFrame, type NativeViewTransport } from "./engine/native-view-projection";
import { validateSourceNativeVisibilityHostConfiguration, type SourceNativeVisibilityHostConfiguration } from "./engine/source-native-visibility-host";
import type { NativeConstructionActor } from "./engine/native-construction-host";
import type { CampaignEntity, CampaignWorld } from "./engine/campaign-world";
import { CONTACT_JOIN, CONTACT_PICKUP_STATE_OFFSET } from "./engine/browser-contact-pickups";
import { sourceUnitIsCommander } from "./engine/browser-casualty-pickup";
import { commandNativeHarvest, transportHostState, type HostSlot, type NativeHarvestCommand,
  type HostUnitUpdate, type HostRequest, type ResourceHostEntityState } from "./engine/transport-host";
import { CombatMovementOrders } from "./engine/combat-movement";
import { GuardAttackOrders } from "./engine/guard-ai";
import { missionBailDeadlineExceeded } from "./engine/mission-controller";
import { areHostile } from "./engine/diplomacy";
import { createMissionSceneFrame, missionSceneCamera, type MissionSceneEntity, type MissionMode3Prepass } from "./render/mission-scene-frame";
import { copyLegacyDamageProfile, defenseOptionsFromLegacy, sourceScenarioUpgradeLevels, verifiedNativeDamageFromLegacy, verifiedNativeDefenseFromLegacy } from "./engine/legacy-balance";
import { legacyCueCatalog, type WebAudioManager } from "./audio";
import { createMissionAudioFeedback, type MissionAudioFeedback } from "./audio/mission-feedback";
import { composeFinSample, createAtlasCache, createFinFrameLookup, createFinSelector, createFinSourceSampler,
  directionFromMotion, drawFinComposition, TRSC_GRAY_VISUAL_DIRECTIONS,
  type FinAction, type CompassDirection, type FinAnimationData, type FinAtlasFrame } from "./render";
import { finBodyBounds, type FinBodyBounds } from "./render/fin-composition";
import { drawBrowserMode5Canvas } from "./render/mode5-canvas";

export function prepareNativeDeathSoundEffects(
  requests: readonly HostRequest[],
  consumer: SkirmishCallbacks["onNativeDeathSound"],
): () => void {
  const sounds = requests.filter(request => request.type === "native-death-sound");
  if (sounds.length && !consumer) throw new TypeError("Native death sound requires an explicit postcommit consumer");
  const pending = structuredClone(sounds);
  let dispatched = false;
  return () => {
    if (dispatched) return;
    dispatched = true;
    const errors: unknown[] = [];
    for (const request of pending) {
      try { consumer!(request); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "Native death sound presentation failed after commit");
  };
}

interface SpriteMetadata {
  readonly frames: readonly FinAtlasFrame[];
}

type AnimationMetadata = FinAnimationData;

interface MissionVisual {
  readonly animation: AnimationMetadata;
  readonly atlases: ReadonlyMap<string, { readonly image: HTMLImageElement; readonly metadata: SpriteMetadata }>;
  readonly lookup: ReturnType<typeof createFinFrameLookup>;
  readonly selector: ReturnType<typeof createFinSelector>;
  readonly sample: ReturnType<typeof createFinSourceSampler>;
}

interface StaticMissionObject {
  readonly id: number;
  readonly entity: LegacyMissionEntity;
  readonly stat: LegacyUnitStat;
}

function browserMovementPlane(mission: SourceBrowserCampaignMission,
  stat: LegacyUnitStat & { readonly rawTail?: readonly number[] }): MovementPlane {
  if (mission.runtimeProfile !== "browser-adapted" || stat.movementSpeed <= 0 || stat.rawTail === undefined) return "ground";
  const fields = legacyStaticOccupancyFieldsFromSource({ rawTail: stat.rawTail });
  return fields.auxiliaryField === 0 && fields.movementClassByte !== 0 ? "air" : "ground";
}

function browserStaticWeapon(mission: SourceBrowserCampaignMission, stat: LegacyUnitStat, level: number): WeaponStats | undefined {
  if (mission.runtimeProfile !== "browser-adapted" || ![41, 42].includes(stat.index)) return undefined;
  const source = mission.weapons.find(weapon => weapon.id === stat.weapons[level]);
  if (!source || source.rawPrefix !== 5 || source.shots !== 0 || !mission.damageMatrix) {
    throw new TypeError(`Unsupported browser stationary weapon: ${stat.index}:${stat.weapons[level]}`);
  }
  return { damage: source.damage, rangeCells: source.range, cooldownTicks: source.rateOfFire,
    sourceDamage: copyLegacyDamageProfile({ coefficients: mission.damageMatrix[source.rawPrefix], callerFactor: 256, specialFlag: false }) };
}

function currentUpgradeLevels(mission: SourceBrowserCampaignMission, production: CampaignProductionState | undefined,
  team: number, unitType: number) {
  const scenario = sourceScenarioUpgradeLevels(mission.scenario.teams[team === 8 ? 0 : team], unitType);
  const current = mission.runtimeProfile === "browser-adapted" ? sourceProductionUpgradeLevels(production, team, unitType) : undefined;
  return current ? { ...scenario, ...current } : scenario;
}

function upgradedEquipment(mission: SourceBrowserCampaignMission, stat: LegacyUnitStat,
  levels: { readonly weaponLevel: number; readonly armorLevel: number }) {
  if (!mission.damageMatrix) throw new TypeError("Adapted upgrades require the source damage matrix");
  const weapon = stat.movementSpeed === 0 ? browserStaticWeapon(mission, stat, levels.weaponLevel)
    : unitOptionsFromLegacy(stat, mission.weapons, levels.weaponLevel, { matrix: mission.damageMatrix,
      armorLevel: levels.armorLevel, callerFactor: 256, specialFlag: false }).weapon;
  if (!weapon) throw new TypeError(`Unsupported upgrade equipment: ${stat.index}`);
  return { weapon, sourceDefense: defenseOptionsFromLegacy(stat, levels.armorLevel) };
}

export interface MissionViewMode3Frame extends MissionMode3Prepass {
  readonly terrain?: MissionMode3Terrain;
  readonly capture: (snapshot: SimulationSnapshot) => readonly MissionSceneEntity[];
  readonly image: (sprite: string, part: MissionSceneEntity["parts"][number]) => CanvasImageSource | undefined;
}

import { additionalMissionAnimationArchives } from "./engine/mission-animation-archives";

const ASSET_ROOT = assetUrl("/assets/generated");
// SARGE (human) and PSYC (alien) share the DC.EXE income-interception deployment.
const INTERCEPTOR_TYPES: ReadonlySet<number> = new Set([4, 12]);
const SPRITE_ALIASES: Readonly<Record<string, string>> = { BEEK: "BEAC" };

export function missionUnitAction(unit: UnitSnapshot, previous: UnitSnapshot, pendingPath = false): FinAction {
  if (unit.activity === "die") return "Die";
  if (unit.activity === "move" || pendingPath || unit.xSubcells !== previous.xSubcells || unit.ySubcells !== previous.ySubcells) return "Move";
  return unit.activity === "attack" ? "Attack" : "Stand";
}

export function missionMiningVisualType(unit: UnitSnapshot, typeId: number,
  economy?: BrowserEconomyCheckpoint): 47 | 48 | undefined {
  if (!economy || (typeId !== 6 && typeId !== 14) || unit.health <= 0 || unit.activity !== "idle"
    || unit.movementPlane === "air") return undefined;
  const binding = economy.bindings.find(entry => entry.simulationId === unit.id);
  const actor = economy.harvesters.find(entry => entry.key === binding?.key);
  const order = economy.orders.find(entry => entry.simulationId === unit.id);
  if (!actor || actor.typeId !== typeId || actor.team !== unit.team || !order || order.phase !== "extracting"
    || !(economy.rates[order.nodeKey] > 0) || !(economy.remaining[order.nodeKey] > 0)
    || unit.xSubcells !== (order.target.x + 0.5) * SUBCELLS_PER_CELL
    || unit.ySubcells !== (order.target.y + 0.5) * SUBCELLS_PER_CELL) return undefined;
  return typeId === 6 ? 47 : 48;
}

export function missionAnimationArchives(sprite: string): readonly string[] {
  if (sprite === "T") return ["TURR"];
  if (sprite === "CAM") return ["CAMM"];
  if (sprite === "EDPLY") return ["EXPL"];
  if (sprite === "SDPL") return ["SLUG"];
  if (sprite === "EXCOPOD") return ["HUBU"];
  if (sprite === "BRRKPOD") return ["HUBU", "BURN2"];
  if (sprite === "SCNCPOD") return ["HUBU", "DROP"];
  if (sprite === "BIOHIV" || sprite === "WARHIVE") return ["ALBU"];
  if (sprite === "MINDHIV") return ["ALBU", "SAUC2"];
  if (sprite === "SAUC") return ["SAWS", "SAUC"];
  return additionalMissionAnimationArchives(sprite) ?? [SPRITE_ALIASES[sprite] ?? sprite];
}
export const MISSION_BROWSER_POLICY = Object.freeze({ fixedStepMilliseconds: 50, orientationSteps: 1, seed: 0xdc1997 });

function firingRevealTicks(stat: LegacyUnitStat & { readonly rawTail?: readonly number[] }): number {
  // GAMESTAT column 14 becomes type+0x64, then the low five bits of actor+0x10 when firing.
  return (stat.rawTail?.[3] ?? 0) & 31;
}

export function missionResourceSample(animation: FinAnimationData, task: ResourceHostEntityState) {
  if (task.nativeMovement) {
    const native = task.nativeMovement.state;
    const profile = Object.entries(task.nativeBanks ?? {}).find(([, bank]) => bank === native.animation.bank)?.[0];
    if (!profile) throw new Error("Missing source native movement FIN binding");
    task = { ...task, direction: native.direction, animation: { profile, frame: native.animation.frame,
      delay: native.animation.delay, mode: native.animation.mode as 0 | 1 | 2 | 3 } };
  }
  const direction = (((task.direction + 8) & 255) >> 4) * 2;
  const offsets = [0, ...Array.from({ length: 15 }, (_, index) => [index + 1, -index - 1]).flat(), 16];
  const state = offsets.map((offset) => {
    const suffix = (12 - (((direction + offset + 32) & 31) >> 1) + 16) & 15;
    return animation.states.find((entry) => entry.name === `${task.animation.profile}${suffix}` && entry.validRange !== false);
  }).find(Boolean);
  const frame = task.nativeMovement && task.animation.mode === 0 && state &&
    task.animation.frame > state.lastTimelineIndex - state.firstTimelineIndex ? 0 : task.animation.frame;
  const timelineIndex = (state?.firstTimelineIndex ?? -1) + frame;
  if (!state || timelineIndex > state.lastTimelineIndex || !animation.timeline[timelineIndex]) {
    throw new Error(`Missing native resource FIN frame: ${task.animation.profile}:${task.animation.frame}`);
  }
  return { timelineIndex, finished: task.animation.mode === 2, children: animation.timeline[timelineIndex].children };
}

export function missionVisualSprites(mission: SourceConstructionMission & Pick<SourceBrowserCampaignMission, "runtimeProfile" | "browserConstruction">,
  world?: CampaignWorld, research?: BrowserResearchConfiguration): readonly string[] {
  const { rawScenario: _rawScenario, ...source } = mission.scenario;
  const markerWorld = mission.runtimeProfile === "browser-adapted" && world && world.scenarioMarkers?.length
    && browserType37SourceMatches(world, source) ? world : undefined;
  const overlayRows = markerWorld && research ? new Set(projectBrowserType37Discovery(markerWorld, research, {
    research, scienceOwner: research.scienceOwner, localTeam: 0, presentationPolicy: "adapted-original-cursor-v1",
    isTileVisible: () => false }).entries.map(entry => entry.sourceRow)) : new Set<number>();
  const types = new Set<number>([92, 93, ...mission.scenario.placementRows.flatMap((row, sourceRow) =>
    overlayRows.has(sourceRow) || browserType37PlacementHidden(markerWorld, sourceRow, row) ? [] : [row[2]]),
    ...projectLegacyColony(mission.scenario.teams, mission.units).buildings.map(({ unitType }) => unitType),
    ...(mission.sourceProduction?.production?.sourceProfiles.map(({ unitType }) => unitType) ?? []),
    ...(mission.sourceProduction?.production?.adaptedCollectorProfiles?.map(({ unitType }) => unitType) ?? []),
    ...(mission.sourceProduction?.production?.adaptedUnitProfiles?.map(({ unitType }) => unitType) ?? [])]);
  if (mission.sourceResource?.resourceLifecycle.nativeHarvest) [6, 14, 47, 48].forEach(type => types.add(type));
  if (mission.browserConstruction) {
    types.add(mission.browserConstruction.building.unitType);
    for (const option of mission.browserConstruction.buildings ?? []) {
      if (mission.browserConstruction.supportedSlots?.includes(option.building.slot)) types.add(option.building.unitType);
    }
  }
  for (const source of sourceConstructionSources(mission) ?? []) types.add(source.race === 0 ? 20 : 32);
  for (const block of mission.triggers) for (const action of block.actions) {
    if (action.name === "newtype") types.add(Number(action.arguments[2]));
    if (action.name === "reinforce" || action.name === "reinforce2") {
      for (let index = 3; index + 1 < action.arguments.length; index += 2) {
        if (Number(action.arguments[index + 1]) > 0) types.add(Number(action.arguments[index]));
      }
    }
  }
  return [...new Set([...types].map((type) => {
    const stat = mission.units.find(({ index }) => index === type);
    if (!stat) throw new Error(`Missing foreseeable source type ${type}`);
    return stat.sprite;
  }))];
}

export interface MissionEntityBinding {
  readonly slot: number;
  readonly generation: number;
  readonly key: string;
  readonly sourceRow: number | null;
  readonly simulationId: number;
}

interface MissionViewState {
  combatReveals?: { id: number; team: number; expiresAt: number }[];
  nativeCommand?: SourceNativeQueuedPlayerCommand;
  resourceDiagnostic?: string;
  bindings: MissionEntityBinding[];
  unitStats: { id: number; type: number }[];
  unitWeapons: { id: number; weapon: number }[];
  unitTeams: { id: number; team: number }[];
  staticObjects: { id: number; type: number; entity: LegacyMissionEntity }[];
  selectedIds: number[];
  routes: { id: number; points: { x: number; y: number }[]; nextIndex: number; repeat?: boolean; engage?: boolean }[];
  orderMode: "context" | "move" | "assault" | "patrol" | "waypoints";
  movementStance: "move" | "assault";
  waypointDraft: { points: { x: number; y: number }[]; engage: boolean } | null;
  pendingReservations: CampaignReservation[];
  pendingProduction?: number;
  pendingConstruction?: number;
  detachedIds: number[];
  recordedDeaths: number[];
  explored: number[];
  camera: { x: number; y: number; awaitingPlayerFocus: boolean };
  latestMessage: string;
  carriers: { slot: number; generation: number; team: number; phase: string; sprite: string;
    position: { x: number; y: number }; height: number }[];
  outcome: { resultCode: number; reasonCode: number; ready: boolean } | null;
  diagnostic: string | null;
  animationStates: { id: number; action: FinAction; facing: CompassDirection; since: number }[];
}

export interface MissionViewCheckpoint {
  readonly research?: { readonly presentationPolicy: "adapted-original-cursor-v1"; readonly state: BrowserResearchState };
  readonly browserAi?: BrowserCampaignViewState;
  readonly economy?: BrowserEconomyCheckpoint;
  readonly version: 1 | 2;
  readonly kind: "mission-view";
  readonly sourceIdentity: string;
  readonly simulation: ReturnType<DeterministicSimulation["checkpoint"]>;
  readonly session: ReturnType<CampaignSession["checkpoint"]> | null;
  readonly combatMovement: ReturnType<CombatMovementOrders["checkpoint"]>;
  readonly guardAttacks?: ReturnType<GuardAttackOrders["checkpoint"]>;
  readonly state: MissionViewState;
}

function requireCheckpoint(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new RangeError(`Invalid MissionView checkpoint: ${detail}`);
}

const legacyResearchConfigurations = new WeakMap<SourceBrowserCampaignMission, BrowserResearchConfiguration>();

function canonicalSource(value: unknown): string {
  if (value instanceof Uint8Array || value instanceof Uint16Array) return canonicalSource(Array.from(value));
  if (Array.isArray(value)) return `[${value.map(canonicalSource).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalSource(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function requireCheckpointJson(value: unknown, ancestors = new Set<object>(), depth = 0): void {
  requireCheckpoint(depth < 100, "JSON nesting");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") { requireCheckpoint(Number.isFinite(value), "non-finite number"); return; }
  requireCheckpoint(typeof value === "object", "JSON value");
  requireCheckpoint(!ancestors.has(value), "cyclic JSON");
  const array = Array.isArray(value);
  requireCheckpoint(Object.getPrototypeOf(value) === (array ? Array.prototype : Object.prototype), "JSON prototype");
  ancestors.add(value);
  const keys = array ? Array.from({ length: value.length }, (_, index) => String(index)) : Object.keys(value);
  requireCheckpoint(Reflect.ownKeys(value).length === keys.length + Number(array), "JSON keys");
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    requireCheckpoint(descriptor && "value" in descriptor && descriptor.enumerable, "JSON data property");
    requireCheckpointJson(descriptor.value, ancestors, depth + 1);
  }
  ancestors.delete(value);
}

type ViewCheckpointCheck = (value: unknown) => void;

function validateViewCheckpoint(value: unknown, mission: SourceBrowserCampaignMission): asserts value is MissionViewCheckpoint {
  requireCheckpointJson(value);
  const integer = (minimum = 0, maximum = Number.MAX_SAFE_INTEGER): ViewCheckpointCheck => (entry) =>
    requireCheckpoint(typeof entry === "number" && Number.isSafeInteger(entry) && entry >= minimum && entry <= maximum, "integer");
  const choice = (...choices: unknown[]): ViewCheckpointCheck => (entry) => requireCheckpoint(choices.includes(entry), "enum");
  const string: ViewCheckpointCheck = (entry) => requireCheckpoint(typeof entry === "string", "string");
  const finite: ViewCheckpointCheck = (entry) => requireCheckpoint(typeof entry === "number" && Number.isFinite(entry), "number");
  const array = (check: ViewCheckpointCheck): ViewCheckpointCheck => (entry) => {
    requireCheckpoint(Array.isArray(entry), "array");
    entry.forEach(check);
  };
  const nullable = (check: ViewCheckpointCheck): ViewCheckpointCheck => (entry) => { if (entry !== null) check(entry); };
  const object = (required: Record<string, ViewCheckpointCheck>, optional: Record<string, ViewCheckpointCheck> = {}): ViewCheckpointCheck => (entry) => {
    requireCheckpoint(entry !== null && typeof entry === "object" && !Array.isArray(entry), "object");
    const record = entry as Record<string, unknown>;
    requireCheckpoint(Object.keys(record).every((key) => Object.hasOwn(required, key) || Object.hasOwn(optional, key)), "unknown field");
    for (const [key, check] of Object.entries(required)) { requireCheckpoint(Object.hasOwn(record, key), `missing ${key}`); check(record[key]); }
    for (const [key, check] of Object.entries(optional)) if (Object.hasOwn(record, key)) check(record[key]);
  };
  const id = integer(1), number = integer(), boolean = choice(true, false),
    team = integer(0, mission.runtimeProfile === "browser-adapted" ? 8 : mission.scenario.teams.length - 1);
  const point = object({ x: integer(0, mission.map.width - 1), y: integer(0, mission.map.height - 1) });
  const slot = integer(0, 799);
  const nativeBinding = object({ slot, generation: number, key: string, raw: array(integer(0, 255)) });
  const nativeDestination = object({ column: integer(0, Math.min(255, mission.map.width - 1)), row: integer(0, Math.min(255, mission.map.height - 1)) });
  const nativeOrder: ViewCheckpointCheck = (entry) => {
    const type = (entry as { type?: unknown } | null)?.type;
    if (type === "Stop") object({ type: choice("Stop") })(entry);
    else if (type === "MoveOnly") object({ type: choice("MoveOnly"), destination: nativeDestination })(entry);
    else object({ type: choice("Attack"), destination: nativeDestination, target: nativeBinding })(entry);
  };
  const delegated: ViewCheckpointCheck = () => {};
  const dictionary = (check: ViewCheckpointCheck): ViewCheckpointCheck => entry => {
    requireCheckpoint(entry !== null && typeof entry === "object" && !Array.isArray(entry), "dictionary");
    Object.values(entry).forEach(check);
  };
  const economy = object({ scope: choice("browser-adapted-economy-v1"), profileId: string, sessionId: string, tick: number,
    bindings: array(object({ key: string, simulationId: id })),
    harvesters: array(object({ key: string, slot, generation: number, team: integer(0, 7), typeId: choice(6, 14),
      options: object({ faction: choice("human", "alien"), team: integer(0, 7), cell: point,
        positionSubcells: object({ x: number, y: number }), speedSubcellsPerTick: integer(1), maxHealth: integer(1), health: number }) })),
    remaining: dictionary(number), rates: dictionary(integer(0, 32767)), earned: dictionary(number),
    orders: array(object({ simulationId: id, nodeKey: string, target: point, phase: choice("moving", "extracting"), progressTicks: number })),
  }, { incomeInterception: delegated });
  const browserAi = object({ version: choice(1), runtimeProfile: choice("browser-adapted"), sourceCanonical: string, sourceCycle: number,
    strategy: object({ version: choice(1), fingerprint: string, lastTick: integer(-1), nextDecisionTick: number,
      teams: array(object({ team: integer(0, 7), rng: integer(1, 0xffffffff), decisions: number })),
      actors: dictionary(object({ objective: number, group: integer(Number.MIN_SAFE_INTEGER), signature: string,
        issuedTick: integer(-100), position: point, stalled: integer(0, 4) })),
    }),
  });
  object({ version: choice(1, 2), kind: choice("mission-view"), sourceIdentity: choice(canonicalSource(mission)),
    simulation: delegated, session: delegated, combatMovement: delegated,
    state: object({
      bindings: array(object({ slot, generation: number, key: string, sourceRow: nullable(number), simulationId: id })),
      unitStats: array(object({ id, type: number })), unitWeapons: array(object({ id, weapon: integer(-1) })),
      unitTeams: array(object({ id, team })),
      staticObjects: array(object({ id, type: number, entity: object({ source: choice("placement"), x: finite, y: finite,
        unitType: number, team, rawTail: array(integer(Number.MIN_SAFE_INTEGER)) }) })),
      selectedIds: array(id), routes: array(object({ id, points: array(point), nextIndex: number }, { repeat: boolean, engage: boolean })),
      orderMode: choice("context", "move", "assault", "patrol", "waypoints"), movementStance: choice("move", "assault"),
      waypointDraft: nullable(object({ points: array(point), engage: boolean })),
      pendingReservations: array(object({ slot, generation: number, tileX: integer(0, mission.map.width - 1), tileY: integer(0, mission.map.height - 1) })),
      detachedIds: array(id), recordedDeaths: array(id), explored: array(choice(0, 1)),
      camera: object({ x: finite, y: finite, awaitingPlayerFocus: boolean }), latestMessage: string,
      carriers: array(object({ slot, generation: number, team, phase: string, sprite: string,
        position: object({ x: finite, y: finite }), height: finite })),
      outcome: nullable(object({ resultCode: integer(Number.MIN_SAFE_INTEGER), reasonCode: integer(Number.MIN_SAFE_INTEGER), ready: boolean })),
      diagnostic: nullable(string),
      animationStates: array(object({ id, action: choice("Stand", "Move", "Attack", "Die"),
        facing: choice("N", "NE", "E", "SE", "S", "SW", "W", "NW"), since: number })),
    }, { combatReveals: array(object({ id, team: integer(0, 7), expiresAt: number })),
      pendingProduction: integer(0, 109), pendingConstruction: integer(0, 109), resourceDiagnostic: string,
      nativeCommand: object({ sourceId: string, id: string, localTeam: choice(0), selected: nativeBinding, command: nativeOrder }) }),
  }, { browserAi, economy, research: object({ presentationPolicy: choice("adapted-original-cursor-v1"), state: delegated }),
    guardAttacks: array(object({ id, targetId: id })) })(value);
}

async function loadJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return (await response.json()) as T;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error(`Could not load ${url}`)), { once: true });
    image.src = url;
  });
}

const reportedRenderDiagnostics = new Set<string>();

function reportRenderDiagnostic(key: string, detail?: unknown): void {
  if (reportedRenderDiagnostics.has(key) || reportedRenderDiagnostics.size >= 256) return;
  reportedRenderDiagnostics.add(key);
  console.warn(`[FIN renderer] ${key}`, detail ?? "");
}

const missionAtlasCache = createAtlasCache(async (name: string) => {
  const [metadata, image] = await Promise.all([
    loadJson<SpriteMetadata>(`${ASSET_ROOT}/sprites/SPRITES/${name}.json`),
    loadImage(`${ASSET_ROOT}/sprites/SPRITES/${name}.png`),
  ]);
  return { metadata, image };
}, { retained: 128, concurrent: 4, pending: 1024 });

async function loadMissionVisual(sprite: string): Promise<MissionVisual> {
  const archives = await Promise.all(missionAnimationArchives(sprite).map((name) =>
    loadJson<AnimationMetadata>(`${ASSET_ROOT}/animations/${name}.json`)));
  const states: AnimationMetadata["states"][number][] = [];
  const timeline: AnimationMetadata["timeline"][number][] = [];
  for (const archive of archives) {
    const offset = timeline.length;
    states.push(...archive.states.map((state) => ({ ...state,
      firstTimelineIndex: state.firstTimelineIndex + offset, lastTimelineIndex: state.lastTimelineIndex + offset })));
    timeline.push(...archive.timeline);
  }
  const animation: AnimationMetadata = { states, timeline };
  const names = new Set(animation.timeline.flatMap(({ children }) => children.map(({ sprite }) => sprite.toUpperCase())));
  const atlases = new Map<string, Awaited<ReturnType<typeof missionAtlasCache.load>>>();
  await Promise.all([...names].map(async (name) => {
    atlases.set(name, await missionAtlasCache.load(name));
  }));
  reportRenderDiagnostic(`native-update-cadence-unverified:${SIMULATION_TICKS_PER_SECOND}Hz`);
  reportRenderDiagnostic("native-cross-entity-child-sorting-unimplemented");
  const eventNames = new Set(animation.timeline.flatMap((entry) =>
    ((entry as { events?: readonly { name: string }[] }).events ?? []).map(({ name }) => name)));
  if (eventNames.size) reportRenderDiagnostic(`native-events:${sprite}`, [...eventNames]);
  return {
    animation,
    atlases,
    lookup: createFinFrameLookup(Object.fromEntries([...atlases].map(([name, atlas]) => [name, atlas.metadata]))),
    selector: createFinSelector(animation, {
      prefix: sprite, directions: TRSC_GRAY_VISUAL_DIRECTIONS, layerOrder: "source",
    }),
    sample: createFinSourceSampler(animation),
  };
}

export class MissionView {
  readonly canvas: HTMLCanvasElement;
  readonly stage: HTMLElement;
  readonly callbacks: SkirmishCallbacks;
  readonly mission: SourceNativeCombatMission & SourceBrowserCampaignMission;
  readonly playerFaction: Faction;
  #simulation: DeterministicSimulation;
  get simulation(): DeterministicSimulation { return this.#simulation; }
  get grid(): NavigationGrid { return this.#simulation.grid; }
  readonly clock = new FixedStepClock(MISSION_BROWSER_POLICY.fixedStepMilliseconds);
  #session: CampaignSession | null;
  #browserAi: BrowserCampaignViewState | undefined;
  #browserEconomy: BrowserCampaignEconomy | undefined;
  #type37World: CampaignWorld | undefined;
  #research: BrowserResearchConfiguration | undefined;
  #discoveryCursor: FinAtlasFrame | undefined;
  #nativeCombatProjection: string | undefined;
  #pendingNativeCommand: SourceNativeQueuedPlayerCommand | undefined;
  #nativeCommandDiagnostic: string | undefined;
  #nativeCombatPresentation: SourceNativeCombatPresentation | undefined;
  #nativeViewState: NativeViewProjection | undefined;
  #nativeViewResources: { identity: string; presentations: ReturnType<SourceNativeCombatPresentation> } | undefined;
  #nativeViewSamples = new Map<number, ReturnType<CampaignSession["nativeViewActorSample"]>>();
  readonly #nativeVisibilityConfiguration: SourceNativeVisibilityHostConfiguration | undefined;
  #cursorCache: { session: CampaignSession | null; tick: number; sources: MissionView["resourceSources"];
    admission?: { key: string; cursor: MissionCursor } } | null = null;
  readonly #sceneIdentities = new Map<number, { generation: number; height: number }>();
  readonly #nativeBindings = new Map<string, MissionEntityBinding>();
  readonly #simulationBindings = new Map<number, MissionEntityBinding>();
  readonly #pendingReservations: CampaignReservation[] = [];
  #pendingProduction: number | undefined;
  #pendingConstruction: number | undefined;
  readonly #detachedIds = new Set<number>();
  #missionDiagnostic: string | undefined;
  #resourceDiagnostic: string | undefined;
  #outcome: { resultCode: number; reasonCode: number; ready: boolean } | null = null;
  #latestMessage = "";
  #carriers: readonly { slot: number; generation: number; team: number; phase: string;
    sprite: string; position: { x: number; y: number }; height: number }[] = [];
  readonly #selectedIds = new Set<number>();
  readonly #unitStats = new Map<number, LegacyUnitStat>();
  readonly #unitWeaponIds = new Map<number, number>();
  readonly #unitTeams = new Map<number, number>();
  // DC.EXE 4148b0 skips the ordinary update of state-1 contact objects until they join.
  #contactDormant: Set<number> | undefined;

  // DC.EXE 4140dc requests sound index 3 (EAX=3, EDX=7) for both join and pickup: SLIST XTR 3 -> sound 5.
  // Frames may run in an audio-less candidate view, so contacts are counted there and played once after commit.
  #contactSounds = 0;

  #emitContactSound(source: MissionView): void {
    if (!source.#contactSounds) return;
    source.#contactSounds = 0;
    if (!this.#audio) return;
    const soundId = legacyCueCatalog.bindings.find(({ id, group }) => id === 3 && group === "XTR")?.soundIds[0];
    const sound = legacyCueCatalog.sounds.find(({ id }) => id === soundId);
    if (soundId !== 5 || sound?.source !== "SOUND/CAPTURE.WAV") throw new Error("Missing source XTR 3 contact sound 5");
    void this.#audio.play({ assetId: sound.source, priority: 40 });
  }

  #contactDormantIds(world: Pick<CampaignWorld, "entities"> & Partial<Pick<CampaignWorld, "entityBytes">>): Set<number> {
    const bytes = world.entityBytes;
    if (!bytes) return new Set();
    return new Set(world.entities.flatMap(entity => {
      if (entity.rawSlot === null || bytes[entity.rawSlot * 220 + CONTACT_PICKUP_STATE_OFFSET] !== CONTACT_JOIN) return [];
      const binding = this.#nativeBindings.get(`${entity.rawSlot}:${entity.generation}`);
      return binding ? [binding.simulationId] : [];
    }));
  }
  readonly #staticObjects: StaticMissionObject[] = [];
  readonly #visuals = new Map<string, MissionVisual>();
  readonly #waypointRoutes = new Map<
    number,
    { readonly points: readonly { readonly x: number; readonly y: number }[]; nextIndex: number; repeat?: boolean; engage?: boolean }
  >();
  #orderMode: "context" | "move" | "assault" | "patrol" | "waypoints" = "context";
  #movementStance: "move" | "assault" = "assault";
  #waypointDraft: { points: { x: number; y: number }[]; engage: boolean } | null = null;
  #combatMovement = new CombatMovementOrders();
  #guardAttacks = new GuardAttackOrders();
  readonly #combatReveals = new Map<number, { team: number; expiresAt: number }>();
  readonly #recordedDeaths = new Set<number>();
  readonly #audio?: WebAudioManager;
  readonly #audioFeedback?: MissionAudioFeedback;
  readonly #animationStates = new Map<number, { action: FinAction; facing: CompassDirection; since: number }>();
  readonly #visualBounds = new Map<number, FinBodyBounds>();
  #genericPendingPaths?: { simulation: DeterministicSimulation; tick: number; ids: ReadonlySet<number> };
  #terrainImage: HTMLImageElement | null = null;
  #indexedTerrain: Awaited<ReturnType<typeof createMissionTerrain>> | null = null;
  #terrainCache: { canvas: HTMLCanvasElement; key: string; cameraKey: string; owner: object;
    pendingKey: string | null; pendingFrames: number } | null = null;
  #terrainFallback: string | null = null;
  #spritePalettes: Awaited<ReturnType<typeof createMissionSpritePalettes>> | null = null;
  #disposed = false;
  #previousSnapshot: SimulationSnapshot;
  #interpolation = 0;
  #lastTime: number | null = null;
  #cameraX = 0;
  #cameraY = 0;
  #awaitingPlayerFocus = false;
  #tileSize = 32;
  readonly #explored: Uint8Array;

  constructor(
    canvas: HTMLCanvasElement,
    stage: HTMLElement,
    callbacks: SkirmishCallbacks,
    mission: SourceNativeCombatMission & SourceBrowserCampaignMission,
    audio?: WebAudioManager,
    stagedFrom?: MissionView,
    researchPolicy: "adapted-original-cursor-v1" | null = "adapted-original-cursor-v1",
  ) {
    this.canvas = canvas;
    this.stage = stage;
    this.callbacks = callbacks;
    this.mission = mission;
    this.#audio = audio;
    this.#audioFeedback = createMissionAudioFeedback(audio, Boolean(mission.sourceNativeCombat));
    this.playerFaction = mission.faction;
    const nativeCombatOptions = sourceNativeCombatSessionOptions(mission);
    this.#nativeVisibilityConfiguration = nativeCombatOptions?.nativeCombat.visibility;
    if (this.#nativeVisibilityConfiguration) validateSourceNativeVisibilityHostConfiguration(this.#nativeVisibilityConfiguration);
    const constructionSources = sourceConstructionSources(mission);
    if (stagedFrom) {
      this.#visuals = stagedFrom.#visuals;
      this.#explored = new Uint8Array(stagedFrom.#explored.length);
      this.#simulation = stagedFrom.#simulation;
      this.#session = stagedFrom.#session;
      this.#previousSnapshot = stagedFrom.#previousSnapshot;
      this.#commitRuntime(stagedFrom);
      this.#simulation = stagedFrom.simulation.fork();
      this.#session = stagedFrom.#session?.fork() ?? null;
      this.#combatMovement = CombatMovementOrders.restore(stagedFrom.#combatMovement.checkpoint());
      this.#guardAttacks = GuardAttackOrders.restore(stagedFrom.#guardAttacks.checkpoint());
      if (stagedFrom.#browserEconomy) {
        const saved = stagedFrom.#browserEconomy.checkpoint();
        this.#browserEconomy = new BrowserCampaignEconomy(mission.browserEconomy!, this.simulation, saved.bindings, saved);
      }
      return;
    }
    const grid = new NavigationGrid(
      mission.map.width,
      mission.map.height,
      Uint16Array.from(createLegacyInfantryFamilyMask({ ...mission.map, pathGrid: mission.pathGrid })),
    );
    this.#explored = new Uint8Array(mission.map.width * mission.map.height);
    this.#simulation = new DeterministicSimulation(grid, {
      seed: 0xdc1997,
      dayNightCycleTicks: 12_000,
      sourceDayNightHeader: mission.scenario.rawHeader,
      teamAlliances: mission.scenario.teams.map(({ allies }) => allies),
      initialResources: { [mission.faction]: mission.scenario.teams[0]?.money ?? 0 },
    });
    const random = new DeterministicRandom(MISSION_BROWSER_POLICY.seed);
    const { rawScenario: _rawScenario, ...source } = mission.scenario;
    const adapted = mission.runtimeProfile === "browser-adapted";
    const providedResearch = mission.browserResearch ?? legacyResearchConfigurations.get(mission);
    if (providedResearch) validateBrowserResearchConfiguration(source, providedResearch);
    if (adapted && (!mission.browserAi || !mission.browserEconomy || nativeCombatOptions || constructionSources)) {
      throw new TypeError("Browser-adapted view requires prepared AI/economy and excludes native owners");
    }
    const preflight = campaignPreflight(mission.scenario, adapted ? [] : mission.triggers);
    const result = preflight.length ? { ok: false as const, diagnostics: preflight } : createCampaignSession(
      adapted ? sourceBrowserCampaignSessionOptions(mission) : nativeCombatOptions ?? {
      sessionId: `${mission.scenario.id}:browser`, source,
      units: mission.units, weapons: mission.weapons, triggers: mission.triggers, messages: mission.messages,
      map: mission.map, pathGrid: mission.pathGrid, tags: mission.tags,
      commanders: mission.faction === "human" ? [{ team: 0, unitType: 69, sprite: "TRSC" }]
        : [{ team: 0, unitType: 73, sprite: "GRAY" }, { team: 1, unitType: 69, sprite: "TRSC" }],
      directionBits: Array.from({ length: 256 }, () => [random.nextInt(2) as 0 | 1, random.nextInt(2) as 0 | 1] as const),
      fixedStepMilliseconds: MISSION_BROWSER_POLICY.fixedStepMilliseconds,
      orientationSteps: MISSION_BROWSER_POLICY.orientationSteps,
      ...(mission.sourceResource ? {
        resourceScales: mission.sourceResource.resourceScales,
        resourceLifecycle: mission.sourceResource.resourceLifecycle,
        resourceInitialIncome: mission.sourceResource.resourceInitialIncome,
      } : {}),
      ...(mission.sourceProduction?.production ? { production: { ...mission.sourceProduction.production,
        ...(constructionSources ? { constructionSources } : {}) } } : {}),
      ...(mission.sourceConstruction?.campaignAi ? { campaignAi: mission.sourceConstruction.campaignAi } : {}),
    });
    this.#session = result.ok ? result.value : null;
    try {
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      const initial = result.value.snapshot;
      if (adapted && researchPolicy && initial.world.scenarioMarkers?.length) {
        this.#research = mission.browserResearch ?? legacyResearchConfigurations.get(mission) ?? createBrowserResearchConfiguration({ runtimeProfile: "browser-adapted",
          activation: "source-city-slot4-health", scienceOwner: "campaign-session-city", source,
          units: mission.units, dependencies: mission.sourceProduction?.production?.records ?? [] });
        observeBrowserResearch(initial.world, this.#research, this.#research.scienceOwner);
        projectBrowserType37Presentation(initial.world, this.#research);
      }
      const host = transportHostState(initial.world);
      for (const entity of initial.world.entities) this.#registerEntity(entity, initial.world,
        entity.rawSlot === null ? undefined : host.slots[entity.rawSlot] ?? undefined);
      if (adapted) {
        this.#type37World = initial.world.scenarioMarkers?.length ? initial.world : undefined;
        this.#browserAi = initializeBrowserCampaignView(result.value.browserAiProjection!, mission.browserAi!);
        this.#browserEconomy = new BrowserCampaignEconomy(mission.browserEconomy!, this.simulation,
          mission.browserEconomy!.harvesters.map(actor => ({ key: actor.key,
            simulationId: this.#nativeBindings.get(`${actor.slot}:${actor.generation}`)!.simulationId })));
      }
      if (nativeCombatOptions) {
        this.#nativeViewState = result.value.nativeViewProjection;
        if (this.#nativeVisibilityConfiguration) this.#recordExploration();
      }
    } catch (error) { this.#failMission(error); }
    const playerUnits = this.simulation.snapshot.units.filter(({ id }) => this.#unitTeams.get(id) === 0);
    const focus = playerUnits.length > 0
      ? playerUnits
      : this.#staticObjects
          .filter(({ entity }) => entity.team === 0)
          .map(({ entity }, id) => ({ id, cellX: entity.x, cellY: entity.y }));
    this.#cameraX = focus.reduce((sum, unit) => sum + unit.cellX, 0) / Math.max(1, focus.length);
    this.#cameraY = focus.reduce((sum, unit) => sum + unit.cellY, 0) / Math.max(1, focus.length);
    // Widely separated starting groups (e.g. ALIEN09) put the centroid on empty fogged ground; start on the largest group instead.
    const inView = (unit: { cellX: number; cellY: number }, x: number, y: number) => Math.abs(unit.cellX - x) <= 8 && Math.abs(unit.cellY - y) <= 7;
    if (focus.length > 0 && !focus.some(unit => inView(unit, this.#cameraX, this.#cameraY))) {
      const group = focus.map(anchor => focus.filter(unit => inView(unit, anchor.cellX, anchor.cellY)))
        .reduce((best, candidate) => candidate.length > best.length ? candidate : best);
      this.#cameraX = group.reduce((sum, unit) => sum + unit.cellX, 0) / group.length;
      this.#cameraY = group.reduce((sum, unit) => sum + unit.cellY, 0) / group.length;
    }
    this.#awaitingPlayerFocus = focus.length === 0;
    this.#previousSnapshot = this.simulation.snapshot;
    if (nativeCombatOptions && !this.#missionDiagnostic) this.#nativeCombatProjection = canonicalSource(this.simulation.checkpoint());
  }

  checkpoint(): MissionViewCheckpoint {
    requireCheckpoint(!this.#disposed, "disposed view");
    this.#assertNativeCombatProjection();
    return structuredClone({ version: this.mission.sourceResource?.resourceLifecycle.nativeHarvest ? 2 : 1, kind: "mission-view", sourceIdentity: canonicalSource(this.mission),
      simulation: this.simulation.checkpoint(), session: this.#session?.checkpoint() ?? null,
      ...(this.#research && this.#type37World ? { research: { presentationPolicy: "adapted-original-cursor-v1" as const,
        state: observeBrowserResearch(this.#type37World, this.#research, this.#research.scienceOwner) } } : {}),
      ...(this.#browserAi ? { browserAi: this.#browserAi } : {}),
      ...(this.#browserEconomy ? { economy: this.#browserEconomy.checkpoint() } : {}),
      ...(this.#guardAttacks.checkpoint().length ? { guardAttacks: this.#guardAttacks.checkpoint() } : {}),
      combatMovement: this.#combatMovement.checkpoint(), state: {
        bindings: this.nativeBindings.map((binding) => ({ ...binding })),
        unitStats: [...this.#unitStats].map(([id, stat]) => ({ id, type: stat.index })),
        unitWeapons: [...this.#unitWeaponIds].map(([id, weapon]) => ({ id, weapon })),
        unitTeams: [...this.#unitTeams].map(([id, team]) => ({ id, team })),
        staticObjects: this.#staticObjects.map(({ id, stat, entity }) => ({ id, type: stat.index, entity })),
        selectedIds: [...this.#selectedIds],
        routes: [...this.#waypointRoutes].map(([id, route]) => ({ id, ...route, points: route.points.map((point) => ({ ...point })) })),
        orderMode: this.#orderMode, movementStance: this.#movementStance, waypointDraft: this.#waypointDraft,
        pendingReservations: this.#pendingReservations, detachedIds: [...this.#detachedIds], recordedDeaths: [...this.#recordedDeaths],
        ...(this.#pendingProduction !== undefined ? { pendingProduction: this.#pendingProduction } : {}),
        ...(this.#pendingConstruction !== undefined ? { pendingConstruction: this.#pendingConstruction } : {}),
        ...(this.#resourceDiagnostic !== undefined ? { resourceDiagnostic: this.#resourceDiagnostic } : {}),
        ...(this.#pendingNativeCommand ? { nativeCommand: this.#pendingNativeCommand } : {}),
        ...(this.#combatReveals.size ? { combatReveals: [...this.#combatReveals].map(([id, reveal]) => ({ id, ...reveal })) } : {}),
        explored: Array.from(this.#explored), camera: { x: this.#cameraX, y: this.#cameraY, awaitingPlayerFocus: this.#awaitingPlayerFocus },
        latestMessage: this.#latestMessage, carriers: this.carrierVisuals, outcome: this.#outcome, diagnostic: this.#missionDiagnostic ?? null,
        animationStates: [...this.#animationStates].map(([id, state]) => ({ id, ...state })),
      } });
  }

  static #authenticateCheckpoint(canvas: HTMLCanvasElement, stage: HTMLElement, callbacks: SkirmishCallbacks,
    mission: SourceNativeCombatMission & SourceBrowserCampaignMission, checkpoint: unknown, audio?: WebAudioManager) {
    requireCheckpointJson(checkpoint);
    const savedOptions = (checkpoint as MissionViewCheckpoint | null)?.session?.options;
    const researchConfiguration = mission.browserResearch ?? legacyResearchConfigurations.get(mission);
    if (researchConfiguration) {
      const { rawScenario: _rawScenario, ...source } = mission.scenario;
      validateBrowserResearchConfiguration(source, researchConfiguration);
    }
    if (mission.runtimeProfile === "browser-adapted" && savedOptions?.runtimeProfile === "browser-adapted" &&
      savedOptions.production && !Object.hasOwn(savedOptions.production, "adaptedUnitProfiles") &&
      mission.sourceProduction?.production?.adaptedUnitProfiles !== undefined) {
      const { adaptedUnitProfiles: _adaptedUnitProfiles, ...production } = mission.sourceProduction.production;
      mission = { ...mission, sourceProduction: { ...mission.sourceProduction, production } };
    }
    if (mission.runtimeProfile === "browser-adapted" && savedOptions?.runtimeProfile === "browser-adapted" &&
      savedOptions.production && !Object.hasOwn(savedOptions.production, "adaptedUpgrades") &&
      mission.sourceProduction?.production?.adaptedUpgrades !== undefined) {
      const { adaptedUpgrades: _adaptedUpgrades, ...production } = mission.sourceProduction.production;
      mission = { ...mission, sourceProduction: { ...mission.sourceProduction, production } };
    }
    if (mission.runtimeProfile === "browser-adapted" && mission.browserResearch !== undefined) {
      const { browserResearch: _browserResearch, ...legacyMission } = mission;
      if ((checkpoint as MissionViewCheckpoint | null)?.sourceIdentity === canonicalSource(legacyMission)) {
        mission = legacyMission;
      }
    }
    validateViewCheckpoint(checkpoint, mission);
    if (researchConfiguration && mission.browserResearch === undefined) {
      legacyResearchConfigurations.set(mission, researchConfiguration);
    }
    const saved = structuredClone(checkpoint);
    const view = new MissionView(canvas, stage, callbacks, mission, audio, undefined, saved.research?.presentationPolicy ?? null);
    try {
      requireCheckpoint(canonicalSource(saved.session?.options ?? null) === canonicalSource(view.#session?.checkpoint().options ?? null), "session source/options");
      return { mission, saved, view };
    } catch (error) {
      view.dispose();
      throw error;
    }
  }

  static importLegacy(canvas: HTMLCanvasElement, stage: HTMLElement, callbacks: SkirmishCallbacks,
    mission: SourceNativeCombatMission & SourceBrowserCampaignMission, checkpoint: unknown,
    consent: LegacyCampaignImportConsent, audio?: WebAudioManager) {
    const authenticated = MissionView.#authenticateCheckpoint(canvas, stage, callbacks, mission, checkpoint, audio);
    try {
      requireCheckpoint(authenticated.saved.session !== null, "legacy import requires a session");
      const imported = CampaignSession.importLegacy(authenticated.saved.session, consent);
      const view = MissionView.restore(canvas, stage, callbacks, authenticated.mission,
        { ...authenticated.saved, session: imported.checkpoint }, audio);
      return { view, checkpoint: view.checkpoint(), notice: imported.notice, differences: imported.differences };
    } finally {
      authenticated.view.dispose();
    }
  }

  static restore(canvas: HTMLCanvasElement, stage: HTMLElement, callbacks: SkirmishCallbacks,
    mission: SourceNativeCombatMission & SourceBrowserCampaignMission, checkpoint: unknown, audio?: WebAudioManager): MissionView {
    const authenticated = MissionView.#authenticateCheckpoint(canvas, stage, callbacks, mission, checkpoint, audio);
    mission = authenticated.mission;
    const { saved, view } = authenticated;
    try {
    const simulation = DeterministicSimulation.restore(saved.simulation);
    requireCheckpoint(simulation.resourceActors.length === 0 || mission.sourceResource?.resourceLifecycle.nativeHarvest,
      "resource external owners require an admitted native movement/idle view adapter");
    const combatMovement = CombatMovementOrders.restore(saved.combatMovement);
    const guardAttacks = GuardAttackOrders.restore(saved.guardAttacks ?? []);
    const nativeCombatOptions = sourceNativeCombatSessionOptions(mission);
    if (nativeCombatOptions && saved.session) {
      const host = saved.session.state.world.transportState;
      for (const entry of [...saved.simulation.units, ...saved.simulation.staticTargets]) {
        const binding = saved.state.bindings.find(binding => binding.simulationId === entry.id);
        const actor = binding && host.slots[binding.slot];
        requireCheckpoint(actor && actor.key === binding?.key && actor.generation === binding.generation &&
          actor.status !== 0 && entry.health === Math.max(0, actor.health), "native combat projection health");
      }
    }
    const session = saved.session === null ? null : CampaignSession.restore(saved.session,
      mission.sourceConstruction?.campaignAi, nativeCombatOptions?.nativeAiTasks, sourceConstructionSources(mission), nativeCombatOptions?.nativeCombat,
      undefined, mission.browserConstruction);
    if (mission.runtimeProfile === "browser-adapted") requireCheckpoint(
      canonicalSource(saved.simulation.teamAlliances) === canonicalSource(session?.adaptedTroProjection?.teamAlliances),
      "runtime alliance projection");
    const state = saved.state, snapshot = simulation.snapshot;
    requireCheckpoint(Boolean(saved.browserAi) === (mission.runtimeProfile === "browser-adapted") &&
      Boolean(saved.economy) === (mission.runtimeProfile === "browser-adapted"), "browser profile owners");
    if (saved.browserAi && saved.economy) {
      requireCheckpoint(session?.browserAiProjection && mission.browserAi && mission.browserEconomy, "browser source configuration");
      view.#browserAi = restoreBrowserCampaignView(session.browserAiProjection, mission.browserAi, saved.browserAi);
      requireCheckpoint(saved.browserAi.sourceCycle === snapshot.tick &&
        saved.browserAi.strategy.lastTick === snapshot.tick - 1, "browser AI frame boundary");
      view.#browserEconomy = new BrowserCampaignEconomy(mission.browserEconomy, simulation, saved.economy.bindings, saved.economy);
      requireCheckpoint(mission.browserEconomy.nodes.every(node =>
        saved.economy!.rates[node.key] === session.snapshot.world.entities.find(entity => entity.key === node.key)?.resource?.rateWord),
      "browser economy source rates");
      const ledger = session.snapshot.browserEconomyLedger;
      requireCheckpoint(ledger && Object.entries(saved.economy.earned).every(([team, earned]) =>
        (ledger.earned[Number(team)] ?? 0) <= earned), "browser economy ledger boundary");
      for (const actor of saved.economy.harvesters) {
        const entity = session.snapshot.world.entities.find(entity => entity.key === actor.key);
        const binding = state.bindings.find(binding => binding.key === actor.key);
        const stat = mission.units.find(stat => stat.index === actor.typeId);
        requireCheckpoint(entity && binding && stat && entity.rawSlot === actor.slot && entity.generation === actor.generation &&
          entity.unitType === actor.typeId && entity.team === actor.team && actor.options.maxHealth === entity.maxHealth &&
          actor.options.speedSubcellsPerTick === stat.movementSpeed * SUBCELLS_PER_CELL / 256 &&
          saved.economy.bindings.some(savedBinding => savedBinding.key === actor.key && savedBinding.simulationId === binding.simulationId),
        "browser economy source actor");
      }
      for (const actor of saved.economy.incomeInterception?.deployments ?? []) {
        const binding = state.bindings.find(entry => entry.simulationId === actor.simulationId);
        const entity = session.snapshot.world.entities.find(entry => entry.key === actor.key);
        const unit = snapshot.units.find(entry => entry.id === actor.simulationId);
        requireCheckpoint(binding && entity && unit && INTERCEPTOR_TYPES.has(entity.unitType) && entity.team === actor.team
          && entity.rawSlot === actor.slot && entity.generation === actor.generation
          && binding.key === actor.key && binding.slot === actor.slot && binding.generation === actor.generation
          && unit.team === actor.team && unit.health > 0 && unit.movementPlane !== "air"
          && state.unitStats.some(entry => entry.id === unit.id && entry.type === entity.unitType)
          && actor.xSubcells === unit.xSubcells && actor.ySubcells === unit.ySubcells,
        "browser deployment source actor");
        if (actor.partner) requireCheckpoint(actor.partner.acquiredTick <= snapshot.tick
          && actor.partner.cell < mission.map.width * mission.map.height
          && saved.economy.harvesters.some(entry => entry.key === actor.partner!.key
            && (entry.typeId === 6 ? 47 : 48) === actor.partner!.currentType)
          && saved.economy.bindings.some(entry => entry.key === actor.partner!.key
            && entry.simulationId === actor.partner!.simulationId), "browser deployment partner identity");
      }
      for (const entry of saved.economy.incomeInterception?.ledger ?? []) {
        const binding = state.bindings.find(actor => actor.key === entry.interceptorKey
          && actor.slot === entry.interceptorSlot && actor.generation === entry.interceptorGeneration);
        requireCheckpoint(binding && state.unitStats.some(actor => actor.id === binding.simulationId && INTERCEPTOR_TYPES.has(actor.type)),
          "browser interception historical source actor");
      }
    }
    requireCheckpoint(simulation.grid.width === mission.map.width && simulation.grid.height === mission.map.height, "map dimensions");
    requireCheckpoint(state.explored.length === mission.map.width * mission.map.height, "exploration dimensions");
    requireCheckpoint(session !== null || state.diagnostic !== null, "missing session");
    requireCheckpoint(state.diagnostic !== null || session?.snapshot.cycleCounter === snapshot.tick, "session/simulation tick");
    if (state.diagnostic === null && mission.sourceResource && !saved.economy) requireCheckpoint(
      canonicalSource(simulation.sourceDayNight) === canonicalSource(session?.snapshot.sourceDayNight), "resource simulation/session source clock");
    const unique = <Entry, Key>(entries: readonly Entry[], key: (entry: Entry) => Key): Map<Key, Entry> => {
      const result = new Map(entries.map((entry) => [key(entry), entry]));
      requireCheckpoint(result.size === entries.length, "duplicate identity");
      return result;
    };
    const bindings = unique(state.bindings, (binding) => binding.simulationId);
    unique(state.bindings, ({ slot, generation }) => `${slot}:${generation}`);
    unique(state.bindings, ({ key }) => key);
    const stats = unique(state.unitStats, ({ id }) => id), teams = unique(state.unitTeams, ({ id }) => id);
    const weapons = unique(state.unitWeapons, ({ id }) => id), statics = unique(state.staticObjects, ({ id }) => id);
    const selected = unique(state.selectedIds, (id) => id), detached = unique(state.detachedIds, (id) => id);
    const deaths = unique(state.recordedDeaths, (id) => id);
    unique(state.routes, ({ id }) => id);
    unique(state.animationStates, ({ id }) => id);
    const historicalId = (id: number) => requireCheckpoint(id < saved.simulation.nextEntityId, "unknown simulation ID");
    const bound = (id: number) => { historicalId(id); requireCheckpoint(bindings.has(id), "missing binding"); };
    const sourceStats = new Map(mission.units.map((stat) => [stat.index, stat]));
    requireCheckpoint(stats.size === bindings.size && teams.size === bindings.size, "incomplete unit maps");
    const restoredSession = session?.snapshot;
    const world = restoredSession?.world;
    view.#type37World = mission.runtimeProfile === "browser-adapted" && world?.scenarioMarkers?.length ? world : undefined;
    if (saved.research) {
      requireCheckpoint(view.#research && view.#type37World, "research profile owner");
      restoreBrowserResearch(view.#type37World, view.#research, saved.research.state);
      projectBrowserType37Presentation(view.#type37World, view.#research);
    }
    const identities = new Map(view.#session?.snapshot.world.entities.map((entity) => [`${entity.rawSlot}:${entity.generation}`, entity]));
    const sourceDeaths = new Set<string>(), sourceDetachments = new Set<string>();
    for (const request of session?.identityProvenance ?? []) {
      const identity = `${request.slot}:${request.generation}`;
      if (request.type === "create") identities.set(identity, { key: `transport:${identity}`, rawSlot: request.slot,
        generation: request.generation, sourceRow: null, team: request.team, unitType: request.unitType,
        tileX: Math.floor(request.position.x / 256), tileY: Math.floor(request.position.y / 256), rawTail: [],
        health: 1, maxHealth: 1, simulationId: null });
      if (request.type === "combat-death") sourceDeaths.add(identity);
      if (request.type === "remove-noncombat" || request.type === "clear-collision" || request.type === "unregister") sourceDetachments.add(identity);
    }
    for (const entity of world?.entities ?? []) identities.set(`${entity.rawSlot}:${entity.generation}`, entity);
    const bindingKeys = new Set(state.bindings.map(({ slot, generation }) => `${slot}:${generation}`));
    if (state.diagnostic === null) for (const entity of world?.entities ?? []) {
      if (mission.runtimeProfile === "browser-adapted" && world &&
        (view.#research && isBrowserScenarioMarker(entity, world)
          || browserScenarioMarkerPresentation(entity, world) === "excluded-native-spy-gate")) continue;
      if (entity.unitType === 40 && entity.team === 8 && !saved.economy) continue;
      if (sourceConstructionSources(mission)?.some(source => entity.rawSlot === source.team * 15 + 6)) continue;
      if (entity.health > 0) requireCheckpoint(bindingKeys.has(`${entity.rawSlot}:${entity.generation}`), "unbound source entity");
    }
    const sourceCosts = createLegacyInfantryFamilyMask({ ...mission.map, pathGrid: mission.pathGrid });
    const blockers = new Map(saved.simulation.staticBlockers.map((blocker) => [blocker.index, blocker]));
    for (let index = 0; index < sourceCosts.length; index += 1) requireCheckpoint(
      (blockers.get(index)?.priorCost ?? saved.simulation.grid.costs[index]) === sourceCosts[index], "source navigation cost");
    for (const [id, binding] of bindings) {
      historicalId(id);
      const stat = sourceStats.get(stats.get(id)?.type ?? -1);
      requireCheckpoint(stat && teams.has(id), "source unit metadata");
      const identity = `${binding.slot}:${binding.generation}`;
      const entity = identities.get(identity);
      const resourceActor = simulation.resourceActors.find(actor => actor.simulationId === id);
      requireCheckpoint(entity && entity.key === binding.key && entity.sourceRow === binding.sourceRow &&
        (entity.unitType === stat.index || (resourceActor?.owner === "removed" && resourceActor.profile.sourceTypeIndex === stat.index
          && [6, 47].includes(entity.unitType) === [6, 47].includes(stat.index))) && entity.team === teams.get(id)!.team, "source binding identity");
      if (state.diagnostic === null) {
        requireCheckpoint(deaths.has(id) === sourceDeaths.has(identity), "recorded death boundary");
        requireCheckpoint(detached.has(id) === (sourceDetachments.has(identity)
          && !(resourceActor?.profile.task === "removal" && resourceActor.owner !== "removed")), "detachment boundary");
      }
      const simulated = [...snapshot.units, ...snapshot.staticTargets].find((entry) => entry.id === id);
      requireCheckpoint(simulated || detached.has(id) || deaths.has(id), "missing simulated entity");
      if (simulated) requireCheckpoint(simulated.team === entity.team &&
        simulated.faction === (entity.team === 8 ? mission.faction : mission.scenario.teams[entity.team].race === 1 ? "alien" : "human"), "simulation team");
      requireCheckpoint(statics.has(id) === (stat.movementSpeed === 0 && !resourceActor && !(detached.has(id)
        && mission.runtimeProfile === "browser-adapted" && !simulated)), "static binding");
      if (resourceActor) {
        const record = world && transportHostState(world).slots[binding.slot];
        requireCheckpoint(record?.resourceTask && canonicalSource(resourceActor.profile.taskOwner.state) === canonicalSource(record.resourceTask)
          && resourceActor.profile.xQ8 === record.position.x && resourceActor.profile.yQ8 === record.position.y
          && resourceActor.profile.health === record.health && weapons.get(id)?.weapon === -1,
        "native resource view/session/simulation ownership");
      } else if (stat.movementSpeed !== 0) {
        const unit = saved.simulation.units.find(unit => unit.id === id);
        if (unit && mission.runtimeProfile === "browser-adapted" && browserExcavationArtifact(stat, mission.weapons)) {
          requireCheckpoint(unit.weapon == null, "source excavation artifact has no ordinary direct fire");
        }
        if (unit) requireCheckpoint((unit.movementPlane ?? "ground") === browserMovementPlane(mission, stat), "source movement plane");
        const levels = currentUpgradeLevels(mission, restoredSession?.production, entity.team, stat.index);
        requireCheckpoint(weapons.get(id)?.weapon === stat.weapons[levels.weaponLevel], "current weapon");
        if (unit && sourceProductionUpgradeLevels(restoredSession?.production, entity.team, stat.index)) {
          const equipment = upgradedEquipment(mission, stat, levels);
          requireCheckpoint(canonicalSource(unit.weapon) === canonicalSource(equipment.weapon)
            && canonicalSource(unit.sourceDefense) === canonicalSource(equipment.sourceDefense), "current upgrade equipment");
        }
      } else {
        const levels = currentUpgradeLevels(mission, restoredSession?.production, entity.team, stat.index);
        const weapon = browserStaticWeapon(mission, stat, levels.weaponLevel);
        const mine = browserMineOptions(mission, stat);
        const target = saved.simulation.staticTargets.find(target => target.id === id);
        if (target && mission.runtimeProfile === "browser-adapted" && entity.unitType === 40 && entity.team === 8) {
          requireCheckpoint(target.footprint.length === 0 || (target.footprint.length === 1
            && target.footprint[0] === entity.tileY * simulation.grid.width + entity.tileX), "source vent footprint");
        }
        if (target && sourceProductionUpgradeLevels(restoredSession?.production, entity.team, stat.index)) {
          requireCheckpoint(canonicalSource(target.sourceDefense) === canonicalSource(defenseOptionsFromLegacy(stat, levels.armorLevel)),
            "current static upgrade defense");
        }
        requireCheckpoint(canonicalSource(target?.mine) === canonicalSource(mine), "static mine source policy");
        requireCheckpoint(weapon ? weapons.get(id)?.weapon === stat.weapons[levels.weaponLevel]
          && canonicalSource(target?.weapon) === canonicalSource(weapon)
          && canonicalSource(target?.vision) === canonicalSource({ dayRangeCells: stat.observationDay, nightRangeCells: stat.observationNight })
          : (mine ? weapons.get(id)?.weapon === mine.weaponId : !weapons.has(id)) && target?.weapon === undefined, "static weapon");
      }
    }
    for (const entry of [...state.unitStats, ...state.unitWeapons, ...state.unitTeams, ...state.staticObjects]) bound(entry.id);
    for (const entity of [...snapshot.units, ...snapshot.staticTargets]) bound(entity.id);
    for (const id of [...selected.keys(), ...detached.keys(), ...deaths.keys()]) bound(id);
    for (const id of selected.keys()) requireCheckpoint(teams.get(id)?.team === 0 &&
      snapshot.units.some((unit) => unit.id === id && unit.activity !== "die"), "selection");
    for (const id of detached.keys()) requireCheckpoint(!snapshot.units.some((unit) => unit.id === id), "detached unit");
    for (const object of state.staticObjects) {
      requireCheckpoint(object.type === stats.get(object.id)?.type && sourceStats.has(object.entity.unitType) &&
        object.entity.team === teams.get(object.id)?.team, "static metadata");
      const target = snapshot.staticTargets.find(({ id }) => id === object.id);
      if (target) requireCheckpoint((object.entity.x + 0.5) * SUBCELLS_PER_CELL === target.xSubcells &&
        (object.entity.y + 0.5) * SUBCELLS_PER_CELL === target.ySubcells, "static position");
    }
    for (const route of state.routes) { bound(route.id); requireCheckpoint(route.nextIndex <= route.points.length, "waypoint cursor"); }
    requireCheckpoint(state.waypointDraft === null || (state.orderMode === "waypoints" && state.waypointDraft.points.length > 0), "waypoint draft");
    for (const animation of state.animationStates) { historicalId(animation.id); requireCheckpoint(animation.since <= snapshot.tick, "animation time"); }
    for (const { id, intent } of saved.combatMovement.intents) {
      bound(id); requireCheckpoint(simulation.grid.contains(intent.target.x, intent.target.y), "movement destination");
    }
    for (const id of saved.combatMovement.pendingManual) bound(id);
    for (const { id, targetId } of guardAttacks.checkpoint()) {
      bound(id); historicalId(targetId);
      requireCheckpoint(!simulation.resourceActors.some(actor => actor.simulationId === id), "external guard owner");
    }
    const revealedIds = new Set<number>();
    for (const reveal of state.combatReveals ?? []) {
      bound(reveal.id);
      const actor = [...snapshot.units, ...snapshot.staticTargets].find(actor => actor.id === reveal.id);
      requireCheckpoint(!nativeCombatOptions && !revealedIds.has(reveal.id) && actor && actor.health > 0 &&
        reveal.expiresAt > snapshot.tick && reveal.expiresAt <= snapshot.tick + 31, "combat reveal");
      revealedIds.add(reveal.id);
    }
    for (const reservation of state.pendingReservations) requireCheckpoint(state.bindings.some((binding) =>
      binding.slot === reservation.slot && binding.generation === reservation.generation && !detached.has(binding.simulationId)), "pending reservation");
    if (world && session!.snapshot.cycleCounter > 0 && state.diagnostic === null) {
      const host = transportHostState(world);
      const carriers = host.reducer.carriers.filter(({ phase }) => phase !== "released").map((carrier) => {
        const slot = host.slots[carrier.slot];
        requireCheckpoint(slot, "carrier slot");
        return { slot: carrier.slot, generation: slot.generation, team: carrier.team, phase: carrier.phase,
          sprite: carrier.type === 92 ? "DROP" : "SAUC", position: slot.position, height: slot.height };
      });
      requireCheckpoint(canonicalSource(state.carriers) === canonicalSource(carriers), "cached carriers");
      requireCheckpoint(state.latestMessage === (world.messages.at(-1)?.text ?? ""), "cached message");
      const bail = session!.snapshot.controller.runtime.bail;
      const expired = missionBailDeadlineExceeded(bail, world.clockMilliseconds);
      requireCheckpoint(expired.ok, "outcome clock");
      requireCheckpoint(canonicalSource(state.outcome) === canonicalSource(bail ? {
        resultCode: bail.resultCode, reasonCode: bail.reasonCode, ready: expired.value,
      } : null), "cached outcome");
    }
    if (nativeCombatOptions) {
      requireCheckpoint(session && !state.diagnostic, "native combat session");
      const restoredWorld = session.snapshot.world;
      for (const request of session.identityProvenance) {
        if (request.type === "create") {
          const stat = sourceStats.get(request.unitType)!;
          const key = `transport:${request.slot}:${request.generation}`;
          const entity: CampaignEntity = { key, rawSlot: request.slot, generation: request.generation,
            sourceRow: null, team: request.team, unitType: request.unitType, rawTail: [], simulationId: null,
            tileX: request.position.x >>> 8, tileY: request.position.y >>> 8, health: stat.health, maxHealth: stat.health };
          view.#registerEntity(entity, restoredWorld, { slot: request.slot, generation: request.generation, key,
            team: request.team, unitType: request.unitType, health: stat.health, status: 1,
            position: request.position, height: 0, task: "idle", taskWords: [] });
        } else if (request.type === "unregister") {
          const binding = view.#nativeBindings.get(`${request.slot}:${request.generation}`);
          requireCheckpoint(binding && view.simulation.removeUnit(binding.simulationId), "native combat historical unregister");
        }
      }
      view.#nativeViewState = session.nativeViewProjection;
      view.#projectNativeCombat(view.#nativeViewState, view.#nativeViewState.transport);
      if (view.#nativeVisibilityConfiguration) {
        view.#recordExploration();
        requireCheckpoint(canonicalSource(Array.from(view.#explored)) === canonicalSource(state.explored), "native visibility exploration projection");
      }
      requireCheckpoint(canonicalSource(view.simulation.checkpoint()) === canonicalSource(saved.simulation), "native combat projection");
      requireCheckpoint(canonicalSource(view.nativeBindings) === canonicalSource(state.bindings), "native combat bindings");
      requireCheckpoint(state.routes.length === 0 && state.pendingReservations.length === 0 && !state.waypointDraft &&
        guardAttacks.checkpoint().length === 0 &&
        canonicalSource(saved.combatMovement) === canonicalSource(new CombatMovementOrders().checkpoint()), "native combat generic orders");
    }
    view.#simulation = simulation;
    view.#session = session;
    view.#cursorCache = null;
    if (session) {
      for (const slot of transportHostState(session.snapshot.world).slots) {
        if (slot) view.#sceneIdentities.set(slot.slot, { generation: slot.generation, height: slot.height });
      }
    }
    if (state.pendingProduction !== undefined) {
      requireCheckpoint(state.diagnostic === null && !state.outcome?.ready && view.productionMenu.some((choice) =>
        choice.dependency === state.pendingProduction && choice.maxAdditional > 0), "pending source purchase");
      view.#pendingProduction = state.pendingProduction;
    }
    if (state.pendingConstruction !== undefined) {
      requireCheckpoint(state.diagnostic === null && !state.outcome?.ready && view.constructionMenu.some(choice =>
        choice.dependency === state.pendingConstruction && choice.requestEnabled), "pending construction purchase");
      view.#pendingConstruction = state.pendingConstruction;
    }
    view.#combatMovement = combatMovement;
    view.#guardAttacks = guardAttacks;
    for (const { id, ...reveal } of state.combatReveals ?? []) view.#combatReveals.set(id, reveal);
    view.#nativeBindings.clear(); view.#simulationBindings.clear();
    for (const binding of state.bindings) {
      view.#nativeBindings.set(`${binding.slot}:${binding.generation}`, binding);
      view.#simulationBindings.set(binding.simulationId, binding);
    }
    view.#unitStats.clear(); view.#unitWeaponIds.clear(); view.#unitTeams.clear();
    for (const { id, type } of state.unitStats) view.#unitStats.set(id, sourceStats.get(type)!);
    for (const { id, weapon } of state.unitWeapons) view.#unitWeaponIds.set(id, weapon);
    for (const { id, team } of state.unitTeams) view.#unitTeams.set(id, team);
    view.#staticObjects.splice(0, view.#staticObjects.length, ...state.staticObjects.map(({ id, type, entity }) => ({ id, stat: sourceStats.get(type)!, entity })));
    view.#assertConstructionProjection();
    view.#selectedIds.clear();
    for (const id of state.selectedIds) view.#selectedIds.add(id);
    view.#waypointRoutes.clear();
    for (const { id, ...route } of state.routes) view.#waypointRoutes.set(id, route);
    view.#orderMode = state.orderMode; view.#movementStance = state.movementStance; view.#waypointDraft = state.waypointDraft;
    view.#pendingReservations.push(...state.pendingReservations);
    for (const id of state.detachedIds) view.#detachedIds.add(id);
    for (const id of state.recordedDeaths) view.#recordedDeaths.add(id);
    view.#explored.set(state.explored);
    view.#cameraX = state.camera.x; view.#cameraY = state.camera.y; view.#awaitingPlayerFocus = state.camera.awaitingPlayerFocus;
    view.#latestMessage = state.latestMessage; view.#carriers = state.carriers; view.#outcome = state.outcome;
    view.#missionDiagnostic = state.diagnostic ?? undefined;
    view.#resourceDiagnostic = state.resourceDiagnostic;
    if (state.nativeCommand) {
      requireCheckpoint(!state.diagnostic && !state.outcome?.ready, "inactive native command");
      view.#validateQueuedNativeCommand(state.nativeCommand);
      view.#pendingNativeCommand = structuredClone(state.nativeCommand);
    }
    for (const { id, ...animation } of state.animationStates) view.#animationStates.set(id, animation);
    view.#previousSnapshot = simulation.snapshot;
    view.#interpolation = 0;
    view.#audioFeedback?.reset(simulation.snapshot.tick);
    view.resetClock();
    return view;
    } catch (error) {
      view.dispose();
      throw error;
    }
  }

  async initializeNativeCombatPresentation(loadBytes?: (url: string) => Promise<Uint8Array>): Promise<void> {
    if (!this.mission.sourceNativeCombat || !this.#session || this.#disposed || this.#missionDiagnostic) {
      throw new TypeError("Native combat presentation requires an active source-bound view");
    }
    const presentation = await createSourceNativeCombatPresentation(this.mission, loadBytes);
    if (this.#disposed) return;
    const presentations = presentation(this.#session.snapshot.world);
    const projection = this.#session.nativeViewProjection;
    this.#nativeViewResources = { identity: nativeViewResourceIdentity(projection), presentations };
    this.#nativeViewState = projection;
    this.#nativeCombatPresentation = presentation;
  }

  async initialize(): Promise<void> {
    if (this.#disposed) return;
    try {
      if (!this.#missionDiagnostic) {
        if (this.mission.sourceNativeCombat) await this.initializeNativeCombatPresentation();
        this.#terrainImage = await loadImage(this.mission.terrainAtlasUrl);
        if (this.#disposed) return;
        try {
          this.#indexedTerrain = await createMissionTerrain(this.mission);
          if (this.#disposed) { this.dispose(); return; }
        } catch (error) {
          this.#terrainFallback = error instanceof Error ? error.message : String(error);
          console.warn("Indexed terrain unavailable; using RGBA fallback", this.#terrainFallback);
        }
        const sprites = [...missionVisualSprites(this.mission, this.#session?.snapshot.world, this.#research)];
        if (this.#browserEconomy && !sprites.includes(this.#interceptorTypes.deployedSprite)) sprites.push(this.#interceptorTypes.deployedSprite);
        if (this.#browserEconomy) {
          for (const [typeId, expected] of [[47, "EDPLY"], [48, "SDPL"]] as const) {
            const stat = this.mission.units.find(entry => entry.index === typeId);
            if (stat?.sprite !== expected) throw new TypeError(`Missing source mining visual ${typeId}:${expected}`);
            if (!sprites.includes(stat.sprite)) sprites.push(stat.sprite);
          }
        }
        await Promise.all(sprites.map(async (sprite) => {
          this.#visuals.set(sprite, await loadMissionVisual(sprite));
        }));
        if (this.#disposed) return;
        const names = [...this.#visuals.values()].flatMap((visual) => [...visual.atlases.keys()]);
        if (this.#research) {
          const metadata = await loadJson<SpriteMetadata>(`${ASSET_ROOT}/sprites/CURSOR/CURS.json`);
          const frame = metadata.frames.find(frame => frame.index === 6);
          if (!frame || frame.empty || frame.x !== 32 || frame.y !== 32 || frame.width !== 31 || frame.height !== 31) {
            throw new TypeError("Missing source discovery cursor frame");
          }
          this.#discoveryCursor = frame;
          names.push("CURSOR/CURS");
        }
        this.#spritePalettes = await createMissionSpritePalettes(this.mission, names);
        if (this.#disposed) { this.dispose(); return; }
      }
    } catch (error) { this.#failMission(error); }
    this.callbacks.onUnitsChanged(this.simulation.snapshot.units, this.selectedIds);
    this.render();
  }

  get selectedId(): number {
    return this.selectedIds[0] ?? 0;
  }

  get terrainRendererStatus(): string {
    return this.#indexedTerrain ? "indexed-webgl2" : `rgba-fallback: ${this.#terrainFallback ?? "not initialized"}`;
  }

  dispose(): void {
    this.#disposed = true;
    this.#audioFeedback?.dispose();
    this.#indexedTerrain?.dispose();
    this.#indexedTerrain = null;
    this.#spritePalettes?.dispose();
    this.#spritePalettes = null;
  }

  get selectedIds(): readonly number[] {
    return [...this.#selectedIds].sort((left, right) => left - right);
  }

  unitName(id: number): string {
    return this.#unitStats.get(id)?.sprite ?? `UNIT ${id}`;
  }

  isOwnedUnit(id: number): boolean {
    return this.#unitTeams.get(id) === 0;
  }

  get missionStatistics(): Readonly<Record<string, number>> {
    return { ...(this.#nativeViewState?.controller.runtime.statistics ?? this.#sessionViewSnapshot?.controller.runtime.statistics) };
  }

  get missionDiagnostic(): string | undefined { return this.#missionDiagnostic; }
  get missionOutcome(): { resultCode: number; reasonCode: number; ready: boolean } | null {
    return this.#outcome ? { ...this.#outcome } : null;
  }
  get campaignSnapshot() { return this.#session?.snapshot ?? null; }
  get #sessionViewSnapshot() {
    return this.#session?.runtimeProfile === "browser-adapted" ? this.#session.browserHudSnapshot : this.#session?.snapshot;
  }
  get nativeCombatFrameState() {
    if (!this.#nativeViewState) throw new TypeError("Native combat frame state requires an active native view");
    return { cycleCounter: this.#nativeViewState.cycleCounter,
      actors: this.#nativeViewState.transport.slots.flatMap(actor => actor ? [{ slot: actor.slot,
        generation: actor.generation, key: actor.key, team: actor.team, unitType: actor.unitType,
        status: actor.status, ...(actor.nativeAiTask ? { raw: [...actor.nativeAiTask.raw] } : {}) }] : []) };
  }
  get campaignJournal() { return this.#session?.journal ?? []; }
  get nativeCommandStatus() {
    return { enabled: Boolean(this.mission.sourceNativeCombat?.playerCommands) && !this.#disposed &&
      !this.#missionDiagnostic && !this.#outcome?.ready,
      scope: "typed-native-command-api-not-ui-parity" as const,
      visibility: this.#nativeVisibilityConfiguration ? "authenticated-native-ground-mask" as const : "view-fog-plus-adapter-native-ground-mask" as const,
      pending: this.#pendingNativeCommand ? structuredClone(this.#pendingNativeCommand) : null,
      diagnostic: this.#nativeCommandDiagnostic };
  }

  get nativeCommandMenu() {
    const binding = this.#simulationBindings.get(this.selectedId), actor = binding && this.#nativeViewState?.transport.slots[binding.slot];
    const enabled = this.nativeCommandStatus.enabled && !this.#pendingNativeCommand && this.selectedIds.length === 1 &&
      Boolean(actor?.nativeAiTask && actor.team === 0 && actor.unitType === 0 && actor.status === 1 && actor.health > 0 &&
        !actor.pendingNativeAi && actor.nativeAiTask.raw[0x36] === 0);
    return [{ type: "MoveOnly" as const, label: "Move", enabled },
      { type: "Attack" as const, label: "Bounded attack-move", enabled },
      { type: "Stop" as const, label: "Stop", enabled }];
  }

  #nativePlayerContext(world: CampaignWorld) {
    const host = transportHostState(world);
    const selected = this.selectedIds.flatMap(id => {
      const binding = this.#simulationBindings.get(id), actor = binding && host.slots[binding.slot];
      return actor?.nativeAiTask && actor.key === binding!.key && actor.generation === binding!.generation
        ? [{ slot: actor.slot, generation: actor.generation, key: actor.key, raw: [...actor.nativeAiTask.raw] }] : [];
    });
    return { world, localTeam: 0 as const, selected,
      id: `view-player:${this.#nativeViewState!.cycleCounter}:${selected[0]?.slot}:${selected[0]?.generation}` };
  }

  #validateQueuedNativeCommand(pending: SourceNativeQueuedPlayerCommand, world = this.#session?.snapshot.world): void {
    if (!this.mission.sourceNativeCombat?.playerCommands || !world || pending.localTeam !== 0 ||
      pending.sourceId !== transportHostState(world).nativeAiTasks?.configuration.sourceId ||
      pending.id !== `view-player:${this.#nativeViewState!.cycleCounter}:${pending.selected.slot}:${pending.selected.generation}` ||
      !this.nativeBindings.some(binding => binding.slot === pending.selected.slot && binding.generation === pending.selected.generation && binding.key === pending.selected.key)) {
      throw new TypeError("Stale native command source/binding or missing opt-in");
    }
    const preview = previewSourceNativePlayerOrder({ world, localTeam: pending.localTeam, id: pending.id, selected: [pending.selected] }, pending.command);
    if (!preview.ok) throw new TypeError(preview.diagnostic);
    if (pending.command.type === "Attack") {
      const actor = transportHostState(world).slots[pending.command.target.slot]!;
      if (!this.visibility[(actor.position.y >>> 8) * this.grid.width + (actor.position.x >>> 8)]) {
        throw new TypeError("Attack target is hidden by view fog");
      }
    }
  }

  #rejectNativeCommand(diagnostic: string): SourceNativePlayerOrderPreview {
    this.#nativeCommandDiagnostic = diagnostic;
    return { ok: false, kind: "UnsupportedPath", diagnostic };
  }

  queueNativePlayerOrder(command: SourceNativePlayerOrder): SourceNativePlayerOrderPreview {
    if (!this.nativeCommandStatus.enabled || !this.#session) return this.#rejectNativeCommand("Native command input is not enabled");
    if (this.#pendingNativeCommand) return this.#rejectNativeCommand("One native command is pending; advance it before another input");
    if (this.selectedIds.length !== 1) return this.#rejectNativeCommand("Only one selected native binding is proved");
    return this.#enqueueNativePlayerOrder(command, this.#session.snapshot.world);
  }

  #enqueueNativePlayerOrder(command: SourceNativePlayerOrder, world: CampaignWorld): SourceNativePlayerOrderPreview {
    try {
      this.#assertNativeCombatProjection();
      const context = this.#nativePlayerContext(world);
      const preview = previewSourceNativePlayerOrder(context, command);
      if (!preview.ok) return this.#rejectNativeCommand(preview.diagnostic);
      const pending: SourceNativeQueuedPlayerCommand = { sourceId: transportHostState(world).nativeAiTasks!.configuration.sourceId,
        id: context.id, localTeam: context.localTeam, selected: context.selected[0], command: structuredClone(command) };
      this.#validateQueuedNativeCommand(pending, world);
      this.#pendingNativeCommand = pending;
      this.#nativeCommandDiagnostic = undefined;
      this.#orderMode = "context";
      return preview;
    } catch (error) { return this.#rejectNativeCommand(error instanceof Error ? error.message : String(error)); }
  }
  get resourceWorkflow() {
    const bounded = Boolean(this.mission.sourceResource?.resourceLifecycle.nativeHarvest);
    return { enabled: Boolean(this.mission.sourceResource || this.#browserEconomy) && !this.#missionDiagnostic,
      harvestEnabled: (bounded || Boolean(this.#browserEconomy)) && !this.#missionDiagnostic,
      diagnostic: this.#resourceDiagnostic ?? (this.#browserEconomy ? "Browser-adapted direct-team extraction; not native timing" : bounded ? "Bounded native Harvest: clear same-family straight routes of 1-3 cells; external-owner combat unsupported"
        : "Harvest blocked: movement-finished/idle for 6/14 requires explicit source-separated-bounded configuration"),
      gates: { simulationOwnership: true, sessionHandoffs: true, nativeMovementTaskCapture: bounded,
        slotOrderedIdleVisits: true, nativeHarvesterCombat: false },
      credits: { ...(this.#nativeViewState?.world.exomoney ?? this.#sessionViewSnapshot?.world.exomoney) },
      sourceDayNight: this.#browserEconomy ? this.simulation.sourceDayNight : this.#nativeViewState ? structuredClone(this.#nativeViewState.sourceDayNight ?? null)
        : this.#session?.snapshot.sourceDayNight ? structuredClone(this.#session.snapshot.sourceDayNight) : null };
  }
  get browserEconomyState(): BrowserEconomyCheckpoint | undefined { return this.#browserEconomy?.checkpoint(); }

  get #interceptorTypes() {
    return this.playerFaction === "alien"
      ? { mobile: 12 as const, deployed: 78, mobileSprite: "PSYC", deployedSprite: "PSYCSTL" }
      : { mobile: 4 as const, deployed: 77, mobileSprite: "SARG", deployedSprite: "SARGSTL" };
  }

  get deploymentSelection() {
    const deployed = this.#browserEconomy?.deployedInterceptors ?? [];
    const eligible = this.mission.runtimeProfile === "browser-adapted" && this.#browserEconomy
      && !this.#disposed && !this.#missionDiagnostic && !this.#outcome?.ready;
    const mobile = this.#interceptorTypes.mobile;
    const units = this.simulation.snapshot.units.filter(unit => this.#selectedIds.has(unit.id)
      && unit.team === 0 && unit.health > 0 && this.#unitStats.get(unit.id)?.index === mobile);
    return { canDeploy: Boolean(eligible && units.some(unit => unit.activity === "idle" && !deployed.includes(unit.id))),
      canUndeploy: Boolean(eligible && units.some(unit => deployed.includes(unit.id))) };
  }

  deploySelected(): readonly number[] {
    if (!this.deploymentSelection.canDeploy) return [];
    const types = this.#interceptorTypes;
    const source = this.mission.units.find(stat => stat.index === types.mobile);
    const deployed = this.mission.units.find(stat => stat.index === types.deployed);
    if (source?.sprite !== types.mobileSprite || deployed?.sprite !== types.deployedSprite || deployed.movementSpeed !== 0
      || deployed.weapons.some(weapon => weapon !== -1) || source.targetClass !== deployed.targetClass
      || source.health !== deployed.health
      || JSON.stringify(source.armorUpgradePercentages) !== JSON.stringify(deployed.armorUpgradePercentages)) {
      throw new TypeError(`Unverified ${types.mobileSprite} source deployment types`);
    }
    const accepted: number[] = [];
    for (const unit of this.simulation.snapshot.units) {
      if (!this.#selectedIds.has(unit.id) || unit.team !== 0 || unit.health <= 0 || unit.activity !== "idle"
        || this.#unitStats.get(unit.id)?.index !== types.mobile || this.#browserEconomy!.deployedInterceptors.includes(unit.id)) continue;
      const binding = this.#simulationBindings.get(unit.id)!;
      this.#browserEconomy!.activateIncomeInterception(this.simulation, { type: "deploy",
        actor: { ...binding, team: 0, typeId: types.mobile } });
      this.#combatMovement.cancel([unit.id]); this.#guardAttacks.cancel([unit.id]);
      this.#waypointRoutes.delete(unit.id);
      accepted.push(unit.id);
    }
    this.#browserEconomy!.haltDeployed(this.simulation);
    this.#browserEconomy!.observeInterception(this.simulation, this.#incomeInterceptionFrame());
    this.render();
    return accepted;
  }

  get inspireSelection(): { readonly canInspire: boolean; readonly ready: boolean; readonly charge: number; readonly chargePercent: number } {
    const none = { canInspire: false, ready: false, charge: 0, chargePercent: 0 };
    if (this.mission.runtimeProfile !== "browser-adapted" || this.#disposed || this.#missionDiagnostic || this.#outcome?.ready) return none;
    let canInspire = false, ready = false, charge = 0;
    for (const id of this.#selectedIds) {
      const index = this.#unitStats.get(id)?.index ?? -1;
      if (this.#unitTeams.get(id) !== 0 || index < 69 || index > 76) continue;
      const state = this.simulation.adaptedInspireState(id);
      if (!state?.caster) continue;
      canInspire = true;
      ready ||= state.ready;
      charge = Math.max(charge, state.charge);
    }
    return canInspire ? { canInspire, ready, charge, chargePercent: Math.min(100, Math.floor(charge * 100 / 33)) } : none;
  }

  inspireSelected(): readonly number[] {
    if (!this.inspireSelection.ready) return [];
    const unitIds = this.selectedIds.filter(id => this.#unitTeams.get(id) === 0 && this.simulation.adaptedInspireState(id)?.ready);
    if (unitIds.length) this.simulation.queue({ type: "inspire", unitIds, team: 0 });
    return unitIds;
  }

  #registerInspireCasters(): void {
    for (const unit of this.simulation.snapshot.units) {
      const index = this.#unitStats.get(unit.id)?.index ?? -1;
      if (index >= 69 && index <= 76 && unit.health > 0 && unit.activity !== "die" && !unit.resourceActor) {
        this.simulation.registerAdaptedInspireCaster(unit.id, index);
      }
    }
  }

  undeploySelected(): readonly number[] {
    if (!this.deploymentSelection.canUndeploy) return [];
    const accepted = this.selectedIds.filter(id => this.#browserEconomy!.deployedInterceptors.includes(id));
    for (const id of accepted) {
      const binding = this.#simulationBindings.get(id)!;
      this.#browserEconomy!.activateIncomeInterception(this.simulation,
        { type: "undeploy", key: binding.key, generation: binding.generation });
    }
    this.render();
    return accepted;
  }

  #incomeInterceptionFrame() {
    const snapshot = this.simulation.snapshot;
    const groundWords = Array<number>(this.grid.width * this.grid.height).fill(1023);
    for (const unit of [...snapshot.staticTargets, ...snapshot.units]) {
      if (unit.health <= 0 || ("movementPlane" in unit && unit.movementPlane === "air")) continue;
      const binding = this.#simulationBindings.get(unit.id);
      if (binding) groundWords[unit.cellY * this.grid.width + unit.cellX] = binding.slot;
    }
    const teamVisibilityMasks = Array.from({ length: 8 }, (_, team) => 0x40000000 >>> team);
    for (let team = 0; team < 8; team++) {
      const visibility = this.#visibilityForSnapshot(snapshot, team);
      for (let cell = 0; cell < groundWords.length; cell++) {
        if (visibility[cell]) groundWords[cell] = (groundWords[cell] | teamVisibilityMasks[team]) >>> 0;
      }
    }
    return this.#browserEconomy!.interceptionFrame(this.simulation,
      { width: this.grid.width, height: this.grid.height, groundWords, teamVisibilityMasks });
  }
  get browserAiState(): BrowserCampaignViewState | undefined { return this.#browserAi && structuredClone(this.#browserAi); }
  get resourceSources() {
    const snapshot = this.#nativeViewState ? undefined : this.#sessionViewSnapshot;
    const world = this.#nativeViewState?.world ?? snapshot?.world;
    if (!world) return [];
    const host = this.#nativeViewState?.transport ?? (snapshot && "transport" in snapshot
      ? snapshot.transport : transportHostState(world as CampaignWorld));
    const presentations = this.#nativeViewState ? this.#nativeViewResources?.presentations
      : this.#nativeCombatPresentation?.(world as CampaignWorld);
    const economy = this.#browserEconomy?.checkpoint();
    return world.entities.filter((entity) => entity.unitType === 40 && entity.team === 8).map((entity) => {
      const record = entity.rawSlot === null ? undefined : host.slots[entity.rawSlot];
      if (!record || record.generation !== entity.generation || record.team !== 8 || !record.resource) {
        throw new Error(`Missing neutral resource host: ${entity.key}`);
      }
      return structuredClone({ slot: record.slot, generation: record.generation, key: record.key,
        owner: 8 as const, unitType: 40 as const, position: record.position, health: record.health,
        status: record.status, resource: record.resource, task: record.resourceTask,
        ...(economy ? { remaining: economy.remaining[record.key], rate: economy.rates[record.key] } : {}),
        presentation: presentations?.find(presentation => presentation.slot === record.slot) });
    });
  }
  get productionMenu() {
    if (!this.mission.sourceProduction?.production) return [];
    const production = this.#sessionViewSnapshot?.production;
    if (!production) return [];
    return sourceProductionUi(production, this.mission.sourceProduction.configuration.localTeam).map((choice) => ({
      ...choice, sprite: this.mission.units.find(({ index }) => index === choice.unitType)!.sprite,
      enabled: !this.#disposed && !this.#missionDiagnostic && !this.#outcome?.ready &&
        this.#pendingProduction === undefined && choice.maxAdditional > 0,
      submitting: this.#pendingProduction === choice.dependency,
    }));
  }

  get constructionMenu() {
    if (this.#nativeViewState) return [];
    const configuration = this.mission.browserConstruction;
    const current = this.#session?.browserConstructionStatus;
    if (configuration && current) {
      return current.choices.map(option => {
        const { credits, health, slot } = option;
        const action = option.action ?? "purchase";
        const state = option.action === "upgrade" ? option.upgradeState : option.state;
        const reason = this.#missionDiagnostic ? "Mission unavailable" : this.#outcome?.ready ? "Mission ended"
          : this.#disposed ? "Mission closed" : this.#pendingConstruction === option.dependency ? action === "upgrade" ? "Upgrade queued" : "Purchase queued"
          : this.#pendingConstruction !== undefined ? "Purchase pending"
          : option.reason === "Insufficient credits" ? `Insufficient credits: ${option.cost - credits} PETRA short`
          : option.reason === "Source prerequisites" && slot === 4 ? "Requires level-1 laboratory"
          : option.reason;
        return { team: 0, slot, action, dependency: option.dependency, unitType: option.building.unitType,
          label: ["Central base", "Barracks", "Vehicle plant", "Science laboratory", "Research center"][slot],
          status: state?.phase === "empty" || action === "upgrade" && !state ? "unbuilt" as const : state?.phase === "building" ? "constructing" as const : "complete" as const,
          busy: state?.phase === "building" ? 1 : 0, latch: 0, visits: state?.elapsedVisits ?? 0,
          health, submitting: this.#pendingConstruction === option.dependency,
          completionVisits: configuration.policy.completionVisits, cost: option.cost, credits,
          timing: configuration.policy.timing, requestEnabled: reason === "" && option.requestEnabled, reason };
      });
    }
    // This fallback is also visited in missions without construction; never copy replay history for a HUD read.
    return (this.#sessionViewSnapshot?.production?.constructionHosts ?? []).map(host => ({
      team: host.configuration.team, dependency: host.configuration.race === 0 ? 2 : 16,
      unitType: host.configuration.race === 0 ? 20 : 32,
      status: host.ready ? "complete" as const : host.receiptId ? "constructing" as const : "unbuilt" as const,
      busy: host.busy, latch: host.latch, visits: host.visits,
      requestEnabled: false as const, reason: "Native player construction dispatch is unsupported",
    }));
  }

  purchaseConstruction(dependency: number): boolean {
    const choice = this.constructionMenu.find(choice => choice.dependency === dependency && choice.requestEnabled);
    if (!choice) return false;
    // Both requests settle in the same session step; together they must fit the credits (H09 bought both and faulted).
    if ("cost" in choice && this.#pendingProduction !== undefined
      && this.#pendingCost(this.#pendingProduction) + choice.cost > this.resourceWorkflow.credits[0]) return false;
    this.#pendingConstruction = dependency;
    return true;
  }

  #pendingCost(production: number): number {
    return this.productionMenu.find(choice => choice.dependency === production)?.cost ?? 0;
  }

  get constructionVisuals() {
    if (this.#nativeViewState || !sourceConstructionSources(this.mission)) return [];
    const snapshot = this.#session?.snapshot;
    const hosts = snapshot?.production?.constructionHosts ?? [];
    if (!snapshot || !hosts.length) return [];
    const slots = transportHostState(snapshot.world).slots;
    return hosts.flatMap(host =>
      host.actors.filter((actor): actor is NativeConstructionActor => Boolean(actor?.registered)).map(actor => {
        const record = slots[actor.nativeId];
        if (!record || record.unitType !== actor.unitType || record.team !== actor.team || record.health !== actor.health ||
          record.position.x !== actor.position.x || record.position.y !== actor.position.y || record.height !== actor.position.height) {
          throw new TypeError("Construction scene does not match committed source host");
        }
        return { ...structuredClone(actor), generation: record.generation,
          sprite: this.mission.units.find(stat => stat.index === actor.unitType)!.sprite };
      }));
  }

  advanceConstruction(input: SourceConstructionFrame): void {
    if (!sourceConstructionSources(this.mission) || !this.#session || this.#disposed || this.#missionDiagnostic || this.#outcome?.ready) {
      throw new TypeError("Construction frame requires an active source-bound view");
    }
    const candidate = new MissionView(this.canvas, this.stage, { onStats() {}, onUnitsChanged() {} }, this.mission, undefined, this);
    candidate.#advanceFrame(input);
    this.#commitRuntime(candidate);
    this.#interpolation = 0;
    this.#reconcileSelection();
    this.callbacks.onUnitsChanged(this.simulation.snapshot.units, this.selectedIds);
    this.#presentCombatEvents();
  }

  advanceNativeCombat(input: SourceNativeCombatFrame): void {
    if (!this.mission.sourceNativeCombat || !this.#session || this.#disposed || this.#missionDiagnostic || this.#outcome?.ready) {
      throw new TypeError("Native combat frame requires an active source-bound view");
    }
    let frame = sourceNativeCombatFrame(input);
    this.#assertNativeCombatProjection();
    if (this.#pendingNativeCommand) {
      if ("nativeAiReceipt" in frame) throw new TypeError("Pending native command excludes an additional input receipt");
      const world = this.#session.snapshot.world, pending = this.#pendingNativeCommand;
      this.#validateQueuedNativeCommand(pending, world);
      const receipt = createSourceNativePlayerOrder({ world, localTeam: pending.localTeam, selected: [pending.selected], id: pending.id, frame }, pending.command);
      if (!receipt.ok) throw new TypeError(receipt.diagnostic);
      frame = receipt.input;
    }
    const onNativeDeathSound = this.callbacks.onNativeDeathSound;
    const candidate = new MissionView(this.canvas, this.stage, {
      onStats() {}, onUnitsChanged() {}, ...(onNativeDeathSound ? { onNativeDeathSound() {} } : {}),
    }, this.mission, undefined, this);
    candidate.#previousSnapshot = candidate.simulation.snapshot;
    const result = candidate.#session!.stepForNativeView(frame);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    if (result.value.entry.requests.some(request => request.type !== "create" &&
      !(request.type === "native-death-sound" && onNativeDeathSound) &&
      !(this.mission.sourceNativeCombat?.scope === "source-separated-type0-weapon1-bounded-lethal" &&
        ["combat-death", "unregister"].includes(request.type))) ||
      result.value.entry.commands.some(({ command }) => command.kind === "waypoint")) {
      throw new TypeError("Native combat view has no owner for this caller presentation request");
    }
    const dispatchSounds = prepareNativeDeathSoundEffects(result.value.entry.requests,
      onNativeDeathSound ? request => onNativeDeathSound.call(this.callbacks, request) : undefined);
    const host = result.value.transport;
    candidate.#nativeViewState = result.value;
    candidate.#nativeViewSamples = new Map();
    candidate.#applySessionFrame(result.value, host);
    candidate.#projectNativeCombat(result.value, host);
    if (candidate.#nativeViewResources &&
      nativeViewResourceIdentity(result.value) !== candidate.#nativeViewResources.identity) {
      throw new TypeError("Native combat fresh constructor changed; native resource visits are not owned");
    }
    candidate.#recordExploration();
    candidate.#pendingNativeCommand = undefined;
    candidate.#nativeCommandDiagnostic = undefined;
    this.#commitRuntime(candidate);
    this.#previousSnapshot = this.simulation.snapshot;
    this.#interpolation = 0;
    this.#reconcileSelection();
    dispatchSounds();
    this.callbacks.onUnitsChanged(this.simulation.snapshot.units, this.selectedIds);
  }

  advanceNativeVisibility(input: CampaignVisibilityInput) {
    if (!this.#nativeVisibilityConfiguration || !this.#session || this.#disposed || this.#missionDiagnostic || this.#outcome?.ready) {
      throw new TypeError("Native visibility phase requires an active source-bound visibility owner");
    }
    this.#assertNativeCombatProjection();
    const candidate = new MissionView(this.canvas, this.stage, { onStats() {}, onUnitsChanged() {} }, this.mission, undefined, this);
    const result = candidate.#session!.stepVisibilityForNativeView(input);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    candidate.#nativeViewState = result.value;
    candidate.#nativeViewSamples = new Map();
    candidate.#applySessionFrame(result.value, result.value.transport);
    candidate.#projectNativeCombat(result.value, result.value.transport);
    if (candidate.#nativeViewResources && nativeViewResourceIdentity(result.value) !== candidate.#nativeViewResources.identity) {
      throw new TypeError("Native visibility changed an unowned resource presentation");
    }
    candidate.#recordExploration();
    this.#commitRuntime(candidate);
    this.#previousSnapshot = this.simulation.snapshot;
    this.#interpolation = 0;
    this.#reconcileSelection();
    this.callbacks.onUnitsChanged(this.simulation.snapshot.units, this.selectedIds);
    return structuredClone(result.value);
  }

  #assertNativeCombatProjection(): void {
    if (!this.mission.sourceNativeCombat || this.#missionDiagnostic) return;
    if (this.mission.sourceNativeCombat.options.nativeCombat.visibility !== this.#nativeVisibilityConfiguration) {
      throw new TypeError("Native visibility configuration changed outside its source owner");
    }
    if (this.#nativeCombatProjection !== canonicalSource(this.simulation.checkpoint()) ||
      this.#pendingReservations.length || this.#waypointRoutes.size || this.#waypointDraft ||
      canonicalSource(this.#combatMovement.checkpoint()) !== canonicalSource(new CombatMovementOrders().checkpoint())) {
      throw new TypeError("Native combat projection mutated by an unowned simulation command, movement, damage or RNG");
    }
  }

  #projectNativeCombat(state: NativeViewProjection, host: NativeViewTransport): void {
    const saved = this.simulation.checkpoint();
    const project = <Entry extends { id: number; health: number; maxHealth: number; xSubcells: number; ySubcells: number }>(entry: Entry): Entry => {
      const binding = this.#simulationBindings.get(entry.id);
      const actor = binding && host.slots[binding.slot];
      const entity = state.world.entities.find(entity => entity.key === binding?.key);
      if (!binding || !actor || !entity || actor.key !== binding.key || actor.generation !== binding.generation ||
        actor.unitType !== this.#unitStats.get(entry.id)?.index || actor.health !== entity.health ||
        host.registry[actor.slot] !== actor.key || host.generations[actor.slot] !== actor.generation ||
        (actor.health <= 0 && !(actor.status === 10 && actor.nativeAiTask && host.nativeCombat?.death &&
          this.mission.sourceNativeCombat?.scope === "source-separated-type0-weapon1-bounded-lethal")) ||
        entry.maxHealth !== entity.maxHealth) throw new TypeError("Native combat projection identity/health mismatch");
      if (!actor.nativeAiTask && (entry.health !== actor.health || entry.xSubcells !== actor.position.x * 4 ||
        entry.ySubcells !== actor.position.y * 4)) throw new TypeError("Native combat passive/static projection changed without an owner");
      return { ...entry, health: Math.max(0, actor.health), xSubcells: actor.position.x * 4, ySubcells: actor.position.y * 4,
        ...("activity" in entry ? { activity: actor.status === 10 ? "die" : "idle" } : {}) };
    };
    this.#simulation = DeterministicSimulation.restore({ ...saved, tick: state.cycleCounter,
      sourceDayNight: state.sourceDayNight ?? saved.sourceDayNight,
      units: saved.units.map(project), staticTargets: saved.staticTargets.map(project) });
    this.#nativeCombatProjection = canonicalSource(this.simulation.checkpoint());
  }

  #assertConstructionProjection(checkHits = false): void {
    const configuration = this.mission.browserConstruction;
    const current = this.#session?.browserConstructionStatus;
    const checked = new Set<number>();
    for (const option of configuration && current ? current.choices : []) {
      if (checked.has(option.slot)) continue;
      const receipt = current!.state.slots ? current!.state.slots[option.slot] : current!.state;
      const upgrade = current!.state.upgrades?.[option.slot];
      const sourceUpgrade = configuration!.supportedActions?.includes("upgrade")
        && configuration!.buildings?.some(entry => entry.level === 1 && entry.building.slot === option.slot)
        && !receipt;
      if ((!receipt || receipt.phase === "empty") && !upgrade && !sourceUpgrade) continue;
      checked.add(option.slot);
      const building = configuration!.buildings?.find(entry => entry.building.slot === option.slot
        && entry.level === current!.slots[option.slot].level)?.building ?? configuration!.building;
      const binding = this.#nativeBindings.get(`${option.slot}:0`);
      const target = this.simulation.checkpoint().staticTargets.find(target => target.id === binding?.simulationId);
      const key = upgrade?.key ?? (receipt ? `browser-construction:${option.slot}:0:${receipt.receiptId}` : `colony:${option.slot}`);
      const stat = this.mission.units.find(stat => stat.index === building.unitType)!;
      const defense = defenseOptionsFromLegacy(stat, sourceScenarioUpgradeLevels(this.mission.scenario.teams[0], stat.index).armorLevel);
      if (!binding || binding.key !== key || !target
        || target.health > option.health || target.maxHealth !== building.maxHealth
        || target.xSubcells !== building.nativePosition.x * 4 || target.ySubcells !== building.nativePosition.y * 4
        || this.#unitStats.get(binding.simulationId)?.index !== building.unitType
        || (upgrade?.phase === "ready" && target.sourceDefense?.sourceTypeIndex !== building.unitType)
        || target.sourceDefense?.targetClass !== defense.targetClass || target.sourceDefense?.armorFactor !== defense.armorFactor
        || canonicalSource(target.footprint) !== canonicalSource(building.footprint.map(cell => cell.y * this.grid.width + cell.x))) {
        throw new TypeError("Adapted construction projection requires exact source pose, footprint and non-healing health");
      }
    }
    const sources = sourceConstructionSources(this.mission);
    if (!sources || !this.#session) return;
    const snapshot = this.simulation.checkpoint(), world = this.#session.snapshot.world;
    const host = transportHostState(world);
    for (const source of sources) for (const slot of [0, 1, 3, 5]) {
      const record = host.slots[source.team * 15 + slot];
      if (!record) continue;
      const binding = this.#nativeBindings.get(`${record.slot}:${record.generation}`);
      const target = snapshot.staticTargets.find(target => target.id === binding?.simulationId);
      const entity = world.entities.find(entity => entity.rawSlot === record.slot && entity.generation === record.generation);
      const footprint = slot === 3 ? source.footprint.map(cell => cell.y * this.grid.width + cell.x) : undefined;
      if (!target || target.health !== record.health || target.maxHealth !== entity?.maxHealth ||
        target.xSubcells !== record.position.x * 4 || target.ySubcells !== record.position.y * 4 ||
        target.sourceDefense?.sourceTypeIndex !== record.unitType ||
        (footprint && canonicalSource(target.footprint) !== canonicalSource(footprint)) ||
        (checkHits && this.simulation.combatEvents.some(event => event.targetId === target.id))) {
        throw new TypeError("Unsupported construction combat or projection mutation; source owner requires unchanged HP, pose and footprint");
      }
    }
  }

  purchaseProduction(dependency: number): boolean {
    const choice = this.productionMenu.find((choice) => choice.dependency === dependency && choice.enabled);
    if (!choice) return false;
    const construction = this.#pendingConstruction === undefined ? undefined
      : this.constructionMenu.find(entry => entry.dependency === this.#pendingConstruction);
    if (construction && "cost" in construction && construction.cost + choice.cost > this.resourceWorkflow.credits[0]) return false;
    this.#pendingProduction = dependency;
    return true;
  }

  renderProductionPortrait(canvas: HTMLCanvasElement, dependency: number): void {
    const source = this.mission.sourceProduction?.production;
    const unitType = source?.records.find((entry) => entry.id === dependency)?.rawFields[1];
    const sprite = (source?.sourceProfiles.some((profile) => profile.unitType === unitType)
      || source?.adaptedCollectorProfiles?.some((profile) => profile.unitType === unitType)
      || source?.adaptedUnitProfiles?.some((profile) => profile.unitType === unitType))
      ? this.mission.units.find(({ index }) => index === unitType)?.sprite : undefined;
    const context = canvas.getContext("2d");
    if (!context || !sprite) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = false;
    if (!this.#visuals.has(sprite)) {
      reportRenderDiagnostic(`missing-production-art:${sprite}`);
      return;
    }
    this.#drawVisual(context, sprite, "idle", canvas.width / 2, canvas.height - 8, this.#previousSnapshot.tick);
  }
  get nativeBindings(): readonly MissionEntityBinding[] { return [...this.#nativeBindings.values()].map((binding) => ({ ...binding })); }
  get carrierVisuals() {
    return this.#carriers.map((carrier) => ({ ...carrier, position: { ...carrier.position } }));
  }

  recordDestinationReservation(simulationId: number, tileX: number, tileY: number): void {
    if (this.mission.sourceNativeCombat) throw new TypeError("Native combat reservations belong to explicit native visits");
    const binding = this.#simulationBindings.get(simulationId);
    if (!binding || this.#detachedIds.has(simulationId)) {
      this.#failMission(new Error(`Reservation has no active source identity: ${simulationId}`));
      return;
    }
    this.#pendingReservations.push({ slot: binding.slot, generation: binding.generation, tileX, tileY });
  }

  #failMission(error: unknown): void {
    this.#missionDiagnostic ??= error instanceof Error ? error.message : String(error);
  }

  #registerEntity(entity: CampaignEntity, world: CampaignWorld | undefined, constructorProjection?: HostSlot): void {
    if (this.mission.runtimeProfile === "browser-adapted" && world) {
      if (this.#research && isBrowserScenarioMarker(entity, world)) return;
      const presentation = browserScenarioMarkerPresentation(entity, world);
      if (presentation === "excluded-native-spy-gate") return;
      if (presentation === "source-art-required") throw new TypeError("Type37 spy presentation requires unavailable source POOP art");
    }
    const key = `${entity.rawSlot}:${entity.generation}`;
    if (this.#nativeBindings.has(key) || entity.health === 0) return;
    const stat = this.mission.units.find(({ index }) => index === entity.unitType);
    if (!stat || entity.rawSlot === null) throw new Error(`Missing source definition or slot: ${entity.key}`);
    const host = constructorProjection ?? (world && transportHostState(world).slots[entity.rawSlot]);
    if (!host) throw new Error(`Missing host slot: ${entity.key}`);
    this.#sceneIdentities.set(entity.rawSlot, { generation: host.generation, height: host.height });
    const adapted = this.mission.runtimeProfile === "browser-adapted";
    if (adapted && stat.index === 94 && !browserVisionArtifact(stat)) throw new TypeError("Unsupported source vision artifact definition");
    const vent = entity.unitType === 40 && entity.team === 8 && host.resource;
    if (vent && !adapted) return;
    const browserHarvester = adapted && world && [6, 14].includes(entity.unitType)
      ? sourceBrowserEconomyHarvesters(world, this.mission.units).find(actor => actor.key === entity.key) : undefined;
    const construction = sourceConstructionSources(this.mission)?.find(source =>
      entity.rawSlot === source.team * 15 + 3 || entity.rawSlot === source.team * 15 + 6);
    if (construction && entity.rawSlot === construction.team * 15 + 6) {
      if (entity.team !== 8 || entity.unitType !== 92 + construction.race) throw new TypeError("Invalid construction auxiliary identity");
      return;
    }
    const nativeHarvester = [6, 14].includes(entity.unitType) && host.resourceTask?.nativeIdle
      && this.mission.sourceResource?.resourceLifecycle.nativeHarvest;
    if (([6, 14, 47, 48].includes(entity.unitType) || host.resourceTask) && !nativeHarvester && !browserHarvester && !vent && !this.mission.sourceNativeCombat) {
      throw new Error(`Resource actor admission blocked: native movement/idle task adapter and noncombat view ownership required; source defense is not certified: ${entity.key}`);
    }
    const positionSubcells = { x: host.position.x * SUBCELLS_PER_CELL / 256, y: host.position.y * SUBCELLS_PER_CELL / 256 };
    const faction: Faction = entity.team === 8 ? this.mission.faction : this.mission.scenario.teams[entity.team].race === 1 ? "alien" : "human";
    const cell = { x: entity.tileX, y: entity.tileY };
    const production = this.mission.sourceProduction?.production?.adaptedUpgrades ? this.#sessionViewSnapshot?.production : undefined;
    const levels = currentUpgradeLevels(this.mission, production, entity.team, stat.index);
    const defense = (this.mission.damageMatrix || sourceConstructionSources(this.mission)) && !adapted && !nativeHarvester && !browserHarvester && !vent && !this.mission.sourceNativeCombat ? verifiedNativeDefenseFromLegacy(stat, levels) : null;
    if (defense && !defense.supported) throw new Error(`Source defense type ${stat.index}: ${defense.diagnostic}`);
    const sourceDefense = adapted && !vent ? defenseOptionsFromLegacy(stat, levels.armorLevel) : defense?.supported ? defense.profile : undefined;
    let id: number;
    if (stat.movementSpeed === 0) {
      const building = projectLegacyColony(this.mission.scenario.teams, this.mission.units).buildings
        .find(({ nativeId }) => nativeId === entity.rawSlot);
      const occupancy = entity.rawSlot >= 120 ? projectLegacyStaticOccupancy({
        slot: entity.rawSlot, owner: entity.team, tileX: cell.x, tileY: cell.y,
        width: this.grid.width, height: this.grid.height, ...legacyStaticOccupancyFieldsFromSource(stat),
      }) : null;
      const adaptedConstruction = this.mission.browserConstruction && entity.team === 0
        && entity.key.startsWith(`browser-construction:${entity.rawSlot}:0:`)
        ? this.mission.browserConstruction.buildings?.find(option => option.level === 0 && option.building.slot === entity.rawSlot)?.building
          ?? (entity.rawSlot === 0 ? this.mission.browserConstruction.building : undefined) : undefined;
      const footprint = vent ? [] : adaptedConstruction ? adaptedConstruction.footprint : construction ? construction.footprint : entity.rawSlot < 120 ? building?.footprint
        : occupancy?.plane === "ground" ? [{ x: occupancy.x, y: occupancy.y }] : [];
      const weapon = browserStaticWeapon(this.mission, stat, levels.weaponLevel);
      const mine = browserMineOptions(this.mission, stat);
      id = this.simulation.addStaticTarget({ faction, team: entity.team, cell, positionSubcells,
        health: entity.health, maxHealth: entity.maxHealth, footprint, sourceDefense,
        ...(mine ? { mine } : {}),
        ...(weapon ? { weapon, vision: { dayRangeCells: stat.observationDay, nightRangeCells: stat.observationNight } } : {}) });
      if (weapon) this.#unitWeaponIds.set(id, stat.weapons[levels.weaponLevel]);
      if (mine) this.#unitWeaponIds.set(id, mine.weaponId);
      this.#staticObjects.push({ id, stat, entity: { source: "placement", unitType: entity.unitType,
        team: entity.team, rawTail: entity.rawTail, x: host.position.x / 256 - 0.5, y: host.position.y / 256 - 0.5 } });
    } else {
      const options = { ...(browserHarvester?.options ?? unitOptionsFromLegacy(stat, this.mission.weapons, levels.weaponLevel,
        adapted && this.mission.damageMatrix ? { matrix: this.mission.damageMatrix, armorLevel: levels.armorLevel,
          callerFactor: 256, specialFlag: false } : undefined)), faction, team: entity.team, cell,
        health: entity.health, positionSubcells, sourceDefense,
        ...(adapted ? { movementPlane: browserMovementPlane(this.mission, stat) } : {}) };
      if (this.mission.sourceNativeCombat) { options.weapon = undefined; options.harvester = undefined; }
      if (adapted && browserExcavationArtifact(stat, this.mission.weapons)) options.weapon = undefined;
      const weaponId = stat.weapons[levels.weaponLevel];
      if (this.mission.damageMatrix && options.weapon && !adapted) {
        const weapon = this.mission.weapons.find(({ id }) => id === weaponId)!;
        const damage = verifiedNativeDamageFromLegacy(stat, weapon, this.mission.damageMatrix, levels,
          { caller: "ordinary-direct", inspireTimer: 0 });
        if (!damage.supported) throw new Error(`Source damage type ${stat.index}: ${damage.diagnostic}`);
        options.weapon = { ...options.weapon, sourceDamage: damage.profile };
      }
      id = this.simulation.addUnit(options);
      this.#unitWeaponIds.set(id, weaponId);
      const added = this.simulation.snapshot.units.find((unit) => unit.id === id)!;
      if (added.health !== entity.health || added.xSubcells !== positionSubcells.x || added.ySubcells !== positionSubcells.y) {
        this.simulation.removeUnit(id);
        throw new Error(`Engine addUnit requires health/positionSubcells overrides for ${entity.key}`);
      }
      if (entity.team === 0) this.#selectedIds.add(id);
    }
    const binding = { slot: entity.rawSlot, generation: entity.generation, key: entity.key, sourceRow: entity.sourceRow, simulationId: id };
    this.#nativeBindings.set(key, binding);
    this.#simulationBindings.set(id, binding);
    this.#unitStats.set(id, stat);
    this.#unitTeams.set(id, entity.team);
    if (browserHarvester && this.#browserEconomy) this.#browserEconomy.bindHarvester(this.simulation, browserHarvester, id);
    if (nativeHarvester) {
      const provenance = nativeHarvester.bindings.find(binding => binding.slot === host.slot)!.provenance;
      const profile = this.#resourceProfile(host, provenance === "constructor" ? "constructor" : "resume");
      this.simulation.claimResourceActor({ simulationId: id, slot: binding.slot, generation: binding.generation,
        key: binding.key, ownershipGeneration: 0 }, profile);
    }
  }

  #resourceProfile(record: HostSlot, provenance: "constructor" | "resume" | "source-idle" = "resume"): ResourceActorStateProfile {
    const stat = this.mission.units.find(stat => stat.index === record.unitType)!;
    const mobile = this.mission.units.find(stat => stat.index === ([6, 47].includes(record.unitType) ? 6 : 14))!;
    const levels = sourceScenarioUpgradeLevels(this.mission.scenario.teams[record.team], stat.index);
    const movement = record.resourceTask!.nativeMovement;
    const cell = movement ? movement.world.groundCells[movement.state.ground.findIndex(word => (word & 1023) === record.slot)]
      : (record.position.y >> 8) * this.grid.width + (record.position.x >> 8);
    return { nativeIdentity: { slot: record.slot, generation: record.generation, key: record.key },
      sourceTypeIndex: record.unitType as 6 | 14 | 47 | 48, team: record.team,
      xQ8: record.position.x, yQ8: record.position.y, health: Math.max(0, record.health), maxHealth: stat.health,
      speedSubcellsPerTick: unitOptionsFromLegacy(mobile, this.mission.weapons).speedSubcellsPerTick!, weapon: null, harvester: null,
      sourceDefense: { ...defenseOptionsFromLegacy(stat, levels.armorLevel), sourceTypeIndex: record.unitType },
      vision: { dayRangeCells: stat.observationDay, nightRangeCells: stat.observationNight },
      occupancy: record.status === 0 || record.status === 10 ? [] : [{ x: cell % this.grid.width, y: Math.floor(cell / this.grid.width) }],
      status: record.status, task: record.task as ResourceActorStateProfile["task"], taskWords: record.taskWords,
      taskOwner: { provenance, evidence: this.mission.sourceResource!.resourceLifecycle.nativeHarvest!.evidence,
        state: structuredClone(record.resourceTask!) } };
  }

  #publishResources(simulation: DeterministicSimulation, world: CampaignWorld): void {
    if (simulation.resourceActors.length === 0) return;
    const host = transportHostState(world);
    for (const actor of simulation.resourceActors) {
      if (actor.owner === "removed") continue;
      const token = { simulationId: actor.simulationId, slot: actor.slot, generation: actor.generation,
        key: actor.key, ownershipGeneration: actor.ownershipGeneration };
      const record = host.slots[actor.slot];
      if (!record?.resourceTask || record.generation !== actor.generation) throw new Error("Stale native resource owner");
      const profile = this.#resourceProfile(record, record.resourceTask.released ? "source-idle" : "resume");
      if (record.status === 0) {
        simulation.publishResourceActors([{ token, profile }]);
        simulation.removeResourceActor(token, "remove-noncombat");
        continue;
      }
      if (actor.owner === "simulation") {
        if (record.resourceTask.released) continue;
        throw new Error("Native resource claim must precede command publication");
      }
      if (record.resourceTask.released && actor.owner === "resource") simulation.requestResourceActorReturn(token);
      simulation.publishResourceActors([{ token, profile }]);
      if (record.resourceTask.released) simulation.releaseResourceActor(token, {
        hostReleased: true, ownershipGeneration: actor.ownershipGeneration,
        sourceIdle: { sourceTypeIndex: record.unitType as 6 | 14, evidence: profile.taskOwner.evidence,
          directionSigned: ((record.resourceTask.direction + 128) & 255) - 128, taskWords: record.taskWords } }, profile);
    }
  }

  #nativeCommand(command: NativeHarvestCommand): boolean {
    this.#cursorCache = null;
    if (!this.#session || this.#missionDiagnostic || this.#outcome?.ready) return false;
    try {
      const session = this.#session.fork();
      const simulation = DeterministicSimulation.restore(this.simulation.checkpoint());
      const actor = simulation.resourceActors.find(actor => actor.slot === command.slot && actor.generation === command.generation);
      if (!actor) throw new Error("Selected unit has no bounded native resource owner");
      if (actor.owner === "simulation") {
        const profile = structuredClone(actor.profile);
        profile.taskOwner.state.released = false;
        simulation.claimResourceActor({ simulationId: actor.simulationId, slot: actor.slot, generation: actor.generation,
          key: actor.key, ownershipGeneration: actor.ownershipGeneration },
        { ...profile, taskOwner: { ...profile.taskOwner, provenance: "resume" } });
      }
      const result = session.commandResource(command);
      if (!result.ok) throw new Error(result.diagnostics.map(entry => entry.message).join("; "));
      this.#publishResources(simulation, result.value);
      CampaignSession.restore(session.checkpoint(), this.mission.sourceConstruction?.campaignAi, undefined,
        sourceConstructionSources(this.mission));
      DeterministicSimulation.restore(simulation.checkpoint());
      this.#session = session; this.#simulation = simulation;
      this.#resourceDiagnostic = undefined;
      this.#orderMode = "context";
      return true;
    } catch (error) { this.#resourceDiagnostic = error instanceof Error ? error.message : String(error); return false; }
  }

  harvestSelected(sourceSlot: number): boolean {
    const source = this.resourceSources.find(source => source.slot === sourceSlot && source.status === 1);
    if (this.#browserEconomy) {
      if (!source || this.#missionDiagnostic || this.#outcome?.ready ||
        !this.visibility[(source.position.y >> 8) * this.grid.width + (source.position.x >> 8)]) return false;
      const accepted = this.#browserEconomy.harvest(this.simulation, this.selectedIds, source.key, 0);
      this.#combatMovement.cancel(accepted);
      this.#guardAttacks.cancel(accepted);
      for (const id of accepted) this.#waypointRoutes.delete(id);
      this.#orderMode = "context";
      this.#cursorCache = null;
      return accepted.length > 0;
    }
    const id = this.selectedIds.length === 1 ? this.selectedId : undefined;
    const binding = id === undefined ? undefined : this.#simulationBindings.get(id);
    if (!source || !binding || !this.visibility[(source.position.y >> 8) * this.grid.width + (source.position.x >> 8)]) {
      this.#resourceDiagnostic = "Harvest requires one selected harvester and a visible neutral VENT"; return false;
    }
    return this.#nativeCommand({ type: "harvest", slot: binding.slot, generation: binding.generation,
      sourceSlot, target: { x: source.position.x >> 8, y: source.position.y >> 8 } });
  }

  #stepSession(constructionInput?: SourceConstructionFrame): CampaignSessionFrame | BrowserViewFrame | undefined {
    if (!this.#session) return;
    const reservationEvents = (this.simulation as DeterministicSimulation & {
      readonly reservationEvents?: readonly { readonly unitId: number; readonly tileX: number; readonly tileY: number }[];
    }).reservationEvents;
    const alive = new Set(this.simulation.snapshot.units.filter((unit) => unit.health > 0 && unit.activity !== "die").map(({ id }) => id));
    for (const event of reservationEvents ?? []) {
      if (alive.has(event.unitId)) this.recordDestinationReservation(event.unitId, event.tileX, event.tileY);
    }
    if (this.#missionDiagnostic) throw new Error(this.#missionDiagnostic);
    const updates: HostUnitUpdate[] = [];
    const construction = this.mission.browserConstruction;
    const constructionState = this.#session.browserConstructionStatus;
    const damageSlots = new Set<number>();
    const constructionDamage = (constructionState?.choices ?? []).flatMap(option => {
      if (damageSlots.has(option.slot) || ((!option.state || option.state.phase === "empty") && option.action !== "upgrade")) return [];
      damageSlots.add(option.slot);
      const binding = this.#nativeBindings.get(`${option.slot}:0`);
      const target = binding && this.simulation.snapshot.staticTargets.find(target => target.id === binding.simulationId);
      return target && target.health > 0 && target.health !== option.health
        ? [{ slot: option.slot, generation: 0 as const, health: target.health }] : [];
    });
    for (const unit of this.simulation.snapshot.units) {
      const binding = this.#simulationBindings.get(unit.id);
      if (!binding || this.#detachedIds.has(unit.id) || unit.activity === "die" || unit.resourceActor) continue;
      updates.push({ type: "position", slot: binding.slot, generation: binding.generation,
        position: { x: Math.round(unit.xSubcells * 256 / SUBCELLS_PER_CELL), y: Math.round(unit.ySubcells * 256 / SUBCELLS_PER_CELL) } });
    }
    for (const event of this.simulation.deathEvents) {
      const binding = this.#simulationBindings.get(event.targetId);
      if (!binding || this.#recordedDeaths.has(event.targetId)) continue;
      updates.push({ type: "combat-death", slot: binding.slot, generation: binding.generation });
    }
    const current = this.#browserAi ? this.#session.browserFrameContext(this.mission.sourceProduction?.initialPopulationCeiling ?? 150)
      : this.#session.snapshot;
    const productionVisits = "world" in current ? current.production && this.mission.sourceProduction
      && sourceProductionVisits(current.world, current.production, this.mission.sourceProduction.initialPopulationCeiling)
      : current.productionVisits;
    const production = productionVisits && this.mission.sourceProduction;
    const dependency = this.#pendingProduction;
    const type37World = this.#type37World;
    if (!this.#research && type37World?.markerSpyTeams?.some(Boolean)) throw new TypeError("Type37 spy activation requires a source-backed observation owner");
    const observation = {
      snapshot: this.simulation.snapshot,
      bindings: this.nativeBindings.filter(binding => !this.#detachedIds.has(binding.simulationId)),
    };
    const type37Frame = type37World && (this.#research
      ? this.#session.browserResearchFrame(this.#research, { ...observation, updates })
      : observeBrowserType37Frame(type37World, this.#browserAi!, { ...observation, spyTeams: Array(8).fill(false) }));
    const step = this.#browserAi ? this.#session.stepForBrowserView.bind(this.#session) : this.#session.step.bind(this.#session);
    const result = step({ clockMilliseconds: ((this.simulation.snapshot.tick + Number(Boolean(this.#browserAi))) * MISSION_BROWSER_POLICY.fixedStepMilliseconds) >>> 0,
      updates, reservations: this.#pendingReservations.splice(0),
      ...(type37Frame ? { type37Frame } : {}),
      ...(this.#browserEconomy ? { economyIncome: this.#browserEconomy.income } : {}),
      ...(constructionDamage.length ? construction?.configurationVersion === 2
        ? { browserConstructionDamage: constructionDamage } : { browserConstructionHealth: constructionDamage[0].health } : {}),
      ...(this.#pendingConstruction !== undefined && construction && constructionState ? { browserConstructionRequest: {
        type: constructionState.choices.find(choice => choice.dependency === this.#pendingConstruction)!.action ?? "purchase",
        sequence: constructionState.state.sequence + 1, id: `player:central-base:${current.cycleCounter + 1}`,
        dependency: this.#pendingConstruction, home: construction.home } } : {}),
      ...(this.mission.sourceResource && !this.#browserEconomy ? { resourceFrameSource: this.mission.sourceResource.resourceFrameSource } : {}),
      ...(production ? {
        productionVisits,
        ...(dependency !== undefined ? { productionCommands: (["reserve", "dispatch"] as const).map((type) => ({
          id: `browser:${current.cycleCounter + 1}:${type}`, team: production.configuration.localTeam,
          action: { type, dependency },
        })) } : {}),
      } : {}),
      ...(constructionInput ?? {}),
    });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    this.#publishResources(this.simulation, result.value.world);
    this.#pendingProduction = undefined;
    this.#pendingConstruction = undefined;
    for (const event of this.simulation.deathEvents) this.#recordedDeaths.add(event.targetId);
    this.#applySessionFrame(result.value);
    return result.value;
  }

  #applySessionFrame(frame: CampaignSessionFrame | NativeViewFrame | BrowserViewFrame,
    transport: NativeViewTransport | ReturnType<typeof transportHostState> = "transport" in frame ? frame.transport : transportHostState(frame.world)): void {
    if (this.mission.runtimeProfile === "browser-adapted") this.#contactDormant = this.#contactDormantIds(frame.world);
    const constructionEffects = "browserConstructionEffects" in frame.entry ? frame.entry.browserConstructionEffects : undefined;
    const upgrades = "productionRequests" in frame.entry
      ? frame.entry.productionRequests?.filter(request => request.type === "upgrade-applied") ?? [] : [];
    if (upgrades.length) {
      const production = this.#sessionViewSnapshot?.production;
      for (const request of upgrades) {
        const levels = sourceProductionUpgradeLevels(production, request.team, request.unitType);
        if (this.mission.runtimeProfile !== "browser-adapted" || !levels
          || (request.selector === 0 ? levels.weaponLevel : levels.armorLevel) < request.level) {
          throw new TypeError("Upgrade request requires current adapted production ownership");
        }
        const stat = this.mission.units.find(stat => stat.index === request.unitType);
        if (!stat) throw new TypeError(`Missing upgrade source type: ${request.unitType}`);
        const equipment = upgradedEquipment(this.mission, stat, levels);
        for (const [id, current] of this.#unitStats) {
          if (current.index !== stat.index || this.#unitTeams.get(id) !== request.team) continue;
          this.#unitWeaponIds.set(id, stat.weapons[levels.weaponLevel]);
          if (this.#detachedIds.has(id)) continue;
          if (stat.movementSpeed === 0) this.simulation.updateStaticEquipment(id, equipment);
          else this.simulation.updateUnitEquipment(id, equipment);
        }
      }
    }
    if (this.#type37World) this.#type37World = this.#research ? this.#session!.browserResearchWorld : frame.world as CampaignWorld;
    this.#sceneIdentities.clear();
    for (const slot of transport.slots) {
      if (slot) this.#sceneIdentities.set(slot.slot, { generation: slot.generation, height: slot.height });
    }
    this.#carriers = transport.reducer.carriers.filter(({ phase }) => phase !== "released").map((carrier) => {
      const slot = transport.slots[carrier.slot];
      if (!slot) throw new Error(`Carrier slot missing: ${carrier.slot}`);
      return { slot: carrier.slot, generation: slot.generation, team: carrier.team, phase: carrier.phase,
        sprite: carrier.type === 92 ? "DROP" : "SAUC", position: { ...slot.position }, height: slot.height };
    });
    this.#latestMessage = frame.world.messages.at(-1)?.text ?? "";
    if (this.#awaitingPlayerFocus) {
      const carrier = transport.reducer.carriers.find(({ team, phase }) => team === 0 && phase !== "released");
      if (carrier) {
        this.#cameraX = carrier.destination.x / 256;
        this.#cameraY = carrier.destination.y / 256;
        this.#awaitingPlayerFocus = false;
      }
    }
    for (const request of frame.entry.requests) {
      const binding = this.#nativeBindings.get(`${request.slot}:${request.generation}`);
      const record = transport.slots[request.slot];
      const auxiliary = sourceConstructionSources(this.mission)?.find(source => request.slot === source.team * 15 + 6);
      if (auxiliary && ["create", "unregister", "clear-collision", "remove-noncombat"].includes(request.type)) {
        if (binding || !record || record.generation !== request.generation || record.team !== 8 || record.unitType !== 92 + auxiliary.race) {
          throw new TypeError("Construction auxiliary request has no exact source identity");
        }
        continue;
      }
      if (request.type === "native-death-sound") {
        if (!this.mission.sourceNativeCombat || !this.callbacks.onNativeDeathSound) {
          throw new TypeError("Native death sound requires an explicit postcommit consumer");
        }
      } else if (request.type === "source-sound") {
        const soundId = legacyCueCatalog.bindings.find(({ id, group }) => id === 1 && group === "XTR")?.soundIds[0];
        const sound = legacyCueCatalog.sounds.find(({ id }) => id === soundId);
        if (soundId !== 183 || sound?.source !== "SOUND/ERUPT.WAV") throw new Error("Missing source XTR 1 eruption sound 183");
        if (this.#audio) void this.#audio.play({ assetId: sound.source, priority: 40 });
      } else if (record?.unitType === 40 && record.team === 8 && record.generation === request.generation &&
        (request.type === "clear-collision" || request.type === "unregister" || request.type === "remove-noncombat")) {
        if (binding) throw new Error("Neutral resource incorrectly registered in combat simulation");
      } else if (request.type === "resource-task-released") {
        if (!binding || !this.simulation.resourceActors.some(actor => actor.simulationId === binding.simulationId)) {
          throw new Error(`Native harvester mobile-idle owner missing: ${request.slot}:${request.generation}`);
        }
      } else if (request.type === "resource-unit-sound") {
        continue;
      } else if (request.type === "create") {
        const entity = frame.world.entities.find(({ rawSlot, generation }) => rawSlot === request.slot && generation === request.generation);
        if (!entity) throw new Error(`Created entity missing from world: ${request.slot}:${request.generation}`);
        this.#registerEntity(entity, "placementState" in frame.world ? frame.world : undefined, record ?? undefined);
      } else if (request.type === "casualty-picked-up" || request.type === "remove-noncombat" || request.type === "clear-collision" || request.type === "unregister") {
        if (request.type === "casualty-picked-up" && (this.mission.runtimeProfile !== "browser-adapted" ||
          !("browserCasualtyPickup" in frame.world) || frame.world.browserCasualtyPickup?.runtimeProfile !== "browser-adapted" || !binding ||
          !this.#recordedDeaths.has(binding.simulationId))) throw new TypeError("Casualty collection requires an owned recorded death");
        if (!binding) throw new Error(`Removal has no simulation identity: ${request.slot}:${request.generation}`);
        if (this.mission.sourceNativeCombat && (request.type !== "unregister" || !record?.nativeAiTask ||
          record.generation !== binding.generation || record.key !== binding.key || record.status !== 0 ||
          transport.registry[record.slot] !== null || !this.#recordedDeaths.has(binding.simulationId))) {
          throw new TypeError("Native combat removal requires registered death transition to status zero");
        }
        const resourceActor = this.simulation.resourceActors.find(actor => actor.simulationId === binding.simulationId);
        if (resourceActor && request.type === "clear-collision" && record?.status === 10) continue;
        const staticIndex = request.type === "unregister" && this.mission.runtimeProfile === "browser-adapted"
          ? this.#staticObjects.findIndex(({ id }) => id === binding.simulationId) : -1;
        if (staticIndex >= 0) {
          // Contact pickups (DC.EXE 4140dc) remove a static placement that never died.
          if (!this.#detachedIds.has(binding.simulationId) && !this.simulation.removeStaticTarget(binding.simulationId)) {
            throw new Error(`Engine cannot remove static source entity: ${binding.key}`);
          }
          this.#staticObjects.splice(staticIndex, 1);
          this.#contactSounds++;
        } else if (!this.#detachedIds.has(binding.simulationId) && resourceActor?.owner !== "removed" && !this.simulation.removeUnit(binding.simulationId)) {
          throw new Error(`Engine cannot remove source entity without death: ${binding.key}`);
        }
        this.#detachedIds.add(binding.simulationId);
        this.#selectedIds.delete(binding.simulationId);
        this.#waypointRoutes.delete(binding.simulationId);
      } else if (request.type === "combat-death") {
        if (this.mission.sourceNativeCombat && binding && record?.nativeAiTask && record.status === 10 &&
          record.health <= 0 && record.key === binding.key && record.generation === binding.generation &&
          transport.registry[record.slot] === record.key && transport.nativeCombat?.death) {
          this.#recordedDeaths.add(binding.simulationId);
        }
        if (!binding || !this.#recordedDeaths.has(binding.simulationId)) throw new Error(`Unexpected host combat death: ${request.slot}`);
      } else {
        throw new Error(`Unsupported host request: ${JSON.stringify(request)}`);
      }
    }
    for (const entity of frame.world.entities) {
      const binding = this.#nativeBindings.get(`${entity.rawSlot}:${entity.generation}`);
      if (!binding) continue;
      const currentTeam = this.#unitTeams.get(binding.simulationId);
      if (currentTeam !== undefined && currentTeam !== entity.team && !this.#detachedIds.has(binding.simulationId)) {
        // Session-owned DC.EXE 4140dc join-on-contact is the only adapted ownership transfer.
        if (this.mission.runtimeProfile !== "browser-adapted" || entity.team !== 0) throw new TypeError(`Unsupported team transfer: ${entity.key}`);
        const faction: Faction = this.mission.scenario.teams[0].race === 1 ? "alien" : "human";
        if (!this.simulation.transferEntityTeam(binding.simulationId, 0, faction)) throw new Error(`Team transfer has no simulation entity: ${entity.key}`);
        this.#unitTeams.set(binding.simulationId, 0);
        this.#contactSounds++;
        const objectIndex = this.#staticObjects.findIndex(({ id }) => id === binding.simulationId);
        if (objectIndex >= 0) this.#staticObjects[objectIndex] = { ...this.#staticObjects[objectIndex],
          entity: { ...this.#staticObjects[objectIndex].entity, team: 0 } };
      }
      const stat = this.mission.units.find(({ index }) => index === entity.unitType);
      if (!stat) throw new Error(`Missing render type: ${entity.unitType}`);
      if (this.mission.damageMatrix && this.#unitStats.get(binding.simulationId)?.index !== stat.index) {
        if (this.simulation.resourceActors.some(actor => actor.simulationId === binding.simulationId)) {
          this.#unitStats.set(binding.simulationId, stat);
          continue;
        }
        if (stat.movementSpeed !== 0) throw new Error(`Unsupported mobile combat type transition: ${stat.index}`);
        const effect = constructionEffects?.find(effect => effect.action === "upgrade"
          && effect.type === "construction-ready" && effect.slot === binding.slot && effect.generation === binding.generation);
        if (effect) {
          const receipt = this.#session!.browserConstructionStatus!.state.upgrades?.[binding.slot];
          if (!receipt || receipt.phase !== "ready" || receipt.key !== binding.key || effect.key !== binding.key
            || effect.unitType !== stat.index || effect.maxHealth !== entity.maxHealth || effect.health !== entity.health
            || this.mission.browserConstruction?.policy.upgradeHealth !== "adapted-preserve-hp-capped-new-max"
            || !this.#visuals.has(stat.sprite)) throw new TypeError("Building upgrade requires authenticated construction completion and art");
          const levels = currentUpgradeLevels(this.mission, this.#sessionViewSnapshot?.production, entity.team, stat.index);
          this.simulation.updateStaticSourceDefense(binding.simulationId,
            { ...defenseOptionsFromLegacy(stat, levels.armorLevel), sourceTypeIndex: stat.index }, entity.maxHealth);
        } else {
          const levels = sourceScenarioUpgradeLevels(this.mission.scenario.teams[entity.team], stat.index);
          const defense = verifiedNativeDefenseFromLegacy(stat, levels);
          if (!defense.supported) throw new Error(`Source defense transition: ${defense.diagnostic}`);
          this.simulation.updateStaticSourceDefense(binding.simulationId, defense.profile);
        }
      }
      this.#unitStats.set(binding.simulationId, stat);
      const objectIndex = this.#staticObjects.findIndex(({ id }) => id === binding.simulationId);
      if (objectIndex >= 0) this.#staticObjects[objectIndex] = { ...this.#staticObjects[objectIndex], stat,
        ...(constructionEffects?.some(effect => effect.action === "upgrade" && effect.key === entity.key)
          ? { entity: { ...this.#staticObjects[objectIndex].entity, unitType: stat.index } } : {}) };
    }
    for (const planned of frame.entry.commands) {
      const command = planned.command;
      if (command.kind !== "waypoint") continue;
      for (const entity of frame.world.entities.filter(({ tileX, tileY }) => tileX === command.tileX && tileY === command.tileY)) {
        const binding = this.#nativeBindings.get(`${entity.rawSlot}:${entity.generation}`);
        if (!binding) throw new Error(`Waypoint has no simulation identity: ${entity.key}`);
        const points = command.points.map(({ tileX, tileY }) => ({ x: tileX, y: tileY }));
        this.#waypointRoutes.set(binding.simulationId, { points, nextIndex: 0 });
      }
    }
    const bail = frame.controller.runtime.bail;
    this.#outcome = bail ? { resultCode: bail.resultCode, reasonCode: bail.reasonCode, ready: frame.bailExpired } : null;
  }

  get terrainImage(): HTMLImageElement | null { return this.#terrainImage; }

  get cameraView(): { x: number; y: number; width: number; height: number } {
    return { x: this.#cameraX - 8, y: this.#cameraY - 452 / 64, width: 16, height: 452 / 32 };
  }

  get visibility(): Uint8Array {
    return this.#visibilityForSnapshot(this.simulation.snapshot);
  }

  get researchDiscovery() {
    if (!this.#research || !this.#type37World) return undefined;
    const visible = this.visibility;
    return projectBrowserType37Discovery(this.#type37World, this.#research, {
      research: this.#research, scienceOwner: this.#research.scienceOwner, localTeam: 0,
      presentationPolicy: "adapted-original-cursor-v1",
      isTileVisible: (tileX, tileY) => visible[tileY * this.grid.width + tileX] === 1,
    });
  }

  visibilityForTeam(team: number): Uint8Array {
    if (!Number.isInteger(team) || team < 0 || team > 7) throw new RangeError("Visibility team must be 0..7");
    if (this.mission.runtimeProfile !== "browser-adapted" && team !== 0) {
      throw new RangeError("Team visibility requires the adapted profile");
    }
    return this.#visibilityForSnapshot(this.simulation.snapshot, team);
  }

  #visibilityForSnapshot(snapshot: SimulationSnapshot, team = 0): Uint8Array {
    if (this.#nativeVisibilityConfiguration) {
      if (!this.#nativeViewState) throw new TypeError("Native visibility projection is unavailable");
      return sourceNativeVisibilityPlane(this.#nativeViewState.visibility, this.grid, this.#nativeVisibilityConfiguration.localMask);
    }
    const result = new Uint8Array(this.grid.width * this.grid.height);
    const sharedVision = this.mission.runtimeProfile === "browser-adapted"
      ? this.#session?.adaptedTroProjection?.state.sharedVision[team] : undefined;
    const artifacts = this.mission.runtimeProfile === "browser-adapted" ? snapshot.staticTargets.filter(target => {
      const stat = this.#unitStats.get(target.id);
      return stat && browserVisionArtifact(stat);
    }) : [];
    const artifactIds = new Set(artifacts.map(({ id }) => id));
    // Owned structures reveal a smaller area than mobile units (half their GAMESTAT observation, min 3 cells).
    const structures = team !== 0 ? [] : snapshot.staticTargets.filter(target =>
      !artifactIds.has(target.id) && this.#unitStats.has(target.id) && this.isOwnedUnit(target.id));
    const structureSet = new Set<object>(structures);
    for (const unit of [...snapshot.units, ...artifacts, ...structures]) {
      const observerTeam = this.#unitTeams.get(unit.id);
      const observes = sharedVision ? observerTeam === team
        || observerTeam !== undefined && sharedVision[observerTeam] === 1 : this.isOwnedUnit(unit.id);
      if (!observes || unit.health <= 0 || ("activity" in unit && unit.activity === "die")) continue;
      const stat = this.#unitStats.get(unit.id)!;
      const light = snapshot.daylightPermille;
      const sight = Math.floor((stat.observationNight * (1000 - light) + stat.observationDay * light) / 1000);
      const radius = structureSet.has(unit) ? Math.max(3, sight >> 1) : sight;
      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        const extent = radius - Math.abs(offsetY);
        for (let offsetX = -extent; offsetX <= extent; offsetX += 1) {
          const x = unit.cellX + offsetX, y = unit.cellY + offsetY;
          if (this.grid.contains(x, y)) result[y * this.grid.width + x] = 1;
        }
      }
    }
    if (this.#combatReveals.size) for (const actor of [...snapshot.units, ...snapshot.staticTargets]) {
      const reveal = this.#combatReveals.get(actor.id);
      if (reveal && reveal.expiresAt > snapshot.tick && actor.health > 0 &&
        (reveal.team === team || sharedVision?.[reveal.team] === 1)) {
        result[actor.cellY * this.grid.width + actor.cellX] = 1;
      }
    }
    return result;
  }

  #recordCombatReveals(): void {
    const shots = this.simulation.combatEvents;
    if (!shots.length && !this.#combatReveals.size) return;
    const snapshot = this.simulation.snapshot;
    const actors = new Map([...snapshot.units, ...snapshot.staticTargets].map(actor => [actor.id, actor]));
    const victims = new Map([...this.#previousSnapshot.units, ...this.#previousSnapshot.staticTargets, ...actors.values()]
      .map(actor => [actor.id, actor]));
    for (const shot of shots) {
      const stat = this.#unitStats.get(shot.attackerId), target = victims.get(shot.targetId);
      if (!stat || target?.team === undefined || target.team > 7) continue;
      const duration = firingRevealTicks(stat);
      if (duration > 0) this.#combatReveals.set(shot.attackerId, { team: target.team, expiresAt: shot.tick + 1 + duration });
      else this.#combatReveals.delete(shot.attackerId);
    }
    for (const [id, reveal] of this.#combatReveals) {
      const actor = actors.get(id);
      if (!actor || actor.health <= 0 || snapshot.tick >= reveal.expiresAt) this.#combatReveals.delete(id);
    }
  }

  get explored(): Uint8Array { return this.#explored.slice(); }

  #recordExploration(): void {
    if (this.#nativeVisibilityConfiguration) {
      if (!this.#nativeViewState) throw new TypeError("Native exploration projection is unavailable");
      this.#explored.set(sourceNativeVisibilityPlane(this.#nativeViewState.visibility, this.grid, 0x80000000));
      return;
    }
    const visible = this.visibility;
    for (let index = 0; index < visible.length; index += 1) {
      if (visible[index]) this.#explored[index] = 1;
    }
  }

  setCameraCenter(x: number, y: number): void {
    this.#awaitingPlayerFocus = false;
    this.#cameraX = x;
    this.#cameraY = y;
    this.render();
  }

  replaceSelection(ids: readonly number[]): void {
    this.#waypointDraft = null;
    const alive = new Set(this.simulation.snapshot.units.filter((unit) =>
      this.isOwnedUnit(unit.id) && unit.activity !== "die").map(({ id }) => id));
    this.#selectedIds.clear();
    for (const id of ids) if (alive.has(id)) this.#selectedIds.add(id);
    this.callbacks.onUnitsChanged(this.simulation.snapshot.units, this.selectedIds);
    this.#playResponse("unit-selected");
    this.render();
  }

  #playResponse(type: "unit-selected" | "unit-move"): void {
    const stat = this.#unitStats.get(this.selectedId);
    if (stat) this.#audioFeedback?.response(type, stat.index);
  }

  selectUnit(id: number, additive = false): void {
    const unit = this.simulation.snapshot.units.find((candidate) => candidate.id === id);
    if (!unit || this.#unitTeams.get(id) !== 0 || unit.faction !== this.playerFaction || unit.activity === "die") return;
    this.#waypointDraft = null;
    if (!additive) this.#selectedIds.clear();
    if (additive && this.#selectedIds.has(id)) this.#selectedIds.delete(id);
    else this.#selectedIds.add(id);
    this.#playResponse("unit-selected");
    this.callbacks.onUnitsChanged(this.simulation.snapshot.units, this.selectedIds);
    this.render();
  }

  selectAllPlayerUnits(): void {
    this.#waypointDraft = null;
    this.#selectedIds.clear();
    for (const unit of this.simulation.snapshot.units) {
      if (this.#unitTeams.get(unit.id) === 0 && unit.faction === this.playerFaction && unit.activity !== "die") {
        this.#selectedIds.add(unit.id);
      }
    }
    this.#playResponse("unit-selected");
    this.callbacks.onUnitsChanged(this.simulation.snapshot.units, this.selectedIds);
    this.render();
  }

  clearSelection(): void {
    this.#waypointDraft = null;
    this.#selectedIds.clear();
    this.callbacks.onUnitsChanged(this.simulation.snapshot.units, this.selectedIds);
    this.render();
  }

  selectUnitsInClientRect(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    additive = false,
  ): void {
    this.#waypointDraft = null;
    const bounds = this.canvas.getBoundingClientRect();
    const left = Math.max(0, (Math.min(startX, endX) - bounds.left) * 512 / bounds.width);
    const right = Math.min(512, (Math.max(startX, endX) - bounds.left) * 512 / bounds.width);
    const top = Math.max(0, (Math.min(startY, endY) - bounds.top) * 452 / bounds.height);
    const bottom = Math.min(452, (Math.max(startY, endY) - bounds.top) * 452 / bounds.height);
    if (!additive) this.#selectedIds.clear();
    for (const unit of this.simulation.snapshot.units) {
      if (this.#unitTeams.get(unit.id) !== 0 || unit.faction !== this.playerFaction || unit.activity === "die") continue;
      const body = this.#entityScreenBounds(unit);
      if (left <= right && top <= bottom && body.right >= left && body.left <= right && body.bottom >= top && body.top <= bottom) {
        this.#selectedIds.add(unit.id);
      }
    }
    this.callbacks.onUnitsChanged(this.simulation.snapshot.units, this.selectedIds);
    this.render();
  }

  selectVisibleInfantry(): void {
    this.#waypointDraft = null;
    this.#selectedIds.clear();
    for (const unit of this.simulation.snapshot.units) {
      const stat = this.#unitStats.get(unit.id);
      if (
        this.#unitTeams.get(unit.id) !== 0 ||
        unit.faction !== this.playerFaction ||
        unit.activity === "die" ||
        !stat ||
        (stat.sprite !== "TRSC" && stat.sprite !== "GRAY")
      ) {
        continue;
      }
      const body = this.#entityScreenBounds(unit);
      if (body.right >= 0 && body.left <= 512 && body.bottom >= 0 && body.top <= 452) {
        this.#selectedIds.add(unit.id);
      }
    }
    this.callbacks.onUnitsChanged(this.simulation.snapshot.units, this.selectedIds);
    this.render();
  }

  stopSelected(): void {
    if (this.mission.sourceNativeCombat) {
      if (!this.mission.sourceNativeCombat.playerCommands) throw new TypeError("Use advanceNativeCombat with an authenticated native receipt");
      this.queueNativePlayerOrder({ type: "Stop" });
      return;
    }
    this.#waypointDraft = null;
    if (this.#selectedIds.size === 0 || this.#missionDiagnostic || this.#outcome?.ready) return;
    if (this.selectedIds.some(id => this.simulation.resourceActors.some(actor => actor.simulationId === id))) {
      if (this.selectedIds.length !== 1) { this.#resourceDiagnostic = "Bounded native commands require one harvester"; return; }
      const binding = this.#simulationBindings.get(this.selectedId)!;
      this.#nativeCommand({ type: "stop", slot: binding.slot, generation: binding.generation });
      return;
    }
    for (const id of this.#selectedIds) this.#waypointRoutes.delete(id);
    this.#browserEconomy?.stop(this.simulation, this.selectedIds);
    this.#combatMovement.cancel(this.selectedIds);
    this.#guardAttacks.cancel(this.selectedIds);
    this.#orderMode = "context";
    const economyIds = new Set(this.#browserEconomy?.checkpoint().bindings.map(binding => binding.simulationId));
    const unitIds = this.selectedIds.filter(id => !economyIds.has(id));
    if (unitIds.length) this.simulation.queue({ type: "stop", unitIds });
  }

  setOrderMode(mode: "move" | "assault" | "patrol" | "waypoints"): void {
    if (this.mission.sourceNativeCombat?.playerCommands && (mode === "patrol" || mode === "waypoints")) {
      this.#rejectNativeCommand("Native patrol and waypoint queues are unproved");
      return;
    }
    if (mode !== "waypoints") this.#waypointDraft = null;
    this.#orderMode = mode;
    if (mode === "move" || mode === "assault") this.#movementStance = mode;
  }

  get orderMode(): string { return this.#orderMode; }
  enableDiagonalGroundMovement(): void {
    if (this.mission.sourceNativeCombat || sourceConstructionSources(this.mission)) {
      throw new TypeError("Native-owned missions cannot change their ground movement policy");
    }
    this.simulation.enableDiagonalGroundMovement();
  }

  get movementStance(): "move" | "assault" { return this.#movementStance; }
  get plottedWaypoints(): readonly { x: number; y: number }[] {
    return this.#waypointDraft?.points.map((point) => ({ ...point })) ?? [];
  }

  #entityScreenBounds(entity: { id: number; xSubcells: number; ySubcells: number }): FinBodyBounds {
    const rendered = this.#visualBounds.get(entity.id);
    if (rendered) return rendered;
    const x = this.#screenX(entity.xSubcells / SUBCELLS_PER_CELL, 512);
    const y = this.#screenY(entity.ySubcells / SUBCELLS_PER_CELL, 452);
    return { left: x - 12, right: x + 12, top: y - 32, bottom: y + 6 };
  }

  #pointerTarget(clientX: number, clientY: number, cursorOnly = false) {
    const bounds = this.canvas.getBoundingClientRect();
    const logicalX = (clientX - bounds.left) * 512 / bounds.width;
    const logicalY = (clientY - bounds.top) * 452 / bounds.height;
    const cellX = Math.floor(this.#cameraX + (logicalX - 256) / this.#tileSize);
    const cellY = Math.floor(screenYToWorld(logicalY, this.#cameraY, 452, this.#tileSize));
    const snapshot = this.simulation.snapshot;
    const visibility = this.visibility;
    const entities = [...snapshot.units, ...snapshot.staticTargets].filter((entity) => entity.health > 0 &&
      !(this.#browserEconomy && this.#unitStats.get(entity.id)?.index === 40) &&
      (this.isOwnedUnit(entity.id) || visibility[entity.cellY * this.grid.width + entity.cellX]));
    const bodyHit = (entity: typeof entities[number]) => {
      const body = this.#entityScreenBounds(entity);
      return logicalX >= body.left && logicalX <= body.right && logicalY >= body.top && logicalY <= body.bottom;
    };
    const hits = entities.filter(entity => bodyHit(entity) ||
      ((!this.#visualBounds.has(entity.id) || !("cargo" in entity)) && entity.cellX === cellX && entity.cellY === cellY))
      .sort((left, right) => Number(bodyHit(right)) - Number(bodyHit(left))
        || left.ySubcells - right.ySubcells || right.id - left.id);
    if (cursorOnly && (this.#cursorCache?.session !== this.#session || this.#cursorCache?.tick !== snapshot.tick)) {
      this.#cursorCache = { session: this.#session, tick: snapshot.tick, sources: this.resourceSources };
    }
    const resource = (cursorOnly ? this.#cursorCache!.sources : this.resourceSources).filter(source => {
      const column = source.position.x >> 8, row = source.position.y >> 8;
      if (source.status !== 1 || !visibility[row * this.grid.width + column]) return false;
      if (column === cellX && row === cellY) return true;
      const screenX = this.#screenX(source.position.x / 256, 512);
      const screenY = this.#screenY(source.position.y / 256, 452);
      return Math.abs(logicalX - screenX) <= 12 && logicalY >= screenY - 32 && logicalY <= screenY + 6;
    }).sort((left, right) => {
      const distance = (source: typeof left) => Math.abs(logicalX - this.#screenX(source.position.x / 256, 512))
        + Math.abs(logicalY - this.#screenY(source.position.y / 256, 452));
      return distance(left) - distance(right) || left.slot - right.slot;
    })[0];
    return { cellX, cellY, entity: hits[0], resource };
  }

  cursorAt(clientX: number, clientY: number, dragging = false): MissionCursor {
    if (this.#disposed || this.#missionDiagnostic || this.#outcome?.ready) return "default";
    if (dragging) return "drag";
    const { cellX, cellY, entity, resource } = this.#pointerTarget(clientX, clientY, true);
    const native = this.selectedIds.map(id => this.simulation.resourceActors.find(actor => actor.simulationId === id));
    if (native.some(Boolean) && !(entity && this.isOwnedUnit(entity.id) && this.#orderMode === "context")) {
      if (native.length !== 1 || !native[0] || !this.#session || !["context", "move"].includes(this.#orderMode)) return "blocked";
      const command: NativeHarvestCommand = { type: resource ? "harvest" : "move", slot: native[0].slot,
        generation: native[0].generation, target: { x: cellX, y: cellY }, ...(resource ? { sourceSlot: resource.slot } : {}) };
      const key = [native[0].simulationId, native[0].slot, native[0].generation, native[0].owner,
        native[0].ownershipGeneration, this.#orderMode, cellX, cellY, resource?.slot, resource?.generation,
        resource?.position.x, resource?.position.y].join(":");
      const cache = this.#cursorCache!;
      if (cache.admission?.key === key) return cache.admission.cursor;
      const cursor = commandNativeHarvest(this.#session.snapshot.world, command).ok ? "move" : "blocked";
      cache.admission = { key, cursor };
      return cursor;
    }
    if (entity && this.isOwnedUnit(entity.id) && "activity" in entity && this.#orderMode === "context") return "select";
    if (this.mission.sourceNativeCombat) {
      if (!this.nativeCommandMenu[0].enabled || entity || !["context", "move", "assault"].includes(this.#orderMode)) return "blocked";
      const binding = this.#simulationBindings.get(this.selectedId)!, state = this.#nativeViewState!;
      const actor = state.transport.slots[binding.slot]!;
      const profile = this.mission.sourceNativeCombat.options.nativeAiTasks.profiles[actor.nativeAiTask!.profile];
      const originX = actor.position.x >>> 8, originY = actor.position.y >>> 8;
      const distance = Math.abs(cellX - originX), direction = Math.sign(cellX - originX);
      if (!this.grid.contains(cellX, cellY) || cellX > 255 || cellY > 255 || cellY !== originY || distance < 1 || distance > 3) return "blocked";
      const origin = originY * this.grid.width + originX, ground = state.visibility.groundWords;
      if (!profile.families[origin] || (ground[origin] & 1023) !== actor.slot) return "blocked";
      for (let step = 1; step <= distance; step++) {
        const cell = origin + direction * step;
        if (profile.families[cell] !== profile.families[origin] || (ground[cell] & 1023) !== 1023 || profile.air[cell] >>> 10 !== 0) return "blocked";
      }
      return this.#orderMode === "assault" ? "attack" : "move";
    }
    if (this.#selectedIds.size === 0) return "default";
    if (this.selectedIds.every(id => this.#browserEconomy?.deployedInterceptors.includes(id))) return "blocked";
    if (resource && this.#browserEconomy && ["context", "move"].includes(this.#orderMode)) {
      return (resource.remaining ?? 0) > 0 && (resource.rate ?? 0) > 0 &&
        this.selectedIds.some(id => [6, 14].includes(this.#unitStats.get(id)?.index ?? -1)) ? "move" : "blocked";
    }
    if (entity && areHostile({ faction: this.playerFaction, team: 0 }, entity, this.simulation.snapshot.teamAlliances) &&
      (this.#orderMode === "context" || this.#orderMode === "assault")) return "attack";
    if (!this.grid.isPassable(cellX, cellY) && !(this.grid.contains(cellX, cellY) && this.simulation.snapshot.units.some(unit =>
      this.#selectedIds.has(unit.id) && unit.movementPlane === "air"))) return "blocked";
    return this.#orderMode === "assault" ? "attack" : "move";
  }

  resetClock(): void {
    this.#lastTime = null;
    this.clock.reset();
  }

  panByCells(deltaX: number, deltaY: number, render = true): void {
    this.#awaitingPlayerFocus = false;
    this.#cameraX += deltaX;
    this.#cameraY += deltaY;
    if (render) this.render();
  }

  #advanceFrame(constructionInput?: SourceConstructionFrame): void {
    if (this.mission.sourceNativeCombat) throw new TypeError("Native combat requires explicit native visits");
    this.#assertConstructionProjection();
    for (const actor of this.simulation.resourceActors) {
      if (actor.owner !== "simulation") continue;
      const result = this.#session!.resumeResourceIdle(actor.slot, actor.generation);
      if (!result.ok) throw new Error(result.diagnostics.map(entry => entry.message).join("; "));
      const record = transportHostState(result.value).slots[actor.slot]!;
      this.simulation.claimResourceActor({ simulationId: actor.simulationId, slot: actor.slot, generation: actor.generation,
        key: actor.key, ownershipGeneration: actor.ownershipGeneration }, this.#resourceProfile(record));
    }
    this.#previousSnapshot = this.simulation.snapshot;
    let activeTeams: readonly number[] = [];
    if (this.#browserAi) {
      const frame = this.#stepSession(constructionInput)!;
      const projection = this.#session!.browserAiProjection!;
      const adaptedTroProjection = this.#session!.adaptedTroProjection!;
      if (adaptedTroProjection.state.noPickup.some(flag => flag !== 0) &&
        (this.mission.runtimeProfile !== "browser-adapted" || frame.world.browserCasualtyPickup?.runtimeProfile !== "browser-adapted")) {
        throw new Error("adapted nopickup requires an automatic casualty-pickup owner; explicit abduct is unaffected");
      }
      this.simulation.setTeamAlliances(adaptedTroProjection.teamAlliances);
      this.#browserEconomy!.synchronizeSourceRates(frame.world);
      const snapshot = this.simulation.snapshot;
      const observations = new Map([...snapshot.units, ...snapshot.staticTargets].map(actor => [actor.id, actor]));
      const actors = frame.world.entities.map(actor => {
        const binding = this.#nativeBindings.get(`${actor.rawSlot}:${actor.generation}`);
        return { ...actor, health: observations.get(binding?.simulationId ?? -1)?.health ?? 0 };
      });
      const staticCells = this.simulation.staticObstacleCells;
      const staticObstacles = Object.fromEntries(this.mission.browserAi!.teams.map(team => [team.team, staticCells]));
      const visibleIdsByTeam = Object.fromEntries(this.mission.browserAi!.teams.map(({ team }) => {
        const visible = this.#visibilityForSnapshot(snapshot, team);
        return [team, [...observations.values()].filter(actor => visible[actor.cellY * this.grid.width + actor.cellX])
          .map(actor => actor.id)];
      }));
      const policyChanged = frame.entry.commands.some(({ command }) =>
        ["ai", "ally", "vision", "aimsg"].includes(command.kind));
      const previousAi = policyChanged ? { ...this.#browserAi, strategy: { ...this.#browserAi.strategy,
        nextDecisionTick: snapshot.tick } } : this.#browserAi;
      const plan = planBrowserCampaignViewFrame(projection, this.mission.browserAi!, previousAi,
        { snapshot, actors, nativeBindings: this.nativeBindings, staticObstacles, visibleIdsByTeam, adaptedTroProjection,
          targetCanDamage: (attackerId, targetId) => this.simulation.canAutoTarget(attackerId, targetId) });
      for (const order of plan.commands) {
        if ("unitIds" in order.command) {
          this.#combatMovement.cancel(order.command.unitIds);
          this.#guardAttacks.cancel(order.command.unitIds);
          for (const id of order.command.unitIds) this.#waypointRoutes.delete(id);
        }
        this.simulation.queue(order.command);
      }
      this.#browserAi = plan.state;
      activeTeams = projection.selectors.modes.flatMap((mode, team) => [1, 2, 3].includes(mode) ? [team] : []);
    }
    const guards = this.simulation.snapshot.units.filter(unit => !activeTeams.includes(unit.team ?? -1) &&
      (this.#unitStats.get(unit.id)?.weapons[0] ?? -1) >= 0).map(unit => {
      const stat = this.#unitStats.get(unit.id)!;
      return { id: unit.id, dayRangeCells: stat.observationDay, nightRangeCells: stat.observationNight,
        autonomousAttack: this.#combatMovement.interrupted(unit.id),
        targetCanDamage: (targetId: number) => this.simulation.canAutoTarget(unit.id, targetId) };
    });
    const guardSnapshot = this.#browserEconomy ? { ...this.simulation.snapshot,
      staticTargets: this.simulation.snapshot.staticTargets.filter(target => this.#unitStats.get(target.id)?.index !== 40) }
      : this.simulation.snapshot;
    const guardCommands = this.#combatMovement.update(guardSnapshot,
      this.#guardAttacks.observers(guardSnapshot, guards), this.simulation.combatEvents);
    this.#guardAttacks.record(guardCommands);
    for (const command of guardCommands) this.simulation.queue(command);
    this.#browserEconomy?.assignComputerHarvesters(this.simulation);
    this.#browserEconomy?.haltDeployed(this.simulation);
    if (this.mission.runtimeProfile === "browser-adapted") {
      this.#contactDormant ??= this.#contactDormantIds(this.#session!.snapshot.world);
      this.simulation.setDormantUnits(this.#contactDormant);
      this.#registerInspireCasters();
    }
    this.simulation.advance();
    this.#browserEconomy?.observe(this.simulation,
      this.#browserEconomy.deployedInterceptors.length ? this.#incomeInterceptionFrame() : undefined);
    this.#assertConstructionProjection(true);
    if (this.simulation.sourceDamageDiagnostics.length) throw new Error(`Unsupported native hit: ${JSON.stringify(this.simulation.sourceDamageDiagnostics)}`);
    if (!this.#browserAi) this.#stepSession(constructionInput);
    this.#assertConstructionProjection();
    this.#recordCombatReveals();
    this.#recordExploration();
    this.#presentCombatEvents();
    this.#advanceWaypointRoutes();
    if (this.mission.runtimeProfile === "browser-adapted") this.#clearProductionExits();
  }

  // DC.EXE flags the exit occupant (+0x35 = 0) so its idle consumer steps aside; the adapted runtime has no such consumer,
  // so an idle unit parked on the exit stalled every later unit from that producer.
  #clearProductionExits(): void {
    const exits = this.#session?.browserWaitingProductionExits;
    if (!exits?.length) return;
    const units = this.simulation.snapshot.units.filter(unit => unit.health > 0 && unit.activity !== "die");
    const occupied = new Set(units.map(unit => unit.cellY * this.grid.width + unit.cellX));
    for (const exit of exits) {
      const blocker = units.find(unit => unit.cellX === exit.x && unit.cellY === exit.y && unit.team === exit.team
        && unit.activity === "idle" && unit.movementPlane !== "air");
      if (!blocker) continue;
      let target: { x: number; y: number } | undefined;
      for (let ring = 2; ring <= 4 && !target; ring++) for (let dy = -ring; dy <= ring && !target; dy++) for (let dx = -ring; dx <= ring; dx++) {
        const x = exit.x + dx, y = exit.y + dy;
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring || !this.grid.isPassable(x, y) || occupied.has(y * this.grid.width + x)) continue;
        target = { x, y }; break;
      }
      if (!target) continue;
      occupied.add(target.y * this.grid.width + target.x);
      this.simulation.queue({ type: "move", unitIds: [blocker.id], target });
    }
  }

  #commitRuntime(candidate: MissionView, transfer = false): void {
    this.#simulation = candidate.#simulation; this.#session = candidate.#session;
    this.#browserAi = candidate.#browserAi;
    this.#browserEconomy = candidate.#browserEconomy;
    this.#type37World = candidate.#type37World;
    this.#research = candidate.#research;
    this.#nativeCombatProjection = candidate.#nativeCombatProjection;
    this.#pendingNativeCommand = candidate.#pendingNativeCommand ? structuredClone(candidate.#pendingNativeCommand) : undefined;
    this.#nativeCommandDiagnostic = candidate.#nativeCommandDiagnostic;
    this.#nativeCombatPresentation = candidate.#nativeCombatPresentation;
    this.#nativeViewState = candidate.#nativeViewState;
    this.#nativeViewResources = candidate.#nativeViewResources;
    this.#nativeViewSamples = candidate.#nativeViewSamples;
    this.#cursorCache = null;
    this.#combatMovement = candidate.#combatMovement;
    this.#guardAttacks = candidate.#guardAttacks;
    this.#previousSnapshot = candidate.#previousSnapshot;
    // A committed candidate is discarded, so its private copies can be taken over instead of cloned a second time.
    const copyMap = <Key, Value>(target: Map<Key, Value>, source: Map<Key, Value>) => {
      target.clear(); source.forEach((value, key) => target.set(key, transfer ? value : structuredClone(value)));
    };
    copyMap(this.#sceneIdentities, candidate.#sceneIdentities);
    copyMap(this.#nativeBindings, candidate.#nativeBindings); copyMap(this.#simulationBindings, candidate.#simulationBindings);
    copyMap(this.#unitStats, candidate.#unitStats); copyMap(this.#unitWeaponIds, candidate.#unitWeaponIds);
    copyMap(this.#unitTeams, candidate.#unitTeams); copyMap(this.#waypointRoutes, candidate.#waypointRoutes);
    copyMap(this.#animationStates, candidate.#animationStates);
    copyMap(this.#combatReveals, candidate.#combatReveals);
    for (const [target, source] of [[this.#selectedIds, candidate.#selectedIds], [this.#detachedIds, candidate.#detachedIds],
      [this.#recordedDeaths, candidate.#recordedDeaths]]) { target.clear(); source.forEach(value => target.add(value)); }
    this.#staticObjects.splice(0, this.#staticObjects.length, ...candidate.#staticObjects);
    this.#pendingReservations.splice(0, this.#pendingReservations.length, ...candidate.#pendingReservations);
    this.#pendingProduction = candidate.#pendingProduction;
    this.#pendingConstruction = candidate.#pendingConstruction;
    this.#explored.set(candidate.#explored);
    this.#cameraX = candidate.#cameraX; this.#cameraY = candidate.#cameraY; this.#awaitingPlayerFocus = candidate.#awaitingPlayerFocus;
    this.#carriers = candidate.#carriers; this.#outcome = candidate.#outcome; this.#latestMessage = candidate.#latestMessage;
    this.#orderMode = candidate.#orderMode; this.#movementStance = candidate.#movementStance;
    this.#waypointDraft = structuredClone(candidate.#waypointDraft);
    this.#resourceDiagnostic = candidate.#resourceDiagnostic;
  }

  update(time: number): void {
    if (this.#disposed) return;
    if (sourceConstructionSources(this.mission) || this.mission.sourceNativeCombat) { this.render(); return; }
    if (this.#missionDiagnostic || this.#outcome?.ready) { this.render(); return; }
    if (this.#lastTime === null) this.#lastTime = time;
    const elapsed = Math.min(250, Math.max(0, time - this.#lastTime));
    this.#lastTime = time;
    const result = this.clock.consume(elapsed, () => {
      if (this.#missionDiagnostic || this.#outcome?.ready) return;
      try {
      if (this.#browserAi || this.mission.sourceResource?.resourceLifecycle.nativeHarvest) {
        const candidate = new MissionView(this.canvas, this.stage, { onStats() {}, onUnitsChanged() {} }, this.mission, undefined, this);
        candidate.#advanceFrame();
        this.#commitRuntime(candidate, true);
        this.#presentCombatEvents();
        if (this.#audio) for (const request of this.#session?.latestJournalEntry?.requests ?? []) {
          if (request.type === "source-sound") void this.#audio.play({ assetId: "SOUND/ERUPT.WAV", priority: 40 });
        }
        this.#emitContactSound(candidate);
      } else { this.#advanceFrame(); this.#emitContactSound(this); }
      } catch (error) { this.#failMission(error); }
    });
    this.#interpolation = result.interpolation;
    if (result.steps > 0) {
      this.#reconcileSelection();
      this.callbacks.onUnitsChanged(this.simulation.snapshot.units, this.selectedIds);
    }
    this.render();
  }

  commandAt(clientX: number, clientY: number, additiveSelection = false): void {
    if (this.#disposed || this.#missionDiagnostic || this.#outcome?.ready) return;
    const { cellX: x, cellY: y, entity, resource } = this.#pointerTarget(clientX, clientY);
    if (!this.grid.contains(x, y)) return;
    const snapshot = this.simulation.snapshot;
    const friendly = entity && this.isOwnedUnit(entity.id) && "activity" in entity ? entity : undefined;
    if (friendly && this.#orderMode === "context") {
      this.selectUnit(friendly.id, additiveSelection);
      return;
    }
    if (this.mission.sourceNativeCombat) {
      if (!this.mission.sourceNativeCombat.playerCommands) throw new TypeError("Use advanceNativeCombat with an authenticated native Move/Attack receipt");
      if (entity) { this.#rejectNativeCommand("Native clicked-target Attack/occupied destination is unproved; bounded attack-move requires a free endpoint"); return; }
      if (!["context", "move", "assault"].includes(this.#orderMode)) { this.#rejectNativeCommand("Unproved native order mode"); return; }
      if (this.#orderMode === "assault") {
        try {
          if (!this.nativeCommandStatus.enabled || this.selectedIds.length !== 1) { this.#rejectNativeCommand("Only one selected native binding in an active input view is proved"); return; }
          if (this.#pendingNativeCommand) { this.#rejectNativeCommand("One native command is pending; advance it before another input"); return; }
          const world = this.#session!.snapshot.world;
          const target = sourceNativePlayerAcquiredTarget(this.#nativePlayerContext(world));
          if (!target) { this.#rejectNativeCommand("Bounded attack-move requires a current native acquired target"); return; }
          this.#enqueueNativePlayerOrder({ type: "Attack", destination: { column: x, row: y }, target }, world);
        } catch (error) { this.#rejectNativeCommand(error instanceof Error ? error.message : String(error)); }
      } else this.queueNativePlayerOrder({ type: "MoveOnly", destination: { column: x, row: y } });
      return;
    }
    const selected = snapshot.units.filter(
      (unit) => this.#selectedIds.has(unit.id) && unit.activity !== "die"
        && !this.#browserEconomy?.deployedInterceptors.includes(unit.id),
    );
    if (selected.length === 0) return;
    if (resource && this.#browserEconomy && ["context", "move"].includes(this.#orderMode)) {
      this.harvestSelected(resource.slot);
      return;
    }
    if (selected.some(unit => unit.resourceActor)) {
      if (selected.length !== 1 || !["context", "move"].includes(this.#orderMode)) {
        this.#resourceDiagnostic = "Only individual bounded native Move/Harvest commands are verified"; return;
      }
      if (resource) this.harvestSelected(resource.slot);
      else {
        const binding = this.#simulationBindings.get(selected[0].id)!;
        this.#nativeCommand({ type: "move", slot: binding.slot, generation: binding.generation, target: { x, y } });
      }
      return;
    }
    const enemy = entity && areHostile({ faction: this.playerFaction, team: 0 }, entity, snapshot.teamAlliances) ? entity : undefined;
    if (enemy && (this.#orderMode === "context" || this.#orderMode === "assault")) {
      this.#browserEconomy?.cancelOrders(selected.map(({ id }) => id));
      for (const unit of selected) this.#waypointRoutes.delete(unit.id);
      this.#combatMovement.cancel(selected.map(({ id }) => id));
      this.#guardAttacks.cancel(selected.map(({ id }) => id));
      this.simulation.queue({ type: "attack", unitIds: selected.map(({ id }) => id), targetId: enemy.id });
    } else if (this.grid.isPassable(x, y) || selected.some(unit => unit.movementPlane === "air")) {
      this.#browserEconomy?.cancelOrders(selected.map(({ id }) => id));
      if (this.#orderMode === "patrol") {
        for (const unit of selected) this.#waypointRoutes.set(unit.id, {
          points: [{ x: unit.cellX, y: unit.cellY }, { x, y }], nextIndex: 0, repeat: true,
        });
        this.#combatMovement.move(selected.map(({ id }) => id), { x, y }, true);
        this.#guardAttacks.cancel(selected.map(({ id }) => id));
        this.simulation.queue({ type: "move", unitIds: selected.map(({ id }) => id), target: { x, y } });
        this.#orderMode = "context";
      } else if (this.#orderMode === "waypoints") {
        const draft = this.#waypointDraft ?? { points: [], engage: this.#movementStance === "assault" };
        const last = draft.points.at(-1);
        if (last?.x !== x || last.y !== y) {
          draft.points.push({ x, y });
          this.#waypointDraft = draft;
          this.render();
          return;
        }
        const unitIds = selected.map(({ id }) => id);
        for (const id of unitIds) this.#waypointRoutes.set(id, {
          points: draft.points, nextIndex: 1, repeat: false, engage: draft.engage,
        });
        this.#combatMovement.move(unitIds, draft.points[0], draft.engage);
        this.#guardAttacks.cancel(unitIds);
        this.simulation.queue({ type: "move", unitIds, target: draft.points[0] });
        this.#waypointDraft = null;
        this.#orderMode = "context";
      } else {
        for (const unit of selected) this.#waypointRoutes.delete(unit.id);
        this.#combatMovement.move(selected.map(({ id }) => id), { x, y }, this.#movementStance === "assault");
        this.#guardAttacks.cancel(selected.map(({ id }) => id));
        this.simulation.queue({ type: "move", unitIds: selected.map(({ id }) => id), target: { x, y } });
        this.#orderMode = "context";
      }
    }
    else return;
    this.#playResponse("unit-move");
  }

  renderBoundedMode3(input: MissionViewMode3Frame) {
    const reject = (message: string) => {
      const diagnostic = message.startsWith("mode3-prepass-unverified:") ? message : `mode3-prepass-unverified:${message}`;
      reportRenderDiagnostic(diagnostic);
      return { exact: false as const, diagnostic };
    };
    if (this.#disposed) return reject("Disposed view");
    const context = this.canvas.getContext("2d", { willReadFrequently: true }), terrain = input.terrain ?? this.#indexedTerrain?.mode3;
    if (!context || !terrain || terrain.mission !== this.mission) return reject("Indexed terrain owner required");
    try {
      const snapshot = this.simulation.snapshot;
      const entities = input.capture(snapshot);
      const frame = createMissionSceneFrame({ mission: this.mission, indexed: terrain.indexed,
        camera: input.surface, entities });
      const result = frame.drawMode3Terrain(context, terrain, input);
      if (!result.exact) return reject(result.diagnostic);
      for (const entity of entities) frame.drawEntity(context, entity.rawSlot, input.image);
      for (const diagnostic of frame.diagnostics) reportRenderDiagnostic(diagnostic);
      for (const command of frame.commands) for (const diagnostic of command.diagnostics) reportRenderDiagnostic(diagnostic);
      return { ...result, scope: "bounded-terrain-prepass" as const, frame, tick: snapshot.tick };
    } catch (error) { return reject(error instanceof Error ? error.message : String(error)); }
  }

  render(): void {
    if (this.#disposed) return;
    const width = 512;
    const height = 452;
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    // Every mode-1 shadow reads the destination back (getImageData); on a GPU canvas each one stalled the frame (22% of H13 CPU).
    const context = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    this.#visualBounds.clear();
    beginMode1ShadowFrame(context);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);
    context.imageSmoothingEnabled = false;
    this.#tileSize = 32;
    this.#clampCamera(width, height);
    const firstX = Math.max(0, Math.floor(this.#cameraX - width / this.#tileSize / 2) - 1);
    const lastX = Math.min(this.grid.width - 1, Math.ceil(this.#cameraX + width / this.#tileSize / 2) + 1);
    const firstY = Math.max(0, Math.floor(this.#cameraY - height / this.#tileSize / 2) - 1);
    const lastY = Math.min(this.grid.height - 1, Math.ceil(this.#cameraY + height / this.#tileSize / 2) + 1);
    context.fillStyle = "#18140e";
    context.fillRect(0, 0, width, height);
    const snapshot = this.simulation.snapshot;
    const visibility = this.#visibilityForSnapshot(snapshot);
    if (this.#indexedTerrain) {
      try {
        // Fog, exploration and day/night only change on ticks, so the terrain is cached per tick. A camera move re-renders
        // synchronously to stay aligned with units; a tick-only change is read back asynchronously and shown one frame later,
        // because copying the WebGL canvas right after drawing stalled tick frames on the GPU (~5 ms).
        const terrain = this.#indexedTerrain;
        const blend = this.simulation.sourceDayNight?.blend;
        const cameraKey = `${this.#cameraX}|${this.#cameraY}|${width}x${height}`, contentKey = `${snapshot.tick}|${blend}`;
        const frame = { cameraX: this.#cameraX, cameraY: this.#cameraY, visible: visibility, explored: this.#explored,
          fog: "overlay" as const, blend };
        let cache = this.#terrainCache;
        if (cache && (cache.owner !== terrain || cache.cameraKey !== cameraKey)) {
          terrain.cancelReadback();
          cache = null;
        }
        if (cache?.pendingKey) {
          const image = terrain.collectReadback();
          const target = cache.canvas.getContext("2d", { willReadFrequently: true })!;
          if (image) {
            target.clearRect(0, 0, width, height);
            target.putImageData(image, 0, 0);
            cache.key = cache.pendingKey;
            cache.pendingKey = null;
          } else if (++cache.pendingFrames > 3) {
            terrain.cancelReadback();
            cache = null;
          }
        }
        if (!cache) {
          const canvas = this.#terrainCache?.canvas ?? this.canvas.ownerDocument.createElement("canvas");
          canvas.width = width; canvas.height = height;
          const target = canvas.getContext("2d", { willReadFrequently: true })!;
          target.clearRect(0, 0, width, height);
          target.drawImage(terrain.render(frame), 0, 0);
          cache = this.#terrainCache = { canvas, key: contentKey, cameraKey, owner: terrain, pendingKey: null, pendingFrames: 0 };
        } else if (cache.key !== contentKey && !cache.pendingKey) {
          terrain.renderAsync(frame);
          cache.pendingKey = contentKey;
          cache.pendingFrames = 0;
        }
        context.drawImage(cache.canvas, 0, 0);
      } catch (error) {
        this.#terrainFallback = error instanceof Error ? error.message : String(error);
        this.#indexedTerrain.dispose();
        this.#indexedTerrain = null;
      }
    }
    if (!this.#indexedTerrain) {
      for (let y = firstY; y <= lastY; y += 1) {
        for (let x = firstX; x <= lastX; x += 1) this.#drawTerrainCell(context, x, y, width, height);
      }
    }
    // Entity visibility is checked at its tile; fog must not clip a revealed sprite's head or muzzle.
    for (let y = firstY; y <= lastY; y += 1) {
      for (let x = firstX; x <= lastX; x += 1) {
        if (visibility[y * this.grid.width + x]) continue;
        context.fillStyle = this.#explored[y * this.grid.width + x] ? "rgba(3, 4, 3, .72)" : "#000000";
        context.fillRect(
          this.#screenX(x, width),
          this.#screenY(y + 1, height),
          this.#tileSize + 1,
          this.#tileSize + 1,
        );
      }
    }
    const drawables: { y: number; draw: () => void }[] = [];
    const overlays: (() => void)[] = [];
    const commanderMarkers: (() => void)[] = [];
    if (this.#research && this.#type37World && this.#discoveryCursor) {
      const projection = this.researchDiscovery!;
      const frame = this.#discoveryCursor;
      const image = projection.entries.some(entry => entry.visible) ? this.#spritePalettes?.image("CURSOR/CURS", 0) : undefined;
      if (image) for (const marker of projection.entries) {
        if (!marker.visible) continue;
        overlays.push(() => context.drawImage(image, frame.x, frame.y, frame.width, frame.height,
          this.#screenX(marker.tileX + 0.5, width) - frame.width / 2,
          this.#screenY(marker.tileY + 0.5, height) - frame.height / 2, frame.width, frame.height));
      }
    }
    for (const actor of this.constructionVisuals.filter(actor => actor.team === 8)) {
      const worldX = actor.position.x / 256, worldY = actor.position.y / 256;
      if (!visibility[Math.floor(worldY) * this.grid.width + Math.floor(worldX)]) continue;
      drawables.push({ y: actor.position.y * 4, draw: () => this.#drawVisual(context, actor.sprite, "idle",
        this.#screenX(worldX, width), this.#screenY(worldY, height) - actor.position.height / 8, snapshot.tick,
        undefined, { rawSlot: actor.nativeId, xSubcells: actor.position.x * 4, ySubcells: actor.position.y * 4,
          heightSubcells: actor.position.height * 4 }) });
    }
    for (const source of this.resourceSources) {
      if (this.#browserEconomy) continue;
      const worldX = source.position.x / 256, worldY = source.position.y / 256;
      if (source.status === 0 || !visibility[Math.floor(worldY) * this.grid.width + Math.floor(worldX)]) continue;
      drawables.push({ y: worldY * SUBCELLS_PER_CELL, draw: () => {
        const visual = this.#visuals.get("VENT");
        if (!visual || (!source.task && !source.presentation)) {
          this.#failMission(new Error("Neutral VENT requires native resource FIN/task ownership"));
          return;
        }
        try {
          const sample = source.presentation?.sample ?? missionResourceSample(visual.animation, source.task!);
          const parts = composeFinSample(sample, visual.lookup);
          if (!parts.length || parts.some(({ frame }) => !frame)) throw new Error("Missing VENT composition");
          drawFinComposition(context, parts, (name) => visual.atlases.get(name.toUpperCase())?.image,
            { x: this.#screenX(worldX, width), y: this.#screenY(worldY, height) }, 1,
            (part, origin, scale) => this.#drawBrowserEffect(context, part, origin, scale));
        } catch (error) { this.#failMission(error); }
      } });
    }
    const staticStates = new Map(snapshot.staticTargets.map((target) => [target.id, target]));
    for (const object of this.#staticObjects) {
      const { x, y } = object.entity;
      if (x < firstX || x > lastX || y < firstY || y > lastY) continue;
      if (this.#detachedIds.has(object.id)) continue;
      if (!this.isOwnedUnit(object.id) && !visibility[Math.floor(y + 0.5) * this.grid.width + Math.floor(x + 0.5)]) continue;
      drawables.push({
        y: (y + 0.5) * SUBCELLS_PER_CELL,
        draw: () => {
          const target = staticStates.get(object.id);
          if (!target) return;
          this.#drawVisual(context, object.stat.sprite, "idle", this.#screenX(x + 0.5, width), this.#screenY(y + 0.5, height), snapshot.tick, object.id,
            this.#sceneCapture(object.id, target.xSubcells, target.ySubcells));
        },
      });
    }
    const previousById = new Map(this.#previousSnapshot.units.map((unit) => [unit.id, unit]));
    for (const unit of snapshot.units) {
      if (unit.cellX < firstX || unit.cellX > lastX || unit.cellY < firstY || unit.cellY > lastY) continue;
      if (!this.isOwnedUnit(unit.id) && !visibility[unit.cellY * this.grid.width + unit.cellX]) continue;
      const previous = previousById.get(unit.id) ?? unit;
      const oldAnimation = this.#animationStates.get(unit.id);
      let action = missionUnitAction(unit, previous);
      if (action === "Attack" && !this.mission.sourceNativeCombat) {
        if (this.#genericPendingPaths?.simulation !== this.simulation || this.#genericPendingPaths.tick !== snapshot.tick) {
          this.#genericPendingPaths = { simulation: this.simulation, tick: snapshot.tick,
            ids: new Set(this.simulation.checkpoint().units.filter(actor =>
              actor.pathIndex < actor.path.length || actor.reservedDestination !== null).map(actor => actor.id)) };
        }
        action = missionUnitAction(unit, previous, this.#genericPendingPaths.ids.has(unit.id));
      }
      const target = action === "Attack" ? snapshot.units.find(({ id }) => id === unit.targetId) ??
        staticStates.get(unit.targetId ?? -1) : undefined;
      const facing = directionFromMotion(
        target ? target.xSubcells - unit.xSubcells : unit.xSubcells - previous.xSubcells,
        target ? unit.ySubcells - target.ySubcells : previous.ySubcells - unit.ySubcells,
        oldAnimation?.facing ?? "S",
      );
      this.#animationStates.set(unit.id, {
        action, facing,
        since: oldAnimation?.action === action && oldAnimation.facing === facing ? oldAnimation.since : snapshot.tick,
      });
      const xSubcells = previous.xSubcells + (unit.xSubcells - previous.xSubcells) * this.#interpolation;
      const ySubcells = previous.ySubcells + (unit.ySubcells - previous.ySubcells) * this.#interpolation;
      const screenX = this.#screenX(xSubcells / SUBCELLS_PER_CELL, width);
      const binding = this.#simulationBindings.get(unit.id);
      const sourceHeight = unit.movementPlane === "air" && binding ? this.#sceneIdentities.get(binding.slot)?.height ?? 0 : 0;
      const screenY = this.#screenY(ySubcells / SUBCELLS_PER_CELL, height) - sourceHeight / 8;
      const scene = xSubcells === unit.xSubcells && ySubcells === unit.ySubcells
        ? this.#sceneCapture(unit.id, unit.xSubcells, unit.ySubcells) : undefined;
      drawables.push({ y: ySubcells, draw: () => this.#drawUnit(context, unit, screenX, screenY, snapshot.tick, scene) });
      overlays.push(() => this.#drawUnitOverlay(context, unit, screenX, screenY));
      if (this.isOwnedUnit(unit.id) && sourceUnitIsCommander(this.#unitStats.get(unit.id)?.index ?? -1)) {
        commanderMarkers.push(() => this.#drawCommanderMarker(context, unit, screenX, screenY));
      }
    }
    drawables.sort((left, right) => right.y - left.y).forEach(({ draw }) => draw());

    for (const carrier of this.carrierVisuals) {
      const worldX = carrier.position.x / 256, worldY = carrier.position.y / 256;
      if (carrier.team !== 0 && !visibility[Math.floor(worldY) * this.grid.width + Math.floor(worldX)]) continue;
      const screenX = this.#screenX(worldX, width);
      const screenY = this.#screenY(worldY, height) - carrier.height / 256;
      const visual = this.#visuals.get(carrier.sprite);
      const stateName = carrier.sprite === "SAUC" ? "MIDDLE"
        : carrier.phase === "approach" || carrier.phase === "departure" ? "DROPMOVE0" : "DROPSTAND0";
      const state = visual?.animation.states.find(({ name, validRange }) => name === stateName && validRange !== false);
      try {
        if (!visual || !state) throw new Error(`Unsupported carrier asset/state: ${carrier.sprite}:${stateName}`);
        const sample = visual.sample({ state, action: "Stand", direction: null, fallback: false }, snapshot.tick + this.#interpolation);
        const parts = composeFinSample(sample, visual.lookup);
        if (!parts.length || parts.some(({ frame }) => !frame)) throw new Error(`Missing carrier composition: ${carrier.sprite}`);
        drawFinComposition(context, parts, (name, part) =>
          (part.child.valueA === 0 || part.child.valueA === 1) && this.#spritePalettes
            ? this.#spritePalettes.image(name, carrier.team)
            : visual.atlases.get(name.toUpperCase())?.image,
        { x: screenX, y: screenY }, 1, (part, origin, scale) => this.#drawBrowserEffect(context, part, origin, scale));
      } catch (error) {
        this.#failMission(error);
      }
    }

    for (const overlay of overlays) overlay();
    for (const marker of commanderMarkers) marker();
    const darkness = this.#indexedTerrain ? 0 : ((1000 - snapshot.daylightPermille) / 1000) * 0.24;
    context.fillStyle = `rgba(5, 8, 18, ${darkness.toFixed(3)})`;
    context.fillRect(0, 0, width, height);
    if (this.#waypointDraft && this.#selectedIds.size > 0) {
      const points = this.#waypointDraft.points.map(({ x, y }) => ({
        x: this.#screenX(x + 0.5, width), y: this.#screenY(y + 0.5, height),
      }));
      context.save();
      context.strokeStyle = "#f6da65";
      context.lineWidth = 1;
      context.setLineDash([3, 3]);
      context.beginPath();
      points.forEach((point, index) => {
        if (index === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      });
      context.stroke();
      context.setLineDash([]);
      context.font = "bold 10px monospace";
      context.textAlign = "center";
      context.textBaseline = "middle";
      points.forEach((point, index) => {
        const last = index === points.length - 1;
        context.fillStyle = last ? "#f6da65" : "#17201a";
        const size = Math.max(16, context.measureText(String(index + 1)).width + 6);
        context.fillRect(point.x - size / 2, point.y - 8, size, 16);
        context.strokeRect(point.x - size / 2, point.y - 8, size, 16);
        context.fillStyle = last ? "#17201a" : "#f6da65";
        context.fillText(String(index + 1), point.x, point.y);
      });
      context.restore();
    }
    if (this.#missionDiagnostic) {
      context.fillStyle = "#260c12";
      context.fillRect(0, 0, width, 112);
      context.fillStyle = "#ffffff";
      context.font = "12px monospace";
      const words = `MISSION STOPPED: ${this.#missionDiagnostic}`.split(/\s+/);
      let line = "", row = 18;
      for (const word of words) {
        for (const chunk of word.match(/.{1,60}/g) ?? []) {
          if (context.measureText(`${line} ${chunk}`).width > width - 24) {
            context.fillText(line, 12, row); row += 16; line = "";
          }
          line += `${line ? " " : ""}${chunk}`;
        }
      }
      context.fillText(line, 12, row);
    }
    endMode1ShadowFrame(context);
    const selected = snapshot.units.find(({ id }) => this.#selectedIds.has(id));
    this.callbacks.onStats({
      tick: snapshot.tick,
      selectedCell: selected ? `${selected.cellX}, ${selected.cellY}` : `${Math.round(this.#cameraX)}, ${Math.round(this.#cameraY)}`,
      daylight: `${snapshot.daylightPermille} / 1000`,
      selectedState: selected?.activity.toUpperCase() ?? "MISSION",
      healthAndResources: selected
        ? `${selected.health}/${selected.maxHealth} · TEAM 0`
        : `${this.mission.scenario.id.toUpperCase()} · TEAM 0`,
      unitCount: snapshot.units.length,
      selectedCount: this.#selectedIds.size,
      missionMessage: this.#latestMessage,
      missionDiagnostic: this.#missionDiagnostic,
    });
  }

  #advanceWaypointRoutes(): void {
    const units = new Map(this.simulation.snapshot.units.map((unit) => [unit.id, unit]));
    for (const [unitId, route] of this.#waypointRoutes) {
      const unit = units.get(unitId);
      if (!unit || unit.activity === "die") { this.#waypointRoutes.delete(unitId); continue; }
      if (!unit || unit.activity !== "idle") continue;
      if (this.#combatMovement.interrupted(unitId)) continue;
      if (route.nextIndex >= route.points.length) {
        if (route.repeat === false) { this.#waypointRoutes.delete(unitId); continue; }
        route.nextIndex = 0;
      }
      const target = route.points[route.nextIndex];
      if (!target) continue;
      this.#combatMovement.move([unitId], target, route.engage ?? true);
      this.#guardAttacks.cancel([unitId]);
      this.simulation.queue({ type: "move", unitIds: [unitId], target });
      route.nextIndex += 1;
    }
  }

  #presentCombatEvents(): void {
    const snapshot = this.simulation.snapshot;
    const units = new Map([...snapshot.units, ...snapshot.staticTargets].map((unit) => [unit.id, unit]));
    for (const target of snapshot.staticTargets) {
      if (target.weapon && target.health > 0 && target.targetId === null) {
        const previous = this.#animationStates.get(target.id);
        if (previous?.action === "Attack") this.#animationStates.set(target.id, { ...previous, action: "Stand", since: snapshot.tick });
      }
    }
    for (const event of this.simulation.deathEvents) {
      const previous = this.#animationStates.get(event.targetId);
      this.#animationStates.set(event.targetId, { action: "Die", facing: previous?.facing ?? "S", since: event.tick });
    }
    for (const event of this.simulation.combatEvents) {
      const attacker = units.get(event.attackerId);
      const target = units.get(event.targetId) ?? this.#staticTargetPosition(event.targetId);
      const stat = this.#unitStats.get(event.attackerId);
      if (!attacker || !stat) continue;
      const previous = this.#animationStates.get(attacker.id);
      const facing = target ? directionFromMotion(
        target.xSubcells - attacker.xSubcells, attacker.ySubcells - target.ySubcells,
        previous?.facing ?? "S",
      ) : previous?.facing ?? "S";
      if (attacker.activity !== "die") this.#animationStates.set(attacker.id, { action: "Attack", facing, since: event.tick });
    }
    if (this.#audioFeedback) {
      const positions = new Map([...this.#previousSnapshot.units, ...this.#previousSnapshot.staticTargets,
        ...snapshot.units, ...snapshot.staticTargets].map(actor => [actor.id, actor]));
      const actors = new Map([...positions].flatMap(([id, actor]) => {
        const stat = this.#unitStats.get(id);
        return stat ? [[id, { unitType: stat.index, weaponId: this.#unitWeaponIds.get(id) ?? stat.weapons[0],
          x: actor.xSubcells / SUBCELLS_PER_CELL, y: actor.ySubcells / SUBCELLS_PER_CELL }] as const] : [];
      }));
      this.#audioFeedback.present({ tick: snapshot.tick, shots: this.simulation.combatEvents,
        deaths: this.simulation.deathEvents, actors,
        listener: { x: this.#cameraX, y: this.#cameraY, halfWidth: 8, audibleRadius: 24 } });
    }
  }

  #staticTargetPosition(id: number): { xSubcells: number; ySubcells: number } | undefined {
    const target = this.simulation.snapshot.staticTargets.find((entry) => entry.id === id);
    return target ? {
      xSubcells: target.xSubcells,
      ySubcells: target.ySubcells,
    } : undefined;
  }

  #drawTerrainCell(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
    const destinationX = this.#screenX(x, width);
    const destinationY = this.#screenY(y + 1, height);
    if (!this.#terrainImage) return;
    const offset = ((this.grid.height - 1 - y) * this.grid.width + x) * 2;
    const attributes = this.mission.attributes[offset / 2];
    for (const layer of [0, 1] as const) {
      const recordIndex = this.mission.tileRecordIndices[offset + layer];
      if (layer === 1 && recordIndex === 0) continue;
      const tile = this.mission.terrain.tiles[recordIndex];
      if (!tile) continue;
      drawTerrainLayer(context, this.#terrainImage, tile,
        { x: destinationX, y: destinationY, width: this.#tileSize, height: this.#tileSize },
        attributes, layer);
    }
  }

  #sceneCapture(unitId: number, xSubcells: number, ySubcells: number) {
    const binding = this.#simulationBindings.get(unitId);
    const host = binding && this.#sceneIdentities.get(binding.slot);
    if (!binding || !host || host.generation !== binding.generation ||
      (host.height !== 0 && browserMovementPlane(this.mission, this.#unitStats.get(unitId)!) !== "air") ||
      !Number.isInteger(xSubcells) || !Number.isInteger(ySubcells)) return undefined;
    return { rawSlot: binding.slot, xSubcells, ySubcells, heightSubcells: host.height * 4 };
  }

  #drawUnit(context: CanvasRenderingContext2D, unit: UnitSnapshot, screenX: number, screenY: number, tick: number,
    scene?: Pick<MissionSceneEntity, "rawSlot" | "xSubcells" | "ySubcells" | "heightSubcells">): void {
    const stat = this.#unitStats.get(unit.id);
    const deployed = this.#browserEconomy?.deployedInterceptors.includes(unit.id);
    const miningType = stat && (stat.index === 6 || stat.index === 14)
      ? missionMiningVisualType(unit, stat.index, this.#browserEconomy?.checkpoint()) : undefined;
    const miningSprite = miningType === undefined ? undefined : this.mission.units.find(entry => entry.index === miningType)?.sprite;
    if (stat) this.#drawVisual(context, deployed ? this.#interceptorTypes.deployedSprite : miningSprite ?? stat.sprite,
      unit.activity === "move" && !deployed ? "move" : "idle", screenX, screenY, tick, unit.id, scene);
  }

  #drawUnitOverlay(context: CanvasRenderingContext2D, unit: UnitSnapshot, screenX: number, screenY: number): void {
    if (unit.health <= 0 || unit.activity === "die") { this.#visualBounds.delete(unit.id); return; }
    if (this.#selectedIds.has(unit.id)) {
      context.beginPath();
      context.ellipse(screenX, screenY + 4, this.#tileSize * 0.42, this.#tileSize * 0.2, 0, 0, Math.PI * 2);
      context.strokeStyle = "#d8e879";
      context.lineWidth = 2;
      context.stroke();
    }
    const barWidth = Math.max(14, this.#tileSize * 0.75);
    const top = this.#visualBounds.get(unit.id)?.top;
    const barY = top === undefined ? screenY - this.#tileSize * 0.7 : Math.round(top) - 5;
    context.fillStyle = "rgba(0,0,0,.72)";
    context.fillRect(screenX - barWidth / 2, barY, barWidth, 3);
    context.fillStyle = unit.faction === "human" ? "#70c7e9" : "#d45a4d";
    context.fillRect(screenX - barWidth / 2, barY, barWidth * (unit.health / unit.maxHealth), 2);
    if (this.mission.runtimeProfile === "browser-adapted" && (this.simulation.adaptedInspireState(unit.id)?.timer ?? 0) > 0) {
      context.fillStyle = "#e8c14a";
      context.fillRect(screenX + barWidth / 2 + 1, barY - 1, 3, 3);
    }
  }

  #drawCommanderMarker(context: CanvasRenderingContext2D, unit: UnitSnapshot, screenX: number, screenY: number): void {
    if (unit.health <= 0 || unit.activity === "die") return;
    const body = this.#entityScreenBounds(unit);
    if (body.right < 0 || body.left > 512 || body.bottom < 0 || body.top > 452) return;
    const top = this.#visualBounds.get(unit.id)?.top ?? screenY - 32;
    const y = Math.max(7, Math.round(top) - 14);
    const x = Math.max(7, Math.min(505, screenX));
    context.save();
    context.beginPath();
    for (let point = 0; point < 10; point++) {
      const angle = -Math.PI / 2 + point * Math.PI / 5, radius = point % 2 ? 2.7 : 6;
      const px = x + Math.cos(angle) * radius, py = y + Math.sin(angle) * radius;
      if (point === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.closePath();
    context.strokeStyle = "#17120a";
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = "#f2ce65";
    context.fill();
    context.restore();
  }

  #drawVisual(
    context: CanvasRenderingContext2D,
    sprite: string,
    activity: "idle" | "move",
    screenX: number,
    screenY: number,
    tick: number,
    unitId?: number,
    scene?: Pick<MissionSceneEntity, "rawSlot" | "xSubcells" | "ySubcells" | "heightSubcells">,
  ): void {
    const visual = this.#visuals.get(sprite);
    if (!visual) return;
    const state = unitId === undefined ? undefined : this.#animationStates.get(unitId);
    const stat = unitId === undefined ? undefined : this.#unitStats.get(unitId);
    const artifact = this.mission.runtimeProfile === "browser-adapted" && stat && browserVisionArtifact(stat);
    const action = artifact || sprite === "SARGSTL" || sprite === "PSYCSTL" || sprite === "EDPLY" || sprite === "SDPL"
      ? "Stand" : state?.action ?? (activity === "move" ? "Move" : "Stand");
    const nativeTask = unitId === undefined ? undefined : this.simulation.resourceActors.find(actor => actor.simulationId === unitId)?.profile.taskOwner.state;
    const construction = scene ? this.constructionVisuals.find(actor => actor.nativeId === scene.rawSlot) : undefined;
    const combatHost = this.#nativeViewState?.transport;
    const combatBinding = unitId === undefined ? undefined : this.#simulationBindings.get(unitId);
    const combatActor = combatBinding && combatHost?.slots[combatBinding.slot];
    const nativeCombat = combatActor?.nativeAiTask && combatActor.generation === combatBinding?.generation ? combatActor : undefined;
    const selection = visual.selector.select(action, state?.facing ?? "S");
    if (!selection && !nativeTask && !construction && !nativeCombat) {
      reportRenderDiagnostic(`missing-state:${sprite}:${action}`);
      return;
    }
    if (!nativeTask && !construction && !nativeCombat && selection?.fallback) reportRenderDiagnostic(`state-fallback:${sprite}:${action}:${state?.facing ?? "S"}`, selection.state.name);
    try {
      if (nativeCombat && !this.#nativeViewSamples.has(nativeCombat.slot)) {
        this.#nativeViewSamples.set(nativeCombat.slot, this.#session!.nativeViewActorSample(visual.animation,
          nativeCombat.slot, nativeCombat.generation, sprite));
      }
      const sample = nativeCombat ? this.#nativeViewSamples.get(nativeCombat.slot)!.sample
        : construction ? sourceConstructionSample(visual.animation, construction)
        : nativeTask ? missionResourceSample(visual.animation, nativeTask) : visual.sample(selection!,
        tick - (state?.since ?? 0) + this.#interpolation);
      const parts = composeFinSample(sample, visual.lookup);
      if (unitId !== undefined) {
        const body = finBodyBounds(parts, { x: screenX, y: screenY }, this.#tileSize / 32);
        if (body) this.#visualBounds.set(unitId, body);
      }
      const paletteOwner = construction?.team ?? (unitId === undefined ? 0 : this.#unitTeams.get(unitId) ?? 0);
      const imageLookup = (name: string, part: (typeof parts)[number]) =>
        (part.child.valueA === 0 || part.child.valueA === 1) && this.#spritePalettes
          ? this.#spritePalettes.image(name, paletteOwner, 8)
          : part.child.valueA === 3 && this.#spritePalettes
            ? this.#spritePalettes.emberImage(name) ?? visual.atlases.get(name.toUpperCase())?.image
          : visual.atlases.get(name.toUpperCase())?.image;
      if (scene && this.#indexedTerrain?.status.state === "ready" && this.#tileSize === 32 &&
        this.grid.width >= 16 && this.grid.height >= 15) {
        const frame = createMissionSceneFrame({ mission: this.mission, indexed: this.#indexedTerrain.indexed,
          camera: missionSceneCamera(this.#cameraX, this.#cameraY, this.grid.height),
          entities: [{ ...scene, sample, parts, fallbackOrigin: { x: screenX, y: screenY } }] });
        frame.drawEntity(context, scene.rawSlot, imageLookup,
          (part, origin, scale) => this.#drawBrowserEffect(context, part, origin, scale));
        for (const diagnostic of frame.diagnostics) {
          if (!diagnostic.startsWith(`slot:${scene.rawSlot}:`)) reportRenderDiagnostic(diagnostic);
        }
        for (const command of frame.commands) {
          const result = frame.mode1Results.get(`${scene.rawSlot}:${command.source.sourceChildIndex}`);
          for (const diagnostic of command.diagnostics) {
            if (result?.exact && ["native-shadow-pass-unimplemented", "scene-mode-unverified"].includes(diagnostic)) continue;
            reportRenderDiagnostic(`${sprite}:${command.source.part.child.sprite}:${diagnostic}`);
          }
          if (result?.diagnostic) reportRenderDiagnostic(`${sprite}:${command.source.part.child.sprite}:${result.diagnostic}`);
        }
      } else {
        for (const part of parts) for (const diagnostic of part.diagnostics) reportRenderDiagnostic(`${sprite}:${part.child.sprite}:${diagnostic}`);
        drawFinComposition(context, parts, imageLookup, { x: screenX, y: screenY }, this.#tileSize / 32,
          (part, origin, scale) => this.#drawBrowserEffect(context, part, origin, scale));
      }
    } catch (error) {
      reportRenderDiagnostic(`unsupported-timeline:${sprite}:${selection?.state.name ?? nativeTask?.animation.profile}`, error);
    }
  }

  #drawBrowserEffect(context: CanvasRenderingContext2D, part: Parameters<typeof drawBrowserMode5Canvas>[0]["part"],
    origin: { x: number; y: number }, scale: number): boolean {
    const result = drawBrowserMode5Canvas({ context, mission: this.mission, part, origin, scale });
    if (!result.drawn) reportRenderDiagnostic(result.diagnostic);
    return result.drawn;
  }

  #screenX(worldX: number, width: number): number {
    return width / 2 + (worldX - this.#cameraX) * this.#tileSize;
  }

  #screenY(worldY: number, height: number): number {
    return worldYToScreen(worldY, this.#cameraY, height, this.#tileSize);
  }

  #clampCamera(width: number, height: number): void {
    const halfWidth = width / this.#tileSize / 2;
    const halfHeight = height / this.#tileSize / 2;
    this.#cameraX = Math.max(halfWidth, Math.min(this.grid.width - halfWidth, this.#cameraX));
    this.#cameraY = Math.max(halfHeight, Math.min(this.grid.height - halfHeight, this.#cameraY));
  }

  #reconcileSelection(): void {
    const aliveIds = new Set(
      this.simulation.snapshot.units
        .filter((unit) => this.#unitTeams.get(unit.id) === 0 && unit.faction === this.playerFaction && unit.activity !== "die")
        .map(({ id }) => id),
    );
    for (const id of this.#selectedIds) if (!aliveIds.has(id)) this.#selectedIds.delete(id);
  }
}

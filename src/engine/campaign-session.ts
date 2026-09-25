import { stepBrowserType37, type BrowserType37Frame } from "./browser-type37";
import { observeBrowserResearchType37Frame } from "./browser-type37-presentation";
import type { BrowserResearchConfiguration } from "./browser-research";
import { browserConstructionChoices, browserConstructionSlots, createBrowserConstruction, reduceBrowserConstruction, validateBrowserConstruction, validateBrowserConstructionSessionSource,
  type BrowserConstructionConfiguration, type BrowserConstructionState, type BrowserConstructionRequest, type BrowserConstructionTransition } from "./browser-construction";
import { browserVisionArtifact } from "./browser-artifacts";
import { initializeBrowserCasualtyPickup, sourceUnitIsCommander } from "./browser-casualty-pickup";
import { CONTACT_PICKUP_STATE_OFFSET, scanBrowserContactPickups } from "./browser-contact-pickups";
import { createCampaignWorld, createCampaignWorldAdapter, projectAdaptedTro, type AdaptedTroProjection,
  type CampaignEntity, type CampaignMessage, type CampaignWorld } from "./campaign-world";
import { aiSelectorSourceCanonical, initializeAiSelectors, retainAiSelectorOwner, validateAiSelectorConfiguration,
  type AiSelectorConfiguration, type AiSelectorSchedulingOwner } from "./ai-command-selector";
import { createBrowserAiSelectorOwner, projectBrowserCampaign, validateBrowserAiSelectorConfiguration,
  type BrowserAiSelectorConfiguration, type BrowserCampaignProjection, type CampaignRuntimeProfile } from "./browser-campaign-runtime";
import type { LegacyUnitStat, LegacyWeaponStat } from "./legacy-balance";
import { consumeBrowserEconomyIncome, initializeBrowserEconomyWorld,
  type BrowserEconomyProfile, type BrowserEconomyIncome, type BrowserEconomyIncomeLedger } from "./browser-campaign-economy";
import { sourceBrowserEconomyHarvesters } from "./browser-campaign-economy-source";
import { sourceProductionVisits } from "./source-production-options";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { legacyColonyFootprint } from "./legacy-colony";

export type BrowserCampaignEconomyProfile = BrowserEconomyProfile;
export type BrowserEconomyIncomeReceipt = BrowserEconomyIncome;
import { retainSourceNativeTaskConfiguration, snapshotNativeTaskConfiguration } from "./source-native-task-options";
import { projectNativeView, type NativeViewFrame, type NativeViewProjection, type NativeViewTransport } from "./native-view-projection";
import { sourceNativeCombatActorSample } from "./source-native-combat-mission";
import type { FinAnimationData } from "../render/fin-animation";
import { retainSourceNativeCombatConfiguration, validateSourceNativeCombatConfiguration, type SourceNativeCombatConfiguration } from "./source-native-combat-host";
import { validateSourceNativeVisibilityHostConfiguration, type SourceNativeVisibilityFrame,
  type SourceNativeVisibilityEvent } from "./source-native-visibility-host";
import { createNativeConstructionHost, restoreNativeConstructionHost,
  type NativeConstructionConfiguration, type NativeConstructionHost, type NativeConstructionVisit } from "./native-construction-host";
import { projectLegacyColony, type LegacyColonyTeam } from "./legacy-colony";
import { createLegacyInfantryFamilyMask } from "./legacy-navigation";
import { advanceLegacyResourceAnimation, initializeLegacyResource, type LegacyResourceScales } from "./legacy-resource";
import { campaignResourceFrame, type CampaignResourceFrameInput } from "./campaign-resource-frame";
import { sourceDayNightFromHeader, type SourceDayNight } from "./source-day-night";
import { CAMPAIGN_AI_SOURCE_SHA256, initializeCampaignAi, stepCampaignAi, synchronizeCampaignAi, validateCampaignAiSession,
  type CampaignAiConfiguration, type CampaignAiSessionRequest, type CampaignAiSessionState } from "./campaign-ai";
import { ADAPTED_UNIT_PRODUCTION_SOURCES, createCampaignProduction, productionProducerSlot, productionSnapshot, reduceCampaignProduction, stepCampaignProductionProducer, synchronizeBrowserProductionColony,
  type CampaignProductionState, type ProductionEvent, type ProductionProducerVisit, type ProductionRequest,
  type ProductionSourceProfile } from "./campaign-production";
import { createMissionController, executeMissionTransaction, hasEnabledMissionTrip, missionBailDeadlineExceeded,
  type MissionActionTrace, type MissionCommandReceipt, type MissionControllerState, type PlannedMissionCommand } from "./mission-controller";
import { cloneTransportHostWorld, projectTransportConstruction, validateTransportConstruction, commandNativeHarvest, validateNativeMovement, bindCampaignResourceTask, configureCampaignResourceLifecycle, createTransportHostAdapter, initializeTransportHost, stepOwnedTransportHost, transportHostDefinition, transportHostState, updateTransportHostUnit,
  initializeTransportHostNativeAiTasks, initializeTransportHostNativeCombat, stepTransportHostVisibility, receiveTransportHostAiPolicy, validateNativeAiTaskConfiguration, validateNativeAiTaskAlignment,
  type NativeAiTaskConfiguration, type NativeAiTaskFrame,
  type NativeHarvestCommand,
  type HostRequest, type HostSlot, type HostUnitUpdate, type ResourceHostEntityState, type ResourceHostOptions, type TransportHostState } from "./transport-host";
import { recordTriggerVictimLoss, tripForReservedMtgDestination,
  type RuntimeTriggerBlock, type TriggerBail, type TriggerDiagnostic, type TriggerEvent, type TriggerResult } from "./trigger-runtime";

import { CURRENT_CAMPAIGN_REPLAY_POLICY, LegacyCampaignImportError, campaignReplayDifferences,
  firstNonPopulationReplayDifference, type CampaignReplayDifference, type LegacyCampaignImportConsent } from "./campaign-session-legacy-import";

const legacyFeedbackOptions = new WeakSet<CampaignSessionOptions>();

export interface CampaignSessionUnit extends LegacyUnitStat {
  readonly rawTail: readonly number[];
}

export interface CampaignSessionOptions {
  readonly sessionId: string;
  readonly runtimeProfile?: CampaignRuntimeProfile;
  readonly browserAi?: BrowserAiSelectorConfiguration;
  readonly browserEconomy?: BrowserCampaignEconomyProfile;
  readonly browserConstruction?: BrowserConstructionConfiguration;
  readonly journalLimit?: number | "all";
  readonly source: {
    readonly id: string;
    readonly rawHeader?: readonly string[];
    readonly teams: readonly (LegacyColonyTeam & { readonly money?: number; readonly ai?: number })[];
    readonly placementRows: readonly (readonly number[])[];
  };
  readonly units: readonly CampaignSessionUnit[];
  readonly weapons: readonly LegacyWeaponStat[];
  readonly triggers: readonly RuntimeTriggerBlock[];
  readonly messages: readonly { readonly id: number; readonly text: string }[];
  readonly map: { readonly width: number; readonly height: number };
  readonly pathGrid: Uint8Array;
  readonly tags: Uint8Array;
  readonly commanders: readonly { readonly team: number; readonly unitType: number; readonly sprite: string }[];
  readonly directionBits: readonly (readonly [0 | 1, 0 | 1])[];
  readonly fixedStepMilliseconds: number;
  readonly orientationSteps: number;
  readonly resourceScales?: "configured-startup" | LegacyResourceScales;
  readonly resourceLifecycle?: ResourceHostOptions;
  readonly resourceInitialIncome?: readonly number[];
  readonly campaignAi?: CampaignAiConfiguration;
  readonly aiSelector?: AiSelectorConfiguration;
  readonly aiSelectorOwner?: AiSelectorSchedulingOwner;
  readonly nativeAiTasks?: NativeAiTaskConfiguration;
  readonly nativeCombat?: SourceNativeCombatConfiguration;
  readonly production?: Omit<Parameters<typeof createCampaignProduction>[0], "sessionId" | "sourceProfiles"> & {
    readonly sourceProfiles: readonly ProductionSourceProfile[];
  };
}

export interface CampaignSessionState {
  readonly browserConstruction?: BrowserConstructionState;
  readonly browserEconomyLedger?: BrowserEconomyIncomeLedger;
  readonly world: CampaignWorld;
  readonly controller: MissionControllerState;
  readonly staticSlots: readonly number[];
  readonly cycleCounter: number;
  readonly sourceDayNight?: SourceDayNight;
  readonly production?: CampaignProductionState;
  readonly campaignAi?: CampaignAiSessionState;
  readonly campaignAiInputs?: readonly CampaignSessionInput[];
  readonly aiSelectorInputs?: readonly (CampaignSessionInput | CampaignVisibilityInput)[];
  readonly nativeAiInputs?: readonly CampaignSessionInput[];
  readonly nativeSourceInputs?: readonly (CampaignSessionInput | CampaignVisibilityInput)[];
  readonly constructionInputs?: readonly CampaignSessionInput[];
}

export interface CampaignReservation {
  readonly slot: number;
  readonly generation: number;
  readonly tileX: number;
  readonly tileY: number;
}

export interface CampaignResourceHandoff {
  readonly action: "bind" | "release";
  readonly evidence: string;
  readonly expected: HostSlot;
  readonly rawEntity: readonly number[];
  readonly state: ResourceHostEntityState;
}

export interface CampaignSessionInput {
  readonly browserConstructionHealth?: number;
  readonly browserConstructionDamage?: readonly { readonly slot: number; readonly generation: 0; readonly health: number }[];
  readonly browserConstructionRequest?: Extract<BrowserConstructionRequest, { type: "purchase" | "upgrade" }>;
  readonly type37Frame?: BrowserType37Frame;
  readonly economyIncome?: readonly BrowserEconomyIncomeReceipt[];
  readonly constructionVisits?: readonly { readonly team: number; readonly visit: NativeConstructionVisit }[];
  readonly nativeAiFrame?: NativeAiTaskFrame;
  readonly nativeAiReceipt?: { readonly id: string; readonly packets: readonly (readonly number[])[];
    readonly expected: readonly { readonly slot: number; readonly generation: number; readonly key: string; readonly raw: readonly number[] }[] };
  readonly clockMilliseconds: number;
  readonly updates?: readonly HostUnitUpdate[];
  readonly reservations?: readonly CampaignReservation[];
  readonly resourceHandoffs?: readonly CampaignResourceHandoff[];
  readonly resourceFrameSource?: Omit<CampaignResourceFrameInput, "sourceDayNight" | "rawHeader" | "buildingSlots">;
  readonly productionCommands?: readonly (Omit<ProductionEvent, "action"> & {
    readonly action: Extract<ProductionEvent["action"], { type: "reserve" | "release-pending" | "dispatch" }>;
  })[];
  readonly productionVisits?: readonly ProductionProducerVisit[];
  readonly campaignAiRequest?: CampaignAiSessionRequest;
}

export interface CampaignVisibilityInput {
  readonly visibilityFrame: SourceNativeVisibilityFrame;
}

export interface CampaignSessionReplayCheckpoint {
  readonly schemaVersion: 1;
  readonly kind: "campaign-session-replay";
  readonly options: Omit<CampaignSessionOptions, "pathGrid" | "tags" | "aiSelectorOwner"> & {
    readonly pathGrid: readonly number[];
    readonly tags: readonly number[];
  };
  readonly inputs: readonly CampaignSessionInput[];
  readonly sourceDayNight?: SourceDayNight;
  readonly production?: CampaignProductionState;
}

type CampaignSnapshotState = Omit<CampaignSessionState, "world"> & {
  readonly world: Omit<CampaignWorld, "entityBytes" | "typeMovementClasses" | "placementState" | "transportState"> & {
    readonly entityBytes: readonly number[];
    readonly typeMovementClasses: readonly number[];
    readonly placementState: Omit<CampaignWorld["placementState"], "renatBytes"> & { readonly renatBytes: readonly number[] };
    readonly transportState: TransportHostState;
  };
};

export interface CampaignSessionCheckpoint {
  readonly schemaVersion: 2 | 3;
  readonly replayPolicy?: typeof CURRENT_CAMPAIGN_REPLAY_POLICY;
  readonly kind: "campaign-session-snapshot";
  readonly options: CampaignSessionReplayCheckpoint["options"];
  readonly state: CampaignSnapshotState;
}

export interface CampaignSessionJournalEntry {
  readonly cycleCounter: number;
  readonly clockMilliseconds: number;
  readonly commands: readonly PlannedMissionCommand[];
  readonly receipts: readonly MissionCommandReceipt[];
  readonly trace: readonly MissionActionTrace[];
  readonly fired: readonly number[];
  readonly requests: readonly HostRequest[];
  readonly messages: readonly CampaignMessage[];
  readonly bail: TriggerBail | null;
  readonly productionRequests?: readonly ProductionRequest[];
  readonly campaignAiReceipt?: import("./campaign-ai").CampaignAiReceipt;
  readonly browserConstructionEffects?: BrowserConstructionTransition["effects"];
  readonly visibility?: SourceNativeVisibilityEvent;
}

export interface CampaignSessionJournalStats {
  readonly total: number;
  readonly retained: number;
  readonly dropped: number;
}

export type CampaignIdentityEvent = Extract<HostRequest, { type: "create" | "combat-death" | "casualty-picked-up" | "remove-noncombat" | "clear-collision" | "unregister" }>;

function identityEvents(requests: readonly HostRequest[]): CampaignIdentityEvent[] {
  return requests.filter((request): request is CampaignIdentityEvent =>
    ["create", "combat-death", "casualty-picked-up", "remove-noncombat", "clear-collision", "unregister"].includes(request.type));
}

export interface CampaignSessionFrame extends CampaignSessionState {
  readonly entry: CampaignSessionJournalEntry;
  readonly bailExpired: boolean;
}

export interface BrowserViewFrame {
  readonly cycleCounter: number;
  readonly world: CampaignWorld;
  readonly controller: NativeViewProjection["controller"];
  readonly transport: NativeViewTransport;
  readonly entry: CampaignSessionJournalEntry;
  readonly bailExpired: boolean;
}

function requireSession(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function cloneSessionInput<Value>(value: Value): Value {
  const snapshot = structuredClone(value), seen = new WeakSet<object>();
  const validate = (entry: unknown): void => {
    if (entry === null || typeof entry !== "object" || seen.has(entry)) return;
    requireSession(typeof SharedArrayBuffer === "undefined" || !(entry instanceof SharedArrayBuffer),
      "Campaign session inputs cannot retain SharedArrayBuffer storage");
    seen.add(entry);
    if (ArrayBuffer.isView(entry)) validate(entry.buffer);
    else if (entry instanceof Map) entry.forEach((item, key) => { validate(key); validate(item); });
    else if (entry instanceof Set) entry.forEach(validate);
    else Object.getOwnPropertyNames(entry).forEach(key => validate(Reflect.get(entry, key)));
  };
  validate(snapshot);
  return snapshot;
}

class SessionDiagnosticError extends Error {
  constructor(readonly diagnostics: readonly TriggerDiagnostic[]) {
    super(diagnostics.map((entry) => entry.message).join("; "));
  }
}

function unwrap<Value>(result: TriggerResult<Value>): Value {
  if (!result.ok) throw new SessionDiagnosticError(result.diagnostics);
  return result.value;
}

function failure<Value>(error: unknown): TriggerResult<Value> {
  if (error instanceof SessionDiagnosticError) return { ok: false, diagnostics: error.diagnostics };
  return { ok: false, diagnostics: [{ code: "invalid-input", message: error instanceof Error ? error.message : String(error) }] };
}

function writeInitialEntity(bytes: Uint8Array, entity: CampaignEntity, position?: { readonly x: number; readonly y: number }): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = entity.rawSlot! * 220;
  view.setUint16(offset, position?.x ?? entity.tileX * 256 + 128, true);
  view.setUint16(offset + 4, position?.y ?? entity.tileY * 256 + 128, true);
  bytes[offset + 6] = entity.unitType;
  bytes[offset + 7] = entity.team;
  view.setUint32(offset + 0x0c, entity.health, true);
  bytes[offset + 0x2c] = 1;
  bytes[offset + 0x38] = 255;
  view.setInt16(offset + 0xd2, -2, true);
  view.setInt16(offset + 0xd4, -2, true);
  bytes[offset + 0xcb] = entity.sourceRow === null || entity.resource || entity.unitType === 37 ? 0 : (entity.rawTail[1] ?? 0) & 255;
  if (entity.resource) {
    view.setUint16(offset + 0x32, entity.resource.rateWord, true);
    bytes[offset + 0x38] = 0;
    bytes[offset + 0x39] = 1;
    view.setUint16(offset + 0x46, entity.resource.countdownWord, true);
  }
}

export function initializeCampaignPlacements(options: Pick<CampaignSessionOptions,
  "sessionId" | "source" | "units" | "messages" | "map" | "resourceScales" | "runtimeProfile">): TriggerResult<CampaignWorld> {
  try {
    const { width, height } = options.map;
    const entityBytes = new Uint8Array(800 * 220);
    const scales = options.resourceScales === "configured-startup" ? { rateScale: 256, reserveScale: 256 } : options.resourceScales;
    const world = unwrap(createCampaignWorld({ sessionId: options.sessionId, source: options.source,
      runtimeProfile: options.runtimeProfile === "browser-adapted" ? "browser-adapted" : undefined,
      units: options.units, messages: options.messages, entityBytes,
      placementInitialization: { firstSlot: 152, mode: 0 },
      resourceInitialization: scales ? { width, height, firstSlot: 152, scales } : undefined }));
    const entities = world.entities.map((entity) => {
      const override = entity.rawTail[0];
      return entity.resource ? entity : { ...entity, health: override < 0 ? entity.maxHealth : override };
    });
    for (const source of [...entities, ...world.placementState.renatSources]) {
      requireSession(source.tileX < width && source.tileY < height, `Placement outside map: ${source.sourceRow}`);
    }
    for (const entity of entities) writeInitialEntity(entityBytes, entity);
    return { ok: true, value: { ...world, entities, entityBytes } };
  } catch (error) { return failure(error); }
}

function validateBrowserEconomySource(options: CampaignSessionOptions, world: CampaignWorld): BrowserEconomyIncomeLedger {
  const profile = options.browserEconomy!;
  validateSessionJson(profile);
  requireSession(options.runtimeProfile === "browser-adapted" && options.browserAi
    && !options.resourceLifecycle && !options.resourceInitialIncome && !options.nativeCombat
    && !options.nativeAiTasks && !options.campaignAi && !options.aiSelector && !options.aiSelectorOwner
    && !options.production?.constructionSources, "Browser economy requires exclusive adapted source ownership");
  requireSession(profile.policy?.extractionPeriodTicks === 20,
    "Browser economy requires the explicit 20-tick adapted policy at 20 TPS");
  const vent = options.units.find(unit => unit.index === 40);
  requireSession(vent, "Browser economy requires source VENT stats");
  const nodes = world.entities.filter(entity => entity.unitType === 40).map(entity => {
    const row = entity.sourceRow === null ? undefined : world.source.placementRows[entity.sourceRow];
    requireSession(row && row[2] === 40 && entity.rawSlot !== null && entity.resource,
      "Browser economy VENT requires original SCN binding");
    const decoded = initializeLegacyResource({ slot: entity.rawSlot, tileX: row[0], tileY: row[1],
      sourceRate: row[3], sourceReserve: row[4], scales: { rateScale: 256, reserveScale: 256 }, typeReserve: vent.health });
    requireSession(entity.tileX === row[0] && entity.tileY === row[1] && entity.health === decoded.reserve
      && entity.resource.rateWord === decoded.rateWord && decoded.reserve >= 0 && decoded.rateWord <= 32767,
    "Browser economy VENT reserve/rate differs from original source");
    return { key: entity.key, slot: entity.rawSlot, sourceRow: entity.sourceRow!,
      cell: { x: entity.tileX, y: entity.tileY }, amount: decoded.reserve, rateWord: decoded.rateWord };
  });
  const dropoffs = options.source.teams.flatMap(team => {
    const base = team.coordinateRows[1];
    return base && base[0] !== 0 && base[1] !== 0 && world.buildingSlots[`${team.index},0`] > 0
      ? [{ team: team.index, cell: { x: base[0], y: base[1] } }] : [];
  });
  const configuration = { scope: "browser-adapted-economy-v1" as const, sessionId: world.sessionId,
    policy: { ticksPerSecond: 20 as const, extractionPeriodTicks: 20, delivery: "direct-team-credit" as const,
      timing: "adapted-not-native" as const },
    initialCredits: Object.fromEntries(options.source.teams.map(team => [team.index, team.money!])),
    nodes, harvesters: sourceBrowserEconomyHarvesters(world, options.units), dropoffs };
  const profileId = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify({ source: world.source, configuration }))));
  requireSession(sameCheckpointValue(profile, { ...configuration, profileId }),
    "Browser economy profile differs from complete fresh source configuration");
  requireSession(Number.isSafeInteger(nodes.reduce((total, node) => total + node.amount, 0)), "Browser economy reserve overflow");
  return { profileId, sessionId: world.sessionId, earned: {} };
}

export function initializeCampaignSession(options: CampaignSessionOptions): TriggerResult<CampaignSessionState> {
  try {
    if (options.browserConstruction) validateBrowserConstructionSessionSource(options.browserConstruction, options);
    if (options.browserConstruction) requireSession(options.runtimeProfile === "browser-adapted" && options.browserAi
      && !options.campaignAi && !options.aiSelector && !options.aiSelectorOwner && !options.nativeAiTasks
      && !options.nativeCombat && !options.resourceLifecycle && !options.resourceInitialIncome
      && !options.production?.constructionSources, "Browser construction requires exclusive browser-adapted ownership");
    const { width, height } = options.map;
    const groundEligible = Array.from(createLegacyInfantryFamilyMask({ width, height, pathGrid: options.pathGrid }), Boolean);
    requireSession(options.tags.length === width * height, "MTG source plane size mismatch");
    requireSession(options.source.teams.length === 8, "All eight source teams are required");
    requireSession(options.source.teams.every((team, index) => team.index === index), "Source teams must be ordered 0..7");
    requireSession(options.units.length > 0 && new Set(options.units.map(({ index }) => index)).size === options.units.length &&
      options.units.every(({ index }) => Number.isInteger(index) && index >= 0 && index < 110), "Unique source unit definitions in range 0..109 are required");
    requireSession(options.commanders.length > 0, "Explicit source commander mapping is required; sprite inference is not supported");
    requireSession(new Set(options.commanders.map(({ team }) => team)).size === options.commanders.length, "Duplicate commander team");
    for (const mapping of options.commanders) {
      const unit = options.units.find(({ index }) => index === mapping.unitType);
      const team = options.source.teams.find(({ index }) => index === mapping.team);
      requireSession(unit && team && unit.sprite === mapping.sprite && unit.faction === team.race,
        `Commander mapping does not match source definition for team ${mapping.team}`);
    }
    const typeMovementClasses = new Uint8Array(110).fill(255);
    const definitions = options.units.flatMap((unit) => {
      const mode = unit.rawTail[2];
      requireSession(Number.isInteger(mode) && mode >= 0 && mode <= 255, `Missing movement class for type ${unit.index}`);
      typeMovementClasses[unit.index] = mode;
      for (const weaponId of unit.weapons) requireSession(weaponId < 0 || options.weapons.some(({ id }) => id === weaponId),
        `Missing weapon ${weaponId} for type ${unit.index}`);
      const artifact = options.runtimeProfile === "browser-adapted" && unit.index === 94;
      if (artifact) requireSession(browserVisionArtifact(unit), "Unsupported source vision artifact definition");
      return mode <= 1 || artifact ? [transportHostDefinition(unit, mode === 0 ? "ground" : "flying")] : [];
    });
    const colony = projectLegacyColony(options.source.teams, options.units);
    let world: CampaignWorld = { ...unwrap(initializeCampaignPlacements(options)), typeMovementClasses, buildingSlots: colony.buildingSlots };
    const entityBytes = world.entityBytes!;
    const view = new DataView(entityBytes.buffer);
    const entities: CampaignEntity[] = [...world.entities];
    requireSession(world.placementState.highWater <= 799, "Source placements exceed transport host allocation capacity");
    const staticSlots = entities.filter((entity) => !entity.resource && entity.health > 0 && options.units.find(({ index }) => index === entity.unitType)!.movementSpeed === 0)
      .map((entity) => entity.rawSlot!);
    for (const building of colony.buildings) {
      entities.push({ key: `colony:${building.nativeId}`, generation: 0, sourceRow: null,
        team: building.team, unitType: building.unitType, tileX: Math.floor(building.position.x), tileY: Math.floor(building.position.y),
        rawTail: [], health: building.health, maxHealth: building.maxHealth, rawSlot: building.nativeId, simulationId: null });
      staticSlots.push(building.nativeId);
      for (const point of building.footprint) {
        requireSession(point.x >= 0 && point.x < width && point.y >= 0 && point.y < height, "Colony footprint outside map");
        groundEligible[point.y * width + point.x] = false;
      }
    }
    for (const entity of entities) {
      requireSession(entity.tileX < width && entity.tileY < height, `Entity outside map: ${entity.key}`);
      const building = colony.buildings.find(({ nativeId }) => nativeId === entity.rawSlot);
      writeInitialEntity(entityBytes, entity, building?.nativePosition);
    }
    const staticSet = new Set(staticSlots);
    const hostBytes = new Uint8Array(entityBytes);
    for (const slot of staticSlots) hostBytes[slot * 220 + 0x2c] = 0;
    world = unwrap(initializeTransportHost({ ...world, entityBytes: hostBytes,
      entities: entities.filter(({ rawSlot }) => !staticSet.has(rawSlot!)) }, {
      width, height, groundEligible, definitions, sides: options.source.teams.map(({ race }) => race),
      directionBits: options.directionBits, fixedStepMilliseconds: options.fixedStepMilliseconds,
      orientationSteps: options.orientationSteps, highWater: world.placementState.highWater,
      fifos: world.coordinateQueues?.map(queue => ({ tile: { x: queue.tileX, y: queue.tileY },
        types: queue.captured.map(entry => entry.unitType) })),
    }));
    const host = hostOf(world);
    for (const entity of entities) {
      const slot = entity.rawSlot!;
      if (!staticSet.has(slot)) continue;
      const offset = slot * 220;
      host.slots[slot] = { slot, generation: entity.generation, key: entity.key, team: entity.team, unitType: entity.unitType,
        status: entityBytes[offset + 0x2c], health: entity.health,
        position: { x: view.getUint16(offset, true), y: view.getUint16(offset + 4, true) }, height: 0, task: "unit", taskWords: [] };
      host.generations[slot] = entity.generation;
      host.registry[slot] = entity.health === 0 ? null : entity.key;
    }
    world = { ...world, entityBytes, entities };
    const statistics: Record<string, number> = { ...world.statistics };
    for (let team = 0; team < 8; team += 1) {
      statistics[`${team},3`] = 0;
      for (let unitType = 0; unitType < 110; unitType += 1) statistics[`${team},0,${unitType}`] = 0;
    }
    world = { ...world, statistics };
    if (options.production?.adaptedCollectorProfiles !== undefined || options.production?.adaptedUnitProfiles !== undefined
      || options.production?.adaptedUpgrades !== undefined) {
      requireSession(options.runtimeProfile === "browser-adapted" && options.browserAi
        && !options.aiSelector && !options.aiSelectorOwner && !options.campaignAi
        && !options.nativeAiTasks && !options.nativeCombat && !options.resourceLifecycle
        && !options.production.constructionSources,
      "Adapted collectors/units/upgrades require browser-adapted production without native owners");
    }
    if (options.nativeAiTasks) {
      for (const profile of options.nativeAiTasks.profiles) {
        const stat = options.units.find(unit => unit.index === profile.typeId);
        const census = new DataView(Uint8Array.from(profile.typeBytes).buffer);
        requireSession(profile.width === width && profile.height === height && profile.families.length === options.pathGrid.length
          && profile.families.every((family, index) => family === options.pathGrid[index])
          && stat?.movementSpeed === census.getInt32(12, true) && stat.health === census.getInt32(0x44, true),
        "Native AI source PTH/type profile does not match session");
      }
      world = unwrap(initializeTransportHostNativeAiTasks(world, options.nativeAiTasks));
    }
    if (options.nativeCombat) {
      requireSession(options.nativeAiTasks && !options.production && !options.campaignAi && !options.resourceLifecycle,
        "Native combat excludes production/CITY/resources/full-policy shared scheduler");
      world = unwrap(initializeTransportHostNativeCombat(world, options.nativeCombat));
    }
    let sourceDayNight: SourceDayNight | undefined;
    if (options.resourceLifecycle) {
      for (const profile of options.resourceLifecycle.nativeHarvest?.profiles ?? []) {
        const stat = options.units.find(stat => stat.index === profile.typeId);
        requireSession(profile.width === width && profile.height === height && profile.families.length === options.pathGrid.length
          && profile.families.every((family, index) => family === options.pathGrid[index])
          && profile.groundCells.length === width * height && profile.groundCells.every((cell, index) => cell === index)
          && profile.tripWords.every((word, index) => word === (options.tags[index] === 0 ? 1023 : 2047))
          && stat?.movementSpeed === 40 && stat.weapons.every(weapon => weapon === -1), "Native harvest source PTH/MTG/census mismatch");
      }
      requireSession(options.source.rawHeader, "Resource initialization requires original SCN clock");
      requireSession(options.resourceInitialIncome?.length === 8 && options.resourceInitialIncome.every((value) =>
        Number.isInteger(value) && value >= -2147483648 && value <= 2147483647),
      "Resource initialization requires eight explicit full32 native incomes");
      requireSession(options.source.teams.every(({ money }) => Number.isInteger(money) && money! >= -2147483648 && money! <= 2147483647),
        "Resource initialization requires eight original full32 SCN money values");
      sourceDayNight = sourceDayNightFromHeader(options.source.rawHeader);
      world = unwrap(configureCampaignResourceLifecycle({ ...world,
        exomoney: Object.fromEntries(options.source.teams.map(({ index, money }) => [index, money!])),
        statistics: { ...world.statistics, ...Object.fromEntries(options.resourceInitialIncome.map((income, team) => [`${team},1`, income])) },
      }, options.resourceLifecycle));
    }
    let production: CampaignProductionState | undefined;
    if (options.production) {
      requireSession(options.production.teams.length > 0, "Production requires explicit native team seeds");
      production = createCampaignProduction({ ...options.production, sessionId: options.sessionId });
      const exomoney = { ...world.exomoney };
      for (const seed of options.production.teams) {
        const source = options.source.teams[seed.team];
        requireSession(source.money === seed.credits && source.race === seed.race
          && source.coordinateRows[1][0] === seed.base.x && source.coordinateRows[1][1] === seed.base.y,
        "Production seed must match original full32 money, race and colony base");
        requireSession(seed.producerDelays?.length === 4 && seed.producerDelays.slice(1).every((delay) => delay === 0),
          "Production requires explicit native delay bytes; non-base queues must start at zero");
        for (let slot = 0; slot < 5; slot += 1) {
          const original = colony.slots.find((entry) => entry.team === seed.team && entry.slot === slot)!;
          requireSession(seed.slots[slot].health === original.health && seed.slots[slot].level === original.upgradeLevel,
            "Production City seed differs from source projection");
        }
        requireSession(options.browserConstruction && seed.team === 0 && seed.slots.every(slot => slot.health === 0)
          || seed.slots[1].health > 0 || (seed.slots[0].health > 0
          && production.adaptedCollectorProfiles?.some(profile => profile.unitType === 6 + seed.race * 8))
          || ADAPTED_UNIT_PRODUCTION_SOURCES.some(source => source.race === seed.race
            && production!.adaptedUnitProfiles?.some(profile => profile.unitType === source.unitType)
            && seed.slots[productionProducerSlot(source.queue)].health > 0),
        "Production requires an existing base producer");
        requireSession(production.sourceProfiles!.some((profile) => profile.unitType === (seed.race === 0 ? 0 : 8)),
          "Missing validated native profile for production team race");
        exomoney[seed.team] = seed.credits;
      }
      world = { ...world, exomoney };
      for (const construction of production.constructionHosts ?? []) validateTransportConstruction(world, construction);
    }
    let campaignAi: CampaignAiSessionState | undefined;
    if (options.campaignAi) {
      checkpointCampaignAiConfiguration(options.campaignAi);
      requireSession(production, "Campaign-ai requires opt-in native production");
      if (options.campaignAi.fullPolicy) {
        const navigation = options.campaignAi.sources.navigation;
        requireSession(navigation.width === width && navigation.height === height
          && navigation.families.length === options.pathGrid.length
          && navigation.families.every((family, index) => family === options.pathGrid[index]),
        "Full policy must use the session source PTH");
      }
      campaignAi = initializeCampaignAi(options.campaignAi, production, world);
      requireSession(!options.nativeAiTasks || !options.campaignAi.fullPolicy,
        "Native AI task/policy shared RNG scheduler requires an additional owner; original AI is not admitted");
    }
    requireSession(options.runtimeProfile === undefined || options.runtimeProfile === "strict-native"
      || options.runtimeProfile === "browser-adapted", "Unknown campaign runtime profile");
    requireSession((options.runtimeProfile === "browser-adapted") === Boolean(options.browserAi),
      "browser-adapted: explicit profile and view strategy configuration required together");
    if (options.browserAi) {
      requireSession(!options.aiSelector && !options.aiSelectorOwner && !options.campaignAi
        && !options.nativeAiTasks && !options.nativeCombat,
      "browser-adapted: native AI policy, selector and task owners cannot be combined with the browser profile");
      validateBrowserAiSelectorConfiguration(options.browserAi, options.source);
      const initialStatistics = Object.fromEntries(Array.from({ length: 8 }, (_, team) =>
        Array.from({ length: 12 }, (_, selector) => [`${team},${selector}`, 0])).flat());
      requireSession(options.source.teams.every(team => Number.isInteger(team.money)
        && team.money! >= -2147483648 && team.money! <= 2147483647),
      "browser-adapted: eight original source money values required");
      world = { ...world, aiSelectors: initializeAiSelectors(options.source),
        statistics: { ...initialStatistics, ...world.statistics },
        exomoney: { ...Object.fromEntries(options.source.teams.map(team => [team.index, team.money!])), ...world.exomoney } };
      world = initializeBrowserCasualtyPickup(world, { runtimeProfile: "browser-adapted" });
    }
    requireSession(Boolean(options.aiSelector) === Boolean(options.aiSelectorOwner),
      "ai: explicit native policy scheduling configuration and runtime callback owner required");
    if (options.aiSelector) {
      validateAiSelectorConfiguration(options.aiSelector);
      requireSession(typeof options.aiSelectorOwner?.isReady === "function"
        && sameCheckpointValue(options.aiSelector, options.aiSelectorOwner.configuration)
        && options.aiSelector.sourceId === options.source.id
        && options.aiSelector.sourceCanonical === aiSelectorSourceCanonical(options.source), "ai: source scheduling owner configuration mismatch");
      requireSession(!options.campaignAi, "ai: bounded campaignAi is not the native selector scheduling owner");
      world = { ...world, aiSelectors: initializeAiSelectors(options.source) };
    }
    const browserEconomyLedger = options.browserEconomy ? validateBrowserEconomySource(options, world) : undefined;
    if (options.browserEconomy) world = initializeBrowserEconomyWorld(options.browserEconomy, world);
    const browserConstruction = options.browserConstruction ? createBrowserConstruction(options.browserConstruction, world) : undefined;
    if (browserConstruction && production?.teams.every(team => team.team === 0 && team.slots.every(slot => slot.health === 0))) production = undefined;
    return { ok: true, value: { world, controller: unwrap(createMissionController(options.triggers, world.statistics)),
      ...(browserConstruction ? { browserConstruction } : {}),
      ...(browserEconomyLedger ? { browserEconomyLedger } : {}),
      staticSlots, cycleCounter: 0, ...(sourceDayNight ? { sourceDayNight } : {}), ...(production ? { production } : {}),
      ...(campaignAi ? { campaignAi } : {}), ...(options.campaignAi?.fullPolicy ? { campaignAiInputs: [] } : {}),
      ...(options.aiSelector || options.browserAi ? { aiSelectorInputs: [] } : {}),
      ...(production?.constructionHosts ? { constructionInputs: [] } : {}),
      ...(options.nativeAiTasks ? { nativeAiInputs: [] } : {}),
      ...(options.nativeCombat?.visibility ? { nativeSourceInputs: [] } : {}) } };
  } catch (error) { return failure(error); }
}

function hostOf(world: CampaignWorld): TransportHostState {
  const host = world.transportState as TransportHostState;
  requireSession(host?.kind === "transport-host-v1", "Session lost transport ownership");
  return host;
}

function refreshFeedback(state: CampaignSessionState, options: CampaignSessionOptions): CampaignSessionState {
  const host = hostOf(state.world);
  const statistics = { ...state.controller.runtime.statistics };
  const consumedLosses = { ...state.controller.consumedLosses };
  if (host.nativeCombat?.death) {
    for (const request of host.requests) if (request.type === "combat-death") consumedLosses[request.loss.id] = request.loss;
    for (let team = 0; team < 8; team++) {
      for (const category of [2, 3]) statistics[`${team},${category}`] = host.nativeCombat.projectiles.statistics[team * 12 + category];
      for (let unitType = 0; unitType < 110; unitType++) for (const category of [0, 3])
        statistics[`${team},${category},${unitType}`] = host.nativeCombat.death.typeStatistics[team * 440 + unitType * 4 + category];
    }
  }
  const buildingSlots = { ...state.world.buildingSlots };
  const commanderSlots = { ...state.world.commanderSlots };
  const bytes = state.world.entityBytes!;
  for (let team = 0; team < 8; team += 1) {
    if (options.runtimeProfile === "browser-adapted" && !legacyFeedbackOptions.has(options)) statistics[`${team},6`] = 0;
    for (let unitType = 0; unitType < 110; unitType += 1) statistics[`${team},1,${unitType}`] = 0;
  }
  if (options.runtimeProfile === "browser-adapted" && !legacyFeedbackOptions.has(options)) {
    for (let slot = 152; slot < 800; slot += 1) {
      if (host.registry[slot] === null) continue;
      const entity = host.slots[slot];
      requireSession(entity && entity.key === host.registry[slot] && entity.slot === slot, "Inconsistent census registry");
      if (entity.team < 8) statistics[`${entity.team},6`] += 1;
    }
  }
  const staticSet = new Set(state.staticSlots);
  for (const entity of state.world.entities) {
    const slot = entity.rawSlot!;
    const registered = staticSet.has(slot) ? bytes[slot * 220 + 0x2c] !== 0 : host.registry[slot] === entity.key;
    if (slot >= 152 && registered && entity.team < 8) statistics[`${entity.team},1,${entity.unitType}`] += 1;
  }
  for (const key of Object.keys(buildingSlots)) {
    const [team, slot] = key.split(",").map(Number);
    buildingSlots[key] = state.world.entities.find((entity) => entity.rawSlot === team * 15 + slot)?.health ?? 0;
  }
  for (const mapping of options.commanders) {
    const matches = state.world.entities.filter((entity) => entity.team === mapping.team && entity.unitType === mapping.unitType &&
      bytes[entity.rawSlot! * 220 + 0x2c] !== 0 && bytes[entity.rawSlot! * 220 + 0x2c] !== 10);
    requireSession(matches.length <= 1, `Ambiguous commander mapping for team ${mapping.team}`);
    if (matches.length === 1) commanderSlots[mapping.team] = matches[0].rawSlot!;
  }
  return { ...state, world: { ...state.world, buildingSlots, commanderSlots, statistics },
    controller: { ...state.controller, consumedLosses, runtime: { ...state.controller.runtime, statistics } } };
}

function rebuildOccupancy(host: TransportHostState, staticSlots: readonly number[], browserAdapted = false,
  source?: CampaignWorld["source"]): void {
  host.ground.fill(-1);
  host.flying.fill(-1);
  for (const actor of host.slots) if (actor && (actor.nativeConstruction && actor.slot % 15 === 3
    || browserAdapted && actor.slot < 5 && actor.key.startsWith(`browser-construction:${actor.slot}:0:`) && actor.health > 0)) {
    const tileX = actor.position.x >>> 8, tileY = actor.position.y >>> 8;
    const team = source?.teams[0] as LegacyColonyTeam | undefined;
    requireSession(actor.nativeConstruction || team?.coordinateRows?.[1]?.length === 2, "Construction occupancy requires source home");
    const cells = actor.nativeConstruction ? [[-1, 0], [0, 0], [-1, 1], [0, 1]].map(([offsetX, offsetY]) =>
      ({ x: tileX + offsetX, y: tileY + offsetY }))
      : legacyColonyFootprint(team!.coordinateRows[1][0], team!.coordinateRows[1][1], actor.slot);
    for (const cell of cells) host.ground[cell.y * host.width + cell.x] = actor.slot;
  }
  const definitions = new Map(host.definitions.map((definition) => [definition.unitType, definition]));
  const staticSet = new Set(staticSlots);
  for (const reservation of host.productionExits ?? []) {
    const definition = definitions.get(reservation.unitType);
    requireSession(definition, "Missing reserved production definition");
    host[definition.plane][reservation.tile.y * host.width + reservation.tile.x] = 1022;
  }
  // A08 trip 13 drops a mine line (47,0..9) as a trooper steps onto 47,6; mines are proximity triggers, so movers keep shared cells.
  const isMine = (entity: TransportHostState["slots"][number]) => browserAdapted && (entity?.unitType === 45 || entity?.unitType === 46);
  for (const entity of [...host.slots.filter(entity => !isMine(entity)), ...host.slots.filter(isMine)]) {
    if (!entity || staticSet.has(entity.slot) || entity.team === 8 || entity.status === 0 || entity.status === 10) continue;
    if (entity.nativeAiTask) {
      const cells = host.nativeAiTasks!.ground.flatMap((word, index) => (word & 1023) === entity.slot ? [index] : []);
      requireSession(cells.length === 1 && host.ground[cells[0]] === -1, "Native AI movement reservation conflict");
      host.ground[cells[0]] = entity.slot;
      continue;
    }
    if (entity.resourceTask?.nativeMovement) {
      const movement = entity.resourceTask.nativeMovement;
      const cell = movement.world.groundCells[movement.state.ground.findIndex(word => (word & 1023) === entity.slot)];
      requireSession(cell !== undefined && host.ground[cell] === -1, "Native movement reservation conflict");
      host.ground[cell] = entity.slot;
      continue;
    }
    const definition = definitions.get(entity.unitType);
    requireSession(definition, `No supported host definition for type ${entity.unitType}`);
    const tileX = entity.position.x >>> 8;
    const tileY = entity.position.y >>> 8;
    const index = tileY * host.width + tileX;
    const reservedExit = browserAdapted && !host.nativeCombat && !host.nativeAiTasks && !host.resourceLifecycle
      && host[definition.plane][index] === 1022;
    if (isMine(entity) && tileX < host.width && tileY < host.height && host[definition.plane][index] !== -1) continue;
    requireSession(tileX < host.width && tileY < host.height && (host[definition.plane][index] === -1 || reservedExit) &&
      (definition.plane === "flying" || host.groundEligible[index]), `Occupied or ineligible ${definition.plane} cell ${tileX},${tileY}`);
    host[definition.plane][index] = entity.slot;
  }
}

function synchronizeRawAndHost(state: CampaignSessionState, options: CampaignSessionOptions): void {
  const host = hostOf(state.world);
  const bytes = state.world.entityBytes!;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let changedPlane = false;
  const entitySlots = new Set(state.world.entities.map(({ rawSlot }) => rawSlot));
  for (const record of host.slots) {
    if (record && !entitySlots.has(record.slot)) requireSession(bytes[record.slot * 220 + 6] === record.unitType,
      `Raw newtype target ${record.slot} is not a session-owned world entity`);
  }
  for (const entity of state.world.entities) {
    const slot = entity.rawSlot!;
    const offset = slot * 220;
    const record = host.slots[slot];
    if (state.staticSlots.includes(slot)) {
      const definition = options.units.find(({ index }) => index === entity.unitType);
      requireSession(definition?.movementSpeed === 0, `Static type ${entity.unitType} requires an explicit mobile-registry transfer`);
    }
    if (record) {
      requireSession(record.key === entity.key && record.generation === entity.generation, "Host/raw generation mismatch");
      if (record.nativeConstruction) {
        requireSession(record.unitType === entity.unitType && record.team === entity.team && record.health === entity.health
          && record.nativeConstruction.raw.every((value, index) => value === bytes[offset + index]),
        "CITY external damage/death/cancel or raw mutation is unsupported");
        continue;
      }
      if (record.nativeAiTask) {
        requireSession(record.unitType === entity.unitType && record.team === entity.team && record.health === entity.health
          && record.position.x >>> 8 === entity.tileX && record.position.y >>> 8 === entity.tileY
          && record.nativeAiTask.raw.every((value, index) => value === bytes[offset + index]),
        "External mutation of a native AI owned actor requires its task owner");
        continue;
      }
      if (record.resourceTask) {
        requireSession(record.unitType === entity.unitType && record.team === entity.team && record.health === entity.health &&
          (!entity.resource || (record.resource?.rateWord === entity.resource.rateWord &&
            record.resource?.countdownWord === entity.resource.countdownWord)),
        "External mutation of a resource-owned task requires its native task owner");
        continue;
      }
      if (record.unitType !== entity.unitType) {
        requireSession(host.definitions.some(({ unitType }) => unitType === entity.unitType), `newtype has no host plane for ${entity.unitType}`);
        record.unitType = entity.unitType;
        changedPlane = true;
      }
      record.health = entity.health;
      if (entity.resource) {
        requireSession(record.resource && record.unitType === 40 && record.task === "idle", "Unsupported resource host lifecycle");
        record.resource = { ...entity.resource };
        view.setUint16(offset + 0x32, entity.resource.rateWord, true);
        view.setUint16(offset + 0x46, entity.resource.countdownWord, true);
      }
      bytes[offset + 0x2c] = record.status;
      view.setUint16(offset, record.position.x, true);
      view.setUint16(offset + 4, record.position.y, true);
    } else {
      const definition = options.units.find(({ index }) => index === entity.unitType);
      requireSession(definition?.movementSpeed === 0, `Static type ${entity.unitType} requires an explicit mobile-registry transfer`);
    }
    bytes[offset + 6] = entity.unitType;
    bytes[offset + 7] = entity.team;
    view.setUint32(offset + 12, entity.health, true);
  }
  if (changedPlane) rebuildOccupancy(host, state.staticSlots, state.world.browserCasualtyPickup?.runtimeProfile === "browser-adapted", state.world.source);
}

function collectBrowserContactPickups(state: CampaignSessionState): CampaignSessionState {
  const host = hostOf(state.world);
  const pickups = scanBrowserContactPickups(state.world, host, state.staticSlots, state.cycleCounter);
  if (!pickups.length) return state;
  const bytes = state.world.entityBytes!;
  const exomoney = { ...state.world.exomoney };
  const removed = new Set<number>();
  const joined = new Set<number>();
  for (const pickup of pickups) {
    const record = host.slots[pickup.slot];
    bytes[pickup.slot * 220 + CONTACT_PICKUP_STATE_OFFSET] = 0;
    if (pickup.kind === "join") {
      bytes[pickup.slot * 220 + 7] = 0;
      if (record) record.team = 0;
      joined.add(pickup.slot);
      continue;
    }
    const total = (exomoney[pickup.collector.team] ?? 0) + pickup.amount;
    requireSession(total >= -0x80000000 && total <= 0x7fffffff, "Contact pickup money exceeds the native int32 field");
    exomoney[pickup.collector.team] = total;
    bytes[pickup.slot * 220 + 0x2c] = 0;
    if (record) { record.status = 0; host.registry[pickup.slot] = null; }
    removed.add(pickup.slot);
    host.requests.push({ type: "unregister", slot: pickup.slot, generation: pickup.generation });
  }
  const staticSlots = state.staticSlots.filter(slot => !removed.has(slot));
  rebuildOccupancy(host, staticSlots, true, state.world.source);
  return { ...state, staticSlots,
    world: { ...state.world, exomoney, entities: state.world.entities.filter(entity => !removed.has(entity.rawSlot!))
      .map(entity => joined.has(entity.rawSlot!) ? { ...entity, team: 0 } : entity) } };
}

function applyUnitBatch(state: CampaignSessionState, updates: readonly HostUnitUpdate[]): CampaignSessionState {
  if (updates.length === 0) return state;
  let world = state.world;
  let host = hostOf(world);
  requireSession(!host.nativeCombat, "Native combat owned updates require explicit phase ownership transfer");
  let bytes = world.entityBytes!;
  let entities = new Map(world.entities.map((entity) => [entity.rawSlot!, entity]));
  let statistics = state.controller.runtime.statistics;
  const consumedLosses = { ...state.controller.consumedLosses };
  const staticSlots = new Set(state.staticSlots);
  for (const update of updates) {
    if (world.browserCasualtyPickup && update.type === "combat-death"
      && host.slots[update.slot]?.generation === update.generation
      && host.browserCasualties?.some(casualty => casualty.slot === update.slot && casualty.generation === update.generation
        && Object.hasOwn(consumedLosses, casualty.lossId))) continue;
    const entity = entities.get(update.slot);
    requireSession(entity && entity.generation === update.generation, `Stale or invalid unit reference ${update.slot}:${update.generation}`);
    const record = host.slots[update.slot];
    requireSession(!record?.nativeConstruction && !state.production?.constructionHosts?.some(host =>
      update.slot >= host.configuration.team * 15 && update.slot < host.configuration.team * 15 + 15),
    "CITY external damage/death/cancel is unsupported; reject before mutation");
    requireSession(!record?.nativeAiTask, "Native AI owned updates require explicit task ownership transfer");
    requireSession(!record?.resourceTask, "Resource-owned updates require native task ownership transfer");
    requireSession(!entity.resource, "Resource updates require the unsupported deployment/depletion lifecycle, not combat HP updates");
    requireSession(!world.scenarioMarkers?.some(marker => marker.key === entity.key), "Type37 marker updates belong to the coordinate relay, not combat");
    if (world.browserCasualtyPickup && sourceUnitIsCommander(entity.unitType) && update.type !== "position") {
      world = unwrap(updateTransportHostUnit({ ...world, entities: [...entities.values()], statistics }, update));
      host = hostOf(world);
      bytes = world.entityBytes!;
      entities = new Map(world.entities.map(entity => [entity.rawSlot!, entity]));
      if (update.type === "combat-death") {
        const request = host.requests.find(request => request.type === "combat-death"
          && request.slot === update.slot && request.generation === update.generation);
        requireSession(request?.type === "combat-death", "Casualty owner omitted its victim loss");
        if (!Object.hasOwn(consumedLosses, request.loss.id)) {
          statistics = unwrap(recordTriggerVictimLoss(statistics, request.loss.victimTeam, request.loss.victimType));
          consumedLosses[request.loss.id] = request.loss;
        }
      } else staticSlots.delete(update.slot);
      continue;
    }
    const offset = update.slot * 220;
    const status = bytes[offset + 0x2c];
    if (update.type === "position") {
      requireSession(record && !state.staticSlots.includes(update.slot) && status !== 0 && status !== 10, "Cannot move inactive or static entity");
      requireSession([update.position.x, update.position.y].every((value) => Number.isInteger(value) && value >= 0 && value <= 65535), "Invalid native256 position");
      record.position = { ...update.position };
      entities.set(update.slot, { ...entity, tileX: update.position.x >>> 8, tileY: update.position.y >>> 8 });
    } else if (update.type === "combat-death") {
      const loss = { id: JSON.stringify([world.sessionId, entity.key, entity.generation]), victimTeam: entity.team, victimType: entity.unitType };
      if (Object.hasOwn(consumedLosses, loss.id)) continue;
      requireSession(status !== 0 && status !== 10, "Unit already inactive");
      statistics = unwrap(recordTriggerVictimLoss(statistics, entity.team, entity.unitType));
      consumedLosses[loss.id] = loss;
      bytes[offset + 0x2c] = 10;
      if (record) { record.status = 10; record.task = "death"; record.taskWords = []; record.health = 0; }
      entities.set(update.slot, { ...entity, health: 0 });
      host.requests.push({ type: "combat-death", slot: update.slot, generation: update.generation, loss });
    } else {
      requireSession(status === 10, "Task-10 completion requires a removing unit");
      bytes[offset + 0x2c] = 0;
      if (record) { record.status = 0; host.registry[update.slot] = null; }
      entities.delete(update.slot);
      staticSlots.delete(update.slot);
      host.requests.push({ type: "unregister", slot: update.slot, generation: update.generation });
    }
  }
  rebuildOccupancy(host, [...staticSlots], world.browserCasualtyPickup?.runtimeProfile === "browser-adapted", world.source);
  return { ...state, staticSlots: [...staticSlots], world: { ...world, entities: [...entities.values()], statistics },
    controller: { ...state.controller, consumedLosses, runtime: { ...state.controller.runtime, statistics } } };
}

function scanEvent(state: CampaignSessionState, options: CampaignSessionOptions, event: TriggerEvent,
  entry: { commands: PlannedMissionCommand[]; receipts: MissionCommandReceipt[]; trace: MissionActionTrace[]; fired: number[];
    messages?: CampaignMessage[] }): CampaignSessionState {
  const current = refreshFeedback(state, options);
  const adapter = createCampaignWorldAdapter(createTransportHostAdapter(), options.aiSelectorOwner,
    options.browserAi ? createBrowserAiSelectorOwner(options.browserAi, options.source) : undefined);
  const messageIds = entry.messages && new Set([...current.world.messages, ...entry.messages].map(message => message.commandId));
  const committed = unwrap(executeMissionTransaction(current.controller, {
    cycleCounter: current.cycleCounter, clockMilliseconds: current.world.clockMilliseconds,
    buildingSlots: current.world.buildingSlots,
  }, event, current.world, {
    ...(adapter.aiSelector ? { aiSelector: true as const } : {}),
    ...(adapter.browserAi ? { browserAi: true as const } : {}),
    ...(adapter.runtimeProfile ? { runtimeProfile: adapter.runtimeProfile } : {}),
    prepare: !messageIds ? adapter.prepare : (world, commands) => {
      const prepared = adapter.prepare(world, commands);
      if (prepared.ok) {
        const commandIds = new Set(commands.filter(planned => planned.command.kind === "msg").map(planned => planned.id));
        for (const message of prepared.value.world.messages) {
          if (!commandIds.has(message.commandId) || messageIds.has(message.commandId)) continue;
          messageIds.add(message.commandId);
          entry.messages!.push({ ...message });
        }
      }
      return prepared;
    },
    feedback(world, runtime) {
      try {
        const staged = { ...current, world,
          controller: { ...current.controller, runtime: { ...runtime, statistics: world.statistics } } };
        synchronizeRawAndHost(staged, options);
        const refreshed = refreshFeedback(staged, options);
        return { ok: true, value: { world: refreshed.world, statistics: refreshed.controller.runtime.statistics,
          buildingSlots: refreshed.world.buildingSlots } };
      } catch (error) { return failure(error); }
    },
  }));
  entry.commands.push(...committed.commands);
  entry.receipts.push(...committed.receipts);
  entry.trace.push(...committed.trace);
  entry.fired.push(...committed.fired);
  return refreshFeedback({ ...current, world: committed.world, controller: committed.state }, options);
}

type CheckpointCheck = (value: unknown) => void;

function validateSessionJson(value: unknown, ancestors = new Set<object>(), depth = 0): void {
  requireSession(depth < 100, "Checkpoint JSON nesting");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") { requireSession(Number.isFinite(value), "Checkpoint non-finite number"); return; }
  requireSession(typeof value === "object", "Checkpoint JSON value");
  requireSession(!ancestors.has(value), "Checkpoint cyclic JSON");
  const array = Array.isArray(value);
  requireSession(Object.getPrototypeOf(value) === (array ? Array.prototype : Object.prototype), "Checkpoint JSON prototype");
  const keys = Object.keys(value);
  requireSession(Reflect.ownKeys(value).length === keys.length + Number(array), "Checkpoint JSON keys");
  if (array) requireSession(keys.length === value.length && keys.every((key, index) => key === String(index)), "Checkpoint sparse array");
  ancestors.add(value);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    requireSession("value" in descriptor && descriptor.enumerable, "Checkpoint JSON data property");
    validateSessionJson(descriptor.value, ancestors, depth + 1);
  }
  ancestors.delete(value);
}

const checkpointInteger = (minimum = 0, maximum = Number.MAX_SAFE_INTEGER): CheckpointCheck => (value) =>
  requireSession(typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum, "Checkpoint integer range");
const checkpointChoice = (...choices: unknown[]): CheckpointCheck => (value) => requireSession(choices.includes(value), "Checkpoint enum");
const checkpointString: CheckpointCheck = (value) => requireSession(typeof value === "string", "Checkpoint string");
const checkpointNullable = (check: CheckpointCheck): CheckpointCheck => (value) => { if (value !== null) check(value); };
const checkpointArray = (check: CheckpointCheck, length?: number): CheckpointCheck => (value) => {
  requireSession(Array.isArray(value) && (length === undefined || value.length === length), "Checkpoint array length");
  for (const entry of value) check(entry);
};
const checkpointObject = (required: Record<string, CheckpointCheck>, optional: Record<string, CheckpointCheck> = {}): CheckpointCheck => (value) => {
  requireSession(value !== null && typeof value === "object" && !Array.isArray(value), "Checkpoint object");
  const record = value as Record<string, unknown>;
  requireSession(Object.keys(record).every((key) => Object.hasOwn(required, key) || Object.hasOwn(optional, key)), "Checkpoint unknown field");
  for (const [key, check] of Object.entries(required)) {
    requireSession(Object.hasOwn(record, key), `Checkpoint missing ${key}`);
    try { check(record[key]); } catch (error) { throw new Error(`${key}: ${error instanceof Error ? error.message : error}`); }
  }
  for (const [key, check] of Object.entries(optional)) if (Object.hasOwn(record, key)) check(record[key]);
};
const checkpointRecord = (check: CheckpointCheck, keyPattern: RegExp): CheckpointCheck => (value) => {
  requireSession(value !== null && typeof value === "object" && !Array.isArray(value), "Checkpoint record");
  for (const [key, entry] of Object.entries(value)) { requireSession(keyPattern.test(key), "Checkpoint record key"); check(entry); }
};
const checkpointUnion = (field: string, cases: Record<string, CheckpointCheck>): CheckpointCheck => (value) => {
  requireSession(value !== null && typeof value === "object" && field in value, "Checkpoint discriminant");
  const key = (value as Record<string, unknown>)[field];
  requireSession(typeof key === "string" && Object.hasOwn(cases, key), "Checkpoint discriminant");
  cases[key](value);
};
const checkpointSigned = checkpointInteger(-2147483648, 2147483647);
const checkpointByte = checkpointInteger(0, 255);
const checkpointWord = checkpointInteger(0, 65535);
const checkpointUint = checkpointInteger(0, 0xffffffff);
const checkpointBit = checkpointChoice(0, 1);
const checkpointSlot = checkpointInteger(0, 799);
const checkpointTeam = checkpointInteger(0, 7);
const checkpointType = checkpointInteger(0, 109);
const checkpointPosition = checkpointObject({ x: checkpointWord, y: checkpointWord });
const checkpointAnimation = checkpointObject({ profile: checkpointString, frame: checkpointByte, delay: checkpointByte, mode: checkpointInteger(0, 3) });
const checkpointProfile = checkpointObject({ id: checkpointString, directions: checkpointArray(checkpointArray(checkpointByte), 32) });
const checkpointProductionProfile = checkpointObject({ id: checkpointString, directions: checkpointArray(checkpointArray(checkpointByte), 32),
  unitType: checkpointChoice(0, 8), bankField: checkpointChoice(152), finSha256: checkpointString });
const checkpointAdaptedCollectorProfile = checkpointObject({ runtimeProfile: checkpointChoice("browser-adapted"),
  unitType: checkpointChoice(6, 14), completionVisits: checkpointInteger(1, 65535) });
const checkpointAdaptedUnitProfile = checkpointObject({ runtimeProfile: checkpointChoice("browser-adapted"),
  unitType: checkpointChoice(2, 3, 4, 5, 10, 11, 12, 13), completionVisits: checkpointInteger(1, 65535) });
const checkpointConstructionSource: CheckpointCheck = value => { createNativeConstructionHost(value as NativeConstructionConfiguration); };
const checkpointConstructionHost: CheckpointCheck = value => {
  const host = value as NativeConstructionHost;
  restoreNativeConstructionHost(host, host.configuration);
};
const checkpointConstructionVisit = checkpointObject({ sequence: checkpointInteger(), counter: checkpointUint,
  mainHealth: checkpointInteger(), auxiliaryHealth: checkpointInteger(), registeredSlots: checkpointArray(checkpointSlot) });
const checkpointResourceType = checkpointObject({ unitType: checkpointType, stand: checkpointString, deploy: checkpointString,
  death: checkpointString, deathVariants: checkpointInteger(), removalHoldField: checkpointInteger(), selectedWeapon: checkpointSigned },
{ preservedIdle: checkpointString });
const checkpointResourceTask = checkpointObject({ direction: checkpointByte, animation: checkpointAnimation,
  pendingOrder: checkpointByte, order: checkpointByte, released: checkpointChoice(true, false),
  stack: checkpointArray(checkpointObject({ opcode: checkpointChoice(1, 3, 10, 12, 13), words: checkpointArray(checkpointWord) })) },
{ nativeMovement: validateNativeMovement, nativeBanks: checkpointRecord(checkpointUint, /^[A-Z]+$/), nativeStopRequested: checkpointChoice(true),
  nativeIdle: checkpointObject({ randomIndex: checkpointByte, observer: checkpointChoice(255),
  specialOrder: checkpointChoice(0), confusion: checkpointChoice(0), secondaryAnimationPending: checkpointChoice(0),
  secondaryAnimationsInactive: checkpointChoice(true), groundWord: checkpointUint }) });
const checkpointClock = checkpointObject({ phase: checkpointBit, cycleLength: checkpointInteger(1), elapsed: checkpointInteger(),
  transitionTicks: checkpointInteger(1), blend: checkpointInteger(0, 256) });
const checkpointLoss = checkpointObject({ id: checkpointString, victimTeam: checkpointTeam, victimType: checkpointType });
const checkpointBail = checkpointNullable(checkpointObject({ resultCode: checkpointSigned, reasonCode: checkpointSigned, deadlineMilliseconds: checkpointUint }));
const checkpointStats = checkpointRecord(checkpointInteger(-2147483648, 0xffffffff), /^\d+(,\d+){1,2}$/);
const checkpointSourcePin = checkpointObject({ path: checkpointString, sha256: checkpointString });
const checkpointRows = checkpointArray(checkpointArray(checkpointSigned));
const checkpointNativeHarvest: CheckpointCheck = (value) => {
  requireSession(value !== null && typeof value === "object", "Native harvest configuration");
  const config = value as NonNullable<ResourceHostOptions["nativeHarvest"]>;
  requireSession(config.scope === "source-separated-bounded" && typeof config.evidence === "string" && config.evidence.length > 0
    && Array.isArray(config.profiles) && Array.isArray(config.bindings), "Explicit bounded native harvest configuration");
  checkpointObject({ executableSha256: checkpointString, pthSha256: checkpointString,
    finSha256: checkpointObject({ VENT: checkpointString, EXPL: checkpointString, SLUG: checkpointString }),
    randomScope: checkpointChoice("isolated-index-no-draws"), sharedRandomDraws: checkpointChoice(0) })(config.sourceMetadata);
  for (const binding of config.bindings) checkpointObject({ slot: checkpointSlot, generation: checkpointInteger(),
    raw: checkpointArray(checkpointByte, 220), randomIndex: checkpointByte, groundWord: checkpointUint,
    provenance: checkpointChoice("constructor", "restored-idle") })(binding);
};
const checkpointTeamSeed = checkpointObject({ team: checkpointTeam, race: checkpointBit, credits: checkpointSigned,
  costAccumulator: checkpointInteger(0, 2147483647), base: checkpointPosition,
  slots: checkpointArray(checkpointObject({ health: checkpointInteger(), level: checkpointBit, busy: checkpointBit }), 5),
  restrictions: checkpointArray(checkpointType), upgrades: checkpointArray(checkpointObject({ unitType: checkpointType,
    weapon: checkpointInteger(0, 2), armor: checkpointInteger(0, 2) })) }, { producerDelays: checkpointArray(checkpointByte, 4) });
const checkpointProductionUnit = checkpointObject({ unitType: checkpointType, queue: checkpointInteger(0, 3), exitSelector: checkpointBit,
  exitOffset: checkpointObject({ x: checkpointSigned, y: checkpointSigned }) }, { dependency: checkpointType, sprite: checkpointString });
const checkpointDependencyFields = { id: checkpointType, cost: checkpointInteger(), interfaceId: checkpointInteger(),
  rawFields: checkpointArray(checkpointSigned), dependencies: checkpointArray(checkpointType) };
const checkpointAiObservationFields = { entities: checkpointArray(checkpointByte, 800 * 220), forceOrder: checkpointSigned,
  population: checkpointSigned, populationLimit: checkpointSigned, relations: checkpointArray(checkpointByte, 100),
  visibilityMasks: checkpointArray(checkpointUint, 8), occupancy: checkpointArray(checkpointSigned) };
const checkpointAiBuffers = checkpointObject({ ...checkpointAiObservationFields,
  policy: checkpointArray(checkpointByte, 0x6c40), teamBytes: checkpointArray(checkpointByte, 0xe30) }, { rngCursor: checkpointByte });
const checkpointAiCommandFields = { id: checkpointString, sequence: checkpointInteger(), stage: checkpointChoice("demand", "pipeline", "full-policy") };
const checkpointAiRequest = checkpointObject({ ...checkpointAiCommandFields, sourceId: checkpointString,
  observation: checkpointObject(checkpointAiObservationFields) });
const checkpointCampaignAiConfiguration = checkpointObject({ scope: checkpointChoice("source-separated-bounded"),
  sourceId: checkpointString, sourceSha256: checkpointChoice(CAMPAIGN_AI_SOURCE_SHA256), team: checkpointTeam,
  sources: checkpointObject({ types: checkpointArray(checkpointByte, 110 * 280), weapons: checkpointArray(checkpointByte),
    dependencies: checkpointArray(checkpointByte, 110 * 52), cityDependencies: checkpointArray(checkpointType, 18),
    matrix: checkpointArray(checkpointArray(checkpointSigned)), navigation: checkpointObject({
      width: checkpointInteger(1, 256), height: checkpointInteger(1, 256), families: checkpointArray(checkpointByte),
      nextFamily: checkpointArray(checkpointByte, 65536) }) }), initial: checkpointAiBuffers }, {
    fullPolicy: checkpointObject({ neighbors: checkpointArray(checkpointByte, 8192), rngTable: checkpointArray(checkpointSigned, 256),
      ruleTable: checkpointArray(checkpointByte, 216), policyAddress: checkpointInteger(1, 0xffffffff),
      actorTransport: checkpointChoice("deferred", "synchronous") }) });
const checkpointCampaignAiState = checkpointObject({ sourceId: checkpointString, buffers: checkpointAiBuffers,
  history: checkpointArray(checkpointObject({ request: checkpointAiRequest, teamBytesBefore: checkpointArray(checkpointByte, 0xe30),
    receipt: checkpointObject({ code: checkpointChoice("campaign-ai"), sourceSha256: checkpointChoice(CAMPAIGN_AI_SOURCE_SHA256),
      command: checkpointObject(checkpointAiCommandFields), team: checkpointTeam, selectedRule: checkpointSigned,
      intents: checkpointArray(checkpointObject({ id: checkpointString, dependency: checkpointType, packet: checkpointArray(checkpointByte, 7),
        creditsBefore: checkpointSigned, creditsAfter: checkpointSigned, receipt: checkpointChoice("applied"), ticket: checkpointString })) }, {
      integrity: (value) => requireSession(typeof value === "string" && /^[0-9a-f]{64}$/.test(value), "Checkpoint AI receipt SHA-256"),
      fullPolicy: checkpointObject({ computation: (value) => requireSession(value !== null && typeof value === "object",
        "Checkpoint full-policy computation"), disposition: checkpointChoice("receipted", "pending-native-task-hand-off") }) }) })) });
const checkpointOptions = checkpointObject({ sessionId: checkpointString,
  source: checkpointObject({ id: checkpointString, placementRows: checkpointRows, teams: checkpointArray(checkpointObject({
    index: checkpointTeam, race: checkpointByte, coordinateRows: checkpointArray(checkpointArray(checkpointSigned), 2), cityRows: checkpointRows,
  }, { enabled: checkpointSigned, money: checkpointSigned, ai: checkpointSigned, teamColor: checkpointSigned,
    dependencies: checkpointArray(checkpointSigned), allies: checkpointArray(checkpointSigned), aiSlots: checkpointArray(checkpointSigned) }), 8) },
  { rawHeader: checkpointArray(checkpointString), title: checkpointString, terrainBank: checkpointString,
    schemaVersion: checkpointChoice(1), source: checkpointSourcePin, outcomes: checkpointArray(checkpointObject({ reasonCode: checkpointSigned,
      source: checkpointSourcePin, rawText: checkpointString, text: checkpointString })) }),
  units: checkpointArray(checkpointObject({ index: checkpointType, sprite: checkpointString, faction: checkpointSigned,
    movementSpeed: checkpointSigned, health: checkpointSigned, weapons: checkpointArray(checkpointSigned), rawTail: checkpointArray(checkpointSigned) },
  { turnSpeed: checkpointSigned, observationDay: checkpointSigned, observationNight: checkpointSigned,
    armorUpgradePercentages: checkpointArray(checkpointSigned), targetClass: checkpointSigned })),
  weapons: checkpointArray(checkpointObject({ id: checkpointInteger(), damage: checkpointSigned, range: checkpointSigned, rateOfFire: checkpointSigned },
  { visualClass: checkpointString, soundId: checkpointSigned, speed: checkpointSigned, shots: checkpointSigned, reload: checkpointSigned,
    magicChewing: checkpointSigned, rawPrefix: checkpointSigned, rawTail: checkpointArray(checkpointSigned) })),
  triggers: checkpointArray(checkpointObject({ id: checkpointInteger(), mode: checkpointString, flag: checkpointNullable(checkpointSigned),
    condition: checkpointString, actions: checkpointArray(checkpointObject({ name: checkpointString,
      arguments: checkpointArray((value) => { if (typeof value !== "string") checkpointSigned(value); }) }, { raw: checkpointString })) })),
  messages: checkpointArray(checkpointObject({ id: checkpointInteger(), text: checkpointString })),
  map: checkpointObject({ width: checkpointInteger(1, 256), height: checkpointInteger(1, 256) }),
  pathGrid: checkpointArray(checkpointByte), tags: checkpointArray(checkpointByte),
  commanders: checkpointArray(checkpointObject({ team: checkpointTeam, unitType: checkpointType, sprite: checkpointString })),
  directionBits: checkpointArray(checkpointArray(checkpointBit, 2)),
  fixedStepMilliseconds: (value) => requireSession(typeof value === "number" && value > 0 && Number.isFinite(value), "Checkpoint cadence"),
  orientationSteps: checkpointInteger(1),
}, { journalLimit: (value) => { if (value !== "all") checkpointInteger()(value); },
  runtimeProfile: checkpointChoice("strict-native", "browser-adapted"),
  browserEconomy: validateSessionJson,
  browserConstruction: validateSessionJson,
  browserAi: checkpointObject({ scope: checkpointChoice("source-browser-selector"), sourceId: checkpointString,
    sourceCanonical: checkpointString, profileId: checkpointChoice("browser-adapted-v1"),
    processor: checkpointObject({ kind: checkpointChoice("browser-ai-strategy-v1"),
      phase: checkpointChoice("view-before-generic-engine"), stateOwner: checkpointChoice("mission-view") }) }),
  nativeAiTasks: (value) => validateNativeAiTaskConfiguration(value as NativeAiTaskConfiguration),
  nativeCombat: (value) => validateSourceNativeCombatConfiguration(value as SourceNativeCombatConfiguration),
  campaignAi: checkpointCampaignAiConfiguration,
  aiSelector: (value) => {
    checkpointObject({ sourceId: checkpointString, sourceCanonical: checkpointString, profileId: checkpointString,
      scope: checkpointChoice("source-native-policy-scheduler"), globalMode: checkpointChoice(0, 3),
      teams: checkpointArray(checkpointObject({ team: checkpointTeam, modes: checkpointArray(checkpointInteger(0, 4)) })) })(value);
    validateAiSelectorConfiguration(value as AiSelectorConfiguration);
  },
  resourceScales: (value) => { if (value !== "configured-startup") checkpointObject({ rateScale: checkpointSigned, reserveScale: checkpointSigned })(value); },
  resourceInitialIncome: checkpointArray(checkpointSigned, 8), resourceLifecycle: checkpointObject({ animations: checkpointArray(checkpointProfile),
    types: checkpointArray(checkpointResourceType), bindings: checkpointArray(checkpointObject({ slot: checkpointSlot,
      generation: checkpointInteger(), state: checkpointResourceTask })) }, { nativeHarvest: checkpointNativeHarvest }),
  production: checkpointObject({ records: checkpointArray(checkpointObject(checkpointDependencyFields)), units: checkpointArray(checkpointProductionUnit),
    sourceProfiles: checkpointArray(checkpointProductionProfile), teams: checkpointArray(checkpointTeamSeed) }, {
      adaptedCollectorProfiles: checkpointArray(checkpointAdaptedCollectorProfile),
      adaptedUnitProfiles: checkpointArray(checkpointAdaptedUnitProfile),
      adaptedUpgrades: checkpointObject({ runtimeProfile: checkpointChoice("browser-adapted") }),
      constructionSources: checkpointArray(checkpointConstructionSource), queueSafetyLimit: checkpointInteger(1, 50) }) });

function sameCheckpointValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  const leftKeys = Object.keys(left), rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => Object.hasOwn(right, key) &&
    sameCheckpointValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

function compactProduction(state: CampaignProductionState, retainCreditChanges = false): CampaignProductionState {
  return { ...state, journal: state.journal.filter((event) => !event.id.startsWith("session:") ||
    (retainCreditChanges && event.action.type === "sync-credits" && event.action.expectedPreviousCredits !== event.action.credits) ||
    !["sync-credits", "producer-idle", "producer-wait", "producer-advance"].includes(event.action.type)) };
}

function validateDirectCheckpoint(value: unknown): asserts value is CampaignSessionCheckpoint {
  const identity = { slot: checkpointSlot, generation: checkpointInteger() };
  const request = checkpointUnion("type", {
    "native-death-sound": checkpointObject({ type: checkpointChoice("native-death-sound"), ...identity, counter: checkpointUint,
      id: checkpointInteger(0, 255), x: checkpointWord, y: checkpointWord, category: checkpointChoice(0), event: checkpointChoice(3),
      volume: checkpointSigned, pan: checkpointSigned,
      source: checkpointObject({ id: checkpointInteger(0, 255), source: checkpointString, parameters: checkpointArray(checkpointSigned, 4) }) }),
    create: checkpointObject({ type: checkpointChoice("create"), ...identity, team: checkpointInteger(0, 8), unitType: checkpointType, position: checkpointPosition }),
    "combat-death": checkpointObject({ type: checkpointChoice("combat-death"), ...identity, loss: checkpointLoss }),
    "casualty-picked-up": checkpointObject({ type: checkpointChoice("casualty-picked-up"), ...identity, carrierId: checkpointInteger(1) }),
    "remove-noncombat": checkpointObject({ type: checkpointChoice("remove-noncombat"), ...identity, task: checkpointChoice(10),
      taskWords: (entry) => requireSession(sameCheckpointValue(entry, [1, 0]), "Checkpoint removal payload") }),
    "clear-collision": checkpointObject({ type: checkpointChoice("clear-collision"), ...identity }),
    unregister: checkpointObject({ type: checkpointChoice("unregister"), ...identity }),
    "source-sound": checkpointObject({ type: checkpointChoice("source-sound"), ...identity, commandId: checkpointString,
      category: checkpointChoice(1), event: checkpointChoice(7), ebx: checkpointChoice(0), ecx: checkpointChoice(0), stackArgument: checkpointChoice(0), spatial: checkpointChoice(false) }),
    "resource-unit-sound": checkpointObject({ type: checkpointChoice("resource-unit-sound"), ...identity, edx: checkpointType,
      ebx: checkpointChoice(3, 5), ecx: checkpointBit, stackArguments: checkpointArray(checkpointWord, 2), spatial: checkpointChoice(true) }),
    "resource-task-released": checkpointObject({ type: checkpointChoice("resource-task-released"), ...identity, task: checkpointChoice(1) }),
  });
  const host = checkpointObject({ kind: checkpointChoice("transport-host-v1"),
    reducer: checkpointObject({ nextId: checkpointInteger(1), carriers: checkpointArray(checkpointObject({ id: checkpointInteger(1),
      poolIndex: checkpointInteger(0, 7), slot: checkpointSlot, team: checkpointTeam, entityTeam: checkpointChoice(8), type: checkpointChoice(92, 93),
      originTile: checkpointPosition, position: checkpointPosition, destination: checkpointPosition, height: checkpointWord,
      step: checkpointInteger(0, 50), phase: checkpointChoice("descent", "orientation", "approach", "deliver", "pickup", "departure", "pool-release", "released"),
      payloadPhase: checkpointInteger(0, 2), groups: checkpointArray(checkpointObject({ type: checkpointByte, count: checkpointByte })),
      cursor: checkpointInteger(0, 5), commanderSlot: checkpointNullable(checkpointSlot), awaiting: checkpointChoice(null, "occupancy", "creation", "position", "commander") })) }),
    slots: checkpointArray(checkpointNullable(checkpointObject({ ...identity, key: checkpointString, team: checkpointInteger(0, 8),
      unitType: checkpointType, status: checkpointByte, health: checkpointInteger(-2147483648, 0xffffffff), position: checkpointPosition,
      height: checkpointWord, task: checkpointChoice("unit", "transport", "removal", "death", "idle", "extraction", "retraction"), taskWords: checkpointArray(checkpointWord) },
    { resource: checkpointObject({ rateWord: checkpointWord, countdownWord: checkpointWord }), resourceTask: checkpointResourceTask,
      nativeConstruction: checkpointObject({ team: checkpointTeam, receiptId: checkpointString, raw: checkpointArray(checkpointByte, 220) }),
      nativeAiTask: checkpointObject({ profile: checkpointInteger(), raw: checkpointArray(checkpointByte, 220) }),
      pendingNativeAi: checkpointObject({ receiptId: checkpointString, disposition: checkpointChoice("pending-native-task-hand-off") }) })), 800),
    registry: checkpointArray(checkpointNullable(checkpointString), 800), generations: checkpointArray(checkpointInteger(-1), 800),
    highWater: checkpointInteger(152, 799), width: checkpointInteger(1, 256), height: checkpointInteger(1, 256),
    groundEligible: checkpointArray(checkpointChoice(true, false)), ground: checkpointArray(checkpointInteger(-1, 1022)),
    flying: checkpointArray(checkpointInteger(-1, 1022)), resourceTileFlags: checkpointArray(checkpointUint),
    definitions: checkpointArray(checkpointObject({ unitType: checkpointType, health: checkpointInteger(1), movementSpeed: checkpointUint, plane: checkpointChoice("ground", "flying") })),
    sides: checkpointArray(checkpointByte, 8), directionBits: checkpointArray(checkpointArray(checkpointBit, 2)), directionCursor: checkpointInteger(),
    fixedStepMilliseconds: (entry) => requireSession(typeof entry === "number" && entry > 0 && Number.isFinite(entry), "Checkpoint cadence"),
    orientationSteps: checkpointInteger(1), tick: checkpointInteger(), remainderMilliseconds: checkpointInteger(),
    motions: checkpointArray(checkpointObject({ id: checkpointInteger(1), kind: checkpointChoice("orientation", "movement"),
      destination: checkpointPosition, origin: checkpointPosition, progress: checkpointInteger() })),
    fifos: checkpointArray(checkpointObject({ tile: checkpointPosition, types: checkpointArray(checkpointType) })),
    receipts: checkpointArray(checkpointObject({ id: checkpointString, command: checkpointString, disposition: checkpointChoice("applied", "scheduled") })),
    requests: checkpointArray(request),
  }, { browserCasualties: checkpointArray(checkpointObject({ ...identity, lossId: checkpointString,
      carrierId: checkpointNullable(checkpointInteger(1)), disposition: checkpointChoice("scheduled", "suppressed"),
      collected: checkpointChoice(true, false) })),
    nativeAiTasks: checkpointObject({ configuration: (entry) => validateNativeAiTaskConfiguration(entry as NativeAiTaskConfiguration),
    ground: checkpointArray(checkpointUint), rngCursor: checkpointByte, task6Budget: checkpointInteger(0, 10), visits: checkpointInteger() }),
    nativeCombat: checkpointObject({ configuration: (entry) => validateSourceNativeCombatConfiguration(entry as SourceNativeCombatConfiguration),
      projectiles: checkpointObject({ records: checkpointArray(checkpointByte, 2024 * 40), highWater: checkpointInteger(0, 2023),
        heads: checkpointArray(checkpointInteger(-1, 2023), 2), statistics: checkpointArray(checkpointSigned, 96) }),
      journal: checkpointArray((entry) => requireSession(entry !== null && typeof entry === "object", "Native combat journal entry")) },
      { visibility: checkpointObject({ sequence: checkpointInteger(),
          journal: checkpointArray((entry) => requireSession(entry !== null && typeof entry === "object", "Native visibility journal entry")) }),
        soundState: checkpointObject({ descriptor: checkpointArray(checkpointByte, 13), randomSeed: checkpointUint }),
        death: checkpointObject({ registry: checkpointArray(checkpointInteger(-1, 799), 800),
        typeStatistics: checkpointArray(checkpointSigned, 4400), commanderSlots: checkpointArray(checkpointInteger(-1, 799), 8),
        pending: checkpointArray(checkpointObject({ slot: checkpointSlot, startedAt: checkpointUint,
          lastCounter: checkpointUint, visits: checkpointInteger(0, 149) })) }) }),
    productionExits: checkpointArray(checkpointObject({ key: checkpointString, team: checkpointTeam, queue: checkpointInteger(0, 3),
    ticket: checkpointString, unitType: checkpointType, tile: checkpointPosition })),
    resourceLifecycle: checkpointObject({ animations: checkpointArray(checkpointProfile), types: checkpointArray(checkpointResourceType), nativePhaseCounter: checkpointNullable(checkpointUint) },
      { nativeHarvest: checkpointNativeHarvest }) });
  const entity = checkpointObject({ key: checkpointString, generation: checkpointInteger(), sourceRow: checkpointNullable(checkpointInteger()),
    team: checkpointInteger(0, 8), unitType: checkpointType, tileX: checkpointByte, tileY: checkpointByte, rawTail: checkpointArray(checkpointSigned),
    health: checkpointInteger(-2147483648, 0xffffffff), maxHealth: checkpointInteger(1), rawSlot: checkpointSlot,
    simulationId: checkpointNullable(checkpointInteger()) }, { resource: checkpointObject({ rateWord: checkpointWord, countdownWord: checkpointWord }) });
  const equal = (expected: (checkpoint: CampaignSessionCheckpoint) => unknown): CheckpointCheck => (entry) =>
    requireSession(sameCheckpointValue(entry, expected(value as CampaignSessionCheckpoint)), "Checkpoint immutable source field");
  checkpointObject({ schemaVersion: checkpointChoice(2, 3), kind: checkpointChoice("campaign-session-snapshot"), options: checkpointOptions,
    state: checkpointObject({ cycleCounter: checkpointInteger(0, 2147483647), staticSlots: checkpointArray(checkpointSlot),
      world: checkpointObject({ sessionId: checkpointString, source: equal((checkpoint) => checkpoint.options.source),
        placementState: checkpointObject({ firstSlot: checkpointSlot, nextSlot: checkpointInteger(152, 800), highWater: checkpointInteger(152, 800),
          renatSources: checkpointArray(checkpointObject({ sourceRow: checkpointInteger(), tileX: checkpointByte, tileY: checkpointByte,
            unitType: checkpointType, count: checkpointInteger(0, 9) })), renatBytes: checkpointArray(checkpointByte, 1000) }),
        entities: checkpointArray(entity), buildingSlots: checkpointRecord(checkpointInteger(), /^[0-7],[0-5]$/),
        entityBytes: checkpointArray(checkpointByte, 176000), typeMovementClasses: checkpointArray(checkpointByte, 110),
        commanderSlots: checkpointRecord(checkpointSlot, /^[0-7]$/), messageTexts: checkpointRecord(checkpointString, /^\d+$/),
        messages: checkpointArray(checkpointObject({ commandId: checkpointString, text: checkpointString, messageId: checkpointInteger(),
          presentationCode: checkpointSigned, parameter3: checkpointSigned, parameter4: checkpointSigned,
          clockMilliseconds: checkpointUint, initialValue: checkpointChoice(31) })),
        exomoney: checkpointRecord(checkpointSigned, /^[0-7]$/), clockMilliseconds: checkpointUint, transportState: host, statistics: checkpointStats }, {
        browserCasualtyPickup: checkpointObject({ runtimeProfile: checkpointChoice("browser-adapted") }),
        coordinateQueues: checkpointArray(checkpointObject({ sourceRow: checkpointInteger(), tileX: checkpointByte, tileY: checkpointByte,
          captured: checkpointArray(checkpointObject({ sourceRow: checkpointInteger(), unitType: checkpointType })) })),
        scenarioMarkers: checkpointArray(checkpointObject({ key: checkpointString, sourceRow: checkpointInteger(), rawSlot: checkpointSlot,
          queueIndex: checkpointInteger(0, 9), kind: checkpointChoice("type37-coordinate-relay"), selector6: checkpointChoice(0),
          loaderGate: checkpointChoice(0), remainingVisits: checkpointInteger(1, 450), active: checkpointChoice(true, false) })),
        markerSpyTeams: checkpointArray(checkpointChoice(true, false), 8),
        teamAlliances: checkpointArray(checkpointArray(checkpointBit, 8), 8),
        adaptedTro: checkpointObject({
          sharedVision: checkpointArray(checkpointArray(checkpointBit, 8), 8),
          dependencyRestrictions: checkpointArray(checkpointArray(checkpointType), 8),
          noPickup: checkpointArray(checkpointBit, 8),
          aiGroupWeights: checkpointRecord(checkpointRecord(checkpointInteger(-32768, 32767), /^[1-4]$/), /^[0-7]$/),
          events: checkpointArray(checkpointObject({ commandId: checkpointString, triggerId: checkpointInteger(0, 127),
            actionIndex: checkpointInteger(), clockMilliseconds: checkpointUint,
            sourceAction: checkpointObject({ name: checkpointChoice("ally", "vision", "dfiddle", "nopickup", "aimsg"),
              arguments: checkpointArray(checkpointSigned) }, { raw: checkpointString }),
            evidence: checkpointChoice("DC.EXE:43d9d0", "DC.EXE:43da31", "DC.EXE:43da8d", "DC.EXE:43da6f", "DC.EXE:44bf54", "DC.EXE:4563d0", "DC.EXE:41ad68"),
            command: checkpointUnion("kind", {
              ally: checkpointObject({ kind: checkpointChoice("ally"), team: checkpointTeam, otherTeam: checkpointTeam, enabled: checkpointBit }),
              vision: checkpointObject({ kind: checkpointChoice("vision"), team: checkpointTeam, otherTeam: checkpointTeam, enabled: checkpointBit }),
              dfiddle: checkpointObject({ kind: checkpointChoice("dfiddle"), team: checkpointTeam, dependency: checkpointType, restricted: checkpointBit }),
              nopickup: checkpointObject({ kind: checkpointChoice("nopickup"), team: checkpointTeam }),
              aimsg: checkpointObject({ kind: checkpointChoice("aimsg"), team: checkpointTeam, selector: checkpointInteger(1, 4), value: checkpointInteger(-32768, 32767) }),
            }) })) }),
        aiSelectors: checkpointObject({ sourceId: checkpointString, initialModes: checkpointArray(checkpointSigned, 8),
          modes: checkpointArray(checkpointSigned, 8), events: checkpointArray(checkpointObject({ commandId: checkpointString,
            triggerId: checkpointInteger(), actionIndex: checkpointInteger(), team: checkpointTeam, before: checkpointSigned,
            after: checkpointInteger(-32768, 32767), profileId: checkpointString, globalMode: checkpointSigned,
            action: checkpointObject({ name: checkpointChoice("ai"), arguments: checkpointArray(checkpointSigned, 2) }, { raw: checkpointString }) })) }) }),
      controller: checkpointObject({ blocks: equal((checkpoint) => checkpoint.options.triggers),
        runtime: checkpointObject({ lives: checkpointRecord(checkpointByte, /^\d+$/), statistics: checkpointStats, bail: checkpointBail }),
        consumedLosses: checkpointRecord(checkpointLoss, /^\[/), revision: checkpointInteger() }),
    }, { sourceDayNight: checkpointClock, production: checkpointProductionState, campaignAi: checkpointCampaignAiState,
      browserConstruction: checkpointObject({ kind: checkpointChoice("browser-construction-state-v1"), sourceId: checkpointString,
        sessionId: checkpointString, sequence: checkpointInteger(), receiptId: checkpointNullable(checkpointString),
        phase: checkpointChoice("empty", "building", "ready"), elapsedVisits: checkpointInteger(),
        paid: checkpointInteger(), costAccumulator: checkpointInteger() }, {
        slots: checkpointRecord(checkpointObject({ kind: checkpointChoice("browser-construction-state-v1"), sourceId: checkpointString,
          sessionId: checkpointString, sequence: checkpointInteger(), receiptId: checkpointNullable(checkpointString),
          phase: checkpointChoice("empty", "building", "ready"), elapsedVisits: checkpointInteger(),
          paid: checkpointInteger(), costAccumulator: checkpointInteger() }), /^[0-4]$/),
        upgrades: checkpointRecord(checkpointObject({ receiptId: checkpointString, dependency: checkpointInteger(0, 109),
          key: checkpointString, generation: checkpointChoice(0), fromLevel: checkpointChoice(0), level: checkpointChoice(1),
          phase: checkpointChoice("building", "ready", "destroyed"), elapsedVisits: checkpointInteger(),
          paid: checkpointInteger(), health: checkpointInteger() }), /^[23]$/) }),
      browserEconomyLedger: checkpointObject({ profileId: checkpointString, sessionId: checkpointString,
        earned: checkpointRecord(checkpointInteger(), /^[0-7]$/) }),
      aiSelectorInputs: checkpointArray((input) => requireSession(input !== null && typeof input === "object", "Checkpoint selector caller input")),
      constructionInputs: checkpointArray((input) => requireSession(input !== null && typeof input === "object", "Checkpoint CITY caller input")),
      nativeAiInputs: checkpointArray((input) => requireSession(input !== null && typeof input === "object", "Checkpoint native AI caller input")),
      nativeSourceInputs: checkpointArray((input) => requireSession(input !== null && typeof input === "object", "Checkpoint native source caller input")),
        campaignAiInputs: checkpointArray((input) => requireSession(input !== null && typeof input === "object", "Checkpoint full caller input")) }) },
      { replayPolicy: checkpointChoice(CURRENT_CAMPAIGN_REPLAY_POLICY) })(value);
}

const checkpointProductionAction = checkpointUnion("type", Object.fromEntries([
  ["receive-prepaid-city", checkpointObject({ type: checkpointChoice("receive-prepaid-city"), dependency: checkpointType,
    slot: checkpointChoice(3), level: checkpointChoice(0), expectedCredits: checkpointSigned,
    provenance: checkpointObject({ code: checkpointChoice("campaign-ai"), sourceSha256: checkpointChoice(CAMPAIGN_AI_SOURCE_SHA256), receiptKey: checkpointString }) })],
  ["native-construction-visit", checkpointObject({ type: checkpointChoice("native-construction-visit"), visit: checkpointConstructionVisit })],
  ["sync-credits", checkpointObject({ type: checkpointChoice("sync-credits"), expectedPreviousCredits: checkpointSigned, credits: checkpointSigned })],
  ["receive-prepaid-unit", checkpointObject({ type: checkpointChoice("receive-prepaid-unit"), dependency: checkpointType,
    unitType: checkpointChoice(0, 8), count: checkpointChoice(1), expectedCredits: checkpointSigned,
    provenance: checkpointObject({ code: checkpointChoice("campaign-ai"), sourceSha256: checkpointChoice(CAMPAIGN_AI_SOURCE_SHA256), receiptKey: checkpointString }) })],
  ...["reserve", "release-pending", "dispatch"].map((type) => [type, checkpointObject({ type: checkpointChoice(type), dependency: checkpointType })]),
  ...["producer-started", "producer-cap-refund"].map((type) => [type, checkpointObject({ type: checkpointChoice(type), queue: checkpointInteger(0, 3), ticket: checkpointString })]),
  ["allocated", checkpointObject({ type: checkpointChoice("allocated"), queue: checkpointInteger(0, 3), requestId: checkpointString,
    nativeSlot: checkpointInteger(152, 798), generation: checkpointInteger() })],
]));
const checkpointProductionRequest = checkpointUnion("type", {
  "initialize-science": checkpointObject({ type: checkpointChoice("initialize-science"), id: checkpointString, team: checkpointTeam,
    nativeId: checkpointSlot, unitType: checkpointChoice(20, 32), slot: checkpointChoice(3), level: checkpointChoice(0) }),
  "upgrade-applied": checkpointObject({ type: checkpointChoice("upgrade-applied"), id: checkpointString, team: checkpointTeam,
    unitType: checkpointType, selector: checkpointBit, level: checkpointInteger(1, 2) }),
  "allocate-unit": checkpointObject({ type: checkpointChoice("allocate-unit"), id: checkpointString, team: checkpointTeam,
    queue: checkpointInteger(0, 3), ticket: checkpointString, unitType: checkpointType, tileX: checkpointByte, tileY: checkpointByte }),
  "unit-allocated": checkpointObject({ type: checkpointChoice("unit-allocated"), id: checkpointString, team: checkpointTeam,
    nativeSlot: checkpointInteger(152, 798), generation: checkpointInteger() }),
  "population-message": checkpointObject({ type: checkpointChoice("population-message"), id: checkpointString, team: checkpointTeam, message: checkpointChoice(119) }),
});
const checkpointProductionState = checkpointObject({ kind: checkpointChoice("campaign-production-v1"), sessionId: checkpointString,
  queueSafetyLimit: checkpointInteger(1, 50), catalog: checkpointArray(checkpointObject({ ...checkpointDependencyFields,
    kind: checkpointChoice("building", "unit", "upgrade"), unitType: checkpointNullable(checkpointType), buildTimeTicks: checkpointChoice(null) })),
  units: checkpointArray(checkpointProductionUnit), sourceProfiles: checkpointArray(checkpointProductionProfile),
  teams: checkpointArray(checkpointObject({ team: checkpointTeam, race: checkpointBit, credits: checkpointSigned,
    costAccumulator: checkpointInteger(0, 2147483647), base: checkpointPosition,
    slots: checkpointArray(checkpointObject({ health: checkpointInteger(), level: checkpointBit, busy: checkpointBit }), 5),
    restrictions: checkpointArray(checkpointType), upgrades: checkpointArray(checkpointObject({ unitType: checkpointType, weapon: checkpointInteger(0, 2), armor: checkpointInteger(0, 2) })),
    eligibility: checkpointRecord(checkpointInteger(0, 2), /^\d+$/), pending: checkpointRecord(checkpointInteger(0, 50), /^\d+$/),
    queues: checkpointArray(checkpointObject({ items: checkpointArray(checkpointObject({ ticket: checkpointString, dependency: checkpointType,
      unitType: checkpointType, cost: checkpointInteger() })), ready: checkpointBit, delay: checkpointByte,
      activeTicket: checkpointNullable(checkpointString), allocation: checkpointNullable(checkpointObject({ id: checkpointString, ticket: checkpointString,
        unitType: checkpointType, tileX: checkpointByte, tileY: checkpointByte })) }, {
          animation: checkpointAnimation, adaptedElapsedVisits: checkpointWord }), 4),
    latch: checkpointBit, construction: checkpointNullable(checkpointObject({ id: checkpointString, nativeId: checkpointSlot,
      unitType: checkpointChoice(20, 32), phase: checkpointInteger(0, 4) })) }, { producerDelays: checkpointArray(checkpointByte, 4) })),
  journal: checkpointArray(checkpointObject({ id: checkpointString, team: checkpointTeam, action: checkpointProductionAction })),
  requests: checkpointArray(checkpointProductionRequest),
}, { constructionHosts: checkpointArray(checkpointConstructionHost),
  adaptedCollectorProfiles: checkpointArray(checkpointAdaptedCollectorProfile),
  adaptedUpgrades: checkpointObject({ runtimeProfile: checkpointChoice("browser-adapted") }),
  adaptedUnitProfiles: checkpointArray(checkpointAdaptedUnitProfile) });

function validateRestoredSession(state: CampaignSessionState, initial: CampaignSessionState, options: CampaignSessionOptions): CampaignAiSessionState | undefined {
  const equal = (left: unknown, right: unknown, label: string) => requireSession(sameCheckpointValue(left, right), `Checkpoint ${label}`);
  const unique = <Entry>(entries: readonly Entry[], key: (entry: Entry) => unknown, label: string) =>
    requireSession(new Set(entries.map(key)).size === entries.length, `Checkpoint duplicate ${label}`);
  const world = state.world, host = hostOf(world), seed = hostOf(initial.world);
  equal(host.nativeAiTasks?.configuration, seed.nativeAiTasks?.configuration, "native AI source configuration");
  requireSession(Boolean(host.nativeAiTasks) === Boolean(seed.nativeAiTasks), "Checkpoint native AI owner");
  validateNativeAiTaskAlignment(world);
  equal(world.sessionId, options.sessionId, "session ID");
  equal(world.source, initial.world.source, "world source");
  equal(world.placementState, initial.world.placementState, "native placement allocation");
  equal(world.typeMovementClasses, initial.world.typeMovementClasses, "movement classes");
  equal(world.messageTexts, initial.world.messageTexts, "message source");
  equal(Object.keys(world.buildingSlots).sort(), Object.keys(initial.world.buildingSlots).sort(), "building slots");
  equal(state.controller.blocks, initial.controller.blocks, "trigger blocks");
  equal(Object.keys(state.controller.runtime.lives).sort(), Object.keys(initial.controller.runtime.lives).sort(), "trigger lives");
  equal(world.statistics, state.controller.runtime.statistics, "controller statistics");
  for (const key of ["width", "height", "groundEligible", "definitions", "sides", "directionBits", "fixedStepMilliseconds", "orientationSteps"] as const)
    equal(host[key], seed[key], `host source ${key}`);
  requireSession(host.directionCursor <= host.directionBits.length && host.highWater >= seed.highWater && host.tick === state.cycleCounter &&
    host.remainderMilliseconds < host.fixedStepMilliseconds, "Checkpoint native allocation/clock");
  const cells = host.width * host.height;
  requireSession([host.ground, host.flying, host.resourceTileFlags].every((plane) => plane.length === cells), "Checkpoint plane size");
  unique(state.staticSlots, (slot) => slot, "static slot");
  requireSession(state.staticSlots.every((slot) => initial.staticSlots.includes(slot) && world.entities.some((entity) => entity.rawSlot === slot)), "Checkpoint static slots");
  unique(world.entities, (entity) => entity.rawSlot, "world slot");
  unique(world.entities, (entity) => entity.key, "world key");
  unique(host.receipts, (receipt) => receipt.id, "receipt");
  unique(host.motions, (motion) => motion.id, "motion");
  unique(host.reducer.carriers, (carrier) => carrier.id, "carrier ID");
  unique(host.reducer.carriers, (carrier) => carrier.slot, "carrier slot");
  unique(host.fifos, (fifo) => `${fifo.tile.x}:${fifo.tile.y}`, "FIFO");
  for (const fifo of host.fifos) requireSession(fifo.tile.x < host.width && fifo.tile.y < host.height && fifo.types.length <= 10 &&
    fifo.types.every((type) => host.definitions.some((definition) => definition.unitType === type)), "Checkpoint FIFO");
  const bytes = world.entityBytes!, raw = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const identities = new Map(initial.world.entities.map((entity) => [`${entity.rawSlot}:${entity.generation}`, entity]));
  const deaths = new Set<string>(), detached = new Set<string>();
  for (const request of host.requests) {
    const identity = `${request.slot}:${request.generation}`;
    if (request.type === "create") {
      requireSession(!identities.has(identity) && request.slot >= 152 && request.slot < host.highWater &&
        request.generation <= host.generations[request.slot], "Checkpoint creation provenance");
      const definition = options.units.find((unit) => unit.index === request.unitType);
      requireSession(definition && host.definitions.some((entry) => entry.unitType === definition.index), "Checkpoint created type");
      identities.set(identity, { key: `transport:${identity}`, rawSlot: request.slot, generation: request.generation, sourceRow: null,
        team: request.team, unitType: request.unitType, tileX: request.position.x >>> 8, tileY: request.position.y >>> 8,
        rawTail: [], health: definition.health, maxHealth: definition.health, simulationId: null });
    }
    requireSession(identities.has(identity), "Checkpoint request identity");
    if (request.type === "combat-death") {
      const entity = identities.get(identity)!;
      requireSession(!deaths.has(identity) && request.loss.id === JSON.stringify([world.sessionId, entity.key, entity.generation]) &&
        request.loss.victimTeam === entity.team, "Checkpoint death provenance");
      equal(state.controller.consumedLosses[request.loss.id], request.loss, "consumed loss");
      deaths.add(identity);
    }
    if (["remove-noncombat", "clear-collision", "unregister"].includes(request.type)) detached.add(identity);
  }
  equal(Object.keys(state.controller.consumedLosses).length, deaths.size, "loss provenance count");
  const lossCounts: Record<string, number> = {};
  for (const [id, loss] of Object.entries(state.controller.consumedLosses)) {
    equal(id, loss.id, "loss ID");
    for (const key of [`${loss.victimTeam},3`, `${loss.victimTeam},0,${loss.victimType}`]) lossCounts[key] = (lossCounts[key] ?? 0) + 1;
  }
  for (let team = 0; team < 8; team += 1) for (const suffix of ["3", ...Array.from({ length: 110 }, (_, type) => `0,${type}`)]) {
    const key = `${team},${suffix}`;
    equal(world.statistics[key], lossCounts[key] ?? 0, "loss statistics");
  }
  for (const [slot, record] of host.slots.entries()) {
    const offset = slot * 220;
    if (!record) {
      requireSession(host.generations[slot] === -1 && host.registry[slot] === null && bytes[offset + 0x2c] === 0, "Checkpoint empty slot");
      continue;
    }
    requireSession(record.slot === slot && host.generations[slot] === record.generation && (slot < 152 || slot < host.highWater), "Checkpoint slot generation/allocation");
    requireSession(host.registry[slot] === (record.status === 0 ? null : record.key) ||
      (state.staticSlots.includes(slot) && record.health === 0 && host.registry[slot] === null), "Checkpoint slot registry");
    equal([bytes[offset + 6], bytes[offset + 7], bytes[offset + 0x2c], raw.getUint16(offset, true), raw.getUint16(offset + 4, true), raw.getUint16(offset + 2, true)],
      [record.unitType, record.team, record.status, record.position.x, record.position.y, record.height], "raw slot identity/position");
    if (record.task !== "transport" && !(record.team === 8 && [92, 93].includes(record.unitType))) {
      const identity = `${slot}:${record.generation}`, origin = identities.get(identity);
      requireSession(origin && origin.key === record.key && origin.team === record.team, "Checkpoint slot provenance");
      equal(raw.getUint32(offset + 12, true), record.health >>> 0, "raw slot health");
      requireSession(record.status !== 10 || record.resourceTask || deaths.has(identity) || detached.has(identity), "Checkpoint inactive provenance");
    }
    if (record.resource) equal([raw.getUint16(offset + 0x32, true), record.unitType, record.team],
      [record.resource.rateWord, 40, 8], "resource rate/type");
    if (record.resourceTask) {
      const task = record.resourceTask, top = task.stack.at(-1);
      const nativeBinding = seed.resourceLifecycle?.nativeHarvest?.bindings.find(binding => binding.slot === slot);
      if (nativeBinding) {
        equal(task.nativeIdle?.randomIndex, nativeBinding.randomIndex, "isolated native RNG index");
        equal(task.nativeBanks, seed.slots[slot]!.resourceTask!.nativeBanks, "source native FIN banks");
        if (task.nativeMovement) equal(task.nativeMovement.state.randomIndex, nativeBinding.randomIndex, "movement RNG index");
      }
      if (task.nativeMovement) {
        validateNativeMovement(task.nativeMovement);
        const movement = task.nativeMovement;
        equal(movement.state.raw, Array.from(bytes.slice(offset, offset + 220)), "raw native movement");
        equal([movement.state.slot, movement.state.typeId, movement.state.team, movement.state.hp, movement.state.xQ8, movement.state.yQ8],
          [slot, record.unitType, record.team, record.health, record.position.x, record.position.y], "native movement actor");
        const source = seed.resourceLifecycle?.nativeHarvest?.profiles.find(profile => profile.typeId === record.unitType);
        requireSession(source, "Missing immutable native movement source");
        for (const key of ["profile", "pthSha256", "width", "height", "selectedWeapon", "families", "census", "standBank", "moveBank",
          "preservedIdleBank", "animations", "finBindings"] as const) equal(movement.world[key], source[key], `native movement source ${key}`);
        requireSession(movement.world.groundCells.every((cell, index) => source.tripWords[source.groundCells.indexOf(cell)] === movement.world.tripWords[index]),
          "Native movement trip source");
        continue;
      }
      requireSession(top && task.stack.length <= 3 && task.stack.every((entry) =>
        entry.words.length === (entry.opcode === 3 || entry.opcode === 10 ? 2 : entry.opcode === 13 ? 1 : 3)), "Checkpoint resource stack");
      equal(record.taskWords, top.words, "resource payload alias");
      const expectedTask = { 1: "idle", 3: "idle", 10: "removal", 12: "extraction", 13: "retraction" }[top.opcode];
      equal(record.task, expectedTask, "resource task owner");
      const profile = host.resourceLifecycle?.animations.find((entry) => entry.id === task.animation.profile);
      const mobileType = record.unitType === 47 ? 6 : record.unitType === 48 ? 14 : record.unitType;
      requireSession(profile && host.resourceLifecycle?.types.some((entry) => [record.unitType, mobileType].includes(entry.unitType) &&
        [entry.stand, entry.deploy, entry.death, entry.preservedIdle].includes(profile.id)), "Checkpoint resource animation profile");
      if (task.stack.some((entry) => entry.opcode === 3)) {
        requireSession(task.nativeIdle && task.stack[0].opcode === 1 && task.stack[1]?.opcode === 3 &&
          task.stack[1].words[0] <= 7 && task.stack[1].words[1] <= 32767 &&
          sameCheckpointValue(task.stack[0].words, [65535, task.stack[0].words[1], 0]) &&
          task.stack[0].words[1] <= 32767 && (task.stack.length === 2 || top.opcode === 12), "Checkpoint native wait stack");
      }
      if (task.nativeIdle) {
        requireSession((task.nativeIdle.groundWord & 1023) === slot &&
          ([0, 10].includes(record.status) || host.ground[(record.position.y >> 8) * host.width + (record.position.x >> 8)] === slot),
        "Checkpoint native idle occupancy");
        equal([bytes[offset + 0x35], bytes[offset + 0xcb], bytes[offset + 0xd0], bytes[offset + 0xc7],
          bytes[offset + 0x22], bytes[offset + 0x2a]],
        [task.nativeIdle.observer, task.nativeIdle.specialOrder, task.nativeIdle.confusion,
          task.nativeIdle.secondaryAnimationPending, 2, 2], "raw native idle guards");
      }
      requireSession(task.animation.frame < profile.directions[(((task.direction + 8) & 255) >>> 4) * 2].length, "Checkpoint resource animation frame");
      advanceLegacyResourceAnimation(task.animation, profile, task.direction);
      equal([bytes[offset + 9], bytes[offset + 0x18], bytes[offset + 0x19], bytes[offset + 0x1a], bytes[offset + 0x36], bytes[offset + 0x37], bytes[offset + 0x38]],
        [task.direction, task.animation.frame, task.animation.delay, task.animation.mode, task.pendingOrder, task.order, task.stack.length - 1], "raw resource animation");
      let payload = 0;
      for (const [depth, entry] of task.stack.entries()) {
        equal([bytes[offset + 0x39 + depth * 2], bytes[offset + 0x3a + depth * 2]], [entry.opcode, payload], "raw resource stack");
        for (const word of entry.words) equal(raw.getUint16(offset + 0x46 + payload++ * 2, true), word, "raw resource payload");
      }
      equal(bytes[offset + 0x3a + task.stack.length * 2], payload, "raw resource stack end");
      if (record.resource && top.opcode === 1) equal(task.stack[0].words[0], record.resource.countdownWord, "resource countdown");
      if (top.opcode === 12) requireSession(host.slots[top.words[0]]?.resource, "Checkpoint extraction source");
    }
  }
  for (const entity of world.entities) {
    const record = host.slots[entity.rawSlot!]!, origin = identities.get(`${entity.rawSlot}:${entity.generation}`);
    requireSession(record && origin && origin.key === entity.key && origin.sourceRow === entity.sourceRow &&
      entity.tileX < host.width && entity.tileY < host.height, "Checkpoint world entity provenance");
    equal([entity.key, entity.generation, entity.team, entity.unitType, entity.health],
      [record.key, record.generation, record.team, record.unitType, record.health], "world/host entity");
    equal(entity.rawTail, origin.rawTail, "entity source tail");
    equal(entity.maxHealth, origin.maxHealth, "entity source health");
    equal(entity.resource, record.resource, "world resource");
    requireSession(entity.simulationId === null && options.units.some((unit) => unit.index === entity.unitType), "Checkpoint world type/binding");
  }
  for (const carrier of host.reducer.carriers) {
    const record = host.slots[carrier.slot];
    requireSession(carrier.id < host.reducer.nextId && carrier.slot === 15 * carrier.team + 7 + carrier.poolIndex && record &&
      record.team === 8 && record.unitType === carrier.type && record.height === carrier.height &&
      carrier.groups.length === (carrier.commanderSlot === null ? 5 : 0), "Checkpoint carrier binding");
    if (carrier.commanderSlot !== null) requireSession(host.slots[carrier.commanderSlot], "Checkpoint commander reference");
  }
  for (const motion of host.motions) requireSession(host.reducer.carriers.some((carrier) => carrier.id === motion.id &&
    carrier.phase === (motion.kind === "orientation" ? "orientation" : "approach")), "Checkpoint motion reference");
  const rebuilt = structuredClone(host);
  rebuildOccupancy(rebuilt, state.staticSlots, state.world.browserCasualtyPickup?.runtimeProfile === "browser-adapted", state.world.source);
  equal(host.ground, rebuilt.ground, "ground occupancy");
  equal(host.flying, rebuilt.flying, "flying occupancy");
  const feedback = refreshFeedback(state, options);
  equal(world.statistics, feedback.world.statistics, "census statistics");
  equal(world.buildingSlots, feedback.world.buildingSlots, "building health");
  equal(world.commanderSlots, feedback.world.commanderSlots, "commander slots");
  for (const message of world.messages) equal(message.text, world.messageTexts[message.messageId], "message provenance");
  requireSession(Boolean(host.resourceLifecycle) === Boolean(seed.resourceLifecycle) && Boolean(state.sourceDayNight) === Boolean(initial.sourceDayNight), "Checkpoint saved source clock/lifecycle");
  if (host.resourceLifecycle) {
    equal(host.resourceLifecycle.animations, seed.resourceLifecycle!.animations, "resource source profiles");
    equal(host.resourceLifecycle.types, seed.resourceLifecycle!.types, "resource source types");
    equal(host.resourceLifecycle.nativeHarvest, seed.resourceLifecycle!.nativeHarvest, "native harvest source configuration");
    const clock = state.sourceDayNight!, start = initial.sourceDayNight!;
    equal([clock.cycleLength, clock.transitionTicks], [start.cycleLength, start.transitionTicks], "source clock configuration");
    const firstRollover = Math.max(1, start.cycleLength - start.elapsed + 1);
    const rollovers = state.cycleCounter < firstRollover ? 0 : 1 + Math.floor((state.cycleCounter - firstRollover) / (start.cycleLength + 1));
    const elapsed = rollovers === 0 ? start.elapsed + state.cycleCounter : (state.cycleCounter - firstRollover) % (start.cycleLength + 1);
    equal([clock.elapsed, clock.phase], [elapsed, (start.phase + rollovers) % 2], "clock does not match cycle");
    const fraction = Math.trunc(elapsed * 256 / clock.transitionTicks);
    const blend = state.cycleCounter === 0 ? start.blend : elapsed <= clock.transitionTicks
      ? clock.phase === 0 ? 256 - fraction : fraction
      : rollovers > 0 || start.elapsed < clock.transitionTicks ? clock.phase * 256 : start.blend;
    equal(clock.blend, blend, "source clock blend");
    equal(host.resourceLifecycle.nativePhaseCounter, state.cycleCounter === 0 ? null : elapsed, "native resource phase");
  }
  requireSession(Boolean(state.production) === Boolean(initial.production), "Checkpoint saved native production state");
  requireSession(state.production || !host.productionExits?.length, "Checkpoint unowned production exits");
  requireSession(Boolean(state.campaignAi) === Boolean(initial.campaignAi), "Checkpoint saved campaign-ai state");
  const campaignAi = state.campaignAi && validateCampaignAiSession(state.campaignAi, options.campaignAi!, state.production!, state.world);
  if (state.production) validateRestoredProduction(state, initial.production!);
  return campaignAi;
}

function validateRestoredProduction(state: CampaignSessionState, seed: CampaignProductionState): void {
  const production = state.production!, host = hostOf(state.world);
  const equal = (left: unknown, right: unknown) => requireSession(sameCheckpointValue(left, right), "Checkpoint production state");
  for (const key of ["kind", "sessionId", "queueSafetyLimit", "catalog", "units", "sourceProfiles", "adaptedCollectorProfiles", "adaptedUnitProfiles", "adaptedUpgrades"] as const) equal(production[key], seed[key]);
  equal(production.teams.map((team) => team.team), seed.teams.map((team) => team.team));
  requireSession(new Set(production.journal.map((entry) => entry.id)).size === production.journal.length, "Checkpoint duplicate production event");
  const activeExits: string[] = [];
  for (const team of production.teams) {
    const original = seed.teams.find((entry) => entry.team === team.team)!;
    for (const key of ["race", "base", "restrictions"] as const) equal(team[key], original[key]);
    equal("producerDelays" in team ? team.producerDelays : undefined, "producerDelays" in original ? original.producerDelays : undefined);
    equal(team.credits, state.world.exomoney[team.team]);
    equal(Object.keys(team.eligibility).sort(), Object.keys(original.eligibility).sort());
    for (let slot = 0; slot < 5; slot += 1) equal(team.slots[slot].health,
      state.world.entities.find((entity) => entity.rawSlot === team.team * 15 + slot)?.health ?? 0);
    requireSession(new Set(team.upgrades.map((entry) => entry.unitType)).size === team.upgrades.length, "Checkpoint duplicate upgrade");
    for (const [dependency, count] of Object.entries(team.pending)) {
      const entry = production.catalog.find((candidate) => candidate.id === Number(dependency));
      requireSession(entry && count <= (entry.kind === "unit" ? 50 : 1), "Checkpoint pending dependency");
    }
    for (const [queueIndex, queue] of team.queues.entries()) {
      const pending = production.catalog.filter((entry) => entry.kind === "unit" &&
        production.units.find((unit) => unit.unitType === entry.unitType)?.queue === queueIndex)
        .reduce((total, entry) => total + (team.pending[entry.id] ?? 0), 0);
      requireSession(queue.items.length + pending <= production.queueSafetyLimit && new Set(queue.items.map((entry) => entry.ticket)).size === queue.items.length,
        "Checkpoint production queue capacity/tickets");
      for (const item of queue.items) {
        const catalog = production.catalog.find((entry) => entry.id === item.dependency);
        requireSession(catalog?.kind === "unit" && catalog.unitType === item.unitType && catalog.cost === item.cost &&
          production.units.some((unit) => unit.unitType === item.unitType && unit.queue === queueIndex), "Checkpoint production queue source");
        const paid = state.campaignAi?.history.some(({ receipt }) => receipt.team === team.team && receipt.intents.some((intent) =>
          intent.ticket === item.ticket && intent.dependency === item.dependency && intent.packet[3] === item.unitType));
        requireSession(paid || production.journal.some((event) => event.team === team.team && event.action.type === "dispatch" &&
          event.action.dependency === item.dependency && item.ticket.startsWith(`${event.id}:`)), "Checkpoint production ticket provenance");
      }
      const adapted = production.adaptedCollectorProfiles?.find(profile => profile.unitType === queue.items[0]?.unitType
        && profile.unitType === 6 + team.race * 8 && queueIndex === 2)
        ?? production.adaptedUnitProfiles?.find(profile => profile.unitType === queue.items[0]?.unitType
          && ADAPTED_UNIT_PRODUCTION_SOURCES.some(source => source.unitType === profile.unitType
            && source.race === team.race && source.queue === queueIndex));
      requireSession(queue.adaptedElapsedVisits === undefined
        ? !(adapted && queue.activeTicket)
        : adapted && queue.activeTicket && !queue.animation && queue.adaptedElapsedVisits <= adapted.completionVisits,
      "Checkpoint adapted production progress");
      requireSession(queue.ready === 1 ? queue.activeTicket === null && queue.allocation === null
        : queue.items.length > 0 && queue.activeTicket === queue.items[0].ticket
          && (adapted ? queue.adaptedElapsedVisits !== undefined : !!queue.animation), "Checkpoint production active ticket");
      if (queue.animation) {
        const profile = production.sourceProfiles!.find((entry) => entry.id === queue.animation!.profile);
        requireSession(profile && queue.animation.frame < profile.directions[0].length &&
          (!queue.activeTicket || profile.unitType === queue.items[0].unitType), "Checkpoint production animation profile/frame");
        advanceLegacyResourceAnimation(queue.animation, profile, 0);
      }
      if (queue.activeTicket) {
        const key = JSON.stringify([production.sessionId, team.team, queueIndex, queue.activeTicket]);
        const exit = host.productionExits?.find((entry) => entry.key === key);
        const source = production.units.find((entry) => entry.unitType === queue.items[0].unitType)!;
        requireSession(exit && exit.team === team.team && exit.queue === queueIndex && exit.ticket === queue.activeTicket &&
          exit.unitType === source.unitType && exit.tile.x === team.base.x + source.exitOffset.x && exit.tile.y === team.base.y + source.exitOffset.y,
        "Checkpoint production exit ownership");
        activeExits.push(key);
      }
      if (queue.allocation) requireSession((adapted ? queue.adaptedElapsedVisits === adapted.completionVisits : queue.animation?.mode === 2)
        && queue.allocation.ticket === queue.activeTicket &&
        production.requests.some((request) => request.type === "allocate-unit" && request.id === queue.allocation!.id &&
          request.ticket === queue.activeTicket), "Checkpoint production allocation");
    }
    const refreshed = reduceCampaignProduction({ ...production, journal: [] }, { id: "checkpoint-validation", team: team.team,
      action: { type: "sync-credits", expectedPreviousCredits: team.credits, credits: team.credits } });
    equal(team.eligibility, refreshed.teams.find((entry) => entry.team === team.team)!.eligibility);
  }
  equal((host.productionExits ?? []).map((exit) => exit.key).sort(), activeExits.sort());
  for (const event of production.journal) {
    const action = event.action;
    const allocated = action.type === "allocated" &&
      event.id === `production:${production.sessionId}:${action.requestId}:allocated` &&
      production.requests.some((request) => request.type === "allocate-unit" && request.id === action.requestId &&
        request.team === event.team && request.queue === action.queue) &&
      production.requests.some((request) => request.type === "unit-allocated" && request.team === event.team &&
        request.nativeSlot === action.nativeSlot && request.generation === action.generation) &&
      host.requests.some((request) => request.type === "create" && request.team === event.team &&
        request.slot === action.nativeSlot && request.generation === action.generation);
    const paid = state.campaignAi?.history.some(({ receipt }) => receipt.team === event.team && receipt.intents.some((intent) =>
      event.id === intent.id || event.id === `${intent.id}:credits`));
    const creditSync = state.campaignAi && action.type === "sync-credits" &&
      /^session:\d+:[0-7]:(before-commands|after-resources|after-triggers)$/.test(event.id) &&
      Number(event.id.split(":")[1]) <= state.cycleCounter && Number(event.id.split(":")[2]) === event.team;
    requireSession(production.teams.some((team) => team.team === event.team) &&
      (paid || creditSync || (event.id.startsWith("input:") && ["reserve", "release-pending", "dispatch"].includes(action.type)) ||
        (event.id.startsWith("session:") && ["producer-started", "producer-cap-refund"].includes(action.type)) || allocated),
    "Checkpoint production event provenance");
  }
  for (const request of production.requests) {
    requireSession(production.teams.some((team) => team.team === request.team), "Checkpoint production request team");
    if (request.type === "unit-allocated") requireSession(host.requests.some((entry) => entry.type === "create" &&
      entry.slot === request.nativeSlot && entry.generation === request.generation && entry.team === request.team), "Checkpoint production allocation identity");
  }
}

function freezeSessionHistory<Value>(value: Value, seen = new WeakSet<object>()): Value {
  if (value !== null && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    for (const entry of Object.values(value)) freezeSessionHistory(entry, seen);
    Object.freeze(value);
  }
  return value;
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === "object" && !Object.isFrozen(value) && !ArrayBuffer.isView(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function cloneSessionState(state: CampaignSessionState, shareBrowserHistory = false): CampaignSessionState {
  const { world, aiSelectorInputs, production, ...operational } = state;
  return { ...structuredClone(operational), world: cloneTransportHostWorld(world),
    ...(production ? { production: shareBrowserHistory ? production : structuredClone(production) } : {}),
    ...(aiSelectorInputs ? { aiSelectorInputs: shareBrowserHistory ? aiSelectorInputs : structuredClone(aiSelectorInputs) } : {}) };
}

function retainSessionOptions(options: CampaignSessionOptions): CampaignSessionOptions {
  if (options.nativeCombat?.visibility) validateSourceNativeVisibilityHostConfiguration(options.nativeCombat.visibility);
  let nativeAiTasks = options.nativeAiTasks && snapshotNativeTaskConfiguration(options.nativeAiTasks);
  if (nativeAiTasks?.sourceId.startsWith("nativeactor-source-v2:")) nativeAiTasks = retainSourceNativeTaskConfiguration(nativeAiTasks);
  const nativeCombat = options.nativeCombat && retainSourceNativeCombatConfiguration(options.nativeCombat);
  const aiSelectorOwner = options.aiSelectorOwner && retainAiSelectorOwner(options.aiSelectorOwner);
  const { nativeAiTasks: _unused, nativeCombat: _unusedCombat, aiSelectorOwner: _unusedSelectorOwner, browserConstruction, ...remaining } = options;
  const retained = cloneSessionInput({ ...remaining, map: { width: options.map.width, height: options.map.height } });
  return { ...retained, ...(nativeAiTasks ? { nativeAiTasks } : {}), ...(nativeCombat ? { nativeCombat } : {}),
    ...(browserConstruction ? { browserConstruction } : {}),
    ...(aiSelectorOwner ? { aiSelectorOwner } : {}) };
}

export class CampaignSession {
  private current: CampaignSessionState;
  private readonly options: CampaignSessionOptions;
  private readonly entries: CampaignSessionJournalEntry[] = [];
  private readonly journalLimit: number | "all";
  private journalStart = 0;
  private journalTotal = 0;
  private includeReplayPolicy = true;
  private adaptedProjectionCache?: { state: CampaignSessionState; value: AdaptedTroProjection };
  private browserProjectionCache?: { state: CampaignSessionState; value: BrowserCampaignProjection };
  // Per committed state; values are deep-frozen because every caller shares them.
  private hudSnapshotCache?: { state: CampaignSessionState; value: ReturnType<CampaignSession["buildHudSnapshot"]> };
  private constructionStatusCache?: { state: CampaignSessionState; value: ReturnType<CampaignSession["buildConstructionStatus"]> };

  constructor(options: CampaignSessionOptions, fork?: CampaignSession) {
    if (!fork && options.browserEconomy) {
      validateSessionJson(options.browserEconomy);
      validateSessionJson(options.source);
      validateSessionJson(options.units);
    }
    this.options = fork?.options ?? retainSessionOptions(options);
    this.includeReplayPolicy = fork?.includeReplayPolicy ?? true;
    if (legacyFeedbackOptions.has(options)) legacyFeedbackOptions.add(this.options);
    this.journalLimit = this.options.journalLimit === undefined ? 4096 : this.options.journalLimit;
    requireSession(this.journalLimit === "all" || (Number.isSafeInteger(this.journalLimit) && this.journalLimit >= 0),
      "Journal limit must be a nonnegative safe integer or all");
    this.current = fork ? this.runtimeProfile === "browser-adapted" ? fork.current : cloneSessionState(fork.current)
      : refreshFeedback(unwrap(initializeCampaignSession(this.options)), this.options);
    if (fork) {
      this.entries.push(...(this.runtimeProfile === "browser-adapted" ? fork.entries : structuredClone(fork.entries)));
      this.journalStart = fork.journalStart;
      this.journalTotal = fork.journalTotal;
    }
  }

  fork(): CampaignSession { return new CampaignSession(this.options, this); }

  get snapshot(): CampaignSessionState {
    const snapshot = structuredClone(this.current);
    return snapshot.production ? { ...snapshot, production: productionSnapshot(snapshot.production) } : snapshot;
  }
  get browserViewSnapshot(): Omit<CampaignSessionState, "aiSelectorInputs"> {
    requireSession(this.runtimeProfile === "browser-adapted", "Browser view requires adapted runtime");
    const { aiSelectorInputs: _history, ...state } = this.current;
    return structuredClone(state);
  }
  /** Exit tiles of producers whose next unit is waiting to start. */
  get browserWaitingProductionExits(): { readonly team: number; readonly x: number; readonly y: number }[] {
    const production = this.current.production;
    if (!production) return [];
    return production.teams.flatMap(team => team.queues.flatMap(queue => {
      const head = queue.items[0];
      const source = head && queue.ready === 1 && !queue.allocation ? production.units.find(unit => unit.unitType === head.unitType) : undefined;
      return source ? [{ team: team.team, x: team.base.x + source.exitOffset.x, y: team.base.y + source.exitOffset.y }] : [];
    }));
  }
  /** Current world, uncloned: steps always clone before mutating, so callers must treat it as read-only. */
  get browserResearchWorld(): CampaignWorld {
    requireSession(this.runtimeProfile === "browser-adapted", "Research observation requires adapted session");
    return this.current.world;
  }

  browserResearchFrame(research: BrowserResearchConfiguration,
    input: Omit<Parameters<typeof observeBrowserResearchType37Frame>[2], "research" | "scienceOwner"> & {
      readonly updates: readonly HostUnitUpdate[];
    }): BrowserType37Frame {
    requireSession(this.runtimeProfile === "browser-adapted", "Research observation requires adapted session");
    // applyUnitBatch only assigns slot-record fields and writes registry, requests, occupancy planes and raw bytes;
    // copying exactly those keeps the committed state untouched without a full session clone (~1.7 ms per H13 tick).
    const { world } = this.current, host = hostOf(world);
    const preview: CampaignSessionState = { ...this.current, world: { ...world, entityBytes: world.entityBytes!.slice(),
      transportState: { ...host, slots: host.slots.map(slot => slot && { ...slot }), registry: [...host.registry],
        requests: [...host.requests], ground: host.ground.slice(), flying: host.flying.slice() } } };
    const projected = refreshFeedback(applyUnitBatch(preview, input.updates), this.options);
    return observeBrowserResearchType37Frame(projected.world, research, { ...input,
      research, scienceOwner: research.scienceOwner });
  }

  browserFrameContext(populationCeiling: number) {
    requireSession(this.runtimeProfile === "browser-adapted", "Browser view requires adapted runtime");
    const host = hostOf(this.current.world);
    const censusWorld = { ...this.current.world,
      transportState: { kind: host.kind, slots: host.slots, registry: host.registry } };
    return { cycleCounter: this.current.cycleCounter,
      productionVisits: this.current.production
        ? sourceProductionVisits(censusWorld, this.current.production, populationCeiling).filter(visit =>
          !(this.current.browserConstruction?.phase === "building" && !this.current.browserConstruction.slots && visit.team === 0 && visit.queue === 2)) : undefined };
  }
  get browserHudSnapshot() {
    requireSession(this.runtimeProfile === "browser-adapted", "Browser view requires adapted runtime");
    if (this.hudSnapshotCache?.state !== this.current) this.hudSnapshotCache = { state: this.current, value: this.buildHudSnapshot() };
    return this.hudSnapshotCache.value;
  }
  private buildHudSnapshot() {
    const { world, controller, production, browserConstruction } = this.current, host = hostOf(world);
    return deepFreeze(structuredClone({ controller: { runtime: { statistics: controller.runtime.statistics } },
      world: { entities: world.entities.filter(entity => entity.unitType === 40 && entity.team === 8), exomoney: world.exomoney },
      transport: { slots: host.slots.map(slot => slot?.unitType === 40 && slot.team === 8 ? slot : null) },
      ...(browserConstruction ? { browserConstruction } : {}),
      ...(production ? { production: { ...production, journal: [], requests: [] } } : {}) }));
  }

  get browserConstructionStatus() {
    if (!this.options.browserConstruction || !this.current.browserConstruction) return undefined;
    if (this.constructionStatusCache?.state !== this.current) {
      this.constructionStatusCache = { state: this.current, value: this.buildConstructionStatus() };
    }
    return this.constructionStatusCache.value;
  }
  private buildConstructionStatus() {
    const configuration = this.options.browserConstruction!, construction = this.current.browserConstruction!;
    return deepFreeze(structuredClone({ state: construction, credits: this.current.world.exomoney[0],
      slots: browserConstructionSlots(configuration, construction, this.current.world),
      choices: browserConstructionChoices(configuration, construction, this.current.world),
      health: this.current.world.buildingSlots["0,0"], restricted:
        (this.current.world.adaptedTro?.dependencyRestrictions[0] ?? this.current.world.source.teams[0].dependencies ?? []).includes(configuration.dependency) }));
  }

  #projectBrowserView(state: CampaignSessionState): Omit<BrowserViewFrame, "entry" | "bailExpired"> {
    const { world, controller, cycleCounter } = state;
    const host = hostOf(world);
    const transport = { kind: host.kind, slots: host.slots, registry: host.registry, generations: host.generations,
      reducer: { carriers: host.reducer.carriers }, fifos: host.fifos, nativeCombat: { death: false } };
    // Shared, not cloned: steps always clone before mutating, and a deep-frozen frame survived 10k army-bot ticks on H10/H12/A13.
    return { cycleCounter,
      controller: { runtime: { bail: controller.runtime.bail, statistics: controller.runtime.statistics } },
      world: { ...world, messages: world.messages.slice(-1), transportState: transport }, transport };
  }
  get latestJournalEntry(): CampaignSessionJournalEntry | undefined {
    const index = (this.journalStart + this.entries.length - 1) % this.entries.length;
    return this.entries.length ? structuredClone(this.entries[index]) : undefined;
  }
  get journal(): readonly CampaignSessionJournalEntry[] {
    return structuredClone(this.journalStart === 0 ? this.entries
      : [...this.entries.slice(this.journalStart), ...this.entries.slice(0, this.journalStart)]);
  }

  get journalStats(): CampaignSessionJournalStats {
    return { total: this.journalTotal, retained: this.entries.length, dropped: this.journalTotal - this.entries.length };
  }

  get runtimeProfile(): CampaignRuntimeProfile { return this.options.runtimeProfile ?? "strict-native"; }

  get adaptedTroProjection(): AdaptedTroProjection | undefined {
    if (this.runtimeProfile !== "browser-adapted") return undefined;
    if (this.adaptedProjectionCache?.state !== this.current) {
      this.adaptedProjectionCache = { state: this.current, value: projectAdaptedTro(this.current.world, this.current.cycleCounter) };
    }
    return this.adaptedProjectionCache.value;
  }

  get browserAiProjection(): BrowserCampaignProjection | undefined {
    if (!this.options.browserAi) return undefined;
    if (this.browserProjectionCache?.state !== this.current) {
      this.browserProjectionCache = { state: this.current,
        value: projectBrowserCampaign(this.options.browserAi, this.current.world, this.current.cycleCounter) };
    }
    return this.browserProjectionCache.value;
  }

  get nativeViewProjection(): NativeViewProjection {
    return this.#projectNativeView(this.current);
  }

  #projectNativeView(state: CampaignSessionState): NativeViewProjection {
    const host = hostOf(state.world);
    requireSession(this.options.nativeCombat && this.options.nativeAiTasks &&
      state.world.sessionId === this.options.sessionId && sameCheckpointValue(state.world.source, this.options.source) &&
      host.nativeCombat?.configuration.taskSourceId === this.options.nativeAiTasks.sourceId,
    "Native view source ownership changed");
    return projectNativeView(state, host);
  }

  nativeViewActorSample(animation: FinAnimationData, slot: number, generation: number, sprite: string) {
    const host = hostOf(this.current.world), actor = host.slots[slot];
    requireSession(this.options.nativeCombat && actor?.nativeAiTask && actor.generation === generation &&
      host.registry[slot] === actor.key && host.generations[slot] === generation, "Native view FIN identity mismatch");
    return structuredClone(sourceNativeCombatActorSample(animation, actor,
      host.nativeAiTasks!.configuration.profiles[actor.nativeAiTask.profile], sprite));
  }

  private recordJournal(entry: CampaignSessionJournalEntry): void {
    this.journalTotal += 1;
    if (this.journalLimit === 0) return;
    const retained = this.runtimeProfile === "browser-adapted"
      ? freezeSessionHistory(structuredClone(entry)) : structuredClone(entry);
    if (this.journalLimit === "all" || this.entries.length < this.journalLimit) this.entries.push(retained);
    else {
      this.entries[this.journalStart] = retained;
      this.journalStart = (this.journalStart + 1) % this.journalLimit;
    }
  }

  get identityProvenance(): readonly CampaignIdentityEvent[] {
    return structuredClone(identityEvents(hostOf(this.current.world).requests));
  }

  checkpoint(): CampaignSessionCheckpoint {
    const world = this.current.world;
    const { aiSelectorOwner: _unusedSelectorOwner, ...options } = this.options;
    return structuredClone({ schemaVersion: this.options.resourceLifecycle?.nativeHarvest || this.options.browserEconomy ? 3 : 2, kind: "campaign-session-snapshot",
      ...(this.options.browserAi && this.includeReplayPolicy ? { replayPolicy: CURRENT_CAMPAIGN_REPLAY_POLICY } : {}),
      options: { ...options, pathGrid: Array.from(this.options.pathGrid), tags: Array.from(this.options.tags) },
      state: { ...this.current, world: { ...world, entityBytes: Array.from(world.entityBytes!),
        typeMovementClasses: Array.from(world.typeMovementClasses!), transportState: hostOf(world),
        placementState: { ...world.placementState, renatBytes: Array.from(world.placementState.renatBytes) } } } });
  }

  static restore(value: unknown, expectedCampaignAi?: CampaignAiConfiguration, expectedNativeAiTasks?: NativeAiTaskConfiguration,
    expectedConstruction?: readonly NativeConstructionConfiguration[], expectedNativeCombat?: SourceNativeCombatConfiguration,
    expectedAiSelectorOwner?: AiSelectorSchedulingOwner, expectedBrowserConstruction?: BrowserConstructionConfiguration): CampaignSession {
    return CampaignSession.#restore(value, expectedCampaignAi, expectedNativeAiTasks, expectedConstruction,
      expectedNativeCombat, expectedAiSelectorOwner, expectedBrowserConstruction);
  }

  static importLegacy(value: unknown, consent: LegacyCampaignImportConsent) {
    requireSession(consent?.policy === "legacy-unmaintained-population-v0" && consent.acknowledgeAmbiguousUnversionedSave === true,
      "Legacy import requires explicit acknowledgement: unversioned legacy saves cannot be distinguished from edited current saves");
    const session = CampaignSession.#restore(value, undefined, undefined, undefined, undefined, undefined, undefined, true);
    const checkpoint = session.checkpoint();
    const differences = campaignReplayDifferences((value as CampaignSessionCheckpoint).state, checkpoint.state);
    return { session, checkpoint, differences, notice: "Explicit legacy import authenticated by full replay. Population feedback migrated to current semantics; original bytes unchanged." };
  }

  static #restore(value: unknown, expectedCampaignAi?: CampaignAiConfiguration, expectedNativeAiTasks?: NativeAiTaskConfiguration,
    expectedConstruction?: readonly NativeConstructionConfiguration[], expectedNativeCombat?: SourceNativeCombatConfiguration,
    expectedAiSelectorOwner?: AiSelectorSchedulingOwner, expectedBrowserConstruction?: BrowserConstructionConfiguration,
    importLegacy = false): CampaignSession {
    validateSessionJson(value);
    requireSession(value !== null && typeof value === "object" && "schemaVersion" in value, "Invalid campaign checkpoint");
    if (value.schemaVersion === 2 || value.schemaVersion === 3) {
      const checkpoint = structuredClone(value);
      validateDirectCheckpoint(checkpoint);
      if (importLegacy) requireSession(checkpoint.replayPolicy === undefined && checkpoint.options.runtimeProfile === "browser-adapted"
        && Boolean(checkpoint.options.browserAi), "Legacy import accepts only unversioned browser-adapted source caller checkpoints; restart unsupported saves");
      requireSession(sameCheckpointValue(checkpoint.options.browserConstruction, expectedBrowserConstruction)
        && Boolean(checkpoint.state.browserConstruction) === Boolean(expectedBrowserConstruction),
      "Browser construction restore requires exact independently authenticated configuration");
      requireSession(checkpoint.options.browserEconomy
        ? checkpoint.schemaVersion === 3 && checkpoint.state.browserEconomyLedger !== undefined
        : checkpoint.state.browserEconomyLedger === undefined, "Browser economy checkpoint requires schema 3 and owned ledger");
      requireSession(sameCheckpointValue(checkpoint.options.campaignAi, expectedCampaignAi),
        "Campaign-ai restore requires exact expected source configuration");
      requireSession(sameCheckpointValue(checkpoint.options.nativeAiTasks, expectedNativeAiTasks),
        "Native AI restore requires exact authenticated expected source configuration");
      requireSession(sameCheckpointValue(checkpoint.options.nativeCombat, expectedNativeCombat),
        "Native combat restore requires exact externally authenticated provider");
      if (expectedNativeCombat) {
        validateSourceNativeCombatConfiguration(expectedNativeCombat);
        if (expectedNativeCombat.visibility) validateSourceNativeVisibilityHostConfiguration(expectedNativeCombat.visibility);
      }
      requireSession(sameCheckpointValue(checkpoint.options.production?.constructionSources, expectedConstruction),
        "CITY restore requires exact independently expected source configuration");
      requireSession(sameCheckpointValue(checkpoint.options.aiSelector, expectedAiSelectorOwner?.configuration),
        "ai: restore requires exact externally configured native policy scheduling owner");
      const replayOptions = { ...checkpoint.options,
        ...(expectedBrowserConstruction ? { browserConstruction: expectedBrowserConstruction } : {}),
        ...(expectedNativeCombat ? { nativeCombat: expectedNativeCombat } : {}),
        ...(expectedAiSelectorOwner ? { aiSelectorOwner: expectedAiSelectorOwner } : {}),
        pathGrid: Uint8Array.from(checkpoint.options.pathGrid), tags: Uint8Array.from(checkpoint.options.tags) };
      const migrated = importLegacy ? new CampaignSession(replayOptions) : undefined;
      if (importLegacy) legacyFeedbackOptions.add(replayOptions);
      const session = new CampaignSession(replayOptions);
      const saved = checkpoint.state;
      const legacyBrowserCasualtyOwner = checkpoint.options.runtimeProfile === "browser-adapted"
        && saved.world.browserCasualtyPickup === undefined && saved.world.transportState.browserCasualties === undefined
        && !saved.world.transportState.requests.some(request => request.type === "casualty-picked-up")
        && !Object.values(saved.controller.consumedLosses).some(loss => sourceUnitIsCommander(loss.victimType));
      requireSession(!importLegacy || !legacyBrowserCasualtyOwner, "Legacy population import does not normalize absent casualty ownership; restart this mission");
      requireSession(checkpoint.options.runtimeProfile === "browser-adapted"
        ? saved.world.browserCasualtyPickup?.runtimeProfile === "browser-adapted" || legacyBrowserCasualtyOwner
        : saved.world.browserCasualtyPickup === undefined && saved.world.transportState.browserCasualties === undefined
          && !saved.world.transportState.requests.some(request => request.type === "casualty-picked-up"),
      "Casualty pickup state requires browser-adapted ownership");
      requireSession(checkpoint.options.runtimeProfile === "browser-adapted"
        || saved.world.adaptedTro === undefined && saved.world.teamAlliances === undefined
          && saved.world.coordinateQueues === undefined && saved.world.scenarioMarkers === undefined && saved.world.markerSpyTeams === undefined,
      "Adapted TRO state requires browser-adapted profile");
      let state: CampaignSessionState = { ...saved, world: { ...saved.world,
        entityBytes: Uint8Array.from(saved.world.entityBytes), typeMovementClasses: Uint8Array.from(saved.world.typeMovementClasses),
        placementState: { ...saved.world.placementState, renatBytes: Uint8Array.from(saved.world.placementState.renatBytes) } } };
      if (legacyBrowserCasualtyOwner) state = { ...state,
        world: initializeBrowserCasualtyPickup(state.world, { runtimeProfile: "browser-adapted" }) };
      if (expectedAiSelectorOwner || session.options.browserAi) {
        requireSession(Array.isArray(state.aiSelectorInputs)
          && state.aiSelectorInputs.filter(input => !("visibilityFrame" in input)).length === state.cycleCounter,
        "ai: checkpoint requires complete ordered source caller history");
        let divergence: { difference: CampaignReplayDifference; tick: number } | undefined;
        const compareMigration = () => {
          if (!migrated || divergence) return;
          const difference = firstNonPopulationReplayDifference(session.current, migrated.current);
          if (difference) divergence = { difference, tick: session.current.cycleCounter };
        };
        compareMigration();
        for (const input of state.aiSelectorInputs) {
          const legacyFrame = "visibilityFrame" in input ? unwrap(session.stepVisibilityForNativeView(input))
            : unwrap<CampaignSessionFrame | BrowserViewFrame>(session.options.browserAi ? session.stepForBrowserView(input) : session.step(input));
          if (migrated && !divergence) {
            const result = "visibilityFrame" in input ? migrated.stepVisibilityForNativeView(input) : migrated.stepForBrowserView(input);
            if (!result.ok) divergence = { tick: session.current.cycleCounter,
              difference: { path: ["replay", "diagnostics"], saved: [], replayed: result.diagnostics } };
            else {
              const difference = firstNonPopulationReplayDifference(legacyFrame.entry, result.value.entry, ["journal"]);
              if (difference) divergence = { difference, tick: session.current.cycleCounter };
              else compareMigration();
            }
          }
        }
        if (importLegacy && !sameCheckpointValue(session.current, state)) {
          throw new LegacyCampaignImportError("legacy-authentication-failed",
            campaignReplayDifferences(checkpoint.state, session.checkpoint().state), state.cycleCounter);
        }
        requireSession(sameCheckpointValue(session.current, state), "ai: checkpoint differs from complete source caller replay");
        if (divergence) throw new LegacyCampaignImportError("behavior-diverged", [divergence.difference], divergence.tick);
        if (!migrated) session.includeReplayPolicy = checkpoint.replayPolicy !== undefined;
        return migrated ?? session;
      }
      requireSession(state.aiSelectorInputs === undefined && state.world.aiSelectors === undefined, "Unowned AI selector history/state");
      if (expectedConstruction) {
        requireSession(state.constructionInputs?.length === state.cycleCounter, "CITY checkpoint requires complete caller history");
        for (const input of state.constructionInputs) unwrap(session.step(input));
        requireSession(sameCheckpointValue(session.current, state), "CITY checkpoint differs from complete caller replay");
        return session;
      }
      requireSession(state.constructionInputs === undefined, "Unowned CITY caller history");
      if (expectedNativeCombat?.visibility) {
        requireSession(Array.isArray(state.nativeSourceInputs), "Native visibility requires complete ordered caller history");
        for (const input of state.nativeSourceInputs) {
          if ("visibilityFrame" in input) unwrap(session.stepVisibilityForNativeView(input));
          else unwrap(session.stepForNativeView(input));
        }
        requireSession(sameCheckpointValue(session.current, state), "Native visibility checkpoint differs from complete caller replay");
        return session;
      }
      requireSession(state.nativeSourceInputs === undefined, "Unowned native visibility caller history");
      if (session.options.nativeAiTasks) {
        requireSession(state.nativeAiInputs?.length === state.cycleCounter, "Native AI checkpoint requires complete caller history");
        for (const input of state.nativeAiInputs) unwrap(session.step(input));
        requireSession(sameCheckpointValue(session.current, state), "Native AI checkpoint differs from complete caller replay");
        return session;
      }
      const campaignAi = validateRestoredSession(state, session.current, session.options);
      if (campaignAi) state = { ...state, campaignAi };
      if (session.options.campaignAi?.fullPolicy) {
        requireSession(state.campaignAiInputs?.length === state.cycleCounter, "Full-policy checkpoint requires complete caller history");
        for (const input of state.campaignAiInputs) unwrap(session.step(input));
        requireSession(sameCheckpointValue(session.current, state), "Full-policy checkpoint differs from complete caller replay");
      } else requireSession(state.campaignAiInputs === undefined, "Unowned full-policy caller history");
      requireSession(session.options.nativeAiTasks || state.nativeAiInputs === undefined, "Unowned native AI caller history");
      session.current = { ...state, world: { ...state.world, transportState: transportHostState(state.world) },
        ...(state.production ? { production: productionSnapshot(state.production) } : {}) };
      return session;
    }
    requireSession(!importLegacy, "Legacy import requires an unversioned browser-adapted source caller snapshot");
    requireSession(value.schemaVersion === 1, "Unsupported campaign checkpoint version");
    const checkpoint = structuredClone(value) as CampaignSessionReplayCheckpoint;
    requireSession(checkpoint.kind === "campaign-session-replay", "Unsupported campaign checkpoint version");
    requireSession(!checkpoint.options.campaignAi && !expectedCampaignAi, "Campaign-ai requires a direct snapshot checkpoint");
    requireSession(!checkpoint.options.nativeAiTasks && !expectedNativeAiTasks, "Native AI requires a direct snapshot checkpoint");
    requireSession(!checkpoint.options.aiSelector && !expectedAiSelectorOwner, "AI selector requires a direct snapshot checkpoint");
    requireSession(!checkpoint.options.browserAi && checkpoint.options.runtimeProfile !== "browser-adapted",
      "Browser AI selector requires a direct snapshot checkpoint");
    checkpointObject({ schemaVersion: checkpointChoice(1), kind: checkpointChoice("campaign-session-replay"),
      options: checkpointOptions, inputs: checkpointArray(() => {}) },
    { sourceDayNight: checkpointClock, production: () => {} })(checkpoint);
    requireSession(checkpoint.options !== null && typeof checkpoint.options === "object" &&
      Array.isArray(checkpoint.inputs) && checkpoint.inputs.length <= 100000, "Invalid campaign replay inputs");
    requireSession(!checkpoint.options.resourceLifecycle || checkpoint.sourceDayNight,
      "Resource checkpoint requires saved source clock; cycleCounter-only migration is unsupported");
    requireSession(!checkpoint.options.production || checkpoint.production,
      "Production checkpoint requires saved native production state");
    for (const field of [checkpoint.options.pathGrid, checkpoint.options.tags]) {
      requireSession(Array.isArray(field) && field.length <= 65536 + 255 * 255 &&
        field.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255), "Invalid campaign checkpoint byte plane");
    }
    const session = new CampaignSession({ ...checkpoint.options,
      pathGrid: Uint8Array.from(checkpoint.options.pathGrid), tags: Uint8Array.from(checkpoint.options.tags) });
    for (const input of checkpoint.inputs) {
      requireSession(input !== null && typeof input === "object" &&
        Object.keys(input).every((key) => ["clockMilliseconds", "updates", "reservations", "resourceFrameSource", "resourceHandoffs", "productionCommands", "productionVisits"].includes(key)), "Invalid campaign replay entry");
      if (input.updates !== undefined) requireSession(Array.isArray(input.updates), "Invalid replay updates");
      if (input.reservations !== undefined) requireSession(Array.isArray(input.reservations), "Invalid replay reservations");
      unwrap(session.step(input));
    }
    const clock = session.current.sourceDayNight;
    requireSession(clock ? checkpoint.sourceDayNight &&
      (Object.keys(clock) as (keyof SourceDayNight)[]).every((key) => clock[key] === checkpoint.sourceDayNight![key])
      : checkpoint.sourceDayNight === undefined, "Campaign checkpoint source clock does not match replay history");
    requireSession(sameCheckpointValue(session.current.production, checkpoint.production ? compactProduction(checkpoint.production) : undefined),
      "Campaign checkpoint production state does not match replay history");
    return session;
  }

  commandResource(command: NativeHarvestCommand): TriggerResult<CampaignWorld> {
    if (this.current.aiSelectorInputs) return failure(new Error("AI selector owner requires complete journaled source inputs"));
    if (this.options.nativeAiTasks) return failure(new Error("Native AI owner requires journaled resource inputs"));
    if (this.options.campaignAi?.fullPolicy || this.current.constructionInputs) return failure(new Error("Native owners require journaled resource inputs through session.step"));
    const result = commandNativeHarvest(this.current.world, command);
    if (result.ok) this.current = { ...this.current, world: result.value };
    return result;
  }

  resumeResourceIdle(slot: number, generation: number): TriggerResult<CampaignWorld> {
    try {
      requireSession(!this.current.aiSelectorInputs, "AI selector owner requires complete journaled source inputs");
      requireSession(!this.options.nativeAiTasks, "Native AI owner requires journaled resource inputs");
      requireSession(!this.options.campaignAi?.fullPolicy && !this.current.constructionInputs, "Native owners require journaled resource inputs through session.step");
      const host = hostOf(this.current.world), record = host.slots[slot];
      requireSession(host.resourceLifecycle?.nativeHarvest?.bindings.some(binding => binding.slot === slot && binding.generation === generation)
        && record?.generation === generation && record.resourceTask?.released && record.status === 1,
      "Native idle resume requires exact released bounded owner");
      const result = bindCampaignResourceTask(this.current.world, { slot, generation,
        state: { ...record.resourceTask, released: false } });
      if (result.ok) this.current = { ...this.current, world: result.value };
      return result;
    } catch (error) { return failure(error); }
  }

  step(input: CampaignSessionInput): TriggerResult<CampaignSessionFrame> {
    return this.#step(input, (state, entry, bailExpired) => {
      const snapshot = structuredClone(state);
      return { ...snapshot, ...(snapshot.production ? { production: productionSnapshot(snapshot.production) } : {}),
        entry: structuredClone(entry), bailExpired };
    });
  }

  stepForNativeView(input: CampaignSessionInput): TriggerResult<NativeViewFrame> {
    return this.#step(input, (state, entry, bailExpired) => ({ ...this.#projectNativeView(state),
      entry: structuredClone({ requests: entry.requests, commands: entry.commands }), bailExpired }));
  }

  stepForBrowserView(input: CampaignSessionInput): TriggerResult<BrowserViewFrame> {
    if (this.runtimeProfile !== "browser-adapted") return failure(new Error("Browser view requires adapted runtime"));
    return this.#step(input, (state, entry, bailExpired) => {
      const projection = this.#projectBrowserView(state);
      return { ...projection, entry: structuredClone(entry), bailExpired };
    });
  }

  stepVisibility(input: CampaignVisibilityInput): TriggerResult<CampaignSessionFrame> {
    return this.#stepVisibility(input, (state, entry, bailExpired) => ({ ...structuredClone(state),
      entry: structuredClone(entry), bailExpired }));
  }

  stepVisibilityForNativeView(input: CampaignVisibilityInput): TriggerResult<NativeViewFrame & { visibilityEvent: SourceNativeVisibilityEvent }> {
    return this.#stepVisibility(input, (state, entry, bailExpired) => ({ ...this.#projectNativeView(state),
      entry: { requests: [], commands: [] }, visibilityEvent: structuredClone(entry.visibility!), bailExpired }));
  }

  #stepVisibility<Value>(input: CampaignVisibilityInput,
    project: (state: CampaignSessionState, entry: CampaignSessionJournalEntry, bailExpired: boolean) => Value): TriggerResult<Value> {
    try {
      input = cloneSessionInput(input);
      requireSession(this.options.nativeCombat?.visibility && this.current.nativeSourceInputs
        && Object.keys(input).join() === "visibilityFrame", "Exclusive native visibility phase required");
      const staged = cloneSessionState(this.current);
      const result = unwrap(stepTransportHostVisibility(staged.world, input.visibilityFrame));
      const next = { ...staged, world: result.world, nativeSourceInputs: [...staged.nativeSourceInputs!, input],
        ...(staged.aiSelectorInputs ? { aiSelectorInputs: [...staged.aiSelectorInputs, input] } : {}) };
      const entry: CampaignSessionJournalEntry = { cycleCounter: next.cycleCounter,
        clockMilliseconds: next.world.clockMilliseconds, commands: [], receipts: [], trace: [], fired: [], requests: [], messages: [],
        bail: next.controller.runtime.bail, visibility: result.event };
      const value = project(next, entry, unwrap(missionBailDeadlineExceeded(entry.bail, entry.clockMilliseconds)));
      this.current = next;
      this.recordJournal(entry);
      return { ok: true, value };
    } catch (error) { return failure(error); }
  }

  #step<Value>(input: CampaignSessionInput,
    project: (state: CampaignSessionState, entry: CampaignSessionJournalEntry, bailExpired: boolean) => Value): TriggerResult<Value> {
    try {
      if (input.economyIncome !== undefined) {
        validateSessionJson(input.economyIncome);
        checkpointArray(checkpointObject({ scope: checkpointChoice("browser-adapted-economy-v1"),
          profileId: checkpointString, sessionId: checkpointString, team: checkpointTeam, earnedTotal: checkpointInteger() }))(input.economyIncome);
      }
      input = cloneSessionInput(input);
      requireSession(input.economyIncome === undefined || this.options.browserEconomy,
        "Browser economy income requires explicit source profile ownership");
      if (input.browserConstructionRequest !== undefined) {
        requireSession(this.options.browserConstruction && this.current.browserConstruction, "Browser construction requires opt-in ownership");
        checkpointObject({ type: checkpointChoice("purchase", "upgrade"), sequence: checkpointInteger(1), id: checkpointString,
          dependency: checkpointInteger(0, 109), home: checkpointPosition })(input.browserConstructionRequest);
      }
      if (input.browserConstructionHealth !== undefined) {
        checkpointInteger(1, 4800)(input.browserConstructionHealth);
        const central = this.current.browserConstruction?.slots ? this.current.browserConstruction.slots[0] : this.current.browserConstruction;
        requireSession(central && central.phase !== "empty"
          && input.browserConstructionHealth <= this.current.world.buildingSlots["0,0"], "Construction health cannot heal or create a building");
      }
      if (input.browserConstructionDamage !== undefined) {
        requireSession(this.options.browserConstruction?.configurationVersion === 2 && this.current.browserConstruction?.slots,
          "Fixed-slot damage requires v2 construction ownership");
        checkpointArray(checkpointObject({ slot: checkpointInteger(0, 4), generation: checkpointChoice(0),
          health: checkpointInteger(1) }))(input.browserConstructionDamage);
        requireSession(new Set(input.browserConstructionDamage.map(damage => damage.slot)).size === input.browserConstructionDamage.length
          && !(input.browserConstructionHealth !== undefined && input.browserConstructionDamage.some(damage => damage.slot === 0)), "Duplicate construction damage");
        for (const damage of input.browserConstructionDamage) {
          const receipt = this.current.browserConstruction.slots[damage.slot];
          const upgradeSource = this.options.browserConstruction.supportedActions?.includes("upgrade")
            && this.options.browserConstruction.supportedSlots?.includes(damage.slot)
            && this.options.browserConstruction.buildings?.some(option => option.level === 1 && option.building.slot === damage.slot);
          requireSession((receipt && receipt.phase !== "empty" || upgradeSource) && hostOf(this.current.world).generations[damage.slot] === damage.generation
            && damage.health <= this.current.world.buildingSlots[`0,${damage.slot}`], "Construction health cannot heal or create a building");
        }
      }
      if (input.type37Frame !== undefined) {
        requireSession(this.options.runtimeProfile === "browser-adapted" && this.current.world.scenarioMarkers,
          "Type37 observation requires adapted source marker ownership");
        checkpointObject({ spyTeams: checkpointArray(checkpointChoice(true, false), 8),
          idleHarvesterSlots: checkpointArray(checkpointSlot) })(input.type37Frame);
      }
      requireSession(Object.keys(input).every((key) => ["clockMilliseconds", "updates", "reservations", "resourceFrameSource", "resourceHandoffs",
        "productionCommands", "productionVisits", "campaignAiRequest", "nativeAiFrame", "nativeAiReceipt", "constructionVisits", "economyIncome", "type37Frame", "browserConstructionRequest", "browserConstructionHealth", "browserConstructionDamage"].includes(key)), "Invalid campaign input field");
      for (const construction of this.current.production?.constructionHosts ?? []) validateTransportConstruction(this.current.world, construction);
      if (this.current.constructionInputs) {
        const active = this.current.production!.constructionHosts!.filter(host => host.receiptId && !host.ready)
          .sort((left, right) => left.configuration.team - right.configuration.team);
        requireSession(Array.isArray(input.constructionVisits) && input.constructionVisits.length === active.length,
          "CITY requires one actual registered native visit per active fixed owner");
        for (const [index, entry] of input.constructionVisits.entries()) {
          checkpointObject({ team: checkpointTeam, visit: checkpointConstructionVisit })(entry);
          requireSession(entry.team === active[index].configuration.team, "CITY visits must follow ascending fixed registry order");
        }
      } else requireSession(input.constructionVisits === undefined, "CITY visits require explicit source construction ownership");
      if (this.options.nativeAiTasks) checkpointObject({ counter: checkpointUint, task6Budget: checkpointInteger(0, 9),
        ...(this.options.nativeCombat?.sound ? { sound: checkpointObject({ initialized: checkpointChoice(true), disabled: checkpointChoice(true, false),
          listener: checkpointObject({ x: checkpointSigned, y: checkpointSigned }) }) } : {}) },
        this.options.nativeCombat?.death ? { registeredSlots: checkpointArray(checkpointSlot) } : {})(input.nativeAiFrame);
      else requireSession(input.nativeAiFrame === undefined && input.nativeAiReceipt === undefined, "Native AI input requires source configuration");
      if (input.campaignAiRequest !== undefined) {
        requireSession(this.options.campaignAi && this.current.campaignAi, "Campaign-ai input requires explicit bounded source configuration");
        checkpointAiRequest(input.campaignAiRequest);
      }
      requireSession(Number.isInteger(input.clockMilliseconds) && input.clockMilliseconds >= 0 && input.clockMilliseconds <= 0xffffffff,
        "Injected wall clock must be uint32 milliseconds");
      if (input.campaignAiRequest && hostOf(this.current.world).slots.some(actor => actor?.pendingNativeAi)) {
        const prior = this.current.campaignAi!.history.find(record => record.request.id === input.campaignAiRequest!.id);
        requireSession(prior && sameCheckpointValue(prior.request, input.campaignAiRequest)
          && Object.keys(input).every(key => ["clockMilliseconds", "campaignAiRequest", "productionVisits"].includes(key))
          && sameCheckpointValue(input.productionVisits, this.current.campaignAiInputs!.at(-1)!.productionVisits),
        "Pending native AI hand-off only permits an exact receipt retry");
        stepCampaignAi(this.current.campaignAi!, this.options.campaignAi!, this.current.production!, this.current.world, input.campaignAiRequest);
        const entry: CampaignSessionJournalEntry = { cycleCounter: this.current.cycleCounter,
          clockMilliseconds: this.current.world.clockMilliseconds, commands: [], receipts: [], trace: [], fired: [], requests: [], messages: [],
          bail: this.current.controller.runtime.bail, campaignAiReceipt: structuredClone(prior.receipt) };
        return { ok: true, value: project(this.current, entry, unwrap(missionBailDeadlineExceeded(entry.bail, entry.clockMilliseconds))) };
      }
      const browserRequests = this.runtimeProfile === "browser-adapted" ? hostOf(this.current.world).requests : undefined;
      const browserProductionRequests = browserRequests ? this.current.production?.requests : undefined;
      const current = browserRequests ? { ...this.current, world: { ...this.current.world,
        transportState: { ...hostOf(this.current.world), requests: [] } },
        ...(browserProductionRequests ? { production: { ...this.current.production!, requests: [] } } : {}) } : this.current;
      let staged = cloneSessionState(current, this.runtimeProfile === "browser-adapted");
      const requestStart = hostOf(staged.world).requests.length;
      const messageStart = staged.world.messages.length;
      const productionRequestStart = staged.production?.requests.length ?? 0;
      staged = { ...staged, cycleCounter: (staged.cycleCounter + 1) | 0,
        world: { ...staged.world, clockMilliseconds: input.clockMilliseconds } };
      staged = applyResourceHandoffs(staged, input.resourceHandoffs);
      staged = applyUnitBatch(staged, input.updates ?? []);
      for (const damage of [...(input.browserConstructionDamage ?? []), ...(input.browserConstructionHealth === undefined
        ? [] : [{ slot: 0, health: input.browserConstructionHealth }])]) {
        requireSession(hostOf(staged.world).slots[damage.slot]?.status === 1, "Construction damage requires a live actor");
        staged = { ...staged, world: { ...staged.world,
          buildingSlots: { ...staged.world.buildingSlots, [`0,${damage.slot}`]: damage.health },
          entities: staged.world.entities.map(entity => entity.rawSlot === damage.slot ? { ...entity, health: damage.health } : entity) } };
      }
      synchronizeRawAndHost(staged, this.options);
      const reservationTrips = (input.reservations ?? []).map(reservation => {
        const entity = staged.world.entities.find(({ rawSlot, generation }) => rawSlot === reservation.slot && generation === reservation.generation);
        requireSession(entity && staged.world.entityBytes![reservation.slot * 220 + 0x2c] !== 0 &&
          staged.world.entityBytes![reservation.slot * 220 + 0x2c] !== 10 && !staged.staticSlots.includes(reservation.slot),
        `Invalid reservation unit: slot ${reservation.slot}, generation ${reservation.generation}, status ${staged.world.entityBytes![reservation.slot * 220 + 0x2c]}, entity ${entity?.key ?? "missing"}`);
        const trip = unwrap(tripForReservedMtgDestination(this.options.tags, this.options.map.width, this.options.map.height,
          reservation.tileX, reservation.tileY, entity.team));
        return trip ? { ...trip, unitType: entity.unitType } : undefined;
      });
      if (input.nativeAiReceipt) {
        const receipt = input.nativeAiReceipt;
        checkpointObject({ id: checkpointString, packets: checkpointArray(checkpointArray(checkpointByte)),
          expected: checkpointArray(checkpointObject({ slot: checkpointSlot, generation: checkpointInteger(), key: checkpointString,
            raw: checkpointArray(checkpointByte, 220) })) })(receipt);
        requireSession(receipt.id.length > 0 && receipt.packets.length > 0
          && !staged.nativeAiInputs!.some(previous => previous.nativeAiReceipt?.id === receipt.id), "Duplicate or empty native AI receipt");
        const host = hostOf(staged.world);
        requireSession(receipt.expected.length === hostOf(staged.world).nativeAiTasks!.configuration.bindings.length
          && new Set(receipt.expected.map(owner => owner.slot)).size === receipt.expected.length, "Native receipt requires every current owner identity");
        for (const expected of receipt.expected) {
          const actor = host.slots[expected.slot];
          requireSession(actor?.nativeAiTask && actor.key === expected.key && actor.generation === expected.generation
            && sameCheckpointValue(actor.nativeAiTask.raw, expected.raw), "Stale native AI receipt owner");
        }
        staged = { ...staged, world: receiveTransportHostAiPolicy(staged.world, staged.world.entityBytes!,
          receipt.packets.map(packet => Uint8Array.from(packet)), receipt.id, "deferred") };
      }
      if (input.economyIncome !== undefined) {
        const consumed = consumeBrowserEconomyIncome(staged.world, staged.browserEconomyLedger!, input.economyIncome);
        const totalEarned = Object.values(consumed.ledger.earned).reduce((total, earned) => total + earned, 0);
        const totalReserve = this.options.browserEconomy!.nodes.reduce((total, node) => total + node.amount, 0);
        requireSession(Number.isSafeInteger(totalEarned) && totalEarned <= totalReserve,
          "Browser economy cumulative income exceeds original finite reserve");
        staged = { ...staged, world: consumed.world, browserEconomyLedger: consumed.ledger,
          controller: { ...staged.controller, runtime: { ...staged.controller.runtime, statistics: consumed.world.statistics } } };
      }
      if (staged.production) {
        requireSession(Array.isArray(input.productionVisits),
          "Production update requires one actual native census/cap visit per owned team");
        const adapted = !!(staged.production.adaptedCollectorProfiles?.length || staged.production.adaptedUnitProfiles?.length);
        const expectedVisits = adapted
          ? sourceProductionVisits(staged.world, staged.production, input.productionVisits[0]?.populationLimit ?? 150).filter(visit =>
            !(staged.browserConstruction?.phase === "building" && !staged.browserConstruction.slots && visit.team === 0 && visit.queue === 2))
          : [...staged.production.teams].sort((left, right) => left.team - right.team).map(team => ({ team: team.team, queue: 0 }));
        requireSession(input.productionVisits.length === expectedVisits.length,
          "Production update requires one actual native census/cap visit per owned producer");
        for (const [index, visit] of input.productionVisits.entries()) {
          requireSession(visit.team === expectedVisits[index].team && visit.queue === expectedVisits[index].queue &&
            Object.keys(visit).every((key) => ["team", "queue", "population", "populationLimit"].includes(key)),
          "Production visits must be ordered native base producers, without completion flags");
          if (adapted) requireSession(sameCheckpointValue(visit, expectedVisits[index]),
            "Adapted production visits require actual source census/cap");
        }
        staged = synchronizeProductionCredits(staged, "before-commands", this.runtimeProfile);
        requireSession(input.productionCommands === undefined || Array.isArray(input.productionCommands), "Invalid production commands");
        for (const command of input.productionCommands ?? []) {
          requireSession(command && Object.keys(command).every((key) => ["id", "team", "action"].includes(key)) &&
            typeof command.id === "string" && command.id.length > 0 && command.action &&
            ["reserve", "release-pending", "dispatch"].includes(command.action.type) &&
            Object.keys(command.action).every((key) => ["type", "dependency"].includes(key)), "Session rejects native production callbacks");
          staged = { ...staged, production: reduceCampaignProduction(staged.production!, { ...command, id: `input:${command.id}` }) };
        }
        staged = publishProductionCredits(staged);
      } else requireSession(input.productionCommands === undefined && input.productionVisits === undefined,
        "Production inputs require opt-in source production configuration");
      const fixedProducerTeams = new Set(staged.production?.constructionHosts?.map(host => host.configuration.team));
      for (const visit of input.productionVisits ?? []) if (fixedProducerTeams.has(visit.team)) {
        staged = { ...staged, ...stepCampaignProductionProducer(staged.production!, staged.world, visit,
          `session:${staged.cycleCounter}:${visit.team}:producer`, this.runtimeProfile) };
        const entry = input.constructionVisits?.find(entry => entry.team === visit.team);
        if (entry) {
          const previous = staged.production!.constructionHosts!.find(host => host.configuration.team === entry.team)!;
          const production = reduceCampaignProduction(staged.production!, { id: `session:${staged.cycleCounter}:${entry.team}:city`,
            team: entry.team, action: { type: "native-construction-visit", visit: entry.visit } });
          const next = production.constructionHosts!.find(host => host.configuration.team === entry.team)!;
          staged = { ...staged, production, world: projectTransportConstruction(staged.world, previous, next) };
        }
      }
      if (hostOf(staged.world).resourceLifecycle) {
        requireSession(staged.sourceDayNight && input.resourceFrameSource,
          "Resource update requires saved source clock and complete native frame source");
        requireSession(!hostOf(staged.world).slots.some((record) => record?.resourceTask?.released && !record.resourceTask.nativeBanks && record.status !== 0),
          "Resource task released: general mobile idle continuation requires native task ownership transfer");
        staged = refreshFeedback(staged, this.options);
        const built = unwrap(campaignResourceFrame({ ...input.resourceFrameSource,
          sourceDayNight: staged.sourceDayNight, buildingSlots: staged.world.buildingSlots }));
        const world = unwrap(stepOwnedTransportHost(staged.world, built.resourceFrame, input.nativeAiFrame));
        staged = { ...staged, world, sourceDayNight: built.sourceDayNight,
          controller: { ...staged.controller, runtime: { ...staged.controller.runtime, statistics: world.statistics } } };
      } else {
        requireSession(input.resourceFrameSource === undefined, "Resource frame requires opt-in lifecycle configuration");
        // staged.world comes from this step's private cloneSessionState copy and is discarded if the step throws.
        staged = { ...staged, world: unwrap(stepOwnedTransportHost(staged.world, undefined, input.nativeAiFrame)) };
      }
      synchronizeRawAndHost(staged, this.options);
      staged = refreshFeedback(staged, this.options);
      if (staged.production) {
        staged = synchronizeProductionCredits(staged, "after-resources", this.runtimeProfile);
        if (input.campaignAiRequest) staged = { ...staged, ...stepCampaignAi(staged.campaignAi!, this.options.campaignAi!,
          staged.production!, staged.world, input.campaignAiRequest) };
        const citySlots = staged.production!.constructionHosts?.flatMap(host => host.actors[3] ? [host.actors[3].nativeId] : []) ?? [];
        staged = { ...staged, staticSlots: [...new Set([...staged.staticSlots, ...citySlots])] };
        for (const visit of input.productionVisits!) {
          if (fixedProducerTeams.has(visit.team)) continue;
          const result = stepCampaignProductionProducer(staged.production!, staged.world, visit,
            `session:${staged.cycleCounter}:${visit.team}:producer${visit.queue === 0 ? "" : `:${visit.queue}`}`, this.runtimeProfile);
          staged = { ...staged, ...result };
        }
        staged = publishProductionCredits(staged);
        synchronizeRawAndHost(staged, this.options);
        staged = refreshFeedback(staged, this.options);
      }
      // Contact objects run after the view-supplied production census so their joins/removals count from the next cycle.
      if (this.runtimeProfile === "browser-adapted" && !hostOf(staged.world).nativeCombat && !hostOf(staged.world).nativeAiTasks) {
        const collected = collectBrowserContactPickups(staged);
        if (collected !== staged) {
          staged = collected;
          synchronizeRawAndHost(staged, this.options);
          staged = refreshFeedback(staged, this.options);
        }
      }
      if (staged.world.scenarioMarkers) {
        for (const [team, enabled] of (input.type37Frame?.spyTeams ?? []).entries()) {
          if (!enabled) continue;
          const slot = team * 15 + 4;
          const health = staged.world.buildingSlots[`${team},4`];
          const entity = staged.world.entities.find(entry => entry.rawSlot === slot);
          const host = hostOf(staged.world);
          const actor = host.slots[slot];
          const unitType = staged.world.source.teams[team].race === 0 ? 22 : 34;
          requireSession(health > 0 && health <= 3600 && entity && actor && entity.health === health
            && actor.health === health && entity.team === team && actor.team === team
            && entity.unitType === unitType && actor.unitType === unitType && actor.key === entity.key
            && actor.generation === entity.generation && host.generations[slot] === entity.generation
            && actor.status !== 0 && actor.status !== 10 && host.registry[slot] === entity.key,
          "Type37 research observation requires matching source slot4 health");
        }
        staged = { ...staged, world: stepBrowserType37(staged.world, input.type37Frame) };
        const retiredSlots = new Set(staged.world.scenarioMarkers!.filter(marker => !marker.active).map(marker => marker.rawSlot));
        staged = { ...staged, staticSlots: staged.staticSlots.filter(slot => !retiredSlots.has(slot)) };
        synchronizeRawAndHost(staged, this.options);
        staged = refreshFeedback(staged, this.options);
      }
      const effects = { commands: [] as PlannedMissionCommand[], receipts: [] as MissionCommandReceipt[],
        trace: [] as MissionActionTrace[], fired: [] as number[],
        ...(this.runtimeProfile === "browser-adapted" ? { messages: [] as CampaignMessage[] } : {}) };
      for (const trip of reservationTrips) {
        if (trip) {
          if (this.runtimeProfile === "browser-adapted" && !hasEnabledMissionTrip(staged.controller, trip.triggerId)) continue;
          requireSession(staged.controller.blocks.some(({ id, mode }) => id === trip.triggerId && mode === "trip"), `Unknown trip trigger ${trip.triggerId}`);
          staged = scanEvent(staged, this.options, trip, effects);
        }
      }
      if ((staged.cycleCounter & 7) === 0) staged = scanEvent(staged, this.options, { kind: "normal" }, effects);
      let browserConstructionEffects: BrowserConstructionTransition["effects"] | undefined;
      if (staged.browserConstruction) {
        const request = input.browserConstructionRequest ?? (staged.browserConstruction.phase === "building"
          ? { type: "visit" as const, sequence: staged.browserConstruction.sequence + 1 } : undefined);
        if (request) {
          const construction = reduceBrowserConstruction(this.options.browserConstruction!, staged.browserConstruction, staged.world, request, true);
          if (this.options.browserConstruction!.supportedActions) browserConstructionEffects = construction.effects;
          let production = staged.production;
          if (request.type === "purchase" && !production && this.options.production) {
            production = createCampaignProduction({ ...this.options.production, sessionId: this.options.sessionId,
              teams: this.options.production.teams.map(team => ({ ...team, credits: construction.world.exomoney[team.team] })) });
          }
          const constructedSlots = browserConstructionSlots(this.options.browserConstruction!, construction.state, construction.world);
          if (production) production = { ...production, teams: production.teams.map(team => team.team !== 0 ? team : {
            ...team, costAccumulator: team.costAccumulator + construction.state.paid - staged.browserConstruction!.paid,
            slots: team.slots.map((slot, index) => ({ ...slot, ...constructedSlots[index] })) }) };
          staged = { ...staged, world: construction.world, browserConstruction: construction.state,
            staticSlots: [...new Set([...staged.staticSlots, ...construction.effects.filter(effect => effect.type === "construction-started").map(effect => effect.slot)])],
            ...(production ? { production } : {}) };
        }
      }
      if (staged.production) staged = synchronizeProductionCredits(staged, "after-triggers", this.runtimeProfile);
      if (staged.campaignAi) staged = { ...staged,
        campaignAi: synchronizeCampaignAi(staged.campaignAi, this.options.campaignAi!, staged.production!, staged.world) };
      const entry: CampaignSessionJournalEntry = { cycleCounter: staged.cycleCounter, clockMilliseconds: input.clockMilliseconds,
        ...effects, requests: hostOf(staged.world).requests.slice(requestStart), messages: effects.messages ?? staged.world.messages.slice(messageStart),
        bail: staged.controller.runtime.bail,
        ...(browserConstructionEffects?.length ? { browserConstructionEffects } : {}),
        ...(staged.production ? { productionRequests: staged.production.requests.slice(productionRequestStart) } : {}),
        ...(input.campaignAiRequest ? { campaignAiReceipt: staged.campaignAi!.history.find(record => record.request.id === input.campaignAiRequest!.id)!.receipt } : {}) };
      const bailExpired = unwrap(missionBailDeadlineExceeded(entry.bail, input.clockMilliseconds));
      if (staged.production) staged = { ...staged, production: compactProduction(staged.production, !!staged.campaignAi) };
      if (staged.campaignAiInputs) staged = { ...staged, campaignAiInputs: [...staged.campaignAiInputs, input] };
      if (staged.aiSelectorInputs) {
        const retained = this.runtimeProfile === "browser-adapted" ? cloneSessionInput(input) : input;
        if (this.runtimeProfile === "browser-adapted") {
          freezeSessionHistory(retained);
        }
        const history = [...staged.aiSelectorInputs, retained];
        staged = { ...staged, aiSelectorInputs: this.runtimeProfile === "browser-adapted" ? Object.freeze(history) : history };
      }
      if (staged.nativeAiInputs) staged = { ...staged, nativeAiInputs: [...staged.nativeAiInputs, input] };
      if (staged.nativeSourceInputs) staged = { ...staged, nativeSourceInputs: [...staged.nativeSourceInputs, input] };
      if (staged.constructionInputs) staged = { ...staged, constructionInputs: [...staged.constructionInputs, input] };
      for (const construction of staged.production?.constructionHosts ?? []) validateTransportConstruction(staged.world, construction);
      if (staged.browserConstruction) validateBrowserConstruction(this.options.browserConstruction!, staged.browserConstruction, staged.world, true);
      const nativeOwner = hostOf(staged.world).nativeAiTasks;
      if (nativeOwner?.configuration.sourceId.startsWith("nativeactor-source-v2:"))
        nativeOwner.configuration = retainSourceNativeTaskConfiguration(nativeOwner.configuration);
      validateNativeAiTaskAlignment(staged.world,
        this.runtimeProfile === "browser-adapted" ? hostOf(staged.world) : undefined);
      if (browserRequests) {
        const host = hostOf(staged.world);
        freezeSessionHistory(host.requests);
        staged = { ...staged, world: { ...staged.world,
          transportState: { ...host, requests: Object.freeze([...browserRequests, ...host.requests]) } } };
      }
      if (browserProductionRequests && staged.production) {
        freezeSessionHistory(staged.production.requests);
        staged = { ...staged, production: { ...staged.production,
          requests: Object.freeze([...browserProductionRequests, ...staged.production.requests]) } };
      }
      const value = project(staged, entry, bailExpired);
      this.current = staged;
      this.recordJournal(entry);
      return { ok: true, value };
    } catch (error) { return failure(error); }
  }
}

function applyResourceHandoffs(state: CampaignSessionState,
  handoffs: readonly CampaignResourceHandoff[] | undefined): CampaignSessionState {
  if (handoffs === undefined) return state;
  requireSession(Array.isArray(handoffs) && hostOf(state.world).resourceLifecycle, "Resource handoffs require lifecycle configuration");
  const slots = new Set<number>();
  let world = state.world;
  for (const handoff of handoffs) {
    requireSession(handoff && Object.keys(handoff).length === 5 &&
      Object.keys(handoff).every((key) => ["action", "evidence", "expected", "rawEntity", "state"].includes(key)) &&
      ["bind", "release"].includes(handoff.action) && typeof handoff.evidence === "string" && handoff.evidence.trim().length > 0,
    "Invalid resource handoff evidence/input");
    const host = transportHostState(world), expected = handoff.expected;
    requireSession(expected && Number.isInteger(expected.slot) && expected.slot >= 152 && expected.slot < 800 &&
      !slots.has(expected.slot), "Duplicate or invalid resource handoff slot");
    slots.add(expected.slot);
    const record = host.slots[expected.slot];
    requireSession(record && sameCheckpointValue(record, expected) && [6, 14].includes(record.unitType) &&
      record.status === 1 && record.health > 0 && world.entities.some((entity) => entity.rawSlot === record.slot &&
        entity.generation === record.generation && entity.key === record.key), "Stale resource handoff identity/state");
    requireSession(Array.isArray(handoff.rawEntity) && handoff.rawEntity.length === 220 &&
      handoff.rawEntity.every((value: number) => Number.isInteger(value) && value >= 0 && value <= 255) &&
      sameCheckpointValue(handoff.rawEntity, Array.from(world.entityBytes!.slice(record.slot * 220, (record.slot + 1) * 220))),
    "Stale resource handoff raw native state");
    checkpointResourceTask(handoff.state);
    if (handoff.action === "bind") {
      requireSession(handoff.state.pendingOrder === 0 && [0, 255].includes(handoff.state.order),
        "Resource bind requires consumed native orders");
      world = unwrap(bindCampaignResourceTask(world, { slot: record.slot, generation: record.generation, state: handoff.state }));
    } else {
      const task = record.resourceTask;
      requireSession(task?.released && sameCheckpointValue(task, handoff.state) && record.task === "idle" &&
        task.pendingOrder === 0 && task.order === 255 && task.stack.length === 1 && task.stack[0].opcode === 1 &&
        sameCheckpointValue(task.stack[0].words, [65535, record.health & 65535, record.health >>> 16]) &&
        task.animation.profile === host.resourceLifecycle!.types.find((profile) => profile.unitType === record.unitType)?.stand &&
        task.animation.frame === 0 && task.animation.delay === 0 && task.animation.mode === 0,
      "Resource release requires exact native idle exit acknowledgement");
      delete record.resourceTask;
      record.task = "unit";
      record.taskWords = [];
      world = { ...world, transportState: host };
    }
  }
  return { ...state, world };
}

function synchronizeProductionCredits(state: CampaignSessionState, boundary: string,
  runtimeProfile: CampaignRuntimeProfile): CampaignSessionState {
  let production = state.production!;
  let colonyChanged = false;
  if (state.world.adaptedTro) production = { ...production, teams: production.teams.map(team => {
    const restrictions = new Set(team.restrictions);
    for (const { command } of state.world.adaptedTro!.events) {
      if (command.kind !== "dfiddle" || command.team !== team.team) continue;
      if (command.restricted) restrictions.add(command.dependency);
      else restrictions.delete(command.dependency);
    }
    const changed = restrictions.size !== team.restrictions.length || team.restrictions.some(value => !restrictions.has(value));
    colonyChanged ||= changed;
    return changed ? { ...team, restrictions: [...restrictions] } : team;
  }) };
  for (const team of production.teams) {
    for (let slot = 0; slot < 5; slot += 1) {
      const changed = team.slots[slot].health !==
        (state.world.entities.find((entity) => entity.rawSlot === team.team * 15 + slot)?.health ?? 0);
      requireSession(!changed || runtimeProfile === "browser-adapted",
        "Production colony mutation requires native destruction/construction ownership");
      colonyChanged ||= changed;
    }
    production = reduceCampaignProduction(production, { id: `session:${state.cycleCounter}:${team.team}:${boundary}`, team: team.team,
      action: { type: "sync-credits", expectedPreviousCredits: team.credits, credits: state.world.exomoney[team.team] } });
  }
  if (runtimeProfile === "browser-adapted" && colonyChanged) {
    const synchronized = synchronizeBrowserProductionColony(production, state.world, runtimeProfile);
    return publishProductionCredits({ ...state, ...synchronized });
  }
  return { ...state, production };
}

function publishProductionCredits(state: CampaignSessionState): CampaignSessionState {
  return { ...state, world: { ...state.world, exomoney: { ...state.world.exomoney,
    ...Object.fromEntries(state.production!.teams.map((team) => [team.team, team.credits])) } } };
}

export function createCampaignSession(options: CampaignSessionOptions): TriggerResult<CampaignSession> {
  try { return { ok: true, value: new CampaignSession(options) }; }
  catch (error) { return failure(error); }
}
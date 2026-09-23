import type { LegacyUnitStat } from "./legacy-balance";
import type { BrowserCasualtyPickupOwner } from "./browser-casualty-pickup";
import { prepareAiSelector, retainAiSelectorOwner, type AiSelectorSchedulingOwner, type AiSelectorState } from "./ai-command-selector";
import { prepareBrowserAiSelector, type BrowserAiSelectorOwner } from "./browser-campaign-runtime";
import { registerBrowserType37, type BrowserCoordinateQueue, type BrowserScenarioMarker } from "./browser-type37";
import { initializeLegacyResource, scaleLegacyResource, type LegacyResourceScales } from "./legacy-resource";
import { prepareCampaignResourceRate } from "./transport-host";
import {
  commitMissionPlan,
  decodeMissionWorldAction,
  planMissionStep,
  type MissionCommandReceipt,
  type MissionControllerState,
  type MissionPlan,
  type MissionVictimLoss,
  type MissionWorldCommand,
  type MissionWorldAdapter,
  type PlannedMissionCommand,
} from "./mission-controller";
import type { AddStaticTargetOptions, DeathEvent, Faction } from "./simulation";
import {
  applyTriggerNewtype,
  type RuntimeTriggerBlock,
  type TriggerEvent,
  type TriggerInputs,
  type TriggerResult,
} from "./trigger-runtime";

export interface CampaignSourceScenario {
  readonly id: string;
  readonly teams: readonly { readonly index: number; readonly race?: number;
    readonly allies?: readonly number[]; readonly dependencies?: readonly number[] }[];
  readonly placementRows: readonly (readonly number[])[];
}

export interface CampaignPlacementState {
  readonly firstSlot: number;
  readonly nextSlot: number;
  readonly highWater: number;
  readonly renatSources: readonly {
    readonly sourceRow: number;
    readonly tileX: number;
    readonly tileY: number;
    readonly unitType: number;
    readonly count: number;
  }[];
  readonly renatBytes: Uint8Array;
}

export interface CampaignEntity {
  readonly key: string;
  readonly generation: number;
  readonly sourceRow: number | null;
  readonly team: number;
  readonly unitType: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly rawTail: readonly number[];
  readonly health: number;
  readonly maxHealth: number;
  readonly rawSlot: number | null;
  readonly simulationId: number | null;
  readonly resource?: { readonly rateWord: number; readonly countdownWord: number };
}

export interface CampaignMessage {
  readonly commandId: string;
  readonly text: string;
  readonly messageId: number;
  readonly presentationCode: number;
  readonly parameter3: number;
  readonly parameter4: number;
  readonly clockMilliseconds: number;
  readonly initialValue: 31;
}

export interface CampaignWorld {
  readonly browserCasualtyPickup?: BrowserCasualtyPickupOwner;
  readonly coordinateQueues?: readonly BrowserCoordinateQueue[];
  readonly scenarioMarkers?: readonly BrowserScenarioMarker[];
  readonly markerSpyTeams?: readonly boolean[];
  readonly teamAlliances?: readonly (readonly number[])[];
  readonly adaptedTro?: AdaptedTroState;
  readonly aiSelectors?: AiSelectorState;
  readonly sessionId: string;
  readonly source: CampaignSourceScenario;
  readonly placementState: CampaignPlacementState;
  readonly entities: readonly CampaignEntity[];
  readonly buildingSlots: TriggerInputs["buildingSlots"];
  readonly entityBytes: Uint8Array | null;
  readonly typeMovementClasses: Uint8Array | null;
  readonly commanderSlots: Readonly<Record<number, number>>;
  readonly messageTexts: Readonly<Record<number, string>>;
  readonly messages: readonly CampaignMessage[];
  readonly exomoney: Readonly<Record<number, number>>;
  readonly clockMilliseconds: number;
  readonly transportState: unknown;
  readonly statistics: Readonly<Record<string, number>>;
}

export type AdaptedTroCommand = Extract<MissionWorldCommand, { kind: "ally" | "vision" | "dfiddle" | "nopickup" | "aimsg" }>;

export interface AdaptedTroEvent {
  readonly commandId: string;
  readonly triggerId: number;
  readonly actionIndex: number;
  readonly clockMilliseconds: number;
  readonly command: AdaptedTroCommand;
  readonly sourceAction: RuntimeTriggerBlock["actions"][number];
  readonly evidence: "DC.EXE:43d9d0" | "DC.EXE:43da31" | "DC.EXE:43da8d" | "DC.EXE:43da6f" | "DC.EXE:44bf54" | "DC.EXE:4563d0" | "DC.EXE:41ad68";
}

export interface AdaptedTroState {
  readonly sharedVision: readonly (readonly number[])[];
  readonly dependencyRestrictions: readonly (readonly number[])[];
  readonly noPickup: readonly number[];
  readonly aiGroupWeights: Readonly<Record<number, Readonly<Record<number, number>>>>;
  readonly events: readonly AdaptedTroEvent[];
}

export interface AdaptedTroProjection {
  readonly runtimeProfile: "browser-adapted";
  readonly cycleCounter: number;
  readonly teamAlliances: readonly (readonly number[])[];
  readonly state: AdaptedTroState;
}

export function initialAdaptedTroState(world: CampaignWorld): AdaptedTroState {
  return { sharedVision: Array.from({ length: 8 }, (_, team) => Array.from({ length: 8 }, (_, other) => Number(team === other))),
    dependencyRestrictions: Array.from({ length: 8 }, (_, team) => [...(world.source.teams.find(entry => entry.index === team)?.dependencies ?? [])]),
    noPickup: Array(8).fill(0), aiGroupWeights: {}, events: [] };
}

export function projectAdaptedTro(world: CampaignWorld, cycleCounter: number): AdaptedTroProjection {
  const value: AdaptedTroProjection = structuredClone({ runtimeProfile: "browser-adapted", cycleCounter,
    teamAlliances: world.teamAlliances ?? Array.from({ length: 8 }, (_, team) =>
      [...(world.source.teams.find(entry => entry.index === team)?.allies ?? Array.from({ length: 8 }, (_, other) => Number(team === other)))]),
    state: world.adaptedTro ?? initialAdaptedTroState(world) });
  const freeze = (entry: object): void => {
    for (const child of Object.values(entry)) if (child !== null && typeof child === "object") freeze(child);
    Object.freeze(entry);
  };
  freeze(value);
  return value;
}

function applyAdaptedTro(world: CampaignWorld, planned: PlannedMissionCommand, command: AdaptedTroCommand): CampaignWorld {
  const decoded = decodeMissionWorldAction(planned.action, { runtimeProfile: "browser-adapted" });
  if (!decoded.ok || JSON.stringify(decoded.value) !== JSON.stringify(command)) throw new Error("Adapted TRO command differs from source action");
  const projection = projectAdaptedTro(world, 0);
  let state = structuredClone(projection.state);
  const teamAlliances = projection.teamAlliances.map(row => [...row]);
  let evidence: AdaptedTroEvent["evidence"];
  switch (command.kind) {
    case "ally":
      teamAlliances[command.team][command.otherTeam] = command.enabled;
      evidence = "DC.EXE:43d9d0";
      break;
    case "vision": {
      const sharedVision = state.sharedVision.map(row => [...row]);
      sharedVision[command.team][command.otherTeam] = command.enabled;
      sharedVision[command.otherTeam][command.team] = command.enabled;
      state = { ...state, sharedVision };
      evidence = "DC.EXE:43da31";
      break;
    }
    case "dfiddle": {
      const dependencyRestrictions = state.dependencyRestrictions.map(row => [...row]);
      dependencyRestrictions[command.team] = dependencyRestrictions[command.team].filter(value => value !== command.dependency);
      if (command.restricted) dependencyRestrictions[command.team].push(command.dependency);
      dependencyRestrictions[command.team].sort((left, right) => left - right);
      state = { ...state, dependencyRestrictions };
      evidence = "DC.EXE:43da8d";
      break;
    }
    case "nopickup": {
      const noPickup = [...state.noPickup];
      noPickup[command.team] = 1;
      state = { ...state, noPickup };
      evidence = "DC.EXE:43da6f";
      break;
    }
    case "aimsg": {
      const mode = world.aiSelectors?.modes[command.team];
      if (mode === undefined || !Number.isInteger(mode) || mode < 0 || mode > 4) throw new Error("aimsg: unknown policy callback");
      evidence = mode === 3 ? "DC.EXE:44bf54" : mode === 0 ? "DC.EXE:41ad68" : "DC.EXE:4563d0";
      if (mode === 3) state = { ...state, aiGroupWeights: { ...state.aiGroupWeights,
        [command.team]: { ...state.aiGroupWeights[command.team], [command.selector]: command.value } } };
      break;
    }
  }
  if (state.events.some(event => event.commandId === planned.id)) throw new Error("Duplicate adapted TRO command");
  const event: AdaptedTroEvent = { commandId: planned.id, triggerId: planned.triggerId, actionIndex: planned.actionIndex,
    clockMilliseconds: world.clockMilliseconds, command, sourceAction: structuredClone(planned.action), evidence };
  return { ...world, teamAlliances, adaptedTro: { ...state, events: [...state.events, event] } };
}

export interface CampaignWorldOptions {
  readonly runtimeProfile?: "browser-adapted";
  readonly sessionId: string;
  readonly source: CampaignSourceScenario;
  readonly units: readonly (LegacyUnitStat & { readonly rawTail?: readonly number[] })[];
  readonly messages: readonly { readonly id: number; readonly text: string }[];
  readonly buildingSlots?: TriggerInputs["buildingSlots"];
  readonly entityBytes?: Uint8Array;
  readonly typeMovementClasses?: Uint8Array;
  readonly commanderSlots?: Readonly<Record<number, number>>;
  readonly transportState?: unknown;
  readonly placementInitialization?: {
    readonly firstSlot: number;
    readonly highWater?: number;
    readonly mode: 0 | 3;
  };
  readonly resourceInitialization?: {
    readonly width: number;
    readonly height: number;
    readonly firstSlot: number;
    readonly scales: LegacyResourceScales;
  };
}

export interface CampaignTransportAdapter {
  prepare(world: CampaignWorld, planned: PlannedMissionCommand): TriggerResult<{
    readonly world: CampaignWorld;
    readonly disposition: "scheduled" | "applied";
  }>;
}

export interface CampaignResourceRateCommand {
  readonly kind: "newrate";
  readonly rate: number;
  readonly tileX: number;
  readonly tileY: number;
}

export type CampaignPlannedCommand = Omit<PlannedMissionCommand, "command"> & {
  readonly command: PlannedMissionCommand["command"] | CampaignResourceRateCommand;
};

export interface CampaignWorldAdapter extends MissionWorldAdapter<CampaignWorld> {
  prepare(world: CampaignWorld, commands: readonly CampaignPlannedCommand[]): TriggerResult<{
    readonly world: CampaignWorld;
    readonly receipts: readonly MissionCommandReceipt[];
  }>;
}

function failure<Value>(message: string, missing = false): TriggerResult<Value> {
  return { ok: false, diagnostics: [{ code: missing ? "missing-input" : "invalid-input", message }] };
}

function integer(value: number, maximum: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= maximum;
}

export function createCampaignWorld(options: CampaignWorldOptions): TriggerResult<CampaignWorld> {
  if (!options.sessionId) return failure("Campaign requires a nonempty session ID");
  if (options.entityBytes && options.entityBytes.length !== 800 * 220) return failure("Expected all 800 raw slots");
  if (options.typeMovementClasses && options.typeMovementClasses.length !== 110) return failure("Expected 110 movement classes");
  if (options.resourceInitialization) {
    const initialization = options.resourceInitialization;
    if (!integer(initialization.firstSlot, 799) || !integer(initialization.width, 256) || initialization.width === 0 ||
      !integer(initialization.height, 256) || initialization.height === 0) return failure("Invalid bounded resource initialization");
    try {
      scaleLegacyResource(0, options.resourceInitialization.scales.rateScale);
      scaleLegacyResource(0, options.resourceInitialization.scales.reserveScale);
    } catch (error) { return failure(`Invalid resource scales: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const allocation = options.placementInitialization;
  const firstSlot = allocation?.firstSlot ?? options.resourceInitialization?.firstSlot ?? 152;
  let nextSlot = firstSlot;
  let highWater = allocation?.highWater ?? firstSlot;
  if (!integer(firstSlot, 799) || !integer(highWater, 800) || highWater < firstSlot ||
      (allocation && allocation.mode !== 0 && allocation.mode !== 3)) return failure("Unsupported native placement allocation state");
  if (allocation && options.resourceInitialization && firstSlot !== options.resourceInitialization.firstSlot) {
    return failure("Placement and resource firstSlot must agree");
  }
  const renatSources: CampaignPlacementState["renatSources"][number][] = [];
  const renatBytes = new Uint8Array(25 * 40);
  const renatView = new DataView(renatBytes.buffer);
  const entities: CampaignEntity[] = [];
  const coordinateQueues: BrowserCoordinateQueue[] = [];
  const scenarioMarkers: BrowserScenarioMarker[] = [];
  for (const [index, row] of options.source.placementRows.entries()) {
    const [tileX, tileY, sourceType, team, ...rawTail] = row;
    if ((row.length !== 5 && row.length !== 6) || row.some((value) => !Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) ||
        !integer(tileX, 255) || !integer(tileY, 255) || !integer(sourceType, 109)) return failure(`Invalid declared placement ${index}`);
    if (nextSlot >= 800) return failure(`Placement ${index} exceeds native slot capacity`);
    if (team === -1) {
      if (!allocation) return failure("RENAT placement requires explicit initial placement state", true);
      if (!integer(row[4], 9) || renatSources.length >= 25 || !options.units.some(({ index: type }) => type === sourceType)) {
        return failure(`Unsupported RENAT placement ${index}`);
      }
      const offset = renatSources.length * 40;
      for (const [field, value] of [tileX, tileY, sourceType, row[4]].entries()) renatView.setInt32(offset + 4 + field * 4, value, true);
      renatSources.push({ sourceRow: index, tileX, tileY, unitType: sourceType, count: row[4] });
      continue;
    }
    let unitType = sourceType;
    const sourceStat = options.units.find(({ index: type }) => type === sourceType);
    const declaredTeam = options.source.teams.find(({ index: declared }) => declared === team);
    if (integer(team, 7)) {
      if (!sourceStat || !declaredTeam) return failure(`Missing placement type/team ${index}`, true);
      if (declaredTeam.race === undefined) {
        if (allocation) return failure(`Missing team race at placement ${index}`, true);
      } else if (declaredTeam.race !== sourceStat.faction) {
        const counterpart = sourceStat.rawTail?.[20];
        if (counterpart === undefined) return failure(`Missing counterpart metadata for type ${sourceType}`, true);
        if (counterpart !== -1) {
          if (!integer(counterpart, 109)) return failure(`Invalid counterpart for type ${sourceType}`);
          unitType = counterpart;
        }
      }
    }
    if (unitType === 37) {
      if (options.runtimeProfile !== "browser-adapted") return failure(`Placement ${index} requires native type-37 coordinate queue and selector-6 state`, true);
      if (!allocation || !sourceStat || sourceStat.health <= 0) return failure("Type37 requires explicit fresh allocation and source stats", true);
      if (coordinateQueues.length >= 10 || coordinateQueues.some(queue => queue.tileX === tileX && queue.tileY === tileY)) {
        return failure("Unsupported duplicate or excess type37 coordinate queue");
      }
      scenarioMarkers.push(registerBrowserType37(index, nextSlot, coordinateQueues.length));
      coordinateQueues.push({ sourceRow: index, tileX, tileY, captured: [] });
      entities.push({ key: `placement:${index}`, generation: 0, sourceRow: index, team: 8, unitType,
        tileX, tileY, rawTail, health: row[4] < 0 ? sourceStat.health : row[4], maxHealth: sourceStat.health,
        rawSlot: nextSlot, simulationId: null });
      nextSlot += 1;
      highWater = Math.max(highWater, nextSlot);
      continue;
    }
    if (unitType === 40) {
      const initialization = options.resourceInitialization;
      if (!initialization) return failure("Type 40 requires explicit bounded resource initialization", true);
      const stat = options.units.find((entry) => entry.index === 40);
      if (!stat) return failure("Missing type-40 definition reserve", true);
      if ((row.length !== 5 && row.length !== 6) || row.some((value) => !Number.isInteger(value)) ||
          !integer(initialization.width, 256) || initialization.width === 0 ||
          !integer(initialization.height, 256) || initialization.height === 0 ||
          !integer(tileX, initialization.width - 1) || !integer(tileY, initialization.height - 1)) {
        return failure(`Unsupported resource placement ${index}`);
      }
      try {
        const resource = initializeLegacyResource({ slot: nextSlot, tileX, tileY,
          sourceRate: team, sourceReserve: row[4], scales: initialization.scales, typeReserve: stat.health });
        entities.push({ key: `placement:${index}`, generation: 0, sourceRow: index, team: resource.owner,
          unitType, tileX, tileY, rawTail, health: resource.reserve, maxHealth: stat.health,
          rawSlot: resource.slot, simulationId: null,
          resource: { rateWord: resource.rateWord, countdownWord: resource.countdownWord } });
      } catch (error) { return failure(`Resource placement ${index}: ${error instanceof Error ? error.message : String(error)}`); }
      nextSlot += 1;
      highWater = Math.max(highWater, nextSlot);
      continue;
    }
    const queueIndex = coordinateQueues.findIndex(queue => queue.tileX === tileX && queue.tileY === tileY);
    if (queueIndex >= 0) {
      const queue = coordinateQueues[queueIndex];
      if (queue.captured.length >= 10) return failure("Type37 coordinate FIFO capacity exceeded");
      coordinateQueues[queueIndex] = { ...queue, captured: [...queue.captured, { sourceRow: index, unitType }] };
      highWater = Math.max(highWater, nextSlot);
      continue;
    }
    if (row.length < 4 || row.some((value) => !Number.isInteger(value)) ||
        !integer(tileX, 255) || !integer(tileY, 255) || !integer(unitType, 109) || !integer(team, 7) ||
        !options.source.teams.some((entry) => entry.index === team)) return failure(`Invalid declared placement ${index}`);
    const stat = options.units.find((entry) => entry.index === unitType);
    if (!stat || !Number.isSafeInteger(stat.health) || stat.health <= 0) return failure(`Missing stat health for type ${unitType}`, true);
    entities.push({ key: `placement:${index}`, generation: 0, sourceRow: index, team, unitType,
      tileX, tileY, rawTail, health: stat.health, maxHealth: stat.health,
      rawSlot: allocation || options.resourceInitialization ? nextSlot : null, simulationId: null });
    nextSlot += 1;
    highWater = Math.max(highWater, nextSlot);
  }
  const messageTexts: Record<number, string> = {};
  for (const message of options.messages) {
    if (!integer(message.id, 29) || !message.text || Object.hasOwn(messageTexts, message.id)) return failure("Invalid or duplicate message text");
    messageTexts[message.id] = message.text;
  }
  for (const [key, value] of Object.entries(options.buildingSlots ?? {})) {
    if (!/^[0-7],[0-4]$/.test(key) || !integer(value, 0xffffffff)) return failure(`Invalid reserved building slot ${key}`);
  }
  const statistics: Record<string, number> = options.resourceInitialization
    ? { "1,0": options.resourceInitialization.scales.rateScale, "2,0": options.resourceInitialization.scales.reserveScale } : {};
  return { ok: true, value: structuredClone({ sessionId: options.sessionId, source: options.source, entities,
    ...(scenarioMarkers.length ? { coordinateQueues, scenarioMarkers, markerSpyTeams: Array(8).fill(false) } : {}),
    placementState: { firstSlot, nextSlot, highWater, renatSources, renatBytes },
    buildingSlots: options.buildingSlots ?? {}, entityBytes: options.entityBytes ?? null,
    typeMovementClasses: options.typeMovementClasses ?? null, commanderSlots: options.commanderSlots ?? {},
    messageTexts, messages: [], exomoney: {}, clockMilliseconds: 0, transportState: options.transportState ?? null,
    statistics }) };
}

export function campaignStaticTargetOptions(
  entity: CampaignEntity,
  teamFactions: Readonly<Partial<Record<number, Faction>>>,
): TriggerResult<AddStaticTargetOptions> {
  if (entity.unitType === 37) return failure("Type37 is a source coordinate relay, not an adapted combat target", true);
  if (entity.resource) return failure("Resource reserve is not combat HP; source registration requires a resource renderer", true);
  const faction = teamFactions[entity.team];
  if (faction !== "human" && faction !== "alien") return failure(`No explicit simulation faction for team ${entity.team}`, true);
  if (entity.health !== entity.maxHealth || entity.health <= 0) return failure("Static-target creation requires a fresh full-health entity");
  return { ok: true, value: { faction, cell: { x: entity.tileX, y: entity.tileY }, maxHealth: entity.maxHealth } };
}

export function bindCampaignEntity(
  world: CampaignWorld, key: string, simulationId: number, rawSlot: number | null = null,
): TriggerResult<CampaignWorld> {
  const entity = world.entities.find((entry) => entry.key === key);
  if (!entity || !Number.isSafeInteger(simulationId) || simulationId < 1 ||
      (rawSlot !== null && !integer(rawSlot, 799))) return failure("Invalid entity binding");
  if (world.scenarioMarkers?.some(marker => marker.key === entity.key)) return failure("Type37 markers cannot bind combat simulation actors");
  if (world.entities.some((entry) => entry.key !== key && (entry.simulationId === simulationId ||
      (rawSlot !== null && entry.rawSlot === rawSlot)))) return failure("Duplicate entity binding");
  if (entity.simulationId !== null && (entity.simulationId !== simulationId || entity.rawSlot !== rawSlot)) {
    return failure("Rebinding requires an explicit new entity generation");
  }
  if (rawSlot !== null) {
    const bytes = world.entityBytes;
    if (!bytes || bytes[rawSlot * 220 + 6] !== entity.unitType || bytes[rawSlot * 220 + 7] !== entity.team) {
      return failure("Raw slot does not match declared entity team/type", true);
    }
  }
  return { ok: true, value: { ...world, entities: world.entities.map((entry) => entry.key === key
    ? { ...entry, simulationId, rawSlot } : entry) } };
}

export function campaignVictimLosses(world: CampaignWorld, deaths: readonly DeathEvent[]): TriggerResult<{
  readonly world: CampaignWorld;
  readonly losses: readonly MissionVictimLoss[];
}> {
  const losses: MissionVictimLoss[] = [];
  const deadKeys = new Set<string>();
  for (const death of deaths) {
    const entity = world.entities.find((entry) => entry.simulationId === death.targetId);
    if (death.type !== "death" || !entity) return failure(`Unresolved combat victim ${death.targetId}`, true);
    if (entity.resource) return failure("Resource depletion is not a combat victim loss", true);
    losses.push({ id: JSON.stringify([world.sessionId, entity.key, entity.generation]),
      victimTeam: entity.team, victimType: entity.unitType });
    deadKeys.add(entity.key);
  }
  return { ok: true, value: { world: { ...world, entities: world.entities.map((entity) => deadKeys.has(entity.key)
    ? { ...entity, health: 0 } : entity) }, losses } };
}

function applyCommand(world: CampaignWorld, planned: PlannedMissionCommand, transport?: CampaignTransportAdapter,
  aiSelectorOwner?: AiSelectorSchedulingOwner, browserAiOwner?: BrowserAiSelectorOwner): TriggerResult<{
  readonly world: CampaignWorld;
  readonly disposition: MissionCommandReceipt["disposition"];
}> {
  const command = planned.command;
  switch (command.kind) {
    case "ally": case "vision": case "dfiddle": case "nopickup": case "aimsg":
      if (!browserAiOwner) return failure(`${command.kind}: explicit browser-adapted owner required`, true);
      return { ok: true, value: { world: applyAdaptedTro(world, planned, command), disposition: "applied" } };
    case "ai":
      if (browserAiOwner) return { ok: true, value: {
        world: prepareBrowserAiSelector(world, planned, browserAiOwner), disposition: "applied" } };
      if (!aiSelectorOwner) return { ok: false, diagnostics: [{ code: "unsupported-action",
        message: "ai: native policy scheduling owner required" }] };
      return { ok: true, value: { world: prepareAiSelector(world, planned, aiSelectorOwner), disposition: "applied" } };
    case "msg": {
      const text = world.messageTexts[command.messageId];
      if (text === undefined) return failure(`Missing message ${command.messageId}`, true);
      const adapted = browserAiOwner !== undefined || world.browserCasualtyPickup?.runtimeProfile === "browser-adapted";
      if ((!adapted && world.messages.length >= 16) || command.parameter4 === 255) return failure("Message rollover/special selection requires a verified backend", true);
      const recentMessages = adapted ? world.messages.slice(-15) : world.messages;
      return { ok: true, value: { disposition: "applied", world: { ...world, messages: [...recentMessages,
        { commandId: planned.id, text, messageId: command.messageId, presentationCode: command.presentationCode,
          parameter3: command.parameter3, parameter4: command.parameter4, clockMilliseconds: world.clockMilliseconds, initialValue: 31 }] } } };
    }
    case "exomoney":
      return { ok: true, value: { disposition: "applied", world: { ...world, exomoney: { ...world.exomoney, [command.team]: command.value } } } };
    case "newtype": {
      if (!world.entityBytes || !world.typeMovementClasses) return failure("newtype requires raw slots and movement classes", true);
      const changed = applyTriggerNewtype(world.entityBytes, world.typeMovementClasses, command.tileX, command.tileY, command.newType);
      if (!changed.ok) return changed;
      if (changed.value.changedSlot !== null && (command.newType === 40 || world.entities.some((entity) =>
        entity.rawSlot === changed.value.changedSlot && entity.resource))) return failure("newtype resource lifecycle is unsupported", true);
      return { ok: true, value: { disposition: changed.value.changedSlot === null ? "verified-no-match" : "applied",
        world: { ...world, entityBytes: changed.value.entityBytes, entities: world.entities.map((entity) =>
          changed.value.changedSlot !== null && entity.rawSlot === changed.value.changedSlot ? { ...entity, unitType: command.newType } : entity) } } };
    }
    case "waypoint": {
      if (!world.entityBytes || world.entityBytes.length !== 800 * 220) return failure("waypoint requires all 800 raw slots", true);
      const bytes = new Uint8Array(world.entityBytes);
      for (let slot = 0; slot < 800; slot += 1) {
        const offset = slot * 220;
        if (bytes[offset + 1] !== command.tileX || bytes[offset + 5] !== command.tileY) continue;
        const view = new DataView(bytes.buffer);
        command.points.forEach((point, index) => {
          view.setUint16(offset + 0xa6 + index * 4, point.tileX * 256 + 128, true);
          view.setUint16(offset + 0xa8 + index * 4, point.tileY * 256 + 128, true);
        });
        bytes[offset + 0x36] = 1;
        bytes[offset + 0x37] = 9;
        bytes[offset + 0xc6] = command.points.length;
        return { ok: true, value: { disposition: "applied", world: { ...world, entityBytes: bytes } } };
      }
      return { ok: true, value: { disposition: "verified-no-match", world } };
    }
    case "abduct": {
      const slot = world.commanderSlots[command.selectedSide];
      if (!integer(slot, 799) || !world.entityBytes || world.entityBytes.length !== 800 * 220) {
        return failure(`Missing valid full commander slot for side ${command.selectedSide}`, true);
      }
      const status = world.entityBytes[slot * 220 + 0x2c];
      if (status === 0 || status === 10) return { ok: true, value: { world, disposition: "verified-inactive-target" } };
    }
  }
  if (!transport) return failure(`${command.kind} requires transactional transport preparation; command remains pending`, true);
  const result = transport.prepare(structuredClone(world), structuredClone(planned));
  if (!result.ok) return result;
  const expected = command.kind === "reinforce2" ? "applied" : "scheduled";
  if (result.value.disposition !== expected) return failure(`${command.kind} requires ${expected}, not an intent-only receipt`);
  return { ok: true, value: structuredClone(result.value) };
}

export function createCampaignWorldAdapter(transport?: CampaignTransportAdapter, aiSelectorOwner?: AiSelectorSchedulingOwner,
  browserAiOwner?: BrowserAiSelectorOwner): CampaignWorldAdapter {
  if (aiSelectorOwner && browserAiOwner) throw new Error("Distinct native/browser selector capabilities cannot be combined");
  const prepareTransport = transport ? { prepare: transport.prepare.bind(transport) } : undefined;
  const selectorOwner = aiSelectorOwner && retainAiSelectorOwner(aiSelectorOwner);
  return {
    ...(selectorOwner ? { aiSelector: true as const } : {}),
    ...(browserAiOwner ? { browserAi: true as const, runtimeProfile: "browser-adapted" as const } : {}),
    prepare(world, commands) {
      let staged = structuredClone(world);
      const receipts: MissionCommandReceipt[] = [];
      for (const planned of commands) {
        let result: ReturnType<typeof applyCommand>;
        try {
          if (planned.statistics) staged = { ...staged, statistics: { ...planned.statistics } };
          result = planned.command.kind === "newrate"
            ? prepareCampaignResourceRate(staged, { ...planned, command: planned.command })
            : applyCommand(staged, { ...planned, command: planned.command }, prepareTransport, selectorOwner, browserAiOwner);
        } catch (error) {
          result = failure(`Preparation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!result.ok) return { ok: false, diagnostics: result.diagnostics.map((entry) => ({ ...entry,
          triggerId: planned.triggerId, actionIndex: planned.actionIndex })) };
        staged = result.value.world;
        receipts.push({ commandId: planned.id, disposition: result.value.disposition });
      }
      return { ok: true, value: { world: staged, receipts } };
    },
  };
}

export function planCampaignStep<Block extends RuntimeTriggerBlock>(
  state: MissionControllerState<Block>, world: CampaignWorld,
  clock: Omit<TriggerInputs, "buildingSlots">, event: TriggerEvent, losses: readonly MissionVictimLoss[] = [],
  options?: { readonly aiSelector: true },
): { readonly plan: MissionPlan<Block>; readonly pendingTransport: readonly PlannedMissionCommand[] } {
  const plan = planMissionStep(state, { ...clock, buildingSlots: world.buildingSlots }, event, losses, options);
  return { plan, pendingTransport: structuredClone(plan.commands.filter(({ command }) =>
    command.kind === "reinforce" || command.kind === "reinforce2" || command.kind === "abduct")) };
}

export function stepCampaignWorld<Block extends RuntimeTriggerBlock>(
  state: MissionControllerState<Block>, world: CampaignWorld,
  clock: Omit<TriggerInputs, "buildingSlots">, event: TriggerEvent,
  deaths: readonly DeathEvent[] = [], transport?: CampaignTransportAdapter,
  aiSelectorOwner?: AiSelectorSchedulingOwner,
): TriggerResult<{ readonly state: MissionControllerState<Block>; readonly world: CampaignWorld;
  readonly receipts: readonly MissionCommandReceipt[] }> {
  const recorded = campaignVictimLosses(world, deaths);
  if (!recorded.ok) return recorded;
  const staged = { ...recorded.value.world, clockMilliseconds: clock.clockMilliseconds };
  const { plan } = planCampaignStep(state, staged, clock, event, recorded.value.losses, aiSelectorOwner ? { aiSelector: true } : undefined);
  return commitMissionPlan(state, plan, staged, createCampaignWorldAdapter(transport, aiSelectorOwner));
}
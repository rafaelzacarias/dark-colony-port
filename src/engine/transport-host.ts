import type { CampaignEntity, CampaignResourceRateCommand, CampaignTransportAdapter, CampaignWorld } from "./campaign-world";
import type { LegacyUnitStat } from "./legacy-balance";
import { browserCasualtyPickupPolicy, type BrowserCasualtyPickup } from "./browser-casualty-pickup";
import { nativeConstructionRaw, restoreNativeConstructionHost, type NativeConstructionHost } from "./native-construction-host";
import { isAuthenticatedSourceNativeTaskConfiguration, isImmutableSourceNativeTaskConfiguration,
  retainSourceNativeTaskConfiguration, snapshotNativeTaskConfiguration, sourceNativeTaskValue,
  extendSourceNativeTaskConfiguration, validateSourceNativeWorld } from "./source-native-task-options";
import { decodeLegacyAiTaskStack, stageLegacyAiTaskPendingVisit, type LegacyAiRegisteredWorld } from "./legacy-ai-task";
import { stageSourceNativeVisibility, validateSourceNativeVisibilityHostConfiguration, type SourceNativeVisibilityFrame,
  type SourceNativeVisibilityEvent } from "./source-native-visibility-host";
import { createSourceNativeCombatOwner, sourceNativeCombatVisitWorld, stepSourceNativeCombatProjectiles, stepSourceNativeCombatDeath,
  retainSourceNativeCombatConfiguration, validateSourceNativeCombatConfiguration, validateSourceNativeCombatSoundState, sourceNativeCombatSound,
  type SourceNativeCombatAudioFrame, type SourceNativeCombatConfiguration, type SourceNativeCombatOwner } from "./source-native-combat-host";
import type { LegacyNativeDeathSoundRequest } from "./legacy-native-death";
import { validLegacyNativeProjectileState, type LegacyNativeFireSpawn } from "./legacy-native-fire";
import { applyLegacyAiActorPacket, decodeLegacyAiActorPacket } from "./legacy-ai-policy";
import { advanceLegacyResourceAnimation, advanceLegacyResourceCountdown, changeLegacyResourceRate,
  extractLegacyResource, resetLegacyResourceAnimation,
  type LegacyResourceAnimation, type LegacyResourceAnimationProfile } from "./legacy-resource";
import type { MissionVictimLoss, PlannedMissionCommand } from "./mission-controller";
import {
  createTransportState, native256ToTile, reduceTransport, tileToNative256,
  type TransportCommand, type TransportEffect, type TransportGroups,
  type TransportPosition, type TransportState,
} from "./legacy-transport";
import type { TriggerResult } from "./trigger-runtime";
import { reduceLegacyHarvesterIdle, type LegacyHarvesterIdleState } from "./legacy-harvester-idle";
import { beginLegacyHarvesterMovement, decodeLegacyHarvesterMovement, legacyHarvesterMovementDiagnostic,
  queueLegacyHarvesterMovementStop, reduceLegacyHarvesterMovement, type LegacyHarvesterMovementState,
  type LegacyHarvesterMovementWorld } from "./legacy-harvester-movement";

export interface HostDefinition {
  readonly unitType: number;
  readonly health: number;
  readonly movementSpeed: number;
  readonly plane: "ground" | "flying";
}

export interface ProductionExitReservation {
  readonly key: string;
  readonly team: number;
  readonly queue: 0 | 1 | 2 | 3;
  readonly ticket: string;
  readonly unitType: number;
  readonly tile: TransportPosition;
}

export interface HostSlot {
  nativeConstruction?: { team: number; receiptId: string; raw: number[] };
  nativeAiTask?: { profile: number; raw: number[] };
  pendingNativeAi?: { receiptId: string; disposition: "pending-native-task-hand-off" };
  slot: number;
  generation: number;
  key: string;
  team: number;
  unitType: number;
  status: number;
  health: number;
  position: TransportPosition;
  height: number;
  task: "unit" | "transport" | "removal" | "death" | "idle" | "extraction" | "retraction";
  taskWords: number[];
  resource?: { rateWord: number; countdownWord: number };
  resourceTask?: ResourceHostEntityState;
}

export interface ResourceHostEntityState {
  nativeMovement?: { state: LegacyHarvesterMovementState; world: LegacyHarvesterMovementWorld };
  nativeBanks?: Readonly<Record<string, number>>;
  nativeStopRequested?: true;
  direction: number;
  animation: LegacyResourceAnimation;
  pendingOrder: number;
  order: number;
  stack: { opcode: 1 | 3 | 10 | 12 | 13; words: number[] }[];
  released: boolean;
  nativeIdle?: Pick<LegacyHarvesterIdleState, "randomIndex" | "observer" | "specialOrder" | "confusion" |
    "secondaryAnimationPending" | "secondaryAnimationsInactive"> & { groundWord: number };
}

export interface ResourceHostType {
  readonly unitType: number;
  readonly stand: string;
  readonly deploy: string;
  readonly death: string;
  readonly deathVariants: number;
  readonly removalHoldField: number;
  readonly selectedWeapon: number;
  readonly preservedIdle?: string;
}

export interface ResourceHostOptions {
  readonly nativeHarvest?: NativeHarvestConfiguration;
  readonly animations: readonly LegacyResourceAnimationProfile[];
  readonly types: readonly ResourceHostType[];
  readonly bindings: readonly ResourceHostBinding[];
}

export interface NativeHarvestConfiguration {
  readonly scope: "source-separated-bounded";
  readonly evidence: string;
  readonly sourceMetadata: { readonly executableSha256: string; readonly pthSha256: string;
    readonly finSha256: Readonly<Record<"VENT" | "EXPL" | "SLUG", string>>;
    readonly randomScope: "isolated-index-no-draws"; readonly sharedRandomDraws: 0 };
  readonly profiles: readonly LegacyHarvesterMovementWorld[];
  readonly bindings: readonly { readonly slot: number; readonly generation: number;
    readonly raw: readonly number[]; readonly randomIndex: number; readonly groundWord: number;
    readonly provenance: "constructor" | "restored-idle" }[];
}

export type NativeHarvestCommand = { readonly slot: number; readonly generation: number } &
  ({ readonly type: "stop" } | { readonly type: "move" | "harvest"; readonly target: { readonly x: number; readonly y: number };
    readonly sourceSlot?: number });

export interface ResourceHostBinding {
  readonly slot: number;
  readonly generation: number;
  readonly state: ResourceHostEntityState;
}

export interface ResourceHostFrame {
  readonly nativePhaseCounter: number;
  readonly localTeam: number;
  readonly cancellationGate: number;
  readonly sides: readonly { readonly aiField: number; readonly aiMultiplier: number; readonly creditGate: number }[];
  readonly orders?: readonly { readonly slot: number; readonly generation: number; readonly pendingOrder: number; readonly order: number }[];
}

export interface HostMotion {
  id: number;
  kind: "orientation" | "movement";
  destination: TransportPosition;
  origin: TransportPosition;
  progress: number;
}

export type HostRequest =
  | ({ type: "native-death-sound"; generation: number; counter: number } & LegacyNativeDeathSoundRequest)
  | { type: "source-sound"; commandId: string; slot: number; generation: number;
      category: 1; event: 7; ebx: 0; ecx: 0; stackArgument: 0; spatial: false }
      | { type: "resource-unit-sound"; slot: number; generation: number; edx: number; ebx: 3 | 5; ecx: 0 | 1;
        stackArguments: [number, number]; spatial: true }
      | { type: "resource-task-released"; slot: number; generation: number; task: 1 }
  | { type: "create"; slot: number; generation: number; team: number; unitType: number; position: TransportPosition }
  | { type: "remove-noncombat"; slot: number; generation: number; task: 10; taskWords: [1, 0] }
  | { type: "clear-collision" | "unregister"; slot: number; generation: number }
  | { type: "casualty-picked-up"; slot: number; generation: number; carrierId: number }
  | { type: "combat-death"; slot: number; generation: number; loss: MissionVictimLoss };

export interface TransportHostState {
  browserCasualties?: BrowserCasualtyPickup[];
  nativeAiTasks?: NativeAiTaskOwner;
  nativeCombat?: SourceNativeCombatOwner;
  kind: "transport-host-v1";
  reducer: TransportState;
  slots: (HostSlot | null)[];
  registry: (string | null)[];
  generations: number[];
  highWater: number;
  width: number;
  height: number;
  groundEligible: boolean[];
  ground: number[];
  flying: number[];
  resourceTileFlags: number[];
  definitions: HostDefinition[];
  sides: number[];
  directionBits: (readonly [0 | 1, 0 | 1])[];
  directionCursor: number;
  fixedStepMilliseconds: number;
  orientationSteps: number;
  tick: number;
  remainderMilliseconds: number;
  motions: HostMotion[];
  fifos: { tile: TransportPosition; types: number[] }[];
  receipts: { id: string; command: string; disposition: "applied" | "scheduled" }[];
  requests: HostRequest[];
  productionExits?: ProductionExitReservation[];
  resourceLifecycle?: { animations: LegacyResourceAnimationProfile[]; types: ResourceHostType[]; nativePhaseCounter: number | null;
    nativeHarvest?: NativeHarvestConfiguration };
}

export interface TransportHostOptions {
  readonly width: number;
  readonly height: number;
  readonly groundEligible: readonly boolean[];
  readonly definitions: readonly HostDefinition[];
  readonly sides: readonly number[];
  readonly directionBits: readonly (readonly [0 | 1, 0 | 1])[];
  readonly fixedStepMilliseconds: number;
  readonly orientationSteps: number;
  readonly highWater: number;
  readonly fifos?: readonly { readonly tile: TransportPosition; readonly types: readonly number[] }[];
  readonly resourceLifecycle?: ResourceHostOptions;
}

export interface NativeAiTaskConfiguration {
  readonly scope: "source-separated-bounded";
  readonly sourceId: string;
  readonly profiles: readonly LegacyAiRegisteredWorld[];
  readonly bindings: readonly { readonly slot: number; readonly generation: number; readonly key: string;
    readonly profile: number; readonly raw: readonly number[]; readonly expectedRaw: readonly number[] }[];
  readonly counter: number;
  readonly rngCursor: number;
  readonly task6Budget: number;
}

export interface NativeAiTaskOwner {
  configuration: NativeAiTaskConfiguration;
  ground: number[];
  rngCursor: number;
  task6Budget: number;
  visits: number;
}

export interface NativeAiTaskFrame {
  readonly counter: number;
  readonly task6Budget: number;
  readonly registeredSlots?: readonly number[];
  readonly sound?: SourceNativeCombatAudioFrame;
}

const nativeAiSourcePins = new Set([
  "c5b4af367b2228a1d6792b1dfda9ab4a0b5c76d3fa33042d5bc3944b0c48f27a",
  "e81d4c00970033790a566279286b0769b6299f0252a157bd0f62f514e6ace422",
  "5dc6ad79908212f871b4edd4fa0e11452ebf4cc07b06380c916df698d895938e",
  "917847ac2e1b72784012987f4641a77c2b64ae4562d662aa754faadb10b524bd",
  "ac36bba7d47daf9218397799883815e13e1b1c866d65e7b32aba90cd1874ae27",
  "8d34b11ea506d996ea9ec1f1ea0015a250d0c794620bb3dcafa1292638b1c88d",
  "a3e1ad808bc58b52f979401fe40ace063acc7ba222a8dd0c56e7bf10a95b887e",
  "2c87b51970cfe0e97993d20d0e830b11f4a13d05cd57af81fab4d68bb1cbc691",
  "a0c4f23955ccdc2a863dc4c6663fd2d5fceacbb6f7d774f24967de2d97cc8993",
  "2a7b4631520d4460f9b6b1d85d3afd31110d062c5f92172a9c68d6b5d9aba4c9",
  "9ec4b3e60ef613e5aee08a5b418eb74854895acd5fc510de0eaa7f81618a74de",
  "9820031580c2cc3f7839eb952af2315d750af44ae25412887466ae16900bc539",
  "eb8207c5e3551675204a18237847396fddaf7e52ee012cb9e48b5781c08d55a7",
  "1ca80f42e941d63f080b4d02b4e2ee45447433130509eb17c3722b0b3bc3ac36",
  "0af332c5916b38489b4d0e461cf9aa6be9281df540630d0161de5173bea763bd",
  "7b50a709c7889436ed63cf1adc460215255ee4f0a5251480b462de672101df1a",
  "d6d14b9afe8cb412fd56dd4affddf4f14c7b71245515e38c0a1926d483b9f975",
  "102cae6eb0caabcfeb983cc22e235aa34c21a4879a601b86c6c9e604db4d6a0a",
  "233af6de43f7e8d025559fa20b18360669d049c8bf076988602364c8bc396fdb",
  "9256eb4c7b31beb5b981c25205fba372281f2d5dbe5712e55b1e268234ddbe9d",
  "46faf56caaffa74266dbf402bf13763c1c299fb88aabf9d34b7314958968caa4",
  "cf1cb5cd08558b222a5a0dcebf1aeae4af3a149f56139f621d1da561b221b1cd",
  "c43a2730bd698b2cd06e3eeab59a28f38b5656ca9241591bfd4f65a2c668712d",
  "325b343ebe51c3b1eb265c892e934aee2b26b37047aa2f1c99cf724f11ff5c32",
]);
const authenticatedNativeAiSources = new Map<string, string>();

function nativeAiSourceValue(configuration: NativeAiTaskConfiguration): string {
  return JSON.stringify({ profiles: configuration.profiles,
    bindings: configuration.bindings.map(({ slot, profile, raw }) => ({ slot, profile, raw })),
    counter: configuration.counter, rngCursor: configuration.rngCursor, task6Budget: configuration.task6Budget },
  (_key, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
}

export async function authenticateNativeAiTaskConfiguration(configuration: NativeAiTaskConfiguration): Promise<NativeAiTaskConfiguration> {
  const candidate = snapshotNativeTaskConfiguration(configuration);
  if (candidate.sourceId.startsWith("nativeactor-source-v2:")) {
    const retained = retainSourceNativeTaskConfiguration(candidate);
    validateNativeAiTaskConfiguration(retained);
    return retained;
  }
  const source = nativeAiSourceValue(candidate);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source))),
    value => value.toString(16).padStart(2, "0")).join("");
  requireHost(nativeAiSourcePins.has(hash) && candidate.sourceId === `nativeactor-v1:${hash}`,
    "Native AI configuration is not in the verified constructor/source corpus");
  authenticatedNativeAiSources.set(source, candidate.sourceId);
  validateNativeAiTaskConfiguration(candidate);
  return candidate;
}

export function validateNativeAiTaskConfiguration(configuration: NativeAiTaskConfiguration): void {
  requireHost(configuration && Object.keys(configuration).sort().join() ===
    "bindings,counter,profiles,rngCursor,scope,sourceId,task6Budget" && configuration.scope === "source-separated-bounded"
    && (isAuthenticatedSourceNativeTaskConfiguration(configuration)
      || (/^nativeactor-v1:[a-f0-9]{64}$/.test(configuration.sourceId)
        && nativeAiSourcePins.has(configuration.sourceId.slice(15))
        && authenticatedNativeAiSources.get(nativeAiSourceValue(configuration)) === configuration.sourceId)), "Native AI source authentication required");
  requireHost(new Set(configuration.bindings.map(binding => binding.slot)).size === configuration.bindings.length,
    "Duplicate native AI owner");
  for (const binding of configuration.bindings) requireHost(Object.keys(binding).sort().join() ===
    "expectedRaw,generation,key,profile,raw,slot" && integer(binding.generation, Number.MAX_SAFE_INTEGER)
    && typeof binding.key === "string" && binding.key.length > 0 && binding.expectedRaw.length === 220
    && binding.expectedRaw.every(value => integer(value, 255)), "Invalid native AI constructor handshake");
}

export function initializeTransportHostNativeAiTasks(world: CampaignWorld, configuration: NativeAiTaskConfiguration): TriggerResult<CampaignWorld> {
  try {
    configuration = snapshotNativeTaskConfiguration(configuration);
    if (configuration.sourceId.startsWith("nativeactor-source-v2:")) configuration = retainSourceNativeTaskConfiguration(configuration);
    validateNativeAiTaskConfiguration(configuration);
    if (configuration.sourceId.startsWith("nativeactor-source-v2:")) validateSourceNativeWorld(configuration, world);
    const host = transportHostState(world), bytes = new Uint8Array(world.entityBytes!);
    validateNativeAiWorldAlignment(world, host);
    requireHost(host.tick === 0 && host.remainderMilliseconds === 0 && !host.nativeAiTasks,
      "Native constructor handshake requires a fresh host");
    for (const binding of configuration.bindings) {
      const actual = bytes.slice(binding.slot * 220, (binding.slot + 1) * 220);
      requireHost(binding.expectedRaw.every((value, index) => value === actual[index]), "Stale native constructor expected raw");
      const protectedOffsets = [0, 1, 2, 3, 4, 5, 6, 7, 12, 13, 14, 15, 0x2c, 0xcb];
      requireHost(protectedOffsets.every(index => actual[index] === binding.raw[index]) && actual[0x36] === 0,
        "Native constructor handshake cannot rewrite pose, HP, type, team, status or script order");
      const primitive = new Uint8Array(220);
      for (const index of protectedOffsets) primitive[index] = actual[index];
      primitive[0x38] = 255;
      primitive.set([254, 255, 254, 255], 0xd2);
      requireHost(actual.every((value, index) => value === primitive[index])
        || actual.every((value, index) => value === binding.raw[index]), "Native constructor handshake refuses non-initial task/FIN state");
      bytes.set(binding.raw, binding.slot * 220);
    }
    return configureTransportHostNativeAiTasks({ ...world, entityBytes: bytes }, configuration);
  } catch (error) { return failure(error); }
}

export function configureTransportHostNativeAiTasks(world: CampaignWorld, configuration: NativeAiTaskConfiguration): TriggerResult<CampaignWorld> {
  try {
    configuration = snapshotNativeTaskConfiguration(configuration);
    if (configuration.sourceId.startsWith("nativeactor-source-v2:")) configuration = retainSourceNativeTaskConfiguration(configuration);
    validateNativeAiTaskConfiguration(configuration);
    const state = transportHostState(world);
    validateNativeAiWorldAlignment(world, state);
    requireHost(!state.slots.some(actor => actor?.nativeConstruction), "CITY shared native task scheduler is unsupported");
    requireHost(!state.nativeAiTasks, "Native AI task owner already configured");
    requireHost(configuration.scope === "source-separated-bounded" && configuration.bindings.length > 0,
      "Explicit native AI task configuration required");
    for (const binding of configuration.bindings) {
      const actor = state.slots[binding.slot], profile = configuration.profiles[binding.profile];
      requireHost(actor && actor.key === binding.key && actor.generation === binding.generation && !actor.resourceTask && !actor.pendingNativeAi
        && state.registry[binding.slot] === actor.key && actor.status === 1
        && world.entities.some(entity => entity.rawSlot === binding.slot && entity.key === actor.key && entity.generation === actor.generation)
        && profile?.typeId === actor.unitType && binding.raw.length === 220
        && binding.raw.every((value, index) => value === world.entityBytes![binding.slot * 220 + index]),
      "Native AI task constructor/profile must match actual raw owner");
      requireHost(profile.width === state.width && profile.height === state.height, "Native AI map dimensions differ");
      actor.nativeAiTask = { profile: binding.profile, raw: [...binding.raw] };
      actor.task = "idle";
      actor.taskWords = [...decodeLegacyAiTaskStack(binding.raw).at(-1)!.words];
    }
    state.nativeAiTasks = { configuration: isImmutableSourceNativeTaskConfiguration(configuration) ? configuration : structuredClone(configuration), ground: [...configuration.profiles[0].ground],
      rngCursor: configuration.rngCursor, task6Budget: configuration.task6Budget, visits: 0 };
    validateNativeAiTaskAlignment(world, state);
    return { ok: true, value: save(structuredClone(world), state) };
  } catch (error) { return failure(error); }
}

function validateNativeAiWorldAlignment(world: CampaignWorld, state: TransportHostState): void {
  requireHost(world.entityBytes?.length === 800 * 220 && state.slots.length === 800
    && state.registry.length === 800 && state.generations.length === 800, "Native AI requires complete raw/host identity tables");
  const bytes = world.entityBytes, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entities = new Map<number, CampaignEntity>();
  for (const entity of world.entities) {
    requireHost(entity.rawSlot !== null && integer(entity.rawSlot, 799) && !entities.has(entity.rawSlot),
      "Native AI duplicate or missing world slot identity");
    entities.set(entity.rawSlot, entity);
  }
  for (let slot = 0; slot < 800; slot++) {
    const actor = state.slots[slot], entity = entities.get(slot), offset = slot * 220;
    if (!actor) {
      requireHost(!entity && state.registry[slot] === null && bytes[offset + 0x2c] === 0,
        `Native AI unregistered raw/world actor at slot ${slot}`);
      continue;
    }
    requireHost(actor.slot === slot && state.generations[slot] === actor.generation
      && state.registry[slot] === (actor.status === 0 ? null : actor.key)
      && (actor.status === 0 && !entity || entity && entity.key === actor.key && entity.generation === actor.generation
        && entity.unitType === actor.unitType && entity.team === actor.team && entity.health === actor.health
        && entity.tileX === actor.position.x >>> 8 && entity.tileY === actor.position.y >>> 8),
    `Native AI raw/host world identity conflict at slot ${slot}`);
    requireHost(view.getUint16(offset, true) === actor.position.x && view.getUint16(offset + 2, true) === actor.height
      && view.getUint16(offset + 4, true) === actor.position.y && view.getInt32(offset + 12, true) === actor.health
      && bytes[offset + 6] === actor.unitType && bytes[offset + 7] === actor.team
      && Number.isInteger(actor.status) && actor.status >= -128 && actor.status <= 255
      && view.getInt8(offset + 0x2c) === (actor.status << 24 >> 24),
    `Native AI raw/host protected pose conflict at slot ${slot}`);
    requireHost(!!actor.resource === !!entity?.resource && (!actor.resource || actor.unitType === 40 && actor.team === 8
      && actor.resource.rateWord === view.getUint16(offset + 0x32, true)
      && actor.resource.rateWord === entity!.resource!.rateWord
      && actor.resource.countdownWord === entity!.resource!.countdownWord
      && (actor.resourceTask || actor.resource.countdownWord === view.getUint16(offset + 0x46, true))),
    `Native AI raw/host resource conflict at slot ${slot}`);
  }
}

export function validateNativeAiTaskAlignment(world: CampaignWorld, state = transportHostState(world)): void {
  const owner = state.nativeAiTasks;
  if (state.nativeCombat) {
    validateSourceNativeCombatConfiguration(state.nativeCombat.configuration);
    validateSourceNativeCombatSoundState(state.nativeCombat);
    const visibility = state.nativeCombat.visibility, visibilitySource = state.nativeCombat.configuration.visibility;
    requireHost(!!visibility === !!visibilitySource, "Native visibility scope mismatch");
    if (visibilitySource) {
      validateSourceNativeVisibilityHostConfiguration(visibilitySource);
      requireHost(visibilitySource.taskSourceId === state.nativeCombat.configuration.taskSourceId
        && visibility!.sequence === visibility!.journal.length, "Native visibility owner sequence mismatch");
    }
    requireHost(owner?.configuration.sourceId === state.nativeCombat.configuration.taskSourceId
      && validLegacyNativeProjectileState(state.nativeCombat.projectiles), "Native combat task/pool ownership mismatch");
    const death = state.nativeCombat.death;
    requireHost(!!death === !!state.nativeCombat.configuration.death, "Native combat death scope mismatch");
    if (death) {
      requireHost(death.registry.length === 800 && death.registry.every((entry, slot) =>
        entry === (state.registry[slot] === null ? -1 : slot)), "Native death registry mismatch");
      requireHost(death.typeStatistics.length === 4400 && death.typeStatistics.every(value => Number.isInteger(value)
        && value >= -2147483648 && value <= 2147483647)
        && sourceNativeTaskValue(death.commanderSlots) === sourceNativeTaskValue(state.nativeCombat.configuration.death!.initial.commanderSlots),
      "Native death statistics/commander mismatch");
      requireHost(new Set(death.pending.map(entry => entry.slot)).size === death.pending.length,
        "Duplicate native death pending slot");
      for (const pending of death.pending) {
        const actor = state.slots[pending.slot], raw = actor?.nativeAiTask?.raw;
        requireHost(actor?.status === 10 && actor.health <= 0 && raw && raw[0x39] === 10
          && integer(pending.visits, 149) && integer(pending.startedAt, 0xffffffff)
          && integer(pending.lastCounter, 0xffffffff) && pending.lastCounter >= pending.startedAt
          && new DataView(Uint8Array.from(raw).buffer).getUint16(0x46, true) === pending.visits,
        "Native death pending/raw mismatch");
      }
    }
    requireHost(!state.resourceLifecycle && !state.productionExits?.length && !state.motions.length
      && !state.slots.some(actor => actor?.nativeConstruction || actor?.resourceTask), "Unowned shared combat scheduler");
  }
  if (!owner) {
    requireHost(!state.slots.some(actor => actor?.nativeAiTask), "Native AI task without source owner");
    return;
  }
  validateNativeAiTaskConfiguration(owner.configuration);
  validateNativeAiWorldAlignment(world, state);
  requireHost(!state.slots.some(actor => actor?.nativeConstruction), "CITY shared native task scheduler is unsupported");
  requireHost(integer(owner.rngCursor, 255) && integer(owner.visits, Number.MAX_SAFE_INTEGER), "Invalid native AI owner cursor/visits");
  requireHost(owner.ground.length === state.width * state.height && state.slots.every(actor => !actor?.nativeAiTask
    || owner.configuration.bindings.some(binding => binding.slot === actor.slot)), "Unconfigured native AI actor/plane");
  for (const [cell, word] of owner.ground.entries()) {
    const nativeSlot = word & 1023, actual = state.ground[cell] === -1 ? 1023 : state.ground[cell];
    const stationary = state.slots[nativeSlot];
    const reservation = state.productionExits?.some(exit => exit.tile.y * state.width + exit.tile.x === cell
      && definition(state, exit.unitType).plane === "ground");
    requireHost(nativeSlot === actual || (nativeSlot === 1023 && actual === 1022 && reservation)
      || (nativeSlot === 1022 && actual === 1023 && !reservation)
      || (nativeSlot < 152 && actual === 1023 && !state.groundEligible[cell]
      && stationary?.status === 1) || (actual === 1023 && stationary?.status === 1
      && state.definitions.some(entry => entry.unitType === stationary.unitType && entry.movementSpeed === 0)
      && (stationary.position.y >>> 8) * state.width + (stationary.position.x >>> 8) === cell),
    `Native AI actual ground alignment at cell ${cell}`);
    requireHost((owner.configuration.profiles[0].air[cell] & 1023) === (state.flying[cell] === -1 ? 1023 : state.flying[cell]),
      "Native AI actual air alignment");
  }
  for (const binding of owner.configuration.bindings) {
    const actor = state.slots[binding.slot], task = actor?.nativeAiTask;
    const death = state.nativeCombat?.death;
    const ownedDeath = actor && death && actor.health <= 0 && actor.task === "death"
      && (actor.status === 10 ? death.pending.some(entry => entry.slot === actor.slot)
        : actor.status === 0 && death.registry[actor.slot] === -1 && !death.pending.some(entry => entry.slot === actor.slot)
          && task?.raw[0x38] === 0 && task.raw[0x39] === 10 && task.raw[0x3a] === 0 && task.raw[0x3c] === 2
          && new DataView(Uint8Array.from(task.raw).buffer).getUint16(0x46, true) === 150);
    requireHost(actor && task && actor.key === binding.key && actor.generation === binding.generation && (actor.status === 1 || ownedDeath)
      && state.registry[actor.slot] === (actor.status === 0 ? null : actor.key) && task.profile === binding.profile && !actor.resourceTask
      && task.raw.length === 220 && task.raw.every((value, index) => value === world.entityBytes![actor.slot * 220 + index]),
    "Native AI raw/identity owner conflict");
    const view = new DataView(Uint8Array.from(task.raw).buffer);
    requireHost(actor.position.x === view.getUint16(0, true) && actor.position.y === view.getUint16(4, true)
      && actor.health === view.getInt32(12, true) && actor.unitType === task.raw[6] && actor.team === task.raw[7],
    "Native AI protected actor pose conflict");
    requireHost(!actor.pendingNativeAi || task.raw[0x36] === 1, "Native AI pending receipt/raw mismatch");
  }
}

export function initializeTransportHostNativeCombat(world: CampaignWorld,
  configuration: SourceNativeCombatConfiguration): TriggerResult<CampaignWorld> {
  try {
    const state = transportHostState(world);
    requireHost(state.tick === 0 && !state.nativeCombat && !!state.nativeAiTasks, "Fresh native task owner required for combat");
    state.nativeCombat = createSourceNativeCombatOwner(configuration);
    validateNativeAiTaskAlignment(world, state);
    return { ok: true, value: save(structuredClone(world), state) };
  } catch (error) { return failure(error); }
}

export function stepTransportHostVisibility(world: CampaignWorld, frame: SourceNativeVisibilityFrame):
  TriggerResult<{ world: CampaignWorld; event: SourceNativeVisibilityEvent }> {
  try {
    const staged = cloneTransportHostWorld(world), state = staged.transportState as TransportHostState;
    validateNativeAiTaskAlignment(staged, state);
    const result = stageSourceNativeVisibility(staged, state, frame);
    validateNativeAiTaskAlignment(result.world, state);
    return { ok: true, value: { world: save(result.world, state), event: result.event } };
  } catch (error) { return failure(error); }
}

export function transportHostDefinition(stat: LegacyUnitStat, plane: HostDefinition["plane"]): HostDefinition {
  return { unitType: stat.index, health: stat.health, movementSpeed: stat.movementSpeed, plane };
}

function requireHost(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const integer = (value: number, maximum: number): boolean => Number.isInteger(value) && value >= 0 && value <= maximum;

function failure<Value>(error: unknown): TriggerResult<Value> {
  return { ok: false, diagnostics: [{ code: "invalid-input", message: error instanceof Error ? error.message : String(error) }] };
}

function publicTransportHostState(world: CampaignWorld): TransportHostState {
  const state = world.transportState as TransportHostState | null;
  requireHost(state?.kind === "transport-host-v1", "Transport host has not been initialized");
  const cloned = structuredClone(state);
  for (const entity of cloned.slots) if (entity?.resourceTask) entity.taskWords = entity.resourceTask.stack.at(-1)!.words;
  return cloned;
}

export { publicTransportHostState as transportHostState };

function transportHostState(world: CampaignWorld): TransportHostState {
  const state = world.transportState as TransportHostState | null;
  requireHost(state?.kind === "transport-host-v1", "Transport host has not been initialized");
  let configuration = state.nativeAiTasks?.configuration;
  if (configuration && !isImmutableSourceNativeTaskConfiguration(configuration)) {
    configuration = snapshotNativeTaskConfiguration(configuration);
    if (configuration.sourceId.startsWith("nativeactor-source-v2:")) configuration = retainSourceNativeTaskConfiguration(configuration);
  }
  if (!configuration || !isImmutableSourceNativeTaskConfiguration(configuration)) return publicTransportHostState(world);
  const combatConfiguration = state.nativeCombat && retainSourceNativeCombatConfiguration(state.nativeCombat.configuration);
  const cloned = structuredClone({ ...state, nativeAiTasks: { ...state.nativeAiTasks!, configuration: undefined },
    ...(state.nativeCombat ? { nativeCombat: { ...state.nativeCombat, configuration: undefined } } : {}) });
  const { nativeCombat: clonedCombat, ...withoutCombat } = cloned;
  const retained: TransportHostState = { ...withoutCombat, nativeAiTasks: { ...cloned.nativeAiTasks, configuration },
    ...(combatConfiguration ? { nativeCombat: { ...clonedCombat!, configuration: combatConfiguration } } : {}) };
  for (const entity of retained.slots) if (entity?.resourceTask) entity.taskWords = entity.resourceTask.stack.at(-1)!.words;
  return retained;
}

export function cloneTransportHostWorld(world: CampaignWorld): CampaignWorld {
  if ((world.transportState as TransportHostState | null)?.kind !== "transport-host-v1") return structuredClone(world);
  const transportState = transportHostState(world);
  return { ...structuredClone({ ...world, transportState: undefined }), transportState };
}

function definition(state: TransportHostState, unitType: number): HostDefinition {
  const found = state.definitions.find((entry) => entry.unitType === unitType);
  requireHost(found, `Missing source definition for type ${unitType}`);
  return found;
}

function cellIndex(state: TransportHostState, tile: TransportPosition): number | null {
  return integer(tile.x, state.width - 1) && integer(tile.y, state.height - 1) ? tile.y * state.width + tile.x : null;
}

function vacant(state: TransportHostState, tile: TransportPosition, plane: HostDefinition["plane"]): boolean {
  const index = cellIndex(state, tile);
  return index !== null && state[plane][index] === -1 && (plane === "flying" || state.groundEligible[index]);
}

function sourceDeliveryVacant(state: TransportHostState, tile: TransportPosition, plane: HostDefinition["plane"],
  world?: CampaignWorld): boolean {
  if (!vacant(state, tile, plane)) return false;
  if (plane !== "ground" || world?.browserCasualtyPickup?.runtimeProfile !== "browser-adapted") return true;
  return !state.slots.some(actor => {
    if (!actor || actor.status === 0 || actor.status === 10 || actor.health <= 0
      || state.registry[actor.slot] !== actor.key || (actor.team === 8 && !actor.resource)
      || actor.unitType === 45 || actor.unitType === 46) return false;
    const stat = state.definitions.find(candidate => candidate.unitType === actor.unitType);
    if (!actor.resource && (!stat || stat.movementSpeed !== 0 || stat.plane !== "ground")) return false;
    const occupied = native256ToTile(actor.position);
    return occupied.x === tile.x && occupied.y === tile.y;
  });
}

export function findTransportPosition(
  state: TransportHostState, origin: TransportPosition, plane: HostDefinition["plane"],
): TransportPosition | null {
  return findSourceDeliveryTile(state, origin, plane);
}

function findSourceDeliveryTile(
  state: TransportHostState, origin: TransportPosition, plane: HostDefinition["plane"], world?: CampaignWorld,
): TransportPosition | null {
  for (let radius = 0; radius < Math.max(state.width, state.height); radius += 1) {
    for (let tileX = origin.x - radius; tileX <= origin.x + radius; tileX += 1) {
      for (let tileY = origin.y - radius; tileY <= origin.y + radius; tileY += 1) {
        const tile = { x: tileX, y: tileY };
        if (sourceDeliveryVacant(state, tile, plane, world)) return tileToNative256(tile);
      }
    }
  }
  return null;
}

function clearCollision(state: TransportHostState, slot: number): void {
  for (const plane of [state.ground, state.flying]) {
    for (let index = 0; index < plane.length; index += 1) if (plane[index] === slot) plane[index] = -1;
  }
}

function occupy(state: TransportHostState, entity: HostSlot): void {
  const plane = definition(state, entity.unitType).plane;
  const tile = native256ToTile(entity.position);
  requireHost(vacant(state, tile, plane), `Occupied or ineligible ${plane} cell ${tile.x},${tile.y}`);
  state[plane][cellIndex(state, tile)!] = entity.slot;
}

function save(world: CampaignWorld, state: TransportHostState): CampaignWorld {
  const bytes = new Uint8Array(world.entityBytes!);
  const view = new DataView(bytes.buffer);
  const previous = world.transportState as TransportHostState | null;
  for (const entity of state.slots) {
    if (!entity) continue;
    const offset = entity.slot * 220;
    if (entity.nativeAiTask) {
      bytes.set(entity.nativeAiTask.raw, offset);
      continue;
    }
    const prior = previous?.slots[entity.slot];
    const initialized = previous && prior?.generation !== entity.generation;
    if (initialized) {
      bytes.fill(0, offset, offset + 220);
      view.setInt32(offset + 0x0c, entity.health, true);
      bytes[offset + 0x38] = 255;
      view.setInt16(offset + 0xd2, -2, true);
      view.setInt16(offset + 0xd4, -2, true);
    }
    view.setUint16(offset, entity.position.x, true);
    view.setUint16(offset + 2, entity.height, true);
    view.setUint16(offset + 4, entity.position.y, true);
    bytes[offset + 6] = entity.unitType;
    bytes[offset + 7] = entity.team;
    bytes[offset + 0x2c] = entity.status;
    if (state.browserCasualties?.some(entry => entry.slot === entity.slot && entry.generation === entity.generation)) {
      view.setInt32(offset + 0x0c, entity.health, true);
    }
    if (entity.resource) {
      requireHost(entity.unitType === 40 && entity.team === 8, "Invalid resource source binding");
      view.setInt32(offset + 0x0c, entity.health, true);
      view.setUint16(offset + 0x32, entity.resource.rateWord, true);
      if (!entity.resourceTask) {
        bytes[offset + 0x38] = 0;
        bytes[offset + 0x39] = 1;
        view.setUint16(offset + 0x46, entity.resource.countdownWord, true);
      }
    }
    if (entity.resourceTask) {
      const task = entity.resourceTask;
      if (task.nativeMovement) {
        bytes.set(task.nativeMovement.state.raw, offset);
        continue;
      }
      if (task.nativeBanks?.[task.animation.profile]) view.setUint32(offset + 0x14, task.nativeBanks[task.animation.profile], true);
      view.setInt32(offset + 0x0c, entity.health, true);
      bytes[offset + 9] = task.direction;
      bytes[offset + 0x18] = task.animation.frame;
      bytes[offset + 0x19] = task.animation.delay;
      bytes[offset + 0x1a] = task.animation.mode;
      bytes[offset + 0x36] = task.pendingOrder;
      bytes[offset + 0x37] = task.order;
      if (task.nativeIdle) {
        bytes[offset + 0x35] = task.nativeIdle.observer;
        bytes[offset + 0xcb] = task.nativeIdle.specialOrder;
        bytes[offset + 0xd0] = task.nativeIdle.confusion;
        bytes[offset + 0xc7] = task.nativeIdle.secondaryAnimationPending;
        requireHost(task.nativeIdle.secondaryAnimationsInactive, "Resource idle cannot publish active auxiliary animation");
        bytes[offset + 0x22] = 2;
        bytes[offset + 0x2a] = 2;
      }
      bytes[offset + 0x38] = task.stack.length - 1;
      let payload = 0;
      for (const [depth, entry] of task.stack.entries()) {
        bytes[offset + 0x39 + depth * 2] = entry.opcode;
        bytes[offset + 0x3a + depth * 2] = payload;
        for (const value of entry.words) view.setUint16(offset + 0x46 + payload++ * 2, value, true);
      }
      bytes[offset + 0x3a + task.stack.length * 2] = payload;
      if (entity.status === 10 || entity.status === 0) bytes[offset + 0x13] = 0;
    }
    if (!entity.resourceTask && entity.task === "removal" && previous && (prior?.status !== 10 || initialized)) {
      bytes[offset + 0x13] = 0;
      bytes[offset + 0x38] = 0;
      bytes[offset + 0x39] = 10;
      bytes[offset + 0x3a] = 0;
      bytes[offset + 0x3c] = 2;
      view.setUint16(offset + 0x46, 1, true);
      view.setUint16(offset + 0x48, 0, true);
    }
  }
  return { ...world, entityBytes: bytes, transportState: state };
}

export function initializeTransportHost(world: CampaignWorld, options: TransportHostOptions): TriggerResult<CampaignWorld> {
  try {
    requireHost(world.transportState === null, "Refusing to replace existing transport state");
    requireHost(world.entityBytes?.length === 800 * 220, "All 800 native entity slots are required");
    requireHost(integer(options.width, 256) && options.width > 0 && integer(options.height, 256) && options.height > 0,
      "Map dimensions must be 1..256");
    requireHost(options.groundEligible.length === options.width * options.height && options.groundEligible.every((entry) => typeof entry === "boolean"), "Invalid ground eligibility");
    requireHost(Number.isFinite(options.fixedStepMilliseconds) && options.fixedStepMilliseconds > 0 &&
      Number.isSafeInteger(options.orientationSteps) && options.orientationSteps > 0, "Explicit browser cadence is required");
    requireHost(integer(options.highWater, 799) && options.highWater >= 152, "Native high-water count must be 152..799");
    requireHost(options.sides.length === 8 && options.sides.every((entry) => integer(entry, 255)), "Eight source side fields required");
    requireHost(options.directionBits.every((pair) => pair.length === 2 && pair.every((bit) => bit === 0 || bit === 1)), "Invalid direction bit stream");
    requireHost(new Set(options.definitions.map((entry) => entry.unitType)).size === options.definitions.length, "Duplicate definitions");
    for (const entry of options.definitions) requireHost(integer(entry.unitType, 109) && Number.isSafeInteger(entry.health) && entry.health > 0 &&
      integer(entry.movementSpeed, 0xffffffff) && (entry.plane === "ground" || entry.plane === "flying"), "Invalid source definition");
    const state: TransportHostState = {
      kind: "transport-host-v1", reducer: createTransportState(), slots: Array(800).fill(null), registry: Array(800).fill(null),
      generations: Array(800).fill(-1), highWater: options.highWater, width: options.width, height: options.height,
      groundEligible: [...options.groundEligible], ground: Array(options.width * options.height).fill(-1),
      resourceTileFlags: Array(options.width * options.height).fill(0),
      flying: Array(options.width * options.height).fill(-1), definitions: structuredClone([...options.definitions]),
      sides: [...options.sides], directionBits: structuredClone([...options.directionBits]), directionCursor: 0,
      fixedStepMilliseconds: options.fixedStepMilliseconds, orientationSteps: options.orientationSteps, tick: 0,
      remainderMilliseconds: 0, motions: [], fifos: structuredClone((options.fifos ?? []).map((entry) => ({ tile: entry.tile, types: [...entry.types] }))),
      receipts: [], requests: [],
    };
    for (const fifo of state.fifos) requireHost(cellIndex(state, fifo.tile) !== null && fifo.types.length <= 10 &&
      fifo.types.every((unitType) => integer(unitType, 109)), "Invalid coordinate FIFO");
    requireHost(new Set(state.fifos.map(({ tile }) => `${tile.x},${tile.y}`)).size === state.fifos.length, "Duplicate coordinate FIFO");
    const view = new DataView(world.entityBytes.buffer, world.entityBytes.byteOffset, world.entityBytes.byteLength);
    for (const entity of world.entities) {
      const slot = entity.rawSlot;
      requireHost(slot !== null && integer(slot, 799) && !state.slots[slot], `Missing or duplicate native binding for ${entity.key}`);
      const offset = slot * 220;
      requireHost(world.entityBytes[offset + 6] === entity.unitType && world.entityBytes[offset + 7] === entity.team,
        `Native binding mismatch for ${entity.key}`);
      requireHost(slot < state.highWater, `Slot ${slot} is outside the native high-water count`);
      if (entity.resource) requireHost(entity.unitType === 40 && entity.team === 8, "Invalid special resource binding");
      else {
        requireHost(entity.team < 8 && entity.unitType !== 40, "Neutral placement requires the special resource path");
        definition(state, entity.unitType);
      }
      const status = world.entityBytes[offset + 0x2c];
      const record: HostSlot = { slot, generation: entity.generation, key: entity.key, team: entity.team, unitType: entity.unitType,
        status, health: entity.health, position: { x: view.getUint16(offset, true), y: view.getUint16(offset + 4, true) },
        height: view.getUint16(offset + 2, true), task: status === 10 ? "removal" : "unit", taskWords: status === 10 ? [1, 0] : [] };
      if (entity.resource) {
        record.resource = { ...entity.resource };
        record.task = "idle";
        record.taskWords = [entity.resource.countdownWord];
        const index = cellIndex(state, native256ToTile(record.position));
        requireHost(index !== null, "Resource source outside map");
        state.resourceTileFlags[index] |= 0x04000000;
      }
      state.slots[slot] = record;
      state.generations[slot] = entity.generation;
      state.registry[slot] = status === 0 ? null : entity.key;
      if (status !== 0 && status !== 10 && !entity.resource) occupy(state, record);
    }
    for (let slot = 0; slot < 800; slot += 1) requireHost(world.entityBytes[slot * 220 + 0x2c] === 0 || state.slots[slot],
      `Active native slot ${slot} has no registered world entity`);
    const initialized = save(structuredClone(world), state);
    return options.resourceLifecycle ? configureCampaignResourceLifecycle(initialized, options.resourceLifecycle)
      : { ok: true, value: initialized };
  } catch (error) { return failure(error); }
}

function createUnit(world: CampaignWorld, state: TransportHostState, team: number, unitType: number, requested: TransportPosition): CampaignWorld {
  requireHost(integer(team, 7), "Invalid payload team");
  validateSourceNativeAllocation(state, unitType, team);
  const stat = definition(state, unitType);
  requireHost(unitType !== 40, "Type 40 bypasses native placement; its collision initialization is not supported");
  const position = findSourceDeliveryTile(state, native256ToTile(requested), stat.plane, world);
  requireHost(position, "No eligible creation position");
  return allocateUnitAtPosition(world, state, team, unitType, position);
}

function allocateUnitAtPosition(world: CampaignWorld, state: TransportHostState, team: number, unitType: number,
  position: TransportPosition): CampaignWorld {
  validateSourceNativeAllocation(state, unitType, team);
  requireHost(!state.nativeAiTasks || isAuthenticatedSourceNativeTaskConfiguration(state.nativeAiTasks.configuration),
    "native-ai-occupancy-owner-required: actor allocation is unsupported with native AI tasks");
  const stat = definition(state, unitType);
  let slot = -1;
  for (let candidate = 152; candidate < state.highWater; candidate += 1) {
    if (!state.slots[candidate] || state.slots[candidate]!.status === 0) slot = candidate;
  }
  if (slot === -1) {
    requireHost(state.highWater + 1 < 800, "Native allocator high-water assertion (800)");
    slot = state.highWater++;
  }
  clearCollision(state, slot);
  const generation = ++state.generations[slot];
  const key = `transport:${slot}:${generation}`;
  const record: HostSlot = { slot, generation, key, team, unitType, status: 1, health: stat.health, position,
    height: 0, task: "unit", taskWords: [] };
  state.slots[slot] = record;
  state.registry[slot] = key;
  if (state.nativeCombat?.death) {
    const death = state.nativeCombat.death;
    requireHost(!death.pending.some(entry => entry.slot === slot), "Cannot reuse a pending native death");
    state.nativeCombat.death = { ...death, registry: death.registry.map((entry, index) => index === slot ? slot : entry) };
  }
  occupy(state, record);
  if (state.nativeAiTasks) {
    const owner = state.nativeAiTasks;
    owner.configuration = extendSourceNativeTaskConfiguration(owner.configuration, record);
    const binding = owner.configuration.bindings.find(binding => binding.slot === slot)!;
    record.nativeAiTask = { profile: binding.profile, raw: [...binding.raw] };
    record.task = "idle";
    record.taskWords = [...decodeLegacyAiTaskStack(binding.raw).at(-1)!.words];
    const cell = (position.y >>> 8) * state.width + (position.x >>> 8);
    requireHost([1022, 1023].includes(owner.ground[cell] & 1023), "native-ai-occupancy-owner-required: occupied native allocation cell");
    owner.ground[cell] = ((owner.ground[cell] & ~1023) | slot) >>> 0;
  }
  const tile = native256ToTile(position);
  const entity: CampaignEntity = { key, generation, sourceRow: null, team, unitType, tileX: tile.x, tileY: tile.y,
    rawTail: [], health: stat.health, maxHealth: stat.health, rawSlot: slot, simulationId: null };
  state.requests.push({ type: "create", slot, generation, team, unitType, position: { ...position } });
  return { ...world, entities: [...world.entities.filter((entry) => entry.rawSlot !== slot), entity] };
}

function validateSourceNativeAllocation(state: TransportHostState, unitType: number, team: number): void {
  const configuration = state.nativeAiTasks?.configuration;
  if (!configuration || !isAuthenticatedSourceNativeTaskConfiguration(configuration)) return;
  requireHost(!state.nativeCombat?.death || ![69, 73].includes(unitType), "Native death commander allocation is unsupported");
  requireHost(integer(team, 7) && [0, 8, 69, 73, 2, 3].includes(unitType)
    && definition(state, unitType).plane === "ground"
    && configuration.profiles.some(profile => profile.typeId === unitType && profile.enemyMask === 0x40000000 >>> team),
  "native-ai-occupancy-owner-required: unsupported source native allocation type/team/plane");
}

function productionExit(state: TransportHostState, world: CampaignWorld, request: ProductionExitReservation) {
  requireHost(!state.nativeCombat, "Production/combat shared scheduler is unsupported");
  validateSourceNativeAllocation(state, request.unitType, request.team);
  requireHost(integer(request.team, 7) && integer(request.queue, 3) && request.ticket.length > 0
    && request.key === JSON.stringify([world.sessionId, request.team, request.queue, request.ticket]), "Invalid production reservation identity");
  const stat = definition(state, request.unitType);
  requireHost(request.unitType !== 40, "Unsupported production type");
  const index = cellIndex(state, request.tile);
  requireHost(index !== null && (stat.plane === "flying" || state.groundEligible[index]), "Invalid or ineligible production exit");
  const reservations = state.productionExits ?? [];
  const owner = reservations.find((entry) => entry.key === request.key);
  requireHost(!owner || (owner.team === request.team && owner.queue === request.queue && owner.ticket === request.ticket
    && owner.unitType === request.unitType && owner.tile.x === request.tile.x && owner.tile.y === request.tile.y), "Production reservation identity mismatch");
  requireHost(!reservations.some((entry) => entry.key !== request.key && entry.tile.x === request.tile.x
    && entry.tile.y === request.tile.y && definition(state, entry.unitType).plane === stat.plane), "Production exit owned by another queue");
  const occupant = state[stat.plane][index];
  const incumbent = state.slots[occupant];
  const adapted = world.browserCasualtyPickup?.runtimeProfile === "browser-adapted"
    && !state.nativeCombat && !state.nativeAiTasks && !state.resourceLifecycle;
  const occupied = Boolean(owner && adapted && incumbent && incumbent.status !== 0 && incumbent.status !== 10 && incumbent.health > 0
    && state.registry[incumbent.slot] === incumbent.key && definition(state, incumbent.unitType).plane === stat.plane
    && cellIndex(state, native256ToTile(incumbent.position)) === index);
  requireHost(owner ? occupant === 1022 || occupied : occupant === -1, "Occupied or unowned production exit");
  const blocked = occupied || Boolean(adapted && state.slots.some(actor => {
    if (!actor || actor.team === 8 || actor.status === 0 || actor.status === 10 || actor.health <= 0
      || state.registry[actor.slot] !== actor.key) return false;
    const actorDefinition = definition(state, actor.unitType);
    if (actorDefinition.plane !== stat.plane || actorDefinition.movementSpeed === 0) return false;
    const centerX = (actor.position.x - 128) / 256, centerY = (actor.position.y - 128) / 256;
    return request.tile.x >= Math.floor(centerX) && request.tile.x <= Math.ceil(centerX)
      && request.tile.y >= Math.floor(centerY) && request.tile.y <= Math.ceil(centerY);
  }));
  return { index, plane: stat.plane, owner, blocked };
}

export function transportProductionExitBlocked(world: CampaignWorld, request: ProductionExitReservation): boolean {
  return productionExit(transportHostState(world), world, request).blocked;
}

export function reserveTransportProductionExit(world: CampaignWorld, request: ProductionExitReservation): TriggerResult<CampaignWorld> {
  try {
    const state = transportHostState(world);
    validateNativeAiTaskAlignment(world, state);
    const { index, plane, owner } = productionExit(state, world, request);
    requireHost(!state.nativeAiTasks || plane === "ground", "native-ai-occupancy-owner-required: native air reservations are unsupported");
    if (!owner) {
      (state.productionExits ??= []).push(structuredClone(request));
      state[plane][index] = 1022;
    }
    return { ok: true, value: save(world, state) };
  } catch (error) { return failure(error); }
}

export function allocateTransportProductionExit(world: CampaignWorld, request: ProductionExitReservation): TriggerResult<CampaignWorld> {
  try {
    const state = transportHostState(world);
    validateNativeAiTaskAlignment(world, state);
    requireHost(!state.nativeAiTasks || isAuthenticatedSourceNativeTaskConfiguration(state.nativeAiTasks.configuration),
      "native-ai-occupancy-owner-required: production allocation is unsupported with native AI tasks");
    const { index, plane, owner, blocked } = productionExit(state, world, request);
    requireHost(!blocked, "Production exit is occupied; allocation must wait");
    if (owner) state[plane][index] = -1;
    const staged = allocateUnitAtPosition(world, state, request.team, request.unitType, tileToNative256(request.tile));
    if (owner) state.productionExits = state.productionExits!.filter((entry) => entry.key !== request.key);
    const published = save(staged, state);
    validateNativeAiTaskAlignment(published, state);
    return { ok: true, value: published };
  } catch (error) { return failure(error); }
}

function commander(state: TransportHostState, slot: number) {
  const target = state.slots[slot];
  requireHost(target, `Unresolved commander slot ${slot}`);
  return { slot, status: target.status, position: { ...target.position } };
}

function dispatch(world: CampaignWorld, state: TransportHostState, command: TransportCommand): CampaignWorld {
  requireHost(!state.nativeAiTasks, "native-ai-occupancy-owner-required: carrier dispatch is unsupported with native AI tasks");
  const result = reduceTransport(state.reducer, command);
  state.reducer = result.state;
  let staged = world;
  for (const effect of result.effects) {
    if (effect.type === "diagnostic") throw new Error(`Transport ${effect.code}`);
    if (effect.type === "initialize-carrier") {
      const carrier = effect.carrier;
      const prior = state.slots[carrier.slot];
      requireHost(!prior || prior.task === "idle" || prior.status === 0, `Reserved carrier slot ${carrier.slot} is occupied`);
      const stat = definition(state, carrier.type);
      requireHost(stat.movementSpeed > 0, "Carrier source movement speed must be positive");
      clearCollision(state, carrier.slot);
      const generation = ++state.generations[carrier.slot];
      const key = `carrier:${carrier.slot}:${generation}`;
      state.slots[carrier.slot] = { slot: carrier.slot, generation, key, team: 8, unitType: carrier.type, status: 1,
        health: stat.health, position: carrier.position, height: carrier.height, task: "transport", taskWords: [] };
      state.registry[carrier.slot] = key;
    } else {
      staged = executeEffect(staged, state, effect);
    }
  }
  if (result.redispatch && "id" in command) staged = dispatch(staged, state, { type: "invoke", id: command.id });
  return staged;
}

function executeEffect(world: CampaignWorld, state: TransportHostState, effect: Exclude<TransportEffect, { type: "initialize-carrier" } | { type: "diagnostic" }>): CampaignWorld {
  const carrier = state.reducer.carriers.find((entry) => entry.id === effect.id)!;
  const entity = state.slots[carrier.slot]!;
  switch (effect.type) {
    case "height": entity.height = effect.height; break;
    case "orient":
    case "move":
      state.motions = state.motions.filter((entry) => entry.id !== effect.id);
      state.motions.push({ id: effect.id, kind: effect.type === "orient" ? "orientation" : "movement",
        destination: { ...effect.destination }, origin: { ...entity.position }, progress: 0 });
      break;
    case "inspect-occupancy": {
      const tile = native256ToTile(effect.position);
      const index = cellIndex(state, tile);
      const available = world.browserCasualtyPickup?.runtimeProfile === "browser-adapted"
        ? sourceDeliveryVacant(state, tile, "ground", world) : index !== null && state.ground[index] === -1;
      return dispatch(world, state, { type: "occupancy", id: effect.id, vacant: available });
    }
    case "create-unit": {
      const next = createUnit(world, state, effect.team, effect.unitType, effect.position);
      return dispatch(next, state, { type: "created", id: effect.id, success: true });
    }
    case "select-position": {
      const position = findSourceDeliveryTile(state, effect.originTile, "ground", world);
      requireHost(position, "No ground destination; cargo retained");
      return dispatch(world, state, { type: "next-position", id: effect.id, position });
    }
    case "inspect-commander": {
      const casualty = state.browserCasualties?.find(entry => entry.carrierId === effect.id && !entry.collected);
      const target = commander(state, effect.slot);
      if (casualty) {
        const actor = state.slots[effect.slot]!;
        requireHost(actor.generation === casualty.generation && actor.health === 0 && actor.status === 10
          && state.registry[effect.slot] === actor.key, "Casualty pickup target changed before arrival");
      }
      return dispatch(world, state, { type: "commander", id: effect.id,
        commander: casualty ? { ...target, status: 1 } : target });
    }
    case "remove-noncombat": {
      const target = state.slots[effect.slot]!;
      const casualty = state.browserCasualties?.find(entry => entry.carrierId === effect.id && !entry.collected);
      if (casualty) {
        requireHost(target.generation === casualty.generation && target.health === 0 && target.status === 10,
          "Casualty pickup requires its retained dead actor");
        casualty.collected = true;
        target.status = 0;
        state.registry[target.slot] = null;
        state.requests.push({ type: "casualty-picked-up", slot: target.slot, generation: target.generation, carrierId: effect.id },
          { type: "unregister", slot: target.slot, generation: target.generation });
        return { ...world, entities: world.entities.filter(entry => entry.key !== target.key) };
      }
      target.status = 10;
      target.task = "removal";
      target.taskWords = [1, 0];
      state.requests.push({ type: "remove-noncombat", slot: effect.slot, generation: target.generation, task: 10, taskWords: [1, 0] });
      break;
    }
    case "clear-collision":
      clearCollision(state, effect.slot);
      state.requests.push({ type: "clear-collision", slot: effect.slot, generation: state.generations[effect.slot] });
      break;
    case "approach-complete": entity.position = { ...carrier.position }; break;
    case "carrier-released":
      entity.task = "idle";
      entity.taskWords = [effect.idleCount];
      break;
    case "descent-complete":
    case "ascent-complete": break;
  }
  return world;
}

function prepare(world: CampaignWorld, planned: PlannedMissionCommand): ReturnType<CampaignTransportAdapter["prepare"]> {
  try {
    const state = transportHostState(world);
    validateNativeAiTaskAlignment(world, state);
    const prior = state.receipts.find((entry) => entry.id === planned.id);
    const signature = JSON.stringify(planned.command);
    if (prior) {
      requireHost(prior.command === signature, "Command ID reused with different payload");
      return { ok: true, value: { world: cloneTransportHostWorld({ ...world, transportState: state }), disposition: prior.disposition } };
    }
    requireHost(!state.nativeAiTasks || (planned.command.kind === "reinforce2"
      && isAuthenticatedSourceNativeTaskConfiguration(state.nativeAiTasks.configuration)),
    "native-ai-occupancy-owner-required: transport commands are unsupported with native AI tasks");
    let staged = cloneTransportHostWorld({ ...world, transportState: state });
    const command = planned.command;
    requireHost(command.kind === "reinforce" || command.kind === "reinforce2" || command.kind === "abduct", "Not a transport command");
    let disposition: "scheduled" | "applied" = "scheduled";
    if (command.kind === "reinforce2" || command.kind === "reinforce") {
      requireHost(integer(command.team, 7) && integer(command.tileX, 255) && integer(command.tileY, 255), "Invalid reinforcement location/team");
      requireHost(command.groups.length > 0 && command.groups.length <= 5 && command.groups.every((group) =>
        integer(group.unitType, 109) && integer(group.count, 255)), "Invalid reinforcement groups");
      const tile = { x: command.tileX, y: command.tileY };
      requireHost(cellIndex(state, tile) !== null, "Reinforcement origin outside map");
      for (const group of command.groups) if (group.count > 0) {
        validateSourceNativeAllocation(state, group.unitType, command.team);
        definition(state, group.unitType);
        requireHost(group.unitType !== 40, "Unsupported type-40 placement");
      }
      if (command.kind === "reinforce2") {
        const fifo = state.fifos.find((entry) => entry.tile.x === tile.x && entry.tile.y === tile.y);
        for (const group of command.groups) for (let member = 0; member < group.count; member += 1) {
          if (fifo) {
            requireHost(fifo.types.length < 10, "Coordinate FIFO capacity exceeded");
            fifo.types.push(group.unitType);
          } else staged = createUnit(staged, state, command.team, group.unitType, tileToNative256(tile));
        }
        disposition = "applied";
      } else {
        const groups = Array.from({ length: 5 }, (_, index) => ({ type: command.groups[index]?.unitType ?? 0, count: command.groups[index]?.count ?? 0 })) as unknown as TransportGroups;
        const directionBits = state.directionBits[state.directionCursor];
        requireHost(directionBits, "Injected direction bit stream exhausted");
        staged = dispatch(staged, state, { type: "reinforce", team: command.team, side: state.sides[command.team], tile, groups, directionBits });
        state.directionCursor += 1;
      }
    } else if (command.kind === "abduct") {
      requireHost(integer(command.selectedSide, 7) && integer(command.carrierSide, 7), "Invalid abduction sides");
      const target = commander(state, world.commanderSlots[command.selectedSide]);
      requireHost(target.status !== 0 && target.status !== 10, "Inactive target must receive the campaign verified-inactive-target receipt");
      const directionBits = state.directionBits[state.directionCursor];
      requireHost(directionBits, "Injected direction bit stream exhausted");
      staged = dispatch(staged, state, { type: "abduct", team: command.carrierSide, side: state.sides[command.carrierSide], commander: target, directionBits });
      state.directionCursor += 1;
    }
    state.receipts.push({ id: planned.id, command: signature, disposition });
    const published = save(staged, state);
    validateNativeAiTaskAlignment(published, state);
    return { ok: true, value: { world: published, disposition } };
  } catch (error) { return failure(error); }
}

export function createTransportHostAdapter(): CampaignTransportAdapter { return { prepare }; }

export function prepareCampaignResourceRate(world: CampaignWorld,
  planned: Omit<PlannedMissionCommand, "command"> & { readonly command: CampaignResourceRateCommand },
): ReturnType<CampaignTransportAdapter["prepare"]> {
  try {
    const state = transportHostState(world);
    const command = planned.command;
    requireHost(planned.id.length > 0 && integer(command.rate, 255) && integer(command.tileX, state.width - 1) &&
      integer(command.tileY, state.height - 1), "newrate requires literal bytes and in-map coordinates");
    const signature = JSON.stringify(command);
    const prior = state.receipts.find(({ id }) => id === planned.id);
    if (prior) {
      requireHost(prior.command === signature, "Command ID reused with different payload");
      return { ok: true, value: { world: structuredClone(world), disposition: prior.disposition } };
    }
    requireHost(world.entityBytes?.length === 800 * 220, "newrate requires all 800 native slots");
    const bytes = world.entityBytes;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let targetSlot = -1;
    for (let slot = 0; slot < 800; slot += 1) {
      const offset = slot * 220;
      if (bytes[offset + 6] === 40 && bytes[offset + 0x2c] !== 0 &&
          (view.getUint16(offset, true) >>> 8) === command.tileX && (view.getUint16(offset + 4, true) >>> 8) === command.tileY) {
        targetSlot = slot;
        break;
      }
    }
    requireHost(targetSlot !== -1, "newrate missing target: native diagnostic 0x43dbc1");
    const record = state.slots[targetSlot];
    const entity = world.entities.find(({ rawSlot }) => rawSlot === targetSlot);
    requireHost(record?.resource && entity?.resource && record.key === entity.key && record.generation === entity.generation &&
      record.status === bytes[targetSlot * 220 + 0x2c] && record.resource.rateWord === view.getUint16(targetSlot * 220 + 0x32, true),
    "newrate target requires synchronized resource host state");
    const changed = changeLegacyResourceRate(record.resource.rateWord, command.rate, world.statistics["1,0"]);
    if (changed.activationSound) state.requests.push({ type: "source-sound", commandId: planned.id,
      slot: targetSlot, generation: record.generation, category: 1, event: 7, ebx: 0, ecx: 0, stackArgument: 0, spatial: false });
    record.resource.rateWord = changed.rateWord;
    state.receipts.push({ id: planned.id, command: signature, disposition: "applied" });
    const staged = { ...world, entities: world.entities.map((entry) => entry.rawSlot === targetSlot
      ? { ...entry, resource: { ...entry.resource!, rateWord: changed.rateWord } } : entry) };
    return { ok: true, value: { world: save(staged, state), disposition: "applied" } };
  } catch (error) { return failure(error); }
}

export function requestCampaignResourceExtraction(world: CampaignWorld,
  request: { readonly sourceSlot: number; readonly extractorSlot: number },
  frame?: ResourceHostFrame,
): TriggerResult<CampaignWorld> {
  try {
    const state = transportHostState(world);
    requireHost(state.resourceLifecycle && frame,
      "Resource extraction unsupported: deployment task 12 requires explicit resource profiles, entity task bindings and native phase frame through depletion");
    validateResourceFrame(frame);
    const source = state.slots[request.sourceSlot];
    const extractor = state.slots[request.extractorSlot];
    requireHost(source?.resource && source.resourceTask && source.status === 1 && extractor?.resourceTask &&
      (extractor.unitType === 6 || extractor.unitType === 14), "Extraction requires bound source idle and mobile extractor tasks");
    const index = cellIndex(state, native256ToTile(source.position));
    requireHost(index !== null && state.ground[index] === extractor.slot, "Extraction requires actual source ground occupancy");
    visitResourceSource(state, source, frame);
    return { ok: true, value: save(syncResourceEntities(structuredClone(world), state), state) };
  } catch (error) { return failure(error); }
}

function resourceType(state: TransportHostState, unitType: number): ResourceHostType {
  const profile = state.resourceLifecycle?.types.find((entry) => entry.unitType === unitType);
  requireHost(profile, `Missing native resource animation/type profile ${unitType}`);
  return profile;
}

function validateResourceFrame(frame: ResourceHostFrame): void {
  requireHost(integer(frame.nativePhaseCounter, 0xffffffff) && integer(frame.localTeam, 7) &&
    integer(frame.cancellationGate, 255), "Resource frame requires native +0x530, local team and +0x948 byte");
  requireHost(frame.sides.length === 8 && frame.sides.every((side) =>
    [side.aiField, side.aiMultiplier, side.creditGate].every((value) => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647)),
  "Resource frame requires eight explicit full32 AI fields, multipliers and credit gates");
}

export function configureCampaignResourceLifecycle(world: CampaignWorld, options: ResourceHostOptions): TriggerResult<CampaignWorld> {
  try {
    const state = transportHostState(world);
    requireHost(!state.resourceLifecycle, "Resource lifecycle already configured");
    requireHost(new Set(options.animations.map(({ id }) => id)).size === options.animations.length &&
      new Set(options.types.map(({ unitType }) => unitType)).size === options.types.length, "Duplicate resource profiles");
    for (const animation of options.animations) requireHost(animation.id.length > 0 && animation.directions.length === 32 &&
      animation.directions.every((delays) => delays.length > 0 && delays.length <= 255 && delays.every((delay) => integer(delay, 255))),
    "Resource animations require 32 source FIN direction timelines of delay bytes");
    state.resourceLifecycle = { animations: structuredClone([...options.animations]), types: structuredClone([...options.types]), nativePhaseCounter: null };
    if (options.nativeHarvest) {
      const config = options.nativeHarvest;
      requireHost(config.scope === "source-separated-bounded" && config.evidence.trim().length > 0
        && config.sourceMetadata.randomScope === "isolated-index-no-draws" && config.sourceMetadata.sharedRandomDraws === 0
        && config.sourceMetadata.executableSha256 === "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b"
        && config.profiles.every(profile => profile.pthSha256 === config.sourceMetadata.pthSha256)
        && new Set(config.bindings.map(binding => binding.slot)).size === config.bindings.length,
      "Explicit isolated native harvest scope and unique command slots required");
      state.resourceLifecycle.nativeHarvest = structuredClone(config);
    }
    for (const profile of options.types) {
      requireHost([6, 14, 40, 47, 48].includes(profile.unitType) && profile.deathVariants === 1 && profile.removalHoldField === 0 &&
        profile.selectedWeapon === -1, "Unsupported resource type: require source nonweapon/type+0x100=0/single death variant proof");
      for (const id of [profile.stand, profile.deploy, profile.death]) requireHost(options.animations.some((entry) => entry.id === id), `Missing FIN bank ${id}`);
      if (profile.preservedIdle !== undefined) requireHost(options.animations.some((entry) => entry.id === profile.preservedIdle), "Missing preserved idle FIN bank");
    }
    for (const binding of options.bindings) {
      bindResourceTask(state, binding);
    }
    if (options.nativeHarvest) {
      world = { ...world, entityBytes: new Uint8Array(world.entityBytes!) };
      for (const binding of options.nativeHarvest.bindings) {
        const entity = state.slots[binding.slot];
        requireHost(entity && entity.generation === binding.generation && !entity.resourceTask && entity.team < 8,
          "Invalid native harvest constructor binding");
        const profile = options.nativeHarvest.profiles.find(profile => profile.typeId === entity.unitType);
        requireHost(profile && profile.width === state.width && profile.height === state.height, "Missing sourced native movement profile");
        const idle = decodeLegacyHarvesterMovement(binding.raw, binding.slot, binding.randomIndex, [binding.groundWord]);
        requireHost(binding.provenance === "restored-idle" || (binding.provenance === "constructor"
          && idle.direction === (entity.unitType === 6 ? 160 : 128) && idle.stack.length === 1
          && JSON.stringify(idle.stack[0].words) === "[65535,0,0]" && idle.animation.frame === 0
          && idle.animation.delay === 0 && idle.animation.mode === 0 && idle.pending === 0 && idle.order === 0),
        "Explicit constructor or restored native idle provenance required");
        requireHost(idle.xQ8 === entity.position.x && idle.yQ8 === entity.position.y && idle.hp === entity.health
          && idle.typeId === entity.unitType && idle.team === entity.team && idle.status === entity.status,
        "Native constructor identity/position/health differs from source placement");
        const stem = entity.unitType === 6 ? "EXPL" : "SLUG";
        const nativeBanks = { [`${stem}STAND`]: profile.standBank, [`${stem}MOVE`]: profile.moveBank,
          [`${stem}FUNK`]: profile.preservedIdleBank };
        requireHost(idle.animation.bank === profile.standBank, "Native constructor FIN bank mismatch");
        const task: ResourceHostEntityState = { nativeBanks, direction: idle.direction,
          animation: { profile: `${stem}STAND`, frame: idle.animation.frame, delay: idle.animation.delay,
            mode: idle.animation.mode as LegacyResourceAnimation["mode"] }, pendingOrder: idle.pending, order: idle.order,
          released: false, stack: idle.stack.map(({ task, words }) => ({ opcode: task as 1 | 3, words: [...words] })),
          nativeIdle: { randomIndex: idle.randomIndex, observer: idle.observer, specialOrder: idle.specialOrder,
            confusion: idle.confusion, secondaryAnimationPending: idle.secondaryAnimationPending,
            secondaryAnimationsInactive: idle.secondaryAnimationsInactive, groundWord: binding.groundWord } };
        bindResourceTask(state, { ...binding, state: task });
        world.entityBytes!.set(binding.raw, binding.slot * 220);
      }
    }
    for (const entity of state.slots) if (entity?.resource && entity.status !== 0) requireHost(entity.resourceTask, `Unbound source task ${entity.slot}`);
    return { ok: true, value: save(structuredClone(world), state) };
  } catch (error) { return failure(error); }
}

export function commandNativeHarvest(world: CampaignWorld, command: NativeHarvestCommand): TriggerResult<CampaignWorld> {
  try {
    const host = transportHostState(world), config = host.resourceLifecycle?.nativeHarvest;
    const entity = host.slots[command.slot], task = entity?.resourceTask;
    requireHost(config && entity && task && entity.generation === command.generation && entity.status === 1
      && config.bindings.some(binding => binding.slot === entity.slot && binding.generation === entity.generation),
    "Harvester has no explicit bounded native command owner");
    if (command.type === "stop") {
      if (task.nativeMovement) {
        const result = queueLegacyHarvesterMovementStop(task.nativeMovement.state, task.nativeMovement.world);
        requireHost(result.supported, result.supported ? "" : result.diagnostic);
        task.nativeMovement.state = result.state;
        task.nativeStopRequested = true;
      } else {
        requireHost(!task.released, "Harvester is already stopped");
        task.pendingOrder = 1; task.order = 13;
      }
    } else {
      requireHost(!task.nativeMovement && entity.task === "idle" && task.nativeIdle && task.pendingOrder === 0,
        "Harvester must reach its native idle/wait point before another move");
      requireHost(!host.slots.some(record => record?.resourceTask?.nativeMovement), "Only one bounded native route may run at a time");
      const template = config.profiles.find(profile => profile.typeId === entity.unitType);
      requireHost(template, "Missing source native harvester profile");
      const origin = [entity.position.x >> 8, entity.position.y >> 8];
      const target = [command.target.x, command.target.y];
      const delta = target.map((value, axis) => value - origin[axis]);
      const count = Math.max(...delta.map(Math.abs));
      requireHost(target.every(value => Number.isInteger(value)) && count >= 1 && count <= 3
        && (delta[0] === 0 || delta[1] === 0 || Math.abs(delta[0]) === Math.abs(delta[1])),
      "Only clear straight native routes of 1-3 cells are verified; far or multi-leg route blocked");
      if (command.type === "harvest") {
        const source = command.sourceSlot === undefined ? undefined : host.slots[command.sourceSlot];
        requireHost(source?.resource && source.unitType === 40 && source.team === 8 && source.status === 1
          && source.resource.rateWord > 0 && (source.position.x >> 8) === target[0] && (source.position.y >> 8) === target[1],
        "Harvest requires an active neutral VENT identity at the selected cell");
      }
      const cells = Array.from({ length: count }, (_, index) => origin.map((value, axis) =>
        value + Math.sign(delta[axis]) * (index + 1)) as [number, number]);
      const required = [origin, ...cells];
      if (delta[0] && delta[1]) cells.forEach((cell, index) => {
        const previous = index ? cells[index - 1] : origin;
        required.push([previous[0], cell[1]], [cell[0], previous[1]]);
      });
      requireHost(required.every(([column, row]) => column >= 0 && row >= 0 && column < host.width && row < host.height),
        "Native route outside map");
      const groundCells = [...new Set(required.map(([column, row]) => row * host.width + column))];
      const family = template.families[origin[1] * host.width + origin[0]];
      requireHost(family > 0 && family < 255 && groundCells.every(cell => template.families[cell] === family
        && host.groundEligible[cell] && (host.ground[cell] === -1 || host.ground[cell] === entity.slot)
        && host.flying[cell] === -1 && template.tripWords[template.groundCells.indexOf(cell)] === 1023),
      "Native route blocked, crosses a PTH family or has unowned trip/secondary occupancy");
      const profile: LegacyHarvesterMovementWorld = { ...template,
        route: { policy: "external-direct-straight", originQ8: [entity.position.x, entity.position.y], cells },
        commandTarget: [target[0] * 256 + 128, target[1] * 256 + 128], groundCells, tripWords: groundCells.map(() => 1023) };
      const ground = groundCells.map(cell => host.ground[cell] === entity.slot ? task.nativeIdle!.groundWord : 1023);
      const idle = decodeLegacyHarvesterMovement(Array.from(world.entityBytes!.slice(entity.slot * 220, (entity.slot + 1) * 220)),
        entity.slot, task.nativeIdle.randomIndex, ground);
      const result = beginLegacyHarvesterMovement(idle, profile, command.type === "harvest" ? 7 : 2);
      requireHost(result.supported, result.supported ? "" : result.diagnostic);
      if (command.type === "harvest") {
        const source = host.slots[command.sourceSlot!]!;
        let preview = result.state, arrived = false;
        let countdownWord = source.resource!.countdownWord, animation = structuredClone(source.resourceTask!.animation);
        const sourceAnimation = host.resourceLifecycle!.animations.find(bank => bank.id === animation.profile)!;
        const visitSource = () => {
          animation = advanceLegacyResourceAnimation(animation, sourceAnimation, source.resourceTask!.direction);
          const destination = (source.position.y >> 8) * host.width + (source.position.x >> 8);
          const occupied = (preview.ground[profile.groundCells.indexOf(destination)] & 1023) === entity.slot;
          const result = advanceLegacyResourceCountdown({ rateWord: source.resource!.rateWord, countdownWord,
            sourceAnimationState: animation.mode, occupantType: occupied ? entity.unitType : null });
          countdownWord = result.countdownWord;
          requireHost(result.transition !== "activate" || arrived,
            "VENT activation before native idle arrival is outside the bounded route profile");
          if (result.resetSourceAnimation) animation = resetLegacyResourceAnimation(animation, sourceAnimation.id,
            result.transition === "reset" ? 0 : 2);
        };
        for (let visit = 0; visit < 128 && !arrived; visit++) {
          if (source.slot < entity.slot) visitSource();
          const next = reduceLegacyHarvesterMovement(preview, profile);
          requireHost(next.supported, next.supported ? "" : next.diagnostic);
          preview = next.state; arrived = next.idleEvent !== null;
          if (source.slot > entity.slot) visitSource();
        }
        requireHost(arrived, "Native route did not reach a verified idle boundary");
      }
      task.released = false;
      task.nativeMovement = { state: result.state, world: profile };
    }
    return { ok: true, value: save(structuredClone(world), host) };
  } catch (error) { return failure(error); }
}

export function validateNativeMovement(value: unknown): void {
  const movement = value as NonNullable<ResourceHostEntityState["nativeMovement"]>;
  requireHost(movement && Object.keys(movement).length === 2 && movement.state && movement.world
    && legacyHarvesterMovementDiagnostic(movement.state, movement.world) === null, "Invalid native movement snapshot");
}

function bindResourceTask(state: TransportHostState, binding: ResourceHostBinding): void {
  const entity = state.slots[binding.slot];
  requireHost(entity && entity.generation === binding.generation && (!entity.resourceTask || entity.resourceTask.released) && entity.status === 1,
    `Invalid resource task binding ${binding.slot}`);
  const input = binding.state;
  const profile = resourceType(state, entity.unitType);
  const mobileWait = (entity.unitType === 6 || entity.unitType === 14) && input.stack.length === 2 &&
    input.stack[1].opcode === 3 && input.stack[1].words.length === 2 &&
    integer(input.stack[1].words[0], 7) && integer(input.stack[1].words[1], 32767);
  requireHost(!mobileWait || input.nativeIdle, "Native wait admission requires explicit native auxiliary state");
  requireHost((input.stack.length === 1 || mobileWait) && input.stack[0].opcode === 1 && input.stack[0].words.length === 3 &&
    input.stack[0].words.every((value) => integer(value, 65535)) && !input.released &&
    integer(input.direction, 255) && integer(input.pendingOrder, 255) && integer(input.order, 255),
  "Resource admission requires an explicit native idle task (three words), direction and order bytes");
  requireHost(input.animation.profile === profile.stand || (input.nativeIdle && input.animation.profile === profile.preservedIdle),
    "Resource admission requires source stand or preserved idle animation identity");
  advanceLegacyResourceAnimation(input.animation, state.resourceLifecycle!.animations.find(({ id }) => id === input.animation.profile)!, input.direction);
  entity.resourceTask = structuredClone(input);
  entity.taskWords = entity.resourceTask.stack.at(-1)!.words;
  entity.task = "idle";
  if (entity.resource) requireHost(entity.resource.countdownWord === input.stack[0].words[0], "Resource idle payload/countdown mismatch");
  else {
    requireHost(entity.unitType === 6 || entity.unitType === 14, "Deployed resource admission requires a task-owner resume contract");
    resourceType(state, entity.unitType === 6 ? 47 : 48);
    if (input.nativeIdle) reduceResourceIdle(state, entity, false);
  }
}

function reduceResourceIdle(state: TransportHostState, entity: HostSlot, publish: boolean): void {
  const task = entity.resourceTask!;
  const native = task.nativeIdle;
  const profile = resourceType(state, entity.unitType);
  requireHost(native && profile.preservedIdle,
    `Resource general mobile idle/wait dispatch requires explicit native auxiliary state and preserved FIN bank at slot ${entity.slot}`);
  const animations = state.resourceLifecycle!.animations;
  const bank = (id: string) => animations.findIndex((entry) => entry.id === id) + 1;
  const groundCell = cellIndex(state, native256ToTile(entity.position));
  requireHost(groundCell !== null && state.ground[groundCell] === entity.slot,
    "Native idle requires current exclusive ground occupancy");
  const result = reduceLegacyHarvesterIdle({ ...native, slot: entity.slot, typeId: entity.unitType,
    team: entity.team, status: entity.status, hp: entity.health, xQ8: entity.position.x, yQ8: entity.position.y,
    direction: task.direction, pending: task.pendingOrder, order: task.order,
    stack: task.stack.map(({ opcode, words }) => ({ task: opcode, words })),
    animation: { bank: bank(task.animation.profile), frame: task.animation.frame, delay: task.animation.delay, mode: task.animation.mode } },
  { width: state.width, height: state.height, selectedWeapon: profile.selectedWeapon, standBank: bank(profile.stand),
    preservedIdleBank: bank(profile.preservedIdle), groundWord: native.groundWord, groundCell,
    animations: Object.fromEntries(animations.map((entry, index) => [index + 1, entry.directions])) });
  requireHost(result.supported, result.supported ? "" : result.diagnostic);
  if (!publish) return;
  task.animation = { profile: animations[result.state.animation.bank - 1].id,
    frame: result.state.animation.frame, delay: result.state.animation.delay,
    mode: result.state.animation.mode as LegacyResourceAnimation["mode"] };
  resourceTask(entity, "idle", result.state.stack.map(({ task: opcode, words }) => ({
    opcode: opcode as 1 | 3, words: [...words] })));
}

export function bindCampaignResourceTask(world: CampaignWorld, binding: ResourceHostBinding): TriggerResult<CampaignWorld> {
  try {
    const state = transportHostState(world);
    requireHost(state.resourceLifecycle, "Configure resource FIN profiles before binding an incoming task");
    bindResourceTask(state, binding);
    return { ok: true, value: save(structuredClone(world), state) };
  } catch (error) { return failure(error); }
}

function resourceTask(entity: HostSlot, task: HostSlot["task"], stack: ResourceHostEntityState["stack"]): void {
  entity.task = task;
  entity.resourceTask!.stack = stack;
  entity.taskWords = stack.at(-1)!.words;
}

function resetResourceIdle(entity: HostSlot): void {
  requireHost(entity.resourceTask!.pendingOrder === 0, `Resource task reset requires queued order owner for slot ${entity.slot}`);
  resourceTask(entity, "idle", [{ opcode: 1, words: [65535, entity.health & 65535, (entity.health >>> 16) & 65535] }]);
}

function resourceSound(state: TransportHostState, entity: HostSlot, frame: ResourceHostFrame, value: 0 | 1): void {
  if (entity.team === frame.localTeam) state.requests.push({ type: "resource-unit-sound", slot: entity.slot,
    generation: entity.generation, edx: entity.unitType, ebx: 5, ecx: value,
    stackArguments: [entity.position.x, entity.position.y], spatial: true });
}

function setResourceAnimation(entity: HostSlot, profile: string, mode: LegacyResourceAnimation["mode"]): void {
  entity.resourceTask!.animation = resetLegacyResourceAnimation(entity.resourceTask!.animation, profile, mode);
}

function visitResourceSource(state: TransportHostState, source: HostSlot, frame: ResourceHostFrame): void {
  requireHost(source.task === "idle" && source.resourceTask?.stack.at(-1)?.opcode === 1, "Source requires native idle task ownership");
  const index = cellIndex(state, native256ToTile(source.position));
  requireHost(index !== null, "Source outside resource map");
  const occupant = state.slots[state.ground[index]];
  const result = advanceLegacyResourceCountdown({ rateWord: source.resource!.rateWord,
    countdownWord: source.resource!.countdownWord, sourceAnimationState: source.resourceTask.animation.mode,
    occupantType: occupant?.unitType ?? null });
  source.resource!.countdownWord = result.countdownWord;
  source.taskWords[0] = result.countdownWord;
  if (result.clearSourceDirection) source.resourceTask.direction = 0;
  if (result.resetSourceAnimation) setResourceAnimation(source, resourceType(state, 40).stand,
    result.transition === "reset" ? 0 : 2);
  if (result.transition !== "activate") return;
  requireHost(occupant?.resourceTask && !occupant.resourceTask.nativeMovement && !occupant.resourceTask.released &&
    (occupant.resourceTask.stack.length === 1 || (occupant.resourceTask.stack.length === 2 && occupant.resourceTask.stack[1].opcode === 3)) &&
    occupant.resourceTask.stack[0].opcode === 1, `Resource activation needs task owner binding for occupant ${occupant?.slot}`);
  requireHost(integer(occupant.team, 7), "Resource occupant has unsupported side fields");
  source.resourceTask.direction = occupant.resourceTask.direction;
  setResourceAnimation(occupant, resourceType(state, occupant.unitType).deploy, 1);
  resourceSound(state, occupant, frame, 1);
  occupant.unitType = result.extractorType!;
  resourceTask(occupant, "extraction", [...occupant.resourceTask.stack, { opcode: 12, words: [source.slot, 1, 0] }]);
  source.resource!.countdownWord = 50;
  source.taskWords[0] = 50;
}

function syncResourceEntities(world: CampaignWorld, state: TransportHostState): CampaignWorld {
  return { ...world, entities: world.entities.filter((entity) => !state.slots[entity.rawSlot!]?.resourceTask ||
    state.slots[entity.rawSlot!]!.status !== 0).map((entity) => {
    const record = entity.rawSlot === null ? null : state.slots[entity.rawSlot];
    return record?.resourceTask ? { ...entity, unitType: record.unitType, health: record.health,
      ...(record.resource ? { resource: { ...record.resource } } : {}) } : entity;
  }) };
}

function stepResources(world: CampaignWorld, state: TransportHostState, frame: ResourceHostFrame): CampaignWorld {
  validateResourceFrame(frame);
  state.resourceLifecycle!.nativePhaseCounter = frame.nativePhaseCounter;
  for (const order of frame.orders ?? []) {
    const target = state.slots[order.slot];
    requireHost(target?.resourceTask && target.generation === order.generation && !target.resourceTask.released &&
      integer(order.pendingOrder, 255) && integer(order.order, 255), "Stale or invalid resource order binding");
    target.resourceTask.pendingOrder = order.pendingOrder;
    target.resourceTask.order = order.order;
  }
  const statistics = { ...world.statistics };
  const exomoney = { ...world.exomoney };
  for (let team = 0; team < 8; team += 1) statistics[`${team},5`] = 0;
  const credit = (team: number, delta: number, cycles: number) => {
    requireHost(integer(team, 7) && [exomoney[team], statistics[`${team},1`]].every((value) =>
      Number.isInteger(value) && value >= -2147483648 && value <= 2147483647),
      `Resource settlement requires explicit full32 funds/income for side ${team}`);
    exomoney[team] = (exomoney[team] + delta) | 0;
    statistics[`${team},1`] = (statistics[`${team},1`] + delta) | 0;
    statistics[`${team},5`] = (statistics[`${team},5`] + cycles) | 0;
  };
  for (const entity of state.slots) {
    if (entity?.resourceTask && entity.status !== 0) requireHost(state.registry[entity.slot] === entity.key,
      "Native resource visits require a registered source slot");
    if (entity?.resourceTask?.nativeMovement) {
      const movement = entity.resourceTask.nativeMovement;
      requireHost(movement.world.groundCells.every((cell, index) =>
        (state.ground[cell] === -1 ? 1023 : state.ground[cell]) === (movement.state.ground[index] & 1023)),
      "Native route occupancy changed; dynamic replanning is not verified");
      const result = reduceLegacyHarvesterMovement(movement.state, movement.world);
      requireHost(result.supported, result.supported ? "" : result.diagnostic);
      movement.state = result.state;
      entity.position = { x: result.state.xQ8, y: result.state.yQ8 };
      entity.resourceTask.direction = result.state.direction;
      movement.world.groundCells.forEach((cell, index) => {
        const owner = result.state.ground[index] & 1023;
        state.ground[cell] = owner === 1023 ? -1 : owner;
      });
      if (result.idleEvent) {
        const idle = result.idleEvent.state;
        const profile = resourceType(state, entity.unitType);
        const stopped = entity.resourceTask.nativeStopRequested === true;
        world.entityBytes!.set(result.state.raw, entity.slot * 220);
        entity.resourceTask = { nativeBanks: entity.resourceTask.nativeBanks, direction: idle.direction,
          animation: { profile: profile.stand, frame: idle.animation.frame, delay: idle.animation.delay,
            mode: idle.animation.mode as LegacyResourceAnimation["mode"] },
          pendingOrder: idle.pending, order: idle.order, released: stopped,
          stack: idle.stack.map(({ task, words }) => ({ opcode: task as 1 | 3, words: [...words] })),
          nativeIdle: { randomIndex: idle.randomIndex, observer: idle.observer, specialOrder: idle.specialOrder,
            confusion: idle.confusion, secondaryAnimationPending: idle.secondaryAnimationPending,
            secondaryAnimationsInactive: idle.secondaryAnimationsInactive, groundWord: result.idleEvent.groundWord } };
        entity.taskWords = entity.resourceTask.stack.at(-1)!.words;
        if (stopped) state.requests.push({ type: "resource-task-released", slot: entity.slot, generation: entity.generation, task: 1 });
      }
      continue;
    }
    if (!entity?.resourceTask || entity.status === 0 || entity.resourceTask.released) continue;
    const task = entity.resourceTask;
    const animation = state.resourceLifecycle!.animations.find(({ id }) => id === task.animation.profile);
    requireHost(animation, `Missing active FIN bank ${task.animation.profile}`);
    task.animation = advanceLegacyResourceAnimation(task.animation, animation, task.direction);
    if (entity.resource && entity.status !== 10) { visitResourceSource(state, entity, frame); continue; }
    if (entity.task === "removal") {
      const profile = resourceType(state, entity.unitType);
      if (entity.taskWords[0] === 0) setResourceAnimation(entity, profile.death, 1);
      entity.taskWords[0] = (entity.taskWords[0] + 1) & 65535;
      if (entity.taskWords[0] === 150) {
        entity.status = 0;
        state.registry[entity.slot] = null;
        state.requests.push({ type: "unregister", slot: entity.slot, generation: entity.generation });
      }
      continue;
    }
    if (entity.task === "retraction") {
      if (task.animation.mode !== 2) continue;
      requireHost(entity.unitType === 47 || entity.unitType === 48, "Unsupported task-13 resource type");
      entity.unitType = entity.unitType === 47 ? 6 : 14;
      setResourceAnimation(entity, resourceType(state, entity.unitType).stand, 0);
      resetResourceIdle(entity);
      task.released = true;
      state.requests.push({ type: "resource-task-released", slot: entity.slot, generation: entity.generation, task: 1 });
      continue;
    }
    if (entity.task === "idle" && (entity.unitType === 6 || entity.unitType === 14)) {
      if (task.pendingOrder === 1 && task.order === 13) {
        if (task.stack.at(-1)?.opcode === 3) {
          resourceTask(entity, "idle", task.stack.slice(0, -1));
        }
        task.pendingOrder = 0;
        task.order = 255;
        reduceResourceIdle(state, entity, false);
        resetResourceIdle(entity);
        if (task.nativeBanks) {
          reduceResourceIdle(state, entity, true);
          task.released = true;
          state.requests.push({ type: "resource-task-released", slot: entity.slot, generation: entity.generation, task: 1 });
          continue;
        }
      }
      reduceResourceIdle(state, entity, true);
      continue;
    }
    requireHost(entity.task === "extraction",
      `Resource task owner boundary at slot ${entity.slot}: general mobile idle/wait dispatch must be supplied before the next resource visit`);
    if (frame.cancellationGate === 0 && task.order === 13) {
      requireHost(task.pendingOrder === 1, "Resource cancellation requires native queued order 13 owner state");
      task.pendingOrder = 0;
      task.order = 255;
      resourceTask(entity, "retraction", [{ opcode: 13, words: [50] }]);
      setResourceAnimation(entity, resourceType(state, entity.unitType).deploy, 1);
      resourceSound(state, entity, frame, 1);
      continue;
    }
    if (task.animation.mode === 2) {
      entity.taskWords[1] = 0;
      setResourceAnimation(entity, resourceType(state, entity.unitType).stand, 0);
    }
    const source = state.slots[entity.taskWords[0]];
    requireHost(source?.resource && source.resourceTask && source.status === 1, "Extraction source is stale or removing");
    const partnerSlot = entity.taskWords[2];
    const partner = partnerSlot === 0 ? null : state.slots[partnerSlot];
    requireHost(partnerSlot === 0 || (partner && integer(partner.team, 7)), `Unresolved native resource partner ${partnerSlot}`);
    const side = frame.sides[entity.team];
    const result = extractLegacyResource({ reserve: source.health, rateWord: source.resource.rateWord,
      nativeCounter: frame.nativePhaseCounter, ...side,
      partner: partner ? { typeId: partner.unitType, status: partner.status, creditGate: frame.sides[partner.team].creditGate } : null });
    if (result.transition === "waiting") continue;
    if (result.transition === "extract") {
      if (partner && result.partnerCreditDelta !== 0) credit(partner.team, result.partnerCreditDelta, 0);
      if (side.creditGate !== 0) credit(entity.team, result.ownerCreditDelta, result.ownerCycleDelta);
      if (result.clearPartner) entity.taskWords[2] = 0;
      source.health = result.reserve;
      continue;
    }
    const index = cellIndex(state, native256ToTile(source.position));
    requireHost(index !== null && (state.resourceTileFlags[index] & 0x04000000) !== 0, "Resource depletion missing source MAP flag: native 0x413886");
    source.status = 10;
    resourceTask(source, "removal", [{ opcode: 10, words: [0, 0] }]);
    state.resourceTileFlags[index] &= ~0x04000000;
    resetResourceIdle(entity);
    resourceTask(entity, "retraction", [...task.stack, { opcode: 13, words: [50] }]);
    if (entity.health <= 270) {
      const occupied = cellIndex(state, native256ToTile(entity.position));
      requireHost(occupied !== null && state.ground[occupied] === entity.slot &&
        state.ground.filter((slot) => slot === entity.slot).length === 1 && !state.flying.includes(entity.slot),
      "Low-HP resource cleanup requires one source-backed ground cell; native 0x434ebb otherwise asserts");
      entity.status = 10;
      resourceTask(entity, "removal", [{ opcode: 10, words: [0, 0] }]);
      clearCollision(state, entity.slot);
      state.requests.push({ type: "clear-collision", slot: entity.slot, generation: entity.generation });
      state.requests.push({ type: "resource-unit-sound", slot: entity.slot, generation: entity.generation,
        edx: entity.unitType, ebx: 3, ecx: 1, stackArguments: [entity.position.x, entity.position.y], spatial: true });
    } else {
      entity.health -= 270;
      setResourceAnimation(entity, resourceType(state, entity.unitType).deploy, 1);
      resourceSound(state, entity, frame, 0);
    }
  }
  return syncResourceEntities({ ...world, statistics, exomoney }, state);
}

export function transportHostCensus(world: CampaignWorld): Readonly<Record<string, number>> {
  const state = transportHostState(world);
  const counts: Record<string, number> = {};
  for (const entity of state.slots) {
    if (!entity || entity.team === 8 || state.registry[entity.slot] !== entity.key) continue;
    const key = `${entity.team},${entity.unitType}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function stepNativeAiTasks(world: CampaignWorld, state: TransportHostState, frame?: NativeAiTaskFrame): CampaignWorld {
  validateNativeAiTaskAlignment(world, state);
  const owner = state.nativeAiTasks;
  if (!owner) {
    requireHost(frame === undefined, "Native AI frame requires explicit source owner");
    return world;
  }
  requireHost(frame && ["counter,task6Budget", "counter,registeredSlots,task6Budget"].includes(Object.keys(frame).filter(key => key !== "sound").sort().join())
    && integer(frame.counter, 0xffffffff) && integer(frame.task6Budget, 9), "Native AI visit requires actual counter and task6 budget");
  if (frame.registeredSlots !== undefined) requireHost(state.nativeCombat?.death && Array.isArray(frame.registeredSlots)
    && frame.registeredSlots.every((slot, index, slots) => integer(slot, 799) && slot >= 152
      && (index === 0 || slot > slots[index - 1]) && state.slots[slot]?.nativeAiTask
      && state.registry[slot] === state.slots[slot]!.key && state.slots[slot]!.status !== 0),
  "Bounded lethal visits require an ordered registered source slot list");
  const bytes = new Uint8Array(world.entityBytes!);
  owner.ground = owner.ground.map((word, cell) => {
    const slot = word & 1023, actual = state.ground[cell] === -1 ? 1023 : state.ground[cell];
    return slot >= 1022 && actual >= 1022 ? ((word & ~1023) | actual) >>> 0 : word;
  });
  owner.task6Budget = frame.task6Budget;
  const combat = state.nativeCombat, rngBefore = owner.rngCursor, spawns: LegacyNativeFireSpawn[] = [];
  requireHost(combat || frame.sound === undefined, "Audio frame requires native combat ownership");
  if (combat) sourceNativeCombatSound(combat, frame.sound);
  const soundBefore = combat?.soundState && structuredClone(combat.soundState);
  if (combat?.death) requireHost(frame.counter > (combat.journal.at(-1)?.counter ?? owner.configuration.counter),
    "Native death caller counter must advance monotonically");
  requireHost(combat || !owner.configuration.profiles.some(profile => profile.nativeFire), "Native fire requires authenticated combat owner");
  for (const actor of state.slots) {
    if (!actor?.nativeAiTask || actor.status === 0 || frame.registeredSlots && !frame.registeredSlots.includes(actor.slot)) continue;
    const task = actor.nativeAiTask, profile = owner.configuration.profiles[task.profile];
    if (actor.status === 10) {
      requireHost(combat?.death, "Registered death requires native death owner");
      const result = stepSourceNativeCombatDeath(combat!, bytes, profile, owner.ground, owner.rngCursor, frame.counter, actor.slot, frame.sound);
      bytes.set(result.actors);
      task.raw = Array.from(bytes.slice(actor.slot * 220, (actor.slot + 1) * 220));
      combat!.death = result.state;
      if (result.soundState) combat!.soundState = result.soundState;
      combat!.projectiles = { ...combat!.projectiles, statistics: result.statistics };
      owner.ground = [...result.ground];
      owner.rngCursor = result.rngCursor;
      owner.visits++;
      actor.status = task.raw[0x2c];
      actor.taskWords = [new DataView(Uint8Array.from(task.raw).buffer).getUint16(0x46, true), 0];
      if (result.removed.includes(actor.slot)) {
        state.registry[actor.slot] = null;
        state.requests.push({ type: "unregister", slot: actor.slot, generation: actor.generation });
      }
      continue;
    }
    const result = stageLegacyAiTaskPendingVisit({ slot: actor.slot, raw: task.raw,
      world: combat ? sourceNativeCombatVisitWorld(combat.configuration, profile, bytes, owner.ground)
        : { ...profile, ground: owner.ground },
      ...(combat ? { projectiles: combat.projectiles } : {}),
      counter: frame.counter, rngCursor: owner.rngCursor, task6Budget: owner.task6Budget },
    { slot: actor.slot, team: actor.team, expectedRaw: Array.from(bytes.slice(actor.slot * 220, (actor.slot + 1) * 220)),
      pendingNativeTask: !!actor.pendingNativeAi });
    requireHost(result.supported, result.supported ? "" : `${result.diagnostic} (slot ${actor.slot}, type ${actor.unitType}, counter ${frame.counter})`);
    task.raw = [...result.raw];
    bytes.set(result.raw, actor.slot * 220);
    const view = new DataView(Uint8Array.from(result.raw).buffer);
    actor.position = { x: view.getUint16(0, true), y: view.getUint16(4, true) };
    actor.task = result.stack[0].task === 1 ? "idle" : "unit";
    actor.taskWords = [...result.stack.at(-1)!.words];
    owner.ground = [...result.ground];
    owner.rngCursor = result.rngCursor;
    owner.task6Budget = result.task6Budget;
    owner.visits += 1;
    if (combat) {
      requireHost(result.projectiles, "Native combat visit lost projectile ownership");
      combat.projectiles = result.projectiles!;
      spawns.push(...result.spawns);
    }
    for (const write of result.groundWrites) {
      const slot = result.ground[write.cell] & 1023;
      state.ground[write.cell] = slot === 1023 ? -1 : slot;
    }
    if (!result.pendingHandoff.pendingNativeTask) delete actor.pendingNativeAi;
  }
  if (combat) {
    const result = stepSourceNativeCombatProjectiles(combat, bytes, owner.configuration.profiles[0], owner.ground, owner.rngCursor, frame.counter, frame.sound);
    for (const impact of result.impacts) requireHost(state.slots[impact.target]?.nativeAiTask,
      "Damaged target requires a registered reaction owner");
    bytes.set(result.actors);
    combat.projectiles = result.projectiles;
    owner.rngCursor = result.rngCursor;
    if (result.death) {
      combat.death = result.death.state;
      if (result.death.soundState) combat.soundState = result.death.soundState;
      owner.ground = [...result.death.ground];
    }
    for (const actor of state.slots) if (actor?.nativeAiTask) {
      actor.nativeAiTask.raw = Array.from(bytes.slice(actor.slot * 220, (actor.slot + 1) * 220));
      actor.health = new DataView(bytes.buffer).getInt32(actor.slot * 220 + 12, true);
      if (actor.status === 1 && actor.nativeAiTask.raw[0x2c] === 10) {
        actor.status = 10; actor.task = "death"; actor.taskWords = [0, 0];
        clearCollision(state, actor.slot);
        const loss = { id: JSON.stringify([world.sessionId, actor.key, actor.generation]), victimTeam: actor.team, victimType: actor.unitType };
        state.requests.push({ type: "combat-death", slot: actor.slot, generation: actor.generation, loss });
      }
    }
    for (const request of result.soundRequests) {
      const actor = state.slots[request.slot];
      requireHost(actor?.nativeAiTask, "Source sound requires owned actor identity");
      state.requests.push({ type: "native-death-sound", generation: actor!.generation, counter: frame.counter, ...request });
    }
    combat.journal.push({ counter: frame.counter, rngBefore, rngAfter: owner.rngCursor,
      spawns, impacts: result.impacts, reclaimed: result.reclaimed,
      ...(soundBefore ? { sound: { input: structuredClone(frame.sound!), before: soundBefore, after: structuredClone(combat.soundState!) },
        soundRequests: structuredClone(result.soundRequests) } : {}) });
  }
  return { ...world, entityBytes: bytes, entities: world.entities.filter(entity =>
    entity.rawSlot === null || state.slots[entity.rawSlot]?.status !== 0).map(entity => {
    const actor = entity.rawSlot === null ? null : state.slots[entity.rawSlot];
    return actor?.nativeAiTask ? { ...entity, health: actor.health, tileX: actor.position.x >>> 8, tileY: actor.position.y >>> 8 } : entity;
  }) };
}

function step(world: CampaignWorld, state: TransportHostState, resourceFrame?: ResourceHostFrame, nativeAiFrame?: NativeAiTaskFrame): CampaignWorld {
  requireHost(!state.slots.some(actor => actor?.pendingNativeAi && !actor.nativeAiTask),
    "pending-native-task-hand-off: AI orders require a native actor task owner before host step");
  let staged = stepNativeAiTasks(world, state, nativeAiFrame);
  if (state.resourceLifecycle) {
    requireHost(resourceFrame, "Resource task owner must supply native +0x530 phase counter, side fields and cancellation gate per update");
    staged = stepResources(staged, state, resourceFrame);
  }
  for (const source of state.slots) {
    if (state.resourceLifecycle || (world.browserCasualtyPickup?.runtimeProfile === "browser-adapted"
      && !state.nativeCombat && !state.nativeAiTasks)) break;
    if (!source?.resource || source.status === 0 || source.status === 10 || source.resource.rateWord === 0) continue;
    const index = cellIndex(state, native256ToTile(source.position));
    const occupant = index === null ? null : state.slots[state.ground[index]];
    requireHost(!occupant || (occupant.unitType !== 6 && occupant.unitType !== 14),
      `Resource extraction at slot ${source.slot} unsupported: deployment and depletion lifecycle are not integrated`);
  }
  state.tick += 1;
  const carriers = state.reducer.carriers.filter((entry) => entry.phase !== "released").sort((left, right) => left.slot - right.slot);
  for (const carrier of carriers) {
    const motion = state.motions.find((entry) => entry.id === carrier.id);
    if (!motion) {
      staged = dispatch(staged, state, { type: "invoke", id: carrier.id });
      continue;
    }
    if (motion.kind === "orientation") {
      motion.progress += 1;
      if (motion.progress < state.orientationSteps) continue;
      state.motions = state.motions.filter((entry) => entry !== motion);
      staged = dispatch(staged, state, { type: "oriented", id: carrier.id });
    }
    const movement = state.motions.find((entry) => entry.id === carrier.id && entry.kind === "movement");
    if (!movement) continue;
    const entity = state.slots[carrier.slot]!;
    const deltaX = movement.destination.x - movement.origin.x;
    const deltaY = movement.destination.y - movement.origin.y;
    const distance = Math.hypot(deltaX, deltaY);
    movement.progress = Math.min(distance, movement.progress + definition(state, entity.unitType).movementSpeed);
    const fraction = distance === 0 ? 1 : movement.progress / distance;
    entity.position = { x: Math.trunc(movement.origin.x + deltaX * fraction), y: Math.trunc(movement.origin.y + deltaY * fraction) };
    if (movement.progress === distance) {
      state.motions = state.motions.filter((entry) => entry !== movement);
      staged = dispatch(staged, state, { type: "arrived", id: carrier.id });
    }
  }
  return staged;
}

export function stepTransportHost(world: CampaignWorld, resourceFrame?: ResourceHostFrame, nativeAiFrame?: NativeAiTaskFrame): TriggerResult<CampaignWorld> {
  try {
    const state = transportHostState(world);
    const staged = save(step(cloneTransportHostWorld({ ...world, transportState: state }), state, resourceFrame, nativeAiFrame), state);
    validateNativeAiTaskAlignment(staged, state);
    return { ok: true, value: staged };
  } catch (error) { return failure(error); }
}

export function validateTransportConstruction(world: CampaignWorld, construction: NativeConstructionHost): void {
  const state = transportHostState(world), config = construction.configuration;
  requireHost(state.width === config.map.width && state.height === config.map.height && !state.nativeAiTasks,
    "CITY map or shared native task scheduler is unsupported");
  for (let local = 0; local < 15; local++) {
    const slot = config.team * 15 + local, actor = state.slots[slot];
    const entity = world.entities.find(candidate => candidate.rawSlot === slot), fixed = config.fixedSlots[local];
    const expected = construction.actors[local];
    if (fixed) {
      const raw = new DataView(world.entityBytes!.buffer, world.entityBytes!.byteOffset);
      const position = { x: config.base.x * 256 + (local === 0 ? -512 : 0),
        y: config.base.y * 256 + (local === 0 ? 120 : local === 5 ? 256 : 0) };
      requireHost(actor && entity && actor.key === entity.key && actor.generation === entity.generation
        && actor.key === `colony:${slot}` && actor.generation === 0 && entity.unitType === fixed.unitType && entity.team === config.team
        && state.generations[slot] === entity.generation && actor.unitType === fixed.unitType && actor.team === config.team
        && actor.health === fixed.health && entity.health === fixed.health && actor.status === 1 && state.registry[slot] === actor.key
        && actor.position.x === position.x && actor.position.y === position.y && actor.height === 0
        && entity.tileX === position.x >>> 8 && entity.tileY === position.y >>> 8
        && raw.getUint16(slot * 220, true) === position.x && raw.getUint16(slot * 220 + 4, true) === position.y
        && world.entityBytes![slot * 220 + 6] === fixed.unitType && world.entityBytes![slot * 220 + 7] === config.team
        && !actor.pendingNativeAi && !actor.resourceTask && !actor.nativeAiTask
        && world.entityBytes![slot * 220 + 0x2c] === 1
        && raw.getInt32(slot * 220 + 12, true) === fixed.health,
      "CITY requires actual live fixed prerequisite identities");
    } else if (!expected) {
      requireHost(!actor && !entity && state.generations[slot] === -1 && state.registry[slot] === null
        && world.entityBytes!.slice(slot * 220, (slot + 1) * 220).every(value => value === 0), "CITY fixed slot is occupied");
    } else {
      const raw = nativeConstructionRaw(construction, local as 3 | 6);
      const generation = local === 6 && expected.departing ? 1 : 0;
      requireHost(actor && entity && actor.key === `city:${slot}:${generation}` && actor.generation === generation
        && state.generations[slot] === generation && entity.key === actor.key && entity.generation === generation
        && actor.team === expected.team && entity.team === expected.team && actor.unitType === expected.unitType
        && entity.unitType === expected.unitType && actor.health === expected.health && entity.health === expected.health
        && entity.maxHealth === expected.health && actor.status === expected.status
        && actor.position.x === expected.position.x && actor.position.y === expected.position.y && actor.height === expected.position.height
        && entity.tileX === expected.position.x >>> 8 && entity.tileY === expected.position.y >>> 8
        && state.registry[slot] === (expected.registered ? actor.key : null)
        && actor.nativeConstruction?.team === config.team && actor.nativeConstruction.receiptId === construction.receiptId
        && !actor.pendingNativeAi && !actor.nativeAiTask && !actor.resourceTask && actor.task === "unit"
        && actor.taskWords.length === 0 && raw.every((value, index) => value === world.entityBytes![slot * 220 + index]
          && value === actor.nativeConstruction!.raw[index]), "CITY external damage/death/order or raw identity mutation is unsupported");
    }
  }
  for (const cell of construction.footprint) {
    const index = cell.y * state.width + cell.x;
    requireHost(construction.receiptId ? state.ground[index] === config.team * 15 + 3 && !state.groundEligible[index]
      : state.ground[index] === -1 && state.groundEligible[index], "CITY static footprint conflict");
  }
}

export function projectTransportConstruction(world: CampaignWorld, previous: NativeConstructionHost,
  next: NativeConstructionHost): CampaignWorld {
  validateTransportConstruction(world, previous);
  restoreNativeConstructionHost(next, previous.configuration);
  const state = transportHostState(world), bytes = new Uint8Array(world.entityBytes!);
  let entities = [...world.entities];
  for (const local of [3, 6] as const) {
    const actor = next.actors[local];
    if (!actor) continue;
    const slot = actor.nativeId, prior = previous.actors[local];
    const created = !prior || prior.departing !== actor.departing;
    const generation = created ? ++state.generations[slot] : state.generations[slot];
    const key = `city:${slot}:${generation}`, position = { x: actor.position.x, y: actor.position.y };
    const raw = nativeConstructionRaw(next, local);
    state.slots[slot] = { slot, generation, key, team: actor.team, unitType: actor.unitType, health: actor.health,
      status: actor.status, position, height: actor.position.height, task: "unit", taskWords: [],
      nativeConstruction: { team: next.configuration.team, receiptId: next.receiptId!, raw: [...raw] } };
    state.registry[slot] = actor.registered ? key : null;
    bytes.set(raw, slot * 220);
    entities = [...entities.filter(entity => entity.rawSlot !== slot), { key, generation, sourceRow: null, team: actor.team,
      unitType: actor.unitType, tileX: position.x >>> 8, tileY: position.y >>> 8, rawTail: [], health: actor.health,
      maxHealth: actor.health, rawSlot: slot, simulationId: null }];
    if (created) state.requests.push({ type: "create", slot, generation, team: actor.team, unitType: actor.unitType, position });
    if (prior?.registered && !actor.registered) state.requests.push({ type: "unregister", slot, generation });
  }
  if (next.receiptId) for (const cell of next.footprint) {
    const index = cell.y * state.width + cell.x;
    state.ground[index] = cell.occupant; state.groundEligible[index] = false;
  }
  const projected = { ...world, entityBytes: bytes, entities, transportState: state,
    buildingSlots: { ...world.buildingSlots, [`${next.configuration.team},3`]: next.actors[3]?.health ?? 0 } };
  validateTransportConstruction(projected, next);
  return projected;
}

export function receiveTransportHostAiPolicy(world: CampaignWorld, candidate: Uint8Array,
  packets: readonly Uint8Array[], receiptId: string, actorTransport: "deferred" | "synchronous"): CampaignWorld {
  const state = transportHostState(world);
  validateNativeAiTaskAlignment(world, state);
  requireHost(actorTransport === "deferred" || actorTransport === "synchronous", "AI receipt requires explicit native transport timing");
  requireHost(receiptId.length > 0 && candidate.length === 800 * 220 && world.entityBytes?.length === candidate.length,
    "AI receipt requires the complete shared native pool");
  const bytes = new Uint8Array(candidate);
  for (const packet of packets) {
    for (const order of decodeLegacyAiActorPacket(packet)) {
      for (const slot of order.mode === 5 ? [order.slot] : order.slots) {
        const actor = state.slots[slot];
        requireHost(actor && actor.status !== 0 && actor.status !== 10 && state.registry[slot] === actor.key
          && world.entities.some(entity => entity.rawSlot === slot && entity.key === actor.key && entity.generation === actor.generation),
        `AI receipt has no current actor identity at slot ${slot}`);
        requireHost(!actor.resourceTask?.nativeMovement, `AI receipt requires the active native movement task owner at slot ${slot}`);
        if (order.mode === 5 || !actor.nativeAiTask) actor.pendingNativeAi = { receiptId, disposition: "pending-native-task-hand-off" };
      }
    }
    if (actorTransport === "deferred") applyLegacyAiActorPacket(bytes, packet);
  }
  for (const actor of state.slots) {
    if (actor?.nativeAiTask) {
      const before = world.entityBytes!.slice(actor.slot * 220, (actor.slot + 1) * 220);
      const expected = new Uint8Array(world.entityBytes!);
      for (const packet of packets) applyLegacyAiActorPacket(expected, packet);
      requireHost(actor.nativeAiTask.raw.every((value, index) => value === before[index])
        && Array.from(bytes.slice(actor.slot * 220, (actor.slot + 1) * 220)).every((value, index) => value === expected[actor.slot * 220 + index]),
      "AI receipt conflicts with protected native actor state");
      actor.nativeAiTask.raw = Array.from(bytes.slice(actor.slot * 220, (actor.slot + 1) * 220));
      if (!actor.nativeAiTask.raw[0x36]) delete actor.pendingNativeAi;
    }
    if (actor?.pendingNativeAi && actor.resourceTask) {
      actor.resourceTask.pendingOrder = bytes[actor.slot * 220 + 0x36];
      actor.resourceTask.order = bytes[actor.slot * 220 + 0x37];
    }
  }
  const published = save({ ...cloneTransportHostWorld({ ...world, transportState: state }), entityBytes: bytes }, state);
  requireHost(published.entityBytes!.every((value, index) => value === bytes[index]),
    "AI candidate conflicts with current host raw state");
  validateNativeAiTaskAlignment(published, state);
  return published;
}

export function advanceTransportHost(world: CampaignWorld, milliseconds: number, resourceFrames?: readonly ResourceHostFrame[],
  nativeAiFrames?: readonly NativeAiTaskFrame[]): TriggerResult<CampaignWorld> {
  try {
    requireHost(Number.isFinite(milliseconds) && milliseconds >= 0, "Invalid elapsed simulation time");
    const state = transportHostState(world);
    validateNativeAiTaskAlignment(world, state);
    requireHost(!state.slots.some((actor) => actor?.pendingNativeAi && !actor.nativeAiTask), "Pending native AI task hand-off requires its task owner before elapsed-time advancement");
    const elapsed = state.remainderMilliseconds + milliseconds;
    requireHost(Number.isFinite(elapsed), "Simulation time overflow");
    if (state.nativeAiTasks) requireHost(nativeAiFrames?.length === Math.floor(elapsed / state.fixedStepMilliseconds),
      "Native AI task owner must supply one actual frame per fixed update");
    else requireHost(nativeAiFrames === undefined, "Native AI frames require explicit source owner");
    let staged = cloneTransportHostWorld({ ...world, transportState: state });
    state.remainderMilliseconds = elapsed;
    if (state.resourceLifecycle) requireHost(resourceFrames?.length === Math.floor(state.remainderMilliseconds / state.fixedStepMilliseconds),
      "Resource task owner must provide one native phase frame per fixed update; elapsed milliseconds cannot supply it");
    let resourceFrameIndex = 0;
    while (state.remainderMilliseconds >= state.fixedStepMilliseconds) {
      staged = step(staged, state, resourceFrames?.[resourceFrameIndex], nativeAiFrames?.[resourceFrameIndex]);
      resourceFrameIndex += 1;
      state.remainderMilliseconds -= state.fixedStepMilliseconds;
    }
    const published = save(staged, state);
    validateNativeAiTaskAlignment(published, state);
    return { ok: true, value: published };
  } catch (error) { return failure(error); }
}

export type HostUnitUpdate =
  | { readonly type: "position"; readonly slot: number; readonly generation: number; readonly position: TransportPosition }
  | { readonly type: "combat-death" | "complete-removal"; readonly slot: number; readonly generation: number };

export function updateTransportHostUnit(world: CampaignWorld, update: HostUnitUpdate): TriggerResult<CampaignWorld> {
  try {
    const state = transportHostState(world);
    requireHost(!state.nativeAiTasks, "native-ai-occupancy-owner-required: external actor updates are unsupported with native AI tasks");
    const target = state.slots[update.slot];
    requireHost(target && target.generation === update.generation && target.team !== 8, "Stale or invalid unit reference");
    requireHost(!target.nativeAiTask, "Native AI owned actor requires its task owner");
    let staged = structuredClone(world);
    if (update.type === "position") {
      requireHost(!target.resourceTask || target.resourceTask.released, "Resource-owned unit movement requires task cancellation/handoff");
      requireHost(target.status !== 0 && target.status !== 10 && integer(update.position.x, 65535) && integer(update.position.y, 65535), "Cannot move inactive unit or invalid position");
      clearCollision(state, target.slot);
      target.position = { ...update.position };
      if (world.browserCasualtyPickup?.runtimeProfile === "browser-adapted"
        && !state.nativeCombat && !state.nativeAiTasks && !state.resourceLifecycle) {
        const plane = definition(state, target.unitType).plane;
        const destination = cellIndex(state, native256ToTile(target.position));
        const reservation = state.productionExits?.find(exit => cellIndex(state, exit.tile) === destination
          && definition(state, exit.unitType).plane === plane);
        if (reservation && destination !== null && state[plane][destination] === 1022) {
          productionExit(state, world, reservation);
          state[plane][destination] = -1;
        }
      }
      occupy(state, target);
      const tile = native256ToTile(target.position);
      staged = { ...staged, entities: staged.entities.map((entity) => entity.key === target.key ? { ...entity, tileX: tile.x, tileY: tile.y } : entity) };
    } else if (update.type === "combat-death") {
      const policy = browserCasualtyPickupPolicy(world, target.team, target.unitType);
      requireHost(policy === "unowned" || !state.nativeCombat, "Adapted casualty pickup cannot own native combat");
      if (policy !== "unowned" && state.browserCasualties?.some(entry => entry.slot === target.slot
        && entry.generation === target.generation)) return { ok: true, value: staged };
      requireHost(!target.resourceTask || target.resourceTask.released, "Resource task owner must handle combat interruption before transport death updates");
      delete target.resourceTask;
      requireHost(target.status !== 0 && target.status !== 10, "Unit already inactive");
      target.health = 0;
      target.status = 10;
      target.task = "death";
      target.taskWords = [];
      clearCollision(state, target.slot);
      const loss: MissionVictimLoss = { id: JSON.stringify([world.sessionId, target.key, target.generation]), victimTeam: target.team, victimType: target.unitType };
      state.requests.push({ type: "combat-death", slot: target.slot, generation: target.generation, loss });
      staged = { ...staged, entities: staged.entities.map((entity) => entity.key === target.key ? { ...entity, health: 0 } : entity) };
      if (policy === "automatic" || policy === "suppressed") {
        const carrierId = policy === "automatic" ? state.reducer.nextId : null;
        if (policy === "automatic") {
          const directionBits = state.directionBits[state.directionCursor];
          requireHost(directionBits, "Injected direction bit stream exhausted");
          staged = dispatch(staged, state, { type: "abduct", team: target.team, side: state.sides[target.team],
            commander: { slot: target.slot, status: 1, position: { ...target.position } }, directionBits });
          state.directionCursor += 1;
        }
        (state.browserCasualties ??= []).push({ slot: target.slot, generation: target.generation, lossId: loss.id,
          carrierId, disposition: policy === "automatic" ? "scheduled" : "suppressed", collected: false });
      }
    } else {
      requireHost(!target.resourceTask || target.resourceTask.released, "Resource removal completes only on native task-10 visit 150");
      requireHost(!state.browserCasualties?.some(entry => entry.slot === target.slot && entry.generation === target.generation
        && entry.disposition === "scheduled" && !entry.collected), "Casualty remains registered until carrier pickup");
      requireHost(target.status === 10, "Task-10 completion requires a removing unit");
      target.status = 0;
      state.registry[target.slot] = null;
      clearCollision(state, target.slot);
      state.requests.push({ type: "unregister", slot: target.slot, generation: target.generation });
      staged = { ...staged, entities: staged.entities.filter((entity) => entity.key !== target.key) };
    }
    for (const reservation of state.productionExits ?? []) {
      const plane = definition(state, reservation.unitType).plane;
      const index = cellIndex(state, reservation.tile)!;
      if (state[plane][index] === -1) state[plane][index] = 1022;
    }
    return { ok: true, value: save(staged, state) };
  } catch (error) { return failure(error); }
}

export function consumeTransportFifo(world: CampaignWorld, fifoIndex: number, producerTeam: number): TriggerResult<CampaignWorld> {
  try {
    const state = transportHostState(world);
    validateNativeAiTaskAlignment(world, state);
    const fifo = state.fifos[fifoIndex];
    requireHost(fifo && fifo.types.length > 0, "Missing or empty coordinate FIFO");
    const staged = createUnit(structuredClone(world), state, producerTeam, fifo.types[0], tileToNative256(fifo.tile));
    fifo.types.shift();
    const published = save(staged, state);
    validateNativeAiTaskAlignment(published, state);
    return { ok: true, value: published };
  } catch (error) { return failure(error); }
}
import { SUBCELLS_PER_CELL } from "./constants";
import { validateBrowserMineOptions, type BrowserMineOptions } from "./browser-mines";
import { areHostile, copyTeamAlliances, validateTeam, type TeamAlliances } from "./diplomacy";
import { NavigationGrid, type GridPoint } from "./grid";
import {
  calculateLegacyDamage,
  copySourceDamageProfile,
  copyLegacyDefenseProfile,
  nativeOrdinaryHitDamage,
  VERIFIED_NATIVE_SOURCE_TYPES,
  VERIFIED_NATIVE_WEAPON_IDS,
  type SourceDamageProfile,
  type LegacyDefenseProfile,
} from "./legacy-balance";
import { findPath } from "./pathfinding";
import { DeterministicRandom } from "./random";
import { validateNativeMovement, type ResourceHostEntityState } from "./transport-host";
import { advanceSourceDayNight, sourceDayNightFromHeader, type SourceDayNight } from "./source-day-night";
import {
  completeLegacyInspireTask13, getLegacyInspireChargeGates, getLegacyInspireProfile,
  LEGACY_INSPIRE_NATIVE_RANDOM_TABLE, resolveLegacyInspireMultiplierQ8, scanLegacyInspireEffect,
  updateLegacyInspireCounters, verifiedLegacyInspireDeployFin,
  type LegacyInspireScanInput, type LegacyInspireScanResult, type LegacyInspireSlot, type LegacyInspireState,
} from "./legacy-inspire";

export interface NativeInspireIdentity {
  readonly slot: number;
  readonly generation: number;
}

export interface NativeInspireRegistration extends NativeInspireIdentity, LegacyInspireSlot, LegacyInspireState {
  readonly unitId: number | null;
  readonly typeId: number;
}

export interface NativeInspireAdapter {
  readRegisteredOrder(): readonly NativeInspireIdentity[];
  readPositionQ8(identity: NativeInspireIdentity): { readonly xQ8: number; readonly yQ8: number };
  readOccupancy(): Pick<LegacyInspireScanInput, "width" | "height" | "ground" | "air">;
  readRandomIndex(): number;
  commitRandomIndex(index: number): void;
  onTaskTransition(identity: NativeInspireIdentity, task: "idle" | "deploy"): void;
  afterEntityUpdate(identity: NativeInspireIdentity): void;
}

export interface NativeInspireSnapshot extends NativeInspireRegistration {
  readonly animationMode: 0 | 1 | 2;
  readonly pendingOrder: 0 | 1 | 13;
  readonly uiChargeReady: boolean;
  readonly deployChargeReady: boolean;
  readonly centersAim: boolean;
  readonly liveMultiplierQ8: number;
}

export interface NativeInspireEvent {
  readonly tick: number;
  readonly casterSlot: number;
  readonly type: "deploy" | "continue" | "clear" | "effect" | "rejected";
  readonly charge: number;
  readonly pendingOrder: number;
  readonly scan?: LegacyInspireScanResult;
  readonly reason?: string;
}

/** Browser-adapted Inspire (no native adapter): caster charge and inspired-target timers keyed by simulation unit id. */
export interface AdaptedInspireCheckpoint {
  readonly randomIndex: number;
  readonly casters: readonly { readonly unitId: number; readonly typeId: number; readonly charge: number }[];
  readonly targets: readonly {
    readonly unitId: number; readonly timer: number; readonly casterId: number; readonly multiplierQ8: number;
  }[];
}

export interface AdaptedInspireUnitState {
  readonly caster: boolean;
  readonly typeId: number | null;
  readonly charge: number;
  readonly ready: boolean;
  readonly timer: number;
  readonly liveMultiplierQ8: number;
}

interface NativeInspireEntity {
  registration: NativeInspireRegistration;
  state: LegacyInspireState;
  animationMode: 0 | 1 | 2;
  pendingOrder: 0 | 1 | 13;
}

export type Faction = "alien" | "human";
export type MovementPlane = "ground" | "air";
export type UnitActivity = "attack" | "build" | "die" | "harvest" | "idle" | "move";
export type BuildingKind = "barracks" | "core" | "research" | "turret";

export interface UnitSnapshot {
  readonly movementPlane?: MovementPlane;
  readonly id: number;
  readonly faction: Faction;
  readonly team?: number;
  readonly activity: UnitActivity;
  readonly xSubcells: number;
  readonly ySubcells: number;
  readonly cellX: number;
  readonly cellY: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly cargo: number;
  readonly cargoCapacity: number;
  readonly targetId: number | null;
  readonly resourceActor?: ResourceActorOwnership;
}

export interface ResourceActorIdentity {
  readonly simulationId: number;
  readonly slot: number;
  readonly generation: number;
  readonly key: string;
}

export interface ResourceActorToken extends ResourceActorIdentity {
  readonly ownershipGeneration: number;
}

export interface ResourceActorStateProfile {
  readonly nativeIdentity: Omit<ResourceActorIdentity, "simulationId">;
  readonly sourceTypeIndex: 6 | 14 | 47 | 48;
  readonly team: number;
  readonly xQ8: number;
  readonly yQ8: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly speedSubcellsPerTick: number;
  readonly weapon: null;
  readonly harvester: null;
  readonly sourceDefense: LegacyDefenseProfile;
  readonly vision: UnitVisionStats | null;
  readonly occupancy: readonly GridPoint[];
  readonly status: number;
  readonly task: "idle" | "extraction" | "retraction" | "removal" | "death";
  readonly taskWords: readonly number[];
  readonly taskOwner: {
    readonly provenance: "constructor" | "resume" | "source-idle";
    readonly evidence: string;
    readonly state: ResourceHostEntityState;
  };
}

export interface ResourceActorOwnership extends ResourceActorToken {
  readonly owner: "simulation" | "resource" | "pending-return" | "removed";
  readonly pendingReturn: { readonly ownershipGeneration: number } | null;
  readonly profile: ResourceActorStateProfile;
  readonly admission: { readonly token: ResourceActorToken; readonly profile: ResourceActorStateProfile } | null;
  readonly releaseAcknowledgement: ResourceActorReleaseAcknowledgement | null;
}

export interface ResourceActorReleaseAcknowledgement {
  readonly hostReleased: true;
  readonly ownershipGeneration: number;
  readonly sourceIdle: {
    readonly sourceTypeIndex: 6 | 14;
    readonly evidence: string;
    readonly directionSigned: number;
    readonly taskWords: readonly number[];
  };
}

export interface ResourceActorEvent extends ResourceActorToken {
  readonly tick: number;
  readonly type: "combat-death" | "remove-noncombat";
}

export interface ResourceNodeSnapshot {
  readonly id: number;
  readonly cellX: number;
  readonly cellY: number;
  readonly remaining: number;
}

export interface ConstructionSnapshot {
  readonly kind: BuildingKind;
  readonly targetCellX: number;
  readonly targetCellY: number;
  readonly remainingTicks: number;
  readonly totalTicks: number;
  readonly cost: number;
  readonly maxHealth: number;
}

export interface BuildingSnapshot {
  readonly id: number;
  readonly faction: Faction;
  readonly kind: BuildingKind;
  readonly cellX: number;
  readonly cellY: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly constructionQueue: readonly ConstructionSnapshot[];
}

export interface SimulationSnapshot {
  readonly tick: number;
  readonly nativeInspire?: readonly NativeInspireSnapshot[];
  readonly teamAlliances?: TeamAlliances;
  readonly entityCount: number;
  readonly timeOfDay: "day" | "night";
  readonly daylightPermille: number;
  readonly randomState: number;
  readonly resources: Readonly<Record<Faction, number>>;
  readonly buildings: readonly BuildingSnapshot[];
  readonly staticTargets: readonly StaticTargetSnapshot[];
  readonly resourceNodes: readonly ResourceNodeSnapshot[];
  readonly units: readonly UnitSnapshot[];
}

export interface Simulation {
  readonly snapshot: SimulationSnapshot;
  advance(): void;
}

export interface CombatEvent {
  readonly type: "shot";
  readonly tick: number;
  readonly attackerId: number;
  readonly targetId: number;
  readonly damage: number;
}

export interface DeathEvent {
  readonly type: "death";
  readonly tick: number;
  readonly targetId: number;
}

export interface MovementFinishedEvent {
  readonly unitId: number;
  readonly tick: number;
  readonly finalXQ8: number;
  readonly finalYQ8: number;
  readonly nativeIdentity?: ResourceActorToken;
}

export interface StaticTargetSnapshot {
  readonly mine?: BrowserMineOptions;
  readonly weapon?: WeaponStats;
  readonly targetId?: number | null;
  readonly attackCooldown?: number;
  readonly activity?: "idle" | "attack" | "die";
  readonly id: number;
  readonly faction: Faction;
  readonly team?: number;
  readonly xSubcells: number;
  readonly ySubcells: number;
  readonly cellX: number;
  readonly cellY: number;
  readonly health: number;
  readonly maxHealth: number;
}

interface StaticTargetState {
  readonly mine?: BrowserMineOptions;
  readonly weapon?: WeaponStats;
  readonly vision?: UnitVisionStats;
  attackCooldown?: number;
  attackTargetId?: number | null;
  readonly id: number;
  readonly faction: Faction;
  readonly team?: number;
  readonly xSubcells: number;
  readonly ySubcells: number;
  readonly footprint: readonly number[];
  health: number;
  readonly maxHealth: number;
  readonly sourceDefense: LegacyDefenseProfile | null;
}

export interface AddStaticTargetOptions {
  readonly mine?: BrowserMineOptions;
  readonly weapon?: WeaponStats;
  readonly vision?: UnitVisionStats;
  readonly faction: Faction;
  readonly team?: number;
  readonly cell: GridPoint;
  readonly maxHealth: number;
  readonly health?: number;
  readonly positionSubcells?: GridPoint;
  readonly footprint?: readonly GridPoint[];
  readonly sourceDefense?: LegacyDefenseProfile;
}

export type SimulationCommand =
  | { readonly type: "inspire"; readonly unitIds: readonly number[]; readonly team: number }
  | { readonly type: "move"; readonly unitIds: readonly number[]; readonly target: GridPoint }
  | { readonly type: "attack"; readonly unitIds: readonly number[]; readonly targetId: number }
  | {
      readonly type: "harvest";
      readonly unitIds: readonly number[];
      readonly resourceId: number;
      readonly dropoff: GridPoint;
    }
  | {
      readonly type: "build";
      readonly builderId: number;
      readonly kind: BuildingKind;
      readonly target: GridPoint;
      readonly cost: number;
      readonly buildTicks: number;
      readonly maxHealth: number;
    }
  | { readonly type: "stop"; readonly unitIds: readonly number[] };

export interface WeaponStats {
  readonly damage: number;
  readonly rangeCells: number;
  readonly cooldownTicks: number;
  readonly sourceDamage?: SourceDamageProfile;
}

export interface HarvesterStats {
  readonly cargoCapacity: number;
  readonly harvestPerTick: number;
}

export interface UnitVisionStats {
  readonly dayRangeCells: number;
  readonly nightRangeCells: number;
}

interface QueuedCommand {
  readonly tick: number;
  readonly sequence: number;
  readonly command: SimulationCommand;
}

interface UnitState {
  readonly movementPlane?: MovementPlane;
  readonly id: number;
  readonly faction: Faction;
  readonly team?: number;
  readonly speedSubcellsPerTick: number;
  activity: UnitActivity;
  xSubcells: number;
  ySubcells: number;
  path: readonly GridPoint[];
  pathIndex: number;
  reservedDestination: number | null;
  health: number;
  readonly maxHealth: number;
  readonly weapon: WeaponStats | null;
  readonly sourceDefense: LegacyDefenseProfile | null;
  readonly vision: UnitVisionStats | null;
  attackCooldown: number;
  attackTargetId: number | null;
  readonly harvester: HarvesterStats | null;
  cargo: number;
  resourceTargetId: number | null;
  dropoff: GridPoint | null;
  harvestPhase: "collecting" | "to-dropoff" | "to-resource" | null;
}

interface ResourceNodeState {
  readonly id: number;
  readonly cell: GridPoint;
  remaining: number;
}

interface ConstructionState extends ConstructionSnapshot {}

interface BuildingState {
  readonly id: number;
  readonly faction: Faction;
  readonly kind: BuildingKind;
  readonly cell: GridPoint;
  health: number;
  readonly maxHealth: number;
  readonly constructionQueue: ConstructionState[];
}

export interface SimulationCheckpoint {
  readonly version: 1 | 2;
  readonly grid: { readonly width: number; readonly height: number; readonly costs: readonly number[] };
  readonly tick: number;
  readonly nextEntityId: number;
  readonly nextCommandSequence: number;
  readonly randomState: number;
  readonly dayNightCycleTicks: number;
  readonly sourceDayNight: SourceDayNight | null;
  readonly teamAlliances: TeamAlliances;
  readonly resources: Readonly<Record<Faction, number>>;
  readonly units: readonly UnitState[];
  readonly resourceNodes: readonly ResourceNodeState[];
  readonly buildings: readonly BuildingState[];
  readonly staticTargets: readonly StaticTargetState[];
  readonly staticBlockers: readonly { readonly index: number; readonly count: number; readonly priorCost: number }[];
  readonly movementReservations: readonly { readonly index: number; readonly owners: readonly number[]; readonly plane?: MovementPlane }[];
  readonly commands: readonly QueuedCommand[];
  readonly combatEvents: readonly CombatEvent[];
  readonly deathEvents: readonly DeathEvent[];
  readonly sourceDamageDiagnostics: readonly { tick: number; attackerId: number; targetId: number; reason: string }[];
  readonly reservationEvents: readonly { unitId: number; tileX: number; tileY: number }[];
  readonly movementFinishedEvents?: readonly MovementFinishedEvent[];
  readonly resourceActors?: readonly ResourceActorOwnership[];
  readonly resourceActorEvents?: readonly ResourceActorEvent[];
  readonly adaptedInspire?: AdaptedInspireCheckpoint;
}

type CheckpointCheck = (value: unknown) => void;

function checkpointRequire(condition: boolean): asserts condition {
  if (!condition) throw new RangeError("Invalid simulation checkpoint");
}

function checkpointInteger(minimum = 0, maximum = Number.MAX_SAFE_INTEGER): CheckpointCheck {
  return (value) => checkpointRequire(typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum);
}

function checkpointChoice(...choices: readonly unknown[]): CheckpointCheck {
  return (value) => checkpointRequire(choices.includes(value));
}

function checkpointNullable(check: CheckpointCheck): CheckpointCheck {
  return (value) => { if (value !== null) check(value); };
}

function checkpointArray(check: CheckpointCheck): CheckpointCheck {
  return (value) => {
    checkpointRequire(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype);
    checkpointRequire(Reflect.ownKeys(value).length === value.length + 1);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      checkpointRequire(!!descriptor && "value" in descriptor && descriptor.enumerable === true);
      check(descriptor.value);
    }
  };
}

function checkpointObject(required: Record<string, CheckpointCheck>, optional: Record<string, CheckpointCheck> = {}): CheckpointCheck {
  return (value) => {
    checkpointRequire(typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    checkpointRequire(Reflect.ownKeys(value).every((key) => typeof key === "string" && (Object.hasOwn(required, key) || Object.hasOwn(optional, key))));
    for (const [key, check] of Object.entries(required)) {
      const descriptor = descriptors[key];
      checkpointRequire(!!descriptor && "value" in descriptor && descriptor.enumerable === true);
      check(descriptor.value);
    }
    for (const [key, check] of Object.entries(optional)) {
      const descriptor = descriptors[key];
      if (!descriptor) continue;
      checkpointRequire("value" in descriptor && descriptor.enumerable === true);
      check(descriptor.value);
    }
  };
}

const resourceIdentityChecks = {
  simulationId: checkpointInteger(1), slot: checkpointInteger(0, 799), generation: checkpointInteger(),
  key: (value: unknown) => checkpointRequire(typeof value === "string" && value.length > 0),
  ownershipGeneration: checkpointInteger(),
};

const resourceProfileCheck = checkpointObject({
  nativeIdentity: checkpointObject({ slot: resourceIdentityChecks.slot, generation: resourceIdentityChecks.generation, key: resourceIdentityChecks.key }),
  sourceTypeIndex: checkpointChoice(6, 14, 47, 48), team: checkpointInteger(0, 7),
  xQ8: checkpointInteger(0, 65535), yQ8: checkpointInteger(0, 65535),
  health: checkpointInteger(0, 0x7fffffff), maxHealth: checkpointInteger(1, 0x7fffffff),
  speedSubcellsPerTick: checkpointInteger(1), weapon: checkpointChoice(null), harvester: checkpointChoice(null),
  sourceDefense: checkpointObject({ targetClass: checkpointInteger(0, 9), armorFactor: checkpointInteger(0, 0x7fffffff),
    sourceTypeIndex: checkpointChoice(6, 14, 47, 48) }),
  vision: checkpointNullable(checkpointObject({ dayRangeCells: checkpointInteger(), nightRangeCells: checkpointInteger() })),
  occupancy: checkpointArray(checkpointObject({ x: checkpointInteger(), y: checkpointInteger() })),
  status: checkpointInteger(0, 255), task: checkpointChoice("idle", "extraction", "retraction", "removal", "death"),
  taskWords: checkpointArray(checkpointInteger(0, 65535)),
  taskOwner: checkpointObject({ provenance: checkpointChoice("constructor", "resume", "source-idle"),
    evidence: resourceIdentityChecks.key, state: checkpointObject({
      direction: checkpointInteger(0, 255), pendingOrder: checkpointInteger(0, 255), order: checkpointInteger(0, 255),
      animation: checkpointObject({ profile: resourceIdentityChecks.key, frame: checkpointInteger(0, 255),
        delay: checkpointInteger(0, 255), mode: checkpointChoice(0, 1, 2, 3) }),
      stack: checkpointArray(checkpointObject({ opcode: checkpointChoice(1, 3, 10, 12, 13), words: checkpointArray(checkpointInteger(0, 65535)) })),
      released: checkpointChoice(true, false),
    }, { nativeMovement: validateNativeMovement, nativeStopRequested: checkpointChoice(true),
      nativeBanks: (value: unknown) => checkpointRequire(value !== null && typeof value === "object" &&
        Object.entries(value).every(([key, bank]) => /^[A-Z]+$/.test(key) && Number.isInteger(bank) && bank > 0 && bank <= 0xffffffff)),
      nativeIdle: checkpointObject({ randomIndex: checkpointInteger(0, 255), observer: checkpointChoice(255),
      specialOrder: checkpointChoice(0), confusion: checkpointChoice(0), secondaryAnimationPending: checkpointChoice(0),
      secondaryAnimationsInactive: checkpointChoice(true), groundWord: checkpointInteger(0, 0xffffffff) }) }) }),
});

const resourceReleaseCheck = checkpointObject({ hostReleased: checkpointChoice(true), ownershipGeneration: checkpointInteger(1),
  sourceIdle: checkpointObject({ sourceTypeIndex: checkpointChoice(6, 14), evidence: resourceIdentityChecks.key,
    directionSigned: checkpointInteger(-128, 127), taskWords: checkpointArray(checkpointInteger(0, 65535)) }) });

function validateResourceRelease(actor: ResourceActorToken, acknowledgement: ResourceActorReleaseAcknowledgement,
  profile: ResourceActorStateProfile): void {
  resourceReleaseCheck(acknowledgement);
  const state = profile.taskOwner.state;
  checkpointRequire(acknowledgement.ownershipGeneration === actor.ownershipGeneration && resourceIdle(profile)
    && state.released && profile.taskOwner.provenance === "source-idle"
    && acknowledgement.sourceIdle.evidence === profile.taskOwner.evidence
    && acknowledgement.sourceIdle.sourceTypeIndex === profile.sourceTypeIndex
    && acknowledgement.sourceIdle.directionSigned === ((state.direction + 128) & 255) - 128
    && JSON.stringify(acknowledgement.sourceIdle.taskWords) === JSON.stringify(profile.taskWords));
}

function validateResourceAdmission(profile: ResourceActorStateProfile): void {
  resourceProfileCheck(profile);
  const state = profile.taskOwner.state;
  checkpointRequire(!state.released && profile.taskOwner.provenance !== "source-idle" && profile.health > 0
    && profile.status === 1 && state.pendingOrder === 0 && [0, 255].includes(state.order));
  checkpointRequire(profile.task !== "death" && profile.task !== "removal"
    && JSON.stringify(profile.taskWords) === JSON.stringify(state.stack.at(-1)?.words)
    && profile.sourceDefense.sourceTypeIndex === profile.sourceTypeIndex);
  if (profile.taskOwner.provenance === "constructor") checkpointRequire(resourceIdle(profile)
    && state.direction === (profile.sourceTypeIndex === 6 ? 160 : 128)
    && state.animation.profile === (profile.sourceTypeIndex === 6 ? "EXPLSTAND" : "SLUGSTAND")
    && state.animation.frame === 0 && state.animation.delay === 0 && state.animation.mode === 0
    && JSON.stringify(profile.taskWords) === "[65535,0,0]");
}

function sameResourceIdentity(left: ResourceActorToken, right: ResourceActorToken): boolean {
  return left.simulationId === right.simulationId && left.slot === right.slot && left.generation === right.generation
    && left.key === right.key && left.ownershipGeneration === right.ownershipGeneration;
}

function resourceToken(actor: ResourceActorToken): ResourceActorToken {
  const { simulationId, slot, generation, key, ownershipGeneration } = actor;
  return { simulationId, slot, generation, key, ownershipGeneration };
}

function resourceCommandConflict(command: SimulationCommand, simulationId: number): boolean {
  return command.type === "build" ? command.builderId === simulationId
    : command.unitIds.includes(simulationId) || (command.type === "attack" && command.targetId === simulationId);
}

function resourceIdle(profile: ResourceActorStateProfile): boolean {
  const state = profile.taskOwner.state;
  return profile.health > 0 && profile.status === 1 && profile.task === "idle"
    && (profile.sourceTypeIndex === 6 || profile.sourceTypeIndex === 14)
    && (state.stack.length === 1 || (state.stack.length === 2 && !!state.nativeIdle && state.stack[1].opcode === 3))
    && !state.nativeMovement && state.stack[0].opcode === 1 && state.stack[0].words[0] === 65535
    && state.pendingOrder === 0 && (state.order === 0 || state.order === 255);
}

function copyResourceActor(actor: ResourceActorOwnership): ResourceActorOwnership {
  checkpointRequire(JSON.stringify(actor.profile.taskWords) === JSON.stringify(actor.profile.taskOwner.state.stack.at(-1)?.words));
  const copy = structuredClone(actor);
  return { ...copy, profile: { ...copy.profile, taskWords: copy.profile.taskOwner.state.stack.at(-1)!.words } };
}

function validateSimulationCheckpoint(input: unknown): asserts input is SimulationCheckpoint {
  const integer = checkpointInteger();
  const positive = checkpointInteger(1);
  const nullableId = checkpointNullable(positive);
  const point = checkpointObject({ x: integer, y: integer });
  const faction = checkpointChoice("human", "alien");
  const kind = checkpointChoice("barracks", "core", "research", "turret");
  const defense = checkpointObject({ targetClass: checkpointInteger(0, 9), armorFactor: checkpointInteger(0, 0x7fffffff) }, { sourceTypeIndex: integer });
  const coefficients = checkpointArray(checkpointInteger(0, 32767));
  const damage: CheckpointCheck = (value) => {
    checkpointRequire(typeof value === "object" && value !== null);
    if (Object.hasOwn(value, "mode")) {
      checkpointObject({ mode: checkpointChoice("verified-native-ordinary"), coefficients,
        sourceTypeIndex: checkpointChoice(...VERIFIED_NATIVE_SOURCE_TYPES), sourceTypeFaction: checkpointChoice(0, 1),
        weaponId: checkpointChoice(...VERIFIED_NATIVE_WEAPON_IDS) })(value);
    } else {
      checkpointObject({ coefficients, callerFactor: checkpointInteger(0, 0x7fffffff), specialFlag: checkpointChoice(true, false) })(value);
    }
    copySourceDamageProfile(value as SourceDamageProfile);
  };
  const weapon = checkpointObject({ damage: integer, rangeCells: integer, cooldownTicks: positive }, { sourceDamage: damage });
  const construction = checkpointObject({ kind, targetCellX: integer, targetCellY: integer,
    remainingTicks: positive, totalTicks: positive, cost: integer, maxHealth: positive });
  const command: CheckpointCheck = (value) => {
    checkpointRequire(typeof value === "object" && value !== null);
    const descriptor = Object.getOwnPropertyDescriptor(value, "type");
    checkpointRequire(!!descriptor && "value" in descriptor);
    const type = descriptor.value;
    const unitIds = checkpointArray(positive);
    switch (type) {
      case "move": checkpointObject({ type: checkpointChoice(type), unitIds, target: point })(value); break;
      case "attack": checkpointObject({ type: checkpointChoice(type), unitIds, targetId: positive })(value); break;
      case "harvest": checkpointObject({ type: checkpointChoice(type), unitIds, resourceId: positive, dropoff: point })(value); break;
      case "build": checkpointObject({ type: checkpointChoice(type), builderId: positive, kind, target: point, cost: integer, buildTicks: positive, maxHealth: positive })(value); break;
      case "stop": checkpointObject({ type: checkpointChoice(type), unitIds })(value); break;
      case "inspire": checkpointObject({ type: checkpointChoice(type), unitIds, team: checkpointInteger(0, 7) })(value); break;
      default: checkpointRequire(false);
    }
  };
  const position: CheckpointCheck = (value) => checkpointRequire(typeof value === "number" && Number.isFinite(value) && value >= 0);
  checkpointObject({
    version: checkpointChoice(1, 2), grid: checkpointObject({ width: positive, height: positive, costs: checkpointArray(checkpointInteger(0, 65535)) }),
    tick: integer, nextEntityId: positive, nextCommandSequence: integer, randomState: checkpointInteger(1, 0xffffffff), dayNightCycleTicks: checkpointInteger(4),
    sourceDayNight: checkpointNullable(checkpointObject({ phase: checkpointChoice(0, 1), cycleLength: positive, elapsed: integer, transitionTicks: positive, blend: checkpointInteger(0, 256) })),
    teamAlliances: checkpointArray(checkpointArray(checkpointChoice(0, 1))), resources: checkpointObject({ human: integer, alien: integer }),
    units: checkpointArray(checkpointObject({ id: positive, faction, speedSubcellsPerTick: positive,
      activity: checkpointChoice("attack", "build", "die", "harvest", "idle", "move"), xSubcells: integer, ySubcells: integer,
      path: checkpointArray(point), pathIndex: integer, reservedDestination: checkpointNullable(integer), health: integer, maxHealth: positive,
      weapon: checkpointNullable(weapon), sourceDefense: checkpointNullable(defense),
      vision: checkpointNullable(checkpointObject({ dayRangeCells: integer, nightRangeCells: integer })),
      attackCooldown: integer, attackTargetId: nullableId,
      harvester: checkpointNullable(checkpointObject({ cargoCapacity: positive, harvestPerTick: positive })), cargo: integer,
      resourceTargetId: nullableId, dropoff: checkpointNullable(point), harvestPhase: checkpointChoice(null, "collecting", "to-dropoff", "to-resource"),
    }, { team: integer, movementPlane: checkpointChoice("ground", "air") })),
    resourceNodes: checkpointArray(checkpointObject({ id: positive, cell: point, remaining: integer })),
    buildings: checkpointArray(checkpointObject({ id: positive, faction, kind, cell: point, health: integer, maxHealth: positive, constructionQueue: checkpointArray(construction) })),
    staticTargets: checkpointArray(checkpointObject({ id: positive, faction, xSubcells: position, ySubcells: position,
      footprint: checkpointArray(integer), health: integer, maxHealth: positive, sourceDefense: checkpointNullable(defense) },
    { team: integer, weapon, mine: (value) => {
      validateBrowserMineOptions(value as BrowserMineOptions);
      weapon((value as BrowserMineOptions).weapon);
    }, vision: checkpointObject({ dayRangeCells: integer, nightRangeCells: integer }),
      attackCooldown: integer, attackTargetId: nullableId })),
    staticBlockers: checkpointArray(checkpointObject({ index: integer, count: positive, priorCost: checkpointInteger(0, 65535) })),
    movementReservations: checkpointArray(checkpointObject({ index: integer, owners: checkpointArray(positive) },
      { plane: checkpointChoice("ground", "air") })),
    commands: checkpointArray(checkpointObject({ tick: integer, sequence: integer, command })),
    combatEvents: checkpointArray(checkpointObject({ type: checkpointChoice("shot"), tick: integer, attackerId: positive, targetId: positive, damage: integer })),
    deathEvents: checkpointArray(checkpointObject({ type: checkpointChoice("death"), tick: integer, targetId: positive })),
    sourceDamageDiagnostics: checkpointArray(checkpointObject({ tick: integer, attackerId: positive, targetId: positive, reason: (value) => checkpointRequire(typeof value === "string") })),
    reservationEvents: checkpointArray(checkpointObject({ unitId: positive, tileX: integer, tileY: integer })),
  }, { movementFinishedEvents: checkpointArray(checkpointObject({ unitId: positive, tick: integer,
    finalXQ8: integer, finalYQ8: integer }, { nativeIdentity: checkpointObject(resourceIdentityChecks) })),
    resourceActors: checkpointArray(checkpointObject({ ...resourceIdentityChecks,
      owner: checkpointChoice("simulation", "resource", "pending-return", "removed"),
      pendingReturn: checkpointNullable(checkpointObject({ ownershipGeneration: integer })), profile: resourceProfileCheck,
      admission: checkpointNullable(checkpointObject({ token: checkpointObject(resourceIdentityChecks), profile: resourceProfileCheck })),
      releaseAcknowledgement: checkpointNullable(resourceReleaseCheck) })),
    resourceActorEvents: checkpointArray(checkpointObject({ ...resourceIdentityChecks, tick: integer,
      type: checkpointChoice("combat-death", "remove-noncombat") })),
    adaptedInspire: checkpointObject({ randomIndex: checkpointInteger(0, 255),
      casters: checkpointArray(checkpointObject({ unitId: positive, typeId: checkpointInteger(69, 76), charge: checkpointInteger(0, 255) })),
      targets: checkpointArray(checkpointObject({ unitId: positive, timer: checkpointInteger(1, 255), casterId: positive,
        multiplierQ8: checkpointChoice(332, 358, 384, 409) })) }),
  })(input);
  const saved = input as SimulationCheckpoint;
  const area = saved.grid.width * saved.grid.height;
  checkpointRequire(Number.isSafeInteger(area) && area === saved.grid.costs.length);
  checkpointRequire(Number.isSafeInteger(saved.grid.width * SUBCELLS_PER_CELL) && Number.isSafeInteger(saved.grid.height * SUBCELLS_PER_CELL));
  const cell = (point: GridPoint) => checkpointRequire(point.x < saved.grid.width && point.y < saved.grid.height);
  const index = (value: number) => checkpointRequire(value < area);
  const historicalId = (value: number) => checkpointRequire(value < saved.nextEntityId);
  const allIds = new Set<number>();
  for (const entity of [...saved.units, ...saved.staticTargets, ...saved.resourceNodes, ...saved.buildings]) {
    historicalId(entity.id);
    checkpointRequire(!allIds.has(entity.id));
    allIds.add(entity.id);
  }
  const units = new Set(saved.units.map((unit) => unit.id));
  if (saved.adaptedInspire) {
    const alive = new Set(saved.units.filter((unit) => unit.health > 0).map((unit) => unit.id));
    for (const records of [saved.adaptedInspire.casters, saved.adaptedInspire.targets]) {
      const ids = records.map((record) => record.unitId);
      checkpointRequire(new Set(ids).size === ids.length && ids.every((id) => alive.has(id)));
    }
    for (const target of saved.adaptedInspire.targets) historicalId(target.casterId);
  }
  const actorIds = new Set<number>();
  const actorSlots = new Set<number>();
  const actorKeys = new Set<string>();
  for (const actor of saved.resourceActors ?? []) {
    historicalId(actor.simulationId);
    checkpointRequire(!actorIds.has(actor.simulationId));
    actorIds.add(actor.simulationId);
    const profile = actor.profile;
    const state = profile.taskOwner.state;
    if (state.nativeMovement) {
      const movement = state.nativeMovement.state;
      checkpointRequire(actor.owner === "resource" || actor.owner === "pending-return");
      checkpointRequire(movement.slot === actor.slot && movement.typeId === profile.sourceTypeIndex && movement.team === profile.team
        && movement.xQ8 === profile.xQ8 && movement.yQ8 === profile.yQ8 && movement.hp === profile.health);
    }
    checkpointRequire(profile.nativeIdentity.slot === actor.slot && profile.nativeIdentity.generation === actor.generation
      && profile.nativeIdentity.key === actor.key);
    checkpointRequire((actor.ownershipGeneration === 0) === (actor.admission === null));
    if (actor.admission) {
      checkpointRequire(sameResourceIdentity(actor, actor.admission.token));
      validateResourceAdmission(actor.admission.profile);
      checkpointRequire(actor.admission.profile.nativeIdentity.slot === actor.slot
        && actor.admission.profile.nativeIdentity.generation === actor.generation && actor.admission.profile.nativeIdentity.key === actor.key
        && actor.admission.profile.team === profile.team
        && [6, 47].includes(actor.admission.profile.sourceTypeIndex) === [6, 47].includes(profile.sourceTypeIndex));
    }
    checkpointRequire(actor.releaseAcknowledgement === null || actor.owner === "simulation");
    checkpointRequire(profile.xQ8 < saved.grid.width * 256 && profile.yQ8 < saved.grid.height * 256);
    checkpointRequire(profile.sourceDefense.sourceTypeIndex === profile.sourceTypeIndex);
    checkpointRequire(profile.health > 0 || profile.task === "death" || profile.task === "removal");
    checkpointRequire(profile.task !== "death" || profile.health === 0);
    checkpointRequire(state.stack.length > 0 && state.stack.length <= 3);
    for (const task of state.stack) checkpointRequire(task.words.length === ({ 1: 3, 3: 2, 10: 2, 12: 3, 13: 1 }[task.opcode]));
    const stack = state.stack.map((task) => task.opcode).join(",");
    checkpointRequire(["1", "1,3", "1,12", "1,3,12", "13", "1,13", "1,12,13", "10"].includes(stack));
    if (state.stack.some(task => task.opcode === 3)) checkpointRequire(!!state.nativeIdle &&
      state.stack[0].words[0] === 65535 && state.stack[0].words[1] <= 32767 && state.stack[0].words[2] === 0 &&
      state.stack[1].words[0] <= 7 && state.stack[1].words[1] <= 32767);
    if (state.nativeIdle) checkpointRequire((state.nativeIdle.groundWord & 1023) === actor.slot);
    const top = state.stack.at(-1)!;
    checkpointRequire(JSON.stringify(profile.taskWords) === JSON.stringify(top.words));
    checkpointRequire(top.opcode === ({ idle: 1, extraction: 12, retraction: 13, removal: 10, death: 10 }[profile.task])
      || (profile.task === "idle" && top.opcode === 3 && [6, 14].includes(profile.sourceTypeIndex)));
    profile.occupancy.forEach(cell);
    checkpointRequire(new Set(profile.occupancy.map((point) => point.y * saved.grid.width + point.x)).size === profile.occupancy.length);
    checkpointRequire((actor.owner === "pending-return") === (actor.pendingReturn !== null));
    if (actor.pendingReturn) checkpointRequire(actor.pendingReturn.ownershipGeneration === actor.ownershipGeneration && actor.ownershipGeneration > 0);
    if (actor.owner === "removed") {
      checkpointRequire(!allIds.has(actor.simulationId) && profile.occupancy.length === 0 && profile.status === 0);
      continue;
    }
    checkpointRequire(!actorSlots.has(actor.slot) && !actorKeys.has(actor.key));
    actorSlots.add(actor.slot); actorKeys.add(actor.key);
    const unit = saved.units.find((entry) => entry.id === actor.simulationId);
    checkpointRequire(!!unit && unit.team === profile.team && unit.movementPlane !== "air");
    checkpointRequire(unit.faction === ([6, 47].includes(profile.sourceTypeIndex) ? "human" : "alien"));
    checkpointRequire(unit.weapon === null && unit.harvester === null && unit.maxHealth === profile.maxHealth
      && unit.speedSubcellsPerTick === profile.speedSubcellsPerTick
      && JSON.stringify(unit.sourceDefense) === JSON.stringify(profile.sourceDefense)
      && JSON.stringify(unit.vision) === JSON.stringify(profile.vision));
    if (actor.owner === "simulation") {
      checkpointRequire(resourceIdle(profile));
      checkpointRequire(actor.ownershipGeneration === 0 ? !state.released : state.released && profile.taskOwner.provenance === "source-idle");
      if (actor.ownershipGeneration > 0) {
        checkpointRequire(actor.releaseAcknowledgement !== null);
        validateResourceRelease(actor, actor.releaseAcknowledgement, profile);
      } else checkpointRequire(actor.releaseAcknowledgement === null);
    } else {
      checkpointRequire(actor.ownershipGeneration > 0 && (!state.released || actor.owner === "pending-return"));
      checkpointRequire(unit.xSubcells === profile.xQ8 * SUBCELLS_PER_CELL / 256
        && unit.ySubcells === profile.yQ8 * SUBCELLS_PER_CELL / 256 && unit.health === profile.health);
      checkpointRequire(unit.activity === (profile.health === 0 ? "die" : state.nativeMovement ? "move" : "idle") && unit.path.length === 0
        && unit.pathIndex === 0 && unit.reservedDestination === null && unit.attackTargetId === null && unit.attackCooldown === 0
        && unit.resourceTargetId === null && unit.dropoff === null && unit.harvestPhase === null && unit.cargo === 0);
      checkpointRequire(!saved.commands.some(({ command }) => resourceCommandConflict(command, actor.simulationId)));
      checkpointRequire(!saved.units.some((other) => other.attackTargetId === actor.simulationId));
    }
  }
  for (const event of saved.resourceActorEvents ?? []) {
    const actor = saved.resourceActors?.find((entry) => entry.simulationId === event.simulationId);
    checkpointRequire(!!actor && sameResourceIdentity(actor, event) && (event.tick === saved.tick || event.tick === saved.tick - 1));
    checkpointRequire(event.type === "remove-noncombat" ? actor.owner === "removed" : actor.profile.health === 0);
  }
  const targets = new Set([...units, ...saved.staticTargets.map((target) => target.id)]);
  const nodes = new Set(saved.resourceNodes.map((node) => node.id));
  const buildings = new Set(saved.buildings.map((building) => building.id));
  const referenceKind = (value: number, allowed: ReadonlySet<number>) => checkpointRequire(!allIds.has(value) || allowed.has(value));
  const targetReference = (value: number) => {
    historicalId(value);
    checkpointRequire(!allIds.has(value) || targets.has(value));
  };
  for (const unit of saved.units) {
    checkpointRequire(unit.xSubcells < saved.grid.width * SUBCELLS_PER_CELL && unit.ySubcells < saved.grid.height * SUBCELLS_PER_CELL);
    checkpointRequire((unit.health === 0) === (unit.activity === "die"));
    checkpointRequire(unit.pathIndex <= unit.path.length);
    unit.path.forEach(cell);
    if (unit.reservedDestination !== null) index(unit.reservedDestination);
    if (unit.attackTargetId !== null) targetReference(unit.attackTargetId);
    if (unit.resourceTargetId !== null) checkpointRequire(nodes.has(unit.resourceTargetId));
    if (unit.dropoff) cell(unit.dropoff);
    checkpointRequire(unit.cargo <= (unit.harvester?.cargoCapacity ?? 0));
    checkpointRequire(unit.attackCooldown <= (unit.weapon?.cooldownTicks ?? 0));
    if (unit.weapon) checkpointRequire(unit.weapon.sourceDamage ? unit.weapon.damage <= 0x7fffffff : unit.weapon.damage > 0);
    if (unit.activity === "attack") checkpointRequire(unit.weapon !== null && unit.attackTargetId !== null);
    if (unit.activity === "harvest") checkpointRequire(unit.harvester !== null && unit.resourceTargetId !== null && unit.dropoff !== null && unit.harvestPhase !== null);
  }
  saved.resourceNodes.forEach((node) => cell(node.cell));
  const buildingCells = new Set<number>();
  const constructionCells = new Set<number>();
  for (const building of saved.buildings) {
    cell(building.cell);
    const tile = building.cell.y * saved.grid.width + building.cell.x;
    checkpointRequire(!buildingCells.has(tile));
    buildingCells.add(tile);
    for (const construction of building.constructionQueue) {
      cell({ x: construction.targetCellX, y: construction.targetCellY });
      checkpointRequire(construction.remainingTicks <= construction.totalTicks);
      const destination = construction.targetCellY * saved.grid.width + construction.targetCellX;
      checkpointRequire(!constructionCells.has(destination));
      constructionCells.add(destination);
    }
  }
  checkpointRequire([...constructionCells].every((tile) => !buildingCells.has(tile)));
  const blockers = new Map<number, number>();
  for (const target of saved.staticTargets) {
    if (target.mine) checkpointRequire(!target.weapon && target.footprint.length === 0
      && target.team !== undefined && target.team <= 8
      && (target.sourceDefense?.sourceTypeIndex === undefined || target.sourceDefense.sourceTypeIndex === target.mine.sourceTypeIndex));
    if (target.weapon) {
      checkpointRequire(target.attackCooldown !== undefined && target.attackCooldown <= target.weapon.cooldownTicks
        && target.attackTargetId !== undefined);
      checkpointRequire(target.weapon.sourceDamage ? target.weapon.damage <= 0x7fffffff : target.weapon.damage > 0);
      if (target.attackTargetId !== null) {
        targetReference(target.attackTargetId!);
        checkpointRequire(target.attackTargetId !== target.id && target.health > 0);
      }
    } else checkpointRequire(target.attackCooldown === undefined && target.attackTargetId === undefined && target.vision === undefined);
    checkpointRequire(target.xSubcells < saved.grid.width * SUBCELLS_PER_CELL && target.ySubcells < saved.grid.height * SUBCELLS_PER_CELL);
    checkpointRequire(new Set(target.footprint).size === target.footprint.length);
    for (const tile of target.footprint) {
      index(tile);
      if (target.health > 0) blockers.set(tile, (blockers.get(tile) ?? 0) + 1);
    }
  }
  for (const blocker of saved.staticBlockers) {
    index(blocker.index);
    checkpointRequire(blockers.get(blocker.index) === blocker.count);
    blockers.delete(blocker.index);
  }
  checkpointRequire(blockers.size === 0);
  const reservationTiles = new Set<string>();
  for (const reservation of saved.movementReservations) {
    index(reservation.index);
    const key = `${reservation.plane ?? "ground"}:${reservation.index}`;
    checkpointRequire(!reservationTiles.has(key) && reservation.owners.length > 0 && new Set(reservation.owners).size === reservation.owners.length);
    reservationTiles.add(key);
    reservation.owners.forEach((owner) => {
      historicalId(owner);
      checkpointRequire(!allIds.has(owner) || units.has(owner));
      const unit = saved.units.find(unit => unit.id === owner);
      checkpointRequire(!unit || (unit.movementPlane ?? "ground") === (reservation.plane ?? "ground"));
    });
  }
  const sequences = new Set<number>();
  let previous: QueuedCommand | undefined;
  for (const queued of saved.commands) {
    checkpointRequire(queued.tick >= saved.tick && queued.sequence < saved.nextCommandSequence && !sequences.has(queued.sequence));
    checkpointRequire(!previous || queued.tick > previous.tick || (queued.tick === previous.tick && queued.sequence > previous.sequence));
    sequences.add(queued.sequence);
    previous = queued;
    const command = queued.command;
    if (command.type === "build") referenceKind(command.builderId, buildings);
    else command.unitIds.forEach((unitId) => referenceKind(unitId, units));
    if (command.type === "move" || command.type === "build") cell(command.target);
    if (command.type === "attack") referenceKind(command.targetId, targets);
    if (command.type === "harvest") {
      cell(command.dropoff);
      referenceKind(command.resourceId, nodes);
    }
  }
  for (const event of [...saved.combatEvents, ...saved.deathEvents, ...saved.sourceDamageDiagnostics]) {
    checkpointRequire(event.tick === saved.tick - 1);
    targetReference(event.targetId);
    if ("attackerId" in event) {
      historicalId(event.attackerId);
      checkpointRequire(!allIds.has(event.attackerId) || units.has(event.attackerId)
        || saved.staticTargets.some(target => target.id === event.attackerId && (!!target.weapon || !!target.mine)));
    }
  }
  for (const event of saved.reservationEvents) {
    historicalId(event.unitId);
    checkpointRequire(!allIds.has(event.unitId) || units.has(event.unitId));
    cell({ x: event.tileX, y: event.tileY });
  }
  for (const event of saved.movementFinishedEvents ?? []) {
    historicalId(event.unitId);
    checkpointRequire(event.tick === saved.tick - 1);
    checkpointRequire(event.finalXQ8 < saved.grid.width * 256 && event.finalYQ8 < saved.grid.height * 256);
    if (event.nativeIdentity) {
      const actor = saved.resourceActors?.find((entry) => entry.simulationId === event.unitId);
      checkpointRequire(!!actor && event.nativeIdentity.simulationId === event.unitId
        && actor.slot === event.nativeIdentity.slot && actor.generation === event.nativeIdentity.generation
        && actor.key === event.nativeIdentity.key && actor.ownershipGeneration >= event.nativeIdentity.ownershipGeneration);
    }
  }
  if (saved.sourceDayNight) checkpointRequire(saved.sourceDayNight.transitionTicks <= saved.sourceDayNight.cycleLength);
}

export interface SimulationOptions {
  readonly seed?: number;
  readonly teamAlliances?: TeamAlliances;
  readonly dayNightCycleTicks?: number;
  readonly initialResources?: Partial<Record<Faction, number>>;
  readonly sourceDayNightHeader?: readonly string[];
  readonly nativeInspire?: NativeInspireAdapter;
}

export interface AddUnitOptions {
  readonly movementPlane?: MovementPlane;
  readonly faction: Faction;
  readonly team?: number;
  readonly cell: GridPoint;
  readonly speedSubcellsPerTick?: number;
  readonly maxHealth?: number;
  readonly health?: number;
  readonly positionSubcells?: GridPoint;
  readonly weapon?: WeaponStats;
  readonly sourceDefense?: LegacyDefenseProfile;
  readonly vision?: UnitVisionStats;
  readonly harvester?: HarvesterStats;
}

export interface AddResourceNodeOptions {
  readonly cell: GridPoint;
  readonly amount: number;
}

export interface AddBuildingOptions {
  readonly faction: Faction;
  readonly kind: BuildingKind;
  readonly cell: GridPoint;
  readonly maxHealth?: number;
}

function cellCenter(cell: number): number {
  return cell * SUBCELLS_PER_CELL + SUBCELLS_PER_CELL / 2;
}

export function baseNodeCells(core: GridPoint, radius = 2): readonly GridPoint[] {
  if (!Number.isInteger(radius) || radius <= 0) throw new RangeError("base node radius must be positive");
  return [
    { x: core.x, y: core.y - radius },
    { x: core.x + radius, y: core.y - radius },
    { x: core.x + radius, y: core.y },
    { x: core.x + radius, y: core.y + radius },
    { x: core.x, y: core.y + radius },
    { x: core.x - radius, y: core.y + radius },
    { x: core.x - radius, y: core.y },
    { x: core.x - radius, y: core.y - radius },
  ];
}

export class DeterministicSimulation implements Simulation {
  readonly grid: NavigationGrid;
  readonly random: DeterministicRandom;
  #teamAlliances: TeamAlliances;
  readonly dayNightCycleTicks: number;
  readonly #units = new Map<number, UnitState>();
  readonly #resourceNodes = new Map<number, ResourceNodeState>();
  readonly #buildings = new Map<number, BuildingState>();
  readonly #staticTargets = new Map<number, StaticTargetState>();
  readonly #staticBlockers = new Map<number, { count: number; readonly priorCost: number }>();
  // Caller-supplied before each advance (derived from checkpointed campaign state), so it is not part of the checkpoint.
  readonly #dormantUnits = new Set<number>();
  readonly #commands: QueuedCommand[] = [];
  readonly #combatEvents: CombatEvent[] = [];
  readonly #sourceDamageDiagnostics: { tick: number; attackerId: number; targetId: number; reason: string }[] = [];
  readonly #deathEvents: DeathEvent[] = [];
  readonly #reservationEvents: { unitId: number; tileX: number; tileY: number }[] = [];
  readonly #movementFinishedEvents: MovementFinishedEvent[] = [];
  readonly #resourceActors = new Map<number, ResourceActorOwnership>();
  readonly #resourceActorEvents: ResourceActorEvent[] = [];
  readonly #resources: Record<Faction, number> = { alien: 0, human: 0 };
  readonly #movementReservations = new Map<number, Set<number>>();
  readonly #airMovementReservations = new Map<number, Set<number>>();
  readonly #airGrid: NavigationGrid;
  #tick = 0;
  #nextEntityId = 1;
  #nextCommandSequence = 0;
  #sourceDayNight: SourceDayNight | null = null;
  readonly #nativeInspire: NativeInspireAdapter | null;
  readonly #inspireSlots = new Map<number, NativeInspireEntity>();
  readonly #inspireUnitSlots = new Map<number, number>();
  readonly #inspireEvents: NativeInspireEvent[] = [];
  readonly #adaptedInspireCasters = new Map<number, { typeId: number; charge: number }>();
  readonly #adaptedInspireTargets = new Map<number, { timer: number; casterId: number; multiplierQ8: number }>();
  #adaptedInspireRandomIndex = 0;

  constructor(grid: NavigationGrid, options: SimulationOptions = {}) {
    this.grid = grid;
    this.#airGrid = new NavigationGrid(grid.width, grid.height);
    this.#teamAlliances = copyTeamAlliances(options.teamAlliances);
    this.#sourceDayNight = options.sourceDayNightHeader ? sourceDayNightFromHeader(options.sourceDayNightHeader) : null;
    this.#nativeInspire = options.nativeInspire ?? null;
    if (this.#nativeInspire && !this.#sourceDayNight) throw new RangeError("native Inspire requires sourceDayNightHeader");
    this.random = new DeterministicRandom(options.seed ?? 1);
    this.dayNightCycleTicks = options.dayNightCycleTicks ?? 12_000;
    if (!Number.isInteger(this.dayNightCycleTicks) || this.dayNightCycleTicks < 4) {
      throw new RangeError("dayNightCycleTicks must be an integer of at least 4");
    }
    for (const faction of ["human", "alien"] as const) {
      const amount = options.initialResources?.[faction] ?? 0;
      if (!Number.isInteger(amount) || amount < 0) {
        throw new RangeError(`initial ${faction} resources must be a non-negative integer`);
      }
      this.#resources[faction] = amount;
    }
  }

  setTeamAlliances(alliances: TeamAlliances): void {
    if (!Array.isArray(alliances) || alliances.length === 0
      || alliances.some(row => !Array.isArray(row) || row.length !== alliances.length)) {
      throw new RangeError("team alliances must be a nonempty square matrix");
    }
    this.#teamAlliances = copyTeamAlliances(alliances);
  }

  checkpoint(): SimulationCheckpoint {
    const checkpoint = this.#capture();
    validateSimulationCheckpoint(checkpoint);
    return checkpoint;
  }

  /** Exact copy for transactional staging; the source is already valid, so the checkpoint round-trip checks are skipped. */
  fork(): DeterministicSimulation {
    // The map-sized cost grid is copied as a typed array; boxing it into a plain array for structuredClone cost ~0.5 ms per tick.
    return DeterministicSimulation.#fromCheckpoint(this.#capture(false), this.grid.costs);
  }

  #capture(includeCosts = true): SimulationCheckpoint {
    if (this.#nativeInspire) throw new RangeError("Cannot checkpoint external nativeInspire: no verified adapter state export/import contract");
    return structuredClone({
      version: (this.#resourceActors.size ? 2 : 1) as 1 | 2,
      grid: { width: this.grid.width, height: this.grid.height, costs: includeCosts ? Array.from(this.grid.costs) : [] },
      tick: this.#tick, nextEntityId: this.#nextEntityId, nextCommandSequence: this.#nextCommandSequence,
      randomState: this.random.state, dayNightCycleTicks: this.dayNightCycleTicks,
      sourceDayNight: this.#sourceDayNight, teamAlliances: this.#teamAlliances, resources: this.#resources,
      units: [...this.#units.values()].map(({ team, ...unit }) => ({ ...unit, ...(team === undefined ? {} : { team }) })),
      resourceNodes: [...this.#resourceNodes.values()], buildings: [...this.#buildings.values()],
      staticTargets: [...this.#staticTargets.values()].map(({ team, ...target }) => ({ ...target, ...(team === undefined ? {} : { team }) })),
      staticBlockers: [...this.#staticBlockers].map(([index, blocker]) => ({ index, ...blocker })),
      movementReservations: [
        ...[...this.#movementReservations].map(([index, owners]) => ({ index, owners: [...owners] })),
        ...[...this.#airMovementReservations].map(([index, owners]) => ({ index, owners: [...owners], plane: "air" as const })),
      ],
      commands: this.#commands, combatEvents: this.#combatEvents, deathEvents: this.#deathEvents,
      sourceDamageDiagnostics: this.#sourceDamageDiagnostics, reservationEvents: this.#reservationEvents,
      movementFinishedEvents: this.#movementFinishedEvents,
      resourceActors: [...this.#resourceActors.values()], resourceActorEvents: this.#resourceActorEvents,
      ...this.#adaptedInspireCheckpoint(),
    });
  }

  #adaptedInspireCheckpoint(): { adaptedInspire?: AdaptedInspireCheckpoint } {
    const live = (id: number) => this.#adaptedInspireLive(id);
    const casters = [...this.#adaptedInspireCasters].filter(([id]) => live(id))
      .map(([unitId, { typeId, charge }]) => ({ unitId, typeId, charge }));
    const targets = [...this.#adaptedInspireTargets].filter(([id, target]) => live(id) && target.timer > 0)
      .map(([unitId, { timer, casterId, multiplierQ8 }]) => ({ unitId, timer, casterId, multiplierQ8 }));
    if (!casters.length && !targets.length && this.#adaptedInspireRandomIndex === 0) return {};
    return { adaptedInspire: { randomIndex: this.#adaptedInspireRandomIndex, casters, targets } };
  }

  #adaptedInspireLive(id: number): boolean {
    const unit = this.#units.get(id);
    return !!unit && unit.health > 0 && unit.activity !== "die";
  }

  static restore(input: unknown): DeterministicSimulation {
    validateSimulationCheckpoint(input);
    return DeterministicSimulation.#fromCheckpoint(structuredClone(input));
  }

  static #fromCheckpoint(saved: SimulationCheckpoint, costs?: ArrayLike<number>): DeterministicSimulation {
    const simulation = new DeterministicSimulation(new NavigationGrid(saved.grid.width, saved.grid.height, Uint16Array.from(costs ?? saved.grid.costs)), {
      seed: saved.randomState, dayNightCycleTicks: saved.dayNightCycleTicks,
      teamAlliances: saved.teamAlliances, initialResources: saved.resources,
    });
    simulation.#tick = saved.tick;
    simulation.#nextEntityId = saved.nextEntityId;
    simulation.#nextCommandSequence = saved.nextCommandSequence;
    simulation.#sourceDayNight = saved.sourceDayNight;
    for (const unit of saved.units) {
      simulation.#units.set(unit.id, { ...unit,
        path: Object.freeze(unit.path.map((point) => Object.freeze(point))),
        weapon: unit.weapon ? Object.freeze({ ...unit.weapon, ...(unit.weapon.sourceDamage ? { sourceDamage: copySourceDamageProfile(unit.weapon.sourceDamage) } : {}) }) : null,
        sourceDefense: unit.sourceDefense ? copyLegacyDefenseProfile(unit.sourceDefense) : null,
        vision: unit.vision ? Object.freeze(unit.vision) : null,
        harvester: unit.harvester ? Object.freeze(unit.harvester) : null,
      });
    }
    for (const target of saved.staticTargets) simulation.#staticTargets.set(target.id, { ...target,
      footprint: Object.freeze([...target.footprint]), sourceDefense: target.sourceDefense ? copyLegacyDefenseProfile(target.sourceDefense) : null });
    for (const node of saved.resourceNodes) simulation.#resourceNodes.set(node.id, node);
    for (const building of saved.buildings) simulation.#buildings.set(building.id, building);
    for (const { index, count, priorCost } of saved.staticBlockers) simulation.#staticBlockers.set(index, { count, priorCost });
    for (const { index, owners, plane } of saved.movementReservations) {
      (plane === "air" ? simulation.#airMovementReservations : simulation.#movementReservations).set(index, new Set(owners));
    }
    for (const command of saved.commands) simulation.#commands.push(command);
    for (const event of saved.combatEvents) simulation.#combatEvents.push(event);
    for (const event of saved.deathEvents) simulation.#deathEvents.push(event);
    for (const diagnostic of saved.sourceDamageDiagnostics) simulation.#sourceDamageDiagnostics.push(diagnostic);
    for (const event of saved.reservationEvents) simulation.#reservationEvents.push(event);
    for (const event of saved.movementFinishedEvents ?? []) simulation.#movementFinishedEvents.push(event);
    for (const actor of saved.resourceActors ?? []) simulation.#resourceActors.set(actor.simulationId, copyResourceActor(actor));
    for (const event of saved.resourceActorEvents ?? []) simulation.#resourceActorEvents.push(event);
    if (saved.adaptedInspire) {
      simulation.#adaptedInspireRandomIndex = saved.adaptedInspire.randomIndex;
      for (const { unitId, typeId, charge } of saved.adaptedInspire.casters) simulation.#adaptedInspireCasters.set(unitId, { typeId, charge });
      for (const { unitId, timer, casterId, multiplierQ8 } of saved.adaptedInspire.targets) {
        simulation.#adaptedInspireTargets.set(unitId, { timer, casterId, multiplierQ8 });
      }
    }
    return simulation;
  }

  get movementFinishedEvents(): readonly MovementFinishedEvent[] {
    return structuredClone(this.#movementFinishedEvents);
  }

  get resourceActors(): readonly ResourceActorOwnership[] {
    return [...this.#resourceActors.values()].map(copyResourceActor);
  }

  get resourceActorEvents(): readonly ResourceActorEvent[] {
    return structuredClone(this.#resourceActorEvents);
  }

  registerResourceActor(identity: ResourceActorIdentity, profile: ResourceActorStateProfile): ResourceActorToken {
    checkpointObject({ simulationId: resourceIdentityChecks.simulationId, slot: resourceIdentityChecks.slot,
      generation: resourceIdentityChecks.generation, key: resourceIdentityChecks.key })(identity);
    validateResourceAdmission(profile);
    this.#requireResourceQuiescent(identity.simulationId);
    checkpointRequire(!this.#resourceActors.has(identity.simulationId));
    checkpointRequire(![...this.#resourceActors.values()].some((actor) => actor.key === identity.key
      || (actor.slot === identity.slot && (actor.owner !== "removed" || actor.generation >= identity.generation))));
    checkpointRequire(resourceIdle(profile) && !profile.taskOwner.state.released
      && profile.taskOwner.provenance !== "source-idle");
    this.#requireResourcePosition(identity.simulationId, profile);
    const actor: ResourceActorOwnership = { ...identity, ownershipGeneration: 0, owner: "simulation", pendingReturn: null, profile,
      admission: null, releaseAcknowledgement: null };
    this.#commitResourceActors([actor]);
    return resourceToken(actor);
  }

  claimResourceActor(token: ResourceActorToken, profile: ResourceActorStateProfile): ResourceActorToken {
    checkpointObject(resourceIdentityChecks)(token);
    const registered = this.#resourceActors.has(token.simulationId);
    const previous: ResourceActorOwnership = registered ? this.#requireResourceToken(token, "simulation")
      : { ...token, owner: "simulation", pendingReturn: null, profile, admission: null, releaseAcknowledgement: null };
    if (!registered) checkpointRequire(token.ownershipGeneration === 0
      && ![...this.#resourceActors.values()].some((actor) => actor.key === token.key
        || (actor.slot === token.slot && (actor.owner !== "removed" || actor.generation >= token.generation))));
    validateResourceAdmission(profile);
    this.#requireResourceQuiescent(token.simulationId);
    this.#requireResourcePosition(token.simulationId, profile);
    if (profile.taskOwner.provenance === "constructor") {
      checkpointRequire(previous.ownershipGeneration === 0 && profile.xQ8 === previous.profile.xQ8 && profile.yQ8 === previous.profile.yQ8);
    }
    const actor: ResourceActorOwnership = { ...previous, ownershipGeneration: previous.ownershipGeneration + 1,
      owner: "resource", pendingReturn: null, profile,
      admission: { token: { ...token, ownershipGeneration: previous.ownershipGeneration + 1 }, profile }, releaseAcknowledgement: null };
    this.#commitResourceActors([actor]);
    return resourceToken(actor);
  }

  publishResourceActors(updates: readonly { readonly token: ResourceActorToken; readonly profile: ResourceActorStateProfile }[]): void {
    checkpointRequire(new Set(updates.map(({ token }) => token.simulationId)).size === updates.length);
    const events: ResourceActorEvent[] = [];
    const actors = updates.map(({ token, profile }): ResourceActorOwnership => {
      const previous = this.#requireResourceToken(token);
      checkpointRequire(previous.owner === "resource" || previous.owner === "pending-return");
      resourceProfileCheck(profile);
      checkpointRequire(previous.profile.health > 0 || profile.health === 0);
      if (previous.profile.health > 0 && profile.health === 0 && profile.task === "death") {
        events.push({ ...resourceToken(previous), tick: this.#tick, type: "combat-death" });
      }
      return { ...previous, profile };
    });
    this.#commitResourceActors(actors, events);
  }

  requestResourceActorReturn(token: ResourceActorToken): void {
    const actor = this.#requireResourceToken(token, "resource");
    checkpointRequire(actor.profile.health > 0);
    this.#commitResourceActors([{ ...actor, owner: "pending-return", pendingReturn: { ownershipGeneration: actor.ownershipGeneration } }]);
  }

  releaseResourceActor(token: ResourceActorToken, acknowledgement: ResourceActorReleaseAcknowledgement,
    profile: ResourceActorStateProfile): void {
    const actor = this.#requireResourceToken(token, "pending-return");
    checkpointRequire(actor.profile.health > 0);
    resourceProfileCheck(profile);
    validateResourceRelease(actor, acknowledgement, profile);
    this.#commitResourceActors([{ ...actor, owner: "simulation", pendingReturn: null, profile, releaseAcknowledgement: acknowledgement }]);
  }

  removeResourceActor(token: ResourceActorToken, reason: "remove-noncombat"): void {
    const actor = this.#requireResourceToken(token);
    checkpointRequire(reason === "remove-noncombat" && (actor.owner === "resource" || actor.owner === "pending-return"));
    this.#commitResourceActors([{ ...actor, owner: "removed", pendingReturn: null,
      profile: { ...actor.profile, status: 0, occupancy: [] } }], [{ ...resourceToken(actor), tick: this.#tick, type: reason }]);
  }

  #requireResourceToken(token: ResourceActorToken, owner?: ResourceActorOwnership["owner"]): ResourceActorOwnership {
    checkpointObject(resourceIdentityChecks)(token);
    const actor = this.#resourceActors.get(token.simulationId);
    if (!actor || !sameResourceIdentity(actor, token) || (owner !== undefined && actor.owner !== owner)) {
      throw new RangeError("Stale resource actor identity, ownership generation or task owner");
    }
    return actor;
  }

  #resourceOwned(id: number): boolean {
    const actor = this.#resourceActors.get(id);
    return actor?.owner === "resource" || actor?.owner === "pending-return";
  }

  #requireResourceQuiescent(id: number): void {
    const unit = this.#units.get(id);
    if (this.#nativeInspire || !unit || unit.health <= 0 || unit.activity !== "idle" || unit.path.length !== 0
      || unit.pathIndex !== 0 || unit.reservedDestination !== null || unit.attackTargetId !== null || unit.attackCooldown !== 0
      || unit.resourceTargetId !== null || unit.dropoff !== null || unit.harvestPhase !== null || unit.cargo !== 0
      || [...this.#units.values()].some((other) => other.attackTargetId === id)
      || this.#commands.some(({ command }) => resourceCommandConflict(command, id))
      || this.#combatEvents.some((event) => event.attackerId === id || event.targetId === id)) {
      throw new RangeError("Resource claim requires a quiescent actor and explicit sourced constructor/resume task owner; moving handoff is unproved");
    }
  }

  #requireResourcePosition(id: number, profile: ResourceActorStateProfile): void {
    const unit = this.#units.get(id)!;
    checkpointRequire(unit.xSubcells === profile.xQ8 * SUBCELLS_PER_CELL / 256
      && unit.ySubcells === profile.yQ8 * SUBCELLS_PER_CELL / 256 && unit.health === profile.health);
  }

  #commitResourceActors(updates: readonly ResourceActorOwnership[], events: readonly ResourceActorEvent[] = []): void {
    const actors = new Map(this.#resourceActors);
    const units = new Map(this.#units);
    for (const input of updates) {
      const actor = copyResourceActor(input);
      const previous = actors.get(actor.simulationId);
      if (previous) checkpointRequire([6, 47].includes(previous.profile.sourceTypeIndex) === [6, 47].includes(actor.profile.sourceTypeIndex));
      actors.set(actor.simulationId, actor);
      if (actor.owner === "removed") { units.delete(actor.simulationId); continue; }
      const unit = units.get(actor.simulationId);
      checkpointRequire(!!unit);
      const profile = actor.profile;
      units.set(unit.id, { ...unit, speedSubcellsPerTick: profile.speedSubcellsPerTick,
        health: profile.health, maxHealth: profile.maxHealth, weapon: null, harvester: null,
        sourceDefense: copyLegacyDefenseProfile(profile.sourceDefense), vision: profile.vision,
        xSubcells: profile.xQ8 * SUBCELLS_PER_CELL / 256, ySubcells: profile.yQ8 * SUBCELLS_PER_CELL / 256,
        activity: profile.health === 0 ? "die" : profile.taskOwner.state.nativeMovement ? "move" : "idle", path: [], pathIndex: 0, reservedDestination: null,
        attackCooldown: 0, attackTargetId: null, cargo: 0, resourceTargetId: null, dropoff: null, harvestPhase: null });
    }
    const saved = this.checkpoint();
    const candidate = { ...saved, resourceActors: [...actors.values()],
      units: [...units.values()].map(({ team, ...unit }) => ({ ...unit, ...(team === undefined ? {} : { team }) })),
      resourceActorEvents: [...this.#resourceActorEvents, ...events],
      movementReservations: saved.movementReservations.map((reservation) => ({ ...reservation,
        owners: reservation.owners.filter((id) => !updates.some((actor) => actor.simulationId === id)) })).filter((reservation) => reservation.owners.length > 0) };
    validateSimulationCheckpoint(candidate);
    this.#resourceActors.clear();
    actors.forEach((actor, id) => this.#resourceActors.set(id, actor));
    this.#units.clear();
    units.forEach((unit, id) => this.#units.set(id, unit));
    this.#movementReservations.clear();
    this.#airMovementReservations.clear();
    for (const reservation of candidate.movementReservations) {
      (reservation.plane === "air" ? this.#airMovementReservations : this.#movementReservations)
        .set(reservation.index, new Set(reservation.owners));
    }
    this.#resourceActorEvents.push(...structuredClone(events));
  }

  get combatEvents(): readonly CombatEvent[] {
    return Object.freeze(this.#combatEvents.map((event) => Object.freeze({ ...event })));
  }

  get inspireEvents(): readonly NativeInspireEvent[] {
    return this.#inspireEvents.map((event) => structuredClone(event));
  }

  registerNativeInspireEntity(registration: NativeInspireRegistration): void {
    if (!this.#nativeInspire) throw new RangeError("native Inspire adapter is not configured");
    for (const [value, maximum, label] of [
      [registration.slot, 799, "slot"], [registration.generation, Number.MAX_SAFE_INTEGER, "generation"],
      [registration.typeId, 105, "type"], [registration.team, 8, "team"],
      [registration.charge, 255, "charge"], [registration.timer, 255, "timer"],
      [registration.casterSlot, 65535, "caster slot word"], [registration.multiplierQ8, 0x7fffffff, "multiplier"],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new RangeError(`invalid native Inspire ${label}`);
    }
    if (!Number.isInteger(registration.primaryWeapon) || registration.primaryWeapon < -1) {
      throw new RangeError("invalid native Inspire primary weapon");
    }
    const profile = getLegacyInspireProfile(registration.typeId);
    if (registration.multiplierQ8 !== (profile?.multiplierQ8 ?? 0)) throw new RangeError("native Inspire type multiplier mismatch");
    const previous = this.#inspireSlots.get(registration.slot);
    if (previous && registration.generation <= previous.registration.generation) throw new RangeError("stale native Inspire generation");
    if (registration.unitId !== null) {
      const unit = this.#units.get(registration.unitId);
      if (!unit || unit.team !== registration.team) throw new RangeError("native Inspire unit/team mapping mismatch");
      const oldSlot = this.#inspireUnitSlots.get(registration.unitId);
      if (oldSlot !== undefined && oldSlot !== registration.slot) throw new RangeError("native Inspire unit already mapped");
    }
    if (previous?.registration.unitId != null) this.#inspireUnitSlots.delete(previous.registration.unitId);
    const copied = Object.freeze({ ...registration });
    this.#inspireSlots.set(registration.slot, { registration: copied,
      state: { charge: registration.charge, timer: registration.timer, casterSlot: registration.casterSlot },
      animationMode: 0, pendingOrder: 0 });
    if (registration.unitId !== null) this.#inspireUnitSlots.set(registration.unitId, registration.slot);
  }

  /** Idempotent; a changed caster type (upgrade) keeps its charge. Returns false for a missing or dead unit. */
  registerAdaptedInspireCaster(unitId: number, typeId: number): boolean {
    if (this.#nativeInspire) throw new RangeError("adapted Inspire is unavailable with a native Inspire adapter");
    if (!getLegacyInspireProfile(typeId)) throw new RangeError(`type ${typeId} is not an Inspire caster`);
    if (!this.#adaptedInspireLive(unitId) || this.#resourceActors.has(unitId)) return false;
    const existing = this.#adaptedInspireCasters.get(unitId);
    if (existing) existing.typeId = typeId;
    else this.#adaptedInspireCasters.set(unitId, { typeId, charge: 0 });
    this.#adaptedInspireTargets.delete(unitId);
    return true;
  }

  adaptedInspireState(unitId: number): AdaptedInspireUnitState | null {
    const caster = this.#adaptedInspireCasters.get(unitId);
    const target = this.#adaptedInspireTargets.get(unitId);
    if ((!caster && !target) || !this.#adaptedInspireLive(unitId)) return null;
    const timer = target?.timer ?? 0;
    return Object.freeze({ caster: !!caster, typeId: caster?.typeId ?? null, charge: caster?.charge ?? 0,
      ready: !!caster && getLegacyInspireChargeGates(caster.charge).uiChargeReady, timer,
      liveMultiplierQ8: timer > 0 ? target!.multiplierQ8 : 256 });
  }

  #advanceAdaptedInspire(): void {
    for (const [id, caster] of this.#adaptedInspireCasters) {
      if (!this.#adaptedInspireLive(id)) { this.#adaptedInspireCasters.delete(id); continue; }
      caster.charge = updateLegacyInspireCounters({ charge: caster.charge, timer: 0, casterSlot: 0 }, this.#tick,
        getLegacyInspireProfile(caster.typeId)!.recharge).charge;
    }
    for (const [id, target] of this.#adaptedInspireTargets) {
      if (this.#adaptedInspireLive(id)) {
        target.timer = updateLegacyInspireCounters({ charge: 0, timer: target.timer, casterSlot: 0 }, this.#tick, 0).timer;
      }
      if (target.timer === 0 || !this.#adaptedInspireLive(id)) this.#adaptedInspireTargets.delete(id);
    }
  }

  #applyAdaptedInspire(unitIds: readonly number[], team: number): void {
    const { width, height } = this.grid;
    for (const id of unitIds) {
      const caster = this.#adaptedInspireCasters.get(id);
      const unit = this.#units.get(id);
      if (!caster || !unit || !this.#adaptedInspireLive(id) || unit.team !== team
        || !getLegacyInspireChargeGates(caster.charge).uiChargeReady) continue;
      const profile = getLegacyInspireProfile(caster.typeId)!;
      const xQ8 = Math.floor(unit.xSubcells * 256 / SUBCELLS_PER_CELL);
      const yQ8 = Math.floor(unit.ySubcells * 256 / SUBCELLS_PER_CELL);
      // Synthetic native planes: one occupant per cell and plane (lowest id), limited to the scan's +/-20 tile window.
      const ground = new Uint16Array(width * height).fill(1023);
      const air = new Uint16Array(width * height).fill(1023);
      const slots: Record<number, LegacyInspireSlot> = {};
      const slotUnits: number[] = [];
      for (const other of [...this.#units.values()].sort((left, right) => left.id - right.id)) {
        if (slotUnits.length >= 1022 || !this.#adaptedInspireLive(other.id) || this.#resourceOwned(other.id)) continue;
        const cellX = Math.floor(other.xSubcells / SUBCELLS_PER_CELL);
        const cellY = Math.floor(other.ySubcells / SUBCELLS_PER_CELL);
        if (Math.abs(cellX - (xQ8 >> 8)) > 20 || Math.abs(cellY - (yQ8 >> 8)) > 20) continue;
        const plane = other.movementPlane === "air" ? air : ground;
        const cell = cellY * width + cellX;
        if (plane[cell] !== 1023) continue;
        const otherCaster = this.#adaptedInspireCasters.get(other.id);
        plane[cell] = slotUnits.length;
        slots[slotUnits.length] = { team: other.team ?? -1, primaryWeapon: other.weapon ? 0 : -1,
          multiplierQ8: otherCaster ? getLegacyInspireProfile(otherCaster.typeId)!.multiplierQ8 : 0 };
        slotUnits.push(other.id);
      }
      const scan = scanLegacyInspireEffect({ xQ8, yQ8, casterSlot: 0, casterTeam: team, visitBudget: profile.visitBudget,
        width, height, ground, air, slots, randomTable: LEGACY_INSPIRE_NATIVE_RANDOM_TABLE,
        randomIndex: this.#adaptedInspireRandomIndex });
      caster.charge = scan.casterCharge;
      this.#adaptedInspireRandomIndex = scan.randomIndex;
      for (const write of scan.writes) {
        this.#adaptedInspireTargets.set(slotUnits[write.targetSlot], { timer: write.timer, casterId: id,
          multiplierQ8: profile.multiplierQ8 });
      }
    }
  }

  nativeInspireState(unitId: number): NativeInspireSnapshot | null {
    const slot = this.#inspireUnitSlots.get(unitId);
    return slot === undefined ? null : this.#inspireSnapshot(this.#inspireSlots.get(slot)!);
  }

  updateNativeInspireType(identity: NativeInspireIdentity, profile: Pick<NativeInspireRegistration,
    "typeId" | "primaryWeapon" | "multiplierQ8">): void {
    const entity = this.#inspireSlots.get(identity.slot);
    if (!entity || entity.registration.generation !== identity.generation) throw new RangeError("stale native Inspire generation");
    if (entity.animationMode === 1 || entity.pendingOrder !== 0) throw new RangeError("unsupported native type change during Inspire task");
    if (!Number.isInteger(profile.typeId) || profile.typeId < 0 || profile.typeId > 105
      || !Number.isInteger(profile.primaryWeapon) || profile.primaryWeapon < -1
      || profile.multiplierQ8 !== (getLegacyInspireProfile(profile.typeId)?.multiplierQ8 ?? 0)) {
      throw new RangeError("invalid native Inspire type profile");
    }
    entity.registration = Object.freeze({ ...entity.registration, ...profile });
  }

  #inspireSnapshot(entity: NativeInspireEntity): NativeInspireSnapshot {
    return Object.freeze({ ...entity.registration, ...entity.state,
      animationMode: entity.animationMode, pendingOrder: entity.pendingOrder,
      ...getLegacyInspireChargeGates(entity.state.charge), centersAim: entity.state.timer !== 0,
      liveMultiplierQ8: this.#inspireMultiplier(entity),
    });
  }

  #inspireMultiplier(entity: NativeInspireEntity): number {
    return resolveLegacyInspireMultiplierQ8(entity.state, this.#inspireSlotRecords());
  }

  #inspireSlotRecords(): Record<number, LegacyInspireSlot> {
    return Object.fromEntries([...this.#inspireSlots].map(([slot, entity]) => [slot, entity.registration]));
  }

  get sourceDamageDiagnostics(): readonly { readonly tick: number; readonly attackerId: number; readonly targetId: number; readonly reason: string }[] {
    return this.#sourceDamageDiagnostics.map((diagnostic) => Object.freeze({ ...diagnostic }));
  }

  get reservationEvents(): readonly { readonly unitId: number; readonly tileX: number; readonly tileY: number }[] {
    return this.#reservationEvents.map((event) => Object.freeze({ ...event }));
  }

  get deathEvents(): readonly DeathEvent[] {
    return Object.freeze(this.#deathEvents.map((event) => Object.freeze({ ...event })));
  }

  get snapshot(): SimulationSnapshot {
    const units = [...this.#units.values()]
      .sort((left, right) => left.id - right.id)
      .map((unit): UnitSnapshot => Object.freeze({
        id: unit.id,
        ...(unit.movementPlane === undefined ? {} : { movementPlane: unit.movementPlane }),
        faction: unit.faction,
        ...(unit.team === undefined ? {} : { team: unit.team }),
        activity: unit.activity,
        xSubcells: unit.xSubcells,
        ySubcells: unit.ySubcells,
        cellX: Math.floor(unit.xSubcells / SUBCELLS_PER_CELL),
        cellY: Math.floor(unit.ySubcells / SUBCELLS_PER_CELL),
        health: unit.health,
        maxHealth: unit.maxHealth,
        cargo: unit.cargo,
        cargoCapacity: unit.harvester?.cargoCapacity ?? 0,
        targetId: unit.attackTargetId ?? unit.resourceTargetId,
        ...(this.#resourceActors.has(unit.id) ? { resourceActor: copyResourceActor(this.#resourceActors.get(unit.id)!) } : {}),
      }));
    const resourceNodes = [...this.#resourceNodes.values()]
      .sort((left, right) => left.id - right.id)
      .map((node): ResourceNodeSnapshot => ({
        id: node.id,
        cellX: node.cell.x,
        cellY: node.cell.y,
        remaining: node.remaining,
      }));
    const buildings = [...this.#buildings.values()]
      .sort((left, right) => left.id - right.id)
      .map((building): BuildingSnapshot => ({
        id: building.id,
        faction: building.faction,
        kind: building.kind,
        cellX: building.cell.x,
        cellY: building.cell.y,
        health: building.health,
        maxHealth: building.maxHealth,
        constructionQueue: building.constructionQueue.map((construction) => ({ ...construction })),
      }));
    const staticTargets = [...this.#staticTargets.values()]
      .sort((left, right) => left.id - right.id)
      .map((target): StaticTargetSnapshot => Object.freeze({
        id: target.id,
        faction: target.faction,
        ...(target.team === undefined ? {} : { team: target.team }),
        xSubcells: target.xSubcells,
        ySubcells: target.ySubcells,
        cellX: Math.floor(target.xSubcells / SUBCELLS_PER_CELL),
        cellY: Math.floor(target.ySubcells / SUBCELLS_PER_CELL),
        health: target.health,
        maxHealth: target.maxHealth,
        ...(target.mine ? { mine: Object.freeze(structuredClone(target.mine)), activity: target.health === 0 ? "die" as const : "idle" as const } : {}),
        ...(target.weapon ? { weapon: Object.freeze(structuredClone(target.weapon)), targetId: target.attackTargetId!,
          attackCooldown: target.attackCooldown!, activity: target.health === 0 ? "die" : target.attackTargetId === null ? "idle" : "attack" } : {}),
      }));
    const daylightPermille = this.daylightPermille;
    return Object.freeze({
      tick: this.#tick,
      ...(this.#nativeInspire ? { nativeInspire: Object.freeze([...this.#inspireSlots.values()].map((entity) => this.#inspireSnapshot(entity))) } : {}),
      ...(this.#teamAlliances.length === 0 ? {} : { teamAlliances: this.#teamAlliances }),
      entityCount: units.length + buildings.length + staticTargets.length,
      timeOfDay: daylightPermille >= 500 ? "day" : "night",
      daylightPermille,
      randomState: this.random.state,
      resources: { ...this.#resources },
      buildings,
      staticTargets: Object.freeze(staticTargets),
      resourceNodes,
      units: Object.freeze(units),
    });
  }

  get daylightPermille(): number {
    if (this.#sourceDayNight) return Math.floor((256 - this.#sourceDayNight.blend) * 1000 / 256);
    const phase = this.#tick % this.dayNightCycleTicks;
    const halfCycle = this.dayNightCycleTicks / 2;
    return Math.max(0, 1000 - Math.floor((Math.abs(phase - halfCycle) * 1000) / halfCycle));
  }

  get staticObstacleCells(): readonly GridPoint[] {
    return [...this.#staticBlockers.keys()].sort((left, right) => left - right).map(index => this.grid.point(index));
  }

  get sourceDayNight(): SourceDayNight | null {
    return this.#sourceDayNight ? { ...this.#sourceDayNight } : null;
  }

  visionRadius(baseRadius: number, faction: Faction): number {
    if (!Number.isInteger(baseRadius) || baseRadius < 0) throw new RangeError("baseRadius must be non-negative");
    const scale = faction === "human" ? 500 + this.daylightPermille : 1500 - this.daylightPermille;
    return Math.floor((baseRadius * scale) / 1000);
  }

  visibilityMask(faction: Faction, baseRadius: number): Uint8Array {
    const visible = new Uint8Array(this.grid.costs.length);
    const daylightPermille = this.daylightPermille;
    const observers = [...this.#units.values()]
      .filter((unit) => unit.faction === faction && unit.activity !== "die")
      .sort((left, right) => left.id - right.id);
    for (const observer of observers) {
      const radius = observer.vision
        ? Math.floor(
            (observer.vision.nightRangeCells * (1000 - daylightPermille) +
              observer.vision.dayRangeCells * daylightPermille) /
              1000,
          )
        : this.visionRadius(baseRadius, faction);
      const origin = this.#unitCell(observer);
      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        const remaining = radius - Math.abs(offsetY);
        for (let offsetX = -remaining; offsetX <= remaining; offsetX += 1) {
          const x = origin.x + offsetX;
          const y = origin.y + offsetY;
          if (this.grid.contains(x, y)) visible[y * this.grid.width + x] = 1;
        }
      }
    }
    return visible;
  }

  addUnit(options: AddUnitOptions): number {
    validateTeam(options.team);
    if (options.movementPlane !== undefined && options.movementPlane !== "ground" && options.movementPlane !== "air") {
      throw new RangeError("invalid movement plane");
    }
    const grid = options.movementPlane === "air" ? this.#airGrid : this.grid;
    if (!grid.isPassable(options.cell.x, options.cell.y)) {
      throw new RangeError(`unit cell is not passable: ${options.cell.x},${options.cell.y}`);
    }
    const speedSubcellsPerTick = options.speedSubcellsPerTick ?? 256;
    if (!Number.isInteger(speedSubcellsPerTick) || speedSubcellsPerTick <= 0) {
      throw new RangeError("speedSubcellsPerTick must be a positive integer");
    }
    const maxHealth = options.maxHealth ?? 100;
    if (!Number.isInteger(maxHealth) || maxHealth <= 0) {
      throw new RangeError("maxHealth must be a positive integer");
    }
    const health = options.health ?? maxHealth;
    if (!Number.isInteger(health) || health <= 0) throw new RangeError("health must be a positive integer");
    const xSubcells = options.positionSubcells?.x ?? cellCenter(options.cell.x);
    const ySubcells = options.positionSubcells?.y ?? cellCenter(options.cell.y);
    if (!Number.isInteger(xSubcells) || !Number.isInteger(ySubcells) ||
      Math.floor(xSubcells / SUBCELLS_PER_CELL) !== options.cell.x ||
      Math.floor(ySubcells / SUBCELLS_PER_CELL) !== options.cell.y) {
      throw new RangeError("unit position must be integer subcells inside its declared cell");
    }
    if (options.weapon) this.#validateWeapon(options.weapon);
    if (options.vision) this.#validateVision(options.vision);
    if (options.harvester) this.#validateHarvester(options.harvester);
    const sourceDefense = options.sourceDefense ? copyLegacyDefenseProfile(options.sourceDefense) : null;
    const weapon = options.weapon?.sourceDamage
      ? Object.freeze({ ...options.weapon, sourceDamage: copySourceDamageProfile(options.weapon.sourceDamage) })
      : options.weapon ?? null;
    const id = this.#nextEntityId++;
    this.#units.set(id, {
      id,
      ...(options.movementPlane === undefined ? {} : { movementPlane: options.movementPlane }),
      faction: options.faction,
      team: options.team,
      speedSubcellsPerTick,
      activity: "idle",
      xSubcells,
      ySubcells,
      path: [],
      pathIndex: 0,
      reservedDestination: null,
      health,
      maxHealth,
      weapon,
      sourceDefense,
      vision: options.vision ?? null,
      attackCooldown: 0,
      attackTargetId: null,
      harvester: options.harvester ?? null,
      cargo: 0,
      resourceTargetId: null,
      dropoff: null,
      harvestPhase: null,
    });
    return id;
  }

  removeUnit(id: number): boolean {
    if (this.#resourceActors.has(id)) throw new RangeError("Resource actor removal requires explicit native ownership and removal reason");
    const slot = this.#inspireUnitSlots.get(id);
    if (slot !== undefined) {
      const entity = this.#inspireSlots.get(slot)!;
      entity.registration = Object.freeze({ ...entity.registration, unitId: null });
      entity.animationMode = 0;
      entity.pendingOrder = 0;
      this.#inspireUnitSlots.delete(id);
    }
    this.#adaptedInspireCasters.delete(id);
    this.#adaptedInspireTargets.delete(id);
    return this.#units.delete(id);
  }

  setDormantUnits(ids: Iterable<number>): void {
    this.#dormantUnits.clear();
    for (const id of ids) {
      const unit = this.#units.get(id);
      if (!unit) continue;
      this.#dormantUnits.add(id);
      if (unit.activity !== "die" && unit.activity !== "idle") { this.#clearOrders(unit); unit.activity = "idle"; }
    }
  }

  transferEntityTeam(id: number, team: number, faction: Faction): boolean {
    validateTeam(team);
    if (this.#resourceActors.has(id) || this.#inspireUnitSlots.has(id)) {
      throw new RangeError("Team transfer is unsupported for native resource or Inspire registrations");
    }
    const unit = this.#units.get(id);
    const target = this.#staticTargets.get(id);
    if (unit) {
      if (unit.activity === "die") return false;
      const next = { ...unit, team, faction, activity: "idle" as const };
      this.#clearOrders(next);
      this.#units.set(id, next);
    } else if (target) {
      if (target.health <= 0) return false;
      this.#staticTargets.set(id, { ...target, team, faction, ...(target.weapon ? { attackTargetId: null } : {}) });
    } else return false;
    for (const other of this.#units.values()) if (other.attackTargetId === id) other.attackTargetId = null;
    for (const other of this.#staticTargets.values()) if (other.attackTargetId === id) other.attackTargetId = null;
    return true;
  }

  removeStaticTarget(id: number): boolean {
    const target = this.#staticTargets.get(id);
    if (!target) return false;
    if (target.health > 0) {
      for (const index of target.footprint) {
        const blocker = this.#staticBlockers.get(index)!;
        blocker.count -= 1;
        if (blocker.count === 0) {
          this.grid.costs[index] = blocker.priorCost;
          this.#staticBlockers.delete(index);
        }
      }
    }
    return this.#staticTargets.delete(id);
  }

  updateUnitEquipment(id: number, equipment: { readonly weapon: WeaponStats; readonly sourceDefense: LegacyDefenseProfile }): void {
    const unit = this.#units.get(id);
    if (!unit || this.#resourceActors.has(id) || this.#inspireUnitSlots.has(id)) {
      throw new RangeError(`unknown or externally owned equipment target ${id}`);
    }
    this.#validateWeapon(equipment.weapon);
    const sourceDefense = copyLegacyDefenseProfile(equipment.sourceDefense);
    const weapon = { ...equipment.weapon, ...(equipment.weapon.sourceDamage
      ? { sourceDamage: copySourceDamageProfile(equipment.weapon.sourceDamage) } : {}) };
    if (unit.attackCooldown > weapon.cooldownTicks) throw new RangeError("Equipment must preserve the current cooldown");
    this.#units.set(id, { ...unit, weapon, sourceDefense });
  }

  updateStaticEquipment(id: number, equipment: { readonly weapon: WeaponStats; readonly sourceDefense: LegacyDefenseProfile }): void {
    const target = this.#staticTargets.get(id);
    if (!target?.weapon || target.mine) throw new RangeError(`unknown or unarmed static equipment target ${id}`);
    this.#validateWeapon(equipment.weapon);
    const sourceDefense = copyLegacyDefenseProfile(equipment.sourceDefense);
    const weapon = { ...equipment.weapon, ...(equipment.weapon.sourceDamage
      ? { sourceDamage: copySourceDamageProfile(equipment.weapon.sourceDamage) } : {}) };
    if (target.attackCooldown! > weapon.cooldownTicks) throw new RangeError("Equipment must preserve the current cooldown");
    this.#staticTargets.set(id, { ...target, weapon, sourceDefense });
  }

  updateStaticSourceDefense(id: number, profile: LegacyDefenseProfile, maxHealth?: number): void {
    const target = this.#staticTargets.get(id);
    if (!target) throw new RangeError(`unknown static target ${id}`);
    if (maxHealth !== undefined && (!Number.isSafeInteger(maxHealth) || maxHealth <= 0 || maxHealth < target.health)) {
      throw new RangeError("Static maximum must preserve current health");
    }
    this.#staticTargets.set(id, { ...target, sourceDefense: copyLegacyDefenseProfile(profile),
      ...(maxHealth !== undefined ? { maxHealth } : {}) });
  }

  addStaticTarget(options: AddStaticTargetOptions): number {
    validateTeam(options.team);
    if (!this.grid.contains(options.cell.x, options.cell.y)) {
      throw new RangeError(`static target cell is out of bounds: ${options.cell.x},${options.cell.y}`);
    }
    if (!Number.isInteger(options.maxHealth) || options.maxHealth <= 0) {
      throw new RangeError("static target maxHealth must be a positive integer");
    }
    const health = options.health ?? options.maxHealth;
    if (!Number.isInteger(health) || health <= 0) {
      throw new RangeError("static target health must be a positive integer");
    }
    const xSubcells = options.positionSubcells?.x ?? cellCenter(options.cell.x);
    const ySubcells = options.positionSubcells?.y ?? cellCenter(options.cell.y);
    if (
      !Number.isFinite(xSubcells) || !Number.isFinite(ySubcells) ||
      xSubcells < 0 || ySubcells < 0 ||
      xSubcells >= this.grid.width * SUBCELLS_PER_CELL ||
      ySubcells >= this.grid.height * SUBCELLS_PER_CELL
    ) {
      throw new RangeError("static target positionSubcells is out of bounds");
    }
    const footprint = [...new Set((options.footprint ?? []).map((cell) => this.grid.index(cell.x, cell.y)))];
    const sourceDefense = options.sourceDefense ? copyLegacyDefenseProfile(options.sourceDefense) : null;
    if (options.mine) {
      validateBrowserMineOptions(options.mine);
      if (options.weapon || options.vision || footprint.length || options.team === undefined || options.team > 8
        || (sourceDefense?.sourceTypeIndex !== undefined && sourceDefense.sourceTypeIndex !== options.mine.sourceTypeIndex)) {
        throw new RangeError("Adapted mines require a source team, matching type, no turret weapon/vision and no footprint");
      }
    }
    if (options.weapon) this.#validateWeapon(options.weapon);
    if (options.vision) this.#validateVision(options.vision);
    const id = this.#nextEntityId++;
    this.#staticTargets.set(id, {
      id,
      faction: options.faction,
      team: options.team,
      xSubcells,
      ySubcells,
      footprint,
      health,
      maxHealth: options.maxHealth,
      sourceDefense,
      ...(options.mine ? { mine: structuredClone(options.mine) } : {}),
      ...(options.weapon ? { weapon: structuredClone(options.weapon), attackCooldown: 0, attackTargetId: null,
        ...(options.vision ? { vision: { ...options.vision } } : {}) } : {}),
    });
    for (const index of footprint) {
      const blocker = this.#staticBlockers.get(index);
      if (blocker) blocker.count += 1;
      else this.#staticBlockers.set(index, { count: 1, priorCost: this.grid.costs[index] });
      this.grid.costs[index] = 0;
    }
    return id;
  }

  addResourceNode(options: AddResourceNodeOptions): number {
    if (!this.grid.isPassable(options.cell.x, options.cell.y)) {
      throw new RangeError(`resource cell is not passable: ${options.cell.x},${options.cell.y}`);
    }
    if (!Number.isInteger(options.amount) || options.amount <= 0) {
      throw new RangeError("resource amount must be a positive integer");
    }
    const id = this.#nextEntityId++;
    this.#resourceNodes.set(id, { id, cell: { ...options.cell }, remaining: options.amount });
    return id;
  }

  addBuilding(options: AddBuildingOptions): number {
    if (!this.grid.isPassable(options.cell.x, options.cell.y)) {
      throw new RangeError(`building cell is not passable: ${options.cell.x},${options.cell.y}`);
    }
    if (this.#buildingAt(options.cell)) {
      throw new RangeError(`building cell is occupied: ${options.cell.x},${options.cell.y}`);
    }
    const maxHealth = options.maxHealth ?? 500;
    if (!Number.isInteger(maxHealth) || maxHealth <= 0) {
      throw new RangeError("building maxHealth must be a positive integer");
    }
    const id = this.#nextEntityId++;
    this.#buildings.set(id, {
      id,
      faction: options.faction,
      kind: options.kind,
      cell: { ...options.cell },
      health: maxHealth,
      maxHealth,
      constructionQueue: [],
    });
    return id;
  }

  grantResources(faction: Faction, amount: number): void {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new RangeError("resource grant must be a non-negative integer");
    }
    this.#resources[faction] += amount;
  }

  queue(command: SimulationCommand, tick = this.#tick): void {
    if (!Number.isInteger(tick) || tick < this.#tick) {
      throw new RangeError(`command tick ${tick} precedes simulation tick ${this.#tick}`);
    }
    if ([...this.#resourceActors.values()].some((actor) => this.#resourceOwned(actor.simulationId)
      && resourceCommandConflict(command, actor.simulationId))) throw new RangeError("Resource-owned actor rejects simulation commands/combat");
    this.#commands.push({ tick, sequence: this.#nextCommandSequence++, command: structuredClone(command) });
    this.#commands.sort((left, right) => left.tick - right.tick || left.sequence - right.sequence);
  }

  advance(): void {
    if ([...this.#resourceActors.values()].some((actor) => actor.owner === "pending-return" && actor.profile.taskOwner.state.released)) {
      throw new RangeError("Resource host released its task: source-idle acknowledgement is required before the next update");
    }
    const nativeOrder = this.#nativeInspireOrder();
    if (this.#sourceDayNight) this.#sourceDayNight = advanceSourceDayNight(this.#sourceDayNight);
    this.#inspireEvents.length = 0;
    this.#combatEvents.length = 0;
    this.#sourceDamageDiagnostics.length = 0;
    this.#deathEvents.length = 0;
    this.#reservationEvents.length = 0;
    this.#movementFinishedEvents.length = 0;
    const resourceEvents = this.#resourceActorEvents.filter((event) => event.tick === this.#tick);
    this.#resourceActorEvents.splice(0, this.#resourceActorEvents.length, ...resourceEvents);
    for (const event of resourceEvents) if (event.type === "combat-death") {
      this.#deathEvents.push({ type: "death", tick: this.#tick, targetId: event.simulationId });
    }
    this.#advanceAdaptedInspire();
    while (this.#commands[0]?.tick === this.#tick) this.#applyCommand(this.#commands.shift()!.command);
    this.#movementReservations.clear();
    this.#airMovementReservations.clear();
    for (const unit of this.#units.values()) {
      if (unit.activity === "die") continue;
      for (const index of this.#occupiedCells(unit)) this.#reserveMovement(index, unit.id);
    }
    const pendingDamage = new Map<number, number>();
    const nativeUnitIds = new Set(nativeOrder.flatMap((entity) => entity.registration.unitId === null ? [] : [entity.registration.unitId]));
    const updateOrder = [...nativeOrder, ...[...this.#units.values()]
      .filter((unit) => !nativeUnitIds.has(unit.id)).sort((left, right) => left.id - right.id)];
    for (const entry of updateOrder) {
      const native = "registration" in entry ? entry : null;
      const unit = native ? (native.registration.unitId === null ? undefined : this.#units.get(native.registration.unitId)) : entry as UnitState;
      if (unit?.activity === "die" || (unit && this.#resourceOwned(unit.id)) || (unit && this.#dormantUnits.has(unit.id))) continue;
      if (native) this.#advanceInspire(native);
      if (unit && native?.animationMode !== 1) {
        const startXSubcells = unit.xSubcells;
        const startYSubcells = unit.ySubcells;
        if (unit.attackCooldown > 0) unit.attackCooldown -= 1;
        if (unit.activity === "move") {
          if (this.#advancePath(unit)) unit.activity = "idle";
        } else if (unit.activity === "attack") {
          const target = this.#advanceAttack(unit);
          if (target && unit.xSubcells === startXSubcells && unit.ySubcells === startYSubcells
            && unit.pathIndex >= unit.path.length && unit.reservedDestination === null) {
            this.#fireWeapon(unit, target, pendingDamage);
          }
        } else if (unit.activity === "harvest") {
          this.#advanceHarvest(unit);
        }
      }
      if (native) this.#nativeInspire!.afterEntityUpdate(native.registration);
    }
    const armedStatics = [...this.#staticTargets.values()].filter(target => (target.weapon || target.mine) && target.health > 0)
      .sort((left, right) => left.id - right.id);
    if (armedStatics.length) {
      const candidates = [...this.#units.values(), ...this.#staticTargets.values()].sort((left, right) => left.id - right.id);
      for (const actor of armedStatics) {
        if (actor.mine) {
          const mine = actor.mine;
          const eligible = (target: UnitState | StaticTargetState): target is UnitState => "activity" in target
            && target.movementPlane !== "air"
            && target.health > 0 && !this.#resourceOwned(target.id) && actor.team! < 8
            && target.team !== undefined && target.team < 8 && areHostile(actor, target, this.#teamAlliances);
          const inRange = (target: UnitState, range: number) =>
            (target.xSubcells - actor.xSubcells) ** 2 + (target.ySubcells - actor.ySubcells) ** 2 <= (range * SUBCELLS_PER_CELL) ** 2;
          if (!candidates.some(target => eligible(target) && inRange(target, mine.triggerRange))) continue;
          for (const target of candidates) {
            if (!eligible(target) || !inRange(target, mine.splashRange)) continue;
            const damage = target.sourceDefense
              ? calculateLegacyDamage(mine.weapon.damage, mine.weapon.sourceDamage, target.sourceDefense) : mine.weapon.damage;
            pendingDamage.set(target.id, (pendingDamage.get(target.id) ?? 0) + damage);
            this.#combatEvents.push({ type: "shot", tick: this.#tick, attackerId: actor.id, targetId: target.id, damage });
          }
          pendingDamage.set(actor.id, (pendingDamage.get(actor.id) ?? 0) + actor.health);
          continue;
        }
        if (actor.attackCooldown! > 0) actor.attackCooldown! -= 1;
        const sight = actor.vision ? Math.floor((actor.vision.nightRangeCells * (1000 - this.daylightPermille)
          + actor.vision.dayRangeCells * this.daylightPermille) / 1000) : actor.weapon!.rangeCells;
        const eligible = (target: UnitState | StaticTargetState) => this.canAutoTarget(actor.id, target.id)
          && Math.abs(target.xSubcells - actor.xSubcells) + Math.abs(target.ySubcells - actor.ySubcells)
            <= Math.min(sight, actor.weapon!.rangeCells) * SUBCELLS_PER_CELL;
        const previous = actor.attackTargetId == null ? undefined : this.#attackTarget(actor.attackTargetId);
        const target = previous && eligible(previous) ? previous : candidates.find(eligible);
        actor.attackTargetId = target?.id ?? null;
        if (target) this.#fireWeapon(actor, target, pendingDamage);
      }
    }
    for (const [targetId, damage] of [...pendingDamage].sort(([left], [right]) => left - right)) {
      const target = this.#attackTarget(targetId);
      if (!target || target.health <= 0) continue;
      target.health = Math.max(0, target.health - damage);
      if (target.health === 0) {
        if ("activity" in target) {
          target.activity = "die";
          this.#clearOrders(target);
          const slot = this.#inspireUnitSlots.get(target.id);
          const native = slot === undefined ? undefined : this.#inspireSlots.get(slot);
          if (native) { native.animationMode = 0; native.pendingOrder = 0; }
          this.#adaptedInspireCasters.delete(target.id);
          this.#adaptedInspireTargets.delete(target.id);
        } else {
          if (target.weapon) target.attackTargetId = null;
          for (const index of target.footprint) {
            const blocker = this.#staticBlockers.get(index)!;
            blocker.count -= 1;
            if (blocker.count === 0) {
              this.grid.costs[index] = blocker.priorCost;
              this.#staticBlockers.delete(index);
            }
          }
        }
        this.#deathEvents.push({ type: "death", tick: this.#tick, targetId });
      }
    }
    this.#advanceConstruction();
    this.#tick += 1;
  }

  #applyCommand(command: SimulationCommand): void {
    if (command.type === "build") {
      this.#queueConstruction(command);
      return;
    }
    const unitIds = [...new Set(command.unitIds)].filter(id => !this.#dormantUnits.has(id)).sort((left, right) => left - right);
    if (command.type === "inspire") {
      if (!Number.isInteger(command.team) || command.team < 0 || command.team > 7) throw new RangeError("invalid Inspire command team");
      if (!this.#nativeInspire) {
        this.#applyAdaptedInspire(unitIds, command.team);
        return;
      }
      for (const id of unitIds) {
        const slot = this.#inspireUnitSlots.get(id);
        const entity = slot === undefined ? undefined : this.#inspireSlots.get(slot);
        const unit = this.#units.get(id);
        if (unit && !entity) throw new RangeError("missing native Inspire selected-unit mapping");
        if (!entity || !unit || unit.activity === "die" || entity.registration.team !== command.team) continue;
        if (!verifiedLegacyInspireDeployFin(entity.registration.typeId) || unit.activity !== "idle") {
          this.#inspireEvent(entity, "rejected", { reason: "unsupported-native-inspire-type-or-task" });
          continue;
        }
        entity.pendingOrder = 13;
      }
      return;
    }
    const casting = unitIds.filter((id) => {
      const slot = this.#inspireUnitSlots.get(id);
      const entity = slot === undefined ? undefined : this.#inspireSlots.get(slot);
      return entity && (entity.animationMode === 1 || entity.pendingOrder !== 0);
    });
    if (casting.length > 0 && command.type !== "stop") throw new RangeError("unsupported command during native Inspire task 13");
    if (command.type === "move") {
      const units = unitIds
        .map((id) => this.#units.get(id))
        .filter((unit): unit is UnitState => !!unit && unit.activity !== "die");
      this.#moveUnits(units, command.target);
      return;
    }
    for (const id of unitIds) {
      const unit = this.#units.get(id);
      if (!unit || unit.activity === "die") continue;
      if (command.type === "stop") {
        const slot = this.#inspireUnitSlots.get(id);
        const entity = slot === undefined ? undefined : this.#inspireSlots.get(slot);
        if (entity && (entity.animationMode === 1 || entity.pendingOrder !== 0)) {
          entity.pendingOrder = 1;
          continue;
        }
        this.#clearOrders(unit);
        unit.activity = "idle";
        continue;
      }
      if (command.type === "attack") {
        const target = this.#attackTarget(command.targetId);
        if (!unit.weapon || !target || target.health <= 0 || !areHostile(unit, target, this.#teamAlliances)) continue;
        this.#clearOrders(unit);
        unit.attackTargetId = target.id;
        unit.activity = "attack";
        continue;
      }
      if (command.type === "harvest") {
        const node = this.#resourceNodes.get(command.resourceId);
        if (!unit.harvester || !node || node.remaining <= 0 || !this.grid.isPassable(command.dropoff.x, command.dropoff.y)) {
          continue;
        }
        this.#clearOrders(unit);
        unit.resourceTargetId = node.id;
        unit.dropoff = { ...command.dropoff };
        unit.harvestPhase = "to-resource";
        unit.activity = "harvest";
        continue;
      }
    }
  }

  #nativeInspireOrder(): NativeInspireEntity[] {
    if (!this.#nativeInspire) return [];
    const seen = new Set<number>();
    const ordered = this.#nativeInspire.readRegisteredOrder().map((identity) => {
      const entity = this.#inspireSlots.get(identity.slot);
      if (!entity || entity.registration.generation !== identity.generation || seen.has(identity.slot)) {
        throw new RangeError("missing, stale or duplicate native Inspire update slot");
      }
      seen.add(identity.slot);
      return entity;
    });
    for (const [slot, entity] of this.#inspireSlots) {
      const unit = entity.registration.unitId === null ? undefined : this.#units.get(entity.registration.unitId);
      if (unit && unit.activity !== "die" && !seen.has(slot)) throw new RangeError("incomplete native Inspire registered order");
    }
    return ordered;
  }

  #inspireEvent(entity: NativeInspireEntity, type: NativeInspireEvent["type"],
    detail: Pick<NativeInspireEvent, "scan" | "reason"> = {}): void {
    this.#inspireEvents.push({ tick: this.#tick, casterSlot: entity.registration.slot, type,
      charge: entity.state.charge, pendingOrder: entity.pendingOrder, ...detail });
  }

  #continueInspire(entity: NativeInspireEntity): void {
    const pending = entity.pendingOrder;
    entity.pendingOrder = 0;
    if (entity.animationMode !== 2) entity.animationMode = 0;
    if (pending === 13 && verifiedLegacyInspireDeployFin(entity.registration.typeId)
      && getLegacyInspireChargeGates(entity.state.charge).deployChargeReady) {
      entity.animationMode = 1;
      this.#nativeInspire!.onTaskTransition(entity.registration, "deploy");
      this.#inspireEvent(entity, "deploy");
    } else {
      if (pending === 13) this.#inspireEvent(entity, "rejected", { reason: "native-inspire-charge-below-32" });
      this.#nativeInspire!.onTaskTransition(entity.registration, "idle");
    }
  }

  #advanceInspire(entity: NativeInspireEntity): void {
    entity.state = updateLegacyInspireCounters(entity.state, this.#sourceDayNight!.elapsed,
      getLegacyInspireProfile(entity.registration.typeId)?.recharge ?? 0);
    if (entity.animationMode !== 1) {
      entity.animationMode = 0;
      if (entity.pendingOrder !== 0) this.#continueInspire(entity);
      return;
    }
    if (!verifiedLegacyInspireDeployFin(entity.registration.typeId)) throw new RangeError("unsupported native Inspire deploy FIN");
    const position = this.#nativeInspire!.readPositionQ8(entity.registration);
    if (!Number.isInteger(position.xQ8) || !Number.isInteger(position.yQ8)) throw new RangeError("native Inspire requires Q8 coordinates");
    entity.animationMode = 2;
    completeLegacyInspireTask13({ animationMode: 2, casterTypeId: entity.registration.typeId,
      casterSlot: entity.registration.slot, ...position }, {
      continuePendingOrder: () => {
        this.#inspireEvent(entity, "continue");
        this.#continueInspire(entity);
      },
      clearCasterCharge: () => {
        entity.state = { ...entity.state, charge: 0 };
        this.#inspireEvent(entity, "clear");
      },
      readScanContext: () => {
        const randomIndex = this.#nativeInspire!.readRandomIndex();
        if (!Number.isInteger(randomIndex) || randomIndex < 0 || randomIndex > 255) throw new RangeError("invalid shared native RNG index");
        return { ...this.#nativeInspire!.readOccupancy(), casterTeam: entity.registration.team,
          slots: this.#inspireSlotRecords(), randomTable: LEGACY_INSPIRE_NATIVE_RANDOM_TABLE, randomIndex };
      },
      commitScan: (scan) => {
        for (const write of scan.writes) {
          const target = this.#inspireSlots.get(write.targetSlot)!;
          target.state = { ...target.state, timer: write.timer, casterSlot: write.casterSlot };
        }
        this.#nativeInspire!.commitRandomIndex(scan.randomIndex);
        this.#inspireEvent(entity, "effect", { scan });
      },
    });
  }

  #moveUnits(units: readonly UnitState[], target: GridPoint): void {
    for (const plane of ["ground", "air"] as const) {
      const group = units.filter(unit => (unit.movementPlane ?? "ground") === plane);
      if (group.length) this.#movePlaneUnits(group, target);
    }
  }

  #navigationGrid(unit: UnitState): NavigationGrid {
    return unit.movementPlane === "air" ? this.#airGrid : this.grid;
  }

  #airStepCells(start: GridPoint, goal: GridPoint): readonly number[] {
    return [...new Set([this.grid.index(start.x, start.y), this.grid.index(goal.x, goal.y),
      this.grid.index(start.x, goal.y), this.grid.index(goal.x, start.y)])];
  }

  #findMovementPath(grid: NavigationGrid, start: GridPoint, goal: GridPoint,
    blocked?: ReadonlySet<number>): readonly GridPoint[] | null {
    if (grid !== this.#airGrid) return findPath(grid, start, goal, { blocked });
    if (!grid.contains(start.x, start.y) || !grid.contains(goal.x, goal.y)) return null;
    const direct = [start];
    let current = start;
    while (current.x !== goal.x || current.y !== goal.y) {
      const next = { x: current.x + Math.sign(goal.x - current.x), y: current.y + Math.sign(goal.y - current.y) };
      if (this.#airStepCells(current, next).some(index => blocked?.has(index) && index !== grid.index(start.x, start.y))) break;
      direct.push(next);
      current = next;
    }
    if (current.x === goal.x && current.y === goal.y) return blocked?.has(grid.index(goal.x, goal.y)) ? null : direct;
    const path = findPath(grid, start, goal, { blocked });
    if (!path) return null;
    const result = [path[0]];
    for (let index = 1; index < path.length; index++) {
      const previous = result[result.length - 1], next = path[index + 1];
      if (next && Math.abs(next.x - previous.x) === 1 && Math.abs(next.y - previous.y) === 1
        && this.#airStepCells(previous, next).every(cell => !blocked?.has(cell) || cell === grid.index(start.x, start.y))) {
        result.push(next);
        index++;
      } else result.push(path[index]);
    }
    return result;
  }

  #movePlaneUnits(units: readonly UnitState[], target: GridPoint): void {
    const grid = this.#navigationGrid(units[0]);
    if (!this.grid.contains(target.x, target.y)) return;
    const selected = new Set(units.map((unit) => unit.id));
    const reserved = new Set<number>();
    for (const other of this.#units.values()) {
      if (other.activity === "die" || selected.has(other.id) || this.#navigationGrid(other) !== grid) continue;
      for (const index of this.#occupiedCells(other)) reserved.add(index);
      const goal = other.activity === "move" ? other.path.at(-1) : undefined;
      if (goal) reserved.add(this.grid.index(goal.x, goal.y));
    }
    const candidates = units.length > 1
        ? Array.from(grid.costs.keys())
          .filter((index) => grid.costs[index] > 0 && !reserved.has(index))
          .sort((left, right) => {
            const leftCell = this.grid.point(left);
            const rightCell = this.grid.point(right);
            return Math.abs(leftCell.x - target.x) + Math.abs(leftCell.y - target.y)
              - Math.abs(rightCell.x - target.x) - Math.abs(rightCell.y - target.y) || left - right;
          })
      : [];
    const assigned: { start: GridPoint; goal: GridPoint }[] = [];
    for (const unit of units) {
      this.#clearOrders(unit);
      unit.activity = "idle";
      const start = this.#unitCell(unit);
      let goal: GridPoint | undefined = target;
      if (units.length > 1) {
        const reachable = new Set<number>([this.grid.index(start.x, start.y)]);
        const frontier = [...reachable];
        for (let cursor = 0; cursor < frontier.length; cursor += 1) {
          for (const neighbor of grid.neighbors(frontier[cursor])) {
            if (reachable.has(neighbor) || reserved.has(neighbor)) continue;
            reachable.add(neighbor);
            frontier.push(neighbor);
          }
        }
        const index = candidates.find((candidate) => {
          if (reserved.has(candidate) || !reachable.has(candidate)) return false;
          return assigned.every((assignment) => {
            const blocked = new Set(reserved);
            blocked.add(candidate);
            blocked.delete(this.grid.index(assignment.goal.x, assignment.goal.y));
            return this.#findMovementPath(grid, assignment.start, assignment.goal, blocked) !== null;
          });
        });
        goal = index === undefined ? undefined : this.grid.point(index);
      }
      if (!goal) continue;
      const path = this.#findMovementPath(grid, start, goal);
      if (!path) continue;
      reserved.add(this.grid.index(goal.x, goal.y));
      assigned.push({ start, goal });
      this.#setPath(unit, path);
      unit.activity = unit.pathIndex < path.length ? "move" : "idle";
    }
  }

  #occupiedCells(unit: UnitState): readonly number[] {
    const actor = this.#resourceActors.get(unit.id);
    if (actor && this.#resourceOwned(unit.id)) return actor.profile.occupancy.map((point) => this.grid.index(point.x, point.y));
    const centerX = (unit.xSubcells - SUBCELLS_PER_CELL / 2) / SUBCELLS_PER_CELL;
    const centerY = (unit.ySubcells - SUBCELLS_PER_CELL / 2) / SUBCELLS_PER_CELL;
    const cells = new Set<number>();
    for (const cellY of [Math.floor(centerY), Math.ceil(centerY)]) {
      for (const cellX of [Math.floor(centerX), Math.ceil(centerX)]) {
        if (this.grid.contains(cellX, cellY)) cells.add(this.grid.index(cellX, cellY));
      }
    }
    return [...cells];
  }

  #reserveMovement(index: number, unitId: number): void {
    const reservations = this.#units.get(unitId)?.movementPlane === "air" ? this.#airMovementReservations : this.#movementReservations;
    const owners = reservations.get(index) ?? new Set<number>();
    owners.add(unitId);
    reservations.set(index, owners);
  }

  #movementBlocked(unit: UnitState): ReadonlySet<number> {
    const blocked = new Set<number>();
    for (const [index, owners] of unit.movementPlane === "air" ? this.#airMovementReservations : this.#movementReservations) {
      if (owners.size > 1 || !owners.has(unit.id)) blocked.add(index);
    }
    return blocked;
  }

  #setPath(unit: UnitState, path: readonly GridPoint[]): void {
    unit.path = path;
    unit.reservedDestination = null;
    const start = path[0];
    unit.pathIndex = start && unit.xSubcells === cellCenter(start.x) && unit.ySubcells === cellCenter(start.y) ? 1 : 0;
  }

  #advancePath(unit: UnitState): boolean {
    const grid = this.#navigationGrid(unit);
    const hadPath = unit.pathIndex < unit.path.length;
    let movement = unit.speedSubcellsPerTick;
    const blocked = this.#movementBlocked(unit);
    while (movement > 0 && unit.pathIndex < unit.path.length) {
      const target = unit.path[unit.pathIndex];
      const targetIndex = this.grid.index(target.x, target.y);
      const swept = unit.movementPlane === "air" ? this.#airStepCells(this.#unitCell(unit), target) : [targetIndex];
      if (!grid.isPassable(target.x, target.y) || swept.some(index => blocked.has(index))) {
        const start = this.#unitCell(unit);
        if (unit.xSubcells !== cellCenter(start.x) || unit.ySubcells !== cellCenter(start.y)) return false;
        const goal = unit.path[unit.path.length - 1];
        let path = this.#findMovementPath(grid, start, goal, blocked);
        if (!path) {
          const oncoming = [...this.#units.values()].some((other) => {
            const next = other.path[other.pathIndex];
            return other.id < unit.id && other.activity !== "die" && this.#navigationGrid(other) === grid
              && other.xSubcells === cellCenter(target.x) && other.ySubcells === cellCenter(target.y)
              && next?.x === start.x && next.y === start.y;
          });
          if (oncoming) {
            const detourBlocked = new Set(blocked);
            detourBlocked.delete(this.grid.index(goal.x, goal.y));
            detourBlocked.add(this.grid.index(start.x, start.y));
            for (const neighbor of grid.neighbors(this.grid.index(start.x, start.y))) {
              if (blocked.has(neighbor)) continue;
              const detour = this.#findMovementPath(grid, this.grid.point(neighbor), goal, detourBlocked);
              if (!detour) continue;
              path = [start, ...detour];
              break;
            }
          }
        }
        if (!path) return false;
        this.#setPath(unit, path);
        continue;
      }
      for (const index of swept) this.#reserveMovement(index, unit.id);
      if (unit.reservedDestination !== targetIndex) {
        unit.reservedDestination = targetIndex;
        this.#reservationEvents.push({ unitId: unit.id, tileX: target.x, tileY: target.y });
      }
      const targetX = cellCenter(target.x);
      const targetY = cellCenter(target.y);
      const deltaX = targetX - unit.xSubcells;
      const deltaY = targetY - unit.ySubcells;
      const distance = unit.movementPlane === "air" ? Math.hypot(deltaX, deltaY) : Math.abs(deltaX) + Math.abs(deltaY);
      if (distance <= movement) {
        unit.xSubcells = targetX;
        unit.ySubcells = targetY;
        movement -= distance;
        unit.pathIndex += 1;
        unit.reservedDestination = null;
      } else if (unit.movementPlane === "air") {
        unit.xSubcells += Math.round(deltaX * movement / distance);
        unit.ySubcells += Math.round(deltaY * movement / distance);
        movement = 0;
      } else {
        if (deltaX !== 0) {
          const xMovement = Math.min(movement, Math.abs(deltaX));
          unit.xSubcells += Math.sign(deltaX) * xMovement;
          movement -= xMovement;
        }
        if (movement > 0 && deltaY !== 0) {
          const yMovement = Math.min(movement, Math.abs(deltaY));
          unit.ySubcells += Math.sign(deltaY) * yMovement;
          movement -= yMovement;
        }
      }
    }
    if (unit.pathIndex >= unit.path.length) {
      if (hadPath) this.#movementFinishedEvents.push({ unitId: unit.id, tick: this.#tick,
        finalXQ8: unit.xSubcells * 256 / SUBCELLS_PER_CELL, finalYQ8: unit.ySubcells * 256 / SUBCELLS_PER_CELL,
        ...(this.#resourceActors.has(unit.id) ? { nativeIdentity: resourceToken(this.#resourceActors.get(unit.id)!) } : {}) });
      unit.path = [];
      unit.pathIndex = 0;
      return true;
    }
    return false;
  }

  #attackTarget(id: number): UnitState | StaticTargetState | undefined {
    return this.#units.get(id) ?? this.#staticTargets.get(id);
  }

  canAutoTarget(attackerId: number, targetId: number): boolean {
    const attacker = this.#attackTarget(attackerId);
    const target = this.#attackTarget(targetId);
    if (!attacker?.weapon || attacker.health <= 0 || !target || target.health <= 0
      || this.#resourceOwned(attackerId) || this.#resourceOwned(targetId)
      || (target.team !== undefined && target.team >= 8)
      || !areHostile(attacker, target, this.#teamAlliances)) return false;
    const profile = attacker.weapon.sourceDamage;
    // Zero-damage targets (TOWR 81 and beacons 84/89/95 are class 8, coefficient 0) would pin attackers forever.
    if (profile && "mode" in profile) {
      const result = nativeOrdinaryHitDamage(attacker.weapon.damage, profile, target.sourceDefense,
        this.#sourceDayNight?.phase, attacker.team, target.team, 256);
      return "diagnostic" in result || result.damage > 0;
    }
    return (profile && target.sourceDefense
      ? calculateLegacyDamage(attacker.weapon.damage, profile, target.sourceDefense)
      : attacker.weapon.damage) > 0;
  }

  #advanceAttack(unit: UnitState): UnitState | StaticTargetState | null {
    const target = unit.attackTargetId === null ? null : this.#attackTarget(unit.attackTargetId);
    if (target && this.#resourceOwned(target.id)) throw new RangeError("Resource-owned target requires host combat ownership");
    if (!target || target.health <= 0 || !unit.weapon || !areHostile(unit, target, this.#teamAlliances)) {
      this.#clearOrders(unit);
      unit.activity = "idle";
      return null;
    }
    const distance = Math.abs(target.xSubcells - unit.xSubcells) + Math.abs(target.ySubcells - unit.ySubcells);
    if (distance > unit.weapon.rangeCells * SUBCELLS_PER_CELL) {
      this.#ensureAttackPath(unit, target, unit.weapon.rangeCells);
      this.#advancePath(unit);
      return null;
    }
    this.#setPath(unit, []);
    return target;
  }

  #fireWeapon(unit: UnitState | StaticTargetState, target: UnitState | StaticTargetState, pendingDamage: Map<number, number>): void {
    if (unit.weapon && unit.attackCooldown === 0) {
      const profile = unit.weapon.sourceDamage;
      let damage = unit.weapon.damage;
      const nativeSlot = this.#inspireUnitSlots.get(unit.id);
      const native = nativeSlot === undefined ? undefined : this.#inspireSlots.get(nativeSlot);
      const adapted = native ? undefined : this.#adaptedInspireTargets.get(unit.id);
      const adaptedQ8 = adapted && adapted.timer > 0 ? adapted.multiplierQ8 : 256;
      const inspireFactorQ8 = native ? this.#inspireMultiplier(native) : adaptedQ8;
      if (profile && "mode" in profile) {
        const result = nativeOrdinaryHitDamage(damage, profile, target.sourceDefense,
          this.#sourceDayNight?.phase, unit.team, target.team, inspireFactorQ8);
        if ("diagnostic" in result) {
          this.#sourceDamageDiagnostics.push({ tick: this.#tick, attackerId: unit.id, targetId: target.id, reason: result.diagnostic });
          return;
        }
        damage = result.damage;
      } else if (native && native.state.timer !== 0) {
        this.#sourceDamageDiagnostics.push({ tick: this.#tick, attackerId: unit.id, targetId: target.id,
          reason: "unsupported-inspired-hit-profile" });
        return;
      } else {
        if (profile && target.sourceDefense) damage = calculateLegacyDamage(damage, profile, target.sourceDefense);
        if (adaptedQ8 !== 256) damage = Math.floor(damage * adaptedQ8 / 256);
      }
      pendingDamage.set(target.id, (pendingDamage.get(target.id) ?? 0) + damage);
      this.#combatEvents.push({
        type: "shot",
        tick: this.#tick,
        attackerId: unit.id,
        targetId: target.id,
        damage,
      });
      unit.attackCooldown = unit.weapon.cooldownTicks;
    }
  }

  #ensureAttackPath(unit: UnitState, target: UnitState | StaticTargetState, range: number): void {
    const grid = this.#navigationGrid(unit);
    const targetX = Math.floor(target.xSubcells / SUBCELLS_PER_CELL);
    const targetY = Math.floor(target.ySubcells / SUBCELLS_PER_CELL);
    const inRange = (cell: GridPoint) =>
      Math.abs(cellCenter(cell.x) - target.xSubcells) + Math.abs(cellCenter(cell.y) - target.ySubcells)
      <= range * SUBCELLS_PER_CELL;
    const currentGoal = unit.path.at(-1);
    const blocked = this.#movementBlocked(unit);
    const next = unit.path[unit.pathIndex];
    if (currentGoal && inRange(currentGoal) && unit.pathIndex < unit.path.length
      && grid.isPassable(currentGoal.x, currentGoal.y) && !blocked.has(grid.index(currentGoal.x, currentGoal.y))
      && next && grid.isPassable(next.x, next.y) && !blocked.has(grid.index(next.x, next.y))) return;
    const start = this.#unitCell(unit);
    const candidates: GridPoint[] = [];
    for (let cellY = Math.max(0, targetY - range); cellY <= Math.min(this.grid.height - 1, targetY + range); cellY += 1) {
      for (let cellX = Math.max(0, targetX - range); cellX <= Math.min(this.grid.width - 1, targetX + range); cellX += 1) {
        const cell = { x: cellX, y: cellY };
        if (inRange(cell) && grid.isPassable(cellX, cellY)) candidates.push(cell);
      }
    }
    candidates.sort((left, right) =>
      Math.abs(left.x - start.x) + Math.abs(left.y - start.y)
      - Math.abs(right.x - start.x) - Math.abs(right.y - start.y)
      || this.grid.index(left.x, left.y) - this.grid.index(right.x, right.y),
    );
    for (const goal of candidates) {
      const path = this.#findMovementPath(grid, start, goal, blocked);
      if (!path) continue;
      this.#setPath(unit, path);
      return;
    }
    this.#setPath(unit, []);
  }

  #advanceHarvest(unit: UnitState): void {
    const node = unit.resourceTargetId === null ? null : this.#resourceNodes.get(unit.resourceTargetId);
    if (!node || !unit.harvester || !unit.dropoff) {
      this.#clearOrders(unit);
      unit.activity = "idle";
      return;
    }
    const cell = this.#unitCell(unit);
    if (unit.harvestPhase === "to-resource") {
      if (cell.x === node.cell.x && cell.y === node.cell.y) {
        unit.path = [];
        unit.pathIndex = 0;
        unit.harvestPhase = "collecting";
      } else {
        this.#ensurePath(unit, node.cell);
        this.#advancePath(unit);
      }
      return;
    }
    if (unit.harvestPhase === "collecting") {
      const room = unit.harvester.cargoCapacity - unit.cargo;
      const amount = Math.min(room, unit.harvester.harvestPerTick, node.remaining);
      unit.cargo += amount;
      node.remaining -= amount;
      if (unit.cargo >= unit.harvester.cargoCapacity || node.remaining === 0) {
        unit.harvestPhase = "to-dropoff";
      }
      return;
    }
    if (cell.x === unit.dropoff.x && cell.y === unit.dropoff.y) {
      this.#resources[unit.faction] += unit.cargo;
      unit.cargo = 0;
      if (node.remaining > 0) unit.harvestPhase = "to-resource";
      else {
        this.#clearOrders(unit);
        unit.activity = "idle";
      }
    } else {
      this.#ensurePath(unit, unit.dropoff);
      this.#advancePath(unit);
    }
  }

  #ensurePath(unit: UnitState, goal: GridPoint): void {
    const currentGoal = unit.path.at(-1);
    if (currentGoal?.x === goal.x && currentGoal.y === goal.y && unit.pathIndex < unit.path.length) return;
    const path = this.#findMovementPath(this.#navigationGrid(unit), this.#unitCell(unit), goal);
    this.#setPath(unit, path ?? []);
  }

  #unitCell(unit: UnitState | StaticTargetState): GridPoint {
    return {
      x: Math.floor(unit.xSubcells / SUBCELLS_PER_CELL),
      y: Math.floor(unit.ySubcells / SUBCELLS_PER_CELL),
    };
  }

  #clearOrders(unit: UnitState): void {
    unit.path = [];
    unit.pathIndex = 0;
    unit.reservedDestination = null;
    unit.attackTargetId = null;
    unit.resourceTargetId = null;
    unit.dropoff = null;
    unit.harvestPhase = null;
  }

  #validateWeapon(weapon: WeaponStats): void {
    if (
      !Number.isInteger(weapon.damage) ||
      (weapon.sourceDamage ? weapon.damage < 0 || weapon.damage > 0x7fffffff : weapon.damage <= 0) ||
      !Number.isInteger(weapon.rangeCells) ||
      weapon.rangeCells < 0 ||
      !Number.isInteger(weapon.cooldownTicks) ||
      weapon.cooldownTicks <= 0
    ) {
      throw new RangeError("weapon stats must be positive integers with a non-negative range; source damage may be zero");
    }
  }

  #validateVision(vision: UnitVisionStats): void {
    if (
      !Number.isInteger(vision.dayRangeCells) ||
      vision.dayRangeCells < 0 ||
      !Number.isInteger(vision.nightRangeCells) ||
      vision.nightRangeCells < 0
    ) {
      throw new RangeError("vision ranges must be non-negative integers");
    }
  }

  #validateHarvester(harvester: HarvesterStats): void {
    if (
      !Number.isInteger(harvester.cargoCapacity) ||
      harvester.cargoCapacity <= 0 ||
      !Number.isInteger(harvester.harvestPerTick) ||
      harvester.harvestPerTick <= 0
    ) {
      throw new RangeError("harvester stats must be positive integers");
    }
  }

  #queueConstruction(command: Extract<SimulationCommand, { type: "build" }>): void {
    const builder = this.#buildings.get(command.builderId);
    if (!builder || builder.health <= 0) return;
    if (
      !Number.isInteger(command.cost) ||
      command.cost < 0 ||
      !Number.isInteger(command.buildTicks) ||
      command.buildTicks <= 0 ||
      !Number.isInteger(command.maxHealth) ||
      command.maxHealth <= 0 ||
      !this.grid.isPassable(command.target.x, command.target.y) ||
      this.#buildingAt(command.target) ||
      this.#constructionReserved(command.target) ||
      this.#resources[builder.faction] < command.cost
    ) {
      return;
    }
    this.#resources[builder.faction] -= command.cost;
    builder.constructionQueue.push({
      kind: command.kind,
      targetCellX: command.target.x,
      targetCellY: command.target.y,
      remainingTicks: command.buildTicks,
      totalTicks: command.buildTicks,
      cost: command.cost,
      maxHealth: command.maxHealth,
    });
  }

  #advanceConstruction(): void {
    for (const builder of [...this.#buildings.values()].sort((left, right) => left.id - right.id)) {
      const construction = builder.constructionQueue[0];
      if (!construction) continue;
      const next = { ...construction, remainingTicks: construction.remainingTicks - 1 };
      builder.constructionQueue[0] = next;
      if (next.remainingTicks > 0) continue;
      builder.constructionQueue.shift();
      this.addBuilding({
        faction: builder.faction,
        kind: next.kind,
        cell: { x: next.targetCellX, y: next.targetCellY },
        maxHealth: next.maxHealth,
      });
    }
  }

  #buildingAt(cell: GridPoint): BuildingState | undefined {
    return [...this.#buildings.values()].find(
      (building) => building.cell.x === cell.x && building.cell.y === cell.y,
    );
  }

  #constructionReserved(cell: GridPoint): boolean {
    return [...this.#buildings.values()].some((building) =>
      building.constructionQueue.some(
        (construction) =>
          construction.targetCellX === cell.x && construction.targetCellY === cell.y,
      ),
    );
  }
}

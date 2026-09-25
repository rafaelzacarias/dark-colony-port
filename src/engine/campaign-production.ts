import { createLegacyProductionCatalog, type LegacyProductionEntry, type LegacyProductionSourceRecord } from "./legacy-production";
import type { CampaignWorld } from "./campaign-world";
import { allocateTransportProductionExit, readTransportHostState, reserveTransportProductionExit, transportHostState, transportProductionExitBlocked,
  type ProductionExitReservation } from "./transport-host";
import { advanceLegacyResourceAnimation, resetLegacyResourceAnimation,
  type LegacyResourceAnimation, type LegacyResourceAnimationProfile } from "./legacy-resource";
import { createNativeConstructionHost, receiveNativeConstruction, visitNativeConstruction,
  type NativeConstructionConfiguration, type NativeConstructionHost, type NativeConstructionVisit } from "./native-construction-host";

type Immutable<Value> = Value extends object ? { readonly [Key in keyof Value]: Immutable<Value[Key]> } : Value;
type QueueIndex = 0 | 1 | 2 | 3;
type Bit = 0 | 1;
type DependencyState = 0 | 1 | 2;

export interface ProductionUnitSource {
  readonly unitType: number;
  readonly queue: QueueIndex;
  readonly exitSelector: 0 | 1;
  readonly exitOffset: { readonly x: number; readonly y: number };
}

export interface ProductionTeamSeed {
  readonly team: number;
  readonly race: Bit;
  readonly credits: number;
  readonly costAccumulator: number;
  readonly base: { readonly x: number; readonly y: number };
  readonly slots: readonly { readonly health: number; readonly level: number; readonly busy: Bit }[];
  readonly restrictions: readonly number[];
  readonly upgrades: readonly { readonly unitType: number; readonly weapon: number; readonly armor: number }[];
  readonly producerDelays?: readonly number[];
}

export interface ProductionSourceProfile extends LegacyResourceAnimationProfile {
  readonly unitType: 0 | 8;
  readonly bankField: 152;
  readonly finSha256: string;
}

export interface AdaptedCollectorProductionProfile {
  readonly runtimeProfile: "browser-adapted";
  readonly unitType: 6 | 14;
  readonly completionVisits: number;
}

export interface AdaptedUnitProductionProfile {
  readonly runtimeProfile: "browser-adapted";
  readonly unitType: 2 | 3 | 4 | 5 | 10 | 11 | 12 | 13;
  readonly completionVisits: number;
}

export interface AdaptedProductionUpgrades {
  readonly runtimeProfile: "browser-adapted";
}

export const ADAPTED_UNIT_PRODUCTION_SOURCES = freeze([
  { unitType: 2, race: 0, dependency: 11, cost: 600, dependencies: [3, 2], queue: 1, exitSelector: 0, exitOffset: { x: 2, y: 3 }, plane: "ground" },
  { unitType: 3, race: 0, dependency: 12, cost: 1000, dependencies: [5, 4], queue: 1, exitSelector: 0, exitOffset: { x: 2, y: 3 }, plane: "ground" },
  { unitType: 4, race: 0, dependency: 13, cost: 1500, dependencies: [1, 6], queue: 3, exitSelector: 0, exitOffset: { x: -4, y: 3 }, plane: "ground" },
  { unitType: 5, race: 0, dependency: 10, cost: 600, dependencies: [0, 3, 4], queue: 2, exitSelector: 1, exitOffset: { x: -5, y: -1 }, plane: "flying" },
  { unitType: 10, race: 1, dependency: 25, cost: 600, dependencies: [17, 16], queue: 1, exitSelector: 0, exitOffset: { x: 2, y: 3 }, plane: "ground" },
  { unitType: 11, race: 1, dependency: 26, cost: 1000, dependencies: [19, 18], queue: 1, exitSelector: 0, exitOffset: { x: 2, y: 3 }, plane: "ground" },
  { unitType: 12, race: 1, dependency: 27, cost: 1500, dependencies: [15, 20], queue: 3, exitSelector: 0, exitOffset: { x: -4, y: 3 }, plane: "ground" },
  { unitType: 13, race: 1, dependency: 24, cost: 600, dependencies: [14, 17, 18], queue: 2, exitSelector: 1, exitOffset: { x: -5, y: -1 }, plane: "flying" },
] as const);

export function productionProducerSlot(queue: QueueIndex): 0 | 1 | 2 | 4 {
  return ([1, 2, 0, 4] as const)[queue];
}

export interface ProductionProducerVisit {
  readonly team: number;
  readonly queue: QueueIndex;
  readonly population: number;
  readonly populationLimit: number;
}

function validateSourceProfile(profile: ProductionSourceProfile): void {
  const human = profile.unitType === 0;
  const delays = human ? Array(22).fill(1) : [2, ...Array(26).fill(1), ...Array(5).fill(2)];
  requireProduction((human || profile.unitType === 8) && profile.bankField === 0x98
    && profile.id === (human ? "TRSCBUILD0" : "GRAYBUILDSTAND0")
    && profile.finSha256 === (human ? "b27b20282999188e37a74872b70a273b370cc1dd219f2f8fa84f5f2f2ca3a5a4"
      : "99c3d4e4fa0badeb2cd68361a6f1b57dcf9dfbdd027f820a68d806aa18773fa1")
    && profile.directions.length === 32 && profile.directions.every((timeline) =>
      timeline.length === delays.length && timeline.every((delay, index) => delay === delays[index])),
  "Unverified native production profile: require original base TRSC/GRAY +0x98 FIN bank and decoded delays");
}

interface QueueItem { ticket: string; dependency: number; unitType: number; cost: number }
interface Allocation { id: string; ticket: string; unitType: number; tileX: number; tileY: number }
interface UnitQueue {
  items: QueueItem[];
  ready: Bit;
  delay: number;
  activeTicket: string | null;
  allocation: Allocation | null;
  animation?: LegacyResourceAnimation;
  adaptedElapsedVisits?: number;
}
interface Construction {
  id: string;
  nativeId: number;
  unitType: 20 | 32;
  phase: 0 | 1 | 2 | 3 | 4;
}
interface TeamState {
  team: number;
  race: Bit;
  credits: number;
  costAccumulator: number;
  base: { x: number; y: number };
  slots: { health: number; level: number; busy: Bit }[];
  restrictions: number[];
  upgrades: { unitType: number; weapon: number; armor: number }[];
  eligibility: Record<number, DependencyState>;
  pending: Record<number, number>;
  queues: UnitQueue[];
  latch: Bit;
  construction: Construction | null;
}

export type ProductionAction =
  | { type: "sync-credits"; expectedPreviousCredits: number; credits: number }
  | { type: "receive-prepaid-city"; dependency: number; slot: 3; level: 0; expectedCredits: number;
      provenance: { code: "campaign-ai"; sourceSha256: string; receiptKey: string } }
  | { type: "native-construction-visit"; visit: NativeConstructionVisit }
  | { type: "receive-prepaid-unit"; dependency: number; unitType: 0 | 8; count: 1; expectedCredits: number;
      provenance: { code: "campaign-ai"; sourceSha256: string; receiptKey: string } }
  | { type: "reserve"; dependency: number }
  | { type: "release-pending"; dependency: number }
  | { type: "dispatch"; dependency: number }
  | { type: "construction"; constructionId: string; nativeId: number;
      transition: "arrival-created" | "build-started" | "build-finished" | "departure-finished" | "released" }
  | { type: "producer-wait"; queue: QueueIndex; ticket: string; delayAfter: number }
  | { type: "producer-idle"; queue: QueueIndex }
  | { type: "producer-advance"; queue: QueueIndex; ticket: string }
  | { type: "producer-started" | "producer-cap-refund"; queue: QueueIndex; ticket: string }
  | { type: "producer-completed"; queue: QueueIndex; ticket: string; animationMode: 2 }
  | { type: "allocated"; queue: QueueIndex; requestId: string; nativeSlot: number; generation: number };

export interface ProductionEvent {
  readonly id: string;
  readonly team: number;
  readonly action: ProductionAction;
}

export type ProductionRequest =
  | { type: "initialize-science"; id: string; team: number; nativeId: number; unitType: 20 | 32; slot: 3; level: 0 }
  | { type: "upgrade-applied"; id: string; team: number; unitType: number; selector: Bit; level: number }
  | { type: "allocate-unit"; id: string; team: number; queue: QueueIndex; ticket: string; unitType: number; tileX: number; tileY: number }
  | { type: "unit-allocated"; id: string; team: number; nativeSlot: number; generation: number }
  | { type: "population-message"; id: string; team: number; message: 119 };

interface ProductionData {
  kind: "campaign-production-v1";
  sessionId: string;
  queueSafetyLimit: number;
  catalog: LegacyProductionEntry[];
  units: ProductionUnitSource[];
  sourceProfiles?: ProductionSourceProfile[];
  adaptedCollectorProfiles?: AdaptedCollectorProductionProfile[];
  adaptedUnitProfiles?: AdaptedUnitProductionProfile[];
  adaptedUpgrades?: AdaptedProductionUpgrades;
  constructionHosts?: NativeConstructionHost[];
  teams: TeamState[];
  journal: ProductionEvent[];
  requests: ProductionRequest[];
}

export type CampaignProductionState = Immutable<ProductionData>;

function adaptedProfile(state: CampaignProductionState, unitType: number) {
  return state.adaptedCollectorProfiles?.find(profile => profile.unitType === unitType)
    ?? state.adaptedUnitProfiles?.find(profile => profile.unitType === unitType);
}

function adaptedUnitForRace(state: CampaignProductionState, unitType: number | null | undefined, race: number): boolean {
  return !!state.adaptedUnitProfiles?.some(profile => profile.unitType === unitType
    && ADAPTED_UNIT_PRODUCTION_SOURCES.some(source => source.unitType === unitType && source.race === race));
}

function adaptedUpgradeForRace(state: CampaignProductionState, entry: LegacyProductionEntry, race: number): boolean {
  const types: readonly number[] = race === 0 ? [0, 2, 3, 4, 5, 41] : race === 1 ? [8, 10, 11, 12, 13, 42] : [];
  return state.adaptedUpgrades?.runtimeProfile === "browser-adapted" && entry.kind === "upgrade"
    && types.includes(entry.rawFields[1]);
}

export function productionUpgradeLevels(state: CampaignProductionState | undefined, teamId: number, unitType: number):
  { readonly weaponLevel: number; readonly armorLevel: number } | undefined {
  if (state?.adaptedUpgrades?.runtimeProfile !== "browser-adapted") return undefined;
  const team = state.teams.find(candidate => candidate.team === teamId);
  if (!team || !state.catalog.some(entry => entry.unitType === unitType && adaptedUpgradeForRace(state, entry, team.race))) return undefined;
  const upgrade = team.upgrades.find(candidate => candidate.unitType === unitType);
  return { weaponLevel: upgrade?.weapon ?? 0, armorLevel: upgrade?.armor ?? 0 };
}

function requireProduction(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function integer(value: number, maximum = 0x7fffffff): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function signed32(value: number): boolean {
  return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
}

function freeze<Value>(value: Value): Immutable<Value> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as Immutable<Value>;
}

function refresh(state: ProductionData, team: TeamState): void {
  for (const entry of state.catalog) {
    const [, target, selector, levelOrRace] = entry.rawFields;
    const slot = entry.kind === "building" ? team.slots[target] : null;
    const upgrade = team.upgrades.find((value) => value.unitType === target);
    const completed = slot ? slot.health !== 0 && slot.level >= selector && team.race === levelOrRace
      : entry.kind === "upgrade" && (selector === 0 ? upgrade?.weapon ?? 0 : upgrade?.armor ?? 0) >= levelOrRace;
    if (completed) {
      team.eligibility[entry.id] = 0;
      continue;
    }
    const blocked = entry.dependencies.some((dependency) => {
      const prerequisite = state.catalog.find((candidate) => candidate.id === dependency)!;
      return dependency === entry.id || team.eligibility[dependency] !== 0
        || (prerequisite.kind === "building" && team.slots[prerequisite.rawFields[1]].busy !== 0);
    });
    team.eligibility[entry.id] = blocked || slot?.busy === 1 || team.restrictions.includes(entry.id) ? 2 : 1;
  }
}

export function createCampaignProduction(options: {
  readonly sessionId: string;
  readonly records: readonly LegacyProductionSourceRecord[];
  readonly units: readonly ProductionUnitSource[];
  readonly teams: readonly ProductionTeamSeed[];
  readonly queueSafetyLimit?: number;
  readonly sourceProfiles?: readonly ProductionSourceProfile[];
  readonly adaptedCollectorProfiles?: readonly AdaptedCollectorProductionProfile[];
  readonly adaptedUnitProfiles?: readonly AdaptedUnitProductionProfile[];
  readonly adaptedUpgrades?: AdaptedProductionUpgrades;
  readonly constructionSources?: readonly NativeConstructionConfiguration[];
}): CampaignProductionState {
  const catalog = [...createLegacyProductionCatalog(options.records).values()].sort((left, right) => left.id - right.id);
  const limit = options.queueSafetyLimit ?? 50;
  requireProduction(options.sessionId.length > 0 && integer(limit, 50) && limit > 0, "Invalid production session or safety limit");
  for (const entry of catalog) {
    requireProduction(entry.id < 110 && entry.kind !== "unknown" && entry.dependencies.length <= 5, "Unsupported native DEPEND record");
    const [, target, selector, levelOrRace] = entry.rawFields;
    requireProduction(integer(target, entry.kind === "building" ? 4 : 105), "Invalid native production target");
    if (entry.kind === "building") requireProduction(integer(selector, 1) && integer(levelOrRace, 1), "Invalid building metadata");
    if (entry.kind === "upgrade") requireProduction(integer(selector, 1) && integer(levelOrRace, 2) && levelOrRace > 0
      && entry.cost === 1000 * levelOrRace, "Unsupported upgrade accounting");
  }
  const units = structuredClone(options.units) as ProductionUnitSource[];
  if (options.adaptedUpgrades !== undefined) {
    requireProduction(options.adaptedUpgrades?.runtimeProfile === "browser-adapted"
      && options.sourceProfiles?.length && !options.constructionSources?.length,
    "Adapted upgrades require explicit browser-adapted ownership, source profiles and no native construction owner");
  }
  if (options.adaptedUnitProfiles) {
    requireProduction(options.sourceProfiles?.length && !options.constructionSources?.length
      && options.adaptedUnitProfiles.length > 0
      && new Set(options.adaptedUnitProfiles.map(profile => profile.unitType)).size === options.adaptedUnitProfiles.length,
    "Adapted units require source infantry profiles, unique units and no native construction owner");
    for (const profile of options.adaptedUnitProfiles) {
      const source = ADAPTED_UNIT_PRODUCTION_SOURCES.find(candidate => candidate.unitType === profile.unitType);
      const entry = catalog.find(candidate => candidate.id === source?.dependency);
      const unit = units.find(candidate => candidate.unitType === profile.unitType);
      requireProduction(profile.runtimeProfile === "browser-adapted"
        && integer(profile.completionVisits, 65535) && profile.completionVisits > 0
        && source && entry?.kind === "unit" && entry.unitType === profile.unitType && entry.cost === source.cost
        && JSON.stringify(entry.dependencies) === JSON.stringify(source.dependencies)
        && unit?.queue === source.queue && unit.exitSelector === source.exitSelector
        && unit.exitOffset.x === source.exitOffset.x && unit.exitOffset.y === source.exitOffset.y,
      "Invalid adapted unit profile or source dependency/exit");
    }
  }
  if (options.adaptedCollectorProfiles) {
    requireProduction(options.sourceProfiles?.length && !options.constructionSources?.length
      && options.adaptedCollectorProfiles.length > 0
      && new Set(options.adaptedCollectorProfiles.map(profile => profile.unitType)).size === options.adaptedCollectorProfiles.length,
    "Adapted collectors require source infantry profiles, unique collectors and no native construction owner");
    for (const profile of options.adaptedCollectorProfiles) {
      const dependency = profile.unitType === 6 ? 7 : 21;
      const entry = catalog.find(candidate => candidate.id === dependency);
      const unit = units.find(candidate => candidate.unitType === profile.unitType);
      requireProduction(profile.runtimeProfile === "browser-adapted" && (profile.unitType === 6 || profile.unitType === 14)
        && integer(profile.completionVisits, 65535) && profile.completionVisits > 0
        && entry?.kind === "unit" && entry.unitType === profile.unitType && entry.cost === 1500
        && JSON.stringify(entry.dependencies) === JSON.stringify([profile.unitType === 6 ? 0 : 14])
        && unit?.queue === 2 && unit.exitSelector === 0 && unit.exitOffset.x === -4 && unit.exitOffset.y === 0,
      "Invalid adapted collector profile or source dependency/exit");
    }
  }
  if (options.sourceProfiles) {
    requireProduction(options.sourceProfiles.length > 0 && new Set(options.sourceProfiles.map((profile) => profile.unitType)).size
      === options.sourceProfiles.length, "Missing or duplicate production source profiles");
    for (const profile of options.sourceProfiles) {
      validateSourceProfile(profile);
      const source = units.find((unit) => unit.unitType === profile.unitType);
      requireProduction(source?.queue === 0 && source.exitSelector === 0 && source.exitOffset.x === 0 && source.exitOffset.y === -3,
        "Unverified base TRSC/GRAY source exit selectors");
    }
  }
  requireProduction(new Set(units.map((unit) => unit.unitType)).size === units.length, "Duplicate unit source");
  for (const unit of units) requireProduction(integer(unit.unitType, 105) && integer(unit.queue, 3) && integer(unit.exitSelector, 1)
    && Number.isSafeInteger(unit.exitOffset.x) && Number.isSafeInteger(unit.exitOffset.y), "Invalid source queue/exit");
  for (const entry of catalog.filter((candidate) => candidate.kind === "unit")) {
    requireProduction(units.some((unit) => unit.unitType === entry.unitType), "Missing GAMESTAT queue/exit source");
  }
  const teams = options.teams.map((seed): TeamState => {
    requireProduction(integer(seed.team, 7) && integer(seed.race, 1) && signed32(seed.credits) && integer(seed.costAccumulator), "Invalid team economy");
    requireProduction(integer(seed.base.x, 255) && integer(seed.base.y, 255), "Invalid colony base");
    requireProduction(seed.slots.length === 5 && seed.slots.every((slot) => integer(slot.health) && integer(slot.level, 1) && slot.busy === 0),
      "Seed five idle City slots; restore active production from its saved snapshot");
    requireProduction(seed.restrictions.every((identifier) => integer(identifier, 109)), "Invalid scenario restrictions");
    requireProduction(new Set(seed.upgrades.map((upgrade) => upgrade.unitType)).size === seed.upgrades.length
      && seed.upgrades.every((upgrade) => integer(upgrade.unitType, 105) && integer(upgrade.weapon, 2) && integer(upgrade.armor, 2)), "Invalid upgrade seed");
    requireProduction(seed.producerDelays === undefined || (seed.producerDelays.length === 4
      && seed.producerDelays.every((delay) => integer(delay, 255))), "Invalid source producer delay bytes");
    return { ...structuredClone(seed), slots: seed.slots.map((slot) => ({ ...slot })), restrictions: [...seed.restrictions], upgrades: seed.upgrades.map((upgrade) => ({ ...upgrade })),
      eligibility: Object.fromEntries(catalog.map((entry) => [entry.id, 0])), pending: {}, latch: 0, construction: null,
      queues: Array.from({ length: 4 }, (_, index) => ({ items: [], ready: 1, delay: seed.producerDelays?.[index] ?? 0, activeTicket: null, allocation: null })) };
  });
  requireProduction(new Set(teams.map((team) => team.team)).size === teams.length, "Duplicate team");
  const state: ProductionData = { kind: "campaign-production-v1", sessionId: options.sessionId, queueSafetyLimit: limit, catalog, units, teams, journal: [], requests: [] };
  if (options.sourceProfiles) state.sourceProfiles = structuredClone(options.sourceProfiles) as ProductionSourceProfile[];
  if (options.adaptedCollectorProfiles) state.adaptedCollectorProfiles = structuredClone(options.adaptedCollectorProfiles) as AdaptedCollectorProductionProfile[];
  if (options.adaptedUnitProfiles) state.adaptedUnitProfiles = structuredClone(options.adaptedUnitProfiles) as AdaptedUnitProductionProfile[];
  if (options.adaptedUpgrades !== undefined) state.adaptedUpgrades = { runtimeProfile: "browser-adapted" };
  if (options.constructionSources) {
    requireProduction(options.constructionSources.length > 0 && new Set(options.constructionSources.map(source => source.team)).size
      === options.constructionSources.length, "Missing or duplicate source construction teams");
    state.constructionHosts = options.constructionSources.map(source => {
      const team = teams.find(candidate => candidate.team === source.team);
      requireProduction(team && team.race === source.race && team.base.x === source.base.x && team.base.y === source.base.y
        && team.slots.every((slot, index) => slot.health === (source.fixedSlots[index]?.health ?? 0) && slot.level === 0),
      "Construction source/fixed City seed mismatch");
      return createNativeConstructionHost(source);
    });
  }
  for (const team of teams) refresh(state, team);
  return freeze(state);
}

export function productionSnapshot(state: CampaignProductionState): CampaignProductionState {
  requireProduction(state.kind === "campaign-production-v1", "Invalid production snapshot");
  return freeze(structuredClone(state));
}

export function synchronizeBrowserProductionColony(previous: CampaignProductionState, world: CampaignWorld,
  runtimeProfile: "strict-native" | "browser-adapted"): { production: CampaignProductionState; world: CampaignWorld } {
  requireProduction(runtimeProfile === "browser-adapted" && world.browserCasualtyPickup?.runtimeProfile === "browser-adapted"
    && previous.sessionId === world.sessionId && !previous.constructionHosts?.length,
  "Browser production destruction requires explicit adapted ownership");
  const host = transportHostState(world);
  requireProduction(!host.nativeCombat && !host.nativeAiTasks && !host.resourceLifecycle,
    "Browser production destruction cannot mutate native owners");
  const state = { ...previous, teams: structuredClone(previous.teams) } as ProductionData;
  const released = new Set<string>();
  for (const team of state.teams) {
    for (let slot = 0; slot < team.slots.length; slot += 1) {
      const entity = world.entities.find(candidate => candidate.rawSlot === team.team * 15 + slot);
      const health = entity?.health ?? 0;
      requireProduction(integer(health) && health <= team.slots[slot].health,
        "Browser colony synchronization cannot construct or heal a building");
      if (entity) requireProduction(entity.team === team.team && entity.generation === host.generations[entity.rawSlot!],
        "Browser colony synchronization requires the current fixed-slot generation");
      if (health !== team.slots[slot].health) {
        requireProduction(entity && world.entityBytes && new DataView(world.entityBytes.buffer,
          world.entityBytes.byteOffset, world.entityBytes.byteLength).getUint32(entity.rawSlot! * 220 + 12, true) === health,
        "Browser colony synchronization requires host-published health");
        if (health === 0) requireProduction(world.entityBytes[entity.rawSlot! * 220 + 0x2c] === 10
          && host.requests.some(request => request.type === "combat-death" && request.slot === entity.rawSlot
            && request.generation === entity.generation && request.loss.victimTeam === entity.team
            && request.loss.victimType === entity.unitType),
        "Browser colony destruction requires a current host combat-death receipt");
      }
      team.slots[slot].health = health;
      if (health === 0) team.slots[slot].busy = 0;
    }
    refresh(state, team);
    for (const entry of state.catalog) {
      if (team.eligibility[entry.id] === 1) continue;
      const pending = team.pending[entry.id] ?? 0;
      if (pending > 0) {
        changeCredits(team, entry.cost * pending);
        team.pending[entry.id] = 0;
      }
    }
    for (const [queueIndex, queue] of team.queues.entries()) {
      const cancelled = queue.items.filter(item => team.eligibility[item.dependency] !== 1
        || (queueIndex === 0 && team.slots[1].health === 0)
        || (adaptedProfile(state, item.unitType) && team.slots[productionProducerSlot(queueIndex as QueueIndex)].health === 0));
      if (!cancelled.length) continue;
      if (cancelled.some(item => item.ticket === queue.activeTicket)) {
        const reservation = productionExitReservation(previous, team.team, queueIndex as QueueIndex);
        const owned = host.productionExits?.find(exit => exit.key === reservation.key);
        requireProduction(owned && JSON.stringify(owned) === JSON.stringify(reservation),
          "Cancelled production requires its exact owned exit reservation");
        const plane = host.definitions.find(definition => definition.unitType === owned.unitType)!.plane;
        const index = owned.tile.y * host.width + owned.tile.x;
        requireProduction(host[plane][index] === 1022
          || transportProductionExitBlocked({ ...world, transportState: host }, reservation), "Cancelled production exit is not reserved");
        if (host[plane][index] === 1022) host[plane][index] = -1;
        released.add(owned.key);
        queue.activeTicket = null;
        queue.allocation = null;
        queue.ready = 1;
        delete queue.animation;
        delete queue.adaptedElapsedVisits;
      }
      const tickets = new Set(cancelled.map(item => item.ticket));
      queue.items = queue.items.filter(item => !tickets.has(item.ticket));
    }
  }
  if (released.size) host.productionExits = host.productionExits!.filter(exit => !released.has(exit.key));
  return { production: freeze(state), world: { ...world, transportState: host } };
}

function changeCredits(team: TeamState, credits: number, accounting = 0): void {
  requireProduction((credits >= 0 || team.credits >= -credits) && integer(team.costAccumulator + accounting), "Production credit overflow/underflow");
  team.credits = (team.credits + credits) | 0;
  team.costAccumulator += accounting;
}

function unitSource(state: CampaignProductionState, unitType: number): ProductionUnitSource {
  const source = state.units.find((entry) => entry.unitType === unitType);
  requireProduction(source, "Missing source unit selectors");
  return source;
}

function supportedBuilding(entry: LegacyProductionEntry, race: number): boolean {
  return (entry.id === 2 || entry.id === 16) && entry.rawFields[3] === race
    && entry.rawFields[1] === 3 && entry.rawFields[2] === 0 && entry.cost === 2000;
}

export function productionChoices(state: CampaignProductionState, teamId: number): readonly {
  readonly dependency: number;
  readonly interfaceId: number;
  readonly kind: LegacyProductionEntry["kind"];
  readonly nativeState: DependencyState;
  readonly supported: boolean;
  readonly pending: number;
  readonly queued: number;
  readonly maxAdditional: number;
  readonly canDispatch: boolean;
  readonly canReleasePending: boolean;
}[] {
  const team = state.teams.find((candidate) => candidate.team === teamId);
  requireProduction(team, "Unknown production team");
  return freeze(state.catalog.map((entry) => {
    const supported = state.sourceProfiles ? adaptedUpgradeForRace(state, entry, team.race) || entry.kind === "unit" && (state.sourceProfiles.some((profile) => profile.unitType === entry.unitType)
      || !!state.adaptedCollectorProfiles?.some(profile => profile.unitType === entry.unitType && profile.unitType === 6 + team.race * 8)
      || adaptedUnitForRace(state, entry.unitType, team.race))
      : entry.kind !== "building" || supportedBuilding(entry, team.race);
    const eligible = supported && team.eligibility[entry.id] === 1;
    const pending = team.pending[entry.id] ?? 0;
    const queueIndex = entry.kind === "unit" ? state.units.find((unit) => unit.unitType === entry.unitType)!.queue : null;
    const queue = queueIndex === null ? null : team.queues[queueIndex];
    const queued = queue?.items.filter((item) => item.dependency === entry.id).length ?? 0;
    const reserved = queue === null ? 0 : state.catalog.filter((candidate) => candidate.kind === "unit"
      && state.units.find((unit) => unit.unitType === candidate.unitType)!.queue === queueIndex)
      .reduce((sum, candidate) => sum + (team.pending[candidate.id] ?? 0), 0);
    const capacity = queue === null ? 1 - pending : Math.min(50 - pending, state.queueSafetyLimit - queue.items.length - reserved);
    const affordable = entry.cost === 0 ? capacity : Math.floor(team.credits / entry.cost);
    return { dependency: entry.id, interfaceId: entry.interfaceId, kind: entry.kind, nativeState: team.eligibility[entry.id],
      supported, pending, queued, maxAdditional: eligible ? Math.max(0, Math.min(capacity, affordable)) : 0,
      canDispatch: eligible && pending > 0, canReleasePending: eligible && pending > 0 };
  }));
}

function actionable(state: ProductionData, team: TeamState, dependency: number): LegacyProductionEntry {
  const entry = state.catalog.find((candidate) => candidate.id === dependency);
  requireProduction(entry && team.eligibility[dependency] === 1, "Dependency is not eligible");
  if (state.sourceProfiles && !(entry.kind === "building" && state.constructionHosts?.some(host => host.configuration.team === team.team))) {
    const profile = state.sourceProfiles.find((candidate) => candidate.unitType === entry.unitType);
    const adapted = state.adaptedCollectorProfiles?.find(candidate => candidate.unitType === entry.unitType
      && candidate.unitType === 6 + team.race * 8) || adaptedUnitForRace(state, entry.unitType, team.race);
    requireProduction(adaptedUpgradeForRace(state, entry, team.race) || entry.kind === "unit" && (profile || adapted),
      "No validated native source production profile for this action");
    if (profile) validateSourceProfile(profile);
  }
  if (entry.kind === "building") requireProduction(supportedBuilding(entry, team.race),
  "Only the source-proven first science construction is enabled");
  return entry;
}

export function reduceCampaignProduction(previous: CampaignProductionState, event: ProductionEvent): CampaignProductionState {
  requireProduction(previous.kind === "campaign-production-v1" && event.id.length > 0, "Invalid production event");
  const prior = previous.journal.find((entry) => entry.id === event.id);
  if (prior) {
    requireProduction(JSON.stringify(prior) === JSON.stringify(event), "Production event ID reused with different payload");
    return productionSnapshot(previous);
  }
  const state = structuredClone(previous) as ProductionData;
  const team = state.teams.find((candidate) => candidate.team === event.team);
  requireProduction(team, "Unknown production team");
  const action = event.action;
  if (action.type === "sync-credits") {
    requireProduction(signed32(action.expectedPreviousCredits) && signed32(action.credits)
      && team.credits === action.expectedPreviousCredits, "Stale or invalid full32 credit synchronization");
    team.credits = action.credits;
  } else if (action.type === "receive-prepaid-unit" || action.type === "receive-prepaid-city") {
    requireProduction(action.provenance?.code === "campaign-ai" && action.provenance.receiptKey === event.id
      && action.provenance.sourceSha256 === "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b",
    "Prepaid receipt requires exact campaign-ai source provenance and receipt key");
    const entry = actionable(state, team, action.dependency);
    requireProduction(signed32(action.expectedCredits) && team.credits === action.expectedCredits,
      "Prepaid AI receipt requires already-debited credits");
    const debit = state.journal.find((candidate) => candidate.id === `${event.id}:credits`);
    requireProduction(debit?.team === event.team && debit.action.type === "sync-credits"
      && debit.action.credits === action.expectedCredits && debit.action.expectedPreviousCredits >= entry.cost
      && ((debit.action.expectedPreviousCredits - entry.cost) | 0) === action.expectedCredits,
    "Prepaid AI receipt requires its exact committed credit debit");
    if (action.type === "receive-prepaid-city") {
      const hostIndex = state.constructionHosts?.findIndex(host => host.configuration.team === team.team) ?? -1;
      requireProduction(entry.kind === "building" && supportedBuilding(entry, team.race) && action.slot === 3 && action.level === 0
        && hostIndex >= 0 && !team.construction && team.slots[3].health === 0 && team.slots[3].busy === 0 && team.latch === 0
        && (team.pending[entry.id] ?? 0) === 0, "No source construction owner or occupied native City slot");
      state.constructionHosts![hostIndex] = receiveNativeConstruction(state.constructionHosts![hostIndex], event.id);
      const unitType = team.race === 0 ? 20 : 32, nativeId = team.team * 15 + 3;
      team.slots[3] = { health: 2400, level: 0, busy: 1 };
      team.construction = { id: event.id, nativeId, unitType, phase: 0 };
      changeCredits(team, 0, entry.cost);
      state.requests.push({ type: "initialize-science", id: event.id, team: team.team, nativeId, unitType, slot: 3, level: 0 });
    } else {
    const source = unitSource(state, action.unitType);
    requireProduction(state.sourceProfiles && entry.kind === "unit" && entry.unitType === action.unitType
      && action.unitType === team.race * 8 && action.count === 1 && source.queue === 0,
    "Prepaid AI receipt requires matching base troop and source profile");
    const queue = team.queues[0];
    const reserved = state.catalog.filter((candidate) => candidate.kind === "unit"
      && unitSource(state, candidate.unitType!).queue === 0)
      .reduce((total, candidate) => total + (team.pending[candidate.id] ?? 0), 0);
    requireProduction(queue.items.length + reserved < state.queueSafetyLimit, "Adapter FIFO safety limit reached");
    changeCredits(team, 0, entry.cost);
    queue.items.push({ ticket: `${event.id}:0`, dependency: entry.id, unitType: action.unitType, cost: entry.cost });
    }
  } else if (action.type === "native-construction-visit") {
    const hostIndex = state.constructionHosts?.findIndex(host => host.configuration.team === team.team) ?? -1;
    requireProduction(hostIndex >= 0 && team.construction, "No active source construction owner");
    const host = visitNativeConstruction(state.constructionHosts![hostIndex], action.visit);
    state.constructionHosts![hostIndex] = host;
    team.slots[3].busy = host.busy;
    team.latch = host.latch;
    if (host.ready) team.construction = null;
    else team.construction.phase = host.actors[3]!.phase as Construction["phase"];
  } else if (action.type === "reserve" || action.type === "release-pending" || action.type === "dispatch") {
    const entry = actionable(state, team, action.dependency);
    requireProduction(entry.kind !== "building" || !state.constructionHosts?.some(host => host.configuration.team === team.team),
      "Source construction accepts only exact prepaid native CITY receipts");
    const pending = team.pending[entry.id] ?? 0;
    if (action.type === "reserve") {
      requireProduction(pending < (entry.kind === "unit" ? 50 : 1), "Native pending limit reached");
      if (entry.kind === "unit") {
        const queue = unitSource(state, entry.unitType!).queue;
        const reserved = state.catalog.filter((candidate) => candidate.kind === "unit"
          && unitSource(state, candidate.unitType!).queue === queue).reduce((sum, candidate) => sum + (team.pending[candidate.id] ?? 0), 0);
        requireProduction(team.queues[queue].items.length + reserved < state.queueSafetyLimit, "Adapter FIFO safety limit reached");
      }
      changeCredits(team, -entry.cost);
      team.pending[entry.id] = pending + 1;
    } else if (action.type === "release-pending") {
      requireProduction(pending > 0, "No pending reservation; active cancellation is unsupported");
      changeCredits(team, entry.cost);
      team.pending[entry.id] = pending - 1;
    } else {
      requireProduction(pending > 0, "No reserved production to dispatch");
      if (entry.kind === "unit") {
        const queue = team.queues[unitSource(state, entry.unitType!).queue];
        requireProduction(queue.items.length + pending <= state.queueSafetyLimit, "Adapter FIFO safety limit reached");
        for (let index = 0; index < pending; index += 1) queue.items.push({ ticket: `${event.id}:${index}`, dependency: entry.id, unitType: entry.unitType!, cost: entry.cost });
      } else if (entry.kind === "building") {
        requireProduction(!team.construction && team.slots[3].health === 0, "Science construction already exists");
        requireProduction(entry.cost === 2000, "Unverified science receiver cost");
        const unitType = team.race === 0 ? 20 : 32;
        const nativeId = team.team * 15 + 3;
        team.slots[3] = { health: 2400, level: 0, busy: 1 };
        team.construction = { id: event.id, nativeId, unitType, phase: 0 };
        state.requests.push({ type: "initialize-science", id: event.id, team: team.team, nativeId, unitType, slot: 3, level: 0 });
      } else if (entry.kind === "upgrade") {
        const [, unitType, selector, level] = entry.rawFields;
        let upgrade = team.upgrades.find((candidate) => candidate.unitType === unitType);
        if (!upgrade) { upgrade = { unitType, weapon: 0, armor: 0 }; team.upgrades.push(upgrade); }
        upgrade[selector === 0 ? "weapon" : "armor"] = level;
        state.requests.push({ type: "upgrade-applied", id: event.id, team: team.team, unitType, selector: selector as Bit, level });
      }
      changeCredits(team, 0, entry.cost * pending);
      team.pending[entry.id] = 0;
    }
  } else if (action.type === "construction") {
    requireProduction(!state.constructionHosts?.some(host => host.configuration.team === team.team),
      "Source construction cannot accept caller-fabricated lifecycle callbacks");
    const construction = team.construction;
    requireProduction(construction && construction.id === action.constructionId && construction.nativeId === action.nativeId, "Stale construction callback");
    const phases = ["arrival-created", "build-started", "build-finished", "departure-finished", "released"];
    requireProduction(phases[construction.phase] === action.transition, "Out-of-order native construction transition");
    if (action.transition === "arrival-created") {
      requireProduction(team.latch === 0, "Native construction latch is held");
      team.latch = 1;
    }
    if (action.transition === "build-finished") team.slots[3].busy = 0;
    if (action.transition === "released") { team.latch = 0; team.construction = null; }
    else construction.phase = (construction.phase + 1) as Construction["phase"];
  } else if (action.type === "producer-idle") {
    requireProduction(integer(action.queue, 3) && team.queues[action.queue].items.length === 0, "Producer is not idle");
    team.queues[action.queue].delay = Math.max(0, team.queues[action.queue].delay - 1);
  } else {
    requireProduction(integer(action.queue, 3), "Invalid unit queue");
    const queue = team.queues[action.queue];
    const head = queue.items[0];
    requireProduction(head, "Empty producer FIFO");
    if (action.type === "allocated") {
      requireProduction(queue.allocation?.id === action.requestId && queue.allocation.ticket === head.ticket, "Stale allocation receipt");
      requireProduction(integer(action.nativeSlot, 798) && action.nativeSlot >= 152 && integer(action.generation), "Invalid native allocation identity");
      queue.items.shift();
      queue.activeTicket = null;
      queue.allocation = null;
      queue.ready = 1;
      delete queue.adaptedElapsedVisits;
      state.requests.push({ type: "unit-allocated", id: event.id, team: team.team, nativeSlot: action.nativeSlot, generation: action.generation });
    } else {
      requireProduction(head.ticket === action.ticket && !queue.allocation, "Stale producer callback");
      if (action.type === "producer-wait") {
        requireProduction(integer(action.delayAfter, 255) && action.delayAfter === Math.max(0, queue.delay - 1), "Invalid native delay decrement");
        queue.delay = action.delayAfter;
      } else if (action.type === "producer-started" || action.type === "producer-cap-refund") {
        requireProduction(queue.ready === 1 && queue.delay === 0 && queue.activeTicket === null, "Producer is not ready");
        if (action.type === "producer-cap-refund") {
          changeCredits(team, head.cost, -head.cost);
          queue.items.shift();
          state.requests.push({ type: "population-message", id: event.id, team: team.team, message: 119 });
        } else {
          queue.ready = 0; queue.activeTicket = head.ticket;
          const profile = state.sourceProfiles?.find((candidate) => candidate.unitType === head.unitType);
          if (profile) queue.animation = resetLegacyResourceAnimation(queue.animation ?? { profile: "", frame: 0, delay: 0, mode: 0 }, profile.id, 1);
          if (adaptedProfile(state, head.unitType)) {
            queue.adaptedElapsedVisits = 0;
            delete queue.animation;
          }
        }
      } else if (action.type === "producer-completed" || action.type === "producer-advance") {
        requireProduction(queue.ready === 0 && queue.activeTicket === head.ticket, "No matching completed native animation");
        const adapted = adaptedProfile(state, head.unitType);
        if (action.type === "producer-advance") {
          const profile = state.sourceProfiles?.find((candidate) => candidate.unitType === head.unitType);
          if (adapted) {
            requireProduction(action.queue === unitSource(state, head.unitType).queue && queue.adaptedElapsedVisits !== undefined
              && integer(queue.adaptedElapsedVisits, adapted.completionVisits - 1), "Invalid adapted production progress");
            queue.adaptedElapsedVisits += 1;
          } else {
            requireProduction(profile && queue.animation, "Missing validated native producer clock");
            validateSourceProfile(profile);
            queue.animation = advanceLegacyResourceAnimation(queue.animation, profile, 0);
          }
        } else requireProduction(!state.sourceProfiles && action.animationMode === 2, "Source clock cannot accept caller-fabricated completion");
        if (action.type === "producer-completed" || (!adapted && queue.animation?.mode === 2)
          || (adapted && queue.adaptedElapsedVisits === adapted.completionVisits)) {
        const source = unitSource(state, head.unitType);
        const allocation: Allocation = { id: event.id, ticket: head.ticket, unitType: head.unitType,
          tileX: team.base.x + source.exitOffset.x, tileY: team.base.y + source.exitOffset.y };
        queue.allocation = allocation;
        state.requests.push({ type: "allocate-unit", ...allocation, team: team.team, queue: action.queue });
        }
      } else throw new Error("Unsupported production action");
    }
  }
  refresh(state, team);
  state.journal.push(structuredClone(event));
  return freeze(state);
}

export function restoreCampaignCityProduction(value: CampaignProductionState,
  initial: CampaignProductionState): CampaignProductionState {
  requireProduction(initial.constructionHosts?.length && initial.journal.length === 0 && initial.requests.length === 0,
    "CITY restore requires externally authenticated initial production/source configuration");
  let replay = productionSnapshot(initial);
  for (const event of value.journal) replay = reduceCampaignProduction(replay, event);
  requireProduction(JSON.stringify(replay) === JSON.stringify(value), "CITY production checkpoint source/event replay mismatch");
  return replay;
}

function productionExitReservation(state: CampaignProductionState, teamId: number, queueIndex: QueueIndex): ProductionExitReservation {
  const team = state.teams.find((candidate) => candidate.team === teamId);
  const queue = team?.queues[queueIndex];
  const head = queue?.items[0];
  requireProduction(team && queue && head && queue.ready === 0 && queue.activeTicket === head.ticket, "No active production head");
  const source = state.units.find((entry) => entry.unitType === head.unitType);
  requireProduction(source?.queue === queueIndex, "Production source queue mismatch");
  return { key: JSON.stringify([state.sessionId, teamId, queueIndex, head.ticket]), team: teamId, queue: queueIndex,
    ticket: head.ticket, unitType: head.unitType, tile: { x: team.base.x + source.exitOffset.x, y: team.base.y + source.exitOffset.y } };
}

export function reserveCampaignProductionExit(state: CampaignProductionState, world: CampaignWorld,
  teamId: number, queueIndex: QueueIndex): CampaignWorld {
  requireProduction(state.sessionId === world.sessionId, "Production/transport session mismatch");
  if (state.adaptedUnitProfiles?.length || (queueIndex === 2 && state.adaptedCollectorProfiles?.length)) requireAdaptedCollectorWorld(world);
  const result = reserveTransportProductionExit(world, productionExitReservation(state, teamId, queueIndex));
  requireProduction(result.ok, result.ok ? "" : result.diagnostics.map((diagnostic) => diagnostic.message).join("; "));
  return result.value;
}

export function allocateCampaignProductionUnit(state: CampaignProductionState, world: CampaignWorld,
  teamId: number, queueIndex: QueueIndex): { readonly production: CampaignProductionState; readonly world: CampaignWorld } {
  requireProduction(state.sessionId === world.sessionId, "Production/transport session mismatch");
  if (state.adaptedUnitProfiles?.length || (queueIndex === 2 && state.adaptedCollectorProfiles?.length)) requireAdaptedCollectorWorld(world);
  const team = state.teams.find((candidate) => candidate.team === teamId);
  const allocation = team?.queues[queueIndex]?.allocation;
  requireProduction(allocation, "No native completion awaiting allocation");
  const reservation = productionExitReservation(state, teamId, queueIndex);
  requireProduction(allocation.ticket === reservation.ticket && allocation.unitType === reservation.unitType
    && allocation.tileX === reservation.tile.x && allocation.tileY === reservation.tile.y, "Production allocation/source mismatch");
  const host = transportHostState(world);
  requireProduction(!host.fifos.some((fifo) => fifo.tile.x === allocation.tileX && fifo.tile.y === allocation.tileY),
    "Production must not enter a coordinate reinforcement FIFO");
  if (transportProductionExitBlocked(world, reservation)) return { production: state, world };
  const id = `production:${state.sessionId}:${allocation.id}`;
  const result = allocateTransportProductionExit(world, reservation);
  requireProduction(result.ok, result.ok ? "" : result.diagnostics.map((diagnostic) => diagnostic.message).join("; "));
  const after = transportHostState(result.value);
  const created = after.requests.slice(host.requests.length).filter((request) => request.type === "create");
  requireProduction(created.length === 1, "Expected one actual native-slot allocation");
  const receipt = created[0];
  requireProduction(receipt.type === "create" && receipt.team === teamId && receipt.unitType === allocation.unitType, "Wrong allocation result");
  const production = reduceCampaignProduction(state, { id: `${id}:allocated`, team: teamId,
    action: { type: "allocated", queue: queueIndex, requestId: allocation.id, nativeSlot: receipt.slot, generation: receipt.generation } });
  return { production, world: result.value };
}

function requireAdaptedCollectorWorld(world: CampaignWorld): void {
  const host = readTransportHostState(world);
  requireProduction(world.browserCasualtyPickup?.runtimeProfile === "browser-adapted"
    && !host.nativeCombat && !host.nativeAiTasks && !host.resourceLifecycle,
  "Adapted production requires browser-adapted world without native owners");
}

export function stepCampaignProductionProducer(previous: CampaignProductionState, previousWorld: CampaignWorld,
  visit: ProductionProducerVisit, id: string, runtimeProfile: "strict-native" | "browser-adapted" = "strict-native"
): { readonly production: CampaignProductionState; readonly world: CampaignWorld } {
  requireProduction(previous.sourceProfiles && (visit.queue === 0 || (visit.queue === 2 && previous.adaptedCollectorProfiles?.length)
    || previous.adaptedUnitProfiles?.some(profile => previous.units.some(unit => unit.unitType === profile.unitType && unit.queue === visit.queue)))
    && integer(visit.population) && integer(visit.populationLimit),
    "Producer visit requires validated source profiles and actual native census/cap");
  if (previous.adaptedCollectorProfiles?.length || previous.adaptedUnitProfiles?.length) {
    requireProduction(runtimeProfile === "browser-adapted", "Adapted production cannot run in strict-native production");
    requireAdaptedCollectorWorld(previousWorld);
  }
  let production = previous;
  let world = previousWorld;
  const team = production.teams.find((candidate) => candidate.team === visit.team);
  requireProduction(team, "Unknown producer team");
  const queue = team.queues[visit.queue];
  const head = queue.items[0];
  const producerSlot = productionProducerSlot(visit.queue);
  if (visit.queue !== 0) requireProduction((visit.queue === 2
    && previous.adaptedCollectorProfiles?.some(profile => profile.unitType === 6 + team.race * 8))
    || previous.adaptedUnitProfiles?.some(profile => adaptedUnitForRace(previous, profile.unitType, team.race)
      && unitSource(previous, profile.unitType).queue === visit.queue),
  "Missing adapted production profile for producer race");
  const producer = world.entities.find((entity) => entity.rawSlot === visit.team * 15 + producerSlot);
  if (runtimeProfile === "browser-adapted" && world.browserCasualtyPickup?.runtimeProfile === "browser-adapted"
    && team.slots[producerSlot].health === 0 && producer?.health === 0) {
    requireProduction(!queue.items.length && !queue.activeTicket && !queue.allocation,
      "Destroyed adapted producer retains uncancelled work");
    return { production, world };
  }
  const producerType = (team.race === 0 ? 16 : 28)
    + (producerSlot === 2 ? 2 + team.slots[2].level : producerSlot === 4 ? 6 : producerSlot);
  requireProduction(producer && producer.health > 0 && producer.team === visit.team
    && producer.unitType === producerType
    && team.slots[producerSlot].busy === 0, "Native producer unavailable; destruction/construction handoff is unsupported");
  if (!head) {
    return { production: reduceCampaignProduction(production, { id: `${id}:idle`, team: visit.team,
      action: { type: "producer-idle", queue: visit.queue } }), world };
  }
  if (queue.allocation) return allocateCampaignProductionUnit(production, world, visit.team, visit.queue);
  const emit = (action: ProductionAction, suffix: string) => {
    production = reduceCampaignProduction(production, { id: `${id}:${suffix}`, team: visit.team, action });
  };
  emit({ type: "producer-wait", queue: visit.queue, ticket: head.ticket, delayAfter: Math.max(0, queue.delay - 1) }, "delay");
  if (queue.ready === 0) {
    if (!queue.allocation) emit({ type: "producer-advance", queue: visit.queue, ticket: head.ticket }, "animation");
    if (production.teams.find((candidate) => candidate.team === visit.team)!.queues[visit.queue].allocation) {
      return allocateCampaignProductionUnit(production, world, visit.team, visit.queue);
    }
    return { production, world };
  }
  const source = production.units.find((unit) => unit.unitType === head.unitType)!;
  const host = transportHostState(world);
  const tileX = team.base.x + source.exitOffset.x;
  const tileY = team.base.y + source.exitOffset.y;
  requireProduction(tileX >= 0 && tileY >= 0 && tileX < host.width && tileY < host.height, "Production exit outside map");
  const index = tileY * host.width + tileX;
  const adaptedSource = previous.adaptedUnitProfiles?.some(profile => profile.unitType === head.unitType)
    ? ADAPTED_UNIT_PRODUCTION_SOURCES.find(profile => profile.unitType === head.unitType) : undefined;
  if (adaptedSource) requireProduction(host.definitions.find(definition => definition.unitType === head.unitType)?.plane === adaptedSource.plane,
    "Adapted production source movement plane mismatch");
  const plane = adaptedSource?.plane ?? "ground";
  requireProduction(plane === "flying" || host.groundEligible[index], "Ineligible native production exit");
  const occupant = host[plane][index];
  if (occupant !== -1) {
    if (occupant >= 0 && occupant < 800) {
      const bytes = new Uint8Array(world.entityBytes!);
      bytes[occupant * 220 + 0x35] = 0;
      world = { ...world, entityBytes: bytes };
    }
    return { production, world };
  }
  if (queue.delay > 1) return { production, world };
  if (visit.population >= visit.populationLimit) {
    emit({ type: "producer-cap-refund", queue: visit.queue, ticket: head.ticket }, "cap");
  } else {
    emit({ type: "producer-started", queue: visit.queue, ticket: head.ticket }, "start");
    world = reserveCampaignProductionExit(production, world, visit.team, visit.queue);
  }
  return { production, world };
}
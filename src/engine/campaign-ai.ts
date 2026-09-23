import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { consumeLegacyAiDemand, consumeLegacyAiPolicyPipeline, type LegacyAiDemandInputs,
  type LegacyAiOrderState, type LegacyAiProductionIntent } from "./legacy-ai";
import { productionSnapshot, reduceCampaignProduction, restoreCampaignCityProduction, type CampaignProductionState } from "./campaign-production";
import { restoreNativeConstructionHost, type NativeConstructionVisit } from "./native-construction-host";
import type { CampaignWorld } from "./campaign-world";
import { receiveTransportHostAiPolicy, transportHostState, projectTransportConstruction, validateTransportConstruction } from "./transport-host";
import { computeLegacyAiFullPolicy, decodeLegacyAiActorPacket, type LegacyAiFullPolicyInputs } from "./legacy-ai-policy";

export const CAMPAIGN_AI_SOURCE_SHA256 = "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b";

export interface CampaignAiCommand {
  readonly id: string;
  readonly sequence: number;
  readonly stage: "demand" | "pipeline" | "full-policy";
}

export interface CampaignAiFullPolicyConfiguration {
  readonly neighbors: readonly number[];
  readonly rngTable: readonly number[];
  readonly ruleTable: readonly number[];
  readonly policyAddress: number;
  readonly actorTransport: "deferred" | "synchronous";
}

type NativeJson<Value> = Value extends Uint8Array ? number[] : Value extends readonly (infer Item)[] ? NativeJson<Item>[]
  : Value extends object ? { [Key in keyof Value]: NativeJson<Value[Key]> } : Value;
export type CampaignAiFullPolicyComputation = NativeJson<ReturnType<typeof computeLegacyAiFullPolicy>>;

function fullPolicyProjection(result: ReturnType<typeof computeLegacyAiFullPolicy>): CampaignAiFullPolicyComputation {
  return JSON.parse(JSON.stringify(result, (_key, value) => value instanceof Uint8Array ? [...value] : value));
}

function hasActorTargets(result: ReturnType<typeof computeLegacyAiFullPolicy>): boolean {
  return result.packets.some(packet => packet.kind === "actor-order"
    && packet.orders.some(order => order.mode === 5 || order.slots.length > 0));
}

export interface CampaignAiReceipt {
  readonly integrity?: string;
  readonly code: "campaign-ai";
  readonly sourceSha256: string;
  readonly command: CampaignAiCommand;
  readonly team: number;
  readonly selectedRule: number;
  readonly fullPolicy?: { readonly computation: CampaignAiFullPolicyComputation;
    readonly disposition: "receipted" | "pending-native-task-hand-off" };
  readonly intents: readonly { readonly id: string; readonly dependency: number; readonly packet: readonly number[];
    readonly creditsBefore: number; readonly creditsAfter: number; readonly receipt: "applied"; readonly ticket: string }[];
}

function receiptIntegrity(receipt: CampaignAiReceipt): string {
  const ancestors = new Set<object>();
  const quote = (value: string) => JSON.stringify(value).replace(/[\u007f-\uffff]/g,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
  const serialize = (value: unknown, root = false): string => {
    if (value === null) return "null";
    if (typeof value === "string") return quote(value);
    if (typeof value === "boolean") return String(value);
    if (typeof value === "number") {
      requireAi(Number.isFinite(value), "AI receipt requires finite JSON numbers");
      return JSON.stringify(value);
    }
    requireAi(typeof value === "object" && value !== null, "AI receipt requires plain JSON data");
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    requireAi(array ? prototype === Array.prototype : prototype === Object.prototype || prototype === null,
      "AI receipt requires plain JSON objects/arrays");
    requireAi(!ancestors.has(value), "Cyclic AI receipt");
    ancestors.add(value);
    const keys = Reflect.ownKeys(value);
    const entry = (key: PropertyKey): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      requireAi(typeof key === "string" && descriptor && "value" in descriptor && descriptor.enumerable,
        "AI receipt requires enumerable data properties without accessors/symbols");
      return descriptor.value;
    };
    let result: string;
    if (array) {
      const length = Object.getOwnPropertyDescriptor(value, "length")!.value as number;
      requireAi(keys.length === length + 1, "Sparse or extended AI receipt array");
      const items: string[] = [];
      for (let index = 0; index < length; index++) items.push(serialize(entry(String(index))));
      result = `[${items.join(",")}]`;
    } else {
      const items: string[] = [];
      for (const key of keys.sort()) {
        const child = entry(key);
        if (root && key === "integrity") {
          requireAi(typeof child === "string", "Invalid AI receipt integrity");
          continue;
        }
        items.push(`${quote(key as string)}:${serialize(child)}`);
      }
      result = `{${items.join(",")}}`;
    }
    ancestors.delete(value);
    return result;
  };
  const canonical = serialize(receipt, true);
  structuredClone(receipt);
  return bytesToHex(sha256(new TextEncoder().encode(canonical)));
}

function verifyReceiptIntegrity(receipt: CampaignAiReceipt, allowLegacy = false): string {
  const expected = receiptIntegrity(receipt);
  requireAi(allowLegacy && !Object.hasOwn(receipt, "integrity") || receipt.integrity === expected,
    "AI receipt integrity mismatch or missing; legacy receipts require source checkpoint recomputation");
  return expected;
}

export interface CampaignAiTransactionState {
  readonly scope: "source-separated-bounded";
  readonly ai: LegacyAiOrderState & { readonly rngCursor?: number };
  readonly fullPolicy?: CampaignAiFullPolicyConfiguration;
  readonly inputs: LegacyAiDemandInputs;
  readonly production: CampaignProductionState;
  readonly world: CampaignWorld;
  readonly receipts: readonly CampaignAiReceipt[];
}

export type CampaignAiTransactionResult =
  | { readonly ok: true; readonly disposition: "applied" | "duplicate"; readonly state: CampaignAiTransactionState;
      readonly readyWholeCall: boolean; readonly remainingGroups: readonly number[] }
  | { readonly ok: false; readonly code: "invalid-owner" | "unsupported-city" | "unsupported-unit";
      readonly message: string; readonly intent?: LegacyAiProductionIntent };

export interface CampaignAiObservation {
  readonly entities: readonly number[];
  readonly forceOrder: number;
  readonly population: number;
  readonly populationLimit: number;
  readonly relations: readonly number[];
  readonly visibilityMasks: readonly number[];
  readonly occupancy: readonly number[];
}

export interface CampaignAiConfiguration {
  readonly scope: "source-separated-bounded";
  readonly sourceId: string;
  readonly sourceSha256: string;
  readonly team: number;
  readonly sources: {
    readonly types: readonly number[];
    readonly weapons: readonly number[];
    readonly dependencies: readonly number[];
    readonly cityDependencies: readonly number[];
    readonly matrix: readonly (readonly number[])[];
    readonly navigation: { readonly width: number; readonly height: number;
      readonly families: readonly number[]; readonly nextFamily: readonly number[] };
  };
  readonly fullPolicy?: CampaignAiFullPolicyConfiguration;
  readonly initial: CampaignAiObservation & { readonly policy: readonly number[]; readonly teamBytes: readonly number[];
    readonly rngCursor?: number };
}

export interface CampaignAiSessionRequest extends CampaignAiCommand {
  readonly sourceId: string;
  readonly observation: CampaignAiObservation;
}

export interface CampaignAiSessionState {
  readonly sourceId: string;
  readonly buffers: CampaignAiConfiguration["initial"];
  readonly history: readonly { readonly request: CampaignAiSessionRequest; readonly teamBytesBefore: readonly number[];
    readonly receipt: CampaignAiReceipt }[];
}

function sessionInputs(config: CampaignAiConfiguration, buffers: CampaignAiConfiguration["initial"]) {
  const ai = { policy: Uint8Array.from(buffers.policy), entities: Uint8Array.from(buffers.entities),
    ...(buffers.rngCursor === undefined ? {} : { rngCursor: buffers.rngCursor }),
    forceOrder: buffers.forceOrder, navigation: { ...config.sources.navigation,
      families: Uint8Array.from(config.sources.navigation.families), nextFamily: Uint8Array.from(config.sources.navigation.nextFamily) } };
  const inputs: LegacyAiDemandInputs = { ...config.sources, ...buffers, team: config.team,
    teamBytes: Uint8Array.from(buffers.teamBytes), types: Uint8Array.from(config.sources.types),
    weapons: Uint8Array.from(config.sources.weapons), dependencies: Uint8Array.from(config.sources.dependencies),
    relations: Uint8Array.from(buffers.relations) };
  return { ai, inputs };
}

export function initializeCampaignAi(config: CampaignAiConfiguration, production: CampaignProductionState,
  world: CampaignWorld): CampaignAiSessionState {
  requireAi(config.scope === "source-separated-bounded" && config.sourceId.length > 0
    && config.sourceSha256 === CAMPAIGN_AI_SOURCE_SHA256, "Invalid bounded campaign-ai source identity");
  const state = sessionInputs(config, config.initial);
  validateOwner({ ...state, scope: config.scope, production, world, receipts: [] });
  if (config.fullPolicy) {
    validateSharedPool(state.ai.entities, world);
    fullPolicyInputs(state.ai, state.inputs, config.fullPolicy);
  }
  return synchronizeCampaignAi(structuredClone({ sourceId: config.sourceId, buffers: config.initial, history: [] }), config, production);
}

export function synchronizeCampaignAi(state: CampaignAiSessionState, config: CampaignAiConfiguration,
  production: CampaignProductionState, world?: CampaignWorld): CampaignAiSessionState {
  const team = production.teams.find((entry) => entry.team === config.team);
  requireAi(team, "Missing campaign-ai production team");
  const teamBytes = Uint8Array.from(state.buffers.teamBytes), bytes = view(teamBytes);
  bytes.setInt32(0x14, team.credits, true);
  bytes.setInt32(0x18, team.costAccumulator, true);
  team.slots.forEach((slot, index) => {
    bytes.setInt32(0x3c + index * 4, slot.health, true);
    bytes.setInt32(0xc4 + index * 4, slot.level, true);
    teamBytes[0x78 + index] = slot.busy;
  });
  teamBytes[0xe12] = team.latch;
  for (const [index, queue] of team.queues.entries()) {
    teamBytes[0x108 + index] = queue.ready;
    teamBytes[0x10c + index] = queue.delay;
    bytes.setUint16(0x110 + index * 2, queue.items.length, true);
    teamBytes.fill(0, 0x118 + index * 800, 0x118 + (index + 1) * 800);
    queue.items.forEach((item, offset) => { teamBytes[0x118 + index * 800 + offset] = item.unitType; });
  }
  return { ...state, buffers: { ...state.buffers, teamBytes: [...teamBytes],
    ...(config.fullPolicy && world ? { entities: [...world.entityBytes!] } : {}) } };
}

function sameAiValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key)
    && sameAiValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

export function stepCampaignAi(state: CampaignAiSessionState, config: CampaignAiConfiguration,
  production: CampaignProductionState, world: CampaignWorld, request: CampaignAiSessionRequest) {
  requireAi(request.sourceId === config.sourceId && state.sourceId === config.sourceId, "Campaign-ai source identity mismatch");
  for (const record of state.history) {
    verifyReceiptIntegrity(record.receipt);
    if (record.receipt.command.stage === "full-policy") validateFullReceipt(record.receipt, config.fullPolicy);
  }
  const existing = state.history.find((entry) => entry.request.id === request.id);
  if (existing) {
    requireAi(sameAiValue(existing.request, request), "Campaign-ai command ID reused with different inputs");
    return { campaignAi: state, production, world };
  }
  const synchronized = synchronizeCampaignAi(state, config, production);
  requireAi(!config.fullPolicy || request.stage === "full-policy", "Full profile requires the complete policy caller");
  requireAi(request.stage !== "full-policy" || (config.fullPolicy && request.observation.forceOrder === state.buffers.forceOrder),
    "Full policy requires configured sources and the owned force state");
  const buffers = { ...synchronized.buffers, ...request.observation };
  const result = transactCampaignAiProduction({ ...sessionInputs(config, buffers), scope: config.scope,
    ...(config.fullPolicy ? { fullPolicy: config.fullPolicy } : {}),
    production, world, receipts: state.history.map((entry) => entry.receipt) },
  { id: request.id, sequence: request.sequence, stage: request.stage });
  requireAi(result.ok, result.ok ? "" : `${result.code}: ${result.message}`);
  const next = result.state;
  return { production: next.production, world: next.world, campaignAi: {
    sourceId: config.sourceId,
    buffers: { ...buffers, policy: [...next.ai.policy], entities: [...next.ai.entities], teamBytes: [...next.inputs.teamBytes],
      forceOrder: next.ai.forceOrder, ...(next.ai.rngCursor === undefined ? {} : { rngCursor: next.ai.rngCursor }) },
    history: [...state.history, { request: structuredClone(request), teamBytesBefore: [...buffers.teamBytes], receipt: next.receipts.at(-1)! }],
  } satisfies CampaignAiSessionState };
}

export function validateCampaignAiSession(state: CampaignAiSessionState, config: CampaignAiConfiguration,
  production: CampaignProductionState, world: CampaignWorld): CampaignAiSessionState {
  requireAi(state.sourceId === config.sourceId && new Set(state.history.map((entry) => entry.request.id)).size === state.history.length,
    "Checkpoint campaign-ai identity/history");
  let policy = config.initial.policy;
  let lastBuffers = config.initial;
  const events = new Map<string, unknown>();
  const history: CampaignAiSessionState["history"][number][] = [];
  for (const [sequence, record] of state.history.entries()) {
    const { request, receipt } = record;
    const integrity = verifyReceiptIntegrity(receipt, true);
    requireAi(request.sourceId === config.sourceId && request.sequence === sequence && request.id.length > 0
      && ["demand", "pipeline", "full-policy"].includes(request.stage)
      && (!config.fullPolicy || request.stage === "full-policy"), "Checkpoint campaign-ai command identity");
    requireAi(record.teamBytesBefore.every((value, offset) => (offset >= 0x14 && offset < 0x1c)
      || (offset >= 0x108 && offset < 0xd98)
      || (production.constructionHosts?.length && ((offset >= 0x3c && offset < 0x50)
        || (offset >= 0x78 && offset < 0x7d) || (offset >= 0xc4 && offset < 0xd8) || offset === 0xe12))
      || value === lastBuffers.teamBytes[offset]),
    "Checkpoint campaign-ai immutable native team source");
    const before = { ...request.observation, policy, teamBytes: record.teamBytesBefore,
      ...(lastBuffers.rngCursor === undefined ? {} : { rngCursor: lastBuffers.rngCursor }) };
    const { ai, inputs } = sessionInputs(config, before);
    let full: ReturnType<typeof computeLegacyAiFullPolicy> | undefined;
    if (request.stage === "full-policy") {
      requireAi(config.fullPolicy && request.observation.forceOrder === lastBuffers.forceOrder, "Checkpoint full-policy source/force");
      full = computeLegacyAiFullPolicy({ ...ai, rngCursor: ai.rngCursor! }, fullPolicyInputs(ai, inputs, config.fullPolicy));
      Object.assign(ai, full.candidate);
      inputs.teamBytes.set(full.teamBytes);
    }
    const native = full?.pipeline ?? (request.stage === "pipeline" ? consumeLegacyAiPolicyPipeline : consumeLegacyAiDemand)(ai, inputs);
    const intents = native.productionRequests.map((intent, index) => {
      const decoded = decodeCampaignAiPacket(intent.packet);
      const catalog = production.catalog.find((entry) => entry.id === intent.dependency);
      requireAi((intent.kind === "unit" && decoded.mode === 10 && [0, 8].includes(decoded.unitType)
        && catalog?.kind === "unit" && catalog.unitType === decoded.unitType
        || intent.kind === "city" && decoded.mode === 9 && decoded.city === 3 && decoded.level === 0
          && catalog?.kind === "building" && production.constructionHosts?.some(host => host.configuration.team === config.team))
        && decoded.team === config.team && intent.team === config.team && catalog?.cost === intent.cost
        && intent.creditsBefore >= intent.cost && intent.creditsBefore - intent.cost === intent.creditsAfter,
      "Checkpoint campaign-ai native receipt");
      const id = `campaign-ai:${JSON.stringify([production.sessionId, request.id, sequence, index])}`;
      events.set(`${id}:credits`, { id: `${id}:credits`, team: config.team, action: { type: "sync-credits",
        expectedPreviousCredits: intent.creditsBefore, credits: intent.creditsAfter } });
      events.set(id, { id, team: config.team, action: { ...paidAction(decoded, intent.dependency), expectedCredits: intent.creditsAfter,
        provenance: { code: "campaign-ai", sourceSha256: config.sourceSha256, receiptKey: id } } });
      return { id, dependency: intent.dependency, packet: [...intent.packet], creditsBefore: intent.creditsBefore,
        creditsAfter: intent.creditsAfter, receipt: "applied" as const, ticket: decoded.mode === 9 ? id : `${id}:0` };
    });
      const reconstructed: CampaignAiReceipt = { code: "campaign-ai", sourceSha256: config.sourceSha256,
      command: { id: request.id, sequence, stage: request.stage }, team: config.team, selectedRule: native.selectedRule, intents,
      ...(full ? { fullPolicy: { computation: fullPolicyProjection(full),
        disposition: hasActorTargets(full) ? "pending-native-task-hand-off" as const : "receipted" as const } } : {}) };
      const sealed = { ...reconstructed, integrity: receiptIntegrity(reconstructed) };
      requireAi(integrity === sealed.integrity && sameAiValue(receipt, Object.hasOwn(receipt, "integrity") ? sealed : reconstructed),
    "Checkpoint campaign-ai receipt differs from native computation");
      history.push({ ...record, receipt: sealed });
    policy = [...ai.policy];
    lastBuffers = { ...before, policy, entities: [...ai.entities], teamBytes: [...inputs.teamBytes], forceOrder: ai.forceOrder,
      ...(ai.rngCursor === undefined ? {} : { rngCursor: ai.rngCursor }) };
  }
  for (const [id, event] of events) {
    const index = production.journal.findIndex((entry) => entry.id === id);
    requireAi(index >= 0 && sameAiValue(production.journal[index], event), "Checkpoint campaign-ai debit/receipt event");
    if (!id.endsWith(":credits")) requireAi(production.journal[index - 1]?.id === `${id}:credits`,
      "Checkpoint campaign-ai debit must immediately precede receipt");
  }
  for (const event of production.journal) requireAi(!event.id.startsWith("campaign-ai:") || events.has(event.id),
    "Checkpoint unbacked campaign-ai event");
  const initialTeam = view(Uint8Array.from(config.initial.teamBytes));
  let credits = initialTeam.getInt32(0x14, true), accounting = initialTeam.getInt32(0x18, true);
  const pending: Record<number, number> = {};
  const tickets = new Map<string, { cost: number; unitType: number; dependency: number }>();
  const allocations = new Set<string>(), identities = new Set<string>();
  for (const event of production.journal.filter((entry) => entry.team === config.team)) {
    const action = event.action;
    if (action.type === "sync-credits") {
      requireAi(action.expectedPreviousCredits === credits, "Checkpoint campaign-ai credit chain/double debit");
      credits = action.credits;
    } else if (action.type === "reserve" || action.type === "release-pending" || action.type === "dispatch" || action.type === "receive-prepaid-unit") {
      const entry = production.catalog.find((candidate) => candidate.id === action.dependency);
      requireAi(entry?.kind === "unit", "Checkpoint campaign-ai ledger source");
      if (action.type === "reserve") { credits = (credits - entry.cost) | 0; pending[entry.id] = (pending[entry.id] ?? 0) + 1; }
      else if (action.type === "release-pending") {
        requireAi(pending[entry.id] > 0, "Checkpoint campaign-ai pending release");
        credits = (credits + entry.cost) | 0; pending[entry.id] -= 1;
      } else {
        const count = action.type === "dispatch" ? pending[entry.id] ?? 0 : 1;
        if (action.type === "dispatch") pending[entry.id] = 0;
        accounting += entry.cost * count;
        for (let index = 0; index < count; index += 1) tickets.set(`${event.id}:${index}`,
          { cost: entry.cost, unitType: entry.unitType!, dependency: entry.id });
      }
    } else if (action.type === "receive-prepaid-city") {
      const entry = production.catalog.find(candidate => candidate.id === action.dependency);
      requireAi(entry?.kind === "building", "Checkpoint CITY accounting source");
      accounting += entry.cost;
    } else if (action.type === "producer-cap-refund") {
      const ticket = tickets.get(action.ticket);
      requireAi(ticket, "Checkpoint campaign-ai refund ticket");
      credits = (credits + ticket.cost) | 0; accounting -= ticket.cost; tickets.delete(action.ticket);
    } else if (action.type === "allocated") {
      const allocation = production.requests.find((entry) => entry.type === "allocate-unit" && entry.id === action.requestId);
      requireAi(allocation?.type === "allocate-unit" && allocation.team === config.team && allocation.queue === action.queue,
        "Checkpoint campaign-ai allocation request");
      const ticket = tickets.get(allocation.ticket), identity = `${action.nativeSlot}:${action.generation}`;
      const created = transportHostState(world).requests.find((entry) => entry.type === "create"
        && entry.slot === action.nativeSlot && entry.generation === action.generation);
      requireAi(ticket && allocation.unitType === ticket.unitType && !allocations.has(allocation.id) && !identities.has(identity)
        && created?.type === "create" && created.team === config.team && created.unitType === ticket.unitType
        && created.position.x === allocation.tileX * 256 + 128 && created.position.y === allocation.tileY * 256 + 128,
      "Checkpoint campaign-ai paid ticket/creation identity");
      allocations.add(allocation.id); identities.add(identity); tickets.delete(allocation.ticket);
    }
  }
  const team = production.teams.find((entry) => entry.team === config.team)!;
  requireAi(credits === team.credits && accounting === team.costAccumulator && sameAiValue(pending, team.pending),
    "Checkpoint campaign-ai credits/accounting/pending ledger");
  requireAi(sameAiValue(team.queues.flatMap((queue) => queue.items), [...tickets].map(([ticket, item]) => ({ ticket, ...item })))
    && production.requests.filter((entry) => entry.team === config.team && entry.type === "allocate-unit")
      .every((entry) => allocations.has(entry.id)), "Checkpoint campaign-ai FIFO conservation");
  const expected = synchronizeCampaignAi({ ...state, buffers: lastBuffers }, config, production, world);
  requireAi(sameAiValue(state.buffers, expected.buffers), "Checkpoint campaign-ai buffers/source state");
  validateOwner({ ...sessionInputs(config, state.buffers), scope: config.scope, production, world,
    receipts: state.history.map((entry) => entry.receipt) });
  return { ...state, history };
}

function requireAi(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function validateSharedPool(entities: Uint8Array, world: CampaignWorld): void {
  requireAi(entities.length === 800 * 220 && world.entityBytes?.length === entities.length
    && entities.every((value, index) => value === world.entityBytes![index]), "Full policy requires exact current shared world entityBytes");
  const host = transportHostState(world), bytes = view(entities);
  const owners = new Map(world.entities.map(entity => [entity.rawSlot, entity]));
  requireAi(owners.size === world.entities.length, "Duplicate shared world slot");
  for (let slot = 0; slot < 800; slot += 1) {
    const actor = host.slots[slot], entity = owners.get(slot), offset = slot * 220;
    requireAi((entities[offset + 0x2c] === 0 && (!actor || actor.status === 0)) || (actor && entity),
      `Active policy slot ${slot} has no actual world actor`);
    if (!entity) continue;
    requireAi(actor && actor.slot === slot && actor.key === entity.key && actor.generation === entity.generation
      && host.generations[slot] === entity.generation && actor.unitType === entity.unitType && actor.team === entity.team
      && entities[offset + 6] === entity.unitType && entities[offset + 7] === entity.team
      && entities[offset + 0x2c] === actor.status && bytes.getInt32(offset + 12, true) === actor.health
      && actor.health === entity.health && bytes.getUint16(offset, true) === actor.position.x
      && bytes.getUint16(offset + 4, true) === actor.position.y
      && (actor.status === 0 || actor.health === 0 || host.registry[slot] === entity.key || actor.nativeConstruction),
    `Full policy current world identity/status/position mismatch at slot ${slot}`);
  }
}

function fullPolicyInputs(ai: CampaignAiTransactionState["ai"], inputs: LegacyAiDemandInputs,
  config: CampaignAiFullPolicyConfiguration): LegacyAiFullPolicyInputs {
  requireAi(Number.isInteger(ai.rngCursor) && ai.rngCursor! >= 0 && ai.rngCursor! < 256,
    "Full policy requires the owned RNG cursor");
  requireAi(config.neighbors.length === 8192 && config.rngTable.length === 256 && config.ruleTable.length === 216
    && Number.isInteger(config.policyAddress) && config.policyAddress > 0 && config.policyAddress <= 0xffffffff,
    "Incomplete full-policy source tables/allocation");
  const pointer = view(inputs.teamBytes).getUint32(0x28, true);
  requireAi(pointer === 0 || pointer === config.policyAddress, "Full policy allocation identity mismatch");
  return { ...inputs, neighbors: Uint8Array.from(config.neighbors), groundCells: Uint32Array.from(inputs.occupancy),
    rngTable: config.rngTable, actorTransport: config.actorTransport,
    initialization: pointer === 0 ? { needed: true, policyAddress: config.policyAddress,
      ruleTable: Uint8Array.from(config.ruleTable) } : { needed: false } };
}

export function decodeCampaignAiPacket(packet: Uint8Array):
  { mode: 9; city: number; level: number; team: number; callback: 0x41c8d4 }
  | { mode: 10; unitType: number; team: number; count: number; callback: 0x41c7f8 } {
  requireAi(packet.length === 7 && view(packet).getUint16(0, true) === 7 && packet[6] === 0,
    "AI packet requires exact seven-byte local frame, sequence nibble zero and final stream terminator");
  if (packet[2] === 9) {
    requireAi(packet[3] < 15 && packet[4] <= 1 && packet[5] < 8, "Invalid native city packet bounds");
    return { mode: 9, city: packet[3], level: packet[4], team: packet[5], callback: 0x41c8d4 };
  }
  requireAi(packet[2] === 10 && packet[3] < 110 && packet[4] < 8 && packet[5] === 1,
    "AI unit packet requires native type/team bounds and exact action count one");
  return { mode: 10, unitType: packet[3], team: packet[4], count: packet[5], callback: 0x41c7f8 };
}

function validateOwner(state: CampaignAiTransactionState): void {
  const { production, world, inputs } = state;
  requireAi(state.scope === "source-separated-bounded" && production.sessionId === world.sessionId,
    "AI transaction requires explicit bounded scope and matching owner session");
  requireAi(Number.isInteger(production.queueSafetyLimit) && production.queueSafetyLimit > 0
    && production.queueSafetyLimit <= 50, "Invalid adapter FIFO safety limit");
  requireAi(inputs.teamBytes.length === 0xe30 && inputs.dependencies.length === 110 * 52
    && inputs.types.length === 110 * 280, "Incomplete native production source arrays");
  const bytes = view(inputs.teamBytes), dependencies = view(inputs.dependencies), types = view(inputs.types);
  const team = production.teams.find((candidate) => candidate.team === inputs.team);
  requireAi(team && team.credits === world.exomoney[inputs.team] && team.credits === bytes.getInt32(0x14, true),
    "Stale AI/production/world credits before transaction");
  requireAi(team.costAccumulator === bytes.getInt32(0x18, true) && team.race === bytes.getInt32(0x20, true)
    && team.base.x === bytes.getInt32(0x2c, true) && team.base.y === bytes.getInt32(0x30, true),
    "AI/production accounting, race or base mismatch");
  requireAi(production.catalog.length === Array.from({ length: 110 }, (_, index) => inputs.dependencies[index * 52])
    .filter(Boolean).length, "Native DEPEND source catalog coverage mismatch");
  for (const entry of production.catalog) {
    const base = entry.id * 52;
    requireAi(inputs.dependencies[base] !== 0 && dependencies.getInt32(base + 8, true) === entry.cost
      && dependencies.getInt32(base + 12, true) === entry.interfaceId
      && entry.rawFields.every((value, index) => dependencies.getInt32(base + 16 + index * 4, true) === value)
      && entry.dependencies.every((value, index) => dependencies.getInt32(base + 32 + index * 4, true) === value)
      && (entry.dependencies.length === 5 || dependencies.getInt32(base + 32 + entry.dependencies.length * 4, true) < 0),
    "Native DEPEND source catalog mismatch");
  }
  for (let slot = 0; slot < 5; slot += 1) {
    const owned = team.slots[slot];
    requireAi(owned.health === bytes.getInt32(0x3c + slot * 4, true)
      && owned.level === bytes.getInt32(0xc4 + slot * 4, true) && owned.busy === inputs.teamBytes[0x78 + slot],
    "AI/production City projection mismatch");
    requireAi(owned.health === (world.entities.find((entity) => entity.rawSlot === team.team * 15 + slot)?.health ?? 0),
      "Production/world City ownership mismatch");
  }
  for (let source = 0; source < 110; source += 1) {
    requireAi((inputs.teamBytes[0xda4 + source] !== 0) === team.restrictions.includes(source), "AI/production restriction mismatch");
  }
  const host = transportHostState(world);
  for (const construction of production.constructionHosts ?? []) {
    validateTransportConstruction(world, construction);
    const config = construction.configuration;
    requireAi(types.getInt32((20 + config.race * 12) * 280 + 0x44, true) === 2400
      && types.getInt32((92 + config.race) * 280 + 0x44, true) === 800, "CITY original constructor health source mismatch");
  }
  requireAi(team.queues.length === 4, "Native production requires four queues");
  for (const [index, queue] of team.queues.entries()) {
    requireAi(bytes.getUint16(0x110 + index * 2, true) === queue.items.length
      && queue.items.length <= production.queueSafetyLimit && queue.ready === inputs.teamBytes[0x108 + index]
      && queue.delay === inputs.teamBytes[0x10c + index], "AI/production queue count or reservation flags mismatch");
    for (const [offset, item] of queue.items.entries()) {
      const entry = production.catalog.find((candidate) => candidate.id === item.dependency);
      requireAi(inputs.teamBytes[0x118 + index * 800 + offset] === item.unitType,
        "AI/production FIFO source order mismatch");
      requireAi(entry?.kind === "unit" && entry.unitType === item.unitType && entry.cost === item.cost
        && production.units.some((source) => source.unitType === item.unitType && source.queue === index),
      "Stored FIFO item/source catalog mismatch");
    }
    requireAi(new Set(queue.items.map((item) => item.ticket)).size === queue.items.length,
      "Duplicate production FIFO tickets");
    const reservations = (host.productionExits ?? []).filter((exit) => exit.team === team.team && exit.queue === index);
    if (queue.ready === 1) {
      requireAi(queue.activeTicket === null && queue.allocation === null && reservations.length === 0,
        "Ready producer has an active reservation");
    } else {
      const head = queue.items[0], source = production.units.find((entry) => entry.unitType === head?.unitType);
      const reservation = reservations[0];
      requireAi(queue.ready === 0 && head && queue.activeTicket === head.ticket && source && queue.animation
        && reservations.length === 1 && reservation.key === JSON.stringify([production.sessionId, team.team, index, head.ticket])
        && reservation.ticket === head.ticket && reservation.unitType === head.unitType
        && reservation.tile.x === team.base.x + source.exitOffset.x && reservation.tile.y === team.base.y + source.exitOffset.y
        && host.ground[reservation.tile.y * host.width + reservation.tile.x] === 1022,
      "Active producer/transport exit reservation mismatch");
    }
  }
  for (const source of production.units) {
    requireAi(types.getInt32(source.unitType * 280 + 0xec, true) === source.queue
      && types.getInt32(source.unitType * 280 + 0xf0, true) === source.exitSelector, "Native GAMESTAT producer selectors mismatch");
    if (source.unitType === 0 || source.unitType === 8) {
      requireAi(source.queue === 0 && source.exitSelector === 0 && source.exitOffset.x === 0 && source.exitOffset.y === -3,
        "Unverified native base troop exit offset");
    }
  }
}

function paidAction(packet: ReturnType<typeof decodeCampaignAiPacket>, dependency: number) {
  requireAi(packet.mode !== 9 || packet.city === 3 && packet.level === 0, "Unsupported CITY receipt slot/level");
  requireAi(packet.mode !== 10 || packet.unitType === 0 || packet.unitType === 8, "Unsupported native troop receipt");
  return packet.mode === 9
    ? { type: "receive-prepaid-city" as const, dependency, slot: 3 as const, level: 0 as const }
    : { type: "receive-prepaid-unit" as const, dependency, unitType: packet.unitType as 0 | 8, count: 1 as const };
}

function validateFullReceipt(receipt: CampaignAiReceipt, config: CampaignAiFullPolicyConfiguration | undefined): void {
  const full = receipt.fullPolicy?.computation;
  requireAi(config && full && full.readyWholeCall === true && full.computationCompleted === true &&
    full.completedCallback === 0x44be40 && full.admitted === false && full.runtimeReady === false &&
    full.productionLifecycleExecuted === false && full.receipts === "pending-owner" &&
    sameAiValue(full.groupOrder, [0, 1, 2, 3]) && full.actorTransport === config.actorTransport &&
    full.pipeline.selectedRule === receipt.selectedRule && full.pipeline.productionRequests.length === receipt.intents.length,
  "Full-policy receipt requires complete computation and source configuration");
  requireAi(full.groups.length === 4 && full.groups.every((group, index) => group.group === index &&
    Number.isSafeInteger(group.rngDraws) && group.rngDraws >= 0) && Number.isSafeInteger(full.rngDraws) &&
    full.rngDraws === full.groups.reduce((total, group) => total + group.rngDraws, 0),
  "Full-policy receipt group/RNG totals mismatch");
  const bytePlane = (bytes: readonly number[], length: number) => Array.isArray(bytes) && bytes.length === length &&
    bytes.every(value => Number.isInteger(value) && value >= 0 && value <= 255);
  requireAi(bytePlane(full.candidate.policy, 0x6c40) && bytePlane(full.candidate.entities, 800 * 220) &&
    bytePlane(full.teamBytes, 0xe30) && Number.isInteger(full.candidate.rngCursor) &&
    full.candidate.rngCursor >= 0 && full.candidate.rngCursor <= 255,
  "Full-policy receipt candidate bounds mismatch");
  const productionPackets = full.packets.filter(packet => packet.kind === "production");
  requireAi(productionPackets.length === receipt.intents.length && sameAiValue(full.packets,
    [...productionPackets, ...full.groups.flatMap(group => group.packets)]), "Full-policy receipt packet/group totals mismatch");
  for (const [index, packet] of full.packets.entries()) {
    requireAi(packet.sequence === index && packet.receipt === "pending-owner" &&
      bytePlane(packet.packet, packet.packet.length), "Full-policy receipt packet sequence/bytes mismatch");
    if (packet.kind === "production") {
      const native = full.pipeline.productionRequests[index];
      requireAi(packet.stage === "demand" && native && sameAiValue(packet.intent, native) &&
        sameAiValue(packet.packet, native.packet), "Full-policy receipt source production packet mismatch");
    } else {
      requireAi(packet.kind === "actor-order" && sameAiValue(packet.orders, decodeLegacyAiActorPacket(Uint8Array.from(packet.packet))),
        "Full-policy receipt actor packet mismatch");
    }
  }
  for (const group of full.groups) requireAi(group.packets.every(packet => packet.kind === "actor-order" && packet.stage === group.group),
    "Full-policy receipt packet group mismatch");
  const pending = full.packets.some(packet => packet.kind === "actor-order" &&
    packet.orders.some(order => order.mode === 5 || order.slots.length > 0));
  requireAi(receipt.fullPolicy!.disposition === (pending ? "pending-native-task-hand-off" : "receipted"),
    "Full-policy receipt disposition contradicts actor targets");
}

function validateReceiptHistory(state: CampaignAiTransactionState): void {
  const expectedEvents = new Set<string>();
  for (let sequence = 0; sequence < state.receipts.length; sequence++) {
    requireAi(Object.hasOwn(state.receipts, sequence), "Sparse AI receipt history");
    const receipt = state.receipts[sequence];
    verifyReceiptIntegrity(receipt);
    requireAi(receipt.code === "campaign-ai" && receipt.sourceSha256 === CAMPAIGN_AI_SOURCE_SHA256 &&
      receipt.command.sequence === sequence && receipt.command.id.length > 0 && receipt.team === state.inputs.team &&
      ["demand", "pipeline", "full-policy"].includes(receipt.command.stage) &&
      Number.isInteger(receipt.selectedRule) && receipt.selectedRule >= 0 && receipt.selectedRule < 18,
    "Invalid AI receipt provenance");
    if (receipt.command.stage === "full-policy") validateFullReceipt(receipt, state.fullPolicy);
    else requireAi(!receipt.fullPolicy && !state.fullPolicy, "Partial receipt cannot certify a full policy");
    for (let index = 0; index < receipt.intents.length; index++) {
      requireAi(Object.hasOwn(receipt.intents, index), "Sparse AI receipt intents");
      const intent = receipt.intents[index];
      const id = `campaign-ai:${JSON.stringify([state.production.sessionId, receipt.command.id, sequence, index])}`;
      const decoded = decodeCampaignAiPacket(Uint8Array.from(intent.packet));
      const source = state.production.catalog.find(entry => entry.id === intent.dependency);
      requireAi((decoded.mode === 10 && source?.kind === "unit" && source.unitType === decoded.unitType
        || decoded.mode === 9 && decoded.city === 3 && decoded.level === 0 && source?.kind === "building"
          && state.production.constructionHosts?.some(host => host.configuration.team === receipt.team))
        && decoded.team === receipt.team && source && intent.id === id && intent.ticket === (decoded.mode === 9 ? id : `${id}:0`) &&
        intent.receipt === "applied" && intent.creditsBefore >= source.cost &&
        intent.creditsAfter === ((intent.creditsBefore - source.cost) | 0), "Invalid AI paid receipt");
      const offset = state.production.journal.findIndex(event => event.id === id);
      requireAi(offset > 0 && sameAiValue(state.production.journal[offset - 1], {
        id: `${id}:credits`, team: receipt.team, action: { type: "sync-credits",
          expectedPreviousCredits: intent.creditsBefore, credits: intent.creditsAfter },
      }) && sameAiValue(state.production.journal[offset], { id, team: receipt.team,
        action: { ...paidAction(decoded, intent.dependency), expectedCredits: intent.creditsAfter,
          provenance: { code: "campaign-ai", receiptKey: id, sourceSha256: CAMPAIGN_AI_SOURCE_SHA256 } } }),
      "AI receipt does not match committed production events");
      expectedEvents.add(id); expectedEvents.add(`${id}:credits`);
      const native = receipt.fullPolicy?.computation.pipeline.productionRequests[index];
      if (receipt.fullPolicy) requireAi(native && (native.kind === "unit" && decoded.mode === 10
        && native.callback === 0x40c168 && native.count === 1 && native.unitType === decoded.unitType
        || native.kind === "city" && decoded.mode === 9 && native.callback === 0x40c13c
          && native.city === decoded.city && native.level === decoded.level)
        && native.receipt === "pending-owner" && native.cost === source.cost &&
        native.dependency === intent.dependency && native.team === receipt.team &&
        native.creditsBefore === intent.creditsBefore && native.creditsAfter === intent.creditsAfter &&
        sameAiValue(native.packet, intent.packet), "AI receipt differs from full-policy intent");
    }
  }
  for (const event of state.production.journal) requireAi(!event.id.startsWith("campaign-ai:") || expectedEvents.has(event.id),
    "Unbacked campaign-ai production event");
}

export function transactCampaignAiProduction(previous: CampaignAiTransactionState,
  command: CampaignAiCommand): CampaignAiTransactionResult {
  try {
    requireAi(previous.scope === "source-separated-bounded" && previous.production.sessionId === previous.world.sessionId,
      "AI transaction requires explicit bounded scope and matching owner session");
    requireAi(command.id.length > 0 && Number.isSafeInteger(command.sequence) && command.sequence >= 0
      && ["demand", "pipeline", "full-policy"].includes(command.stage), "Invalid AI transaction identity");
    requireAi(!previous.fullPolicy || command.stage === "full-policy", "Full-policy configuration cannot downgrade to a partial stage");
    requireAi(command.stage !== "full-policy" || previous.fullPolicy, "Full-policy source configuration is required");
    validateReceiptHistory(previous);
    requireAi(new Set(previous.receipts.map((receipt) => receipt.command.id)).size === previous.receipts.length
      && previous.receipts.every((receipt, index) => receipt.command.sequence === index), "Invalid AI receipt sequence history");
    const existing = previous.receipts.find((receipt) => receipt.command.id === command.id);
    if (existing) {
      requireAi(existing.command.sequence === command.sequence && existing.command.stage === command.stage
        && existing.team === previous.inputs.team,
        "AI transaction ID reused with different payload");
      return { ok: true, disposition: "duplicate", state: { ...structuredClone(previous), production: productionSnapshot(previous.production) },
        readyWholeCall: command.stage === "full-policy", remainingGroups: command.stage === "full-policy" ? [] : [0, 1, 2, 3] };
    }
    requireAi(command.sequence === previous.receipts.length, "Out-of-order AI transaction sequence");
    validateOwner(previous);
    const staged = structuredClone(previous);
    let full: ReturnType<typeof computeLegacyAiFullPolicy> | undefined;
    if (command.stage === "full-policy") {
      requireAi(staged.fullPolicy, "Full-policy source configuration is required");
      validateSharedPool(staged.ai.entities, staged.world);
      const inputs = fullPolicyInputs(staged.ai, staged.inputs, staged.fullPolicy);
      full = computeLegacyAiFullPolicy({ ...staged.ai, rngCursor: staged.ai.rngCursor! }, inputs);
      Object.assign(staged.ai, { ...full.candidate, entities: new Uint8Array(full.candidate.entities) });
      staged.inputs.teamBytes.set(full.teamBytes);
    }
    const demand = full?.pipeline ?? (command.stage === "pipeline" ? consumeLegacyAiPolicyPipeline : consumeLegacyAiDemand)(staged.ai, staged.inputs);
    requireAi(staged.inputs.teamBytes.every((value, offset) => (offset >= 0x14 && offset < 0x18)
      || (full && offset >= 0x28 && offset < 0x2c)
      || value === previous.inputs.teamBytes[offset]), "Demand changed producer fields outside the credit debit");
    const nativeTeam = view(staged.inputs.teamBytes);
    let credits = view(previous.inputs.teamBytes).getInt32(0x14, true);
    let production = previous.production;
    const intents: CampaignAiReceipt["intents"][number][] = [];
    for (const [index, intent] of demand.productionRequests.entries()) {
      const decoded = decodeCampaignAiPacket(intent.packet);
      requireAi(intent.receipt === "pending-owner" && intent.team === previous.inputs.team && decoded.team === intent.team
        && intent.creditsBefore === credits && intent.creditsAfter === ((credits - intent.cost) | 0)
        && credits >= intent.cost, "Invalid native AI debit chain");
      const entry = production.catalog.find((candidate) => candidate.id === intent.dependency);
      requireAi(entry && entry.cost === intent.cost, "AI intent/source cost mismatch");
      if (intent.kind === "city") {
        requireAi(decoded.mode === 9 && intent.callback === 0x40c13c && decoded.city === intent.city
          && decoded.level === intent.level, "City intent/packet mismatch");
        if (!production.constructionHosts?.some(host => host.configuration.team === intent.team)
          || intent.city !== 3 || intent.level !== 0) return { ok: false, code: "unsupported-city",
          message: `Mode 9 city ${intent.city} level ${intent.level}: construction receipt/lifecycle is not owned`, intent };
      } else {
        requireAi(decoded.mode === 10 && intent.callback === 0x40c168 && decoded.unitType === intent.unitType
          && decoded.count === intent.count && entry.unitType === intent.unitType, "Unit intent/packet mismatch");
        if (intent.unitType !== 0 && intent.unitType !== 8) {
          return { ok: false, code: "unsupported-unit", message: `Mode 10 type ${intent.unitType}: no admitted native FIN producer lifecycle`, intent };
        }
        const producer = staged.world.entities.find((entity) => entity.rawSlot === intent.team * 15 + 1);
        requireAi(producer && producer.team === intent.team && producer.health > 0
          && producer.unitType === (intent.unitType === 0 ? 17 : 29), "Missing real native base troop producer");
      }
      const id = `campaign-ai:${JSON.stringify([production.sessionId, command.id, command.sequence, index])}`;
      production = reduceCampaignProduction(production, { id: `${id}:credits`, team: intent.team,
        action: { type: "sync-credits", expectedPreviousCredits: credits, credits: intent.creditsAfter } });
      production = reduceCampaignProduction(production, { id, team: intent.team,
        action: { ...paidAction(decoded, intent.dependency), expectedCredits: intent.creditsAfter, provenance: { code: "campaign-ai", receiptKey: id,
            sourceSha256: CAMPAIGN_AI_SOURCE_SHA256 } } });
      intents.push({ id, dependency: intent.dependency, packet: [...intent.packet], creditsBefore: credits,
        creditsAfter: intent.creditsAfter, receipt: "applied", ticket: decoded.mode === 9 ? id : `${id}:0` });
      credits = intent.creditsAfter;
    }
    requireAi(nativeTeam.getInt32(0x14, true) === credits, "AI credits after action do not match exact intent debits");
    const team = production.teams.find((candidate) => candidate.team === staged.inputs.team)!;
    nativeTeam.setInt32(0x18, team.costAccumulator, true);
    team.slots.forEach((slot, index) => {
      nativeTeam.setInt32(0x3c + index * 4, slot.health, true);
      nativeTeam.setInt32(0xc4 + index * 4, slot.level, true);
      staged.inputs.teamBytes[0x78 + index] = slot.busy;
    });
    staged.inputs.teamBytes[0xe12] = team.latch;
    for (const [index, queue] of team.queues.entries()) {
      nativeTeam.setUint16(0x110 + index * 2, queue.items.length, true);
      queue.items.forEach((item, offset) => { staged.inputs.teamBytes[0x118 + index * 800 + offset] = item.unitType; });
    }
    let world = { ...staged.world, exomoney: { ...staged.world.exomoney, [team.team]: credits } };
    if (full) {
      world = receiveTransportHostAiPolicy(world, full.candidate.entities,
        full.packets.filter(packet => packet.kind === "actor-order").map(packet => packet.packet), command.id,
        full.actorTransport);
    }
    for (const construction of production.constructionHosts ?? []) {
      const prior = previous.production.constructionHosts!.find(host => host.configuration.team === construction.configuration.team)!;
      if (construction.receiptId !== prior.receiptId) world = projectTransportConstruction(world, prior, construction);
    }
    if (full) staged.ai.entities.set(world.entityBytes!);
    const receipt: CampaignAiReceipt = { code: "campaign-ai", sourceSha256: CAMPAIGN_AI_SOURCE_SHA256,
        command: { ...command }, team: team.team, selectedRule: demand.selectedRule, intents,
        ...(full ? { fullPolicy: { computation: fullPolicyProjection(full),
          disposition: hasActorTargets(full) ? "pending-native-task-hand-off" as const : "receipted" as const } } : {}) };
    const state: CampaignAiTransactionState = { ...staged, production, world,
      receipts: [...staged.receipts, { ...receipt, integrity: receiptIntegrity(receipt) }] };
    validateOwner(state);
    if (full) validateSharedPool(state.ai.entities, state.world);
    return { ok: true, disposition: "applied", state, readyWholeCall: !!full, remainingGroups: full ? [] : [0, 1, 2, 3] };
  } catch (error) {
    return { ok: false, code: "invalid-owner", message: error instanceof Error ? error.message : String(error) };
  }
}

export interface CampaignAiCityState {
  readonly scope: "source-city-only";
  readonly ai: LegacyAiOrderState;
  readonly inputs: LegacyAiDemandInputs;
  readonly production: CampaignProductionState;
  readonly receipts: readonly CampaignAiReceipt[];
}

function projectCityProduction(state: CampaignAiCityState): CampaignAiCityState {
  const team = state.production.teams.find(candidate => candidate.team === state.inputs.team)!;
  const teamBytes = new Uint8Array(state.inputs.teamBytes), bytes = view(teamBytes);
  bytes.setInt32(0x14, team.credits, true);
  bytes.setInt32(0x18, team.costAccumulator, true);
  team.slots.forEach((slot, index) => {
    bytes.setInt32(0x3c + index * 4, slot.health, true);
    bytes.setInt32(0xc4 + index * 4, slot.level, true);
    teamBytes[0x78 + index] = slot.busy;
  });
  teamBytes[0xe12] = team.latch;
  team.queues.forEach((queue, index) => {
    teamBytes[0x108 + index] = queue.ready;
    teamBytes[0x10c + index] = queue.delay;
    bytes.setUint16(0x110 + index * 2, queue.items.length, true);
    teamBytes.fill(0, 0x118 + index * 800, 0x118 + (index + 1) * 800);
    queue.items.forEach((item, offset) => { teamBytes[0x118 + index * 800 + offset] = item.unitType; });
  });
  return { ...state, inputs: { ...state.inputs, teamBytes } };
}

function validateCityOwner(state: CampaignAiCityState): void {
  requireAi(state.scope === "source-city-only", "CITY requires explicit source-only scope; no world receipt is implied");
  const host = state.production.constructionHosts?.find(candidate => candidate.configuration.team === state.inputs.team);
  const team = state.production.teams.find(candidate => candidate.team === state.inputs.team);
  requireAi(host && team && state.inputs.teamBytes.length === 0xe30 && state.inputs.dependencies.length === 110 * 52
    && state.inputs.types.length === 110 * 280, "Missing source CITY owner/arrays");
  restoreNativeConstructionHost(host, host.configuration);
  requireAi(host.configuration.race === team.race && host.configuration.base.x === team.base.x
    && host.configuration.base.y === team.base.y && host.busy === team.slots[3].busy && host.latch === team.latch
    && (host.actors[3]?.health ?? 0) === team.slots[3].health, "CITY host/production projection mismatch");
  requireAi(team.slots.every((slot, index) => index === 3 || (slot.health === (host.configuration.fixedSlots[index]?.health ?? 0)
    && slot.busy === 0 && slot.level === 0)) && team.slots[3].level === 0
    && ((!host.receiptId || host.ready) ? team.construction === null : team.construction?.id === host.receiptId
      && team.construction.nativeId === team.team * 15 + 3 && team.construction.unitType === 20 + team.race * 12
      && team.construction.phase === host.actors[3]!.phase), "CITY prerequisite/construction ownership mismatch");
  requireAi(sameAiValue([...state.inputs.teamBytes], [...projectCityProduction(state).inputs.teamBytes]),
    "Stale CITY native credits/accounting/slots/queues/latch");
  const bytes = view(state.inputs.teamBytes), dependencies = view(state.inputs.dependencies), types = view(state.inputs.types);
  requireAi(bytes.getInt32(0x20, true) === team.race && bytes.getInt32(0x2c, true) === team.base.x
    && bytes.getInt32(0x30, true) === team.base.y, "CITY native race/base mismatch");
  requireAi(state.production.catalog.length === Array.from({ length: 110 }, (_, index) => state.inputs.dependencies[index * 52]).filter(Boolean).length,
    "CITY DEPEND source coverage mismatch");
  for (const entry of state.production.catalog) {
    const offset = entry.id * 52;
    requireAi(state.inputs.dependencies[offset] !== 0 && entry.cost === dependencies.getInt32(offset + 8, true)
      && entry.interfaceId === dependencies.getInt32(offset + 12, true)
      && entry.rawFields.every((value, index) => value === dependencies.getInt32(offset + 16 + index * 4, true))
      && entry.dependencies.every((value, index) => value === dependencies.getInt32(offset + 32 + index * 4, true))
      && (entry.dependencies.length === 5 || dependencies.getInt32(offset + 32 + entry.dependencies.length * 4, true) < 0),
    "CITY original dependency cost/prerequisite mismatch");
  }
  for (let source = 0; source < 110; source++) requireAi((state.inputs.teamBytes[0xda4 + source] !== 0) === team.restrictions.includes(source),
    "CITY source restrictions mismatch");
  requireAi(types.getInt32((20 + team.race * 12) * 280 + 0x44, true) === 2400
    && types.getInt32((92 + team.race) * 280 + 0x44, true) === 800, "CITY original health mismatch");
  const events = new Set<string>();
  requireAi(new Set(state.receipts.map(receipt => receipt.command.id)).size === state.receipts.length, "Duplicate CITY command identity");
  for (const [sequence, receipt] of state.receipts.entries()) {
    verifyReceiptIntegrity(receipt);
    requireAi(receipt.command.sequence === sequence && receipt.command.stage === "demand" && receipt.team === team.team
      && receipt.sourceSha256 === CAMPAIGN_AI_SOURCE_SHA256 && !receipt.fullPolicy, "CITY receipt history identity");
    for (const [index, intent] of receipt.intents.entries()) {
      const id = `campaign-ai-city:${JSON.stringify([state.production.sessionId, receipt.command.id, sequence, index])}`;
      const packet = decodeCampaignAiPacket(Uint8Array.from(intent.packet));
      const source = state.production.catalog.find(entry => entry.id === intent.dependency);
      const offset = state.production.journal.findIndex(candidate => candidate.id === id);
      const action = packet.mode === 9 ? { type: "receive-prepaid-city", dependency: intent.dependency, slot: packet.city, level: packet.level }
        : { type: "receive-prepaid-unit", dependency: intent.dependency, unitType: packet.unitType, count: packet.count };
      requireAi(source && intent.id === id && packet.team === team.team && intent.receipt === "applied"
        && intent.ticket === (packet.mode === 9 ? id : `${id}:0`) && intent.creditsBefore >= source.cost
        && intent.creditsAfter === ((intent.creditsBefore - source.cost) | 0) && offset > 0
        && sameAiValue(state.production.journal[offset - 1], { id: `${id}:credits`, team: team.team,
          action: { type: "sync-credits", expectedPreviousCredits: intent.creditsBefore, credits: intent.creditsAfter } })
        && sameAiValue(state.production.journal[offset], { id, team: team.team, action: { ...action,
          expectedCredits: intent.creditsAfter, provenance: { code: "campaign-ai", sourceSha256: CAMPAIGN_AI_SOURCE_SHA256, receiptKey: id } } }),
      "CITY receipt production journal mismatch");
      events.add(id);
      events.add(`${id}:credits`);
    }
  }
  requireAi(state.production.journal.every(event => event.team === team.team
    && (events.has(event.id) || event.action.type === "native-construction-visit")), "CITY unbacked production event");
}

export function transactCampaignAiCity(previous: CampaignAiCityState, command: CampaignAiCommand): CampaignAiCityState {
  validateCityOwner(previous);
  requireAi(command.stage === "demand" && command.id.length > 0 && Number.isSafeInteger(command.sequence),
    "CITY supports finite native demand only, not full policy/world scheduling");
  const duplicate = previous.receipts.find(receipt => receipt.command.id === command.id);
  if (duplicate) {
    requireAi(sameAiValue(duplicate.command, command), "CITY command ID reused with different payload");
    return structuredClone(previous);
  }
  requireAi(command.sequence === previous.receipts.length, "CITY command sequence mismatch");
  const staged = structuredClone(previous);
  const native = consumeLegacyAiDemand(staged.ai, staged.inputs);
  let production = staged.production;
  const intents: CampaignAiReceipt["intents"][number][] = [];
  for (const [index, intent] of native.productionRequests.entries()) {
    const packet = decodeCampaignAiPacket(intent.packet);
    const entry = production.catalog.find(candidate => candidate.id === intent.dependency);
    const team = production.teams.find(candidate => candidate.team === intent.team);
    requireAi(entry && team && intent.team === staged.inputs.team && packet.team === intent.team
      && intent.receipt === "pending-owner" && intent.cost === entry.cost && intent.creditsBefore === team.credits
      && team.credits >= entry.cost && intent.creditsAfter === ((team.credits - entry.cost) | 0), "CITY native debit chain mismatch");
    const id = `campaign-ai-city:${JSON.stringify([production.sessionId, command.id, command.sequence, index])}`;
    const provenance = { code: "campaign-ai" as const, receiptKey: id, sourceSha256: CAMPAIGN_AI_SOURCE_SHA256 };
    production = reduceCampaignProduction(production, { id: `${id}:credits`, team: intent.team,
      action: { type: "sync-credits", expectedPreviousCredits: intent.creditsBefore, credits: intent.creditsAfter } });
    if (intent.kind === "city") {
      requireAi(packet.mode === 9 && packet.city === 3 && packet.level === 0 && intent.city === 3 && intent.level === 0
        && intent.callback === 0x40c13c && intent.dependency === (team.race === 0 ? 2 : 16),
      "Unsupported CITY receipt: only original first slot-3 science is owned");
      production = reduceCampaignProduction(production, { id, team: intent.team,
        action: { type: "receive-prepaid-city", dependency: intent.dependency, slot: 3, level: 0,
          expectedCredits: intent.creditsAfter, provenance } });
    } else {
      requireAi(packet.mode === 10 && packet.unitType === intent.unitType && packet.count === 1
        && intent.callback === 0x40c168 && (intent.unitType === 0 || intent.unitType === 8), "Unsupported next native unit receipt");
      production = reduceCampaignProduction(production, { id, team: intent.team,
        action: { type: "receive-prepaid-unit", dependency: intent.dependency, unitType: intent.unitType, count: 1,
          expectedCredits: intent.creditsAfter, provenance } });
    }
    intents.push({ id, dependency: intent.dependency, packet: [...intent.packet], creditsBefore: intent.creditsBefore,
      creditsAfter: intent.creditsAfter, receipt: "applied", ticket: intent.kind === "city" ? id : `${id}:0` });
  }
  requireAi(view(staged.inputs.teamBytes).getInt32(0x14, true)
    === production.teams.find(team => team.team === staged.inputs.team)!.credits, "CITY unreceipted native debit");
  const receipt: CampaignAiReceipt = { code: "campaign-ai", sourceSha256: CAMPAIGN_AI_SOURCE_SHA256, command: { ...command },
    team: staged.inputs.team, selectedRule: native.selectedRule, intents };
  const next = projectCityProduction({ ...staged, production,
    receipts: [...staged.receipts, { ...receipt, integrity: receiptIntegrity(receipt) }] });
  validateCityOwner(next);
  return next;
}

export function stepCampaignAiCityConstruction(previous: CampaignAiCityState, visit: NativeConstructionVisit,
  id: string): CampaignAiCityState {
  validateCityOwner(previous);
  const production = reduceCampaignProduction(previous.production, { id, team: previous.inputs.team,
    action: { type: "native-construction-visit", visit } });
  const next = projectCityProduction({ ...previous, production });
  validateCityOwner(next);
  return next;
}

export type CampaignAiCityCheckpoint = NativeJson<CampaignAiCityState>;

export function campaignAiCityCheckpoint(state: CampaignAiCityState): CampaignAiCityCheckpoint {
  validateCityOwner(state);
  return JSON.parse(JSON.stringify(state, (_key, value) => value instanceof Uint8Array ? [...value] : value));
}

export function restoreCampaignAiCity(value: CampaignAiCityState | CampaignAiCityCheckpoint,
  initial: CampaignAiCityState): CampaignAiCityState {
  requireAi(initial.receipts.length === 0, "CITY restore requires externally authenticated initial AI inputs");
  restoreCampaignCityProduction(value.production, initial.production);
  let replay = structuredClone(initial), offset = 0;
  while (offset < value.production.journal.length) {
    const event = value.production.journal[offset];
    if (event.action.type === "native-construction-visit") {
      replay = stepCampaignAiCityConstruction(replay, event.action.visit, event.id);
      offset++;
    } else {
      const receipt = value.receipts[replay.receipts.length];
      requireAi(receipt, "CITY checkpoint missing native command");
      const before = replay.production.journal.length;
      replay = transactCampaignAiCity(replay, receipt.command);
      const added = replay.production.journal.length - before;
      requireAi(added > 0 || replay.receipts.length <= value.receipts.length, "CITY checkpoint replay failed");
      offset += added;
    }
  }
  while (replay.receipts.length < value.receipts.length) replay = transactCampaignAiCity(replay, value.receipts[replay.receipts.length].command);
  requireAi(sameAiValue(replay, value), "CITY checkpoint differs from native command/visit replay");
  return replay;
}
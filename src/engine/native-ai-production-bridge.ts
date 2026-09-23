import { parseDependencies, parseUnitStats } from "../../tools/extractors/data/tables";
import { authenticateLegacyNativeSchedulerSource } from "./legacy-native-scheduler";
import { producerProfiles } from "./source-production-options";
import type { ProductionSourceProfile } from "./campaign-production";
import { advanceLegacyResourceAnimation } from "./legacy-resource";
import { constructSourceNativeTaskActor, retainSourceNativeTaskConfiguration } from "./source-native-task-options";
import type { NativeAiTaskConfiguration } from "./transport-host";
import { consumeLegacyAiGroupOne, consumeLegacyAiGroupTwo, consumeLegacyAiPolicyPipeline,
  initializeLegacyAiPolicy, type LegacyAiActiveState } from "./legacy-ai-active";
import { consumeLegacyAiGroupZero } from "./legacy-ai-group-zero";
import { consumeLegacyAiGroupThree } from "./legacy-ai-group-three";
import { applyLegacyAiActorPacket, type LegacyAiFullPolicyInputs } from "./legacy-ai-policy";

export interface NativeAiProductionWorld {
  readonly game: Uint8Array;
  readonly groundCells: Uint32Array;
  readonly populations: readonly number[];
  readonly rngCursor: number;
  readonly width: number;
  readonly height: number;
}

export interface NativeAiProductionConfiguration {
  readonly scope: "source-native-paid-base-production";
  readonly sourceId: string;
}

type Sources = {
  records: ReturnType<typeof parseDependencies>;
  units: ReturnType<typeof parseUnitStats>;
  profiles: readonly ProductionSourceProfile[];
  constructors?: NativeAiTaskConfiguration;
};
const sources = new WeakMap<NativeAiProductionConfiguration, Sources>();
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const side = (team: number) => 0xb98 + team * 0xe30;

function requireProduction(condition: unknown, message: string): asserts condition {
  if (!condition) throw new RangeError(`Native AI production: ${message}`);
}

function integer(value: number, minimum: number, maximum: number): boolean {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

async function digest(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer))]
    .map(value => value.toString(16).padStart(2, "0")).join("");
}

export async function createNativeAiProductionConfiguration(input: Readonly<{
  executable: Uint8Array;
  dependencies: Uint8Array;
  gameStat: Uint8Array;
  humanProducer: Uint8Array;
  alienProducer: Uint8Array;
  constructors?: NativeAiTaskConfiguration;
}>): Promise<NativeAiProductionConfiguration> {
  const constructors = input.constructors && retainSourceNativeTaskConfiguration(input.constructors);
  const bytes = Object.fromEntries((["executable", "dependencies", "gameStat", "humanProducer", "alienProducer"] as const)
    .map(name => [name, Uint8Array.from(input[name])]));
  const scheduler = await authenticateLegacyNativeSchedulerSource(bytes.executable);
  const hashes = await Promise.all([bytes.dependencies, bytes.gameStat, bytes.humanProducer, bytes.alienProducer].map(digest));
  requireProduction(hashes.join(":") === [
    "5acff29f0ed0f254f6dae17ddfb8fb1f50f6d99e92a5fe363d638f76abe54fd6",
    "ed13afe21ffea368a5892b49de40ef063014c0a9376c5d5bb5abf1396cb27629",
    "883cdcf414bc3935d76580ea920aa2792af0f3008260cd8c102c6b671633d47e",
    "a254a8534cbc212e4692b10ea3bef1ee247d54c36f299fd5009f0a37ff31c46f",
  ].join(":"), "unverified DEPEND/GAMESTAT/producer FIN sources");
  const text = new TextDecoder();
  const configuration = Object.freeze({ scope: "source-native-paid-base-production" as const,
    sourceId: [scheduler.executableSha256, ...hashes, constructors?.sourceId ?? "no-constructor"].join(":") });
  sources.set(configuration, { records: parseDependencies(text.decode(bytes.dependencies)),
    units: parseUnitStats(text.decode(bytes.gameStat)), profiles: [
      ...producerProfiles(JSON.parse(text.decode(bytes.humanProducer)), 0),
      ...producerProfiles(JSON.parse(text.decode(bytes.alienProducer)), 1),
    ], constructors });
  return configuration;
}

function source(configuration: NativeAiProductionConfiguration): Sources {
  const result = sources.get(configuration);
  requireProduction(result, "original authenticated configuration identity required");
  return result;
}

function validateWorld(world: NativeAiProductionWorld): void {
  requireProduction(world.game.length === 0x471b0 && integer(world.width, 1, 256)
    && integer(world.height, 1, 256) && world.groundCells.length === world.width * world.height
    && world.populations.length === 8 && world.populations.every(value => integer(value, 0, 800))
    && integer(world.rngCursor, 0, 255), "complete current raw world/census/shared RNG required");
  requireProduction(typeof SharedArrayBuffer === "undefined"
    || ![world.game, world.groundCells].some(bytes => bytes.buffer instanceof SharedArrayBuffer), "unshared current world required");
}

export interface NativeAiPaidUnitReceipt {
  readonly phase: "ai-demand-prepaid-unit";
  readonly team: number;
  readonly dependency: number;
  readonly packet: Uint8Array;
  readonly creditsBefore: number;
  readonly creditsAfter: number;
  readonly expectedQueueLength: number;
  readonly expectedAccounting: number;
}

export function receiveNativeAiPaidProduction(configuration: NativeAiProductionConfiguration,
  currentWorld: NativeAiProductionWorld, receipt: NativeAiPaidUnitReceipt) {
  const tables = source(configuration);
  validateWorld(currentWorld);
  requireProduction(receipt.phase === "ai-demand-prepaid-unit" && integer(receipt.team, 0, 7), "unsupported receipt phase/team");
  const packet = receipt.packet;
  requireProduction(packet.length === 7 && view(packet).getUint16(0, true) === 7 && packet[2] === 10
    && packet[4] === receipt.team && packet[5] === 1 && packet[6] === 0, "require exact single paid mode10 packet; CITY/free/count unsupported");
  const unitType = packet[3], record = tables.records.find(entry => entry.id === receipt.dependency);
  requireProduction((unitType === 0 || unitType === 8) && record?.rawFields[0] === 1 && record.rawFields[1] === unitType
    && tables.units[unitType].rawTail[10] === 0 && tables.units[unitType].rawTail[12] === 0,
  "unsupported unit/dependency/queue/exit source");
  const offset = side(receipt.team), before = view(currentWorld.game), cost = record.cost;
  requireProduction(integer(receipt.creditsBefore, cost, 0x7fffffff)
    && receipt.creditsAfter === receipt.creditsBefore - cost
    && before.getInt32(offset + 0x14, true) === receipt.creditsAfter, "stale or missing native prepaid debit");
  requireProduction(integer(receipt.expectedQueueLength, 0, 798)
    && before.getUint16(offset + 0x110, true) === receipt.expectedQueueLength
    && integer(receipt.expectedAccounting, 0, 0x7fffffff - cost)
    && before.getInt32(offset + 0x18, true) === receipt.expectedAccounting, "stale queue/accounting or full native FIFO");
  requireProduction(before.getInt32(offset + 0x20, true) * 8 === unitType, "unit does not match current source team race");
  const world = structuredClone(currentWorld), after = view(world.game);
  world.game[offset + 0x118 + receipt.expectedQueueLength] = unitType;
  after.setUint16(offset + 0x110, receipt.expectedQueueLength + 1, true);
  after.setInt32(offset + 0x18, receipt.expectedAccounting + cost, true);
  return { world, phase: receipt.phase, completedCallback: 0x41c7f8 as const,
    team: receipt.team, unitType, queue: 0 as const, cost, charged: 0 as const,
    credits: receipt.creditsAfter, queueBefore: receipt.expectedQueueLength,
    queueAfter: receipt.expectedQueueLength + 1, allocatedSlot: null,
    rngBefore: currentWorld.rngCursor, rngAfter: world.rngCursor };
}

export interface NativeAiProducerVisit {
  readonly phase: "producer-handler-entry";
  readonly slot: number;
  readonly expectedCounter: number;
  readonly expectedRaw: Uint8Array;
}

function producer(configuration: NativeAiProductionConfiguration, world: NativeAiProductionWorld,
  visit: NativeAiProducerVisit) {
  const tables = source(configuration);
  validateWorld(world);
  requireProduction(visit.phase === "producer-handler-entry" && integer(visit.slot, 0, 119)
    && visit.slot % 15 === 1 && visit.expectedRaw.length === 220, "queue0 fixed producer boundary required");
  const bytes = view(world.game), actor = 0x7d28 + visit.slot * 220, team = Math.floor(visit.slot / 15), offset = side(team);
  requireProduction(bytes.getUint32(0x94c, true) === visit.expectedCounter
    && world.game.subarray(actor, actor + 220).every((value, index) => value === visit.expectedRaw[index]), "stale producer phase/raw");
  const race = bytes.getInt32(offset + 0x20, true), unitType = race * 8;
  requireProduction((race === 0 || race === 1) && world.game[actor + 6] === 17 + race * 12
    && world.game[actor + 7] === team && world.game[actor + 0x2c] === 1
    && bytes.getInt16(0x468ec + visit.slot * 2, true) === visit.slot
    && bytes.getInt32(actor + 12, true) > Math.floor(tables.units[17 + race * 12].health * 11 / 16)
    && world.game[offset + 0x79] === 0 && world.game[actor + 0x1a] <= 2,
  "unsupported producer health/building/primary FIN state");
  const count = bytes.getUint16(offset + 0x110, true), ready = world.game[offset + 0x108];
  requireProduction(count <= 799 && (ready === 0 || ready === 1) && (ready === 1 || count > 0), "invalid producer FIFO/ready");
  requireProduction(Array.from(world.game.subarray(offset + 0x118, offset + 0x118 + count)).every(type => type === unitType),
    "unsupported queued unit type");
  return { tables, bytes, actor, team, offset, unitType, count, ready,
    profile: tables.profiles.find(profile => profile.unitType === unitType)! };
}

export function advanceNativeAiProductionFin(configuration: NativeAiProductionConfiguration,
  currentWorld: NativeAiProductionWorld, visit: NativeAiProducerVisit) {
  const state = producer(configuration, currentWorld, visit);
  requireProduction(state.ready === 0 && state.bytes.getUint32(state.actor + 0x24, true) === state.unitType * 280 + 0x98,
    "active source production FIN field identity required");
  const animation = advanceLegacyResourceAnimation({ profile: state.profile.id,
    frame: currentWorld.game[state.actor + 0x28], delay: currentWorld.game[state.actor + 0x29],
    mode: currentWorld.game[state.actor + 0x2a] as 0 | 1 | 2 | 3 }, state.profile, currentWorld.game[state.actor + 9]);
  const world = structuredClone(currentWorld);
  world.game.set([animation.frame, animation.delay, animation.mode], state.actor + 0x28);
  return { world, completedCallback: 0x4264c8 as const };
}

export function visitNativeAiProduction(configuration: NativeAiProductionConfiguration,
  currentWorld: NativeAiProductionWorld, visit: NativeAiProducerVisit) {
  const state = producer(configuration, currentWorld, visit);
  const { tables, actor, team, offset, unitType, count, ready } = state;
  const world = structuredClone(currentWorld), bytes = view(world.game);
  if (world.game[actor + 0x1a] !== 1) {
    const stand = world.game[actor + 6] * 280 + 0x80;
    if (bytes.getUint32(actor + 0x14, true) !== stand || world.game[actor + 0x1a] !== 0) {
      bytes.setUint32(actor + 0x14, stand, true);
      world.game.set([0, 0, 0], actor + 0x18);
    }
  }
  world.game[offset + 0x10c] = Math.max(0, world.game[offset + 0x10c] - 1);
  const result = (action: "idle" | "waiting" | "blocked" | "cap-refund" | "reserved" | "allocated", allocatedSlot: number | null = null) =>
    ({ world, phase: visit.phase, completedCallback: 0x414314 as const, action, team, queue: 0 as const,
      allocatedSlot, rngBefore: currentWorld.rngCursor, rngAfter: world.rngCursor });
  if (count === 0) return result("idle");
  const tileX = bytes.getInt32(offset + 0x2c, true), tileY = bytes.getInt32(offset + 0x30, true) - 3;
  requireProduction(integer(tileX, 0, world.width - 1) && integer(tileY, 0, world.height - 1), "exit outside source map");
  const cell = tileY * world.width + tileX, occupant = world.groundCells[cell] & 1023;
  const shiftQueue = () => {
    world.game.copyWithin(offset + 0x118, offset + 0x119, offset + 0x119 + count);
    bytes.setUint16(offset + 0x110, count - 1, true);
  };
  if (ready === 1) {
    if (occupant !== 1023) {
      requireProduction(occupant < 800, "blocked exit sentinel has no owned actor");
      world.game[0x7d28 + occupant * 220 + 0x35] = 0;
      return result("blocked");
    }
    if (world.game[offset + 0x10c] !== 0) return result("waiting");
    const cap = bytes.getInt32(0x528, true);
    requireProduction(integer(cap, 0, 800), "invalid current source population cap");
    if (world.populations[team] >= cap) {
      const cost = tables.records.find(entry => entry.rawFields[0] === 1 && entry.rawFields[1] === unitType)!.cost;
      bytes.setInt32(offset + 0x14, bytes.getInt32(offset + 0x14, true) + cost, true);
      bytes.setInt32(offset + 0x18, bytes.getInt32(offset + 0x18, true) - cost, true);
      bytes.setUint16(offset + 0xe2c, 119, true);
      shiftQueue();
      return result("cap-refund");
    }
    world.groundCells[cell] = ((world.groundCells[cell] & ~1023) | 1022) >>> 0;
    world.game[offset + 0x108] = 0;
    const bank = unitType * 280 + 0x98;
    if (bytes.getUint32(actor + 0x24, true) !== bank || world.game[actor + 0x2a] !== 1) {
      bytes.setUint32(actor + 0x24, bank, true);
      world.game.set([0, 0, 1], actor + 0x28);
    }
    return result("reserved");
  }
  requireProduction(bytes.getUint32(actor + 0x24, true) === unitType * 280 + 0x98
    && (world.game[actor + 0x2a] === 1 || world.game[actor + 0x2a] === 2), "unsupported active producer FIN");
  if (world.game[actor + 0x2a] === 1) return result("waiting");
  requireProduction(occupant === 1022, "lost native production exit reservation");
  requireProduction(tables.constructors, "completion requires authenticated source constructor provider");
  const highWater = bytes.getInt32(0x7d20, true);
  requireProduction(integer(highWater, 152, 798), "native freecount/high-water exhausted");
  for (let slot = 152; slot < highWater; slot++) requireProduction(world.game[0x7d28 + slot * 220 + 0x2c] !== 0,
    "reused constructor slots require retained-byte owner");
  const target = 0x7d28 + highWater * 220;
  requireProduction(world.game.subarray(target, target + 220).every((value, index) => index === 8 || value === 0)
    && bytes.getInt16(0x468ec + highWater * 2, true) === -1, "new constructor slot is not empty/unregistered");
  bytes.setInt32(0x7d20, highWater + 1, true);
  const constructed = constructNativeAiProductionActor(configuration, world, { phase: "constructor-41af14", slot: highWater,
    team, unitType: unitType as 0 | 8, tileX, tileY, expectedRaw: world.game.slice(target, target + 220) });
  world.game.set(constructed.world.game);
  world.groundCells.set(constructed.world.groundCells);
  shiftQueue();
  world.game[offset + 0x108] = 1;
  return result("allocated", highWater);
}

export function constructNativeAiProductionActor(configuration: NativeAiProductionConfiguration,
  currentWorld: NativeAiProductionWorld, input: Readonly<{
    phase: "constructor-41af14"; slot: number; team: number; unitType: 0 | 8;
    tileX: number; tileY: number; expectedRaw: Uint8Array;
  }>) {
  const tables = source(configuration);
  validateWorld(currentWorld);
  const { slot, team, unitType, tileX, tileY } = input, target = 0x7d28 + slot * 220;
  requireProduction(input.phase === "constructor-41af14" && integer(slot, 152, 798) && integer(team, 0, 7)
    && (unitType === 0 || unitType === 8) && integer(tileX, 0, currentWorld.width - 1)
    && integer(tileY, 0, currentWorld.height - 1) && input.expectedRaw.length === 220
    && currentWorld.game.subarray(target, target + 220).every((value, index) => value === input.expectedRaw[index]
      && (index === 8 || value === 0)), "unsupported/stale fresh constructor slot");
  requireProduction(tables.constructors, "authenticated source constructor provider required");
  const world = structuredClone(currentWorld), bytes = view(world.game), cell = tileY * world.width + tileX;
  requireProduction(bytes.getInt32(0x7d20, true) > slot && bytes.getInt16(0x468ec + slot * 2, true) === -1
    && [1022, 1023].includes(world.groundCells[cell] & 1023), "constructor allocation/registry/exit mismatch");
  const original = tables.constructors.profiles.find(profile => profile.typeId === unitType
    && profile.enemyMask === 0x40000000 >>> team);
  requireProduction(original && original.width === world.width && original.height === world.height,
    "missing same-map source constructor prototype");
  const profile = structuredClone(original), type = view(Uint8Array.from(profile.typeBytes));
  const stand = unitType * 280 + 0x80;
  const fin = { [stand]: profile.fin[type.getUint32(0x80, true)] };
  type.setUint32(0x80, stand, true);
  const primitive = new Uint8Array(220), primitiveView = view(primitive);
  primitiveView.setUint16(0, tileX * 256 + 128, true);
  primitiveView.setUint16(4, tileY * 256 + 128, true);
  primitiveView.setInt32(12, tables.units[unitType].health, true);
  primitive[6] = unitType; primitive[7] = team; primitive[0x2c] = 1;
  const raw = constructSourceNativeTaskActor([...primitive], { ...profile, typeBytes: [...new Uint8Array(type.buffer)], fin });
  raw[8] = currentWorld.game[target + 8];
  world.game.set(raw, target);
  bytes.setInt16(0x468ec + slot * 2, slot, true);
  world.groundCells[cell] = ((world.groundCells[cell] & ~1023) | slot) >>> 0;
  return { world, completedCallback: 0x41af14 as const, allocatedSlot: slot, raw: Uint8Array.from(raw),
    rngBefore: currentWorld.rngCursor, rngAfter: world.rngCursor };
}

export function computeNativeAiProductionPolicy(configuration: NativeAiProductionConfiguration,
  currentWorld: NativeAiProductionWorld, state: LegacyAiActiveState, inputs: LegacyAiFullPolicyInputs) {
  source(configuration);
  validateWorld(currentWorld);
  requireProduction(inputs.actorTransport === "synchronous" && integer(inputs.team, 0, 7)
    && state.rngCursor === currentWorld.rngCursor, "synchronous policy/current shared RNG required");
  const offset = side(inputs.team), bytes = view(currentWorld.game);
  requireProduction(inputs.teamBytes.length === 0xe30 && state.entities.length === 800 * 220
    && inputs.teamBytes.every((value, index) => value === currentWorld.game[offset + index])
    && state.entities.every((value, index) => value === currentWorld.game[0x7d28 + index])
    && inputs.population === currentWorld.populations[inputs.team]
    && inputs.populationLimit === bytes.getInt32(0x528, true)
    && inputs.groundCells.length === currentWorld.groundCells.length
    && inputs.groundCells.every((value, index) => value === currentWorld.groundCells[index]), "policy/current world disagreement");
  const candidate = structuredClone(state), stagedInputs = structuredClone(inputs);
  let world = structuredClone(currentWorld);
  const initialization = inputs.initialization.needed
    ? initializeLegacyAiPolicy(candidate, stagedInputs, inputs.initialization.ruleTable) : null;
  if (inputs.initialization.needed) {
    requireProduction(integer(inputs.initialization.policyAddress, 1, 0xffffffff), "invalid policy allocation address");
    view(stagedInputs.teamBytes).setUint32(0x28, inputs.initialization.policyAddress, true);
  }
  const pipeline = consumeLegacyAiPolicyPipeline(candidate, stagedInputs);
  requireProduction(pipeline.productionRequests.length <= 1, "multi-buy demand requires an in-action receipt owner");
  world.game.set(candidate.entities, 0x7d28);
  world.game.set(stagedInputs.teamBytes, offset);
  const productionReceipts: ReturnType<typeof receiveNativeAiPaidProduction>[] = [];
  for (const intent of pipeline.productionRequests) {
    requireProduction(intent.kind === "unit" && intent.count === 1, "CITY/other paid demand has no raw owner");
    const current = view(world.game);
    const receipt = receiveNativeAiPaidProduction(configuration, world, { phase: "ai-demand-prepaid-unit", team: inputs.team,
      dependency: intent.dependency, packet: intent.packet, creditsBefore: intent.creditsBefore, creditsAfter: intent.creditsAfter,
      expectedQueueLength: current.getUint16(offset + 0x110, true), expectedAccounting: current.getInt32(offset + 0x18, true) });
    productionReceipts.push(receipt);
    world = receipt.world;
    stagedInputs.teamBytes.set(world.game.subarray(offset, offset + 0xe30));
  }
  const afterDemand = { teamBytes: stagedInputs.teamBytes.slice(), entities: candidate.entities.slice(), rngCursor: candidate.rngCursor };
  const packets = pipeline.productionRequests.map(intent => ({ stage: "demand" as "demand" | 0 | 1 | 2 | 3, packet: intent.packet }));
  const record = (stage: 0 | 1 | 2 | 3, emitted: readonly Uint8Array[]) => {
    for (const packet of emitted) {
      applyLegacyAiActorPacket(candidate.entities, packet);
      packets.push({ stage, packet });
    }
  };
  const groupZero = consumeLegacyAiGroupZero(candidate, stagedInputs);
  record(0, groupZero.packets);
  const groupOne = consumeLegacyAiGroupOne(candidate, stagedInputs.rngTable);
  record(1, groupOne.packets);
  const groupTwo = consumeLegacyAiGroupTwo(candidate, stagedInputs);
  record(2, groupTwo.packets);
  const groupThree = consumeLegacyAiGroupThree(candidate, stagedInputs);
  record(3, groupThree.packets);
  world = { ...world, rngCursor: candidate.rngCursor };
  world.game.set(candidate.entities, 0x7d28);
  world.game.set(stagedInputs.teamBytes, offset);
  return { scope: "explicit-native-single-buy-policy" as const, admitted: false as const, world, candidate,
    initialization, pipeline, productionReceipts, afterDemand, packets, teamBytes: stagedInputs.teamBytes,
    groups: [groupZero, groupOne, groupTwo, groupThree], completedCallback: 0x44be40 as const };
}

export type NativeAiProductionReplayInput =
  | { kind: "paid-receipt"; receipt: Omit<NativeAiPaidUnitReceipt, "packet"> & { packet: number[] } }
  | { kind: "producer" | "secondary-fin"; visit: Omit<NativeAiProducerVisit, "expectedRaw"> & { expectedRaw: number[] } };

function encodeWorld(world: NativeAiProductionWorld) {
  return { ...world, game: [...world.game], groundCells: [...world.groundCells], populations: [...world.populations] };
}

export function checkpointNativeAiProduction(configuration: NativeAiProductionConfiguration,
  initial: NativeAiProductionWorld, inputs: readonly NativeAiProductionReplayInput[]) {
  source(configuration);
  validateWorld(initial);
  let world = structuredClone(initial);
  for (const input of inputs) {
    if (input.kind === "paid-receipt") {
      requireProduction(input.receipt.packet.every(value => integer(value, 0, 255)), "invalid checkpoint packet bytes");
      world = receiveNativeAiPaidProduction(configuration, world, { ...input.receipt, packet: Uint8Array.from(input.receipt.packet) }).world;
    } else {
      requireProduction((input.kind === "producer" || input.kind === "secondary-fin")
        && input.visit.expectedRaw.every(value => integer(value, 0, 255)), "invalid checkpoint producer bytes/kind");
      const visit = { ...input.visit, expectedRaw: Uint8Array.from(input.visit.expectedRaw) };
      world = input.kind === "producer" ? visitNativeAiProduction(configuration, world, visit).world
        : advanceNativeAiProductionFin(configuration, world, visit).world;
    }
  }
  return { kind: "native-ai-production-checkpoint-v1" as const, sourceId: configuration.sourceId,
    initial: encodeWorld(initial), inputs: structuredClone(inputs), current: encodeWorld(world) };
}

export function restoreNativeAiProduction(configuration: NativeAiProductionConfiguration,
  initial: NativeAiProductionWorld, checkpoint: ReturnType<typeof checkpointNativeAiProduction>) {
  source(configuration);
  requireProduction(checkpoint.kind === "native-ai-production-checkpoint-v1" && checkpoint.sourceId === configuration.sourceId
    && JSON.stringify(checkpoint.initial) === JSON.stringify(encodeWorld(initial)), "checkpoint external source/initial boundary mismatch");
  const replay = checkpointNativeAiProduction(configuration, initial, checkpoint.inputs);
  requireProduction(JSON.stringify(replay) === JSON.stringify(checkpoint), "checkpoint production replay mismatch");
  return { checkpoint: replay, world: { ...replay.current, game: Uint8Array.from(replay.current.game),
    groundCells: Uint32Array.from(replay.current.groundCells) } satisfies NativeAiProductionWorld };
}
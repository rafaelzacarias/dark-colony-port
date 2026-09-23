import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CAMPAIGN_AI_SOURCE_SHA256, transactCampaignAiProduction, validateCampaignAiSession,
  type CampaignAiConfiguration, type CampaignAiSessionRequest, type CampaignAiTransactionState } from "../../src/engine/campaign-ai";
import { CampaignSession, type CampaignSessionInput, type CampaignSessionOptions } from "../../src/engine/campaign-session";
import { applyLegacyAiActorPacket } from "../../src/engine/legacy-ai-policy";
import { advanceTransportHost, receiveTransportHostAiPolicy, stepTransportHost, transportHostState } from "../../src/engine/transport-host";
import { parseTriggerScript } from "../extractors/data/triggers";
import { parseDependencies, parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { parseScenario } from "../extractors/data/scenario";
import type { ProductionSourceProfile, ProductionUnitSource } from "../../src/engine/campaign-production";
import type { ResourceHostOptions, ResourceHostBinding } from "../../src/engine/transport-host";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(`raw_cd/DC/${path}`, root));
const native = (script: string, input?: unknown) => execFileSync("python3", ["-B", new URL(script, root).pathname], {
  cwd: root, encoding: "utf8", maxBuffer: 96 * 1024 * 1024, input: input === undefined ? undefined : JSON.stringify(input),
  env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
});
const decode = (value: string) => new Uint8Array(Buffer.from(value, "base64"));
const data = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const units = parseUnitStats(read("GAMESTAT/GAMESTAT.TXT").toString());
const weapons = parseWeaponStats(read("GAMESTAT/WEAPSTAT.TXT").toString());
const records = parseDependencies(read("GAMESTAT/DEPEND.TXT").toString());
type Golden = { label: string; team: number; race: 0 | 1; forceOrder: number;
  before: { policy: string; entities: string; teamBytes: string };
  inputs: { types: string; weapons: string; dependencies: string; cityDependencies: number[]; matrix: number[][];
    relations: number[]; visibilityMasks: number[]; occupancy: number[] } };
const proof: { demands: Golden[] } = JSON.parse(native("tools/qa/campaign-ai-native.py"));
const sources: { mission: string; neighbors: string; rngTable: number[]; ruleTable: string; policyAddress: number;
  navigation: { width: number; height: number; families: string; nextFamily: string } }[] =
  native("tools/research/ai-full-policy-20260919.py").trim().split("\n").map(line => JSON.parse(line));
const clocks: { units: ProductionUnitSource[]; cases: { profile: ProductionSourceProfile;
  trace: { frame: number; delay: number; mode: number; ready: number; count: number }[] }[] } =
  JSON.parse(native("tools/qa/campaign-production-session-native.py"));

function fixture(race: 0 | 1, actorTransport: "deferred" | "synchronous", troop = false) {
  const golden = proof.demands.find(entry => entry.race === race)!;
  const source = sources.find(entry => golden.label.startsWith(entry.mission))!;
  const teamBytes = decode(golden.before.teamBytes), bytes = data(teamBytes), originalActors = decode(golden.before.entities);
  bytes.setUint32(0x28, 0, true);
  const actors = data(originalActors);
  const placementRows = [152, 153].map(slot => [actors.getUint16(slot * 220, true) >>> 8,
    actors.getUint16(slot * 220 + 4, true) >>> 8, originalActors[slot * 220 + 6], golden.team, actors.getInt32(slot * 220 + 12, true)]);
  if (troop) placementRows.push([60, 60, race * 8 + 2, golden.team, units[race * 8 + 2].health]);
  const original = parseScenario(read("SCENARIO/HUMAN/HUMAN02.SCN").toString());
  const restrictions = Array.from({ length: 110 }, (_, index) => index).filter(index => teamBytes[0xda4 + index] !== 0);
  const options: CampaignSessionOptions = { sessionId: `full-${race}-${actorTransport}-${troop}`, units, weapons, triggers: [], messages: [],
    source: { ...original, placementRows, teams: original.teams.map(team => ({ ...team, race, money: 1000,
      coordinateRows: [[0, 0], team.index === golden.team ? [50, 50] : [0, 0]], cityRows: [[1, 100, 1, 100, 0, 0, 0, 0, 0, 0]] })) },
    map: { width: source.navigation.width, height: source.navigation.height }, pathGrid: decode(source.navigation.families),
    tags: new Uint8Array(source.navigation.width * source.navigation.height),
    commanders: [{ team: golden.team, unitType: race === 0 ? 69 : 73, sprite: race === 0 ? "TRSC" : "GRAY" }],
    directionBits: Array.from({ length: 64 }, () => [0, 0] as const), fixedStepMilliseconds: 16, orientationSteps: 1,
    production: { records, units: clocks.units, sourceProfiles: [clocks.cases[race].profile],
      teams: [{ team: golden.team, race, credits: 1000, costAccumulator: 17, base: { x: 50, y: 50 }, restrictions, upgrades: [],
        slots: Array.from({ length: 5 }, (_, slot) => ({ health: bytes.getInt32(0x3c + slot * 4, true),
          level: bytes.getInt32(0xc4 + slot * 4, true), busy: 0 })), producerDelays: [0, 0, 0, 0] }] } };
  const initial = new CampaignSession(options).snapshot;
  for (const slot of [152, 153]) {
    const actor = transportHostState(initial.world).slots[slot]!;
    assert.equal(actor.unitType, originalActors[slot * 220 + 6]);
    assert.deepEqual(actor.position, { x: actors.getUint16(slot * 220, true), y: actors.getUint16(slot * 220 + 4, true) });
  }
  const observation = { entities: [...initial.world.entityBytes!], forceOrder: golden.forceOrder, population: placementRows.length,
    populationLimit: 10, relations: golden.inputs.relations, visibilityMasks: golden.inputs.visibilityMasks,
    occupancy: transportHostState(initial.world).ground.map(slot => slot < 0 ? 1023 : slot) };
  const campaignAi: CampaignAiConfiguration = { scope: "source-separated-bounded", sourceId: options.sessionId,
    sourceSha256: CAMPAIGN_AI_SOURCE_SHA256, team: golden.team,
    sources: { cityDependencies: golden.inputs.cityDependencies, matrix: golden.inputs.matrix,
      types: [...decode(golden.inputs.types)], weapons: [...decode(golden.inputs.weapons)],
      dependencies: [...decode(golden.inputs.dependencies)], navigation: { ...source.navigation,
        families: [...decode(source.navigation.families)], nextFamily: [...decode(source.navigation.nextFamily)] } },
    fullPolicy: { neighbors: [...decode(source.neighbors)], rngTable: source.rngTable, ruleTable: [...decode(source.ruleTable)],
      policyAddress: source.policyAddress, actorTransport },
    initial: { ...observation, policy: Array(0x6c40).fill(0), teamBytes: [...teamBytes], rngCursor: 0 } };
  const request: CampaignAiSessionRequest = { id: "whole:0", sequence: 0, stage: "full-policy", sourceId: campaignAi.sourceId, observation };
  return { options: { ...options, campaignAi }, request, race, golden };
}

function input(session: CampaignSession, extra: Partial<CampaignSessionInput> = {}): CampaignSessionInput {
  const state = session.snapshot;
  return { clockMilliseconds: (state.cycleCounter + 1) * 16, productionVisits: [{ team: state.production!.teams[0].team,
    queue: 0, population: 2, populationLimit: 10 }], ...extra };
}

function transactionState(session: CampaignSession, config: CampaignAiConfiguration): CampaignAiTransactionState {
  const snapshot = session.snapshot, state = snapshot.campaignAi!, buffers = state.buffers;
  return { scope: config.scope, fullPolicy: config.fullPolicy, receipts: state.history.map(record => record.receipt),
    production: snapshot.production!, world: snapshot.world,
    ai: { policy: Uint8Array.from(buffers.policy), entities: Uint8Array.from(buffers.entities), forceOrder: buffers.forceOrder,
      rngCursor: buffers.rngCursor, navigation: { ...config.sources.navigation,
        families: Uint8Array.from(config.sources.navigation.families), nextFamily: Uint8Array.from(config.sources.navigation.nextFamily) } },
    inputs: { ...config.sources, ...buffers, team: config.team, teamBytes: Uint8Array.from(buffers.teamBytes),
      types: Uint8Array.from(config.sources.types), weapons: Uint8Array.from(config.sources.weapons),
      dependencies: Uint8Array.from(config.sources.dependencies), relations: Uint8Array.from(buffers.relations) } };
}

function independentIntegrity(receipt: object): string {
  const quote = (value: string) => JSON.stringify(value).replace(/[\u007f-\uffff]/g,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
  const canonical = (value: any): string => {
    if (typeof value === "string") return quote(value);
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    return `{${Object.keys(value).sort().map(key => `${quote(key)}:${canonical(value[key])}`).join(",")}}`;
  };
  return createHash("sha256").update(canonical(Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== "integrity"))), "ascii").digest("hex");
}

test("full receipt integrity rejects each reviewer contradiction before duplicate and history validation", () => {
  const { options, request } = fixture(0, "deferred", true), session = new CampaignSession(options);
  const command = { id: request.id, sequence: request.sequence, stage: request.stage };
  const result = transactCampaignAiProduction(transactionState(session, options.campaignAi), command);
  if (!result.ok) assert.fail(result.message);
  const paid = result.state, full = paid.receipts[0].fullPolicy!.computation;
  assert.equal(paid.receipts[0].integrity, independentIntegrity(paid.receipts[0]));
  assert.equal(full.groups.length, 4);
  assert.ok(full.packets.some(packet => packet.kind === "production"));
  assert.ok(full.packets.some(packet => packet.kind === "actor-order"));
  assert.equal(paid.receipts[0].fullPolicy!.disposition, "pending-native-task-hand-off");
  assert.equal(transactCampaignAiProduction(structuredClone(paid), command).ok, true);
  const mutations: [string, (receipt: any) => void][] = [
    ["packet", receipt => { receipt.fullPolicy.computation.packets.find((packet: any) => packet.kind === "production").packet[3] ^= 8; }],
    ["candidate", receipt => { receipt.fullPolicy.computation.candidate.policy[0] ^= 1; }],
    ["groups", receipt => { receipt.fullPolicy.computation.groups = []; }],
    ["rng", receipt => { receipt.fullPolicy.computation.rngDraws++; }],
    ["disposition", receipt => { receipt.fullPolicy.disposition = "receipted"; }],
    ["null native", receipt => { receipt.fullPolicy.computation.pipeline.productionRequests[0] = null; }],
    ["readiness", receipt => { receipt.fullPolicy.computation.readyWholeCall = false; }],
    ["admission", receipt => { receipt.fullPolicy.computation.admitted = true; }],
    ["group packet count", receipt => { receipt.fullPolicy.computation.groups.find((group: any) => group.packets.length).packets.pop(); }],
    ["missing native", receipt => { delete receipt.fullPolicy.computation.pipeline.productionRequests[0]; }],
    ["sparse candidate", receipt => { delete receipt.fullPolicy.computation.candidate.policy[0]; }],
    ["sparse groups", receipt => { delete receipt.fullPolicy.computation.groups[0]; }],
    ["sparse packet", receipt => { delete receipt.fullPolicy.computation.packets[0].packet[0]; }],
    ["unsealed", receipt => { delete receipt.integrity; }],
  ];
  for (const [label, mutate] of mutations) {
    const copy = structuredClone(paid);
    mutate(copy.receipts[0]);
    const before = structuredClone(copy);
    for (const next of [command, { ...command, id: "whole:1", sequence: 1 }]) {
      const rejected = transactCampaignAiProduction(copy, next);
      assert.equal(rejected.ok, false, label);
      if (!rejected.ok) assert.match(rejected.message, /receipt|Sparse/i, label);
      assert.deepEqual(copy, before, label);
    }
  }
  for (const [label, mutate] of mutations.filter(([label]) =>
    ["packet", "groups", "rng", "disposition", "null native", "readiness", "admission", "group packet count"].includes(label))) {
    const copy = structuredClone(paid);
    mutate(copy.receipts[0]);
    (copy.receipts[0] as { integrity: string }).integrity = independentIntegrity(copy.receipts[0]);
    const before = structuredClone(copy), rejected = transactCampaignAiProduction(copy, command);
    assert.equal(rejected.ok, false, `matching digest: ${label}`);
    if (!rejected.ok) assert.doesNotMatch(rejected.message, /integrity mismatch/, label);
    assert.deepEqual(copy, before, label);
  }
});

test("full receipt integrity source restore recomputes legacy receipts and rejects coherent resealing", () => {
  const { options, request } = fixture(0, "deferred", true), session = new CampaignSession(options);
  assert.equal(session.step(input(session, { campaignAiRequest: request })).ok, true);
  const saved = JSON.parse(JSON.stringify(session.checkpoint()));
  for (const integrity of ["", "A".repeat(64), "0".repeat(64), 1, null]) {
    const malformed = structuredClone(saved);
    malformed.state.campaignAi.history[0].receipt.integrity = integrity;
    assert.throws(() => CampaignSession.restore(malformed, options.campaignAi), /receipt|integrity/i);
  }
  const legacy = structuredClone(saved);
  delete legacy.state.campaignAi.history[0].receipt.integrity;
  const pristine = structuredClone(legacy);
  assert.throws(() => CampaignSession.restore(legacy), /expected source configuration/);
  const restored = CampaignSession.restore(legacy, options.campaignAi);
  assert.deepEqual(legacy, pristine);
  assert.deepEqual(restored.checkpoint(), saved);
  assert.equal(restored.step(input(restored, { campaignAiRequest: request })).ok, true);
  assert.deepEqual(restored.checkpoint(), saved);
  const snapshot = session.snapshot;
  const legacyState = structuredClone(snapshot.campaignAi!);
  delete (legacyState.history[0].receipt as { integrity?: string }).integrity;
  const normalized = validateCampaignAiSession(legacyState, options.campaignAi, snapshot.production!, snapshot.world);
  assert.equal(legacyState.history[0].receipt.integrity, undefined);
  assert.deepEqual(normalized, snapshot.campaignAi);
  for (const seal of [false, true]) {
    const copy = structuredClone(legacy);
    const receipt = copy.state.campaignAi.history[0].receipt;
    receipt.fullPolicy.computation.candidate.policy[0] ^= 1;
    if (seal) receipt.integrity = independentIntegrity(receipt);
    assert.throws(() => CampaignSession.restore(copy, options.campaignAi), /differs from native computation/);
  }
  const malformed = structuredClone(legacy);
  malformed.state.campaignAi.history[0].receipt.fullPolicy.computation.candidate.policy =
    { ...malformed.state.campaignAi.history[0].receipt.fullPolicy.computation.candidate.policy };
  assert.throws(() => CampaignSession.restore(malformed, options.campaignAi), /differs from native computation/);
});

test("full receipt integrity canonical ASCII JSON is independent of recursive property order", () => {
  const { options, request } = fixture(0, "deferred", true), session = new CampaignSession(options);
  const command = { id: `${request.id}:\u00e9:\ud83d\ude80:\n:\\`, sequence: request.sequence, stage: request.stage };
  const applied = transactCampaignAiProduction(transactionState(session, options.campaignAi), command);
  if (!applied.ok) assert.fail(applied.message);
  const receipt = applied.state.receipts[0];
  assert.equal(receipt.integrity, independentIntegrity(receipt));
  const reverseKeys = (value: any): any => value === null || typeof value !== "object" ? value
    : Array.isArray(value) ? value.map(reverseKeys)
      : Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)]));
  const copied = { ...structuredClone(applied.state), receipts: [reverseKeys(JSON.parse(JSON.stringify(receipt)))] };
  const retried = transactCampaignAiProduction(copied, command);
  assert.equal(retried.ok, true);
  if (retried.ok) assert.equal(retried.disposition, "duplicate");
});

for (const race of [0, 1] as const) for (const timing of ["deferred", "synchronous"] as const) {
  test(`full session race ${race} ${timing}: actual constructor pool, initialization, native packets and durable receipt`, () => {
    const { options, request } = fixture(race, timing, true), session = new CampaignSession(options);
    const before = session.checkpoint();
    const result = session.step(input(session, { campaignAiRequest: request }));
    if (!result.ok) assert.fail(JSON.stringify(result.diagnostics));
    const receipt = result.value.entry.campaignAiReceipt!;
    const full = receipt.fullPolicy!.computation;
    const oracle: { sha256: string; computed: { policy: string; entities: string; teamBytes: string; rngCursor: number; forceOrder: number };
      received: { entities: string; teamBytes: string }; packets: { stage: string | number; packet: string }[];
      rngEvents: number[]; allocations: number[] } = JSON.parse(native("tools/qa/campaign-ai-full-policy-native.py", {
      config: options.campaignAi, buffers: options.campaignAi.initial, mission: proof.demands.find(entry => entry.race === race)!.label.slice(0, 7),
    }));
    assert.equal(oracle.sha256, CAMPAIGN_AI_SOURCE_SHA256);
    assert.deepEqual(full.candidate.policy, [...decode(oracle.computed.policy)]);
    assert.deepEqual(full.candidate.entities, [...decode(oracle.computed.entities)]);
    assert.deepEqual(full.teamBytes, [...decode(oracle.computed.teamBytes)]);
    assert.deepEqual([full.candidate.rngCursor, full.candidate.forceOrder, full.rngDraws],
      [oracle.computed.rngCursor, oracle.computed.forceOrder, oracle.rngEvents.length]);
    assert.deepEqual(full.packets.map(packet => ({ stage: packet.stage, packet: Buffer.from(packet.packet).toString("hex") })), oracle.packets);
    assert.deepEqual(oracle.allocations, [options.campaignAi.fullPolicy!.policyAddress]);
    assert.equal(full.readyWholeCall, true);
    assert.equal(full.runtimeReady, false);
    assert.ok(full.initialization);
    assert.deepEqual(full.groupOrder, [0, 1, 2, 3]);
    assert.equal(receipt.intents.length, 1);
    assert.equal(result.value.world.exomoney[options.campaignAi.team], 650);
    const actors = full.packets.filter(packet => packet.kind === "actor-order");
    assert.ok(actors.length > 0, "must exercise actual pending actor receipt");
    assert.ok(actors.flatMap(packet => packet.orders).some(order => order.mode === 5));
    assert.ok(actors.flatMap(packet => packet.orders).some(order => order.mode === 7 && order.slots.length > 0));
    const expected = Uint8Array.from(full.candidate.entities);
    if (timing === "deferred") for (const packet of actors) applyLegacyAiActorPacket(expected, Uint8Array.from(packet.packet));
    assert.deepEqual(result.value.world.entityBytes, expected);
    assert.deepEqual(expected, decode(oracle.received.entities));
    const receivedTeam = data(decode(oracle.received.teamBytes));
    assert.equal(result.value.production!.teams[0].costAccumulator, receivedTeam.getInt32(0x18, true));
    assert.equal(result.value.production!.teams[0].queues[0].items.length, receivedTeam.getUint16(0x110, true));
    assert.deepEqual(result.value.campaignAi!.buffers.entities, [...expected]);
    assert.equal(receipt.fullPolicy!.disposition, "pending-native-task-hand-off");
    const host = transportHostState(result.value.world);
    assert.ok(host.slots.some(actor => actor?.pendingNativeAi?.receiptId === request.id), JSON.stringify(actors));
    const saved = session.checkpoint();
    assert.notDeepEqual(saved, before);
    const restored = CampaignSession.restore(JSON.parse(JSON.stringify(saved)), options.campaignAi);
    assert.deepEqual(restored.snapshot, session.snapshot);
    const retried = restored.step(input(restored, { campaignAiRequest: request }));
    assert.equal(retried.ok, true);
    assert.deepEqual(restored.checkpoint(), saved);
    const blocked = restored.step(input(restored));
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.match(JSON.stringify(blocked.diagnostics), /pending-native-task-hand-off/);
    assert.equal(stepTransportHost(restored.snapshot.world).ok, false);
    for (const milliseconds of [0, 1, 15, 16]) {
      const world = restored.snapshot.world;
      const before = structuredClone(world);
      assert.equal(advanceTransportHost(world, milliseconds).ok, false);
      assert.deepEqual(world, before);
    }
    assert.deepEqual(restored.checkpoint(), saved);
  });
}

test("full profile rejects detached pools, stale observations and missing RNG/source ownership atomically", () => {
  const { options, request } = fixture(0, "deferred");
  const detached = structuredClone(options);
  (detached.campaignAi.initial.entities as number[])[152 * 220 + 7] ^= 1;
  assert.throws(() => new CampaignSession(detached), /shared world entityBytes/);
  const session = new CampaignSession(options), before = session.checkpoint();
  const stale = structuredClone(request);
  (stale.observation.entities as number[])[153 * 220 + 0xd2] ^= 1;
  const result = session.step(input(session, { campaignAiRequest: stale }));
  assert.equal(result.ok, false);
  assert.deepEqual(session.checkpoint(), before);
  const noRng = structuredClone(options);
  delete (noRng.campaignAi.initial as { rngCursor?: number }).rngCursor;
  assert.throws(() => new CampaignSession(noRng), /RNG cursor/);
});

for (const race of [0, 1] as const) test(`full race ${race}: empty recipients permit native FIN completion and retry after actual spawn`, () => {
  const { options, request } = fixture(race, "deferred"), session = new CampaignSession(options);
  const first = session.step(input(session, { campaignAiRequest: request }));
  if (!first.ok) assert.fail(JSON.stringify(first.diagnostics));
  assert.equal(first.value.entry.campaignAiReceipt!.fullPolicy!.disposition, "receipted");
  assert.equal(first.value.entry.campaignAiReceipt!.intents.length, 1);
  const rngCursor = first.value.campaignAi!.buffers.rngCursor;
  for (const [index, expected] of clocks.cases[race].trace.entries()) {
    if (index > 0) {
      const next = session.step(input(session));
      if (!next.ok) assert.fail(JSON.stringify(next.diagnostics));
    }
    const queue = session.snapshot.production!.teams[0].queues[0];
    assert.deepEqual([queue.animation!.frame, queue.animation!.delay, queue.animation!.mode, queue.ready, queue.items.length],
      [expected.frame, expected.delay, expected.mode, expected.ready, expected.count]);
  }
  const created = transportHostState(session.snapshot.world).requests.filter(event => event.type === "create");
  assert.deepEqual(created, [{ type: "create", slot: 154, generation: 0, team: options.campaignAi.team, unitType: race * 8,
    position: { x: 50 * 256 + 128, y: 47 * 256 + 128 } }]);
  const owner = transactionState(session, options.campaignAi);
  const copiedOwner = { ...structuredClone(owner), receipts: JSON.parse(JSON.stringify(owner.receipts)) };
  const retriedOwner = transactCampaignAiProduction(copiedOwner, { id: request.id, sequence: request.sequence, stage: request.stage });
  assert.equal(retriedOwner.ok, true);
  if (retriedOwner.ok) {
    assert.equal(retriedOwner.disposition, "duplicate");
    assert.deepEqual(retriedOwner.state, copiedOwner);
  }
  const legacy = JSON.parse(JSON.stringify(session.checkpoint()));
  delete legacy.state.campaignAi.history[0].receipt.integrity;
  assert.deepEqual(CampaignSession.restore(legacy, options.campaignAi).snapshot, session.snapshot);
  assert.deepEqual([data(session.snapshot.world.entityBytes!).getInt16(154 * 220 + 0xd2, true),
    data(session.snapshot.world.entityBytes!).getInt16(154 * 220 + 0xd4, true)], [-2, -2]);
  const restored = CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint())), options.campaignAi);
  const retried = restored.step(input(restored, { campaignAiRequest: request }));
  if (!retried.ok) assert.fail(JSON.stringify(retried.diagnostics));
  assert.equal(retried.value.campaignAi!.history.length, 1);
  assert.equal(retried.value.campaignAi!.buffers.rngCursor, rngCursor);
  assert.equal(retried.value.production!.teams[0].credits, 650);
  assert.equal(retried.value.production!.teams[0].costAccumulator, 367);
  assert.equal(transportHostState(retried.value.world).requests.filter(event => event.type === "create").length, 1);
  assert.deepEqual(CampaignSession.restore(JSON.parse(JSON.stringify(restored.checkpoint())), options.campaignAi).snapshot, restored.snapshot);
});

test("full caller replay rejects raw receipt, host ownership, packet, RNG, initialization and input tampering", () => {
  const { options, request } = fixture(0, "synchronous", true), session = new CampaignSession(options);
  assert.equal(session.step(input(session, { campaignAiRequest: request })).ok, true);
  const saved = session.checkpoint();
  const mutations: ((copy: any) => void)[] = [
    copy => { copy.state.campaignAi.history[0].receipt.fullPolicy.computation.candidate.policy[0] ^= 1; },
    copy => { copy.state.campaignAi.history[0].receipt.fullPolicy.computation.candidate.rngCursor ^= 1; },
    copy => { copy.state.campaignAi.history[0].receipt.fullPolicy.computation.groups.reverse(); },
    copy => { copy.state.campaignAi.history[0].receipt.fullPolicy.computation.packets.reverse(); },
    copy => { copy.state.campaignAi.history[0].receipt.fullPolicy.computation.initialization = null; },
    copy => { copy.state.campaignAi.history[0].receipt.fullPolicy.disposition = "receipted"; },
    copy => { copy.state.world.transportState.slots.forEach((actor: any) => { if (actor) delete actor.pendingNativeAi; }); },
    copy => { copy.state.world.entityBytes[154 * 220 + 0xa6] ^= 1;
      copy.state.campaignAi.buffers.entities[154 * 220 + 0xa6] ^= 1; },
    copy => { copy.state.campaignAiInputs = []; },
    copy => { copy.state.campaignAiInputs[0].campaignAiRequest.observation.entities[154 * 220 + 0xd2] ^= 1; },
    copy => { copy.state.campaignAi.buffers.forceOrder ^= 1; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const copy = JSON.parse(JSON.stringify(saved)); mutate(copy);
    assert.throws(() => CampaignSession.restore(copy, options.campaignAi), `full replay tamper ${index}`);
  }
});

test("full unsupported mode 9 preserves the entire session input and all pending state", () => {
  const original = fixture(0, "deferred", true), team = original.options.campaignAi.team;
  const beforeTeam = Uint8Array.from(original.options.campaignAi.initial.teamBytes);
  data(beforeTeam).setInt32(0x14, 100000, true);
  data(beforeTeam).setInt32(0x3c, 0, true);
  const base: CampaignSessionOptions = { ...original.options, campaignAi: undefined,
    source: { ...original.options.source, teams: original.options.source.teams.map(source => source.index !== team ? source : {
      ...source, money: 100000, cityRows: [[1, 0, 1, 100, 0, 0, 0, 0, 0, 0]] }) },
    production: { ...original.options.production!, teams: original.options.production!.teams.map(source => ({ ...source,
      credits: 100000, slots: source.slots.map((slot, index) => index === 0 ? { ...slot, health: 0 } : slot) })) } };
  const world = new CampaignSession(base).snapshot.world;
  const campaignAi = { ...original.options.campaignAi, initial: { ...original.options.campaignAi.initial,
    entities: [...world.entityBytes!], teamBytes: [...beforeTeam] } };
  const session = new CampaignSession({ ...base, campaignAi }), before = session.checkpoint();
  const request = { ...original.request, observation: { ...original.request.observation, entities: [...world.entityBytes!] } };
  const stepInput = input(session, { campaignAiRequest: request }), pristine = structuredClone(stepInput);
  const result = session.step(stepInput);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(JSON.stringify(result.diagnostics), /unsupported-city.*Mode 9/);
  assert.deepEqual(stepInput, pristine);
  assert.deepEqual(session.checkpoint(), before);
});

test("late session failure rolls back full policy, RNG, actor receipts, source initialization and prepaid queue", () => {
  const { options, request } = fixture(0, "deferred", true);
  const session = new CampaignSession({ ...options, triggers: parseTriggerScript("1 norm 1 (c==0)\nmsg 2 0 29 3 8\nend") });
  for (let tick = 0; tick < 7; tick += 1) assert.equal(session.step(input(session)).ok, true);
  const before = session.checkpoint(), journal = session.journal;
  const result = session.step(input(session, { campaignAiRequest: request }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(JSON.stringify(result.diagnostics), /Missing message 29/);
  assert.deepEqual(session.checkpoint(), before);
  assert.deepEqual(session.journal, journal);
});

test("native receiver rejects late stale identities and malformed packets without partial raw writes", () => {
  const { options } = fixture(0, "deferred", true), world = new CampaignSession(options).snapshot.world;
  const before = structuredClone(world);
  const accepted = Uint8Array.of(7, 0, 5, 154, 0, 13, 0);
  for (const rejected of [Uint8Array.of(7, 0, 5, 31, 3, 13, 0), Uint8Array.of(7, 0, 5, 154, 0, 13, 9)]) {
    assert.throws(() => receiveTransportHostAiPolicy(world, world.entityBytes!, [accepted, rejected], "late", "deferred"));
    assert.deepEqual(world, before);
  }
});

test("full caller reconciles full32 resource income, player pending and one native debit through nested restore", () => {
  type ResourceEntity = { direction: number; pendingOrder: number; order: number; taskWords: number[]; type: number; hp: number;
    animation: { bank: number; frame: number; delay: number; mode: 0 | 1 | 2 | 3 } };
  const trace: { cases: { race: number; trace: { source: ResourceEntity; extractor: ResourceEntity }[];
    animations: ResourceHostOptions["animations"]; profiles: { bindings: { unitType: number; standBank: number; deployBank: number;
      deathBank: number; deathVariants: number; removalHoldField: number; selectedWeapon: number }[] } }[] } =
    JSON.parse(native("tools/research/resource-lifecycle-20260919.py"));
  const evidence = trace.cases.find(entry => entry.race === 0)!, initial = evidence.trace[0];
  const source = fixture(0, "deferred"), team = source.options.campaignAi.team;
  const bind = (entity: ResourceEntity, slot: number): ResourceHostBinding => ({ slot, generation: 0, state: {
    direction: entity.direction, pendingOrder: entity.pendingOrder, order: entity.order,
    animation: { profile: String(entity.animation.bank), frame: entity.animation.frame, delay: entity.animation.delay, mode: entity.animation.mode },
    stack: [{ opcode: 1, words: entity.taskWords.slice(0, 3) }], released: false } });
  const base: CampaignSessionOptions = { ...source.options, campaignAi: undefined, source: { ...source.options.source,
    teams: source.options.source.teams.map(entry => entry.index === team ? { ...entry, money: 100000 } : entry),
    placementRows: [...source.options.source.placementRows, [60, 60, 40, 22, 10000], [60, 60, initial.extractor.type, team, initial.extractor.hp]] },
    production: { ...source.options.production!, teams: source.options.production!.teams.map(entry => ({ ...entry, credits: 100000 })) },
    resourceScales: { rateScale: 256, reserveScale: 256 }, resourceInitialIncome: Array(8).fill(70000),
    resourceLifecycle: { animations: evidence.animations, types: evidence.profiles.bindings.map(profile => ({ unitType: profile.unitType,
      stand: String(profile.standBank), deploy: String(profile.deployBank), death: String(profile.deathBank),
      deathVariants: profile.deathVariants, removalHoldField: profile.removalHoldField, selectedWeapon: profile.selectedWeapon | 0 })),
      bindings: [bind(initial.source, 154), bind(initial.extractor, 155)] } };
  const seed = new CampaignSession(base).snapshot, teamBytes = Uint8Array.from(source.options.campaignAi.initial.teamBytes);
  data(teamBytes).setInt32(0x14, 100000, true);
  const campaignAi: CampaignAiConfiguration = { ...source.options.campaignAi, initial: { ...source.options.campaignAi.initial,
    entities: [...seed.world.entityBytes!], teamBytes: [...teamBytes] } };
  const options = { ...base, campaignAi }, session = new CampaignSession(options);
  const dependency = records.find(entry => entry.rawFields[0] === 1 && entry.rawFields[1] === 0)!.id;
  const resourceFrameSource = { teams: options.source.teams.map(({ index }) => ({ index, ai: 0 })),
    aiMultipliers: Array(8).fill(256), localTeam: team, cancellationGate: 0 };
  for (let tick = 0; tick < 25; tick += 1) {
    const result = session.step(input(session, { resourceFrameSource, ...(tick === 0 ? { productionCommands: [{ id: "player-pending",
      team, action: { type: "reserve" as const, dependency } }] } : {}) }));
    if (!result.ok) assert.fail(JSON.stringify(result.diagnostics));
  }
  const restoredBeforeAi = CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint())), campaignAi);
  const preview = session.fork(), nextInput = input(preview, { resourceFrameSource });
  const previewResult = preview.step(nextInput);
  if (!previewResult.ok) assert.fail(JSON.stringify(previewResult.diagnostics));
  const request: CampaignAiSessionRequest = { ...source.request, observation: { ...source.request.observation,
    entities: [...previewResult.value.world.entityBytes!], population: 3,
    occupancy: transportHostState(previewResult.value.world).ground.map(slot => slot < 0 ? 1023 : slot) } };
  const result = session.step({ ...nextInput, campaignAiRequest: request });
  if (!result.ok) assert.fail(JSON.stringify(result.diagnostics));
  assert.deepEqual(restoredBeforeAi.step({ ...nextInput, campaignAiRequest: request }), result);
  const state = result.value, earned = state.world.statistics[`${team},1`] - 70000;
  assert.ok(earned > 0);
  assert.equal(state.entry.campaignAiReceipt!.intents.length, 1);
  assert.equal(state.world.exomoney[team], 100000 + earned - 700);
  assert.equal(state.production!.teams[0].credits, state.world.exomoney[team]);
  assert.equal(data(Uint8Array.from(state.campaignAi!.buffers.teamBytes)).getInt32(0x14, true), state.world.exomoney[team]);
  assert.equal(state.production!.teams[0].pending[dependency], 1);
  assert.equal(state.production!.teams[0].costAccumulator, 367);
  const restored = CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint())), campaignAi);
  assert.deepEqual(restored.snapshot, session.snapshot);
  const actor = transportHostState(restored.snapshot.world).slots[155]!;
  assert.equal(actor.pendingNativeAi!.disposition, "pending-native-task-hand-off");
  assert.deepEqual([actor.resourceTask!.pendingOrder, actor.resourceTask!.order],
    [...restored.snapshot.world.entityBytes!.slice(155 * 220 + 0x36, 155 * 220 + 0x38)]);
  const saved = restored.checkpoint();
  assert.equal(restored.step(input(restored, { resourceFrameSource })).ok, false);
  assert.equal(restored.resumeResourceIdle(155, 0).ok, false);
  assert.deepEqual(restored.checkpoint(), saved);
});
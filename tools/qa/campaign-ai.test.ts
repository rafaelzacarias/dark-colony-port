import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CAMPAIGN_AI_SOURCE_SHA256, decodeCampaignAiPacket, transactCampaignAiProduction,
  type CampaignAiCommand, type CampaignAiTransactionState, type CampaignAiConfiguration, type CampaignAiSessionRequest } from "../../src/engine/campaign-ai";
import { consumeLegacyAiDemand, consumeLegacyAiPolicyPipeline } from "../../src/engine/legacy-ai";
import { CampaignSession, type CampaignSessionInput, type CampaignSessionOptions } from "../../src/engine/campaign-session";
import { productionChoices, reduceCampaignProduction, stepCampaignProductionProducer, type ProductionSourceProfile,
  type ProductionUnitSource } from "../../src/engine/campaign-production";
import { transportHostState, type ResourceHostOptions, type ResourceHostBinding } from "../../src/engine/transport-host";
import { parseDependencies, parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { parseScenario } from "../extractors/data/scenario";
import { parseTriggerScript } from "../extractors/data/triggers";
import { parseFin } from "../extractors/animations/fin";
import { finSourceDuration } from "../../src/render/fin-animation";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(`raw_cd/DC/${path}`, root));
const units = parseUnitStats(read("GAMESTAT/GAMESTAT.TXT").toString());
const weapons = parseWeaponStats(read("GAMESTAT/WEAPSTAT.TXT").toString());
const records = parseDependencies(read("GAMESTAT/DEPEND.TXT").toString());
const decode = (value: string) => new Uint8Array(Buffer.from(value, "base64"));
const data = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const native = (environment: string, script: string) => JSON.parse(process.env[environment]
  ? readFileSync(process.env[environment]!, "utf8") : execFileSync("python3", ["-B", new URL(script, root).pathname], {
    cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
  }));
type Buffers = { policy: string; entities: string; teamBytes: string };
type Golden = { label: string; stage: "demand" | "pipeline"; team: number; race: 0 | 1; population: number; populationLimit: number; forceOrder: number;
  navigation: { width: number; height: number; families: string; nextFamily: string };
  inputs: { types: string; weapons: string; dependencies: string; cityDependencies: number[]; matrix: number[][];
    relations: number[]; visibilityMasks: number[]; occupancy: number[] };
  before: Buffers; after: Buffers; packets: string[] };
const proof = native("DC_CAMPAIGN_AI_TRACE", "tools/qa/campaign-ai-native.py") as {
  sha256: string; demands: Golden[];
  receivers: { unitType: number; queue: number; cost: number; count: number; prefix: number[]; fifo: number[];
    cursor: number; credits: number; accounting: number; ready: number; delay: number }[];
  decoders: { label: string; result: number; fifo: number[]; credits: number; accounting: number; cityHealth: number; cityLevel: number;
    callbacks: { callback: string; payload: number[] }[] }[];
  transport: { emitted: number[][]; localReceipt: { credits: number; accounting: number; count: number };
    framedSource: { bytes: number[]; remainingBytes: number; fifo: number[]; accounting: number } };
};
const clocks = native("DC_PRODUCTION_SESSION_TRACE", "tools/qa/campaign-production-session-native.py") as {
  units: ProductionUnitSource[]; cases: { profile: ProductionSourceProfile; source: { source: string };
    trace: { frame: number; delay: number; mode: number; ready: number; count: number }[] }[];
};

function fixture(golden = proof.demands[0], capture?: (options: CampaignSessionOptions) => void): CampaignAiTransactionState {
  const teamBytes = decode(golden.before.teamBytes), bytes = data(teamBytes);
  const original = parseScenario(read("SCENARIO/HUMAN/HUMAN02.SCN").toString());
  const restrictions = Array.from({ length: 110 }, (_, index) => index).filter((index) => teamBytes[0xda4 + index] !== 0);
  const source = { ...original, placementRows: [], teams: original.teams.map((team) => ({ ...team, race: golden.race,
    money: bytes.getInt32(0x14, true), coordinateRows: [[0, 0], team.index === golden.team ? [50, 50] : [0, 0]] as const,
    cityRows: [[1, 100, 1, 100, 0, 0, 0, 0, 0, 0]] })) };
  const options: CampaignSessionOptions = { sessionId: golden.label, source, units, weapons, triggers: [], messages: [],
    map: { width: 128, height: 128 }, pathGrid: new Uint8Array(128 * 128).fill(1), tags: new Uint8Array(128 * 128),
    commanders: [{ team: golden.team, unitType: golden.race === 0 ? 69 : 73, sprite: golden.race === 0 ? "TRSC" : "GRAY" }],
    directionBits: Array.from({ length: 64 }, () => [0, 0] as const), fixedStepMilliseconds: 16, orientationSteps: 1,
    production: { records, units: clocks.units, sourceProfiles: [clocks.cases[golden.race].profile],
      teams: [{ team: golden.team, race: golden.race, credits: bytes.getInt32(0x14, true), costAccumulator: bytes.getInt32(0x18, true),
        base: { x: 50, y: 50 }, slots: Array.from({ length: 5 }, (_, slot) => ({ health: bytes.getInt32(0x3c + slot * 4, true),
          level: bytes.getInt32(0xc4 + slot * 4, true), busy: 0 })), restrictions, upgrades: [], producerDelays: [0, 0, 0, 0] }] } };
  capture?.(options);
  const session = new CampaignSession(options).snapshot;
  return { scope: "source-separated-bounded", production: session.production!, world: session.world, receipts: [],
    ai: { policy: decode(golden.before.policy), entities: decode(golden.before.entities), forceOrder: golden.forceOrder,
      navigation: { ...golden.navigation, families: decode(golden.navigation.families), nextFamily: decode(golden.navigation.nextFamily) } },
    inputs: { ...golden.inputs, team: golden.team, teamBytes, population: golden.population, populationLimit: golden.populationLimit,
      types: decode(golden.inputs.types), weapons: decode(golden.inputs.weapons), dependencies: decode(golden.inputs.dependencies),
      relations: Uint8Array.from(golden.inputs.relations) } };
}

const command = { id: "native-demand:0", sequence: 0, stage: "demand" as const };

test("receipt integrity seals commits and rejects altered or unsealed low-level duplicates", () => {
  const paid = apply(fixture());
  assert.match(paid.receipts[0].integrity!, /^[0-9a-f]{64}$/);
  assert.deepEqual(apply(structuredClone(paid)), paid);
  for (const mutate of [
    (receipt: any) => { receipt.selectedRule ^= 1; },
    (receipt: any) => { delete receipt.integrity; },
    (receipt: any) => { delete receipt.intents[0].packet[0]; },
  ]) {
    const copy = structuredClone(paid);
    mutate(copy.receipts[0]);
    const before = structuredClone(copy), result = transactCampaignAiProduction(copy, command);
    assert.equal(result.ok, false);
    assert.deepEqual(copy, before);
  }
});

test("receipt integrity rejects non-JSON graphs, accessors and proxies without invoking getters", () => {
  const paid = apply(fixture()), pristine = structuredClone(paid);
  let getterCalls = 0;
  const mutations: [string, (receipt: any) => void][] = [
    ["accessor", receipt => { Object.defineProperty(receipt.intents[0], "packet", { enumerable: true,
      get() { getterCalls++; return [7, 0, 10, 0, 1, 1, 0]; } }); }],
    ["proxy", receipt => { receipt.intents[0] = new Proxy(receipt.intents[0], {}); }],
    ["hidden", receipt => { Object.defineProperty(receipt, "hidden", { value: 1 }); }],
    ["symbol", receipt => { receipt[Symbol("hidden")] = 1; }],
    ["undefined", receipt => { receipt.extra = undefined; }],
    ["function", receipt => { receipt.extra = () => 1; }],
    ["bigint", receipt => { receipt.extra = 1n; }],
    ["nonfinite", receipt => { receipt.extra = Infinity; }],
    ["nan", receipt => { receipt.extra = NaN; }],
    ["cycle", receipt => { receipt.extra = receipt; }],
    ["date", receipt => { receipt.extra = new Date(); }],
    ["typed array", receipt => { receipt.intents[0].packet = Uint8Array.from(receipt.intents[0].packet); }],
    ["extended array", receipt => { receipt.intents.extra = 1; }],
    ["hole with extra key", receipt => { delete receipt.intents[0].packet[0]; receipt.intents[0].packet.extra = 1; }],
    ["sparse intents", receipt => { delete receipt.intents[0]; }],
  ];
  for (const [label, mutate] of mutations) {
    const copy = structuredClone(paid);
    mutate(copy.receipts[0]);
    assert.equal(transactCampaignAiProduction(copy, command).ok, false, label);
    assert.deepEqual(copy.production, pristine.production, label);
    assert.deepEqual(copy.world, pristine.world, label);
    assert.deepEqual(copy.ai, pristine.ai, label);
  }
  assert.equal(getterCalls, 0);
  assert.deepEqual(paid, pristine);
});

test("full-policy configuration cannot take a partial-stage receipt path", () => {
  const state = fixture();
  const configured: CampaignAiTransactionState = { ...state, fullPolicy: {
    neighbors: [], rngTable: Array(256).fill(1000), ruleTable: Array(18 * 12).fill(0),
    policyAddress: 0x880000, actorTransport: "deferred",
  } };
  const before = structuredClone(configured);
  assert.notDeepEqual(configured.ai.entities, configured.world.entityBytes);
  for (const stage of ["demand", "pipeline"] as const) {
    const result = transactCampaignAiProduction(configured, { ...command, stage });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /cannot downgrade/);
    assert.deepEqual(configured, before);
  }
});

function apply(state: CampaignAiTransactionState, input: CampaignAiCommand = command): CampaignAiTransactionState {
  const result = transactCampaignAiProduction(state, input);
  if (!result.ok) assert.fail(result.message);
  assert.equal(result.readyWholeCall, false);
  assert.deepEqual(result.remainingGroups, [0, 1, 2, 3]);
  return result.state;
}

test("original decoder executes ordered source callbacks; malformed native streams can partially mutate", () => {
  assert.equal(createHash("sha256").update(read("DC.EXE")).digest("hex"), proof.sha256);
  for (const entry of proof.receivers) {
    assert.deepEqual(entry.fifo, [...entry.prefix, ...Array(entry.count).fill(entry.unitType)]);
    assert.equal(entry.cursor, 3);
    assert.equal(entry.credits, 650);
    assert.equal(entry.accounting, 100 + entry.count * entry.cost);
    assert.equal(entry.ready, entry.count & 1);
    assert.equal(entry.delay, 7);
  }
  assert.equal(proof.receivers.at(-1)!.fifo.length, 800);
  assert.deepEqual([...new Set(proof.receivers.map((entry) => entry.queue))].sort(), [0, 1, 2, 3]);
  assert.deepEqual(proof.transport.emitted, [0, 1, 15].map((sequence) => [7, sequence << 4, 10, 0, 1, 1, 0]));
  assert.deepEqual(proof.transport.localReceipt, { credits: 650, accounting: 450, count: 1 });
  assert.deepEqual(proof.transport.framedSource, { bytes: [5, 0, 10, 0, 1, 1, 0, 5, 0, 10, 8, 1, 2, 0],
    remainingBytes: 0, fifo: [0, 8, 8], accounting: 1150 });
  const sequence = proof.decoders.find((entry) => entry.label === "sequence")!;
  assert.deepEqual(sequence.callbacks, [{ callback: "0x41c7f8", payload: [0, 1, 1] }, { callback: "0x41c7f8", payload: [8, 1, 2] }]);
  assert.deepEqual(sequence.fifo, [0, 8, 8]);
  assert.equal(sequence.accounting, 1150);
  const missing = proof.decoders.find((entry) => entry.label === "missing-terminator")!;
  assert.equal(missing.result, -1);
  assert.deepEqual(missing.fifo, [0]);
  const city = proof.decoders.find((entry) => entry.label === "city-initializer-intercepted")!;
  assert.deepEqual(city.callbacks, [{ callback: "0x41c8d4", payload: [3, 0, 1] }]);
  assert.deepEqual([city.result, city.credits, city.accounting, city.cityHealth, city.cityLevel], [0, 650, 2100, 2400, 0]);
});

test("exact mode 9/10 framing rejects altered length, sequence, bounds, count and terminator", () => {
  assert.deepEqual(decodeCampaignAiPacket(Uint8Array.of(7, 0, 9, 3, 0, 1, 0)),
    { mode: 9, city: 3, level: 0, team: 1, callback: 0x41c8d4 });
  assert.deepEqual(decodeCampaignAiPacket(Uint8Array.of(7, 0, 10, 8, 2, 1, 0)),
    { mode: 10, unitType: 8, team: 2, count: 1, callback: 0x41c7f8 });
  for (const packet of [[6, 0, 10, 0, 1, 1, 0], [7, 16, 10, 0, 1, 1, 0], [7, 0, 11, 0, 1, 1, 0],
    [7, 0, 10, 110, 1, 1, 0], [7, 0, 10, 0, 8, 1, 0], [7, 0, 10, 0, 1, 0, 0], [7, 0, 10, 0, 1, 2, 0],
    [7, 0, 10, 0, 1, 1, 1], [7, 0, 10, 0, 1, 1], [7, 0, 10, 0, 1, 1, 0, 0], [7, 0, 9, 15, 0, 1, 0]]) {
    assert.throws(() => decodeCampaignAiPacket(Uint8Array.from(packet)));
  }
});

for (const golden of proof.demands) test(`${golden.label}: original rule -> one paid receipt -> native FIN -> one real slot; NOT complete AI`, () => {
  const before = fixture(golden), pristine = structuredClone(before);
  const nativeInput = structuredClone(before);
  const purchaseCommand = { ...command, stage: golden.stage };
  const result = (golden.stage === "pipeline" ? consumeLegacyAiPolicyPipeline : consumeLegacyAiDemand)(nativeInput.ai, nativeInput.inputs);
  assert.deepEqual(nativeInput.ai.policy, decode(golden.after.policy));
  assert.deepEqual(nativeInput.ai.entities, decode(golden.after.entities));
  assert.deepEqual(nativeInput.inputs.teamBytes, decode(golden.after.teamBytes));
  assert.deepEqual(result.productionRequests.map((intent) => Buffer.from(intent.packet).toString("hex")), golden.packets);
  assert.equal(result.productionRequests.length, 1);
  let state = apply(before, purchaseCommand);
  assert.deepEqual(before, pristine);
  assert.deepEqual(state.ai, nativeInput.ai);
  const receipt = state.receipts[0].intents[0];
  assert.equal(receipt.receipt, "applied");
  assert.equal(state.production.teams[0].credits, 650);
  assert.equal(state.world.exomoney[golden.team], 650);
  assert.equal(state.production.teams[0].costAccumulator, 367);
  assert.deepEqual(state.production.teams[0].pending, {});
  assert.equal(state.production.teams[0].queues[0].items[0].ticket, receipt.ticket);
  assert.equal(data(state.inputs.teamBytes).getInt32(0x18, true), 367);
  assert.equal(data(state.inputs.teamBytes).getUint16(0x110, true), 1);
  assert.equal(state.inputs.teamBytes[0x108], 1);
  assert.deepEqual(apply(state, purchaseCommand), state);
  const clock = clocks.cases[golden.race];
  const finBytes = readFileSync(new URL(clock.source.source, root));
  assert.equal(createHash("sha256").update(finBytes).digest("hex"), clock.profile.finSha256);
  const fin = parseFin(finBytes), selected = fin.states.find((entry) => entry.name === clock.profile.id)!;
  assert.deepEqual(fin.timeline.slice(selected.firstTimelineIndex, selected.lastTimelineIndex + 1)
    .map((entry) => finSourceDuration(entry.field2)), clock.profile.directions[0]);
  for (const [index, expected] of clock.trace.entries()) {
    state = { ...state, ...stepCampaignProductionProducer(state.production, state.world,
      { team: golden.team, queue: 0, population: 2, populationLimit: 10 }, `bounded-ai-producer:${index}`) };
    const queue = state.production.teams[0].queues[0];
    assert.deepEqual([queue.animation!.frame, queue.animation!.delay, queue.animation!.mode, queue.ready, queue.items.length],
      [expected.frame, expected.delay, expected.mode, expected.ready, expected.count]);
    if (index === 0) {
      const host = transportHostState(state.world);
      assert.equal(host.ground[47 * 128 + 50], 1022);
      assert.equal(host.productionExits!.length, 1);
      assert.equal(host.productionExits![0].ticket, receipt.ticket);
    }
  }
  const host = transportHostState(state.world);
  assert.deepEqual(host.requests.filter((entry) => entry.type === "create"), [{ type: "create", slot: 152, generation: 0,
    team: golden.team, unitType: golden.race * 8, position: { x: 50 * 256 + 128, y: 47 * 256 + 128 } }]);
  assert.equal(host.ground[47 * 128 + 50], 152);
  assert.deepEqual(host.productionExits, []);
  assert.equal(state.production.teams[0].credits, 650);
  assert.equal(state.production.teams[0].costAccumulator, 367);
  const allocated = state.production.requests.filter((entry) => entry.type === "unit-allocated");
  assert.equal(allocated.length, 1);
  assert.equal(allocated[0].nativeSlot, 152);
  assert.equal(allocated[0].generation, 0);
  assert.deepEqual(apply(state, purchaseCommand), state, "retry after completion cannot enqueue or allocate again");
});

test("stale owner fields, source tables and sequence reject without mutating any input", () => {
  const mutations: ((state: any) => void)[] = [
    (state) => { state.world.exomoney[state.inputs.team] += 1; },
    (state) => { data(state.inputs.teamBytes).setInt32(0x14, 999, true); },
    (state) => { data(state.inputs.teamBytes).setInt32(0x18, 18, true); },
    (state) => { state.inputs.teamBytes[0x108] = 0; },
    (state) => { state.inputs.teamBytes[0x110] = 1; },
    (state) => { state.inputs.teamBytes[0x78] = 1; },
    (state) => { state.inputs.dependencies[9 * 52 + 8] ^= 1; },
    (state) => { state.inputs.types[0xec] = 3; },
    (state) => { state.production.units.find((unit: ProductionUnitSource) => unit.unitType === 0).exitOffset.y = -2; },
    (state) => { state.world.sessionId += "other"; },
    (state) => { state.ai.policy[0x6a94] ^= 1; },
  ];
  for (const mutate of mutations) {
    const state = structuredClone(fixture()); mutate(state);
    const before = structuredClone(state), result = transactCampaignAiProduction(state, command);
    assert.equal(result.ok, false);
    assert.deepEqual(state, before);
  }
  assert.equal(transactCampaignAiProduction(fixture(), { ...command, sequence: 1 }).ok, false);
  const state = apply(fixture());
  assert.equal(transactCampaignAiProduction(state, { ...command, stage: "pipeline" }).ok, false);
});

test("duplicate receipt must retain source, stage and committed paid intents", () => {
  const paid = apply(fixture());
  const mutations: ((state: any) => void)[] = [
    state => { state.receipts[0].command.stage = "full-policy"; },
    state => { state.receipts[0].sourceSha256 = "0".repeat(64); },
    state => { state.receipts[0].intents = []; },
    state => { state.receipts[0].intents[0].creditsAfter++; },
    state => { state.production.journal.find((entry: any) => entry.action.type === "receive-prepaid-unit").action.count = 2; },
    state => { delete state.receipts[0]; },
  ];
  for (const mutate of mutations) {
    const state = structuredClone(paid);
    mutate(state);
    const before = structuredClone(state);
    const retry = state.receipts[0]?.command ?? command;
    assert.equal(transactCampaignAiProduction(state, retry).ok, false);
    assert.deepEqual(state, before);
  }
  assert.deepEqual(apply(paid), paid);
});

test("unsupported native city and harvester intents block the whole staged debit", () => {
  for (const kind of ["city", "harvester"] as const) {
    const state = structuredClone(fixture()), team = state.production.teams[0];
    data(state.inputs.teamBytes).setInt32(0x14, 100000, true);
    (team as { credits: number }).credits = 100000;
    (state.world.exomoney as Record<number, number>)[team.team] = 100000;
    if (kind === "harvester") {
      data(state.ai.policy).setInt16(0x1faa, -1, true);
      for (let slot = 0; slot < 800; slot += 1) state.ai.entities[slot * 220 + 7] = 100;
    }
    else {
      (team.slots[0] as { health: number }).health = 0;
      data(state.inputs.teamBytes).setInt32(0x3c, 0, true);
      (state as { world: typeof state.world }).world = { ...state.world,
        entities: state.world.entities.filter((entity) => entity.rawSlot !== team.team * 15) };
    }
    const before = structuredClone(state), result = transactCampaignAiProduction(state, command);
    assert.equal(result.ok, false, kind);
    if (!result.ok) assert.equal(result.code, kind === "city" ? "unsupported-city" : "unsupported-unit", result.message);
    assert.deepEqual(state, before);
  }
});

test("prepaid receipt capacity/accounting failures roll back the preceding AI debit", () => {
  const original = fixture();
  for (const failure of ["capacity", "accounting"] as const) {
    const state = structuredClone(original), team = state.production.teams[0];
    if (failure === "capacity") (state.production as { queueSafetyLimit: number }).queueSafetyLimit = 0;
    else {
      (team as { costAccumulator: number }).costAccumulator = 2147483647;
      data(state.inputs.teamBytes).setInt32(0x18, 2147483647, true);
    }
    const before = structuredClone(state), result = transactCampaignAiProduction(state, command);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /safety limit|overflow\/underflow/);
    assert.deepEqual(state, before);
  }
  const state = apply(original), event = state.production.journal.find((entry) => entry.action.type === "receive-prepaid-unit")!;
  assert.deepEqual(reduceCampaignProduction(state.production, event), state.production);
  assert.throws(() => reduceCampaignProduction(state.production, { ...event,
    action: { ...event.action, expectedCredits: 1 } } as typeof event), /ID reused/);
  assert.throws(() => reduceCampaignProduction(state.production, { ...event, id: "unpaid-copy" }), /receipt key/);
  assert.equal(event.action.type, "receive-prepaid-unit");
  const action = event.action;
  if (action.type === "receive-prepaid-unit") assert.throws(() => reduceCampaignProduction(state.production,
    { ...event, id: "unpaid-copy", action: { ...action,
      provenance: { ...action.provenance, receiptKey: "unpaid-copy" } } }), /exact committed credit debit/);
});

test("a second ordered receipt appends behind an active native reservation without resetting its clock", () => {
  let state = structuredClone(apply(fixture()));
  state = { ...state, ...stepCampaignProductionProducer(state.production, state.world,
    { team: state.inputs.team, queue: 0, population: 2, populationLimit: 10 }, "start-owned-head") };
  state.inputs.teamBytes[0x108] = 0;
  const before = structuredClone(state), head = state.production.teams[0].queues[0];
  const next = apply(state, { ...command, id: "next-native-rule", sequence: 1 });
  assert.deepEqual(state, before);
  assert.equal(next.production.teams[0].credits, 300);
  assert.equal(next.production.teams[0].costAccumulator, 717);
  assert.equal(next.production.teams[0].queues[0].items.length, 2);
  assert.equal(next.production.teams[0].queues[0].activeTicket, head.activeTicket);
  assert.deepEqual(next.production.teams[0].queues[0].animation, head.animation);
  assert.deepEqual(transportHostState(next.world), transportHostState(state.world));
  assert.notEqual(next.receipts[0].intents[0].ticket, next.receipts[1].intents[0].ticket);
  const broken = structuredClone(state);
  (broken.world.transportState as { productionExits: unknown[] }).productionExits = [];
  const result = transactCampaignAiProduction(broken, { ...command, id: "next-native-rule", sequence: 1 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /reservation mismatch/);
});

test("pending UI purchases consume capacity; AI cannot dispatch or debit them again", () => {
  const initial = fixture(), dependency = records.find((entry) => entry.rawFields[0] === 1
    && entry.rawFields[1] === initial.production.teams[0].race * 8)!.id;
  const production = reduceCampaignProduction({ ...initial.production, queueSafetyLimit: 1 },
    { id: "existing-ui-purchase", team: initial.inputs.team, action: { type: "reserve", dependency } });
  const state = { ...initial, production, world: { ...initial.world, exomoney: { ...initial.world.exomoney, [initial.inputs.team]: 650 } } };
  data(state.inputs.teamBytes).setInt32(0x14, 650, true);
  const before = structuredClone(state), result = transactCampaignAiProduction(state, command);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /FIFO safety limit/);
  assert.deepEqual(state, before);
  assert.equal(state.production.teams[0].pending[dependency], 1);
});

test("a genuinely unaffordable native rule commits no receipt, accounting or credit change", () => {
  const initial = fixture(), credits = 100;
  const production = reduceCampaignProduction(initial.production, { id: "owner-balance", team: initial.inputs.team,
    action: { type: "sync-credits", expectedPreviousCredits: 1000, credits } });
  const state = { ...initial, production, world: { ...initial.world, exomoney: { ...initial.world.exomoney, [initial.inputs.team]: credits } } };
  data(state.inputs.teamBytes).setInt32(0x14, credits, true);
  const result = apply(state);
  assert.deepEqual(result.receipts[0].intents, []);
  assert.deepEqual(result.production, production);
  assert.equal(result.world.exomoney[initial.inputs.team], credits);
});

function sessionFixture(golden = proof.demands[0]) {
  let options!: CampaignSessionOptions;
  const source = fixture(golden, (value) => { options = value; });
  const { ai, inputs } = source;
  const observation = { entities: [...ai.entities], forceOrder: ai.forceOrder, population: inputs.population,
    populationLimit: inputs.populationLimit, relations: [...inputs.relations], visibilityMasks: [...inputs.visibilityMasks],
    occupancy: [...inputs.occupancy] };
  const campaignAi: CampaignAiConfiguration = { scope: source.scope, sourceId: golden.label, sourceSha256: CAMPAIGN_AI_SOURCE_SHA256,
    team: inputs.team, sources: { types: [...inputs.types], weapons: [...inputs.weapons], dependencies: [...inputs.dependencies],
      cityDependencies: [...inputs.cityDependencies], matrix: inputs.matrix, navigation: { ...ai.navigation,
        families: [...ai.navigation.families], nextFamily: [...ai.navigation.nextFamily] } },
    initial: { ...observation, policy: [...ai.policy], teamBytes: [...inputs.teamBytes] } };
  const request: CampaignAiSessionRequest = { ...command, stage: golden.stage, sourceId: campaignAi.sourceId, observation };
  return { options: { ...options, campaignAi }, request, golden };
}

function sessionInput(session: CampaignSession, extra: Partial<CampaignSessionInput> = {}): CampaignSessionInput {
  const snapshot = session.snapshot;
  return { clockMilliseconds: (snapshot.cycleCounter + 1) * 16, productionVisits: [{ team: snapshot.production!.teams[0].team, queue: 0,
    population: 2, populationLimit: 10 }], ...extra };
}

function sessionStep(session: CampaignSession, extra: Partial<CampaignSessionInput> = {}) {
  const result = session.step(sessionInput(session, extra));
  if (!result.ok) assert.fail(JSON.stringify(result.diagnostics));
  return result.value;
}

for (const golden of proof.demands) test(`session ${golden.label}: native pipeline, prepaid FIFO, real creation and durable retry`, () => {
  const { options, request } = sessionFixture(golden);
  const session = new CampaignSession(options);
  let frame = sessionStep(session, { campaignAiRequest: request });
  assert.deepEqual(frame.campaignAi!.buffers.policy, [...decode(golden.after.policy)]);
  assert.deepEqual(frame.campaignAi!.buffers.entities, [...decode(golden.after.entities)]);
  assert.deepEqual(frame.campaignAi!.history[0].receipt.intents.map((intent) => Buffer.from(intent.packet).toString("hex")), golden.packets);
  assert.equal(frame.world.exomoney[golden.team], 650);
  assert.equal(frame.production!.teams[0].costAccumulator, 367);
  assert.deepEqual(frame.production!.teams[0].pending, {});
  assert.equal(transportHostState(frame.world).ground[47 * 128 + 50], 1022);
  const queued = JSON.parse(JSON.stringify(session.checkpoint()));
  const restored = CampaignSession.restore(queued, options.campaignAi);
  assert.deepEqual(restored.snapshot, session.snapshot);
  for (let index = 0; index < clocks.cases[golden.race].trace.length; index += 1) {
    if (index > 0) {
      frame = sessionStep(session);
      assert.deepEqual(sessionStep(restored), frame);
    }
    const expected = clocks.cases[golden.race].trace[index], queue = frame.production!.teams[0].queues[0];
    assert.deepEqual([queue.animation!.frame, queue.animation!.delay, queue.animation!.mode, queue.ready, queue.items.length],
      [expected.frame, expected.delay, expected.mode, expected.ready, expected.count]);
  }
  assert.deepEqual(frame.entry.requests.filter((entry) => entry.type === "create"), [{ type: "create", slot: 152, generation: 0,
    team: golden.team, unitType: golden.race * 8, position: { x: 50 * 256 + 128, y: 47 * 256 + 128 } }]);
  const afterSpawn = CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint())), options.campaignAi);
  for (let tick = 0; tick < 100; tick += 1) sessionStep(afterSpawn);
  const retried = sessionStep(afterSpawn, { campaignAiRequest: request });
  assert.equal(retried.campaignAi!.history.length, 1);
  assert.equal(retried.production!.teams[0].credits, 650);
  assert.equal(retried.production!.teams[0].costAccumulator, 367);
  assert.deepEqual(retried.entry.requests, []);
  assert.equal(afterSpawn.identityProvenance.filter((entry) => entry.type === "create").length, 1);
  assert.deepEqual(CampaignSession.restore(JSON.parse(JSON.stringify(afterSpawn.checkpoint())), options.campaignAi).snapshot, afterSpawn.snapshot);
});

test("session player pending remains distinct from native payment and production menu uses canonical credits", () => {
  const { options, request } = sessionFixture();
  const team = options.campaignAi.team;
  const dependency = records.find((entry) => entry.rawFields[0] === 1 && entry.rawFields[1] === options.production!.teams[0].race * 8)!.id;
  const session = new CampaignSession(options);
  const frame = sessionStep(session, { campaignAiRequest: request,
    productionCommands: [{ id: "real-player", team, action: { type: "reserve", dependency } }] });
  assert.equal(frame.world.exomoney[team], 300);
  assert.equal(frame.production!.teams[0].credits, 300);
  assert.equal(frame.production!.teams[0].pending[dependency], 1);
  assert.equal(frame.production!.teams[0].queues[0].items.length, 1);
  assert.equal(frame.production!.teams[0].costAccumulator, 367);
  const choice = productionChoices(frame.production!, team).find((entry) => entry.dependency === dependency)!;
  assert.equal(choice.maxAdditional, 0);
  assert.equal(choice.pending, 1);
  assert.equal(choice.queued, 1);
  assert.deepEqual(CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint())), options.campaignAi).snapshot, session.snapshot);
});

test("legacy demand and pipeline receipts migrate only through source-validated checkpoint restore", () => {
  for (const golden of proof.demands) {
    const { options, request } = sessionFixture(golden), session = new CampaignSession(options);
    sessionStep(session, { campaignAiRequest: request });
    const sealed = JSON.parse(JSON.stringify(session.checkpoint())), legacy = structuredClone(sealed);
    delete legacy.state.campaignAi.history[0].receipt.integrity;
    const before = structuredClone(legacy), restored = CampaignSession.restore(legacy, options.campaignAi);
    assert.deepEqual(restored.checkpoint(), sealed);
    assert.deepEqual(legacy, before);
    const retried = sessionStep(restored, { campaignAiRequest: request });
    assert.equal(retried.campaignAi!.history.length, 1);
    assert.equal(retried.production!.teams[0].credits, 650);
    legacy.state.campaignAi.history[0].receipt.selectedRule ^= 1;
    assert.throws(() => CampaignSession.restore(legacy, options.campaignAi), /differs from native computation/);
  }
});

test("session late TRO failure rolls back AI buffers, money, FIFO, native allocation and RNG cursor", () => {
  const { options, request } = sessionFixture(proof.demands[1]);
  const session = new CampaignSession({ ...options, triggers: parseTriggerScript(`1 norm 1 (c==0)
exomoney ${options.campaignAi.team} 17
reinforce2 ${options.campaignAi.team} 60 60 0 1 0 0 0 0 0 0 0 0
msg 2 0 29 3 8
end`) });
  for (let tick = 0; tick < 7; tick += 1) sessionStep(session);
  const before = session.checkpoint(), journal = session.journal;
  const result = session.step(sessionInput(session, { campaignAiRequest: request }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(JSON.stringify(result.diagnostics), /Missing message 29/);
  assert.deepEqual(session.checkpoint(), before);
  assert.deepEqual(session.journal, journal);
  assert.equal(transportHostState(session.snapshot.world).directionCursor, 0);
});

test("session strict source identity, receipt provenance, native recomputation and double-debit tamper guards", () => {
  const { options, request } = sessionFixture();
  const session = new CampaignSession(options);
  sessionStep(session, { campaignAiRequest: request });
  const saved = session.checkpoint();
  assert.throws(() => CampaignSession.restore(saved), /expected source configuration/);
  const changes: ((copy: any) => void)[] = [
    (copy) => { copy.options.campaignAi.sources.types[0] ^= 1; },
    (copy) => { copy.state.campaignAi.buffers.policy[0] ^= 1; },
    (copy) => { copy.state.campaignAi.buffers.entities[0] ^= 1; },
    (copy) => { copy.state.campaignAi.history[0].receipt.sourceSha256 = "wrong"; },
    (copy) => { copy.state.campaignAi.history[0].receipt.intents[0].creditsAfter -= 350; },
    (copy) => { copy.state.campaignAi.history[0].receipt.intents[0].packet[3] ^= 8; },
    (copy) => { copy.state.campaignAi.history[0].request.stage = "pipeline"; },
    (copy) => { copy.state.campaignAi.history[0].teamBytesBefore[0] ^= 1; },
    (copy) => { copy.state.campaignAi.history.push(copy.state.campaignAi.history[0]); },
    (copy) => { copy.state.production.journal[0].action.expectedPreviousCredits -= 350; },
    (copy) => { copy.state.production.journal[1].action.provenance.receiptKey = "fake"; },
    (copy) => { copy.state.production.journal[1].id = "campaign-ai:fake"; },
    (copy) => { copy.state.production.teams[0].costAccumulator += 350; },
    (copy) => { copy.state.production.teams[0].credits -= 350; copy.state.world.exomoney[options.campaignAi.team] -= 350;
      const bytes = Uint8Array.from(copy.state.campaignAi.buffers.teamBytes); data(bytes).setInt32(0x14, 300, true);
      copy.state.campaignAi.buffers.teamBytes = [...bytes]; },
  ];
  for (const [index, change] of changes.entries()) {
    const copy = JSON.parse(JSON.stringify(saved)); change(copy);
    assert.throws(() => CampaignSession.restore(copy, options.campaignAi), `tamper case ${index}`);
  }
  const before = session.checkpoint();
  assert.equal(session.step(sessionInput(session, { campaignAiRequest: { ...request,
    observation: { ...request.observation, population: 3 } } })).ok, false);
  assert.deepEqual(session.checkpoint(), before);
  const noOpt = new CampaignSession({ ...options, campaignAi: undefined });
  assert.equal(noOpt.step(sessionInput(noOpt, { campaignAiRequest: request })).ok, false);
  assert.equal(session.step(sessionInput(session, { productionCommands: [{ id: "forged-paid", team: options.campaignAi.team,
    action: { type: "receive-prepaid-unit", dependency: 9 } as never }] })).ok, false);
});

test("session second command appends behind a running native producer and retries survive midqueue restore", () => {
  const { options, request } = sessionFixture();
  const session = new CampaignSession(options);
  const first = sessionStep(session, { campaignAiRequest: request });
  const secondRequest = { ...request, id: "native-demand:1", sequence: 1 };
  const second = sessionStep(session, { campaignAiRequest: secondRequest });
  assert.equal(second.production!.teams[0].queues[0].activeTicket, first.production!.teams[0].queues[0].activeTicket);
  assert.equal(second.production!.teams[0].queues[0].items.length, 2);
  assert.equal(second.production!.teams[0].credits, 300);
  assert.equal(second.production!.teams[0].costAccumulator, 717);
  const restored = CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint())), options.campaignAi);
  assert.deepEqual(sessionStep(restored, { campaignAiRequest: request }), sessionStep(session, { campaignAiRequest: request }));
  assert.deepEqual(sessionStep(restored, { campaignAiRequest: secondRequest }), sessionStep(session, { campaignAiRequest: secondRequest }));
  assert.equal(restored.snapshot.campaignAi!.history.length, 2);
});

test("session unsupported city intent rolls back native payment and policy rather than admitting mode 9", () => {
  const { options, request } = sessionFixture();
  const edited = structuredClone(options) as any;
  const team = edited.campaignAi.team;
  edited.source.teams[team].money = 100000;
  edited.source.teams[team].cityRows[0][1] = 0;
  edited.production.teams[0].credits = 100000;
  edited.production.teams[0].slots[0].health = 0;
  const bytes = Uint8Array.from(edited.campaignAi.initial.teamBytes);
  data(bytes).setInt32(0x14, 100000, true); data(bytes).setInt32(0x3c, 0, true);
  edited.campaignAi.initial.teamBytes = [...bytes];
  const session = new CampaignSession(edited), before = session.checkpoint();
  const result = session.step(sessionInput(session, { campaignAiRequest: request }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(JSON.stringify(result.diagnostics), /unsupported-city.*Mode 9/);
  assert.deepEqual(session.checkpoint(), before);
});

test("session resource income remains authoritative with prepaid AI and real player pending across restore", () => {
  type ResourceEntity = { direction: number; pendingOrder: number; order: number; taskWords: number[]; type: number; hp: number;
    animation: { bank: number; frame: number; delay: number; mode: 0 | 1 | 2 | 3 } };
  const trace = native("DC_RESOURCE_LIFECYCLE_TRACE", "tools/research/resource-lifecycle-20260919.py") as {
    cases: { race: number; trace: { source: ResourceEntity; extractor: ResourceEntity }[]; animations: ResourceHostOptions["animations"];
      profiles: { bindings: { unitType: number; standBank: number; deployBank: number; deathBank: number;
        deathVariants: number; removalHoldField: number; selectedWeapon: number }[] } }[] };
  const evidence = trace.cases.find((entry) => entry.race === 0)!;
  const initial = evidence.trace[0];
  const fixture = sessionFixture(proof.demands.find((entry) => entry.race === 0 && entry.stage === "demand")!);
  const team = fixture.options.campaignAi.team;
  const bind = (entity: ResourceEntity, slot: number): ResourceHostBinding => ({ slot, generation: 0, state: {
    direction: entity.direction, pendingOrder: entity.pendingOrder, order: entity.order,
    animation: { profile: String(entity.animation.bank), frame: entity.animation.frame, delay: entity.animation.delay, mode: entity.animation.mode },
    stack: [{ opcode: 1, words: entity.taskWords.slice(0, 3) }], released: false } });
  const options: CampaignSessionOptions = { ...fixture.options, source: { ...fixture.options.source,
    placementRows: [[60, 60, 40, 22, 10000], [60, 60, initial.extractor.type, team, initial.extractor.hp]] },
    resourceScales: { rateScale: 256, reserveScale: 256 }, resourceInitialIncome: Array(8).fill(0),
    resourceLifecycle: { animations: evidence.animations, types: evidence.profiles.bindings.map((profile) => ({
      unitType: profile.unitType, stand: String(profile.standBank), deploy: String(profile.deployBank), death: String(profile.deathBank),
      deathVariants: profile.deathVariants, removalHoldField: profile.removalHoldField, selectedWeapon: profile.selectedWeapon | 0 })),
      bindings: [bind(initial.source, 152), bind(initial.extractor, 153)] } };
  const session = new CampaignSession(options);
  const resourceFrameSource = { teams: options.source.teams.map(({ index }) => ({ index, ai: 0 })),
    aiMultipliers: Array(8).fill(256), localTeam: team, cancellationGate: 0 };
  const dependency = records.find((entry) => entry.rawFields[0] === 1 && entry.rawFields[1] === 0)!.id;
  let restored: CampaignSession | undefined;
  for (let tick = 0; tick < 40; tick += 1) {
    const extra: Partial<CampaignSessionInput> = { resourceFrameSource, ...(tick === 0 ? { campaignAiRequest: fixture.request,
      productionCommands: [{ id: "player-income-pending", team, action: { type: "reserve" as const, dependency } }] } : {}) };
    const frame = sessionStep(session, extra);
    if (restored) assert.deepEqual(sessionStep(restored, extra), frame);
    const credits = 300 + frame.world.statistics[`${team},1`];
    assert.equal(frame.production!.teams[0].credits, credits);
    assert.equal(frame.world.exomoney[team], credits);
    assert.equal(data(Uint8Array.from(frame.campaignAi!.buffers.teamBytes)).getInt32(0x14, true), credits);
    assert.equal(frame.production!.teams[0].pending[dependency], 1);
    if (tick === 24) restored = CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint())), options.campaignAi);
  }
  assert.ok(session.snapshot.world.statistics[`${team},1`] > 0);
  assert.deepEqual(CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint())), options.campaignAi).snapshot, session.snapshot);
});
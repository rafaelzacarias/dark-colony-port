import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { authenticateLegacyNativeSchedulerSource } from "../../src/engine/legacy-native-scheduler";
import { transactSourceNativePolicyPhase } from "../../src/engine/native-scheduler-host";
import { consumeSourceNativePolicy, createSourceNativePolicy } from "../../src/engine/source-native-policy";

type Snapshot = { policy: string; entities: string; teamBytes: string; rngCursor: number;
  forceOrder: number; policyAddress: number };
type Policy = { counter: number; team: number; before: Snapshot; after: Snapshot; packets: string[];
  population: number; populationLimit: number; ruleTable: string;
  navigation: { width: number; height: number; families: number[]; nextFamily: string };
  inputs: { types: string; weapons: string; dependencies: string; cityDependencies: number[];
    matrix: number[][]; relations: number[]; visibilityMasks: number[]; occupancy: number[]; neighbors: string } };
type Capture = { fullPolicies: Policy[]; acceptance: { completeWorldHistory: boolean };
  events: { phase: string; counter: number; team?: number; rngCursor: number }[] };
const root = new URL("../../", import.meta.url);
const path = process.env.DC_NATIVE_SCHEDULER_POLICY_TRACE;
const capture = JSON.parse(path ? readFileSync(path, "utf8") : execFileSync("python3", ["-B",
  "tools/qa/native-scheduler-native.py", "--mission", "ALIEN", "--updates", "1200", "--from-counter", "1152"], {
  cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
})) as Capture;
const source = await authenticateLegacyNativeSchedulerSource(readFileSync(new URL("raw_cd/DC/DC.EXE", root)));
const decode = (value: string) => Uint8Array.from(Buffer.from(value, "base64"));
function fixture(policy: Policy) {
  const entry = capture.events.find(event => event.counter === policy.counter
    && event.phase === "ai-selector" && event.team === policy.team)!;
  assert.ok(entry);
  return { state: { policy: decode(policy.before.policy), entities: decode(policy.before.entities),
    rngCursor: entry.rngCursor, forceOrder: policy.before.forceOrder,
    navigation: { ...policy.navigation, families: Uint8Array.from(policy.navigation.families),
      nextFamily: decode(policy.navigation.nextFamily) } },
  inputs: { ...policy.inputs, types: decode(policy.inputs.types), weapons: decode(policy.inputs.weapons),
    dependencies: decode(policy.inputs.dependencies), relations: Uint8Array.from(policy.inputs.relations),
    neighbors: decode(policy.inputs.neighbors), groundCells: Uint32Array.from(policy.inputs.occupancy),
    team: policy.team, teamBytes: decode(policy.before.teamBytes), population: policy.population,
    populationLimit: policy.populationLimit, rngTable: source.rngTable, actorTransport: "synchronous" as const,
    initialization: policy.before.policyAddress === 0
      ? { needed: true as const, policyAddress: policy.after.policyAddress, ruleTable: decode(policy.ruleTable) }
      : { needed: false as const } } };
}

test("host: native selector-policy phase commits exact bytes and synchronous nonempty actor receipts", () => {
  assert.equal(capture.acceptance.completeWorldHistory, true);
  assert.ok(capture.fullPolicies.length >= 2);
  let targetedCalls = 0;
  for (const policy of capture.fullPolicies) {
    const { state, inputs } = fixture(policy), before = structuredClone({ state, inputs });
    const transaction = transactSourceNativePolicyPhase(source, state, inputs);
    const { result } = transaction;
    assert.equal(transaction.selection.rngCursor, policy.before.rngCursor);
    assert.deepEqual(result.candidate.policy, decode(policy.after.policy));
    assert.deepEqual(result.candidate.entities, decode(policy.after.entities));
    assert.deepEqual(result.teamBytes, decode(policy.after.teamBytes));
    assert.equal(result.candidate.rngCursor, policy.after.rngCursor);
    assert.equal(result.candidate.forceOrder, policy.after.forceOrder);
    assert.deepEqual(result.packets.map(packet => Buffer.from(packet.packet).toString("hex")), policy.packets);
    if (result.packets.some(packet => packet.kind === "actor-order" && packet.orders.some(order =>
      order.mode === 5 || order.slots.length > 0))) targetedCalls++;
    assert.deepEqual({ state, inputs }, before);
    assert.equal(transaction.admitted, false);
  }
  assert.ok(targetedCalls > 0);
});

test("host: controlled funded unrestricted team requiring production rejects without any partial receipt", () => {
  const { state, inputs } = fixture(capture.fullPolicies[0]);
  new DataView(inputs.teamBytes.buffer).setInt32(0x14, 100000, true);
  inputs.teamBytes.fill(0, 0x78, 0x87);
  inputs.teamBytes.fill(0, 0xda4, 0xda4 + 110);
  const before = structuredClone({ state, inputs });
  assert.throws(() => transactSourceNativePolicyPhase(source, state, inputs), /Unsupported native scheduler phase ai: synchronous (unit|city) production receipt/);
  assert.deepEqual({ state, inputs }, before);
});

test("policy adapter: real owner identity and privately retained tables survive caller mutations", () => {
  const policy = capture.fullPolicies[0], { state, inputs } = fixture(policy);
  const owner = createSourceNativePolicy({ source, team: policy.team, policyAddress: policy.after.policyAddress,
    tables: { ...inputs, ruleTable: decode(policy.ruleTable) }, navigation: state.navigation });
  const frame = { ...state, teamBytes: inputs.teamBytes, population: inputs.population, populationLimit: inputs.populationLimit,
    relations: inputs.relations, visibilityMasks: inputs.visibilityMasks, groundCells: inputs.groundCells };
  inputs.types.fill(0);
  inputs.neighbors.fill(0);
  state.navigation.families.fill(0);
  const result = consumeSourceNativePolicy(owner, source, frame);
  assert.deepEqual(result.result.candidate.policy, decode(policy.after.policy));
  assert.deepEqual(result.result.candidate.entities, decode(policy.after.entities));
  assert.throws(() => consumeSourceNativePolicy({ ...owner }, source, frame), /original owner\/source identity/);
  assert.throws(() => consumeSourceNativePolicy(owner, { ...source }, frame), /original owner\/source identity/);
  const shared = new Uint8Array(new SharedArrayBuffer(frame.entities.length));
  shared.set(frame.entities);
  assert.throws(() => consumeSourceNativePolicy(owner, source, { ...frame, entities: shared }), /unshared/);
});
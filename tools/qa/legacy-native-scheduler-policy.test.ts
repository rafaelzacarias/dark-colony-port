import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { computeLegacyAiFullPolicy } from "../../src/engine/legacy-ai-policy";
import { authenticateLegacyNativeSchedulerSource, selectLegacyNativePolicy } from "../../src/engine/legacy-native-scheduler";

type Snapshot = { policy: string; entities: string; teamBytes: string; rngCursor: number;
  forceOrder: number; policyAddress: number };
type Policy = { counter: number; team: number; before: Snapshot; after: Snapshot; packets: string[];
  population: number; populationLimit: number; ruleTable: string;
  navigation: { width: number; height: number; families: number[]; nextFamily: string };
  inputs: { types: string; weapons: string; dependencies: string; cityDependencies: number[];
    matrix: number[][]; relations: number[]; visibilityMasks: number[]; occupancy: number[]; neighbors: string } };
type Capture = { mission: string; fullPolicies: Policy[]; acceptance: { completeWorldHistory: boolean };
  events: { phase: string; counter: number; team?: number; rngCursor: number }[] };
const root = new URL("../../", import.meta.url);
const path = process.env.DC_NATIVE_SCHEDULER_POLICY_TRACE;
const capture = JSON.parse(path ? readFileSync(path, "utf8") : execFileSync("python3", ["-B",
  "tools/qa/native-scheduler-native.py", "--mission", "ALIEN", "--updates", "1200", "--from-counter", "1152"], {
  cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
})) as Capture;
const source = await authenticateLegacyNativeSchedulerSource(readFileSync(new URL("raw_cd/DC/DC.EXE", root)));
const decode = (value: string) => Buffer.from(value, "base64");

test(`${capture.mission}: natural target policy captures are nonvacuous`, () => {
  assert.equal(capture.acceptance.completeWorldHistory, true);
  assert.ok(capture.fullPolicies.length >= 2);
  assert.ok(capture.fullPolicies.some((policy) => policy.before.policyAddress === 0));
  assert.ok(capture.fullPolicies.some((policy) => policy.before.policyAddress !== 0));
  assert.ok(capture.fullPolicies.some((policy) => policy.packets.some((packet) => Buffer.from(packet, "hex").length > 11)));
});

for (const policy of capture.fullPolicies) {
  test(`${capture.mission}: native scheduler -> selector -> full policy at ${policy.counter}`, () => {
    const entry = capture.events.find((event) => event.counter === policy.counter
      && event.phase === "ai-selector" && event.team === policy.team)!;
    assert.ok(entry);
    const selected = selectLegacyNativePolicy(source, { mode: 3, weights: [1], rngCursor: entry.rngCursor });
    assert.equal(selected.action, 0x44be40);
    assert.equal(selected.rngCursor, policy.before.rngCursor);
    const state = { policy: decode(policy.before.policy), entities: decode(policy.before.entities),
      rngCursor: selected.rngCursor, forceOrder: policy.before.forceOrder,
      navigation: { ...policy.navigation, families: Uint8Array.from(policy.navigation.families),
        nextFamily: decode(policy.navigation.nextFamily) } };
    const result = computeLegacyAiFullPolicy(state, { ...policy.inputs,
      types: decode(policy.inputs.types), weapons: decode(policy.inputs.weapons),
      dependencies: decode(policy.inputs.dependencies), relations: Uint8Array.from(policy.inputs.relations),
      neighbors: decode(policy.inputs.neighbors), groundCells: Uint32Array.from(policy.inputs.occupancy),
      team: policy.team, teamBytes: decode(policy.before.teamBytes), population: policy.population,
      populationLimit: policy.populationLimit, rngTable: source.rngTable, actorTransport: "synchronous",
      initialization: policy.before.policyAddress === 0
        ? { needed: true, policyAddress: policy.after.policyAddress, ruleTable: decode(policy.ruleTable) }
        : { needed: false } });
    assert.deepEqual(Buffer.from(result.candidate.policy), decode(policy.after.policy), "whole native policy");
    assert.deepEqual(Buffer.from(result.candidate.entities), decode(policy.after.entities), "all 800 raw actors");
    assert.deepEqual(Buffer.from(result.teamBytes), decode(policy.after.teamBytes), "complete native team");
    assert.equal(result.candidate.rngCursor, policy.after.rngCursor);
    assert.equal(result.candidate.forceOrder, policy.after.forceOrder);
    assert.deepEqual(result.packets.map((packet) => Buffer.from(packet.packet).toString("hex")), policy.packets);
    assert.ok(result.packets.every((packet) => packet.kind === "actor-order"), "production receipts require their own consumer");
    assert.deepEqual(state.policy, decode(policy.before.policy));
    assert.deepEqual(state.entities, decode(policy.before.entities));
    assert.equal(result.admitted, false);
    assert.equal(result.productionLifecycleExecuted, false);
  });
}
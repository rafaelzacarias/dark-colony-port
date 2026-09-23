import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { initializeLegacyAiPolicy, consumeLegacyAiPreparation, consumeLegacyAiObservation,
  consumeLegacyAiAssignment, consumeLegacyAiGroupOne } from "../../src/engine/legacy-ai";

const trace = process.env.DC_AI_ACTIVE_TRACE ? readFileSync(process.env.DC_AI_ACTIVE_TRACE, "utf8")
  : execFileSync("python3", ["-B", "tools/research/ai-policy-20260919.py", "--active-consumer-goldens"], {
    cwd: new URL("../../", import.meta.url), encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
  });
type Snapshot = { policy: string; entities: string; forceOrder: number; rngCursor: number };
type Capture = { callback: string; group: number; before: Snapshot; after: Snapshot; packets: string[] };
type Golden = { mission: string; team: number; captures: Capture[]; groupInvocation: Capture;
  activeControls: (Capture & { control: string; actor: number; families: string;
    inputs: { occupancy: number[]; visibilityMasks: number[]; relations: number[] } })[];
  navigation: { width: number; height: number; families: string; nextFamily: string };
  inputs: { types: string; weapons: string; matrix: number[][]; relations: number[];
    visibilityMasks: number[]; occupancy: number[]; teamBytes: string; dependencies: string; rngTable: number[];
    rules: string; initializedPolicy: string } };
const goldens = trace.trim().split("\n").map((line) => JSON.parse(line) as Golden);
const decode = (value: string) => Buffer.from(value, "base64");
function fixture(golden: Golden, capture: Capture) {
  return {
    state: { policy: decode(capture.before.policy), entities: decode(capture.before.entities),
      forceOrder: capture.before.forceOrder, navigation: { ...golden.navigation,
        families: decode(golden.navigation.families), nextFamily: decode(golden.navigation.nextFamily) } },
    inputs: { ...golden.inputs, team: golden.team, types: decode(golden.inputs.types),
      weapons: decode(golden.inputs.weapons), relations: Uint8Array.from(golden.inputs.relations),
      teamBytes: decode(golden.inputs.teamBytes), dependencies: decode(golden.inputs.dependencies) },
  };
}

test("observation matches every original policy and entity byte on source maps", () => {
  for (const golden of goldens) {
    const capture = golden.captures.find(({ callback }) => callback === "0x456ad0")!;
    const { state, inputs } = fixture(golden, capture);
    const output = consumeLegacyAiObservation(state, inputs);
    assert.deepEqual(state.policy, decode(capture.after.policy), `${golden.mission} policy`);
    assert.deepEqual(state.entities, decode(capture.after.entities), `${golden.mission} entities`);
    assert.deepEqual(output.packets, []);
    assert.equal(capture.before.rngCursor, capture.after.rngCursor);
  }
});

test("policy initializer computes source PTH regions and encodes native callbacks without replay", () => {
  for (const golden of goldens) {
    const { state, inputs } = fixture(golden, golden.captures[0]);
    state.policy.fill(0);
    initializeLegacyAiPolicy(state, inputs, decode(golden.inputs.rules));
    assert.deepEqual(state.policy, decode(golden.inputs.initializedPolicy), golden.mission);
    const first = golden.captures.find(({ callback }) => callback === "0x457568")!;
    assert.deepEqual(state.policy, decode(first.before.policy));
    const prepared = consumeLegacyAiPreparation(state, inputs);
    const observed = golden.captures.find(({ callback }) => callback === "0x456ad0")!;
    assert.deepEqual(state.policy, decode(observed.after.policy));
    assert.deepEqual(state.entities, decode(observed.after.entities));
    assert.equal(prepared.nextCallback, 0x457940);
    assert.equal(prepared.admitted, false);
  }
});

test("both assignment invocations match original quotas, bucket counters and entity links", () => {
  for (const golden of goldens) {
    for (const capture of golden.captures.filter(({ callback }) => callback === "0x457568")) {
      const { state, inputs } = fixture(golden, capture);
      consumeLegacyAiAssignment(state, inputs);
      assert.deepEqual(state.policy, decode(capture.after.policy), `${golden.mission} policy`);
      assert.deepEqual(state.entities, decode(capture.after.entities), `${golden.mission} entities`);
    }
  }
});

test("complete bounded group-1 invocation returns native mode-7 packets and next group", () => {
  for (const golden of goldens) {
    const decision = golden.groupInvocation;
    const orders = golden.groupInvocation;
    const { state } = fixture(golden, decision);
    const active = { ...state, rngCursor: decision.before.rngCursor };
    const output = consumeLegacyAiGroupOne(active, golden.inputs.rngTable);
    assert.deepEqual(active.policy, decode(orders.after.policy));
    assert.deepEqual(active.entities, decode(orders.after.entities));
    assert.equal(active.rngCursor, orders.after.rngCursor);
    assert.equal(active.forceOrder, orders.after.forceOrder);
    assert.deepEqual(output.packets.map((packet) => Buffer.from(packet).toString("hex")), orders.packets);
    assert.equal(output.nextGroup, 2);
    assert.equal(output.completeInvocation, true);
    assert.equal(output.admitted, false);
  }
});

test("native observation controls preserve same-family ownership, allied visibility and remembered actors", () => {
  for (const golden of goldens) {
    const controls = golden.activeControls.filter(({ callback }) => callback === "0x456ad0");
    assert.equal(controls.length, 8);
    for (const capture of controls) {
      const { state, inputs } = fixture(golden, capture);
      Object.assign(inputs, capture.inputs, { relations: Uint8Array.from(capture.inputs.relations) });
      state.navigation.families = decode(capture.families);
      consumeLegacyAiObservation(state, inputs);
      assert.deepEqual(state.policy, decode(capture.after.policy), `${golden.mission} ${capture.control}`);
      assert.deepEqual(state.entities, decode(capture.after.entities), `${capture.control} preserves all entity bytes`);
      if (capture.control === "dead-visible-memory-clear") assert.equal(state.policy[0x1204 + capture.actor * 4], 255);
    }
  }
});

test("native patterned allocation seeds and assignment negatives preserve every unrelated byte", () => {
  for (const golden of goldens) {
    const controls = golden.activeControls.filter(({ callback }) => callback !== "0x456ad0");
    assert.equal(controls.length, 5);
    for (const capture of controls) {
      const { state, inputs } = fixture(golden, capture);
      if (capture.callback === "0x44bd2c") initializeLegacyAiPolicy(state, inputs, decode(golden.inputs.rules));
      else {
        const output = consumeLegacyAiAssignment(state, inputs);
        assert.ok(output.assigned.every(({ slot }) => slot !== capture.actor));
      }
      assert.deepEqual(state.policy, decode(capture.after.policy), `${golden.mission} ${capture.control} policy`);
      assert.deepEqual(state.entities, decode(capture.after.entities), `${golden.mission} ${capture.control} entities`);
    }
  }
});

test("invalid group routes and late preparation failures roll back the complete transaction", () => {
  for (const golden of goldens) {
    const { state, inputs } = fixture(golden, golden.groupInvocation);
    const active = { ...state, rngCursor: golden.inputs.rngTable.findIndex((_, cursor) => (golden.inputs.rngTable[(cursor + 1) & 255] & 15) === 0) };
    for (let region = 1; region < 255; region++) state.policy[region * 18 + 13] = 255;
    const before = [Buffer.from(state.policy), Buffer.from(state.entities), active.rngCursor, active.forceOrder];
    assert.throws(() => consumeLegacyAiGroupOne(active, golden.inputs.rngTable), /no rank-below-2 candidate/);
    assert.deepEqual([state.policy, state.entities, active.rngCursor, active.forceOrder], before);
    active.rngCursor = golden.groupInvocation.before.rngCursor;
    state.policy[0x6a74] = 1;
    state.policy[0x6a75] = 42;
    state.navigation.nextFamily.fill(0);
    const held = Buffer.from(state.policy);
    assert.throws(() => consumeLegacyAiGroupOne(active, golden.inputs.rngTable), /Cyclic native group-1 route/);
    assert.deepEqual(state.policy, held);
    assert.deepEqual(state.entities, before[1]);
    state.policy.set(decode(golden.captures[0].before.policy));
    state.entities.set(decode(golden.captures[0].before.entities));
    const untouched = [Buffer.from(state.policy), Buffer.from(state.entities)];
    inputs.occupancy = [];
    assert.throws(() => consumeLegacyAiPreparation(state, inputs), RangeError);
    assert.deepEqual([state.policy, state.entities], untouched);
  }
});
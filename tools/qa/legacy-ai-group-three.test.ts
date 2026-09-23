import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { consumeLegacyAiGroupThree } from "../../src/engine/legacy-ai-group-three";
import { consumeLegacyAiGroupPrelude } from "../../src/engine/legacy-ai";

type Snapshot = { policy: string; entities: string; rngCursor: number; forceOrder: number };
type Golden = {
  mission: string; team: number; neighbors: string; rngTable: number[]; sourceTypes: string;
  bodies: { address: number; bytes: string }[];
  navigation: { width: number; height: number; families: string; nextFamily: string };
  cases: { label: string; before: Snapshot; after: Snapshot; packets: string[];
    events: ({ callback: number } | { rngCursor: number } | { packet: string })[];
    branches: number[]; stages: { callback: number; after: Snapshot }[];
    assignment?: { unitType: number; count: number; membership: { slot: number; group: number; bucket: number; type: number }[] };
    historical?: { originalReceivedEntitiesMatched: boolean; originalPolicyMatched: boolean; localEntitiesMatched: boolean } }[];
};
const trace = process.env.DC_AI_GROUP_THREE_TRACE ? readFileSync(process.env.DC_AI_GROUP_THREE_TRACE, "utf8")
  : execFileSync("python3", ["-B", "tools/research/ai-group-three-20260919.py",
    ...(JSON.parse(process.env.DC_AI_GROUP_THREE_NATURAL_TRACES ?? "[]") as string[])
      .flatMap((path) => ["--natural-trace", path])], {
    cwd: new URL("../../", import.meta.url), encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
  });
const goldens = trace.trim().split("\n").map((line) => JSON.parse(line) as Golden);
const decode = (value: string) => Buffer.from(value, "base64");
function fixture(golden: Golden, before: Snapshot) {
  return { state: { ...before, policy: decode(before.policy), entities: decode(before.entities),
    navigation: { ...golden.navigation, families: decode(golden.navigation.families), nextFamily: decode(golden.navigation.nextFamily) } },
  inputs: { team: golden.team, neighbors: decode(golden.neighbors), rngTable: golden.rngTable } };
}
for (const golden of goldens) {
  for (const capture of golden.cases) {
    test(`${golden.mission} group 3 ${capture.label}: all bytes, force, RNG, packets and event order`, () => {
      const { state, inputs } = fixture(golden, capture.before);
      const result = consumeLegacyAiGroupThree(state, inputs);
      assert.deepEqual(state.policy, decode(capture.after.policy), "every policy byte");
      assert.deepEqual(state.entities, decode(capture.after.entities), "every entity byte");
      assert.equal(state.forceOrder, capture.after.forceOrder);
      assert.equal(state.rngCursor, capture.after.rngCursor);
      assert.deepEqual(result.packets.map((packet) => Buffer.from(packet).toString("hex")), capture.packets);
      assert.deepEqual(result.events.map((event) => "packet" in event
        ? { packet: Buffer.from(event.packet).toString("hex") } : event), capture.events);
      assert.equal(result.rngDraws, capture.events.filter((event) => "rngCursor" in event).length);
      assert.equal(result.completeInvocation, true);
      assert.equal(result.groupsCompleted, 1);
      assert.equal(result.nextGroup, null);
      assert.equal(result.admitted, false);
      assert.deepEqual(result.completedCallbacks, [0x459f24, 0x44bbdc, 0x44b920, 0x459f80]);
      if (capture.stages.length) {
        const initial = fixture(golden, capture.before).state;
        consumeLegacyAiGroupPrelude(initial.policy, initial.entities, 3);
        assert.deepEqual(initial.policy, decode(capture.stages[1].after.policy));
        assert.deepEqual(initial.entities, decode(capture.stages[1].after.entities));
        assert.deepEqual(capture.stages[1].after, capture.stages[2].after, "maintenance is a native no-op");
      }
      if (capture.assignment) {
        const { unitType, count, membership } = capture.assignment;
        assert.equal(membership.length, unitType === 41 || unitType === 42 ? 0 : count);
        const expectedGroup = [0, 8, 5, 13].includes(unitType) ? 3
          : [6, 14].includes(unitType) ? 0 : [1, 9].includes(unitType) ? 1 : undefined;
        for (const member of membership) {
          assert.equal(member.type, unitType);
          if (expectedGroup !== undefined) assert.equal(member.group, expectedGroup);
          else assert.ok(member.group === 1 || member.group === 2);
        }
        assert.equal(result.membersVisited, membership.filter((member) => member.group === 3).length);
      }
      if (capture.historical) {
        assert.equal(capture.historical.originalPolicyMatched, true);
        assert.equal(capture.historical.originalReceivedEntitiesMatched, true);
        assert.equal(capture.historical.localEntitiesMatched, true);
      }
    });
  }
  test(`${golden.mission} native coverage includes actual bodies, both opcodes and dynamic lists/resources`, () => {
    assert.equal(decode(golden.sourceTypes).length, 110 * 280);
    assert.equal(decode(golden.bodies.find((body) => body.address === 0x459f80)!.bytes).length, 0x7a1);
    const covered = new Set(golden.cases.flatMap((capture) => capture.branches));
    for (const address of [0x459ffe, 0x45a021, 0x45a123, 0x45a130, 0x45a1e9,
      0x45a2aa, 0x45a2d0, 0x45a2f3, 0x45a325, 0x45a3da, 0x45a420,
      0x45a477, 0x45a628, 0x45a652, 0x45a675, 0x45a692, 0x45a69d, 0x45a6d2, 0x45a6d6]) {
      assert.ok(covered.has(address), address.toString(16));
    }
    if (golden.mission === "HUMAN02") assert.ok(covered.has(0x45a65d));
    for (const count of [0, 1, 4, 9, 49, 128, 648]) {
      const capture = golden.cases.find((entry) => entry.label === `member-count-${count}`)!;
      const { state, inputs } = fixture(golden, capture.before);
      assert.equal(consumeLegacyAiGroupThree(state, inputs).membersVisited, count);
    }
    const reservoir = golden.cases.find((entry) => entry.label === "resource-257")!;
    assert.equal(reservoir.events.filter((event) => "rngCursor" in event).length, 259);
    const cancelled = golden.cases.find((entry) => entry.label === "resource-signed-cancel")!;
    assert.ok(!cancelled.branches.includes(0x45a628));
    for (const capture of golden.cases.filter((entry) => entry.label.startsWith("source-type-"))) {
      const type = Number(capture.label.slice("source-type-".length));
      assert.equal(capture.packets.length, 1);
      assert.equal(Buffer.from(capture.packets[0], "hex")[15], type === 5 || type === 13 ? 2 : 7);
    }
  });
  test(`${golden.mission} invalid and late diagnostic paths roll back every writable field`, () => {
    for (const corrupt of ["callback", "cycle", "state-zero", "late-mode", "late-map", "neighbors", "rng", "alias", "random-cycle"]) {
      const capture = golden.cases.find((entry) => entry.label === "cleanup-mixed")!;
      const { state, inputs } = fixture(golden, capture.before);
      if (corrupt === "callback") state.policy.writeUInt32LE(0, 3 * 0x12fc + 0x3170);
      if (corrupt === "cycle") state.entities.writeInt16LE(796, 799 * 220 + 0xd2);
      if (corrupt === "state-zero") state.entities[797 * 220 + 0x2c] = 0;
      if (corrupt === "late-mode") state.entities[797 * 220 + 0xcc] = 2;
      if (corrupt === "late-map") {
        state.entities[797 * 220 + 0xcc] = 6;
        state.entities.writeUInt16LE(255 << 8, 797 * 220 + 4);
      }
      if (corrupt === "neighbors") inputs.neighbors[0] = 32;
      if (corrupt === "rng") inputs.rngTable = [1];
      if (corrupt === "alias") inputs.neighbors = state.entities.subarray(0, 8192);
      if (corrupt === "random-cycle") {
        inputs.rngTable = Array(256).fill(1);
        state.navigation.families.fill(0);
      }
      const before = { policy: Buffer.from(state.policy), entities: Buffer.from(state.entities),
        forceOrder: state.forceOrder, rngCursor: state.rngCursor };
      assert.throws(() => consumeLegacyAiGroupThree(state, inputs), RangeError, corrupt);
      assert.deepEqual({ policy: state.policy, entities: state.entities,
        forceOrder: state.forceOrder, rngCursor: state.rngCursor }, before, corrupt);
    }
  });
  test(`${golden.mission} disjoint subviews commit without changing guards or source data`, () => {
    const capture = golden.cases.find((entry) => entry.label === "resource-danger")!;
    const { state, inputs } = fixture(golden, capture.before);
    const backing = Buffer.alloc(state.policy.length + state.entities.length + 32, 0xa7);
    state.policy.copy(backing, 16);
    state.entities.copy(backing, 16 + state.policy.length);
    state.policy = backing.subarray(16, 16 + state.policy.length);
    state.entities = backing.subarray(16 + state.policy.length, backing.length - 16);
    const sources = [inputs.neighbors, state.navigation.families, state.navigation.nextFamily];
    const before = sources.map((source) => Buffer.from(source)), rng = [...inputs.rngTable];
    consumeLegacyAiGroupThree(state, inputs);
    assert.deepEqual(state.policy, decode(capture.after.policy));
    assert.deepEqual(state.entities, decode(capture.after.entities));
    assert.deepEqual(sources, before);
    assert.deepEqual(inputs.rngTable, rng);
    assert.ok(backing.subarray(0, 16).every((value) => value === 0xa7));
    assert.ok(backing.subarray(-16).every((value) => value === 0xa7));
  });
}
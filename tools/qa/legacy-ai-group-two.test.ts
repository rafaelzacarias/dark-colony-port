import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { consumeLegacyAiGroupTwo } from "../../src/engine/legacy-ai";

type Snapshot = { policy: string; entities: string; rngCursor: number; forceOrder: number };
type Golden = {
  mission: string;
  navigation: { width: number; height: number; families: string; nextFamily: string };
  inputs: { team: number; types: string; weapons: string; neighbors: string; matrix: number[][] };
  cases: { label: string; before: Snapshot; after: Snapshot; packets: string[];
    historical?: { originalPolicyMatched: boolean; originalReceivedEntitiesMatched: boolean;
      localEntitiesMatched: boolean; packetSubsequenceMatched: boolean };
    events: ({ callback: number } | { packet: string })[] }[];
};
const trace = process.env.DC_AI_GROUP_TWO_TRACE ? readFileSync(process.env.DC_AI_GROUP_TWO_TRACE, "utf8")
  : execFileSync("python3", ["-B", "tools/research/ai-group-two-20260919.py",
    ...(JSON.parse(process.env.DC_AI_GROUP_TWO_NATURAL_TRACES ?? "[]") as string[])
      .flatMap((path) => ["--natural-trace", path])], {
    cwd: new URL("../../", import.meta.url), encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
  });
const goldens = trace.trim().split("\n").map((line) => JSON.parse(line) as Golden);
const decode = (value: string) => Buffer.from(value, "base64");
function fixture(golden: Golden, before: Snapshot) {
  return { state: { ...before, policy: decode(before.policy), entities: decode(before.entities),
    navigation: { ...golden.navigation, families: decode(golden.navigation.families), nextFamily: decode(golden.navigation.nextFamily) } },
  inputs: { ...golden.inputs, types: decode(golden.inputs.types), weapons: decode(golden.inputs.weapons),
    neighbors: decode(golden.inputs.neighbors) } };
}
for (const golden of goldens) {
  for (const capture of golden.cases) {
    test(`${golden.mission} group 2 ${capture.label}: full buffers, packets, callback order and zero RNG`, () => {
      const { state, inputs } = fixture(golden, capture.before);
      const result = consumeLegacyAiGroupTwo(state, inputs);
      assert.deepEqual(state.policy, decode(capture.after.policy), "every policy byte");
      assert.deepEqual(state.entities, decode(capture.after.entities), "every entity byte");
      assert.equal(state.forceOrder, capture.after.forceOrder);
      assert.equal(state.rngCursor, capture.after.rngCursor);
      assert.equal(state.rngCursor, capture.before.rngCursor);
      assert.deepEqual(result.packets.map((packet) => Buffer.from(packet).toString("hex")), capture.packets);
      assert.deepEqual(result.events.map((event) => "packet" in event
        ? { packet: Buffer.from(event.packet).toString("hex") } : event), capture.events);
      assert.equal(result.completeInvocation, true);
      assert.equal(result.groupsCompleted, 1);
      const beforePolicy = decode(capture.before.policy);
      assert.equal(result.enabledBuckets, Array.from({ length: 16 }, (_, bucket) =>
        beforePolicy[2 * 0x12fc + bucket * 300 + 0x1e95]).filter(Boolean).length);
      assert.deepEqual(result.completedCallbacks, [0x4578a0, 0x44bbec, 0x458b44, 0x463e78]);
      assert.equal(result.nextGroup, 3);
      assert.equal(result.rngDraws, 0);
      assert.equal(result.admitted, false);
      if (capture.label === "no-buckets") {
        assert.equal(result.enabledBuckets, 0);
        assert.deepEqual(result.packets, []);
      }
      if (capture.label.startsWith("sixteen")) assert.equal(result.enabledBuckets, 16);
      if (capture.historical) {
        assert.equal(capture.historical.originalPolicyMatched, true);
        assert.equal(capture.historical.originalReceivedEntitiesMatched, true);
        assert.equal(capture.historical.localEntitiesMatched, golden.mission === "HUMAN02");
        assert.equal(capture.historical.packetSubsequenceMatched, true);
      }
    });
  }
  test(`${golden.mission} oracle exercises decisions, actor packets and native helper boundaries`, () => {
    for (const label of ["direct-target", "weighted-target", "weighted-rejected", "rank-blocked", "quota-met", "quota-unmet", "cleanup"]) {
      assert.ok(golden.cases.some((capture) => capture.label === label), label);
    }
    const weighted = golden.cases.find((capture) => capture.label === "weighted-target")!;
    assert.ok(weighted.events.some((event) => "callback" in event && event.callback === 0x457cc0));
    assert.equal(decode(weighted.after.policy)[2 * 0x12fc + 0x1ea4], 0);
    assert.notEqual(decode(weighted.before.policy).readInt32LE(2 * 0x12fc + 0x1ea0),
      decode(weighted.after.policy).readInt32LE(2 * 0x12fc + 0x1ea0));
    assert.ok(golden.cases.some((capture) => capture.packets.some((packet) => Buffer.from(packet, "hex").readUInt16LE(4) > 0)));
  });
  test(`${golden.mission} late order failure and malformed graph/list roll back all writable state`, () => {
    for (const corrupt of ["order-callback", "matrix", "graph", "cycle", "alias"]) {
      const capture = golden.cases.find((entry) => entry.label === "cleanup")!;
      const { state, inputs } = fixture(golden, capture.before);
      if (corrupt === "order-callback") state.policy.writeUInt32LE(0, 2 * 0x12fc + 0x3170);
      if (corrupt === "matrix") inputs.matrix = [];
      if (corrupt === "graph") inputs.neighbors[0] = 32;
      if (corrupt === "cycle") state.entities.writeInt16LE(700, 703 * 220 + 0xd2);
      if (corrupt === "alias") inputs.types = state.entities.subarray(0, 110 * 280);
      const before = { policy: Buffer.from(state.policy), entities: Buffer.from(state.entities),
        rngCursor: state.rngCursor, forceOrder: state.forceOrder };
      assert.throws(() => consumeLegacyAiGroupTwo(state, inputs), RangeError, corrupt);
      assert.deepEqual({ policy: state.policy, entities: state.entities,
        rngCursor: state.rngCursor, forceOrder: state.forceOrder }, before, corrupt);
    }
  });
  test(`${golden.mission} disjoint buffer views preserve guards and immutable source inputs`, () => {
    const capture = golden.cases.find((entry) => entry.label === "weighted-target")!;
    const { state, inputs } = fixture(golden, capture.before);
    const backing = Buffer.alloc(state.policy.length + state.entities.length + 32, 0xa7);
    state.policy.copy(backing, 16);
    state.entities.copy(backing, 16 + state.policy.length);
    state.policy = backing.subarray(16, 16 + state.policy.length);
    state.entities = backing.subarray(16 + state.policy.length, backing.length - 16);
    const sourceBuffers = [inputs.types, inputs.weapons, inputs.neighbors, state.navigation.families, state.navigation.nextFamily];
    const originalBuffers = sourceBuffers.map((buffer) => Buffer.from(buffer));
    consumeLegacyAiGroupTwo(state, inputs);
    assert.deepEqual(state.policy, decode(capture.after.policy));
    assert.deepEqual(state.entities, decode(capture.after.entities));
    assert.deepEqual(sourceBuffers, originalBuffers);
    assert.ok(backing.subarray(0, 16).every((value) => value === 0xa7));
    assert.ok(backing.subarray(-16).every((value) => value === 0xa7));
  });
}
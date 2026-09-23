import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { consumeLegacyAiGroupZero } from "../../src/engine/legacy-ai-group-zero";

type Snapshot = { policy: string; entities: string; rngCursor: number; forceOrder: number };
type Capture = {
  label: string; before: Snapshot; after: Snapshot; packets: string[];
  rngAccesses: unknown[];
  historical?: { originalPolicyMatched: boolean; originalEntitiesMatched: boolean; emptyCanonicalGroup: boolean };
  events: ({ callback: number } | { packet: string })[];
  inputs: { groundCells: string; neighbors: string };
  navigation: { width: number; height: number; families: string; nextFamily: string };
};
type Golden = { mission: string; binarySha256: string; sourceHashes: string[]; cases: Capture[] };
const trace = process.env.DC_AI_GROUP_ZERO_TRACE ? readFileSync(process.env.DC_AI_GROUP_ZERO_TRACE, "utf8")
  : execFileSync("python3", ["-B", "tools/research/ai-group-zero-20260919.py",
    ...(JSON.parse(process.env.DC_AI_GROUP_ZERO_NATURAL_TRACES ?? "[]") as string[])
      .flatMap((path) => ["--natural-trace", path])], {
    cwd: new URL("../../", import.meta.url), encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
  });
const goldens = trace.trim().split("\n").map((line) => JSON.parse(line) as Golden);
const decode = (value: string) => Buffer.from(value, "base64");
function fixture(capture: Capture) {
  const ground = decode(capture.inputs.groundCells);
  return { state: { ...capture.before, policy: decode(capture.before.policy), entities: decode(capture.before.entities),
    navigation: { ...capture.navigation, families: decode(capture.navigation.families), nextFamily: decode(capture.navigation.nextFamily) } },
  inputs: { neighbors: decode(capture.inputs.neighbors),
    groundCells: Uint32Array.from({ length: ground.length / 4 }, (_, index) => ground.readUInt32LE(index * 4)) } };
}
for (const golden of goldens) {
  test(`${golden.mission} oracle pins meaningful positive and negative branches`, () => {
    const capture = (label: string) => {
      const found = golden.cases.find((entry) => entry.label === label);
      assert.ok(found, label);
      return found;
    };
    const run = (label: string) => {
      const { state, inputs } = fixture(capture(label));
      return consumeLegacyAiGroupZero(state, inputs);
    };
    assert.equal(golden.binarySha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
    for (const label of ["zero-rate", "dead", "rotting", "wrong-type", "occupied", "route-score", "no-route",
      "zero-origin", "zero-target", "empty", "cleanup-all", "all-assigned", "signed-owner", "owner-not-team",
      "allied-score", "graph-count31", "mask-isolated", "mask-two-rings", "mask-deduplicated", "mask-low-region",
      "stale-no-resource"]) assert.deepEqual(capture(label).packets, [], label);
    for (const label of ["baseline", "own-score", "unowned-score", "same-family", "high-ground-bits",
      "graph-count0-tail", "mask-third-ring", "rank255", "fractional-target", "status2"]) {
      assert.equal(capture(label).packets.length, 1, label);
    }
    const preferredSlot = golden.mission === "HUMAN02" ? 302 : 300;
    assert.equal(run("rank-tie").selectedResource, preferredSlot);
    assert.equal(run("rank255").selectedResource, preferredSlot);
    assert.equal(run("rank-unsigned").selectedResource, golden.mission === "HUMAN02" ? 303 : 301);
    assert.equal(run("slot0").selectedResource, 0);
    assert.equal(run("slot799").selectedResource, 799);
    assert.equal(run("last-unassigned").selectedMember, 200);
    assert.equal(run("cleanup").selectedMember, 201);
    assert.deepEqual(run("cleanup").removedSlots, [202, 200]);
    for (const [label, counter, packets] of [["mobile-counter9", 10, 0], ["mobile-counter10", 11, 1],
      ["mobile-counter254", 255, 1], ["mobile-counter255", 0, 0], ["mobile-moved", 0, 0],
      ["deploy47", 61, 0], ["deploy48", 61, 0]] as const) {
      assert.equal(decode(capture(label).after.entities)[200 * 220 + 0xcf], counter, label);
      assert.equal(capture(label).packets.length, packets, label);
    }
    assert.equal(decode(capture("stale-no-resource").after.entities)[200 * 220 + 0x11], 0);
    assert.equal(capture("unsafe-reassigned").packets.length, 2);
    assert.equal(capture("multiple-maintenance").packets.length, 3);
    assert.equal(Buffer.from(capture("multiple-maintenance").packets[0], "hex").readUInt16LE(10), 201);
    for (const label of ["baseline", "unsafe-reassigned", "fractional-target"]) {
      for (const hex of capture(label).packets) {
        const packet = Buffer.from(hex, "hex");
        assert.equal(packet.length, 17);
        assert.equal(packet.readUInt16LE(0), 17);
        assert.deepEqual([packet[2], packet[3], packet[12], packet[15], packet[16]], [7, 1, 5, 2, 0]);
        assert.equal(packet.readUInt16LE(10), packet.readUInt16LE(13));
      }
    }
  });
  for (const capture of golden.cases) {
    test(`${golden.mission} group 0 ${capture.label}: complete buffers, packets, order, zero RNG`, () => {
      const { state, inputs } = fixture(capture);
      const result = consumeLegacyAiGroupZero(state, inputs);
      assert.deepEqual(state.policy, decode(capture.after.policy), "every native policy byte");
      assert.deepEqual(state.entities, decode(capture.after.entities), "every native entity byte");
      assert.equal(state.rngCursor, capture.after.rngCursor);
      assert.equal(state.rngCursor, capture.before.rngCursor);
      assert.equal(state.forceOrder, capture.after.forceOrder);
      assert.deepEqual(result.packets.map((packet) => Buffer.from(packet).toString("hex")), capture.packets);
      assert.deepEqual(result.events.map((event) => "packet" in event
        ? { packet: Buffer.from(event.packet).toString("hex") } : event), capture.events);
      assert.deepEqual(result.completedCallbacks, [0x4578a0, 0x44bbdc, 0x44b920, 0x4598b0]);
      assert.equal(result.ready, true);
      assert.equal(result.completeInvocation, true);
      assert.equal(result.fullPolicy, false);
      assert.equal(result.nextGroup, 1);
      assert.equal(result.rngDraws, 0);
      assert.deepEqual(capture.rngAccesses, []);
      if (capture.historical) {
        assert.equal(capture.historical.originalPolicyMatched, true);
        assert.equal(capture.historical.originalEntitiesMatched, true);
        assert.equal(capture.historical.emptyCanonicalGroup, true);
        assert.deepEqual(result.packets, []);
      }
    });
  }
  test(`${golden.mission} invalid inputs and late failures leave the invocation atomic`, () => {
    for (const corrupt of ["callback", "cycle", "predecessor", "tail", "state0", "graph", "alias", "ground", "fallback", "path-cycle", "bounds"]) {
      const capture = golden.cases.find((entry) => entry.label === (corrupt === "fallback" ? "mobile-unsafe" : "baseline"))!;
      const { state, inputs } = fixture(capture);
      if (corrupt === "callback") state.policy.writeUInt32LE(0, 0x3170);
      if (corrupt === "cycle") state.entities.writeInt16LE(200, 200 * 220 + 0xd2);
      if (corrupt === "predecessor") state.entities.writeInt16LE(123, 200 * 220 + 0xd4);
      if (corrupt === "tail") state.policy.writeInt16LE(123, 0x1fac);
      if (corrupt === "state0") state.entities[200 * 220 + 0x2c] = 0;
      if (corrupt === "graph") inputs.neighbors[0] = 32;
      if (corrupt === "alias") inputs.neighbors = state.entities.subarray(0, 256 * 32);
      if (corrupt === "ground") inputs.groundCells = new Uint32Array(0);
      if (corrupt === "fallback") state.policy.writeInt32LE(256, 0x319c);
      if (corrupt === "bounds") state.entities.writeUInt16LE(65535, 200 * 220);
      if (corrupt === "path-cycle") {
        const tileX = state.entities.readUInt16LE(200 * 220) >>> 8;
        const tileY = state.entities.readUInt16LE(200 * 220 + 4) >>> 8;
        const origin = state.navigation.families[tileY * state.navigation.width + tileX];
        state.navigation.nextFamily.fill(origin, origin * 256, (origin + 1) * 256);
      }
      const before = { policy: Buffer.from(state.policy), entities: Buffer.from(state.entities),
        rngCursor: state.rngCursor, forceOrder: state.forceOrder };
      assert.throws(() => consumeLegacyAiGroupZero(state, inputs), RangeError, corrupt);
      assert.deepEqual({ policy: state.policy, entities: state.entities,
        rngCursor: state.rngCursor, forceOrder: state.forceOrder }, before, corrupt);
    }
  });
  test(`${golden.mission} source inputs are immutable and disjoint views preserve guards`, () => {
    const capture = golden.cases.find((entry) => entry.label === "mobile-unsafe")!;
    const { state, inputs } = fixture(capture);
    const backing = Buffer.alloc(state.policy.length + state.entities.length + 32, 0xa7);
    state.policy.copy(backing, 16);
    state.entities.copy(backing, 16 + state.policy.length);
    state.policy = backing.subarray(16, 16 + state.policy.length);
    state.entities = backing.subarray(16 + state.policy.length, backing.length - 16);
    const sources = [inputs.neighbors, inputs.groundCells, state.navigation.families, state.navigation.nextFamily];
    const before = sources.map((source) => source.slice());
    consumeLegacyAiGroupZero(state, inputs);
    assert.deepEqual(sources, before);
    assert.deepEqual(state.entities, decode(capture.after.entities));
    assert.ok(backing.subarray(0, 16).every((value) => value === 0xa7));
    assert.ok(backing.subarray(-16).every((value) => value === 0xa7));
  });
}
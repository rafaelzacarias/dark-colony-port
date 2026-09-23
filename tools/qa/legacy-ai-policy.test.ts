import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { computeLegacyAiFullPolicy, applyLegacyAiActorPacket } from "../../src/engine/legacy-ai-policy";

type Snapshot = { policy: string; entities: string; teamBytes: string; rngCursor: number; forceOrder: number };
type Golden = {
  mission: string; team: number; rngTable: number[]; ruleTable: string; neighbors: string; policyAddress: number;
  receipts: { label: string; packet: string; before: string; after: string }[];
  provenance: { kind: string; entry: string; historicalNaturalDemand: boolean; productionReceipts: string };
  navigation: { width: number; height: number; families: string; nextFamily: string };
  inputs: { types: string; weapons: string; dependencies: string; cityDependencies: number[];
    matrix: number[][]; relations: number[]; visibilityMasks: number[]; occupancy: number[] };
  cases: { label: string; actorTransport: "synchronous" | "deferred"; initialize: boolean;
    before: Snapshot; after: Snapshot; population: number; populationLimit: number; rngEvents: number[];
    packets: { stage: "demand" | 0 | 1 | 2 | 3; packet: string }[] }[];
};
const trace = process.env.DC_AI_FULL_POLICY_TRACE ? readFileSync(process.env.DC_AI_FULL_POLICY_TRACE, "utf8")
  : execFileSync("python3", ["-B", "tools/research/ai-full-policy-20260919.py"], {
    cwd: new URL("../../", import.meta.url), encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
  });
const goldens = trace.trim().split("\n").map((line) => JSON.parse(line) as Golden);
const decode = (value: string) => Buffer.from(value, "base64");
function fixture(golden: Golden, capture: Golden["cases"][number]) {
  const state = { ...capture.before, policy: decode(capture.before.policy), entities: decode(capture.before.entities),
        navigation: { ...golden.navigation, families: decode(golden.navigation.families),
          nextFamily: decode(golden.navigation.nextFamily) } };
  const inputs = { ...golden.inputs, team: golden.team, types: decode(golden.inputs.types),
        weapons: decode(golden.inputs.weapons), dependencies: decode(golden.inputs.dependencies),
        relations: Uint8Array.from(golden.inputs.relations), teamBytes: decode(capture.before.teamBytes),
        neighbors: decode(golden.neighbors), groundCells: Uint32Array.from(golden.inputs.occupancy),
        rngTable: golden.rngTable, population: capture.population, populationLimit: capture.populationLimit,
        actorTransport: capture.actorTransport, initialization: capture.initialize
          ? { needed: true as const, ruleTable: decode(golden.ruleTable), policyAddress: golden.policyAddress }
          : { needed: false as const } };
  return { state, inputs };
}
for (const golden of goldens) {
  test(`${golden.mission} whole-call evidence does not claim historical natural demand or production receipts`, () => {
    assert.equal(golden.provenance.kind, "source-preaction-reconstructed-bounds");
    assert.equal(golden.provenance.entry, "0x44be40");
    assert.equal(golden.provenance.historicalNaturalDemand, false);
    assert.equal(golden.provenance.productionReceipts, "pending-owner");
  });
  for (const capture of golden.cases) {
    test(`${golden.mission} whole 44be40 ${capture.label} ${capture.actorTransport}`, () => {
      const { state, inputs } = fixture(golden, capture);
      const result = computeLegacyAiFullPolicy(state, inputs);
      assert.deepEqual(Buffer.from(result.candidate.policy), decode(capture.after.policy), "complete policy");
      assert.deepEqual(Buffer.from(result.candidate.entities), decode(capture.after.entities), "all entity bytes");
      assert.deepEqual(Buffer.from(result.teamBytes), decode(capture.after.teamBytes), "team including demand debits");
      assert.equal(result.candidate.rngCursor, capture.after.rngCursor);
      assert.equal(result.candidate.forceOrder, capture.after.forceOrder);
      assert.equal(result.rngDraws, capture.rngEvents.length);
      assert.deepEqual([...result.groups[1].events, ...result.groups[3].events]
        .flatMap((event) => "rngCursor" in event ? [event.rngCursor] : []), capture.rngEvents);
      assert.deepEqual(result.packets.map(({ stage, packet }) => ({ stage, packet: Buffer.from(packet).toString("hex") })), capture.packets);
      assert.ok(result.packets.every((packet, index) => packet.sequence === index && packet.receipt === "pending-owner"));
      assert.deepEqual(result.groups.map((group) => group.group), [0, 1, 2, 3]);
      assert.deepEqual(result.groups.flatMap((group) => group.packets), result.packets.filter((packet) => packet.kind === "actor-order"));
      if (capture.label === "paid-demand") assert.ok(result.packets.some((packet) => packet.kind === "production"));
      if (capture.label === "mixed-branches") assert.ok(result.groups.every((group) => group.packets.length > 0));
      assert.equal(result.readyWholeCall, true);
      assert.equal(result.admitted, false);
      assert.equal(result.runtimeReady, false);
      assert.deepEqual(state.policy, decode(capture.before.policy));
      assert.deepEqual(state.entities, decode(capture.before.entities));
      assert.deepEqual(inputs.teamBytes, decode(capture.before.teamBytes));
    });
  }
  for (const receipt of golden.receipts) {
    test(`${golden.mission} native 41defc ${receipt.label}`, () => {
      const before = decode(receipt.before), entities = Buffer.from(before);
      applyLegacyAiActorPacket(entities, Buffer.from(receipt.packet, "hex"));
      assert.deepEqual(entities, decode(receipt.after));
      for (let slot = 0; slot < 800; slot++) assert.equal(entities[slot * 220 + 0x11], before[slot * 220 + 0x11]);
    });
  }
  test(`${golden.mission} late group failure leaves demand debits, RNG, force and actor receipts uncommitted`, () => {
    const capture = golden.cases.find((entry) => entry.label === "paid-demand" && entry.actorTransport === "synchronous")!;
    const { state, inputs } = fixture(golden, capture);
    state.policy.writeUInt32LE(0, 3 * 0x12fc + 0x3170);
    const before = { policy: Buffer.from(state.policy), entities: Buffer.from(state.entities),
      teamBytes: Buffer.from(inputs.teamBytes), rngCursor: state.rngCursor, forceOrder: state.forceOrder };
    assert.throws(() => computeLegacyAiFullPolicy(state, inputs), /group-3 callbacks/);
    assert.deepEqual({ policy: state.policy, entities: state.entities, teamBytes: inputs.teamBytes,
      rngCursor: state.rngCursor, forceOrder: state.forceOrder }, before);
  });
}

test("actor decoder rejects a late malformed command before any write", () => {
  const entities = new Uint8Array(800 * 220).fill(123);
  const before = new Uint8Array(entities);
  assert.throws(() => applyLegacyAiActorPacket(entities, Uint8Array.of(8, 0, 5, 0, 0, 13, 9, 0)), /does not own/);
  assert.deepEqual(entities, before);
});

test("actor decoder rejects framing, signed slots, overlong routes and missing terminators atomically", () => {
  for (const packet of [
    [7, 16, 5, 0, 0, 13, 0], [7, 0, 5, 255, 255, 13, 0], [7, 0, 5, 32, 3, 13, 0],
    [7, 0, 7, 9, 0, 0, 0], [6, 0, 5, 0, 0, 13], [8, 0, 5, 0, 0, 13, 0, 0], [4, 0, 5, 0],
  ]) {
    const entities = new Uint8Array(800 * 220).fill(27), before = new Uint8Array(entities);
    assert.throws(() => applyLegacyAiActorPacket(entities, Uint8Array.from(packet)), RangeError);
    assert.deepEqual(entities, before);
  }
});
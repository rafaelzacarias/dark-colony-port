import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { consumeLegacyAiDemand, consumeLegacyAiPolicyPipeline, evaluateLegacyAiRulePredicate,
  LEGACY_AI_RULES } from "../../src/engine/legacy-ai";

type Snapshot = { policy: string; entities: string; teams: string; rngCursor: number; forceOrder: number };
type Capture = { label: string; team: number; pipeline: boolean; population: number; populationLimit: number;
  before: Snapshot; after: Snapshot; counts: number[]; packets: string[]; expectedRule?: number;
  callbacks: { callback: string; parameter: number; result?: number }[] };
type Golden = { mission: string; team: number; cases: Capture[]; ruleTable: string;
  predicateCases: { label: string; rule: number; counts: number[]; population: number; populationLimit: number;
    teamBytes: string; result: number }[];
  navigation: { width: number; height: number; families: string; nextFamily: string };
  inputs: { types: string; weapons: string; dependencies: string; cityDependencies: number[];
    matrix: number[][]; relations: number[]; visibilityMasks: number[]; occupancy: number[] };
  naturalEvidence: { frame: number; demandInputsCaptured: boolean } };

const trace = process.env.DC_AI_DEMAND_TRACE ? readFileSync(process.env.DC_AI_DEMAND_TRACE, "utf8")
  : execFileSync("python3", ["-B", "tools/research/ai-demand-20260919.py"], {
    cwd: new URL("../../", import.meta.url), encoding: "utf8", maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
  });
const goldens = trace.trim().split("\n").map((line) => JSON.parse(line) as Golden);
const decode = (value: string) => Buffer.from(value, "base64");

function fixture(golden: Golden, capture: Capture) {
  const teams = decode(capture.before.teams);
  return { teams, state: { policy: decode(capture.before.policy), entities: decode(capture.before.entities),
    rngCursor: capture.before.rngCursor, forceOrder: capture.before.forceOrder,
    navigation: { ...golden.navigation, families: decode(golden.navigation.families), nextFamily: decode(golden.navigation.nextFamily) } },
  inputs: { ...golden.inputs, team: capture.team, types: decode(golden.inputs.types), weapons: decode(golden.inputs.weapons),
    dependencies: decode(golden.inputs.dependencies), relations: Uint8Array.from(golden.inputs.relations),
    population: capture.population, populationLimit: capture.populationLimit,
    teamBytes: teams.subarray(capture.team * 0xe30, (capture.team + 1) * 0xe30) } };
}

for (const golden of goldens) {
  test(`${golden.mission}: exact executable 18-rule table`, () => {
    const bytes = decode(golden.ruleTable);
    LEGACY_AI_RULES.forEach((rule, index) => rule.forEach((value, field) => {
      assert.equal(bytes.readInt32LE(index * 12 + field * 4), value);
    }));
    assert.equal(golden.naturalEvidence.demandInputsCaptured, false);
    assert.equal(golden.naturalEvidence.frame, golden.mission === "HUMAN02" ? 14124 : 1160);
  });
  for (const capture of golden.cases) {
    test(`${golden.mission}: demand ${capture.label} matches every native byte and request`, () => {
      const { state, inputs, teams } = fixture(golden, capture);
      const result = (capture.pipeline ? consumeLegacyAiPolicyPipeline : consumeLegacyAiDemand)(state, inputs);
      assert.deepEqual(state.policy, decode(capture.after.policy), "complete policy");
      assert.deepEqual(state.entities, decode(capture.after.entities), "complete entity pool");
      assert.deepEqual(teams, decode(capture.after.teams), "all eight teams, including actual debit");
      assert.equal(state.rngCursor, capture.after.rngCursor);
      assert.equal(state.forceOrder, capture.after.forceOrder);
      assert.deepEqual(result.counts, capture.counts);
      assert.deepEqual(result.predicates.map(({ callback, parameter, result: value }) => ({ callback: `0x${callback.toString(16)}`, parameter, result: value })),
        capture.callbacks.filter((entry) => entry.result !== undefined));
      assert.equal(`0x${result.actionCallback.toString(16)}`, capture.callbacks.at(-1)!.callback);
      if (capture.expectedRule !== undefined) assert.equal(result.selectedRule, capture.expectedRule);
      assert.deepEqual(result.productionRequests.map((request) => Buffer.from(request.packet).toString("hex")), capture.packets);
      for (const request of result.productionRequests) {
        assert.equal(request.team, capture.team);
        assert.equal(request.creditsAfter, (request.creditsBefore - request.cost) | 0);
        assert.equal(request.receipt, "pending-owner");
      }
      assert.equal(result.rngDraws, 0);
      assert.equal(result.nextGroup, 0);
      assert.equal(result.productionLifecycleExecuted, false);
      assert.equal(result.readyWholeCall, false);
      assert.equal(result.admitted, false);
    });
  }
  test(`${golden.mission}: every predicate, signed overflow, cap and threshold match native calls`, () => {
    const { inputs } = fixture(golden, golden.cases[0]);
    assert.equal(golden.predicateCases.length, 162);
    for (const capture of golden.predicateCases) {
      Object.assign(inputs, { teamBytes: decode(capture.teamBytes), population: capture.population, populationLimit: capture.populationLimit });
      assert.equal(evaluateLegacyAiRulePredicate(inputs, capture.counts, capture.rule), capture.result,
        `${capture.label} rule ${capture.rule} counts ${capture.counts[0]} population ${capture.population}`);
    }
  });
  test(`${golden.mission}: malformed demand input rolls back preparation, assignment and credits`, () => {
    const capture = golden.cases.find((entry) => entry.label === "source-pipeline")!;
    for (const invalid of ["table", "queue", "cap", "mapping", "overlap"] as const) {
      const { state, inputs, teams } = fixture(golden, capture);
      if (invalid === "table") state.policy[0x6a94] ^= 1;
      if (invalid === "queue") inputs.teamBytes.writeUInt16LE(801, 0x110);
      if (invalid === "cap") inputs.populationLimit = NaN;
      if (invalid === "mapping") inputs.cityDependencies = [];
      if (invalid === "overlap") inputs.teamBytes = state.entities.subarray(0, 0xe30);
      const before = [Buffer.from(state.policy), Buffer.from(state.entities), Buffer.from(teams), state.rngCursor, state.forceOrder];
      assert.throws(() => consumeLegacyAiPolicyPipeline(state, inputs), RangeError);
      assert.deepEqual([state.policy, state.entities, teams, state.rngCursor, state.forceOrder], before);
    }
  });
}

test("native captures exercise all production actions without substituting no-op callbacks", () => {
  const packets = goldens.flatMap((golden) => golden.cases.flatMap((capture) => capture.packets));
  assert.ok(packets.some((packet) => packet.startsWith("070009")));
  assert.ok(packets.some((packet) => packet.startsWith("07000a")));
  const actions = new Set(goldens.flatMap((golden) => golden.cases.map((capture) => capture.callbacks.at(-1)!.callback)));
  for (const address of ["0x456550", "0x456448", "0x4566ac", "0x456874"]) assert.ok(actions.has(address), address);
});
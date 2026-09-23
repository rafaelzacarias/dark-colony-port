import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { auditMissionTriggerSupport, commitMissionPlan, createMissionController, createMissionStartupAdapter,
  planMissionStep } from "../../src/engine/mission-controller.ts";
import { auditTriggerSupport, createTriggerRuntimeState, evaluateTriggerCondition, stepTriggerRuntime,
  type TriggerResult } from "../../src/engine/trigger-runtime.ts";
import { parseTriggerScript } from "../extractors/data/triggers.ts";

function unwrap<Value>(result: TriggerResult<Value>): Value {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("Expected success");
  return result.value;
}

const inputs = { cycleCounter: 16, clockMilliseconds: 123, buildingSlots: {} };
const normal = { kind: "normal" } as const;

test("omitted lives stays raw null and gates evaluation and actions", () => {
  const blocks = parseTriggerScript("8 norm (s(1,0,86)>2)\nmystery 1\nend");
  assert.equal(blocks[0].flag, null);
  const initial = unwrap(createTriggerRuntimeState(blocks, {}));
  assert.equal(initial.lives[8], 0);
  assert.deepEqual(unwrap(stepTriggerRuntime(blocks, initial, inputs, normal)).fired, []);
  assert.ok(auditTriggerSupport(blocks).some(({ code }) => code === "unsupported-action"));
});

test("setarray uses dispatch counter, native signed words and dword sign extension", () => {
  const blocks = parseTriggerScript("0 norm 1 (1)\nsetarray 0 (c+45)\nend");
  const initial = unwrap(createTriggerRuntimeState(blocks, {}));
  assert.deepEqual(auditTriggerSupport(blocks), []);
  for (const [cycleCounter, expected] of [[0, 45], [1600, 145], [524272, -32724], [-16, 44]]) {
    const result = unwrap(stepTriggerRuntime(blocks, initial, { ...inputs, cycleCounter }, normal));
    assert.equal(result.state.statistics["0,2,0"], expected);
  }
  for (const [expression, expected] of [["32768", -32768], ["65535", -1], ["S", -1]] as const) {
    const program = parseTriggerScript(`0 trip 1 (S==3)\nsetarray 0 ${expression}\nend`);
    const result = unwrap(stepTriggerRuntime(program, unwrap(createTriggerRuntimeState(program, {})), inputs,
      { kind: "trip", triggerId: 0, team: 3 }));
    assert.equal(result.state.statistics["0,2,0"], expected);
    const bytes = new DataView(new ArrayBuffer(4));
    bytes.setInt32(0, result.state.statistics["0,2,0"], true);
    assert.equal(bytes.getUint32(0, true), expected >>> 0);
  }
  assert.deepEqual(initial.statistics, {});
});

test("array zero reset, aliases, literal truncation and reverse-order feedback share statistics", () => {
  assert.equal(unwrap(evaluateTriggerCondition("s(0,2,799)", {}, inputs)), 0);
  for (const [index, key] of [[110, "1,2,0"], [799, "7,2,29"], [65536, "0,2,0"]] as const) {
    const blocks = parseTriggerScript(`0 norm 1 (1)\nsetarray ${index} 65535\nend`);
    const result = unwrap(stepTriggerRuntime(blocks, unwrap(createTriggerRuntimeState(blocks, {})), inputs, normal));
    assert.deepEqual(result.state.statistics, { [key]: -1 });
    assert.equal(unwrap(evaluateTriggerCondition(`s(0,2,${index & 65535})`, result.state.statistics, inputs)), -1);
    assert.equal(unwrap(evaluateTriggerCondition(`s(${key})`, result.state.statistics, inputs)), -1);
  }
  const blocks = parseTriggerScript("0 norm 1 (1)\nsetarray 0 (s(0,2,0) + 1)\nsetarray 0 123\nend\n1 norm 1 (s(0,2,0)==124)\nbail 0 1\nend");
  const initial = unwrap(createTriggerRuntimeState(blocks, {}));
  const result = unwrap(stepTriggerRuntime(blocks, initial, inputs, normal));
  assert.deepEqual(result.fired, [0, 1]);
  assert.equal(result.state.statistics["0,2,0"], 124);
  assert.deepEqual(initial.statistics, {});
});

test("invalid indices, malformed expressions and unknown actions roll back staged writes", () => {
  for (const action of ["setarray 800 1", "setarray 65535 1", "setarray (1+1) 1", "setarray 0", "setarray 0 c>=1", "ai 1 3", "newrate 0 1", "mystery 1"]) {
    const blocks = parseTriggerScript(`0 norm 1 (1)\n${action}\nsetarray 0 99\nend`);
    const initial = unwrap(createTriggerRuntimeState(blocks, {}));
    assert.ok(auditTriggerSupport(blocks).length > 0, action);
    assert.equal(stepTriggerRuntime(blocks, initial, inputs, normal).ok, false, action);
    assert.deepEqual(initial.statistics, {});
    assert.equal(initial.lives[0], 1);
  }
});

test("controller admits real array mutation with ordered trace, cloned state and strict delayed threshold", () => {
  const blocks = parseTriggerScript("18 norm 1 (1)\nmsg 2 0 1 3 8\nsetarray 0 (c+45)\nsetlifes 19 1\nend\n19 norm 0 (c>s(0,2,0))\nbail 0 1\nend");
  assert.deepEqual(auditMissionTriggerSupport(blocks), []);
  const initial = unwrap(createMissionController(blocks, {}));
  const snapshot = structuredClone(initial);
  const plan = planMissionStep(initial, inputs, normal);
  assert.deepEqual(plan.trace.map(({ action }) => action.name), ["setlifes", "setarray", "msg"]);
  assert.deepEqual(plan.commands.map(({ command }) => command.kind), ["msg"]);
  assert.equal(plan.next?.runtime.statistics["0,2,0"], 46);
  assert.equal(plan.next?.runtime.lives[19], 1);
  assert.equal(commitMissionPlan(initial, plan, null, createMissionStartupAdapter({})).ok, false);
  const committed = unwrap(commitMissionPlan(initial, plan, null, createMissionStartupAdapter({
    msg: (world) => ({ ok: true, value: { world, disposition: "applied" } }),
  })));
  assert.deepEqual(planMissionStep(committed.state, { ...inputs, cycleCounter: 46 * 16 }, normal).fired, []);
  assert.deepEqual(planMissionStep(committed.state, { ...inputs, cycleCounter: 47 * 16 }, normal).fired, [19]);
  assert.deepEqual(initial, snapshot);
  assert.notEqual(initial.blocks, blocks);
});

test("controller observes same-scan aliases and reverse VM order across world commands", () => {
  const blocks = parseTriggerScript("0 norm 1 (1)\nsetarray 110 (s(0,2,110)+1)\nmsg 2 0 1 3 8\nsetarray 110 123\nend\n1 norm 1 (s(1,2,0)==124)\nsetarray 799 (s(0,2,110)+1)\nend");
  const initial = unwrap(createMissionController(blocks, {}));
  const plan = planMissionStep(initial, inputs, normal);
  assert.deepEqual(plan.fired, [0, 1]);
  assert.deepEqual(plan.trace.map(({ action }) => action.name), ["setarray", "msg", "setarray", "setarray"]);
  assert.equal(plan.next?.runtime.statistics["1,2,0"], 124);
  assert.equal(plan.next?.runtime.statistics["7,2,29"], 125);
  assert.deepEqual(initial.runtime.statistics, {});
});

test("world-dependent array expressions wait for ordered feedback, array reads do not", () => {
  for (const expression of ["s(0,0)", "s(0,1,0)", "b(0,0)"]) {
    const blocks = parseTriggerScript(`0 norm 1 (1)\nsetarray 0 ${expression}\nexomoney 0 1\nend`);
    const initial = unwrap(createMissionController(blocks, { "0,0": 99, "0,1,0": 99 }));
    const plan = planMissionStep(initial, { ...inputs, buildingSlots: { "0,0": 99 } }, normal);
    assert.equal(plan.next, null);
    assert.deepEqual(plan.pendingEvaluation, { triggerId: 0, condition: expression, afterCommandIds: ["0:0:1"] });
    assert.equal(commitMissionPlan(initial, plan, null, createMissionStartupAdapter({})).ok, false);
  }
  const blocks = parseTriggerScript("0 norm 1 (1)\nexomoney 0 1\nsetarray 0 (c+45)\nend\n1 norm 1 (s(0,2,0)==46)\nsetarray 0 (s(0,2,0)+1)\nend");
  const plan = planMissionStep(unwrap(createMissionController(blocks, {})), inputs, normal);
  assert.equal(plan.pendingEvaluation, null);
  assert.equal(plan.next?.runtime.statistics["0,2,0"], 47);
  assert.deepEqual(plan.fired, [0, 1]);
});

test("controller rejects unknown actions and reports original array action indexes atomically", () => {
  for (const action of ["ai 1 3", "newrate 256 1 2", "mystery 1", "setarray 800 1", "setarray 0 s(0,1,0)"]) {
    const blocks = parseTriggerScript(`0 norm 1 (1)\nmsg 2 0 1 3 8\n${action}\nsetarray 0 99\nend`);
    const initial = unwrap(createMissionController(blocks, {}));
    const plan = planMissionStep(initial, inputs, normal);
    assert.equal(plan.next, null, action);
    assert.equal(plan.diagnostics[0].actionIndex, 1, action);
    assert.deepEqual(initial.runtime.statistics, {});
    assert.equal(initial.runtime.lives[0], 1);
    assert.equal(commitMissionPlan(initial, plan, null, createMissionStartupAdapter({})).ok, false);
  }
});

test("complete mission02 sources retain native 32-block/67-action counts and generated equality", () => {
  for (const [faction, count, actions, digest, unsupported] of [
    ["HUMAN", 20, 42, "0e5a6593768b4fff717be69609d8ed5eb2aea48d1bab68c30c8d5d621d7e080d", [[17, "ai"]]],
    ["ALIEN", 12, 25, "b219fa5bf2b13ba122271295679d488bb70077556dae20dfa76b00aa9968f50e", [[0, "ai"]]],
  ] as const) {
    const stem = `${faction}/${faction}02`;
    const source = readFileSync(new URL(`../../raw_cd/DC/SCENARIO/${stem}.TRO`, import.meta.url));
    assert.equal(createHash("sha256").update(source).digest("hex"), digest);
    const blocks = parseTriggerScript(source.toString("utf8"));
    const generated = JSON.parse(readFileSync(new URL(`../../public/assets/generated/data/triggers/${stem}.json`, import.meta.url), "utf8"));
    assert.deepEqual(blocks, generated.blocks);
    assert.equal(blocks.length, count);
    assert.equal(blocks.reduce((total, block) => total + block.actions.length, 0), actions);
    const diagnostics = auditMissionTriggerSupport(blocks);
    assert.deepEqual(diagnostics.map(({ triggerId, actionIndex }) =>
      [triggerId, blocks.find(({ id }) => id === triggerId)!.actions[actionIndex!].name]), unsupported);
    assert.ok(diagnostics.every(({ code }) => code === "unsupported-action"));
    if (faction === "ALIEN") {
      assert.equal(blocks.find(({ id }) => id === 8)!.flag, null);
      assert.equal(unwrap(createTriggerRuntimeState(blocks, {})).lives[8], 0);
    }
  }
});
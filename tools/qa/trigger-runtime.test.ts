import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  auditTriggerSupport,
  applyTriggerNewtype,
  createTriggerRuntimeState,
  evaluateTriggerCondition,
  recordTriggerVictimLoss,
  stepTriggerRuntime,
  tripForReservedMtgDestination,
  type RuntimeTriggerBlock,
  type TriggerResult,
} from "../../src/engine/trigger-runtime.ts";
import { parseTriggerScript } from "../extractors/data/triggers.ts";

function unwrap<Value>(result: TriggerResult<Value>): Value {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("Expected success");
  return result.value;
}

const inputs = { cycleCounter: 16, clockMilliseconds: 123, buildingSlots: {} };
const normal = { kind: "normal" } as const;
function blocks(text: string): readonly RuntimeTriggerBlock[] { return parseTriggerScript(text); }

test("c shifts the signed counter by four, then wraps to a signed word", () => {
  for (const [cycleCounter, expected] of [[15, 0], [16, 1], [19200, 1200], [19216, 1201], [524288, -32768], [-1, -1]]) {
    assert.equal(unwrap(evaluateTriggerCondition("c", {}, { ...inputs, cycleCounter })), expected);
  }
});

test("S requires a triggering team and is not a global zero", () => {
  assert.equal(evaluateTriggerCondition("(S==0)", {}, inputs).ok, false);
  assert.equal(unwrap(evaluateTriggerCondition("(S==0)", {}, inputs, 0)), 1);
  assert.equal(unwrap(evaluateTriggerCondition("(S==0)", {}, inputs, 1)), 0);
});

test("statistics and building slots use exact argument order and signed-word values", () => {
  const statistics = { "4,3": 3, "1,0,82": 11, "0,0,73": 1 };
  for (const condition of ["(s(4,3)>2)", "(s(1,0,82)>10)", "(s(0,0,73)==1)"]) {
    assert.equal(unwrap(evaluateTriggerCondition(condition, statistics, inputs)), 1);
  }
  assert.equal(unwrap(evaluateTriggerCondition("b(1,0)", {}, { ...inputs, buildingSlots: { "1,0": 65535 } })), -1);
  assert.equal(evaluateTriggerCondition("s(0,1,82)", statistics, inputs).ok, false);
  assert.equal(evaluateTriggerCondition("b(1,1)", {}, inputs).ok, false);
});

test("original x86 VM uses team first and selector second for both s arities", () => {
  const statistics = { "4,3": 5300, "1,0,82": 2082, "0,1,82": 1182, "7,11": 42, "7,3,82": 43 };
  for (const [key, expected] of Object.entries(statistics)) {
    assert.equal(unwrap(evaluateTriggerCondition(`s(${key})`, statistics, inputs)), expected);
  }
  for (const key of ["8,0", "0,12", "8,0,82", "0,4,82"]) {
    assert.equal(evaluateTriggerCondition(`s(${key})`, { [key]: 99 }, inputs).ok, false);
  }
});

test("verified victim-loss producer satisfies mission predicates without a conversion or kill-credit substitute", () => {
  const initial = { "4,3": 0, "4,0,8": 0, "1,3": 0, "1,0,82": 0, "0,1,82": 0, "0,2": 99 };
  let statistics: Readonly<Record<string, number>> = initial;
  for (let count = 1; count <= 3; count += 1) {
    statistics = unwrap(recordTriggerVictimLoss(statistics, 4, 8));
    assert.equal(unwrap(evaluateTriggerCondition("s(4,3)>2", statistics, inputs)), Number(count > 2));
  }
  for (let count = 1; count <= 11; count += 1) {
    statistics = unwrap(recordTriggerVictimLoss(statistics, 1, 82));
    assert.equal(unwrap(evaluateTriggerCondition("s(1,0,82)>10", statistics, inputs)), Number(count > 10));
  }
  assert.equal(statistics["0,1,82"], 0);
  assert.equal(statistics["0,2"], 99);
  assert.equal(initial["4,3"], 0);
  assert.equal(initial["1,0,82"], 0);
  assert.equal(recordTriggerVictimLoss({}, 1, 82).ok, false);
  assert.equal(recordTriggerVictimLoss(initial, 8, 82).ok, false);
  assert.deepEqual(unwrap(recordTriggerVictimLoss({ "1,3": 4294967295, "1,0,82": 4294967295 }, 1, 82)),
    { "1,3": 0, "1,0,82": 0 });
});

test("newtype rewrites only the first coordinate-matching ground slot, even when inactive", () => {
  const entities = new Uint8Array(800 * 220);
  const classes = new Uint8Array(110);
  classes[1] = 1;
  for (const slot of [0, 152, 799]) {
    const offset = slot * 220;
    entities[offset] = 255;
    entities[offset + 1] = 54;
    entities[offset + 5] = 17;
    entities[offset + 6] = slot === 0 ? 1 : 95;
    entities[offset + 7] = 1;
    entities[offset + 12] = 123;
    entities[offset + 44] = slot === 152 ? 0 : 1;
  }
  const result = unwrap(applyTriggerNewtype(entities, classes, 54, 17, 84));
  assert.equal(result.changedSlot, 152);
  const expected = new Uint8Array(entities);
  expected[152 * 220 + 6] = 84;
  assert.deepEqual(result.entityBytes, expected);
  assert.equal(entities[152 * 220 + 6], 95);
  assert.equal(result.entityBytes[152 * 220 + 7], 1);
  assert.equal(result.entityBytes[799 * 220 + 6], 95);
  assert.equal(unwrap(applyTriggerNewtype(entities, classes, 53, 17, 84)).changedSlot, null);
  assert.equal(applyTriggerNewtype(entities.subarray(220), classes, 54, 17, 84).ok, false);
  assert.equal(applyTriggerNewtype(entities, classes, 54, 17, 110).ok, false);
});

test("reserved-destination MTG lookup flips source rows, truncates tags, and is not edge-triggered", () => {
  const plane = Uint8Array.from([0, 65, 7, 255, 64, 2]);
  assert.deepEqual(unwrap(tripForReservedMtgDestination(plane, 2, 3, 1, 2, 0)), { kind: "trip", triggerId: 1, team: 0 });
  assert.deepEqual(unwrap(tripForReservedMtgDestination(plane, 2, 3, 1, 1, 1)), { kind: "trip", triggerId: 63, team: 1 });
  assert.equal(unwrap(tripForReservedMtgDestination(plane, 2, 3, 0, 0, 0)), null);
  assert.equal(tripForReservedMtgDestination(plane, 2, 3, 2, 0, 0).ok, false);
  assert.equal(tripForReservedMtgDestination(plane.subarray(1), 2, 3, 0, 0, 0).ok, false);
  const program = blocks("7 trip 2 (S==0)\nend\n");
  let state = unwrap(createTriggerRuntimeState(program, {}));
  for (let reservation = 0; reservation < 2; reservation += 1) {
    const event = unwrap(tripForReservedMtgDestination(plane, 2, 3, 0, 1, 0))!;
    const result = unwrap(stepTriggerRuntime(program, state, inputs, event));
    assert.deepEqual(result.fired, [7]);
    state = result.state;
  }
  assert.equal(state.lives[7], 0);
});

test("real mission MTG regions map to runtime coordinates without invented trip regions", () => {
  for (const faction of ["HUMAN", "ALIEN"]) {
    const mtg = readFileSync(new URL(`../../raw_cd/DC/SCENARIO/${faction}/${faction}01.MTG`, import.meta.url));
    assert.deepEqual([...mtg.subarray(0, 2)], [96, 84]);
    const plane = mtg.subarray(2);
    const counts: Record<number, number> = {};
    for (let runtimeY = 0; runtimeY < 84; runtimeY += 1) {
      for (let runtimeX = 0; runtimeX < 96; runtimeX += 1) {
        const event = unwrap(tripForReservedMtgDestination(plane, 96, 84, runtimeX, runtimeY, 0));
        if (event !== null) counts[event.triggerId] = (counts[event.triggerId] ?? 0) + 1;
      }
    }
    assert.deepEqual(counts, faction === "HUMAN" ? { 1: 24, 2: 13, 7: 12, 11: 13 } : { 4: 16, 6: 13, 8: 16, 9: 27 });
    if (faction === "HUMAN") {
      assert.equal(unwrap(tripForReservedMtgDestination(plane, 96, 84, 54, 17, 0))?.triggerId, 1);
      assert.equal(unwrap(tripForReservedMtgDestination(plane, 96, 84, 25, 59, 0))?.triggerId, 7);
      assert.equal(unwrap(tripForReservedMtgDestination(plane, 96, 84, 26, 59, 0)), null);
      assert.equal(unwrap(tripForReservedMtgDestination(plane, 96, 84, 54, 66, 0)), null);
    }
  }
});

test("logical operators are eager bitwise operators with a shared right-associative level", () => {
  assert.equal(unwrap(evaluateTriggerCondition("2&&1", {}, inputs)), 0);
  assert.equal(unwrap(evaluateTriggerCondition("1||2&&0", {}, inputs)), 1);
  assert.equal(evaluateTriggerCondition("0&&s(4,3)", {}, inputs).ok, false);
  for (const source of ["c>=0", "C", "s(0)", "s(0,0,0,0)", "(c>0)garbage", ""]) {
    assert.equal(evaluateTriggerCondition(source, {}, inputs).ok, false, source);
  }
});

test("normal scans are numeric, lives decrement after actions, and setlifes rearms", () => {
  const program = blocks("4 norm 0 (c>0)\nbail 0 1\nend\n2 norm 1 (c>0)\nsetlifes 4 1\nend\n");
  const initial = unwrap(createTriggerRuntimeState(program, {}));
  const result = unwrap(stepTriggerRuntime(program, initial, inputs, normal));
  assert.deepEqual(result.fired, [2, 4]);
  assert.deepEqual(result.state.lives, { 2: 0, 4: 0 });
  assert.deepEqual(result.state.bail, { resultCode: 0, reasonCode: 1, deadlineMilliseconds: 10123 });
  assert.deepEqual(result.state.statistics, { "0,0": 0, "7,0": 1 });
  assert.deepEqual(initial.lives, { 2: 1, 4: 0 });
  assert.deepEqual(unwrap(stepTriggerRuntime(program, result.state, inputs, normal)).fired, []);
});

test("trip is dispatched explicitly, rejects the wrong team, and consumes one life", () => {
  const program = blocks("1 trip 1 (S==0)\nsetlifes 2 1\nend\n2 norm 0 (c>0)\nbail 0 1\nend\n");
  const initial = unwrap(createTriggerRuntimeState(program, {}));
  assert.deepEqual(unwrap(stepTriggerRuntime(program, initial, inputs, normal)).fired, []);
  assert.deepEqual(unwrap(stepTriggerRuntime(program, initial, inputs, { kind: "trip", triggerId: 1, team: 1 })).fired, []);
  const result = unwrap(stepTriggerRuntime(program, initial, inputs, { kind: "trip", triggerId: 1, team: 0 }));
  assert.deepEqual(result.fired, [1]);
  assert.deepEqual(result.state.lives, { 1: 0, 2: 1 });
});

test("action order is reversed and self-setlifes precedes the byte decrement", () => {
  const program = blocks("1 norm 1 (c>0)\nbail 0 1\nbail 1 4\nsetlifes 1 0\nend\n");
  const result = unwrap(stepTriggerRuntime(program, unwrap(createTriggerRuntimeState(program, {})), inputs, normal));
  assert.equal(result.state.bail?.resultCode, 0);
  assert.equal(result.state.bail?.reasonCode, 1);
  assert.equal(result.state.lives[1], 255);
});

test("unsupported actions fail atomically even after a provisional bail", () => {
  for (const action of ["abduct 0 0", "newtype 54 17 84", "reinforce 0 1 2", "msg 2 0 1 3 8", "mystery 1"]) {
    const program = blocks(`1 norm 1 (c>0)\n${action}\nbail 0 1\nend\n`);
    const initial = unwrap(createTriggerRuntimeState(program, {}));
    const result = stepTriggerRuntime(program, initial, inputs, normal);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.diagnostics[0].code, "unsupported-action");
    assert.equal(initial.bail, null);
    assert.equal(initial.lives[1], 1);
    assert.deepEqual(initial.statistics, {});
  }
});

test("duplicate IDs and unknown modes are not accepted", () => {
  for (const source of ["1 odd 1 (c>0)\nend", "128 norm 1 (c>0)\nend", "1 norm 1 (c>0)\nend\n1 norm 1 (c>0)\nend"]) {
    assert.equal(createTriggerRuntimeState(blocks(source), {}).ok, false);
  }
});

test("the real HUMAN01 and ALIEN01 scripts have supported conditions but unsupported world actions", () => {
  for (const mission of ["HUMAN01", "ALIEN01"]) {
    const faction = mission.startsWith("HUMAN") ? "HUMAN" : "ALIEN";
    const url = new URL(`../../raw_cd/DC/SCENARIO/${faction}/${mission}.TRO`, import.meta.url);
    const program = blocks(readFileSync(url, "utf8"));
    const diagnostics = auditTriggerSupport(program);
    assert.ok(diagnostics.length > 0);
    assert.ok(diagnostics.every(({ code }) => code === "unsupported-action"));
    assert.ok(diagnostics.some(({ message }) => message.includes("abduct")));
    assert.deepEqual(program.map(({ id }) => id), mission === "HUMAN01"
      ? [0, 1, 2, 4, 5, 7, 8, 9, 11]
      : [1, 2, 3, 4, 6, 7, 8, 9, 10]);
  }
});

test("actual mission objective predicates retain strict thresholds and distinct statistic namespaces", () => {
  const human = blocks(readFileSync(new URL("../../raw_cd/DC/SCENARIO/HUMAN/HUMAN01.TRO", import.meta.url), "utf8"));
  const alien = blocks(readFileSync(new URL("../../raw_cd/DC/SCENARIO/ALIEN/ALIEN01.TRO", import.meta.url), "utf8"));
  const humanRescue = human.find(({ id }) => id === 4)!;
  assert.equal(humanRescue.flag, 0);
  for (const [count, expected] of [[2, 0], [3, 1]]) {
    assert.equal(unwrap(evaluateTriggerCondition(humanRescue.condition, { "4,3": count }, inputs)), expected);
  }
  const alienSuccess = alien.find(({ id }) => id === 3)!;
  for (const [count, expected] of [[10, 0], [11, 1]]) {
    assert.equal(unwrap(evaluateTriggerCondition(alienSuccess.condition, { "1,0,82": count, "0,0,82": 99 }, inputs)), expected);
  }
  const colonyLoss = human.find(({ id }) => id === 5)!;
  const buildingSlots = { "1,0": 0, "1,1": 0, "1,2": 0, "1,3": 0, "1,4": 0 };
  assert.equal(unwrap(evaluateTriggerCondition(colonyLoss.condition, {}, { ...inputs, buildingSlots })), 1);
  assert.equal(unwrap(evaluateTriggerCondition(colonyLoss.condition, {}, { ...inputs, buildingSlots: { ...buildingSlots, "1,4": 1 } })), 0);
  const commanderLoss = human.find(({ id }) => id === 9)!;
  const statistics = { "0,0,69": 0, "0,0,70": 0, "0,0,71": 0, "0,0,72": 0 };
  assert.equal(unwrap(evaluateTriggerCondition(commanderLoss.condition, statistics, inputs)), 0);
  assert.equal(unwrap(evaluateTriggerCondition(commanderLoss.condition, { ...statistics, "0,0,71": 1 }, inputs)), 1);
});

test("bail schedules uint32 milliseconds without terminating the remaining normal scan", () => {
  const program = blocks("1 norm 1 (c>0)\nbail 1 2\nend\n2 norm 1 (s(7,0)==2)\nbail 0 1\nend\n");
  const initial = unwrap(createTriggerRuntimeState(program, {}));
  const result = unwrap(stepTriggerRuntime(program, initial, { ...inputs, clockMilliseconds: 4294967295 }, normal));
  assert.deepEqual(result.fired, [1, 2]);
  assert.equal(result.state.bail?.deadlineMilliseconds, 9999);
  assert.equal(result.state.statistics["0,0"], 0);
  assert.equal(result.state.statistics["7,0"], 1);
  assert.equal(result.state.statistics["0,7"], undefined);
});
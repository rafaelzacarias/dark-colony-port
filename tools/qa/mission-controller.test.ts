import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  commitMissionPlan,
  createMissionController,
  createMissionStartupAdapter,
  decodeMissionWorldAction,
  executeMissionTransaction,
  missionBailDeadlineExceeded,
  planMissionStep,
  type MissionWorldAdapter,
  type PlannedMissionCommand,
} from "../../src/engine/mission-controller.ts";
import { applyTriggerNewtype, evaluateTriggerCondition, stepTriggerRuntime, type TriggerResult } from "../../src/engine/trigger-runtime.ts";
import { parseTriggerScript } from "../extractors/data/triggers.ts";

function unwrap<Value>(result: TriggerResult<Value>): Value {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("Expected success");
  return result.value;
}

function fixture(faction: "HUMAN" | "ALIEN") {
  return parseTriggerScript(readFileSync(new URL(`../../raw_cd/DC/SCENARIO/${faction}/${faction}01.TRO`, import.meta.url), "utf8"));
}

const inputs = { cycleCounter: 16, clockMilliseconds: 100, buildingSlots: {} };
const normal = { kind: "normal" } as const;

test("ordered transaction reads adapter-defined money feedback without replaying the array prefix", () => {
  const state = unwrap(createMissionController(parseTriggerScript(`1 norm 1 (c>0)
setarray 1 (s(0,4)+s(0,2,0))
exomoney 0 17
setarray 0 (s(0,2,0)+1)
msg 2 0 1 3 8
end`), { "0,4": 0 }));
  const plan = planMissionStep(state, inputs, normal);
  assert.ok(plan.pendingEvaluation);
  const world = { money: 0, messages: 0 };
  const result = unwrap(executeMissionTransaction(state, inputs, normal, world, {
    prepare(staged, commands) {
      const planned = commands[0];
      if (planned.command.kind === "exomoney") staged.money = planned.command.value;
      if (planned.command.kind === "msg") staged.messages += 1;
      return { ok: true, value: { world: staged, receipts: [{ commandId: planned.id, disposition: "applied" }] } };
    },
    feedback(staged, runtime, supplied) {
      return { ok: true, value: { world: staged, statistics: { ...runtime.statistics, "0,4": staged.money },
        buildingSlots: supplied.buildingSlots } };
    },
  }));
  assert.deepEqual(result.world, { money: 17, messages: 1 });
  assert.deepEqual(world, { money: 0, messages: 0 });
  assert.equal(result.state.runtime.statistics["0,2,0"], 1);
  assert.equal(result.state.runtime.statistics["0,2,1"], 18);
  assert.equal(result.state.runtime.lives[1], 0);
  assert.equal(result.state.revision, 1);
  assert.deepEqual(result.commands.map(({ id }) => id), ["0:1:3", "0:1:1"]);
  assert.deepEqual(result.receipts.map(({ commandId }) => commandId), result.commands.map(({ id }) => id));
});

const colonySlots = { "1,0": 1, "1,1": 1, "1,2": 1, "1,3": 1, "1,4": 1 };
const humanStatistics = { "0,3": 0, "0,0,69": 0, "0,0,70": 0, "0,0,71": 0, "0,0,72": 0, "4,3": 0, "4,0,8": 0 };
const alienStatistics = { "0,3": 0, "0,0,73": 0, "1,3": 0, "1,0,82": 0 };
const noCommands: MissionWorldAdapter<null> = {
  prepare(world, commands) {
    assert.deepEqual(commands, []);
    return { ok: true, value: { world, receipts: [] } };
  },
};

test("ordered execution matches VM lives, self-rearm timing and reverse bail order", () => {
  for (const lives of [0, 1, 3, 255]) {
    const state = unwrap(createMissionController(parseTriggerScript(`1 norm 2 (c>0)
setarray 0 (s(0,2,0)+1)
setlifes 2 1
bail 0 1
msg 2 0 1 3 8
bail 1 4
setlifes 1 ${lives}
end
2 norm 0 (s(0,2,0)==1)
setarray 1 (s(7,0))
end`), {}));
    const expected = unwrap(stepTriggerRuntime(state.blocks.map((block) => ({ ...block,
      actions: block.actions.filter(({ name }) => name !== "msg") })), state.runtime, inputs, normal));
    const actual = unwrap(executeMissionTransaction(state, inputs, normal, [] as number[], {
      prepare(world, commands) {
        const planned = commands[0];
        world.push(planned.statistics!["7,0"]);
        return { ok: true, value: { world, receipts: [{ commandId: planned.id, disposition: "applied" }] } };
      },
      feedback(world, runtime, supplied) {
        return { ok: true, value: { world, statistics: runtime.statistics, buildingSlots: supplied.buildingSlots } };
      },
    }));
    assert.deepEqual(actual.world, [4]);
    assert.deepEqual(actual.state.runtime, expected.state);
    assert.deepEqual(actual.fired, [1, 2]);
    assert.equal(actual.state.runtime.lives[1], (lives - 1) & 255);
    assert.equal(actual.state.runtime.statistics["0,2,1"], 1);
    assert.equal(actual.state.runtime.bail!.deadlineMilliseconds, 10100);
  }
});

test("ordered execution preserves normal/trip conditions and setarray context", () => {
  const adapter = { ...noCommands, feedback(world: null, runtime: Parameters<typeof stepTriggerRuntime>[1], supplied: typeof inputs) {
    return { ok: true as const, value: { world, statistics: runtime.statistics, buildingSlots: supplied.buildingSlots } };
  } };
  const normalState = unwrap(createMissionController(parseTriggerScript("1 norm 1 (S==0)\nend"), {}));
  const rejected = executeMissionTransaction(normalState, inputs, normal, null, adapter);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.diagnostics[0].code, "missing-input");
  const tripState = unwrap(createMissionController(parseTriggerScript("7 trip 2 (S==3)\nsetarray 0 S\nend"), {}));
  const wrongTeam = unwrap(executeMissionTransaction(tripState, inputs, { kind: "trip", triggerId: 7, team: 0 }, null, adapter));
  assert.deepEqual(wrongTeam.fired, []);
  const matching = unwrap(executeMissionTransaction(tripState, inputs, { kind: "trip", triggerId: 7, team: 3 }, null, adapter));
  assert.equal(matching.state.runtime.statistics["0,2,0"], -1);
  assert.equal(matching.state.runtime.lives[7], 1);
});

test("ordered failures preserve original action positions and roll back VM, losses and mutable world", () => {
  for (const lastAction of ["ai 1 3", "setarray 800 1", "setlifes 9 1"]) {
    const state = unwrap(createMissionController(parseTriggerScript(`1 norm 1 (1)
${lastAction}
setarray 0 (s(0,2,0)+1)
msg 2 0 1 3 8
bail 0 1
setlifes 1 0
end`), { "0,3": 0, "0,0,8": 0 }));
    const world: string[] = [];
    const before = structuredClone(state);
    const result = executeMissionTransaction(state, inputs, normal, world, {
      prepare(staged, commands) {
        staged.push(commands[0].id);
        return { ok: true, value: { world: staged, receipts: [{ commandId: commands[0].id, disposition: "applied" }] } };
      },
      feedback(staged, runtime, supplied) {
        return { ok: true, value: { world: staged, statistics: runtime.statistics, buildingSlots: supplied.buildingSlots } };
      },
    }, [{ id: "loss", victimTeam: 0, victimType: 8 }]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.deepEqual([result.diagnostics[0].triggerId, result.diagnostics[0].actionIndex], [1, 0]);
    assert.deepEqual(state, before);
    assert.deepEqual(world, []);
  }
});

test("ordered receipt and feedback rejection cannot publish the staged world", () => {
  const state = unwrap(createMissionController(parseTriggerScript("1 norm 1 (1)\nmsg 2 0 1 3 8\nend"), {}));
  for (const fault of ["missing", "identity", "disposition", "extra", "feedback"]) {
    const world: string[] = [];
    let feedbackCalls = 0;
    const result = executeMissionTransaction(state, inputs, normal, world, {
      prepare(staged, commands) {
        staged.push(commands[0].id);
        const receipt = { commandId: fault === "identity" ? "wrong" : commands[0].id,
          disposition: fault === "disposition" ? "scheduled" as const : "applied" as const };
        return { ok: true, value: { world: staged,
          receipts: fault === "missing" ? [] : fault === "extra" ? [receipt, receipt] : [receipt] } };
      },
      feedback() {
        feedbackCalls += 1;
        return { ok: false, diagnostics: [{ code: "missing-input", message: "feedback unavailable" }] };
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.deepEqual([result.diagnostics[0].triggerId, result.diagnostics[0].actionIndex], [1, 0]);
    assert.equal(feedbackCalls, fault === "feedback" ? 1 : 0);
    assert.deepEqual(world, []);
    assert.equal(state.revision, 0);
    assert.equal(state.runtime.lives[1], 1);
  }
});

test("actual ALIEN01 cycle-16 startup retains every action and plans commands without diagnostics", () => {
  const blocks = fixture("ALIEN");
  const state = unwrap(createMissionController(blocks, alienStatistics));
  assert.deepEqual(state.blocks, blocks);
  assert.notEqual(state.blocks, blocks);
  const before = planMissionStep(state, { ...inputs, cycleCounter: 15 }, normal);
  assert.deepEqual(before.fired, []);
  assert.ok(before.next);
  const plan = planMissionStep(state, inputs, normal);
  assert.deepEqual(plan.fired, [1]);
  assert.deepEqual(plan.trace.map(({ action }) => action.name), ["msg", "reinforce2", "reinforce"]);
  assert.deepEqual(plan.commands.map(({ command }) => command.kind), ["msg", "reinforce2", "reinforce"]);
  assert.deepEqual(plan.commands.map(({ actionIndex }) => actionIndex), [2, 1, 0]);
  assert.ok(plan.next);
  assert.equal(plan.next.runtime.lives[1], 0);
  assert.deepEqual(plan.diagnostics, []);
  assert.equal(plan.pendingEvaluation, null);
  assert.equal(state.runtime.lives[1], 1);
});

test("actual HUMAN01 cycle-16 initialization plans all eight commands in reverse source order", () => {
  const state = unwrap(createMissionController(fixture("HUMAN"), humanStatistics));
  const snapshot = structuredClone(state);
  const plan = planMissionStep(state, { ...inputs, buildingSlots: colonySlots }, normal);
  assert.deepEqual(plan.fired, [8]);
  assert.deepEqual(plan.trace.map(({ action }) => action.name),
    ["msg", "exomoney", "exomoney", "exomoney", "exomoney", "exomoney", "reinforce", "waypoint"]);
  assert.deepEqual(plan.trace.filter(({ action }) => action.name === "exomoney").map(({ action }) => action.arguments),
    [[4, 0], [3, 0], [2, 0], [0, 0], [1, 0]]);
  assert.deepEqual(plan.diagnostics, []);
  assert.equal(plan.pendingEvaluation, null);
  assert.equal(plan.commands.length, 8);
  assert.deepEqual(plan.commands.map(({ actionIndex }) => actionIndex), [7, 6, 5, 4, 3, 2, 1, 0]);
  assert.deepEqual(plan.commands[6].command, {
    kind: "reinforce", team: 0, tileX: 22, tileY: 2,
    groups: [{ unitType: 0, count: 4 }, { unitType: 69, count: 1 },
      { unitType: 0, count: 0 }, { unitType: 0, count: 0 }, { unitType: 0, count: 0 }],
  });
  assert.deepEqual(plan.commands[0].command, { kind: "msg", presentationCode: 2, reserved: 0, messageId: 1, parameter3: 3, parameter4: 8 });
  assert.deepEqual(plan.commands.slice(1, 6).map(({ command }) => command),
    [4, 3, 2, 0, 1].map((team) => ({ kind: "exomoney", team, value: 0 })));
  assert.deepEqual(plan.commands[7].command, { kind: "waypoint", tileX: 41, tileY: 12,
    points: [{ tileX: 40, tileY: 14 }, { tileX: 41, tileY: 12 }] });
  assert.ok(plan.next);
  assert.equal(plan.next.runtime.lives[8], 0);
  assert.equal(commitMissionPlan(state, plan, null, createMissionStartupAdapter({})).ok, false);
  assert.deepEqual(state, snapshot);
});

test("actual trip 7 proposes rearming before message, delivery, and newtype", () => {
  const state = unwrap(createMissionController(fixture("HUMAN"), humanStatistics));
  const wrongTeam = planMissionStep(state, inputs, { kind: "trip", triggerId: 7, team: 1 });
  assert.deepEqual(wrongTeam.fired, []);
  const plan = planMissionStep(state, inputs, { kind: "trip", triggerId: 7, team: 0 });
  assert.deepEqual(plan.trace.map(({ action }) => action.name), ["setlifes", "msg", "reinforce", "newtype"]);
  assert.equal(plan.next?.runtime.lives[4], 1);
  assert.equal(plan.next?.runtime.lives[7], 0);
  assert.deepEqual(plan.diagnostics, []);
  assert.equal(state.runtime.lives[4], 0);
  assert.equal(state.runtime.lives[7], 1);
});

test("actual ALIEN01 failure consumes injected victim loss exactly once, with no attacker credit", () => {
  const state = unwrap(createMissionController(fixture("ALIEN"), { ...alienStatistics, "0,2": 91 }));
  const loss = { id: "combat-removal:slot152:generation1", victimTeam: 0, victimType: 73 };
  const plan = planMissionStep(state, { ...inputs, cycleCounter: 0 }, normal, [loss, loss]);
  assert.deepEqual(plan.fired, [2]);
  assert.ok(plan.next);
  const committed = unwrap(commitMissionPlan(state, plan, null, noCommands));
  assert.equal(committed.state.runtime.statistics["0,0,73"], 1);
  assert.equal(committed.state.runtime.statistics["0,3"], 1);
  assert.equal(committed.state.runtime.statistics["0,2"], 91);
  assert.deepEqual(committed.state.runtime.bail, { resultCode: 1, reasonCode: 2, deadlineMilliseconds: 10100 });
  const replay = planMissionStep(committed.state, { ...inputs, cycleCounter: 0 }, normal, [loss]);
  assert.deepEqual(replay.fired, []);
  assert.equal(replay.next?.runtime.statistics["0,0,73"], 1);
  assert.equal(planMissionStep(committed.state, inputs, normal, [{ ...loss, victimType: 82 }]).next, null);
  assert.equal(commitMissionPlan(committed.state, plan, null, noCommands).ok, false);
  assert.deepEqual(state.runtime.statistics, { ...alienStatistics, "0,2": 91 });
});

test("actual ALIEN01 success predicate crosses 10 only with injected team-1 type-82 losses", () => {
  const state = unwrap(createMissionController(fixture("ALIEN"), { ...alienStatistics, "0,2": 999, "0,1,82": 999 }));
  const losses = Array.from({ length: 11 }, (_, index) => ({ id: `alien-objective:${index}`, victimTeam: 1, victimType: 82 }));
  const ten = planMissionStep(state, { ...inputs, cycleCounter: 0 }, normal, losses.slice(0, 10));
  assert.deepEqual(ten.fired, []);
  const afterTen = unwrap(commitMissionPlan(state, ten, null, noCommands)).state;
  const eleven = planMissionStep(afterTen, { ...inputs, cycleCounter: 0 }, normal, losses);
  assert.deepEqual(eleven.fired, [3]);
  assert.deepEqual(eleven.trace.map(({ action }) => action.name), ["msg", "abduct", "bail"]);
  assert.deepEqual(eleven.commands[1].command, { kind: "abduct", selectedSide: 0, carrierSide: 0 });
  assert.equal(eleven.next?.runtime.bail?.resultCode, 0);
  assert.equal(afterTen.runtime.statistics["1,0,82"], 10);
  assert.equal(afterTen.runtime.bail, null);
  assert.equal(Object.hasOwn(afterTen.consumedLosses, losses[10].id), false);
});

test("HUMAN01 victory remains disarmed; an explicitly injected rearmed checkpoint tests the strict predicate only", () => {
  const state = unwrap(createMissionController(fixture("HUMAN"), humanStatistics));
  const losses = Array.from({ length: 3 }, (_, index) => ({ id: `human-objective:${index}`, victimTeam: 4, victimType: 8 }));
  const supplied = { ...inputs, cycleCounter: 0, buildingSlots: colonySlots };
  const disarmed = planMissionStep(state, supplied, normal, losses);
  assert.deepEqual(disarmed.fired, []);
  const checkpoint = { ...state, runtime: { ...state.runtime, lives: { ...state.runtime.lives, 4: 1 } } };
  assert.deepEqual(planMissionStep(checkpoint, supplied, normal, losses.slice(0, 2)).fired, []);
  const victory = planMissionStep(checkpoint, supplied, normal, losses);
  assert.deepEqual(victory.fired, [4]);
  assert.deepEqual(victory.trace.map(({ action }) => action.name), ["bail", "msg", "abduct"]);
  assert.equal(victory.next?.runtime.bail?.resultCode, 0);
  assert.equal(checkpoint.runtime.bail, null);
});

test("HUMAN01 failure reads supplied structure slots and exact commander loss equality", () => {
  const state = unwrap(createMissionController(fixture("HUMAN"), humanStatistics));
  const supplied = { ...inputs, cycleCounter: 0, buildingSlots: colonySlots };
  const missing = planMissionStep(state, { ...supplied, buildingSlots: {} }, normal);
  assert.equal(missing.diagnostics[0].code, "missing-input");
  const destroyedSlots = Object.fromEntries(Object.keys(colonySlots).map((key) => [key, 0]));
  const destroyed = planMissionStep(state, { ...supplied, buildingSlots: destroyedSlots }, normal);
  assert.deepEqual(destroyed.fired, [5]);
  assert.equal(destroyed.next?.runtime.bail?.reasonCode, 4);
  const oneLoss = { id: "human-commander:1", victimTeam: 0, victimType: 69 };
  assert.deepEqual(planMissionStep(state, supplied, normal, [oneLoss]).fired, [9]);
  assert.deepEqual(planMissionStep(state, supplied, normal, [oneLoss, { ...oneLoss, id: "human-commander:2" }]).fired, []);
  const source = state.blocks.find(({ id }) => id === 9)!;
  assert.equal(unwrap(evaluateTriggerCondition(source.condition, { ...humanStatistics, "0,0,69": 2 }, supplied)), 0);
});

test("supported action transactions delegate lives, reverse bail order, and same-pass rearming to the VM", () => {
  const state = unwrap(createMissionController(parseTriggerScript(`4 norm 0 (c>0)
bail 0 1
end
2 norm 1 (c>0)
setlifes 4 1
setlifes 2 0
end`), {}));
  const plan = planMissionStep(state, inputs, normal);
  assert.deepEqual(plan.fired, [2, 4]);
  assert.deepEqual(plan.next?.runtime.lives, { 2: 255, 4: 0 });
  assert.equal(plan.next?.runtime.bail?.resultCode, 0);
  const ordered = unwrap(createMissionController(parseTriggerScript(`1 norm 1 (c>0)
bail 0 1
abduct 0 0
bail 1 4
end
2 norm 1 (s(7,0)==1)
setlifes 1 0
end`), {}));
  const pending = planMissionStep(ordered, inputs, normal);
  assert.deepEqual(pending.trace.map(({ action }) => action.name), ["bail", "abduct", "bail", "setlifes"]);
  assert.deepEqual(pending.fired, [1, 2]);
  assert.equal(pending.next?.runtime.bail?.reasonCode, 1);
  assert.equal(pending.next?.runtime.statistics["7,0"], 1);
});

test("explicit repeated trip events consume lives, never synthetic region polling", () => {
  const state = unwrap(createMissionController(parseTriggerScript("7 trip 2 (S==0)\nend"), {}));
  assert.deepEqual(planMissionStep(state, inputs, normal).fired, []);
  const first = planMissionStep(state, inputs, { kind: "trip", triggerId: 7, team: 0 });
  const committed = unwrap(commitMissionPlan(state, first, null, noCommands)).state;
  const second = planMissionStep(committed, inputs, { kind: "trip", triggerId: 7, team: 0 });
  assert.equal(second.next?.runtime.lives[7], 0);
  assert.equal(planMissionStep(state, inputs, { kind: "trip", triggerId: 8, team: 0 }).next, null);
});

test("transport parsing preserves group order and the real ALIEN01 omitted fifth pair", () => {
  const shortened = fixture("ALIEN").find(({ id }) => id === 8)!.actions[0];
  const command = unwrap(decodeMissionWorldAction(shortened));
  assert.equal(command.kind, "reinforce");
  if (command.kind !== "reinforce") throw new Error("Expected reinforcement");
  assert.deepEqual(command.groups, [
    { unitType: 8, count: 2 }, { unitType: 0, count: 0 }, { unitType: 0, count: 0 },
    { unitType: 0, count: 0 }, { unitType: 0, count: 0 },
  ]);
  for (const action of [
    { name: "reinforce", arguments: [0, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { name: "reinforce", arguments: [0, 1, 2] },
    { name: "reinforce2", arguments: [0, 1, 2, 110, 1, 0, 0, 0, 0, 0, 0] },
    { name: "abduct", arguments: [8, 0] },
    { name: "newtype", arguments: [54, 17, 110] },
    { name: "waypoint", arguments: [1, 2, 2, 3, 4] },
    { name: "msg", arguments: [2, 1, 1, 3, 6] },
    { name: "exomoney", arguments: [8, 0] },
    { name: "unknown", arguments: [] },
  ]) assert.equal(decodeMissionWorldAction(action).ok, false, action.name);
});

test("adapter schedules a transport intent, without fabricating pickup or victim loss", () => {
  const state = unwrap(createMissionController(parseTriggerScript("1 norm 1 (c>0)\nabduct 0 0\nbail 0 1\nend"), {}));
  const plan = planMissionStep(state, inputs, normal);
  const inbox: readonly PlannedMissionCommand[] = [];
  const intentOnlyAdapter: MissionWorldAdapter<readonly PlannedMissionCommand[]> = {
    prepare(world, commands) {
      return { ok: true, value: { world: [...world, ...commands],
        receipts: commands.map(({ id }) => ({ commandId: id, disposition: "scheduled" })) } };
    },
  };
  const committed = unwrap(commitMissionPlan(state, plan, inbox, intentOnlyAdapter));
  assert.equal(committed.world.length, 1);
  assert.deepEqual(inbox, []);
  assert.deepEqual(committed.state.consumedLosses, {});
  assert.deepEqual(committed.state.runtime.statistics, { "0,0": 0, "7,0": 1 });
  assert.equal(unwrap(missionBailDeadlineExceeded(committed.state.runtime.bail, 10100)), false);
  assert.equal(unwrap(missionBailDeadlineExceeded(committed.state.runtime.bail, 10101)), true);
});

test("adapter rejection, missing receipts, and instant abduction claims cannot commit", () => {
  const state = unwrap(createMissionController(parseTriggerScript("1 norm 1 (c>0)\nabduct 0 0\nbail 0 1\nend"), alienStatistics));
  const plan = planMissionStep(state, inputs, normal, [{ id: "loss", victimTeam: 1, victimType: 82 }]);
  const failed: MissionWorldAdapter<null> = {
    prepare() { return { ok: false, diagnostics: [{ code: "missing-input", message: "Commander slot is invalid" }] }; },
  };
  assert.equal(commitMissionPlan(state, plan, null, failed).ok, false);
  for (const receipts of [[], [{ commandId: plan.commands[0].id, disposition: "applied" as const }],
    [{ commandId: "wrong", disposition: "scheduled" as const }]]) {
    assert.equal(commitMissionPlan(state, plan, null, {
      prepare(world) { return { ok: true, value: { world, receipts } }; },
    }).ok, false);
  }
  assert.equal(state.runtime.bail, null);
  assert.equal(state.runtime.lives[1], 1);
  assert.deepEqual(state.consumedLosses, {});
  assert.deepEqual(planMissionStep(state, inputs, normal, [{ id: "loss", victimTeam: 1, victimType: 82 }]), plan);
});

test("newtype adapter can use the verified primitive without changing owner, HP, or status", () => {
  const state = unwrap(createMissionController(parseTriggerScript("1 trip 1 (S==0)\nnewtype 54 17 84\nend"), {}));
  const plan = planMissionStep(state, inputs, { kind: "trip", triggerId: 1, team: 0 });
  const raw = new Uint8Array(800 * 220);
  raw[1] = 54;
  raw[5] = 17;
  raw[6] = 95;
  raw[7] = 1;
  const movement = new Uint8Array(110);
  const adapter: MissionWorldAdapter<Uint8Array> = {
    prepare(world, commands) {
      const planned = commands[0];
      assert.equal(planned.command.kind, "newtype");
      if (planned.command.kind !== "newtype") throw new Error("Expected newtype");
      const { tileX, tileY, newType } = planned.command;
      const applied = applyTriggerNewtype(world, movement, tileX, tileY, newType);
      if (!applied.ok) return applied;
      return { ok: true, value: { world: applied.value.entityBytes, receipts: [{ commandId: planned.id,
        disposition: applied.value.changedSlot === null ? "verified-no-match" : "applied" }] } };
    },
  };
  const result = unwrap(commitMissionPlan(state, plan, raw, adapter));
  const expected = new Uint8Array(raw);
  expected[6] = 84;
  assert.deepEqual(result.world, expected);
  assert.equal(raw[6], 95);
});

test("bail uses unsigned wrap and strict deadline comparison independent of simulation ticks", () => {
  const state = unwrap(createMissionController(parseTriggerScript("1 norm 1 (c>0)\nbail 0 1\nend"), {}));
  const plan = planMissionStep(state, { ...inputs, clockMilliseconds: 4294967295 }, normal);
  const bail = plan.next!.runtime.bail;
  assert.equal(bail?.deadlineMilliseconds, 9999);
  for (const [clock, expected] of [[4294967295, false], [9999, false], [10000, true]] as const) {
    assert.equal(unwrap(missionBailDeadlineExceeded(bail, clock)), expected);
  }
  assert.equal(unwrap(missionBailDeadlineExceeded(null, 10000)), false);
  assert.equal(missionBailDeadlineExceeded(bail, -1).ok, false);
});

test("diagnostics retain original source action indexes after world-command filtering", () => {
  const state = unwrap(createMissionController(parseTriggerScript("1 norm 1 (c>0)\nabduct 0 0\nsetlifes 99 1\nend"), {}));
  const plan = planMissionStep(state, inputs, normal);
  assert.equal(plan.next, null);
  assert.equal(plan.diagnostics[0].actionIndex, 1);
  assert.equal(plan.diagnostics[0].triggerId, 1);
});

test("literal startup action decoding rejects malformed, expression, and narrowing inputs", () => {
  assert.deepEqual(unwrap(decodeMissionWorldAction({ name: "exomoney", arguments: [7, 255] })),
    { kind: "exomoney", team: 7, value: 255 });
  assert.deepEqual(unwrap(decodeMissionWorldAction({ name: "msg", arguments: [255, 0, 29, 254, 255] })),
    { kind: "msg", presentationCode: 255, reserved: 0, messageId: 29, parameter3: 254, parameter4: 255 });
  const points = Array.from({ length: 8 }, (_, index) => ({ tileX: index, tileY: 255 - index }));
  assert.deepEqual(unwrap(decodeMissionWorldAction({ name: "waypoint", arguments: [255, 0, 8,
    ...points.flatMap(({ tileX, tileY }) => [tileX, tileY])] })), { kind: "waypoint", tileX: 255, tileY: 0, points });
  for (const action of [
    { name: "msg", arguments: [2, 0, 30, 3, 6] },
    { name: "msg", arguments: [2, 0, 1, 3] },
    { name: "msg", arguments: [2, 0, 1, 3, 6, 0] },
    { name: "msg", arguments: [2, 0, "s(0,0)", 3, 6] },
    { name: "exomoney", arguments: [0, 256] },
    { name: "exomoney", arguments: [0, -1] },
    { name: "exomoney", arguments: [0, 1.5] },
    { name: "exomoney", arguments: [0, "0"] },
    { name: "exomoney", arguments: [0] },
    { name: "exomoney", arguments: [0, 0, 0] },
    { name: "waypoint", arguments: [1, 2, 0] },
    { name: "waypoint", arguments: [1, 2, 9, ...Array(18).fill(0)] },
    { name: "waypoint", arguments: [1, 2, 1, 3, 4, 5] },
    { name: "waypoint", arguments: [1, 2, 1, 256, 4] },
  ]) assert.equal(decodeMissionWorldAction(action).ok, false, JSON.stringify(action));
});

test("world-dependent later conditions suspend before evaluation and cannot be certified by receipts", () => {
  for (const action of ["exomoney 0 1", "newtype 54 17 84", "reinforce2 0 1 2 0 1 0 0 0 0 0 0"]) {
    for (const condition of ["s(0,4)>0", "s(0,1,84)>0", "b(0,0)==1", "s(0,s(1,3))==0"]) {
      const state = unwrap(createMissionController(parseTriggerScript(`1 norm 1 (c>0)
${action}
end
2 norm 1 (${condition})
bail 0 1
end`), {}));
      const before = structuredClone(state);
      const plan = planMissionStep(state, inputs, normal);
      assert.deepEqual(plan.fired, [1]);
      assert.equal(plan.commands.length, 1);
      assert.deepEqual(plan.diagnostics, []);
      assert.equal(plan.next, null);
      assert.deepEqual(plan.pendingEvaluation, { triggerId: 2, condition: `(${condition})`, afterCommandIds: ["0:1:0"] });
      let prepared = false;
      const result = commitMissionPlan(state, plan, null, { prepare(world, commands) {
        prepared = true;
        return { ok: true, value: { world, receipts: commands.map(({ id }) => ({ commandId: id, disposition: "applied" })) } };
      } });
      assert.equal(result.ok, false);
      assert.equal(prepared, false);
      assert.deepEqual(state, before);
    }
  }
});

test("dead and trip-only conditions do not suspend a normal scan; loss reads remain immediate", () => {
  const state = unwrap(createMissionController(parseTriggerScript(`1 norm 1 (c>0)
exomoney 0 0
newtype 54 17 84
end
2 norm 0 (s(0,4)>0)
end
3 trip 1 (b(0,0)==0)
end
4 norm 1 ((s(0,3)==0)&&(s(0,0,69)==0))
bail 0 1
end`), { "0,3": 0, "0,0,69": 0 }));
  const plan = planMissionStep(state, inputs, normal);
  assert.deepEqual(plan.fired, [1, 4]);
  assert.ok(plan.next);
  assert.equal(plan.pendingEvaluation, null);
});

test("startup adapter stages in command order and fails the real startup without a transport implementation", () => {
  const state = unwrap(createMissionController(fixture("HUMAN"), humanStatistics));
  const plan = planMissionStep(state, { ...inputs, buildingSlots: colonySlots }, normal);
  const world = { text: { 1: "fixture message" } as Record<number, string>, messages: [] as number[],
    exomoney: { 0: 9, 1: 9, 2: 9, 3: 9, 4: 9 } as Record<number, number> };
  const before = structuredClone(world);
  const visited: string[] = [];
  const adapter = createMissionStartupAdapter<typeof world>({
    msg(staged, { command, id }) {
      assert.equal(command.kind, "msg");
      if (command.kind !== "msg") throw new Error("Expected msg");
      if (!staged.text[command.messageId]) return { ok: false, diagnostics: [{ code: "missing-input", message: "Message text is unavailable" }] };
      visited.push(id);
      return { ok: true, value: { world: { ...staged, messages: [...staged.messages, command.messageId] }, disposition: "applied" } };
    },
    exomoney(staged, { command, id }) {
      assert.equal(command.kind, "exomoney");
      if (command.kind !== "exomoney") throw new Error("Expected exomoney");
      assert.deepEqual(staged.messages, [1]);
      visited.push(id);
      return { ok: true, value: { world: { ...staged, exomoney: { ...staged.exomoney, [command.team]: command.value } }, disposition: "applied" } };
    },
  });
  const rejected = commitMissionPlan(state, plan, world, adapter);
  assert.equal(rejected.ok, false);
  if (rejected.ok) throw new Error("Transport must remain unimplemented");
  assert.match(rejected.diagnostics[0].message, /No startup adapter for reinforce/);
  assert.deepEqual(visited, plan.commands.slice(0, 6).map(({ id }) => id));
  assert.deepEqual(world, before);
  assert.equal(state.runtime.lives[8], 1);
  assert.equal(state.revision, 0);
  visited.length = 0;
  assert.equal(commitMissionPlan(state, plan, { ...world, text: {} }, adapter).ok, false);
  assert.deepEqual(visited, []);
});

test("new startup command receipts require exact order, identity, and per-command dispositions", () => {
  const state = unwrap(createMissionController(parseTriggerScript(`1 norm 1 (c>0)
waypoint 1 2 1 3 4
exomoney 0 0
msg 2 0 1 3 6
end`), {}));
  const plan = planMissionStep(state, inputs, normal);
  const receipts = plan.commands.map(({ id, command }) => ({ commandId: id,
    disposition: command.kind === "waypoint" ? "verified-no-match" as const : "applied" as const }));
  const accountingOnly: MissionWorldAdapter<null> = { prepare(world) { return { ok: true, value: { world, receipts } }; } };
  const result = unwrap(commitMissionPlan(state, plan, null, accountingOnly));
  assert.deepEqual(result.receipts, receipts);
  assert.equal(result.state.runtime.lives[1], 0);
  assert.equal(result.state.revision, 1);
  assert.deepEqual(result.state.runtime.statistics, {});
  for (const invalidReceipts of [receipts.slice(1), [...receipts, receipts[0]], [...receipts].reverse(),
    receipts.map((receipt) => ({ ...receipt, commandId: "wrong" })),
    receipts.map((receipt) => ({ ...receipt, disposition: "scheduled" as const })),
    receipts.map((receipt) => ({ ...receipt, disposition: "verified-no-match" as const }))]) {
    assert.equal(commitMissionPlan(state, plan, null, { prepare(world) {
      return { ok: true, value: { world, receipts: invalidReceipts } };
    } }).ok, false);
  }
});

test("unsupported actions remain in reverse trace and block the whole transaction", () => {
  const state = unwrap(createMissionController(parseTriggerScript(`1 norm 1 (c>0)
unknown 1
msg 2 0 1 3 6
waypoint 1 2 0
exomoney 0 0
end`), {}));
  const plan = planMissionStep(state, inputs, normal);
  assert.deepEqual(plan.trace.map(({ actionIndex }) => actionIndex), [3, 2, 1, 0]);
  assert.deepEqual(plan.commands.map(({ actionIndex }) => actionIndex), [3, 1]);
  assert.deepEqual(plan.diagnostics.map(({ actionIndex }) => actionIndex), [2, 0]);
  assert.equal(plan.next, null);
  assert.equal(commitMissionPlan(state, plan, null, createMissionStartupAdapter({})).ok, false);
});
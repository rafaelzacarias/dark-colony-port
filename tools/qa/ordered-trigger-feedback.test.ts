import assert from "node:assert/strict";
import test from "node:test";
import {
  commitMissionPlan,
  createMissionController,
  executeMissionTransaction,
  planMissionStep,
  type MissionCommandReceipt,
  type MissionTransactionAdapter,
} from "../../src/engine/mission-controller.ts";
import type { TriggerResult } from "../../src/engine/trigger-runtime.ts";
import { parseTriggerScript } from "../extractors/data/triggers.ts";

function unwrap<Value>(result: TriggerResult<Value>): Value {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("Expected success");
  return result.value;
}

const inputs = { cycleCounter: 16, clockMilliseconds: 100, buildingSlots: {} };
const event = { kind: "normal" } as const;
const feedback: MissionTransactionAdapter<null>["feedback"] = (world, runtime, supplied) => ({
  ok: true, value: { world, statistics: runtime.statistics, buildingSlots: supplied.buildingSlots },
});

function fixture(actions = "msg 2 0 1 3 8") {
  const source = parseTriggerScript(`1 norm 1 (1)\n${actions}\nend`);
  const state = unwrap(createMissionController(source, {}));
  const plan = planMissionStep(state, inputs, event);
  return { source, state, plan };
}

for (const mode of ["execute", "commit"] as const) {
  test(`${mode}: rejecting adapter cannot mutate source, controller or plan metadata`, () => {
    const { source, state, plan } = fixture("waypoint 4 5 1 6 7");
    const before = structuredClone({ source, state, plan, inputs });
    const adapter: MissionTransactionAdapter<null> = {
      prepare(_world, commands) {
        const planned = commands[0];
        Reflect.set(planned.action.arguments, "0", 99);
        Reflect.set(planned.action, "name", "abduct");
        assert.equal(planned.command.kind, "waypoint");
        if (planned.command.kind === "waypoint") Reflect.set(planned.command.points[0], "tileX", 99);
        Reflect.set(planned.statistics!, "0,2,0", 99);
        Reflect.set(planned, "id", "changed");
        Reflect.set(commands, "length", 0);
        return { ok: false, diagnostics: [{ code: "invalid-input", message: "rejected" }] };
      },
      feedback,
    };
    const result = mode === "execute"
      ? executeMissionTransaction(state, inputs, event, null, adapter)
      : commitMissionPlan(state, plan, null, adapter);
    assert.equal(result.ok, false);
    assert.deepEqual({ source, state, plan, inputs }, before);
  });

  const malformedReceipts: Record<string, (commandId: string) => unknown> = {
    sparse: () => new Array(1),
    inherited: (commandId) => Object.setPrototypeOf(new Array(1), {
      0: { commandId, disposition: "applied" },
    }),
    undefined: () => [undefined],
    null: () => [null],
    primitive: () => ["receipt"],
    "array-like": (commandId) => ({ length: 1, 0: { commandId, disposition: "applied" } }),
    "wrong id": () => [{ commandId: "wrong", disposition: "applied" }],
    "wrong disposition": (commandId) => [{ commandId, disposition: "scheduled" }],
    "throwing field": () => [{ get commandId() { throw new Error("unavailable"); }, disposition: "applied" }],
    "throwing entry": () => Object.defineProperty(new Array(1), "0", {
      get() { throw new Error("unavailable"); },
    }),
  };
  for (const [name, makeReceipts] of Object.entries(malformedReceipts)) {
    test(`${mode}: rejects ${name} receipts without feedback or publication`, () => {
      const { state, plan } = fixture();
      const before = structuredClone({ state, plan });
      let feedbackCalls = 0;
      const adapter: MissionTransactionAdapter<null> = {
        prepare(world, commands) {
          return { ok: true, value: { world,
            receipts: makeReceipts(commands[0].id) as readonly MissionCommandReceipt[] } };
        },
        feedback(...args) {
          feedbackCalls += 1;
          return feedback(...args);
        },
      };
      const result = mode === "execute"
        ? executeMissionTransaction(state, inputs, event, null, adapter)
        : commitMissionPlan(state, plan, null, adapter);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.diagnostics[0].code, "invalid-input");
        if (mode === "execute") {
          assert.equal(result.diagnostics[0].triggerId, 1);
          assert.equal(result.diagnostics[0].actionIndex, 0);
        }
      }
      assert.equal(feedbackCalls, 0);
      assert.deepEqual({ state, plan }, before);
    });
  }

  test(`${mode}: reads receipt fields once and returns detached plain data`, () => {
    const { state, plan } = fixture();
    let idReads = 0;
    let dispositionReads = 0;
    const supplied = [{
      get commandId() { return ++idReads === 1 ? "0:1:0" : "changed"; },
      get disposition(): "applied" | "scheduled" { return ++dispositionReads === 1 ? "applied" : "scheduled"; },
    }];
    const adapter: MissionTransactionAdapter<null> = {
      prepare(world) { return { ok: true, value: { world, receipts: supplied } }; },
      feedback,
    };
    const result = unwrap(mode === "execute"
      ? executeMissionTransaction(state, inputs, event, null, adapter)
      : commitMissionPlan(state, plan, null, adapter));
    assert.notEqual(result.receipts, supplied);
    assert.notEqual(result.receipts[0], supplied[0]);
    assert.deepEqual(result.receipts, [{ commandId: "0:1:0", disposition: "applied" }]);
    assert.equal(idReads, 1);
    assert.equal(dispositionReads, 1);
    assert.equal(Object.getOwnPropertyDescriptor(result.receipts[0], "commandId")!.get, undefined);
    supplied.length = 0;
    assert.equal(result.receipts.length, 1);
  });
}

test("execute: command metadata and reused receipts stay stable across prepare and feedback", () => {
  const { state, plan } = fixture("msg 2 0 1 3 8\nmsg 2 0 2 3 8");
  const before = structuredClone({ state, plan });
  const reused = { commandId: "", disposition: "applied" as MissionCommandReceipt["disposition"] };
  const supplied = [reused];
  const result = unwrap(executeMissionTransaction(state, inputs, event, null, {
    prepare(world, commands) {
      reused.commandId = commands[0].id;
      reused.disposition = "applied";
      Reflect.set(commands[0].action.arguments, "2", 29);
      Reflect.set(commands[0].command, "messageId", 29);
      Reflect.set(commands[0], "id", "changed");
      return { ok: true, value: { world, receipts: supplied } };
    },
    feedback(...args) {
      reused.commandId = "feedback mutation";
      reused.disposition = "scheduled";
      return feedback(...args);
    },
  }));
  assert.deepEqual(result.commands, plan.commands);
  assert.deepEqual(result.trace, plan.trace);
  assert.deepEqual(result.receipts, [
    { commandId: "0:1:1", disposition: "applied" },
    { commandId: "0:1:0", disposition: "applied" },
  ]);
  assert.notEqual(result.receipts[0], result.receipts[1]);
  assert.deepEqual({ state, plan }, before);
  reused.commandId = "after return";
  supplied.length = 0;
  assert.deepEqual(result.receipts.map(({ commandId }) => commandId), ["0:1:1", "0:1:0"]);
});

test("commit: adapter-owned receipt mutations after return cannot change accepted receipts", () => {
  const { state, plan } = fixture();
  const receipt = { commandId: "0:1:0", disposition: "applied" as MissionCommandReceipt["disposition"] };
  const supplied = [receipt];
  const result = unwrap(commitMissionPlan(state, plan, null, {
    prepare(world) { return { ok: true, value: { world, receipts: supplied } }; },
  }));
  receipt.commandId = "changed";
  receipt.disposition = "scheduled";
  supplied.length = 0;
  assert.deepEqual(result.receipts, [{ commandId: "0:1:0", disposition: "applied" }]);
});
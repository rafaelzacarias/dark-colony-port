import assert from "node:assert/strict";
import test from "node:test";
import {
  completeLegacyInspireTask13, resolveLegacyInspireMultiplierQ8,
  type LegacyInspireTask13Frame, type LegacyInspireTask13Host,
} from "../../src/engine/legacy-inspire";

function fixture() {
  const frame = { animationMode: 2, casterTypeId: 69, casterSlot: 152, xQ8: 128, yQ8: 128 };
  const events: string[] = [];
  const state = { charge: 255, pendingOrder: 1, task: 13, timer: 0, casterSlot: 0 };
  const host: LegacyInspireTask13Host = {
    continuePendingOrder(slot) {
      assert.equal(slot, 152);
      events.push(`continue:${state.charge}`);
      state.task = state.pendingOrder;
      state.pendingOrder = 0;
    },
    clearCasterCharge(slot) {
      assert.equal(slot, 152);
      events.push("clear");
      state.charge = 0;
    },
    readScanContext(slot) {
      assert.equal(slot, 152);
      assert.equal(state.charge, 0);
      events.push("read");
      return {
        casterTeam: 1, width: 1, height: 1, ground: [153], air: [1023],
        slots: { 153: { team: 1, primaryWeapon: 1, multiplierQ8: 0 } },
        randomTable: Array.from({ length: 256 }, (_, index) => index), randomIndex: 254,
      };
    },
    commitScan(result) {
      events.push("commit");
      for (const write of result.writes) {
        state.timer = write.timer;
        state.casterSlot = write.casterSlot;
      }
    },
  };
  return { frame, events, state, host };
}

test("only native animation mode 2 completes an already-scheduled Inspire task", () => {
  for (const animationMode of [0, 1, 3]) {
    const { frame, events, state, host } = fixture();
    assert.equal(completeLegacyInspireTask13({ ...frame, animationMode }, host), null);
    assert.deepEqual(events, []);
    assert.equal(state.charge, 255);
    assert.equal(state.task, 13);
  }
});

test("queued stop continues before clearing charge but does not cancel the committed effect", () => {
  for (const casterTypeId of [69, 73]) {
    const { frame, events, state, host } = fixture();
    const result = completeLegacyInspireTask13({ ...frame, casterTypeId }, host)!;
    assert.deepEqual(events, ["continue:255", "clear", "read", "commit"]);
    assert.equal(state.task, 1);
    assert.equal(state.charge, 0);
    assert.deepEqual(result.writes.map((write) => write.timer), [35, 20, 21, 22]);
    assert.equal(result.randomIndex, 2);
    assert.equal(state.casterSlot, 152);
  }
});

test("a queued redeploy observes old charge and its next task completes without a second charge gate", () => {
  const { frame, events, state, host } = fixture();
  state.pendingOrder = 13;
  completeLegacyInspireTask13(frame, host);
  assert.equal(state.task, 13);
  assert.equal(state.charge, 0);
  assert.equal(completeLegacyInspireTask13({ ...frame, animationMode: 1 }, host), null);
  state.pendingOrder = 1;
  completeLegacyInspireTask13(frame, host);
  assert.deepEqual(events, ["continue:255", "clear", "read", "commit", "continue:0", "clear", "read", "commit"]);
  assert.equal(state.task, 1);
});

test("effect coordinates and budget precede continuation; team, occupancy and RNG follow it", () => {
  const { frame, host } = fixture();
  const continueOrder = host.continuePendingOrder;
  let continued = false;
  host.continuePendingOrder = (slot) => {
    continueOrder(slot);
    frame.xQ8 = 20000;
    frame.casterTypeId = 72;
    continued = true;
  };
  host.readScanContext = () => {
    assert.equal(continued, true);
    return {
      casterTeam: 7, width: 1, height: 1, ground: [153], air: [153],
      slots: { 153: { team: 7, primaryWeapon: 1, multiplierQ8: 0 } },
      randomTable: Array.from({ length: 256 }, (_, index) => index), randomIndex: 10,
    };
  };
  const result = completeLegacyInspireTask13(frame, host)!;
  assert.equal(result.writes.length, 6);
  assert.equal(result.randomIndex, 16);
  assert.equal(result.writes[0].timer, 31);
});

test("task completion does not invent a death policy for native caster-slot references", () => {
  const { frame, host, state } = fixture();
  completeLegacyInspireTask13(frame, host);
  const slots = { 152: { team: 1, multiplierQ8: 332, primaryWeapon: 1 } };
  assert.ok(state.timer > 0);
  assert.equal(resolveLegacyInspireMultiplierQ8(state, slots), 332);
  slots[152] = { team: 1, multiplierQ8: 0, primaryWeapon: 1 };
  assert.equal(resolveLegacyInspireMultiplierQ8(state, slots), 0);
  assert.equal(state.casterSlot, 152);
});

test("other task-13 deployment types fail before any Inspire effect or continuation", () => {
  const { frame, events, host } = fixture();
  const other: LegacyInspireTask13Frame = { ...frame, casterTypeId: 0 };
  assert.throws(() => completeLegacyInspireTask13(other, host), /not Inspire/);
  assert.deepEqual(events, []);
});
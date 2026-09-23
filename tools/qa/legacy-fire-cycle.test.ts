import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  createLegacyFireCycle,
  stepLegacyFireCycle,
  type LegacyFireCycle,
  type LegacyFireObservation,
  type LegacyFireSourceType,
} from "../../src/engine/legacy-fire-cycle.ts";

const roster: readonly LegacyFireSourceType[] = [0, 8, 69, 70, 71, 72, 73, 74, 75, 76];
const initialObservation: LegacyFireObservation = {
  targetSlot: 201, targetStatus: 1, pendingOrder: false, facingAligned: true,
};

function sequence(sourceType: LegacyFireSourceType, scenario: string) {
  let state = createLegacyFireCycle(sourceType);
  const trace: { update: number; state: LegacyFireCycle; target: number | null }[] = [];
  for (let update = 0; update < 52; update += 1) {
    const observation = { ...initialObservation };
    if (update >= 5) {
      if (scenario === "pending-interruption") observation.pendingOrder = true;
      if (scenario === "target-gone") observation.targetStatus = 0;
      if (scenario === "retarget-field") observation.targetSlot = 202;
    }
    const result = stepLegacyFireCycle(state, observation);
    state = result.state;
    trace.push({ update, state, target: result.launch?.targetSlot ?? null });
  }
  return trace;
}

for (const sourceType of roster) {
  test(`native type ${sourceType}: continuous, interruption, retarget and target-gone golden prefixes`, () => {
    for (const scenario of ["continuous", "pending-interruption", "retarget-field", "target-gone"]) {
      const trace = sequence(sourceType, scenario);
      const handoff = scenario === "pending-interruption" || scenario === "target-gone";
      assert.deepEqual(trace.filter((entry) => entry.target !== null).map((entry) => entry.update),
        handoff ? [0] : [0, 17, 34, 51]);
      assert.deepEqual(trace[15].state, { sourceType, phase: "reload", remaining: 0 });
      assert.deepEqual(trace[16].state, { sourceType, phase: "ready" });
      if (handoff) {
        assert.deepEqual(trace[17].state, { sourceType, phase: "handoff",
          reason: scenario === "target-gone" ? "target-gone" : "pending-order" });
      } else {
        assert.equal(trace[17].target, scenario === "retarget-field" ? 202 : 201);
      }
    }
  });
}

test("native base weapons, immutable transitions, and alignment gate", () => {
  assert.deepEqual(roster.map((sourceType) =>
    stepLegacyFireCycle(createLegacyFireCycle(sourceType), initialObservation).launch?.weaponId),
  [1, 15, 5, 5, 5, 5, 62, 62, 62, 62]);
  const state = createLegacyFireCycle(0);
  assert.equal(stepLegacyFireCycle(state, { ...initialObservation, facingAligned: false }).state, state);
  const next = stepLegacyFireCycle(state, initialObservation);
  assert.equal(state.phase, "ready");
  assert.ok(Object.isFrozen(next.state));
  assert.ok(Object.isFrozen(next.launch));
  const result = stepLegacyFireCycle(state, { ...initialObservation, pendingOrder: true, targetStatus: 0 });
  assert.deepEqual(result.state, { sourceType: 0, phase: "handoff", reason: "pending-order" });
  assert.equal(stepLegacyFireCycle(result.state, initialObservation).state, result.state);
});

test("rejects unproved source types, target statuses and malformed state", () => {
  assert.throws(() => createLegacyFireCycle(5 as LegacyFireSourceType), RangeError);
  const state = createLegacyFireCycle(0);
  for (const targetSlot of [-1, 800, 1.5, NaN]) {
    assert.throws(() => stepLegacyFireCycle(state, { ...initialObservation, targetSlot }), RangeError);
  }
  assert.throws(() => stepLegacyFireCycle(state,
    { ...initialObservation, targetStatus: 10 as 1 }), RangeError);
  for (const remaining of [-1, 16, 0.5, NaN]) {
    assert.throws(() => stepLegacyFireCycle({ sourceType: 0, phase: "reload", remaining }, initialObservation), RangeError);
  }
});

const nativeTracePath = process.env.DC_FIRE_NATIVE_TRACE;
test("matches the executed native per-update countdown and handoff traces", { skip: !nativeTracePath }, () => {
  const report = JSON.parse(readFileSync(nativeTracePath!, "utf8"));
  assert.equal(report.executableSha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  assert.equal(report.sequences.length, 40);
  for (const native of report.sequences) {
    const actual = sequence(native.type, native.case);
    for (const entry of native.trace) {
      const reduced = actual[entry.update];
      assert.equal(reduced.target !== null, entry.shots === 1);
      if (entry.task === 11) {
        assert.equal(reduced.state.phase, "reload");
        assert.equal((reduced.state as { remaining: number }).remaining, entry.remaining);
      }
      if (reduced.target !== null) assert.equal(reduced.target, entry.target);
    }
    assert.deepEqual(actual.filter((entry) => entry.target !== null).map((entry) => entry.update), native.launchUpdates);
  }
});
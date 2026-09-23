import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  authenticateLegacyNativeSchedulerSource, planLegacyNativeSchedulerCycle,
  nextLegacyNativeRegisteredVisit, advanceLegacyNativeAiSchedule, selectLegacyNativePolicy,
  advanceLegacyNativeSchedulerPhase, requireLegacyNativeSchedulerCoverage,
  recordLegacyNativeSchedulerTiming, computeLegacyNativeSchedulerTimingFeedback, advanceLegacyNativeSchedulerFlags,
  beginLegacyNativeSchedulerClockPacket,
  legacyNativeSchedulerConsumerInputs,
  type LegacyNativeSchedulerTiming,
  type LegacyNativeSchedulerClock, type LegacyNativeSchedulerCoverage,
} from "../../src/engine/legacy-native-scheduler";

type Event = LegacyNativeSchedulerClock & {
  phase: string; address: number; rngCursor: number; crtSeed: number; task6Budget: number;
  aiNextTeam: number; highWater: number; teamModes: number[]; slot: number; type: number;
  registry: { index: number; slot: number; type: number }[]; team: number;
  registryChanges: { index: number; slot: number; type: number }[];
  eax: number; ecx: number;
  ringIndex: number; framePeriod: number; pathStamp: number; visibilityDirty: number; tick: number; value: number;
  timing: Omit<LegacyNativeSchedulerTiming, "ringIndex"> & { teamLatencies: number[]; requestedLatency: number; populationCeiling: number };
};
type Capture = { mission: string; completedUpdates: number; firstCapturedCounter?: number;
  runtimeCoreInterceptions: unknown[]; events: Event[] };
const root = new URL("../../", import.meta.url);
const executable = readFileSync(new URL("raw_cd/DC/DC.EXE", root));
const source = await authenticateLegacyNativeSchedulerSource(executable);
const captures: Capture[] = ["HUMAN", "ALIEN"].map((mission) => {
  const path = process.env[`DC_NATIVE_SCHEDULER_${mission}_TRACE`];
  return JSON.parse(path ? readFileSync(path, "utf8") : execFileSync("python3", ["-B",
    "tools/qa/native-scheduler-native.py", "--mission", mission, "--updates", "32"], {
    cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
  })) as Capture;
});
const clockOf = (event: Event): LegacyNativeSchedulerClock => ({ counter: event.counter,
  troCounter: event.troCounter, resourceClock: event.resourceClock, period: event.period,
  transition: event.transition, dayPhase: event.dayPhase, daylight: event.daylight });
function coverageFor(plan: ReturnType<typeof planLegacyNativeSchedulerCycle>): LegacyNativeSchedulerCoverage {
  return { consumers: Object.fromEntries(plan.phases.map((phase) => [phase.kind, `native:${phase.kind}`])),
    registeredTypes: Array.from({ length: 106 }, (_, index) => index), aiModes: [1, 2, 3, 4],
    synchronousReceipts: ["actor", "unit-production", "city-production"] };
}
const observed: Record<string, string> = {
  census: "world-enter", "population-flags": "census-done", "platform-flags": "population-flags-done",
  "visibility-clear": "visibility-clear", "visibility-compute": "visibility-compute",
  "visibility-dirty": "visibility-followup", clock: "clock-enter", "population-cap": "population-cap",
  relations: "relations-enter", daylight: "relations-done", "path-stamp": "world-maintenance",
  "trigger-prelude": "trigger-prelude-enter", "trigger-scan": "trigger-scan",
  "commander-cleanup": "commander-cleanup", income: "income-enter", "team-maintenance": "team-maintenance",
  "registered-actors": "actors-enter", projectiles: "projectiles", "frame-record": "frame-record",
  "frame-report": "frame-report", "ai-local-enter": "ai-local-enter", ai: "ai-scheduler",
  "ai-local-exit": "ai-local-exit", timing: "timing-enter", "timing-feedback": "timing-feedback",
};
for (const capture of captures) {
  test(`${capture.mission}: complete native world calls, every caller phase and independent clock`, () => {
    assert.ok(capture.completedUpdates >= 32);
    assert.deepEqual(capture.runtimeCoreInterceptions, []);
    const initial = capture.events[0];
    assert.notEqual(initial.resourceClock, initial.counter);
    for (let counter = capture.firstCapturedCounter ?? 1; counter <= capture.completedUpdates; counter++) {
      const events = capture.events.filter((event) => event.counter === counter);
      const plan = planLegacyNativeSchedulerCycle(source, clockOf(events[0]));
      assert.deepEqual(plan.after, clockOf(events.at(-1)!));
      const entries = events.filter((event) => Object.values(observed).includes(event.phase));
      assert.deepEqual(plan.phases.map((phase) => observed[phase.kind]), entries.map((event) => event.phase));
      plan.phases.forEach((phase, index) => assert.deepEqual(phase.clock, clockOf(entries[index]), phase.kind));
      assert.equal(plan.executableWholeGame, false);
      assert.equal(plan.admitted, false);
      assert.equal(plan.before.counter, plan.after.counter);
    }
  });
  test(`${capture.mission}: registry-order visits include CITY, resources and all original types`, () => {
    for (let counter = capture.firstCapturedCounter ?? 1; counter <= capture.completedUpdates; counter++) {
      const events = capture.events.filter((event) => event.counter === counter);
      const entry = events.find((event) => event.phase === "actors-enter")!;
      const plan = planLegacyNativeSchedulerCycle(source, clockOf(events[0]));
      const coverage = coverageFor(plan);
      const registry = Array<number>(800).fill(-1), types = Array<number>(800).fill(0);
      entry.registry.forEach((record) => { registry[record.index] = record.slot; types[record.slot] = record.type; });
      const visits = [];
      const returns = events.filter((event) => event.phase === "actor-return");
      let highWater = entry.highWater;
      for (let index = 0; index <= highWater; index++) {
        const visit = nextLegacyNativeRegisteredVisit(source, { index, highWater, registry, types }, coverage);
        if (visit.kind === "actor") {
          const returned = returns[visits.length];
          visits.push(visit);
          highWater = returned.highWater;
          (returned.registryChanges ?? []).forEach((record) => {
            registry[record.index] = record.slot;
            if (record.slot >= 0) types[record.slot] = record.type;
          });
        }
        else assert.equal(visit.kind, "empty-slot");
      }
      assert.deepEqual(visits.map(({ slot, type, task6Budget }) => ({ slot, type, task6Budget })),
        events.filter((event) => event.phase === "actor").map(({ slot, type, task6Budget }) => ({ slot, type, task6Budget })));
      assert.ok(visits.some((visit) => visit.citySourceSlot !== null));
      assert.ok(visits.some((visit) => visit.type === 40));
      assert.throws(() => nextLegacyNativeRegisteredVisit(source,
        { index: 0, highWater: entry.highWater, registry, types }, { ...coverage, registeredTypes: [0, 8] }), /Unsupported registered type/);
    }
  });
  test(`${capture.mission}: original AI sweep, rotation, weights, draw counts and selected actions`, () => {
    for (let counter = capture.firstCapturedCounter ?? 1; counter <= capture.completedUpdates; counter++) {
      const events = capture.events.filter((event) => event.counter === counter);
      const entry = events.find((event) => event.phase === "ai-scheduler")!;
      const plan = planLegacyNativeSchedulerCycle(source, clockOf(events[0]));
      const result = advanceLegacyNativeAiSchedule(source,
        { counter, nextTeam: entry.aiNextTeam, modes: entry.teamModes }, coverageFor(plan));
      assert.equal(result.nextTeam, events.at(-1)!.aiNextTeam);
      const actual = events.filter((event) => event.phase === "ai-selector");
      assert.deepEqual(result.selectors.map((visit) => visit.team), actual.map((event) => event.team));
      for (const [index, selector] of result.selectors.entries()) {
        const begin = events.indexOf(actual[index]);
        const end = index + 1 < actual.length ? events.indexOf(actual[index + 1]) : events.findIndex((event) => event.phase === "ai-local-exit");
        const selectionEvents = events.slice(begin, end);
        const weights = selectionEvents.filter((event) => event.phase === "policy-weight");
        const selection = selectLegacyNativePolicy(source,
          { mode: selector.mode, weights: weights.map((event) => event.eax), rngCursor: actual[index].rngCursor });
        assert.equal(selection.draws.length, weights.length);
        weights.forEach((weight, weightIndex) => assert.equal(weight.rngCursor,
          weightIndex === 0 ? actual[index].rngCursor : selection.draws[weightIndex - 1].cursor));
        const dispatch = selectionEvents.find((event) => event.phase === "policy-dispatch");
        if (dispatch) {
          assert.equal(selection.rngCursor, dispatch.rngCursor);
          assert.notEqual(selection.action, null);
          if (selector.mode === 3) assert.equal(selection.action, 0x44be40);
        } else {
          assert.equal(selection.action, null);
          assert.equal(selection.rngCursor, events[end].rngCursor);
        }
      }
    }
  });
  test(`${capture.mission}: explicit timing samples, frame flags and composed native phase receipts`, () => {
    for (let counter = capture.firstCapturedCounter ?? 1; counter <= capture.completedUpdates; counter++) {
      const events = capture.events.filter((event) => event.counter === counter);
      const plan = planLegacyNativeSchedulerCycle(source, clockOf(events[0]));
      const coverage = coverageFor(plan);
      const entries = events.filter((event) => Object.values(observed).includes(event.phase));
      let cursor = { nextPhase: 0, rngCursor: entries[0].rngCursor, crtSeed: entries[0].crtSeed };
      plan.phases.forEach((phase, index) => {
        const before = entries[index], after = entries[index + 1] ?? events.at(-1)!;
        cursor = advanceLegacyNativeSchedulerPhase(plan, cursor, { sequence: phase.sequence, kind: phase.kind,
          consumer: coverage.consumers[phase.kind]!, complete: true, rngBefore: before.rngCursor,
          rngAfter: after.rngCursor, crtBefore: before.crtSeed, crtAfter: after.crtSeed,
          clockBefore: clockOf(before), clockAfter: clockOf(after) }, coverage);
        if (phase.kind === "path-stamp" || phase.kind === "visibility-dirty") {
          const result = advanceLegacyNativeSchedulerFlags(source, { pathStamp: before.pathStamp,
            visibilityDirty: before.visibilityDirty, phase: phase.kind });
          assert.equal(result.pathStamp, after.pathStamp);
          assert.equal(result.visibilityDirty, after.visibilityDirty);
        }
      });
      assert.equal(cursor.rngCursor, events.at(-1)!.rngCursor);
      assert.equal(cursor.crtSeed, events.at(-1)!.crtSeed);
      const timing = events.find((event) => event.phase === "timing-enter")!;
      const endTick = events.find((event) => event.phase === "timing-clock-return")!.tick;
      const result = recordLegacyNativeSchedulerTiming(source, { ...timing.timing, ringIndex: timing.ringIndex },
        { startTick: timing.timing.timestamps[timing.ringIndex], endTick, framePeriod: timing.framePeriod });
      const exit = events.at(-1)!;
      assert.equal(result.ringIndex, exit.ringIndex);
      assert.deepEqual(result.durations, exit.timing.durations);
      assert.deepEqual(result.timestamps, exit.timing.timestamps);
      assert.deepEqual(result.periods, exit.timing.periods);
      const feedback = events.find((event) => event.phase === "timing-feedback");
      if (feedback) {
        const result = computeLegacyNativeSchedulerTimingFeedback(source,
          { ...feedback.timing, ringIndex: feedback.ringIndex },
          { tick: events.find((event) => event.phase === "feedback-clock-return")!.tick,
            teamLatencies: feedback.timing.teamLatencies, requestedLatency: feedback.timing.requestedLatency });
        assert.equal(result.period, events.find((event) => event.phase === "period-packet")!.value);
        assert.equal(result.latency, events.find((event) => event.phase === "latency-packet")!.value);
        assert.equal(result.populationCeiling, exit.timing.populationCeiling);
      }
    }
  });
}

test("source authentication and complete phase receipts fail closed without mutating inputs", async () => {
  const initial = captures[0].events[0];
  const plan = planLegacyNativeSchedulerCycle(source, clockOf(initial));
  const coverage = coverageFor(plan);
  assert.throws(() => planLegacyNativeSchedulerCycle({ ...source }, clockOf(initial)), /authenticated source/);
  const changed = Uint8Array.from(executable);
  changed[0] ^= 1;
  await assert.rejects(authenticateLegacyNativeSchedulerSource(changed), /Unrecognized scheduler executable/);
  for (const phase of plan.phases) {
    assert.throws(() => requireLegacyNativeSchedulerCoverage(plan,
      { ...coverage, consumers: { ...coverage.consumers, [phase.kind]: undefined } }), /Missing scheduler consumer/);
  }
  assert.throws(() => requireLegacyNativeSchedulerCoverage(plan,
    { ...coverage, synchronousReceipts: ["actor", "unit-production"] }), /city-production/);
  let cursor = { nextPhase: 0, rngCursor: initial.rngCursor, crtSeed: initial.crtSeed };
  for (const phase of plan.phases) {
    const receipt = { sequence: phase.sequence, kind: phase.kind, consumer: coverage.consumers[phase.kind]!,
      rngBefore: cursor.rngCursor, rngAfter: cursor.rngCursor, crtBefore: cursor.crtSeed, crtAfter: cursor.crtSeed, complete: true,
      clockBefore: phase.clock, clockAfter: plan.phases[phase.sequence + 1]?.clock ?? plan.after };
    const before = { ...cursor };
    for (const wrong of [{ ...receipt, sequence: receipt.sequence + 1 }, { ...receipt, complete: false },
      { ...receipt, rngBefore: (receipt.rngBefore + 1) & 255 }, { ...receipt, consumer: "unowned" },
      { ...receipt, clockAfter: { ...receipt.clockAfter, resourceClock: receipt.clockAfter.counter } }]) {
      assert.throws(() => advanceLegacyNativeSchedulerPhase(plan, cursor, wrong, coverage), /Incomplete, reordered, or stale/);
      assert.deepEqual(cursor, before);
    }
    cursor = advanceLegacyNativeSchedulerPhase(plan, cursor, receipt, coverage);
  }
  assert.equal(cursor.nextPhase, plan.phases.length);
});

test("original instruction controls: daylight rollover and nonzero timing workload", () => {
  const controls = JSON.parse(execFileSync("python3", ["-B", "tools/qa/native-scheduler-native.py", "--controls"], {
    cwd: root, encoding: "utf8", env: { ...process.env,
      PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
  })) as { clock: { before: LegacyNativeSchedulerClock; after: LegacyNativeSchedulerClock }[];
    timing: { timing: LegacyNativeSchedulerTiming; input: { tick: number; teamLatencies: number[]; requestedLatency: number };
      period: number; populationCeiling: number }[] };
  for (const capture of controls.clock) assert.deepEqual(planLegacyNativeSchedulerCycle(source, capture.before).after, capture.after);
  for (const capture of controls.timing) {
    const result = computeLegacyNativeSchedulerTimingFeedback(source, capture.timing, capture.input);
    assert.equal(result.period, capture.period);
    assert.equal(result.populationCeiling, capture.populationCeiling);
  }
});

test("packet clock, dynamic high-water, selector exclusions and tampered plans are explicit", () => {
  const clock = clockOf(captures[0].events[0]);
  const plan = beginLegacyNativeSchedulerClockPacket(source, { ...clock, counter: 0xffffffff });
  assert.equal(plan.before.counter, 0);
  assert.equal(plan.after.troCounter, clock.troCounter + 1);
  const coverage = coverageFor(plan);
  assert.throws(() => requireLegacyNativeSchedulerCoverage({ ...plan }, coverage), /authenticated phase plan/);
  assert.throws(() => selectLegacyNativePolicy(source, { mode: 1, weights: [], rngCursor: 0 }), /Unowned mode-1\/2/);
  assert.throws(() => selectLegacyNativePolicy(source, { mode: 3, weights: [0], rngCursor: 0 }), /original constant/);
  assert.throws(() => advanceLegacyNativeAiSchedule(source,
    { counter: 4, nextTeam: 0, modes: [0, 3, 4, 0, 0, 0, 0, 0] }, { ...coverage, aiModes: [4] }), /Unsupported AI mode/);
  const registry = Array<number>(800).fill(-1), types = Array<number>(800).fill(0);
  assert.equal(nextLegacyNativeRegisteredVisit(source, { index: 3, highWater: 2, registry, types }, coverage).kind, "complete");
  registry[3] = 3;
  assert.equal(nextLegacyNativeRegisteredVisit(source, { index: 3, highWater: 3, registry, types }, coverage).kind, "actor");
  const quiet = selectLegacyNativePolicy(source, { mode: 4, weights: [0], rngCursor: 255 });
  assert.equal(quiet.rngCursor, 0);
  assert.equal(quiet.action, null);
  assert.equal(quiet.draws.length, 1);
  const actors = plan.phases.find((phase) => phase.kind === "registered-actors")!;
  const inputs = legacyNativeSchedulerConsumerInputs(plan,
    { nextPhase: actors.sequence, rngCursor: 17, crtSeed: 21 },
    { localTeam: 0, cancellationGate: 0, visibilityMask: 0x40000000 });
  assert.equal(inputs.actorFrame!.counter, plan.after.resourceClock);
  assert.equal(inputs.resourceFrame!.nativePhaseCounter, plan.after.resourceClock);
  assert.equal(inputs.cityVisit!.counter, 0);
  assert.notEqual(inputs.actorFrame!.counter, inputs.cityVisit!.counter);
  assert.equal(inputs.rngCursor, 17);
});
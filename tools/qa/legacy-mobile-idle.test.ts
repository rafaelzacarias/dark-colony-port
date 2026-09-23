import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  legacyMobileIdleInspireDiagnostic, reduceLegacyMobileIdle, type LegacyMobileIdleState, type LegacyMobileIdleWorld,
} from "../../src/engine/legacy-mobile-idle";
import { LEGACY_INSPIRE_NATIVE_RANDOM_TABLE } from "../../src/engine/legacy-inspire";

interface NativeCase {
  typeId: number;
  enemy: boolean;
  pending: number | null;
  initialRandomIndex: number;
  uniformTable: number | null;
  runtimeIntercepts: string[];
  profile: Record<string, number>;
  world: Omit<LegacyMobileIdleWorld, "ground" | "air" | "auxiliary"> & {
    ground: [number, number][]; air: [number, number][]; auxiliary: [number, number][];
  };
  frames: { update: number; before: LegacyMobileIdleState; after: LegacyMobileIdleState;
    rng: { after: number; value: number; eip: string }[] }[];
  trace: { charge: number; direction: number; rngIndex: number; task: number }[];
  transitionFrames: { operation: "initialize" | "continue"; before: LegacyMobileIdleState; after: LegacyMobileIdleState }[];
}

const trace = JSON.parse(process.env.DC_MOBILE_IDLE_NATIVE_TRACE
  ? readFileSync(process.env.DC_MOBILE_IDLE_NATIVE_TRACE, "utf8")
  : execFileSync("python3", ["tools/research/mobile-idle-20260919.py", "--suite"], {
    cwd: new URL("../../", import.meta.url), encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONPATH: process.env.PYTHONPATH
      ?? "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
  })) as {
    startup: { imageIndex: number; zeroFilledStartupSeed: number; freshMenuVerified: boolean;
      resetSlices: { seed: number; startup: number; scenario: number }[] };
    turnIndex: number;
    cases: NativeCase[];
    fieldCases: NativeCase[];
    inspireBaseline: { runtimeIntercepts: string[]; idleWrites: { update: number; after: number; eip: string }[] };
  };

function worldFor(native: NativeCase): LegacyMobileIdleWorld {
  const expand = (entries: [number, number][]) => {
    const plane = Array<number>(native.world.width * native.world.height).fill(1023);
    for (const [cell, value] of entries) plane[cell] = value;
    return plane;
  };
  return { ...native.world, ground: expand(native.world.ground), air: expand(native.world.air),
    auxiliary: expand(native.world.auxiliary) };
}

test("source-backed idle/wait/turn states match original native dispatcher and every RNG value", () => {
  assert.equal(trace.cases.length, 32);
  assert.equal(trace.fieldCases.length, 8);
  let comparisons = 0;
  let turns = 0;
  let deploys = 0;
  for (const native of trace.cases) {
    assert.deepEqual(native.runtimeIntercepts, []);
    assert.equal(native.profile["0x8"], 10);
    assert.equal(native.profile["0xdc"], 0);
    assert.equal(native.profile["0xf8"], native.typeId >= 69 ? 1 : 0);
    assert.equal(native.trace[0].charge, 64);
    assert.equal(native.trace[0].rngIndex, native.initialRandomIndex);
    if (native.enemy) continue;
    const world = worldFor(native);
    for (const frame of native.frames) {
      const before = structuredClone(frame.before);
      const result = reduceLegacyMobileIdle(before, world, "dispatch");
      assert.deepEqual(before, frame.before, "input must remain untouched");
      if (before.stack.at(-1)?.task === 13) {
        assert.equal(result.supported, false, "deploy completion belongs to Inspire");
        continue;
      }
      assert.equal(result.supported, true, JSON.stringify({ typeId: native.typeId, update: frame.update, result }));
      if (!result.supported) continue;
      assert.deepEqual(result.state, frame.after, `type ${native.typeId}, update ${frame.update}, index ${native.initialRandomIndex}`);
      assert.deepEqual(result.randomAdvances.map(({ index, value }) => ({ index, value })),
        frame.rng.map(({ after, value }) => ({ index: after, value })));
      for (const draw of result.randomAdvances) assert.equal(draw.value, LEGACY_INSPIRE_NATIVE_RANDOM_TABLE[draw.index]);
      turns += result.transitions.filter((event) => event.kind === "push" && event.task === 4).length;
      deploys += Number(result.handoff === "deploy");
      comparisons++;
    }
  }
  assert.ok(comparisons > 700, String(comparisons));
  assert.ok(turns >= 4);
  assert.ok(deploys >= 6);
});

test("native visible nearby enemy acquires in the same update; idle owner rejects before any mutation", () => {
  for (const native of trace.cases.filter((entry) => entry.enemy)) {
    const frame = native.frames[0];
    assert.equal(frame.before.stack[0].words[0], 65535);
    assert.equal(frame.after.stack[0].words[0], 153);
    const before = structuredClone(frame.before);
    assert.deepEqual(reduceLegacyMobileIdle(before, worldFor(native), "dispatch"),
      { supported: false, diagnostic: "guard-combat-not-owned" });
    assert.deepEqual(before, frame.before);
  }
});

test("every non-idle activity and unsupported native task is transparent, including caster move/attack", () => {
  for (const typeId of [0, 8, 69, 73]) {
    const native = trace.cases.find((entry) => entry.typeId === typeId && !entry.enemy)!;
    const world = worldFor(native);
    for (const activity of ["move", "moving", "attack", "attacking", "harvest", "build", "dead", "deploy", "unknown", ""]) {
      const state = Object.freeze({ ...native.frames[0].before, activity });
      const serialized = JSON.stringify(state);
      assert.deepEqual(reduceLegacyMobileIdle(state, world, "dispatch"),
        { supported: false, diagnostic: `unsupported-activity:${activity}` });
      assert.equal(JSON.stringify(state), serialized);
    }
    for (let task = 0; task < 23; task++) {
      if (task === 1) continue;
      const state = { ...native.frames[0].before, stack: [{ task, words: [0] }] };
      assert.equal(reduceLegacyMobileIdle(state, world, "dispatch").supported, false);
    }
  }
});

test("owner gates require complete source occupancy, observers, direction and current RNG index", () => {
  const native = trace.cases[0];
  const state = native.frames[0].before;
  const world = worldFor(native);
  for (const patch of [{ observer: 0 }, { specialOrder: 1 }, { confusion: 1 }, { direction: 256 },
    { randomIndex: -1 }, { secondaryAnimationPending: 1 }, { secondaryAnimationsInactive: false },
    { pending: 1, order: 5 }, { typeId: 70 }, { status: 10 }]) {
    assert.equal(reduceLegacyMobileIdle({ ...state, ...patch }, world, "dispatch").supported, false);
  }
  for (const patch of [{ ground: [] }, { air: [] }, { auxiliary: [] }, { slots: {} },
    { selfDiplomacy: 0 }, { standDirections: [] }]) {
    assert.equal(reduceLegacyMobileIdle(state, { ...world, ...patch }, "dispatch").supported, false);
  }
});

test("idle initialization and continuation do not invent RNG or charge draws", () => {
  for (const native of trace.cases.filter((entry) => !entry.enemy)) {
    for (const frame of native.transitionFrames) {
      const result = reduceLegacyMobileIdle(frame.before, worldFor(native), frame.operation);
      assert.equal(result.supported, true);
      if (!result.supported) continue;
      assert.deepEqual(result.state, frame.after);
      assert.deepEqual(result.randomAdvances, []);
      assert.equal(result.state.charge, frame.before.charge);
      assert.equal(result.state.direction, frame.before.direction);
    }
  }
});

test("uniform native-table sensitivity separates charge and constructor direction from idle RNG fields", () => {
  for (const native of trace.fieldCases) {
    assert.deepEqual(native.runtimeIntercepts, []);
    assert.equal(native.trace[0].charge, 64);
    assert.equal(native.trace[0].rngIndex, 0);
    assert.equal(native.trace[1].charge, native.typeId >= 69 ? 65 : 64);
    const frame = native.frames[0];
    const turns = native.uniformTable === 0;
    assert.equal(frame.after.randomIndex, turns ? 2 : 1);
    assert.deepEqual(frame.rng.map((entry) => entry.value), Array(turns ? 2 : 1).fill(native.uniformTable));
    assert.equal(frame.after.direction, frame.before.direction, "turn is beneath the newly pushed wait");
    if (turns) assert.deepEqual(frame.after.stack[1], { task: 4, words: [0] });
  }
});

test("RNG index image zero is distinct from startup and scenario reset arguments", () => {
  assert.equal(trace.startup.imageIndex, 0);
  assert.equal(trace.startup.zeroFilledStartupSeed, 0);
  assert.equal(trace.startup.freshMenuVerified, false);
  for (const reset of trace.startup.resetSlices) {
    assert.equal(reset.startup, reset.seed & 255);
    assert.equal(reset.scenario, reset.seed & 255);
  }
});

test("reference Inspire fixture consumes three recipient draws on update 1 and two caster draws on update 3", () => {
  assert.deepEqual(trace.inspireBaseline.runtimeIntercepts, []);
  assert.equal(trace.inspireBaseline.idleWrites.filter((write) => write.update === 1).length, 3);
  assert.equal(trace.inspireBaseline.idleWrites.filter((write) => write.update === 2).length, 0);
  assert.equal(trace.inspireBaseline.idleWrites.filter((write) => write.update === 3).length, 2);
});

test("eager live Inspire admission rejects native turn deferral, charge failure and already-owned orders", () => {
  for (const typeId of [69, 73]) {
    const native = trace.cases.find((entry) => entry.typeId === typeId && !entry.enemy)!;
    const world = worldFor(native);
    const state = native.frames[0].before;
    assert.equal(legacyMobileIdleInspireDiagnostic(state, world), null);
    const waiting = { ...state, stack: [...state.stack, { task: 3, words: [15, state.hp] }] };
    assert.equal(legacyMobileIdleInspireDiagnostic(waiting, world), null);
    const turning = { ...state, stack: [...state.stack, { task: 4, words: [255] }, { task: 3, words: [15, state.hp] }] };
    assert.equal(legacyMobileIdleInspireDiagnostic(turning, world), "native-turn-defers-command");
    assert.equal(legacyMobileIdleInspireDiagnostic({ ...state, charge: 31 }, world), "insufficient-inspire-charge");
    assert.equal(legacyMobileIdleInspireDiagnostic({ ...state, pending: 1, order: 13 }, world), "pending-order-already-owned");
    assert.equal(legacyMobileIdleInspireDiagnostic({ ...state, activity: "attack" }, world), "unsupported-activity:attack");
    assert.equal(legacyMobileIdleInspireDiagnostic({ ...state, activity: "move" }, world), "unsupported-activity:move");
  }
});
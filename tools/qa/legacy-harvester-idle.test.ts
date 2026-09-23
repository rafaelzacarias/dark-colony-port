import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { reduceLegacyHarvesterIdle, type LegacyHarvesterIdleState, type LegacyHarvesterIdleWorld } from "../../src/engine/legacy-harvester-idle.ts";

interface NativeSnapshot {
  id: number; type: number; pendingOrder: number; order: number; task: number; taskWords: number[];
  hp: number; position: number[]; direction: number;
  stack: { task: number; words: number[] }[];
  animation: { bank: number; frame: number; delay: number; mode: number };
}
interface NativeCase {
  unitType: number; order: number; mobileFirst: boolean; verified: boolean; error: unknown;
  runtimeInterceptions: unknown[]; invalidMemory: unknown[]; rng: unknown[];
  activation: number; cancellation: number; release: number;
  initialRandomIndex: number;
  idleVariants: { name: string; before: LegacyHarvesterIdleState; after: LegacyHarvesterIdleState }[];
  handshake: { kind: string; update: number; state?: LegacyHarvesterIdleState }[];
  sourceFrames: { update: number; before: NativeSnapshot; after: NativeSnapshot;
    mobileBefore: LegacyHarvesterIdleState; mobileAfter: LegacyHarvesterIdleState }[];
  idleWorld: Omit<LegacyHarvesterIdleWorld, "groundWord" | "groundCell" | "animations">;
  animations: LegacyHarvesterIdleWorld["animations"];
  frames: { update: number; before: LegacyHarvesterIdleState; after: LegacyHarvesterIdleState }[];
  trace: { update: number; mobile: NativeSnapshot; source: NativeSnapshot; destinationGround: number; originGround: number }[];
}
const tracePath = process.env.DC_HARVESTER_HANDOFF_TRACE;
const native: { executableSha256: string; cases: NativeCase[] } = JSON.parse(tracePath
  ? readFileSync(tracePath, "utf8")
  : execFileSync("python3", [fileURLToPath(new URL("../research/harvester-handoff-20260919.py", import.meta.url)), "--suite"], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
  }));

function worldFor(current: NativeCase, state: LegacyHarvesterIdleState): LegacyHarvesterIdleWorld {
  return { ...current.idleWorld, animations: current.animations, groundWord: 0x40000000 | state.slot,
    groundCell: (state.yQ8 >> 8) * current.idleWorld.width + (state.xQ8 >> 8) };
}

test("original player movement reaches VENT, swaps and releases in both slot orders and modes", () => {
  assert.equal(native.executableSha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  assert.equal(native.cases.length, 8);
  for (const current of native.cases) {
    assert.equal(current.verified, true);
    assert.equal(current.error, null);
    assert.deepEqual(current.runtimeInterceptions, []);
    assert.deepEqual(current.invalidMemory, []);
    assert.deepEqual(current.rng, []);
    const human = current.unitType === 6;
    const first = current.trace[0].mobile;
    assert.equal(first.direction, human ? 160 : 128);
    assert.deepEqual(first.taskWords.slice(0, 3), [65535, 0, 0]);
    assert.equal(current.trace[1].mobile.pendingOrder, 1);
    assert.equal(current.trace[1].mobile.order, current.order);
    const arrived = current.trace.find((frame) => frame.update > 0 && frame.mobile.type === current.unitType
      && frame.mobile.stack.every((task) => task.task === 1 || task.task === 3))!;
    assert.equal(arrived.update, human ? 25 : 28);
    assert.deepEqual(arrived.mobile.position, [17760, 12416]);
    assert.equal(arrived.mobile.direction, 0);
    assert.equal(arrived.destinationGround & 1023, first.id);
    assert.equal(arrived.originGround & 1023, 1023);
    assert.equal(arrived.mobile.pendingOrder, 0);
    assert.equal(arrived.mobile.order, 255);
    assert.equal(current.activation, (human ? 67 : 70) - Number(current.mobileFirst));
    const activated = current.trace.find((frame) => frame.update === current.activation)!;
    assert.equal(activated.mobile.type, human ? 47 : 48);
    assert.equal(activated.mobile.task, 12);
    assert.deepEqual(activated.mobile.taskWords.slice(0, 3), [activated.source.id, 1, 0]);
    assert.equal(current.release - current.cancellation, human ? 3 : 7);
    assert.deepEqual(current.handshake.map((event) => event.kind),
      ["native-movement-completed", "native-resource-activated", "native-resource-released"]);
    assert.equal(current.handshake[0].update, arrived.update);
    const sourceVisit = current.sourceFrames.find((frame) => frame.update === current.activation)!;
    assert.equal(sourceVisit.before.taskWords[0], 1);
    assert.equal(sourceVisit.after.taskWords[0], 50);
    assert.equal(sourceVisit.mobileBefore.typeId, current.unitType);
    assert.equal(sourceVisit.mobileAfter.typeId, human ? 47 : 48);
    assert.deepEqual(sourceVisit.mobileAfter.stack.slice(0, -1), sourceVisit.mobileBefore.stack);
    assert.deepEqual(sourceVisit.mobileAfter.stack.at(-1), { task: 12, words: [activated.source.id, 1, 0] });
    assert.equal(sourceVisit.mobileAfter.animation.frame, 0);
    assert.equal(sourceVisit.mobileAfter.animation.delay, 0);
    assert.equal(sourceVisit.mobileAfter.animation.mode, 1);
    const mobileVisit = current.frames.find((frame) => frame.update === current.activation)!;
    assert.equal(mobileVisit.before.typeId, current.mobileFirst ? current.unitType : human ? 47 : 48);
    assert.equal(current.trace.find((frame) => frame.update === current.cancellation)!.mobile.task, 13);
    const released = current.frames.find((frame) => frame.update === current.release)!;
    assert.equal(released.before.typeId, human ? 47 : 48);
    assert.deepEqual(released.before.stack, [{ task: 13, words: [50] }]);
    assert.equal(released.before.animation.mode, 2);
    assert.equal(released.after.typeId, current.unitType);
    assert.deepEqual(released.after.stack, [{ task: 1, words: [65535, 800, 0] }]);
    assert.deepEqual(released.after.animation, { bank: current.idleWorld.standBank, frame: 0, delay: 0, mode: 0 });
    assert.equal(released.after.direction, 0);
    assert.equal(released.after.randomIndex, current.initialRandomIndex);
  }
});

test("bounded nonweapon idle/wait reducer matches every admitted native dispatch frame", () => {
  let compared = 0;
  for (const current of native.cases) {
    for (const frame of current.frames) {
      if (frame.before.typeId !== current.unitType || frame.before.pending !== 0
        || !frame.before.stack.every((task) => task.task === 1 || task.task === 3)) continue;
      const before = structuredClone(frame.before);
      const result = reduceLegacyHarvesterIdle(frame.before, worldFor(current, frame.before));
      assert.equal(result.supported, true);
      assert.deepEqual(result.state, frame.after, `type ${current.unitType}, order ${current.order}, update ${frame.update}`);
      assert.deepEqual(result.randomAdvances, []);
      assert.deepEqual(frame.before, before);
      compared++;
    }
  }
  assert.ok(compared >= 400, `only ${compared} native comparisons`);
});

test("unowned pending, movement, retraction, weapon and auxiliary branches fail before mutation", () => {
  const current = native.cases[0];
  const state = current.frames.find((frame) => frame.update === current.release + 1)!.before;
  const world = worldFor(current, state);
  for (const patch of [{ pending: 1 }, { typeId: 47 }, { observer: 0 }, { specialOrder: 1 }, { confusion: 1 },
    { secondaryAnimationPending: 1 }, { secondaryAnimationsInactive: false }, { stack: [{ task: 6, words: [] }] },
    { stack: [{ task: 13, words: [50] }] }, { direction: 256 }]) {
    const input = { ...state, ...patch };
    const before = structuredClone(input);
    assert.equal(reduceLegacyHarvesterIdle(input, world).supported, false);
    assert.deepEqual(input, before);
  }
  for (const patch of [{ selectedWeapon: 0 }, { groundWord: 1023 }, { groundCell: -1 }, { animations: {} }]) {
    assert.equal(reduceLegacyHarvesterIdle(state, { ...world, ...patch }).supported, false);
  }
});

test("original idle preserves its special FIN bank, resets other banks and handles wait wakeup", () => {
  for (const current of native.cases) {
    assert.equal(current.idleVariants.length, 6);
    for (const variant of current.idleVariants) {
      const result = reduceLegacyHarvesterIdle(variant.before, worldFor(current, variant.before));
      assert.equal(result.supported, true, variant.name);
      assert.deepEqual(result.state, variant.after, variant.name);
      assert.deepEqual(result.randomAdvances, []);
    }
  }
});
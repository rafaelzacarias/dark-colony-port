import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { reduceLegacyAiRegisteredVisit, stageLegacyAiTaskPendingVisit, type LegacyAiRegisteredWorld, type LegacyAiGroundWrite } from "../../src/engine/legacy-ai-task";

interface Snapshot { raw: number[]; rngCursor: number; task6Budget: number; stack: { task: number; words: number[] }[] }
interface Evidence {
  unitType: number; slot: number; order: number; counter: number; before: number[]; received: number[];
  world: LegacyAiRegisteredWorld; fin: LegacyAiRegisteredWorld["fin"]; runtimeIntercepts: unknown[];
  stopReceipt: null | { visit: number; stream: string; before: number[]; after: number[]; slot: number };
  nearbyEnemy: null | { enemySlot: number; enemyRaw: number[] };
  visits: (Snapshot & { before: Snapshot; groundWrites: LegacyAiGroundWrite[]; randomWrites: number[]; entries: string[] })[];
}
const trace = process.env.DC_NATIVE_ACTOR_MOVEMENT_TRACE;
const evidence: Evidence[] = (trace ? readFileSync(trace, "utf8") : execFileSync("python3", [
  fileURLToPath(new URL("nativeactor-task-native.py", import.meta.url)), "--movement-suite",
], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
})).trim().split("\n").map(line => JSON.parse(line));

for (const [index, current] of evidence.entries()) {
  test(`registered movement ${index}: type=${current.unitType} base=${current.order} stop=${current.stopReceipt?.visit ?? "none"} enemy=${!!current.nearbyEnemy}`, () => {
    assert.deepEqual(current.runtimeIntercepts, []);
    assert.equal(current.before[6], current.unitType);
    assert.equal(Buffer.from(current.before).readInt32LE(12), Buffer.from(current.world.typeBytes).readInt32LE(0x44));
    let raw = current.received, ground = current.world.ground;
    let rngCursor = current.visits[0].before.rngCursor, task6Budget = current.visits[0].before.task6Budget;
    for (const [visitIndex, visit] of current.visits.entries()) {
      if (current.stopReceipt?.visit === visitIndex) {
        assert.deepEqual(raw, current.stopReceipt.before);
        assert.equal(current.stopReceipt.slot, current.slot);
        const packet = Buffer.from(current.stopReceipt.stream, "hex");
        assert.equal(packet[0], 5); assert.equal(packet.readInt16LE(1), current.slot); assert.equal(packet[3], 13);
        raw = [...raw]; raw[0x36] = 1; raw[0x37] = 13;
        assert.deepEqual(raw, current.stopReceipt.after);
      }
      assert.deepEqual(raw, visit.before.raw, `visit ${visitIndex} input`);
      const frame = { slot: current.slot, raw, world: { ...current.world, fin: current.fin, ground }, counter: current.counter, rngCursor, task6Budget };
      const result = reduceLegacyAiRegisteredVisit(frame);
      if (current.nearbyEnemy && current.order === 7) {
        assert.ok(visit.entries.includes("0x435c14"), "native Attack executes weapon acquisition");
        assert.ok(visit.entries.includes("0x41481c"), "native Attack acquires the constructed nearby enemy");
        assert.deepEqual(result, { supported: false, diagnostic: "native-attack-acquisition-owner-required" });
        assert.equal(raw[0x36], 1, "rejection does not publish the staged initializer");
        assert.deepEqual(raw, current.received);
        assert.deepEqual(ground, current.world.ground);
        return;
      }
      if (current.stopReceipt && [69, 73].includes(current.unitType) && visit.stack[0].task === 13) {
        assert.deepEqual(result, { supported: false, diagnostic: "native-special-stop-owner-required" });
        assert.equal(raw[0x36], 1, "unowned special Stop remains pending");
        return;
      }
      assert.ok(result.supported, `visit ${visitIndex}: ${JSON.stringify(result)}`);
      assert.equal(result.registeredVisitComplete, true);
      assert.deepEqual(result.raw, visit.raw, `visit ${visitIndex} raw220`);
      assert.deepEqual(result.groundWrites, visit.groundWrites, `visit ${visitIndex} ordered ground`);
      assert.deepEqual(result.randomAdvances, visit.randomWrites, `visit ${visitIndex} RNG writes`);
      assert.equal(result.rngCursor, visit.rngCursor); assert.equal(result.task6Budget, visit.task6Budget);
      assert.equal(result.pendingHandoff.pendingNativeTask, visit.raw[0x36] !== 0);
      assert.deepEqual(result.pendingHandoff.expectedRaw, frame.raw);
      assert.equal(result.pendingHandoff.team, current.received[7]);
      if (raw[0x36]) {
        const handoff = stageLegacyAiTaskPendingVisit(frame, { slot: current.slot, team: raw[7], expectedRaw: raw, pendingNativeTask: true });
        assert.deepEqual(handoff, result);
      }
      const nativeGround = [...ground];
      for (const write of visit.groundWrites) {
        nativeGround[write.cell] = write.size === 4 ? write.after : ((nativeGround[write.cell] & 0xffff0000) | write.after) >>> 0;
      }
      assert.deepEqual(result.ground, nativeGround);
      raw = result.raw as number[]; ground = result.ground; rngCursor = result.rngCursor; task6Budget = result.task6Budget;
    }
    if (!current.nearbyEnemy) assert.equal(current.visits.at(-1)!.stack[0].task, 1, "native completion reaches idle");
    else assert.ok(current.visits.every(visit => !visit.entries.includes("0x435c14")), "native Move does not run Attack acquisition");
  });
}

test("full visits reject unsupported guard work without mutating inputs", () => {
  const current = evidence[0], before = current.visits[0].before;
  const base = { slot: current.slot, raw: current.received, world: { ...current.world, fin: current.fin },
    counter: current.counter, rngCursor: before.rngCursor, task6Budget: before.task6Budget };
  const mutations = [
    { ...base, raw: base.raw.map((value, offset) => offset === 0xc7 ? 1 : value) },
    { ...base, raw: base.raw.map((value, offset) => offset === 0xd0 ? 1 : value) },
    { ...base, task6Budget: 10 },
    { ...base, slot: current.slot + 1 },
    { ...base, world: { ...base.world, air: [] } },
  ];
  for (const frame of mutations) {
    const saved = structuredClone(frame);
    assert.equal(reduceLegacyAiRegisteredVisit(frame).supported, false);
    assert.deepEqual(frame, saved);
  }
  assert.deepEqual(stageLegacyAiTaskPendingVisit(base, { slot: base.slot + 1, team: base.raw[7], expectedRaw: base.raw, pendingNativeTask: true }),
    { supported: false, diagnostic: "native-pending-entity-owner-mismatch" });
});
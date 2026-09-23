import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acquireLegacySourceCombatTarget, type LegacySourceCombatTables } from "../../src/engine/legacy-source-combat-acquisition";
import { stageLegacyAiTaskPendingVisit, type LegacyAiRegisteredWorld } from "../../src/engine/legacy-ai-task";

interface Snapshot { raw: number[]; rngCursor: number; task6Budget: number }
interface Evidence {
  slot: number; counter: number; received: number[];
  world: LegacyAiRegisteredWorld & { combat: LegacySourceCombatTables };
  fin: LegacyAiRegisteredWorld["fin"];
  acquisitionCase: { team: number; type: number; aligned?: boolean; damagedIdle?: boolean; aggroControl?: boolean;
    revealMask?: number; priority?: boolean; diagonalRange?: boolean };
  nearbyEnemy: { enemySlot: number };
  acquisitionCalls: (Snapshot & { entry: string; ebx: number })[];
  scans: { raw: number[]; radius: number; target: number; rngCursor: number; rngAfter: number;
    candidates: { slot: number; plane: string; cell: number; raw?: number[] }[];
    actorsAfter?: Record<number, number[]> }[];
  visits: (Snapshot & { before: Snapshot; randomWrites: number[]; groundWrites: unknown[] })[];
}
const trace = process.env.DC_SOURCE_COMBAT_TRACE;
const evidence: Evidence[] = (trace ? readFileSync(trace, "utf8") : execFileSync("python3", [
  fileURLToPath(new URL("nativeactor-task-native.py", import.meta.url)), "--acquisition-suite",
], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
})).trim().split("\n").map(line => JSON.parse(line));

for (const [index, current] of evidence.entries()) {
  test(`source acquisition ${index}: team=${current.acquisitionCase.team} type=${current.acquisitionCase.type}`, () => {
    const visit = current.visits[0];
    for (const scan of current.scans) {
      const result = acquireLegacySourceCombatTarget(current.slot, scan.raw, { ...current.world, ...current.world.combat }, scan.radius);
      assert.ok(result.supported, JSON.stringify(result));
      assert.equal(result.target, scan.target | 0);
      assert.deepEqual(result.candidates.map(({ slot, plane, cell }) => ({ slot, plane, cell })),
        scan.candidates.map(({ slot, plane, cell }) => ({ slot, plane, cell })));
      for (const candidate of scan.candidates) {
        if (scan.actorsAfter) assert.deepEqual(scan.actorsAfter[candidate.slot], candidate.raw, "native scan preserves full candidate raw220");
      }
      assert.equal(scan.rngCursor, scan.rngAfter);
    }
    const acquisition = acquireLegacySourceCombatTarget(current.slot, current.received, { ...current.world, ...current.world.combat });
    assert.ok(acquisition.supported, JSON.stringify(acquisition));
    const fire = current.acquisitionCalls.find(call => call.entry === "0x41481c");
    const chase = current.acquisitionCalls.find(call => call.entry === "0x414ce4" && call.ebx === 2);
    if (current.acquisitionCase.aligned) {
      assert.ok(current.acquisitionCalls.some(call => call.entry === "0x412e13"));
      assert.ok(visit.randomWrites.length > 0, "native launch RNG occurs after the owned prefix");
    }
    if (current.acquisitionCase.damagedIdle) assert.ok(chase, "HP loss must positively exercise pursuit");
    if (current.acquisitionCase.aggroControl) {
      assert.equal(current.scans.at(-2)!.target | 0, -1);
      assert.equal(current.scans.at(-1)!.target, current.nearbyEnemy.enemySlot);
    }
    if (current.acquisitionCase.priority) {
      assert.ok(acquisition.target >= 0);
      assert.notEqual(acquisition.target, current.nearbyEnemy.enemySlot, "priority beats the nearer first candidate");
    }
    if (current.acquisitionCase.diagonalRange) {
      assert.equal(current.scans[0].radius, 4);
      assert.equal(acquisition.target, current.nearbyEnemy.enemySlot, "(3,3) is in native ring4, outside Manhattan/Euclidean range4");
    }
    if (current.acquisitionCase.revealMask !== undefined) {
      assert.equal(acquisition.target, current.acquisitionCase.revealMask & (1 << current.received[7]) ? current.nearbyEnemy.enemySlot : -1);
    }
    assert.equal(acquisition.target, fire?.ebx ?? -1);
    assert.deepEqual(acquisition.randomAdvances, []);
    assert.deepEqual(acquisition.targetWrites, []);
    const frame = { slot: current.slot, raw: current.received, counter: current.counter,
      world: { ...current.world, fin: current.fin }, rngCursor: visit.before.rngCursor, task6Budget: visit.before.task6Budget };
    const before = structuredClone(frame);
    const result = stageLegacyAiTaskPendingVisit(frame, { slot: current.slot, team: current.received[7],
      expectedRaw: current.received, pendingNativeTask: current.received[0x36] !== 0 });
    assert.deepEqual(frame, before);
    if (fire) {
      assert.equal(result.supported, false);
      if (result.supported) return;
      assert.ok(result.combatHandoff);
      assert.equal(result.combatHandoff.registeredVisitComplete, false);
      assert.equal(result.combatHandoff.target, fire.ebx);
      assert.deepEqual(result.combatHandoff.entryRaw, fire.raw, "raw220 at original fire entry");
      const prefix = current.acquisitionCalls.find(call => call.entry === "0x412e13");
      assert.deepEqual(result.combatHandoff.raw, prefix?.raw ?? visit.raw, "raw220 after target flags and turn");
      assert.equal(result.combatHandoff.boundary, prefix ? 0x412e13 : 0x4131ae);
      assert.equal(result.combatHandoff.rngCursor, fire.rngCursor);
      assert.equal(result.combatHandoff.task6Budget, fire.task6Budget);
      assert.deepEqual(result.combatHandoff.randomAdvances, []);
      assert.deepEqual(result.combatHandoff.groundWrites, []);
    } else if (chase) {
      assert.equal(result.supported, false);
      if (result.supported) return;
      assert.ok(result.combatHandoff);
      assert.equal(result.combatHandoff.boundary, 0x414ce4);
      assert.equal(result.combatHandoff.nextOwner, "native-acquisition-path-owner");
      assert.deepEqual(result.combatHandoff.raw, chase.raw, "full idle-pursuit prefix");
      assert.equal(result.combatHandoff.rngCursor, chase.rngCursor);
      assert.deepEqual(result.combatHandoff.randomAdvances, []);
    } else {
      assert.ok(result.supported, JSON.stringify(result));
      assert.deepEqual(result.raw, visit.raw, "raw220 complete nonhostile visit");
      assert.deepEqual(result.groundWrites, visit.groundWrites);
      assert.deepEqual(result.randomAdvances, visit.randomWrites);
      assert.equal(result.rngCursor, visit.rngCursor);
    }
  });
}

test("source acquisition rejects incomplete candidate, scan and type inputs without mutation", () => {
  const current = evidence[0];
  const world = { ...current.world, ...current.world.combat };
  for (const overrides of [{ actors: {} }, { scanOffsets: [] }, { typeTable: [] }, { relations: [] }, { damageTable: [] }]) {
    const candidate = { ...world, ...overrides };
    const saved = structuredClone(candidate);
    assert.equal(acquireLegacySourceCombatTarget(current.slot, current.received, candidate).supported, false);
    assert.deepEqual(candidate, saved);
  }
  const typeTable = [...world.typeTable];
  typeTable[current.received[6] * 280 + 0x64] ^= 1;
  const frame = { slot: current.slot, raw: current.received, counter: current.counter,
    world: { ...current.world, combat: { ...current.world.combat, typeTable }, fin: current.fin },
    rngCursor: current.visits[0].before.rngCursor, task6Budget: current.visits[0].before.task6Budget };
  assert.deepEqual(stageLegacyAiTaskPendingVisit(frame, { slot: current.slot, team: current.received[7],
    expectedRaw: current.received, pendingNativeTask: current.received[0x36] !== 0 }),
  { supported: false, diagnostic: "source-combat-type-record-mismatch" });
});
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { reduceLegacyAiRegisteredVisit, type LegacyAiRegisteredWorld } from "../../src/engine/legacy-ai-task";
import { launchLegacyNativeFire, validLegacyNativeProjectileState, type LegacyNativeProjectileState } from "../../src/engine/legacy-native-fire";

interface Pool { records: string; highWater: number; heads: [number, number]; statistics: number[] }
interface Snapshot { raw: number[]; rngCursor: number; task6Budget: number; counter: number; projectiles: Pool }
interface Evidence {
  unitType: number; faction: string; slot: number; counter: number; received: number[];
  world: LegacyAiRegisteredWorld; fin: LegacyAiRegisteredWorld["fin"];
  stopReceipt: { visit: number; after: number[] } | null;
  visits: (Snapshot & { before: Snapshot; randomWrites: number[]; groundWrites: unknown[] })[];
  scans: { target: number; candidates: { slot: number; raw: number[] }[]; actorsAfter: Record<number, number[]> }[];
  fireOptions?: { scenarioWeaponLevel?: number; sourceSlot?: number; poisonPool?: boolean; reusePool?: boolean };
  launches: { arguments: number[] }[];
}
const trace = process.env.DC_NATIVE_FIRE_TRACE;
const evidence: Evidence[] = (trace ? readFileSync(trace, "utf8") : execFileSync("python3", [
  fileURLToPath(new URL("native-fire-native.py", import.meta.url)), "--suite",
], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
  env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
})).trim().split("\n").map(line => JSON.parse(line));
const pool = (value: Pool): LegacyNativeProjectileState => ({ ...value, records: [...Buffer.from(value.records, "base64")] });

test("poisoned native reuse fixtures preserve every byte except the complete 0 -> 2 -> 1 links", () => {
  const reused = evidence.filter(current => current.fireOptions?.poisonPool && current.fireOptions.reusePool);
  assert.equal(reused.length, 8);
  const expected = Buffer.alloc(2024 * 40, 0xa5);
  expected.writeInt16LE(2, 20);
  expected.writeInt16LE(-1, 60);
  expected.writeInt16LE(1, 100);
  for (const current of reused) {
    const initial = pool(current.visits[0].before.projectiles);
    assert.equal(initial.highWater, 3);
    assert.deepEqual(initial.heads, [0, -1]);
    assert.deepEqual(Buffer.from(initial.records), expected);
    assert.equal(validLegacyNativeProjectileState(initial), true);
    for (const visit of current.visits) assert.equal(validLegacyNativeProjectileState(pool(visit.projectiles)), true);
  }
});

test("TypeScript rejects the old orphaned reuse input before registered dispatch", () => {
  const current = evidence.find(entry => entry.fireOptions?.reusePool)!;
  const first = current.visits[0].before;
  const records = Buffer.from(first.projectiles.records, "base64");
  records.writeInt16LE(-1, 100);
  records.writeUInt16LE(0xa5a5, 60);
  const projectiles = { ...pool(first.projectiles), records: [...records] };
  const input = { slot: current.slot, raw: current.received, world: { ...current.world, fin: current.fin },
    counter: first.counter, rngCursor: first.rngCursor, task6Budget: first.task6Budget, projectiles };
  const saved = structuredClone(input);
  assert.equal(validLegacyNativeProjectileState(projectiles), false);
  assert.deepEqual(reduceLegacyAiRegisteredVisit(input), { supported: false, diagnostic: "invalid-native-projectile-pool" });
  assert.deepEqual(input, saved);
});

for (const [index, current] of evidence.entries()) {
  test(`native projectile full visits ${index}: ${current.faction} type${current.unitType}`, () => {
    let raw = current.received, projectiles = pool(current.visits[0].before.projectiles);
    let rngCursor = current.visits[0].before.rngCursor, task6Budget = current.visits[0].before.task6Budget;
    let world = { ...current.world, fin: current.fin };
    let launches = 0;
    const shotVisits: number[] = [];
    for (const [visitIndex, visit] of current.visits.entries()) {
      if (current.stopReceipt?.visit === visitIndex) raw = current.stopReceipt.after;
      task6Budget = visit.before.task6Budget;
      const frame = { slot: current.slot, raw, world, counter: visit.before.counter, rngCursor, task6Budget, projectiles };
      const saved = structuredClone(frame);
      const result = reduceLegacyAiRegisteredVisit(frame);
      assert.deepEqual(frame, saved, "pure frame and shared RNG inputs");
      if (current.stopReceipt && [69, 73].includes(current.unitType) && visitIndex === 17) {
        assert.deepEqual(result, { supported: false, diagnostic: "native-special-stop-owner-required" });
        assert.equal(raw[0x36], 1);
        break;
      }
      assert.ok(result.supported, `visit${visitIndex}: ${JSON.stringify(result)}`);
      assert.deepEqual(result.raw, visit.raw, `raw220 visit${visitIndex}`);
      assert.deepEqual(result.projectiles, pool(visit.projectiles), `all projectile bytes visit${visitIndex}`);
      assert.deepEqual(result.randomAdvances, visit.randomWrites);
      assert.deepEqual(result.groundWrites, visit.groundWrites);
      assert.equal(result.rngCursor, visit.rngCursor);
      assert.equal(result.task6Budget, visit.task6Budget);
      assert.equal(result.pendingHandoff.pendingNativeTask, Boolean(visit.raw[0x36]));
      launches += result.spawns.length;
      if (result.spawns.length) {
        shotVisits.push(visitIndex);
        assert.equal(result.combatGate.readyAttackVisit, true);
        assert.equal(result.combatGate.readyEndToEndCombat, false);
        for (const spawn of result.spawns) {
          assert.deepEqual(spawn.raw, result.projectiles!.records.slice(spawn.slot * 40, (spawn.slot + 1) * 40));
          assert.equal(spawn.weapon, current.launches[shotVisits.length - 1].arguments[1]);
        }
      }
      raw = [...result.raw]; projectiles = result.projectiles!;
      rngCursor = result.rngCursor; task6Budget = result.task6Budget;
      world = { ...world, ground: result.ground };
    }
    assert.ok(launches > 0);
    assert.ok(current.scans.some(scan => (scan.target | 0) >= 0 && scan.candidates.length > 0));
    for (let shot = 1; shot < shotVisits.length; shot++) assert.equal(shotVisits[shot] - shotVisits[shot - 1], 17);
    for (const scan of current.scans) for (const candidate of scan.candidates)
      assert.deepEqual(scan.actorsAfter[candidate.slot], candidate.raw, "no instant damage or target mutation");
    if (current.fireOptions?.scenarioWeaponLevel !== undefined) {
      assert.equal(current.world.typeBytes[48 + current.received[7]], current.fireOptions.scenarioWeaponLevel);
      assert.equal(current.launches[0].arguments[1], (current.unitType === 0 ? 1 : 15) + current.fireOptions.scenarioWeaponLevel);
    }
    if (current.fireOptions?.sourceSlot !== undefined) {
      assert.equal(current.slot, current.fireOptions.sourceSlot);
      assert.equal(current.received[7], 0);
    }
  });
}

test("missing owner and malformed pools cannot publish a partial attack or advance caller RNG", () => {
  const current = evidence[0], first = current.visits[0].before;
  const frame = { slot: current.slot, raw: current.received, world: { ...current.world, fin: current.fin },
    counter: first.counter, rngCursor: first.rngCursor, task6Budget: first.task6Budget };
  const missing = reduceLegacyAiRegisteredVisit(frame);
  assert.equal(missing.supported, false);
  if (!missing.supported) {
    assert.ok(missing.combatHandoff);
    assert.deepEqual(missing.combatHandoff.randomAdvances, []);
    assert.equal(missing.combatHandoff.registeredVisitComplete, false);
  }
  const initial = pool(first.projectiles);
  const malformed: LegacyNativeProjectileState[] = [
    { ...initial, records: [] }, { ...initial, statistics: [] },
    { ...initial, heads: [initial.highWater, -1] }, { ...initial, highWater: 2024 },
  ];
  const cyclic = [...initial.records];
  cyclic[20] = 0; cyclic[21] = 0;
  malformed.push({ ...initial, records: cyclic, highWater: Math.max(1, initial.highWater), heads: [0, -1] });
  for (const projectiles of malformed) {
    const input = { ...frame, projectiles }, saved = structuredClone(input);
    assert.deepEqual(reduceLegacyAiRegisteredVisit(input), { supported: false, diagnostic: "invalid-native-projectile-pool" });
    assert.deepEqual(input, saved);
  }
});

test("unverified spread, weapon and muzzle profiles stay closed before caller mutation", () => {
  const current = evidence[0], first = current.visits[0].before;
  const staged = reduceLegacyAiRegisteredVisit({ slot: current.slot, raw: current.received,
    world: { ...current.world, fin: current.fin }, counter: first.counter,
    rngCursor: first.rngCursor, task6Budget: first.task6Budget });
  assert.ok(!staged.supported && staged.combatHandoff?.boundary === 0x412e13);
  const handoff = staged.combatHandoff;
  const input = { slot: current.slot, raw: handoff.raw, target: handoff.targetRaw, typeBytes: current.world.typeBytes,
    weapons: current.world.weapons, tables: current.world.nativeFire!, projectiles: pool(first.projectiles),
    rngCursor: first.rngCursor, randomTable: current.world.randomTable };
  const weapons = Uint8Array.from(input.weapons);
  new DataView(weapons.buffer).setInt32(72 + 28, 1, true);
  const spread = { ...input, weapons: [...weapons] }, saved = structuredClone(spread);
  assert.deepEqual(launchLegacyNativeFire(spread), { supported: false, diagnostic: "unverified-native-fire-spread-profile" });
  assert.deepEqual(spread, saved);
  const typeBytes = Uint8Array.from(input.typeBytes);
  new DataView(typeBytes.buffer).setInt32(24, 10, true);
  assert.deepEqual(launchLegacyNativeFire({ ...input, typeBytes: [...typeBytes] }),
    { supported: false, diagnostic: "unverified-native-fire-weapon" });
  const typeTable = [...current.world.combat!.typeTable];
  typeTable.splice(current.unitType * 280, 280, ...typeBytes);
  const turningRaw = [...current.received];
  turningRaw[9] = (turningRaw[9] + 128) & 255;
  assert.deepEqual(reduceLegacyAiRegisteredVisit({ slot: current.slot, raw: turningRaw,
    world: { ...current.world, fin: current.fin, typeBytes: [...typeBytes], combat: { ...current.world.combat!, typeTable } },
    counter: first.counter, rngCursor: first.rngCursor, task6Budget: first.task6Budget, projectiles: pool(first.projectiles) }),
  { supported: false, diagnostic: "unverified-native-fire-weapon" });
  const tables = structuredClone(input.tables);
  for (const directions of Object.values(tables.frames)) for (const frames of directions) for (const frame of frames)
    (frame as number[])[64] = 1;
  assert.deepEqual(launchLegacyNativeFire({ ...input, tables }),
    { supported: false, diagnostic: "unverified-native-fire-muzzle-profile" });
});
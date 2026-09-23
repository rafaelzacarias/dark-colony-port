import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createLegacyNativeGroundRouteSource } from "../../src/engine/legacy-native-ground-route";
import { createLegacyNativeTaskNineSource } from "../../src/engine/legacy-native-task-nine";
import * as host from "../../src/engine/native-registered-host";
import { reduceLegacyNativePendingMove, resolveLegacyNativePendingMove,
  type LegacyNativePendingMoveFrame } from "../../src/engine/legacy-native-pending-move";

const root = fileURLToPath(new URL("../../", import.meta.url));
const saved = process.env.DC_GROUND_ALIEN_TRACE;
const execution = saved ? null : spawnSync("python3", ["-B", root + "tools/qa/legacy-native-ground-route-native.py",
  "--mission", "ALIEN", "--updates", "40"], { cwd: root, encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
  env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" } });
if (execution) assert.equal(execution.status, 0, execution.stderr);
const trace = JSON.parse(saved ? readFileSync(saved, "utf8") : execution!.stdout);
assert.equal(trace.source.completedUpdates, 40);
assert.deepEqual(trace.source.runtimeCoreInterceptions, []);
const phase = trace.source.registeredPhases.find((entry: { counter: number }) => entry.counter === 25);
const visit = phase.visits.find((entry: { slot: number }) => entry.slot === 194);
const entry = visit.dispatches.find((dispatch: { address: number }) => dispatch.address === 0x4157ec);
const frame = (): LegacyNativePendingMoveFrame => ({ boundary: 0x4157ec, index: 194, slot: 194, registeredSlot: 194,
  raw: Uint8Array.from(Buffer.from(entry.raw, "base64")), rngCursor: visit.rngBefore, task6Budget: 0 });
const bytes = (value: string) => Uint8Array.from(value.startsWith("z:")
  ? inflateSync(Buffer.from(value.slice(2), "base64")) : Buffer.from(value, "base64"));

test("ALIEN packet25 original task6 pending7 reinitializes task8", () => {
  const task8 = visit.dispatches.find((dispatch: { address: number }) => dispatch.address === 0x416104);
  assert.ok(entry); assert.ok(task8);
  const raw = Uint8Array.from(Buffer.from(entry.raw, "base64")), original = Uint8Array.from(raw);
  const result = reduceLegacyNativePendingMove({ boundary: 0x4157ec, index: 194, slot: 194, registeredSlot: 194,
    raw, rngCursor: visit.rngBefore, task6Budget: 0 });
  assert.deepEqual(result.raw, [...Buffer.from(task8.raw, "base64")]);
  assert.deepEqual(raw, original);
  assert.equal(result.task6Budget, 1); assert.equal(result.rngCursor, 105);
  assert.equal(result.registeredVisitComplete, false);
});

test("pending7 rejects invalid entries and stale handoffs atomically", () => {
  for (const mutate of [
    (value: LegacyNativePendingMoveFrame) => ({ ...value, index: -1 }),
    (value: LegacyNativePendingMoveFrame) => ({ ...value, index: 800 }),
    (value: LegacyNativePendingMoveFrame) => ({ ...value, slot: 151 }),
    (value: LegacyNativePendingMoveFrame) => ({ ...value, registeredSlot: 193 }),
    (value: LegacyNativePendingMoveFrame) => ({ ...value, rngCursor: 256 }),
    (value: LegacyNativePendingMoveFrame) => ({ ...value, rngCursor: Number.NaN }),
    (value: LegacyNativePendingMoveFrame) => ({ ...value, task6Budget: 10 }),
    (value: LegacyNativePendingMoveFrame) => ({ ...value, task6Budget: -1 }),
    (value: LegacyNativePendingMoveFrame) => ({ ...value, raw: value.raw.slice(1) }),
    ...[[0x36, 0], [0x36, 2], [0x37, 2], [0xcb, 1], [0xc6, 0], [0xc6, 9], [0x38, 5],
      [0x3d, 5], [0x3e, 25], [0x40, 11], [6, 8], [7, 0], [0x2c, 10]].map(([offset, byte]) =>
      (value: LegacyNativePendingMoveFrame) => { value.raw[offset] = byte; return value; }),
  ]) {
    const invalid = mutate(frame()), before = structuredClone(invalid);
    assert.throws(() => reduceLegacyNativePendingMove(invalid), /native/);
    assert.deepEqual(invalid, before);
  }
  const original = frame(), command = reduceLegacyNativePendingMove(original);
  assert.equal(resolveLegacyNativePendingMove(command, original), command);
  assert.throws(() => resolveLegacyNativePendingMove({ ...command }, original), /unauthenticated/);
  for (const mutate of [
    (value: LegacyNativePendingMoveFrame) => ({ ...value, index: 193 }),
    (value: LegacyNativePendingMoveFrame) => ({ ...value, slot: 193 }),
    (value: LegacyNativePendingMoveFrame) => ({ ...value, registeredSlot: -1 }),
    (value: LegacyNativePendingMoveFrame) => ({ ...value, rngCursor: 106 }),
    (value: LegacyNativePendingMoveFrame) => ({ ...value, task6Budget: 1 }),
    (value: LegacyNativePendingMoveFrame) => { value.raw[0xa6] ^= 1; return value; },
    (value: LegacyNativePendingMoveFrame) => { value.raw[0x37] = 2; return value; },
    (value: LegacyNativePendingMoveFrame) => { value.raw[0x86] ^= 1; return value; },
  ]) {
    const stale = mutate(frame()), before = structuredClone(stale);
    assert.throws(() => resolveLegacyNativePendingMove(command, stale), /Stale/);
    assert.deepEqual(stale, before);
  }
  assert.deepEqual(original, frame());
  assert.ok(Object.isFrozen(command) && Object.isFrozen(command.raw) && Object.isFrozen(command.expectedRaw));
  const backing = new Uint8Array(256); backing.set(original.raw, 13);
  assert.deepEqual(reduceLegacyNativePendingMove({ ...original, raw: backing.subarray(13, 233) }).raw, command.raw);
  assert.throws(() => reduceLegacyNativePendingMove({ ...original, raw: Uint8Array.from(command.raw) }), /Unsupported/);
  const exhausted = reduceLegacyNativePendingMove({ ...frame(), task6Budget: 9 });
  assert.equal(exhausted.task6Budget, 10);
});

test("ALIEN packet25 registered host handoff matches every original visit and shared byte", async () => {
  const read = (path: string) => Uint8Array.from(readFileSync(new URL("../../raw_cd/DC/" + path, import.meta.url)));
  const executable = read("DC.EXE"), types = Buffer.from(trace.source.inputs.types, "base64");
  const sourceInput = { executable, mission: "ALIEN02" as const,
    map: read("SCENARIO/ALIEN/ALIEN02.MAP"), pth: read("SCENARIO/ALIEN/ALIEN02.PTH") };
  const source = await createLegacyNativeGroundRouteSource(sourceInput);
  const taskNine = await createLegacyNativeTaskNineSource(sourceInput);
  const configuration = await host.createNativeRegisteredConfiguration({
    assets: { executable, gameStat: read("GAMESTAT/GAMESTAT.TXT"), depend: read("GAMESTAT/DEPEND.TXT"),
      scenario: read("SCENARIO/ALIEN/ALIEN02.SCN"),
      animations: Object.fromEntries(["TRSC", "GRAY", "REAP", "SCYT", "TOWR", "VENT", "BEAC", "DISH", "CENT", "TONG", "ALBU", "HUBU", "TURR", "RNAT", "DROP", "SAUC", "SAWS"]
        .map(name => [name, read(`ANIMATE/${name}.FIN`)])) },
    standRelocations: [0, 2, 8, 10, 16, 17, 25, 28, 29, 40, 41, 69, 81, 84, 86, 89, 91, 92, 93]
      .map(type => ({ type, address: types.readUInt32LE(type * 280 + 0x80) || 0x60000000 + type * 128 })),
    groundRoute: { source, taskNine, rnatMoveBank: types.readUInt32LE(25 * 280 + 0x7c),
      weaponStat: read("GAMESTAT/WEAPSTAT.TXT"),
      troopMoveBanks: ([0, 8] as const).map(type => ({ type, address: types.readUInt32LE(type * 280 + 0x7c) })) },
  });
  const scratch = trace.phases.find((value: { counter: number }) => value.counter === 25);
  const routeState = (value: { bytes: string; familyMask: string }) => ({ ...value,
    bytes: bytes(value.bytes), familyMask: bytes(value.familyMask) });
  const before = { ...phase.before, game: bytes(phase.before.game), dependencies: bytes(phase.before.dependencies),
    groundRoute: routeState(scratch.before) };
  const original = structuredClone(before);
  const caller = { boundary: 0x419bb8 as const, packetCounter: 25, resourceCounter: 5725, globalMode: 0 as const };
  const result = host.transactNativeRegisteredPhase(configuration, before, caller);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? null : { slot: result.slot, message: result.message }));
  assert.ok(result.ok);
  assert.deepEqual(before, original);
  assert.equal(result.visits.length, phase.visits.length);
  for (const [index, actual] of result.visits.entries()) {
    const expected = phase.visits[index];
    assert.deepEqual(actual.before, bytes(expected.before));
    assert.deepEqual(actual.after, bytes(expected.after), `slot ${actual.slot}`);
    for (const key of ["slot", "type", "task", "rngBefore", "rngAfter", "budgetBefore", "budgetAfter", "highWaterBefore", "highWaterAfter"] as const)
      assert.equal(actual[key], expected[key], `${actual.slot}: ${key}`);
    assert.equal(actual.budgetBefore, 0);
  }
  assert.deepEqual(result.state, { ...phase.after, game: bytes(phase.after.game), dependencies: bytes(phase.after.dependencies),
    groundRoute: routeState(scratch.after) });
  const actual = result.visits.find(value => value.slot === 194)!;
  assert.equal(actual.type, 25); assert.equal(new DataView(actual.before.buffer).getInt32(12, true), 750);
  assert.deepEqual([actual.rngBefore, actual.rngAfter, actual.budgetBefore, actual.budgetAfter], [105, 105, 0, 2]);
  assert.equal(actual.after[0x39 + actual.after[0x38] * 2], 5);
  assert.equal(actual.after[9], 0);
  assert.equal(new DataView(actual.after.buffer).getUint16(0, true)
    - new DataView(actual.before.buffer).getUint16(0, true), 30);
  assert.deepEqual(visit.dispatches.slice(-3).map((dispatch: { task: number }) => dispatch.task), [6, 4, 5]);
  assert.deepEqual([actual.after[0x36], actual.after[0x37]], [0, 255]);
  assert.equal(result.admitted, false); assert.equal(result.executableWholeGame, false);
  for (const [label, mutate] of [
    ["invalid opcode", (value: typeof before) => { value.game[0x7d28 + 194 * 220 + 0x37] = 2; }],
    ["invalid count", (value: typeof before) => { value.game[0x7d28 + 194 * 220 + 0xc6] = 9; }],
    ["late FIN", (value: typeof before) => { value.game[0x7d28 + 199 * 220 + 0x14] ^= 1; }],
    ["invalid RNG", (value: typeof before) => { value.rngCursor = 256; }],
    ["invalid route", (value: typeof before) => { value.groundRoute.bytes[4 + 163 * 24 + 12] ^= 1; }],
  ] as const) {
    const invalid = structuredClone(before); mutate(invalid);
    const owner = new host.NativeRegisteredHost(configuration, invalid), snapshot = owner.snapshot;
    const rejected = owner.transact(caller);
    assert.equal(rejected.ok, false);
    assert.ok(!rejected.ok);
    if (label === "late FIN") assert.ok(rejected.completedVisits.some(value => value.slot === 194),
      "later failure rolls back already-computed pending7, scratch and reservations");
    assert.deepEqual(owner.snapshot, snapshot);
    assert.deepEqual(owner.transact(caller), rejected);
  }
  let exactVisits = 0;
  for (const boundary of trace.source.registeredPhases.slice(0, 31)) {
    const route = trace.phases.find((value: { counter: number }) => value.counter === boundary.counter);
    const current = { ...boundary.before, game: bytes(boundary.before.game), dependencies: bytes(boundary.before.dependencies),
      groundRoute: routeState(route.before) };
    const result = host.transactNativeRegisteredPhase(configuration, current, { ...caller,
      packetCounter: boundary.counter, resourceCounter: boundary.resourceClock });
    assert.ok(result.ok, `original packet ${boundary.counter}`);
    assert.deepEqual(result.state, { ...boundary.after, game: bytes(boundary.after.game), dependencies: bytes(boundary.after.dependencies),
      groundRoute: routeState(route.after) }, `all shared state packet ${boundary.counter}`);
    assert.equal(result.visits.length, boundary.visits.length);
    for (const [index, actual] of result.visits.entries()) {
      const expected = boundary.visits[index];
      assert.deepEqual(actual.before, bytes(expected.before));
      assert.deepEqual(actual.after, bytes(expected.after));
      for (const key of ["slot", "type", "task", "rngBefore", "rngAfter", "budgetBefore", "budgetAfter", "highWaterBefore", "highWaterAfter"] as const)
        assert.equal(actual[key], expected[key]);
      assert.equal(actual.budgetBefore, 0);
    }
    exactVisits += result.visits.length;
  }
  assert.equal(exactVisits, 1540);
  console.log(JSON.stringify({ scope: "registered host handoff integration", packet: 25, exactVisits: result.visits.length,
    slot: 194, type: 25, heading: actual.after[9], budget: actual.budgetAfter, rng: actual.rngAfter,
    originalBoundaries: 31, exactBoundaryVisits: exactVisits }));
});
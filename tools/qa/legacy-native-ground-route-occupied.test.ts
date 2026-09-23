import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { searchLegacyNativeGroundRoute, distanceLegacyNativeGroundRoute, createLegacyNativeGroundRouteSource, rerouteLegacyNativeGroundRoute } from "../../src/engine/legacy-native-ground-route";
import { createLegacyNativeTaskNineSource } from "../../src/engine/legacy-native-task-nine";
import { createNativeRegisteredConfiguration, NativeRegisteredHost } from "../../src/engine/native-registered-host";

const bytes = (value: string): Uint8Array => Uint8Array.from(value.startsWith("z:")
  ? inflateSync(Buffer.from(value.slice(2), "base64")) : Buffer.from(value, "base64"));
const root = fileURLToPath(new URL("../../", import.meta.url));
let occupiedTrace: ReturnType<typeof JSON.parse>;
function capture() {
  if (occupiedTrace) return occupiedTrace;
  const saved = process.env.DC_OCCUPIED_TRACE;
  const execution = saved ? null : spawnSync("python3", ["-B", root + "tools/qa/legacy-native-ground-route-native.py",
    "--mission", "HUMAN", "--updates", "16", "--occupied"], { cwd: root, encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" } });
  if (execution) assert.equal(execution.status, 0, execution.stderr);
  return occupiedTrace = JSON.parse(saved ? readFileSync(saved, "utf8") : execution!.stdout);
}
const read = (path: string) => Uint8Array.from(readFileSync(root + "raw_cd/DC/" + path));
const sourceInput = (mission: "HUMAN" | "ALIEN") => ({ executable: read("DC.EXE"), mission: `${mission}02` as const,
  map: read(`SCENARIO/${mission}/${mission}02.MAP`), pth: read(`SCENARIO/${mission}/${mission}02.PTH`) });
test("occupied local search matches original HUMAN02 packet16 internal writes", () => {
  const trace = capture();
  assert.deepEqual(trace.source.runtimeCoreInterceptions, []);
  let compared = 0;
  for (const call of trace.occupiedCalls) {
    if (call.address !== 0x444540) continue;
    const before = call.before, map = bytes(before.map), globals = Buffer.from(before.globals, "base64");
    const state = { address: before.registers.EAX, bytes: map.slice(0x1404, 0x9a4b0),
      stamp: globals.readUInt32LE(0x1980), familyMask: bytes(before.searchGlobals).slice(0, 256),
      neighbors: Array.from({ length: 9 }, (_, index) => Buffer.from(before.searchGlobals, "base64").readUInt32LE(256 + index * 4)) };
    const original = structuredClone(state);
    const world = { width: before.width, height: before.height,
      families: Uint8Array.from(before.pathRows.flatMap((row: { bytes: string }) =>
        Array.from(bytes(row.bytes).filter((_, index) => index % 24 === 12)))),
      nextFamily: map.slice(0x884a8, 0x984a8),
      ground: before.groundRows.flatMap((row: { bytes: string }) => {
        const raw = Buffer.from(row.bytes, "base64");
        return Array.from({ length: before.width }, (_, column) => raw.readUInt32LE(column * 4));
      }), dynamic: true, occupiedLocal: true,
      tables: { costs: Array.from({ length: 81 }, (_, index) => globals.readInt32LE(0x19b4 + index * 4)),
        directions: Array.from({ length: 9 }, (_, index) => globals.readInt32LE(0x1984 + index * 4)) } };
    const result = searchLegacyNativeGroundRoute(world, state, [before.registers.EDX, before.registers.EBX],
      [before.registers.ECX, Buffer.from(before.stack, "base64").readUInt32LE(4)]);
    const expectedWrites = call.writes.map(({ address, size, value }: { address: number; size: number; value: number }) =>
      ({ address, size, value: Number(BigInt(value) & ((1n << BigInt(size * 8)) - 1n)) }));
    const mismatch = result.writes.findIndex((write, index) => JSON.stringify(write) !== JSON.stringify(expectedWrites[index]));
    assert.equal(mismatch, -1, JSON.stringify({ compared, mismatch, actual: result.writes[mismatch], expected: expectedWrites[mismatch] }));
    assert.equal(result.writes.length, expectedWrites.length);
    assert.deepEqual(result.state.bytes, bytes(call.after.map).slice(0x1404, 0x9a4b0));
    assert.deepEqual(state, original);
    assert.equal(result.state.familyMask[0], 0); assert.equal(result.state.familyMask[255], 0);
    if (!compared) {
      const origin = [before.registers.EDX, before.registers.EBX] as const;
      const destination = [before.registers.ECX, Buffer.from(before.stack, "base64").readUInt32LE(4)] as const;
      const destinationCell = destination[1] * world.width + destination[0];
      const flagged = { ...world, ground: world.ground.map((value: number) => (value ^ 0xfc000000) >>> 0) };
      assert.deepEqual(searchLegacyNativeGroundRoute(flagged, state, origin, destination), result, "upper terrain/visibility flags do not replace low10 occupancy");
      for (const occupant of [156, 1022]) {
        const ground = [...world.ground];
        ground[destinationCell] = ((ground[destinationCell] & ~1023) | occupant) >>> 0;
        const blocked = searchLegacyNativeGroundRoute({ ...world, ground }, state, origin, destination);
        assert.equal(blocked.found, false, `destination low10 ${occupant} is not empty`);
        assert.equal(distanceLegacyNativeGroundRoute(blocked.state, world.tables, destination), 0x8000);
        assert.ok(blocked.expansions <= 257);
      }
      assert.throws(() => searchLegacyNativeGroundRoute(world, state, origin, [world.width, 0]), /outside source grid/);
      assert.throws(() => searchLegacyNativeGroundRoute(world, { ...state, air: true }, origin, destination), /air search/);
    }
    compared++;
  }
  assert.ok(compared > 0);
  console.log({ occupiedSearches: compared });
});

test("occupied caller preserves original actor, scratch, and reservations", async () => {
  const trace = capture(), source = await createLegacyNativeGroundRouteSource(sourceInput("HUMAN"));
  let compared = 0;
  for (const call of trace.occupiedCalls) {
    if (call.address !== 0x41518c) continue;
    const before = call.before, map = bytes(before.map), globals = Buffer.from(before.globals, "base64");
    const state = { address: 0x900000 + 0x1404, bytes: map.slice(0x1404, 0x9a4b0),
      stamp: globals.readUInt32LE(0x1980), familyMask: bytes(before.searchGlobals).slice(0, 256), dynamic: false, air: false,
      neighbors: Array.from({ length: 9 }, (_, index) => Buffer.from(before.searchGlobals, "base64").readUInt32LE(256 + index * 4)) };
    const slot = before.registers.EDX, offset = 0x7d28 + slot * 220;
    const raw = bytes(before.game).slice(offset, offset + 220);
    const ground: number[] = before.groundRows.flatMap((row: { bytes: string }) => {
      const buffer = Buffer.from(row.bytes, "base64");
      return Array.from({ length: before.width }, (_, column) => buffer.readUInt32LE(column * 4));
    });
    const original = structuredClone({ raw, state, ground });
    const result = rerouteLegacyNativeGroundRoute(source, state, raw, 0x800000 + offset, ground, slot,
      [before.registers.EBX, before.registers.ECX], Buffer.from(before.stack, "base64").readUInt32LE(4));
    assert.equal(result.reachable, (call.after.registers.EAX & 255) === 0);
    assert.deepEqual(result.raw, bytes(call.after.game).slice(offset, offset + 220));
    assert.deepEqual(result.state.bytes, bytes(call.after.map).slice(0x1404, 0x9a4b0));
    assert.equal(result.state.stamp, Buffer.from(call.after.globals, "base64").readUInt32LE(0x1980));
    assert.deepEqual(call.after.groundRows, before.groundRows, "source restores its own slot without dropping other reservations");
    assert.deepEqual({ raw, state, ground }, original);
    for (const [invalidState, invalidGround, endpoint] of [
      [{ ...state, air: true }, ground, [52, 28]],
      [state, ground.map((value, index) => index === (raw[5] * source.width + raw[1]) ? (value | 1023) >>> 0 : value), [52, 28]],
      [state, ground, [-1, 28]],
    ] as const) assert.throws(() => rerouteLegacyNativeGroundRoute(source, invalidState, raw, 0x800000 + offset,
      invalidGround, slot, endpoint, 1));
    compared++;
  }
  assert.equal(compared, 12);
});

for (const randomizedEndpoint of [false, true] as const) for (const mission of ["HUMAN", "ALIEN"] as const)
test(`${mission} ${randomizedEndpoint ? "randomized endpoint" : "occupied"} registered phase gate`, async () => {
  const saved = process.env[`DC_GROUND_${mission}_TRACE`];
  const execution = saved ? null : spawnSync("python3", ["-B", root + "tools/qa/legacy-native-ground-route-native.py",
    "--mission", mission, "--updates", "40"], { cwd: root, encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" } });
  if (execution) assert.equal(execution.status, 0, execution.stderr);
  const trace = JSON.parse(saved ? readFileSync(saved, "utf8") : execution!.stdout);
  assert.deepEqual(trace.source.runtimeCoreInterceptions, []);
  const input = sourceInput(mission), source = await createLegacyNativeGroundRouteSource(input);
  const taskNine = await createLegacyNativeTaskNineSource(input), types = Buffer.from(trace.source.inputs.types, "base64");
  const owner = await createNativeRegisteredConfiguration({ assets: { executable: input.executable,
    gameStat: read("GAMESTAT/GAMESTAT.TXT"), depend: read("GAMESTAT/DEPEND.TXT"), scenario: read(`SCENARIO/${mission}/${mission}02.SCN`),
    animations: Object.fromEntries(["TRSC", "GRAY", "REAP", "SCYT", "TOWR", "VENT", "BEAC", "DISH", "CENT", "TONG", "ALBU", "HUBU", "TURR", "RNAT", "DROP", "SAUC", "SAWS"]
      .map(name => [name, read(`ANIMATE/${name}.FIN`)])) },
    standRelocations: [0, 2, 8, 10, 16, 17, 25, 28, 29, 40, 41, 69, 81, 84, 86, 89, 91, 92, 93]
      .map(type => ({ type, address: types.readUInt32LE(type * 280 + 0x80) || 0x60000000 + type * 128 })),
    groundRoute: { source, taskNine, occupiedPath: true, randomizedEndpoint: randomizedEndpoint || undefined,
      rnatMoveBank: types.readUInt32LE(25 * 280 + 0x7c), weaponStat: read("GAMESTAT/WEAPSTAT.TXT"),
      troopMoveBanks: ([0, 8] as const).map(type => ({ type, address: types.readUInt32LE(type * 280 + 0x7c) })) } });
  const routeState = (value: { bytes: string; familyMask: string }) => ({ ...value, bytes: bytes(value.bytes), familyMask: bytes(value.familyMask) });
  let completePhases = 0, exactVisits = 0, committedVisits = 0, contiguousPhases = 0, contiguousVisits = 0;
  const failures: { counter: number; slot: number; message: string }[] = [];
  for (const phase of trace.source.registeredPhases.slice(0, randomizedEndpoint ? 40 : 32)) {
    const scratch = trace.phases.find((entry: { counter: number }) => entry.counter === phase.counter);
    const before = { ...phase.before, game: bytes(phase.before.game), dependencies: bytes(phase.before.dependencies), groundRoute: routeState(scratch.before) };
    const host = new NativeRegisteredHost(owner, before);
    const caller = { boundary: 0x419bb8 as const, packetCounter: phase.counter, resourceCounter: phase.resourceClock, globalMode: 0 as const };
    const result = host.transact(caller), visits = result.ok ? result.visits : result.completedVisits;
    for (const [index, visit] of visits.entries()) {
      const expected = phase.visits[index];
      assert.deepEqual(visit.before, bytes(expected.before));
      assert.deepEqual(visit.after, bytes(expected.after), `${mission} packet ${phase.counter} slot ${visit.slot}`);
      for (const key of ["slot", "type", "task", "rngBefore", "rngAfter", "budgetBefore", "budgetAfter", "highWaterBefore", "highWaterAfter"] as const)
        assert.equal(visit[key], expected[key]);
      const changes = new Map<number, { region: "game" | "dependencies"; offset: number; before: number; after: number }>();
      for (const write of expected.writes) {
        const region = write.address >= 0x800000 && write.address < 0x8471b0 ? "game"
          : write.address >= 0x4e6d70 && write.address < 0x4e6d70 + 110 * 52 ? "dependencies" : null;
        if (!region) continue;
        const previous = Buffer.from(write.before, "hex");
        for (let position = 0; position < write.size; position++) {
          const address = write.address + position;
          const change = changes.get(address) ?? { region, offset: address - (region === "game" ? 0x800000 : 0x4e6d70),
            before: previous[position], after: 0 };
          change.after = Number(BigInt(write.value) >> BigInt(position * 8) & 255n); changes.set(address, change);
        }
      }
      const ordered = (entries: typeof visit.changes) => [...entries].sort((left, right) =>
        left.region.localeCompare(right.region) || left.offset - right.offset);
      assert.deepEqual(ordered(visit.changes), ordered([...changes.values()].filter(change => change.before !== change.after)));
    }
    if (phase.counter > 32) {
      if (!result.ok) {
        assert.deepEqual(host.snapshot, before); assert.deepEqual(host.transact(caller), result);
        console.log(JSON.stringify({ mission, scope: "post32 first unsupported boundary", counter: phase.counter,
          slot: result.slot, type: result.type, task: result.task, message: result.message,
          exactUncommittedPrefixVisits: visits.length }));
        break;
      }
      assert.equal(visits.length, phase.visits.length);
      assert.deepEqual(result.state, { ...phase.after, game: bytes(phase.after.game), dependencies: bytes(phase.after.dependencies),
        groundRoute: routeState(scratch.after) });
      console.log(JSON.stringify({ mission, scope: "post32 independently complete boundary", counter: phase.counter, visits: visits.length }));
      continue;
    }
    if (mission === "HUMAN" && phase.counter === 16) {
      const target = visits.find(visit => visit.slot === 161);
      assert.ok(target); assert.equal(target.budgetAfter, 2); assert.equal(target.rngBefore, 67); assert.equal(target.rngAfter, 67);
      if (randomizedEndpoint) {
        const endpoint = visits.find(visit => visit.slot === 173);
        assert.ok(endpoint); assert.equal(endpoint.rngBefore, 67); assert.equal(endpoint.rngAfter, 73);
        const invalid = structuredClone(before), lateSlot = phase.visits.at(-1).slot;
        invalid.game[0x7d28 + lateSlot * 220 + 0x14] ^= 1;
        const rejectedHost = new NativeRegisteredHost(owner, invalid), snapshot = rejectedHost.snapshot;
        const rejected = rejectedHost.transact(caller);
        assert.ok(!rejected.ok);
        assert.ok(rejected.completedVisits.some(visit => visit.slot === 173 && visit.rngAfter === 73));
        assert.deepEqual(rejectedHost.snapshot, snapshot);
        assert.deepEqual(rejectedHost.transact(caller), rejected);
      }
    }
    exactVisits += visits.length;
    if (!result.ok) {
      failures.push({ counter: phase.counter, slot: result.slot, message: result.message });
      assert.deepEqual(host.snapshot, before); assert.deepEqual(host.transact(caller), result);
      assert.equal(host.completed, false); continue;
    }
    completePhases++; committedVisits += visits.length;
    assert.equal(visits.length, phase.visits.length);
    if (!failures.length) { contiguousPhases++; contiguousVisits += visits.length; }
    assert.deepEqual(result.state, { ...phase.after, game: bytes(phase.after.game), dependencies: bytes(phase.after.dependencies), groundRoute: routeState(scratch.after) });
    assert.equal(result.admitted, false); assert.equal(result.executableWholeGame, false);
  }
  console.log(JSON.stringify({ mission, completePhases, exactVisits, committedVisits, contiguousPhases, contiguousVisits, failures }));
  if (randomizedEndpoint || mission === "ALIEN") {
    assert.equal(contiguousPhases, 32);
    assert.equal(completePhases, 32);
    assert.deepEqual(failures, []);
    assert.equal(exactVisits, committedVisits);
    assert.equal(committedVisits, mission === "HUMAN" ? 1039 : 1592);
  } else {
    assert.equal(contiguousPhases, 15); assert.equal(contiguousVisits, 427);
    assert.equal(failures[0].slot, 173); assert.equal(completePhases, 30);
    assert.equal(committedVisits, 967); assert.equal(exactVisits, 1001);
    assert.deepEqual(failures.map(failure => failure.counter), [16, 29]);
  }
});
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { reduceLegacyNativeTaskNine, createLegacyNativeTaskNineSource } from "../../src/engine/legacy-native-task-nine";
import { createLegacyNativeGroundRouteSource } from "../../src/engine/legacy-native-ground-route";
import { createNativeRegisteredConfiguration, transactNativeRegisteredPhase, NativeRegisteredHost } from "../../src/engine/native-registered-host";

const bytes = (value: string) => Uint8Array.from(value.startsWith("z:")
  ? inflateSync(Buffer.from(value.slice(2), "base64")) : Buffer.from(value, "base64"));
const captures = new Map<string, ReturnType<typeof JSON.parse>>();
function capture(mission: string) {
  if (captures.has(mission)) return captures.get(mission);
  const saved = process.env[`DC_GROUND_${mission}_TRACE`];
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const execution = saved ? null : spawnSync("python3", ["-B", root + "tools/qa/legacy-native-ground-route-native.py",
    "--mission", mission, "--updates", "40"], { cwd: root, encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" } });
  if (execution) assert.equal(execution.status, 0, execution.stderr);
  const trace = JSON.parse(saved ? readFileSync(saved, "utf8") : execution!.stdout);
  assert.equal(trace.source.completedUpdates, 40);
  assert.deepEqual(trace.source.runtimeCoreInterceptions, []);
  captures.set(mission, trace);
  return trace;
}

for (const mission of ["HUMAN", "ALIEN"]) test(`${mission} task9 original route handoffs`, () => {
  const trace = capture(mission);
  let compared = 0;
  for (const phase of trace.source.registeredPhases) for (const visit of phase.visits) {
    for (const [index, entry] of visit.dispatches.entries()) {
      if (entry.address !== 0x416198) continue;
      const before = Uint8Array.from(Buffer.from(entry.raw, "base64"));
      if (before[0x36]) continue;
      const route = visit.dispatches[index + 1];
      assert.equal(route.address, 0x414ce4);
      const original = Uint8Array.from(before), result = reduceLegacyNativeTaskNine(before);
      assert.deepEqual(result.raw, Uint8Array.from(Buffer.from(route.raw, "base64")));
      assert.equal(result.routeMode, route.registers.EBX);
      assert.equal(route.registers.ECX, 0);
      assert.deepEqual(before, original);
      compared++;
    }
  }
  assert.equal(compared, mission === "HUMAN" ? 10 : 4);
  console.log({ mission, taskNineHandoffs: compared });
});

test("task9 rejects unsupported entries without mutating caller bytes", () => {
  const trace = capture("HUMAN");
  const entry = trace.source.registeredPhases[15].visits.find((visit: { slot: number }) => visit.slot === 156)
    .dispatches.find((dispatch: { address: number }) => dispatch.address === 0x416198);
  for (const mutate of [
    (raw: Uint8Array) => { raw[0x36] = 1; },
    (raw: Uint8Array) => { raw[0x38] = 5; },
    (raw: Uint8Array) => { raw[0xc6] = 9; },
    (raw: Uint8Array) => { raw[0x46] = 255; raw[0x47] = 255; },
    (raw: Uint8Array) => { raw[0x3a] = 32; },
  ]) {
    const raw = bytes(entry.raw); mutate(raw);
    const original = Uint8Array.from(raw);
    assert.throws(() => reduceLegacyNativeTaskNine(raw), /Invalid native task9/);
    assert.deepEqual(raw, original);
  }
});

for (const mission of ["HUMAN", "ALIEN"] as const) test(`${mission} task9 complete registered phases`, async () => {
  const trace = capture(mission);
  const root = fileURLToPath(new URL("../../raw_cd/DC/", import.meta.url));
  const read = (path: string) => Uint8Array.from(readFileSync(root + path));
  const executable = read("DC.EXE"), types = Buffer.from(trace.source.inputs.types, "base64");
  const sourceInput = { executable, mission: `${mission}02` as const,
    map: read(`SCENARIO/${mission}/${mission}02.MAP`), pth: read(`SCENARIO/${mission}/${mission}02.PTH`) };
  const source = await createLegacyNativeGroundRouteSource(sourceInput);
  const privateInput = structuredClone(sourceInput), pendingSource = createLegacyNativeTaskNineSource(privateInput);
  privateInput.executable.fill(0); privateInput.map.fill(0); privateInput.pth.fill(0);
  const taskNine = await pendingSource;
  for (const key of ["executable", "map", "pth"] as const) {
    const corrupted = structuredClone(sourceInput); corrupted[key][0] ^= 1;
    await assert.rejects(createLegacyNativeTaskNineSource(corrupted), /Unauthenticated/);
  }
  const request = { assets: { executable, gameStat: read("GAMESTAT/GAMESTAT.TXT"), depend: read("GAMESTAT/DEPEND.TXT"),
    scenario: read(`SCENARIO/${mission}/${mission}02.SCN`),
    animations: Object.fromEntries(["TRSC", "GRAY", "REAP", "SCYT", "TOWR", "VENT", "BEAC", "DISH", "CENT", "TONG", "ALBU", "HUBU", "TURR", "RNAT", "DROP", "SAUC", "SAWS"]
      .map(name => [name, read(`ANIMATE/${name}.FIN`)])) },
    standRelocations: [0, 2, 8, 10, 16, 17, 25, 28, 29, 40, 41, 69, 81, 84, 86, 89, 91, 92, 93]
      .map(type => ({ type, address: types.readUInt32LE(type * 280 + 0x80) || 0x60000000 + type * 128 })),
    groundRoute: { source, taskNine, rnatMoveBank: types.readUInt32LE(25 * 280 + 0x7c), weaponStat: read("GAMESTAT/WEAPSTAT.TXT"),
      troopMoveBanks: ([0, 8] as const).map(type => ({ type, address: types.readUInt32LE(type * 280 + 0x7c) })) } };
  const owner = await createNativeRegisteredConfiguration(request);
  await assert.rejects(createNativeRegisteredConfiguration({ ...request,
    groundRoute: { ...request.groundRoute, taskNine: { ...taskNine } } }), /Authenticated task9 source/);
  await assert.rejects(createNativeRegisteredConfiguration({ ...request,
    groundRoute: { ...request.groundRoute, troopMoveBanks: [{ type: 0, address: request.standRelocations[0].address }] } }),
  /Invalid source troop MOVE binding/);
  let completePhases = 0, committedVisits = 0, exactVisits = 0, contiguousPhases = 0, contiguousVisits = 0;
  const failures: { counter: number; slot: number; type: number; task: number; message: string }[] = [];
  const routeState = (value: { bytes: string; familyMask: string }) => ({ ...value, bytes: bytes(value.bytes), familyMask: bytes(value.familyMask) });
  for (const phase of trace.source.registeredPhases.slice(0, 32)) {
    const scratch = trace.phases.find((entry: { counter: number }) => entry.counter === phase.counter);
    const before = { ...phase.before, game: bytes(phase.before.game), dependencies: bytes(phase.before.dependencies), groundRoute: routeState(scratch.before) };
    const original = structuredClone(before);
    const caller = { boundary: 0x419bb8 as const, packetCounter: phase.counter, resourceCounter: phase.resourceClock, globalMode: 0 as const };
    assert.equal(phase.resourceClock, (mission === "HUMAN" ? 5100 : 5700) + phase.counter);
    const result = transactNativeRegisteredPhase(owner, before, caller);
    assert.deepEqual(before, original);
    const visits = result.ok ? result.visits : result.completedVisits;
    if (phase.counter === 16) {
      const target = visits.find(visit => visit.slot === (mission === "HUMAN" ? 156 : 168));
      assert.ok(target, "original packet16 task9 actor completes");
      assert.equal(target.type, mission === "HUMAN" ? 8 : 0);
      assert.deepEqual([target.before[0x36], target.before[0x37], target.before[0xc6]], [1, 9, 2]);
      assert.equal(new DataView(target.before.buffer).getInt32(12, true), mission === "HUMAN" ? 800 : 400);
      assert.equal(target.after[0x39], 9);
      assert.deepEqual([target.after[0x36], target.after[0x37]], [0, 255]);
      assert.equal(target.rngAfter, target.rngBefore);
      assert.equal(target.budgetAfter, 1);
      if (mission === "ALIEN") {
        assert.equal(result.ok, true, "ALIEN whole packet16 including original type69");
        for (const mutate of [
          (value: typeof before) => { value.game[0x7d28 + 199 * 220 + 0x2c] = 10; },
          (value: typeof before) => { value.game[0x7d28 + 199 * 220 + 0x14] ^= 1; },
          (value: typeof before) => { value.game[0x530] ^= 1; },
          (value: typeof before) => { value.groundRoute.bytes[4 + 163 * 24 + 12] ^= 1; },
        ]) {
          const invalid = structuredClone(before); mutate(invalid);
          const host = new NativeRegisteredHost(owner, invalid), snapshot = host.snapshot;
          const rejected = host.transact(caller);
          assert.equal(rejected.ok, false);
          assert.deepEqual(host.snapshot, snapshot);
          assert.deepEqual(host.transact(caller), rejected);
          assert.equal(host.completed, false);
        }
      }
    }
    for (const [index, visit] of visits.entries()) {
      const expected = phase.visits[index];
      assert.deepEqual(visit.before, bytes(expected.before));
      assert.deepEqual(visit.after, bytes(expected.after), `packet ${phase.counter} slot ${visit.slot}`);
      for (const key of ["slot", "type", "task", "rngBefore", "rngAfter", "budgetBefore", "budgetAfter", "highWaterBefore", "highWaterAfter"] as const)
        assert.equal(visit[key], expected[key]);
      assert.equal(visit.budgetBefore, 0);
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
      assert.deepEqual(ordered(visit.changes), ordered([...changes.values()].filter(change => change.before !== change.after)),
        `all game/dependency writes: packet ${phase.counter} slot ${visit.slot}`);
    }
    exactVisits += visits.length;
    if (!result.ok) {
      failures.push({ counter: phase.counter, slot: result.slot, type: result.type, task: result.task, message: result.message });
      const host = new NativeRegisteredHost(owner, before);
      assert.deepEqual(host.transact(caller), result);
      assert.deepEqual(host.snapshot, original);
      assert.deepEqual(host.transact(caller), result);
      continue;
    }
    completePhases++; committedVisits += visits.length;
    if (!failures.length) { contiguousPhases++; contiguousVisits += visits.length; }
    assert.equal(visits.length, phase.visits.length);
    assert.deepEqual(result.state, { ...phase.after, game: bytes(phase.after.game), dependencies: bytes(phase.after.dependencies),
      groundRoute: routeState(scratch.after) }, `complete packet ${phase.counter}`);
    assert.equal(result.admitted, false); assert.equal(result.executableWholeGame, false);
  }
  console.log(JSON.stringify({ mission, completePhases, committedVisits, exactVisits, contiguousPhases, contiguousVisits, failures }));
  assert.equal(completePhases, mission === "HUMAN" ? 26 : 31);
  assert.equal(committedVisits, mission === "HUMAN" ? 823 : 1540);
  assert.equal(exactVisits, mission === "HUMAN" ? 945 : 1588);
  assert.equal(contiguousPhases, mission === "HUMAN" ? 15 : 31);
  assert.equal(contiguousVisits, mission === "HUMAN" ? 427 : 1540);
  assert.deepEqual(failures.map(failure => failure.counter), mission === "HUMAN" ? [16, 24, 29, 30, 31, 32] : [32]);
  assert.deepEqual(failures[0], mission === "HUMAN"
    ? { counter: 16, slot: 161, type: 8, task: 3, message: "Missing RNAT occupied-path consumer at 0x415458" }
    : { counter: 32, slot: 196, type: 25, task: 3, message: "Missing RNAT occupied-path consumer at 0x415458" });
});
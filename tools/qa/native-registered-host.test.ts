import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createNativeRegisteredConfiguration, transactNativeRegisteredPhase, NativeRegisteredHost,
  type NativeRegisteredState, type NativeRegisteredAssets } from "../../src/engine/native-registered-host";
import { createNativeSchedulerRegisteredHost } from "../../src/engine/native-scheduler-host";
import { authenticateLegacyNativeSchedulerSource } from "../../src/engine/legacy-native-scheduler";

const root = fileURLToPath(new URL("../../", import.meta.url));
interface Snapshot extends Omit<NativeRegisteredState, "game" | "dependencies"> { game: string; dependencies: string }
interface Visit {
  slot: number; type: number; task: number; before: string; after: string;
  rngBefore: number; rngAfter: number; budgetBefore: number; budgetAfter: number;
  highWaterBefore: number; highWaterAfter: number;
  writes: { address: number; size: number; value: number; before: string }[];
  dispatches?: { address: number; task: number; raw: string; registers: Record<string, number>; stack: string }[];
}
interface Trace {
  registeredPhases: { counter: number; resourceClock: number; before: Snapshot; after: Snapshot; visits: Visit[];
    touchedMemory: { address: number; before: number; after: number }[];
    writes: { address: number; size: number; value: number; before: string }[] }[];
  inputs: { types: string; fin: Record<string, number[][]> };
  events: { phase: string; counter: number; rngCursor: number; crtSeed: number; resourceClock: number;
    registry?: { index: number; slot: number; type: number }[] }[];
  runtimeCoreInterceptions: unknown[];
  completedUpdates: number;
}
const bytes = (value: string) => Uint8Array.from(Buffer.from(value, "base64"));
const snapshot = (value: Snapshot): NativeRegisteredState => ({ ...value, game: bytes(value.game), dependencies: bytes(value.dependencies) });
const captures = new Map<string, Trace>();
function trace(mission: "HUMAN" | "ALIEN"): Trace {
  const cached = captures.get(mission);
  if (cached) return cached;
  const saved = process.env[`DC_REGISTERED_${mission}_TRACE`];
  if (saved) {
    const result: Trace = JSON.parse(readFileSync(saved, "utf8"));
    captures.set(mission, result);
    return result;
  }
  const result = spawnSync("python3", ["-B", root + "tools/qa/native-registered-host-native.py", "--mission", mission, "--updates", "32"],
    { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" } });
  assert.equal(result.status, 0, result.stderr);
  const capture: Trace = JSON.parse(result.stdout);
  captures.set(mission, capture);
  return capture;
}
function assets(mission: "HUMAN" | "ALIEN"): NativeRegisteredAssets {
  const read = (path: string) => Uint8Array.from(readFileSync(root + "raw_cd/DC/" + path));
  return { executable: read("DC.EXE"), gameStat: read("GAMESTAT/GAMESTAT.TXT"), depend: read("GAMESTAT/DEPEND.TXT"),
    scenario: read(`SCENARIO/${mission}/${mission}02.SCN`),
    animations: Object.fromEntries(["TRSC", "GRAY", "REAP", "SCYT", "TOWR", "VENT", "BEAC", "DISH", "CENT", "TONG", "ALBU", "HUBU", "TURR", "RNAT", "DROP", "SAUC", "SAWS"]
      .map(name => [name, read(`ANIMATE/${name}.FIN`)])) };
}
async function configuration(mission: "HUMAN" | "ALIEN", source: Trace) {
  const types = Buffer.from(source.inputs.types, "base64");
  return createNativeRegisteredConfiguration({ assets: assets(mission),
    standRelocations: [0, 2, 8, 10, 16, 17, 25, 28, 29, 40, 41, 81, 84, 86, 89, 91, 92, 93]
      .map(type => ({ type, address: types.readUInt32LE(type * 280 + 0x80) || 0x60000000 + type * 128 })) });
}
for (const mission of ["HUMAN", "ALIEN"] as const) {
  test(`${mission}02 complete fresh registered phase and native prefix audit`, async () => {
    const source = trace(mission), owner = await configuration(mission, source);
    assert.equal(source.completedUpdates, 32);
    assert.deepEqual(source.runtimeCoreInterceptions, []);
    let completePhases = 0, completeVisits = 0, exactPrefixVisits = 0, exactRnatVisits = 0, exactCarrierVisits = 0;
    const failures = [];
    for (const phase of source.registeredPhases) {
      const before = snapshot(phase.before), unchanged = structuredClone(before);
      const caller = { boundary: 0x419bb8 as const, packetCounter: phase.counter, resourceCounter: phase.resourceClock, globalMode: 0 as const };
      const result = transactNativeRegisteredPhase(owner, before, caller);
      assert.deepEqual(before, unchanged, "caller state remains immutable on success and failure");
      if (!result.ok) {
        failures.push({ counter: phase.counter, slot: result.slot, type: result.type, task: result.task, message: result.message });
        assert.ok(phase.counter > 7, JSON.stringify(failures.at(-1)));
        assert.deepEqual(transactNativeRegisteredPhase(owner, before, caller), result, "failure retries deterministically");
      }
      const visits = result.ok ? result.visits : result.completedVisits;
      if (result.ok) {
        assert.deepEqual(result.state, snapshot(phase.after), `whole phase ${phase.counter}`);
        assert.equal(visits.length, phase.visits.length);
      }
      let productionDirty = phase.before.productionDirty;
      for (const [index, actual] of visits.entries()) {
        const expected = phase.visits[index];
        for (const key of ["slot", "type", "task", "rngBefore", "rngAfter", "budgetBefore", "budgetAfter", "highWaterBefore", "highWaterAfter"] as const)
          assert.equal(actual[key], expected[key], `counter ${phase.counter} slot ${expected.slot} ${key}`);
        assert.deepEqual(actual.before, bytes(expected.before));
        assert.deepEqual(actual.after, bytes(expected.after), `actor ${expected.slot}`);
        const changedBytes = new Map<number, { region: "game" | "dependencies"; offset: number; before: number; after: number }>();
        assert.equal(actual.productionDirtyBefore, productionDirty);
        for (const write of expected.writes) {
          assert.ok(write.address >= 0x800000 && write.address + write.size <= 0x8471b0
            || write.address >= 0x4e6d70 && write.address + write.size <= 0x4e6d70 + 110 * 52
            || [0x478e00, 0x479204, 0x479684].includes(write.address),
          `Unowned completed-prefix write at ${write.address.toString(16)}`);
          if (write.address === 0x479684) { productionDirty = write.value; continue; }
          const region = write.address >= 0x800000 && write.address < 0x8471b0 ? "game"
            : write.address >= 0x4e6d70 && write.address < 0x4e6d70 + 110 * 52 ? "dependencies" : null;
          if (!region) continue;
          const previous = Buffer.from(write.before, "hex");
          for (let position = 0; position < write.size; position++) {
            const address = write.address + position;
            const entry = changedBytes.get(address) ?? { region, offset: address - (region === "game" ? 0x800000 : 0x4e6d70),
              before: previous[position], after: 0 };
            entry.after = Number(BigInt(write.value) >> BigInt(position * 8) & 255n);
            changedBytes.set(address, entry);
          }
        }
        const changes = [...changedBytes.values()].filter(change => change.before !== change.after);
        const ordered = (entries: typeof changes) => entries.sort((left, right) => left.region.localeCompare(right.region) || left.offset - right.offset);
        assert.deepEqual(ordered([...actual.changes]), ordered(changes), `complete memory delta at counter ${phase.counter} actor ${expected.slot}`);
        assert.equal(actual.productionDirtyAfter, productionDirty);
        exactPrefixVisits++;
        if (actual.type === 25) exactRnatVisits++;
        if (actual.type === 92 || actual.type === 93) exactCarrierVisits++;
      }
      assert.equal(result.admitted, false);
      if (!result.ok) continue;
      for (const write of phase.writes) assert.ok(
        write.address >= 0x800000 && write.address + write.size <= 0x8471b0
        || write.address >= 0x4e6d70 && write.address + write.size <= 0x4e6d70 + 110 * 52
        || [0x478e00, 0x479204, 0x479684].includes(write.address),
      `Uncaptured registered global write at ${write.address.toString(16)}`);
      completePhases++; completeVisits += result.visits.length;
    }
    assert.equal(completePhases, 7);
    assert.equal(completeVisits, mission === "HUMAN" ? 147 : 308);
    assert.equal(exactPrefixVisits, mission === "HUMAN" ? 547 : 1040);
    assert.equal(exactRnatVisits, mission === "HUMAN" ? 96 : 40);
    assert.equal(exactCarrierVisits, 17);
    assert.equal(failures[0].slot, mission === "HUMAN" ? 182 : 198);
    assert.ok(exactRnatVisits > 0);
    assert.equal(source.registeredPhases[0].visits.length, mission === "HUMAN" ? 21 : 44);
    assert.equal(source.registeredPhases[0].resourceClock, mission === "HUMAN" ? 5101 : 5701);
    console.log(JSON.stringify({ mission, completePhases, completeVisits, exactPrefixVisits, exactRnatVisits, exactCarrierVisits,
      firstMissingConsumer: failures[0], rejectedPhases: failures.length }));
  });
}

for (const mission of ["HUMAN", "ALIEN"] as const) test(`${mission} RNAT packet-8 waypoint handoff matches original raw220 without committing a partial phase`, async () => {
  const source = trace(mission), owner = await configuration(mission, source);
  const phase = source.registeredPhases.find(entry => entry.counter === 8)!;
  const before = snapshot(phase.before), host = new NativeRegisteredHost(owner, before);
  const caller = { boundary: 0x419bb8 as const, packetCounter: phase.counter, resourceCounter: phase.resourceClock, globalMode: 0 as const };
  const result = host.transact(caller);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.handoff);
  const slot = mission === "HUMAN" ? 182 : 198;
  assert.equal(result.handoff.slot, slot);
  assert.equal(result.handoff.flight, 0);
  assert.equal(result.handoff.registeredVisitComplete, false);
  const native = phase.visits.find(visit => visit.slot === slot)!.dispatches!.find(entry => entry.address === 0x414ce4)!;
  assert.ok(native);
  assert.deepEqual(result.handoff.raw, bytes(native.raw));
  assert.equal(result.handoff.routeMode, native.registers.EBX);
  assert.equal(native.registers.ECX, 0);
  assert.deepEqual(host.snapshot, before);
  assert.equal(host.completed, false);
  result.handoff.raw.fill(0);
  assert.deepEqual(host.snapshot, before);
  assert.deepEqual(host.transact(caller), transactNativeRegisteredPhase(owner, before, caller));
});

test("all 32 original phases preserve same-cycle TRO registry, counters, and every non-stack write", () => {
  for (const mission of ["HUMAN", "ALIEN"] as const) {
    const source = trace(mission);
    assert.deepEqual(source.registeredPhases.map(phase => phase.counter), Array.from({ length: 32 }, (_, index) => index + 1));
    assert.equal(source.registeredPhases.reduce((count, phase) => count + phase.visits.length, 0), mission === "HUMAN" ? 1039 : 1592);
    for (const phase of source.registeredPhases) {
      const before = bytes(phase.before.game), after = bytes(phase.after.game);
      const beforeView = new DataView(before.buffer), afterView = new DataView(after.buffer);
      for (const state of [beforeView, afterView]) {
        assert.equal(state.getUint32(0x94c, true), phase.counter);
        assert.equal(state.getUint32(0x530, true), phase.resourceClock);
      }
      assert.equal(phase.resourceClock, (mission === "HUMAN" ? 5100 : 5700) + phase.counter);
      const entry = source.events.find(event => event.counter === phase.counter && event.phase === "actors-enter")!;
      const exit = source.events.find(event => event.counter === phase.counter && event.phase === "projectiles")!;
      for (const field of ["rngCursor", "crtSeed"] as const) {
        assert.equal(phase.before[field], entry[field]);
        assert.equal(phase.after[field], exit[field]);
      }
      assert.deepEqual(phase.visits.map(visit => visit.slot), entry.registry!.map(record => record.slot));
      const memory = new Map(phase.touchedMemory.map(record => [record.address, record.before]));
      const game = Buffer.from(before);
      for (const write of phase.writes) {
        const previous = Buffer.from(write.before, "hex");
        for (let position = 0; position < write.size; position++) {
          const address = write.address + position;
          assert.equal(memory.get(address), previous[position], `ordered write at ${address.toString(16)}`);
          const value = Number(BigInt(write.value) >> BigInt(position * 8) & 255n);
          memory.set(address, value);
          if (address >= 0x800000 && address < 0x8471b0) {
            assert.equal(game[address - 0x800000], previous[position]);
            game[address - 0x800000] = value;
          }
        }
      }
      for (const record of phase.touchedMemory) assert.equal(memory.get(record.address), record.after);
      assert.deepEqual(Uint8Array.from(game), after, "complete game writes include finances, registry, and counters");
    }
    const worldEntry = source.events.find(event => event.counter === 8 && event.phase === "world-enter")!;
    const actorsEntry = source.events.find(event => event.counter === 8 && event.phase === "actors-enter")!;
    const existing = new Set(worldEntry.registry!.map(record => record.slot));
    const created = actorsEntry.registry!.filter(record => !existing.has(record.slot));
    assert.equal(created.length, mission === "HUMAN" ? 14 : 6);
    assert.ok(created.every(record => record.type === 25));
    const visits = source.registeredPhases[7].visits;
    for (const record of created) assert.ok(visits.some(visit => visit.slot === record.slot));
  }
});

test("carrier FIN mismatch, missing reservation, and descent completion reject without partial commit", async () => {
  for (const mission of ["HUMAN", "ALIEN"] as const) {
    const source = trace(mission), owner = await configuration(mission, source), phase = source.registeredPhases[15];
    const state = snapshot(phase.before), caller = { boundary: 0x419bb8 as const, packetCounter: phase.counter,
      resourceCounter: phase.resourceClock, globalMode: 0 as const };
    const result = transactNativeRegisteredPhase(owner, state, caller);
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.ok(result.completedVisits.some(visit => visit.type === (mission === "HUMAN" ? 92 : 93)));
    for (const mutation of ["bank", "reservation", "completion", "sound"] as const) {
      const changed = structuredClone(state), raw = changed.game.subarray(0x7d28 + 7 * 220, 0x7d28 + 8 * 220);
      const actor = new DataView(raw.buffer, raw.byteOffset, raw.byteLength), payload = 0x46 + raw[0x3a + raw[0x38] * 2] * 2;
      if (mutation === "bank") Object.assign(changed, { carrierFin: {} });
      if (mutation === "reservation") changed.game[0xb98 + 0xe13] = 0;
      if (mutation === "completion") actor.setInt16(payload + 8, 0, true);
      if (mutation === "sound") actor.setInt16(payload + 10, 0, true);
      const host = new NativeRegisteredHost(owner, changed), rejection = host.transact(caller);
      assert.equal(rejection.ok, false, mutation);
      assert.equal(rejection.slot, 7, mutation);
      assert.deepEqual(host.snapshot, changed, mutation);
      assert.equal(host.completed, false);
    }
  }
});

test("registered host commits once, exposes detached state, and rolls back late unsupported work", async () => {
  const source = trace("HUMAN"), owner = await configuration("HUMAN", source), first = source.registeredPhases[0];
  const state = snapshot(first.before), caller = { boundary: 0x419bb8 as const, packetCounter: first.counter,
    resourceCounter: first.resourceClock, globalMode: 0 as const };
  const host = new NativeRegisteredHost(owner, state);
  const badClock = host.transact({ ...caller, resourceCounter: 1 });
  assert.equal(badClock.ok, false);
  assert.equal(host.completed, false);
  assert.deepEqual(host.snapshot, state);
  const result = host.transact(caller);
  assert.equal(result.ok, true);
  assert.equal(host.completed, true);
  if (!result.ok) return;
  assert.deepEqual(result.state, snapshot(first.after));
  result.state.game.fill(255); result.state.dependencies.fill(255);
  assert.deepEqual(host.snapshot, snapshot(first.after));
  assert.equal(host.transact(caller).ok, false);
  for (const mutation of ["type", "task", "bank", "dependency", "position"] as const) {
    const changed = structuredClone(state), slot = 169, offset = 0x7d28 + slot * 220;
    if (mutation === "type") changed.game[offset + 6] = 105;
    if (mutation === "task") changed.game[offset + 0x39] = 22;
    if (mutation === "bank") changed.game[offset + 0x14] ^= 1;
    if (mutation === "dependency") changed.dependencies[8] ^= 1;
    if (mutation === "position") changed.game[offset + 1] = 255;
    const rejected = new NativeRegisteredHost(owner, changed), before = rejected.snapshot;
    const failure = rejected.transact(caller);
    assert.equal(failure.ok, false, mutation);
    assert.deepEqual(rejected.snapshot, before, mutation);
    assert.equal(rejected.completed, false);
    assert.deepEqual(rejected.transact(caller), failure, mutation);
    if (["type", "task", "bank", "position"].includes(mutation)) assert.equal(failure.slot, slot);
  }
  assert.equal(transactNativeRegisteredPhase({ ...owner }, state, caller).ok, false);
  const shared = { ...state, game: new Uint8Array(new SharedArrayBuffer(state.game.length)) };
  shared.game.set(state.game);
  assert.throws(() => new NativeRegisteredHost(owner, shared), /Unshared/);
});

for (const mission of ["HUMAN", "ALIEN"] as const) test(`${mission} occupancy input rejects shared views and missing own cells`, async () => {
  const source = trace(mission), owner = await configuration(mission, source), phase = source.registeredPhases[0];
  const original = snapshot(phase.before), caller = { boundary: 0x419bb8 as const, packetCounter: phase.counter,
    resourceCounter: phase.resourceClock, globalMode: 0 as const };
  for (const name of ["ground", "air", "extra"] as const) {
    const shared = name === "ground" ? new Uint32Array(new SharedArrayBuffer(original.planes[name].length * 4))
      : new Uint16Array(new SharedArrayBuffer(original.planes[name].length * 2));
    shared.set(original.planes[name]);
    const state = structuredClone(original);
    Object.assign(state.planes, { [name]: shared });
    assert.throws(() => new NativeRegisteredHost(owner, state), /Unshared/);
    const result = transactNativeRegisteredPhase(owner, state, caller);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /Unshared/);
    assert.deepEqual(Array.from(shared), original.planes[name]);
    for (const missing of ["hole", "undefined"] as const) {
      const invalid = structuredClone(original), plane = invalid.planes[name] as number[];
      if (missing === "hole") delete plane[0];
      else Object.assign(plane, { 0: undefined });
      const before = structuredClone(invalid), host = new NativeRegisteredHost(owner, invalid);
      const rejected = host.transact(caller);
      assert.equal(rejected.ok, false, `${name} ${missing}`);
      if (!rejected.ok) assert.match(rejected.message, /Invalid current occupancy plane/);
      assert.deepEqual(host.snapshot, before);
      assert.deepEqual(invalid, before);
      assert.deepEqual(host.transact(caller), rejected);
    }
  }
});

for (const mission of ["HUMAN", "ALIEN"] as const) test(`${mission} retained state rejects nested shared buffers and accessors before cloning`, async () => {
  const source = trace(mission), owner = await configuration(mission, source), phase = source.registeredPhases[0];
  const original = snapshot(phase.before), caller = { boundary: 0x419bb8 as const, packetCounter: phase.counter,
    resourceCounter: phase.resourceClock, globalMode: 0 as const };
  const shared = new SharedArrayBuffer(16);
  for (const mutation of [
    { game: new Uint8Array(shared) },
    { dependencies: new Uint8Array(shared) },
    { groundRoute: { bytes: new Uint8Array(shared) } },
    { groundRoute: { familyMask: new Uint8Array(shared) } },
    { carrierFin: { 1: [[shared]] } },
    { carrierFin: { 1: [[new DataView(shared)]] } },
  ]) {
    const changed = Object.assign(structuredClone(original), mutation);
    assert.throws(() => new NativeRegisteredHost(owner, changed), /Unshared/);
    const rejected = transactNativeRegisteredPhase(owner, changed, caller);
    assert.equal(rejected.ok, false);
    if (!rejected.ok) {
      assert.match(rejected.message, /Unshared/);
      assert.equal(rejected.completedVisits.length, 0);
    }
  }
  let getterCalls = 0;
  for (const field of ["planes", "carrierFin"] as const) {
    const changed = structuredClone(original);
    Object.defineProperty(changed, field, { enumerable: true, get() {
      getterCalls++;
      Object.assign(changed.planes, { ground: new Uint32Array(shared) });
      return original[field];
    } });
    assert.throws(() => new NativeRegisteredHost(owner, changed), /accessors/);
    const rejected = transactNativeRegisteredPhase(owner, changed, caller);
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.match(rejected.message, /accessors/);
  }
  assert.equal(getterCalls, 0);
});

test("live registry dispatch uses values, inclusive high water, and empty index clearing with per-index budget reset", async () => {
  const source = trace("HUMAN"), owner = await configuration("HUMAN", source), phase = source.registeredPhases[0];
  const original = snapshot(phase.before), state = { ...structuredClone(original), task6Budget: 9 };
  const game = new DataView(state.game.buffer);
  game.setInt16(0x468ec + 2 * 152, 156, true);
  game.setInt16(0x468ec + 2 * 156, 152, true);
  const highWater = game.getInt32(0x7d20, true);
  assert.equal(game.getInt16(0x468ec + highWater * 2, true), -1);
  state.game[0x7d28 + highWater * 220 + 0x12] = 123;
  const result = transactNativeRegisteredPhase(owner, state, { boundary: 0x419bb8, packetCounter: phase.counter,
    resourceCounter: phase.resourceClock, globalMode: 0 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.visits.find(visit => visit.index === 152)?.slot, 156);
  assert.equal(result.visits.find(visit => visit.index === 156)?.slot, 152);
  assert.equal(result.state.game[0x7d28 + highWater * 220 + 0x12], 0);
  assert.ok(result.emptyIndices.includes(highWater));
  assert.ok(result.visits.every(visit => visit.budgetBefore === 0));
  assert.equal(result.state.task6Budget, 0);
  assert.equal(state.game[0x7d28 + highWater * 220 + 0x12], 123);
});

test("registered profiles reject changed source assets and copy assets before asynchronous authentication", async () => {
  const source = trace("HUMAN"), types = Buffer.from(source.inputs.types, "base64");
  const relocations = [0, 2, 8, 10, 16, 17, 25, 28, 29, 40, 41, 81, 84, 86, 89, 91, 92, 93]
    .map(type => ({ type, address: types.readUInt32LE(type * 280 + 0x80) || 0x60000000 + type * 128 }));
  for (const field of ["executable", "gameStat", "depend", "scenario"] as const) {
    const damaged = assets("HUMAN"); damaged[field][0] ^= 1;
    await assert.rejects(createNativeRegisteredConfiguration({ assets: damaged, standRelocations: relocations }), /Unauthenticated/);
  }
  const damagedFin = assets("HUMAN"); damagedFin.animations.VENT[0] ^= 1;
  await assert.rejects(createNativeRegisteredConfiguration({ assets: damagedFin, standRelocations: relocations }), /Unauthenticated FIN/);
  const missingSaucerStand = assets("HUMAN");
  const { SAWS: omittedSaucerStand, ...animations } = missingSaucerStand.animations;
  assert.ok(omittedSaucerStand.length);
  await assert.rejects(createNativeRegisteredConfiguration({ assets: { ...missingSaucerStand, animations }, standRelocations: relocations }),
    /Missing original FIN stand bank for type 93/);
  const original = assets("HUMAN"), pending = createNativeRegisteredConfiguration({ assets: original, standRelocations: relocations });
  original.gameStat.fill(0); original.animations.VENT.fill(0); relocations[0].address = 0;
  const owner = await pending;
  assert.ok(Object.isFrozen(owner) && Object.isFrozen(owner.types));
  const first = source.registeredPhases[0];
  assert.equal(transactNativeRegisteredPhase(owner, snapshot(first.before), { boundary: 0x419bb8,
    packetCounter: first.counter, resourceCounter: first.resourceClock, globalMode: 0 }).ok, true);
});

test("scheduler registered adapter requires authentic source identity and commits the complete phase only", async () => {
  const source = trace("ALIEN"), configurationValue = await configuration("ALIEN", source);
  const scheduler = await authenticateLegacyNativeSchedulerSource(assets("ALIEN").executable);
  const first = source.registeredPhases[0], boundary = snapshot(first.before);
  assert.throws(() => createNativeSchedulerRegisteredHost({ source: { ...scheduler }, configuration: configurationValue, boundary }), /authenticated/);
  const host = createNativeSchedulerRegisteredHost({ source: scheduler, configuration: configurationValue, boundary });
  const result = host.transact({ boundary: 0x419bb8, packetCounter: first.counter, resourceCounter: first.resourceClock, globalMode: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.admitted, false);
  assert.equal(result.executableWholeGame, false);
  assert.deepEqual(host.snapshot, snapshot(first.after));
  if (result.ok) assert.equal(result.visits.length, 44);
});
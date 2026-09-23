import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { inflateSync } from "node:zlib";
import { searchLegacyNativeGroundRoute, distanceLegacyNativeGroundRoute, serializeLegacyNativeGroundRoute,
  createLegacyNativeGroundRouteSource } from "../../src/engine/legacy-native-ground-route";
import { createNativeRegisteredConfiguration, transactNativeRegisteredPhase, NativeRegisteredHost, type NativeRegisteredState } from "../../src/engine/native-registered-host";

const bytes = (value: string) => Uint8Array.from(value.startsWith("z:")
  ? inflateSync(Buffer.from(value.slice(2), "base64")) : Buffer.from(value, "base64"));
const captures = new Map<string, ReturnType<typeof JSON.parse>>();
function capture(mission: string) {
  const faction = mission.toUpperCase();
  if (captures.has(faction)) return captures.get(faction);
  const saved = process.env[`DC_GROUND_${faction}_TRACE`];
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const execution = saved ? null : spawnSync("python3", ["-B", root + "tools/qa/legacy-native-ground-route-native.py",
    "--mission", faction, "--updates", "40"], { cwd: root, encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" } });
  if (execution) assert.equal(execution.status, 0, execution.stderr);
  const trace = JSON.parse(saved ? readFileSync(saved, "utf8") : execution!.stdout);
  assert.equal(trace.source.completedUpdates, 40);
  assert.deepEqual(trace.source.runtimeCoreInterceptions, []);
  captures.set(faction, trace);
  return trace;
}
for (const mission of ["human", "alien"]) test(`${mission} all original ground-search and serialization scratch`, () => {
  const trace = capture(mission);
  let searches = 0, totalWrites = 0;
  const lengths: number[] = [], expansions: number[] = [];
  for (const [callIndex, call] of trace.calls.entries()) {
  if (call.address !== 0x44492c) continue;
  const before = call.before, map = bytes(before.map), globals = Buffer.from(before.globals, "base64");
  const width = before.width, height = before.height;
  const families = Uint8Array.from(before.pathRows.flatMap((row: { bytes: string }) => {
    const raw = bytes(row.bytes);
    return Array.from({ length: width }, (_, column) => raw[column * 24 + 12]);
  }));
  const tables = { costs: Array.from({ length: 81 }, (_, index) => globals.readInt32LE(0x19b4 + index * 4)),
    directions: Array.from({ length: 9 }, (_, index) => globals.readInt32LE(0x1984 + index * 4)) };
  const state = { address: before.registers.EAX, bytes: map.slice(0x1404, 0x9a4b0),
    stamp: globals.readUInt32LE(0x1980), familyMask: bytes(before.searchGlobals).slice(0, 256),
    neighbors: Array.from({ length: 9 }, (_, index) => Buffer.from(before.searchGlobals, "base64").readUInt32LE(256 + index * 4)) };
  const original = structuredClone(state);
  const world = { width, height, families, nextFamily: map.slice(0x884a8, 0x984a8),
    ground: trace.source.registeredPhases[7].before.planes.ground,
    dynamic: globals.readUInt32LE(0x19ac) !== 0, tables };
  const destination = [before.registers.ECX, Buffer.from(before.stack, "base64").readUInt32LE(4)] as const;
  const result = searchLegacyNativeGroundRoute(world, state, [before.registers.EDX, before.registers.EBX], destination);
  assert.equal(result.expansions, call.writes.filter((write: { address: number }) => write.address === 0x47a980).length - 1);
  assert.deepEqual(state, original);
  assert.ok(result.found || before.registers.EDX === destination[0] && before.registers.EBX === destination[1],
    `call ${callIndex} counter ${call.counter} did not find the endpoint`);
  const expected = bytes(call.after.map).slice(0x1404, 0x9a4b0);
  const mismatch = result.state.bytes.findIndex((value, index) => value !== expected[index]);
  assert.equal(mismatch, -1, `call ${callIndex} counter ${call.counter} first scratch mismatch ${mismatch.toString(16)} actual ${result.state.bytes[mismatch]} expected ${expected[mismatch]}`);
  assert.equal(result.state.stamp, Buffer.from(call.after.globals, "base64").readUInt32LE(0x1980));
  assert.deepEqual(result.writes, call.writes.map(({ address, size, value }: { address: number; size: number; value: number }) =>
    ({ address, size, value: Number(BigInt(value) & ((1n << BigInt(size * 8)) - 1n)) })));
  const distanceCall = trace.calls[callIndex + 1];
  assert.equal(distanceCall.address, 0x44302c);
  const distance = distanceLegacyNativeGroundRoute(result.state, tables, destination);
  assert.equal(distance, distanceCall.after.registers.EAX);
  const serialization = trace.calls[callIndex + 2];
  assert.equal(serialization.address, 0x4430b0);
  const stack = Buffer.from(serialization.before.stack, "base64"), start = stack.readUInt32LE(4), count = stack.readUInt32LE(12);
  const outputAddress = serialization.before.registers.ECX;
  const outputOffset = outputAddress - 0x800000;
  const output = bytes(serialization.before.game).slice(outputOffset, outputOffset + 32);
  const serialized = serializeLegacyNativeGroundRoute(result.state, tables, destination, output, outputAddress, start, count);
  assert.equal(serialized.count, serialization.after.registers.EAX);
  assert.deepEqual(serialized.packed, bytes(serialization.after.game).slice(outputOffset, outputOffset + 32));
  assert.deepEqual(serialized.state.bytes, bytes(serialization.after.map).slice(0x1404, 0x9a4b0));
  assert.equal(serialized.state.stamp, Buffer.from(serialization.after.globals, "base64").readUInt32LE(0x1980));
  assert.deepEqual(serialized.writes, serialization.writes.map(({ address, size, value }: { address: number; size: number; value: number }) =>
    ({ address, size, value: Number(BigInt(value) & ((1n << BigInt(size * 8)) - 1n)) })));
  assert.equal(call.before.rngCursor, call.after.rngCursor);
  assert.equal(call.before.crtSeed, call.after.crtSeed);
  assert.equal(serialization.before.rngCursor, serialization.after.rngCursor);
  assert.equal(serialization.before.crtSeed, serialization.after.crtSeed);
  assert.deepEqual(result.state.familyMask, bytes(call.after.searchGlobals).slice(0, 256));
  assert.deepEqual(result.state.neighbors, Array.from({ length: 9 }, (_, index) => Buffer.from(call.after.searchGlobals, "base64").readUInt32LE(256 + index * 4)));
  totalWrites += result.writes.length + serialized.writes.length;
  searches++; lengths.push(distance); expansions.push(result.expansions);
  }
  assert.equal(searches, mission === "human" ? 28 : 10);
  console.log({ mission, searches, totalWrites, lengths, expansions });
});

for (const mission of ["HUMAN", "ALIEN"] as const) test(`${mission} direct native occupancy and serializer controls`, () => {
  const trace = capture(mission);
  assert.equal(trace.controls.length, 8);
  for (const control of trace.controls) {
    const before = control.before, map = bytes(before.map), globals = Buffer.from(before.globals, "base64");
    const tables = { costs: Array.from({ length: 81 }, (_, index) => globals.readInt32LE(0x19b4 + index * 4)),
      directions: Array.from({ length: 9 }, (_, index) => globals.readInt32LE(0x1984 + index * 4)) };
    const state = { address: before.registers.EAX, bytes: map.slice(0x1404, 0x9a4b0),
      stamp: globals.readUInt32LE(0x1980), familyMask: bytes(before.searchGlobals).slice(0, 256),
      neighbors: Array.from({ length: 9 }, (_, index) => Buffer.from(before.searchGlobals, "base64").readUInt32LE(256 + index * 4)) };
    let actual;
    if (control.address === 0x44492c) {
      const families = Uint8Array.from(before.pathRows.flatMap((row: { bytes: string }) => {
        const raw = bytes(row.bytes);
        return Array.from({ length: before.width }, (_, column) => raw[column * 24 + 12]);
      }));
      const ground = before.groundRows.flatMap((row: { bytes: string }) => {
        const raw = Buffer.from(row.bytes, "base64");
        return Array.from({ length: before.width }, (_, column) => raw.readUInt32LE(column * 4));
      });
      actual = searchLegacyNativeGroundRoute({ width: before.width, height: before.height, families,
        nextFamily: map.slice(0x884a8, 0x984a8), ground, dynamic: globals.readUInt32LE(0x19ac) !== 0, tables }, state,
      [before.registers.EDX, before.registers.EBX], [before.registers.ECX, Buffer.from(before.stack, "base64").readUInt32LE(4)]);
      assert.equal(actual.found, true, control.label);
      assert.equal(actual.expansions, control.writes.filter((write: { address: number }) => write.address === 0x47a980).length - 1);
      console.log({ mission, control: control.label, expansions: actual.expansions, writes: actual.writes.length });
    } else if (control.address === 0x44302c) {
      const distance = distanceLegacyNativeGroundRoute(state, tables, [before.registers.EDX, before.registers.EBX]);
      assert.equal(distance, control.after.registers.EAX);
      assert.ok(distance > 32 && distance < 0x8000);
      actual = { state, writes: [] };
      console.log({ mission, control: control.label, distance });
    } else {
      const address = before.registers.ECX, offset = address - 0x800000, stack = Buffer.from(before.stack, "base64");
      const packed = bytes(before.game).slice(offset, offset + 32);
      actual = serializeLegacyNativeGroundRoute(state, tables, [before.registers.EDX, before.registers.EBX], packed, address,
        stack.readUInt32LE(4), stack.readUInt32LE(12));
      assert.equal(actual.count, control.after.registers.EAX, control.label);
      assert.deepEqual(actual.packed, bytes(control.after.game).slice(offset, offset + 32), control.label);
    }
    assert.deepEqual(actual.state.bytes, bytes(control.after.map).slice(0x1404, 0x9a4b0), control.label);
    assert.equal(actual.state.stamp, Buffer.from(control.after.globals, "base64").readUInt32LE(0x1980));
    assert.deepEqual(actual.writes, control.writes.map(({ address, size, value }: { address: number; size: number; value: number }) =>
      ({ address, size, value: Number(BigInt(value) & ((1n << BigInt(size * 8)) - 1n)) })), control.label);
    assert.equal(before.rngCursor, control.after.rngCursor);
    assert.equal(before.crtSeed, control.after.crtSeed);
  }
});

for (const mission of ["HUMAN", "ALIEN"] as const) test(`${mission} packet 8 full registered ground-route integration`, async () => {
  const root = fileURLToPath(new URL("../../raw_cd/DC/", import.meta.url));
  const read = (path: string) => Uint8Array.from(readFileSync(root + path));
  const trace = capture(mission);
  const types = Buffer.from(trace.source.inputs.types, "base64"), phase = trace.source.registeredPhases[7];
  const executable = read("DC.EXE");
  const sourceRequest = { executable, mission: `${mission}02` as const,
    map: read(`SCENARIO/${mission}/${mission}02.MAP`), pth: read(`SCENARIO/${mission}/${mission}02.PTH`) };
  const sourcePromise = createLegacyNativeGroundRouteSource(sourceRequest);
  const originalPth = Uint8Array.from(sourceRequest.pth);
  sourceRequest.pth.fill(0);
  const source = await sourcePromise;
  assert.equal(source.width, 96); assert.equal(source.height, 84);
  for (const key of ["executable", "map", "pth"] as const) {
    const changed = { ...sourceRequest, pth: Uint8Array.from(originalPth) };
    changed[key] = Uint8Array.from(changed[key]); changed[key][0] ^= 1;
    await assert.rejects(createLegacyNativeGroundRouteSource(changed), /Unauthenticated/);
  }
  const request = { assets: { executable,
    gameStat: read("GAMESTAT/GAMESTAT.TXT"), depend: read("GAMESTAT/DEPEND.TXT"), scenario: read(`SCENARIO/${mission}/${mission}02.SCN`),
    animations: Object.fromEntries(["TRSC", "GRAY", "REAP", "SCYT", "TOWR", "VENT", "BEAC", "DISH", "CENT", "TONG", "ALBU", "HUBU", "TURR", "RNAT", "DROP", "SAUC", "SAWS"]
      .map(name => [name, read(`ANIMATE/${name}.FIN`)])) },
    standRelocations: [0, 2, 8, 10, 16, 17, 25, 28, 29, 40, 41, 81, 84, 86, 89, 91, 92, 93]
      .map(type => ({ type, address: types.readUInt32LE(type * 280 + 0x80) || 0x60000000 + type * 128 })),
    groundRoute: { source, rnatMoveBank: types.readUInt32LE(25 * 280 + 0x7c), weaponStat: read("GAMESTAT/WEAPSTAT.TXT") } };
  const owner = await createNativeRegisteredConfiguration(request);
  await assert.rejects(createNativeRegisteredConfiguration({ ...request,
    groundRoute: { ...request.groundRoute, source: { ...source } } }), /Invalid source RNAT movement binding/);
  const badWeapons = Uint8Array.from(request.groundRoute.weaponStat); badWeapons[0] ^= 1;
  await assert.rejects(createNativeRegisteredConfiguration({ ...request,
    groundRoute: { ...request.groundRoute, weaponStat: badWeapons } }), /Unauthenticated RNAT weapon/);
  const routeSnapshot = trace.phases[7].before;
  const state = { ...phase.before, game: bytes(phase.before.game), dependencies: bytes(phase.before.dependencies),
    groundRoute: { ...routeSnapshot, bytes: bytes(routeSnapshot.bytes), familyMask: bytes(routeSnapshot.familyMask) } };
  const result = transactNativeRegisteredPhase(owner, state,
    { boundary: 0x419bb8, packetCounter: 8, resourceCounter: phase.resourceClock, globalMode: 0 });
  assert.equal(result.ok, true, JSON.stringify(result.ok ? {} : { slot: result.slot, task: result.task, message: result.message }));
  if (!result.ok) return;
  assert.deepEqual(result.state.game, bytes(phase.after.game));
  assert.deepEqual(result.state.planes, phase.after.planes);
  assert.deepEqual(result.state.dependencies, bytes(phase.after.dependencies));
  assert.equal(result.state.rngCursor, phase.after.rngCursor);
  assert.equal(result.state.crtSeed, phase.after.crtSeed);
  assert.equal(result.visits.length, phase.visits.length);
  for (const [index, visit] of result.visits.entries()) assert.deepEqual(visit.after, bytes(phase.visits[index].after));
  const caller = { boundary: 0x419bb8 as const, packetCounter: 8, resourceCounter: phase.resourceClock, globalMode: 0 as const };
  const cell = mission === "HUMAN" ? 523 : 5191;
  const movingSlot = mission === "HUMAN" ? 182 : 198;
  const typedState: NativeRegisteredState = { ...structuredClone(state), planes: {
    ground: Uint32Array.from(state.planes.ground) as unknown as readonly number[],
    air: Uint16Array.from(state.planes.air) as unknown as readonly number[],
    extra: Uint16Array.from(state.planes.extra) as unknown as readonly number[],
  } };
  const typedBefore = structuredClone(typedState), typedHost = new NativeRegisteredHost(owner, typedState);
  assert.ok(Object.isFrozen(typedHost));
  assert.throws(() => Object.assign(typedHost, { configuration: { ...owner } }), TypeError);
  for (const name of ["ground", "air", "extra"] as const) {
    (typedState.planes[name] as unknown as Uint32Array | Uint16Array).fill(0);
    const detached = typedHost.snapshot;
    (detached.planes[name] as unknown as Uint32Array | Uint16Array).fill(0);
    assert.deepEqual(typedHost.snapshot, typedBefore, `${name} input and snapshot are detached`);
  }
  const typedResult = typedHost.transact(caller);
  assert.equal(typedResult.ok, true);
  if (!typedResult.ok) return;
  assert.ok(typedResult.state.planes.ground instanceof Uint32Array);
  assert.ok(typedResult.state.planes.air instanceof Uint16Array);
  assert.ok(typedResult.state.planes.extra instanceof Uint16Array);
  assert.deepEqual({ ...typedResult.state, planes: {
    ground: Array.from(typedResult.state.planes.ground), air: Array.from(typedResult.state.planes.air),
    extra: Array.from(typedResult.state.planes.extra),
  } }, result.state, "whole typed result matches the ordinary-array result");
  const committed = typedHost.snapshot;
  for (const name of ["ground", "air", "extra"] as const) {
    assert.deepEqual(Array.from(typedResult.state.planes[name]), phase.after.planes[name], `${name} exact typed result`);
    (typedResult.state.planes[name] as unknown as Uint32Array | Uint16Array).fill(0);
    (typedHost.snapshot.planes[name] as unknown as Uint32Array | Uint16Array).fill(0);
    assert.deepEqual(typedHost.snapshot, committed, `${name} result and committed snapshot are detached`);
  }
  for (const name of ["ground", "air", "extra"] as const) {
    for (const kind of ["typed", "data-view", "raw-buffer"] as const) {
      const shared = new SharedArrayBuffer(state.planes[name].length * (name === "ground" ? 4 : 2));
      const words = name === "ground" ? new Uint32Array(shared) : new Uint16Array(shared);
      words.set(state.planes[name]);
      const changed = structuredClone(typedBefore);
      Object.assign(changed.planes, { [name]: kind === "typed" ? words : kind === "data-view" ? new DataView(shared) : shared });
      const original = structuredClone({ ...changed, planes: { ...changed.planes, [name]: Array.from(words) } });
      assert.throws(() => new NativeRegisteredHost(owner, changed), /Unshared/, `${name} ${kind}`);
      const rejected = transactNativeRegisteredPhase(owner, changed, caller);
      assert.equal(rejected.ok, false);
      if (!rejected.ok) {
        assert.match(rejected.message, /Unshared/);
        assert.equal(rejected.completedVisits.length, 0);
      }
      assert.deepEqual(transactNativeRegisteredPhase(owner, changed, caller), rejected);
      assert.deepEqual({ ...changed, planes: { ...changed.planes, [name]: Array.from(words) } }, original);
    }
    for (const invalid of ["hole", "undefined", "negative", "fraction", "overflow", "nan", "short", "inherited"] as const) {
      const changed = structuredClone(state) as NativeRegisteredState, plane = changed.planes[name] as number[];
      if (invalid === "hole" || invalid === "inherited") delete plane[cell];
      if (invalid === "undefined") Object.assign(plane, { [cell]: undefined });
      if (invalid === "negative") plane[cell] = -1;
      if (invalid === "fraction") plane[cell] = 0.5;
      if (invalid === "overflow") plane[cell] = name === "ground" ? 0x100000000 : 65536;
      if (invalid === "nan") plane[cell] = NaN;
      if (invalid === "short") plane.length--;
      const before = structuredClone(changed), host = new NativeRegisteredHost(owner, changed);
      const previous = Object.getOwnPropertyDescriptor(Array.prototype, cell);
      try {
        if (invalid === "inherited") Object.defineProperty(Array.prototype, cell,
          { value: state.planes[name][cell], configurable: true, writable: true });
        const rejected = host.transact(caller), direct = transactNativeRegisteredPhase(owner, changed, caller);
        assert.equal(rejected.ok, false, `${name} ${invalid}`);
        if (!rejected.ok) {
          assert.match(rejected.message, /Invalid current occupancy plane/);
          assert.equal(rejected.completedVisits.length, 0);
        }
        assert.deepEqual(direct, rejected);
        assert.deepEqual(host.transact(caller), rejected);
      } finally {
        if (invalid === "inherited") {
          if (previous) Object.defineProperty(Array.prototype, cell, previous);
          else Reflect.deleteProperty(Array.prototype, cell);
        }
      }
      assert.deepEqual(changed, before);
      assert.deepEqual(host.snapshot, before);
      assert.equal(host.completed, false);
    }
  }
  const late = structuredClone(typedBefore), lateSlot = mission === "HUMAN" ? 183 : 800;
  if (mission === "HUMAN") late.game[0x7d28 + lateSlot * 220 + 0x14] ^= 1;
  else {
    const registry = new DataView(late.game.buffer, late.game.byteOffset, late.game.byteLength);
    assert.ok(registry.getInt32(0x7d20, true) > movingSlot);
    registry.setInt16(0x468ec + (movingSlot + 1) * 2, lateSlot, true);
  }
  const lateBefore = structuredClone(late), lateHost = new NativeRegisteredHost(owner, late);
  const lateResult = lateHost.transact(caller);
  assert.equal(lateResult.ok, false);
  if (!lateResult.ok) {
    assert.equal(lateResult.slot, lateSlot);
    assert.match(lateResult.message, mission === "HUMAN" ? /FIN/ : /Invalid live registry value/);
    const moved = lateResult.completedVisits.find(visit => visit.slot === movingSlot);
    assert.ok(moved, "late failure follows the real RNAT reservation and movement");
    assert.deepEqual(moved.after, bytes(phase.visits.find((visit: { slot: number }) => visit.slot === movingSlot).after));
    assert.notDeepEqual(moved.after, moved.before);
    const beforeActor = new DataView(moved.before.buffer, moved.before.byteOffset, moved.before.byteLength);
    const afterActor = new DataView(moved.after.buffer, moved.after.byteOffset, moved.after.byteLength);
    assert.equal(Math.abs(afterActor.getUint16(0, true) - beforeActor.getUint16(0, true))
      + Math.abs(afterActor.getUint16(4, true) - beforeActor.getUint16(4, true)), 30);
  }
  assert.deepEqual(late, lateBefore, "whole typed caller survives late failure");
  assert.deepEqual(lateHost.snapshot, lateBefore, "whole typed host survives late failure");
  assert.deepEqual(lateHost.transact(caller), lateResult, "late failure retry preserves reservation");
  assert.deepEqual(transactNativeRegisteredPhase(owner, late, caller), lateResult);
  assert.deepEqual(late, lateBefore);
  assert.deepEqual(lateHost.snapshot, lateBefore);
  assert.equal(lateHost.completed, false);
  const invalidStates: [string, (value: NativeRegisteredState) => void][] = [
    ["family scratch", value => { value.groundRoute!.bytes[4 + (162 + 1) * 24 + 12] ^= 1; }],
    ["directional prefix", value => { value.groundRoute!.bytes[0x870a4] ^= 1; }],
    ["dynamic caller", value => { Object.assign(value.groundRoute!, { dynamic: true }); }],
    ["air caller", value => { Object.assign(value.groundRoute!, { air: true }); }],
    ["map relocation", value => { Object.assign(value.groundRoute!, { address: 0 }); }],
    ["stamp overflow", value => { Object.assign(value.groundRoute!, { stamp: 0xffffffff }); }],
  ];
  for (const [label, mutate] of invalidStates) {
    const before = structuredClone(state) as NativeRegisteredState;
    mutate(before);
    const original = structuredClone(before), host = new NativeRegisteredHost(owner, before);
    const rejected = host.transact(caller);
    assert.equal(rejected.ok, false, label);
    assert.deepEqual(host.snapshot, original, label);
    assert.deepEqual(host.transact(caller), rejected, `${label} deterministic retry`);
    assert.deepEqual(before, original, label);
    assert.equal(host.completed, false);
  }
  const visible = structuredClone(state) as NativeRegisteredState;
  const slot = mission === "HUMAN" ? 182 : 198, actorOffset = 0x7d28 + slot * 220;
  const raw = new DataView(visible.game.buffer, visible.game.byteOffset, visible.game.byteLength);
  const visibleCell = (raw.getUint16(actorOffset + 4, true) >> 8) * visible.width + (raw.getUint16(actorOffset, true) >> 8);
  const target = phase.visits.find((visit: { type: number }) => visit.type === (mission === "HUMAN" ? 8 : 0)).slot;
  (visible.planes.ground as number[])[visibleCell] = ((visible.planes.ground[visibleCell] & ~1023) | 0x40000000 | target) >>> 0;
  const visibleHost = new NativeRegisteredHost(owner, visible), visibleBefore = visibleHost.snapshot;
  const visibleResult = visibleHost.transact(caller);
  assert.equal(visibleResult.ok, false);
  if (!visibleResult.ok) assert.match(visibleResult.message, /visible attack acquisition consumer at 0x435570/);
  assert.deepEqual(visibleHost.snapshot, visibleBefore);
  const successfulHost = new NativeRegisteredHost(owner, state);
  const accepted = successfulHost.transact(caller);
  assert.equal(accepted.ok, true);
  if (accepted.ok) accepted.state.groundRoute!.bytes.fill(0);
  assert.notDeepEqual(successfulHost.snapshot.groundRoute!.bytes, new Uint8Array(0x990ac));
  assert.equal(successfulHost.transact(caller).ok, false, "complete phase cannot be consumed twice");
  console.log({ mission, packet: 8, visits: result.visits.length });
  let completePhases = 0, exactVisits = 0, committedVisits = 0;
  const failures: { counter: number; slot: number; type: number; task: number; message: string }[] = [];
  for (const nativePhase of trace.source.registeredPhases) {
    const scratch = trace.phases.find((entry: { counter: number }) => entry.counter === nativePhase.counter);
    const routeState = (value: typeof scratch.before) => ({ ...value, bytes: bytes(value.bytes), familyMask: bytes(value.familyMask) });
    const before: NativeRegisteredState = { ...nativePhase.before, game: bytes(nativePhase.before.game),
      dependencies: bytes(nativePhase.before.dependencies), groundRoute: routeState(scratch.before) };
    const original = structuredClone(before);
    const caller = { boundary: 0x419bb8 as const, packetCounter: nativePhase.counter,
      resourceCounter: nativePhase.resourceClock, globalMode: 0 as const };
    const actual = transactNativeRegisteredPhase(owner, before, caller);
    assert.deepEqual(before, original, "atomic caller inputs");
    const visits = actual.ok ? actual.visits : actual.completedVisits;
    for (const [index, visit] of visits.entries()) {
      assert.deepEqual(visit.after, bytes(nativePhase.visits[index].after), `phase ${nativePhase.counter} slot ${visit.slot}`);
      assert.equal(visit.rngAfter, nativePhase.visits[index].rngAfter);
      assert.equal(visit.budgetAfter, nativePhase.visits[index].budgetAfter);
    }
    exactVisits += visits.length;
    if (!actual.ok) {
      failures.push({ counter: nativePhase.counter, slot: actual.slot, type: actual.type, task: actual.task, message: actual.message });
      assert.deepEqual(transactNativeRegisteredPhase(owner, before, caller), actual, "atomic rejection retry");
      if (nativePhase.counter === 16) {
        const host = new NativeRegisteredHost(owner, before);
        assert.deepEqual(host.transact(caller), actual);
        assert.deepEqual(host.snapshot, before);
        assert.equal(host.completed, false);
      }
      continue;
    }
    completePhases++;
    committedVisits += visits.length;
    assert.equal(visits.length, nativePhase.visits.length);
    assert.deepEqual(actual.state, { ...nativePhase.after, game: bytes(nativePhase.after.game),
      dependencies: bytes(nativePhase.after.dependencies), groundRoute: routeState(scratch.after) }, `complete native phase ${nativePhase.counter}`);
  }
  assert.equal(completePhases, 15);
  assert.equal(committedVisits, mission === "HUMAN" ? 427 : 708);
  assert.equal(exactVisits, mission === "HUMAN" ? 627 : 1208);
  assert.equal(failures.length, 25);
  assert.deepEqual(failures[0], { counter: 16, slot: mission === "HUMAN" ? 156 : 168, type: mission === "HUMAN" ? 8 : 0,
    task: 3, message: "Missing live damage, pending-order, or auxiliary consumer" });
  console.log(JSON.stringify({ mission, completePhases, committedVisits, exactVisits, firstMissing: failures[0], rejectedPhases: failures.length }));
});
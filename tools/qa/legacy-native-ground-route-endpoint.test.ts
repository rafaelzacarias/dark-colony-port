import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { createLegacyNativeGroundRouteSource, correctLegacyNativeGroundRouteEndpoint } from "../../src/engine/legacy-native-ground-route";

const root = fileURLToPath(new URL("../../", import.meta.url));
const bytes = (value: string) => Uint8Array.from(value.startsWith("z:")
  ? inflateSync(Buffer.from(value.slice(2), "base64")) : Buffer.from(value, "base64"));
const read = (path: string) => Uint8Array.from(readFileSync(root + "raw_cd/DC/" + path));
const saved = process.env.DC_ENDPOINT_TRACE;
const execution = saved ? null : spawnSync("python3", ["-B", root + "tools/qa/legacy-native-ground-route-native.py",
  "--mission", "HUMAN", "--updates", "32", "--endpoint"], { cwd: root, encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
  env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" } });
if (execution) assert.equal(execution.status, 0, execution.stderr);
const trace = JSON.parse(saved ? readFileSync(saved, "utf8") : execution!.stdout);

test("randomized endpoint matches original HUMAN16/29 candidates, RNG, raw and route scratch", async () => {
  assert.deepEqual(trace.source.runtimeCoreInterceptions, []);
  const source = await createLegacyNativeGroundRouteSource({ executable: read("DC.EXE"), mission: "HUMAN02",
    map: read("SCENARIO/HUMAN/HUMAN02.MAP"), pth: read("SCENARIO/HUMAN/HUMAN02.PTH") });
  assert.equal(trace.source.completedUpdates, 32);
  const steps = trace.endpointSteps;
  let attempts = 0, exactWrites = 0;
  for (const [index, step] of steps.entries()) {
    if (step.address !== 0x4155d5) continue;
    const candidate = steps[index + 1], after = steps[index + 3];
    assert.equal(candidate.address, 0x4156b7); assert.equal(after.address, 0x4156f9);
    const call = trace.endpointCalls.find((call: { counter: number; before: { rngCursor: number; registers: { EDX: number } } }) =>
      call.counter === step.counter && call.before.rngCursor === candidate.rngCursor && call.before.registers.EDX === step.slot);
    assert.ok(call?.after);
    const state = (snapshot: typeof call.before) => {
      const globals = Buffer.from(snapshot.globals, "base64"), search = Buffer.from(snapshot.searchGlobals, "base64");
      return { address: new DataView(bytes(snapshot.game).buffer).getUint32(0x46f2c, true) + 0x1404,
        bytes: bytes(snapshot.map).slice(0x1404, 0x1404 + 0x990ac), stamp: globals.readUInt32LE(0x1980),
        familyMask: Uint8Array.from(search.subarray(0, 256)), dynamic: false, air: false,
        neighbors: Array.from({ length: 9 }, (_, position) => search.readUInt32LE(256 + position * 4)) };
    };
    const current = state(call.before);
    const ground = call.before.groundRows.flatMap((row: { bytes: string }) => {
      const raw = Buffer.from(row.bytes, "base64");
      return Array.from({ length: source.width }, (_, column) => raw.readUInt32LE(column * 4));
    });
    const request = { boundary: 0x4155d5 as const, slot: step.slot, raw: bytes(step.raw), rawAddress: 0x800000 + 0x7d28 + step.slot * 220,
      ground, rngCursor: step.rngCursor };
    const original = structuredClone({ current, request });
    const result = correctLegacyNativeGroundRouteEndpoint(source, current, request);
    assert.deepEqual(result.candidate, bytes(candidate.raw));
    assert.deepEqual(result.raw, bytes(after.raw));
    assert.equal(result.rngCursor, after.rngCursor);
    assert.deepEqual(result.state, { ...state(call.after), address: current.address });
    const nativeWrites = call.writes.filter((write: { address: number }) =>
      write.address >= current.address && write.address < current.address + current.bytes.length
      || write.address >= 0x4fe65c && write.address < 0x4fe780 || write.address === 0x47a980
      || write.address >= request.rawAddress + 0x86 && write.address < request.rawAddress + 0xa6);
    assert.deepEqual(result.writes, nativeWrites.map(({ address, size, value }: { address: number; size: number; value: number }) =>
      ({ address, size, value: Number(BigInt(value) & ((1n << BigInt(size * 8)) - 1n)) })));
    exactWrites += result.writes.length;
    assert.deepEqual({ current, request }, original);
    if (attempts === 0) {
      for (const invalid of [
        { ...request, rngCursor: 256 }, { ...request, rngCursor: -1 }, { ...request, rawAddress: request.rawAddress + 220 },
        { ...request, slot: 151 }, { ...request, raw: request.raw.slice(1) }, { ...request, ground: [] },
        ...[[6, 2], [0x36, 1], [0x38, 0], [0x3d, 5], [0x40, 33]].map(([offset, value]) => {
          const raw = Uint8Array.from(request.raw); raw[offset] = value; return { ...request, raw };
        }),
      ]) {
        const before = structuredClone(invalid);
        assert.throws(() => correctLegacyNativeGroundRouteEndpoint(source, current, invalid), /endpoint/);
        assert.deepEqual(invalid, before);
      }
      assert.throws(() => correctLegacyNativeGroundRouteEndpoint({ ...source }, current, request), /endpoint/);
      for (const invalid of [{ ...current, dynamic: true }, { ...current, air: true }])
        assert.throws(() => correctLegacyNativeGroundRouteEndpoint(source, invalid, request), /endpoint/);
      assert.deepEqual({ current, request }, original);
    }
    attempts++;
  }
  assert.equal(attempts, 6);
  console.log(JSON.stringify({ scope: "source endpoint retries", attempts, exactWrites,
    actors: [173, 157, 160], phases: [16, 29] }));
});
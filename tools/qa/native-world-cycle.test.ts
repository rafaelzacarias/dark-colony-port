import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createSourceNativeWorldPrefixSource, sourceNativeWorldPrefixInputs } from "../../src/engine/source-native-world-state";
import { reduceNativeWorldPrefix, transactNativeWorldCycle, type NativeWorldPrefixState,
  type NativeWorldPrefixStep } from "../../src/engine/native-world-cycle";

interface Boundary {
  address: number;
  game: string;
  statistics: string;
  typeStatistics: string;
  alliances: string;
  sharedVision: string;
  renat: string;
  renatCount: number;
  rngCursor: number;
  crtSeed: number;
}
interface Capture {
  completedUpdates: number;
  runtimeCoreInterceptions: unknown[];
  prefixes: { counter: number; boundaries: Boundary[];
    writes: { phase: number; address: number; size: number; value: number }[] }[];
  events: { phase: string; counter: number; team?: number; rngCursor: number }[];
}
const root = new URL("../../", import.meta.url);
const decode = (value: string) => Uint8Array.from(Buffer.from(value, "base64"));
function state(boundary: Boundary): NativeWorldPrefixState {
  return { game: decode(boundary.game), statistics: decode(boundary.statistics),
    typeStatistics: decode(boundary.typeStatistics), alliances: decode(boundary.alliances),
    sharedVision: decode(boundary.sharedVision), renat: decode(boundary.renat), renatCount: boundary.renatCount,
    rngCursor: boundary.rngCursor, crtSeed: boundary.crtSeed };
}

for (const faction of ["HUMAN", "ALIEN"] as const) {
  const file = process.env[`DC_WORLD_PREFIX_${faction}_TRACE`];
  const trace: Capture = JSON.parse(file ? readFileSync(file, "utf8") : execFileSync("python3", ["-B",
    "tools/qa/native-world-cycle-native.py", "--mission", faction], { cwd: root, encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" } }));
  const source = await createSourceNativeWorldPrefixSource({ executable: readFileSync(new URL("raw_cd/DC/DC.EXE", root)),
    scenario: readFileSync(new URL(`raw_cd/DC/SCENARIO/${faction}/${faction}02.SCN`, root)) });

  test(`${faction} world prefix: source-only alliance and RENAT initialization equals original startup`, () => {
    const initial = state(trace.prefixes[0].boundaries[0]);
    const actual = sourceNativeWorldPrefixInputs(source);
    for (const key of ["alliances", "sharedVision", "renat", "renatCount"] as const) assert.deepEqual(actual[key], initial[key], key);
    actual.alliances.fill(0);
    assert.deepEqual(sourceNativeWorldPrefixInputs(source).alliances, initial.alliances);
  });

  test(`${faction} world prefix: first four native census, flags, cap, relations and clocks match every byte and ordered write`, () => {
    assert.equal(trace.completedUpdates, 4);
    assert.deepEqual(trace.runtimeCoreInterceptions, []);
    assert.equal(trace.prefixes.length, 4);
    for (const prefix of trace.prefixes) {
      for (const [step, entry, exit, phases] of [
        ["census-and-commander-flags", 0x4196f4, 0x41981c, [0x4196f4, 0x4197b4]],
        ["clock-cap-relations-daylight", 0x41989e, 0x419a28, [0x41989e, 0x4198c3, 0x4198ce]],
      ] as const) {
        const initial = state(prefix.boundaries.find(boundary => boundary.address === entry)!);
        const before = structuredClone(initial);
        const result = reduceNativeWorldPrefix(source, initial, step);
        if (!result.ok) assert.fail(result.message);
        assert.deepEqual(initial, before);
        assert.deepEqual(result.state, state(prefix.boundaries.find(boundary => boundary.address === exit)!), `${step} ${prefix.counter}`);
        const bases = { game: 0x800000, statistics: 0x4956e0, typeStatistics: 0x495860 };
        assert.deepEqual(result.writes.map(write => ({ address: bases[write.region] + write.offset, size: write.size, value: write.value })),
          prefix.writes.filter(write => (phases as readonly number[]).includes(write.phase))
            .map(({ address, size, value }) => ({ address, size, value })), `${step} ordered writes ${prefix.counter}`);
        assert.equal(result.completedWholeCycles, 0);
        assert.equal(result.admitted, false);
      }
    }
    assert.equal(trace.events.filter(event => event.phase === "trigger-scan").length, 0);
    assert.deepEqual(trace.events.filter(event => event.phase === "ai-selector").map(event => [event.counter, event.team]),
      faction === "HUMAN" ? [[4, 2], [4, 3], [4, 4]] : [[4, 1], [4, 2]]);
    assert.equal(trace.events.filter(event => event.phase === "full-policy").length, faction === "HUMAN" ? 2 : 0);
    assert.equal(trace.events.at(-1)!.rngCursor, faction === "HUMAN" ? 15 : 32);
  });

  test(`${faction} world prefix: full cycle rejects before mutation and bad prefix input cannot partially commit`, () => {
    const initial = state(trace.prefixes[0].boundaries[0]), before = structuredClone(initial);
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = transactNativeWorldCycle(source, initial);
      assert.equal(result.ok, false);
      assert.equal(result.completedWholeCycles, 0);
      assert.equal(result.blockers[0].owner, "source-native-world-state");
      assert.deepEqual(initial, before);
    }
    const invalid = structuredClone(initial);
    new DataView(invalid.game.buffer).setInt16(0x1934 + 7 * 0xe30, 800, true);
    const invalidBefore = structuredClone(invalid);
    assert.equal(reduceNativeWorldPrefix(source, invalid, "census-and-commander-flags").ok, false);
    assert.deepEqual(invalid, invalidBefore);
    assert.equal(reduceNativeWorldPrefix({ ...source }, initial, "census-and-commander-flags").ok, false);
    assert.equal(reduceNativeWorldPrefix(source, initial, "pretend" as NativeWorldPrefixStep).ok, false);
    const shared = new Uint8Array(new SharedArrayBuffer(initial.game.length));
    shared.set(initial.game);
    assert.equal(reduceNativeWorldPrefix(source, { ...initial, game: shared }, "census-and-commander-flags").ok, false);
  });

  test(`${faction} world prefix controls: census uses raw slot, ignores status/HP, preserves other classes and commander flags`, () => {
    const initial = state(trace.prefixes[0].boundaries[0]), game = new DataView(initial.game.buffer);
    initial.statistics.fill(0xa5);
    initial.typeStatistics.fill(0xa5);
    game.setInt16(0x468ec + 152 * 2, 799, true);
    const actor = 0x7d28 + 152 * 220;
    initial.game[actor + 6] = 109;
    initial.game[actor + 7] = 7;
    initial.game[actor + 0x2c] = 0;
    game.setInt32(actor + 12, 0, true);
    game.setInt16(0x1934 + 7 * 0xe30, 151, true);
    game.setInt32(0x528, 0, true);
    const result = reduceNativeWorldPrefix(source, initial, "census-and-commander-flags");
    if (!result.ok) assert.fail(result.message);
    const types = new DataView(result.state.typeStatistics.buffer);
    assert.equal(types.getInt32(7 * 1760 + 109 * 16 + 4, true), 1);
    for (let team = 0; team < 10; team++) for (let type = 0; type < 110; type++) {
      for (const category of [0, 2, 3]) assert.equal(types.getUint32(team * 1760 + type * 16 + category * 4, true), 0xa5a5a5a5);
      if (team >= 8) assert.equal(types.getUint32(team * 1760 + type * 16 + 4, true), 0xa5a5a5a5);
    }
    assert.equal(result.state.game[0x7d28 + 151 * 220 + 10], 0xe6);
    new DataView(result.state.game.buffer).setInt32(0x528, 1000, true);
    const next = reduceNativeWorldPrefix(source, result.state, "census-and-commander-flags");
    if (!next.ok) assert.fail(next.message);
    assert.equal(next.state.game[0x7d28 + 151 * 220 + 10], 0xe6);
    assert.equal(next.state.rngCursor, initial.rngCursor);
    assert.equal(next.state.crtSeed, initial.crtSeed);
  });

  test(`${faction} world prefix controls: cap counts status independently, excludes team9, and divides only for colonies`, () => {
    const initial = state(trace.prefixes[0].boundaries[0]), game = new DataView(initial.game.buffer);
    for (let team = 0; team < 8; team++) for (let city = 0; city < 5; city++) game.setInt32(0xbd4 + team * 0xe30 + city * 4, 0, true);
    for (let slot = 152; slot < 800; slot++) {
      initial.game[0x7d28 + slot * 220 + 0x2c] = 0;
      game.setInt16(0x468ec + slot * 2, -1, true);
    }
    [8, 9, 0].forEach((team, index) => {
      const offset = 0x7d28 + (152 + index) * 220;
      initial.game[offset + 7] = team;
      initial.game[offset + 0x2c] = 1;
    });
    game.setInt32(4, 1000, true);
    const reserve = Array.from({ length: initial.renatCount }, (_, index) => new DataView(initial.renat.buffer).getInt32(index * 40 + 16, true))
      .reduce((sum, value) => sum + value, 0);
    const result = reduceNativeWorldPrefix(source, initial, "clock-cap-relations-daylight");
    if (!result.ok) assert.fail(result.message);
    assert.equal(new DataView(result.state.game.buffer).getInt32(0x528, true), 648 - reserve - 2 - 100);
    game.setInt32(0xbd4, -1, true);
    game.setInt32(0xbd4 + 0xe30 + 4, 3, true);
    const divided = reduceNativeWorldPrefix(source, initial, "clock-cap-relations-daylight");
    if (!divided.ok) assert.fail(divided.message);
    assert.equal(new DataView(divided.state.game.buffer).getInt32(0x528, true), Math.trunc((648 - reserve - 1 - 100) / 2));
  });

  test(`${faction} world prefix controls: bilateral relations, independent vision, preserved cache padding and distinct clocks`, () => {
    const initial = state(trace.prefixes[0].boundaries[0]), game = new DataView(initial.game.buffer);
    initial.alliances.fill(0);
    initial.alliances[0] = 2;
    initial.sharedVision.fill(0);
    initial.sharedVision[0] = 2;
    initial.sharedVision[1] = 1;
    initial.game.fill(0x5a, 0x46f34, 0x46f34 + 100);
    game.setInt32(0x52c, 99, true);
    game.setInt32(0x530, game.getInt32(0x534, true), true);
    game.setInt32(0x53c, 0, true);
    const result = reduceNativeWorldPrefix(source, initial, "clock-cap-relations-daylight");
    if (!result.ok) assert.fail(result.message);
    const after = new DataView(result.state.game.buffer);
    assert.equal(result.state.game[0x46f35], 0);
    assert.equal(result.state.game[0x46f34 + 10], 0);
    assert.equal(after.getUint32(0x19c0, true), 0x60000000);
    assert.equal(after.getUint32(0x19c0 + 0xe30, true), 0x60000000);
    for (let offset = 0; offset < 100; offset++) {
      if (offset >= 80 || offset % 10 >= 8) assert.equal(result.state.game[0x46f34 + offset], 0x5a);
    }
    assert.equal(after.getInt32(0x94c, true), 1);
    assert.equal(after.getInt32(0x52c, true), 100);
    assert.equal(after.getInt32(0x530, true), 0);
    assert.equal(after.getInt32(0x53c, true), 1);
    assert.equal(after.getInt32(0x540, true), 0);
    game.setInt32(0x530, 0, true);
    game.setInt32(0x538, 75, true);
    const dawn = reduceNativeWorldPrefix(source, initial, "clock-cap-relations-daylight");
    if (!dawn.ok) assert.fail(dawn.message);
    assert.equal(new DataView(dawn.state.game.buffer).getInt32(0x540, true), 253);
  });
}
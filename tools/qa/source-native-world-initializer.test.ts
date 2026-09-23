import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { constructSourceNativeCity, createSourceNativeWorldPrefixSource, createSourceNativeCityStartup,
  createSourceNativeScenarioStartup } from "../../src/engine/source-native-world-state";

const root = new URL("../../", import.meta.url);
const decode = (value: string) => Uint8Array.from(Buffer.from(value, "base64"));
interface Snapshot { game: string; types: string; dependencies: string; rngCursor: number;
  ground: string; width: number; height: number; productionDirty: number }
interface Call {
  registers: { EDX: number; EBX: number };
  before: Snapshot;
  after: Snapshot;
  writes: { address: number; size: number; value: number }[];
}
const traceFile = process.env.DC_WORLD_INITIALIZER_TRACE;
const trace = JSON.parse(traceFile ? readFileSync(traceFile, "utf8") : execFileSync("python3", ["-B",
  new URL("tools/qa/source-native-world-initializer-native.py", root).pathname,
  "--mission", process.env.DC_WORLD_INITIALIZER_MISSION ?? "HUMAN"], { cwd: root, encoding: "utf8", maxBuffer: 160 * 1024 * 1024,
  env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" } })) as {
  mission: string; gameAddress: number; groundAddress: number; calls: Call[]; stages: (Snapshot & { address: number })[];
};
const source = await createSourceNativeWorldPrefixSource({ executable: readFileSync(new URL("raw_cd/DC/DC.EXE", root)),
  scenario: readFileSync(new URL(`raw_cd/DC/SCENARIO/${trace.mission.slice(0, -2)}/${trace.mission}.SCN`, root)) });

test("source CITY first constructor: full game, dependencies and every ordered write", () => {
  const call = trace.calls[0];
  const initial = { game: decode(call.before.game), types: decode(call.before.types),
    dependencies: decode(call.before.dependencies), rngCursor: call.before.rngCursor,
    width: 96, height: 84, ground: Array<number>(96 * 84).fill(1023), productionDirty: 0 };
  const before = structuredClone(initial);
  const result = constructSourceNativeCity(source, initial, 0, 0);
  assert.deepEqual(initial, before);
  assert.deepEqual(result.state.game, decode(call.after.game));
  assert.deepEqual(result.state.dependencies, decode(call.after.dependencies));
  assert.deepEqual(result.state.types, decode(call.after.types));
  assert.equal(result.state.rngCursor, call.after.rngCursor);
  const bases = { game: trace.gameAddress, ground: trace.groundAddress, dependencies: 0x4e6d70, productionDirty: 0x479684 };
  assert.deepEqual(result.writes.map(write => ({
    address: bases[write.region] + write.offset, size: write.size, value: write.value,
  })), call.writes
    .map(({ address, size, value }) => ({ address, size, value })));
});

test("source SCN factory: complete post-placement raw800 and registry without oracle input", async () => {
  const asset = (path: string) => readFileSync(new URL(`raw_cd/DC/${path}`, root));
  const faction = trace.mission.slice(0, -2);
  const startup = await createSourceNativeScenarioStartup({ executable: asset("DC.EXE"),
    scenario: asset(`SCENARIO/${faction}/${trace.mission}.SCN`), map: asset(`SCENARIO/${faction}/${trace.mission}.MAP`),
    gameStat: asset("GAMESTAT/GAMESTAT.TXT"), depend: asset("GAMESTAT/DEPEND.TXT"),
    animations: Object.fromEntries(["HUBU", "ALBU", "TOWR", "TRSC", "GRAY", "REAP", "SCYT", "VENT", "BEAC", "DISH", "CENT", "TONG", "TURR"]
      .map(name => [name, asset(`ANIMATE/${name}.FIN`)])) });
  const expected = trace.stages.find(stage => stage.address === startup.boundary)!;
  assert.ok(expected);
  const game = decode(expected.game), gameView = new DataView(game.buffer), types = Buffer.from(expected.types, "base64");
  const fields = new Map(startup.cities.finFields.map(field => [types.readUInt32LE(field.type * 280 + field.offset), field.id]));
  for (let slot = 0; slot < 800; slot++) for (const offset of [0x14, 0x1c, 0x24]) {
    const pointer = 0x7d28 + slot * 220 + offset, address = gameView.getUint32(pointer, true);
    if (address) {
      assert.ok(fields.has(address), `unmapped stand ${address.toString(16)}`);
      gameView.setUint32(pointer, fields.get(address)!, true);
    }
  }
  assert.deepEqual(startup.state.game.subarray(0x7d28, 0x32ca8), game.subarray(0x7d28, 0x32ca8));
  assert.deepEqual(startup.state.game.subarray(0x468e8, 0x46f2c), game.subarray(0x468e8, 0x46f2c));
  assert.equal(new DataView(startup.state.game.buffer).getInt32(0x7d20, true), gameView.getInt32(0x7d20, true));
  const ground = Buffer.from(expected.ground, "base64");
  assert.deepEqual(startup.state.ground, Array.from({ length: expected.width * expected.height }, (_, cell) => ground.readUInt32LE(cell * 4)));
  assert.deepEqual(startup.state.dependencies, decode(expected.dependencies));
  for (let type = 0; type < 110; type++) for (let field = 0; field < 280; field++) {
    if (field >= 0x7c && field < 0xdc || field >= 0xe4 && field < 0xec) continue;
    assert.equal(startup.state.types[type * 280 + field], types[type * 280 + field],
      `source scanner/upgrade type ${type}+${field.toString(16)}`);
  }
  assert.deepEqual(startup.state.types.subarray(106 * 280), new Uint8Array(4 * 280), "PE BSS type padding");
  const firstEntry = decode(trace.stages.find(stage => stage.address === 0x4196f4)!.game);
  const scnExit = decode(trace.stages.find(stage => stage.address === 0x41c7ee)!.game);
  assert.deepEqual(firstEntry.subarray(0x7d28, 0x32ca8), scnExit.subarray(0x7d28, 0x32ca8), "no unowned raw changes before first cycle");
  assert.deepEqual(decode(expected.game).subarray(0x7d28, 0x32ca8), firstEntry.subarray(0x7d28, 0x32ca8));
  const nativeReturn = Uint8Array.from(scnExit), returnView = new DataView(nativeReturn.buffer);
  for (let slot = 0; slot < 800; slot++) for (const offset of [0x14, 0x1c, 0x24]) {
    const pointer = 0x7d28 + slot * 220 + offset, address = returnView.getUint32(pointer, true);
    if (address) returnView.setUint32(pointer, fields.get(address)!, true);
  }
  const unownedPointers = new Set(startup.unallocatedGamePointerFields.flatMap(offset => [offset, offset + 1, offset + 2, offset + 3]));
  let missingBytes = 0;
  for (let offset = 0; offset < nativeReturn.length; offset++) {
    if (unownedPointers.has(offset) || offset >= 0x46fa0 && offset < 0x4719c) {
      if (startup.scnReturnGame[offset] !== nativeReturn[offset]) missingBytes++;
      assert.equal(startup.scnReturnGame[offset], 0);
    } else assert.equal(startup.scnReturnGame[offset], nativeReturn[offset], `SCN return game+${offset.toString(16)}`);
  }
  assert.ok(missingBytes > 0, "unallocated pointers must remain visible, not be claimed as normalized owned allocations");
  assert.equal(startup.placements.length, trace.mission === "HUMAN02" ? 18 : 41);
});

test("source CITY factory: all 120 calls from original assets, all 800 raw records and team fields", async () => {
  const asset = (path: string) => readFileSync(new URL(`raw_cd/DC/${path}`, root));
  const faction = trace.mission.slice(0, -2);
  const factory = await createSourceNativeCityStartup({ executable: asset("DC.EXE"),
    scenario: asset(`SCENARIO/${faction}/${trace.mission}.SCN`), map: asset(`SCENARIO/${faction}/${trace.mission}.MAP`),
    gameStat: asset("GAMESTAT/GAMESTAT.TXT"), depend: asset("GAMESTAT/DEPEND.TXT"),
    animations: { HUBU: asset("ANIMATE/HUBU.FIN"), ALBU: asset("ANIMATE/ALBU.FIN"), TOWR: asset("ANIMATE/TOWR.FIN") } });
  assert.equal(factory.calls.length, 120);
  const nativeTypes = Buffer.from(trace.calls[0].before.types, "base64");
  const addresses = new Map(factory.finFields.map(field => [field.id, nativeTypes.readUInt32LE(field.type * 280 + field.offset)]));
  const bases = { game: trace.gameAddress, ground: trace.groundAddress, dependencies: 0x4e6d70, productionDirty: 0x479684 };
  for (const [index, call] of factory.calls.entries()) {
    const native = trace.calls[index];
    assert.deepEqual([call.team, call.city], [native.registers.EDX, native.registers.EBX]);
    assert.deepEqual(call.writes.map(write => ({ address: bases[write.region] + write.offset, size: write.size,
      value: write.region === "game" && write.size === 4 && write.offset >= 0x7d28
        && [0x14, 0x1c, 0x24].includes((write.offset - 0x7d28) % 220)
        ? addresses.get(write.value)! : write.value })), native.writes.map(({ address, size, value }) => ({ address, size, value })),
    `ordered CITY call ${index}`);
  }
  const normalized = (snapshot: Snapshot) => {
    const game = decode(snapshot.game), gameView = new DataView(game.buffer);
    const types = Buffer.from(snapshot.types, "base64");
    const fields = new Map(factory.finFields.map(field => [types.readUInt32LE(field.type * 280 + field.offset), field.id]));
    for (let slot = 0; slot < 800; slot++) for (const offset of [0x14, 0x1c, 0x24]) {
      const field = 0x7d28 + slot * 220 + offset, address = gameView.getUint32(field, true);
      if (address) {
        assert.ok(fields.has(address), `unmapped FIN ${address.toString(16)}`);
        gameView.setUint32(field, fields.get(address)!, true);
      }
    }
    return game;
  };
  for (const [actual, expected] of [[factory.beforeCities, trace.calls[0].before],
    [factory.afterCities, trace.calls.at(-1)!.after]] as const) {
    const game = normalized(expected);
    assert.deepEqual(actual.game.subarray(0x7d28, 0x32ca8), game.subarray(0x7d28, 0x32ca8), "all 800 raw records");
    assert.deepEqual(actual.game.subarray(0xb98, 0x7d18), game.subarray(0xb98, 0x7d18), "all eight team records");
    assert.deepEqual(actual.game.subarray(0x32cbc, 0x46f2c), game.subarray(0x32cbc, 0x46f2c), "pool and registry");
    assert.deepEqual(actual.dependencies, decode(expected.dependencies), "all dependency bytes");
    const ground = Buffer.from(expected.ground, "base64");
    assert.deepEqual(actual.ground, Array.from({ length: expected.width * expected.height }, (_, cell) => ground.readUInt32LE(cell * 4)));
    assert.equal(actual.rngCursor, expected.rngCursor);
  }
  assert.equal(new DataView(factory.placementEntry.game.buffer).getUint32(0x7d20, true), 152);
  assert.equal(new DataView(factory.beforeCities.game.buffer).getUint32(0x7d20, true), 0);
  assert.equal(new DataView(factory.afterCities.game.buffer).getUint32(0x7d20, true), 5);
});

test("source CITY guards: forged identity and occupied footprint reject without mutation", () => {
  const initial = { game: decode(trace.calls[0].before.game), types: decode(trace.calls[0].before.types),
    dependencies: decode(trace.calls[0].before.dependencies), rngCursor: 0,
    width: 96, height: 84, ground: Array<number>(96 * 84).fill(1023), productionDirty: 0 };
  assert.throws(() => constructSourceNativeCity({ ...source }, initial, 0, 0), /identity/);
  initial.ground.fill(700);
  const before = structuredClone(initial);
  assert.throws(() => constructSourceNativeCity(source, initial, 0, 0), /occupied/);
  assert.deepEqual(initial, before);
});

test("source factory rejects changed source tables before constructing a world", async () => {
  const asset = (path: string) => readFileSync(new URL(`raw_cd/DC/${path}`, root));
  const faction = trace.mission.slice(0, -2), gameStat = Uint8Array.from(asset("GAMESTAT/GAMESTAT.TXT"));
  gameStat[0] ^= 1;
  await assert.rejects(createSourceNativeCityStartup({ executable: asset("DC.EXE"),
    scenario: asset(`SCENARIO/${faction}/${trace.mission}.SCN`), map: asset(`SCENARIO/${faction}/${trace.mission}.MAP`),
    gameStat, depend: asset("GAMESTAT/DEPEND.TXT"), animations: {} }), /Unauthenticated CITY source gameStat/);
});
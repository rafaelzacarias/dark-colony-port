import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCampaignWorld, type CampaignWorld, type CampaignWorldOptions } from "../../src/engine/campaign-world.ts";
import { initializeCampaignPlacements, initializeCampaignSession, type CampaignSessionOptions } from "../../src/engine/campaign-session.ts";
import { transportHostState } from "../../src/engine/transport-host.ts";
import type { TriggerResult } from "../../src/engine/trigger-runtime.ts";
import { parseScenario } from "../extractors/data/scenario.ts";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables.ts";
import { parseMapBundle } from "../extractors/maps/map.ts";

const read = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url));
const units = parseUnitStats(read("GAMESTAT/GAMESTAT.TXT").toString());
const weapons = parseWeaponStats(read("GAMESTAT/WEAPSTAT.TXT").toString());
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const goldens = [
  ["HUMAN01", 33, 0, 185, "af82c538181ca182481562dfa75ff1f39038a58445b019cd6a52426b33e968e7", "e6b9b2d746735cca9a89e103d00f82f67d92539e18e637de9d7cc56eeb52230c"],
  ["ALIEN01", 46, 0, 198, "3a971792a6661c6595ea22a5fa071abe12d03392ab3d8ec40c212328c1298b1e", "4dcedb6507b3da3dece3f77ef442a269dda7b323656a445c610b397765feb3a9"],
  ["HUMAN02", 18, 2, 170, "bed27b613d20fb8b2533369d949adb4e90b96922372e7df3e7957140d44c90ab", "e0576cd48817219c13f25f2041b90fd1a011c84ba366d6c050508455513e30eb"],
  ["ALIEN02", 41, 2, 193, "d76d5901cb996a5dc2f3f72349ba0ec334b5b79a851ef519235a0c8eb5bec91e", "2183678aa8f53335cd943cef1d9228eb9b6f01c1394e154b0786d379e5c030dc"],
] as const;

function unwrap<Value>(result: TriggerResult<Value>): Value {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("Expected success");
  return result.value;
}

function fixture(name = "HUMAN02"): CampaignSessionOptions {
  const faction = name.slice(0, -2);
  const mission = (extension: string) => read(`SCENARIO/${faction}/${name}.${extension}`);
  const source = parseScenario(mission("SCN").toString());
  const map = parseMapBundle(mission("MAP"), mission("MTG"), mission("PTH"));
  return {
    sessionId: name, source, units, weapons, triggers: [], messages: [],
    map, pathGrid: map.pathGrid, tags: map.tagGrid,
    commanders: [{ team: 0, unitType: source.teams[0].race === 0 ? 69 : 73,
      sprite: source.teams[0].race === 0 ? "TRSC" : "GRAY" }],
    directionBits: [[0, 0]], fixedStepMilliseconds: 16, orientationSteps: 1,
    resourceScales: "configured-startup",
  };
}

function projection(world: CampaignWorld): Buffer {
  const parts: Buffer[] = [];
  const bytes = Buffer.from(world.entityBytes!);
  for (const entity of world.entities.filter(({ sourceRow }) => sourceRow !== null)) {
    const slot = Buffer.alloc(2);
    slot.writeUInt16LE(entity.rawSlot!);
    const offset = entity.rawSlot! * 220;
    parts.push(slot, bytes.subarray(offset, offset + 2), bytes.subarray(offset + 4, offset + 8),
      bytes.subarray(offset + 12, offset + 16), bytes.subarray(offset + 44, offset + 45),
      bytes.subarray(offset + 203, offset + 204));
    if (entity.resource) parts.push(bytes.subarray(offset + 50, offset + 52), bytes.subarray(offset + 70, offset + 72));
  }
  return Buffer.concat(parts);
}

for (const [name, entityCount, metadataCount, highWater, sourceHash, nativeHash] of goldens) {
  test(`${name} complete unchanged placement stream matches native counts, slots and byte golden`, () => {
    const options = fixture(name);
    const before = structuredClone(options);
    const sourcePath = `SCENARIO/${name.slice(0, -2)}/${name}.SCN`;
    assert.equal(digest(read(sourcePath)), sourceHash);
    const world = unwrap(initializeCampaignPlacements(options));
    const placed = world.entities;
    const state = world.placementState;
    assert.equal(placed.length, entityCount);
    assert.equal(state.renatSources.length, metadataCount);
    assert.equal(options.source.placementRows.length, entityCount + metadataCount);
    assert.equal(state.firstSlot, 152);
    assert.equal(state.nextSlot, highWater);
    assert.equal(state.highWater, highWater);
    assert.equal(digest(projection(world)), nativeHash);
    assert.deepEqual(world.source, options.source);
    const session = initializeCampaignSession(options);
    assert.equal(transportHostState(unwrap(session).world).highWater, highWater);
    assert.equal(digest(projection(unwrap(session).world)), nativeHash);
    if (name.endsWith("01")) for (const entity of placed) assert.equal(entity.rawSlot, 152 + entity.sourceRow!);
    assert.deepEqual(options, before);
    assert.equal(digest(read(sourcePath)), sourceHash);
  });
}

test("RENAT registration bytes retain source order and populations without creating owner -1 entities", () => {
  const expected = {
    HUMAN02: ["000000002d0000004f00000019000000090000000000000000000000000000000000000000000000",
      "000000002b0000000400000019000000050000000000000000000000000000000000000000000000"],
    ALIEN02: ["000000003a0000004f00000019000000040000000000000000000000000000000000000000000000",
      "00000000070000003700000019000000020000000000000000000000000000000000000000000000"],
  };
  for (const name of ["HUMAN02", "ALIEN02"] as const) {
    const world = unwrap(initializeCampaignPlacements(fixture(name)));
    assert.equal(Buffer.from(world.placementState.renatBytes.slice(0, 80)).toString("hex"), expected[name].join(""));
    assert.ok(world.placementState.renatBytes.slice(80).every((value) => value === 0));
    assert.equal(world.placementState.renatSources.reduce((sum, source) => sum + source.count, 0), name === "HUMAN02" ? 14 : 6);
    assert.ok(world.entities.every(({ team }) => team !== -1 && team !== 9));
    assert.deepEqual(world.entities.filter(({ resource }) => resource).map(({ rawSlot }) => rawSlot),
      name === "HUMAN02" ? [166, 167, 168, 169] : [190, 191, 192]);
  }
});

function worldOptions(rows: readonly (readonly number[])[], firstSlot = 231, highWater = 250): CampaignWorldOptions {
  const options = fixture();
  return { sessionId: "allocation", source: { ...options.source, placementRows: rows }, units, messages: [],
    placementInitialization: { firstSlot, highWater, mode: 0 },
    resourceInitialization: { width: options.map.width, height: options.map.height, firstSlot,
      scales: { rateScale: 256, reserveScale: 256 } } };
}

test("native cursor skips leading/interleaved/trailing RENAT and preserves a larger high-water", () => {
  const rows = [[1, 1, 25, -1, 0], [2, 3, 0, 2, -1, 257], [4, 5, 25, -1, 2, 999],
    [6, 7, 40, 0, 100, 257], [8, 9, 0, 0, -2], [10, 11, 25, -1, 3]];
  const options = worldOptions(rows);
  const before = structuredClone(options);
  const world = unwrap(createCampaignWorld(options));
  assert.deepEqual(world.entities.map(({ sourceRow, rawSlot, unitType, team }) => [sourceRow, rawSlot, unitType, team]),
    [[1, 231, 8, 2], [3, 232, 40, 8], [4, 233, 0, 0]]);
  assert.equal(world.placementState.nextSlot, 234);
  assert.equal(world.placementState.highWater, 250);
  assert.deepEqual(options, before);
  const sessionOptions = fixture();
  const initial = unwrap(initializeCampaignPlacements({ ...sessionOptions, source: { ...sessionOptions.source, placementRows: rows } }));
  const bytes = initial.entityBytes!;
  assert.deepEqual([bytes[152 * 220 + 0xcb], bytes[153 * 220 + 0xcb], bytes[154 * 220 + 0xcb]], [1, 0, 0]);
  assert.equal(initial.entities.find(({ sourceRow }) => sourceRow === 4)!.health, 800);
});

test("RENAT dispatch precedes resource interpretation and ignores the optional sixth value", () => {
  const world = unwrap(createCampaignWorld(worldOptions([[4, 5, 40, -1, 2, 257]])));
  assert.equal(world.entities.length, 0);
  assert.deepEqual(world.placementState.renatSources, [{ sourceRow: 0, tileX: 4, tileY: 5, unitType: 40, count: 2 }]);
  assert.equal(world.placementState.nextSlot, 231);
  assert.equal(world.placementState.highWater, 250);
});

test("unknown allocation state, queue consumers, malformed rows and native registration limits fail explicitly", () => {
  const options = worldOptions([[1, 1, 25, -1, 1]]);
  const cases: CampaignWorldOptions[] = [
    { ...options, placementInitialization: undefined },
    { ...options, placementInitialization: { ...options.placementInitialization!, mode: 1 as 0 } },
    { ...options, placementInitialization: { ...options.placementInitialization!, firstSlot: 230 } },
    worldOptions([[1, 1, 37, 0, -1]]),
    worldOptions([[1, 1, 25, -1, 10]]),
    worldOptions([[1, 1, 25, -1, -1]]),
    worldOptions(Array.from({ length: 26 }, () => [1, 1, 25, -1, 1])),
    worldOptions([[1, 1, 0, 0]]),
    worldOptions([[1, 1, 0, 0, -1, 0, 0]]),
    { ...worldOptions([[1, 1, 0, 2, -1]]), units: units.map(({ rawTail, ...unit }) => unit) },
  ];
  for (const candidate of cases) {
    const before = structuredClone(candidate);
    const result = createCampaignWorld(candidate);
    assert.equal(result.ok, false, JSON.stringify(candidate.source.placementRows));
    if (!result.ok) assert.ok(result.diagnostics[0].message);
    assert.deepEqual(candidate, before);
  }
  assert.equal(unwrap(createCampaignWorld(worldOptions(Array.from({ length: 25 }, () => [1, 1, 25, -1, 9]))))
    .placementState.renatSources.length, 25);
});
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseScenario } from "../extractors/data/scenario.js";
import { lookupIndexedPixel, prepareIndexedUpload, preparePaletteUpload } from "../../src/render/indexed-webgl.js";
import {
  entityPaletteSelector, finBodyPaletteLookup, initializeDesertMissionPalette, initializeMissionPalette,
  scenarioPaletteSelector, scenarioPaletteSelectors, terrainInterpolatedRow, terrainPaletteLookup,
} from "../../src/render/palette-init.js";

const source = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url));
const mission = (faction: string) => parseScenario(source(`SCENARIO/${faction}/${faction}01.SCN`).toString());
const gif = source("DESERT.GIF");
const rmp = source("DESERT.RMP");

test("shared native GIF loader selects the supplied basename and overrides global table endpoints", () => {
  const exe = source("DC.EXE");
  assert.equal(createHash("sha256").update(exe).digest("hex"), "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  for (const [address, hex] of [
    [0x42bd03, "8b75fc8b45f48b7dfcb9000300004631d289f381c701030000e8bb2b0200"],
    [0x44e9ba, "80e1078945e4b802000000d3e08a55bc89c1f6c2807449"],
    [0x44e9d1, "8d14850000000089f329c28b45e8e89479fbff85c0750a"],
    [0x44e9f2, "8b45e8c6400100c6400200c600008d048d000000008b55e829c801d0c640fdffc640feffc640ffff"],
  ] as const) {
    assert.equal(exe.subarray(address - 0x400c00, address - 0x400c00 + hex.length / 2).toString("hex"), hex);
  }
  for (const bank of ["ATLANTIS", "DESERT", "HTRAIN", "JUNGLE"]) {
    const bytes = source(`${bank}.GIF`);
    assert.match(bytes.subarray(0, 6).toString(), /^GIF8[79]a$/);
    assert.equal(bytes[10] & 0x87, 0x87);
    assert.ok(bytes.length >= 781);
  }
});

for (const bank of ["ATLANTIS", "DESERT", "HTRAIN", "JUNGLE"]) {
  test(`${bank} initialization differentially matches source GIF/RMP for both phases and every team color`, () => {
    const bankGif = source(`${bank}.GIF`);
    const bankRmp = source(`${bank}.RMP`);
    const expectedPalette = Uint8Array.from(bankGif.subarray(13, 781));
    expectedPalette.fill(0, 0, 3);
    expectedPalette.fill(255, 765);
    const scenario = mission("HUMAN");
    for (const phase of [0, 1]) {
      for (let rotation = 0; rotation < 8; rotation++) {
        const teams = scenario.teams.map((team) => ({ ...team, teamColor: (team.index + rotation) % 8 }));
        const initialized = initializeMissionPalette({ ...scenario, terrainBank: `${bank.toLowerCase()}.bts`,
          rawHeader: [scenario.rawHeader[0], String(phase)], teams }, bankGif, bankRmp);
        assert.deepEqual(initialized.palette, expectedPalette);
        assert.deepEqual(initialized.remap.toTextureBytes(), Uint8Array.from(bankRmp));
        assert.equal(initialized.dayNightBlend, phase * 256);
        assert.deepEqual(initialized.visibleTerrain, { bank: 0, brightness: 16, selector: phase * 7 });
        for (const team of teams) {
          const lookup = finBodyPaletteLookup(team.index, 8, initialized.teamSelectors);
          assert.equal(lookup.selector, team.teamColor);
          for (let index = 0; index < 256; index++) {
            assert.equal(initialized.remap.lookup(2, 128 + lookup.selector, index),
              bankRmp[2 * 65536 + (128 + team.teamColor) * 256 + index]);
            for (const brightness of [0, 10, 16]) {
              const row = brightness * 8 + phase * 7;
              assert.equal(initialized.remap.lookup(0, row, index), bankRmp[row * 256 + index]);
            }
          }
        }
      }
    }
  });
}

test("generic initialization still rejects arbitrary banks and invalid phases", () => {
  const scenario = mission("HUMAN");
  for (const terrainBank of ["CUSTOM.BTS", "PALETTE.BTS", "../DESERT.BTS", "DESERT", "DESERT.BTS.extra"]) {
    assert.throws(() => initializeMissionPalette({ ...scenario, terrainBank }, gif, rmp), /Unverified/);
  }
  assert.throws(() => initializeMissionPalette({ ...scenario, rawHeader: ["", "2"] }, gif, rmp), /phase/);
});

test("DESERT initialization fixtures pin the active GIF and native lookup tables", () => {
  for (const [path, expected] of [
    ["DESERT.GIF", "e54c377435e5f40f3526b16b7c2d4f6d4f56eb51a5c2b53080cc092b4b8bd56d"],
    ["DESERT.RGB", "783c399429f9fd9555ec8a79662825bb1caad373125b1f19f6553811efe7a825"],
    ["DESERT.RMP", "450b62c07f54925f17b5e69bb26308f97d3237875b865e130451516e45478216"],
    ["SCENARIO/DESERT.BTS", "3243b51139cb3cf71de9336ee282ba1502c90e2b12520ac1c349965c7f97fc6d"],
  ]) {
    assert.equal(createHash("sha256").update(source(path)).digest("hex"), expected);
  }
});

test("native executable pins selector, FIN brightness, terrain interpolation and SCN phase anchors", () => {
  const exe = source("DC.EXE");
  assert.equal(createHash("sha256").update(exe).digest("hex"), "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  for (const [address, hex] of [
    [0x41be65, "89870001000085c07c0583f8077e09"],
    [0x43628e, "bb10000000"],
    [0x4362a4, "891d6c964700"],
    [0x41bcdd, "c1e00831d2898640050000"],
    [0x453a7e, "f7ffc1e003"],
  ] as const) {
    assert.equal(exe.subarray(address - 0x400c00, address - 0x400c00 + hex.length / 2).toString("hex"), hex);
  }
});

test("SCN selectors retain native team slots and fallback only for out-of-range colors", () => {
  for (let team = 0; team < 8; team++) {
    for (const color of [-2147483648, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 2147483647]) {
      assert.equal(scenarioPaletteSelector(team, color), color >= 0 && color <= 7 ? color : team);
    }
  }
  const selectors = Uint8Array.from([2, 7, 0, 6, 3, 1, 5, 4]);
  for (let owner = 0; owner < 256; owner++) {
    for (let override = 0; override < 256; override++) {
      assert.equal(entityPaletteSelector(owner, override, selectors), selectors[(override === 8 ? owner : override) & 7]);
    }
  }
});

test("both DESERT first missions initialize their own phase and SCN team colors", () => {
  for (const faction of ["HUMAN", "ALIEN"]) {
    const scenario = mission(faction);
    const result = initializeDesertMissionPalette(scenario, gif, rmp);
    const blend = faction === "HUMAN" ? 0 : 256;
    assert.equal(result.dayNightBlend, blend);
    assert.deepEqual(result.visibleTerrain, { bank: 0, brightness: 16, selector: faction === "HUMAN" ? 0 : 7 });
    assert.deepEqual([...result.teamSelectors], scenario.teams.map((team) => team.teamColor));
    assert.deepEqual([...result.palette.slice(0, 3)], [0, 0, 0]);
    assert.deepEqual([...result.palette.slice(765)], [255, 255, 255]);
    assert.deepEqual(result.palette.slice(3, 765), Uint8Array.from(gif.subarray(16, 778)));
    assert.deepEqual(result.remap.toTextureBytes(), Uint8Array.from(rmp));
    for (const team of scenario.teams) {
      assert.deepEqual(finBodyPaletteLookup(team.index, 8, result.teamSelectors), {
        bank: 2, brightness: 16, selector: team.teamColor,
      });
      for (let index = 0; index < 256; index++) {
        const row = 128 + team.teamColor;
        assert.equal(result.remap.lookup(2, row, index), rmp[2 * 65536 + row * 256 + index]);
      }
    }
  }
  assert.deepEqual([...scenarioPaletteSelectors(mission("ALIEN").teams)].slice(0, 2), [2, 7]);
  assert.deepEqual([...scenarioPaletteSelectors(mission("HUMAN").teams)].slice(0, 3), [0, 0, 2]);
});

test("terrain day/night variant is separate from brightness and FIN team colors", () => {
  for (let blend = 0; blend <= 256; blend++) {
    const selector = Math.trunc(7 * blend / 256);
    assert.deepEqual(terrainPaletteLookup(blend, 16), { bank: 0, brightness: 16, selector });
  }
  for (let start = 0; start <= 16; start++) {
    for (let end = 0; end <= 16; end++) {
      for (let pixel = 0; pixel < 32; pixel++) {
        const row = Math.trunc((end * pixel + start * (31 - pixel)) / 31) * 8;
        assert.equal(terrainInterpolatedRow(start, end, pixel, 0), row);
        assert.equal(terrainInterpolatedRow(start, end, pixel, 256), row + 7);
      }
    }
  }
});

test("coverage stays independent of palette zero for background, foreground and compressed literals", () => {
  const result = initializeDesertMissionPalette(mission("HUMAN"), gif, rmp);
  const tables = preparePaletteUpload(result);
  const indices = Uint8Array.from([0, 138, 143, 255]);
  const background = prepareIndexedUpload({ width: 4, height: 1, indices, coverage: { mode: "opaque" } });
  const foreground = prepareIndexedUpload({ width: 4, height: 1, indices, coverage: { mode: "source-zero" } });
  const compressed = prepareIndexedUpload({ width: 4, height: 1, indices, coverage: { mode: "mask", bytes: Uint8Array.from([255, 0, 255, 255]) } });
  assert.equal(lookupIndexedPixel(background, tables, result.visibleTerrain, 0, 0, false)[3], 255);
  assert.equal(lookupIndexedPixel(foreground, tables, result.visibleTerrain, 0, 0, false)[3], 0);
  const body = finBodyPaletteLookup(0, 8, result.teamSelectors);
  assert.equal(lookupIndexedPixel(compressed, tables, body, 0, 0, false)[3], 255);
  assert.equal(lookupIndexedPixel(compressed, tables, body, 1, 0, false)[3], 0);
  assert.equal(lookupIndexedPixel(background, tables, terrainPaletteLookup(0, 0), 1, 0, false)[3], 255);
});

test("initialization rejects unsupported inputs without guessing a palette, team or phase", () => {
  const scenario = mission("HUMAN");
  assert.throws(() => initializeDesertMissionPalette({ ...scenario, terrainBank: "jungle.bts" }, gif, rmp), RangeError);
  assert.throws(() => initializeDesertMissionPalette({ ...scenario, rawHeader: [] }, gif, rmp), RangeError);
  assert.throws(() => scenarioPaletteSelectors(scenario.teams.slice(1)), RangeError);
  assert.throws(() => scenarioPaletteSelectors(scenario.teams.map(() => scenario.teams[0])), RangeError);
  assert.throws(() => entityPaletteSelector(0, 8, new Uint8Array(7)), RangeError);
  assert.throws(() => entityPaletteSelector(0, 8, new Uint8Array(8).fill(8)), RangeError);
  for (const invalid of [-1, 257, NaN, Infinity, 0.5]) {
    assert.throws(() => terrainPaletteLookup(invalid, 16), RangeError);
  }
  assert.throws(() => terrainPaletteLookup(0, 17), RangeError);
  assert.throws(() => terrainInterpolatedRow(16, 16, 32, 0), RangeError);
  assert.throws(() => scenarioPaletteSelector(8, 0), RangeError);
  assert.throws(() => scenarioPaletteSelector(0, 0.5), RangeError);
  assert.throws(() => entityPaletteSelector(256, 8, new Uint8Array(8)), RangeError);
  assert.throws(() => initializeDesertMissionPalette(scenario, gif.subarray(0, 780), rmp), RangeError);
  assert.throws(() => initializeDesertMissionPalette(scenario, gif, rmp.subarray(0, 67584)), RangeError);
});
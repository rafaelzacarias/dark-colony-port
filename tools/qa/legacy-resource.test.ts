import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  advanceLegacyResourceCountdown, changeLegacyResourceRate, extractLegacyResource,
  initializeLegacyResource, scaleLegacyResource,
  type LegacyResourceExtractionInput,
} from "../../src/engine/legacy-resource";
import { parseTriggerScript } from "../extractors/data/triggers";

const scales = { rateScale: 256, reserveScale: 256 };
const source = {
  slot: 152, tileX: 69, tileY: 48, sourceRate: 22, sourceReserve: 12000,
  scales, typeReserve: 0,
};
const extraction: LegacyResourceExtractionInput = {
  reserve: 100, rateWord: 22, nativeCounter: 16, aiField: 0,
  aiMultiplier: 256, creditGate: 1, partner: null,
};

test("all seven original mission02 sources retain rate/reserve, with whole scripts preserved", () => {
  const expected = [
    [88, 72, 0, 3500], [11, 68, 0, 3500], [69, 48, 22, 12000], [53, 27, 15, 7000],
    [4, 80, 25, 9500], [65, 54, 12, 3500], [13, 51, 0, 5000],
  ];
  const rows: number[][] = [];
  for (const [faction, hash, blockCount] of [
    ["HUMAN", "bed27b613d20fb8b2533369d949adb4e90b96922372e7df3e7957140d44c90ab", 20],
    ["ALIEN", "d76d5901cb996a5dc2f3f72349ba0ec334b5b79a851ef519235a0c8eb5bec91e", 12],
  ] as const) {
    const root = new URL(`../../raw_cd/DC/SCENARIO/${faction}/${faction}02`, import.meta.url);
    const scn = readFileSync(new URL(`${root.href}.SCN`));
    assert.equal(createHash("sha256").update(scn).digest("hex"), hash);
    const script = parseTriggerScript(readFileSync(new URL(`${root.href}.TRO`), "utf8"));
    assert.equal(script.length, blockCount);
    const generated = JSON.parse(readFileSync(new URL(
      `../../public/assets/generated/data/triggers/${faction}/${faction}02.json`, import.meta.url,
    ), "utf8"));
    assert.deepEqual(script, generated.blocks);
    for (const line of scn.toString("ascii").split(/\r?\n/)) {
      const fields = line.trim().split(/\s+/).map(Number);
      if (fields.length !== 5 || fields[2] !== 40) continue;
      const [tileX, tileY, , sourceRate, sourceReserve] = fields;
      const result = initializeLegacyResource({ ...source, tileX, tileY, sourceRate, sourceReserve });
      assert.equal(result.owner, 8);
      assert.equal(result.status, 1);
      assert.equal(result.typeId, 40);
      assert.equal(result.countdownWord, 65535);
      assert.equal(result.xQ8, tileX * 256 + 128);
      assert.equal(result.yQ8, tileY * 256 + 128);
      rows.push([tileX, tileY, result.rateWord, result.reserve]);
    }
  }
  assert.deepEqual(rows, expected);
});

test("native signed product wrap, full-width scales, and constructor fallback", () => {
  assert.equal(scaleLegacyResource(15, 128), 7);
  assert.equal(scaleLegacyResource(15, -128), -7);
  assert.equal(scaleLegacyResource(12, 2147483647), 0);
  assert.equal(scaleLegacyResource(1, 65536), 256);
  const scaled = initializeLegacyResource({ ...source, sourceRate: 15, sourceReserve: 12001,
    scales: { rateScale: 128, reserveScale: 128 } });
  assert.equal(scaled.rateWord, 7);
  assert.equal(scaled.reserve, 6000);
  assert.equal(initializeLegacyResource({ ...source, sourceReserve: -1, typeReserve: 789 }).reserve, 789);
  assert.throws(() => initializeLegacyResource({ ...source, sourceRate: -1 }), /non-entity branch/);
  assert.throws(() => scaleLegacyResource(1, NaN), /scale/);
  assert.throws(() => scaleLegacyResource(1, 2147483648), /scale/);
});

test("newrate activation uses literal byte, not scaled result", () => {
  assert.deepEqual(changeLegacyResourceRate(0, 15, 0), { rateWord: 0, activationSound: true });
  assert.deepEqual(changeLegacyResourceRate(0, 0, 256), { rateWord: 0, activationSound: false });
  assert.deepEqual(changeLegacyResourceRate(7, 15, -128), { rateWord: 65529, activationSound: false });
  assert.throws(() => changeLegacyResourceRate(0, 256, 256), /literalRate/);
});

test("source visits follow native animation, occupancy, and signed countdown branches", () => {
  for (const [countdownWord, occupantType, sourceAnimationState, rateWord, next, transition] of [
    [50, null, 0, 22, 50, "reset"], [1, 5, 0, 22, 50, "reset"],
    [50, 6, 0, 22, 49, "waiting"], [0, 6, 0, 22, 0, "waiting"],
    [1, 6, 0, 22, 0, "activate"], [65535, 14, 0, 22, 65534, "activate"],
    [1, 6, 2, 22, 50, "reset"], [1, 6, 0, 0, 1, "dormant"],
  ] as const) {
    const result = advanceLegacyResourceCountdown({ countdownWord, occupantType, sourceAnimationState, rateWord });
    assert.equal(result.countdownWord, next);
    assert.equal(result.transition, transition);
    if (transition === "activate") assert.equal(result.extractorType, occupantType === 6 ? 47 : 48);
  }
});

test("native settlement goldens: cadence, gates, signed rates, depletion, AI, split income", () => {
  const cases: [Partial<LegacyResourceExtractionInput>, number, number, number, string][] = [
    [{ nativeCounter: 15 }, 100, 0, 0, "waiting"],
    [{ nativeCounter: 0 }, 78, 22, 1, "extract"],
    [{ aiField: 1, aiMultiplier: 384 }, 67, 33, 1, "extract"],
    [{ creditGate: 0 }, 78, 0, 0, "extract"],
    [{ reserve: 22 }, 22, 0, 0, "deplete"],
    [{ reserve: 21, nativeCounter: 15 }, 21, 0, 0, "deplete"],
    [{ reserve: 23 }, 1, 22, 1, "extract"],
    [{ reserve: 23, aiField: 1, aiMultiplier: 512 }, -21, 44, 1, "extract"],
    [{ rateWord: 65529 }, 107, -7, 1, "extract"],
    [{ rateWord: 0 }, 100, 0, 1, "extract"],
    [{ rateWord: 25, partner: { typeId: 77, status: 1, creditGate: 1 } }, 75, 12, 1, "extract"],
    [{ rateWord: 25, partner: { typeId: 78, status: 1, creditGate: 0 } }, 75, 12, 1, "extract"],
  ];
  for (const [patch, reserve, credits, cycles, transition] of cases) {
    const input = Object.freeze({ ...extraction, ...patch });
    const result = extractLegacyResource(input);
    assert.equal(result.reserve, reserve);
    assert.equal(result.ownerCreditDelta, credits);
    assert.equal(result.ownerIncomeDelta, credits);
    assert.equal(result.ownerCycleDelta, cycles);
    assert.equal(result.transition, transition);
  }
  const split = extractLegacyResource({ ...extraction, rateWord: 25,
    partner: { typeId: 77, status: 1, creditGate: 1 } });
  assert.equal(split.partnerCreditDelta, 12);
  assert.equal(split.partnerIncomeDelta, 12);
  assert.equal(split.extracted, 25);
  assert.equal(extractLegacyResource({ ...extraction,
    partner: { typeId: 4, status: 1, creditGate: 1 } }).clearPartner, true);
  assert.throws(() => extractLegacyResource({ ...extraction,
    partner: { typeId: 40, status: 1, creditGate: 1 } }), /0x413a9d/);
});
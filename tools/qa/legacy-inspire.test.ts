import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLegacyInspireDamageQ8, applyLegacyInspireWrite, getLegacyInspireChargeGates,
  getLegacyInspireProfile, legacyInspireCentersAim, legacyInspireScanCoordinates,
  resolveLegacyInspireMultiplierQ8, scanLegacyInspireEffect, updateLegacyInspireCounters,
  type LegacyInspireScanInput, type LegacyInspireSlot,
} from "../../src/engine/legacy-inspire";

function fixture(): LegacyInspireScanInput {
  return {
    xQ8: 32 * 256 + 128, yQ8: 32 * 256 + 128, casterSlot: 200, casterTeam: 0,
    visitBudget: 6, width: 64, height: 64,
    ground: Array(64 * 64).fill(1023), air: Array(64 * 64).fill(1023),
    slots: { 201: { team: 0, multiplierQ8: 0, primaryWeapon: 0 } },
    randomTable: Array.from({ length: 256 }, (_, index) => index), randomIndex: 0,
  };
}

function occupied(
  input: LegacyInspireScanInput, deltaX: number, deltaY: number,
  plane: "ground" | "air" = "ground", slot = 201,
): LegacyInspireScanInput {
  const values = Array.from(input[plane]);
  values[(32 + deltaY) * input.width + 32 + deltaX] = slot;
  return { ...input, [plane]: values };
}

test("all eight native caster profiles retain truncated Q8 factors and per-visit budgets", () => {
  for (let typeId = 0; typeId < 106; typeId++) {
    const profile = getLegacyInspireProfile(typeId);
    if (typeId < 69 || typeId > 76) {
      assert.equal(profile, null);
    } else {
      const level = (typeId - 69) % 4;
      assert.deepEqual(profile, {
        capability: 0xc4, recharge: 1,
        multiplierQ8: Math.trunc((130 + level * 10) * 256 / 100), visitBudget: 6 + level * 2,
      });
    }
  }
});

test("charge 32 passes the executor threshold but not the UI threshold", () => {
  for (const charge of [0, 31, 32, 33, 254, 255]) {
    assert.deepEqual(getLegacyInspireChargeGates(charge), {
      uiChargeReady: charge > 32, deployChargeReady: charge >= 32,
    });
  }
});

test("counter masks include zero, saturate charge, and leave expired caster references intact", () => {
  const state = Object.freeze({ charge: 254, timer: 1, casterSlot: 200 });
  for (const counter of [0, 1, 15, 16, 31, 32, 33, 64]) {
    assert.deepEqual(updateLegacyInspireCounters(state, counter, 1), {
      charge: (counter & 31) === 0 ? 255 : 254,
      timer: (counter & 15) === 0 ? 0 : 1, casterSlot: 200,
    });
  }
  assert.deepEqual(updateLegacyInspireCounters({ charge: 255, timer: 0, casterSlot: 200 }, 0, 1), {
    charge: 255, timer: 0, casterSlot: 200,
  });
  assert.equal(updateLegacyInspireCounters(state, 32, 0).charge, 254);
});

test("recharge needs 32/33 qualifying events and duration needs 20 through 35", () => {
  let state = { charge: 0, timer: 0, casterSlot: 200 };
  for (let event = 1; event <= 255; event++) {
    state = updateLegacyInspireCounters(state, 32, 1);
    assert.equal(state.charge, event);
    assert.deepEqual(getLegacyInspireChargeGates(state.charge), {
      uiChargeReady: event >= 33, deployChargeReady: event >= 32,
    });
  }
  for (let duration = 20; duration <= 35; duration++) {
    state = { charge: 0, timer: duration, casterSlot: 200 };
    for (let event = 1; event <= duration; event++) {
      state = updateLegacyInspireCounters(state, 16, 1);
      assert.equal(state.timer, duration - event);
    }
  }
});

test("caller-supplied reset to zero and recipient ordering remain observable", () => {
  const state = { charge: 0, timer: 1, casterSlot: 77 };
  const write = { targetSlot: 201, timer: 20, casterSlot: 200 };
  assert.equal(updateLegacyInspireCounters(updateLegacyInspireCounters(state, 47, 1), 0, 1).timer, 0);
  assert.equal(updateLegacyInspireCounters(applyLegacyInspireWrite(state, write), 0, 1).timer, 19);
  assert.equal(applyLegacyInspireWrite(updateLegacyInspireCounters(state, 0, 1), write).timer, 20);
  assert.deepEqual(state, { charge: 0, timer: 1, casterSlot: 77 });
});

test("all 1804 coordinates follow exact native direction order and Q8 tile conversion", () => {
  const visits = [...legacyInspireScanCoordinates(8320, 8320)];
  const expected: number[][] = [];
  for (let ring = 0; ring <= 10; ring++) {
    for (let transverse = -20; transverse <= 20; transverse++) {
      expected.push([32 - ring, 32 + transverse], [32 + ring, 32 + transverse],
        [32 + transverse, 32 - ring], [32 + transverse, 32 + ring]);
    }
  }
  assert.equal(visits.length, 1804);
  assert.deepEqual(visits, expected);
  assert.deepEqual(visits.slice(164, 168), [[31, 12], [33, 12], [12, 31], [12, 33]]);
  assert.deepEqual([...legacyInspireScanCoordinates(8192, 8447)], visits);
});

test("cross-shaped scan accepts its corners, rejects outside arms, and supports air", () => {
  for (const plane of ["ground", "air"] as const) {
    for (const [deltaX, deltaY, accepted] of [
      [20, 10, 1], [10, 20, 1], [-20, -10, 1], [-10, -20, 1],
      [20, 11, 0], [11, 20, 0], [21, 0, 0],
    ]) {
      const result = scanLegacyInspireEffect(occupied(fixture(), deltaX, deltaY, plane));
      assert.equal(result.writes.length, accepted);
      assert.equal(result.coordinateVisits, 1804);
      assert.equal(result.casterCharge, 0);
    }
  }
});

test("same-team, zero multiplier, and primary weapon predicates alone control target eligibility", () => {
  for (const target of [
    { team: 1, multiplierQ8: 0, primaryWeapon: 0 },
    { team: 0, multiplierQ8: 332, primaryWeapon: 0 },
    { team: 0, multiplierQ8: 0, primaryWeapon: -1 },
  ]) {
    const result = scanLegacyInspireEffect({ ...occupied(fixture(), 0, 0), slots: { 201: target } });
    assert.equal(result.writes.length, 0);
    assert.equal(result.randomIndex, 0);
    assert.equal(result.coordinateVisits, 1804);
    assert.equal(result.casterCharge, 0);
  }
  assert.equal(scanLegacyInspireEffect(occupied(fixture(), 0, 0)).writes.length, 4);
});

test("duplicates refresh timer/reference, RNG advances before lookup and wraps, input stays unchanged", () => {
  const input = { ...occupied(fixture(), 0, 0), randomIndex: 254 };
  const before = structuredClone(input);
  const result = scanLegacyInspireEffect(input);
  assert.deepEqual(result.writes, [35, 20, 21, 22].map((timer) => ({ targetSlot: 201, timer, casterSlot: 200 })));
  assert.equal(result.randomIndex, 2);
  assert.equal(result.remainingBudget, 2);
  assert.equal(result.coordinateVisits, 1804);
  const final = result.writes.reduce(applyLegacyInspireWrite, { charge: 99, timer: 35, casterSlot: 77 });
  assert.deepEqual(final, { charge: 99, timer: 22, casterSlot: 200 });
  assert.deepEqual(input, before);
});

test("dual-plane duplicate fixture exhausts six visits after exactly 83 coordinates", () => {
  const input = occupied(occupied(fixture(), 0, 0), 0, 0, "air");
  const result = scanLegacyInspireEffect(input);
  assert.equal(result.writes.length, 6);
  assert.equal(result.coordinateVisits, 83);
  assert.equal(result.remainingBudget, 0);
  assert.equal(result.randomIndex, 6);
  assert.ok(result.writes.every((write) => write.targetSlot === 201));
});

test("ground precedes air, packed slots mask to ten bits, and budget stops within a cell", () => {
  const input = occupied(occupied(fixture(), 0, -20, "ground", 0x1400 + 201), 0, -20, "air", 202);
  const slots = { ...input.slots, 202: { team: 0, multiplierQ8: 0, primaryWeapon: 1 } };
  assert.deepEqual(scanLegacyInspireEffect({ ...input, slots, visitBudget: 2 }).writes.map((write) => write.targetSlot), [201, 202]);
  const result = scanLegacyInspireEffect({ ...input, slots, visitBudget: 1 });
  assert.equal(result.writes.length, 1);
  assert.equal(result.coordinateVisits, 1);
  assert.equal(result.randomIndex, 1);
});

test("map clipping and both sentinels do not consume RNG or budget", () => {
  const input = { ...fixture(), width: 1, height: 1, xQ8: 255, yQ8: 255,
    ground: [0x400 + 1022], air: [0x800 + 1023], slots: {} };
  assert.deepEqual(scanLegacyInspireEffect(input), {
    casterCharge: 0, writes: [], randomIndex: 0, remainingBudget: 6, coordinateVisits: 1804,
  });
  assert.equal(scanLegacyInspireEffect({ ...input, ground: [201], slots: fixture().slots }).writes.length, 4);
});

test("active combat reads current slot multiplier, including zero, without inventing a lifetime policy", () => {
  const state = { timer: 1, casterSlot: 200 };
  for (const multiplierQ8 of [332, 358, 384, 409, 0]) {
    const slots: Record<number, LegacyInspireSlot> = { 200: { team: 7, multiplierQ8, primaryWeapon: -1 } };
    assert.equal(resolveLegacyInspireMultiplierQ8(state, slots), multiplierQ8);
  }
  assert.equal(resolveLegacyInspireMultiplierQ8({ ...state, timer: 0 }, {}), 256);
  assert.throws(() => resolveLegacyInspireMultiplierQ8(state, {}), /unresolved/);
  assert.equal(legacyInspireCentersAim(0), false);
  assert.equal(legacyInspireCentersAim(1), true);
  assert.equal(legacyInspireCentersAim(35), true);
});

test("damage uses signed Q8 products and truncates after each factor in native order", () => {
  assert.deepEqual([332, 358, 384, 409].map((factor) => applyLegacyInspireDamageQ8(100, 256, factor, 256)), [129, 139, 150, 159]);
  assert.equal(applyLegacyInspireDamageQ8(3, 128, 409, 384), 1);
  assert.equal(applyLegacyInspireDamageQ8(-3, 128, 409, 384), -6);
  assert.equal(applyLegacyInspireDamageQ8(0x7fffffff, 256, 256, 256), -1);
});

test("incomplete scan inputs fail explicitly instead of inventing native state", () => {
  assert.throws(() => scanLegacyInspireEffect({ ...fixture(), visitBudget: 0 }), /positive/);
  assert.throws(() => scanLegacyInspireEffect({ ...fixture(), randomTable: [] }), /256-entry/);
  assert.throws(() => scanLegacyInspireEffect({ ...fixture(), air: [] }), /occupancy/);
  assert.throws(() => scanLegacyInspireEffect({ ...occupied(fixture(), 0, 0), slots: {} }), /missing occupied/);
});
import assert from "node:assert/strict";
import test from "node:test";
import { buildingDamageStage } from "../../src/mission-view";

test("structure damage stages follow DC.EXE 0x414314 thresholds (11/16 and 5/16 of maximum HP)", () => {
  // EXCOPOD 4800 HP: STAND above 3300, BURN above 1500, SCRCH at or below 1500.
  assert.equal(buildingDamageStage(4800, 4800), "stand");
  assert.equal(buildingDamageStage(3301, 4800), "stand");
  assert.equal(buildingDamageStage(3300, 4800), "burn");
  assert.equal(buildingDamageStage(1501, 4800), "burn");
  assert.equal(buildingDamageStage(1500, 4800), "scorch");
  assert.equal(buildingDamageStage(1, 4800), "scorch");
  // Integer shifts truncate like the original: 2400 * 11 >> 4 = 1650, 2400 * 5 >> 4 = 750.
  assert.equal(buildingDamageStage(1651, 2400), "stand");
  assert.equal(buildingDamageStage(1650, 2400), "burn");
  assert.equal(buildingDamageStage(750, 2400), "scorch");
});

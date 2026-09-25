import assert from "node:assert/strict";
import test from "node:test";
import { chooseProduction, parseMissionId } from "./campaign-army";

const unit = (dependency: number, unitType: number, cost: number, enabled = true) =>
  ({ dependency, unitType, cost, enabled, kind: "unit", pending: 0, queued: 0 });

test("army driver: collectors first, then the most expensive affordable combat unit", () => {
  const menu = [unit(21, 14, 1500), unit(23, 8, 350), unit(26, 11, 1000), unit(27, 13, 1500, false)];
  assert.equal(chooseProduction(menu, 2000, 0, 0)?.dependency, 21);
  assert.equal(chooseProduction(menu, 2000, 2, 0)?.dependency, 26);
  assert.equal(chooseProduction(menu, 400, 2, 0)?.dependency, 23);
  assert.equal(chooseProduction(menu, 300, 0, 0), undefined);
  assert.equal(chooseProduction(menu, 5000, 2, 50), undefined);
  const upgrade = { ...unit(66, 5, 2000), kind: "upgrade" };
  assert.equal(chooseProduction([...menu, upgrade], 4500, 2, 12)?.dependency, 66, "surplus credits buy upgrades");
  assert.equal(chooseProduction([...menu, upgrade], 3500, 2, 12)?.dependency, 26, "upgrades keep a 2000 reserve");
  assert.equal(chooseProduction(menu, 1700, 1, 6, 1, 50, 1500)?.dependency, undefined, "a lone collector's replacement price is held back");
  assert.equal(chooseProduction(menu, 1900, 1, 6, 1, 50, 1500)?.dependency, 23);
  assert.equal(chooseProduction([unit(21, 14, 1500, false), unit(23, 8, 350)], 2000, 0, 0)?.dependency, 23,
    "a disabled collector (e.g. ALIEN11) does not block combat production");
});

test("army driver: mission ids", () => {
  assert.deepEqual(parseMissionId("A11"), { faction: "alien", number: 11 });
  assert.deepEqual(parseMissionId("H7"), { faction: "human", number: 7 });
  assert.throws(() => parseMissionId("X1"));
});

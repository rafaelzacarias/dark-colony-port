import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BROWSER_INCOME_INTERCEPTION_SOURCE } from "../../src/engine/browser-income-interception";

test("income interception: source contract pins HUMAN10 deployment and source types without inventing radius", () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const briefing = read("raw_cd/DC/SCENARIO/HUMAN/HUMAN10.TXT");
  assert.match(briefing, /Deploying a.*S\.A\.R\.G\.E\..*near an enemy mining unit will intercept 50%/);
  assert.match(briefing, /does not need to be in visual sight/);
  const units = JSON.parse(read("public/assets/generated/data/units.json")).records;
  const source = BROWSER_INCOME_INTERCEPTION_SOURCE;
  const mobile = units.find((unit: { index: number }) => unit.index === source.mobileType);
  const deployed = units.find((unit: { index: number }) => unit.index === source.deployedType);
  assert.equal(mobile.sprite, source.mobileSprite);
  assert.equal(deployed.sprite, source.deployedSprite);
  assert.equal(mobile.faction, 0);
  assert.equal(deployed.faction, 0);
  assert.equal(deployed.movementSpeed, 0);
  assert.deepEqual(deployed.weapons, [-1, -1, -1]);
  assert.equal(source.radius, null);
  assert.equal(source.acquisition, "DC.EXE 0x417944 ordered-ground-scan-11-22");
  assert.equal(source.requiresVisibility, true);
});
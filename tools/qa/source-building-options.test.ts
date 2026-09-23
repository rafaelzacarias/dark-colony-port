import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseScenario } from "../extractors/data/scenario";
import { sourceBuildingOptions, sourceBuildingRequirements } from "../../src/engine/source-building-options";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const units = JSON.parse(read("public/assets/generated/data/units.json")).records;
const records = JSON.parse(read("public/assets/generated/data/dependencies.json")).records;

for (const [race, faction] of ["HUMAN", "ALIEN"].entries()) {
  test(`source buildings: ${faction} exact fixed slots, costs, levels and research prerequisite`, () => {
    const scenario = parseScenario(read(`raw_cd/DC/SCENARIO/${faction}/${faction}10.SCN`));
    const options = sourceBuildingOptions({ scenario, units }, records);
    const base = options.filter(option => option.level === 0).sort((left, right) => left.building.slot - right.building.slot);
    assert.deepEqual(base.map(option => option.building.unitType), race === 0 ? [16, 17, 18, 20, 22] : [28, 29, 30, 32, 34]);
    assert.deepEqual(base.map(option => option.cost), [2000, 1000, 2000, 2000, 3000]);
    assert.deepEqual(base.map(option => option.maximumLevel), [0, 0, 1, 1, 0]);
    assert.ok(base.every(option => option.building.footprint.length === 4 && option.building.health === option.building.maxHealth));
    const slots = base.map(() => ({ health: 4800, level: 0, busy: 0 }));
    assert.deepEqual(sourceBuildingRequirements(base[4], options, slots), [race === 0 ? 4 : 18]);
    slots[3].level = 1;
    assert.deepEqual(sourceBuildingRequirements(base[4], options, slots), []);
    slots[3].busy = 1;
    assert.deepEqual(sourceBuildingRequirements(base[4], options, slots), [race === 0 ? 4 : 18]);
    slots[3].busy = 0;
    slots[3].health = 0;
    assert.equal(sourceBuildingRequirements(base[4], options, slots).length, 1);
  });
}
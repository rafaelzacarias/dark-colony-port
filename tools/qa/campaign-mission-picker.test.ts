import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { campaignMissionSelection } from "../../src/ui/campaign-mission-picker";

test("mission picker: all 30 selections match indexed source metadata and profiles", () => {
  const identities = new Set<string>();
  for (const faction of ["human", "alien"] as const) {
    for (let number = 1; number <= 15; number += 1) {
      const selected = campaignMissionSelection(faction, number);
      const metadata = JSON.parse(readFileSync(new URL(
        `../../public/assets/generated/data/scenarios/${selected.stem}.json`, import.meta.url), "utf8"));
      assert.equal(metadata.source.path, `${selected.stem}.SCN`);
      assert.equal(metadata.id.toUpperCase(), selected.sourceId);
      assert.equal(selected.runtimeProfile, number === 1 ? undefined : "browser-adapted");
      identities.add(selected.sourceId);
    }
  }
  assert.equal(identities.size, 30);
});

test("mission picker: invalid numbers and traversal never become source paths", () => {
  for (const number of [0, 16, -1, 1.5, NaN, Infinity, "7", "../7", null]) {
    assert.throws(() => campaignMissionSelection("human", number as number), RangeError);
  }
  for (const faction of ["../human", "HUMAN", "", "alien/../human", null]) {
    assert.throws(() => campaignMissionSelection(faction as "human", 1), RangeError);
  }
});
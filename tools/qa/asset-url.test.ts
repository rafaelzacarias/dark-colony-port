import assert from "node:assert/strict";
import test from "node:test";
import { assetUrl } from "../../src/asset-url";

test("asset URLs support local, project Pages and custom-domain bases", () => {
  assert.equal(assetUrl("/assets/generated/data/units.json"), "/assets/generated/data/units.json");
  for (const base of ["/darkcolony/", "/darkcolony"]) {
    assert.equal(assetUrl("/assets/generated/data/units.json", base), "/darkcolony/assets/generated/data/units.json");
  }
  assert.equal(assetUrl("/assets/data/campaign-intro-human.json", "/"), "/assets/data/campaign-intro-human.json");
  assert.equal(assetUrl("/assets/generated/media/", "./"), "./assets/generated/media/");
  assert.throws(() => assetUrl("https://other.example/file"), /application asset path/);
});
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { installSourceRender } from "./fixtures/source-render";

test("M02 winning boundary: exact saved public continuation", { skip: !process.env.DC_M02_WINNING_DIR }, async () => {
  const source = process.env.DC_M02_WINNING_DIR!;
  const before = JSON.parse(readFileSync(join(source, "before-ready.json"), "utf8"));
  const final = JSON.parse(readFileSync(join(source, "checkpoint.json"), "utf8"));
  const output = mkdtempSync("/tmp/dc-winning-boundary-");
  console.log(JSON.stringify({ output }));
  const renderer = installSourceRender(), originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input);
    assert.ok(url.startsWith("/assets/generated/") && !url.includes(".."));
    return new Response(readFileSync(new URL(`../../public${url}`, import.meta.url)));
  };
  let view: MissionView | undefined;
  try {
    const mission = await loadCampaignMission(final.strategy.faction, 2, "browser-adapted");
    assert.equal(createHash("sha256").update(JSON.stringify(mission)).digest("hex"), before.sourceHash);
    assert.equal(before.sourceHash, final.sourceHash);
    view = MissionView.restore(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission, before.checkpoint);
    assert.deepEqual(view.checkpoint(), before.checkpoint);
    await view.initialize();
    renderer.setEnabled(false);
    view.resetClock();
    view.update(0);
    const count = final.strategy.tick - before.tick;
    assert.ok(count > 0 && count <= 1000);
    for (let offset = 1; offset <= count; offset++) view.update(offset * 50);
    renderer.setEnabled(true);
    view.render();
    const actual = view.checkpoint();
    writeFileSync(join(output, "actual.json"), JSON.stringify(actual));
    assert.deepEqual(view.missionOutcome, { resultCode: 0, reasonCode: 1, ready: true });
    const differentKeys = Object.keys(final.view).filter(key =>
      JSON.stringify(actual[key as keyof typeof actual]) !== JSON.stringify(final.view[key]));
    writeFileSync(join(output, "result.json"), JSON.stringify({ before: before.tick, ready: final.strategy.tick,
      count, differentKeys, outcome: view.missionOutcome }));
    assert.deepEqual(differentKeys, []);
    assert.deepEqual(actual, final.view);
  } finally {
    view?.dispose(); renderer.dispose(); globalThis.fetch = originalFetch;
  }
});
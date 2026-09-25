import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CampaignSession } from "../../src/engine/campaign-session";
import { MissionView } from "../../src/mission-view";
import { baseMenuEntries } from "../../src/ui/base-menu";
import { loadReleaseMission } from "./fixtures/release-mission";

for (const [faction, number] of [["human", 2], ["alien", 2], ["human", 10]] as const) {
  test(`${faction} ${number}: repeated HUD reads never copy the accumulated replay history`, async context => {
    context.mock.method(globalThis, "fetch", async (input: string | URL | Request) =>
      new Response(readFileSync(new URL(`../../public${String(input)}`, import.meta.url))));
    const mission = await loadReleaseMission(faction, number);
    const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
    const view = new MissionView(canvas, {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
    try {
      view.enableDiagonalGroundMovement();
      view.update(0);
      for (let tick = 1; tick <= 20; tick++) view.update(tick * 50);
      assert.equal(view.missionDiagnostic, undefined);
      const saved = view.checkpoint();
      const expected = { construction: view.constructionMenu, production: view.productionMenu,
        resources: view.resourceSources, entries: baseMenuEntries(view) };
      const read = Object.getOwnPropertyDescriptor(CampaignSession.prototype, "snapshot")!.get!;
      let fullCopies = 0;
      const getter = context.mock.getter(CampaignSession.prototype, "snapshot", function(this: CampaignSession) {
        fullCopies++;
        return read.call(this);
      });
      for (let frame = 0; frame < 60; frame++) {
        assert.deepEqual({ construction: view.constructionMenu, production: view.productionMenu,
          resources: view.resourceSources, entries: baseMenuEntries(view) }, expected);
      }
      assert.equal(fullCopies, 0, "HUD updates must use bounded current-state projections, not full saved-session copies");
      getter.mock.restore();
      assert.deepEqual(view.checkpoint(), saved, "HUD reads do not mutate simulation, history, or production state");
      const restored = MissionView.restore(canvas, {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission,
        JSON.parse(JSON.stringify(saved)));
      assert.deepEqual(restored.checkpoint(), saved);
      assert.deepEqual(baseMenuEntries(restored), expected.entries);
      restored.dispose();
    } finally { view.dispose(); }
  });
}

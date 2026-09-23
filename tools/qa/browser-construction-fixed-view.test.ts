import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { campaignConstructionPolicy, loadCampaignMission } from "../../src/game-data";
import { MissionView, missionVisualSprites } from "../../src/mission-view";
import { installSourceRender } from "./fixtures/source-render";

test("fixed view policy: new missions and saved absent, v1 and exact v2 capabilities", () => {
  assert.equal(campaignConstructionPolicy("alien", 3, "browser-adapted"), undefined);
  assert.equal(campaignConstructionPolicy("human", 10), undefined);
  assert.deepEqual(campaignConstructionPolicy("human", 4, "browser-adapted"), { completionVisits: 120, supportedSlots: [1, 2, 3, 4], supportedActions: ["purchase", "upgrade"] });
  assert.deepEqual(campaignConstructionPolicy("alien", 10, "browser-adapted")?.supportedSlots, [0, 1, 2, 3, 4]);
  assert.equal(campaignConstructionPolicy("human", 10, "browser-adapted", { session: { options: {} } }), undefined);
  const saved = (supportedSlots?: number[]) => ({ session: { options: { browserConstruction: {
    policy: { completionVisits: 120 }, ...(supportedSlots ? { supportedSlots } : {}),
  } } } });
  assert.deepEqual(campaignConstructionPolicy("alien", 10, "browser-adapted", saved()), { completionVisits: 120 });
  assert.deepEqual(campaignConstructionPolicy("human", 10, "browser-adapted", saved([3])), { completionVisits: 120, supportedSlots: [3] });
});

for (const faction of ["human", "alien"] as const) {
  test(`fixed view: ${faction} paid laboratory, fixed footprint, producer access and exact restore`, async context => {
    const renderer = installSourceRender();
    context.mock.method(globalThis, "fetch", async (input: string | URL | Request) =>
      new Response(Uint8Array.from(readFileSync(new URL(`../../public${String(input)}`, import.meta.url))).buffer));
    const views: MissionView[] = [];
    try {
      const missionNumber = faction === "human" ? 10 : 3;
      const mission = await loadCampaignMission(faction, missionNumber, "browser-adapted", { completionVisits: 120, supportedSlots: [1, 2, 3, 4] });
      const callbacks = { onStats() {}, onUnitsChanged() {} };
      let view = new MissionView(renderer.canvas(), {} as HTMLElement, callbacks, mission);
      views.push(view);
      await view.initialize();
      renderer.setEnabled(false);
      let clock = 0;
      view.update(0);
      const step = () => { view.update(clock += 50); assert.equal(view.missionDiagnostic, undefined); };
      const roundTrip = () => {
        const checkpoint = view.checkpoint();
        const restored = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(checkpoint)));
        views.push(restored);
        assert.deepEqual(restored.checkpoint(), checkpoint);
        view = restored;
        clock = 0;
        view.resetClock();
        view.update(0);
      };
      const laboratory = view.constructionMenu.find(choice => "slot" in choice && choice.slot === 3)!;
      assert.ok("cost" in laboratory && "slot" in laboratory);
      assert.equal(laboratory.requestEnabled, true);
      assert.equal(laboratory.cost, 2000);
      const research = view.constructionMenu.find(choice => "slot" in choice && choice.slot === 4)!;
      assert.equal(research.requestEnabled, false);
      assert.match(research.reason, faction === "human" ? /level-1 laboratory/ : /Source restriction/);
      assert.equal(view.purchaseConstruction(research.dependency), false);
      assert.equal(view.purchaseConstruction(laboratory.dependency), true);
      assert.equal(view.purchaseConstruction(laboratory.dependency), false);
      assert.equal(view.constructionMenu.find(choice => choice.dependency === laboratory.dependency)!.reason, "Purchase queued");
      roundTrip();
      step();
      assert.equal(view.resourceWorkflow.credits[0], mission.scenario.teams[0].money - 2000);
      const binding = view.nativeBindings.find(binding => binding.slot === 3)!;
      const building = mission.browserConstruction!.buildings!.find(option => option.level === 0 && option.building.slot === 3)!.building;
      assert.ok(missionVisualSprites(mission).includes(mission.units.find(unit => unit.index === building.unitType)!.sprite));
      const target = view.simulation.checkpoint().staticTargets.find(target => target.id === binding.simulationId)!;
      assert.equal(target.health, building.maxHealth);
      assert.equal(target.xSubcells, building.nativePosition.x * 4);
      assert.equal(target.ySubcells, building.nativePosition.y * 4);
      assert.deepEqual(target.footprint, building.footprint.map(cell => cell.y * view.grid.width + cell.x));
      assert.equal(view.campaignSnapshot!.production!.teams[0].costAccumulator, 2000);
      assert.equal(view.campaignSnapshot!.production!.teams[0].slots[3].busy, 1);
      assert.equal(view.campaignSnapshot!.browserConstruction!.slots![3].elapsedVisits, 0);
      roundTrip();
      for (let visit = 0; visit < 119; visit++) step();
      assert.equal(view.campaignSnapshot!.production!.teams[0].slots[3].busy, 1);
      step();
      assert.equal(view.campaignSnapshot!.production!.teams[0].slots[3].busy, 0);
      assert.equal(view.constructionMenu.find(choice => choice.dependency === laboratory.dependency)!.status, "complete");
      assert.equal(view.constructionMenu.find(choice => choice.dependency === research.dependency)!.requestEnabled, false);
      assert.equal(view.campaignSnapshot!.world.buildingSlots["0,3"], building.maxHealth);
      assert.ok(view.productionMenu.some(choice => choice.enabled), "Existing production remains available after construction");
      roundTrip();
      const narrower = await loadCampaignMission(faction, missionNumber, "browser-adapted", { completionVisits: 120, supportedSlots: [3] });
      assert.throws(() => MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, narrower, view.checkpoint()), /Invalid MissionView checkpoint/);
      assert.equal(view.nativeBindings.filter(binding => binding.slot === 3).length, 1);
    } finally {
      for (const view of views) view.dispose();
      renderer.dispose();
    }
  });
}
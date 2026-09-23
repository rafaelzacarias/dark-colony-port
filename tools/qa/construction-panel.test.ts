import assert from "node:assert/strict";
import test from "node:test";
import { ArrowUp, Hammer } from "lucide";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { constructionChoicePresentation } from "../../src/ui/construction-panel";
import { fundedBuildingUpgradeFetch } from "./fixtures/building-upgrades";
import { installSourceRender } from "./fixtures/source-render";

test("construction panel: source-priced purchase/upgrade labels, icons, disabled guards and dependency dispatch", async context => {
  context.mock.method(globalThis, "fetch", fundedBuildingUpgradeFetch);
  const renderer = installSourceRender();
  let view: MissionView | undefined;
  try {
    const mission = await loadCampaignMission("alien", 4, "browser-adapted", {
      completionVisits: 120, supportedSlots: [1, 2, 3, 4], supportedActions: ["purchase", "upgrade"],
    });
    view = new MissionView(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
    assert.equal(view.missionDiagnostic, undefined);
    const menu = view.constructionMenu.filter(choice => "cost" in choice);
    const labels = new Set<string>();
    for (const choice of menu) {
      const presentation = constructionChoicePresentation(choice);
      assert.equal(labels.has(presentation.action), false);
      labels.add(presentation.action);
      assert.equal(presentation.icon, choice.action === "upgrade" ? ArrowUp : Hammer);
      assert.equal(choice.cost, mission.browserConstruction!.buildings!.find(option => option.dependency === choice.dependency)!.cost);
      if (choice.action === "upgrade") assert.match(presentation.name, /level 1$/);
    }
    const purchase = menu.find(choice => choice.slot === 3 && choice.action === "purchase")!;
    const upgrade = menu.find(choice => choice.slot === 3 && choice.action === "upgrade")!;
    assert.equal(purchase.cost, upgrade.cost);
    assert.equal(purchase.requestEnabled, false);
    assert.equal(purchase.status, "complete");
    assert.equal(upgrade.status, "unbuilt");
    assert.equal(upgrade.requestEnabled, true);
    assert.equal(constructionChoicePresentation(upgrade).action, "Upgrade science laboratory");
    assert.equal(view.purchaseConstruction(purchase.dependency), false);
    assert.equal(view.purchaseConstruction(upgrade.dependency), true);
    assert.equal(view.checkpoint().state.pendingConstruction, upgrade.dependency);
    assert.equal(view.purchaseConstruction(upgrade.dependency), false);
    assert.equal(view.constructionMenu.find(choice => choice.dependency === upgrade.dependency)!.reason, "Upgrade queued");
  } finally {
    view?.dispose(); renderer.dispose();
  }
});
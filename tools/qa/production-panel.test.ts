import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import type { LegacyProductionSourceRecord } from "../../src/engine/legacy-production";
import { productionChoicePresentation } from "../../src/ui/production-panel";
import { Plus, Shield, Sword } from "lucide";
import { installSourceRender } from "./fixtures/source-render";

for (const faction of ["human", "alien"] as const) {
  test(`production portraits: actual ${faction}03 preloads and draws every admitted profile`, async context => {
    const renderer = installSourceRender();
    context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
      const path = String(input);
      assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
      return new Response(readFileSync(new URL(`../../public${path}`, import.meta.url)));
    });
    let view: MissionView | undefined;
    try {
      const mission = await loadCampaignMission(faction, 3, "browser-adapted");
      view = new MissionView(renderer.canvas(), {} as HTMLElement,
        { onStats() {}, onUnitsChanged() {} }, mission);
      await view.initialize();
      assert.equal(view.missionDiagnostic, undefined);
      const production = mission.sourceProduction!.production;
      assert.ok(production);
      const profiles = [...production.adaptedCollectorProfiles!, ...production.adaptedUnitProfiles!];
      const menu = view.productionMenu;
      assert.equal(menu.filter(choice => choice.kind === "unit").length, 6);
      assert.equal(menu.filter(choice => choice.kind === "upgrade").length, 24);
      const labels = new Set<string>();
      for (const profile of profiles) {
        assert.ok(menu.some(choice => choice.unitType === profile.unitType), `profile ${profile.unitType} in menu`);
      }
      for (const choice of menu) {
        const presentation = productionChoicePresentation(view, choice);
        assert.ok(!labels.has(presentation.action), `Distinct action: ${presentation.action}`);
        labels.add(presentation.action);
        if (choice.kind === "upgrade") {
          const record: LegacyProductionSourceRecord = production.records.find(entry => entry.id === choice.dependency)!;
          const channel: "weapon" | "armor" = record.rawFields[2] === 0 ? "weapon" : "armor";
          assert.equal(presentation.action, `Upgrade ${channel}: ${choice.sprite}, level ${record.rawFields[3]}`);
          assert.equal(presentation.name, `${choice.sprite} ${channel} ${record.rawFields[3]}`);
          assert.equal(presentation.icon, channel === "weapon" ? Sword : Shield);
          continue;
        }
        assert.equal(presentation.action, `Produce ${choice.sprite}`);
        assert.equal(presentation.icon, Plus);
        const portrait = renderer.canvas();
        portrait.width = 48;
        portrait.height = 48;
        const before = renderer.evidence().imageDraws;
        view.renderProductionPortrait(portrait, choice.dependency);
        assert.ok(renderer.evidence().imageDraws > before, `${choice.sprite} must draw into its portrait`);
      }
      assert.ok(!renderer.evidence().warnings.some(warning => warning.includes("missing-production-art")));
      context.diagnostic(JSON.stringify({ faction, sprites: menu.map(choice => choice.sprite),
        scope: "source asset preload and drawing calls; browser harness verifies RGBA" }));
    } finally {
      view?.dispose();
      renderer.dispose();
    }
  });
}
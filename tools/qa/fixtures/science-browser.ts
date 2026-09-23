import { MissionView } from "../../../src/mission-view";
import { nativeConstructionRegisteredSlots } from "../../../src/engine/native-construction-host";
import { createScienceConstructionFixture, loadScienceNativeInput, scienceConstructionFixtureLabel } from "./science-construction";

export async function createScienceBrowserFixture(race: 0 | 1) {
  const mission = await createScienceConstructionFixture(race, await loadScienceNativeInput(), undefined, { observer: true });
  const stage = document.createElement("section");
  stage.id = "science-qa";
  stage.style.cssText = "position:fixed;inset:0;z-index:99999;background:#111;display:grid;place-content:center;color:white;padding:12px";
  const label = document.createElement("p");
  label.textContent = `${scienceConstructionFixtureLabel}; optional local QA observer`;
  label.style.cssText = "max-width:512px;font-size:14px;line-height:1.4";
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 452;
  canvas.style.cssText = "width:512px;max-width:100%;height:auto;image-rendering:pixelated";
  stage.append(label, canvas);
  document.body.append(stage);
  const callbacks = { onStats() {}, onUnitsChanged() {} };
  const view = new MissionView(canvas, stage, callbacks, mission);
  const input = (science = false) => {
    const state = view.campaignSnapshot!, ai = state.campaignAi!, buffers = ai.buffers;
    return { constructionVisits: state.production!.constructionHosts!.filter(host => host.receiptId && !host.ready).map(host => ({
      team: host.configuration.team, visit: { sequence: host.visits, counter: 4, mainHealth: 2400,
        auxiliaryHealth: host.actors[6]?.health ?? 0, registeredSlots: nativeConstructionRegisteredSlots(host) } })),
      ...(science ? { campaignAiRequest: { id: "science", sourceId: ai.sourceId, sequence: ai.history.length,
        stage: "demand" as const, observation: { entities: buffers.entities, forceOrder: buffers.forceOrder,
          population: 6, populationLimit: 10, relations: buffers.relations,
          visibilityMasks: buffers.visibilityMasks, occupancy: buffers.occupancy } } } : {}) };
  };
  try {
    await view.initialize();
    if (view.missionDiagnostic) throw new Error(String(view.missionDiagnostic));
    view.advanceConstruction(input(true));
    view.setCameraCenter(34, 34);
  } catch (error) {
    view.dispose();
    stage.remove();
    throw error;
  }
  return {
    view,
    advanceTo(visits: number) {
      while (view.constructionMenu[0].visits < visits) view.advanceConstruction(input());
      view.render();
      if (view.missionDiagnostic) throw new Error(String(view.missionDiagnostic));
      const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      let colored = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset] + pixels[offset + 1] + pixels[offset + 2] > 30) colored++;
      }
      return { colored, menu: view.constructionMenu, visuals: view.constructionVisuals };
    },
    verifyRestore() {
      const saved = JSON.stringify(view.checkpoint());
      const restored = MissionView.restore(document.createElement("canvas"), document.createElement("div"), callbacks, mission, JSON.parse(saved));
      const equal = JSON.stringify(restored.checkpoint()) === saved;
      restored.dispose();
      let rejected = false;
      try { view.advanceConstruction({ constructionVisits: [] }); } catch { rejected = true; }
      return { equal, rejected, unchanged: saved === JSON.stringify(view.checkpoint()) };
    },
    dispose() { view.dispose(); stage.remove(); },
  };
}
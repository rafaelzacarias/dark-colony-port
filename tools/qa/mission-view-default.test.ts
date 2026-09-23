import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MissionView } from "../../src/mission-view";
import { CampaignSession } from "../../src/engine/campaign-session";
import { measureDefaultMission } from "./mission-view-default.perf";
import { createScienceConstructionFixture, loadScienceNativeInput } from "./fixtures/science-construction";

test("default AL01: initialized 120-frame movement/render has bounded snapshot reads and unchanged state", async () => {
  const result = await measureDefaultMission();
  assert.equal(result.updateWithRender.count, 120);
  assert.equal(result.render.count, 120);
  assert.equal(result.playerUnits, 5);
  assert.equal(result.entities, 52);
  assert.equal(result.frameCounters["session.snapshot"].calls, 240);
  assert.equal(result.renderCounters["session.snapshot"].calls, 1);
  assert.equal(result.renderCounters["simulation.snapshot"].calls, 1);
  assert.equal(result.selectionCounters["session.snapshot"].calls, 1);
  assert.equal(result.frameCounters["view.renderBoundedMode3"], undefined);
  assert.equal(result.callbackCount, 120);
  assert.equal(result.spriteDraws, 524);
  assert.equal(result.stateHash, "fd1b71694fa374f628c14b4af2e65f52dbd81a27c7d620eb1987d91e01509544");
});

test("construction visuals: configured actors stay live, detached and validated using one snapshot", async () => {
  const loadBytes = (url: URL) => readFileSync(url);
  const data = await createScienceConstructionFixture(0, await loadScienceNativeInput(loadBytes), loadBytes);
  const canvas = { width: 512, height: 452, getContext: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) } as unknown as HTMLCanvasElement;
  const view = new MissionView(canvas, {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, data);
  assert.equal(view.missionDiagnostic, undefined);
  const state = view.campaignSnapshot!, ai = state.campaignAi!, buffers = ai.buffers;
  view.advanceConstruction({ constructionVisits: [], campaignAiRequest: {
    id: "visual-performance-regression", sourceId: ai.sourceId, sequence: ai.history.length, stage: "demand",
    observation: { entities: buffers.entities, forceOrder: buffers.forceOrder, population: 6, populationLimit: 10,
      relations: buffers.relations, visibilityMasks: buffers.visibilityMasks, occupancy: buffers.occupancy },
  } });
  const descriptor = Object.getOwnPropertyDescriptor(CampaignSession.prototype, "snapshot")!;
  let reads = 0, corrupt = false;
  Object.defineProperty(CampaignSession.prototype, "snapshot", { ...descriptor, get(this: CampaignSession) {
    reads += 1;
    const current: CampaignSession["snapshot"] = descriptor.get!.call(this);
    const snapshot = corrupt ? structuredClone(current) : current;
    if (corrupt) {
      const actor = snapshot.production!.constructionHosts![0].actors.find(actor => actor?.registered)!;
      Object.assign(actor, { health: actor.health + 1 });
    }
    return snapshot;
  } });
  try {
    const actors = view.constructionVisuals;
    assert.ok(actors.length > 0);
    assert.equal(reads, 1);
    const originalHealth = actors[0].health;
    Object.assign(actors[0], { health: originalHealth - 1 });
    assert.equal(view.constructionVisuals[0].health, originalHealth);
    assert.equal(reads, 2);
    corrupt = true;
    assert.throws(() => view.constructionVisuals, /Construction scene does not match committed source host/);
    assert.equal(reads, 3);
  } finally {
    Object.defineProperty(CampaignSession.prototype, "snapshot", descriptor);
    view.dispose();
  }
});
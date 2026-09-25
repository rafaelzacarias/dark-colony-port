import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MissionView } from "../../src/mission-view";
import { loadReleaseMission } from "./fixtures/release-mission";
import { installSourceRender } from "./fixtures/source-render";

const root = new URL("../../", import.meta.url);

test("browser-adapted purchases: a unit and a building bought in one tick never exceed the credits", async () => {
  const renderer = installSourceRender(); renderer.setEnabled(false);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => new Response(readFileSync(new URL(`public${String(input)}`, root)))) as typeof fetch;
  try {
    const view = new MissionView(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, await loadReleaseMission("human", 9));
    await view.initialize();
    view.resetClock(); view.update(0);
    let clock = 0;
    const buys: Record<number, number> = { 0: 7, 40: 9, 80: 9, 120: 9, 160: 7 };
    while (view.simulation.snapshot.tick < 200) {
      const tick = view.simulation.snapshot.tick;
      if (buys[tick] !== undefined) assert.equal(view.purchaseProduction(buys[tick]), true);
      if (tick === 160) assert.equal(view.purchaseConstruction(2), false, "the laboratory no longer fits after the collector");
      view.update(clock += 50);
      assert.equal(view.missionDiagnostic, undefined);
      assert.equal(view.simulation.snapshot.tick, tick + 1);
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("browser-adapted production: an idle unit parked on the exit does not stall the next unit", async () => {
  const renderer = installSourceRender(); renderer.setEnabled(false);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => new Response(readFileSync(new URL(`public${String(input)}`, root)))) as typeof fetch;
  try {
    const view = new MissionView(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, await loadReleaseMission("human", 10));
    await view.initialize();
    const produced = () => view.nativeBindings.filter(binding => binding.key.startsWith("transport:")
      && view.isOwnedUnit(binding.simulationId)).length;
    assert.equal(produced(), 0);
    assert.equal(view.purchaseProduction(9), true);
    view.resetClock(); view.update(0);
    let clock = 0;
    while (view.simulation.snapshot.tick < 40) view.update(clock += 50);
    assert.equal(view.purchaseProduction(9), true);
    // The first TRSC idles on the barracks exit; before the fix the second stayed queued forever.
    while (view.simulation.snapshot.tick < 2000) view.update(clock += 50);
    assert.ok(produced() >= 2, `produced ${produced()}`);
    assert.equal(view.productionMenu.find(choice => choice.dependency === 9)?.queued, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

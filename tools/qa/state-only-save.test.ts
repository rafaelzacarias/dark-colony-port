import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { STATE_ONLY_HISTORY_POLICY } from "../../src/engine/campaign-session";
import { installSourceRender } from "./fixtures/source-render";

test("state-only saves restore without replay and continue exactly like a full-history restore", async () => {
  const renderer = installSourceRender(), originalFetch = globalThis.fetch;
  globalThis.fetch = async input => new Response(readFileSync(new URL(`../../public${String(input)}`, import.meta.url)));
  const callbacks = { onStats() {}, onUnitsChanged() {} };
  try {
    const mission = await loadCampaignMission("human", 2, "browser-adapted");
    const view = new MissionView(renderer.canvas(), {} as HTMLElement, callbacks, mission);
    await view.initialize();
    renderer.setEnabled(false);
    let time = 0;
    const advance = (target: MissionView, ticks: number, start: number) => {
      let clock = start;
      for (let tick = 0; tick < ticks; tick++) { clock += 50; target.update(clock); }
      return clock;
    };
    time = advance(view, 400, time);
    assert.equal(view.missionDiagnostic, undefined);

    const full = view.checkpoint(), compact = view.checkpoint({ stateOnly: true });
    assert.ok(full.session!.state.aiSelectorInputs!.length > 0);
    assert.equal(full.session!.historyPolicy, undefined);
    assert.equal(compact.session!.historyPolicy, STATE_ONLY_HISTORY_POLICY);
    assert.deepEqual(compact.session!.state.aiSelectorInputs, []);
    assert.match(compact.session!.stateDigest!, /^[0-9a-f]{64}$/);
    assert.ok(JSON.stringify(compact).length * 2 < JSON.stringify(full).length, "state-only save should be much smaller");

    const fromFull = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, structuredClone(full));
    const fromCompact = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, structuredClone(compact));
    await fromFull.initialize();
    await fromCompact.initialize();
    advance(fromFull, 300, time);
    advance(fromCompact, 300, time);
    assert.equal(fromCompact.missionDiagnostic, undefined);
    // A session restored from a state-only save cannot rebuild history, so its own saves stay state-only.
    const resaved = fromCompact.checkpoint();
    assert.equal(resaved.session!.historyPolicy, STATE_ONLY_HISTORY_POLICY);
    assert.deepEqual(resaved, fromFull.checkpoint({ stateOnly: true }));
    const reloaded = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, structuredClone(resaved));
    assert.equal(reloaded.simulation.snapshot.tick, fromCompact.simulation.snapshot.tick);

    const corrupted = structuredClone(compact);
    (corrupted.session!.state.controller.runtime.statistics as Record<string, number>)["0,1"] += 1;
    assert.throws(() => MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, corrupted), /corrupted/);
    const { historyPolicy: _policy, ...withoutPolicy } = structuredClone(compact.session!);
    assert.throws(() => MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission,
      { ...structuredClone(compact), session: withoutPolicy }), /State-only checkpoint/);
  } finally {
    globalThis.fetch = originalFetch;
    renderer.dispose();
  }
});

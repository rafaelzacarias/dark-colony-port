import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { serialize } from "node:v8";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { createBrowserCampaignPlaythrough, type BrowserPlaythroughEvent } from "./fixtures/browser-campaign-playthrough";
import { installSourceRender } from "./fixtures/source-render";

for (const faction of ["human", "alien"] as const) {
  test(`M02 observation: ${faction} bounded original snapshot and output equivalence`, async context => {
    const renderer = installSourceRender(), originalFetch = globalThis.fetch;
    const snapshotGetter = Object.getOwnPropertyDescriptor(MissionView.prototype, "campaignSnapshot")!.get!;
    const events: BrowserPlaythroughEvent[] = [];
    const readsByTick = new Map<number, number>();
    const ticks = Number(process.env.DC_M02_OBSERVATION_TICKS ?? 240);
    assert.ok(Number.isSafeInteger(ticks) && ticks >= 120 && ticks <= 1000 && ticks % 20 === 0);
    let view: MissionView | undefined;
    let reads = 0, bytes = 0, cloneMs = 0;
    globalThis.fetch = async input => {
      const url = String(input);
      assert.ok(url.startsWith("/assets/generated/") && !url.includes(".."), url);
      return new Response(readFileSync(new URL(`../../public${url}`, import.meta.url)));
    };
    try {
      const mission = await loadCampaignMission(faction, 2, "browser-adapted");
      view = new MissionView(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
      await view.initialize();
      renderer.setEnabled(false);
      Object.defineProperty(view, "campaignSnapshot", { configurable: true, get() {
        const tick = view!.simulation.snapshot.tick;
        readsByTick.set(tick, (readsByTick.get(tick) ?? 0) + 1);
        const started = performance.now();
        const snapshot = snapshotGetter.call(view) as NonNullable<MissionView["campaignSnapshot"]>;
        cloneMs += performance.now() - started;
        reads++;
        bytes += serialize(snapshot).byteLength;
        return snapshot;
      } });
      const runner = createBrowserCampaignPlaythrough(view, { maxTicks: ticks, onEvent(event) {
        const copy = structuredClone(event);
        if (copy.kind === "progress") delete (copy.data as { elapsedMs?: number }).elapsedMs;
        events.push(copy);
        if (event.kind === "statistics") {
          const snapshot = snapshotGetter.call(view) as NonNullable<MissionView["campaignSnapshot"]>;
          const statistics = snapshot.controller.runtime.statistics;
          assert.deepEqual(event.data, { values: Object.fromEntries(Object.entries(statistics).filter(([, value]) => value)),
            goal: statistics[faction === "human" ? "2,3" : "1,0,86"] ?? 0, buildingSlots: snapshot.world.buildingSlots });
        }
        if (event.kind === "resource-delivery") {
          const snapshot = snapshotGetter.call(view) as NonNullable<MissionView["campaignSnapshot"]>;
          assert.equal((event.data as { published: number }).published, snapshot.browserEconomyLedger?.earned[0] ?? 0);
        }
        if (event.kind === "progress") {
          const snapshot = snapshotGetter.call(view) as NonNullable<MissionView["campaignSnapshot"]>;
          const progress = event.data as { lives: unknown; publishedIncome: number; objective: { statistic: string; value: number } };
          assert.deepEqual(progress.lives, snapshot.controller.runtime.lives);
          assert.equal(progress.publishedIncome, snapshot.browserEconomyLedger?.earned[0] ?? 0);
          assert.equal(progress.objective.value, snapshot.controller.runtime.statistics[progress.objective.statistic] ?? 0);
        }
      } });
      const summaries = [];
      for (let batch = 0; batch < ticks / 20; batch++) summaries.push(await runner.step(20));
      assert.equal(view.missionDiagnostic, undefined);
      assert.equal(summaries.at(-1)!.tick, ticks);
      assert.notEqual(summaries.at(-1)!.status, "FAIL");
      const snapshot = snapshotGetter.call(view) as NonNullable<MissionView["campaignSnapshot"]>;
      const result = summaries.at(-1)!;
      assert.equal(result.objective.value, snapshot.controller.runtime.statistics[result.objective.statistic] ?? 0);
      assert.equal(result.publishedIncome, snapshot.browserEconomyLedger?.earned[0] ?? 0);
      assert.equal(result.credits, snapshot.world.exomoney[0]);
      assert.deepEqual(events.filter(event => event.kind === "ai-selector").map(event => event.data), snapshot.world.aiSelectors!.events);
      for (const [tick, count] of readsByTick) {
        const budget = tick === 0 || tick === ticks ? 2 : tick % 20 === 0 ? 3 : 1;
        assert.ok(count <= budget, `tick ${tick}: ${count} full reads exceed observation/plan/summary budget ${budget}`);
      }
      const exact = JSON.parse(JSON.stringify({ events, summaries, strategy: runner.checkpoint(),
        checkpoint: view.checkpoint(), journal: view.campaignJournal }));
      const baseline = process.env.DC_M02_OBSERVATION_BASELINE;
      if (baseline) assert.deepEqual(exact, JSON.parse(readFileSync(`${baseline}-${faction}.json`, "utf8")));
      const output = process.env.DC_M02_OBSERVATION_OUTPUT;
      if (output) writeFileSync(`${output}-${faction}.json`, JSON.stringify(exact));
      const beforeResume = reads;
      const resumed = createBrowserCampaignPlaythrough(view, { resume: runner.checkpoint(), maxTicks: ticks + 1 });
      assert.equal(reads, beforeResume, "resume admission must not clone unused campaign history");
      assert.deepEqual(resumed.checkpoint(), runner.checkpoint());
      context.diagnostic(JSON.stringify({ faction, ticks, reads, bytes, cloneMs, events: events.length,
        exactBaseline: Boolean(baseline) }));
    } finally {
      view?.dispose(); renderer.dispose(); globalThis.fetch = originalFetch;
    }
  });
}
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { serialize } from "node:v8";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { CampaignSession } from "../../src/engine/campaign-session";
import { createBrowserCampaignPlaythrough } from "./fixtures/browser-campaign-playthrough";
import { installSourceRender } from "./fixtures/source-render";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const distribution = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  return { count: values.length, mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1) };
};

for (const faction of ["human", "alien"] as const) {
  test(`adapted performance: original ${faction} M02 legal public 3000 ticks`, {
    skip: ![faction, "both"].includes(process.env.DC_ADAPTED_PROFILE ?? ""),
  }, async () => {
    const directory = mkdtempSync(`/tmp/dc-adapted-performance-${faction}-`);
    const renderer = installSourceRender(), originalFetch = globalThis.fetch, originalClone = globalThis.structuredClone;
    const timings: number[] = [], samples: unknown[] = [], forkCloneCalls: number[] = [];
    const originalFork = CampaignSession.prototype.fork;
    let sessionForks = 0, updating = false;
    CampaignSession.prototype.fork = function () {
      if (updating) sessionForks++;
      return originalFork.call(this);
    };
    let active: Map<string, { count: number; bytes: number; milliseconds: number }> | undefined;
    let view: MissionView | undefined, restored: MissionView | undefined;
    let restoredRunner: ReturnType<typeof createBrowserCampaignPlaythrough> | undefined;
    let restoredAt1000 = false, continuedExactly = false;
    globalThis.fetch = async input => {
      const url = String(input);
      assert.ok(url.startsWith("/assets/generated/") && !url.includes(".."));
      return new Response(readFileSync(new URL(`../../public${url}`, import.meta.url)));
    };
    globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
      if (!active) return originalClone(value, options);
      const started = performance.now(), result = originalClone(value, options), elapsed = performance.now() - started;
      const stack = new Error().stack!.split("\n").slice(2, 6).map(line => line.trim().replaceAll(/\/Users\/rafael\/Downloads\/darkcolony\//g, "")).join(" <- ");
      const record = active.get(stack) ?? { count: 0, bytes: 0, milliseconds: 0 };
      record.count++; record.bytes += serialize(value).byteLength; record.milliseconds += elapsed;
      active.set(stack, record);
      return result;
    }) as typeof structuredClone;
    try {
      const mission = await loadCampaignMission(faction, 2, "browser-adapted"), sourceHash = hash(mission);
      view = new MissionView(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
      await view.initialize();
      assert.equal(view.missionDiagnostic, undefined);
      renderer.setEnabled(false);
      const update = view.update.bind(view);
      view.update = time => {
        const tick = view!.simulation.snapshot.tick + 1, sampled = [100, 1000, 3000].includes(tick);
        if (sampled) active = new Map();
        const started = performance.now();
        updating = true;
        update(time);
        updating = false;
        const elapsed = performance.now() - started;
        if (view!.simulation.snapshot.tick === tick && !sampled) timings.push(elapsed);
        if (active) {
          samples.push({ tick, instrumentedUpdateMs: elapsed, clones: [...active].map(([stack, counts]) => ({ stack, ...counts })) });
          forkCloneCalls.push([...active].filter(([stack]) => stack.includes("CampaignSession.fork")).reduce((sum, [, record]) => sum + record.count, 0));
        }
        active = undefined;
        if (sampled) {
          const snapshotStarted = performance.now(), snapshot = view!.campaignSnapshot!;
          const fullSnapshotMs = performance.now() - snapshotStarted;
          const journalStarted = performance.now(), journal = view!.campaignJournal;
          samples.push({ tick, fullSnapshotMs, journalMs: performance.now() - journalStarted,
            replayInputs: snapshot.aiSelectorInputs!.length, replayBytes: serialize(snapshot.aiSelectorInputs).byteLength,
            journalEntries: journal.length, journalBytes: serialize(journal).byteLength,
            transportRequests: (snapshot.world.transportState as { requests: unknown[] }).requests.length });
        }
      };
      const runner = createBrowserCampaignPlaythrough(view, { maxTicks: 3000, deadlineMs: 900000 });
      const started = performance.now();
      let progress = runner.progress;
      while (progress.status === "RUNNING") {
        progress = await runner.step(Math.min(100, progress.tick < 1000 ? 1000 - progress.tick : progress.tick < 1008 ? 1 : 100));
        if (progress.tick === 1000) {
          const saved = JSON.parse(JSON.stringify(view.checkpoint()));
          const restoreStarted = performance.now();
          restored = MissionView.restore(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission, saved);
          assert.deepEqual(restored.checkpoint(), saved);
          restoredAt1000 = true;
          await restored.initialize();
          renderer.setEnabled(false);
          restoredRunner = createBrowserCampaignPlaythrough(restored, { maxTicks: 3000, resume: runner.checkpoint() });
          samples.push({ restoreTick: 1000, restoreMs: performance.now() - restoreStarted,
            checkpointBytes: Buffer.byteLength(JSON.stringify(saved)) });
        } else if (progress.tick > 1000 && progress.tick <= 1008 && restoredRunner) {
          await restoredRunner.step(1);
          assert.deepEqual(restored!.checkpoint(), view.checkpoint());
          if (progress.tick === 1008) { continuedExactly = true; restored!.dispose(); restored = undefined; restoredRunner = undefined; }
        }
        if (progress.tick % 1000 === 0) console.log(JSON.stringify({ directory, faction, tick: progress.tick, elapsedMs: performance.now() - started }));
      }
      const checkpoint = view.checkpoint(), state = checkpoint.session!.state;
      const report = { faction, timestamp: new Date().toISOString(), sourceHash, sourceUnchanged: hash(mission) === sourceHash,
        mode: "NullCanvas; real MissionView.update + original M02 public-command strategy; no raw edits",
        wallMs: performance.now() - started, updateMs: distribution(timings), earlyMs: distribution(timings.slice(0, 250)),
        lateMs: distribution(timings.slice(-250)), samples, forkCloneCalls, sessionForks, restoredAt1000, continuedExactly, progress,
        sizes: { replayInputs: state.aiSelectorInputs!.length, replayBytes: Buffer.byteLength(JSON.stringify(state.aiSelectorInputs)),
          sessionBytes: Buffer.byteLength(JSON.stringify(checkpoint.session)), actors: state.world.entities.length,
          transportRequests: state.world.transportState.requests.length,
          selectorEvents: state.world.aiSelectors!.events.length, journal: view.campaignJournal.length },
        statistics: view.missionStatistics };
      const path = `${directory}/report.json`;
      writeFileSync(path, JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ path, updateMs: report.updateMs, earlyMs: report.earlyMs, lateMs: report.lateMs, progress }));
      assert.equal(progress.diagnostic, null);
      assert.equal(progress.tick, 3000);
      assert.equal(report.sourceUnchanged, true);
      assert.ok(restoredAt1000 && continuedExactly);
      assert.equal(state.aiSelectorInputs!.length, 3000);
      assert.equal(sessionForks, 3000);
      assert.deepEqual(forkCloneCalls, [0, 0, 0]);
      assert.ok(progress.earned > 0 && progress.shots > 0 && progress.purchases > 0);
      assert.equal(progress.publishedIncome - progress.spent, progress.credits);
    } finally {
      globalThis.structuredClone = originalClone; globalThis.fetch = originalFetch; CampaignSession.prototype.fork = originalFork;
      view?.dispose(); restored?.dispose(); renderer.dispose();
    }
  });
}
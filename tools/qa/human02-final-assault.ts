import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadReleaseMission } from "./fixtures/release-mission";
import { MissionView } from "../../src/mission-view";
import { parseTriggerScript } from "../extractors/data/triggers";
import { createBrowserCampaignPlaythrough, type BrowserPlaythroughCheckpoint, type BrowserPlaythroughEvent } from "./fixtures/browser-campaign-playthrough";
import { installSourceRender } from "./fixtures/source-render";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const startedAt = performance.now();
const directory = mkdtempSync("/tmp/dc-human02-final-assault-");
const savePath = process.env.DC_HUMAN02_RESUME ?? "/tmp/dc-m02-human-win-jhb017/checkpoint.json";
const emit = (event: BrowserPlaythroughEvent) => appendFileSync(join(directory, "journal.jsonl"), `${JSON.stringify(event)}\n`);
const artifact = (name: string, value: unknown) => writeFileSync(join(directory, name), JSON.stringify(value));
const renderer = installSourceRender();
const originalFetch = globalThis.fetch;
let view: MissionView | undefined;
console.log(JSON.stringify({ kind: "start", directory, savePath, pid: process.pid, steppingLimitMs: 600000, totalLimitMs: 900000 }));
globalThis.fetch = async input => {
  const url = String(input);
  assert.ok(url.startsWith("/assets/generated/") && !url.includes(".."), url);
  return new Response(read(`public${url}`));
};

try {
  const savedBytes = readFileSync(savePath);
  const saved = JSON.parse(savedBytes.toString()) as {
    sourceHash: string; view: ReturnType<MissionView["checkpoint"]>; strategy: BrowserPlaythroughCheckpoint;
  };
  const mission = await loadReleaseMission("human", 2);
  const sourceHash = hash(JSON.stringify(mission));
  const raw = (extension: string) => read(`raw_cd/DC/SCENARIO/HUMAN/HUMAN02.${extension}`);
  assert.equal(mission.scenario.source.sha256, hash(raw("SCN")));
  assert.deepEqual(Buffer.from(mission.scenario.rawScenario!, "base64"), raw("SCN"));
  assert.deepEqual(mission.triggers, parseTriggerScript(raw("TRO").toString()));
  const compatibility = { savedSourceHash: saved.sourceHash, currentSourceHash: sourceHash,
    identicalLoader: saved.sourceHash === sourceHash, checkpointHash: hash(savedBytes), tick: saved.strategy.tick,
    production: mission.sourceProduction?.production,
    rawHashes: Object.fromEntries(["SCN", "TRO", "TXT", "MAP", "MTG", "PTH"].map(extension => [extension, hash(raw(extension))])),
    runtimeHashes: Object.fromEntries(["src/mission-view.ts", "src/game-data.ts", "src/engine/campaign-session.ts",
      "src/engine/simulation.ts", "tools/qa/fixtures/browser-campaign-playthrough.ts"].map(path => [path, hash(read(path))])) };
  artifact("compatibility.json", compatibility);
  console.log(JSON.stringify({ kind: "compatibility", identicalLoader: compatibility.identicalLoader, sourceHash, tick: saved.strategy.tick }));
  assert.equal(saved.sourceHash, sourceHash, "Saved checkpoint must match the unchanged current loader, including collector configuration");
  assert.equal(saved.strategy.faction, "human");
  assert.equal(saved.strategy.intent, "win");
  if (!process.argv.includes("--check")) {
    renderer.setEnabled(false);
    view = MissionView.restore(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission, saved.view);
    await view.initialize();
    assert.equal(view.missionDiagnostic, undefined);
    assert.equal(view.simulation.snapshot.tick, saved.strategy.tick);
    const activeView = view;
    const tactical = () => {
      const snapshot = activeView.simulation.snapshot;
      return { tick: snapshot.tick, statistics: activeView.missionStatistics, outcome: activeView.missionOutcome,
        diagnostic: activeView.missionDiagnostic, credits: activeView.resourceWorkflow.credits[0],
        economy: activeView.browserEconomyState, resources: activeView.resourceSources,
        units: snapshot.units.map(actor => ({ ...actor, visible: !!activeView.visibility[actor.cellY * activeView.grid.width + actor.cellX] })),
        bindings: activeView.nativeBindings, staticTargets: snapshot.staticTargets };
    };
    artifact("restored-start.json", tactical());
    console.log(JSON.stringify({ kind: "restored", tick: saved.strategy.tick, goal: view.missionStatistics["2,3"], elapsedMs: performance.now() - startedAt }));
    let beforeReady: { tick: number; checkpoint: ReturnType<MissionView["checkpoint"]> } | undefined;
    const onEvent = (event: BrowserPlaythroughEvent) => {
      emit(event);
      if (event.kind === "outcome" && activeView.missionOutcome?.resultCode === 0 && !activeView.missionOutcome.ready && !beforeReady) {
        beforeReady = { tick: event.tick, checkpoint: activeView.checkpoint() };
        artifact("pending-win.json", { sourceHash, ...beforeReady });
      }
      if (event.kind === "statistics" || event.kind === "outcome" || event.kind === "failure") console.log(JSON.stringify(event));
    };
    const runner = createBrowserCampaignPlaythrough(view, { resume: saved.strategy, intent: "win", maxTicks: 50000,
      deadlineMs: Math.min(600000, Math.max(1, 780000 - (performance.now() - startedAt))),
      observeEvery: 100, armySize: 24, onEvent, beforeUpdate: () => renderer.setEnabled(false) });
    let result = runner.progress;
    while (result.status === "RUNNING") {
      result = await runner.step(250);
      console.log(JSON.stringify({ kind: "batch", tick: result.tick, goal: result.objective.value,
        status: result.status, credits: result.credits, elapsedMs: Math.round(performance.now() - startedAt) }));
    }
    artifact("result.json", { ...result, elapsedMs: performance.now() - startedAt, tactical: tactical(), strategy: runner.checkpoint() });
    const checkpoint = view.checkpoint();
    artifact("checkpoint.json", { sourceHash, view: checkpoint, strategy: runner.checkpoint() });
    assert.equal(hash(JSON.stringify(mission)), sourceHash);
    assert.equal(result.publishedIncome - result.spent, result.credits);
    assert.ok(result.earned >= result.publishedIncome);
    if (result.status === "WIN") {
      assert.deepEqual(result.outcome, { resultCode: 0, reasonCode: 1, ready: true });
      assert.ok(result.objective.value >= 27);
      assert.ok(beforeReady, "WIN requires an actual pending boundary");
      assert.ok(performance.now() - startedAt < 820000, "Insufficient total budget for winning restore proof");
      const restored = MissionView.restore(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission,
        JSON.parse(JSON.stringify(beforeReady.checkpoint)));
      try {
        assert.deepEqual(restored.checkpoint(), beforeReady.checkpoint);
        await restored.initialize();
        restored.resetClock();
        restored.update(0);
        for (let offset = 1; offset <= result.tick - beforeReady.tick; offset++) restored.update(offset * 50);
        assert.deepEqual(restored.missionOutcome, result.outcome);
        assert.deepEqual(restored.checkpoint(), checkpoint);
        artifact("winning-restore-proof.json", { fromTick: beforeReady.tick, readyTick: result.tick,
          outcome: restored.missionOutcome, exactCheckpoint: true, objective: restored.missionStatistics["2,3"] });
      } finally { restored.dispose(); }
    }
    console.log(JSON.stringify({ kind: "complete", directory, ...result, winningRestoreVerified: result.status === "WIN",
      elapsedMs: Math.round(performance.now() - startedAt) }));
  }
} catch (error) {
  const failure = { message: error instanceof Error ? error.stack : String(error), elapsedMs: performance.now() - startedAt,
    tick: view?.simulation.snapshot.tick, statistics: view?.missionStatistics, outcome: view?.missionOutcome };
  artifact("failure.json", failure);
  console.error(JSON.stringify({ kind: "failure", directory, ...failure }));
  process.exitCode = 1;
} finally {
  view?.dispose();
  renderer.dispose();
  globalThis.fetch = originalFetch;
}
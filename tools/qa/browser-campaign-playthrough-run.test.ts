import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { parseTriggerScript } from "../extractors/data/triggers";
import { createBrowserCampaignPlaythrough, type BrowserPlaythroughEvent, type BrowserPlaythroughCheckpoint } from "./fixtures/browser-campaign-playthrough";
import { installSourceRender } from "./fixtures/source-render";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

for (const faction of ["human", "alien"] as const) {
  test(`M02 actual public playthrough: ${faction}`, { skip: ![faction, "both"].includes(process.env.DC_M02_FACTION ?? "") }, async context => {
    const startedAt = performance.now();
    const intent = process.env.DC_M02_INTENT ?? "win";
    const renderEvery = Number(process.env.DC_M02_RENDER_EVERY ?? 1000);
    const restoreAt = Number(process.env.DC_M02_RESTORE_AT ?? 0);
    const checkpointEvery = Number(process.env.DC_M02_CHECKPOINT_EVERY ?? 0);
    const totalMs = Number(process.env.DC_M02_TOTAL_MS ?? 0);
    assert.ok(Number.isSafeInteger(renderEvery) && renderEvery >= 0);
    assert.ok(Number.isSafeInteger(restoreAt) && restoreAt >= 0);
    assert.ok(Number.isSafeInteger(checkpointEvery) && checkpointEvery >= 0 && checkpointEvery % 250 === 0);
    assert.ok(Number.isSafeInteger(totalMs) && totalMs >= 0 && totalMs <= 1200000);
    const resume = process.env.DC_M02_RESUME ? JSON.parse(readFileSync(process.env.DC_M02_RESUME, "utf8")) as {
      sourceHash: string; view: unknown; strategy: BrowserPlaythroughCheckpoint } : undefined;
    const replay = process.env.DC_M02_REPLAY ? readFileSync(process.env.DC_M02_REPLAY, "utf8")
      .trim().split("\n").map(line => JSON.parse(line) as BrowserPlaythroughEvent) : undefined;
    assert.ok(intent === "win" || intent === "loss");
    const log = join(mkdtempSync(`/tmp/dc-m02-${faction}-${intent}-`), "journal.jsonl");
    let acceptedSpending = resume?.strategy.spent ?? 0, harvests = 0, activation = false;
    let beforeReady: { tick: number; checkpoint: ReturnType<MissionView["checkpoint"]> } | undefined;
    const emit = (event: BrowserPlaythroughEvent) => {
      appendFileSync(log, `${JSON.stringify(event)}\n`);
      if (event.kind === "outcome" && view?.missionOutcome?.resultCode === 0 && !view.missionOutcome.ready && !beforeReady) {
        beforeReady = { tick: event.tick, checkpoint: view.checkpoint() };
        writeFileSync(join(log, "..", "before-ready.json"), JSON.stringify({ sourceHash: hash(JSON.stringify(view.mission)), ...beforeReady }));
      }
      if (renderEvery > 0 && view && ["combat", "resource-delivery", "carrier"].includes(event.kind)) {
        renderer.setEnabled(true);
        view.render();
        appendFileSync(log, `${JSON.stringify({ kind: "render-sample", tick: event.tick, data: { reason: event.kind } })}\n`);
      }
      if (event.kind === "progress") console.log(JSON.stringify({ kind: "progress", faction, tick: event.tick,
        elapsedMs: (event.data as { elapsedMs: number }).elapsedMs }));
      if (event.kind === "action") {
        const action = event.data as { kind: string; accepted?: boolean; cost?: number; before?: number;
          earned?: number; visible?: boolean; rate?: number; remaining?: number };
        if (action.kind === "purchase" && action.accepted) {
          assert.ok(action.cost! > 0 && action.before! >= action.cost!);
          acceptedSpending += action.cost!;
          assert.ok(action.earned! >= acceptedSpending, "Purchases must be source-earned");
        }
        if (action.kind === "harvest" && action.accepted) {
          assert.equal(action.visible, true);
          assert.ok(action.rate! > 0 && action.remaining! > 0);
          harvests++;
        }
      }
      if (event.kind === "ai-selector") {
        const selector = event.data as { triggerId: number; before: number; after: number };
        if (selector.triggerId === (faction === "human" ? 17 : 0)) {
          assert.equal(selector.before, 4); assert.equal(selector.after, 3); activation = true;
        }
      }
    };
    context.diagnostic(`Fresh source playthrough journal: ${log}`);
    console.log(JSON.stringify({ kind: "journal", faction, intent, log }));
    const originalFetch = globalThis.fetch, renderer = installSourceRender(), fetched = new Set<string>();
    let view: MissionView | undefined;
    globalThis.fetch = async input => {
      const url = String(input);
      assert.ok(url.startsWith("/assets/generated/") && !url.includes(".."), url);
      fetched.add(url);
      return new Response(read(`public${url}`));
    };
    try {
      const name = faction.toUpperCase(), mission = await loadCampaignMission(faction, 2, "browser-adapted");
      const raw = (extension: string) => read(`raw_cd/DC/SCENARIO/${name}/${name}02.${extension}`);
      assert.equal(mission.scenario.source.sha256, hash(raw("SCN")));
      assert.deepEqual(Buffer.from(mission.scenario.rawScenario!, "base64"), raw("SCN"));
      assert.deepEqual(mission.triggers, parseTriggerScript(raw("TRO").toString()));
      const briefing = JSON.parse(read(`public/assets/generated/data/briefings/${name}/${name}02.json`).toString());
      assert.equal(briefing.source.sha256, hash(raw("TXT")));
      assert.deepEqual(mission.briefing, briefing);
      const sourceHash = hash(JSON.stringify(mission));
      if (resume) assert.equal(resume.sourceHash, sourceHash, "Checkpoint must use unchanged original mission");
      if (replay) assert.equal((replay.find(event => event.kind === "harness")?.data as { sourceHash: string }).sourceHash,
        sourceHash, "Replay must use unchanged original mission");
      emit({ kind: "harness", tick: 0, data: { startedAt: new Date().toISOString(), faction, intent,
        sourceHash, rawHashes: Object.fromEntries(["SCN", "TRO", "TXT", "MAP", "MTG", "PTH"].map(extension => [extension, hash(raw(extension))])),
        runtimeHashes: Object.fromEntries(["src/mission-view.ts", "src/game-data.ts", "src/engine/campaign-session.ts", "src/engine/simulation.ts", "src/engine/browser-campaign-ai.ts",
          "src/engine/browser-campaign-economy.ts", "src/engine/source-production-options.ts", "src/engine/campaign-production.ts",
          "tools/qa/fixtures/browser-campaign-playthrough.ts"].map(path => [path, hash(read(path))])),
        render: { mode: renderEvery ? "sampled-source-assets" : "null-canvas-search", every: renderEvery,
          limitation: "PNG headers and render dispatch only; no raster, browser or native parity claim" } } });
      view = resume ? MissionView.restore(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission, resume.view)
        : new MissionView(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
      await view.initialize();
      assert.equal(view.missionDiagnostic, undefined);
      if (resume) emit({ kind: "resume-verified", tick: view.simulation.snapshot.tick,
        data: { path: process.env.DC_M02_RESUME, elapsedMs: Math.round(performance.now() - startedAt) } });
      emit({ kind: "initialized", tick: 0, data: { ...renderer.evidence(), fetched: [...fetched] } });
      emit({ kind: "production-capability", tick: view.simulation.snapshot.tick, data: {
        profiles: mission.sourceProduction?.production?.sourceProfiles.map(profile => profile.unitType),
        menu: view.productionMenu,
        collectors: view.campaignSnapshot!.production?.catalog.filter(entry => entry.unitType === (faction === "human" ? 6 : 14)),
        collectorSource: mission.sourceProduction?.production?.units.filter(unit => unit.unitType === (faction === "human" ? 6 : 14)),
      } });
      const runner = createBrowserCampaignPlaythrough(view, { intent, maxTicks: Number(process.env.DC_M02_TICKS ?? 30000),
        resume: resume?.strategy, replay,
        deadlineMs: Math.min(Number(process.env.DC_M02_DEADLINE_MS ?? 900000),
          totalMs ? Math.max(1, totalMs - (performance.now() - startedAt) - 60000) : 900000),
        observeEvery: Number(process.env.DC_M02_OBSERVE_EVERY ?? 20),
        armySize: Number(process.env.DC_M02_ARMY ?? 18), onEvent: emit,
        beforeUpdate: nextTick => renderer.setEnabled(renderEvery > 0 && nextTick % renderEvery === 0) });
      let result = runner.progress;
      let earlyRestoreVerified = false;
      while (result.status === "RUNNING") {
        result = await runner.step(restoreAt > result.tick ? Math.min(250, restoreAt - result.tick) : 250);
        if (checkpointEvery > 0 && result.tick % checkpointEvery === 0 && result.status === "RUNNING") {
          const path = join(log, "..", "continuation-checkpoint.json");
          writeFileSync(path, JSON.stringify({ sourceHash, view: view.checkpoint(), strategy: runner.checkpoint() }));
          emit({ kind: "checkpoint", tick: result.tick, data: { path, ready: false, scope: "periodic-continuation" } });
        }
        if (restoreAt > 0 && result.tick === restoreAt && !earlyRestoreVerified) {
          const earlyCheckpoint = view.checkpoint();
          const path = join(log, "..", "early-checkpoint.json");
          writeFileSync(path, JSON.stringify({ sourceHash, view: earlyCheckpoint, strategy: runner.checkpoint() }));
          const restored = MissionView.restore(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission,
            JSON.parse(JSON.stringify(earlyCheckpoint)));
          try { assert.deepEqual(restored.checkpoint(), earlyCheckpoint); }
          finally { restored.dispose(); }
          earlyRestoreVerified = true;
          emit({ kind: "checkpoint-verified", tick: result.tick, data: { path, scope: "early-exact-roundtrip", ready: false } });
        }
      }
      const bindings = new Map(view.nativeBindings.map(binding => [binding.key, binding.simulationId]));
      const playerHealth = view.campaignSnapshot!.world.entities.filter(entity => entity.team === 0).map(entity => ({
        key: entity.key, type: entity.unitType,
        actor: view!.simulation.snapshot.units.find(actor => actor.id === (bindings.get(entity.key) ?? entity.simulationId)),
      }));
      writeFileSync(join(log, "..", "result-summary.json"), JSON.stringify({ faction, log, ...result, playerHealth,
        production: view.productionMenu, economy: view.browserEconomyState, strategy: runner.checkpoint() }));
      emit({ kind: "bounded-result", tick: result.tick, data: result });
      renderer.setEnabled(true);
      view.render();
      const checkpointPath = join(log, "..", "checkpoint.json");
      const checkpoint = view.checkpoint();
      writeFileSync(checkpointPath, JSON.stringify({ sourceHash, view: checkpoint, strategy: runner.checkpoint() }));
      emit({ kind: "checkpoint", tick: result.tick, data: { path: checkpointPath, ready: result.outcome?.ready ?? false } });
      if (process.env.DC_M02_VERIFY_RESTORE === "1" && !earlyRestoreVerified && result.status !== "WIN") {
        const restored = MissionView.restore(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission,
          JSON.parse(JSON.stringify(checkpoint)));
        try { assert.deepEqual(restored.checkpoint(), checkpoint); }
        finally { restored.dispose(); }
        emit({ kind: "checkpoint-verified", tick: result.tick, data: { ready: result.outcome?.ready ?? false } });
      }
      emit({ kind: "result", tick: result.tick, data: { ...result, sourceUnchanged: sourceHash === hash(JSON.stringify(mission)),
        currencyAudit: { delivered: result.earned, published: result.publishedIncome, spent: result.spent,
          credits: result.credits, unposted: result.earned - result.publishedIncome,
          balanced: result.publishedIncome - result.spent === result.credits },
        statistics: view.missionStatistics, production: view.productionMenu, economy: view.browserEconomyState,
        ai: view.browserAiState, worldSelectors: view.campaignSnapshot!.world.aiSelectors,
        units: view.simulation.snapshot.units, staticTargets: view.simulation.snapshot.staticTargets,
        render: renderer.evidence(), fetched: [...fetched] } });
      console.log(JSON.stringify({ kind: "result", faction, log, ...result }));
      assert.equal(hash(JSON.stringify(mission)), sourceHash, "Loader mission was not modified");
      assert.ok(renderer.evidence().spriteDraws > 0);
      assert.equal(renderer.evidence().warnings.some(warning => /missing-state|unsupported-timeline|missing-atlas-frame/.test(warning)), false);
      assert.notEqual(result.status, "FAIL", `${log}: ${result.diagnostic}`);
      assert.equal(result.publishedIncome - result.spent, result.credits, "Published source income minus paid purchases must equal credits");
      assert.ok(result.earned >= result.publishedIncome, "Income cannot be published before delivery");
      if (result.status === "WIN") {
        assert.deepEqual(result.outcome, { resultCode: 0, reasonCode: 1, ready: true });
        assert.ok(result.objective.value >= result.objective.required);
        assert.ok(beforeReady, "A real winning pending-outcome checkpoint must precede ready victory");
        const restored = MissionView.restore(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission,
          JSON.parse(JSON.stringify(beforeReady.checkpoint)));
        try {
          assert.deepEqual(restored.checkpoint(), beforeReady.checkpoint);
          await restored.initialize();
          restored.resetClock();
          restored.update(0);
          for (let offset = 1; offset <= result.tick - beforeReady.tick; offset++) restored.update(offset * 50);
          assert.deepEqual(restored.missionOutcome, result.outcome);
          renderer.setEnabled(true);
          restored.render();
          const restoredFinal = restored.checkpoint();
          writeFileSync(join(log, "..", "restored-ready.json"), JSON.stringify(restoredFinal));
          assert.deepEqual(restoredFinal, checkpoint);
        } finally { restored.dispose(); }
        emit({ kind: "winning-boundary-verified", tick: result.tick, data: { fromTick: beforeReady.tick,
          continuationTicks: result.tick - beforeReady.tick, exactCheckpoint: true, outcome: result.outcome } });
      }
      if (result.purchases) assert.ok(result.earned >= result.spent);
      if (result.earned && !resume) assert.ok(harvests > 0);
      if (result.tick >= (faction === "human" ? 14120 : 1160) && !resume) assert.ok(activation, "Natural source AI selector must activate");
      if (replay) {
        const expected = replay.find(event => event.kind === "result")!.data as typeof result;
        for (const key of ["tick", "status", "shots", "deaths", "purchases", "spent", "credits", "earned", "objective", "outcome"] as const) {
          assert.deepEqual(result[key], expected[key], `Public replay diverged: ${key}`);
        }
        emit({ kind: "public-replay-verified", tick: result.tick, data: { status: result.status } });
      }
      if (process.env.DC_M02_REQUIRE_OUTCOME) assert.equal(result.status, process.env.DC_M02_REQUIRE_OUTCOME, log);
    } catch (error) {
      emit({ kind: "harness-failure", tick: view?.simulation.snapshot.tick ?? 0,
        data: { message: error instanceof Error ? error.message : String(error) } });
      throw error;
    } finally {
      view?.dispose(); renderer.dispose(); globalThis.fetch = originalFetch;
    }
  });
}
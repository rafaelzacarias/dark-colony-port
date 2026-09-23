import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { createBrowserCampaignPlaythrough, type BrowserPlaythroughEvent, type BrowserPlaythroughCheckpoint } from "./fixtures/browser-campaign-playthrough";
import { installSourceRender } from "./fixtures/source-render";

test("production endjudge: actual HUMAN02 checkpoint resumes through the original destruction blocker", {
  skip: process.env.DC_PRODUCTION_ENDJUDGE !== "1",
}, async context => {
  const startPath = process.env.DC_PRODUCTION_ENDJUDGE_SAVE ?? "/tmp/dc-m02-human-win-DoSizD/checkpoint.json";
  const originalPath = process.env.DC_PRODUCTION_ENDJUDGE_ORIGINAL ?? "/tmp/dc-m02-human-win-eHErIu/checkpoint.json";
  const journalPath = process.env.DC_PRODUCTION_ENDJUDGE_JOURNAL ?? "/tmp/dc-m02-human-win-eHErIu/journal.jsonl";
  const saved = JSON.parse(readFileSync(startPath, "utf8"));
  const original = JSON.parse(readFileSync(originalPath, "utf8"));
  assert.equal(saved.view.state.diagnostic, null);
  assert.equal(saved.sourceHash, original.sourceHash);
  assert.deepEqual(saved.view.session.options, original.view.session.options);
  assert.deepEqual(saved.view.session.state.aiSelectorInputs,
    original.view.session.state.aiSelectorInputs.slice(0, saved.view.session.state.aiSelectorInputs.length));
  assert.match(original.view.state.diagnostic, /Production colony mutation requires native destruction\/construction ownership/);
  const replay = readFileSync(journalPath, "utf8").trim().split("\n").map(line => JSON.parse(line) as BrowserPlaythroughEvent);
  const output = mkdtempSync("/tmp/dc-production-endjudge-resume-");
  const log = `${output}/journal.jsonl`;
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
  const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
  const sourceHashes = Object.fromEntries(["SCN", "TRO", "TXT", "MAP", "MTG", "PTH"].map(extension =>
    [extension, hash(read(`raw_cd/DC/SCENARIO/HUMAN/HUMAN02.${extension}`))]));
  const oldFetch = globalThis.fetch, renderer = installSourceRender();
  const callbacks = { onStats() {}, onUnitsChanged() {} };
  let view: MissionView | undefined, restored: MissionView | undefined;
  const emit = (event: BrowserPlaythroughEvent) => {
    appendFileSync(log, `${JSON.stringify(event)}\n`);
    if (event.kind === "progress") console.log(JSON.stringify({ kind: event.kind, tick: event.tick, output }));
  };
  console.log(JSON.stringify({ kind: "resume", startPath, tick: saved.view.simulation.tick, output }));
  globalThis.fetch = async input => {
    const url = String(input);
    assert.ok(url.startsWith("/assets/generated/") && !url.includes(".."));
    return new Response(read(`public${url}`));
  };
  try {
    const mission = await loadCampaignMission("human", 2, "browser-adapted");
    assert.equal(hash(JSON.stringify(mission)), saved.sourceHash);
    view = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, saved.view);
    const migrated = JSON.parse(JSON.stringify(view.checkpoint()));
    assert.deepEqual(migrated.session.state.world.browserCasualtyPickup, { runtimeProfile: "browser-adapted" });
    if (!saved.view.session.state.world.browserCasualtyPickup) delete migrated.session.state.world.browserCasualtyPickup;
    assert.deepEqual(migrated, saved.view);
    await view.initialize();
    assert.equal(view.missionDiagnostic, undefined);
    renderer.setEnabled(false);
    const runner = createBrowserCampaignPlaythrough(view, { intent: "win", maxTicks: 17900,
      resume: saved.strategy, replay, deadlineMs: 900000, onEvent: emit });
    while (runner.progress.tick < 17876 && runner.progress.status === "RUNNING") {
      await runner.step(Math.min(250, 17876 - runner.progress.tick));
    }
    assert.equal(runner.progress.tick, 17876, JSON.stringify(runner.progress));
    assert.equal(view.missionDiagnostic, undefined);
    const boundary = { sourceHash: saved.sourceHash, view: view.checkpoint(), strategy: runner.checkpoint() };
    const boundaryPath = `${output}/before-destruction.json`;
    writeFileSync(boundaryPath, JSON.stringify(boundary));
    const fromFile = JSON.parse(readFileSync(boundaryPath, "utf8"));
    restored = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, fromFile.view);
    assert.deepEqual(restored.checkpoint(), boundary.view);
    await restored.initialize();
    const continuation = createBrowserCampaignPlaythrough(restored, { intent: "win", maxTicks: 17900,
      resume: fromFile.strategy as BrowserPlaythroughCheckpoint, replay, deadlineMs: 900000 });
    while (runner.progress.tick < 17900 && runner.progress.status === "RUNNING") {
      await runner.step(1); await continuation.step(1);
      assert.deepEqual(continuation.progress, runner.progress);
      assert.deepEqual(restored.simulation.checkpoint(), view.simulation.checkpoint());
      assert.equal(view.missionDiagnostic, undefined);
      assert.equal(restored.missionDiagnostic, undefined);
    }
    assert.equal(runner.progress.tick, 17900, JSON.stringify(runner.progress));
    assert.deepEqual(restored.checkpoint(), view.checkpoint());
    const checkpoint = view.checkpoint();
    writeFileSync(`${output}/after-destruction.json`, JSON.stringify({ sourceHash: saved.sourceHash,
      view: checkpoint, strategy: runner.checkpoint() }));
    const state = view.campaignSnapshot!;
    const building = state.world.entities.find(entity => entity.rawSlot === 0)!;
    assert.equal(building.unitType, 16);
    assert.equal(building.health, 0);
    assert.equal(state.production!.teams[0].slots[0].health, 0);
    assert.equal(state.world.buildingSlots["0,0"], 0);
    assert.equal(state.world.entityBytes![0x2c], 10);
    assert.equal(state.world.statistics["0,0,16"], 1);
    assert.equal(runner.progress.publishedIncome - state.production!.teams[0].costAccumulator, state.world.exomoney[0]);
    assert.equal(hash(JSON.stringify(mission)), saved.sourceHash);
    for (const [extension, expected] of Object.entries(sourceHashes)) {
      assert.equal(hash(read(`raw_cd/DC/SCENARIO/HUMAN/HUMAN02.${extension}`)), expected);
    }
    restored.dispose();
    restored = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission,
      JSON.parse(readFileSync(`${output}/after-destruction.json`, "utf8")).view);
    assert.deepEqual(restored.checkpoint(), checkpoint);
    const result = { ...runner.progress, output, startPath, sourceHashes, sourceUnchanged: true,
      boundaryRestore: true, continuationEqual: true, finalRestore: true,
      production: state.production!.teams.map(team => ({ team: team.team, credits: team.credits,
        costAccumulator: team.costAccumulator, slots: team.slots })),
      losses: state.controller.consumedLosses, buildingSlots: state.world.buildingSlots };
    writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
    context.diagnostic(JSON.stringify(result));
  } finally {
    restored?.dispose(); view?.dispose(); renderer.dispose(); globalThis.fetch = oldFetch;
  }
});
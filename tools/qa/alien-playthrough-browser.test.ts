import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { parseTriggerScript } from "../extractors/data/triggers";
import { createAlienPlaythroughRunner, driveAlienPlaythrough, type AlienPlaythroughCheckpoint,
  type AlienPlaythroughProgress } from "./fixtures/alien-playthrough-browser";
import { installSourceRender } from "./fixtures/source-render";
import type { PlaythroughCommand } from "./fixtures/source-playthrough-strategy";

const root = new URL("../../", import.meta.url);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const baselines = {
  win: { tick: 6945, count: 88, shots: 785, deaths: 45,
    commandHash: "4ff62ac924b2625a656b6b2000e69626b697b87e1eaa7e2e0408e5894ca1609f",
    finalHash: "2bdf8c2d9a79296397dd9afc45a70d8287299bcf54f69bc378101e4cca6b4198" },
  loss: { tick: 2465, count: 10, shots: 267, deaths: 1,
    commandHash: "e33df04b91c85c61a799fb14779a321b3dff3ed9ce17e862edbb0ac6dd6cb618",
    finalHash: "e19d3efefdd5c03767671bd7ed6fca3c4d2d0ae988ab255951eca4be77768e47" },
};

async function withOriginalMission(run: (mission: Awaited<ReturnType<typeof loadCampaignMission>>,
  rendering: ReturnType<typeof installSourceRender>, fetched: Set<string>) => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const rendering = installSourceRender();
  const fetched = new Set<string>();
  globalThis.fetch = async input => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    fetched.add(path);
    return new Response(readFileSync(new URL(`public${path}`, root)));
  };
  try { await run(await loadCampaignMission("alien"), rendering, fetched); }
  finally { globalThis.fetch = originalFetch; rendering.dispose(); }
}

test("browser runner: bounded clock, CSS center, callbacks, and no global/save mutation", async () => {
  await withOriginalMission(async (mission, rendering) => {
    let stats = 0, units = 0;
    const callbacks = { onStats() { stats += 1; }, onUnitsChanged() { units += 1; } };
    const canvas = rendering.canvas();
    canvas.getBoundingClientRect = () => ({ left: 71, top: 29, width: 256, height: 226 }) as DOMRect;
    const view = new MissionView(canvas, {} as HTMLElement, callbacks, mission);
    const warn = console.warn, log = console.log, fetch = globalThis.fetch;
    const globals = Object.getOwnPropertyNames(globalThis);
    try {
      assert.throws(() => createAlienPlaythroughRunner(view, { outcome: "win" }), /Initialize/);
      await view.initialize();
      const sourceHash = digest(mission);
      assert.throws(() => createAlienPlaythroughRunner(view, { outcome: "win", batchTicks: 0 }), /batchTicks/);
      const runner = createAlienPlaythroughRunner(view, { outcome: "win", maxTicks: 201 });
      assert.equal(runner.progress.tick, 0);
      const statsBefore = stats;
      const first = await runner.step(200);
      assert.equal(first.status, "running");
      assert.equal(first.success, false);
      assert.equal(first.tick, 200);
      assert.equal(first.ticksAdvanced, 200);
      assert.equal(first.commandCount, 2);
      assert.deepEqual(first.actions.map(({ tick, point, client, clickedCell }) => ({ tick, point, client, clickedCell })), [
        { tick: 100, point: { x: 21, y: 34 }, client: [199, 142], clickedCell: { x: 21, y: 34 } },
        { tick: 150, point: { x: 19, y: 37 }, client: [199, 142], clickedCell: { x: 19, y: 37 } },
      ]);
      assert.ok(stats - statsBefore >= 200, "each update renders and reaches original HUD callback");
      assert.ok(units > 0);
      assert.equal(view.callbacks, callbacks);
      const final = await runner.step(200);
      assert.equal(final.tick, 201);
      assert.equal(final.ticksAdvanced, 1);
      assert.equal(final.status, "limit");
      assert.equal(final.success, false);
      assert.equal((await runner.step(1)).ticksAdvanced, 0);
      await assert.rejects(runner.step(0), /step count/);
      assert.equal(digest(mission), sourceHash);
      assert.equal(console.warn, warn);
      assert.equal(console.log, log);
      assert.equal(globalThis.fetch, fetch);
      assert.deepEqual(Object.getOwnPropertyNames(globalThis), globals);
      assert.throws(() => createAlienPlaythroughRunner(view, { outcome: "win" }), /tick zero/);
    } finally { view.dispose(); }
  });
});

test("browser runner: async batches reject concurrent steps and foreign clock advances", async () => {
  await withOriginalMission(async (mission, rendering) => {
    const view = new MissionView(rendering.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
    try {
      await view.initialize();
      let release!: () => void;
      const paused = new Promise<void>(resolve => { release = resolve; });
      const runner = createAlienPlaythroughRunner(view, { outcome: "loss", maxTicks: 5, checkpointEvery: 1,
        onCheckpoint: () => paused });
      const pending = runner.step(1);
      await assert.rejects(runner.step(1), /already in progress/);
      release();
      assert.equal((await pending).tick, 1);
      view.update(100);
      await assert.rejects(runner.step(1), /outside runner/);
    } finally { view.dispose(); }
    const other = new MissionView(rendering.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
    try {
      await other.initialize();
      const batches: number[] = [];
      const result = await driveAlienPlaythrough(other, { outcome: "loss", maxTicks: 5, batchTicks: 2,
        onProgress: progress => { batches.push(progress.tick); } });
      assert.deepEqual(batches, [2, 4, 5]);
      assert.equal(result.status, "limit");
      assert.equal(result.success, false);
    } finally { other.dispose(); }
  });
});

for (const outcome of ["win", "loss"] as const) test(`browser runner original ${outcome}: full-render old-strategy transcript and separate restore`, async context => {
  await withOriginalMission(async (mission, rendering, fetched) => {
    const expected = baselines[outcome];
    const sourceHash = digest(mission);
    assert.deepEqual(mission.triggers, parseTriggerScript(readFileSync(new URL("raw_cd/DC/SCENARIO/ALIEN/ALIEN01.TRO", root), "utf8")));
    assert.equal(mission.triggers.length, 9);
    const commands: PlaythroughCommand[] = [];
    let stats = 0, units = 0, checkpointCalls = 0;
    const callbacks = { onStats() { stats += 1; }, onUnitsChanged() { units += 1; } };
    let view = new MissionView(rendering.canvas(), {} as HTMLElement, callbacks, mission);
    let saved: AlienPlaythroughCheckpoint | undefined;
    const onProgress = (progress: AlienPlaythroughProgress) => {
      for (const { tick, ids, point, mode, purpose } of progress.actions) commands.push({ tick, ids, point, mode, purpose });
      assert.ok(stats >= progress.tick, "no update skips full render callbacks");
    };
    try {
      await view.initialize();
      let runner = createAlienPlaythroughRunner(view, { outcome, maxTicks: 8000, onProgress,
        onCheckpoint: checkpoint => { checkpointCalls += 1; saved = checkpoint; } });
      for (let batch = 0; batch < 5; batch += 1) {
        const progress = await runner.step(200);
        assert.equal(progress.status, "running");
        assert.equal(progress.success, false);
      }
      assert.equal(checkpointCalls, 1);
      assert.ok(saved);
      assert.equal(saved.continuation.tick, 1000);
      const restored = MissionView.restore(rendering.canvas(), {} as HTMLElement, callbacks, mission, saved.view);
      assert.deepEqual(restored.checkpoint(), saved.view);
      view.dispose();
      view = restored;
      await view.initialize();
      runner = createAlienPlaythroughRunner(view, { outcome, maxTicks: 8000, continuation: saved.continuation, onProgress });
      let progress = runner.progress;
      while (progress.status === "running") progress = await runner.step(200);
      assert.equal(progress.tick, expected.tick);
      assert.equal(progress.status, "outcome");
      assert.equal(progress.success, true);
      assert.equal(progress.commandCount, expected.count);
      assert.equal(progress.shots, expected.shots);
      assert.equal(progress.deaths, expected.deaths);
      assert.equal(digest(commands), expected.commandHash);
      assert.deepEqual(progress.outcome, { resultCode: outcome === "win" ? 0 : 1, reasonCode: outcome === "win" ? 1 : 2, ready: true });
      assert.equal(progress.diagnostic, null);
      assert.equal(view.missionStatistics[outcome === "win" ? "1,0,82" : "0,0,73"], outcome === "win" ? 11 : 1);
      assert.equal(digest({ snapshot: view.simulation.snapshot, statistics: view.missionStatistics,
        outcome: view.missionOutcome, diagnostic: view.missionDiagnostic ?? null, bindings: view.nativeBindings }), expected.finalHash);
      assert.equal(digest(mission), sourceHash);
      assert.ok(units >= expected.tick);
      assert.equal(view.callbacks, callbacks);
      assert.ok(rendering.evidence().spriteDraws > 0);
      for (const archive of ["SAWS", "SAUC", "GRAY", "TRSC", "SALA"]) {
        assert.ok(fetched.has(`/assets/generated/animations/${archive}.json`), archive);
      }
      assert.ok(!rendering.evidence().warnings.some(warning => /missing-state|unsupported-timeline|missing-atlas-frame/.test(warning)));
      context.diagnostic(JSON.stringify({ outcome, tick: progress.tick, commands: progress.commandCount,
        commandHash: digest(commands), renderCallbacks: stats, checkpointCalls, semantics: progress.semantics }));
      assert.equal((await runner.step(200)).ticksAdvanced, 0);
    } finally { view.dispose(); }
  });
});
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { serialize } from "node:v8";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { CampaignSession } from "../../src/engine/campaign-session";

const distribution = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  return { p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)] };
};

test("adapted frame performance: real updates with bounded measurement windows", {
  skip: !process.env.DC_FRAME_PERF,
}, async () => {
  const originalFetch = globalThis.fetch, originalClone = globalThis.structuredClone;
  const canvas = () => ({ width: 512, height: 452, getContext: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) }) as unknown as HTMLCanvasElement;
  const samples: { tick: number; ms: number; bytes: number; calls: number; stacks: Record<string, number> }[] = [];
  const timings: { tick: number; ms: number }[] = [];
  let active: typeof samples[number] | undefined;
  globalThis.fetch = async input => new Response(readFileSync(new URL(`../../public${String(input)}`, import.meta.url)));
  globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
    if (active) {
      const bytes = serialize(value).byteLength;
      active.bytes += bytes; active.calls++;
      const stack = new Error().stack!.split("\n").slice(2, 5).join(" <- ");
      active.stacks[stack] = (active.stacks[stack] ?? 0) + bytes;
    }
    return originalClone(value, options);
  }) as typeof structuredClone;
  let view: MissionView | undefined;
  const started = performance.now();
  try {
    const mission = await loadCampaignMission("human", 2, "browser-adapted");
    view = new MissionView(canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
    assert.equal(view.missionDiagnostic, undefined);
    view.update(0);
    for (let tick = 1; tick <= 5005; tick++) {
      const measured = [1000, 2000, 5000].some(start => tick >= start && tick < start + 5);
      if (measured) active = { tick, ms: 0, bytes: 0, calls: 0, stacks: {} };
      const before = performance.now();
      view.update(tick * 50);
      if ([1000, 2000, 5000].some(start => tick >= start - 5 && tick < start)) timings.push({ tick, ms: performance.now() - before });
      if (active) { active.ms = performance.now() - before; samples.push(active); active = undefined; }
      assert.equal(view.missionDiagnostic, undefined, `tick ${tick}`);
      assert.equal(view.simulation.snapshot.tick, tick);
      if ([1004, 2004, 5004].includes(tick)) console.log(JSON.stringify({ tick, wallMs: performance.now() - started }));
    }
    const snapshot = view.campaignSnapshot!;
    const result = { timestamp: new Date().toISOString(), mode: "real HUMAN02 MissionView.update, null canvas, no injected counters or world state; existing AI/guards only",
      wallMs: performance.now() - started, samples,
      windows: [1000, 2000, 5000].map(start => {
        const window = samples.filter(sample => sample.tick >= start && sample.tick < start + 5);
        return { start, frames: window.length, ms: distribution(timings.filter(sample => sample.tick >= start - 5 && sample.tick < start).map(sample => sample.ms)),
          instrumentedMs: distribution(window.map(sample => sample.ms)),
          cloneBytes: distribution(window.map(sample => sample.bytes)), cloneCalls: distribution(window.map(sample => sample.calls)) };
      }), replayInputs: snapshot.aiSelectorInputs!.length, productionRequests: snapshot.production!.requests.length,
      productionJournal: snapshot.production!.journal.length,
      transportRequests: (snapshot.world.transportState as { requests: unknown[] }).requests.length };
    writeFileSync(process.env.DC_FRAME_PERF!, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result.windows));
  } finally {
    active = undefined; globalThis.fetch = originalFetch; globalThis.structuredClone = originalClone; view?.dispose();
  }
});

test("adapted frame controls: projections detach, forks and rejected frames retain state", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => new Response(readFileSync(new URL(`../../public${String(input)}`, import.meta.url)));
  try {
    const mission = await loadCampaignMission("human", 2, "browser-adapted");
    const { sourceBrowserCampaignSessionOptions } = await import("../../src/engine/source-browser-campaign-options");
    const session = new CampaignSession(sourceBrowserCampaignSessionOptions(mission as never));
    const saved = session.checkpoint(), fork = session.fork();
    const context = session.browserFrameContext(150);
    const originalClone = globalThis.structuredClone;
    let alignmentClones = 0;
    globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
      if (new Error().stack?.includes("validateNativeAiTaskAlignment")) alignmentClones++;
      return originalClone(value, options);
    }) as typeof structuredClone;
    let result: ReturnType<CampaignSession["stepForBrowserView"]>;
    try {
      result = fork.stepForBrowserView({ clockMilliseconds: 50, productionVisits: context.productionVisits });
    } finally { globalThis.structuredClone = originalClone; }
    assert.equal(alignmentClones, 0);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const committed = fork.checkpoint();
    result.value.transport.slots.fill(null);
    (result.value.world.source.placementRows[0] as number[])[0] = -999;
    assert.deepEqual(fork.checkpoint(), committed);
    assert.deepEqual(session.checkpoint(), saved);
    const projection = fork.adaptedTroProjection!;
    assert.strictEqual(fork.adaptedTroProjection, projection);
    assert.throws(() => (projection.state.sharedVision[0] as number[]).fill(0));
    assert.equal(fork.stepForBrowserView({ clockMilliseconds: 100, productionVisits: [] }).ok, false);
    assert.deepEqual(fork.checkpoint(), committed);
    assert.strictEqual(fork.adaptedTroProjection, projection);
    const restored = CampaignSession.restore(JSON.parse(JSON.stringify(committed)));
    assert.deepEqual(restored.checkpoint(), committed);
    const input = { clockMilliseconds: 100, productionVisits: fork.browserFrameContext(150).productionVisits };
    assert.equal(fork.stepForBrowserView(input).ok, true);
    assert.equal(restored.step(input).ok, true);
    assert.deepEqual(restored.checkpoint(), fork.checkpoint());
    assert.notStrictEqual(fork.adaptedTroProjection, projection);
  } finally { globalThis.fetch = originalFetch; }
});
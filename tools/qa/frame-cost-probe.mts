import { readFileSync } from "node:fs";
import { loadReleaseMission } from "/Users/rafael/Downloads/darkcolony/tools/qa/fixtures/release-mission";
import { MissionView } from "/Users/rafael/Downloads/darkcolony/src/mission-view";
import { installSourceRender } from "/Users/rafael/Downloads/darkcolony/tools/qa/fixtures/source-render";

const root = new URL("file:///Users/rafael/Downloads/darkcolony/");
const [faction, number, ticks] = [process.argv[2] as "human" | "alien", Number(process.argv[3]), Number(process.argv[4] ?? 600)];
const renderer = installSourceRender(); renderer.setEnabled(false);
globalThis.fetch = (async (input: unknown) => new Response(readFileSync(new URL(`public${String(input)}`, root)))) as typeof fetch;
const mission = await loadReleaseMission(faction, number);
const view = new MissionView(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
await view.initialize(); view.resetClock(); view.update(0);
const samples: number[] = [];
for (let tick = 1; tick <= ticks; tick++) {
  const start = performance.now();
  view.update(tick * 50);
  samples.push(performance.now() - start);
  if (view.missionDiagnostic || view.missionOutcome?.ready) break;
}
const sorted = [...samples].sort((a, b) => a - b), pct = (p: number) => sorted[Math.floor(p * (sorted.length - 1))].toFixed(1);
const windowMean = (from: number) => (samples.slice(from, from + 100).reduce((a, b) => a + b, 0) / Math.min(100, samples.length - from)).toFixed(1);
console.log(JSON.stringify({ mission: `${faction}${number}`, ticks: samples.length, p50: pct(0.5), p95: pct(0.95), max: pct(1),
  firstHundred: windowMean(0), lastHundred: windowMean(Math.max(0, samples.length - 100)), diagnostic: view.missionDiagnostic ?? null }));

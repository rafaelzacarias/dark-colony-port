import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { MissionView } from "../../src/mission-view";
import { CampaignSession } from "../../src/engine/campaign-session";
import { transportHostState } from "../../src/engine/transport-host";
import { createNativeCombatMissionFixture, nativeCombatInput, nativeCombatPacket } from "./fixtures/native-combat-mission";

const stringify = JSON.stringify, clone = globalThis.structuredClone;
type Metric = { calls: number; ms: number };
let metrics: Record<string, Metric> = {};
const record = <Value>(name: string, operation: () => Value): Value => {
  const start = performance.now();
  try { return operation(); }
  finally {
    const metric = metrics[name] ??= { calls: 0, ms: 0 };
    metric.calls++;
    metric.ms += performance.now() - start;
  }
};
JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => {
  const name = typeof args[1] === "function" ? "canonicalStringify" : "otherStringify";
  const value = args[0];
  if (name === "canonicalStringify" && value?.profiles && value?.bindings)
    return record("taskCanonicalStringify", () => record(name, () => stringify(...args)));
  return record(name, () => stringify(...args));
}) as typeof JSON.stringify;
globalThis.structuredClone = ((...args: Parameters<typeof structuredClone>) =>
  record("structuredClone", () => clone(...args))) as typeof structuredClone;
const fork = CampaignSession.prototype.fork;
CampaignSession.prototype.fork = function () { return record("fork", () => fork.call(this)); };
const snapshot = Object.getOwnPropertyDescriptor(CampaignSession.prototype, "snapshot")!;
Object.defineProperty(CampaignSession.prototype, "snapshot", { ...snapshot,
  get() { return record("session.snapshot", () => snapshot.get!.call(this)); } });
const step = CampaignSession.prototype.step;
CampaignSession.prototype.step = function (input) { return record("step", () => step.call(this, input)); };
const restore = CampaignSession.restore;
let restores = 0;
CampaignSession.restore = (...args) => { restores++; return restore(...args); };

try {
  const start = performance.now();
  const { mission, column, row } = await createNativeCombatMissionFixture();
  console.log("PROFILE", stringify({ timestamp: new Date().toISOString(), node: process.version,
    fixtureMs: performance.now() - start, scope: "same first 20 native view advances; no restore/browser" }));
  const canvas = { width: 512, height: 452, getContext: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) } as unknown as HTMLCanvasElement;
  const init = performance.now();
  const view = new MissionView(canvas, {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
  assert.equal(view.missionDiagnostic, undefined);
  console.log("viewInitMs", performance.now() - init);
  const durations: number[] = [];
  for (let frame = 1; frame <= 20; frame++) {
    metrics = {};
    const inputStart = performance.now(), state = view.campaignSnapshot!;
    const source = frame === 17 ? transportHostState(state.world).slots.find(actor => actor?.key.startsWith("transport:") && actor.team === 0) : null;
    const input = nativeCombatInput(state, source ? [nativeCombatPacket(source.slot, column + 2, row, 7)] : undefined);
    const inputReadMs = performance.now() - inputStart, inputMetrics = metrics;
    metrics = {};
    const advance = performance.now();
    view.advanceNativeCombat(input);
    const advanceMs = performance.now() - advance;
    durations.push(advanceMs);
    console.log("FRAME", stringify({ frame, inputReadMs, advanceMs, metrics, inputMetrics }));
  }
  const final = view.campaignSnapshot!, host = transportHostState(final.world);
  assert.equal(final.cycleCounter, 20);
  assert.equal(final.world.entities.length, 23);
  console.log("SIZES", stringify({ snapshot: stringify(final).length,
    taskConfig: stringify(host.nativeAiTasks!.configuration).length, profileCount: host.nativeAiTasks!.configuration.profiles.length,
    finalSha256: createHash("sha256").update(stringify(final)).digest("hex") }));
  console.log("SUMMARY", stringify({ frames: durations.length, totalAdvanceMs: durations.reduce((sum, duration) => sum + duration, 0),
    earlyMeanMs: durations.slice(0, 5).reduce((sum, duration) => sum + duration, 0) / 5,
    lateMeanMs: durations.slice(15).reduce((sum, duration) => sum + duration, 0) / 5, restoreCalls: restores }));
} finally {
  JSON.stringify = stringify;
  globalThis.structuredClone = clone;
  CampaignSession.prototype.fork = fork;
  CampaignSession.prototype.step = step;
  Object.defineProperty(CampaignSession.prototype, "snapshot", snapshot);
  CampaignSession.restore = restore;
}
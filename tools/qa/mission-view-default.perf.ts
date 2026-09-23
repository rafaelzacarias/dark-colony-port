import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Session } from "node:inspector/promises";
import { pathToFileURL } from "node:url";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { CampaignSession } from "../../src/engine/campaign-session";
import { findPath } from "../../src/engine/pathfinding";
import { installSourceRender } from "./fixtures/source-render";

function distribution(values: number[]) {
  const sorted = values.slice().sort((left, right) => left - right);
  return { count: sorted.length, p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
    max: sorted.at(-1) ?? 0, total: sorted.reduce((sum, value) => sum + value, 0) };
}

export async function measureDefaultMission(profile = false) {
  const rendering = installSourceRender();
  const originalFetch = globalThis.fetch;
  const publicRoot = new URL("../../public/", import.meta.url);
  const fetched = new Set<string>();
  const counters: Record<string, { calls: number; milliseconds: number }> = {};
  const restorers: (() => void)[] = [];
  const inspector = profile ? new Session() : undefined;
  let view: MissionView | undefined;
  let recording = false, callbackCount = 0;
  const renders: number[] = [];
  const updates: number[] = [];
  const simulationOnly: number[] = [];
  const instrument = (prototype: object, key: string, label: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
    const original = descriptor?.get ?? descriptor?.value;
    assert.equal(typeof original, "function", label);
    const wrapped = function(this: unknown, ...args: unknown[]) {
      if (!recording) return Reflect.apply(original, this, args);
      const start = performance.now();
      try { return Reflect.apply(original, this, args); }
      finally {
        const counter = counters[label] ??= { calls: 0, milliseconds: 0 };
        counter.calls += 1;
        counter.milliseconds += performance.now() - start;
      }
    };
    Object.defineProperty(prototype, key, { ...descriptor, ...(descriptor?.get ? { get: wrapped } : { value: wrapped }) });
    restorers.push(() => Object.defineProperty(prototype, key, descriptor!));
  };
  globalThis.fetch = async input => {
    const url = String(input);
    assert.ok(url.startsWith("/assets/generated/") && !url.includes(".."));
    fetched.add(url);
    return new Response(readFileSync(new URL(url.slice(1), publicRoot)));
  };
  try {
    const initializationStart = performance.now();
    const mission = await loadCampaignMission("alien");
    assert.equal(mission.sourceResource?.resourceLifecycle.nativeHarvest, undefined);
    view = new MissionView(rendering.canvas(), {} as HTMLElement,
      { onStats() {}, onUnitsChanged() { if (recording) callbackCount += 1; } }, mission);
    assert.equal(view.mission.sourceNativeCombat, undefined);
    await view.initialize();
    assert.equal(view.missionDiagnostic, undefined);
    const initializationMilliseconds = performance.now() - initializationStart;
    view.update(0);
    for (let tick = 1; tick <= 220; tick += 1) view.update(tick * 50);
    assert.equal(view.simulation.snapshot.tick, 220);
    assert.equal(view.missionDiagnostic, undefined);
    const initial = view.simulation.snapshot;
    const owned = initial.units.filter(unit => view!.isOwnedUnit(unit.id) && unit.activity !== "die");
    assert.equal(owned.length, 5, "AL01 must have delivered the real five-unit player group");
    for (const key of ["snapshot", "resourceActors"]) instrument(DeterministicSimulation.prototype, key, `simulation.${key}`);
    for (const key of ["snapshot", "journal"]) instrument(CampaignSession.prototype, key, `session.${key}`);
    for (const key of ["constructionVisuals", "resourceSources", "carrierVisuals", "visibility"])
      instrument(MissionView.prototype, key, `view.${key}`);
    instrument(MissionView.prototype, "renderBoundedMode3", "view.renderBoundedMode3");
    const originalRender = view.render;
    view.render = function() {
      const start = performance.now();
      try { originalRender.call(this); }
      finally { if (recording) renders.push(performance.now() - start); }
    };
    recording = true;
    const selectionStart = performance.now();
    view.selectAllPlayerUnits();
    const selectAllMilliseconds = performance.now() - selectionStart;
    const selectionCounters = structuredClone(counters);
    const leader = owned[0];
    const blocked = new Set(initial.staticTargets.filter(unit => unit.health > 0)
      .map(unit => view!.grid.index(unit.cellX, unit.cellY)));
    const goals = [...mission.tags.entries()].filter(([, tag]) => (tag & 63) === 4)
      .map(([index]) => ({ x: index % mission.map.width, y: mission.map.height - 1 - Math.floor(index / mission.map.width) }));
    const path = goals.map(goal => findPath(view!.grid, { x: leader.cellX, y: leader.cellY }, goal, { blocked }))
      .find(candidate => candidate && candidate.length > 8);
    assert.ok(path);
    const target = path[8];
    view.setCameraCenter(target.x + 0.5, target.y + 0.5);
    view.setOrderMode("move");
    const commandStart = performance.now();
    view.commandAt(256, 226);
    const commandMilliseconds = performance.now() - commandStart;
    for (const key of Object.keys(counters)) delete counters[key];
    renders.length = 0;
    callbackCount = 0;
    const beforeDraws = rendering.evidence();
    if (inspector) {
      inspector.connect();
      await inspector.post("Profiler.enable");
      await inspector.post("Profiler.start");
    }
    for (let tick = 221; tick <= 340; tick += 1) {
      const start = performance.now();
      view.update(tick * 50);
      const elapsed = performance.now() - start;
      updates.push(elapsed);
      simulationOnly.push(elapsed - renders.at(-1)!);
    }
    const cpu = inspector ? (await inspector.post("Profiler.stop")).profile : undefined;
    recording = false;
    const frameCounters = structuredClone(counters);
    const renderCounters: typeof counters = {};
    for (const key of Object.keys(counters)) delete counters[key];
    recording = true;
    view.render();
    recording = false;
    Object.assign(renderCounters, counters);
    const final = view.simulation.snapshot;
    assert.equal(final.tick, 340);
    assert.equal(view.missionDiagnostic, undefined);
    assert.equal(callbackCount, 120);
    assert.ok(owned.some(unit => final.units.some(current => current.id === unit.id &&
      (current.xSubcells !== unit.xSubcells || current.ySubcells !== unit.ySubcells))), "real queued movement must advance");
    const evidence = rendering.evidence();
    assert.ok(evidence.spriteDraws > beforeDraws.spriteDraws);
    assert.ok(!evidence.warnings.some(warning => /missing-state|unsupported-timeline/.test(warning)));
    const samples = new Map<number, number>();
    for (const id of cpu?.samples ?? []) samples.set(id, (samples.get(id) ?? 0) + 1);
    const hotFunctions = cpu?.nodes.map(node => ({ name: node.callFrame.functionName,
      file: node.callFrame.url.replace(/^.*\/darkcolony\//, ""), line: node.callFrame.lineNumber + 1,
      samples: samples.get(node.id) ?? 0 })).sort((left, right) => right.samples - left.samples).slice(0, 25);
    return { scope: "default AL01; actual assets; software canvas call fixture, no raster/GPU/DOM timing",
      initializationMilliseconds, ticks: [220, 340], entities: initial.units.length + initial.staticTargets.length,
      mobileUnits: initial.units.length, staticTargets: initial.staticTargets.length,
      playerUnits: owned.length, selectAllMilliseconds, commandMilliseconds, selectionCounters,
      updateWithRender: distribution(updates), updateWithoutRender: distribution(simulationOnly),
      render: distribution(renders.slice(0, 120)), frameCounters, renderCounters, callbackCount,
      terrain: view.terrainRendererStatus, images: evidence.images.length, fetched: fetched.size,
      spriteDraws: evidence.spriteDraws - beforeDraws.spriteDraws, warnings: evidence.warnings,
      stateHash: createHash("sha256").update(JSON.stringify({ final, campaign: view.campaignSnapshot,
        selection: view.selectedIds, explored: [...view.explored] })).digest("hex"), hotFunctions };
  } finally {
    recording = false;
    inspector?.disconnect();
    restorers.reverse().forEach(restore => restore());
    view?.dispose();
    globalThis.fetch = originalFetch;
    rendering.dispose();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await measureDefaultMission(process.argv.includes("--profile")), null, 2));
}
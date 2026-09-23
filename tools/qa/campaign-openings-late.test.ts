import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { parseTriggerScript } from "../extractors/data/triggers";
import { installSourceRender } from "./fixtures/source-render";

const root = new URL("../../", import.meta.url);
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const read = (path: string) => readFileSync(new URL(path, root));

test("opening judge late: full original mission12 conditions through c>240", async context => {
  const started = performance.now();
  const manifest = JSON.parse(read("asset_manifest.json").toString("utf8"));
  const paths: string[] = manifest.files.map((entry: { path: string }) => entry.path)
    .filter((path: string) => /^DC\/SCENARIO\/(HUMAN|ALIEN)\/\1\d{2}\.(SCN|TRO|MAP)$/.test(path));
  const before = Object.fromEntries(paths.map(path => [path, hash(read(`raw_cd/${path}`))]));
  assert.equal(paths.length, 90);
  const runtimePaths = readdirSync(new URL("src/", root), { recursive: true }).map(String).filter(path => /\.ts$/.test(path));
  const runtimeBefore = Object.fromEntries(runtimePaths.map(path => [path, hash(read(`src/${path}`))]));
  const rendering = installSourceRender();
  const gl = new Proxy({ NO_ERROR: 0, drawingBufferWidth: 512, drawingBufferHeight: 452,
    isContextLost: () => false, getError: () => 0, getParameter: () => 16384,
    getShaderParameter: () => true, getProgramParameter: () => true },
  { get: (target, key) => Reflect.get(target, key) ?? (() => ({})) });
  context.mock.method(document, "createElement", () => {
    const canvas = rendering.canvas();
    const getContext = canvas.getContext.bind(canvas);
    Object.assign(canvas, { getContext: (type: string) => type === "webgl2" ? gl : getContext(type as "2d"),
      addEventListener() {}, removeEventListener() {} });
    return canvas;
  });
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    return new Response(Uint8Array.from(read(`public${path}`)).buffer);
  });
  const rows: Record<string, any>[] = [];
  try {
    for (const faction of ["human", "alien"] as const) {
      const stem = `${faction.toUpperCase()}/${faction.toUpperCase()}12`;
      const row: Record<string, any> = { stem, targetTick: 3900, initialized: false, firstFailure: null };
      rows.push(row);
      const missionStarted = performance.now();
      let view: MissionView | undefined;
      try {
        const mission = await loadCampaignMission(faction, 12, "browser-adapted");
        const source = read(`raw_cd/DC/SCENARIO/${stem}.SCN`);
        const originalTro = read(`raw_cd/DC/SCENARIO/${stem}.TRO`);
        assert.equal(hash(Buffer.from(mission.scenario.rawScenario!, "base64")), hash(source));
        assert.deepEqual(mission.triggers, parseTriggerScript(originalTro.toString("latin1")));
        row.source = { scn: hash(source), tro: hash(originalTro), fullOriginal: true };
        view = new MissionView(rendering.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
        await view.initialize();
        assert.equal(view.missionDiagnostic ?? null, null);
        row.initialized = true;
        view.update(0);
        for (let tick = 1; tick <= row.targetTick; tick++) {
          row.attemptedTick = tick;
          view.update(tick * 50);
          if (view.missionDiagnostic) throw new Error(view.missionDiagnostic);
          if (view.missionOutcome?.ready) break;
        }
        assert.equal(hash(Buffer.from(mission.scenario.rawScenario!, "base64")), hash(source));
        assert.deepEqual(mission.triggers, parseTriggerScript(originalTro.toString("latin1")));
      } catch (error) {
        row.firstFailure = { tick: view?.simulation.snapshot.tick ?? null,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : null };
      } finally {
        if (view) {
          const saved = view.checkpoint();
          row.tick = view.simulation.snapshot.tick;
          row.diagnostic = view.missionDiagnostic ?? null;
          row.outcome = view.missionOutcome;
          row.sourceIdentityHash = hash(saved.sourceIdentity);
          row.checkpointHash = hash(JSON.stringify(saved));
          row.world = saved.session?.state.world;
          row.controller = view.campaignSnapshot?.controller;
          row.commands = view.campaignJournal.flatMap(frame => frame.commands);
          row.requests = view.campaignJournal.flatMap(frame => frame.requests);
          row.statistics = Object.fromEntries(Object.entries(view.missionStatistics).filter(([, value]) => value !== 0));
          row.resources = view.simulation.snapshot.resources;
          row.economy = view.browserEconomyState;
          view.dispose();
        }
        row.elapsedMilliseconds = Math.round(performance.now() - missionStarted);
      }
    }
  } finally {
    rendering.dispose();
    const after = Object.fromEntries(paths.map(path => [path, hash(read(`raw_cd/${path}`))]));
    const runtimeAfter = Object.fromEntries(runtimePaths.map(path => [path, hash(read(`src/${path}`))]));
    const output = process.env.DC_OPENINGS_LATE_OUTPUT ?? `/tmp/dc-openings-late-${Date.now()}.json`;
    writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(),
      scope: "Initialized real MissionView, full original conditions, 3900 natural ticks, no injected input",
      elapsedMilliseconds: Math.round(performance.now() - started), missions: rows,
      sourceIntegrity: { files: paths.length, before, after },
      runtimeIntegrity: { before: runtimeBefore, after: runtimeAfter,
        changed: runtimePaths.filter(path => runtimeBefore[path] !== runtimeAfter[path]) } }, null, 2));
    assert.deepEqual(after, before);
    context.diagnostic(output);
  }
  assert.equal(rows.length, 2);
});
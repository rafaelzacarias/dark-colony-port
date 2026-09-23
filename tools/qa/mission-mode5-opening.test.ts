import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { installSourceRender } from "./fixtures/source-render";

for (const faction of ["alien", "human"] as const) test(`${faction} real opening loads GLAT indexed metadata before tick 220`, async context => {
  const fetched = new Set<string>();
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    fetched.add(path);
    return new Response(Uint8Array.from(readFileSync(new URL(`../../public${path}`, import.meta.url))).buffer);
  });
  const rendering = installSourceRender();
  const gl = new Proxy({
    NO_ERROR: 0, drawingBufferWidth: 512, drawingBufferHeight: 452,
    isContextLost: () => false, getError: () => 0, getParameter: () => 16384,
    getShaderParameter: () => true, getProgramParameter: () => true,
  }, { get: (target, key) => Reflect.get(target, key) ?? (() => ({})) });
  context.mock.method(document, "createElement", () => {
    const canvas = rendering.canvas();
    const getContext = canvas.getContext.bind(canvas);
    Object.assign(canvas, {
      getContext: (type: string) => type === "webgl2" ? gl : getContext(type as "2d"),
      addEventListener() {}, removeEventListener() {},
    });
    return canvas;
  });
  let view: MissionView | undefined;
  try {
    const mission = await loadCampaignMission(faction);
    view = new MissionView(rendering.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
    await view.initialize();
    assert.equal(view.missionDiagnostic, undefined);
    assert.equal(view.terrainRendererStatus, "indexed-webgl2");
    assert.ok(fetched.has("/assets/generated/indexed/sprites/SPRITES/GLAT.json"));
    if (faction === "alien") assert.ok(rendering.evidence().images.includes("/assets/generated/sprites/SPRITES/GLAT.png"));
    const loaded = [...fetched];
    view.update(0);
    for (let tick = 1; tick <= 220; tick++) view.update(tick * 50);
    assert.equal(view.missionDiagnostic, undefined);
    assert.equal(view.simulation.snapshot.tick, 220);
    assert.deepEqual([...fetched], loaded);
    assert.ok(!rendering.evidence().warnings.some(warning => warning.includes("mode5-effect-indexed-source-required")));
    const effect = faction === "alien" ? "CENT:glat" : "BEAC:beac";
    assert.ok(rendering.evidence().warnings.some(warning => warning.includes(`${effect}:mode5-effect-canvas-state-unverified`)),
      rendering.evidence().warnings.join("\n"));
    context.diagnostic(JSON.stringify({ faction, terrain: view.terrainRendererStatus,
      spriteDraws: rendering.evidence().spriteDraws, warnings: rendering.evidence().warnings }));
  } finally {
    view?.dispose();
    rendering.dispose();
  }
});
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MissionView } from "../../src/mission-view";
import { loadReleaseMission } from "./fixtures/release-mission";

test("held camera movement renders once per animation frame with identical motion and simulation", async context => {
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    return new Response(Uint8Array.from(readFileSync(new URL(`../../public${path}`, import.meta.url))));
  });
  const mission = await loadReleaseMission("human", 10);
  const canvas = { width: 512, height: 452, getContext: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) } as unknown as HTMLCanvasElement;
  const create = () => new MissionView(canvas, {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
  const immediate = create(), deferred = create();
  context.after(() => { immediate.dispose(); deferred.dispose(); });
  for (const view of [immediate, deferred]) {
    assert.equal(view.missionDiagnostic, undefined);
    view.setCameraCenter(view.grid.width / 2, view.grid.height / 2);
    view.update(0);
  }
  const originalRender = deferred.render.bind(deferred);
  const renderedCameras: MissionView["cameraView"][] = [];
  const renders = context.mock.method(deferred, "render", () => {
    originalRender();
    renderedCameras.push(deferred.cameraView);
  });
  const immediateRenders = context.mock.method(immediate, "render");
  const start = deferred.cameraView;

  for (let frame = 1; frame <= 60; frame++) {
    immediate.panByCells(0.2, 0.1);
    deferred.panByCells(0.2, 0.1, false);
    assert.equal(renders.mock.callCount(), frame - 1, "Panning updates state without an extra draw");
    immediate.update(frame * 1000 / 60);
    deferred.update(frame * 1000 / 60);
    assert.equal(renders.mock.callCount(), frame, "Every animation frame still renders, not every other frame");
    assert.equal(immediateRenders.mock.callCount(), frame * 2, "Default immediate rendering remains compatible");
    assert.deepEqual(renderedCameras.at(-1), immediate.cameraView, "Camera movement appears in this frame, not the next");
    assert.equal(deferred.missionDiagnostic, undefined);
  }
  assert.ok(Math.abs(deferred.cameraView.x - start.x - 12) < 1e-9);
  assert.ok(Math.abs(deferred.cameraView.y - start.y - 6) < 1e-9);
  assert.equal(deferred.simulation.snapshot.tick, immediate.simulation.snapshot.tick);
  assert.deepEqual(deferred.checkpoint(), immediate.checkpoint());

  deferred.panByCells(0, 0.35, false);
  assert.equal(renders.mock.callCount(), 60, "A quick tap waits only for the next normal frame");
  deferred.update(61 * 1000 / 60);
  assert.equal(renders.mock.callCount(), 61);
  assert.deepEqual(renderedCameras.at(-1), deferred.cameraView);
});

test("phone panning is applied before the existing uncapped animation-loop update", () => {
  const main = readFileSync(new URL("../../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /onPan: \(x, y\) => withMobileMission\(mission => mission\.panByCells\(x, y, false\)\)/);
  const animate = main.slice(main.indexOf("function animate("), main.indexOf("function layoutMissionShell("));
  assert.match(animate, /mobileControls\?\.tick\(time\);[\s\S]*?skirmish\?\.update\(time\);/);
  assert.match(animate, /skirmish\?\.update\(time\);[\s\S]*?requestAnimationFrame\(animate\)/);
});

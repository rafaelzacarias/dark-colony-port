import assert from "node:assert/strict";
import test from "node:test";
import { worldYToScreen, screenYToWorld } from "../../src/render/coordinates";
import { radarClientToMap, radarMarkers, radarViewRect } from "../../src/ui/radar";

test("runtime Y projects upward while source tile rows join in their stored order", () => {
  const height = 84;
  for (let sourceRow = 0; sourceRow < height - 1; sourceRow += 1) {
    const runtimeY = height - 1 - sourceRow;
    const top = worldYToScreen(runtimeY + 1, 42, 452, 32);
    const nextTop = worldYToScreen(runtimeY, 42, 452, 32);
    assert.equal(nextTop - top, 32);
    assert.equal(screenYToWorld(top + 16, 42, 452, 32), runtimeY + 0.5);
  }
});

test("radar picking, marker, and camera rectangle agree on upward runtime Y", () => {
  const map = { width: 96, height: 84 };
  const surface = { width: 96, height: 84 };
  const bounds = { left: 0, top: 0, ...surface };
  const markers = radarMarkers(map, surface, {
    visible: new Uint8Array(96 * 84), view: { x: 0, y: 0, width: 16, height: 14 },
    entities: [{ id: 1, cellX: 22, cellY: 2, owned: true, health: 100 }],
  });
  assert.deepEqual(markers[0], { id: 1, x: 22.5, y: 81.5, owned: true, kind: "unit" });
  assert.deepEqual(radarClientToMap(markers[0], bounds, surface, map), { x: 22.5, y: 2.5 });
  assert.deepEqual(radarViewRect(map, surface, { x: 14, y: 0, width: 16, height: 14 }),
    { x: 14, y: 70, width: 16, height: 14 });
});
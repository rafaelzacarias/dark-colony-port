import assert from "node:assert/strict";
import test from "node:test";
import { drawTerrainLayer, terrainLayerMirrored } from "../../src/render/terrain";

test("MAP bits 5 and 6 independently mirror background and foreground", () => {
  for (let attributes = 0; attributes < 65536; attributes += 1) {
    assert.equal(terrainLayerMirrored(attributes, 0), (attributes >>> 5 & 1) === 1);
    assert.equal(terrainLayerMirrored(attributes, 1), (attributes >>> 6 & 1) === 1);
  }
  assert.equal(terrainLayerMirrored(0x1f, 0), false);
  assert.equal(terrainLayerMirrored(0x1f, 1), false);
});

test("mirrors only destination X inside the tile and restores canvas state", () => {
  const calls: unknown[][] = [];
  const context = {
    save: () => calls.push(["save"]), restore: () => calls.push(["restore"]),
    translate: (...values: number[]) => calls.push(["translate", ...values]),
    scale: (...values: number[]) => calls.push(["scale", ...values]),
    drawImage: (...values: unknown[]) => calls.push(["draw", ...values]),
  } as unknown as CanvasRenderingContext2D;
  const image = {} as CanvasImageSource;
  const tile = { x: 64, y: 96, width: 32, height: 32 };
  const destination = { x: 100, y: 200, width: 32, height: 32 };
  drawTerrainLayer(context, image, tile, destination, 0x20, 0);
  assert.deepEqual(calls, [["save"], ["translate", 132, 200], ["scale", -1, 1],
    ["draw", image, 64, 96, 32, 32, 0, 0, 32, 32], ["restore"]]);
  calls.length = 0;
  drawTerrainLayer(context, image, tile, destination, 0x20, 1);
  assert.deepEqual(calls, [["draw", image, 64, 96, 32, 32, 100, 200, 32, 32]]);
});
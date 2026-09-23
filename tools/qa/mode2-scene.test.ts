import assert from "node:assert/strict";
import test from "node:test";
import { composeFinSample } from "../../src/render/fin-composition";
import { createMissionSceneFrame } from "../../src/render/mission-scene-frame";
import { registerNativePaletteImage } from "../../src/render/mode1-canvas";
import { composeNativeMode2, drawNativeMode2Indexed } from "../../src/render/mode2-shadow";
import { MODE5_PIXEL_BUDGET } from "../../src/render/mode5-effect";
import { RemapTable } from "../../src/render/palette";
import { canvas, rgba } from "./mode2-test-helpers";

function fixture(options: { modes?: number[]; mirrored?: boolean; width?: number; height?: number;
  x?: number; y?: number; cameraX?: number } = {}) {
  const width = options.width ?? 3, height = options.height ?? 1;
  const position = { x: options.x ?? 128, y: options.y ?? 128, heightOffset: 0 };
  const camera = { x: options.cameraX ?? 0, y: 0, width: 512, height: 512 };
  const mission = { map: { width: 16, height: 16 },
    tileRecordIndices: new Uint16Array(512), attributes: new Uint16Array(256) };
  const palette = Uint8Array.from({ length: 768 }, (_, offset) => Math.floor(offset / 3));
  const table = new Uint8Array(196608);
  for (let index = 0; index < 256; index++) {
    table[72 * 256 + index] = (index + 12) & 255;
    table[65536 + 256 + index] = (index + 1) & 255;
  }
  const sprite = { width, height, indices: new Uint8Array(width * height).fill(1),
    coverage: new Uint8Array(width * height).fill(255) };
  const remap = new RemapTable(table), image = {} as CanvasImageSource;
  registerNativePaletteImage(image, { ...sprite, palette, remap, selector: 7 });
  const entities = (options.modes ?? [2]).map((valueA, index) => {
    const child = { sprite: "ZERO", frame: 0, x: 0, y: 0, layer: 0, flags: 16,
      valueA, valueB: options.mirrored ? 1 : 0 };
    const sample = { children: [child], timelineIndex: 0, finished: false };
    const parts = composeFinSample(sample, () => ({ index: 0, x: 0, y: 0, width, height,
      anchorX: 0, anchorY: 0, empty: false }));
    return { rawSlot: 120 + index, xSubcells: position.x * 8 * 4,
      ySubcells: (mission.map.height * 256 - position.y * 8 - 1) * 4, heightSubcells: 0,
      sample, parts, fallbackOrigin: { x: position.x - camera.x, y: position.y } };
  });
  const pixels = rgba(new Uint8Array(camera.width * camera.height).fill(7), palette);
  const drawing = canvas(pixels, camera.width), calls: string[] = [];
  for (const name of ["save", "restore", "translate", "scale", "drawImage", "strokeRect", "beginPath", "rect", "clip"] as const) {
    drawing.context[name] = () => { calls.push(name); };
  }
  const input = { mission, indexed: undefined, camera, entities };
  return { ...drawing, input, image, pixels, calls, sprite, palette, remap, position,
    scene: createMissionSceneFrame(input) };
}

test("mode2 scene uses registered palette metadata and native Q8 placement without a body draw", () => {
  const input = fixture();
  assert.deepEqual(input.scene.commands[0].source.position, input.position);
  input.scene.drawEntity(input.context, 120, () => input.image);
  assert.deepEqual(input.scene.mode2Results.get("120:0"), { exact: true, readbackPixels: 3 });
  assert.deepEqual(input.counts, { reads: 1, writes: 1, readPixels: 3 });
  assert.deepEqual(input.calls, []);
  assert.deepEqual([...input.pixels.slice((127 * 512 + 128) * 4, (127 * 512 + 131) * 4)],
    [19, 19, 19, 255, 19, 19, 19, 255, 19, 19, 19, 255]);
  assert.ok(!input.scene.commands[0].diagnostics.includes("native-draw-mode:2"));
  assert.ok(!input.scene.commands[0].diagnostics.includes("scene-mode-unverified"));
  assert.ok(input.input.entities[0].parts[0].diagnostics.includes("native-draw-mode:2"));
  assert.equal(input.scene.orderingVerified, false);
  assert.equal(input.scene.globalOrder, null);
});

for (const mirrored of [false, true]) {
  test(`mode2 scene includes stretched and sheared terrain cells, mirrored:${mirrored}`, () => {
    const input = fixture({ width: 3, height: 32, mirrored });
    for (let row = 0; row < 32; row++) input.sprite.coverage[row * 3 + (row % 3)] = 0;
    const terrain = Array.from(input.input.mission.attributes, (attributes, index) => ({
      kind: "terrain" as const, column: index % 16, row: Math.floor(index / 16),
      backgroundIndex: 0, foregroundIndex: 0, attributes,
    }));
    const plan = composeNativeMode2({ part: input.input.entities[0].parts[0],
      sprite: input.sprite, position: input.position, terrain });
    assert.ok(plan.shadow.some(pixel => pixel.x < 128 && pixel.y < 96), "projection leaves body rows and columns");
    const expected = { ...input.input.camera, indices: new Uint8Array(512 * 512).fill(7) };
    drawNativeMode2Indexed(expected, plan, input.remap);
    input.scene.drawEntity(input.context, 120, () => input.image);
    assert.equal(input.scene.mode2Results.get("120:0")?.exact, true);
    assert.deepEqual(input.pixels, rgba(expected.indices, input.palette));
    assert.deepEqual(input.calls, []);
  });
}

test("mode2 missing mask in a shadow-only stretched row rejects atomically before the original fallback", () => {
  const input = fixture({ width: 3, height: 32 });
  for (const row of [2, 4]) {
    const cell = row * 16 + 3;
    input.input.mission.tileRecordIndices[cell * 2 + 1] = 1;
    input.input.mission.attributes[cell] = 15;
  }
  const scene = createMissionSceneFrame(input.input), before = input.pixels.slice();
  scene.drawEntity(input.context, 120, () => input.image);
  const result = scene.mode2Results.get("120:0")!;
  assert.equal(result.exact, false);
  assert.match(result.diagnostic!, /missing shadow ground mask/);
  assert.deepEqual(input.counts, { reads: 0, writes: 0, readPixels: 0 });
  assert.deepEqual(input.pixels, before);
  assert.deepEqual(input.calls, ["save", "translate", "scale", "drawImage", "restore"]);
  assert.equal(scene.commands[0].clips, null);
  assert.ok(scene.commands[0].diagnostics.includes("native-draw-mode:2"));
  assert.ok(scene.commands[0].diagnostics.includes("scene-mode-unverified"));
  assert.ok(scene.commands[0].diagnostics.includes(result.diagnostic!));
});

test("mode2 unaligned mission camera remains unchanged and takes diagnosed fallback", () => {
  const input = fixture({ cameraX: 1 }), before = input.pixels.slice();
  input.scene.drawEntity(input.context, 120, () => input.image);
  assert.deepEqual(input.scene.mode2Results.get("120:0"), {
    exact: false, diagnostic: "mode2-shadow-viewport-invalid", readbackPixels: 0,
  });
  assert.equal(input.input.camera.x, 1);
  assert.deepEqual(input.pixels, before);
  assert.equal(input.counts.reads, 0);
  assert.equal(input.calls.filter(name => name === "drawImage").length, 1);
  assert.ok(!input.calls.includes("clip"));
});

test("mode2 command diagnostics recover on success and are restored on subsequent fallback", () => {
  const input = fixture(), command = input.scene.commands[0];
  command.diagnostics.push("unrelated-proof-required");
  const aggregate = [...input.scene.diagnostics];
  input.context.filter = "blur(1px)";
  input.scene.drawEntity(input.context, 120, () => input.image);
  assert.ok(command.diagnostics.includes("mode2-shadow-canvas-state-unverified"));
  input.context.filter = "none";
  input.calls.length = 0;
  input.scene.drawEntity(input.context, 120, () => input.image);
  assert.deepEqual(command.diagnostics, ["unrelated-proof-required"]);
  assert.deepEqual(input.calls, []);
  input.context.filter = "blur(1px)";
  for (let attempt = 0; attempt < 2; attempt++) input.scene.drawEntity(input.context, 120, () => input.image);
  assert.equal(command.diagnostics.filter(issue => issue === "native-draw-mode:2").length, 1);
  assert.equal(command.diagnostics.filter(issue => issue === "scene-mode-unverified").length, 1);
  assert.equal(command.diagnostics.filter(issue => issue === "mode2-shadow-canvas-state-unverified").length, 1);
  assert.ok(command.diagnostics.includes("unrelated-proof-required"));
  assert.deepEqual(input.scene.diagnostics, aggregate);
  assert.ok(input.input.entities[0].parts[0].diagnostics.includes("native-draw-mode:2"));
});

for (const modes of [[2, 5], [5, 2]]) {
  for (const failedReadback of [false, true]) {
    test(`mode2/mode5 share one budget across repeated entity draws: ${modes}, failed readback:${failedReadback}`, () => {
      const input = fixture({ modes, width: 176, height: 160, x: 160, y: 256 });
      if (failedReadback) {
        const read = input.context.getImageData.bind(input.context);
        input.context.getImageData = (...args: Parameters<typeof read>) => {
          read(...args);
          throw new Error("readback unavailable");
        };
      }
      const results = (mode: number) => mode === 2 ? input.scene.mode2Results : input.scene.mode5Results;
      const charged: number[] = [];
      for (const index of [0, 1]) {
        input.scene.drawEntity(input.context, 120 + index, () => input.image);
        const result = results(modes[index]).get(`${120 + index}:0`)!;
        assert.equal(result.exact, !failedReadback);
        assert.ok(result.readbackPixels > 0);
        if (failedReadback) {
          assert.equal(result.exact, false);
          assert.match(result.diagnostic, /readback-unavailable$/);
        }
        charged.push(result.readbackPixels);
      }
      assert.ok(charged[0] * 2 + charged[1] <= MODE5_PIXEL_BUDGET);
      assert.ok((charged[0] + charged[1]) * 2 > MODE5_PIXEL_BUDGET);
      input.scene.drawEntity(input.context, 120, () => input.image);
      assert.equal(results(modes[0]).get("120:0")!.readbackPixels, charged[0]);
      const beforeRefusal = input.counts.readPixels;
      input.scene.drawEntity(input.context, 121, () => input.image);
      assert.deepEqual(results(modes[1]).get("121:0"), { exact: false, readbackPixels: 0,
        diagnostic: modes[1] === 2 ? "mode2-shadow-readback-budget" : "mode5-effect-readback-budget" });
      assert.equal(input.counts.readPixels, beforeRefusal);
      assert.equal(input.counts.readPixels, charged[0] * 2 + charged[1]);
      assert.ok(input.counts.readPixels <= MODE5_PIXEL_BUDGET);
      assert.equal(input.counts.reads, 3);
      assert.equal(input.counts.writes, failedReadback ? 0 : 3);
      assert.equal(input.calls.filter(name => name === "drawImage").length, failedReadback ? 4 : 1);
    });
  }
}
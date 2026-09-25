import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseFin } from "../extractors/animations/fin";
import { parseSprite } from "../extractors/sprites/spr";
import { composeFinSample, drawFinComposition } from "../../src/render/fin-composition";
import { readNativeGifPalette, RemapTable } from "../../src/render/palette";
import { drawBrowserMode5Canvas, registerNativeEffectMission } from "../../src/render/mode5-canvas";

const source = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url));
const animation = parseFin(source("ANIMATE/DROP.FIN"));
const child = animation.timeline.flatMap(frame => frame.children).find(child => child.sprite.toUpperCase() === "GLIT" && child.valueA === 5)!;
const sprite = parseSprite(source("SPRITES/GLIT.SPR")).frames[child.frame];
const part = composeFinSample({ children: [child], timelineIndex: 0, finished: false },
  () => ({ ...sprite, index: child.frame, x: 0, y: 0, empty: false }))[0];

for (const bank of ["DESERT", "JUNGLE", "HTRAIN", "ATLANTIS"]) for (const mirrored of [false, true]) {
  test(`${bank}: dropship flames use original effect colors (${mirrored ? "mirrored" : "ordinary"}), not gray atlas RGB`, () => {
    const palette = readNativeGifPalette(source(`${bank}.GIF`)), remap = new RemapTable(source(`${bank}.RMP`));
    const mission = {};
    const unregister = registerNativeEffectMission(mission, { palette, remap,
      sources: new Map([["GLIT", { ...sprite, coverage: sprite.alpha }]]) });
    const width = sprite.width, height = sprite.height, pixels = new Uint8ClampedArray(width * height * 4);
    for (let offset = 3; offset < pixels.length; offset += 4) pixels[offset] = 255;
    let commits = 0;
    const context = { canvas: { width, height },
      getImageData: () => ({ width, height, data: pixels.slice() }),
      putImageData: (image: ImageData) => { pixels.set(image.data); commits++; },
    } as unknown as CanvasRenderingContext2D;
    const effect = { ...part, mirrored, child: { ...part.child, valueB: Number(mirrored) } };
    try {
      const result = drawBrowserMode5Canvas({ context, mission, part: effect, scale: 1, origin: { x: -part.x, y: -part.y } });
      assert.deepEqual(result, { drawn: true });
      assert.equal(commits, 1);
      let warmPixels = 0;
      for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
        const input = row * width + (mirrored ? width - 1 - column : column), output = (row * width + column) * 4;
        const color = sprite.alpha[input] ? remap.lookup(1, sprite.indices[input], 0) : 0;
        assert.deepEqual([...pixels.subarray(output, output + 3)], [...palette.subarray(color * 3, color * 3 + 3)]);
        if (pixels[output] > 150 && pixels[output + 1] > 35 && pixels[output] > pixels[output + 2] * 1.5) warmPixels++;
      }
      assert.ok(warmPixels > 10, `${warmPixels} warm flame pixels`);
      const before = pixels.slice();
      assert.equal(drawBrowserMode5Canvas({ context, mission, part: effect, scale: 1, origin: { x: -1000, y: -1000 } }).drawn, true);
      assert.deepEqual(pixels, before);
      assert.equal(commits, 1);
    } finally { unregister(); }
  });
}

test("FIN composition routes effect layers through the compositor without recoloring unit bodies", () => {
  const drawn: string[] = [], context = { save() {}, restore() {}, translate() {}, scale() {},
    drawImage() { drawn.push("body"); } } as unknown as CanvasRenderingContext2D;
  const body = { ...part, child: { ...part.child, valueA: 0 } };
  drawFinComposition(context, [body, part], () => ({} as CanvasImageSource), { x: 0, y: 0 }, 1,
    () => { drawn.push("effect"); return true; });
  assert.deepEqual(drawn, ["body", "effect"]);
});

test("browser effects preserve holes, blend with destination color, and reject invalid input without writes", () => {
  const palette = readNativeGifPalette(source("DESERT.GIF")), remap = new RemapTable(source("DESERT.RMP"));
  const mission = {}, indices = Uint8Array.of(64, 65, 66, 67), coverage = Uint8Array.of(1, 0, 1, 1);
  const unregister = registerNativeEffectMission(mission, { palette, remap,
    sources: new Map([["GLIT", { width: 2, height: 2, indices, coverage }]]) });
  const effect = { ...part, x: 0, y: 0, mirrored: false,
    child: { ...part.child, valueB: 0 }, frame: { ...part.frame!, x: 0, y: 0, width: 2, height: 2 } };
  const pixels = new Uint8ClampedArray(16);
  for (let pixel = 0; pixel < 4; pixel++) { pixels.set(palette.subarray(300, 303), pixel * 4); pixels[pixel * 4 + 3] = 255; }
  let reads = 0, writes = 0;
  const context = { canvas: { width: 2, height: 2 },
    getImageData: () => { reads++; return { width: 2, height: 2, data: pixels.slice() }; },
    putImageData: (image: ImageData) => { writes++; pixels.set(image.data); },
  } as unknown as CanvasRenderingContext2D;
  try {
    const input = { context, mission, part: effect, origin: { x: 0, y: 0 }, scale: 1 };
    assert.equal(drawBrowserMode5Canvas({ ...input, scale: 2 }).drawn, false);
    assert.deepEqual([reads, writes], [0, 0]);
    assert.equal(drawBrowserMode5Canvas(input).drawn, true);
    for (let pixel = 0; pixel < 4; pixel++) {
      const index = coverage[pixel] ? remap.lookup(1, indices[pixel], 100) : 100;
      assert.deepEqual([...pixels.subarray(pixel * 4, pixel * 4 + 3)], [...palette.subarray(index * 3, index * 3 + 3)]);
    }
    assert.deepEqual([reads, writes], [1, 1]);
    unregister();
    assert.equal(drawBrowserMode5Canvas(input).drawn, false);
    assert.deepEqual([reads, writes], [1, 1]);
  } finally { unregister(); }
});

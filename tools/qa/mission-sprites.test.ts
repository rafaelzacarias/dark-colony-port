import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { CampaignMissionData } from "../../src/game-data";
import { adaptedGoldExtractorIndices, createMissionSpritePalettes, remapSpritePixels } from "../../src/render/mission-sprites";
import { nativePaletteImage } from "../../src/render/mode1-canvas";
import { RemapTable } from "../../src/render/palette";
import { finBodyPaletteLookup, initializePublishedMissionPalette } from "../../src/render/palette-init";
import { parseSprite } from "../extractors/sprites/spr";

test("FIN body colors use bank 2 and team selector without dropping covered index zero", () => {
  const table = new Uint8Array(196608);
  const palette = new Uint8Array(768);
  table[2 * 65536 + 130 * 256] = 7;
  table[2 * 65536 + 135 * 256] = 9;
  palette.set([20, 30, 40], 7 * 3);
  palette.set([50, 60, 70], 9 * 3);
  const indices = Uint8Array.of(0, 0);
  const coverage = Uint8Array.of(255, 0);
  const remap = new RemapTable(table);
  assert.deepEqual([...remapSpritePixels(indices, coverage, remap, palette, 2)], [20, 30, 40, 255, 0, 0, 0, 0]);
  assert.deepEqual([...remapSpritePixels(indices, coverage, remap, palette, 7)], [50, 60, 70, 255, 0, 0, 0, 0]);
  assert.throws(() => remapSpritePixels(indices, new Uint8Array(1), remap, palette, 2), RangeError);
});

const assetBytes = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
const assetJson = (path: string) => JSON.parse(assetBytes(path).toString());

function actualPaletteSources(bank: string) {
  const root = "public/assets/generated/indexed/";
  const manifest = assetJson(`${root}index.json`);
  const entry = manifest.palettes.find((palette: { name: string }) => palette.name === bank);
  assert.ok(entry, bank);
  const metadata = assetJson(root + entry.metadata);
  const display = assetBytes(root + metadata.display.path);
  const remap = assetBytes(root + metadata.remap.path);
  const gif = assetBytes(`raw_cd/DC/${bank}.GIF`);
  const nativeDisplay = Buffer.from(gif.subarray(13, 781));
  nativeDisplay.fill(0, 0, 3);
  nativeDisplay.fill(255, 765);
  assert.deepEqual(display, nativeDisplay);
  assert.deepEqual(remap, assetBytes(`raw_cd/DC/${bank}.RMP`));
  return { display, remap };
}

test("native EXPL gold is source team trim, not a gold body: mobile and deployed day/night", () => {
  const source = assetBytes("raw_cd/DC/SPRITES/EXPL.SPR");
  const original = parseSprite(source);
  const root = "public/assets/generated/indexed/";
  const metadata = assetJson(`${root}sprites/SPRITES/EXPL.json`);
  assert.equal(metadata.source.sha256, createHash("sha256").update(source).digest("hex"));
  assert.equal(metadata.source.sha256, "1eed4f57075ff91589caaba490079b58394ce9fad282a4a06648a1db8362a721");
  const indices = assetBytes(root + metadata.indices.path);
  const coverage = assetBytes(root + metadata.coverage.path);
  const animation = assetJson("public/assets/generated/animations/EXPL.json");
  for (const [name, frameIndex] of [["EXPLSTAND0", 0], ["EXPLMOVE0", 0], ["EDPLYSTAND14", 34], ["EDPLYSTAND2", 34]] as const) {
    const state = animation.states.find((state: { name: string }) => state.name === name);
    assert.ok(state, name);
    const child = animation.timeline[state.firstTimelineIndex].children[0];
    assert.equal(child.sprite, "expl");
    assert.equal(child.frame, frameIndex);
    assert.equal(child.valueA, 1);
  }
  const expectedTeam140 = [
    [159, 19, 19, 255], [23, 67, 159, 255], [159, 159, 0, 255], [127, 27, 159, 255],
    [67, 159, 0, 255], [35, 35, 35, 255], [159, 111, 67, 255], [0, 159, 159, 255],
  ];
  for (const bank of ["DESERT", "ATLANTIS", "HTRAIN", "JUNGLE"]) {
    const { display, remap } = actualPaletteSources(bank);
    for (const frameIndex of [0, 34]) {
      const frame = original.frames[frameIndex];
      const atlasFrame = metadata.frames[frameIndex];
      for (let row = 0; row < frame.height; row += 1) {
        const offset = (atlasFrame.y + row) * metadata.atlas.width + atlasFrame.x;
        assert.deepEqual(indices.subarray(offset, offset + frame.width),
          Buffer.from(frame.indices.subarray(row * frame.width, (row + 1) * frame.width)));
        assert.deepEqual(coverage.subarray(offset, offset + frame.width),
          Buffer.from(frame.alpha.subarray(row * frame.width, (row + 1) * frame.width)));
      }
      const teamPixel = frame.indices.findIndex((index, offset) => index === 140 && frame.alpha[offset] !== 0);
      const bodyPixel = frame.indices.findIndex((index, offset) => index === 31 && frame.alpha[offset] !== 0);
      assert.ok(teamPixel >= 0 && bodyPixel >= 0, `Required source pixels in frame ${frameIndex}`);
      assert.deepEqual(original.palette[31], { red: 30, green: 30, blue: 30 });
      for (let selector = 0; selector < 8; selector += 1) {
        let daytime: Uint8ClampedArray | undefined;
        for (const phase of [0, 1]) {
          const initialized = initializePublishedMissionPalette({ terrainBank: `${bank}.BTS`,
            rawHeader: ["", String(phase)], teams: Array.from({ length: 8 }, (_, index) =>
              ({ index, teamColor: (index + selector) % 8 })) }, display, remap);
          const lookup = finBodyPaletteLookup(0, 8, initialized.teamSelectors);
          assert.equal(lookup.selector, selector);
          const pixels = remapSpritePixels(frame.indices, frame.alpha,
            initialized.remap, initialized.palette, lookup.selector);
          assert.deepEqual([...pixels.subarray(teamPixel * 4, teamPixel * 4 + 4)], expectedTeam140[selector]);
          assert.deepEqual([...pixels.subarray(bodyPixel * 4, bodyPixel * 4 + 4)], [123, 123, 123, 255]);
          for (let offset = 0; offset < frame.indices.length; offset += 1) {
            if (!frame.alpha[offset]) {
              assert.deepEqual([...pixels.subarray(offset * 4, offset * 4 + 4)], [0, 0, 0, 0]);
              continue;
            }
            const target = remap[2 * 65536 + (128 + selector) * 256 + frame.indices[offset]];
            assert.deepEqual([...pixels.subarray(offset * 4, offset * 4 + 4)],
              [...display.subarray(target * 3, target * 3 + 3), 255]);
          }
          if (daytime) assert.deepEqual(pixels, daytime);
          else daytime = pixels;
        }
      }
    }
  }
});

test("adapted player gold body uses original gold shades in mobile/deployed frames without flattening details", () => {
  const original = parseSprite(assetBytes("raw_cd/DC/SPRITES/EXPL.SPR"));
  for (const bank of ["DESERT", "ATLANTIS", "HTRAIN", "JUNGLE"]) {
    const { display, remap: table } = actualPaletteSources(bank);
    const remap = new RemapTable(table);
    const originalDisplay = Uint8Array.from(display);
    for (const frameIndex of [0, 34]) {
      const frame = original.frames[frameIndex];
      const originalIndices = Uint8Array.from(frame.indices);
      const indices = adaptedGoldExtractorIndices(frame.indices, display, remap);
      const pixels = remapSpritePixels(indices, frame.alpha, remap, display, 2);
      const native = remapSpritePixels(frame.indices, frame.alpha, remap, display, 2);
      const shades = new Set<number>();
      let formerGray = 0;
      for (let offset = 0; offset < indices.length; offset += 1) {
        const sourceIndex = frame.indices[offset];
        const rgba = [...pixels.subarray(offset * 4, offset * 4 + 4)];
        if (!frame.alpha[offset]) {
          assert.deepEqual(rgba, [0, 0, 0, 0]);
        } else if (sourceIndex >= 8 && sourceIndex <= 31) {
          assert.ok(indices[offset] >= 138 && indices[offset] <= 143);
          const target = remap.lookup(2, 130, indices[offset]);
          assert.deepEqual(rgba, [...display.subarray(target * 3, target * 3 + 3), 255]);
          assert.ok(rgba[0] > rgba[2] && rgba[1] > rgba[2]);
          shades.add(indices[offset]);
          if (sourceIndex === 31) {
            formerGray += 1;
            assert.equal(indices[offset], 141);
            assert.equal(target, 111);
            assert.deepEqual(rgba, [119, 115, 0, 255]);
            assert.deepEqual([...native.subarray(offset * 4, offset * 4 + 4)], [123, 123, 123, 255]);
          }
        } else {
          assert.equal(indices[offset], sourceIndex);
          assert.deepEqual(rgba, [...native.subarray(offset * 4, offset * 4 + 4)]);
        }
      }
      assert.ok(formerGray > 0);
      assert.ok(shades.size >= 3, `${bank} frame ${frameIndex} retains body shading`);
      assert.deepEqual(frame.indices, originalIndices);
    }
    assert.deepEqual(Uint8Array.from(display), originalDisplay);
  }
});

test("gold body is an isolated adapted player EXPL cache variant with matching indexed and canvas pixels", async (context) => {
  context.mock.method(globalThis, "fetch", async (url: string) =>
    new Response(Uint8Array.from(assetBytes(`public${url}`))));
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  const painted = new WeakMap<object, Uint8ClampedArray>();
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement() {
      const canvas = { width: 0, height: 0, getContext: () => ({
        createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
        putImageData: (data: { data: Uint8ClampedArray }) => painted.set(canvas, data.data),
      }) };
      return canvas;
    },
  } });
  try {
    for (const runtimeProfile of [undefined, "browser-adapted"] as const) {
      const mission = { runtimeProfile, scenario: { terrainBank: "DESERT.BTS", rawHeader: ["", "0"],
        teams: Array.from({ length: 8 }, (_, index) => ({ index, teamColor: (index + 1) % 8 })) } } as unknown as CampaignMissionData;
      const sprites = await createMissionSpritePalettes(mission, ["EXPL", "CURSOR/CURS"]);
      try {
        const native = sprites.image("EXPL", 0, 2)!;
        const variant = sprites.image("expl", 0, 2, "gold-extractor")!;
        assert.equal(sprites.image("EXPL", 0, 2, "gold-extractor"), variant);
        assert.equal(sprites.image("EXPL", 0, 2), native);
        assert.equal(sprites.image("EXPL", 1, 2, "gold-extractor"), sprites.image("EXPL", 1, 2));
        assert.equal(sprites.image("CURSOR/CURS", 0, 2, "gold-extractor"), sprites.image("CURSOR/CURS", 0, 2));
        assert.equal(sprites.image("missing", 0, 2, "gold-extractor"), undefined);
        const nativeAtlas = nativePaletteImage(native)!;
        const atlas = nativePaletteImage(variant)!;
        assert.deepEqual(sprites.indexedImage("EXPL", 0, 2)!.indices, nativeAtlas.indices);
        assert.equal(atlas.coverage, nativeAtlas.coverage);
        assert.equal(atlas.palette, nativeAtlas.palette);
        assert.equal(atlas.remap, nativeAtlas.remap);
        assert.deepEqual(painted.get(variant),
          remapSpritePixels(atlas.indices, atlas.coverage, atlas.remap, atlas.palette, atlas.selector));
        const bodyPixel = nativeAtlas.indices.findIndex((index, offset) => index === 31 && nativeAtlas.coverage[offset] !== 0);
        assert.ok(bodyPixel >= 0);
        assert.equal(nativeAtlas.indices[bodyPixel], 31);
        if (runtimeProfile === "browser-adapted") {
          assert.notEqual(variant, native);
          assert.equal(atlas.selector, 2);
          assert.equal(atlas.indices[bodyPixel], 141);
          assert.deepEqual([...painted.get(variant)!.subarray(bodyPixel * 4, bodyPixel * 4 + 4)], [119, 115, 0, 255]);
        } else {
          assert.equal(variant, native);
          assert.equal(atlas.indices[bodyPixel], 31);
        }
      } finally {
        sprites.dispose();
      }
    }
  } finally {
    if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
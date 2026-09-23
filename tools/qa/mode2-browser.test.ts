import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadMode2BrowserSource, mode2BrowserBackground, mode2BrowserLabel, mode2BrowserPalettes, prepareMode2BrowserScene } from "./fixtures/mode2-browser";
import { withMissionTerrainCoverage, type MissionTerrainInput } from "../../src/render/mission-terrain";
import { createMissionSpritePalettes } from "../../src/render/mission-sprites";
import { registerNativePaletteImage } from "../../src/render/mode1-canvas";
import type { CampaignMissionData } from "../../src/game-data";
import { canvas, rgba } from "./mode2-test-helpers";

const root = new URL("../../public/assets/generated/indexed/", import.meta.url);
const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const animation = json("animations/ALBU.json");
const atlas = json("sprites/SPRITES/ALBU.json");
const indexed = json("terrain/DESERT.json");
const mission = { map: { width: 64, height: 64 }, attributes: new Uint16Array(64 * 64),
  tileRecordIndices: new Uint16Array(64 * 64 * 2) } as MissionTerrainInput;

test("mode2 browser module preserves the genuine source child, frame and index at controlled native placement", () => {
  const before = JSON.stringify(animation);
  const result = prepareMode2BrowserScene({ mission, indexed, animation, frames: atlas.frames });
  assert.equal(result.child, animation.timeline[13].children[2]);
  assert.equal(result.sourceFrame, atlas.frames[21]);
  assert.equal(result.entity.sample.children, animation.timeline[13].children);
  assert.equal(result.entity.parts.length, 1);
  assert.equal(result.entity.parts[0].child, result.child);
  assert.equal(result.resultKey, "120:2");
  assert.deepEqual(result.scene.commands[0].source.position, result.position);
  const height = result.sourceFrame.height + Math.floor(result.sourceFrame.height * 40 / 256);
  const left = result.position.x + result.sourceFrame.anchorX - Math.floor(height / 2);
  assert.ok(left >= result.camera.x);
  assert.ok(left + result.sourceFrame.width + Math.floor((height - 1) / 2) < result.camera.x + result.camera.width - 1);
  assert.ok(result.position.y - height >= result.camera.y);
  assert.ok(result.position.y < result.camera.y + result.camera.height - 1);
  assert.equal(JSON.stringify(animation), before);
  assert.equal(result.scene.orderingVerified, false);
  assert.match(mode2BrowserLabel, /not original world placement/);
});

test("mode2 browser module rejects rewritten children and unsafe cameras", () => {
  const input = { mission, indexed, animation, frames: atlas.frames };
  const changed = structuredClone(animation);
  changed.timeline[13].children[2].x++;
  assert.throws(() => prepareMode2BrowserScene({ ...input, animation: changed }), /unchanged ALBU/);
  for (const camera of [{ x: -32, y: 0, width: 512, height: 452 }, { x: 1, y: 0, width: 512, height: 452 },
    { x: 0, y: 0, width: 511, height: 452 }, { x: 0, y: 0, width: 32, height: 32 }]) {
    assert.throws(() => prepareMode2BrowserScene({ ...input, camera }), /viewport/);
  }
});

test("mode2 browser authenticates source assets and rejects modified manifest/atlas bytes", async context => {
  let corrupt = "";
  context.mock.method(globalThis, "fetch", async (url: string) => {
    const path = url.replace("/assets/generated/indexed/", "");
    const bytes = Uint8Array.from(readFileSync(new URL(path, root)));
    if (path === corrupt) bytes[0] ^= 1;
    return new Response(bytes);
  });
  const source = await loadMode2BrowserSource();
  assert.deepEqual(source.animation, animation);
  assert.equal(source.sprite.frames[21].index, 21);
  assert.equal(source.verified.length, 5);
  assert.equal(source.paletteMetadata.remap.sha256, source.paletteMetadata.sources.find(entry => entry.path === "DESERT.RMP")?.sha256);
  for (const path of ["index.json", "animations/ALBU.json", "sprites/SPRITES/ALBU.indices.r8", "sprites/SPRITES/ALBU.coverage.r8"]) {
    corrupt = path;
    await assert.rejects(loadMode2BrowserSource(), /checksum mismatch|hash mismatch/);
  }
});

for (const palette of mode2BrowserPalettes) test(`${palette} fixture placement changes original HUMAN01 terrain-mask destination through the scene adapter`, async context => {
  context.mock.method(globalThis, "fetch", async (url: string) => new Response(Uint8Array.from(readFileSync(
    new URL(url.replace("/assets/generated/indexed/", ""), root)))));
  const maps = new URL("../maps/HUMAN/", root);
  const map = JSON.parse(readFileSync(new URL("HUMAN01.json", maps), "utf8"));
  const words = (path: string) => {
    const bytes = readFileSync(new URL(path, maps));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Uint16Array.from({ length: bytes.length / 2 }, (_, index) => view.getUint16(index * 2, true));
  };
  const published = { map, attributes: words(map.files.attributes), tileReferences: words(map.files.tileReferences),
    tileRecordIndices: words(map.files.tileRecordIndices), scenario: { terrainBank: `${palette}.BTS`, rawHeader: ["", "0"],
      teams: Array.from({ length: 8 }, (_, index) => ({ index, teamColor: index })) } } as unknown as CampaignMissionData;
  const coverage = withMissionTerrainCoverage(indexed, Uint8Array.from(readFileSync(new URL(indexed.indices.path, root))));
  const source = await loadMode2BrowserSource(palette);
  const palettes = await createMissionSpritePalettes(published, ["ALBU"]);
  try {
    const atlas = palettes.indexedImage("ALBU", 0)!;
    const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
    assert.equal(digest(atlas.palette), source.paletteMetadata.display.sha256);
    assert.equal(digest(atlas.remap.toTextureBytes()), source.paletteMetadata.remap.sha256);
    assert.equal(digest(atlas.indices), source.sprite.indices.sha256);
    assert.equal(digest(atlas.coverage), source.sprite.coverage.sha256);
    const background = mode2BrowserBackground(atlas);
    const prepared = prepareMode2BrowserScene({ mission: published, indexed: coverage, animation: source.animation, frames: source.sprite.frames });
    const pixels = rgba(new Uint8Array(512 * 452).fill(background.index), atlas.palette);
    const before = pixels.slice(), drawing = canvas(pixels, 512);
    let bodyDraws = 0;
    drawing.context.drawImage = () => { bodyDraws++; };
    const image = {} as CanvasImageSource;
    registerNativePaletteImage(image, atlas);
    prepared.scene.drawEntity(drawing.context, 120, () => image);
    assert.equal(prepared.scene.mode2Results.get("120:2")?.exact, true);
    assert.ok(drawing.counts.readPixels > 0);
    assert.equal(drawing.counts.reads, 1);
    assert.equal(drawing.counts.writes, 1);
    assert.equal(bodyDraws, 0);
    assert.notDeepEqual(pixels, before);
    assert.deepEqual(prepared.scene.commands[0].diagnostics, []);
  } finally { palettes.dispose(); }
});
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, readdir, readlink, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { readNativeGifPalette } from "../../../src/render/palette";
import { parseScenario } from "../data/scenario";
import { parseTerrainBank, resolveTerrainReferences } from "../maps/bts";
import type { SpriteAtlasFrame } from "../sprites/atlas";
import { parseSprite } from "../sprites/spr";
import { extractIndexedAssets, sha256 } from "./extract";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const corpus = path.join(root, "raw_cd/DC");
const existing = path.join(root, "public/assets/generated");

function verifyRows(atlas: Buffer, width: number, rectangle: { x: number; y: number; width: number; height: number }, source: Uint8Array): void {
  for (let row = 0; row < rectangle.height; row += 1) {
    const offset = (rectangle.y + row) * width + rectangle.x;
    assert.deepEqual(atlas.subarray(offset, offset + rectangle.width),
      Buffer.from(source.subarray(row * rectangle.width, (row + 1) * rectangle.width)));
  }
}

test("real corpus: deterministic publication, complete existing SPR layouts, exact indices and coverage", {
  skip: !existsSync(path.join(corpus, "DESERT.GIF")),
}, async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "dc-indexed-corpus-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const output = path.join(temporary, "indexed");
  const first = await extractIndexedAssets(corpus, output);
  assert.equal(first.paletteCount, 5);
  assert.equal(first.terrainBankCount, 4);
  assert.equal(first.tileCount, 4764);
  assert.equal(first.archiveCount, 284);
  assert.equal(first.frameCount, 9730);
  assert.equal(first.emptyFrameCount, 26);
  assert.equal(first.animationFileCount, 177);
  assert.equal(first.animationCount, 164);
  assert.deepEqual(first.verifiedInitialPalettes, ["ATLANTIS", "DESERT", "HTRAIN", "JUNGLE"]);
  const shortRmp = first.diagnostics.find((entry) => entry.code === "unsupported-rmp-size");
  assert.equal(shortRmp?.source, "SCENARIO/MPLAYER/PALETTE.RMP");
  assert.equal(shortRmp?.bytes, 67584);

  for (const palette of first.palettes) {
    assert.equal(palette.display.bytes, 768);
    assert.equal(palette.remap.bytes, 196608);
    assert.equal(palette.rgb555.bytes, 32768);
    const native = readNativeGifPalette(await readFile(path.join(corpus, `${palette.name}.GIF`)));
    assert.deepEqual(await readFile(path.join(output, palette.display.path)), Buffer.from(native));
    assert.deepEqual(await readFile(path.join(output, palette.remap.path)), await readFile(path.join(corpus, `${palette.name}.RMP`)));
    assert.deepEqual(await readFile(path.join(output, palette.rgb555.path)), await readFile(path.join(corpus, `${palette.name}.RGB`)));
  }

  const previousIndex = JSON.parse(await readFile(path.join(existing, "sprites/index.json"), "utf8")) as { archives: { source: string }[] };
  assert.deepEqual(first.sprites.map((entry) => entry.source).sort(), previousIndex.archives.map((entry) => entry.source).sort());
  let coveredLiteralZero = 0;
  for (const sprite of first.sprites) {
    const document = JSON.parse(await readFile(path.join(output, sprite.metadata), "utf8")) as {
      atlas: { width: number; height: number }; frames: SpriteAtlasFrame[];
    };
    const legacy = JSON.parse(await readFile(path.join(existing, "sprites", sprite.source.replace(/\.SPR$/i, ".json")), "utf8"));
    assert.deepEqual(document.frames, legacy.frames, sprite.source);
    assert.equal(document.atlas.width, legacy.atlas.width, sprite.source);
    assert.equal(document.atlas.height, legacy.atlas.height, sprite.source);
    const archive = parseSprite(await readFile(path.join(corpus, sprite.source)));
    const indices = await readFile(path.join(output, sprite.indices.path));
    const coverage = await readFile(path.join(output, sprite.coverage.path));
    assert.equal(indices.length, document.atlas.width * document.atlas.height);
    assert.equal(coverage.length, indices.length);
    for (const placement of document.frames) {
      const frame = archive.frames[placement.index];
      verifyRows(indices, document.atlas.width, placement, frame.indices);
      verifyRows(coverage, document.atlas.width, placement, frame.alpha);
      if (archive.encoding === "compressed") {
        coveredLiteralZero += frame.indices.reduce((total, value, offset) => total + Number(value === 0 && frame.alpha[offset] === 255), 0);
      }
    }
  }
  context.diagnostic(`Compressed covered literal-zero pixels preserved: ${coveredLiteralZero}`);

  for (const terrain of first.terrain) {
    const bank = parseTerrainBank(await readFile(path.join(corpus, terrain.source)));
    const document = JSON.parse(await readFile(path.join(output, terrain.metadata), "utf8"));
    const legacy = JSON.parse(await readFile(path.join(existing, "terrain", `${terrain.name}.json`), "utf8"));
    assert.deepEqual(document.tiles, legacy.tiles);
    assert.equal(document.atlas.width, legacy.atlas.width);
    assert.equal(document.atlas.height, legacy.atlas.height);
    const indices = await readFile(path.join(output, document.indices.path));
    const background = await readFile(path.join(output, document.backgroundCoverage.path));
    const foreground = await readFile(path.join(output, document.foregroundCoverage.path));
    for (const placement of document.tiles) {
      const tile = bank.tiles[placement.recordIndex];
      verifyRows(indices, document.atlas.width, placement, tile.indices);
      verifyRows(background, document.atlas.width, placement, new Uint8Array(1024).fill(255));
      verifyRows(foreground, document.atlas.width, placement, tile.indices.map((value) => value === 0 ? 0 : 255));
    }
    const allKeys = Uint16Array.from({ length: bank.keySpace * 2 }, (_, offset) => Math.floor(offset / 2));
    const resolved = resolveTerrainReferences(bank, allKeys);
    assert.deepEqual(document.keyToRecord, Array.from(resolved.recordIndices.filter((_, offset) => offset % 2 === 0)));
  }

  for (const mission of first.missions) {
    const document = JSON.parse(await readFile(path.join(output, mission.metadata), "utf8"));
    const scenario = parseScenario(await readFile(path.join(corpus, document.source.path), "ascii"));
    assert.equal(document.teams.length, 8);
    assert.equal(document.dayNightBlend, Number(scenario.rawHeader[1]) * 256);
    assert.equal(document.visibleTerrain.selector, Number(scenario.rawHeader[1]) * 7);
  }
  for (const entry of first.outputs) {
    const bytes = await readFile(path.join(output, entry.path));
    assert.equal(bytes.length, entry.bytes, entry.path);
    assert.equal(sha256(bytes), entry.sha256, entry.path);
  }
  const indexBytes = await readFile(path.join(output, "index.json"));
  assert.equal(await readFile(path.join(output, "index.sha256"), "utf8"), `${sha256(indexBytes)}  index.json\n`);
  const target = await readlink(output);
  const second = await extractIndexedAssets(corpus, output);
  assert.deepEqual(second, first);
  assert.deepEqual(await readFile(path.join(output, "index.json")), indexBytes);
  assert.equal(await readlink(output), target);
});

test("terrain palette metadata verifies only four banks and initializes all 108 source SCNs in isolation", async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "dc-all-terrain-palettes-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const source = path.join(temporary, "source");
  const output = path.join(temporary, "indexed");
  await mkdir(path.join(source, "ANIMATE"), { recursive: true });
  for (const bank of ["ATLANTIS", "DESERT", "HTRAIN", "JUNGLE", "PALETTE"]) {
    for (const extension of ["GIF", "RGB", "RMP"]) {
      const file = `${bank}.${extension}`;
      await copyFile(path.join(corpus, file), path.join(source, file));
    }
  }
  for (const relative of await readdir(path.join(corpus, "SCENARIO"), { recursive: true })) {
    if (!relative.endsWith(".SCN")) continue;
    const file = path.join("SCENARIO", relative);
    await mkdir(path.dirname(path.join(source, file)), { recursive: true });
    await copyFile(path.join(corpus, file), path.join(source, file));
  }
  const manifest = await extractIndexedAssets(source, output);
  assert.deepEqual(manifest.verifiedInitialPalettes, ["ATLANTIS", "DESERT", "HTRAIN", "JUNGLE"]);
  assert.equal(manifest.missions.length, 108);
  assert.equal(new Set(manifest.missions.map(({ metadata }) => metadata)).size, 108);
  for (const palette of manifest.palettes) {
    const metadata = JSON.parse(await readFile(path.join(output, palette.metadata), "utf8"));
    assert.equal(metadata.verifiedInitialUse, palette.name !== "PALETTE");
    assert.deepEqual(await readFile(path.join(output, palette.display.path)),
      Buffer.from(readNativeGifPalette(await readFile(path.join(corpus, `${palette.name}.GIF`)))));
    assert.deepEqual(await readFile(path.join(output, palette.remap.path)), await readFile(path.join(corpus, `${palette.name}.RMP`)));
  }
  const counts: Record<string, number> = {};
  for (const mission of manifest.missions) {
    const metadata = JSON.parse(await readFile(path.join(output, mission.metadata), "utf8"));
    const scenario = parseScenario(await readFile(path.join(corpus, metadata.source.path), "ascii"));
    const bank = scenario.terrainBank.replace(/\.bts$/i, "").toUpperCase();
    assert.equal(metadata.palette, bank);
    assert.equal(metadata.dayNightBlend, Number(scenario.rawHeader[1]) * 256);
    assert.deepEqual(metadata.visibleTerrain, { bank: 0, brightness: 16, selector: Number(scenario.rawHeader[1]) * 7 });
    assert.deepEqual(metadata.teams, scenario.teams.map(({ index, teamColor }) => ({ index, teamColor,
      selector: teamColor >= 0 && teamColor <= 7 ? teamColor : index })));
    counts[bank] = (counts[bank] ?? 0) + 1;
  }
  assert.deepEqual(counts, { DESERT: 45, JUNGLE: 42, HTRAIN: 15, ATLANTIS: 6 });
  for (const name of ["HUMAN01", "ALIEN01"]) {
    assert.equal(manifest.missions.find((mission) => mission.name === name)?.metadata, `missions/${name}.json`);
  }
});

test("atomic pointer replacement preserves old generations and failed builds leave current output intact", async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "dc-indexed-atomic-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const source = path.join(temporary, "source");
  const output = path.join(temporary, "indexed");
  await mkdir(path.join(source, "ANIMATE"), { recursive: true });
  const gif = Buffer.alloc(13 + 768, 17);
  gif.write("GIF89a", 0, "ascii");
  gif[10] = 0x87;
  await writeFile(path.join(source, "DESERT.GIF"), gif);
  await writeFile(path.join(source, "DESERT.RMP"), Buffer.alloc(196608));
  await writeFile(path.join(source, "DESERT.RGB"), Buffer.alloc(32768));
  await extractIndexedAssets(source, output);
  const initial = await readlink(output);
  const oldIndex = await readFile(path.join(output, "index.json"));
  gif[20] = 33;
  await writeFile(path.join(source, "DESERT.GIF"), gif);
  await extractIndexedAssets(source, output);
  const current = await readlink(output);
  assert.notEqual(current, initial);
  assert.deepEqual(await readFile(path.join(temporary, initial, "index.json")), oldIndex);
  await writeFile(path.join(source, "DESERT.GIF"), gif.subarray(0, 15));
  await assert.rejects(extractIndexedAssets(source, output), /Truncated GIF/);
  assert.equal(await readlink(output), current);
  await writeFile(path.join(source, "DESERT.RMP"), Buffer.alloc(67584));
  await assert.rejects(extractIndexedAssets(source, output), /DESERT palette triple is required/);
  assert.equal(await readlink(output), current);
  const realDirectory = path.join(temporary, "ordinary-directory");
  await mkdir(realDirectory);
  await writeFile(path.join(realDirectory, "keep"), "untouched");
  await assert.rejects(extractIndexedAssets(source, realDirectory), /absent path or symlink/);
  assert.equal(await readFile(path.join(realDirectory, "keep"), "utf8"), "untouched");
});
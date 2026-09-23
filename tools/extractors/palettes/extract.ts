import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { readNativeGifPalette, RemapTable, RgbLookupTable, RMP_TABLE_BYTES } from "../../../src/render/palette";
import { initializeMissionPalette, missionPaletteBank, VERIFIED_TERRAIN_PALETTES } from "../../../src/render/palette-init";
import { extractAnimationTree } from "../animations/extract";
import { parseScenario } from "../data/scenario";
import { parseTerrainBank } from "../maps/bts";
import { parseSprite } from "../sprites/spr";
import { createIndexedSpriteAtlas, createIndexedTerrainAtlas } from "./atlas";

export interface FileDigest {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface IndexedDiagnostic {
  readonly code: string;
  readonly source: string;
  readonly bytes?: number;
  readonly message: string;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function filesUnder(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(relative: string): Promise<void> {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) files.push(name);
    }
  }
  await visit("");
  return files.sort();
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function extractIndexedAssets(sourceDirectory: string, outputDirectory: string) {
  const sourceRoot = path.resolve(sourceDirectory);
  const outputRoot = path.resolve(outputDirectory);
  if (await exists(outputRoot) && !(await lstat(outputRoot)).isSymbolicLink()) {
    throw new Error(`Atomic indexed publication requires an absent path or symlink: ${outputRoot}`);
  }
  const generations = path.join(path.dirname(outputRoot), `.${path.basename(outputRoot)}-generations`);
  await mkdir(generations, { recursive: true });
  const staging = await mkdtemp(path.join(generations, ".build-"));
  const pointer = `${staging}.link`;
  const outputs: FileDigest[] = [];
  const sources = new Map<string, FileDigest>();
  const diagnostics: IndexedDiagnostic[] = [];
  async function read(source: string): Promise<Buffer> {
    const bytes = await readFile(path.join(sourceRoot, source));
    sources.set(source, { path: source, bytes: bytes.length, sha256: sha256(bytes) });
    return bytes;
  }
  async function write(file: string, bytes: Uint8Array): Promise<FileDigest> {
    await mkdir(path.dirname(path.join(staging, file)), { recursive: true });
    await writeFile(path.join(staging, file), bytes);
    const digest = { path: file, bytes: bytes.length, sha256: sha256(bytes) };
    outputs.push(digest);
    return digest;
  }
  async function metadata(file: string, value: unknown): Promise<string> {
    await write(file, jsonBytes(value));
    return file;
  }
  async function texture(file: string, bytes: Uint8Array, width: number, height: number, format = "R8UI") {
    return { ...await write(file, bytes), width, height, format };
  }

  try {
    const files = await filesUnder(sourceRoot);
    const byUpper = new Map(files.map((file) => [file.toUpperCase(), file]));
    const palettes = [];
    for (const source of files.filter((file) => file.toUpperCase().endsWith(".RMP"))) {
      const remapBytes = await read(source);
      if (remapBytes.length !== RMP_TABLE_BYTES) {
        diagnostics.push({ code: "unsupported-rmp-size", source, bytes: remapBytes.length,
          message: `Expected ${RMP_TABLE_BYTES} bytes; short/nonstandard RMP is not decoded.` });
        continue;
      }
      if (source.includes("/")) continue;
      const stem = source.slice(0, -4);
      const gifSource = byUpper.get(`${stem.toUpperCase()}.GIF`);
      const rgbSource = byUpper.get(`${stem.toUpperCase()}.RGB`);
      if (!gifSource || !rgbSource) {
        diagnostics.push({ code: "missing-palette-triple", source, message: "Matching root GIF and RGB are required." });
        continue;
      }
      const name = stem.toUpperCase();
      const palette = readNativeGifPalette(await read(gifSource));
      const remap = new RemapTable(remapBytes).toTextureBytes();
      const rgb = new RgbLookupTable(await read(rgbSource)).toTextureBytes();
      const display = await texture(`palettes/${name}.palette.rgb8`, palette, 256, 1, "RGB8UI");
      const rmp = await texture(`palettes/${name}.rmp.r8`, remap, 256, 768);
      const rgb555 = await write(`palettes/${name}.rgb555.bin`, rgb);
      const document = {
        schemaVersion: 1, name, verifiedInitialUse: VERIFIED_TERRAIN_PALETTES.includes(name),
        sources: [gifSource, source, rgbSource].map((file) => sources.get(file)),
        display, remap: rmp, rgb555,
        remapAddress: "bank*65536 + row*256 + sourceIndex",
        rgb555Address: "((red>>>3)<<10) | ((green>>>3)<<5) | (blue>>>3)",
      };
      palettes.push({ name, metadata: await metadata(`palettes/${name}.json`, document), display, remap: rmp, rgb555 });
    }
    if (!palettes.some(({ name }) => name === "DESERT")) throw new Error("DESERT palette triple is required");

    const terrain = [];
    for (const source of files.filter((file) => /^SCENARIO\/[^/]+\.BTS$/i.test(file))) {
      const bank = parseTerrainBank(await read(source));
      const atlas = createIndexedTerrainAtlas(bank);
      const name = path.posix.basename(source, path.posix.extname(source)).toUpperCase();
      const indices = await texture(`terrain/${name}.indices.r8`, atlas.indices, atlas.width, atlas.height);
      const backgroundCoverage = await texture(`terrain/${name}.background.r8`, atlas.backgroundCoverage, atlas.width, atlas.height);
      const foregroundCoverage = await texture(`terrain/${name}.foreground.r8`, atlas.foregroundCoverage, atlas.width, atlas.height);
      const document = {
        schemaVersion: 1, source: sources.get(source), palette: name,
        keySpace: bank.keySpace, atlas: { width: atlas.width, height: atlas.height },
        indices, backgroundCoverage, foregroundCoverage,
        tiles: atlas.tiles, keyToRecord: atlas.keyToRecord,
        missingKeyPolicy: "record-zero; foreground MAP key zero means no foreground",
        transforms: "source-order; apply native MAP layer mirror rules at draw time",
      };
      terrain.push({ name, source, metadata: await metadata(`terrain/${name}.json`, document), tileCount: bank.tiles.length });
    }

    const sprites = [];
    for (const source of files.filter((file) => file.toUpperCase().endsWith(".SPR"))) {
      const archive = parseSprite(await read(source));
      const atlas = createIndexedSpriteAtlas(archive);
      const stem = `sprites/${source.slice(0, -4)}`;
      const indices = await texture(`${stem}.indices.r8`, atlas.indices, atlas.width, atlas.height);
      const coverage = await texture(`${stem}.coverage.r8`, atlas.coverage, atlas.width, atlas.height);
      const document = {
        schemaVersion: 1, source: sources.get(source), encoding: archive.encoding,
        flags: archive.flags, storedByteCount: archive.storedByteCount,
        atlas: { width: atlas.width, height: atlas.height }, indices, coverage, frames: atlas.frames,
        coveragePolicy: archive.encoding === "raw" ? "source-zero-transparent" : "decoded-run-coverage-including-literal-zero",
      };
      sprites.push({ source, metadata: await metadata(`${stem}.json`, document),
        encoding: archive.encoding, frameCount: atlas.frames.length,
        emptyFrameCount: atlas.frames.filter((frame) => frame.empty).length,
        atlasWidth: atlas.width, atlasHeight: atlas.height, indices, coverage });
    }

    const animationIndex = await extractAnimationTree(path.join(sourceRoot, "ANIMATE"), path.join(staging, "animations"));
    for (const entry of animationIndex.entries) {
      await read(`ANIMATE/${entry.source}`);
      if (entry.status !== "parsed") diagnostics.push({ code: `fin-${entry.status}`, source: `ANIMATE/${entry.source}`, message: entry.error ?? entry.status });
    }
    for (const file of await filesUnder(path.join(staging, "animations"))) {
      const bytes = await readFile(path.join(staging, "animations", file));
      outputs.push({ path: `animations/${file}`, bytes: bytes.length, sha256: sha256(bytes) });
    }
    const spriteBindings = Object.fromEntries([...new Set(animationIndex.entries.flatMap((entry) => entry.spriteNames ?? []))].sort().map((name) => {
      const source = byUpper.get(`SPRITES/${name.toUpperCase().replace(/\.SPR$/, "")}.SPR`);
      if (!source) diagnostics.push({ code: "missing-fin-sprite", source: name, message: "No matching SPRITES archive; no substitute selected." });
      return [name, source ? `sprites/${source.slice(0, -4)}.json` : null];
    }));
    const animations = await metadata("animations/bindings.json", {
      schemaVersion: 1, index: "animations/index.json", sprites: spriteBindings,
      childFields: "Original FIN child flags/valueA/valueB retained without mode or mirror substitution",
    });

    const missions = [];
    for (const source of files.filter((file) => /^SCENARIO\/.*\.SCN$/i.test(file))) {
      const scenario = parseScenario((await read(source)).toString("ascii"));
      const bank = missionPaletteBank(scenario.terrainBank);
      if (!palettes.some(({ name }) => name === bank)) throw new Error(`Missing mission palette triple: ${bank}`);
      const initialized = initializeMissionPalette(scenario,
        await read(byUpper.get(`${bank}.GIF`)!), await read(byUpper.get(`${bank}.RMP`)!));
      const name = path.posix.basename(source, path.posix.extname(source)).toUpperCase();
      const relative = source.slice("SCENARIO/".length).replace(/\.SCN$/i, ".json");
      const metadataPath = /^(HUMAN\/HUMAN01|ALIEN\/ALIEN01)\.json$/i.test(relative)
        ? `missions/${name}.json` : `missions/${relative}`;
      missions.push({ name, metadata: await metadata(metadataPath, {
        schemaVersion: 1, source: sources.get(source), palette: bank,
        rawHeader: scenario.rawHeader,
        teams: scenario.teams.map(({ index, teamColor }) => ({ index, teamColor, selector: initialized.teamSelectors[index] })),
        dayNight: { phase: Number(scenario.rawHeader[1]), cycleLength: Number(scenario.rawHeader[2]),
          elapsedTicks: Number(scenario.rawHeader[3]), transitionTicks: Number(scenario.rawHeader[4]) },
        dayNightBlend: initialized.dayNightBlend, visibleTerrain: initialized.visibleTerrain,
        entityOwner: "not published; preserve native source owner; never infer from race",
        entityOverride: "not published; 8 selects owner before masking with 7",
      }) });
    }
    const index = {
      schemaVersion: 1, defaultPalette: "DESERT",
      verifiedInitialPalettes: palettes.filter(({ name }) => VERIFIED_TERRAIN_PALETTES.includes(name)).map(({ name }) => name).sort(),
      upload: { rowOrder: "top-to-bottom", unpackAlignment: 1, filtering: "NEAREST", mipmaps: false, colorConversion: false, premultiplyAlpha: false },
      paletteCount: palettes.length, terrainBankCount: terrain.length,
      tileCount: terrain.reduce((total, bank) => total + bank.tileCount, 0),
      archiveCount: sprites.length, frameCount: sprites.reduce((total, sprite) => total + sprite.frameCount, 0),
      emptyFrameCount: sprites.reduce((total, sprite) => total + sprite.emptyFrameCount, 0),
      animationCount: animationIndex.parsedCount, animationFileCount: animationIndex.fileCount,
      palettes, terrain, sprites, animations, missions,
      diagnostics: diagnostics.sort((left, right) => left.source < right.source ? -1 : left.source > right.source ? 1 : 0),
      sources: [...sources.values()].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
      outputs: outputs.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
    };
    const indexBytes = jsonBytes(index);
    const indexHash = sha256(indexBytes);
    await writeFile(path.join(staging, "index.json"), indexBytes);
    await writeFile(path.join(staging, "index.sha256"), `${indexHash}  index.json\n`);
    const generation = path.join(generations, indexHash);
    if (await exists(generation)) await rm(staging, { recursive: true });
    else await rename(staging, generation);
    await symlink(path.relative(path.dirname(outputRoot), generation), pointer, "dir");
    await rename(pointer, outputRoot);
    return index;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    await rm(pointer, { force: true });
    throw error;
  }
}
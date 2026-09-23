import { access, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { extractAnimationTree } from "../extractors/animations/extract";
import { extractCdAudio, mergeCdAudioIndex } from "../extractors/disc/extract";
import { extractGameData } from "../extractors/data/extract";
import { extractInterfaceImages } from "../extractors/interface/extract";
import { extractMapBundles, extractTerrainBanks } from "../extractors/maps/extract";
import { extractMediaTree, type MediaExtractionIndex } from "../extractors/media/extract";
import { extractIndexedAssets } from "../extractors/palettes/extract";
import { extractSpriteTree } from "../extractors/sprites/extract";
import { writeManifest } from "./manifest";

interface CliOptions {
  readonly source: string;
  readonly output: string;
  readonly assetsOutput: string;
  readonly inventoryOnly: boolean;
  readonly cdOnly: boolean;
  readonly discDescriptor: string | null;
}

function usage(): string {
  return [
    "Usage: npm run extract-assets -- [options]",
    "",
    "Inventories a mounted or extracted disc tree and converts supported assets.",
    "",
    "Options:",
    "  --source <directory>  Disc root to scan (default: raw_cd)",
    "  --output <file>       Manifest path (default: asset_manifest.json)",
    "  --assets-output <dir> Generated asset root (default: public/assets/generated)",
    "  --disc-descriptor <file> MDS descriptor for Red Book audio",
    "  --inventory-only      Generate the manifest without converting assets",
    "  --cd-only             Regenerate CD Ogg/MP3 and merge the existing media index only",
    "  --help                Show this message",
  ].join("\n");
}

function parseOptions(argumentsList: readonly string[]): CliOptions | null {
  let source = "raw_cd";
  let output = "asset_manifest.json";
  let assetsOutput = "public/assets/generated";
  let inventoryOnly = false;
  let cdOnly = false;
  let discDescriptor: string | null = null;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--help") return null;
    if (argument === "--cd-only") {
      cdOnly = true;
      continue;
    }
    if (argument === "--inventory-only") {
      inventoryOnly = true;
      continue;
    }
    if (
      argument !== "--source" &&
      argument !== "--output" &&
      argument !== "--assets-output" &&
      argument !== "--disc-descriptor"
    ) {
      throw new Error(`Unknown argument: ${argument}`);
    }

    const value = argumentsList[index + 1];
    if (!value) throw new Error(`Missing value for ${argument}`);
    if (argument === "--source") source = value;
    if (argument === "--output") output = value;
    if (argument === "--assets-output") assetsOutput = value;
    if (argument === "--disc-descriptor") discDescriptor = value;
    index += 1;
  }

  if (cdOnly && inventoryOnly) throw new Error("--cd-only cannot be combined with --inventory-only");
  return { source, output, assetsOutput, inventoryOnly, cdOnly, discDescriptor };
}

async function publishCdAudio(options: CliOptions, mediaIndex: MediaExtractionIndex): Promise<void> {
  const cdAudio = await extractCdAudio(
    options.discDescriptor ?? "Dark Colony ISO/Dark Colony.mds",
    path.join(options.assetsOutput, "media", "cd"),
    { mp3Fallback: {} },
  );
  const indexPath = path.join(options.assetsOutput, "media", "index.json");
  const temporaryPath = `${indexPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(mergeCdAudioIndex(mediaIndex, cdAudio), null, 2)}\n`);
  await rename(temporaryPath, indexPath);
  console.log(`CD audio tracks: ${cdAudio.trackCount} (Ogg + MP3)`);
}

async function gameDataRoot(source: string): Promise<string> {
  const nested = path.join(source, "DC");
  try {
    await access(nested);
    return nested;
  } catch {
    return source;
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (!options) {
    console.log(usage());
    return;
  }

  if (options.cdOnly) {
    const mediaIndex = JSON.parse(await readFile(
      path.join(options.assetsOutput, "media", "index.json"), "utf8",
    )) as MediaExtractionIndex;
    await publishCdAudio(options, mediaIndex);
    return;
  }

  const manifest = await writeManifest(options.source, options.output);
  console.log(`Wrote ${options.output}`);
  console.log(`Files: ${manifest.summary.fileCount}`);
  console.log(`Bytes: ${manifest.summary.totalBytes}`);
  console.log(`Tree SHA-256: ${manifest.integrity.sourceTreeSha256}`);

  if (!options.inventoryOnly) {
    const gameRoot = await gameDataRoot(options.source);
    const spriteIndex = await extractSpriteTree(
      gameRoot,
      path.join(options.assetsOutput, "sprites"),
    );
    console.log(`Sprite archives: ${spriteIndex.archiveCount}`);
    console.log(`Sprite frames: ${spriteIndex.frameCount}`);
    const animationIndex = await extractAnimationTree(
      path.join(gameRoot, "ANIMATE"),
      path.join(options.assetsOutput, "animations"),
    );
    console.log(`Animations parsed: ${animationIndex.parsedCount}/${animationIndex.fileCount}`);
    console.log(`Animation states: ${animationIndex.stateCount}`);
    const scenarioRoot = path.join(gameRoot, "SCENARIO");
    const terrainIndex = await extractTerrainBanks(
      scenarioRoot,
      path.join(options.assetsOutput, "terrain"),
    );
    console.log(`Terrain banks: ${terrainIndex.bankCount}`);
    console.log(`Terrain tiles: ${terrainIndex.tileCount}`);
    const mapIndex = await extractMapBundles(
      scenarioRoot,
      path.join(options.assetsOutput, "maps"),
    );
    console.log(`Maps: ${mapIndex.mapCount}`);
    console.log(`Map cells: ${mapIndex.cellCount}`);
    const indexed = await extractIndexedAssets(gameRoot, path.join(options.assetsOutput, "indexed"));
    console.log(`Indexed palettes: ${indexed.paletteCount}; sprite archives: ${indexed.archiveCount}`);
    const dataIndex = await extractGameData(
      gameRoot,
      path.join(options.assetsOutput, "data"),
    );
    console.log(`Unit stats: ${dataIndex.unitCount}`);
    console.log(`Weapon stats: ${dataIndex.weaponCount}`);
    console.log(`Scenarios: ${dataIndex.scenarioCount}`);
    const interfaceIndex = await extractInterfaceImages(
      gameRoot,
      path.join(options.assetsOutput, "interface"),
    );
    console.log(`Interface images: ${interfaceIndex.imageCount}`);
    const mediaIndex = await extractMediaTree(
      gameRoot,
      path.join(options.assetsOutput, "media"),
    );
    console.log(`Audio files: ${mediaIndex.audioCount}`);
    console.log(`Video files: ${mediaIndex.videoCount}`);
    const descriptor = options.discDescriptor ?? "Dark Colony ISO/Dark Colony.mds";
    if (existsSync(descriptor)) {
      await publishCdAudio(options, mediaIndex);
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Asset inventory failed: ${message}`);
  process.exitCode = 1;
});

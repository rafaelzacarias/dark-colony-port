import { createHash } from "node:crypto";
import { readFile, readdir, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { createSpriteAtlas } from "./atlas";
import { encodeRgbaPng } from "./png";
import { parseSprite } from "./spr";

export interface ExtractedSpriteArchive {
  readonly source: string;
  readonly sourceSha256: string;
  readonly metadata: string;
  readonly atlas: string;
  readonly encoding: "compressed" | "raw";
  readonly frameCount: number;
  readonly emptyFrameCount: number;
  readonly atlasWidth: number;
  readonly atlasHeight: number;
}

export interface SpriteExtractionIndex {
  readonly schemaVersion: 1;
  readonly archiveCount: number;
  readonly frameCount: number;
  readonly archives: readonly ExtractedSpriteArchive[];
}

async function findSpriteFiles(sourceRoot: string): Promise<string[]> {
  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".spr") {
        files.push(entryPath);
      }
    }
  }

  await visit(sourceRoot);
  return files;
}

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

export async function extractSpriteTree(
  sourceDirectory: string,
  outputDirectory: string,
): Promise<SpriteExtractionIndex> {
  const sourceRoot = path.resolve(sourceDirectory);
  const outputRoot = path.resolve(outputDirectory);
  const temporaryRoot = `${outputRoot}.${process.pid}.tmp`;
  const files = await findSpriteFiles(sourceRoot);
  const archives: ExtractedSpriteArchive[] = [];

  await rm(temporaryRoot, { recursive: true, force: true });
  await mkdir(temporaryRoot, { recursive: true });

  try {
    for (const file of files) {
      const source = toPosix(path.relative(sourceRoot, file));
      const stem = source.slice(0, -path.extname(source).length);
      const atlasRelative = `${stem}.png`;
      const metadataRelative = `${stem}.json`;
      const bytes = await readFile(file);
      const archive = parseSprite(bytes);
      const atlas = createSpriteAtlas(archive);
      const png = encodeRgbaPng(atlas.width, atlas.height, atlas.rgba);
      const atlasPath = path.join(temporaryRoot, ...atlasRelative.split("/"));
      const metadataPath = path.join(temporaryRoot, ...metadataRelative.split("/"));
      const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
      const metadata = {
        schemaVersion: 1,
        source: {
          path: source,
          sha256: sourceSha256,
        },
        encoding: archive.encoding,
        flags: archive.flags,
        storedByteCount: archive.storedByteCount,
        paletteScale: atlas.paletteScale,
        atlas: {
          file: path.posix.basename(atlasRelative),
          width: atlas.width,
          height: atlas.height,
        },
        frames: atlas.frames,
      } as const;

      await mkdir(path.dirname(atlasPath), { recursive: true });
      await writeFile(atlasPath, png);
      await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

      archives.push({
        source,
        sourceSha256,
        metadata: metadataRelative,
        atlas: atlasRelative,
        encoding: archive.encoding,
        frameCount: archive.frames.length,
        emptyFrameCount: archive.frames.filter(({ width, height }) => width === 0 && height === 0)
          .length,
        atlasWidth: atlas.width,
        atlasHeight: atlas.height,
      });
    }

    const index: SpriteExtractionIndex = {
      schemaVersion: 1,
      archiveCount: archives.length,
      frameCount: archives.reduce((total, archive) => total + archive.frameCount, 0),
      archives,
    };
    await writeFile(path.join(temporaryRoot, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
    await rm(outputRoot, { recursive: true, force: true });
    await mkdir(path.dirname(outputRoot), { recursive: true });
    await rename(temporaryRoot, outputRoot);
    return index;
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

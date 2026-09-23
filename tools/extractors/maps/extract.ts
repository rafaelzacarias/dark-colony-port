import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { encodeRgbaPng } from "../sprites/png";
import { createTerrainAtlas } from "./atlas";
import { parseTerrainBank, resolveTerrainReferences, type TerrainBank } from "./bts";
import { parseMapBundle } from "./map";

interface SourceDigest {
  readonly path: string;
  readonly sha256: string;
}

export interface TerrainIndexEntry {
  readonly source: SourceDigest;
  readonly metadata: string;
  readonly atlas: string;
  readonly keySpace: number;
  readonly tileCount: number;
}

export interface TerrainExtractionIndex {
  readonly schemaVersion: 1;
  readonly bankCount: number;
  readonly tileCount: number;
  readonly banks: readonly TerrainIndexEntry[];
}

export interface MapIndexEntry {
  readonly source: string;
  readonly metadata: string;
  readonly width: number;
  readonly height: number;
  readonly terrainBank: string;
  readonly directBtsReferences: number;
  readonly unresolvedReferences: number;
}

export interface MapExtractionIndex {
  readonly schemaVersion: 2;
  readonly mapCount: number;
  readonly cellCount: number;
  readonly entries: readonly MapIndexEntry[];
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function posix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function uint16LittleEndian(values: Uint16Array): Buffer {
  const result = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => result.writeUInt16LE(value, index * 2));
  return result;
}

async function atomicDirectory<T>(outputDirectory: string, build: (temporaryRoot: string) => Promise<T>): Promise<T> {
  const outputRoot = path.resolve(outputDirectory);
  const temporaryRoot = `${outputRoot}.${process.pid}.tmp`;
  await rm(temporaryRoot, { recursive: true, force: true });
  await mkdir(temporaryRoot, { recursive: true });
  try {
    const result = await build(temporaryRoot);
    await rm(outputRoot, { recursive: true, force: true });
    await mkdir(path.dirname(outputRoot), { recursive: true });
    await rename(temporaryRoot, outputRoot);
    return result;
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function extractTerrainBanks(
  sourceDirectory: string,
  outputDirectory: string,
): Promise<TerrainExtractionIndex> {
  const sourceRoot = path.resolve(sourceDirectory);
  return atomicDirectory(outputDirectory, async (temporaryRoot) => {
    const names = (await readdir(sourceRoot))
      .filter((name) => path.extname(name).toLowerCase() === ".bts")
      .sort((left, right) => left.localeCompare(right, "en"));
    const banks: TerrainIndexEntry[] = [];

    for (const name of names) {
      const bytes = await readFile(path.join(sourceRoot, name));
      const bank = parseTerrainBank(bytes);
      const atlas = createTerrainAtlas(bank);
      const stem = name.slice(0, -path.extname(name).length);
      const atlasFile = `${stem}.png`;
      const metadataFile = `${stem}.json`;
      const metadata = {
        schemaVersion: 1,
        source: { path: name, sha256: sha256(bytes) },
        keySpace: bank.keySpace,
        paletteScale: bank.paletteScale,
        atlas: { file: atlasFile, width: atlas.width, height: atlas.height },
        tiles: atlas.tiles,
      } as const;
      await writeFile(path.join(temporaryRoot, atlasFile), encodeRgbaPng(atlas.width, atlas.height, atlas.rgba));
      await writeFile(path.join(temporaryRoot, metadataFile), `${JSON.stringify(metadata, null, 2)}\n`);
      banks.push({
        source: metadata.source,
        metadata: metadataFile,
        atlas: atlasFile,
        keySpace: bank.keySpace,
        tileCount: bank.tiles.length,
      });
    }

    const index: TerrainExtractionIndex = {
      schemaVersion: 1,
      bankCount: banks.length,
      tileCount: banks.reduce((total, bank) => total + bank.tileCount, 0),
      banks,
    };
    await writeFile(path.join(temporaryRoot, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
    return index;
  });
}

async function findMaps(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".map") result.push(entryPath);
    }
  }
  await visit(root);
  return result;
}

export async function extractMapBundles(
  sourceDirectory: string,
  outputDirectory: string,
): Promise<MapExtractionIndex> {
  const sourceRoot = path.resolve(sourceDirectory);
  return atomicDirectory(outputDirectory, async (temporaryRoot) => {
    const terrainBanks = new Map<string, TerrainBank>();
    for (const name of (await readdir(sourceRoot)).filter((entry) => path.extname(entry).toLowerCase() === ".bts")) {
      const bank = parseTerrainBank(await readFile(path.join(sourceRoot, name)));
      terrainBanks.set(name.toLowerCase(), bank);
    }

    const entries: MapIndexEntry[] = [];
    for (const mapPath of await findMaps(sourceRoot)) {
      const source = posix(path.relative(sourceRoot, mapPath));
      const sourceStem = source.slice(0, -path.extname(source).length);
      const diskStem = mapPath.slice(0, -path.extname(mapPath).length);
      const mtgPath = `${diskStem}.MTG`;
      const pthPath = `${diskStem}.PTH`;
      const scnPath = `${diskStem}.SCN`;
      if (!existsSync(mtgPath) || !existsSync(pthPath) || !existsSync(scnPath)) {
        throw new Error(`map bundle is incomplete: ${sourceStem}`);
      }

      const [mapBytes, mtgBytes, pthBytes, scnText] = await Promise.all([
        readFile(mapPath),
        readFile(mtgPath),
        readFile(pthPath),
        readFile(scnPath, "ascii"),
      ]);
      const map = parseMapBundle(mapBytes, mtgBytes, pthBytes);
      const terrainBank = scnText.split(/\r?\n/, 1)[0].trim();
      const bank = terrainBanks.get(terrainBank.toLowerCase());
      if (!bank) throw new Error(`missing terrain bank ${terrainBank} for ${source}`);
      const knownKeys = new Set(bank.tiles.map(({ key }) => key));
      const resolution = resolveTerrainReferences(bank, map.tileReferences);
      let directBtsReferences = 0;
      let unresolvedReferences = 0;
      for (const reference of map.tileReferences) {
        if (reference === 0) continue;
        if (knownKeys.has(reference)) directBtsReferences += 1;
        else unresolvedReferences += 1;
      }

      const metadataRelative = `${sourceStem}.json`;
      const files = {
        tileReferences: `${path.posix.basename(sourceStem)}.tiles.u16`,
        tileRecordIndices: `${path.posix.basename(sourceStem)}.tile-records.u16`,
        attributes: `${path.posix.basename(sourceStem)}.attributes.u16`,
        tags: `${path.posix.basename(sourceStem)}.tags.u8`,
        pathGrid: `${path.posix.basename(sourceStem)}.path.u8`,
        pathPreamble: `${path.posix.basename(sourceStem)}.path-preamble.u8`,
      } as const;
      const outputBase = path.join(temporaryRoot, ...path.posix.dirname(metadataRelative).split("/"));
      await mkdir(outputBase, { recursive: true });
      await Promise.all([
        writeFile(path.join(outputBase, files.tileReferences), uint16LittleEndian(map.tileReferences)),
        writeFile(path.join(outputBase, files.tileRecordIndices), uint16LittleEndian(resolution.recordIndices)),
        writeFile(path.join(outputBase, files.attributes), uint16LittleEndian(map.attributes)),
        writeFile(path.join(outputBase, files.tags), map.tagGrid),
        writeFile(path.join(outputBase, files.pathGrid), map.pathGrid),
        writeFile(path.join(outputBase, files.pathPreamble), map.pathPreamble),
      ]);
      const metadata = {
        schemaVersion: 2,
        source: {
          map: { path: source, sha256: sha256(mapBytes) },
          mtg: { path: `${sourceStem}.MTG`, sha256: sha256(mtgBytes) },
          pth: { path: `${sourceStem}.PTH`, sha256: sha256(pthBytes) },
        },
        width: map.width,
        height: map.height,
        referencesPerCell: 2,
        tileReferenceLayout: "row-major-background-foreground-pairs",
        attributeLayout: "row-major-u16-raw",
        missingKeyPolicy: "original-executable-zero-initialized-record-lookup",
        missingKeys: resolution.missingKeys,
        terrainBank,
        directBtsReferences,
        unresolvedReferences,
        files,
      } as const;
      await writeFile(
        path.join(temporaryRoot, ...metadataRelative.split("/")),
        `${JSON.stringify(metadata, null, 2)}\n`,
      );
      entries.push({
        source: sourceStem,
        metadata: metadataRelative,
        width: map.width,
        height: map.height,
        terrainBank,
        directBtsReferences,
        unresolvedReferences,
      });
    }

    const index: MapExtractionIndex = {
      schemaVersion: 2,
      mapCount: entries.length,
      cellCount: entries.reduce((total, entry) => total + entry.width * entry.height, 0),
      entries,
    };
    await writeFile(path.join(temporaryRoot, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
    return index;
  });
}

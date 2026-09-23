import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface InterfaceImageEntry {
  readonly source: string;
  readonly output: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface InterfaceExtractionIndex {
  readonly schemaVersion: 1;
  readonly imageCount: number;
  readonly entries: readonly InterfaceImageEntry[];
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function extractInterfaceImages(
  gameRootDirectory: string,
  outputDirectory: string,
): Promise<InterfaceExtractionIndex> {
  const sourceRoot = path.resolve(gameRootDirectory, "INTRFACE");
  const outputRoot = path.resolve(outputDirectory);
  const temporaryRoot = `${outputRoot}.${process.pid}.tmp`;
  await rm(temporaryRoot, { recursive: true, force: true });
  await mkdir(temporaryRoot, { recursive: true });
  try {
    const names = (await readdir(sourceRoot))
      .filter((name) => path.extname(name).toLowerCase() === ".gif")
      .sort((left, right) => left.localeCompare(right, "en"));
    const entries: InterfaceImageEntry[] = [];
    for (const name of names) {
      const bytes = await readFile(path.join(sourceRoot, name));
      await writeFile(path.join(temporaryRoot, name), bytes);
      entries.push({ source: `INTRFACE/${name}`, output: name, bytes: bytes.length, sha256: sha256(bytes) });
    }
    const index: InterfaceExtractionIndex = {
      schemaVersion: 1,
      imageCount: entries.length,
      entries,
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

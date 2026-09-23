import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  parseFin,
  UnsupportedFinVariantError,
  type FinAnimation,
} from "./fin";

export interface AnimationIndexEntry {
  readonly source: string;
  readonly sourceSha256: string;
  readonly status: "invalid" | "parsed" | "unsupported";
  readonly metadata?: string;
  readonly spriteNames?: readonly string[];
  readonly stateCount?: number;
  readonly timelineCount?: number;
  readonly childCount?: number;
  readonly formatTag?: number;
  readonly error?: string;
}

export interface AnimationExtractionIndex {
  readonly schemaVersion: 1;
  readonly fileCount: number;
  readonly parsedCount: number;
  readonly unsupportedCount: number;
  readonly invalidCount: number;
  readonly stateCount: number;
  readonly timelineCount: number;
  readonly childCount: number;
  readonly entries: readonly AnimationIndexEntry[];
}

function metadataDocument(source: string, sourceSha256: string, animation: FinAnimation) {
  return {
    schemaVersion: 1,
    source: { path: source, sha256: sourceSha256 },
    ...animation,
  } as const;
}

export async function extractAnimationTree(
  sourceDirectory: string,
  outputDirectory: string,
): Promise<AnimationExtractionIndex> {
  const sourceRoot = path.resolve(sourceDirectory);
  const outputRoot = path.resolve(outputDirectory);
  const temporaryRoot = `${outputRoot}.${process.pid}.tmp`;
  const names = (await readdir(sourceRoot))
    .filter((name) => path.extname(name).toLowerCase() === ".fin")
    .sort((left, right) => left.localeCompare(right, "en"));
  const entries: AnimationIndexEntry[] = [];

  await rm(temporaryRoot, { recursive: true, force: true });
  await mkdir(temporaryRoot, { recursive: true });

  try {
    for (const source of names) {
      const bytes = await readFile(path.join(sourceRoot, source));
      const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
      try {
        const animation = parseFin(bytes);
        const metadata = `${source.slice(0, -path.extname(source).length)}.json`;
        const childCount = animation.timeline.reduce(
          (total, timeline) => total + timeline.children.length,
          0,
        );
        await writeFile(
          path.join(temporaryRoot, metadata),
          `${JSON.stringify(metadataDocument(source, sourceSha256, animation), null, 2)}\n`,
          "utf8",
        );
        entries.push({
          source,
          sourceSha256,
          status: "parsed",
          metadata,
          spriteNames: animation.spriteNames,
          stateCount: animation.states.length,
          timelineCount: animation.timeline.length,
          childCount,
        });
      } catch (error) {
        if (error instanceof UnsupportedFinVariantError) {
          entries.push({
            source,
            sourceSha256,
            status: "unsupported",
            formatTag: error.formatTag,
            error: error.message,
          });
        } else {
          entries.push({
            source,
            sourceSha256,
            status: "invalid",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const parsed = entries.filter((entry) => entry.status === "parsed");
    const index: AnimationExtractionIndex = {
      schemaVersion: 1,
      fileCount: entries.length,
      parsedCount: parsed.length,
      unsupportedCount: entries.filter((entry) => entry.status === "unsupported").length,
      invalidCount: entries.filter((entry) => entry.status === "invalid").length,
      stateCount: parsed.reduce((total, entry) => total + (entry.stateCount ?? 0), 0),
      timelineCount: parsed.reduce((total, entry) => total + (entry.timelineCount ?? 0), 0),
      childCount: parsed.reduce((total, entry) => total + (entry.childCount ?? 0), 0),
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

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { canonicalizeOgg } from "./ogg";
import { canonicalizeWebm } from "./webm";

export type MediaKind = "audio" | "video";
export type MediaFormat = "audio-ogg" | "video-mp4" | "video-webm";

export interface MediaOutput {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly mimeType: string;
  readonly codecs: readonly string[];
}

export interface MediaEntry {
  readonly kind: MediaKind;
  readonly source: string;
  readonly sourceSha256: string;
  readonly sourceBytes: number;
  readonly outputs: readonly MediaOutput[];
}

export interface MediaExtractionIndex {
  readonly schemaVersion: 1;
  readonly audioCount: number;
  readonly videoCount: number;
  readonly sourceBytes: number;
  readonly outputBytes: number;
  readonly entries: readonly MediaEntry[];
}

export type MediaTranscoder = (
  inputFile: string,
  outputFile: string,
  format: MediaFormat,
) => Promise<void>;

export interface MediaExtractionOptions {
  readonly concurrency?: number;
  readonly ffmpegPath?: string;
  readonly transcode?: MediaTranscoder;
}

function digest(bytes: Uint8Array): Buffer {
  return createHash("sha256").update(bytes).digest();
}

function posix(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

async function findMedia(root: string): Promise<{ file: string; kind: MediaKind }[]> {
  const result: { file: string; kind: MediaKind }[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.isFile()) {
        const extension = path.extname(entry.name).toLowerCase();
        if (extension === ".wav") result.push({ file: entryPath, kind: "audio" });
        if (extension === ".avi") result.push({ file: entryPath, kind: "video" });
      }
    }
  }
  await visit(root);
  return result;
}

function ffmpegTranscoder(ffmpegPath: string): MediaTranscoder {
  return (inputFile, outputFile, format) =>
    new Promise((resolve, reject) => {
      const codecArguments =
        format === "audio-ogg"
          ? ["-vn", "-c:a", "libopus", "-b:a", "64k", "-vbr", "on", "-compression_level", "10"]
          : format === "video-webm"
            ? [
                "-fflags",
                "+bitexact",
                "-c:v",
                "libvpx-vp9",
                "-flags:v",
                "+bitexact",
                "-crf",
                "30",
                "-b:v",
                "0",
                "-deadline",
                "good",
                "-cpu-used",
                "2",
                "-row-mt",
                "1",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "libopus",
                "-flags:a",
                "+bitexact",
                "-b:a",
                "64k",
                "-write_crc32",
                "0",
              ]
          : [
              "-c:v",
              "libx264",
              "-preset",
              "medium",
              "-crf",
              "18",
              "-pix_fmt",
              "yuv420p",
              "-c:a",
              "aac",
              "-b:a",
              "96k",
              "-movflags",
              "+faststart",
            ];
      const child = spawn(
        ffmpegPath,
        [
          "-nostdin",
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-i",
          inputFile,
          "-map_metadata",
          "-1",
          ...codecArguments,
          outputFile,
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg failed for ${inputFile}: ${stderr.trim() || `exit ${code}`}`));
      });
    });
}

async function parallelMap<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const result = new Array<R>(values.length);
  let nextIndex = 0;
  async function run(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      result[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => run()));
  return result;
}

export async function extractMediaTree(
  sourceDirectory: string,
  outputDirectory: string,
  options: MediaExtractionOptions = {},
): Promise<MediaExtractionIndex> {
  const sourceRoot = path.resolve(sourceDirectory);
  const outputRoot = path.resolve(outputDirectory);
  const temporaryRoot = `${outputRoot}.${process.pid}.tmp`;
  const concurrency = options.concurrency ?? 4;
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new RangeError("media concurrency must be a positive integer");
  }
  const transcode = options.transcode ?? ffmpegTranscoder(options.ffmpegPath ?? "ffmpeg");
  const media = await findMedia(sourceRoot);
  await rm(temporaryRoot, { recursive: true, force: true });
  await mkdir(temporaryRoot, { recursive: true });

  try {
    const entries = await parallelMap(media, concurrency, async ({ file, kind }): Promise<MediaEntry> => {
      const source = posix(path.relative(sourceRoot, file));
      const stem = source.slice(0, -path.extname(source).length);
      const sourceBytes = await readFile(file);
      const sourceDigest = digest(sourceBytes);
      const plans =
        kind === "audio"
          ? [{ format: "audio-ogg" as const, path: `audio/${stem}.ogg`, mimeType: "audio/ogg", codecs: ["opus"] }]
          : [
              { format: "video-webm" as const, path: `video/${stem}.webm`, mimeType: "video/webm", codecs: ["vp9", "opus"] },
              { format: "video-mp4" as const, path: `video/${stem}.mp4`, mimeType: "video/mp4", codecs: ["h264", "aac"] },
            ];
      const outputs: MediaOutput[] = [];
      for (const plan of plans) {
        const destination = path.join(temporaryRoot, ...plan.path.split("/"));
        await mkdir(path.dirname(destination), { recursive: true });
        await transcode(file, destination, plan.format);
        if (plan.format === "audio-ogg") {
          const encoded = await readFile(destination);
          await writeFile(destination, canonicalizeOgg(encoded, sourceDigest.readUInt32LE(0)));
        }
        if (plan.format === "video-webm") {
          const encoded = await readFile(destination);
          await writeFile(destination, canonicalizeWebm(encoded, sourceDigest));
        }
        const outputBytes = await readFile(destination);
        outputs.push({
          path: plan.path,
          sha256: digest(outputBytes).toString("hex"),
          bytes: outputBytes.length,
          mimeType: plan.mimeType,
          codecs: plan.codecs,
        });
      }
      return {
        kind,
        source,
        sourceSha256: sourceDigest.toString("hex"),
        sourceBytes: sourceBytes.length,
        outputs,
      };
    });

    const index: MediaExtractionIndex = {
      schemaVersion: 1,
      audioCount: entries.filter(({ kind }) => kind === "audio").length,
      videoCount: entries.filter(({ kind }) => kind === "video").length,
      sourceBytes: entries.reduce((total, entry) => total + entry.sourceBytes, 0),
      outputBytes: entries.reduce(
        (total, entry) => total + entry.outputs.reduce((subtotal, output) => subtotal + output.bytes, 0),
        0,
      ),
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

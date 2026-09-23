import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { open, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { MediaEntry, MediaExtractionIndex } from "../media/extract";
import { canonicalizeOgg } from "../media/ogg";
import { parseMds, type MdsTrack } from "./mds";

const CDDA_SECTOR_BYTES = 2_352;

export type CddaEncoder = (pcm: Uint8Array, outputFile: string) => Promise<void>;

export interface CdAudioExtractionOptions {
  readonly ffmpegPath?: string;
  readonly encode?: CddaEncoder;
  readonly mp3Fallback?: {
    readonly ffmpegPath?: string;
    readonly encode?: CddaEncoder;
  };
}

export interface CdAudioExtractionIndex {
  readonly schemaVersion: 1;
  readonly trackCount: number;
  readonly durationSeconds: number;
  readonly entries: readonly MediaEntry[];
}

export function mergeCdAudioIndex(
  media: MediaExtractionIndex,
  cd: CdAudioExtractionIndex,
): MediaExtractionIndex {
  const replacements = new Map(cd.entries.map((entry) => [entry.source, {
    ...entry,
    outputs: entry.outputs.map((output) => ({ ...output, path: `cd/${output.path}` })),
  }]));
  const previous = media.entries.filter((entry) => entry.source.startsWith("CDDA/"));
  const entries = media.entries.flatMap((entry) => {
    if (!entry.source.startsWith("CDDA/")) return [entry];
    const replacement = replacements.get(entry.source);
    replacements.delete(entry.source);
    return replacement ? [{ ...entry, ...replacement }] : [];
  });
  entries.push(...replacements.values());
  const sourceBytes = (items: readonly MediaEntry[]) =>
    items.reduce((total, entry) => total + entry.sourceBytes, 0);
  const outputBytes = (items: readonly MediaEntry[]) =>
    items.reduce((total, entry) => total + entry.outputs.reduce((sum, output) => sum + output.bytes, 0), 0);
  return {
    ...media,
    audioCount: media.audioCount - previous.length + cd.trackCount,
    sourceBytes: media.sourceBytes - sourceBytes(previous) + sourceBytes(cd.entries),
    outputBytes: media.outputBytes - outputBytes(previous) + outputBytes(cd.entries),
    entries,
  };
}

function digest(bytes: Uint8Array): Buffer {
  return createHash("sha256").update(bytes).digest();
}

function ffmpegEncoder(ffmpegPath: string, mp3 = false): CddaEncoder {
  return (pcm, outputFile) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        ffmpegPath,
        [
          "-nostdin",
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "s16le",
          "-ar",
          "44100",
          "-ac",
          "2",
          "-i",
          "pipe:0",
          "-map_metadata",
          "-1",
          ...(mp3
            ? ["-fflags", "+bitexact", "-c:a", "libmp3lame", "-b:a", "192k", "-flags:a", "+bitexact",
                "-id3v2_version", "0", "-write_id3v1", "0"]
            : ["-c:a", "libopus", "-b:a", "128k", "-vbr", "on", "-compression_level", "10"]),
          outputFile,
        ],
        { stdio: ["pipe", "ignore", "pipe"] },
      );
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg CDDA encoding failed: ${stderr.trim() || `exit ${code}`}`));
      });
      child.stdin.on("error", reject);
      child.stdin.end(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
    });
}

async function readTrackPcm(imagePath: string, track: MdsTrack): Promise<Buffer> {
  if (track.sectorSize < CDDA_SECTOR_BYTES) {
    throw new Error(`track ${track.number} sector size ${track.sectorSize} is smaller than CDDA payload`);
  }
  const output = Buffer.alloc(track.sectorCount * CDDA_SECTOR_BYTES);
  const handle = await open(imagePath, "r");
  const batchSectors = 256;
  try {
    for (let firstSector = 0; firstSector < track.sectorCount; firstSector += batchSectors) {
      const count = Math.min(batchSectors, track.sectorCount - firstSector);
      const raw = Buffer.alloc(count * track.sectorSize);
      const { bytesRead } = await handle.read(
        raw,
        0,
        raw.length,
        track.startOffset + firstSector * track.sectorSize,
      );
      if (bytesRead !== raw.length) throw new Error(`short read in CDDA track ${track.number}`);
      for (let sector = 0; sector < count; sector += 1) {
        raw.copy(
          output,
          (firstSector + sector) * CDDA_SECTOR_BYTES,
          sector * track.sectorSize,
          sector * track.sectorSize + CDDA_SECTOR_BYTES,
        );
      }
    }
  } finally {
    await handle.close();
  }
  return output;
}

export async function extractCdAudio(
  descriptorFile: string,
  outputDirectory: string,
  options: CdAudioExtractionOptions = {},
): Promise<CdAudioExtractionIndex> {
  const descriptorPath = path.resolve(descriptorFile);
  const imagePath = descriptorPath.replace(/\.mds$/i, ".mdf");
  if (imagePath === descriptorPath) throw new Error(`disc descriptor must end in .mds: ${descriptorPath}`);
  const outputRoot = path.resolve(outputDirectory);
  const temporaryRoot = `${outputRoot}.${process.pid}.tmp`;
  const [descriptor, imageStat] = await Promise.all([readFile(descriptorPath), stat(imagePath)]);
  const layout = parseMds(descriptor, imageStat.size);
  const encode = options.encode ?? ffmpegEncoder(options.ffmpegPath ?? "ffmpeg");
  const encodeMp3 = options.mp3Fallback
    ? options.mp3Fallback.encode ?? ffmpegEncoder(options.mp3Fallback.ffmpegPath ?? "ffmpeg", true)
    : undefined;
  const entries: MediaEntry[] = [];
  await rm(temporaryRoot, { recursive: true, force: true });
  await mkdir(temporaryRoot, { recursive: true });

  try {
    for (const track of layout.audioTracks) {
      const pcm = await readTrackPcm(imagePath, track);
      const pcmDigest = digest(pcm);
      const filename = `TRACK${String(track.number).padStart(2, "0")}.ogg`;
      const destination = path.join(temporaryRoot, filename);
      await encode(pcm, destination);
      const encoded = canonicalizeOgg(await readFile(destination), pcmDigest.readUInt32LE(0));
      await writeFile(destination, encoded);
      const outputs: MediaEntry["outputs"][number][] = [
        {
          path: filename,
          sha256: digest(encoded).toString("hex"),
          bytes: encoded.length,
          mimeType: "audio/ogg",
          codecs: ["opus"],
        },
      ];
      if (encodeMp3) {
        const mp3Filename = filename.replace(/\.ogg$/, ".mp3");
        const mp3Destination = path.join(temporaryRoot, mp3Filename);
        await encodeMp3(pcm, mp3Destination);
        const mp3 = await readFile(mp3Destination);
        outputs.push({
          path: mp3Filename,
          sha256: digest(mp3).toString("hex"),
          bytes: mp3.length,
          mimeType: "audio/mpeg",
          codecs: ["mp3"],
        });
      }
      entries.push({
        kind: "audio",
        source: `CDDA/TRACK${String(track.number).padStart(2, "0")}`,
        sourceSha256: pcmDigest.toString("hex"),
        sourceBytes: pcm.length,
        outputs,
      });
    }

    const index: CdAudioExtractionIndex = {
      schemaVersion: 1,
      trackCount: entries.length,
      durationSeconds: layout.audioTracks.reduce(
        (total, track) => total + track.sectorCount / 75,
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

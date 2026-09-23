import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { classifyAsset } from "./classify";
import type { AssetManifest, AssetRecord, ContentKind } from "./types";

const MAGIC_BYTE_COUNT = 32;
const HOST_METADATA_NAMES = new Set([".DS_Store"]);

interface FileFingerprint {
  readonly bytes: number;
  readonly contentKind: ContentKind;
  readonly detectedFormat: string;
  readonly entropyBitsPerByte: number;
  readonly magicHex: string;
  readonly sha256: string;
}

interface WalkResult {
  readonly directoryCount: number;
  readonly files: readonly string[];
}

function compareNames(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isHostMetadata(name: string): boolean {
  return HOST_METADATA_NAMES.has(name) || name.startsWith("._");
}

function isTextByte(byte: number): boolean {
  return byte === 9 || byte === 10 || byte === 12 || byte === 13 || (byte >= 32 && byte <= 126);
}

function detectFormat(header: Buffer, contentKind: ContentKind): string {
  if (contentKind === "empty") return "empty";

  const firstFour = header.subarray(0, 4).toString("ascii");
  const riffKind = header.subarray(8, 12).toString("ascii");

  if (firstFour === "RIFF" && riffKind === "AVI ") return "riff-avi";
  if (firstFour === "RIFF" && riffKind === "WAVE") return "riff-wave";
  if (header.subarray(0, 6).toString("ascii") === "GIF87a") return "gif87a";
  if (header.subarray(0, 6).toString("ascii") === "GIF89a") return "gif89a";
  if (header.subarray(0, 2).toString("ascii") === "BM") return "windows-bitmap";
  if (header.subarray(0, 2).toString("ascii") === "MZ") return "dos-mz-or-pe";
  if (header.length >= 4 && header.readUInt32LE(0) === 0x0001_0000) return "windows-icon";
  if (header.subarray(0, 2).toString("ascii") === "P6") return "netpbm-pixmap";
  if (contentKind === "text") return "ascii-text";
  return "opaque-binary";
}

async function fingerprintFile(filePath: string): Promise<FileFingerprint> {
  const hash = createHash("sha256");
  const frequencies = new Uint32Array(256);
  const header = Buffer.alloc(MAGIC_BYTE_COUNT);
  let headerLength = 0;
  let bytes = 0;
  let textCompatible = true;

  for await (const chunk of createReadStream(filePath)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(buffer);
    bytes += buffer.length;

    if (headerLength < MAGIC_BYTE_COUNT) {
      const copyLength = Math.min(MAGIC_BYTE_COUNT - headerLength, buffer.length);
      buffer.copy(header, headerLength, 0, copyLength);
      headerLength += copyLength;
    }

    for (const byte of buffer) {
      frequencies[byte] += 1;
      if (textCompatible && !isTextByte(byte)) textCompatible = false;
    }
  }

  let entropyBitsPerByte = 0;
  if (bytes > 0) {
    for (const frequency of frequencies) {
      if (frequency === 0) continue;
      const probability = frequency / bytes;
      entropyBitsPerByte -= probability * Math.log2(probability);
    }
  }

  const contentKind: ContentKind = bytes === 0 ? "empty" : textCompatible ? "text" : "binary";
  const usedHeader = header.subarray(0, headerLength);

  return {
    bytes,
    contentKind,
    detectedFormat: detectFormat(usedHeader, contentKind),
    entropyBitsPerByte: Number(entropyBitsPerByte.toFixed(6)),
    magicHex: usedHeader.toString("hex"),
    sha256: hash.digest("hex"),
  };
}

async function walkSource(sourceRoot: string): Promise<WalkResult> {
  const files: string[] = [];
  let directoryCount = 1;

  async function visit(directoryPath: string): Promise<void> {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    entries.sort((left, right) => compareNames(left.name, right.name));

    for (const entry of entries) {
      if (isHostMetadata(entry.name)) continue;
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Symbolic links are not supported: ${entryPath}`);
      }
      if (entry.isDirectory()) {
        directoryCount += 1;
        await visit(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Unsupported filesystem node: ${entryPath}`);
      }
      files.push(entryPath);
    }
  }

  await visit(sourceRoot);
  return { directoryCount, files };
}

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function sortedRecord(counts: Map<string, number>): Readonly<Record<string, number>> {
  return Object.fromEntries([...counts].sort(([left], [right]) => compareNames(left, right)));
}

export async function generateManifest(sourceDirectory: string): Promise<AssetManifest> {
  const sourceRoot = path.resolve(sourceDirectory);
  const sourceStat = await lstat(sourceRoot);
  if (!sourceStat.isDirectory()) {
    throw new Error(`Asset source is not a directory: ${sourceRoot}`);
  }

  const walkResult = await walkSource(sourceRoot);
  const records: AssetRecord[] = [];
  const categoryCounts = new Map<string, number>();
  const extensionCounts = new Map<string, number>();
  const sourceTreeHash = createHash("sha256");
  const zeroLengthFiles: string[] = [];
  let totalBytes = 0;

  for (const filePath of walkResult.files) {
    const assetPath = path.relative(sourceRoot, filePath).split(path.sep).join("/");
    const rawExtension = path.posix.extname(assetPath).toLowerCase();
    const extension = rawExtension.length > 0 ? rawExtension : null;
    const fingerprint = await fingerprintFile(filePath);
    const classificationResult = classifyAsset({
      assetPath,
      extension,
      contentKind: fingerprint.contentKind,
    });
    const record: AssetRecord = {
      path: assetPath,
      ...fingerprint,
      extension,
      ...classificationResult,
    };

    records.push(record);
    totalBytes += record.bytes;
    increment(categoryCounts, record.category);
    increment(extensionCounts, record.extension ?? "(none)");
    sourceTreeHash.update(`${record.path}\0${record.bytes}\0${record.sha256}\n`);
    if (record.bytes === 0) zeroLengthFiles.push(record.path);
  }

  return {
    schemaVersion: 1,
    scanVersion: "phase-1",
    source: {
      kind: "directory",
      rootName: path.basename(sourceRoot),
    },
    integrity: {
      algorithm: "sha256",
      sourceTreeSha256: sourceTreeHash.digest("hex"),
    },
    summary: {
      fileCount: records.length,
      directoryCount: walkResult.directoryCount,
      totalBytes,
      byCategory: sortedRecord(categoryCounts),
      byExtension: sortedRecord(extensionCounts),
      zeroLengthFiles,
    },
    files: records,
  };
}

export async function writeManifest(
  sourceDirectory: string,
  outputFile: string,
): Promise<AssetManifest> {
  const manifest = await generateManifest(sourceDirectory);
  const resolvedOutput = path.resolve(outputFile);
  const temporaryOutput = `${resolvedOutput}.${process.pid}.tmp`;

  await mkdir(path.dirname(resolvedOutput), { recursive: true });
  await writeFile(temporaryOutput, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(temporaryOutput, resolvedOutput);
  return manifest;
}

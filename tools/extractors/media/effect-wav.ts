import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { MediaExtractionIndex, MediaOutput } from "./extract";

const MAX_FILES = 512;
const MAX_BYTES = 32 * 1024 * 1024;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function inspectPcmWav(bytes: Buffer) {
  if (bytes.length < 12 || bytes.toString("ascii", 0, 4) !== "RIFF"
    || bytes.toString("ascii", 8, 12) !== "WAVE" || bytes.readUInt32LE(4) + 8 !== bytes.length) {
    throw new Error("Invalid RIFF/WAVE size or signature");
  }
  let format: { channels: number; sampleRate: number; bits: number; blockAlign: number } | undefined;
  let dataBytes: number | undefined;
  let offset = 12;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error("Truncated WAV chunk");
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > bytes.length) throw new Error("Truncated WAV payload");
    const tag = bytes.toString("ascii", offset, offset + 4);
    if (tag === "fmt ") {
      if (format || size < 16 || bytes.readUInt16LE(start) !== 1) throw new Error("Expected one PCM format chunk");
      const channels = bytes.readUInt16LE(start + 2);
      const sampleRate = bytes.readUInt32LE(start + 4);
      const byteRate = bytes.readUInt32LE(start + 8);
      const blockAlign = bytes.readUInt16LE(start + 12);
      const bits = bytes.readUInt16LE(start + 14);
      if (![1, 2].includes(channels) || ![8, 16].includes(bits) || sampleRate < 8000 || sampleRate > 48000
        || blockAlign !== channels * bits / 8 || byteRate !== sampleRate * blockAlign) throw new Error("Unsupported PCM layout");
      format = { channels, sampleRate, bits, blockAlign };
    }
    if (tag === "data") {
      if (dataBytes !== undefined || !size) throw new Error("Expected one nonempty data chunk");
      dataBytes = size;
    }
    offset = end + (size % 2);
  }
  if (!format || dataBytes === undefined || dataBytes % format.blockAlign) throw new Error("Missing or misaligned PCM data");
  return { ...format, dataBytes, frames: dataBytes / format.blockAlign, duration: dataBytes / format.blockAlign / format.sampleRate };
}

export function prepareEffectWav(source: Buffer): { bytes: Buffer; conversion: "original" | "rewrapped-pcm" | "truncated-source-pcm" } {
  try {
    inspectPcmWav(source);
    return { bytes: source, conversion: "original" };
  } catch {
    if (source.length < 12 || source.toString("ascii", 0, 4) !== "RIFF" || source.toString("ascii", 8, 12) !== "WAVE") {
      throw new Error("Invalid source WAV signature");
    }
    let format: Buffer | undefined;
    for (let offset = 12; offset + 8 <= source.length;) {
      const size = source.readUInt32LE(offset + 4);
      const start = offset + 8;
      const end = start + size;
      const tag = source.toString("ascii", offset, offset + 4);
      if (tag === "fmt ") {
        if (format || size < 16 || end > source.length) throw new Error("Invalid source format chunk");
        format = source.subarray(start, start + 16);
      }
      if (tag === "data" && format) {
        const samples = source.subarray(start, Math.min(end, source.length));
        const bytes = Buffer.alloc(44 + samples.length + (samples.length % 2));
        bytes.write("RIFF", 0, "ascii");
        bytes.writeUInt32LE(bytes.length - 8, 4);
        bytes.write("WAVEfmt ", 8, "ascii");
        bytes.writeUInt32LE(16, 16);
        format.copy(bytes, 20);
        bytes.write("data", 36, "ascii");
        bytes.writeUInt32LE(samples.length, 40);
        samples.copy(bytes, 44);
        inspectPcmWav(bytes);
        return { bytes, conversion: end > source.length ? "truncated-source-pcm" : "rewrapped-pcm" };
      }
      if (end > source.length) throw new Error("Truncated source chunk before PCM data");
      offset = end + (size % 2);
    }
    throw new Error("No supported PCM source data");
  }
}

export function publishEffectWavs(sourceDirectory: string, mediaDirectory: string) {
  const sourceRoot = realpathSync(sourceDirectory);
  const mediaRoot = realpathSync(mediaDirectory);
  const indexPath = path.join(mediaRoot, "index.json");
  const original = readFileSync(indexPath);
  const index: MediaExtractionIndex = JSON.parse(original.toString("utf8"));
  if (index.schemaVersion !== 1) throw new Error("Unsupported media index");
  const effects = index.entries.filter((entry) => entry.kind === "audio" && /\.wav$/i.test(entry.source));
  if (!effects.length || effects.length > MAX_FILES) throw new Error("Effect count outside publication bound");
  let total = 0;
  const plans = effects.map((entry) => {
    if (!entry.source.split("/").every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== "." && part !== "..")) {
      throw new Error(`Unsafe source path: ${entry.source}`);
    }
    const sourcePath = realpathSync(path.join(sourceRoot, entry.source));
    if (!sourcePath.startsWith(`${sourceRoot}${path.sep}`)) throw new Error("Source escapes root");
    const size = statSync(sourcePath).size;
    total += size;
    if (total > MAX_BYTES) throw new Error("Effect bytes exceed 32 MiB publication bound");
    const bytes = readFileSync(sourcePath);
    const hash = sha256(bytes);
    if (size !== bytes.length || bytes.length !== entry.sourceBytes || hash !== entry.sourceSha256) {
      throw new Error(`Source integrity mismatch: ${entry.source}`);
    }
    const prepared = prepareEffectWav(bytes);
    const format = inspectPcmWav(prepared.bytes);
    const outputHash = sha256(prepared.bytes);
    const output: MediaOutput & { conversion: typeof prepared.conversion } = {
      path: `effect-pcm/${outputHash}.wav`, sha256: outputHash, bytes: prepared.bytes.length,
      mimeType: "audio/wav", codecs: [format.bits === 8 ? "pcm_u8" : "pcm_s16le"],
      conversion: prepared.conversion,
    };
    return { entry, bytes: prepared.bytes, output };
  });
  const outputs = new Map(plans.map((plan) => [plan.entry, plan.output]));
  const entries = index.entries.map((entry) => {
    const output = outputs.get(entry);
    return output ? { ...entry, outputs: [...entry.outputs.filter((candidate) => candidate.mimeType !== "audio/wav"), output] } : entry;
  });
  const next: MediaExtractionIndex = {
    ...index, entries,
    outputBytes: entries.reduce((sum, entry) => sum + entry.outputs.reduce((subtotal, output) => subtotal + output.bytes, 0), 0),
  };
  const destination = path.join(mediaRoot, "effect-pcm");
  mkdirSync(destination, { recursive: true });
  if (realpathSync(destination) !== destination) throw new Error("Effect output directory must not be a symlink");
  for (const plan of plans) {
    const target = path.join(mediaRoot, plan.output.path);
    try {
      writeFileSync(target, plan.bytes, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !readFileSync(target).equals(plan.bytes)) throw error;
    }
  }
  const temporary = `${indexPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: "wx" });
    if (!readFileSync(indexPath).equals(original)) throw new Error("Media index changed during publication; rerun after exporters finish");
    renameSync(temporary, indexPath);
  } finally {
    rmSync(temporary, { force: true });
  }
  return {
    count: plans.length, sourceBytes: total, outputBytes: plans.reduce((sum, plan) => sum + plan.bytes.length, 0),
    original: plans.filter((plan) => plan.output.conversion === "original").length,
    repaired: plans.filter((plan) => plan.output.conversion !== "original").map((plan) => ({ source: plan.entry.source, conversion: plan.output.conversion })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [sourceDirectory, mediaDirectory, ...extra] = process.argv.slice(2);
  if (!sourceDirectory || !mediaDirectory || extra.length) throw new Error("Usage: tsx tools/extractors/media/effect-wav.ts SOURCE_DC GENERATED_MEDIA");
  console.log(JSON.stringify(publishEffectWavs(sourceDirectory, mediaDirectory)));
}
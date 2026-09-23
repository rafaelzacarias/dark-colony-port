import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { MediaExtractionIndex } from "./extract";
import { inspectPcmWav, publishEffectWavs } from "./effect-wav";

const source = fileURLToPath(new URL("../../../raw_cd/DC", import.meta.url));
const media = fileURLToPath(new URL("../../../public/assets/generated/media", import.meta.url));
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function pcmData(bytes: Buffer): Buffer {
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4);
    if (bytes.toString("ascii", offset, offset + 4) === "data") return bytes.subarray(offset + 8, Math.min(bytes.length, offset + 8 + size));
    offset += 8 + size + (size % 2);
  }
  throw new Error("Missing data");
}

test("all 259 real WAV alternatives preserve available PCM data and hashes; publication is deterministic and audio-only", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "dc-effect-wav-"));
  try {
    const original: MediaExtractionIndex = JSON.parse(readFileSync(path.join(media, "index.json"), "utf8"));
    writeFileSync(path.join(directory, "index.json"), JSON.stringify(original));
    const report = publishEffectWavs(source, directory);
    assert.equal(report.count, 259);
    assert.equal(report.sourceBytes, 13009773);
    assert.equal(report.original, 248);
    assert.equal(report.repaired.length, 11);
    assert.deepEqual(report.repaired.filter((entry) => entry.conversion === "truncated-source-pcm"), [{ source: "SOUND/BEAT.WAV", conversion: "truncated-source-pcm" }]);
    const published = readFileSync(path.join(directory, "index.json"));
    const index: MediaExtractionIndex = JSON.parse(published.toString());
    for (const [position, entry] of index.entries.entries()) {
      const before = original.entries[position];
      assert.equal(entry.sourceSha256, before.sourceSha256);
      assert.equal(entry.sourceBytes, before.sourceBytes);
      const wav = entry.outputs.find((output) => output.mimeType === "audio/wav");
      if (entry.kind !== "audio" || !/\.wav$/i.test(entry.source)) {
        assert.deepEqual(entry, before);
        continue;
      }
      assert.ok(wav);
      const encoded = readFileSync(path.join(directory, wav.path));
      const native = readFileSync(path.join(source, entry.source));
      assert.deepEqual(pcmData(encoded), pcmData(native));
      assert.equal(hash(encoded), wav.sha256);
      assert.equal(hash(native), entry.sourceSha256);
      if (!report.repaired.some((repair) => repair.source === entry.source)) assert.deepEqual(encoded, native);
      assert.equal(encoded.length, wav.bytes);
      const format = inspectPcmWav(encoded);
      assert.ok(format.frames > 0);
      assert.ok(format.duration < 60);
      assert.deepEqual(entry.outputs.filter((output) => output.mimeType !== "audio/wav"), before.outputs.filter((output) => output.mimeType !== "audio/wav"));
      for (const output of entry.outputs.filter((output) => output.mimeType === "audio/ogg")) {
        const ogg = readFileSync(path.join(media, output.path));
        assert.equal(hash(ogg), output.sha256);
        assert.equal(ogg.length, output.bytes);
        assert.equal(ogg.toString("ascii", 0, 4), "OggS");
        assert.ok(ogg.includes(Buffer.from("OpusHead")));
      }
    }
    assert.equal(index.outputBytes, index.entries.reduce((sum, entry) => sum + entry.outputs.reduce((subtotal, output) => subtotal + output.bytes, 0), 0));
    publishEffectWavs(source, directory);
    assert.deepEqual(readFileSync(path.join(directory, "index.json")), published);
    const corrupt = { ...index, entries: index.entries.map((entry) => /\.wav$/i.test(entry.source) ? { ...entry, sourceSha256: "invalid" } : entry) };
    writeFileSync(path.join(directory, "index.json"), JSON.stringify(corrupt));
    const previous = readFileSync(path.join(directory, "index.json"));
    assert.throws(() => publishEffectWavs(source, directory), /integrity mismatch/);
    assert.deepEqual(readFileSync(path.join(directory, "index.json")), previous);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("WAV parser refuses compressed, malformed and truncated alternatives", () => {
  const native = readFileSync(path.join(source, "SOUND/TRP1SEL.WAV"));
  assert.throws(() => inspectPcmWav(native.subarray(0, native.length - 1)), /size/);
  const compressed = Buffer.from(native);
  const formatOffset = compressed.indexOf(Buffer.from("fmt "));
  compressed.writeUInt16LE(17, formatOffset + 8);
  assert.throws(() => inspectPcmWav(compressed), /PCM/);
  const malformed = Buffer.from(native);
  malformed.writeUInt32LE(0xffffffff, formatOffset + 4);
  assert.throws(() => inspectPcmWav(malformed), /Truncated/);
});
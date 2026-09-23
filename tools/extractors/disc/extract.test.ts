import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { extractCdAudio, mergeCdAudioIndex } from "./extract";
import { mdsFixture } from "./test-fixtures";

function emptyOggPage(serial: number): Buffer {
  const page = Buffer.alloc(27);
  page.write("OggS", 0, "ascii");
  page.writeUInt32LE(serial, 14);
  return page;
}

test("extracts CDDA payload bytes and canonicalizes encoded tracks deterministically", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dark-colony-cdda-"));
  const descriptor = path.join(root, "DISC.mds");
  const image = path.join(root, "DISC.mdf");
  const output = path.join(root, "output");
  const mdf = Buffer.alloc(2 * 2448, 0xee);
  mdf.fill(1, 0, 2352);
  mdf.fill(2, 2448, 2448 + 2352);
  let observedLength = 0;
  let observedFirst = 0;
  let observedSecondSector = 0;
  let observedSentinel = false;
  let serial = 1;
  try {
    await writeFile(descriptor, mdsFixture());
    await writeFile(image, mdf);
    const encode = async (pcm: Uint8Array, destination: string) => {
      const captured = Buffer.from(pcm);
      observedLength = captured.length;
      observedFirst = captured[0];
      observedSecondSector = captured[2352];
      observedSentinel = captured.includes(0xee);
      await writeFile(destination, emptyOggPage(serial++));
    };
    const first = await extractCdAudio(descriptor, output, { encode, ffmpegPath: "must-not-run-ffmpeg" });
    const firstAudio = await readFile(path.join(output, "TRACK02.ogg"));
    const second = await extractCdAudio(descriptor, output, { encode });

    assert.deepEqual(second, first);
    assert.deepEqual(await readFile(path.join(output, "TRACK02.ogg")), firstAudio);
    assert.equal(first.trackCount, 1);
    assert.equal(first.entries[0].outputs.length, 1);
    assert.equal(first.durationSeconds, 2 / 75);
    assert.equal(observedLength, 4704);
    assert.equal(observedFirst, 1);
    assert.equal(observedSecondSector, 2);
    assert.equal(observedSentinel, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("optional MP3 encoder receives original PCM and preserves Ogg output and publication on failure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dark-colony-cdda-mp3-"));
  const descriptor = path.join(root, "DISC.mds");
  const output = path.join(root, "output");
  const image = Buffer.alloc(2 * 2448, 0xee);
  image.fill(1, 0, 2352);
  image.fill(2, 2448, 2448 + 2352);
  const originalPcm = Buffer.concat([Buffer.alloc(2352, 1), Buffer.alloc(2352, 2)]);
  const fakeMp3 = Buffer.from("injected-mp3");
  const encode = async (pcm: Uint8Array, destination: string) => {
    assert.deepEqual(Buffer.from(pcm), originalPcm);
    await writeFile(destination, emptyOggPage(123));
  };
  try {
    await writeFile(descriptor, mdsFixture());
    await writeFile(path.join(root, "DISC.mdf"), image);
    const baseline = await extractCdAudio(descriptor, output, { encode });
    const ogg = await readFile(path.join(output, "TRACK02.ogg"));
    const options = {
      encode,
      ffmpegPath: "must-not-run-ffmpeg",
      mp3Fallback: {
        ffmpegPath: "must-not-run-fallback-ffmpeg",
        encode: async (pcm: Uint8Array, destination: string) => {
          assert.deepEqual(Buffer.from(pcm), originalPcm);
          assert.equal(path.extname(destination), ".mp3");
          await writeFile(destination, fakeMp3);
        },
      },
    };
    const first = await extractCdAudio(descriptor, output, options);
    assert.deepEqual(await extractCdAudio(descriptor, output, options), first);
    assert.deepEqual(first.entries[0].outputs[0], baseline.entries[0].outputs[0]);
    assert.deepEqual(await readFile(path.join(output, "TRACK02.ogg")), ogg);
    assert.deepEqual(await readFile(path.join(output, "TRACK02.mp3")), fakeMp3);
    assert.equal(first.entries[0].sourceSha256, baseline.entries[0].sourceSha256);
    assert.equal(first.entries[0].outputs[1].mimeType, "audio/mpeg");
    assert.deepEqual(first.entries[0].outputs[1].codecs, ["mp3"]);
    const nonCd = { ...baseline.entries[0], source: "SOUND/KEEP.WAV", custom: "preserved" };
    const media = {
      schemaVersion: 1 as const,
      audioCount: 2,
      videoCount: 0,
      sourceBytes: 2 * originalPcm.length,
      outputBytes: 2 * ogg.length,
      custom: { preserved: true },
      entries: [nonCd, { ...baseline.entries[0], custom: "cd-metadata" }],
    };
    const merged = mergeCdAudioIndex(media, first);
    assert.deepEqual(merged, {
      ...media,
      outputBytes: media.outputBytes + fakeMp3.length,
      entries: [nonCd, {
        ...first.entries[0],
        custom: "cd-metadata",
        outputs: first.entries[0].outputs.map((entry) => ({ ...entry, path: `cd/${entry.path}` })),
      }],
    });
    assert.deepEqual(mergeCdAudioIndex(merged, first), merged);
    const fresh = mergeCdAudioIndex({ ...media, audioCount: 1, sourceBytes: originalPcm.length,
      outputBytes: ogg.length, entries: [nonCd] }, first);
    assert.equal(fresh.audioCount, 2);
    assert.equal(fresh.entries.length, 2);
    assert.equal(fresh.outputBytes, merged.outputBytes);
    const published = await readFile(path.join(output, "index.json"));
    await assert.rejects(extractCdAudio(descriptor, output, {
      encode,
      mp3Fallback: { encode: async () => { throw new Error("fallback failed"); } },
    }), /fallback failed/);
    assert.deepEqual(await readFile(path.join(output, "index.json")), published);
    assert.deepEqual(await readFile(path.join(output, "TRACK02.mp3")), fakeMp3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { extractMediaTree, type MediaTranscoder } from "./extract";

function emptyOggPage(serial: number): Buffer {
  const page = Buffer.alloc(27);
  page.write("OggS", 0, "ascii");
  page.writeUInt32LE(serial, 14);
  return page;
}

function webmFixture(serial: number): Buffer {
  const track = Buffer.concat([Buffer.from([0x73, 0xc5, 0x88]), Buffer.alloc(8, serial)]);
  const tag = Buffer.concat([Buffer.from([0x63, 0xc5, 0x88]), Buffer.alloc(8, serial)]);
  return Buffer.concat([track, tag, Buffer.from([0x1f, 0x43, 0xb6, 0x75])]);
}

test("indexes deterministic browser media with an injected transcoder", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dark-colony-media-"));
  const source = path.join(root, "source");
  const output = path.join(root, "output");
  let serial = 1;
  const transcode: MediaTranscoder = async (_input, destination, format) => {
    const bytes =
      format === "audio-ogg"
        ? emptyOggPage(serial++)
        : format === "video-webm"
          ? webmFixture(serial++)
          : Buffer.from("fixed-mp4");
    await writeFile(destination, bytes);
  };
  try {
    await mkdir(path.join(source, "SOUND"), { recursive: true });
    await mkdir(path.join(source, "AVI"), { recursive: true });
    await writeFile(path.join(source, "SOUND", "UNIT.WAV"), "wave-source");
    await writeFile(path.join(source, "AVI", "INTRO.AVI"), "avi-source");

    const first = await extractMediaTree(source, output, { concurrency: 2, transcode });
    const firstAudio = await readFile(path.join(output, "audio", "SOUND", "UNIT.ogg"));
    const firstIndex = await readFile(path.join(output, "index.json"), "utf8");
    const second = await extractMediaTree(source, output, { concurrency: 2, transcode });

    assert.deepEqual(second, first);
    assert.deepEqual(await readFile(path.join(output, "audio", "SOUND", "UNIT.ogg")), firstAudio);
    assert.equal(await readFile(path.join(output, "index.json"), "utf8"), firstIndex);
    assert.deepEqual(
      { audio: first.audioCount, video: first.videoCount },
      { audio: 1, video: 1 },
    );
    assert.equal(first.entries.find(({ kind }) => kind === "video")?.outputs.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

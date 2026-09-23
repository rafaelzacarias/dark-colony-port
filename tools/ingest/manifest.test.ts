import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { generateManifest } from "./manifest";

test("builds a deterministic, content-addressed manifest", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "dark-colony-manifest-"));

  try {
    await mkdir(path.join(fixtureRoot, "DC", "AVI"), { recursive: true });
    await mkdir(path.join(fixtureRoot, "DC", "SCENARIO"), { recursive: true });

    const aviHeader = Buffer.alloc(16);
    aviHeader.write("RIFF", 0, "ascii");
    aviHeader.write("AVI ", 8, "ascii");

    await writeFile(path.join(fixtureRoot, "DC", "AVI", "INTRO.AVI"), aviHeader);
    await writeFile(path.join(fixtureRoot, "DC", "SCENARIO", "RESULT.001"), "~4Mission complete\r\n");
    await writeFile(path.join(fixtureRoot, "DC", "SCENARIO", "EMPTY.TRO"), Buffer.alloc(0));
    await writeFile(path.join(fixtureRoot, "README.TXT"), "Disc fixture\r\n");
    await writeFile(path.join(fixtureRoot, ".DS_Store"), "host metadata");
    await writeFile(path.join(fixtureRoot, "._README.TXT"), "host metadata");

    const first = await generateManifest(fixtureRoot);
    const second = await generateManifest(fixtureRoot);

    assert.deepEqual(second, first);
    assert.equal(first.summary.fileCount, 4);
    assert.equal(first.summary.directoryCount, 4);
    assert.deepEqual(first.summary.zeroLengthFiles, ["DC/SCENARIO/EMPTY.TRO"]);
    assert.match(first.integrity.sourceTreeSha256, /^[a-f0-9]{64}$/);
    assert.equal(first.files[0]?.detectedFormat, "riff-avi");
    assert.equal(first.files[1]?.detectedFormat, "empty");
    assert.equal(first.files[2]?.category, "scenario");
    assert.equal(first.files[3]?.contentKind, "text");
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
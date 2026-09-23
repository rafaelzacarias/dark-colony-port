import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { extractInterfaceImages } from "./extract";

test("copies browser-native interface images deterministically", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dark-colony-interface-"));
  try {
    const source = path.join(root, "DC", "INTRFACE");
    const output = path.join(root, "output");
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, "INTRFACE.GIF"), Buffer.from("GIF89a"));
    await writeFile(path.join(source, "IGNORE.DAT"), Buffer.from("no"));
    const first = await extractInterfaceImages(path.join(root, "DC"), output);
    const firstIndex = await readFile(path.join(output, "index.json"), "utf8");
    const second = await extractInterfaceImages(path.join(root, "DC"), output);
    assert.deepEqual(second, first);
    assert.equal(await readFile(path.join(output, "index.json"), "utf8"), firstIndex);
    assert.equal(first.imageCount, 1);
    assert.equal(await readFile(path.join(output, "INTRFACE.GIF"), "ascii"), "GIF89a");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

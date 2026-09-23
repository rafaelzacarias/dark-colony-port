import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { extractAnimationTree } from "./extract";

function validFin(): Buffer {
  const buffer = Buffer.alloc(222);
  buffer.writeInt16LE(29, 0);
  buffer.writeUInt16LE(1, 2);
  buffer.writeUInt16LE(1, 4);
  buffer.writeUInt16LE(1, 6);
  buffer.write("dott", 8, "ascii");
  buffer.write("DOTTSTAND0", 16, "ascii");
  buffer.writeUInt16LE(1, 36);
  buffer.write("dott", 200, "ascii");
  return buffer;
}

test("exports parsed FIN metadata and indexes unsupported and invalid files deterministically", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dark-colony-animations-"));
  const source = path.join(root, "source");
  const output = path.join(root, "output");

  try {
    await mkdir(source);
    await writeFile(path.join(source, "GOOD.FIN"), validFin());
    const legacy = Buffer.alloc(8);
    legacy.writeInt16LE(-3, 0);
    await writeFile(path.join(source, "LEGACY.FIN"), legacy);
    const invalid = Buffer.alloc(8);
    invalid.writeInt16LE(29, 0);
    invalid.writeUInt16LE(1, 2);
    await writeFile(path.join(source, "INVALID.FIN"), invalid);

    const first = await extractAnimationTree(source, output);
    const firstIndex = await readFile(path.join(output, "index.json"), "utf8");
    const firstMetadata = await readFile(path.join(output, "GOOD.json"), "utf8");
    const second = await extractAnimationTree(source, output);

    assert.deepEqual(second, first);
    assert.equal(await readFile(path.join(output, "index.json"), "utf8"), firstIndex);
    assert.equal(await readFile(path.join(output, "GOOD.json"), "utf8"), firstMetadata);
    assert.deepEqual(
      {
        files: first.fileCount,
        parsed: first.parsedCount,
        unsupported: first.unsupportedCount,
        invalid: first.invalidCount,
      },
      { files: 3, parsed: 1, unsupported: 1, invalid: 1 },
    );
    assert.equal(JSON.parse(firstMetadata).states[0].name, "DOTTSTAND0");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

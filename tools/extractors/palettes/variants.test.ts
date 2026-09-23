import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { RemapTable } from "../../../src/render/palette";
import { extractAnimationTree } from "../animations/extract";
import { parseFin, UnsupportedFinVariantError } from "../animations/fin";

const sourceRoot = new URL("../../../raw_cd/DC/", import.meta.url);
const legacyFiles = [
  ["LIGHT1B.FIN", 190, 49, 145, 2],
  ["LIGHT1M.FIN", 116, 49, 145, 2],
  ["LIGHT2B.FIN", 116, 208, 112, 2],
  ["LIGHT2M.FIN", 116, 208, 112, 2],
  ["LIGHT3B.FIN", 116, 144, 336, 2],
  ["LIGHT3F.FIN", 2146, 144, 336, 4],
  ["LIGHT3M.FIN", 116, 144, 336, 2],
  ["LIGHT4B.FIN", 116, 368, 241, 2],
  ["LIGHT4F.FIN", 2146, 368, 240, 4],
  ["LIGHT4M.FIN", 116, 368, 240, 2],
  ["LITE.FIN", 1492, 84, 43, 2],
] as const;

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

test("short multiplayer RMP has 264 complete rows but is not a standard runtime table", async () => {
  const bytes = await readFile(new URL("SCENARIO/MPLAYER/PALETTE.RMP", sourceRoot));
  assert.equal(bytes.length, 264 * 256);
  assert.equal(digest(bytes),
    "364faf322e0e10eda4315d25fd5561c116d613ca5c487d267c5d258a715fc61f");
  assert.throws(() => new RemapTable(bytes));
  assert.deepEqual(bytes.subarray(0, 256), Buffer.alloc(256, 10));

  const names = (await readdir(sourceRoot, { recursive: true })).filter((name) => name.endsWith(".RMP"));
  assert.equal(names.length, 21);
  let standardCount = 0;
  for (const name of names) {
    if (name === "SCENARIO/MPLAYER/PALETTE.RMP") continue;
    const standard = await readFile(new URL(name, sourceRoot));
    assert.equal(standard.length, 196608, name);
    assert.deepEqual(Buffer.from(new RemapTable(standard).toTextureBytes()), standard, name);
    assert.notDeepEqual(standard.subarray(0, bytes.length), bytes, name);
    for (let shortRow = 256; shortRow < 264; shortRow += 1) {
      const row = bytes.subarray(shortRow * 256, (shortRow + 1) * 256);
      for (let standardRow = 0; standardRow < 768; standardRow += 1) {
        assert.equal(row.equals(standard.subarray(standardRow * 256, (standardRow + 1) * 256)),
          false, `${name}: short row ${shortRow}, standard row ${standardRow}`);
      }
    }
    standardCount += 1;
  }
  assert.equal(standardCount, 20);
});

test("all eleven legacy lighting FINs remain explicitly unsupported", async () => {
  const directory = new URL("ANIMATE/", sourceRoot);
  const legacyNames: string[] = [];
  let parsedCount = 0;
  const invalidNames: string[] = [];
  for (const name of (await readdir(directory)).filter((name) => name.endsWith(".FIN")).sort()) {
    const bytes = await readFile(new URL(name, directory));
    if (bytes.readInt16LE(0) !== -3) {
      try {
        parseFin(bytes);
        parsedCount += 1;
      } catch {
        invalidNames.push(name);
      }
      continue;
    }
    legacyNames.push(name);
    assert.throws(() => parseFin(bytes), UnsupportedFinVariantError, name);
    const expected = legacyFiles.find(([file]) => file === name);
    assert.ok(expected, name);
    assert.deepEqual([bytes.length, bytes.readUInt16LE(2), bytes.readUInt16LE(4), bytes.readUInt16LE(6)],
      expected.slice(1), name);
    const nameCount = bytes.readUInt16LE(6);
    assert.ok(8 + nameCount * 16 <= bytes.length, name);
    assert.equal(bytes.subarray(8, 14).toString("ascii"), "NONAME", name);
    const standardChildOffset = 8 + nameCount * 8 + bytes.readUInt16LE(4) * 20 + bytes.readUInt16LE(2) * 164;
    assert.ok(standardChildOffset > bytes.length, name);
    const forcedStandard = Buffer.from(bytes);
    forcedStandard.writeInt16LE(29, 0);
    assert.throws(() => parseFin(forcedStandard), /truncated/, name);
  }
  assert.deepEqual(legacyNames, legacyFiles.map(([name]) => name));
  assert.equal(parsedCount, 164);
  assert.deepEqual(invalidNames, ["ANIM.FIN", "BUILDING.FIN"]);
});

test("legacy FIN export retains source fingerprints and diagnostics without timeline metadata", async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "dc-legacy-fin-gap-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const source = path.join(temporary, "source");
  const output = path.join(temporary, "animations");
  await mkdir(source);
  for (const [name] of legacyFiles) {
    await copyFile(new URL(`ANIMATE/${name}`, sourceRoot), path.join(source, name));
  }
  const index = await extractAnimationTree(source, output);
  assert.equal(index.fileCount, 11);
  assert.equal(index.parsedCount, 0);
  assert.equal(index.unsupportedCount, 11);
  assert.equal(index.invalidCount, 0);
  assert.equal(index.stateCount, 0);
  assert.equal(index.timelineCount, 0);
  assert.equal(index.childCount, 0);
  for (const entry of index.entries) {
    assert.equal(entry.status, "unsupported");
    assert.equal(entry.formatTag, -3);
    assert.equal(entry.sourceSha256, digest(await readFile(path.join(source, entry.source))));
    assert.equal(entry.error, "unsupported FIN format tag -3");
    assert.equal(entry.metadata, undefined);
  }
  assert.deepEqual(await readdir(output), ["index.json"]);
  const first = await readFile(path.join(output, "index.json"));
  assert.deepEqual(await extractAnimationTree(source, output), index);
  assert.deepEqual(await readFile(path.join(output, "index.json")), first);
});

test("pinned DC.EXE loader anchors do not establish a short RMP or legacy FIN decoder", async () => {
  const executable = await readFile(new URL("DC.EXE", sourceRoot));
  assert.equal(digest(executable), "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  const peOffset = executable.readUInt32LE(0x3c);
  assert.equal(executable.readUInt32LE(peOffset), 0x00004550);
  const sectionCount = executable.readUInt16LE(peOffset + 6);
  const optionalOffset = peOffset + 24;
  assert.equal(executable.readUInt16LE(optionalOffset), 0x10b);
  const imageBase = executable.readUInt32LE(optionalOffset + 28);
  const sectionOffset = optionalOffset + executable.readUInt16LE(peOffset + 20);
  function at(address: number, length: number): Buffer {
    const relative = address - imageBase;
    for (let section = 0; section < sectionCount; section += 1) {
      const offset = sectionOffset + section * 40;
      const virtual = executable.readUInt32LE(offset + 12);
      const size = executable.readUInt32LE(offset + 16);
      if (relative < virtual || relative + length > virtual + size) continue;
      const raw = executable.readUInt32LE(offset + 20) + relative - virtual;
      return executable.subarray(raw, raw + length);
    }
    throw new Error(`Unmapped executable address ${address.toString(16)}`);
  }
  assert.equal(at(0x44f254, 17).toString("hex"), "ba00000300a1fc91480089f3e81371fbff");
  assert.equal(at(0x4256a9, 19).toString("hex"), "ba0200000089c189c689c38d4572e8bc0cfeff");
  assert.equal(at(0x4256bc, 45).toString("hex"),
    "ba010000008d457e89cbe8990ffeffba010000008d456a89cbe88a0ffeffba010000008d456e89cbe87b0ffeff");
});
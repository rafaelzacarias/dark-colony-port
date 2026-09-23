import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractGameData } from "../extractors/data/extract";

const root = fileURLToPath(new URL("../../", import.meta.url));
const published = path.join(root, "public/assets/generated/data");
const target = "messages/HUMAN/HUMAN05.json";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function snapshot(directory: string): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  async function visit(relative: string): Promise<void> {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const filename = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else result.set(filename, await readFile(path.join(directory, filename)));
    }
  }
  await visit("");
  return result;
}

const manifestPath = path.join(root, "asset_manifest.json");
const manifestBefore = await readFile(manifestPath);
const sourcePath = path.join(root, "raw_cd/DC/SCENARIO/HUMAN/HUMAN05.MSG");
const sourceBefore = await readFile(sourcePath);
assert.equal(hash(sourceBefore), "882d5020a7bdf427c8637c0724655dbb7ea0befbd13088a0df895571827f84f0");
const before = await snapshot(published);
const isolated = await mkdtemp(path.join(os.tmpdir(), "dc-human05-messages-"));
await extractGameData(path.join(root, "raw_cd/DC"), path.join(isolated, "data"));
const regenerated = await snapshot(path.join(isolated, "data"));
assert.deepEqual([...regenerated.keys()].sort(), [...before.keys()].sort());
const changed = [...before.keys()].filter(filename => !before.get(filename)!.equals(regenerated.get(filename)!));
assert.ok(changed.every(filename => filename === target), JSON.stringify(changed));
const previous = JSON.parse(before.get(target)!.toString());
const next = JSON.parse(regenerated.get(target)!.toString());
assert.deepEqual(next.source, previous.source);
assert.deepEqual(next.messages.map((entry: { id: number }) => entry.id), Array.from({ length: 16 }, (_, index) => index + 1));
assert.deepEqual(next.messages.filter((entry: { id: number }) => entry.id !== 4 && entry.id !== 5),
  previous.messages.filter((entry: { id: number }) => entry.id !== 4 && entry.id !== 5));
assert.equal(next.messages[4].text, "WARNING...WARNING...WARNING...");
assert.equal(previous.messages.find((entry: { id: number }) => entry.id === 4).text,
  changed.length ? `${next.messages[3].text}\n\ntext 5.\n${next.messages[4].text}` : next.messages[3].text);
assert.deepEqual(await readFile(sourcePath), sourceBefore);
assert.deepEqual(await readFile(manifestPath), manifestBefore);
await copyFile(path.join(isolated, "data", target), path.join(published, target));
const after = await snapshot(published);
for (const [filename, bytes] of after) assert.deepEqual(bytes, regenerated.get(filename), filename);
console.log(JSON.stringify({ isolated, files: after.size, changed,
  before: { bytes: before.get(target)!.length, sha256: hash(before.get(target)!) },
  after: { bytes: after.get(target)!.length, sha256: hash(after.get(target)!) },
  sourceSha256: hash(sourceBefore), manifestSha256: hash(manifestBefore),
  dataIndexSha256: hash(after.get("index.json")!), exactReproduction: true }, null, 2));
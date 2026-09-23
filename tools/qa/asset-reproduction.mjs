import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdtemp, readFile, readdir, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function fingerprint(filename) {
  const digest = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(filename)) {
    bytes += chunk.length;
    digest.update(chunk);
  }
  const result = { bytes, sha256: digest.digest("hex") };
  if (filename.endsWith(".json")) {
    result.structuredSha256 = hash(JSON.stringify(canonical(JSON.parse(await readFile(filename, "utf8")))));
  }
  return result;
}

async function snapshot(root) {
  root = await realpath(root);
  const files = [];
  const links = [];
  const directories = [];
  async function visit(absolute, relative, ancestors) {
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) {
      const resolved = await realpath(absolute);
      if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error(`External symlink: ${absolute}`);
      links.push({ path: relative, target: await readlink(absolute), resolved });
      return visit(resolved, relative, ancestors);
    }
    if (info.isDirectory()) {
      const resolved = await realpath(absolute);
      if (ancestors.includes(resolved)) throw new Error(`Symlink cycle: ${absolute}`);
      directories.push(relative);
      for (const name of (await readdir(absolute)).sort()) {
        await visit(path.join(absolute, name), relative ? `${relative}/${name}` : name, [...ancestors, resolved]);
      }
    } else if (info.isFile()) {
      files.push({ path: relative, ...await fingerprint(absolute) });
    } else throw new Error(`Unsupported filesystem node: ${absolute}`);
  }
  await visit(root, "", []);
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return { schemaVersion: 1, root, files, links, directories, treeSha256: treeHash(files) };
}

function treeHash(files, structured = false) {
  return hash(files.map((entry) => `${entry.path}\0${structured ? entry.structuredSha256 ?? entry.sha256 : `${entry.bytes}\0${entry.sha256}`}\n`).join(""));
}

function partition(filename) {
  if (filename.startsWith(".indexed-generations/")) return "generation-storage";
  if (filename.split("/").some((name) => name === ".DS_Store")) return "host-metadata";
  return "published";
}

function compare(before, after) {
  const sections = {};
  for (const section of ["published", "generation-storage", "host-metadata"]) {
    const oldFiles = before.files.filter((entry) => partition(entry.path) === section);
    const newFiles = after.files.filter((entry) => partition(entry.path) === section);
    const oldMap = new Map(oldFiles.map((entry) => [entry.path, entry]));
    const newMap = new Map(newFiles.map((entry) => [entry.path, entry]));
    const missing = oldFiles.filter((entry) => !newMap.has(entry.path));
    const added = newFiles.filter((entry) => !oldMap.has(entry.path));
    const changed = [];
    let identical = 0;
    for (const entry of oldFiles) {
      const other = newMap.get(entry.path);
      if (!other) continue;
      if (entry.sha256 === other.sha256 && entry.bytes === other.bytes) identical++;
      else changed.push({ path: entry.path, before: entry, after: other,
        structuredEqual: entry.structuredSha256 !== undefined && entry.structuredSha256 === other.structuredSha256 });
    }
    sections[section] = {
      beforeCount: oldFiles.length, afterCount: newFiles.length,
      beforeBytes: oldFiles.reduce((total, entry) => total + entry.bytes, 0),
      afterBytes: newFiles.reduce((total, entry) => total + entry.bytes, 0),
      beforeSha256: treeHash(oldFiles), afterSha256: treeHash(newFiles),
      beforeStructuredSha256: treeHash(oldFiles, true), afterStructuredSha256: treeHash(newFiles, true),
      identical, missing, added, changed,
    };
  }
  return { schemaVersion: 1, beforeRoot: before.root, afterRoot: after.root, sections,
    links: { before: before.links, after: after.links } };
}

function differences(before, after, pointer = "", result = []) {
  if (JSON.stringify(canonical(before)) === JSON.stringify(canonical(after))) return result;
  if (before !== null && after !== null && typeof before === "object" && typeof after === "object"
      && Array.isArray(before) === Array.isArray(after)) {
    for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      differences(before[key], after[key], `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`, result);
    }
  } else result.push({ pointer, before: before === undefined ? { absent: true } : before,
    after: after === undefined ? { absent: true } : after });
  return result;
}

async function verifyIndexes(root, sourceRoot) {
  const checks = [];
  async function check(base, entry, kind) {
    const filename = path.resolve(base, entry.path);
    if (!filename.startsWith(`${path.resolve(base)}${path.sep}`)) throw new Error(`Escaping indexed path: ${entry.path}`);
    let actual;
    try { actual = await fingerprint(filename); }
    catch (error) { actual = { error: error.message }; }
    checks.push({ kind, path: entry.path, expected: entry, actual,
      ok: actual.sha256 === entry.sha256 && actual.bytes === entry.bytes });
  }
  const indexedRoot = await realpath(path.join(root, "indexed"));
  const indexBytes = await readFile(path.join(indexedRoot, "index.json"));
  const index = JSON.parse(indexBytes);
  const checksum = await readFile(path.join(indexedRoot, "index.sha256"), "utf8");
  checks.push({ kind: "indexed-checksum", ok: checksum === `${hash(indexBytes)}  index.json\n` });
  for (const entry of index.outputs) await check(indexedRoot, entry, "indexed-output");
  for (const entry of index.sources) await check(sourceRoot, entry, "indexed-source");
  for (const relative of ["media", "media/cd"]) {
    const media = JSON.parse(await readFile(path.join(root, relative, "index.json"), "utf8"));
    for (const entry of media.entries) {
      for (const output of entry.outputs) await check(path.join(root, relative), output, `${relative}-output`);
      if (!entry.source.startsWith("CDDA/")) {
        await check(sourceRoot, { path: entry.source, bytes: entry.sourceBytes, sha256: entry.sourceSha256 }, "media-source");
      }
    }
  }
  return { checks, failures: checks.filter((entry) => !entry.ok) };
}

async function selfTest() {
  assert.equal(partition("media/.DS_Store"), "host-metadata");
  assert.equal(partition("media/._effect.wav"), "published");
  assert.equal(partition(".indexed-generations/old/index.json"), "generation-storage");
  const root = await mkdtemp(path.join(os.tmpdir(), "dc-reproduction-test-"));
  try {
    await writeFile(path.join(root, "sample.json"), '{"second":2,"first":[1,2]}\n');
    await symlink("sample.json", path.join(root, "linked.json"));
    const before = await snapshot(root);
    await writeFile(path.join(root, "sample.json"), '{"first":[1,2],"second":2}');
    const formatting = compare(before, await snapshot(root));
    assert.equal(formatting.sections.published.changed.length, 2);
    assert.ok(formatting.sections.published.changed.every((entry) => entry.structuredEqual));
    await writeFile(path.join(root, "sample.json"), '{"first":[2,1],"second":3}');
    const changed = compare(before, await snapshot(root));
    assert.ok(changed.sections.published.changed.every((entry) => !entry.structuredEqual));
    assert.deepEqual(differences({ value: 1 }, { value: 2 }), [{ pointer: "/value", before: 1, after: 2 }]);
    await writeFile(path.join(root, "added.bin"), new Uint8Array([0, 255]));
    assert.equal(compare(before, await snapshot(root)).sections.published.added.length, 1);
    await rm(path.join(root, "linked.json"));
    assert.equal(compare(before, await snapshot(root)).sections.published.missing.length, 1);
    assert.equal(before.links[0].target, "sample.json");
    console.log("PASS: raw hashes, canonical object keys, ordered arrays, semantic differences, added/missing files, symlink snapshot");
  } finally { await rm(root, { recursive: true, force: true }); }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "self-test") return selfTest();
  if (command === "snapshot" && args.length === 2) {
    const result = await snapshot(args[0]);
    await writeFile(args[1], `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify({ files: result.files.length, treeSha256: result.treeSha256, links: result.links }));
    return;
  }
  if (command === "compare" && args.length === 3) {
    const before = JSON.parse(await readFile(args[0], "utf8"));
    const after = JSON.parse(await readFile(args[1], "utf8"));
    const report = compare(before, after);
    for (const entry of report.sections.published.changed) {
      if (!entry.path.endsWith(".json")) continue;
      const oldPath = path.join(before.root, entry.path);
      const newPath = path.join(after.root, entry.path);
      assert.equal((await fingerprint(oldPath)).sha256, entry.before.sha256, `Baseline changed: ${entry.path}`);
      assert.equal((await fingerprint(newPath)).sha256, entry.after.sha256, `Candidate changed: ${entry.path}`);
      entry.differences = differences(JSON.parse(await readFile(oldPath, "utf8")), JSON.parse(await readFile(newPath, "utf8")));
    }
    await writeFile(args[2], `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
    for (const [name, section] of Object.entries(report.sections)) {
      console.log(`${name}: ${section.beforeCount} -> ${section.afterCount}; identical=${section.identical}; changed=${section.changed.length}; missing=${section.missing.length}; added=${section.added.length}`);
    }
    const section = report.sections.published;
    if (section.changed.length || section.missing.length || section.added.length) process.exitCode = 1;
    return;
  }
  if (command === "verify-indexes" && args.length === 3) {
    const result = await verifyIndexes(args[0], args[1]);
    await writeFile(args[2], `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
    console.log(`Index checks: ${result.checks.length}; failures: ${result.failures.length}`);
    if (result.failures.length) process.exitCode = 1;
    return;
  }
  throw new Error("Usage: node tools/qa/asset-reproduction.mjs self-test | snapshot ROOT REPORT | compare BEFORE AFTER REPORT | verify-indexes GENERATED DC_SOURCE REPORT");
}

await main();
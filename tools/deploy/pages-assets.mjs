import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, access, writeFile, realpath, mkdtemp, mkdir, cp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";

const root = fileURLToPath(new URL("../../", import.meta.url));
const generated = join(root, "public/assets/generated");
const mode = process.argv[2];
if (!["--check", "--pack"].includes(mode) || process.argv.length !== 3) {
  throw new Error("Use npm run pages:check or npm run pages:assets");
}
const required = ["sprites/index.json", "animations/index.json", "media/index.json",
  "indexed/index.json", "indexed/index.sha256", "data/units.json", "data/dependencies.json",
  "data/scenarios/HUMAN/HUMAN01.json", "data/scenarios/ALIEN/ALIEN01.json",
  "interface/INTRFACE.GIF", "interface/STORY.GIF", "interface/SHUMAN.GIF"];
for (const path of required) {
  try { await access(join(generated, path)); }
  catch { throw new Error(`Missing generated asset: ${path}. Extract your authorized game data first.`); }
}
let totalBytes = 0;
let fileCount = 0;
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (directory === generated && entry.name === ".indexed-generations") continue;
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const resolved = await realpath(path);
      const location = relative(join(generated, ".indexed-generations"), resolved);
      if (path !== join(generated, "indexed") || location.startsWith(`..${sep}`) || location === ".." || !location) {
        throw new Error(`Unexpected asset symlink: ${path}`);
      }
      await inspect(resolved);
    } else if (entry.isDirectory()) await inspect(path);
    else if (entry.isFile()) { totalBytes += (await lstat(path)).size; fileCount++; }
    else throw new Error(`Unsupported asset entry: ${path}`);
  }
}
await inspect(generated);
if (totalBytes > 900 * 1024 * 1024) {
  throw new Error("Generated assets exceed the 900 MiB safety budget for a GitHub Pages site (1 GB limit).");
}
console.log(`Validated ${fileCount} generated files, ${(totalBytes / 1024 / 1024).toFixed(1)} MiB.`);
if (mode === "--pack") {
  const archive = join(root, "pages-assets.tar.gz");
  const staging = await mkdtemp(join(tmpdir(), "darkcolony-pages-"));
  try {
    await mkdir(join(staging, "assets/generated"), { recursive: true });
    for (const entry of await readdir(generated)) {
      if (entry === ".indexed-generations") continue;
      await cp(join(generated, entry), join(staging, "assets/generated", entry), { recursive: true, dereference: true });
    }
    const result = spawnSync("tar", ["-czf", archive, "--exclude=.DS_Store", "-C", staging, "assets/generated"],
      { stdio: "inherit", env: { ...process.env, COPYFILE_DISABLE: "1" } });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Asset packaging failed (${result.status}).`);
  } finally { await rm(staging, { recursive: true, force: true }); }
  const digest = createHash("sha256");
  for await (const bytes of createReadStream(archive)) digest.update(bytes);
  const checksum = digest.digest("hex");
  await writeFile(`${archive}.sha256`, `${checksum}  pages-assets.tar.gz\n`);
  console.log(`Created pages-assets.tar.gz\nSHA-256: ${checksum}`);
  console.log("Only publish this bundle if you have permission to redistribute its game assets.");
}
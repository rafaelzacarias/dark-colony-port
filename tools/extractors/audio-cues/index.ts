import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createCueCatalog } from "../../../src/audio/cues";

const root = new URL("../../../", import.meta.url);
const files = ["SOUND2.DAT", "SLIST.DAT"] as const;
const sources = await Promise.all(files.map(async (file) => {
  const bytes = await readFile(new URL(`raw_cd/DC/SOUND/${file}`, root));
  return { file: `SOUND/${file}`, sha256: createHash("sha256").update(bytes).digest("hex"), text: bytes.toString("utf8") };
}));
const catalog = createCueCatalog(sources[0].text, sources[1].text);
const rows = [
  "export const legacyCueCatalog = {",
  `  provenance: ${JSON.stringify(sources.map(({ file, sha256 }) => ({ file, sha256 })))},`,
  "  sounds: [",
  ...catalog.sounds.map((sound) => `    ${JSON.stringify(sound)},`),
  "  ],",
  "  bindings: [",
  ...catalog.bindings.map((binding) => `    ${JSON.stringify(binding)},`),
  "  ],",
  "} as const;",
  "",
];
await writeFile(new URL("src/audio/legacy-cues.ts", root), rows.join("\n"));
console.log(`Extracted ${catalog.sounds.length} sounds and ${catalog.bindings.length} bindings`);
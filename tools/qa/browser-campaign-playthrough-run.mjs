import { spawnSync } from "node:child_process";
import { closeSync, openSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [faction = "both", ticks = "30000", intent = "win", label = String(Date.now())] = process.argv.slice(2);
if (!["human", "alien", "both"].includes(faction) || !["win", "loss"].includes(intent) ||
    !/^[a-zA-Z0-9-]+$/.test(label) || !Number.isInteger(Number(ticks)) || Number(ticks) < 1 || Number(ticks) > 50000) {
  throw new RangeError("Usage: node tools/qa/browser-campaign-playthrough-run.mjs [human|alien|both] [1..50000] [win|loss] [unique-label]");
}
const root = fileURLToPath(new URL("../../", import.meta.url));
const log = `/tmp/dc-m02-${label}.log`, output = openSync(log, "wx");
process.on("SIGINT", () => {});
const execution = spawnSync(process.execPath, ["--import", `${root}node_modules/tsx/dist/loader.mjs`, "--test", "--test-isolation=none",
  `${root}tools/qa/browser-campaign-playthrough.test.ts`, `${root}tools/qa/browser-campaign-playthrough-run.test.ts`],
{ cwd: root, env: { ...process.env, DC_M02_FACTION: faction, DC_M02_TICKS: ticks, DC_M02_INTENT: intent },
  detached: true, timeout: faction === "both" ? 1830000 : 930000, killSignal: "SIGTERM", stdio: ["ignore", output, output] });
closeSync(output);
const result = { log, code: execution.status, signal: execution.signal, error: execution.error?.message };
writeFileSync(`/tmp/dc-m02-${label}.exit.json`, JSON.stringify(result));
console.log(JSON.stringify(result));
process.exitCode = execution.status ?? 1;
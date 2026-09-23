import { spawnSync } from "node:child_process";
import { openSync, closeSync, writeFileSync, mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.on("SIGINT", () => {});
const root = fileURLToPath(new URL("../../", import.meta.url));
const output = mkdtempSync("/tmp/dc-picker-validation-");
const report = [];
for (const [name, command, args, timeout] of [
  ["focused", process.execPath, ["--import", root + "node_modules/tsx/dist/loader.mjs", "--test",
    root + "tools/qa/campaign-mission-picker.test.ts", root + "tools/qa/main-campaign-ui.test.ts"], 180000],
  ["types", root + "node_modules/.bin/tsc", ["-p", "tsconfig.app.json", "--pretty", "false"], 60000],
  ["browser", process.execPath, [root + "tools/qa/campaign-mission-picker-browser.mjs"], 260000],
]) {
  const log = `${output}/${name}.log`;
  const descriptor = openSync(log, "wx");
  const run = spawnSync(command, args, { cwd: root, stdio: ["ignore", descriptor, descriptor],
    detached: true, timeout, killSignal: "SIGKILL" });
  closeSync(descriptor);
  report.push({ name, log, code: run.status, signal: run.signal, error: run.error?.message });
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.at(-1)));
  if (run.status !== 0) { process.exitCode = 1; break; }
}
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const driver = `${root}tools/qa/campaign-13-15.ts`;
const output = mkdtempSync("/tmp/dc-h14-bounded-20260923-");
const directory = `${output}/H14`;
mkdirSync(directory);
const started = Date.now();
const totalMs = 540000;
const receipts = [];
const digest = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const driverBefore = digest(driver);
const write = (name, value) => writeFileSync(`${output}/${name}.json`, JSON.stringify(value, null, 2));
const read = name => existsSync(`${directory}/${name}.json`)
  ? JSON.parse(readFileSync(`${directory}/${name}.json`, "utf8")) : null;
const alive = pid => {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
};
process.on("SIGINT", () => {});
write("launch", { output, started, launcherPid: process.pid, driver, driverBefore,
  mode: "Node/NullCanvas; no browser", mission: "H14", playCapMs: 180000,
  proofCapMs: 330000, totalCapMs: totalMs, fresh: true });
console.log(JSON.stringify({ kind: "H14_BOUNDED_START", output, launcherPid: process.pid }));

function invoke(proof) {
  const allowance = Math.min(proof ? 330000 : 180000, totalMs - (Date.now() - started) - 5000);
  assert.ok(allowance > 7000, "No remaining worker allowance");
  const args = ["--import", `${root}node_modules/tsx/dist/loader.mjs`, driver, "--worker",
    "--case=H14", `--output=${directory}`, `--allowance=${allowance}`, ...(proof ? ["--proof"] : [])];
  const log = `${directory}/${proof ? "proof" : "play"}-${Date.now()}.log`;
  const descriptor = openSync(log, "wx");
  const workerStarted = Date.now();
  let run;
  try {
    run = spawnSync(process.execPath, args, { cwd: root, stdio: ["ignore", descriptor, descriptor],
      detached: true, timeout: allowance, killSignal: "SIGKILL" });
  } finally { closeSync(descriptor); }
  const receipt = { proof, args, log, allowance, code: run.status, signal: run.signal,
    error: run.error?.message, pid: run.pid, elapsedMs: Date.now() - workerStarted,
    reaped: !alive(run.pid) };
  receipts.push(receipt);
  write(proof ? "proof-exit" : "play-exit", receipt);
  assert.ok(receipt.reaped, "Owned worker must be reaped");
  return receipt;
}

function stable(integrity) {
  return integrity && ["changed", "changedAssets", "changedSources"].every(key =>
    Array.isArray(integrity[key]) && integrity[key].length === 0);
}

let failure;
try {
  const play = invoke(false);
  const result = read("result");
  if (play.code === 0 && result?.status === "READY_WIN_UNVERIFIED" &&
      stable(read("integrity")) && driverBefore === digest(driver)) invoke(true);
} catch (error) { failure = error.stack ?? String(error); }
const result = read("result"), proofResult = read("proof-result"), proof = read("proof");
const driverAfter = digest(driver);
const accepted = !failure && driverBefore === driverAfter &&
  receipts.length === 2 && receipts.every(receipt => receipt.code === 0 && receipt.reaped) &&
  stable(read("integrity")) && stable(read("proof-integrity")) &&
  proofResult?.status === "EXACT_READY_WIN" && proof?.exact === true &&
  proof.expectedHash === proof.actualHash;
const summary = { output, mission: "H14", mode: "Node/NullCanvas; no browser",
  accepted, status: accepted ? "EXACT_READY_WIN" : result?.status ?? "HARD_DEADLINE",
  tick: result?.tick, outcome: result?.outcome, diagnostic: result?.diagnostic,
  blockedPath: result?.blockedPath, commands: result?.commands, shots: result?.shots,
  deaths: result?.deaths, proof, failure, receipts, driverBefore, driverAfter,
  runtimeStable: stable(read("integrity")), proofRuntimeStable: stable(read("proof-integrity")),
  elapsedMs: Date.now() - started, ownedWorkersAlive: receipts.filter(receipt => alive(receipt.pid)).map(receipt => receipt.pid) };
write("summary", summary);
console.log(JSON.stringify({ kind: "H14_BOUNDED_FINISH", ...summary }));
process.exitCode = accepted ? 0 : 1;
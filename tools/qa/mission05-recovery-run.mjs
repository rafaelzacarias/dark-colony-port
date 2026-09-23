import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = process.env.DC_M05_RECOVERY_OUTPUT ?? `/tmp/dc-m05-frozen-${Date.now()}`;
const inputs = {
  human: "/tmp/dc-m05-opening-1790145350338/human/checkpoint.json",
  alien: "/tmp/dc-m05-a05-route-1790145424299/alien/checkpoint.json",
  latchedHuman: "/tmp/dc-m05-human-full-1790145526624/human/checkpoint.json",
};
const fingerprint = () => Object.fromEntries(Object.entries(inputs).map(([name, path]) =>
  [name, { path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }]));
const started = Date.now();
const before = fingerprint();
const children = new Set();
mkdirSync(output, { recursive: true });
writeFileSync(`${output}/launch.json`, JSON.stringify({ started, parentPid: process.pid, inputs: before, totalPerWorkerMs: 1140000 }));
process.on("SIGINT", () => {});
const terminate = () => { for (const child of children) child.kill("SIGTERM"); };
process.on("SIGTERM", terminate);
const timer = setTimeout(terminate, 1170000);
const receipts = await Promise.all(["human", "alien"].map(faction => new Promise((resolve, reject) => {
  const log = `${output}/${faction}.log`;
  const descriptor = openSync(log, "wx");
  const child = spawn(process.execPath, ["--import", `${root}node_modules/tsx/dist/loader.mjs`,
    `${root}tools/qa/mission05-playthrough.ts`, "--run", `--faction=${faction}`], {
    cwd: root, detached: true, stdio: ["ignore", descriptor, descriptor],
    env: { ...process.env, DC_M05_WORKER: "", DC_M05_PROOF: "", DC_M05_PRIOR_STEP_MS: "0",
      DC_M05_OUTPUT: output, DC_M05_RESUME: inputs[faction], DC_M05_STEP_MS: "600000", DC_M05_MAX_TICKS: "40000" },
  });
  closeSync(descriptor);
  children.add(child);
  writeFileSync(`${output}/${faction}-launch.json`, JSON.stringify({ pid: child.pid, log }));
  child.once("error", error => { children.delete(child); terminate(); reject(error); });
  child.once("exit", (code, signal) => {
    children.delete(child);
    const receipt = { faction, pid: child.pid, code, signal, elapsedMs: Date.now() - started };
    writeFileSync(`${output}/${faction}-supervisor-exit.json`, JSON.stringify(receipt));
    resolve(receipt);
  });
})));
clearTimeout(timer);
process.removeListener("SIGTERM", terminate);
writeFileSync(`${output}/batch.json`, JSON.stringify({ receipts, before, after: fingerprint(), elapsedMs: Date.now() - started }));
console.log(JSON.stringify({ output, receipts }));
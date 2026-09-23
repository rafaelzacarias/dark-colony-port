import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
for (const intent of ["win", "loss"] as const) test(`AL01 public ${intent}: full source, initialized assets, restore and legal continuation`, (context) => {
  const existingTrace = process.env[`DC_AL01_RENDER_${intent.toUpperCase()}_TRACE`];
  const log = existingTrace ?? join(mkdtempSync(`/tmp/dc-al01-render-${intent}-`), "trace.jsonl");
  context.diagnostic(`Exact trace: ${log}`);
  if (!existingTrace) {
    const output = openSync(log, "wx");
    let execution;
    try {
      execution = spawnSync(process.execPath, ["--import", join(root, "node_modules/tsx/dist/loader.mjs"),
        join(root, "tools/qa/source-playthrough.ts"), `--case=alien-${intent}`, "--render", "--render-every=25",
        "--restore-at=1000", `--limit=${intent === "win" ? 7500 : 2700}`, "--no-repeat"],
      { cwd: root, stdio: ["ignore", output, output], timeout: 300000 });
    } finally { closeSync(output); }
    assert.equal(execution.error, undefined, `${log}: ${execution.error?.message}`);
    assert.equal(execution.status, 0, log);
  } else context.diagnostic("Recorded trace assertion only; no fresh runtime execution");
  const rows = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const record = (kind: string) => {
    const found = rows.find(row => row.kind === kind);
    assert.ok(found, `${log}: missing ${kind}`);
    return found.data;
  };
  assert.equal(record("admission").triggerCount, 9);
  assert.ok(record("harness").args.includes("--render"));
  assert.ok(record("harness").args.includes(`--case=alien-${intent}`));
  assert.equal(record("checkpoint-restored").tick, 1000);
  const result = record("result");
  assert.equal(result.success, true);
  assert.equal(result.diagnostic, null);
  assert.ok(result.tick > 1000 && result.tick <= (intent === "win" ? 7500 : 2700));
  assert.ok(result.shots > 0 && result.deaths > 0);
  assert.deepEqual(result.outcome, { resultCode: intent === "win" ? 0 : 1,
    reasonCode: intent === "win" ? 1 : 2, ready: true });
  const statistics = record("final-state").statistics;
  assert.equal(statistics[intent === "win" ? "1,0,82" : "0,0,73"], intent === "win" ? 11 : 1);
  assert.equal(record("suite-complete").results.length, 1);
  const render = record("render-complete");
  assert.ok(render.spriteDraws > 0);
  for (const archive of ["SAWS", "SAUC", "GRAY", "SALA", "TRSC"]) {
    assert.ok(render.fetched.includes(`/assets/generated/animations/${archive}.json`), archive);
  }
  assert.ok(!render.warnings.some((warning: string) => /missing-state|unsupported-timeline|missing-atlas-frame/.test(warning)), render.warnings.join("\n"));
  assert.ok(rows.filter(row => row.kind === "render-phase").length >= Math.floor(result.tick / 250));
  assert.ok(rows.some(row => row.kind === "command" && row.data.tick > 1000));
  assert.ok(rows.some(row => row.kind === "combat" && row.data.tick > 1000));
});
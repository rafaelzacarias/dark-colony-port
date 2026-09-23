import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
for (const faction of ["human", "alien"] as const) for (const intent of ["win", "loss"] as const) {
  test(`${faction} ${intent}: fresh original source, every-tick render, stationary shots and exact replay`, context => {
    const run = `${faction}-${intent}`;
    const existingTrace = process.env[`DC_STATIONARY_${faction.toUpperCase()}_${intent.toUpperCase()}_TRACE`];
    const log = existingTrace ?? join(mkdtempSync(`/tmp/dc-stationary-${run}-`), "trace.jsonl");
    context.diagnostic(`Exact trace: ${log}`);
    if (!existingTrace) {
      const output = openSync(log, "wx");
      let execution;
      try {
        execution = spawnSync(process.execPath, ["--import", join(root, "node_modules/tsx/dist/loader.mjs"),
          join(root, "tools/qa/source-playthrough.ts"), `--case=${run}`, "--render", "--render-every=1",
          "--restore-at=1000", "--limit=8000", "--audit-fire-movement"],
        { cwd: root, stdio: ["ignore", output, output], timeout: 1800000 });
      } finally { closeSync(output); }
      assert.equal(execution.error, undefined, `${log}: ${execution.error?.message}`);
      assert.equal(execution.status, 0, log);
    } else context.diagnostic("Recorded trace assertion only; no fresh runtime execution");
    const rows = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
    const record = (kind: string, name?: string) => {
      const found = rows.find(row => row.kind === kind && (name === undefined || row.data.run === name));
      assert.ok(found, `${log}: missing ${kind} ${name ?? ""}`);
      return found.data;
    };
    assert.equal(record("admission").triggerCount, 9);
    assert.ok(record("harness").args.includes("--audit-fire-movement"));
    assert.ok(record("harness").args.includes("--render-every=1"));
    for (const name of [run, `${run}-replay`]) {
      const result = record("result", name);
      const audit = record("fire-movement-complete", name);
      const render = record("render-complete", name);
      assert.equal(result.success, true);
      assert.equal(result.diagnostic, null);
      assert.ok(result.tick > 1000 && result.tick <= 8000);
      assert.deepEqual(result.outcome, { resultCode: intent === "win" ? 0 : 1,
        reasonCode: intent === "win" ? 1 : faction === "human" ? 3 : 2, ready: true });
      assert.equal(audit.frames, result.tick);
      assert.equal(audit.shots, result.shots);
      assert.equal(audit.deaths, result.deaths);
      assert.equal(audit.movementViolations, 0);
      assert.ok(audit.shots > 0 && audit.deaths > 0 && audit.movedUnits > 0 && audit.activityTransitions > 0);
      assert.equal(render.renderedFrames, result.tick);
      assert.ok(render.spriteDraws > 0);
      assert.ok(!render.warnings.some((warning: string) => /missing-state|unsupported-timeline|missing-atlas-frame/.test(warning)));
      record("render-initialized", name);
      assert.equal(record("checkpoint-restored", name).tick, 1000);
      if (faction === "alien") for (const archive of ["SAWS", "SAUC", "GRAY", "SALA", "TRSC"]) {
        assert.ok(render.fetched.includes(`/assets/generated/animations/${archive}.json`), archive);
      }
      const statistics = record("final-state", name).statistics;
      const commander = faction === "human" ? 69 : 73;
      assert.equal(statistics[`0,0,${commander}`] ?? 0, intent === "loss" ? 1 : 0);
      if (intent === "win") assert.equal(statistics[faction === "human" ? "4,3" : "1,0,82"], faction === "human" ? 3 : 11);
      const shotRows = rows.filter(row => row.kind === "fire-movement" && row.data.run === name);
      assert.equal(shotRows.reduce((count, row) => count + row.data.shots.length, 0), result.shots);
      assert.ok(rows.some(row => row.kind === "combat" && row.data.run === name && row.data.tick > 1000));
      context.diagnostic(`${name}: ticks=${result.tick} shots=${audit.shots} deaths=${audit.deaths} movementViolations=${audit.movementViolations} finalHash=${result.finalHash}`);
    }
    const original = record("result", run), replay = record("result", `${run}-replay`);
    for (const field of ["tick", "finalHash", "commandHash", "combatHash"]) assert.equal(replay[field], original[field]);
    assert.equal(record("fire-movement-complete", `${run}-replay`).hash, record("fire-movement-complete", run).hash);
    assert.equal(record("repeat-verified").run, run);
    assert.equal(record("suite-complete").results.length, 1);
  });
}
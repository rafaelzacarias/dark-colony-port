import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("ALIEN02 final assault: legitimate checkpoint has six safe terrain routes without mutation", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const checkpoint = "/tmp/dc-m02-alien-win-SptQgw/checkpoint.json";
  const before = readFileSync(checkpoint);
  assert.equal(createHash("sha256").update(before).digest("hex"),
    "dd2e3491de69ea997c2d9c5daf491eddedc5da0c1e6a88facb5a515f506cd137");
  const output = mkdtempSync(join(tmpdir(), "dc-al02-route-test-"));
  const run = spawnSync(process.execPath, ["--import", join(root, "node_modules/tsx/dist/loader.mjs"),
    join(root, "tools/qa/alien02-final-assault.ts"), "--check"], {
    cwd: root, env: { ...process.env, DC_FINAL_OUTPUT: output, DC_FINAL_RESUME: checkpoint },
    encoding: "utf8", timeout: 60000, killSignal: "SIGKILL",
  });
  assert.equal(run.status, 0, run.stderr || run.error?.message);
  const preflight = JSON.parse(readFileSync(join(output, "preflight.json"), "utf8"));
  assert.deepEqual(preflight.paths.map((actor: { id: number }) => actor.id).sort((left: number, right: number) => left - right),
    [51, 84, 90, 105, 107, 108]);
  for (const actor of preflight.paths) {
    let origin = actor.origin;
    assert.equal(actor.legs.length, 4);
    for (const leg of actor.legs) {
      assert.ok(leg.route.length > 0);
      assert.deepEqual(leg.route[0], origin);
      for (const point of leg.route) {
        assert.ok(Math.hypot(point.x - 65, point.y - 54) > 8);
        assert.ok(Math.hypot(point.x - 81, point.y - 38) > 12);
      }
      origin = leg.route.at(-1);
    }
  }
  assert.deepEqual(readFileSync(checkpoint), before);
});

test("ALIEN02 final assault: separate proof rejects altered source and reaps its worker", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const output = mkdtempSync(join(tmpdir(), "dc-al02-proof-guard-"));
  writeFileSync(join(output, "pending-win.json"), JSON.stringify({ sourceHash: "altered" }));
  writeFileSync(join(output, "checkpoint.json"), JSON.stringify({ sourceHash: "altered" }));
  const run = spawnSync(process.execPath, ["--import", join(root, "node_modules/tsx/dist/loader.mjs"),
    join(root, "tools/qa/alien02-final-assault.ts"), `--proof=${output}`], {
    cwd: root, env: { ...process.env, DC_FINAL_OUTPUT: output, DC_FINAL_WORKER: "" },
    encoding: "utf8", timeout: 60000, killSignal: "SIGKILL",
  });
  assert.equal(run.status, 1, run.stderr || run.error?.message);
  const receipt = JSON.parse(readFileSync(join(output, "exit.json"), "utf8"));
  assert.equal(receipt.phase, "proof");
  assert.equal(receipt.code, 1);
  assert.equal(receipt.signal, null);
  assert.throws(() => process.kill(receipt.childPid, 0), { code: "ESRCH" });
  const phases = readFileSync(join(output, "supervisor.jsonl"), "utf8").trim().split("\n")
    .map(line => JSON.parse(line));
  assert.deepEqual(phases.map(phase => [phase.phase, phase.budgetMs]), [["restore", 900000], ["proof", 900000]]);
  const events = readFileSync(join(output, "journal.jsonl"), "utf8").trim().split("\n")
    .map(line => JSON.parse(line));
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "failure");
  assert.match(events[0].data.message, /altered/);
});

test("ALIEN02 final assault: public click moves an original actor and reaps its worker", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const output = mkdtempSync(join(tmpdir(), "dc-al02-public-input-"));
  const run = spawnSync(process.execPath, ["--import", join(root, "node_modules/tsx/dist/loader.mjs"),
    join(root, "tools/qa/alien02-final-assault.ts"), "--check-input"], {
    cwd: root, env: { ...process.env, DC_FINAL_OUTPUT: output, DC_FINAL_WORKER: "" },
    encoding: "utf8", timeout: 60000, killSignal: "SIGKILL",
  });
  assert.equal(run.status, 0, run.stderr || run.error?.message);
  const receipt = JSON.parse(readFileSync(join(output, "exit.json"), "utf8"));
  assert.equal(receipt.code, 0);
  assert.equal(receipt.signal, null);
  assert.throws(() => process.kill(receipt.childPid, 0), { code: "ESRCH" });
  const input = JSON.parse(readFileSync(join(output, "input-check.json"), "utf8"));
  assert.equal(input.accepted, "move");
  assert.equal(input.tick, 41);
  assert.notDeepEqual(input.before, input.after);
});
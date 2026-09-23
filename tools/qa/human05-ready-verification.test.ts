import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const prefix = process.env.DC_H05_READY_PROOF;
const root = new URL("../../", import.meta.url);
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));

test("H05 ready inputs: original artifacts, current policy, City completion and rescue chain", { skip: !prefix }, () => {
  const preflight = read(`${prefix}-preflight.json`);
  const directory = preflight.artifactDirectory;
  const pending = read(`${directory}/pending-win.json`);
  const ready = read(`${directory}/checkpoint.json`);
  const integrity = read(`${directory}/integrity.json`);
  for (const [path, expected] of Object.entries(preflight.inputHashes)) {
    assert.equal(hash(readFileSync(path)), expected, path);
  }
  assert.equal(pending.view.simulation.tick, 26143);
  assert.equal(ready.view.simulation.tick, 26344);
  assert.equal(ready.view.simulation.tick - pending.view.simulation.tick, 201);
  assert.equal(hash(JSON.stringify(pending.view)), preflight.pendingViewHash);
  assert.equal(hash(JSON.stringify(ready.view)), preflight.readyViewHash);
  assert.equal(preflight.readyViewHash, "a2a23d3f7a4a4548de9670e23f179c439f16dc5d0f8fdfb3fd624d10e6e5446b");
  for (const saved of [pending, ready]) {
    assert.equal(saved.view.session.replayPolicy, "current-population-v1");
    assert.equal(saved.view.state.diagnostic, null);
    assert.equal(saved.view.state.outcome.resultCode, 0);
    assert.equal(saved.view.state.outcome.reasonCode, 1);
    for (const team of [1, 2]) for (let slot = 0; slot < 5; slot++) {
      assert.equal(saved.view.session.state.world.buildingSlots[`${team},${slot}`], 0);
    }
    for (const id of [18, 17, 15]) assert.ok(saved.fired.includes(id));
  }
  assert.equal(pending.view.state.outcome.ready, false);
  assert.equal(ready.view.state.outcome.ready, true);
  const events = readFileSync(`${directory}/journal.jsonl`, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual([18, 17, 15].map(id => ({ id,
    tick: events.find(event => event.kind === "source-trigger" && event.data.fired.includes(id))?.tick,
  })), [{ id: 18, tick: 25235 }, { id: 17, tick: 25835 }, { id: 15, tick: 26143 }]);
  for (const [extension, expected] of Object.entries(preflight.sourceHashes)) {
    assert.equal(hash(readFileSync(new URL(`raw_cd/DC/SCENARIO/HUMAN/HUMAN05.${extension}`, root))), expected);
  }
  for (const [path, expected] of Object.entries(integrity.after)) {
    assert.equal(hash(readFileSync(new URL(path, root))), expected, path);
  }
  for (const [path, expected] of Object.entries(integrity.fetched)) {
    assert.equal(hash(readFileSync(new URL(`public${path}`, root))), expected, path);
  }
});

test("H05 ready proof: exact complete checkpoint, independent budget and reaped processes", { skip: !prefix }, () => {
  const preflight = read(`${prefix}-preflight.json`);
  const directory = `${prefix}/human`;
  const proof = read(`${directory}/proof.json`);
  const result = read(`${directory}/result.json`);
  const integrity = read(`${directory}/integrity.json`);
  const source = read(`${directory}/source.json`);
  const receipt = read(`${directory}/exit.json`);
  const launcher = read(`${prefix}-launch-exit.json`);
  const originalIntegrity = read(`${preflight.artifactDirectory}/integrity.json`);
  assert.equal(proof.exactCheckpoint, true);
  assert.equal(proof.fromTick, 26143);
  assert.equal(proof.toTick, 26344);
  assert.equal(proof.expectedHash, preflight.readyViewHash);
  assert.equal(proof.actualHash, preflight.readyViewHash);
  assert.equal(proof.sourceHash, preflight.sourceHash);
  assert.ok(proof.restoreMs > 0 && proof.restoreMs < 900000);
  assert.equal(result.status, "WIN");
  assert.equal(result.exactCheckpoint, true);
  assert.equal(result.revision, "filesystem-stable");
  assert.deepEqual(result.outcome, { resultCode: 0, reasonCode: 1, ready: true });
  assert.deepEqual(integrity.before, originalIntegrity.after);
  assert.deepEqual(integrity.after, originalIntegrity.after);
  assert.deepEqual(integrity.changed, []);
  assert.deepEqual(integrity.changedAssets, []);
  assert.deepEqual(source.sources, preflight.sourceHashes);
  assert.equal(source.sourceHash, preflight.sourceHash);
  assert.equal(source.limits.restoreMs, 900000);
  assert.equal(existsSync(`${directory}/failure-checkpoint.json`), false);
  const phases = readFileSync(`${directory}/supervisor.jsonl`, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(phases.map(phase => phase.phase), ["initialize", "proof"]);
  assert.equal(phases[1].budgetMs, 900000);
  assert.equal(receipt.phase, "proof");
  assert.equal(receipt.reaped, true);
  assert.equal(receipt.expired, false);
  assert.equal(receipt.code, 0);
  assert.equal(receipt.signal, null);
  assert.equal(launcher.code, 0);
  assert.equal(launcher.signal, null);
  for (const pid of new Set([receipt.childPid, receipt.parentPid, launcher.launcherPid, launcher.supervisorPid])) {
    assert.ok(Number.isSafeInteger(pid) && pid > 0);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  }
});
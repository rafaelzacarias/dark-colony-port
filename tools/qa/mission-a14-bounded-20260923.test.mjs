import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const output = process.env.DC_A14_BOUNDED_ARTIFACTS ?? "/tmp/dc-a14-bounded-20260923-atrb8T";
const read = path => JSON.parse(readFileSync(`${output}/${path}`, "utf8"));
const hash = value => createHash("sha256").update(value).digest("hex");

test("A14 bounded: original trip WIN and same-process exact pending-to-ready restore", () => {
  const summary = read("summary.json"), source = read("A14/source.json");
  const pending = read("A14/pending-win.json"), ready = read("A14/checkpoint.json");
  const restored = read("A14/restored-ready.json"), proof = read("A14/proof.json");
  assert.equal(summary.accepted, true);
  assert.equal(summary.status, "EXACT_READY_WIN");
  assert.equal(summary.result.startTick, 0);
  assert.equal(summary.result.diagnostic, undefined);
  assert.equal(source.id, "A14");
  assert.equal(source.win.id, 3);
  assert.equal(source.win.mode, "trip");
  assert.equal(source.win.condition, "(S==0)");
  assert.ok(source.win.actions.some(action => action.name === "bail" && action.arguments[0] === 0 && action.arguments[1] === 1));
  assert.ok(read("A14/campaign-journal.json").some(entry => entry.fired.includes(3)));
  assert.deepEqual(pending.view.state.outcome, { resultCode: 0, reasonCode: 1, ready: false });
  assert.deepEqual(ready.view.state.outcome, { resultCode: 0, reasonCode: 1, ready: true });
  assert.equal(ready.view.simulation.tick - pending.view.simulation.tick, 201);
  assert.equal(proof.updates, 201);
  assert.equal(proof.sameProcess, true);
  assert.equal(proof.pid, summary.receipt.pid);
  assert.equal(proof.exact, true);
  assert.deepEqual(restored, ready);
  assert.equal(hash(JSON.stringify(ready.view)), proof.expectedHash);
  assert.equal(proof.actualHash, proof.expectedHash);
  assert.equal(pending.sourceHash, source.sourceHash);
  assert.equal(ready.sourceHash, source.sourceHash);
  const journal = readFileSync(`${output}/A14/journal.jsonl`, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const commands = journal.filter(entry => entry.kind === "command");
  assert.equal(commands.length, summary.result.commands);
  assert.ok(commands.some(entry => entry.data.purpose === "source-chamber-trip3"));
  assert.ok(commands.every(entry => ["move", "assault"].includes(entry.data.mode)));
});

test("A14 bounded: preserved loaded revision, authentic assets, deadlines and no owned process", () => {
  const summary = read("summary.json"), launch = read("launch.json");
  const modules = read("loaded-modules.json"), integrity = read("A14/integrity.json");
  assert.ok(modules["src/mission-view.ts"]);
  assert.ok(modules["src/game-data.ts"]);
  assert.ok(modules["tools/qa/campaign-13-15.ts"]);
  for (const [path, entry] of Object.entries(modules)) {
    assert.equal(hash(readFileSync(`${output}/loaded-source/${path}`)), entry.rawHash, path);
    assert.equal(entry.rawHash, entry.afterLoadHash, path);
    assert.match(entry.evaluatedHash, /^[a-f0-9]{64}$/);
  }
  assert.equal(modules["tools/qa/campaign-13-15.ts"].rawHash, launch.driverHash);
  assert.equal(hash(JSON.stringify(Object.entries(modules).sort(([left], [right]) => left.localeCompare(right)))), summary.loadedRuntimeRevision);
  assert.equal(summary.currentRuntimeClaim, false);
  assert.ok(Array.isArray(summary.drift));
  for (const path of Object.keys(summary.proof.proofAssets)) assert.equal(summary.proof.proofAssets[path], integrity.fetched[path], path);
  assert.deepEqual(integrity.changedAssets, []);
  assert.deepEqual(integrity.changedSources, []);
  assert.deepEqual(summary.changedSources, []);
  assert.deepEqual(summary.changedAssets, []);
  assert.ok(launch.playCapMs <= 180000);
  assert.ok(launch.totalCapMs <= 300000);
  assert.ok(summary.playElapsedMs <= launch.playCapMs);
  assert.ok(summary.elapsedMs <= launch.totalCapMs);
  assert.equal(summary.receipt.code, 0);
  assert.equal(summary.receipt.signal, null);
  assert.equal(summary.receipt.reaped, true);
  assert.deepEqual(summary.ownedWorkersAlive, []);
  for (const pid of [summary.receipt.pid, summary.supervisorPid]) assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});
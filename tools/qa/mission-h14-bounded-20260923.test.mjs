import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const output = process.env.DC_H14_BOUNDED_ARTIFACTS ?? "/tmp/dc-h14-bounded-20260923-BzJVuy";
const read = path => JSON.parse(readFileSync(path, "utf8"));
const hash = value => createHash("sha256").update(value).digest("hex");

test("H14 bounded: actual original WIN, independent whole-checkpoint proof and hard bounds", () => {
  const summary = read(`${output}/summary.json`);
  const directory = `${output}/H14`;
  const source = read(`${directory}/source.json`);
  const pending = read(`${directory}/pending-win.json`);
  const ready = read(`${directory}/checkpoint.json`);
  const restored = read(`${directory}/restored-ready.json`);
  const playIntegrity = read(`${directory}/integrity.json`);
  const proofIntegrity = read(`${directory}/proof-integrity.json`);
  assert.equal(summary.accepted, true);
  assert.equal(summary.status, "EXACT_READY_WIN");
  assert.deepEqual(summary.outcome, { resultCode: 0, reasonCode: 1, ready: true });
  assert.equal(source.id, "H14");
  assert.equal(source.win.id, 3);
  assert.equal(source.win.mode, "trip");
  assert.equal(source.win.condition, "(S==0)");
  assert.ok(source.win.actions.some(action => action.name === "bail" && action.arguments[0] === 0 && action.arguments[1] === 1));
  assert.ok(read(`${directory}/campaign-journal.json`).some(entry => entry.fired.includes(3)));
  assert.equal(pending.view.state.outcome.ready, false);
  assert.equal(pending.view.state.outcome.resultCode, 0);
  assert.equal(ready.view.simulation.tick - pending.view.simulation.tick, 201);
  assert.deepEqual(restored, ready);
  assert.equal(hash(JSON.stringify(ready.view)), summary.proof.expectedHash);
  assert.equal(summary.proof.actualHash, summary.proof.expectedHash);
  assert.deepEqual(playIntegrity.after, proofIntegrity.before);
  for (const integrity of [playIntegrity, proofIntegrity]) {
    assert.deepEqual(integrity.before, integrity.after);
    for (const key of ["changed", "changedAssets", "changedSources"]) assert.deepEqual(integrity[key], []);
  }
  assert.equal(summary.driverBefore, summary.driverAfter);
  assert.equal(summary.receipts.length, 2);
  assert.deepEqual(summary.receipts.map(receipt => receipt.proof), [false, true]);
  assert.ok(summary.receipts[0].allowance <= 180000);
  assert.ok(summary.receipts[1].allowance < 900000);
  assert.ok(summary.elapsedMs < 540000);
  for (const receipt of summary.receipts) {
    assert.equal(receipt.code, 0);
    assert.equal(receipt.signal, null);
    assert.equal(receipt.reaped, true);
    assert.throws(() => process.kill(receipt.pid, 0), { code: "ESRCH" });
  }
  assert.deepEqual(summary.ownedWorkersAlive, []);
});

test("H14 ledger: eight retained historical WIN hashes, not eight current-runtime replays", () => {
  const historical = [
    ["H01", "/tmp/dc-stationary-human-win-OewBBU/trace.jsonl", "cebcc273f217a19ac5ad88ea3b21e40d825b3fc5eb96e04381e4504f52cc3212"],
    ["A01", "/tmp/dc-stationary-alien-win-5BdXa6/trace.jsonl", "0104fd9e28e621f1eba0dd73831a286e66b8d1b32fb6fafff70b42f758c242ea"],
    ["H02", "/tmp/dc-human02-final-assault-xg3kSr/checkpoint.json", "d11d9953ed5f00b7ea8ce1e8285389c8bda9446fadfdf17efe7fb0126f041c34"],
    ["A02", "/tmp/dc-al02-finish-20260922-r05/checkpoint.json", "dd06165505d48ebabb8527b58bed88c4a7ff6ab794ee704bcb696d0e5b24a01d"],
    ["H03", "/tmp/dc-m03-human-b1/human/checkpoint.json", "ca43a92265d677cfa0f98c5af27538ea5992e746fe3e6230953eb4dc98fd373e"],
    ["A03", "/tmp/dc-artifact-al03-win-1790144281382/checkpoint.json", "b92a9ce36bbc1c1da36e9090407c1216f69d2a1884d5dc1d748becbc5ee44574"],
    ["H05", "/tmp/dc-h05-continuation-20260923-c01/human/checkpoint.json", "a2a23d3f7a4a4548de9670e23f179c439f16dc5d0f8fdfb3fd624d10e6e5446b"],
    ["H06", "/tmp/dc-current-human06-20260923-1790171065933/human/checkpoint.json", "d22dff4fb719fdd408372894ea917e945e1ab5cde04a310103929de6a494c148"],
  ];
  for (const [mission, path, expected] of historical) {
    const bytes = readFileSync(path);
    const value = path.endsWith(".jsonl") ? bytes : JSON.stringify(JSON.parse(bytes.toString()).view);
    assert.equal(hash(value), expected, mission);
    if (path.endsWith(".json")) {
      const outcome = JSON.parse(bytes.toString()).view.state.outcome;
      assert.equal(outcome.ready, true, mission);
      assert.equal(outcome.resultCode, 0, mission);
      assert.equal(outcome.reasonCode, 1, mission);
    }
  }
});
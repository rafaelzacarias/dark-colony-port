import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, watch } from "node:fs";
import { createHash } from "node:crypto";
import { assertMission05HealthyResume, authenticateMission05Resume } from "./mission05-playthrough";

const directory = process.env.DC_H05_CURRENT_ARTIFACTS;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

const resumePath = process.env.DC_H05_CURRENT_RESUME;
test("mission05 human current guards: unchanged saved identity and diagnostic rejection", { skip: !resumePath }, () => {
  const bytes = readFileSync(resumePath!);
  const saved = JSON.parse(bytes.toString());
  const mission = JSON.parse(saved.view.sourceIdentity);
  assert.equal(mission.faction, "human");
  assert.equal(saved.view.session.replayPolicy, "current-population-v1");
  assertMission05HealthyResume(saved);
  authenticateMission05Resume(mission, saved);
  const diagnostic = structuredClone(saved);
  diagnostic.view.state.diagnostic = "guard-test-only";
  assert.throws(() => assertMission05HealthyResume(diagnostic), /Diagnostic-bearing/);
  const tampered = structuredClone(saved);
  const identity = JSON.parse(tampered.view.sourceIdentity);
  identity.triggers[0].condition = "1";
  tampered.view.sourceIdentity = JSON.stringify(identity);
  assert.throws(() => authenticateMission05Resume(mission, tampered), /Saved loaded mission/);
  assert.equal(hash(readFileSync(resumePath!)), hash(bytes));
});

test("mission05 human current artifacts: source progress, exact continuation, markers and worker reaping", {
  skip: !directory,
  timeout: 1000000,
}, async context => {
  const read = (name: string) => JSON.parse(readFileSync(`${directory}/${name}.json`, "utf8"));
  if (!existsSync(`${directory}/exit.json`)) {
    await new Promise<void>((resolve, reject) => {
      const watcher = watch(directory!, () => {
        if (existsSync(`${directory}/exit.json`)) { watcher.close(); resolve(); }
      });
      context.after(() => watcher.close());
      watcher.once("error", reject);
      if (existsSync(`${directory}/exit.json`)) { watcher.close(); resolve(); }
    });
  }
  const result = read("result"), saved = read("checkpoint"), integrity = read("integrity"), receipt = read("exit");
  const source = read("source");
  for (const [extension, expected] of Object.entries(source.sources)) {
    assert.equal(hash(readFileSync(new URL(`../../raw_cd/DC/SCENARIO/HUMAN/HUMAN05.${extension}`, import.meta.url))), expected);
  }
  const initial = JSON.parse(readFileSync(integrity.resume, "utf8"));
  const world = saved.view.session.state.world;
  assert.equal(saved.view.session.replayPolicy, "current-population-v1");
  assert.equal(initial.view.session.replayPolicy, "current-population-v1");
  assert.equal(saved.view.state.diagnostic, null);
  assert.ok(result.tick > initial.view.simulation.tick);
  assert.equal(result.tick, saved.view.simulation.tick);
  assert.equal(result.checkpointHash, hash(JSON.stringify(saved.view)));
  assert.deepEqual(result.buildingSlots, world.buildingSlots);
  assert.deepEqual(result.fired, saved.fired);
  assert.ok(saved.fired.includes(1), "Actual betrayal must follow team-2 city destruction");
  for (let slot = 0; slot < 5; slot++) assert.equal(world.buildingSlots[`2,${slot}`], 0);
  if (result.outcome?.resultCode !== 1) assert.ok(world.buildingSlots["0,0"] > 0, "Player base must remain alive for continuation");
  assert.ok(result.owned.some((actor: { type: number; hp: number }) => actor.type === 0 && actor.hp > 0));
  for (const name of ["initial-restore", "initialized-restore"]) {
    const proof = read(name);
    assert.equal(proof.exact, true);
    assert.deepEqual(proof.differences, []);
    assert.equal(proof.actualHash, proof.expectedHash);
  }
  if (result.status === "WIN") {
    const proof = read("proof");
    const pending = read("pending-win");
    for (const team of [1, 2]) for (let slot = 0; slot < 5; slot++) assert.equal(world.buildingSlots[`${team},${slot}`], 0);
    for (const trigger of [1, 15]) assert.ok(saved.fired.includes(trigger));
    if (initial.view.session.state.world.statistics["0,0,69"] > 0) {
      for (const trigger of [18, 17]) assert.ok(saved.fired.includes(trigger));
    }
    assert.equal(pending.view.session.replayPolicy, "current-population-v1");
    assert.equal(pending.view.state.outcome.ready, false);
    assert.equal(pending.view.state.outcome.resultCode, 0);
    assert.equal(proof.fromTick, pending.view.simulation.tick);
    assert.equal(proof.toTick, result.tick);
    assert.equal(proof.expectedHash, result.checkpointHash);
    assert.equal(proof.exactCheckpoint, true);
    assert.equal(result.outcome.ready, true);
    assert.equal(result.outcome.resultCode, 0);
    assert.equal(proof.actualHash, result.checkpointHash);
  } else if (["SOURCE_WIN_PROOF_PENDING", "SOURCE_WIN_PENDING"].includes(result.status)) {
    const pending = read("pending-win"), deferred = read("proof-deferred");
    assert.equal(pending.view.state.outcome.resultCode, 0);
    assert.equal(pending.view.state.outcome.ready, false);
    assert.equal(result.outcome.resultCode, 0);
    assert.equal(result.outcome.ready, result.status === "SOURCE_WIN_PROOF_PENDING");
    assert.equal(deferred.pendingTick, pending.view.simulation.tick);
    assert.equal(deferred.proofLimitMs, 900000);
    assert.equal(result.exactCheckpoint, false);
    assert.equal(existsSync(`${directory}/proof.json`), false);
    for (const trigger of [1, 18, 17, 15]) assert.ok(saved.fired.includes(trigger));
    for (const team of [1, 2]) for (let slot = 0; slot < 5; slot++) assert.equal(world.buildingSlots[`${team},${slot}`], 0);
  } else {
    if (result.outcome?.resultCode === 1) {
      assert.equal(result.status, "SOURCE_LOSS");
      assert.equal(result.outcome.ready, true);
      assert.equal(result.outcome.reasonCode, 2);
      assert.ok(saved.fired.includes(2));
      for (let slot = 0; slot < 5; slot++) assert.equal(world.buildingSlots[`0,${slot}`], 0);
    } else assert.equal(result.outcome, null);
    if (existsSync(`${directory}/nonwin-final-save.json`)) {
      const finalSave = read("nonwin-final-save");
      assert.equal(finalSave.initialAuthenticated, true);
      assert.equal(finalSave.finalReplayVerified, false);
      assert.equal(finalSave.checkpointHash, result.checkpointHash);
      assert.deepEqual(finalSave.outcome, result.outcome);
      assert.equal(result.currentRoundtripExact, false);
      assert.equal(existsSync(`${directory}/current-roundtrip.json`), false);
    } else {
      assert.equal(result.currentRoundtripExact, true);
      const proof = read("current-roundtrip");
      assert.equal(proof.exact, true);
      assert.equal(proof.initialized, true);
      assert.equal(proof.actualHash, result.checkpointHash);
      assert.equal(proof.expectedHash, result.checkpointHash);
    }
    assert.equal(existsSync(`${directory}/pending-win.json`), false);
    assert.equal(existsSync(`${directory}/proof.json`), false);
  }
  assert.equal(integrity.resumeHash, hash(readFileSync(integrity.resume)));
  const budget = read("budget");
  assert.equal(budget.savedStepMs, initial.steppingMs);
  assert.ok(result.steppingMs - initial.steppingMs - budget.priorStepMs <= budget.stageLimitMs);
  assert.equal(integrity.resumeUnchanged, true);
  assert.deepEqual(integrity.changed, []);
  assert.deepEqual(integrity.changedAssets, []);
  const events = readFileSync(`${directory}/journal.jsonl`, "utf8").trim().split("\n").map(line => JSON.parse(line));
  for (const event of events.filter(event => event.kind === "command" && event.data.purpose === "visible-threat")) {
    assert.equal(event.data.visible, true);
  }
  if (saved.humanPartition) {
    assert.ok(budget.stageLimitMs <= (budget.continuingHuman ? 600000 : 500000));
    if (budget.continuingHuman) {
      assert.equal(budget.totalLimitMs, 1080000);
      assert.equal(saved.humanAssault.stage, "assault");
      assert.equal(events.some(event => event.kind === "human-assault-stage" && event.data.humanStage === "assemble"), false);
    }
    let partition: { base: number[]; collectors: number[]; raid: number[] } | undefined;
    for (const event of events) {
      if (event.kind === "human-partition") {
        const next = event.data as NonNullable<typeof partition>;
        assert.equal(new Set([...next.base, ...next.collectors, ...next.raid]).size,
          next.base.length + next.collectors.length + next.raid.length);
        if (partition && !budget.continuingHuman) {
          for (const role of ["base", "collectors", "raid"] as const) {
            for (const id of partition[role]) {
              if ([...next.base, ...next.collectors, ...next.raid].includes(id)) assert.ok(next[role].includes(id));
            }
          }
        }
        partition = next;
      }
      if (partition && event.kind === "command" && [...partition.base, ...partition.collectors].includes(event.data.actorId)) {
        assert.match(event.data.purpose, /^(base|collector)-guard/);
      }
    }
    assert.ok(partition || initial.humanPartition);
    assert.ok(events.some(event => event.kind === "hold" && event.data.publicCommand === "stop"));
    const initialEarned = events.find(event => event.kind === "progress").data.earned;
    assert.ok(result.spent - initial.spent <= (budget.initialCredits ?? 0) + result.earned - initialEarned);
    if (result.status === "WIN") {
      const triggerTicks = [18, 17, 15].map(id => events.find(event => event.kind === "source-trigger" && event.data.fired.includes(id))?.tick);
      assert.ok(triggerTicks.every(tick => tick !== undefined));
      assert.ok(triggerTicks[0] <= triggerTicks[1] && triggerTicks[1] <= triggerTicks[2]);
    }
  }
  assert.equal(receipt.reaped, true);
  assert.equal(receipt.expired, false);
  assert.equal(receipt.signal, null);
  assert.ok(receipt.totalMs < receipt.totalLimitMs);
  assert.throws(() => process.kill(receipt.childPid, 0), { code: "ESRCH" });
  console.log(JSON.stringify({ directory, tick: result.tick, status: result.status,
    stoppingReason: result.stoppingReason, checkpointHash: result.checkpointHash, fired: saved.fired,
    owned: result.owned.length, credits: result.credits, steppingMs: result.steppingMs, totalMs: receipt.totalMs }));
});
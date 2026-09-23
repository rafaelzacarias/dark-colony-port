import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { evaluateTriggerCondition } from "../../src/engine/trigger-runtime";
import { parseScenario } from "../extractors/data/scenario";
import { budget, cases, classify, contractFor, hash } from "./campaign-13-15";

for (const id of cases) test(`${id}: complete original source goal contract`, () => {
  const contract = contractFor(id);
  assert.equal(contract.scenario.id.toUpperCase(), `${contract.faction.toUpperCase()}${contract.number}`);
  assert.equal(contract.scenario.teams.length, 8);
  assert.ok(contract.scenario.placementRows.length);
  assert.ok(contract.text.trim());
  assert.equal(Object.keys(contract.sources).length, 6);
  assert.deepEqual(contract.win.actions.find(action => action.name === "bail")?.arguments, [0, 1]);
  assert.equal(contract.losses.length, 1);
  const stem = `${contract.faction.toUpperCase()}/${contract.faction.toUpperCase()}${contract.number}`;
  const raw = readFileSync(new URL(`../../raw_cd/DC/SCENARIO/${stem}.SCN`, import.meta.url), "latin1");
  assert.deepEqual(parseScenario(raw.replace(/\r\n/g, "\n")), contract.scenario);
  const generated = JSON.parse(readFileSync(new URL(`../../public/assets/generated/data/scenarios/${stem}.json`, import.meta.url), "utf8"));
  const decoded = Buffer.from(generated.rawScenario, "base64");
  assert.equal(hash(decoded), contract.sources.SCN);
  assert.equal(generated.source.sha256, contract.sources.SCN);
  assert.deepEqual(parseScenario(decoded.toString("latin1")), contract.scenario);
  assert.equal(contract.slots.length, id === "A13" ? 10 : contract.number === 14 ? 0 : 15);
  if (contract.number === 14) {
    assert.equal(contract.win.id, 3);
    assert.equal(contract.win.condition, "(S==0)");
    assert.equal(contract.tripParameters.chamberTypeRestriction, null);
    assert.ok(contract.trips[3].length > 0);
    assert.deepEqual(contract.win.actions.find(action => action.name === "reinforce2")?.arguments,
      [1, 54, 50, 10, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
  }
});

test("trip variables use entering team and source type, not elapsed time", () => {
  const inputs = { cycleCounter: 16000, clockMilliseconds: 500000, buildingSlots: {},
    runtimeProfile: "browser-adapted" as const, triggeringUnitType: 73 };
  assert.deepEqual(evaluateTriggerCondition("((S==0)&&(t==73))", {}, inputs, 0), { ok: true, value: 1 });
  assert.deepEqual(evaluateTriggerCondition("(S==0)", {}, inputs, 1), { ok: true, value: 0 });
  assert.deepEqual(evaluateTriggerCondition("(t==1000)", {}, inputs, 0), { ok: true, value: 0 });
});

test("group budget and acceptance never promote a census or pending bail to completion", () => {
  assert.deepEqual(budget, { playMs: 600000, restoreMs: 480000 });
  assert.equal(classify(null, undefined), "PLAY_LIMIT");
  assert.equal(classify({ resultCode: 0, reasonCode: 1, ready: false }, undefined, true), "PLAY_LIMIT");
  assert.equal(classify({ resultCode: 0, reasonCode: 1, ready: true }, undefined), "READY_WIN_UNVERIFIED");
  assert.equal(classify({ resultCode: 0, reasonCode: 1, ready: true }, undefined, true), "EXACT_READY_WIN");
  assert.equal(classify({ resultCode: 1, reasonCode: 2, ready: true }, undefined, true), "SOURCE_LOSS");
  assert.equal(classify(null, "unsupported source action"), "RUNTIME_BLOCKER");
});

test("saved group: original sources, honest statuses, exact proof and reaped workers", {
  skip: !process.env.DC_CAMPAIGN_13_15_ARTIFACTS,
}, () => {
  const directory = process.env.DC_CAMPAIGN_13_15_ARTIFACTS!;
  const read = (path: string) => JSON.parse(readFileSync(`${directory}/${path}.json`, "utf8"));
  const summary = read("summary");
  assert.ok(summary.playUsed <= budget.playMs);
  assert.ok(summary.restoreUsed <= budget.restoreMs);
  assert.deepEqual(summary.changedRuntime, []);
  assert.equal(summary.missions.length, 6);
  for (const id of cases) {
    const contract = contractFor(id), source = read(`${id}/source`), result = read(`${id}/result`);
    const exit = read(`${id}/exit`), integrity = read(`${id}/integrity`);
    assert.deepEqual(source.sources, contract.sources);
    assert.equal(source.sourceHash, contract.sourceHash);
    assert.equal(exit.reaped, true);
    assert.equal(exit.code, 0);
    assert.equal(exit.signal, null);
    assert.deepEqual(integrity.changed, []);
    assert.deepEqual(integrity.changedSources, []);
    assert.deepEqual(integrity.changedAssets, []);
    if (result.status === "RUNTIME_BLOCKER") {
      assert.ok(result.diagnostic && result.blockedPath);
    } else {
      const saved = read(`${id}/checkpoint`);
      assert.equal(saved.sourceHash, contract.sourceHash);
      assert.equal(saved.view.simulation.tick, result.tick);
      assert.equal(classify(result.outcome, result.diagnostic), result.status);
    }
    if (existsSync(`${directory}/${id}/proof-result.json`) && read(`${id}/proof-result`).status === "EXACT_READY_WIN") {
      const pending = read(`${id}/pending-win`), ready = read(`${id}/checkpoint`), proof = read(`${id}/proof`);
      assert.equal(pending.view.state.outcome.resultCode, 0);
      assert.equal(pending.view.state.outcome.ready, false);
      assert.equal(ready.view.state.outcome.resultCode, 0);
      assert.equal(ready.view.state.outcome.ready, true);
      assert.equal(proof.exact, true);
      assert.equal(proof.expectedHash, hash(JSON.stringify(ready.view)));
      assert.equal(proof.actualHash, proof.expectedHash);
      assert.deepEqual(read(`${id}/restored-ready`), ready);
      assert.equal(read(`${id}/proof-exit`).code, 0);
      assert.deepEqual(read(`${id}/proof-integrity`).changed, []);
    }
  }
});
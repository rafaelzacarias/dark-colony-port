import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { missions, sourceContract, cityTeams, permit, classify, budgets, hash } from "./campaign-10-12";

for (const id of missions) test(`${id}: original win and public command permissions`, () => {
  const contract = sourceContract(id);
  assert.ok(contract.scn.length && contract.briefing.length);
  assert.ok(contract.wins.length);
  for (const win of contract.wins) {
    assert.ok(win.actions.some(action => action.name === "bail" && action.arguments[0] === 0));
    if (id !== "H11") assert.equal(win.condition, `(${cityTeams[id].flatMap(team =>
      Array.from({ length: 5 }, (_, slot) => `(b(${team},${slot})==0)`)).join("&&")})`);
  }
  if (id === "H11") {
    assert.equal(contract.wins[0].condition, "(s(1,3)==7)");
    assert.equal(contract.wins[1].condition, "(S==0)");
    assert.equal(contract.wins[1].mode, "trip");
    assert.ok(contract.trips[9].length && contract.trips[13].length);
  }
  assert.equal(permit({ owned: true, mode: "move", visible: false, sourceKnown: true }), true);
  assert.equal(permit({ owned: true, mode: "assault", visible: false, sourceKnown: true }), false);
  assert.equal(permit({ owned: false, mode: "move", visible: true, sourceKnown: true }), false);
  assert.equal(permit({ owned: true, mode: "move", visible: false, sourceKnown: false }), false);
  assert.equal(permit({ owned: true, mode: "assault", visible: true, sourceKnown: false }), true);
});

test("pending or unproved ready results never count as a win", () => {
  assert.equal(classify(null), "BOUNDED_NO_WIN");
  assert.equal(classify({ resultCode: 0, reasonCode: 1, ready: false }, undefined, true), "BOUNDED_NO_WIN");
  assert.equal(classify({ resultCode: 0, reasonCode: 1, ready: true }), "READY_WIN_UNVERIFIED");
  assert.equal(classify({ resultCode: 0, reasonCode: 1, ready: true }, undefined, true), "WIN");
});

test("group budgets cannot exceed ten minutes play or eight minutes restore", () => {
  assert.deepEqual(budgets(), { playMs: 600000, restoreMs: 480000 });
  assert.throws(() => budgets(600001));
  assert.throws(() => budgets(600000, 480001));
  assert.throws(() => budgets(0));
});

test("current original loader: all thirty missions load without source substitution", async context => {
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    return new Response(readFileSync(new URL(`../../public${path}`, import.meta.url)));
  });
  for (const faction of ["human", "alien"] as const) for (let number = 1; number <= 15; number++) {
    const mission = await loadCampaignMission(faction, number, "browser-adapted");
    const name = `${faction.toUpperCase()}${String(number).padStart(2, "0")}`;
    const source = readFileSync(new URL(`../../raw_cd/DC/SCENARIO/${faction.toUpperCase()}/${name}.SCN`, import.meta.url));
    assert.equal(mission.scenario.source.sha256, hash(source), name);
    assert.equal(mission.runtimeProfile, "browser-adapted");
    assert.ok(mission.triggers.length, name);
    context.diagnostic(`${name}: original loader passed`);
  }
});

for (const id of missions) test(`${id}: actual bounded replay artifact permissions and proof`, {
  skip: !process.env.DC_1012_ARTIFACTS,
}, () => {
  const directory = `${process.env.DC_1012_ARTIFACTS}/${id}`;
  const json = (name: string) => JSON.parse(readFileSync(`${directory}/${name}.json`, "utf8"));
  const result = json("result"), integrity = json("integrity"), exit = json("exit");
  assert.equal(exit.code, 0); assert.equal(exit.signal, null);
  assert.deepEqual(integrity.changed, []); assert.deepEqual(integrity.changedAssets, []);
  if (result.status === "RUNTIME_BLOCKER" && result.tick === 0) {
    assert.ok(result.diagnostic);
    assert.equal(existsSync(`${directory}/pending-win.json`), false);
    return;
  }
  const initial = json("initial");
  assert.ok(result.tick > 0 && result.elapsedMs <= exit.budgetMs);
  const checkpoint = json("checkpoint");
  assert.equal(checkpoint.sourceHash, result.sourceHash);
  assert.equal(checkpoint.view.simulation.tick, result.tick);
  const journal = readFileSync(`${directory}/journal.jsonl`, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const attacks = journal.filter(entry => entry.kind === "command" && entry.data.mode === "assault");
  assert.ok(attacks.every(entry => entry.data.visible === true && entry.data.cursor === "attack"));
  const initialOwned = new Set(initial.units.units.filter((actor: { team: number }) => actor.team === 0).map((actor: { id: number }) => actor.id));
  for (const command of journal.filter(entry => entry.kind === "command" && entry.tick === 0)) assert.ok(initialOwned.has(command.data.id));
  if (id === "A10") {
    const attempt = journal.find(entry => entry.kind === "purchaseConstruction");
    assert.equal(attempt.data.dependency, 14); assert.equal(attempt.data.accepted, false);
    assert.equal(result.credits, 1500);
    const central = attempt.data.menu.find((choice: { dependency: number }) => choice.dependency === 14);
    assert.equal(central.cost, 2000); assert.equal(central.credits, 1500);
  }
  if (existsSync(`${directory}/proof.json`)) {
    const proof = json("proof"), proofExit = json("proof-exit"), pending = json("pending-win");
    assert.equal(proofExit.code, 0); assert.equal(proofExit.signal, null);
    assert.equal(proof.status, "WIN"); assert.equal(proof.exactCheckpoint, true);
    assert.equal(pending.view.state.outcome.ready, false); assert.equal(pending.view.state.outcome.resultCode, 0);
    assert.equal(checkpoint.view.state.outcome.ready, true); assert.equal(checkpoint.view.state.outcome.resultCode, 0);
    assert.equal(proof.expectedHash, hash(JSON.stringify(checkpoint.view))); assert.equal(proof.actualHash, proof.expectedHash);
    assert.deepEqual(json("proof-integrity").changed, []);
  } else assert.notEqual(result.status, "WIN");
});
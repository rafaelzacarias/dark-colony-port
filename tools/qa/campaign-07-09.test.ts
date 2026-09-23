import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { classify, goalTeams, hash, missionIds, routeStage, sourceContract, tripApproach } from "./campaign-07-09";

test("07-09 contracts preserve original city teams and unusual H09 predicate", () => {
  const expected = { H07: [2, 3], H08: [2, 3], H09: [1, 2], A07: [2, 7, 1], A08: [7], A09: [] };
  for (const id of missionIds) {
    const contract = sourceContract(id);
    assert.deepEqual(contract.cityTeams, expected[id]);
    assert.ok(contract.wins.length && contract.losses.length);
  }
  const human = sourceContract("H09");
  assert.ok(human.wins[0].condition.includes("(b(1,3)&&==0)"));
  assert.deepEqual(human.statistics, [{ team: 4, selector: 3, value: 12 }]);
  assert.ok(sourceContract("H07").losses.some(block => block.condition.includes("b(7,0)")));
  assert.ok(sourceContract("H08").losses.some(block => block.condition === "(s(7,3)>11)"));
});

test("07-09 strategy waits for original A09 enable gate before extraction trip", () => {
  assert.equal(routeStage("A09", new Set()), 2);
  assert.equal(routeStage("A09", new Set([2])), null);
  assert.equal(routeStage("A09", new Set([2, 5])), 3);
  assert.equal(routeStage("A09", new Set([2, 5, 3])), null);
  const contract = sourceContract("A09");
  for (const trip of [2, 3]) assert.ok(contract.trips[trip].length > 0);
  assert.equal(contract.triggers.find(block => block.id === 5)!.condition, "(c>s(0,2,0))");
  assert.equal(contract.wins[0].id, 6);
});

test("07-09 escort strategy never substitutes player orders for NPC gates", () => {
  assert.equal(routeStage("A08", new Set([1])), 5);
  assert.equal(routeStage("A08", new Set([1, 5])), null);
  assert.equal(routeStage("A08", new Set([1, 5, 20])), 6);
  assert.equal(routeStage("A08", new Set([1, 5, 20, 6])), null);
  assert.equal(routeStage("A08", new Set([1, 5, 20, 6, 13])), 12);
  const contract = sourceContract("A08");
  assert.equal(contract.triggers.find(block => block.id === 13)!.condition, "(S==6)");
  assert.ok(contract.gates.some(block => block.actions.some(action => action.name === "nopickup" && action.arguments[0] === 6)));
});

test("07-09 A09 waiting approach is outside the disabled extraction trip", () => {
  const cells = sourceContract("A09").trips[3], approach = tripApproach(cells);
  assert.deepEqual(approach, { x: 118, y: 19 });
  assert.ok(!cells.some(cell => cell.x === approach.x && cell.y === approach.y));
});

test("07-09 strategy respects A07 alliance branch and A08 delayed city objective", () => {
  assert.deepEqual(goalTeams("A07", new Set()), [2, 7]);
  assert.deepEqual(goalTeams("A07", new Set([12])), [1]);
  assert.deepEqual(goalTeams("A08", new Set([13])), []);
  assert.deepEqual(goalTeams("A08", new Set([19])), [7]);
});

test("07-09 classification requires ready outcome and exact replay for win or loss", () => {
  assert.equal(classify(null), "BOUNDED_INCOMPLETE");
  assert.equal(classify({ ready: false, resultCode: 0 }, true), "PENDING");
  assert.equal(classify({ ready: true, resultCode: 0 }), "UNVERIFIED_WIN");
  assert.equal(classify({ ready: true, resultCode: 0 }, true), "WIN");
  assert.equal(classify({ ready: true, resultCode: 1 }, true), "LOSS");
  assert.equal(classify(null, false, "blocked"), "RUNTIME_BLOCKER");
});

if (process.env.DC_0709_GROUP) test("07-09 actual group has six source-authenticated public-control checkpoints", () => {
  const directory = process.env.DC_0709_GROUP!;
  for (const id of missionIds) {
    const load = (name: string) => JSON.parse(readFileSync(`${directory}/${id}/${name}.json`, "utf8"));
    const source = load("source"), saved = load("checkpoint"), initial = load("initial"), exit = load("exit");
    assert.deepEqual(source.contract.sources, sourceContract(id).sources);
    assert.equal(saved.sourceHash, source.sourceHash);
    assert.deepEqual(saved.runtime, source.runtime);
    assert.ok(initial.simulation.units.length);
    assert.ok(saved.view.simulation.tick > 0);
    const events = readFileSync(`${directory}/${id}/journal.jsonl`, "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.ok(events.some(event => event.kind === "input"));
    for (const event of events.filter(event => event.kind === "input" && event.data.mode === "assault")) assert.equal(event.data.visible, true);
    if (id === "A09") { assert.equal(exit.signal, "SIGKILL"); assert.equal(exit.code, null); }
    else {
      assert.equal(exit.code, 0);
      const integrity = load("integrity");
      assert.deepEqual(integrity.changed, []); assert.deepEqual(integrity.changedAssets, []); assert.deepEqual(integrity.sourceChanged, []);
    }
  }
});

if (process.env.DC_0709_PROOF && process.env.DC_0709_CONTINUATION) test("07-09 actual A09 pending WIN superseded by LOSS has exact ready replay", () => {
  const load = (directory: string, name: string) => JSON.parse(readFileSync(`${directory}/${name}.json`, "utf8"));
  const directory = process.env.DC_0709_CONTINUATION!, proofDirectory = process.env.DC_0709_PROOF!;
  const pending = load(directory, "pending"), ready = load(directory, "checkpoint"), proof = load(proofDirectory, "result");
  assert.equal(pending.view.simulation.tick, 2096);
  assert.deepEqual(pending.view.state.outcome, { resultCode: 0, reasonCode: 1, ready: false });
  assert.equal(ready.view.simulation.tick, 2313);
  assert.deepEqual(ready.view.state.outcome, { resultCode: 1, reasonCode: 2, ready: true });
  assert.equal(proof.status, "LOSS"); assert.equal(proof.exact, true);
  assert.equal(proof.expectedHash, hash(JSON.stringify(ready.view)));
  assert.equal(proof.actualHash, proof.expectedHash);
  assert.equal(proof.fromTick, 2096); assert.equal(proof.tick, 2313);
  assert.ok(proof.elapsedMs <= 480000);
  for (const directory of [process.env.DC_0709_CONTINUATION!, proofDirectory]) {
    const integrity = load(directory, "integrity");
    assert.deepEqual(integrity.changed, []); assert.deepEqual(integrity.changedAssets, []); assert.deepEqual(integrity.sourceChanged, []);
  }
});
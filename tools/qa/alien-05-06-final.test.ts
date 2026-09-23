import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { NavigationGrid } from "../../src/engine/grid";
import { finalFiringCells, finalStage, finalStatus, safeTerrainFinal, sourceFinal } from "./alien-05-06-final";

test("final A05: original team-only trips, support and rescue/extraction chain", () => {
  const source = sourceFinal(5);
  for (const id of [2, 8, 10, 17, 18]) {
    const block = source.triggers.find(entry => entry.id === id)!;
    assert.equal(block.condition, "(S==0)");
    assert.ok(source.trips[id].length > 0);
  }
  const support = source.triggers.find(entry => entry.id === 2)!;
  assert.deepEqual(support.actions.map(action => action.arguments.slice(0, 5)), [[5, 21, 19, 8, 6], [5, 28, 19, 8, 7]]);
  const rescue = source.triggers.find(entry => entry.id === 17)!;
  assert.deepEqual(rescue.actions[0].arguments.slice(0, 5), [7, 85, 44, 72, 1]);
  assert.ok(rescue.actions.some(action => action.name === "setlifes" && action.arguments[0] === 18));
  const extraction = source.triggers.find(entry => entry.id === 18)!;
  assert.deepEqual(extraction.actions.filter(action => action.name === "abduct").map(action => action.arguments), [[7, 0], [0, 0]]);
  assert.equal(source.triggers.find(entry => entry.id === 19)!.condition, "(c>s(0,2,1))");
  assert.ok(source.triggers.find(entry => entry.id === 7)!.condition.includes("s(0,0,73)==1"));
});

test("final A06: original registered population reinforcement and five city goals", () => {
  const source = sourceFinal(6);
  assert.equal(source.triggers.find(entry => entry.id === 14)!.condition, "(s(0,6)>19)");
  assert.equal(source.triggers.find(entry => entry.id === 12)!.condition,
    "((b(2,0)==0)&&(b(2,1)==0)&&(b(2,2)==0)&&(b(2,3)==0)&&(b(2,4)==0))");
});

test("final route: does not repeat the known fatal 25,39 approach", () => {
  const grid = new NavigationGrid(60, 60, new Uint16Array(3600).fill(1));
  const route = safeTerrainFinal(grid, { x: 25, y: 35 }, [{ x: 25, y: 47 }]);
  assert.ok(route);
  assert.ok(route.path.every(cell => cell.x !== 25 || cell.y !== 39));
});

test("final status: ready WIN without an exact proof cannot be accepted", () => {
  assert.equal(finalStatus(null, undefined), "HARNESS_LIMIT");
  assert.equal(finalStatus(null, "blocked"), "RUNTIME_BLOCKER");
  const outcome = { ready: true, resultCode: 0 } as Parameters<typeof finalStatus>[0];
  assert.equal(finalStatus(outcome, undefined), "READY_WIN_UNVERIFIED");
  assert.equal(finalStatus(outcome, undefined, true), "WIN");
});

test("final combat: range6 can approach a range4 defender without entering its range", () => {
  const grid = new NavigationGrid(30, 30, new Uint16Array(900).fill(1));
  const cells = finalFiringCells(grid, { x: 16, y: 13 }, [{ x: 20, y: 17, range: 4 }], 6);
  assert.ok(cells.length > 0);
  assert.ok(cells.every(cell => Math.abs(cell.x - 20) + Math.abs(cell.y - 17) === 5));
  assert.equal(finalStage({ 2: 0, 8: 1, 10: 1, 17: 1, 18: 0 }), 8);
  assert.equal(finalStage({ 2: 0, 8: 0, 10: 0, 17: 0, 18: 0 }), 19);
});

test("final actual artifacts: legal orders, intact source and honest WIN proof", { skip: !process.env.DC_FINAL_ARTIFACTS }, () => {
  const directory = process.env.DC_FINAL_ARTIFACTS!;
  const read = (name: string) => JSON.parse(readFileSync(`${directory}/${name}.json`, "utf8"));
  const report = read("audit"), saved = read("a05/checkpoint"), result = read("a05/result");
  assert.deepEqual(report.activeOwnedProcesses, []);
  assert.deepEqual(report.a05.integrity, { changed: [], assetChanged: [] });
  assert.equal(saved.view.state.diagnostic, null);
  for (const event of report.a05.commands) {
    assert.equal(event.data.actorId, 52);
    assert.notDeepEqual(event.data.destination, { x: 25, y: 39 });
  }
  assert.equal(read("a05/resume-proof").exact, true);
  assert.ok(result.playMs <= 600000);
  if (result.outcome?.ready && result.outcome.resultCode === 0) {
    const proof = read("proof/proof");
    assert.equal(proof.exact, true); assert.equal(proof.actualHash, proof.expectedHash);
    assert.ok(proof.toTick > proof.fromTick); assert.ok(proof.elapsedMs <= 900000);
  } else {
    assert.notEqual(read("summary").a05, "WIN");
    assert.equal(existsSync(`${directory}/proof/proof.json`), false);
  }
});
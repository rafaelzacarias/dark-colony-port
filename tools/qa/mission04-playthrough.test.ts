import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseTriggerScript } from "../extractors/data/triggers";
import { mission04BudgetStatus, mission04Limits, mission04Partition, mission04Range, mission04SafeRoute, mission04EconomyBlocker } from "./mission04-playthrough";
import { NavigationGrid } from "../../src/engine/grid";
import { sha256 } from "./mission03-playthrough";

test("mission04: unfunded post-depot ground-only state stops instead of waiting for income", () => {
  const state = { depot: true, collectors: 0, credits: 3, collectorCost: 1500, aircraft: 0, earned: 0 };
  assert.equal(mission04EconomyBlocker(state), true);
  for (const change of [{ depot: false }, { collectors: 1 }, { credits: 1500 }, { aircraft: 1 }, { earned: 100 }]) {
    assert.equal(mission04EconomyBlocker({ ...state, ...change }), false);
  }
});

test("mission04: safe waypoints retain source Manhattan clearance on the public path", () => {
  assert.equal(mission04Range({ x: 0, y: 0 }, { x: 3, y: 4 }), 7);
  const grid = new NavigationGrid(20, 20, new Uint16Array(400).fill(1));
  const hazard = { x: 9, y: 10, range: 3 };
  const route = mission04SafeRoute(grid, { x: 1, y: 10 }, [{ x: 18, y: 10 }], new Set(), [hazard]);
  assert.ok(route);
  assert.ok(route.publicPath.every(cell => mission04Range(cell, hazard) >= 4));
  assert.equal(mission04SafeRoute(grid, { x: 1, y: 10 }, [{ x: 9, y: 10 }], new Set(), [hazard]), undefined);
});

test("mission04: persistent guards protect home as the raid grows", () => {
  const troops = [1, 2, 3, 4].map(id => ({ id, cellX: id, cellY: 0 }));
  assert.deepEqual(mission04Partition([], troops, { x: 0, y: 0 }), { guards: [1, 2], raid: [3, 4] });
  assert.deepEqual(mission04Partition([3, 4], troops, { x: 0, y: 0 }), { guards: [3, 4], raid: [1, 2] });
  assert.deepEqual(mission04Partition([1, 2], troops.slice(1), { x: 0, y: 0 }), { guards: [2, 3], raid: [4] });
});

test("mission04: original rescue and depot chains are mission-specific", () => {
  const script = (faction: string) => parseTriggerScript(readFileSync(new URL(`../../raw_cd/DC/SCENARIO/${faction}/${faction}04.TRO`, import.meta.url), "utf8"));
  const human = script("HUMAN"), alien = script("ALIEN");
  assert.equal(human.find(block => block.id === 6)!.mode, "trip");
  assert.equal(human.find(block => block.id === 7)!.mode, "trip");
  assert.deepEqual(human.find(block => block.id === 7)!.actions[0].arguments, [1, 1]);
  assert.ok(human.find(block => block.id === 8)!.condition.includes("b(2,4)"));
  assert.equal(alien.find(block => block.id === 16)!.mode, "trip");
  assert.equal(alien.find(block => block.id === 16)!.condition, "(S==0)");
  assert.ok(alien.find(block => block.id === 16)!.actions.some(action => action.name === "exomoney"));
  assert.ok(alien.find(block => block.id === 9)!.condition.includes("b(1,4)"));
  assert.equal(alien.find(block => block.id === 10)!.condition, "(s(2,6)==0)");
  assert.ok(alien.find(block => block.id === 10)!.actions.some(action => action.arguments[3] === 94));
  assert.deepEqual(alien.find(block => block.id === 11)!.actions[0].arguments, [4, 1]);
});

test("mission04: independent stepping and restore limits", () => {
  assert.deepEqual(mission04Limits(), { stepMs: 600000, maxTicks: 40000, restoreMs: 900000 });
  assert.throws(() => mission04Limits(600001));
  assert.throws(() => mission04Limits(0));
  assert.equal(mission04BudgetStatus(550000, 550000, "WIN"), "WIN");
  assert.equal(mission04BudgetStatus(1376946, 550000, "WIN"), "HARNESS_BUDGET_EXCEEDED");
  assert.equal(mission04BudgetStatus(1376946, 550000, "HARNESS_LIMIT"), "HARNESS_BUDGET_EXCEEDED");
});

for (const faction of ["human", "alien"] as const) test(`mission04: ${faction} actual acceptance artifact`, {
  skip: !process.env.DC_M04_ACCEPTANCE,
}, () => {
  const directory = `${process.env.DC_M04_ACCEPTANCE}/${faction}`;
  const json = (name: string) => JSON.parse(readFileSync(`${directory}/${name}.json`, "utf8"));
  const result = json("result"), proof = json("proof"), ready = json("checkpoint"), pending = json("pending-win");
  assert.equal(result.status, "WIN"); assert.equal(result.outcome.resultCode, 0); assert.equal(result.outcome.ready, true);
  assert.equal(result.exactCheckpoint, true); assert.ok(result.steppingMs <= 600000); assert.ok(proof.restoreMs <= 900000);
  assert.equal(proof.expectedHash, sha256(JSON.stringify(ready.view))); assert.equal(proof.actualHash, proof.expectedHash);
  assert.equal(proof.fromTick, pending.view.simulation.tick); assert.equal(proof.toTick, ready.view.simulation.tick);
  assert.deepEqual(json("integrity").changed, []); assert.equal(json("exit").code, 0);
  for (const id of faction === "human" ? [6, 7, 8] : [16, 18, 9, 10, 11]) assert.ok(result.fired.includes(id));
  const journal = readFileSync(`${directory}/journal.jsonl`, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const commands = journal.filter(event => event.kind === "command");
  assert.ok(commands.length);
  assert.ok(commands.filter(event => event.data.mode === "assault").every(event => event.data.visible));
  assert.ok(commands.some(event => event.data.purpose === (faction === "human" ? "actual-commander-trip6" : "actual-aircraft-trip16")));
});
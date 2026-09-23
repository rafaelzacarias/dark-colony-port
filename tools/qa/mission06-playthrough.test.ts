import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseTriggerScript } from "../extractors/data/triggers";
import { airFiringPoint06, hash06, isAir06, limits06, status06, tripCells06 } from "./mission06-playthrough";

test("mission06 planner: air approaches visible targets at firing range", () => {
  assert.deepEqual(airFiringPoint06({ x: 0, y: 10 }, { x: 10, y: 10 }, 6), { x: 5, y: 10 });
  assert.deepEqual(airFiringPoint06({ x: 15, y: 15 }, { x: 10, y: 10 }, 6), { x: 14, y: 14 });
  assert.deepEqual(airFiringPoint06({ x: 8, y: 10 }, { x: 10, y: 10 }, 6), { x: 8, y: 10 });
  assert.deepEqual(airFiringPoint06({ x: 10, y: 10 }, { x: 10, y: 10 }, 6), { x: 10, y: 10 });
});

test("mission06 planner: source class-2 air is not routed over ground", () => {
  const rawTail = Array<number>(22).fill(0);
  rawTail[2] = 2;
  assert.equal(isAir06({ movementSpeed: 10, rawTail }), true);
  rawTail[4] = 1;
  assert.equal(isAir06({ movementSpeed: 10, rawTail }), false);
  rawTail[4] = 0;
  assert.equal(isAir06({ movementSpeed: 0, rawTail }), false);
  rawTail[2] = 0;
  assert.equal(isAir06({ movementSpeed: 10, rawTail }), false);
});

test("mission06 source: prison trip and CITADEL destruction retain original extraction", () => {
  const script = (faction: string) => parseTriggerScript(readFileSync(new URL(`../../raw_cd/DC/SCENARIO/${faction}/${faction}06.TRO`, import.meta.url), "utf8"));
  const human = script("HUMAN"), alien = script("ALIEN");
  assert.equal(human.find(block => block.id === 1)!.condition, "(S==0)");
  assert.equal(human.find(block => block.id === 1)!.mode, "trip");
  const win = alien.find(block => block.id === 12)!;
  assert.equal(win.condition, "((b(2,0)==0)&&(b(2,1)==0)&&(b(2,2)==0)&&(b(2,3)==0)&&(b(2,4)==0))");
  assert.deepEqual(win.actions.find(action => action.name === "abduct")!.arguments, [0, 0]);
  assert.deepEqual(win.actions.find(action => action.name === "bail")!.arguments, [0, 1]);
  assert.deepEqual(alien.find(block => block.id === 5)!.actions.find(action => action.name === "abduct")!.arguments, [1, 0]);
});

test("mission06 bounds: a deadline or pending result is not a verified win", () => {
  assert.throws(() => limits06(600001));
  assert.throws(() => limits06(0));
  assert.equal(limits06().restoreMs, 900000);
  assert.equal(status06(null, undefined, false), "HARNESS_LIMIT");
  assert.equal(status06({ resultCode: 0, reasonCode: 1, ready: false }, undefined, true), "HARNESS_LIMIT");
  assert.equal(status06({ resultCode: 0, reasonCode: 1, ready: true }, undefined, false), "READY_WIN_UNVERIFIED");
  assert.equal(status06({ resultCode: 0, reasonCode: 1, ready: true }, undefined, true), "WIN");
  assert.equal(status06(null, "missing type", false), "RUNTIME_BLOCKER");
});

test("mission06 MTG: source escape cells use native vertical inversion", () => {
  assert.deepEqual(tripCells06(Uint8Array.from([65, 0, 0, 0]), 2, 2, 1), [{ x: 0, y: 1 }]);
  const mtg = readFileSync(new URL("../../raw_cd/DC/SCENARIO/HUMAN/HUMAN06.MTG", import.meta.url));
  const cells = tripCells06(mtg.subarray(2), mtg[0], mtg[1], 1);
  assert.equal(cells.length, 35);
  assert.ok(cells.some(cell => cell.x === 84 && cell.y === 34));
});

for (const faction of ["human", "alien"] as const) test(`mission06 ${faction}: actual proof artifacts`, {
  skip: !process.env[`DC_M06_${faction.toUpperCase()}_PROOF`],
}, () => {
  const directory = process.env[`DC_M06_${faction.toUpperCase()}_PROOF`]!;
  const json = (name: string) => JSON.parse(readFileSync(`${directory}/${name}.json`, "utf8"));
  const result = json("result"), proof = json("proof"), pending = json("pending-win"), ready = json("checkpoint");
  assert.equal(result.status, "WIN");
  assert.equal(result.exactCheckpoint, true);
  assert.equal(result.outcome.resultCode, 0);
  assert.equal(result.outcome.ready, true);
  assert.ok(result.steppingMs <= 600000);
  assert.ok(proof.proofMs <= 900000);
  assert.equal(pending.view.state.outcome.resultCode, 0);
  assert.equal(pending.view.state.outcome.ready, false);
  assert.equal(ready.view.state.outcome.resultCode, 0);
  assert.equal(ready.view.state.outcome.ready, true);
  assert.equal(pending.sourceHash, ready.sourceHash);
  assert.equal(pending.view.sourceIdentity, ready.view.sourceIdentity);
  assert.ok(proof.toTick > proof.fromTick);
  assert.equal(proof.exactCheckpoint, true);
  assert.equal(proof.sourceHash, ready.sourceHash);
  assert.equal(proof.fromTick, pending.view.simulation.tick);
  assert.equal(proof.toTick, ready.view.simulation.tick);
  assert.equal(proof.expectedHash, hash06(JSON.stringify(ready.view)));
  assert.equal(proof.expectedHash, proof.actualHash);
  assert.deepEqual(json("integrity").changed, []);
  assert.deepEqual(json("integrity").changedAssets, []);
  assert.equal(json("exit").code, 0);
  assert.equal(json("exit").expired, false);
  const journal = json("campaign-journal") as { fired: number[] }[];
  assert.ok(journal.some(entry => entry.fired.includes(faction === "human" ? 1 : 12)));
  if (faction === "alien") for (let slot = 0; slot < 5; slot++) assert.equal(result.buildingSlots[`2,${slot}`], 0);
});
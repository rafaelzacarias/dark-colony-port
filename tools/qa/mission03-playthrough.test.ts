import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseTriggerScript } from "../extractors/data/triggers";
import { mission03Limits, mission03Status, mission03TripCells, runMission03, sha256 } from "./mission03-playthrough";

test("mission03 source: original City goals and commander trip are distinct from M02", () => {
  const script = (faction: string) => parseTriggerScript(readFileSync(new URL(`../../raw_cd/DC/SCENARIO/${faction}/${faction}03.TRO`, import.meta.url), "utf8"));
  const human = script("HUMAN"), alien = script("ALIEN");
  assert.ok(human.find(block => block.id === 1)!.condition.includes("b(2,4)"));
  assert.ok(human.find(block => block.id === 11)!.condition.includes("b(7,4)"));
  const trip = alien.find(block => block.id === 8)!;
  assert.equal(trip.mode, "trip");
  assert.deepEqual(trip.actions.find(action => action.name === "setlifes")!.arguments, [3, 1]);
  assert.equal(trip.actions.find(action => action.name === "reinforce2")!.arguments[3], 94);
});

test("mission03 bounds: source outcome is never inferred from a harness deadline", () => {
  assert.equal(mission03Status(null, undefined, false), "HARNESS_LIMIT");
  assert.equal(mission03Status({ resultCode: 0, reasonCode: 1, ready: false }, undefined, true), "HARNESS_LIMIT");
  assert.equal(mission03Status({ resultCode: 0, reasonCode: 1, ready: true }, undefined, false), "READY_WIN_UNVERIFIED");
  assert.equal(mission03Status({ resultCode: 0, reasonCode: 1, ready: true }, undefined, true), "WIN");
  assert.equal(mission03Status({ resultCode: 1, reasonCode: 3, ready: true }, undefined, false), "SOURCE_LOSS");
  assert.equal(mission03Status(null, "actual runtime failure", false), "RUNTIME_BLOCKER");
  assert.throws(() => mission03Limits(600001));
  assert.throws(() => mission03Limits(0));
  assert.equal(mission03Limits(600000).restoreMs, 900000);
});

test("mission03 MTG: trip coordinates use native vertical inversion and low six bits", () => {
  assert.deepEqual(mission03TripCells(Uint8Array.from([0, 72, 0, 0]), 2, 2, 8), [{ x: 1, y: 1 }]);
  const tags = readFileSync(new URL("../../raw_cd/DC/SCENARIO/ALIEN/ALIEN03.MTG", import.meta.url));
  assert.ok(mission03TripCells(tags.subarray(2), tags[0], tags[1], 8).length > 0);
});

test("mission03 actual A03: public commander trip commits the source type94 spawn", {
  skip: process.env.DC_M03_ACTUAL !== "1",
}, async () => {
  const output = `/tmp/dc-m03-a03-regression-${process.pid}-${Date.now()}`;
  const result = await runMission03("alien", output, mission03Limits(60000, 400));
  assert.equal(result.status, "HARNESS_LIMIT");
  assert.equal(result.diagnostic, undefined);
  assert.equal(result.outcome, null);
  assert.equal(result.spawn94, true);
  assert.equal(result.trip8, true);
  assert.ok(Number(result.commands) > 0);
  const latest = JSON.parse(readFileSync(`${output}/latest.json`, "utf8"));
  const commander = latest.owned.find((actor: { type: number }) => actor.type === 73);
  assert.ok(commander);
  assert.ok(commander.hp > 0);
  const spawn = JSON.parse(readFileSync(`${output}/spawn94.json`, "utf8"));
  assert.deepEqual([spawn.unitType, spawn.team, spawn.health, spawn.tileX, spawn.tileY], [94, 0, 300, 92, 10]);
  const commands = readFileSync(`${output}/journal.jsonl`, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.ok(commands.some(event => event.kind === "command" && event.data.purpose === "actual-commander-trip8" &&
    event.data.mode === "move" && event.data.ids.length === 1 && event.data.ids[0] === commander.id &&
    event.data.destination.x === 92 && event.data.destination.y === 10));
  assert.equal(result.shots, 0);
  assert.equal(result.deaths, 0);
  console.log(JSON.stringify({ output, status: result.status, tick: result.tick }));
});

test("mission03 H03 artifact: exact pending-to-ready proof and preserved original City", {
  skip: !process.env.DC_M03_HUMAN_PROOF,
}, () => {
  const directory = process.env.DC_M03_HUMAN_PROOF!;
  const json = (name: string) => JSON.parse(readFileSync(`${directory}/${name}.json`, "utf8"));
  const result = json("result"), proof = json("proof"), ready = json("checkpoint"), pending = json("pending-win");
  assert.equal(result.status, "WIN");
  assert.equal(result.exactCheckpoint, true);
  assert.equal(result.outcome.ready, true);
  assert.equal(result.outcome.resultCode, 0);
  assert.equal(proof.fromTick, pending.view.simulation.tick);
  assert.equal(proof.toTick, ready.view.simulation.tick);
  assert.equal(proof.expectedHash, sha256(JSON.stringify(ready.view)));
  assert.equal(proof.actualHash, proof.expectedHash);
  assert.equal(proof.sourceHash, ready.sourceHash);
  assert.deepEqual(json("integrity").changed, []);
  for (let slot = 0; slot < 5; slot++) assert.equal(result.buildingSlots[`2,${slot}`], 0);
  for (const team of [0, 7]) assert.ok([0, 1, 2, 3, 4].some(slot => result.buildingSlots[`${team},${slot}`] > 0));
  assert.ok(result.steppingMs <= 600000);
  assert.equal(json("exit").code, 0);
});
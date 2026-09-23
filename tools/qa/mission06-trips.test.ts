import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CampaignSession } from "../../src/engine/campaign-session";
import { createMissionController, hasEnabledMissionTrip, planMissionStep } from "../../src/engine/mission-controller";
import { stepTriggerRuntime } from "../../src/engine/trigger-runtime";
import { parseScenario } from "../extractors/data/scenario";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { parseTriggerScript } from "../extractors/data/triggers";
import { limits06, run06 } from "./mission06-playthrough";

test("HUMAN06 generated MTG trip: source tags include unused IDs without source trip records", () => {
  const source = new URL("../../raw_cd/DC/SCENARIO/HUMAN/HUMAN06.", import.meta.url);
  const blocks = parseTriggerScript(readFileSync(`${source.pathname}TRO`, "utf8"));
  const mtg = readFileSync(`${source.pathname}MTG`);
  assert.equal(mtg.length, 2 + mtg[0] * mtg[1]);
  assert.ok(mtg.subarray(2).some(tag => (tag & 63) === 7));
  assert.equal(blocks.some(block => block.id === 7), false);
  assert.equal(blocks.find(block => block.id === 1)?.mode, "trip");
});

test("HUMAN06 generated MTG trip: eligibility does not relax explicit unknown-trip validation", () => {
  const created = createMissionController(parseTriggerScript("1 trip 1 (S==0)\nbail 0 1\nend\n2 norm 1 (1)\nend\n3 trip 0 (1)\nend"), {});
  assert.ok(created.ok);
  const state = created.value;
  const before = structuredClone(state);
  assert.equal(hasEnabledMissionTrip(state, 1), true);
  for (const id of [2, 3, 7]) assert.equal(hasEnabledMissionTrip(state, id), false);
  const inputs = { cycleCounter: 1, clockMilliseconds: 50, buildingSlots: {} };
  const unknown = { kind: "trip", triggerId: 7, team: 0 } as const;
  assert.equal(stepTriggerRuntime(state.blocks, state.runtime, inputs, unknown).ok, false);
  for (const options of [undefined, { runtimeProfile: "browser-adapted" } as const]) {
    assert.equal(planMissionStep(state, inputs, unknown, [], options).next, null);
  }
  const plan = planMissionStep(state, inputs, { kind: "trip", triggerId: 1, team: 0 });
  assert.ok(plan.next);
  assert.deepEqual(plan.fired, [1]);
  assert.equal(plan.next.runtime.bail?.resultCode, 0);
  assert.equal(hasEnabledMissionTrip(plan.next, 1), false);
  assert.equal(hasEnabledMissionTrip({ ...plan.next, runtime: { ...plan.next.runtime,
    lives: { ...plan.next.runtime.lives, 1: 1 } } }, 1), true);
  assert.deepEqual(state, before);
});

test("HUMAN06 generated MTG trip: strict session rejects unknown tags atomically", () => {
  const read = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url), "utf8");
  const source = parseScenario(read("SCENARIO/HUMAN/HUMAN01.SCN"));
  const tags = new Uint8Array(64);
  tags[(8 - 1 - 1) * 8 + 2] = 7;
  const session = new CampaignSession({ sessionId: "strict-trip-control", source: { ...source,
    placementRows: [[1, 1, 0, 0, 800, 0]],
    teams: source.teams.map(team => ({ ...team, coordinateRows: [[0, 0], [0, 0]] })) },
    units: parseUnitStats(read("GAMESTAT/GAMESTAT.TXT")), weapons: parseWeaponStats(read("GAMESTAT/WEAPSTAT.TXT")),
    triggers: [], messages: [],
    map: { width: 8, height: 8 }, pathGrid: new Uint8Array(64).fill(1), tags,
    commanders: [{ team: 0, unitType: 69, sprite: "TRSC" }],
    directionBits: Array.from({ length: 64 }, () => [0, 0] as const), fixedStepMilliseconds: 16, orientationSteps: 1 });
  const before = session.checkpoint();
  const result = session.step({ clockMilliseconds: 16,
    reservations: [{ slot: 152, generation: 0, tileX: 2, tileY: 1 }] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(JSON.stringify(result.diagnostics), /Unknown trip trigger 7/);
  assert.deepEqual(session.checkpoint(), before);
});

test("HUMAN06 generated MTG trip: original public path passes tick 295", async () => {
  const output = mkdtempSync(join(tmpdir(), "dc-h06-trip-regression-"));
  const result = await run06("human", output, limits06(60000, 300));
  assert.equal(result.diagnostic, undefined, JSON.stringify({ output, result }));
  assert.equal(result.status, "HARNESS_LIMIT");
  assert.equal(result.tick, 300);
  const integrity = JSON.parse(readFileSync(join(output, "integrity.json"), "utf8"));
  assert.deepEqual(integrity.changed, []);
  assert.deepEqual(integrity.changedAssets, []);
});
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCampaignSession, initializeCampaignSession, type CampaignSessionOptions } from "../../src/engine/campaign-session.ts";
import { createCampaignWorldAdapter } from "../../src/engine/campaign-world.ts";
import { auditMissionTriggerSupport, commitMissionPlan, createMissionController, decodeMissionWorldAction,
  planMissionStep } from "../../src/engine/mission-controller.ts";
import { transportHostState } from "../../src/engine/transport-host.ts";
import { evaluateTriggerCondition, type TriggerResult } from "../../src/engine/trigger-runtime.ts";
import { parseScenario } from "../extractors/data/scenario.ts";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables.ts";
import { parseTriggerScript } from "../extractors/data/triggers.ts";
import { parseMapBundle } from "../extractors/maps/map.ts";

function unwrap<Value>(result: TriggerResult<Value>): Value {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("Expected success");
  return result.value;
}

const inputs = { cycleCounter: 16, clockMilliseconds: 256, buildingSlots: {} };
const normal = { kind: "normal" } as const;
const read = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url));

function options(script: string): CampaignSessionOptions {
  const mission = (extension: string) => read(`SCENARIO/HUMAN/HUMAN01.${extension}`);
  const map = parseMapBundle(mission("MAP"), mission("MTG"), mission("PTH"));
  return {
    sessionId: "newrate-controller", source: { ...parseScenario(mission("SCN").toString()),
      placementRows: [[5, 5, 40, 0, 3500], [5, 5, 40, 0, 5000], [6, 5, 40, 0, 7000], [26, 59, 95, 1, -1]] },
    units: parseUnitStats(read("GAMESTAT/GAMESTAT.TXT").toString()),
    weapons: parseWeaponStats(read("GAMESTAT/WEAPSTAT.TXT").toString()),
    triggers: parseTriggerScript(script), messages: [{ id: 1, text: "fixture" }],
    map, pathGrid: map.pathGrid, tags: map.tagGrid, commanders: [{ team: 0, unitType: 69, sprite: "TRSC" }],
    directionBits: [[0, 0]], fixedStepMilliseconds: 16, orientationSteps: 1,
    resourceScales: { rateScale: 65536, reserveScale: 256 },
  };
}

test("newrate decodes exactly three literal bytes in source rate/x/y order", () => {
  for (const args of [[0, 0, 0], [255, 255, 255], [12, 5, 6]]) {
    assert.deepEqual(unwrap(decodeMissionWorldAction({ name: "newrate", arguments: args })),
      { kind: "newrate", rate: args[0], tileX: args[1], tileY: args[2] });
  }
  for (const args of [[], [1, 2], [1, 2, 3, 4], [-1, 2, 3], [256, 2, 3], [1, 256, 3],
    [1, 2, 256], [1.5, 2, 3], ["c", 2, 3], ["(1+1)", 2, 3], ["1", 2, 3]]) {
    assert.equal(decodeMissionWorldAction({ name: "newrate", arguments: args }).ok, false);
  }
});

test("every world command owns dispatch statistics, including prior triggers, VM aliases and bail", () => {
  const blocks = parseTriggerScript(`0 norm 1 (1)
setarray 110 123
end
1 norm 1 (s(1,2,0)==123)
setarray 110 (s(0,2,110)+1)
newrate 2 6 5
bail 0 4
msg 2 0 1 3 8
setarray 110 (s(1,2,0)+1)
newrate 1 5 5
end
2 norm 1 (s(1,2,0)==125)
setarray 799 s(0,2,110)
end`);
  const state = unwrap(createMissionController(blocks, { "1,0": 65536, "2,0": 2147483647 }));
  const before = structuredClone(state);
  const plan = planMissionStep(state, inputs, normal);
  assert.deepEqual(plan.diagnostics, []);
  assert.deepEqual(plan.fired, [0, 1, 2]);
  assert.deepEqual(plan.commands.map(({ id, actionIndex, command }) => [id, actionIndex, command.kind]),
    [["0:1:5", 5, "newrate"], ["0:1:3", 3, "msg"], ["0:1:1", 1, "newrate"]]);
  assert.deepEqual(plan.commands.map(({ statistics }) => statistics!["1,2,0"]), [123, 124, 124]);
  assert.deepEqual(plan.commands.map(({ statistics }) => statistics!["7,0"]), [undefined, undefined, 4]);
  for (const { statistics } of plan.commands) {
    assert.equal(statistics!["1,0"], 65536);
    assert.equal(statistics!["2,0"], 2147483647);
    assert.notEqual(statistics, plan.next!.runtime.statistics);
  }
  assert.notEqual(plan.commands[0].statistics, plan.commands[1].statistics);
  assert.equal(plan.next!.runtime.statistics["1,2,0"], 125);
  assert.equal(plan.next!.runtime.statistics["7,2,29"], 125);
  assert.deepEqual(plan.next!.runtime.lives, { 0: 0, 1: 0, 2: 0 });
  assert.equal(unwrap(evaluateTriggerCondition("s(1,0)", plan.next!.runtime.statistics, inputs)), 0);
  assert.deepEqual(state, before);
});

test("real host uses each command's full-width snapshot, not final world scales", () => {
  const initialized = unwrap(initializeCampaignSession(options("0 norm 1 (1)\nnewrate 15 6 5\nnewrate 1 5 5\nend")));
  const plan = planMissionStep(initialized.controller, inputs, normal);
  const commands = plan.commands.map((command, index) => ({ ...command,
    statistics: { ...command.statistics, "1,0": index === 0 ? 65536 : -128 } }));
  const world = { ...initialized.world, statistics: { ...initialized.world.statistics, "1,0": 0 } };
  const before = structuredClone(world);
  const prepared = unwrap(createCampaignWorldAdapter().prepare(world, commands));
  const host = transportHostState(prepared.world);
  assert.deepEqual([152, 153, 154].map((slot) => host.slots[slot]!.resource!.rateWord), [256, 0, 65529]);
  assert.deepEqual([152, 153, 154].map((slot) => host.slots[slot]!.health), [3500, 5000, 7000]);
  assert.equal(host.slots[152]!.resource!.countdownWord, 65535);
  assert.deepEqual(host.requests, commands.map((command, index) => ({ type: "source-sound", commandId: command.id,
    slot: index === 0 ? 152 : 154, generation: 0, category: 1, event: 7, ebx: 0, ecx: 0, stackArgument: 0, spatial: false })));
  assert.equal(createCampaignWorldAdapter().prepare(world, [{ ...commands[0], statistics: {} }]).ok, false);
  assert.deepEqual(world, before);
});

test("mixed session preserves trailing array writes across feedback, checkpoints and same-scan reads", () => {
  const session = unwrap(createCampaignSession(options(`0 norm 1 (1)
newtype 26 59 84
setarray 110 123
end
1 norm 1 (s(1,2,0)==123)
setarray 110 (s(0,2,110)+1)
newrate 2 6 5
setarray 799 s(1,1,84)
msg 2 0 1 3 8
setarray 110 (s(1,2,0)+1)
newrate 1 5 5
end
2 norm 1 (s(1,2,0)==125)
setarray 0 s(0,2,110)
end`)));
  let frame;
  for (let tick = 1; tick <= 8; tick += 1) frame = unwrap(session.step({ clockMilliseconds: tick * 16 }));
  assert.ok(frame);
  assert.deepEqual(frame.entry.fired, [0, 1, 2]);
  assert.deepEqual(frame.entry.commands.map(({ statistics }) => statistics!["1,2,0"]), [123, 123, 124, 124]);
  assert.equal(frame.entry.commands[0].statistics!["1,1,84"], 0);
  assert.equal(frame.entry.commands[1].statistics!["1,1,84"], 1);
  assert.equal(frame.entry.commands.at(-1)!.statistics!["7,2,29"], 1);
  assert.equal(frame.world.statistics["1,2,0"], 125);
  assert.equal(frame.world.statistics["0,2,0"], 125);
  assert.equal(frame.world.statistics["1,0"], 65536);
  assert.equal(transportHostState(frame.world).slots[152]!.resource!.rateWord, 256);
  assert.equal(transportHostState(frame.world).slots[154]!.resource!.rateWord, 512);
  const checkpoint = session.snapshot;
  assert.deepEqual(checkpoint.world.statistics, checkpoint.controller.runtime.statistics);
  (checkpoint.controller.runtime.statistics as Record<string, number>)["1,2,0"] = -9;
  const next = unwrap(session.step({ clockMilliseconds: 144 }));
  assert.equal(next.world.statistics["1,2,0"], 125);
  assert.equal(next.controller.runtime.statistics["1,2,0"], 125);
  assert.deepEqual(next.entry.requests, []);
});

test("rejected newrate rolls back lives, arrays, previous triggers, rate, sound and journal", () => {
  const fixture = options(`0 norm 1 (1)
setarray 110 123
end
1 norm 1 (1)
newrate 1 7 5
newrate 1 5 5
setarray 110 456
end`);
  const session = unwrap(createCampaignSession(fixture));
  for (let tick = 1; tick < 8; tick += 1) unwrap(session.step({ clockMilliseconds: tick * 16 }));
  const before = session.snapshot;
  const journal = session.journal;
  const failed = session.step({ clockMilliseconds: 128 });
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.match(failed.diagnostics[0].message, /0x43dbc1/);
  assert.deepEqual(session.snapshot, before);
  assert.deepEqual(session.journal, journal);
  const plan = planMissionStep(before.controller, inputs, normal);
  const rejected = commitMissionPlan(before.controller, plan, before.world, createCampaignWorldAdapter());
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.deepEqual([rejected.diagnostics[0].triggerId, rejected.diagnostics[0].actionIndex], [1, 0]);
});

test("world-dependent mixed expressions still block stale same-block feedback", () => {
  const fixture = options("0 norm 1 (1)\nnewrate 1 5 5\nsetarray 110 s(0,1,0)\nnewtype 5 2 48\nend");
  const initialized = unwrap(initializeCampaignSession(fixture));
  const plan = planMissionStep(initialized.controller, inputs, normal);
  assert.equal(plan.next, null);
  assert.deepEqual(plan.pendingEvaluation?.afterCommandIds, ["0:0:2"]);
  assert.equal(commitMissionPlan(initialized.controller, plan, initialized.world, createCampaignWorldAdapter()).ok, false);
});

test("complete mission02 sources keep hashes, generated equality and ai admission blockers", () => {
  for (const [faction, count, actions, digest, blockedId] of [
    ["HUMAN", 20, 42, "0e5a6593768b4fff717be69609d8ed5eb2aea48d1bab68c30c8d5d621d7e080d", 17],
    ["ALIEN", 12, 25, "b219fa5bf2b13ba122271295679d488bb70077556dae20dfa76b00aa9968f50e", 0],
  ] as const) {
    const stem = `${faction}/${faction}02`;
    const source = read(`SCENARIO/${stem}.TRO`);
    assert.equal(createHash("sha256").update(source).digest("hex"), digest);
    const blocks = parseTriggerScript(source.toString());
    const generated = JSON.parse(readFileSync(new URL(`../../public/assets/generated/data/triggers/${stem}.json`, import.meta.url), "utf8"));
    assert.deepEqual(blocks, generated.blocks);
    assert.equal(blocks.length, count);
    assert.equal(blocks.reduce((total, block) => total + block.actions.length, 0), actions);
    const diagnostics = auditMissionTriggerSupport(blocks);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].triggerId, blockedId);
    assert.equal(diagnostics[0].code, "unsupported-action");
    assert.match(diagnostics[0].message, /^ai:/);
  }
});
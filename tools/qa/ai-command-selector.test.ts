import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { aiSelectorSourceCanonical, initializeAiSelectors, prepareAiSelector, writeOriginalAiSelector,
  type AiSelectorSchedulingOwner } from "../../src/engine/ai-command-selector";
import { createCampaignWorld, createCampaignWorldAdapter, stepCampaignWorld } from "../../src/engine/campaign-world";
import { auditMissionTriggerSupport, createMissionController, decodeMissionWorldAction,
  type PlannedMissionCommand } from "../../src/engine/mission-controller";

const source = { id: "selector-control", teams: Array.from({ length: 8 }, (_, index) => ({ index, ai: 4 })), placementRows: [] };
const initialWorld = createCampaignWorld({ sessionId: "selector-control", source, units: [], messages: [] });
if (!initialWorld.ok) throw new Error("Invalid selector control fixture");
const world = { ...initialWorld.value, aiSelectors: initializeAiSelectors(source) };
const owner: AiSelectorSchedulingOwner = { configuration: { sourceId: source.id, profileId: "test-only-ready-scheduler",
  sourceCanonical: aiSelectorSourceCanonical(source),
  scope: "source-native-policy-scheduler", globalMode: 0,
  teams: Array.from({ length: 8 }, (_, team) => ({ team, modes: [0, 1, 2, 3, 4] })) }, isReady: () => true };
function planned(team: number, mode: number): PlannedMissionCommand {
  return { id: `test:${team}:${mode}`, triggerId: 17, actionIndex: 1, action: { name: "ai", arguments: [team, mode] },
    command: { kind: "ai", team, mode } };
}

test("selector matches original 43d840 dword writes, including unvalidated invalid callback modes", () => {
  const trace = process.env.DC_AI_SELECTOR_TRACE ? readFileSync(process.env.DC_AI_SELECTOR_TRACE, "utf8")
    : execFileSync("python3", ["-B", "tools/qa/ai-command-selector-native.py"], { cwd: new URL("../../", import.meta.url),
      encoding: "utf8", env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" } });
  const golden = JSON.parse(trace) as { sourceSha256: string;
    cases: { team: number; mode: number; before: number[]; after: number[];
      onlySelectorDwordChanged: boolean; statisticsUnchanged: boolean; rngUnchanged: boolean }[];
    parsing: { text: string; words: number[] }[];
    scenarios: { mission: string; initialModes: number[] }[]; callbackProof: string[] };
  assert.equal(golden.cases.length, 72);
  assert.equal(golden.sourceSha256.length, 64);
  assert.deepEqual(golden.parsing, [{ text: "2 -1", words: [2, -1] }, { text: "7 32768", words: [7, -32768] },
    { text: "65538 65539", words: [2, 3] }, { text: "2 (1+2)", words: [2, 0] }, { text: "(1+1) 3", words: [0, 0] }]);
  assert.deepEqual(golden.scenarios.map(entry => entry.initialModes), [[0, 0, 4, 3, 3, 0, 0, 0], [0, 4, 4, 0, 0, 0, 0, 0]]);
  assert.equal(golden.callbackProof.length, 2);
  assert.ok(golden.callbackProof.every(line => line.includes("mode3=weight 1 -> real action -> lazy initialization boundary")));
  for (const entry of golden.cases) {
    assert.equal(entry.onlySelectorDwordChanged && entry.statisticsUnchanged && entry.rngUnchanged, true);
    const modes = [...entry.before];
    assert.deepEqual(writeOriginalAiSelector(modes, entry.team, entry.mode).map(mode => mode >>> 0), entry.after);
    assert.deepEqual(modes, entry.before);
    if (entry.mode >= 0 && entry.mode <= 4) {
      const before = { ...world, aiSelectors: { ...world.aiSelectors!, modes } };
      const after = prepareAiSelector(before, planned(entry.team, entry.mode), owner);
      assert.deepEqual(after.aiSelectors!.modes.map(mode => mode >>> 0), entry.after);
      assert.equal(after.aiSelectors!.events[0].before, entry.before[entry.team]);
      assert.equal(after.aiSelectors!.events[0].after, entry.mode);
    }
  }
});

test("selector decoding uses signed words and default audit remains closed", () => {
  for (const mode of [0, 1, 2, 3, 4]) assert.equal(decodeMissionWorldAction(planned(2, mode).action).ok, true);
  for (const args of [[-1, 3], [8, 3], [1.5, 3], [1, -32768], [1, -1], [1, 5], [1, 32767], [1, -32769], [1, 32768], [1, "3"], [1, "c+1"], [1], [1, 3, 0]]) {
    assert.equal(decodeMissionWorldAction({ name: "ai", arguments: args }).ok, false);
  }
  const blocks = [{ id: 17, mode: "norm", flag: 1, condition: "1", actions: [planned(2, 3).action] }];
  assert.equal(auditMissionTriggerSupport(blocks)[0].code, "unsupported-action");
  assert.deepEqual(auditMissionTriggerSupport(blocks, { aiSelector: true }), []);
});

test("selector requires ready scheduler coverage and stages only its dword and receipt", () => {
  const before = structuredClone(world);
  assert.throws(() => prepareAiSelector(world, planned(2, 3)), /scheduling owner required/);
  assert.throws(() => prepareAiSelector(world, planned(2, 3), { ...owner, isReady: () => false }), /not ready/);
  assert.throws(() => prepareAiSelector(world, planned(2, 3), { ...owner,
    configuration: { ...owner.configuration, teams: [{ team: 1, modes: [0] }] } }), /does not own/);
  const result = createCampaignWorldAdapter(undefined, owner).prepare(world, [planned(2, 3)]);
  assert.equal(result.ok, true);
  assert.deepEqual(world, before);
  if (!result.ok) return;
  assert.deepEqual(result.value.world, { ...world, aiSelectors: { ...world.aiSelectors!, modes: [4, 4, 3, 4, 4, 4, 4, 4],
    events: [{ commandId: "test:2:3", triggerId: 17, actionIndex: 1, action: planned(2, 3).action,
      team: 2, before: 4, after: 3, profileId: owner.configuration.profileId, globalMode: 0 }] } });
  const rejected = createCampaignWorldAdapter().prepare(world, [planned(2, 3)]);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.deepEqual(rejected.diagnostics[0], { code: "unsupported-action",
    message: "ai: native policy scheduling owner required", triggerId: 17, actionIndex: 1 });
});

test("world helper opt-in commits reversed selector setters without admitting the default caller", () => {
  const initialized = createMissionController([{ id: 0, mode: "norm", flag: 1, condition: "1",
    actions: [planned(2, 1).action, planned(2, 3).action] }], {});
  assert.equal(initialized.ok, true);
  if (!initialized.ok) return;
  const clock = { cycleCounter: 16, clockMilliseconds: 256 }, event = { kind: "normal" as const };
  assert.equal(stepCampaignWorld(initialized.value, world, clock, event).ok, false);
  const result = stepCampaignWorld(initialized.value, world, clock, event, [], undefined, owner);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.world.aiSelectors!.events.map(entry => [entry.actionIndex, entry.before, entry.after]), [[1, 4, 3], [0, 3, 1]]);
  assert.equal(result.value.world.aiSelectors!.modes[2], 1);
  assert.equal(world.aiSelectors.modes[2], 4);
  assert.equal(initialized.value.runtime.lives[0], 1);
  assert.equal(result.value.state.runtime.lives[0], 0);
});
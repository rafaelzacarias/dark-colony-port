import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CampaignSession, type CampaignSessionOptions } from "../../src/engine/campaign-session";
import { aiSelectorSourceCanonical, initializeAiSelectors, type AiSelectorSchedulingOwner } from "../../src/engine/ai-command-selector";
import { parseScenario } from "../extractors/data/scenario";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { parseTriggerScript } from "../extractors/data/triggers";
import { auditMissionTriggerSupport } from "../../src/engine/mission-controller";
import type { RuntimeTriggerBlock } from "../../src/engine/trigger-runtime";

const read = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url), "utf8");
const units = parseUnitStats(read("GAMESTAT/GAMESTAT.TXT"));
const weapons = parseWeaponStats(read("GAMESTAT/WEAPSTAT.TXT"));
function fixture(triggers: readonly RuntimeTriggerBlock[], ready: AiSelectorSchedulingOwner["isReady"] = () => true) {
  const original = parseScenario(read("SCENARIO/HUMAN/HUMAN01.SCN"));
  const source = { ...original, placementRows: [],
    teams: original.teams.map(team => ({ ...team, coordinateRows: [[0, 0], [0, 0]] as const })) };
  const owner: AiSelectorSchedulingOwner = { configuration: { scope: "source-native-policy-scheduler", sourceId: source.id,
    sourceCanonical: aiSelectorSourceCanonical(source),
    profileId: "test-only-native-scheduler-contract", globalMode: 0, teams: [{ team: 1, modes: [0, 1, 2, 3] }, { team: 2, modes: [3] }] },
    isReady: ready };
  const options: CampaignSessionOptions = { sessionId: "selector-transaction-control", source,
    units: units.filter(unit => unit.index === 0), weapons, triggers, messages: [], map: { width: 8, height: 8 },
    pathGrid: new Uint8Array(64).fill(1), tags: new Uint8Array(64),
    commanders: [{ team: 0, unitType: 0, sprite: units[0].sprite }], directionBits: [[0, 0]],
    fixedStepMilliseconds: 16, orientationSteps: 1, aiSelector: owner.configuration, aiSelectorOwner: owner, journalLimit: 0 };
  return { options, owner };
}
const action = { name: "ai", arguments: [1, 3], raw: "ai 1 3" };
const block: RuntimeTriggerBlock = { id: 0, mode: "norm", flag: 1, condition: "1", actions: [action] };
function advance(session: CampaignSession, count: number) {
  for (let index = 0; index < count; index++) {
    const result = session.step({ clockMilliseconds: (session.snapshot.cycleCounter + 1) * 16 });
    assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.diagnostics));
  }
}
function restore(checkpoint: unknown, owner: AiSelectorSchedulingOwner) {
  return CampaignSession.restore(checkpoint, undefined, undefined, undefined, undefined, owner);
}

test("selector session requires both configuration and live callback; default owner remains closed", () => {
  const { options } = fixture([block]);
  assert.throws(() => new CampaignSession({ ...options, aiSelectorOwner: undefined }), /runtime callback owner required/);
  assert.throws(() => new CampaignSession({ ...options, aiSelector: undefined }), /runtime callback owner required/);
  const session = new CampaignSession({ ...options, aiSelector: undefined, aiSelectorOwner: undefined });
  advance(session, 7);
  const before = session.checkpoint();
  const rejected = session.step({ clockMilliseconds: 128 });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.deepEqual(rejected.diagnostics[0], { code: "unsupported-action",
    message: "ai: native policy scheduling owner required", triggerId: 0, actionIndex: 0 });
  assert.deepEqual(session.checkpoint(), before);
});

test("selector session retains source arrays, exact setter events, full history and fresh-owner restore", () => {
  const { options, owner } = fixture([block]);
  const session = new CampaignSession(options);
  assert.deepEqual(session.snapshot.world.aiSelectors!.initialModes, options.source.teams.map(team => team.ai));
  assert.deepEqual(session.snapshot.world.source, options.source);
  advance(session, 7);
  const before = restore(JSON.parse(JSON.stringify(session.checkpoint())), { ...owner });
  advance(session, 1);
  advance(before, 1);
  assert.deepEqual(before.checkpoint(), session.checkpoint());
  const checkpoint = JSON.parse(JSON.stringify(session.checkpoint()));
  assert.equal(checkpoint.options.aiSelectorOwner, undefined);
  assert.equal(checkpoint.state.aiSelectorInputs.length, 8);
  assert.equal(checkpoint.state.world.aiSelectors.modes[1], 3);
  assert.equal(checkpoint.state.world.aiSelectors.events.length, 1);
  assert.deepEqual(checkpoint.state.world.aiSelectors.events[0].action, action);
  assert.equal(session.journal.length, 0);
  const replayed = restore(checkpoint, { ...owner });
  advance(replayed, 8);
  advance(session, 8);
  assert.deepEqual(replayed.checkpoint(), session.checkpoint());
  assert.equal(session.snapshot.world.aiSelectors!.events.length, 1);
  assert.equal(session.resumeResourceIdle(152, 0).ok, false);
  assert.deepEqual(session.fork().checkpoint(), session.checkpoint());
  assert.throws(() => CampaignSession.restore(checkpoint), /externally configured/);
  assert.throws(() => restore(checkpoint, { ...owner, configuration: { ...owner.configuration, profileId: "wrong" } }), /externally configured/);
  assert.throws(() => restore(checkpoint, { ...owner, isReady: () => false }), /not ready/);
  for (const mutate of [
    (copy: typeof checkpoint) => { copy.state.world.aiSelectors.modes[1] = 2; },
    (copy: typeof checkpoint) => { copy.state.world.aiSelectors.initialModes[1] = 2; },
    (copy: typeof checkpoint) => { copy.state.world.aiSelectors.events[0].action.raw = "ai 1 2"; },
    (copy: typeof checkpoint) => { copy.state.world.aiSelectors.events[0].before += 1; },
    (copy: typeof checkpoint) => { copy.state.aiSelectorInputs.pop(); },
    (copy: typeof checkpoint) => { copy.state.aiSelectorInputs[0].clockMilliseconds = -1; },
    (copy: typeof checkpoint) => { copy.state.world.source.teams[1].aiSlots[0] = 99; },
    (copy: typeof checkpoint) => {
      copy.options.source.teams[1].aiSlots[0] = 99;
      copy.state.world.source.teams[1].aiSlots[0] = 99;
    },
  ]) {
    const copy = structuredClone(checkpoint);
    mutate(copy);
    assert.throws(() => restore(copy, owner), String(mutate));
  }
});

test("reverse-order selector and earlier transport/VM work roll back on late same-block failure", () => {
  const failing = { ...block, actions: [{ name: "msg", arguments: [0, 0, 29, 0, 0] }, action,
    { name: "reinforce2", arguments: [0, 2, 2, 0, 1, 0, 0, 0, 0, 0, 0] },
    { name: "setarray", arguments: [0, 42] }] };
  const calls: number[] = [];
  const { options } = fixture([failing], ({ world, selectors }) => {
    assert.equal(world.entities.some(entity => entity.key.startsWith("transport:")), true);
    assert.equal(selectors.events.length, 0);
    calls.push(1);
    return true;
  });
  const session = new CampaignSession(options);
  advance(session, 7);
  const before = session.checkpoint();
  const result = session.step({ clockMilliseconds: 128 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.diagnostics[0].message, /Missing message 29/);
  assert.equal(calls.length, 1);
  assert.deepEqual(session.checkpoint(), before);
});

test("both original mission-two AI actions decode but default audit still blocks their source indexes", () => {
  for (const [faction, triggerId, team] of [["HUMAN", 17, 2], ["ALIEN", 0, 1]] as const) {
    const blocks = parseTriggerScript(read(`SCENARIO/${faction}/${faction}02.TRO`));
    const source = parseScenario(read(`SCENARIO/${faction}/${faction}02.SCN`));
    const original = blocks.find(entry => entry.id === triggerId)!;
    const actionIndex = original.actions.findIndex(entry => entry.name === "ai");
    assert.equal(actionIndex, faction === "HUMAN" ? 1 : 0);
    assert.equal(original.condition, faction === "HUMAN" ? "((c>880)&&(s(0,10)==0))" : "(c>70)");
    assert.deepEqual([...original.actions].reverse().map(entry => entry.name),
      faction === "HUMAN" ? ["ai", "reinforce"] : ["abduct", "reinforce", "ai"]);
    assert.deepEqual(original.actions[actionIndex].arguments, [team, 3]);
    assert.ok(auditMissionTriggerSupport(blocks).some(entry => entry.triggerId === triggerId && entry.actionIndex === actionIndex));
    assert.ok(!auditMissionTriggerSupport([original], { aiSelector: true }).some(entry => entry.actionIndex === actionIndex));
    assert.equal(source.teams.length, 8);
    assert.ok(source.teams.every(entry => Number.isInteger(entry.ai) && Array.isArray(entry.aiSlots)));
    assert.deepEqual(initializeAiSelectors(source).initialModes,
      faction === "HUMAN" ? [0, 0, 4, 3, 3, 0, 0, 0] : [0, 4, 4, 0, 0, 0, 0, 0]);
  }
});
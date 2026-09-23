import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { initializeAiSelectors } from "../../src/engine/ai-command-selector.ts";
import { createBrowserAiSelectorConfiguration, createBrowserAiSelectorOwner } from "../../src/engine/browser-campaign-runtime.ts";
import { initializeBrowserCasualtyPickup } from "../../src/engine/browser-casualty-pickup.ts";
import { createCampaignWorld, createCampaignWorldAdapter, type CampaignMessage, type CampaignWorld } from "../../src/engine/campaign-world.ts";
import { createMissionController, executeMissionTransaction, missionBailDeadlineExceeded,
  type MissionTransactionAdapter, type PlannedMissionCommand } from "../../src/engine/mission-controller.ts";
import type { TriggerEvent, TriggerInputs, TriggerResult } from "../../src/engine/trigger-runtime.ts";
import { parseMissionMessages } from "../extractors/data/messages.ts";
import { parseScenario } from "../extractors/data/scenario.ts";
import { parseTriggerScript } from "../extractors/data/triggers.ts";

function unwrap<Value>(result: TriggerResult<Value>): Value {
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}

function fixture() {
  const source = (extension: string) => readFileSync(new URL(
    `../../raw_cd/DC/SCENARIO/HUMAN/HUMAN05.${extension}`, import.meta.url), "utf8");
  const scenario = parseScenario(source("SCN"));
  const units = JSON.parse(readFileSync(new URL("../../public/assets/generated/data/units.json", import.meta.url), "utf8")).records;
  const initial = unwrap(createCampaignWorld({ sessionId: "H05-message-control", source: scenario, units,
    messages: parseMissionMessages(source("MSG")), placementInitialization: { firstSlot: 152, mode: 0 },
    resourceInitialization: { firstSlot: 152, width: 256, height: 256, scales: { rateScale: 100, reserveScale: 100 } } }));
  const world: CampaignWorld = { ...initial, aiSelectors: initializeAiSelectors(scenario) };
  const owner = createBrowserAiSelectorOwner(createBrowserAiSelectorConfiguration(scenario), scenario);
  const adapter = createCampaignWorldAdapter(undefined, undefined, owner);
  const state = unwrap(createMissionController(parseTriggerScript(source("TRO")), {
    "0,3": 0, "0,0,69": 0, "0,0,70": 0, "0,0,71": 0, "0,0,72": 0,
  }));
  return { world, state, adapter };
}

interface Observation {
  readonly clockMilliseconds: number;
  readonly defeatedTeams: readonly number[];
  readonly event: TriggerEvent;
  readonly commanderDeath?: boolean;
}

const observations: readonly Observation[] = [
  { clockMilliseconds: 100, defeatedTeams: [], event: { kind: "normal" } },
  { clockMilliseconds: 200, defeatedTeams: [2], event: { kind: "normal" } },
  { clockMilliseconds: 300, defeatedTeams: [1, 2], event: { kind: "normal" } },
  { clockMilliseconds: 400, defeatedTeams: [1, 2], event: { kind: "normal" }, commanderDeath: true },
  { clockMilliseconds: 500, defeatedTeams: [1, 2], event: { kind: "trip", triggerId: 17, team: 0 } },
  { clockMilliseconds: 600, defeatedTeams: [1, 2], event: { kind: "trip", triggerId: 15, team: 0 } },
];

function controlledStep(current: Pick<ReturnType<typeof fixture>, "world" | "state">,
  observation: Observation, messageAdapter: ReturnType<typeof createCampaignWorldAdapter>, failReinforce = false) {
  const emitted: CampaignMessage[] = [];
  const buildingSlots: TriggerInputs["buildingSlots"] = Object.fromEntries(Array.from({ length: 3 }, (_, team) =>
    Array.from({ length: 5 }, (_, slot) => [`${team},${slot}`, observation.defeatedTeams.includes(team) ? 0 : 1])).flat());
  const adapter: MissionTransactionAdapter<CampaignWorld> = {
    ...messageAdapter,
    prepare(world, commands) {
      let staged = world;
      const receipts = [];
      for (const planned of commands) {
        if (planned.command.kind === "reinforce" || planned.command.kind === "newrate") {
          if (failReinforce && planned.command.kind === "reinforce") return { ok: false,
            diagnostics: [{ code: "missing-input", message: "Controlled transport failure after message" }] };
          receipts.push({ commandId: planned.id,
            disposition: planned.command.kind === "reinforce" ? "scheduled" as const : "applied" as const });
        } else {
          const prepared = messageAdapter.prepare(staged, [planned]);
          if (!prepared.ok) return prepared;
          staged = prepared.value.world;
          receipts.push(...prepared.value.receipts);
          if (planned.command.kind === "msg") emitted.push(staged.messages.at(-1)!);
        }
      }
      return { ok: true, value: { world: staged, receipts } };
    },
    feedback: (world, runtime, inputs) => ({ ok: true,
      value: { world, statistics: runtime.statistics, buildingSlots: inputs.buildingSlots } }),
  };
  const result = executeMissionTransaction(current.state,
    { cycleCounter: 16, clockMilliseconds: observation.clockMilliseconds, buildingSlots }, observation.event,
    { ...current.world, clockMilliseconds: observation.clockMilliseconds }, adapter,
    observation.commanderDeath ? [{ id: "controlled-commander-loss", victimTeam: 0, victimType: 69 }] : []);
  return { result, emitted };
}

function runSequence(inputs = observations) {
  const initial = fixture();
  let current = { world: initial.world, state: initial.state };
  const journal = [];
  for (const observation of inputs) {
    const stepped = controlledStep(current, observation, initial.adapter);
    const result = unwrap(stepped.result);
    journal.push({ observation, commands: result.commands, receipts: result.receipts, fired: result.fired,
      trace: result.trace, messages: stepped.emitted });
    current = { world: result.world, state: result.state };
  }
  return { ...current, journal };
}

test("adapted messages: original H05 controlled sequence retains 16 of 18 and pending win; full journal replay", () => {
  const result = runSequence();
  assert.deepEqual(result.journal.flatMap(entry => entry.fired), [20, 1, 9, 14, 18, 17, 15]);
  const messages = result.journal.flatMap(entry => entry.messages);
  assert.deepEqual(messages.map(message => message.messageId), [1, 2, 3, 5, 6, 8, 13, 10, 11, 12, 7, 10, 11, 12, 4, 14, 15, 16]);
  assert.deepEqual(messages.map(message => message.commandId), ["0:20:3", "0:20:2", "1:1:20", "1:1:19", "1:1:18",
    "1:1:17", "1:1:16", "2:9:3", "2:9:2", "2:9:1", "3:14:2", "3:18:3", "3:18:2", "3:18:1", "4:17:2",
    "5:15:2", "5:15:1", "5:15:0"]);
  assert.equal(result.world.messages.length, 16);
  assert.deepEqual(result.world.messages, messages.slice(-16));
  for (const entry of result.journal) {
    const commands = entry.commands.filter(planned => planned.command.kind === "msg");
    assert.deepEqual(entry.messages, commands.map(planned => {
      assert.equal(planned.command.kind, "msg");
      const command = planned.command;
      return { commandId: planned.id, text: result.world.messageTexts[command.messageId], messageId: command.messageId,
        presentationCode: command.presentationCode, parameter3: command.parameter3, parameter4: command.parameter4,
        clockMilliseconds: entry.observation.clockMilliseconds, initialValue: 31 };
    }));
    assert.deepEqual(entry.receipts.map(receipt => receipt.commandId), entry.commands.map(command => command.id));
  }
  assert.equal(result.world.messages.at(-1)!.messageId, 16);
  assert.equal(result.world.messages.at(-1)!.parameter4, 4);
  assert.deepEqual(result.state.runtime.bail, { resultCode: 0, reasonCode: 1, deadlineMilliseconds: 10600 });
  assert.equal(unwrap(missionBailDeadlineExceeded(result.state.runtime.bail, 600)), false);
  assert.equal(result.state.runtime.lives[15], 0);
  const savedJournal = JSON.parse(JSON.stringify(result.journal));
  const replay = runSequence(savedJournal.map((entry: { observation: Observation }) => entry.observation));
  assert.deepEqual(replay, result);
  assert.equal(replay.journal.flatMap(entry => entry.messages).length, 18);
});

test("adapted messages: strict H05 message 17 rejects and rolls back the pending victory block", () => {
  const before = runSequence(observations.slice(0, -1));
  assert.equal(before.world.messages.length, 15);
  const snapshot = structuredClone(before);
  const attempted = controlledStep(before, observations.at(-1)!, createCampaignWorldAdapter());
  assert.equal(attempted.result.ok, false);
  if (!attempted.result.ok) assert.deepEqual(attempted.result.diagnostics, [{ code: "missing-input",
    message: "Message rollover/special selection requires a verified backend", triggerId: 15, actionIndex: 1 }]);
  assert.equal(attempted.emitted.length, 1);
  assert.deepEqual(before, snapshot);
  assert.equal(before.state.runtime.bail, null);
  assert.equal(before.state.runtime.lives[15], 1);
});

test("adapted messages: later command failure rolls back eviction and controller changes", () => {
  const initial = fixture();
  const completed = runSequence();
  const before = runSequence(observations.slice(0, -2));
  const current = { world: { ...before.world, messages: completed.world.messages }, state: before.state };
  const snapshot = structuredClone(current);
  const attempted = controlledStep(current, observations[4], initial.adapter, true);
  assert.equal(attempted.result.ok, false);
  if (!attempted.result.ok) assert.equal(attempted.result.diagnostics[0].actionIndex, 1);
  assert.equal(attempted.emitted.length, 1);
  assert.deepEqual(current, snapshot);
  assert.equal(current.state.runtime.lives[17], 1);
  const committed = unwrap(controlledStep(current, observations[4], initial.adapter).result);
  assert.equal(committed.world.messages.length, 16);
  assert.deepEqual(committed.world.messages.slice(0, -1), current.world.messages.slice(1));
  assert.equal(committed.world.messages.at(-1)!.commandId, "4:17:2");
  assert.equal(committed.state.runtime.lives[17], 0);
});

test("adapted messages: either explicit owner rolls over; strict, missing text and special selection still reject", () => {
  const initial = fixture();
  const completed = runSequence();
  const planned = completed.journal.at(-1)!.commands.at(-1)!;
  assert.equal(planned.command.kind, "msg");
  const command: PlannedMissionCommand = { ...planned, id: "6:15:0" };
  const strict = createCampaignWorldAdapter();
  assert.equal(strict.prepare(completed.world, [command]).ok, false);
  const casualtyWorld = initializeBrowserCasualtyPickup(completed.world, { runtimeProfile: "browser-adapted" });
  for (const [world, adapter] of [[completed.world, initial.adapter], [casualtyWorld, strict]] as const) {
    const snapshot = structuredClone(world);
    const rolled = unwrap(adapter.prepare(world, [command]));
    assert.equal(rolled.world.messages.length, 16);
    assert.deepEqual(rolled.world.messages.slice(0, -1), world.messages.slice(1));
    assert.equal(rolled.world.messages.at(-1)!.commandId, command.id);
    assert.deepEqual(rolled.receipts, [{ commandId: command.id, disposition: "applied" }]);
    for (const invalid of [{ ...planned.command, messageId: 29 }, { ...planned.command, parameter4: 255 }]) {
      assert.equal(adapter.prepare(world, [command, { ...command, id: "6:15:1", command: invalid }]).ok, false);
      assert.equal(adapter.prepare({ ...world, messages: [] }, [{ ...command, command: invalid }]).ok, false);
    }
    assert.deepEqual(world, snapshot);
  }
});
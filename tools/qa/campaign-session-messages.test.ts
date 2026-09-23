import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CampaignSession, type CampaignSessionInput, type CampaignSessionOptions, type CampaignSessionState } from "../../src/engine/campaign-session.ts";
import { createBrowserAiSelectorConfiguration } from "../../src/engine/browser-campaign-runtime.ts";
import type { CampaignMessage } from "../../src/engine/campaign-world.ts";
import type { RuntimeTriggerBlock, TriggerResult } from "../../src/engine/trigger-runtime.ts";
import { parseScenario } from "../extractors/data/scenario.ts";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables.ts";
import { parseTriggerScript } from "../extractors/data/triggers.ts";
import { parseMissionMessages } from "../extractors/data/messages.ts";
import { parseMapBundle } from "../extractors/maps/map.ts";

function unwrap<Value>(result: TriggerResult<Value>): Value {
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}

function fixture(triggers: readonly RuntimeTriggerBlock[]): CampaignSessionOptions {
  const read = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url), "utf8");
  const original = parseScenario(read("SCENARIO/HUMAN/HUMAN05.SCN"));
  const source = { ...original, placementRows: [], teams: original.teams.map(team => ({ ...team,
    coordinateRows: [[0, 0], [0, 0]] as const })) };
  return { sessionId: "session-message-control", runtimeProfile: "browser-adapted", source,
    browserAi: createBrowserAiSelectorConfiguration(source), journalLimit: "all",
    units: parseUnitStats(read("GAMESTAT/GAMESTAT.TXT")).filter(unit => unit.index === 0),
    weapons: parseWeaponStats(read("GAMESTAT/WEAPSTAT.TXT")), triggers,
    messages: [{ id: 1, text: "Repeated source text" }], map: { width: 8, height: 8 },
    pathGrid: new Uint8Array(64).fill(1), tags: new Uint8Array(64),
    commanders: [{ team: 0, unitType: 0, sprite: "TRSC" }],
    directionBits: Array.from({ length: 64 }, () => [0, 0] as const), fixedStepMilliseconds: 16, orientationSteps: 1 };
}

function messageBlock(count: number): RuntimeTriggerBlock {
  return { id: 0, mode: "norm", flag: 1, condition: "1",
    actions: Array.from({ length: count }, () => ({ name: "msg", arguments: [2, 0, 1, 3, 4] })) };
}

test("session messages: more than a full window in one transaction emits every command once", () => {
  const session = new CampaignSession(fixture([messageBlock(20)]));
  for (let tick = 1; tick < 8; tick++) assert.deepEqual(unwrap(session.stepForBrowserView({ clockMilliseconds: tick })).entry.messages, []);
  const frame = unwrap(session.stepForBrowserView({ clockMilliseconds: 8 }));
  assert.equal(frame.entry.messages.length, 20);
  assert.deepEqual(frame.entry.messages.map(message => message.commandId), frame.entry.commands.map(command => command.id));
  assert.deepEqual(frame.entry.messages.map(message => message.commandId),
    Array.from({ length: 20 }, (_, index) => `0:0:${19 - index}`));
  assert.deepEqual(session.snapshot.world.messages, frame.entry.messages.slice(-16));
  assert.deepEqual(frame.world.messages, frame.entry.messages.slice(-1));
  assert.equal(session.journal.flatMap(entry => entry.messages).length, 20);
  assert.deepEqual(unwrap(session.stepForBrowserView({ clockMilliseconds: 9 })).entry.messages, []);
  const restored = CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint())));
  assert.deepEqual(restored.checkpoint(), session.checkpoint());
  assert.deepEqual(unwrap(restored.stepForBrowserView({ clockMilliseconds: 10 })),
    unwrap(session.stepForBrowserView({ clockMilliseconds: 10 })));
});

test("session messages: duplicate IDs emit nothing and retained source entries stay immutable", () => {
  const session = new CampaignSession(fixture([messageBlock(1)]));
  const message = Object.freeze({ commandId: "0:0:0", text: "Repeated source text", messageId: 1,
    presentationCode: 2, parameter3: 3, parameter4: 4, clockMilliseconds: 0, initialValue: 31 });
  const current = Reflect.get(session, "current") as CampaignSessionState;
  const messages = Object.freeze([message]);
  Reflect.set(session, "current", { ...current, world: { ...current.world, messages } });
  for (let tick = 1; tick <= 8; tick++) {
    assert.deepEqual(unwrap(session.stepForBrowserView({ clockMilliseconds: tick })).entry.messages, []);
  }
  assert.equal(session.latestJournalEntry!.commands.length, 1);
  assert.deepEqual(session.journal.flatMap(entry => entry.messages), []);
  assert.equal(messages.length, 1);
  assert.equal(message.clockMilliseconds, 0);
});

test("session messages: full-window late failure publishes nothing and retry preserves order", () => {
  const options = fixture([messageBlock(16), { id: 1, mode: "trip", flag: 1, condition: "1", actions: [
    { name: "msg", arguments: [2, 0, 1, 3, 255] }, { name: "msg", arguments: [2, 0, 1, 3, 4] },
  ] }]);
  const session = new CampaignSession(options);
  for (let tick = 1; tick <= 8; tick++) unwrap(session.stepForBrowserView({ clockMilliseconds: tick }));
  const current = Reflect.get(session, "current") as CampaignSessionState;
  const snapshot = session.checkpoint(), journal = session.journal;
  const sourceMessages = current.world.messages;
  sourceMessages.forEach(Object.freeze);
  Object.freeze(sourceMessages);
  Reflect.set(session, "current", { ...current, controller: { ...current.controller,
    blocks: current.controller.blocks.map(block => block.id === 1 ? { ...block, mode: "norm" } : block) } });
  for (let tick = 9; tick < 16; tick++) unwrap(session.stepForBrowserView({ clockMilliseconds: tick }));
  const before = session.checkpoint(), beforeJournal = session.journal;
  assert.equal(session.stepForBrowserView({ clockMilliseconds: 16 }).ok, false);
  assert.deepEqual(session.checkpoint(), before);
  assert.deepEqual(session.journal, beforeJournal);
  assert.deepEqual(sourceMessages, snapshot.state.world.messages);
  assert.deepEqual(session.journal.flatMap(entry => entry.messages), journal.flatMap(entry => entry.messages));
  const retryState = Reflect.get(session, "current") as CampaignSessionState;
  Reflect.set(session, "current", { ...retryState, controller: { ...retryState.controller,
    blocks: retryState.controller.blocks.map(block => block.id === 1 ? { ...block,
      actions: block.actions.map(action => ({ ...action, arguments: [2, 0, 1, 3, 4] })) } : block) } });
  const retry = unwrap(session.stepForBrowserView({ clockMilliseconds: 16 }));
  assert.deepEqual(retry.entry.messages.map(message => message.commandId), ["1:1:1", "1:1:0"]);
  assert.deepEqual(sourceMessages, snapshot.state.world.messages);
  Reflect.set(retry.entry.messages[0], "text", "external mutation");
  assert.equal(session.snapshot.world.messages.at(-2)!.text, "Repeated source text");
  assert.equal(session.latestJournalEntry!.messages[0].text, "Repeated source text");
});

test("session messages: strict default still rejects message 17 atomically", () => {
  const { browserAi: _owner, runtimeProfile: _profile, ...options } = fixture([messageBlock(17)]);
  const session = new CampaignSession(options);
  for (let tick = 1; tick < 8; tick++) unwrap(session.step({ clockMilliseconds: tick }));
  const before = session.checkpoint(), journal = session.journal;
  const result = session.step({ clockMilliseconds: 8 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.diagnostics[0].message, /Message rollover/);
  assert.deepEqual(session.checkpoint(), before);
  assert.deepEqual(session.journal, journal);
});

function human05(): CampaignSessionOptions {
  const read = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url));
  const asset = (extension: string) => read(`SCENARIO/HUMAN/HUMAN05.${extension}`);
  const source = parseScenario(asset("SCN").toString());
  const map = parseMapBundle(asset("MAP"), asset("MTG"), asset("PTH"));
  return { ...fixture([]), source, browserAi: createBrowserAiSelectorConfiguration(source),
    units: parseUnitStats(read("GAMESTAT/GAMESTAT.TXT").toString()),
    weapons: parseWeaponStats(read("GAMESTAT/WEAPSTAT.TXT").toString()),
    triggers: parseTriggerScript(asset("TRO").toString()), messages: parseMissionMessages(asset("MSG").toString()),
    map, pathGrid: map.pathGrid, tags: map.tagGrid, resourceScales: "configured-startup",
    commanders: source.teams.map(team => ({ team: team.index, unitType: team.race === 1 ? 73 : 69,
      sprite: team.race === 1 ? "GRAY" : "TRSC" })) };
}

test("session messages: original H05 18-message controlled sequence, pending WIN, replay and compact continuation", () => {
  const options = human05(), session = new CampaignSession(options);
  const inputs: CampaignSessionInput[] = [];
  let latestText = "";
  const advance = (extra: Omit<CampaignSessionInput, "clockMilliseconds"> = {}) => {
    const input = { clockMilliseconds: (inputs.length + 1) * 16, ...extra };
    const frame = unwrap(session.stepForBrowserView(input));
    inputs.push(input);
    latestText = frame.entry.messages.at(-1)?.text ?? latestText;
    assert.equal(frame.world.messages.at(-1)?.text ?? "", latestText);
    assert.ok(frame.world.messages.length <= 1);
    return frame;
  };
  while (inputs.length < 16) advance();
  const defeat = (team: number) => {
    const updates = session.snapshot.world.entities.filter(entity => entity.team === team && entity.key.startsWith("colony:") && entity.health > 0)
      .map(entity => ({ type: "combat-death" as const, slot: entity.rawSlot!, generation: entity.generation }));
    assert.ok(updates.length > 0);
    advance({ updates });
    while (inputs.length % 8) advance();
  };
  defeat(2);
  defeat(1);
  while (!session.snapshot.world.entities.some(entity => entity.team === 0 && entity.unitType === 69 && entity.health > 0)) {
    assert.ok(inputs.length < 250, "Original initial commander delivery");
    advance();
  }
  const commander = session.snapshot.world.entities.find(entity => entity.team === 0 && entity.unitType === 69 && entity.health > 0)!;
  advance({ updates: [{ type: "combat-death", slot: commander.rawSlot!, generation: commander.generation }] });
  while (inputs.length % 8) advance();
  for (const triggerId of [17, 15]) {
    const state = session.snapshot;
    const actor = state.world.entities.find(entity => entity.team === 0 && entity.health > 0 &&
      !state.staticSlots.includes(entity.rawSlot!) && state.world.entityBytes![entity.rawSlot! * 220 + 0x2c] === 1);
    assert.ok(actor, "Living player actor for controlled trip reservation");
    const cell = options.tags.findIndex(tag => (tag & 63) === triggerId);
    assert.ok(cell >= 0);
    advance({ reservations: [{ slot: actor.rawSlot!, generation: actor.generation,
      tileX: cell % options.map.width, tileY: options.map.height - 1 - Math.floor(cell / options.map.width) }] });
  }
  const journal = session.journal;
  const messages = journal.flatMap(entry => entry.messages);
  assert.deepEqual(journal.flatMap(entry => entry.fired), [20, 1, 9, 14, 18, 17, 15]);
  assert.deepEqual(messages.map(message => message.messageId), [1, 2, 3, 5, 6, 8, 13, 10, 11, 12, 7, 10, 11, 12, 4, 14, 15, 16]);
  for (const entry of journal) {
    const expected: CampaignMessage[] = entry.commands.filter(planned => planned.command.kind === "msg").map(planned => {
      assert.equal(planned.command.kind, "msg");
      const command = planned.command;
      return { commandId: planned.id, text: session.snapshot.world.messageTexts[command.messageId],
        messageId: command.messageId, presentationCode: command.presentationCode, parameter3: command.parameter3,
        parameter4: command.parameter4, clockMilliseconds: entry.clockMilliseconds, initialValue: 31 };
    });
    assert.deepEqual(entry.messages, expected);
  }
  assert.equal(new Set(messages.map(message => message.commandId)).size, 18);
  assert.deepEqual(session.snapshot.world.messages, messages.slice(-16));
  assert.equal(latestText, options.messages.find(message => message.id === 16)!.text);
  const checkpoint = JSON.parse(JSON.stringify(session.checkpoint()));
  assert.deepEqual(checkpoint.state.controller.runtime.bail, { resultCode: 0, reasonCode: 1,
    deadlineMilliseconds: inputs.at(-1)!.clockMilliseconds + 10000 });
  const replay = new CampaignSession(options);
  for (const input of JSON.parse(JSON.stringify(inputs))) unwrap(replay.stepForBrowserView(input));
  assert.deepEqual(replay.journal, journal);
  assert.deepEqual(replay.checkpoint(), checkpoint);
  const restored = CampaignSession.restore(checkpoint);
  assert.deepEqual(restored.checkpoint(), checkpoint);
  for (const clockMilliseconds of [inputs.at(-1)!.clockMilliseconds + 1, checkpoint.state.controller.runtime.bail.deadlineMilliseconds + 1]) {
    const frame = unwrap(session.stepForBrowserView({ clockMilliseconds }));
    assert.deepEqual(unwrap(restored.stepForBrowserView({ clockMilliseconds })), frame);
    assert.deepEqual(frame.entry.messages, []);
    assert.equal(frame.world.messages.at(-1)!.text, latestText);
  }
  assert.equal(session.latestJournalEntry!.bail!.resultCode, 0);
  assert.deepEqual(restored.checkpoint(), session.checkpoint());
});
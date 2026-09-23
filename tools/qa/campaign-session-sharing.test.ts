import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CampaignSession, type CampaignSessionInput } from "../../src/engine/campaign-session";
import { createBrowserAiSelectorConfiguration } from "../../src/engine/browser-campaign-runtime";
import { parseScenario } from "../extractors/data/scenario";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { parseMapBundle } from "../extractors/maps/map";
import { transportHostState } from "../../src/engine/transport-host";

function sessionFixture(originalWorld = false) {
  const read = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url), "utf8");
  const original = parseScenario(read("SCENARIO/HUMAN/HUMAN02.SCN"));
  const source = originalWorld ? original : { ...original, placementRows: [], teams: original.teams.map(team =>
    ({ ...team, coordinateRows: [[0, 0], [0, 0]] as const })) };
  const bytes = (extension: string) => readFileSync(new URL(`../../raw_cd/DC/SCENARIO/HUMAN/HUMAN02.${extension}`, import.meta.url));
  const map = originalWorld ? parseMapBundle(bytes("MAP"), bytes("MTG"), bytes("PTH"))
    : { width: 8, height: 8, pathGrid: new Uint8Array(64).fill(1), tagGrid: new Uint8Array(64) };
  return new CampaignSession({ sessionId: "sharing-control", source, runtimeProfile: "browser-adapted",
    browserAi: createBrowserAiSelectorConfiguration(source), journalLimit: 32,
    units: parseUnitStats(read("GAMESTAT/GAMESTAT.TXT")).filter(unit => originalWorld || unit.index === 0),
    weapons: parseWeaponStats(read("GAMESTAT/WEAPSTAT.TXT")), triggers: [], messages: [],
    map, pathGrid: map.pathGrid, tags: map.tagGrid, resourceScales: "configured-startup",
    commanders: [{ team: 0, unitType: originalWorld ? 69 : 0, sprite: "TRSC" }],
    directionBits: [[0, 0]], fixedStepMilliseconds: 16, orientationSteps: 1 });
}

test("session sharing: parent, siblings, external input, snapshots and failed frame stay isolated", () => {
  const parent = sessionFixture();
  for (let tick = 1; tick <= 16; tick++) assert.equal(parent.step({ clockMilliseconds: tick * 16 }).ok, true);
  const before = parent.checkpoint(), journal = parent.journal;
  const left = parent.fork(), right = parent.fork();
  const input = { clockMilliseconds: 17 * 16, updates: [] };
  assert.equal(left.step(input).ok, true);
  input.clockMilliseconds = 99999;
  const exposed = left.snapshot;
  (exposed.aiSelectorInputs![0] as { clockMilliseconds: number }).clockMilliseconds = 99999;
  (exposed.world.exomoney as Record<number, number>)[0] = 99999;
  const committed = left.checkpoint();
  const branchFrame = right.stepForBrowserView({ clockMilliseconds: 17 * 16, updates: [] });
  assert.equal(branchFrame.ok, true);
  if (branchFrame.ok) {
    (branchFrame.value.world.exomoney as Record<number, number>)[0] = 87654;
    (branchFrame.value.controller.runtime.statistics as Record<string, number>)["0,10"] = 87654;
  }
  assert.equal(left.step({ clockMilliseconds: 18 * 16,
    reservations: [{ slot: -1, generation: 0, tileX: 0, tileY: 0 }] }).ok, false);
  assert.deepEqual(left.checkpoint(), committed);
  assert.deepEqual(parent.checkpoint(), before);
  assert.deepEqual(parent.journal, journal);
  assert.deepEqual(left.checkpoint(), right.checkpoint());
  const restored = CampaignSession.restore(JSON.parse(JSON.stringify(committed)));
  assert.deepEqual(restored.checkpoint(), committed);
  assert.equal(left.step({ clockMilliseconds: 18 * 16 }).ok, true);
  assert.equal(restored.step({ clockMilliseconds: 18 * 16 }).ok, true);
  assert.deepEqual(restored.checkpoint(), left.checkpoint());
});

test("session sharing: original actor updates and late failure cannot mutate shared committed world", () => {
  const parent = sessionFixture(true), before = parent.checkpoint();
  const host = transportHostState(parent.snapshot.world);
  const actor = host.slots.find(record => record && record.slot >= 152 && record.unitType === 8)!;
  assert.ok(actor);
  const left = parent.fork(), right = parent.fork();
  const update = { type: "position" as const, slot: actor.slot, generation: actor.generation,
    position: { x: actor.position.x + 1, y: actor.position.y } };
  assert.equal(left.stepForBrowserView({ clockMilliseconds: 16, updates: [update] }).ok, true);
  const committed = left.checkpoint();
  update.position.x += 1;
  assert.deepEqual(left.checkpoint(), committed);
  assert.equal(right.stepForBrowserView({ clockMilliseconds: 16, updates: [update],
    reservations: [{ slot: -1, generation: 0, tileX: 0, tileY: 0 }] }).ok, false);
  assert.deepEqual(parent.checkpoint(), before);
  assert.deepEqual(right.checkpoint(), before);
  assert.deepEqual(left.checkpoint(), committed);
  assert.equal(transportHostState(left.snapshot.world).slots[actor.slot]!.position.x, actor.position.x + 1);
});

test("session sharing: shared storage and throwing getters cannot commit input", () => {
  const session = sessionFixture(), before = session.checkpoint();
  assert.equal(session.step({ clockMilliseconds: 16, updates: new Uint8Array(new SharedArrayBuffer(8)) } as unknown as CampaignSessionInput).ok, false);
  assert.equal(session.step({ get clockMilliseconds(): number { throw new Error("external getter"); } }).ok, false);
  assert.deepEqual(session.checkpoint(), before);
  assert.equal(session.stepForBrowserView({ clockMilliseconds: 16, updates: undefined, reservations: undefined }).ok, true);
  const child = session.fork(), committed = session.checkpoint();
  assert.equal(child.stepForBrowserView({ clockMilliseconds: 32 }).ok, true);
  assert.deepEqual(session.checkpoint(), committed);
});

test("session sharing: compact view omits only replay inputs and never deep-clones their prefix", () => {
  const session = sessionFixture();
  for (let tick = 1; tick <= 1000; tick++) assert.equal(session.stepForBrowserView({ clockMilliseconds: tick * 16 }).ok, true);
  const before = session.checkpoint(), original = globalThis.structuredClone;
  let historyClones = 0;
  globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
    if (value && typeof value === "object" && (Array.isArray(value)
      ? value.length >= 1000 && value[0]?.clockMilliseconds !== undefined
      : "aiSelectorInputs" in value && value.aiSelectorInputs !== undefined)) historyClones++;
    return original(value, options);
  }) as typeof structuredClone;
  let fork: CampaignSession;
  try {
    fork = session.fork();
    assert.equal(fork.browserViewSnapshot.cycleCounter, 1000);
    assert.equal(fork.stepForBrowserView({ clockMilliseconds: 1001 * 16 }).ok, true);
    assert.equal(historyClones, 0);
  } finally { globalThis.structuredClone = original; }
  const { aiSelectorInputs, ...operational } = session.snapshot;
  assert.equal(aiSelectorInputs!.length, 1000);
  assert.deepEqual(session.browserViewSnapshot, operational);
  const exposed = session.browserViewSnapshot;
  (exposed.world.exomoney as Record<number, number>)[0] = 123456;
  const last = session.latestJournalEntry!;
  (last.requests as unknown[]).push({ type: "external" });
  assert.deepEqual(session.checkpoint(), before);
  const restored = CampaignSession.restore(JSON.parse(JSON.stringify(before)));
  assert.deepEqual(restored.checkpoint(), before);
  assert.equal(restored.stepForBrowserView({ clockMilliseconds: 1001 * 16 }).ok, true);
  assert.deepEqual(restored.checkpoint(), fork!.checkpoint());
  assert.deepEqual(session.latestJournalEntry, session.journal.at(-1));
});
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { CampaignSession, type CampaignSessionOptions } from "../../src/engine/campaign-session";
import { createBrowserAiSelectorConfiguration } from "../../src/engine/browser-campaign-runtime";
import { transportHostState } from "../../src/engine/transport-host";
import { parseScenario } from "../extractors/data/scenario";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { parseTriggerScript } from "../extractors/data/triggers";
import { parseMissionMessages } from "../extractors/data/messages";
import { parseMapBundle } from "../extractors/maps/map";
import { createBrowserCampaignPlaythrough, type BrowserPlaythroughCheckpoint, type BrowserPlaythroughEvent } from "./fixtures/browser-campaign-playthrough";
import { installSourceRender } from "./fixtures/source-render";

function fixture(): CampaignSessionOptions {
  const read = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url));
  const mission = (extension: string) => read(`SCENARIO/ALIEN/ALIEN02.${extension}`);
  const source = parseScenario(mission("SCN").toString());
  const map = parseMapBundle(mission("MAP"), mission("MTG"), mission("PTH"));
  return { sessionId: "reservation-pickup-ALIEN02", source, runtimeProfile: "browser-adapted",
    browserAi: createBrowserAiSelectorConfiguration(source), journalLimit: 1,
    units: parseUnitStats(read("GAMESTAT/GAMESTAT.TXT").toString()),
    weapons: parseWeaponStats(read("GAMESTAT/WEAPSTAT.TXT").toString()),
    triggers: parseTriggerScript(mission("TRO").toString()), messages: parseMissionMessages(mission("MSG").toString()),
    map, pathGrid: map.pathGrid, tags: map.tagGrid, resourceScales: "configured-startup",
    commanders: [{ team: 0, unitType: 73, sprite: "GRAY" }, { team: 1, unitType: 69, sprite: "TRSC" }],
    directionBits: Array.from({ length: 64 }, () => [0, 0] as const), fixedStepMilliseconds: 16, orientationSteps: 1 };
}

test("reservation pickup: original ALIEN02 live mobile reservation survives same-step noncombat pickup", () => {
  const session = new CampaignSession(fixture());
  let previous = session.snapshot;
  for (let tick = 1; tick <= 1500; tick++) {
    const actor = transportHostState(previous.world).slots[193];
    const reservation = actor?.status === 1 ? { slot: actor.slot, generation: actor.generation,
      tileX: actor.position.x >>> 8, tileY: actor.position.y >>> 8 } : undefined;
    const input = { clockMilliseconds: tick * 16, ...(reservation ? { reservations: [reservation] } : {}) };
    const before = session.fork();
    const result = session.step(input);
    assert.equal(result.ok, true, `tick ${tick}: ${JSON.stringify(result.ok ? null : result.diagnostics)}`);
    if (!result.ok) return;
    const removal = result.value.entry.requests.find(request => request.type === "remove-noncombat" && request.slot === 193);
    if (removal) {
      assert.deepEqual(reservation && [reservation.slot, reservation.generation], [193, 0]);
      assert.equal(actor!.unitType, 69);
      assert.equal(actor!.status, 1);
      const retired = transportHostState(result.value.world).slots[193]!;
      assert.equal(retired.status, 10);
      assert.equal(retired.health, actor!.health);
      assert.deepEqual(result.value.controller.consumedLosses, previous.controller.consumedLosses);
      assert.deepEqual(before.step(input), result);
      const taggedOptions = fixture();
      const tagged = new CampaignSession({ ...taggedOptions, tags: new Uint8Array(taggedOptions.tags.length).fill(63),
        triggers: [...taggedOptions.triggers, { id: 63, mode: "trip", flag: 1, condition: "((S==1)&&(t==69))", actions: [] }] });
      for (let visit = 1; visit < tick; visit++) assert.equal(tagged.step({ clockMilliseconds: visit * 16 }).ok, true);
      const tripped = tagged.step(input);
      assert.equal(tripped.ok, true);
      if (tripped.ok) {
        assert.ok(tripped.value.entry.fired.includes(63), "Picked-up mobile reservation must still dispatch its team/type trip");
        assert.equal(transportHostState(tripped.value.world).slots[193]?.status, 10);
      }
      const saved = session.checkpoint();
      const rejected = session.step({ clockMilliseconds: (tick + 1) * 16, reservations: [reservation!] });
      assert.equal(rejected.ok, false);
      if (!rejected.ok) assert.match(rejected.diagnostics[0].message, /Invalid reservation unit: slot 193, generation 0, status 10/);
      assert.deepEqual(session.checkpoint(), saved);
      const restored = CampaignSession.restore(JSON.parse(JSON.stringify(saved)));
      assert.deepEqual(restored.checkpoint(), saved);
      assert.deepEqual(restored.step({ clockMilliseconds: (tick + 1) * 16 }), session.step({ clockMilliseconds: (tick + 1) * 16 }));
      return;
    }
    previous = result.value;
  }
  assert.fail("Original ALIEN02 commander pickup did not occur within 1500 ticks");
});

test("reservation pickup: missing, stale, static and same-input dead actors still reject atomically", () => {
  const session = new CampaignSession(fixture());
  for (let tick = 1; tick <= 100 && !transportHostState(session.snapshot.world).slots[193]; tick++) {
    assert.equal(session.step({ clockMilliseconds: tick * 16 }).ok, true);
  }
  assert.equal(transportHostState(session.snapshot.world).slots[193]?.status, 1);
  const saved = session.checkpoint();
  for (const input of [
    { reservations: [{ slot: 799, generation: 0, tileX: 0, tileY: 0 }] },
    { reservations: [{ slot: 193, generation: 1, tileX: 0, tileY: 0 }] },
    { reservations: [{ slot: 0, generation: 0, tileX: 0, tileY: 0 }] },
    { updates: [{ type: "combat-death" as const, slot: 193, generation: 0 }],
      reservations: [{ slot: 193, generation: 0, tileX: 0, tileY: 0 }] },
  ]) {
    const result = session.step({ clockMilliseconds: (saved.state.cycleCounter + 1) * 16, ...input });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.diagnostics[0].message, /Invalid reservation unit/);
    assert.deepEqual(session.checkpoint(), saved);
  }
});

test("reservation pickup: saved ALIEN02 public journal reproduces the exact retirement and continues to 1500", {
  skip: !process.env.DC_RESERVATION_ARTIFACT,
}, async context => {
  const directory = process.env.DC_RESERVATION_ARTIFACT!;
  type Saved = { sourceHash: string; view: unknown; strategy: BrowserPlaythroughCheckpoint };
  const early = JSON.parse(readFileSync(`${directory}/early-checkpoint.json`, "utf8")) as Saved;
  const final = JSON.parse(readFileSync(`${directory}/checkpoint.json`, "utf8")) as Saved;
  const replay = readFileSync(`${directory}/journal.jsonl`, "utf8").trim().split("\n")
    .map(line => JSON.parse(line) as BrowserPlaythroughEvent);
  const renderer = installSourceRender(), originalFetch = globalThis.fetch;
  const originalStep = CampaignSession.prototype.stepForBrowserView;
  let pickup: unknown;
  context.mock.method(CampaignSession.prototype, "stepForBrowserView", function(this: CampaignSession,
    input: Parameters<CampaignSession["stepForBrowserView"]>[0]) {
    const reservation = input.reservations?.find(entry => entry.slot === 193);
    const before = reservation ? transportHostState(this.snapshot.world).slots[193] : undefined;
    const result = originalStep.call(this, input);
    if (result.ok && result.value.entry.requests.some(request => request.type === "remove-noncombat" && request.slot === 193)) {
      assert.ok(reservation);
      assert.equal(before?.generation, 0);
      assert.equal(before?.unitType, 69);
      assert.equal(before?.status, 1);
      const after = result.value.transport.slots[193]!;
      assert.equal(after.status, 10);
      assert.equal(after.health, before.health);
      pickup = { reservation, before, after, cycleCounter: result.value.cycleCounter,
        requests: result.value.entry.requests.filter(request => request.slot === 193) };
    }
    return result;
  });
  const mock = CampaignSession.prototype.stepForBrowserView as typeof originalStep & { mock: { resetCalls(): void } };
  globalThis.fetch = async input => {
    const url = String(input);
    assert.ok(url.startsWith("/assets/generated/") && !url.includes(".."));
    return new Response(readFileSync(new URL(`../../public${url}`, import.meta.url)));
  };
  let view: MissionView | undefined;
  try {
    const mission = await loadCampaignMission("alien", 2, "browser-adapted");
    const sourceHash = createHash("sha256").update(JSON.stringify(mission)).digest("hex");
    assert.equal(sourceHash, early.sourceHash);
    assert.equal(sourceHash, final.sourceHash);
    const failed = MissionView.restore(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission, final.view);
    try {
      assert.deepEqual(failed.checkpoint(), final.view);
      assert.equal(failed.simulation.snapshot.tick, 1222);
      assert.match(failed.missionDiagnostic!, /Invalid reservation unit/);
    } finally { failed.dispose(); }
    view = MissionView.restore(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission, early.view);
    assert.deepEqual(view.checkpoint(), early.view);
    await view.initialize();
    const runner = createBrowserCampaignPlaythrough(view, { resume: early.strategy, replay, maxTicks: 1500,
      deadlineMs: 180000, beforeUpdate: () => { renderer.setEnabled(false); mock.mock.resetCalls(); } });
    let boundary = runner.progress;
    while (boundary.tick < 1222 && boundary.status === "RUNNING") {
      boundary = await runner.step(Math.min(250, 1222 - boundary.tick));
    }
    assert.equal(boundary.tick, 1222);
    assert.equal(boundary.status, "RUNNING");
    assert.equal(boundary.diagnostic, null);
    const previous = replay.find(event => event.kind === "result")!.data as typeof boundary;
    for (const key of ["shots", "deaths", "purchases", "spent", "credits", "earned", "commandCount", "objective", "outcome"] as const) {
      assert.deepEqual(boundary[key], previous[key], `Original public inputs diverged: ${key}`);
    }
    const result = await runner.step(1500 - boundary.tick);
    assert.equal(result.tick, 1500);
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.diagnostic, null);
    assert.equal(result.publishedIncome - result.spent, result.credits);
    assert.ok(pickup, "Exact failing reservation must commit its same-step pickup");
    context.diagnostic(JSON.stringify({ boundary, pickup, result }));
  } finally {
    view?.dispose(); renderer.dispose(); globalThis.fetch = originalFetch;
  }
});
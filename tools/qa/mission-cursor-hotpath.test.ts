import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { MissionView } from "../../src/mission-view";
import { CampaignSession } from "../../src/engine/campaign-session";
import { commandNativeHarvest } from "../../src/engine/transport-host";
import { worldYToScreen } from "../../src/render/coordinates";
import { createBoundedHarvestFixture } from "./fixtures/bounded-harvest";

const root = new URL("../../public/assets/generated/", import.meta.url);
const canvas = () => ({ width: 512, height: 452, getContext: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) }) as unknown as HTMLCanvasElement;
const callbacks = { onStats() {}, onUnitsChanged() {} };
const stage = {} as HTMLElement;

async function fixture() {
  const mission = await createBoundedHarvestFixture(6, false,
    async url => Uint8Array.from(readFileSync(new URL(url.replace("/assets/generated/", ""), root))),
    Uint8Array.from(readFileSync(new URL("../../raw_cd/DC/SCENARIO/HUMAN/HUMAN02.PTH", import.meta.url))));
  return { ...mission, scenario: { ...mission.scenario,
    placementRows: [...mission.scenario.placementRows, [66, 48, 0, 0, 800]] } };
}

function point(view: MissionView, column: number, row = 48) {
  return { x: (column + 0.5 - view.cameraView.x) * 32,
    y: worldYToScreen(row + 0.5, view.cameraView.y + 452 / 64, 452, 32) };
}

test("native cursor last-entry cache is read-only, bounded, and invalidated by view transactions", async context => {
  const mission = await fixture();
  let view = new MissionView(canvas(), stage, callbacks, mission);
  assert.equal(view.missionDiagnostic, undefined);
  const harvester = view.simulation.resourceActors[0].simulationId;
  view.replaceSelection([harvester]);
  const snapshot = Object.getOwnPropertyDescriptor(CampaignSession.prototype, "snapshot")!.get!;
  let reads = 0;
  context.mock.getter(CampaignSession.prototype, "snapshot", function(this: CampaignSession) {
    reads++;
    return snapshot.call(this);
  });
  const cursor = (column = 69) => { const target = point(view, column); return view.cursorAt(target.x, target.y); };
  const counted = (expectedReads: number, action: () => void) => {
    reads = 0; action(); assert.equal(reads, expectedReads);
  };
  const baseline = view.checkpoint();
  counted(2, () => assert.equal(cursor(), "move"));
  counted(0, () => { for (let index = 0; index < 100; index++) assert.equal(cursor(), "move"); });
  assert.deepEqual(view.checkpoint(), baseline);
  counted(1, () => assert.equal(cursor(74), "blocked"));
  counted(0, () => assert.equal(cursor(74), "blocked"));
  counted(1, () => assert.equal(cursor(), "move"));
  counted(1, () => assert.equal(cursor(74), "blocked"));
  counted(1, () => assert.equal(cursor(), "move"));
  view.setOrderMode("move");
  counted(1, () => assert.equal(cursor(), "move"));
  view.setOrderMode("assault");
  counted(0, () => assert.equal(cursor(), "blocked"));
  view.setOrderMode("move");
  view.replaceSelection([]);
  counted(0, () => assert.equal(cursor(), "default"));
  const soldier = view.simulation.snapshot.units.find(unit => !unit.resourceActor)!;
  view.replaceSelection([harvester, soldier.id]);
  counted(0, () => assert.equal(cursor(), "blocked"));
  view.replaceSelection([harvester]);
  counted(0, () => assert.equal(cursor(), "move"));
  const screen = point(view, 69);
  view.panByCells(5, 0);
  counted(1, () => assert.equal(view.cursorAt(screen.x, screen.y), "blocked"));
  view.panByCells(-5, 0);
  counted(1, () => assert.equal(view.cursorAt(screen.x, screen.y), "move"));
  counted(0, () => assert.equal(view.cursorAt(screen.x, screen.y, true), "drag"));

  const failed = point(view, 74), beforeFailure = view.checkpoint();
  view.commandAt(failed.x, failed.y);
  assert.deepEqual(view.checkpoint().session, beforeFailure.session);
  assert.deepEqual(view.checkpoint().simulation, beforeFailure.simulation);
  counted(2, () => assert.equal(cursor(), "move"));
  view.update(0); view.update(50);
  assert.equal(view.missionDiagnostic, undefined);
  assert.equal(view.simulation.snapshot.tick, 1);
  counted(2, () => assert.equal(cursor(), "move"));
  counted(0, () => assert.equal(cursor(), "move"));

  const beforeCommand = view.campaignSnapshot!;
  const target = point(view, 69);
  const commandResource = context.mock.method(CampaignSession.prototype, "commandResource");
  view.commandAt(target.x, target.y);
  assert.equal(commandResource.mock.callCount(), 1);
  assert.equal(view.orderMode, "context");
  assert.equal(view.campaignSnapshot!.cycleCounter, beforeCommand.cycleCounter);
  assert.notDeepEqual(view.campaignSnapshot!.world, beforeCommand.world);
  const expected = () => {
    const actor = view.simulation.resourceActors[0];
    return commandNativeHarvest(view.campaignSnapshot!.world, { type: "harvest", slot: actor.slot,
      generation: actor.generation, sourceSlot: 152, target: { x: 69, y: 48 } }).ok ? "move" : "blocked";
  };
  const afterCommand = expected();
  counted(2, () => assert.equal(cursor(), afterCommand));
  counted(0, () => assert.equal(cursor(), afterCommand));
  const cycle = view.campaignSnapshot!.cycleCounter;
  view.stopSelected();
  assert.equal(commandResource.mock.callCount(), 2);
  assert.equal(view.orderMode, "context");
  assert.equal(view.campaignSnapshot!.cycleCounter, cycle);
  const afterStop = expected();
  counted(2, () => assert.equal(cursor(), afterStop));
  counted(0, () => assert.equal(cursor(), afterStop));

  const saved = JSON.parse(JSON.stringify(view.checkpoint()));
  view = MissionView.restore(canvas(), stage, callbacks, mission, saved);
  assert.deepEqual(view.checkpoint(), saved);
  counted(2, () => assert.equal(cursor(), afterStop));
  counted(0, () => assert.equal(cursor(), afterStop));
  const fresh = new MissionView(canvas(), stage, callbacks, mission);
  fresh.replaceSelection([harvester]);
  view = fresh;
  counted(2, () => assert.equal(cursor(), "move"));
});

test("native cursor source-backed startup benchmark reports timings with stable snapshot-count gates", async context => {
  const view = new MissionView(canvas(), stage, callbacks, await fixture());
  view.replaceSelection([view.simulation.resourceActors[0].simulationId]);
  const near = point(view, 68), source = point(view, 69);
  assert.equal(view.cursorAt(source.x, source.y), "move");
  const before = view.checkpoint();
  const snapshot = Object.getOwnPropertyDescriptor(CampaignSession.prototype, "snapshot")!.get!;
  let reads = 0;
  context.mock.getter(CampaignSession.prototype, "snapshot", function(this: CampaignSession) {
    reads++;
    return snapshot.call(this);
  });
  const missCount = 80, hitCount = 800;
  const coldStart = performance.now();
  for (let index = 0; index < missCount; index++) {
    const target = index % 2 ? source : near;
    assert.equal(view.cursorAt(target.x, target.y), "move");
  }
  const coldMilliseconds = (performance.now() - coldStart) / missCount;
  assert.equal(reads, missCount);
  reads = 0;
  const warmStart = performance.now();
  for (let index = 0; index < hitCount; index++) assert.equal(view.cursorAt(source.x, source.y), "move");
  const warmMilliseconds = (performance.now() - warmStart) / hitCount;
  assert.equal(reads, 0);
  assert.deepEqual(view.checkpoint(), before);
  context.diagnostic(`actual source fixture; no render/input: cold ${coldMilliseconds.toFixed(3)} ms/query, ` +
    `hit ${warmMilliseconds.toFixed(3)} ms/query, ${(coldMilliseconds / warmMilliseconds).toFixed(1)}x; ` +
    `${missCount} misses=${missCount} snapshot reads; ${hitCount} hits=0 snapshot reads`);
});
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import type { FinAnimationData } from "../../src/render/fin-animation";
import test from "node:test";
import { MissionView, missionResourceSample } from "../../src/mission-view";
import type { CampaignMissionData } from "../../src/game-data";
import { transportHostState } from "../../src/engine/transport-host";
import { worldYToScreen } from "../../src/render/coordinates";
import { createBoundedHarvestFixture, createBoundedHarvestProductionFixture } from "./fixtures/bounded-harvest";

const loadBytes = async (url: string): Promise<Uint8Array> => {
  if (url.startsWith("/assets/generated/")) return readFile(new URL(`../../public${url}`, import.meta.url));
  if (url === "/raw_cd/DC/SCENARIO/HUMAN/HUMAN02.PTH") return readFile(new URL(`../..${url}`, import.meta.url));
  throw new Error(`Unexpected bounded harvest fixture URL: ${url}`);
};
const fixture = (typeId: 6 | 14, mobileFirst = false) => createBoundedHarvestFixture(typeId, mobileFirst, loadBytes);
const clone = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value));
const canvas = () => ({ width: 512, height: 452, getContext: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) }) as unknown as HTMLCanvasElement;
const callbacks = { onStats() {}, onUnitsChanged() {} };
const stage = {} as HTMLElement;
const humanAnimation: FinAnimationData = JSON.parse(readFileSync(new URL("../../public/assets/generated/animations/EXPL.json", import.meta.url), "utf8"));
const alienAnimation: FinAnimationData = JSON.parse(readFileSync(new URL("../../public/assets/generated/animations/SLUG.json", import.meta.url), "utf8"));

function point(view: MissionView, column: number, row: number) {
  return { x: (column + 0.5 - view.cameraView.x) * 32,
    y: worldYToScreen(row + 0.5, view.cameraView.y + 452 / 64, 452, 32) };
}
function step(view: MissionView) {
  view.update((view.simulation.snapshot.tick + 1) * 50);
  assert.equal(view.missionDiagnostic, undefined);
  for (const actor of view.simulation.resourceActors) {
    const animation = actor.profile.sourceTypeIndex === 6 || actor.profile.sourceTypeIndex === 47 ? humanAnimation : alienAnimation;
    const sample = missionResourceSample(animation, actor.profile.taskOwner.state);
    assert.ok(animation.timeline[sample.timelineIndex]);
  }
}
function restore(view: MissionView, mission: CampaignMissionData) {
  const saved = clone(view.checkpoint());
  const restored = MissionView.restore(canvas(), stage, callbacks, mission, saved);
  assert.deepEqual(restored.checkpoint(), saved);
  restored.update(restored.simulation.snapshot.tick * 50);
  return restored;
}

for (const typeId of [6, 14] as const) for (const mobileFirst of [false, true]) {
  test(`actual player Harvest type${typeId} mobileFirst=${mobileFirst}: move, earn, Stop, restore, move again`, async () => {
    const mission = await fixture(typeId, mobileFirst);
    let view = new MissionView(canvas(), stage, callbacks, mission);
    assert.equal(view.missionDiagnostic, undefined);
    assert.equal(view.resourceWorkflow.harvestEnabled, true);
    assert.equal(view.resourceWorkflow.credits[0], 0);
    const id = view.selectedId, source = view.resourceSources[0];
    assert.equal(source.owner, 8);
    assert.equal(view.simulation.snapshot.units.find(unit => unit.id === id)!.resourceActor!.owner, "resource");
    const far = point(view, 74, 48), target = point(view, 69, 48);
    assert.equal(view.cursorAt(far.x, far.y), "blocked");
    const before = view.checkpoint();
    view.commandAt(far.x, far.y);
    assert.deepEqual(view.checkpoint().session, before.session);
    assert.deepEqual(view.checkpoint().simulation, before.simulation);
    assert.equal(view.missionDiagnostic, undefined);
    assert.equal(view.cursorAt(target.x, target.y), "move", view.resourceWorkflow.diagnostic);
    view.commandAt(target.x, target.y);
    assert.equal(view.simulation.snapshot.units.find(unit => unit.id === id)!.activity, "move", view.resourceWorkflow.diagnostic);
    view = restore(view, mission);
    const phases = new Set<string>();
    for (let tick = 0; tick < 120; tick++) {
      step(view);
      const actor = view.simulation.resourceActors[0];
      const phase = actor.profile.taskOwner.state.nativeMovement ? "moving" : actor.profile.task;
      if (!phases.has(phase)) { phases.add(phase); view = restore(view, mission); }
      if (view.resourceWorkflow.credits[0] >= 44) break;
    }
    assert.ok(phases.has("moving") && phases.has("idle") && phases.has("extraction"));
    assert.equal(view.simulation.resourceActors[0].simulationId, id);
    assert.ok(view.resourceWorkflow.credits[0] >= 44);
    assert.equal(view.resourceWorkflow.credits[0], view.campaignSnapshot!.world.statistics["0,1"]);
    assert.ok(view.resourceSources[0].health < 12000);
    assert.equal(view.simulation.resourceActors[0].profile.sourceTypeIndex, typeId === 6 ? 47 : 48);
    view.stopSelected();
    for (let tick = 0; tick < 100 && view.simulation.resourceActors[0].owner !== "simulation"; tick++) {
      step(view);
      if (view.simulation.resourceActors[0].profile.task === "retraction" && !phases.has("retraction")) {
        phases.add("retraction"); view = restore(view, mission);
      }
    }
    assert.equal(view.simulation.resourceActors[0].owner, "simulation");
    view = restore(view, mission);
    const next = point(view, 68, 48);
    view.commandAt(next.x, next.y);
    assert.equal(view.simulation.snapshot.units.find(unit => unit.id === id)!.activity, "move", view.resourceWorkflow.diagnostic);
    view = restore(view, mission);
    for (let tick = 0; tick < 35; tick++) step(view);
    const actor = view.simulation.resourceActors[0];
    assert.equal(actor.profile.xQ8 >> 8, 68);
    assert.equal(actor.profile.taskOwner.state.nativeIdle!.randomIndex, 0);
    assert.equal(transportHostState(view.campaignSnapshot!.world).slots[actor.slot]!.key, actor.key);
  });
}

for (const typeId of [6, 14] as const) test(`type${typeId}: earned native income funds existing base purchase, no grants`, async () => {
  const mission = await createBoundedHarvestProductionFixture(typeId, false, loadBytes);
  let view = new MissionView(canvas(), stage, callbacks, mission);
  assert.equal(view.missionDiagnostic, undefined);
  assert.equal(view.resourceWorkflow.credits[0], 0);
  const choice = view.productionMenu[0];
  assert.ok(choice && choice.cost > 0);
  assert.equal(view.purchaseProduction(choice.dependency), false);
  assert.equal(view.harvestSelected(view.resourceSources[0].slot), true, view.resourceWorkflow.diagnostic);
  view.update(0);
  for (let tick = 0; tick < 1000 && view.resourceWorkflow.credits[0] < choice.cost; tick++) step(view);
  assert.ok(view.resourceWorkflow.credits[0] >= choice.cost);
  const credits = view.resourceWorkflow.credits[0], income = view.campaignSnapshot!.world.statistics["0,1"];
  assert.equal(credits, income);
  assert.equal(view.purchaseProduction(choice.dependency), true);
  view = restore(view, mission);
  step(view);
  const earnedDuringPurchase = view.campaignSnapshot!.world.statistics["0,1"] - income;
  assert.equal(view.resourceWorkflow.credits[0], credits + earnedDuringPurchase - choice.cost);
  assert.equal(view.productionMenu[0].queued, 1);
  assert.equal(view.campaignSnapshot!.world.statistics["0,1"], income + earnedDuringPurchase);
  restore(view, mission);
});

test("Stop during native movement remains queued until actual native wait point and survives restore", async () => {
  const mission = await fixture(6);
  let view = new MissionView(canvas(), stage, callbacks, mission);
  assert.equal(view.harvestSelected(view.resourceSources[0].slot), true);
  view.update(0);
  step(view); step(view);
  view.stopSelected();
  assert.equal(view.simulation.resourceActors[0].profile.taskOwner.state.nativeMovement!.state.order, 13);
  view = restore(view, mission);
  for (let tick = 0; tick < 50 && view.simulation.resourceActors[0].owner !== "simulation"; tick++) step(view);
  assert.equal(view.simulation.resourceActors[0].owner, "simulation");
  assert.equal(view.resourceWorkflow.credits[0], 0);
  restore(view, mission);
});

test("late resource frame failure leaves view/session/simulation graphs unchanged", async () => {
  const mission = await fixture(6);
  (mission.scenario.placementRows as number[][]).push([66, 48, 0, 0, 800]);
  const view = new MissionView(canvas(), stage, callbacks, mission);
  const soldier = view.simulation.snapshot.units.find(unit => !unit.resourceActor)!;
  view.replaceSelection([soldier.id]);
  view.setOrderMode("move");
  const destination = point(view, 66, 49);
  view.commandAt(destination.x, destination.y);
  assert.equal(view.checkpoint().combatMovement.intents.length, 1);
  view.replaceSelection([view.simulation.resourceActors[0].simulationId]);
  assert.equal(view.harvestSelected(view.resourceSources[0].slot), true);
  view.update(0);
  const before = view.checkpoint();
  (mission.sourceResource!.resourceFrameSource.aiMultipliers as number[]).pop();
  view.update(50);
  assert.match(view.missionDiagnostic!, /eight|side|multipliers/i);
  const after = view.checkpoint();
  assert.deepEqual(after.simulation, before.simulation);
  assert.deepEqual(after.session, before.session);
  assert.deepEqual(after.combatMovement, before.combatMovement);
  assert.deepEqual({ ...after.state, diagnostic: null }, before.state);
});

test("successful native Move and Stop return to context selection", async () => {
  const mission = await fixture(6);
  (mission.scenario.placementRows as number[][]).push([66, 48, 0, 0, 800]);
  const view = new MissionView(canvas(), stage, callbacks, mission);
  const harvester = view.simulation.resourceActors[0].simulationId;
  const soldier = view.simulation.snapshot.units.find(unit => !unit.resourceActor)!;
  view.replaceSelection([harvester]);
  view.setOrderMode("move");
  const source = point(view, 69, 48);
  view.commandAt(source.x, source.y);
  assert.equal(view.orderMode, "context");
  const friendly = point(view, soldier.cellX, soldier.cellY);
  assert.equal(view.cursorAt(friendly.x, friendly.y), "select");
  view.commandAt(friendly.x, friendly.y);
  assert.deepEqual(view.selectedIds, [soldier.id]);
  view.replaceSelection([harvester]);
  view.setOrderMode("move");
  view.stopSelected();
  assert.equal(view.orderMode, "context");
});

test("native movement restore rejects raw, profile and cross-graph tampering", async () => {
  const mission = await fixture(14);
  const view = new MissionView(canvas(), stage, callbacks, mission);
  assert.equal(view.harvestSelected(view.resourceSources[0].slot), true);
  const saved = clone(view.checkpoint());
  for (const mutate of [
    (value: typeof saved) => { (value.session!.state.world.transportState.slots[153]!.resourceTask!.nativeMovement!.state.raw as number[])[0]++; },
    (value: typeof saved) => { (value.session!.state.world.transportState.slots[153]!.resourceTask!.nativeMovement!.world as { pthSha256: string }).pthSha256 = "forged"; },
    (value: typeof saved) => { value.state.unitStats.find(entry => entry.id === view.selectedId)!.type = 6; },
  ]) {
    const bad = clone(saved); mutate(bad);
    assert.throws(() => MissionView.restore(canvas(), stage, callbacks, mission, bad));
  }
  assert.deepEqual(view.checkpoint(), saved);
});

test("occupied native route returns a command diagnostic without claiming another owner or killing the mission", async () => {
  const source = await fixture(6);
  const mission: CampaignMissionData = { ...source, scenario: { ...source.scenario,
    placementRows: [...source.scenario.placementRows, [68, 48, 0, 0, 100]] } };
  const view = new MissionView(canvas(), stage, callbacks, mission);
  assert.equal(view.missionDiagnostic, undefined);
  view.selectUnit(view.simulation.resourceActors[0].simulationId);
  const before = view.checkpoint();
  const target = point(view, 69, 48);
  assert.equal(view.cursorAt(target.x, target.y), "blocked");
  assert.equal(view.harvestSelected(view.resourceSources[0].slot), false);
  assert.match(view.resourceWorkflow.diagnostic, /blocked|occupancy/);
  assert.equal(view.missionDiagnostic, undefined);
  assert.deepEqual(view.checkpoint().session, before.session);
  assert.deepEqual(view.checkpoint().simulation, before.simulation);
});

test("Stop while already in the destination cell still acknowledges native release", async () => {
  const mission = await fixture(6);
  const view = new MissionView(canvas(), stage, callbacks, mission);
  assert.equal(view.harvestSelected(view.resourceSources[0].slot), true);
  view.update(0);
  for (let tick = 0; tick < 40 && (view.simulation.resourceActors[0].profile.xQ8 >> 8) !== 69; tick++) step(view);
  assert.ok(view.simulation.resourceActors[0].profile.taskOwner.state.nativeMovement);
  view.stopSelected();
  for (let tick = 0; tick < 30 && view.simulation.resourceActors[0].owner !== "simulation"; tick++) step(view);
  assert.equal(view.simulation.resourceActors[0].owner, "simulation");
  restore(view, mission);
  for (let tick = 0; tick < 40; tick++) step(view);
  assert.equal(view.simulation.resourceActors[0].owner, "resource");
  assert.equal(view.simulation.resourceActors[0].profile.taskOwner.state.nativeIdle!.randomIndex, 0);
  restore(view, mission);
});

for (const typeId of [6, 14] as const) test(`source constructor type${typeId} uses original heading, stats and no attack weapon`, async () => {
  const source = await fixture(typeId), config = source.sourceResource!.resourceLifecycle.nativeHarvest!;
  const binding = config.bindings[0], raw = [...binding.raw];
  raw[9] = typeId === 6 ? 160 : 128;
  const mission: CampaignMissionData = { ...source, sourceResource: { ...source.sourceResource!,
    resourceLifecycle: { ...source.sourceResource!.resourceLifecycle,
      nativeHarvest: { ...config, bindings: [{ ...binding, raw, provenance: "constructor" }] } } } };
  const view = new MissionView(canvas(), stage, callbacks, mission);
  assert.equal(view.missionDiagnostic, undefined);
  const actor = view.simulation.resourceActors[0];
  assert.equal(actor.profile.taskOwner.state.direction, typeId === 6 ? 160 : 128);
  assert.equal(actor.profile.health, 800);
  assert.equal(actor.profile.weapon, null);
  assert.equal(view.harvestSelected(view.resourceSources[0].slot), true, view.resourceWorkflow.diagnostic);
  restore(view, mission);
});

test("labeled near-depletion low-HP fixture retains task10 until native unregister and restores removed identity", async () => {
  const source = await fixture(6), config = source.sourceResource!.resourceLifecycle.nativeHarvest!;
  const raw = Uint8Array.from(config.bindings[0].raw);
  new DataView(raw.buffer).setInt32(12, 270, true);
  const mission: CampaignMissionData = { ...source, scenario: { ...source.scenario,
    id: "SourceSeparated-near-depletion-lowHP", placementRows: [[69, 48, 40, 22, 22], [67, 48, 6, 0, 270]] },
    sourceResource: { ...source.sourceResource!, resourceLifecycle: { ...source.sourceResource!.resourceLifecycle,
      nativeHarvest: { ...config, evidence: `${config.evidence}; explicit near-depletion reserve22/HP270 fixture`,
        bindings: [{ ...config.bindings[0], raw: [...raw] }] } } } };
  let view = new MissionView(canvas(), stage, callbacks, mission);
  assert.equal(view.missionDiagnostic, undefined);
  const id = view.selectedId;
  assert.equal(view.harvestSelected(view.resourceSources[0].slot), true);
  view.update(0);
  let removalChecked = false;
  for (let tick = 0; tick < 300 && view.simulation.resourceActors[0].owner !== "removed"; tick++) {
    step(view);
    if (view.simulation.resourceActors[0].profile.task === "removal" && !removalChecked) {
      removalChecked = true;
      assert.equal(view.simulation.resourceActors[0].owner, "resource");
      assert.ok(view.simulation.snapshot.units.some(unit => unit.id === id));
      view = restore(view, mission);
    }
  }
  assert.ok(removalChecked);
  assert.equal(view.simulation.resourceActors[0].owner, "removed");
  assert.equal(view.simulation.snapshot.units.some(unit => unit.id === id), false);
  assert.equal(view.simulation.resourceActors[0].profile.taskWords[0], 150);
  assert.equal(view.campaignSnapshot!.world.statistics["0,3"], 0);
  restore(view, mission);
});
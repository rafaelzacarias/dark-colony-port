import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MissionView } from "../../src/mission-view";
import { nativeConstructionRegisteredSlots } from "../../src/engine/native-construction-host";
import { transportHostState } from "../../src/engine/transport-host";
import type { SourceConstructionFrame, SourceConstructionMission } from "../../src/engine/source-construction-options";
import { createScienceConstructionFixture, loadScienceNativeInput,
  scienceConstructionObserverFixtureLabel } from "./fixtures/science-construction";

const loadBytes = (url: URL) => readFileSync(url);
const canvas = () => ({ width: 512, height: 452, getContext: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) }) as unknown as HTMLCanvasElement;
const stage = {} as HTMLElement, callbacks = { onStats() {}, onUnitsChanged() {} };
const create = (data: SourceConstructionMission) => {
  const view = new MissionView(canvas(), stage, callbacks, data);
  assert.equal(view.missionDiagnostic, undefined);
  return view;
};

function input(view: MissionView, science = false): SourceConstructionFrame {
  const state = view.campaignSnapshot!, ai = state.campaignAi!, buffers = ai.buffers;
  return { constructionVisits: state.production!.constructionHosts!.filter(host => host.receiptId && !host.ready).map(host => ({
    team: host.configuration.team, visit: { sequence: host.visits, counter: 4, mainHealth: 2400,
      auxiliaryHealth: host.actors[6]?.health ?? 0, registeredSlots: nativeConstructionRegisteredSlots(host) } })),
    ...(science ? { campaignAiRequest: { id: "observer-science", sourceId: ai.sourceId, sequence: ai.history.length,
      stage: "demand" as const, observation: { entities: buffers.entities, forceOrder: buffers.forceOrder,
        population: 6, populationLimit: 10, relations: buffers.relations,
        visibilityMasks: buffers.visibilityMasks, occupancy: buffers.occupancy } } } : {}) };
}

for (const race of [0, 1] as const) test(`optional science observer race ${race}: paid CITY, sight, rollback and restore`, async () => {
  const nativeInput = await loadScienceNativeInput(loadBytes);
  const golden = nativeInput.cases.find(candidate => candidate.race === race)!;
  const baseline = await createScienceConstructionFixture(race, nativeInput, loadBytes);
  const disabled = await createScienceConstructionFixture(race, nativeInput, loadBytes, { observer: false });
  assert.deepEqual(disabled, baseline);
  assert.equal(baseline.scenario.placementRows.length, 6);
  assert.deepEqual(baseline.sourceConstruction!.campaignAi!.initial.entities, golden.aiBefore.entities);
  assert.equal(create(baseline).visibility[32 * 128 + 34], 0);
  assert.match(scienceConstructionObserverFixtureLabel, /optional local team 0 observer/);
  assert.match(scienceConstructionObserverFixtureLabel, /not original mission admission/);

  const data = await createScienceConstructionFixture(race, nativeInput, loadBytes, { observer: true });
  assert.deepEqual(golden.aiBefore.entities, baseline.sourceConstruction!.campaignAi!.initial.entities);
  assert.deepEqual(data.scenario.placementRows.slice(0, 6), baseline.scenario.placementRows);
  assert.deepEqual(data.scenario.placementRows[6], [34, 37, 0, 0, data.units[0].health]);
  assert.deepEqual(data.sourceProduction, baseline.sourceProduction);
  const view = create(data), world = view.campaignSnapshot!.world;
  const initial = data.sourceConstruction!.campaignAi!.initial;
  const observerSlot = world.entities.find(entity => entity.sourceRow === 6 && entity.team === 0)!.rawSlot!;
  const observerOffset = observerSlot * 220;
  assert.deepEqual(initial.entities.slice(observerOffset, observerOffset + 220),
    Array.from(world.entityBytes!.slice(observerOffset, observerOffset + 220)));
  assert.deepEqual(initial.entities.slice(0, observerOffset), golden.aiBefore.entities.slice(0, observerOffset));
  assert.deepEqual(initial.entities.slice(observerOffset + 220), golden.aiBefore.entities.slice(observerOffset + 220));
  assert.deepEqual(initial.occupancy, transportHostState(world).ground.map(slot => slot < 0 ? 1023 : slot));
  assert.deepEqual(initial.policy, golden.aiBefore.policy);
  assert.equal(initial.population, 6);
  assert.equal(world.exomoney[1], 6000);
  const owned = view.simulation.snapshot.units.filter(unit => view.isOwnedUnit(unit.id));
  assert.equal(owned.length, 1);
  const observer = owned[0];
  assert.deepEqual([observer.cellX, observer.cellY, observer.health], [34, 37, data.units[0].health]);
  assert.ok(view.visibility[32 * 128 + 34], "normal local source sight reveals CITY");

  view.advanceConstruction(input(view, true));
  assert.equal(view.campaignJournal.at(-1)!.campaignAiReceipt!.selectedRule, 5);
  assert.equal(view.campaignSnapshot!.world.exomoney[1], 4000);
  const binding = view.nativeBindings.find(candidate => candidate.slot === 18)!;
  assert.ok(binding, "paid science must bind actual CITY slot 18");
  assert.ok(view.simulation.snapshot.staticTargets.some(target => target.id === binding.simulationId && target.health === 2400));
  const beforeMissingVisit = JSON.parse(JSON.stringify(view.checkpoint()));
  assert.throws(() => view.advanceConstruction({ constructionVisits: [] }), /construction|CITY/i);
  assert.deepEqual(view.checkpoint(), beforeMissingVisit);
  view.advanceConstruction(input(view));
  assert.equal(view.constructionMenu[0].visits, 1);
  assert.ok(view.constructionVisuals.length > 0);
  assert.ok(view.visibility[32 * 128 + 34], "render visibility still reveals CITY after its visit");
  assert.deepEqual(view.simulation.snapshot.units.find(unit => unit.id === observer.id), observer);

  const saved = JSON.parse(JSON.stringify(view.checkpoint()));
  const restored = MissionView.restore(canvas(), stage, callbacks, data, saved);
  assert.deepEqual(restored.checkpoint(), saved);
  assert.deepEqual(restored.constructionVisuals, view.constructionVisuals);
  assert.deepEqual(restored.visibility, view.visibility);
  restored.advanceConstruction(input(restored));
  assert.equal(restored.constructionMenu[0].visits, 2);
  assert.equal(restored.campaignSnapshot!.world.exomoney[1], 4000);
});
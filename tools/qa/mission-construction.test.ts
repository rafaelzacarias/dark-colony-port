import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cityProof } from "./campaign-session-city-raw.test";
import { createScienceConstructionFixture } from "./fixtures/science-construction";
import { MissionView, missionAnimationArchives, missionVisualSprites } from "../../src/mission-view";
import { sourceConstructionSample, type SourceConstructionMission } from "../../src/engine/source-construction-options";
import { nativeConstructionRegisteredSlots } from "../../src/engine/native-construction-host";
import { parseTriggerScript } from "../extractors/data/triggers";
import type { FinAnimationData } from "../../src/render/fin-animation";

const root = new URL("../../public/assets/generated/", import.meta.url);
const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const canvas = () => ({ width: 512, height: 452, getContext: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) }) as unknown as HTMLCanvasElement;
const stage = {} as HTMLElement, callbacks = { onStats() {}, onUnitsChanged() {} };
const create = (mission: SourceConstructionMission) => {
  const view = new MissionView(canvas(), stage, callbacks, mission);
  assert.equal(view.missionDiagnostic, undefined);
  return view;
};

const fixture = (golden: any) => createScienceConstructionFixture(golden.race, cityProof, url => readFileSync(url));

function input(view: MissionView, science = false) {
  const state = view.campaignSnapshot!, ai = state.campaignAi!, buffers = ai.buffers;
  return { constructionVisits: state.production!.constructionHosts!.filter(host => host.receiptId && !host.ready).map(host => ({
    team: host.configuration.team, visit: { sequence: host.visits, counter: 4, mainHealth: 2400,
      auxiliaryHealth: host.actors[6]?.health ?? 0, registeredSlots: nativeConstructionRegisteredSlots(host) } })),
    ...(science ? { campaignAiRequest: { id: "science", sourceId: ai.sourceId, sequence: ai.history.length,
      stage: "demand" as const, observation: { entities: buffers.entities, forceOrder: buffers.forceOrder,
        population: 6, populationLimit: 10, relations: buffers.relations,
        visibilityMasks: buffers.visibilityMasks, occupancy: buffers.occupancy } } } : {}) };
}

function animation(sprite: string): FinAnimationData {
  const states: FinAnimationData["states"][number][] = [], timeline: FinAnimationData["timeline"][number][] = [];
  for (const name of missionAnimationArchives(sprite)) {
    const data = json(`animations/${name}.json`), offset = timeline.length;
    states.push(...data.states.map((state: any) => ({ ...state, firstTimelineIndex: state.firstTimelineIndex + offset,
      lastTimelineIndex: state.lastTimelineIndex + offset })));
    timeline.push(...data.timeline);
  }
  return { states, timeline };
}

for (const golden of cityProof.cases) test(`source-bound science fixture race ${golden.race}: real paid session, static projection, FIN and restore`, async () => {
  const data = await fixture(golden), view = create(data);
  assert.equal(view.constructionMenu[0].requestEnabled, false);
  assert.ok(missionVisualSprites(data).includes(golden.race === 0 ? "SCNCPOD" : "MINDHIV"));
  view.update(0); view.update(1000);
  assert.equal(view.simulation.snapshot.tick, 0, "wall clock is not a native construction visit");
  view.advanceConstruction(input(view, true));
  assert.equal(view.campaignJournal.at(-1)!.campaignAiReceipt!.selectedRule, 5);
  assert.equal(view.campaignSnapshot!.world.exomoney[1], 4000);
  const binding = view.nativeBindings.find(binding => binding.slot === 18)!;
  const mainArt = animation(golden.race === 0 ? "SCNCPOD" : "MINDHIV");
  const auxiliaryArt = animation(golden.race === 0 ? "DROP" : "SAUC");
  for (const [index, expected] of golden.trace.entries()) {
    if (index) view.advanceConstruction(input(view));
    const city = view.campaignSnapshot!.production!.constructionHosts![0];
    const target = view.simulation.snapshot.staticTargets.find(target => target.id === binding.simulationId)!;
    assert.equal(target.health, 2400);
    const mainBytes = Buffer.from(expected.main.raw);
    const auxiliaryBytes = Buffer.from(expected.auxiliary.raw);
    assert.deepEqual([target.xSubcells, target.ySubcells], [mainBytes.readUInt16LE(0) * 4, mainBytes.readUInt16LE(4) * 4]);
    assert.equal(view.simulation.checkpoint().staticTargets.find(target => target.id === binding.simulationId)!.sourceDefense!.sourceTypeIndex,
      golden.race === 0 ? 20 : 32);
    for (const cell of city.footprint) assert.equal(view.grid.isPassable(cell.x, cell.y), false);
    assert.equal(view.nativeBindings.some(binding => binding.slot === 21), false);
    for (const actor of view.constructionVisuals) {
      const sample = sourceConstructionSample(actor.team === 8 ? auxiliaryArt : mainArt, actor);
      assert.equal(sample.finished, actor.animation.mode === 2);
      assert.equal(actor.position.height, actor.team === 8 ? auxiliaryBytes.readUInt16LE(2) : mainBytes.readUInt16LE(2));
      if (actor.team === 8) assert.equal(actor.generation, Number(actor.departing));
    }
    if ([20, 70, golden.trace.length - 1].includes(index)) {
      const saved = JSON.parse(JSON.stringify(view.checkpoint()));
      const restored = MissionView.restore(canvas(), stage, callbacks, data, saved);
      assert.deepEqual(restored.checkpoint(), saved);
      assert.deepEqual(restored.constructionVisuals, view.constructionVisuals);
      if (!city.ready) {
        restored.advanceConstruction(input(restored));
        assert.equal(restored.constructionMenu[0].visits, city.visits + 1);
      }
    }
  }
  assert.equal(view.constructionMenu[0].status, "complete");
  assert.equal(view.constructionMenu[0].requestEnabled, false);
});

test("source-bound science rejects missing visits and late TRO atomically", async () => {
  const data = await fixture(cityProof.cases[0]), view = create(data);
  view.advanceConstruction(input(view, true));
  const before = view.checkpoint();
  assert.throws(() => view.advanceConstruction({ constructionVisits: [] }), /construction|CITY/i);
  assert.deepEqual(view.checkpoint(), before);
  const late = create({ ...data, triggers: parseTriggerScript("1 norm 1 (c==0)\nmsg 2 0 29 3 8\nend") });
  for (let index = 0; index < 7; index++) late.advanceConstruction(input(late));
  const pristine = late.checkpoint();
  assert.throws(() => late.advanceConstruction(input(late, true)), /message/i);
  assert.deepEqual(late.checkpoint(), pristine);
});
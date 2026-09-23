import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MissionView, missionResourceSample } from "../../src/mission-view";
import { loadCampaignResourceOptions, type CampaignMissionData } from "../../src/game-data";
import { createCampaignSession } from "../../src/engine/campaign-session";
import { sourceHarvesterConstructorBinding } from "../../src/engine/source-resource-options";
import { transportHostState } from "../../src/engine/transport-host";
import type { WebAudioManager } from "../../src/audio";

const root = new URL("../../public/assets/generated/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const json = (path: string) => JSON.parse(read(path).toString());
const canvas = () => ({ width: 512, height: 452, getContext: () => null }) as unknown as HTMLCanvasElement;
const stage = {} as HTMLElement;
const callbacks = { onStats() {}, onUnitsChanged() {} };
const copy = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value));

function original(faction: "human" | "alien"): CampaignMissionData {
  const prefix = faction.toUpperCase(), stem = `${prefix}/${prefix}02`, map = json(`maps/${stem}.json`);
  const words = (path: string) => {
    const bytes = read(path);
    return Uint16Array.from({ length: bytes.length / 2 }, (_, index) => bytes.readUInt16LE(index * 2));
  };
  return { faction, map, scenario: json(`data/scenarios/${stem}.json`),
    triggers: json(`data/triggers/${stem}.json`).blocks, messages: json(`data/messages/${stem}.json`).messages,
    briefing: json(`data/briefings/${stem}.json`), units: json("data/units.json").records,
    weapons: json("data/weapons.json").records, damageMatrix: json("data/damage-matrix.json").coefficients,
    terrain: json(`terrain/${map.terrainBank.split(".")[0].toUpperCase()}.json`), terrainAtlasUrl: "unused-in-node",
    tileReferences: words(`maps/${prefix}/${map.files.tileReferences}`),
    tileRecordIndices: words(`maps/${prefix}/${map.files.tileRecordIndices}`),
    attributes: words(`maps/${prefix}/${map.files.attributes}`),
    pathGrid: Uint8Array.from(read(`maps/${prefix}/${map.files.pathGrid}`)),
    tags: Uint8Array.from(read(`maps/${prefix}/${map.files.tags}`)) };
}

async function fixture(faction: "human" | "alien"): Promise<CampaignMissionData> {
  const mission = original(faction);
  const resource = await loadCampaignResourceOptions({ ...mission, triggers: [] },
    async (url) => read(url.replace("/assets/generated/", "")));
  const placementRows = mission.scenario.placementRows.filter((row) => row[2] === 40);
  return { ...mission, triggers: [], scenario: { ...mission.scenario, placementRows, rawScenario: undefined,
    source: { path: "FIXTURE-ISOLATED-VENT", sha256: "fixture-not-original-mission" } },
    sourceResource: { ...resource, resourceLifecycle: { ...resource.resourceLifecycle,
      bindings: resource.resourceLifecycle.bindings.map((binding, index) => ({ ...binding, slot: 152 + index })) } } };
}

function create(mission: CampaignMissionData, audio?: WebAudioManager) {
  return new MissionView(canvas(), stage, callbacks, mission, audio);
}

function step(view: MissionView, count = 1) {
  for (let index = 0; index < count; index += 1) {
    view.update((view.simulation.snapshot.tick + 1) * 50);
    assert.equal(view.missionDiagnostic, undefined);
  }
}

for (const faction of ["human", "alien"] as const) {
  test(`${faction}: unchanged mission02 AI still fails preflight`, () => {
    const mission = original(faction), view = create(mission);
    assert.deepEqual(JSON.parse(view.missionDiagnostic!),
      [`TRO ${faction === "human" ? 17 : 0}: ai: native policy scheduling owner required`]);
    assert.equal(view.campaignSnapshot, null);
    assert.equal(view.resourceWorkflow.harvestEnabled, false);
    assert.deepEqual(view.resourceSources, []);
  });

  test(`${faction}: labeled source-only fixture keeps neutral VENT outside combat and replays source clock/tasks`, async () => {
    const mission = await fixture(faction), view = create(mission);
    assert.equal(view.missionDiagnostic, undefined);
    assert.equal(mission.sourceResource!.evidence.executableSha256,
      "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
    assert.equal(mission.sourceResource!.evidence.scenarioSha256, original(faction).scenario.source.sha256);
    assert.equal(view.resourceSources.length, mission.scenario.placementRows.length);
    assert.ok(view.resourceSources.every((source) => source.owner === 8 && source.task?.stack[0].opcode === 1));
    assert.ok(view.resourceSources.every((source) => !view.nativeBindings.some((binding) => binding.key === source.key)));
    assert.equal(view.simulation.snapshot.units.length, 0);
    assert.ok(view.simulation.snapshot.staticTargets.every((target) => target.team !== 8));
    assert.equal(view.resourceWorkflow.harvestEnabled, false);
    assert.match(view.resourceWorkflow.diagnostic, /movement-finished\/idle.*6\/14/);
    view.update(0);
    step(view, 17);
    const saved = copy(view.checkpoint());
    assert.ok(saved.session);
    assert.deepEqual(saved.session.options.resourceScales, { rateScale: 256, reserveScale: 256 });
    assert.deepEqual(saved.session.options.resourceInitialIncome, Array(8).fill(0));
    const restored = MissionView.restore(canvas(), stage, callbacks, mission, saved);
    assert.deepEqual(restored.checkpoint(), saved);
    restored.update(restored.simulation.snapshot.tick * 50);
    for (let index = 0; index < 32; index += 1) {
      step(view); step(restored);
      assert.deepEqual(restored.resourceSources, view.resourceSources);
      assert.deepEqual(restored.resourceWorkflow, view.resourceWorkflow);
      assert.deepEqual(restored.campaignJournal.at(-1), view.campaignJournal.at(-1));
    }
    const { sourceDayNight: _clock, ...clockless } = saved.session.state;
    assert.throws(() => MissionView.restore(canvas(), stage, callbacks, mission,
      { ...saved, session: { ...saved.session, state: clockless } }), /clock/);
    const mutated = copy(saved);
    assert.ok(mutated.session?.options.resourceLifecycle);
    mutated.session.options.resourceLifecycle.bindings[0].state.stack[0].words[1] = 1;
    assert.throws(() => MissionView.restore(canvas(), stage, callbacks, mission, mutated), /source\/options/);
    const projection = view.resourceSources;
    Object.assign(projection[0].position, { x: 0 });
    projection[0].task!.stack[0].words[0] = 0;
    assert.notDeepEqual(view.resourceSources[0], projection[0]);
  });

  test(`${faction}: labeled same-tile constructor/extractor fixture is rejected by LIVE external-owner gate`, async () => {
    const mission = await fixture(faction), resource = mission.sourceResource!;
    const sourceIndex = mission.scenario.placementRows.findIndex((row) => row[3] > 0);
    const row = mission.scenario.placementRows[sourceIndex], mobileType = faction === "human" ? 6 : 14;
    const boundMission: CampaignMissionData = { ...mission,
      scenario: { ...mission.scenario, placementRows: [row, [row[0], row[1], mobileType, 0, 800]] },
      sourceResource: { ...resource, resourceLifecycle: { ...resource.resourceLifecycle, bindings: [
        { ...resource.resourceLifecycle.bindings[sourceIndex], slot: 152 },
        { slot: 153, generation: 0, state: { direction: faction === "human" ? 160 : 128,
          animation: { profile: faction === "human" ? "EXPLSTAND" : "SLUGSTAND", frame: 0, delay: 0, mode: 0 },
          pendingOrder: 0, order: 0, released: false, stack: [{ opcode: 1, words: [65535, 0, 0] }] } },
      ] } } };
    const blocked = create(boundMission);
    assert.match(blocked.missionDiagnostic!, /Resource actor admission blocked/);
    const savedOptions = blocked.checkpoint().session!.options;
    const options = { ...savedOptions, pathGrid: Uint8Array.from(savedOptions.pathGrid), tags: Uint8Array.from(savedOptions.tags) };
    const sessionResult = createCampaignSession(options);
    assert.ok(sessionResult.ok);
    if (!sessionResult.ok) return;
    const session = sessionResult.value;
    const unbound = createCampaignSession({ ...options, resourceLifecycle: undefined });
    assert.ok(unbound.ok);
    if (!unbound.ok) return;
    assert.deepEqual(sourceHarvesterConstructorBinding(unbound.value.snapshot.world,
      boundMission.sourceResource!.resourceLifecycle.bindings[1]), boundMission.sourceResource!.resourceLifecycle.bindings[1]);
    for (let update = 1; update <= 48; update += 1) {
      const frame = session.step({ clockMilliseconds: update * 50, resourceFrameSource: resource.resourceFrameSource });
      assert.ok(frame.ok, JSON.stringify(frame));
    }
    assert.equal(transportHostState(session.snapshot.world).slots[153]!.unitType, faction === "human" ? 47 : 48);
    assert.ok(session.snapshot.world.statistics["0,1"] > 0);
    assert.equal(session.snapshot.world.exomoney[0], mission.scenario.teams[0].money + session.snapshot.world.statistics["0,1"]);
    assert.equal(blocked.simulation.snapshot.tick, 0, "blocked view never ran a synthetic harvest loop");
    for (const damageMatrix of [boundMission.damageMatrix, undefined]) {
      const unboundView = create({ ...boundMission, damageMatrix, sourceResource: { ...boundMission.sourceResource!,
        resourceLifecycle: { ...boundMission.sourceResource!.resourceLifecycle,
          bindings: [boundMission.sourceResource!.resourceLifecycle.bindings[0]] } } });
      assert.match(unboundView.missionDiagnostic!, /Resource actor admission blocked/);
      assert.equal(unboundView.simulation.snapshot.units.length, 0, "no generic combat/harvest fallback without certification");
    }
  });
}

test("committed XTR1 eruption uses catalog sound183 once, nonspatial, without replay on restore", async () => {
  const mission = await fixture("human"), row = mission.scenario.placementRows.find((entry) => entry[3] === 0)!;
  const sounds: unknown[] = [];
  const audio = { play: (cue: unknown) => { sounds.push(cue); return Promise.resolve(); } } as unknown as WebAudioManager;
  const data = { ...mission, triggers: [{ id: 0, mode: "norm" as const, flag: 1, condition: "(1)",
    actions: [{ name: "newrate", arguments: [22, row[0], row[1]] }] }] };
  const view = create(data, audio);
  assert.equal(view.missionDiagnostic, undefined);
  view.update(0); step(view, 8);
  assert.deepEqual(sounds, [{ assetId: "SOUND/ERUPT.WAV", priority: 40 }]);
  const restored = MissionView.restore(canvas(), stage, callbacks, data, copy(view.checkpoint()), audio);
  restored.update(restored.simulation.snapshot.tick * 50); step(restored, 4);
  assert.equal(sounds.length, 1);
  const source = view.resourceSources[0];
  const animation = json("animations/VENT.json");
  const sample = missionResourceSample(animation, source.task!);
  assert.deepEqual(sample.children, animation.timeline[sample.timelineIndex].children);
  assert.throws(() => missionResourceSample(animation, { ...source.task!, animation: { ...source.task!.animation, frame: 255 } }), /FIN frame/);
});
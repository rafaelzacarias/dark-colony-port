import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { parseScenario } from "../extractors/data/scenario";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { createCampaignWorld } from "../../src/engine/campaign-world";
import { browserScenarioMarkerPresentation, browserType37PlacementHidden, isBrowserScenarioMarker,
  observeBrowserType37Frame, projectBrowserType37Presentation } from "../../src/engine/browser-type37-presentation";
import { aiSelectorSourceCanonical } from "../../src/engine/ai-command-selector";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView, missionAnimationArchives, missionVisualSprites } from "../../src/mission-view";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { NavigationGrid } from "../../src/engine/grid";
import { CampaignSession, initializeCampaignSession } from "../../src/engine/campaign-session";
import { createBrowserAiSelectorConfiguration } from "../../src/engine/browser-campaign-runtime";
import { sourceBrowserCampaignSessionOptions } from "../../src/engine/source-browser-campaign-options";
import { sourceProductionVisits } from "../../src/engine/source-production-options";
import { stepBrowserType37 } from "../../src/engine/browser-type37";
import { transportHostState } from "../../src/engine/transport-host";

const root = new URL("../../", import.meta.url);
const units = parseUnitStats(readFileSync(new URL("raw_cd/DC/GAMESTAT/GAMESTAT.TXT", root), "utf8"));
const source = parseScenario(readFileSync(new URL("raw_cd/DC/SCENARIO/HUMAN/HUMAN07.SCN", root), "utf8"));

test("type37 view identity: source rows, slots and gates are required; spy requires real art", () => {
  const result = createCampaignWorld({ sessionId: "type37-view", source, units, messages: [], runtimeProfile: "browser-adapted",
    placementInitialization: { firstSlot: 152, mode: 0 },
    resourceInitialization: { firstSlot: 152, width: 128, height: 128, scales: { rateScale: 256, reserveScale: 256 } } });
  assert.ok(result.ok, JSON.stringify(result));
  const world = result.value;
  const before = structuredClone(world);
  for (const marker of world.scenarioMarkers!) {
    const entity = world.entities.find(entry => entry.key === marker.key)!;
    assert.equal(isBrowserScenarioMarker(entity, world), true);
    assert.equal(browserScenarioMarkerPresentation(entity, world), "excluded-native-spy-gate");
    assert.equal(browserScenarioMarkerPresentation(entity, world, true), "source-art-required");
    assert.equal(browserType37PlacementHidden(world, marker.sourceRow, source.placementRows[marker.sourceRow]), true);
    for (const patch of [{ rawSlot: entity.rawSlot! + 1 }, { generation: 1 }, { team: 0 }, { sourceRow: 0 }, { unitType: 84 }]) {
      assert.equal(isBrowserScenarioMarker({ ...entity, ...patch }, world), false);
    }
    assert.equal(isBrowserScenarioMarker(entity, { ...world, coordinateQueues: [] }), false);
    assert.equal(browserType37PlacementHidden(world, marker.sourceRow, [0, 0, 37, 8, -1]), false);
    assert.equal(browserType37PlacementHidden({ ...world, markerSpyTeams: Array(8).fill(true) }, marker.sourceRow,
      source.placementRows[marker.sourceRow]), false);
  }
  assert.deepEqual(world, before);
});

test("type37 collector handoff: actual idle simulation identity, source fingerprint and 450 adapted visits", () => {
  const controlled = { ...source, placementRows: [[4, 4, 6, 0, -1], [4, 4, 37, 0, -1], [4, 4, 0, 0, -1]],
    teams: source.teams.map(team => ({ ...team, coordinateRows: [[0, 0], [0, 0]] as const })) };
  const result = initializeCampaignSession({ sessionId: "type37-observation", source: controlled, units, messages: [],
    runtimeProfile: "browser-adapted", browserAi: createBrowserAiSelectorConfiguration(controlled),
    weapons: parseWeaponStats(readFileSync(new URL("raw_cd/DC/GAMESTAT/WEAPSTAT.TXT", root), "utf8")),
    triggers: [], map: { width: 10, height: 10 }, pathGrid: new Uint8Array(100).fill(1), tags: new Uint8Array(100),
    commanders: [{ team: 0, unitType: 69, sprite: "TRSC" }], directionBits: [[0, 0]], fixedStepMilliseconds: 50, orientationSteps: 1 });
  assert.ok(result.ok, JSON.stringify(result));
  let world = result.value.world;
  const owner = { runtimeProfile: "browser-adapted" as const, sourceCanonical: aiSelectorSourceCanonical(world.source) };
  const simulation = new DeterministicSimulation(new NavigationGrid(10, 10));
  const entity = world.entities.find(entry => entry.unitType === 6)!;
  const simulationId = simulation.addUnit({ faction: "human", team: 0, cell: { x: 4, y: 4 }, health: entity.health, maxHealth: entity.maxHealth });
  const binding = { simulationId, key: entity.key, slot: entity.rawSlot!, generation: entity.generation };
  const input = { snapshot: simulation.snapshot, bindings: [binding] };
  assert.deepEqual(observeBrowserType37Frame(world, owner, input).idleHarvesterSlots, []);
  const spyTeams = [true, false, false, false, false, false, false, false];
  const frame = observeBrowserType37Frame(world, owner, { ...input, spyTeams });
  assert.deepEqual(frame.idleHarvesterSlots, [binding.slot]);
  assert.throws(() => observeBrowserType37Frame(world, { ...owner, sourceCanonical: "other" }, input), /fingerprint/);
  assert.throws(() => observeBrowserType37Frame(world, owner, { ...input, bindings: [{ ...binding, generation: 1 }] }), /Stale/);
  assert.throws(() => observeBrowserType37Frame(world, owner, { ...input, bindings: [binding, binding] }), /Duplicate/);
  for (const patch of [{ activity: "move" as const }, { health: 0 }, { team: 1 }, { xSubcells: 0 }, { targetId: 99 }]) {
    const snapshot = { ...input.snapshot, units: input.snapshot.units.map(unit => ({ ...unit, ...patch })) };
    assert.deepEqual(observeBrowserType37Frame(world, owner, { ...input, snapshot, spyTeams }).idleHarvesterSlots, []);
  }
  assert.deepEqual(observeBrowserType37Frame(world, owner, { ...input, bindings: [], spyTeams }).idleHarvesterSlots, []);
  const before = structuredClone(world);
  const projection = projectBrowserType37Presentation(world, owner);
  projection.entries[0].pendingTypes.push(8);
  assert.deepEqual(world, before);
  for (let visit = 0; visit < 449; visit++) world = stepBrowserType37(world, observeBrowserType37Frame(world, owner, { ...input, spyTeams }));
  assert.equal(projectBrowserType37Presentation(world, owner).entries[0].remainingVisits, 1);
  assert.deepEqual(transportHostState(world).fifos[0].types, [0]);
  world = stepBrowserType37(world, observeBrowserType37Frame(world, owner, { ...input, spyTeams }));
  assert.deepEqual(transportHostState(world).fifos[0].types, []);
  assert.equal(world.entities.at(-1)!.unitType, 0);
  assert.equal(world.entities.at(-1)!.team, 0);
  assert.equal(projectBrowserType37Presentation(world, owner).entries[0].remainingVisits, 450);
});

const canvas = () => ({ width: 512, height: 452, getContext: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) }) as unknown as HTMLCanvasElement;
const callbacks = { onStats() {}, onUnitsChanged() {} };

for (const [faction, number, markerCount, nextSlot] of [["human", 7, 2, 202], ["alien", 6, 4, 217]] as const) {
  test(`type37 original asset admission: ${faction}${number} preserves world and reports startup blockers`, async context => {
    const requests: string[] = [];
    const read = (url: string) => {
      assert.ok(url.startsWith("/assets/generated/") && !url.includes(".."), url);
      requests.push(url);
      return readFileSync(new URL(`public${url}`, root));
    };
    context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => new Response(Uint8Array.from(read(String(input)))));
    const imageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Image");
    const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
    class SourceImage extends EventTarget {
      width = 0;
      height = 0;
      set src(url: string) {
        const bytes = read(url);
        this.width = bytes.readUInt32BE(16);
        this.height = bytes.readUInt32BE(20);
        queueMicrotask(() => this.dispatchEvent(new Event("load")));
      }
    }
    Object.defineProperty(globalThis, "Image", { configurable: true, value: SourceImage });
    Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: canvas } });
    let view: MissionView | undefined, restored: MissionView | undefined;
    try {
      const mission = await loadCampaignMission(faction, number, "browser-adapted");
      const original = JSON.stringify(mission);
      const session = new CampaignSession(sourceBrowserCampaignSessionOptions(mission));
      const initial = session.snapshot.world;
      const owner = { runtimeProfile: "browser-adapted" as const, sourceCanonical: aiSelectorSourceCanonical(initial.source) };
      const projection = projectBrowserType37Presentation(initial, owner);
      assert.equal(projection.entries.length, markerCount);
      assert.equal(initial.placementState.nextSlot, nextSlot);
      assert.ok(missionVisualSprites(mission).includes("POOP"), "no proof must retain strict asset requirement");
      assert.ok(!missionVisualSprites(mission, initial).includes("POOP"));
      assert.ok(missionVisualSprites({ ...mission, runtimeProfile: undefined }, initial).includes("POOP"));
      assert.ok(missionVisualSprites(mission, { ...initial, source: { ...initial.source, id: "other" } }).includes("POOP"));
      assert.ok(missionVisualSprites(mission, { ...initial, markerSpyTeams: Array(8).fill(true) }).includes("POOP"));
      assert.ok(missionVisualSprites({ ...mission, triggers: [{ ...mission.triggers[0],
        actions: [{ name: "newtype", arguments: [0, 0, 37] }] }] }, initial).includes("POOP"));
      const missingArchives = (sprites: readonly string[]) => [...new Set(sprites.flatMap(missionAnimationArchives))]
        .filter(name => !existsSync(new URL(`public/assets/generated/animations/${name}.json`, root))).sort();
      const missingBefore = missingArchives(missionVisualSprites(mission));
      const missingAfter = missingArchives(missionVisualSprites(mission, initial));
      assert.ok(missingBefore.includes("POOP"));
      assert.deepEqual(missingAfter, missingBefore.filter(name => name !== "POOP"));
      assert.deepEqual(projectBrowserType37Presentation(CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint()))).snapshot.world,
        owner), projection);
      view = new MissionView(canvas(), {} as HTMLElement, callbacks, mission);
      const constructorDiagnostic = view.missionDiagnostic;
      for (const entry of projection.entries) {
        assert.equal(entry.presentation, "excluded-native-spy-gate");
        assert.equal(view.nativeBindings.some(binding => binding.key === entry.key), false);
        assert.equal(initial.entities.find(entity => entity.key === entry.key)?.simulationId, null);
      }
      assert.equal(view.checkpoint().state.unitStats.some(stat => stat.type === 37), false);
      await view.initialize();
      const initializationDiagnostic = view.missionDiagnostic;
      assert.ok(!initializationDiagnostic || !/type37|POOP/i.test(initializationDiagnostic), initializationDiagnostic);
      assert.equal(requests.some(url => /POOP/i.test(url)), false);
      assert.deepEqual(view.campaignSnapshot!.world, initial);
      const step = session.step({ clockMilliseconds: 50, ...(session.snapshot.production ? {
        productionVisits: sourceProductionVisits(initial, session.snapshot.production, mission.sourceProduction!.initialPopulationCeiling),
      } : {}) });
      assert.ok(step.ok, JSON.stringify(step));
      const after = projectBrowserType37Presentation(step.value.world, owner);
      assert.deepEqual(after.entries, projection.entries);
      if (!constructorDiagnostic) {
        assert.ok(requests.some(url => url.includes("/animations/")));
        assert.ok(requests.some(url => url.endsWith(".png")));
        const saved = view.checkpoint();
        restored = MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(saved)));
        assert.deepEqual(restored.checkpoint(), saved);
      }
      assert.equal(JSON.stringify(mission), original);
      context.diagnostic(JSON.stringify({ mission: `${faction}${number}`, markers: markerCount, nextSlot,
        boundActors: view.nativeBindings.length, poopRequests: 0,
        initialized: !initializationDiagnostic, constructorDiagnostic, initializationDiagnostic, missingBefore, missingAfter }));
    } finally {
      restored?.dispose(); view?.dispose();
      if (imageDescriptor) Object.defineProperty(globalThis, "Image", imageDescriptor); else Reflect.deleteProperty(globalThis, "Image");
      if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor); else Reflect.deleteProperty(globalThis, "document");
    }
  });
}
import assert from "node:assert/strict";
import test from "node:test";
import { campaignConstructionPolicy, loadCampaignMission } from "../../src/game-data";
import { MissionView, missionVisualSprites } from "../../src/mission-view";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { installSourceRender } from "./fixtures/source-render";
import { buildingUpgradeFundingLabel, fundedBuildingUpgradeFetch } from "./fixtures/building-upgrades";

test("building upgrade view H07: paid lab upgrade, research center and original collector discovery", async context => {
  context.mock.method(globalThis, "fetch", fundedBuildingUpgradeFetch);
  context.diagnostic(buildingUpgradeFundingLabel);
  const renderer = installSourceRender();
  const views: MissionView[] = [];
  const callbacks = { onStats() {}, onUnitsChanged() {} };
  try {
    const mission = await loadCampaignMission("human", 7, "browser-adapted", campaignConstructionPolicy("human", 7, "browser-adapted"));
    const original = JSON.stringify(mission);
    let view = new MissionView(renderer.canvas(), {} as HTMLElement, callbacks, mission);
    views.push(view);
    await view.initialize();
    renderer.setEnabled(false);
    let clock = 0;
    view.update(0);
    const step = () => { view.update(clock += 50); assert.equal(view.missionDiagnostic, undefined); };
    const roundTrip = async () => {
      const saved = view.checkpoint();
      const loaded = await loadCampaignMission("human", 7, "browser-adapted", campaignConstructionPolicy("human", 7, "browser-adapted", saved));
      const restored = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, loaded, JSON.parse(JSON.stringify(saved)));
      views.push(restored);
      assert.deepEqual(restored.checkpoint(), saved);
      await restored.initialize();
      view = restored;
      clock = 0; view.resetClock(); view.update(0);
    };
    const choice = (slot: number, action: "purchase" | "upgrade") => view.constructionMenu.find(entry => "slot" in entry && entry.slot === slot && entry.action === action)!;
    const buy = (slot: number, action: "purchase" | "upgrade") => {
      const entry = choice(slot, action);
      assert.equal(entry.requestEnabled, true, entry.reason);
      assert.equal(view.purchaseConstruction(entry.dependency), true);
    };
    assert.equal(view.researchDiscovery!.research.spyTeams[0], false);
    assert.equal(choice(3, "upgrade").requestEnabled, false);
    buy(3, "purchase"); step();
    for (let visit = 0; visit < 120; visit++) step();
    const binding = view.nativeBindings.find(entry => entry.slot === 3)!;
    const before = view.simulation.checkpoint();
    const target = before.staticTargets.find(entry => entry.id === binding.simulationId)!;
    const balance = view.resourceWorkflow.credits[0];
    assert.equal(choice(4, "purchase").requestEnabled, false);
    buy(3, "upgrade");
    assert.equal(choice(3, "upgrade").reason, "Upgrade queued");
    await roundTrip();
    step();
    assert.equal(view.resourceWorkflow.credits[0], balance - 2000);
    assert.equal(view.campaignSnapshot!.production!.teams[0].slots[3].busy, 1);
    assert.equal(view.simulation.checkpoint().staticTargets.find(entry => entry.id === binding.simulationId)!.maxHealth, 2400);
    for (let visit = 0; visit < 119; visit++) step();
    await roundTrip();
    const boundary = view.checkpoint();
    const injection = context.mock.method(DeterministicSimulation.prototype, "updateStaticSourceDefense", () => {
      throw new Error("controlled upgrade projection failure");
    });
    view.update(clock += 50);
    assert.match(view.missionDiagnostic!, /controlled upgrade projection failure/);
    const rejected = view.checkpoint();
    assert.deepEqual(rejected.session, boundary.session);
    assert.deepEqual(rejected.simulation, boundary.simulation);
    injection.mock.restore();
    view = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, boundary);
    views.push(view); await view.initialize();
    clock = 0; view.resetClock(); view.update(0);
    step();
    const after = view.simulation.checkpoint();
    const upgraded = after.staticTargets.find(entry => entry.id === binding.simulationId)!;
    assert.deepEqual(view.nativeBindings.find(entry => entry.slot === 3), binding);
    assert.equal(after.nextEntityId >= before.nextEntityId, true);
    assert.equal(view.nativeBindings.filter(entry => entry.slot === 3).length, 1);
    assert.deepEqual(upgraded.footprint, target.footprint);
    assert.deepEqual([upgraded.xSubcells, upgraded.ySubcells, upgraded.health, upgraded.maxHealth], [target.xSubcells, target.ySubcells, target.health, 3600]);
    assert.equal(upgraded.sourceDefense!.sourceTypeIndex, 21);
    assert.equal(view.checkpoint().state.unitStats.find(entry => entry.id === binding.simulationId)!.type, 21);
    assert.equal(view.checkpoint().state.staticObjects.find(entry => entry.id === binding.simulationId)!.entity.unitType, 21);
    assert.ok(missionVisualSprites(mission).includes(mission.units.find(entry => entry.index === 21)!.sprite));
    assert.equal(choice(4, "purchase").requestEnabled, true);
    assert.equal(view.campaignSnapshot!.production!.teams[0].costAccumulator, 4000);
    await roundTrip();
    buy(4, "purchase"); step();
    for (let visit = 0; visit < 120; visit++) step();
    assert.equal(view.campaignSnapshot!.production!.teams[0].costAccumulator, 7000);
    assert.equal(view.researchDiscovery!.research.spyTeams[0], true);
    const collector = view.browserEconomyState!.harvesters.find(actor => actor.team === 0)!;
    const collectorBinding = view.nativeBindings.find(entry => entry.key === collector.key)!;
    const marker = view.researchDiscovery!.entries.find(entry => entry.tileX === 5 && entry.tileY === 32)!;
    const pending = [...marker.pendingTypes];
    view.replaceSelection([collectorBinding.simulationId]);
    view.setOrderMode("move");
    view.setCameraCenter(marker.tileX + 0.5, marker.tileY + 0.5);
    const camera = view.cameraView;
    view.commandAt((marker.tileX + 0.5 - camera.x) * 32, (camera.y + camera.height - marker.tileY - 0.5) * 32);
    for (let count = 0; count < 1600 && view.researchDiscovery!.entries.find(entry => entry.key === marker.key)!.pendingTypes.length === pending.length; count++) step();
    const discovered = view.researchDiscovery!.entries.find(entry => entry.key === marker.key)!;
    assert.equal(discovered.visible, true);
    assert.deepEqual(discovered.pendingTypes, pending.slice(1));
    const artifact = view.campaignSnapshot!.world.entities.find(entry => entry.unitType === 63 && entry.team === 0)!;
    assert.equal(artifact.health, 400);
    assert.ok(view.nativeBindings.some(entry => entry.key === artifact.key));
    await roundTrip();
    assert.equal(JSON.stringify(mission), original);
    context.diagnostic(`Paid construction total 7000; discovery at tick ${view.simulation.snapshot.tick}; artifact ${artifact.rawSlot}`);
  } finally {
    views.forEach(view => view.dispose());
    renderer.dispose();
  }
});

test("building upgrade source view: original AL04 bindings, damaged HP, maximum and defense restore guards", async context => {
  context.mock.method(globalThis, "fetch", fundedBuildingUpgradeFetch);
  context.diagnostic("ALIEN04 funding-only control, initial 10000 credits instead of 0; source buildings retain original 999 HP.");
  const renderer = installSourceRender();
  const views: MissionView[] = [];
  const callbacks = { onStats() {}, onUnitsChanged() {} };
  try {
    const mission = await loadCampaignMission("alien", 4, "browser-adapted", {
      completionVisits: 120, supportedSlots: [1, 2, 3, 4], supportedActions: ["purchase", "upgrade"],
    });
    const view = new MissionView(renderer.canvas(), {} as HTMLElement, callbacks, mission);
    views.push(view); await view.initialize(); renderer.setEnabled(false);
    const initial = view.checkpoint();
    let clock = 0; view.update(0);
    const step = () => { view.update(clock += 50); assert.equal(view.missionDiagnostic, undefined); };
    for (const slot of [2, 3]) {
      const choice = view.constructionMenu.find(choice => "slot" in choice && choice.slot === slot && choice.action === "upgrade")!;
      assert.equal(choice.requestEnabled, true, choice.reason);
      assert.equal(view.purchaseConstruction(choice.dependency), true);
      step();
    }
    const busy = view.checkpoint();
    const mirror = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(busy)));
    views.push(mirror); await mirror.initialize(); mirror.update(0);
    for (let visit = 1; visit <= 120; visit++) {
      step(); mirror.update(visit * 50); assert.equal(mirror.missionDiagnostic, undefined);
    }
    const saved = view.checkpoint();
    assert.deepEqual(mirror.checkpoint(), saved);
    for (const [slot, type] of [[2, 31], [3, 33]]) {
      const binding = initial.state.bindings.find(binding => binding.slot === slot)!;
      assert.equal(binding.key, `colony:${slot}`);
      assert.deepEqual(saved.state.bindings.find(entry => entry.slot === slot), binding);
      const before = initial.simulation.staticTargets.find(target => target.id === binding.simulationId)!;
      const after = saved.simulation.staticTargets.find(target => target.id === binding.simulationId)!;
      assert.deepEqual({ ...after, maxHealth: before.maxHealth, sourceDefense: before.sourceDefense }, before);
      assert.equal(after.health, 999);
      assert.equal(after.maxHealth, 3600);
      assert.equal(after.sourceDefense!.sourceTypeIndex, type);
      assert.equal(saved.state.unitStats.find(entry => entry.id === binding.simulationId)!.type, type);
      for (const field of ["maxHealth", "health", "armorFactor"] as const) {
        const corrupt = structuredClone(saved);
        const target = corrupt.simulation.staticTargets.find(target => target.id === binding.simulationId)!;
        if (field === "armorFactor") Object.assign(target.sourceDefense!, { armorFactor: target.sourceDefense!.armorFactor + 1 });
        else Object.assign(target, { [field]: target[field] + 1 });
        assert.throws(() => MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, corrupt), /construction projection/);
      }
    }
    const restored = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(saved)));
    views.push(restored);
    assert.deepEqual(restored.checkpoint(), saved);
    assert.equal(saved.session!.state.production!.teams[0].costAccumulator, 4000);
    assert.equal(saved.session!.state.browserConstruction!.paid, 4000);
  } finally {
    views.forEach(view => view.dispose()); renderer.dispose();
  }
});
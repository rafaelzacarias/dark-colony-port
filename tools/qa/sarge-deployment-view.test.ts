import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { loadReleaseMission } from "./fixtures/release-mission";
import { installSourceRender } from "./fixtures/source-render";

test("SARGE H10: public source deployment, natural enemy extraction and exact checkpoint", async context => {
  const renderer = installSourceRender();
  const callbacks = { onStats() {}, onUnitsChanged() {} };
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) =>
    new Response(readFileSync(new URL(String(input).slice(1), new URL("../../public/", import.meta.url)))));
  const views: MissionView[] = [];
  try {
    const mission = await loadCampaignMission("human", 10, "browser-adapted");
    const view = new MissionView(renderer.canvas(), {} as HTMLElement, callbacks, mission);
    views.push(view);
    await view.initialize();
    assert.equal(view.missionDiagnostic, undefined);
    renderer.setEnabled(false);
    view.update(0);
    let clock = 0;
    const step = () => { clock += 50; view.update(clock); assert.equal(view.missionDiagnostic, undefined); };
    for (let count = 0; count < 160; count++) step();
    const scout = view.simulation.snapshot.units.find(unit => unit.team === 0 && unit.movementPlane === "air")!;
    assert.ok(scout);
    const trips = Array.from(mission.tags).flatMap((tag, index) => (tag & 63) === 1
      ? [{ x: index % mission.map.width, y: mission.map.height - 1 - Math.floor(index / mission.map.width) }] : []);
    trips.sort((left, right) => Math.abs(left.x - scout.cellX) + Math.abs(left.y - scout.cellY)
      - Math.abs(right.x - scout.cellX) - Math.abs(right.y - scout.cellY));
    assert.ok(trips.length);
    const move = (id: number, cell: { x: number; y: number }) => {
      view.replaceSelection([id]); view.setOrderMode("move"); view.setCameraCenter(cell.x + 0.5, cell.y + 0.5);
      const camera = view.cameraView;
      view.commandAt((cell.x + 0.5 - camera.x) * 32, (camera.y + camera.height - cell.y - 0.5) * 32);
    };
    move(scout.id, trips[0]);
    for (let count = 0; count < 800 && !view.campaignSnapshot!.world.entities.some(actor => actor.unitType === 4 && actor.team === 0); count++) step();
    const sarge = view.campaignSnapshot!.world.entities.find(actor => actor.unitType === 4 && actor.team === 0)!;
    assert.ok(sarge, "original H10 provides SARGE");
    const binding = view.nativeBindings.find(entry => entry.key === sarge.key)!;
    const economy = view.browserEconomyState!;
    assert.ok(economy.orders.some(order => order.phase === "extracting"
      && economy.harvesters.some(actor => actor.team !== 0
        && economy.bindings.some(entry => entry.key === actor.key && entry.simulationId === order.simulationId))),
    "source enemy collector naturally extracts");
    const target = economy.orders.find(order => order.phase === "extracting"
      && economy.harvesters.some(actor => actor.team === 2 && actor.options.cell.x === 33
        && economy.bindings.some(entry => entry.key === actor.key && entry.simulationId === order.simulationId)))!;
    assert.ok(target);
    view.replaceSelection([binding.simulationId]);
    view.stopSelected(); step();
    const beforeLink = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission,
      JSON.parse(JSON.stringify(view.checkpoint())));
    views.push(beforeLink);
    assert.deepEqual(view.deploySelected(), [binding.simulationId]);
    assert.deepEqual(beforeLink.deploySelected(), [binding.simulationId]);
    assert.deepEqual(beforeLink.checkpoint(), view.checkpoint(), "public deployment replays before acquisition");
    const deployed = view.browserEconomyState!.incomeInterception!.deployments[0];
    assert.equal(deployed.typeId, 4);
    assert.ok(deployed.partner, "source-provided SARGE acquires natural enemy extraction");
    const earnedBefore = view.browserEconomyState!.earned[0];
    for (let count = 0; count < 24; count++) step();
    assert.ok(view.browserEconomyState!.earned[0] > earnedBefore, "real intercepted income without a fund grant");
    assert.equal(view.campaignSnapshot!.world.entities.find(actor => actor.key === sarge.key)!.unitType, 4);
    const before = view.checkpoint();
    const restored = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission,
      JSON.parse(JSON.stringify(before)));
    views.push(restored);
    assert.deepEqual(restored.checkpoint(), before);
    restored.update(0);
    const pose = view.simulation.snapshot.units.find(unit => unit.id === binding.simulationId)!;
    view.simulation.queue({ type: "move", unitIds: [binding.simulationId], target: { x: pose.cellX + 1, y: pose.cellY } });
    restored.simulation.queue({ type: "move", unitIds: [binding.simulationId], target: { x: pose.cellX + 1, y: pose.cellY } });
    step();
    restored.update(50);
    assert.deepEqual(restored.checkpoint(), view.checkpoint(), "linked checkpoint continues exactly");
    const held = view.simulation.snapshot.units.find(unit => unit.id === binding.simulationId)!;
    assert.equal(held.xSubcells, pose.xSubcells); assert.equal(held.ySubcells, pose.ySubcells);
    assert.deepEqual(view.undeploySelected(), [binding.simulationId]);
    assert.deepEqual(restored.undeploySelected(), [binding.simulationId]);
    assert.deepEqual(restored.checkpoint(), view.checkpoint());
    assert.equal(view.browserEconomyState!.incomeInterception!.deployments.length, 0);
    assert.ok(renderer.evidence().images.some(path => path.includes("SARGSTL") || path.includes("SARG")));
  } finally { for (const view of views) view.dispose(); renderer.dispose(); }
});

test("PSYC A11: a deployed alien interceptor checkpoint restores exactly", async context => {
  const renderer = installSourceRender();
  const callbacks = { onStats() {}, onUnitsChanged() {} };
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) =>
    new Response(readFileSync(new URL(String(input).slice(1), new URL("../../public/", import.meta.url)))));
  const views: MissionView[] = [];
  try {
    const mission = await loadReleaseMission("alien", 11);
    const view = new MissionView(renderer.canvas(), {} as HTMLElement, callbacks, mission);
    views.push(view);
    await view.initialize();
    renderer.setEnabled(false);
    view.update(0);
    let clock = 0;
    const step = () => { clock += 50; view.update(clock); assert.equal(view.missionDiagnostic, undefined); };
    step();
    // A11's PSYCs start as dormant contact objects; touching one recruits it. Troops arrive by transport first.
    for (let count = 0; count < 400 && !view.campaignSnapshot!.world.entities.some(actor => actor.team === 0 && actor.unitType === 8); count++) step();
    const dormant = view.campaignSnapshot!.world.entities.find(actor => actor.key === "placement:15")!;
    assert.equal(dormant.unitType, 12);
    const runner = view.nativeBindings.find(entry => view.campaignSnapshot!.world.entities
      .some(actor => actor.key === entry.key && actor.team === 0 && actor.unitType === 8))!;
    assert.ok(runner);
    view.replaceSelection([runner.simulationId]); view.setOrderMode("move");
    view.setCameraCenter(dormant.tileX + 0.5, dormant.tileY + 0.5);
    const camera = view.cameraView;
    view.commandAt((dormant.tileX + 0.5 - camera.x) * 32, (camera.y + camera.height - dormant.tileY - 0.5) * 32);
    for (let count = 0; count < 3000 && !view.campaignSnapshot!.world.entities.some(actor => actor.unitType === 12 && actor.team === 0); count++) step();
    const psyc = view.campaignSnapshot!.world.entities.find(actor => actor.unitType === 12 && actor.team === 0)!;
    assert.ok(psyc, "touching the A11 contact recruits PSYC");
    const binding = view.nativeBindings.find(entry => entry.key === psyc.key)!;
    view.replaceSelection([binding.simulationId]);
    view.stopSelected(); step();
    assert.deepEqual(view.deploySelected(), [binding.simulationId]);
    for (let count = 0; count < 4; count++) step();
    assert.equal(view.browserEconomyState!.incomeInterception!.deployments[0].typeId, 12);
    const saved = view.checkpoint();
    const restored = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(saved)));
    views.push(restored);
    assert.deepEqual(restored.checkpoint(), saved);
  } finally { for (const view of views) view.dispose(); renderer.dispose(); }
});

test("SARGE strict: public deployment and undeployment have no effects", async context => {
  const renderer = installSourceRender();
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) =>
    new Response(readFileSync(new URL(String(input).slice(1), new URL("../../public/", import.meta.url)))));
  let view: MissionView | undefined;
  try {
    const mission = await loadCampaignMission("human", 1);
    view = new MissionView(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
    const saved = view.checkpoint();
    assert.deepEqual(view.deploymentSelection, { canDeploy: false, canUndeploy: false });
    assert.deepEqual(view.deploySelected(), []);
    assert.deepEqual(view.undeploySelected(), []);
    assert.deepEqual(view.checkpoint(), saved);
    assert.equal(view.browserEconomyState, undefined);
  } finally { view?.dispose(); renderer.dispose(); }
});
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView, missionVisualSprites } from "../../src/mission-view";
import { installSourceRender } from "./fixtures/source-render";
import { DeterministicSimulation } from "../../src/engine/simulation";

test("construction view: original ALIEN10 user menu, unfunded rejection and exact checkpoint", async context => {
  const renderer = installSourceRender();
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    return new Response(Uint8Array.from(readFileSync(new URL(`../../public${path}`, import.meta.url))).buffer);
  });
  const views: MissionView[] = [];
  try {
    const mission = await loadCampaignMission("alien", 10, "browser-adapted", { completionVisits: 120 });
    const callbacks = { onStats() {}, onUnitsChanged() {} };
    const view = new MissionView(renderer.canvas(), {} as HTMLElement, callbacks, mission);
    views.push(view);
    assert.equal(view.missionDiagnostic, undefined);
    const menu = view.constructionMenu[0];
    assert.ok("cost" in menu && "credits" in menu);
    assert.equal(menu.cost, 2000);
    assert.equal(menu.credits, 1500);
    assert.equal(menu.requestEnabled, false);
    assert.match(menu.reason, /500 PETRA short/);
    assert.equal(view.purchaseConstruction(14), false);
    assert.deepEqual(view.productionMenu, []);
    assert.ok(missionVisualSprites(mission).includes(mission.units.find(unit => unit.index === 28)!.sprite));
    await view.initialize();
    assert.equal(view.missionDiagnostic, undefined);
    renderer.setEnabled(false);
    view.update(0);
    view.update(50);
    assert.equal(view.missionDiagnostic, undefined);
    assert.equal(view.campaignSnapshot?.browserConstruction?.phase, "empty", "ticks do not buy buildings");
    const saved = view.checkpoint();
    const restored = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(saved)));
    views.push(restored);
    assert.deepEqual(restored.checkpoint(), saved);
    const disabled = await loadCampaignMission("alien", 10, "browser-adapted");
    assert.equal(disabled.browserConstruction, undefined);
    assert.equal(disabled.sourceProduction?.production, undefined);
    assert.throws(() => MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, disabled, saved), /Invalid MissionView checkpoint/);
  } finally {
    for (const view of views) view.dispose();
    renderer.dispose();
  }
});

test("construction compatibility: M02/M03 default options and strict source admission stay absent", async context => {
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    return new Response(Uint8Array.from(readFileSync(new URL(`../../public${path}`, import.meta.url))).buffer);
  });
  for (const faction of ["human", "alien"] as const) for (const number of [2, 3]) {
    const mission = await loadCampaignMission(faction, number, "browser-adapted");
    assert.equal(Object.hasOwn(mission, "browserConstruction"), false);
    const view = new MissionView({ width: 512, height: 452, getContext: () => null } as unknown as HTMLCanvasElement,
      {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
    assert.equal(view.missionDiagnostic, undefined);
    assert.equal(Object.hasOwn(view.checkpoint().session!.options, "browserConstruction"), false);
    assert.equal(Object.hasOwn(view.checkpoint().session!.state, "browserConstruction"), false);
    assert.equal(Object.hasOwn(view.checkpoint().state, "pendingConstruction"), false);
    view.dispose();
  }
  await assert.rejects(loadCampaignMission("alien", 3, "browser-adapted", { completionVisits: 120 }), /only explicitly adapted ALIEN10/);
  await assert.rejects(loadCampaignMission("alien", 10, undefined, { completionVisits: 120 }), /only explicitly adapted ALIEN10/);
});

test("construction view: explicitly funded control, public purchase, static mirror, collector and exact replay", async context => {
  const renderer = installSourceRender();
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    return new Response(Uint8Array.from(readFileSync(new URL(`../../public${path}`, import.meta.url))).buffer);
  });
  const callbacks = { onStats() {}, onUnitsChanged() {} };
  const views: MissionView[] = [];
  try {
    const mission = await loadCampaignMission("alien", 10, "browser-adapted", { completionVisits: 3 });
    const original = new MissionView(renderer.canvas(), {} as HTMLElement, callbacks, mission);
    views.push(original);
    await original.initialize();
    renderer.setEnabled(false);
    original.update(0);
    original.update(50);
    const initial = original.checkpoint();
    const node = mission.browserEconomy!.nodes.find(node => node.amount >= 2500)!;
    assert.ok(node);
    const funded = { ...initial, economy: { ...initial.economy!, earned: { ...initial.economy!.earned, 0: 2500 },
      remaining: { ...initial.economy!.remaining, [node.key]: initial.economy!.remaining[node.key] - 2500 } } };
    let view = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, funded);
    views.push(view);
    let clock = 0;
    const reset = () => { clock = 0; view.resetClock(); view.update(0); };
    const step = () => {
      const tick = view.simulation.snapshot.tick;
      view.update(clock += 50);
      assert.equal(view.missionDiagnostic, undefined);
      assert.equal(view.simulation.snapshot.tick, tick + 1);
    };
    const roundTrip = () => {
      const saved = view.checkpoint();
      const restored = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(saved)));
      views.push(restored);
      assert.deepEqual(restored.checkpoint(), saved);
      view = restored;
      reset();
    };
    reset();
    step();
    assert.equal(view.resourceWorkflow.credits[0], 4000);
    assert.equal(view.purchaseConstruction(14), true);
    assert.equal(view.purchaseConstruction(14), false, "only one pending user request");
    roundTrip();
    const pending = view.checkpoint();
    const failed = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, pending);
    views.push(failed);
    failed.update(0);
    const addStatic = DeterministicSimulation.prototype.addStaticTarget;
    const injection = context.mock.method(DeterministicSimulation.prototype, "addStaticTarget", function(this: DeterministicSimulation,
      options: Parameters<DeterministicSimulation["addStaticTarget"]>[0]) {
      if (options.team === 0 && options.maxHealth === 4800) throw new Error("controlled construction projection failure");
      return addStatic.call(this, options);
    });
    failed.update(50);
    injection.mock.restore();
    assert.match(failed.missionDiagnostic!, /controlled construction projection failure/);
    assert.deepEqual(failed.checkpoint().session, pending.session, "view failure does not publish debit or host allocation");
    assert.deepEqual(failed.checkpoint().simulation, pending.simulation, "view failure does not publish partial static mirror");
    assert.equal(failed.checkpoint().state.pendingConstruction, 14);
    step();
    assert.equal(view.resourceWorkflow.credits[0], 2000);
    const binding = view.nativeBindings.find(binding => binding.slot === 0)!;
    assert.ok(binding);
    const target = view.simulation.checkpoint().staticTargets.find(target => target.id === binding.simulationId)!;
    assert.deepEqual(target.footprint, mission.browserConstruction!.building.footprint.map(cell => cell.y * view.grid.width + cell.x));
    assert.equal(target.xSubcells, 29952 * 4);
    assert.equal(target.ySubcells, 1656 * 4);
    assert.equal(target.health, 4800);
    assert.equal(view.productionMenu.find(choice => choice.dependency === 21)?.enabled, false);
    roundTrip();
    for (let count = 0; count < 3; count++) step();
    assert.equal(view.constructionMenu[0].status, "complete");
    assert.equal(view.productionMenu.find(choice => choice.dependency === 21)?.enabled, true);
    roundTrip();
    assert.equal(view.purchaseProduction(21), true);
    step();
    assert.equal(view.resourceWorkflow.credits[0], 500);
    for (let count = 0; count < 130 && view.browserEconomyState!.harvesters.length === 0; count++) step();
    assert.equal(view.browserEconomyState!.harvesters.filter(actor => actor.team === 0 && actor.typeId === 14).length, 1);
    assert.equal(view.nativeBindings.filter(binding => binding.slot === 0).length, 1);
    roundTrip();
    const mirror = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, view.checkpoint());
    views.push(mirror);
    mirror.update(0);
    for (let count = 1; count <= 3; count++) { step(); mirror.update(count * 50); }
    assert.deepEqual(mirror.checkpoint(), view.checkpoint(), "exact full-view continuation after collector creation");
    assert.equal(mission.scenario.teams[0].money, 1500);
    context.diagnostic("Funded external economy checkpoint control, not earned income or a legal original ALIEN10 opening; source funds and prices remain unchanged.");
  } finally {
    for (const view of views) view.dispose();
    renderer.dispose();
  }
});
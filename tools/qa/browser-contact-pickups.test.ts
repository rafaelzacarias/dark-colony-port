import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { campaignConstructionPolicy, loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { findPath } from "../../src/engine/pathfinding";
import type { GridPoint } from "../../src/engine/grid";
import { installSourceRender } from "./fixtures/source-render";

const root = new URL("../../", import.meta.url);
const callbacks = { onStats() {}, onUnitsChanged() {} };

function command(view: MissionView, id: number, destination: GridPoint): void {
  view.replaceSelection([id]);
  view.setCameraCenter(destination.x + 0.5, destination.y + 0.5);
  view.setOrderMode("move");
  const camera = view.cameraView, bounds = view.canvas.getBoundingClientRect(), scale = 512 / camera.width;
  const clientX = bounds.left + (destination.x + 0.5 - camera.x) * scale * bounds.width / 512;
  const clientY = bounds.top + (226 - (destination.y + 0.5 - camera.y - camera.height / 2) * scale) * bounds.height / 452;
  view.commandAt(clientX, clientY);
}

test("contact joins: ALIEN06 state-1 LUNATEKs join team 0 on contact and restore exactly", async () => {
  const renderer = installSourceRender(), originalFetch = globalThis.fetch;
  renderer.setEnabled(false);
  globalThis.fetch = async input => new Response(readFileSync(new URL(`public${String(input)}`, root)));
  try {
    const mission = await loadCampaignMission("alien", 6, "browser-adapted",
      campaignConstructionPolicy("alien", 6, "browser-adapted", undefined));
    const view = new MissionView(renderer.canvas(), {} as HTMLElement, callbacks, mission);
    await view.initialize();
    assert.equal(view.missionDiagnostic, undefined);
    const lunateks = () => view.campaignSnapshot!.world.entities.filter(entity => entity.unitType === 65 && entity.sourceRow !== null);
    const initial = lunateks().filter(entity => entity.team === 2);
    assert.equal(initial.length, 3);
    view.resetClock(); view.update(0);
    let tick = 0;
    const advance = (count: number) => {
      for (let index = 0; index < count; index++) { view.update(++tick * 50); assert.equal(view.missionDiagnostic, undefined); }
    };
    const joinedNow = () => lunateks().filter(entity => initial.some(source => source.key === entity.key) && entity.team === 0);
    const blocked = () => new Set(view.simulation.staticObstacleCells.map(cell => view.grid.index(cell.x, cell.y)));
    const goal = { x: initial[0].tileX, y: initial[0].tileY };
    const walkers = () => view.simulation.snapshot.units.filter(unit => view.isOwnedUnit(unit.id) && unit.health > 0
      && unit.movementPlane !== "air" && unit.activity !== "die");
    while (!walkers().length && !joinedNow().length && tick < 2000) advance(10);
    const walker = walkers()
      .sort((left, right) => Math.hypot(left.cellX - goal.x, left.cellY - goal.y) - Math.hypot(right.cellX - goal.x, right.cellY - goal.y))[0];
    assert.ok(walker, "player has a ground unit");
    for (let leg = 0; leg < 12 && !joinedNow().length; leg++) {
      const unit = view.simulation.snapshot.units.find(candidate => candidate.id === walker.id)!;
      const route = [-1, 0, 1].flatMap(dx => [-1, 0, 1].map(dy => ({ x: goal.x + dx, y: goal.y + dy })))
        .map(target => findPath(view.grid, { x: unit.cellX, y: unit.cellY }, target, { blocked: blocked() })).find(path => path?.length);
      assert.ok(route, "route to the LUNATEK group");
      command(view, walker.id, route[Math.min(24, route.length - 1)]);
      for (let step = 0; step < 30 && !joinedNow().length; step++) advance(10);
    }
    const byKey = new Map(view.nativeBindings.map(binding => [binding.key, binding.simulationId]));
    const joined = joinedNow();
    assert.ok(joined.length > 0, "a team-0 neighbour converts state-1 LUNATEKs");
    for (const entity of joined) {
      const id = byKey.get(entity.key)!;
      assert.equal(view.isOwnedUnit(id), true);
      assert.equal(view.simulation.snapshot.units.find(unit => unit.id === id)?.team, 0);
    }
    const checkpoint = view.checkpoint();
    const restored = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(checkpoint)));
    assert.deepEqual(restored.checkpoint(), checkpoint);
    await restored.initialize();
    restored.resetClock(); restored.update(tick * 50);
    view.resetClock(); view.update(tick * 50);
    for (let index = 1; index <= 8; index++) { view.update((tick + index) * 50); restored.update((tick + index) * 50); }
    assert.deepEqual(restored.checkpoint(), view.checkpoint());
    console.log(JSON.stringify({ tick, joined: joined.map(entity => entity.key) }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("contact pickups: ALIEN10 psy-energy stores fund the first Mind-Hive through public commands", async () => {
  const renderer = installSourceRender(), originalFetch = globalThis.fetch;
  renderer.setEnabled(false);
  globalThis.fetch = async input => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    return new Response(readFileSync(new URL(`public${path}`, root)));
  };
  try {
    const mission = await loadCampaignMission("alien", 10, "browser-adapted",
      campaignConstructionPolicy("alien", 10, "browser-adapted", undefined));
    const played: string[] = [];
    const audio = new Proxy({}, { get: (_target, name) => name === "then" ? undefined : (...args: { assetId?: string }[]) => {
      if (name === "play" && args[0]?.assetId) played.push(args[0].assetId);
      return Promise.resolve();
    } }) as unknown as ConstructorParameters<typeof MissionView>[4];
    const view = new MissionView(renderer.canvas(), {} as HTMLElement, callbacks, mission, audio);
    await view.initialize();
    assert.equal(view.missionDiagnostic, undefined);
    const stores = () => view.campaignSnapshot!.world.entities.filter(entity => entity.unitType === 90);
    assert.equal(stores().length, 5);
    assert.equal(view.resourceWorkflow.credits[0], 1500);
    view.resetClock(); view.update(0);
    let tick = 0, commander: number | undefined;
    const advance = (count: number) => {
      for (let index = 0; index < count; index++) {
        view.update(++tick * 50);
        assert.equal(view.missionDiagnostic, undefined);
      }
    };
    while (commander === undefined && tick < 1200) {
      advance(10);
      const bindings = new Map(view.nativeBindings.map(binding => [binding.simulationId, binding.key]));
      const types = new Map(view.campaignSnapshot!.world.entities.map(entity => [entity.key, entity.unitType]));
      commander = view.simulation.snapshot.units.find(unit => view.isOwnedUnit(unit.id) && unit.health > 0
        && types.get(bindings.get(unit.id)!) === 73)?.id;
    }
    assert.ok(commander !== undefined, "TRO6 delivers the type-73 commander at c>20");
    const collected: number[] = [];
    for (const target of [{ x: 123, y: 6 }, { x: 124, y: 4 }]) {
      const unit = view.simulation.snapshot.units.find(unit => unit.id === commander)!;
      const route = findPath(view.grid, { x: unit.cellX, y: unit.cellY }, target,
        { blocked: new Set(view.simulation.staticObstacleCells.map(cell => view.grid.index(cell.x, cell.y))) });
      assert.ok(route?.length, `route to ${target.x},${target.y}`);
      command(view, commander, route.at(-1)!);
      for (let step = 0; step < 60 && stores().length > 5 - collected.length - 1; step++) advance(10);
      collected.push(5 - stores().length);
    }
    const remaining = stores().length;
    assert.ok(remaining < 5, "touching psy-energy stores collects them");
    assert.equal(view.resourceWorkflow.credits[0], 1500 + 800 * (5 - remaining));
    assert.equal(played.filter(asset => asset === "SOUND/CAPTURE.WAV").length, 5 - remaining, "each pickup plays SLIST XTR 3");
    assert.ok(view.simulation.snapshot.staticTargets.length > 0);
    const before = view.constructionMenu.find(choice => choice.dependency === 14);
    assert.ok(before && "cost" in before && before.requestEnabled, "Mind-Hive becomes affordable without a grant");
    assert.equal(view.purchaseConstruction(14), true);
    advance(2);
    const after = view.constructionMenu.find(choice => choice.dependency === 14)!;
    assert.equal(after.status, "constructing");
    assert.equal(view.resourceWorkflow.credits[0], 1500 + 800 * (5 - remaining) - 2000);
    const checkpoint = view.checkpoint();
    const restored = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(checkpoint)));
    assert.deepEqual(restored.checkpoint(), checkpoint);
    await restored.initialize();
    restored.resetClock(); restored.update(tick * 50);
    view.resetClock(); view.update(tick * 50);
    for (let index = 1; index <= 8; index++) { view.update((tick + index) * 50); restored.update((tick + index) * 50); }
    assert.deepEqual(restored.checkpoint(), view.checkpoint());
    assert.ok(tick < 2880, "opening completes before TRO0's c>180 no-building loss check");
    console.log(JSON.stringify({ purchaseTick: tick - 10, collected: 5 - remaining, credits: view.resourceWorkflow.credits[0] }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

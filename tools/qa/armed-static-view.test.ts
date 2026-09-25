import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { findPath } from "../../src/engine/pathfinding";
import type { StaticTargetSnapshot } from "../../src/engine/simulation";
import { createBrowserCampaignAiConfiguration } from "../../src/engine/browser-campaign-ai";
import { createBrowserCampaignEconomyProfile } from "../../src/engine/browser-campaign-economy-source";
import { sourceBrowserCampaignSessionOptions } from "../../src/engine/source-browser-campaign-options";
import { initializeCampaignSession } from "../../src/engine/campaign-session";
import { NavigationGrid } from "../../src/engine/grid";
import { createLegacyInfantryFamilyMask } from "../../src/engine/legacy-navigation";
import { parseScenario } from "../extractors/data/scenario";

const root = new URL("../../public/", import.meta.url);
const canvas = () => ({ width: 512, height: 452, getContext: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) }) as unknown as HTMLCanvasElement;
const callbacks = { onStats() {}, onUnitsChanged() {} };

test("armed static view: controlled type42 uses source weapon40 while type45/46 use explicit adapted mines", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async input => new Response(readFileSync(new URL(String(input).slice(1), root)));
  try {
    const original = await loadCampaignMission("alien", 2, "browser-adapted");
    const parsed = parseScenario(atob(original.scenario.rawScenario!));
    for (const type of [42, 45, 46]) {
      const scenario = { ...original.scenario, ...parsed,
        placementRows: original.scenario.placementRows.map(row => row[2] === 41
          ? row.map((value, index) => index === 2 ? type : index === 3 ? type === 45 ? 1 : 0 : value) : row) };
      const fixture = { ...original, scenario, browserEconomy: undefined, browserResearch: undefined };
      const initial = initializeCampaignSession(sourceBrowserCampaignSessionOptions(fixture));
      assert.ok(initial.ok, JSON.stringify(initial));
      const browserEconomy = await createBrowserCampaignEconomyProfile({ scope: "browser-adapted-economy-v1",
        world: initial.value.world, teams: scenario.teams, units: original.units });
      const browserAi = await createBrowserCampaignAiConfiguration({ scenario, units: original.units,
        weapons: original.weapons, dependencies: [], pathGrid: new NavigationGrid(original.map.width, original.map.height,
          Uint16Array.from(createLegacyInfantryFamilyMask({ ...original.map, pathGrid: original.pathGrid }))) });
      const mission = { ...fixture, browserAi, browserEconomy };
      const view = new MissionView(canvas(), {} as HTMLElement, callbacks, mission);
      try {
        assert.equal(view.missionDiagnostic, undefined);
        const saved = view.checkpoint();
        const ids = saved.state.unitStats.filter(stat => stat.type === type).map(stat => stat.id);
        assert.equal(ids.length, 2);
        for (const id of ids) {
          const actor = saved.simulation.staticTargets.find(actor => actor.id === id)!;
          assert.equal(actor.health, 800);
          assert.equal(actor.sourceDefense?.targetClass, type === 42 ? 6 : 7);
          assert.equal(saved.state.unitWeapons.find(entry => entry.id === id)?.weapon, type === 42 ? 40 : 38);
          if (type === 42) {
            assert.equal(actor.weapon?.damage, 100);
            assert.equal(actor.weapon?.rangeCells, 6);
            assert.equal(actor.weapon?.cooldownTicks, 15);
            assert.equal(actor.footprint.length, 1);
          } else {
            assert.equal(actor.weapon, undefined);
            assert.equal(actor.mine?.sourceTypeIndex, type);
            assert.equal(actor.mine?.weapon.damage, 1300);
            assert.equal(actor.mine?.splashRange, 1);
            assert.equal(actor.attackCooldown, undefined);
            assert.equal(actor.footprint.length, 0);
          }
        }
        const restored = MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(saved)));
        assert.deepEqual(restored.checkpoint(), saved);
        restored.dispose();
      } finally { view.dispose(); }
    }
    const mine = original.weapons.find(weapon => weapon.id === 38)!;
    assert.deepEqual([mine.rawPrefix, mine.damage, mine.range, mine.shots, mine.rateOfFire], [6, 1300, 1, 2, 150]);
  } finally { globalThis.fetch = previousFetch; }
});

test("armed static view: original ALIEN02 legal player move, attack presentation, cooldown replay and source casualty", async context => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async input => new Response(readFileSync(new URL(String(input).slice(1), root)));
  let view: MissionView | undefined, restored: MissionView | undefined;
  try {
    const mission = await loadCampaignMission("alien", 2, "browser-adapted");
    const original = JSON.stringify(mission);
    view = new MissionView(canvas(), {} as HTMLElement, callbacks, mission);
    assert.equal(view.missionDiagnostic, undefined);
    const initial = view.checkpoint();
    const targets = initial.simulation.staticTargets.filter(target => !!target.weapon);
    const actors = view.simulation.snapshot.units.filter(actor => actor.team === 0 && initial.state.unitWeapons.some(entry => entry.id === actor.id && entry.weapon >= 0));
    const routes = targets.flatMap(target => Array.from(view!.grid.costs).flatMap((cost, index) => {
      const cell = view!.grid.point(index);
      if (!cost || Math.abs((cell.x + 0.5) * 1024 - target.xSubcells) + Math.abs((cell.y + 0.5) * 1024 - target.ySubcells) > 4 * 1024) return [];
      return actors.flatMap(actor => {
        const path = findPath(view!.grid, { x: actor.cellX, y: actor.cellY }, cell);
        return path ? [{ actor, target, cell, path }] : [];
      });
    })).sort((left, right) => left.path.length - right.path.length);
    assert.ok(routes.length);
    const { actor, target, cell } = routes[0];
    const binding = view.nativeBindings.find(binding => binding.simulationId === actor.id)!;
    const sourceActor = view.campaignSnapshot!.world.entities.find(entity => entity.key === binding.key)!;
    view.replaceSelection([actor.id]);
    view.setOrderMode("move");
    view.setCameraCenter(cell.x + 0.5, cell.y + 0.5);
    const camera = view.cameraView;
    view.commandAt((cell.x + 0.5 - camera.x) * 32, (camera.y + camera.height - cell.y - 0.5) * 32);
    assert.ok(view.checkpoint().simulation.commands.some(entry => entry.command.type === "move" && entry.command.unitIds.includes(actor.id)));
    view.update(0);
    let firstHit = -1, death = -1;
    for (let tick = 1; tick <= 1000 && death < 0; tick++) {
      view.update(tick * 50);
      assert.equal(view.missionDiagnostic, undefined, `tick ${tick}`);
      const shot = view.simulation.combatEvents.find(event => event.attackerId === target.id && event.targetId === actor.id);
      if (shot && firstHit < 0) {
        firstHit = tick;
        const saved = view.checkpoint();
        assert.equal(saved.state.animationStates.find(state => state.id === target.id)?.action, "Attack");
        assert.equal(saved.simulation.staticTargets.find(entry => entry.id === target.id)?.attackCooldown, 15);
        restored = MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(saved)));
        assert.deepEqual(restored.checkpoint(), saved);
        restored.update(tick * 50);
      } else if (restored) {
        restored.update(tick * 50);
        assert.equal(restored.missionDiagnostic, undefined);
        assert.deepEqual(restored.checkpoint(), view.checkpoint());
        if (tick - firstHit >= 16) { restored.dispose(); restored = undefined; }
      }
      if (view.simulation.deathEvents.some(event => event.targetId === actor.id)) {
        death = tick;
        view.update((tick + 1) * 50);
        assert.equal(view.missionDiagnostic, undefined);
        assert.equal(view.campaignSnapshot!.world.entities.find(entity => entity.key === binding.key)?.health, 0);
        assert.ok(view.missionStatistics[`0,0,${sourceActor.unitType}`] >= 1);
      }
      const current: StaticTargetSnapshot = view.simulation.snapshot.staticTargets.find(entry => entry.id === target.id)!;
      assert.equal(current.xSubcells, target.xSubcells);
      assert.equal(current.ySubcells, target.ySubcells);
      assert.ok(target.footprint.every(index => view!.grid.costs[index] === 0));
      assert.deepEqual(view.nativeBindings.find(entry => entry.simulationId === actor.id), binding);
    }
    assert.ok(firstHit > 0, "turret must hit original legally moved player actor");
    assert.ok(death > firstHit, "turret must cause a source casualty");
    assert.equal(JSON.stringify(mission), original);
    context.diagnostic(JSON.stringify({ turret: target.id, actor: actor.id, slot: binding.slot, firstHit, death }));
  } finally { restored?.dispose(); view?.dispose(); globalThis.fetch = previousFetch; }
});
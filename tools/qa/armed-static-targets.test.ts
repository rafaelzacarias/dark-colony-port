import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { NavigationGrid } from "../../src/engine/grid";
import { areHostile } from "../../src/engine/diplomacy";
import { findPath } from "../../src/engine/pathfinding";
import { calculateLegacyDamage, sourceScenarioUpgradeLevels, type SourceDamageProfile } from "../../src/engine/legacy-balance";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView, missionAnimationArchives } from "../../src/mission-view";
import { createFinSelector, createFinSourceSampler, TRSC_GRAY_VISUAL_DIRECTIONS } from "../../src/render";

const weapon = { damage: 25, rangeCells: 3, cooldownTicks: 3 };

test("armed static: ID order, source damage, fixed footprint, simultaneous mobile death and JSON cooldown", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(7, 3));
  const tower = simulation.addStaticTarget({ faction: "alien", team: 0, cell: { x: 3, y: 1 }, maxHealth: 25,
    weapon, footprint: [{ x: 3, y: 1 }] });
  const second = simulation.addStaticTarget({ faction: "alien", team: 0, cell: { x: 4, y: 1 }, maxHealth: 100, weapon });
  const mobile = simulation.addUnit({ faction: "human", team: 1, cell: { x: 2, y: 1 }, maxHealth: 50, weapon });
  simulation.queue({ type: "move", unitIds: [tower], target: { x: 0, y: 0 } });
  simulation.queue({ type: "attack", unitIds: [mobile], targetId: tower });
  simulation.advance();
  assert.deepEqual(simulation.combatEvents.map(event => event.attackerId), [mobile, tower, second]);
  assert.deepEqual(simulation.deathEvents.map(event => event.targetId), [tower, mobile]);
  assert.equal(simulation.snapshot.staticTargets[0].cellX, 3);
  assert.equal(simulation.snapshot.staticTargets[0].activity, "die");
  assert.equal(simulation.grid.isPassable(3, 1), true);
  const saved = JSON.parse(JSON.stringify(simulation.checkpoint()));
  const restored = DeterministicSimulation.restore(saved);
  for (let tick = 0; tick < 8; tick++) {
    simulation.advance(); restored.advance();
    assert.deepEqual(restored.checkpoint(), simulation.checkpoint());
  }
  for (const mutate of [
    (state: typeof saved) => { state.staticTargets[1].attackCooldown = 4; },
    (state: typeof saved) => { delete state.staticTargets[1].attackTargetId; },
    (state: typeof saved) => { state.staticTargets[1].attackTargetId = second; },
    (state: typeof saved) => { state.staticTargets[0].attackTargetId = mobile; },
  ]) {
    const corrupt = structuredClone(saved); mutate(corrupt);
    assert.throws(() => DeterministicSimulation.restore(corrupt));
  }
});

test("armed static: observer alliances, neutral exclusion, sight, range and source armor matrix", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(12, 3), { teamAlliances: [[1, 1, 0]] });
  const sourceDamage = { coefficients: [256, 128, 0, 0, 0, 0, 0, 0, 0, 0], callerFactor: 256, specialFlag: false };
  const tower = simulation.addStaticTarget({ faction: "human", team: 0, cell: { x: 4, y: 1 }, maxHealth: 100,
    weapon: { ...weapon, damage: 100, rangeCells: 5, sourceDamage },
    vision: { dayRangeCells: 2, nightRangeCells: 2 }, footprint: [{ x: 4, y: 1 }] });
  simulation.addStaticTarget({ faction: "alien", team: 8, cell: { x: 4, y: 0 }, maxHealth: 100 });
  const friend = simulation.addUnit({ faction: "alien", team: 1, cell: { x: 3, y: 1 }, weapon });
  const enemy = simulation.addUnit({ faction: "human", team: 2, cell: { x: 7, y: 1 }, maxHealth: 1000,
    speedSubcellsPerTick: 1024, sourceDefense: { targetClass: 1, armorFactor: 128 } });
  simulation.queue({ type: "attack", unitIds: [friend], targetId: tower });
  simulation.advance();
  assert.equal(simulation.combatEvents.some(event => event.attackerId === tower), false);
  simulation.queue({ type: "move", unitIds: [enemy], target: { x: 6, y: 1 } });
  simulation.advance();
  assert.deepEqual(simulation.combatEvents.filter(event => event.attackerId === tower),
    [{ type: "shot", tick: 1, attackerId: tower, targetId: enemy, damage: 25 }]);
  assert.equal(simulation.snapshot.staticTargets[0].attackCooldown, 3);
  const restored = DeterministicSimulation.restore(JSON.parse(JSON.stringify(simulation.checkpoint())));
  for (let tick = 0; tick < 6; tick++) {
    simulation.advance(); restored.advance();
    assert.deepEqual(restored.checkpoint(), simulation.checkpoint());
  }
  assert.deepEqual(simulation.staticObstacleCells, [{ x: 4, y: 1 }]);
});

const root = new URL("../../public/", import.meta.url);
const canvas = () => ({ width: 512, height: 452, getContext: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) }) as unknown as HTMLCanvasElement;
const callbacks = { onStats() {}, onUnitsChanged() {} };

test("armed static ALIEN02: two original human turrets fire at a legally moved original enemy, with source identity and save replay", async context => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async input => new Response(readFileSync(new URL(String(input).slice(1), root)));
  let view: MissionView | undefined;
  try {
    const mission = await loadCampaignMission("alien", 2, "browser-adapted");
    const original = JSON.stringify(mission);
    view = new MissionView(canvas(), {} as HTMLElement, callbacks, mission);
    assert.equal(view.missionDiagnostic, undefined);
    const initial = view.checkpoint();
    const turrets = initial.state.unitStats.filter(stat => stat.type === 41);
    assert.equal(turrets.length, 2);
    const targets = initial.simulation.staticTargets.filter(target => turrets.some(turret => turret.id === target.id));
    const shots: number[] = [];
    for (const target of targets) {
      const isolated = DeterministicSimulation.restore(initial.simulation);
      const stat = mission.units.find(stat => stat.index === 41)!;
      const levels = sourceScenarioUpgradeLevels(mission.scenario.teams[target.team!], stat.index);
      assert.equal(initial.state.unitWeapons.find(entry => entry.id === target.id)?.weapon, stat.weapons[levels.weaponLevel]);
      assert.equal(target.weapon?.damage, 100);
      assert.equal(target.weapon?.rangeCells, 6);
      assert.equal(target.weapon?.cooldownTicks, 15);
      assert.equal(target.health, 800);
      assert.equal(target.sourceDefense?.targetClass, 6);
      const cells = Array.from(isolated.grid.costs).flatMap((cost, index) => cost ? [index] : []);
      const candidates = Array.from(cells).map(index => isolated.grid.point(index)).filter(cell =>
        Math.abs((cell.x + 0.5) * 1024 - target.xSubcells) + Math.abs((cell.y + 0.5) * 1024 - target.ySubcells) <= 4 * 1024);
      const enemies = isolated.snapshot.units.filter(actor => areHostile(target, actor, isolated.snapshot.teamAlliances));
      const routes = enemies.flatMap(actor => candidates.flatMap(cell => {
        const path = findPath(isolated.grid, { x: actor.cellX, y: actor.cellY }, cell);
        return path ? [{ actor, cell, path }] : [];
      })).sort((left, right) => left.path.length - right.path.length);
      assert.ok(routes.length, "original hostile mobile has a legal path into turret sight");
      const route = routes[0];
      isolated.queue({ type: "move", unitIds: [route.actor.id], target: route.cell });
      let hit = false;
      for (let tick = 0; tick < 1500 && !hit; tick++) {
        isolated.advance();
        const event = isolated.combatEvents.find(event => event.attackerId === target.id && event.targetId === route.actor.id);
        if (event) {
          const defense = initial.simulation.units.find(actor => actor.id === event.targetId)!.sourceDefense!;
          const profile: SourceDamageProfile = target.weapon!.sourceDamage!;
          assert.ok(!("mode" in profile));
          assert.equal(event.damage, calculateLegacyDamage(target.weapon!.damage, profile, defense));
          hit = true;
          shots.push(event.tick);
          const saved = JSON.parse(JSON.stringify(isolated.checkpoint()));
          const restored = DeterministicSimulation.restore(saved);
          for (let continuation = 0; continuation < 18; continuation++) {
            isolated.advance(); restored.advance();
            assert.deepEqual(restored.checkpoint(), isolated.checkpoint());
          }
        }
        const current = isolated.snapshot.staticTargets.find(actor => actor.id === target.id)!;
        assert.equal(current.xSubcells, target.xSubcells);
        assert.equal(current.ySubcells, target.ySubcells);
        assert.ok(target.footprint.every(index => isolated.grid.costs[index] === 0));
      }
      assert.ok(hit, `turret ${target.id} never hit legally moved enemy ${route.actor.id}`);
    }
    const restored = MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(initial)));
    assert.deepEqual(restored.checkpoint(), initial);
    restored.dispose();
    assert.equal(JSON.stringify(mission), original);
    context.diagnostic(JSON.stringify({ turrets: targets.map(target => ({ id: target.id, team: target.team })), shots }));
  } finally { view?.dispose(); globalThis.fetch = previousFetch; }
});

test("armed static art: original TURR lacks TFIRE; T retains deployed directional artwork", () => {
  assert.deepEqual(missionAnimationArchives("T"), ["TURR"]);
  const animation = JSON.parse(readFileSync(new URL("assets/generated/animations/TURR.json", root), "utf8"));
  const selector = createFinSelector(animation, { prefix: "T", directions: TRSC_GRAY_VISUAL_DIRECTIONS, layerOrder: "source" });
  const selection = selector.select("Attack", "S");
  assert.ok(selection && selection.fallback);
  assert.equal(selection.action, "Stand");
  assert.match(selection.state.name, /^TSTAND/);
  assert.ok(createFinSourceSampler(animation)(selection, 0).children.length);
});
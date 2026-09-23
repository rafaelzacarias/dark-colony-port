import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { findPath } from "../../src/engine/pathfinding";
import { areHostile } from "../../src/engine/diplomacy";
import { calculateLegacyDamage } from "../../src/engine/legacy-balance";
import { auditFireMovement } from "./fixtures/source-fire-movement-audit";

const root = new URL("../../public/", import.meta.url);
const canvas = () => ({ width: 512, height: 452, getContext: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) }) as unknown as HTMLCanvasElement;
const callbacks = { onStats() {}, onUnitsChanged() {} };

test("adapted mines ALIEN05: all original identities/owners, source damage, legal approach and exact before/after replay", async context => {
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) =>
    new Response(readFileSync(new URL(String(input).slice(1), root))));
  const mission = await loadCampaignMission("alien", 5, "browser-adapted");
  const original = JSON.stringify(mission);
  const view = new MissionView(canvas(), {} as HTMLElement, callbacks, mission);
  try {
    assert.equal(view.missionDiagnostic, undefined);
    view.update(0);
    for (let tick = 1; tick <= 200; tick++) {
      view.update(tick * 50);
      assert.equal(view.missionDiagnostic, undefined, `normal startup tick ${tick}`);
    }
    const saved = view.checkpoint();
    const sourceMines = view.campaignSnapshot!.world.entities.filter(actor => [45, 46].includes(actor.unitType));
    const mines = saved.simulation.staticTargets.filter(actor => actor.mine);
    assert.ok(mines.length > 0);
    assert.equal(mines.length, sourceMines.length);
    for (const actor of sourceMines) {
      const binding = view.nativeBindings.find(binding => binding.key === actor.key)!;
      const mine = mines.find(mine => mine.id === binding.simulationId)!;
      assert.equal(mine.mine?.sourceTypeIndex, actor.unitType);
      assert.equal(mine.team, actor.team);
      assert.equal(mine.health, actor.health);
      assert.equal(mine.footprint.length, 0);
      assert.equal(saved.state.unitWeapons.find(entry => entry.id === mine.id)?.weapon, 38);
    }
    const restoredView = MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(saved)));
    assert.deepEqual(restoredView.checkpoint(), saved);
    restoredView.dispose();
    const corrupt = structuredClone(saved);
    const corruptMine = corrupt.simulation.staticTargets.find(actor => actor.mine)!;
    Object.assign(corruptMine.mine!.weapon.sourceDamage, { coefficients: Array(10).fill(256) });
    assert.throws(() => MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, corrupt), /static mine source policy/);
    const simulation = DeterministicSimulation.restore(saved.simulation);
    const mobiles = simulation.snapshot.units.filter(unit => unit.health > 0 && unit.movementPlane !== "air");
    const routes = mines.filter(mine => mine.team! < 8).flatMap(mine => {
      const center = { x: Math.floor(mine.xSubcells / 1024), y: Math.floor(mine.ySubcells / 1024) };
      const cells = [center, { x: center.x - 1, y: center.y }, { x: center.x + 1, y: center.y },
        { x: center.x, y: center.y - 1 }, { x: center.x, y: center.y + 1 }];
      return mobiles.filter(unit => unit.team! < 8 && areHostile(mine, unit, saved.simulation.teamAlliances))
        .flatMap(unit => cells.flatMap(cell => {
          if (!simulation.grid.contains(cell.x, cell.y) || !simulation.grid.isPassable(cell.x, cell.y)) return [];
          const path = findPath(simulation.grid, { x: unit.cellX, y: unit.cellY }, cell);
          return path ? [{ mine, unit, cell, path }] : [];
        }));
    }).sort((left, right) => left.path.length - right.path.length || left.mine.id - right.mine.id || left.unit.id - right.unit.id);
    assert.ok(routes.length, "a source hostile ground mobile has a legal route to an owned mine");
    const route = routes[0];
    simulation.queue({ type: "move", unitIds: [route.unit.id], target: route.cell });
    let detonation = -1;
    for (let tick = 0; tick < 2000; tick++) {
      const before = simulation.checkpoint();
      simulation.advance();
      auditFireMovement(before, simulation.checkpoint());
      const events = simulation.combatEvents.filter(event => event.attackerId === route.mine.id);
      if (!events.length) continue;
      detonation = tick;
      assert.ok(events.some(event => event.targetId === route.unit.id));
      for (const event of events) {
        const target = before.units.find(unit => unit.id === event.targetId)!;
        assert.equal(event.damage, calculateLegacyDamage(route.mine.mine!.weapon.damage,
          route.mine.mine!.weapon.sourceDamage, target.sourceDefense!));
      }
      assert.equal(simulation.deathEvents.filter(event => event.targetId === route.mine.id).length, 1);
      const preTrigger = DeterministicSimulation.restore(JSON.parse(JSON.stringify(before)));
      preTrigger.advance();
      assert.deepEqual(preTrigger.checkpoint(), simulation.checkpoint());
      const after = DeterministicSimulation.restore(JSON.parse(JSON.stringify(simulation.checkpoint())));
      for (let continuation = 0; continuation < 155; continuation++) {
        simulation.advance(); after.advance();
        assert.deepEqual(after.checkpoint(), simulation.checkpoint());
        assert.ok(!simulation.combatEvents.some(event => event.attackerId === route.mine.id));
        assert.ok(!simulation.deathEvents.some(event => event.targetId === route.mine.id));
      }
      break;
    }
    assert.ok(detonation >= 0, "legal source mobile approach detonates mine");
    const binding = view.nativeBindings.find(entry => entry.simulationId === route.mine.id)!;
    const sourceMine = sourceMines.find(actor => actor.key === binding.key)!;
    const lossKey = `${sourceMine.team},0,${sourceMine.unitType}`;
    const initialLoss = view.missionStatistics[lossKey] ?? 0;
    view.replaceSelection([route.unit.id]);
    view.setOrderMode("move");
    view.setCameraCenter(route.cell.x + 0.5, route.cell.y + 0.5);
    const camera = view.cameraView;
    view.commandAt((route.cell.x + 0.5 - camera.x) * 32, (camera.y + camera.height - route.cell.y - 0.5) * 32);
    let viewDeath = -1;
    for (let tick = 201; tick <= 1400; tick++) {
      view.update(tick * 50);
      assert.equal(view.missionDiagnostic, undefined, `public movement tick ${tick}`);
      if (!view.simulation.deathEvents.some(event => event.targetId === route.mine.id)) continue;
      viewDeath = tick;
      view.update((tick + 1) * 50);
      assert.equal(view.missionDiagnostic, undefined);
      assert.equal(view.campaignSnapshot!.world.entities.find(actor => actor.key === binding.key)?.health, 0);
      assert.equal(view.missionStatistics[lossKey], initialLoss + 1);
      const afterDeath = view.checkpoint();
      const restored = MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(afterDeath)));
      try {
        restored.update((tick + 1) * 50);
        for (let continuation = 2; continuation <= 5; continuation++) {
          view.update((tick + continuation) * 50); restored.update((tick + continuation) * 50);
          assert.deepEqual(restored.checkpoint(), view.checkpoint());
          assert.equal(view.missionStatistics[lossKey], initialLoss + 1);
        }
      } finally { restored.dispose(); }
      break;
    }
    assert.ok(viewDeath >= 0, "public source player movement reaches an original mine");
    assert.equal(JSON.stringify(mission), original);
    context.diagnostic(JSON.stringify({ mines: sourceMines.map(actor => ({ key: actor.key, type: actor.unitType,
      team: actor.team, slot: actor.rawSlot })), route: { mine: route.mine.id, mobile: route.unit.id,
      destination: route.cell, cells: route.path.length }, detonation, viewDeath, lossKey }));
  } finally { view.dispose(); }
});
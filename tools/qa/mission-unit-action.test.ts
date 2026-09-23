import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MissionView, missionUnitAction } from "../../src/mission-view";
import { DeterministicSimulation, type UnitSnapshot } from "../../src/engine/simulation";
import { NavigationGrid } from "../../src/engine/grid";
import { loadCampaignMission } from "../../src/game-data";
import { installSourceRender } from "./fixtures/source-render";

const attacker: UnitSnapshot = {
  id: 1, faction: "human", activity: "attack", xSubcells: 1536, ySubcells: 1536,
  cellX: 1, cellY: 1, health: 800, maxHealth: 800, cargo: 0, cargoCapacity: 0, targetId: 2,
};

test("generic FIN: attack pursuit uses Move throughout the interpolated last movement tick", () => {
  for (const [deltaX, deltaY] of [[40, 0], [0, -40], [-40, 40]]) {
    const previous = { ...attacker, xSubcells: attacker.xSubcells - deltaX, ySubcells: attacker.ySubcells - deltaY };
    assert.equal(missionUnitAction(attacker, previous), "Move");
  }
});

test("generic FIN: stationary attack and reload use Attack, renewed pursuit returns to Move", () => {
  assert.equal(missionUnitAction(attacker, attacker), "Attack");
  const resumed = { ...attacker, xSubcells: attacker.xSubcells + 40 };
  assert.equal(missionUnitAction(resumed, attacker), "Move");
  assert.equal(missionUnitAction(resumed, resumed), "Attack");
});

test("generic FIN: death takes precedence over displacement; idle and move retain their actions", () => {
  assert.equal(missionUnitAction({ ...attacker, activity: "die", xSubcells: 1600 }, attacker), "Die");
  assert.equal(missionUnitAction({ ...attacker, activity: "idle" }, attacker), "Stand");
  assert.equal(missionUnitAction({ ...attacker, activity: "move" }, attacker), "Move");
});

test("generic FIN: an undisplaced attack with a pending leg uses Move", () => {
  assert.equal(missionUnitAction(attacker, attacker, true), "Move");
  assert.equal(missionUnitAction({ ...attacker, activity: "die" }, attacker, true), "Die");
});

test("generic FIN: real chase, stationary shots and same-command renewed pursuit", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(16, 4));
  const attackerId = simulation.addUnit({ faction: "human", cell: { x: 1, y: 1 }, speedSubcellsPerTick: 256,
    weapon: { damage: 1, rangeCells: 2, cooldownTicks: 4 } });
  const targetId = simulation.addUnit({ faction: "alien", cell: { x: 7, y: 1 }, maxHealth: 1000,
    speedSubcellsPerTick: 512 });
  simulation.queue({ type: "attack", unitIds: [attackerId], targetId });
  let movements = 0, shots = 0, reloads = 0, renewedMovements = 0;
  for (let tick = 0; tick < 70; tick += 1) {
    if (tick === 30) simulation.queue({ type: "move", unitIds: [targetId], target: { x: 13, y: 2 } });
    const previous = simulation.snapshot.units.find(unit => unit.id === attackerId)!;
    simulation.advance();
    const current = simulation.snapshot.units.find(unit => unit.id === attackerId)!;
    const actor = simulation.checkpoint().units.find(unit => unit.id === attackerId)!;
    const action = missionUnitAction(current, previous, actor.pathIndex < actor.path.length || actor.reservedDestination !== null);
    assert.equal(current.activity, "attack");
    assert.equal(current.targetId, targetId);
    if (current.xSubcells !== previous.xSubcells || current.ySubcells !== previous.ySubcells) {
      assert.equal(action, "Move");
      assert.equal(simulation.combatEvents.length, 0);
      movements += 1;
      if (tick >= 30) renewedMovements += 1;
    } else if (simulation.combatEvents.some(event => event.attackerId === attackerId)) {
      assert.equal(action, "Attack");
      for (const phase of [0, 0.25, 0.5, 0.99]) {
        assert.equal(previous.xSubcells + (current.xSubcells - previous.xSubcells) * phase, current.xSubcells);
        assert.equal(previous.ySubcells + (current.ySubcells - previous.ySubcells) * phase, current.ySubcells);
      }
      shots += 1;
    } else if (actor.path.length === 0) {
      assert.equal(action, "Attack");
      reloads += 1;
    }
  }
  assert.ok(movements > 0 && shots > 0 && reloads > 0 && renewedMovements > 0);
});

test("MissionView generic FIN: motion facing, pending legs and phase resets use the rendered action", async () => {
  const rendering = installSourceRender();
  const originalFetch = globalThis.fetch;
  const publicRoot = new URL("../../public/", import.meta.url);
  globalThis.fetch = async input => {
    const url = String(input);
    assert.ok(url.startsWith("/assets/generated/") && !url.includes(".."));
    return new Response(readFileSync(new URL(url.slice(1), publicRoot)));
  };
  let view: MissionView | undefined;
  try {
    const mission = await loadCampaignMission("alien");
    view = new MissionView(rendering.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
    await view.initialize();
    rendering.setEnabled(false);
    for (let tick = 0; tick <= 219; tick += 1) view.update(tick * 50);
    const before = view.simulation.snapshot;
    view.update(220 * 50);
    const baseline = view.simulation.snapshot;
    const owned = baseline.units.find(unit => view!.isOwnedUnit(unit.id))!;
    assert.ok(owned);
    const previous = before.units.find(unit => unit.id === owned.id)!;
    assert.equal(owned.xSubcells, previous.xSubcells);
    assert.equal(owned.ySubcells, previous.ySubcells);
    view.setCameraCenter(owned.xSubcells / 1024, owned.ySubcells / 1024);
    const saved = view.simulation.checkpoint();
    const target = { ...owned, id: 9000, xSubcells: owned.xSubcells, ySubcells: owned.ySubcells + 1024 };
    let current = { ...baseline, tick: 221, units: [
      { ...owned, activity: "attack" as const, targetId: target.id, xSubcells: owned.xSubcells + 64 }, target,
    ] };
    let pendingPath = false, checkpointReads = 0;
    Object.defineProperty(view.simulation, "snapshot", { configurable: true, get: () => current });
    Object.defineProperty(view.simulation, "checkpoint", { configurable: true, value: () => {
      checkpointReads += 1;
      return { ...saved, units: saved.units.map(unit => unit.id === owned.id
        ? { ...unit, path: pendingPath ? [{ x: owned.cellX + 1, y: owned.cellY }] : [], pathIndex: 0,
          reservedDestination: null } : unit) };
    } });
    rendering.setEnabled(true);
    const present = () => {
      view!.render();
      assert.equal(view!.missionDiagnostic, undefined);
      return view!.checkpoint().state.animationStates.find(state => state.id === owned.id)!;
    };
    assert.deepEqual(present(), { id: owned.id, action: "Move", facing: "E", since: 221 });
    current = { ...current, tick: 222 };
    assert.equal(present().since, 221);
    current = { ...current, tick: 223, units: [{ ...current.units[0], xSubcells: owned.xSubcells }, target] };
    assert.deepEqual(present(), { id: owned.id, action: "Attack", facing: "N", since: 223 });
    const reads = checkpointReads;
    view.render();
    view.render();
    assert.equal(checkpointReads, reads, "same-tick renders must not clone checkpoints again");
    current = { ...current, tick: 224 };
    assert.equal(present().since, 223);
    pendingPath = true;
    current = { ...current, tick: 225 };
    assert.deepEqual(present(), { id: owned.id, action: "Move", facing: "N", since: 225 });
    current = { ...current, tick: 226, units: [{ ...current.units[0], xSubcells: owned.xSubcells - 64 }, target] };
    assert.deepEqual(present(), { id: owned.id, action: "Move", facing: "W", since: 226 });
    assert.ok(rendering.evidence().spriteDraws > 0, "exercise real FIN composition through the Canvas stub");
  } finally {
    if (view) {
      Reflect.deleteProperty(view.simulation, "snapshot");
      Reflect.deleteProperty(view.simulation, "checkpoint");
      view.dispose();
    }
    globalThis.fetch = originalFetch;
    rendering.dispose();
  }
});
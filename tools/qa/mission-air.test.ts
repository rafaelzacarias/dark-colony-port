import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";

const root = new URL("../../public/", import.meta.url);
const canvas = () => ({ width: 512, height: 452, getContext: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) }) as unknown as HTMLCanvasElement;
const callbacks = { onStats() {}, onUnitsChanged() {} };

test("air view: default HUMAN01 and ALIEN01 retain ground-only admission and legacy checkpoints", async context => {
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) =>
    new Response(readFileSync(new URL(String(input).slice(1), root))));
  for (const faction of ["human", "alien"] as const) {
    const mission = await loadCampaignMission(faction, 1);
    assert.equal(mission.runtimeProfile, undefined);
    const view = new MissionView(canvas(), {} as HTMLElement, callbacks, mission);
    let restored: MissionView | undefined;
    try {
      assert.equal(view.missionDiagnostic, undefined);
      view.update(0);
      for (let tick = 1; tick <= 8; tick++) view.update(tick * 50);
      assert.equal(view.missionDiagnostic, undefined);
      const saved = view.checkpoint();
      assert.ok(saved.simulation.units.length > 0);
      assert.ok(saved.simulation.units.every(unit => !Object.hasOwn(unit, "movementPlane")));
      assert.ok(saved.simulation.movementReservations.every(entry => !Object.hasOwn(entry, "plane")));
      restored = MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(saved)));
      assert.deepEqual(restored.checkpoint(), saved);
    } finally { restored?.dispose(); view.dispose(); }
  }
});

test("air view: original ALIEN06 slot161 ORTU at12,74 completes 200 updates without ground mutation", async context => {
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) =>
    new Response(readFileSync(new URL(String(input).slice(1), root))));
  const mission = await loadCampaignMission("alien", 6, "browser-adapted");
  const original = JSON.stringify(mission);
  const view = new MissionView(canvas(), {} as HTMLElement, callbacks, mission);
  let restored: MissionView | undefined;
  try {
    assert.equal(view.missionDiagnostic, undefined);
    const binding = view.nativeBindings.find(binding => binding.slot === 161)!;
    assert.ok(binding);
    const initial = view.checkpoint();
    const aircraft = initial.simulation.units.find(unit => unit.id === binding.simulationId)!;
    assert.equal(initial.state.unitStats.find(unit => unit.id === aircraft.id)?.type, 13);
    assert.equal(aircraft.movementPlane, "air");
    assert.equal(aircraft.sourceDefense?.targetClass, 2);
    assert.equal(view.grid.isPassable(12, 74), false);
    assert.deepEqual([aircraft.xSubcells, aircraft.ySubcells], [12.5 * 1024, 74.5 * 1024]);
    for (const stat of mission.units.filter(stat => [0, 8, 12, 5, 13].includes(stat.index))) {
      const expected = [5, 13].includes(stat.index) ? "air" : "ground";
      for (const entry of initial.state.unitStats.filter(entry => entry.type === stat.index)) {
        assert.equal(initial.simulation.units.find(unit => unit.id === entry.id)?.movementPlane, expected);
      }
    }
    const costs = [...view.grid.costs];
    view.update(0);
    for (let tick = 1; tick <= 200; tick++) {
      view.update(tick * 50);
      assert.equal(view.missionDiagnostic, undefined, `tick ${tick}`);
      assert.deepEqual([...view.grid.costs], costs);
    }
    assert.equal(view.simulation.snapshot.tick, 200);
    const saved = view.checkpoint();
    restored = MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(saved)));
    assert.deepEqual(restored.checkpoint(), saved);
    const invalid = structuredClone(saved);
    Object.assign(invalid.simulation.units.find(unit => unit.id === aircraft.id)!, { movementPlane: "ground" });
    Object.assign(invalid.simulation, { movementReservations: invalid.simulation.movementReservations
      .map(entry => ({ ...entry, owners: entry.owners.filter(owner => owner !== aircraft.id) })).filter(entry => entry.owners.length) });
    assert.throws(() => MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, invalid), /source movement plane/);
    restored.dispose(); restored = undefined;
    const owned = view.simulation.snapshot.units.find(unit => unit.team === 0 && unit.movementPlane === "air" && unit.health > 0)!;
    assert.ok(owned, "original mission contains a player-owned aircraft");
    const destination = [...view.grid.costs].flatMap((cost, index) => {
      const cell = view.grid.point(index);
      const distance = Math.abs(cell.x - owned.cellX) + Math.abs(cell.y - owned.cellY);
      return cost === 0 && distance >= 4 && distance <= 6 ? [cell] : [];
    })[0];
    assert.ok(destination, "nearby water target");
    view.replaceSelection([owned.id]);
    view.setOrderMode("move");
    view.setCameraCenter(destination.x + 0.5, destination.y + 0.5);
    const camera = view.cameraView;
    view.commandAt((destination.x + 0.5 - camera.x) * 32, (camera.y + camera.height - destination.y - 0.5) * 32);
    assert.ok(view.checkpoint().simulation.commands.some(entry => entry.command.type === "move"
      && entry.command.unitIds.includes(owned.id) && entry.command.target.x === destination.x && entry.command.target.y === destination.y));
    view.update(201 * 50);
    const flying = view.checkpoint();
    assert.ok(flying.simulation.units.find(unit => unit.id === owned.id)!.path.length > 0);
    restored = MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(flying)));
    restored.update(201 * 50);
    for (let tick = 202; tick <= 216; tick++) {
      view.update(tick * 50); restored.update(tick * 50);
      assert.equal(view.missionDiagnostic, undefined);
      assert.equal(restored.missionDiagnostic, undefined);
      assert.deepEqual(restored.checkpoint(), view.checkpoint());
      assert.deepEqual([...view.grid.costs], costs);
    }
    context.diagnostic(JSON.stringify({ slot: binding.slot, type: 13, naturalTicks: 200,
      playerAircraft: owned.id, destination, continuationTicks: 15 }));
    assert.equal(JSON.stringify(mission), original);
  } finally { restored?.dispose(); view.dispose(); }
});
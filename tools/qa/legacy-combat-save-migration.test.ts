import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { installSourceRender } from "./fixtures/source-render";

test("saves from before projectile flight, BOOM2 mines and turning still load and are upgraded", async () => {
  const renderer = installSourceRender(), originalFetch = globalThis.fetch;
  globalThis.fetch = async input => new Response(readFileSync(new URL(`../../public${String(input)}`, import.meta.url)));
  const callbacks = { onStats() {}, onUnitsChanged() {} };
  try {
    const mission = await loadCampaignMission("human", 7, "browser-adapted");
    const view = new MissionView(renderer.canvas(), {} as HTMLElement, callbacks, mission);
    await view.initialize();
    renderer.setEnabled(false);
    for (let tick = 1; tick <= 60; tick++) view.update(tick * 50);
    const current = view.checkpoint({ stateOnly: true });
    // Rebuild the pre-change record shapes: hit-scan weapons, the weapon-range mine fallback and no turn state.
    const legacy = structuredClone(current) as unknown as { simulation: { units: Record<string, unknown>[];
      staticTargets: Record<string, unknown>[] } };
    const hitScan = (weapon: Record<string, unknown> | null | undefined) => {
      if (!weapon) return weapon;
      const { projectileSpeed: _speed, weaponId: _id, splash: _splash, ...rest } = weapon;
      return rest;
    };
    legacy.simulation.units = legacy.simulation.units.map(({ turnSpeed: _turn, facing: _facing, ...unit }) =>
      ({ ...unit, weapon: hitScan(unit.weapon as Record<string, unknown> | null) }));
    legacy.simulation.staticTargets = legacy.simulation.staticTargets.map(target => ({ ...target,
      ...(target.weapon ? { weapon: hitScan(target.weapon as Record<string, unknown>) } : {}),
      ...(target.mine ? { mine: { ...(target.mine as object), splashRange: 1, radiusPolicy: "weapon-range-fallback", falloff: "hard-cutoff" } } : {}) }));
    assert.ok(legacy.simulation.staticTargets.some(target => target.mine), "H07 carries adapted mines");

    const restored = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, legacy);
    const upgraded = restored.checkpoint({ stateOnly: true });
    assert.deepEqual(upgraded.simulation.staticTargets, current.simulation.staticTargets);
    assert.deepEqual(upgraded.simulation.units.map(unit => [unit.weapon, unit.turnSpeed]),
      current.simulation.units.map(unit => [unit.weapon, unit.turnSpeed]));
  } finally {
    globalThis.fetch = originalFetch;
    renderer.dispose();
  }
});

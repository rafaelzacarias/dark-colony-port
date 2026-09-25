import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { campaignConstructionPolicy, loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { areHostile } from "../../src/engine/diplomacy";
import { installSourceRender } from "./fixtures/source-render";
import { loadReleaseMission } from "./fixtures/release-mission";

const root = new URL("../../", import.meta.url);
const callbacks = { onStats() {}, onUnitsChanged() {} };

async function artifactAfter(faction: "human" | "alien", number: number, unitType: number, ticks: number) {
  const renderer = installSourceRender(), originalFetch = globalThis.fetch;
  renderer.setEnabled(false);
  globalThis.fetch = async input => new Response(readFileSync(new URL(`public${String(input)}`, root)));
  try {
    const mission = await loadCampaignMission(faction, number, "browser-adapted",
      campaignConstructionPolicy(faction, number, "browser-adapted", undefined));
    const view = new MissionView(renderer.canvas(), {} as HTMLElement, callbacks, mission);
    await view.initialize();
    view.resetClock(); view.update(0);
    for (let tick = 1; tick <= ticks; tick++) { view.update(tick * 50); assert.equal(view.missionDiagnostic, undefined); }
    const entity = view.campaignSnapshot!.world.entities.find(candidate => candidate.unitType === unitType);
    assert.ok(entity, `source type ${unitType} present`);
    const id = view.nativeBindings.find(binding => binding.key === entity.key)!.simulationId;
    const saved = view.checkpoint() as unknown as { simulation: { units: { id: number; weapon: { damage: number; rangeCells: number } | null }[] } };
    return { entity, owned: view.isOwnedUnit(id), weapon: saved.simulation.units.find(unit => unit.id === id)?.weapon };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("finale artifacts: HUMAN15 ESGAARD (type68 TOXX) is an owned armed weapon47 unit", async () => {
  const { entity, owned, weapon } = await artifactAfter("human", 15, 68, 4);
  assert.deepEqual([entity.team, entity.tileX, entity.tileY, entity.health], [0, 67, 72, 1]);
  assert.equal(owned, true);
  assert.deepEqual([weapon?.damage, weapon?.rangeCells], [2000, 9]);
});

test("finale artifacts: HUMAN15 ESGAARD fires in combat after a public assault order", async () => {
  const renderer = installSourceRender(), originalFetch = globalThis.fetch;
  renderer.setEnabled(false);
  globalThis.fetch = async input => new Response(readFileSync(new URL(`public${String(input)}`, root)));
  try {
    const mission = await loadReleaseMission("human", 15);
    const view = new MissionView(renderer.canvas(), {} as HTMLElement, callbacks, mission);
    await view.initialize();
    view.resetClock(); view.update(0);
    const entity = view.campaignSnapshot!.world.entities.find(candidate => candidate.unitType === 68)!;
    const id = view.nativeBindings.find(binding => binding.key === entity.key)!.simulationId;
    const snapshot = view.simulation.snapshot, self = snapshot.units.find(unit => unit.id === id)!;
    const target = [...snapshot.units, ...snapshot.staticTargets].filter(actor => actor.health > 0 &&
      areHostile({ faction: "human", team: 0 }, actor, snapshot.teamAlliances) &&
      view.visibility[actor.cellY * view.grid.width + actor.cellX])
      .sort((left, right) => Math.hypot(left.cellX - self.cellX, left.cellY - self.cellY) - Math.hypot(right.cellX - self.cellX, right.cellY - self.cellY))[0];
    assert.ok(target, "a visible hostile exists");
    view.replaceSelection([id]);
    view.setCameraCenter(target.cellX + 0.5, target.cellY + 0.5);
    view.setOrderMode("assault");
    const camera = view.cameraView, scale = 512 / camera.width;
    const clientX = (target.cellX + 0.5 - camera.x) * scale, clientY = 226 - (target.cellY + 0.5 - camera.y - camera.height / 2) * scale;
    assert.equal(view.cursorAt(clientX, clientY), "attack");
    view.commandAt(clientX, clientY);
    const shots: { targetId: number; damage: number }[] = [];
    for (let tick = 1; tick <= 800 && shots.length === 0; tick++) {
      view.update(tick * 50);
      assert.equal(view.missionDiagnostic, undefined);
      for (const event of view.simulation.combatEvents) {
        const shot = event as { type?: string; attackerId?: number; targetId?: number; damage?: number };
        if (shot.type === "shot" && shot.attackerId === id) shots.push({ targetId: shot.targetId!, damage: shot.damage! });
      }
    }
    assert.ok(shots.length > 0 && shots[0].damage > 0, "ESGAARD fired its weapon");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("finale artifacts: ALIEN15 TRO18 delivers owned armed PORTALIS (type105) after c>180",
  { skip: process.env.DC_FINALE_LONG !== "1" && "set DC_FINALE_LONG=1 (3100-tick run)" }, async () => {
    const { entity, owned, weapon } = await artifactAfter("alien", 15, 105, 3100);
    assert.deepEqual([entity.team, entity.health], [0, 3200]);
    assert.equal(owned, true);
    assert.deepEqual([weapon?.damage, weapon?.rangeCells], [2000, 9]);
  });

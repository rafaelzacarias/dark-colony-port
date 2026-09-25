import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { MissionView } from "../../src/mission-view";
import { radarMarkers, snapshotRadarEntities } from "../../src/ui/radar";
import type { UnitSnapshot } from "../../src/engine/simulation";
import { parseTriggerScript } from "../extractors/data/triggers";
import { loadReleaseMission } from "./fixtures/release-mission";
import { installSourceRender } from "./fixtures/source-render";

const callbacks = { onStats() {}, onUnitsChanged() {} };

async function fixture(sharedVision = false) {
  const renderer = installSourceRender(), originalFetch = globalThis.fetch;
  renderer.setEnabled(false);
  globalThis.fetch = async input => new Response(readFileSync(new URL(`../../public${String(input)}`, import.meta.url)));
  const source = await loadReleaseMission("human", 2);
  const mission = sharedVision ? { ...source, triggers: source.triggers.map((block, index) => index === 0
    ? { ...block, actions: [...block.actions, ...parseTriggerScript("0 norm 1 (c>0)\nvision 0 1 1\nend")[0].actions] }
    : block) } : source;
  const view = new MissionView(renderer.canvas(), {} as HTMLElement, callbacks, mission);
  await view.initialize();
  view.resetClock(); view.update(0);
  let tick = 0;
  return {
    view, mission, renderer,
    get tick() { return tick; },
    step() { view.update(++tick * 50); assert.equal(view.missionDiagnostic, undefined); },
    restore(saved = view.checkpoint()) {
      return MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(saved)));
    },
    dispose() { view.dispose(); globalThis.fetch = originalFetch; renderer.dispose(); },
  };
}

function move(view: MissionView, ids: readonly number[], x: number, y: number): void {
  view.replaceSelection(ids);
  view.setOrderMode("move");
  view.setCameraCenter(x + 0.5, y + 0.5);
  const camera = view.cameraView;
  view.commandAt((x + 0.5 - camera.x) * 32, (camera.y + camera.height - y - 0.5) * 32);
}

for (const sharedVision of [false, true]) test(`Human 2: first-shot team reveal (shared vision: ${sharedVision})`, async () => {
  const run = await fixture(sharedVision);
  try {
    const { view } = run;
    const dishIds = new Set(view.checkpoint().state.unitStats.filter(stat => stat.type === 86).map(stat => stat.id));
    let found = false;
    for (let step = 0; step < 220 && !found; step++) {
      const before = view.visibilityForTeam(1);
      run.step();
      const shot = view.simulation.combatEvents.find(event => dishIds.has(event.targetId));
      if (!shot) continue;
      const actor = view.simulation.snapshot.units.find(actor => actor.id === shot.attackerId)!;
      const cell = actor.cellY * view.grid.width + actor.cellX;
      assert.equal(before[cell], 0, "approach/attack orders do not reveal an attacker before it fires");
      assert.equal(view.visibilityForTeam(1)[cell], 1);
      assert.equal(view.visibility[cell], Number(sharedVision), "only directed shared vision extends the target team's reveal");
      assert.equal(view.visibilityForTeam(7)[cell], 0);
      assert.equal(view.visibilityForTeam(1)[cell - 1], 0, "firing reveals one tile, not a sight-radius circle");
      const saved = view.checkpoint();
      const reveal = saved.state.combatReveals!.find(entry => entry.id === actor.id)!;
      assert.deepEqual(reveal, { id: actor.id, team: 1, expiresAt: view.simulation.snapshot.tick + 31 });
      const restored = run.restore();
      assert.deepEqual(restored.checkpoint(), saved);
      assert.deepEqual(restored.visibilityForTeam(1), view.visibilityForTeam(1));
      restored.dispose();
      for (const invalid of [
        [{ ...reveal, expiresAt: view.simulation.snapshot.tick }],
        [{ ...reveal, expiresAt: reveal.expiresAt + 1 }],
        [{ ...reveal, team: 8 }],
        [reveal, reveal],
        [{ ...reveal, id: 999999 }],
      ]) {
        const bad = structuredClone(saved);
        bad.state.combatReveals = invalid;
        assert.throws(() => run.restore(bad), /checkpoint/i);
      }
      const legacy = structuredClone(saved);
      delete legacy.state.combatReveals;
      const oldSave = run.restore(legacy);
      assert.deepEqual(oldSave.checkpoint(), legacy, "old saves without transient reveals still restore exactly");
      assert.equal(oldSave.visibilityForTeam(1)[cell], 0);
      oldSave.dispose();
      found = true;
    }
    assert.ok(found, "original Human 2 reinforcements fired at a DISH");
  } finally { run.dispose(); }
});

test("Human 2: firing at owned dishes stays visible after troops leave, including radar and targeting", async () => {
  const run = await fixture();
  try {
    const { view } = run;
    const dishIds = new Set(view.checkpoint().state.unitStats.filter(stat => stat.type === 86).map(stat => stat.id));
    const evacuated = new Set<number>();
    let found = false;
    for (let step = 0; step < 1400 && !found; step++) {
      run.step();
      if (![...dishIds].some(id => view.isOwnedUnit(id))) continue;
      const troops = view.simulation.snapshot.units.filter(actor => view.isOwnedUnit(actor.id)
        && actor.cellX < 42 && !evacuated.has(actor.id));
      if (troops.length) {
        move(view, troops.map(actor => actor.id), 49, 62);
        troops.forEach(actor => evacuated.add(actor.id));
      }
      const shot = view.simulation.combatEvents.find(event => dishIds.has(event.targetId) && view.isOwnedUnit(event.targetId));
      if (!shot) continue;
      const actor = view.simulation.snapshot.units.find(actor => actor.id === shot.attackerId)!;
      const cell = actor.cellY * view.grid.width + actor.cellX;
      if (view.simulation.snapshot.units.some(unit => view.isOwnedUnit(unit.id) &&
        Math.abs(unit.cellX - actor.cellX) + Math.abs(unit.cellY - actor.cellY) <= 10)) continue;
      const saved = view.checkpoint();
      const legacy = structuredClone(saved);
      delete legacy.state.combatReveals;
      const sightOnly = run.restore(legacy);
      const outsideSight = sightOnly.visibility[cell] === 0;
      sightOnly.dispose();
      if (!outsideSight) continue;
      assert.equal(view.visibility[cell], 1);
      assert.equal(view.explored[cell], 1);
      assert.equal(saved.state.combatReveals!.find(entry => entry.id === actor.id)?.team, 0);
      const restored = run.restore();
      assert.deepEqual(restored.visibility, view.visibility);
      assert.deepEqual(restored.checkpoint(), saved);
      restored.dispose();
      const markers = radarMarkers(view.grid, { width: 116, height: 116 }, { visible: view.visibility,
        view: view.cameraView, entities: snapshotRadarEntities(view.simulation.snapshot, entity => view.isOwnedUnit(entity.id)) });
      assert.ok(markers.some(marker => marker.id === actor.id), "revealed shooter is present on radar");
      view.setCameraCenter(actor.cellX + 0.5, actor.cellY + 0.5);
      const camera = view.cameraView;
      const x = (actor.cellX + 0.5 - camera.x) * 32, y = (camera.y + camera.height - actor.cellY - 0.5) * 32;
      view.replaceSelection([...evacuated]);
      view.setOrderMode("assault");
      assert.equal(view.cursorAt(x, y), "attack", "revealed attacker is a legal clicked target");
      view.commandAt(x, y);
      assert.ok(view.checkpoint().simulation.commands.some(entry =>
        entry.command.type === "attack" && entry.command.targetId === actor.id));
      if (process.env.DC_FIRING_CHECKPOINT) writeFileSync(process.env.DC_FIRING_CHECKPOINT, JSON.stringify({
        version: 1, faction: "human", missionNumber: 2, savedAt: new Date().toISOString(), checkpoint: saved,
      }));
      found = true;
    }
    assert.ok(found, "a Gray firing at an owned dish is revealed outside all ordinary player sight");
  } finally { run.dispose(); }
});

test("firing reveal follows a moving attacker, refreshes on fire, expires on simulation ticks, and replays after loading", async () => {
  const run = await fixture();
  let restored: MissionView | undefined;
  try {
    const { view } = run;
    let attackerId: number | undefined, expiry = 0;
    for (let step = 0; step < 500 && attackerId === undefined; step++) {
      run.step();
      const shot = view.simulation.combatEvents.find(event => view.isOwnedUnit(event.attackerId));
      if (!shot) continue;
      attackerId = shot.attackerId;
      const reveal = view.checkpoint().state.combatReveals!.find(entry => entry.id === attackerId)!;
      assert.equal(reveal.team, 3);
      expiry = reveal.expiresAt;
      move(view, [attackerId], 49, 62);
    }
    assert.ok(attackerId);
    const initial = view.simulation.snapshot.units.find(actor => actor.id === attackerId)!;
    restored = run.restore();
    restored.update(run.tick * 50);
    while (view.simulation.snapshot.tick < expiry) {
      run.step();
      restored.update(run.tick * 50);
      assert.equal(view.simulation.combatEvents.some(shot => shot.attackerId === attackerId), false);
      assert.deepEqual(restored.checkpoint(), view.checkpoint());
      const actor: UnitSnapshot = view.simulation.snapshot.units.find(actor => actor.id === attackerId)!;
      const reveal: { expiresAt: number } | undefined = view.checkpoint().state.combatReveals?.find(entry => entry.id === attackerId);
      if (view.simulation.snapshot.tick < expiry) {
        assert.equal(reveal?.expiresAt, expiry);
        assert.equal(view.visibilityForTeam(3)[actor.cellY * view.grid.width + actor.cellX], 1);
      } else assert.equal(reveal, undefined, "no permanent unit tracking after the firing countdown expires");
    }
    const moved = view.simulation.snapshot.units.find(actor => actor.id === attackerId)!;
    assert.notEqual(moved.xSubcells, initial.xSubcells);
    const enemyReveals = view.checkpoint().state.combatReveals?.filter(entry => entry.team === 0 || entry.team === 1) ?? [];
    assert.ok(enemyReveals.some(entry => entry.expiresAt > expiry), "repeated enemy shots refresh their reveal lifetime");
  } finally { restored?.dispose(); run.dispose(); }
});

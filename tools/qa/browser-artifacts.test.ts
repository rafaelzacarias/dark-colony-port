import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { CampaignSession } from "../../src/engine/campaign-session";
import { sourceBrowserCampaignSessionOptions } from "../../src/engine/source-browser-campaign-options";
import { transportHostState } from "../../src/engine/transport-host";
import { sourceProductionVisits } from "../../src/engine/source-production-options";
import { browserVisionArtifact } from "../../src/engine/browser-artifacts";
import { MissionView } from "../../src/mission-view";
import { installSourceRender } from "./fixtures/source-render";
import { runMission03, mission03Limits, sha256 } from "./mission03-playthrough";

test("browser artifact: A04 complete source spawn, commander mapping and exact restoration", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => new Response(readFileSync(new URL(`../../public${String(input)}`, import.meta.url)));
  try {
    const mission = await loadCampaignMission("alien", 4, "browser-adapted");
    const options = sourceBrowserCampaignSessionOptions(mission);
    const triggers = mission.triggers.map(block => block.id === 9 ? { ...block, condition: "(c==6)" }
      : block.id === 10 ? { ...block, condition: "(c==7)" } : block);
    assert.deepEqual(triggers.map(block => block.actions), mission.triggers.map(block => block.actions));
    const session = new CampaignSession({ ...options, triggers });
    assert.deepEqual(options.commanders.at(-1), { team: 4, unitType: 69, sprite: "TRSC" });
    for (let tick = 1; tick <= 112; tick++) {
      if (tick === 112) {
        const before = session.checkpoint();
        assert.deepEqual(CampaignSession.restore(JSON.parse(JSON.stringify(before))).checkpoint(), before);
      }
      const before = session.browserViewSnapshot;
      const result = session.stepForBrowserView({ clockMilliseconds: tick * 50,
        ...(before.production ? { productionVisits: sourceProductionVisits(before.world, before.production, 150) } : {}) });
      assert.ok(result.ok, JSON.stringify(result.ok ? null : result.diagnostics));
    }
    const world = session.snapshot.world;
    const artifact = world.entities.find(actor => actor.unitType === 94 && actor.team === 0)!;
    assert.ok(artifact);
    assert.equal(artifact.team, 0);
    assert.equal(artifact.health, 300);
    assert.deepEqual([artifact.tileX, artifact.tileY], [6, 6]);
    const host = transportHostState(world);
    assert.ok(host.requests.some(request => request.type === "create" && request.unitType === 94
      && request.team === 0 && request.slot === artifact.rawSlot && request.generation === artifact.generation));
    assert.equal(host.registry[artifact.rawSlot!], artifact.key);
    assert.equal(host.flying[6 * mission.map.width + 6], artifact.rawSlot);
    assert.ok(!host.ground.includes(artifact.rawSlot!));
    assert.equal(world.entities.find(actor => actor.rawSlot === world.commanderSlots[4])?.unitType, 69);
    const after = session.checkpoint();
    assert.deepEqual(CampaignSession.restore(JSON.parse(JSON.stringify(after))).checkpoint(), after);
    const stat = mission.units.find(unit => unit.index === 94)!;
    assert.ok(browserVisionArtifact(stat));
    for (const invalid of [{ ...stat, index: 95 }, { ...stat, movementSpeed: 1 }, { ...stat, sprite: "CRYO" },
      { ...stat, rawTail: [] }, { ...stat, weapons: [1, -1, -1] as const },
      { ...stat, rawTail: stat.rawTail.map((value, index) => index === 2 ? 1 : value) }]) {
      assert.equal(browserVisionArtifact(invalid), false);
      if (invalid.index === 94) assert.throws(() => new CampaignSession({ ...options,
        units: mission.units.map(unit => unit.index === 94 ? invalid : unit) }), /Unsupported source vision artifact|Missing movement class for type 94/);
    }
    const strict = new CampaignSession({ ...options, runtimeProfile: undefined, browserAi: undefined,
      browserEconomy: undefined, production: undefined });
    assert.ok(!transportHostState(strict.snapshot.world).definitions.some(definition => definition.unitType === 94));
  } finally { globalThis.fetch = originalFetch; }
});

test("browser artifact: actual AL03 trip350 exact view pre/post spawn and authored inert art", {
  skip: process.env.DC_ARTIFACT_ACTUAL !== "1",
}, async () => {
  const directory = `/tmp/dc-artifact-al03-boundary-${process.pid}-${Date.now()}`;
  const result = await runMission03("alien", directory, mission03Limits(60000, 350));
  assert.equal(result.status, "HARNESS_LIMIT");
  assert.equal(result.spawn94, false);
  const before = JSON.parse(readFileSync(`${directory}/checkpoint.json`, "utf8"));
  const renderer = installSourceRender();
  renderer.setEnabled(false);
  const originalFetch = globalThis.fetch;
  const fetched = new Set<string>();
  globalThis.fetch = async input => {
    fetched.add(String(input));
    return new Response(readFileSync(new URL(`../../public${String(input)}`, import.meta.url)));
  };
  const views: MissionView[] = [];
  try {
    const mission = await loadCampaignMission("alien", 3, "browser-adapted");
    assert.equal(sha256(JSON.stringify(mission)), before.sourceHash);
    const restore = async (checkpoint: ReturnType<MissionView["checkpoint"]>) => {
      const view = MissionView.restore(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} },
        mission, JSON.parse(JSON.stringify(checkpoint)));
      views.push(view);
      assert.deepEqual(view.checkpoint(), checkpoint);
      await view.initialize();
      assert.equal(view.missionDiagnostic, undefined);
      view.resetClock(); view.update(0);
      return view;
    };
    const view = await restore(before.view);
    view.update(50);
    assert.equal(view.simulation.snapshot.tick, 351);
    assert.equal(view.missionDiagnostic, undefined);
    const entry = view.campaignJournal.at(-1)!;
    assert.ok(entry.fired.includes(8));
    assert.equal(view.campaignSnapshot!.controller.runtime.lives[3], 1);
    const actor = view.campaignSnapshot!.world.entities.find(actor => actor.unitType === 94 && actor.team === 0)!;
    const binding = view.nativeBindings.find(binding => binding.key === actor.key)!;
    const staticTarget = view.simulation.snapshot.staticTargets.find(target => target.id === binding.simulationId)!;
    assert.ok(staticTarget);
    assert.equal(staticTarget.weapon, undefined);
    assert.ok(!view.simulation.snapshot.units.some(unit => unit.id === binding.simulationId));
    assert.ok(!view.simulation.staticObstacleCells.some(cell => cell.x === 92 && cell.y === 10));
    assert.equal(view.visibilityForTeam(0)[10 * view.grid.width + 100], 1);
    view.replaceSelection([binding.simulationId]);
    assert.deepEqual(view.selectedIds, []);
    const after = view.checkpoint();
    writeFileSync(`${directory}/after-spawn.json`, JSON.stringify({ sourceHash: before.sourceHash, view: after }));
    const replay = await restore(after);
    for (let offset = 1; offset <= 4; offset++) {
      view.update((offset + 1) * 50); replay.update(offset * 50);
      assert.equal(view.missionDiagnostic, undefined);
      assert.deepEqual(replay.checkpoint(), view.checkpoint());
    }
    renderer.setEnabled(true);
    view.setCameraCenter(92.5, 10.5);
    view.render();
    const art = renderer.evidence();
    assert.ok(fetched.has("/assets/generated/animations/DOTT.json"));
    const sprite = JSON.parse(readFileSync(new URL("../../public/assets/generated/sprites/SPRITES/DOTT.json", import.meta.url), "utf8"));
    assert.deepEqual(sprite.atlas, { file: "DOTT.png", width: 1, height: 1 });
    assert.ok(art.imageDraws > 0);
    assert.ok(!art.warnings.some(warning => /missing-state:DOTT|unsupported-timeline:DOTT/.test(warning)));
    const proof = { beforeTick: 350, afterTick: 351, continuedTick: 355, exactRestore: true,
      beforeHash: sha256(JSON.stringify(before.view)), afterHash: sha256(JSON.stringify(after)), actor, binding, art,
      spriteSource: sprite.source, animationFetched: true };
    writeFileSync(`${directory}/artifact-proof.json`, JSON.stringify(proof));
    console.log(JSON.stringify({ directory, ...proof, art: { images: art.images.filter(path => path.includes("DOTT")) } }));
  } finally { for (const view of views) view.dispose(); renderer.dispose(); globalThis.fetch = originalFetch; }
});

test("browser artifact: AL03 ready WIN preserves original artifact through exact pending replay", {
  skip: !process.env.DC_AL03_ARTIFACT_PROOF,
}, () => {
  const directory = process.env.DC_AL03_ARTIFACT_PROOF!;
  const json = (name: string) => JSON.parse(readFileSync(`${directory}/${name}.json`, "utf8"));
  const result = json("result"), proof = json("proof"), pending = json("pending-win"), ready = json("checkpoint");
  assert.equal(result.status, "WIN");
  assert.equal(result.outcome.ready, true);
  assert.equal(result.outcome.resultCode, 0);
  assert.equal(result.exactCheckpoint, true);
  assert.equal(result.trip8, true);
  assert.equal(result.spawn94, true);
  assert.equal(proof.fromTick, pending.view.simulation.tick);
  assert.equal(proof.toTick, ready.view.simulation.tick);
  assert.equal(proof.expectedHash, sha256(JSON.stringify(ready.view)));
  assert.equal(proof.actualHash, proof.expectedHash);
  assert.equal(proof.sourceHash, pending.sourceHash);
  assert.equal(pending.sourceHash, ready.sourceHash);
  for (let slot = 0; slot < 5; slot++) assert.equal(result.buildingSlots[`1,${slot}`], 0);
  assert.deepEqual(json("integrity").changed, []);
  assert.equal(json("exit").code, 0);
  const artifacts = [pending, ready].map((saved: { view: ReturnType<MissionView["checkpoint"]> }) => {
    const metadata = saved.view.state.unitStats.find(stat => stat.type === 94);
    assert.ok(metadata);
    const target = saved.view.simulation.staticTargets.find((target: { id: number }) => target.id === metadata.id);
    assert.ok(target);
    assert.equal(target.health, 300);
    assert.equal(target.weapon, undefined);
    return { metadata, target };
  });
  assert.deepEqual(artifacts[0], artifacts[1]);
});
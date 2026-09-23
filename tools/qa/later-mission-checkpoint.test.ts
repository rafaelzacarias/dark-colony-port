import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView, missionAnimationArchives, missionVisualSprites, type MissionViewCheckpoint } from "../../src/mission-view";
import { installSourceRender } from "./fixtures/source-render";
import { parseFin } from "../extractors/animations/fin";
import { createFinFrameLookup, createFinSelector, TRSC_GRAY_VISUAL_DIRECTIONS, type FinAnimationData } from "../../src/render/fin-animation";

const root = new URL("../../public/", import.meta.url);
const callbacks = { onStats() {}, onUnitsChanged() {} };

for (const [faction, number, actors] of [["human", 11, 108], ["alien", 14, 78]] as const) {
  test(`${faction}${number}: actual asset initialization records the unmodified render boundary`, async context => {
    const rendering = installSourceRender();
    const originalFetch = globalThis.fetch;
    const fetched = new Set<string>(), missing: string[] = [];
    let view: MissionView | undefined, restored: MissionView | undefined;
    globalThis.fetch = async input => {
      const url = String(input);
      assert.ok(url.startsWith("/assets/generated/") && !url.includes(".."));
      fetched.add(url);
      try { return new Response(readFileSync(new URL(url.slice(1), root))); }
      catch (error) { missing.push(url); throw error; }
    };
    try {
      const mission = await loadCampaignMission(faction, number);
      const source = JSON.stringify({ scenario: mission.scenario, triggers: mission.triggers });
      view = new MissionView(rendering.canvas(), {} as HTMLElement, callbacks, mission);
      assert.equal(view.nativeBindings.length, actors);
      assert.equal(view.missionDiagnostic, undefined);
      const initial = view.checkpoint();
      assert.deepEqual(initial.session!.options.triggers, mission.triggers);
      if (faction === "alien") {
        assert.ok(initial.state.unitStats.some(stat => stat.type === 4));
        assert.ok(initial.state.unitWeapons.some(entry => entry.weapon === 14));
      }
      await view.initialize();
      context.diagnostic(JSON.stringify({ mission: mission.scenario.id, diagnostic: view.missionDiagnostic,
        fetched: fetched.size, missing, ...rendering.evidence() }));
      assert.equal(view.missionDiagnostic, undefined);
      assert.deepEqual(missing, []);
      restored = MissionView.restore(rendering.canvas(), {} as HTMLElement, callbacks, mission,
        JSON.parse(JSON.stringify(view.checkpoint())));
      await restored.initialize();
      assert.equal(restored.missionDiagnostic, undefined);
      assert.deepEqual(restored.checkpoint(), view.checkpoint());
      view.update(0);
      restored.update(0);
      for (let tick = 1; tick <= 200; tick++) {
        view.update(tick * 50);
        restored.update(tick * 50);
        assert.equal(view.simulation.snapshot.tick, tick);
        assert.equal(view.missionDiagnostic, undefined, `render tick ${tick}`);
        assert.equal(restored.missionDiagnostic, undefined, `restored render tick ${tick}`);
        assert.deepEqual(view.simulation.sourceDamageDiagnostics, []);
        assert.deepEqual(restored.simulation.sourceDamageDiagnostics, []);
        assert.deepEqual(restored.checkpoint(), view.checkpoint(), `rendered restore tick ${tick}`);
        if (tick === 100) {
          const midpoint = view.checkpoint();
          restored.dispose();
          restored = MissionView.restore(rendering.canvas(), {} as HTMLElement, callbacks, mission,
            JSON.parse(JSON.stringify(midpoint)));
          await restored.initialize();
          assert.equal(restored.missionDiagnostic, undefined);
          assert.deepEqual(restored.checkpoint(), midpoint);
          restored.update(tick * 50);
        }
      }
      assert.ok(rendering.evidence().spriteDraws > 0);
      assert.ok(!rendering.evidence().warnings.some(warning => /missing-state|unsupported-timeline/.test(warning)));
      assert.deepEqual(missing, []);
      const saved = view.checkpoint();
      assert.deepEqual(saved.session!.options.triggers, mission.triggers);
      assert.deepEqual(saved.state.bindings, initial.state.bindings);
      assert.deepEqual(saved.state.unitStats, initial.state.unitStats);
      assert.deepEqual(saved.state.unitWeapons, initial.state.unitWeapons);
      assert.deepEqual(saved.simulation.units.map(unit => ({ id: unit.id, weapon: unit.weapon })),
        initial.simulation.units.map(unit => ({ id: unit.id, weapon: unit.weapon })));
      restored.dispose();
      restored = MissionView.restore(rendering.canvas(), {} as HTMLElement, callbacks, mission,
        JSON.parse(JSON.stringify(saved)));
      assert.deepEqual(restored.checkpoint(), saved);
      await restored.initialize();
      assert.equal(restored.missionDiagnostic, undefined);
      assert.deepEqual(restored.checkpoint(), saved);
      restored.update(200 * 50);
      view.update(201 * 50); restored.update(201 * 50);
      assert.equal(view.simulation.snapshot.tick, 201);
      assert.equal(view.missionDiagnostic, undefined);
      assert.equal(restored.missionDiagnostic, undefined);
      assert.deepEqual(view.simulation.sourceDamageDiagnostics, []);
      assert.deepEqual(restored.checkpoint(), view.checkpoint());
      context.diagnostic(JSON.stringify({ mission: mission.scenario.id, tick: 200,
        restoredAt: [0, 100, 200], continuedThrough: 201, actors: saved.state.bindings.length,
        weaponsRetained: saved.state.unitWeapons.length,
        fetched: fetched.size, missing, spriteDraws: rendering.evidence().spriteDraws,
        warnings: rendering.evidence().warnings }));
      assert.equal(JSON.stringify({ scenario: mission.scenario, triggers: mission.triggers }), source);
    } finally {
      restored?.dispose(); view?.dispose();
      globalThis.fetch = originalFetch;
      rendering.dispose();
    }
  });

  test(`${faction}${number}: full TRO default 200 ticks and fresh restore stay exact`, async context => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async input => new Response(readFileSync(new URL(String(input).slice(1), root)));
    const canvas = () => ({ width: 512, height: 452, getContext: () => null,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) }) as unknown as HTMLCanvasElement;
    let view: MissionView | undefined, restored: MissionView | undefined;
    try {
      const mission = await loadCampaignMission(faction, number);
      const source = JSON.stringify(mission);
      view = new MissionView(canvas(), {} as HTMLElement, callbacks, mission);
      const fresh = view.checkpoint();
      assert.equal(fresh.state.bindings.length, actors);
      assert.equal(fresh.state.unitTeams.filter(actor => actor.team === 0).length, faction === "human" ? 6 : 11);
      assert.equal(fresh.session!.options.campaignAi, undefined);
      assert.equal(fresh.session!.options.aiSelector, undefined);
      assert.equal(fresh.session!.options.nativeAiTasks, undefined);
      assert.equal(fresh.session!.options.nativeCombat, undefined);
      assert.deepEqual(fresh.session!.options.source.teams.map(team => team.ai), mission.scenario.teams.map(team => team.ai));
      const initialKeys = new Set(fresh.state.bindings.map(binding => binding.key));
      restored = MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(fresh)));
      assert.deepEqual(restored.checkpoint(), fresh);
      view.update(0); restored.update(0);
      for (let tick = 1; tick <= 200; tick++) {
        view.update(tick * 50); restored.update(tick * 50);
        assert.equal(view.simulation.snapshot.tick, tick, `tick ${tick}: ${view.missionDiagnostic}`);
        assert.equal(view.missionDiagnostic, undefined);
        assert.deepEqual(view.simulation.sourceDamageDiagnostics, []);
        assert.deepEqual(restored.checkpoint(), view.checkpoint(), `restored tick ${tick}`);
        const saved = view.checkpoint();
        assert.deepEqual(saved.session!.options.triggers, mission.triggers);
        for (const actor of saved.session!.state.world.entities.filter(entity => entity.health > 0)) {
          const binding = saved.state.bindings.find(entry => entry.slot === actor.rawSlot && entry.generation === actor.generation);
          assert.ok(binding, `unbound ${actor.key}`);
          assert.equal(view.isOwnedUnit(binding.simulationId), actor.team === 0, actor.key);
        }
      }
      const saved = view.checkpoint();
      const created = saved.session!.state.world.entities.filter(actor => !initialKeys.has(actor.key))
        .map(actor => ({ key: actor.key, slot: actor.rawSlot, generation: actor.generation, team: actor.team,
          type: actor.unitType, health: actor.health, tile: [actor.tileX, actor.tileY] }));
      assert.deepEqual(created, []);
      assert.equal(saved.state.bindings.length, actors);
      assert.equal(view.missionOutcome, null);
      context.diagnostic(JSON.stringify({ mission: mission.scenario.id, tick: saved.simulation.tick,
        initialActors: actors, initialPlayer: fresh.state.unitTeams.filter(actor => actor.team === 0).length,
        finalActors: saved.state.bindings.length, player: saved.state.unitTeams.filter(actor => actor.team === 0).length,
        created, outcome: view.missionOutcome, lives: saved.session!.state.controller.runtime.lives }));
      const occupied = new Set([...view.simulation.snapshot.units, ...view.simulation.snapshot.staticTargets]
        .filter(actor => actor.health > 0).map(actor => view!.grid.index(actor.cellX, actor.cellY)));
      const owned = view.simulation.snapshot.units.filter(actor => view!.isOwnedUnit(actor.id) && actor.health > 0);
      assert.ok(owned.length > 0, "original player actors must be present");
      const actor = owned.find(actor => view!.grid.neighbors(view!.grid.index(actor.cellX, actor.cellY))
        .some(index => !occupied.has(index)))!;
      assert.ok(actor, "an original player actor must have a free neighboring cell");
      const destination = view.grid.point(view.grid.neighbors(view.grid.index(actor.cellX, actor.cellY))
        .find(index => !occupied.has(index))!);
      const foreign = view.simulation.snapshot.units.filter(actor => !view!.isOwnedUnit(actor.id));
      assert.ok(foreign.length > 0);
      view.replaceSelection(foreign.map(actor => actor.id));
      assert.deepEqual(view.selectedIds, []);
      view.replaceSelection([actor.id, ...foreign.map(actor => actor.id)]);
      assert.deepEqual(view.selectedIds, [actor.id]);
      view.selectAllPlayerUnits();
      assert.deepEqual(view.selectedIds, owned.map(actor => actor.id).sort((left, right) => left - right));
      view.replaceSelection([actor.id]);
      view.setOrderMode("move");
      view.setCameraCenter(destination.x + 0.5, destination.y + 0.5);
      const camera = view.cameraView;
      view.commandAt((destination.x + 0.5 - camera.x) * 32,
        (camera.y + camera.height - destination.y - 0.5) * 32);
      const pending = view.checkpoint();
      assert.ok(pending.combatMovement.intents.some(entry => entry.id === actor.id && entry.intent.pending));
      view.update(201 * 50);
      const moving = view.checkpoint();
      const moved = moving.simulation.units.find(unit => unit.id === actor.id)!;
      assert.equal(moved.activity, "move");
      assert.ok(moved.path.length > 0);
      assert.notEqual(moved.reservedDestination, null);
      restored.dispose();
      restored = MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(moving)));
      assert.deepEqual(restored.checkpoint(), moving);
      restored.update(201 * 50);
      for (let tick = 202; tick <= 220; tick++) {
        view.update(tick * 50); restored.update(tick * 50);
        assert.equal(view.missionDiagnostic, undefined);
        assert.deepEqual(view.simulation.sourceDamageDiagnostics, []);
        assert.deepEqual(restored.checkpoint(), view.checkpoint(), `moving restore tick ${tick}`);
      }
      const after = view.simulation.snapshot.units.find(unit => unit.id === actor.id)!;
      assert.ok(after.xSubcells !== actor.xSubcells || after.ySubcells !== actor.ySubcells);
      view.stopSelected(); restored.stopSelected();
      view.update(221 * 50); restored.update(221 * 50);
      assert.deepEqual(restored.checkpoint(), view.checkpoint());
      assert.equal(view.missionDiagnostic, undefined);
      for (const mutate of [
        (copy: MissionViewCheckpoint) => { copy.state.unitStats[0].type = 105; },
        (copy: MissionViewCheckpoint) => { copy.state.unitWeapons[0].weapon = copy.state.unitWeapons[0].weapon === 62 ? 5 : 62; },
        (copy: MissionViewCheckpoint) => { copy.state.unitTeams[0].team = 7; },
        (copy: MissionViewCheckpoint) => { copy.state.bindings[0] = { ...copy.state.bindings[0], key: "forged" }; },
        (copy: MissionViewCheckpoint) => { copy.state.selectedIds = [foreign[0].id]; },
      ]) {
        const tampered = JSON.parse(JSON.stringify(moving));
        mutate(tampered);
        assert.throws(() => MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, tampered),
          /Invalid MissionView checkpoint/);
      }
      assert.throws(() => MissionView.restore(canvas(), {} as HTMLElement, callbacks,
        { ...mission, triggers: [] }, moving), /Invalid MissionView checkpoint/);
      assert.throws(() => MissionView.restore(canvas(), {} as HTMLElement, callbacks,
        { ...mission, damageMatrix: undefined }, moving), /Invalid MissionView checkpoint/);
      context.diagnostic(JSON.stringify({ mission: mission.scenario.id, publicMove: { id: actor.id,
        team: 0, from: [actor.cellX, actor.cellY], destination, checkpointTick: 201 },
        continuedThrough: 221, foreignSelectionRejected: foreign.length }));
      assert.equal(JSON.stringify(mission), source);
    } finally {
      restored?.dispose(); view?.dispose(); globalThis.fetch = originalFetch;
    }
  });
}

test("later mission contracts: original outcomes and foreseeable archive handoff remain explicit", async context => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => new Response(readFileSync(new URL(String(input).slice(1), root)));
  try {
    for (const [faction, number] of [["human", 11], ["alien", 14]] as const) {
      const mission = await loadCampaignMission(faction, number);
      const blocks = mission.triggers;
      const missing = missionVisualSprites(mission).flatMap(sprite => missionAnimationArchives(sprite)
        .filter(archive => !existsSync(new URL(`assets/generated/animations/${archive}.json`, root)))
        .map(archive => ({ sprite, archive })));
      assert.deepEqual(missing, []);
      if (faction === "alien") {
        const sprites = missionVisualSprites(mission);
        const archives = new Set(sprites.flatMap(sprite => [...missionAnimationArchives(sprite)]));
        let children = 0;
        for (const name of archives) {
          const generated = JSON.parse(readFileSync(new URL(`assets/generated/animations/${name}.json`, root), "utf8"));
          const bytes = readFileSync(new URL(`../../raw_cd/DC/ANIMATE/${name}.FIN`, import.meta.url));
          const original = parseFin(bytes);
          assert.equal(generated.source.sha256, createHash("sha256").update(bytes).digest("hex"), name);
          assert.deepEqual(generated.states, original.states, name);
          assert.deepEqual(generated.timeline, original.timeline, name);
          const metadata = Object.fromEntries(original.spriteNames.map(sprite => [sprite,
            JSON.parse(readFileSync(new URL(`assets/generated/sprites/SPRITES/${sprite.toUpperCase()}.json`, root), "utf8"))]));
          const lookup = createFinFrameLookup(metadata);
          for (const sprite of original.spriteNames) {
            const image = readFileSync(new URL(`assets/generated/sprites/SPRITES/${sprite.toUpperCase()}.png`, root));
            assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
            for (const frame of metadata[sprite].frames) assert.ok(frame.x >= 0 && frame.y >= 0
              && frame.x + frame.width <= image.readUInt32BE(16)
              && frame.y + frame.height <= image.readUInt32BE(20), `${sprite}:${frame.index}`);
          }
          for (const frame of original.timeline) for (const child of frame.children) {
            assert.ok(lookup(child.sprite, child.frame), `${name}:${child.sprite}:${child.frame}`);
            children++;
          }
        }
        const cam = JSON.parse(readFileSync(new URL("assets/generated/animations/CAMM.json", root), "utf8")) as FinAnimationData;
        const selector = createFinSelector(cam, { prefix: "CAM", directions: TRSC_GRAY_VISUAL_DIRECTIONS, layerOrder: "source" });
        assert.equal(selector.select("Stand", "N")?.state.name, "CAMSTAND0");
        assert.equal(selector.select("Die", "N")?.state.name, "CAMDIE0");
        context.diagnostic(JSON.stringify({ mission: mission.scenario.id, sprites, archives: [...archives], children, missing }));
      }
      const bail = blocks.filter(block => block.actions.some(action => action.name === "bail"))
        .map(block => ({ id: block.id, mode: block.mode, flag: block.flag, condition: block.condition,
          result: block.actions.find(action => action.name === "bail")!.arguments }));
      assert.deepEqual(bail, faction === "human" ? [
        { id: 10, mode: "norm", flag: 1,
          condition: "((s(0,0,69)==1)||(s(0,0,70)==1)||(s(0,0,71)==1)||(s(0,0,72)==1))", result: [1, 2] },
        { id: 12, mode: "norm", flag: 0, condition: "(s(1,3)==7)", result: [0, 1] },
        { id: 13, mode: "trip", flag: 0, condition: "(S==0)", result: [0, 1] },
      ] : [
        { id: 3, mode: "trip", flag: 1, condition: "(S==0)", result: [0, 1] },
        { id: 18, mode: "norm", flag: 1,
          condition: "((s(0,0,73)==1)||(s(0,0,74)==1)||(s(0,0,75)==1)||(s(0,0,76)==1))", result: [1, 2] },
      ]);
      for (const block of bail) assert.ok(mission.scenario.outcomes?.some(outcome => outcome.reasonCode === block.result[1]));
      if (faction === "human") {
        assert.deepEqual(blocks.find(block => block.id === 9)!.actions.filter(action => action.name === "setlifes")
          .map(action => action.arguments), [[11, 0], [12, 1]]);
        assert.equal(blocks.find(block => block.id === 11)!.condition, "(s(1,3)==7)");
        assert.deepEqual(blocks.find(block => block.id === 11)!.actions.filter(action => action.name === "setlifes")
          .map(action => action.arguments), [[9, 0], [13, 1]]);
      } else {
        assert.deepEqual(blocks.find(block => block.id === 3)!.actions.find(action => action.name === "reinforce2")!
          .arguments, [1, 54, 50, 10, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
        const archive = JSON.parse(readFileSync(new URL("assets/generated/animations/CAMM.json", root), "utf8"));
        assert.deepEqual(archive.states.map((state: { name: string }) => state.name), ["CAMSTAND0", "CAMDIE0"]);
        assert.ok(archive.spriteNames.includes("camm"));
        assert.ok(existsSync(new URL("assets/generated/sprites/SPRITES/CAMM.png", root)));
      }
    }
  } finally { globalThis.fetch = originalFetch; }
});
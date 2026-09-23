import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseScenario } from "../extractors/data/scenario";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { CampaignSession } from "../../src/engine/campaign-session";
import { sourceProductionVisits } from "../../src/engine/source-production-options";
import { createBrowserResearchConfiguration } from "../../src/engine/browser-research";
import { installSourceRender } from "./fixtures/source-render";

const root = new URL("../../public/", import.meta.url);
const callbacks = { onStats() {}, onUnitsChanged() {} };

for (const centerTeam of [-1, 0, 2]) {
  test(`research view H07: source center team ${centerTeam}, isolation and JSON compatibility`, async context => {
    const renderer = installSourceRender();
    const requests: string[] = [];
    context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      const bytes = readFileSync(new URL(url.slice(1), root));
      if (centerTeam < 0 || !url.endsWith("/scenarios/HUMAN/HUMAN07.json")) return new Response(bytes);
      const envelope = JSON.parse(bytes.toString());
      let team = -1;
      const raw = Buffer.from(envelope.rawScenario, "base64").toString("latin1")
        .replace(/%City\r?\n([^\r\n]+)/g, (match, row: string) => {
          team++;
          if (team !== centerTeam) return match;
          const fields = row.trim().split(/\s+/);
          fields[8] = "1"; fields[9] = "3600";
          return match.replace(row, fields.join(" "));
        });
      const scenario = { ...envelope, ...parseScenario(raw), rawScenario: Buffer.from(raw, "latin1").toString("base64"),
        source: { ...envelope.source, sha256: createHash("sha256").update(raw, "latin1").digest("hex") } };
      return new Response(JSON.stringify(scenario));
    });
    const views: MissionView[] = [];
    try {
      const mission = await loadCampaignMission("human", 7, "browser-adapted");
      const source = JSON.stringify(mission);
      const view = new MissionView(renderer.canvas(), {} as HTMLElement, callbacks, mission);
      views.push(view);
      assert.equal(view.missionDiagnostic, undefined);
      const initial = view.researchDiscovery!;
      assert.equal(initial.research.spyTeams[0], centerTeam === 0);
      assert.equal(initial.research.spyTeams[2], centerTeam === 2);
      assert.equal(initial.revealsTerrain, false);
      assert.ok(initial.entries.every(entry => !entry.visible));
      assert.ok(initial.entries.every(entry => !view.nativeBindings.some(binding => binding.key === entry.key)));
      await view.initialize();
      assert.equal(view.missionDiagnostic, undefined);
      assert.equal(requests.some(url => /POOP/i.test(url)), false);
      assert.ok(requests.some(url => url.endsWith("/indexed/sprites/CURSOR/CURS.json")));
      const saved = view.checkpoint();
      const restored = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(saved)));
      views.push(restored);
      assert.deepEqual(restored.checkpoint(), saved);
      const corrupt = structuredClone(saved);
      Object.assign(corrupt.research!.state, { spyTeams: Array(8).fill(true) });
      assert.throws(() => MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, corrupt), /saved research/);
      const legacy = new MissionView(renderer.canvas(), {} as HTMLElement, callbacks, mission, undefined, undefined, null);
      views.push(legacy);
      renderer.setEnabled(false);
      legacy.update(0); legacy.update(50);
      assert.equal(legacy.missionDiagnostic, undefined);
      assert.equal(legacy.checkpoint().research, undefined);
      assert.deepEqual(legacy.campaignSnapshot!.world.markerSpyTeams, Array(8).fill(false));
      assert.ok(legacy.campaignSnapshot!.world.scenarioMarkers!.every(marker => marker.remainingVisits === 450));
      const legacySaved = legacy.checkpoint();
      const legacyRestored = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission,
        JSON.parse(JSON.stringify(legacySaved)));
      views.push(legacyRestored);
      assert.deepEqual(legacyRestored.checkpoint(), legacySaved);
      const session = CampaignSession.restore(saved.session!);
      const world = session.snapshot.world;
      const productionVisits = sourceProductionVisits(world, session.snapshot.production!, mission.sourceProduction!.initialPopulationCeiling);
      const frame = { spyTeams: Array.from({ length: 8 }, (_, team) => team === 0), idleHarvesterSlots: [] };
      const result = session.step({ clockMilliseconds: 50, productionVisits, type37Frame: frame });
      assert.equal(result.ok, centerTeam === 0, JSON.stringify(result.ok ? {} : result.diagnostics));
      if (centerTeam === 0) {
        const beforeDeath = session.checkpoint();
        const research = createBrowserResearchConfiguration({ runtimeProfile: "browser-adapted",
          activation: "source-city-slot4-health", scienceOwner: "campaign-session-city", source: beforeDeath.options.source,
          units: mission.units, dependencies: mission.sourceProduction!.production!.records });
        const projectedDeath = session.browserResearchFrame(research, { snapshot: view.simulation.snapshot,
          bindings: view.nativeBindings, updates: [{ type: "combat-death", slot: 4, generation: 0 }] });
        assert.equal(projectedDeath.spyTeams[0], false);
        assert.deepEqual(session.checkpoint(), beforeDeath, "observation cannot commit center death");
        const dead = session.step({ clockMilliseconds: 100,
          productionVisits: sourceProductionVisits(session.snapshot.world, session.snapshot.production!, mission.sourceProduction!.initialPopulationCeiling),
          updates: [{ type: "combat-death", slot: 4, generation: 0 }],
          type37Frame: { spyTeams: Array(8).fill(false), idleHarvesterSlots: [] } });
        assert.ok(dead.ok, JSON.stringify(dead));
        assert.equal(dead.value.world.buildingSlots["0,4"], 0);
        assert.deepEqual(CampaignSession.restore(JSON.parse(JSON.stringify(beforeDeath))).checkpoint(), beforeDeath);
        assert.deepEqual(CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint()))).checkpoint(), session.checkpoint());
        const afterDeath = session.checkpoint();
        const forged = session.step({ clockMilliseconds: 150,
          productionVisits: sourceProductionVisits(session.snapshot.world, session.snapshot.production!, mission.sourceProduction!.initialPopulationCeiling),
          type37Frame: frame });
        assert.equal(forged.ok, false);
        assert.deepEqual(session.checkpoint(), afterDeath, "forged unlock after death rolls back");
      }
      assert.equal(JSON.stringify(mission), source);
      if (centerTeam !== 0) return;
      let clock = 0;
      view.resetClock(); view.update(0);
      const step = () => {
        clock += 50; view.update(clock);
        assert.equal(view.missionDiagnostic, undefined, `tick ${view.simulation.snapshot.tick}`);
      };
      for (let tick = 0; tick < 200; tick++) step();
      const collector = view.browserEconomyState!.harvesters.find(actor => actor.team === 0)!;
      assert.ok(collector, "original public collector delivered");
      const binding = view.nativeBindings.find(entry => entry.key === collector.key)!;
      const marker = view.researchDiscovery!.entries.find(entry => entry.tileX === 5 && entry.tileY === 32)!;
      assert.ok(marker);
      const pending = [...marker.pendingTypes];
      view.replaceSelection([binding.simulationId]);
      view.setOrderMode("move");
      view.setCameraCenter(marker.tileX + 0.5, marker.tileY + 0.5);
      const camera = view.cameraView;
      view.commandAt((marker.tileX + 0.5 - camera.x) * 32, (camera.y + camera.height - marker.tileY - 0.5) * 32);
      let eligible = 0;
      for (let count = 0; count < 2400 && eligible < 900; count++) {
        step();
        const current = view.researchDiscovery!.entries.find(entry => entry.key === marker.key)!;
        if (current.remainingVisits < 450 || current.pendingTypes.length < pending.length) eligible++;
        if (eligible > 0) {
          assert.equal(current.visible, true);
          assert.equal(current.remainingVisits, 450 - eligible % 450);
          assert.equal(current.pendingTypes.length, pending.length - Math.floor(eligible / 450));
        }
        if (eligible === 449 || eligible === 450 || eligible === 899 || eligible === 900) {
          const checkpoint = view.checkpoint();
          const mirror = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(checkpoint)));
          assert.deepEqual(mirror.checkpoint(), checkpoint);
          mirror.dispose();
          if (eligible === 450 || eligible === 900) {
            const artifacts = view.campaignSnapshot!.world.entities.filter(entity => entity.unitType === 63);
            assert.equal(artifacts.length, eligible / 450);
            for (const artifact of artifacts) {
              assert.equal(artifact.health, 400);
              assert.equal(artifact.team, 0);
              const artifactBinding = view.nativeBindings.find(entry => entry.key === artifact.key)!;
              const actor = checkpoint.simulation.units.find(entry => entry.id === artifactBinding.simulationId)!;
              assert.ok(actor && actor.weapon == null);
              assert.equal(checkpoint.session!.state.world.entityBytes![artifact.rawSlot! * 220 + 0xcb], 0);
            }
            renderer.setEnabled(true);
            const context2d = view.canvas.getContext("2d")!;
            const draw = context.mock.method(context2d, "drawImage", () => {});
            const explored = checkpoint.state.explored;
            view.render();
            const camera = view.cameraView;
            const overlay = draw.mock.calls.find(call => JSON.stringify(call.arguments.slice(1, 5)) === "[32,32,31,31]");
            assert.ok(overlay, "source CURS frame6 drawn by the actual MissionView render path");
            assert.deepEqual(overlay.arguments.slice(5), [(marker.tileX + 0.5 - camera.x) * 32 - 15.5,
              (camera.y + camera.height - marker.tileY - 0.5) * 32 - 15.5, 31, 31]);
            assert.deepEqual(view.checkpoint().state.explored, explored, "overlay does not reveal terrain");
            draw.mock.restore(); renderer.setEnabled(false);
          }
          context.diagnostic(JSON.stringify({ eligible, tick: view.simulation.snapshot.tick, pending: current.pendingTypes,
            artifacts: view.campaignSnapshot!.world.entities.filter(entity => entity.key.startsWith("transport:") && ![6, 69].includes(entity.unitType))
              .map(entity => ({ type: entity.unitType, slot: entity.rawSlot, health: entity.health })) }));
        }
      }
      assert.equal(eligible, 900);
      assert.deepEqual(view.researchDiscovery!.entries.find(entry => entry.key === marker.key)!.pendingTypes, pending.slice(2));
      assert.equal(JSON.stringify(mission), source);
    } finally {
      views.forEach(view => view.dispose()); renderer.dispose();
    }
  });
}
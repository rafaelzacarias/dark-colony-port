import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { installSourceRender } from "./fixtures/source-render";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const callbacks = { onStats() {}, onUnitsChanged() {} };

for (const faction of ["human", "alien"] as const) {
  test(`collector actual-loader ${faction.toUpperCase()}02: earned queue2 purchase, new income and JSON continuation`, async context => {
    const renderer = installSourceRender();
    context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
      const url = String(input);
      assert.ok(url.startsWith("/assets/generated/") && !url.includes(".."), url);
      return new Response(read(`public${url}`));
    });
    const views: MissionView[] = [];
    try {
      const mission = await loadCampaignMission(faction, 2, "browser-adapted");
      const sourceHash = hash(JSON.stringify(mission));
      const stem = `${faction.toUpperCase()}/${faction.toUpperCase()}02`;
      const rawHashes = Object.fromEntries(["SCN", "TRO", "MAP", "MTG", "PTH"].map(extension =>
        [extension, hash(read(`raw_cd/DC/SCENARIO/${stem}.${extension}`))]));
      assert.equal(mission.scenario.source.sha256, rawHashes.SCN);
      assert.deepEqual(Buffer.from(mission.scenario.rawScenario!, "base64"), read(`raw_cd/DC/SCENARIO/${stem}.SCN`));
      const view = new MissionView(renderer.canvas(), {} as HTMLElement, callbacks, mission);
      views.push(view);
      await view.initialize();
      assert.ok(view.terrainImage, "actual source images initialized");
      assert.ok(renderer.evidence().images.length > 0);
      renderer.setEnabled(false);
      const dependency = faction === "human" ? 7 : 21;
      const unitType = faction === "human" ? 6 : 14;
      const menu = () => view.productionMenu.find(choice => choice.dependency === dependency);
      const collectors = () => view.browserEconomyState!.harvesters.filter(actor => actor.team === 0);
      const playerOrders = () => view.browserEconomyState!.orders.filter(order => view.isOwnedUnit(order.simulationId));
      const earned = () => view.browserEconomyState!.earned[0] ?? 0;
      const credits = () => view.resourceWorkflow.credits[0];
      let clock = 0;
      let mirror: MissionView | undefined;
      const evidence: unknown[] = [];
      const detail = (phase: string) => JSON.stringify({ phase, tick: view.simulation.snapshot.tick,
        diagnostic: view.missionDiagnostic, menu: menu(), credits: credits(), economy: view.browserEconomyState,
        units: view.simulation.snapshot.units.map(unit => ({ id: unit.id, team: unit.team, health: unit.health,
          cellX: unit.cellX, cellY: unit.cellY, activity: unit.activity })) });
      const resetClock = () => {
        clock = 0;
        for (const target of [view, ...(mirror ? [mirror] : [])]) { target.resetClock(); target.update(0); }
      };
      const step = (phase: string) => {
        assert.ok(view.simulation.snapshot.tick < 4000, `bounded tick budget: ${phase}`);
        clock += 50;
        const before = view.simulation.snapshot.tick;
        view.update(clock);
        if (view.missionDiagnostic) assert.fail(detail(phase));
        assert.equal(view.simulation.snapshot.tick, before + 1, `clock must advance exactly once: ${phase}`);
        if (mirror) {
          mirror.update(clock);
          assert.equal(mirror.missionDiagnostic, undefined, `restored ${phase}: ${mirror.missionDiagnostic}`);
        }
      };
      const until = (phase: string, predicate: () => boolean, limit: number) => {
        for (let count = 0; count < limit && !predicate(); count++) step(phase);
        if (!predicate()) assert.fail(detail(phase));
      };
      const restore = async (phase: string) => {
        if (mirror) {
          assert.deepEqual(mirror.checkpoint(), view.checkpoint(), `${phase}: exact continuation`);
          mirror.dispose();
        }
        const saved = view.checkpoint();
        mirror = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission,
          JSON.parse(JSON.stringify(saved)));
        views.push(mirror);
        assert.deepEqual(mirror.checkpoint(), saved, `${phase}: JSON round trip`);
        await mirror.initialize();
        assert.deepEqual(mirror.checkpoint(), saved, `${phase}: initialized restored view`);
        resetClock();
        evidence.push({ phase, tick: view.simulation.snapshot.tick, exactCheckpoint: true });
      };
      const publicBoth = (command: (target: MissionView) => void) => {
        command(view);
        if (mirror) command(mirror);
      };
      const harvest = (id: number) => {
        const actor = view.simulation.snapshot.units.find(unit => unit.id === id)!;
        assert.ok(actor && actor.health > 0);
        const sources = view.resourceSources.filter(source => (source.rate ?? 0) > 0 && (source.remaining ?? 0) > 0 &&
          view.visibility[(source.position.y >> 8) * view.grid.width + (source.position.x >> 8)])
          .sort((left, right) => Math.abs((left.position.x >> 8) - actor.cellX) + Math.abs((left.position.y >> 8) - actor.cellY) -
            Math.abs((right.position.x >> 8) - actor.cellX) - Math.abs((right.position.y >> 8) - actor.cellY));
        view.replaceSelection([id]);
        const source = sources.find(node => view.harvestSelected(node.slot));
        assert.ok(source, `visible reachable source for collector ${id}`);
        if (mirror) {
          mirror.replaceSelection([id]);
          assert.equal(mirror.harvestSelected(source.slot), true);
        }
        evidence.push({ phase: "public-harvest", tick: view.simulation.snapshot.tick, id, source: source.key, rate: source.rate });
        return source;
      };
      assert.equal(view.missionDiagnostic, undefined);
      assert.equal(credits(), 0);
      assert.equal(earned(), 0);
      assert.equal(menu()?.unitType, unitType);
      assert.equal(menu()?.cost, 1500);
      assert.equal(menu()?.enabled, false);
      assert.equal(view.purchaseProduction(dependency), false);
      resetClock();
      until("original collector startup", () => collectors().length === 1, 300);
      const original = collectors()[0];
      const originalId = view.nativeBindings.find(binding => binding.key === original.key)!.simulationId;
      const originalSource = harvest(originalId);
      until("earn collector price", () => credits() >= 1500, 2500);
      publicBoth(target => { target.replaceSelection([originalId]); target.stopSelected(); });
      step("settle original stop and income");
      assert.equal(playerOrders().length, 0);
      const originalEarned = earned();
      assert.equal(credits(), originalEarned);
      const center = { x: originalSource.position.x >> 8, y: originalSource.position.y >> 8 };
      const departure = [{ x: center.x + 2, y: center.y }, { x: center.x - 2, y: center.y },
        { x: center.x, y: center.y + 2 }, { x: center.x, y: center.y - 2 }].find(cell =>
        view.grid.isPassable(cell.x, cell.y) && !view.simulation.snapshot.units.some(unit =>
          unit.health > 0 && unit.cellX === cell.x && unit.cellY === cell.y));
      assert.ok(departure, "original collector needs a vacant departure cell");
      publicBoth(target => {
        target.replaceSelection([originalId]);
        target.setOrderMode("move");
        const camera = target.cameraView;
        target.panByCells(departure.x + 0.5 - camera.x - camera.width / 2,
          departure.y + 0.5 - camera.y - camera.height / 2);
        const centered = target.cameraView, bounds = target.canvas.getBoundingClientRect();
        target.commandAt(bounds.left + (departure.x + 0.5 - centered.x) / centered.width * bounds.width,
          bounds.top + (centered.y + centered.height - departure.y - 0.5) / centered.height * bounds.height);
      });
      until("original collector walks off occupied vent", () => {
        const unit = view.simulation.snapshot.units.find(unit => unit.id === originalId)!;
        return unit.cellX === departure.x && unit.cellY === departure.y && unit.activity === "idle";
      }, 60);
      assert.equal(earned(), originalEarned);
      assert.equal(menu()?.enabled, true);
      await restore("before production");
      const beforePurchase = credits();
      publicBoth(target => assert.equal(target.purchaseProduction(dependency), true));
      assert.equal(menu()?.submitting, true);
      await restore("pending public purchase");
      step("commit collector purchase");
      assert.equal(credits(), beforePurchase - 1500);
      assert.equal(earned(), originalEarned);
      assert.equal(collectors().length, 1, "purchase must not spawn immediately");
      await restore("during production");
      until("queue2 collector spawn", () => collectors().length === 2, 400);
      const added = collectors().find(actor => actor.key !== original.key)!;
      assert.equal(added.typeId, unitType);
      const newId = view.nativeBindings.find(binding => binding.key === added.key)!.simulationId;
      assert.notEqual(newId, originalId);
      assert.equal(earned(), originalEarned, "stopped original cannot fund production continuation");
      await restore("after production");
      const source = harvest(newId);
      assert.deepEqual(view.selectedIds, [newId]);
      assert.deepEqual(playerOrders().map(order => order.simulationId), [newId]);
      const remainingBefore = view.browserEconomyState!.remaining[source.key];
      until("new collector incremental income", () => earned() > originalEarned && credits() > beforePurchase - 1500, 650);
      const increment = earned() - originalEarned;
      assert.ok(increment > 0);
      assert.equal(remainingBefore - view.browserEconomyState!.remaining[source.key], increment);
      assert.equal(view.campaignSnapshot!.browserEconomyLedger!.earned[0] - 1500, credits());
      assert.equal(view.browserEconomyState!.orders.some(order => order.simulationId === originalId), false);
      await restore("after new collector income");
      for (let count = 0; count < 8; count++) step("post-income continuation");
      assert.deepEqual(mirror!.checkpoint(), view.checkpoint(), "post-income exact continuation");
      assert.equal(hash(JSON.stringify(mission)), sourceHash, "loader mission untouched");
      for (const [extension, originalHash] of Object.entries(rawHashes)) {
        assert.equal(hash(read(`raw_cd/DC/SCENARIO/${stem}.${extension}`)), originalHash, `${extension} untouched`);
      }
      context.diagnostic(JSON.stringify({ faction, dependency, cost: 1500, sourceHash, rawHashes,
        originalId, newId, originalEarned, increment, tick: view.simulation.snapshot.tick,
        credits: credits(), earned: earned(), evidence, render: "initialized source assets; NullCanvas updates, no browser raster claim" }));
    } finally {
      for (const view of views) view.dispose();
      renderer.dispose();
    }
  });
}
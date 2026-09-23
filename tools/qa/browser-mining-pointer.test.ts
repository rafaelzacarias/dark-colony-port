import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { transportHostState } from "../../src/engine/transport-host";
import { screenYToWorld, worldYToScreen } from "../../src/render/coordinates";
import { installSourceRender } from "./fixtures/source-render";

const callbacks = { onStats() {}, onUnitsChanged() {} };
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Vent = MissionView["resourceSources"][number];

function ventPoint(view: MissionView, source: Vent, offsetY: number) {
  const worldX = source.position.x / 256, worldY = source.position.y / 256;
  const camera = view.cameraView;
  view.panByCells(worldX - (camera.x + camera.width / 2), worldY - (camera.y + camera.height / 2));
  const centered = view.cameraView;
  const logicalX = (worldX - centered.x) * 32;
  const logicalY = worldYToScreen(worldY, centered.y + centered.height / 2, 452, 32) + offsetY;
  assert.ok(logicalX >= 0 && logicalX < 512 && logicalY >= 0 && logicalY < 452);
  const cell = { x: Math.floor(centered.x + logicalX / 32),
    y: Math.floor(screenYToWorld(logicalY, centered.y + centered.height / 2, 452, 32)) };
  const bounds = view.canvas.getBoundingClientRect();
  return { x: bounds.left + logicalX * bounds.width / 512,
    y: bounds.top + logicalY * bounds.height / 452, cell, logicalX, logicalY };
}

for (const faction of ["human", "alien"] as const) {
  test(`mining pointer actual ${faction.toUpperCase()}02: source sprite, income, visibility and JSON replay`, async context => {
    const renderer = installSourceRender();
    context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
      const url = String(input);
      assert.ok(url.startsWith("/assets/generated/") && !url.includes(".."), url);
      return new Response(read(`public${url}`));
    });
    const views: MissionView[] = [];
    const started = performance.now();
    try {
      const mission = await loadCampaignMission(faction, 2, "browser-adapted");
      const sourceHash = hash(mission);
      const view = new MissionView(renderer.canvas(), {} as HTMLElement, callbacks, mission);
      views.push(view);
      await view.initialize();
      view.render();
      assert.ok(view.terrainImage);
      assert.ok(renderer.evidence().images.length > 0);
      assert.ok(renderer.evidence().spriteDraws > 0);
      renderer.setEnabled(false);
      let mirror: MissionView | undefined;
      let clock = 0;
      let collectorId: number | undefined;
      let requiredNode: string | undefined;
      const economy = () => view.browserEconomyState!;
      const order = (target = view) => target.browserEconomyState!.orders.find(entry => entry.simulationId === collectorId);
      const earned = () => economy().earned[0] ?? 0;
      const credits = () => view.resourceWorkflow.credits[0];
      const both = (action: (target: MissionView) => void) => {
        action(view);
        if (mirror) action(mirror);
      };
      const resetClock = () => { clock = 0; both(target => { target.resetClock(); target.update(0); }); };
      const step = () => {
        assert.ok(view.simulation.snapshot.tick < 300, "300-tick total budget");
        const tick = view.simulation.snapshot.tick;
        clock += 50;
        both(target => {
          target.update(clock);
          assert.equal(target.missionDiagnostic, undefined);
          assert.equal(target.simulation.snapshot.tick, tick + 1);
          if (requiredNode) assert.equal(order(target)?.nodeKey, requiredNode,
            `mining order cancelled at tick ${tick + 1}; selection ${target.selectedIds}`);
        });
      };
      const until = (phase: string, predicate: () => boolean, limit: number) => {
        for (let count = 0; count < limit && !predicate(); count++) step();
        assert.ok(predicate(), JSON.stringify({ phase, tick: view.simulation.snapshot.tick,
          economy: economy(), diagnostic: view.missionDiagnostic }));
      };
      const restore = async (phase: string) => {
        if (mirror) {
          assert.deepEqual(mirror.checkpoint(), view.checkpoint(), `${phase}: exact continuation`);
          mirror.dispose();
        }
        const checkpoint = view.checkpoint();
        mirror = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission,
          JSON.parse(JSON.stringify(checkpoint)));
        views.push(mirror);
        assert.deepEqual(mirror.checkpoint(), checkpoint, `${phase}: JSON round trip`);
        await mirror.initialize();
        assert.deepEqual(mirror.checkpoint(), checkpoint, `${phase}: initialized round trip`);
        resetClock();
      };

      resetClock();
      until("original scripted collector delivery", () => economy().harvesters.some(actor => actor.team === 0), 150);
      const collector = economy().harvesters.find(actor => actor.team === 0)!;
      assert.equal(collector.typeId, faction === "human" ? 6 : 14);
      collectorId = economy().bindings.find(binding => binding.key === collector.key)!.simulationId;
      const unit = () => view.simulation.snapshot.units.find(actor => actor.id === collectorId)!;
      const ownedSoldier = () => {
        const infantry = view.campaignSnapshot!.world.entities.filter(actor => actor.unitType === (faction === "human" ? 0 : 8));
        const infantryIds = new Set(view.nativeBindings.filter(binding => infantry.some(actor => actor.key === binding.key))
          .map(binding => binding.simulationId));
        return view.simulation.snapshot.units.find(actor => view.isOwnedUnit(actor.id)
          && infantryIds.has(actor.id) && actor.health > 0);
      };
      until("original infantry delivery for negative control", () => !!ownedSoldier(), 40);
      const soldier = ownedSoldier()!;
      const visible = (source: Vent) => !!view.visibility[(source.position.y >> 8) * view.grid.width + (source.position.x >> 8)];
      const sources = view.resourceSources.filter(source => source.status === 1 && (source.rate ?? 0) > 0 && (source.remaining ?? 0) > 0);
      const source = sources.filter(visible).sort((left, right) =>
        Math.abs((left.position.x >> 8) - unit().cellX) + Math.abs((left.position.y >> 8) - unit().cellY)
        - Math.abs((right.position.x >> 8) - unit().cellX) - Math.abs((right.position.y >> 8) - unit().cellY))[0];
      assert.ok(source, "visible source vent near original collector");
      const hidden = sources.find(candidate => !visible(candidate));
      assert.ok(hidden, "actual hidden source vent");
      view.replaceSelection([collectorId]);
      const hiddenPoint = ventPoint(view, hidden, -24);
      assert.equal(visible(hidden), false, "camera movement does not reveal vent");
      const hiddenEconomy = economy();
      view.commandAt(hiddenPoint.x, hiddenPoint.y);
      assert.deepEqual(economy(), hiddenEconomy, "hidden sprite cannot accept a resource order");
      view.stopSelected();
      step();

      const upper = ventPoint(view, source, -24);
      const groundCell = { x: source.position.x >> 8, y: source.position.y >> 8 };
      assert.notDeepEqual(upper.cell, groundCell, "upper sprite click MUST miss the old ground-cell-only detector");
      assert.equal(upper.cell.x, groundCell.x);
      assert.ok(upper.cell.y > groundCell.y, "render projection places upper sprite toward increasing world Y");
      view.replaceSelection([soldier.id]);
      const soldierEconomy = economy();
      view.commandAt(upper.x, upper.y);
      assert.deepEqual(economy(), soldierEconomy, "soldier-only sprite click cannot mine");
      assert.deepEqual(view.selectedIds, [soldier.id]);
      view.replaceSelection([collectorId]);
      const base = ventPoint(view, source, 0);
      assert.deepEqual(base.cell, groundCell);
      view.commandAt(base.x, base.y);
      assert.equal(order()?.nodeKey, source.key, "base-cell click still starts harvesting");
      assert.equal(order()?.phase, "moving");
      view.stopSelected();
      step();
      assert.equal(order(), undefined);

      await restore("before upper sprite command");
      const initialPose = { x: unit().xSubcells, y: unit().ySubcells };
      const remainingBefore = economy().remaining[source.key];
      const earnedBefore = earned(), creditsBefore = credits();
      both(target => {
        target.replaceSelection([collectorId!]);
        const point = ventPoint(target, source, -24);
        target.commandAt(point.x, point.y);
        assert.equal(order(target)?.nodeKey, source.key, "upper sprite commandAt must start harvest");
        assert.equal(order(target)?.phase, "moving");
        assert.deepEqual(order(target)?.target, groundCell, "new order must target the vent center");
      });
      requiredNode = source.key;
      let selectionChanges = 0;
      until("moving to extracting", () => {
        const selection = selectionChanges++ % 2 ? [] : [soldier.id];
        both(target => target.replaceSelection(selection));
        return order()?.phase === "extracting";
      }, 120);
      assert.notDeepEqual({ x: unit().xSubcells, y: unit().ySubcells }, initialPose, "collector really moved");
      assert.deepEqual([unit().cellX, unit().cellY], [groundCell.x, groundCell.y]);
      assert.deepEqual([unit().xSubcells, unit().ySubcells], [source.position.x * 4, source.position.y * 4]);
      assert.equal(earned(), earnedBefore, "arrival alone must not earn income");
      step();
      const host = transportHostState(view.campaignSnapshot!.world);
      assert.equal(host.slots[collector.slot]!.key, collector.key);
      assert.equal(host.slots[collector.slot]!.generation, collector.generation);
      assert.deepEqual(host.slots[collector.slot]!.position, source.position);
      assert.equal(host.ground[groundCell.y * view.grid.width + groundCell.x], collector.slot);
      assert.equal(host.slots[source.slot]!.key, source.key);
      assert.equal(host.slots[source.slot]!.unitType, 40);
      assert.equal(unit().health, collector.options.health);
      const extractionTick = view.simulation.snapshot.tick;
      both(target => target.replaceSelection([soldier.id]));
      until("positive direct income and published credits", () => earned() > earnedBefore && credits() > creditsBefore, 40);
      const increment = earned() - earnedBefore;
      assert.ok(increment > 0);
      assert.equal(remainingBefore - economy().remaining[source.key], increment, "exact reserve depletion equals earned income");
      assert.equal(credits() - creditsBefore, increment, "earned income published as credits");
      assert.equal(order()?.phase, "extracting");
      assert.deepEqual(mirror!.checkpoint(), view.checkpoint(), "upper click, movement and income replay exactly");
      await restore("after positive mining income");
      for (let count = 0; count < 5; count++) step();
      assert.deepEqual(mirror!.checkpoint(), view.checkpoint(), "post-income JSON continuation");
      mirror!.dispose();
      mirror = undefined;

      view.replaceSelection([collectorId]);
      const beforeRepeat = order()!;
      assert.ok(beforeRepeat.progressTicks > 0, "repeat probe starts mid-extraction");
      const repeatPoint = ventPoint(view, source, -24);
      view.commandAt(repeatPoint.x, repeatPoint.y);
      const afterRepeat = order()!;
      const resets = afterRepeat.progressTicks < beforeRepeat.progressTicks;
      const repeatEarned = earned();
      const repeatTicks = mission.browserEconomy!.policy.extractionPeriodTicks + 2;
      for (let count = 0; count < repeatTicks; count++) {
        view.commandAt(repeatPoint.x, repeatPoint.y);
        step();
      }
      context.diagnostic(JSON.stringify({ faction, sourceHash, collectorId, source: source.key, sourcePosition: source.position,
        soldierId: soldier.id, soldierType: faction === "human" ? 0 : 8,
        upper, groundCell, extractionTick, increment, credits: credits(), selectionChanges,
        collectorPosition: { x: unit().xSubcells / 4, y: unit().ySubcells / 4 }, hostOccupant: collector.slot,
        repeatedClick: { before: beforeRepeat, after: afterRepeat, resets, ticks: repeatTicks, earnedDelta: earned() - repeatEarned },
        tick: view.simulation.snapshot.tick, elapsedMs: performance.now() - started,
        render: "actual source assets initialized; Node NullCanvas, no browser or raster-pixel claim" }));
      assert.equal(hash(mission), sourceHash, "source mission was not modified");
      assert.deepEqual(afterRepeat, beforeRepeat, "repeating the same vent click preserves extraction progress");
      assert.ok(earned() > repeatEarned, "repeated clicks must not prevent mining income");
    } finally {
      for (const view of views) view.dispose();
      renderer.dispose();
    }
  });
}
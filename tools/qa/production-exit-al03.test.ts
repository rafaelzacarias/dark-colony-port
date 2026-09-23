import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { transportHostState } from "../../src/engine/transport-host";
import { installSourceRender } from "./fixtures/source-render";

test("production exit AL03: original public purchases through tick 700", { skip: !process.env.DC_AL03_EXIT_REPLAY }, async context => {
  const directory = process.env.DC_AL03_EXIT_REPLAY!;
  const original = JSON.parse(readFileSync(`${directory}/checkpoint.json`, "utf8"));
  const journal = readFileSync(`${directory}/journal.jsonl`, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const renderer = installSourceRender();
  renderer.setEnabled(false);
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) =>
    new Response(readFileSync(new URL(`../../public${String(input)}`, import.meta.url))));
  const callbacks = { onStats() {}, onUnitsChanged() {} };
  const views: MissionView[] = [];
  try {
    const mission = await loadCampaignMission("alien", 3, "browser-adapted");
    assert.equal(createHash("sha256").update(JSON.stringify(mission)).digest("hex"), original.sourceHash);
    const view = new MissionView(renderer.canvas(), {} as HTMLElement, callbacks, mission);
    views.push(view);
    await view.initialize();
    view.resetClock(); view.update(0);
    let mirror: MissionView | undefined;
    let purchases = 0;
    const command = (target: MissionView, data: any) => {
      target.replaceSelection(data.ids);
      assert.deepEqual(target.selectedIds, data.ids);
      target.setCameraCenter(data.destination.x + 0.5, data.destination.y + 0.5);
      target.setOrderMode(data.mode);
      const camera = target.cameraView, bounds = target.canvas.getBoundingClientRect(), scale = 512 / camera.width;
      const clientX = bounds.left + (data.destination.x + 0.5 - camera.x) * scale * bounds.width / 512;
      const clientY = bounds.top + (226 - (data.destination.y + 0.5 - camera.y - camera.height / 2) * scale) * bounds.height / 452;
      assert.notEqual(target.cursorAt(clientX, clientY), "blocked");
      target.commandAt(clientX, clientY);
    };
    for (let tick = 0; tick < 700; tick++) {
      for (const event of journal.filter(entry => entry.tick === tick)) {
        if (event.kind === "purchase") {
          assert.equal(view.purchaseProduction(event.data.dependency), true);
          if (mirror) assert.equal(mirror.purchaseProduction(event.data.dependency), true);
          purchases++;
        } else if (event.kind === "command") {
          command(view, event.data);
          if (mirror) command(mirror, event.data);
        } else if (event.kind === "harvest") {
          view.replaceSelection([event.data.actor]);
          assert.equal(view.harvestSelected(event.data.slot), true);
        }
      }
      if (tick === 600) {
        const exiting = view.simulation.snapshot.units.find(unit => unit.team === 0 && unit.cellX === 46 && unit.cellY === 9);
        assert.ok(exiting, "sixth purchase must have produced an infantry at the original exit");
        const data = { ids: [exiting.id], destination: { x: 49, y: 18 }, mode: "assault" };
        command(view, data);
        if (mirror) command(mirror, data);
        assert.equal(view.purchaseProduction(23), true);
        if (mirror) assert.equal(mirror.purchaseProduction(23), true);
        purchases++;
      }
      if (tick === 510 || tick === 520) {
        const saved = view.checkpoint();
        if (mirror) {
          assert.deepEqual(mirror.checkpoint(), saved, `tick ${tick}: exact continuation`);
          mirror.dispose();
        }
        if (tick === 520) {
          const host = transportHostState(view.campaignSnapshot!.world);
          assert.equal(host.ground[9 * host.width + 46], 193);
          assert.equal(host.slots[193]!.generation, 0);
          assert.equal(host.productionExits!.length, 1);
        }
        mirror = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(saved)));
        views.push(mirror);
        assert.deepEqual(mirror.checkpoint(), saved);
        await mirror.initialize();
        mirror.resetClock(); mirror.update(tick * 50);
      }
      view.update((tick + 1) * 50);
      if (tick >= 500 && tick <= 520) {
        const host = transportHostState(view.campaignSnapshot!.world);
        context.diagnostic(JSON.stringify({ tick: tick + 1, occupant: host.ground[9 * host.width + 46],
          reservations: host.productionExits, bindings: view.nativeBindings.filter(binding => [48, 50].includes(binding.simulationId)),
          units: view.simulation.snapshot.units.filter(unit => [48, 50].includes(unit.id))
            .map(unit => ({ id: unit.id, x: unit.xSubcells, y: unit.ySubcells, cellX: unit.cellX, cellY: unit.cellY })) }));
      }
      assert.equal(view.missionDiagnostic, undefined, `tick ${tick + 1}`);
      assert.equal(view.simulation.snapshot.tick, tick + 1);
      if (mirror) {
        mirror.update((tick + 1) * 50);
        assert.equal(mirror.missionDiagnostic, undefined);
      }
    }
    assert.equal(purchases, 7);
    assert.deepEqual(mirror!.checkpoint(), view.checkpoint(), "exact continuation across the occupied exit");
    const team = view.campaignSnapshot!.production!.teams.find(team => team.team === 0)!;
    assert.equal(team.costAccumulator, 2450);
    assert.equal(team.queues[0].items.length, 0, "seventh purchase also allocates after the public move clears the exit");
    assert.equal(view.resourceWorkflow.credits[0], 3500 + view.browserEconomyState!.earned[0] - 2450);
    context.diagnostic(JSON.stringify({ tick: 700, purchases, credits: view.resourceWorkflow.credits[0],
      earned: view.browserEconomyState!.earned[0], sourceHash: original.sourceHash }));
  } finally {
    for (const view of views) view.dispose();
    renderer.dispose();
  }
});
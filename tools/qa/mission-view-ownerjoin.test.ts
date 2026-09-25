import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView, missionVisualSprites } from "../../src/mission-view";
import { observeBrowserType37Frame, projectBrowserType37Presentation } from "../../src/engine/browser-type37-presentation";
import { createBrowserCampaignAiConfiguration } from "../../src/engine/browser-campaign-ai";
import { createBrowserCampaignEconomyProfile } from "../../src/engine/browser-campaign-economy-source";
import { sourceBrowserCampaignSessionOptions } from "../../src/engine/source-browser-campaign-options";
import { CampaignSession, initializeCampaignSession } from "../../src/engine/campaign-session";
import { NavigationGrid } from "../../src/engine/grid";
import { createLegacyInfantryFamilyMask } from "../../src/engine/legacy-navigation";
import { transportHostState } from "../../src/engine/transport-host";
import { CombatMovementOrders } from "../../src/engine/combat-movement";
import { parseTriggerScript } from "../extractors/data/triggers";
import { parseScenario } from "../extractors/data/scenario";

const root = new URL("../../public/", import.meta.url);
const canvas = () => ({ width: 512, height: 452, getContext: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) }) as unknown as HTMLCanvasElement;
const callbacks = { onStats() {}, onUnitsChanged() {} };

function observeGuardOwnership(context: TestContext, mission: Awaited<ReturnType<typeof loadCampaignMission>>, activeModes = new Set<number>()) {
  let modes: readonly number[] = [];
  let bindings: readonly { simulationId: number; key: string }[] = [];
  let actors: readonly { key: string; unitType: number }[] = [];
  const step = CampaignSession.prototype.stepForBrowserView;
  const update = CombatMovementOrders.prototype.update;
  context.mock.method(CampaignSession.prototype, "stepForBrowserView", function(this: CampaignSession, ...input: Parameters<typeof step>) {
    const result = step.apply(this, input);
    if (result.ok) { modes = result.value.world.aiSelectors!.modes; actors = result.value.world.entities; }
    return result;
  });
  context.mock.method(CombatMovementOrders.prototype, "update", function(this: CombatMovementOrders, ...input: Parameters<typeof update>) {
    const [snapshot, guards] = input;
    for (const actor of snapshot.units) if ([1, 2, 3].includes(modes[actor.team!])) activeModes.add(modes[actor.team!]);
    for (const guard of guards) {
      const actor = snapshot.units.find(unit => unit.id === guard.id)!;
      assert.ok(![1, 2, 3].includes(modes[actor.team!]), `generic guard overrides AI mode ${modes[actor.team!]}`);
    }
    for (const actor of snapshot.units.filter(unit => unit.team === 0 && modes[0] === 0)) {
      const binding = bindings.find(binding => binding.simulationId === actor.id);
      const source = actors.find(entity => entity.key === binding?.key);
      if (source && (mission.units.find(stat => stat.index === source.unitType)?.weapons[0] ?? -1) >= 0) {
        assert.ok(guards.some(guard => guard.id === actor.id), "team0 mode0 must retain generic guards");
      }
    }
    return update.apply(this, input);
  });
  return (view: MissionView) => { bindings = view.nativeBindings; };
}

for (const faction of ["human", "alien"] as const) {
  test(`view ownerjoin: ${faction} M02 source recovery after real combat and40tick midpickup replay`, async context => {
    context.mock.method(globalThis, "fetch", async (input: string | URL | Request) =>
      new Response(readFileSync(new URL(String(input).slice(1), root))));
    const original = await loadCampaignMission(faction, 2, "browser-adapted");
    const human = faction === "human", unitType = human ? 69 : 73;
    const destination = human ? { x: 64, y: 49 } : { x: 6, y: 76 };
    const scenario = { ...original.scenario, ...parseScenario(atob(original.scenario.rawScenario!)), placementRows: [
      [destination.x, destination.y, unitType, 0, -1],
      [destination.x + 1, destination.y, human ? 42 : 41, human ? 3 : 1, -1],
    ] };
    const fixture = { ...original, scenario, sourceProduction: undefined, browserEconomy: undefined, browserResearch: undefined,
      triggers: original.triggers.map(trigger => (human ? [18, 19, 20] : [11, 12]).includes(trigger.id)
        ? trigger : { ...trigger, flag: 0 }) };
    const initial = initializeCampaignSession(sourceBrowserCampaignSessionOptions(fixture));
    assert.ok(initial.ok, JSON.stringify(initial));
    const browserEconomy = await createBrowserCampaignEconomyProfile({ scope: "browser-adapted-economy-v1",
      world: initial.value.world, teams: scenario.teams, units: original.units });
    const browserAi = await createBrowserCampaignAiConfiguration({ scenario, units: original.units,
      weapons: original.weapons, dependencies: [], pathGrid: new NavigationGrid(original.map.width, original.map.height,
        Uint16Array.from(createLegacyInfantryFamilyMask({ ...original.map, pathGrid: original.pathGrid }))) });
    const mission = { ...fixture, browserAi, browserEconomy };
    const view = new MissionView(canvas(), {} as HTMLElement, callbacks, mission);
    const observe = observeGuardOwnership(context, mission);
    observe(view);
    let restored: MissionView | undefined;
    try {
      assert.equal(view.missionDiagnostic, undefined);
      const victim = view.campaignSnapshot!.world.entities.find(entity => entity.team === 0 && entity.unitType === unitType)!;
      const binding = view.nativeBindings.find(binding => binding.key === victim.key)!;
      assert.equal(victim.health, original.units.find(stat => stat.index === unitType)!.health);
      view.update(0);
      let deathTick = 0, pickupTick = 0, replacementTick = 0, replayTicks = 0;
      for (let tick = 1; tick <= 1250; tick++) {
        view.update(tick * 50);
        assert.equal(view.missionDiagnostic, undefined, `tick ${tick}`);
        const state = view.campaignSnapshot!, host = transportHostState(state.world);
        const casualty = host.browserCasualties?.find(entry => entry.slot === binding.slot && entry.generation === binding.generation);
        if (!casualty) continue;
        if (!deathTick) {
          deathTick = tick;
          assert.equal(casualty.disposition, "scheduled");
          const carrier = host.reducer.carriers.find(carrier => carrier.id === casualty.carrierId)!;
          assert.equal(carrier.type, human ? 92 : 93);
          assert.equal(host.slots[carrier.slot]!.team, 8);
          assert.ok(view.carrierVisuals.some(visual => visual.slot === carrier.slot && visual.sprite === (human ? "DROP" : "SAUC")));
          const saved = view.checkpoint();
          restored = MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(saved)));
          assert.deepEqual(restored.checkpoint(), saved);
          restored.update(tick * 50);
        } else if (restored) {
          restored.update(tick * 50);
          assert.equal(restored.missionDiagnostic, undefined);
          assert.deepEqual(restored.checkpoint(), view.checkpoint());
          replayTicks++;
          if (replayTicks === 40) { restored.dispose(); restored = undefined; }
        }
        assert.equal(state.controller.runtime.statistics[`0,0,${unitType}`], 1);
        assert.equal(state.controller.runtime.bail, null);
        assert.equal(host.requests.filter(request => request.type === "combat-death" && request.slot === binding.slot
          && request.generation === binding.generation).length, 1);
        if (!casualty.collected) {
          assert.equal(host.registry[binding.slot], binding.key);
          const body = view.simulation.snapshot.units.find(unit => unit.id === binding.simulationId)!;
          assert.equal(body.health, 0);
          assert.equal(body.activity, "die");
          assert.equal(body.xSubcells, (destination.x + 0.5) * 1024);
          assert.equal(body.ySubcells, (destination.y + 0.5) * 1024);
        } else {
          pickupTick ||= tick;
          assert.ok(!view.simulation.snapshot.units.some(unit => unit.id === binding.simulationId));
          assert.ok(!state.world.entities.some(entity => entity.key === binding.key));
          assert.equal(host.requests.filter(request => request.type === "casualty-picked-up" && request.slot === binding.slot
            && request.generation === binding.generation).length, 1);
        }
        const replacement = state.world.entities.find(entity => entity.team === 0 && entity.unitType === unitType && entity.health > 0);
        if (replacement) {
          replacementTick = tick;
          assert.ok(pickupTick > deathTick);
          assert.ok(tick > (state.controller.runtime.statistics["0,2,0"] + 1) * 16);
          assert.notEqual(replacement.key, victim.key);
          const next = view.nativeBindings.find(binding => binding.key === replacement.key)!;
          assert.ok(next && next.simulationId !== binding.simulationId);
          assert.ok(next.slot !== binding.slot || next.generation !== binding.generation);
          assert.equal(replacement.health, victim.maxHealth);
          assert.equal(view.simulation.snapshot.units.find(unit => unit.id === next.simulationId)!.maxHealth, victim.maxHealth);
          break;
        }
      }
      assert.equal(replayTicks, 40);
      assert.ok(replacementTick > pickupTick && pickupTick > deathTick && deathTick > 0,
        JSON.stringify({ deathTick, pickupTick, replacementTick, recoveryThreshold: view.missionStatistics["0,2,0"] }));
      context.diagnostic(JSON.stringify({ faction, deathTick, pickupTick, replacementTick, replayTicks }));
    } finally { restored?.dispose(); view.dispose(); }
  });
}

test("view ownerjoin: original AL08 accepts owned nopickup at tick16", async context => {
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) =>
    new Response(readFileSync(new URL(String(input).slice(1), root))));
  const mission = await loadCampaignMission("alien", 8, "browser-adapted");
  const view = new MissionView(canvas(), {} as HTMLElement, callbacks, mission);
  observeGuardOwnership(context, mission)(view);
  try {
    assert.equal(view.missionDiagnostic, undefined);
    view.update(0);
    for (let tick = 1; tick <= 16; tick++) {
      view.update(tick * 50);
      assert.equal(view.missionDiagnostic, undefined, `tick ${tick}`);
    }
    const state = view.campaignSnapshot!;
    assert.equal(state.cycleCounter, 16);
    assert.equal(state.world.adaptedTro!.noPickup[6], 1);
    assert.deepEqual(state.world.browserCasualtyPickup, { runtimeProfile: "browser-adapted" });
    assert.equal(transportHostState(state.world).browserCasualties?.length ?? 0, 0);
  } finally { view.dispose(); }
});

test("view ownerjoin: source AI mode changes retain ownership in the same frame", async context => {
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) =>
    new Response(readFileSync(new URL(String(input).slice(1), root))));
  const activeModes = new Set<number>();
  const original = await loadCampaignMission("human", 2, "browser-adapted");
  const mission = { ...original, triggers: parseTriggerScript(
    "0 norm 1 (1)\nai 2 1\nend\n1 norm 1 (c>0)\nai 2 3\nend\n2 norm 1 (c>1)\nai 2 2\nend\n") };
  const view = new MissionView(canvas(), {} as HTMLElement, callbacks, mission);
  const observe = observeGuardOwnership(context, mission, activeModes);
  try {
    observe(view);
    view.update(0);
    for (let tick = 1; tick <= 40; tick++) {
      view.update(tick * 50);
      assert.equal(view.missionDiagnostic, undefined, `tick ${tick}`);
      observe(view);
    }
    assert.deepEqual([...activeModes].sort(), [1, 2, 3]);
    assert.deepEqual(view.campaignSnapshot!.world.aiSelectors!.events.map(event => event.after), [1, 3, 2]);
  } finally { view.dispose(); }
});

test("view ownerjoin: AL08 rejects nopickup when its frame owner is absent", async context => {
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) =>
    new Response(readFileSync(new URL(String(input).slice(1), root))));
  const mission = await loadCampaignMission("alien", 8, "browser-adapted");
  const view = new MissionView(canvas(), {} as HTMLElement, callbacks, mission);
  const step = CampaignSession.prototype.stepForBrowserView;
  context.mock.method(CampaignSession.prototype, "stepForBrowserView", function(this: CampaignSession, ...input: Parameters<typeof step>) {
    const result = step.apply(this, input);
    if (result.ok) Reflect.deleteProperty(result.value.world, "browserCasualtyPickup");
    return result;
  });
  try {
    view.update(0);
    for (let tick = 1; tick <= 16; tick++) view.update(tick * 50);
    assert.match(view.missionDiagnostic!, /nopickup requires an automatic casualty-pickup owner/);
    assert.ok(view.simulation.snapshot.tick < 16);
    assert.equal(view.campaignSnapshot!.cycleCounter, view.simulation.snapshot.tick);
  } finally { view.dispose(); }
});

test("view ownerjoin: original H07 current observations preserve hidden source markers for40ticks", async context => {
  const requests: string[] = [];
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    requests.push(String(input));
    return new Response(readFileSync(new URL(String(input).slice(1), root)));
  });
  const mission = await loadCampaignMission("human", 7, "browser-adapted");
  const view = new MissionView(canvas(), {} as HTMLElement, callbacks, mission);
  let restored: MissionView | undefined;
  try {
    assert.equal(view.missionDiagnostic, undefined);
    const initial = view.campaignSnapshot!.world;
    const owner = view.checkpoint().browserAi!;
    const before = projectBrowserType37Presentation(initial, owner);
    assert.deepEqual(before.entries.map(entry => [entry.rawSlot, entry.tileX, entry.tileY, entry.pendingTypes]),
      [[190, 88, 80, [63, 63, 63]], [197, 5, 32, [63, 63, 63]]]);
    assert.ok(!missionVisualSprites(mission, initial).includes("POOP"));
    view.update(0);
    for (let tick = 1; tick <= 40; tick++) {
      const previous = view.campaignSnapshot!.world;
      const expected = observeBrowserType37Frame(previous, owner, {
        snapshot: view.simulation.snapshot, bindings: view.nativeBindings,
        spyTeams: Array.from({ length: 8 }, () => false),
      });
      view.update(tick * 50);
      assert.equal(view.missionDiagnostic, undefined, `tick ${tick}`);
      const recorded = view.checkpoint().session!.state.aiSelectorInputs!.at(-1)!;
      assert.ok("type37Frame" in recorded);
      assert.deepEqual(recorded.type37Frame, expected);
      if (tick === 20) {
        const saved = view.checkpoint();
        restored = MissionView.restore(canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(saved)));
        assert.deepEqual(restored.checkpoint(), saved);
        restored.update(tick * 50);
      } else if (restored) {
        restored.update(tick * 50);
        assert.equal(restored.missionDiagnostic, undefined);
        assert.deepEqual(restored.checkpoint(), view.checkpoint());
      }
    }
    const after = projectBrowserType37Presentation(view.campaignSnapshot!.world, owner);
    assert.deepEqual(after.entries, before.entries);
    assert.deepEqual(after.spyTeams, Array.from({ length: 8 }, () => false));
    for (const marker of after.entries) assert.ok(!view.nativeBindings.some(binding => binding.key === marker.key));
    assert.ok(!view.checkpoint().state.unitStats.some(stat => stat.type === 37));
    assert.ok(!requests.some(url => /POOP/i.test(url)));
  } finally { restored?.dispose(); view.dispose(); }
});
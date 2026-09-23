import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { parseScenario } from "../extractors/data/scenario";
import { loadCampaignMission } from "../../src/game-data";
import { CampaignSession } from "../../src/engine/campaign-session";
import { sourceBrowserCampaignSessionOptions } from "../../src/engine/source-browser-campaign-options";
import { transportHostState } from "../../src/engine/transport-host";
import type { CampaignWorld } from "../../src/engine/campaign-world";
import { loadSourceProductionOptions, sourceProductionUi } from "../../src/engine/source-production-options";
import { browserConstructionChoices, createBrowserConstruction, createBrowserConstructionConfiguration,
  reduceBrowserConstruction, restoreBrowserConstruction } from "../../src/engine/browser-construction";

const read = (path: string) => Uint8Array.from(readFileSync(new URL(`../../public${path}`, import.meta.url)));

for (const faction of ["human", "alien"] as const) {
  test(`fixed construction session: ${faction} busy destruction cannot refund, heal or rebuild`, async context => {
    context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => new Response(read(String(input)).buffer));
    const mission = await loadCampaignMission(faction, faction === "human" ? 10 : 3, "browser-adapted",
      { completionVisits: 120, supportedSlots: [3] });
    const configuration = mission.browserConstruction!, session = new CampaignSession(sourceBrowserCampaignSessionOptions(mission));
    const option = configuration.buildings!.find(option => option.level === 0 && option.building.slot === 3)!;
    const request = { type: "purchase" as const, sequence: 1, id: "destroyed:slot3", dependency: option.dependency, home: configuration.home };
    const initial = session.checkpoint();
    const failure = session.step({ clockMilliseconds: 50, browserConstructionRequest: request,
      productionVisits: session.browserFrameContext(150).productionVisits,
      resourceFrameSource: {} as NonNullable<Parameters<CampaignSession["step"]>[0]["resourceFrameSource"]> });
    assert.equal(failure.ok, false);
    assert.deepEqual(session.checkpoint(), initial);
    assert.equal(session.step({ clockMilliseconds: 50, browserConstructionRequest: request,
      productionVisits: session.browserFrameContext(150).productionVisits }).ok, true);
    const live = session.checkpoint();
    assert.equal(session.step({ clockMilliseconds: 100, browserConstructionHealth: 1 }).ok, false);
    assert.deepEqual(session.checkpoint(), live, "legacy damage cannot target a non-owned source central base");
    for (let tick = 2; tick <= 121; tick++) {
      const result = session.step({ clockMilliseconds: tick * 50, productionVisits: session.browserFrameContext(150).productionVisits,
        ...(tick === 2 ? { updates: [{ type: "combat-death" as const, slot: 3, generation: 0 }] } : {}) });
      assert.equal(result.ok, true, JSON.stringify(result));
    }
    assert.equal(session.snapshot.world.buildingSlots["0,3"], 0);
    assert.equal(session.snapshot.production!.teams[0].slots[3].busy, 0);
    assert.equal(session.snapshot.world.exomoney[0], mission.scenario.teams[0].money - option.cost);
    assert.equal(session.snapshot.production!.teams[0].costAccumulator, option.cost);
    assert.equal(session.snapshot.browserConstruction!.slots![3].phase, "ready");
    const before = session.checkpoint();
    assert.equal(session.step({ clockMilliseconds: 6100, browserConstructionRequest: { ...request, sequence: 122 } }).ok, false);
    assert.deepEqual(session.checkpoint(), before);
  });

  test(`fixed construction producers: ${faction} empty central and barracks activate only after completion`, async context => {
    context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => new Response(read(String(input)).buffer));
    const original = await loadCampaignMission(faction, 10, "browser-adapted");
    const lines = atob(original.scenario.rawScenario!).split(/\r?\n/);
    lines[lines.indexOf("%City") + 1] = "0 -1 0 -1 0 -1 0 -1 0 -1";
    lines[lines.indexOf("%Money") - 1] = "10000";
    lines[lines.indexOf("%Depend") - 1] = "-1";
    const raw = lines.join("\n");
    const scenario = { ...original.scenario, ...parseScenario(raw), rawScenario: btoa(raw),
      source: { ...original.scenario.source, sha256: createHash("sha256").update(raw).digest("hex") } };
    const mission = { ...original, scenario, sourceProduction: undefined, browserEconomy: undefined };
    const configuration = await createBrowserConstructionConfiguration({ runtimeProfile: "browser-adapted", mission,
      completionVisits: 120, supportedSlots: [0, 1, 3], loadBytes: async path => path === `/assets/generated/data/scenarios/${scenario.source.path.replace(".SCN", ".json")}`
        ? new TextEncoder().encode(JSON.stringify(scenario)) : read(path) });
    const production = await loadSourceProductionOptions({ sessionId: `${scenario.id}:browser`, mission,
      rawScenario: new TextEncoder().encode(raw), configuration: { profile: "user-selected-source-campaign-fresh", mode: 0,
        localTeam: 0, race: faction === "human" ? 0 : 1 }, deferEmptyCentralBase: true,
      adaptedCollectors: { runtimeProfile: "browser-adapted", completionVisits: 120 } });
    const session = new CampaignSession({ ...sourceBrowserCampaignSessionOptions(mission), browserConstruction: configuration,
      production: production.production });
    let tick = 0;
    const step = (input: Omit<Parameters<CampaignSession["step"]>[0], "clockMilliseconds" | "productionVisits"> = {}) => {
      const result = session.step({ clockMilliseconds: ++tick * 50, productionVisits: session.browserFrameContext(150).productionVisits, ...input });
      assert.equal(result.ok, true, JSON.stringify(result));
    };
    assert.equal(session.snapshot.production, undefined);
    const collector = faction === "human" ? 7 : 21, infantry = faction === "human" ? 9 : 23;
    for (const slot of [0, 1]) {
      const option = configuration.buildings!.find(option => option.level === 0 && option.building.slot === slot)!;
      step({ browserConstructionRequest: { type: "purchase", sequence: session.snapshot.browserConstruction!.sequence + 1,
        id: `producer:slot${slot}`, dependency: option.dependency, home: configuration.home } });
      assert.equal(session.snapshot.production!.teams[0].slots[slot].busy, 1);
      assert.equal(sourceProductionUi(session.snapshot.production!, 0).find(choice => choice.dependency === (slot === 0 ? collector : infantry))!.maxAdditional, 0);
      if (slot === 1) {
        const laboratory = configuration.buildings!.find(option => option.level === 0 && option.building.slot === 3)!;
        step({ browserConstructionRequest: { type: "purchase", sequence: session.snapshot.browserConstruction!.sequence + 1,
          id: "producer:concurrent-laboratory", dependency: laboratory.dependency, home: configuration.home } });
        assert.equal(session.snapshot.browserConstruction!.slots![1].elapsedVisits, 1);
        assert.equal(session.snapshot.browserConstruction!.slots![3].elapsedVisits, 0);
      }
      for (let visit = 0; visit < 120; visit++) step();
      assert.equal(session.snapshot.production!.teams[0].slots[slot].busy, 0);
      assert.ok(sourceProductionUi(session.snapshot.production!, 0).find(choice => choice.dependency === (slot === 0 ? collector : infantry))!.maxAdditional > 0);
    }
    assert.deepEqual(session.browserFrameContext(150).productionVisits!.map(visit => visit.queue), [0, 2]);
    const beforeCount = session.snapshot.world.entities.filter(entity => entity.unitType === (faction === "human" ? 6 : 14) && entity.team === 0).length;
    step({ productionCommands: [{ id: "collector:reserve", team: 0, action: { type: "reserve", dependency: collector } },
      { id: "collector:dispatch", team: 0, action: { type: "dispatch", dependency: collector } }] });
    for (let visit = 0; visit < 125; visit++) step();
    assert.equal(session.snapshot.world.entities.filter(entity => entity.unitType === (faction === "human" ? 6 : 14) && entity.team === 0).length, beforeCount + 1);
    assert.equal(session.snapshot.world.exomoney[0], 3500);
    assert.equal(session.snapshot.production!.teams[0].costAccumulator, 6500);
    context.diagnostic("Controlled empty-city source and 10000-credit fixture; no original opening or earned funding claim.");
  });

  test(`fixed construction controlled source: ${faction} slot4 receipt and cancellation, reservation and mirror guards`, async context => {
    context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => new Response(read(String(input)).buffer));
    const original = await loadCampaignMission(faction, 10, "browser-adapted");
    const lines = atob(original.scenario.rawScenario!).split(/\r?\n/);
    const cityIndex = lines.indexOf("%City") + 1;
    lines[cityIndex] = "1 -1 1 -1 0 -1 2 -1 0 -1";
    const raw = lines.join("\n");
    const scenario = { ...original.scenario, ...parseScenario(raw), rawScenario: btoa(raw),
      source: { ...original.scenario.source, sha256: createHash("sha256").update(raw).digest("hex") } };
    const mission = { ...original, scenario, sourceProduction: undefined, browserEconomy: undefined };
    const configuration = await createBrowserConstructionConfiguration({ runtimeProfile: "browser-adapted", mission,
      completionVisits: 120, supportedSlots: [4], loadBytes: async path => path === `/assets/generated/data/scenarios/${scenario.source.path.replace(".SCN", ".json")}`
        ? new TextEncoder().encode(JSON.stringify(scenario)) : read(path) });
    const initial = new CampaignSession(sourceBrowserCampaignSessionOptions(mission)).snapshot.world;
    let world: CampaignWorld = { ...initial, exomoney: { ...initial.exomoney, 0: 10000 } };
    let state = createBrowserConstruction(configuration, world);
    const option = configuration.buildings!.find(option => option.building.slot === 4)!;
    assert.equal(option.building.unitType, faction === "human" ? 22 : 34);
    assert.equal(option.cost, 3000);
    assert.equal(browserConstructionChoices(configuration, state, world)[0].requestEnabled, true);
    const request = { type: "purchase" as const, sequence: 1, id: "controlled:research-center", dependency: option.dependency, home: configuration.home };
    const before = structuredClone(world);
    const cell = option.building.footprint[0];
    const host = transportHostState(world), index = cell.y * host.width + cell.x;
    host.ground[index] = 1022;
    assert.throws(() => reduceBrowserConstruction(configuration, state, { ...world, transportState: host }, request), /footprint/);
    host.ground[index] = -1;
    host.productionExits = [{ key: "controlled:reserved", team: 0, queue: 0, ticket: "controlled", unitType: 0,
      tile: cell } as NonNullable<typeof host.productionExits>[number]];
    assert.throws(() => reduceBrowserConstruction(configuration, state, { ...world, transportState: host }, request), /footprint/);
    host.productionExits = [];
    host.resourceTileFlags[index] = 0x04000000;
    assert.throws(() => reduceBrowserConstruction(configuration, state, { ...world, transportState: host }, request), /footprint/);
    const blocker = { ...world.entities[0], key: "controlled:world-blocker", rawSlot: 799, tileX: cell.x, tileY: cell.y,
      unitType: option.building.unitType, health: 100 };
    assert.throws(() => reduceBrowserConstruction(configuration, state, { ...world, entities: [...world.entities, blocker] }, request), /source entity/);
    host.resourceTileFlags[index] = 0;
    host.slots[799] = { slot: 799, generation: 0, key: "controlled:host-blocker", team: 0, unitType: option.building.unitType,
      position: { x: cell.x * 256, y: cell.y * 256 }, height: 0, health: 100, status: 1, task: "unit", taskWords: [] };
    assert.throws(() => reduceBrowserConstruction(configuration, state, { ...world, transportState: host }, request), /host entity/);
    assert.deepEqual(world, before);
    const started = reduceBrowserConstruction(configuration, state, world, request);
    world = started.world;
    state = started.state;
    assert.equal(world.exomoney[0], 7000);
    assert.equal(world.buildingSlots["0,4"], option.building.maxHealth);
    const cancel = { type: "cancel", sequence: 2 } as unknown as Parameters<typeof reduceBrowserConstruction>[3];
    assert.throws(() => reduceBrowserConstruction(configuration, state, world, cancel), /unsupported cancellation/);
    const allocated = structuredClone(world);
    allocated.entityBytes![4 * 220 + 6] ^= 1;
    assert.throws(() => restoreBrowserConstruction(configuration, state, allocated), /mutation/);
    for (let visit = 0; visit < 120; visit++) {
      const next = reduceBrowserConstruction(configuration, state, world, { type: "visit", sequence: state.sequence + 1 });
      state = next.state;
      world = next.world;
    }
    assert.equal(state.slots![4].phase, "ready");
    assert.equal(world.exomoney[0], 7000);
    assert.equal(world.entities.filter(entity => entity.rawSlot === 4).length, 1);
    context.diagnostic("Controlled source fixture: original city row replaced with an existing level-1 laboratory; not an original mission opening or upgrade implementation.");
  });

  test(`fixed construction session: ${faction} producer readiness, damage, destruction and exact replay`, async context => {
    context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => new Response(read(String(input)).buffer));
    const mission = await loadCampaignMission(faction, faction === "human" ? 10 : 3, "browser-adapted",
      { completionVisits: 120, supportedSlots: [1, 2, 3, 4] });
    const configuration = mission.browserConstruction!;
    const session = new CampaignSession({ ...sourceBrowserCampaignSessionOptions(mission), browserConstruction: configuration });
    const option = configuration.buildings!.find(option => option.level === 0 && option.building.slot === 3)!;
    const request = { type: "purchase" as const, sequence: 1, id: "session:slot3", dependency: option.dependency, home: configuration.home };
    const start = session.step({ clockMilliseconds: 50, browserConstructionRequest: request,
      productionVisits: session.browserFrameContext(150).productionVisits });
    assert.equal(start.ok, true, JSON.stringify(start));
    assert.ok(session.snapshot.staticSlots.includes(3));
    assert.equal(session.snapshot.production!.teams[0].slots[3].busy, 1);
    const checkpoint = session.checkpoint();
    const resume = CampaignSession.restore(checkpoint, undefined, undefined, undefined, undefined, undefined, configuration);
    assert.deepEqual(resume.checkpoint(), checkpoint);
    assert.throws(() => CampaignSession.restore(checkpoint), /construction restore/);
    for (let tick = 2; tick <= 121; tick++) {
      const input = { clockMilliseconds: tick * 50, productionVisits: session.browserFrameContext(150).productionVisits,
        ...(tick === 2 ? { browserConstructionDamage: [{ slot: 3, generation: 0 as const, health: 1200 }] } : {}) };
      const result = session.step(input);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.deepEqual(resume.step(input), result);
    }
    assert.equal(session.snapshot.production!.teams[0].slots[3].busy, 0);
    assert.equal(session.snapshot.world.buildingSlots["0,3"], 1200);
    assert.equal(session.snapshot.production!.teams[0].costAccumulator, option.cost);
    assert.equal(session.snapshot.world.exomoney[0], mission.scenario.teams[0].money - option.cost);
    assert.deepEqual(resume.checkpoint(), session.checkpoint());
    const before = session.checkpoint();
    assert.equal(session.step({ clockMilliseconds: 6100, browserConstructionDamage: [{ slot: 3, generation: 0, health: 2400 }] }).ok, false);
    assert.deepEqual(session.checkpoint(), before);
    const death = session.step({ clockMilliseconds: 6100, updates: [{ type: "combat-death", slot: 3, generation: 0 }],
      productionVisits: session.browserFrameContext(150).productionVisits });
    assert.equal(death.ok, true, JSON.stringify(death));
    assert.equal(session.snapshot.world.buildingSlots["0,3"], 0);
    assert.equal(session.browserConstructionStatus!.choices.find(choice => choice.slot === 3)!.reason, "Destroyed");
    assert.equal(session.step({ clockMilliseconds: 6150, browserConstructionRequest: { ...request, sequence: 122 } }).ok, false);
    assert.deepEqual(CampaignSession.restore(session.checkpoint(), undefined, undefined, undefined, undefined, undefined, configuration).checkpoint(), session.checkpoint());
  });

  test(`fixed construction: ${faction} authenticated empty slots, original eligibility, no replacement or upgrades`, async context => {
    context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => new Response(read(String(input)).buffer));
    const mission = await loadCampaignMission(faction, 10, "browser-adapted");
    const configuration = await createBrowserConstructionConfiguration({ runtimeProfile: "browser-adapted", mission,
      completionVisits: 120, supportedSlots: [0, 1, 2, 3, 4] });
    const original = new CampaignSession(sourceBrowserCampaignSessionOptions(mission)).snapshot.world;
    let world: CampaignWorld = { ...original, exomoney: { ...original.exomoney, 0: 20000 } };
    let state = createBrowserConstruction(configuration, world);
    const purchase = (dependency: number) => ({ type: "purchase" as const, sequence: state.sequence + 1,
      id: `fixed:${dependency}`, dependency, home: configuration.home });
    const options = configuration.buildings!;
    const dependency = (slot: number) => options.find(option => option.level === 0 && option.building.slot === slot)!.dependency;
    assert.equal(browserConstructionChoices(configuration, state, world).length, 5);
    assert.throws(() => reduceBrowserConstruction(configuration, state, world, purchase(dependency(4))), /prerequisites/);
    for (const slot of faction === "alien" ? [0, 1, 3, 2] : [3, 2]) {
      const before = structuredClone(world);
      const blocked = { ...world, exomoney: { ...world.exomoney, 0: 0 } };
      assert.throws(() => reduceBrowserConstruction(configuration, state, blocked, purchase(dependency(slot))), /credits/);
      const started = reduceBrowserConstruction(configuration, state, world, purchase(dependency(slot)));
      assert.deepEqual(world, before);
      state = started.state;
      world = started.world;
      const option = options.find(option => option.dependency === dependency(slot))!;
      assert.equal(world.exomoney[0], before.exomoney[0] - option.cost);
      assert.equal(state.slots![slot].phase, "building");
      const host = transportHostState(world);
      const bytes = new DataView(world.entityBytes!.buffer);
      assert.equal(host.slots[slot]!.unitType, option.building.unitType);
      assert.equal(host.generations[slot], 0);
      assert.equal(host.registry[slot], world.entities.find(entity => entity.rawSlot === slot)!.key);
      assert.equal(bytes.getInt32(slot * 220 + 12, true), option.building.maxHealth);
      assert.equal(bytes.getUint8(slot * 220 + 6), option.building.unitType);
      assert.equal(host.highWater, transportHostState(before).highWater);
      for (const cell of option.building.footprint) {
        assert.equal(host.ground[cell.y * host.width + cell.x], slot);
        assert.equal(host.groundEligible[cell.y * host.width + cell.x], false);
      }
      assert.throws(() => reduceBrowserConstruction(configuration, state, world, purchase(dependency(slot))), /construction/);
      if (slot === 3) assert.throws(() => reduceBrowserConstruction(configuration, state, world, purchase(dependency(2))), /prerequisites/);
      const saved = JSON.parse(JSON.stringify(state));
      assert.deepEqual(restoreBrowserConstruction(configuration, saved, world), state);
      for (let visit = 0; visit < 120; visit++) {
        const next = reduceBrowserConstruction(configuration, state, world, { type: "visit", sequence: state.sequence + 1 });
        state = next.state;
        world = next.world;
      }
      assert.equal(state.slots![slot].phase, "ready");
      assert.equal(world.exomoney[0], before.exomoney[0] - option.cost);
      assert.throws(() => reduceBrowserConstruction(configuration, state, world, purchase(dependency(slot))), /Complete/);
    }
    assert.throws(() => reduceBrowserConstruction(configuration, state, world, purchase(dependency(4))), /prerequisites/);
    const upgrade = options.find(option => option.level === 1)!;
    assert.throws(() => reduceBrowserConstruction(configuration, state, world, purchase(upgrade.dependency)), /upgrade/);
    const other = await createBrowserConstructionConfiguration({ runtimeProfile: "browser-adapted", mission,
      completionVisits: 120, supportedSlots: [1, 2, 3, 4] });
    assert.throws(() => restoreBrowserConstruction(other, state, world), /schema|aggregate/);
    assert.throws(() => createBrowserConstruction(structuredClone(configuration), original), /authenticated/);
    await assert.rejects(createBrowserConstructionConfiguration({ runtimeProfile: "browser-adapted", mission,
      completionVisits: 119, supportedSlots: [1] }), /120/);
  });
}
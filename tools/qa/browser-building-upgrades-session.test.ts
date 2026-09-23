import assert from "node:assert/strict";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { CampaignSession, type CampaignSessionInput } from "../../src/engine/campaign-session";
import { sourceBrowserCampaignSessionOptions } from "../../src/engine/source-browser-campaign-options";
import { transportHostState } from "../../src/engine/transport-host";
import { sourceProductionUi } from "../../src/engine/source-production-options";
import { buildingUpgradeFundingLabel, fundedBuildingUpgradeFetch } from "./fixtures/building-upgrades";

test("building upgrade session: paid laboratory preserves identity, damage and exact replay", async context => {
  context.mock.method(globalThis, "fetch", fundedBuildingUpgradeFetch);
  context.diagnostic(buildingUpgradeFundingLabel);
  const mission = await loadCampaignMission("human", 7, "browser-adapted",
    { completionVisits: 120, supportedSlots: [1, 2, 3, 4], supportedActions: ["purchase", "upgrade"] });
  const configuration = mission.browserConstruction!;
  let session = new CampaignSession(sourceBrowserCampaignSessionOptions(mission));
  let tick = 0;
  const step = (input: Omit<CampaignSessionInput, "clockMilliseconds" | "productionVisits"> = {}) => {
    const result = session.step({ clockMilliseconds: ++tick * 50,
      productionVisits: session.browserFrameContext(150).productionVisits, ...input });
    assert.equal(result.ok, true, JSON.stringify(result));
  };
  const request = (slot: number, action: "purchase" | "upgrade") => {
    const choice = session.browserConstructionStatus!.choices.find(choice => choice.slot === slot && choice.action === action)!;
    assert.equal(choice.requestEnabled, true, choice.reason);
    step({ browserConstructionRequest: { type: action, sequence: session.snapshot.browserConstruction!.sequence + 1,
      id: `${action}:${slot}`, dependency: choice.dependency, home: configuration.home } });
  };
  const restore = () => {
    const saved = JSON.parse(JSON.stringify(session.checkpoint()));
    session = CampaignSession.restore(saved, undefined, undefined, undefined, undefined, undefined, configuration);
    assert.deepEqual(session.checkpoint(), saved);
  };
  request(3, "purchase");
  for (let visit = 0; visit < 120; visit++) step();
  step({ browserConstructionDamage: [{ slot: 3, generation: 0, health: 1200 }] });
  const before = session.snapshot.world.entities.find(entity => entity.rawSlot === 3)!;
  const highWater = transportHostState(session.snapshot.world).highWater;
  request(3, "upgrade");
  assert.equal(session.snapshot.production!.teams[0].slots[3].level, 0);
  assert.equal(session.snapshot.production!.teams[0].slots[3].busy, 1);
  restore();
  step({ browserConstructionDamage: [{ slot: 3, generation: 0, health: 900 }] });
  for (let visit = 1; visit < 120; visit++) step();
  const after = session.snapshot.world.entities.find(entity => entity.rawSlot === 3)!;
  assert.deepEqual(after, { ...before, unitType: 21, health: 900, maxHealth: 3600 });
  assert.equal(transportHostState(session.snapshot.world).highWater, highWater);
  assert.equal(session.snapshot.production!.teams[0].slots[3].level, 1);
  assert.equal(session.snapshot.production!.teams[0].slots[3].busy, 0);
  assert.equal(session.snapshot.production!.teams[0].costAccumulator, 4000);
  assert.equal(session.snapshot.world.exomoney[0], mission.scenario.teams[0].money - 4000);
  restore();
  request(4, "purchase");
  for (let visit = 0; visit < 120; visit++) step();
  assert.equal(session.snapshot.production!.teams[0].slots[4].busy, 0);
  restore();
});

for (const boundary of ["before", "during", "after"] as const) {
  test(`building upgrade source actor: death ${boundary}, producer levels and original identity`, async context => {
    context.mock.method(globalThis, "fetch", fundedBuildingUpgradeFetch);
    context.diagnostic("ALIEN04 funding-only source control: initial credits 10000 instead of 0; original city HP999, placements, restrictions and TRO unchanged.");
    const mission = await loadCampaignMission("alien", 4, "browser-adapted",
      { completionVisits: 120, supportedSlots: [1, 2, 3, 4], supportedActions: ["purchase", "upgrade"] });
    const configuration = mission.browserConstruction!;
    const session = new CampaignSession(sourceBrowserCampaignSessionOptions(mission));
    const initial = session.snapshot;
    const actor = initial.world.entities.find(entity => entity.rawSlot === 3)!;
    assert.equal(actor.key, "colony:3");
    assert.equal(actor.health, 999);
    let tick = 0;
    const step = (input: Omit<CampaignSessionInput, "clockMilliseconds" | "productionVisits"> = {}) => {
      const result = session.step({ clockMilliseconds: ++tick * 50,
        productionVisits: session.browserFrameContext(150).productionVisits, ...input });
      assert.equal(result.ok, true, JSON.stringify(result));
      return result;
    };
    const request = (slot: number) => {
      const choice = session.browserConstructionStatus!.choices.find(choice => choice.slot === slot && choice.action === "upgrade")!;
      return { type: "upgrade" as const, sequence: session.snapshot.browserConstruction!.sequence + 1,
        id: `original:${slot}`, dependency: choice.dependency, home: configuration.home };
    };
    step({ browserConstructionDamage: [{ slot: 3, generation: 0, health: 800 }] });
    const damaged = session.checkpoint();
    assert.equal(session.step({ clockMilliseconds: tick * 50, browserConstructionDamage: [{ slot: 3, generation: 0, health: 999 }] }).ok, false);
    assert.deepEqual(session.checkpoint(), damaged);
    const plant = session.snapshot.world.entities.find(entity => entity.rawSlot === 2)!;
    const queue = session.snapshot.production!.units.find(unit => unit.unitType === 10)!.queue;
    if (boundary === "after") {
      step({ browserConstructionRequest: request(2) });
      assert.equal(session.snapshot.world.exomoney[0], 8000);
      assert.equal(session.browserFrameContext(150).productionVisits!.some(visit => visit.team === 0 && visit.queue === queue), false);
    }
    if (boundary !== "before") {
      const started = step({ browserConstructionRequest: request(3) });
      assert.ok(started.ok);
      assert.equal(started.value.entry.browserConstructionEffects![0].key, "colony:3");
      assert.equal(session.snapshot.production!.teams[0].slots[3].busy, 1);
      assert.equal(session.snapshot.world.exomoney[0], boundary === "after" ? 6000 : 8000);
      const saved = JSON.parse(JSON.stringify(session.checkpoint()));
      const restored = CampaignSession.restore(saved, undefined, undefined, undefined, undefined, undefined, configuration);
      assert.deepEqual(restored.checkpoint(), saved);
      step({ browserConstructionDamage: [{ slot: 3, generation: 0, health: 700 }] });
      if (boundary === "after") {
        for (let visit = 1; visit < 120; visit++) step();
        assert.deepEqual(session.snapshot.world.entities.find(entity => entity.rawSlot === 3),
          { ...actor, health: 700, unitType: 33, maxHealth: 3600 });
        assert.equal(session.snapshot.production!.teams[0].slots[3].level, 1);
        assert.equal(session.browserConstructionStatus!.choices.find(choice => choice.slot === 4)!.requestEnabled, false, "original AL04 research-center restriction remains enforced");
        assert.deepEqual(session.snapshot.world.entities.find(entity => entity.rawSlot === 2),
          { ...plant, unitType: 31, maxHealth: 3600 });
        assert.equal(session.snapshot.production!.teams[0].slots[2].level, 1);
        assert.equal(session.browserFrameContext(150).productionVisits!.some(visit => visit.team === 0 && visit.queue === queue), true);
        const tank = sourceProductionUi(session.snapshot.production!, 0).find(choice => choice.unitType === 10)!;
        assert.equal(tank.nativeState, 1, "source prerequisites open independently of scripted credits");
        assert.equal(tank.maxAdditional, Math.floor(tank.credits / tank.cost));
      }
    }
    const beforeDeathCredits = session.snapshot.world.exomoney[0];
    step({ updates: [{ type: "combat-death", slot: 3, generation: 0 }] });
    const dead = session.snapshot;
    const upgraded = boundary === "after";
    assert.equal(dead.world.entities.find(entity => entity.rawSlot === 3)!.unitType, upgraded ? 33 : 32);
    assert.equal(dead.world.buildingSlots["0,3"], 0);
    assert.equal(dead.production!.teams[0].slots[3].busy, 0);
    assert.equal(dead.production!.teams[0].slots[3].level, upgraded ? 1 : 0);
    assert.equal(dead.browserConstruction!.upgrades![3]?.phase, boundary === "before" ? undefined : upgraded ? "ready" : "destroyed");
    assert.equal(dead.world.exomoney[0], beforeDeathCredits, "death cannot refund; original TRO may independently set credits during work");
    assert.equal(dead.production!.teams[0].costAccumulator, boundary === "before" ? 0 : upgraded ? 4000 : 2000);
    assert.equal(dead.world.entities.filter(entity => entity.rawSlot === 3).length, 1);
    assert.equal(transportHostState(dead.world).generations[3], 0);
    const checkpoint = session.checkpoint();
    assert.equal(session.step({ clockMilliseconds: (tick + 1) * 50, browserConstructionRequest: request(3) }).ok, false);
    assert.deepEqual(session.checkpoint(), checkpoint);
    assert.deepEqual(CampaignSession.restore(JSON.parse(JSON.stringify(checkpoint)), undefined, undefined, undefined,
      undefined, undefined, configuration).checkpoint(), checkpoint);
  });
}

test("building upgrade schema: exact actions, legacy omission and authenticated replay reject tampering", async context => {
  context.mock.method(globalThis, "fetch", fundedBuildingUpgradeFetch);
  const policy = { completionVisits: 120, supportedSlots: [2, 3, 4], supportedActions: ["purchase", "upgrade"] as const };
  const mission = await loadCampaignMission("alien", 4, "browser-adapted", policy);
  const configuration = mission.browserConstruction!;
  const session = new CampaignSession(sourceBrowserCampaignSessionOptions(mission));
  const choice = session.browserConstructionStatus!.choices.find(choice => choice.slot === 3 && choice.action === "upgrade")!;
  const input = { clockMilliseconds: 50, productionVisits: session.browserFrameContext(150).productionVisits,
    browserConstructionRequest: { type: "upgrade" as const, sequence: 1, id: "schema:upgrade", dependency: choice.dependency, home: configuration.home } };
  const initial = session.checkpoint();
  assert.equal(session.step({ ...input, browserConstructionRequest: { ...input.browserConstructionRequest, type: "purchase" } }).ok, false);
  assert.deepEqual(session.checkpoint(), initial);
  assert.equal(session.step(input).ok, true);
  const saved = JSON.parse(JSON.stringify(session.checkpoint()));
  const independentlyLoaded = await loadCampaignMission("alien", 4, "browser-adapted", policy);
  const restore = (checkpoint: unknown) => CampaignSession.restore(checkpoint, undefined, undefined, undefined,
    undefined, undefined, independentlyLoaded.browserConstruction);
  assert.deepEqual(restore(saved).checkpoint(), saved);
  assert.throws(() => CampaignSession.restore(saved), /construction restore/);
  for (const field of ["key", "health", "phase", "level", "paid", "unknown"] as const) {
    const forged = structuredClone(saved);
    forged.state.browserConstruction.upgrades[3][field] = field === "key" ? "colony:2" : field === "phase" ? "ready" : 998;
    assert.throws(() => restore(forged), field);
  }
  const forgedInput = structuredClone(saved);
  forgedInput.state.aiSelectorInputs[0].browserConstructionRequest.type = "purchase";
  assert.throws(() => restore(forgedInput));
  const missingActions = structuredClone(saved);
  delete missingActions.options.browserConstruction.supportedActions;
  assert.throws(() => restore(missingActions));
  const legacyMission = await loadCampaignMission("alien", 4, "browser-adapted", { completionVisits: 120, supportedSlots: [2, 3, 4] });
  const legacy = new CampaignSession(sourceBrowserCampaignSessionOptions(legacyMission));
  const legacySaved = JSON.parse(JSON.stringify(legacy.checkpoint()));
  assert.equal(Object.hasOwn(legacySaved.options.browserConstruction, "supportedActions"), false);
  assert.equal(Object.hasOwn(legacySaved.state.browserConstruction, "upgrades"), false);
  assert.equal(legacy.step(input).ok, false);
  assert.deepEqual(legacy.checkpoint(), legacySaved);
  assert.deepEqual(CampaignSession.restore(legacySaved, undefined, undefined, undefined, undefined, undefined,
    legacyMission.browserConstruction).checkpoint(), legacySaved);
  assert.throws(() => restore(legacySaved));
});
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test, { type TestContext } from "node:test";
import { parseScenario } from "../extractors/data/scenario";
import type { CampaignMissionData } from "../../src/game-data";
import { createCampaignWorld, initialAdaptedTroState } from "../../src/engine/campaign-world";
import type { CampaignWorld } from "../../src/engine/campaign-world";
import { projectLegacyColony } from "../../src/engine/legacy-colony";
import { createLegacyInfantryFamilyMask } from "../../src/engine/legacy-navigation";
import { initializeTransportHost, transportHostState } from "../../src/engine/transport-host";
import { browserConstructionChoices, browserConstructionSlots, createBrowserConstruction, createBrowserConstructionConfiguration,
  reduceBrowserConstruction, restoreBrowserConstruction, type BrowserConstructionRequest } from "../../src/engine/browser-construction";

const read = (path: string) => Uint8Array.from(readFileSync(new URL(`../../public${path}`, import.meta.url)));

async function fixture(context: TestContext, faction: "human" | "alien", city = "1 -1 1 -1 1 -1 1 -1 0 -1") {
  context.diagnostic("Controlled funded City fixture, source tables and geometry; no session/view or original-opening claim.");
  const stem = `${faction.toUpperCase()}/${faction.toUpperCase()}10`;
  const originalScenario = JSON.parse(new TextDecoder().decode(read(`/assets/generated/data/scenarios/${stem}.json`)));
  const map = JSON.parse(new TextDecoder().decode(read(`/assets/generated/maps/${stem}.json`)));
  const original = { faction, scenario: originalScenario, map,
    units: JSON.parse(new TextDecoder().decode(read("/assets/generated/data/units.json"))).records,
    pathGrid: read(`/assets/generated/maps/${faction.toUpperCase()}/${map.files.pathGrid}`),
    tags: read(`/assets/generated/maps/${faction.toUpperCase()}/${map.files.tags}`) } as CampaignMissionData;
  const lines = atob(original.scenario.rawScenario!).split(/\r?\n/);
  lines[lines.indexOf("%City") + 1] = city;
  lines[lines.indexOf("%Money") - 1] = "20000";
  lines[lines.indexOf("%Depend") - 1] = "-1";
  const raw = lines.join("\n");
  const scenario = { ...original.scenario, ...parseScenario(raw), rawScenario: btoa(raw),
    source: { ...original.scenario.source, sha256: createHash("sha256").update(raw).digest("hex") } };
  const mission = { ...original, scenario, sourceProduction: undefined, browserEconomy: undefined };
  const input = { runtimeProfile: "browser-adapted" as const, mission, completionVisits: 120, supportedSlots: [2, 3, 4],
    loadBytes: async (path: string) => path === `/assets/generated/data/scenarios/${scenario.source.path.replace(".SCN", ".json")}`
      ? new TextEncoder().encode(JSON.stringify(scenario)) : read(path) };
  const configuration = await createBrowserConstructionConfiguration({ ...input, supportedActions: ["purchase", "upgrade"] });
  const empty = createCampaignWorld({ sessionId: `upgrade:${faction}`, source: { ...parseScenario(raw), placementRows: [] },
    units: mission.units, messages: [], entityBytes: new Uint8Array(800 * 220) });
  assert.ok(empty.ok, JSON.stringify(empty));
  const initialized = initializeTransportHost(empty.value, { width: map.width, height: map.height,
    groundEligible: Array.from(createLegacyInfantryFamilyMask({ ...map, pathGrid: mission.pathGrid }), Boolean),
    definitions: [], sides: scenario.teams.map((team: { race: number }) => team.race),
    directionBits: [[0, 0]], fixedStepMilliseconds: 50, orientationSteps: 1, highWater: 152 });
  assert.ok(initialized.ok, JSON.stringify(initialized));
  const world = { ...initialized.value, source: parseScenario(raw),
    exomoney: { ...initialized.value.exomoney, 0: scenario.teams[0].money },
    browserCasualtyPickup: { runtimeProfile: "browser-adapted" as const } };
  const colony = projectLegacyColony(scenario.teams, mission.units);
  world.buildingSlots = { ...colony.buildingSlots };
  const host = transportHostState(world);
  world.entities = colony.buildings.filter(building => building.team === 0).map(building => {
    const slot = building.slot, key = `colony:${slot}`;
    const bytes = new DataView(world.entityBytes!.buffer);
    bytes.setUint16(slot * 220, building.nativePosition.x, true);
    bytes.setUint16(slot * 220 + 4, building.nativePosition.y, true);
    bytes.setUint8(slot * 220 + 6, building.unitType);
    bytes.setInt32(slot * 220 + 12, building.health, true);
    bytes.setUint8(slot * 220 + 0x2c, 1);
    host.slots[slot] = { slot, key, generation: 0, team: 0, unitType: building.unitType,
      position: { ...building.nativePosition }, height: 0, health: building.health, status: 1, task: "unit", taskWords: [] };
    host.registry[slot] = key;
    host.generations[slot] = 0;
    for (const cell of building.footprint) {
      host.groundEligible[cell.y * map.width + cell.x] = false;
    }
    return { key, generation: 0, sourceRow: null, team: 0, unitType: building.unitType,
      tileX: Math.floor(building.position.x), tileY: Math.floor(building.position.y), rawTail: [],
      health: building.health, maxHealth: building.maxHealth, rawSlot: slot, simulationId: null };
  });
  world.transportState = host;
  return { input, configuration, world, state: createBrowserConstruction(configuration, world) };
}

function damaged(world: CampaignWorld, slot: number, health: number): CampaignWorld {
  const host = transportHostState(world), bytes = Uint8Array.from(world.entityBytes!);
  host.slots[slot]!.health = health;
  host.slots[slot]!.status = health === 0 ? 10 : 1;
  host.slots[slot]!.task = health === 0 ? "death" : "unit";
  if (health === 0) {
    host.ground = host.ground.map(occupant => occupant === slot ? -1 : occupant);
  }
  new DataView(bytes.buffer).setInt32(slot * 220 + 12, health, true);
  bytes[slot * 220 + 0x2c] = health === 0 ? 10 : 1;
  return { ...world, entityBytes: bytes, transportState: host,
    buildingSlots: { ...world.buildingSlots, [`0,${slot}`]: health },
    entities: world.entities.map(entity => entity.rawSlot === slot ? { ...entity, health } : entity) };
}

for (const faction of ["human", "alien"] as const) {
  test(`building upgrade catalog: ${faction} explicit source selector1 capabilities and unchanged defaults`, async context => {
    const { input, configuration } = await fixture(context, faction);
    const legacy = await createBrowserConstructionConfiguration(input);
    assert.equal(legacy.supportedActions, undefined);
    assert.equal(legacy.policy.upgradeHealth, undefined);
    assert.notEqual(legacy.sourceId, configuration.sourceId);
    assert.equal(configuration.policy.upgradeHealth, "adapted-preserve-hp-capped-new-max");
    assert.deepEqual(configuration.buildings!.filter(option => option.level === 1).map(option => ({
      dependency: option.dependency, slot: option.building.slot, cost: option.cost, type: option.building.unitType,
      maxHealth: option.building.maxHealth,
    })), faction === "human" ? [
      { dependency: 4, slot: 3, cost: 2000, type: 21, maxHealth: 3600 },
      { dependency: 5, slot: 2, cost: 2000, type: 19, maxHealth: 3600 },
    ] : [
      { dependency: 18, slot: 3, cost: 2000, type: 33, maxHealth: 3600 },
      { dependency: 19, slot: 2, cost: 2000, type: 31, maxHealth: 3600 },
    ]);
    await assert.rejects(createBrowserConstructionConfiguration({ ...input, supportedSlots: undefined, supportedActions: ["upgrade"] }), /actions require/);
    await assert.rejects(createBrowserConstructionConfiguration({ ...input, supportedActions: ["upgrade", "purchase"] }), /actions require/);
  });

  for (const slot of [2, 3]) {
    test(`building upgrade lifecycle: ${faction} slot${slot} same actor, live damage, source level and exact restore`, async context => {
      const setup = await fixture(context, faction), { configuration } = setup;
      let state = setup.state, world = damaged(setup.world, slot, 1301);
      const option = configuration.buildings!.find(option => option.level === 1 && option.building.slot === slot)!;
      const before = structuredClone(world), hostBefore = transportHostState(world);
      const request: BrowserConstructionRequest = { type: "upgrade", sequence: 1, id: `upgrade:${slot}`,
        dependency: option.dependency, home: configuration.home };
      const started = reduceBrowserConstruction(configuration, state, world, request, true);
      assert.deepEqual(world, before);
      ({ state, world } = started);
      assert.equal(state.paid, option.cost);
      assert.equal(world.exomoney[0], 20000 - option.cost);
      assert.equal(world.entities.length, before.entities.length);
      assert.deepEqual(world.entityBytes, before.entityBytes, "purchase does not reconstruct the actor or rewrite its raw bytes");
      assert.deepEqual(transportHostState(world), hostBefore);
      assert.deepEqual(browserConstructionSlots(configuration, state, world)[slot], { health: 1301, level: 0, busy: 1 });
      assert.equal(started.effects[0].action, "upgrade");
      assert.equal(browserConstructionChoices(configuration, state, world).find(choice => choice.slot === 4)!.requestEnabled, false);
      const independent = await createBrowserConstructionConfiguration({ ...setup.input, supportedActions: ["purchase", "upgrade"] });
      let resumedState = restoreBrowserConstruction(independent, JSON.parse(JSON.stringify(state)), world);
      let resumedWorld = structuredClone(world);
      for (let visit = 1; visit <= 120; visit++) {
        if (visit === 60) {
          world = damaged(world, slot, 997);
          resumedWorld = damaged(resumedWorld, slot, 997);
        }
        const input = { type: "visit" as const, sequence: state.sequence + 1 };
        const transition = reduceBrowserConstruction(configuration, state, world, input, true);
        const resumed = reduceBrowserConstruction(independent, resumedState, resumedWorld, input, true);
        assert.deepEqual(resumed, transition);
        ({ state, world } = transition);
        resumedState = resumed.state;
        resumedWorld = resumed.world;
        if (visit === 60) assert.throws(() => reduceBrowserConstruction(configuration, state, damaged(world, slot, 1301),
          { type: "visit", sequence: state.sequence + 1 }, true), /heal/);
        if (visit === 119) assert.equal(browserConstructionSlots(configuration, state, world)[slot].level, 0);
        if (visit === 120) assert.deepEqual(transition.effects[0], {
          type: "construction-ready", action: "upgrade", slot, generation: 0, key: hostBefore.slots[slot]!.key,
          receiptId: request.id, dependency: option.dependency, busy: 0, level: 1,
          unitType: option.building.unitType, maxHealth: 3600, health: 997,
        });
      }
      assert.deepEqual(browserConstructionSlots(configuration, state, world)[slot], { health: 997, level: 1, busy: 0 });
      const actor = transportHostState(world).slots[slot]!, entity = world.entities.find(entity => entity.rawSlot === slot)!;
      assert.equal(actor.key, hostBefore.slots[slot]!.key);
      assert.equal(actor.generation, 0);
      assert.equal(actor.unitType, option.building.unitType);
      assert.equal(actor.health, 997);
      assert.equal(entity.maxHealth, 3600);
      assert.equal(world.entities.length, before.entities.length);
      assert.deepEqual(transportHostState(world).ground, hostBefore.ground);
      assert.deepEqual(transportHostState(world).registry, hostBefore.registry);
      assert.equal(transportHostState(world).highWater, hostBefore.highWater);
      assert.ok(world.entityBytes!.every((value, index) => [slot * 220 + 6, ...[12, 13, 14, 15].map(offset => slot * 220 + offset)].includes(index)
        || value === before.entityBytes![index]), "upgrade changes only raw type and externally damaged HP bytes");
      assert.deepEqual(world.source, before.source, "original City source bytes remain immutable");
      assert.deepEqual(restoreBrowserConstruction(configuration, JSON.parse(JSON.stringify(state)), world), state);
      assert.throws(() => reduceBrowserConstruction(configuration, state, world, { ...request, sequence: state.sequence + 1 }, true), /Current level/);
      assert.throws(() => restoreBrowserConstruction(configuration, state, damaged(world, slot, 1301)), /heal/);
      assert.throws(() => restoreBrowserConstruction({ ...configuration }, state, world), /authenticated/);
      assert.throws(() => restoreBrowserConstruction(configuration, { ...state, sourceId: "forged" }, world), /aggregate/);
      assert.throws(() => restoreBrowserConstruction(configuration, { ...state, upgrades: { ...state.upgrades,
        [slot]: { ...state.upgrades![slot], paid: 1 } } }, world), /aggregate|receipt/);
      if (slot === 3) {
        const research = browserConstructionChoices(configuration, state, world).find(choice => choice.slot === 4)!;
        assert.equal(research.requestEnabled, true);
        const built = reduceBrowserConstruction(configuration, state, world, { type: "purchase", sequence: state.sequence + 1,
          id: "research:center", dependency: research.dependency, home: configuration.home }, true);
        assert.equal(built.world.entities.length, world.entities.length + 1);
        assert.equal(built.world.exomoney[0], 15000);
        assert.equal(built.state.costAccumulator, 5000);
      }
    });
  }

  test(`building upgrade guards: ${faction} funds prerequisites restrictions capabilities identity and duplicate receipts`, async context => {
    const setup = await fixture(context, faction), { configuration, world, state } = setup;
    const dependency = (slot: number) => configuration.buildings!.find(option => option.level === 1 && option.building.slot === slot)!.dependency;
    const request: BrowserConstructionRequest = { type: "upgrade", sequence: 1, id: "upgrade:guards", dependency: dependency(2), home: configuration.home };
    const before = structuredClone(world), saved = structuredClone(state);
    assert.throws(() => reduceBrowserConstruction(configuration, state, { ...world, exomoney: { ...world.exomoney, 0: 1999 } }, request), /credits/);
    assert.throws(() => reduceBrowserConstruction(configuration, state, damaged(world, faction === "human" ? 3 : 0, 0), request), /prerequisites/);
    assert.throws(() => reduceBrowserConstruction(configuration, state, world, { ...request, dependency: faction === "human" ? 19 : 5 }), /unsupported/);
    assert.throws(() => reduceBrowserConstruction(configuration, state, world, { ...request, type: "purchase" }), /unsupported/);
    assert.throws(() => reduceBrowserConstruction(configuration, state, world, { ...request, sequence: 0 }), /sequence/);
    assert.throws(() => reduceBrowserConstruction(configuration, state, world, { ...request, home: { x: 0, y: 0 } }), /home/);
    const tro = initialAdaptedTroState(world);
    const restricted = { ...world, adaptedTro: { ...tro,
      dependencyRestrictions: tro.dependencyRestrictions.map((entries, team) => team === 0 ? [dependency(2)] : entries) } };
    assert.throws(() => reduceBrowserConstruction(configuration, state, restricted, request), /restriction/);
    const doubled = { ...world, entities: [...world.entities, world.entities.find(entity => entity.rawSlot === 2)!] };
    assert.throws(() => reduceBrowserConstruction(configuration, state, doubled, request), /duplicate/);
    const bytes = Uint8Array.from(world.entityBytes!);
    bytes[2 * 220 + 6]++;
    assert.throws(() => reduceBrowserConstruction(configuration, state, { ...world, entityBytes: bytes }, request), /raw mismatch/);
    const legacy = await createBrowserConstructionConfiguration(setup.input), oldState = createBrowserConstruction(legacy, world);
    assert.equal(Object.hasOwn(oldState, "upgrades"), false);
    assert.throws(() => reduceBrowserConstruction(legacy, oldState, world, request), /unsupported/);
    assert.throws(() => restoreBrowserConstruction(legacy, state, world), /schema/);
    const started = reduceBrowserConstruction(configuration, state, world, request);
    assert.throws(() => reduceBrowserConstruction(configuration, started.state, started.world, request), /sequence/);
    assert.throws(() => reduceBrowserConstruction(configuration, started.state, started.world, { ...request, sequence: 2 }), /construction/);
    assert.throws(() => reduceBrowserConstruction(configuration, started.state, started.world,
      { ...request, sequence: 2, dependency: dependency(3) }), /duplicate/);
    const concurrent = reduceBrowserConstruction(configuration, started.state, started.world,
      { ...request, sequence: 2, dependency: dependency(3), id: "another:upgrade" });
    assert.equal(concurrent.state.upgrades![2].elapsedVisits, 1);
    assert.equal(concurrent.state.upgrades![3].elapsedVisits, 0);
    assert.equal(concurrent.state.paid, 4000);
    assert.deepEqual(world, before);
    assert.deepEqual(state, saved);
  });

  test(`building upgrade constructed: ${faction} level0 receipt becomes upgradeable only when ready and death cannot heal`, async context => {
    const { configuration, state: initial, world: initialWorld } = await fixture(context, faction, "1 -1 1 -1 1 -1 0 -1 0 -1");
    const base = configuration.buildings!.find(option => option.level === 0 && option.building.slot === 3)!;
    const upgraded = configuration.buildings!.find(option => option.level === 1 && option.building.slot === 3)!;
    let { state, world } = reduceBrowserConstruction(configuration, initial, initialWorld, { type: "purchase", sequence: 1,
      id: "lab:base", dependency: base.dependency, home: configuration.home });
    const request = { type: "upgrade" as const, sequence: 2, id: "lab:upgrade", dependency: upgraded.dependency, home: configuration.home };
    assert.throws(() => reduceBrowserConstruction(configuration, state, world, request), /construction/);
    for (let visit = 0; visit < 120; visit++) ({ state, world } = reduceBrowserConstruction(configuration, state, world,
      { type: "visit", sequence: state.sequence + 1 }));
    world = damaged(world, 3, 1700);
    ({ state, world } = reduceBrowserConstruction(configuration, state, world, { ...request, sequence: state.sequence + 1 }, true));
    const started = { state, world };
    for (let visit = 0; visit < 120; visit++) ({ state, world } = reduceBrowserConstruction(configuration, state, world,
      { type: "visit", sequence: state.sequence + 1 }, true));
    assert.equal(world.entities.filter(entity => entity.rawSlot === 3).length, 1);
    assert.equal(world.buildingSlots["0,3"], 1700);
    assert.equal(state.slots![3].receiptId, "lab:base");
    assert.equal(state.upgrades![3].key, "browser-construction:3:0:lab:base");
    assert.deepEqual(restoreBrowserConstruction(configuration, JSON.parse(JSON.stringify(state)), world), state);
    const dead = reduceBrowserConstruction(configuration, started.state, damaged(started.world, 3, 0),
      { type: "visit", sequence: started.state.sequence + 1 }, true);
    assert.equal(dead.state.upgrades![3].phase, "destroyed");
    assert.equal(dead.world.buildingSlots["0,3"], 0);
    assert.equal(dead.world.exomoney[0], 16000);
    assert.equal(dead.state.costAccumulator, 4000);
    assert.equal(dead.world.entities.find(entity => entity.rawSlot === 3)!.unitType, base.building.unitType);
    assert.equal(browserConstructionSlots(configuration, dead.state, dead.world)[3].level, 0);
    assert.equal(browserConstructionChoices(configuration, dead.state, dead.world).find(choice => choice.slot === 4)!.requestEnabled, false);
    assert.deepEqual(restoreBrowserConstruction(configuration, dead.state, dead.world), dead.state);
    assert.throws(() => reduceBrowserConstruction(configuration, dead.state, dead.world,
      { ...request, sequence: dead.state.sequence + 1 }, true), /destroyed/);
  });

  test(`building upgrade current level: ${faction} original level1 is not repurchasable`, async context => {
    const { configuration, state, world } = await fixture(context, faction, "1 -1 1 -1 2 -1 2 -1 0 -1");
    for (const option of browserConstructionChoices(configuration, state, world).filter(choice => choice.level === 1)) {
      assert.equal(option.requestEnabled, false);
      assert.match(option.reason, /Current level/);
      assert.throws(() => reduceBrowserConstruction(configuration, state, world, { type: "upgrade", sequence: 1,
        id: "already", dependency: option.dependency, home: configuration.home }), /Current level/);
    }
  });
}
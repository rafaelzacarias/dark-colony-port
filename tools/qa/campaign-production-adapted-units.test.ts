import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadSourceProductionOptions, producerProfiles, sourceProductionUi, sourceProductionVisits } from "../../src/engine/source-production-options";
import { ADAPTED_UNIT_PRODUCTION_SOURCES, createCampaignProduction, productionChoices, productionSnapshot,
  reduceCampaignProduction, stepCampaignProductionProducer, synchronizeBrowserProductionColony,
  type CampaignProductionState, type ProductionAction, type ProductionUnitSource } from "../../src/engine/campaign-production";
import type { CampaignWorld } from "../../src/engine/campaign-world";
import type { CampaignMissionData } from "../../src/game-data";
import type { LegacyProductionSourceRecord } from "../../src/engine/legacy-production";
import { initializeTransportHost, transportHostState, updateTransportHostUnit } from "../../src/engine/transport-host";
import { unitOptionsFromLegacy } from "../../src/engine/legacy-balance";
import { parseDependencies, parseUnitStats } from "../extractors/data/tables";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
const units: CampaignMissionData["units"] = JSON.parse(read("public/assets/generated/data/units.json").toString()).records;
const records: LegacyProductionSourceRecord[] = JSON.parse(read("public/assets/generated/data/dependencies.json").toString()).records;

function input() {
  return { sessionId: "adapted-units", mission: { faction: "human" as const, units,
    scenario: JSON.parse(read("public/assets/generated/data/scenarios/HUMAN/HUMAN02.json").toString()) },
  rawScenario: read("raw_cd/DC/SCENARIO/HUMAN/HUMAN02.SCN"),
  configuration: { profile: "user-selected-source-campaign-fresh" as const, mode: 0 as const,
    localTeam: 0 as const, race: 0 as const }, loadBytes: async (url: string) => read(`public${url}`) };
}

test("adapted units: explicit combat roster opt-in leaves strict production unchanged", async () => {
  const strict = await loadSourceProductionOptions(input());
  const request = { ...input(), adaptedUnits: { runtimeProfile: "browser-adapted" as const, completionVisits: 3 } };
  const adapted = await loadSourceProductionOptions(request);
  assert.deepEqual(strict.choices.map(choice => choice.unitType), [0]);
  assert.deepEqual(adapted.production!.sourceProfiles, strict.production!.sourceProfiles);
  const combat = adapted.choices.find(choice => choice.unitType === 2);
  assert.ok(combat, "source ground combat type 2 must be explicitly admitted");
  assert.equal(combat.dependency, 11);
  assert.equal(combat.cost, 600);
  assert.equal(combat.producerNativeSlot, 2);
});

function options(race: 0 | 1, collectors = false) {
  const offsets = [[[0, -3], [0, -3]], [[2, 3], [-5, -1]], [[-4, 0], [-5, -1]], [[-4, 3], [-4, 3]]];
  return { sessionId: "adapted-units", records,
    units: records.filter(entry => entry.rawFields[0] === 1).map(entry => {
      const unitType = entry.rawFields[1], raw = units[unitType].rawTail!;
      const queue = raw[10] as ProductionUnitSource["queue"], exitSelector = raw[12] as 0 | 1;
      const [x, y] = offsets[queue][exitSelector];
      return { unitType, queue, exitSelector, exitOffset: { x, y } };
    }),
    sourceProfiles: producerProfiles(JSON.parse(read(`public/assets/generated/animations/${race ? "ALBU" : "HUBU"}.json`).toString()), race),
    adaptedUnitProfiles: ADAPTED_UNIT_PRODUCTION_SOURCES.filter(source => source.race === race)
      .map(source => ({ runtimeProfile: "browser-adapted" as const, unitType: source.unitType, completionVisits: 3 })),
    ...(collectors ? { adaptedCollectorProfiles: [{ runtimeProfile: "browser-adapted" as const,
      unitType: race ? 14 as const : 6 as const, completionVisits: 2 }] } : {}),
    teams: [{ team: 0, race, credits: 20000, costAccumulator: 0, base: { x: 20, y: 20 }, restrictions: [] as number[], upgrades: [],
      slots: [4800, 2400, 2400, 2400, 2400].map((health, slot) => ({ health, level: slot === 2 || slot === 3 ? 1 : 0, busy: 0 as const })) }] };
}

function act(state: CampaignProductionState, action: ProductionAction) {
  return reduceCampaignProduction(state, { id: `unit:${state.journal.length}`, team: 0, action });
}

function enqueue(state: CampaignProductionState, dependency: number) {
  return act(act(state, { type: "reserve", dependency }), { type: "dispatch", dependency });
}

function worldFixture(race: 0 | 1): CampaignWorld {
  const entityBytes = new Uint8Array(800 * 220), bytes = new DataView(entityBytes.buffer);
  const entities = [0, 1, 3, 5, 6].map((offset, slot) => {
    const unitType = (race ? 28 : 16) + offset, health = slot ? 2400 : 4800;
    bytes.setUint16(slot * 220, (20 + slot) * 256, true);
    bytes.setUint16(slot * 220 + 4, 20 * 256, true);
    bytes.setUint32(slot * 220 + 12, health, true);
    entityBytes[slot * 220 + 6] = unitType;
    entityBytes[slot * 220 + 0x2c] = 1;
    return { key: `building:${slot}`, generation: 0, sourceRow: null, team: 0, unitType,
      tileX: 20 + slot, tileY: 20, rawTail: [], health, maxHealth: health, rawSlot: slot, simulationId: null };
  });
  const source: CampaignWorld = { sessionId: "adapted-units", browserCasualtyPickup: { runtimeProfile: "browser-adapted" },
    source: { id: "test", teams: [{ index: 0, race }], placementRows: [] },
    placementState: { firstSlot: 152, nextSlot: 152, highWater: 152, renatSources: [], renatBytes: new Uint8Array(1000) },
    entities, buildingSlots: Object.fromEntries(Array.from({ length: 40 }, (_, index) =>
      [`${Math.floor(index / 5)},${index % 5}`, index < 5 ? entities[index].health : 0])),
    entityBytes, typeMovementClasses: null, commanderSlots: {}, messageTexts: {}, messages: [], exomoney: {}, statistics: {},
    clockMilliseconds: 0, transportState: null };
  const definitions = [...entities.map(entity => entity.unitType), race * 8, race ? 14 : 6,
    ...ADAPTED_UNIT_PRODUCTION_SOURCES.filter(entry => entry.race === race).map(entry => entry.unitType)]
    .map(unitType => ({ unitType, health: units[unitType].health, movementSpeed: 64,
      plane: ADAPTED_UNIT_PRODUCTION_SOURCES.find(entry => entry.unitType === unitType)?.plane ?? "ground" as const }));
  const result = initializeTransportHost(source, { width: 32, height: 32, groundEligible: Array(1024).fill(true),
    definitions, highWater: 152, sides: Array(8).fill(race), directionBits: [], fixedStepMilliseconds: 16, orientationSteps: 1 });
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}

function step(frame: { production: CampaignProductionState; world: CampaignWorld }, queue: ProductionUnitSource["queue"], population = 0) {
  return stepCampaignProductionProducer(frame.production, frame.world, { team: 0, queue, population, populationLimit: 150 },
    `visit:${frame.production.journal.length}`, "browser-adapted");
}

function destroy(world: CampaignWorld, slot: number) {
  const result = updateTransportHostUnit(world, { type: "combat-death", slot, generation: 0 });
  assert.ok(result.ok, JSON.stringify(result));
  const entityBytes = new Uint8Array(result.value.entityBytes!);
  new DataView(entityBytes.buffer).setUint32(slot * 220 + 12, 0, true);
  return { ...result.value, entityBytes };
}

test("adapted units: contracts match original decoded tables and existing combat options", () => {
  assert.deepEqual(records, parseDependencies(read("raw_cd/DC/GAMESTAT/DEPEND.TXT").toString()));
  assert.deepEqual(units, parseUnitStats(read("raw_cd/DC/GAMESTAT/GAMESTAT.TXT").toString()));
  const weapons: CampaignMissionData["weapons"] = JSON.parse(read("public/assets/generated/data/weapons.json").toString()).records;
  for (const source of ADAPTED_UNIT_PRODUCTION_SOURCES) {
    const entry = records.find(record => record.id === source.dependency)!;
    const unit: CampaignMissionData["units"][number] = units[source.unitType];
    assert.deepEqual([entry.cost, entry.dependencies, entry.rawFields], [source.cost, source.dependencies, [1, source.unitType]]);
    assert.deepEqual([unit.rawTail![10], unit.rawTail![12]], [source.queue, source.exitSelector]);
    assert.equal(unit.rawTail![2], source.plane === "flying" ? 1 : 0);
    for (const level of [0, 1, 2]) assert.ok(unitOptionsFromLegacy(unit, weapons, level).weapon);
  }
});

for (const source of ADAPTED_UNIT_PRODUCTION_SOURCES) {
  const { unitType, race, queue, dependency, cost, plane } = source;
  const slot = [1, 2, 0, 4][queue];
  const tile = { x: 20 + source.exitOffset.x, y: 20 + source.exitOffset.y };
  const index = tile.y * 32 + tile.x;
  test(`adapted unit ${unitType}: exact cost, queue, exit, producer, clock and replay`, () => {
    const initial = createCampaignProduction(options(race));
    const queued = enqueue(initial, dependency);
    assert.equal(queued.teams[0].credits, 20000 - cost);
    assert.equal(queued.teams[0].costAccumulator, cost);
    assert.equal(sourceProductionUi(initial, 0).find(choice => choice.dependency === dependency)!.producerNativeSlot, slot);
    assert.deepEqual(sourceProductionVisits(worldFixture(race), initial, 150).map(visit => visit.queue), [0, 1, 2, 3]);
    let frame = step({ production: queued, world: worldFixture(race) }, queue);
    assert.equal(transportHostState(frame.world)[plane][index], 1022);
    assert.equal(frame.production.teams[0].queues[queue].animation, undefined);
    const ticket = frame.production.teams[0].queues[queue].items[0].ticket;
    assert.throws(() => act(frame.production, { type: "producer-completed", queue, ticket, animationMode: 2 }), /fabricated/);
    frame = step(frame, queue);
    const restored = { production: productionSnapshot(JSON.parse(JSON.stringify(frame.production))), world: structuredClone(frame.world) };
    let replay = initial;
    for (const event of frame.production.journal) replay = reduceCampaignProduction(replay, event);
    assert.deepEqual(replay, restored.production);
    assert.equal(frame.production.teams[0].queues[queue].adaptedElapsedVisits, 1);
    frame = step(frame, queue);
    assert.equal(frame.world.entities.length, 5);
    frame = step(frame, queue);
    assert.deepEqual(step(step(restored, queue), queue), frame);
    const host = transportHostState(frame.world), actor = host.slots[152]!;
    assert.deepEqual([actor.unitType, actor.team, actor.generation, actor.position.x, actor.position.y],
      [unitType, 0, 0, tile.x * 256 + 128, tile.y * 256 + 128]);
    assert.equal(host.registry[152], actor.key);
    assert.equal(host[plane][index], 152);
    assert.deepEqual(host.productionExits, []);
    assert.equal(frame.world.entityBytes![152 * 220 + 6], unitType);
    assert.equal(new DataView(frame.world.entityBytes!.buffer).getUint32(152 * 220 + 12, true), units[unitType].health);
    assert.equal(frame.production.teams[0].queues[queue].items.length, 0);
    assert.equal(frame.production.teams[0].queues[queue].adaptedElapsedVisits, undefined);
    assert.equal(step(frame, queue).world.entities.length, 6);
  });
  test(`adapted unit ${unitType}: restrictions, credits, strict ownership and cap refund`, () => {
    const setup = options(race);
    const poor = createCampaignProduction({ ...setup, teams: [{ ...setup.teams[0], credits: cost - 1 }] });
    assert.equal(productionChoices(poor, 0).find(choice => choice.dependency === dependency)!.maxAdditional, 0);
    assert.throws(() => act(poor, { type: "reserve", dependency }), /underflow/);
    const restricted = createCampaignProduction({ ...setup, teams: [{ ...setup.teams[0], restrictions: [dependency] }] });
    assert.throws(() => act(restricted, { type: "reserve", dependency }), /eligible/);
    const strict = createCampaignProduction({ ...setup, adaptedUnitProfiles: undefined });
    assert.throws(() => act(strict, { type: "reserve", dependency }), /profile/);
    const initial = createCampaignProduction(setup);
    const pending = act(initial, { type: "reserve", dependency });
    assert.equal(act(pending, { type: "release-pending", dependency }).teams[0].credits, 20000);
    const frame = { production: enqueue(initial, dependency), world: worldFixture(race) };
    assert.throws(() => stepCampaignProductionProducer(frame.production, frame.world,
      { team: 0, queue, population: 0, populationLimit: 150 }, "strict"), /strict-native/);
    assert.throws(() => step({ ...frame, world: { ...frame.world, browserCasualtyPickup: undefined } }, queue), /browser-adapted/);
    const capped = step(frame, queue, 150);
    assert.deepEqual([capped.production.teams[0].credits, capped.production.teams[0].costAccumulator], [20000, 0]);
    assert.equal(capped.production.teams[0].queues[queue].items.length, 0);
    assert.equal(transportHostState(capped.world)[plane][index], -1);
  });
  test(`adapted unit ${unitType}: blocked exit waits, wrong producer rejects, correct plane owns reservation`, () => {
    const production = enqueue(createCampaignProduction(options(race)), dependency);
    const world = worldFixture(race);
    const wrong = { ...world, entities: world.entities.map(entity => entity.rawSlot === slot ? { ...entity, unitType: 25 } : entity) };
    assert.throws(() => step({ production, world: wrong }, queue), /producer unavailable/);
    const host = transportHostState(world);
    host[plane][index] = 1022;
    const blocked = step({ production, world: { ...world, transportState: host } }, queue);
    assert.equal(blocked.production.teams[0].queues[queue].ready, 1);
    assert.equal(blocked.production.teams[0].queues[queue].activeTicket, null);
    host[plane][index] = -1;
    if (plane === "flying") {
      host.groundEligible[index] = false;
      host.ground[index] = 1022;
      let airborne = step({ production, world: { ...world, transportState: host } }, queue);
      for (let count = 0; count < 3; count++) airborne = step(airborne, queue);
      assert.equal(transportHostState(airborne.world).flying[index], 152);
      assert.equal(transportHostState(airborne.world).ground[index], 1022);
    }
  });
  for (const phase of ["pending", "queued", "active", "spawned"] as const) {
    test(`adapted unit ${unitType}: destruction cancels ${phase} without changing debit rules`, () => {
      let production = act(createCampaignProduction(options(race)), { type: "reserve", dependency });
      if (phase !== "pending") production = act(production, { type: "dispatch", dependency });
      let frame = { production, world: worldFixture(race) };
      if (phase === "active" || phase === "spawned") frame = step(frame, queue);
      if (phase === "spawned") for (let count = 0; count < 3; count++) frame = step(frame, queue);
      const restore = structuredClone(frame);
      const cancel = (value: typeof frame) => synchronizeBrowserProductionColony(value.production, destroy(value.world, slot), "browser-adapted");
      frame = cancel(frame);
      assert.deepEqual(cancel(restore), frame);
      assert.equal(frame.production.teams[0].credits, phase === "pending" ? 20000 : 20000 - cost);
      assert.equal(frame.production.teams[0].costAccumulator, phase === "pending" ? 0 : cost);
      assert.equal(frame.production.teams[0].queues[queue].items.length, 0);
      assert.equal(transportHostState(frame.world)[plane][index], phase === "spawned" ? 152 : -1);
      assert.equal(transportHostState(frame.world).productionExits?.length ?? 0, 0);
      assert.equal(sourceProductionVisits(frame.world, frame.production, 150).some(visit => visit.queue === queue), false);
      assert.deepEqual(step(frame, queue), frame);
    });
  }
}

for (const race of [0, 1] as const) {
  test(`adapted units ${race}: excludes unsupported roles and other faction without migrating collectors`, () => {
    const setup = options(race, true), state = createCampaignProduction(setup);
    assert.deepEqual(state.adaptedCollectorProfiles, setup.adaptedCollectorProfiles);
    assert.deepEqual(sourceProductionUi(state, 0).map(choice => choice.unitType).sort((left, right) => left! - right!),
      [0, 2, 3, 4, 5, 6].map(type => type + race * 8));
    for (const unitType of [1, 9, 43, 44, 49, 50]) {
      const dependency = records.find(entry => entry.rawFields[0] === 1 && entry.rawFields[1] === unitType)!.id;
      assert.equal(productionChoices(state, 0).find(choice => choice.dependency === dependency)!.supported, false);
      assert.throws(() => act(state, { type: "reserve", dependency }), /eligible|profile/);
    }
    const foreign = createCampaignProduction({ ...setup, adaptedUnitProfiles: options(race ? 0 : 1).adaptedUnitProfiles });
    assert.equal(sourceProductionUi(foreign, 0).length, 2);
  });
  test(`adapted units ${race}: shared collector/air FIFO resets clocks and selects each source exit`, () => {
    const initial = createCampaignProduction(options(race, true));
    const collector = race ? 21 : 7, aircraft = race ? 24 : 10;
    for (const sequence of [[collector, aircraft], [aircraft, collector]]) {
      let production = initial;
      for (const dependency of sequence) production = enqueue(production, dependency);
      let frame = { production, world: worldFixture(race) };
      for (const [position, dependency] of sequence.entries()) {
        frame = step(frame, 2);
        assert.equal(frame.production.teams[0].queues[2].adaptedElapsedVisits, 0);
        for (let count = 0; count < (dependency === collector ? 2 : 3); count++) frame = step(frame, 2);
        assert.equal(transportHostState(frame.world).slots[152 + position]!.unitType,
          dependency === collector ? 6 + race * 8 : 5 + race * 8);
      }
      assert.equal(frame.production.teams[0].queues[2].items.length, 0);
      assert.deepEqual([frame.production.teams[0].credits, frame.production.teams[0].costAccumulator], [17900, 2100]);
    }
    const limited = createCampaignProduction({ ...options(race, true), queueSafetyLimit: 1 });
    const reserved = act(limited, { type: "reserve", dependency: aircraft });
    assert.throws(() => act(reserved, { type: "reserve", dependency: collector }), /FIFO/);
  });
  test(`adapted units ${race}: original prerequisites and producer upgrade level gate advanced combat`, () => {
    const setup = options(race);
    const lowLevel = createCampaignProduction({ ...setup, teams: [{ ...setup.teams[0],
      slots: setup.teams[0].slots.map(slot => ({ ...slot, level: 0 })) }] });
    const allowed = productionChoices(lowLevel, 0).filter(choice => choice.supported && choice.maxAdditional > 0).map(choice => choice.dependency);
    assert.deepEqual(allowed, race ? [23, 25, 27] : [9, 11, 13]);
    const production = enqueue(lowLevel, race ? 25 : 11);
    const world = worldFixture(race);
    const lower = { ...world, entities: world.entities.map(entity => entity.rawSlot === 2 ? { ...entity, unitType: race ? 30 : 18 } : entity) };
    assert.equal(step({ production, world: lower }, 1).production.teams[0].queues[1].ready, 0);
    const busy = structuredClone(createCampaignProduction(setup));
    const writable = busy as unknown as { teams: { slots: { busy: number }[] }[] };
    writable.teams[0].slots[2].busy = 1;
    assert.throws(() => step({ production: busy, world }, 1), /producer unavailable/);
  });
}

test("adapted units: invalid opt-in, metadata, costs, dependencies and selectors fail closed", async () => {
  for (const completionVisits of [0, -1, 1.5, 65536, NaN]) {
    await assert.rejects(loadSourceProductionOptions({ ...input(), adaptedUnits: { runtimeProfile: "browser-adapted", completionVisits } }), /completionVisits/);
    const setup = options(0);
    assert.throws(() => createCampaignProduction({ ...setup,
      adaptedUnitProfiles: [{ ...setup.adaptedUnitProfiles[0], completionVisits }] }), /Invalid adapted/);
  }
  const setup = options(0), profile = setup.adaptedUnitProfiles[0];
  assert.throws(() => createCampaignProduction({ ...setup, adaptedUnitProfiles: [profile, profile] }), /unique/);
  assert.throws(() => createCampaignProduction({ ...setup, sourceProfiles: undefined }), /source infantry/);
  assert.throws(() => createCampaignProduction({ ...setup, adaptedUnitProfiles: [{ ...profile, unitType: 1 as 2 }] }), /Invalid adapted/);
  assert.throws(() => createCampaignProduction({ ...setup,
    adaptedUnitProfiles: [{ ...profile, runtimeProfile: "strict-native" as "browser-adapted" }] }), /Invalid adapted/);
  for (const replacement of [{ cost: 1 }, { dependencies: [1] }]) {
    assert.throws(() => createCampaignProduction({ ...setup, records: records.map(entry => entry.id === 11 ? { ...entry, ...replacement } : entry) }), /Invalid adapted/);
  }
  for (const replacement of [{ queue: 0 as const }, { exitSelector: 1 as const }, { exitOffset: { x: 0, y: 0 } }]) {
    assert.throws(() => createCampaignProduction({ ...setup,
      units: setup.units.map(unit => unit.unitType === 2 ? { ...unit, ...replacement } : unit) }), /Invalid adapted/);
  }
  const old = await loadSourceProductionOptions({ ...input(), adaptedCollectors: { runtimeProfile: "browser-adapted", completionVisits: 120 } });
  const both = await loadSourceProductionOptions({ ...input(), adaptedCollectors: { runtimeProfile: "browser-adapted", completionVisits: 120 },
    adaptedUnits: { runtimeProfile: "browser-adapted", completionVisits: 3 } });
  assert.equal(Object.hasOwn(old.state!, "adaptedUnitProfiles"), false);
  assert.deepEqual(both.production!.adaptedCollectorProfiles, old.production!.adaptedCollectorProfiles);
});
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCampaignProduction, productionChoices, productionSnapshot, reduceCampaignProduction,
  stepCampaignProductionProducer, synchronizeBrowserProductionColony,
  type CampaignProductionState, type ProductionAction } from "../../src/engine/campaign-production";
import { producerProfiles, sourceProductionVisits, sourceProductionUi } from "../../src/engine/source-production-options";
import type { CampaignWorld } from "../../src/engine/campaign-world";
import { initializeTransportHost, transportHostState, updateTransportHostUnit } from "../../src/engine/transport-host";
import { parseDependencies, parseUnitStats } from "../extractors/data/tables";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const records = parseDependencies(read("raw_cd/DC/GAMESTAT/DEPEND.TXT"));
const stats = parseUnitStats(read("raw_cd/DC/GAMESTAT/GAMESTAT.TXT"));

function initial(race: 0 | 1, credits = 3000, restrictions: number[] = [], adapted = true) {
  const offsets = [[[0, -3], [0, -3]], [[2, 3], [-5, -1]], [[-4, 0], [-5, -1]], [[-4, 3], [-4, 3]]];
  return createCampaignProduction({ sessionId: "collector-test", records,
    units: records.filter(entry => entry.rawFields[0] === 1).map(entry => {
      const unitType = entry.rawFields[1], raw = stats[unitType].rawTail;
      const queue = raw[10] as 0 | 1 | 2 | 3, exitSelector = raw[12] as 0 | 1;
      const [x, y] = offsets[queue][exitSelector];
      return { unitType, queue, exitSelector, exitOffset: { x, y } };
    }),
    sourceProfiles: producerProfiles(JSON.parse(read(`public/assets/generated/animations/${race ? "ALBU" : "HUBU"}.json`)), race),
    ...(adapted ? { adaptedCollectorProfiles: [{ runtimeProfile: "browser-adapted" as const,
      unitType: race ? 14 as const : 6 as const, completionVisits: 3 }] } : {}),
    teams: [{ team: 0, race, credits, costAccumulator: 0, base: { x: 20, y: 20 }, restrictions, upgrades: [],
      slots: [4800, 2400, 0, 0, 0].map(health => ({ health, level: 0, busy: 0 })) }] });
}

function act(state: CampaignProductionState, action: ProductionAction) {
  return reduceCampaignProduction(state, { id: `collector:${state.journal.length}`, team: 0, action });
}

function worldFixture(race: 0 | 1): CampaignWorld {
  const entityBytes = new Uint8Array(800 * 220), bytes = new DataView(entityBytes.buffer);
  const entities = [0, 1].map(slot => {
    const unitType = (race ? 28 : 16) + slot, health = slot ? 2400 : 4800;
    bytes.setUint16(slot * 220, (20 + slot) * 256, true);
    bytes.setUint16(slot * 220 + 4, 20 * 256, true);
    bytes.setUint32(slot * 220 + 12, health, true);
    entityBytes[slot * 220 + 6] = unitType;
    entityBytes[slot * 220 + 0x2c] = 1;
    return { key: `building:${slot}`, generation: 0, sourceRow: null, team: 0, unitType,
      tileX: 20 + slot, tileY: 20, rawTail: [], health, maxHealth: health, rawSlot: slot, simulationId: null };
  });
  const source: CampaignWorld = { sessionId: "collector-test", browserCasualtyPickup: { runtimeProfile: "browser-adapted" },
    source: { id: "test", teams: [{ index: 0, race }], placementRows: [] },
    placementState: { firstSlot: 152, nextSlot: 152, highWater: 152, renatSources: [], renatBytes: new Uint8Array(1000) },
    entities, buildingSlots: Object.fromEntries(Array.from({ length: 40 }, (_, index) =>
      [`${Math.floor(index / 5)},${index % 5}`, index === 0 ? 4800 : index === 1 ? 2400 : 0])),
    entityBytes, typeMovementClasses: null, commanderSlots: {}, messageTexts: {}, messages: [], exomoney: {}, statistics: {},
    clockMilliseconds: 0, transportState: null };
  const result = initializeTransportHost(source, { width: 32, height: 32, groundEligible: Array(1024).fill(true),
    definitions: [(race ? 28 : 16), (race ? 29 : 17), race ? 14 : 6, race * 8].map(unitType =>
      ({ unitType, health: stats[unitType].health, movementSpeed: 64, plane: "ground" as const })),
    highWater: 152, sides: Array(8).fill(race), directionBits: [], fixedStepMilliseconds: 16, orientationSteps: 1 });
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}

function step(production: CampaignProductionState, world: CampaignWorld, population = 0, populationLimit = 150) {
  return stepCampaignProductionProducer(production, world, { team: 0, queue: 2, population, populationLimit },
    `visit:${production.journal.length}`, "browser-adapted");
}

function destroyed(world: CampaignWorld, slot: number) {
  const result = updateTransportHostUnit(world, { type: "combat-death", slot, generation: 0 });
  assert.ok(result.ok, JSON.stringify(result));
  const entityBytes = new Uint8Array(result.value.entityBytes!);
  new DataView(entityBytes.buffer).setUint32(slot * 220 + 12, 0, true);
  return { ...result.value, entityBytes };
}

for (const race of [0, 1] as const) {
  const dependency = race ? 21 : 7;
  test(`adapted collector ${race}: paid queue admission preserves strict infantry-only support`, () => {
    assert.equal(productionChoices(initial(race, 3000, [], false), 0).find(entry => entry.dependency === dependency)!.supported, false);
    assert.throws(() => act(initial(race, 3000, [], false), { type: "reserve", dependency }), /profile/);
    let state = act(initial(race), { type: "reserve", dependency });
    assert.equal(state.teams[0].credits, 1500);
    assert.equal(state.teams[0].costAccumulator, 0);
    state = act(state, { type: "dispatch", dependency });
    assert.equal(state.teams[0].costAccumulator, 1500);
    assert.equal(state.teams[0].queues[2].items[0].unitType, race ? 14 : 6);
    assert.equal(state.teams[0].queues[0].items.length, 0);
  });
  test(`adapted collector ${race}: insufficient credits and dependency restrictions reject atomically`, () => {
    const poor = initial(race, 1499);
    assert.equal(productionChoices(poor, 0).find(entry => entry.dependency === dependency)!.maxAdditional, 0);
    assert.throws(() => act(poor, { type: "reserve", dependency }), /underflow/);
    assert.throws(() => act(initial(race, 3000, [dependency]), { type: "reserve", dependency }), /eligible/);
    assert.throws(() => act(initial(race), { type: "reserve", dependency: race ? 7 : 21 }), /eligible/);
    assert.equal(poor.teams[0].credits, 1499);
    assert.equal(poor.journal.length, 0);
  });
  test(`adapted collector ${race}: explicit clock survives exact JSON snapshot and journal replay`, () => {
    const start = initial(race);
    let state = act(act(start, { type: "reserve", dependency }), { type: "dispatch", dependency });
    const ticket = state.teams[0].queues[2].items[0].ticket;
    state = act(state, { type: "producer-started", queue: 2, ticket });
    assert.throws(() => act(state, { type: "producer-completed", queue: 2, ticket, animationMode: 2 }), /fabricated/);
    state = act(state, { type: "producer-advance", queue: 2, ticket });
    const saved = JSON.parse(JSON.stringify(state));
    const restored = productionSnapshot(saved);
    let replay = start;
    for (const event of saved.journal) replay = reduceCampaignProduction(replay, event);
    assert.deepEqual(replay, restored);
    const advance = (value: CampaignProductionState) => act(value, { type: "producer-advance", queue: 2, ticket });
    state = advance(state);
    assert.equal(state.teams[0].queues[2].allocation, null);
    state = advance(state);
    assert.deepEqual(advance(advance(restored)), state);
    assert.equal(state.teams[0].queues[2].animation, undefined);
    assert.deepEqual(state.teams[0].queues[2].allocation, {
      id: "collector:5", ticket, unitType: race ? 14 : 6, tileX: 16, tileY: 20,
    });
  });
  test(`adapted collector ${race}: queue-2 exit allocates the correct type, slot, registry and bytes once`, () => {
    const production = act(act(initial(race), { type: "reserve", dependency }), { type: "dispatch", dependency });
    const world = worldFixture(race);
    assert.deepEqual(sourceProductionVisits(world, production, 150).map(visit => visit.queue), [0, 2]);
    assert.equal(sourceProductionUi(production, 0).find(choice => choice.dependency === dependency)!.producerNativeSlot, 0);
    assert.throws(() => stepCampaignProductionProducer(production, world,
      { team: 0, queue: 2, population: 0, populationLimit: 150 }, "strict"), /strict-native/);
    assert.throws(() => step(production, { ...world, browserCasualtyPickup: undefined }), /browser-adapted/);
    let frame = step(production, world);
    assert.equal(transportHostState(frame.world).ground[20 * 32 + 16], 1022);
    const restored = { production: productionSnapshot(JSON.parse(JSON.stringify(frame.production))), world: structuredClone(frame.world) };
    let replay = restored;
    for (let count = 0; count < 3; count++) {
      frame = step(frame.production, frame.world);
      replay = step(replay.production, replay.world);
      assert.deepEqual(replay, frame);
      if (count < 2) assert.equal(frame.world.entities.length, 2);
    }
    const host = transportHostState(frame.world), actor = host.slots[152]!;
    assert.deepEqual([actor.unitType, actor.team, actor.generation, actor.position.x, actor.position.y],
      [race ? 14 : 6, 0, 0, 16 * 256 + 128, 20 * 256 + 128]);
    assert.equal(host.registry[152], actor.key);
    assert.equal(host.ground[20 * 32 + 16], 152);
    assert.deepEqual(host.productionExits, []);
    assert.equal(frame.world.entityBytes![152 * 220 + 6], race ? 14 : 6);
    assert.equal(new DataView(frame.world.entityBytes!.buffer).getUint32(152 * 220 + 12, true), stats[race ? 14 : 6].health);
    assert.equal(frame.production.teams[0].queues[2].items.length, 0);
    assert.equal(frame.production.teams[0].credits, 1500);
    assert.equal(frame.production.teams[0].costAccumulator, 1500);
    const idle = step(frame.production, frame.world);
    assert.equal(idle.world.entities.length, 3);
  });
  test(`adapted collector ${race}: pending release and population cap refund only the paid collector`, () => {
    const reserved = act(initial(race), { type: "reserve", dependency });
    assert.equal(act(reserved, { type: "release-pending", dependency }).teams[0].credits, 3000);
    const queued = act(reserved, { type: "dispatch", dependency });
    const frame = step(queued, worldFixture(race), 150, 150);
    assert.equal(frame.production.teams[0].credits, 3000);
    assert.equal(frame.production.teams[0].costAccumulator, 0);
    assert.equal(frame.production.teams[0].queues[2].items.length, 0);
    assert.equal(transportHostState(frame.world).ground[20 * 32 + 16], -1);
  });
  for (const phase of ["pending", "queued", "active", "spawned"] as const) {
    test(`adapted collector ${race}: destroyed central producer cancels ${phase} work and restores exactly`, () => {
      let production = act(initial(race), { type: "reserve", dependency });
      if (phase !== "pending") production = act(production, { type: "dispatch", dependency });
      let frame = { production, world: worldFixture(race) };
      if (phase === "active" || phase === "spawned") frame = step(frame.production, frame.world);
      if (phase === "spawned") for (let count = 0; count < 3; count++) frame = step(frame.production, frame.world);
      const saved = { production: productionSnapshot(JSON.parse(JSON.stringify(frame.production))), world: structuredClone(frame.world) };
      const cancel = (value: typeof frame) => synchronizeBrowserProductionColony(value.production, destroyed(value.world, 0), "browser-adapted");
      frame = cancel(frame);
      assert.deepEqual(cancel(saved), frame);
      assert.equal(frame.production.teams[0].credits, phase === "pending" ? 3000 : 1500);
      assert.equal(frame.production.teams[0].costAccumulator, phase === "pending" ? 0 : 1500);
      assert.equal(frame.production.teams[0].queues[2].items.length, 0);
      assert.equal(frame.production.teams[0].queues[2].adaptedElapsedVisits, undefined);
      assert.equal(transportHostState(frame.world).productionExits?.length ?? 0, 0);
      assert.equal(transportHostState(frame.world).ground[20 * 32 + 16], phase === "spawned" ? 152 : -1);
      assert.equal(productionChoices(frame.production, 0).find(choice => choice.dependency === dependency)!.maxAdditional, 0);
      assert.deepEqual(sourceProductionVisits(frame.world, frame.production, 150).map(visit => visit.queue), [0]);
      assert.throws(() => act(frame.production, { type: "reserve", dependency }), /eligible/);
      assert.deepEqual(step(frame.production, frame.world), frame);
    });
  }
  test(`adapted collector ${race}: loss of infantry factory does not cancel central production`, () => {
    const queued = act(act(initial(race), { type: "reserve", dependency }), { type: "dispatch", dependency });
    let frame = step(queued, worldFixture(race));
    frame = synchronizeBrowserProductionColony(frame.production, destroyed(frame.world, 1), "browser-adapted");
    assert.equal(frame.production.teams[0].queues[2].items.length, 1);
    assert.deepEqual(sourceProductionVisits(frame.world, frame.production, 150).map(visit => visit.queue), [2]);
    for (let count = 0; count < 3; count++) frame = step(frame.production, frame.world);
    assert.equal(transportHostState(frame.world).slots[152]!.unitType, race ? 14 : 6);
  });
}
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ADAPTED_UNIT_PRODUCTION_SOURCES, createCampaignProduction, reduceCampaignProduction,
  stepCampaignProductionProducer, synchronizeBrowserProductionColony,
  type CampaignProductionState, type ProductionUnitSource } from "../../src/engine/campaign-production";
import { producerProfiles, sourceProductionTeamSeeds } from "../../src/engine/source-production-options";
import { CampaignSession, type CampaignSessionInput } from "../../src/engine/campaign-session";
import { createBrowserAiSelectorConfiguration } from "../../src/engine/browser-campaign-runtime";
import type { CampaignWorld } from "../../src/engine/campaign-world";
import { allocateTransportProductionExit, initializeTransportHost, transportHostState,
  updateTransportHostUnit, type ProductionExitReservation } from "../../src/engine/transport-host";
import { parseDependencies, parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { parseScenario } from "../extractors/data/scenario";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const units = parseUnitStats(read("raw_cd/DC/GAMESTAT/GAMESTAT.TXT"));
const records = parseDependencies(read("raw_cd/DC/GAMESTAT/DEPEND.TXT"));
type Frame = { production: CampaignProductionState; world: CampaignWorld };

function fixture(race: 0 | 1): Frame {
  const offsets = [[[0, -3], [0, -3]], [[2, 3], [-5, -1]], [[-4, 0], [-5, -1]], [[-4, 3], [-4, 3]]];
  const production = createCampaignProduction({ sessionId: "exit-collision", records,
    units: records.filter(entry => entry.rawFields[0] === 1).map(entry => {
      const unitType = entry.rawFields[1], raw = units[unitType].rawTail;
      const queue = raw[10] as ProductionUnitSource["queue"], exitSelector = raw[12] as 0 | 1;
      const [offsetX, offsetY] = offsets[queue][exitSelector];
      return { unitType, queue, exitSelector, exitOffset: { x: offsetX, y: offsetY } };
    }),
    sourceProfiles: producerProfiles(JSON.parse(read(`public/assets/generated/animations/${race ? "ALBU" : "HUBU"}.json`)), race),
    adaptedCollectorProfiles: [{ runtimeProfile: "browser-adapted", unitType: race ? 14 : 6, completionVisits: 3 }],
    adaptedUnitProfiles: ADAPTED_UNIT_PRODUCTION_SOURCES.filter(source => source.race === race)
      .map(source => ({ runtimeProfile: "browser-adapted", unitType: source.unitType, completionVisits: 3 })),
    teams: [{ team: 0, race, credits: 20000, costAccumulator: 0, base: { x: 20, y: 20 }, restrictions: [], upgrades: [],
      slots: [4800, 2400, 2400, 2400, 2400].map((health, slot) => ({ health, level: slot === 2 || slot === 3 ? 1 : 0, busy: 0 })) }] });
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
  const world: CampaignWorld = { sessionId: "exit-collision", browserCasualtyPickup: { runtimeProfile: "browser-adapted" },
    source: { id: "controlled-exit-collision", teams: [{ index: 0, race }], placementRows: [] },
    placementState: { firstSlot: 152, nextSlot: 152, highWater: 152, renatSources: [], renatBytes: new Uint8Array(1000) },
    entities, buildingSlots: Object.fromEntries(Array.from({ length: 40 }, (_, index) =>
      [`${Math.floor(index / 5)},${index % 5}`, index < 5 ? entities[index].health : 0])),
    entityBytes, typeMovementClasses: null, commanderSlots: {}, messageTexts: {}, messages: [], exomoney: {}, statistics: {},
    clockMilliseconds: 0, transportState: null };
  const types = [...entities.map(entity => entity.unitType), race * 8, race ? 14 : 6,
    ...ADAPTED_UNIT_PRODUCTION_SOURCES.filter(source => source.race === race).map(source => source.unitType)];
  const result = initializeTransportHost(world, { width: 32, height: 32, groundEligible: Array(1024).fill(true),
    definitions: types.map(unitType => ({ unitType, health: units[unitType].health, movementSpeed: units[unitType].movementSpeed,
      plane: units[unitType].rawTail[2] === 0 ? "ground" : "flying" })),
    highWater: 152, sides: Array(8).fill(race), directionBits: [], fixedStepMilliseconds: 50, orientationSteps: 1 });
  assert.ok(result.ok, JSON.stringify(result));
  return { production, world: result.value };
}

function enqueue(frame: Frame, unitType: number): Frame {
  const dependency = records.find(record => record.rawFields[0] === 1 && record.rawFields[1] === unitType)!.id;
  let production = frame.production;
  for (const type of ["reserve", "dispatch"] as const) production = reduceCampaignProduction(production,
    { id: `purchase:${production.journal.length}`, team: 0, action: { type, dependency } });
  return { ...frame, production };
}

function step(frame: Frame, queue: ProductionUnitSource["queue"], population = 0): Frame {
  return stepCampaignProductionProducer(frame.production, frame.world, { team: 0, queue, population, populationLimit: 150 },
    `visit:${frame.production.journal.length}`, "browser-adapted");
}

function move(frame: Frame, tile: { x: number; y: number }): Frame {
  const result = updateTransportHostUnit(frame.world, { type: "position", slot: 152, generation: 0,
    position: { x: tile.x * 256 + 128, y: tile.y * 256 + 128 } });
  assert.ok(result.ok, JSON.stringify(result));
  return { ...frame, world: result.value };
}

function roundTrip(frame: Frame): Frame {
  return JSON.parse(JSON.stringify(frame, (_key, value) => value instanceof Uint8Array
    ? { byteArray: [...value] } : value), (_key, value) => value?.byteArray ? new Uint8Array(value.byteArray) : value);
}

for (const race of [0, 1] as const) {
  const infantry = race * 8, collector = race ? 14 : 6;
  const air = ADAPTED_UNIT_PRODUCTION_SOURCES.find(source => source.race === race && source.plane === "flying")!.unitType;
  for (const [produced, blocker] of [[infantry, infantry], [infantry, collector], [collector, infantry],
    [air, air], [air, collector], [collector, air]]) {
    test(`production exit ${race}/${produced}/${blocker}: occupied completion, plane isolation, single charge and JSON continuation`, () => {
      let frame = fixture(race);
      const source = frame.production.units.find(source => source.unitType === produced)!;
      const tile = { x: 20 + source.exitOffset.x, y: 20 + source.exitOffset.y };
      const outside = { x: tile.x + 1, y: tile.y };
      const request: ProductionExitReservation = { key: JSON.stringify([frame.world.sessionId, 0, 0, "fixture-incumbent"]),
        team: 0, queue: 0, ticket: "fixture-incumbent", unitType: blocker, tile: outside };
      const created = allocateTransportProductionExit(frame.world, request);
      assert.ok(created.ok, JSON.stringify(created));
      frame = step(enqueue({ ...frame, world: created.value }, produced), source.queue);
      const reservation = transportHostState(frame.world).productionExits![0];
      const plane = units[produced].rawTail[2] === 0 ? "ground" : "flying";
      const blockerPlane = units[blocker].rawTail[2] === 0 ? "ground" : "flying";
      const index = tile.y * 32 + tile.x;
      const paid = frame.production.teams[0];
      const strict = updateTransportHostUnit({ ...frame.world, browserCasualtyPickup: undefined },
        { type: "position", slot: 152, generation: 0, position: { x: tile.x * 256 + 128, y: tile.y * 256 + 128 } });
      if (plane === blockerPlane) assert.equal(strict.ok, false, "strict reservation cannot be traversed");
      frame = move(frame, tile);
      assert.equal(transportHostState(frame.world)[blockerPlane][index], 152);
      let mirror = roundTrip(frame);
      assert.deepEqual(mirror, frame);
      for (let visit = 0; visit < 100; visit++) {
        frame = step(frame, source.queue, 150);
        mirror = step(mirror, source.queue, 150);
      }
      assert.deepEqual(mirror, frame);
      assert.equal(frame.production.teams[0].credits, paid.credits, "no cap refund or repeated charge after start");
      assert.equal(frame.production.teams[0].costAccumulator, paid.costAccumulator);
      const completed = frame.production.teams[0].queues[source.queue];
      if (plane === blockerPlane) {
        assert.ok(completed.allocation, "completed ticket waits while incumbent owns exit");
        assert.deepEqual(transportHostState(frame.world).productionExits, [reservation]);
        assert.equal(transportHostState(frame.world).highWater, 153);
        const refused = allocateTransportProductionExit(frame.world, reservation);
        assert.equal(refused.ok, false, "direct allocator must not clear the incumbent");
        assert.equal(transportHostState(frame.world)[plane][index], 152);
        assert.equal(frame.production.requests.filter(request => request.type === "allocate-unit").length, 1);
        assert.equal(frame.production.requests.filter(request => request.type === "unit-allocated").length, 0);
        const producerSlot = [1, 2, 0, 4][source.queue];
        const death = updateTransportHostUnit(frame.world, { type: "combat-death", slot: producerSlot, generation: 0 });
        assert.ok(death.ok);
        const entityBytes = new Uint8Array(death.value.entityBytes!);
        new DataView(entityBytes.buffer).setUint32(producerSlot * 220 + 12, 0, true);
        const cancelled = synchronizeBrowserProductionColony(frame.production, { ...death.value, entityBytes }, "browser-adapted");
        assert.equal(transportHostState(cancelled.world)[plane][index], 152, "cancellation must retain incumbent");
        assert.deepEqual(transportHostState(cancelled.world).productionExits, []);
        assert.equal(cancelled.production.teams[0].credits, paid.credits);
        const edge = updateTransportHostUnit(frame.world, { type: "position", slot: 152, generation: 0,
          position: { x: outside.x * 256 + 28, y: outside.y * 256 + 128 } });
        assert.ok(edge.ok);
        frame = { ...frame, world: edge.value };
        assert.equal(transportHostState(frame.world)[plane][index], 1022, "containing tile has left the exit");
        frame = step(frame, source.queue);
        assert.ok(frame.production.teams[0].queues[source.queue].allocation, "interpolated footprint still overlaps exit");
        assert.equal(transportHostState(frame.world).highWater, 153);
        mirror = roundTrip(frame);
        frame = step(move(frame, outside), source.queue);
        mirror = step(move(mirror, outside), source.queue);
        assert.deepEqual(mirror, frame);
      }
      assert.equal(frame.production.teams[0].queues[source.queue].items.length, 0);
      assert.equal(transportHostState(frame.world).highWater, 154);
      assert.equal(transportHostState(frame.world)[plane][index], 153);
      assert.deepEqual(transportHostState(frame.world).productionExits, []);
      for (let visit = 0; visit < 5; visit++) frame = step(frame, source.queue);
      assert.equal(transportHostState(frame.world).highWater, 154);
      assert.equal(frame.production.requests.filter(request => request.type === "allocate-unit").length, 1);
      assert.equal(frame.production.requests.filter(request => request.type === "unit-allocated").length, 1);
    });
  }
}

for (const race of [0, 1] as const) test(`production exit session ${race}: completed blocked ticket restores and allocates once`, () => {
  const original = parseScenario(read("raw_cd/DC/SCENARIO/HUMAN/HUMAN02.SCN"));
  const source = { ...original, placementRows: [[18, 17, race * 8, 0, -1]], teams: original.teams.map(team => ({ ...team,
    race, money: 4000, dependencies: [], coordinateRows: [[0, 0], team.index === 0 ? [20, 20] : [0, 0]] as const,
    cityRows: [[1, -1, 1, -1, 1, -1, 1, -1, 1, -1], ...team.cityRows.slice(1)] })) };
  const profiles = fixture(race).production;
  const session = new CampaignSession({ sessionId: `exit-session:${race}`, source, units,
    weapons: parseWeaponStats(read("raw_cd/DC/GAMESTAT/WEAPSTAT.TXT")), triggers: [], messages: [],
    runtimeProfile: "browser-adapted", browserAi: createBrowserAiSelectorConfiguration(source),
    map: { width: 32, height: 32 }, pathGrid: new Uint8Array(1024).fill(1), tags: new Uint8Array(1024),
    commanders: [{ team: 0, unitType: race ? 73 : 69, sprite: race ? "GRAY" : "TRSC" }],
    directionBits: [[0, 0]], fixedStepMilliseconds: 50, orientationSteps: 1,
    production: { records, units: profiles.units, sourceProfiles: profiles.sourceProfiles!,
      teams: [sourceProductionTeamSeeds(source, units)[0]] } });
  const advance = (target: CampaignSession, extra: Partial<CampaignSessionInput> = {}) => {
    const result = target.step({ clockMilliseconds: target.snapshot.world.clockMilliseconds + 50,
      productionVisits: [{ team: 0, queue: 0, population: 0, populationLimit: 150 }], ...extra });
    assert.ok(result.ok, JSON.stringify(result));
    return result.value;
  };
  const dependency = records.find(record => record.rawFields[0] === 1 && record.rawFields[1] === race * 8)!.id;
  advance(session, { productionCommands: ["reserve", "dispatch"].map(type => ({ id: type, team: 0,
    action: { type: type as "reserve" | "dispatch", dependency } })) });
  advance(session, { updates: [{ type: "position", slot: 152, generation: 0, position: { x: 20 * 256 + 128, y: 17 * 256 + 128 } }] });
  for (let visit = 0; visit < 100 && !session.snapshot.production!.teams[0].queues[0].allocation; visit++) advance(session);
  const saved = JSON.parse(JSON.stringify(session.checkpoint()));
  assert.ok(session.snapshot.production!.teams[0].queues[0].allocation);
  const mirror = CampaignSession.restore(saved);
  assert.deepEqual(mirror.checkpoint(), saved);
  for (let visit = 0; visit < 5; visit++) assert.deepEqual(advance(mirror), advance(session));
  assert.deepEqual(mirror.checkpoint(), session.checkpoint());
  assert.equal(session.snapshot.production!.teams[0].credits, 3650);
  assert.equal(session.snapshot.production!.teams[0].costAccumulator, 350);
  const extra = { updates: [{ type: "position" as const, slot: 152, generation: 0,
    position: { x: 18 * 256 + 128, y: 17 * 256 + 128 } }] };
  assert.deepEqual(advance(mirror, extra), advance(session, extra));
  const host = transportHostState(session.snapshot.world);
  assert.equal(host.highWater, 154);
  assert.equal(host.ground[17 * 32 + 20], 153);
  assert.equal(host.slots[153]!.generation, 0);
  assert.deepEqual(host.productionExits, []);
  const after = JSON.parse(JSON.stringify(session.checkpoint()));
  assert.deepEqual(CampaignSession.restore(after).checkpoint(), after);
  assert.deepEqual(advance(mirror), advance(session));
  assert.equal(transportHostState(session.snapshot.world).highWater, 154);
});
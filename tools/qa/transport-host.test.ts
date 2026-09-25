import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseUnitStats } from "../extractors/data/tables";
import { legacyStaticOccupancyFieldsFromSource, projectLegacyStaticOccupancy } from "../../src/engine/legacy-static-occupancy";
import { createCampaignWorldAdapter, type CampaignWorld } from "../../src/engine/campaign-world";
import type { PlannedMissionCommand } from "../../src/engine/mission-controller";
import type { TriggerResult } from "../../src/engine/trigger-runtime";
import {
  advanceTransportHost, consumeTransportFifo, createTransportHostAdapter, findTransportPosition,
  initializeTransportHost, stepTransportHost, transportHostCensus, transportHostDefinition, transportHostState, updateTransportHostUnit,
  type TransportHostOptions,
} from "../../src/engine/transport-host";

function value<Value>(result: TriggerResult<Value>): Value {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("Expected success");
  return result.value;
}

function fixture(overrides: Partial<TransportHostOptions> = {}): CampaignWorld {
  const world: CampaignWorld = { sessionId: "host-test", source: { id: "test", teams: [{ index: 0 }], placementRows: [] },
    placementState: { firstSlot: 152, nextSlot: 152, highWater: 152, renatSources: [], renatBytes: new Uint8Array(25 * 40) },
    entities: [], buildingSlots: {}, entityBytes: new Uint8Array(800 * 220), typeMovementClasses: null,
    commanderSlots: {}, messageTexts: {}, messages: [], exomoney: {}, statistics: {}, clockMilliseconds: 0, transportState: null };
  return value(initializeTransportHost(world, { width: 7, height: 7, groundEligible: Array(49).fill(true),
    definitions: [0, 8, 69, 92, 93].map((unitType) => ({ unitType, health: 100, movementSpeed: 64, plane: "ground" })),
    highWater: 152, sides: [0, 1, 0, 0, 0, 0, 0, 0], directionBits: Array.from({ length: 20 }, () => [0, 1] as const),
    fixedStepMilliseconds: 20, orientationSteps: 2, ...overrides }));
}

function command(kind: "reinforce" | "reinforce2" = "reinforce", id = "request:1"): PlannedMissionCommand {
  return { id, triggerId: 1, actionIndex: 0, action: { name: kind, arguments: [] },
    command: { kind, team: 0, tileX: 3, tileY: 3, groups: [{ unitType: 0, count: 2 }, { unitType: 69, count: 1 }] } };
}

function ticks(world: CampaignWorld, count: number): CampaignWorld {
  for (let index = 0; index < count; index += 1) world = value(stepTransportHost(world));
  return world;
}

test("scheduled means a real reserved carrier; source-speed approach gates ordered payload creation", () => {
  const initial = fixture();
  const before = structuredClone(initial);
  const prepared = value(createTransportHostAdapter().prepare(initial, command()));
  assert.equal(prepared.disposition, "scheduled");
  assert.deepEqual(initial, before);
  let world = prepared.world;
  assert.equal(world.entities.length, 0);
  assert.equal(transportHostState(world).slots[7]?.team, 8);
  world = ticks(world, 51);
  assert.equal(transportHostState(world).reducer.carriers[0].phase, "orientation");
  assert.equal(world.entities.length, 0);
  world = ticks(world, 2);
  assert.equal(transportHostState(world).reducer.carriers[0].phase, "approach");
  assert.equal(world.entities.length, 0);
  world = ticks(world, 5);
  assert.deepEqual(world.entities.map((entity) => entity.unitType), [0]);
  world = ticks(world, 100);
  assert.deepEqual(world.entities.map((entity) => entity.unitType), [0, 0, 69]);
  assert.equal(transportHostState(world).reducer.carriers[0].phase, "released");
});

function prepare(world: CampaignWorld, planned = command()): CampaignWorld {
  return value(createTransportHostAdapter().prepare(world, planned)).world;
}

function single(kind: "reinforce" | "reinforce2", id: string, unitType = 0): PlannedMissionCommand {
  const planned = command(kind, id);
  return { ...planned, command: { kind, team: 0, tileX: 3, tileY: 3, groups: [{ unitType, count: 1 }] } };
}

test("blocked delivery uses source whole-square X-outer/Y-inner order and retains cargo while moving", () => {
  let world = prepare(fixture(), single("reinforce2", "block"));
  world = prepare(world, single("reinforce", "flight"));
  world = ticks(world, 58);
  const state = transportHostState(world);
  assert.equal(state.reducer.carriers[0].groups[0].count, 1);
  assert.equal(state.reducer.carriers[0].phase, "orientation");
  assert.deepEqual(state.reducer.carriers[0].destination, { x: 640, y: 640 });
  assert.equal(world.entities.length, 1);
  world = ticks(world, 8);
  assert.deepEqual(world.entities.map((entity) => [entity.tileX, entity.tileY]), [[3, 3], [2, 2]]);
  const search = transportHostState(world);
  search.ground.fill(-1);
  search.ground[3 * 7 + 3] = 152;
  search.ground[2 * 7 + 2] = 153;
  assert.deepEqual(findTransportPosition(search, { x: 3, y: 3 }, "ground"), { x: 640, y: 896 });
  search.groundEligible.fill(false);
  search.groundEligible[6 * 7 + 0] = true;
  assert.deepEqual(findTransportPosition(search, { x: 3, y: 3 }, "ground"), { x: 128, y: 1664 });
  assert.deepEqual(findTransportPosition(search, { x: 0, y: 0 }, "flying"), { x: 128, y: 128 });
});

test("reinforce2 creates synchronously in source order or appends teamless FIFO entries", () => {
  const direct = value(createTransportHostAdapter().prepare(fixture(), command("reinforce2")));
  assert.equal(direct.disposition, "applied");
  assert.deepEqual(direct.world.entities.map((entity) => entity.unitType), [0, 0, 69]);
  assert.deepEqual(direct.world.entities.map((entity) => entity.rawSlot), [152, 153, 154]);
  assert.deepEqual(direct.world.entities.map((entity) => [entity.tileX, entity.tileY]), [[3, 3], [2, 2], [2, 3]]);
  assert.equal(transportHostState(direct.world).tick, 0);
  assert.equal(transportHostState(direct.world).reducer.carriers.length, 0);
  let queued = prepare(fixture({ fifos: [{ tile: { x: 3, y: 3 }, types: [] }] }), command("reinforce2"));
  assert.equal(queued.entities.length, 0);
  assert.deepEqual(transportHostState(queued).fifos[0].types, [0, 0, 69]);
  queued = value(consumeTransportFifo(queued, 0, 1));
  assert.equal(queued.entities[0].team, 1);
  assert.deepEqual(transportHostState(queued).fifos[0].types, [0, 69]);
  const full = fixture({ fifos: [{ tile: { x: 3, y: 3 }, types: Array(9).fill(8) }] });
  const before = structuredClone(full);
  assert.equal(createTransportHostAdapter().prepare(full, command("reinforce2")).ok, false);
  assert.deepEqual(full, before);
});

test("reinforcement past the map edge (HUMAN10 block 14) lands on the nearest edge cell", () => {
  const planned = single("reinforce2", "edge");
  const world = prepare(fixture(), { ...planned, command: { ...planned.command, tileX: 12, tileY: 3 } as typeof planned.command });
  assert.deepEqual(world.entities.map((entity) => [entity.tileX, entity.tileY]), [[6, 3]]);
});

function abduct(world: CampaignWorld): CampaignWorld {
  const planned: PlannedMissionCommand = { id: "pickup", triggerId: 2, actionIndex: 0,
    action: { name: "abduct", arguments: [0, 1] }, command: { kind: "abduct", selectedSide: 0, carrierSide: 1 } };
  return prepare({ ...world, commanderSlots: { 0: world.entities[0].rawSlot! } }, planned);
}

test("pickup is delayed, chases current full-width slot, clears collision but preserves HP and registry", () => {
  let world = prepare(fixture({ highWater: 300 }), single("reinforce2", "commander", 69));
  const target = world.entities[0];
  assert.equal(target.rawSlot, 299);
  world = abduct(world);
  assert.equal(transportHostState(world).slots[299]?.status, 1);
  assert.equal(transportHostState(world).reducer.carriers[0].type, 93);
  world = ticks(world, 51);
  world = value(updateTransportHostUnit(world, { type: "position", slot: 299, generation: target.generation, position: { x: 1664, y: 1664 } }));
  world = ticks(world, 7);
  assert.equal(transportHostState(world).slots[299]?.status, 1);
  assert.deepEqual(transportHostState(world).reducer.carriers[0].destination, { x: 1664, y: 1664 });
  for (let step = 0; step < 40 && transportHostState(world).slots[299]?.status === 1; step += 1) world = ticks(world, 1);
  const state = transportHostState(world);
  assert.equal(state.slots[299]?.status, 10);
  assert.equal(state.slots[299]?.health, 100);
  assert.equal(state.registry[299], target.key);
  assert.deepEqual(transportHostCensus(world), { "0,69": 1 });
  assert.ok(!state.ground.includes(299));
  assert.deepEqual(state.requests.slice(-2).map((entry) => entry.type), ["remove-noncombat", "clear-collision"]);
  assert.ok(!state.requests.some((entry) => entry.type === "combat-death"));
  const bytes = world.entityBytes!;
  assert.equal(bytes[299 * 220 + 0x39], 10);
  assert.equal(bytes[299 * 220 + 0x3c], 2);
  assert.equal(new DataView(bytes.buffer).getUint16(299 * 220 + 0x46, true), 1);
  world = ticks(world, 200);
  assert.equal(transportHostState(world).registry[299], target.key, "No invented unconditional cleanup timer");
  world = value(updateTransportHostUnit(world, { type: "complete-removal", slot: 299, generation: target.generation }));
  assert.equal(transportHostState(world).registry[299], null);
  assert.equal(world.entityBytes![299 * 220 + 0x2c], 0);
  assert.equal(world.entities.length, 0);
  assert.deepEqual(transportHostCensus(world), {});
});

test("combat death produces a victim loss, inactive pickup skips removal, last inactive dynamic slot is reused", () => {
  let world = prepare(fixture(), command("reinforce2"));
  const first = world.entities[0];
  const second = world.entities[1];
  world = abduct(world);
  for (const entity of [first, second]) {
    world = value(updateTransportHostUnit(world, { type: "combat-death", slot: entity.rawSlot!, generation: entity.generation }));
  }
  const loss = transportHostState(world).requests.find((entry) => entry.type === "combat-death");
  assert.equal(loss?.type === "combat-death" && loss.loss.victimType, 0);
  assert.equal(world.entities[0].health, 0);
  world = ticks(world, 58);
  assert.equal(transportHostState(world).reducer.carriers[0].phase, "departure");
  assert.ok(!transportHostState(world).requests.some((entry) => entry.type === "remove-noncombat"));
  for (const entity of [first, second]) world = value(updateTransportHostUnit(world, {
    type: "complete-removal", slot: entity.rawSlot!, generation: entity.generation,
  }));
  world.entityBytes![153 * 220 + 0x80] = 123;
  world = prepare(world, single("reinforce2", "reuse"));
  const replacement = world.entities.at(-1)!;
  assert.equal(replacement.rawSlot, 153);
  assert.equal(replacement.generation, second.generation + 1);
  assert.equal(world.entityBytes![153 * 220 + 0x80], 0);
  assert.equal(updateTransportHostUnit(world, { type: "combat-death", slot: 153, generation: second.generation }).ok, false);
  assert.equal(transportHostState(world).slots.length, 800);
  assert.equal(transportHostState(world).registry.length, 800);
});

test("pool exhaustion is atomic; release and reuse reset the same fixed slot with a fresh request ID", () => {
  let world = fixture();
  for (let index = 0; index < 8; index += 1) world = prepare(world, single("reinforce", `pool:${index}`));
  assert.deepEqual(transportHostState(world).reducer.carriers.map((entry) => entry.slot), [7, 8, 9, 10, 11, 12, 13, 14]);
  const before = structuredClone(world);
  assert.equal(createTransportHostAdapter().prepare(world, single("reinforce", "overflow")).ok, false);
  assert.deepEqual(world, before);
  world = ticks(world, 200);
  assert.ok(transportHostState(world).reducer.carriers.every((entry) => entry.phase === "released"));
  const generation = transportHostState(world).slots[7]!.generation;
  world = prepare(world, single("reinforce", "reuse-carrier"));
  const state = transportHostState(world);
  assert.equal(state.slots[7]?.generation, generation + 1);
  assert.equal(state.slots[7]?.task, "transport");
  assert.deepEqual(state.slots[7]?.taskWords, []);
  assert.equal(state.reducer.carriers.at(-1)?.id, 9);
  assert.equal(state.reducer.carriers.at(-1)?.slot, 7);
});

test("full map and invalid source definitions fail transactionally without consuming cargo or IDs", () => {
  const initial = fixture({ groundEligible: Array(49).fill(false) });
  assert.equal(createTransportHostAdapter().prepare(initial, command("reinforce2")).ok, false);
  let world = prepare(initial, single("reinforce", "blocked"));
  world = ticks(world, 57);
  const before = structuredClone(world);
  assert.equal(stepTransportHost(world).ok, false);
  assert.deepEqual(world, before);
  assert.equal(transportHostState(world).reducer.carriers[0].groups[0].count, 1);
  assert.equal(createTransportHostAdapter().prepare(fixture({ directionBits: [] }), command()).ok, false);
  assert.equal(createTransportHostAdapter().prepare(fixture(), single("reinforce", "unknown", 109)).ok, false);
  assert.equal(createTransportHostAdapter().prepare(fixture({ highWater: 799 }), command("reinforce2")).ok, true,
    "Existing inactive slots can be reused even at the high-water limit");
});

test("campaign batch receipts are transactional and duplicate preparation does not duplicate tasks", () => {
  const initial = fixture();
  const adapter = createCampaignWorldAdapter(createTransportHostAdapter());
  const planned = single("reinforce", "one");
  const prepared = value(adapter.prepare(initial, [planned]));
  assert.deepEqual(prepared.receipts, [{ commandId: "one", disposition: "scheduled" }]);
  const repeated = value(adapter.prepare(prepared.world, [planned]));
  assert.deepEqual(repeated.world, prepared.world);
  assert.equal(adapter.prepare(initial, [planned, single("reinforce2", "bad", 109)]).ok, false);
  assert.equal(transportHostState(initial).reducer.carriers.length, 0);
});

test("fixed-step accumulation and JSON host snapshots replay identically without wall-clock changes", () => {
  const initial = prepare(fixture(), command());
  const before = structuredClone(initial);
  const one = value(advanceTransportHost(initial, 1190));
  let partitioned = initial;
  for (let index = 0; index < 119; index += 1) partitioned = value(advanceTransportHost(partitioned, 10));
  assert.deepEqual(partitioned, one);
  assert.deepEqual(initial, before);
  assert.equal(transportHostState(one).tick, 59);
  assert.equal(transportHostState(one).remainderMilliseconds, 10);
  assert.equal(one.clockMilliseconds, initial.clockMilliseconds);
  const restored = { ...one, transportState: JSON.parse(JSON.stringify(one.transportState)) };
  assert.deepEqual(ticks(restored, 100), ticks(one, 100));
  const exported = transportHostState(one);
  exported.registry.fill(null);
  assert.notDeepEqual(exported.registry, transportHostState(one).registry);
});

test("source definition speed controls browser movement, vertical pop defers and release is a separate step", () => {
  const stat = transportHostDefinition({ index: 92, sprite: "carrier", faction: 0, movementSpeed: 1,
    observationDay: 1, observationNight: 1, weapons: [-1, -1, -1], health: 100 }, "flying");
  const definitions = transportHostState(fixture()).definitions.map((entry) => entry.unitType === 92 ? stat : entry);
  let slow = prepare(fixture({ definitions }), single("reinforce", "slow"));
  slow = ticks(slow, 58);
  assert.equal(slow.entities.length, 0);
  assert.equal(transportHostState(slow).motions[0].progress, 6);
  let world = prepare(fixture(), single("reinforce", "fast"));
  world = ticks(world, 50);
  assert.equal(transportHostState(world).slots[7]?.height, 603);
  world = ticks(world, 1);
  assert.equal(transportHostState(world).motions[0].progress, 0);
  world = ticks(world, 7);
  assert.equal(transportHostState(world).reducer.carriers[0].phase, "departure");
  assert.equal(transportHostState(world).reducer.carriers[0].step, 0);
  world = ticks(world, 50);
  assert.equal(transportHostState(world).reducer.carriers[0].phase, "pool-release");
  assert.equal(transportHostState(world).slots[7]?.height, 7803);
  assert.equal(transportHostState(world).slots[7]?.task, "transport");
  world = ticks(world, 1);
  assert.equal(transportHostState(world).reducer.carriers[0].phase, "released");
  assert.deepEqual(transportHostState(world).slots[7]?.taskWords, [60]);
});

test("unit creation uses its movement plane while carriers use ground fallback search", () => {
  const definitions = transportHostState(fixture()).definitions.map((entry) => entry.unitType === 8 ? { ...entry, plane: "flying" as const } : entry);
  let world = prepare(fixture({ definitions }), single("reinforce2", "ground"));
  world = prepare(world, single("reinforce2", "air", 8));
  assert.deepEqual(world.entities.map((entity) => [entity.tileX, entity.tileY]), [[3, 3], [3, 3]]);
  assert.equal(transportHostState(world).ground[24], 152);
  assert.equal(transportHostState(world).flying[24], 153);
  world = prepare(world, single("reinforce", "air-flight", 8));
  world = ticks(world, 58);
  assert.deepEqual(transportHostState(world).reducer.carriers[0].destination, { x: 640, y: 640 });
});

test("initialization imports exact registered slots, not a guessed formation, and rejects unbound active bytes", () => {
  const source = prepare(fixture(), single("reinforce2", "source"));
  const state = transportHostState(source);
  const options: TransportHostOptions = { ...state, highWater: state.highWater, resourceLifecycle: undefined };
  const imported = value(initializeTransportHost({ ...source, transportState: null }, options));
  assert.equal(transportHostState(imported).slots[152]?.key, source.entities[0].key);
  assert.equal(transportHostState(imported).ground[24], 152);
  const unbound = { ...source, transportState: null, entities: [] };
  assert.equal(initializeTransportHost(unbound, options).ok, false);
  const unknownSlot = { ...source, transportState: null, entities: source.entities.map((entry) => ({ ...entry, rawSlot: null })) };
  assert.equal(initializeTransportHost(unknownSlot, options).ok, false);
});

const sourceUnits = parseUnitStats(readFileSync(new URL("../../raw_cd/DC/GAMESTAT/GAMESTAT.TXT", import.meta.url), "utf8"));

function staticFixture(unitType: number, team = 0, adapted = true): CampaignWorld {
  const stat = sourceUnits.find(unit => unit.index === unitType)!;
  const world = fixture();
  const host = transportHostState(world);
  host.definitions.push(transportHostDefinition(stat, stat.rawTail[2] === 0 ? "ground" : "flying"));
  host.highWater = 161;
  host.slots[160] = { slot: 160, generation: 0, key: "placement:8", team, unitType, status: 1,
    health: stat.health, position: { x: 896, y: 896 }, height: 0, task: "unit", taskWords: [] };
  host.registry[160] = "placement:8";
  host.generations[160] = 0;
  return { ...world, transportState: host,
    ...(adapted ? { browserCasualtyPickup: { runtimeProfile: "browser-adapted" as const } } : {}) };
}

test("adapted delivery: all original static definitions match native ground classification, mines and owner8 excluded", () => {
  for (const stat of sourceUnits.filter(unit => unit.movementSpeed === 0)) {
    for (const team of [0, 8]) {
      const world = staticFixture(stat.index, team);
      const expected = projectLegacyStaticOccupancy({ slot: 160, owner: team, tileX: 3, tileY: 3,
        width: 7, height: 7, ...legacyStaticOccupancyFieldsFromSource(stat) });
      const result = prepare(world, single("reinforce2", `static:${stat.index}:${team}`));
      const actor = result.entities.at(-1)!;
      assert.deepEqual([actor.tileX, actor.tileY], expected?.plane === "ground" ? [2, 2] : [3, 3],
        `${stat.index}/${stat.sprite} team ${team}`);
    }
  }
  const strict = prepare(staticFixture(41, 0, false), single("reinforce2", "strict"));
  assert.deepEqual([strict.entities[0].tileX, strict.entities[0].tileY], [3, 3]);
  const dead = staticFixture(41);
  const deadHost = transportHostState(dead);
  deadHost.slots[160]!.health = 0;
  deadHost.slots[160]!.status = 10;
  const afterDeath = prepare({ ...dead, transportState: deadHost }, single("reinforce2", "dead"));
  assert.deepEqual([afterDeath.entities[0].tileX, afterDeath.entities[0].tileY], [3, 3]);
});

test("adapted delivery: terrain, colony footprint and live static rejection retain source search and carrier phases", () => {
  let initial = staticFixture(41);
  const host = transportHostState(initial);
  host.groundEligible[2 * 7 + 2] = false;
  host.groundEligible[3 * 7 + 2] = false;
  initial = { ...initial, transportState: host };
  let world = prepare(prepare(initial, single("reinforce", "first")), single("reinforce", "second"));
  world = ticks(world, 57);
  const beforeArrival = { ...world, transportState: JSON.parse(JSON.stringify(world.transportState)) };
  world = ticks(world, 1);
  assert.equal(world.entities.length, 0);
  for (const carrier of transportHostState(world).reducer.carriers) {
    assert.equal(carrier.phase, "orientation");
    assert.equal(carrier.groups[0].count, 1);
    assert.deepEqual(carrier.destination, { x: 640, y: 1152 });
  }
  world = ticks(world, 7);
  assert.equal(world.entities.length, 1);
  assert.deepEqual([world.entities[0].tileX, world.entities[0].tileY], [2, 4]);
  const second = transportHostState(world).reducer.carriers[1];
  assert.equal(second.phase, "orientation");
  assert.equal(second.groups[0].count, 1);
  assert.deepEqual(second.destination, { x: 896, y: 640 });
  world = ticks(world, 135);
  assert.deepEqual(world, ticks(beforeArrival, 143));
  assert.equal(world.entities.length, 2);
  assert.equal(new Set(world.entities.map(actor => `${actor.tileX},${actor.tileY}`)).size, 2);
  assert.equal(transportHostState(world).requests.filter(request => request.type === "create").length, 2);
  assert.deepEqual(world.entities.map(actor => [actor.rawSlot, actor.generation]), [[159, 0], [158, 0]]);
  for (const actor of world.entities) assert.equal(host.groundEligible[actor.tileY * 7 + actor.tileX], true);
});
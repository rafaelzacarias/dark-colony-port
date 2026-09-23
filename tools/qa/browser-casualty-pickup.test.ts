import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { browserCasualtyPickupPolicy, initializeBrowserCasualtyPickup, sourceUnitIsCommander } from "../../src/engine/browser-casualty-pickup";
import { createCampaignWorldAdapter, initialAdaptedTroState, type CampaignWorld } from "../../src/engine/campaign-world";
import { createBrowserAiSelectorConfiguration, createBrowserAiSelectorOwner } from "../../src/engine/browser-campaign-runtime";
import { createMissionController, decodeMissionWorldAction, planMissionStep, type PlannedMissionCommand } from "../../src/engine/mission-controller";
import { createTransportHostAdapter, initializeTransportHost, stepTransportHost, transportHostState, updateTransportHostUnit } from "../../src/engine/transport-host";
import type { TriggerResult } from "../../src/engine/trigger-runtime";
import { parseScenario } from "../extractors/data/scenario";
import { parseTriggerScript } from "../extractors/data/triggers";
import { parseUnitStats } from "../extractors/data/tables";

function value<Value>(result: TriggerResult<Value>): Value {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("Expected success");
  return result.value;
}

function fixture(unitType = 69, team = 0, adapted = true): CampaignWorld {
  const bytes = new Uint8Array(800 * 220);
  const view = new DataView(bytes.buffer);
  const offset = 300 * 220;
  view.setUint16(offset, 896, true);
  view.setUint16(offset + 4, 896, true);
  view.setInt32(offset + 12, 100, true);
  bytes[offset + 6] = unitType;
  bytes[offset + 7] = team;
  bytes[offset + 0x2c] = 1;
  const initial: CampaignWorld = { sessionId: "casualty", source: { id: "test", teams: [{ index: team }], placementRows: [] },
    placementState: { firstSlot: 152, nextSlot: 301, highWater: 301, renatSources: [], renatBytes: new Uint8Array(1000) },
    entities: [{ key: "commander", generation: 1, sourceRow: 0, team, unitType, tileX: 3, tileY: 3, rawTail: [],
      health: 100, maxHealth: 100, rawSlot: 300, simulationId: null }],
    buildingSlots: {}, entityBytes: bytes, typeMovementClasses: null, commanderSlots: { [team]: 300 },
    messageTexts: {}, messages: [], exomoney: { [team]: 123 }, statistics: { [`${team},0,${unitType}`]: 7 },
    clockMilliseconds: 0, transportState: null };
  const world = value(initializeTransportHost(initial, { width: 7, height: 7, groundEligible: Array(49).fill(true),
    definitions: [unitType, 92, 93].map(unitType => ({ unitType, health: 100, movementSpeed: 64, plane: "ground" })),
    sides: Array.from({ length: 8 }, (_, index) => index % 2), directionBits: [[0, 1], [1, 0]],
    highWater: 301, fixedStepMilliseconds: 20, orientationSteps: 2 }));
  return adapted ? initializeBrowserCasualtyPickup(world, { runtimeProfile: "browser-adapted" }) : world;
}

const death = { type: "combat-death", slot: 300, generation: 1 } as const;

test("casualty pickup: zero-HP commander waits for real carrier, counts once and never respawns", () => {
  const initial = fixture();
  const before = structuredClone(initial);
  let world = value(updateTransportHostUnit(initial, death));
  assert.deepEqual(initial, before);
  assert.equal(world.entities[0].health, 0);
  assert.equal(new DataView(world.entityBytes!.buffer).getInt32(300 * 220 + 12, true), 0);
  assert.equal(transportHostState(world).reducer.carriers[0].phase, "descent");
  assert.deepEqual(value(updateTransportHostUnit(world, death)), world);
  assert.equal(updateTransportHostUnit(world, { ...death, type: "complete-removal" }).ok, false);
  for (let tick = 0; tick < 51; tick += 1) world = value(stepTransportHost(world));
  assert.equal(transportHostState(world).registry[300], "commander");
  for (let tick = 0; tick < 100; tick += 1) world = value(stepTransportHost(world));
  const host = transportHostState(world);
  assert.equal(host.registry[300], null);
  assert.equal(host.slots[300]!.health, 0);
  assert.equal(world.entities.length, 0);
  assert.equal(host.requests.filter(entry => entry.type === "combat-death").length, 1);
  assert.equal(host.requests.filter(entry => entry.type === "casualty-picked-up").length, 1);
  assert.equal(host.requests.filter(entry => entry.type === "create").length, 0);
  assert.deepEqual(world.statistics, initial.statistics);
  assert.deepEqual(world.exomoney, initial.exomoney);
  assert.equal(host.reducer.carriers[0].phase, "released");
});

const original = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url), "utf8");

test("casualty pickup: every source commander upgrade and team, no base or commander-link prerequisite", () => {
  const units = parseUnitStats(original("GAMESTAT/GAMESTAT.TXT"));
  assert.deepEqual(units.filter(unit => sourceUnitIsCommander(unit.index)).map(unit => [unit.index, unit.sprite, unit.faction]),
    Array.from({ length: 8 }, (_, index) => [69 + index, index < 4 ? "TRSC" : "GRAY", index < 4 ? 0 : 1]));
  for (let team = 0; team < 8; team += 1) for (let unitType = 69; unitType <= 76; unitType += 1) {
    const world = value(updateTransportHostUnit({ ...fixture(unitType, team), commanderSlots: {} }, death));
    const state = transportHostState(world);
    assert.equal(state.reducer.carriers.length, 1);
    const carrier = state.reducer.carriers[0];
    assert.equal(carrier.team, team);
    assert.equal(carrier.slot, team * 15 + 7);
    assert.equal(carrier.type, team % 2 === 1 ? 93 : 92);
    assert.equal(carrier.commanderSlot, 300);
    assert.equal(state.slots[carrier.slot]!.team, 8);
    assert.equal(state.requests.filter(entry => entry.type === "combat-death").length, 1);
    assert.deepEqual(value(updateTransportHostUnit(world, death)), world);
  }
});

test("casualty pickup: ordinary types and strict defaults never auto-dispatch", () => {
  for (const unitType of [0, 6, 8, 14, 68, 77, 81, 86]) {
    const world = value(updateTransportHostUnit(fixture(unitType), death));
    assert.equal(transportHostState(world).reducer.carriers.length, 0);
    assert.equal(transportHostState(world).requests.filter(entry => entry.type === "combat-death").length, 1);
  }
  const strict = value(updateTransportHostUnit(fixture(69, 0, false), death));
  assert.equal(transportHostState(strict).reducer.carriers.length, 0);
  assert.equal(strict.browserCasualtyPickup, undefined);
  assert.equal(updateTransportHostUnit(strict, death).ok, false);
});

function abduct(selectedSide: number, carrierSide: number): PlannedMissionCommand {
  return { id: "explicit-abduct", triggerId: 0, actionIndex: 0,
    action: { name: "abduct", arguments: [selectedSide, carrierSide] }, command: { kind: "abduct", selectedSide, carrierSide } };
}

test("casualty pickup: original AL08 nopickup is persistent, consumed and leaves explicit abduct available", () => {
  const source = parseScenario(original("SCENARIO/ALIEN/ALIEN08.SCN"));
  const owner = createBrowserAiSelectorOwner(createBrowserAiSelectorConfiguration(source), source);
  const adapter = createCampaignWorldAdapter(createTransportHostAdapter(), undefined, owner);
  const block = parseTriggerScript(original("SCENARIO/ALIEN/ALIEN08.TRO")).find(block => block.id === 25)!;
  const action = block.actions[0];
  const command = value(decodeMissionWorldAction(action, { runtimeProfile: "browser-adapted" }));
  let world = value(adapter.prepare(fixture(69, 6), [{ id: "AL08:25:0", triggerId: block.id, actionIndex: 0, action, command }])).world;
  assert.equal(world.adaptedTro!.noPickup[6], 1);
  assert.equal(browserCasualtyPickupPolicy(world, 6, 69), "suppressed");
  assert.equal(browserCasualtyPickupPolicy(world, 0, 69), "automatic");
  const explicit = value(adapter.prepare(world, [abduct(6, 6)])).world;
  assert.equal(transportHostState(explicit).reducer.carriers.length, 1);
  assert.equal(explicit.entities[0].health, 100);
  world = value(updateTransportHostUnit(world, death));
  assert.equal(transportHostState(world).reducer.carriers.length, 0);
  assert.equal(transportHostState(world).directionCursor, 0);
  assert.equal(transportHostState(world).browserCasualties![0].disposition, "suppressed");
  assert.equal(transportHostState(world).requests.filter(entry => entry.type === "combat-death").length, 1);
  assert.deepEqual(value(updateTransportHostUnit(world, death)), world);
  assert.equal(value(adapter.prepare(world, [abduct(6, 6)])).receipts[0].disposition, "verified-inactive-target");
  assert.equal(world.adaptedTro!.noPickup[6], 1);
  assert.equal(value(updateTransportHostUnit(world, { ...death, type: "complete-removal" })).entities.length, 0);
});

test("casualty pickup: all-team suppression does not require directions or carrier definitions", () => {
  for (let team = 0; team < 8; team += 1) {
    const initial = fixture(73, team);
    const state = transportHostState(initial);
    state.directionBits = [];
    state.definitions = state.definitions.filter(entry => entry.unitType < 92);
    const world = value(updateTransportHostUnit({ ...initial, transportState: state,
      adaptedTro: { ...initialAdaptedTroState(initial), noPickup: Array(8).fill(1) } }, death));
    assert.equal(transportHostState(world).reducer.carriers.length, 0);
    assert.equal(transportHostState(world).requests.filter(entry => entry.type === "combat-death").length, 1);
  }
});

test("casualty pickup: pool exhaustion and stale generation are atomic", () => {
  let initial = fixture();
  const state = transportHostState(initial);
  state.directionBits = Array.from({ length: 9 }, () => [0, 1] as const);
  initial = { ...initial, transportState: state };
  for (let index = 0; index < 8; index += 1) {
    initial = value(createTransportHostAdapter().prepare(initial, { ...abduct(0, 0), id: `explicit:${index}` })).world;
  }
  const before = structuredClone(initial);
  assert.equal(updateTransportHostUnit(initial, death).ok, false);
  assert.equal(updateTransportHostUnit(initial, { ...death, generation: 2 }).ok, false);
  assert.deepEqual(initial, before);
  assert.equal(transportHostState(initial).requests.filter(entry => entry.type === "combat-death").length, 0);
});

test("casualty pickup: in-flight serialized host continuation stays deterministic", () => {
  let world = value(updateTransportHostUnit(fixture(73, 1), death));
  for (let tick = 0; tick < 53; tick += 1) world = value(stepTransportHost(world));
  let restored: CampaignWorld = { ...structuredClone(world), transportState: JSON.parse(JSON.stringify(world.transportState)),
    browserCasualtyPickup: JSON.parse(JSON.stringify(world.browserCasualtyPickup)) };
  for (let tick = 0; tick < 65; tick += 1) {
    world = value(stepTransportHost(world));
    restored = value(stepTransportHost(restored));
  }
  assert.deepEqual(restored, world);
  assert.equal(transportHostState(world).browserCasualties![0].collected, true);
});

test("casualty pickup: original M01 loss still fires before collection; M02 owns scripted recovery", () => {
  for (const [faction, unitType, lossId, recoveryId] of [["HUMAN", 69, 18, 19], ["ALIEN", 73, 11, 12]] as const) {
    const world = value(updateTransportHostUnit(fixture(unitType), death));
    const request = transportHostState(world).requests.find(entry => entry.type === "combat-death")!;
    assert.equal(request.type, "combat-death");
    if (request.type !== "combat-death") throw new Error("Missing loss");
    const statistics = Object.fromEntries(Array.from({ length: 106 }, (_, index) => [`0,0,${index}`, 0]));
    statistics["0,3"] = 0;
    const inputs = { cycleCounter: 100 * 16, clockMilliseconds: 1600, buildingSlots: {} };
    const mission1 = parseTriggerScript(original(`SCENARIO/${faction}/${faction}01.TRO`));
    const deathBlock = mission1.find(block => block.condition.includes(`s(0,0,${unitType})`))!;
    const strict = planMissionStep(value(createMissionController([deathBlock], statistics)), inputs, { kind: "normal" }, [request.loss]);
    assert.deepEqual(strict.diagnostics, []);
    assert.equal(strict.next!.runtime.bail!.resultCode, 1);
    assert.equal(strict.next!.runtime.statistics[`0,0,${unitType}`], 1);
    assert.equal(transportHostState(world).registry[300], "commander");
    const mission2 = parseTriggerScript(original(`SCENARIO/${faction}/${faction}02.TRO`));
    const recovery = mission2.filter(block => block.id === lossId || block.id === recoveryId);
    const planned = planMissionStep(value(createMissionController(recovery, statistics)), inputs, { kind: "normal" }, [request.loss]);
    assert.deepEqual(planned.diagnostics, []);
    assert.equal(planned.next!.runtime.bail, null);
    assert.equal(planned.next!.runtime.statistics["0,2,0"], 145);
    assert.equal(planned.next!.runtime.lives[recoveryId], 1);
    const returned = planMissionStep(planned.next!, { ...inputs, cycleCounter: 146 * 16 }, { kind: "normal" }, [request.loss]);
    assert.deepEqual(returned.diagnostics, []);
    assert.equal(returned.next!.runtime.statistics[`0,0,${unitType}`], 1);
    assert.ok(returned.commands.some(entry => entry.command.kind === "reinforce"
      && entry.command.groups.some(group => group.unitType === unitType && group.count === 1)));
  }
});
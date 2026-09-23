import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  bindCampaignEntity, campaignStaticTargetOptions, campaignVictimLosses, createCampaignWorld,
  createCampaignWorldAdapter, planCampaignStep, stepCampaignWorld,
  type CampaignTransportAdapter, type CampaignWorld,
} from "../../src/engine/campaign-world.ts";
import { createMissionController, missionBailDeadlineExceeded, type PlannedMissionCommand } from "../../src/engine/mission-controller.ts";
import { tripForReservedMtgDestination, type TriggerResult } from "../../src/engine/trigger-runtime.ts";
import { NavigationGrid } from "../../src/engine/grid.ts";
import { DeterministicSimulation, type DeathEvent } from "../../src/engine/simulation.ts";
import type { LegacyUnitStat } from "../../src/engine/legacy-balance.ts";
import { parseMissionMessages } from "../extractors/data/messages.ts";
import { parseScenario } from "../extractors/data/scenario.ts";
import { parseTriggerScript } from "../extractors/data/triggers.ts";

function unwrap<Value>(result: TriggerResult<Value>): Value {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("Expected success");
  return result.value;
}

function fixture(faction: "HUMAN" | "ALIEN") {
  const source = (extension: string) => readFileSync(new URL(`../../raw_cd/DC/SCENARIO/${faction}/${faction}01.${extension}`, import.meta.url), "utf8");
  const scenario = parseScenario(source("SCN"));
  const units: LegacyUnitStat[] = JSON.parse(readFileSync(new URL("../../public/assets/generated/data/units.json", import.meta.url), "utf8")).records;
  const world = unwrap(createCampaignWorld({ sessionId: faction, source: scenario, units, messages: parseMissionMessages(source("MSG")) }));
  const statistics: Record<string, number> = faction === "HUMAN"
    ? { "0,3": 0, "0,0,69": 0, "0,0,70": 0, "0,0,71": 0, "0,0,72": 0, "4,3": 0, "4,0,8": 0 }
    : { "0,3": 0, "0,0,73": 0, "1,3": 0, "1,0,82": 0 };
  return { world, scenario, units, state: unwrap(createMissionController(parseTriggerScript(source("TRO")), statistics)) };
}

const clock = { cycleCounter: 16, clockMilliseconds: 100 };
const normal = { kind: "normal" } as const;

test("real ALIEN01 startup plans every action without expanding reinforcement troops", () => {
  const { world, state } = fixture("ALIEN");
  const before = structuredClone({ world, state });
  const planned = planCampaignStep(state, world, clock, normal);
  assert.deepEqual(planned.plan.commands.map(({ command }) => command.kind), ["msg", "reinforce2", "reinforce"]);
  assert.deepEqual(planned.pendingTransport.map(({ command }) => command.kind), ["reinforce2", "reinforce"]);
  assert.equal(planned.plan.pendingEvaluation, null);
  assert.equal(world.entities.length, world.source.placementRows.length);
  assert.equal(stepCampaignWorld(state, world, clock, normal).ok, false);
  assert.deepEqual({ world, state }, before);
});

test("real HUMAN01 refuses missing colony slots instead of inventing states 0 or 1", () => {
  const { world, state } = fixture("HUMAN");
  const { plan } = planCampaignStep(state, world, clock, normal);
  assert.equal(plan.next, null);
  assert.ok(plan.diagnostics.some(({ code, message }) => code === "missing-input" && message.includes("b(")), JSON.stringify(plan.diagnostics));
  assert.deepEqual(world.buildingSlots, {});
  assert.equal(stepCampaignWorld(state, world, clock, normal).ok, false);
});

function withRawSlotFixture(world: CampaignWorld): CampaignWorld {
  const entityBytes = new Uint8Array(800 * 220);
  for (const [index, entity] of world.entities.entries()) {
    const offset = (152 + index) * 220;
    const view = new DataView(entityBytes.buffer);
    view.setUint16(offset, entity.tileX * 256 + 128, true);
    view.setUint16(offset + 4, entity.tileY * 256 + 128, true);
    entityBytes[offset + 6] = entity.unitType;
    entityBytes[offset + 7] = entity.team;
    entityBytes[offset + 0x2c] = 1;
  }
  return { ...world, entityBytes, typeMovementClasses: new Uint8Array(110),
    entities: world.entities.map((entity, index) => ({ ...entity, rawSlot: 152 + index })) };
}

const schedulingContractFixture: CampaignTransportAdapter = {
  prepare(world, planned) {
    if (planned.command.kind !== "reinforce" && planned.command.kind !== "abduct") {
      return { ok: false, diagnostics: [{ code: "missing-input", message: "Contract fixture does not implement synchronous reinforce2" }] };
    }
    const pending = (world.transportState ?? []) as PlannedMissionCommand[];
    return { ok: true, value: { world: { ...world, transportState: [...pending, planned] }, disposition: "scheduled" } };
  },
};

test("declared teams, types, stat health and opaque SCN fields survive without reinterpretation", () => {
  const { world, scenario, units } = fixture("ALIEN");
  assert.equal(scenario.teams[0].race, 1);
  assert.equal(scenario.teams[1].money, 0);
  assert.equal(scenario.teams[1].ai, 4);
  assert.equal(scenario.teams[1].teamColor, 7);
  assert.deepEqual(world.source, scenario);
  assert.notEqual(world.source, scenario);
  for (const entity of world.entities) {
    const row = scenario.placementRows[entity.sourceRow!];
    assert.deepEqual([entity.tileX, entity.tileY, entity.unitType, entity.team, ...entity.rawTail], row);
    assert.equal(entity.health, units.find(({ index }) => index === entity.unitType)!.health);
    assert.equal(entity.maxHealth, entity.health);
    assert.equal(entity.simulationId, null);
    assert.equal(entity.rawSlot, null);
  }
  const target = world.entities.find(({ unitType }) => unitType === 82)!;
  assert.equal(campaignStaticTargetOptions(target, {}).ok, false);
  assert.equal(unwrap(campaignStaticTargetOptions(target, { 1: "human" })).faction, "human");
  const missing = createCampaignWorld({ sessionId: "missing", source: scenario, units: [], messages: [] });
  assert.equal(missing.ok, false);
});

test("HUMAN01 startup applies real message, ordered economy assignments and raw waypoint with explicit fixture prerequisites", () => {
  const initial = fixture("HUMAN");
  const world = { ...withRawSlotFixture(initial.world),
    buildingSlots: { "1,0": 7, "1,1": 0, "1,2": 0, "1,3": 0, "1,4": 0 }, exomoney: { 1: 37 } };
  const before = structuredClone(world);
  const { plan } = planCampaignStep(initial.state, world, clock, normal);
  assert.deepEqual(plan.commands.map(({ command }) => command.kind),
    ["msg", "exomoney", "exomoney", "exomoney", "exomoney", "exomoney", "reinforce", "waypoint"]);
  const committed = unwrap(stepCampaignWorld(initial.state, world, clock, normal, [], schedulingContractFixture));
  assert.deepEqual(committed.receipts.map(({ disposition }) => disposition),
    ["applied", "applied", "applied", "applied", "applied", "applied", "scheduled", "applied"]);
  assert.deepEqual(committed.world.exomoney, { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 });
  assert.deepEqual(committed.world.messages[0], { commandId: "0:8:7", messageId: 1, text: world.messageTexts[1],
    presentationCode: 2, parameter3: 3, parameter4: 8, clockMilliseconds: 100, initialValue: 31 });
  const target = world.entities.find(({ tileX, tileY }) => tileX === 41 && tileY === 12)!;
  const offset = target.rawSlot! * 220;
  const bytes = committed.world.entityBytes!;
  const view = new DataView(bytes.buffer);
  assert.equal(bytes[offset + 0x36], 1);
  assert.equal(bytes[offset + 0x37], 9);
  assert.equal(bytes[offset + 0xc6], 2);
  assert.deepEqual([view.getUint16(offset + 0xa6, true), view.getUint16(offset + 0xa8, true)], [40 * 256 + 128, 14 * 256 + 128]);
  assert.deepEqual(bytes.slice(offset, offset + 8), world.entityBytes!.slice(offset, offset + 8));
  assert.equal(committed.world.entities.length, world.entities.length);
  assert.deepEqual(committed.state.runtime.statistics, initial.state.runtime.statistics);
  assert.equal(committed.state.runtime.lives[8], 0);
  assert.deepEqual(world, before);
});

test("actual HUMAN01 trip-7 reservation activates beacon without taking ownership and rearms victory", () => {
  const initial = fixture("HUMAN");
  const world = withRawSlotFixture(initial.world);
  const source = new Uint8Array(readFileSync(new URL("../../raw_cd/DC/SCENARIO/HUMAN/HUMAN01.MTG", import.meta.url)));
  const trip = unwrap(tripForReservedMtgDestination(source.slice(2), source[0], source[1], 25, 59, 0));
  assert.deepEqual(trip, { kind: "trip", triggerId: 7, team: 0 });
  assert.ok(trip);
  const beacon = world.entities.find(({ tileX, tileY }) => tileX === 26 && tileY === 59)!;
  assert.equal(beacon.unitType, 95);
  assert.equal(beacon.team, 1);
  assert.equal(initial.state.runtime.lives[4], 0);
  const result = unwrap(stepCampaignWorld(initial.state, world, clock, trip, [], schedulingContractFixture));
  assert.deepEqual(result.world.entities.find(({ key }) => key === beacon.key), { ...beacon, unitType: 84 });
  const changed = [...result.world.entityBytes!.keys()].filter((index) => result.world.entityBytes![index] !== world.entityBytes![index]);
  assert.deepEqual(changed, [beacon.rawSlot! * 220 + 6]);
  assert.equal(result.state.runtime.lives[7], 0);
  assert.equal(result.state.runtime.lives[4], 1);
  assert.equal(result.state.runtime.bail, null);
  assert.deepEqual(result.state.runtime.statistics, initial.state.runtime.statistics);
  assert.equal(result.world.messages[0].messageId, 4);
  assert.equal(result.world.entities.length, world.entities.length);
  const replay = unwrap(stepCampaignWorld(result.state, result.world, clock, trip, [], schedulingContractFixture));
  assert.equal(replay.world.messages.length, 1);
  assert.equal((replay.world.transportState as unknown[]).length, 1);
});

test("eleven actual type-82 combat deaths satisfy ALIEN01, schedule pickup and bail, without claiming extraction", () => {
  const initial = fixture("ALIEN");
  const simulation = new DeterministicSimulation(new NavigationGrid(96, 84));
  let world = withRawSlotFixture(initial.world);
  const objectives = world.entities.filter(({ team, unitType }) => team === 1 && unitType === 82);
  assert.equal(objectives.length, 11);
  const deaths: DeathEvent[] = [];
  for (const entity of objectives) {
    const targetId = simulation.addStaticTarget(unwrap(campaignStaticTargetOptions(entity, { 1: "human" })));
    world = unwrap(bindCampaignEntity(world, entity.key, targetId, entity.rawSlot));
    const attackerId = simulation.addUnit({ faction: "alien", cell: { x: entity.tileX + 1, y: entity.tileY },
      weapon: { damage: entity.maxHealth, rangeCells: 1, cooldownTicks: 1 } });
    simulation.queue({ type: "attack", unitIds: [attackerId], targetId });
    simulation.advance();
    deaths.push(...simulation.deathEvents);
  }
  assert.equal(deaths.length, 11);
  const scan = { cycleCounter: 0, clockMilliseconds: 250 };
  const ten = unwrap(stepCampaignWorld(initial.state, world, scan, normal, deaths.slice(0, 10)));
  assert.equal(ten.state.runtime.statistics["1,0,82"], 10);
  assert.equal(ten.state.runtime.statistics["1,3"], 10);
  assert.equal(ten.state.runtime.bail, null);
  assert.equal(ten.state.runtime.lives[3], 1);
  const before = structuredClone(ten);
  const missingCommander = stepCampaignWorld(ten.state, ten.world, scan, normal, deaths, schedulingContractFixture);
  assert.equal(missingCommander.ok, false);
  assert.deepEqual(ten, before);
  const entityBytes = new Uint8Array(ten.world.entityBytes!);
  entityBytes[799 * 220 + 6] = 73;
  entityBytes[799 * 220 + 7] = 0;
  entityBytes[799 * 220 + 0x2c] = 1;
  const checkpoint = { ...ten.world, entityBytes, commanderSlots: { 0: 799 } };
  const disabled = { ...ten.state, runtime: { ...ten.state.runtime, lives: { ...ten.state.runtime.lives, 3: 0 } } };
  assert.equal(unwrap(stepCampaignWorld(disabled, checkpoint, scan, normal, deaths)).state.runtime.bail, null);
  const victory = unwrap(stepCampaignWorld(ten.state, checkpoint, scan, normal, deaths, schedulingContractFixture));
  assert.equal(victory.state.runtime.statistics["1,0,82"], 11);
  assert.equal(victory.state.runtime.statistics["1,3"], 11);
  assert.equal(victory.state.runtime.statistics["0,3"], 0);
  assert.equal(victory.state.runtime.statistics["0,2"], undefined);
  assert.equal(Object.keys(victory.state.consumedLosses).length, 11);
  assert.equal(victory.state.runtime.lives[3], 0);
  assert.deepEqual(victory.state.runtime.bail, { resultCode: 0, reasonCode: 1, deadlineMilliseconds: 10250 });
  assert.equal(unwrap(missionBailDeadlineExceeded(victory.state.runtime.bail, 10250)), false);
  assert.equal(unwrap(missionBailDeadlineExceeded(victory.state.runtime.bail, 10251)), true);
  assert.deepEqual(victory.receipts.map(({ disposition }) => disposition), ["applied", "scheduled"]);
  assert.deepEqual((victory.world.transportState as PlannedMissionCommand[])[0].command, { kind: "abduct", selectedSide: 0, carrierSide: 0 });
  assert.equal(victory.world.entityBytes![799 * 220 + 0x2c], 1);
  assert.deepEqual(victory.world.entityBytes, checkpoint.entityBytes);
  assert.ok(victory.world.entities.filter(({ unitType }) => unitType === 82).every(({ health }) => health === 0));
  const replay = unwrap(stepCampaignWorld(victory.state, victory.world, scan, normal, deaths));
  assert.equal(replay.state.runtime.statistics["1,0,82"], 11);
  assert.equal(replay.world.messages.length, 1);
});

test("ordered world-dependent normal scans expose pendingEvaluation and never commit a prefix", () => {
  const { world } = fixture("ALIEN");
  for (const condition of ["b(1,0)==0", "s(1,1,82)==0"]) {
    const state = unwrap(createMissionController(parseTriggerScript(`1 norm 1 (c>0)
exomoney 1 37
end
2 norm 1 (${condition})
bail 0 1
end`), { "1,1,82": 0 }));
    const supplied = { ...world, buildingSlots: { "1,0": 0 } };
    const before = structuredClone({ state, supplied });
    const { plan } = planCampaignStep(state, supplied, clock, normal);
    assert.equal(plan.pendingEvaluation?.triggerId, 2);
    assert.deepEqual(plan.pendingEvaluation?.afterCommandIds, ["0:1:0"]);
    assert.equal(plan.next, null);
    assert.deepEqual(plan.fired, [1]);
    assert.deepEqual(plan.diagnostics, []);
    assert.equal(stepCampaignWorld(state, supplied, clock, normal).ok, false);
    assert.deepEqual({ state, supplied }, before);
  }
});

test("transport failure after staged messages leaves all caller objects and controller lives untouched", () => {
  const { world, state } = fixture("ALIEN");
  const before = structuredClone({ world, state });
  const failing: CampaignTransportAdapter = {
    prepare(staged, planned) {
      assert.equal(staged.messages[0].messageId, 1);
      assert.equal(planned.command.kind, "reinforce2");
      Reflect.set(staged, "exomoney", { 1: 255 });
      Reflect.set(planned.command, "team", 7);
      return { ok: false, diagnostics: [{ code: "missing-input", message: "Collision/FIFO state unavailable" }] };
    },
  };
  const result = stepCampaignWorld(state, world, clock, normal, [], failing);
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.diagnostics, [{ code: "missing-input", message: "Collision/FIFO state unavailable", triggerId: 1, actionIndex: 1 }]);
  assert.deepEqual({ world, state }, before);
  const wrongReceipt: CampaignTransportAdapter = { prepare: (staged) => ({ ok: true, value: { world: staged, disposition: "scheduled" } }) };
  assert.equal(stepCampaignWorld(state, world, clock, normal, [], wrongReceipt).ok, false);
  assert.deepEqual({ world, state }, before);
});

test("raw waypoint matches inactive first slot and newtype changes only type, not health/team", () => {
  const { world } = fixture("HUMAN");
  const raw = withRawSlotFixture(world);
  raw.entityBytes![1] = 26;
  raw.entityBytes![5] = 59;
  raw.entityBytes![6] = 95;
  raw.entityBytes![7] = 5;
  const state = unwrap(createMissionController(parseTriggerScript(`1 norm 1 (c>0)
newtype 26 59 84
waypoint 26 59 1 5 6
end`), {}));
  const before = structuredClone(raw);
  const result = unwrap(stepCampaignWorld(state, raw, clock, normal));
  assert.equal(result.world.entityBytes![6], 84);
  assert.equal(result.world.entityBytes![7], 5);
  assert.equal(result.world.entityBytes![0x2c], 0);
  assert.equal(result.world.entityBytes![0xc6], 1);
  assert.deepEqual(result.world.entities, raw.entities);
  assert.deepEqual(raw, before);
});

test("unresolved deaths and duplicate bindings fail; transport absence is never a death", () => {
  const { world } = fixture("ALIEN");
  assert.equal(campaignVictimLosses(world, [{ type: "death", targetId: 42, tick: 1 }]).ok, false);
  const bound = unwrap(bindCampaignEntity(world, world.entities[0].key, 42));
  assert.equal(bindCampaignEntity(bound, world.entities[1].key, 42).ok, false);
  assert.equal(bindCampaignEntity(bound, world.entities[0].key, 43).ok, false);
  assert.deepEqual(unwrap(campaignVictimLosses(bound, [])).losses, []);
  const first = unwrap(campaignVictimLosses(bound, [{ type: "death", targetId: 42, tick: 1 }]));
  const replay = unwrap(campaignVictimLosses(first.world, [{ type: "death", targetId: 42, tick: 999 }]));
  assert.deepEqual(first.losses, replay.losses);
  assert.equal(world.entities[0].health > 0, true);
});

test("missing text, special queue selection and full queue fail without partial economy publication", () => {
  const { world } = fixture("ALIEN");
  for (const action of ["msg 2 0 29 3 6", "msg 2 0 1 3 255"]) {
    const state = unwrap(createMissionController(parseTriggerScript(`1 norm 1 (c>0)\n${action}\nexomoney 1 37\nend`), {}));
    const before = structuredClone(world);
    assert.equal(stepCampaignWorld(state, world, clock, normal).ok, false);
    assert.deepEqual(world, before);
  }
  const state = unwrap(createMissionController(parseTriggerScript("1 norm 1 (c>0)\nmsg 2 0 1 3 6\nend"), {}));
  const once = unwrap(stepCampaignWorld(state, world, clock, normal));
  const full = { ...world, messages: Array.from({ length: 16 }, () => once.world.messages[0]) };
  assert.equal(stepCampaignWorld(state, full, clock, normal).ok, false);
  const { plan } = planCampaignStep(state, world, clock, normal);
  const detached = unwrap(createCampaignWorldAdapter().prepare(world, plan.commands));
  Reflect.set(detached.world.source, "id", "changed");
  assert.equal(world.source.id, "alien01");
});
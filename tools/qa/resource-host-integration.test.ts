import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCampaignWorld, createCampaignWorldAdapter, type CampaignPlannedCommand } from "../../src/engine/campaign-world.ts";
import { createCampaignSession, initializeCampaignSession, type CampaignSessionOptions } from "../../src/engine/campaign-session.ts";
import { requestCampaignResourceExtraction, stepTransportHost, transportHostState, type TransportHostState } from "../../src/engine/transport-host.ts";
import type { TriggerResult } from "../../src/engine/trigger-runtime.ts";
import { parseScenario } from "../extractors/data/scenario.ts";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables.ts";
import { parseMapBundle } from "../extractors/maps/map.ts";
import { parseTriggerScript } from "../extractors/data/triggers.ts";

function unwrap<Value>(result: TriggerResult<Value>): Value {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("Expected success");
  return result.value;
}

const read = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url), "utf8");
const units = parseUnitStats(read("GAMESTAT/GAMESTAT.TXT"));
const initialization = { width: 128, height: 128, firstSlot: 152, scales: { rateScale: 256, reserveScale: 256 } };

test("all seven original mission02 resource placements retain native order and rate/reserve", () => {
  const actual: number[][] = [];
  const fixture = sessionOptions();
  for (const faction of ["HUMAN", "ALIEN"]) {
    const source = parseScenario(read(`SCENARIO/${faction}/${faction}02.SCN`));
    const before = structuredClone(source);
    assert.equal(createCampaignWorld({ sessionId: faction, source, units, messages: [], resourceInitialization: initialization }).ok, false);
    for (const [index, row] of source.placementRows.entries()) {
      if (row[2] !== 40) continue;
      const world = unwrap(createCampaignWorld({ sessionId: faction, source: { ...source, placementRows: [row] },
        units, messages: [], resourceInitialization: { ...initialization, firstSlot: 152 + index } }));
      const entity = world.entities[0];
      assert.equal(entity.team, 8);
      assert.equal(entity.rawSlot, 152 + index);
      assert.equal(entity.resource!.countdownWord, 65535);
      actual.push([entity.tileX, entity.tileY, entity.resource!.rateWord, entity.health]);
      const session = unwrap(initializeCampaignSession({ ...fixture, source: { ...fixture.source, placementRows: [row] } }));
      const saved = unwrap(stepTransportHost(session.world));
      const record = transportHostState(saved).slots[152]!;
      assert.equal(record.health, row[4]);
      assert.equal(record.resource!.rateWord, row[3]);
      assert.equal(record.resource!.countdownWord, 65535);
      assert.equal(record.status, 1);
      assert.equal(record.team, 8);
    }
    assert.deepEqual(source, before);
  }
  assert.deepEqual(actual, [[88, 72, 0, 3500], [11, 68, 0, 3500], [69, 48, 22, 12000],
    [53, 27, 15, 7000], [4, 80, 25, 9500], [65, 54, 12, 3500], [13, 51, 0, 5000]]);
});

test("resource opt-in does not relax team validation or map bounds", () => {
  const options = { sessionId: "bounds", units, messages: [], resourceInitialization: initialization };
  for (const row of [[1, 1, 0, 8, -1], [128, 1, 40, 0, 300], [1, 1, 40, -1, 300]]) {
    assert.equal(createCampaignWorld({ ...options, source: { id: "bounds", teams: [{ index: 0 }], placementRows: [row] } }).ok, false);
  }
});

function sessionOptions(): CampaignSessionOptions {
  const mission = (extension: string) => readFileSync(new URL(`../../raw_cd/DC/SCENARIO/HUMAN/HUMAN01.${extension}`, import.meta.url));
  const map = parseMapBundle(mission("MAP"), mission("MTG"), mission("PTH"));
  return {
    sessionId: "resource-fixture", source: { ...parseScenario(mission("SCN").toString()),
      placementRows: [[5, 5, 40, 0, 3500], [5, 5, 40, 0, 5000], [6, 5, 40, 12, 0]] },
    units, weapons: parseWeaponStats(read("GAMESTAT/WEAPSTAT.TXT")), triggers: [], messages: [],
    map, pathGrid: map.pathGrid, tags: map.tagGrid, commanders: [{ team: 0, unitType: 69, sprite: "TRSC" }],
    directionBits: [[0, 0]], fixedStepMilliseconds: 16, orientationSteps: 1, resourceScales: "configured-startup",
  };
}

function command(id: string, rate = 12, tileX = 5, tileY = 5): CampaignPlannedCommand {
  return { id, triggerId: 8, actionIndex: 0, action: { name: "newrate", arguments: [rate, tileX, tileY] },
    command: { kind: "newrate", rate, tileX, tileY } };
}

test("session initializes real resource slots, idle payload and tile flags without ground occupancy or fake teams", () => {
  const options = sessionOptions();
  assert.equal(initializeCampaignSession({ ...options, resourceScales: undefined }).ok, false);
  const session = unwrap(initializeCampaignSession(options));
  const host = transportHostState(session.world);
  const bytes = session.world.entityBytes!;
  const view = new DataView(bytes.buffer);
  for (const entity of session.world.entities.filter(({ resource }) => resource)) {
    const slot = entity.rawSlot!;
    const offset = slot * 220;
    const record = host.slots[slot]!;
    assert.equal(record.status, 1);
    assert.equal(record.team, 8);
    assert.equal(record.health, entity.health);
    assert.deepEqual(record.resource, entity.resource);
    assert.equal(record.task, "idle");
    assert.deepEqual(record.taskWords, [65535]);
    assert.equal(bytes[offset + 0x39], 1);
    assert.equal(view.getUint16(offset + 0x46, true), 65535);
    assert.equal(view.getUint16(offset + 0x32, true), entity.resource!.rateWord);
    assert.equal(view.getInt32(offset + 0x0c, true), entity.health);
    assert.equal(host.resourceTileFlags[entity.tileY * host.width + entity.tileX], 0x04000000);
    assert.equal(host.ground.includes(slot), false);
    assert.equal(session.staticSlots.includes(slot), false);
  }
  assert.equal(session.world.source.teams.length, 8);
});

test("newrate scans native slot order, skips inactive sources and accepts nonzero removal status with zero reserve", () => {
  const world = unwrap(initializeCampaignSession(sessionOptions())).world;
  const before = structuredClone(world);
  const adapter = createCampaignWorldAdapter();
  const first = unwrap(adapter.prepare({ ...world, entities: [...world.entities].reverse() }, [command("first")]));
  assert.equal(transportHostState(first.world).slots[152]!.resource!.rateWord, 12);
  assert.equal(transportHostState(first.world).slots[153]!.resource!.rateWord, 0);
  assert.deepEqual(first.receipts, [{ commandId: "first", disposition: "applied" }]);
  assert.deepEqual(world, before);
  const host = world.transportState as TransportHostState;
  world.entityBytes![152 * 220 + 0x2c] = 0;
  host.slots[152]!.status = 0;
  world.entityBytes![153 * 220 + 0x2c] = 10;
  host.slots[153]!.status = 10;
  const second = unwrap(adapter.prepare(world, [command("second")]));
  assert.equal(transportHostState(second.world).slots[152]!.resource!.rateWord, 0);
  assert.equal(transportHostState(second.world).slots[153]!.resource!.rateWord, 12);
  const zeroReserve = unwrap(adapter.prepare(world, [command("zero-reserve", 15, 6)]));
  assert.equal(transportHostState(zeroReserve.world).slots[154]!.health, 0);
  assert.equal(transportHostState(zeroReserve.world).slots[154]!.resource!.rateWord, 15);
});

test("missing newrate target rolls back an entire prepared batch including sound and receipts", () => {
  const world = unwrap(initializeCampaignSession(sessionOptions())).world;
  const before = structuredClone(world);
  const result = createCampaignWorldAdapter().prepare(world, [command("valid"), command("missing", 12, 7)]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.diagnostics[0].message, /0x43dbc1/);
  assert.deepEqual(world, before);
});

test("full-width initialization and overflow newrate arithmetic survive host saves", () => {
  const options = sessionOptions();
  const initialized = unwrap(initializeCampaignSession({ ...options, resourceScales: { rateScale: 65536, reserveScale: 65536 },
    source: { ...options.source, placementRows: [[5, 5, 40, 1, 65536]] } }));
  assert.equal(transportHostState(initialized.world).slots[152]!.resource!.rateWord, 256);
  assert.equal(transportHostState(initialized.world).slots[152]!.health, 0);
  const adapter = createCampaignWorldAdapter();
  for (const [scale, rate, expected] of [[65536, 1, 256], [2147483647, 12, 0], [-128, 15, 65529], [128, 15, 7]]) {
    const world = { ...initialized.world, statistics: { ...initialized.world.statistics, "1,0": scale } };
    const prepared = unwrap(adapter.prepare(world, [command(`scale:${scale}`, rate)]));
    const saved = unwrap(stepTransportHost(prepared.world));
    assert.equal(transportHostState(saved).slots[152]!.resource!.rateWord, expected);
    assert.equal(new DataView(saved.entityBytes!.buffer).getUint16(152 * 220 + 0x32, true), expected);
    assert.equal(saved.statistics["1,0"], scale);
  }
});

test("ordered newrate dispatch keeps full32 scales and intervening array writes", () => {
  const session = unwrap(createCampaignSession({ ...sessionOptions(), resourceScales: { rateScale: 65536, reserveScale: 256 },
    triggers: parseTriggerScript(`1 norm 1 (1)
setarray 1 (s(1,0))
newrate 1 5 5
setarray 0 (s(0,2,0)+1)
exomoney 0 17
end`) }));
  for (let tick = 1; tick < 8; tick += 1) unwrap(session.step({ clockMilliseconds: tick * 16 }));
  const frame = unwrap(session.step({ clockMilliseconds: 128 }));
  const dispatched = frame.entry.commands.find(({ command }) => command.kind === "newrate")!;
  assert.equal(dispatched.statistics!["1,0"], 65536);
  assert.equal(dispatched.statistics!["0,2,0"], 1);
  assert.equal(transportHostState(frame.world).slots[152]!.resource!.rateWord, 256);
  assert.equal(frame.entry.requests.filter(({ type }) => type === "source-sound").length, 1);
  assert.equal(frame.world.statistics["0,2,0"], 1);
  assert.equal(frame.world.statistics["0,2,1"], 0);
  assert.equal(frame.world.statistics["1,0"], 65536);
  assert.equal(frame.controller.runtime.lives[1], 0);
  const next = unwrap(session.step({ clockMilliseconds: 144 }));
  assert.equal(next.world.statistics["0,2,0"], 1);
  assert.equal(transportHostState(next.world).slots[152]!.resource!.rateWord, 256);
});

test("census refresh retains full32 rate/reserve scales and excludes neutral resource statistics", () => {
  const session = unwrap(createCampaignSession({ ...sessionOptions(), resourceScales: { rateScale: 65536, reserveScale: 2147483647 } }));
  for (let tick = 1; tick <= 8; tick += 1) {
    const frame = unwrap(session.step({ clockMilliseconds: tick * 16 }));
    assert.equal(frame.controller.runtime.statistics["1,0"], 65536);
    assert.equal(frame.controller.runtime.statistics["2,0"], 2147483647);
    assert.equal(frame.world.statistics["1,0"], 65536);
    assert.equal(frame.world.statistics["2,0"], 2147483647);
    assert.equal(Object.keys(frame.world.statistics).some((key) => key.startsWith("8,")), false);
  }
});

test("source sound payload is recorded exactly once per committed identity even when scaled rate stays zero", () => {
  const initialized = unwrap(initializeCampaignSession(sessionOptions())).world;
  const world = { ...initialized, statistics: { ...initialized.statistics, "1,0": 0 } };
  const adapter = createCampaignWorldAdapter();
  const planned = command("sound");
  const first = unwrap(adapter.prepare(world, [planned]));
  const retry = unwrap(adapter.prepare(first.world, [planned]));
  assert.deepEqual(transportHostState(retry.world).requests, [{ type: "source-sound", commandId: "sound", slot: 152,
    generation: 0, category: 1, event: 7, ebx: 0, ecx: 0, stackArgument: 0, spatial: false }]);
  assert.equal(transportHostState(world).requests.length, 0);
  assert.equal(adapter.prepare(retry.world, [command("sound", 13)]).ok, false);
  const zero = unwrap(adapter.prepare(retry.world, [command("zero", 0)]));
  assert.equal(transportHostState(zero.world).requests.length, 1);
  const distinct = unwrap(adapter.prepare(zero.world, [command("distinct")]));
  assert.equal(transportHostState(distinct.world).requests.length, 2);
});

test("extraction requests and eligible ground occupancy fail explicitly and atomically", () => {
  const world = unwrap(initializeCampaignSession(sessionOptions())).world;
  const before = structuredClone(world);
  const result = requestCampaignResourceExtraction(world, { sourceSlot: 154, extractorSlot: 155 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.diagnostics[0].message, /deployment task 12.*depletion/);
  assert.deepEqual(world, before);
  const host = world.transportState as TransportHostState;
  host.slots[155] = { ...host.slots[154]!, slot: 155, unitType: 6, team: 0, resource: undefined };
  host.ground[5 * host.width + 6] = 155;
  const occupied = structuredClone(world);
  const stepped = stepTransportHost(world);
  assert.equal(stepped.ok, false);
  if (!stepped.ok) assert.match(stepped.diagnostics[0].message, /extraction.*unsupported/);
  assert.deepEqual(world, occupied);
});
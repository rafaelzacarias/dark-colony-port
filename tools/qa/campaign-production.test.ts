import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createLegacyProductionCatalog } from "../../src/engine/legacy-production";
import {
  allocateCampaignProductionUnit, createCampaignProduction, productionChoices, productionSnapshot, reduceCampaignProduction, reserveCampaignProductionExit,
  type CampaignProductionState, type ProductionAction, type ProductionTeamSeed, type ProductionUnitSource,
} from "../../src/engine/campaign-production";
import type { CampaignWorld } from "../../src/engine/campaign-world";
import { allocateTransportProductionExit, createTransportHostAdapter, initializeTransportHost, reserveTransportProductionExit,
  transportHostState } from "../../src/engine/transport-host";

const source = readFileSync(new URL("../../raw_cd/DC/GAMESTAT/DEPEND.TXT", import.meta.url), "ascii");
const lines = source.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("%"));
const records = lines.slice(1).map((line) => {
  const values = line.split(/\s+/).map(Number);
  const end = values[3] === 1 ? 5 : 7;
  assert.equal(values.at(-1), -1);
  return { id: values[0], cost: values[1], interfaceId: values[2], rawFields: values.slice(3, end), dependencies: values.slice(end, -1) };
});

test("production owns every DEPEND record, including IDs beyond the source header", () => {
  const catalog = createLegacyProductionCatalog(records);
  assert.equal(catalog.size, 80);
  assert.equal(catalog.get(83)?.cost, 900);
  assert.deepEqual(catalog.get(2)?.rawFields, [0, 3, 0, 0]);
  assert.deepEqual(catalog.get(16)?.rawFields, [0, 3, 0, 1]);
});

const nativeReport = JSON.parse(execFileSync("python3", ["-c", String.raw`
import hashlib, json, runpy, sys
from pathlib import Path
from unicorn import UC_HOOK_CODE, UC_HOOK_MEM_WRITE
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EDX, UC_X86_REG_EBX, UC_X86_REG_ECX, UC_X86_REG_ESP, UC_X86_REG_EIP
root = Path(sys.argv[1])
base = runpy.run_path(str(root / "tools/research/production-audit-20260919.py"))
image = (root / "raw_cd/DC/DC.EXE").read_bytes()
assert hashlib.sha256(image).hexdigest() == base["EXE_HASH"]
source, dependencies, tables = base["source_probe"](image)
results = []
for label, blocked, delay, population, ready, mode in (
    ("blocked", True, 0, 0, 1, 2), ("delay", False, 2, 0, 1, 2),
    ("cap", False, 0, 10, 1, 2), ("start", False, 0, 9, 1, 2),
    ("animating", False, 0, 9, 0, 1), ("completed", False, 0, 9, 0, 2)):
    native = base["Native"](image)
    game = base["GAME"]
    team = game + 0xb98 + 0xe30
    entity = game + 0x7d28 + 16 * 220
    native.emulator.mem_write(0x4e6d70, dependencies)
    native.emulator.mem_map(0xc00000, 0x100000)
    native.put(game + 0x46f2c, 0xc00000)
    native.put(0xc9a4b0, 128)
    native.put(0xc9a4b4, 128)
    native.put(0xc00804 + 47 * 4, 0xcc0000)
    cell = 0xcc0000 + 50 * 4
    native.put(cell, 152 if blocked else 1023)
    native.put(game + 0x7d28 + 152 * 220 + 0x35, 99, 1)
    native.put(entity + 6, 17, 1)
    native.put(entity + 7, 1, 1)
    native.put(entity + 0x1a, 1, 1)
    native.put(entity + 0x2a, mode, 1)
    native.put(team + 0x14, 777)
    native.put(team + 0x18, 800)
    native.put(team + 0x2c, 50)
    native.put(team + 0x30, 50)
    native.put(team + 0x108, ready, 1)
    native.put(team + 0x10c, delay, 1)
    native.put(team + 0x110, 2, 2)
    native.emulator.mem_write(team + 0x118, bytes([0, 43, 0]))
    native.put(game + 0x528, 10)
    native.put(0x4f1970, 0)
    native.put(0x4f18e0, 0, 1)
    native.put(0x4f1918, 0x703000)
    spawns = []
    def spawn(machine):
        emulator = machine.emulator
        spawns.append([emulator.reg_read(UC_X86_REG_ECX), emulator.reg_read(UC_X86_REG_EDX), emulator.reg_read(UC_X86_REG_EBX), machine.get(emulator.reg_read(UC_X86_REG_ESP) + 4)])
    def copy(machine):
        emulator = machine.emulator
        emulator.mem_write(emulator.reg_read(UC_X86_REG_EAX), bytes(emulator.mem_read(emulator.reg_read(UC_X86_REG_EDX), emulator.reg_read(UC_X86_REG_EBX))))
    native.stubs = {0x41a538: lambda machine: machine.emulator.reg_write(UC_X86_REG_EAX, population), 0x41b750: spawn, 0x43afde: copy}
    native.stub_cleanup = {0x41b750: 8}
    native.run(0x414314, {UC_X86_REG_EAX: game, UC_X86_REG_EDX: 16, UC_X86_REG_EBX: entity})
    results.append(dict(label=label, count=native.get(team+0x110,2), head=native.get(team+0x118,1), ready=native.get(team+0x108,1), delay=native.get(team+0x10c,1), credits=native.get(team+0x14), accounting=native.get(team+0x18), message=native.get(team+0xe2c,2), exit=native.get(cell)&1023, blockerFlag=native.get(game+0x7d28+152*220+0x35,1), spawns=spawns))
for unit in tables["sourceUnitQueues"]:
  native = base["Native"](image)
  address = 0x41add0 + unit["queue"] * 24 + unit["exitSelector"] * 8
  def signed(value):
    return value if value < 0x80000000 else value - 0x100000000
  unit["exitOffset"] = dict(x=signed(native.get(address)), y=signed(native.get(address+4)))
lifecycle = runpy.run_path(str(root / "tools/research/construction-lifecycle-20260919.py"))
construction = []
for race in (0, 1):
  result = lifecycle["lifecycle"](image, 4, race, {"kind": "queued-order", "phase": 2})
  assert result["accepted"], result.get("blocker")
  phases = []
  last = None
  for entry in result["trace"]:
    phase = entry["main"]["phase"]
    if phase != last:
      phases.append([entry["update"], phase, entry["busy"], entry["latch"]])
      last = phase
  construction.append(dict(race=race, phases=phases, final=result["trace"][-1], interceptions=result["lifecycleInterceptedCalls"]))
native = lifecycle["source_fixture"](image)
profile = lifecycle["load_fin"](native, tuple(unit["unitType"] for unit in tables["sourceUnitQueues"]))
assert all(binding["constructionBank"] for binding in profile["bindings"]), "unit without production animation needs a direct-spawn callback"
binding = next(binding for binding in profile["bindings"] if binding["unitType"] == 0)
assert binding["constructionBank"], "trooper production bank absent"
game = base["GAME"]
team = game + 0xb98 + 0xe30
entity = game + 0x7d28 + 16 * 220
native.emulator.mem_map(0xc00000, 0x100000)
native.put(game+0x46f2c, 0xc00000)
native.put(0xc9a4b0, 128)
native.put(0xc9a4b4, 128)
native.put(0xc00804 + 47*4, 0xcc0000)
native.put(0xcc0000 + 50*4, 1023)
native.put(entity+6, 17, 1)
native.put(entity+7, 1, 1)
native.put(entity+0x1a, 1, 1)
native.put(team+0x2c, 50)
native.put(team+0x30, 50)
native.put(team+0x108, 1, 1)
native.put(team+0x110, 1, 2)
native.put(team+0x118, 0, 1)
native.put(game+0x528, 10)
spawns = []
native.stubs.update({0x41a538: lambda machine: machine.emulator.reg_write(UC_X86_REG_EAX, 0), 0x41b750: spawn, 0x43afde: copy})
native.stub_cleanup[0x41b750] = 8
native.run(0x414314, {UC_X86_REG_EAX: game, UC_X86_REG_EDX: 16, UC_X86_REG_EBX: entity})
assert native.get(team+0x108,1) == 0 and native.get(entity+0x24) == binding["constructionBank"]
steps = 0
while native.get(team+0x110,2):
  steps += 1
  assert steps < 2000
  native.run(0x4264c8, {UC_X86_REG_EAX: entity+0x24, UC_X86_REG_EDX: 0})
  native.run(0x414314, {UC_X86_REG_EAX: game, UC_X86_REG_EDX: 16, UC_X86_REG_EBX: entity})
assert len(spawns) == 1 and native.get(team+0x108,1) == 1
real_unit = dict(steps=steps, profile=binding["constructionState"], spawns=spawns, mode=native.get(entity+0x2a,1))
eligibility_cases = []
for race in (0,1):
  native = base["Native"](image)
  native.emulator.mem_write(0x4e6d70, dependencies)
  native.put(game+0x7d1c, 1)
  native.put(team+0x20, race)
  for slot in range(5):
    native.put(team+0x3c+slot*4, 2400)
    native.put(team+0xc4+slot*4, 1)
  for dependency in (7,9,30,83):
    native.put(team+0xda4+dependency, 1, 1)
  native.put(0x4f18b0+8*280+1, 1, 1)
  native.run(0x437bc4, {UC_X86_REG_EAX: game})
  eligibility_cases.append({str(row["id"]):native.get(0x4e6d74+row["id"]*52) for row in source["dependencies"]})
direct_spawns = []
for sentinel in (1023, 1022):
  native = lifecycle["source_fixture"](image)
  lifecycle["load_fin"](native, (0,))
  native.emulator.mem_map(0xc00000, 0x200000)
  native.put(game+0x46f2c, 0xc00000)
  native.put(0xc9a4b0, 128)
  native.put(0xc9a4b4, 128)
  native.put(game+0x544, 0xd00000)
  lifecycle["populate_footprint"](native, 1, 3)
  native.emulator.mem_write(game+0x468ec, b"\xff\xff" * 800)
  native.put(game+0x7d20, 152)
  cell = 0xc10000 + 47*512 + 50*4
  native.put(cell, sentinel)
  writes, entries = [], []
  def write_exit(emulator, access, address, size, value, user_data):
    if address == cell:
      writes.append(dict(pc=emulator.reg_read(UC_X86_REG_EIP), before=native.get(cell)&1023, after=value&1023))
  def constructor_entry(emulator, address, size, user_data):
    if address in (0x41b750, 0x41af14):
      entries.append(address)
  native.emulator.hook_add(UC_HOOK_MEM_WRITE, write_exit)
  native.emulator.hook_add(UC_HOOK_CODE, constructor_entry)
  native.put(base["STACK"]+4, 1)
  native.put(base["STACK"]+8, 0xffffffff)
  call_start = len(native.calls)
  native.run(0x41b750, {UC_X86_REG_EAX:game, UC_X86_REG_EDX:50, UC_X86_REG_EBX:47, UC_X86_REG_ECX:0})
  allocated = native.emulator.reg_read(UC_X86_REG_EAX)
  entity = game+0x7d28+allocated*220
  direct_spawns.append(dict(sentinel=sentinel, slot=allocated, exit=native.get(cell)&1023,
    x=native.get(entity,2)//256, y=native.get(entity+4,2)//256,
    unitType=native.get(entity+6,1), team=native.get(entity+7,1),
    registry=native.get(game+0x468ec+allocated*2,2), highWater=native.get(game+0x7d20),
    writes=writes, entries=entries, interceptions=native.calls[call_start:]))
print(json.dumps(dict(boundaries=results, eligibility=base["eligibility_probes"](image,dependencies), eligibilityCases=eligibility_cases, tables=tables, construction=construction, realUnit=real_unit, directSpawns=direct_spawns)))
`, fileURLToPath(new URL("../../", import.meta.url))], {
  encoding: "utf8",
  env: { ...process.env, PYTHONPATH: [process.env.PYTHONPATH, "/tmp/dc-re-capstone-20260918", "/tmp/dc-trigger-unicorn-20260918"].filter(Boolean).join(":") },
  maxBuffer: 4 * 1024 * 1024,
}));

const unitSources: ProductionUnitSource[] = nativeReport.tables.sourceUnitQueues;

function seed(team = 1, race: 0 | 1 = 0, credits = 10000): ProductionTeamSeed {
  return { team, race, credits, costAccumulator: 0, base: { x: 50, y: 50 }, restrictions: [], upgrades: [],
    slots: [4800, 2000, 0, 0, 0].map((health) => ({ health, level: 0, busy: 0 })) };
}

function initial(teams: ProductionTeamSeed[] = [seed()], limit = 50): CampaignProductionState {
  return createCampaignProduction({ sessionId: "production-test", records, units: unitSources, teams, queueSafetyLimit: limit });
}

function act(state: CampaignProductionState, action: ProductionAction, id = `event:${state.journal.length}`, team = 1): CampaignProductionState {
  return reduceCampaignProduction(state, { id, team, action });
}

function queued(): CampaignProductionState {
  return act(act(initial(), { type: "reserve", dependency: 9 }), { type: "dispatch", dependency: 9 });
}

function completion(): CampaignProductionState {
  let state = queued();
  const ticket = state.teams[0].queues[0].items[0].ticket;
  state = act(state, { type: "producer-started", queue: 0, ticket });
  return act(state, { type: "producer-completed", queue: 0, ticket, animationMode: nativeReport.realUnit.mode });
}

function world(options: { blocked?: boolean; fifo?: boolean; highWater?: number } = {}): CampaignWorld {
  const source: CampaignWorld = { sessionId: "production-test", source: { id: "test", teams: [{ index: 1 }], placementRows: [] },
    placementState: { firstSlot: 152, nextSlot: 152, highWater: 152, renatSources: [], renatBytes: new Uint8Array(1000) },
    entities: [], buildingSlots: {}, entityBytes: new Uint8Array(800 * 220), typeMovementClasses: null,
    commanderSlots: {}, messageTexts: {}, messages: [], exomoney: {}, statistics: {}, clockMilliseconds: 0, transportState: null };
  const initialized = initializeTransportHost(source, { width: 64, height: 64, groundEligible: Array(4096).fill(!options.blocked),
    definitions: [{ unitType: 0, health: 800, movementSpeed: 64, plane: "ground" }], highWater: options.highWater ?? 152,
    sides: Array(8).fill(0), directionBits: [], fixedStepMilliseconds: 20, orientationSteps: 2,
    fifos: options.fifo ? [{ tile: { x: 50, y: 47 }, types: [] }] : [] });
  assert.ok(initialized.ok);
  return initialized.value;
}

test("native producer blocks exits, decrements delay, refunds cap and spawns before FIFO pop", () => {
  const [blocked, delayed, capped, started, animating, completed] = nativeReport.boundaries;
  assert.deepEqual([blocked.count, blocked.head, blocked.blockerFlag, blocked.spawns.length], [2, 0, 0, 0]);
  assert.deepEqual([delayed.count, delayed.delay, delayed.spawns.length], [2, 1, 0]);
  assert.deepEqual([capped.count, capped.head, capped.credits, capped.accounting, capped.message], [1, 43, 1127, 450, 119]);
  assert.deepEqual([started.count, started.ready, started.exit], [2, 0, 1022]);
  assert.deepEqual([animating.count, animating.ready, animating.spawns.length], [2, 0, 0]);
  assert.deepEqual([completed.count, completed.head, completed.ready, completed.credits, completed.accounting], [1, 43, 1, 777, 800]);
  assert.deepEqual(completed.spawns, [[0, 50, 47, 1]]);
});

test("native 41b750 constructor replaces the reserved exit in place without a spawn interception", () => {
  for (const result of nativeReport.directSpawns) {
    assert.deepEqual([result.slot, result.exit, result.x, result.y, result.unitType, result.team, result.registry, result.highWater],
      [152, 152, 50, 47, 0, 1, 152, 153]);
    assert.deepEqual(result.entries, [0x41b750, 0x41af14]);
    assert.deepEqual(result.interceptions, []);
    assert.deepEqual(result.writes, [
      { pc: 0x41b444, before: result.sentinel, after: 0 },
      { pc: 0x41b45c, before: 0, after: 152 },
    ]);
  }
});

test("reservation charges once, pending removal refunds only pending, teams and FIFO safety limits are independent", () => {
  let state = initial([seed(), seed(2)], 2);
  const before = JSON.stringify(state);
  state = act(state, { type: "reserve", dependency: 9 });
  assert.deepEqual(state.teams.map((team) => team.credits), [9650, 10000]);
  assert.equal(state.teams[0].costAccumulator, 0);
  state = act(state, { type: "release-pending", dependency: 9 });
  assert.equal(state.teams[0].credits, 10000);
  state = act(act(state, { type: "reserve", dependency: 9 }), { type: "reserve", dependency: 9 });
  assert.throws(() => act(state, { type: "reserve", dependency: 9 }), /safety limit/);
  state = act(state, { type: "dispatch", dependency: 9 });
  assert.equal(state.teams[0].credits, 9300);
  assert.equal(state.teams[0].costAccumulator, 700);
  assert.equal(state.teams[0].queues[0].items.length, 2);
  assert.equal(state.teams[0].queues.length, 4);
  assert.throws(() => act(state, { type: "release-pending", dependency: 9 }), /active cancellation/);
  assert.throws(() => act(state, { type: "reserve", dependency: 9 }), /safety limit/);
  assert.equal(JSON.stringify(initial([seed(), seed(2)], 2)), before);
  assert.throws(() => act(initial([seed(1, 0, 349)]), { type: "reserve", dependency: 9 }), /underflow/);
});

test("native pending UI limit is 50; committed plus reserved entries share the explicit adapter bound", () => {
  let state = initial([seed(1, 0, 100000)]);
  for (let count = 0; count < 50; count += 1) state = act(state, { type: "reserve", dependency: 9 });
  assert.equal(state.teams[0].pending[9], 50);
  assert.throws(() => act(state, { type: "reserve", dependency: 9 }), /pending limit/);
  state = act(state, { type: "dispatch", dependency: 9 });
  assert.throws(() => act(state, { type: "reserve", dependency: 9 }), /safety limit/);
});

test("bounded action choices track credits, pending and committed occupancy without advertising unsupported construction", () => {
  let state = initial([seed(1, 0, 10000)], 2);
  assert.equal(productionChoices(state, 1).find((entry) => entry.dependency === 9)?.maxAdditional, 2);
  assert.equal(productionChoices(state, 1).find((entry) => entry.dependency === 14)?.supported, false);
  state = act(state, { type: "reserve", dependency: 9 });
  assert.deepEqual(productionChoices(state, 1).find((entry) => entry.dependency === 9), {
    dependency: 9, interfaceId: 89, kind: "unit", nativeState: 1, supported: true, pending: 1, queued: 0,
    maxAdditional: 1, canDispatch: true, canReleasePending: true,
  });
  state = act(state, { type: "dispatch", dependency: 9 });
  assert.equal(productionChoices(state, 1).find((entry) => entry.dependency === 9)?.queued, 1);
  assert.equal(productionChoices(initial([seed(1, 0, 349)]), 1).find((entry) => entry.dependency === 9)?.maxAdditional, 0);
});

test("source queue selectors route four typed FIFOs independently; every current native eligibility state matches x86", () => {
  for (const race of [0, 1] as const) {
    const team = { ...seed(1, race), slots: Array.from({ length: 5 }, () => ({ health: 2400, level: 1, busy: 0 as const })),
      restrictions: [7, 9, 30, 83], upgrades: [{ unitType: 8, weapon: 1, armor: 0 }] };
    assert.deepEqual(initial([team]).teams[0].eligibility, nativeReport.eligibilityCases[race]);
  }
  let state = initial([{ ...seed(), slots: Array.from({ length: 5 }, () => ({ health: 2400, level: 1, busy: 0 as const })) }]);
  for (const dependency of [9, 8, 7, 13, 29]) {
    state = act(act(state, { type: "reserve", dependency }), { type: "dispatch", dependency });
  }
  assert.deepEqual(state.teams[0].queues.map((queue) => queue.items.map((item) => item.unitType)), [[0, 43], [1], [6], [4]]);
  const head = state.teams[0].queues[0].items[0];
  state = act(state, { type: "producer-cap-refund", queue: 0, ticket: head.ticket });
  assert.deepEqual(state.teams[0].queues[0].items.map((item) => [item.unitType, item.cost]), [[43, 450]]);
});

test("actual trooper FIN completion requests exact allocation; no wall-clock countdown or early FIFO pop", () => {
  assert.equal(nativeReport.realUnit.mode, 2);
  assert.ok(nativeReport.realUnit.steps > 1);
  assert.ok(nativeReport.realUnit.profile.source.endsWith(".FIN"));
  assert.deepEqual(nativeReport.realUnit.spawns, [[0, 50, 47, 1]]);
  const ready = completion();
  assert.equal(ready.teams[0].queues[0].items.length, 1);
  assert.equal(ready.teams[0].queues[0].ready, 0);
  const before = world();
  const result = allocateCampaignProductionUnit(ready, before, 1, 0);
  assert.equal(before.entities.length, 0);
  assert.deepEqual(result.world.entities.map((entity) => [entity.rawSlot, entity.team, entity.unitType, entity.tileX, entity.tileY, entity.health]), [[152, 1, 0, 50, 47, 800]]);
  assert.equal(transportHostState(result.world).ground[47 * 64 + 50], 152);
  assert.equal(result.production.teams[0].queues[0].items.length, 0);
  assert.equal(result.production.teams[0].queues[0].ready, 1);
  assert.equal(result.production.teams[0].credits, 9650);
  assert.equal(result.production.teams[0].costAccumulator, 350);
  assert.throws(() => allocateCampaignProductionUnit(result.production, result.world, 1, 0), /No native completion/);
});

test("owned native exit reservation becomes slot 152 exactly once without searching", () => {
  const state = completion();
  const reserved = reserveCampaignProductionExit(state, world(), 1, 0);
  assert.equal(transportHostState(reserved).ground[47 * 64 + 50], 1022);
  const result = allocateCampaignProductionUnit(state, reserved, 1, 0);
  const host = transportHostState(result.world);
  assert.deepEqual(result.world.entities.map((entity) => [entity.rawSlot, entity.generation, entity.team, entity.unitType, entity.tileX, entity.tileY]),
    [[152, 0, 1, 0, 50, 47]]);
  assert.equal(host.ground[47 * 64 + 50], 152);
  assert.equal(host.ground.includes(1022), false);
  assert.equal(host.registry[152], host.slots[152]!.key);
  assert.deepEqual(host.productionExits, []);
  assert.equal(host.requests.filter((request) => request.type === "create").length, 1);
  assert.equal(result.production.teams[0].queues[0].items.length, 0);
  assert.equal(result.production.requests.filter((request) => request.type === "unit-allocated").length, 1);
  assert.throws(() => allocateCampaignProductionUnit(result.production, result.world, 1, 0), /No native completion/);
  assert.equal(transportHostState(reserved).ground[47 * 64 + 50], 1022);
});

test("reservation ownership rejects shared-coordinate team, queue, ticket and type conflicts", () => {
  const production = completion();
  const reserved = reserveCampaignProductionExit(production, world(), 1, 0);
  const reservation = transportHostState(reserved).productionExits![0];
  assert.deepEqual(reservation, { key: JSON.stringify([production.sessionId, 1, 0, reservation.ticket]),
    team: 1, queue: 0, ticket: reservation.ticket, unitType: 0, tile: { x: 50, y: 47 } });
  assert.deepEqual(reserveCampaignProductionExit(production, reserved, 1, 0), reserved);
  for (const change of [{ team: 2 }, { queue: 1 as const }, { ticket: "other-head" }, { unitType: 1 }]) {
    const request = { ...reservation, ...change };
    request.key = JSON.stringify([production.sessionId, request.team, request.queue, request.ticket]);
    const host = transportHostState(reserved);
    host.definitions.push({ unitType: 1, health: 800, movementSpeed: 64, plane: "ground" });
    const input = { ...reserved, transportState: host };
    const before = structuredClone(input);
    assert.equal(reserveTransportProductionExit(input, request).ok, false);
    assert.equal(allocateTransportProductionExit(input, request).ok, false);
    assert.deepEqual(input, before);
  }
  const otherTeam = act(act(initial([seed(2)]), { type: "reserve", dependency: 9 }, "reserve-team2", 2),
    { type: "dispatch", dependency: 9 }, "dispatch-team2", 2);
  const ticket = otherTeam.teams[0].queues[0].items[0].ticket;
  const started = act(otherTeam, { type: "producer-started", queue: 0, ticket }, "start-team2", 2);
  const completed = act(started, { type: "producer-completed", queue: 0, ticket, animationMode: 2 }, "complete-team2", 2);
  assert.throws(() => reserveCampaignProductionExit(started, reserved, 2, 0), /owned by another queue/);
  assert.throws(() => allocateCampaignProductionUnit(completed, reserved, 2, 0), /owned by another queue/);
});

test("production fails atomically on an occupied, unowned, out-of-map or ineligible exact exit", () => {
  const production = completion();
  for (const scenario of ["occupied", "unowned", "outside", "ineligible", "stale-owner"] as const) {
    const input = scenario === "occupied" ? allocateCampaignProductionUnit(production, world(), 1, 0).world : world();
    const host = transportHostState(input);
    if (scenario === "unowned") host.ground[47 * 64 + 50] = 1022;
    if (scenario === "outside") host.width = 50;
    if (scenario === "ineligible") host.groundEligible[47 * 64 + 50] = false;
    if (scenario === "stale-owner") host.productionExits = transportHostState(reserveCampaignProductionExit(production, world(), 1, 0)).productionExits;
    const candidate = { ...input, transportState: host };
    const before = structuredClone(candidate);
    const beforeProduction = JSON.stringify(production);
    assert.throws(() => allocateCampaignProductionUnit(production, candidate, 1, 0), /production exit/);
    assert.deepEqual(candidate, before);
    assert.equal(JSON.stringify(production), beforeProduction);
  }
});

test("exact allocator uses the intended movement plane and source type", () => {
  const production = completion();
  const input = world({ blocked: true });
  const host = transportHostState(input);
  host.definitions[0] = { ...host.definitions[0], plane: "flying" };
  host.ground[47 * 64 + 50] = 17;
  const reserved = reserveCampaignProductionExit(production, { ...input, transportState: host }, 1, 0);
  const result = allocateCampaignProductionUnit(production, reserved, 1, 0);
  const after = transportHostState(result.world);
  assert.equal(after.ground[47 * 64 + 50], 17);
  assert.equal(after.flying[47 * 64 + 50], 152);
  const altered = structuredClone(production);
  const allocation = altered.teams[0].queues[0].allocation!;
  Object.assign(allocation, { unitType: 1 });
  assert.throws(() => allocateCampaignProductionUnit(altered, reserved, 1, 0), /allocation\/source mismatch/);
});

test("exact allocation reuses generations and rolls back a reserved exit at the allocator cap", () => {
  const production = completion();
  const first = allocateCampaignProductionUnit(production, world(), 1, 0).world;
  const host = transportHostState(first);
  host.slots[152]!.status = 0;
  host.registry[152] = null;
  host.ground[47 * 64 + 50] = -1;
  const reserved = reserveCampaignProductionExit(production, { ...first, transportState: host }, 1, 0);
  const reused = allocateCampaignProductionUnit(production, reserved, 1, 0);
  const after = transportHostState(reused.world);
  assert.deepEqual([after.highWater, after.generations[152], after.registry[152], reused.world.entities.length], [153, 1, "transport:152:1", 1]);
  const full = transportHostState(reserved);
  full.highWater = 799;
  for (let slot = 152; slot < 799; slot += 1) {
    full.slots[slot] = { ...host.slots[152]!, slot, key: `full:${slot}`, status: 1 };
    full.registry[slot] = `full:${slot}`;
  }
  const capped = { ...reserved, transportState: full };
  const before = structuredClone(capped);
  const beforeProduction = JSON.stringify(production);
  assert.throws(() => allocateCampaignProductionUnit(production, capped, 1, 0), /high-water assertion/);
  assert.deepEqual(capped, before);
  assert.equal(JSON.stringify(production), beforeProduction);
  assert.equal(full.ground[47 * 64 + 50], 1022);
});

test("reinforce2 still searches around a production sentinel without consuming its ownership", () => {
  const reserved = reserveCampaignProductionExit(completion(), world(), 1, 0);
  const result = createTransportHostAdapter().prepare(reserved, { id: "reinforcement", triggerId: 1, actionIndex: 0,
    action: { name: "reinforce2", arguments: [] }, command: { kind: "reinforce2", team: 1, tileX: 50, tileY: 47, groups: [{ unitType: 0, count: 1 }] } });
  assert.ok(result.ok);
  assert.deepEqual(result.value.world.entities.map((entity) => [entity.tileX, entity.tileY]), [[49, 46]]);
  const host = transportHostState(result.value.world);
  assert.equal(host.ground[47 * 64 + 50], 1022);
  assert.deepEqual(host.productionExits, transportHostState(reserved).productionExits);
});

test("failed allocation is atomic and does not refund or lose the queue head", () => {
  const state = completion();
  for (const host of [world({ blocked: true }), world({ fifo: true })]) {
    const beforeState = JSON.stringify(state);
    const beforeHost = structuredClone(host);
    assert.throws(() => allocateCampaignProductionUnit(state, host, 1, 0), /ineligible production exit|coordinate reinforcement/);
    assert.equal(JSON.stringify(state), beforeState);
    assert.deepEqual(host, beforeHost);
  }
  const result = allocateCampaignProductionUnit(state, world(), 1, 0);
  assert.equal(result.production.teams[0].queues[0].items.length, 0);
});

test("cap callback refunds exactly the native head cost, unlike successful completion", () => {
  let state = queued();
  const ticket = state.teams[0].queues[0].items[0].ticket;
  state = act(state, { type: "producer-cap-refund", queue: 0, ticket });
  assert.deepEqual([state.teams[0].credits, state.teams[0].costAccumulator, state.teams[0].queues[0].items.length], [10000, 0, 0]);
  assert.equal(state.requests.at(-1)?.type, "population-message");
  assert.throws(() => act(state, { type: "producer-cap-refund", queue: 0, ticket }), /Empty/);
});

test("native construction traces drive separate busy and latch transitions for both source FINs", () => {
  for (const race of [0, 1] as const) {
    const native = nativeReport.construction[race];
    assert.equal(native.final.update, race === 0 ? 186 : 246);
    assert.deepEqual(native.interceptions, []);
    let state = initial([seed(1, race)]);
    const dependency = race === 0 ? 2 : 16;
    state = act(act(state, { type: "reserve", dependency }), { type: "dispatch", dependency }, "science");
    assert.equal(state.teams[0].slots[3].health, 2400);
    assert.equal(state.teams[0].eligibility[dependency], 0);
    assert.equal(state.teams[0].eligibility[race === 0 ? 29 : 28], 2);
    assert.throws(() => act(state, { type: "release-pending", dependency }), /not eligible/);
    const transitions = ["arrival-created", "build-started", "build-finished", "departure-finished", "released"] as const;
    for (let index = 0; index < transitions.length; index += 1) {
      state = act(state, { type: "construction", constructionId: "science", nativeId: 18, transition: transitions[index] });
      const row = native.phases[index + 1];
      assert.equal(state.teams[0].construction?.phase ?? null, row[1]);
      assert.equal(state.teams[0].slots[3].busy, row[2]);
      assert.equal(state.teams[0].latch, row[3]);
      if (index === 2) {
        assert.equal(state.teams[0].latch, 1);
        const engineer = race === 0 ? 29 : 28;
        assert.equal(state.teams[0].eligibility[engineer], 1);
        const ordered = act(act(state, { type: "reserve", dependency: engineer }), { type: "dispatch", dependency: engineer });
        assert.deepEqual(ordered.teams[0].queues[0].items.map((item) => item.unitType), [race === 0 ? 43 : 44]);
        assert.deepEqual([ordered.teams[0].credits, ordered.teams[0].costAccumulator, ordered.teams[0].latch], [7550, 2450, 1]);
      }
    }
    assert.equal(native.final.main.pendingOrder, 0);
    assert.equal(native.final.main.order, 255);
    assert.equal(state.teams[0].credits, 8000);
    assert.equal(state.teams[0].costAccumulator, 2000);
  }
});

test("upgrades use source metadata and immediate receiver accounting, prerequisites and restrictions stay live", () => {
  const alien = seed(1, 1);
  let state = initial([{ ...alien, slots: alien.slots.map((slot, index) => index === 3 ? { ...slot, health: 2400 } : slot) }]);
  assert.equal(state.teams[0].eligibility[30], 1);
  state = act(act(state, { type: "reserve", dependency: 30 }), { type: "dispatch", dependency: 30 });
  assert.deepEqual(state.teams[0].upgrades, [{ unitType: 8, weapon: 1, armor: 0 }]);
  assert.equal(state.teams[0].eligibility[30], 0);
  assert.equal(state.teams[0].eligibility[31], 2);
  assert.deepEqual([state.teams[0].credits, state.teams[0].costAccumulator], [9000, 1000]);
  assert.throws(() => act(state, { type: "reserve", dependency: 31 }), /not eligible/);
  assert.equal(initial([{ ...seed(), restrictions: [9] }]).teams[0].eligibility[9], 2);
  assert.throws(() => act(initial(), { type: "reserve", dependency: 3 }), /not eligible/);
  assert.throws(() => act(initial(), { type: "reserve", dependency: 14 }), /Only the source-proven/);
});

test("factory snapshots, command retries, stale callbacks and JSON replay do not alias mutable inputs", () => {
  const input = structuredClone({ records, units: unitSources, teams: [seed()] });
  const state = createCampaignProduction({ sessionId: "production-test", ...input });
  input.records[0].cost = 1;
  input.teams[0] = seed(1, 0, 0);
  input.units[0] = { ...input.units[0], queue: 3 };
  assert.equal(state.catalog[0].cost, 2000);
  assert.equal(state.teams[0].credits, 10000);
  assert.ok(Object.isFrozen(state.teams[0].queues[0].items));
  const completed = completion();
  let replay = productionSnapshot(JSON.parse(JSON.stringify(initial())));
  for (const event of completed.journal) replay = reduceCampaignProduction(replay, event);
  assert.deepEqual(replay, completed);
  assert.deepEqual(reduceCampaignProduction(replay, replay.journal.at(-1)!), replay);
  assert.throws(() => act(replay, { type: "reserve", dependency: 7 }, replay.journal[0].id), /reused/);
  assert.throws(() => act(queued(), { type: "producer-completed", queue: 0, ticket: queued().teams[0].queues[0].items[0].ticket, animationMode: 2 }), /No matching/);
  assert.throws(() => act(queued(), { type: "producer-started", queue: 0, ticket: "stale" }), /Stale/);
});
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { campaignResourceFrame } from "../../src/engine/campaign-resource-frame.ts";
import { createCampaignWorld } from "../../src/engine/campaign-world.ts";
import { projectLegacyColony } from "../../src/engine/legacy-colony.ts";
import { sourceDayNightFromHeader } from "../../src/engine/source-day-night.ts";
import { bindCampaignResourceTask, configureCampaignResourceLifecycle, initializeTransportHost,
  stepTransportHost, transportHostState, type ResourceHostBinding, type ResourceHostOptions } from "../../src/engine/transport-host.ts";
import type { TriggerResult } from "../../src/engine/trigger-runtime.ts";
import { createCueCatalog } from "../../src/audio/cues.ts";
import { parseScenario } from "../extractors/data/scenario.ts";
import { parseUnitStats } from "../extractors/data/tables.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url), "utf8");
const units = parseUnitStats(read("GAMESTAT/GAMESTAT.TXT"));
const originalHuman02 = parseScenario(read("SCENARIO/HUMAN/HUMAN02.SCN"));
const originalAlien02 = parseScenario(read("SCENARIO/ALIEN/ALIEN02.SCN"));

function unwrap<Value>(result: TriggerResult<Value>): Value {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("Expected supported resource frame");
  return result.value;
}

const nativeEnvironment = { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" };
const nativeInputs = JSON.parse(execFileSync("python3", ["-c", String.raw`
import json, runpy
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_EBP, UC_X86_REG_EDI
probe = runpy.run_path("tools/research/resource-init-20260919.py")
native = probe["NATIVE"]
machine = probe["fixture"]()
put, get, execute = probe["put"], probe["get"], probe["execute"]
percentages = [100, 125, 150, 200, 0, 75, -100, 8388608]
put(machine, native.FRAME + 0x76, native.GAME)
put(machine, native.FRAME + 0x7a, 0x708000)
for team, percent in enumerate(percentages):
    put(machine, 0x708000 + 0x14c4 + team * 4, percent, "i")
execute(machine, 0x40177e, 0x4017ba)
multipliers = [get(machine, native.GAME + 0x19b8 + team * 0xe30, "i") for team in range(8)]
gates = []
for serialized in (0, 1, -1):
    put(machine, native.FRAME - 0x132, serialized, "i")
    machine.reg_write(UC_X86_REG_EDI, native.GAME)
    execute(machine, 0x40d984, 0x40d99f)
    gates.append(get(machine, native.GAME + 0x948, "B"))
row = next(line for line in (native.ROOT / "raw_cd/DC/SOUND/SLIST.DAT").read_text().splitlines() if line.split()[:2] == ["1", "XTR"])
category, group, *sounds = row.split()
machine.mem_write(0x708800, (" " + group + " " + " ".join(sounds)).encode() + b"\0")
put(machine, native.FRAME - 0x24, 0x708800)
put(machine, native.FRAME - 4, int(category))
execute(machine, 0x431237, 0x4314ee)
table = 0x4cbc54 + int(category) * 104 + 7 * 13
record = list(machine.mem_read(table, 13))
put(machine, 0x47963d, 1, "B")
put(machine, 0x47963c, 0, "B")
put(machine, 0x4f98d4, 200)
put(machine, 0x4d1994, 0x708000)
put(machine, 0x708008, 0x708100)
from unicorn.x86_const import UC_X86_REG_EDX, UC_X86_REG_EBX, UC_X86_REG_ECX, UC_X86_REG_ESP
for register, value in ((UC_X86_REG_EAX, 1), (UC_X86_REG_EDX, 7), (UC_X86_REG_EBX, 0), (UC_X86_REG_ECX, 0), (UC_X86_REG_ESP, native.STACK)):
    machine.reg_write(register, value)
put(machine, native.STACK + 4, 0)
execute(machine, 0x431bf4, 0x431d77)
print(json.dumps({"multipliers": multipliers, "gates": gates, "soundRecord": record, "soundId": machine.reg_read(UC_X86_REG_EAX)}))
`], { cwd: root, encoding: "utf8", env: nativeEnvironment })) as {
  multipliers: number[]; gates: number[]; soundRecord: number[]; soundId: number;
};

interface NativeEntity {
  direction: number; pendingOrder: number; order: number; taskWords: number[]; hp: number; type: number;
  animation: { bank: number; frame: number; delay: number; mode: 0 | 1 | 2 | 3 };
}
interface NativeCase {
  race: number; runtimeInterceptions: string[];
  animations: ResourceHostOptions["animations"];
  profiles: { sources: { source: string; sha256: string }[]; bindings: {
    unitType: number; standBank: number; deployBank: number; deathBank: number;
    deathVariants: number; removalHoldField: number; selectedWeapon: number;
  }[] };
  trace: { source: NativeEntity; extractor: NativeEntity }[];
}
const nativeTrace = JSON.parse(process.env.DC_RESOURCE_LIFECYCLE_TRACE
  ? readFileSync(process.env.DC_RESOURCE_LIFECYCLE_TRACE, "utf8")
  : execFileSync("python3", ["tools/research/resource-lifecycle-20260919.py"], {
    cwd: root, encoding: "utf8", env: nativeEnvironment, maxBuffer: 32 * 1024 * 1024,
  })) as { sha256: string; sourceHashes: Record<string, string>; cases: NativeCase[] };

test("native startup percentages, serialized cancellation gate and category1/event7 source sound", () => {
  assert.deepEqual(nativeInputs.multipliers, [256, 320, 384, 512, 0, 192, -256, -21474836]);
  assert.deepEqual(nativeInputs.gates, [0, 1, 1]);
  assert.equal(nativeInputs.soundRecord[0], 1);
  assert.equal(nativeInputs.soundRecord[1], 0);
  assert.equal(nativeInputs.soundId, 183);
  const catalog = createCueCatalog(read("SOUND/SOUND2.DAT"), read("SOUND/SLIST.DAT"));
  assert.deepEqual(catalog.bindings.find(({ id, group }) => id === 1 && group === "XTR")!.soundIds, [183]);
  assert.equal(catalog.sounds.find(({ id }) => id === nativeInputs.soundId)!.source, "SOUND/ERUPT.WAV");
});

test("original executable, mission data and FIN profiles are fingerprinted", () => {
  const digest = (path: string) => createHash("sha256").update(readFileSync(new URL(`../../${path}`, import.meta.url))).digest("hex");
  assert.equal(nativeTrace.sha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  assert.equal(digest("raw_cd/DC/DC.EXE"), nativeTrace.sha256);
  for (const [path, hash] of Object.entries(nativeTrace.sourceHashes)) assert.equal(digest(`raw_cd/DC/${path}`), hash);
  for (const native of nativeTrace.cases) {
    assert.deepEqual(native.runtimeInterceptions, []);
    for (const source of native.profiles.sources) assert.equal(digest(source.source), source.sha256);
  }
});

const explicitFixture = { localTeam: 0, cancellationGate: 0,
  teams: Array.from({ length: 8 }, (_, index) => ({ index, ai: 0 })), aiMultipliers: Array(8).fill(256) as number[],
  buildingSlots: Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`${index},0`, 1])) };

test("resource clock requires source state and advances before dispatch, including cycle rollover", () => {
  assert.equal(campaignResourceFrame(explicitFixture).ok, false);
  const input = { ...explicitFixture, sourceDayNight: { phase: 0 as const, cycleLength: 64, elapsed: 64, transitionTicks: 16, blend: 0 } };
  const before = structuredClone(input);
  const result = campaignResourceFrame(input);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.resourceFrame.nativePhaseCounter, 0);
  assert.equal(result.value.sourceDayNight.phase, 1);
  assert.deepEqual(input, before);
  assert.deepEqual(result.value.resourceFrame.sides[0], { aiField: 0, aiMultiplier: 256, creditGate: 1 });
  assert.equal(campaignResourceFrame({ ...input, teams: [] }).ok, false);
  assert.equal(campaignResourceFrame({ ...input, buildingSlots: {} }).ok, false);
  assert.equal(campaignResourceFrame({ ...input, aiMultipliers: [] }).ok, false);
});

test("frame rejects malformed native inputs and copies explicit order state", () => {
  const input = { ...explicitFixture, rawHeader: originalHuman02.rawHeader };
  for (const invalid of [
    { localTeam: 8 }, { cancellationGate: -1 }, { aiMultipliers: Array(8).fill(2147483648) },
    { teams: [...input.teams].reverse() }, { rawHeader: [] },
    { orders: [{ slot: 152, generation: 0, pendingOrder: 1, order: 256 }] },
  ]) assert.equal(campaignResourceFrame({ ...input, ...invalid }).ok, false);
  const order = { slot: 153, generation: 0, pendingOrder: 1, order: 13 };
  assert.equal(campaignResourceFrame({ ...input, orders: [order, order] }).ok, false);
  const built = unwrap(campaignResourceFrame({ ...input, orders: [order] }));
  assert.deepEqual(built.resourceFrame.orders, [order]);
  assert.notEqual(built.resourceFrame.orders![0], order);
});

for (const [source, expectedAI, elapsed] of [
  [originalHuman02, [0, 0, 4, 3, 3, 0, 0, 0], 5100],
  [originalAlien02, [0, 4, 4, 0, 0, 0, 0, 0], 5700],
] as const) {
  test(`${source.id}: source AI, levels, full32 colony HP gates and original phase`, () => {
    const colony = projectLegacyColony(source.teams, units);
    const input = { rawHeader: source.rawHeader, teams: source.teams, buildingSlots: colony.buildingSlots,
      aiMultipliers: nativeInputs.multipliers, localTeam: 0, cancellationGate: nativeInputs.gates[0] };
    const before = structuredClone(input);
    const built = unwrap(campaignResourceFrame(input));
    assert.equal(built.resourceFrame.nativePhaseCounter, elapsed + 1);
    assert.deepEqual(built.resourceFrame.sides.map(({ aiField }) => aiField), expectedAI);
    assert.deepEqual(built.resourceFrame.sides.map(({ creditGate }) => creditGate), [4800, 0, 0, 0, 0, 0, 0, 0]);
    assert.equal(colony.slots[0].sourceLevel, 1);
    assert.equal(colony.slots[0].upgradeLevel, 0);
    assert.equal(source.teams[1].enabled, 1);
    assert.equal(built.resourceFrame.sides[1].creditGate, 0);
    assert.deepEqual(input, before);
    const resumed = unwrap(campaignResourceFrame({ ...input, sourceDayNight: built.sourceDayNight }));
    assert.equal(resumed.resourceFrame.nativePhaseCounter, elapsed + 2);
    const changed = unwrap(campaignResourceFrame({ ...input, buildingSlots: { ...colony.buildingSlots, "0,0": 0, "1,0": 65536 } }));
    assert.equal(changed.resourceFrame.sides[0].creditGate, 0);
    assert.equal(changed.resourceFrame.sides[1].creditGate, 65536);
  });
}

function boundedFixture(source: typeof originalHuman02, rowIndex: number, owner: number) {
  const row = source.placementRows[rowIndex];
  const sourceSlot = 152 + rowIndex;
  const extractorSlot = sourceSlot + 1;
  const native = nativeTrace.cases.find(({ race }) => race === source.teams[owner].race)!;
  const initial = native.trace[0];
  const created = unwrap(createCampaignWorld({ sessionId: `${source.id}:synthetic-extractor:${owner}`, units, messages: [],
    source: { ...source, placementRows: [row, [row[0], row[1], initial.extractor.type, owner, -1]] },
    resourceInitialization: { width: 128, height: 128, firstSlot: sourceSlot, scales: { rateScale: 256, reserveScale: 256 } } }));
  const bytes = new Uint8Array(800 * 220);
  const view = new DataView(bytes.buffer);
  const entities = created.entities.map((entity, index) => ({ ...entity, rawSlot: sourceSlot + index,
    health: index === 0 ? row[4] : initial.extractor.hp }));
  for (const entity of entities) {
    const offset = entity.rawSlot * 220;
    view.setUint16(offset, row[0] * 256 + 128, true);
    view.setUint16(offset + 4, row[1] * 256 + 128, true);
    view.setInt32(offset + 12, entity.health, true);
    bytes[offset + 6] = entity.unitType;
    bytes[offset + 7] = entity.team;
    bytes[offset + 0x2c] = 1;
  }
  const initialized = unwrap(initializeTransportHost({ ...created, entities, entityBytes: bytes,
    exomoney: Object.fromEntries(source.teams.map(({ index, money }) => [index, money])),
    statistics: { ...created.statistics, ...Object.fromEntries(source.teams.map(({ index }) => [`${index},1`, 0])) },
    buildingSlots: projectLegacyColony(source.teams, units).buildingSlots }, {
    width: 128, height: 128, groundEligible: Array(128 * 128).fill(true),
    definitions: units.map((unit) => ({ unitType: unit.index, health: Math.max(1, unit.health),
      movementSpeed: unit.movementSpeed, plane: "ground" as const })),
    sides: source.teams.map(({ race }) => race), directionBits: [], fixedStepMilliseconds: 16, orientationSteps: 1,
    highWater: extractorSlot + 1,
  }));
  const binding = (entity: NativeEntity, slot: number, health: number): ResourceHostBinding => ({ slot, generation: 0,
    state: { direction: entity.direction, pendingOrder: entity.pendingOrder, order: entity.order,
      animation: { ...entity.animation, profile: String(entity.animation.bank) }, released: false,
      stack: [{ opcode: 1, words: [entity.taskWords[0], health & 65535, (health >>> 16) & 65535] }] } });
  const world = unwrap(configureCampaignResourceLifecycle(initialized, { animations: native.animations,
    types: native.profiles.bindings.map((profile) => ({ unitType: profile.unitType, stand: String(profile.standBank),
      deploy: String(profile.deployBank), death: String(profile.deathBank), deathVariants: profile.deathVariants,
      removalHoldField: profile.removalHoldField, selectedWeapon: profile.selectedWeapon | 0 })),
    bindings: [binding(initial.source, sourceSlot, row[4])],
  }));
  return { world, sourceSlot, extractorSlot, incoming: binding(initial.extractor, extractorSlot, initial.extractor.hp) };
}

for (const source of [originalHuman02, originalAlien02]) {
  test(`${source.id}: every original resource row steps through configured FIN host with synthetic extractor only`, () => {
    for (const [rowIndex, row] of source.placementRows.entries()) {
      if (row[2] !== 40) continue;
      const fixture = boundedFixture(source, rowIndex, 0);
      const sourceEntity = fixture.world.entities.find(({ rawSlot }) => rawSlot === fixture.sourceSlot)!;
      assert.equal(sourceEntity.team, 8);
      assert.equal(sourceEntity.resource!.rateWord, row[3]);
      assert.equal(sourceEntity.health, row[4]);
      const input = { teams: source.teams, buildingSlots: fixture.world.buildingSlots,
        aiMultipliers: nativeInputs.multipliers, localTeam: 0, cancellationGate: nativeInputs.gates[0] };
      let clock = sourceDayNightFromHeader(source.rawHeader);
      let world = fixture.world;
      if (row[3] === 0) {
        const bound = unwrap(bindCampaignResourceTask(world, fixture.incoming));
        const before = structuredClone(bound);
        const blocked = stepTransportHost(bound, unwrap(campaignResourceFrame({ ...input, sourceDayNight: clock })).resourceFrame);
        assert.equal(blocked.ok, false);
        if (!blocked.ok) assert.match(blocked.diagnostics[0].message, /general mobile idle\/wait/);
        assert.deepEqual(bound, before);
        continue;
      }
      world = unwrap(bindCampaignResourceTask(world, fixture.incoming));
      const initialMoney = world.exomoney[0];
      const initialIncome = world.statistics["0,1"];
      let payouts = 0;
      for (let update = 1; update <= 48; update += 1) {
        const frame = unwrap(campaignResourceFrame({ ...input, sourceDayNight: clock }));
        if ((frame.resourceFrame.nativePhaseCounter & 15) === 0) payouts += 1;
        world = unwrap(stepTransportHost(world, frame.resourceFrame));
        clock = frame.sourceDayNight;
        assert.equal(world.exomoney[0], initialMoney + payouts * row[3]);
        assert.equal(world.statistics["0,1"], initialIncome + payouts * row[3]);
        assert.equal(world.statistics["0,5"], (clock.elapsed & 15) === 0 ? 1 : 0);
        assert.equal(transportHostState(world).slots[fixture.sourceSlot]!.health, row[4] - payouts * row[3]);
        if (update === 20) world = { ...world, transportState: JSON.parse(JSON.stringify(world.transportState)) };
      }
      assert.equal(transportHostState(world).slots[fixture.extractorSlot]!.unitType, source.teams[0].race === 0 ? 47 : 48);
    }
  });

  test(`${source.id}: native AI multiplier consumes reserve even when actual owner colony gate is zero`, () => {
    const owner = source.teams.find(({ ai }) => ai !== 0)!.index;
    const rowIndex = source.placementRows.findIndex((row) => row[2] === 40 && row[3] > 0);
    const row = source.placementRows[rowIndex];
    const fixture = boundedFixture(source, rowIndex, owner);
    const world = unwrap(bindCampaignResourceTask(fixture.world, fixture.incoming));
    const clock = { ...sourceDayNightFromHeader(source.rawHeader), elapsed: 15 };
    const frame = unwrap(campaignResourceFrame({ sourceDayNight: clock, teams: source.teams,
      buildingSlots: world.buildingSlots, aiMultipliers: nativeInputs.multipliers, localTeam: 0, cancellationGate: 0 }));
    const stepped = unwrap(stepTransportHost(world, frame.resourceFrame));
    const amount = Math.trunc(row[3] * nativeInputs.multipliers[owner] / 256);
    assert.equal(transportHostState(stepped).slots[fixture.sourceSlot]!.health, row[4] - amount);
    assert.equal(stepped.exomoney[owner], world.exomoney[owner]);
    assert.equal(stepped.statistics[`${owner},1`], world.statistics[`${owner},1`]);
    assert.equal(stepped.statistics[`${owner},5`], 0);
    assert.equal(transportHostState(stepped).requests.some(({ type }) => type === "resource-unit-sound"), false);
  });
}

test("session-style staging retains host settlement in controller feedback and rolls clock back on host failure", () => {
  const source = originalHuman02;
  const rowIndex = source.placementRows.findIndex((row) => row[2] === 40 && row[3] > 0);
  const fixture = boundedFixture(source, rowIndex, 0);
  const initial = { world: unwrap(bindCampaignResourceTask(fixture.world, fixture.incoming)),
    sourceDayNight: { ...sourceDayNightFromHeader(source.rawHeader), elapsed: 15 } };
  const before = structuredClone(initial);
  const built = unwrap(campaignResourceFrame({ sourceDayNight: initial.sourceDayNight,
    teams: source.teams, buildingSlots: initial.world.buildingSlots,
    aiMultipliers: nativeInputs.multipliers, localTeam: 0, cancellationGate: 0 }));
  const settled = unwrap(stepTransportHost(initial.world, built.resourceFrame));
  const published = { world: settled, sourceDayNight: built.sourceDayNight,
    controller: { runtime: { statistics: settled.statistics } } };
  assert.equal(published.controller.runtime.statistics["0,1"], source.placementRows[rowIndex][3]);
  assert.equal(published.controller.runtime.statistics["0,5"], 1);
  assert.equal(published.sourceDayNight.elapsed, 16);
  assert.deepEqual(initial, before);
  const staleOrder = { ...built.resourceFrame, orders: [{ slot: fixture.extractorSlot, generation: 99, pendingOrder: 1, order: 13 }] };
  assert.equal(stepTransportHost(initial.world, staleOrder).ok, false);
  assert.deepEqual(initial, before);
});
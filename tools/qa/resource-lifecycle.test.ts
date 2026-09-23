import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createCampaignWorld, type CampaignWorld } from "../../src/engine/campaign-world.ts";
import { advanceTransportHost, bindCampaignResourceTask, configureCampaignResourceLifecycle, initializeTransportHost,
  requestCampaignResourceExtraction, stepTransportHost, transportHostState,
  type ResourceHostFrame, type ResourceHostOptions } from "../../src/engine/transport-host.ts";
import type { TriggerResult } from "../../src/engine/trigger-runtime.ts";
import { parseUnitStats } from "../extractors/data/tables.ts";
import { advanceLegacyResourceAnimation, resetLegacyResourceAnimation,
  type LegacyResourceAnimation } from "../../src/engine/legacy-resource.ts";

interface NativeEntity {
  id: number; type: number; team: number; status: number; hp: number; activeSlot: number; direction: number;
  task: number; taskDepth: number; taskWords: number[]; pendingOrder: number; order: number;
  animation: { bank: number; frame: number; delay: number; mode: 0 | 1 | 2 | 3 };
}
interface NativeVisit {
  update: number; counter: number; source: NativeEntity; extractor: NativeEntity;
  credits: number; income: number; cycles: number; tileFlag: number; ground: number;
}
interface NativeCase {
  race: number; cancel: boolean; initialHealth: number; trace: NativeVisit[];
  runtime: { credits: number; income: number; reserve: number; aiField: number; aiMultiplier: number; creditGate: number; localTeam: number };
  runtimeInterceptions: string[];
  sounds: { update: number; edx: number; ebx: number; ecx: number; stack: number[] }[];
  animations: ResourceHostOptions["animations"];
  profiles: { sources: { source: string; sha256: string }[]; bindings: { unitType: number; standBank: number; deployBank: number; deathBank: number;
    deathVariants: number; removalHoldField: number; selectedWeapon: number }[] };
}
const root = fileURLToPath(new URL("../../", import.meta.url));
const trace = JSON.parse(process.env.DC_RESOURCE_LIFECYCLE_TRACE
  ? readFileSync(process.env.DC_RESOURCE_LIFECYCLE_TRACE, "utf8")
  : execFileSync("python3", ["tools/research/resource-lifecycle-20260919.py"], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" } })) as {
    sha256: string; sourceHashes: Record<string, string>;
    cases: NativeCase[]; cancellations: NativeCase[]; lowHealth: NativeCase[]; boundaries: NativeCase[];
  };
const units = parseUnitStats(readFileSync(new URL("../../raw_cd/DC/GAMESTAT/GAMESTAT.TXT", import.meta.url), "utf8"));

test("native trace matches original executable, metadata, mission sources and FIN banks", () => {
  const digest = (path: string) => createHash("sha256").update(readFileSync(new URL(`../../${path}`, import.meta.url))).digest("hex");
  assert.equal(trace.sha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  assert.equal(digest("raw_cd/DC/DC.EXE"), trace.sha256);
  for (const [path, expected] of Object.entries(trace.sourceHashes)) assert.equal(digest(`raw_cd/DC/${path}`), expected, path);
  for (const native of [...trace.cases, ...trace.cancellations, ...trace.lowHealth, ...trace.boundaries]) {
    assert.deepEqual(native.runtimeInterceptions, []);
    for (const source of native.profiles.sources) assert.equal(digest(source.source), source.sha256, source.source);
    const vent = native.profiles.bindings.find(({ unitType }) => unitType === 40)!;
    assert.equal(vent.deathVariants, 1);
    assert.equal(vent.deathBank, vent.standBank);
  }
});

function unwrap<Value>(result: TriggerResult<Value>): Value {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("Expected success");
  return result.value;
}

function frame(counter: number): ResourceHostFrame {
  return { nativePhaseCounter: counter, localTeam: 0, cancellationGate: 0,
    sides: Array.from({ length: 8 }, () => ({ aiField: 0, aiMultiplier: 256, creditGate: 1 })) };
}

function fixture(native: NativeCase): CampaignWorld {
  const initial = native.trace[0];
  const created = unwrap(createCampaignWorld({ sessionId: "resource-native", units, messages: [],
    source: { id: "resource-native", teams: Array.from({ length: 8 }, (_, index) => ({ index })),
      placementRows: [[5, 5, 40, 22, initial.source.hp], [5, 5, initial.extractor.type, 0, initial.extractor.hp]] },
    resourceInitialization: { width: 8, height: 8, firstSlot: 152, scales: { rateScale: 256, reserveScale: 256 } } }));
  const entityBytes = new Uint8Array(800 * 220);
  const view = new DataView(entityBytes.buffer);
  for (const entity of [initial.source, initial.extractor]) {
    const offset = entity.id * 220;
    view.setUint16(offset, 1408, true);
    view.setUint16(offset + 4, 1408, true);
    view.setInt32(offset + 12, entity.hp, true);
    entityBytes[offset + 6] = entity.type;
    entityBytes[offset + 7] = entity.team;
    entityBytes[offset + 0x2c] = 1;
  }
  const world = { ...created, entityBytes,
    entities: created.entities.map((entity, index) => ({ ...entity, rawSlot: 152 + index, health: index ? initial.extractor.hp : initial.source.hp })),
    exomoney: Object.fromEntries(Array.from({ length: 8 }, (_, team) => [team, team === 0 ? initial.credits | 0 : 0])),
    statistics: { ...created.statistics, ...Object.fromEntries(Array.from({ length: 8 }, (_, team) => [`${team},1`, team === 0 ? initial.income | 0 : 0])) } };
  const initialized = unwrap(initializeTransportHost(world, { width: 8, height: 8, groundEligible: Array(8 * 8).fill(true),
    definitions: units.map((unit) => ({ unitType: unit.index, health: Math.max(1, unit.health), movementSpeed: unit.movementSpeed, plane: "ground" as const })),
    sides: Array(8).fill(native.race), directionBits: [], fixedStepMilliseconds: 16, orientationSteps: 1, highWater: 154 }));
  return unwrap(configureCampaignResourceLifecycle(initialized, { animations: native.animations,
    types: native.profiles.bindings.map((binding) => ({ unitType: binding.unitType, stand: String(binding.standBank),
      deploy: String(binding.deployBank), death: String(binding.deathBank), deathVariants: binding.deathVariants,
      removalHoldField: binding.removalHoldField, selectedWeapon: binding.selectedWeapon | 0 })),
    bindings: [initial.source, initial.extractor].map((entity) => ({ slot: entity.id, generation: 0, state: {
      direction: entity.direction, animation: { profile: String(entity.animation.bank), frame: entity.animation.frame,
        delay: entity.animation.delay, mode: entity.animation.mode }, pendingOrder: entity.pendingOrder, order: entity.order,
      stack: [{ opcode: 1, words: entity.taskWords.slice(0, 3) }], released: false,
    } })) }));
}

for (const [caseIndex, native] of [...trace.cases, ...trace.cancellations, ...trace.lowHealth, ...trace.boundaries].entries()) {
  test(`native/host lifecycle ${caseIndex} race=${native.race} cancel=${native.cancel} hp=${native.initialHealth}`, () => {
    assert.deepEqual(native.runtimeInterceptions, []);
    let world = fixture(native);
    const sounds: unknown[] = [];
    let checkedRequests = 0;
    let released = false;
    for (const visit of native.trace.slice(1)) {
      if (visit.update === 32) world = { ...world, transportState: JSON.parse(JSON.stringify(world.transportState)) };
      const base = frame(visit.counter);
      const input = { ...base, localTeam: native.runtime.localTeam,
        sides: base.sides.map((side, team) => team === 0 ? { aiField: native.runtime.aiField,
          aiMultiplier: native.runtime.aiMultiplier, creditGate: native.runtime.creditGate } : side) };
      world = unwrap(stepTransportHost(world, native.cancel && visit.update === 20
        ? { ...input, orders: [{ slot: 153, generation: 0, pendingOrder: 1, order: 13 }] } : input));
      const state = transportHostState(world);
      for (const expected of [visit.source, visit.extractor]) {
        const actual = state.slots[expected.id]!;
        const label = `visit=${visit.update} slot=${expected.id}`;
        assert.equal(actual.status, expected.status, label);
        assert.equal(actual.health >>> 0, expected.hp, label);
        assert.equal(actual.unitType, expected.type, label);
        assert.equal(state.registry[expected.id] === null, expected.activeSlot === 65535, label);
        if (expected.id === 153 && released) continue;
        const task = actual.resourceTask!;
        assert.equal(task.direction, expected.direction, label);
        assert.equal(task.pendingOrder, expected.pendingOrder, label);
        assert.equal(task.order, expected.order, label);
        assert.equal(task.stack.length - 1, expected.taskDepth, label);
        assert.equal(task.stack.at(-1)!.opcode, expected.task, label);
        assert.deepEqual(actual.taskWords, expected.taskWords.slice(0, actual.taskWords.length), label);
        assert.deepEqual(task.animation, { profile: String(expected.animation.bank), frame: expected.animation.frame,
          delay: expected.animation.delay, mode: expected.animation.mode }, label);
        const offset = expected.id * 220;
        assert.equal(world.entityBytes![offset + 0x38], expected.taskDepth, label);
        const payload = world.entityBytes![offset + 0x3a + expected.taskDepth * 2];
        assert.equal(new DataView(world.entityBytes!.buffer).getUint16(offset + 0x46 + payload * 2, true), expected.taskWords[0], label);
      }
      released ||= state.slots[153]!.resourceTask!.released;
      assert.equal(world.exomoney[0] >>> 0, visit.credits);
      assert.equal(world.statistics["0,1"] >>> 0, visit.income);
      assert.equal(world.statistics["0,5"] >>> 0, visit.cycles);
      assert.equal(state.resourceTileFlags[5 * 8 + 5], visit.tileFlag);
      assert.equal(state.ground[5 * 8 + 5], visit.ground === 1023 ? -1 : visit.ground);
      assert.equal(state.requests.some(({ type }) => type === "combat-death"), false);
      for (const request of state.requests.slice(checkedRequests)) if (request.type === "resource-unit-sound") {
        sounds.push({ update: visit.update, edx: request.edx, ebx: request.ebx, ecx: request.ecx, stack: request.stackArguments });
      }
      checkedRequests = state.requests.length;
    }
    assert.deepEqual(sounds, native.sounds);
  });
}

test("resource frame/binding boundaries fail atomically and expose native-phase handoff", () => {
  const world = fixture(trace.cases[0]);
  const before = structuredClone(world);
  assert.equal(stepTransportHost(world).ok, false);
  assert.equal(advanceTransportHost(world, 32, [frame(1)]).ok, false);
  assert.equal(stepTransportHost(world, { ...frame(1), nativePhaseCounter: -1 }).ok, false);
  assert.equal(stepTransportHost(world, { ...frame(1), sides: [] }).ok, false);
  assert.equal(requestCampaignResourceExtraction(world, { sourceSlot: 152, extractorSlot: 153 }).ok, false);
  assert.deepEqual(world, before);
  const requested = unwrap(requestCampaignResourceExtraction(world, { sourceSlot: 152, extractorSlot: 153 }, frame(0)));
  assert.deepEqual(transportHostState(requested).slots[153]!.taskWords, [152, 1, 0]);
  assert.equal(requested.exomoney[0], 1000);
  const batch = unwrap(advanceTransportHost(world, 32, [frame(0), frame(15)]));
  assert.equal(batch.exomoney[0], 1022);
  assert.equal(batch.statistics["0,5"], 0);
  assert.equal(transportHostState(batch).resourceLifecycle!.nativePhaseCounter, 15);
  const state = transportHostState(world);
  const binding = { slot: 153, generation: 0, state: structuredClone(state.slots[153]!.resourceTask!) };
  assert.equal(bindCampaignResourceTask(world, binding).ok, false);
  state.slots[153]!.resourceTask!.released = true;
  assert.equal(bindCampaignResourceTask({ ...world, transportState: state }, binding).ok, true);
  assert.equal(bindCampaignResourceTask({ ...world, transportState: state }, { ...binding, generation: 1 }).ok, false);
  const waiting = transportHostState(world);
  waiting.slots[152]!.resource!.countdownWord = 50;
  waiting.slots[152]!.taskWords[0] = 50;
  const unsupported = stepTransportHost({ ...world, transportState: waiting }, frame(1));
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) assert.match(unsupported.diagnostics[0].message, /general mobile idle\/wait dispatch/);
});

test("settlement wraps full32, uses AI/gates explicitly, and checks depletion before phase mask", () => {
  const initial = fixture(trace.cases[0]);
  const high = { ...initial, exomoney: { ...initial.exomoney, 0: 2147483647 }, statistics: { ...initial.statistics, "0,1": 2147483647 } };
  const wrapped = unwrap(stepTransportHost(high, frame(0)));
  assert.equal(wrapped.exomoney[0], -2147483627);
  assert.equal(wrapped.statistics["0,1"], -2147483627);
  const sides = frame(0).sides.map((side, team) => team === 0 ? { ...side, aiField: 1, aiMultiplier: 512, creditGate: 0 } : side);
  const scaled = unwrap(stepTransportHost(initial, { ...frame(0), sides }));
  assert.equal(transportHostState(scaled).slots[152]!.health, 56);
  assert.equal(scaled.exomoney[0], 1000);
  assert.equal(scaled.statistics["0,1"], 0);
  const state = transportHostState(initial);
  state.slots[152]!.health = 22;
  const depleted = unwrap(stepTransportHost({ ...initial, transportState: state }, frame(15)));
  assert.equal(transportHostState(depleted).slots[152]!.status, 10);
  assert.equal(transportHostState(depleted).slots[152]!.health, 22);
  assert.equal(depleted.exomoney[0], 1000);
  state.resourceTileFlags[45] = 0;
  const missingFlag = { ...initial, transportState: state };
  const before = structuredClone(missingFlag);
  assert.equal(stepTransportHost(missingFlag, frame(15)).ok, false);
  assert.deepEqual(missingFlag, before);
});

test("partner payout writes precede owner, odd shares truncate, and unknown branch fails", () => {
  const active = unwrap(stepTransportHost(fixture(trace.cases[0]), frame(1)));
  const state = transportHostState(active);
  state.slots[152]!.resource!.rateWord = 25;
  state.slots[154] = { ...state.slots[153]!, slot: 154, unitType: 77, resourceTask: undefined };
  state.slots[153]!.resourceTask!.stack.at(-1)!.words[2] = 154;
  const world = { ...active, transportState: state };
  const shared = unwrap(stepTransportHost(world, frame(16)));
  assert.equal(shared.exomoney[0], 1024);
  assert.equal(shared.statistics["0,1"], 24);
  assert.equal(shared.statistics["0,5"], 1);
  assert.equal(transportHostState(shared).slots[152]!.health, 75);
  state.slots[154]!.unitType = 4;
  const cleared = unwrap(stepTransportHost(world, frame(16)));
  assert.equal(cleared.exomoney[0], 1025);
  assert.equal(transportHostState(cleared).slots[153]!.taskWords[2], 0);
  state.slots[154]!.unitType = 5;
  const before = structuredClone(world);
  const invalid = stepTransportHost(world, frame(16));
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.match(invalid.diagnostics[0].message, /0x413a9d/);
  assert.deepEqual(world, before);
});

test("native animation skips initial delay, preserves same-bank reset, and wraps delay bytes", () => {
  const profile = { id: "deploy", directions: Array.from({ length: 32 }, () => [2, 2, 2]) };
  let animation: LegacyResourceAnimation = { profile: "deploy", frame: 0, delay: 0, mode: 1 };
  for (let visit = 1; visit <= 5; visit += 1) {
    animation = advanceLegacyResourceAnimation(animation, profile, 0);
    assert.equal(animation.mode, visit === 5 ? 2 : 1);
  }
  assert.deepEqual(resetLegacyResourceAnimation(animation, "deploy", 2), animation);
  assert.deepEqual(resetLegacyResourceAnimation(animation, "deploy", 0), { profile: "deploy", frame: 0, delay: 0, mode: 0 });
  assert.equal(advanceLegacyResourceAnimation({ ...animation, mode: 0 },
    { id: "deploy", directions: Array.from({ length: 32 }, () => [0, 0]) }, 255).delay, 255);
});
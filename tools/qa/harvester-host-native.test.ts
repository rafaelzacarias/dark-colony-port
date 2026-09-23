import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createCampaignWorld, type CampaignWorld } from "../../src/engine/campaign-world";
import { sourceResourceProfiles } from "../../src/engine/source-resource-options";
import { configureCampaignResourceLifecycle, initializeTransportHost, stepTransportHost, transportHostState,
  type ResourceHostEntityState } from "../../src/engine/transport-host";
import type { LegacyHarvesterIdleState } from "../../src/engine/legacy-harvester-idle";
import type { TriggerResult } from "../../src/engine/trigger-runtime";

interface Snapshot {
  id: number; type: number; team: number; status: number; hp: number; position: number[]; direction: number;
  pendingOrder: number; order: number; taskWords: number[]; stack: { task: number; words: number[] }[];
  animation: { bank: number; frame: number; delay: number; mode: 0 | 1 | 2 };
}
interface NativeCase {
  unitType: 6 | 14; order: number; mobileFirst: boolean; initialRandomIndex: number; release: number; cancellation: number;
  verified: boolean; runtimeInterceptions: unknown[]; rng: unknown[];
  idleWorld: { standBank: number; preservedIdleBank: number };
  animations: Record<string, number[][]>;
  profiles: { bindings: { unitType: number; stem: string; standBank: number }[] };
  handshake: { update: number; state: LegacyHarvesterIdleState; groundWord: number; mobileAfter: LegacyHarvesterIdleState }[];
  trace: { update: number; mobile: Snapshot; source: Snapshot; phase: number; credits: number }[];
}
interface BoundaryState {
  raw: number[]; stack: { opcode: number; offset: number; words: number[] }[];
  xQ8: number; yQ8: number; direction: number; pending: number; order: number; randomIndex: number;
}
interface BoundaryCase {
  unitType: 6 | 14; stopAfter: number | null; counterOverride: number | null;
  preservedIdleSuffix: string; randomWrites: unknown[]; runtimeInterceptions: unknown[];
  mutation: { before: BoundaryState; after: BoundaryState };
  trace: { update: number; before: BoundaryState; after: BoundaryState }[];
}
const root = new URL("../../", import.meta.url);
const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
function probe(environment: string, path: string, args: string[] = []) {
  return JSON.parse(process.env[environment] ? readFileSync(process.env[environment]!, "utf8") :
    execFileSync("python3", [fileURLToPath(new URL(path, root)), ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" } }));
}
const native = probe("DC_HARVESTER_HANDOFF_TRACE", "tools/research/harvester-handoff-20260919.py", ["--suite"]) as { cases: NativeCase[] };
const boundary = probe("DC_HARVESTER_BOUNDARY_TRACE", "tools/qa/harvester-movement-boundary-native.py") as { cases: BoundaryCase[] };
const units = json("public/assets/generated/data/units.json").records;
const profiles = sourceResourceProfiles(Object.fromEntries(["VENT", "EXPL", "SLUG"].map(stem =>
  [stem, json(`public/assets/generated/animations/${stem}.json`)])) as Parameters<typeof sourceResourceProfiles>[0]);
function unwrap<Value>(result: TriggerResult<Value>): Value {
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
function fixture(current: NativeCase) {
  const arrival = current.handshake[0];
  const initial = current.trace.find(frame => frame.update === arrival.update)!;
  const bankNames = new Map(current.profiles.bindings.map(binding => [binding.standBank, `${binding.stem}STAND`]));
  bankNames.set(current.handshake[1].mobileAfter.animation.bank, current.unitType === 6 ? "EXPLDEPLOY" : "SLUGDEPLOY");
  bankNames.set(current.idleWorld.preservedIdleBank, current.unitType === 6 ? "EXPLFUNK" : "SLUGFUNK");
  const animation = (value: Snapshot["animation"]) => ({ ...value, profile: bankNames.get(value.bank)! });
  const records = [initial.source, initial.mobile].sort((left, right) => left.id - right.id);
  const created = unwrap(createCampaignWorld({ sessionId: "source-separated-native-arrival-fixture", units, messages: [],
    source: { id: "source-separated-native-arrival-fixture", teams: Array.from({ length: 8 }, (_, index) => ({ index })),
      placementRows: records.map(record => [69, 48, record.type, record.type === 40 ? 22 : 0, record.hp]) },
    resourceInitialization: { width: 96, height: 84, firstSlot: 152, scales: { rateScale: 256, reserveScale: 256 } } }));
  const bytes = new Uint8Array(800 * 220), raw = new DataView(bytes.buffer);
  for (const record of records) {
    const offset = record.id * 220;
    raw.setUint16(offset, record.position[0], true);
    raw.setUint16(offset + 4, record.position[1], true);
    raw.setInt32(offset + 12, record.hp, true);
    bytes[offset + 6] = record.type;
    bytes[offset + 7] = record.team;
    bytes[offset + 0x2c] = record.status;
  }
  let world: CampaignWorld = { ...created, entityBytes: bytes,
    entities: created.entities.map((entity, index) => ({ ...entity, rawSlot: records[index].id,
      ...(entity.resource ? { resource: { ...entity.resource, countdownWord: initial.source.taskWords[0] } } : {}) })),
    exomoney: Object.fromEntries(Array.from({ length: 8 }, (_, team) => [team, 0])),
    statistics: { ...created.statistics, ...Object.fromEntries(Array.from({ length: 8 }, (_, team) => [`${team},1`, 0])) } };
  world = unwrap(initializeTransportHost(world, { width: 96, height: 84, groundEligible: Array(96 * 84).fill(true),
    definitions: units.map((unit: { index: number; health: number; movementSpeed: number }) => ({ unitType: unit.index,
      health: Math.max(1, unit.health), movementSpeed: unit.movementSpeed, plane: "ground" as const })),
    sides: Array(8).fill(Number(current.unitType === 14)), directionBits: [], fixedStepMilliseconds: 50,
    orientationSteps: 1, highWater: 154 }));
  const state = arrival.state;
  const nativeIdle = { randomIndex: state.randomIndex, observer: state.observer, specialOrder: state.specialOrder,
    confusion: state.confusion, secondaryAnimationPending: state.secondaryAnimationPending,
    secondaryAnimationsInactive: state.secondaryAnimationsInactive, groundWord: arrival.groundWord };
  world = unwrap(configureCampaignResourceLifecycle(world, { ...profiles,
    bindings: records.map(record => ({ slot: record.id, generation: 0, state: {
      direction: record.direction, animation: (({ profile, frame, delay, mode }) => ({ profile, frame, delay, mode }))(animation(record.animation)),
      pendingOrder: record.pendingOrder, order: record.order, released: false,
      stack: record.type === 40 ? [{ opcode: 1, words: record.taskWords.slice(0, 3) }] :
        state.stack.map(entry => ({ opcode: entry.task as 1 | 3, words: [...entry.words] })),
      ...(record.type === 40 ? {} : { nativeIdle }),
    } })) }));
  return { world, initial, bankNames };
}
const frame = (phase: number) => ({ nativePhaseCounter: phase, localTeam: 0, cancellationGate: 0,
  sides: Array.from({ length: 8 }, () => ({ aiField: 0, aiMultiplier: 256, creditGate: 1 })) });

test("source FUNK timelines match all 32 native directions, including SLUG's EXPL.FIN dependency", () => {
  for (const current of native.cases) {
    const type = profiles.types.find(type => type.unitType === current.unitType)!;
    assert.deepEqual(profiles.animations.find(bank => bank.id === type.preservedIdle)!.directions,
      current.animations[current.idleWorld.preservedIdleBank]);
  }
});

for (const current of native.cases) test(`source-separated host arrival/retraction ${current.unitType}/${current.order}/${current.mobileFirst}`, () => {
  assert.equal(current.verified, true);
  assert.deepEqual(current.runtimeInterceptions, []);
  assert.deepEqual(current.rng, []);
  const setup = fixture(current);
  let world = setup.world;
  assert.equal(world.exomoney[0], 0);
  for (const visit of current.trace.filter(visit => visit.update > setup.initial.update && visit.update <= current.release)) {
    const input = { ...frame(visit.phase), ...(visit.update === current.cancellation ? {
      orders: [{ slot: visit.mobile.id, generation: 0, pendingOrder: 1, order: 13 }] } : {}) };
    world = unwrap(stepTransportHost(world, input));
    const host = transportHostState(world);
    for (const expected of [visit.mobile, visit.source]) {
      const actual = host.slots[expected.id]!, task = actual.resourceTask!;
      const label = `${visit.update}:${expected.id}`;
      assert.equal(actual.unitType, expected.type, label);
      assert.equal(actual.health, expected.hp, label);
      assert.deepEqual(actual.position, { x: expected.position[0], y: expected.position[1] }, label);
      assert.deepEqual([task.direction, task.pendingOrder, task.order], [expected.direction, expected.pendingOrder, expected.order], label);
      assert.deepEqual(task.stack.map(entry => ({ task: entry.opcode, words: entry.words })),
        expected.stack.map(entry => ({ task: entry.task, words: entry.words.slice(0, entry.task === 3 ? 2 : entry.task === 13 ? 1 : 3) })), label);
      assert.deepEqual(task.animation, { profile: setup.bankNames.get(expected.animation.bank), frame: expected.animation.frame,
        delay: expected.animation.delay, mode: expected.animation.mode }, label);
      assert.equal(actual.taskWords, task.stack.at(-1)!.words);
    }
    assert.equal(world.exomoney[0], visit.credits);
    assert.equal(world.statistics["0,1"], visit.credits);
    assert.equal(host.slots[visit.mobile.id]!.resourceTask!.nativeIdle!.randomIndex, current.initialRandomIndex);
    world = { ...world, transportState: JSON.parse(JSON.stringify(host)) };
  }
  const mobile = transportHostState(world).slots[setup.initial.mobile.id]!;
  assert.ok(mobile.resourceTask!.released);
  assert.deepEqual(mobile.resourceTask!.stack, [{ opcode: 1, words: [65535, 800, 0] }]);
  assert.equal(world.exomoney[0], current.unitType === 6 ? 44 : 66);
});

test("original task5 word2 controls movement; zero pops without another step or redispatch", () => {
  for (const current of boundary.cases.filter(current => current.counterOverride !== null)) {
    assert.deepEqual(current.runtimeInterceptions, []);
    assert.deepEqual(current.randomWrites, []);
    const visit = current.trace.find(visit => visit.update === (current.unitType === 6 ? 11 : 14))!;
    const counter = current.counterOverride!;
    assert.deepEqual(visit.before.stack.at(-1)!.words, [40, 0, counter, 67, 48]);
    assert.equal(visit.after.xQ8 - visit.before.xQ8, counter === 0 ? 0 : 40);
    if (counter === 0) assert.deepEqual(visit.after.stack, visit.before.stack.slice(0, -1));
    else assert.deepEqual(visit.after.stack.at(-1)!.words, [40, 0, counter - 1, 67, 48]);
  }
});

test("native Stop stays queued through task4/task5, and the host matches idle Stop without RNG draws", () => {
  for (const current of boundary.cases.filter(current => current.stopAfter !== null)) {
    assert.deepEqual(current.randomWrites, []);
    assert.deepEqual(current.runtimeInterceptions, []);
    assert.equal(current.mutation.after.pending, 1);
    assert.equal(current.mutation.after.order, 13);
    const visit = current.trace.find(visit => visit.update === current.stopAfter! + 1)!;
    if ([4, 5].includes(visit.before.stack.at(-1)!.opcode)) {
      assert.equal(visit.after.pending, 1);
      assert.equal(visit.after.order, 13);
    } else {
      assert.equal(visit.after.pending, 0);
      assert.equal(visit.after.order, 255);
      assert.deepEqual(visit.after.stack.map(({ opcode, words }) => ({ opcode, words })),
        [{ opcode: 1, words: [65535, 800, 0] }, { opcode: 3, words: [7, 800] }]);
    }
    if (current.stopAfter !== 28) continue;
    const source = native.cases.find(source => source.unitType === current.unitType && source.order === 2 && !source.mobileFirst)!;
    const setup = fixture(source), host = transportHostState(setup.world), entity = host.slots[setup.initial.mobile.id]!;
    const task = entity.resourceTask!;
    task.stack = visit.before.stack.map(({ opcode, words }) => ({ opcode, words })) as ResourceHostEntityState["stack"];
    entity.taskWords = task.stack.at(-1)!.words;
    task.animation.frame = visit.before.raw[0x18];
    task.animation.delay = visit.before.raw[0x19];
    task.animation.mode = visit.before.raw[0x1a] as 0;
    const result = unwrap(stepTransportHost({ ...setup.world, transportState: host }, { ...frame(29),
      orders: [{ slot: entity.slot, generation: 0, pendingOrder: 1, order: 13 }] }));
    const actual = transportHostState(result).slots[entity.slot]!.resourceTask!;
    assert.deepEqual(actual.stack, visit.after.stack.map(({ opcode, words }) => ({ opcode, words })));
    assert.deepEqual([actual.animation.frame, actual.animation.delay, actual.animation.mode], visit.after.raw.slice(0x18, 0x1b));
    assert.equal(actual.nativeIdle!.randomIndex, visit.after.randomIndex);
  }
});
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { projectLegacyColony } from "../../src/engine/legacy-colony.ts";
import { parseScenario } from "../extractors/data/scenario.ts";
import { parseUnitStats } from "../extractors/data/tables.ts";
import { consumeLegacyAiGroupOrders, consumeLegacyAiGroupPrelude, consumeLegacyAiInactiveSelector, LEGACY_AI_LAYOUT,
  type LegacyAiGroup } from "../../src/engine/legacy-ai.ts";

type Golden = { group: LegacyAiGroup; statuses: number[]; buckets: number[];
  accumulator: number; policySha256: string; entitiesSha256: string };
const root = new URL("../../", import.meta.url);
function runNative(option: string): string {
  return execFileSync("python3", ["-B", "tools/research/ai-policy-20260919.py", option], {
    cwd: root, encoding: "utf8", maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: [process.env.PYTHONPATH,
      "/tmp/dc-re-capstone-20260918", "/tmp/dc-trigger-unicorn-20260918"].filter(Boolean).join(":") },
  });
}
const native = JSON.parse(process.env.DC_AI_NATIVE_TRACE
  ? readFileSync(process.env.DC_AI_NATIVE_TRACE, "utf8")
  : runNative("--callback-goldens")) as { callbackCases: Golden[]; scheduler: { mode: number; weight: number;
    actionsPerCall: number; cursors: number[] }[]; rngTable: number[] };
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function fixture(golden: Golden) {
  const layout = LEGACY_AI_LAYOUT;
  const policy = Buffer.alloc(layout.policyBytes, 0xa5);
  const entities = Buffer.alloc(layout.entitySlots * layout.entityStride, 0x5a);
  const base = golden.group * layout.groupStride;
  policy.writeUInt32LE(golden.group === 3 ? 0x459f24 : 0x4578a0, base + layout.accumulatorCallback);
  policy.writeUInt32LE(golden.group === 0 || golden.group === 3 ? 0x44bbdc : 0x44bbec, base + layout.cleanupCallback);
  for (let bucket = 0; bucket < 16; bucket++) {
    policy[base + layout.bucketEnabled + bucket * 300] = 0;
    policy.writeInt16LE(-1, base + layout.head + bucket * 300);
    policy.writeInt16LE(-1, base + layout.tail + bucket * 300);
  }
  policy.writeUInt32LE(0xfffffff0, base + layout.accumulator);
  for (const bucket of golden.buckets) {
    policy[base + layout.bucketEnabled + bucket * 300] = 1;
    const slots = golden.statuses.map((_, index) => 152 + bucket * 8 + index);
    if (slots.length) {
      policy.writeInt16LE(slots[0], base + layout.head + bucket * 300);
      policy.writeInt16LE(slots.at(-1)!, base + layout.tail + bucket * 300);
    }
    slots.forEach((slot, index) => {
      entities[slot * 220 + layout.state] = golden.statuses[index];
      entities.writeInt16LE(slots[index + 1] ?? -1, slot * 220 + layout.next);
      entities.writeInt16LE(slots[index - 1] ?? -1, slot * 220 + layout.previous);
    });
  }
  return { policy, entities };
}

test("all four native prelude callback pairs match complete buffer goldens", () => {
  assert.equal(native.callbackCases.length, 24);
  for (const golden of native.callbackCases) {
    const { policy, entities } = fixture(golden);
    const result = consumeLegacyAiGroupPrelude(policy, entities, golden.group);
    assert.equal(result.accumulator, golden.accumulator);
    assert.equal(hash(policy), golden.policySha256, JSON.stringify(golden));
    assert.equal(hash(entities), golden.entitiesSha256, JSON.stringify(golden));
    assert.equal(result.removedSlots.length,
      golden.statuses.filter((state) => state === 10).length * golden.buckets.length);
    assert.equal(result.nextCallback, [0x44b920, 0x4593a8, 0x458b44, 0x44b920][golden.group]);
  }
});

test("group-3 count precedes cleanup and only the next empty invocation adds 1000", () => {
  const golden = native.callbackCases.find(({ group, statuses }) => group === 3 && statuses.join() === "10")!;
  const { policy, entities } = fixture(golden);
  assert.equal(consumeLegacyAiGroupPrelude(policy, entities, 3).accumulator, 0xfffffff0);
  assert.equal(consumeLegacyAiGroupPrelude(policy, entities, 3).accumulator, 984);
});

test("invalid lists fail atomically, including state zero, -2, cycles and inconsistent backlinks", () => {
  const golden = native.callbackCases.find(({ group, statuses }) => group === 0 && statuses.join() === "1")!;
  const mutations = [
    ({ entities }: ReturnType<typeof fixture>) => { entities[152 * 220 + 0x2c] = 0; },
    ({ entities }: ReturnType<typeof fixture>) => { entities.writeInt16LE(-2, 152 * 220 + 0xd2); },
    ({ entities }: ReturnType<typeof fixture>) => { entities.writeInt16LE(152, 152 * 220 + 0xd2); },
    ({ entities }: ReturnType<typeof fixture>) => { entities.writeInt16LE(800, 152 * 220 + 0xd2); },
    ({ entities }: ReturnType<typeof fixture>) => { entities.writeInt16LE(3, 152 * 220 + 0xd4); },
    ({ policy }: ReturnType<typeof fixture>) => { policy.writeInt16LE(7, 0x1fac); },
    ({ policy }: ReturnType<typeof fixture>) => { policy.writeUInt32LE(0, 0x3168); },
  ];
  for (const mutate of mutations) {
    const buffers = fixture(golden);
    mutate(buffers);
    const before = [hash(buffers.policy), hash(buffers.entities)];
    assert.throws(() => consumeLegacyAiGroupPrelude(buffers.policy, buffers.entities, 0), RangeError);
    assert.deepEqual([hash(buffers.policy), hash(buffers.entities)], before);
  }
});

test("prelude respects buffer views, disabled buckets, and rejects incomplete or overlapping buffers", () => {
  const golden = native.callbackCases.find(({ group, statuses }) => group === 1 && statuses.join() === "1")!;
  const { policy, entities } = fixture(golden);
  const base = LEGACY_AI_LAYOUT.groupStride;
  policy[base + 0x1e95] = 0;
  entities[152 * 220 + 0x2c] = 0;
  const backing = Buffer.alloc(32 + policy.length + entities.length, 0x77);
  const policyView = backing.subarray(16, 16 + policy.length);
  const entityView = backing.subarray(16 + policy.length, 16 + policy.length + entities.length);
  policy.copy(policyView);
  entities.copy(entityView);
  consumeLegacyAiGroupPrelude(policyView, entityView, 1);
  assert.equal(entityView[152 * 220 + 0x2c], 0);
  assert.ok(backing.subarray(0, 16).every((value) => value === 0x77));
  assert.ok(backing.subarray(-16).every((value) => value === 0x77));
  assert.throws(() => consumeLegacyAiGroupPrelude(policy.subarray(1), entities, 1), RangeError);
  assert.throws(() => consumeLegacyAiGroupPrelude(entities.subarray(0, policy.length), entities, 1), RangeError);
  assert.throws(() => consumeLegacyAiGroupPrelude(policy, entities, 4 as LegacyAiGroup), RangeError);
});

test("mode 4 consumes one native RNG draw, mode 0 skips, mode 3 remains blocked", () => {
  assert.equal(native.rngTable.length, 256);
  assert.equal(Math.min(...native.rngTable), 668);
  assert.equal(Math.max(...native.rngTable), 32434);
  for (const scheduler of native.scheduler) {
    assert.equal(scheduler.weight, scheduler.mode === 3 ? 1 : 0);
    assert.equal(scheduler.actionsPerCall, scheduler.mode === 3 ? 1 : 0);
    for (let cursor = 0; cursor < 256; cursor++) {
      assert.equal(scheduler.cursors[cursor], (cursor + 1) & 255);
      assert.deepEqual(consumeLegacyAiInactiveSelector(4, cursor), {
        kind: "no-action", rngCursor: scheduler.cursors[cursor], weight: 0, rngDraws: 1,
      });
      assert.deepEqual(consumeLegacyAiInactiveSelector(0, cursor), { kind: "disabled", rngCursor: cursor });
      const blocked = consumeLegacyAiInactiveSelector(3, cursor);
      assert.equal(blocked.kind, "blocked");
      assert.equal(blocked.rngCursor, cursor);
    }
  }
  assert.throws(() => consumeLegacyAiInactiveSelector(2, 0), RangeError);
  assert.throws(() => consumeLegacyAiInactiveSelector(4, 256), RangeError);
});

test("original source actors reach bounded native orders but do not admit active missions", () => {
  const results = runNative("--source-continuation").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(results.length, 2);
  assert.deepEqual(results.map(({ mission }) => mission), ["HUMAN02", "ALIEN02"]);
  assert.deepEqual(results.map(({ packets }) => packets), [
    ["0b00070100000034003e00", "0b00070100000034003e00", "0b00070100000034003e00",
      "110007010100003b0015a50005a5000700"],
    ["11000701010000010049a10005a1000700"],
  ]);
  for (const result of results) {
    assert.equal(result.admitted, false);
    assert.equal(result.precedingTriggersExecuted, false);
    assert.equal(result.failure, null);
    assert.equal(result.eip, "0x421725");
    for (const address of ["0x457568", "0x456ad0", "0x457940", "0x4578d0"]) {
      assert.ok(result.visited.includes(address));
    }
    assert.ok(result.rules.length > 0);
  }
  for (const address of ["0x4598b0", "0x4593a8", "0x458b44", "0x459f80"]) {
    assert.ok(results[0].visited.includes(address));
  }
  assert.deepEqual(results[0].actors.map(({ slot, type }: { slot: number; type: number }) => [slot, type]),
    Array.from({ length: 10 }, (_, index) => [156 + index, 8]));
  assert.equal(results[1].actors.find(({ slot }: { slot: number }) => slot === 161).type, 86);
});

test("full original trigger compilation preserves action order and precise activation blockers", () => {
  const [human, alien] = runNative("--activation-boundary").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual([human.compiledBlocks, human.compiledActions, alien.compiledBlocks, alien.compiledActions], [20, 42, 12, 25]);
  assert.deepEqual(human.nativeExecutionOrder, ["ai 2 3", "reinforce 2 47 6 8 10 10 7 0 0 0 0 0 0"]);
  assert.deepEqual(human.events, [
    { kind: "ai", words: [2, 3] },
    { kind: "blocked-transport-constructor", team: 2, tile: [47, 6], types: [8, 10, 0, 0, 0], counts: [10, 7, 0, 0, 0] },
  ]);
  assert.deepEqual(alien.nativeExecutionOrder, ["abduct 1 1", "reinforce 1 11 54 0 2 0 0 0 0 0 0 0 0", "ai 1 3"]);
  assert.equal(alien.events[0].kind, "blocked-commander-lifecycle");
  assert.equal(alien.events[0].requiredField, "0x2764");
  for (const result of [human, alien]) {
    assert.equal(result.allSourceConsumed, true);
    assert.equal(result.precedingTriggersExecuted, false);
    assert.equal(result.admitted, false);
  }
});

type OrderSnapshot = { policy: string; entities: string; rngCursor: number; forceOrder: number };
type DecisionGolden = { mission: string; team: number; executableSha256: string;
  navigation: { width: number; height: number; families: string; nextFamily: string };
  captures: OrderGolden[]; controls: OrderGolden[] };
type OrderGolden = { group: 1 | 2; callback: string; before: OrderSnapshot; after: OrderSnapshot; packets: string[];
  control?: string; invocations?: number };
let decisionGoldens: DecisionGolden[] | undefined;
function loadDecisionGoldens() {
  return decisionGoldens ??= (process.env.DC_AI_DECISION_TRACE
    ? readFileSync(process.env.DC_AI_DECISION_TRACE, "utf8") : runNative("--decision-goldens"))
    .trim().split("\n").map((line) => JSON.parse(line) as DecisionGolden);
}

function orderFixture(result: DecisionGolden, capture: OrderGolden) {
  return { policy: Buffer.from(capture.before.policy, "base64"), entities: Buffer.from(capture.before.entities, "base64"),
    navigation: { ...result.navigation, families: Buffer.from(result.navigation.families, "base64"),
      nextFamily: Buffer.from(result.navigation.nextFamily, "base64") }, forceOrder: capture.before.forceOrder };
}

test("group-1/2 order consumer matches native source decisions, entity fields and mode-7 packets", () => {
  const results = loadDecisionGoldens();
  let actorPackets = 0;
  for (const result of results) {
    assert.equal(result.executableSha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
    for (const capture of [...result.captures.filter(({ callback }) => callback === "0x463e78"), ...result.controls]) {
      const state = orderFixture(result, capture);
      const output = consumeLegacyAiGroupOrders(state, capture.group);
      for (let invocation = 1; invocation < (capture.invocations ?? 1); invocation++) {
        output.packets.push(...consumeLegacyAiGroupOrders(state, capture.group).packets);
      }
      assert.equal(hash(state.policy), hash(Buffer.from(capture.after.policy, "base64")), `${result.mission} group ${capture.group} policy`);
      assert.equal(hash(state.entities), hash(Buffer.from(capture.after.entities, "base64")), `${result.mission} group ${capture.group} entities`);
      assert.equal(state.forceOrder, capture.after.forceOrder);
      assert.deepEqual(output.packets.map((packet) => Buffer.from(packet).toString("hex")), capture.packets);
      assert.equal(capture.after.rngCursor, capture.before.rngCursor);
      assert.equal(output.rngDraws, 0);
      assert.equal(output.admitted, false);
      if (!capture.control) actorPackets += output.packets.filter((packet) => packet[4] !== 0).length;
    }
  }
  assert.equal(actorPackets, 6);
  assert.equal(results.reduce((count, result) => count + result.controls.length, 0), 10);
});

test("group orders reject invalid state atomically, including late route failures", () => {
  const result = loadDecisionGoldens().find(({ mission }) => mission === "ALIEN02")!;
  const capture = result.captures.find(({ group, callback }) => group === 1 && callback === "0x463e78")!;
  const base = LEGACY_AI_LAYOUT.groupStride;
  const original = orderFixture(result, capture);
  const bucket = Array.from({ length: 16 }, (_, index) => index).find((index) =>
    original.policy[base + index * 300 + 0x1e95] !== 0 && original.policy.readInt16LE(base + index * 300 + 0x1faa) >= 0)!;
  const listBase = base + bucket * 300;
  const slot = original.policy.readInt16LE(listBase + 0x1faa);
  const mutations = [
    (state: typeof original) => { state.policy.writeUInt32LE(0, base + 0x3170); },
    (state: typeof original) => { state.entities[slot * 220 + 0x2c] = 0; },
    (state: typeof original) => { state.entities.writeInt16LE(slot, slot * 220 + 0xd2); },
    (state: typeof original) => { state.entities.writeInt16LE(-2, slot * 220 + 0xd4); },
    (state: typeof original) => { state.policy.writeInt16LE(800, listBase + 0x1faa); },
    (state: typeof original) => { state.policy.writeInt16LE(-1, listBase + 0x1fac); },
    (state: typeof original) => { state.policy.writeInt16LE(-1, listBase + 0x1ea6); },
    (state: typeof original) => { state.policy.writeInt16LE(256, listBase + 0x1ea6); },
    (state: typeof original) => { state.policy.writeInt32LE(256, listBase + 0x1ea0); },
    (state: typeof original) => { state.entities.writeUInt16LE(state.navigation.width * 256, slot * 220); },
    (state: typeof original) => { state.forceOrder = 256; },
    (state: typeof original) => { state.navigation.nextFamily = state.navigation.nextFamily.subarray(1); },
    (state: typeof original) => { state.policy = state.entities.subarray(0, LEGACY_AI_LAYOUT.policyBytes); },
  ];
  for (const mutate of mutations) {
    const state = orderFixture(result, capture);
    mutate(state);
    const before = [hash(state.policy), hash(state.entities), state.forceOrder];
    assert.throws(() => consumeLegacyAiGroupOrders(state, 1), RangeError);
    assert.deepEqual([hash(state.policy), hash(state.entities), state.forceOrder], before);
  }
  const state = orderFixture(result, capture);
  const backing = Buffer.alloc(16 + state.policy.length + state.entities.length + 16, 0x77);
  state.policy.copy(backing, 16);
  state.entities.copy(backing, 16 + state.policy.length);
  state.entities = backing.subarray(16 + state.policy.length, backing.length - 16);
  state.policy = backing.subarray(16, 16 + state.policy.length);
  consumeLegacyAiGroupOrders(state, 1);
  assert.equal(hash(state.entities), hash(Buffer.from(capture.after.entities, "base64")));
  assert.ok(backing.subarray(0, 16).every((value) => value === 0x77));
  assert.ok(backing.subarray(-16).every((value) => value === 0x77));
});

test("original compiled scans expose omitted projectile updates without overstating activation history", () => {
  const [human, alien] = runNative("--activation-scan").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(human.completedScanCounters, Array.from({ length: 2896 / 8 + 1 }, (_, index) => index * 8));
  assert.deepEqual(alien.completedScanCounters, Array.from({ length: 1136 / 8 + 1 }, (_, index) => index * 8));
  assert.equal(human.attemptedCounter, 2901);
  assert.equal(human.selector, 4);
  assert.equal(human.eip, "0x46c996");
  assert.match(human.failure, /caller=0x44161f/);
  assert.equal(human.contiguousWorld.projectileAllocationCounter, 2024);
  assert.equal(human.contiguousWorld.registers.ESI, "0x7e7");
  assert.equal(human.acceptance.allFourGroupsReturned, false);
  assert.deepEqual(human.groupCompletions, []);
  assert.equal(alien.attemptedCounter, 1136);
  assert.equal(alien.selector, 3);
  assert.equal(alien.failure, null);
  assert.equal(alien.acceptance.allFourGroupsReturned, true);
  assert.deepEqual(alien.groupCompletions.map((entry: { group: number }) => entry.group), [0, 1, 2, 3]);
  assert.equal(human.acceptance.actorOrdersConsumed, 0);
  assert.equal(human.acceptance.emptyOrdersRejected, true);
  assert.equal(alien.acceptance.actorOrdersConsumed, 7);
  assert.equal(alien.acceptance.emptyOrdersRejected, false);
  assert.ok(alien.taskConsumptionProbe.actors.every((actor: { pendingBefore: number; pendingAfter: number; taskStackChanged: boolean }) =>
    actor.pendingBefore === 1 && actor.pendingAfter === 0 && actor.taskStackChanged));
  for (const result of [human, alien]) {
    assert.equal(result.acceptance.completeWorldHistory, false);
    assert.equal(result.worldServices.failure, null);
    assert.equal(result.worldServices.eip, "0x419990");
    assert.deepEqual(result.worldServices.sourceRelations.allocationBytes, [8, 8]);
    assert.equal(result.admitted, false);
    assert.equal(result.allSourceConsumed, true);
    for (const name of ["SAWS", "DROP", "SAUC"]) {
      assert.ok(result.carrierAnimations.sources.some((source: { source: string; sha256: string }) =>
        source.source === `raw_cd/DC/ANIMATE/${name}.FIN` && /^[0-9a-f]{64}$/.test(source.sha256)));
    }
    for (const unitType of [92, 93]) assert.ok(result.carrierAnimations.profiles
      .find((profile: { unitType: number }) => profile.unitType === unitType)?.banks["0x7c"]);
  }
});

test("native relation constructors and SCN population preserve adversarial alliances and visibility", () => {
  const results = runNative("--world-service-boundary").trim().split("\n").map((line) => JSON.parse(line));
  const ownMasks = Array.from({ length: 8 }, (_, owner) => 0x40000000 >>> owner);
  for (const [index, result] of results.entries()) {
    const world = result.worldServices;
    assert.equal(result.admitted, false);
    assert.equal(world.failure, null);
    assert.equal(world.eip, "0x419990");
    assert.equal(world.calls.filter((call: { entry: string }) => call.entry === "0x41e820").length, 128);
    assert.equal(world.sourceRelations.poisonClearedByNative, true);
    assert.equal(world.sourceRelations.guardsIntact, true);
    assert.deepEqual(world.sourceRelations.allocationBytes, [8, 8]);
    assert.deepEqual(world.sourceRelations.allianceRows, index === 0
      ? [19, 19, 12, 12, 19, 32, 64, 128] : [1, 6, 6, 8, 16, 32, 64, 128]);
    assert.deepEqual(world.sourceRelations.visibilityRows, [1, 2, 4, 8, 16, 32, 64, 128]);
    assert.deepEqual(world.allianceCache, world.sourceRelations.mutualAlliances);
    assert.deepEqual(world.visibilityMasks, ownMasks);
    type Control = { label: string; failure: null; primedBeforeChanges: boolean;
      allianceCache: number[][]; visibilityMasks: number[]; relationRows: number[][] };
    const controls = new Map<string, Control>(world.adversarialControls.map((control: Control) => [control.label, control]));
    assert.equal(controls.size, 8);
    for (const control of controls.values()) {
      assert.equal(control.failure, null);
      assert.equal(control.primedBeforeChanges, true);
    }
    assert.equal(controls.get("unilateral-alliance")!.allianceCache[0][7], 0);
    const mutual = controls.get("mutual-alliance-no-shared-vision")!;
    assert.equal(mutual.allianceCache[0][7], 1);
    assert.equal(mutual.allianceCache[7][0], 1);
    assert.deepEqual(mutual.visibilityMasks, ownMasks);
    const chain = controls.get("nontransitive-alliance")!;
    assert.equal(chain.allianceCache[0][7], 1);
    assert.equal(chain.allianceCache[7][6], 1);
    assert.equal(chain.allianceCache[0][6], 0);
    assert.deepEqual(controls.get("unilateral-vision")!.visibilityMasks, ownMasks);
    const vision = controls.get("mutual-vision-no-alliance")!;
    assert.equal(vision.allianceCache[0][7], 0);
    assert.equal(vision.visibilityMasks[0], ownMasks[0] | ownMasks[7]);
    assert.equal(vision.visibilityMasks[7], ownMasks[0] | ownMasks[7]);
    const [sourceOwner, sourceAlly] = index === 0 ? [0, 1] : [1, 2];
    assert.equal(world.allianceCache[sourceOwner][sourceAlly], 1);
    assert.equal(controls.get("revoke-source-alliance")!.allianceCache[sourceOwner][sourceAlly], 0);
    assert.equal(controls.get("revoke-source-alliance")!.allianceCache[sourceAlly][sourceOwner], 0);
    assert.equal(controls.get("clear-vision-diagonal")!.relationRows[1][0], 0);
    assert.deepEqual(controls.get("clear-vision-diagonal")!.visibilityMasks, ownMasks);
    assert.deepEqual(controls.get("revoke-shared-vision")!.visibilityMasks, ownMasks);
  }
});

test("native path construction preserves source families and rejects zero-family ground origins", () => {
  const results = runNative("--path-initialization-proof").trim().split("\n").map((line) => JSON.parse(line));
  for (const [index, result] of results.entries()) {
    assert.equal(result.initialization.entry, "0x442b7c");
    assert.equal(result.initialization.bytesRead, 73600);
    assert.deepEqual(result.initialization.allocationBytes, [568]);
    assert.equal(result.initialization.cellStride, 24);
    assert.equal(result.initialization.familyOffset, 12);
    assert.equal(result.initialization.cacheOffset, 13);
    assert.deepEqual(result.initialization.coordinateOffsets, [8, 9]);
    assert.equal(result.initialization.routeSentinelOffset, 4);
    assert.equal(result.initialization.sourceYMatches, true);
    const [ground, blocked, air] = result.controls;
    assert.deepEqual(ground.origin, index === 0 ? [43, 68] : [6, 54]);
    assert.ok(ground.family > 0);
    assert.equal(ground.movementClass, 0);
    assert.equal(ground.failure, null);
    assert.deepEqual(blocked.origin, index === 0 ? [42, 67] : [4, 52]);
    assert.equal(blocked.family, 0);
    assert.equal(blocked.failure, "native diagnostic at 0x46c996; caller=0x414faf");
    assert.equal(blocked.eip, "0x46c996");
    assert.equal(air.family, 0);
    assert.equal(air.movementClass, 1);
    assert.equal(air.failure, null);
    assert.ok(air.calls.some((call: { entry: string }) => call.entry === "0x444628"));
    for (const control of result.controls) {
      assert.equal(control.sourcePthUnchanged, true);
      assert.equal(control.worldTicks, 0);
      assert.equal(control.constructor, "0x41af14");
      assert.equal(control.taskBuilder, "0x414ce4");
    }
    assert.equal(result.admitted, false);
  }
});

test("path cell coordinate omissions reproduce the literal native origin-family failure", () => {
  const results = runNative("--path-cell-controls").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(results.length, 6);
  for (const result of results) {
    const human = result.mission === "HUMAN02";
    const expected = result.pathCellControl === "zero-sentinel" ? 64 : (human ? 49 : 36);
    assert.equal(result.contiguousWorld.completedUpdates, expected);
    assert.deepEqual(result.nativeAudit.runtimeCoreInterceptions, []);
    if (expected === 64) {
      assert.equal(result.failure, null);
    } else {
      assert.match(result.failure, /caller=0x414faf/);
      assert.equal(result.nativeAudit.pathBoundary.sourceFamily, 0);
      assert.equal(result.nativeAudit.pathBoundary.family, 0);
      assert.equal(result.nativeAudit.pathBoundary.airDispatchFlag, 0);
    }
    assert.equal(result.admitted, false);
  }
});

test("complete native SCN loader matches source teams, pristine actors and browser colony projection", () => {
  const results = (process.env.DC_AI_SOURCE_TRACE ? readFileSync(process.env.DC_AI_SOURCE_TRACE, "utf8")
    : runNative("--source-initialization-proof")).trim().split("\n").map((line) => JSON.parse(line));
  const units = parseUnitStats(readFileSync(new URL("raw_cd/DC/GAMESTAT/GAMESTAT.TXT", root), "utf8"));
  const sourceTypes = readFileSync(new URL("raw_cd/DC/GAMESTAT/GAMESTAT.TXT", root), "utf8").split(/\r?\n/)
    .map((line) => line.trim()).filter((line) => line && !line.startsWith("%")).slice(1)
    .map((line) => line.split(/\s+/));
  for (const result of results) {
    const faction = result.mission.slice(0, -2);
    const scenario = parseScenario(readFileSync(new URL(`raw_cd/DC/SCENARIO/${faction}/${result.mission}.SCN`, root), "utf8"));
    const source = result.sourceScnInitialization;
    assert.equal(source.entry, "0x41b920");
    assert.equal(source.returned, true);
    assert.deepEqual(source.cityCalls, Array.from({ length: 120 }, (_, index) => [Math.floor(index / 15), index % 15]));
    assert.deepEqual(source.policyRng, { startup: "0x40150b..0x401515", scnSetter: "0x41b931..0x41b938",
      setter: "0x411da4", seed: 0, poisonBeforeEachSetter: 197, afterScnSetter: 0, afterLoader: 0 });
    assert.deepEqual(result.policySeedControls, [0, 1, 255, 256, 0x1234].map((seed) => ({
      seed, startup: seed & 255, scn: seed & 255, poison: 197,
    })));
    assert.deepEqual(source.resourceScales, { calls: ["0x419d60", "0x4012b4..0x4012e6", "0x4014c6..0x4014ed",
      "0x40183b..0x40185f"], rate: 256, reserve: 256 });
    for (const profile of result.animations.profiles) {
      const bytes = Buffer.from(profile.typeBytes, "hex");
      assert.equal(bytes.length, 280);
      assert.equal(profile.idleControl.sourceToken, 20);
      assert.equal(profile.idleControl.scannerArgument, "0x43bc2f");
      assert.equal(profile.idleControl.sourceValue, Number(sourceTypes[profile.unitType][20]));
      assert.equal(profile.idleControl.nativeValue, bytes.readInt32LE(0xdc));
      assert.equal(profile.idleControl.nativeValue, profile.idleControl.sourceValue);
      assert.equal(profile.idleVariantCount, bytes.readInt32LE(0xd8));
      assert.equal(Number(profile.constructionBank), bytes.readUInt32LE(0x98));
      if ([16, 17, 28, 29].includes(profile.unitType)) assert.ok(bytes.readUInt32LE(0x98) !== 0);
    }
    for (const team of scenario.teams) {
      const actual = source.teams[team.index];
      const bytes = Buffer.from(actual.raw, "hex");
      assert.equal(bytes.length, 0xe30);
      assert.equal(bytes.readInt32LE(0x20), team.race);
      assert.equal(bytes.readInt32LE(0x14), team.money);
      assert.equal(bytes.readInt32LE(0x24), team.ai);
      assert.equal(actual.colour, team.teamColor);
      const dependencies = new Set(team.dependencies);
      if (!team.coordinateRows[1][0] || !team.coordinateRows[1][1]) {
        dependencies.add(0);
        dependencies.add(14);
      }
      assert.deepEqual(actual.dependencies, [...dependencies].sort((left, right) => left - right));
      assert.deepEqual(actual.queueEnabled, [1, 1, 1, 1]);
      assert.deepEqual(actual.queueWords, [-1, -1, -1, -1]);
      assert.equal(actual.flags, 3);
      assert.deepEqual([...bytes.subarray(0x10c, 0x118)], Array(12).fill(0));
      assert.deepEqual([bytes.readInt32LE(0x34), bytes.readInt32LE(0x38)], team.coordinateRows[0].some(Boolean)
        ? team.coordinateRows[0] : team.coordinateRows[1]);
      assert.deepEqual([bytes.readInt32LE(0x2c), bytes.readInt32LE(0x30)], team.coordinateRows[1]);
    }
    const entities = Buffer.from(source.entities, "base64");
    const registry = Buffer.from(source.registry, "base64");
    assert.equal(entities.length, 800 * 220);
    assert.equal(registry.length, 1600);
    type Actor = { slot: number; type: number; owner: number; positionQ8: number[]; health: number; raw: string; footprint: number[][] };
    const actors = source.actors as Actor[];
    assert.deepEqual(Array.from({ length: 800 }, (_, slot) => slot).filter((slot) => registry.readInt16LE(slot * 2) !== -1),
      actors.map(({ slot }) => slot));
    for (const actor of actors) {
      assert.equal(registry.readInt16LE(actor.slot * 2), actor.slot);
      assert.equal(entities.subarray(actor.slot * 220, (actor.slot + 1) * 220).toString("hex"), actor.raw);
    }
    const projection = projectLegacyColony(scenario.teams, units);
    const cities = actors.filter(({ slot }) => slot < 152);
    assert.equal(cities.length, projection.buildings.length);
    assert.deepEqual(cities.map(({ slot }) => slot), [0, 1, 5]);
    for (const building of projection.buildings) {
      const actor = cities.find(({ slot }) => slot === building.nativeId)!;
      assert.equal(actor.type, building.unitType);
      assert.equal(actor.owner, building.team);
      assert.equal(actor.health, building.health);
      assert.deepEqual(actor.positionQ8, [building.nativePosition.x, building.nativePosition.y]);
      const points = (values: number[][]) => values.map(([tileX, tileY]) => `${tileX},${tileY}`).sort();
      assert.deepEqual(points(actor.footprint), points(building.footprint.map(({ x, y }) => [x, y])));
      const bytes = Buffer.from(actor.raw, "hex");
      assert.equal(bytes[0x39 + bytes[0x38] * 2], 19);
      assert.equal(bytes.readUInt16LE(0x46 + bytes[0x3a + bytes[0x38] * 2] * 2), 0);
    }
    const placements = scenario.placementRows.filter((row) => row[3] !== -1);
    assert.equal(actors.filter(({ slot }) => slot >= 152).length, placements.length);
    placements.forEach((row, index) => {
      const actor = actors.find(({ slot }) => slot === 152 + index)!;
      assert.equal(actor.type, row[2]);
      assert.equal(actor.owner, row[2] === 40 ? 8 : row[3]);
      assert.deepEqual(actor.positionQ8, [row[0] * 256 + 128, row[1] * 256 + 128]);
      assert.equal(actor.health, row[4] < 0 ? units[row[2]].health : row[4]);
    });
    for (const entry of ["0x445570", "0x41822c", "0x437bc4", "0x44ac28", "0x41af14", "0x41e7a0", "0x41e7d8"]) {
      assert.ok(source.setupCalls.some((call: { entry: string }) => call.entry === entry), entry);
      assert.ok(!source.externalBoundaries.some((call: { entry: string }) => call.entry === entry), entry);
    }
    assert.equal(result.admitted, false);
  }
});

test("original fresh local session records natural activation and target-specific later-world feedback", () => {
  const results = (process.env.DC_AI_HUMAN_WORLD_TRACE && process.env.DC_AI_ALIEN_WORLD_TRACE
    ? [process.env.DC_AI_HUMAN_WORLD_TRACE, process.env.DC_AI_ALIEN_WORLD_TRACE].map((path) => readFileSync(path, "utf8")).join("\n")
    : process.env.DC_AI_WORLD_TRACE ? readFileSync(process.env.DC_AI_WORLD_TRACE, "utf8")
      : runNative("--world-activation-scan")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.deepEqual(results.map((result) => result.mission), ["HUMAN02", "ALIEN02"]);
  for (const [index, result] of results.entries()) {
    const updates = index === 0 ? 14160 : 1200;
    const session = result.sessionTransport;
    assert.equal(session.factory, "0x40bb6c");
    assert.equal(session.module, "local.c");
    assert.equal(session.constructor, "0x40ba00");
    assert.equal(session.assignment, "0x4013a6..0x401405");
    assert.equal(session.serverConstructor, "0x40b050");
    assert.equal(session.receiveInitializer, "0x41b9d3..0x41bab7");
    assert.deepEqual(session.allocations.map((allocation: { length: number }) => allocation.length), [128, 65572, 588]);
    assert.equal(session.guardsIntact, true);
    assert.equal(session.transportBytes, "100040020000a5a50100000000000000");
    assert.deepEqual(session.queueLengths, [0, 0, 0, 0]);
    assert.equal(session.methods["0x5c"], "0x40b810");
    assert.equal(session.methods["0x60"], "0x40b8e4");
    assert.equal(session.methods["0x74"], "0x43ace8");
    assert.equal(session.readyPacket, "07007600000200");
    assert.equal(session.readyState, 2);
    assert.deepEqual(session.profile.header, [1, 0, index, 0, 0, 0, 0, 0]);
    assert.equal(result.eip, "0x70d000");
    assert.equal(result.failure, null);
    assert.equal(result.sourcePathInitialization.entry, "0x442b7c");
    assert.equal(result.sourcePathInitialization.sourceYMatches, true);
    assert.equal(result.pathCellControl ?? null, null);
    assert.equal(result.contiguousWorld.enabled, true);
    assert.equal(result.contiguousWorld.completedUpdates, updates);
    assert.equal(result.attemptedCounter, updates);
    assert.deepEqual(result.completedScanCounters, Array.from({ length: Math.floor(updates / 8) }, (_, counter) => (counter + 1) * 8));
    assert.equal(result.contiguousWorld.nativeReset.projectileRecords, 2024);
    assert.equal(result.contiguousWorld.nativeReset.projectileStride, 40);
    assert.deepEqual(result.contiguousWorld.nativeReset.projectileHeads, [-1, -1]);
    assert.ok(result.contiguousWorld.changedEntityBytes > 0);
    for (const address of ["0x4456f0", "0x44a6d4", "0x439f40", "0x44293c"]) {
      assert.equal(result.contiguousWorld.stages.filter((stage: { address: string }) => stage.address === address).length,
        address === "0x44293c" ? updates : index === 0 ? 886 : 76);
    }
    const audit = result.nativeAudit;
    assert.equal(audit.worldEntries, updates);
    assert.equal(audit.worldReturns, updates);
    assert.equal(audit.policyRngDraws, index === 0 ? 57047 : 1724);
    assert.equal(audit.crtRngDraws, index === 0 ? 13666 : 0);
    for (const entry of ["0x441710", "0x4121d8"]) {
      assert.equal(audit.combatEvents.filter((call: { entry: string }) => call.entry === entry).length,
        index === 0 ? 13661 : 0);
    }
    assert.equal(audit.projectileReclaims, index === 0 ? 13651 : 0);
    assert.equal(result.contiguousWorld.projectileAllocationCounter, index === 0 ? 18 : 0);
    assert.deepEqual(audit.runtimeCoreInterceptions, []);
    assert.equal(audit.pathBoundary, null);
    assert.equal(audit.ticks.length, updates);
    for (const [tickIndex, tick] of audit.ticks.entries()) {
      assert.equal(tick.frame, tickIndex + 1);
      assert.equal(tick.troCounter, tick.frame);
      assert.ok(Number.isInteger(tick.sourceClock) && tick.sourceClock >= 0);
      assert.equal(tick.relations, audit.ticks[0].relations);
      assert.deepEqual(tick.visibilityMasks, Array.from({ length: 8 }, (_, owner) => 0x40000000 >>> owner));
    }
    assert.equal(audit.ticks.at(-1).entitiesSha256, index === 0
      ? "8eefcbb58517b6f00a819dbb90c4a99e41945caa45dca19658edbd242c8a513d"
      : "f79c35c48d238c6c977309321e539c87f3d17bd1d955b14ff15937b4dcf16d12");
    assert.equal(audit.ticks.at(-1).sourceClock, index === 0 ? 357 : 149);
    assert.equal(result.submittedOrders.length, index === 0 ? 17676 : 1287);
    assert.ok(result.debugOutputBoundaries.length > 0);
    assert.deepEqual(result.sourceClock.phasePeriodTimeTransition, result.mission === "HUMAN02"
      ? [0, 6300, 5100, 75] : [1, 6750, 5700, 75]);
    assert.equal(result.selector, 3);
    assert.equal(result.acceptance.allFourGroupsReturned, true);
    assert.deepEqual(result.groupCompletions.map((group: { group: number }) => group.group), [0, 1, 2, 3]);
    const activationFrame = index === 0 ? 14124 : 1160;
    const targetTeam = index === 0 ? 2 : 1;
    const packets = result.submittedOrders.filter((order: { frame: number; team: number; packet: string }) =>
      order.frame === activationFrame && order.team === targetTeam && Buffer.from(order.packet, "hex")[2] === 7)
      .map((order: { packet: string }) => Buffer.from(order.packet, "hex"));
    assert.equal(packets.length, index === 0 ? 3 : 10);
    assert.equal(packets.filter((packet: Buffer) => packet.readUInt16LE(4) === 0).length, 3);
    assert.equal(packets.filter((packet: Buffer) => packet.readUInt16LE(4) !== 0).length, index === 0 ? 0 : 7);
    const receipts = result.orderConsumption.filter((receipt: { frame: number }) => receipt.frame === activationFrame);
    assert.equal(receipts.filter((receipt: { changedEntities: unknown[] }) => receipt.changedEntities.length > 0).length,
      index === 0 ? 0 : 7);
    assert.ok(receipts.filter((receipt: { changedEntities: unknown[] }) => !receipt.changedEntities.length)
      .every((receipt: { reason: string }) => receipt.reason === "native-decoder-no-entity-writes"));
    for (const group of result.groupCompletions) {
      assert.equal(group.frame, activationFrame);
      assert.equal(group.team, targetTeam);
      assert.deepEqual(group.schedulerVisit, { team: targetTeam, frame: activationFrame,
        caller: "0x41aca1", update: activationFrame - 1, mode: 3 });
      assert.deepEqual(group.returns, ["0x44bed7", "0x44bee7", "0x44bef8", "0x44bf09"]);
      for (const [label, length] of [["policy", 0x6c40], ["entities", 800 * 220]] as const) {
        const before = Buffer.from(group[label].before, "base64");
        const after = Buffer.from(group[label].after, "base64");
        assert.equal(before.length, length);
        assert.equal(after.length, length);
        assert.equal(hash(before), group[label].beforeSha256);
        assert.equal(hash(after), group[label].afterSha256);
        assert.equal(before.reduce((count, value, offset) => count + Number(value !== after[offset]), 0), group[label].changedBytes);
      }
    }
    assert.ok(result.schedulerVisits.every((visit: { caller: string }) => ["0x41ac71", "0x41aca1"].includes(visit.caller)));
    assert.equal(result.fixtureInterfaces.activationPolicy, "only historical round-robin 0x41ac2c calls; no extra selector or actor dispatch");
    assert.equal(result.taskConsumptionProbe.scope, "registered dispatcher returns inside subsequent original world ticks");
    const feedback = result.taskConsumptionProbe.actors.filter((actor: { team: number; receivedFrame: number; pendingAfter: number }) =>
      actor.team === targetTeam && actor.receivedFrame >= activationFrame && actor.pendingAfter === 0);
    assert.deepEqual(feedback.map((actor: { slot: number }) => actor.slot), index === 0 ? [] : [160, 161, 162, 165, 166, 167, 199]);
    for (const actor of feedback) {
      assert.equal(actor.pendingBefore, 1);
      assert.equal(actor.frame, 1161);
      assert.equal(actor.receivedFrame, 1160);
      assert.ok(actor.taskStackChanged);
      assert.ok(actor.handlers.includes("0x412014"));
      assert.equal(actor.reason, "native-pending-cleared");
      assert.equal(Buffer.from(actor.before, "hex").length, 220);
      assert.equal(Buffer.from(actor.after, "hex").length, 220);
    }
    assert.equal(result.acceptance.actorOrdersConsumed, index === 0 ? 81 : 7);
    assert.equal(result.acceptance.targetActorOrdersConsumed, feedback.length);
    assert.deepEqual(result.acceptance.targetActorSlots, feedback.map((actor: { slot: number }) => actor.slot));
    assert.equal(result.acceptance.targetEmptyOrdersRejected, index === 0);
    assert.equal(result.acceptance.subsequentWorldFeedback, index === 1);
    assert.equal(result.acceptance.sourceInitializationComplete, true);
    assert.equal(result.acceptance.naturalSchedulerActivation, true);
    assert.equal(result.acceptance.completeWorldHistory, true);
    assert.equal(result.sourceScnInitialization.cityCalls.length, 120);
    assert.deepEqual(result.sourceScnInitialization.actors.filter((actor: { slot: number }) => actor.slot < 152)
      .map((actor: { slot: number }) => actor.slot), [0, 1, 5]);
    assert.equal(result.admitted, false);
  }
});
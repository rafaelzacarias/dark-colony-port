import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CampaignSession } from "../../src/engine/campaign-session";
import { applyLegacyAiActorPacket, decodeLegacyAiActorPacket } from "../../src/engine/legacy-ai-policy";
import { reduceLegacyAiRegisteredVisit, type LegacyAiRegisteredWorld } from "../../src/engine/legacy-ai-task";
import { createSourceNativePlayerOrder, type SourceNativePlayerBinding, type SourceNativePlayerCommandContext,
  type SourceNativePlayerOrder } from "../../src/engine/source-native-player-orders";
import { transportHostState, type HostSlot } from "../../src/engine/transport-host";
import { createNativeCombatMissionFixture, nativeCombatInput, nativeCombatPacket } from "./fixtures/native-combat-mission";

const binding = (actor: HostSlot): SourceNativePlayerBinding => ({ slot: actor.slot, generation: actor.generation,
  key: actor.key, raw: [...actor.nativeAiTask!.raw] });
type NativeIdentity = Pick<HostSlot, "slot" | "team" | "position">;
function nativePacket(packet: readonly number[], source: NativeIdentity, target?: NativeIdentity, consume = true) {
  const identity = (actor: NativeIdentity) => ({ slot: actor.slot, team: actor.team,
    column: actor.position.x >>> 8, row: actor.position.y >>> 8 });
  const proof = JSON.parse(execFileSync("python3", [new URL("source-native-player-orders-native.py", import.meta.url).pathname, "--packet"], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024, input: JSON.stringify({ packet, consume, source: identity(source),
      ...(target ? { target: identity(target) } : {}) }), env: { ...process.env,
      PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
  }));
  assert.deepEqual(proof.packet, packet);
  assert.equal(proof.binarySha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  assert.deepEqual(proof.runtimeIntercepts, []);
  assert.equal(proof.consumed, consume);
  if (consume) assert.equal(proof.stack[0].task, packet[5] === 13 ? 1 : packet[5]);
  assert.equal(proof.before[6], 0);
  assert.equal(proof.received[7], source.team);
  const entities = new Uint8Array(800 * 220);
  entities.set(proof.before, source.slot * 220);
  applyLegacyAiActorPacket(entities, Uint8Array.from(packet));
  assert.deepEqual([...entities.slice(source.slot * 220, (source.slot + 1) * 220)], proof.received);
  assert.deepEqual(proof.received.slice(0x36, 0x38), [1, packet[5]]);
  if (consume) assert.deepEqual(proof.after.slice(0x36, 0x38), [0, 255]);
  else assert.deepEqual(proof.after, proof.received);
  assert.equal(proof.originalRegistry.filter((slot: number) => slot !== -1).length, 21);
  proof.originalRegistry.forEach((entry: number, slot: number) => {
    if (entry !== -1) assert.equal(proof.registry[slot], entry);
  });
  if (target) {
    assert.equal(proof.target.enemySlot, target.slot);
    assert.equal(proof.target.enemyRaw[7], target.team);
    assert.equal(proof.target.enemyRaw[6], 0);
    assert.equal(proof.target.acquired, target.slot);
    const visibility = proof.target.visibility;
    assert.equal(visibility.before >>> 31, 0);
    assert.equal(visibility.after >>> 30, 3);
    assert.equal(visibility.counter, 16);
    assert.equal(visibility.localTeam, source.team);
    assert.equal(visibility.mask, 0x40000000);
    assert.equal(visibility.producer, source.slot);
    assert.ok(!visibility.excluded.includes(source.slot));
    assert.ok(visibility.excluded.includes(target.slot));
    assert.deepEqual(visibility.phases, ["0x4456f0", "0x44a6d4"]);
    assert.equal(visibility.terrain.loader, "0x453421..0x453790");
    const orders = decodeLegacyAiActorPacket(Uint8Array.from(packet));
    assert.deepEqual(orders.map(order => order.mode), [5, 7]);
    assert.ok(orders[1].mode === 7);
    assert.deepEqual(orders[1].slots, [source.slot]);
    assert.ok(!orders[1].slots.includes(target.slot));
  }
  return proof;
}

test("player commands: fresh x86 Attack receiver uses computed canonical victim visibility and recipient slot", () => {
  const source = { slot: 170, team: 0, position: { x: 67 * 256 + 128, y: 48 * 256 + 128 } };
  const target = { slot: 171, team: 2, position: { x: 69 * 256 + 128, y: 48 * 256 + 128 } };
  const proof = nativePacket(nativeCombatPacket(source.slot, 68, 48, 7), source, target, false);
  assert.equal(proof.target.visibility.cell, 4677);
  assert.equal(proof.target.visibility.before, 0xab);
  assert.equal(proof.target.visibility.after, 0xc00000ab);
});
const fixture = createNativeCombatMissionFixture();
async function prepared() {
  const { mission, column, row } = await fixture;
  const session = new CampaignSession(mission.sourceNativeCombat!.options);
  for (let counter = 1; counter <= 16; counter++) {
    const result = session.step(nativeCombatInput(session.snapshot));
    assert.ok(result.ok, JSON.stringify(result));
  }
  const host = transportHostState(session.snapshot.world);
  const source = host.slots.find(actor => actor?.key.startsWith("transport:") && actor.team === 0)!;
  const target = host.slots.find(actor => actor?.key.startsWith("transport:") && actor.team === 5)!;
  const context = (): SourceNativePlayerCommandContext => {
    const state = session.snapshot;
    return { world: state.world, localTeam: 0, selected: [binding(transportHostState(state.world).slots[source.slot]!)],
      id: `player:${state.cycleCounter + 1}`, frame: nativeCombatInput(state) };
  };
  return { session, column, row, source, target, context };
}

test("player commands: source authenticated one-packet MoveOnly/Stop receipts consumed by existing session", async () => {
  const { session, column, row, context, source } = await prepared();
  const before = session.checkpoint(), original = context();
  const move = createSourceNativePlayerOrder(original, { type: "MoveOnly", destination: { column: column + 2, row } });
  assert.ok(move.ok, JSON.stringify(move));
  assert.equal(move.scope, "typed-native-command-api-not-ui-parity");
  assert.deepEqual(session.checkpoint(), before);
  assert.deepEqual(move.input.nativeAiReceipt.packets, [nativeCombatPacket(source.slot, column + 2, row)]);
  nativePacket(move.input.nativeAiReceipt.packets[0], source);
  assert.equal(move.input.clockMilliseconds, original.frame.clockMilliseconds);
  assert.deepEqual(move.input.nativeAiFrame, original.frame.nativeAiFrame);
  assert.equal(move.input.nativeAiReceipt.expected.length,
    transportHostState(original.world).nativeAiTasks!.configuration.bindings.length);
  assert.ok(Object.isFrozen(move.input.nativeAiReceipt.expected[0].raw));
  assert.throws(() => (move.input.nativeAiReceipt.packets[0] as number[])[5] = 7, TypeError);
  const stepped = session.step(move.input);
  assert.ok(stepped.ok, JSON.stringify(stepped));
  assert.equal(transportHostState(session.snapshot.world).slots[source.slot]!.nativeAiTask!.raw[0x39], 2);
  const stop = createSourceNativePlayerOrder(context(), { type: "Stop" });
  assert.ok(stop.ok, JSON.stringify(stop));
  assert.deepEqual(stop.input.nativeAiReceipt.packets, [[7, 0, 5, source.slot & 255, source.slot >>> 8, 13, 0]]);
  nativePacket(stop.input.nativeAiReceipt.packets[0], source);
  const stopped = session.step(stop.input);
  assert.ok(stopped.ok, JSON.stringify(stopped));
  for (let count = 0; count < 60; count++) {
    const actor = transportHostState(session.snapshot.world).slots[source.slot]!;
    if (actor.nativeAiTask!.raw[0x39] === 1 && actor.nativeAiTask!.raw[0x36] === 0) break;
    const result = session.step(nativeCombatInput(session.snapshot));
    assert.ok(result.ok, JSON.stringify(result));
  }
  const final = transportHostState(session.snapshot.world).slots[source.slot]!;
  assert.equal(final.nativeAiTask!.raw[0x39], 1);
  assert.equal(final.nativeAiTask!.raw[0x36], 0);
  const staleBefore = session.checkpoint();
  assert.equal(session.step(move.input).ok, false);
  assert.deepEqual(session.checkpoint(), staleBefore);
});

test("player commands: guards reject without publishing or changing input world", async () => {
  const { context, column, row, target } = await prepared();
  const base = context(), move: SourceNativePlayerOrder = { type: "MoveOnly", destination: { column: column + 2, row } };
  const reject = (input: SourceNativePlayerCommandContext, command: SourceNativePlayerOrder, diagnostic: RegExp) => {
    const before = structuredClone(input.world), result = createSourceNativePlayerOrder(input, command);
    assert.equal(result.ok, false, JSON.stringify(result));
    if (result.ok) return;
    assert.equal(result.kind, "UnsupportedPath");
    assert.match(result.diagnostic, diagnostic);
    assert.equal("input" in result, false);
    assert.deepEqual(input.world, before);
  };
  reject({ ...base, selected: [binding(target)] }, move, /Enemy selection/);
  reject({ ...base, selected: [{ ...base.selected[0], generation: base.selected[0].generation + 1 }] }, move, /Stale/);
  for (const raw of [Array<number>(220), [...base.selected[0].raw]]) {
    delete raw[9];
    reject({ ...base, selected: [{ ...base.selected[0], raw }] }, { type: "Stop" }, /Stale/);
  }
  reject(base, { type: "Attack", destination: { column: column + 2, row },
    target: { ...binding(target), raw: Array<number>(220) } }, /Stale/);
  reject({ ...base, selected: [{ ...base.selected[0], raw: base.selected[0].raw.map((value, index) => index === 9 ? value ^ 1 : value) }] }, move, /Stale/);
  reject({ ...base, selected: [] }, move, /one selected/);
  reject({ ...base, selected: [base.selected[0], base.selected[0]] }, move, /one selected/);
  reject(base, { type: "MoveOnly", destination: { column: 65536, row } }, /in-bounds/);
  reject(base, { type: "MoveOnly", destination: { column: -1, row } }, /in-bounds/);
  reject(base, { type: "MoveOnly", destination: { column: column + 0.5, row } }, /in-bounds/);
  reject(base, { type: "MoveOnly", destination: { column: column + 4, row } }, /General route/);
  reject(base, { type: "MoveOnly", destination: { column: column + 1, row: row + 1 } }, /General route/);
  reject(base, { type: "Assault" } as unknown as SourceNativePlayerOrder, /Unproved command/);
  reject(base, { type: "Attack", destination: { column: column + 2, row }, target: { ...binding(target), generation: 999 } }, /Stale/);
  const hidden = structuredClone(base);
  const hiddenHost = transportHostState(hidden.world);
  const targetCell = (target.position.y >>> 8) * hiddenHost.width + (target.position.x >>> 8);
  hiddenHost.nativeAiTasks!.ground[targetCell] &= ~hiddenHost.nativeAiTasks!.configuration.profiles[0].enemyMask;
  reject({ ...hidden, world: { ...hidden.world, transportState: hiddenHost } },
    { type: "Attack", destination: { column: column + 2, row }, target: binding(target) }, /Hidden/);
  reject({ ...base, frame: { ...base.frame, nativeAiReceipt: { id: "other", packets: [], expected: [] } } } as SourceNativePlayerCommandContext,
    move, /existing receipt/);
  const unauthenticated = structuredClone(base);
  const unauthenticatedHost = transportHostState(unauthenticated.world);
  unauthenticatedHost.nativeAiTasks!.configuration = { ...unauthenticatedHost.nativeAiTasks!.configuration, sourceId: "invented" };
  reject({ ...unauthenticated, world: { ...unauthenticated.world, transportState: unauthenticatedHost } }, move, /Authenticated/);
  const unowned = transportHostState(base.world).slots.find(actor => actor?.nativeAiTask && actor.unitType !== 0)!;
  reject({ ...base, selected: [binding(unowned)] }, { type: "Stop" }, /unowned type/);
});

test("player commands: visible native acquisition Attack consumes bounded packet and produces real damage", async () => {
  const { session, source, target, column, row, context } = await prepared();
  for (let counter = 17; counter <= 79; counter++) {
    const packets = counter === 17 ? [nativeCombatPacket(source.slot, column + 2, row, 7)]
      : counter === 58 ? [nativeCombatPacket(target.slot, column, row)] : undefined;
    const result = session.step(nativeCombatInput(session.snapshot, packets));
    assert.ok(result.ok, JSON.stringify(result));
  }
  const current = context(), host = transportHostState(current.world), actor = host.slots[source.slot]!;
  const attack = createSourceNativePlayerOrder(current, { type: "Attack",
    destination: { column: (actor.position.x >>> 8) + 1, row }, target: binding(host.slots[target.slot]!) });
  assert.ok(attack.ok, JSON.stringify(attack));
  assert.equal(attack.input.nativeAiReceipt.packets[0][5], 7);
  nativePacket(attack.input.nativeAiReceipt.packets[0], actor, host.slots[target.slot]!);
  const applied = session.step(attack.input);
  assert.ok(applied.ok, JSON.stringify(applied));
  while (session.snapshot.cycleCounter < 95) {
    const state = transportHostState(session.snapshot.world);
    if (state.slots[target.slot]!.health < target.health && state.slots[source.slot]!.nativeAiTask!.raw[0x36] === 0) break;
    const result = session.step(nativeCombatInput(session.snapshot));
    assert.ok(result.ok, JSON.stringify(result));
  }
  const after = transportHostState(session.snapshot.world);
  assert.deepEqual(after.slots[source.slot]!.nativeAiTask!.raw.slice(0x36, 0x38), [0, 255]);
  assert.equal(after.slots[source.slot]!.nativeAiTask!.raw[0x39], 7);
  assert.ok(after.slots[target.slot]!.health < target.health);
  assert.ok(after.nativeCombat!.journal.some(entry => entry.spawns.length > 0));
  assert.ok(after.nativeCombat!.journal.some(entry => entry.impacts.length > 0));
});

test("player commands: fresh original receiver/registered visit goldens and order-zero diagnostic", () => {
  type Evidence = { command: string; diagnostic?: string; stream: string; slot: number; before: number[]; received: number[];
    world: LegacyAiRegisteredWorld; fin: LegacyAiRegisteredWorld["fin"]; binarySha256: string; runtimeIntercepts: unknown[];
    visits: { raw: number[]; before: { rngCursor: number; task6Budget: number }; rngCursor: number; task6Budget: number }[] };
  const trace = process.env.DC_PLAYER_ORDERS_TRACE;
  const rows: Evidence[] = (trace ? readFileSync(trace, "utf8") : execFileSync("python3", [
    new URL("source-native-player-orders-native.py", import.meta.url).pathname,
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env,
    PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" } })).trim().split("\n").map(line => JSON.parse(line));
  assert.equal(rows.length, 4);
  for (const row of rows) {
    if (row.command === "ZeroControl") { assert.match(row.diagnostic!, /caller=0x41948c/); continue; }
    assert.equal(row.binarySha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
    assert.deepEqual(row.runtimeIntercepts, []);
    const stream = Buffer.from(row.stream, "hex"), packet = Buffer.alloc(stream.length + 2);
    packet.writeUInt16LE(packet.length); packet.set(stream, 2);
    const entities = new Uint8Array(800 * 220); entities.set(row.before, row.slot * 220);
    applyLegacyAiActorPacket(entities, packet);
    assert.deepEqual([...entities.slice(row.slot * 220, (row.slot + 1) * 220)], row.received);
    const visit = row.visits[0];
    const consumed = reduceLegacyAiRegisteredVisit({ slot: row.slot, raw: row.received, world: { ...row.world, fin: row.fin },
      counter: 1, rngCursor: visit.before.rngCursor, task6Budget: visit.before.task6Budget });
    assert.ok(consumed.supported, JSON.stringify(consumed));
    assert.deepEqual(consumed.raw, visit.raw);
    assert.equal(consumed.rngCursor, visit.rngCursor);
    assert.equal(consumed.task6Budget, visit.task6Budget);
  }
});
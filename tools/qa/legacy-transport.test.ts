import assert from "node:assert/strict";
import test from "node:test";
import {
  createTransportState, native256ToSubcells, native256ToTile, reduceTransport, tileToNative256,
  type TransportCommand, type TransportGroups, type TransportState,
} from "../../src/engine/legacy-transport";

const groups: TransportGroups = [{ type: 0, count: 2 }, { type: 69, count: 1 }, { type: 0, count: 0 }, { type: 8, count: 1 }, { type: 9, count: 1 }];
const request: TransportCommand = { type: "reinforce", team: 0, side: 0, directionBits: [0, 1], tile: { x: 22, y: 2 }, groups };

function harness(initial = createTransportState()) {
  let state = initial;
  const history: TransportCommand[] = [];
  const results: ReturnType<typeof reduceTransport>[] = [];
  return {
    get state() { return state; },
    get carrier() { return state.carriers[0]; },
    history, results,
    send(command: TransportCommand) {
      const before = JSON.stringify(state);
      const result = reduceTransport(state, command);
      assert.equal(JSON.stringify(state), before, "reducer must not mutate its input");
      history.push(command);
      results.push(result);
      state = result.state;
      return result;
    },
    invoke(count = 1) {
      for (let index = 0; index < count; index += 1) this.send({ type: "invoke", id: this.carrier.id });
    },
    arrive() {
      this.send({ type: "oriented", id: this.carrier.id });
      this.send({ type: "arrived", id: this.carrier.id });
    },
  };
}

function delivery() {
  const adapter = harness();
  adapter.send(request);
  adapter.invoke(51);
  adapter.arrive();
  return adapter;
}

test("native256 conversion, injected independent bits, slot ownership and side heights", () => {
  assert.deepEqual(tileToNative256({ x: 22, y: 2 }), { x: 5760, y: 640 });
  assert.deepEqual(native256ToTile({ x: 5761, y: 767 }), { x: 22, y: 2 });
  assert.deepEqual(native256ToSubcells({ x: 5760, y: 640 }, 1024), { x: 23040, y: 2560 });
  assert.throws(() => tileToNative256({ x: -1, y: 0 }), RangeError);
  const adapter = harness();
  adapter.send({ ...request, team: 1, side: 1 });
  assert.equal(adapter.carrier.slot, 22);
  assert.equal(adapter.carrier.entityTeam, 8);
  assert.equal(adapter.carrier.type, 93);
  assert.deepEqual(adapter.carrier.position, { x: 5504, y: 896 });
  adapter.invoke(50);
  assert.equal(adapter.carrier.height, 1203);
  assert.equal(adapter.carrier.phase, "descent");
});

test("exact LIFO phases, 51 descent calls, paused orientation/movement, 50 ascent calls then release", () => {
  const adapter = harness();
  adapter.send({ ...request, groups: [
    { type: 0, count: 1 }, { type: 0, count: 0 }, { type: 0, count: 0 }, { type: 0, count: 0 }, { type: 0, count: 0 },
  ] });
  adapter.invoke(50);
  assert.equal(adapter.carrier.phase, "descent");
  assert.equal(adapter.carrier.height, 603);
  const pop = adapter.send({ type: "invoke", id: 1 });
  assert.equal(pop.redispatch, false);
  assert.deepEqual(pop.effects.map((effect) => effect.type), ["descent-complete", "orient"]);
  const oriented = adapter.state;
  adapter.invoke(100);
  assert.equal(adapter.state, oriented);
  adapter.send({ type: "oriented", id: 1 });
  const approaching = adapter.state;
  adapter.invoke(100);
  assert.equal(adapter.state, approaching);
  adapter.send({ type: "arrived", id: 1 });
  assert.equal(adapter.carrier.phase, "deliver");
  assert.equal(adapter.carrier.payloadPhase, 0);
  adapter.invoke();
  adapter.send({ type: "occupancy", id: 1, vacant: true });
  adapter.send({ type: "created", id: 1, success: true });
  assert.equal(adapter.carrier.phase, "departure");
  assert.equal(adapter.carrier.payloadPhase, 2);
  adapter.invoke(49);
  assert.equal(adapter.carrier.phase, "departure");
  const ascentPop = adapter.send({ type: "invoke", id: 1 });
  assert.equal(ascentPop.redispatch, false);
  assert.equal(adapter.carrier.height, 7803);
  assert.equal(adapter.carrier.phase, "pool-release");
  assert.ok(!ascentPop.effects.some((effect) => effect.type === "carrier-released"));
  adapter.invoke();
  assert.equal(adapter.carrier.phase, "released");
  assert.deepEqual(adapter.results.at(-1)!.effects, [{ type: "carrier-released", id: 1, team: 0, poolIndex: 0, slot: 7, idleTask: 3, idleCount: 60 }]);
});

test("five ordered groups, valid type zero, one acknowledged creation per payload invocation", () => {
  const adapter = delivery();
  const delivered: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    adapter.invoke();
    const result = adapter.send({ type: "occupancy", id: 1, vacant: true });
    const creation = result.effects[0];
    assert.equal(creation.type, "create-unit");
    if (creation.type === "create-unit") delivered.push(creation.unitType);
    const pending = adapter.state;
    adapter.invoke(10);
    assert.equal(adapter.state, pending);
    adapter.send({ type: "created", id: 1, success: true });
    if (index < 4) {
      assert.deepEqual(adapter.results.at(-1)!.effects, [{ type: "select-position", id: 1, originTile: { x: 22, y: 2 }, plane: "ground" }]);
      adapter.send({ type: "next-position", id: 1, position: { x: 6000 + index * 256, y: 640 } });
      adapter.arrive();
    }
  }
  assert.deepEqual(delivered, [0, 0, 69, 8, 9]);
  assert.equal(adapter.carrier.phase, "departure");
  assert.equal(adapter.carrier.cursor, 5);
});

test("blocked occupancy and missing next cell retain cargo; failed creation needs an explicit successful reply", () => {
  const adapter = delivery();
  adapter.invoke();
  adapter.send({ type: "occupancy", id: 1, vacant: false });
  assert.deepEqual(adapter.carrier.groups, groups);
  const blocked = adapter.state;
  assert.equal(adapter.send({ type: "next-position", id: 1, position: null }).state, blocked);
  assert.equal(adapter.results.at(-1)!.effects[0].type, "diagnostic");
  adapter.invoke(20);
  assert.equal(adapter.state, blocked);
  adapter.send({ type: "next-position", id: 1, position: { x: 6016, y: 640 } });
  adapter.arrive();
  adapter.invoke();
  adapter.send({ type: "occupancy", id: 1, vacant: true });
  const pending = adapter.state;
  assert.equal(adapter.send({ type: "created", id: 1, success: false }).state, pending);
  assert.deepEqual(adapter.carrier.groups, groups);
  adapter.send({ type: "created", id: 1, success: true });
  assert.equal(adapter.carrier.groups[0].count, 1);
});

test("eight reservations per team, diagnostic on full, delayed release and first-free fixed-slot reuse", () => {
  const adapter = delivery();
  for (let index = 1; index < 8; index += 1) adapter.send(request);
  const full = adapter.state;
  assert.deepEqual(adapter.send(request).effects, [{ type: "diagnostic", code: "pool-full" }]);
  assert.equal(adapter.state, full);
  adapter.send({ ...request, team: 1 });
  assert.equal(adapter.state.carriers.at(-1)!.slot, 22);
  const releaseReady: TransportState = { ...adapter.state, carriers: adapter.state.carriers.map((carrier) => carrier.id === 1 ? { ...carrier, phase: "departure", payloadPhase: 2, step: 49 } : carrier) };
  const releasing = harness(releaseReady);
  releasing.invoke();
  assert.equal(releasing.send(request).effects[0].type, "diagnostic");
  releasing.invoke();
  const otherCarriers = releasing.state.carriers.slice(1);
  releasing.send(request);
  assert.deepEqual(releasing.state.carriers.slice(0, -1), otherCarriers);
  assert.equal(releasing.state.carriers.at(-1)!.poolIndex, 0);
  assert.equal(releasing.state.carriers.at(-1)!.slot, 7);
  assert.equal(releasing.send({ type: "arrived", id: 1 }).effects[0].type, "diagnostic");
});

function pickup() {
  const adapter = harness();
  adapter.send({ type: "abduct", team: 0, side: 0, directionBits: [1, 0], commander: { slot: 513, status: 1, position: { x: 5760, y: 640 } } });
  adapter.invoke(51);
  adapter.arrive();
  assert.equal(adapter.carrier.phase, "pickup");
  const marker = adapter.send({ type: "invoke", id: 1 });
  assert.equal(marker.redispatch, true);
  assert.equal(adapter.carrier.cursor, 1);
  adapter.invoke();
  return adapter;
}

test("pickup chases moving full-word slot; Manhattan 257 chases, 256 removes without combat loss", () => {
  const adapter = pickup();
  adapter.send({ type: "commander", id: 1, commander: { slot: 513, status: 1, position: { x: 6016, y: 641 } } });
  assert.equal(adapter.carrier.phase, "orientation");
  assert.deepEqual(adapter.carrier.destination, { x: 6016, y: 641 });
  adapter.arrive();
  adapter.invoke();
  adapter.send({ type: "commander", id: 1, commander: { slot: 513, status: 1, position: { x: 6273, y: 641 } } });
  assert.equal(adapter.carrier.phase, "orientation");
  adapter.arrive();
  adapter.invoke();
  const removal = adapter.send({ type: "commander", id: 1, commander: { slot: 513, status: 1, position: { x: 6401, y: 769 } } });
  assert.deepEqual(removal.effects, [
    { type: "remove-noncombat", id: 1, slot: 513, status: 10, task: 10, taskWords: [1, 0], combatLoss: false },
    { type: "clear-collision", id: 1, slot: 513 },
  ]);
  assert.equal(adapter.carrier.phase, "departure");
  assert.equal(adapter.carrier.cursor, 2);
});

test("inactive commanders skip without allocation or removal; missing/mismatched references preserve state", () => {
  for (const status of [0, 10]) {
    const adapter = harness();
    const initial = adapter.state;
    adapter.send({ type: "abduct", team: 0, side: 0, directionBits: [0, 0], commander: { slot: 513, status, position: { x: 128, y: 128 } } });
    assert.equal(adapter.state, initial);
    const active = pickup();
    const result = active.send({ type: "commander", id: 1, commander: { slot: 513, status, position: { x: 65535, y: 65535 } } });
    assert.deepEqual(result.effects, []);
    assert.equal(active.carrier.phase, "departure");
  }
  const adapter = pickup();
  const pending = adapter.state;
  for (const commander of [null, { slot: -1, status: 1, position: { x: 128, y: 128 } }, { slot: 512, status: 1, position: { x: 128, y: 128 } }]) {
    assert.deepEqual(adapter.send({ type: "commander", id: 1, commander }).effects, [{ type: "diagnostic", code: "invalid-commander", id: 1 }]);
    assert.equal(adapter.state, pending);
  }
  assert.deepEqual(adapter.send({ type: "invoke", id: 999 }).effects, [{ type: "diagnostic", code: "no-match", id: 999 }]);
  assert.equal(adapter.state, pending);
});

test("special leading zero payload is diagnosed, not treated as empty delivery", () => {
  const adapter = harness();
  const initial = adapter.state;
  adapter.send({ ...request, groups: Array.from({ length: 5 }, () => ({ type: 0, count: 0 })) as unknown as TransportGroups });
  assert.equal(adapter.state, initial);
  assert.deepEqual(adapter.results[0].effects, [{ type: "diagnostic", code: "invalid-request" }]);
});

test("replay from serialized state/commands produces identical transitions and effects; wall-clock bail is independent", () => {
  const adapter = pickup();
  const waiting = adapter.state;
  const deadline = 10000;
  const bailExpired = (now: number): boolean => ((deadline - now) >>> 0) > 0x80000000;
  assert.equal(bailExpired(10000), false);
  assert.equal(bailExpired(10001), true);
  assert.equal(adapter.state, waiting);
  adapter.send({ type: "commander", id: 1, commander: { slot: 513, status: 1, position: { x: 5760, y: 640 } } });
  adapter.invoke(51);
  let replay = createTransportState();
  adapter.history.forEach((command, index) => {
    const result = reduceTransport(JSON.parse(JSON.stringify(replay)), JSON.parse(JSON.stringify(command)));
    assert.deepEqual(result, adapter.results[index]);
    replay = result.state;
  });
  assert.deepEqual(replay, adapter.state);
});
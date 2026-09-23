import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { escortOrders, escortRoute, replayInputs, safeWaitingCells, visibleHostiles, type EscortState } from "./alien09-escort";
import { hash, sourceContract } from "./campaign-07-09";

const fixture = (): EscortState => ({
  owned: [{ id: 4, type: 73, hp: 800, x: 110, y: 12 },
    ...Array.from({ length: 11 }, (_, index) => ({ id: index + 10, type: 8, hp: 200, x: 108, y: 12 }))],
  enemies: [], fired: new Set([4, 2]), destination: { x: 118, y: 19 }, retreat: { x: 124, y: 36 },
});

test("A09 escort: unreachable nearest tag cell falls back to another original trip cell", () => {
  const blocked = { x: 109, y: 13 }, reachable = { x: 115, y: 12 };
  assert.deepEqual(escortRoute({ x: 7, y: 9 }, [blocked, reachable], target => target === blocked ? null : [target]),
    { target: reachable, waypoint: reachable });
  assert.equal(escortRoute({ x: 7, y: 9 }, [blocked], () => null), null);
});

test("A09 escort: every combat troop and commander receives a grouped public order", () => {
  const state = fixture(), orders = escortOrders(state);
  assert.equal(orders.length, 3);
  assert.deepEqual(orders.flatMap(order => order.ids).sort((left, right) => left - right), state.owned.map(actor => actor.id));
  assert.ok(orders.slice(0, 2).every(order => order.mode === "move" && !order.ids.includes(4)));
  assert.equal(orders.at(-1)!.mode, "move");
});

test("A09 escort: trip 3 immediately retreats commander including the pending WIN window", () => {
  const state = fixture();
  for (const fired of [[4, 2, 5], [4, 2, 5, 3], [4, 2, 5, 3, 6]]) {
    state.fired = new Set(fired);
    const command = escortOrders(state).at(-1)!;
    assert.deepEqual(command.destination, fired.includes(3) ? state.retreat : state.destination);
    assert.equal(command.ids[0], 4);
  }
});

test("A09 escort: support protects the commander from a visible threat instead of sending him to attack", () => {
  const state = fixture();
  state.enemies = [{ id: 90, type: 2, hp: 400, x: 112, y: 12 }];
  const orders = escortOrders(state);
  assert.ok(orders.slice(0, 2).every(order => order.targetId === 90));
  assert.equal(orders.at(-1)!.targetId, undefined);
  assert.equal(orders.at(-1)!.mode, "move");
});

test("A09 escort: commander cannot outrun ground guards before trip 2", () => {
  const state = fixture(); state.fired = new Set();
  state.owned[0] = { ...state.owned[0], x: 125 };
  const order = escortOrders(state).at(-1)!;
  assert.equal(order.purpose, "commander-regroup");
  assert.deepEqual(order.destination, { x: 125, y: 12 });
  state.fired = new Set([2, 3, 6]);
  assert.equal(escortOrders(state).at(-1)!.purpose, "commander-retreat");
});

test("A09 escort: waiting cells are north of the extraction area, outside the old firing line", () => {
  assert.ok(safeWaitingCells().every(cell => cell.y >= 32));
});

test("A09 escort: opponent faction scan rejects hidden, allied, owned and dead actors", () => {
  const actors = [
    { id: 1, faction: "human" as const, team: 3, cellX: 1, cellY: 0, health: 200 },
    { id: 2, faction: "human" as const, team: 3, cellX: 2, cellY: 0, health: 200 },
    { id: 3, faction: "alien" as const, team: 0, cellX: 1, cellY: 0, health: 200 },
    { id: 4, faction: "human" as const, team: 3, cellX: 1, cellY: 0, health: 0 },
  ];
  assert.deepEqual(visibleHostiles(actors, [0, 1, 0], 3, undefined).map(actor => actor.id), [1]);
  assert.deepEqual(visibleHostiles(actors, [0, 1, 0], 3, [[1, 0, 0, 1]]), []);
});

test("A09 escort: exact replay retains commands at pending tick and all later retreat inputs", () => {
  const order = escortOrders(fixture()).at(-1)!;
  const inputs = [2095, 2096, 2120, 2160, 2297].map(tick => ({ ...order, tick, clientX: 256, clientY: 226, visible: true, cursor: "move" }));
  assert.deepEqual(replayInputs(inputs, 2096, 2297).map(input => input.tick), [2096, 2120, 2160]);
  assert.throws(() => replayInputs([inputs[2], inputs[1]], 2096, 2297));
});

if (process.env.DC_A09_ESCORT_ARTIFACTS) {
  for (const [tag, tick, lossTick, count, ready] of [
    ["e11", 2057, 1856, 100, true], ["e14", 2906, 2744, 167, false],
  ] as const) test(`A09 escort artifacts: ${tag} records actual source LOSS without claiming WIN or replay proof`, () => {
    const directory = `${process.env.DC_A09_ESCORT_ARTIFACTS}-${tag}`;
    const load = (name: string) => JSON.parse(readFileSync(`${directory}/${name}.json`, "utf8"));
    const source = load("source"), checkpoint = load("checkpoint"), result = load("result"), exit = load("exit");
    assert.deepEqual(source.contract.triggers, sourceContract("A09").triggers);
    assert.deepEqual(source.contract.sources, sourceContract("A09").sources);
    assert.equal(source.sourceHash, checkpoint.sourceHash);
    assert.deepEqual(source.runtime, checkpoint.runtime);
    assert.equal(checkpoint.view.simulation.tick, tick);
    assert.deepEqual(checkpoint.view.state.outcome, { resultCode: 1, reasonCode: 2, ready });
    assert.equal(result.checkpointHash, hash(JSON.stringify(checkpoint.view)));
    assert.notEqual(result.status, "WIN");
    assert.notEqual(result.exact, true);
    const integrity = load("integrity");
    assert.deepEqual(integrity.changed, []);
    assert.deepEqual(integrity.changedAssets, []);
    assert.deepEqual(integrity.sourceChanged, []);
    const commands = load("commands") as { ids: number[]; targetId?: number; visible: boolean; tick: number }[];
    assert.equal(commands.length, count);
    assert.deepEqual([...new Set(commands.flatMap(command => command.ids))].sort((left, right) => left - right),
      Array.from({ length: 12 }, (_, index) => index + 1));
    assert.ok(commands.filter(command => command.targetId !== undefined).every(command => command.visible));
    assert.ok(commands.every(command => command.tick < lossTick));
    const journal = readFileSync(`${directory}/journal.jsonl`, "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.equal(journal.find(event => event.kind === "source-trigger" && event.data.block === 1).tick, lossTick);
    assert.equal(load("pending").view.simulation.tick, lossTick);
    assert.equal(exit.code, 1);
    assert.equal(exit.signal, null);
    assert.equal(exit.reaped, true);
    assert.ok(exit.elapsedMs < exit.budgetMs);
  });
}
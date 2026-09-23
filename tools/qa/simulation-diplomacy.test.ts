import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { areHostile, SOURCE_ALLIANCE_POLICY } from "../../src/engine/diplomacy";
import { guardCommands } from "../../src/engine/guard-ai";
import { NavigationGrid } from "../../src/engine/grid";
import { DeterministicSimulation, type Faction } from "../../src/engine/simulation";
import { parseScenario } from "../extractors/data/scenario";

const weapon = { damage: 10, rangeCells: 12, cooldownTicks: 1 };
const observer = (id: number, range = 4) => ({ id, dayRangeCells: range, nightRangeCells: range });

test("runtime alliances stop existing fire, preserve direction and survive restore", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(4, 1), { teamAlliances: [[0, 0], [0, 0]] });
  const first = simulation.addUnit({ faction: "human", team: 0, cell: { x: 0, y: 0 }, weapon });
  const second = simulation.addUnit({ faction: "alien", team: 1, cell: { x: 1, y: 0 }, weapon });
  simulation.queue({ type: "attack", unitIds: [first], targetId: second });
  simulation.queue({ type: "attack", unitIds: [second], targetId: first });
  simulation.advance();
  const previous = simulation.snapshot;
  const alliances = [[0, 1], [0, 0]];
  simulation.setTeamAlliances(alliances);
  alliances[0][1] = 0;
  assert.equal(previous.teamAlliances![0][1], 0);
  assert.equal(simulation.snapshot.teamAlliances![0][1], 1);
  assert.deepEqual(guardCommands(simulation.snapshot, [observer(first)], simulation.combatEvents),
    [{ type: "stop", unitIds: [first] }]);
  const restored = DeterministicSimulation.restore(simulation.checkpoint());
  for (const current of [simulation, restored]) {
    current.advance();
    assert.equal(current.snapshot.units[1].health, 90);
    assert.equal(current.snapshot.units[0].health, 80);
    assert.deepEqual(current.combatEvents.map(event => event.attackerId), [second]);
  }
  assert.deepEqual(restored.checkpoint(), simulation.checkpoint());
  for (const invalid of [[], [[0, 1]], [[0, 2], [0, 0]]]) {
    assert.throws(() => simulation.setTeamAlliances(invalid), RangeError);
    assert.deepEqual(simulation.snapshot.teamAlliances, [[0, 1], [0, 0]]);
  }
});

test("source rows stay directed under the explicit observer-row browser policy", () => {
  const scenario = parseScenario(readFileSync(new URL("../../raw_cd/DC/SCENARIO/ALIEN/ALIEN01.SCN", import.meta.url), "ascii"));
  assert.deepEqual(scenario.teams[0].allies, [0, 0, 1, 0, 0, 0, 0, 0]);
  assert.equal(SOURCE_ALLIANCE_POLICY, "observer-row");
  const first = { faction: "human" as const, team: 0 };
  const second = { faction: "alien" as const, team: 1 };
  assert.equal(areHostile(first, second, [[0, 1], [0, 0]]), false);
  assert.equal(areHostile(second, first, [[0, 1], [0, 0]]), true);
  assert.equal(areHostile(first, { ...second, team: 0 }), false);
  assert.equal(areHostile(first, { ...first, team: 7 }), true);
});

for (const staticTarget of [false, true]) {
  test(`explicit attacks and acquisition use teams for ${staticTarget ? "static targets" : "units"}`, () => {
    const simulation = new DeterministicSimulation(new NavigationGrid(16, 2), { teamAlliances: [[0, 0, 1]] });
    const guard = simulation.addUnit({ faction: "human", team: 0, cell: { x: 0, y: 0 }, weapon });
    const addTarget = (faction: Faction, team: number, x: number) => {
      const options = { faction, team, cell: { x, y: 0 }, maxHealth: 100 };
      return staticTarget ? simulation.addStaticTarget(options) : simulation.addUnit(options);
    };
    const ally = addTarget("alien", 2, 1);
    const ownTeam = addTarget("alien", 0, 2);
    const enemy = addTarget("human", 1, 3);
    for (const targetId of [ally, ownTeam, guard]) {
      simulation.queue({ type: "attack", unitIds: [guard], targetId });
      simulation.advance();
      assert.deepEqual(simulation.combatEvents, []);
      assert.equal(simulation.snapshot.units[0].activity, "idle");
    }
    assert.deepEqual(guardCommands(simulation.snapshot, [observer(guard)]), [
      { type: "attack", unitIds: [guard], targetId: enemy },
    ]);
    simulation.queue({ type: "attack", unitIds: [guard], targetId: enemy });
    simulation.advance();
    assert.equal(simulation.combatEvents[0].targetId, enemy);
    assert.deepEqual(guardCommands(simulation.snapshot, [observer(guard, 0)]), []);
    simulation.advance();
    const target = [...simulation.snapshot.units, ...simulation.snapshot.staticTargets].find(({ id }) => id === enemy)!;
    assert.equal(target.health, 80);
  });
}

test("retaliation uses victim allegiance, including directed and stale ally shots", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(16, 1), { teamAlliances: [[0, 0, 1]] });
  const guard = simulation.addUnit({ faction: "human", team: 0, cell: { x: 0, y: 0 }, weapon });
  const ally = simulation.addUnit({ faction: "alien", team: 2, cell: { x: 8, y: 0 }, weapon });
  const enemy = simulation.addUnit({ faction: "human", team: 1, cell: { x: 9, y: 0 }, weapon });
  for (const attacker of [ally, enemy]) {
    simulation.queue({ type: "attack", unitIds: [attacker], targetId: guard });
  }
  simulation.advance();
  assert.equal(simulation.combatEvents.length, 2);
  assert.deepEqual(guardCommands(simulation.snapshot, [observer(guard, 0)], simulation.combatEvents), [
    { type: "attack", unitIds: [guard], targetId: enemy },
  ]);
  assert.deepEqual(guardCommands(simulation.snapshot, [observer(guard, 0)],
    simulation.combatEvents.filter(({ attackerId }) => attackerId === ally)), []);
});

test("guards abandon an assigned target considered allied in the supplied snapshot", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(4, 1));
  const guard = simulation.addUnit({ faction: "human", team: 0, cell: { x: 0, y: 0 }, weapon });
  const enemy = simulation.addUnit({ faction: "human", team: 1, cell: { x: 1, y: 0 } });
  simulation.queue({ type: "attack", unitIds: [guard], targetId: enemy });
  simulation.advance();
  assert.deepEqual(guardCommands({ ...simulation.snapshot, teamAlliances: [[0, 1]] }, [observer(guard)]), [
    { type: "stop", unitIds: [guard] },
  ]);
});

test("faction-only and mixed callers retain sandbox hostility", () => {
  const sandbox = new DeterministicSimulation(new NavigationGrid(4, 1));
  sandbox.addUnit({ faction: "human", cell: { x: 0, y: 0 } });
  sandbox.addStaticTarget({ faction: "alien", cell: { x: 1, y: 0 }, maxHealth: 100 });
  assert.equal(Object.hasOwn(sandbox.snapshot, "teamAlliances"), false);
  assert.equal(Object.hasOwn(sandbox.snapshot.units[0], "team"), false);
  assert.equal(Object.hasOwn(sandbox.snapshot.staticTargets[0], "team"), false);
  for (const team of [undefined, 0]) {
    const simulation = new DeterministicSimulation(new NavigationGrid(4, 1), { teamAlliances: [[1, 1]] });
    const guard = simulation.addUnit({ faction: "human", team, cell: { x: 0, y: 0 }, weapon });
    const friendly = simulation.addUnit({ faction: "human", cell: { x: 1, y: 0 } });
    const enemy = simulation.addStaticTarget({ faction: "alien", cell: { x: 2, y: 0 }, maxHealth: 100 });
    simulation.queue({ type: "attack", unitIds: [guard], targetId: friendly });
    simulation.advance();
    assert.equal(simulation.combatEvents.length, 0);
    assert.deepEqual(guardCommands(simulation.snapshot, [observer(guard)]), [{ type: "attack", unitIds: [guard], targetId: enemy }]);
    simulation.queue({ type: "attack", unitIds: [guard], targetId: enemy });
    simulation.advance();
    assert.equal(simulation.snapshot.staticTargets[0].health, 90);
  }
});

test("team snapshot fields and alliance configuration are immutable and detached from inputs", () => {
  const teamAlliances = [[0, 1], [0, 0]];
  const simulation = new DeterministicSimulation(new NavigationGrid(4, 1), { teamAlliances });
  const options = { faction: "human" as const, team: 0, cell: { x: 0, y: 0 }, weapon };
  simulation.addUnit(options);
  simulation.addStaticTarget({ faction: "alien", team: 1, cell: { x: 1, y: 0 }, maxHealth: 100 });
  const snapshot = simulation.snapshot;
  options.team = 3;
  teamAlliances[0][1] = 0;
  assert.equal(Reflect.set(snapshot.units[0], "team", 3), false);
  assert.equal(Reflect.set(snapshot.staticTargets[0], "team", 3), false);
  assert.equal(Reflect.set(snapshot.teamAlliances![0], "1", 0), false);
  assert.equal(Reflect.set(snapshot.teamAlliances!, "0", []), false);
  assert.equal(Reflect.set(snapshot, "teamAlliances", []), false);
  assert.equal(Reflect.set(snapshot.units, "0", {}), false);
  simulation.queue({ type: "attack", unitIds: [1], targetId: 2 });
  simulation.advance();
  assert.equal(simulation.combatEvents.length, 0);
  assert.equal(simulation.snapshot.units[0].team, 0);
  assert.equal(snapshot.tick, 0);
  assert.equal(snapshot.staticTargets[0].health, 100);
});

test("team-aware guard combat has deterministic snapshots, shots and static deaths", () => {
  const run = () => {
    const simulation = new DeterministicSimulation(new NavigationGrid(8, 1), { seed: 37, teamAlliances: [[0, 0, 1]] });
    const guard = simulation.addUnit({ faction: "human", team: 0, cell: { x: 0, y: 0 }, weapon });
    simulation.addUnit({ faction: "alien", team: 2, cell: { x: 1, y: 0 } });
    simulation.addUnit({ faction: "human", team: 1, cell: { x: 2, y: 0 }, maxHealth: 20 });
    simulation.addStaticTarget({ faction: "human", team: 1, cell: { x: 3, y: 0 }, maxHealth: 20 });
    const replay = [];
    for (let tick = 0; tick < 8; tick += 1) {
      for (const command of guardCommands(simulation.snapshot, [observer(guard)], simulation.combatEvents)) simulation.queue(command);
      simulation.advance();
      replay.push({ snapshot: simulation.snapshot, shots: simulation.combatEvents, deaths: simulation.deathEvents });
    }
    assert.equal(simulation.snapshot.units[1].health, 100);
    assert.equal(simulation.snapshot.units[2].health, 0);
    assert.equal(simulation.snapshot.staticTargets[0].health, 0);
    assert.equal(simulation.snapshot.units[0].activity, "idle");
    return replay;
  };
  assert.deepEqual(run(), run());
});

test("invalid team and alliance values fail before entities are inserted", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(4, 1));
  for (const team of [-1, 0.5, NaN, Infinity]) {
    assert.throws(() => simulation.addUnit({ faction: "human", team, cell: { x: 0, y: 0 } }), RangeError);
    assert.throws(() => simulation.addStaticTarget({ faction: "human", team, cell: { x: 1, y: 0 }, maxHealth: 10 }), RangeError);
  }
  assert.equal(simulation.snapshot.entityCount, 0);
  assert.throws(() => new DeterministicSimulation(new NavigationGrid(4, 1), { teamAlliances: [[2]] }), RangeError);
});
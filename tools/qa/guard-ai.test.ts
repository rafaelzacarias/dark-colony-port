import assert from "node:assert/strict";
import test from "node:test";
import { GuardAttackOrders, guardCommands } from "../../src/engine/guard-ai";
import { NavigationGrid } from "../../src/engine/grid";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { VERIFIED_NATIVE_ORDINARY_COEFFICIENTS } from "../../src/engine/legacy-balance";

test("guard ownership: restore retains, switches and stops autonomous attacks; manual same-target orders take precedence", () => {
  let simulation = new DeterministicSimulation(new NavigationGrid(12, 3));
  let orders = new GuardAttackOrders();
  const guard = simulation.addUnit({ faction: "human", cell: { x: 1, y: 1 },
    weapon: { damage: 100, rangeCells: 1, cooldownTicks: 1,
      sourceDamage: { coefficients: VERIFIED_NATIVE_ORDINARY_COEFFICIENTS, callerFactor: 256, specialFlag: false } } });
  const first = simulation.addStaticTarget({ faction: "alien", cell: { x: 4, y: 1 }, maxHealth: 800,
    sourceDefense: { targetClass: 0, armorFactor: 256 } });
  const second = simulation.addStaticTarget({ faction: "alien", cell: { x: 5, y: 1 }, maxHealth: 800,
    sourceDefense: { targetClass: 0, armorFactor: 256 } });
  const step = () => {
    const observers = orders.observers(simulation.snapshot, [{ id: guard, dayRangeCells: 8, nightRangeCells: 8,
      targetCanDamage: targetId => simulation.canAutoTarget(guard, targetId) }]);
    const commands = guardCommands(simulation.snapshot, observers);
    orders.record(commands);
    commands.forEach(command => simulation.queue(command));
    simulation.advance();
    return commands;
  };
  assert.deepEqual(step(), [{ type: "attack", unitIds: [guard], targetId: first }]);
  const saved = JSON.parse(JSON.stringify({ simulation: simulation.checkpoint(), orders: orders.checkpoint() }));
  const continueRun = () => {
    assert.deepEqual(step(), [], "restored valid guard target is retained");
    simulation.updateStaticSourceDefense(first, { targetClass: 8, armorFactor: 256 });
    assert.deepEqual(step(), [{ type: "attack", unitIds: [guard], targetId: second }]);
    assert.ok(simulation.combatEvents.every(event => event.targetId !== first));
    simulation.updateStaticSourceDefense(second, { targetClass: 8, armorFactor: 256 });
    const before = simulation.snapshot.units[0];
    assert.deepEqual(step(), [{ type: "stop", unitIds: [guard] }]);
    for (let tick = 0; tick < 3; tick += 1) {
      assert.deepEqual(step(), []);
      const after = simulation.snapshot.units[0];
      assert.equal(after.activity, "idle");
      assert.equal(after.targetId, null);
      assert.equal(after.xSubcells, before.xSubcells);
      assert.equal(after.ySubcells, before.ySubcells);
      assert.deepEqual(simulation.combatEvents, []);
    }
    return { simulation: simulation.checkpoint(), orders: orders.checkpoint() };
  };
  const expected = continueRun();
  simulation = DeterministicSimulation.restore(saved.simulation);
  orders = GuardAttackOrders.restore(saved.orders);
  assert.deepEqual(continueRun(), expected);
  simulation = DeterministicSimulation.restore(saved.simulation);
  orders = GuardAttackOrders.restore(saved.orders);
  orders.cancel([guard]);
  simulation.queue({ type: "attack", unitIds: [guard], targetId: first });
  simulation.advance();
  simulation.updateStaticSourceDefense(first, { targetClass: 8, armorFactor: 256 });
  orders = GuardAttackOrders.restore(orders.checkpoint());
  assert.deepEqual(step(), [], "explicit same-target attack is not reclaimed by guard planning");
  assert.equal(simulation.snapshot.units[0].targetId, first);
});

test("guard damage eligibility: acquire, retain and switch autonomous targets without overriding explicit attacks", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(12, 3));
  const guard = simulation.addUnit({ faction: "human", cell: { x: 1, y: 1 },
    weapon: { damage: 100, rangeCells: 5, cooldownTicks: 10,
      sourceDamage: { coefficients: VERIFIED_NATIVE_ORDINARY_COEFFICIENTS, callerFactor: 256, specialFlag: false } } });
  const decoration = simulation.addStaticTarget({ faction: "alien", cell: { x: 2, y: 1 }, maxHealth: 800,
    sourceDefense: { targetClass: 8, armorFactor: 256, sourceTypeIndex: 84 } });
  const first = simulation.addStaticTarget({ faction: "alien", cell: { x: 3, y: 1 }, maxHealth: 800,
    sourceDefense: { targetClass: 0, armorFactor: 204 } });
  const second = simulation.addUnit({ faction: "alien", cell: { x: 4, y: 1 }, maxHealth: 800,
    sourceDefense: { targetClass: 9, armorFactor: 256 } });
  const calls: number[] = [];
  const observer = { id: guard, dayRangeCells: 5, nightRangeCells: 5, autonomousAttack: true,
    targetCanDamage: (targetId: number) => { calls.push(targetId); return simulation.canAutoTarget(guard, targetId); } };
  const select = () => {
    calls.length = 0;
    const before = simulation.checkpoint();
    const result = guardCommands(simulation.snapshot, [observer]);
    assert.deepEqual(simulation.checkpoint(), before);
    assert.equal(calls.length, new Set(calls).size, "retention and acquisition share one evaluation per candidate");
    return result;
  };
  assert.deepEqual(select(), [{ type: "attack", unitIds: [guard], targetId: first }]);
  simulation.queue({ type: "attack", unitIds: [guard], targetId: first });
  simulation.advance();
  assert.deepEqual(select(), []);
  assert.deepEqual(calls, [first]);
  simulation.updateStaticSourceDefense(first, { targetClass: 8, armorFactor: 256 });
  assert.deepEqual(select(), [{ type: "attack", unitIds: [guard], targetId: second }]);
  assert.ok(calls.includes(decoration));
  assert.deepEqual(guardCommands(simulation.snapshot, [{ ...observer, autonomousAttack: false }]), [],
    "an explicit zero-damage attack remains intentional");
  simulation.removeUnit(second);
  assert.deepEqual(select(), [{ type: "stop", unitIds: [guard] }]);
});

test("guard damage eligibility: retaliation uses the same cached predicate and keeps sight and Move intent", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(12, 3));
  const guard = simulation.addUnit({ faction: "human", cell: { x: 1, y: 1 },
    weapon: { damage: 4, rangeCells: 2, cooldownTicks: 10,
      sourceDamage: { coefficients: VERIFIED_NATIVE_ORDINARY_COEFFICIENTS, callerFactor: 256, specialFlag: false } } });
  const immune = simulation.addUnit({ faction: "alien", cell: { x: 2, y: 1 },
    sourceDefense: { targetClass: 0, armorFactor: 204 } });
  const eligible = simulation.addUnit({ faction: "alien", cell: { x: 8, y: 1 },
    sourceDefense: { targetClass: 0, armorFactor: 256 } });
  const calls: number[] = [];
  const observer = { id: guard, dayRangeCells: 2, nightRangeCells: 2,
    targetCanDamage: (targetId: number) => { calls.push(targetId); return simulation.canAutoTarget(guard, targetId); } };
  assert.deepEqual(guardCommands(simulation.snapshot, [observer]), []);
  assert.deepEqual(calls, [immune], "hidden enemies are not queried for acquisition");
  calls.length = 0;
  const shots = [immune, eligible].map(attackerId => ({ type: "shot" as const, tick: 0, attackerId, targetId: guard, damage: 1 }));
  assert.deepEqual(guardCommands(simulation.snapshot, [observer], shots), [{ type: "attack", unitIds: [guard], targetId: eligible }]);
  assert.deepEqual(calls, [immune, eligible], "visible retaliation candidate is evaluated only once");
  simulation.queue({ type: "move", unitIds: [guard], target: { x: 0, y: 1 } });
  simulation.advance();
  calls.length = 0;
  assert.deepEqual(guardCommands(simulation.snapshot, [{ ...observer, engageWhileMoving: false }], shots), []);
  assert.deepEqual(calls, []);
});

test("guards acquire nearest visible opponents with stable ID tie breaking", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(12, 12));
  const guard = simulation.addUnit({ faction: "alien", cell: { x: 5, y: 5 } });
  const first = simulation.addUnit({ faction: "human", cell: { x: 4, y: 5 } });
  simulation.addUnit({ faction: "human", cell: { x: 6, y: 5 } });
  simulation.addUnit({ faction: "alien", cell: { x: 5, y: 5 } });
  const snapshot = simulation.snapshot;
  const observers = [{ id: guard, dayRangeCells: 2, nightRangeCells: 4 }];
  const expected = [{ type: "attack", unitIds: [guard], targetId: first }];
  assert.deepEqual(guardCommands(snapshot, observers), expected);
  assert.deepEqual(guardCommands({ ...snapshot, units: [...snapshot.units].reverse() }, observers), expected);
});

test("assigned attacks keep pursuing outside acquisition sight instead of being canceled", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(12, 1));
  const guard = simulation.addUnit({ faction: "human", cell: { x: 0, y: 0 }, weapon: { damage: 25, rangeCells: 7, cooldownTicks: 2 } });
  const enemy = simulation.addUnit({ faction: "alien", cell: { x: 6, y: 0 } });
  const observers = [{ id: guard, dayRangeCells: 7, nightRangeCells: 4 }];
  assert.deepEqual(guardCommands(simulation.snapshot, observers), []);
  const daytime = { ...simulation.snapshot, daylightPermille: 1000 };
  assert.equal(guardCommands(daytime, observers).length, 1);
  simulation.queue({ type: "attack", unitIds: [guard], targetId: enemy });
  simulation.advance();
  assert.deepEqual(guardCommands(simulation.snapshot, observers), []);
});

test("a victim pursues a ranged attacker outside sight; direct Move remains obedient", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(20, 1));
  const victim = simulation.addUnit({ faction: "alien", cell: { x: 1, y: 0 },
    weapon: { damage: 25, rangeCells: 2, cooldownTicks: 5 } });
  const attacker = simulation.addUnit({ faction: "human", cell: { x: 9, y: 0 },
    weapon: { damage: 25, rangeCells: 10, cooldownTicks: 5 } });
  simulation.queue({ type: "attack", unitIds: [attacker], targetId: victim });
  simulation.advance();
  const observer = { id: victim, dayRangeCells: 4, nightRangeCells: 4 };
  const commands = guardCommands(simulation.snapshot, [observer], simulation.combatEvents);
  assert.deepEqual(commands, [{ type: "attack", unitIds: [victim], targetId: attacker }]);
  commands.forEach((command) => simulation.queue(command));
  simulation.advance();
  assert.ok(simulation.snapshot.units[0].xSubcells > 1536);
  assert.equal(simulation.snapshot.units[0].activity, "attack");
  simulation.queue({ type: "move", unitIds: [victim], target: { x: 0, y: 0 } });
  simulation.advance();
  assert.deepEqual(guardCommands(simulation.snapshot, [{ ...observer, engageWhileMoving: false }],
    [{ type: "shot", tick: 2, attackerId: attacker, targetId: victim, damage: 25 }]), []);
});

test("guard combat replays and does not keep issuing orders at dead units", () => {
  const run = () => {
    const simulation = new DeterministicSimulation(new NavigationGrid(8, 1));
    const guard = simulation.addUnit({ faction: "alien", cell: { x: 3, y: 0 }, weapon: { damage: 50, rangeCells: 4, cooldownTicks: 2 } });
    simulation.addUnit({ faction: "human", cell: { x: 1, y: 0 } });
    const snapshots = [];
    for (let tick = 0; tick < 8; tick += 1) {
      for (const command of guardCommands(simulation.snapshot, [{ id: guard, dayRangeCells: 4, nightRangeCells: 7 }])) simulation.queue(command);
      simulation.advance();
      snapshots.push(simulation.snapshot);
    }
    assert.equal(snapshots.at(-1)!.units[1].health, 0);
    assert.equal(snapshots.at(-1)!.units[0].activity, "idle");
    return snapshots;
  };
  assert.deepEqual(run(), run());
});

test("explicit static-target pursuit survives acquisition updates outside vision", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(14, 2));
  const soldier = simulation.addUnit({ faction: "human", cell: { x: 0, y: 0 },
    weapon: { damage: 50, rangeCells: 2, cooldownTicks: 1 } });
  const target = simulation.addStaticTarget({ faction: "alien", cell: { x: 10, y: 0 }, maxHealth: 100 });
  simulation.queue({ type: "attack", unitIds: [soldier], targetId: target });
  simulation.advance();
  for (let tick = 0; tick < 80; tick += 1) {
    guardCommands(simulation.snapshot, [{ id: soldier, dayRangeCells: 2, nightRangeCells: 2 }])
      .forEach((command) => simulation.queue(command));
    simulation.advance();
  }
  assert.equal(simulation.snapshot.staticTargets[0].health, 0);
});
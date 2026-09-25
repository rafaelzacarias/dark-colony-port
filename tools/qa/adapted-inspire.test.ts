import assert from "node:assert/strict";
import test from "node:test";
import { NavigationGrid } from "../../src/engine/grid";
import { DeterministicSimulation } from "../../src/engine/simulation";

const weapon = { damage: 10, rangeCells: 3, cooldownTicks: 5 };

function scenario() {
  const simulation = new DeterministicSimulation(new NavigationGrid(30, 12));
  const human = (x: number, y: number, armed = true) => simulation.addUnit({ faction: "human", team: 0, cell: { x, y },
    maxHealth: 500, ...(armed ? { weapon } : {}) });
  const caster = human(5, 5, false);
  const otherCaster = human(5, 4);
  const unarmed = human(4, 5, false);
  const enemy = simulation.addUnit({ faction: "alien", team: 1, cell: { x: 5, y: 6 }, maxHealth: 100_000, weapon });
  const friends = [6, 7, 8, 9, 10, 11].map(x => human(x, 5));
  assert.equal(simulation.registerAdaptedInspireCaster(caster, 69), true);
  assert.equal(simulation.registerAdaptedInspireCaster(caster, 69), true);
  simulation.registerAdaptedInspireCaster(otherCaster, 73);
  return { simulation, caster, otherCaster, unarmed, enemy, friends };
}

function advanceTo(simulation: DeterministicSimulation, tick: number) {
  while (simulation.snapshot.tick < tick) simulation.advance();
}

test("adapted inspire: charge accrues every 32 ticks and gates at > 32", () => {
  const { simulation, caster, friends } = scenario();
  assert.deepEqual(simulation.adaptedInspireState(caster), { caster: true, typeId: 69, charge: 0, ready: false, timer: 0, liveMultiplierQ8: 256 });
  simulation.advance();
  assert.equal(simulation.adaptedInspireState(caster)!.charge, 1);
  advanceTo(simulation, 1000);
  assert.equal(simulation.adaptedInspireState(caster)!.charge, 32);
  simulation.queue({ type: "inspire", unitIds: [caster], team: 0 });
  simulation.advance();
  assert.equal(simulation.adaptedInspireState(caster)!.charge, 32);
  assert.equal(simulation.adaptedInspireState(caster)!.ready, false);
  assert.ok(friends.every(id => simulation.adaptedInspireState(id) === null));
  advanceTo(simulation, 1025);
  assert.equal(simulation.adaptedInspireState(caster)!.charge, 33);
  assert.equal(simulation.adaptedInspireState(caster)!.ready, true);
  simulation.queue({ type: "inspire", unitIds: [caster], team: 1 });
  simulation.advance();
  assert.equal(simulation.adaptedInspireState(caster)!.ready, true, "wrong-team command is ignored");
});

test("adapted inspire: scan picks same-team armed non-casters within the visit budget and resets charge", () => {
  const { simulation, caster, otherCaster, unarmed, enemy, friends } = scenario();
  advanceTo(simulation, 1025);
  simulation.queue({ type: "inspire", unitIds: [caster], team: 0 });
  simulation.advance();
  assert.equal(simulation.adaptedInspireState(caster)!.charge, 0);
  const inspired = [caster, otherCaster, unarmed, enemy, ...friends].filter(id => (simulation.adaptedInspireState(id)?.timer ?? 0) > 0);
  // Ring 0 visits each row cell twice, so the 6-visit budget of type 69 covers the three nearest armed friends.
  assert.deepEqual(inspired, friends.slice(0, 3));
  for (const id of inspired) {
    const state = simulation.adaptedInspireState(id)!;
    assert.ok(state.timer >= 20 && state.timer <= 35);
    assert.equal(state.liveMultiplierQ8, 332);
    assert.equal(state.caster, false);
  }
  assert.equal(simulation.checkpoint().adaptedInspire!.randomIndex, 6);
  simulation.queue({ type: "inspire", unitIds: [caster], team: 0 });
  simulation.advance();
  assert.equal(simulation.adaptedInspireState(friends[3]), null, "an uncharged caster cannot re-cast");
});

test("adapted inspire: damage multiplier applies while the timer runs and is removed on expiry", () => {
  const { simulation, caster, enemy, friends } = scenario();
  advanceTo(simulation, 1025);
  simulation.queue({ type: "inspire", unitIds: [caster], team: 0 });
  simulation.queue({ type: "attack", unitIds: [friends[0]], targetId: enemy });
  const seen = new Set<number>();
  for (let step = 0; step < 800; step++) {
    simulation.advance();
    const timer = simulation.adaptedInspireState(friends[0])?.timer ?? 0;
    for (const shot of simulation.combatEvents.filter(event => event.attackerId === friends[0])) {
      assert.equal(shot.damage, timer > 0 ? Math.floor(10 * 332 / 256) : 10);
      seen.add(shot.damage);
    }
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), [10, 12]);
  assert.equal(simulation.adaptedInspireState(friends[0]), null);
  assert.equal(simulation.checkpoint().adaptedInspire!.targets.length, 0);
});

test("adapted inspire: checkpoint round-trip, validation, removal and empty omission", () => {
  const empty = new DeterministicSimulation(new NavigationGrid(4, 4));
  empty.addUnit({ faction: "human", team: 0, cell: { x: 1, y: 1 }, weapon });
  empty.advance();
  assert.equal(Object.hasOwn(empty.checkpoint(), "adaptedInspire"), false);
  empty.queue({ type: "inspire", unitIds: [1], team: 0 });
  empty.advance();
  assert.equal(Object.hasOwn(empty.checkpoint(), "adaptedInspire"), false);

  const { simulation, caster, otherCaster, friends } = scenario();
  advanceTo(simulation, 1025);
  simulation.queue({ type: "inspire", unitIds: [caster], team: 0 });
  simulation.advance();
  const saved = simulation.checkpoint();
  assert.equal(saved.adaptedInspire!.casters.length, 2);
  assert.equal(saved.adaptedInspire!.targets.length, 3);
  const restored = DeterministicSimulation.restore(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored.checkpoint(), saved);
  const forked = simulation.fork();
  for (let step = 0; step < 200; step++) { simulation.advance(); restored.advance(); forked.advance(); }
  assert.deepEqual(restored.checkpoint(), simulation.checkpoint());
  assert.deepEqual(forked.checkpoint(), simulation.checkpoint());

  for (const corrupt of [
    (value: any) => { value.adaptedInspire.targets[0].timer = 0; },
    (value: any) => { value.adaptedInspire.casters[0].typeId = 68; },
    (value: any) => { value.adaptedInspire.targets[0].unitId = 999; },
    (value: any) => { value.adaptedInspire.targets.push({ ...value.adaptedInspire.targets[0] }); },
    (value: any) => { value.adaptedInspire.extra = 1; },
  ]) {
    const invalid = structuredClone(saved);
    corrupt(invalid);
    assert.throws(() => DeterministicSimulation.restore(invalid), /checkpoint/);
  }

  assert.ok(simulation.removeUnit(otherCaster));
  assert.equal(simulation.adaptedInspireState(otherCaster), null);
  assert.equal(simulation.checkpoint().adaptedInspire!.casters.length, 1);
  assert.throws(() => simulation.registerAdaptedInspireCaster(friends[0], 12), /not an Inspire caster/);
  assert.equal(simulation.registerAdaptedInspireCaster(999, 70), false);
});

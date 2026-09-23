import assert from "node:assert/strict";
import test from "node:test";
import { NavigationGrid } from "../../src/engine/grid";
import { VERIFIED_NATIVE_ORDINARY_COEFFICIENTS } from "../../src/engine/legacy-balance";
import { DeterministicSimulation, type NativeInspireAdapter } from "../../src/engine/simulation";

function roundTrip(simulation: DeterministicSimulation): DeterministicSimulation {
  return DeterministicSimulation.restore(JSON.parse(JSON.stringify(simulation.checkpoint())));
}

function compareFuture(original: DeterministicSimulation, restored = roundTrip(original), ticks = 100): void {
  for (let tick = 0; tick <= ticks; tick += 1) {
    assert.deepEqual(restored.snapshot, original.snapshot, `snapshot ${tick}`);
    assert.deepEqual(restored.checkpoint(), original.checkpoint(), `checkpoint ${tick}`);
    assert.deepEqual(restored.combatEvents, original.combatEvents);
    assert.deepEqual(restored.deathEvents, original.deathEvents);
    assert.deepEqual(restored.reservationEvents, original.reservationEvents);
    assert.deepEqual(restored.sourceDamageDiagnostics, original.sourceDamageDiagnostics);
    assert.deepEqual(restored.inspireEvents, original.inspireEvents);
    if (tick < ticks) { original.advance(); restored.advance(); }
  }
}

test("JSON checkpoint preserves mid-path movement and reservations for 100 ticks", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(12, 8), { seed: 734, dayNightCycleTicks: 20 });
  const unit = simulation.addUnit({ faction: "human", cell: { x: 1, y: 1 }, speedSubcellsPerTick: 137 });
  simulation.queue({ type: "move", unitIds: [unit], target: { x: 10, y: 6 } });
  simulation.advance();
  assert.notEqual(simulation.checkpoint().units[0].reservedDestination, null);
  compareFuture(simulation);
});

test("target and partially elapsed cooldown survive restore", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(8, 4));
  const attacker = simulation.addUnit({ faction: "human", cell: { x: 1, y: 1 },
    weapon: { damage: 7, rangeCells: 3, cooldownTicks: 9 } });
  const target = simulation.addUnit({ faction: "alien", cell: { x: 3, y: 1 }, maxHealth: 1000 });
  simulation.queue({ type: "attack", unitIds: [attacker], targetId: target });
  simulation.advance();
  simulation.advance();
  assert.equal(simulation.checkpoint().units[0].attackCooldown, 8);
  assert.equal(simulation.snapshot.units[0].targetId, target);
  compareFuture(simulation);
});

test("simultaneous lethal shots and retained death events survive restore", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(8, 4));
  const human = simulation.addUnit({ faction: "human", cell: { x: 1, y: 1 }, maxHealth: 10,
    weapon: { damage: 10, rangeCells: 3, cooldownTicks: 3 } });
  const alien = simulation.addUnit({ faction: "alien", cell: { x: 2, y: 1 }, maxHealth: 10,
    weapon: { damage: 10, rangeCells: 3, cooldownTicks: 3 } });
  simulation.queue({ type: "attack", unitIds: [human], targetId: alien }, 3);
  simulation.queue({ type: "attack", unitIds: [alien], targetId: human }, 3);
  const restored = roundTrip(simulation);
  for (let tick = 0; tick < 4; tick += 1) { simulation.advance(); restored.advance(); }
  assert.equal(simulation.combatEvents.length, 2);
  assert.equal(simulation.deathEvents.length, 2);
  assert.deepEqual(restored.checkpoint(), simulation.checkpoint());
  compareFuture(simulation);
});

test("future command ordering and removed-ID high water marks are retained", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(10, 5));
  const unit = simulation.addUnit({ faction: "human", cell: { x: 1, y: 1 } });
  const removed = simulation.addUnit({ faction: "alien", cell: { x: 8, y: 4 } });
  simulation.removeUnit(removed);
  simulation.queue({ type: "move", unitIds: [unit], target: { x: 8, y: 1 } }, 7);
  simulation.queue({ type: "stop", unitIds: [unit] }, 7);
  simulation.queue({ type: "move", unitIds: [unit], target: { x: 3, y: 3 } }, 18);
  const restored = roundTrip(simulation);
  const added = { faction: "human" as const, cell: { x: 1, y: 4 } };
  assert.equal(restored.addUnit(added), removed + 1);
  assert.equal(simulation.addUnit(added), removed + 1);
  for (const instance of [simulation, restored]) instance.queue({ type: "move", unitIds: [unit], target: { x: 6, y: 2 } }, 7);
  assert.deepEqual(restored.checkpoint().commands.map((command) => command.sequence), [0, 1, 3, 2]);
  compareFuture(simulation, restored);
});

test("harvest cargo, all harvest phases, construction queues and resources continue", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(14, 8), { initialResources: { human: 200 } });
  const harvester = simulation.addUnit({ faction: "human", cell: { x: 1, y: 1 }, speedSubcellsPerTick: 512,
    harvester: { cargoCapacity: 9, harvestPerTick: 3 } });
  const node = simulation.addResourceNode({ cell: { x: 3, y: 1 }, amount: 60 });
  const builder = simulation.addBuilding({ faction: "human", kind: "core", cell: { x: 8, y: 5 } });
  simulation.queue({ type: "harvest", unitIds: [harvester], resourceId: node, dropoff: { x: 1, y: 1 } });
  simulation.queue({ type: "build", builderId: builder, kind: "barracks", target: { x: 10, y: 5 }, cost: 30, buildTicks: 12, maxHealth: 500 });
  simulation.queue({ type: "build", builderId: builder, kind: "turret", target: { x: 10, y: 6 }, cost: 40, buildTicks: 8, maxHealth: 200 });
  const phases = new Set<string>();
  let sawCargo = false;
  for (let tick = 0; tick < 20; tick += 1) {
    simulation.advance();
    const checkpoint = simulation.checkpoint();
    phases.add(checkpoint.units[0].harvestPhase!);
    sawCargo ||= checkpoint.units[0].cargo > 0;
    compareFuture(DeterministicSimulation.restore(checkpoint));
  }
  assert.equal(sawCargo, true);
  assert.deepEqual([...phases].sort(), ["collecting", "to-dropoff", "to-resource"]);
  assert.equal(simulation.snapshot.buildings.length, 3);
  assert.equal(simulation.snapshot.resources.human >= 130, true);
});

test("overlapping static blockers retain prior costs through each death and restore", () => {
  const grid = new NavigationGrid(8, 5);
  grid.costs[grid.index(4, 2)] = 9;
  grid.costs[grid.index(5, 2)] = 0;
  const simulation = new DeterministicSimulation(grid);
  const first = simulation.addStaticTarget({ faction: "alien", cell: { x: 4, y: 2 }, maxHealth: 10,
    footprint: [{ x: 4, y: 2 }, { x: 5, y: 2 }] });
  const second = simulation.addStaticTarget({ faction: "alien", cell: { x: 4, y: 2 }, maxHealth: 20,
    footprint: [{ x: 4, y: 2 }] });
  const attacker = simulation.addUnit({ faction: "human", cell: { x: 3, y: 2 }, weapon: { damage: 10, cooldownTicks: 2, rangeCells: 2 } });
  simulation.queue({ type: "attack", unitIds: [attacker], targetId: first });
  simulation.queue({ type: "attack", unitIds: [attacker], targetId: second }, 2);
  const restored = roundTrip(simulation);
  simulation.advance(); restored.advance();
  assert.equal(simulation.grid.costs[20], 0);
  assert.deepEqual(restored.checkpoint(), simulation.checkpoint());
  const afterFirstDeath = roundTrip(simulation);
  compareFuture(simulation, afterFirstDeath);
  assert.equal(afterFirstDeath.grid.costs[20], 9);
  assert.equal(afterFirstDeath.grid.costs[21], 0);
  assert.equal(afterFirstDeath.snapshot.staticTargets.every((target) => target.health === 0), true);
});

test("source transition blend, teams, native and legacy profiles and vision are preserved", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(10, 6), {
    sourceDayNightHeader: ["0", "0", "8", "7", "4"], teamAlliances: [[1, 0, 1], [0, 1, 0], [0, 0, 1]],
  });
  const attacker = simulation.addUnit({ faction: "human", team: 0, cell: { x: 1, y: 1 },
    weapon: { damage: 100, rangeCells: 4, cooldownTicks: 4, sourceDamage: {
      mode: "verified-native-ordinary", coefficients: VERIFIED_NATIVE_ORDINARY_COEFFICIENTS, sourceTypeIndex: 0, sourceTypeFaction: 0, weaponId: 1,
    } }, vision: { dayRangeCells: 5, nightRangeCells: 2 } });
  const target = simulation.addUnit({ faction: "human", team: 1, cell: { x: 3, y: 1 }, maxHealth: 5000,
    sourceDefense: { targetClass: 0, armorFactor: 204, sourceTypeIndex: 0 } });
  const allied = simulation.addUnit({ faction: "alien", team: 2, cell: { x: 1, y: 3 } });
  const legacy = simulation.addUnit({ faction: "alien", team: 3, cell: { x: 6, y: 2 },
    weapon: { damage: 16, rangeCells: 8, cooldownTicks: 5, sourceDamage: { coefficients: Array(10).fill(256), callerFactor: 128, specialFlag: true } } });
  simulation.queue({ type: "attack", unitIds: [attacker], targetId: target });
  simulation.queue({ type: "attack", unitIds: [legacy], targetId: target });
  simulation.queue({ type: "attack", unitIds: [attacker], targetId: allied }, 12);
  for (let tick = 0; tick < 3; tick += 1) simulation.advance();
  assert.equal(simulation.sourceDayNight?.blend, 64);
  const restored = roundTrip(simulation);
  assert.deepEqual(restored.visibilityMask("human", 4), simulation.visibilityMask("human", 4));
  compareFuture(simulation, restored);
  assert.equal(simulation.snapshot.units.find((unit) => unit.id === allied)?.health, 100);
});

test("source damage diagnostic event buffer is retained", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(5, 5));
  const attacker = simulation.addUnit({ faction: "human", cell: { x: 1, y: 1 },
    weapon: { damage: 100, rangeCells: 4, cooldownTicks: 4, sourceDamage: {
      mode: "verified-native-ordinary", coefficients: VERIFIED_NATIVE_ORDINARY_COEFFICIENTS, sourceTypeIndex: 0, sourceTypeFaction: 0, weaponId: 1,
    } } });
  const target = simulation.addStaticTarget({ faction: "alien", cell: { x: 2, y: 1 }, maxHealth: 100 });
  simulation.queue({ type: "attack", unitIds: [attacker], targetId: target });
  simulation.advance();
  assert.equal(simulation.sourceDamageDiagnostics[0].reason, "missing-native-phase");
  compareFuture(simulation);
});

test("RNG resumes the exact nonzero uint32 stream including rejection sampling", () => {
  for (const seed of [0, 1, 0xffffffff, 0x80000000]) {
    const original = new DeterministicSimulation(new NavigationGrid(2, 2), { seed });
    for (let draw = 0; draw < 19; draw += 1) original.random.nextUint32();
    const restored = roundTrip(original);
    for (let tick = 0; tick < 100; tick += 1) {
      assert.equal(restored.random.nextUint32(), original.random.nextUint32());
      assert.equal(restored.random.nextInt(0x80000001), original.random.nextInt(0x80000001));
      original.advance(); restored.advance();
      assert.deepEqual(restored.checkpoint(), original.checkpoint());
    }
  }
});

test("checkpoint and restored state are detached in both directions", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(8, 5), { teamAlliances: [[1, 0], [0, 1]] });
  const unit = simulation.addUnit({ faction: "human", cell: { x: 1, y: 1 },
    weapon: { damage: 2, rangeCells: 3, cooldownTicks: 5, sourceDamage: { coefficients: Array(10).fill(256), callerFactor: 256, specialFlag: false } } });
  simulation.queue({ type: "move", unitIds: [unit], target: { x: 6, y: 1 } });
  simulation.queue({ type: "stop", unitIds: [unit] }, 50);
  simulation.advance();
  const saved: ReturnType<typeof JSON.parse> = simulation.checkpoint();
  const baseline = simulation.checkpoint();
  const restored = DeterministicSimulation.restore(saved);
  saved.grid.costs[0] = 45;
  saved.units[0].path[0].x = 7;
  saved.units[0].weapon.sourceDamage.coefficients[0] = 0;
  saved.commands[0].command.unitIds.push(99);
  saved.teamAlliances[0][1] = 1;
  saved.movementReservations[0].owners.push(99);
  assert.deepEqual(simulation.checkpoint(), baseline);
  assert.deepEqual(restored.checkpoint(), baseline);
  const detached = simulation.checkpoint();
  const before = structuredClone(detached);
  simulation.advance();
  assert.deepEqual(detached, before);
  restored.grid.costs[0] = 66;
  assert.equal(simulation.grid.costs[0], 1);
});

test("removed units may leave historical event, reservation and target references", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(8, 4));
  const attacker = simulation.addUnit({ faction: "human", cell: { x: 1, y: 1 }, weapon: { damage: 1, rangeCells: 3, cooldownTicks: 4 } });
  const target = simulation.addUnit({ faction: "alien", cell: { x: 2, y: 1 } });
  simulation.queue({ type: "attack", unitIds: [attacker], targetId: target });
  simulation.advance();
  simulation.removeUnit(target);
  compareFuture(simulation);
});

test("external nativeInspire adapter is rejected without invoking callbacks", () => {
  const unexpected = (): never => { throw new Error("adapter must not be invoked"); };
  const adapter: NativeInspireAdapter = { readRegisteredOrder: unexpected, readPositionQ8: unexpected,
    readOccupancy: unexpected, readRandomIndex: unexpected, commitRandomIndex: unexpected,
    onTaskTransition: unexpected, afterEntityUpdate: unexpected };
  const simulation = new DeterministicSimulation(new NavigationGrid(4, 4), {
    nativeInspire: adapter, sourceDayNightHeader: ["0", "0", "10", "0", "2"],
  });
  assert.throws(() => simulation.checkpoint(), /external nativeInspire.*export\/import/);
});

test("unknown input, malformed shapes, numeric bounds and inconsistent references fail transactionally", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(8, 5));
  const unit = simulation.addUnit({ faction: "human", cell: { x: 1, y: 1 },
    weapon: { damage: 1, rangeCells: 3, cooldownTicks: 4 } });
  simulation.addResourceNode({ cell: { x: 2, y: 2 }, amount: 30 });
  simulation.addStaticTarget({ faction: "alien", cell: { x: 5, y: 2 }, maxHealth: 10, footprint: [{ x: 5, y: 2 }] });
  simulation.queue({ type: "move", unitIds: [unit], target: { x: 6, y: 1 } });
  simulation.queue({ type: "stop", unitIds: [unit] }, 5);
  simulation.advance();
  const baseline = simulation.checkpoint();
  for (const value of [null, undefined, [], {}, "checkpoint", 1, { ...baseline, version: 99 }]) {
    assert.throws(() => DeterministicSimulation.restore(value), /Invalid simulation checkpoint/);
  }
  const mutations: ((saved: ReturnType<typeof JSON.parse>) => void)[] = [
    (saved) => { saved.extra = true; },
    (saved) => { delete saved.tick; },
    (saved) => { saved.tick = NaN; },
    (saved) => { saved.grid.costs[0] = Infinity; },
    (saved) => { saved.grid.costs[0] = -1; },
    (saved) => { saved.grid.width += 1; },
    (saved) => { saved.grid.costs.pop(); },
    (saved) => { delete saved.grid.costs[0]; },
    (saved) => { saved.randomState = 0; },
    (saved) => { saved.nextEntityId = 2; },
    (saved) => { saved.nextCommandSequence = 1; },
    (saved) => { saved.units.push(saved.units[0]); },
    (saved) => { saved.units[0].team = -1; },
    (saved) => { saved.units[0].pathIndex = 100; },
    (saved) => { saved.units[0].path[0].x = 50; },
    (saved) => { saved.units[0].reservedDestination = 40; },
    (saved) => { saved.units[0].attackTargetId = 2; },
    (saved) => { saved.units[0].resourceTargetId = 3; },
    (saved) => { saved.units[0].attackCooldown = 5; },
    (saved) => { saved.units[0].weapon.sourceDamage = { coefficients: [1], callerFactor: 256, specialFlag: false }; },
    (saved) => { saved.staticBlockers[0].count = 2; },
    (saved) => { saved.staticBlockers[0].priorCost = 65536; },
    (saved) => { saved.staticBlockers = []; },
    (saved) => { saved.movementReservations[0].owners = [3]; },
    (saved) => { saved.movementReservations.push(saved.movementReservations[0]); },
    (saved) => { saved.commands[0].tick = 0; },
    (saved) => { saved.commands.push(saved.commands[0]); },
    (saved) => { saved.commands[0].command.type = "execute"; },
    (saved) => { saved.commands[0].command.unitIds = ["1"]; },
    (saved) => { saved.commands[0].command.unitIds = [2]; },
    (saved) => { saved.reservationEvents[0].tileX = 100; },
    (saved) => { saved.sourceDayNight = { phase: 0, cycleLength: 10, elapsed: 1, transitionTicks: 11, blend: 0 }; },
    (saved) => { Object.defineProperty(saved.units[0], "health", { get: () => { throw new Error("getter executed"); } }); },
    (saved) => { saved.units[0].weapon.run = () => 1; },
    (saved) => { Object.setPrototypeOf(saved.units, { ...Array.prototype, map: () => { throw new Error("custom method executed"); } }); },
  ];
  for (const mutate of mutations) {
    const saved = structuredClone(baseline);
    mutate(saved);
    assert.throws(() => DeterministicSimulation.restore(saved), RangeError, mutate.toString());
    assert.deepEqual(simulation.checkpoint(), baseline);
  }
  compareFuture(simulation);
});

test("future commands may address entities not yet created by construction", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(8, 5), { initialResources: { human: 100 } });
  const builder = simulation.addBuilding({ faction: "human", kind: "core", cell: { x: 1, y: 1 } });
  simulation.queue({ type: "build", builderId: builder, kind: "barracks", target: { x: 3, y: 1 }, cost: 10, buildTicks: 2, maxHealth: 200 });
  simulation.queue({ type: "build", builderId: builder + 1, kind: "turret", target: { x: 5, y: 1 }, cost: 10, buildTicks: 2, maxHealth: 100 }, 3);
  compareFuture(simulation);
  assert.deepEqual(simulation.snapshot.buildings.map((building) => building.id), [1, 2, 3]);
});

test("current grid edits remain independent from saved pre-blocker costs", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(8, 5));
  simulation.grid.costs[20] = 17;
  const target = simulation.addStaticTarget({ faction: "alien", cell: { x: 4, y: 2 }, maxHealth: 1, footprint: [{ x: 4, y: 2 }] });
  simulation.grid.costs[20] = 6;
  simulation.grid.costs[0] = 65535;
  const attacker = simulation.addUnit({ faction: "human", cell: { x: 3, y: 2 }, weapon: { damage: 1, rangeCells: 2, cooldownTicks: 2 } });
  simulation.queue({ type: "attack", unitIds: [attacker], targetId: target }, 4);
  const restored = roundTrip(simulation);
  assert.equal(restored.grid.costs[20], 6);
  assert.equal(restored.checkpoint().staticBlockers[0].priorCost, 17);
  compareFuture(simulation, restored);
  assert.equal(restored.grid.costs[20], 17);
  assert.equal(restored.grid.costs[0], 65535);
});
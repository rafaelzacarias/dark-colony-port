import assert from "node:assert/strict";
import test from "node:test";

import {
  baseNodeCells,
  DeterministicRandom,
  DeterministicSimulation,
  expandLegacyMissionEntities,
  findPath,
  FixedStepClock,
  LEGACY_MOVEMENT_UNITS_PER_CELL,
  NavigationGrid,
  initialLegacyMessageId,
  initialLegacyWaypointRoutes,
  unitOptionsFromLegacy,
} from "../../src/engine";

test("seeded random streams are repeatable and bounded", () => {
  const first = new DeterministicRandom(0x1234_5678);
  const second = new DeterministicRandom(0x1234_5678);
  const firstValues = Array.from({ length: 20 }, () => first.nextUint32());
  const secondValues = Array.from({ length: 20 }, () => second.nextUint32());
  assert.deepEqual(secondValues, firstValues);
  assert.ok(Array.from({ length: 100 }, () => first.nextInt(7)).every((value) => value >= 0 && value < 7));
});

test("A* resolves symmetric ties with a stable route", () => {
  const costs = new Uint16Array(25).fill(1);
  costs[2 + 2 * 5] = 0;
  const grid = new NavigationGrid(5, 5, costs);
  const path = findPath(grid, { x: 0, y: 2 }, { x: 4, y: 2 });
  assert.deepEqual(path, [
    { x: 0, y: 2 },
    { x: 1, y: 2 },
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 3, y: 1 },
    { x: 4, y: 1 },
    { x: 4, y: 2 },
  ]);
});

test("fixed-step clock caps catch-up while retaining interpolation remainder", () => {
  const clock = new FixedStepClock(50, 3);
  let ticks = 0;
  assert.deepEqual(clock.consume(125, () => ticks++), {
    steps: 2,
    droppedSteps: 0,
    interpolation: 0.5,
  });
  assert.deepEqual(clock.consume(500, () => ticks++), {
    steps: 3,
    droppedSteps: 7,
    interpolation: 0.5,
  });
  assert.equal(ticks, 5);
});

test("legacy balance records map source-labeled fields into engine units", () => {
  assert.equal(LEGACY_MOVEMENT_UNITS_PER_CELL, 256);
  assert.deepEqual(
    unitOptionsFromLegacy(
      {
        index: 0,
        sprite: "TRSC",
        faction: 0,
        movementSpeed: 25,
        observationDay: 7,
        observationNight: 4,
        weapons: [1, 2, 3],
        health: 150,
      },
      [{ id: 1, rateOfFire: 15, damage: 100, range: 4 }],
    ),
    {
      faction: "human",
      speedSubcellsPerTick: 100,
      maxHealth: 150,
      vision: { dayRangeCells: 7, nightRangeCells: 4 },
      weapon: { damage: 100, rangeCells: 4, cooldownTicks: 15 },
    },
  );
});

test("legacy missions expand static placements and c>0 reinforcements only", () => {
  assert.deepEqual(
    expandLegacyMissionEntities(
      [[22, 3, 84, 0, -1, 0]],
      [
        {
          mode: "norm",
          condition: "(c>0)",
          actions: [
            { name: "reinforce", arguments: [0, 22, 2, 0, 4, 69, 1, 0, 0] },
            { name: "msg", arguments: [2, 0, 1, 3, 8] },
          ],
        },
        {
          mode: "trip",
          condition: "(S==0)",
          actions: [{ name: "reinforce", arguments: [1, 50, 50, 8, 20] }],
        },
      ],
      96,
      84,
    ),
    [
      { source: "placement", x: 22, y: 3, unitType: 84, team: 0, rawTail: [-1, 0] },
      { source: "reinforcement", x: 22, y: 2, unitType: 0, team: 0, rawTail: [] },
      { source: "reinforcement", x: 23, y: 2, unitType: 0, team: 0, rawTail: [] },
      { source: "reinforcement", x: 21, y: 2, unitType: 0, team: 0, rawTail: [] },
      { source: "reinforcement", x: 22, y: 3, unitType: 0, team: 0, rawTail: [] },
      { source: "reinforcement", x: 22, y: 1, unitType: 69, team: 0, rawTail: [] },
    ],
  );
});

test("legacy missions expose initial source messages and waypoint routes", () => {
  const blocks = [
    {
      mode: "norm",
      condition: "(c>0)",
      actions: [
        { name: "waypoint", arguments: [41, 12, 2, 40, 14, 41, 12] },
        { name: "msg", arguments: [2, 0, 1, 3, 8] },
      ],
    },
  ];
  assert.equal(initialLegacyMessageId(blocks), 1);
  assert.deepEqual(initialLegacyWaypointRoutes(blocks), [
    { sourceX: 41, sourceY: 12, points: [{ x: 40, y: 14 }, { x: 41, y: 12 }] },
  ]);
});

test("command replay produces byte-for-byte equivalent snapshots", () => {
  const create = () => {
    const costs = new Uint16Array(25).fill(1);
    costs[12] = 0;
    const simulation = new DeterministicSimulation(new NavigationGrid(5, 5, costs), {
      seed: 99,
      dayNightCycleTicks: 40,
    });
    const human = simulation.addUnit({ faction: "human", cell: { x: 0, y: 2 } });
    const alien = simulation.addUnit({ faction: "alien", cell: { x: 4, y: 4 }, speedSubcellsPerTick: 512 });
    simulation.queue({ type: "move", unitIds: [human], target: { x: 4, y: 2 } }, 0);
    simulation.queue({ type: "move", unitIds: [alien], target: { x: 0, y: 4 } }, 5);
    simulation.queue({ type: "stop", unitIds: [alien] }, 8);
    return simulation;
  };
  const first = create();
  const second = create();
  for (let tick = 0; tick < 40; tick += 1) {
    first.advance();
    second.advance();
    assert.deepEqual(second.snapshot, first.snapshot);
  }
  assert.deepEqual(first.snapshot.units[0], {
    id: 1,
    faction: "human",
    activity: "idle",
    xSubcells: 4608,
    ySubcells: 2560,
    cellX: 4,
    cellY: 2,
    health: 100,
    maxHealth: 100,
    cargo: 0,
    cargoCapacity: 0,
    targetId: null,
  });
});

test("combat damage resolves simultaneously without entity-order advantage", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(2, 1));
  const human = simulation.addUnit({
    faction: "human",
    cell: { x: 0, y: 0 },
    maxHealth: 100,
    weapon: { damage: 100, rangeCells: 1, cooldownTicks: 2 },
  });
  const alien = simulation.addUnit({
    faction: "alien",
    cell: { x: 1, y: 0 },
    maxHealth: 100,
    weapon: { damage: 100, rangeCells: 1, cooldownTicks: 2 },
  });
  simulation.queue({ type: "attack", unitIds: [human], targetId: alien });
  simulation.queue({ type: "attack", unitIds: [alien], targetId: human });
  simulation.advance();

  assert.deepEqual(
    simulation.snapshot.units.map(({ id, health, activity }) => ({ id, health, activity })),
    [
      { id: human, health: 0, activity: "die" },
      { id: alien, health: 0, activity: "die" },
    ],
  );
});

test("weapon cooldowns produce attacks on exact ticks", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(2, 1));
  const attacker = simulation.addUnit({
    faction: "human",
    cell: { x: 0, y: 0 },
    weapon: { damage: 25, rangeCells: 1, cooldownTicks: 3 },
  });
  const target = simulation.addUnit({ faction: "alien", cell: { x: 1, y: 0 } });
  simulation.queue({ type: "attack", unitIds: [attacker], targetId: target });

  const healthByTick = [];
  for (let tick = 0; tick < 4; tick += 1) {
    simulation.advance();
    healthByTick.push(simulation.snapshot.units[1].health);
  }
  assert.deepEqual(healthByTick, [75, 75, 75, 50]);
});

test("asymmetric-range attackers close moving targets without center overshoot", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(16, 12));
  const ranged = simulation.addUnit({
    faction: "human",
    cell: { x: 1, y: 6 },
    speedSubcellsPerTick: 256,
    maxHealth: 150,
    weapon: { damage: 12, rangeCells: 3, cooldownTicks: 10 },
  });
  const melee = simulation.addUnit({
    faction: "alien",
    cell: { x: 14, y: 6 },
    speedSubcellsPerTick: 320,
    maxHealth: 150,
    weapon: { damage: 14, rangeCells: 2, cooldownTicks: 9 },
  });
  simulation.queue({ type: "move", unitIds: [ranged], target: { x: 11, y: 3 } });
  simulation.queue({ type: "move", unitIds: [melee], target: { x: 4, y: 8 } });
  simulation.queue({ type: "attack", unitIds: [ranged], targetId: melee }, 30);
  simulation.queue({ type: "attack", unitIds: [melee], targetId: ranged }, 30);
  for (let tick = 0; tick < 120; tick += 1) simulation.advance();

  assert.ok(simulation.snapshot.units[0].health < 150);
  assert.ok(simulation.snapshot.units[1].health < 150);
});

test("harvesters deplete nodes, transport cargo, and deposit exact resources", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(3, 1));
  const harvester = simulation.addUnit({
    faction: "human",
    cell: { x: 0, y: 0 },
    speedSubcellsPerTick: 1024,
    harvester: { cargoCapacity: 10, harvestPerTick: 5 },
  });
  const resource = simulation.addResourceNode({ cell: { x: 1, y: 0 }, amount: 15 });
  simulation.queue({
    type: "harvest",
    unitIds: [harvester],
    resourceId: resource,
    dropoff: { x: 0, y: 0 },
  });
  for (let tick = 0; tick < 11; tick += 1) simulation.advance();

  assert.deepEqual(simulation.snapshot.resources, { alien: 0, human: 15 });
  assert.deepEqual(simulation.snapshot.resourceNodes, [
    { id: resource, cellX: 1, cellY: 0, remaining: 0 },
  ]);
  assert.deepEqual(
    simulation.snapshot.units.map(({ activity, cargo, targetId }) => ({ activity, cargo, targetId })),
    [{ activity: "idle", cargo: 0, targetId: null }],
  );
});

test("base node slots and paid construction queues are stable", () => {
  assert.deepEqual(baseNodeCells({ x: 10, y: 10 }), [
    { x: 10, y: 8 },
    { x: 12, y: 8 },
    { x: 12, y: 10 },
    { x: 12, y: 12 },
    { x: 10, y: 12 },
    { x: 8, y: 12 },
    { x: 8, y: 10 },
    { x: 8, y: 8 },
  ]);

  const simulation = new DeterministicSimulation(new NavigationGrid(8, 8), {
    initialResources: { human: 100 },
  });
  const core = simulation.addBuilding({
    faction: "human",
    kind: "core",
    cell: { x: 2, y: 2 },
    maxHealth: 1000,
  });
  simulation.queue({
    type: "build",
    builderId: core,
    kind: "turret",
    target: { x: 4, y: 2 },
    cost: 60,
    buildTicks: 3,
    maxHealth: 375,
  });
  simulation.queue({
    type: "build",
    builderId: core,
    kind: "research",
    target: { x: 4, y: 2 },
    cost: 20,
    buildTicks: 1,
    maxHealth: 500,
  });

  simulation.advance();
  assert.equal(simulation.snapshot.resources.human, 40);
  assert.deepEqual(simulation.snapshot.buildings[0].constructionQueue, [
    {
      kind: "turret",
      targetCellX: 4,
      targetCellY: 2,
      remainingTicks: 2,
      totalTicks: 3,
      cost: 60,
      maxHealth: 375,
    },
  ]);
  simulation.advance();
  simulation.advance();
  assert.equal(simulation.snapshot.buildings.length, 2);
  assert.deepEqual(
    simulation.snapshot.buildings.map(({ kind, cellX, cellY, health, maxHealth }) => ({
      kind,
      cellX,
      cellY,
      health,
      maxHealth,
    })),
    [
      { kind: "core", cellX: 2, cellY: 2, health: 1000, maxHealth: 1000 },
      { kind: "turret", cellX: 4, cellY: 2, health: 375, maxHealth: 375 },
    ],
  );
});

test("daylight applies opposing human and alien vision scales", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(9, 9), {
    dayNightCycleTicks: 20,
  });
  simulation.addUnit({ faction: "human", cell: { x: 4, y: 4 } });
  simulation.addUnit({ faction: "alien", cell: { x: 4, y: 4 } });
  assert.equal(simulation.snapshot.timeOfDay, "night");
  assert.equal(simulation.visionRadius(100, "human"), 50);
  assert.equal(simulation.visionRadius(100, "alien"), 150);
  assert.equal(simulation.visibilityMask("human", 2).reduce((sum, value) => sum + value, 0), 5);
  assert.equal(simulation.visibilityMask("alien", 2).reduce((sum, value) => sum + value, 0), 25);
  for (let tick = 0; tick < 10; tick += 1) simulation.advance();
  assert.equal(simulation.snapshot.daylightPermille, 1000);
  assert.equal(simulation.visionRadius(100, "human"), 150);
  assert.equal(simulation.visionRadius(100, "alien"), 50);
  assert.equal(simulation.visibilityMask("human", 2).reduce((sum, value) => sum + value, 0), 25);
  assert.equal(simulation.visibilityMask("alien", 2).reduce((sum, value) => sum + value, 0), 5);
});

test("source observation radii override generic faction visibility", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(21, 21), {
    dayNightCycleTicks: 20,
  });
  simulation.addUnit({
    faction: "human",
    cell: { x: 10, y: 10 },
    vision: { dayRangeCells: 7, nightRangeCells: 4 },
  });
  assert.equal(simulation.visibilityMask("human", 1).reduce((sum, value) => sum + value, 0), 41);
  for (let tick = 0; tick < 10; tick += 1) simulation.advance();
  assert.equal(simulation.visibilityMask("human", 1).reduce((sum, value) => sum + value, 0), 113);
});
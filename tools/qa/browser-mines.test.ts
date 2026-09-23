import assert from "node:assert/strict";
import test from "node:test";
import { browserMineOptions, validateBrowserMineOptions } from "../../src/engine/browser-mines";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { NavigationGrid } from "../../src/engine/grid";
import { auditFireMovement } from "./fixtures/source-fire-movement-audit";

const source = { runtimeProfile: "browser-adapted", weapons: [
  { id: 38, rawPrefix: 6, damage: 1300, range: 1, shots: 2, rateOfFire: 150 },
], damageMatrix: Array.from({ length: 9 }, () => Array(10).fill(256)) };
const stat = { index: 45, sprite: "HMINE", faction: 0, movementSpeed: 0, observationDay: 1, observationNight: 1,
  weapons: [38, 38, 38] as const, health: 100 };

test("adapted mines: explicit source contract excludes strict, other types and invented BOOM radius", () => {
  assert.equal(browserMineOptions({ ...source, runtimeProfile: undefined }, stat), undefined);
  assert.equal(browserMineOptions(source, { ...stat, index: 41 }), undefined);
  for (const index of [45, 46]) {
    const mine = browserMineOptions(source, { ...stat, index })!;
    assert.equal(mine.sourceTypeIndex, index);
    assert.equal(mine.boomId, 2);
    assert.equal(mine.splashRange, 1);
    assert.equal(mine.radiusPolicy, "weapon-range-fallback");
    assert.notEqual(mine.weapon.sourceDamage.coefficients, source.damageMatrix[6]);
    validateBrowserMineOptions(JSON.parse(JSON.stringify(mine)));
    assert.throws(() => validateBrowserMineOptions({ ...mine, splashRange: 2 }));
    assert.throws(() => validateBrowserMineOptions({ ...mine, sourceTypeIndex: 41 } as unknown as typeof mine));
    assert.throws(() => validateBrowserMineOptions({ ...mine, cooldown: 0 } as typeof mine));
  }
});

test("adapted mines: legal approach, simultaneous splash/self death, one shot per victim and JSON replay", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(9, 7));
  const mine = simulation.addStaticTarget({ faction: "human", team: 0, cell: { x: 4, y: 3 }, maxHealth: 100,
    mine: browserMineOptions(source, stat) });
  const neighbor = simulation.addStaticTarget({ faction: "human", team: 0, cell: { x: 4, y: 3 }, maxHealth: 100 });
  const enemy = simulation.addUnit({ faction: "alien", team: 1, cell: { x: 2, y: 3 }, maxHealth: 2000,
    speedSubcellsPerTick: 1024, sourceDefense: { targetClass: 0, armorFactor: 128 } });
  const second = simulation.addUnit({ faction: "alien", team: 1, cell: { x: 4, y: 4 }, maxHealth: 1000 });
  simulation.queue({ type: "move", unitIds: [enemy], target: { x: 3, y: 3 } });
  const restored = DeterministicSimulation.restore(JSON.parse(JSON.stringify(simulation.checkpoint())));
  const before = simulation.checkpoint();
  simulation.queue({ type: "move", unitIds: [mine], target: { x: 0, y: 0 } });
  restored.queue({ type: "move", unitIds: [mine], target: { x: 0, y: 0 } });
  simulation.advance(); restored.advance();
  assert.equal(auditFireMovement(before, simulation.checkpoint()).shots.length, 2);
  const displaced = simulation.checkpoint();
  Object.assign(displaced.staticTargets[0], { xSubcells: displaced.staticTargets[0].xSubcells + 1 });
  assert.throws(() => auditFireMovement(before, displaced), /shot X displacement/);
  assert.deepEqual(restored.checkpoint(), simulation.checkpoint());
  assert.deepEqual(simulation.combatEvents.map(event => [event.attackerId, event.targetId, event.damage]),
    [[mine, enemy, 650], [mine, second, 1300]]);
  assert.deepEqual(simulation.deathEvents.map(event => event.targetId), [mine, second]);
  assert.equal(simulation.snapshot.staticTargets[0].health, 0);
  assert.equal(simulation.snapshot.staticTargets[1].id, neighbor);
  assert.equal(simulation.snapshot.staticTargets[1].health, 100);
  assert.equal(simulation.snapshot.staticTargets[0].xSubcells, 4.5 * 1024);
  assert.deepEqual(simulation.staticObstacleCells, []);
  const after = DeterministicSimulation.restore(JSON.parse(JSON.stringify(simulation.checkpoint())));
  for (let tick = 0; tick < 155; tick++) {
    simulation.advance(); after.advance();
    assert.deepEqual(after.checkpoint(), simulation.checkpoint());
    assert.deepEqual(simulation.combatEvents, []);
    assert.deepEqual(simulation.deathEvents, []);
  }
});

test("adapted mines: air, friendly, allied, neutral, absent-team and out-of-range controls", () => {
  for (const control of ["air", "friendly", "allied", "neutral", "neutral-mine", "absent-team", "outside"] as const) {
    const simulation = new DeterministicSimulation(new NavigationGrid(9, 7), { teamAlliances: [[1, 1, 0]] });
    simulation.addStaticTarget({ faction: "human", team: control === "neutral-mine" ? 8 : 0,
      cell: { x: 4, y: 3 }, maxHealth: 800, mine: browserMineOptions(source, { ...stat, index: 46 }) });
    simulation.addUnit({ faction: "alien", team: control === "friendly" ? 0 : control === "allied" ? 1
      : control === "neutral" ? 8 : control === "absent-team" ? undefined : 2,
      movementPlane: control === "air" ? "air" : "ground",
      cell: { x: control === "outside" ? 6 : 5, y: 3 }, maxHealth: 2000 });
    for (let tick = 0; tick < 152; tick++) {
      simulation.advance();
      assert.deepEqual(simulation.combatEvents, [], control);
      assert.deepEqual(simulation.deathEvents, [], control);
    }
    assert.equal(simulation.snapshot.staticTargets[0].health, 800, control);
  }
});

test("adapted mines: observer alliances update live; blast excludes allies/air/neutrals/statics and uses class1 armor", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(9, 7), { teamAlliances: [[1, 1], [0, 1]] });
  simulation.addStaticTarget({ faction: "human", team: 0, cell: { x: 4, y: 3 }, maxHealth: 800,
    mine: browserMineOptions(source, stat) });
  const ground = simulation.addUnit({ faction: "human", team: 1, cell: { x: 5, y: 3 }, maxHealth: 2000,
    sourceDefense: { targetClass: 1, armorFactor: 128 } });
  const air = simulation.addUnit({ faction: "alien", team: 1, movementPlane: "air", cell: { x: 5, y: 3 }, maxHealth: 2000,
    sourceDefense: { targetClass: 2, armorFactor: 256 } });
  const neutral = simulation.addUnit({ faction: "alien", team: 8, cell: { x: 4, y: 4 }, maxHealth: 2000 });
  const friend = simulation.addUnit({ faction: "alien", team: 0, cell: { x: 3, y: 3 }, maxHealth: 2000 });
  simulation.addStaticTarget({ faction: "alien", team: 1, cell: { x: 4, y: 2 }, maxHealth: 2000 });
  simulation.advance();
  assert.equal(simulation.combatEvents.length, 0);
  simulation.setTeamAlliances([[1, 0], [1, 1]]);
  simulation.advance();
  assert.deepEqual(simulation.combatEvents.map(event => [event.targetId, event.damage]), [[ground, 650]]);
  assert.ok(simulation.snapshot.units.filter(unit => [air, neutral, friend].includes(unit.id)).every(unit => unit.health === 2000));
  assert.equal(simulation.snapshot.staticTargets[1].health, 2000);
});

test("adapted mines: simultaneous lethal fire does not cancel detonation; strict checkpoint and admission guards", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(9, 7));
  const options = { faction: "human" as const, team: 0, cell: { x: 4, y: 3 }, maxHealth: 800,
    mine: browserMineOptions(source, stat)! };
  const mine = simulation.addStaticTarget(options);
  const enemy = simulation.addUnit({ faction: "alien", team: 1, cell: { x: 5, y: 3 }, maxHealth: 2000,
    weapon: { damage: 800, rangeCells: 1, cooldownTicks: 1 } });
  assert.throws(() => simulation.addStaticTarget({ ...options, weapon: options.mine.weapon }));
  assert.throws(() => simulation.addStaticTarget({ ...options, footprint: [options.cell] }));
  const saved = simulation.checkpoint();
  for (const mutate of [
    (state: typeof saved) => Object.assign(state.staticTargets[0].mine!, { sourceTypeIndex: 42 }),
    (state: typeof saved) => Object.assign(state.staticTargets[0].mine!, { repeat: true }),
    (state: typeof saved) => Object.assign(state.staticTargets[0], { attackCooldown: 0 }),
    (state: typeof saved) => Object.assign(state.staticTargets[0], { footprint: [3] }),
  ]) {
    const invalid = structuredClone(saved); mutate(invalid);
    assert.throws(() => DeterministicSimulation.restore(invalid));
  }
  simulation.queue({ type: "attack", unitIds: [enemy], targetId: mine });
  simulation.advance();
  assert.deepEqual(simulation.combatEvents.map(event => event.attackerId), [enemy, mine]);
  assert.deepEqual(simulation.deathEvents.map(event => event.targetId), [mine]);
  assert.equal(simulation.snapshot.units[0].health, 700);
});
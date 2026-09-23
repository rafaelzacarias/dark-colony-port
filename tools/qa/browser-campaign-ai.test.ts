import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { createBrowserCampaignAiConfiguration, initializeBrowserCampaignAi, computeBrowserCampaignAi,
  restoreBrowserCampaignAi, type BrowserCampaignAiObservation } from "../../src/engine/browser-campaign-ai";
import { NavigationGrid } from "../../src/engine/grid";
import { createLegacyInfantryFamilyMask } from "../../src/engine/legacy-navigation";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { CampaignSession, initializeCampaignPlacements } from "../../src/engine/campaign-session";
import { createBrowserAiSelectorConfiguration } from "../../src/engine/browser-campaign-runtime";
import { parseTriggerScript } from "../extractors/data/triggers";
import { parseScenario, type ScenarioDefinition } from "../extractors/data/scenario";
import { parseDependencies, parseUnitStats, parseWeaponStats, type UnitStatRecord, type WeaponStatRecord } from "../extractors/data/tables";
import { parseMapBundle } from "../extractors/maps/map";
import type { AdaptedTroProjection } from "../../src/engine/campaign-world";

const scenario: ScenarioDefinition = { id: "fixture", title: "fixture", terrainBank: "", rawHeader: [], placementRows: [],
  teams: Array.from({ length: 8 }, (_, index) => ({ index, enabled: 1, race: index % 2, money: 0,
    ai: index === 1 ? 3 : 0, teamColor: index, dependencies: [], allies: Array.from({ length: 8 }, (_, other) =>
      Number(other === index || other > 1)), aiSlots: [0, 1], coordinateRows: [[0, 0], index === 0 ? [12, 3] : [0, 0]], cityRows: [] })) };
const unit: UnitStatRecord = { index: 0, sprite: "TRSC", faction: 0, turnSpeed: 1, movementSpeed: 40,
  observationDay: 5, observationNight: 3, weapons: [1, 1, 1], armorUpgradePercentages: [100, 100], targetClass: 0,
  health: 800, rawTail: [] };
const weapon: WeaponStatRecord = { id: 1, damage: 100, range: 4, visualClass: "", soundId: 0, rateOfFire: 1,
  speed: 1, shots: 1, reload: 1, magicChewing: 0, rawPrefix: 0, rawTail: [] };
const configuration = () => createBrowserCampaignAiConfiguration({ scenario, units: [unit], weapons: [weapon],
  dependencies: [], pathGrid: new NavigationGrid(16, 8) });

test("browser AI damage eligibility: filters visible candidates once without mutating observations", async () => {
  const config = await configuration(), initial = initializeBrowserCampaignAi(config);
  const current = { ...observation(), visibleIdsByTeam: { 1: [2] } };
  const before = structuredClone(current);
  for (const eligible of [false, true]) {
    const calls: number[][] = [];
    const result = computeBrowserCampaignAi(config, initial, { ...current,
      targetCanDamage: (attackerId, targetId) => { calls.push([attackerId, targetId]); return eligible; } });
    assert.deepEqual(calls, [[1, 2]]);
    assert.equal(result.commands.some(order => order.command.type === "attack"), eligible);
    assert.deepEqual(current, before);
  }
  computeBrowserCampaignAi(config, initial, { ...current, visibleIdsByTeam: { 1: [] },
    targetCanDamage: () => { assert.fail("hidden targets must not be queried"); } });
});

test("browser AI damage eligibility: source matrices and typed armor govern acquisition, retention and switching", async () => {
  const matrix = JSON.parse(readFileSync(new URL("../../public/assets/generated/data/damage-matrix.json", import.meta.url), "utf8"))
    .coefficients as number[][];
  for (const mode of [1, 2, 3]) {
    const config = await localConfiguration(mode);
    for (const entry of [
      { row: 0, damage: 100, targetClass: 8, armorFactor: 256 },
      { row: 1, damage: 100, targetClass: 8, armorFactor: 256 },
      { row: 0, damage: 100, targetClass: 0, armorFactor: 0 },
      { row: 0, damage: 4, targetClass: 0, armorFactor: 204 },
    ]) {
      const simulation = new DeterministicSimulation(new NavigationGrid(16, 8));
      const attacker = simulation.addUnit({ faction: "human", team: 1, cell: { x: 2, y: 3 }, maxHealth: 800,
        weapon: { damage: entry.damage, rangeCells: 4, cooldownTicks: 10,
          sourceDamage: { coefficients: matrix[entry.row], callerFactor: 256, specialFlag: false } } });
      const immune = simulation.addStaticTarget({ faction: "human", team: 0, cell: { x: 3, y: 3 }, maxHealth: 800,
        sourceDefense: { targetClass: entry.targetClass, armorFactor: entry.armorFactor,
          ...(entry.targetClass === 8 ? { sourceTypeIndex: 84 } : {}) } });
      const eligible = simulation.addStaticTarget({ faction: "human", team: 0, cell: { x: 4, y: 3 }, maxHealth: 800,
        sourceDefense: { targetClass: 0, armorFactor: 256 } });
      const alternate = simulation.addUnit({ faction: "human", team: 0, cell: { x: 5, y: 3 }, maxHealth: 800,
        sourceDefense: { targetClass: 0, armorFactor: 256, sourceTypeIndex: 0 } });
      const actors = [attacker, immune, eligible, alternate].map(id => ({ key: `actor-${id}`, generation: 0,
        rawSlot: 151 + id, simulationId: id, team: id === attacker ? 1 : 0, unitType: 0, health: 800 }));
      const calls: string[] = [];
      const input = (tick: number): BrowserCampaignAiObservation => ({ actors,
        snapshot: { ...simulation.snapshot, tick, timeOfDay: "day", daylightPermille: 1000 },
        visibleIdsByTeam: { 1: [immune, eligible, alternate] },
        targetCanDamage: (attackerId, targetId) => {
          calls.push(`${attackerId}:${targetId}`);
          return simulation.canAutoTarget(attackerId, targetId);
        } });
      const plan = (state: ReturnType<typeof initializeBrowserCampaignAi>, tick: number) => {
        calls.length = 0;
        const before = simulation.checkpoint();
        const result = computeBrowserCampaignAi(config, state, input(tick));
        assert.deepEqual(simulation.checkpoint(), before);
        assert.equal(calls.length, new Set(calls).size);
        assert.equal(calls.length, 3);
        return result;
      };
      assert.equal(simulation.canAutoTarget(attacker, immune), false);
      assert.equal(simulation.canAutoTarget(attacker, eligible), true);
      const initial = initializeBrowserCampaignAi(config);
      const acquired = plan(initial, 0);
      assert.deepEqual(acquired.commands.map(order => order.command), [{ type: "attack", unitIds: [attacker], targetId: eligible }]);
      simulation.queue(acquired.commands[0].command);
      simulation.advance();
      const retained = plan(acquired.state, 20);
      assert.deepEqual(retained.commands, []);
      simulation.updateStaticSourceDefense(eligible, { targetClass: 8, armorFactor: 256 });
      const switched = plan(retained.state, 40);
      assert.deepEqual(switched.commands.map(order => order.command), [{ type: "attack", unitIds: [attacker], targetId: alternate }]);
      const hidden = computeBrowserCampaignAi(config, retained.state, { ...input(40), visibleIdsByTeam: { 1: [immune, eligible] } });
      assert.deepEqual(hidden.commands.map(order => order.command), [{ type: "stop", unitIds: [attacker] }]);
      if (mode !== 3) {
        calls.length = 0;
        assert.deepEqual(computeBrowserCampaignAi(config, initial, input(40)).commands, [], "manual attacks are not AI-owned");
        assert.deepEqual(calls, []);
      }
    }
  }
});

test("browser AI air: observed plane crosses impassable terrain and ground footprints without hidden-position leaks", async () => {
  const grid = new NavigationGrid(16, 8, new Uint16Array(128));
  const config = await createBrowserCampaignAiConfiguration({ scenario, units: [unit], weapons: [weapon], dependencies: [], pathGrid: grid });
  const initial = initializeBrowserCampaignAi(config);
  const ground = { ...observation(), visibleIdsByTeam: { 1: [] }, staticObstacles: { 1: [{ x: 12, y: 3 }] } };
  assert.deepEqual(computeBrowserCampaignAi(config, initial, ground).commands, []);
  const air = { ...ground, snapshot: { ...ground.snapshot, units: ground.snapshot.units.map(actor => actor.id === 1
    ? { ...actor, movementPlane: "air" as const } : actor) } };
  const result = computeBrowserCampaignAi(config, initial, air);
  assert.deepEqual(result.commands.map(order => order.command), [{ type: "move", unitIds: [1], target: { x: 12, y: 3 } }]);
  for (const cellX of [3, 12, 15]) assert.deepEqual(computeBrowserCampaignAi(config, initial, { ...air,
    snapshot: { ...air.snapshot, units: air.snapshot.units.map(actor => actor.id === 2 ? { ...actor, cellX } : actor) } }), result);
  assert.deepEqual([...grid.costs], new Array(128).fill(0));
});
const projection = (): AdaptedTroProjection => ({ runtimeProfile: "browser-adapted", cycleCounter: 1,
  teamAlliances: scenario.teams.map(team => [...team.allies]), state: {
    sharedVision: Array.from({ length: 8 }, (_, team) => Array.from({ length: 8 }, (_, other) => Number(team === other))),
    dependencyRestrictions: Array.from({ length: 8 }, () => []), noPickup: Array(8).fill(0), aiGroupWeights: {}, events: [] } });
function observation(tick = 0): BrowserCampaignAiObservation {
  return { actors: [1, 2].map(id => ({ key: `actor-${id}`, generation: 0, rawSlot: 151 + id,
    simulationId: id, team: id === 1 ? 1 : 0, unitType: 0, health: 800 })),
  snapshot: { tick, entityCount: 2, timeOfDay: "day", daylightPermille: 1000, randomState: 1,
    resources: { human: 0, alien: 0 }, buildings: [], staticTargets: [], resourceNodes: [],
    units: [1, 2].map(id => ({ id, team: id === 1 ? 1 : 0, faction: "human", activity: "idle",
      cellX: id === 1 ? 2 : 12, cellY: 3, xSubcells: (id === 1 ? 2 : 12) * 256, ySubcells: 768,
      health: 800, maxHealth: 800, cargo: 0, cargoCapacity: 0, targetId: null })) } };
}

test("browser AI source base: zero own coordinates search known hostile home without hidden mobile leaks", async () => {
  const config = await configuration(), initial = initializeBrowserCampaignAi(config);
  assert.equal(config.teams[1].home, null);
  assert.deepEqual(config.teams[1].objectives, [{ x: 12, y: 3 }]);
  const current = { ...observation(), adaptedTroProjection: projection(), visibleIdsByTeam: { 1: [] },
    staticObstacles: { 1: Array.from({ length: 25 }, (_, index) => ({ x: 10 + index % 5, y: 1 + Math.floor(index / 5) })) } };
  const before = structuredClone(current);
  const result = computeBrowserCampaignAi(config, initial, current);
  assert.deepEqual(result.commands.map(order => order.command), [{ type: "move", unitIds: [1], target: { x: 9, y: 3 } }]);
  assert.ok(result.commands[0].route.every(point => !current.staticObstacles[1].some(cell => cell.x === point.x && cell.y === point.y)));
  for (const cellX of [3, 9, 15]) assert.deepEqual(computeBrowserCampaignAi(config, initial, { ...current,
    snapshot: { ...current.snapshot, units: current.snapshot.units.map(actor => actor.id === 2 ? { ...actor, cellX } : actor) } }), result);
  const allied = { ...current.adaptedTroProjection, teamAlliances: current.adaptedTroProjection.teamAlliances.map((row, team) =>
    team === 1 ? row.map((flag, other) => other === 0 ? 1 : flag) : row) };
  assert.deepEqual(computeBrowserCampaignAi(config, initial, { ...current, adaptedTroProjection: allied }).commands, []);
  const localEnemy = { ...observation(), snapshot: { ...observation().snapshot,
    units: observation().snapshot.units.map(actor => actor.id === 2 ? { ...actor, cellX: 5, xSubcells: 5 * 256 } : actor) } };
  assert.deepEqual(computeBrowserCampaignAi(config, initial, localEnemy).commands.map(order => order.command),
    [{ type: "attack", unitIds: [1], targetId: 2 }], "source sight ray discovers a nearby armed hostile without supplied visibility");
  assert.deepEqual(current, before);
  const fresh = await configuration();
  assert.deepEqual(computeBrowserCampaignAi(fresh, restoreBrowserCampaignAi(fresh, JSON.parse(JSON.stringify(initial))), current), result);
});

test("browser AI TRO projection changes directed targets and source objectives", async () => {
  const config = await configuration(), initial = initializeBrowserCampaignAi(config);
  const projected = projection();
  const allied = { ...projected, teamAlliances: projected.teamAlliances.map((row, team) =>
    team === 1 ? row.map((flag, other) => other === 0 ? 1 : flag) : row) };
  assert.deepEqual(computeBrowserCampaignAi(config, initial, { ...observation(),
    adaptedTroProjection: allied, visibleIdsByTeam: { 1: [2] } }).commands, []);
  assert.equal(computeBrowserCampaignAi(config, initial, { ...observation(),
    adaptedTroProjection: projected, visibleIdsByTeam: { 1: [2] } }).commands[0].command.type, "attack");
});

test("browser AI TRO weights change mode-3 frequency and zero stops active orders", async () => {
  const config = await configuration(), initial = initializeBrowserCampaignAi(config), projected = projection();
  const weighted = (weight: number) => ({ ...projected, state: { ...projected.state, aiGroupWeights: { 1: { 1: weight, 3: 8 } } } });
  const count = (weight: number) => Array.from({ length: 128 }, (_, seed) => computeBrowserCampaignAi(config,
    initializeBrowserCampaignAi(config, seed), { ...observation(), adaptedTroProjection: weighted(weight),
      visibleIdsByTeam: { 1: [2] } }).commands.length).reduce((sum, value) => sum + value, 0);
  assert.equal(count(0), 0);
  assert.ok(count(1) > 0 && count(1) < count(4));
  assert.ok(count(4) < count(8));
  assert.equal(count(8), 128);
  const current = observation();
  const stopped = computeBrowserCampaignAi(config, initial, { ...current, adaptedTroProjection: weighted(0),
    snapshot: { ...current.snapshot, units: current.snapshot.units.map(actor => actor.id === 1
      ? { ...actor, activity: "attack", targetId: 2 } : actor) } });
  assert.deepEqual(stopped.commands.map(order => order.command), [{ type: "stop", unitIds: [1] }]);
});

test("browser AI TRO mode-3 weighted orders repeat exactly and resume from JSON checkpoints", async () => {
  const config = await configuration(), fresh = await configuration(), projected = projection();
  let state = initializeBrowserCampaignAi(config, 42), restored = initializeBrowserCampaignAi(fresh, 42);
  const issued: string[] = [];
  for (let tick = 0; tick <= 320; tick += 20) {
    const weight = [8, 0, 1, 4][tick / 20 % 4];
    const current = observation(tick);
    const input: BrowserCampaignAiObservation = { ...current, visibleIdsByTeam: { 1: [2] },
      adaptedTroProjection: { ...projected, state: { ...projected.state, aiGroupWeights: { 1: { 1: weight, 3: 8 } } } },
      snapshot: { ...current.snapshot, units: current.snapshot.units.map(actor => actor.id === 1
        ? { ...actor, activity: "attack", targetId: 2 } : actor) } };
    const result = computeBrowserCampaignAi(config, state, input);
    assert.deepEqual(computeBrowserCampaignAi(config, state, input), result);
    assert.deepEqual(computeBrowserCampaignAi(fresh, restored, input), result);
    assert.deepEqual(computeBrowserCampaignAi(config, result.state, input).commands, []);
    if (weight === 0) assert.deepEqual(result.commands.map(order => order.command), [{ type: "stop", unitIds: [1] }]);
    issued.push(...result.commands.map(order => order.command.type));
    state = result.state;
    restored = restoreBrowserCampaignAi(fresh, JSON.parse(JSON.stringify(state)));
  }
  assert.ok(issued.includes("attack") && issued.includes("stop"));
  assert.deepEqual(restored, state);
});

const localScenario = (selector: number): ScenarioDefinition => ({ ...scenario, teams: scenario.teams.map(team =>
  team.index === 1 ? { ...team, ai: selector, coordinateRows: [[2, 6], [6, 3]] } : team) });
const localConfiguration = (selector: number) => createBrowserCampaignAiConfiguration({ scenario: localScenario(selector),
  units: [unit], weapons: [weapon], dependencies: [], pathGrid: new NavigationGrid(16, 8) });
const localObservation = (tick = 0): BrowserCampaignAiObservation => {
  const current = observation(tick);
  return { ...current, snapshot: { ...current.snapshot, units: current.snapshot.units.map(actor => actor.id === 2
    ? { ...actor, cellX: 6, xSubcells: 6 * 256 } : actor) } };
};

test("browser AI local modes: defend home, patrol own waypoints, and ignore mode-3 weights", async () => {
  for (const mode of [1, 2]) {
    const config = await localConfiguration(mode), initial = initializeBrowserCampaignAi(config), projected = projection();
    const current = { ...observation(), visibleIdsByTeam: { 1: [] } };
    const result = computeBrowserCampaignAi(config, initial, current);
    assert.deepEqual(result.commands.map(order => order.command), [{ type: "move", unitIds: [1], target: { x: 6, y: 3 } }]);
    for (const weight of [0, 8, -1]) assert.deepEqual(computeBrowserCampaignAi(config, initial, { ...current,
      adaptedTroProjection: { ...projected, state: { ...projected.state, aiGroupWeights: { 1: { 1: weight } } } } }), result);
    const arrived = { ...observation(20), visibleIdsByTeam: { 1: [] }, snapshot: { ...observation(20).snapshot,
      units: observation().snapshot.units.map(actor => actor.id === 1 ? { ...actor, cellX: 6 } : actor) } };
    const next = computeBrowserCampaignAi(config, result.state, arrived);
    assert.deepEqual(next.commands.map(order => order.command), mode === 1 ? []
      : [{ type: "move", unitIds: [1], target: { x: 2, y: 6 } }]);
    assert.equal(next.state.teams[1].rng, result.state.teams[1].rng);
    const fresh = await localConfiguration(mode);
    assert.deepEqual(computeBrowserCampaignAi(fresh, restoreBrowserCampaignAi(fresh, JSON.parse(JSON.stringify(result.state))), arrived), next);
  }
});

test("browser AI local modes: stop only owned lost-target attacks and then return home", async () => {
  for (const mode of [1, 2]) {
    const config = await localConfiguration(mode), initial = initializeBrowserCampaignAi(config);
    const attack = computeBrowserCampaignAi(config, initial, { ...localObservation(), visibleIdsByTeam: { 1: [2] } });
    assert.deepEqual(attack.commands.map(order => order.command), [{ type: "attack", unitIds: [1], targetId: 2 }]);
    assert.equal(attack.commands[0].stance, "defend");
    const hidden = { ...localObservation(20), visibleIdsByTeam: { 1: [] }, snapshot: { ...localObservation(20).snapshot,
      units: localObservation().snapshot.units.map(actor => actor.id === 1 ? { ...actor, activity: "attack" as const, targetId: 2 } : actor) } };
    const stopped = computeBrowserCampaignAi(config, attack.state, hidden);
    assert.deepEqual(stopped.commands.map(order => order.command), [{ type: "stop", unitIds: [1] }]);
    const returned = computeBrowserCampaignAi(config, stopped.state, { ...observation(40), visibleIdsByTeam: { 1: [] } });
    assert.deepEqual(returned.commands.map(order => order.command), [{ type: "move", unitIds: [1], target: { x: 6, y: 3 } }]);
    assert.deepEqual(computeBrowserCampaignAi(config, initial, hidden).commands, [], "external attack is not ours to stop");
    const replaced = { ...hidden, snapshot: { ...hidden.snapshot, units: hidden.snapshot.units.map(actor => actor.id === 1
      ? { ...actor, targetId: 99 } : actor) } };
    assert.deepEqual(computeBrowserCampaignAi(config, attack.state, replaced).commands, [], "different external attack is preserved");
    const scripted = { ...hidden, snapshot: { ...hidden.snapshot, units: hidden.snapshot.units.map(actor => actor.id === 1
      ? { ...actor, activity: "move" as const, targetId: null } : actor) } };
    assert.deepEqual(computeBrowserCampaignAi(config, attack.state, scripted).commands, [], "TRO movement replaces our attack");
    assert.deepEqual(computeBrowserCampaignAi(config, initial, { ...scripted, visibleIdsByTeam: { 1: [2] } })
      .commands, [], "visible threats cannot commandeer an external route");
    assert.deepEqual(computeBrowserCampaignAi(config, attack.state, { ...replaced, visibleIdsByTeam: { 1: [2] } })
      .commands, [], "visible threats cannot replace an external attack");
    const idleHome = { ...observation(20), visibleIdsByTeam: { 1: [] }, snapshot: { ...observation(20).snapshot,
      units: observation().snapshot.units.map(actor => actor.id === 1 ? { ...actor, cellX: 6 } : actor) } };
    if (mode === 1) {
      const released = computeBrowserCampaignAi(config, attack.state, idleHome);
      assert.equal(released.state.actors["actor-1:0:1"].signature, "");
      assert.deepEqual(computeBrowserCampaignAi(config, released.state, { ...hidden,
        snapshot: { ...hidden.snapshot, tick: 40 } }).commands, []);
    }
  }
});

test("browser AI local modes: source sight and weapon bounds stop pursuit even while a target remains visible", async () => {
  for (const mode of [1, 2]) {
    const config = await localConfiguration(mode), initial = initializeBrowserCampaignAi(config);
    const atDistance = (separation: number, timeOfDay: "day" | "night", tick = 0): BrowserCampaignAiObservation => {
      const current = localObservation(tick);
      return { ...current, visibleIdsByTeam: { 1: [2] }, snapshot: { ...current.snapshot, timeOfDay,
        units: current.snapshot.units.map(actor => actor.id === 2
          ? { ...actor, cellX: 2 + separation, xSubcells: (2 + separation) * 256 } : actor) } };
    };
    for (const timeOfDay of ["day", "night"] as const) {
      const radius = timeOfDay === "day" ? 5 : 4;
      const current = atDistance(radius, timeOfDay);
      const attacked = computeBrowserCampaignAi(config, initial, current);
      assert.deepEqual(attacked.commands.map(order => order.command), [{ type: "attack", unitIds: [1], targetId: 2 }]);
      assert.deepEqual(computeBrowserCampaignAi(config, initial, current), attacked, "uncommitted repeat is exact");
      assert.deepEqual(computeBrowserCampaignAi(config, attacked.state, current).commands, [], "committed tick cannot duplicate orders");
      const distant = atDistance(radius + 1, timeOfDay, 20);
      assert.deepEqual(computeBrowserCampaignAi(config, initial, distant).commands.map(order => order.command),
        [{ type: "move", unitIds: [1], target: { x: 6, y: 3 } }], "remote team sight cannot trigger pursuit");
      for (const activity of ["attack", "move"] as const) {
        const escaping = { ...distant, snapshot: { ...distant.snapshot, units: distant.snapshot.units.map(actor => actor.id === 1
          ? { ...actor, activity, targetId: 2 } : actor) } };
        const stopped = computeBrowserCampaignAi(config, attacked.state, escaping);
        assert.deepEqual(stopped.commands.map(order => order.command), [{ type: "stop", unitIds: [1] }]);
        const fresh = await localConfiguration(mode);
        assert.deepEqual(computeBrowserCampaignAi(fresh, restoreBrowserCampaignAi(fresh,
          JSON.parse(JSON.stringify(attacked.state))), escaping), stopped);
        const returned = computeBrowserCampaignAi(config, stopped.state, { ...localObservation(40), visibleIdsByTeam: { 1: [] } });
        assert.deepEqual(returned.commands.map(order => order.command), [{ type: "move", unitIds: [1], target: { x: 6, y: 3 } }]);
      }
    }
  }
});

test("browser AI local modes: active routes stay external until idle and patrol checkpoint continuation is exact", async () => {
  for (const mode of [1, 2]) {
    const config = await localConfiguration(mode), initial = initializeBrowserCampaignAi(config);
    const observe = (tick: number, position: { x: number; y: number }, activity: "move" | "idle"): BrowserCampaignAiObservation => {
      const current = localObservation(tick);
      return { ...current, visibleIdsByTeam: { 1: activity === "move" ? [2] : [] }, snapshot: { ...current.snapshot,
        units: current.snapshot.units.map(actor => actor.id === 1 ? { ...actor, activity, cellX: position.x, cellY: position.y,
          xSubcells: position.x * 256, ySubcells: position.y * 256 } : actor) } };
    };
    const first = computeBrowserCampaignAi(config, initial, observe(0, { x: 2, y: 3 }, "idle"));
    assert.equal(first.commands[0].command.type, "move");
    const moving = observe(20, { x: 3, y: 3 }, "move");
    const preserved = computeBrowserCampaignAi(config, first.state, moving);
    assert.deepEqual(preserved.commands, [], "even a previously AI-issued route lacks observable destination provenance");
    assert.equal(preserved.state.actors["actor-1:0:1"].signature, "");
    const fresh = await localConfiguration(mode);
    let state = preserved.state, restored = restoreBrowserCampaignAi(fresh, JSON.parse(JSON.stringify(state)));
    const suffix: unknown[] = [];
    for (const current of [observe(40, { x: 6, y: 3 }, "idle"), observe(60, { x: 4, y: 5 }, "move"),
      observe(80, { x: 2, y: 6 }, "idle"), observe(100, { x: 3, y: 5 }, "move"), observe(120, { x: 6, y: 3 }, "idle")]) {
      const result = computeBrowserCampaignAi(config, state, current);
      const replay = computeBrowserCampaignAi(fresh, restored, current);
      assert.deepEqual(replay, result);
      assert.deepEqual(computeBrowserCampaignAi(config, state, current), result);
      state = result.state; restored = replay.state;
      suffix.push(...result.commands.map(order => order.command));
    }
    assert.deepEqual(suffix, mode === 1 ? [{ type: "move", unitIds: [1], target: { x: 6, y: 3 } }] : [
      { type: "move", unitIds: [1], target: { x: 2, y: 6 } },
      { type: "move", unitIds: [1], target: { x: 6, y: 3 } },
      { type: "move", unitIds: [1], target: { x: 2, y: 6 } },
    ]);
    const staticDefense = observe(140, { x: 6, y: 3 }, "idle");
    assert.deepEqual(computeBrowserCampaignAi(config, state, { ...staticDefense, visibleIdsByTeam: { 1: [2] } })
      .commands.map(order => order.command), [{ type: "attack", unitIds: [1], targetId: 2 }]);
  }
});

test("browser AI local modes: team vision, directed allies, and hidden positions remain isolated", async () => {
  for (const mode of [1, 2]) {
    const config = await localConfiguration(mode), initial = initializeBrowserCampaignAi(config);
    const hidden = { ...observation(), visibleIdsByTeam: { 0: [2], 1: [] } };
    const expected = computeBrowserCampaignAi(config, initial, hidden);
    for (const cellX of [1, 6, 15]) assert.deepEqual(computeBrowserCampaignAi(config, initial, { ...hidden,
      snapshot: { ...hidden.snapshot, units: hidden.snapshot.units.map(actor => actor.id === 2 ? { ...actor, cellX } : actor) } }), expected);
    const projected = projection();
    const allied = { ...projected, teamAlliances: projected.teamAlliances.map((row, team) => team === 1
      ? row.map((flag, other) => other === 0 ? 1 : flag) : row) };
    assert.deepEqual(computeBrowserCampaignAi(config, initial, { ...hidden, visibleIdsByTeam: { 1: [2] },
      adaptedTroProjection: allied }).commands, expected.commands);
    const observed = { ...observation(), actors: [...observation().actors, { ...observation().actors[1],
      key: "observer", simulationId: 3, rawSlot: 154, team: 2 }], snapshot: { ...observation().snapshot,
      entityCount: 3, units: [...observation().snapshot.units, { ...observation().snapshot.units[1], id: 3, team: 2 }] } };
    assert.deepEqual(computeBrowserCampaignAi(config, initial, { ...observed, adaptedTroProjection: projected }).commands, expected.commands);
    const shared = { ...projected, state: { ...projected.state, sharedVision: projected.state.sharedVision.map((row, team) =>
      team === 1 ? row.map((flag, other) => other === 2 ? 1 : flag) : row) } };
    assert.deepEqual(computeBrowserCampaignAi(config, initial, { ...observed, adaptedTroProjection: shared }).commands.map(order => order.command),
      expected.commands.map(order => order.command), "shared sight does not authorize distant local interceptions");
    assert.deepEqual(computeBrowserCampaignAi(config, initial, { ...observed, adaptedTroProjection: shared,
      visibleIdsByTeam: { 1: [] } }).commands, expected.commands);
  }
});

test("browser AI local modes: exact current footprints, cloned terrain, and source fallback anchors", async () => {
  for (const mode of [1, 2]) {
    const grid = new NavigationGrid(16, 8);
    const input = { scenario: localScenario(mode), units: [unit], weapons: [weapon], dependencies: [], pathGrid: grid };
    const config = await createBrowserCampaignAiConfiguration(input), initial = initializeBrowserCampaignAi(config);
    const footprint = Array.from({ length: 25 }, (_, index) => ({ x: 4 + index % 5, y: 1 + Math.floor(index / 5) }));
    const wall = Array.from({ length: 7 }, (_, cellY) => ({ x: 3, y: cellY + 1 }));
    const current = { ...observation(), visibleIdsByTeam: { 1: [] }, staticObstacles: { 1: [...footprint, ...wall] } };
    const original = structuredClone(current), costs = [...grid.costs];
    const result = computeBrowserCampaignAi(config, initial, current);
    assert.equal(result.commands[0].command.type, "move");
    assert.ok(result.commands[0].route.some(cell => cell.x === 3 && cell.y === 0));
    assert.ok(result.commands[0].route.every(cell => !current.staticObstacles[1].some(blocked => blocked.x === cell.x && blocked.y === cell.y)));
    assert.deepEqual(computeBrowserCampaignAi(config, initial, { ...current, staticObstacles: { 0: current.staticObstacles[1] } }),
      computeBrowserCampaignAi(config, initial, { ...current, staticObstacles: undefined }));
    assert.deepEqual(computeBrowserCampaignAi(config, initial, { ...current,
      staticObstacles: { 1: [...current.staticObstacles[1], { x: 3, y: 0 }] } }).commands, []);
    assert.deepEqual(computeBrowserCampaignAi(config, initial, { ...current,
      staticObstacles: { 1: [{ x: 2, y: 3 }] } }).commands, []);
    assert.deepEqual(current, original);
    assert.deepEqual([...grid.costs], costs);
    grid.costs.fill(0);
    assert.deepEqual(computeBrowserCampaignAi(config, initial, current), result, "factory owns an independent terrain copy");
    const rallyOnly = await createBrowserCampaignAiConfiguration({ ...input, pathGrid: new NavigationGrid(16, 8),
      scenario: { ...input.scenario, teams: input.scenario.teams.map(team => team.index === 1
        ? { ...team, coordinateRows: [[6, 3], [0, 0]] } : team) } });
    assert.deepEqual(computeBrowserCampaignAi(rallyOnly, initializeBrowserCampaignAi(rallyOnly), { ...observation(), visibleIdsByTeam: { 1: [] } })
      .commands.map(order => order.command), [{ type: "move", unitIds: [1], target: { x: 6, y: 3 } }]);
    const noAnchor = await createBrowserCampaignAiConfiguration({ ...input, pathGrid: new NavigationGrid(16, 8),
      scenario: { ...input.scenario, teams: input.scenario.teams.map(team => team.index === 1
        ? { ...team, coordinateRows: [[0, 0], [0, 0]] } : team) } });
    assert.deepEqual(computeBrowserCampaignAi(noAnchor, initializeBrowserCampaignAi(noAnchor), { ...observation(), visibleIdsByTeam: { 1: [] } }).commands, []);
  }
});

test("browser AI local modes: current selectors activate and disable without cancelling retained orders", async () => {
  const config = await localConfiguration(0), initial = initializeBrowserCampaignAi(config);
  for (const mode of [1, 2]) {
    const selectors = config.teams.map(team => team.team === 1 ? mode : team.selector);
    const active = { ...localObservation(), selectors, visibleIdsByTeam: { 1: [2] } };
    const result = computeBrowserCampaignAi(config, initial, active);
    assert.equal(result.commands[0].command.type, "attack");
    assert.deepEqual(computeBrowserCampaignAi(config, result.state, active).commands, []);
    const attacking = { ...observation(20), visibleIdsByTeam: { 1: [] }, snapshot: { ...observation(20).snapshot,
      units: observation().snapshot.units.map(actor => actor.id === 1 ? { ...actor, activity: "attack" as const, targetId: 2 } : actor) } };
    for (const disabled of [0, 4]) {
      const stoppedPolicy = computeBrowserCampaignAi(config, result.state, { ...attacking,
        selectors: selectors.map((selector, team) => team === 1 ? disabled : selector) });
      assert.deepEqual(stoppedPolicy.commands, []);
      assert.deepEqual(stoppedPolicy.state.teams, result.state.teams);
      assert.equal(stoppedPolicy.state.actors["actor-1:0:1"].signature, "");
      assert.deepEqual(computeBrowserCampaignAi(config, stoppedPolicy.state, { ...attacking, selectors,
        snapshot: { ...attacking.snapshot, tick: 40 } }).commands, [], "re-enabling cannot reclaim a released attack");
    }
    const dead = { ...attacking, selectors, visibleIdsByTeam: { 1: [2] }, snapshot: { ...attacking.snapshot,
      units: attacking.snapshot.units.map(actor => actor.id === 2 ? { ...actor, health: 0 } : actor) } };
    assert.deepEqual(computeBrowserCampaignAi(config, result.state, dead).commands.map(order => order.command), [{ type: "stop", unitIds: [1] }]);
  }
});

test("browser AI local modes: real simulation kills then returns home and patrols both anchors", async () => {
  for (const mode of [1, 2]) {
    const config = await localConfiguration(mode), simulation = new DeterministicSimulation(new NavigationGrid(16, 8));
    simulation.addUnit({ faction: "alien", team: 1, cell: { x: 11, y: 3 }, maxHealth: 800,
      speedSubcellsPerTick: 64, weapon: { damage: 800, rangeCells: 4, cooldownTicks: 1 } });
    simulation.addUnit({ faction: "human", team: 0, cell: { x: 12, y: 3 }, maxHealth: 800 });
    let state = initializeBrowserCampaignAi(config), reachedHome = false, reachedRally = false, returnedHome = false;
    const targets: unknown[] = [];
    for (let tick = 0; tick < 400; tick++) {
      const result = computeBrowserCampaignAi(config, state, { actors: observation().actors, snapshot: simulation.snapshot,
        visibleIdsByTeam: { 1: [2] } });
      state = result.state;
      for (const order of result.commands) {
        if (order.command.type === "move") targets.push(order.command.target);
        simulation.queue(order.command);
      }
      simulation.advance();
      const actor = simulation.snapshot.units.find(actor => actor.id === 1)!;
      reachedHome ||= actor.cellX === 6 && actor.cellY === 3;
      reachedRally ||= actor.cellX === 2 && actor.cellY === 6;
      returnedHome ||= reachedRally && actor.cellX === 6 && actor.cellY === 3;
    }
    assert.ok(!simulation.snapshot.units.some(actor => actor.id === 2 && actor.health > 0), "visible enemy must die");
    assert.ok(reachedHome, "local actor must return to source home");
    if (mode === 1) {
      assert.deepEqual(targets, [{ x: 6, y: 3 }]);
      assert.equal(reachedRally, false);
    } else {
      assert.ok(reachedRally && returnedHome, JSON.stringify({ reachedRally, returnedHome, targets, actor: simulation.snapshot.units[0] }));
      assert.deepEqual(targets.slice(0, 3), [{ x: 6, y: 3 }, { x: 2, y: 6 }, { x: 6, y: 3 }]);
    }
  }
});

test("browser AI local modes: mode-3 commands, actor state and RNG remain independent", async () => {
  const config = await configuration(), initial = initializeBrowserCampaignAi(config);
  const base = { ...observation(), visibleIdsByTeam: { 1: [2], 2: [2] } };
  const extra = { ...base, actors: [...base.actors, { ...base.actors[0], key: "local", team: 2, simulationId: 3, rawSlot: 154 }],
    snapshot: { ...base.snapshot, entityCount: 3, units: [...base.snapshot.units, { ...base.snapshot.units[0], id: 3, team: 2 }] } };
  const reference = computeBrowserCampaignAi(config, initial, extra);
  for (const mode of [1, 2]) {
    const result = computeBrowserCampaignAi(config, initial, { ...extra,
      selectors: config.teams.map(team => team.team === 2 ? mode : team.selector) });
    assert.deepEqual(result.commands.filter(order => order.team === 1), reference.commands);
    assert.deepEqual(result.state.teams[1], reference.state.teams[1]);
    assert.deepEqual(result.state.actors["actor-1:0:1"], reference.state.actors["actor-1:0:1"]);
    assert.equal(result.state.teams[2].decisions, 1);
    assert.equal(result.state.version, 1);
    assert.equal(config.strategy, "source-objectives-v1");
  }
});

test("browser AI TRO HUMAN15 original aimsg actions reach strategy through the session projection", async () => {
  const blocks = parseTriggerScript(readFileSync(new URL("../../raw_cd/DC/SCENARIO/HUMAN/HUMAN15.TRO", import.meta.url), "utf8"));
  const original = blocks.find(block => block.id === 20)!;
  const actions = original.actions.filter(action => action.name === "aimsg");
  const originalScenario = parseScenario(readFileSync(new URL("../../raw_cd/DC/SCENARIO/HUMAN/HUMAN02.SCN", import.meta.url), "utf8"));
  const source = { ...originalScenario, placementRows: [], teams: originalScenario.teams.map(team => ({ ...team,
    ai: scenario.teams[team.index].ai, allies: scenario.teams[team.index].allies,
    coordinateRows: [[0, 0], [0, 0]] as const })) };
  const session = new CampaignSession({ runtimeProfile: "browser-adapted", sessionId: "original-weight-control",
    source, browserAi: createBrowserAiSelectorConfiguration(source),
    units: parseUnitStats(readFileSync(new URL("../../raw_cd/DC/GAMESTAT/GAMESTAT.TXT", import.meta.url), "utf8"))
      .filter(record => record.index === 0),
    weapons: parseWeaponStats(readFileSync(new URL("../../raw_cd/DC/GAMESTAT/WEAPSTAT.TXT", import.meta.url), "utf8")),
    triggers: [{ ...original, actions }], messages: [], map: { width: 16, height: 8 },
    pathGrid: new Uint8Array(128).fill(1), tags: new Uint8Array(128), commanders: [{ team: 0, unitType: 0, sprite: "TRSC" }],
    directionBits: Array.from({ length: 64 }, () => [0, 0] as const), fixedStepMilliseconds: 16, orientationSteps: 1 });
  for (let tick = 1; tick <= 16; tick++) {
    const result = session.step({ clockMilliseconds: tick * 16 });
    assert.ok(result.ok, JSON.stringify(result));
  }
  const projected = session.adaptedTroProjection!;
  assert.deepEqual(projected.state.aiGroupWeights[1], { 1: 4, 2: 4, 3: 8, 4: 1 });
  assert.deepEqual(projected.state.events.map(event => event.sourceAction), [...actions].reverse());
  assert.equal(projected.state.aiGroupWeights[2], undefined, "mode zero has no weight callback");
  const config = await configuration();
  const decide = (withProjection: boolean) => Array.from({ length: 64 }, (_, seed) => computeBrowserCampaignAi(config,
    initializeBrowserCampaignAi(config, seed), { ...observation(), visibleIdsByTeam: { 1: [2] },
      ...(withProjection ? { adaptedTroProjection: projected } : {}) }).commands.length).reduce((sum, count) => sum + count, 0);
  assert.equal(decide(false), 64);
  assert.ok(decide(true) > 0 && decide(true) < 64);
  assert.deepEqual(CampaignSession.restore(session.checkpoint()).adaptedTroProjection, projected);
});

test("browser AI TRO shared observers are team-scoped and do not grant control", async () => {
  const config = await configuration(), initial = initializeBrowserCampaignAi(config), current = observation();
  const projected = projection();
  const shared = { ...projected, state: { ...projected.state, sharedVision: projected.state.sharedVision.map((row, team) =>
    row.map((flag, other) => team === 1 && other === 2 || team === 2 && other === 1 ? 1 : flag)) } };
  const observed = { ...current, actors: [...current.actors, { ...current.actors[1], key: "ally-observer",
    simulationId: 3, rawSlot: 154, team: 2 }], snapshot: { ...current.snapshot, entityCount: 3,
    units: [...current.snapshot.units, { ...current.snapshot.units[1], id: 3, team: 2 }] } };
  const before = computeBrowserCampaignAi(config, initial, { ...observed, adaptedTroProjection: projected });
  assert.equal(before.commands[0].command.type, "move");
  const after = computeBrowserCampaignAi(config, initial, { ...observed, adaptedTroProjection: shared });
  assert.deepEqual(after.commands.map(order => order.command), [{ type: "attack", unitIds: [1], targetId: 2 }]);
  const hidden = computeBrowserCampaignAi(config, initial, { ...observed, adaptedTroProjection: shared,
    visibleIdsByTeam: { 0: [2], 1: [] } });
  assert.equal(hidden.commands[0].command.type, "move", "player fog cannot supply enemy team visibility");
});

test("browser AI TRO all four demand channels gate the corresponding human and alien types", async () => {
  for (const [channelIndex, category] of [0, 2, 3, 4].entries()) for (const raceOffset of [0, 8]) {
    const unitType = category + raceOffset;
    const config = await createBrowserCampaignAiConfiguration({ scenario, units: [{ ...unit, index: unitType }],
      weapons: [weapon], dependencies: [], pathGrid: new NavigationGrid(16, 8) });
    const current = observation(), projected = projection();
    const input = { ...current, actors: current.actors.map(actor => ({ ...actor, unitType })), visibleIdsByTeam: { 1: [2] } };
    assert.equal(computeBrowserCampaignAi(config, initializeBrowserCampaignAi(config), input).commands.length, 1);
    const result = computeBrowserCampaignAi(config, initializeBrowserCampaignAi(config), { ...input,
      adaptedTroProjection: { ...projected, state: { ...projected.state, aiGroupWeights: { 1: { [channelIndex + 1]: 0 } } } } });
    assert.deepEqual(result.commands, [], `channel ${channelIndex + 1}, type ${unitType}`);
  }
});

test("browser AI emits actual owned movement, visible attack, and nothing for selectors 0/4", async () => {
  const config = await configuration(), state = initializeBrowserCampaignAi(config);
  const hidden = computeBrowserCampaignAi(config, state, observation());
  assert.equal(hidden.commands.length, 1);
  assert.equal(hidden.commands[0].command.type, "move");
  assert.ok(hidden.commands[0].route.length > 1);
  const seen = computeBrowserCampaignAi(config, state, { ...observation(), visibleIdsByTeam: { 1: [2] } });
  assert.deepEqual(seen.commands[0].command, { type: "attack", unitIds: [1], targetId: 2 });
  for (const selector of [0, 4]) assert.equal(computeBrowserCampaignAi(config, state, { ...observation(),
    selectors: Array(8).fill(selector) }).commands.length, 0);
  assert.deepEqual(state, initializeBrowserCampaignAi(config));
});

test("browser AI checkpoints survive fresh factories and reject mismatched sources atomically", async () => {
  const config = await configuration(), initial = initializeBrowserCampaignAi(config);
  const result = computeBrowserCampaignAi(config, initial, observation());
  const fresh = await configuration();
  const saved = restoreBrowserCampaignAi(fresh, JSON.parse(JSON.stringify(result.state)));
  assert.deepEqual(computeBrowserCampaignAi(fresh, saved, observation(20)),
    computeBrowserCampaignAi(config, result.state, observation(20)));
  assert.equal(computeBrowserCampaignAi(config, result.state, observation()).commands.length, 0);
  assert.throws(() => restoreBrowserCampaignAi(config, { ...saved, fingerprint: "wrong" }), /fingerprint/);
  assert.throws(() => restoreBrowserCampaignAi(config, { ...saved, nextDecisionTick: 0 }), /checkpoint/);
  const stale = { ...observation(20), nativeBindings: [{ key: "actor-1", slot: 152, generation: 1, simulationId: 1 }] };
  assert.throws(() => computeBrowserCampaignAi(config, saved, stale), /Stale/);
  assert.deepEqual(initial, initializeBrowserCampaignAi(config));
  const changed = await createBrowserCampaignAiConfiguration({ scenario, units: [unit], weapons: [{ ...weapon, damage: 101 }],
    dependencies: [], pathGrid: new NavigationGrid(16, 8) });
  assert.throws(() => restoreBrowserCampaignAi(changed, saved), /fingerprint/);
});

test("browser AI respects directed allies, dead actors and per-team hidden targets", async () => {
  const config = await configuration(), initial = initializeBrowserCampaignAi(config);
  const current = observation();
  const hidden = { ...current, visibleIdsByTeam: { 1: [] } };
  const movedHidden = { ...hidden, snapshot: { ...hidden.snapshot, units: hidden.snapshot.units.map(actor =>
    actor.id === 2 ? { ...actor, cellX: 5, cellY: 3 } : actor) } };
  assert.deepEqual(computeBrowserCampaignAi(config, initial, hidden), computeBrowserCampaignAi(config, initial, movedHidden));
  const dead = { ...current, snapshot: { ...current.snapshot, units: current.snapshot.units.map(actor =>
    actor.id === 1 ? { ...actor, health: 0 } : actor) } };
  assert.equal(computeBrowserCampaignAi(config, initial, dead).commands.length, 0);
  const alliedScenario = { ...scenario, teams: scenario.teams.map(team => team.index === 1 ? {
    ...team, allies: team.allies.map((flag, index) => index === 0 ? 1 : flag) } : team) };
  const allied = await createBrowserCampaignAiConfiguration({ scenario: alliedScenario, units: [unit], weapons: [weapon],
    dependencies: [], pathGrid: new NavigationGrid(16, 8) });
  assert.equal(computeBrowserCampaignAi(allied, initializeBrowserCampaignAi(allied), {
    ...current, visibleIdsByTeam: { 1: [2] } }).commands.length, 0);
  const reverse = await createBrowserCampaignAiConfiguration({ scenario: { ...scenario, teams: scenario.teams.map(team =>
    team.index === 0 ? { ...team, allies: team.allies.map((flag, index) => index === 1 ? 1 : flag) } : team) },
    units: [unit], weapons: [weapon], dependencies: [], pathGrid: new NavigationGrid(16, 8) });
  assert.equal(computeBrowserCampaignAi(reverse, initializeBrowserCampaignAi(reverse), {
    ...current, visibleIdsByTeam: { 1: [2] } }).commands[0].command.type, "attack");
});

test("browser AI geometric vision uses each team's source day/night range and terrain", async () => {
  const current = observation(), close = { ...current, snapshot: { ...current.snapshot,
    units: current.snapshot.units.map(actor => actor.id === 2 ? { ...actor, cellX: 6 } : actor) } };
  const config = await configuration();
  assert.equal(computeBrowserCampaignAi(config, initializeBrowserCampaignAi(config), close).commands[0].command.type, "attack");
  assert.equal(computeBrowserCampaignAi(config, initializeBrowserCampaignAi(config), { ...close,
    snapshot: { ...close.snapshot, timeOfDay: "night" } }).commands[0].command.type, "move");
  const grid = new NavigationGrid(16, 8);
  grid.costs[grid.index(4, 3)] = 0;
  const occluded = await createBrowserCampaignAiConfiguration({ scenario, units: [unit], weapons: [weapon], dependencies: [], pathGrid: grid });
  assert.equal(computeBrowserCampaignAi(occluded, initializeBrowserCampaignAi(occluded), close).commands[0].command.type, "move");
});

test("browser AI commands execute movement and damage in the actual simulation", async () => {
  const config = await configuration();
  const simulation = new DeterministicSimulation(new NavigationGrid(16, 8));
  simulation.addUnit({ faction: "alien", team: 1, cell: { x: 2, y: 3 }, maxHealth: 800,
    speedSubcellsPerTick: 40, weapon: { damage: 25, rangeCells: 4, cooldownTicks: 5 } });
  simulation.addUnit({ faction: "human", team: 0, cell: { x: 12, y: 3 }, maxHealth: 800,
    speedSubcellsPerTick: 40 });
  let state = initializeBrowserCampaignAi(config), moves = 0, attacks = 0, progressed = false;
  for (let tick = 0; tick < 220; tick++) {
    const result = computeBrowserCampaignAi(config, state, { actors: observation().actors, snapshot: simulation.snapshot });
    state = result.state;
    for (const order of result.commands) {
      if (order.command.type === "move") moves++;
      if (order.command.type === "attack") attacks++;
      simulation.queue(order.command);
    }
    simulation.advance();
    progressed ||= simulation.snapshot.units[0].cellX > 2;
  }
  assert.ok(moves > 0 && attacks > 0 && progressed);
  assert.ok(simulation.snapshot.units.find(actor => actor.id === 2)!.health < 800);
});

test("browser AI static footprint: actual blocked-base approach progresses and attacks when visible", async () => {
  const config = await configuration();
  const simulation = new DeterministicSimulation(new NavigationGrid(16, 8));
  simulation.addUnit({ faction: "alien", team: 1, cell: { x: 2, y: 3 }, maxHealth: 800,
    speedSubcellsPerTick: 40, weapon: { damage: 25, rangeCells: 4, cooldownTicks: 5 } });
  simulation.addStaticTarget({ faction: "human", team: 0, cell: { x: 12, y: 3 }, maxHealth: 800,
    footprint: Array.from({ length: 9 }, (_, index) => ({ x: 11 + index % 3, y: 2 + Math.floor(index / 3) })) });
  const staticObstacles = { 1: simulation.checkpoint().staticTargets.flatMap(target => target.footprint.map(index => simulation.grid.point(index))) };
  let state = initializeBrowserCampaignAi(config), moves = 0, attacks = 0;
  for (let tick = 0; tick < 220; tick++) {
    const result = computeBrowserCampaignAi(config, state, { actors: observation().actors,
      snapshot: simulation.snapshot, staticObstacles,
      visibleIdsByTeam: { 1: tick < 120 ? [] : [2] } });
    state = result.state;
    for (const order of result.commands) {
      if (order.command.type === "move") {
        moves++;
        assert.ok(simulation.grid.isPassable(order.command.target.x, order.command.target.y));
        assert.ok(order.route.every(cell => simulation.grid.isPassable(cell.x, cell.y)));
      }
      if (order.command.type === "attack") attacks++;
      simulation.queue(order.command);
    }
    simulation.advance();
    if (tick === 119) {
      assert.ok(simulation.snapshot.units[0].cellX > 2);
      assert.equal(simulation.snapshot.units[0].cellY, 3);
      assert.equal(moves, 1, "no retry loop at tick 100");
    }
  }
  assert.ok(attacks > 0);
  assert.ok(simulation.snapshot.staticTargets[0].health < 800);
});

test("browser AI static footprints: actual blocked base approach moves by tick 120 and attacks when visible", async () => {
  const config = await configuration();
  const simulation = new DeterministicSimulation(new NavigationGrid(16, 8));
  simulation.addUnit({ faction: "alien", team: 1, cell: { x: 2, y: 3 }, maxHealth: 800,
    speedSubcellsPerTick: 40, weapon: { damage: 25, rangeCells: 4, cooldownTicks: 5 } });
  const footprint = Array.from({ length: 25 }, (_, index) => ({ x: 10 + index % 5, y: 1 + Math.floor(index / 5) }));
  simulation.addStaticTarget({ faction: "human", team: 0, cell: { x: 12, y: 3 }, maxHealth: 800, footprint });
  let state = initializeBrowserCampaignAi(config);
  const moves: number[] = [];
  let attacks = 0;
  for (let tick = 0; tick < 220; tick++) {
    const current: BrowserCampaignAiObservation = { actors: observation().actors, snapshot: simulation.snapshot,
      visibleIdsByTeam: { 1: tick < 120 ? [] : [2] },
      staticObstacles: { 1: simulation.checkpoint().staticTargets.filter(target => target.health > 0)
        .flatMap(target => target.footprint.map(index => simulation.grid.point(index))) } };
    const result = computeBrowserCampaignAi(config, state, current);
    state = result.state;
    for (const order of result.commands) {
      if (order.command.type === "move") {
        moves.push(tick);
        assert.ok(simulation.grid.isPassable(order.command.target.x, order.command.target.y));
        assert.ok(order.route.every(cell => simulation.grid.isPassable(cell.x, cell.y)));
        assert.deepEqual(order.command.target, { x: 9, y: 3 });
      }
      if (order.command.type === "attack") attacks++;
      simulation.queue(order.command);
    }
    simulation.advance();
    if (tick === 119) assert.ok(simulation.snapshot.units[0].cellX > 2, "must not idle at origin for 120 ticks");
  }
  assert.deepEqual(moves, [0], "no repeated unreachable-center orders at tick 100");
  assert.ok(attacks > 0);
  assert.ok(simulation.snapshot.staticTargets[0].health < 800);
});

test("browser AI static footprints: team-scoped cells ignore hidden mobile positions and directed allies", async () => {
  const config = await configuration(), initial = initializeBrowserCampaignAi(config);
  const wall = Array.from({ length: 7 }, (_, row) => ({ x: 7, y: row + 1 }));
  const base = Array.from({ length: 9 }, (_, index) => ({ x: 11 + index % 3, y: 2 + Math.floor(index / 3) }));
  const current = { ...observation(), visibleIdsByTeam: { 1: [] }, staticObstacles: { 1: [...wall, ...base] } };
  const before = structuredClone(current);
  const result = computeBrowserCampaignAi(config, initial, current);
  assert.equal(result.commands[0].command.type, "move");
  assert.ok(result.commands[0].route.some(cell => cell.x === 7 && cell.y === 0));
  assert.ok(result.commands[0].route.every(cell => !current.staticObstacles[1].some(blocked =>
    blocked.x === cell.x && blocked.y === cell.y)));
  for (const visibleIdsByTeam of [{ 1: [] }, undefined]) {
    const reference = computeBrowserCampaignAi(config, initial, { ...current, visibleIdsByTeam });
    for (const cell of [{ x: 8, y: 3 }, { x: 15, y: 7 }, { x: 7, y: 0 }]) {
      const changed = { ...current, visibleIdsByTeam, snapshot: { ...current.snapshot,
        units: current.snapshot.units.map(actor => actor.id === 2 ? { ...actor, cellX: cell.x, cellY: cell.y,
          xSubcells: cell.x * 256, ySubcells: cell.y * 256 } : actor) } };
      assert.deepEqual(computeBrowserCampaignAi(config, initial, changed), reference);
    }
  }
  assert.deepEqual(computeBrowserCampaignAi(config, initial, { ...current, staticObstacles: { 0: wall } }),
    computeBrowserCampaignAi(config, initial, { ...current, staticObstacles: undefined }));
  const alliedActor = { ...current.actors[1], team: 2 };
  const allied = { ...current, actors: [current.actors[0], alliedActor], snapshot: { ...current.snapshot,
    units: current.snapshot.units.map(actor => actor.id === 2 ? { ...actor, team: 2, cellX: 3 } : actor) },
    visibleIdsByTeam: { 1: [2] } };
  assert.deepEqual(computeBrowserCampaignAi(config, initial, allied), result);
  assert.deepEqual(current, before);
});

test("browser AI static footprints: destroyed observations clear only dynamic cells and replay with stable config", async () => {
  const grid = new NavigationGrid(16, 8);
  grid.costs[grid.index(6, 3)] = 0;
  const inputs = { scenario, units: [unit], weapons: [weapon], dependencies: [], pathGrid: grid };
  const config = await createBrowserCampaignAiConfiguration(inputs);
  const originalCosts = [...grid.costs];
  const simulation = new DeterministicSimulation(new NavigationGrid(16, 8));
  simulation.addUnit({ faction: "alien", team: 1, cell: { x: 2, y: 3 }, maxHealth: 800,
    weapon: { damage: 800, rangeCells: 16, cooldownTicks: 1 } });
  simulation.addStaticTarget({ faction: "human", team: 0, cell: { x: 12, y: 3 }, maxHealth: 800,
    footprint: [{ x: 12, y: 3 }] });
  const observe = (): BrowserCampaignAiObservation => ({ actors: observation().actors, snapshot: simulation.snapshot,
    visibleIdsByTeam: { 1: [] }, staticObstacles: { 1: simulation.checkpoint().staticTargets
      .filter(target => target.health > 0).flatMap(target => target.footprint.map(index => simulation.grid.point(index))) } });
  const first = computeBrowserCampaignAi(config, initializeBrowserCampaignAi(config), observe());
  assert.notDeepEqual(first.commands[0].command, { type: "move", unitIds: [1], target: { x: 12, y: 3 } });
  simulation.queue({ type: "attack", unitIds: [1], targetId: 2 });
  for (let tick = 0; tick < 20; tick++) simulation.advance();
  const cleared = observe();
  assert.deepEqual(cleared.staticObstacles, { 1: [] });
  assert.ok(simulation.grid.isPassable(12, 3));
  const result = computeBrowserCampaignAi(config, first.state, cleared);
  assert.deepEqual(result.commands[0].command, { type: "move", unitIds: [1], target: { x: 12, y: 3 } });
  assert.ok(result.commands[0].route.every(cell => cell.x !== 6 || cell.y !== 3));
  const fresh = await createBrowserCampaignAiConfiguration(inputs);
  assert.equal(fresh.fingerprint, config.fingerprint);
  assert.deepEqual(computeBrowserCampaignAi(fresh, restoreBrowserCampaignAi(fresh, JSON.parse(JSON.stringify(first.state))), cleared), result);
  assert.deepEqual([...grid.costs], originalCosts);
});

test("browser AI static footprints: bounded edge goals, sealed routes and blocked origins", async () => {
  const edgeScenario = { ...scenario, teams: scenario.teams.map(team => team.index === 0 ? {
    ...team, coordinateRows: [[0, 0], [15, 0]] as const } : team) };
  const config = await createBrowserCampaignAiConfiguration({ scenario: edgeScenario, units: [unit], weapons: [weapon],
    dependencies: [], pathGrid: new NavigationGrid(16, 8) });
  const initial = initializeBrowserCampaignAi(config);
  const footprint = Array.from({ length: 15 }, (_, index) => ({ x: 13 + index % 3, y: Math.floor(index / 3) }));
  const current = { ...observation(), visibleIdsByTeam: { 1: [] }, staticObstacles: { 1: footprint } };
  const result = computeBrowserCampaignAi(config, initial, current);
  assert.deepEqual(result.commands[0].command, { type: "move", unitIds: [1], target: { x: 12, y: 0 } });
  assert.ok(result.commands[0].route.every(cell => cell.x >= 0 && cell.x < 16 && cell.y >= 0 && cell.y < 8));
  const wall = Array.from({ length: 8 }, (_, row) => ({ x: 7, y: row }));
  assert.equal(computeBrowserCampaignAi(config, initial, { ...current,
    staticObstacles: { 1: [...footprint, ...wall] } }).commands.length, 0);
  assert.equal(computeBrowserCampaignAi(config, initial, { ...current,
    staticObstacles: { 1: [...footprint, { x: 2, y: 3 }] } }).commands.length, 0);
  assert.throws(() => computeBrowserCampaignAi(config, initial, { ...current,
    staticObstacles: { 1: [{ x: 16, y: 0 }] } }), /out of bounds/);
  assert.deepEqual(initial, initializeBrowserCampaignAi(config));
});

test("browser AI deduplicates accepted orders and stops a lost visible target", async () => {
  const config = await configuration(), initial = initializeBrowserCampaignAi(config);
  const first = computeBrowserCampaignAi(config, initial, { ...observation(), visibleIdsByTeam: { 1: [2] } });
  const active = { ...observation(20), visibleIdsByTeam: { 1: [2] }, snapshot: { ...observation(20).snapshot,
    units: observation(20).snapshot.units.map(actor => actor.id === 1 ? { ...actor, activity: "attack" as const, targetId: 2 } : actor) } };
  const continuing = computeBrowserCampaignAi(config, first.state, active);
  assert.equal(continuing.commands.length, 0);
  const lost = computeBrowserCampaignAi(config, continuing.state, { ...active,
    snapshot: { ...active.snapshot, tick: 40 }, visibleIdsByTeam: { 1: [] } });
  assert.deepEqual(lost.commands[0].command, { type: "stop", unitIds: [1] });
  assert.equal(computeBrowserCampaignAi(config, lost.state, { ...active, snapshot: { ...active.snapshot, tick: 40 } }).commands.length, 0);
  assert.deepEqual(computeBrowserCampaignAi(config, initial, { ...observation(), visibleIdsByTeam: { 1: [2] } }), first);
});

test("browser AI discovers delivered owned actors through bindings without spawning or resetting team state", async () => {
  const config = await configuration();
  let state = initializeBrowserCampaignAi(config);
  for (let tick = 0; tick < 1100; tick++) state = computeBrowserCampaignAi(config, state, {
    ...observation(tick), actors: [] }).state;
  assert.equal(Object.keys(state.actors).length, 0);
  const before = structuredClone(state), current = observation(1100);
  const delivered = { ...current, actors: current.actors.map(actor => ({ ...actor, simulationId: null })),
    nativeBindings: current.actors.map(actor => ({ key: actor.key, slot: actor.rawSlot!, generation: actor.generation,
      simulationId: actor.simulationId! })), visibleIdsByTeam: { 1: [2] } };
  const result = computeBrowserCampaignAi(config, state, delivered);
  assert.deepEqual(result.commands[0].command, { type: "attack", unitIds: [1], targetId: 2 });
  assert.ok(result.state.teams[1].decisions > state.teams[1].decisions);
  assert.deepEqual(state, before);
  const reused = { ...observation(1120), actors: current.actors.map(actor => ({ ...actor, generation: 1 })),
    visibleIdsByTeam: { 1: [2] } };
  const replacement = computeBrowserCampaignAi(config, result.state, reused);
  assert.equal(replacement.commands.length, 1);
  assert.notEqual(replacement.commands[0].id, result.commands[0].id);
  assert.ok(Object.keys(replacement.state.actors).every(key => key.includes(":1:")));
});

test("browser AI rejects unreachable objective routes and prioritizes visible home defense", async () => {
  const grid = new NavigationGrid(16, 8);
  for (let row = 0; row < grid.height; row++) grid.costs[grid.index(7, row)] = 0;
  const config = await createBrowserCampaignAiConfiguration({ scenario, units: [unit], weapons: [weapon], dependencies: [], pathGrid: grid });
  assert.equal(computeBrowserCampaignAi(config, initializeBrowserCampaignAi(config), { ...observation(),
    visibleIdsByTeam: { 1: [] } }).commands.length, 0);
  const defended = await createBrowserCampaignAiConfiguration({ scenario: { ...scenario, teams: scenario.teams.map(team =>
    team.index === 1 ? { ...team, coordinateRows: [[0, 0], [2, 3]] as const } : team) }, units: [unit], weapons: [weapon],
    dependencies: [], pathGrid: new NavigationGrid(16, 8) });
  const result = computeBrowserCampaignAi(defended, initializeBrowserCampaignAi(defended), {
    ...observation(), visibleIdsByTeam: { 1: [2] } });
  assert.equal(result.commands[0].stance, "defend");
});

test("browser AI local modes: HUMAN12 original teams, source census, observed deliveries and JSON replay", async () => {
  const read = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url));
  const selectorTeams: string[] = [];
  for (const faction of ["HUMAN", "ALIEN"]) {
    const directory = new URL(`../../raw_cd/DC/SCENARIO/${faction}/`, import.meta.url);
    for (const file of readdirSync(directory).filter(file => file.endsWith(".SCN")).sort()) {
      const source = parseScenario(readFileSync(new URL(file, directory), "utf8"));
      for (const team of source.teams) if (team.ai === 1 || team.ai === 2) selectorTeams.push(`${file}:${team.index}:${team.ai}`);
    }
  }
  assert.deepEqual(selectorTeams, ["HUMAN12.SCN:4:1", "HUMAN12.SCN:6:1", "HUMAN12.SCN:7:1"]);
  const source = parseScenario(read("SCENARIO/HUMAN/HUMAN12.SCN").toString());
  const triggers = parseTriggerScript(read("SCENARIO/HUMAN/HUMAN12.TRO").toString());
  const units = parseUnitStats(read("GAMESTAT/GAMESTAT.TXT").toString());
  const weapons = parseWeaponStats(read("GAMESTAT/WEAPSTAT.TXT").toString());
  const dependencies = parseDependencies(read("GAMESTAT/DEPEND.TXT").toString());
  const map = parseMapBundle(read("SCENARIO/HUMAN/HUMAN12.MAP"), read("SCENARIO/HUMAN/HUMAN12.MTG"), read("SCENARIO/HUMAN/HUMAN12.PTH"));
  const placements = initializeCampaignPlacements({ runtimeProfile: "browser-adapted", sessionId: source.id, source, units, map,
    messages: [], resourceScales: "configured-startup" });
  assert.ok(placements.ok, JSON.stringify(placements.ok ? null : placements));
  if (!placements.ok) throw new Error("Original HUMAN12 placements unavailable");
  const localTeams = [4, 6, 7];
  assert.deepEqual(source.teams.map(team => team.ai), [0, 3, 3, 4, 1, 4, 1, 1]);
  assert.deepEqual(source.teams.filter(team => localTeams.includes(team.index)).map(team => [team.enabled, team.race, team.money]),
    [[0, 1, 0], [0, 1, 0], [0, 1, 0]], "original selectors are not permission to fabricate an army or commander");
  assert.deepEqual(source.teams.filter(team => localTeams.includes(team.index)).map(team => team.coordinateRows),
    [[[3, 38], [0, 0]], [[3, 40], [0, 0]], [[5, 40], [0, 0]]]);
  assert.equal(placements.value.entities.filter(actor => localTeams.includes(actor.team)).length, 0);
  assert.equal(triggers.flatMap(block => block.actions).filter(action => action.name.startsWith("reinforce")
    && localTeams.includes(Number(action.arguments[0]))).length, 0, "deliveries below are controlled observations, not original TRO spawns");
  const grid = new NavigationGrid(map.width, map.height, Uint16Array.from(createLegacyInfantryFamilyMask(map)));
  const inputs = { scenario: source, units, weapons, dependencies, pathGrid: grid };
  const before = structuredClone(inputs), config = await createBrowserCampaignAiConfiguration(inputs);
  const actors = placements.value.entities.map((actor, index) => ({ ...actor, simulationId: index + 1 }));
  const snapshots = actors.map(actor => ({ id: actor.simulationId, team: actor.team,
    faction: source.teams[actor.team]?.race === 1 ? "alien" as const : "human" as const,
    activity: "idle" as const, cellX: actor.tileX, cellY: actor.tileY, xSubcells: actor.tileX * 1024,
    ySubcells: actor.tileY * 1024, health: actor.health, maxHealth: actor.maxHealth, cargo: 0, cargoCapacity: 0, targetId: null }));
  const original: BrowserCampaignAiObservation = { actors, snapshot: { ...observation().snapshot, units: snapshots, entityCount: actors.length },
    visibleIdsByTeam: Object.fromEntries(source.teams.map(team => [team.index, []])) };
  const opening = computeBrowserCampaignAi(config, initializeBrowserCampaignAi(config, 17), original);
  assert.ok(opening.commands.every(order => order.team === 1 || order.team === 2), "original actors stay with their source owners");
  const delivered = localTeams.map((team, index) => ({ key: `controlled-H12-delivery-${team}`, generation: 0, rawSlot: 700 + index,
    simulationId: null, team, unitType: 8, health: units.find(unit => unit.index === 8)!.health }));
  const deliveredSnapshots = delivered.map((actor, index) => ({ ...snapshots[0], id: 1000 + index, team: actor.team,
    faction: "alien" as const, cellX: source.teams[actor.team].coordinateRows[0][0],
    cellY: source.teams[actor.team].coordinateRows[0][1], health: actor.health, maxHealth: actor.health }));
  const enemy = { ...actors.find(actor => actor.team === 0)!, key: "controlled-visible-intruder", rawSlot: 710, simulationId: 1010 };
  const enemySnapshot = { ...snapshots.find(actor => actor.team === 0)!, id: 1010, cellX: 4, cellY: 39 };
  const current: BrowserCampaignAiObservation = { ...original, actors: [...actors, ...delivered, enemy],
    nativeBindings: delivered.map((actor, index) => ({ key: actor.key, generation: actor.generation, slot: actor.rawSlot, simulationId: 1000 + index })),
    snapshot: { ...original.snapshot, tick: 20, units: [...snapshots, ...deliveredSnapshots, enemySnapshot], entityCount: actors.length + 4 },
    visibleIdsByTeam: { ...original.visibleIdsByTeam, 4: [1010], 6: [], 7: [1010] } };
  const seen = computeBrowserCampaignAi(config, opening.state, current);
  assert.deepEqual(computeBrowserCampaignAi(config, opening.state, current), seen);
  assert.deepEqual(computeBrowserCampaignAi(config, seen.state, current).commands, []);
  const allSeen = computeBrowserCampaignAi(config, opening.state, { ...current,
    visibleIdsByTeam: { ...current.visibleIdsByTeam, 6: [1010] } });
  assert.deepEqual(allSeen.commands.filter(order => localTeams.includes(order.team)).map(order => order.team), localTeams,
    "each original selector-1 team defends when it actually has an observed actor and local visible threat");
  const localOrders = seen.commands.filter(order => localTeams.includes(order.team));
  assert.deepEqual(localOrders.map(order => [order.team, order.stance, order.command]), [
    [4, "defend", { type: "attack", unitIds: [1000], targetId: 1010 }],
    [7, "defend", { type: "attack", unitIds: [1002], targetId: 1010 }],
  ]);
  for (const actor of delivered) {
    const group = seen.state.actors[`${actor.key}:0:${1000 + localTeams.indexOf(actor.team)}`].group;
    assert.ok(source.teams[actor.team].aiSlots.includes(group), "group label must come from the source AISlots row");
    assert.equal(seen.state.teams[actor.team].decisions, 2);
  }
  const fresh = await createBrowserCampaignAiConfiguration(inputs);
  assert.deepEqual(computeBrowserCampaignAi(fresh, restoreBrowserCampaignAi(fresh, JSON.parse(JSON.stringify(opening.state))), current), seen);
  assert.deepEqual(structuredClone(inputs), before);
  assert.deepEqual(placements.value.source, source);
});

for (const faction of ["HUMAN", "ALIEN"]) test(`${faction}02 source armies: 1240 ticks, late activation and exact fresh-factory replay`, async () => {
  const read = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url));
  const mission = (extension: string) => read(`SCENARIO/${faction}/${faction}02.${extension}`);
  const source = parseScenario(mission("SCN").toString());
  const units = parseUnitStats(read("GAMESTAT/GAMESTAT.TXT").toString());
  const weapons = parseWeaponStats(read("GAMESTAT/WEAPSTAT.TXT").toString());
  const dependencies = parseDependencies(read("GAMESTAT/DEPEND.TXT").toString());
  const map = parseMapBundle(mission("MAP"), mission("MTG"), mission("PTH"));
  const placements = initializeCampaignPlacements({ sessionId: source.id, source, units, map,
    messages: [], resourceScales: "configured-startup" });
  assert.equal(placements.ok, true);
  if (!placements.ok) throw new Error("Original placements unavailable");
  const grid = new NavigationGrid(map.width, map.height, Uint16Array.from(createLegacyInfantryFamilyMask(map)));
  const inputs = { scenario: source, units, weapons, dependencies, pathGrid: grid };
  const config = await createBrowserCampaignAiConfiguration(inputs);
  const original = structuredClone(inputs);
  const world = placements.value;
  const actors = world.entities.map((actor, index) => ({ ...actor, simulationId: index + 1 }));
  const snapshots = actors.map(actor => ({ id: actor.simulationId, team: actor.team,
    faction: source.teams[actor.team]?.race === 1 ? "alien" as const : "human" as const,
    activity: "idle" as const, cellX: actor.tileX, cellY: actor.tileY, xSubcells: actor.tileX * 256,
    ySubcells: actor.tileY * 256, health: actor.health, maxHealth: actor.maxHealth, cargo: 0, cargoCapacity: 0, targetId: null }));
  let state = initializeBrowserCampaignAi(config), checkpoint = state;
  const commands: unknown[] = [], suffix: unknown[] = [];
  const observe = (tick: number): BrowserCampaignAiObservation => ({ actors,
    snapshot: { ...observation(tick).snapshot, units: snapshots, entityCount: actors.length },
    selectors: source.teams.map(team => tick >= 1000 && team.ai === 4 ? 3 : team.ai), visibleIdsByTeam: {} });
  for (let tick = 0; tick < 1240; tick++) {
    const result = computeBrowserCampaignAi(config, state, observe(tick));
    state = result.state;
    commands.push(...result.commands);
    if (tick === 999) checkpoint = JSON.parse(JSON.stringify(state));
    if (tick >= 1000) suffix.push(...result.commands);
    if (faction === "ALIEN" && tick < 1000) assert.equal(result.commands.length, 0);
    for (const order of result.commands) {
      const owner = actors.find(actor => actor.key === order.actorKey)!;
      assert.equal(order.team, owner.team);
      assert.ok(owner.health > 0);
      assert.equal(observe(tick).selectors![owner.team], 3);
    }
  }
  assert.ok(suffix.length > 0, "original living armies must issue real orders after activation");
  assert.ok(commands.length > 0);
  const fresh = await createBrowserCampaignAiConfiguration(inputs);
  let restored = restoreBrowserCampaignAi(fresh, checkpoint);
  const replay: unknown[] = [];
  for (let tick = 1000; tick < 1240; tick++) {
    const result = computeBrowserCampaignAi(fresh, restored, observe(tick));
    restored = result.state; replay.push(...result.commands);
  }
  assert.deepEqual(restored, state);
  assert.deepEqual(replay, suffix);
  assert.deepEqual(structuredClone(inputs), original);
  assert.deepEqual(world.source, source);
  assert.ok(source.teams.every(team => team.money === 0));
});
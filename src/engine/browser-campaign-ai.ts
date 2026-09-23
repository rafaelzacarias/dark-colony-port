import type { ScenarioDefinition } from "../../tools/extractors/data/scenario";
import type { DependencyRecord } from "../../tools/extractors/data/tables";
import type { AdaptedTroProjection, CampaignEntity } from "./campaign-world";
import { NavigationGrid, type GridPoint } from "./grid";
import type { LegacyUnitStat, LegacyWeaponStat } from "./legacy-balance";
import { findPath } from "./pathfinding";
import type { SimulationCommand, SimulationSnapshot } from "./simulation";

export interface BrowserCampaignAiConfiguration {
  readonly profile: "browser-adapted";
  readonly strategy: "source-objectives-v1";
  readonly fingerprint: string;
  readonly ticksPerSecond: 20;
  readonly decisionPeriodTicks: 20;
  readonly sourceId: string;
  readonly teams: readonly {
    readonly team: number;
    readonly selector: number;
    readonly allies: readonly number[];
    readonly aiSlots: readonly number[];
    readonly home: GridPoint | null;
    readonly objectives: readonly GridPoint[];
  }[];
}

export interface BrowserCampaignAiOrder {
  readonly id: string;
  readonly team: number;
  readonly actorKey: string;
  readonly command: SimulationCommand;
  readonly stance: "attack" | "defend" | "advance";
  readonly route: readonly GridPoint[];
}

export interface BrowserCampaignAiState {
  readonly version: 1;
  readonly fingerprint: string;
  readonly lastTick: number;
  readonly nextDecisionTick: number;
  readonly teams: readonly { readonly team: number; readonly rng: number; readonly decisions: number }[];
  readonly actors: Readonly<Record<string, {
    readonly objective: number;
    readonly group: number;
    readonly signature: string;
    readonly issuedTick: number;
    readonly position: GridPoint;
    readonly stalled: number;
  }>>;
}

export interface BrowserCampaignAiObservation {
  readonly snapshot: SimulationSnapshot;
  readonly actors: readonly Pick<CampaignEntity,
    "key" | "generation" | "rawSlot" | "simulationId" | "team" | "unitType" | "health">[];
  readonly nativeBindings?: readonly {
    readonly key: string; readonly generation: number; readonly slot: number; readonly simulationId: number;
  }[];
  readonly selectors?: readonly number[];
  readonly adaptedTroProjection?: AdaptedTroProjection;
  readonly visibleIdsByTeam?: Readonly<Record<number, readonly number[]>>;
  readonly staticObstacles?: Readonly<Record<number, readonly GridPoint[]>>;
  readonly targetCanDamage?: (attackerId: number, targetId: number) => boolean;
}

interface SourceData {
  readonly grid: NavigationGrid;
  readonly airGrid: NavigationGrid;
  readonly units: ReadonlyMap<number, LegacyUnitStat>;
  readonly weapons: ReadonlyMap<number, LegacyWeaponStat>;
  readonly rallies: readonly (GridPoint | null)[];
}

const configurations = new WeakMap<BrowserCampaignAiConfiguration, SourceData>();
const distance = (left: GridPoint, right: GridPoint) =>
  (left.x - right.x) ** 2 + (left.y - right.y) ** 2;
const pointOf = (actor: { cellX: number; cellY: number }): GridPoint => ({ x: actor.cellX, y: actor.cellY });
const nextRandom = (value: number) => {
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  return value >>> 0;
};

export async function createBrowserCampaignAiConfiguration(input: {
  readonly scenario: ScenarioDefinition;
  readonly units: readonly LegacyUnitStat[];
  readonly weapons: readonly LegacyWeaponStat[];
  readonly dependencies: readonly DependencyRecord[];
  readonly pathGrid: NavigationGrid;
}): Promise<BrowserCampaignAiConfiguration> {
  const scenario = structuredClone(input.scenario), units = structuredClone(input.units);
  const weapons = structuredClone(input.weapons), dependencies = structuredClone(input.dependencies);
  const grid = new NavigationGrid(input.pathGrid.width, input.pathGrid.height, input.pathGrid.costs);
  if (scenario.teams.length !== 8 || scenario.teams.some((team, index) => team.index !== index
    || team.allies.length !== 8 || !Number.isInteger(team.ai) || team.ai < 0 || team.ai > 4)) {
    throw new RangeError("Browser AI requires eight original indexed teams and alliance flags");
  }
  const sourcePoint = (row: readonly number[]) => row.length >= 2 && grid.contains(row[0], row[1])
    && (row[0] !== 0 || row[1] !== 0) ? { x: row[0], y: row[1] } : null;
  const teams = scenario.teams.map(team => {
    const home = sourcePoint(team.coordinateRows[1]);
    const objectives = scenario.teams.filter(other => other.index !== team.index
      && team.allies[other.index] === 0).flatMap(other => {
      const point = sourcePoint(other.coordinateRows[1]);
      return point ? [point] : [];
    });
    const rally = sourcePoint(team.coordinateRows[0]);
    if (rally) objectives.unshift(rally);
    return Object.freeze({ team: team.index, selector: team.ai, allies: Object.freeze([...team.allies]),
      aiSlots: Object.freeze([...team.aiSlots]), home: home && Object.freeze(home),
      objectives: Object.freeze(objectives.filter((point, index) =>
        objectives.findIndex(other => distance(point, other) === 0) === index).map(point => Object.freeze(point))) });
  });
  const canonical = JSON.stringify({ strategy: "source-objectives-v1", scenario, units, weapons, dependencies,
    width: grid.width, height: grid.height, costs: Array.from(grid.costs) });
  const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(canonical))), value => value.toString(16).padStart(2, "0")).join("");
  const configuration: BrowserCampaignAiConfiguration = Object.freeze({ profile: "browser-adapted",
    strategy: "source-objectives-v1", fingerprint, ticksPerSecond: 20, decisionPeriodTicks: 20,
    sourceId: scenario.id, teams: Object.freeze(teams) });
  configurations.set(configuration, { grid, airGrid: new NavigationGrid(grid.width, grid.height), units: new Map(units.map(unit => [unit.index, unit])),
    weapons: new Map(weapons.map(weapon => [weapon.id, weapon])),
    rallies: scenario.teams.map(team => sourcePoint(team.coordinateRows[0])) });
  return configuration;
}

export function initializeBrowserCampaignAi(configuration: BrowserCampaignAiConfiguration, seed = 1): BrowserCampaignAiState {
  if (!configurations.has(configuration) || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new RangeError("Browser AI requires its source configuration and a uint32 seed");
  return { version: 1, fingerprint: configuration.fingerprint, lastTick: -1, nextDecisionTick: 0,
    teams: configuration.teams.map(team => ({ team: team.team,
      rng: nextRandom((seed ^ Math.imul(team.team + 1, 0x9e3779b9)) >>> 0) || 1, decisions: 0 })), actors: {} };
}

export function restoreBrowserCampaignAi(configuration: BrowserCampaignAiConfiguration,
  saved: BrowserCampaignAiState): BrowserCampaignAiState {
  const source = configurations.get(configuration);
  if (!source || saved.version !== 1 || saved.fingerprint !== configuration.fingerprint
    || !Number.isSafeInteger(saved.lastTick) || saved.lastTick < -1
    || !Number.isSafeInteger(saved.nextDecisionTick) || saved.nextDecisionTick < 0
    || saved.nextDecisionTick <= saved.lastTick
    || saved.teams.length !== 8 || saved.teams.some((team, index) => team.team !== index
      || !Number.isInteger(team.rng) || team.rng <= 0 || team.rng > 0xffffffff
      || !Number.isSafeInteger(team.decisions) || team.decisions < 0)
    || Object.values(saved.actors).some(actor => !Number.isSafeInteger(actor.objective) || actor.objective < 0
      || !Number.isSafeInteger(actor.group) || typeof actor.signature !== "string"
      || !Number.isSafeInteger(actor.issuedTick) || actor.issuedTick < -100 || actor.issuedTick > saved.lastTick
      || !Number.isSafeInteger(actor.stalled) || actor.stalled < 0 || actor.stalled >= 5
      || !source.grid.contains(actor.position.x, actor.position.y)))
    throw new RangeError("Invalid browser AI checkpoint or source fingerprint");
  return structuredClone(saved);
}

function clearSight(grid: NavigationGrid, start: GridPoint, end: GridPoint): boolean {
  const steps = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
  for (let step = 1; step < steps; step++) {
    if (!grid.isPassable(Math.round(start.x + (end.x - start.x) * step / steps),
      Math.round(start.y + (end.y - start.y) * step / steps))) return false;
  }
  return true;
}

function approach(grid: NavigationGrid, start: GridPoint, destination: GridPoint,
  occupied: ReadonlySet<number>, staticCells: ReadonlySet<number>): readonly GridPoint[] | null {
  const goals = [destination];
  if (staticCells.has(grid.index(destination.x, destination.y))) {
    const pending = [destination], visited = new Set<number>([grid.index(destination.x, destination.y)]);
    for (let cursor = 0; cursor < pending.length; cursor++) {
      const point = pending[cursor];
      for (const [offsetX, offsetY] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const neighbor = { x: point.x + offsetX, y: point.y + offsetY };
        if (!grid.contains(neighbor.x, neighbor.y)) continue;
        const index = grid.index(neighbor.x, neighbor.y);
        if (visited.has(index)) continue;
        visited.add(index);
        if (staticCells.has(index)) pending.push(neighbor);
        else if (grid.isPassable(neighbor.x, neighbor.y)) goals.push(neighbor);
      }
    }
  }
  for (let radius = 1; radius <= 2; radius++) {
    for (let offsetY = -radius; offsetY <= radius; offsetY++) {
      for (let offsetX = -radius; offsetX <= radius; offsetX++) {
        if (Math.max(Math.abs(offsetX), Math.abs(offsetY)) === radius)
          goals.push({ x: destination.x + offsetX, y: destination.y + offsetY });
      }
    }
  }
  goals.sort((left, right) => distance(left, destination) - distance(right, destination)
    || distance(left, start) - distance(right, start) || left.y - right.y || left.x - right.x);
  const blockers = new Set(occupied);
  blockers.delete(grid.index(start.x, start.y));
  for (const goal of goals) {
    if (!grid.isPassable(goal.x, goal.y) || blockers.has(grid.index(goal.x, goal.y))) continue;
    const route = findPath(grid, start, goal, { blocked: blockers });
    if (route) return route;
  }
  return null;
}

export function computeBrowserCampaignAi(configuration: BrowserCampaignAiConfiguration,
  previous: BrowserCampaignAiState, observation: BrowserCampaignAiObservation): {
    state: BrowserCampaignAiState; commands: BrowserCampaignAiOrder[];
  } {
  const source = configurations.get(configuration), tick = observation.snapshot.tick;
  if (!source || previous.version !== 1 || previous.fingerprint !== configuration.fingerprint
    || !Number.isSafeInteger(tick) || tick < 0 || tick < previous.lastTick)
    throw new RangeError("Browser AI configuration/checkpoint/tick mismatch");
  if (previous.teams.length !== 8 || previous.teams.some((team, index) => team.team !== index
    || !Number.isInteger(team.rng) || team.rng <= 0 || team.rng > 0xffffffff
    || !Number.isSafeInteger(team.decisions) || team.decisions < 0)
    || !Number.isSafeInteger(previous.nextDecisionTick) || previous.nextDecisionTick < 0)
    throw new RangeError("Invalid browser AI checkpoint");
  const state = restoreBrowserCampaignAi(configuration, previous), commands: BrowserCampaignAiOrder[] = [];
  if (tick === previous.lastTick) return { state, commands };
  if (tick < previous.nextDecisionTick) return { state: { ...state, lastTick: tick }, commands };
  const selectors = observation.selectors ?? configuration.teams.map(team => team.selector);
  if (selectors.length !== 8 || selectors.some(selector => !Number.isInteger(selector) || selector < 0 || selector > 4))
    throw new RangeError("Browser AI requires eight current selectors");
  const snapshots = [...observation.snapshot.units, ...observation.snapshot.staticTargets];
  const mobileById = new Map(observation.snapshot.units.map(actor => [actor.id, actor]));
  const snapshotById = new Map(snapshots.map(actor => [actor.id, actor]));
  if (snapshotById.size !== snapshots.length) throw new RangeError("Duplicate simulation actor identity");
  const bindings = new Map((observation.nativeBindings ?? []).map(binding => [binding.key, binding]));
  const usedIds = new Set<number>(), usedKeys = new Set<string>();
  const actors = observation.actors.flatMap(actor => {
    if (usedKeys.has(actor.key)) throw new RangeError("Duplicate world actor identity");
    usedKeys.add(actor.key);
    const binding = bindings.get(actor.key);
    if (binding && (binding.generation !== actor.generation || binding.slot !== actor.rawSlot
      || actor.simulationId !== null && actor.simulationId !== binding.simulationId))
      throw new RangeError("Stale browser AI actor binding");
    const id = binding?.simulationId ?? actor.simulationId;
    if (id === null) return [];
    if (usedIds.has(id)) throw new RangeError("Duplicate browser AI simulation binding");
    usedIds.add(id);
    const current = snapshotById.get(id);
    if (!current || current.health <= 0 || actor.health <= 0 || "activity" in current && current.activity === "die") return [];
    if (current.team !== undefined && current.team !== actor.team) throw new RangeError("Browser AI team binding mismatch");
    if (!source.grid.contains(current.cellX, current.cellY)) throw new RangeError("Browser AI actor outside path grid");
    return [{ ...actor, id, current, position: pointOf(current), profile: source.units.get(actor.unitType),
      identity: `${actor.key}:${actor.generation}:${id}` }];
  }).sort((left, right) => (left.rawSlot ?? 800) - (right.rawSlot ?? 800) || left.id - right.id);
  const actorStates: Record<string, BrowserCampaignAiState["actors"][string]> = {};
  const teamStates = state.teams.map(team => ({ ...team }));
  for (const team of configuration.teams) {
    const selector = selectors[team.team];
    if (selector === 0 || selector === 4) {
      for (const actor of actors.filter(actor => actor.team === team.team)) {
        const old = state.actors[actor.identity];
        if (old) actorStates[actor.identity] = { ...old, signature: "" };
      }
      continue;
    }
    const teamState = teamStates[team.team];
    teamState.decisions++;
    const owned = actors.filter(actor => actor.team === team.team);
    const planningGrid = new NavigationGrid(source.grid.width, source.grid.height, source.grid.costs);
    const staticCells = new Set<number>();
    for (const cell of observation.staticObstacles?.[team.team] ?? []) {
      const index = planningGrid.index(cell.x, cell.y);
      staticCells.add(index);
      planningGrid.costs[index] = 0;
    }
    const suppliedVision = observation.visibleIdsByTeam?.[team.team];
    const visible = suppliedVision && new Set(suppliedVision);
    const alliances = observation.adaptedTroProjection?.teamAlliances[team.team]
      ?? observation.snapshot.teamAlliances?.[team.team] ?? team.allies;
    const observers = actors.filter(actor => actor.team === team.team
      || observation.adaptedTroProjection?.state.sharedVision[team.team]?.[actor.team] === 1);
    const anchor = team.home ?? source.rallies[team.team];
    const localObjectives = (selector === 1 ? [anchor] : [team.home, source.rallies[team.team]])
      .filter((point): point is GridPoint => point !== null)
      .filter((point, index, points) => points.findIndex(other => distance(point, other) === 0) === index);
    const objectives = selector !== 3 ? localObjectives : observation.adaptedTroProjection ? [source.rallies[team.team],
      ...configuration.teams.filter(other => other.team !== team.team && alliances[other.team] === 0)
        .map(other => other.home)].filter((point): point is GridPoint => point !== null)
      .filter((point, index, points) => points.findIndex(other => distance(point, other) === 0) === index)
      : team.objectives;
    const strategyWeights = selector === 3 ? observation.adaptedTroProjection?.state.aiGroupWeights[team.team] : undefined;
    const maximumWeight = Math.max(1, ...Object.values(strategyWeights ?? {}));
    const enemies = actors.filter(actor => actor.team >= 0 && actor.team < 8 && actor.team !== team.team
      && alliances[actor.team] === 0 && (visible ? visible.has(actor.id) : observers.some(observer => {
      const range = observation.snapshot.timeOfDay === "day" ? observer.profile?.observationDay : observer.profile?.observationNight;
      return range !== undefined && distance(observer.position, actor.position) <= range * range
        && clearSight(source.grid, observer.position, actor.position);
    })));
      const occupied = new Set([...owned, ...enemies].filter(actor => mobileById.get(actor.id)?.movementPlane !== "air")
        .map(actor => source.grid.index(actor.position.x, actor.position.y)));
      const airOccupied = new Set([...owned, ...enemies].filter(actor => mobileById.get(actor.id)?.movementPlane === "air")
        .map(actor => source.grid.index(actor.position.x, actor.position.y)));
    for (const actor of owned) {
        const current = mobileById.get(actor.id);
      const weapon = actor.profile?.weapons.map(id => source.weapons.get(id)).find(value => value && value.damage > 0);
        if (!weapon || !actor.profile || actor.profile.movementSpeed <= 0 || !current
          || current.resourceActor || [6, 14, 47, 48].includes(actor.unitType)) continue;
      let old = state.actors[actor.identity];
      if (!old) {
        teamState.rng = nextRandom(teamState.rng);
        old = { objective: 0, group: team.aiSlots[teamState.rng % Math.max(1, team.aiSlots.length)] ?? 0,
          signature: "", issuedTick: -100, position: actor.position, stalled: 0 };
      }
      const ownsAttack = current.targetId !== null && (current.activity === "attack" || current.activity === "move")
        && old.signature === JSON.stringify({ type: "attack", unitIds: [actor.id], targetId: current.targetId });
      if (selector !== 3 && (current.activity !== "idle" || current.targetId !== null) && !ownsAttack) {
        actorStates[actor.identity] = { ...old, signature: "", position: actor.position, stalled: 0 };
        continue;
      }
      const category = actor.unitType < 16 ? actor.unitType % 8 : -1;
      const channel = [0, 2, 3, 4].indexOf(category) + 1;
      const weight = channel > 0 ? strategyWeights?.[channel] : undefined;
      if (weight !== undefined) {
        if (weight < 0) throw new RangeError("Adapted strategy does not support negative aimsg weights");
        teamState.rng = nextRandom(teamState.rng);
        if (weight === 0 || teamState.rng % maximumWeight >= weight) {
          const stopped = weight === 0 && (current.activity === "move" || current.activity === "attack");
          if (stopped) commands.push({ id: `${configuration.fingerprint}:${tick}:${team.team}:${actor.identity}`,
            team: team.team, actorKey: actor.key, command: { type: "stop", unitIds: [actor.id] }, stance: "defend", route: [] });
          actorStates[actor.identity] = { ...old, ...(stopped ? { signature: "", issuedTick: tick } : {}), position: actor.position };
          continue;
        }
      }
      const stalled = distance(old.position, actor.position) === 0 ? old.stalled + 1 : 0;
      let objective = old.objective, command: SimulationCommand | undefined;
      let stance: BrowserCampaignAiOrder["stance"] = "advance", route: readonly GridPoint[] = [];
      const localRange = Math.max(weapon.range, observation.snapshot.timeOfDay === "day"
        ? actor.profile.observationDay : actor.profile.observationNight);
      const enemy = enemies.filter(target => (selector === 3
        || distance(actor.position, target.position) <= localRange * localRange)
        && (observation.targetCanDamage?.(actor.id, target.id) ?? true)).sort((left, right) => {
        const defense = selector === 3 ? team.home : anchor;
        const threat = (target: typeof left) => defense
          && distance(defense, target.position) <= (selector === 3 ? 100 : localRange * localRange) ? 0 : 1;
        return threat(left) - threat(right) || distance(actor.position, left.position) - distance(actor.position, right.position)
          || left.id - right.id;
      })[0];
      if (enemy) {
        command = { type: "attack", unitIds: [actor.id], targetId: enemy.id };
        const defense = selector === 3 ? team.home : anchor;
        stance = selector !== 3 || defense && distance(defense, enemy.position) <= 100 ? "defend" : "attack";
      } else if (selector !== 3 && current.activity !== "idle") {
        if (ownsAttack) {
          command = { type: "stop", unitIds: [actor.id] };
          stance = "defend";
        } else {
          actorStates[actor.identity] = { ...old, signature: "", position: actor.position, stalled: 0 };
          continue;
        }
      } else if (current.targetId !== null && current.activity === "attack") {
        command = { type: "stop", unitIds: [actor.id] };
        stance = "defend";
      } else {
        if (objectives.length) {
          objective %= objectives.length;
          if (distance(actor.position, objectives[objective]) <= 4 || stalled >= 5)
            objective = (objective + 1) % objectives.length;
        }
        const destination = objectives[objective] ?? team.home;
        if (selector === 1) stance = "defend";
        if (destination && distance(actor.position, destination) > 4) {
          route = current.movementPlane === "air"
            ? approach(source.airGrid, actor.position, destination, airOccupied, new Set()) ?? []
            : approach(planningGrid, actor.position, destination, occupied, staticCells) ?? [];
          if (route.length > 1) command = { type: "move", unitIds: [actor.id], target: route[route.length - 1] };
        }
      }
      const signature = command ? JSON.stringify(command) : "";
      const continuing = command?.type === "move" ? current.activity === "move" && stalled < 5
        : command?.type === "attack" ? current.targetId === command.targetId : false;
      const emit = command && (signature !== old.signature || !continuing && tick - old.issuedTick >= 100);
      if (emit && command) commands.push({ id: `${configuration.fingerprint}:${tick}:${team.team}:${actor.identity}`,
        team: team.team, actorKey: actor.key, command, stance, route });
      actorStates[actor.identity] = { objective, group: old.group,
        signature: emit ? signature : selector !== 3 && !command ? "" : old.signature,
        issuedTick: emit ? tick : old.issuedTick, position: actor.position, stalled: stalled >= 5 ? 0 : stalled };
    }
  }
  return { state: { ...state, lastTick: tick, nextDecisionTick: tick + configuration.decisionPeriodTicks,
    teams: teamStates, actors: actorStates }, commands };
}
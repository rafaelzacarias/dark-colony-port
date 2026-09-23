import type { MissionView } from "../../../src/mission-view";
import { areHostile } from "../../../src/engine/diplomacy";
import { findPath } from "../../../src/engine/pathfinding";

export type BrowserPlaythroughFaction = "human" | "alien";

export const MISSION02_GOALS = {
  human: { trigger: 6, condition: "(s(2,3)>26)", statistic: "2,3", required: 27,
    team: 2, unitType: null, dependency: 9, commander: 69, harvester: 6 },
  alien: { trigger: 4, condition: "(s(1,0,86)>5)", statistic: "1,0,86", required: 6,
    team: 1, unitType: 86, dependency: 23, commander: 73, harvester: 14 },
} as const;

export function inspectMission02(mission: MissionView["mission"]) {
  const goal = MISSION02_GOALS[mission.faction];
  if (mission.scenario.id.toUpperCase() !== `${mission.faction.toUpperCase()}02` ||
      mission.runtimeProfile !== "browser-adapted" || mission.sourceNativeCombat ||
      !mission.browserEconomy || !mission.sourceProduction) {
    throw new TypeError("Expected original browser-adapted mission 02 with source economy and production");
  }
  const wins = mission.triggers.filter(block => block.actions.some(action =>
    action.name === "bail" && action.arguments[0] === 0));
  if (wins.length !== 1 || wins[0].id !== goal.trigger || wins[0].condition !== goal.condition) {
    throw new TypeError("Unexpected original mission-02 victory condition");
  }
  return { goal, briefing: mission.briefing?.plainText,
    losses: mission.triggers.filter(block => block.actions.some(action =>
      action.name === "bail" && action.arguments[0] === 1)),
    trips: mission.triggers.filter(block => block.mode === "trip") };
}

export type BrowserPlaythroughStatus = "RUNNING" | "WIN" | "LOSS" | "FAIL" | "UNKNOWN";
export interface BrowserPlaythroughEvent {
  kind: string;
  tick: number;
  data: unknown;
}
export interface BrowserPlaythroughOptions {
  intent?: "win" | "loss";
  maxTicks?: number;
  armySize?: number;
  deadlineMs?: number;
  observeEvery?: number;
  onEvent?: (event: BrowserPlaythroughEvent) => void;
  beforeUpdate?: (nextTick: number) => void;
  resume?: BrowserPlaythroughCheckpoint;
  replay?: readonly BrowserPlaythroughEvent[];
}

export interface BrowserPlaythroughCheckpoint {
  faction: BrowserPlaythroughFaction;
  intent: "win" | "loss";
  tick: number;
  shots: number;
  deaths: number;
  purchases: number;
  spent: number;
  commandCount: number;
  selectorCount: number;
  sourceGoals: { key: string; type: number; x: number; y: number }[];
  cleared: string[];
  signatures: [string, { signature: string; tick: number }][];
  expectedLossStatistics: Record<string, number>;
  expedition?: number[];
  assaultLeg?: Mission02AssaultLeg;
}

export function mission02ClearedGoals(goals: readonly { key: string; type: number }[],
  bindings: readonly { key: string; generation: number; simulationId: number }[],
  losses: readonly { id: string; victimTeam: number; victimType: number }[], team: number,
  deaths: readonly { targetId: number }[] = []) {
  return goals.filter(goal => {
    const binding = bindings.find(binding => binding.key === goal.key);
    if (!binding) return false;
    if (deaths.some(death => death.targetId === binding.simulationId)) return true;
    return losses.some(loss => {
      if (loss.victimTeam !== team || loss.victimType !== goal.type) return false;
      const identity: unknown = JSON.parse(loss.id);
      return Array.isArray(identity) && identity.length === 3 && identity[1] === binding.key && identity[2] === binding.generation;
    });
  }).map(goal => goal.key);
}

export interface Mission02AssaultLeg {
  purpose: string;
  point: { x: number; y: number };
  remaining: number;
  progressTick: number;
}

export function mission02AssaultLeg(troops: readonly { id: number; cellX: number; cellY: number; activity: string }[],
  destination: { x: number; y: number }, purpose: string, tick: number, previous: Mission02AssaultLeg | undefined,
  approach: () => { x: number; y: number } | undefined) {
  const distance = (actor: { cellX: number; cellY: number }, point: { x: number; y: number }) =>
    Math.abs(actor.cellX - point.x) + Math.abs(actor.cellY - point.y);
  const behind = (point: { x: number; y: number }) => troops.filter(actor => distance(actor, point) > 3 &&
    distance(actor, destination) > Math.abs(point.x - destination.x) + Math.abs(point.y - destination.y));
  let leg = previous?.purpose === purpose ? previous : undefined;
  let fresh = false;
  if (leg) {
    const remaining = behind(leg.point).reduce((sum, actor) => sum + distance(actor, leg!.point), 0);
    if (!remaining || tick - leg.progressTick >= 400) leg = undefined;
    else if (remaining < leg.remaining) leg = { ...leg, remaining, progressTick: tick };
  }
  if (!leg) {
    const point = approach();
    if (!point) return { leg: undefined, ids: [] };
    leg = { purpose, point, remaining: behind(point).reduce((sum, actor) => sum + distance(actor, point), 0), progressTick: tick };
    fresh = true;
  }
  return { leg, ids: behind(leg.point).filter(actor => fresh || actor.activity === "idle").map(actor => actor.id) };
}

export function classifyMission02(outcome: MissionView["missionOutcome"], diagnostic: string | undefined,
  tick: number, maxTicks: number): BrowserPlaythroughStatus {
  if (diagnostic) return "FAIL";
  if (outcome?.ready) return outcome.resultCode === 0 ? "WIN" : outcome.resultCode === 1 ? "LOSS" : "FAIL";
  return tick >= maxTicks ? "UNKNOWN" : "RUNNING";
}

export function mission02CasualtyMismatches(expected: Readonly<Record<string, number>>, actual: Readonly<Record<string, number>>) {
  return Object.entries(expected).filter(([key, value]) => actual[key] !== value)
    .map(([key, value]) => ({ key, expected: value, actual: actual[key] ?? null }));
}

export function mission02ArmyTarget(minimum: number, remaining: number, armedStatics: number, losses: number) {
  return Math.min(40, Math.max(minimum, Math.min(28, remaining + 8), 12 + armedStatics * 6 + Math.floor(losses / 3)));
}

export function mission02Purchase<T extends { dependency: number; cost: number; enabled: boolean; pending: number; queued: number }>(
  menu: readonly T[], faction: BrowserPlaythroughFaction, collectors: number, troops: number, desiredArmy: number,
  credits: number, exitClear: (dependency: number) => boolean,
) {
  const collectorDependency = faction === "human" ? 7 : 21;
  const collector = menu.find(choice => choice.dependency === collectorDependency);
  const choice = collectors === 0 ? collector : menu.find(choice => choice.dependency === MISSION02_GOALS[faction].dependency);
  if (!choice || !choice.enabled || choice.pending || choice.queued || !exitClear(choice.dependency) || credits < choice.cost) return;
  if (collectors > 0 && (troops >= desiredArmy || troops >= 10 && credits - choice.cost < (collector?.cost ?? 1500))) return;
  return choice;
}

export function mission02ArmyGroups<T extends { id: number; cellX: number; cellY: number }>(troops: readonly T[], home: { x: number; y: number }, deployed: readonly number[] = []) {
  const ranked = [...troops].sort((left, right) =>
    Math.abs(left.cellX - home.x) + Math.abs(left.cellY - home.y) -
    Math.abs(right.cellX - home.x) - Math.abs(right.cellY - home.y) || left.id - right.id);
  const survivors = ranked.filter(actor => deployed.includes(actor.id));
  const assembled = ranked.filter(actor => Math.abs(actor.cellX - home.x) + Math.abs(actor.cellY - home.y) <= 10);
  const expedition = survivors.length >= 2 ? survivors : deployed.length ? [] : assembled.slice(2, 14);
  const ready = expedition.length >= (deployed.length ? 2 : 8) ? expedition : [];
  return { guards: ranked.filter(actor => !ready.includes(actor)), expedition: ready };
}

export function mission02ExpeditionLeader<T extends { id: number; cellX: number; cellY: number }>(
  troops: readonly T[], destination: { x: number; y: number },
) {
  return [...troops].sort((left, right) =>
    Math.abs(right.cellX - destination.x) + Math.abs(right.cellY - destination.y) -
    Math.abs(left.cellX - destination.x) - Math.abs(left.cellY - destination.y) || left.id - right.id)[0];
}

export function mission02VisibleTarget<T extends { id: number; cellX: number; cellY: number; health: number }>(
  visibleEnemies: readonly T[], center: { x: number; y: number }, objectives: ReadonlySet<number>,
) {
  const distance = (actor: T) => Math.abs(actor.cellX - center.x) + Math.abs(actor.cellY - center.y);
  return visibleEnemies.filter(actor => distance(actor) <= 10).sort((left, right) =>
    Number(objectives.has(right.id)) - Number(objectives.has(left.id)) ||
    distance(left) - distance(right) || left.health - right.health || left.id - right.id)[0];
}

export function mission02Approach(grid: Parameters<typeof findPath>[0], blocked: ReadonlySet<number>,
  start: { x: number; y: number }, destination: { x: number; y: number }) {
  const candidates = Array.from({ length: 81 }, (_, index) => ({ x: destination.x + index % 9 - 4,
    y: destination.y + Math.floor(index / 9) - 4 })).filter(point => grid.isPassable(point.x, point.y) &&
      !blocked.has(grid.index(point.x, point.y))).sort((left, right) =>
      Math.abs(left.x - destination.x) + Math.abs(left.y - destination.y) -
      Math.abs(right.x - destination.x) - Math.abs(right.y - destination.y));
  for (const candidate of candidates) {
    const route = findPath(grid, start, candidate, { blocked });
    if (route?.length) return route[Math.min(10, route.length - 1)];
  }
}

export function createBrowserCampaignPlaythrough(view: MissionView, options: BrowserPlaythroughOptions = {}) {
  const contract = inspectMission02(view.mission), goal = contract.goal;
  const maxTicks = options.maxTicks ?? 30000, armySize = options.armySize ?? 18;
  const deadlineMs = options.deadlineMs ?? 900000, startedAt = performance.now();
  const observeEvery = options.observeEvery ?? 20;
  const intent = options.intent ?? "win";
  if (!Number.isSafeInteger(maxTicks) || maxTicks < 1 || maxTicks > 50000 ||
      !Number.isFinite(deadlineMs) || deadlineMs <= 0 || deadlineMs > 900000 ||
      !Number.isSafeInteger(observeEvery) || observeEvery < 20 || observeEvery > 1000 || observeEvery % 20 !== 0 ||
      !Number.isSafeInteger(armySize) || armySize < 1 || armySize > 40 || !["win", "loss"].includes(intent)) {
    throw new RangeError("Invalid playthrough limits or intent");
  }
  const resume = options.resume;
  if (view.simulation.snapshot.tick !== (resume?.tick ?? 0) || !view.terrainImage ||
      resume && (resume.faction !== view.mission.faction || resume.intent !== intent)) {
    throw new TypeError("Initialize a matching actual-loader view and strategy checkpoint first");
  }
  const initialWorld = resume ? undefined : view.campaignSnapshot!.world;
  if (!resume && initialWorld!.exomoney[0] !== 0) throw new TypeError("Original mission-02 starts with zero player credits");
  type Point = { x: number; y: number };
  const sourceGoals = resume?.sourceGoals ?? initialWorld!.entities.filter(entity => entity.team === goal.team &&
    (goal.unitType === null || entity.unitType === goal.unitType)).map(entity => ({ key: entity.key,
      type: entity.unitType, x: entity.tileX, y: entity.tileY }));
  const homeRow = view.mission.scenario.teams[0].coordinateRows[0];
  const home = { x: homeRow[0], y: homeRow[1] };
  const base = view.mission.scenario.teams[0].coordinateRows[1];
  const productionExit = { x: base[0], y: base[1] - 3 };
  const collectorExit = { x: base[0] - 4, y: base[1] };
  const cleared = new Set<string>(resume?.cleared), signatures = new Map<string, { signature: string; tick: number }>(resume?.signatures);
  const seenActors = new Map<number, string>(), seenAi = new Map<string, number>();
  let tick = resume?.tick ?? 0, time = 0, error: string | undefined, busy = false;
  let shots = resume?.shots ?? 0, deaths = resume?.deaths ?? 0, purchases = resume?.purchases ?? 0;
  let selectorCount = resume?.selectorCount ?? 0, statisticsSignature = "", outcomeSignature = "";
  let commandCount = resume?.commandCount ?? 0, spent = resume?.spent ?? 0;
  let expectedLossStatistics: Record<string, number> = { ...resume?.expectedLossStatistics };
  let expedition = resume?.expedition ?? [];
  let assaultLeg = resume?.assaultLeg;
  const replay = options.replay?.filter(event => event.kind === "action" && event.tick >= tick);
  let replayIndex = 0;
  let lastIncome = resume ? view.browserEconomyState?.earned[0] ?? 0 : 0;
  let carrierSignature = "";
  const emit = (kind: string, data: unknown) => options.onEvent?.({ kind, tick, data });
  const pointOf = (actor: { cellX: number; cellY: number }): Point => ({ x: actor.cellX, y: actor.cellY });
  const distance = (left: Point, right: Point) => Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
  const state = () => classifyMission02(view.missionOutcome, error ?? view.missionDiagnostic, tick, maxTicks);
  const summary = (campaign = () => view.campaignSnapshot!) => ({ status: state(), intent, tick, maxTicks, shots, deaths, purchases, spent, commandCount,
    outcome: view.missionOutcome, diagnostic: error ?? view.missionDiagnostic ?? null,
    objective: { ...goal, value: view.missionStatistics[goal.statistic] ?? 0 },
    credits: view.resourceWorkflow.credits[0], earned: view.browserEconomyState?.earned[0] ?? 0,
    publishedIncome: campaign().browserEconomyLedger?.earned[0] ?? 0 });

  function select(ids: number[]) {
    view.replaceSelection(ids);
    if (JSON.stringify(view.selectedIds) !== JSON.stringify([...ids].sort((left, right) => left - right))) {
      throw new Error("Public selection rejected planned player actors");
    }
  }
  function order(ids: number[], mode: "move" | "assault", point: Point, purpose: string) {
    if (!ids.length) return;
    ids = [...ids].sort((left, right) => left - right);
    const key = ids.join(","), signature = JSON.stringify({ mode, point, purpose });
    const previous = signatures.get(key);
    if (previous?.signature === signature && tick - previous.tick < 200) return;
    select(ids);
    view.setCameraCenter(point.x + 0.5, point.y + 0.5);
    view.setOrderMode(mode);
    const camera = view.cameraView, bounds = view.canvas.getBoundingClientRect();
    const scale = 512 / camera.width;
    const clientX = bounds.left + ((point.x + 0.5 - camera.x) * scale) * bounds.width / 512;
    const clientY = bounds.top + (226 - (point.y + 0.5 - camera.y - camera.height / 2) * scale) * bounds.height / 452;
    const cursor = view.cursorAt(clientX, clientY);
    if (cursor === "blocked") { emit("blocked-command", { ids, mode, point, purpose }); return; }
    view.commandAt(clientX, clientY);
    signatures.set(key, { signature, tick });
    commandCount++;
    emit("action", { kind: cursor === "attack" ? "attack-or-assault" : mode, ids, point, purpose, cursor,
      visible: !!view.visibility[point.y * view.grid.width + point.x], client: [clientX, clientY] });
  }
  function plan() {
    const snapshot = view.simulation.snapshot, campaign = view.campaignSnapshot!, world = campaign.world;
    const bindings = new Map(view.nativeBindings.map(binding => [binding.key, binding.simulationId]));
    for (const key of mission02ClearedGoals(sourceGoals, view.nativeBindings,
      Object.values(campaign.controller.consumedLosses), goal.team)) {
      if (!cleared.has(key)) emit("objective-cleared", { key, evidence: "source-casualty-binding" });
      cleared.add(key);
    }
    const types = new Map(world.entities.map(entity => [bindings.get(entity.key) ?? entity.simulationId, entity.unitType]));
    const owned = snapshot.units.filter(actor => view.isOwnedUnit(actor.id) && actor.health > 0 && actor.activity !== "die");
    let troops = owned.filter(actor => types.get(actor.id) !== goal.commander && types.get(actor.id) !== goal.harvester);
    const commander = owned.find(actor => types.get(actor.id) === goal.commander);
    const visibility = view.visibility;
    const blind = owned.filter(actor => !visibility[actor.cellY * view.grid.width + actor.cellX]);
    if (blind.length) {
      emit("visibility-failure", { actors: blind.map(actor => ({ id: actor.id, team: actor.team,
        cellX: actor.cellX, cellY: actor.cellY })), visibleCells: visibility.reduce((sum, value) => sum + Number(value > 0), 0) });
      throw new Error("Public fog hides live owned actors' cells; legal harvest/target acquisition cannot proceed");
    }
    const visibleEnemies = [...snapshot.units, ...snapshot.staticTargets].filter(actor => actor.health > 0 &&
      actor.team !== undefined && actor.team >= 0 && actor.team < 8 &&
      (!("activity" in actor) || actor.activity !== "die") && visibility[actor.cellY * view.grid.width + actor.cellX] &&
      areHostile({ faction: view.mission.faction, team: 0 }, actor, snapshot.teamAlliances));
    const economy = view.browserEconomyState!;
    for (const harvester of owned.filter(actor => types.get(actor.id) === goal.harvester)) {
      if (intent === "loss" || economy.orders.some(order => order.simulationId === harvester.id)) continue;
      const sources = view.resourceSources.filter(source => source.status === 1 && (source.remaining ?? 0) > 0 &&
        (source.rate ?? 0) > 0 && visibility[(source.position.y >> 8) * view.grid.width + (source.position.x >> 8)])
        .sort((left, right) => distance(pointOf(harvester), { x: left.position.x >> 8, y: left.position.y >> 8 }) -
          distance(pointOf(harvester), { x: right.position.x >> 8, y: right.position.y >> 8 }));
      const source = sources.find(node => !visibleEnemies.some(enemy =>
        distance(pointOf(enemy), { x: node.position.x >> 8, y: node.position.y >> 8 }) < 8));
      if (source) {
        select([harvester.id]);
        const accepted = view.harvestSelected(source.slot);
        emit("action", { kind: "harvest", ids: [harvester.id], slot: source.slot, key: source.key,
          cell: { x: source.position.x >> 8, y: source.position.y >> 8 }, rate: source.rate,
          remaining: source.remaining, visible: true, accepted });
        commandCount++;
      }
    }
    const collectors = owned.filter(actor => types.get(actor.id) === goal.harvester);
    const exitClear = (dependency: number) => ![...snapshot.units, ...snapshot.staticTargets].some(actor => actor.health > 0 &&
      (!("activity" in actor) || actor.activity !== "die") && distance(pointOf(actor),
        dependency === goal.dependency ? productionExit : collectorExit) <= 2);
    const statistics = view.missionStatistics;
    const desiredArmy = mission02ArmyTarget(Math.max(24, armySize), Math.max(0, goal.required - (statistics[goal.statistic] ?? 0)),
      visibleEnemies.filter(actor => "weapon" in actor && actor.weapon).length, statistics["0,3"] ?? 0);
    const choice = mission02Purchase(view.productionMenu, view.mission.faction, collectors.length, troops.length,
      desiredArmy, view.resourceWorkflow.credits[0], exitClear);
    if (intent === "win" && choice) {
      const before = view.resourceWorkflow.credits[0], accepted = view.purchaseProduction(choice.dependency);
      emit("action", { kind: "purchase", dependency: choice.dependency, cost: choice.cost, before, earned: economy.earned[0], accepted,
        purpose: collectors.length ? "reinforce-army" : "replace-lost-collector" });
      if (accepted) { purchases++; spent += choice.cost; }
    }
    if (intent === "loss") {
      if (commander) {
        const target = visibleEnemies.sort((left, right) => distance(pointOf(commander), pointOf(left)) -
          distance(pointOf(commander), pointOf(right)))[0];
        const destination = target ? pointOf(target) : sourceGoals[0];
        if (destination) {
          const blocked = new Set(view.simulation.staticObstacleCells.map(point => view.grid.index(point.x, point.y)));
          const candidates = Array.from({ length: 81 }, (_, index) => ({
            x: destination.x + index % 9 - 4, y: destination.y + Math.floor(index / 9) - 4,
          })).filter(point => view.grid.isPassable(point.x, point.y) && !blocked.has(view.grid.index(point.x, point.y)))
            .sort((left, right) => distance(left, destination) - distance(right, destination));
          const route = candidates.map(point => findPath(view.grid, pointOf(commander), point, { blocked })).find(Boolean);
          if (route?.length) order([commander.id], "move", route[Math.min(10, route.length - 1)], "expose-commander-without-support");
          else emit("route-blocked", { purpose: "expose-commander-without-support", destination });
        }
      }
      return;
    }
    if (commander && distance(pointOf(commander), home) > 5) order([commander.id], "move", home, "protect-commander");
    if (!troops.length) return;
    const worker = owned.find(actor => types.get(actor.id) === goal.harvester);
    const defense = worker ? pointOf(worker) : home;
    const groups = mission02ArmyGroups(troops, defense, expedition);
    expedition = groups.expedition.map(actor => actor.id);
    const threat = visibleEnemies.filter(enemy => distance(pointOf(enemy), home) < 12 ||
      worker && distance(pointOf(enemy), pointOf(worker)) < 10)
      .sort((left, right) => distance(pointOf(left), defense) - distance(pointOf(right), defense) || left.health - right.health)[0];
    const unworkedSource = worker && !economy.orders.some(order => order.simulationId === worker.id)
      ? view.resourceSources.filter(source => source.status === 1 && (source.remaining ?? 0) > 0 && (source.rate ?? 0) > 0)
        .map(source => ({ x: source.position.x >> 8, y: source.position.y >> 8 }))
        .filter(point => !visibleEnemies.some(enemy => distance(pointOf(enemy), point) < 10))
        .sort((left, right) => distance(pointOf(worker), left) - distance(pointOf(worker), right))[0] : undefined;
    const scouts = !threat && unworkedSource ? groups.guards.slice(2, 8) : [];
    if (unworkedSource && scouts.length >= 4) {
      const blocked = new Set(view.simulation.staticObstacleCells.map(point => view.grid.index(point.x, point.y)));
      const approach = mission02Approach(view.grid, blocked, pointOf(scouts[0]), unworkedSource);
      if (approach) order(scouts.map(actor => actor.id), "assault", approach, "secure-next-source");
      else emit("route-blocked", { destination: unworkedSource, purpose: "secure-next-source" });
    }
    const guards = groups.guards.filter(actor => !(scouts.length >= 4 && scouts.includes(actor)) &&
      (!threat || actor.activity !== "attack" || actor.targetId !== threat.id));
    order(guards.map(actor => actor.id), threat ? "assault" : "move", threat ? pointOf(threat) : defense,
      threat ? `protect-economy:${threat.id}` : "guard-source-economy");
    troops = groups.expedition;
    if (!troops.length) return;
    const center = { x: Math.round(troops.reduce((sum, actor) => sum + actor.cellX, 0) / troops.length),
      y: Math.round(troops.reduce((sum, actor) => sum + actor.cellY, 0) / troops.length) };
    const objectiveIds = new Set(world.entities.filter(entity => entity.team === goal.team &&
      (goal.unitType === null || entity.unitType === goal.unitType)).map(entity => bindings.get(entity.key) ?? entity.simulationId));
    const nearest = mission02VisibleTarget(visibleEnemies, center, new Set([...objectiveIds].filter((id): id is number => id !== undefined)));
    if (nearest) {
      const available = troops.filter(actor => actor.activity !== "attack" || actor.targetId !== nearest.id);
      order(available.map(actor => actor.id), "assault", pointOf(nearest), `visible-hostile:${nearest.id}`);
      return;
    }
    const waiting = troops.length < 2;
    let destination: Point = home, purpose = "defend-source-base-and-clear-production-exit";
    if (!waiting) {
      const target = sourceGoals.filter(source => !cleared.has(source.key)).sort((left, right) => distance(left, center) - distance(right, center))[0];
      const fallback = view.mission.scenario.teams[goal.team].coordinateRows[0];
      const reinforcement = view.mission.triggers.flatMap(block => block.actions).find(action =>
        action.name === "reinforce" && action.arguments[0] === goal.team);
      destination = target ?? (view.mission.faction === "human" && reinforcement ?
        { x: reinforcement.arguments[1], y: reinforcement.arguments[2] } : { x: fallback[0], y: fallback[1] });
      purpose = target ? `source-objective:${target.key}` : "source-reinforcement-approach";
    } else destination = { x: home.x + (view.mission.faction === "human" ? 2 : 5), y: home.y - 5 };
    const planned = mission02AssaultLeg(troops, destination, purpose, tick, assaultLeg, () => {
      const leader = mission02ExpeditionLeader(troops, destination);
      const occupied = new Set(view.simulation.staticObstacleCells.map(point => view.grid.index(point.x, point.y)));
      return mission02Approach(view.grid, occupied, pointOf(leader), destination);
    });
    assaultLeg = planned.leg;
    if (!assaultLeg) { emit("route-blocked", { destination, purpose }); return; }
    order(planned.ids, "assault", assaultLeg.point, purpose);
  }
  function observe() {
    const snapshot = view.simulation.snapshot;
    let campaignSnapshot: MissionView["campaignSnapshot"];
    const campaign = () => campaignSnapshot ??= view.campaignSnapshot!;
    if (!view.missionDiagnostic && Object.keys(expectedLossStatistics).length) {
      const actual = view.missionStatistics;
      const mismatches = mission02CasualtyMismatches(expectedLossStatistics, actual);
      if (mismatches.length) {
        emit("casualty-feedback-failure", { mismatches, consumedLosses: campaign().controller.consumedLosses });
        throw new Error(`Source casualty feedback lost after public combat: ${JSON.stringify(mismatches)}`);
      }
      expectedLossStatistics = {};
    }
    const combat = view.simulation.combatEvents, lost = view.simulation.deathEvents;
    shots += combat.length; deaths += lost.length;
    if (combat.length || lost.length) emit("combat", { combat, deaths: lost });
    if (lost.length) {
      const world = campaign().world, bindings = view.nativeBindings, statistics = view.missionStatistics;
      for (const key of mission02ClearedGoals(sourceGoals, bindings, [], goal.team, lost)) {
        if (!cleared.has(key)) emit("objective-cleared", { key, evidence: "combat-death-binding" });
        cleared.add(key);
      }
      for (const death of lost) {
        const binding = bindings.find(binding => binding.simulationId === death.targetId);
        const entity = world.entities.find(entity => entity.key === binding?.key);
        if (!entity || entity.team < 0 || entity.team >= 8) continue;
        for (const key of [`${entity.team},3`, `${entity.team},0,${entity.unitType}`]) {
          expectedLossStatistics[key] = (expectedLossStatistics[key] ?? statistics[key] ?? 0) + 1;
        }
      }
    }
    if (tick % observeEvery === 0) {
      const income = view.browserEconomyState?.earned[0] ?? 0;
      if (income !== lastIncome) {
        emit("resource-delivery", { earned: income, delta: income - lastIncome,
          published: campaign().browserEconomyLedger?.earned[0] ?? 0 });
        lastIncome = income;
      }
      const carriers = view.carrierVisuals, nextCarrierSignature = JSON.stringify(carriers);
      if (nextCarrierSignature !== carrierSignature) {
        if (carriers.length || carrierSignature !== "[]") emit("carrier", carriers);
        carrierSignature = nextCarrierSignature;
      }
      const world = campaign().world, bindings = view.nativeBindings;
      for (const actor of [...snapshot.units, ...snapshot.staticTargets]) {
        if (seenActors.has(actor.id)) continue;
        const binding = bindings.find(binding => binding.simulationId === actor.id);
        const entity = world.entities.find(entity => entity.key === binding?.key);
        seenActors.set(actor.id, entity?.key ?? String(actor.id));
        emit("actor", { ...actor, source: entity && { key: entity.key, type: entity.unitType, team: entity.team } });
      }
      const ai = view.browserAiState!;
      const selectors = world.aiSelectors!.events;
      for (const event of selectors.slice(selectorCount)) emit("ai-selector", event);
      selectorCount = selectors.length;
      for (const [identity, actor] of Object.entries(ai.strategy.actors)) {
        if (actor.issuedTick < 0 || seenAi.get(identity) === actor.issuedTick) continue;
        seenAi.set(identity, actor.issuedTick);
        emit("ai-order", { identity, ...actor });
      }
      const statistics = view.missionStatistics, signature = JSON.stringify(statistics);
      if (signature !== statisticsSignature) {
        emit("statistics", { values: Object.fromEntries(Object.entries(statistics).filter(([, value]) => value)),
          goal: statistics[goal.statistic] ?? 0, buildingSlots: world.buildingSlots });
        statisticsSignature = signature;
      }
    }
    const signature = JSON.stringify(view.missionOutcome);
    if (signature !== outcomeSignature) { emit("outcome", view.missionOutcome); outcomeSignature = signature; }
    if (tick % 1000 === 0 || [1135, 1136, 1152, 14095, 14096, 14120].includes(tick)) {
      emit("progress", { ...summary(campaign), elapsedMs: Math.round(performance.now() - startedAt), units: snapshot.units, staticTargets: snapshot.staticTargets,
        economy: view.browserEconomyState, ai: view.browserAiState, lives: campaign().controller.runtime.lives });
    }
  }
  function replayCommands() {
    while (replay && replayIndex < replay.length && replay[replayIndex].tick === tick) {
      const event = replay[replayIndex++];
      const action = event.data as { kind: string; ids: number[]; point: Point; slot: number;
        dependency: number; accepted: boolean; cost: number; cursor: string; client: [number, number] };
      if (action.kind === "purchase") {
        const choice = view.productionMenu.find(choice => choice.dependency === action.dependency);
        if (!choice || choice.cost !== action.cost || view.purchaseProduction(action.dependency) !== action.accepted) {
          throw new Error(`Public purchase replay diverged at tick ${tick}`);
        }
        if (action.accepted) { purchases++; spent += action.cost; }
      } else if (action.kind === "harvest") {
        select(action.ids);
        if (view.harvestSelected(action.slot) !== action.accepted) throw new Error(`Public harvest replay diverged at tick ${tick}`);
        commandCount++;
      } else {
        select(action.ids);
        view.setCameraCenter(action.point.x + 0.5, action.point.y + 0.5);
        view.setOrderMode(action.kind === "move" ? "move" : "assault");
        if (view.cursorAt(...action.client) !== action.cursor) throw new Error(`Public cursor replay diverged at tick ${tick}`);
        view.commandAt(...action.client);
        commandCount++;
      }
      emit("action", action);
    }
  }
  emit("admission", { faction: view.mission.faction, intent, contract, sourceGoals,
    profile: view.mission.runtimeProfile, source: view.mission.scenario.source, triggers: view.mission.triggers,
    aiConfiguration: view.mission.browserAi, economy: view.mission.browserEconomy,
    semantics: "source-aware public selection/command/harvest/purchase API; no native timing or human-only knowledge claim" });
  view.resetClock();
  view.update(0);
  return {
    get progress() { return summary(); },
    checkpoint(): BrowserPlaythroughCheckpoint {
      if (busy) throw new Error("Cannot checkpoint an active strategy step");
      return structuredClone({ faction: view.mission.faction, intent, tick, shots, deaths, purchases, spent,
        commandCount, selectorCount, sourceGoals, cleared: [...cleared], signatures: [...signatures], expectedLossStatistics, expedition,
        ...(assaultLeg ? { assaultLeg } : {}) });
    },
    async step(count = 250) {
      if (!Number.isSafeInteger(count) || count < 1 || count > 1000 || busy) throw new RangeError("Invalid or concurrent batch");
      busy = true;
      try {
        for (let index = 0; index < count && state() === "RUNNING"; index++) {
          if (performance.now() - startedAt >= deadlineMs) throw new Error(`QA wall-clock deadline exceeded (${deadlineMs}ms)`);
          if (view.simulation.snapshot.tick !== tick) throw new Error("Host must suspend its own update loop");
          if (!view.missionOutcome) {
            if (replay) replayCommands();
            else if (tick % 20 === 0) plan();
          }
          time += 50;
          options.beforeUpdate?.(tick + 1);
          view.update(time);
          const nextTick = view.simulation.snapshot.tick;
          if (nextTick !== tick + 1 && !view.missionOutcome?.ready && !view.missionDiagnostic) {
            throw new Error(`Expected one 50ms tick: ${tick} -> ${nextTick}`);
          }
          tick = nextTick;
          observe();
        }
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
        emit("failure", { diagnostic: error });
      } finally { busy = false; }
      return summary();
    },
  };
}
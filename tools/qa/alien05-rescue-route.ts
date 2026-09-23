import { NavigationGrid, type GridPoint } from "../../src/engine/grid";
import { findPath } from "../../src/engine/pathfinding";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { areHostile } from "../../src/engine/diplomacy";
import { calculateLegacyDamage } from "../../src/engine/legacy-balance";
import { installSourceRender } from "./fixtures/source-render";
import { authenticateMission05Resume, inspectMission05 } from "./mission05-playthrough";
import { sha256 } from "./mission03-playthrough";

export interface RescueThreat extends GridPoint { id: number; range: number }

export function rescuePathSafe(start: GridPoint, path: readonly GridPoint[], threats: readonly RescueThreat[]) {
  return threats.every(threat => {
    const initial = Math.abs(start.x - threat.x) + Math.abs(start.y - threat.y);
    const clearance = Math.min(initial, threat.range + 1);
    return path.every(cell => Math.abs(cell.x - threat.x) + Math.abs(cell.y - threat.y) >= clearance - 0.01);
  });
}

export function rescueRetainedWaypoint(grid: NavigationGrid, start: GridPoint, path: readonly GridPoint[],
  obstacles: ReadonlySet<number>, threats: readonly RescueThreat[], safetyStart: GridPoint = start) {
  const prefix: GridPoint[] = [];
  for (const cell of path) {
    if (!rescuePathSafe(safetyStart, [cell], threats) || obstacles.has(grid.index(cell.x, cell.y))) break;
    prefix.push(cell);
  }
  for (const waypoint of prefix.reverse()) {
    if (waypoint.x === start.x && waypoint.y === start.y) continue;
    const publicPath = findPath(grid, start, waypoint);
    if (publicPath && publicPath.slice(1).every(cell => !obstacles.has(grid.index(cell.x, cell.y))) &&
      rescuePathSafe(safetyStart, publicPath.slice(1), threats)) return { goal: waypoint, path: publicPath, waypoint, publicPath };
  }
  return undefined;
}

export function rescueFiringRoute(grid: NavigationGrid, start: GridPoint, obstacles: ReadonlySet<number>,
  threats: readonly RescueThreat[], ownRange: number, safetyStart: GridPoint = start) {
  const goals = Array.from(grid.costs.keys()).map(index => grid.point(index)).filter(cell =>
    grid.isPassable(cell.x, cell.y) && !obstacles.has(grid.index(cell.x, cell.y)) &&
    threats.every(threat => Math.abs(cell.x - threat.x) + Math.abs(cell.y - threat.y) >= threat.range + 1.25) &&
    threats.some(threat => Math.abs(cell.x - threat.x) + Math.abs(cell.y - threat.y) <= ownRange));
  return rescueRoute(grid, start, goals, obstacles, threats, false, new Set(), safetyStart);
}

export function rescueRoute(grid: NavigationGrid, start: GridPoint, goals: readonly GridPoint[],
  obstacles: ReadonlySet<number>, threats: readonly RescueThreat[], northEast = false,
  publicObstacles: ReadonlySet<number> = new Set(), safetyStart: GridPoint = start) {
  const blocked = new Set(obstacles);
  for (let index = 0; index < grid.costs.length; index++) {
    const cell = grid.point(index);
    if ((northEast && cell.x < 40 && cell.y > 28) || !rescuePathSafe(safetyStart, [cell], threats)) blocked.add(index);
  }
  const candidates = goals.flatMap(goal => {
    const path = findPath(grid, start, goal, { blocked });
    return path ? [{ goal, path }] : [];
  }).sort((left, right) => left.path.length - right.path.length);
  for (const candidate of candidates) {
    for (let length = Math.min(13, candidate.path.length); length > 1; length--) {
      const waypoint = candidate.path[length - 1];
      const publicPath = findPath(grid, start, waypoint, { blocked: publicObstacles });
      if (publicPath && publicPath.slice(1).every(cell => !blocked.has(grid.index(cell.x, cell.y))) &&
        rescuePathSafe(safetyStart, publicPath.slice(1), threats)) return { ...candidate, waypoint, publicPath };
    }
  }
  if (threats.length) {
    const costs = Uint16Array.from(grid.costs, (cost, index) => cost === 0 ? 0 :
      Math.min(65535, cost + threats.reduce((penalty, threat) => {
        const cell = grid.point(index);
        const separation = Math.abs(cell.x - threat.x) + Math.abs(cell.y - threat.y);
        return penalty + Math.round(Math.max(0, threat.range + 3 - separation) * 1000);
      }, 0)));
    const weighted = new NavigationGrid(grid.width, grid.height, costs);
    const alternatives = goals.flatMap(goal => {
      const path = findPath(weighted, start, goal, { blocked: obstacles });
      return path ? [{ goal, path }] : [];
    }).sort((left, right) => left.path.reduce((sum, cell) => sum + costs[grid.index(cell.x, cell.y)], 0) -
      right.path.reduce((sum, cell) => sum + costs[grid.index(cell.x, cell.y)], 0));
    for (const candidate of alternatives) {
      for (let length = Math.min(13, candidate.path.length); length > 1; length--) {
        const waypoint = candidate.path[length - 1];
        const publicPath = findPath(grid, start, waypoint, { blocked: publicObstacles });
        if (publicPath && publicPath.slice(1).every(cell => !obstacles.has(grid.index(cell.x, cell.y))) &&
          rescuePathSafe(safetyStart, publicPath.slice(1), threats)) {
          return { ...candidate, waypoint, publicPath };
        }
      }
    }
  }
  return undefined;
}

export function rescueFrontier(grid: NavigationGrid, start: GridPoint, goals: readonly GridPoint[],
  obstacles: ReadonlySet<number>, threats: readonly RescueThreat[], ownRange: number, safetyStart: GridPoint = start) {
  const component = (safe: boolean) => {
    const reached = new Set([grid.index(start.x, start.y)]), queue = [...reached];
    const frontier = new Map<number, { cell: GridPoint; reasons: string[]; threats: number[] }>();
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const cell = grid.point(queue[cursor]);
      for (const neighbor of [{ x: cell.x - 1, y: cell.y }, { x: cell.x + 1, y: cell.y },
        { x: cell.x, y: cell.y - 1 }, { x: cell.x, y: cell.y + 1 }]) {
        if (!grid.contains(neighbor.x, neighbor.y)) continue;
        const index = grid.index(neighbor.x, neighbor.y);
        if (reached.has(index)) continue;
        const hazards = threats.filter(threat => !rescuePathSafe(safetyStart, [neighbor], [threat])).map(threat => threat.id);
        const reasons = [...(!grid.isPassable(neighbor.x, neighbor.y) ? ["terrain"] : []),
          ...(obstacles.has(index) ? ["known-obstacle"] : []), ...(safe && hazards.length ? ["visible-range"] : [])];
        if (reasons.length) frontier.set(index, { cell: neighbor, reasons, threats: hazards });
        else { reached.add(index); queue.push(index); }
      }
    }
    return { cells: queue.map(index => grid.point(index)), frontier: [...frontier.values()],
      reachedGoals: goals.filter(goal => reached.has(grid.index(goal.x, goal.y))) };
  };
  const safe = component(true), terrain = component(false);
  const sightlines = threats.map(threat => ({ threat, firingCells: safe.cells.filter(cell => {
    const separation = Math.abs(cell.x - threat.x) + Math.abs(cell.y - threat.y);
    return separation <= ownRange && separation > threat.range;
  }) }));
  return { start, safetyStart, goals, ownRange, safe, terrain, sightlines,
    sightlineRule: "Engine combat uses Manhattan range without terrain occlusion; targets must be currently visible." };
}

type SavedView = ReturnType<MissionView["checkpoint"]>;
type Equipment = SavedView["simulation"]["units"][number];
type Snapshot = MissionView["simulation"]["snapshot"];
type Actor = Snapshot["units"][number];
type Target = Actor | Snapshot["staticTargets"][number];
const root = new URL("../../", import.meta.url);
const inputPath = process.env.DC_AL05_RESCUE_RESUME ?? "/tmp/dc-al05-rescue-source-route-20260923-c03-1790177290562/checkpoint.json";
const priorInitialMs = Number(process.env.DC_AL05_RESCUE_PRIOR_INITIAL_MS ?? 0);
const priorPlayMs = Number(process.env.DC_AL05_RESCUE_PRIOR_PLAY_MS ?? 0);
assert.ok(Number.isFinite(priorInitialMs) && priorInitialMs >= 0 && priorInitialMs < 500000);
assert.ok(Number.isFinite(priorPlayMs) && priorPlayMs >= 0 && priorPlayMs < 290000);
const read = (path: string) => readFileSync(new URL(path, root));
const point = (actor: Target): GridPoint => ({ x: actor.cellX, y: actor.cellY });
const position = (actor: Target): GridPoint => ({ x: (actor.xSubcells - 512) / 1024, y: (actor.ySubcells - 512) / 1024 });
const distance = (left: GridPoint, right: GridPoint) => Math.hypot(left.x - right.x, left.y - right.y);
const manhattan = (left: GridPoint, right: GridPoint) => Math.abs(left.x - right.x) + Math.abs(left.y - right.y);

export function rescueWinningFight(health: number, targetHealth: number, outgoing: number,
  incomingPerTick: number, cooldown: number) {
  return outgoing > 0 && health >= 250 && health - Math.ceil(targetHealth / outgoing) * cooldown * incomingPerTick >= 200;
}

export function rescueJournalUpdates<Entry extends { cycleCounter: number }>(entries: readonly Entry[], afterCycle: number) {
  return entries.filter(entry => entry.cycleCounter > afterCycle);
}

export function rescueStage(lives: Readonly<Record<number, number>>, extracted: boolean) {
  return lives[2] !== 0 ? "support-trip2" : lives[8] !== 0 ? "support-trip8" : lives[10] !== 0 ? "support-trip10" :
      lives[17] !== 0 ? "rescue-trip17" : !extracted ? "extraction-trip18" : "await-source-win";
}

export function rescueProgress(previous: { stage: string; best: number; tick: number }, stage: string,
  remaining: number, tick: number, combat: boolean) {
  const next = previous.stage !== stage || remaining < previous.best - 0.25
    ? { stage, best: remaining, tick } : { ...previous, tick: combat ? tick : previous.tick };
  return { next, stalled: tick - next.tick >= 200 };
}

export function rescueRemainingPath(path: readonly GridPoint[], current: GridPoint) {
  const index = path.findIndex(cell => cell.x === current.x && cell.y === current.y);
  return index >= 0 ? path.slice(index + 1) : path;
}

function fingerprints() {
  const paths = readdirSync(new URL("src/", root), { recursive: true }).map(String).filter(path => path.endsWith(".ts"))
    .map(path => `src/${path}`).concat(["tools/qa/mission05-playthrough.ts", "tools/qa/fixtures/source-render.ts",
      "tools/qa/alien05-rescue-route.ts"]);
  return Object.fromEntries(paths.sort().map(path => [path, sha256(read(path))]));
}

async function attempt(output: string, proofDirectory?: string) {
  mkdirSync(output, { recursive: true });
  const started = performance.now(), before = fingerprints(), originalInputHash = sha256(readFileSync(inputPath));
  const write = (name: string, value: unknown) => writeFileSync(`${output}/${name}.json`, JSON.stringify(value));
  const renderer = installSourceRender(); renderer.setEnabled(false);
  const originalFetch = globalThis.fetch, fetched: Record<string, string> = {};
  let view: MissionView | undefined;
  let stage = "restore", commands = 0, blocked: string | undefined, steppingMs = 0;
  const fired = new Set<number>();
  const emit = (kind: string, data: unknown) => appendFileSync(`${output}/journal.jsonl`, `${JSON.stringify({ kind,
    tick: view?.simulation.snapshot.tick ?? 0, elapsedMs: Math.round(performance.now() - started), data })}\n`);
  const phase = (name: string) => { process.send?.({ phase: name }); emit("phase", name); };
  globalThis.fetch = async input => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    const bytes = read(`public${path}`); fetched[path] = sha256(bytes);
    return new Response(bytes);
  };
  try {
    const mission = await loadCampaignMission("alien", 5, "browser-adapted");
    const contract = inspectMission05(mission);
    write("source", { contract, before, originalInputHash, inputPath,
      limits: { initialMs: 500000, playMs: 300000, proofMs: 900000, noProgressTicks: 200, priorInitialMs, priorPlayMs },
      limitation: "Actual original-script browser-adapted MissionView, NullCanvas; not browser visuals or native parity." });
    const make = (saved: SavedView) => MissionView.restore(renderer.canvas(), {} as HTMLElement,
      { onStats() {}, onUnitsChanged() {} }, mission, saved);
    if (proofDirectory) {
      phase("proof");
      const pending = JSON.parse(readFileSync(`${proofDirectory}/pending-win.json`, "utf8"));
      const ready = JSON.parse(readFileSync(`${proofDirectory}/checkpoint.json`, "utf8"));
      authenticateMission05Resume(mission, pending); authenticateMission05Resume(mission, ready);
      view = make(pending.view);
      assert.deepEqual(view.checkpoint(), pending.view);
      await view.initialize();
      assert.deepEqual(view.checkpoint(), pending.view);
      assert.equal(view.missionOutcome?.resultCode, 0); assert.equal(view.missionOutcome?.ready, false);
      const count = ready.view.simulation.tick - pending.view.simulation.tick;
      assert.ok(count > 0 && count <= 1000);
      view.resetClock(); view.update(0);
      for (let offset = 1; offset <= count; offset++) {
        view.update(offset * 50); assert.equal(view.missionDiagnostic, undefined);
      }
      const actual = view.checkpoint();
      assert.deepEqual(actual, ready.view);
      assert.equal(view.missionOutcome?.resultCode, 0); assert.equal(view.missionOutcome?.ready, true);
      write("proof", { exact: true, fromTick: pending.view.simulation.tick, toTick: ready.view.simulation.tick,
        expectedHash: sha256(JSON.stringify(ready.view)), actualHash: sha256(JSON.stringify(actual)),
        elapsedMs: performance.now() - started });
      return;
    }
    const saved = JSON.parse(readFileSync(inputPath, "utf8"));
    assert.ok(saved.view.simulation.tick >= 14370);
    if (!process.env.DC_AL05_RESCUE_RESUME) assert.equal(saved.view.simulation.tick, 14370);
    assert.ok(saved.view.state.diagnostic == null && saved.view.state.outcome == null);
    write("authentication", authenticateMission05Resume(mission, saved));
    view = make(saved.view);
    const exact = (name: string) => {
      const actual = view!.checkpoint();
      assert.deepEqual(actual, saved.view);
      write(name, { exact: true, tick: actual.simulation.tick, expectedHash: sha256(JSON.stringify(saved.view)),
        actualHash: sha256(JSON.stringify(actual)) });
    };
    exact("initial-restore"); await view.initialize(); exact("initialized-restore");
    assert.equal(view.missionDiagnostic, undefined);
    const active = view, initialTick = saved.view.simulation.tick;
    assert.equal(Object.hasOwn(saved.view.session, "replayPolicy"), false);
    assert.equal(Object.hasOwn(active.checkpoint().session!, "replayPolicy"), false);
    const validateCommanders = (snapshot: SavedView) => {
      const session = snapshot.session!;
      for (const [team, unitType, sprite] of [[0, 73, "GRAY"], [7, 72, "TRSC"]] as const) {
        assert.ok(session.options.commanders?.some(role => role.team === team && role.unitType === unitType && role.sprite === sprite));
        const slot = session.state.world.commanderSlots?.[team];
        if (slot === undefined) { assert.equal(team, 7); continue; }
        const entity = session.state.world.entities.find(actor => actor.rawSlot === slot);
        assert.ok(entity && entity.team === team && entity.unitType === unitType);
        const binding = snapshot.state.bindings.find(actor => actor.slot === slot && actor.generation === entity.generation);
        assert.ok(binding && binding.key === entity.key);
        if (team === 0) assert.equal(binding.simulationId, 52);
        emit("commander-binding", { team, unitType, slot, binding });
      }
    };
    validateCommanders(saved.view);
    let lives = { ...saved.view.session.state.controller.runtime.lives } as Record<number, number>;
    assert.equal(lives[2], 0);
    assert.equal(rescueStage(lives, false), "support-trip8");
    for (const id of saved.fired) fired.add(id);
    const equipment = new Map<number, Pick<Equipment, "weapon" | "sourceDefense">>();
    const remember = (snapshot: SavedView["simulation"]) => {
      for (const actor of [...snapshot.units, ...snapshot.staticTargets]) equipment.set(actor.id,
        { weapon: actor.weapon ?? null, sourceDefense: actor.sourceDefense });
    };
    remember(saved.view.simulation);
    let cachedCheckpoint = saved.view as SavedView;
    let pending = false, clock = 0;
    let lastPosition = "", lastMovementTick = initialTick, lastJournal = saved.view.session.state.cycleCounter;
    let intent: { waypoint: GridPoint; publicPath: readonly GridPoint[]; stage: string } | undefined;
    const initialCommander = saved.view.simulation.units.find((actor: Equipment) => actor.id === 52)!;
    if (initialCommander.activity === "move" && initialCommander.path.length) intent = {
      waypoint: initialCommander.path.at(-1)!, publicPath: initialCommander.path.slice(initialCommander.pathIndex),
      stage: "support-trip8" };
    let stageSince = initialTick, previousStage = "";
    let currentGoals: readonly GridPoint[] = [], currentThreats: RescueThreat[] = [];
    let progress = { stage: "", best: Infinity, tick: initialTick };
    const visitedCells = new Set<number>();
    let previousHealth = new Map<number, number>();
    let firstStageProgress: unknown = null;
    const goalsForStage = (name: string): readonly GridPoint[] => name === "support-trip2" ? contract.tripCells[2] :
      name === "support-trip8" ? contract.tripCells[8] : name === "support-trip10" ? contract.tripCells[10] :
        name === "rescue-trip17" ? contract.tripCells[17] : name === "extraction-trip18" ? contract.tripCells[18] : [];
    const checkpoint = (name = "checkpoint") => {
      cachedCheckpoint = active.checkpoint(); remember(cachedCheckpoint.simulation);
      lives = { ...cachedCheckpoint.session!.state.controller.runtime.lives };
      const value = { sourceHash: contract.sourceHash, view: cachedCheckpoint, fired: [...fired], commands,
        steppingMs, stage, blocked: blocked ?? null, planner: { progress, intent, lastJournal } };
      write(name, value);
      return value;
    };
    const summary = () => {
      const snapshot = active.simulation.snapshot;
      const visible = [...snapshot.units, ...snapshot.staticTargets].filter(actor => actor.health > 0 &&
        active.visibility[actor.cellY * active.grid.width + actor.cellX]);
      return { tick: snapshot.tick, stage, commands, fired: [...fired], lives, goals: currentGoals, threats: currentThreats,
        firstStageProgress, outcome: active.missionOutcome ?? null,
        diagnostic: active.missionDiagnostic ?? null, steppingMs,
        commander: snapshot.units.find(actor => actor.id === 52),
        owned: snapshot.units.filter(actor => actor.health > 0 && active.isOwnedUnit(actor.id)),
        visible: visible.map(actor => ({ ...point(actor), id: actor.id, team: actor.team, hp: actor.health,
          hostile: areHostile({ faction: "alien", team: 0 }, actor, snapshot.teamAlliances),
          range: equipment.get(actor.id)?.weapon?.rangeCells })),
        movement: cachedCheckpoint.simulation.units.find(actor => actor.id === 52),
        movementTick: cachedCheckpoint.simulation.tick, blocked: blocked ?? null };
    };
    const order = (actor: Actor, destination: GridPoint, mode: "move" | "assault", target?: Target) => {
      active.replaceSelection([actor.id]); assert.deepEqual(active.selectedIds, [actor.id]);
      if (target) {
        assert.ok(active.visibility[target.cellY * active.grid.width + target.cellX]);
        assert.ok(active.simulation.canAutoTarget(actor.id, target.id));
        assert.ok(manhattan(position(actor), position(target)) <= (equipment.get(actor.id)?.weapon?.rangeCells ?? 0));
      }
      active.setCameraCenter(destination.x + 0.5, destination.y + 0.5); active.setOrderMode(mode);
      const camera = active.cameraView, bounds = active.canvas.getBoundingClientRect(), scale = 512 / camera.width;
      const clientX = bounds.left + (destination.x + 0.5 - camera.x) * scale * bounds.width / 512;
      const clientY = bounds.top + (226 - (destination.y + 0.5 - camera.y - camera.height / 2) * scale) * bounds.height / 452;
      const cursor = active.cursorAt(clientX, clientY);
      if (cursor === "blocked") return false;
      active.commandAt(clientX, clientY); commands++;
      emit("command", { actorId: actor.id, destination, mode, stage, targetId: target?.id, cursor });
      return true;
    };
    const damage = (attackerId: number, targetId: number) => {
      const attacker = equipment.get(attackerId), target = equipment.get(targetId);
      const weapon = attacker?.weapon;
      if (!weapon) return 0;
      return weapon.sourceDamage && !("mode" in weapon.sourceDamage) && target?.sourceDefense
        ? calculateLegacyDamage(weapon.damage, weapon.sourceDamage, target.sourceDefense) : weapon.damage;
    };
    const plan = () => {
      const snapshot = active.simulation.snapshot, commander = snapshot.units.find(actor => actor.id === 52 && actor.health > 0);
      if (!commander) {
        stage = fired.has(18) ? "await-source-win" : "await-source-loss";
        currentGoals = []; currentThreats = [];
        if (snapshot.tick - lastMovementTick >= 200 && !fired.has(18)) blocked = "Commander absent without source extraction";
        return;
      }
      const visible = [...snapshot.units, ...snapshot.staticTargets].filter(actor => actor.health > 0 &&
        active.visibility[actor.cellY * active.grid.width + actor.cellX]);
      if (visible.some(actor => !equipment.has(actor.id))) remember(active.simulation.checkpoint());
      const enemies = visible.filter(actor => areHostile({ faction: "alien", team: 0 }, actor, snapshot.teamAlliances));
      const threats = enemies.flatMap(actor => {
        const range = equipment.get(actor.id)?.weapon?.rangeCells ?? ("mine" in actor && actor.mine ? 1 : undefined);
        return range === undefined ? [] : [{ id: actor.id, ...position(actor), range }];
      });
      currentThreats = threats;
      let interruptedPath: readonly GridPoint[] | undefined;
      if (intent && commander.activity === "move" &&
        !rescuePathSafe(position(commander), rescueRemainingPath(intent.publicPath, point(commander)), threats)) {
        interruptedPath = rescueRemainingPath(intent.publicPath, point(commander));
        active.replaceSelection([commander.id]);
        assert.deepEqual(active.selectedIds, [commander.id]);
        active.stopSelected(); commands++;
        emit("stop", { actorId: commander.id, reason: "Unsafe queued path", intent, threats });
        intent = undefined;
      }
      const location = `${commander.xSubcells},${commander.ySubcells}`;
      if (location !== lastPosition) { lastPosition = location; lastMovementTick = snapshot.tick; }
      stage = rescueStage(lives, fired.has(18));
      currentGoals = goalsForStage(stage);
      if (stage !== previousStage) {
        stageSince = snapshot.tick; previousStage = stage;
        visitedCells.clear();
        emit("stage", { stage, commander, lives, goals: currentGoals, threats });
      }
      const combat = [commander, ...enemies].some(actor => actor.health < (previousHealth.get(actor.id) ?? actor.health));
      for (const actor of [commander, ...enemies]) {
        const previous = previousHealth.get(actor.id);
        if (previous !== undefined && actor.health < previous) emit("visible-damage", {
          actorId: actor.id, previousHealth: previous, health: actor.health, cell: point(actor),
          commander: point(commander), range: equipment.get(actor.id)?.weapon?.rangeCells,
        });
      }
      previousHealth = new Map([commander, ...enemies].map(actor => [actor.id, actor.health]));
      if (!firstStageProgress && snapshot.tick > initialTick &&
        (commander.cellX !== Math.floor(initialCommander.xSubcells / 1024) ||
          commander.cellY !== Math.floor(initialCommander.ySubcells / 1024))) {
        firstStageProgress = { tick: snapshot.tick, stage, commander: point(commander), hp: commander.health,
          goal: intent?.waypoint, lives, threats };
        write("first-stage-progress", firstStageProgress); emit("first-stage-progress", firstStageProgress);
      }
      const ownRange = equipment.get(commander.id)?.weapon?.rangeCells ?? 0;
      const legalTargets = enemies.filter(enemy => active.simulation.canAutoTarget(commander.id, enemy.id) &&
        manhattan(position(commander), position(enemy)) <= ownRange);
      const incoming = threats.reduce((sum, threat) => sum + (manhattan(position(commander), threat) <= threat.range
        ? damage(threat.id, commander.id) / Math.max(1, equipment.get(threat.id)?.weapon?.cooldownTicks ?? 1) : 0), 0);
      const target = legalTargets.filter(enemy => (incoming === 0 && damage(commander.id, enemy.id) > 0) ||
        rescueWinningFight(commander.health, enemy.health,
          damage(commander.id, enemy.id), incoming, equipment.get(commander.id)?.weapon?.cooldownTicks ?? 15))
        .sort((left, right) => Number(right.id === commander.targetId) - Number(left.id === commander.targetId) ||
          distance(position(commander), position(left)) - distance(position(commander), position(right)))[0];
      const publicObstacles = new Set(active.simulation.staticObstacleCells.map(cell => active.grid.index(cell.x, cell.y)));
      const obstacles = new Set(publicObstacles);
      for (const actor of visible) if (actor.id !== commander.id) obstacles.add(active.grid.index(actor.cellX, actor.cellY));
      const retained = interruptedPath && rescueRetainedWaypoint(active.grid, point(commander), interruptedPath, obstacles, threats, position(commander));
      const stageRoute = retained ?? rescueRoute(active.grid, point(commander), currentGoals, obstacles, threats, false, new Set(), position(commander));
      const pressured = threats.some(threat => manhattan(position(commander), threat) <= threat.range + 1);
      const firingRoute = (pressured || !stageRoute) && threats.length
        ? rescueFiringRoute(active.grid, point(commander), obstacles, threats, ownRange, position(commander)) : undefined;
      const route = firingRoute ?? stageRoute;
      visitedCells.add(active.grid.index(commander.cellX, commander.cellY));
      const guarded = rescueProgress(progress, stage, -visitedCells.size, snapshot.tick, combat);
      progress = guarded.next;
      if (guarded.stalled) {
        blocked = `No newly reached cell or observed combat for 200 ticks at ${stage}`;
        write("reachable-frontier", rescueFrontier(active.grid, point(commander), currentGoals, obstacles, threats, ownRange, position(commander)));
        return;
      }
      if (snapshot.tick === initialTick) {
        assert.equal(stage, "support-trip8");
        write("planner-preflight", { tick: snapshot.tick, stage, lives, goals: currentGoals, route: route ?? null, threats, retainedIntent: intent });
        if (route) {
          assert.ok(route.waypoint.x !== commander.cellX || route.waypoint.y !== commander.cellY);
          emit("planner-preflight", { stage, goal: route.goal, waypoint: route.waypoint, retainedIntent: intent });
        }
      }
      if (intent && commander.activity === "move" && snapshot.tick - lastMovementTick < 60 &&
        rescuePathSafe(position(commander), rescueRemainingPath(intent.publicPath, point(commander)), threats)) return;
      if (target && !pressured) {
        if (commander.activity !== "attack" || commander.targetId !== target.id) {
          if (order(commander, point(target), "assault", target)) intent = undefined;
        }
        return;
      }
      if (stage === "await-source-win") return;
      const goals = currentGoals;
      if (goals.some(goal => goal.x === commander.cellX && goal.y === commander.cellY)) {
        return;
      }
      if (route && rescuePathSafe(position(commander), route.publicPath.slice(1), threats) && order(commander, route.waypoint, "move")) {
        intent = { waypoint: route.waypoint, publicPath: route.publicPath, stage };
        emit("route", { stage, goal: route.goal, waypoint: route.waypoint, publicPath: route.publicPath, threats });
        return;
      }
      blocked = `No safe public route or health-winning visible assault at ${stage}`;
      write("reachable-frontier", rescueFrontier(active.grid, point(commander), currentGoals, obstacles, threats, ownRange, position(commander)));
      emit("blocked", { commander, threats, goals, stageSince, lastMovementTick });
    };
    phase("play");
    const playStarted = performance.now();
    active.resetClock(); active.update(0);
    while (performance.now() - playStarted < 290000 - priorPlayMs) {
      steppingMs = performance.now() - playStarted;
      const tick = active.simulation.snapshot.tick;
      if (active.missionDiagnostic) { blocked = active.missionDiagnostic; break; }
      if (active.missionOutcome?.resultCode === 1 || active.missionOutcome?.ready) break;
      if (!active.missionOutcome) plan();
      if (blocked) break;
      active.update(++clock * 50);
      for (const event of active.simulation.combatEvents) if (event.tick >= tick && event.attackerId === 52) {
        emit("commander-shot", event);
      }
      if (intent && active.simulation.snapshot.tick === tick + 1) {
        const moving = active.simulation.checkpoint().units.find(actor => actor.id === 52);
        if (moving?.activity === "move" && moving.path.length) {
          const actualPath = moving.path.slice(moving.pathIndex);
          if (JSON.stringify(intent.publicPath) !== JSON.stringify(actualPath)) {
            emit("engine-path", { actorId: 52, waypoint: intent.waypoint, path: actualPath });
            intent = { ...intent, publicPath: actualPath };
          }
        }
      }
      const journal = active.campaignJournal;
      for (const entry of rescueJournalUpdates(journal, lastJournal)) {
        for (const id of entry.fired) if (!fired.has(id)) {
          fired.add(id);
          emit("source-trigger", { id, entry });
          lives = { ...active.campaignSnapshot!.controller.runtime.lives };
          if (id === 17 || id === 18) validateCommanders(active.checkpoint());
        }
        lastJournal = Math.max(lastJournal, entry.cycleCounter);
      }
      if (active.missionOutcome?.resultCode === 0 && !pending) {
        pending = true; checkpoint("pending-win"); emit("pending-win", active.missionOutcome);
      }
      const currentTick = active.simulation.snapshot.tick;
      if (currentTick % 100 === 0) { checkpoint(); write("latest", summary()); emit("progress", summary()); }
      if (currentTick === tick && !active.missionOutcome) { blocked = "Simulation stopped advancing"; break; }
    }
    steppingMs = performance.now() - playStarted;
    if (!active.missionOutcome) {
      active.replaceSelection([52]); active.stopSelected(); commands++;
      emit("stop", { actorId: 52, reason: blocked ?? "Play budget exhausted", pendingBeforeNextUpdate: true });
    }
    checkpoint();
    const result = { ...summary(), status: active.missionOutcome?.resultCode === 1 ? "SOURCE_LOSS" :
      active.missionOutcome?.ready && active.missionOutcome.resultCode === 0 ? "SOURCE_WIN_PROOF_PENDING" : "BLOCKED",
      blocked: blocked ?? (!active.missionOutcome?.ready ? "Play budget exhausted" : null),
      initialMs: playStarted - started, totalMs: performance.now() - started, exactFinalReplay: false };
    Object.assign(result, { cumulativeInitialMs: priorInitialMs + playStarted - started,
      cumulativePlayMs: priorPlayMs + steppingMs });
    write("result", result); emit("result", result);
  } catch (error) {
    write("failure", { stage, message: error instanceof Error ? error.stack : String(error), elapsedMs: performance.now() - started });
    throw error;
  } finally {
    const after = fingerprints();
    const changed = Object.keys(before).filter(path => before[path] !== after[path]);
    const changedAssets = Object.keys(fetched).filter(path => fetched[path] !== sha256(read(`public${path}`)));
    const inputUnchanged = originalInputHash === sha256(readFileSync(inputPath));
    write("integrity", { changed, changedAssets, inputUnchanged, before, after });
    view?.dispose(); renderer.dispose(); globalThis.fetch = originalFetch;
    assert.deepEqual(changed, []); assert.deepEqual(changedAssets, []); assert.ok(inputUnchanged);
  }
}

async function supervise(output: string, proofDirectory?: string) {
  mkdirSync(output, { recursive: true });
  const started = Date.now();
  const child = fork(fileURLToPath(import.meta.url), ["--worker", `--output=${output}`,
    ...(proofDirectory ? [`--proof=${proofDirectory}`] : [])], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
  let phase = proofDirectory ? "proof" : "initialize", expired = false;
  let timer = setTimeout(() => { expired = true; child.kill("SIGKILL"); }, proofDirectory ? 900000 : 500000 - priorInitialMs);
  writeFileSync(`${output}/launch.json`, JSON.stringify({ supervisorPid: process.pid, childPid: child.pid, started }));
  child.on("message", message => {
    if (message && typeof message === "object" && "phase" in message && message.phase === "play") {
      phase = "play"; clearTimeout(timer);
      timer = setTimeout(() => { expired = true; child.kill("SIGKILL"); }, 300000 - priorPlayMs);
    }
  });
  const exit = await new Promise<{ code: number | null; signal: string | null }>(resolve =>
    child.once("exit", (code, signal) => resolve({ code, signal })));
  clearTimeout(timer);
  const receipt = { ...exit, phase, expired, reaped: true, supervisorPid: process.pid, childPid: child.pid, elapsedMs: Date.now() - started };
  writeFileSync(`${output}/exit.json`, JSON.stringify(receipt)); console.log(JSON.stringify({ output, ...receipt }));
  if (exit.code !== 0 || expired) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = process.argv.find(argument => argument.startsWith("--output="))?.slice(9) ?? `/tmp/dc-al05-rescue-${Date.now()}`;
  const proofDirectory = process.argv.find(argument => argument.startsWith("--proof="))?.slice(8);
  if (process.argv.includes("--worker")) await attempt(output, proofDirectory);
  else await supervise(output, proofDirectory);
}
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadReleaseMission, savedView } from "./fixtures/release-mission";
import { MissionView } from "../../src/mission-view";
import { parseTriggerScript } from "../extractors/data/triggers";
import { installSourceRender } from "./fixtures/source-render";
import { areHostile } from "../../src/engine/diplomacy";
import { findPath } from "../../src/engine/pathfinding";
import { sourceScenarioUpgradeLevels } from "../../src/engine/legacy-balance";
import { NavigationGrid, type GridPoint } from "../../src/engine/grid";
import { mission03TripCells, mission03Status, sha256 } from "./mission03-playthrough";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
export type Faction04 = "human" | "alien";
export const mission04Range = (left: GridPoint, right: GridPoint) => Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
export function mission04EconomyBlocker(input: { depot: boolean; collectors: number; credits: number; collectorCost: number; aircraft: number; earned: number }) {
  return input.depot && input.collectors === 0 && input.credits < input.collectorCost && input.aircraft === 0 && input.earned === 0;
}
export function mission04SafeRoute(grid: NavigationGrid, start: GridPoint, goals: readonly GridPoint[],
  obstacles: ReadonlySet<number>, hazards: readonly (GridPoint & { range: number })[], air = false) {
  const blocked = new Set(obstacles);
  for (let index = 0; index < grid.costs.length; index++) {
    const cell = grid.point(index);
    if (hazards.some(hazard => mission04Range(cell, hazard) < Math.min(mission04Range(start, hazard), hazard.range + 1))) blocked.add(index);
  }
  for (const goal of [...goals].sort((left, right) => mission04Range(start, left) - mission04Range(start, right))) {
    const path = findPath(grid, start, goal, { blocked });
    if (!path) continue;
    for (let offset = Math.min(12, path.length - 1); offset > 0; offset--) {
      const waypoint = path[offset];
      let publicPath = findPath(grid, start, waypoint, { blocked: obstacles });
      if (air) {
        const direct = [start];
        let cell = start;
        while (cell.x !== waypoint.x || cell.y !== waypoint.y) {
          cell = { x: cell.x + Math.sign(waypoint.x - cell.x), y: cell.y + Math.sign(waypoint.y - cell.y) };
          direct.push(cell);
        }
        publicPath = direct;
      }
      if (publicPath && publicPath.slice(1).every(cell => !blocked.has(grid.index(cell.x, cell.y)))) return { waypoint, path, publicPath };
    }
  }
  return undefined;
}

export function mission04Partition(previous: readonly number[], troops: readonly { id: number; cellX: number; cellY: number }[], home: GridPoint) {
  const guards = previous.filter(id => troops.some(actor => actor.id === id)).slice(0, 2);
  const nearest = [...troops].sort((left, right) => Math.hypot(left.cellX - home.x, left.cellY - home.y) -
    Math.hypot(right.cellX - home.x, right.cellY - home.y) || left.id - right.id);
  for (const actor of nearest) if (guards.length < 2 && !guards.includes(actor.id)) guards.push(actor.id);
  return { guards, raid: troops.filter(actor => !guards.includes(actor.id)).map(actor => actor.id) };
}

export function mission04Limits(stepMs = 600000, maxTicks = 40000) {
  assert.ok(Number.isSafeInteger(stepMs) && stepMs > 0 && stepMs <= 600000);
  assert.ok(Number.isSafeInteger(maxTicks) && maxTicks > 0 && maxTicks <= 60000);
  return { stepMs, maxTicks, restoreMs: 900000 };
}

export function mission04BudgetStatus(elapsedMs: number, budgetMs: number, status: string) {
  return elapsedMs > budgetMs ? "HARNESS_BUDGET_EXCEEDED" : status;
}

export function inspectMission04(mission: MissionView["mission"]) {
  const faction = mission.faction;
  assert.equal(mission.scenario.id.toUpperCase(), `${faction.toUpperCase()}04`);
  assert.equal(mission.runtimeProfile, "browser-adapted");
  assert.equal(mission.sourceNativeCombat, undefined);
  const stem = `raw_cd/DC/SCENARIO/${faction.toUpperCase()}/${faction.toUpperCase()}04`;
  const sources = Object.fromEntries(["SCN", "TRO", "MAP", "MTG", "PTH"].map(extension => [extension, sha256(read(`${stem}.${extension}`))]));
  assert.equal(mission.scenario.source.sha256, sources.SCN);
  assert.deepEqual(mission.triggers, parseTriggerScript(read(`${stem}.TRO`).toString()));
  const enemyTeam = faction === "human" ? 2 : 1;
  const city = mission.triggers.find(block => block.id === (faction === "human" ? 8 : 9))!;
  assert.equal(city.condition, `((b(${enemyTeam},0)==0)&&(b(${enemyTeam},1)==0)&&(b(${enemyTeam},2)==0)&&(b(${enemyTeam},3)==0)&&(b(${enemyTeam},4)==0))`);
  const rescue = mission.triggers.find(block => block.id === (faction === "human" ? 6 : 10))!;
  assert.deepEqual(rescue.actions.find(action => action.name === "reinforce2")!.arguments.slice(0, 5),
    faction === "human" ? [1, 6, 29, 72, 1] : [4, 6, 5, 69, 1]);
  const extraction = mission.triggers.find(block => block.id === (faction === "human" ? 7 : 11))!;
  assert.deepEqual(extraction.actions.find(action => action.name === "abduct")!.arguments, faction === "human" ? [1, 1] : [4, 1]);
  const mtg = read(`${stem}.MTG`);
  const trips = Object.fromEntries((faction === "human" ? [6, 7] : [13, 16]).map(id => [id,
    mission03TripCells(mtg.subarray(2), mtg[0], mtg[1], id)]));
  for (const id of faction === "human" ? [6, 7] : [16]) assert.ok(trips[id].length);
  return { faction, enemyTeam, sources, sourceHash: sha256(JSON.stringify(mission)), trips,
    briefing: mission.briefing?.plainText, triggers: mission.triggers };
}

export async function preflight04(faction: Faction04, output: string) {
  mkdirSync(output, { recursive: true });
  const renderer = installSourceRender();
  renderer.setEnabled(false);
  const originalFetch = globalThis.fetch;
  let view: MissionView | undefined;
  globalThis.fetch = async input => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    return new Response(read(`public${path}`));
  };
  try {
    const mission = await loadReleaseMission(faction, 4);
    const contract = inspectMission04(mission);
    view = new MissionView(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
    await view.initialize();
    assert.equal(view.missionDiagnostic, undefined);
    const obstacles = new Set(view.simulation.staticObstacleCells.map(cell => view!.grid.index(cell.x, cell.y)));
    const hazards = view.campaignSnapshot!.world.entities.filter(actor => [41, 42].includes(actor.unitType) && actor.team !== 0 &&
      mission.scenario.teams[0].allies[actor.team] !== 1).map(actor => {
        const stat = mission.units.find(stat => stat.index === actor.unitType)!;
        const levels = sourceScenarioUpgradeLevels(mission.scenario.teams[actor.team], actor.unitType);
        return { x: actor.tileX, y: actor.tileY, range: mission.weapons.find(weapon => weapon.id === stat.weapons[levels.weaponLevel])!.range };
      });
    const start = faction === "alien" ? { x: 73, y: 58 } : { x: 55, y: 11 };
    const route = mission04SafeRoute(view.grid, start, contract.trips[faction === "alien" ? 16 : 6], obstacles, hazards);
    const aircraft = view.simulation.snapshot.units.find(actor => actor.team === 0 && actor.movementPlane === "air");
    const airGrid = new NavigationGrid(view.grid.width, view.grid.height, new Uint16Array(view.grid.costs.length).fill(1));
    const airRoute = aircraft && faction === "alien" ? mission04SafeRoute(airGrid, { x: aircraft.cellX, y: aircraft.cellY }, contract.trips[16], new Set(), hazards, true) : undefined;
    writeFileSync(`${output}/${faction}-route.json`, JSON.stringify({ start, hazards, route: route ?? null, airRoute: airRoute ?? null }));
    writeFileSync(`${output}/${faction}-preflight.json`, JSON.stringify({ contract, scenario: mission.scenario,
      world: view.campaignSnapshot!.world, bindings: view.nativeBindings, simulation: view.simulation.snapshot,
      menu: view.productionMenu, resources: view.resourceSources }));
    console.log(JSON.stringify({ faction, output, briefing: contract.briefing, trips: contract.trips,
      teams: mission.scenario.teams, units: view.simulation.snapshot.units }));
  } finally { view?.dispose(); renderer.dispose(); globalThis.fetch = originalFetch; }
}

type Checkpoint04 = ReturnType<MissionView["checkpoint"]>;
interface Saved04 { sourceHash: string; view: Checkpoint04 }

function runtimeHashes04() {
  const paths = readdirSync(new URL("src/", root), { recursive: true }).map(String)
    .filter(path => path.endsWith(".ts")).map(path => `src/${path}`);
  paths.push("tools/qa/fixtures/browser-campaign-playthrough.ts", "tools/qa/mission03-playthrough.ts");
  return Object.fromEntries(paths.sort().map(path => [path, sha256(read(path))]));
}

export async function runMission04(faction: Faction04, output: string, limits = mission04Limits(), proofDirectory?: string) {
  mkdirSync(output, { recursive: true });
  const beforeHashes = runtimeHashes04(), started = performance.now();
  const renderer = installSourceRender(); renderer.setEnabled(false);
  const originalFetch = globalThis.fetch, fetched: Record<string, string> = {};
  let view: MissionView | undefined;
  const write = (name: string, value: unknown) => writeFileSync(`${output}/${name}.json`, JSON.stringify(value));
  const emit = (kind: string, data: unknown) => appendFileSync(`${output}/journal.jsonl`, `${JSON.stringify({ kind,
    tick: view?.simulation.snapshot.tick ?? 0, elapsedMs: Math.round(performance.now() - started), data })}\n`);
  const phase = (name: string) => { process.send?.({ phase: name }); emit("phase", name); };
  globalThis.fetch = async input => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    const bytes = read(`public${path}`); fetched[path] = sha256(bytes);
    return new Response(bytes);
  };
  let result: Record<string, unknown> = { status: "RUNTIME_BLOCKER" };
  try {
    const mission = await loadReleaseMission(faction, 4, savedView(proofDirectory && `${proofDirectory}/pending-win.json`));
    const contract = inspectMission04(mission);
    write("source", { ...contract, limits, runtimeHashes: beforeHashes,
      limitation: "Original-script browser-adapted MissionView with QA NullCanvas; not native parity or browser visual evidence." });
    const make = (saved?: Checkpoint04) => saved
      ? MissionView.restore(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission, saved)
      : new MissionView(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
    const prove = async (pending: Saved04, ready: Saved04) => {
      phase("proof"); const proofStart = performance.now();
      assert.equal(pending.sourceHash, contract.sourceHash); assert.equal(ready.sourceHash, contract.sourceHash);
      view?.dispose(); view = undefined;
      const restored = make(JSON.parse(JSON.stringify(pending.view))); view = restored;
      assert.deepEqual(restored.checkpoint(), pending.view);
      await restored.initialize();
      assert.equal(restored.missionOutcome?.resultCode, 0); assert.equal(restored.missionOutcome?.ready, false);
      restored.resetClock(); restored.update(0);
      const ticks = ready.view.simulation.tick - pending.view.simulation.tick;
      assert.ok(ticks > 0 && ticks <= 1000);
      for (let offset = 1; offset <= ticks; offset++) {
        restored.update(offset * 50); assert.equal(restored.missionDiagnostic, undefined);
      }
      assert.equal(restored.missionOutcome?.ready, true); assert.equal(restored.missionOutcome?.resultCode, 0);
      const actual = restored.checkpoint(); assert.deepEqual(actual, ready.view);
      const proof = { exactCheckpoint: true, fromTick: pending.view.simulation.tick, toTick: ready.view.simulation.tick,
        expectedHash: sha256(JSON.stringify(ready.view)), actualHash: sha256(JSON.stringify(actual)),
        sourceHash: contract.sourceHash, restoreMs: Math.round(performance.now() - proofStart) };
      write("proof", proof); emit("pending-to-ready-exact", proof);
    };
    if (proofDirectory) {
      await prove(JSON.parse(readFileSync(`${proofDirectory}/pending-win.json`, "utf8")),
        JSON.parse(readFileSync(`${proofDirectory}/checkpoint.json`, "utf8")));
      result = { ...JSON.parse(readFileSync(`${proofDirectory}/play-result.json`, "utf8")),
        status: "WIN", exactCheckpoint: true, proofDirectory, sourceHash: contract.sourceHash };
    } else {
      view = make(); await view.initialize(); assert.equal(view.missionDiagnostic, undefined);
      const active = view, initial = active.campaignSnapshot!;
      const sourceEntities = initial.world.entities.map(actor => ({ key: actor.key, type: actor.unitType,
        team: actor.team, x: actor.tileX, y: actor.tileY, hp: actor.health }));
      const goals = sourceEntities.filter(actor => actor.team === contract.enemyTeam && actor.key.startsWith("colony:") && actor.type !== 81);
      const finalScouts = sourceEntities.filter(actor => actor.team === 2).map(actor => ({ x: actor.x, y: actor.y }));
      write("initial", { sourceEntities, goals, finalScouts, trips: contract.trips, scenario: mission.scenario,
        simulation: active.simulation.snapshot, menu: active.productionMenu, resources: active.resourceSources,
        statistics: active.missionStatistics, buildingSlots: initial.world.buildingSlots });
      const point = (actor: { cellX: number; cellY: number }) => ({ x: actor.cellX, y: actor.cellY });
      const distance = (left: GridPoint, right: GridPoint) => Math.hypot(left.x - right.x, left.y - right.y);
      const homeRow = mission.scenario.teams[0].coordinateRows[1];
      const home = { x: homeRow[0] + 5, y: homeRow[1] + 3 };
      const airGrid = new NavigationGrid(active.grid.width, active.grid.height, new Uint16Array(active.grid.costs.length).fill(1));
      const fired = new Set<number>(), chain: unknown[] = [];
      const signatures = new Map<number, { value: string; tick: number }>();
      let seenJournal = 0, commands = 0, purchases = 0, spent = 0, shots = 0, deaths = 0, clock = 0;
      let pending: Saved04 | undefined, diagnostic: string | undefined, lastProgress = "";
      let scoutIndex = 0, guards: number[] = [], lastHealthySave = -1;
      let routeFailures = 0, strategyBlocker: string | undefined;
      const order = (actorId: number, destination: GridPoint, mode: "move" | "assault", purpose: string) => {
        const tick = active.simulation.snapshot.tick, value = JSON.stringify({ destination, mode, purpose });
        const previous = signatures.get(actorId);
        if (previous?.value === value && tick - previous.tick < 200) return;
        active.replaceSelection([actorId]); assert.deepEqual(active.selectedIds, [actorId]);
        active.setCameraCenter(destination.x + 0.5, destination.y + 0.5); active.setOrderMode(mode);
        const camera = active.cameraView, bounds = active.canvas.getBoundingClientRect(), scale = 512 / camera.width;
        const clientX = bounds.left + (destination.x + 0.5 - camera.x) * scale * bounds.width / 512;
        const clientY = bounds.top + (226 - (destination.y + 0.5 - camera.y - camera.height / 2) * scale) * bounds.height / 452;
        const visible = Boolean(active.visibility[destination.y * active.grid.width + destination.x]);
        if (mode === "assault") assert.ok(visible, "Direct attacks require current visibility");
        const cursor = active.cursorAt(clientX, clientY);
        if (cursor === "blocked") { emit("blocked-command", { actorId, destination, mode, purpose }); return; }
        active.commandAt(clientX, clientY); commands++; signatures.set(actorId, { value, tick });
        emit("command", { calls: ["replaceSelection", "setCameraCenter", "setOrderMode", "commandAt"], actorId,
          destination, mode, purpose, cursor, visible, clientX, clientY });
      };
      const observe = () => {
        const campaign = active.campaignSnapshot!, snapshot = active.simulation.snapshot;
        const journal = active.campaignJournal;
        for (; seenJournal < journal.length; seenJournal++) {
          const entry = journal[seenJournal];
          for (const id of entry.fired) fired.add(id);
          if (entry.fired.length || entry.requests.some(request => request.type === "remove-noncombat")) {
            chain.push(entry); emit("source-entry", entry);
          }
        }
        const bindings = new Map(active.nativeBindings.map(binding => [binding.key, binding.simulationId]));
        const types = new Map(campaign.world.entities.map(actor => [bindings.get(actor.key), actor.unitType]));
        const owned = snapshot.units.filter(actor => active.isOwnedUnit(actor.id) && actor.health > 0 && actor.activity !== "die");
        const enemies = [...snapshot.units, ...snapshot.staticTargets].filter(actor => actor.health > 0 && actor.team !== undefined &&
          actor.team >= 0 && actor.team < 8 && active.visibility[actor.cellY * active.grid.width + actor.cellX] &&
          areHostile({ faction, team: 0 }, actor, snapshot.teamAlliances));
        const summary = { tick: snapshot.tick, fired: [...fired], outcome: active.missionOutcome, diagnostic: active.missionDiagnostic,
          buildingSlots: campaign.world.buildingSlots, statistics: active.missionStatistics,
          credits: active.resourceWorkflow.credits[0], earned: active.browserEconomyState?.earned[0], commands, purchases, spent, shots, deaths,
          owned: owned.map(actor => ({ id: actor.id, type: types.get(actor.id), hp: actor.health, x: actor.cellX, y: actor.cellY, activity: actor.activity })),
          visibleEnemies: enemies.map(actor => ({ id: actor.id, type: types.get(actor.id), hp: actor.health, team: actor.team, x: actor.cellX, y: actor.cellY })) };
        write("latest", summary);
        const signature = JSON.stringify([summary.fired, summary.buildingSlots, summary.outcome, owned.length]);
        if (signature !== lastProgress || snapshot.tick % 500 === 0) { emit("progress", summary); lastProgress = signature; }
        return { campaign, snapshot, types, owned, enemies, summary };
      };
      const plan = () => {
        const state = observe();
        const commander = state.owned.find(actor => [69, 70, 71, 72, 73, 74, 75, 76].includes(state.types.get(actor.id)!));
        const collectors = state.owned.filter(actor => [6, 14].includes(state.types.get(actor.id)!));
        const troops = state.owned.filter(actor => actor !== commander && !collectors.includes(actor) &&
          mission.units.find(stat => stat.index === state.types.get(actor.id))?.weapons.some(id => id >= 0));
        const partition = mission04Partition(guards, troops.filter(actor => actor.movementPlane !== "air"), home);
        guards = partition.guards;
        for (const collector of collectors) {
          if (active.browserEconomyState?.orders.some(order => order.simulationId === collector.id)) continue;
          const resource = active.resourceSources.filter(source => source.status === 1 && (source.remaining ?? 0) > 0 &&
            (source.rate ?? 0) > 0 && active.visibility[(source.position.y >> 8) * active.grid.width + (source.position.x >> 8)])
            .sort((left, right) => distance(point(collector), { x: left.position.x >> 8, y: left.position.y >> 8 }) -
              distance(point(collector), { x: right.position.x >> 8, y: right.position.y >> 8 }))[0];
          if (resource) {
            active.replaceSelection([collector.id]); const accepted = active.harvestSelected(resource.slot); commands++;
            emit("harvest", { calls: ["replaceSelection", "harvestSelected"], actorId: collector.id, slot: resource.slot, visible: true, accepted });
          }
        }
        const depotReached = faction === "human" || fired.has(16);
        const collectorCost = active.productionMenu.find(choice => choice.dependency === (faction === "human" ? 7 : 21))?.cost;
        if (faction === "alien" && collectorCost !== undefined && mission04EconomyBlocker({ depot: fired.has(18),
          collectors: collectors.length, credits: state.summary.credits, collectorCost,
          aircraft: troops.filter(actor => actor.movementPlane === "air").length, earned: state.summary.earned ?? 0 })) {
          strategyBlocker = "Depot committed 3 credits; no collector, earned income or surviving aircraft; collector costs 1500";
          emit("strategy-blocker", { reason: strategyBlocker, summary: state.summary, production: active.productionMenu });
          return;
        }
        const artilleryType = faction === "human" ? 3 : 11;
        const priorities = !collectors.length ? [faction === "human" ? 7 : 21]
          : troops.filter(actor => state.types.get(actor.id) === artilleryType).length < 3 ? [faction === "human" ? 12 : 26]
          : [faction === "human" ? 9 : 23];
        const choice = active.productionMenu.find(choice => priorities.includes(choice.dependency) && choice.enabled && !choice.pending && !choice.queued);
        const dependency = choice?.dependency;
        if (depotReached && troops.length < 18 && choice && dependency !== undefined && active.resourceWorkflow.credits[0] >= choice.cost) {
          const before = active.resourceWorkflow.credits[0], accepted = active.purchaseProduction(dependency);
          emit("purchase", { call: "purchaseProduction", dependency, before, cost: choice.cost, accepted });
          if (accepted) { purchases++; spent += choice.cost; }
        }
        if (depotReached && collectors.length && !choice) {
          const construction = active.constructionMenu.find(option => "slot" in option && option.slot === 2 && option.requestEnabled);
          if (construction && "cost" in construction) {
            const accepted = active.purchaseConstruction(construction.dependency);
            emit("construction", { call: "purchaseConstruction", ...construction, accepted });
            if (accepted) { purchases++; spent += construction.cost; }
          }
        }
        const blocked = new Set(active.simulation.staticObstacleCells.map(cell => active.grid.index(cell.x, cell.y)));
        const advance = (actor: typeof troops[number], destination: GridPoint, purpose: string, scouting = false) => {
          const stat = mission.units.find(stat => stat.index === state.types.get(actor.id))!;
          if (!stat) return;
          const levels = sourceScenarioUpgradeLevels(mission.scenario.teams[0], stat.index);
          const weapon = mission.weapons.find(weapon => weapon.id === stat.weapons[levels.weaponLevel]);
          const routeBlocked = new Set(blocked);
          if (scouting) {
            const hazards = sourceEntities.filter(source => [41, 42].includes(source.type) && source.team !== 0 &&
              mission.scenario.teams[0].allies[source.team] !== 1 && state.campaign.world.entities.some(current => current.key === source.key && current.health > 0))
              .map(source => {
                const hazardStat = mission.units.find(stat => stat.index === source.type)!;
                const hazardLevels = sourceScenarioUpgradeLevels(mission.scenario.teams[source.team], source.type);
                return { x: source.x, y: source.y, range: mission.weapons.find(weapon => weapon.id === hazardStat.weapons[hazardLevels.weaponLevel])!.range };
              });
            const air = actor.movementPlane === "air";
            const route = mission04SafeRoute(air ? airGrid : active.grid, point(actor), [destination], air ? new Set() : blocked, hazards, air);
            if (route) { routeFailures = 0; order(actor.id, route.waypoint, "move", purpose); }
            else { routeFailures++; emit("route-blocked", { actorId: actor.id, destination, purpose, hazards, routeFailures }); }
            return;
          }
          const attackable = (enemy: typeof state.enemies[number]) => {
            const target = mission.units.find(stat => stat.index === state.types.get(enemy.id));
            return weapon && weapon.rawPrefix !== undefined && target && target.targetClass !== undefined &&
              (mission.damageMatrix?.[weapon.rawPrefix]?.[target.targetClass] ?? 0) > 0;
          };
          const defending = purpose === "base-guard" || purpose === "commander-base-guard";
          if (defending && distance(point(actor), home) > 8) {
            const route = findPath(active.grid, point(actor), home, { blocked });
            if (route?.length) order(actor.id, route[Math.min(12, route.length - 1)], "move", purpose);
            return;
          }
          const nearby = state.enemies.filter(enemy => (!defending || distance(point(enemy), home) <= 10) &&
            mission04Range(point(actor), point(enemy)) <= Math.max(9, weapon?.range ?? 0) && attackable(enemy))
            .sort((left, right) => mission04Range(point(actor), point(left)) - mission04Range(point(actor), point(right)) || left.health - right.health)[0];
          if (nearby && weapon) {
            if ((Math.abs(actor.xSubcells - nearby.xSubcells) + Math.abs(actor.ySubcells - nearby.ySubcells)) / 1024 <= weapon.range) {
              if (actor.activity !== "attack" || actor.targetId !== nearby.id) order(actor.id, point(nearby), "assault", "visible-threat");
              return;
            }
            const radius = Math.ceil(weapon.range), candidates: { target: GridPoint; route: readonly GridPoint[] }[] = [];
            for (let offsetY = -radius; offsetY <= radius; offsetY++) for (let offsetX = -radius; offsetX <= radius; offsetX++) {
              if (Math.abs(offsetX) + Math.abs(offsetY) > weapon.range) continue;
              const target = { x: nearby.cellX + offsetX, y: nearby.cellY + offsetY };
              if (!active.grid.contains(target.x, target.y)) continue;
              if (state.owned.some(other => other.id !== actor.id && distance(point(other), target) < 1)) continue;
              const route = actor.movementPlane === "air" ? [point(actor), target] : findPath(active.grid, point(actor), target, { blocked });
              if (route?.length) candidates.push({ target, route });
            }
            candidates.sort((left, right) => distance(point(actor), left.target) - distance(point(actor), right.target) || left.route.length - right.route.length);
            const route = candidates[0]?.route;
            if (route) order(actor.id, route[Math.min(7, route.length - 1)], "move", "source-firing-position");
            return;
          }
          if (!defending && actor.activity === "attack" && state.enemies.some(enemy => enemy.id === actor.targetId && attackable(enemy))) return;
          if (distance(point(actor), destination) < (purpose.startsWith("actual-commander") ? 0.1 : 2)) return;
          if (actor.movementPlane === "air") { order(actor.id, destination, "move", purpose); return; }
          const candidates = Array.from({ length: 81 }, (_, index) => ({ x: destination.x + index % 9 - 4,
            y: destination.y + Math.floor(index / 9) - 4 })).sort((left, right) => distance(left, destination) - distance(right, destination));
          for (const target of candidates) {
            const route = findPath(active.grid, point(actor), target, { blocked: routeBlocked });
            if (route?.length) { order(actor.id, route[Math.min(12, route.length - 1)], "move", purpose); return; }
          }
          emit("route-blocked", { actorId: actor.id, destination, purpose });
        };
        const tripId = faction === "human" ? fired.has(6) ? fired.has(7) ? undefined : 7 : 6 : fired.has(16) ? undefined : 16;
        const scout = faction === "alien" ? troops.find(actor => actor.movementPlane === "air") : commander;
        const trip = tripId !== undefined && scout ? [...contract.trips[tripId]].sort((left, right) =>
          distance(point(scout), left) - distance(point(scout), right))[0] : undefined;
        if (scout && trip) advance(scout, trip, `actual-${faction === "alien" ? "aircraft" : "commander"}-trip${tripId}`, true);
        const goal = goals.find(goal => state.campaign.world.entities.some(actor => actor.key === goal.key && actor.health > 0));
        if (!goal && faction === "alien" && finalScouts.length && state.owned.some(actor =>
          distance(point(actor), finalScouts[scoutIndex % finalScouts.length]) < 3)) scoutIndex++;
        const finalDestination = goal ?? finalScouts[scoutIndex % finalScouts.length] ?? home;
        const assembled = troops.length >= (faction === "human" ? 6 : 8) || state.snapshot.tick > 1600;
        for (const actor of troops) {
          if (actor === scout && trip) continue;
          const defend = guards.includes(actor.id) || actor.health < actor.maxHealth * 0.5 || (!depotReached && actor.movementPlane !== "air");
          const destination = defend ? home : faction === "human" && trip ? trip : !assembled && actor.movementPlane !== "air" ? home : finalDestination;
          advance(actor, destination, defend ? "base-guard" : faction === "human" && trip ? "escort-rescue" : "source-goal-scout");
        }
        if (commander && !trip) advance(commander, home, "commander-base-guard");
      };
      phase("stepping"); const stepStart = performance.now();
      active.resetClock(); active.update(0);
      while (performance.now() - stepStart < limits.stepMs - 5000 && active.simulation.snapshot.tick < limits.maxTicks) {
        if (active.missionDiagnostic || active.missionOutcome?.ready) break;
        const tick = active.simulation.snapshot.tick;
        if (!pending && tick % 50 === 0) plan();
        if (!pending && (lastHealthySave < 0 || tick - lastHealthySave >= 500) && !active.missionDiagnostic) {
          write("continuation", { sourceHash: contract.sourceHash, view: active.checkpoint() });
          lastHealthySave = tick; emit("healthy-continuation", { tick, fired: [...fired], guards });
        }
        if (strategyBlocker) break;
        if (routeFailures >= 3) { strategyBlocker = "No safe source-turret route to required trip";
          emit("strategy-blocker", { reason: strategyBlocker, routeFailures }); break; }
        active.update(clock += 50);
        shots += active.simulation.combatEvents.length; deaths += active.simulation.deathEvents.length;
        if (active.simulation.deathEvents.length) emit("deaths", active.simulation.deathEvents);
        if (active.missionOutcome?.resultCode === 0 && !active.missionOutcome.ready && !pending) {
          pending = { sourceHash: contract.sourceHash, view: active.checkpoint() };
          write("pending-win", pending); emit("pending-win", active.missionOutcome);
        }
        if (active.simulation.snapshot.tick === tick && !active.missionDiagnostic && !active.missionOutcome?.ready) {
          diagnostic = "Public update did not advance simulation"; break;
        }
      }
      const steppingMs = Math.round(performance.now() - stepStart); phase("finalize");
      const final = observe(), ready: Saved04 = { sourceHash: contract.sourceHash, view: active.checkpoint() };
      write("checkpoint", ready); write("source-chain", chain);
      diagnostic ??= active.missionDiagnostic;
      const outcome = active.missionOutcome;
      result = { ...final.summary, status: mission04BudgetStatus(steppingMs, limits.stepMs,
        strategyBlocker ? "STRATEGY_BLOCKER" : mission03Status(outcome, diagnostic, false)), diagnostic, strategyBlocker, steppingMs,
        sourceHash: contract.sourceHash, sources: contract.sources, checkpointHash: sha256(JSON.stringify(ready.view)) };
      write("play-result", result);
      if (outcome?.ready && outcome.resultCode === 0 && pending && steppingMs <= limits.stepMs) {
        for (const id of faction === "human" ? [6, 7, 8] : [16, 18, 9, 10, 11]) assert.ok(fired.has(id), `Original block ${id} required`);
        for (let slot = 0; slot < 5; slot++) assert.equal(final.campaign.world.buildingSlots[`${contract.enemyTeam},${slot}`], 0);
        result.status = "READY_WIN_UNVERIFIED"; result.exactCheckpoint = false;
      }
    }
  } catch (error) {
    result = { ...result, status: "RUNTIME_BLOCKER", diagnostic: error instanceof Error ? error.stack : String(error),
      tick: view?.simulation.snapshot.tick ?? 0, outcome: view?.missionOutcome ?? null };
    emit("failure", result);
    try { if (view) write("failure-checkpoint", view.checkpoint()); } catch {}
  } finally {
    const afterHashes = runtimeHashes04();
    const changed = Object.keys(beforeHashes).filter(path => beforeHashes[path] !== afterHashes[path]);
    write("integrity", { before: beforeHashes, after: afterHashes, changed, fetched });
    if (changed.length) { result.status = "RUNTIME_CHANGED"; result.changed = changed; }
    result.totalMs = Math.round(performance.now() - started); write("result", result); emit("result", result);
    console.log(JSON.stringify({ faction, output, ...result }));
    view?.dispose(); renderer.dispose(); globalThis.fetch = originalFetch;
  }
  return result;
}

async function supervise04(faction: Faction04, output: string, limits: ReturnType<typeof mission04Limits>) {
  mkdirSync(output, { recursive: true });
  const child = fork(fileURLToPath(import.meta.url), ["--run", `--faction=${faction}`], {
    env: { ...process.env, DC_M04_WORKER: "1", DC_M04_OUTPUT: output, DC_M04_STEP_MS: String(limits.stepMs), DC_M04_MAX_TICKS: String(limits.maxTicks) },
    detached: true, stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  let phase = "initialize", expired = false, timer: ReturnType<typeof setTimeout>, phaseStarted = Date.now();
  const terminate = () => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} } };
  const arm = (next: string) => {
    if (phase === "stepping" && Date.now() - phaseStarted > limits.stepMs) {
      expired = true; terminate(); return;
    }
    clearTimeout(timer); phase = next; phaseStarted = Date.now();
    const budgetMs = phase === "stepping" ? limits.stepMs : limits.restoreMs;
    appendFileSync(`${output}/supervisor.jsonl`, `${JSON.stringify({ phase, budgetMs, childPid: child.pid, at: Date.now() })}\n`);
    timer = setTimeout(() => { expired = true; terminate(); }, budgetMs);
  };
  arm("initialize");
  child.on("message", message => { if (message && typeof message === "object" && "phase" in message &&
    ["stepping", "finalize", "proof"].includes(String(message.phase))) arm(String(message.phase)); });
  process.once("SIGTERM", terminate); process.once("SIGINT", terminate);
  const receipt = await new Promise<{ code: number | null; signal: string | null }>(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
  clearTimeout(timer!); process.removeListener("SIGTERM", terminate); process.removeListener("SIGINT", terminate);
  writeFileSync(`${output}/exit.json`, JSON.stringify({ ...receipt, expired, phase, childPid: child.pid, parentPid: process.pid }));
  return receipt;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = process.env.DC_M04_OUTPUT ?? `/tmp/dc-mission04-${Date.now()}`;
  const selected = process.argv.find(argument => argument.startsWith("--faction="))?.split("=")[1];
  assert.ok(selected === undefined || selected === "human" || selected === "alien");
  const factions: Faction04[] = selected ? [selected] : ["human", "alien"];
  const limits = mission04Limits(Number(process.env.DC_M04_STEP_MS ?? 600000), Number(process.env.DC_M04_MAX_TICKS ?? 40000));
  for (const faction of factions) {
    if (!process.argv.includes("--run")) await preflight04(faction, output);
    else if (process.env.DC_M04_WORKER) {
      const result = await runMission04(faction, output, limits, process.env.DC_M04_PROOF);
      if (result.status !== "WIN") process.exitCode = 1;
    } else {
      const receipt = await supervise04(faction, `${output}/${faction}`, limits);
      if (receipt.code !== 0) process.exitCode = 1;
    }
  }
}
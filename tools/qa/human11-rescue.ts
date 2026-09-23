import assert from "node:assert/strict";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync, type SpawnOptions, type SpawnSyncOptions } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { NavigationGrid } from "../../src/engine/grid";
import { sourceContract, hash } from "./campaign-10-12";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { areHostile } from "../../src/engine/diplomacy";
import { findPath } from "../../src/engine/pathfinding";
import type { GridPoint } from "../../src/engine/grid";
import { installSourceRender } from "./fixtures/source-render";
import { calculateLegacyDamage } from "../../src/engine/legacy-balance";

export const limits = Object.freeze({ playMs: 240000, proofMs: 600000, totalMs: 1070000 });
export const resumeLimits = Object.freeze({ restoreMs: 600000, stepMs: 180000 });

type CombatActor = Pick<ReturnType<MissionView["simulation"]["checkpoint"]>["units"][number],
  "health" | "attackCooldown" | "weapon" | "sourceDefense">;
export function fightEstimate(actor: CombatActor, enemy: CombatActor, approachTicks: number) {
  const damage = (attacker: CombatActor, defender: CombatActor) => {
    const profile = attacker.weapon?.sourceDamage;
    if (!attacker.weapon || !profile || "mode" in profile || !defender.sourceDefense) return 0;
    return calculateLegacyDamage(attacker.weapon.damage, profile, defender.sourceDefense);
  };
  const outgoing = damage(actor, enemy), incoming = damage(enemy, actor);
  const volleys = outgoing > 0 ? Math.ceil(enemy.health / outgoing) : Infinity;
  const fightTicks = actor.attackCooldown + (volleys - 1) * (actor.weapon?.cooldownTicks ?? 15) + 20;
  const enemyVolleys = 1 + Math.ceil((approachTicks + fightTicks) / (enemy.weapon?.cooldownTicks ?? 15));
  const reserve = actor.health - enemyVolleys * incoming;
  return { outgoing, incoming, volleys, approachTicks, fightTicks, enemyVolleys, reserve,
    allowed: outgoing > 0 && incoming > 0 && Number.isFinite(reserve) && reserve >= 150 };
}

export const combatDistance = (left: GridPoint, right: GridPoint) => Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
export function priorRunnerDanger(cell: GridPoint) {
  return [{ x: 66, y: 77 }, { x: 67, y: 70 }, { x: 68, y: 67 }].some(death => combatDistance(cell, death) <= 2);
}
export function verifiedWaypoint(grid: NavigationGrid, path: readonly GridPoint[], unsafe: (cell: GridPoint) => boolean) {
  for (let index = Math.min(8, path.length - 1); index > 0; index--) {
    const actual = findPath(grid, path[0], path[index]);
    if (actual && actual.slice(1).every(cell => !unsafe(cell))) return { target: path[index], actual };
  }
  return undefined;
}
export function compatibleDamage(matrix: readonly (readonly number[])[] | undefined, weaponClass: number | undefined, targetClass: number | undefined) {
  return weaponClass !== undefined && targetClass !== undefined && (matrix?.[weaponClass]?.[targetClass] ?? 0) > 0;
}
export function rangeAdvantageRetreat(ownRange: number, enemyRange: number, separation: number, health: number) {
  return ownRange > enemyRange && separation <= enemyRange + 1 && health < 700;
}
export function selectChamberRunner(actors: readonly { id: number; health: number; activity: string; type: number }[], commanderId: number) {
  return actors.filter(actor => actor.id !== commanderId && actor.health > 0 && actor.activity !== "die" && [0, 2].includes(actor.type))
    .sort((left, right) => Number(left.type !== 0) - Number(right.type !== 0) || right.health - left.health || left.id - right.id)[0]?.id;
}
export function rescueStage(kills: number, fired: ReadonlySet<number>, pending: boolean) {
  if (pending) return "protect-pending";
  if (fired.has(9)) return kills === 7 ? "protect-complete" : "finish-TORT";
  return kills === 7 || fired.has(11) ? "ordinary-trip13" : "early-trip9";
}
export function rescueRole(id: number, commanderId: number, runnerId: number | undefined, stage: ReturnType<typeof rescueStage>) {
  if (id !== commanderId && id === runnerId && (stage === "early-trip9" || stage === "ordinary-trip13")) return "runner";
  if (stage === "ordinary-trip13" || stage === "protect-pending" || stage === "protect-complete" || id === runnerId) return "guard";
  return "assault";
}
export function acceptedWin(result: { status?: string; commanderAlive?: boolean }, proof?: { status?: string; commanderAlive?: boolean; exactPending?: boolean; exactReady?: boolean; expectedHash?: string; actualHash?: string }) {
  return result.status === "READY_WIN_UNVERIFIED" && result.commanderAlive === true && proof?.status === "WIN" && proof.commanderAlive === true && proof.exactPending === true &&
    proof.exactReady === true && typeof proof.expectedHash === "string" && proof.expectedHash === proof.actualHash;
}

export function rescueContract() {
  const source = sourceContract("H11");
  const block = (id: number) => source.triggers.find(trigger => trigger.id === id)!;
  assert.equal(block(11).condition, "(s(1,3)==7)");
  assert.equal(block(12).condition, "(s(1,3)==7)");
  assert.equal(block(13).condition, "(S==0)");
  assert.ok(source.trips[9].length && source.trips[13].length);
  assert.ok(source.triggers.every(trigger => trigger.actions.every(action =>
    !["newtype", "reinforce", "reinforce2", "ally"].includes(action.name))));
  return source;
}

export function permittedAttack(owned: boolean, visible: boolean, hostile: boolean, cursor: string) {
  return owned && visible && hostile && cursor === "attack";
}

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const point = (actor: { cellX: number; cellY: number }) => ({ x: actor.cellX, y: actor.cellY });
const distance = (left: GridPoint, right: GridPoint) => Math.hypot(left.x - right.x, left.y - right.y);
const callbacks = { onStats() {}, onUnitsChanged() {} };
type Saved = { sourceHash: string; view: ReturnType<MissionView["checkpoint"]> };
type PublicOrder = { tick: number; id: number; kind: "stop" } |
  { tick: number; id: number; kind: "command"; target: GridPoint; mode: "move" | "assault"; blocked?: true };

function aimPublicOrder(view: MissionView, id: number, target: GridPoint, mode: "move" | "assault") {
  view.replaceSelection([id]); assert.deepEqual(view.selectedIds, [id]);
  view.setCameraCenter(target.x + 0.5, target.y + 0.5); view.setOrderMode(mode);
  const camera = view.cameraView, bounds = view.canvas.getBoundingClientRect(), scale = 512 / camera.width;
  const clientX = bounds.left + (target.x + 0.5 - camera.x) * scale * bounds.width / 512;
  const clientY = bounds.top + (226 - (target.y + 0.5 - camera.y - camera.height / 2) * scale) * bounds.height / 452;
  return { clientX, clientY, cursor: view.cursorAt(clientX, clientY) };
}

export function replayPublicOrder(view: Pick<MissionView, "replaceSelection" | "stopSelected">, order: Extract<PublicOrder, { kind: "stop" }>): void;
export function replayPublicOrder(view: MissionView, order: PublicOrder): void;
export function replayPublicOrder(view: Pick<MissionView, "replaceSelection" | "stopSelected">, order: PublicOrder) {
  if (order.kind === "stop") { view.replaceSelection([order.id]); view.stopSelected(); }
  else {
    const active = view as MissionView;
    const { clientX, clientY, cursor } = aimPublicOrder(active, order.id, order.target, order.mode);
    if (order.blocked) { assert.equal(cursor, "blocked"); return; }
    assert.notEqual(cursor, "blocked"); active.commandAt(clientX, clientY);
  }
}

export function runtimeHashes() {
  const paths = readdirSync(new URL("src/", root), { recursive: true }).map(String)
    .filter(path => path.endsWith(".ts")).map(path => `src/${path}`);
  return Object.fromEntries(paths.map(path => [path, hash(read(path))]));
}

export async function worker(output: string, proof: boolean, resume?: string) {
  const started = Date.now(), before = runtimeHashes(), source = rescueContract();
  const renderer = installSourceRender(), originalFetch = globalThis.fetch;
  renderer.setEnabled(false);
  const fetched: Record<string, string> = {};
  globalThis.fetch = async input => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    const bytes = read(`public${path}`); fetched[path] = hash(bytes);
    return new Response(bytes);
  };
  const write = (name: string, data: unknown) => writeFileSync(`${output}/${name}.json`, JSON.stringify(data));
  let view: MissionView | undefined;
  const emit = (kind: string, data: unknown) => appendFileSync(`${output}/${proof ? "proof-" : ""}journal.jsonl`,
    JSON.stringify({ kind, tick: view?.simulation.snapshot.tick, elapsedMs: Date.now() - started, data }) + "\n");
  let result: Record<string, unknown> = { status: "RUNTIME_BLOCKER" };
  try {
    const mission = await loadCampaignMission("human", 11, "browser-adapted");
    const sourceHash = hash(JSON.stringify(mission));
    assert.equal(mission.scenario.source.sha256, source.sources.SCN);
    assert.deepEqual(mission.triggers, source.triggers);
    write(proof ? "proof-source" : "source", { ...source, sourceHash, scenario: mission.scenario, units: mission.units,
      weapons: mission.weapons, runtimeAtWorkerEntry: before });
    if (proof) {
      const pending = JSON.parse(readFileSync(`${output}/pending-win.json`, "utf8")) as Saved;
      const ready = JSON.parse(readFileSync(`${output}/checkpoint.json`, "utf8")) as Saved;
      const postPendingOrders = JSON.parse(readFileSync(`${output}/post-pending-orders.json`, "utf8")) as PublicOrder[];
      const commanderId = JSON.parse(readFileSync(`${output}/initial.json`, "utf8")).commander as number;
      assert.equal(pending.sourceHash, sourceHash); assert.equal(ready.sourceHash, sourceHash);
      const playIntegrity = JSON.parse(readFileSync(`${output}/integrity.json`, "utf8"));
      assert.deepEqual(before, playIntegrity.before, "Proof must use the recorded play revision");
      view = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(pending.view)));
      assert.deepEqual(view.checkpoint(), pending.view);
      await view.initialize();
      assert.equal(view.missionOutcome?.ready, false); assert.equal(view.missionOutcome?.resultCode, 0);
      view.resetClock(); view.update(0);
      const ticks = ready.view.simulation.tick - pending.view.simulation.tick;
      assert.ok(ticks > 0 && ticks <= 1000);
      let replayed = 0;
      for (let offset = 1; offset <= ticks; offset++) {
        assert.ok(Date.now() - started < limits.proofMs - 10000);
        while (postPendingOrders[replayed]?.tick === view.simulation.snapshot.tick) {
          replayPublicOrder(view, postPendingOrders[replayed++]);
        }
        view.update(offset * 50); assert.equal(view.missionDiagnostic, undefined);
        assert.ok(view.simulation.snapshot.units.some(actor => actor.id === commanderId && actor.health > 0 && actor.activity !== "die"));
      }
      assert.equal(replayed, postPendingOrders.length);
      assert.deepEqual(view.checkpoint(), ready.view);
      assert.equal(view.missionOutcome?.ready, true); assert.equal(view.missionOutcome?.resultCode, 0);
      result = { status: "WIN", commanderAlive: true, exactPending: true, exactReady: true, sourceHash, replayedOrders: replayed,
        fromTick: pending.view.simulation.tick, tick: ready.view.simulation.tick,
        expectedHash: hash(JSON.stringify(ready.view)), actualHash: hash(JSON.stringify(view.checkpoint())) };
    } else {
      const savedBytes = resume ? readFileSync(resume) : undefined;
      const saved = savedBytes ? JSON.parse(savedBytes.toString()) as Saved : undefined;
      if (saved) {
        assert.equal(saved.sourceHash, sourceHash);
        emit("restore-start", { resume, checkpointHash: hash(savedBytes!) });
        view = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, saved.view);
        assert.deepEqual(view.checkpoint(), saved.view);
        assert.ok(Date.now() - started < resumeLimits.restoreMs, "Authenticated restore exceeded its allowance");
        assert.equal(view.missionOutcome, null, "Resume requires unfinished gameplay");
        write("resume", { path: resume, checkpointHash: hash(savedBytes!), exactInitial: true,
          sourceHash, tick: saved.view.simulation.tick, restoreMs: Date.now() - started });
      } else view = new MissionView(renderer.canvas(), {} as HTMLElement, callbacks, mission);
      await view.initialize(); assert.equal(view.missionDiagnostic, undefined);
      if (saved) assert.ok(Date.now() - started < resumeLimits.restoreMs, "Initialization exceeded its allowance");
      const active = view;
      const initialWorld = active.campaignSnapshot!.world;
      const bindings = new Map(active.nativeBindings.map(binding => [binding.key, binding.simulationId]));
      const types = new Map(initialWorld.entities.map(entity => [bindings.get(entity.key), entity.unitType]));
      const originalInitial = resume ? JSON.parse(readFileSync(new URL("initial.json", pathToFileURL(resume)), "utf8")) : undefined;
      const known: { key: string; id: number | undefined; team: number; type: number; x: number; y: number; health: number }[] =
        originalInitial?.known ?? initialWorld.entities.map(entity => ({ key: entity.key, id: bindings.get(entity.key), team: entity.team,
          type: entity.unitType, x: entity.tileX, y: entity.tileY, health: entity.health }));
      for (const actor of known) if (actor.id !== undefined) types.set(actor.id, actor.type);
      const victims = known.filter(entity => entity.team === 1);
      assert.equal(victims.length, 7); assert.ok(victims.every(entity => entity.type === 88));
      const initial = active.simulation.snapshot;
      const commander = initial.units.find(actor => active.isOwnedUnit(actor.id) && [69, 70, 71, 72].includes(types.get(actor.id)!))!;
      assert.ok(commander);
      assert.ok(commander.health > 0 && commander.activity !== "die");
      assert.equal(initial.teamAlliances?.[0]?.[1], 0);
      const squadIds = new Set(initial.units.filter(actor => active.isOwnedUnit(actor.id)).map(actor => actor.id));
      const blocked = new Set(active.simulation.staticObstacleCells.map(cell => active.grid.index(cell.x, cell.y)));
      const fired = new Set<number>(), lastOrders = new Map<number, { signature: string; tick: number }>();
      let commands = 0, shots = 0, deaths = 0, clock = 0, pendingSaved = false, sevenSaved = Boolean(saved);
      let runnerId = selectChamberRunner(initial.units.filter(actor => squadIds.has(actor.id))
        .map(actor => ({ ...actor, type: types.get(actor.id)! })), commander.id);
      if (saved) assert.ok(runnerId !== undefined, "No living ordinary troop; commander cannot extract");
      const postPendingOrders: PublicOrder[] = [];
      const recordOrder = (order: PublicOrder) => { if (pendingSaved) postPendingOrders.push(order); };
      const routeFailures = new Set<string>();
      const runnerWaypoints = new Map<number, GridPoint>();
      let routeObstacle: unknown;
      const route = (origin: GridPoint, target: GridPoint) => findPath(active.grid, origin, target, { blocked });
      const radiusCells = (center: GridPoint, radius: number) => {
        const extent = Math.ceil(radius), cells: GridPoint[] = [];
        for (let deltaY = -extent; deltaY <= extent; deltaY++) for (let deltaX = -extent; deltaX <= extent; deltaX++) {
          const cell = { x: center.x + deltaX, y: center.y + deltaY };
          if (combatDistance(cell, center) <= radius && active.grid.isPassable(cell.x, cell.y) && !blocked.has(active.grid.index(cell.x, cell.y))) cells.push(cell);
        }
        return cells;
      };
      const connectivity = victims.map(victim => ({ ...victim, reachable: [...squadIds].map(id => {
        const actor = initial.units.find(unit => unit.id === id)!;
        const stat = mission.units.find(stat => stat.index === types.get(id))!;
        const weapon = mission.weapons.find(weapon => weapon.id === stat.weapons[0])!;
        const cells = radiusCells(victim, weapon.range - 0.25).sort((left, right) => distance(point(actor), left) - distance(point(actor), right));
        const reachable = cells.map(cell => ({ cell, path: route(point(actor), cell) })).find(candidate => candidate.path?.length);
        return { id, weapon: weapon.id, range: weapon.range, destination: reachable?.cell, pathLength: reachable?.path?.length };
      }) }));
      write("initial", { known, simulation: initial, commander: commander.id, squad: [...squadIds], connectivity,
        statistics: active.missionStatistics, bindings: active.nativeBindings });
      emit("coordinated-original-force", { commander: commander.id, squad: [...squadIds], runnerId, strategy: "early-chamber-protected-commander" });

      const order = (id: number, target: GridPoint, mode: "move" | "assault", purpose: string, targetId?: number) => {
        assert.ok(squadIds.has(id) && active.isOwnedUnit(id));
        const snapshot = active.simulation.snapshot, tick = snapshot.tick;
        const signature = JSON.stringify({ target, mode, targetId });
        const previous = lastOrders.get(id);
        if (previous?.signature === signature && tick - previous.tick < 40) return;
        const visible = Boolean(active.visibility[target.y * active.grid.width + target.x]);
        const victim = [...snapshot.units, ...snapshot.staticTargets].find(actor => actor.id === targetId);
        const hostile = Boolean(victim && [1, 2].includes(victim.team ?? -1) && areHostile({ faction: "human", team: 0 }, victim, snapshot.teamAlliances));
        const { clientX, clientY, cursor } = aimPublicOrder(active, id, target, mode);
        if (cursor === "blocked") {
          recordOrder({ kind: "command", tick, id, target, mode, blocked: true });
          emit("blocked-command", { id, target, mode, purpose }); return;
        }
        if (mode === "assault") {
          assert.ok(permittedAttack(active.isOwnedUnit(id), visible, hostile, cursor));
          const actor = snapshot.units.find(actor => actor.id === id)!;
          const weapon = mission.weapons.find(weapon => weapon.id === mission.units.find(stat => stat.index === types.get(id))!.weapons[0])!;
          assert.ok(combatDistance(point(actor), target) <= weapon.range - 0.1);
          assert.ok(compatibleDamage(mission.damageMatrix, weapon.rawPrefix, mission.units.find(stat => stat.index === types.get(targetId!))?.targetClass));
        }
        active.commandAt(clientX, clientY); commands++; lastOrders.set(id, { signature, tick });
        recordOrder({ kind: "command", tick, id, target, mode });
        emit("command", { id, target, mode, purpose, targetId, targetTeam: victim?.team, visible, hostile, cursor, owned: true });
      };
      const stop = (id: number, purpose: string) => {
        const tick = active.simulation.snapshot.tick;
        const previous = lastOrders.get(id);
        if (previous?.signature === "stop" && tick - previous.tick < 40) return;
        const action = { kind: "stop" as const, tick, id };
        replayPublicOrder(active, action); recordOrder(action); lastOrders.set(id, { signature: "stop", tick });
        emit("public-stop", { id, purpose });
      };
      const move = (actor: typeof initial.units[number], destination: GridPoint, purpose: string) => {
        const path = route(point(actor), destination);
        if (!path?.length) {
          const key = `${actor.id}:${destination.x},${destination.y}`;
          if (!routeFailures.has(key)) { routeFailures.add(key); emit("route-blocked", { id: actor.id, destination, purpose }); }
          return false;
        }
        order(actor.id, path[Math.min(8, path.length - 1)], "move", purpose);
        return true;
      };
      const observe = () => {
        for (const entry of active.campaignJournal) for (const trigger of entry.fired) if (!fired.has(trigger)) {
          fired.add(trigger); emit("source-trigger", { trigger, entry });
        }
        const snapshot = active.simulation.snapshot;
        const summary = { tick: snapshot.tick, outcome: active.missionOutcome, diagnostic: active.missionDiagnostic,
          commands, shots, deaths, fired: [...fired], statistics: active.missionStatistics,
          commander: snapshot.units.find(actor => actor.id === commander.id),
          commanderAlive: snapshot.units.some(actor => actor.id === commander.id && actor.health > 0 && actor.activity !== "die"),
          runnerId, strategy: "early-chamber-protected-commander",
          squad: snapshot.units.filter(actor => squadIds.has(actor.id)),
          remainingVictims: snapshot.staticTargets.filter(actor => actor.team === 1),
          visibleEnemies: [...snapshot.units, ...snapshot.staticTargets].filter(actor => [1, 2].includes(actor.team ?? -1) &&
            active.visibility[actor.cellY * active.grid.width + actor.cellX]), routeFailures: [...routeFailures] };
        write("latest", summary); return summary;
      };
      const plan = () => {
        const summary = observe(), snapshot = active.simulation.snapshot;
        const squad = snapshot.units.filter(actor => squadIds.has(actor.id) && actor.health > 0 && actor.activity !== "die");
        if (!squad.length) return;
        blocked.clear();
        for (const cell of active.simulation.staticObstacleCells) blocked.add(active.grid.index(cell.x, cell.y));
        const aliveVictims = victims.filter(victim => snapshot.staticTargets.some(actor => actor.id === victim.id && actor.health > 0));
        const kills = active.missionStatistics["1,3"] ?? 0;
        const stage = rescueStage(kills, fired, Boolean(active.missionOutcome));
        if (!squad.some(actor => actor.id === runnerId)) {
          runnerId = selectChamberRunner(squad.map(actor => ({ ...actor, type: types.get(actor.id)! })), commander.id);
          emit("runner-replacement", { runnerId, stage });
        }
        const force = squad.filter(actor => actor.id !== runnerId);
        const occupied = new Set(squad.map(actor => active.grid.index(actor.cellX, actor.cellY)));
        const reserved = new Set<number>();
        const goal = aliveVictims.sort((left, right) => Math.min(...force.map(actor => distance(point(actor), left))) -
          Math.min(...force.map(actor => distance(point(actor), right))))[0];
        const leader = squad.find(actor => actor.id === commander.id) ?? squad[0];
        const visible = summary.visibleEnemies.filter(enemy => enemy.health > 0 && areHostile(leader, enemy, snapshot.teamAlliances));
        const weaponFor = (id: number) => mission.weapons.find(weapon => weapon.id === mission.units.find(stat => stat.index === types.get(id))?.weapons[0]);
        const threats = visible.filter(enemy => weaponFor(enemy.id));
        const focus = visible.filter(enemy => combatDistance(point(leader), point(enemy)) < 12 &&
          compatibleDamage(mission.damageMatrix, weaponFor(leader.id)?.rawPrefix, mission.units.find(stat => stat.index === types.get(enemy.id))?.targetClass))
          .sort((left, right) => Number(right.team === 1) - Number(left.team === 1) ||
            combatDistance(point(leader), point(left)) - combatDistance(point(leader), point(right)) || left.health - right.health)[0];
        for (const actor of squad) {
          const stat = mission.units.find(stat => stat.index === types.get(actor.id))!;
          const weapon = mission.weapons.find(weapon => weapon.id === stat.weapons[0])!;
          const compatible = visible.filter(enemy => compatibleDamage(mission.damageMatrix, weapon.rawPrefix,
            mission.units.find(stat => stat.index === types.get(enemy.id))?.targetClass));
          const dangers = threats.filter(enemy => compatibleDamage(mission.damageMatrix, weaponFor(enemy.id)?.rawPrefix, stat.targetClass));
          const exposure = (cell: GridPoint) => dangers.reduce((total, enemy) => total +
            Math.max(0, weaponFor(enemy.id)!.range + 1 - combatDistance(cell, point(enemy))) * weaponFor(enemy.id)!.damage, 0);
          const role = rescueRole(actor.id, commander.id, runnerId, stage);
          const clearVisibleBlocker = () => {
            if (actor.id === commander.id || stage !== "ordinary-trip13") return false;
            const combat = active.simulation.checkpoint().units;
            const own = combat.find(unit => unit.id === actor.id)!;
            for (const enemy of [...compatible].filter(enemy => combatDistance(point(actor), point(enemy)) <= 12)
              .sort((left, right) => combatDistance(point(actor), point(left)) - combatDistance(point(actor), point(right)))) {
              const defender = combat.find(unit => unit.id === enemy.id);
              if (!defender?.weapon) continue;
              const inRange = combatDistance(point(actor), point(enemy)) <= weapon.range - 0.1;
              const approaches = inRange ? [{ target: point(actor), actual: [point(actor)] }] :
                radiusCells(point(enemy), weapon.range - 0.25).filter(cell => !occupied.has(active.grid.index(cell.x, cell.y)))
                  .map(target => ({ target, actual: findPath(active.grid, point(actor), target) }))
                  .filter(candidate => candidate.actual && candidate.actual.every(cell =>
                    !blocked.has(active.grid.index(cell.x, cell.y)) && !dangers.some(other => other.id !== enemy.id &&
                      combatDistance(cell, point(other)) <= weaponFor(other.id)!.range + 1)))
                  .sort((left, right) => left.actual!.length - right.actual!.length);
              const approach = approaches[0];
              if (!approach?.actual) continue;
              const estimate = fightEstimate(own, defender,
                Math.ceil((approach.actual.length - 1) * 1024 / own.speedSubcellsPerTick) + 20);
              if (!estimate.allowed) continue;
              emit("calculated-fight", { id: actor.id, enemyId: enemy.id, ownHealth: actor.health, enemyHealth: enemy.health,
                ownRange: weapon.range, enemyRange: defender.weapon.rangeCells, inRange, ...estimate, approach });
              runnerWaypoints.delete(actor.id);
              if (inRange) {
                if (actor.activity !== "attack" || actor.targetId !== enemy.id)
                  order(actor.id, point(enemy), "assault", "calculated-visible-blocker", enemy.id);
              } else if (actor.activity !== "move" || own.path.at(-1)?.x !== approach.target.x || own.path.at(-1)?.y !== approach.target.y) {
                order(actor.id, approach.target, "move", "calculated-blocker-approach");
              }
              return true;
            }
            return false;
          };
          if (role === "runner") {
            const trip = stage === "early-trip9" ? 9 : 13;
            if (saved) {
              const unsafe = (cell: GridPoint) => blocked.has(active.grid.index(cell.x, cell.y)) ||
                dangers.some(enemy => combatDistance(cell, point(enemy)) <= weaponFor(enemy.id)!.range + 2);
              const movement = active.simulation.checkpoint().units.find(unit => unit.id === actor.id)!;
              const queued = movement.path.slice(movement.pathIndex);
              if (runnerWaypoints.has(actor.id) && actor.activity === "move" && queued.every(cell => !unsafe(cell))) continue;
              const avoided = new Set(blocked);
              for (let index = 0; index < active.grid.costs.length; index++) {
                const cell = active.grid.point(index);
                if (active.grid.costs[index] && unsafe(cell)) avoided.add(index);
              }
              const targets = [...source.trips[trip]].sort((left, right) => distance(point(actor), left) - distance(point(actor), right));
              const safePath = targets.map(target => findPath(active.grid, point(actor), target, { blocked: avoided }))
                .find(path => path && path.length > 1);
              const waypoint = safePath && verifiedWaypoint(active.grid, safePath, unsafe);
              if (waypoint) {
                order(actor.id, waypoint.target, "move", `ordinary-troop-source-trip${trip}`);
                runnerWaypoints.set(actor.id, waypoint.target);
                emit("verified-waypoint", { id: actor.id, from: point(actor), ...waypoint, remainingCells: safePath!.length });
              } else {
                if (clearVisibleBlocker()) continue;
                if (actor.activity === "move") stop(actor.id, "unsafe-route-stop");
                routeObstacle = { tick: snapshot.tick, id: actor.id, at: point(actor), trip,
                  reason: "No unexposed source-grid route or survivable visible-hostile exchange",
                  threats: dangers.map(enemy => ({ id: enemy.id, at: point(enemy), range: weaponFor(enemy.id)!.range })) };
                emit("safe-route-obstacle", routeObstacle);
              }
              continue;
            }
            const target = [...source.trips[trip]].sort((left, right) => distance(point(actor), left) - distance(point(actor), right))
              .find(cell => route(point(actor), cell)?.length);
            if (target) move(actor, target, `ordinary-troop-source-trip${trip}`);
            continue;
          }
          if (role === "guard") {
            if (compatible.some(enemy => combatDistance(point(actor), point(enemy)) <= weapon.range - 0.1) && clearVisibleBlocker()) continue;
            const escape = radiusCells(point(actor), 4).filter(cell =>
              !occupied.has(active.grid.index(cell.x, cell.y)) && !reserved.has(active.grid.index(cell.x, cell.y)) &&
              Boolean(active.visibility[active.grid.index(cell.x, cell.y)]))
              .sort((left, right) => exposure(left) - exposure(right) || distance(point(actor), left) - distance(point(actor), right));
            const target = escape.find(cell => exposure(cell) < exposure(point(actor)) && route(point(actor), cell)?.length);
            if (target && move(actor, target, "protected-force-retreat")) reserved.add(active.grid.index(target.x, target.y));
            else stop(actor.id, actor.id === commander.id ? "commander-safe-guard" : "survivor-safe-guard");
            continue;
          }
          const retreat = dangers.some(enemy => rangeAdvantageRetreat(weapon.range, weaponFor(enemy.id)!.range,
            combatDistance(point(actor), point(enemy)), actor.health));
          if (retreat) {
            const escape = radiusCells(point(actor), 4).filter(cell => !occupied.has(active.grid.index(cell.x, cell.y)) && !reserved.has(active.grid.index(cell.x, cell.y)))
              .sort((left, right) => exposure(left) - exposure(right) || distance(left, point(leader)) - distance(right, point(leader)))[0];
            if (escape && exposure(escape) < exposure(point(actor)) && move(actor, escape, "range-advantage-retreat")) {
              reserved.add(active.grid.index(escape.x, escape.y)); continue;
            }
          }
          const enemy = compatible.filter(enemy => combatDistance(point(actor), point(enemy)) <= weapon.range - 0.1)
            .sort((left, right) => Number(right.team === 1) - Number(left.team === 1) || left.health - right.health)[0];
          if (enemy) {
            if (actor.activity !== "attack" || actor.targetId !== enemy.id) order(actor.id, point(enemy), "assault", "visible-hostile", enemy.id);
            continue;
          }
          const straggler = goal && [...force].sort((left, right) => distance(point(right), goal) - distance(point(left), goal))[0];
          if (!focus && straggler && distance(point(actor), point(straggler)) > 6 && distance(point(actor), goal!) < distance(point(straggler), goal!)) {
            if (actor.activity === "move") stop(actor.id, "cohesion-stop");
            continue;
          }
          const destination = focus ? point(focus) : goal;
          if (!destination) continue;
          const firingCells = radiusCells(destination, weapon.range - 0.25).filter(cell =>
            !reserved.has(active.grid.index(cell.x, cell.y)) && (!occupied.has(active.grid.index(cell.x, cell.y)) || distance(cell, point(actor)) === 0))
            .sort((left, right) => exposure(left) - exposure(right) || distance(point(actor), left) - distance(point(actor), right));
          for (const cell of firingCells.slice(0, 12)) {
            if (distance(point(actor), cell) < 0.5) break;
            if (move(actor, cell, focus ? "coordinated-visible-focus" : "original-TORT-scout")) {
              reserved.add(active.grid.index(cell.x, cell.y)); break;
            }
          }
        }
      };
      active.resetClock(); active.update(0);
      const stepStarted = Date.now();
      if (saved) plan();
      while (Date.now() < (saved ? stepStarted + resumeLimits.stepMs - 15000 : started + limits.playMs - 15000) && active.simulation.snapshot.tick < 40000) {
        if (active.missionDiagnostic || active.missionOutcome?.ready) break;
        const tick = active.simulation.snapshot.tick;
        if (tick % 20 === 0) plan();
        active.update(clock += 50); shots += active.simulation.combatEvents.length; deaths += active.simulation.deathEvents.length;
        for (const event of active.simulation.combatEvents) if (squadIds.has(event.attackerId) || squadIds.has(event.targetId)) emit("damage", event);
        for (const event of active.simulation.deathEvents) emit("death", { ...event, actor: [...active.simulation.snapshot.units, ...active.simulation.snapshot.staticTargets].find(actor => actor.id === event.targetId) });
        if (tick % 200 === 0) emit("progress", observe());
        if (active.missionOutcome?.resultCode === 0 && !active.missionOutcome.ready && !pendingSaved) {
          pendingSaved = true; write("pending-win", { sourceHash, view: active.checkpoint() }); emit("pending-win", active.missionOutcome);
        }
        if (!sevenSaved && active.missionStatistics["1,3"] === 7) {
          sevenSaved = true; write("seven-kills", { sourceHash, view: active.checkpoint() }); emit("seven-kills-checkpoint", observe());
        }
        if (tick === active.simulation.snapshot.tick && !active.missionOutcome?.ready) break;
      }
      const summary = observe();
      write("checkpoint", { sourceHash, view: active.checkpoint() }); write("campaign-journal", active.campaignJournal);
      write("post-pending-orders", postPendingOrders);
      const outcome = active.missionOutcome;
      result = { ...summary, sourceHash, status: active.missionDiagnostic ? "RUNTIME_BLOCKER" : outcome?.ready ?
        outcome.resultCode === 0 ? "READY_WIN_UNVERIFIED" : "SOURCE_LOSS" : "BOUNDED_NO_WIN" };
      result.stepMs = Date.now() - stepStarted;
      if (saved) result.routeObstacle = routeObstacle;
      if (resume) assert.equal(hash(readFileSync(resume)), hash(savedBytes!), "Original checkpoint must remain unchanged");
      if (outcome?.resultCode === 0) assert.ok(fired.has(12) || fired.has(13));
    }
  } catch (error) {
    result = { status: "RUNTIME_BLOCKER", diagnostic: error instanceof Error ? error.stack : String(error),
      tick: view?.simulation.snapshot.tick, outcome: view?.missionOutcome };
    emit("failure", result);
  } finally {
    const after = runtimeHashes(), changed = Object.keys(before).filter(path => before[path] !== after[path]);
    const sourceAfter = rescueContract().sources;
    const changedAssets = Object.keys(fetched).filter(path => fetched[path] !== hash(read(`public${path}`)));
    write(proof ? "proof-integrity" : "integrity", { before, after, changed, fetched, changedAssets,
      originalBefore: source.sources, originalAfter: sourceAfter });
    result.runtimeChangedDuringRun = changed; result.changedAssets = changedAssets;
    result.elapsedMs = Date.now() - started;
    write(proof ? "proof-result" : "result", result);
    view?.dispose(); renderer.dispose(); globalThis.fetch = originalFetch;
  }
  return result;
}

export function boundedWorkerOptions(descriptor: number, budget: number): SpawnSyncOptions & Pick<SpawnOptions, "detached"> {
  return { cwd: fileURLToPath(root), stdio: ["ignore", descriptor, descriptor], detached: true, timeout: budget, killSignal: "SIGKILL" };
}

export function runOnce(output: string, resume?: string) {
  assert.equal(existsSync(output), false, "Refuse to overwrite or silently replay an existing attempt");
  mkdirSync(output, { recursive: true });
  const attemptStarted = Date.now();
  const receipts: unknown[] = [];
  const run = (proof: boolean) => {
    const prefix = proof ? "proof" : "play", budget = Math.min(
      proof ? limits.proofMs : resume ? resumeLimits.restoreMs + resumeLimits.stepMs : limits.playMs,
      limits.totalMs - (Date.now() - attemptStarted) - 2000);
    assert.ok(budget > 0);
    const beforeSpawn = runtimeHashes(), started = Date.now(), log = `${output}/${prefix}-${started}.log`;
    writeFileSync(`${output}/${prefix}-before-spawn.json`, JSON.stringify(beforeSpawn));
    const descriptor = openSync(log, "wx");
    const child = spawnSync(process.execPath, ["--import", fileURLToPath(new URL("node_modules/tsx/dist/loader.mjs", root)),
      fileURLToPath(import.meta.url), "--worker", `--output=${output}`, ...(proof ? ["--proof"] : resume ? [`--resume=${resume}`] : [])],
    boundedWorkerOptions(descriptor, budget));
    closeSync(descriptor);
    const receipt = { prefix, budget, elapsedMs: Date.now() - started, pid: child.pid, code: child.status,
      signal: child.signal, error: child.error?.message, log };
    writeFileSync(`${output}/${prefix}-exit.json`, JSON.stringify(receipt)); receipts.push(receipt);
    return child.status === 0;
  };
  const completed = run(false);
  const result = existsSync(`${output}/result.json`) ? JSON.parse(readFileSync(`${output}/result.json`, "utf8")) : { status: "HARD_PLAY_CAP" };
  if (completed && result.status === "READY_WIN_UNVERIFIED" && existsSync(`${output}/pending-win.json`)) {
    if (Date.now() - attemptStarted + limits.proofMs + 2000 < limits.totalMs) run(true);
    else writeFileSync(`${output}/proof-deferred.json`, JSON.stringify({ reason: "Full proof allowance exceeds shared total cap",
      elapsedMs: Date.now() - attemptStarted, proofMs: limits.proofMs, totalMs: limits.totalMs }));
  }
  const proof = existsSync(`${output}/proof-result.json`) ? JSON.parse(readFileSync(`${output}/proof-result.json`, "utf8")) : undefined;
  const pass = acceptedWin(result, proof) && receipts.every(receipt => (receipt as { code: number }).code === 0) &&
    result.runtimeChangedDuringRun?.length === 0 && result.changedAssets?.length === 0 &&
    proof?.runtimeChangedDuringRun?.length === 0 && proof?.changedAssets?.length === 0;
  const report = { pass, result, proof, receipts, runtimeAtSupervisorEnd: runtimeHashes() };
  writeFileSync(`${output}/run.json`, JSON.stringify(report));
  console.log(JSON.stringify({ output, pass, status: proof?.status ?? result.status, tick: result.tick, receipts }));
  process.exitCode = pass ? 0 : 1;
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const output = process.argv.find(argument => argument.startsWith("--output="))?.slice(9);
  const resume = process.argv.find(argument => argument.startsWith("--resume="))?.slice(9);
  assert.ok(output, "An explicit unique --output directory is required");
  if (process.argv.includes("--worker")) await worker(output, process.argv.includes("--proof"), resume);
  else if (process.argv.includes("--run")) {
    const preserveBoundedWorker = () => {};
    process.on("SIGINT", preserveBoundedWorker);
    try { runOnce(output, resume); } finally { process.off("SIGINT", preserveBoundedWorker); }
  }
  else throw new Error("Use --run for the single bounded attempt");
}
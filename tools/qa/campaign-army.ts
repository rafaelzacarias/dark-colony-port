// Generic public-command campaign player for CITY-clearance missions: economy, production, home guard and grouped assaults.
// Usage: --worker --mission=A11 --output=DIR --budget=MS [--proof] [--resume=checkpoint.json]; the supervisor (--run) adds a pending->ready replay proof.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadReleaseMission } from "./fixtures/release-mission";
import { mission02VisibleTarget } from "./fixtures/browser-campaign-playthrough";
import { MissionView } from "../../src/mission-view";
import { installSourceRender } from "./fixtures/source-render";
import { areHostile } from "../../src/engine/diplomacy";

type Point = { x: number; y: number };
const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const callbacks = { onStats() {}, onUnitsChanged() {} };
const COLLECTORS = new Set([6, 14]);
const COMMANDERS = new Set([69, 70, 71, 72, 73, 74, 75, 76]);
const INTERCEPTORS = new Set([4, 12]);
// TOWR 81 and beacons 84/89/95 are target class 8 with a zero coefficient: shooting them does nothing.
const ZERO_DAMAGE_TYPES = new Set([81, 84, 89, 95]);

export function parseMissionId(id: string) {
  const match = /^([HA])(\d{1,2})$/.exec(id);
  assert.ok(match, `Mission id like A11 or H07 expected: ${id}`);
  const number = Number(match[2]);
  assert.ok(number >= 1 && number <= 15);
  return { faction: match[1] === "H" ? "human" as const : "alien" as const, number };
}

/** Most expensive affordable unit, keeping collectors topped up first; surplus credits buy upgrades. */
export function chooseProduction<T extends { kind: string; unitType?: number | null; enabled: boolean; pending: number; queued: number; cost: number; dependency: number }>(
  menu: readonly T[], credits: number, collectors: number, troops: number, desiredCollectors = 2, maxTroops = 50, reserve = 0): T | undefined {
  const ready = menu.filter(choice => choice.enabled && !choice.pending && !choice.queued && choice.cost <= credits);
  const units = ready.filter(choice => choice.kind === "unit");
  const collector = units.find(choice => COLLECTORS.has(choice.unitType ?? -1));
  if (collectors < desiredCollectors && collector) return collector;
  const spendable = credits - reserve;
  const upgrade = ready.filter(choice => choice.kind === "upgrade" && choice.cost + 2000 <= spendable)
    .sort((left, right) => left.cost - right.cost || left.dependency - right.dependency)[0];
  if (upgrade && troops >= 12) return upgrade;
  if (troops >= maxTroops) return undefined;
  return units.filter(choice => !COLLECTORS.has(choice.unitType ?? -1) && choice.cost <= spendable)
    .sort((left, right) => right.cost - left.cost || left.dependency - right.dependency)[0];
}

function runtimeHashes() {
  return Object.fromEntries(readdirSync(new URL("src/", root), { recursive: true }).map(String).filter(path => path.endsWith(".ts"))
    .sort().map(path => [path, hash(read(`src/${path}`))]));
}

export async function playArmy(id: string, output: string, budgetMs: number, proof = false, resume?: string) {
  mkdirSync(output, { recursive: true });
  const started = Date.now(), before = runtimeHashes(), renderer = installSourceRender(), originalFetch = globalThis.fetch;
  renderer.setEnabled(false);
  globalThis.fetch = async input => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    return new Response(read(`public${path}`));
  };
  let view: MissionView | undefined;
  const write = (name: string, data: unknown) => writeFileSync(`${output}/${name}.json`, JSON.stringify(data));
  const emit = (kind: string, data: unknown) => appendFileSync(`${output}/${proof ? "proof-" : ""}journal.jsonl`,
    JSON.stringify({ kind, tick: view?.simulation.snapshot.tick, elapsedMs: Date.now() - started, data }) + "\n");
  let result: Record<string, unknown> = { id, status: "RUNTIME_BLOCKER" };
  try {
    const { faction, number } = parseMissionId(id);
    const pendingSaved = proof ? JSON.parse(readFileSync(`${output}/pending-win.json`, "utf8")) : undefined;
    const resumed = !proof && resume ? JSON.parse(readFileSync(resume, "utf8")) : undefined;
    const mission = await loadReleaseMission(faction, number, pendingSaved?.view ?? resumed?.view);
    const sourceHash = hash(JSON.stringify(mission));
    if (proof) {
      const ready = JSON.parse(readFileSync(`${output}/checkpoint.json`, "utf8"));
      assert.equal(pendingSaved.sourceHash, sourceHash); assert.equal(ready.sourceHash, sourceHash);
      view = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(pendingSaved.view)));
      assert.deepEqual(view.checkpoint(), pendingSaved.view);
      await view.initialize();
      view.resetClock(); view.update(0);
      const ticks = ready.view.simulation.tick - pendingSaved.view.simulation.tick;
      assert.ok(ticks > 0 && ticks <= 1000);
      for (let offset = 1; offset <= ticks; offset++) { view.update(offset * 50); assert.equal(view.missionDiagnostic, undefined); }
      assert.deepEqual(view.checkpoint(), ready.view, "Ready checkpoint must be reproduced exactly");
      assert.deepEqual(view.missionOutcome, { resultCode: 0, reasonCode: view.missionOutcome?.reasonCode, ready: true });
      result = { id, status: "WIN", exact: true, fromTick: pendingSaved.view.simulation.tick, toTick: ready.view.simulation.tick,
        hash: hash(JSON.stringify(ready.view)), sourceHash };
      return result;
    }
    if (resumed) {
      assert.equal(resumed.sourceHash, sourceHash);
      view = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(resumed.view)));
      assert.deepEqual(view.checkpoint(), resumed.view);
      emit("resume", { from: resume, tick: resumed.view.simulation.tick });
    } else view = new MissionView(renderer.canvas(), {} as HTMLElement, callbacks, mission);
    await view.initialize(); assert.equal(view.missionDiagnostic, undefined);
    const active = view;
    const homeRow = mission.scenario.teams[0].coordinateRows[1][0] || mission.scenario.teams[0].coordinateRows[1][1]
      ? mission.scenario.teams[0].coordinateRows[1] : mission.scenario.teams[0].coordinateRows[0];
    const home = { x: homeRow[0], y: homeRow[1] };
    // Idle troops parked on the base block the producer exit and stall the queue (H10); wait six cells toward the map centre.
    const inward = { x: active.grid.width / 2 - home.x, y: active.grid.height / 2 - home.y }, reach = Math.max(1, Math.hypot(inward.x, inward.y));
    const rally = { x: Math.round(home.x + inward.x * 6 / reach), y: Math.round(home.y + inward.y * 6 / reach) };
    const tripCellsById = new Map<number, Point[]>();
    Array.from(mission.tags).forEach((tag, index) => {
      const tripId = tag & 63;
      if (tripId) tripCellsById.set(tripId, [...tripCellsById.get(tripId) ?? [],
        { x: index % mission.map.width, y: mission.map.height - 1 - Math.floor(index / mission.map.width) }]);
    });
    const signatures = new Map<string, { signature: string; tick: number }>(), deployed = new Set<number>();
    // Trips that spawn hostiles (A05 trip 3 dropped four REAPs on the route after the commander kited onto it); kiting never steps on them.
    const avoidCells = new Set((process.env.DC_ARMY_AVOID ?? "").split(",").filter(Boolean).flatMap(trip =>
      (tripCellsById.get(Number(trip)) ?? []).flatMap(cell => [-1, 0, 1].flatMap(dy => [-1, 0, 1].map(dx => (cell.y + dy) * mission.map.width + cell.x + dx)))));
    // Dead ends (A05's start plateau, whose 5-wide exit parked allies block for good) are also excluded: "x0,y0,x1,y1|...".
    for (const box of (process.env.DC_ARMY_AVOID_BOX ?? "").split("|").filter(Boolean)) {
      const [x0, y0, x1, y1] = box.split(",").map(Number);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) avoidCells.add(y * mission.map.width + x);
    }
    let commands = 0, purchases = 0, constructions = 0, expedition: number[] = [];
    let phase: "build" | "gather" | "attack" = "build", phaseTick = 0, peak = 0, peakTick = active.simulation.snapshot.tick;
    let lastCredits = active.resourceWorkflow.credits[0], lastIncomeTick = active.simulation.snapshot.tick;
    const wave = Number(process.env.DC_ARMY_WAVE ?? 24);
    // H04 drops a team-2 force inside the player base at c>1200; attacking before it is beaten loses the base.
    const holdUntil = Number(process.env.DC_ARMY_HOLD_UNTIL ?? 0);
    // A04's remaining vents are all 40+ cells out and troop scouts never lived to reveal them.
    const collectorRange = Number(process.env.DC_ARMY_COLLECTOR_RANGE ?? 32);
    // A10 has two rich vents beside the hive; one collector left it too poor to hold the c>420 wave.
    const collectorTarget = process.env.DC_ARMY_COLLECTORS ? Number(process.env.DC_ARMY_COLLECTORS) : undefined;
    const buildAt = Number(process.env.DC_ARMY_BUILD_AT ?? 6);
    const scouting = new Map<number, string>(), lostScouts = new Map<string, number>();
    const firedIds = new Set(active.campaignJournal.flatMap(entry => entry.fired));
    emit("settings", { wave, holdUntil, collectorRange, collectorTarget, buildAt });
    const distance = (left: Point, right: Point) => Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
    const pointOf = (actor: { cellX: number; cellY: number }): Point => ({ x: actor.cellX, y: actor.cellY });
    // Commander-only missions (A05/A08/A09) follow a scripted trip route: "x,y" go, "x,y/tN" go until trip N fired,
    // "x,y/cR" go and wait until no visible hostile is within R, "wN" wait N ticks. Hostiles within DC_ARMY_DANGER
    // send the commander back to the last reached step.
    const route = process.env.DC_ARMY_ROUTE?.split(";").map(step => step.trim()).filter(Boolean).map(step => {
      const wait = /^w(\d+)$/.exec(step);
      if (wait) return { wait: Number(wait[1]) };
      const match = /^(\d+),(\d+)(?:\/([tc])(\d+))?(!)?$/.exec(step);
      assert.ok(match, `Bad route step ${step}`);
      return { point: { x: Number(match[1]), y: Number(match[2]) }, trip: match[3] === "t" ? Number(match[4]) : undefined,
        clear: match[3] === "c" ? Number(match[4]) : undefined, bold: Boolean(match[5]) };
    });
    const danger = Number(process.env.DC_ARMY_DANGER ?? 7);
    let routeIndex = 0, routeTick = 0, safePoint: Point | undefined, threatTick = -1000, stuckAt: Point | undefined, stuckTick = 0;
    let moveAt: Point | undefined, moveTick = 0, sidestepUntil = 0;
    const fightMax = Number(process.env.DC_ARMY_FIGHT ?? 2);
    const kite = process.env.DC_ARMY_KITE !== undefined, kiteGap = Number(process.env.DC_ARMY_KITE ?? 4);
    const packSize = Number(process.env.DC_ARMY_PACK ?? 99);
    const typeRange = new Map(mission.units.map(stat => [stat.index, mission.weapons.find(weapon => weapon.id === stat.weapons[0])?.range ?? 0]));
    let rangeOfEnemy = (_enemy: object) => 4;
    const reached: Point[] = [];
    // campaignSnapshot deep-clones the session (~10 ms); route missions plan every 5 ticks, so reuse it for 40.
    let campaignCache: { tick: number; value: NonNullable<typeof active.campaignSnapshot> } | undefined;
    const campaign = () => {
      const tick = active.simulation.snapshot.tick;
      if (!campaignCache || tick - campaignCache.tick >= 40 || tick < campaignCache.tick) campaignCache = { tick, value: active.campaignSnapshot! };
      return campaignCache.value;
    };
    const routeLives = () => campaign().controller.runtime.lives ?? {};
    const followRoute = (commander: { id: number; cellX: number; cellY: number; health: number; activity: string },
      enemies: readonly { cellX: number; cellY: number; activity?: string }[], _tripLives: Record<number, number>,
      allies: readonly Point[]): boolean => {
      const tick = active.simulation.snapshot.tick, here = pointOf(commander);
      safePoint ??= here;
      if (!reached.length) reached.push(here);
      const near = enemies.filter(enemy => "activity" in enemy && distance(pointOf(enemy), here) <= danger);
      if (tick % 200 === 0) emit("commander", { at: here, health: commander.health, activity: commander.activity, near: near.length, step: routeIndex,
        hostiles: near.map(enemy => `${(enemy as { team?: number }).team}/${rangeOfEnemy(enemy)}@${enemy.cellX},${enemy.cellY}:${(enemy as { health?: number }).health}`) });
      if (commander.activity !== "move" || moveAt?.x !== here.x || moveAt?.y !== here.y) { moveAt = here; moveTick = tick; }
      else if (tick - moveTick > 120 && !near.length) {
        // A05's commander stood in "move" for thousands of ticks behind allies parked in a corridor; sidestep and retry.
        const side = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].map(([dx, dy]) => ({ x: here.x + dx * 2, y: here.y + dy * 2 }))
          .filter(cell => active.grid.contains(cell.x, cell.y) && active.grid.isPassable(cell.x, cell.y));
        const cell = side[Math.floor(tick / 120) % Math.max(1, side.length)];
        moveTick = tick;
        if (cell) { order([commander.id], "move", cell, `route-unstick:${routeIndex}`); sidestepUntil = tick + 40; return true; }
      }
      if (tick < sidestepUntil && !near.length) return true;
      const current = route![routeIndex];
      // A wait keeps counting while the commander fights; A05 sat on a 1,500-tick wait for 4,000 ticks of skirmishing.
      if (current && "wait" in current && current.wait !== undefined && routeTick && tick - routeTick >= current.wait) {
        routeIndex++; routeTick = 0; emit("route-step", { index: routeIndex, at: here, health: commander.health });
      }
      // A bold step ignores hostiles only while it is actually moving: A05's commander sat wedged at (54,24) under REAPs.
      // Within a few cells of a bold trip, push through anyway: A05's trip 12 spawns 15 allies 3 cells from where it kited to death.
      const boldStep = current && "bold" in current && current.bold ? current : undefined;
      const lastDash = Boolean(boldStep && boldStep.point && distance(here, boldStep.point) <= 5);
      if (near.length && !lastDash && (!boldStep || tick - moveTick > 20)) {
        threatTick = tick;
        if (stuckAt?.x !== here.x || stuckAt?.y !== here.y || commander.activity !== "move") { stuckAt = here; stuckTick = tick; }
        // The commander outranges infantry (6 vs TRSC 4 / REAP 2). A05's commander sat wedged among allies in "move" for
        // 2,600 ticks while one hostile shot it to death: fight small groups and anything we cannot get away from.
        const nearest = [...near].sort((left, right) => distance(pointOf(left), here) - distance(pointOf(right), here))[0];
        if (kite) {
          // A pack of REAPs outlasts any kiting (A05 trips 3, 9, 11); run behind the nearest ally group so it takes the fight.
          if (near.length >= packSize) {
            const enemyCenter = { x: near.reduce((sum, enemy) => sum + enemy.cellX, 0) / near.length, y: near.reduce((sum, enemy) => sum + enemy.cellY, 0) / near.length };
            const group = allies.filter(ally => distance(ally, here) <= 30 && allies.filter(other => distance(other, ally) <= 4).length >= 3)
              .sort((left, right) => distance(left, here) - distance(right, here))[0];
            if (group && distance(group, enemyCenter) > 3) {
              const dx = group.x - enemyCenter.x, dy = group.y - enemyCenter.y, span = Math.max(1, Math.hypot(dx, dy));
              const behind = { x: Math.round(group.x + dx * 3 / span), y: Math.round(group.y + dy * 3 / span) };
              const refuge = active.grid.contains(behind.x, behind.y) && active.grid.isPassable(behind.x, behind.y) ? behind : group;
              if (distance(here, refuge) > 2) { order([commander.id], "move", refuge, `route-ally-refuge:${routeIndex}`); return true; }
            }
          }
          // The commander is faster (47 vs 25/30) and outranges infantry (6 vs 4/2): shoot from range, step back when closed.
          const gap = distance(pointOf(nearest), here);
          // A BARR (range 12) cannot be kited; A05 lost ~375 HP backing away from one at (23,44). Close in and kill it.
          const outranged = near.some(enemy => distance(pointOf(enemy), here) <= 8 && rangeOfEnemy(enemy) >= 6);
          // REAP melee packs (range 2) did most of A05's damage; give melee an extra cell of margin.
          const margin = (enemy: object) => rangeOfEnemy(enemy) + (rangeOfEnemy(enemy) <= 2 ? 2 : 1);
          if (!outranged && near.some(enemy => distance(pointOf(enemy), here) <= Math.max(kiteGap, margin(enemy))) && tick - stuckTick <= 20) {
            const clearance = (point: Point) => Math.min(...near.map(enemy => distance(pointOf(enemy), point)));
            // Kiting straight back cornered A05's commander on its dead-end start plateau; drag pursuers into allies instead.
            // Unanchored kiting walked A05's commander 25 cells south into team 3; stay near the last reached step.
            const anchor = reached[reached.length - 1] ?? here;
            const score = (point: Point) => Math.min(clearance(point), danger) + (allies.some(ally => distance(ally, point) <= 3) ? 3 : 0)
              - 0.5 * Math.max(0, distance(point, anchor) - 4);
            let best: Point | undefined;
            for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
              const cell = { x: here.x + dx, y: here.y + dy };
              if (Math.abs(dx) + Math.abs(dy) < 3 || !active.grid.contains(cell.x, cell.y) || !active.grid.isPassable(cell.x, cell.y)
                || avoidCells.has(cell.y * active.grid.width + cell.x)) continue;
              // A05's commander kited into the trip-8 ally spawn and stood wedged in "move" while REAPs hit it.
              if ([...allies, ...enemies.map(pointOf)].some(unit => Math.max(Math.abs(unit.x - cell.x), Math.abs(unit.y - cell.y)) <= 1)) continue;
              if (!best || score(cell) > score(best)) best = cell;
            }
            if (best && clearance(best) > gap) { order([commander.id], "move", best, `route-kite:${routeIndex}`); return true; }
          }
          // Chasing whatever came within the danger radius dragged A05's commander 30 cells off route; only engage in range.
          if ((gap <= 6 || outranged) && commander.activity !== "attack") {
            const target = outranged ? near.filter(enemy => rangeOfEnemy(enemy) >= 6).sort((left, right) => distance(pointOf(left), here) - distance(pointOf(right), here))[0] : nearest;
            order([commander.id], "assault", pointOf(target), `route-fight:${routeIndex}`);
          }
          // Out of everyone's reach: keep walking the route rather than idling in hostile country.
          if (gap <= 6 || outranged || commander.activity === "attack") return true;
        }
        else if (near.length <= fightMax || tick - stuckTick > 60) {
          if (commander.activity !== "attack") order([commander.id], "assault", pointOf(nearest), `route-fight:${routeIndex}`);
          return true;
        }
        // Waiting on the last step let A05's commander be shot where it stood; flee to the nearest reached step or ally
        // that is clear of the hostiles, or else the one farthest from them.
        const clearance = (point: Point) => Math.min(...near.map(enemy => distance(pointOf(enemy), point)));
        const options = [...reached, ...allies.filter(point => clearance(point) > danger + 2)]
          .filter(point => distance(point, here) > 1 && !avoidCells.has(point.y * active.grid.width + point.x));
        const refuge = options.filter(point => clearance(point) > danger + 2).sort((left, right) => distance(left, here) - distance(right, here))[0]
          ?? options.sort((left, right) => clearance(right) - clearance(left))[0];
        if (!kite && refuge && clearance(refuge) > clearance(here)) { order([commander.id], "move", refuge, `route-retreat:${routeIndex}`); return true; }
      }
      while (routeIndex < route!.length) {
        const step = route![routeIndex];
        if ("wait" in step && step.wait !== undefined) {
          if (!routeTick) routeTick = tick;
          if (tick - routeTick < step.wait) return true;
        } else if (step.point) {
          // A trip fires only on its exact tagged cell.
          const arrived = distance(here, step.point) <= (step.trip !== undefined ? 0 : 1);
          if (distance(here, step.point) <= 1 && !routeTick) routeTick = tick;
          const done = step.trip !== undefined ? firedIds.has(step.trip) || (routeTick > 0 && tick - routeTick > 400)
            : step.clear !== undefined ? arrived && !enemies.some(enemy => distance(pointOf(enemy), step.point!) <= step.clear!) : arrived;
          if (!done) {
            // Advancing straight back into a hostile that just chased us off made A05 oscillate at the start for 5k ticks.
            // With kiting, only an enemy about to close in blocks progress; A05 never saw a calm danger radius in team-2 country.
            const calmRadius = kite ? kiteGap + 2 : danger + 3;
            const calm = step.bold || (tick - threatTick > (kite ? 20 : 80) && !enemies.some(enemy => "activity" in enemy && distance(pointOf(enemy), here) <= calmRadius));
            if (calm && !arrived) order([commander.id], "move", step.point, `route:${routeIndex}`);
            return true;
          }
          safePoint = step.point;
          reached.push(step.point);
        }
        routeIndex++; routeTick = 0;
        emit("route-step", { index: routeIndex, at: here, health: commander.health });
      }
      return false;
    };
    const order = (ids: number[], mode: "move" | "assault", point: Point, purpose: string) => {
      ids = ids.filter(actorId => active.isOwnedUnit(actorId)).sort((left, right) => left - right);
      if (!ids.length) return;
      const key = ids.join(","), signature = JSON.stringify({ mode, point });
      const previous = signatures.get(key), tick = active.simulation.snapshot.tick;
      if (previous?.signature === signature && tick - previous.tick < 200) return;
      active.replaceSelection(ids);
      active.setCameraCenter(point.x + 0.5, point.y + 0.5);
      active.setOrderMode(mode);
      const camera = active.cameraView, bounds = active.canvas.getBoundingClientRect(), scale = 512 / camera.width;
      const client = (cell: Point) => ({
        x: bounds.left + (cell.x + 0.5 - camera.x) * scale * bounds.width / 512,
        y: bounds.top + (226 - (cell.y + 0.5 - camera.y - camera.height / 2) * scale) * bounds.height / 452,
      });
      // An unexplored building footprint is not a legal destination; aim at the nearest open cell beside it.
      const candidates = [point];
      for (let ring = 1; ring <= 4; ring++) for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++)
        if (Math.max(Math.abs(dx), Math.abs(dy)) === ring) candidates.push({ x: point.x + dx, y: point.y + dy });
      let clientX = 0, clientY = 0, cursor = "blocked";
      for (const cell of candidates) {
        if (cell.x < 0 || cell.y < 0 || cell.x >= active.grid.width || cell.y >= active.grid.height) continue;
        ({ x: clientX, y: clientY } = client(cell));
        cursor = active.cursorAt(clientX, clientY);
        if (cursor !== "blocked") break;
      }
      if (cursor === "blocked") return;
      active.commandAt(clientX, clientY); commands++; signatures.set(key, { signature, tick });
      emit("command", { ids, mode, point, purpose, cursor, visible: Boolean(active.visibility[point.y * active.grid.width + point.x]) });
    };
    const plan = () => {
      const snapshot = active.simulation.snapshot, world = campaign().world;
      const bindings = new Map(active.nativeBindings.map(binding => [binding.key, binding.simulationId]));
      const types = new Map(world.entities.map(entity => [bindings.get(entity.key), entity.unitType]));
      const owned = snapshot.units.filter(actor => active.isOwnedUnit(actor.id) && actor.health > 0 && actor.activity !== "die");
      const visibility = active.visibility;
      const enemies = [...snapshot.units, ...snapshot.staticTargets].filter(actor => actor.health > 0 && actor.team !== undefined &&
        actor.team >= 0 && actor.team < 8 && (!("activity" in actor) || actor.activity !== "die") &&
        visibility[actor.cellY * active.grid.width + actor.cellX] && areHostile({ faction, team: 0 }, actor, snapshot.teamAlliances)
        && !ZERO_DAMAGE_TYPES.has(types.get(actor.id) ?? -1));
      const goals = world.entities.filter(entity => entity.key.startsWith("colony:") && entity.unitType !== 81 && entity.health > 0 &&
        entity.team > 0 && entity.team < 8 && areHostile({ faction, team: 0 }, { faction: mission.scenario.teams[entity.team]?.race === 1 ? "alien" : "human", team: entity.team }, snapshot.teamAlliances));
      const collectors = owned.filter(actor => COLLECTORS.has(types.get(actor.id) ?? -1));
      const commander = owned.find(actor => COMMANDERS.has(types.get(actor.id) ?? -1));
      const troops = owned.filter(actor => actor !== commander && !collectors.includes(actor));
      const economy = active.browserEconomyState;
      const occupied = new Set(economy?.orders.map(entry => entry.nodeKey));
      const cellOf = (node: { position: { x: number; y: number } }) => ({ x: node.position.x >> 8, y: node.position.y >> 8 });
      let unserved = 0;
      for (const collector of collectors) {
        // A13 lost both collectors to the first raids and could never afford another; pull them back to the guards.
        const raider = enemies.find(enemy => "activity" in enemy && distance(pointOf(enemy), pointOf(collector)) < 7);
        if (raider && distance(pointOf(collector), home) > 3) { order([collector.id], "move", home, "collector-flee"); continue; }
        if (economy?.orders.some(entry => entry.simulationId === collector.id)) continue;
        const source = active.resourceSources.filter(node => node.status === 1 && (node.remaining ?? 0) > 0 && (node.rate ?? 0) > 0 &&
          !occupied.has(node.key) && !enemies.some(enemy => distance(pointOf(enemy), cellOf(node)) < 8) &&
          (visibility[cellOf(node).y * active.grid.width + cellOf(node).x] || distance(cellOf(node), home) <= collectorRange))
          .sort((left, right) => distance(pointOf(collector), cellOf(left)) - distance(pointOf(collector), cellOf(right)))[0];
        if (!source) { unserved++; continue; }
        occupied.add(source.key);
        const cell = cellOf(source);
        // Harvest needs a visible vent; drive toward an unexplored one first.
        if (!visibility[cell.y * active.grid.width + cell.x]) { order([collector.id], "move", cell, "scout-source"); continue; }
        active.replaceSelection([collector.id]); emit("harvest", { id: collector.id, slot: source.slot, accepted: active.harvestSelected(source.slot) }); commands++;
      }
      const credits = active.resourceWorkflow.credits[0];
      if (credits > lastCredits) lastIncomeTick = snapshot.tick;
      lastCredits = credits;
      // A lean start (A10) cannot afford to lose a second collector before it has any troops.
      // Hold back one collector's price while the fleet is short: A13 spent to 81 credits, lost both collectors and never recovered.
      const collectorEntry = active.productionMenu.find(entry => entry.kind === "unit" && COLLECTORS.has(entry.unitType ?? -1));
      // With no collector and no income the reserve can never fill and would freeze all spending (A13 sat on 431 for 30k ticks);
      // a living collector may just be waiting for the next timed vent (A13 c>300), so keep saving then.
      const desiredCollectors = collectorTarget ?? (troops.length >= 6 ? 2 : 1);
      const reserve = collectorEntry && collectors.length < Math.max(2, desiredCollectors) && (collectors.length > 0 || snapshot.tick - lastIncomeTick < 3000) ? collectorEntry.cost : 0;
      const choice = chooseProduction(active.productionMenu, credits, collectors.length, troops.length, desiredCollectors, 50, reserve);
      if (choice) { const accepted = active.purchaseProduction(choice.dependency); if (accepted) purchases++; emit("purchase", { dependency: choice.dependency, unitType: choice.unitType, cost: choice.cost, accepted }); }
      const building = active.constructionMenu.find(entry => "cost" in entry && entry.requestEnabled && entry.cost + 400 + reserve <= active.resourceWorkflow.credits[0]);
      // A base-less start (A10 bails at c>180 with no buildings) must build before anything else.
      const hasBase = Object.entries(world.buildingSlots).some(([key, health]) => key.startsWith("0,") && health > 0);
      // Without a troop producer (A10 starts with only the hive) buildings come before the troop quota.
      const canTrain = active.productionMenu.some(entry => entry.kind === "unit" && !COLLECTORS.has(entry.unitType ?? -1) && entry.enabled);
      if (building && (troops.length >= buildAt || !hasBase || !canTrain) && "cost" in building) {
        const accepted = active.purchaseConstruction(building.dependency);
        if (accepted) constructions++;
        emit("construction", { slot: building.slot, action: building.action, dependency: building.dependency, accepted });
      }
      // A commander-only start (A05, A08) must walk the trips and contacts itself.
      const runners = troops.length ? troops : commander ? [commander] : [];
      rangeOfEnemy = enemy => typeRange.get(types.get((enemy as { id: number }).id) ?? -1) ?? 4;
      if (route && commander && followRoute(commander, enemies, routeLives(), snapshot.units.filter(actor => actor.health > 0 && actor.team !== undefined
        && actor.team > 0 && actor.team < 8 && actor.activity !== "die" && !areHostile({ faction, team: 0 }, actor, snapshot.teamAlliances)).map(pointOf))) return;
      // A contested or distant rally is no shelter: A08's commander died crossing 37 cells of team-3 ground to reach (57,46).
      const rallyContested = enemies.some(enemy => distance(pointOf(enemy), rally) < 14) || Boolean(commander && distance(pointOf(commander), rally) > 20);
      const hunter = commander && troops.length ? enemies.filter(enemy => "activity" in enemy && distance(pointOf(enemy), pointOf(commander)) < 10)
        .sort((left, right) => distance(pointOf(left), pointOf(commander)) - distance(pointOf(right), pointOf(commander)))[0] : undefined;
      // A08 trip 12 drops team 5 at (78,11) beside the commander; with troops to fight, the commander steps directly away.
      if (commander && hunter) {
        const dx = commander.cellX - hunter.cellX, dy = commander.cellY - hunter.cellY, span = Math.max(1, Math.abs(dx), Math.abs(dy));
        const away = { x: Math.max(0, Math.min(active.grid.width - 1, Math.round(commander.cellX + dx * 8 / span))),
          y: Math.max(0, Math.min(active.grid.height - 1, Math.round(commander.cellY + dy * 8 / span))) };
        order([commander.id], "move", away, "commander-evade");
      } else if (commander && troops.length && hasBase && !rallyContested && distance(pointOf(commander), rally) > 3) order([commander.id], "move", rally, "protect-commander");
      else if (commander && troops.length && rallyContested && commander.activity === "move") order([commander.id], "move", pointOf(commander), "commander-hold");
      if (!runners.length) return;
      // DC.EXE 4140dc contact objects: touching dormant units recruits them, touching stores pays their HP as credits.
      const bytes = world.entityBytes;
      const contacts = bytes ? world.entities.filter(entity => entity.rawSlot !== null && entity.health > 0 &&
        [1, 2].includes(bytes[entity.rawSlot * 220 + 0xcb]) && !enemies.some(enemy => distance(pointOf(enemy), { x: entity.tileX, y: entity.tileY }) < 6)) : [];
      const busy = new Set<number>(expedition);
      for (const contact of contacts.slice(0, 3)) {
        const cell = { x: contact.tileX, y: contact.tileY };
        const runner = runners.filter(actor => !busy.has(actor.id) && actor.movementPlane !== "air")
          .sort((left, right) => distance(pointOf(left), cell) - distance(pointOf(right), cell))[0];
        if (!runner) break;
        busy.add(runner.id);
        order([runner.id], "move", cell, `contact:${contact.key}`);
      }
      // Live "any unit" trips gate progress (H04 trip 6 -> trip 7 -> CITY WIN); commander-only trips are left to escorts.
      const lives = campaign().controller.runtime.lives ?? {};
      // A04's live trip 13 has no tagged cells and used to hide trip 16, the only source of money.
      // A08 trip 5 keeps 99 lives after firing; prefer trips that have not fired yet so the runner moves on to trip 6.
      const trip = mission.triggers.filter(trigger => trigger.mode === "trip" && (lives[trigger.id] ?? 0) > 0 && tripCellsById.has(trigger.id)
        && /^\(?S==0\)?$/.test(trigger.condition.replace(/\s/g, "")))
        .sort((left, right) => Number(firedIds.has(left.id)) - Number(firedIds.has(right.id)) || left.id - right.id)[0];
      const tripCells = trip ? tripCellsById.get(trip.id) ?? [] : [];
      const runner = tripCells.length ? runners.filter(actor => !busy.has(actor.id) && actor.movementPlane !== "air")
        .sort((left, right) => Math.min(...tripCells.map(cell => distance(pointOf(left), cell)))
          - Math.min(...tripCells.map(cell => distance(pointOf(right), cell))) || left.id - right.id)[0] : undefined;
      if (trip && runner) {
        const cell = [...tripCells].sort((left, right) => distance(pointOf(runner), left) - distance(pointOf(runner), right))[0];
        busy.add(runner.id);
        order([runner.id], "move", cell, `trip:${trip.id}`);
      }
      // Vents beyond the collectors' 32-cell scouting limit stay dark (H04 idled both collectors for 25k ticks); a troop explores the nearest.
      // A vent that has already cost two scouts is guarded (H04 fed 48 scouts to one vent).
      for (const [scoutId, key] of scouting) if (!troops.some(actor => actor.id === scoutId)) {
        scouting.delete(scoutId); lostScouts.set(key, (lostScouts.get(key) ?? 0) + 1);
      }
      const dark = unserved ? active.resourceSources.filter(node => node.status === 1 && (node.remaining ?? 0) > 0 && (node.rate ?? 0) > 0 &&
        !occupied.has(node.key) && !visibility[cellOf(node).y * active.grid.width + cellOf(node).x] && (lostScouts.get(node.key) ?? 0) < 2 &&
        !enemies.some(enemy => distance(pointOf(enemy), cellOf(node)) < 8))
        .sort((left, right) => distance(cellOf(left), home) - distance(cellOf(right), home))[0] : undefined;
      const scout = dark && troops.filter(actor => !busy.has(actor.id) && !expedition.includes(actor.id) && actor.movementPlane !== "air")
        .sort((left, right) => distance(pointOf(left), cellOf(dark)) - distance(pointOf(right), cellOf(dark)) || left.id - right.id)[0];
      if (dark && scout) { busy.add(scout.id); scouting.set(scout.id, dark.key); order([scout.id], "move", cellOf(dark), `scout-vent:${dark.key}`); }
      // Interceptors (SARGE / GORREM) deploy near a hostile collector to divert its income.
      const hostileCollectors = world.entities.filter(entity => COLLECTORS.has(entity.unitType) && entity.health > 0 && entity.team > 0 && entity.team < 8 &&
        areHostile({ faction, team: 0 }, { faction: mission.scenario.teams[entity.team]?.race === 1 ? "alien" : "human", team: entity.team }, snapshot.teamAlliances));
      const interception = active.browserEconomyState?.incomeInterception?.deployments ?? [];
      const collectorCells = hostileCollectors.map(entity => snapshot.units.find(unit => unit.id === bindings.get(entity.key)))
        .filter((unit): unit is NonNullable<typeof unit> => Boolean(unit && unit.health > 0)).map(pointOf);
      for (const interceptor of troops.filter(actor => INTERCEPTORS.has(types.get(actor.id) ?? -1) && !busy.has(actor.id))) {
        busy.add(interceptor.id);
        if (deployed.has(interceptor.id)) {
          // The partner is acquired once at deployment; without one, pack up and try again.
          const entry = interception.find(actor => actor.simulationId === interceptor.id);
          if (entry?.acquired && !entry.partner) {
            active.replaceSelection([interceptor.id]); active.undeploySelected();
            deployed.delete(interceptor.id); emit("undeploy", { id: interceptor.id });
          }
          continue;
        }
        const preyCell = [...collectorCells].sort((left, right) => distance(left, pointOf(interceptor)) - distance(right, pointOf(interceptor)))[0];
        if (!preyCell) continue;
        const spotted = Boolean(visibility[preyCell.y * active.grid.width + preyCell.x]);
        if (snapshot.tick % 400 === 0) emit("interceptor", { id: interceptor.id, at: pointOf(interceptor), activity: interceptor.activity, prey: preyCell, spotted });
        // Stand off just outside weapon range (9) but inside the 11-cell acquisition band and sight (10).
        const dx = interceptor.cellX - preyCell.x, dy = interceptor.cellY - preyCell.y, span = Math.max(1, Math.abs(dx), Math.abs(dy));
        const standoff = { x: Math.round(preyCell.x + dx * 10 / span), y: Math.round(preyCell.y + dy * 10 / span) };
        const range = Math.max(Math.abs(dx), Math.abs(dy));
        if (range > 11 || range < 9 || !spotted || interceptor.activity === "attack") {
          order([interceptor.id], "move", range > 11 ? preyCell : standoff, "interceptor-approach"); continue;
        }
        active.replaceSelection([interceptor.id]);
        if (interceptor.activity !== "idle") { active.stopSelected(); continue; }
        const accepted = active.deploySelected();
        if (accepted.includes(interceptor.id)) deployed.add(interceptor.id);
        emit("deploy", { id: interceptor.id, accepted, prey: preyCell });
      }
      const available = troops.filter(actor => !busy.has(actor.id) || expedition.includes(actor.id));
      // Keep ~30% as home guards. Build to twenty-four, gather as one group, then attack; fall back to building when the army is spent.
      const ranked = [...available].sort((left, right) => distance(pointOf(left), home) - distance(pointOf(right), home) || left.id - right.id);
      const tick = snapshot.tick;
      const survivors = expedition.filter(actorId => available.some(actor => actor.id === actorId)).length;
      if (available.length > peak) { peak = available.length; peakTick = tick; }
      // A stalled economy never reaches twenty; attack with what exists rather than idling forever (A13).
      const stalled = tick - peakTick > 3000 && available.length >= 10;
      // A few survivors stuck far away must not keep a large home force idle (H12 sat on 44 troops for 20k ticks).
      const idleHome = available.length - survivors;
      const guardCount = Math.max(4, Math.round(available.length * 0.3));
      // Waves of 17 against a turreted base die one after another (H04); DC_ARMY_WAVE lets a mission bank a larger army first.
      if (phase === "build" && tick >= holdUntil && (available.length >= wave || stalled)) { phase = "gather"; phaseTick = tick; peak = 0; peakTick = tick; emit("phase", { phase, troops: available.length }); }
      else if (phase === "attack" && idleHome - guardCount >= 20) { phase = "gather"; phaseTick = tick; emit("phase", { phase, troops: available.length, reinforce: true }); }
      else if (phase !== "build" && survivors < 5 && tick - phaseTick > 200) { phase = "build"; phaseTick = tick; emit("phase", { phase, troops: available.length }); }
      const army = phase === "build" ? [] : phase === "gather" ? ranked.slice(guardCount) : available.filter(actor => expedition.includes(actor.id));
      const guardList = ranked.filter(actor => !army.includes(actor));
      expedition = army.map(actor => actor.id);
      const threat = enemies.filter(enemy => distance(pointOf(enemy), home) < 14 ||
        collectors.some(collector => distance(pointOf(enemy), pointOf(collector)) < 8))
        .sort((left, right) => distance(pointOf(left), home) - distance(pointOf(right), home) || left.health - right.health)[0];
      const guards = guardList.filter(actor => !threat || actor.activity !== "attack" || actor.targetId !== threat.id);
      order(guards.map(actor => actor.id), threat ? "assault" : "move", threat ? pointOf(threat) : rally, threat ? "home-threat" : "rally");
      if (!army.length) return;
      // Losing every building loses the mission (H12 bail 2): a real raid on the base recalls the army.
      const raiders = enemies.filter(enemy => "activity" in enemy && distance(pointOf(enemy), home) < 14).length;
      if (threat && raiders >= 3) {
        order(army.filter(actor => actor.activity !== "attack").map(actor => actor.id), "assault", pointOf(threat), "defend-base");
        return;
      }
      const goalIds = new Set(goals.map(goal => bindings.get(goal.key)).filter((value): value is number => value !== undefined));
      // Once every CITY is down, finish the remaining hostile objects (H09 needs exactly 12 team-4 pod losses).
      const leftovers = goals.length ? [] : snapshot.staticTargets.filter(actor => actor.health > 1 && actor.team !== undefined
        && actor.team > 0 && actor.team < 8 && areHostile({ faction, team: 0 }, actor, snapshot.teamAlliances)
        && !ZERO_DAMAGE_TYPES.has(types.get(actor.id) ?? -1))
        .map(actor => ({ key: `static:${actor.id}`, tileX: actor.cellX, tileY: actor.cellY }));
      const target = [...goals, ...leftovers].sort((left, right) => distance({ x: left.tileX, y: left.tileY }, home) - distance({ x: right.tileX, y: right.tileY }, home))[0];
      if (phase === "gather") {
        const span = Math.max(1, target ? distance({ x: target.tileX, y: target.tileY }, home) : 1);
        const stage = target ? { x: Math.round(home.x + (target.tileX - home.x) * 10 / span), y: Math.round(home.y + (target.tileY - home.y) * 10 / span) } : home;
        const gathered = army.filter(actor => distance(pointOf(actor), stage) <= 6).length;
        if (gathered >= army.length * 0.8 || tick - phaseTick > 800) { phase = "attack"; phaseTick = tick; emit("phase", { phase, troops: army.length, gathered }); }
        else { for (const actor of army) if (actor.activity !== "attack") order([actor.id], "move", stage, "gather"); return; }
      }
      for (const actor of army) {
        // Near home the guards handle raiders; the army keeps attack-moving out so it is not pinned down.
        // Kill defenders, then turrets and other structures, and the CITY goals last.
        const none = new Set<number>(), here = pointOf(actor);
        const nearby = distance(here, home) < 20 ? undefined : mission02VisibleTarget(enemies.filter(enemy => "activity" in enemy), here, none) ??
          mission02VisibleTarget(enemies.filter(enemy => !goalIds.has(enemy.id)), here, none) ?? mission02VisibleTarget(enemies, here, goalIds);
        if (nearby) {
          if (actor.activity !== "attack" || actor.targetId !== nearby.id) order([actor.id], "assault", pointOf(nearby), "visible-hostile");
        } else if (target && (actor.activity !== "attack" || distance(pointOf(actor), home) < 20)) {
          order([actor.id], "assault", { x: target.tileX, y: target.tileY }, `city:${target.key}`);
        }
      }
    };
    const report = () => {
      const world = active.campaignSnapshot!.world;
      return { id, tick: active.simulation.snapshot.tick, outcome: active.missionOutcome, diagnostic: active.missionDiagnostic ?? null,
        credits: active.resourceWorkflow.credits[0], commands, purchases, constructions, expedition: expedition.length,
        menu: active.productionMenu.map(choice => `${choice.dependency}:${choice.unitType}:${choice.cost}:${choice.enabled ? "on" : "off"}:${choice.pending}/${choice.queued}`),
        owned: active.simulation.snapshot.units.filter(actor => active.isOwnedUnit(actor.id) && actor.health > 0).length,
        goalHealth: Object.fromEntries(active.simulation.snapshot.staticTargets.filter(target => target.team !== undefined && target.team > 0 && target.team < 8 && target.health > 1)
          .map(target => [`${target.team}:${target.id}`, target.health])),
        buildingSlots: world.buildingSlots, fired: [...new Set(active.campaignJournal.flatMap(entry => entry.fired))], elapsedMs: Date.now() - started };
    };
    let clock = 0, pending = false;
    active.resetClock(); active.update(0);
    while (Date.now() - started < budgetMs - 5000 && active.simulation.snapshot.tick < 200000) {
      if (active.missionDiagnostic || active.missionOutcome?.ready) break;
      const tick = active.simulation.snapshot.tick;
      if (!active.missionOutcome && tick % (route ? 5 : 40) === 0) plan();
      active.update(clock += 50);
      for (const id of active.campaignJournal.at(-1)?.fired ?? []) firedIds.add(id);
      if (active.simulation.snapshot.tick !== tick + 1 && !active.missionOutcome?.ready) {
        throw new Error(`Public update did not advance: ${JSON.stringify(active.missionDiagnostic ?? null)}`);
      }
      if (active.missionOutcome?.resultCode === 0 && !active.missionOutcome.ready && !pending) {
        pending = true; write("pending-win", { sourceHash, view: active.checkpoint() }); emit("pending-win", active.missionOutcome);
      }
      if (active.simulation.snapshot.tick % 1000 === 0) { const latest = report(); write("latest", latest); emit("progress", latest); }
      if (active.simulation.snapshot.tick % 5000 === 0) {
        write("checkpoint", { sourceHash, view: active.checkpoint() });
        // A late collapse (H12 lost 46 units in 7k ticks) needs a resume point from before it.
        if (active.simulation.snapshot.tick % 10000 === 0) copyFileSync(`${output}/checkpoint.json`, `${output}/checkpoint-${active.simulation.snapshot.tick}.json`);
      }
    }
    write("checkpoint", { sourceHash, view: active.checkpoint() });
    const outcome = active.missionOutcome;
    result = { ...report(), sourceHash, status: active.missionDiagnostic ? "RUNTIME_BLOCKER" : outcome?.ready
      ? outcome.resultCode === 0 ? "READY_WIN_UNVERIFIED" : "LOSS" : "INCOMPLETE" };
    return result;
  } catch (error) {
    result = { ...result, diagnostic: error instanceof Error ? error.stack : String(error), tick: view?.simulation.snapshot.tick };
    emit("failure", result);
    return result;
  } finally {
    const after = runtimeHashes(), changed = Object.keys(before).filter(path => before[path] !== after[path]);
    if (changed.length) result = { ...result, status: "RUNTIME_CHANGED", changed };
    write(proof ? "proof-result" : "result", { ...result, elapsedMs: Date.now() - started });
    view?.dispose(); renderer.dispose(); globalThis.fetch = originalFetch;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argument = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const id = argument("mission") ?? "A11";
  const output = argument("output") ?? `/tmp/dc-army-${id}-${Date.now()}`;
  const budget = Number(argument("budget") ?? 1500000);
  if (process.argv.includes("--worker")) {
    const result = await playArmy(id, output, budget, process.argv.includes("--proof"), argument("resume"));
    process.exitCode = ["WIN", "READY_WIN_UNVERIFIED"].includes(String(result.status)) ? 0 : 1;
  } else {
    mkdirSync(output, { recursive: true });
    const run = (proof: boolean, cap: number) => {
      const descriptor = openSync(`${output}/${proof ? "proof" : "play"}.log`, "w"), start = Date.now();
      const child = spawnSync(process.execPath, ["--max-old-space-size=6144", "--import", fileURLToPath(new URL("node_modules/tsx/dist/loader.mjs", root)),
        fileURLToPath(import.meta.url), "--worker", `--mission=${id}`, `--output=${output}`, `--budget=${cap}`, ...(proof ? ["--proof"] : []),
        ...(!proof && argument("resume") ? [`--resume=${argument("resume")}`] : [])],
      { cwd: fileURLToPath(root), stdio: ["ignore", descriptor, descriptor], timeout: cap + 60000, killSignal: "SIGKILL" });
      closeSync(descriptor);
      const receipt = { proof, code: child.status, signal: child.signal, elapsedMs: Date.now() - start };
      writeFileSync(`${output}/${proof ? "proof-" : ""}exit.json`, JSON.stringify(receipt));
      return receipt;
    };
    run(false, budget);
    const played = existsSync(`${output}/result.json`) ? JSON.parse(readFileSync(`${output}/result.json`, "utf8")) : { status: "HARD_DEADLINE" };
    let status = played.status;
    if (status === "READY_WIN_UNVERIFIED" && existsSync(`${output}/pending-win.json`)) {
      // Restoring a 30k+ tick checkpoint replays its journal; under load that exceeded 600 s (H13, A07).
      run(true, 1800000);
      const proved = existsSync(`${output}/proof-result.json`) ? JSON.parse(readFileSync(`${output}/proof-result.json`, "utf8")) : undefined;
      if (proved?.status === "WIN") status = "WIN";
    }
    writeFileSync(`${output}/summary.json`, JSON.stringify({ id, status, played }));
    console.log(JSON.stringify({ id, status, tick: played.tick, output }));
  }
}

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadReleaseMission } from "./fixtures/release-mission";
import { MissionView } from "../../src/mission-view";
import { areHostile } from "../../src/engine/diplomacy";
import { findPath } from "../../src/engine/pathfinding";
import { NavigationGrid, type GridPoint } from "../../src/engine/grid";
import { SUBCELLS_PER_CELL } from "../../src/engine/constants";
import { parseTriggerScript } from "../extractors/data/triggers";
import { installSourceRender } from "./fixtures/source-render";
import { inspectMission02 } from "./fixtures/browser-campaign-playthrough";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const output = process.env.DC_FINAL_OUTPUT ?? `/tmp/dc-alien02-final-${Date.now()}`;
mkdirSync(output, { recursive: true });
if (!process.env.DC_FINAL_WORKER && !process.argv.includes("--check")) {
  const child = fork(fileURLToPath(import.meta.url), process.argv.slice(2), {
    env: { ...process.env, DC_FINAL_WORKER: "1", DC_FINAL_OUTPUT: output },
    detached: true, stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  let phase = "restore";
  let phaseStarted = Date.now();
  let timer: ReturnType<typeof setTimeout>;
  const arm = (next: string) => {
    clearTimeout(timer);
    phase = next; phaseStarted = Date.now();
    const budgetMs = phase === "stepping" ? 630000 : 900000;
    appendFileSync(`${output}/supervisor.jsonl`, `${JSON.stringify({ phase, budgetMs, childPid: child.pid, at: phaseStarted })}\n`);
    timer = setTimeout(() => { if (child.pid) process.kill(-child.pid, "SIGKILL"); }, budgetMs);
  };
  arm("restore");
  child.on("message", message => {
    if (typeof message === "object" && message && "phase" in message &&
      ["stepping", "proof"].includes(String(message.phase))) arm(String(message.phase));
  });
  const terminate = () => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} } };
  process.on("SIGTERM", terminate);
  process.on("SIGINT", () => {});
  const receipt = await new Promise<{ code: number | null; signal: string | null }>(resolve => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer!);
  writeFileSync(`${output}/exit.json`, JSON.stringify({ ...receipt, phase, phaseMs: Date.now() - phaseStarted,
    parentPid: process.pid, childPid: child.pid, output }));
  console.log(JSON.stringify({ output, ...receipt, phase }));
  process.exit(receipt.code ?? 1);
}
const started = performance.now();
const renderer = installSourceRender();
renderer.setEnabled(false);
const originalFetch = globalThis.fetch;
let view: MissionView | undefined;
const emit = (kind: string, data: unknown) => appendFileSync(`${output}/journal.jsonl`,
  `${JSON.stringify({ kind, tick: view?.simulation.snapshot.tick, elapsedMs: Math.round(performance.now() - started), data })}\n`);
const write = (name: string, data: unknown) => writeFileSync(`${output}/${name}.json`, JSON.stringify(data));
globalThis.fetch = async input => {
  const url = String(input);
  assert.ok(url.startsWith("/assets/generated/") && !url.includes(".."));
  return new Response(read(`public${url}`));
};
const clickOrder = (activeView: MissionView, ids: number[], destination: GridPoint, mode: "move" | "assault") => {
  activeView.replaceSelection(ids);
  assert.deepEqual(activeView.selectedIds, [...ids].sort((left, right) => left - right));
  activeView.setCameraCenter(destination.x + 0.5, destination.y + 0.5);
  activeView.setOrderMode(mode);
  const camera = activeView.cameraView, bounds = activeView.canvas.getBoundingClientRect();
  const scale = 512 / camera.width;
  const clientX = bounds.left + (destination.x + 0.5 - camera.x) * scale * bounds.width / 512;
  const clientY = bounds.top + (226 - (destination.y + 0.5 - camera.y - camera.height / 2) * scale) * bounds.height / 452;
  const cursor = activeView.cursorAt(clientX, clientY);
  if (cursor !== "blocked") activeView.commandAt(clientX, clientY);
  return cursor;
};
try {
  const proofDirectory = process.argv.find(argument => argument.startsWith("--proof="))?.slice("--proof=".length);
  const path = process.env.DC_FINAL_RESUME ?? "/tmp/dc-m02-alien-win-SptQgw/checkpoint.json";
  const saved = JSON.parse(readFileSync(path, "utf8"));
  const mission = await loadReleaseMission("alien", 2);
  inspectMission02(mission);
  const sourceHash = hash(JSON.stringify(mission));
  assert.equal(saved.sourceHash, sourceHash);
  assert.deepEqual(mission.triggers, parseTriggerScript(read("raw_cd/DC/SCENARIO/ALIEN/ALIEN02.TRO").toString()));
  assert.equal(mission.scenario.source.sha256, hash(read("raw_cd/DC/SCENARIO/ALIEN/ALIEN02.SCN")));
  if (process.argv.includes("--check-input")) {
    view = new MissionView(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
    await view.initialize();
    assert.equal(view.missionDiagnostic, undefined);
    view.resetClock(); view.update(0); view.update(50);
    assert.equal(view.missionDiagnostic, undefined);
    const combatant = view.checkpoint().simulation.units.find(actor => actor.team === 0 && actor.health > 0 && actor.weapon);
    assert.ok(combatant);
    const actor = view.simulation.snapshot.units.find(actor => actor.id === combatant.id)!;
    const occupied = new Set(view.simulation.staticObstacleCells.map(point => view!.grid.index(point.x, point.y)));
    for (const unit of view.simulation.snapshot.units) occupied.add(view.grid.index(unit.cellX, unit.cellY));
    const destination = view.grid.neighbors(view.grid.index(actor.cellX, actor.cellY))
      .map(index => view!.grid.point(index)).find(point => !occupied.has(view!.grid.index(point.x, point.y)))!;
    assert.ok(destination);
    const accepted = clickOrder(view, [combatant.id], destination, "move");
    assert.equal(accepted, "move");
    const beforeTick = view.simulation.snapshot.tick;
    view.resetClock(); view.update(0);
    for (let offset = 1; offset <= 40; offset++) {
      view.update(offset * 50);
      assert.equal(view.missionDiagnostic, undefined);
    }
    assert.equal(view.simulation.snapshot.tick, beforeTick + 40);
    const moved = view.simulation.snapshot.units.find(unit => unit.id === combatant.id)!;
    assert.ok(moved.xSubcells !== actor.xSubcells || moved.ySubcells !== actor.ySubcells);
    const result = { accepted, actorId: combatant.id, destination, tick: view.simulation.snapshot.tick,
      before: { x: actor.xSubcells, y: actor.ySubcells }, after: { x: moved.xSubcells, y: moved.ySubcells } };
    write("input-check", result);
    emit("input-check-pass", result);
  } else if (proofDirectory) {
    process.send?.({ phase: "proof" });
    const pending = JSON.parse(readFileSync(`${proofDirectory}/pending-win.json`, "utf8"));
    const ready = JSON.parse(readFileSync(`${proofDirectory}/checkpoint.json`, "utf8"));
    assert.equal(pending.sourceHash, sourceHash);
    assert.equal(ready.sourceHash, sourceHash);
    assert.equal(pending.tick, pending.checkpoint.simulation.tick);
    const fromTick = pending.tick;
    const toTick = ready.view.simulation.tick;
    assert.ok(Number.isSafeInteger(fromTick) && Number.isSafeInteger(toTick) && toTick > fromTick);
    emit("proof-start", { proofDirectory, fromTick, toTick });
    view = MissionView.restore(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission,
      JSON.parse(JSON.stringify(pending.checkpoint)));
    assert.deepEqual(view.checkpoint(), pending.checkpoint);
    await view.initialize();
    assert.equal(view.missionDiagnostic, undefined);
    assert.equal(view.missionOutcome?.resultCode, 0);
    assert.equal(view.missionOutcome?.ready, false);
    view.resetClock(); view.update(0);
    for (let offset = 1; offset <= toTick - fromTick; offset++) {
      view.update(offset * 50);
      assert.equal(view.missionDiagnostic, undefined);
    }
    assert.equal(view.missionOutcome?.resultCode, 0);
    assert.equal(view.missionOutcome?.ready, true);
    assert.equal(view.missionStatistics["1,0,86"], 6);
    const actual = view.checkpoint();
    assert.deepEqual(actual, ready.view);
    write("restored-ready", actual);
    const proof = { status: "WIN", sourceHash, fromTick, toTick, exactCheckpoint: true,
      expectedHash: hash(JSON.stringify(ready.view)), actualHash: hash(JSON.stringify(actual)),
      outcome: view.missionOutcome, statistics: view.missionStatistics, elapsedMs: Math.round(performance.now() - started) };
    write("proof", proof); emit("pending-to-ready-verified", proof);
    console.log(JSON.stringify({ output, ...proof }));
  } else {
  const stages = [{ x: 30, y: 65 }, { x: 55, y: 65 }, { x: 78, y: 65 }, { x: 85, y: 57 }];
  const avoid = (grid: NavigationGrid, occupied: readonly GridPoint[] = [], origin?: GridPoint) => {
    const cells = new Set(occupied.map(point => grid.index(point.x, point.y)));
    for (let cellY = 0; cellY < grid.height; cellY++) for (let cellX = 0; cellX < grid.width; cellX++) {
      if (Math.hypot(cellX - 81, cellY - 38) <= 12 ||
        ((!origin || Math.hypot(origin.x - 65, origin.y - 54) > 8) && Math.hypot(cellX - 65, cellY - 54) <= 8)) {
        cells.add(grid.index(cellX, cellY));
      }
    }
    return cells;
  };
  const approach = (grid: NavigationGrid, blocked: Set<number>, start: GridPoint, destination: GridPoint, radius = 4) => {
    const candidates: GridPoint[] = [];
    for (let offsetY = -radius; offsetY <= radius; offsetY++) for (let offsetX = -radius; offsetX <= radius; offsetX++) {
      candidates.push({ x: destination.x + offsetX, y: destination.y + offsetY });
    }
    candidates.sort((left, right) => Math.hypot(left.x - destination.x, left.y - destination.y) -
      Math.hypot(right.x - destination.x, right.y - destination.y));
    for (const candidate of candidates) {
      const route = findPath(grid, start, candidate, { blocked });
      if (route) return route;
    }
    return null;
  };
  if (process.argv.includes("--check")) {
    const grid = new NavigationGrid(saved.view.simulation.grid.width, saved.view.simulation.grid.height,
      Uint16Array.from(saved.view.simulation.grid.costs));
    const force = saved.view.simulation.units.filter((actor: { team: number; health: number; weapon: unknown }) =>
      actor.team === 0 && actor.health > 0 && actor.weapon);
    const paths = force.map((actor: { id: number; health: number; xSubcells: number; ySubcells: number }) => {
      let origin = { x: Math.floor(actor.xSubcells / SUBCELLS_PER_CELL), y: Math.floor(actor.ySubcells / SUBCELLS_PER_CELL) };
      return { id: actor.id, health: actor.health, origin, legs: stages.map(stage => {
        const route = approach(grid, avoid(grid), origin, stage);
        if (route) origin = route[route.length - 1];
        return { stage, route };
      }) };
    });
    write("preflight", { sourceHash, paths, limitation: "Saved owned actors and terrain only; runtime static footprints checked after authenticated restore." });
    assert.equal(force.length, 6);
    assert.ok(paths.every((actor: { legs: { route: unknown }[] }) => actor.legs.every(leg => leg.route)));
    emit("preflight-pass", { force: force.length, stages });
  } else {
  emit("restore-start", { path, sourceHash, checkpointHash: hash(readFileSync(path)) });
  view = MissionView.restore(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission, saved.view);
  await view.initialize();
  assert.equal(view.missionDiagnostic, undefined);
  const snapshot = view.simulation.snapshot;
  const visible = view.visibility;
  const owned = snapshot.units.filter(actor => view!.isOwnedUnit(actor.id) && actor.health > 0);
  const enemies = [...snapshot.units, ...snapshot.staticTargets].filter(actor => actor.health > 0 &&
    visible[actor.cellY * view!.grid.width + actor.cellX] &&
    areHostile({ faction: "alien", team: 0 }, actor, snapshot.teamAlliances));
  const blocked = new Set(view.simulation.staticObstacleCells.map(point => view!.grid.index(point.x, point.y)));
  for (let cellY = 0; cellY < view.grid.height; cellY++) for (let cellX = 0; cellX < view.grid.width; cellX++) {
    if (Math.hypot(cellX - 81, cellY - 38) <= 12) blocked.add(view.grid.index(cellX, cellY));
  }
  const destinations = [{ x: 80, y: 58 }, { x: 85, y: 55 }, { x: 65, y: 54 }];
  const routes = owned.map(actor => ({ id: actor.id, destinations: destinations.map(destination => ({ destination,
    route: findPath(view!.grid, { x: actor.cellX, y: actor.cellY }, destination, { blocked }) })) }));
  const report = { sourceHash, tick: snapshot.tick, restoreMs: Math.round(performance.now() - started),
    statistics: view.missionStatistics, credits: view.resourceWorkflow.credits[0], owned, visibleEnemies: enemies,
    resources: view.resourceSources.filter(source => visible[(source.position.y >> 8) * view!.grid.width + (source.position.x >> 8)]),
    economy: view.browserEconomyState, routes, grid: { width: view.grid.width, height: view.grid.height } };
  write("inspection", report);
  emit("inspection", report);
  console.log(JSON.stringify({ output, tick: snapshot.tick, restoreMs: report.restoreMs }));
  if (process.argv.includes("--run")) {
    const activeView = view;
    const startTick = snapshot.tick;
    const steppingStart = performance.now();
    process.send?.({ phase: "stepping" });
    const deadline = steppingStart + 600000;
    const pointOf = (actor: { cellX: number; cellY: number }) => ({ x: actor.cellX, y: actor.cellY });
    const distance = (left: GridPoint, right: GridPoint) => Math.hypot(left.x - right.x, left.y - right.y);
    const savedCombatants = new Set<number>(saved.view.simulation.units.filter(
      (actor: { team: number; health: number; weapon: unknown }) => actor.team === 0 && actor.health > 0 && actor.weapon)
      .map((actor: { id: number }) => actor.id));
    const forceIds = new Set(owned.filter(actor => savedCombatants.has(actor.id)).map(actor => actor.id));
    const weaponRanges = new Map<number, number>(saved.view.simulation.units.filter(
      (actor: { id: number }) => forceIds.has(actor.id)).map(
      (actor: { id: number; weapon: { rangeCells: number } }) => [actor.id, actor.weapon.rangeCells]));
    const strategy = saved.strategy ?? JSON.parse(readFileSync("/tmp/dc-m02-alien-win-SptQgw/checkpoint.json", "utf8")).strategy;
    const goals: { key: string; x: number; y: number }[] = strategy.sourceGoals;
    const cleared = new Set<string>(saved.finalAssault?.cleared ?? strategy.cleared);
    const seenGoals = new Map<number, string>();
    const signatures = new Map<number, { signature: string; tick: number }>();
    let stage = saved.finalAssault?.stage ?? 0, commands = 0, shots = 0, deaths = 0, clock = 0;
    let reason = "stepping-budget", pending: { tick: number; checkpoint: ReturnType<MissionView["checkpoint"]> } | undefined;
    let progressTick = startTick, bestDistance = Infinity, lastStage = -1;
    const observe = () => {
      const current = activeView.simulation.snapshot;
      const fog = activeView.visibility;
      const force = current.units.filter(actor => forceIds.has(actor.id) && actor.health > 0 && actor.activity !== "die");
      const hostiles = [...current.units, ...current.staticTargets].filter(actor => actor.health > 0 &&
        fog[actor.cellY * activeView.grid.width + actor.cellX] &&
        areHostile({ faction: "alien", team: 0 }, actor, current.teamAlliances));
      for (const target of hostiles) {
        const goal = goals.find(goal => goal.x === target.cellX && goal.y === target.cellY);
        if (goal) seenGoals.set(target.id, goal.key);
      }
      return { current, force, hostiles, fog };
    };
    const order = (ids: number[], destination: GridPoint, mode: "move" | "assault", purpose: string, targetId?: number) => {
      if (!ids.length) return true;
      const tick = activeView.simulation.snapshot.tick;
      if (targetId !== undefined) {
        assert.ok(observe().hostiles.some(actor => actor.id === targetId), "Direct attacks require current visible hostility");
      }
      const signature = JSON.stringify({ destination, mode, targetId });
      ids = ids.filter(id => signatures.get(id)?.signature !== signature || tick - signatures.get(id)!.tick >= 200);
      if (!ids.length) return true;
      const cursor = clickOrder(activeView, ids, destination, mode);
      if (cursor === "blocked") { emit("blocked-order", { ids, destination, mode, purpose }); return false; }
      for (const id of ids) signatures.set(id, { signature, tick });
      commands++;
      emit("order", { ids, destination, mode, purpose, targetId, cursor,
        visible: !!activeView.visibility[destination.y * activeView.grid.width + destination.x] });
      return true;
    };
    const plan = () => {
      const { force, hostiles, current } = observe();
      if (!force.length) { reason = "combat-force-exhausted"; return false; }
      const remaining = goals.filter(goal => !cleared.has(goal.key));
      const destination = stages[stage] ?? remaining[0];
      if (!destination) return true;
      const obstacles = activeView.simulation.staticObstacleCells;
      const legs = force.map(actor => ({ actor, route: approach(activeView.grid,
        avoid(activeView.grid, obstacles, pointOf(actor)), pointOf(actor), destination) }));
      if (legs.every(leg => !leg.route)) { reason = "no-live-passable-route"; emit("route-exhausted", { stage, destination }); return false; }
      const remainingDistance = legs.reduce((sum, leg) => sum + (leg.route?.length ?? 1000), 0);
      if (stage !== lastStage || remainingDistance < bestDistance - 2) {
        bestDistance = remainingDistance; progressTick = current.tick; lastStage = stage;
      }
      const target = hostiles.filter(enemy => force.some(actor => distance(pointOf(actor), pointOf(enemy)) <=
        (seenGoals.has(enemy.id) ? 10 : 6))).sort((left, right) =>
        Number(seenGoals.has(left.id)) - Number(seenGoals.has(right.id)) || left.health - right.health || left.id - right.id)[0];
      if (target) {
        let engaged = false;
        for (const actor of force) {
          const range = weaponRanges.get(actor.id)!;
          const separation = Math.hypot(actor.xSubcells - target.xSubcells, actor.ySubcells - target.ySubcells) / SUBCELLS_PER_CELL;
          if (separation <= range - 0.25) {
            if (actor.activity === "attack" && actor.targetId === target.id) { engaged = true; continue; }
            engaged = order([actor.id], pointOf(target), "assault",
              seenGoals.has(target.id) ? "visible-original-objective" : "visible-flank-defense", target.id) || engaged;
            continue;
          }
          if (!seenGoals.has(target.id)) continue;
          const occupancy = avoid(activeView.grid, obstacles, pointOf(actor));
          const candidates: { point: GridPoint; route: readonly GridPoint[] }[] = [];
          for (let offsetY = -range; offsetY <= range; offsetY++) for (let offsetX = -range; offsetX <= range; offsetX++) {
            if (Math.hypot(offsetX, offsetY) > range - 0.75) continue;
            const point = { x: target.cellX + offsetX, y: target.cellY + offsetY };
            if (force.some(other => other.id !== actor.id && other.cellX === point.x && other.cellY === point.y)) continue;
            const route = findPath(activeView.grid, pointOf(actor), point, { blocked: occupancy });
            if (route) candidates.push({ point, route });
          }
          candidates.sort((left, right) => left.route.length - right.route.length || left.point.y - right.point.y || left.point.x - right.point.x);
          const route = candidates[0]?.route;
          if (route) engaged = order([actor.id], route[Math.min(7, route.length - 1)], "move", "safe-objective-firing-position") || engaged;
        }
        if (engaged) return true;
      }
      if (current.tick - progressTick > 700) { reason = "flank-stalled-700-ticks"; return false; }
      if (stage < stages.length && legs.every(leg => leg.route && leg.route.length <= 6)) {
        emit("stage-reached", { stage, destination });
        stage++; signatures.clear(); return true;
      }
      for (const { actor, route } of legs) {
        if (!route || route.length <= (stage < stages.length ? 4 : 1)) continue;
        order([actor.id], route[Math.min(7, route.length - 1)], "move", `southern-flank-stage-${stage}`);
      }
      return true;
    };
    activeView.replaceSelection([...forceIds]);
    activeView.stopSelected();
    emit("order", { ids: [...forceIds], mode: "stop", purpose: "replace-old-army-assembly", purchases: 0 });
    activeView.resetClock();
    activeView.update(0);
    emit("assault-start", { forceIds: [...forceIds], stages, maxStepMs: deadline - steppingStart, restoreBudgetMs: 900000, proofBudgetMs: 900000 });
    while (performance.now() < deadline) {
      const tick = activeView.simulation.snapshot.tick;
      if (activeView.missionDiagnostic) { reason = activeView.missionDiagnostic; break; }
      if (activeView.missionOutcome?.ready) { reason = "ready-outcome"; break; }
      if (!pending && (tick - startTick) % 40 === 0 && !plan()) break;
      activeView.update(clock += 50);
      assert.ok(activeView.simulation.snapshot.tick > tick || activeView.missionDiagnostic || activeView.missionOutcome?.ready,
        "MissionView did not advance");
      const combat = activeView.simulation.combatEvents, casualties = activeView.simulation.deathEvents;
      shots += combat.length; deaths += casualties.length;
      if (combat.some(event => forceIds.has(event.attackerId) && event.damage > 0)) progressTick = tick;
      if (combat.length || casualties.length) emit("combat", { combat, deaths: casualties });
      for (const casualty of casualties) {
        const goal = seenGoals.get(casualty.targetId);
        if (goal) { cleared.add(goal); emit("goal-killed", { goal, targetId: casualty.targetId }); progressTick = tick; }
      }
      if (activeView.missionOutcome?.resultCode === 0 && !activeView.missionOutcome.ready && !pending) {
        pending = { tick: activeView.simulation.snapshot.tick, checkpoint: activeView.checkpoint() };
        write("pending-win", { sourceHash, ...pending });
        emit("pending-win", { tick: pending.tick, outcome: activeView.missionOutcome });
      }
      if ((tick - startTick) % 100 === 99) {
        const observation = observe();
        const progress = { stage, force: observation.force, visibleEnemies: observation.hostiles,
          statistics: activeView.missionStatistics, credits: activeView.resourceWorkflow.credits[0], shots, deaths, commands };
        emit("progress", progress);
        write("latest-progress", { tick: activeView.simulation.snapshot.tick, ...progress });
      }
    }
    const checkpoint = activeView.checkpoint();
    write("checkpoint", { sourceHash, view: checkpoint, strategy: { ...strategy, cleared: [...cleared] },
      finalAssault: { stage, cleared: [...cleared], forceIds: [...forceIds] } });
    write("play-result", { tick: activeView.simulation.snapshot.tick, reason, outcome: activeView.missionOutcome,
      statistics: activeView.missionStatistics, commands, shots, deaths, steppingMs: Math.round(performance.now() - steppingStart) });
    let restoreVerified = false;
    if (activeView.missionOutcome?.ready && activeView.missionOutcome.resultCode === 0 && pending) {
      assert.equal(activeView.missionStatistics["1,0,86"], 6);
      process.send?.({ phase: "proof" });
      emit("proof-start", { fromTick: pending.tick, toTick: activeView.simulation.snapshot.tick });
      const restored = MissionView.restore(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission,
        JSON.parse(JSON.stringify(pending.checkpoint)));
      try {
        assert.deepEqual(restored.checkpoint(), pending.checkpoint);
        await restored.initialize();
        restored.resetClock(); restored.update(0);
        for (let offset = 1; offset <= activeView.simulation.snapshot.tick - pending.tick; offset++) restored.update(offset * 50);
        assert.deepEqual(restored.missionOutcome, activeView.missionOutcome);
        assert.equal(restored.missionStatistics["1,0,86"], 6);
        assert.deepEqual(restored.checkpoint(), checkpoint);
        write("restored-ready", restored.checkpoint());
        write("proof", { status: "WIN", fromTick: pending.tick, toTick: activeView.simulation.snapshot.tick,
          expectedHash: hash(JSON.stringify(checkpoint)), actualHash: hash(JSON.stringify(restored.checkpoint())),
          originalType86Deaths: restored.missionStatistics["1,0,86"], exactCheckpoint: true, sourceHash });
        restoreVerified = true;
        emit("pending-to-ready-verified", { fromTick: pending.tick, toTick: activeView.simulation.snapshot.tick, exactCheckpoint: true });
      } finally { restored.dispose(); }
    }
    assert.equal(hash(JSON.stringify(mission)), sourceHash);
    const result = { status: restoreVerified ? "WIN" : activeView.missionOutcome?.ready ? "UNVERIFIED-OUTCOME" : "EXHAUSTED",
      reason, startTick, tick: activeView.simulation.snapshot.tick, stage, shots, deaths, commands, purchases: 0,
      statistics: activeView.missionStatistics, outcome: activeView.missionOutcome, force: observe().force,
      credits: activeView.resourceWorkflow.credits[0], steppingMs: Math.round(performance.now() - steppingStart),
      totalMs: Math.round(performance.now() - started), sourceHash, restoreVerified,
      limitation: "Node real MissionView and original TRO, null canvas; no browser, visual, or full-game completion claim." };
    write("result", result); emit("result", result);
    console.log(JSON.stringify({ output, ...result }));
    if (!restoreVerified) process.exitCode = 1;
  }
  }
  }
} catch (error) {
  emit("failure", { message: error instanceof Error ? error.stack : String(error) });
  process.exitCode = 1;
} finally {
  view?.dispose();
  renderer.dispose();
  globalThis.fetch = originalFetch;
}
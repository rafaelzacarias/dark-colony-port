import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadReleaseMission, savedView } from "./fixtures/release-mission";
import { MissionView } from "../../src/mission-view";
import { NavigationGrid, type GridPoint } from "../../src/engine/grid";
import { findPath } from "../../src/engine/pathfinding";
import { areHostile } from "../../src/engine/diplomacy";
import { parseTriggerScript } from "../extractors/data/triggers";
import { installSourceRender } from "./fixtures/source-render";

const root = new URL("../../", import.meta.url);
const syncIsolation = { detached: true };
const read = (path: string) => readFileSync(new URL(path, root));
export const digestFinal = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
type SavedView = ReturnType<MissionView["checkpoint"]>;
type Actor = MissionView["simulation"]["snapshot"]["units"][number];
type SavedFinal = { sourceHash: string; view: SavedView };
export function sourceFinal(number: 5 | 6) {
  const stem = `raw_cd/DC/SCENARIO/ALIEN/ALIEN0${number}`;
  const triggers = parseTriggerScript(read(`${stem}.TRO`).toString());
  const tags = read(`${stem}.MTG`), width = tags[0], height = tags[1];
  assert.equal(tags.length, width * height + 2);
  const trips = Object.fromEntries(triggers.filter(block => block.mode === "trip").map(block => [block.id,
    Array.from(tags.subarray(2)).flatMap((tag, index) => (tag & 63) === block.id
      ? [{ x: index % width, y: height - 1 - Math.floor(index / width) }] : [])]));
  const sources = Object.fromEntries(["SCN", "TRO", "MTG", "MAP", "PTH"].map(extension =>
    [extension, digestFinal(read(`${stem}.${extension}`))]));
  return { number, triggers, trips, sources, width, height };
}

export function safeTerrainFinal(grid: NavigationGrid, start: GridPoint, goals: readonly GridPoint[],
  obstacles: ReadonlySet<number> = new Set()) {
  const blocked = new Set(obstacles);
  if (grid.contains(25, 39)) blocked.add(grid.index(25, 39));
  return goals.flatMap(goal => {
    const path = findPath(grid, start, goal, { blocked });
    return path ? [{ goal, path }] : [];
  }).sort((left, right) => left.path.length - right.path.length)[0];
}

export function finalStatus(outcome: MissionView["missionOutcome"], diagnostic: string | undefined, exact = false) {
  if (diagnostic) return "RUNTIME_BLOCKER";
  if (!outcome?.ready) return "HARNESS_LIMIT";
  if (outcome.resultCode !== 0) return "SOURCE_LOSS";
  return exact ? "WIN" : "READY_WIN_UNVERIFIED";
}

function fingerprints() {
  const files = readdirSync(new URL("src/", root), { recursive: true }).map(String).filter(path => path.endsWith(".ts"))
    .map(path => `src/${path}`).concat(["tools/qa/mission05-playthrough.ts", "tools/qa/mission05-current-human.test.ts",
      "tools/qa/fixtures/source-render.ts"]);
  return Object.fromEntries(files.sort().map(path => [path, digestFinal(read(path))]));
}

export async function preflightFinal(output: string) {
  mkdirSync(output, { recursive: true });
  const renderer = installSourceRender(); renderer.setEnabled(false);
  const originalFetch = globalThis.fetch, before = fingerprints();
  const write = (name: string, value: unknown) => writeFileSync(`${output}/${name}.json`, JSON.stringify(value));
  const fetched: Record<string, string> = {};
  globalThis.fetch = async input => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    const bytes = read(`public${path}`); fetched[path] = digestFinal(bytes);
    return new Response(bytes);
  };
  try {
    for (const number of [5, 6] as const) {
      let view: MissionView | undefined;
      try {
        const contract = sourceFinal(number), mission = await loadReleaseMission("alien", number);
        assert.deepEqual(mission.triggers, contract.triggers);
        assert.equal(mission.scenario.source.sha256, contract.sources.SCN);
        view = new MissionView(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
        await view.initialize(); view.resetClock(); view.update(0);
        for (let tick = 1; tick <= (number === 5 ? 120 : 448); tick++) {
          view.update(tick * 50); assert.equal(view.missionDiagnostic, undefined);
        }
        const saved = view.checkpoint(), snapshot = view.simulation.snapshot;
        const owned = snapshot.units.filter(actor => actor.health > 0 && view!.isOwnedUnit(actor.id));
        const routes = number === 5 ? owned.map(actor => ({ actorId: actor.id,
          support: safeTerrainFinal(view!.grid, { x: actor.cellX, y: actor.cellY }, contract.trips[2]),
          rescue: safeTerrainFinal(view!.grid, { x: actor.cellX, y: actor.cellY }, contract.trips[17]) })) : [];
        write(`a0${number}-preflight`, { contract, briefing: mission.briefing?.plainText, scenario: mission.scenario,
          owned, routes, world: view.campaignSnapshot!.world, ai: saved.browserAi,
          menu: view.productionMenu, resources: view.resourceSources, diagnostic: view.missionDiagnostic ?? null,
          tick: snapshot.tick, sourceHash: digestFinal(JSON.stringify(mission)) });
        write(`a0${number}-opening`, { sourceHash: digestFinal(JSON.stringify(mission)), view: saved });
      } catch (error) { write(`a0${number}-blocker`, { status: "RUNTIME_BLOCKER", error: String(error) }); throw error; }
      finally { view?.dispose(); }
    }
  } finally {
    const after = fingerprints();
    write("integrity", { before, changed: Object.keys(before).filter(path => before[path] !== after[path]),
      fetched, assetChanged: Object.keys(fetched).filter(path => fetched[path] !== digestFinal(read(`public${path}`))) });
    renderer.dispose(); globalThis.fetch = originalFetch;
  }
}

export function finalStage(lives: Readonly<Record<number, number>>) {
  return lives[2] !== 0 ? 2 : lives[8] !== 0 ? 8 : lives[10] !== 0 ? 10 : lives[17] !== 0 ? 17 : lives[18] !== 0 ? 18 : 19;
}

export function finalFiringCells(grid: NavigationGrid, start: GridPoint,
  threats: readonly (GridPoint & { range: number })[], ownRange: number) {
  return Array.from(grid.costs.keys()).map(index => grid.point(index)).filter(cell => grid.isPassable(cell.x, cell.y) &&
    threats.every(threat => Math.abs(cell.x - threat.x) + Math.abs(cell.y - threat.y) > threat.range + 0.25) &&
    threats.some(threat => Math.abs(cell.x - threat.x) + Math.abs(cell.y - threat.y) <= ownRange - 0.25))
    .sort((left, right) => Math.abs(left.x - start.x) + Math.abs(left.y - start.y) - Math.abs(right.x - start.x) - Math.abs(right.y - start.y));
}

export function finalWaypoint(grid: NavigationGrid, start: GridPoint, path: readonly GridPoint[], blocked: ReadonlySet<number>) {
  for (let index = Math.min(10, path.length - 1); index > 0; index--) {
    const waypoint = path[index], actual = findPath(grid, start, waypoint);
    if (actual && actual.every(cell => !blocked.has(grid.index(cell.x, cell.y)) && (cell.x !== 25 || cell.y !== 39))) {
      return { waypoint, path: actual };
    }
  }
  return undefined;
}

export async function playFinal(output: string, proofDirectory?: string) {
  mkdirSync(output, { recursive: true });
  const started = performance.now(), before = fingerprints(), renderer = installSourceRender();
  renderer.setEnabled(false);
  const originalFetch = globalThis.fetch, fetched: Record<string, string> = {};
  const write = (name: string, value: unknown) => writeFileSync(`${output}/${name}.json`, JSON.stringify(value));
  let view: MissionView | undefined;
  let status = "RUNTIME_BLOCKER", reason = "initializing", commands = 0, stage = 2, playMs = 0;
  const emit = (kind: string, data: unknown) => appendFileSync(`${output}/journal.jsonl`, `${JSON.stringify({
    kind, tick: view?.simulation.snapshot.tick ?? 0, elapsedMs: Math.round(performance.now() - started), data })}\n`);
  globalThis.fetch = async input => {
    const path = String(input); assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    const bytes = read(`public${path}`); fetched[path] = digestFinal(bytes); return new Response(bytes);
  };
  try {
    const resumeCheckpoint = process.env.DC_FINAL_A05_RESUME && `${process.env.DC_FINAL_A05_RESUME}/checkpoint.json`;
    const contract = sourceFinal(5), mission = await loadReleaseMission("alien", 5,
      savedView(proofDirectory ? `${proofDirectory}/pending-win.json` : resumeCheckpoint || undefined));
    assert.deepEqual(mission.triggers, contract.triggers);
    assert.equal(mission.scenario.source.sha256, contract.sources.SCN);
    const sourceHash = digestFinal(JSON.stringify(mission));
    write("source", { contract, sourceHash, briefing: mission.briefing?.plainText,
      limits: { playMs: 600000, proofMs: 900000, totalMs: 1180000 },
      limitation: "Original browser-adapted MissionView, NullCanvas; not native parity or browser visual verification." });
    if (proofDirectory) {
      const pending = JSON.parse(readFileSync(`${proofDirectory}/pending-win.json`, "utf8")) as SavedFinal;
      const ready = JSON.parse(readFileSync(`${proofDirectory}/checkpoint.json`, "utf8")) as SavedFinal;
      assert.equal(pending.sourceHash, sourceHash); assert.equal(ready.sourceHash, sourceHash);
      view = MissionView.restore(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission, pending.view);
      assert.deepEqual(view.checkpoint(), pending.view); await view.initialize();
      assert.deepEqual(view.checkpoint(), pending.view);
      assert.equal(view.missionOutcome?.resultCode, 0); assert.equal(view.missionOutcome?.ready, false);
      const ticks = ready.view.simulation.tick - pending.view.simulation.tick;
      assert.ok(ticks > 0 && ticks <= 1000); view.resetClock(); view.update(0);
      for (let offset = 1; offset <= ticks; offset++) {
        view.update(offset * 50); assert.equal(view.missionDiagnostic, undefined);
      }
      const actual = view.checkpoint(); assert.deepEqual(actual, ready.view);
      assert.equal(view.missionOutcome?.ready, true); assert.equal(view.missionOutcome?.resultCode, 0);
      write("proof", { exact: true, fromTick: pending.view.simulation.tick, toTick: actual.simulation.tick,
        expectedHash: digestFinal(JSON.stringify(ready.view)), actualHash: digestFinal(JSON.stringify(actual)),
        elapsedMs: performance.now() - started });
      status = "WIN"; reason = "exact-pending-to-ready";
      return;
    }
    const resumeDirectory = process.env.DC_FINAL_A05_RESUME;
    const previous = resumeDirectory ? JSON.parse(readFileSync(`${resumeDirectory}/result.json`, "utf8")) : undefined;
    const saved = resumeDirectory ? JSON.parse(readFileSync(`${resumeDirectory}/checkpoint.json`, "utf8")) as SavedFinal : undefined;
    const priorPlayMs = Number(previous?.playMs ?? 0);
    assert.ok(priorPlayMs >= 0 && priorPlayMs < 600000);
    if (saved) assert.equal(saved.sourceHash, sourceHash);
    view = saved ? MissionView.restore(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission, saved.view)
      : new MissionView(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
    if (saved) assert.deepEqual(view.checkpoint(), saved.view);
    await view.initialize(); assert.equal(view.missionDiagnostic, undefined);
    if (saved) {
      assert.deepEqual(view.checkpoint(), saved.view);
      write("resume-proof", { exact: true, input: `${resumeDirectory}/checkpoint.json`, priorPlayMs,
        hash: digestFinal(JSON.stringify(saved.view)), tick: saved.view.simulation.tick });
    }
    const active = view;
    const save = (name: string) => {
      const saved = { sourceHash, view: active.checkpoint() };
      write(name, saved); return saved;
    };
    let lastJournal = -1, lives: Record<number, number> = { ...active.checkpoint().session!.state.controller.runtime.lives };
    let intent: { waypoint: GridPoint; path: readonly GridPoint[] } | undefined;
    let lastPosition = "", lastAdvance = active.simulation.snapshot.tick, lastStage = 0, bestDistance = Infinity, bestTick = active.simulation.snapshot.tick;
    let clock = 0, pending = false, allyStart: unknown;
    const point = (actor: Actor) => ({ x: actor.cellX, y: actor.cellY });
    const position = (actor: { xSubcells: number; ySubcells: number }) => ({ x: (actor.xSubcells - 512) / 1024, y: (actor.ySubcells - 512) / 1024 });
    const manhattan = (left: GridPoint, right: GridPoint) => Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
    const order = (actor: Actor, destination: GridPoint, mode: "move" | "assault") => {
      assert.ok(active.isOwnedUnit(actor.id)); active.replaceSelection([actor.id]);
      assert.deepEqual(active.selectedIds, [actor.id]);
      active.setCameraCenter(destination.x + 0.5, destination.y + 0.5); active.setOrderMode(mode);
      const camera = active.cameraView, bounds = active.canvas.getBoundingClientRect(), scale = 512 / camera.width;
      const clientX = bounds.left + (destination.x + 0.5 - camera.x) * scale * bounds.width / 512;
      const clientY = bounds.top + (226 - (destination.y + 0.5 - camera.y - camera.height / 2) * scale) * bounds.height / 452;
      const cursor = active.cursorAt(clientX, clientY);
      if (cursor === "blocked") return false;
      active.commandAt(clientX, clientY); commands++; emit("command", { actorId: actor.id, destination, mode, stage, cursor }); return true;
    };
    const summary = () => {
      const snapshot = active.simulation.snapshot;
      const visible = [...snapshot.units, ...snapshot.staticTargets].filter(actor => actor.health > 0 && active.visibility[actor.cellY * active.grid.width + actor.cellX]);
      return { tick: snapshot.tick, stage, lives, owned: snapshot.units.filter(actor => active.isOwnedUnit(actor.id)),
        visible, outcome: active.missionOutcome ?? null, diagnostic: active.missionDiagnostic ?? null,
        statistics: active.missionStatistics, commands, playMs };
    };
    const plan = () => {
      const snapshot = active.simulation.snapshot, actor = snapshot.units.find(unit => unit.health > 0 && active.isOwnedUnit(unit.id));
      if (!actor || active.missionOutcome || stage === 19) return;
      const visible = [...snapshot.units, ...snapshot.staticTargets].filter(unit => unit.health > 0 && active.visibility[unit.cellY * active.grid.width + unit.cellX]);
      const enemies = visible.filter(unit => areHostile({ faction: "alien", team: 0 }, unit, snapshot.teamAlliances));
      const equipment = active.simulation.checkpoint();
      const metadata = [...equipment.units, ...equipment.staticTargets];
      const threats = enemies.flatMap(enemy => {
        const range = metadata.find(entry => entry.id === enemy.id)?.weapon?.rangeCells;
        return range === undefined ? [] : [{ id: enemy.id, ...position(enemy), range }];
      });
      const ownRange = metadata.find(entry => entry.id === actor.id)?.weapon?.rangeCells ?? 0;
      const location = `${actor.xSubcells},${actor.ySubcells}`;
      if (location !== lastPosition) { lastPosition = location; lastAdvance = snapshot.tick; }
      if (stage !== lastStage) { lastStage = stage; bestDistance = Infinity; bestTick = snapshot.tick; intent = undefined; emit("stage", summary()); }
      const goals = contract.trips[stage];
      if (!goals) return;
      const remaining = Math.min(...goals.map(goal => manhattan(position(actor), goal)));
      if (remaining < bestDistance - 0.5) { bestDistance = remaining; bestTick = snapshot.tick; }
      if (snapshot.tick - bestTick > 1400) { reason = "no-stage-progress-1400-ticks"; return; }
      if (actor.health <= 240) { reason = "commander-health-reserve"; return; }
      const obstacles = new Set(active.simulation.staticObstacleCells.map(cell => active.grid.index(cell.x, cell.y)));
      const blocked = new Set(obstacles); blocked.add(active.grid.index(25, 39));
      for (const cell of visible) if (cell.id !== actor.id) blocked.add(active.grid.index(cell.cellX, cell.cellY));
      for (const threat of threats) {
        const clearance = Math.min(threat.range + 0.5, manhattan(position(actor), threat));
        for (let cellY = Math.max(0, Math.floor(threat.y - threat.range - 2)); cellY <= Math.min(active.grid.height - 1, threat.y + threat.range + 2); cellY++) {
          for (let cellX = Math.max(0, Math.floor(threat.x - threat.range - 2)); cellX <= Math.min(active.grid.width - 1, threat.x + threat.range + 2); cellX++) {
            if (manhattan({ x: cellX, y: cellY }, threat) < clearance - 0.1) blocked.add(active.grid.index(cellX, cellY));
          }
        }
      }
      const unsafe = intent && intent.path.slice(Math.max(0, intent.path.findIndex(cell => cell.x === actor.cellX && cell.y === actor.cellY)))
        .some(cell => blocked.has(active.grid.index(cell.x, cell.y)));
      if (actor.activity === "move" && !unsafe && snapshot.tick - lastAdvance < 80) return;
      if (actor.activity === "move" && unsafe) { active.replaceSelection([actor.id]); active.stopSelected(); commands++; intent = undefined; }
      const pressured = threats.some(threat => manhattan(position(actor), threat) <= threat.range + 0.5);
      const target = !pressured && enemies.find(enemy => active.simulation.canAutoTarget(actor.id, enemy.id) && manhattan(position(actor), position(enemy)) <= ownRange);
      if (target) {
        if (actor.activity !== "attack" || actor.targetId !== target.id) order(actor, { x: target.cellX, y: target.cellY }, "assault");
        bestTick = snapshot.tick; return;
      }
      const route = safeTerrainFinal(active.grid, point(actor), goals, blocked);
      let chosen = route && finalWaypoint(active.grid, point(actor), route.path, blocked);
      if (!chosen && !pressured) {
        for (const goal of finalFiringCells(active.grid, point(actor), threats, ownRange)) {
          const firing = safeTerrainFinal(active.grid, point(actor), [goal], blocked);
          chosen = firing && finalWaypoint(active.grid, point(actor), firing.path, blocked);
          if (chosen) break;
        }
      }
      if (!chosen && pressured) {
        const candidates = Array.from(active.grid.costs.keys()).map(index => active.grid.point(index)).filter(cell =>
          manhattan(point(actor), cell) <= 10 && threats.every(threat => manhattan(cell, threat) >= threat.range + 2))
          .sort((left, right) => Math.min(...goals.map(goal => manhattan(left, goal))) - Math.min(...goals.map(goal => manhattan(right, goal))));
        for (const goal of candidates) {
          const escape = safeTerrainFinal(active.grid, point(actor), [goal], blocked);
          chosen = escape && finalWaypoint(active.grid, point(actor), escape.path, blocked);
          if (chosen) break;
        }
      }
      if (chosen && order(actor, chosen.waypoint, "move")) intent = chosen;
      if (!chosen && snapshot.tick % 100 === 0) emit("route-block", { actor: point(actor), hp: actor.health, goals, threats,
        terrainRoute: safeTerrainFinal(active.grid, point(actor), goals, obstacles)?.path ?? null });
    };
    save("initial"); active.resetClock(); active.update(0); reason = "playing";
    const playStart = performance.now();
    while (performance.now() - playStart < 600000 - priorPlayMs && active.simulation.snapshot.tick < 30000) {
      const tick = active.simulation.snapshot.tick;
      for (const entry of active.campaignJournal) {
        if (entry.cycleCounter <= lastJournal) continue;
        lastJournal = entry.cycleCounter;
        if (entry.fired.length) { emit("source-trigger", entry); lives = { ...active.checkpoint().session!.state.controller.runtime.lives }; }
      }
      stage = finalStage(lives);
      if (tick % 10 === 0) plan();
      if (reason !== "playing") break;
      active.update(++clock * 50);
      if (active.missionDiagnostic) { reason = active.missionDiagnostic; break; }
      if (active.missionOutcome?.resultCode === 0 && !pending) { save("pending-win"); pending = true; emit("pending-win", summary()); }
      if (active.missionOutcome?.ready) { reason = "source-outcome-ready"; break; }
      if (tick % 200 === 0) { emit("progress", summary()); save("checkpoint"); }
      if (stage !== 2 && allyStart === undefined) {
        allyStart = summary(); write("support-start", allyStart);
      }
    }
    playMs = priorPlayMs + performance.now() - playStart;
    if (reason === "playing") reason = "play-budget-or-tick-limit";
    if (!active.missionOutcome) {
      const owned = active.simulation.snapshot.units.filter(actor => actor.health > 0 && active.isOwnedUnit(actor.id));
      active.replaceSelection(owned.map(actor => actor.id)); active.stopSelected(); commands++;
      emit("stop", { ids: owned.map(actor => actor.id), reason });
    }
    save("checkpoint"); write("final-state", summary());
    status = finalStatus(active.missionOutcome, active.missionDiagnostic);
  } catch (error) { reason = String(error); emit("failure", { reason }); throw error; }
  finally {
    const after = fingerprints();
    const changed = Object.keys(before).filter(path => before[path] !== after[path]);
    const assetChanged = Object.keys(fetched).filter(path => fetched[path] !== digestFinal(read(`public${path}`)));
    write("integrity", { before, changed, fetched, assetChanged });
    write("result", { status, reason, commands, stage, playMs, totalMs: performance.now() - started,
      tick: view?.simulation.snapshot.tick, outcome: view?.missionOutcome ?? null, stableCore: changed.length === 0 && assetChanged.length === 0 });
    view?.dispose(); renderer.dispose(); globalThis.fetch = originalFetch;
  }
}

function superviseFinal(output: string) {
  process.on("SIGINT", () => {});
  mkdirSync(output, { recursive: true });
  const started = Date.now(), self = fileURLToPath(import.meta.url), receipts: unknown[] = [];
  const run = (mode: string, directory: string, cap: number, proof?: string) => {
    const result = spawnSync(process.execPath, ["--import", fileURLToPath(new URL("node_modules/tsx/dist/loader.mjs", root)),
      self, mode, `--output=${directory}`, ...(proof ? [`--proof=${proof}`] : [])],
    { cwd: fileURLToPath(root), ...syncIsolation, stdio: "inherit", timeout: cap, killSignal: "SIGKILL" });
    const receipt = { mode, directory, pid: result.pid, code: result.status, signal: result.signal, error: result.error?.message, reaped: true };
    receipts.push(receipt); writeFileSync(`${output}/processes.json`, JSON.stringify(receipts));
    return result.status === 0;
  };
  let status = "HARNESS_LIMIT";
  if (run("--play", `${output}/a05`, 640000)) {
    const result = JSON.parse(readFileSync(`${output}/a05/result.json`, "utf8")); status = result.status;
    if (status === "READY_WIN_UNVERIFIED") {
      const remaining = Math.min(900000, 1180000 - (Date.now() - started));
      if (remaining > 0 && run("--verify", `${output}/proof`, remaining, `${output}/a05`)) {
        status = JSON.parse(readFileSync(`${output}/proof/result.json`, "utf8")).status;
      }
    }
  }
  writeFileSync(`${output}/summary.json`, JSON.stringify({ a05: status, a06: "NOT_PLAYED_OPENING_ONLY",
    elapsedMs: Date.now() - started, receipts, activeOwnedProcesses: [] }));
}

export function auditFinal(output: string, preflight: string) {
  const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
  const directory = `${output}/a05`, saved = json(`${directory}/checkpoint.json`), result = json(`${directory}/result.json`);
  const events = readFileSync(`${directory}/journal.jsonl`, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const progress = events.filter(event => event.kind === "progress");
  const state = json(`${directory}/final-state.json`), opening06 = json(`${preflight}/a06-opening.json`);
  const source06 = json(`${preflight}/a06-preflight.json`);
  const integrity = json(`${directory}/integrity.json`);
  const processes = spawnSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" }).stdout.split("\n")
    .filter(line => line.includes(fileURLToPath(import.meta.url)) && !line.includes("--audit") && !line.includes("node -e"));
  const report = { a05: { ...result, owned: state.owned, lives: state.lives,
    checkpoint: `${directory}/checkpoint.json`, checkpointHash: digestFinal(readFileSync(`${directory}/checkpoint.json`)),
    wholeViewHash: digestFinal(JSON.stringify(saved.view)), finalRestoreVerified: false,
    triggers: events.filter(event => event.kind === "source-trigger").map(event => ({ tick: event.tick, fired: event.data.fired })),
    support: progress.map(event => ({ tick: event.tick, allies: event.data.visible.filter((actor: Actor) => actor.team === 5)
      .map((actor: Actor) => ({ id: actor.id, x: actor.cellX, y: actor.cellY, hp: actor.health, activity: actor.activity })) })),
    commands: events.filter(event => event.kind === "command"), proofExists: existsSync(`${output}/proof/proof.json`),
    integrity: { changed: integrity.changed, assetChanged: integrity.assetChanged } },
    a06: { status: "NOT_PLAYED_OPENING_ONLY", tick: source06.tick, briefing: source06.briefing,
      owned: source06.owned, credits: source06.menu[0]?.credits, lives: opening06.view.session.state.controller.runtime.lives,
      population: opening06.view.session.state.world.statistics["0,6"],
      source: source06.contract.sources, checkpoint: `${preflight}/a06-opening.json`,
      diagnostic: source06.diagnostic, menu: source06.menu.filter((item: { enabled: boolean }) => item.enabled) },
    activeOwnedProcesses: processes, receipts: json(`${output}/processes.json`) };
  writeFileSync(`${output}/audit.json`, JSON.stringify(report, null, 2));
  assert.deepEqual(processes, []);
  assert.deepEqual(integrity.changed, []); assert.deepEqual(integrity.assetChanged, []);
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = process.argv.find(value => value.startsWith("--output="))?.slice(9);
  assert.ok(output);
  if (process.argv.includes("--preflight")) await preflightFinal(output);
  else if (process.argv.includes("--play")) await playFinal(output);
  else if (process.argv.includes("--verify")) await playFinal(output, process.argv.find(value => value.startsWith("--proof="))?.slice(8));
  else if (process.argv.includes("--run")) superviseFinal(output);
  else if (process.argv.includes("--audit")) auditFinal(output,
    process.argv.find(value => value.startsWith("--preflight-dir="))!.slice(16));
  else if (process.argv.includes("--validate")) {
    process.on("SIGINT", () => {});
    const self = fileURLToPath(import.meta.url), testFile = self.replace(/\.ts$/, ".test.ts");
    const jobs = [
      { name: "tests", command: process.execPath, args: ["--import", fileURLToPath(new URL("node_modules/tsx/dist/loader.mjs", root)), "--test", testFile] },
      { name: "types", command: fileURLToPath(new URL("node_modules/.bin/tsc", root)), args: ["--noEmit", "--strict", "--skipLibCheck",
        "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "bundler", "--lib", "ES2023,DOM", self, testFile] },
    ];
    for (const job of jobs) {
      const log = `${output}/validation-${job.name}-${Date.now()}.log`, descriptor = openSync(log, "wx");
      const result = spawnSync(job.command, job.args, { cwd: fileURLToPath(root), env: { ...process.env, DC_FINAL_ARTIFACTS: output },
        stdio: ["ignore", descriptor, descriptor], ...syncIsolation, timeout: 60000, killSignal: "SIGKILL" });
      closeSync(descriptor);
      writeFileSync(`${output}/validation-${job.name}.json`, JSON.stringify({ log, code: result.status, pid: result.pid, signal: result.signal, reaped: true }));
      if (result.status !== 0) { process.exitCode = 1; break; }
    }
  }
  else if (process.argv.includes("--launch")) {
    process.on("SIGINT", () => {});
    const descriptor = openSync(`${output}-launch.log`, "wx"), started = Date.now();
    const result = spawnSync(process.execPath, ["--import", fileURLToPath(new URL("node_modules/tsx/dist/loader.mjs", root)),
      fileURLToPath(import.meta.url), "--run", `--output=${output}`],
    { cwd: fileURLToPath(root), ...syncIsolation, stdio: ["ignore", descriptor, descriptor] });
    closeSync(descriptor);
    writeFileSync(`${output}-launch-exit.json`, JSON.stringify({ pid: result.pid, code: result.status, signal: result.signal,
      elapsedMs: Date.now() - started, reaped: true }));
  }
}
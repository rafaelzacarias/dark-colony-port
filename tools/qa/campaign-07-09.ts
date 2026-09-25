import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadReleaseMission } from "./fixtures/release-mission";
import { MissionView } from "../../src/mission-view";
import { areHostile } from "../../src/engine/diplomacy";
import { findPath } from "../../src/engine/pathfinding";
import type { GridPoint } from "../../src/engine/grid";
import { installSourceRender } from "./fixtures/source-render";
import { isAir06 } from "./mission06-playthrough";
import { parseTriggerScript } from "../extractors/data/triggers";

export const missionIds = ["A09", "A08", "H07", "A07", "H08", "H09"] as const;
export type MissionId = typeof missionIds[number];
const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
export const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

export function sourceContract(id: MissionId) {
  const faction = id[0] === "H" ? "human" as const : "alien" as const;
  const number = Number(id.slice(1));
  const stem = `raw_cd/DC/SCENARIO/${faction.toUpperCase()}/${faction.toUpperCase()}${id.slice(1)}`;
  const triggers = parseTriggerScript(read(`${stem}.TRO`).toString());
  const mtg = read(`${stem}.MTG`);
  assert.equal(mtg.length - 2, mtg[0] * mtg[1]);
  const trips = Object.fromEntries(triggers.filter(block => block.mode === "trip").map(block => [block.id,
    Array.from(mtg.subarray(2)).flatMap((tag, index) => (tag & 63) === block.id
      ? [{ x: index % mtg[0], y: mtg[1] - 1 - Math.floor(index / mtg[0]) }] : [])]));
  const wins = triggers.filter(block => block.actions.some(action => action.name === "bail" && action.arguments[0] === 0));
  const losses = triggers.filter(block => block.actions.some(action => action.name === "bail" && action.arguments[0] === 1));
  const cityTeams = [...new Set(wins.flatMap(block => [...block.condition.matchAll(/b\((\d+),\d+\)/g)].map(match => Number(match[1]))))];
  const statistics = wins.flatMap(block => [...block.condition.matchAll(/s\((\d+),(\d+)\)==(\d+)/g)]
    .map(match => ({ team: Number(match[1]), selector: Number(match[2]), value: Number(match[3]) })));
  const gates = triggers.filter(block => block.actions.some(action => ["setlifes", "waypoint", "ally", "abduct", "nopickup"].includes(action.name)));
  const sources = Object.fromEntries(["SCN", "TRO", "TXT", "MAP", "MTG", "PTH"].map(extension => [extension, hash(read(`${stem}.${extension}`))]));
  return { id, faction, number, triggers, trips, wins, losses, cityTeams, statistics, gates, sources,
    originalText: read(`${stem}.TXT`).toString() };
}

export function routeStage(id: MissionId, fired: ReadonlySet<number>) {
  if (id === "A09") return !fired.has(2) ? 2 : !fired.has(5) ? null : !fired.has(3) ? 3 : null;
  if (id === "A08") return !fired.has(1) ? 1 : !fired.has(5) ? 5 : !fired.has(20) ? null : !fired.has(6) ? 6 : !fired.has(13) ? null : !fired.has(12) ? 12 : null;
  return null;
}

export function classify(outcome: { ready: boolean; resultCode: number } | null, exact = false, diagnostic?: string) {
  if (diagnostic) return "RUNTIME_BLOCKER";
  if (!outcome?.ready) return outcome ? "PENDING" : "BOUNDED_INCOMPLETE";
  return `${exact ? "" : "UNVERIFIED_"}${outcome.resultCode === 0 ? "WIN" : "LOSS"}`;
}

export function goalTeams(id: MissionId, fired: ReadonlySet<number>) {
  if (id === "A07") return fired.has(12) ? [1] : [2, 7];
  if (id === "A08") return fired.has(19) ? [7] : [];
  return sourceContract(id).cityTeams;
}

const distance = (left: GridPoint, right: GridPoint) => Math.hypot(left.x - right.x, left.y - right.y);
const point = (actor: { cellX: number; cellY: number }) => ({ x: actor.cellX, y: actor.cellY });
export function tripApproach(cells: readonly GridPoint[]) {
  assert.ok(cells.length);
  return { x: Math.round(cells.reduce((total, cell) => total + cell.x, 0) / cells.length), y: Math.min(...cells.map(cell => cell.y)) - 2 };
}
type Saved = { sourceHash: string; runtime: Record<string, string>; view: ReturnType<MissionView["checkpoint"]> };
const write = (directory: string, name: string, data: unknown) => writeFileSync(`${directory}/${name}.json`, JSON.stringify(data));
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));

function runtimeHashes() {
  return Object.fromEntries(readdirSync(new URL("src/", root), { recursive: true }).map(String)
    .filter(path => path.endsWith(".ts") || path.endsWith(".css")).sort()
    .concat(["../tools/qa/fixtures/source-render.ts"]).map(path => [path, hash(read(`src/${path}`))]));
}

export async function play(id: MissionId, output: string, maxTicks: number, budgetMs: number, resume?: string, proof?: string) {
  mkdirSync(output, { recursive: true });
  const started = performance.now(), runtime = runtimeHashes(), contract = sourceContract(id);
  const render = installSourceRender();
  render.setEnabled(false);
  const previousFetch = globalThis.fetch, fetched: Record<string, string> = {};
  globalThis.fetch = async input => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    const bytes = read(`public${path}`); fetched[path] = hash(bytes);
    return new Response(bytes);
  };
  let view: MissionView | undefined, lastInput: unknown = null, loaded = false, initialized = false;
  let result: Record<string, unknown> = {}, commands = 0;
  const emit = (kind: string, data: unknown) => appendFileSync(`${output}/journal.jsonl`, JSON.stringify({
    kind, tick: view?.simulation.snapshot.tick ?? 0, elapsedMs: Math.round(performance.now() - started), data }) + "\n");
  try {
    const policyView = proof ? (json(`${proof}/pending.json`) as Saved).view : resume ? (json(resume) as Saved).view : undefined;
    const mission = await loadReleaseMission(contract.faction, contract.number, policyView);
    loaded = true;
    assert.equal(mission.scenario.source.sha256, contract.sources.SCN);
    assert.deepEqual(mission.triggers, contract.triggers);
    const sourceHash = hash(JSON.stringify(mission));
    write(output, "source", { contract, sourceHash, runtime, scenario: mission.scenario, briefing: mission.briefing,
      limitation: "Actual public browser-adapted MissionView, real source assets, NullCanvas. No browser-pixel or native-parity claim." });
    const make = (saved?: Saved) => {
      if (saved) { assert.equal(saved.sourceHash, sourceHash); assert.deepEqual(saved.runtime, runtime); }
      return saved ? MissionView.restore(render.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission, saved.view)
        : new MissionView(render.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
    };
    const save = (): Saved => ({ sourceHash, runtime, view: view!.checkpoint() });
    if (proof) {
      const pending = json(`${proof}/pending.json`) as Saved, ready = json(`${proof}/checkpoint.json`) as Saved;
      assert.equal(ready.sourceHash, sourceHash); assert.deepEqual(ready.runtime, runtime);
      view = make(pending);
      assert.deepEqual(view.checkpoint(), pending.view);
      await view.initialize(); initialized = true;
      assert.equal(view.missionOutcome?.ready, false);
      view.resetClock(); view.update(0);
      const ticks = ready.view.simulation.tick - pending.view.simulation.tick;
      assert.ok(ticks > 0 && ticks <= 1000);
      for (let offset = 1; offset <= ticks; offset++) {
        view.update(offset * 50); assert.equal(view.missionDiagnostic, undefined);
      }
      assert.equal(view.missionOutcome?.ready, true);
      assert.deepEqual(view.checkpoint(), ready.view);
      result = { status: classify(view.missionOutcome, true), exact: true, fromTick: pending.view.simulation.tick,
        tick: view.simulation.snapshot.tick, expectedHash: hash(JSON.stringify(ready.view)),
        actualHash: hash(JSON.stringify(view.checkpoint())), outcome: view.missionOutcome, sourceHash };
      write(output, "proof", result);
    } else {
      view = make(resume ? json(resume) : undefined);
      await view.initialize(); initialized = true;
      assert.equal(view.missionDiagnostic, undefined);
      const active = view, startTick = active.simulation.snapshot.tick;
      const initial = active.campaignSnapshot!;
      const sourceGoals = initial.world.entities.filter(actor => actor.key.startsWith("colony:") ||
        (id === "H09" && actor.team === 4)).map(actor => ({ key: actor.key, team: actor.team, type: actor.unitType, x: actor.tileX, y: actor.tileY }));
      write(output, "initial", { simulation: active.simulation.snapshot, bindings: active.nativeBindings,
        world: initial.world, menu: active.productionMenu, construction: active.constructionMenu, sourceGoals });
      const fired = new Set<number>(active.campaignJournal.flatMap(entry => entry.fired));
      const signatures = new Map<number, { signature: string; tick: number }>();
      const order = (actorId: number, destination: GridPoint, mode: "move" | "assault", purpose: string) => {
        assert.ok(active.isOwnedUnit(actorId));
        const tick = active.simulation.snapshot.tick, signature = JSON.stringify({ destination, mode, purpose });
        const prior = signatures.get(actorId);
        if (prior?.signature === signature && tick - prior.tick < 160) return;
        const visible = Boolean(active.visibility[destination.y * active.grid.width + destination.x]);
        if (mode === "assault") assert.ok(visible, "Direct attacks require current visibility");
        active.replaceSelection([actorId]); assert.deepEqual(active.selectedIds, [actorId]);
        active.setCameraCenter(destination.x + 0.5, destination.y + 0.5); active.setOrderMode(mode);
        const camera = active.cameraView, scale = 512 / camera.width;
        const clientX = (destination.x + 0.5 - camera.x) * scale;
        const clientY = 226 - (destination.y + 0.5 - camera.y - camera.height / 2) * scale;
        const cursor = active.cursorAt(clientX, clientY);
        lastInput = { actorId, destination, mode, purpose, clientX, clientY, visible, cursor };
        emit("input", lastInput);
        if (cursor === "blocked") return;
        active.commandAt(clientX, clientY); commands++;
        signatures.set(actorId, { signature, tick });
      };
      const summary = () => {
        const campaign = active.campaignSnapshot!, snapshot = active.simulation.snapshot;
        const bindings = new Map(active.nativeBindings.map(binding => [binding.key, binding.simulationId]));
        const types = new Map(campaign.world.entities.map(actor => [bindings.get(actor.key), actor.unitType]));
        const owned = snapshot.units.filter(actor => actor.health > 0 && active.isOwnedUnit(actor.id));
        const enemies = [...snapshot.units, ...snapshot.staticTargets].filter(actor => actor.health > 0 &&
          active.visibility[actor.cellY * active.grid.width + actor.cellX] &&
          areHostile({ faction: contract.faction, team: 0 }, actor, snapshot.teamAlliances));
        const report = { tick: snapshot.tick, fired: [...fired], outcome: active.missionOutcome,
          diagnostic: active.missionDiagnostic, commands, credits: active.resourceWorkflow.credits[0],
          owned: owned.map(actor => ({ id: actor.id, type: types.get(actor.id), hp: actor.health, x: actor.cellX, y: actor.cellY, activity: actor.activity })),
          buildingSlots: campaign.world.buildingSlots, statistics: active.missionStatistics,
          lastInput, stage: routeStage(id, fired) };
        return { campaign, snapshot, types, owned, enemies, report };
      };
      const plan = () => {
        const state = summary();
        write(output, "latest", state.report);
        const blocked = new Set(active.simulation.staticObstacleCells.map(cell => active.grid.index(cell.x, cell.y)));
        const move = (actor: typeof state.owned[number], destinations: readonly GridPoint[], purpose: string, exact = false) => {
          const stat = mission.units.find(stat => stat.index === state.types.get(actor.id));
          if (stat && isAir06(stat)) { if (destinations[0]) order(actor.id, destinations[0], "move", purpose); return; }
          const candidates = [...destinations].sort((left, right) => distance(point(actor), left) - distance(point(actor), right));
          for (const destination of candidates.slice(0, 24)) {
            const targets = exact ? [destination] : Array.from({ length: 81 }, (_, index) => ({
              x: destination.x + index % 9 - 4, y: destination.y + Math.floor(index / 9) - 4 }))
              .sort((left, right) => distance(left, destination) - distance(right, destination));
            for (const target of targets) {
              if (distance(point(actor), target) < 0.5) return;
              const route = findPath(active.grid, point(actor), target, { blocked });
              if (route?.length) { order(actor.id, route[Math.min(16, route.length - 1)], "move", purpose); return; }
            }
          }
          emit("route-blocked", { actorId: actor.id, purpose, destinations: candidates.slice(0, 3) });
        };
        const collectors = state.owned.filter(actor => [6, 14].includes(state.types.get(actor.id)!));
        for (const collector of collectors) {
          if (active.browserEconomyState?.orders.some(order => order.simulationId === collector.id)) continue;
          const resource = active.resourceSources.find(resource => resource.status === 1 && (resource.remaining ?? 0) > 0 &&
            (resource.rate ?? 0) > 0 && active.visibility[(resource.position.y >> 8) * active.grid.width + (resource.position.x >> 8)]);
          if (resource) {
            active.replaceSelection([collector.id]);
            lastInput = { method: "harvestSelected", actorId: collector.id, slot: resource.slot };
            emit("harvest", { ...lastInput as object, accepted: active.harvestSelected(resource.slot) }); commands++;
          }
        }
        const troops = state.owned.filter(actor => !collectors.includes(actor));
        if (id !== "A09" && id !== "A08" && troops.length < 18) {
          const dependency = contract.faction === "human" ? (collectors.length ? 9 : 7) : (collectors.length ? 23 : 21);
          const choice = active.productionMenu.find(choice => choice.dependency === dependency);
          if (choice?.enabled && !choice.pending && !choice.queued && choice.cost <= active.resourceWorkflow.credits[0]) {
            lastInput = { method: "purchaseProduction", dependency, cost: choice.cost };
            emit("purchase", { ...lastInput as object, accepted: active.purchaseProduction(dependency) }); commands++;
          }
        }
        const stage = routeStage(id, fired), teams = goalTeams(id, fired);
        const goals = sourceGoals.filter(goal => teams.includes(goal.team) &&
          state.campaign.world.entities.some(actor => actor.key === goal.key && actor.health > 0));
        const commander = troops.find(actor => [69, 70, 71, 72, 73, 74, 75, 76].includes(state.types.get(actor.id)!));
        for (const actor of troops) {
          if (id === "A09") {
            if (stage !== null && actor === commander) move(actor, contract.trips[stage], `source-trip-${stage}`, true);
            else if (actor === commander && fired.has(2) && !fired.has(5))
              move(actor, [tripApproach(contract.trips[3])], "source-extraction-approach", true);
            continue;
          }
          if (id === "A08" && !fired.has(19)) {
            if (stage !== null && actor === commander) move(actor, contract.trips[stage], `source-escort-trip-${stage}`, true);
            else if (fired.has(13) && !fired.has(9)) {
              const target = state.enemies.find(enemy => state.types.get(enemy.id) === 69 && enemy.team === 6);
              if (target) order(actor.id, point(target), "assault", "visible-escaped-prisoner");
            }
            continue;
          }
          const enemy = state.enemies.filter(enemy => distance(point(actor), point(enemy)) < 8)
            .sort((left, right) => distance(point(actor), point(left)) - distance(point(actor), point(right)))[0];
          if (enemy) {
            if (actor.activity !== "attack" || actor.targetId !== enemy.id) order(actor.id, point(enemy), "assault", "visible-hostile");
          } else if (goals.length) move(actor, goals, "source-city-scout");
          else if (id === "H09") move(actor, sourceGoals.filter(goal => goal.team === 4), "source-team4-objective-scout");
        }
      };
      let clock = 0, pending = false;
      active.resetClock(); active.update(0);
      write(output, "checkpoint", save());
      while (performance.now() - started < budgetMs - 2000 && active.simulation.snapshot.tick - startTick < maxTicks) {
        if (active.missionDiagnostic || active.missionOutcome?.ready) break;
        const tick = active.simulation.snapshot.tick;
        if (!pending && (tick - startTick) % 40 === 0) plan();
        active.update(clock += 50);
        for (const block of active.campaignJournal.at(-1)?.fired ?? []) if (!fired.has(block)) {
          fired.add(block); emit("source-trigger", { block });
        }
        if (active.missionOutcome && !pending) { pending = true; write(output, "pending", save()); emit("pending", active.missionOutcome); }
        if (active.simulation.snapshot.tick % 400 === 0) {
          write(output, "checkpoint", save()); emit("progress", summary().report);
        }
        if (tick === active.simulation.snapshot.tick && !active.missionDiagnostic && !active.missionOutcome?.ready)
          throw new Error("Public update did not advance simulation");
      }
      const checkpoint = save(); write(output, "checkpoint", checkpoint);
      write(output, "campaign-journal", active.campaignJournal);
      result = { ...summary().report, status: classify(active.missionOutcome, false, active.missionDiagnostic),
        startTick, sourceHash, checkpointHash: hash(JSON.stringify(checkpoint.view)),
        stoppingReason: active.missionDiagnostic ?? (active.missionOutcome ? "original-outcome" :
          active.simulation.snapshot.tick - startTick >= maxTicks ? "tick-budget" : "wall-budget") };
    }
  } catch (error) {
    result = { status: "RUNTIME_BLOCKER", diagnostic: error instanceof Error ? error.stack : String(error),
      tick: view?.simulation.snapshot.tick ?? 0, lastInput, attemptedNextTick: (view?.simulation.snapshot.tick ?? 0) + 1 };
    emit("failure", result);
    try { if (view) write(output, "failure-state", view.checkpoint()); } catch {}
  } finally {
    const after = runtimeHashes(), changed = Object.keys(runtime).filter(path => runtime[path] !== after[path]);
    const changedAssets = Object.keys(fetched).filter(path => fetched[path] !== hash(read(`public${path}`)));
    const sourceAfter = sourceContract(id).sources;
    const sourceChanged = Object.keys(contract.sources).filter(key => contract.sources[key] !== sourceAfter[key]);
    write(output, "integrity", { changed, changedAssets, sourceChanged, runtime, fetched });
    if (changed.length || changedAssets.length || sourceChanged.length) result.status = "PROVENANCE_CHANGED";
    result = { id, loaded, initialized, commands, ...result, elapsedMs: Math.round(performance.now() - started) };
    write(output, "result", result); console.log(JSON.stringify(result));
    view?.dispose(); render.dispose(); globalThis.fetch = previousFetch;
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argument = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const output = argument("output") ?? `/tmp/dc-campaign-0709-${Date.now()}`;
  const selected = argument("mission") as MissionId | undefined;
  if (selected) assert.ok(missionIds.includes(selected));
  if (process.argv.includes("--worker")) {
    assert.ok(selected);
    await play(selected, output, Number(argument("ticks") ?? 1200), Number(argument("budget") ?? 36000), argument("resume"), argument("proof"));
  } else {
    process.on("SIGINT", () => {});
    mkdirSync(output, { recursive: true });
    const started = Date.now(), results: unknown[] = [];
    let playUsed = 0, proofUsed = 0;
    for (const id of selected ? [selected] : missionIds) {
      const directory = `${output}/${id}`; mkdirSync(directory, { recursive: true });
      const budget = Math.min(id === "A09" ? 180000 : 45000, 405000 - playUsed);
      if (budget <= 2000) { results.push({ id, status: "GROUP_BUDGET" }); continue; }
      const descriptor = openSync(`${directory}/worker.log`, "wx"), runStart = Date.now();
      const args = ["--import", fileURLToPath(new URL("node_modules/tsx/dist/loader.mjs", root)), fileURLToPath(import.meta.url),
        "--worker", `--mission=${id}`, `--output=${directory}`, `--budget=${budget}`, `--ticks=${id === "A09" ? 15000 : 1200}`];
      if (argument("resume")) args.push(`--resume=${argument("resume")}`);
      const run = spawnSync(process.execPath, args, { cwd: fileURLToPath(root), stdio: ["ignore", descriptor, descriptor], timeout: budget, killSignal: "SIGKILL" });
      closeSync(descriptor); playUsed += Date.now() - runStart;
      write(directory, "exit", { code: run.status, signal: run.signal, error: run.error?.message, pid: run.pid, elapsedMs: Date.now() - runStart });
      let result: Record<string, unknown>;
      try { result = json(`${directory}/result.json`); } catch { result = { id, status: "HARD_DEADLINE", elapsedMs: Date.now() - runStart }; }
      if ((result.status === "UNVERIFIED_WIN" || result.status === "UNVERIFIED_LOSS") && proofUsed < 478000) {
        const proofDirectory = `${directory}/verification`; mkdirSync(proofDirectory, { recursive: true });
        const proofLog = openSync(`${proofDirectory}/worker.log`, "wx"), proofStart = Date.now();
        const proofRun = spawnSync(process.execPath, ["--import", fileURLToPath(new URL("node_modules/tsx/dist/loader.mjs", root)),
          fileURLToPath(import.meta.url), "--worker", `--mission=${id}`, `--output=${proofDirectory}`, `--proof=${directory}`],
        { cwd: fileURLToPath(root), stdio: ["ignore", proofLog, proofLog], timeout: 480000 - proofUsed, killSignal: "SIGKILL" });
        closeSync(proofLog); proofUsed += Date.now() - proofStart;
        write(proofDirectory, "exit", { code: proofRun.status, signal: proofRun.signal, error: proofRun.error?.message, pid: proofRun.pid });
        try { const verified = json(`${proofDirectory}/result.json`); if (verified.exact) result = { ...result, status: verified.status, proof: verified }; } catch {}
      }
      results.push(result); write(output, "group", { playUsed, proofUsed, elapsedMs: Date.now() - started, results });
    }
    console.log(JSON.stringify({ output, playUsed, proofUsed, results }));
  }
}
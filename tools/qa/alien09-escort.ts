import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { areHostile } from "../../src/engine/diplomacy";
import { findPath } from "../../src/engine/pathfinding";
import type { GridPoint } from "../../src/engine/grid";
import { installSourceRender } from "./fixtures/source-render";
import { hash, sourceContract, tripApproach } from "./campaign-07-09";

export type EscortActor = GridPoint & { id: number; hp: number; type: number };
export type EscortOrder = { ids: number[]; destination: GridPoint; mode: "move" | "assault"; purpose: string; targetId?: number };
export type EscortState = {
  owned: EscortActor[];
  enemies: EscortActor[];
  fired: ReadonlySet<number>;
  destination: GridPoint;
  retreat: GridPoint;
};
const distance = (left: GridPoint, right: GridPoint) => Math.hypot(left.x - right.x, left.y - right.y);

export function escortRoute(start: GridPoint, destinations: readonly GridPoint[], path: (target: GridPoint) => readonly GridPoint[] | null) {
  for (const target of [...destinations].sort((left, right) => distance(start, left) - distance(start, right))) {
    const route = path(target);
    if (route) return { target, waypoint: route[Math.min(16, route.length - 1)] ?? target };
  }
  return null;
}

export function visibleHostiles<T extends { faction: "human" | "alien"; team?: number; cellX: number; cellY: number; health: number }>(
  actors: readonly T[], visibility: ArrayLike<number>, width: number,
  alliances: Parameters<typeof areHostile>[2],
): T[] {
  return actors.filter(actor => actor.health > 0 && Boolean(visibility[actor.cellY * width + actor.cellX]) &&
    areHostile({ faction: "alien", team: 0 }, actor, alliances));
}

export function escortOrders(state: EscortState): EscortOrder[] {
  const commander = state.owned.find(actor => actor.hp > 0 && actor.type >= 73 && actor.type <= 76);
  if (!commander) return [];
  const troops = state.owned.filter(actor => actor.hp > 0 && actor.id !== commander.id && ![6, 14, 94].includes(actor.type));
  const withdrawing = state.fired.has(3);
  const destination = withdrawing ? state.retreat : state.destination;
  const threat = state.enemies.filter(enemy => distance(enemy, commander) <= 12)
    .sort((left, right) => distance(left, commander) - distance(right, commander) || left.id - right.id)[0];
  const front = troops.slice(0, Math.ceil(troops.length * 2 / 3));
  const rear = troops.slice(front.length);
  const orders: EscortOrder[] = [];
  for (const [index, group] of [front, rear].entries()) {
    if (!group.length) continue;
    const engaging = threat && group.some(actor => distance(actor, threat) <= 10);
    const target = engaging ? threat : state.destination;
    orders.push({ ids: group.map(actor => actor.id), destination: { x: target.x, y: target.y }, mode: engaging ? "assault" : "move",
      purpose: engaging ? "visible-commander-threat" : index === 0 ? "escort-front-transit" : "escort-rear-transit",
      ...(engaging ? { targetId: threat.id } : {}) });
  }
  const guards = troops.filter(actor => actor.type !== 12);
  const regroup = !state.fired.has(2) && guards.length > 0 && guards.every(actor => distance(actor, commander) > 10);
  orders.push({ ids: [commander.id], destination: regroup ? { x: commander.x, y: commander.y } : destination,
    mode: "move", purpose: withdrawing ? "commander-retreat" : regroup ? "commander-regroup" : "commander-route" });
  return orders;
}

export function safeWaitingCells() {
  const approach = tripApproach(sourceContract("A09").trips[3]);
  return Array.from({ length: 81 }, (_, index) => ({ x: approach.x + 2 + index % 9, y: approach.y + 13 + Math.floor(index / 9) }));
}

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const write = (directory: string, name: string, value: unknown) => writeFileSync(`${directory}/${name}.json`, JSON.stringify(value));
const runtimeHashes = () => Object.fromEntries(readdirSync(new URL("src/", root), { recursive: true }).map(String)
  .filter(path => /\.(ts|css)$/.test(path)).sort().concat(["../tools/qa/fixtures/source-render.ts"])
  .map(path => [path, hash(read(`src/${path}`))]));
type Saved = { sourceHash: string; runtime: Record<string, string>; view: ReturnType<MissionView["checkpoint"]> };
type Input = EscortOrder & { tick: number; clientX: number; clientY: number; visible: boolean; cursor: string };

export function replayInputs(inputs: readonly Input[], pendingTick: number, readyTick: number) {
  assert.ok(readyTick > pendingTick);
  const selected = inputs.filter(input => input.tick >= pendingTick && input.tick < readyTick);
  for (let index = 1; index < selected.length; index++) assert.ok(selected[index].tick >= selected[index - 1].tick);
  return selected;
}

export async function runEscort(output: string, proof?: string, budgetMs = 180000) {
  mkdirSync(output, { recursive: true });
  const started = performance.now(), runtime = runtimeHashes(), contract = sourceContract("A09");
  const render = installSourceRender(); render.setEnabled(false);
  const priorFetch = globalThis.fetch, fetched: Record<string, string> = {};
  globalThis.fetch = async input => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    const bytes = read(`public${path}`); fetched[path] = hash(bytes);
    return new Response(bytes);
  };
  let view: MissionView | undefined, commands = 0;
  let result: Record<string, unknown> = {}, lastInput: Input | null = null;
  const inputs: Input[] = [], fired = new Set<number>();
  const emit = (kind: string, data: unknown) => appendFileSync(`${output}/journal.jsonl`, JSON.stringify({
    kind, tick: view?.simulation.snapshot.tick ?? 0, elapsedMs: Math.round(performance.now() - started), data }) + "\n");
  try {
    const mission = await loadCampaignMission("alien", 9, "browser-adapted");
    assert.equal(mission.scenario.source.sha256, contract.sources.SCN);
    assert.deepEqual(mission.triggers, contract.triggers);
    const sourceHash = hash(JSON.stringify(mission));
    write(output, "source", { contract, sourceHash, runtime, harness: hash(read("tools/qa/alien09-escort.ts")) });
    const make = (saved?: Saved) => {
      if (!saved) return new MissionView(render.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
      assert.equal(saved.sourceHash, sourceHash, "Source mismatch: guarded restore rejected");
      assert.deepEqual(saved.runtime, runtime, "Runtime mismatch: guarded restore rejected");
      const restored = MissionView.restore(render.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission, saved.view);
      assert.deepEqual(restored.checkpoint(), saved.view, "Guarded restore must be exact");
      return restored;
    };
    const pending = proof ? json(`${proof}/pending.json`) as Saved : undefined;
    view = make(pending);
    await view.initialize();
    const active = view;
    assert.equal(active.missionDiagnostic, undefined);
    const save = (): Saved => ({ sourceHash, runtime, view: active.checkpoint() });
    const execute = (order: EscortOrder, expected?: Input) => {
      assert.ok(order.ids.length && order.ids.every(id => active.isOwnedUnit(id)), "Only owned units may receive orders");
      const destination = order.destination;
      const visible = Boolean(active.visibility[destination.y * active.grid.width + destination.x]);
      if (order.targetId !== undefined) {
        const snapshot = active.simulation.snapshot;
        const target = visibleHostiles([...snapshot.units, ...snapshot.staticTargets], active.visibility, active.grid.width,
          snapshot.teamAlliances).find(actor => actor.id === order.targetId);
        assert.ok(target && target.cellX === destination.x && target.cellY === destination.y, "Attack requires a current visible hostile");
      }
      active.replaceSelection(order.ids);
      assert.deepEqual([...active.selectedIds].sort((left, right) => left - right), [...order.ids].sort((left, right) => left - right));
      active.setCameraCenter(destination.x + 0.5, destination.y + 0.5);
      active.setOrderMode(order.mode);
      const camera = active.cameraView, scale = 512 / camera.width;
      const clientX = (destination.x + 0.5 - camera.x) * scale;
      const clientY = 226 - (destination.y + 0.5 - camera.y - camera.height / 2) * scale;
      const cursor = active.cursorAt(clientX, clientY);
      const input: Input = { ...order, tick: active.simulation.snapshot.tick, clientX, clientY, visible, cursor };
      if (expected) assert.deepEqual(input, expected, "Replayed public input differs");
      lastInput = input;
      emit("input", input); inputs.push(input);
      active.commandAt(clientX, clientY); commands++;
    };
    const summary = () => {
      const snapshot = active.simulation.snapshot;
      const bindings = new Map(active.nativeBindings.map(binding => [binding.key, binding.simulationId]));
      const types = new Map(active.campaignSnapshot!.world.entities.map(actor => [bindings.get(actor.key), actor.unitType]));
      const owned = snapshot.units.filter(actor => actor.health > 0 && active.isOwnedUnit(actor.id))
        .map(actor => ({ id: actor.id, type: types.get(actor.id)!, hp: actor.health, x: actor.cellX, y: actor.cellY }));
      const enemies = visibleHostiles([...snapshot.units, ...snapshot.staticTargets], active.visibility, active.grid.width, snapshot.teamAlliances)
        .map(actor => ({ id: actor.id, type: types.get(actor.id)!, hp: actor.health, x: actor.cellX, y: actor.cellY }));
      return { tick: snapshot.tick, owned, enemies, fired: [...fired], outcome: active.missionOutcome,
        diagnostic: active.missionDiagnostic ?? null, statistics: active.missionStatistics,
        commands, lastInput, commander: owned.find(actor => actor.type >= 73 && actor.type <= 76) ?? null };
    };
    active.resetClock(); active.update(0);
    if (proof) {
      const ready = json(`${proof}/checkpoint.json`) as Saved;
      assert.equal(ready.sourceHash, sourceHash); assert.deepEqual(ready.runtime, runtime);
      assert.equal(pending!.view.state.outcome?.resultCode, 0);
      assert.equal(pending!.view.state.outcome?.ready, false);
      const replay = replayInputs(json(`${proof}/commands.json`), pending!.view.simulation.tick, ready.view.simulation.tick);
      let index = 0, clock = 0;
      while (active.simulation.snapshot.tick < ready.view.simulation.tick) {
        const tick = active.simulation.snapshot.tick;
        while (index < replay.length && replay[index].tick === tick) { execute(replay[index], replay[index]); index++; }
        active.update(clock += 50);
        assert.equal(active.missionDiagnostic, undefined);
        assert.equal(active.simulation.snapshot.tick, tick + 1);
      }
      assert.equal(index, replay.length);
      assert.deepEqual(active.checkpoint(), ready.view, "Complete ready checkpoint must match including post-pending inputs");
      assert.deepEqual(active.missionOutcome, { resultCode: 0, reasonCode: 1, ready: true });
      result = { ...summary(), status: "WIN", exact: true, fromTick: pending!.view.simulation.tick,
        replayCommands: index, expectedHash: hash(JSON.stringify(ready.view)), actualHash: hash(JSON.stringify(active.checkpoint())) };
    } else {
      write(output, "initial", { ...summary(), simulation: active.simulation.snapshot, bindings: active.nativeBindings });
      write(output, "initial-checkpoint", save());
      const signatures = new Map<string, { value: string; tick: number }>();
      let clock = 0, hasPending = false, previousPhase = "";
      while (active.simulation.snapshot.tick < 3600 && performance.now() - started < budgetMs - 5000) {
        if (active.missionOutcome?.ready || active.missionDiagnostic) break;
        const tick = active.simulation.snapshot.tick;
        const phase = fired.has(3) ? "retreat" : fired.has(5) ? "extraction" : fired.has(2) ? "waiting" : "approach";
        if (tick % 40 === 0 || phase !== previousPhase) {
          const state = summary(), commander = state.commander;
          if (commander) {
            const blocked = new Set(active.simulation.staticObstacleCells.map(cell => active.grid.index(cell.x, cell.y)));
            const extraction = fired.has(5) ? contract.trips[3] : !fired.has(2) ? contract.trips[2] : safeWaitingCells();
            const candidates = fired.has(3) ? safeWaitingCells() : extraction;
            const route = escortRoute(commander, candidates, target => findPath(active.grid, commander, target, { blocked }));
            assert.ok(route, `No commander route during ${phase}`);
            const orders = escortOrders({ owned: state.owned, enemies: state.enemies, fired,
              destination: fired.has(3) ? tripApproach(contract.trips[3]) : route.waypoint, retreat: route.waypoint });
            for (const order of orders) {
              const key = order.ids.join(","), value = JSON.stringify(order), previous = signatures.get(key);
              if (previous?.value === value && tick - previous.tick < 160) continue;
              execute(order); signatures.set(key, { value, tick });
            }
          }
          if (phase !== previousPhase) { emit("phase", { phase, ...state }); previousPhase = phase; }
        }
        active.update(clock += 50);
        assert.equal(active.simulation.snapshot.tick, tick + 1);
        for (const block of active.campaignJournal.at(-1)?.fired ?? []) if (!fired.has(block)) {
          fired.add(block); emit("source-trigger", { block, commander: summary().commander });
          if (block === 3) write(output, "trip3", save());
        }
        if (active.missionOutcome && !hasPending) {
          hasPending = true; write(output, "pending", save()); emit("pending", summary());
        }
        if (active.simulation.snapshot.tick % 200 === 0) {
          write(output, "checkpoint", save()); write(output, "commands", inputs); emit("progress", summary());
        }
      }
      write(output, "checkpoint", save());
      write(output, "campaign-journal", active.campaignJournal);
      const report = summary();
      result = { ...report, status: active.missionOutcome?.ready ? active.missionOutcome.resultCode === 0 ? "UNVERIFIED_WIN" : "LOSS" : "INCOMPLETE",
        firstFailure: active.missionDiagnostic ?? (active.missionOutcome?.resultCode === 1 ? "Original commander death LOSS" :
          !active.missionOutcome?.ready ? "Stepping budget exhausted" : null), sourceHash,
        checkpointHash: hash(JSON.stringify(active.checkpoint())) };
    }
  } catch (error) {
    result = { status: "FAILED", firstFailure: error instanceof Error ? error.stack : String(error),
      tick: view?.simulation.snapshot.tick ?? 0, lastInput };
    emit("failure", result);
  } finally {
    write(output, "commands", inputs);
    const after = runtimeHashes();
    const changed = Object.keys(runtime).filter(path => runtime[path] !== after[path]);
    const changedAssets = Object.keys(fetched).filter(path => fetched[path] !== hash(read(`public${path}`)));
    const sources = sourceContract("A09").sources;
    const sourceChanged = Object.keys(contract.sources).filter(key => contract.sources[key] !== sources[key]);
    write(output, "integrity", { changed, changedAssets, sourceChanged, runtime, fetched });
    if (changed.length || changedAssets.length || sourceChanged.length) result = { ...result, status: "PROVENANCE_CHANGED" };
    result = { ...result, elapsedMs: Math.round(performance.now() - started) };
    write(output, "result", result);
    view?.dispose(); render.dispose(); globalThis.fetch = priorFetch;
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argument = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const output = argument("output") ?? `/tmp/dc-a09-escort-${Date.now()}`;
  if (process.argv.includes("--worker")) {
    const result = await runEscort(output, argument("proof"), Number(argument("budget") ?? 180000));
    process.exitCode = ["WIN", "UNVERIFIED_WIN"].includes(String(result.status)) ? 0 : 1;
  } else {
    process.on("SIGINT", () => {});
    mkdirSync(output, { recursive: true });
    const run = (directory: string, budget: number, proof?: string) => {
      mkdirSync(directory, { recursive: true });
      const descriptor = openSync(`${directory}/worker.log`, "wx"), started = Date.now();
      const options: SpawnSyncOptions & { detached: boolean } = { cwd: fileURLToPath(root), stdio: ["ignore", descriptor, descriptor],
        detached: true, timeout: budget, killSignal: "SIGKILL" };
      const execution = spawnSync(process.execPath, ["--import", fileURLToPath(new URL("node_modules/tsx/dist/loader.mjs", root)),
        fileURLToPath(import.meta.url), "--worker", `--output=${directory}`, `--budget=${budget}`, ...(proof ? [`--proof=${proof}`] : [])], options);
      closeSync(descriptor);
      const receipt = { code: execution.status, signal: execution.signal, error: execution.error?.message,
        pid: execution.pid, reaped: true, elapsedMs: Date.now() - started, budgetMs: budget };
      write(directory, "exit", receipt);
      return receipt;
    };
    const playBudget = Number(argument("play-budget") ?? 180000);
    assert.ok(Number.isFinite(playBudget) && playBudget > 5000 && playBudget <= 180000);
    const play = run(output, playBudget);
    let result: Record<string, unknown>;
    try { result = json(`${output}/result.json`); } catch { result = { status: "HARD_DEADLINE", firstFailure: play }; }
    let proof;
    if (play.code === 0 && result.status === "UNVERIFIED_WIN") {
      proof = run(`${output}/verification`, 300000, output);
      if (proof.code === 0) result = { ...result, status: "WIN", proof: json(`${output}/verification/result.json`) };
    }
    write(output, "summary", { output, result, play, proof });
    console.log(JSON.stringify({ output, result, play, proof }));
    process.exitCode = result.status === "WIN" ? 0 : 1;
  }
}
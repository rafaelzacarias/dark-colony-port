import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, openSync, closeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { parseTriggerScript } from "../extractors/data/triggers";
import { installSourceRender } from "./fixtures/source-render";
import { findPath } from "../../src/engine/pathfinding";
import { areHostile } from "../../src/engine/diplomacy";
import type { GridPoint } from "../../src/engine/grid";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
export const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export const missions = ["H11", "A11", "H10", "A10", "H12", "A12"] as const;
export type MissionId = typeof missions[number];
export const identity = (id: MissionId) => ({ faction: id[0] === "H" ? "human" as const : "alien" as const, number: Number(id.slice(1)) });
export const winIds: Record<MissionId, number[]> = { H10: [18], A10: [1], H11: [12, 13], A11: [3], H12: [3], A12: [6] };
export const cityTeams: Record<MissionId, number[]> = { H10: [2], A10: [1], H11: [], A11: [1], H12: [1, 2], A12: [2, 7] };
export function sourceContract(id: MissionId) {
  const { faction, number } = identity(id), name = `${faction.toUpperCase()}${number}`;
  const stem = `raw_cd/DC/SCENARIO/${faction.toUpperCase()}/${name}`;
  const sources = Object.fromEntries(["SCN", "TRO", "TXT", "MAP", "MTG", "PTH"].map(extension => [extension, hash(read(`${stem}.${extension}`))]));
  const triggers = parseTriggerScript(read(`${stem}.TRO`).toString());
  const tags = read(`${stem}.MTG`), width = tags[0], height = tags[1];
  assert.equal(tags.length, 2 + width * height);
  const trips = Object.fromEntries(triggers.filter(block => block.mode === "trip").map(block => [block.id,
    Array.from(tags.subarray(2)).flatMap((tag, index) => (tag & 63) === block.id
      ? [{ x: index % width, y: height - 1 - Math.floor(index / width) }] : [])]));
  return { id, name, sources, triggers, trips, scn: read(`${stem}.SCN`).toString(), briefing: read(`${stem}.TXT`).toString(),
    wins: triggers.filter(block => winIds[id].includes(block.id)) };
}
export function permit(order: { owned: boolean; mode: "move" | "assault"; visible: boolean; sourceKnown: boolean }) {
  return order.owned && (order.mode === "assault" ? order.visible : order.visible || order.sourceKnown);
}
export function classify(outcome: MissionView["missionOutcome"], diagnostic?: string, exact = false) {
  return diagnostic ? "RUNTIME_BLOCKER" : outcome?.ready ? outcome.resultCode !== 0 ? "SOURCE_LOSS"
    : exact ? "WIN" : "READY_WIN_UNVERIFIED" : "BOUNDED_NO_WIN";
}

function integrity() {
  const paths = readdirSync(new URL("src/", root), { recursive: true }).map(String).filter(path => path.endsWith(".ts"))
    .map(path => `src/${path}`);
  for (const id of missions) {
    const { faction, number } = identity(id), stem = `raw_cd/DC/SCENARIO/${faction.toUpperCase()}/${faction.toUpperCase()}${number}`;
    paths.push(...["SCN", "TRO", "TXT", "MAP", "MTG", "PTH"].map(extension => `${stem}.${extension}`));
  }
  return Object.fromEntries(paths.map(path => [path, hash(read(path))]));
}

type Saved = { sourceHash: string; view: ReturnType<MissionView["checkpoint"]> };
const callbacks = { onStats() {}, onUnitsChanged() {} };
const point = (actor: { cellX: number; cellY: number }) => ({ x: actor.cellX, y: actor.cellY });
const distance = (left: GridPoint, right: GridPoint) => Math.hypot(left.x - right.x, left.y - right.y);

export async function replay(id: MissionId, output: string, budgetMs: number, proof = false) {
  mkdirSync(output, { recursive: true });
  const started = Date.now(), before = integrity(), renderer = installSourceRender(), originalFetch = globalThis.fetch;
  renderer.setEnabled(false);
  const fetched: Record<string, string> = {};
  globalThis.fetch = async input => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    const bytes = read(`public${path}`); fetched[path] = hash(bytes);
    return new Response(bytes);
  };
  let view: MissionView | undefined;
  const write = (name: string, data: unknown) => writeFileSync(`${output}/${name}.json`, JSON.stringify(data));
  const emit = (kind: string, data: unknown) => appendFileSync(`${output}/${proof ? "proof-" : ""}journal.jsonl`,
    JSON.stringify({ kind, tick: view?.simulation.snapshot.tick, elapsedMs: Date.now() - started, data }) + "\n");
  let result: Record<string, unknown> = { id, status: "RUNTIME_BLOCKER" };
  try {
    const { faction, number } = identity(id), mission = await loadCampaignMission(faction, number, "browser-adapted");
    const contract = sourceContract(id), sourceHash = hash(JSON.stringify(mission));
    assert.equal(mission.scenario.source.sha256, contract.sources.SCN);
    assert.deepEqual(mission.triggers, contract.triggers);
    write(proof ? "proof-source" : "source", { ...contract, sourceHash, scenario: mission.scenario });
    if (proof) {
      const pending = JSON.parse(readFileSync(`${output}/pending-win.json`, "utf8")) as Saved;
      const ready = JSON.parse(readFileSync(`${output}/checkpoint.json`, "utf8")) as Saved;
      assert.equal(pending.sourceHash, sourceHash); assert.equal(ready.sourceHash, sourceHash);
      view = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission, JSON.parse(JSON.stringify(pending.view)));
      assert.deepEqual(view.checkpoint(), pending.view);
      await view.initialize();
      assert.equal(view.missionOutcome?.resultCode, 0); assert.equal(view.missionOutcome?.ready, false);
      view.resetClock(); view.update(0);
      const ticks = ready.view.simulation.tick - pending.view.simulation.tick;
      assert.ok(ticks > 0 && ticks <= 1000);
      for (let offset = 1; offset <= ticks; offset++) {
        assert.ok(Date.now() - started < budgetMs);
        view.update(offset * 50); assert.equal(view.missionDiagnostic, undefined);
      }
      assert.deepEqual(view.checkpoint(), ready.view);
      assert.equal(view.missionOutcome?.resultCode, 0); assert.equal(view.missionOutcome?.ready, true);
      result = { id, status: "WIN", exactCheckpoint: true, sourceHash, fromTick: pending.view.simulation.tick,
        toTick: ready.view.simulation.tick, expectedHash: hash(JSON.stringify(ready.view)), actualHash: hash(JSON.stringify(view.checkpoint())) };
      write("proof", result);
    } else {
      view = new MissionView(renderer.canvas(), {} as HTMLElement, callbacks, mission);
      await view.initialize(); assert.equal(view.missionDiagnostic, undefined);
      const active = view, initial = active.campaignSnapshot!.world;
      const known = initial.entities.map(actor => ({ key: actor.key, team: actor.team, type: actor.unitType, x: actor.tileX, y: actor.tileY }));
      const goals = known.filter(actor => cityTeams[id].includes(actor.team) && actor.key.startsWith("colony:") && actor.type !== 81);
      write("initial", { known, goals, units: active.simulation.snapshot, bindings: active.nativeBindings,
        menu: active.productionMenu, construction: active.constructionMenu, statistics: active.missionStatistics });
      let clock = 0, commands = 0, shots = 0, deaths = 0, pending = false;
      const fired = new Set<number>(), deployed = new Set<number>(), stopped = new Set<number>();
      const visited = new Set<string>(), signatures = new Map<number, string>();
      const order = (actor: { id: number }, destination: GridPoint, mode: "move" | "assault", purpose: string) => {
        const visible = Boolean(active.visibility[destination.y * active.grid.width + destination.x]);
        assert.ok(permit({ owned: active.isOwnedUnit(actor.id), mode, visible, sourceKnown: mode === "move" }));
        const signature = JSON.stringify({ destination, mode });
        if (signatures.get(actor.id) === signature && active.simulation.snapshot.tick % 200 !== 0) return;
        active.replaceSelection([actor.id]); assert.deepEqual(active.selectedIds, [actor.id]);
        active.setCameraCenter(destination.x + 0.5, destination.y + 0.5); active.setOrderMode(mode);
        const camera = active.cameraView, bounds = active.canvas.getBoundingClientRect(), scale = 512 / camera.width;
        const clientX = bounds.left + (destination.x + 0.5 - camera.x) * scale * bounds.width / 512;
        const clientY = bounds.top + (226 - (destination.y + 0.5 - camera.y - camera.height / 2) * scale) * bounds.height / 452;
        const cursor = active.cursorAt(clientX, clientY);
        if (cursor === "blocked") { emit("blocked-command", { id: actor.id, destination, purpose }); return; }
        active.commandAt(clientX, clientY); commands++; signatures.set(actor.id, signature);
        emit("command", { id: actor.id, destination, mode, purpose, visible, cursor });
      };
      const observe = () => {
        const snapshot = active.simulation.snapshot, campaign = active.campaignSnapshot!;
        const bindings = new Map(active.nativeBindings.map(binding => [binding.key, binding.simulationId]));
        const types = new Map(campaign.world.entities.map(actor => [bindings.get(actor.key), actor.unitType]));
        const owned = snapshot.units.filter(actor => active.isOwnedUnit(actor.id) && actor.health > 0 && actor.activity !== "die");
        const enemies = [...snapshot.units, ...snapshot.staticTargets].filter(actor => actor.health > 0 &&
          actor.team !== undefined && actor.team >= 0 && actor.team < 8 && active.visibility[actor.cellY * active.grid.width + actor.cellX] &&
          areHostile({ faction, team: 0 }, actor, snapshot.teamAlliances));
        for (const entry of active.campaignJournal) for (const trigger of entry.fired) if (!fired.has(trigger)) {
          fired.add(trigger); emit("source-trigger", { trigger, entry });
        }
        const summary = { tick: snapshot.tick, outcome: active.missionOutcome, diagnostic: active.missionDiagnostic,
          commands, shots, deaths, credits: active.resourceWorkflow.credits[0], earned: active.browserEconomyState?.earned[0],
          statistics: active.missionStatistics, buildingSlots: campaign.world.buildingSlots, fired: [...fired],
          owned: owned.map(actor => ({ id: actor.id, type: types.get(actor.id), hp: actor.health, ...point(actor), activity: actor.activity })),
          enemies: enemies.map(actor => ({ id: actor.id, type: types.get(actor.id), hp: actor.health, ...point(actor) })) };
        write("latest", summary);
        return { snapshot, campaign, types, owned, enemies, summary };
      };
      const plan = () => {
        const state = observe(), economy = active.browserEconomyState;
        const blocked = new Set(active.simulation.staticObstacleCells.map(cell => active.grid.index(cell.x, cell.y)));
        const move = (actor: typeof state.owned[number], destination: GridPoint, purpose: string, exact = false) => {
          if (distance(point(actor), destination) < 0.5) return;
          if (actor.movementPlane === "air") { order(actor, destination, "move", purpose); return; }
          const candidates = exact ? [destination] : Array.from({ length: 49 }, (_, index) =>
            ({ x: destination.x + index % 7 - 3, y: destination.y + Math.floor(index / 7) - 3 }))
            .sort((left, right) => distance(left, destination) - distance(right, destination));
          for (const target of candidates) {
            const route = findPath(active.grid, point(actor), target, { blocked });
            if (route?.length) { order(actor, route[Math.min(16, route.length - 1)], "move", purpose); return; }
          }
          emit("route-blocked", { id: actor.id, destination, purpose });
        };
        const collectors = state.owned.filter(actor => [6, 14].includes(state.types.get(actor.id)!));
        for (const collector of collectors) {
          if (economy?.orders.some(entry => entry.simulationId === collector.id)) continue;
          const resources = active.resourceSources.filter(source => source.status === 1 && (source.remaining ?? 0) > 0 && (source.rate ?? 0) > 0);
          const resource = resources.sort((left, right) => distance(point(collector), { x: left.position.x >> 8, y: left.position.y >> 8 }) -
            distance(point(collector), { x: right.position.x >> 8, y: right.position.y >> 8 }))[0];
          if (resource) {
            const destination = { x: resource.position.x >> 8, y: resource.position.y >> 8 };
            if (active.visibility[destination.y * active.grid.width + destination.x]) {
              active.replaceSelection([collector.id]); const accepted = active.harvestSelected(resource.slot);
              emit("harvestSelected", { id: collector.id, slot: resource.slot, accepted });
            } else move(collector, destination, "source-resource-scout");
          }
        }
        const dependency = faction === "human" ? collectors.length ? 9 : 7 : collectors.length || id === "A11" ? 23 : 21;
        const choice = active.productionMenu.find(choice => choice.dependency === dependency);
        if (state.owned.length < 20 && choice?.enabled && !choice.pending && !choice.queued && active.resourceWorkflow.credits[0] >= choice.cost) {
          emit("purchaseProduction", { dependency, cost: choice.cost, credits: active.resourceWorkflow.credits[0], accepted: active.purchaseProduction(dependency) });
        }
        if (id === "A10" && state.snapshot.tick === 0) {
          emit("purchaseConstruction", { dependency: 14, menu: active.constructionMenu, accepted: active.purchaseConstruction(14) });
        }
        for (const actor of state.owned.filter(actor => !collectors.includes(actor))) {
          const type = state.types.get(actor.id)!;
          if ([4, 12].includes(type)) {
            if (!stopped.has(actor.id)) { active.replaceSelection([actor.id]); active.stopSelected(); stopped.add(actor.id); emit("stopSelected", { id: actor.id }); continue; }
            if (!deployed.has(actor.id)) { active.replaceSelection([actor.id]); const accepted = active.deploySelected();
              emit("deploySelected", { id: actor.id, accepted }); if (accepted.includes(actor.id)) deployed.add(actor.id); }
            if (deployed.has(actor.id)) continue;
          }
          const stat = mission.units.find(stat => stat.index === type), weapon = mission.weapons.find(weapon => weapon.id === stat?.weapons[0]);
          const enemy = state.enemies.filter(enemy => {
            const target = mission.units.find(stat => stat.index === state.types.get(enemy.id));
            return weapon && weapon.rawPrefix !== undefined && target?.targetClass !== undefined &&
              (mission.damageMatrix?.[weapon.rawPrefix]?.[target.targetClass] ?? 0) > 0 && distance(point(actor), point(enemy)) < 12;
          }).sort((left, right) => distance(point(actor), point(left)) - distance(point(actor), point(right)))[0];
          if (enemy && weapon) {
            if (distance(point(actor), point(enemy)) <= weapon.range - 0.25) {
              if (actor.activity !== "attack" || actor.targetId !== enemy.id) order(actor, point(enemy), "assault", "visible-hostile");
              continue;
            }
            const candidates = Array.from({ length: 81 }, (_, index) => ({ x: enemy.cellX + index % 9 - 4,
              y: enemy.cellY + Math.floor(index / 9) - 4 })).filter(cell => distance(cell, point(enemy)) <= weapon.range - 0.75 &&
                !state.owned.some(other => other.id !== actor.id && distance(point(other), cell) < 1))
              .sort((left, right) => distance(point(actor), left) - distance(point(actor), right));
            if (candidates[0]) move(actor, candidates[0], "visible-hostile-firing-position", true);
            continue;
          }
          if (id === "H10" && actor.movementPlane === "air") {
            const trip = [1, 2, 5].find(trigger => !fired.has(trigger));
            const destination = trip === undefined ? undefined : [...contract.trips[trip]].sort((left, right) => distance(point(actor), left) - distance(point(actor), right))[0];
            if (destination) { move(actor, destination, "source-SARGE-trip", true); continue; }
          }
          if (id === "H11") {
            const tripId = fired.has(11) ? 13 : 9;
            if (!fired.has(9) || fired.has(11)) {
              const cells = [...contract.trips[tripId]].sort((left, right) => distance(point(actor), left) - distance(point(actor), right));
              if (cells[0]) { move(actor, cells[0], `source-trip-${tripId}`, true); continue; }
            }
            for (const target of known.filter(target => target.team === 1)) {
              if (distance(point(actor), target) <= 2) visited.add(target.key);
            }
            const goal = known.filter(target => target.team === 1 && !visited.has(target.key))
              .sort((left, right) => distance(point(actor), left) - distance(point(actor), right))[0];
            if (goal) move(actor, goal, "source-POW-scout");
          } else {
            const goal = goals.filter(goal => !visited.has(goal.key)).sort((left, right) => distance(point(actor), left) - distance(point(actor), right))[0];
            if (goal) {
              const target = state.campaign.world.entities.find(entity => entity.key === goal.key);
              if (active.visibility[goal.y * active.grid.width + goal.x] && (!target || target.health <= 0)) visited.add(goal.key);
              else move(actor, goal, "source-city-scout");
            }
          }
        }
      };
      active.resetClock(); active.update(0);
      while (Date.now() - started < budgetMs - 4000 && active.simulation.snapshot.tick < 40000) {
        if (active.missionDiagnostic || active.missionOutcome?.ready) break;
        const tick = active.simulation.snapshot.tick;
        if (!active.missionOutcome && tick % 100 === 0) plan();
        active.update(clock += 50); shots += active.simulation.combatEvents.length; deaths += active.simulation.deathEvents.length;
        if (active.missionOutcome?.resultCode === 0 && !active.missionOutcome.ready && !pending) {
          pending = true; write("pending-win", { sourceHash, view: active.checkpoint() }); emit("pending-win", active.missionOutcome);
        }
        if (tick === active.simulation.snapshot.tick && !active.missionOutcome?.ready) break;
      }
      const state = observe();
      write("checkpoint", { sourceHash, view: active.checkpoint() }); write("campaign-journal", active.campaignJournal);
      result = { id, ...state.summary, status: classify(active.missionOutcome, active.missionDiagnostic), sourceHash,
        menu: active.productionMenu, construction: active.constructionMenu, interception: active.browserEconomyState?.incomeInterception };
      if (active.missionOutcome?.resultCode === 0) assert.ok([...fired].some(trigger => winIds[id].includes(trigger)));
    }
  } catch (error) {
    result = { ...result, diagnostic: error instanceof Error ? error.stack : String(error), tick: view?.simulation.snapshot.tick, outcome: view?.missionOutcome };
    emit("failure", result);
  } finally {
    const after = integrity(), changed = Object.keys(before).filter(path => before[path] !== after[path]);
    const changedAssets = Object.keys(fetched).filter(path => fetched[path] !== hash(read(`public${path}`)));
    write(proof ? "proof-integrity" : "integrity", { before, after, changed, fetched, changedAssets });
    if (changed.length || changedAssets.length) result.status = "RUNTIME_CHANGED";
    result.elapsedMs = Date.now() - started; write(proof ? "proof-result" : "result", result);
    view?.dispose(); renderer.dispose(); globalThis.fetch = originalFetch;
  }
  return result;
}

export function budgets(playMs = 600000, restoreMs = 480000) {
  assert.ok(Number.isInteger(playMs) && playMs > 0 && playMs <= 600000);
  assert.ok(Number.isInteger(restoreMs) && restoreMs > 0 && restoreMs <= 480000);
  return { playMs, restoreMs };
}

export function runGroup(output: string, limits = budgets()) {
  mkdirSync(output, { recursive: true });
  const started = Date.now(), receipts: unknown[] = [];
  const allocations: Record<MissionId, number> = { H11: 0.35, A11: 0.25, H10: 0.13, A10: 0.09, H12: 0.09, A12: 0.09 };
  const run = (id: MissionId, budgetMs: number, proof: boolean) => {
    const directory = `${output}/${id}`; mkdirSync(directory, { recursive: true });
    const log = `${directory}/${proof ? "proof" : "play"}-${Date.now()}.log`, descriptor = openSync(log, "wx"), start = Date.now();
    const child = spawnSync(process.execPath, ["--import", fileURLToPath(new URL("node_modules/tsx/dist/loader.mjs", root)),
      fileURLToPath(import.meta.url), "--worker", `--id=${id}`, `--output=${directory}`, `--budget=${budgetMs}`, ...(proof ? ["--proof"] : [])],
    { cwd: fileURLToPath(root), stdio: ["ignore", descriptor, descriptor], timeout: budgetMs, killSignal: "SIGKILL" });
    closeSync(descriptor);
    const receipt = { id, proof, log, budgetMs, elapsedMs: Date.now() - start, pid: child.pid, code: child.status, signal: child.signal, error: child.error?.message };
    writeFileSync(`${directory}/${proof ? "proof-exit" : "exit"}.json`, JSON.stringify(receipt)); receipts.push(receipt);
  };
  for (const id of missions) {
    const remaining = limits.playMs - (Date.now() - started);
    if (remaining <= 0) break;
    run(id, Math.max(1, Math.min(Math.floor(limits.playMs * allocations[id]), remaining)), false);
  }
  const playElapsedMs = Date.now() - started, proofStarted = Date.now();
  const winners = missions.filter(id => existsSync(`${output}/${id}/pending-win.json`) && existsSync(`${output}/${id}/result.json`) &&
    JSON.parse(readFileSync(`${output}/${id}/result.json`, "utf8")).status === "READY_WIN_UNVERIFIED");
  for (const [index, id] of winners.entries()) {
    const remaining = limits.restoreMs - (Date.now() - proofStarted);
    if (remaining <= 0) break;
    run(id, Math.floor(remaining / (winners.length - index)), true);
  }
  const results = missions.map(id => {
    const file = `${output}/${id}/result.json`, proofFile = `${output}/${id}/proof-result.json`;
    const result = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { id, status: "HARD_DEADLINE" };
    const proof = existsSync(proofFile) ? JSON.parse(readFileSync(proofFile, "utf8")) : undefined;
    return { ...result, ...(proof?.status === "WIN" ? { status: "WIN", proof } : {}), artifacts: `${output}/${id}` };
  });
  const report = { output, limits, playElapsedMs, restoreElapsedMs: Date.now() - proofStarted, receipts, results,
    scope: "Six current-loader original-source public-command NullCanvas replays, not all missions or browser/native parity." };
  writeFileSync(`${output}/group.json`, JSON.stringify(report));
  console.log(JSON.stringify({ output, playElapsedMs, results: results.map(result => ({ id: result.id, status: result.status, tick: result.tick })) }));
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argument = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const output = argument("output") ?? `/tmp/dc-campaign-10-12-${Date.now()}`;
  if (process.argv.includes("--audit")) {
    const group = JSON.parse(readFileSync(`${output}/group.json`, "utf8"));
    const summary = group.results.map((result: Record<string, any>) => {
      const directory = `${output}/${result.id}`;
      const saved = JSON.parse(readFileSync(`${directory}/integrity.json`, "utf8"));
      return { id: result.id, status: result.status, tick: result.tick, diagnostic: result.diagnostic, outcome: result.outcome,
        commands: result.commands, shots: result.shots, deaths: result.deaths, credits: result.credits, earned: result.earned,
        fired: result.fired, buildingSlots: result.buildingSlots, team1Losses: result.statistics?.["1,3"],
        owned: result.owned, interception: result.interception, changed: saved.changed, changedAssets: saved.changedAssets };
    });
    writeFileSync(`${output}/summary.json`, JSON.stringify({ playElapsedMs: group.playElapsedMs, results: summary }, null, 2));
  } else if (process.argv.includes("--worker")) {
    const id = argument("id") as MissionId; assert.ok(missions.includes(id));
    await replay(id, output, Number(argument("budget")), process.argv.includes("--proof"));
  } else if (process.argv.includes("--run")) runGroup(output);
}
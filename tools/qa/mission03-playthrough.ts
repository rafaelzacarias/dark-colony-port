import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadReleaseMission } from "./fixtures/release-mission";
import { MissionView } from "../../src/mission-view";
import { parseTriggerScript } from "../extractors/data/triggers";
import { installSourceRender } from "./fixtures/source-render";
import { areHostile } from "../../src/engine/diplomacy";
import { findPath } from "../../src/engine/pathfinding";
import type { GridPoint } from "../../src/engine/grid";
import { sourceScenarioUpgradeLevels } from "../../src/engine/legacy-balance";

const root = new URL("../../", import.meta.url);
export const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const read = (path: string) => readFileSync(new URL(path, root));
export type Faction03 = "human" | "alien";

export function inspectMission03(mission: MissionView["mission"]) {
  const faction = mission.faction;
  assert.equal(mission.scenario.id.toUpperCase(), `${faction.toUpperCase()}03`);
  assert.equal(mission.runtimeProfile, "browser-adapted");
  assert.equal(mission.sourceNativeCombat, undefined);
  const stem = `raw_cd/DC/SCENARIO/${faction.toUpperCase()}/${faction.toUpperCase()}03`;
  const sources = Object.fromEntries(["SCN", "TRO", "MAP", "MTG", "PTH"].map(extension => [extension, sha256(read(`${stem}.${extension}`))]));
  assert.equal(mission.scenario.source.sha256, sources.SCN);
  assert.deepEqual(mission.triggers, parseTriggerScript(read(`${stem}.TRO`).toString()));
  const enemyTeam = faction === "human" ? 2 : 1;
  const win = mission.triggers.find(block => block.id === (faction === "human" ? 1 : 3))!;
  assert.equal(win.condition, `((b(${enemyTeam},0)==0)&&(b(${enemyTeam},1)==0)&&(b(${enemyTeam},2)==0)&&(b(${enemyTeam},3)==0)&&(b(${enemyTeam},4)==0))`);
  assert.ok(win.actions.some(action => action.name === "bail" && action.arguments[0] === 0));
  if (faction === "alien") {
    const trip = mission.triggers.find(block => block.id === 8)!;
    assert.equal(trip.mode, "trip");
    assert.equal(trip.condition, "(S==0)");
    assert.ok(trip.actions.some(action => action.name === "setlifes" && JSON.stringify(action.arguments) === "[3,1]"));
    assert.ok(trip.actions.some(action => action.name === "reinforce2" && action.arguments[3] === 94));
  }
  return { faction, enemyTeam, sources, sourceHash: sha256(JSON.stringify(mission)), briefing: mission.briefing?.plainText,
    win, losses: mission.triggers.filter(block => block.actions.some(action => action.name === "bail" && action.arguments[0] === 1)) };
}

export async function preflight03(faction: Faction03, output: string) {
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
    const mission = await loadReleaseMission(faction, 3);
    const contract = inspectMission03(mission);
    view = new MissionView(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
    await view.initialize();
    assert.equal(view.missionDiagnostic, undefined);
    const report = { contract, scenario: mission.scenario, world: view.campaignSnapshot!.world,
      bindings: view.nativeBindings, simulation: view.simulation.snapshot, menu: view.productionMenu,
      resources: view.resourceSources, checkpoint: view.checkpoint() };
    writeFileSync(`${output}/${faction}-preflight.json`, JSON.stringify(report));
    console.log(JSON.stringify({ faction, output, briefing: contract.briefing, sources: contract.sources,
      units: report.simulation.units.length, statics: report.simulation.staticTargets.length }));
    return contract;
  } finally { view?.dispose(); renderer.dispose(); globalThis.fetch = originalFetch; }
}

export function mission03Limits(stepMs = 240000, maxTicks = 30000) {
  assert.ok(Number.isSafeInteger(stepMs) && stepMs > 0 && stepMs <= 600000);
  assert.ok(Number.isSafeInteger(maxTicks) && maxTicks > 0 && maxTicks <= 60000);
  return { stepMs, maxTicks, restoreMs: 900000 };
}

export function mission03TripCells(tags: Uint8Array, width: number, height: number, triggerId: number) {
  assert.equal(tags.length, width * height);
  return Array.from(tags).flatMap((tag, index) => (tag & 63) === triggerId
    ? [{ x: index % width, y: height - 1 - Math.floor(index / width) }] : []);
}

export function mission03Status(outcome: MissionView["missionOutcome"], diagnostic: string | undefined, exact: boolean) {
  if (diagnostic) return "RUNTIME_BLOCKER";
  if (outcome?.ready) return outcome.resultCode === 0 ? exact ? "WIN" : "READY_WIN_UNVERIFIED" : "SOURCE_LOSS";
  return "HARNESS_LIMIT";
}

function runtimeHashes() {
  const paths = readdirSync(new URL("src/", root), { recursive: true }).map(String).filter(path => path.endsWith(".ts"))
    .map(path => `src/${path}`).concat(["tools/qa/fixtures/browser-campaign-playthrough.ts"]);
  return Object.fromEntries(paths.sort().map(path => [path, sha256(read(path))]));
}

type Checkpoint = ReturnType<MissionView["checkpoint"]>;
interface Saved03 { sourceHash: string; view: Checkpoint; trip?: unknown; spawn94?: unknown }

export async function runMission03(faction: Faction03, output: string, limits = mission03Limits(), resume?: string, proofDirectory?: string) {
  mkdirSync(output, { recursive: true });
  const started = performance.now(), beforeHashes = runtimeHashes();
  const renderer = installSourceRender();
  renderer.setEnabled(false);
  const originalFetch = globalThis.fetch;
  const fetched: Record<string, string> = {};
  let view: MissionView | undefined;
  const write = (name: string, value: unknown) => writeFileSync(`${output}/${name}.json`, JSON.stringify(value));
  const emit = (kind: string, data: unknown) => appendFileSync(`${output}/journal.jsonl`, `${JSON.stringify({ kind,
    tick: view?.simulation.snapshot.tick ?? 0, elapsedMs: Math.round(performance.now() - started), data })}\n`);
  const phase = (name: string) => { process.send?.({ phase: name }); emit("phase", name); };
  globalThis.fetch = async input => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    const bytes = read(`public${path}`);
    fetched[path] = sha256(bytes);
    return new Response(bytes);
  };
  let result: Record<string, unknown> = { status: "RUNTIME_BLOCKER" };
  try {
    const mission = await loadReleaseMission(faction, 3);
    const contract = inspectMission03(mission);
    write("source", { ...contract, runtimeHashes: beforeHashes, limits,
      limitation: "Actual original-script browser-adapted MissionView, QA NullCanvas; no browser, visual or native parity claim." });
    const saved: Saved03 | undefined = resume ? JSON.parse(readFileSync(resume, "utf8")) : undefined;
    if (saved) assert.equal(saved.sourceHash, contract.sourceHash);
    const make = (checkpoint?: Checkpoint) => checkpoint
      ? MissionView.restore(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission, checkpoint)
      : new MissionView(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
    const prove = async (pending: Saved03, ready: Saved03) => {
      phase("proof");
      assert.equal(pending.sourceHash, contract.sourceHash);
      assert.equal(ready.sourceHash, contract.sourceHash);
      view?.dispose();
      view = undefined;
      const restored = make(JSON.parse(JSON.stringify(pending.view)));
      view = restored;
      assert.deepEqual(restored.checkpoint(), pending.view);
      await restored.initialize();
      assert.equal(restored.missionOutcome?.resultCode, 0);
      assert.equal(restored.missionOutcome?.ready, false);
      restored.resetClock(); restored.update(0);
      const ticks = ready.view.simulation.tick - pending.view.simulation.tick;
      assert.ok(ticks > 0 && ticks <= 1000);
      for (let offset = 1; offset <= ticks; offset++) {
        restored.update(offset * 50);
        assert.equal(restored.missionDiagnostic, undefined);
      }
      assert.equal(restored.missionOutcome?.ready, true);
      assert.equal(restored.missionOutcome?.resultCode, 0);
      const actual = restored.checkpoint();
      assert.deepEqual(actual, ready.view);
      const evidence = { exactCheckpoint: true, sourceHash: contract.sourceHash, fromTick: pending.view.simulation.tick,
        toTick: ready.view.simulation.tick, expectedHash: sha256(JSON.stringify(ready.view)), actualHash: sha256(JSON.stringify(actual)) };
      write("proof", evidence); emit("pending-to-ready-exact", evidence);
    };
    if (proofDirectory) {
      const pending: Saved03 = JSON.parse(readFileSync(`${proofDirectory}/pending-win.json`, "utf8"));
      const ready: Saved03 = JSON.parse(readFileSync(`${proofDirectory}/checkpoint.json`, "utf8"));
      await prove(pending, ready);
      result = { status: "WIN", exactCheckpoint: true, proofDirectory, sourceHash: contract.sourceHash };
    } else {
      view = make(saved?.view);
      await view.initialize();
      assert.equal(view.missionDiagnostic, undefined);
      const active = view;
      const initial = active.campaignSnapshot!;
      const sourceEntities = initial.world.entities.map(actor => ({ key: actor.key, type: actor.unitType,
        team: actor.team, x: actor.tileX, y: actor.tileY }));
      const sourceGoals = sourceEntities.filter(actor => actor.team === contract.enemyTeam && actor.key.startsWith("colony:"));
      assert.ok(sourceGoals.length > 0);
      const mtg = read(`raw_cd/DC/SCENARIO/${faction.toUpperCase()}/${faction.toUpperCase()}03.MTG`);
      const tripCells = faction === "alien" ? mission03TripCells(mtg.subarray(2), mtg[0], mtg[1], 8) : [];
      if (faction === "alien") assert.ok(tripCells.length > 0);
      write("initial", { sourceEntities, sourceGoals, tripCells, briefing: contract.briefing,
        buildingSlots: initial.world.buildingSlots, menu: active.productionMenu, units: active.simulation.snapshot,
        resources: active.resourceSources, sourceHash: contract.sourceHash });
      const point = (actor: { cellX: number; cellY: number }) => ({ x: actor.cellX, y: actor.cellY });
      const distance = (left: GridPoint, right: GridPoint) => Math.hypot(left.x - right.x, left.y - right.y);
      let trip: unknown = saved?.trip, spawn94: unknown = saved?.spawn94;
      let commands = 0, shots = 0, deaths = 0, purchases = 0, spent = 0, clock = 0;
      let pending: Saved03 | undefined, lastProgress = "", diagnostic: string | undefined;
      const signatures = new Map<string, { value: string; tick: number }>();
      const order = (ids: number[], destination: GridPoint, mode: "move" | "assault", purpose: string) => {
        if (!ids.length) return;
        const tick = active.simulation.snapshot.tick;
        const key = ids.join(","), value = JSON.stringify({ destination, mode, purpose });
        const previous = signatures.get(key);
        if (previous?.value === value && tick - previous.tick < 200) return;
        active.replaceSelection(ids);
        assert.deepEqual(active.selectedIds, [...ids].sort((left, right) => left - right));
        active.setCameraCenter(destination.x + 0.5, destination.y + 0.5);
        active.setOrderMode(mode);
        const camera = active.cameraView, bounds = active.canvas.getBoundingClientRect(), scale = 512 / camera.width;
        const clientX = bounds.left + (destination.x + 0.5 - camera.x) * scale * bounds.width / 512;
        const clientY = bounds.top + (226 - (destination.y + 0.5 - camera.y - camera.height / 2) * scale) * bounds.height / 452;
        const cursor = active.cursorAt(clientX, clientY);
        if (cursor === "blocked") { emit("blocked-command", { ids, destination, mode, purpose }); return; }
        if (purpose === "visible-threat") assert.ok(active.visibility[destination.y * active.grid.width + destination.x]);
        active.commandAt(clientX, clientY);
        signatures.set(key, { value, tick }); commands++;
        emit("command", { ids, destination, mode, purpose, cursor, visible: Boolean(active.visibility[destination.y * active.grid.width + destination.x]) });
      };
      const observe = () => {
        const campaign = active.campaignSnapshot!;
        const bindings = new Map(active.nativeBindings.map(binding => [binding.key, binding.simulationId]));
        const types = new Map(campaign.world.entities.map(actor => [bindings.get(actor.key), actor.unitType]));
        const snapshot = active.simulation.snapshot;
        const owned = snapshot.units.filter(actor => active.isOwnedUnit(actor.id) && actor.health > 0 && actor.activity !== "die");
        const enemies = [...snapshot.units, ...snapshot.staticTargets].filter(actor => actor.health > 0 &&
          actor.team !== undefined && actor.team >= 0 && actor.team < 8 &&
          active.visibility[actor.cellY * active.grid.width + actor.cellX] &&
          areHostile({ faction, team: 0 }, actor, snapshot.teamAlliances));
        if (faction === "alien" && !trip) {
          const journal = active.campaignJournal;
          const entry = journal.find(entry => entry.fired.includes(8));
          if (entry) {
            const commander = owned.find(actor => [73, 74, 75, 76].includes(types.get(actor.id)!));
            assert.ok(commander && tripCells.some(cell => distance(cell, point(commander)) <= 2), "Trip8 must be reached by the actual commander");
            trip = { entry, commander, type: types.get(commander.id), enabledWinBlock: campaign.controller.runtime };
            write("trip8", trip); emit("trip8-observed", trip);
          }
        }
        if (faction === "alien" && !spawn94) {
          const actor = campaign.world.entities.find(actor => actor.team === 0 && actor.unitType === 94 &&
            !sourceEntities.some(original => original.key === actor.key));
          if (actor) { spawn94 = actor; write("spawn94", actor); emit("spawn94-observed", actor); }
        }
        const summary = { tick: snapshot.tick, buildingSlots: campaign.world.buildingSlots, outcome: active.missionOutcome,
          diagnostic: active.missionDiagnostic, credits: active.resourceWorkflow.credits[0], earned: active.browserEconomyState?.earned[0],
          commands, purchases, spent, shots, deaths, trip8: Boolean(trip), spawn94: Boolean(spawn94),
          owned: owned.map(actor => ({ id: actor.id, type: types.get(actor.id), hp: actor.health, x: actor.cellX, y: actor.cellY, activity: actor.activity })),
          visibleEnemies: enemies.map(actor => ({ id: actor.id, hp: actor.health, team: actor.team, x: actor.cellX, y: actor.cellY })) };
        write("latest", summary);
        const signature = JSON.stringify([summary.buildingSlots, summary.outcome, summary.owned.length, Boolean(trip), Boolean(spawn94)]);
        if (signature !== lastProgress || snapshot.tick % 500 === 0) { emit("progress", summary); lastProgress = signature; }
        return { campaign, types, snapshot, owned, enemies, summary };
      };
      const plan = () => {
        const state = observe();
        const commander = state.owned.find(actor => [69, 70, 71, 72, 73, 74, 75, 76].includes(state.types.get(actor.id)!));
        const collectors = state.owned.filter(actor => [6, 14].includes(state.types.get(actor.id)!));
        const troops = state.owned.filter(actor => actor !== commander && !collectors.includes(actor));
        for (const collector of collectors) {
          if (active.browserEconomyState?.orders.some(order => order.simulationId === collector.id)) continue;
          const resource = active.resourceSources.filter(source => source.status === 1 && (source.remaining ?? 0) > 0 &&
            (source.rate ?? 0) > 0 && active.visibility[(source.position.y >> 8) * active.grid.width + (source.position.x >> 8)])
            .sort((left, right) => distance(point(collector), { x: left.position.x >> 8, y: left.position.y >> 8 }) -
              distance(point(collector), { x: right.position.x >> 8, y: right.position.y >> 8 }))[0];
          if (resource) {
            active.replaceSelection([collector.id]);
            const accepted = active.harvestSelected(resource.slot);
            emit("harvest", { actor: collector.id, slot: resource.slot, visible: true, accepted }); commands++;
          }
        }
        const dependency = collectors.length ? faction === "human" ? 9 : 23 : faction === "human" ? 7 : 21;
        const choice = active.productionMenu.find(choice => choice.dependency === dependency);
        if ((faction === "human" || !trip) && troops.length < 18 && choice?.enabled && !choice.pending && !choice.queued && active.resourceWorkflow.credits[0] >= choice.cost) {
          const before = active.resourceWorkflow.credits[0], accepted = active.purchaseProduction(dependency);
          emit("purchase", { dependency, before, cost: choice.cost, accepted });
          if (accepted) { purchases++; spent += choice.cost; }
        }
        const blocked = new Set(active.simulation.staticObstacleCells.map(cell => active.grid.index(cell.x, cell.y)));
        const advance = (actor: typeof troops[number], destination: GridPoint, purpose: string, mode: "move" | "assault" = "assault") => {
          const stat = mission.units.find(stat => stat.index === state.types.get(actor.id))!;
          const levels = sourceScenarioUpgradeLevels(mission.scenario.teams[0], stat.index);
          const weapon = mission.weapons.find(weapon => weapon.id === stat.weapons[levels.weaponLevel]);
          const attackable = (enemy: typeof state.enemies[number]) => {
            if (faction === "human") return true;
            const target = mission.units.find(stat => stat.index === state.types.get(enemy.id));
            return weapon && weapon.rawPrefix !== undefined && target && target.targetClass !== undefined
              && (mission.damageMatrix?.[weapon.rawPrefix]?.[target.targetClass] ?? 0) > 0;
          };
          const nearby = state.enemies.filter(enemy => distance(point(actor), point(enemy)) <= 8 && attackable(enemy))
            .sort((left, right) => distance(point(actor), point(left)) - distance(point(actor), point(right)))[0];
          if (nearby && mode === "assault") {
            if (faction === "alien" && weapon && Math.hypot(actor.xSubcells - nearby.xSubcells,
              actor.ySubcells - nearby.ySubcells) / 1024 > weapon.range - 0.25) {
              const radius = Math.ceil(weapon.range);
              const candidates: { point: GridPoint; route: readonly GridPoint[] }[] = [];
              for (let offsetY = -radius; offsetY <= radius; offsetY++) for (let offsetX = -radius; offsetX <= radius; offsetX++) {
                if (Math.hypot(offsetX, offsetY) > weapon.range - 0.75) continue;
                const target = { x: nearby.cellX + offsetX, y: nearby.cellY + offsetY };
                if (state.owned.some(other => other.id !== actor.id && distance(point(other), target) < 1)) continue;
                const route = findPath(active.grid, point(actor), target, { blocked });
                if (route?.length) candidates.push({ point: target, route });
              }
              candidates.sort((left, right) => left.route.length - right.route.length || left.point.y - right.point.y || left.point.x - right.point.x);
              const route = candidates[0]?.route;
              if (route) order([actor.id], route[Math.min(7, route.length - 1)], "move", "source-firing-position");
              return;
            }
            if (actor.activity !== "attack" || actor.targetId !== nearby.id) order([actor.id], point(nearby), "assault", "visible-threat");
            return;
          }
          if (actor.activity === "attack" && (faction === "human" || state.enemies.some(enemy => enemy.id === actor.targetId && attackable(enemy)))) return;
          if (distance(point(actor), destination) < (purpose === "actual-commander-trip8" ? 0.1 : 2)) return;
          const candidates = Array.from({ length: 81 }, (_, index) => ({ x: destination.x + index % 9 - 4,
            y: destination.y + Math.floor(index / 9) - 4 })).sort((left, right) => distance(left, destination) - distance(right, destination));
          for (const target of candidates) {
            const route = findPath(active.grid, point(actor), target, { blocked });
            if (route?.length) { order([actor.id], route[Math.min(12, route.length - 1)], faction === "alien" ? "move" : mode, purpose); return; }
          }
          emit("route-blocked", { actor: actor.id, destination, purpose });
        };
        const homeRow = mission.scenario.teams[0].coordinateRows[0];
        const home = { x: homeRow[0], y: homeRow[1] };
        const discovery = faction === "alien" && !trip && commander ? [...tripCells].sort((left, right) =>
          distance(point(commander), left) - distance(point(commander), right))[0] : undefined;
        if (commander && discovery) advance(commander, discovery, "actual-commander-trip8", "move");
        const threat = state.enemies.find(enemy => distance(point(enemy), home) < 14 || collectors.some(actor => distance(point(enemy), point(actor)) < 9));
        const goal = faction === "alien"
          ? sourceGoals.find(goal => state.campaign.world.entities.some(actor => actor.key === goal.key && actor.health > 0)) ?? sourceGoals[0]
          : sourceGoals[0];
        const assembled = troops.length >= 7 || state.snapshot.tick > 1400;
        for (const actor of troops) {
          const destination = threat ? point(threat) : discovery ? home : assembled ? goal : home;
          advance(actor, destination, threat ? "defend-player" : discovery ? "escort-discovery" : assembled ? "source-city-assault" : "assemble");
        }
        if (commander && !discovery) advance(commander, threat ? point(threat) : assembled ? goal : home,
          threat ? "defend-commander" : "source-city-assault");
      };
      phase("stepping");
      const stepStart = performance.now(), startTick = active.simulation.snapshot.tick;
      active.resetClock(); active.update(0);
      while (performance.now() - stepStart < Math.max(1, limits.stepMs - 3000) && active.simulation.snapshot.tick - startTick < limits.maxTicks) {
        if (active.missionDiagnostic || active.missionOutcome?.ready) break;
        const tick = active.simulation.snapshot.tick;
        if (!pending && (tick - startTick) % 100 === 0) plan();
        active.update(clock += 50);
        shots += active.simulation.combatEvents.length; deaths += active.simulation.deathEvents.length;
        if (active.simulation.deathEvents.length) emit("deaths", active.simulation.deathEvents);
        if (active.missionOutcome?.resultCode === 0 && !active.missionOutcome.ready && !pending) {
          pending = { sourceHash: contract.sourceHash, view: active.checkpoint(), trip, spawn94 };
          write("pending-win", pending); emit("pending-win", active.missionOutcome);
        }
        if (active.simulation.snapshot.tick === tick && !active.missionDiagnostic && !active.missionOutcome?.ready) {
          diagnostic = "Public update did not advance simulation"; break;
        }
      }
      phase("finalize");
      const final = observe();
      const ready: Saved03 = { sourceHash: contract.sourceHash, view: active.checkpoint(), trip, spawn94 };
      write("checkpoint", ready);
      const steppingMs = Math.round(performance.now() - stepStart);
      diagnostic ??= active.missionDiagnostic;
      const outcome = active.missionOutcome;
      result = { ...final.summary, status: mission03Status(outcome, diagnostic, false), diagnostic,
        stoppingReason: diagnostic ? "runtime-diagnostic" : outcome?.ready ? "source-outcome" : "harness-deadline-or-tick-cap",
        steppingMs, startTick, sourceHash: contract.sourceHash, sources: contract.sources, checkpointHash: sha256(JSON.stringify(ready.view)) };
      write("play-result", result);
      if (outcome?.ready && outcome.resultCode === 0 && pending) {
        if (faction === "alien") { assert.ok(trip, "Actual trip8 required"); assert.ok(spawn94, "Actual type94 spawn required"); }
        for (let slot = 0; slot < 5; slot++) assert.equal(final.campaign.world.buildingSlots[`${contract.enemyTeam},${slot}`], 0);
        assert.ok([0, 1, 2, 3, 4].some(slot => final.campaign.world.buildingSlots[`0,${slot}`] > 0));
        if (faction === "human") assert.ok([0, 1, 2, 3, 4].some(slot => final.campaign.world.buildingSlots[`7,${slot}`] > 0));
        await prove(pending, ready);
        result.status = "WIN"; result.exactCheckpoint = true;
      }
    }
  } catch (error) {
    result = { ...result, status: "RUNTIME_BLOCKER", diagnostic: error instanceof Error ? error.stack : String(error),
      tick: view?.simulation.snapshot.tick ?? 0, outcome: view?.missionOutcome ?? null };
    emit("failure", result);
    try { if (view) write("failure-checkpoint", view.checkpoint()); } catch {}
  } finally {
    const afterHashes = runtimeHashes();
    const changed = Object.keys(beforeHashes).filter(path => beforeHashes[path] !== afterHashes[path]);
    write("integrity", { before: beforeHashes, after: afterHashes, changed, fetched });
    if (changed.length) { result.status = "RUNTIME_CHANGED"; result.changed = changed; }
    result.totalMs = Math.round(performance.now() - started);
    write("result", result); emit("result", result);
    console.log(JSON.stringify({ faction, output, ...result }));
    view?.dispose(); renderer.dispose(); globalThis.fetch = originalFetch;
  }
  return result;
}

async function supervise03(faction: Faction03, output: string, limits: ReturnType<typeof mission03Limits>) {
  mkdirSync(output, { recursive: true });
  const child = fork(fileURLToPath(import.meta.url), ["--run", `--faction=${faction}`], {
    env: { ...process.env, DC_M03_WORKER: "1", DC_M03_OUTPUT: output, DC_M03_STEP_MS: String(limits.stepMs), DC_M03_MAX_TICKS: String(limits.maxTicks) },
    detached: true, stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  let phase = "initialize", expired = false;
  let timer: ReturnType<typeof setTimeout>;
  const terminate = () => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} } };
  const arm = (next: string) => {
    clearTimeout(timer); phase = next;
    const budgetMs = phase === "stepping" ? limits.stepMs : limits.restoreMs;
    appendFileSync(`${output}/supervisor.jsonl`, `${JSON.stringify({ phase, budgetMs, childPid: child.pid, at: Date.now() })}\n`);
    timer = setTimeout(() => { expired = true; terminate(); }, budgetMs);
  };
  arm("initialize");
  child.on("message", message => { if (message && typeof message === "object" && "phase" in message &&
    ["stepping", "proof", "finalize"].includes(String(message.phase))) arm(String(message.phase)); });
  process.once("SIGTERM", terminate); process.once("SIGINT", terminate);
  const receipt = await new Promise<{ code: number | null; signal: string | null }>(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
  clearTimeout(timer!); process.removeListener("SIGTERM", terminate); process.removeListener("SIGINT", terminate);
  writeFileSync(`${output}/exit.json`, JSON.stringify({ ...receipt, phase, expired, childPid: child.pid, parentPid: process.pid }));
  if (expired) writeFileSync(`${output}/deadline.json`, JSON.stringify({ status: "HARNESS_DEADLINE", phase, sourceOutcome: "See latest.json/play-result.json; timeout is not a source outcome" }));
  return receipt;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = process.env.DC_M03_OUTPUT ?? `/tmp/dc-mission03-${Date.now()}`;
  const selected = process.argv.find(argument => argument.startsWith("--faction="))?.split("=")[1];
  assert.ok(selected === undefined || selected === "human" || selected === "alien");
  const factions: Faction03[] = selected ? [selected] : ["human", "alien"];
  const limits = mission03Limits(Number(process.env.DC_M03_STEP_MS ?? 240000), Number(process.env.DC_M03_MAX_TICKS ?? 30000));
  for (const faction of factions) {
    if (!process.argv.includes("--run")) await preflight03(faction, output);
    else if (process.env.DC_M03_WORKER) {
      const result = await runMission03(faction, output, limits, process.env.DC_M03_RESUME, process.env.DC_M03_PROOF);
      if (result.status !== "WIN") process.exitCode = 1;
    } else {
      const receipt = await supervise03(faction, `${output}/${faction}`, limits);
      if (receipt.code !== 0) process.exitCode = 1;
    }
  }
}
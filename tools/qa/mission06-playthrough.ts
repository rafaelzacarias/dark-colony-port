import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { parseTriggerScript } from "../extractors/data/triggers";
import { installSourceRender } from "./fixtures/source-render";
import { sourceBrowserCampaignSessionOptions } from "../../src/engine/source-browser-campaign-options";
import { areHostile } from "../../src/engine/diplomacy";
import { findPath } from "../../src/engine/pathfinding";
import type { GridPoint } from "../../src/engine/grid";
import { sourceScenarioUpgradeLevels } from "../../src/engine/legacy-balance";
import { legacyStaticOccupancyFieldsFromSource } from "../../src/engine/legacy-static-occupancy";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
export const hash06 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export type Faction06 = "human" | "alien";

export function isAir06(stat: { movementSpeed: number; rawTail?: readonly number[] }) {
  if (stat.movementSpeed <= 0 || stat.rawTail === undefined) return false;
  const fields = legacyStaticOccupancyFieldsFromSource({ rawTail: stat.rawTail });
  return fields.auxiliaryField === 0 && fields.movementClassByte !== 0;
}

export function airFiringPoint06(actor: GridPoint, target: GridPoint, range: number): GridPoint {
  const distance = Math.hypot(actor.x - target.x, actor.y - target.y);
  const radius = Math.max(0, range - 1);
  if (distance <= radius) return actor;
  return { x: Math.round(target.x + (actor.x - target.x) * radius / distance),
    y: Math.round(target.y + (actor.y - target.y) * radius / distance) };
}

export function tripCells06(tags: Uint8Array, width: number, height: number, triggerId: number) {
  assert.equal(tags.length, width * height);
  return Array.from(tags).flatMap((tag, index) => (tag & 63) === triggerId
    ? [{ x: index % width, y: height - 1 - Math.floor(index / width) }] : []);
}

export function inspect06(mission: MissionView["mission"]) {
  const faction = mission.faction;
  const stem = `raw_cd/DC/SCENARIO/${faction.toUpperCase()}/${faction.toUpperCase()}06`;
  const sources = Object.fromEntries(["SCN", "TRO", "MAP", "MTG", "PTH"].map(extension => [extension, hash06(read(`${stem}.${extension}`))]));
  assert.equal(mission.scenario.id.toUpperCase(), `${faction.toUpperCase()}06`);
  assert.equal(mission.runtimeProfile, "browser-adapted");
  assert.equal(mission.scenario.source.sha256, sources.SCN);
  assert.deepEqual(mission.triggers, parseTriggerScript(read(`${stem}.TRO`).toString()));
  const win = mission.triggers.find(block => block.id === (faction === "human" ? 1 : 12))!;
  assert.equal(win.condition, faction === "human" ? "(S==0)" : "((b(2,0)==0)&&(b(2,1)==0)&&(b(2,2)==0)&&(b(2,3)==0)&&(b(2,4)==0))");
  assert.ok(win.actions.some(action => action.name === "bail" && action.arguments[0] === 0));
  if (faction === "human") assert.equal(win.mode, "trip");
  else assert.ok(win.actions.some(action => action.name === "abduct" && JSON.stringify(action.arguments) === "[0,0]"));
  const mtg = read(`${stem}.MTG`);
  const trips = Object.fromEntries(mission.triggers.filter(block => block.mode === "trip").map(block =>
    [block.id, tripCells06(mtg.subarray(2), mtg[0], mtg[1], block.id)]));
  return { faction, sources, sourceHash: hash06(JSON.stringify(mission)), briefing: mission.briefing?.plainText, win, trips };
}

export async function preflight06(faction: Faction06, output: string) {
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
    const mission = await loadCampaignMission(faction, 6, "browser-adapted");
    const contract = inspect06(mission);
    writeFileSync(`${output}/${faction}-source.json`, JSON.stringify({ contract, scenario: mission.scenario,
      triggers: mission.triggers, commanderOptions: sourceBrowserCampaignSessionOptions(mission).commanders }));
    view = new MissionView(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
    await view.initialize();
    assert.equal(view.missionDiagnostic, undefined);
    const report = { contract, world: view.campaignSnapshot!.world, bindings: view.nativeBindings,
      simulation: view.simulation.snapshot, menu: view.productionMenu, resources: view.resourceSources };
    writeFileSync(`${output}/${faction}-preflight.json`, JSON.stringify(report));
    console.log(JSON.stringify({ faction, output, briefing: contract.briefing, units: report.simulation.units.length,
      statics: report.simulation.staticTargets.length, trips: contract.trips }));
    return report;
  } catch (error) {
    writeFileSync(`${output}/${faction}-blocker.json`, JSON.stringify({ status: "RUNTIME_BLOCKER", diagnostic: String(error) }));
    throw error;
  } finally { view?.dispose(); renderer.dispose(); globalThis.fetch = originalFetch; }
}

export function limits06(stepMs = 600000, maxTicks = 40000) {
  assert.ok(Number.isSafeInteger(stepMs) && stepMs > 0 && stepMs <= 600000);
  assert.ok(Number.isSafeInteger(maxTicks) && maxTicks > 0 && maxTicks <= 60000);
  return { stepMs, maxTicks, restoreMs: 900000 };
}

export function status06(outcome: MissionView["missionOutcome"], diagnostic: string | undefined, exact: boolean) {
  if (diagnostic) return "RUNTIME_BLOCKER";
  if (!outcome?.ready) return "HARNESS_LIMIT";
  if (outcome.resultCode !== 0) return "SOURCE_LOSS";
  return exact ? "WIN" : "READY_WIN_UNVERIFIED";
}

function runtimeHashes06() {
  const paths = readdirSync(new URL("src/", root), { recursive: true }).map(String).filter(path => path.endsWith(".ts"))
    .map(path => `src/${path}`).concat(["tools/qa/fixtures/source-render.ts", "tools/qa/fixtures/browser-campaign-playthrough.ts"]);
  return Object.fromEntries(paths.sort().map(path => [path, hash06(read(path))]));
}

type Checkpoint06 = ReturnType<MissionView["checkpoint"]>;
interface Saved06 { sourceHash: string; view: Checkpoint06 }

export async function run06(faction: Faction06, output: string, limits = limits06(), resume?: string, proofDirectory?: string) {
  mkdirSync(output, { recursive: true });
  const started = performance.now(), before = runtimeHashes06();
  const renderer = installSourceRender();
  renderer.setEnabled(false);
  const originalFetch = globalThis.fetch;
  const fetched: Record<string, string> = {};
  let view: MissionView | undefined;
  let result: Record<string, unknown> = { status: "RUNTIME_BLOCKER" };
  const write = (name: string, value: unknown) => writeFileSync(`${output}/${name}.json`, JSON.stringify(value));
  const emit = (kind: string, data: unknown) => appendFileSync(`${output}/journal.jsonl`, `${JSON.stringify({ kind,
    tick: view?.simulation.snapshot.tick ?? 0, elapsedMs: Math.round(performance.now() - started), data })}\n`);
  const phase = (name: string) => { process.send?.({ phase: name }); emit("phase", name); };
  globalThis.fetch = async input => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    const bytes = read(`public${path}`);
    fetched[path] = hash06(bytes);
    return new Response(bytes);
  };
  try {
    const mission = await loadCampaignMission(faction, 6, "browser-adapted");
    const contract = inspect06(mission);
    write("source", { ...contract, limits, commanderOptions: sourceBrowserCampaignSessionOptions(mission).commanders,
      limitation: "Original-script browser-adapted MissionView with real loader and NullCanvas; not browser or native parity." });
    const make = (checkpoint?: Checkpoint06) => checkpoint
      ? MissionView.restore(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission, checkpoint)
      : new MissionView(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
    const prove = async (pending: Saved06, ready: Saved06) => {
      phase("proof");
      const proofStart = performance.now();
      assert.equal(pending.sourceHash, contract.sourceHash);
      assert.equal(ready.sourceHash, contract.sourceHash);
      view?.dispose(); view = undefined;
      view = make(JSON.parse(JSON.stringify(pending.view)));
      assert.deepEqual(view.checkpoint(), pending.view);
      await view.initialize();
      assert.equal(view.missionOutcome?.resultCode, 0);
      assert.equal(view.missionOutcome?.ready, false);
      view.resetClock(); view.update(0);
      const ticks = ready.view.simulation.tick - pending.view.simulation.tick;
      assert.ok(ticks > 0 && ticks <= 1000);
      for (let offset = 1; offset <= ticks; offset++) {
        view.update(offset * 50);
        assert.equal(view.missionDiagnostic, undefined);
      }
      assert.equal(view.missionOutcome?.ready, true);
      assert.equal(view.missionOutcome?.resultCode, 0);
      const actual = view.checkpoint();
      assert.deepEqual(actual, ready.view);
      const proof = { exactCheckpoint: true, sourceHash: contract.sourceHash, fromTick: pending.view.simulation.tick,
        toTick: ready.view.simulation.tick, expectedHash: hash06(JSON.stringify(ready.view)),
        actualHash: hash06(JSON.stringify(actual)), proofMs: Math.round(performance.now() - proofStart) };
      write("proof", proof); emit("pending-to-ready-exact", proof);
    };
    if (proofDirectory) {
      const pending = JSON.parse(readFileSync(`${proofDirectory}/pending-win.json`, "utf8")) as Saved06;
      const ready = JSON.parse(readFileSync(`${proofDirectory}/checkpoint.json`, "utf8")) as Saved06;
      await prove(pending, ready);
      result = { status: "WIN", exactCheckpoint: true, proofDirectory, sourceHash: contract.sourceHash };
    } else {
      const saved: Saved06 | undefined = resume ? JSON.parse(readFileSync(resume, "utf8")) : undefined;
      if (saved) assert.equal(saved.sourceHash, contract.sourceHash);
      view = make(saved?.view);
      await view.initialize();
      assert.equal(view.missionDiagnostic, undefined);
      const active = view;
      const initial = active.campaignSnapshot!;
      const goals = initial.world.entities.filter(actor => actor.team === 2 && actor.key.startsWith("colony:") && actor.unitType !== 81)
        .map(actor => ({ key: actor.key, x: actor.tileX, y: actor.tileY }));
      const exitCells = contract.trips[1] ?? [];
      const scheduledResources = mission.triggers.filter(block => block.mode === "norm" && /^\(c>\d+\)$/.test(block.condition))
        .flatMap(block => block.actions.filter(action => action.name === "newrate")
          .map(action => ({ x: Number(action.arguments[1]), y: Number(action.arguments[2]) })));
      assert.ok(faction === "human" ? exitCells.length : goals.length);
      write("initial", { world: initial.world, bindings: active.nativeBindings, simulation: active.simulation.snapshot,
        menu: active.productionMenu, resources: active.resourceSources, goals, exitCells });
      const point = (actor: { cellX: number; cellY: number }) => ({ x: actor.cellX, y: actor.cellY });
      const distance = (left: GridPoint, right: GridPoint) => Math.hypot(left.x - right.x, left.y - right.y);
      let commands = 0, shots = 0, deaths = 0, purchases = 0, spent = 0, clock = 0;
      let pending: Saved06 | undefined, diagnostic: string | undefined;
      const signatures = new Map<number, { value: string; tick: number }>();
      const order = (id: number, destination: GridPoint, mode: "move" | "assault", purpose: string) => {
        assert.ok(active.isOwnedUnit(id), "Never command an enemy or allied NPC");
        const tick = active.simulation.snapshot.tick, value = JSON.stringify({ destination, mode, purpose });
        const previous = signatures.get(id);
        if (previous?.value === value && tick - previous.tick < 200) return;
        active.replaceSelection([id]);
        assert.deepEqual(active.selectedIds, [id]);
        active.setCameraCenter(destination.x + 0.5, destination.y + 0.5);
        active.setOrderMode(mode);
        const camera = active.cameraView, bounds = active.canvas.getBoundingClientRect(), scale = 512 / camera.width;
        const clientX = bounds.left + (destination.x + 0.5 - camera.x) * scale * bounds.width / 512;
        const clientY = bounds.top + (226 - (destination.y + 0.5 - camera.y - camera.height / 2) * scale) * bounds.height / 452;
        const cursor = active.cursorAt(clientX, clientY);
        const visible = Boolean(active.visibility[destination.y * active.grid.width + destination.x]);
        if (cursor === "blocked") { emit("blocked-command", { id, destination, purpose }); return; }
        if (purpose === "visible-threat") assert.ok(visible);
        active.commandAt(clientX, clientY);
        signatures.set(id, { value, tick }); commands++;
        emit("command", { id, destination, mode, purpose, visible, cursor });
      };
      const observe = () => {
        const campaign = active.campaignSnapshot!, snapshot = active.simulation.snapshot;
        const bindings = new Map(active.nativeBindings.map(binding => [binding.key, binding.simulationId]));
        const types = new Map(campaign.world.entities.map(actor => [bindings.get(actor.key), actor.unitType]));
        const owned = snapshot.units.filter(actor => active.isOwnedUnit(actor.id) && actor.health > 0 && actor.activity !== "die");
        const enemies = [...snapshot.units, ...snapshot.staticTargets].filter(actor => actor.health > 0 &&
          actor.team !== undefined && actor.team >= 0 && actor.team < 8 &&
          active.visibility[actor.cellY * active.grid.width + actor.cellX] &&
          areHostile({ faction, team: 0 }, actor, snapshot.teamAlliances));
        const summary = { tick: snapshot.tick, outcome: active.missionOutcome, diagnostic: active.missionDiagnostic,
          buildingSlots: campaign.world.buildingSlots, credits: active.resourceWorkflow.credits[0], earned: active.browserEconomyState?.earned[0],
          commands, shots, deaths, purchases, spent,
          owned: owned.map(actor => ({ id: actor.id, type: types.get(actor.id), hp: actor.health, x: actor.cellX, y: actor.cellY, activity: actor.activity })),
          visibleEnemies: enemies.map(actor => ({ id: actor.id, hp: actor.health, type: types.get(actor.id), x: actor.cellX, y: actor.cellY })) };
        write("latest", summary);
        if (snapshot.tick % 500 === 0) emit("progress", summary);
        return { campaign, snapshot, types, owned, enemies, summary };
      };
      const plan = () => {
        const state = observe();
        const collectors = state.owned.filter(actor => [6, 14].includes(state.types.get(actor.id)!));
        const troops = state.owned.filter(actor => !collectors.includes(actor));
        for (const collector of collectors) {
          if (active.browserEconomyState?.orders.some(entry => entry.simulationId === collector.id)) continue;
          const resource = active.resourceSources.filter(source => source.status === 1 && (source.remaining ?? 0) > 0 &&
            (source.rate ?? 0) > 0 && active.visibility[(source.position.y >> 8) * active.grid.width + (source.position.x >> 8)])
            .sort((left, right) => distance(point(collector), { x: left.position.x >> 8, y: left.position.y >> 8 }) -
              distance(point(collector), { x: right.position.x >> 8, y: right.position.y >> 8 }))[0];
          if (resource) {
            active.replaceSelection([collector.id]);
            assert.deepEqual(active.selectedIds, [collector.id]);
            const accepted = active.harvestSelected(resource.slot);
            emit("harvest", { id: collector.id, slot: resource.slot, accepted, visible: true }); commands++;
          }
        }
        const dependency = collectors.length ? 23 : 21;
        const choice = active.productionMenu.find(choice => choice.dependency === dependency);
        if (faction === "alien" && troops.length < 18 && choice?.enabled && !choice.pending && !choice.queued &&
          active.resourceWorkflow.credits[0] >= choice.cost) {
          const credits = active.resourceWorkflow.credits[0], accepted = active.purchaseProduction(dependency);
          emit("purchase", { dependency, credits, cost: choice.cost, accepted });
          if (accepted) { purchases++; spent += choice.cost; }
        }
        const blocked = new Set(active.simulation.staticObstacleCells.map(cell => active.grid.index(cell.x, cell.y)));
        const move = (actor: typeof troops[number], destination: GridPoint, purpose: string, air: boolean) => {
          if (distance(point(actor), destination) < 0.5) return;
          if (air) { order(actor.id, destination, "move", purpose); return; }
          const candidates = Array.from({ length: 81 }, (_, index) => ({ x: destination.x + index % 9 - 4,
            y: destination.y + Math.floor(index / 9) - 4 })).sort((left, right) => distance(left, destination) - distance(right, destination));
          for (const target of candidates) {
            const route = findPath(active.grid, point(actor), target, { blocked });
            if (route?.length) { order(actor.id, route[Math.min(12, route.length - 1)], "move", purpose); return; }
          }
          emit("route-blocked", { id: actor.id, destination, purpose });
        };
        for (const collector of collectors) {
          if (active.browserEconomyState?.orders.some(entry => entry.simulationId === collector.id)) continue;
          const destination = [...scheduledResources].sort((left, right) =>
            distance(point(collector), left) - distance(point(collector), right))[0];
          if (destination) move(collector, destination, "source-scheduled-resource-scout", false);
        }
        for (const actor of troops) {
          const type = state.types.get(actor.id)!;
          const stat = mission.units.find(stat => stat.index === type)!;
          const levels = sourceScenarioUpgradeLevels(mission.scenario.teams[0], type);
          const weapon = mission.weapons.find(weapon => weapon.id === stat.weapons[levels.weaponLevel]);
          const air = isAir06(stat);
          const enemies = state.enemies.filter(enemy => {
            const target = mission.units.find(stat => stat.index === state.types.get(enemy.id));
            return weapon && weapon.rawPrefix !== undefined && target?.targetClass !== undefined &&
              (mission.damageMatrix?.[weapon.rawPrefix]?.[target.targetClass] ?? 0) > 0 && distance(point(actor), point(enemy)) < 10;
          }).sort((left, right) => distance(point(actor), point(left)) - distance(point(actor), point(right)));
          const enemy = enemies[0];
          if (enemy && weapon && faction === "alien") {
            const range = Math.hypot(actor.xSubcells - enemy.xSubcells, actor.ySubcells - enemy.ySubcells) / 1024;
            if (range <= weapon.range - 0.25) {
              if (actor.activity !== "attack" || actor.targetId !== enemy.id) order(actor.id, point(enemy), "assault", "visible-threat");
              continue;
            }
            if (air) { move(actor, airFiringPoint06(point(actor), point(enemy), weapon.range), "visible-firing-position", true); continue; }
            const candidates: { destination: GridPoint; route: readonly GridPoint[] }[] = [];
            const radius = Math.ceil(weapon.range);
            for (let offsetY = -radius; offsetY <= radius; offsetY++) for (let offsetX = -radius; offsetX <= radius; offsetX++) {
              if (Math.hypot(offsetX, offsetY) > weapon.range - 0.75) continue;
              const destination = { x: enemy.cellX + offsetX, y: enemy.cellY + offsetY };
              if (state.owned.some(other => other.id !== actor.id && distance(point(other), destination) < 1)) continue;
              const route = findPath(active.grid, point(actor), destination, { blocked });
              if (route?.length) candidates.push({ destination, route });
            }
            candidates.sort((left, right) => left.route.length - right.route.length);
            const route = candidates[0]?.route;
            if (route) order(actor.id, route[Math.min(7, route.length - 1)], "move", "visible-firing-position");
            continue;
          }
          if (faction === "human") {
            const destination = [...exitCells].sort((left, right) => distance(point(actor), left) - distance(point(actor), right))[0];
            move(actor, destination, "source-prison-exit-trip1", air);
          } else {
            const goal = goals.find(goal => state.campaign.world.entities.some(entity => entity.key === goal.key && entity.health > 0)) ?? goals[0];
            const assembled = troops.length >= 8 || state.snapshot.tick > 1600;
            const destination = air || assembled ? goal : { x: 22, y: 97 };
            move(actor, destination, air ? "source-citadel-scout" : assembled ? "source-citadel-assault" : "assemble", air);
          }
        }
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
          pending = { sourceHash: contract.sourceHash, view: active.checkpoint() };
          write("pending-win", pending); emit("pending-win", active.missionOutcome);
        }
        if (active.simulation.snapshot.tick === tick && !active.missionDiagnostic && !active.missionOutcome?.ready) {
          diagnostic = "Public update did not advance simulation"; break;
        }
      }
      const steppingMs = Math.round(performance.now() - stepStart);
      phase("finalize");
      const final = observe();
      const ready: Saved06 = { sourceHash: contract.sourceHash, view: active.checkpoint() };
      write("checkpoint", ready);
      write("campaign-journal", active.campaignJournal);
      diagnostic ??= active.missionDiagnostic;
      const outcome = active.missionOutcome;
      result = { ...final.summary, status: status06(outcome, diagnostic, false), diagnostic, steppingMs, startTick,
        sourceHash: contract.sourceHash, checkpointHash: hash06(JSON.stringify(ready.view)) };
      write("play-result", result);
      if (outcome?.ready && outcome.resultCode === 0 && pending) {
        assert.ok(active.campaignJournal.some(entry => entry.fired.includes(faction === "human" ? 1 : 12)));
        if (faction === "alien") for (let slot = 0; slot < 5; slot++) assert.equal(final.campaign.world.buildingSlots[`2,${slot}`], 0);
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
    const after = runtimeHashes06(), changed = Object.keys(before).filter(path => before[path] !== after[path]);
    const changedAssets = Object.keys(fetched).filter(path => fetched[path] !== hash06(read(`public${path}`)));
    write("integrity", { before, after, changed, fetched, changedAssets });
    if (changed.length || changedAssets.length) { result.status = "RUNTIME_CHANGED"; result.changed = changed; result.changedAssets = changedAssets; }
    result.totalMs = Math.round(performance.now() - started);
    write("result", result); emit("result", result);
    console.log(JSON.stringify({ faction, output, ...result }));
    view?.dispose(); renderer.dispose(); globalThis.fetch = originalFetch;
  }
  return result;
}

async function supervise06(faction: Faction06, output: string, limits: ReturnType<typeof limits06>) {
  mkdirSync(output, { recursive: true });
  const child = fork(fileURLToPath(import.meta.url), ["--run", `--faction=${faction}`], {
    env: { ...process.env, DC_M06_WORKER: "1", DC_M06_OUTPUT: output, DC_M06_STEP_MS: String(limits.stepMs), DC_M06_MAX_TICKS: String(limits.maxTicks) },
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
  if (expired) writeFileSync(`${output}/deadline.json`, JSON.stringify({ status: "HARNESS_DEADLINE", phase }));
  return receipt;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = process.env.DC_M06_OUTPUT ?? `/tmp/dc-mission06-${Date.now()}`;
  const selected = process.argv.find(argument => argument.startsWith("--faction="))?.split("=")[1];
  assert.ok(selected === undefined || selected === "human" || selected === "alien");
  const factions: Faction06[] = selected ? [selected] : ["human", "alien"];
  const limits = limits06(Number(process.env.DC_M06_STEP_MS ?? 600000), Number(process.env.DC_M06_MAX_TICKS ?? 40000));
  for (const faction of factions) {
    if (!process.argv.includes("--run")) await preflight06(faction, output);
    else if (process.env.DC_M06_WORKER) {
      const result = await run06(faction, output, limits, process.env.DC_M06_RESUME, process.env.DC_M06_PROOF);
      if (result.status !== "WIN") process.exitCode = 1;
    } else {
      const receipt = await supervise06(faction, `${output}/${faction}`, limits);
      if (receipt.code !== 0) process.exitCode = 1;
    }
  }
}
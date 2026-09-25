import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, existsSync, openSync, closeSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadReleaseMission } from "./fixtures/release-mission";
import { MissionView } from "../../src/mission-view";
import { findPath } from "../../src/engine/pathfinding";
import { areHostile } from "../../src/engine/diplomacy";
import { sourceScenarioUpgradeLevels } from "../../src/engine/legacy-balance";
import type { GridPoint } from "../../src/engine/grid";
import { installSourceRender } from "./fixtures/source-render";
import { parseScenario } from "../extractors/data/scenario";
import { parseTriggerScript } from "../extractors/data/triggers";
import { tripCells06, isAir06, airFiringPoint06 } from "./mission06-playthrough";

export const cases = ["H14", "A14", "H13", "A13", "H15", "A15"] as const;
export type Case = typeof cases[number];
const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
export const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

export function contractFor(id: Case) {
  const faction: "human" | "alien" = id.startsWith("H") ? "human" : "alien";
  const number = Number(id.slice(1));
  const stem = `raw_cd/DC/SCENARIO/${faction.toUpperCase()}/${faction.toUpperCase()}${number}`;
  const sources = Object.fromEntries(["SCN", "TRO", "TXT", "MAP", "MTG", "PTH"].map(extension =>
    [extension, hash(read(`${stem}.${extension}`))]));
  const scenario = parseScenario(read(`${stem}.SCN`).toString("latin1"));
  const triggers = parseTriggerScript(read(`${stem}.TRO`).toString("latin1"));
  const text = read(`${stem}.TXT`).toString("latin1");
  const wins = triggers.filter(block => block.actions.some(action => action.name === "bail" && action.arguments[0] === 0));
  const losses = triggers.filter(block => block.actions.some(action => action.name === "bail" && action.arguments[0] === 1));
  assert.equal(wins.length, 1);
  const win = wins[0];
  const teams = number === 14 ? [] : number === 15 ? [1, 2, 4] : faction === "human" ? [1, 2, 3] : [2, 1];
  const slots = teams.flatMap(team => Array.from({ length: 5 }, (_, slot) => ({ team, slot })));
  assert.equal(win.condition, number === 14 ? "(S==0)" : `(${slots.map(({ team, slot }) => `(b(${team},${slot})==0)`).join("&&")})`);
  assert.equal(win.mode, number === 14 ? "trip" : "norm");
  const mtg = read(`${stem}.MTG`);
  const trips = Object.fromEntries(triggers.filter(block => block.mode === "trip").map(block =>
    [block.id, tripCells06(mtg.subarray(2), mtg[0], mtg[1], block.id)]));
  if (number === 14) assert.ok(trips[win.id].length);
  return { id, faction, number, sources, scenario, triggers, text, win, losses, slots, trips,
    tripParameters: { S: "entering team index", t: "entering source unit type index", chamberTypeRestriction: null },
    sourceHash: hash(JSON.stringify({ sources, scenario, triggers, text })) };
}

export function classify(outcome: MissionView["missionOutcome"], diagnostic: string | undefined, exact = false) {
  if (diagnostic) return "RUNTIME_BLOCKER";
  if (!outcome?.ready) return "PLAY_LIMIT";
  if (outcome.resultCode !== 0) return "SOURCE_LOSS";
  return exact ? "EXACT_READY_WIN" : "READY_WIN_UNVERIFIED";
}

export const budget = { playMs: 600000, restoreMs: 480000 };
function runtimeHashes() {
  const paths = readdirSync(new URL("src/", root), { recursive: true }).map(String).filter(path => path.endsWith(".ts"))
    .map(path => `src/${path}`).concat(["tools/qa/fixtures/source-render.ts", "tools/qa/mission06-playthrough.ts"]);
  return Object.fromEntries(paths.sort().map(path => [path, hash(read(path))]));
}

type Checkpoint = ReturnType<MissionView["checkpoint"]>;
interface Saved { sourceHash: string; view: Checkpoint }
const write = (directory: string, name: string, value: unknown) =>
  writeFileSync(`${directory}/${name}.json`, JSON.stringify(value));
const json = <Value>(directory: string, name: string): Value => JSON.parse(readFileSync(`${directory}/${name}.json`, "utf8"));

async function worker(id: Case, directory: string, allowance: number, proof: boolean, resume?: string) {
  mkdirSync(directory, { recursive: true });
  const started = performance.now(), before = runtimeHashes(), contract = contractFor(id);
  write(directory, "source", contract);
  write(directory, "integrity-before", before);
  const renderer = installSourceRender();
  renderer.setEnabled(false);
  const originalFetch = globalThis.fetch, fetched: Record<string, string> = {};
  let view: MissionView | undefined, commands = 0, shots = 0, deaths = 0;
  let result: Record<string, unknown> = { id, status: "RUNTIME_BLOCKER" };
  let phase = "loadCampaignMission";
  const emit = (kind: string, data: unknown) => appendFileSync(`${directory}/journal.jsonl`, JSON.stringify({
    kind, tick: view?.simulation.snapshot.tick ?? 0, elapsedMs: Math.round(performance.now() - started), data }) + "\n");
  const save = (name: string) => {
    const saved = { sourceHash: contract.sourceHash, view: view!.checkpoint() };
    write(directory, name, saved);
    return saved;
  };
  globalThis.fetch = async input => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    const bytes = read(`public${path}`);
    fetched[path] = hash(bytes);
    return new Response(bytes);
  };
  try {
    const policyView = proof ? json<Saved>(directory, "pending-win").view
      : resume ? (JSON.parse(readFileSync(resume, "utf8")) as Saved).view : undefined;
    const mission = await loadReleaseMission(contract.faction, contract.number, policyView);
    assert.equal(mission.scenario.source.sha256, contract.sources.SCN);
    assert.deepEqual(mission.triggers, contract.triggers);
    const originalScn = Buffer.from(mission.scenario.rawScenario!, "base64");
    assert.equal(hash(originalScn), contract.sources.SCN);
    assert.deepEqual(parseScenario(originalScn.toString("latin1")), contract.scenario);
    write(directory, "source-classes", { units: mission.units.filter(unit => contract.scenario.placementRows.some(row => row[2] === unit.index) ||
      contract.triggers.some(block => block.actions.some(action => action.name.startsWith("reinforce") && action.arguments.slice(3).includes(unit.index)))),
      fullGameGaps: contract.number === 15 ? ["Briefing requires ESGAARD/PORTALIS deployment and special attack; ordinary colony victory does not validate this action."] : [],
      profile: mission.runtimeProfile, nativeParity: false });
    const make = (checkpoint?: Checkpoint) => checkpoint
      ? MissionView.restore(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission, checkpoint)
      : new MissionView(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
    if (proof) {
      phase = "MissionView.restore(pending-win)";
      const pending = json<Saved>(directory, "pending-win"), ready = json<Saved>(directory, "checkpoint");
      assert.equal(pending.sourceHash, contract.sourceHash);
      assert.equal(ready.sourceHash, contract.sourceHash);
      view = make(JSON.parse(JSON.stringify(pending.view)));
      assert.deepEqual(view.checkpoint(), pending.view);
      await view.initialize();
      assert.equal(view.missionOutcome?.ready, false);
      assert.equal(view.missionOutcome?.resultCode, 0);
      phase = "pending-to-ready public update";
      view.resetClock(); view.update(0);
      const ticks = ready.view.simulation.tick - pending.view.simulation.tick;
      assert.ok(ticks > 0 && ticks <= 1000);
      for (let offset = 1; offset <= ticks; offset++) {
        assert.ok(performance.now() - started < allowance - 2000, "Aggregate restore allowance exhausted");
        view.update(offset * 50);
        assert.equal(view.missionDiagnostic, undefined);
      }
      assert.equal(view.missionOutcome?.ready, true);
      assert.equal(view.missionOutcome?.resultCode, 0);
      const actual = view.checkpoint();
      assert.deepEqual(actual, ready.view);
      write(directory, "restored-ready", { sourceHash: contract.sourceHash, view: actual });
      write(directory, "proof", { exact: true, fromTick: pending.view.simulation.tick, toTick: actual.simulation.tick,
        expectedHash: hash(JSON.stringify(ready.view)), actualHash: hash(JSON.stringify(actual)), restoreMs: performance.now() - started });
      result = { ...json<Record<string, unknown>>(directory, "result"), status: "EXACT_READY_WIN", exact: true };
    } else {
      phase = resume ? "MissionView.restore(progress)" : "MissionView constructor/initialize";
      const saved = resume ? JSON.parse(readFileSync(resume, "utf8")) as Saved : undefined;
      if (saved) assert.equal(saved.sourceHash, contract.sourceHash);
      view = make(saved?.view);
      if (saved) assert.deepEqual(view.checkpoint(), saved.view);
      await view.initialize();
      const active = view;
      const initial = active.campaignSnapshot!;
      const goals = initial.world.entities.filter(entity => entity.key.startsWith("colony:") && contract.slots.some(slot => slot.team === entity.team))
        .map(entity => ({ key: entity.key, x: entity.tileX, y: entity.tileY }));
      write(directory, "initial", { world: initial.world, bindings: active.nativeBindings, units: active.simulation.snapshot,
        resources: active.resourceSources, production: active.productionMenu, construction: active.constructionMenu, goals });
      const point = (actor: { cellX: number; cellY: number }) => ({ x: actor.cellX, y: actor.cellY });
      const distance = (left: GridPoint, right: GridPoint) => Math.hypot(left.x - right.x, left.y - right.y);
      const signatures = new Map<number, { value: string; tick: number }>();
      const order = (actorId: number, target: GridPoint, mode: "move" | "assault", purpose: string) => {
        assert.ok(active.isOwnedUnit(actorId));
        const tick = active.simulation.snapshot.tick, value = JSON.stringify([target, mode]);
        const prior = signatures.get(actorId);
        if (prior?.value === value && tick - prior.tick < 100) return;
        active.replaceSelection([actorId]);
        assert.deepEqual(active.selectedIds, [actorId]);
        active.setCameraCenter(target.x + 0.5, target.y + 0.5);
        active.setOrderMode(mode);
        const camera = active.cameraView, scale = 512 / camera.width;
        const clientX = (target.x + 0.5 - camera.x) * scale;
        const clientY = 226 - (target.y + 0.5 - camera.y - camera.height / 2) * scale;
        const cursor = active.cursorAt(clientX, clientY);
        if (cursor === "blocked") { emit("blocked-command", { actorId, target, purpose }); return; }
        if (mode === "assault") assert.ok(active.visibility[target.y * active.grid.width + target.x]);
        active.commandAt(clientX, clientY);
        signatures.set(actorId, { value, tick }); commands++;
        emit("command", { actorId, target, mode, purpose, cursor });
      };
      const observe = () => {
        const snapshot = active.simulation.snapshot, campaign = active.campaignSnapshot!;
        const bindings = new Map(active.nativeBindings.map(binding => [binding.key, binding.simulationId]));
        const types = new Map(campaign.world.entities.map(entity => [bindings.get(entity.key), entity.unitType]));
        const owned = snapshot.units.filter(actor => active.isOwnedUnit(actor.id) && actor.health > 0 && actor.activity !== "die");
        const enemies = [...snapshot.units, ...snapshot.staticTargets].filter(actor => actor.health > 0 && actor.team !== undefined &&
          actor.team >= 0 && actor.team < 8 && active.visibility[actor.cellY * active.grid.width + actor.cellX] &&
          areHostile({ faction: contract.faction, team: 0 }, actor, snapshot.teamAlliances));
        const summary = { id, tick: snapshot.tick, outcome: active.missionOutcome, diagnostic: active.missionDiagnostic,
          credits: active.resourceWorkflow.credits[0], earned: active.browserEconomyState?.earned[0], commands, shots, deaths,
          slots: Object.fromEntries(contract.slots.map(({ team, slot }) => [`${team},${slot}`, campaign.world.buildingSlots[`${team},${slot}`]])),
          owned: owned.map(actor => ({ id: actor.id, type: types.get(actor.id), hp: actor.health, ...point(actor), activity: actor.activity })),
          enemies: enemies.map(actor => ({ id: actor.id, type: types.get(actor.id), hp: actor.health, ...point(actor) })),
          production: active.productionMenu, construction: active.constructionMenu };
        write(directory, "latest", summary);
        return { snapshot, campaign, types, owned, enemies, summary };
      };
      const plan = () => {
        const state = observe();
        const blocked = new Set(active.simulation.staticObstacleCells.map(cell => active.grid.index(cell.x, cell.y)));
        const move = (actor: typeof state.owned[number], destination: GridPoint, air: boolean, purpose: string) => {
          if (distance(point(actor), destination) < 0.5) return;
          if (air) { order(actor.id, destination, "move", purpose); return; }
          const route = findPath(active.grid, point(actor), destination, { blocked });
          if (route?.length) order(actor.id, route[Math.min(12, route.length - 1)], "move", purpose);
          else emit("route-blocked", { actorId: actor.id, from: point(actor), destination, purpose });
        };
        const collectors = state.owned.filter(actor => [6, 14].includes(state.types.get(actor.id)!));
        for (const actor of collectors) {
          if (active.browserEconomyState?.orders.some(entry => entry.simulationId === actor.id)) continue;
          const resource = active.resourceSources.filter(resource => resource.status === 1 && (resource.remaining ?? 0) > 0 && (resource.rate ?? 0) > 0 &&
            active.visibility[(resource.position.y >> 8) * active.grid.width + (resource.position.x >> 8)])
            .sort((left, right) => distance(point(actor), { x: left.position.x >> 8, y: left.position.y >> 8 }) -
              distance(point(actor), { x: right.position.x >> 8, y: right.position.y >> 8 }))[0];
          if (resource) {
            active.replaceSelection([actor.id]);
            emit("harvest", { actorId: actor.id, slot: resource.slot, accepted: active.harvestSelected(resource.slot) });
          }
        }
        if (contract.number !== 14) {
          const construction = active.constructionMenu.find(choice => "slot" in choice && choice.slot === 2 && choice.requestEnabled);
          if (construction && state.summary.credits >= 2500) emit("construction", { dependency: construction.dependency,
            accepted: active.purchaseConstruction(construction.dependency) });
          const wanted = collectors.length ? contract.faction === "human" ? 0 : 8 : contract.faction === "human" ? 6 : 14;
          const production = active.productionMenu.find(choice => choice.unitType === wanted && choice.enabled && !choice.pending && !choice.queued && choice.cost <= state.summary.credits);
          if (production && state.owned.length < 24) emit("production", { dependency: production.dependency, cost: production.cost,
            accepted: active.purchaseProduction(production.dependency) });
        }
        for (const actor of state.owned.filter(actor => !collectors.includes(actor))) {
          const type = state.types.get(actor.id)!, stat = mission.units.find(unit => unit.index === type)!;
          if (!stat || stat.movementSpeed <= 0) continue;
          const air = isAir06(stat), levels = sourceScenarioUpgradeLevels(mission.scenario.teams[0], type);
          const weapon = mission.weapons.find(weapon => weapon.id === stat.weapons[levels.weaponLevel]);
          const enemy = state.enemies.filter(enemy => {
            const target = mission.units.find(unit => unit.index === state.types.get(enemy.id));
            return weapon && weapon.rawPrefix !== undefined && target?.targetClass !== undefined &&
              (mission.damageMatrix?.[weapon.rawPrefix]?.[target.targetClass] ?? 0) > 0 && distance(point(actor), point(enemy)) < 12;
          }).sort((left, right) => distance(point(actor), point(left)) - distance(point(actor), point(right)))[0];
          if (enemy && weapon && (contract.number !== 14 || distance(point(actor), point(enemy)) < weapon.range)) {
            const range = Math.hypot(actor.xSubcells - enemy.xSubcells, actor.ySubcells - enemy.ySubcells) / 1024;
            if (range < weapon.range - 0.25) {
              if (actor.activity !== "attack" || actor.targetId !== enemy.id) order(actor.id, point(enemy), "assault", "visible-threat");
              continue;
            }
            if (air) { move(actor, airFiringPoint06(point(actor), point(enemy), weapon.range), true, "firing-position"); continue; }
            const candidates: { target: GridPoint; route: readonly GridPoint[] }[] = [];
            const radius = Math.ceil(weapon.range);
            for (let offsetY = -radius; offsetY <= radius; offsetY++) for (let offsetX = -radius; offsetX <= radius; offsetX++) {
              if (Math.hypot(offsetX, offsetY) > weapon.range - 0.75) continue;
              const target = { x: enemy.cellX + offsetX, y: enemy.cellY + offsetY };
              if (state.owned.some(other => other.id !== actor.id && distance(point(other), target) < 1)) continue;
              const route = findPath(active.grid, point(actor), target, { blocked });
              if (route?.length) candidates.push({ target, route });
            }
            candidates.sort((left, right) => left.route.length - right.route.length);
            if (candidates[0]) order(actor.id, candidates[0].route[Math.min(7, candidates[0].route.length - 1)], "move", "firing-position");
            continue;
          }
          const destinations = contract.number === 14 ? contract.trips[3] : goals.filter(goal => state.campaign.world.entities.some(entity => entity.key === goal.key && entity.health > 0))
            .flatMap(goal => Array.from({ length: 8 }, (_, index) => ({ x: goal.x + (index % 3 - 1) * 5, y: goal.y + (Math.floor(index / 3) - 1) * 5 })));
          const routes = [...destinations].sort((left, right) => distance(point(actor), left) - distance(point(actor), right));
          const destination = routes.find(target => air || findPath(active.grid, point(actor), target, { blocked })?.length);
          if (destination) move(actor, destination, air, contract.number === 14 ? "source-chamber-trip3" : "source-colony-scout");
          else emit("goal-route-blocked", { actorId: actor.id, from: point(actor), destinations: routes.length });
        }
      };
      phase = "public play";
      let clock = 0, pending = false, stalled: string | undefined;
      active.resetClock(); active.update(0);
      save("checkpoint");
      const startTick = active.simulation.snapshot.tick;
      while (performance.now() - started < allowance - 7000 && active.simulation.snapshot.tick - startTick < 40000) {
        if (active.missionDiagnostic || active.missionOutcome?.ready) break;
        const tick = active.simulation.snapshot.tick;
        if (!pending && (tick - startTick) % 50 === 0) plan();
        active.update(clock += 50);
        shots += active.simulation.combatEvents.length; deaths += active.simulation.deathEvents.length;
        if (active.simulation.deathEvents.length) emit("deaths", active.simulation.deathEvents);
        if (active.missionOutcome?.resultCode === 0 && !active.missionOutcome.ready && !pending) {
          save("pending-win"); pending = true; emit("pending-win", active.missionOutcome);
        }
        if (active.simulation.snapshot.tick % 100 === 0) { save("checkpoint"); emit("progress", observe().summary); }
        if (active.simulation.snapshot.tick === tick && !active.missionDiagnostic && !active.missionOutcome?.ready) {
          stalled = "MissionView.update did not advance simulation"; break;
        }
      }
      phase = "save progress";
      const summary = observe().summary;
      save("checkpoint"); write(directory, "campaign-journal", active.campaignJournal);
      const diagnostic = active.missionDiagnostic ?? stalled;
      result = { ...summary, status: classify(active.missionOutcome, diagnostic), diagnostic, pending,
        sourceHash: contract.sourceHash, startTick, exact: false,
        blockedPath: diagnostic ? "MissionView.update / committed campaign frame" : !active.missionOutcome?.ready ? "Public planner exhausted assigned wall-clock budget before source goal" : null };
      if (active.missionOutcome?.ready && active.missionOutcome.resultCode === 0) {
        assert.ok(active.campaignJournal.some(entry => entry.fired.includes(contract.win.id)));
        if (contract.number !== 14) assert.ok(Object.values(summary.slots).every(value => value === 0));
      }
    }
  } catch (error) {
    result = { ...result, status: "RUNTIME_BLOCKER", blockedPath: phase,
      diagnostic: error instanceof Error ? error.stack : String(error), tick: view?.simulation.snapshot.tick ?? 0 };
    if (view && !proof) { try { save("checkpoint"); } catch (saveError) { result.saveError = String(saveError); } }
    emit("failure", result);
  } finally {
    const after = runtimeHashes(), changed = Object.keys(before).filter(path => before[path] !== after[path]);
    const changedAssets = Object.keys(fetched).filter(path => fetched[path] !== hash(read(`public${path}`)));
    const changedSources = Object.keys(contract.sources).filter(extension => contract.sources[extension] !== contractFor(id).sources[extension]);
    write(directory, proof ? "proof-integrity" : "integrity", { before, after, changed, changedAssets, changedSources, fetched });
    if (changed.length || changedAssets.length || changedSources.length) result.status = "RUNTIME_CHANGED";
    result.elapsedMs = Math.round(performance.now() - started);
    write(directory, proof ? "proof-result" : "result", result);
    emit(proof ? "proof-result" : "result", result);
    view?.dispose(); renderer.dispose(); globalThis.fetch = originalFetch;
  }
}

export function supervise(output: string) {
  const ignoreTerminalInterrupt = () => {};
  process.on("SIGINT", ignoreTerminalInterrupt);
  mkdirSync(output, { recursive: true });
  const before = runtimeHashes(), receipts: Record<string, unknown>[] = [];
  let playUsed = 0, restoreUsed = 0;
  const invoke = (id: Case, allowance: number, proof: boolean) => {
    const directory = `${output}/${id}`;
    mkdirSync(directory, { recursive: true });
    const descriptor = openSync(`${directory}/${proof ? "proof-worker" : "worker"}.log`, "wx");
    const started = performance.now();
    const run = spawnSync(process.execPath, ["--import", fileURLToPath(new URL("node_modules/tsx/dist/loader.mjs", root)),
      fileURLToPath(import.meta.url), "--worker", `--case=${id}`, `--output=${directory}`, `--allowance=${allowance}`, ...(proof ? ["--proof"] : [])],
    { cwd: fileURLToPath(root), stdio: ["ignore", descriptor, descriptor], timeout: allowance, killSignal: "SIGKILL" });
    closeSync(descriptor);
    const elapsedMs = Math.ceil(performance.now() - started);
    const receipt = { id, proof, allowance, elapsedMs, code: run.status, signal: run.signal, pid: run.pid, error: run.error?.message,
      reaped: true, checkpoint: existsSync(`${directory}/checkpoint.json`) };
    write(directory, proof ? "proof-exit" : "exit", receipt);
    receipts.push(receipt);
    write(output, "receipts", receipts);
    return elapsedMs;
  };
  for (const id of cases) {
    const allowance = Math.min(id.endsWith("14") ? 140000 : 45000, budget.playMs - playUsed - 1000);
    if (allowance <= 8000) break;
    playUsed += invoke(id, allowance, false);
  }
  for (const id of cases) {
    const directory = `${output}/${id}`;
    if (!existsSync(`${directory}/result.json`) || json<{ status: string }>(directory, "result").status !== "READY_WIN_UNVERIFIED") continue;
    const allowance = budget.restoreMs - restoreUsed - 1000;
    if (allowance <= 5000) break;
    restoreUsed += invoke(id, allowance, true);
  }
  const after = runtimeHashes();
  write(output, "summary", { playUsed, restoreUsed, budget, receipts,
    changedRuntime: Object.keys(before).filter(path => before[path] !== after[path]),
    missions: cases.map(id => { const directory = `${output}/${id}`;
      return { id, directory, result: existsSync(`${directory}/result.json`) ? json(directory, "result") : { status: "WORKER_LIMIT" },
          proof: existsSync(`${directory}/proof-result.json`) ? json(directory, "proof-result") : null }; }) });
        process.removeListener("SIGINT", ignoreTerminalInterrupt);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argument = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const output = argument("output") ?? `/tmp/dc-campaign-13-15-${Date.now()}`;
  if (process.argv.includes("--worker")) {
    const id = argument("case") as Case;
    assert.ok(cases.includes(id));
    const allowance = Number(argument("allowance"));
    assert.ok(allowance > 7000 && allowance <= budget.playMs);
    await worker(id, output, allowance, process.argv.includes("--proof"), argument("resume"));
  } else if (process.argv.includes("--run")) supervise(output);
}
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { parseTriggerScript } from "../extractors/data/triggers";
import { installSourceRender } from "./fixtures/source-render";
import { areHostile } from "../../src/engine/diplomacy";
import { findPath } from "../../src/engine/pathfinding";
import { NavigationGrid, type GridPoint } from "../../src/engine/grid";
import { calculateLegacyDamage, sourceScenarioUpgradeLevels } from "../../src/engine/legacy-balance";
import { mission03TripCells, mission03Status, sha256 } from "./mission03-playthrough";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
export type Faction05 = "human" | "alien";
export interface Mission05VisibleThreat extends GridPoint { id: number; range: number }

export function mission05VisibleRoutes(grid: NavigationGrid, start: GridPoint, goals: readonly GridPoint[],
  obstacles: ReadonlySet<number>, visibleThreats: readonly Mission05VisibleThreat[]) {
  const blocked = new Set(obstacles);
  for (const threat of visibleThreats) {
    const radius = threat.range + 2;
    const escapeRadius = Math.min(radius, Math.hypot(start.x - threat.x, start.y - threat.y));
    for (let cellY = Math.max(0, Math.floor(threat.y - radius)); cellY <= Math.min(grid.height - 1, Math.ceil(threat.y + radius)); cellY++) {
      for (let cellX = Math.max(0, Math.floor(threat.x - radius)); cellX <= Math.min(grid.width - 1, Math.ceil(threat.x + radius)); cellX++) {
        if (Math.hypot(cellX - threat.x, cellY - threat.y) < escapeRadius) blocked.add(grid.index(cellX, cellY));
      }
    }
  }
  const passages = [start, { x: start.x + 12, y: start.y }, { x: start.x, y: start.y - 10 },
    { x: start.x + 12, y: start.y - 10 }, { x: start.x + 24, y: start.y }];
  const routes: { goal: GridPoint; passage: GridPoint; route: readonly GridPoint[]; score: number }[] = [];
  for (const passage of passages) {
    const prefix = findPath(grid, start, passage, { blocked });
    if (!prefix) continue;
    for (const goal of goals) {
      const suffix = findPath(grid, passage, goal, { blocked });
      if (!suffix) continue;
      const route = [...prefix, ...suffix.slice(1)];
      const southExposure = route.filter(cell => cell.x < start.x + 12 && cell.y > start.y + 8).length;
      routes.push({ goal, passage, route, score: route.length + southExposure * 3 });
    }
  }
  routes.sort((left, right) => left.score - right.score || left.route.length - right.route.length);
  return { blocked, routes };
}

export function mission05RouteTarget(
  actor: { activity: string; cellX: number; cellY: number },
  route: readonly GridPoint[],
  occupied: readonly GridPoint[] = [],
  stalledTicks = 0,
) {
  if (actor.activity === "move" && stalledTicks < 40) return undefined;
  const target = route[Math.min(12, route.length - 1)];
  if (!target || (actor.cellX === target.x && actor.cellY === target.y)) return undefined;
  if (occupied.some(cell => cell.x === target.x && cell.y === target.y)) return undefined;
  return target;
}

export function mission05CheckpointDifferences(expected: unknown, actual: unknown, path = "view"): string[] {
  if (Object.is(expected, actual)) return [];
  if (!expected || !actual || typeof expected !== "object" || typeof actual !== "object") return [path];
  const before = expected as Record<string, unknown>, after = actual as Record<string, unknown>;
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(key =>
    Object.hasOwn(before, key) !== Object.hasOwn(after, key) ? [`${path}.${key}`] :
      mission05CheckpointDifferences(before[key], after[key], `${path}.${key}`)).slice(0, 40);
}

export function mission05HumanObjective(fired: ReadonlySet<number>) {
  if (fired.has(9) || fired.has(17)) return { trip: 15 } as const;
  if (fired.has(18)) return { trip: 17 } as const;
  return { team: fired.has(1) ? 1 : 2 } as const;
}

export function mission05HumanRetainMove(activity: string, stalledTicks: number, protectedOrder: boolean) {
  return activity === "move" && stalledTicks < 100 && protectedOrder;
}

export function mission05HumanTargets<Target extends { id: number }>(
  simulation: Pick<MissionView["simulation"], "canAutoTarget">, attackerId: number, visibleEnemies: readonly Target[],
) {
  return visibleEnemies.filter(enemy => simulation.canAutoTarget(attackerId, enemy.id));
}

export function mission05HumanStage(stage: "assemble" | "flank" | "assault", assembled: number, flanked: number, expeditionSize = 12, continuingAssault = false) {
  if (continuingAssault && expeditionSize > 0) return "assault";
  if (expeditionSize < 8) return stage;
  if (stage === "assemble" && assembled >= Math.min(10, expeditionSize)) return "flank";
  if (stage === "flank" && flanked >= Math.min(8, expeditionSize)) return "assault";
  return stage;
}

export interface Mission05HumanPartition { base: number[]; collectors: number[]; raid: number[] }

export function mission05HumanInRange(actor: GridPoint, target: GridPoint, range: number) {
  return Math.abs(actor.x - target.x) + Math.abs(actor.y - target.y) <= range - 0.25;
}

export function mission05HumanCanReinforce(earned: number, initialEarned: number, spent: number, credits: number, cost: number, initialCredits = 0) {
  return initialCredits + earned - initialEarned - spent >= cost && credits >= cost;
}

export function mission05HumanFinalReplay(finalRetry: boolean, readyWin: boolean) {
  return readyWin || !finalRetry;
}

export function mission05HumanPartition(
  previous: Mission05HumanPartition,
  infantry: readonly { id: number; health: number; maxHealth: number; cellX: number; cellY: number }[],
  home: GridPoint,
  visibleBaseThreats?: number,
): Mission05HumanPartition {
  const living = infantry.filter(actor => actor.health > 0);
  const continuing = visibleBaseThreats !== undefined;
  const baseCount = continuing ? Math.min(8, Math.max(4, visibleBaseThreats * 2 + 2)) : 8;
  const available = new Map(living.map(actor => [actor.id, actor]));
  const assigned = new Set<number>();
  const retain = (ids: readonly number[]) => ids.filter(id => {
    if (!available.has(id) || assigned.has(id)) return false;
    assigned.add(id); return true;
  });
  const result = { base: retain(previous.base.slice(0, baseCount)), collectors: retain(previous.collectors), raid: retain(previous.raid) };
  const healthy = living.filter(actor => actor.health >= actor.maxHealth * 0.65).sort((left, right) =>
    Math.hypot(left.cellX - home.x, left.cellY - home.y) - Math.hypot(right.cellX - home.x, right.cellY - home.y) || left.id - right.id);
  if (continuing) for (const actor of healthy) {
    if (result.base.length >= baseCount) break;
    if (!result.raid.includes(actor.id) || Math.hypot(actor.cellX - home.x, actor.cellY - home.y) > 15) continue;
    result.raid.splice(result.raid.indexOf(actor.id), 1); result.base.push(actor.id);
  }
  for (const [role, count] of [["base", baseCount], ["collectors", 2], ["raid", continuing ? living.length : 12]] as const) {
    for (const actor of healthy) {
      if (result[role].length >= count) break;
      if (assigned.has(actor.id)) continue;
      result[role].push(actor.id); assigned.add(actor.id);
    }
  }
  if (continuing) for (const actor of living) {
    if (!assigned.has(actor.id) && actor.health >= actor.maxHealth * 0.25) {
      result.raid.push(actor.id); assigned.add(actor.id);
    }
  }
  return result;
}

export function mission05HumanApproach(grid: NavigationGrid, start: GridPoint, goal: GridPoint, blocked: ReadonlySet<number>) {
  const candidates = Array.from({ length: 169 }, (_, index) => ({ x: goal.x + index % 13 - 6,
    y: goal.y + Math.floor(index / 13) - 6 })).sort((left, right) =>
    Math.hypot(left.x - goal.x, left.y - goal.y) - Math.hypot(right.x - goal.x, right.y - goal.y));
  for (const candidate of candidates) {
    const route = findPath(grid, start, candidate, { blocked });
    if (route?.length) return { assembly: route[Math.max(0, route.length - 28)], flank: route[Math.max(0, route.length - 16)] };
  }
  return undefined;
}

export function mission05Limits(stepMs = 600000, maxTicks = 40000) {
  assert.ok(Number.isSafeInteger(stepMs) && stepMs > 0 && stepMs <= 600000);
  assert.ok(Number.isSafeInteger(maxTicks) && maxTicks > 0 && maxTicks <= 60000);
  return { stepMs, maxTicks, restoreMs: 900000, totalMs: 1140000 };
}

export function mission05HumanContinuationBudget(elapsedMs: number, stepMs = 600000, totalMs = 1080000) {
  return Math.max(0, Math.min(stepMs, totalMs - elapsedMs - 30000));
}

export function mission05HumanProofReserve(initialRestoreMs: number, startTick: number, currentTick: number) {
  return Math.ceil(initialRestoreMs * Math.max(1, currentTick / Math.max(1, startTick)) * 1.2 + 30000);
}

export function inspectMission05(mission: MissionView["mission"]) {
  const faction = mission.faction;
  assert.equal(mission.scenario.id.toUpperCase(), `${faction.toUpperCase()}05`);
  assert.equal(mission.runtimeProfile, "browser-adapted");
  assert.equal(mission.sourceNativeCombat, undefined);
  const stem = `raw_cd/DC/SCENARIO/${faction.toUpperCase()}/${faction.toUpperCase()}05`;
  const sources = Object.fromEntries(["SCN", "TRO", "MAP", "MTG", "PTH"].map(extension => [extension, sha256(read(`${stem}.${extension}`))]));
  assert.equal(mission.scenario.source.sha256, sources.SCN);
  assert.deepEqual(mission.triggers, parseTriggerScript(read(`${stem}.TRO`).toString()));
  const win = mission.triggers.find(block => block.id === (faction === "human" ? 15 : 19))!;
  assert.ok(win.actions.some(action => action.name === "bail" && action.arguments[0] === 0));
  if (faction === "human") {
    assert.equal(win.mode, "trip");
    assert.equal(win.condition, "(S==0)");
    const betrayal = mission.triggers.find(block => block.id === 1)!;
    assert.ok(betrayal.condition.includes("b(2,4)==0"));
    assert.ok(betrayal.actions.some(action => action.name === "ally" && JSON.stringify(action.arguments) === "[1,0,0]"));
    assert.ok(mission.triggers.find(block => block.id === 9)!.condition.includes("b(1,4)==0"));
  } else {
    const rescue = mission.triggers.find(block => block.id === 17)!;
    assert.equal(rescue.mode, "trip");
    assert.deepEqual(rescue.actions[0].arguments.slice(0, 5), [7, 85, 44, 72, 1]);
    const extraction = mission.triggers.find(block => block.id === 18)!;
    assert.deepEqual(extraction.actions.filter(action => action.name === "abduct").map(action => action.arguments), [[7, 0], [0, 0]]);
  }
  const mtg = read(`${stem}.MTG`);
  const tripCells = Object.fromEntries(mission.triggers.filter(block => block.mode === "trip")
    .map(block => [block.id, mission03TripCells(mtg.subarray(2), mtg[0], mtg[1], block.id)]));
  for (const id of faction === "human" ? [15, 17] : [17, 18]) assert.ok(tripCells[id].length > 0);
  return { faction, sources, sourceHash: sha256(JSON.stringify(mission)), briefing: mission.briefing?.plainText, win, tripCells };
}

function runtimeHashes() {
  const paths = readdirSync(new URL("src/", root), { recursive: true }).map(String).filter(path => path.endsWith(".ts"))
    .map(path => `src/${path}`).concat(["tools/qa/fixtures/source-render.ts", "tools/qa/mission03-playthrough.ts",
      "tools/qa/mission05-playthrough.ts", "tools/qa/mission05-playthrough.test.ts"]);
  return Object.fromEntries(paths.sort().map(path => [path, sha256(read(path))]));
}

const loadedRuntimeHashes = runtimeHashes();

export async function preflight05(faction: Faction05, output: string) {
  mkdirSync(output, { recursive: true });
  const renderer = installSourceRender(); renderer.setEnabled(false);
  const originalFetch = globalThis.fetch;
  let view: MissionView | undefined;
  globalThis.fetch = async input => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    return new Response(read(`public${path}`));
  };
  try {
    const mission = await loadCampaignMission(faction, 5, "browser-adapted");
    const contract = inspectMission05(mission);
    view = new MissionView(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
    await view.initialize();
    assert.equal(view.missionDiagnostic, undefined);
    const report = { contract, scenario: mission.scenario, world: view.campaignSnapshot!.world,
      bindings: view.nativeBindings, simulation: view.simulation.snapshot, menu: view.productionMenu,
      resources: view.resourceSources, checkpoint: view.checkpoint(), runtimeHashes: runtimeHashes() };
    writeFileSync(`${output}/${faction}-preflight.json`, JSON.stringify(report));
    console.log(JSON.stringify({ faction, output, briefing: contract.briefing, units: report.simulation.units.length,
      tripCells: Object.fromEntries(Object.entries(contract.tripCells).map(([id, cells]) => [id, { count: cells.length, first: cells[0] }])) }));
    return contract;
  } finally { view?.dispose(); renderer.dispose(); globalThis.fetch = originalFetch; }
}

type Checkpoint05 = ReturnType<MissionView["checkpoint"]>;
interface Saved05 {
  sourceHash: string;
  view: Checkpoint05;
  steppingMs: number;
  fired: number[];
  commands: number;
  purchases: number;
  spent: number;
  shots: number;
  deaths: number;
  humanPartition?: Mission05HumanPartition;
  humanAssault?: { stage: "assemble" | "flank" | "assault"; team: number; goalKey: string };
}

export function assertMission05HealthyResume(saved: Pick<Saved05, "view">) {
  assert.ok(saved.view.state.diagnostic == null, "Diagnostic-bearing saves cannot resume progression");
}

export function authenticateMission05Resume(mission: MissionView["mission"], saved: Pick<Saved05, "sourceHash" | "view">) {
  const contract = inspectMission05(mission);
  assert.match(saved.sourceHash, /^[a-f0-9]{64}$/);
  const expected = JSON.parse(JSON.stringify(mission, (_key, value) =>
    value instanceof Uint8Array || value instanceof Uint16Array ? Array.from(value) : value));
  const identity = JSON.parse(saved.view.sourceIdentity);
  const previous = saved.view.session?.options;
  const omitted: string[] = [];
  for (const field of ["adaptedUnitProfiles", "adaptedUpgrades"]) {
    if (previous?.runtimeProfile === "browser-adapted" && previous.production &&
      !Object.hasOwn(previous.production, field) && expected.sourceProduction?.production &&
      !Object.hasOwn(identity.sourceProduction?.production ?? {}, field)) {
      if (Object.hasOwn(expected.sourceProduction.production, field)) omitted.push(field);
      delete expected.sourceProduction.production[field];
    }
  }
  assert.deepEqual(identity, expected, "Saved loaded mission must match the original current source and prior optional profile");
  return { currentSourceHash: contract.sourceHash, savedSourceHash: saved.sourceHash, sources: contract.sources, omitted };
}

export async function runMission05(faction: Faction05, output: string, limits = mission05Limits(), resume?: string, proofDirectory?: string, priorStepMs = 0) {
  assert.ok(Number.isFinite(priorStepMs) && priorStepMs >= 0 && priorStepMs < limits.stepMs);
  mkdirSync(output, { recursive: true });
  const started = performance.now(), beforeHashes = loadedRuntimeHashes;
  const renderer = installSourceRender(); renderer.setEnabled(false);
  const originalFetch = globalThis.fetch;
  const fetched: Record<string, string> = {};
  const resumeHash = resume ? sha256(readFileSync(resume)) : undefined;
  const continuingHuman = faction === "human" && process.env.DC_H05_CONTINUE === "1";
  const finalHumanRetry = continuingHuman || faction === "human" && process.env.DC_H05_FINAL_RETRY === "1";
  if (finalHumanRetry) assert.ok(resume && limits.stepMs <= (continuingHuman ? 600000 : 500000) && !proofDirectory);
  let view: MissionView | undefined;
  let result: Record<string, unknown> = { status: "RUNTIME_BLOCKER" };
  const write = (name: string, value: unknown) => writeFileSync(`${output}/${name}.json`, JSON.stringify(value));
  const emit = (kind: string, data: unknown) => appendFileSync(`${output}/journal.jsonl`, `${JSON.stringify({ kind,
    tick: view?.simulation.snapshot.tick ?? 0, elapsedMs: Math.round(performance.now() - started), data })}\n`);
  const phase = (name: string, remainingMs?: number) => { process.send?.({ phase: name, remainingMs }); emit("phase", { name, remainingMs }); };
  globalThis.fetch = async input => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    const bytes = read(`public${path}`); fetched[path] = sha256(bytes);
    return new Response(bytes);
  };
  try {
    const mission = await loadCampaignMission(faction, 5, "browser-adapted");
    const contract = inspectMission05(mission);
    write("source", { ...contract, limits, runtimeHashes: beforeHashes,
      limitation: "Original-script browser-adapted MissionView with QA NullCanvas. Not browser visuals, native parity, control-chain injection, or full-game proof." });
    const make = (checkpoint?: Checkpoint05) => checkpoint
      ? MissionView.restore(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission, checkpoint)
      : new MissionView(renderer.canvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
    const prove = async (pending: Saved05, ready: Saved05) => {
      phase("proof");
      const proofStarted = performance.now();
      authenticateMission05Resume(mission, pending);
      authenticateMission05Resume(mission, ready);
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
        assert.ok(performance.now() - proofStarted < limits.restoreMs);
        view.update(offset * 50);
        assert.equal(view.missionDiagnostic, undefined);
      }
      assert.equal(view.missionOutcome?.resultCode, 0);
      assert.equal(view.missionOutcome?.ready, true);
      const actual = view.checkpoint();
      assert.deepEqual(actual, ready.view);
      const evidence = { exactCheckpoint: true, sourceHash: contract.sourceHash, fromTick: pending.view.simulation.tick,
        toTick: ready.view.simulation.tick, expectedHash: sha256(JSON.stringify(ready.view)), actualHash: sha256(JSON.stringify(actual)),
        restoreMs: Math.round(performance.now() - proofStarted) };
      write("proof", evidence); emit("pending-to-ready-exact", evidence);
    };
    if (proofDirectory) {
      const pending: Saved05 = JSON.parse(readFileSync(`${proofDirectory}/pending-win.json`, "utf8"));
      const ready: Saved05 = JSON.parse(readFileSync(`${proofDirectory}/checkpoint.json`, "utf8"));
      await prove(pending, ready);
      result = { status: "WIN", exactCheckpoint: true, proofDirectory, sourceHash: contract.sourceHash, outcome: view!.missionOutcome };
    } else {
      const saved: Saved05 | undefined = resume ? JSON.parse(readFileSync(resume, "utf8")) : undefined;
      if (saved) assertMission05HealthyResume(saved);
      if (continuingHuman) assert.equal(saved?.view.session?.replayPolicy, "current-population-v1");
      const freshFallback = false;
      try {
        if (saved) write("resume-compatibility", authenticateMission05Resume(mission, saved));
        view = make(saved?.view);
        if (saved) {
          const restored = view.checkpoint();
          const differences = mission05CheckpointDifferences(saved.view, restored);
          write("initial-restore", { exact: differences.length === 0, differences, tick: restored.simulation.tick,
            expectedHash: sha256(JSON.stringify(saved.view)), actualHash: sha256(JSON.stringify(restored)) });
          assert.deepEqual(differences, [], "Current frozen checkpoint must restore exactly; no migration or cold restart");
        }
        await view.initialize();
        if (saved) {
          const initialized = view.checkpoint();
          const differences = mission05CheckpointDifferences(saved.view, initialized);
          write("initialized-restore", { exact: differences.length === 0, differences, tick: initialized.simulation.tick,
            expectedHash: sha256(JSON.stringify(saved.view)), actualHash: sha256(JSON.stringify(initialized)) });
          assert.deepEqual(differences, [], "Initialization must preserve the current frozen checkpoint");
        }
        assert.equal(view.missionDiagnostic, undefined);
      } catch (error) {
        if (!saved) throw error;
        const rejection = { resume, resumeHash, tick: saved.view.simulation.tick,
          status: "UNRECOVERABLE_WITHOUT_VALIDATED_MIGRATION", action: "stop-current-save-no-migration",
          diagnostic: error instanceof Error ? error.stack : String(error) };
        write("resume-rejected", rejection); emit("resume-rejected", rejection);
        throw error;
      }
      const active = view;
      const initial = active.campaignSnapshot!;
      const sourceGoals = initial.world.entities.filter(actor => actor.key.startsWith("colony:") && [1, 2].includes(actor.team))
        .map(actor => ({ key: actor.key, team: actor.team, x: actor.tileX, y: actor.tileY, type: actor.unitType }));
      write("initial", { sourceGoals, sourceHash: contract.sourceHash, scenario: mission.scenario, world: initial.world,
        units: active.simulation.snapshot, bindings: active.nativeBindings, resources: active.resourceSources, menu: active.productionMenu });
      const point = (actor: { cellX: number; cellY: number }) => ({ x: actor.cellX, y: actor.cellY });
      const distance = (left: GridPoint, right: GridPoint) => Math.hypot(left.x - right.x, left.y - right.y);
      const fired = new Set(saved?.fired ?? []);
      let commands = saved?.commands ?? 0, purchases = saved?.purchases ?? 0, spent = saved?.spent ?? 0;
      let shots = saved?.shots ?? 0, deaths = saved?.deaths ?? 0, clock = 0;
      let pending: Saved05 | undefined, lastProgress = "", diagnostic: string | undefined;
      let routePosition = "", routeProgressTick = saved?.view.simulation.tick ?? 0;
      let routeBlocked = false;
      let stalledTicks = 0;
      const savedCommander = faction === "alien" ? saved?.view.simulation.units.find(actor => actor.id === 52) : undefined;
      const savedDestination = savedCommander?.activity === "move" ? savedCommander.path.at(-1) : undefined;
      let savedQueueFinished = !savedDestination;
      let steppingMs = (saved?.steppingMs ?? 0) + priorStepMs;
      let humanPartition: Mission05HumanPartition = saved?.humanPartition ?? { base: [], collectors: [], raid: [] };
      const initialEarned = active.browserEconomyState?.earned[0] ?? 0, initialSpent = spent;
      const initialCredits = continuingHuman ? active.resourceWorkflow.credits[0] : 0;
      write("budget", { priorStepMs, savedStepMs: saved?.steppingMs ?? 0, stageLimitMs: limits.stepMs,
        totalLimitMs: limits.totalMs, initialCredits, continuingHuman, resume: resume ?? null });
      const save = (): Saved05 => ({ sourceHash: contract.sourceHash, view: active.checkpoint(), steppingMs,
        fired: [...fired], commands, purchases, spent, shots, deaths, ...(finalHumanRetry ? { humanPartition } : {}),
        ...(continuingHuman ? { humanAssault: { stage: humanStage, team: humanTeam, goalKey: humanGoalKey } } : {}) });
      const signatures = new Map<number, { value: string; tick: number }>();
      const humanPositions = new Map<number, { value: string; tick: number }>();
      let humanStop: string | undefined;
      let humanObjectiveTick = saved?.view.simulation.tick ?? 0;
      let humanObjectiveSignature = "";
      let humanStage: "assemble" | "flank" | "assault" = continuingHuman ? saved?.humanAssault?.stage ?? "assault" : "assemble";
      let humanTeam = continuingHuman ? saved?.humanAssault?.team ?? 1 : 2;
      let humanApproach: ReturnType<typeof mission05HumanApproach>;
      let humanGoalKey = continuingHuman ? saved?.humanAssault?.goalKey ?? "" : "";
      const order = (actorId: number, destination: GridPoint, mode: "move" | "assault", purpose: string) => {
        const tick = active.simulation.snapshot.tick, value = JSON.stringify({ destination, mode, purpose });
        const previous = signatures.get(actorId);
        if (previous?.value === value && tick - previous.tick < 150) return;
        active.replaceSelection([actorId]);
        assert.deepEqual(active.selectedIds, [actorId]);
        active.setCameraCenter(destination.x + 0.5, destination.y + 0.5);
        active.setOrderMode(mode);
        const camera = active.cameraView, bounds = active.canvas.getBoundingClientRect(), scale = 512 / camera.width;
        const clientX = bounds.left + (destination.x + 0.5 - camera.x) * scale * bounds.width / 512;
        const clientY = bounds.top + (226 - (destination.y + 0.5 - camera.y - camera.height / 2) * scale) * bounds.height / 452;
        const cursor = active.cursorAt(clientX, clientY);
        if (cursor === "blocked") { emit("blocked-command", { actorId, destination, mode, purpose }); return; }
        const visible = Boolean(active.visibility[destination.y * active.grid.width + destination.x]);
        if (purpose === "visible-threat") assert.ok(visible, "No direct targeting through fog");
        active.commandAt(clientX, clientY);
        signatures.set(actorId, { value, tick }); commands++;
        emit("command", { actorId, destination, mode, purpose, cursor, visible });
      };
      const observe = () => {
        const campaign = active.campaignSnapshot!, snapshot = active.simulation.snapshot;
        const bindingIds = new Map(active.nativeBindings.map(binding => [binding.key, binding.simulationId]));
        const types = new Map(campaign.world.entities.map(actor => [bindingIds.get(actor.key), actor.unitType]));
        const owned = snapshot.units.filter(actor => active.isOwnedUnit(actor.id) && actor.health > 0 && actor.activity !== "die");
        const enemies = [...snapshot.units, ...snapshot.staticTargets].filter(actor => actor.health > 0 &&
          actor.team !== undefined && actor.team >= 0 && actor.team < 8 &&
          active.visibility[actor.cellY * active.grid.width + actor.cellX] &&
          areHostile({ faction, team: 0 }, actor, snapshot.teamAlliances));
        for (const entry of active.campaignJournal) for (const id of entry.fired) if (!fired.has(id)) {
          fired.add(id); emit("source-trigger", entry); write(`trigger-${id}`, { entry, owned, world: campaign.world });
        }
        const summary = { tick: snapshot.tick, outcome: active.missionOutcome, diagnostic: active.missionDiagnostic,
          statistics: campaign.world.statistics,
          buildingSlots: campaign.world.buildingSlots, fired: [...fired], credits: active.resourceWorkflow.credits[0],
          earned: active.browserEconomyState?.earned[0], commands, purchases, spent, shots, deaths,
          ...(continuingHuman ? { assault: { stage: humanStage, team: humanTeam, goalKey: humanGoalKey }, humanPartition,
            sourceCities: campaign.world.entities.filter(actor => actor.key.startsWith("colony:") && actor.team === 1)
              .map(actor => ({ key: actor.key, type: actor.unitType, hp: actor.health, x: actor.tileX, y: actor.tileY })),
            remainingResources: active.browserEconomyState?.remaining } : {}),
          owned: owned.map(actor => ({ id: actor.id, type: types.get(actor.id), hp: actor.health, x: actor.cellX, y: actor.cellY,
            xSubcells: actor.xSubcells, ySubcells: actor.ySubcells, activity: actor.activity })),
          visibleEnemies: enemies.map(actor => ({ id: actor.id, type: types.get(actor.id), hp: actor.health, team: actor.team, x: actor.cellX, y: actor.cellY })) };
        write("latest", summary);
        const signature = JSON.stringify([summary.buildingSlots, summary.outcome, summary.owned.length, summary.fired]);
        if (signature !== lastProgress || snapshot.tick % 500 === 0) { emit("progress", summary); lastProgress = signature; }
        return { campaign, snapshot, types, owned, enemies, summary };
      };
      const plan = () => {
        const state = observe();
        const commander = state.owned.find(actor => [69, 70, 71, 72, 73, 74, 75, 76].includes(state.types.get(actor.id)!));
        const collectors = state.owned.filter(actor => [6, 14].includes(state.types.get(actor.id)!));
        const troops = state.owned.filter(actor => actor !== commander && !collectors.includes(actor));
        for (const collector of collectors) {
          const economy = active.browserEconomyState;
          const existing = economy?.orders.find(order => order.simulationId === collector.id);
          if (existing && (!finalHumanRetry || ((economy?.remaining[existing.nodeKey] ?? 0) > 0 &&
            (economy?.rates[existing.nodeKey] ?? 0) > 0))) continue;
          const resource = active.resourceSources.filter(source => source.status === 1 && (source.remaining ?? 0) > 0 &&
            (source.rate ?? 0) > 0 && active.visibility[(source.position.y >> 8) * active.grid.width + (source.position.x >> 8)])
            .sort((left, right) => distance(point(collector), { x: left.position.x >> 8, y: left.position.y >> 8 }) -
              distance(point(collector), { x: right.position.x >> 8, y: right.position.y >> 8 }))[0];
          if (resource) {
            active.replaceSelection([collector.id]);
            const accepted = active.harvestSelected(resource.slot);
            emit("harvest", { actorId: collector.id, slot: resource.slot, visible: true, accepted }); commands++;
          }
        }
        const dependency = collectors.length ? faction === "human" ? 9 : 23 : faction === "human" ? 7 : 21;
        const choice = active.productionMenu.find(choice => choice.dependency === dependency);
        if (troops.length < (faction === "human" ? continuingHuman ? 40 : 28 : 20) && choice?.enabled && !choice.pending && !choice.queued && active.resourceWorkflow.credits[0] >= choice.cost &&
          (!finalHumanRetry || mission05HumanCanReinforce(active.browserEconomyState?.earned[0] ?? 0,
            initialEarned, spent - initialSpent, active.resourceWorkflow.credits[0], choice.cost, initialCredits))) {
          const before = active.resourceWorkflow.credits[0], accepted = active.purchaseProduction(dependency);
          emit("purchase", { dependency, before, cost: choice.cost, accepted });
          if (accepted) { purchases++; spent += choice.cost; }
        }
        const blocked = new Set(active.simulation.staticObstacleCells.map(cell => active.grid.index(cell.x, cell.y)));
        if (faction === "alien") for (const actor of state.snapshot.units) {
          if (actor.id === commander?.id || actor.health <= 0 || actor.movementPlane === "air") continue;
          if (!active.isOwnedUnit(actor.id) && !active.visibility[actor.cellY * active.grid.width + actor.cellX]) continue;
          const centerX = (actor.xSubcells - 512) / 1024, centerY = (actor.ySubcells - 512) / 1024;
          for (const cellX of [Math.floor(centerX), Math.ceil(centerX)]) for (const cellY of [Math.floor(centerY), Math.ceil(centerY)]) {
            if (active.grid.contains(cellX, cellY)) blocked.add(active.grid.index(cellX, cellY));
          }
        }
        for (const mine of state.enemies.filter(enemy => [45, 46].includes(state.types.get(enemy.id)!))) {
          for (let offsetY = -2; offsetY <= 2; offsetY++) for (let offsetX = -2; offsetX <= 2; offsetX++) {
            const cell = { x: mine.cellX + offsetX, y: mine.cellY + offsetY };
            if (cell.x >= 0 && cell.y >= 0 && cell.x < active.grid.width && cell.y < active.grid.height) {
              blocked.add(active.grid.index(cell.x, cell.y));
            }
          }
        }
        const advance = (actor: typeof state.owned[number], destination: GridPoint, purpose: string, peaceful = false) => {
          if (faction === "alien" && actor.activity === "move" && stalledTicks < 40) return;
          if (faction === "human") {
            const value = `${actor.xSubcells},${actor.ySubcells}`;
            const previous = humanPositions.get(actor.id);
            if (previous?.value !== value) humanPositions.set(actor.id, { value, tick: state.snapshot.tick });
            const stalled = state.snapshot.tick - (humanPositions.get(actor.id)?.tick ?? state.snapshot.tick);
            const protectedOrder = continuingHuman || (finalHumanRetry ? signatures.get(actor.id)?.value.includes(purpose) === true :
              !peaceful || signatures.get(actor.id)?.value.includes(purpose) === true);
            if (mission05HumanRetainMove(actor.activity, stalled, protectedOrder)) return;
          }
          const routeBlocked = new Set(blocked);
          if (peaceful) for (const enemy of state.enemies) {
            const currentDistance = distance(point(actor), point(enemy));
            for (let offsetY = -5; offsetY <= 5; offsetY++) for (let offsetX = -5; offsetX <= 5; offsetX++) {
              const radius = Math.hypot(offsetX, offsetY);
              if (radius > 5 || radius >= currentDistance) continue;
              const cell = { x: enemy.cellX + offsetX, y: enemy.cellY + offsetY };
              if (cell.x >= 0 && cell.y >= 0 && cell.x < active.grid.width && cell.y < active.grid.height) {
                routeBlocked.add(active.grid.index(cell.x, cell.y));
              }
            }
          }
          const stat = mission.units.find(stat => stat.index === state.types.get(actor.id))!;
          const levels = sourceScenarioUpgradeLevels(mission.scenario.teams[0], stat.index);
          const weapon = mission.weapons.find(weapon => weapon.id === stat.weapons[levels.weaponLevel]);
          const attackable = (enemy: typeof state.enemies[number]) => {
            const target = mission.units.find(stat => stat.index === state.types.get(enemy.id));
            return weapon && weapon.rawPrefix !== undefined && target && target.targetClass !== undefined &&
              (mission.damageMatrix?.[weapon.rawPrefix]?.[target.targetClass] ?? 0) > 0;
          };
          const targets = faction === "human" ? mission05HumanTargets(active.simulation, actor.id, state.enemies) : state.enemies;
          const nearby = !peaceful && targets.filter(enemy => distance(point(actor), point(enemy)) <= 9 && attackable(enemy))
            .sort((left, right) => (continuingHuman ? Number(right.id === actor.targetId) - Number(left.id === actor.targetId) : 0) ||
              distance(point(actor), point(left)) - distance(point(actor), point(right)))[0];
          if (nearby && weapon) {
            const inRange = faction === "human" ? mission05HumanInRange(
              { x: actor.xSubcells / 1024, y: actor.ySubcells / 1024 },
              { x: nearby.xSubcells / 1024, y: nearby.ySubcells / 1024 }, weapon.range) :
              Math.hypot(actor.xSubcells - nearby.xSubcells, actor.ySubcells - nearby.ySubcells) / 1024 <= weapon.range - 0.25;
            if (inRange) {
              if (actor.activity !== "attack" || actor.targetId !== nearby.id) order(actor.id, point(nearby), "assault", "visible-threat");
              return;
            }
            const candidates: { point: GridPoint; route: readonly GridPoint[] }[] = [];
            const radius = Math.ceil(weapon.range);
            for (let offsetY = -radius; offsetY <= radius; offsetY++) for (let offsetX = -radius; offsetX <= radius; offsetX++) {
              if ((faction === "human" ? Math.abs(offsetX) + Math.abs(offsetY) : Math.hypot(offsetX, offsetY)) > weapon.range - 0.75) continue;
              const target = { x: nearby.cellX + offsetX, y: nearby.cellY + offsetY };
              if (state.owned.some(other => other.id !== actor.id && distance(point(other), target) < 1)) continue;
              const route = findPath(active.grid, point(actor), target, { blocked });
              if (route?.length) candidates.push({ point: target, route });
            }
            candidates.sort((left, right) => left.route.length - right.route.length || left.point.y - right.point.y || left.point.x - right.point.x);
            const route = candidates[0]?.route;
            if (route) order(actor.id, route[Math.min(7, route.length - 1)], "move", "visible-firing-position");
            return;
          }
          if (distance(point(actor), destination) < 0.1) return;
          const candidates = purpose.includes("trip") ? [destination] : Array.from({ length: 81 }, (_, index) => ({
            x: destination.x + index % 9 - 4, y: destination.y + Math.floor(index / 9) - 4 }))
            .sort((left, right) => distance(left, destination) - distance(right, destination));
          for (const target of candidates) {
            const route = findPath(active.grid, point(actor), target, { blocked: routeBlocked });
            if (route?.length) {
              if (faction === "alien") {
                const occupied = state.owned.filter(other => other.id !== actor.id).map(point);
                for (let length = Math.min(13, route.length); length > 1; length--) {
                  const waypoint = mission05RouteTarget(actor, route.slice(0, length), occupied, stalledTicks);
                  if (!waypoint) continue;
                  const publicPath = findPath(active.grid, point(actor), waypoint, {
                    blocked: new Set(active.simulation.staticObstacleCells.map(cell => active.grid.index(cell.x, cell.y))),
                  });
                  if (!publicPath || publicPath.slice(1).some(cell => routeBlocked.has(active.grid.index(cell.x, cell.y)))) continue;
                  order(actor.id, waypoint, "move", purpose); return;
                }
              } else { order(actor.id, route[Math.min(peaceful ? 3 : 12, route.length - 1)], "move", purpose); return; }
            }
          }
          emit("route-blocked", { actorId: actor.id, destination, purpose });
        };
        const humanSafeAdvance = (actor: typeof state.owned[number], destination: GridPoint, purpose: string) => {
          const equipment = active.simulation.checkpoint();
          const movement = equipment.units.find(unit => unit.id === actor.id)!;
          const threats = state.enemies.flatMap(enemy => {
            const weapon = [...equipment.units, ...equipment.staticTargets].find(unit => unit.id === enemy.id)?.weapon;
            return weapon ? [{ id: enemy.id, ...point(enemy), range: weapon.rangeCells }] : [];
          });
          const goals = Array.from({ length: 81 }, (_, index) => ({ x: destination.x + index % 9 - 4,
            y: destination.y + Math.floor(index / 9) - 4 })).sort((left, right) => distance(left, destination) - distance(right, destination));
          const routing = mission05VisibleRoutes(active.grid, point(actor), goals.filter(cell => active.grid.isPassable(cell.x, cell.y) &&
            !blocked.has(active.grid.index(cell.x, cell.y))).slice(0, 9), blocked, threats);
          const position = `${actor.xSubcells},${actor.ySubcells}`;
          const previous = humanPositions.get(actor.id);
          if (previous?.value !== position) humanPositions.set(actor.id, { value: position, tick: state.snapshot.tick });
          const stalled = state.snapshot.tick - humanPositions.get(actor.id)!.tick;
          const unsafe = movement.path.slice(movement.pathIndex).some(cell => routing.blocked.has(active.grid.index(cell.x, cell.y)));
          if (mission05HumanRetainMove(actor.activity, stalled, !unsafe && signatures.get(actor.id)?.value.includes(purpose) === true)) return;
          if (distance(point(actor), destination) <= 4 && !routing.blocked.has(active.grid.index(actor.cellX, actor.cellY))) return;
          for (const candidate of routing.routes) {
            for (let length = Math.min(13, candidate.route.length); length > 1; length--) {
              const waypoint = candidate.route[length - 1];
              if (state.owned.some(other => other.id !== actor.id && distance(point(other), waypoint) < 1)) continue;
              const publicPath = findPath(active.grid, point(actor), waypoint, { blocked });
              if (!publicPath || publicPath.slice(1).some(cell => routing.blocked.has(active.grid.index(cell.x, cell.y)))) continue;
              order(actor.id, waypoint, "move", purpose); return;
            }
          }
          emit("human-safe-route-blocked", { actorId: actor.id, destination, purpose, threats });
        };
        const trip = (actor: typeof state.owned[number], id: number, peaceful = false) => {
          const candidates = [...contract.tripCells[id]].sort((left, right) => distance(point(actor), left) - distance(point(actor), right));
          const target = candidates.find(cell => findPath(active.grid, point(actor), cell, { blocked }));
          if (target) advance(actor, target, `source-trip${id}`, peaceful);
          else emit("trip-route-blocked", { actorId: actor.id, id });
        };
        if (faction === "alien") {
          if (!commander) return;
          const target = [17, 18].find(id => !fired.has(id));
          if (target !== undefined) {
            const position = `${commander.xSubcells},${commander.ySubcells},${target}`;
            if (position !== routePosition) { routePosition = position; routeProgressTick = state.snapshot.tick; }
            stalledTicks = state.snapshot.tick - routeProgressTick;
            if (state.snapshot.tick % 50 === 0) emit("route-state", { target, stalledTicks,
              commander: state.summary.owned.find(actor => actor.id === commander.id),
              movement: active.simulation.checkpoint().units.find(actor => actor.id === commander.id),
              visibleUnits: state.snapshot.units.filter(actor => active.isOwnedUnit(actor.id) ||
                active.visibility[actor.cellY * active.grid.width + actor.cellX]).map(actor => ({ id: actor.id, team: actor.team,
                  x: actor.cellX, y: actor.cellY, xSubcells: actor.xSubcells, ySubcells: actor.ySubcells })),
              visibleEnemies: state.summary.visibleEnemies });
            if (state.snapshot.tick - routeProgressTick >= 300) {
              routeBlocked = true;
              write("route-stall", { target, commander, movement: active.simulation.checkpoint().units.find(actor => actor.id === commander.id),
                visibleEnemies: state.summary.visibleEnemies, owned: state.summary.owned, tripCells: contract.tripCells[target],
                nextAction: "Inspect the queued next cell and issue a public lateral move around the visible obstruction" });
              return;
            }
            const movement = active.simulation.checkpoint().units.find(actor => actor.id === commander.id)!;
            if (!savedQueueFinished) {
              if (commander.activity === "move") return;
              assert.deepEqual(point(commander), savedDestination, "Finish the original queued destination before replanning");
              savedQueueFinished = true;
              emit("saved-queue-finished", { commander: state.summary.owned.find(actor => actor.id === commander.id), destination: savedDestination });
            }
            const visibleEquipment = active.simulation.checkpoint();
            const threats = state.enemies.flatMap(enemy => {
              const equipment = [...visibleEquipment.units, ...visibleEquipment.staticTargets].find(actor => actor.id === enemy.id);
              const range = [45, 46].includes(state.types.get(enemy.id)!) ? 1 : equipment?.weapon?.rangeCells;
              return range === undefined ? [] : [{ id: enemy.id, x: (enemy.xSubcells - 512) / 1024,
                y: (enemy.ySubcells - 512) / 1024, range }];
            });
            const routing = mission05VisibleRoutes(active.grid, point(commander), contract.tripCells[target], blocked, threats);
            const unsafeQueue = movement.path.slice(movement.pathIndex).some(cell => routing.blocked.has(active.grid.index(cell.x, cell.y)));
            if (commander.activity === "move" && stalledTicks < 40 && !unsafeQueue) return;
            const publicBlocked = new Set(active.simulation.staticObstacleCells.map(cell => active.grid.index(cell.x, cell.y)));
            let chosen: { goal: GridPoint; passage: GridPoint; waypoint: GridPoint; route: readonly GridPoint[]; publicPath: readonly GridPoint[] } | undefined;
            for (const candidate of routing.routes) {
              for (let length = Math.min(13, candidate.route.length); length > 1; length--) {
                const waypoint = mission05RouteTarget(commander, candidate.route.slice(0, length), [], 40);
                if (!waypoint) continue;
                const publicPath = findPath(active.grid, point(commander), waypoint, { blocked: publicBlocked });
                if (!publicPath || publicPath.slice(1).some(cell => routing.blocked.has(active.grid.index(cell.x, cell.y)))) continue;
                chosen = { goal: candidate.goal, passage: candidate.passage, waypoint, route: candidate.route, publicPath };
                break;
              }
              if (chosen) break;
            }
            emit("visible-route-decision", { target, threats, unsafeQueue, stalledTicks,
              options: routing.routes.map(candidate => ({ goal: candidate.goal, passage: candidate.passage,
                length: candidate.route.length, score: candidate.score })), chosen });
            if (chosen) order(commander.id, chosen.waypoint, "move", `source-trip${target}`);
            else {
              routeBlocked = true;
              write("route-stall", { target, commander, threats, tripCells: contract.tripCells[target],
                reason: "No complete route with a safe public waypoint under currently visible threats" });
            }
            for (const actor of troops) {
              if (distance(point(actor), point(commander)) <= 4) continue;
              advance(actor, { x: commander.cellX - 3, y: commander.cellY }, "escort-commander");
            }
          }
          return;
        }
        const humanObjective = mission05HumanObjective(fired);
        const objectiveSignature = JSON.stringify([humanObjective, state.campaign.world.buildingSlots, deaths,
          state.campaign.world.entities.filter(actor => actor.key.startsWith("colony:") && [1, 2].includes(actor.team))
            .map(actor => [actor.key, actor.health])]);
        if (objectiveSignature !== humanObjectiveSignature) {
          humanObjectiveSignature = objectiveSignature; humanObjectiveTick = state.snapshot.tick;
        }
        if (state.snapshot.tick - humanObjectiveTick >= 2500) {
          humanStop = "source-city-progress-stalled-inspect-army-route"; return;
        }
        const homeRow = mission.scenario.teams[0].coordinateRows[0], home = { x: homeRow[0], y: homeRow[1] };
        let expedition = troops;
        if (finalHumanRetry) {
          const previousPartition = JSON.stringify(humanPartition);
          humanPartition = mission05HumanPartition(humanPartition, troops.filter(actor => state.types.get(actor.id) === 0), home,
            continuingHuman ? state.enemies.filter(enemy => distance(point(enemy), home) <= 15 &&
              troops.some(actor => active.simulation.canAutoTarget(actor.id, enemy.id))).length : undefined);
          if (JSON.stringify(humanPartition) !== previousPartition) emit("human-partition", humanPartition);
          expedition = troops.filter(actor => humanPartition.raid.includes(actor.id));
          emit("human-visible-defense", { partition: humanPartition, owned: state.summary.owned,
            threats: state.summary.visibleEnemies.filter(enemy => distance(enemy, home) <= 20 ||
              collectors.some(actor => distance(enemy, point(actor)) <= 12)) });
          const equipment = active.simulation.checkpoint();
          const held = new Set<number>();
          const stop = (actorId: number, purpose: string) => {
            active.replaceSelection([actorId]); active.stopSelected(); commands++;
            signatures.set(actorId, { value: purpose, tick: state.snapshot.tick });
            emit("hold", { actorId, purpose, publicCommand: "stop" }); held.add(actorId);
          };
          const guard = (actor: typeof troops[number], center: GridPoint, post: GridPoint, purpose: string) => {
            const weapon = equipment.units.find(unit => unit.id === actor.id)?.weapon;
            if (!weapon) return;
            const threats = mission05HumanTargets(active.simulation, actor.id, state.enemies).filter(enemy =>
              distance(point(enemy), center) <= 12).sort((left, right) => distance(point(actor), point(left)) - distance(point(actor), point(right)));
            const nearby = threats[0];
            if (nearby && mission05HumanInRange({ x: actor.xSubcells / 1024, y: actor.ySubcells / 1024 },
              { x: nearby.xSubcells / 1024, y: nearby.ySubcells / 1024 }, weapon.rangeCells)) {
              if (actor.activity !== "attack" && signatures.get(actor.id)?.value !== purpose) stop(actor.id, purpose);
              return;
            }
            if (!nearby && distance(point(actor), post) <= 1) {
              if (actor.activity !== "idle" || signatures.get(actor.id)?.value !== purpose) stop(actor.id, purpose);
              return;
            }
            const destination = nearby ? point(nearby) : post;
            const candidates = Array.from({ length: 81 }, (_, index) => ({ x: destination.x + index % 9 - 4,
              y: destination.y + Math.floor(index / 9) - 4 })).filter(cell => distance(cell, center) <= 12 &&
                (!nearby || mission05HumanInRange({ x: cell.x + 0.5, y: cell.y + 0.5 },
                  { x: nearby.xSubcells / 1024, y: nearby.ySubcells / 1024 }, weapon.rangeCells)) &&
                !state.owned.some(other => other.id !== actor.id && distance(point(other), cell) < 1))
              .sort((left, right) => nearby ? distance(point(actor), left) - distance(point(actor), right) : distance(left, post) - distance(right, post));
            for (const candidate of candidates) {
              const route = findPath(active.grid, point(actor), candidate, { blocked });
              if (!route?.length) continue;
              const position = `${actor.xSubcells},${actor.ySubcells}`;
              const previous = humanPositions.get(actor.id);
              if (previous?.value !== position) humanPositions.set(actor.id, { value: position, tick: state.snapshot.tick });
              if (actor.activity === "move" && signatures.get(actor.id)?.value.includes(purpose) &&
                state.snapshot.tick - humanPositions.get(actor.id)!.tick < 60) return;
              order(actor.id, route[Math.min(10, route.length - 1)], "move", `${purpose}-position`); return;
            }
            if (actor.activity === "move" && !held.has(actor.id)) stop(actor.id, purpose);
          };
          const baseCenter = { x: 100, y: 7 };
          const posts = continuingHuman ? [{ x: 96, y: 5 }, { x: 103, y: 5 }, { x: 97, y: 10 }, { x: 104, y: 9 },
            { x: 98, y: 5 }, { x: 100, y: 5 }, { x: 99, y: 10 }, { x: 102, y: 10 }] :
            [{ x: 96, y: 5 }, { x: 98, y: 5 }, { x: 100, y: 5 }, { x: 103, y: 5 },
              { x: 97, y: 10 }, { x: 99, y: 10 }, { x: 102, y: 10 }, { x: 104, y: 9 }];
          humanPartition.base.forEach((id, index) => guard(troops.find(actor => actor.id === id)!, baseCenter, posts[index], "base-guard"));
          humanPartition.collectors.forEach((id, index) => {
            const collector = collectors[index % Math.max(1, collectors.length)];
            const center = collector ? point(collector) : home;
            guard(troops.find(actor => actor.id === id)!, center, { x: center.x + (index ? 2 : -2), y: center.y - 1 }, "collector-guard");
          });
          for (const actor of troops.filter(actor => ![...humanPartition.base, ...humanPartition.collectors, ...humanPartition.raid].includes(actor.id))) {
            guard(actor, home, { x: home.x - 1, y: home.y - 1 }, "reserve-guard");
          }
        }
        if ("trip" in humanObjective) {
          const actor = commander ?? expedition[0];
          if (actor) trip(actor, humanObjective.trip!, true);
          for (const escort of expedition.filter(troop => troop !== actor)) if (actor) advance(escort, point(actor), "exit-escort");
          return;
        }
        const targetTeam = humanObjective.team;
        if (targetTeam !== humanTeam) { humanTeam = targetTeam!; humanStage = continuingHuman ? "assault" : "assemble"; humanApproach = undefined; }
        let goal = sourceGoals.find(goal => goal.team === targetTeam && goal.type !== 81 &&
          state.campaign.world.entities.some(actor => actor.key === goal.key && actor.health > 0)) ?? sourceGoals.find(goal => goal.team === targetTeam)!;
        if (finalHumanRetry && expedition.length) {
          const remaining = sourceGoals.filter(goal => goal.team === targetTeam && goal.type !== 81 &&
            state.campaign.world.entities.some(actor => actor.key === goal.key && actor.health > 0));
          if (!remaining.some(goal => goal.key === humanGoalKey)) {
            const start = point(expedition[0]);
            const ranked = remaining.flatMap(candidate => {
              const approaches = Array.from({ length: 49 }, (_, index) => ({ x: candidate.x + index % 7 - 3,
                y: candidate.y + Math.floor(index / 7) - 3 })).filter(cell => mission05HumanInRange(cell, candidate, 4))
                .flatMap(cell => { const route = findPath(active.grid, start, cell, { blocked }); return route ? [route] : []; });
              const length = Math.min(...approaches.map(route => route.length));
              return Number.isFinite(length) ? [{ candidate, length }] : [];
            }).sort((left, right) => left.length - right.length || left.candidate.key.localeCompare(right.candidate.key));
            if (!ranked.length) { humanStop = "no-accessible-remaining-source-city"; return; }
            goal = ranked[0].candidate; humanGoalKey = goal.key; humanApproach = undefined;
            if (!continuingHuman) humanStage = "assemble";
            emit("human-city-goal", { chosen: goal, accessible: ranked });
          } else goal = remaining.find(goal => goal.key === humanGoalKey)!;
          const equipment = active.simulation.checkpoint(), infantry = equipment.units.find(actor => actor.id === expedition[0].id);
          const binding = active.nativeBindings.find(binding => binding.key === goal.key);
          const visible = state.enemies.find(actor => actor.id === binding?.simulationId);
          const city = visible && equipment.staticTargets.find(actor => actor.id === visible.id);
          if (infantry?.weapon?.sourceDamage && "callerFactor" in infantry.weapon.sourceDamage && city?.sourceDefense) emit("human-city-damage", { actorId: infantry.id,
            targetId: city.id, targetClass: city.sourceDefense.targetClass,
            damage: calculateLegacyDamage(infantry.weapon.damage, infantry.weapon.sourceDamage, city.sourceDefense) });
        }
        const threat = state.enemies.find(enemy => troops.some(actor => active.simulation.canAutoTarget(actor.id, enemy.id)) &&
          (distance(point(enemy), home) < 15 || collectors.some(actor => distance(point(enemy), point(actor)) < 9)));
        humanApproach ??= mission05HumanApproach(active.grid, finalHumanRetry && expedition.length ? point(expedition[0]) : home, goal, blocked);
        if (!humanApproach) { humanStop = "no-source-city-approach-path"; return; }
        const { assembly, flank } = humanApproach;
        const nextStage = mission05HumanStage(humanStage, expedition.filter(actor => distance(point(actor), assembly) <= 6).length,
          expedition.filter(actor => distance(point(actor), flank) <= 9).length, finalHumanRetry ? expedition.length : 12, continuingHuman);
        if (nextStage !== humanStage) { humanStage = nextStage; emit("human-assault-stage", { targetTeam, humanStage, assembly, flank }); }
        for (const actor of expedition) {
          if (threat && !finalHumanRetry) advance(actor, point(threat), "defend-player");
          else if (humanStage === "assault") advance(actor, goal, "source-city-scout");
          else if (humanStage === "flank") advance(actor, flank, `human-approach-${targetTeam}`);
          else humanSafeAdvance(actor, assembly, `human-assemble-${targetTeam}`);
        }
        if (commander) humanSafeAdvance(commander, home, "protect-commander-return");
      };
      const remainingMs = Math.min(limits.stepMs - priorStepMs, freshFallback ? 120000 : limits.stepMs,
        continuingHuman ? mission05HumanContinuationBudget(performance.now() - started, limits.stepMs, limits.totalMs) : limits.stepMs);
      const maxTicks = Math.min(limits.maxTicks, freshFallback ? 4000 : limits.maxTicks);
      assert.ok(remainingMs > 3000, "Per-mission aggregate stepping budget exhausted");
      phase("stepping", remainingMs);
      const stepStarted = performance.now(), priorSteppingMs = steppingMs, startTick = active.simulation.snapshot.tick;
      const initialRestoreMs = stepStarted - started;
      active.resetClock(); active.update(0);
      while (performance.now() - stepStarted < remainingMs - (finalHumanRetry ? 15000 : 3000) && active.simulation.snapshot.tick - startTick < maxTicks) {
        if (active.missionDiagnostic || active.missionOutcome?.ready || routeBlocked || humanStop) break;
        const tick = active.simulation.snapshot.tick;
        if (faction === "human" && !finalHumanRetry && saved && !pending && performance.now() - started +
          mission05HumanProofReserve(initialRestoreMs, startTick, tick) >= limits.totalMs) {
          humanStop = "save-with-reserved-exact-replay-budget"; break;
        }
        if (!pending && (tick - startTick) % (faction === "alien" ? 10 : 50) === 0) plan();
        active.update(clock += 50);
        shots += active.simulation.combatEvents.length; deaths += active.simulation.deathEvents.length;
        if (active.simulation.deathEvents.length) emit("deaths", active.simulation.deathEvents);
        steppingMs = priorSteppingMs + performance.now() - stepStarted;
        if (active.missionOutcome?.resultCode === 0 && !active.missionOutcome.ready && !pending) {
          observe(); pending = save(); write("pending-win", pending); emit("pending-win", active.missionOutcome);
        }
        if (!active.missionDiagnostic && active.simulation.snapshot.tick % (faction === "alien" ? 100 : 500) === 0) {
          observe(); write(`healthy-${active.simulation.snapshot.tick}`, save());
        }
        if (active.simulation.snapshot.tick === tick && !active.missionDiagnostic && !active.missionOutcome?.ready) {
          diagnostic = "Public update did not advance simulation"; break;
        }
      }
      steppingMs = priorSteppingMs + performance.now() - stepStarted;
      phase("finalize");
      const final = observe(), ready = save(); write("checkpoint", ready);
      diagnostic ??= active.missionDiagnostic;
      const outcome = active.missionOutcome;
      result = { ...final.summary, status: mission03Status(outcome, diagnostic, false), diagnostic, steppingMs,
        startTick, freshFallback, sourceHash: contract.sourceHash, checkpointHash: sha256(JSON.stringify(ready.view)),
        stage: faction === "alien" ? fired.has(18) ? "extraction-fired-awaiting-ready" : fired.has(17) ? "rescue-fired-route18" : "route17-unreached" : mission05HumanObjective(fired),
        stoppingReason: diagnostic ? "runtime-diagnostic" : outcome?.ready ? "source-outcome" : routeBlocked ? "queued-route-stalled" :
          humanStop ?? (faction === "human" ? "supervised-save-before-step-budget-exhaustion" : "harness-deadline-or-tick-cap") };
      write("play-result", result);
      if (outcome?.ready && outcome.resultCode === 0 && pending) {
        const required = faction === "human" ? finalHumanRetry ? [1, 18, 17, 15] : [1, 15] : [17, 18, 19];
        for (const id of required) assert.ok(fired.has(id), `Actual source trigger ${id} required`);
        if (faction === "human") for (const team of [1, 2]) for (let slot = 0; slot < 5; slot++) {
          assert.equal(final.campaign.world.buildingSlots[`${team},${slot}`], 0);
        }
        if (continuingHuman) {
          result.status = "SOURCE_WIN_PROOF_PENDING"; result.exactCheckpoint = false; result.currentRoundtripExact = false;
          write("proof-deferred", { pendingTick: pending.view.simulation.tick, readyTick: ready.view.simulation.tick,
            reason: "Separate authenticated proof required within its own 900s budget", proofLimitMs: limits.restoreMs });
        } else { await prove(pending, ready); result.status = "WIN"; result.exactCheckpoint = true; }
      } else if (continuingHuman && pending) {
        result.status = "SOURCE_WIN_PENDING"; result.exactCheckpoint = false; result.currentRoundtripExact = false;
        write("proof-deferred", { pendingTick: pending.view.simulation.tick, ready: false,
          reason: "Pending source WIN saved before total deadline; finish ready and prove separately", proofLimitMs: limits.restoreMs });
      } else if (!mission05HumanFinalReplay(finalHumanRetry, false)) {
        result.currentRoundtripExact = false;
        result.finalReplaySkipped = "Authenticated initial restore and saved actual non-WIN; no final replay claimed";
        write("nonwin-final-save", { tick: ready.view.simulation.tick, checkpointHash: result.checkpointHash,
          outcome, initialAuthenticated: true, finalReplayVerified: false });
      } else {
        phase("proof");
        active.dispose(); view = undefined;
        view = make(JSON.parse(JSON.stringify(ready.view)));
        const restored = view.checkpoint();
        const differences = mission05CheckpointDifferences(ready.view, restored);
        write("current-roundtrip", { exact: differences.length === 0, differences, initialized: false,
          tick: ready.view.simulation.tick, expectedHash: sha256(JSON.stringify(ready.view)), actualHash: sha256(JSON.stringify(restored)) });
        assert.deepEqual(restored, ready.view, "Current outcome checkpoint must restore exactly");
        await view.initialize();
        const initialized = view.checkpoint();
        assert.deepEqual(initialized, ready.view, "Current outcome checkpoint must initialize exactly");
        write("current-roundtrip", { exact: true, initialized: true, differences: [], tick: ready.view.simulation.tick,
          expectedHash: sha256(JSON.stringify(ready.view)), actualHash: sha256(JSON.stringify(initialized)), outcome: view.missionOutcome });
        result.currentRoundtripExact = true;
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
    const changedAssets = Object.keys(fetched).filter(path => fetched[path] !== sha256(read(`public${path}`)));
    const resumeAfterHash = resume ? sha256(readFileSync(resume)) : undefined;
    write("integrity", { before: beforeHashes, after: afterHashes, changed, fetched, changedAssets,
      resume, resumeHash, resumeAfterHash, resumeUnchanged: resumeHash === resumeAfterHash });
    result.revision = changed.length ? "historical-loaded-revision" : "filesystem-stable";
    result.changed = changed;
    if (changedAssets.length) { result.status = "RUNTIME_CHANGED"; result.changedAssets = changedAssets; }
    result.totalMs = Math.round(performance.now() - started);
    write("result", result); emit("result", result);
    console.log(JSON.stringify({ faction, output, ...result }));
    view?.dispose(); renderer.dispose(); globalThis.fetch = originalFetch;
  }
  return result;
}

async function supervise05(faction: Faction05, output: string, limits: ReturnType<typeof mission05Limits>) {
  mkdirSync(output, { recursive: true });
  const child = fork(fileURLToPath(import.meta.url), ["--run", `--faction=${faction}`], {
    env: { ...process.env, DC_M05_WORKER: "1", DC_M05_OUTPUT: output },
    detached: true, stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  let phase = "initialize", expired = false;
  let timer: ReturnType<typeof setTimeout>;
  const terminate = () => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} } };
  const started = Date.now();
  const totalTimer = setTimeout(() => { expired = true; terminate(); }, limits.totalMs);
  const arm = (next: string, remainingMs?: number) => {
    clearTimeout(timer); phase = next;
    const budgetMs = phase === "stepping" ? Math.min(limits.stepMs, remainingMs ?? limits.stepMs) : limits.restoreMs;
    appendFileSync(`${output}/supervisor.jsonl`, `${JSON.stringify({ phase, budgetMs, childPid: child.pid, at: Date.now() })}\n`);
    timer = setTimeout(() => { expired = true; terminate(); }, budgetMs);
  };
  arm("initialize");
  child.on("message", message => {
    if (message && typeof message === "object" && "phase" in message && ["stepping", "proof", "finalize"].includes(String(message.phase))) {
      arm(String(message.phase), "remainingMs" in message ? Number(message.remainingMs) : undefined);
    }
  });
  process.once("SIGTERM", terminate); process.once("SIGINT", terminate);
  const receipt = await new Promise<{ code: number | null; signal: string | null }>(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
  clearTimeout(timer!); clearTimeout(totalTimer); process.removeListener("SIGTERM", terminate); process.removeListener("SIGINT", terminate);
  writeFileSync(`${output}/exit.json`, JSON.stringify({ ...receipt, phase, expired, totalMs: Date.now() - started,
    totalLimitMs: limits.totalMs, childPid: child.pid, parentPid: process.pid, reaped: true }));
  if (expired) writeFileSync(`${output}/deadline.json`, JSON.stringify({ status: "HARNESS_DEADLINE", phase }));
  return receipt;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = process.env.DC_M05_OUTPUT ?? `/tmp/dc-mission05-${Date.now()}`;
  const selected = process.argv.find(argument => argument.startsWith("--faction="))?.split("=")[1];
  assert.ok(selected === undefined || selected === "human" || selected === "alien");
  const factions: Faction05[] = selected ? [selected] : ["human", "alien"];
  const limits = mission05Limits(Number(process.env.DC_M05_STEP_MS ?? 600000), Number(process.env.DC_M05_MAX_TICKS ?? 40000));
  if (process.env.DC_H05_CONTINUE === "1") {
    assert.equal(selected, "human");
    assert.ok(process.env.DC_M05_RESUME && !process.env.DC_M05_PROOF);
    limits.totalMs = 1080000;
  } else if (process.env.DC_H05_FINAL_RETRY === "1") {
    assert.equal(selected, "human");
    assert.ok(limits.stepMs <= 500000 && process.env.DC_M05_RESUME);
    limits.totalMs = limits.restoreMs * 2 + limits.stepMs + 30000;
  }
  for (const faction of factions) {
    if (!process.argv.includes("--run")) await preflight05(faction, output);
    else if (process.env.DC_M05_WORKER) {
      const result = await runMission05(faction, output, limits, process.env.DC_M05_RESUME, process.env.DC_M05_PROOF,
        Number(process.env.DC_M05_PRIOR_STEP_MS ?? 0));
      if (result.status !== "WIN") process.exitCode = 1;
    } else {
      const receipt = await supervise05(faction, `${output}/${faction}`, limits);
      if (receipt.code !== 0) process.exitCode = 1;
    }
  }
}
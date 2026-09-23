import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { cpus, platform, arch } from "node:os";
import { performance } from "node:perf_hooks";
import { NavigationGrid } from "../../src/engine/grid";
import { DeterministicSimulation, type SimulationSnapshot } from "../../src/engine/simulation";
import { MissionView } from "../../src/mission-view";
import type { CampaignMissionData } from "../../src/game-data";

const seed = 0xdc1997;
const root = new URL("../../public/assets/generated/", import.meta.url);
const args = new Set(process.argv.slice(2));
for (const arg of args) assert.ok(["--self-check", "--source=skip", "--mission-ticks=2400"].includes(arg), `Unknown option ${arg}`);
assert.equal(typeof globalThis.gc, "function", "Run node --expose-gc --import tsx tools/qa/battle-benchmark.ts");
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const emit = (value: unknown) => console.log(JSON.stringify(value));
function heap() {
  globalThis.gc!();
  return process.memoryUsage().heapUsed;
}
function distribution(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (fraction: number) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  return { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: sorted.at(-1)! };
}
function counters(simulation: DeterministicSimulation) {
  const saved = simulation.checkpoint();
  return { tick: saved.tick, commands: saved.commands.length, reservations: saved.movementReservations.length,
    reservationOwners: saved.movementReservations.reduce((sum, entry) => sum + entry.owners.length, 0),
    remainingPathPoints: saved.units.reduce((sum, unit) => sum + Math.max(0, unit.path.length - unit.pathIndex), 0),
    reservationEvents: saved.reservationEvents.length, damageDiagnostics: saved.sourceDamageDiagnostics.length };
}
function meter() {
  const latency: number[] = [], cpu: number[] = [];
  return {
    measure(update: () => void) {
      const cpuStart = process.cpuUsage(), start = performance.now();
      update();
      latency.push(performance.now() - start);
      const used = process.cpuUsage(cpuStart);
      cpu.push((used.user + used.system) / 1000);
    },
    finish() {
      const wallMs = distribution(latency), cpuMs = distribution(cpu);
      return { samples: latency.length, wallMs, cpuMs,
        wallOver20ms: latency.filter((value) => value > 20).length,
        wallOver50ms: latency.filter((value) => value > 50).length,
        practical20msP95Gate: wallMs.p95 <= 20 ? "PASS" : "FAIL",
        fixed20TPSP99Gate: wallMs.p99 <= 50 ? "PASS" : "FAIL" };
    },
  };
}
function engagement() {
  const positions = new Map<number, readonly [number, number]>();
  const moved = new Set<number>(), fired = new Set<number>();
  const movementByFaction = { human: 0, alien: 0 }, shotsByFaction = { human: 0, alien: 0 };
  const factions = new Map<number, "human" | "alien">();
  let movement = 0, shots = 0, damage = 0, deaths = 0, activeUpdates = 0;
  return {
    sample(snapshot: SimulationSnapshot, simulation: DeterministicSimulation) {
      let active = false;
      for (const unit of snapshot.units) {
        factions.set(unit.id, unit.faction);
        const prior = positions.get(unit.id);
        if (prior && (prior[0] !== unit.xSubcells || prior[1] !== unit.ySubcells)) {
          movement += 1; movementByFaction[unit.faction] += 1; moved.add(unit.id); active = true;
        }
        positions.set(unit.id, [unit.xSubcells, unit.ySubcells]);
      }
      for (const event of simulation.combatEvents) {
        shots += 1; damage += event.damage; fired.add(event.attackerId); active = true;
        shotsByFaction[factions.get(event.attackerId)!] += 1;
      }
      deaths += simulation.deathEvents.length;
      activeUpdates += Number(active);
    },
    result: () => ({ movement, shots, damage, deaths, movedUnits: moved.size, firedUnits: fired.size,
      movementByFaction, shotsByFaction, activeUpdates }),
  };
}
function synthetic(total: number, ticks: number) {
  const costs = new Uint16Array(128 * 64).fill(1);
  for (let arena = 0; arena < 256; arena += 1) costs[(Math.floor(arena / 16) * 4 + 1) * 128 + (arena % 16) * 8 + 3] = 0;
  const simulation = new DeterministicSimulation(new NavigationGrid(128, 64, costs), { seed });
  const pairs: { human: number; alien: number; x: number; y: number }[] = [];
  for (let pair = 0; pair < total / 2; pair += 1) {
    const x = (pair % 16) * 8, y = Math.floor(pair / 16) * 4;
    const options = { maxHealth: 1_000_000_000, speedSubcellsPerTick: 256,
      weapon: { damage: 1, rangeCells: 3, cooldownTicks: 5 } };
    const human = simulation.addUnit({ ...options, faction: "human", team: 0, cell: { x: x + 1, y: y + 1 } });
    const alien = simulation.addUnit({ ...options, faction: "alien", team: 1, cell: { x: x + 6, y: y + 1 } });
    pairs.push({ human, alien, x, y });
  }
  const measured = meter(), activity = engagement();
  activity.sample(simulation.snapshot, simulation);
  const samples: unknown[] = [{ tick: 0, heapBytes: heap(), counters: counters(simulation) }];
  const start = performance.now();
  let lastQuarterShots = 0;
  for (let tick = 0; tick < ticks; tick += 1) {
    measured.measure(() => {
      if (tick % 200 === 0) for (const pair of pairs) {
        const forward = Math.floor(tick / 200) % 2 === 0;
        simulation.queue({ type: "move", unitIds: [pair.human], target: { x: pair.x + (forward ? 4 : 1), y: pair.y + 1 } });
        simulation.queue({ type: "move", unitIds: [pair.alien], target: { x: pair.x + 6, y: pair.y + (forward ? 2 : 1) } });
      }
      if (tick % 200 === 60) for (const pair of pairs) {
        simulation.queue({ type: "attack", unitIds: [pair.human], targetId: pair.alien });
        simulation.queue({ type: "attack", unitIds: [pair.alien], targetId: pair.human });
      }
      simulation.advance();
      assert.equal(simulation.snapshot.tick, tick + 1);
      activity.sample(simulation.snapshot, simulation);
      if (tick >= ticks * 0.75) lastQuarterShots += simulation.combatEvents.length;
    });
    if (tick + 1 === ticks / 2) samples.push({ tick: tick + 1, heapBytes: heap(), counters: counters(simulation) });
  }
  const wallElapsedMs = performance.now() - start;
  const finalCounters = counters(simulation), events = activity.result();
  assert.equal(events.movedUnits, total, "Every armed unit must move");
  assert.equal(events.firedUnits, total, "Every armed unit must fire");
  assert.ok(events.movement >= total * 10 && events.shots >= total * 10, "Meaningful movement and combat minimums");
  assert.ok(lastQuarterShots >= total, "Combat must remain active in the last quarter");
  assert.equal(finalCounters.commands, 0);
  assert.ok(finalCounters.reservationOwners <= total);
  assert.equal(finalCounters.damageDiagnostics, 0);
  samples.push({ tick: ticks, heapBytes: heap(), counters: finalCounters });
  return { kind: "synthetic", total, perFaction: total / 2, ticks, simulatedSeconds: ticks / 20,
    seed, map: { width: 128, height: 64, obstacles: 256, costsHash: hash(Array.from(costs)) },
    ...measured.finish(), wallElapsedMs, events, lastQuarterShots, samples,
    finalHash: hash(simulation.checkpoint()) };
}
function loadMission(faction: "HUMAN" | "ALIEN") {
  const sources: { path: string; sha256: string }[] = [];
  const bytes = (path: string) => {
    const content = readFileSync(new URL(path, root));
    sources.push({ path, sha256: createHash("sha256").update(content).digest("hex") });
    return content;
  };
  const json = (path: string) => JSON.parse(bytes(path).toString("utf8"));
  const words = (path: string) => {
    const content = bytes(path);
    return Uint16Array.from({ length: content.length / 2 }, (_, index) => content.readUInt16LE(index * 2));
  };
  const stem = `${faction}/${faction}01`, map = json(`maps/${stem}.json`);
  const data: CampaignMissionData = {
    faction: faction === "HUMAN" ? "human" : "alien", map, scenario: json(`data/scenarios/${stem}.json`),
    triggers: json(`data/triggers/${stem}.json`).blocks, messages: json(`data/messages/${stem}.json`).messages,
    briefing: json(`data/briefings/${stem}.json`), units: json("data/units.json").records,
    weapons: json("data/weapons.json").records, damageMatrix: json("data/damage-matrix.json").coefficients,
    terrain: json("terrain/DESERT.json"), terrainAtlasUrl: "",
    tileReferences: words(`maps/${faction}/${map.files.tileReferences}`),
    tileRecordIndices: words(`maps/${faction}/${map.files.tileRecordIndices}`),
    attributes: words(`maps/${faction}/${map.files.attributes}`),
    tags: bytes(`maps/${faction}/${map.files.tags}`), pathGrid: bytes(`maps/${faction}/${map.files.pathGrid}`),
  };
  return { data, sources };
}
function journalCounts(view: MissionView) {
  const entries = view.campaignJournal;
  return { entries: entries.length, lastEntryJsonBytes: Buffer.byteLength(JSON.stringify(entries.at(-1) ?? null)) };
}
function sourceMission(faction: "HUMAN" | "ALIEN", ticks: number) {
  const { data, sources } = loadMission(faction);
  const canvas = { width: 512, height: 452, getContext: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) } as unknown as HTMLCanvasElement;
  const view = new MissionView(canvas, {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, data);
  view.render = () => {};
  assert.equal(view.missionDiagnostic, undefined);
  view.update(0);
  const measured = meter(), activity = engagement();
  activity.sample(view.simulation.snapshot, view.simulation);
  const samples: unknown[] = [{ tick: 0, heapBytes: heap(), counters: counters(view.simulation), journal: journalCounts(view) }];
  let commandsIssued = 0;
  const start = performance.now();
  try {
    for (let tick = 1; tick <= ticks; tick += 1) {
      measured.measure(() => {
        if (tick % 100 === 0) {
          const snapshot = view.simulation.snapshot;
          for (const unit of snapshot.units.filter((candidate) => view.isOwnedUnit(candidate.id) && candidate.health > 0)) {
            const occupied = new Set([...snapshot.units, ...snapshot.staticTargets].map((entity) => view.grid.index(entity.cellX, entity.cellY)));
            const target = view.grid.neighbors(view.grid.index(unit.cellX, unit.cellY)).find((index) => !occupied.has(index));
            if (target !== undefined) {
              view.simulation.queue({ type: "move", unitIds: [unit.id], target: view.grid.point(target) });
              commandsIssued += 1;
            }
          }
        }
        view.update(tick * 50);
        assert.equal(view.missionDiagnostic, undefined);
        assert.equal(view.simulation.snapshot.tick, tick, "Source session must advance, not bail or idle at a diagnostic");
        activity.sample(view.simulation.snapshot, view.simulation);
      });
      if (tick === ticks / 2) samples.push({ tick, journal: journalCounts(view), heapBytes: heap(), counters: counters(view.simulation) });
    }
    const wallElapsedMs = performance.now() - start;
    const events = activity.result(), journal = journalCounts(view), finalCounters = counters(view.simulation);
    assert.ok(commandsIssued > 0 && events.movement >= 10, "Source session must deliver and move player units");
    assert.equal(finalCounters.commands, 0);
    samples.push({ tick: ticks, heapBytes: heap(), journal, counters: finalCounters });
    const finalHash = hash(view.simulation.checkpoint());
    view.dispose();
    const heapAfterDisposeWhileReferenced = heap();
    assert.equal(view.simulation.snapshot.tick, ticks);
    return { kind: "source-mission", mission: `${faction}01`, ticks, simulatedSeconds: ticks / 20, seed,
      sources, sourceManifestHash: hash(sources), ...measured.finish(), wallElapsedMs, commandsIssued, events, samples,
      finalHash, heapAfterDisposeWhileReferenced, finalUnits: view.simulation.snapshot.units.length,
      outcome: view.missionOutcome, sourceCombatRequired: false };
  } finally { view.dispose(); }
}
function retained<Result>(run: () => Result) {
  const heapBefore = heap(), start = performance.now();
  const result = run();
  const heapAfterScope = heap();
  return { ...result, retention: { heapBefore, heapAfterScope, deltaBytes: heapAfterScope - heapBefore,
    wholeCaseWallMs: performance.now() - start } };
}

emit({ kind: "environment", revision: "phase5-battle-v1", timestamp: new Date().toISOString(), node: process.version,
  platform: platform(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length,
  seed, arguments: [...args], sourceMode: args.has("--source=skip") ? "explicitly-skipped" : "required",
  timing: "per-update wall latency and process CPU user+system milliseconds; CPU may include V8 worker threads",
  budgets: { practicalP95WallMs: 20, fixed20TPSP99WallMs: 50 } });
const first = retained(() => synthetic(16, 400));
const second = retained(() => synthetic(16, 400));
assert.equal(first.finalHash, second.finalHash, "Small fixture must replay deterministically");
assert.deepEqual(first.events, second.events);
emit({ kind: "self-check", passed: true, ticks: 400, total: 16, finalHash: first.finalHash, events: first.events });
if (!args.has("--self-check")) {
  for (const total of [128, 256, 512]) emit(retained(() => synthetic(total, 2400)));
  if (!args.has("--source=skip")) for (const faction of ["HUMAN", "ALIEN"] as const) {
    emit(retained(() => sourceMission(faction, args.has("--mission-ticks=2400") ? 2400 : 1000)));
  }
}
emit({ kind: "complete", passed: true });
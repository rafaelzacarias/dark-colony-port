import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { parseLegacyDamageMatrix, VERIFIED_NATIVE_MBULLET_SHA256 } from "../../src/engine/legacy-balance";
import { createPlaythroughStrategy, type PlaythroughCommand as Command } from "./fixtures/source-playthrough-strategy";
import { parseScenario } from "../extractors/data/scenario";
import { parseTriggerScript } from "../extractors/data/triggers";
import { parseMapBundle } from "../extractors/maps/map";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { installSourceRender } from "./fixtures/source-render";
import { auditFireMovement } from "./fixtures/source-fire-movement-audit";

type Mission = Awaited<ReturnType<typeof loadCampaignMission>>;
type Point = { x: number; y: number };
const args = process.argv.slice(2);
const option = (name: string) => args.find((value) => value.startsWith(`--${name}=`))?.split("=")[1];
const limit = Number(option("limit") ?? 8000);
assert.ok(Number.isInteger(limit) && limit > 0 && limit <= 40000);
const rendering = args.includes("--render") ? installSourceRender() : undefined;
const auditMovement = args.includes("--audit-fire-movement");
const renderEvery = Number(option("render-every") ?? 25);
assert.ok(Number.isInteger(renderEvery) && renderEvery > 0 && renderEvery <= 250);
const restoreAt = option("restore-at") === undefined ? undefined : Number(option("restore-at"));
assert.ok(restoreAt === undefined || (Number.isInteger(restoreAt) && restoreAt > 0 && restoreAt < limit));
let totalTicks = 0;
const expectedHashes = {
  human: { SCN: "af82c538181ca182481562dfa75ff1f39038a58445b019cd6a52426b33e968e7", TRO: "f7fb1c67d68eaa4207ec5053ad7289608f43ca6d631a9d0d45ff3f260011a1a0", MAP: "09d712271c8deca56521a82988e75e44caa6c04dcff83e7e581bae61511f09f9", MTG: "8d88fb9419b1d10448eef67e08b430409b917a2d85aee6a21e6b1b825981a55c", PTH: "681198c4ac5fba41d18e4eee5a25e8dc16a8c0f6a0eaf287706b13f7fd65f415" },
  alien: { SCN: "3a971792a6661c6595ea22a5fa071abe12d03392ab3d8ec40c212328c1298b1e", TRO: "dca0ca87c01f1e0fae8688f81b6707e11aa5b432576b04f7e4e2b56bd1bb76e0", MAP: "df03f260fdf832a9c2f7b76309a18f4a54dc729dd7f06115b7a90fc9ae4ee3d0", MTG: "6d79d94cb5608eb8b96dbac7ce27f346621eb0a378a339c66e95ae14002ea07d", PTH: "94629c5e73d5bfe0beedde237f22077fafa1a0e7729609e32837264d101fb2fd" },
};

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const json = (path: string) => JSON.parse(read(path).toString());
const emit = (kind: string, data: unknown) => console.log(JSON.stringify({ kind, data }));
const results: { run: string; tick: number; success: boolean; finalHash: string }[] = [];
emit("harness", { version: 2, scriptHash: digest(readFileSync(new URL(import.meta.url))),
  runtimeHashes: Object.fromEntries(["src/engine/simulation.ts", "src/engine/combat-movement.ts", "src/mission-view.ts",
    "tools/qa/fixtures/source-playthrough-strategy.ts", "tools/qa/fixtures/source-fire-movement-audit.ts"]
    .map(path => [path, digest(read(path))])),
  startedAt: new Date().toISOString(), args, maximumTotalTicks: 40000, attemptLimit: limit,
  semantics: "deterministic-public-MissionView-command-API; no-browser-or-native-input-claim" });
const originalFetch = globalThis.fetch;
const fetched = new Set<string>();
globalThis.fetch = async (input) => {
  const path = String(input);
  assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
  fetched.add(path);
  return new Response(read(`public${path}`));
};

function createCanvas() {
  return rendering?.canvas() ?? { width: 512, height: 452, getContext: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) } as unknown as HTMLCanvasElement;
}

function createView(mission: Mission) {
  return new MissionView(createCanvas(), {} as HTMLElement, { onStats() {}, onUnitsChanged() {} }, mission);
}

async function play(mission: Mission, intent: "win" | "loss", replay?: readonly Command[]) {
  let view = createView(mission);
  const run = `${mission.faction}-${intent}${replay ? "-replay" : ""}`;
  const sourceHash = digest(JSON.stringify(mission));
  const commands: Command[] = [];
  const combatHash = createHash("sha256");
  const auditHash = createHash("sha256");
  const audit = { frames: 0, shots: 0, deaths: 0, movedUnits: 0, activityTransitions: 0, movementViolations: 0 };
  let renderedFrames = 0;
  let replayIndex = 0;
  const strategy = createPlaythroughStrategy(intent);
  let outcomeSignature = "", deaths = 0, shots = 0;
  const startingStatics = view.simulation.snapshot.staticTargets;
  const goals = mission.faction === "human" ? [1, 7, 2] : [4, 8];
  const tagCells = (tag: number): Point[] => Array.from(mission.tags.entries())
    .filter(([, value]) => (value & 63) === tag)
    .map(([index]) => ({ x: index % mission.map.width, y: mission.map.height - 1 - Math.floor(index / mission.map.width) }))
    .filter(({ x, y }) => view.grid.isPassable(x, y));
  emit("start", { run, sourceHash, goals: goals.map((tag) => ({ tag, cells: tagCells(tag) })),
    units: view.simulation.snapshot.units, statics: startingStatics });
  function issue(command: Command) {
    assert.equal(command.tick, view.simulation.snapshot.tick);
    view.clearSelection();
    for (const id of command.ids) view.selectUnit(id, true);
    assert.deepEqual(view.selectedIds, [...command.ids].sort((left, right) => left - right));
    const { x, y } = command.point;
    assert.ok(view.grid.contains(x, y));
    view.setCameraCenter(x + 0.5, y + 0.5);
    view.setOrderMode(command.mode);
    const cursor = view.cursorAt(256, 226);
    assert.notEqual(cursor, "blocked", `${run}: blocked command ${x},${y}`);
    emit("command", { run, ...command, client: [256, 226], cursor, selected: view.selectedIds,
      visible: !!view.visibility[y * mission.map.width + x] });
    view.commandAt(256, 226);
    commands.push(command);
  }
  function plan() {
    strategy.plan(view, issue, block => emit("path-block", { run, ...block }));
  }
  try {
    assert.equal(view.mission.sourceNativeCombat, undefined);
    if (rendering) {
      rendering.setEnabled(true);
      await view.initialize();
      assert.equal(view.missionDiagnostic, undefined);
      emit("render-initialized", { run, ...rendering.evidence(), fetched: [...fetched].sort() });
    }
    view.update(0);
    for (let tick = 0; tick < limit && totalTicks < 40000; tick += 1) {
      if (view.missionDiagnostic || view.missionOutcome?.ready) break;
      rendering?.setEnabled(tick < 200 || tick % 50 === 0 || (tick + 1) % renderEvery === 0);
      if (replay) {
        while (replay[replayIndex]?.tick === tick) issue(replay[replayIndex++]);
      } else if (tick % 50 === 0) plan();
      const before = auditMovement ? view.simulation.checkpoint() : undefined;
      view.update((tick + 1) * 50);
      if (before) {
        const checked = auditFireMovement(before, view.simulation.checkpoint());
        audit.frames += 1;
        audit.shots += checked.shots.length;
        audit.deaths += checked.deaths;
        audit.movedUnits += checked.movedUnits;
        audit.activityTransitions += checked.activityTransitions;
        auditHash.update(JSON.stringify({ tick: before.tick, ...checked }));
        if (checked.shots.length) emit("fire-movement", { run, tick: tick + 1, shots: checked.shots });
      }
      if (rendering && (tick < 200 || tick % 50 === 0 || (tick + 1) % renderEvery === 0)) renderedFrames += 1;
      totalTicks += 1;
      const combat = view.simulation.combatEvents;
      const deathEvents = view.simulation.deathEvents;
      shots += combat.length;
      deaths += deathEvents.length;
      if (combat.length || deathEvents.length) {
        const evidence = { tick: tick + 1, combat, deaths: deathEvents };
        combatHash.update(JSON.stringify(evidence));
        emit("combat", { run, ...evidence });
      }
      const outcome = JSON.stringify(view.missionOutcome);
      if (outcome !== outcomeSignature) { emit("outcome", { run, tick: tick + 1, outcome: view.missionOutcome }); outcomeSignature = outcome; }
      if ((tick + 1) % 250 === 0) emit("progress", { run, tick: tick + 1, phase: strategy.state.phase,
        owned: view.simulation.snapshot.units.filter((unit) => view.isOwnedUnit(unit.id)),
        lives: view.campaignSnapshot?.controller.runtime.lives,
        losses: Object.fromEntries(Object.entries(view.missionStatistics).filter(([key, value]) => value && key.endsWith(",3"))) });
      if (rendering && (tick + 1) % 250 === 0) {
        emit("render-phase", { run, tick: tick + 1, phase: strategy.state.phase, ...rendering.evidence(),
          types: [...new Set(view.campaignSnapshot!.world.entities.map(entity => entity.unitType))].sort((left, right) => left - right) });
      }
      if (tick + 1 === restoreAt) {
        const checkpoint = JSON.parse(JSON.stringify(view.checkpoint()));
        const restored = MissionView.restore(createCanvas(), {} as HTMLElement,
          { onStats() {}, onUnitsChanged() {} }, mission, checkpoint);
        assert.deepEqual(restored.checkpoint(), checkpoint);
        view.dispose();
        view = restored;
        if (rendering) {
          rendering.setEnabled(true);
          await view.initialize();
        }
        assert.equal(view.missionDiagnostic, undefined);
        view.update((tick + 1) * 50);
        emit("checkpoint-restored", { run, tick: tick + 1, checkpointHash: digest(JSON.stringify(checkpoint)) });
      }
    }
    rendering?.setEnabled(true);
    view.render();
    assert.equal(digest(JSON.stringify(mission)), sourceHash, "mission source data mutated");
    const final = { snapshot: view.simulation.snapshot, statistics: view.missionStatistics,
      outcome: view.missionOutcome, diagnostic: view.missionDiagnostic ?? null, bindings: view.nativeBindings };
    const result = { run, tick: final.snapshot.tick, totalTicks, outcome: final.outcome, diagnostic: final.diagnostic,
      success: final.outcome?.ready === true && final.outcome.resultCode === (intent === "win" ? 0 : 1),
      shots, deaths, commandCount: commands.length, commandHash: digest(JSON.stringify(commands)),
      combatHash: combatHash.digest("hex"), finalHash: digest(JSON.stringify(final)) };
    const fireMovementHash = auditHash.digest("hex");
    if (auditMovement) {
      assert.equal(audit.frames, result.tick);
      assert.equal(audit.shots, shots);
      assert.equal(audit.deaths, deaths);
      emit("fire-movement-complete", { run, ...audit, hash: fireMovementHash });
    }
    emit("result", result);
    if (rendering) {
      assert.ok(rendering.evidence().spriteDraws > 0);
      assert.ok(!rendering.evidence().warnings.some(warning => /missing-state|unsupported-timeline|missing-atlas-frame/.test(warning)));
      emit("render-complete", { run, tick: final.snapshot.tick, renderedFrames, ...rendering.evidence(), fetched: [...fetched].sort() });
    }
    emit("final-state", { run, ...final });
    return { ...result, commands, fireMovementHash };
  } catch (error) {
    emit("failure", { run, tick: view.simulation.snapshot.tick, diagnostic: view.missionDiagnostic,
      error: error instanceof Error ? error.stack : String(error), rendering: rendering?.evidence() });
    throw error;
  } finally { view.dispose(); }
}

try {
  for (const faction of ["human", "alien"] as const) {
    if (option("case") && !option("case")!.startsWith(`${faction}-`)) continue;
    const mission = await loadCampaignMission(faction);
    const prefix = faction.toUpperCase(), stem = `${prefix}/${prefix}01`;
    const hashes = Object.fromEntries(["SCN", "TRO", "MAP", "MTG", "PTH"].map((extension) =>
      [extension, digest(read(`raw_cd/DC/SCENARIO/${stem}.${extension}`))]));
    assert.deepEqual(hashes, expectedHashes[faction]);
    assert.equal(digest(Buffer.from(mission.scenario.rawScenario!, "base64")), hashes.SCN);
    assert.equal(mission.scenario.source.sha256, hashes.SCN);
    assert.deepEqual(mission.triggers, json(`public/assets/generated/data/triggers/${stem}.json`).blocks);
    assert.deepEqual(mission.triggers, parseTriggerScript(read(`raw_cd/DC/SCENARIO/${stem}.TRO`).toString()));
    for (const [key, value] of Object.entries(parseScenario(read(`raw_cd/DC/SCENARIO/${stem}.SCN`).toString()))) {
      assert.deepEqual(mission.scenario[key as keyof typeof mission.scenario], value);
    }
    const bundle = parseMapBundle(...(["MAP", "MTG", "PTH"].map((extension) =>
      read(`raw_cd/DC/SCENARIO/${stem}.${extension}`)) as [Buffer, Buffer, Buffer]));
    for (const key of ["tileReferences", "attributes", "pathGrid"] as const) assert.deepEqual(mission[key], bundle[key]);
    assert.deepEqual(mission.tags, bundle.tagGrid);
    assert.deepEqual(mission.units, parseUnitStats(read("raw_cd/DC/GAMESTAT/GAMESTAT.TXT").toString()));
    assert.deepEqual(mission.weapons, parseWeaponStats(read("raw_cd/DC/GAMESTAT/WEAPSTAT.TXT").toString()));
    const matrixBytes = read("raw_cd/DC/GAMESTAT/MBULLET.TXT");
    assert.equal(digest(matrixBytes), VERIFIED_NATIVE_MBULLET_SHA256);
    assert.deepEqual(mission.damageMatrix, parseLegacyDamageMatrix(matrixBytes.toString()));
    assert.ok(mission.sourceProduction);
    const view = createView(mission);
    assert.equal(view.missionDiagnostic, undefined);
    emit("admission", { faction, hashes, matrixHash: digest(matrixBytes), sourceProduction: mission.sourceProduction,
      objectives: mission.briefing.objectives, triggerCount: mission.triggers.length,
      unitsHash: digest(JSON.stringify(mission.units)), weaponsHash: digest(JSON.stringify(mission.weapons)) });
    view.dispose();
    if (args.includes("--inspect")) continue;
    for (const intent of ["win", "loss"] as const) {
      if (option("case") && option("case") !== `${faction}-${intent}`) continue;
      const result = await play(mission, intent);
      results.push({ run: result.run, tick: result.tick, success: result.success, finalHash: result.finalHash });
      if (result.success && !args.includes("--no-repeat") && totalTicks + result.tick <= 40000) {
        const repeated = await play(mission, intent, result.commands);
        assert.equal(repeated.finalHash, result.finalHash);
        assert.equal(repeated.combatHash, result.combatHash);
        assert.equal(repeated.commandHash, result.commandHash);
        if (auditMovement) assert.equal(repeated.fireMovementHash, result.fireMovementHash);
        emit("repeat-verified", { run: result.run, tick: result.tick, finalHash: result.finalHash });
      } else if (result.success && !args.includes("--no-repeat")) {
        emit("repeat-skipped", { run: result.run, reason: "combined-40000-tick-budget" });
      }
    }
  }
  emit("suite-complete", { totalTicks, results });
  if (results.some(({ success }) => !success)) process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
  rendering?.dispose();
}
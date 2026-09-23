import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CampaignSession, initializeCampaignSession, type CampaignSessionOptions } from "../../src/engine/campaign-session";
import { createBrowserAiSelectorConfiguration } from "../../src/engine/browser-campaign-runtime";
import { sourceProductionPopulation } from "../../src/engine/source-production-options";
import { transportHostState } from "../../src/engine/transport-host";
import type { CampaignWorld } from "../../src/engine/campaign-world";
import { parseScenario } from "../extractors/data/scenario";
import { parseMapBundle } from "../extractors/maps/map";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { parseTriggerScript } from "../extractors/data/triggers";
import { limits06, run06 } from "./mission06-playthrough";

const root = new URL("../../", import.meta.url).pathname;
const read = (path: string) => readFileSync(`${root}${path}`);

function options(script = ""): CampaignSessionOptions {
  const asset = (extension: string) => read(`raw_cd/DC/SCENARIO/ALIEN/ALIEN02.${extension}`);
  const source = parseScenario(asset("SCN").toString());
  const map = parseMapBundle(asset("MAP"), asset("MTG"), asset("PTH"));
  return { sessionId: "selector6-control", source, map, pathGrid: map.pathGrid, tags: map.tagGrid,
    units: parseUnitStats(read("raw_cd/DC/GAMESTAT/GAMESTAT.TXT").toString()),
    weapons: parseWeaponStats(read("raw_cd/DC/GAMESTAT/WEAPSTAT.TXT").toString()),
    runtimeProfile: "browser-adapted", browserAi: createBrowserAiSelectorConfiguration(source),
    triggers: parseTriggerScript(script), messages: [], commanders: [{ team: 0, unitType: 73, sprite: "GRAY" }],
    directionBits: Array.from({ length: 64 }, () => [0, 0] as const), fixedStepMilliseconds: 50,
    orientationSteps: 1, resourceScales: "configured-startup" };
}

function census(session: CampaignSession) {
  const { world, controller } = session.snapshot;
  const populations = Array.from({ length: 8 }, (_, team) => sourceProductionPopulation(world, team));
  assert.deepEqual(populations, Array.from({ length: 8 }, (_, team) => world.statistics[`${team},6`]));
  assert.deepEqual(world.statistics, controller.runtime.statistics);
  return populations;
}

test("selector6 feedback: original x86 census counts registered slots independent of status and HP", () => {
  const proof = process.env.DC_SELECTOR6_NATIVE ? readFileSync(process.env.DC_SELECTOR6_NATIVE, "utf8")
    : execFileSync("python3", ["-B", "-c", `import runpy,json; module=runpy.run_path(${JSON.stringify(root + "tools/qa/source-production-startup-native.py")}); print(json.dumps({"executableSha256":module["BASE"]["EXE_HASH"],"census":module["census_policy"](),"accessor":module["census_accessor"]()}))`],
      { encoding: "utf8", timeout: 60000, killSignal: "SIGKILL", env: { ...process.env,
        PYTHONPATH: [process.env.PYTHONPATH, "/tmp/dc-h06-native-20260923", "/tmp/dc-re-capstone-20260918", "/tmp/dc-trigger-unicorn-20260918"].filter(Boolean).join(":") } });
  const native = JSON.parse(proof) as { executableSha256: string; accessor: number[];
    census: { fixtures: [number, number, number, number, boolean][]; populations: number[] } };
  assert.equal(createHash("sha256").update(read("raw_cd/DC/DC.EXE")).digest("hex"), native.executableSha256);
  assert.deepEqual(native.accessor, Array.from({ length: 8 }, (_, team) => 101 + team));
  const slots = Array(800).fill(null), registry = Array(800).fill(null);
  for (const [slot, team, status, health, registered] of native.census.fixtures) {
    slots[slot] = { key: `native:${slot}`, slot, team, status, health };
    registry[slot] = registered ? slots[slot].key : null;
  }
  const world = { transportState: { kind: "transport-host-v1", slots, registry } } as unknown as CampaignWorld;
  assert.deepEqual(Array.from({ length: 8 }, (_, team) => sourceProductionPopulation(world, team)), native.census.populations);
  assert.deepEqual(native.census.populations, [3, 1, 0, 0, 0, 0, 0, 0]);
});

test("selector6 feedback: casualties stay counted until unregistered, with exact replay and rollback", () => {
  const session = new CampaignSession(options());
  const initial = census(session);
  const victims = [
    session.snapshot.world.entities.find(actor => actor.team === 0 && actor.unitType === 8)!,
    session.snapshot.world.entities.find(actor => actor.team === 1 && actor.unitType === 86)!,
  ];
  assert.ok(victims.every(Boolean));
  const updates = victims.map(actor => ({ type: "combat-death" as const, slot: actor.rawSlot!, generation: actor.generation! }));
  assert.ok(session.step({ clockMilliseconds: 50, updates }).ok);
  assert.deepEqual(census(session), initial);
  const host = transportHostState(session.snapshot.world);
  for (const actor of victims) {
    assert.equal(host.slots[actor.rawSlot!]!.status, 10);
    assert.equal(host.slots[actor.rawSlot!]!.health, 0);
    assert.equal(host.registry[actor.rawSlot!], actor.key);
  }
  const saved = session.checkpoint();
  const restored = CampaignSession.restore(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored.checkpoint(), saved);
  const removal = victims.map(actor => ({ type: "complete-removal" as const, slot: actor.rawSlot!, generation: actor.generation! }));
  assert.equal(session.step({ clockMilliseconds: 100, updates: removal,
    reservations: [{ slot: 799, generation: 999, tileX: 0, tileY: 0 }] }).ok, false);
  assert.deepEqual(session.checkpoint(), saved);
  for (const candidate of [session, restored]) {
    assert.ok(candidate.step({ clockMilliseconds: 100, updates: removal }).ok);
    assert.deepEqual(census(candidate), initial.map((value, team) => value - Number(team === 0 || team === 1)));
  }
  assert.deepEqual(restored.checkpoint(), session.checkpoint());
});

test("selector6 feedback: alliances do not merge populations and strict canonical startup stays unchanged", () => {
  const initial = options("1 norm 1 (c>0)\nally 0 1 1\nend\n2 norm 1 (c>1)\nally 0 1 0\nend");
  const session = new CampaignSession(initial), populations = census(session);
  for (let tick = 1; tick <= 32; tick++) {
    assert.ok(session.step({ clockMilliseconds: tick * 50 }).ok);
    assert.deepEqual(census(session), populations);
    if (tick === 16) assert.equal(session.snapshot.world.teamAlliances![0][1], 1);
  }
  assert.equal(session.snapshot.world.teamAlliances![0][1], 0);
  const saved = session.checkpoint();
  assert.deepEqual(CampaignSession.restore(JSON.parse(JSON.stringify(saved))).checkpoint(), saved);
  const stale = JSON.parse(JSON.stringify(saved));
  stale.state.world.statistics["0,6"] = stale.state.controller.runtime.statistics["0,6"] = 0;
  assert.throws(() => CampaignSession.restore(stale));
  const strictOptions = { ...initial, runtimeProfile: "strict-native" as const, browserAi: undefined, triggers: [] };
  const canonical = initializeCampaignSession(strictOptions);
  assert.ok(canonical.ok);
  const strict = new CampaignSession(strictOptions);
  for (let team = 0; team < 8; team++) assert.equal(strict.snapshot.world.statistics[`${team},6`], canonical.value.world.statistics[`${team},6`]);
  const strictSaved = JSON.parse(JSON.stringify(strict.checkpoint()));
  assert.deepEqual(CampaignSession.restore(strictSaved).checkpoint(), strictSaved);
});

test("selector6 A06: full original tick320 opening has exact census and preserves the population gate", async () => {
  const output = mkdtempSync(join(tmpdir(), "dc-a06-selector6-natural-"));
  const result = await run06("alien", output, limits06(60000, 320));
  assert.equal(result.diagnostic, undefined, JSON.stringify({ output, result }));
  assert.equal(result.tick, 320, JSON.stringify({ output, result }));
  const saved = JSON.parse(readFileSync(join(output, "checkpoint.json"), "utf8"));
  const state = saved.view.session.state;
  const population = sourceProductionPopulation(state.world, 0);
  assert.equal(population, 18);
  assert.equal(state.world.statistics["0,6"], population);
  assert.equal(state.controller.runtime.statistics["0,6"], population);
  assert.equal(state.controller.runtime.lives[14], 1);
  const originalBlocks = parseTriggerScript(read("raw_cd/DC/SCENARIO/ALIEN/ALIEN06.TRO").toString());
  assert.equal(originalBlocks.find(block => block.id === 14)!.condition, "(s(0,6)>19)");
  assert.deepEqual(state.controller.blocks, originalBlocks);
  const integrity = JSON.parse(readFileSync(join(output, "integrity.json"), "utf8"));
  assert.deepEqual(integrity.changed, []);
  assert.deepEqual(integrity.changedAssets, []);
  console.log(JSON.stringify({ output, population, block14Lives: state.controller.runtime.lives[14], tick: result.tick }));
});

test("selector6 A06 replay: natural public driver crosses 19 and commits original block14", {
  skip: !process.env.DC_SELECTOR6_A06_CHECKPOINT,
}, () => {
  const saved = JSON.parse(readFileSync(process.env.DC_SELECTOR6_A06_CHECKPOINT!, "utf8"));
  const checkpoint = saved.view.session;
  const original = parseTriggerScript(read("raw_cd/DC/SCENARIO/ALIEN/ALIEN06.TRO").toString());
  assert.deepEqual(checkpoint.options.triggers, original);
  assert.deepEqual(checkpoint.state.controller.blocks, original);
  const session = new CampaignSession({ ...checkpoint.options,
    pathGrid: Uint8Array.from(checkpoint.options.pathGrid), tags: Uint8Array.from(checkpoint.options.tags) });
  const block = original.find(block => block.id === 14)!;
  assert.equal(block.condition, "(s(0,6)>19)");
  let proof: Record<string, unknown> | undefined;
  for (const input of checkpoint.state.aiSelectorInputs) {
    const before = session.snapshot;
    const result = session.step(input);
    assert.ok(result.ok, JSON.stringify(result));
    census(session);
    if (!result.value.entry.fired.includes(14)) continue;
    const registered = sourceProductionPopulation(before.world, 0);
    assert.ok(registered > 19);
    assert.equal(before.world.statistics["0,6"], registered);
    assert.equal(before.controller.runtime.lives[14], 1);
    assert.equal(result.value.controller.runtime.lives[14], 0);
    assert.equal(session.browserAiProjection!.selectors.modes[2], 3);
    assert.deepEqual(result.value.entry.trace.filter(entry => entry.triggerId === 14).map(entry => entry.action), [...block.actions].reverse());
    proof = { tick: result.value.cycleCounter, registeredBefore: registered,
      registeredAfter: result.value.world.statistics["0,6"], actions: block.actions,
      checkpoint: process.env.DC_SELECTOR6_A06_CHECKPOINT };
    break;
  }
  assert.ok(proof, "Original block14 must fire from the unmodified public-driver inputs");
  console.log(JSON.stringify(proof));
});
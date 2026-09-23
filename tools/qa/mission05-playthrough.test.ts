import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { assertMission05HealthyResume, authenticateMission05Resume, mission05CheckpointDifferences, mission05HumanApproach, mission05HumanObjective, mission05HumanProofReserve, mission05HumanRetainMove, mission05HumanStage, mission05HumanTargets, mission05Limits, mission05RouteTarget, mission05VisibleRoutes, preflight05 } from "./mission05-playthrough";
import { NavigationGrid } from "../../src/engine/grid";
import { mission03Status, sha256 } from "./mission03-playthrough";
import { mission05HumanCanReinforce, mission05HumanContinuationBudget, mission05HumanFinalReplay, mission05HumanInRange, mission05HumanPartition } from "./mission05-playthrough";

test("mission05 human continuation: survivors, saved funds, finite income and hard total budget", () => {
  assert.equal(mission05HumanStage("assemble", 0, 0, 3, true), "assault");
  assert.equal(mission05HumanStage("assault", 0, 0, 1, true), "assault");
  assert.equal(mission05HumanStage("assemble", 0, 0, 0, true), "assemble");
  assert.equal(mission05HumanCanReinforce(23364, 23364, 0, 2514, 350, 2514), true);
  assert.equal(mission05HumanCanReinforce(25000, 23364, 3850, 300, 350, 2514), false);
  assert.equal(mission05HumanContinuationBudget(600000), 450000);
  assert.equal(mission05HumanContinuationBudget(900000), 150000);
  assert.equal(mission05HumanContinuationBudget(1080000), 0);
  assert.equal(mission05HumanContinuationBudget(100000), 600000);
  const infantry = Array.from({ length: 28 }, (_, index) => ({ id: index + 1, health: 800,
    maxHealth: 800, cellX: index, cellY: 0 }));
  const prior = mission05HumanPartition({ base: [], collectors: [], raid: [] }, infantry, { x: 0, y: 0 });
  const next = mission05HumanPartition(prior, infantry, { x: 0, y: 0 }, 0);
  assert.equal(next.base.length, 4);
  assert.equal(next.collectors.length, 2);
  assert.equal(next.raid.length, 22);
  assert.equal(new Set([...next.base, ...next.collectors, ...next.raid]).size, 28);
  assert.deepEqual(mission05HumanPartition(next, infantry, { x: 0, y: 0 }, 0), next);
  const threatened = mission05HumanPartition(next, infantry, { x: 0, y: 0 }, 3);
  assert.equal(threatened.base.length, 8);
  assert.equal(threatened.raid.length, 18);
  assert.equal(new Set([...threatened.base, ...threatened.collectors, ...threatened.raid]).size, 28);
});

test("mission05 human: final retry uses real income, Manhattan range and mandatory WIN replay", () => {
  assert.equal(mission05HumanCanReinforce(1000, 1000, 0, 9000, 350), false);
  assert.equal(mission05HumanCanReinforce(1350, 1000, 0, 350, 350), true);
  assert.equal(mission05HumanCanReinforce(1350, 1000, 350, 9000, 350), false);
  assert.equal(mission05HumanCanReinforce(1350, 1000, 0, 349, 350), false);
  assert.equal(mission05HumanInRange({ x: 0, y: 0 }, { x: 2, y: 3 }, 4), false);
  assert.equal(mission05HumanInRange({ x: 0, y: 0 }, { x: 1, y: 2 }, 4), true);
  assert.equal(mission05HumanFinalReplay(true, false), false);
  assert.equal(mission05HumanFinalReplay(true, true), true);
  assert.equal(mission05HumanFinalReplay(false, false), true);
  assert.equal(mission05HumanStage("assemble", 8, 0, 8), "flank");
  assert.equal(mission05HumanStage("assemble", 7, 0, 7), "assemble");
});

test("mission05 human: stable guard and expedition partition survives visible raids and reinforcements", () => {
  const infantry = Array.from({ length: 23 }, (_, index) => ({ id: index + 1, health: index === 0 ? 100 : 400,
    maxHealth: 400, cellX: index, cellY: 0 }));
  const first = mission05HumanPartition({ base: [], collectors: [], raid: [] }, infantry, { x: 0, y: 0 });
  assert.deepEqual(first.base, [2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(first.collectors, [10, 11]);
  assert.equal(first.raid.length, 12);
  const moved = infantry.map(actor => ({ ...actor, cellX: 100 - actor.cellX }));
  assert.deepEqual(mission05HumanPartition(first, moved.reverse(), { x: 0, y: 0 }), first);
  const replacement = { id: 24, health: 400, maxHealth: 400, cellX: 0, cellY: 0 };
  const next = mission05HumanPartition(first, [...moved.filter(actor => actor.id !== 2), replacement], { x: 0, y: 0 });
  assert.deepEqual(next.raid, first.raid);
  assert.deepEqual(next.collectors, first.collectors);
  assert.deepEqual(next.base, [3, 4, 5, 6, 7, 8, 9, 24]);
  assert.equal(new Set([...next.base, ...next.collectors, ...next.raid]).size, 22);
});

test("mission05 human: visible assault targets use live damage eligibility", () => {
  const calls: number[][] = [];
  const simulation = { canAutoTarget(attackerId: number, targetId: number) {
    calls.push([attackerId, targetId]);
    return targetId === 102;
  } };
  const helper = { id: 101, health: 999 }, city = { id: 102, health: 4800 };
  assert.deepEqual(mission05HumanTargets(simulation, 51, [helper, city]), [city]);
  assert.deepEqual(calls, [[51, 101], [51, 102]]);
  assert.deepEqual(mission05HumanTargets(simulation, 51, []), []);
});

test("mission05 human: protect commander without resetting progressing routes and follow source extraction gates", () => {
  assert.equal(mission05HumanRetainMove("move", 50, true), true);
  assert.equal(mission05HumanRetainMove("move", 100, true), false);
  assert.equal(mission05HumanRetainMove("move", 0, false), false);
  assert.equal(mission05HumanRetainMove("idle", 0, true), false);
  assert.deepEqual(mission05HumanObjective(new Set([20, 14])), { team: 2 });
  assert.deepEqual(mission05HumanObjective(new Set([20, 14, 1])), { team: 1 });
  assert.deepEqual(mission05HumanObjective(new Set([1, 18])), { trip: 17 });
  assert.deepEqual(mission05HumanObjective(new Set([1, 18, 17])), { trip: 15 });
  assert.deepEqual(mission05HumanObjective(new Set([1, 9])), { trip: 15 });
  assert.equal(mission05HumanStage("assemble", 9, 0), "assemble");
  assert.equal(mission05HumanStage("assemble", 10, 0), "flank");
  assert.equal(mission05HumanStage("flank", 0, 7), "flank");
  assert.equal(mission05HumanStage("flank", 0, 8), "assault");
  assert.equal(mission05HumanStage("assault", 0, 0), "assault");
  const costs = new Uint16Array(100 * 80);
  for (let cellY = 0; cellY < 80; cellY++) costs[cellY * 100 + 62] = 1;
  const grid = new NavigationGrid(100, 80, costs);
  assert.deepEqual(mission05HumanApproach(grid, { x: 62, y: 0 }, { x: 62, y: 79 }, new Set()),
    { assembly: { x: 62, y: 52 }, flank: { x: 62, y: 64 } });
  assert.equal(mission05HumanApproach(grid, { x: 62, y: 0 }, { x: 20, y: 79 }, new Set()), undefined);
});

test("mission05 route: retain queued movement until arrival and avoid occupied escort destinations", () => {
  const route = Array.from({ length: 20 }, (_, index) => ({ x: 21 + index, y: 18 }));
  for (const cellX of [21, 22, 23, 30]) {
    assert.equal(mission05RouteTarget({ activity: "move", cellX, cellY: 18 }, route), undefined);
  }
  assert.equal(mission05RouteTarget({ activity: "move", cellX: 21, cellY: 18 }, route, [], 39), undefined);
  assert.deepEqual(mission05RouteTarget({ activity: "move", cellX: 21, cellY: 18 }, route, [], 40), { x: 33, y: 18 });
  assert.deepEqual(mission05RouteTarget({ activity: "idle", cellX: 21, cellY: 18 }, route), { x: 33, y: 18 });
  assert.equal(mission05RouteTarget({ activity: "idle", cellX: 33, cellY: 18 }, route), undefined);
  assert.equal(mission05RouteTarget({ activity: "idle", cellX: 21, cellY: 18 }, route, [{ x: 33, y: 18 }]), undefined);
  assert.equal(mission05RouteTarget({ activity: "idle", cellX: 21, cellY: 18 }, []), undefined);
});

test("mission05 route: full MTG alternatives avoid visible weapon ranges and allow outward escape", () => {
  const grid = new NavigationGrid(100, 80);
  const goals = [{ x: 76, y: 45 }, { x: 75, y: 47 }, { x: 81, y: 51 }];
  const threat = { id: 10, x: 25, y: 39, range: 9 };
  const plan = mission05VisibleRoutes(grid, { x: 21, y: 20 }, goals, new Set(), [threat]);
  assert.ok(plan.routes.length >= goals.length);
  assert.equal(new Set(plan.routes.map(candidate => JSON.stringify(candidate.goal))).size, goals.length);
  for (const candidate of plan.routes) {
    assert.deepEqual(candidate.route.at(-1), candidate.goal);
    assert.ok(candidate.route.every(cell => Math.hypot(cell.x - threat.x, cell.y - threat.y) >= 11));
    assert.notDeepEqual(candidate.goal, { x: 85, y: 44 });
  }
  assert.ok(plan.routes[0].route.findIndex(cell => cell.x >= 33) < plan.routes[0].route.findIndex(cell => cell.y >= 39));
  const escape = mission05VisibleRoutes(grid, { x: 25, y: 32 }, [{ x: 40, y: 20 }], new Set(), [threat]);
  assert.ok(escape.routes.length);
  assert.ok(escape.routes[0].route.every(cell => Math.hypot(cell.x - threat.x, cell.y - threat.y) >= 7));
  const alternatives = mission05VisibleRoutes(grid, { x: 21, y: 20 }, goals,
    new Set([grid.index(76, 45)]), []);
  assert.ok(alternatives.routes.length);
  assert.ok(alternatives.routes.every(candidate => candidate.goal.x !== 76));
});

test("mission05 bounds: no harness limit or pending outcome counts as completed proof", () => {
  assert.equal(mission05HumanProofReserve(300000, 12000, 12000), 390000);
  assert.equal(mission05HumanProofReserve(300000, 12000, 18000), 570000);
  assert.throws(() => mission05Limits(600001));
  assert.throws(() => mission05Limits(0));
  assert.equal(mission05Limits().restoreMs, 900000);
  assert.equal(mission05Limits().totalMs, 1140000);
  assert.equal(mission03Status(null, undefined, false), "HARNESS_LIMIT");
  assert.equal(mission03Status({ resultCode: 0, reasonCode: 1, ready: false }, undefined, true), "HARNESS_LIMIT");
  assert.equal(mission03Status({ resultCode: 0, reasonCode: 1, ready: true }, undefined, false), "READY_WIN_UNVERIFIED");
});

test("mission05 route: current restore differences identify fields without migration", () => {
  const expected = { simulation: { tick: 4000 }, session: { optional: false } };
  assert.deepEqual(mission05CheckpointDifferences(expected, structuredClone(expected)), []);
  assert.deepEqual(mission05CheckpointDifferences(expected, { simulation: { tick: 0 }, session: {} }),
    ["view.simulation.tick", "view.session.optional"]);
});

test("mission05 preflight: unchanged original source objectives and real view initialization", async () => {
  const output = `/tmp/dc-m05-preflight-${process.pid}-${Date.now()}`;
  for (const faction of ["human", "alien"] as const) {
    const contract = await preflight05(faction, output);
    assert.ok(contract.tripCells[faction === "human" ? 15 : 18].length);
    assert.equal(contract.win.id, faction === "human" ? 15 : 19);
    const report = JSON.parse(readFileSync(`${output}/${faction}-preflight.json`, "utf8"));
    const mission = JSON.parse(report.checkpoint.sourceIdentity);
    const saved = { sourceHash: contract.sourceHash, view: report.checkpoint };
    assertMission05HealthyResume(saved);
    const latched = structuredClone(saved);
    latched.view.state.diagnostic = "Occupied or ineligible ground cell 101,4";
    assert.throws(() => assertMission05HealthyResume(latched), /Diagnostic-bearing/);
    assert.equal(latched.view.state.diagnostic, "Occupied or ineligible ground cell 101,4");
    assert.deepEqual(authenticateMission05Resume(mission, saved).omitted, []);
    if (mission.sourceProduction?.production) {
      const legacy = structuredClone(saved);
      const identity = JSON.parse(legacy.view.sourceIdentity);
      delete identity.sourceProduction.production.adaptedUpgrades;
      delete legacy.view.session.options.production.adaptedUpgrades;
      legacy.view.sourceIdentity = JSON.stringify(identity);
      assert.deepEqual(authenticateMission05Resume(mission, legacy).omitted, ["adaptedUpgrades"]);
      identity.scenario.source.sha256 = "0".repeat(64);
      legacy.view.sourceIdentity = JSON.stringify(identity);
      assert.throws(() => authenticateMission05Resume(mission, legacy));
      identity.scenario.source.sha256 = mission.scenario.source.sha256;
      identity.sourceProduction.production.adaptedUpgrades = { runtimeProfile: "tampered" };
      legacy.view.sourceIdentity = JSON.stringify(identity);
      assert.throws(() => authenticateMission05Resume(mission, legacy));
    }
    const tampered = structuredClone(saved);
    const identity = JSON.parse(tampered.view.sourceIdentity);
    identity.triggers[0].condition = "1";
    tampered.view.sourceIdentity = JSON.stringify(identity);
    assert.throws(() => authenticateMission05Resume(mission, tampered));
  }
});

const currentAlienOutput = process.env.DC_M05_CURRENT_ALIEN_ARTIFACTS;
test("mission05 current AL05 artifacts: exact ordinary restore, visible-only continuation and current roundtrip", { skip: !currentAlienOutput }, () => {
  const directory = currentAlienOutput!;
  const read = (name: string) => JSON.parse(readFileSync(`${directory}/${name}.json`, "utf8"));
  const saved = read("checkpoint"), result = read("result"), integrity = read("integrity"), exit = read("exit");
  const input = JSON.parse(readFileSync(integrity.resume, "utf8"));
  const inputHash = sha256(JSON.stringify(input.view)), currentHash = sha256(JSON.stringify(saved.view));
  for (const name of ["initial-restore", "initialized-restore"]) {
    const proof = read(name);
    assert.equal(proof.exact, true);
    assert.deepEqual(proof.differences, []);
    assert.equal(proof.tick, 4000);
    assert.equal(proof.expectedHash, inputHash);
    assert.equal(proof.actualHash, inputHash);
  }
  const proof = read("current-roundtrip");
  assert.equal(proof.exact, true);
  assert.equal(proof.initialized, true);
  assert.equal(proof.expectedHash, currentHash);
  assert.equal(proof.actualHash, currentHash);
  assert.equal(result.checkpointHash, currentHash);
  assert.equal(result.tick, saved.view.simulation.tick);
  assert.equal(proof.tick, result.tick);
  assert.equal(result.currentRoundtripExact, true);
  assert.deepEqual(result.outcome, saved.view.state.outcome);
  assert.equal(result.outcome, null);
  assert.equal(result.status, "HARNESS_LIMIT");
  assert.equal(Object.hasOwn(input.view.session, "replayPolicy"), false);
  assert.equal(Object.hasOwn(saved.view.session, "replayPolicy"), false);
  assert.equal(result.owned.find((actor: { id: number }) => actor.id === 52).hp, 728);
  assert.equal(saved.deaths, input.deaths);
  assert.equal(saved.purchases, input.purchases);
  assert.equal(saved.spent, input.spent);
  const events = readFileSync(`${directory}/journal.jsonl`, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const finished = events.find(event => event.kind === "saved-queue-finished");
  assert.deepEqual(finished.data.destination, { x: 21, y: 20 });
  const commands = events.filter(event => event.kind === "command");
  assert.equal(commands.length, saved.commands - input.commands);
  for (const event of commands) {
    assert.ok(event.tick >= finished.tick);
    assert.equal(event.data.mode, "move");
    assert.equal(event.data.purpose, "source-trip17");
  }
  const decisions = events.filter(event => event.kind === "visible-route-decision");
  assert.ok(decisions.some(event => new Set(event.data.options.map((option: { goal: unknown }) => JSON.stringify(option.goal))).size > 1));
  assert.ok(decisions.every(event => !event.data.chosen ||
    !(event.data.chosen.goal.x === 85 && event.data.chosen.goal.y === 44)));
  assert.equal(existsSync(`${directory}/pending-win.json`), false);
  assert.equal(existsSync(`${directory}/proof.json`), false);
  assert.equal(integrity.resumeUnchanged, true);
  assert.equal(integrity.resumeHash, sha256(readFileSync(integrity.resume)));
  assert.deepEqual(integrity.changed, []);
  assert.deepEqual(integrity.changedAssets, []);
  assert.equal(exit.expired, false);
  assert.equal(exit.reaped, true);
  for (const pid of [exit.childPid, exit.parentPid]) assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

const recoveryOutput = process.env.DC_M05_RECOVERY_ARTIFACTS;
for (const faction of ["human", "alien"] as const) {
  test(`mission05 actual artifacts: ${faction} source goals, statistics, fingerprints and reaping`, { skip: !recoveryOutput }, () => {
    const directory = `${recoveryOutput}/${faction}`;
    const read = (name: string) => JSON.parse(readFileSync(`${directory}/${name}.json`, "utf8"));
    const result = read("result"), saved = read("checkpoint"), source = read("source");
    const integrity = read("integrity"), exit = read("exit"), rejected = read("resume-rejected");
    const world = saved.view.session.state.world;
    assert.equal(result.status, "HARNESS_LIMIT");
    assert.equal(result.freshFallback, true);
    assert.equal(result.startTick, 0);
    assert.equal(result.outcome, null);
    assert.equal(saved.view.state.diagnostic, null);
    assert.deepEqual(result.statistics, world.statistics);
    assert.deepEqual(result.buildingSlots, world.buildingSlots);
    assert.deepEqual(result.fired, saved.fired);
    assert.equal(result.tick, saved.view.simulation.tick);
    assert.equal(result.checkpointHash, sha256(JSON.stringify(saved.view)));
    assert.equal(result.sourceHash, source.sourceHash);
    assert.equal(existsSync(`${directory}/pending-win.json`), false);
    assert.equal(existsSync(`${directory}/proof.json`), false);
    if (faction === "human") {
      assert.equal(world.statistics["0,0,69"], 1);
      assert.ok(result.fired.includes(14));
      assert.equal(result.fired.includes(15), false);
      assert.ok([1, 2].every(team => world.buildingSlots[`${team},0`] > 0));
    } else {
      assert.equal(world.statistics["0,0,73"], 0);
      for (const id of [17, 18, 19]) assert.equal(result.fired.includes(id), false);
      assert.ok(result.owned.some((actor: { type: number; hp: number }) => actor.type === 73 && actor.hp > 0));
    }
    assert.equal(rejected.status, "UNRECOVERABLE_WITHOUT_VALIDATED_MIGRATION");
    assert.match(rejected.diagnostic, /checkpoint differs from complete source caller replay/);
    assert.equal(rejected.tick, faction === "human" ? 1000 : 2000);
    assert.deepEqual(integrity.changed, []);
    assert.deepEqual(integrity.changedAssets, []);
    assert.deepEqual(integrity.before, integrity.after);
    assert.equal(integrity.resumeUnchanged, true);
    assert.equal(integrity.resumeHash, sha256(readFileSync(integrity.resume)));
    for (const [path, hash] of Object.entries(integrity.after)) {
      assert.equal(sha256(readFileSync(new URL(`../../${path}`, import.meta.url))), hash, path);
    }
    for (const [path, hash] of Object.entries(integrity.fetched)) {
      assert.equal(sha256(readFileSync(new URL(`../../public${path}`, import.meta.url))), hash, path);
    }
    const batch = JSON.parse(readFileSync(`${recoveryOutput}/batch.json`, "utf8"));
    assert.deepEqual(batch.before, batch.after);
    for (const input of Object.values(batch.after) as { path: string; sha256: string }[]) {
      assert.equal(sha256(readFileSync(input.path)), input.sha256);
    }
    assert.equal(exit.expired, false);
    assert.equal(exit.reaped, true);
    assert.equal(exit.signal, null);
    assert.ok(exit.totalMs < 1200000);
    for (const pid of [exit.childPid, exit.parentPid]) {
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    }
  });
}
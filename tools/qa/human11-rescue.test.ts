import assert from "node:assert/strict";
import test from "node:test";
import { rescueContract, limits, permittedAttack, runtimeHashes, combatDistance, compatibleDamage, rangeAdvantageRetreat, acceptedWin, selectChamberRunner, rescueStage, rescueRole, replayPublicOrder, boundedWorkerOptions } from "./human11-rescue";
import { spawnSync } from "node:child_process";
import { hash } from "./campaign-10-12";
import { areHostile } from "../../src/engine/diplomacy";
import { evaluateTriggerCondition, recordTriggerVictimLoss, tripForReservedMtgDestination } from "../../src/engine/trigger-runtime";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { priorRunnerDanger, verifiedWaypoint, resumeLimits, fightEstimate } from "./human11-rescue";
import { NavigationGrid } from "../../src/engine/grid";

test("H11 tactical: actual REAP can survive the visible type8 bottleneck exchange", () => {
  const weapon = (coefficients: number[], rangeCells: number) => ({ damage: 100, rangeCells, cooldownTicks: 15,
    sourceDamage: { coefficients, callerFactor: 256, specialFlag: false } });
  const actor = { health: 734, attackCooldown: 0, weapon: weapon([256, 64, 0, 64, 128, 256, 25, 128, 0, 25], 2),
    sourceDefense: { targetClass: 1, armorFactor: 256 } } as Parameters<typeof fightEstimate>[0];
  const enemy = { health: 800, attackCooldown: 0, weapon: weapon([64, 30, 64, 46, 64, 230, 12, 128, 0, 12], 4),
    sourceDefense: { targetClass: 0, armorFactor: 256 } } as Parameters<typeof fightEstimate>[1];
  const estimate = fightEstimate(actor, enemy, 80);
  assert.equal(estimate.outgoing, 100);
  assert.equal(estimate.incoming, 11);
  assert.equal(estimate.volleys, 8);
  assert.equal(estimate.allowed, true);
  assert.ok(estimate.reserve > 500);
  assert.equal(fightEstimate({ ...actor, health: 200 }, enemy, 80).allowed, false);
  assert.equal(fightEstimate(actor, { ...enemy, sourceDefense: { targetClass: 8, armorFactor: 256 } }, 80).allowed, false);
});

test("H11 resume: bounded steps and engine waypoint cannot shortcut danger", () => {
  assert.equal(resumeLimits.stepMs, 180000);
  assert.equal(priorRunnerDanger({ x: 68, y: 67 }), true);
  assert.equal(priorRunnerDanger({ x: 71, y: 70 }), false);
  const grid = new NavigationGrid(5, 5);
  const path = [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 0 }];
  const unsafe = (cell: { x: number; y: number }) => cell.x === 1 && cell.y === 0;
  const waypoint = verifiedWaypoint(grid, path, unsafe)!;
  assert.ok(waypoint);
  assert.notDeepEqual(waypoint.target, path.at(-1));
  assert.ok(waypoint.actual.every(cell => !unsafe(cell)));
});

test("H11 rescue: literal source win alternatives and no scripted rescue conversion", () => {
  const source = rescueContract();
  const actions = (id: number) => source.triggers.find(block => block.id === id)!.actions;
  assert.deepEqual(actions(9).slice(0, 2).map(action => action.arguments), [[11, 0], [12, 1]]);
  assert.deepEqual(actions(11).slice(0, 2).map(action => action.arguments), [[9, 0], [13, 1]]);
  assert.equal(source.triggers.find(block => block.id === 9)!.condition, "(S==0)");
  assert.deepEqual([9, 11, 12, 13].map(id => source.triggers.find(block => block.id === id)!.flag), [1, 1, 0, 0]);
  for (const id of [12, 13]) assert.ok(actions(id).some(action => action.name === "bail" && action.arguments[0] === 0));
  assert.equal(source.triggers.find(block => block.id === 10)!.condition,
    "((s(0,0,69)==1)||(s(0,0,70)==1)||(s(0,0,71)==1)||(s(0,0,72)==1))");
  assert.ok(actions(10).some(action => action.name === "bail" && action.arguments[0] === 1 && action.arguments[1] === 2));
  assert.match(source.briefing, /under ~2ALIEN ~4control should be exterminated/);
});

test("H11 rescue: victim team counts, not killer ownership or same-faction immunity", () => {
  const result = recordTriggerVictimLoss({ "1,3": 6, "1,0,88": 6 }, 1, 88);
  assert.deepEqual(result, { ok: true, value: { "1,3": 7, "1,0,88": 7 } });
  assert.equal(areHostile({ faction: "human", team: 0 }, { faction: "human", team: 1 }, [[0, 0]]), true);
  assert.equal(permittedAttack(true, true, true, "attack"), true);
  assert.equal(permittedAttack(true, false, true, "attack"), false);
  assert.equal(permittedAttack(false, true, true, "attack"), false);
  assert.equal(permittedAttack(true, true, false, "attack"), false);
  assert.equal(permittedAttack(true, true, true, "move"), false);
});

test("H11 rescue: original MTG trip13 is a team test, not a commander test", () => {
  const source = rescueContract();
  const tags = readFileSync(new URL("../../raw_cd/DC/SCENARIO/HUMAN/HUMAN11.MTG", import.meta.url));
  for (const cell of source.trips[13]) assert.deepEqual(
    tripForReservedMtgDestination(tags.subarray(2), tags[0], tags[1], cell.x, cell.y, 0),
    { ok: true, value: { kind: "trip", triggerId: 13, team: 0 } });
  assert.deepEqual(limits, { playMs: 240000, proofMs: 600000, totalMs: 1070000 });
});

test("H11 rescue: S checks team independently of ordinary or commander type", () => {
  for (const unitType of [0, 2, 69]) {
    const inputs = { cycleCounter: 0, clockMilliseconds: 0, buildingSlots: {}, triggeringUnitType: unitType };
    assert.deepEqual(evaluateTriggerCondition("(S==0)", {}, inputs, 0), { ok: true, value: 1 });
    assert.deepEqual(evaluateTriggerCondition("(S==0)", {}, inputs, 1), { ok: true, value: 0 });
  }
});

test("H11 rescue: stationary source range is Manhattan, zero damage is excluded, kiting requires advantage", () => {
  assert.equal(combatDistance({ x: 0, y: 0 }, { x: 3, y: 4 }), 7);
  assert.equal(compatibleDamage([[100, 0]], 0, 0), true);
  assert.equal(compatibleDamage([[100, 0]], 0, 1), false);
  assert.equal(compatibleDamage([[100]], undefined, 0), false);
  assert.equal(rangeAdvantageRetreat(6, 4, 5, 640), true);
  assert.equal(rangeAdvantageRetreat(2, 4, 3, 640), false);
  assert.equal(rangeAdvantageRetreat(6, 4, 6, 640), false);
});

test("H11 rescue: only exact pending-to-ready WIN is accepted", () => {
  assert.equal(acceptedWin({ status: "BOUNDED_NO_WIN" }), false);
  assert.equal(acceptedWin({ status: "READY_WIN_UNVERIFIED" }), false);
  const proof = { status: "WIN", commanderAlive: true, exactPending: true, exactReady: true, expectedHash: "same", actualHash: "same" };
  const result = { status: "READY_WIN_UNVERIFIED", commanderAlive: true };
  assert.equal(acceptedWin(result, proof), true);
  assert.equal(acceptedWin(result, { ...proof, actualHash: "different" }), false);
  assert.equal(acceptedWin({ ...result, commanderAlive: false }, proof), false);
  assert.equal(acceptedWin(result, { ...proof, commanderAlive: false }), false);
  assert.equal(acceptedWin({ status: "SOURCE_LOSS" }, proof), false);
});

test("H11 rescue: healthy ordinary infantry scouts first; commander never becomes extraction runner", () => {
  const actors = [
    { id: 1, type: 69, health: 800, activity: "idle" },
    { id: 2, type: 0, health: 400, activity: "idle" },
    { id: 3, type: 0, health: 800, activity: "idle" },
    { id: 4, type: 2, health: 800, activity: "idle" },
  ];
  assert.equal(selectChamberRunner(actors, 1), 3);
  assert.equal(selectChamberRunner(actors.filter(actor => actor.id !== 3), 1), 2);
  assert.equal(selectChamberRunner(actors.filter(actor => actor.type !== 0), 1), 4);
  assert.equal(selectChamberRunner([actors[0], { ...actors[2], health: 0 }, { ...actors[3], activity: "die" }], 1), undefined);
});

test("H11 rescue: source gate order changes only runner route and always protects pending commander", () => {
  assert.equal(rescueStage(0, new Set(), false), "early-trip9");
  assert.equal(rescueStage(6, new Set([9]), false), "finish-TORT");
  assert.equal(rescueStage(7, new Set([9, 12]), false), "protect-complete");
  assert.equal(rescueStage(7, new Set([11]), false), "ordinary-trip13");
  assert.equal(rescueStage(7, new Set([11, 13]), true), "protect-pending");
  assert.equal(rescueStage(7, new Set([9, 12]), true), "protect-pending");
  const actions: unknown[] = [];
  replayPublicOrder({ replaceSelection(ids) { actions.push(ids); }, stopSelected() { actions.push("stop"); } },
    { kind: "stop", tick: 5000, id: 1 });
  assert.deepEqual(actions, [[1], "stop"]);
});

test("H11 rescue: protected role takes priority over combat and never extracts the commander", () => {
  const commanderId = 1, runnerId = 2;
  for (const stage of ["early-trip9", "ordinary-trip13", "finish-TORT", "protect-complete", "protect-pending"] as const) {
    assert.notEqual(rescueRole(commanderId, commanderId, runnerId, stage), "runner");
    assert.notEqual(rescueRole(commanderId, commanderId, commanderId, stage), "runner");
  }
  assert.equal(rescueRole(commanderId, commanderId, runnerId, "early-trip9"), "assault");
  assert.equal(rescueRole(runnerId, commanderId, runnerId, "early-trip9"), "runner");
  assert.equal(rescueRole(runnerId, commanderId, runnerId, "ordinary-trip13"), "runner");
  assert.equal(rescueRole(runnerId, commanderId, runnerId, "finish-TORT"), "guard");
  for (const id of [1, 2, 3, 4, 5, 6]) assert.equal(rescueRole(id, commanderId, runnerId, "protect-pending"), "guard");
  assert.equal(rescueRole(commanderId, commanderId, runnerId, "ordinary-trip13"), "guard");
  assert.equal(rescueRole(commanderId, commanderId, undefined, "ordinary-trip13"), "guard");
});

test("H11 rescue: bounded worker really gets its own process group", () => {
  const options = boundedWorkerOptions(1, 10000);
  assert.equal(options.timeout, 10000); assert.equal(options.killSignal, "SIGKILL");
  const probe = spawnSync(process.execPath, ["-e",
    'const {execFileSync}=require("node:child_process");console.log(JSON.stringify({pid:process.pid,group:Number(execFileSync("ps",["-o","pgid=","-p",String(process.pid)],{encoding:"utf8"}).trim())}));'],
  { ...options, stdio: "pipe", encoding: "utf8" });
  assert.equal(probe.status, 0, probe.stderr);
  const identity = JSON.parse(probe.stdout);
  assert.equal(identity.group, identity.pid);
});

const artifacts = process.env.DC_H11_RESCUE_ARTIFACTS;
const resumedArtifacts = process.env.DC_H11_RESUME_ARTIFACTS;
if (resumedArtifacts) {
  const json = (name: string) => JSON.parse(readFileSync(`${resumedArtifacts}/${name}.json`, "utf8"));
  test("H11 resumed actual: calculated fights preserve visible-hostile and commander guards", () => {
    const initial = json("initial"), result = json("result"), checkpoint = json("checkpoint");
    const entries = readFileSync(`${resumedArtifacts}/journal.jsonl`, "utf8").trim().split("\n").map(line => JSON.parse(line));
    for (const entry of entries.filter(entry => entry.kind === "calculated-fight")) {
      assert.notEqual(entry.data.id, initial.commander);
      assert.equal(entry.data.allowed, true);
      assert.ok(entry.data.reserve >= 150);
      assert.ok(entry.data.outgoing > 0 && entry.data.incoming > 0);
      assert.ok(initial.squad.includes(entry.data.id));
    }
    for (const entry of entries.filter(entry => entry.kind === "command")) {
      if (entry.data.mode === "assault") {
        assert.notEqual(entry.data.id, initial.commander);
        assert.ok(permittedAttack(entry.data.owned, entry.data.visible, entry.data.hostile, entry.data.cursor));
      }
    }
    const commander = checkpoint.view.simulation.units.find((actor: { id: number }) => actor.id === initial.commander);
    assert.equal(commander.health, result.commander.health);
    assert.equal(checkpoint.view.simulation.tick, result.tick);
    const damage = entries.filter(entry => entry.kind === "damage");
    assert.ok(damage.every(entry => entry.data.damage >= 0));
    assert.ok(!damage.some(entry => entry.data.targetId === initial.commander));
  });
  test("H11 resumed actual: full initial authentication and untouched original checkpoint", () => {
    const resume = json("resume"), result = json("result"), checkpoint = json("checkpoint");
    assert.equal(resume.exactInitial, true);
    assert.equal(resume.tick, JSON.parse(readFileSync(resume.path, "utf8")).view.simulation.tick);
    assert.equal(hash(readFileSync(resume.path)), resume.checkpointHash);
    assert.equal(checkpoint.sourceHash, resume.sourceHash);
    assert.equal(checkpoint.view.simulation.tick, result.tick);
    assert.equal(result.statistics["1,3"], 7);
    assert.equal(result.commanderAlive, true);
    assert.ok(result.stepMs <= resumeLimits.stepMs);
    assert.equal(result.diagnostic, undefined);
  });
  test("H11 resumed actual: source WIN requires exact proof and every worker is reaped", () => {
    const run = json("run"), integrity = json("integrity");
    assert.equal(run.pass, acceptedWin(run.result, run.proof));
    assert.deepEqual(integrity.changed, []);
    assert.deepEqual(integrity.changedAssets, []);
    assert.deepEqual(integrity.originalBefore, integrity.originalAfter);
    for (const receipt of run.receipts) {
      assert.equal(receipt.code, 0);
      assert.equal(receipt.signal, null);
      assert.throws(() => process.kill(receipt.pid, 0), { code: "ESRCH" });
    }
    if (run.pass) {
      assert.equal(run.result.outcome.resultCode, 0);
      assert.equal(run.result.outcome.ready, true);
      assert.ok(run.result.fired.includes(13));
      assert.equal(run.proof.tick - run.proof.fromTick, 201);
    }
  });
  test("H11 resumed actual: ordinary runner uses recorded verified public waypoints", () => {
    const initial = json("initial"), result = json("result");
    const entries = readFileSync(`${resumedArtifacts}/journal.jsonl`, "utf8").trim().split("\n").map(line => JSON.parse(line));
    const waypoints = entries.filter(entry => entry.kind === "verified-waypoint");
    assert.ok(waypoints.length > 0);
    for (const entry of waypoints) {
      assert.notEqual(entry.data.id, initial.commander);
      assert.ok(initial.known.some((actor: { id: number; type: number; team: number }) =>
        actor.id === entry.data.id && actor.team === 0 && [0, 2].includes(actor.type)));
      assert.ok(entry.data.actual.length > 1);
    }
    assert.equal(entries.filter(entry => entry.kind === "command").length, result.commands);
    assert.ok(!entries.some(entry => entry.kind === "death" && entry.data.targetId === initial.commander));
    const pending = entries.find(entry => entry.kind === "pending-win");
    const orders = json("post-pending-orders");
    assert.equal(orders.length, pending ? entries.filter(entry => entry.tick >= pending.tick &&
      ["command", "blocked-command", "public-stop"].includes(entry.kind)).length : 0);
  });
}
if (artifacts) {
  const json = (name: string) => JSON.parse(readFileSync(`${artifacts}/${name}.json`, "utf8"));
  const journal = () => readFileSync(`${artifacts}/journal.jsonl`, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const revised = json("initial").squad.includes(json("initial").commander);
  const protectedStrategy = json("result").strategy === "early-chamber-protected-commander";

  test("H11 actual: chamber runner is ordinary and commander protection precedes combat after seven kills", () => {
    if (!protectedStrategy) return;
    const initial = json("initial"), result = json("result"), entries = journal();
    const extraction = entries.filter(entry => entry.kind === "command" && /source-trip(9|13)$/.test(entry.data.purpose));
    assert.ok(extraction.length > 0);
    assert.equal(extraction[0].data.purpose, "ordinary-troop-source-trip9");
    for (const entry of extraction) {
      assert.notEqual(entry.data.id, initial.commander);
      assert.ok(initial.known.some((actor: { id: number; type: number; team: number }) =>
        actor.id === entry.data.id && actor.team === 0 && [0, 2].includes(actor.type)));
    }
    const seven = entries.find(entry => entry.kind === "seven-kills-checkpoint");
    if (seven) {
      assert.equal(json("seven-kills").view.simulation.tick, seven.tick);
      for (const entry of entries.filter(entry => entry.tick >= seven.tick && entry.data.id === initial.commander && entry.kind === "command")) {
        assert.equal(entry.data.mode, "move"); assert.equal(entry.data.purpose, "protected-force-retreat");
      }
      assert.ok(entries.some(entry => entry.tick >= seven.tick && entry.data.id === initial.commander &&
        (entry.data.purpose === "commander-safe-guard" || entry.data.purpose === "protected-force-retreat")));
    }
    const pending = entries.find(entry => entry.kind === "pending-win");
    const replay = json("post-pending-orders");
    if (pending) {
      assert.ok(replay.length > 0);
      for (const order of replay) assert.ok(order.tick >= pending.tick && order.tick < result.tick);
      const recorded = entries.filter(entry => entry.tick >= pending.tick && ["command", "blocked-command", "public-stop"].includes(entry.kind));
      assert.equal(replay.length, recorded.length);
      for (const [index, order] of replay.entries()) {
        assert.equal(order.tick, recorded[index].tick); assert.equal(order.id, recorded[index].data.id);
      }
    } else assert.deepEqual(replay, []);
    if (result.commanderAlive) assert.ok(result.commander.health > 0);
  });

  test("H11 actual: original roster, colors, AI and all seven reachable TORT", () => {
    const source = json("source"), initial = json("initial");
    assert.deepEqual(source.sources, rescueContract().sources);
    assert.deepEqual(source.triggers, rescueContract().triggers);
    assert.deepEqual(source.scenario.teams.slice(0, 4).map((team: { index: number; race: number; ai: number; teamColor: number }) =>
      [team.index, team.race, team.ai, team.teamColor]), [[0, 0, 0, 0], [1, 0, 4, 0], [2, 1, 4, 2], [3, 0, 0, 0]]);
    assert.deepEqual(initial.known.filter((actor: { team: number }) => actor.team === 0)
      .map((actor: { type: number }) => actor.type), [69, 0, 0, 2, 2, 2]);
    assert.equal(source.scenario.teams[0].money, 0);
    assert.equal(initial.known.filter((actor: { team: number; type: number }) => actor.team === 3 && actor.type === 0).length, 11);
    assert.equal(initial.connectivity.length, 7);
    for (const victim of initial.connectivity) {
      assert.equal(victim.type, 88); assert.equal(victim.health, 5); assert.equal(victim.reachable.length, revised ? 6 : 5);
      assert.ok(victim.reachable.every((route: { pathLength: number }) => route.pathLength > 0));
    }
    assert.ok(initial.simulation.units.filter((actor: { team: number }) => actor.team === 0)
      .every((actor: { movementPlane: string }) => actor.movementPlane === "ground"));
    assert.equal(initial.simulation.teamAlliances[0][1], 0);
    assert.equal(initial.simulation.teamAlliances[3][0], 1);
  });

  test("H11 actual: public orders never target unowned or hidden actors", context => {
    const initial = json("initial"), result = json("result");
    const orders = journal().filter(entry => entry.kind === "command");
    assert.equal(orders.length, result.commands); assert.ok(orders.length > 0);
    for (const entry of orders) {
      const order = entry.data;
      assert.ok(initial.squad.includes(order.id));
      if (!revised) assert.notEqual(order.id, initial.commander);
      if (order.mode === "assault") {
        assert.ok([1, 2].includes(order.targetTeam));
        assert.ok(permittedAttack(order.owned, order.visible, order.hostile, order.cursor));
      } else assert.equal(order.mode, "move");
    }
    assert.equal(journal().filter(entry => entry.kind === "commander-home-stop").length, revised ? 0 : 1);
    if (revised) assert.ok(orders.some(entry => entry.data.id === initial.commander));
    context.diagnostic(JSON.stringify({ commands: orders.length, targetedAttacks: orders.filter(entry => entry.data.mode === "assault").length,
      targetedTortAttacks: orders.filter(entry => entry.data.targetTeam === 1).length }));
  });

  test("H11 actual: result is backed by checkpoint and exact WIN acceptance, never partial rescue", () => {
    const result = json("result"), checkpoint = json("checkpoint"), initial = json("initial");
    if (revised) {
      const run = json("run");
      assert.equal(checkpoint.sourceHash, result.sourceHash);
      assert.equal(checkpoint.view.simulation.tick, result.tick);
      assert.equal(run.pass, acceptedWin(result, run.proof));
      assert.equal(result.diagnostic, undefined);
      if (run.pass) {
        assert.equal(result.statistics["1,3"], 7);
        assert.equal(result.outcome.ready, true); assert.equal(result.outcome.resultCode, 0);
        assert.ok(result.fired.includes(12) || result.fired.includes(13));
        assert.equal(result.commanderAlive, true);
        assert.equal(run.proof.commanderAlive, true);
      } else {
        assert.notEqual(result.status, "WIN");
        if (result.status === "SOURCE_LOSS" && !protectedStrategy) {
          assert.equal(result.outcome.ready, true); assert.equal(result.outcome.resultCode, 1);
          assert.equal(existsSync(`${artifacts}/proof-result.json`), false);
          assert.equal(existsSync(`${artifacts}/pending-win.json`), false);
          assert.equal(result.statistics["1,3"], 7);
          assert.equal(result.statistics["0,0,69"], 1);
          assert.ok(result.fired.includes(11)); assert.ok(result.fired.includes(10));
          assert.equal(result.fired.includes(13), false);
          const deaths = journal().filter(entry => entry.kind === "death");
          assert.equal(deaths.filter(entry => entry.data.actor?.team === 1).length, 7);
          assert.ok(deaths.some(entry => entry.data.targetId === initial.commander && entry.tick === 7251));
        }
      }
      return;
    }
    assert.equal(result.status, "BOUNDED_NO_WIN"); assert.equal(result.outcome, null); assert.equal(result.diagnostic, undefined);
    assert.equal(result.tick, 5584); assert.equal(result.shots, 239); assert.equal(result.deaths, 15);
    assert.equal(result.statistics["1,3"], 3); assert.equal(result.statistics["1,0,88"], 3);
    assert.equal(result.statistics["3,3"], 0); assert.equal(result.statistics["0,3"], 5);
    assert.equal(result.statistics["2,3"], 7);
    assert.equal(result.commander.id, initial.commander); assert.equal(result.commander.health, 800);
    assert.deepEqual([result.commander.cellX, result.commander.cellY], [150, 27]);
    assert.ok(result.squad.every((actor: { health: number }) => actor.health === 0));
    assert.equal(result.remainingVictims.filter((actor: { health: number }) => actor.health > 0).length, 4);
    assert.deepEqual(result.routeFailures, []); assert.deepEqual(result.fired, [1, 2]);
    assert.equal(checkpoint.sourceHash, result.sourceHash); assert.equal(checkpoint.view.simulation.tick, result.tick);
    assert.equal(existsSync(`${artifacts}/pending-win.json`), false); assert.equal(existsSync(`${artifacts}/proof-result.json`), false);
  });

  test("H11 actual: single bounded worker is reaped and end revision recorded without a stable-current claim", context => {
    const run = json("run"), exit = json("play-exit"), integrity = json("integrity"), beforeSpawn = json("play-before-spawn");
    assert.equal(run.receipts.length, existsSync(`${artifacts}/proof-exit.json`) ? 2 : 1);
    assert.equal(exit.budget, revised ? limits.playMs : 180000);
    assert.equal(exit.code, 0); assert.equal(exit.signal, null); assert.ok(exit.elapsedMs <= exit.budget);
    for (const receipt of run.receipts) assert.throws(() => process.kill(receipt.pid, 0), { code: "ESRCH" });
    assert.deepEqual(beforeSpawn, integrity.before); assert.deepEqual(integrity.changed, []);
    assert.deepEqual(integrity.changedAssets, []); assert.deepEqual(integrity.originalBefore, integrity.originalAfter);
    const current = runtimeHashes();
    const changedSincePlay = Object.keys(current).filter(path => current[path] !== integrity.before[path]);
    const currentAssets = Object.keys(integrity.fetched).filter(path =>
      hash(readFileSync(new URL(`../../public${path}`, import.meta.url))) !== integrity.fetched[path]);
    const revision = { recordedAt: new Date().toISOString(), loadedWindowManifestSha256: hash(JSON.stringify(integrity.before)),
      endManifestSha256: hash(JSON.stringify(current)), changedSincePlay, currentAssets, current,
      originalCurrent: rescueContract().sources };
    writeFileSync(`${artifacts}/end-revision.json`, JSON.stringify(revision, null, 2));
    context.diagnostic(JSON.stringify({ loadedWindowManifestSha256: revision.loadedWindowManifestSha256,
      endManifestSha256: revision.endManifestSha256, changedSincePlay, currentAssets }));
  });
}
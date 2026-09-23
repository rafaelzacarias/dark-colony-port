import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { NavigationGrid } from "../../src/engine/grid";
import { mission03TripCells } from "./mission03-playthrough";
import { rescueFiringRoute, rescueFrontier, rescueJournalUpdates, rescuePathSafe, rescueProgress, rescueRemainingPath, rescueRetainedWaypoint, rescueRoute, rescueStage, rescueWinningFight } from "./alien05-rescue-route";
import { findPath } from "../../src/engine/pathfinding";

test("AL05 rescue: queued path checks only remaining cells without reissuing movement", () => {
  const path = [{ x: 26, y: 16 }, { x: 27, y: 16 }, { x: 28, y: 16 }];
  assert.deepEqual(rescueRemainingPath(path, { x: 27, y: 16 }), [{ x: 28, y: 16 }]);
  assert.deepEqual(rescueRemainingPath(path, { x: 28, y: 16 }), []);
  assert.deepEqual(rescueRemainingPath([{ x: 26, y: 16 }], { x: 26, y: 16 }), []);
});

test("AL05 rescue: oscillation stops after 200 ticks without net advance or combat", () => {
  const previous = { stage: "north-east-passage", best: 18, tick: 14225 };
  assert.equal(rescueProgress(previous, previous.stage, 19, 14425, false).stalled, true);
  assert.equal(rescueProgress(previous, previous.stage, 17, 14425, false).stalled, false);
  assert.equal(rescueProgress(previous, previous.stage, 19, 14425, true).stalled, false);
  assert.equal(rescueProgress(previous, "support-trip8", 19, 14425, false).stalled, false);
});

test("AL05 rescue: consumed support survives journal rollover and chooses next waypoint", () => {
  const lives = { 2: 0, 8: 1, 10: 1, 17: 1, 18: 0 };
  assert.equal(rescueStage(lives, false), "support-trip8");
  const route = rescueRoute(new NavigationGrid(112, 96), { x: 26, y: 16 },
    [{ x: 44, y: 16 }], new Set(), [], true);
  assert.ok(route);
  assert.deepEqual(route.waypoint, { x: 38, y: 16 });
  assert.equal(rescueStage({ ...lives, 8: 0, 10: 0 }, false), "rescue-trip17");
  assert.equal(rescueStage({ ...lives, 8: 0, 10: 0, 17: 0 }, false), "extraction-trip18");
});

test("AL05 rescue: actual saved terrain admits source support waypoint, not invented northeast band",
  { skip: !process.env.DC_AL05_RESCUE_INPUT }, () => {
    const saved = JSON.parse(readFileSync(process.env.DC_AL05_RESCUE_INPUT!, "utf8"));
    assert.equal(saved.view.simulation.tick, 14225);
    assert.equal(rescueStage(saved.view.session.state.controller.runtime.lives, false), "support-trip8");
    const terrain = saved.view.simulation.grid;
    const grid = new NavigationGrid(terrain.width, terrain.height, Uint16Array.from(terrain.costs));
    const mtg = readFileSync(new URL("../../raw_cd/DC/SCENARIO/ALIEN/ALIEN05.MTG", import.meta.url));
    const goals = mission03TripCells(mtg.subarray(2), mtg[0], mtg[1], 8);
    const route = rescueRoute(grid, { x: 26, y: 16 }, goals, new Set(), []);
    assert.ok(route);
    assert.deepEqual(route.goal, { x: 49, y: 30 });
    assert.deepEqual(route.waypoint, { x: 29, y: 25 });
    assert.ok(route.publicPath.every(cell => grid.isPassable(cell.x, cell.y)));
    const northeast = Array.from({ length: 65 }, (_, index) => ({ x: 44 + index % 5, y: 12 + Math.floor(index / 5) }));
    assert.ok(northeast.every(cell => !grid.isPassable(cell.x, cell.y)));
  });

test("AL05 rescue: escape cannot approach a visible threat", () => {
  const threats = [{ id: 7, x: 30, y: 21, range: 6 }];
  assert.equal(rescuePathSafe({ x: 25, y: 20 }, [{ x: 25, y: 19 }], threats), true);
  assert.equal(rescuePathSafe({ x: 25, y: 20 }, [{ x: 26, y: 20 }], threats), false);
});

test("AL05 rescue: soft threat costs retain a safe approach when the final corridor is guarded", () => {
  const grid = new NavigationGrid(30, 1);
  const route = rescueRoute(grid, { x: 0, y: 0 }, [{ x: 29, y: 0 }], new Set(),
    [{ id: 1, x: 25, y: 0, range: 4 }]);
  assert.ok(route);
  assert.deepEqual(route.waypoint, { x: 12, y: 0 });
  assert.ok(rescuePathSafe({ x: 0, y: 0 }, route.publicPath, [{ id: 1, x: 25, y: 0, range: 4 }]));
});

test("AL05 rescue: public waypoints stay north of visible arcs and failed southern approach", () => {
  const grid = new NavigationGrid(100, 100);
  const threats = [{ id: 7, x: 30, y: 22, range: 2 }, { id: 9, x: 16, y: 20, range: 4 }];
  const route = rescueRoute(grid, { x: 25, y: 20 }, [{ x: 45, y: 16 }], new Set(), threats, true);
  assert.ok(route);
  assert.ok(rescuePathSafe({ x: 25, y: 20 }, route.publicPath, threats));
  assert.ok(route.path.every(cell => cell.x >= 40 || cell.y <= 28));
});

test("AL05 rescue: approach stops before a sealed visible arc", () => {
  const grid = new NavigationGrid(12, 1);
  const route = rescueRoute(grid, { x: 0, y: 0 }, [{ x: 11, y: 0 }], new Set(),
    [{ id: 1, x: 5, y: 0, range: 2 }]);
  assert.deepEqual(route?.waypoint, { x: 2, y: 0 });
  assert.equal(rescueRoute(grid, { x: 2, y: 0 }, [{ x: 11, y: 0 }], new Set(),
    [{ id: 1, x: 5, y: 0, range: 2 }]), undefined);
});

test("AL05 rescue: assault requires damage and surviving health reserve", () => {
  assert.equal(rescueWinningFight(728, 400, 160, 1, 15), true);
  assert.equal(rescueWinningFight(728, 400, 0, 1, 15), false);
  assert.equal(rescueWinningFight(250, 800, 20, 3, 15), false);
});

test("AL05 rescue: frontier exhausts reachable cells and reports ranged firing positions", () => {
  const grid = new NavigationGrid(12, 1);
  const report = rescueFrontier(grid, { x: 0, y: 0 }, [{ x: 11, y: 0 }], new Set(),
    [{ id: 1, x: 5, y: 0, range: 2 }], 6);
  assert.equal(report.safe.cells.length, 3);
  assert.equal(report.terrain.cells.length, 12);
  assert.deepEqual(report.safe.frontier[0], { cell: { x: 3, y: 0 }, reasons: ["visible-range"], threats: [1] });
  assert.equal(report.sightlines[0].firingCells.length, 3);
});

test("AL05 rescue: newly visible threats truncate the intended route instead of reversing it", () => {
  const grid = new NavigationGrid(50, 50), start = { x: 23, y: 33 };
  const path = [{ x: 23, y: 34 }, { x: 23, y: 35 }, { x: 23, y: 36 }, { x: 23, y: 37 }];
  const threats = [{ id: 27, x: 23, y: 41, range: 4 }];
  const retained = rescueRetainedWaypoint(grid, start, path, new Set(), threats);
  assert.deepEqual(retained?.waypoint, { x: 23, y: 36 });
  assert.deepEqual(retained?.publicPath, findPath(grid, start, { x: 23, y: 36 }));
  assert.equal(rescuePathSafe(start, path, threats), false);
  assert.ok(rescuePathSafe(start, retained!.publicPath, threats));
});

test("AL05 rescue: close-range pressure finds a legal range-six retreat without advancing into the threat", () => {
  const grid = new NavigationGrid(50, 50), start = { x: 25, y: 37 };
  const threats = [{ id: 27, x: 23, y: 38.94921875, range: 4 }, { id: 26, x: 22, y: 40, range: 4 }];
  const retreat = rescueFiringRoute(grid, start, new Set(), threats, 6);
  assert.ok(retreat);
  assert.ok(rescuePathSafe(start, retreat.publicPath, threats));
  assert.ok(threats.every(threat => Math.abs(retreat.goal.x - threat.x) + Math.abs(retreat.goal.y - threat.y) >= 5.25));
});

test("AL05 rescue: fractional commander clearance cannot reissue a rejected cell-rounded waypoint", () => {
  const grid = new NavigationGrid(50, 50), start = { x: 23, y: 36 }, actual = { x: 23.16796875, y: 36 };
  const threats = [{ id: 25, x: 23, y: 44, range: 12 }];
  const route = rescueRoute(grid, start, [{ x: 25, y: 38 }], new Set(), threats, false, new Set(), actual);
  assert.ok(route);
  assert.notDeepEqual(route.waypoint, { x: 25, y: 38 });
  assert.ok(rescuePathSafe(actual, route.publicPath.slice(1), threats));
});

test("AL05 rescue: actual forward-only chain preserves sources, budgets, stops and damage evidence",
  { skip: !process.env.DC_AL05_RESCUE_CHAIN }, () => {
    const prefix = process.env.DC_AL05_RESCUE_CHAIN!;
    const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
    let priorCheckpoint: string | undefined, initialMs = 0, playMs = 0;
    for (const suffix of ["d01", "d02", "d03"]) {
      const directory = `${prefix}-${suffix}`;
      const load = (name: string) => JSON.parse(readFileSync(`${directory}/${name}.json`, "utf8"));
      const source = load("source"), integrity = load("integrity"), result = load("result"), exit = load("exit");
      assert.equal(source.originalInputHash, hash(readFileSync(source.inputPath)));
      if (priorCheckpoint) assert.equal(source.inputPath, priorCheckpoint);
      assert.equal(load("initial-restore").exact, true);
      assert.equal(load("initialized-restore").exact, true);
      assert.deepEqual(integrity.changed, []);
      assert.deepEqual(integrity.changedAssets, []);
      assert.equal(integrity.inputUnchanged, true);
      assert.equal(exit.reaped, true); assert.equal(exit.expired, false); assert.equal(exit.code, 0);
      initialMs += result.initialMs; playMs += result.steppingMs;
      const events = readFileSync(`${directory}/journal.jsonl`, "utf8").trim().split("\n").map(line => JSON.parse(line));
      assert.ok(events.filter(event => event.kind === "command" || event.kind === "stop")
        .every(event => event.data.actorId === 52));
      if (suffix === "d01") {
        const first = events.find(event => event.kind === "stop" || event.kind === "command");
        assert.equal(first.kind, "stop"); assert.equal(first.tick, 14370);
      }
      if (suffix === "d03") {
        const saved = load("checkpoint");
        assert.equal(result.tick, 16629); assert.equal(result.commander.health, 257);
        assert.equal(result.outcome, null); assert.equal(result.diagnostic, null);
        assert.equal(result.lives[8], 1);
        assert.equal(events.filter(event => event.kind === "commander-shot").length, 46);
        assert.ok(saved.view.simulation.commands.some((entry: { command: { type: string } }) => entry.command.type === "stop"));
        assert.ok(load("reachable-frontier").terrain.cells.length > 0);
      }
      priorCheckpoint = `${directory}/checkpoint.json`;
    }
    assert.ok(initialMs < 500000); assert.ok(playMs < 300000);
  });

test("AL05 rescue: current real source terrain admits a checked detour from visible hostile29",
  { skip: !process.env.DC_AL05_RESCUE_CURRENT }, () => {
    const saved = JSON.parse(readFileSync(process.env.DC_AL05_RESCUE_CURRENT!, "utf8"));
    assert.equal(saved.view.simulation.tick, 14370);
    const terrain = saved.view.simulation.grid;
    const grid = new NavigationGrid(terrain.width, terrain.height, Uint16Array.from(terrain.costs));
    const mtg = readFileSync(new URL("../../raw_cd/DC/SCENARIO/ALIEN/ALIEN05.MTG", import.meta.url));
    const goals = mission03TripCells(mtg.subarray(2), mtg[0], mtg[1], 8);
    const start = { x: 25, y: 33 }, threats = [{ id: 29, x: 25, y: 41, range: 4 }];
    const route = rescueRoute(grid, start, goals, new Set(), threats);
    assert.ok(route);
    assert.deepEqual(route.publicPath, findPath(grid, start, route.waypoint));
    assert.ok(rescuePathSafe(start, route.publicPath.slice(1), threats));
    assert.equal(rescuePathSafe(start, [{ x: 25, y: 38 }], threats), false);
  });

test("AL05 rescue: fixed-length journal rollover still observes source support trip", () => {
  const before = [{ cycleCounter: 4094, fired: [] }, { cycleCounter: 4095, fired: [] }];
  const after = [{ cycleCounter: 4095, fired: [] }, { cycleCounter: 4096, fired: [2] }];
  assert.equal(before.length, after.length);
  assert.deepEqual(rescueJournalUpdates(after, before.at(-1)!.cycleCounter), [after[1]]);
  assert.deepEqual(rescueJournalUpdates(after, 4096), []);
});

test("AL05 rescue: actual bounded attempt preserves source support and healthy final save",
  { skip: !process.env.DC_AL05_RESCUE_ARTIFACTS }, () => {
    const output = process.env.DC_AL05_RESCUE_ARTIFACTS!;
    const saved = JSON.parse(readFileSync(`${output}/checkpoint.json`, "utf8"));
    const audit = JSON.parse(readFileSync(`${output}/final-audit-a1.json`, "utf8"));
    assert.equal(saved.view.simulation.tick, 14225);
    assert.equal(saved.view.state.outcome, null);
    assert.ok(saved.view.state.diagnostic == null);
    assert.equal(saved.view.session.state.controller.runtime.lives[2], 0);
    assert.equal(saved.view.session.state.controller.runtime.lives[17], 1);
    const commander = saved.view.simulation.units.find((actor: { id: number }) => actor.id === 52);
    assert.equal(commander.health, 632);
    assert.deepEqual([commander.xSubcells, commander.ySubcells], [27052, 16896]);
    assert.equal(audit.inputUnchanged, true);
    assert.equal(audit.sourceIdentityUnchanged, true);
    assert.ok(audit.initialMs <= 100000 && audit.steppingMs <= 300000);
    assert.deepEqual(audit.runtimeChanged, []); assert.deepEqual(audit.assetsChanged, []);
    assert.deepEqual(audit.alive, []); assert.deepEqual(audit.active, []);
    assert.equal(audit.checkpointHash, createHash("sha256").update(readFileSync(`${output}/checkpoint.json`)).digest("hex"));
    assert.equal(audit.pendingExists, false);
  });

test("AL05 rescue: corrected continuation advances once and stops at newly visible hazard",
  { skip: !process.env.DC_AL05_RESCUE_CONTINUATION }, () => {
    const output = process.env.DC_AL05_RESCUE_CONTINUATION!;
    const saved = JSON.parse(readFileSync(`${output}/checkpoint.json`, "utf8"));
    const audit = JSON.parse(readFileSync(`${output}/final-audit-c03.json`, "utf8"));
    const events = readFileSync(`${output}/journal.jsonl`, "utf8").trim().split("\n").map(line => JSON.parse(line));
    const commands = events.filter(event => event.kind === "command");
    assert.deepEqual(commands.map(event => [event.tick, event.data.actorId, event.data.destination]), [
      [14230, 52, { x: 26, y: 21 }], [14260, 52, { x: 29, y: 30 }], [14330, 52, { x: 25, y: 38 }],
    ]);
    assert.equal(events.some(event => event.kind === "stop" || event.kind === "source-trigger"), false);
    assert.equal(audit.firstStageProgress.tick, 14235);
    assert.equal(audit.firstStageProgress.stage, "support-trip8");
    assert.deepEqual(audit.firstStageProgress.commander, { x: 26, y: 17 });
    assert.equal(saved.view.simulation.tick, 14370);
    assert.equal(saved.view.state.outcome, null);
    assert.ok(saved.view.state.diagnostic == null);
    assert.equal(saved.stage, "support-trip8");
    assert.deepEqual(saved.fired, [4]);
    const lives = saved.view.session.state.controller.runtime.lives;
    assert.deepEqual([lives[2], lives[8], lives[10], lives[17], lives[18], lives[19]], [0, 1, 1, 1, 0, 0]);
    const commander = saved.view.simulation.units.find((actor: { id: number }) => actor.id === 52);
    assert.equal(commander.health, 632);
    assert.deepEqual([commander.xSubcells, commander.ySubcells], [26112, 34656]);
    assert.equal(commander.activity, "move");
    assert.equal(commander.pathIndex, 8);
    assert.equal(commander.reservedDestination, 3833);
    assert.deepEqual(commander.path.at(-1), { x: 25, y: 38 });
    assert.deepEqual(audit.threats, [{ id: 29, x: 25, y: 41, range: 4 }]);
    assert.equal(audit.goals.length, 8);
    assert.equal(audit.visibleAllies.length, 12);
    assert.equal(audit.initialRestore.exact, true);
    assert.equal(audit.initializedRestore.exact, true);
    assert.equal(audit.inputUnchanged, true);
    assert.equal(audit.sourceIdentityUnchanged, true);
    assert.equal(Object.hasOwn(saved.view.session, "replayPolicy"), false);
    assert.ok(audit.initialMs < 900000 && audit.steppingMs < 300000);
    assert.deepEqual(audit.runtimeChanged, []); assert.deepEqual(audit.assetsChanged, []);
    assert.deepEqual(audit.alive, []); assert.deepEqual(audit.active, []);
    assert.equal(audit.exit.reaped, true);
    assert.equal(audit.exit.code, 0);
    assert.equal(audit.pendingExists, false);
    assert.equal(audit.finalRestoreVerified, false);
    assert.equal(audit.checkpointHash, createHash("sha256").update(readFileSync(`${output}/checkpoint.json`)).digest("hex"));
  });
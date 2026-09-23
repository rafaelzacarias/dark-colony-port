import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { beginLegacyHarvesterMovement, decodeLegacyHarvesterMovement, legacyHarvesterMotionTables, legacyHarvesterTurnDirection,
  queueLegacyHarvesterMovementStop, reduceLegacyHarvesterMovement,
  sourceLegacyHarvesterMovementWorld } from "../../src/engine/legacy-harvester-movement";
import { legacyHarvesterIdleDiagnostic } from "../../src/engine/legacy-harvester-idle";

interface Snapshot { raw: number[]; randomIndex: number; ground: number[]; pathBytes: number[];
  stack: { opcode: number; offset: number; words: number[] }[] }
interface NativeCase {
  unitType: 6 | 14; mobileSlot: number; order: number; stopAfter: number | null;
  route: { start: [number, number]; destination: [number, number]; direction: number; originQ8?: [number, number]; sourcePoint?: number[] };
  groundCells: number[]; banks: { stand: number; move: number; preservedIdle: number };
  commandBefore: Snapshot;
  motion: typeof legacyHarvesterMotionTables & { speedQ8: number; turnStep: number };
  animations: Record<number, number[][]>; runtimeInterceptions: unknown[]; randomWrites: unknown[];
  finBindings: Awaited<ReturnType<typeof sourceLegacyHarvesterMovementWorld>>["finBindings"];
  routePolicyWrites: { policy: string }[];
  visits: { update: number; boundary: string; state: Snapshot }[];
  writes: { update: number; eip: string; address: number; size: number; before: number; after: number }[];
  trace: { update: number; before: Snapshot; after: Snapshot }[];
}
const root = new URL("../../", import.meta.url);
const evidence = JSON.parse(process.env.DC_HARVESTER_DIRECTIONS_TRACE
  ? readFileSync(process.env.DC_HARVESTER_DIRECTIONS_TRACE, "utf8")
  : execFileSync("python3", [fileURLToPath(new URL("tools/qa/harvester-movement-boundary-native.py", root)), "--generalized"], {
    encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1",
      PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" } })) as { cases: NativeCase[];
        turnSweep: { typeId: number; initial: number; target: number; ticks: number[] }[] };
const pth = readFileSync(new URL("raw_cd/DC/SCENARIO/HUMAN/HUMAN02.PTH", root));
const fin = Object.fromEntries(["VENT", "EXPL", "SLUG"].map(stem => [stem,
  JSON.parse(readFileSync(new URL(`public/assets/generated/animations/${stem}.json`, root), "utf8"))])) as
  Parameters<typeof sourceLegacyHarvesterMovementWorld>[0]["fin"];

async function world(current: NativeCase) {
  const start = current.route.start, destination = current.route.destination;
  const count = Math.max(...destination.map((value, axis) => Math.abs(value - start[axis])));
  const cells = Array.from({ length: count }, (_, index) => start.map((value, axis) =>
    value + Math.sign(destination[axis] - value) * (index + 1)) as [number, number]);
  return sourceLegacyHarvesterMovementWorld({ typeId: current.unitType, pth, fin, banks: current.banks,
    route: { policy: "external-direct-straight", originQ8: current.route.originQ8 ?? start.map(value => value * 256 + 128) as [number, number], cells },
    plane: { cells: current.groundCells, tripWords: current.groundCells.map(() => 1023) },
    census: { speedQ8: current.motion.speedQ8, turnStep: current.motion.turnStep, ground: true } });
}

test("all 256 initial directions toward all eight headings, both native types", () => {
  assert.equal(evidence.turnSweep.length, 4096);
  for (const current of evidence.turnSweep) {
    let direction = current.initial;
    for (const expected of current.ticks) {
      direction = legacyHarvesterTurnDirection(direction, current.target, 10);
      assert.equal(direction, expected, JSON.stringify(current));
    }
    assert.equal(direction, current.target);
  }
});

test("actual HUMAN02 source points and random registered slots are not position hash gates", () => {
  for (const typeId of [6, 14]) {
    const cases = evidence.cases.filter(current => current.unitType === typeId && current.route.sourcePoint);
    assert.deepEqual([...new Set(cases.map(current => current.route.destination.join(",")))].sort(), ["11,68", "53,27", "69,48", "88,72"]);
    assert.ok(cases.every(current => current.mobileSlot >= 200 && current.mobileSlot < 800));
  }
});

test("route, occupancy, trips, auxiliary work and malformed payloads fail atomically", async () => {
  const current = evidence.cases.find(current => current.route.destination[0] - current.route.start[0] === 3
    && current.route.destination[1] - current.route.start[1] === 3 && current.route.direction === 0)!;
  const profile = await world(current), first = current.trace[0].before;
  const initial = decodeLegacyHarvesterMovement(first.raw, current.mobileSlot, first.randomIndex, first.ground);
  const destinationCell = current.route.destination[1] * profile.width + current.route.destination[0];
  const destinationIndex = profile.groundCells.indexOf(destinationCell);
  const blockedGround = [...initial.ground]; blockedGround[destinationIndex] = 799;
  const families = [...profile.families]; families[destinationCell] = 0;
  const trips = [...profile.tripWords]; trips[destinationIndex] = 2047;
  const rejectedWorlds = [{ ...profile, families }, { ...profile, tripWords: trips },
    { ...profile, census: { ...profile.census, speedQ8: 41 } },
    { ...profile, census: { ...profile.census, turnStep: 11 } },
    { ...profile, route: { ...profile.route, cells: [[68, 48], [68, 49]] as const } },
    { ...profile, route: { ...profile.route, cells: [...profile.route.cells, [71, 52] as const] } },
    { ...profile, groundCells: profile.groundCells.slice(1) }];
  for (const candidate of rejectedWorlds) {
    const savedState = structuredClone(initial), savedWorld = structuredClone(candidate);
    assert.equal(reduceLegacyHarvesterMovement(initial, candidate).supported, false);
    assert.deepEqual(initial, savedState); assert.deepEqual(candidate, savedWorld);
    const before = current.commandBefore;
    const idle = decodeLegacyHarvesterMovement(before.raw, current.mobileSlot, before.randomIndex, before.ground);
    assert.equal(beginLegacyHarvesterMovement(idle, candidate, 2).supported, false);
    assert.deepEqual(idle.raw, before.raw);
  }
  assert.equal(reduceLegacyHarvesterMovement({ ...initial, ground: blockedGround }, profile).supported, false);
  const active = current.trace.find(frame => frame.before.stack.at(-1)?.opcode === 5)!.before;
  const state = decodeLegacyHarvesterMovement(active.raw, current.mobileSlot, active.randomIndex, active.ground);
  const payload = 0x46 + active.stack.at(-1)!.offset * 2;
  for (const [offset, value] of [[0x35, 0], [0xcb, 1], [0xd0, 1], [0xc7, 1], [0x86, 15], [payload + 4, 30]]) {
    const raw = [...state.raw]; raw[offset] = value;
    const invalid = decodeLegacyHarvesterMovement(raw, state.slot, state.randomIndex, state.ground), saved = structuredClone(invalid);
    assert.equal(reduceLegacyHarvesterMovement(invalid, profile).supported, false);
    assert.deepEqual(invalid, saved);
  }
  const retarget = [...state.raw]; retarget[0x36] = 1; retarget[0x37] = 2;
  assert.equal(reduceLegacyHarvesterMovement(decodeLegacyHarvesterMovement(retarget, state.slot, state.randomIndex, state.ground), profile).supported, false);
  assert.equal(beginLegacyHarvesterMovement(state, profile, 2).supported, false);
  assert.equal(reduceLegacyHarvesterMovement({ ...state, xQ8: state.xQ8 + 1 }, profile).supported, false);
});

test("a completed native idle actor can accept another route without recentering or fabricated constructor state", async () => {
  const current = evidence.cases.find(current => current.route.destination[0] - current.route.start[0] === 2
    && current.route.destination[1] === current.route.start[1] && current.route.direction === 0)!;
  const arrived = current.trace.at(-1)!.after;
  let state = decodeLegacyHarvesterMovement(arrived.raw, current.mobileSlot, arrived.randomIndex, arrived.ground);
  const profile = await sourceLegacyHarvesterMovementWorld({ typeId: current.unitType, pth, fin, banks: current.banks,
    route: { policy: "external-direct-straight", originQ8: [state.xQ8, state.yQ8], cells: [[(state.xQ8 >> 8) + 1, state.yQ8 >> 8]] },
    plane: { cells: current.groundCells, tripWords: current.groundCells.map(() => 1023) } });
  const command = beginLegacyHarvesterMovement(state, profile, 2);
  assert.ok(command.supported);
  assert.equal(command.state.xQ8, state.xQ8); assert.equal(command.state.yQ8, state.yQ8);
  state = command.state;
  let handoffs = 0;
  for (let tick = 0; tick < 30; tick++) {
    const result = reduceLegacyHarvesterMovement(state, profile);
    assert.ok(result.supported, JSON.stringify(result));
    if (result.idleEvent) { assert.equal(result.idleEvent.arrived, true); handoffs++; }
    state = JSON.parse(JSON.stringify(result.state));
  }
  assert.equal(handoffs, 1);
  assert.equal(state.randomIndex, arrived.randomIndex);
});

for (const [caseIndex, current] of evidence.cases.entries()) {
  test(`original short route ${caseIndex}: type${current.unitType} ${JSON.stringify(current.route)} Stop=${current.stopAfter}`, async () => {
    const profile = await world(current);
    assert.deepEqual(current.runtimeInterceptions, []);
    assert.deepEqual(current.randomWrites, []);
    assert.deepEqual(current.routePolicyWrites.map(write => write.policy), current.stopAfter === 0 ? [] : ["external-direct-straight"]);
    for (const key of Object.keys(legacyHarvesterMotionTables) as (keyof typeof legacyHarvesterMotionTables)[])
      assert.deepEqual(current.motion[key], legacyHarvesterMotionTables[key]);
    for (const bank of Object.keys(profile.animations)) {
      assert.deepEqual(profile.animations[Number(bank)], current.animations[Number(bank)]);
      assert.deepEqual(profile.finBindings[Number(bank)], current.finBindings[Number(bank)]);
    }
    assert.ok(Object.isFrozen(profile) && Object.isFrozen(profile.route.cells) && Object.isFrozen(profile.census));
    const first = current.trace[0].before;
    const before = current.commandBefore;
    const initial = decodeLegacyHarvesterMovement(before.raw, current.mobileSlot, before.randomIndex, before.ground);
    const admitted = beginLegacyHarvesterMovement(initial, profile, current.order as 2 | 7);
    assert.ok(admitted.supported, JSON.stringify(admitted));
    assert.deepEqual(admitted.state.raw, first.raw, "native select/target/order packets");
    assert.deepEqual(initial.raw, before.raw);
    let state = admitted.state;
    let arrived = false;
    for (const frame of current.trace) {
      if (frame.update === (current.stopAfter ?? -2) + 1) {
        const stopped = queueLegacyHarvesterMovementStop(state, profile);
        assert.ok(stopped.supported, JSON.stringify(stopped));
        state = stopped.state;
      }
      assert.deepEqual(state.raw, frame.before.raw, `input tick${frame.update}`);
      const original = structuredClone(state), result = reduceLegacyHarvesterMovement(state, profile);
      assert.deepEqual(state, original);
      assert.ok(result.supported, `tick${frame.update}: ${JSON.stringify(result)}`);
      assert.deepEqual(result.state.raw.flatMap((value, offset) => value === frame.after.raw[offset] ? []
        : [`${offset.toString(16)}:${value}!=${frame.after.raw[offset]}`]), [], `raw tick${frame.update}`);
      assert.deepEqual(result.state.ground, frame.after.ground, `ground tick${frame.update}`);
      assert.deepEqual(result.state.stack, frame.after.stack.map(task => ({ task: task.opcode, words: task.words })));
      assert.deepEqual(result.state.pathBytes, frame.after.pathBytes);
      assert.equal(result.state.randomIndex, frame.after.randomIndex);
      assert.deepEqual(result.randomAdvances, []);
      assert.deepEqual(result.visits.map(visit => ({ boundary: visit.boundary, raw: visit.state.raw, ground: visit.state.ground })),
        current.visits.filter(visit => visit.update === frame.update).map(visit => ({ boundary: visit.boundary,
          raw: visit.state.raw, ground: visit.state.ground })), `dispatch tick${frame.update}`);
      assert.deepEqual(result.groundWrites, current.writes.filter(write => write.update === frame.update && write.address >= 0xd20000)
        .map(write => ({ eip: write.eip, cell: (write.address - 0xd20000) / 4, size: write.size, before: write.before, after: write.after })));
      if (result.idleEvent) {
        const event = result.idleEvent;
        assert.equal(legacyHarvesterIdleDiagnostic(event.state, { ...profile, groundCell: event.groundCell, groundWord: event.groundWord }), null);
        assert.deepEqual(event.raw, frame.after.raw);
        assert.equal(event.arrived, (result.state.xQ8 >> 8) === current.route.destination[0]
          && (result.state.yQ8 >> 8) === current.route.destination[1]);
        arrived = true;
      }
      state = JSON.parse(JSON.stringify(result.state));
    }
    assert.ok(arrived, "actual idle handoff required");
  });
}
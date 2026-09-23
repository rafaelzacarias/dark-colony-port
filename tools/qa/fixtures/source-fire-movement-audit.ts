import assert from "node:assert/strict";
import type { SimulationCheckpoint } from "../../../src/engine/simulation";

export type FireMovementFrame = Pick<SimulationCheckpoint,
  "tick" | "units" | "combatEvents" | "deathEvents" | "reservationEvents"> & Partial<Pick<SimulationCheckpoint, "staticTargets">>;

export function auditFireMovement(before: FireMovementFrame, after: FireMovementFrame) {
  assert.equal(after.tick, before.tick + 1, "fire audit requires exactly one simulation tick");
  const previous = new Map(before.units.map(unit => [unit.id, unit]));
  const current = new Map(after.units.map(unit => [unit.id, unit]));
  const shots = after.combatEvents.map(event => {
    assert.equal(event.type, "shot");
    assert.equal(event.tick, before.tick, "stale or skipped shot event");
    if (!previous.has(event.attackerId) && !current.has(event.attackerId)) {
      const start = before.staticTargets?.find(actor => actor.id === event.attackerId);
      const end = after.staticTargets?.find(actor => actor.id === event.attackerId);
      assert.ok(start && end && (start.weapon || start.mine) && (end.weapon || end.mine), "missing shooter or unarmed static");
      assert.ok(start.health > 0, "dead static shooter");
      assert.equal(end.xSubcells, start.xSubcells, "shot X displacement: static shooter");
      assert.equal(end.ySubcells, start.ySubcells, "shot Y displacement: static shooter");
      assert.deepEqual(end.mine, start.mine, "static mine profile changed during shot");
      assert.deepEqual(end.weapon, start.weapon, "static weapon changed during shot");
      assert.ok(!after.reservationEvents.some(event => event.unitId === start.id), "static shooter reserved movement during update");
      return { tick: event.tick, attackerId: event.attackerId, targetId: event.targetId,
        before: { x: start.xSubcells, y: start.ySubcells, activity: "static", pathLength: 0, pathIndex: 0, reservation: null },
        after: { x: end.xSubcells, y: end.ySubcells, activity: end.health === 0 ? "die" : "static", pathLength: 0, pathIndex: 0, reservation: null },
        reservations: [] };
    }
    const start = previous.get(event.attackerId);
    const end = current.get(event.attackerId);
    assert.ok(start && end, `shot ${event.tick}/${event.attackerId}: missing shooter`);
    const evidence = { tick: event.tick, attackerId: event.attackerId, targetId: event.targetId,
      before: { x: start.xSubcells, y: start.ySubcells, activity: start.activity,
        pathLength: start.path.length, pathIndex: start.pathIndex, reservation: start.reservedDestination },
      after: { x: end.xSubcells, y: end.ySubcells, activity: end.activity,
        pathLength: end.path.length, pathIndex: end.pathIndex, reservation: end.reservedDestination },
      reservations: after.reservationEvents.filter(reservation => reservation.unitId === event.attackerId) };
    const detail = JSON.stringify(evidence);
    assert.equal(end.xSubcells, start.xSubcells, `shot X displacement: ${detail}`);
    assert.equal(end.ySubcells, start.ySubcells, `shot Y displacement: ${detail}`);
    assert.equal(end.path.length, 0, `shot retains path: ${detail}`);
    assert.equal(end.pathIndex, 0, `shot retains path cursor: ${detail}`);
    assert.equal(end.reservedDestination, null, `shot retains reservation: ${detail}`);
    assert.equal(evidence.reservations.length, 0, `shot reserved movement during update: ${detail}`);
    return evidence;
  });
  let movedUnits = 0, activityTransitions = 0;
  for (const end of after.units) {
    const start = previous.get(end.id);
    if (!start) continue;
    if (start.xSubcells !== end.xSubcells || start.ySubcells !== end.ySubcells) movedUnits += 1;
    if (start.activity !== end.activity) activityTransitions += 1;
  }
  for (const death of after.deathEvents) assert.equal(death.tick, before.tick, "stale or skipped death event");
  return { shots, movedUnits, activityTransitions, deaths: after.deathEvents.length };
}
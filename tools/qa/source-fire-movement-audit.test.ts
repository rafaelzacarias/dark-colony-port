import assert from "node:assert/strict";
import test from "node:test";
import { auditFireMovement, type FireMovementFrame } from "./fixtures/source-fire-movement-audit";

function frames(): { before: FireMovementFrame; after: FireMovementFrame } {
  const unit: FireMovementFrame["units"][number] = {
    id: 1, faction: "human", speedSubcellsPerTick: 10, activity: "attack",
    xSubcells: 512, ySubcells: 768, path: [], pathIndex: 0, reservedDestination: null,
    health: 800, maxHealth: 800, weapon: null, sourceDefense: null, vision: null,
    attackCooldown: 0, attackTargetId: 2, harvester: null, cargo: 0,
    resourceTargetId: null, dropoff: null, harvestPhase: null,
  };
  return {
    before: { tick: 7, units: [unit], combatEvents: [], deathEvents: [], reservationEvents: [] },
    after: { tick: 8, units: [{ ...unit }],
      combatEvents: [{ type: "shot", tick: 7, attackerId: 1, targetId: 2, damage: 25 }],
      deathEvents: [{ type: "death", tick: 7, targetId: 2 }], reservationEvents: [] },
  };
}

test("fire audit accepts stationary shots, cleared old paths, and lethal-frame activity changes", () => {
  const { before, after } = frames();
  before.units[0].path = [{ x: 3, y: 3 }];
  before.units[0].reservedDestination = 33;
  after.units[0].activity = "die";
  const result = auditFireMovement(before, after);
  assert.equal(result.shots.length, 1);
  assert.equal(result.movedUnits, 0);
  assert.equal(result.activityTransitions, 1);
  assert.equal(result.deaths, 1);
});

for (const axis of ["xSubcells", "ySubcells"] as const) {
  test(`fire audit rejects ${axis} displacement even with final attack activity`, () => {
    const { before, after } = frames();
    after.units[0][axis] += 1;
    assert.throws(() => auditFireMovement(before, after), /shot [XY] displacement/);
  });
}

test("fire audit rejects a remaining path, path cursor, destination, or transient reservation", () => {
  for (const mutation of [
    (frame: FireMovementFrame) => { frame.units[0].path = [{ x: 3, y: 3 }]; },
    (frame: FireMovementFrame) => { frame.units[0].pathIndex = 1; },
    (frame: FireMovementFrame) => { frame.units[0].reservedDestination = 33; },
  ]) {
    const { before, after } = frames();
    mutation(after);
    assert.throws(() => auditFireMovement(before, after), /shot retains/);
  }
  const { before, after } = frames();
  assert.throws(() => auditFireMovement(before, { ...after,
    reservationEvents: [{ unitId: 1, tileX: 3, tileY: 3 }] }), /reserved movement during update/);
});

test("fire audit rejects skipped ticks, stale events, and absent shooters", () => {
  const { before, after } = frames();
  assert.throws(() => auditFireMovement(before, { ...after, tick: 9 }), /exactly one/);
  assert.throws(() => auditFireMovement(before, { ...after,
    combatEvents: [{ ...after.combatEvents[0], tick: 6 }] }), /stale or skipped shot/);
  assert.throws(() => auditFireMovement(before, { ...after, units: [] }), /missing shooter/);
  assert.throws(() => auditFireMovement(before, { ...after,
    deathEvents: [{ ...after.deathEvents[0], tick: 6 }] }), /stale or skipped death/);
});

test("fire audit counts non-shooting movement and transitions on quiet frames", () => {
  const { before, after } = frames();
  after.units[0].activity = "move";
  after.units[0].xSubcells += 10;
  const result = auditFireMovement(before, { ...after, combatEvents: [], deathEvents: [] });
  assert.equal(result.shots.length, 0);
  assert.equal(result.movedUnits, 1);
  assert.equal(result.activityTransitions, 1);
});
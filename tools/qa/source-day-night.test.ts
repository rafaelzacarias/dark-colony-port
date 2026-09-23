import assert from "node:assert/strict";
import test from "node:test";
import { advanceSourceDayNight, sourceDayNightFromHeader } from "../../src/engine/source-day-night";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { NavigationGrid } from "../../src/engine/grid";

test("source missions retain distinct startup phase and elapsed counter", () => {
  assert.deepEqual(sourceDayNightFromHeader(["1 5", "0", "6750", "1500", "75"]),
    { phase: 0, cycleLength: 6750, elapsed: 1500, transitionTicks: 75, blend: 0 });
  assert.equal(sourceDayNightFromHeader(["12 3", "1", "6750", "450", "75"]).blend, 256);
});

test("native phase switch is strictly beyond cycle and transition uses integer division", () => {
  let state = sourceDayNightFromHeader(["0 0", "0", "100", "99", "3"]);
  state = advanceSourceDayNight(state);
  assert.deepEqual([state.elapsed, state.phase, state.blend], [100, 0, 0]);
  state = advanceSourceDayNight(state);
  assert.deepEqual([state.elapsed, state.phase, state.blend], [0, 1, 0]);
  const values = [];
  for (let tick = 0; tick < 4; tick += 1) { state = advanceSourceDayNight(state); values.push(state.blend); }
  assert.deepEqual(values, [85, 170, 256, 256]);
});

test("source phase drives authoritative visibility and snapshot lighting", () => {
  const day = new DeterministicSimulation(new NavigationGrid(30, 30), {
    sourceDayNightHeader: ["1 5", "0", "6750", "1500", "75"],
  });
  const night = new DeterministicSimulation(new NavigationGrid(30, 30), {
    sourceDayNightHeader: ["12 3", "1", "6750", "450", "75"],
  });
  assert.equal(day.snapshot.daylightPermille, 1000);
  assert.equal(night.snapshot.daylightPermille, 0);
  for (let tick = 0; tick < 100; tick += 1) { day.advance(); night.advance(); }
  assert.equal(day.sourceDayNight!.elapsed, 1600);
  assert.equal(night.sourceDayNight!.elapsed, 550);
});
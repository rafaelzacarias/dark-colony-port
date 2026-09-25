import assert from "node:assert/strict";
import test from "node:test";
import { createFrameStatistics, type FrameStatistics } from "../../src/ui/frame-statistics";

for (const fps of [30, 60, 120, 240]) test(`FPS HUD measures real ${fps} Hz frames independently of simulation ticks`, () => {
  const monitor = createFrameStatistics();
  let latest: FrameStatistics | null = null, publications = 0;
  for (let frame = 0; frame <= fps * 6; frame++) {
    const stats = monitor.sample(frame * 1000 / fps);
    if (stats) { latest = stats; publications++; }
  }
  assert.ok(latest);
  for (const value of [latest.fps, latest.averageFps, latest.lowFps]) assert.ok(Math.abs(value - fps) < 1e-8);
  assert.ok(Math.abs(latest.frameMilliseconds - 1000 / fps) < 1e-8);
  assert.ok(latest.samples <= fps * 5 + 1, "bounded rolling sample window");
  assert.ok(publications >= 20 && publications <= 24, "throttled to at most four DOM updates per second");
});

test("FPS lows include real stalls and recover when the slow frame ages out", () => {
  const monitor = createFrameStatistics();
  let time = 0;
  const state: { latest: FrameStatistics | null } = { latest: null };
  monitor.sample(time);
  const sample = (delta: number) => { time += delta; state.latest = monitor.sample(time) ?? state.latest; };
  for (let frame = 0; frame < 240; frame++) sample(1000 / 60);
  sample(200);
  for (let frame = 0; frame < 30; frame++) sample(1000 / 60);
  assert.ok(state.latest);
  assert.ok(state.latest.fps < 60 && state.latest.averageFps < 60);
  assert.ok(state.latest.lowFps < 20, "1% low reflects the average of the slowest 1% frame times");
  for (let frame = 0; frame < 360; frame++) sample(1000 / 60);
  assert.ok(Math.abs(state.latest.lowFps - 60) < 1e-8);
});

test("FPS reset excludes menu/loading/hidden-tab time and malformed timestamps are rejected", () => {
  const monitor = createFrameStatistics();
  monitor.sample(0); monitor.sample(250);
  monitor.reset();
  assert.equal(monitor.sample(60_000), null);
  let latest: FrameStatistics | null = null;
  for (let frame = 1; frame <= 60; frame++) latest = monitor.sample(60_000 + frame * 1000 / 60) ?? latest;
  assert.ok(latest && Math.abs(latest.fps - 60) < 1e-8);
  for (const bad of [NaN, Infinity, -1, 60_999]) assert.throws(() => monitor.sample(bad), RangeError);
});

test("FPS storage stays bounded above ordinary monitor refresh rates", () => {
  const monitor = createFrameStatistics();
  let latest: FrameStatistics | null = null;
  for (let time = 0; time <= 8000; time++) latest = monitor.sample(time) ?? latest;
  assert.equal(latest!.samples, 2048);
  assert.equal(latest!.fps, 1000);
});

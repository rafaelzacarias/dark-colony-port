import assert from "node:assert/strict";
import test from "node:test";
import { runRestoreSteps, runRestoreStepsAsync, type RestoreProgress } from "../../src/engine/restore-progress";

function* replay(total: number, log: number[]): Generator<RestoreProgress, string> {
  for (let done = 0; done < total; done++) { log.push(done); yield { phase: "replay", done, total }; }
  return "restored";
}

test("synchronous restore drives every replay step to the same result", () => {
  const log: number[] = [];
  assert.equal(runRestoreSteps(replay(5, log)), "restored");
  assert.deepEqual(log, [0, 1, 2, 3, 4]);
});

test("async restore reports progress between slices and completes", async () => {
  const log: number[] = [], seen: RestoreProgress[] = [];
  const result = await runRestoreStepsAsync(replay(4, log), progress => seen.push(progress), () => true, 0);
  assert.equal(result, "restored");
  assert.deepEqual(log, [0, 1, 2, 3]);
  assert.ok(seen.length > 0 && seen.every(progress => progress.total === 4 && progress.done < 4));
});

test("async restore stops without a result once the load is abandoned", async () => {
  const log: number[] = [];
  let current = true;
  const result = await runRestoreStepsAsync(replay(100, log), () => { current = false; }, () => current, 0);
  assert.equal(result, undefined);
  assert.ok(log.length < 100);
});

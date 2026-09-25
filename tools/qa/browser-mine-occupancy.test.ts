import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { playArmy } from "./campaign-army";

// ALIEN08 trip 13 drops mines at (47,0..9) while a public trooper is stepping onto 47,6; that used to be a fatal
// "Occupied or ineligible ground cell 47,6" at tick 1919 on the next unit batch.
test("A08 mine line dropped onto a moving trooper does not fault the session", { timeout: 300000 }, async () => {
  const output = mkdtempSync(join(tmpdir(), "dc-a08-mines-"));
  const result = await playArmy("A08", output, 150000);
  assert.notEqual(result.status, "RUNTIME_BLOCKER", String(result.diagnostic));
  assert.equal(result.diagnostic ?? null, null);
  assert.ok(Number(result.tick) > 1919, `only reached tick ${result.tick}`);
  assert.ok((result.fired as number[]).includes(13), "trip 13 (the mine drop) must have fired");
});

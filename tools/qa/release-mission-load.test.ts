import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadReleaseMission } from "./fixtures/release-mission";

const root = new URL("../../", import.meta.url);

test("release config: all 30 campaign missions load with main's runtime profile and construction policy", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."));
    return new Response(readFileSync(new URL(`public${path}`, root)));
  };
  try {
    const failures: string[] = [];
    const commando: string[] = [];
    for (const faction of ["human", "alien"] as const) for (let number = 1; number <= 15; number++) {
      try {
        const mission = await loadReleaseMission(faction, number);
        const home = mission.scenario.teams[0].coordinateRows[1];
        if (number >= 4 && home[0] === 0 && home[1] === 0) {
          assert.equal(mission.browserConstruction, undefined);
          commando.push(`${faction[0].toUpperCase()}${number}`);
        }
      } catch (error) { failures.push(`${faction} ${number}: ${(error as Error).message}`); }
    }
    assert.deepEqual(failures, []);
    assert.deepEqual(commando, ["H6", "H11", "H14", "A5", "A9", "A14"]);
  } finally { globalThis.fetch = originalFetch; }
});

import assert from "node:assert/strict";
import test from "node:test";

import { parseMissionBriefing } from "./briefing";

test("strips formatting codes and joins wrapped objective lines", () => {
  const result = parseMissionBriefing(`~1...DOWNLOADING TRANSMISSION...

~4Welcome to ~2MARS, COMMANDER.

~1MISSION OBJECTIVES

~2-Reactivate the DROPSHIP
 BEACONS
-Locate the COLONY

~1...TRANSMISSION OUT...
`);
  assert.equal(result.plainText.includes("~"), false);
  assert.deepEqual(result.objectives, ["Reactivate the DROPSHIP BEACONS", "Locate the COLONY"]);
});

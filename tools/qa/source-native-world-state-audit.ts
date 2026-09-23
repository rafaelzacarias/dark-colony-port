import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeCampaignSession } from "../../src/engine/campaign-session";
import { parseScenario } from "../extractors/data/scenario";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { parseMapBundle } from "../extractors/maps/map";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const units = parseUnitStats(read("raw_cd/DC/GAMESTAT/GAMESTAT.TXT").toString());
const weapons = parseWeaponStats(read("raw_cd/DC/GAMESTAT/WEAPSTAT.TXT").toString());
const finPointerBytes = new Set([0x14, 0x1c, 0x24].flatMap(offset => [offset, offset + 1, offset + 2, offset + 3]));

for (const faction of ["HUMAN", "ALIEN"] as const) {
  const path = process.env[`DC_WORLD_PREFIX_${faction}_TRACE`];
  assert.ok(path, `Provide DC_WORLD_PREFIX_${faction}_TRACE from the observation-only probe`);
  const trace = JSON.parse(readFileSync(path, "utf8")) as {
    prefixes: { boundaries: { address: number; game: string }[] }[];
  };
  const original = Buffer.from(trace.prefixes[0].boundaries.find(boundary => boundary.address === 0x4196f4)!.game, "base64");
  const scenario = (extension: string) => read(`raw_cd/DC/SCENARIO/${faction}/${faction}02.${extension}`);
  const source = parseScenario(scenario("SCN").toString());
  const map = parseMapBundle(scenario("MAP"), scenario("MTG"), scenario("PTH"));
  const result = initializeCampaignSession({ sessionId: `world-startup-audit-${faction}`, source, units, weapons,
    triggers: [], messages: [], map, pathGrid: map.pathGrid, tags: map.tagGrid,
    commanders: [{ team: 0, unitType: faction === "HUMAN" ? 69 : 73, sprite: faction === "HUMAN" ? "TRSC" : "GRAY" }],
    directionBits: [], fixedStepMilliseconds: 16, orientationSteps: 1, resourceScales: "configured-startup" });
  if (!result.ok) assert.fail(JSON.stringify(result.diagnostics));
  const raw = result.value.world.entityBytes!;
  const mismatches = [];
  let pointerByteDifferences = 0, otherByteDifferences = 0;
  for (let slot = 0; slot < 800; slot++) {
    const offset = slot * 220, differences = [];
    for (let field = 0; field < 220; field++) {
      const expected = original[0x7d28 + offset + field], actual = raw[offset + field];
      if (expected === actual) continue;
      if (finPointerBytes.has(field)) pointerByteDifferences++;
      else {
        otherByteDifferences++;
        differences.push({ offset: `0x${field.toString(16)}`, expected, actual });
      }
    }
    if (differences.length) mismatches.push({ slot, type: original[0x7d28 + offset + 6],
      team: original[0x7d28 + offset + 7], registered: original.readInt16LE(0x468ec + slot * 2) !== -1,
      differences });
  }
  console.log(JSON.stringify({ mission: `${faction}02`, scope: "read-only-existing-loader-startup-audit",
    completedWholeCycles: 0, triggerExecution: "not invoked; startup constructor comparison only",
    freshScnModes: source.teams.map(team => team.ai), pointerByteDifferences, otherByteDifferences,
    mismatchedRawRecords: mismatches.length, firstRegisteredMismatch: mismatches.find(entry => entry.registered),
    firstUnregisteredMismatch: mismatches.find(entry => !entry.registered),
    missingNativeWorldImage: true, sourceOwner: "source-native-world-state",
    constructorPath: "0x41b920 -> 0x444f14/0x437bc4 (CITY), 0x41af14 (ordinary), source FIN relocation/globals" }));
}
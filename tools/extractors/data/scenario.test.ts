import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseScenario, ScenarioFormatError } from "./scenario";

function fixture(): string {
  const teams = Array.from({ length: 8 }, (_, index) => `TEAM ${index} ${index < 2 ? 1 : 0}
0
%Race
${index % 2}
%Money
${index * 10}
%AI
${index}
%TeamColour
${index} -1
%Depend
0 0 0 0 0 0 0 0 -1
%TeamAllies
0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -1
%AISlots
${index} ${index + 1}
0 0
%City
1 -1 0 -1 0 -1 0 -1 0 -1
0 0 0 0 0
0 0 0 0 0
0 0 0 0 0
0 0 0 0 0
0 0 0 0 0
0 0 0 0 0
0 0 0 0 0
0 0 0 0 0
`).join("\n");
  return `desert.bts\ntest01\nTest Scenario\n12 3\n0\n100\n200\n75\n${teams}\n4 5 0 1 -1 0\n`;
}

test("parses fixed eight-team SCN sections and trailing placements", () => {
  const scenario = parseScenario(fixture());
  assert.equal(scenario.terrainBank, "desert.bts");
  assert.equal(scenario.teams.length, 8);
  assert.deepEqual(scenario.teams[1].coordinateRows, [[1, 2], [0, 0]]);
  assert.equal(scenario.teams[1].teamColor, 1);
  assert.deepEqual(scenario.teams[1].dependencies, [1]);
  assert.equal(scenario.teams[1].allies.length, 8);
  assert.equal(scenario.teams[1].aiSlots.length, 15);
  assert.deepEqual(scenario.placementRows, [[4, 5, 0, 1, -1, 0]]);
});

test("SCN comment markers follow their native team fields", () => {
  const source = readFileSync(new URL("../../../raw_cd/DC/SCENARIO/ALIEN/ALIEN01.SCN", import.meta.url), "ascii");
  const scenario = parseScenario(source);
  const [alien, human] = scenario.teams;
  assert.deepEqual([alien.race, alien.money, alien.ai, alien.teamColor], [1, 0, 0, 2]);
  assert.deepEqual([human.race, human.money, human.ai, human.teamColor], [0, 0, 4, 7]);
  assert.deepEqual(alien.dependencies.slice(0, 4), [31, 33, 25, 41]);
  assert.deepEqual(alien.allies, [0, 0, 1, 0, 0, 0, 0, 0]);
});

test("native SCN reader skips comments and stores consecutive race/funds/AI/color values", () => {
  const executable = readFileSync(new URL("../../../raw_cd/DC/DC.EXE", import.meta.url));
  assert.equal(createHash("sha256").update(executable).digest("hex"),
    "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  for (const [address, expected] of [
    [0x41b89d, "803e2574d3"],
    [0x41bdc0, "894720"],
    [0x41bdeb, "894714"],
    [0x41be32, "894724"],
    [0x41be65, "898700010000"],
  ] as const) {
    const offset = address - 0x400c00;
    assert.equal(executable.subarray(offset, offset + expected.length / 2).toString("hex"), expected);
  }
});

test("rejects missing SCN team sections", () => {
  assert.throws(() => parseScenario("desert.bts\n"), ScenarioFormatError);
});
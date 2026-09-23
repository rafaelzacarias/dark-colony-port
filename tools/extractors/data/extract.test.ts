import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { VERIFIED_NATIVE_MBULLET_SHA256 } from "../../../src/engine/legacy-balance";

import { extractGameData } from "./extract";
import { parseDamageMatrix } from "./tables";

function scenario(): string {
  const teams = Array.from({ length: 8 }, (_, index) => `TEAM ${index} ${index === 0 ? 1 : 0}
0
%Race
0
%Money
0
%AI
${index}
%TeamColour
-1
%Depend
0 0 0 0 0 0 0 0 -1
%TeamAllies
0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -1
%AISlots
0 0
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
  return `desert.bts\ntest\nTest\n12 3\n0\n1\n2\n3\n\n${teams}\n1 2 3 4 5 6\n`;
}

test("exports balance and scenario data deterministically", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dark-colony-data-"));
  const gameRoot = path.join(root, "DC");
  const output = path.join(root, "output");
  try {
    await mkdir(path.join(gameRoot, "GAMESTAT"), { recursive: true });
    await mkdir(path.join(gameRoot, "SCENARIO", "TEST"), { recursive: true });
    await writeFile(
      path.join(gameRoot, "GAMESTAT", "GAMESTAT.TXT"),
      "1\nTRSC 0 10 25 7 4 1 2 3 125 150 0 800 0 31 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 8 0\n",
    );
    await writeFile(
      path.join(gameRoot, "GAMESTAT", "WEAPSTAT.TXT"),
      "1\n1 weapons 0 1 15 100 60 4 0 -1 -1 0 0\n",
    );
    await writeFile(path.join(gameRoot, "GAMESTAT", "DEPEND.TXT"), "1\n0 2000 206 0 0 0 0 -1\n");
    const damageMatrixSource = await readFile(new URL("../../../raw_cd/DC/GAMESTAT/MBULLET.TXT", import.meta.url));
    await writeFile(path.join(gameRoot, "GAMESTAT", "MBULLET.TXT"), damageMatrixSource);
    await writeFile(path.join(gameRoot, "SCENARIO", "TEST", "TEST.SCN"), scenario());
    await writeFile(
      path.join(gameRoot, "SCENARIO", "TEST", "TEST.TRO"),
      "1 norm 1 (c>0)\nreinforce 0 2 3 0 4 0 0\nend\n",
    );
    await writeFile(path.join(gameRoot, "SCENARIO", "TEST", "TEST.MSG"), "text 1\nDEPLOYING\n");
    await writeFile(path.join(gameRoot, "SCENARIO", "TEST", "TEST.003"), "~4Source result ~2THREE\n");
    await writeFile(
      path.join(gameRoot, "SCENARIO", "TEST", "TEST.TXT"),
      "~1MISSION OBJECTIVES\n~2-Hold the BEACON\n",
    );

    const first = await extractGameData(gameRoot, output);
    const firstIndex = await readFile(path.join(output, "index.json"), "utf8");
    const firstDamageMatrix = await readFile(path.join(output, "damage-matrix.json"), "utf8");
    const firstScenario = await readFile(path.join(output, "scenarios", "TEST", "TEST.json"), "utf8");
    const second = await extractGameData(gameRoot, output);
    assert.deepEqual(second, first);
    assert.equal(await readFile(path.join(output, "index.json"), "utf8"), firstIndex);
    assert.equal(await readFile(path.join(output, "damage-matrix.json"), "utf8"), firstDamageMatrix);
    assert.equal(first.files.damageMatrix, "damage-matrix.json");
    assert.deepEqual(JSON.parse(firstDamageMatrix), {
      schemaVersion: 1,
      source: { path: "GAMESTAT/MBULLET.TXT", sha256: VERIFIED_NATIVE_MBULLET_SHA256 },
      ...parseDamageMatrix(damageMatrixSource.toString("ascii")),
    });
    assert.deepEqual(
      { units: first.unitCount, weapons: first.weaponCount, dependencies: first.dependencyCount, scenarios: first.scenarioCount },
      { units: 1, weapons: 1, dependencies: 1, scenarios: 1 },
    );
    assert.equal(first.files.scenarios[0].triggers, "triggers/TEST/TEST.json");
    const triggers = JSON.parse(await readFile(path.join(output, "triggers", "TEST", "TEST.json"), "utf8"));
    assert.equal(triggers.blocks[0].actions[0].name, "reinforce");
    assert.equal(first.files.scenarios[0].messages, "messages/TEST/TEST.json");
    const messages = JSON.parse(await readFile(path.join(output, "messages", "TEST", "TEST.json"), "utf8"));
    assert.equal(messages.messages[0].text, "DEPLOYING");
    assert.equal(first.files.scenarios[0].briefing, "briefings/TEST/TEST.json");
    const briefing = JSON.parse(await readFile(path.join(output, "briefings", "TEST", "TEST.json"), "utf8"));
    assert.deepEqual(briefing.objectives, ["Hold the BEACON"]);
    const exportedScenario = JSON.parse(await readFile(path.join(output, "scenarios", "TEST", "TEST.json"), "utf8"));
    assert.equal(await readFile(path.join(output, "scenarios", "TEST", "TEST.json"), "utf8"), firstScenario);
    assert.deepEqual(Buffer.from(exportedScenario.rawScenario, "base64"),
      await readFile(path.join(gameRoot, "SCENARIO", "TEST", "TEST.SCN")));
    assert.equal(exportedScenario.outcomes[0].reasonCode, 3);
    assert.equal(exportedScenario.outcomes[0].text, "Source result THREE");
    assert.equal(exportedScenario.outcomes[0].source.path, "TEST/TEST.003");
    await writeFile(path.join(gameRoot, "GAMESTAT", "MBULLET.TXT"), "10\n9\n100\n");
    await assert.rejects(extractGameData(gameRoot, output), /MBULLET/);
    assert.equal(await readFile(path.join(output, "index.json"), "utf8"), firstIndex);
    assert.equal(await readFile(path.join(output, "damage-matrix.json"), "utf8"), firstDamageMatrix);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

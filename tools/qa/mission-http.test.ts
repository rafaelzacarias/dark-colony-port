import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { campaignConstructionPolicy, loadCampaignMission } from "../../src/game-data";
import { createMissionSpritePalettes } from "../../src/render/mission-sprites";
import { createMissionTerrain } from "../../src/render/mission-terrain";
import { IndexedWebGLUnavailableError } from "../../src/render/indexed-webgl";
import { installSourceRender } from "./fixtures/source-render";

function httpEnvironment(context: TestContext) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: {} });
  context.after(() => {
    if (original) Object.defineProperty(globalThis, "crypto", original);
    else Reflect.deleteProperty(globalThis, "crypto");
  });
  const state = { corrupt: "" };
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const path = String(input);
    assert.ok(path.startsWith("/assets/generated/") && !path.includes(".."), path);
    const bytes = Uint8Array.from(readFileSync(new URL(`../../public${path}`, import.meta.url)));
    if (path === state.corrupt) bytes[0] ^= 1;
    return new Response(bytes);
  });
  return state;
}

test("HTTP without crypto.subtle loads all 30 campaign missions with release policies", async context => {
  httpEnvironment(context);
  for (const faction of ["human", "alien"] as const) for (let number = 1; number <= 15; number++) {
    await context.test(`${faction} ${number}`, async () => {
      const profile = number >= 2 ? "browser-adapted" : undefined;
      const mission = await loadCampaignMission(faction, number, profile,
        campaignConstructionPolicy(faction, number, profile));
      assert.equal(mission.scenario.id.toUpperCase(), `${faction.toUpperCase()}${String(number).padStart(2, "0")}`);
      assert.ok(mission.units.length > 0);
    });
  }
});

test("HTTP sprite and terrain loaders verify real assets and still reject corrupt bytes", async context => {
  const state = httpEnvironment(context);
  const rendering = installSourceRender();
  context.after(() => rendering.dispose());
  const mission = await loadCampaignMission("human", 1);
  const sprites = await createMissionSpritePalettes(mission, ["EXPL", "CURSOR/CURS"]);
  try {
    assert.ok(sprites.indexedImage("EXPL", 0)!.indices.length > 0);
    assert.ok(sprites.image("EXPL", 0));
  } finally { sprites.dispose(); }
  // Reaching the renderer proves terrain hashes passed; this fixture has no WebGL.
  await assert.rejects(createMissionTerrain(mission), IndexedWebGLUnavailableError);

  state.corrupt = "/assets/generated/indexed/terrain/DESERT.indices.r8";
  await assert.rejects(createMissionTerrain(mission), /size\/hash mismatch/);
  state.corrupt = "/assets/generated/indexed/palettes/DESERT.palette.rgb8";
  await assert.rejects(createMissionSpritePalettes(mission, ["EXPL"]), /size\/hash mismatch/);
  await assert.rejects(loadCampaignMission("human", 1), /size\/hash mismatch/);
  state.corrupt = "/assets/generated/indexed/index.json";
  await assert.rejects(loadCampaignMission("human", 1), /manifest checksum mismatch/);
  await assert.rejects(createMissionSpritePalettes(mission, ["EXPL"]), /manifest checksum mismatch/);
  await assert.rejects(createMissionTerrain(mission), /manifest checksum mismatch/);
});

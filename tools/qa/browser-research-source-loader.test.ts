import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { MissionView } from "../../src/mission-view";
import { installSourceRender } from "./fixtures/source-render";
import { initializeCampaignSession } from "../../src/engine/campaign-session";
import { sourceBrowserCampaignSessionOptions } from "../../src/engine/source-browser-campaign-options";
import { observeBrowserResearch } from "../../src/engine/browser-research";
import { loadSourceBrowserResearchConfiguration } from "../../src/engine/source-browser-research";
import { parseScenario } from "../extractors/data/scenario";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const asset = (url: string) => readFileSync(new URL(`../../public${url}`, import.meta.url));
const callbacks = { onStats() {}, onUnitsChanged() {} };

test("research source loader: original ALIEN10 initializes, advances 200 and restores exactly without a production catalog", async context => {
  const renderer = installSourceRender();
  const assets = new Map<string, string>();
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    assert.ok(url.startsWith("/assets/generated/") && !url.includes(".."));
    const bytes = asset(url);
    assets.set(url, hash(bytes));
    return new Response(bytes);
  });
  let view: MissionView | undefined;
  let restored: MissionView | undefined;
  try {
    const mission = await loadCampaignMission("alien", 10, "browser-adapted");
    const original = readFileSync(new URL("../../raw_cd/DC/SCENARIO/ALIEN/ALIEN10.SCN", import.meta.url));
    assert.equal(mission.scenario.source.sha256, hash(original));
    assert.deepEqual(Buffer.from(mission.scenario.rawScenario!, "base64"), original);
    const unchanged = JSON.stringify(mission);
    assert.equal(mission.scenario.teams[0].money, 1500);
    assert.equal(mission.sourceProduction?.production, undefined);
    assert.deepEqual(parseScenario(Buffer.from(mission.scenario.rawScenario!, "base64").toString("latin1"))
      .teams[0].dependencies, [34, 53, 55]);
    const tables = JSON.parse(mission.browserResearch!.sourceTablesCanonical);
    assert.equal(tables.dependencies.find((entry: { id: number }) => entry.id === 14).cost, 2000);
    view = new MissionView(renderer.canvas(), {} as HTMLElement, callbacks, mission);
    assert.equal(view.missionDiagnostic, undefined);
    await view.initialize();
    assert.equal(view.missionDiagnostic, undefined);
    assert.deepEqual(view.researchDiscovery!.research.spyTeams, Array(8).fill(false));
    renderer.setEnabled(false);
    view.resetClock(); view.update(0);
    for (let tick = 1; tick <= 200; tick++) {
      view.update(tick * 50);
      assert.equal(view.missionDiagnostic, undefined, `update ${tick}`);
      assert.equal(view.simulation.snapshot.tick, tick);
    }
    assert.equal(view.campaignSnapshot!.world.exomoney[0], 1500);
    const saved = view.checkpoint();
    restored = MissionView.restore(renderer.canvas(), {} as HTMLElement, callbacks, mission,
      JSON.parse(JSON.stringify(saved)));
    assert.deepEqual(restored.checkpoint(), saved);
    view.resetClock(); view.update(0);
    restored.resetClock(); restored.update(0);
    for (let tick = 1; tick <= 8; tick++) {
      view.update(tick * 50); restored.update(tick * 50);
      assert.equal(view.missionDiagnostic, undefined);
      assert.equal(restored.missionDiagnostic, undefined);
    }
    assert.deepEqual(restored.checkpoint(), view.checkpoint());
    assert.equal(restored.campaignSnapshot!.world.exomoney[0], 1500);
    assert.equal(JSON.stringify(mission), unchanged);
    for (const [url, expected] of assets) assert.equal(hash(asset(url)), expected, url);
    context.diagnostic(`ALIEN10: 200 updates + 8 exact continuation; 1500 credits; ${assets.size} fetched assets unchanged`);
  } finally {
    restored?.dispose();
    view?.dispose();
    renderer.dispose();
  }
});

test("research source loader: all thirty original missions initialize research independently of production availability", async context => {
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => new Response(asset(String(input))));
  for (const faction of ["human", "alien"] as const) for (let number = 1; number <= 15; number++) {
    const mission = await loadCampaignMission(faction, number, "browser-adapted");
    const name = `${faction.toUpperCase()}${String(number).padStart(2, "0")}`;
    const original = readFileSync(new URL(`../../raw_cd/DC/SCENARIO/${faction.toUpperCase()}/${name}.SCN`, import.meta.url));
    assert.equal(mission.scenario.source.sha256, hash(original), name);
    const initialized = initializeCampaignSession(sourceBrowserCampaignSessionOptions(mission));
    assert.ok(initialized.ok, `${name}: ${JSON.stringify(initialized)}`);
    const configuration = mission.browserResearch!;
    const observed = observeBrowserResearch(initialized.value.world, configuration, "campaign-session-city");
    assert.equal(observed.teams.length, 8, name);
    for (const team of observed.teams) assert.equal(team.health, initialized.value.world.buildingSlots[`${team.team},4`], name);
    assert.throws(() => observeBrowserResearch(initialized.value.world, { ...configuration }, "campaign-session-city"), /source\/profile/);
    context.diagnostic(`${name}: research initialized; production=${!!mission.sourceProduction?.production}`);
  }
});

test("research source loader: whole DEPEND authentication rejects price, unrelated records and byte-only edits", async context => {
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => new Response(asset(String(input))));
  const mission = await loadCampaignMission("alien", 10, "browser-adapted");
  const bytes = asset("/assets/generated/data/dependencies.json");
  assert.equal((await loadSourceBrowserResearchConfiguration(mission, async () => bytes)).sourceTablesCanonical,
    mission.browserResearch!.sourceTablesCanonical);
  for (const id of [14, 21]) {
    const changed = JSON.parse(bytes.toString());
    changed.records.find((entry: { id: number }) => entry.id === id).cost += 1;
    await assert.rejects(loadSourceBrowserResearchConfiguration(mission,
      async () => Buffer.from(JSON.stringify(changed))), /source DEPEND hash mismatch/);
  }
  await assert.rejects(loadSourceBrowserResearchConfiguration(mission,
    async () => Buffer.concat([bytes, Buffer.from("\n")])), /source DEPEND hash mismatch/);
  const renderer = installSourceRender();
  try {
    assert.throws(() => new MissionView(renderer.canvas(), {} as HTMLElement, callbacks,
      { ...mission, browserResearch: { ...mission.browserResearch! } }), /source\/profile mismatch/);
  } finally { renderer.dispose(); }
});
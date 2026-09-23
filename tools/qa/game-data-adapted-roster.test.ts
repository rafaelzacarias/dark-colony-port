import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadCampaignMission } from "../../src/game-data";
import { CampaignSession } from "../../src/engine/campaign-session";
import { ADAPTED_UNIT_PRODUCTION_SOURCES, createCampaignProduction } from "../../src/engine/campaign-production";
import type { LegacyProductionSourceRecord } from "../../src/engine/legacy-production";
import { loadSourceProductionOptions, sourceProductionUi } from "../../src/engine/source-production-options";
import { sourceBrowserCampaignSessionOptions } from "../../src/engine/source-browser-campaign-options";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
const loadBytes = async (url: string) => {
  assert.ok(url.startsWith("/assets/generated/") && !url.includes(".."), url);
  return read(`public${url}`);
};

for (const faction of ["human", "alien"] as const) {
  test(`roster loader ${faction}: actual missions 01-15 gate wider production at 03 with adapted 120 visits, not native duration`, async context => {
    context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => new Response(await loadBytes(String(input))));
    const census: unknown[] = [];
    for (let missionNumber = 1; missionNumber <= 15; missionNumber++) {
      const mission = await loadCampaignMission(faction, missionNumber, "browser-adapted");
      const race = faction === "human" ? 0 : 1;
      const production = mission.sourceProduction?.production;
      const stem = `${faction.toUpperCase()}/${faction.toUpperCase()}${String(missionNumber).padStart(2, "0")}`;
      const rawScenario = read(`raw_cd/DC/SCENARIO/${stem}.SCN`);
      assert.equal(createHash("sha256").update(rawScenario).digest("hex"), mission.scenario.source.sha256);
      assert.deepEqual(Buffer.from(mission.scenario.rawScenario!, "base64"), rawScenario);
      const source = ADAPTED_UNIT_PRODUCTION_SOURCES.filter(entry => entry.race === race);
      if (production) {
        assert.deepEqual(production.adaptedCollectorProfiles, [{ runtimeProfile: "browser-adapted",
          unitType: race ? 14 : 6, completionVisits: 120 }]);
        assert.deepEqual(production.adaptedUnitProfiles, missionNumber < 3 ? undefined : source.map(entry => ({
          runtimeProfile: "browser-adapted", unitType: entry.unitType, completionVisits: 120 })));
        assert.deepEqual(production.adaptedUpgrades, missionNumber < 3 ? undefined : { runtimeProfile: "browser-adapted" });
        for (const entry of source) {
          const record: LegacyProductionSourceRecord = production.records.find(candidate => candidate.id === entry.dependency)!;
          assert.equal(record.cost, entry.cost);
          assert.deepEqual(record.dependencies, entry.dependencies);
          assert.deepEqual(production.units.find(unit => unit.unitType === entry.unitType), {
            unitType: entry.unitType, queue: entry.queue, exitSelector: entry.exitSelector, exitOffset: entry.exitOffset });
        }
      }
      const session = new CampaignSession(sourceBrowserCampaignSessionOptions(mission));
      const choices = production ? sourceProductionUi(createCampaignProduction({ ...production, sessionId: `${mission.scenario.id}:browser` }), 0) : [];
      const roster = choices.filter(choice => choice.kind === "unit" && source.some(entry => entry.unitType === choice.unitType));
      if (production && missionNumber >= 3) assert.equal(roster.length, 4);
      else assert.deepEqual(roster, []);
      census.push({ mission: mission.scenario.id, credits: production?.teams[0].credits ?? null,
        profiles: production?.adaptedUnitProfiles?.map(profile => profile.unitType) ?? [],
        queues: session.browserFrameContext(150).productionVisits?.map(visit => visit.queue) ?? [],
        roster: roster.map(choice => ({ unitType: choice.unitType, dependency: choice.dependency,
          cost: choice.cost, nativeState: choice.nativeState, maxAdditional: choice.maxAdditional, producerNativeSlot: choice.producerNativeSlot })) });
      if (missionNumber <= 2) {
        const previous = await loadSourceProductionOptions({ sessionId: `${mission.scenario.id}:browser`, mission, rawScenario,
          configuration: { profile: "user-selected-source-campaign-fresh", mode: 0, localTeam: 0, race },
          adaptedCollectors: { runtimeProfile: "browser-adapted", completionVisits: 120 }, loadBytes });
        assert.deepEqual(production, previous.production, "M01/M02 canonical production options must retain collector-only identity");
        const saved = JSON.parse(JSON.stringify(session.checkpoint()));
        assert.equal(saved.options.production?.adaptedUnitProfiles, undefined);
        assert.equal(saved.options.production?.adaptedUpgrades, undefined);
        assert.deepEqual(CampaignSession.restore(saved).checkpoint(), saved);
      }
    }
    context.diagnostic(JSON.stringify({ faction, completionVisits: 120, provenance: "browser-adapted duration; source DEPEND/GAMESTAT cost, dependencies, queue and exit", census }));
  });
}

test("roster loader: strict source production remains infantry-only without adapted options", async context => {
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => new Response(await loadBytes(String(input))));
  for (const faction of ["human", "alien"] as const) {
    const mission = await loadCampaignMission(faction, 3, "browser-adapted");
    const strict = await loadSourceProductionOptions({ sessionId: `${mission.scenario.id}:strict`, mission,
      rawScenario: Buffer.from(mission.scenario.rawScenario!, "base64"),
      configuration: { profile: "user-selected-source-campaign-fresh", mode: 0, localTeam: 0, race: faction === "human" ? 0 : 1 }, loadBytes });
    assert.equal(strict.production?.adaptedCollectorProfiles, undefined);
    assert.equal(strict.production?.adaptedUnitProfiles, undefined);
    assert.equal(strict.production?.adaptedUpgrades, undefined);
    assert.ok(strict.choices.every(choice => choice.unitType === (faction === "human" ? 0 : 8)));
  }
});
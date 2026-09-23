import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadSourceProductionOptions, producerProfiles, sourceProductionTeamSeeds,
  sourceProductionPopulation, sourceProductionPopulationLimit, sourceProductionUi,
  sourceProductionVisits,
  type SourceProductionBootConfiguration } from "../../src/engine/source-production-options.ts";
import { reduceCampaignProduction, type ProductionSourceProfile, type ProductionUnitSource } from "../../src/engine/campaign-production.ts";
import type { CampaignWorld } from "../../src/engine/campaign-world.ts";
import type { CampaignMissionData } from "../../src/game-data.ts";
import { parseScenario } from "../extractors/data/scenario.ts";
import { parseUnitStats } from "../extractors/data/tables.ts";
import { parseFin } from "../extractors/animations/fin.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
const units = parseUnitStats(read("raw_cd/DC/GAMESTAT/GAMESTAT.TXT").toString());
const native = JSON.parse(process.env.DC_SOURCE_PRODUCTION_TRACE ? readFileSync(process.env.DC_SOURCE_PRODUCTION_TRACE, "utf8")
  : execFileSync("python3", [`${root}tools/qa/source-production-startup-native.py`], {
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: [process.env.PYTHONPATH, "/tmp/dc-re-capstone-20260918", "/tmp/dc-trigger-unicorn-20260918"].filter(Boolean).join(":") },
  })) as { executableSha256: string; scenarios: { path: string; sha256: string; teams: {
    team: number; race: number; credits: number; costAccumulator: number; base: number[]; health: number[];
    levels: number[]; busy: number[]; counts: number[]; ready: number[]; delays: number[];
    restrictions: number[]; upgrades: number[][];
  }[] }[]; census: { fixtures: [number, number, number, number, boolean][]; populations: number[] };
  caps: { ceiling: number; colonies: number; neutral: number; renat: number; limit: number }[];
  configuration: { provenance: string; header: number[]; mode: number; race: number }[];
  production: { units: ProductionUnitSource[]; profiles: ProductionSourceProfile[] };
  missions: { name: string; sourceSha256: string; population: number[]; limit: number; renatCount: number; renatHex: string;
    entities: { slot: number; team: number; status: number; registered: boolean; unitType: number }[] }[] };

const loadBytes = async (url: string) => read(`public${url}`);
function input(faction: "human" | "alien", number: 1 | 2) {
  const stem = `${faction.toUpperCase()}/${faction.toUpperCase()}0${number}`;
  const mission = { faction, units,
    scenario: JSON.parse(read(`public/assets/generated/data/scenarios/${stem}.json`).toString()) } satisfies Pick<CampaignMissionData, "faction" | "units" | "scenario">;
  const configuration: SourceProductionBootConfiguration = { profile: "user-selected-source-campaign-fresh",
    mode: 0, localTeam: 0, race: faction === "human" ? 0 : 1 };
  return { sessionId: stem, mission, configuration, rawScenario: read(`raw_cd/DC/SCENARIO/${stem}.SCN`), loadBytes };
}

test("source team seeds match original x86 initialization, including poisoned counters", () => {
  assert.equal(createHash("sha256").update(read("raw_cd/DC/DC.EXE")).digest("hex"), native.executableSha256);
  assert.equal(native.scenarios.length, 108);
  for (const entry of native.scenarios) {
    const bytes = read(`raw_cd/DC/${entry.path}`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
    const seeds = sourceProductionTeamSeeds(parseScenario(bytes.toString()), units);
    for (const expected of entry.teams) {
      const seed = seeds[expected.team];
      const label = `${entry.path} team ${seed.team}`;
      assert.deepEqual([seed.race, seed.credits, seed.costAccumulator, [seed.base.x, seed.base.y]],
        [expected.race, expected.credits | 0, expected.costAccumulator, expected.base], label);
      assert.deepEqual(seed.slots.map((slot) => slot.health), expected.health, label);
      assert.deepEqual(seed.slots.map((slot) => slot.level), expected.levels, label);
      assert.deepEqual(seed.slots.map((slot) => slot.busy), expected.busy, label);
      assert.deepEqual(seed.restrictions, expected.restrictions, label);
      assert.deepEqual(seed.producerDelays, expected.delays, label);
      assert.deepEqual(expected.counts, [0, 0, 0, 0], label);
      assert.deepEqual(expected.ready, [1, 1, 1, 1], label);
      assert.deepEqual(seed.upgrades.map((upgrade) => [upgrade.weapon, upgrade.armor]), expected.upgrades, label);
    }
  }
});

for (const faction of ["human", "alien"] as const) {
  test(`${faction} adapted collectors: explicit M02 opt-in retains source infantry profile`, async () => {
    const request = input(faction, 2);
    const strict = await loadSourceProductionOptions(request);
    const adapted = await loadSourceProductionOptions({ ...request,
      adaptedCollectors: { runtimeProfile: "browser-adapted", completionVisits: 120 } });
    assert.equal(adapted.status, "available");
    assert.deepEqual(adapted.production!.sourceProfiles, strict.production!.sourceProfiles);
    assert.equal(strict.production!.adaptedCollectorProfiles, undefined);
    assert.deepEqual(adapted.production!.adaptedCollectorProfiles, [{ runtimeProfile: "browser-adapted",
      completionVisits: 120, unitType: faction === "human" ? 6 : 14 }]);
    assert.equal(adapted.choices.length, 2);
    const collector = adapted.choices.find(choice => choice.unitType === (faction === "human" ? 6 : 14))!;
    assert.equal(collector.dependency, faction === "human" ? 7 : 21);
    assert.equal(collector.cost, 1500);
    assert.equal(collector.producerNativeSlot, 0);
    const funded = reduceCampaignProduction(adapted.state!, { id: "collector-income", team: 0,
      action: { type: "sync-credits", expectedPreviousCredits: 0, credits: 1500 } });
    assert.equal(sourceProductionUi(funded, 0).find(choice => choice.dependency === collector.dependency)!.maxAdditional, 1);
    for (const completionVisits of [0, -1, 1.5, 65536]) await assert.rejects(loadSourceProductionOptions({ ...request,
      adaptedCollectors: { runtimeProfile: "browser-adapted", completionVisits } }), /completionVisits/);
    await assert.rejects(loadSourceProductionOptions({ ...request,
      adaptedCollectors: { runtimeProfile: "strict-native" as "browser-adapted", completionVisits: 120 } }), /browser-adapted/);
  });
  test(`${faction} first mission: no player factory, no substitute scenario`, async () => {
    const options = await loadSourceProductionOptions(input(faction, 1));
    assert.equal(options.status, "no-owned-factory");
    assert.equal(options.production, undefined);
    assert.deepEqual(options.choices, []);
  });
  test(`${faction} second mission: actual owned colony, source restrictions and credit synchronization`, async () => {
    const request = input(faction, 2);
    const options = await loadSourceProductionOptions(request);
    assert.equal(options.status, "available");
    assert.equal(options.missionAdmission, "not-evaluated");
    assert.equal(options.initialPopulationCeiling, 150);
    assert.deepEqual(options.production!.teams.map((team) => team.team), [0]);
    assert.deepEqual(options.production!.teams[0].base, faction === "human" ? { x: 56, y: 55 } : { x: 13, y: 69 });
    assert.equal(options.choices.length, 1);
    assert.equal(options.choices[0].unitType, faction === "human" ? 0 : 8);
    assert.equal(options.choices[0].credits, 0);
    assert.equal(options.choices[0].maxAdditional, 0);
    assert.deepEqual(options.production!.units, native.production.units.map(({ unitType, queue, exitSelector, exitOffset }) =>
      ({ unitType, queue, exitSelector, exitOffset })));
    assert.deepEqual(options.production!.sourceProfiles, native.production.profiles.filter((profile) => profile.unitType === options.choices[0].unitType));
    const funded = reduceCampaignProduction(options.state!, { id: "actual-income", team: 0,
      action: { type: "sync-credits", expectedPreviousCredits: 0, credits: 1000 } });
    assert.equal(sourceProductionUi(funded, 0)[0].maxAdditional, 2);
    assert.throws(() => sourceProductionUi(funded, 1), /local team/);
  });
}

test("loader fails closed for absent configuration, mismatched mission and edited generated assets", async () => {
  const request = input("human", 2);
  await assert.rejects(loadSourceProductionOptions({ ...request, configuration: undefined! }), /configuration/);
  await assert.rejects(loadSourceProductionOptions({ ...request, rawScenario: input("human", 1).rawScenario }), /SCN hash/);
  await assert.rejects(loadSourceProductionOptions({ ...request, mission: { ...request.mission,
    units: request.mission.units.map((unit) => unit.index === 0 ? { ...unit, health: 1 } : unit) } }), /GAMESTAT/);
  await assert.rejects(loadSourceProductionOptions({ ...request,
    loadBytes: async (url) => new TextEncoder().encode(new TextDecoder().decode(await loadBytes(url)).replace('"field2": 6', '"field2": 9')) }), /hash mismatch/);
});

test("producer metadata rejects altered banks, hash and byte timelines", () => {
  const metadata = JSON.parse(read("public/assets/generated/animations/HUBU.json").toString());
  assert.equal(producerProfiles(metadata, 0)[0].directions.length, 32);
  assert.throws(() => producerProfiles({ ...metadata, source: { ...metadata.source, sha256: "wrong" } }, 0), /unverified/);
  metadata.timeline[26].field2 = 100;
  assert.throws(() => producerProfiles(metadata, 0), /timeline/);
});

test("generated producer metadata equals decoded original FIN and all native bank directions", () => {
  for (const [race, stem] of [[0, "HUBU"], [1, "ALBU"]] as const) {
    const bytes = read(`raw_cd/DC/ANIMATE/${stem}.FIN`);
    const decoded = parseFin(bytes);
    const metadata = JSON.parse(read(`public/assets/generated/animations/${stem}.json`).toString());
    assert.equal(createHash("sha256").update(bytes).digest("hex"), metadata.source.sha256);
    assert.deepEqual(metadata.states, decoded.states);
    assert.deepEqual(metadata.timeline.map((frame: { field2: number }) => frame.field2), decoded.timeline.map((frame) => frame.field2));
    assert.deepEqual(producerProfiles(metadata, race), native.production.profiles.filter((profile) => profile.unitType === (race === 0 ? 0 : 8)));
  }
});

test("explicit selected campaign header is executed by the native configuration loader", () => {
  assert.deepEqual(native.configuration.map(({ mode, race }) => ({ mode, race })), [{ mode: 0, race: 0 }, { mode: 0, race: 1 }]);
  for (const configuration of native.configuration) {
    assert.equal(configuration.provenance, "explicit-user-selected-header-not-installed-config");
    assert.equal(configuration.header[1], configuration.mode);
    assert.equal(configuration.header[2], configuration.race);
  }
});

function worldFixture(): CampaignWorld {
  return { sessionId: "probe", buildingSlots: Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`${Math.floor(index / 5)},${index % 5}`, 0])),
    placementState: { renatSources: [], renatBytes: new Uint8Array(1000) },
    transportState: { kind: "transport-host-v1", slots: Array(800).fill(null), registry: Array(800).fill(null) },
  } as unknown as CampaignWorld;
}

test("selector 6 matches x86: registered dynamic slots, not faction, health, status or high-water", () => {
  const world = worldFixture();
  const host = world.transportState as { slots: unknown[]; registry: (string | null)[] };
  for (const [slot, team, status, health, registered] of native.census.fixtures) {
    const key = `slot:${slot}`;
    host.slots[slot] = { slot, team, status, health, key };
    host.registry[slot] = registered ? key : null;
  }
  assert.deepEqual(Array.from({ length: 8 }, (_, team) => sourceProductionPopulation(world, team)), native.census.populations);
});

test("dynamic cap matches x86 building denominator, neutral slots, RENAT and current ceiling", () => {
  for (const entry of native.caps) {
    const world = worldFixture();
    const buildings = world.buildingSlots as Record<string, number>;
    for (let team = 0; team < entry.colonies; team += 1) buildings[`${team},0`] = 1;
    const host = world.transportState as { slots: unknown[] };
    for (let slot = 152; slot < 152 + entry.neutral; slot += 1) host.slots[slot] = { slot, team: 8, status: 1 };
    const withRenat = { ...world, placementState: { ...world.placementState,
      renatSources: [{ sourceRow: 0, tileX: 0, tileY: 0, unitType: 0, count: entry.renat }] } };
    new DataView(withRenat.placementState.renatBytes.buffer).setInt32(16, entry.renat, true);
    assert.equal(sourceProductionPopulationLimit(withRenat, entry.ceiling), entry.limit);
  }
});

test("unchanged first/second mission placements reproduce native census and cap, and provide live visits", async () => {
  for (const mission of native.missions) {
    const faction = mission.name.startsWith("HUMAN") ? "human" : "alien";
    const request = input(faction, mission.name.endsWith("01") ? 1 : 2);
    assert.equal(request.mission.scenario.source.sha256, mission.sourceSha256);
    const options = await loadSourceProductionOptions(request);
    const seeds = sourceProductionTeamSeeds(options.source, units);
    const world = { ...worldFixture(), sessionId: request.sessionId,
      buildingSlots: Object.fromEntries(seeds.flatMap((seed) => seed.slots.map((slot, index) => [`${seed.team},${index}`, slot.health]))),
      placementState: { ...worldFixture().placementState, renatSources: options.source.placementRows
        .flatMap((row, sourceRow) => row[3] === -1
          ? [{ sourceRow, tileX: row[0], tileY: row[1], unitType: row[2], count: row[4] }] : []) } };
    const host = world.transportState as { slots: unknown[]; registry: (string | null)[] };
    for (const entity of mission.entities) {
      const key = `native:${entity.slot}`;
      host.slots[entity.slot] = { ...entity, key };
      host.registry[entity.slot] = entity.registered ? key : null;
    }
    assert.equal(mission.renatCount, world.placementState.renatSources.length);
    world.placementState.renatBytes.set(Buffer.from(mission.renatHex, "hex"));
    assert.deepEqual(Array.from({ length: 8 }, (_, team) => sourceProductionPopulation(world, team)), mission.population);
    assert.equal(sourceProductionPopulationLimit(world, options.initialPopulationCeiling), mission.limit);
    if (options.state) {
      assert.deepEqual(sourceProductionVisits(world, options.state, options.initialPopulationCeiling),
        [{ team: 0, queue: 0, population: mission.population[0], populationLimit: mission.limit }]);
    }
  }
});
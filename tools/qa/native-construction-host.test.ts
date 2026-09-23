import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHash } from "node:crypto";
import { createCampaignProduction, reduceCampaignProduction, restoreCampaignCityProduction } from "../../src/engine/campaign-production";
import { transactCampaignAiCity, stepCampaignAiCityConstruction, restoreCampaignAiCity, campaignAiCityCheckpoint,
  type CampaignAiCityState } from "../../src/engine/campaign-ai";
import { parseDependencies } from "../extractors/data/tables";
import { createNativeConstructionHost, receiveNativeConstruction, visitNativeConstruction, restoreNativeConstructionHost,
  nativeConstructionRegisteredSlots, type NativeConstructionConfiguration } from "../../src/engine/native-construction-host";

const root = new URL("../../", import.meta.url);
const proof = JSON.parse(process.env.DC_CITY_TRACE ? readFileSync(process.env.DC_CITY_TRACE, "utf8")
  : execFileSync("python3", ["-B", new URL("tools/qa/native-construction-host-native.py", root).pathname], {
    encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
  }));

export function constructionConfiguration(golden: any): NativeConstructionConfiguration {
  const profile = (unitType: number, build = false) => {
    const binding = golden.profiles.bindings.find((item: any) => item.unitType === unitType);
    const state = build ? binding.constructionState : binding.standState;
    return { id: state.name, source: state.source,
      sha256: golden.profiles.sources.find((item: any) => item.source === state.source).sha256,
      first: state.first, last: state.last, directions: Array.from({ length: 32 }, () => [...state.delays]) };
  };
  const teamBytes = new DataView(Uint8Array.from(golden.beforeTeam).buffer);
  return { sourceSha256: proof.sha256, team: 1, race: golden.race, base: { x: 32, y: 32 }, map: { width: 128, height: 128 },
    fixedSlots: Array.from({ length: 15 }, (_, slot) => slot < 2 ? { nativeId: 15 + slot,
      unitType: 16 + golden.race * 12 + slot, health: teamBytes.getInt32(0x3c + slot * 4, true) } : null),
    footprint: [[33, 32], [34, 32], [33, 33], [34, 33]].map(([x, y]) => ({ x, y, occupant: 1023 })),
    profiles: { stand: profile(20 + golden.race * 12), build: profile(20 + golden.race * 12, true),
      auxiliary: profile(92 + golden.race) } };
}

function cityFixture(golden: any): CampaignAiCityState {
  const configuration = constructionConfiguration(golden);
  const records = parseDependencies(readFileSync(new URL("raw_cd/DC/GAMESTAT/DEPEND.TXT", root), "utf8"));
  const bytes = new DataView(Uint8Array.from(golden.beforeTeam).buffer);
  const types = new DataView(Uint8Array.from(golden.types).buffer);
  const troop = golden.profiles.bindings.find((binding: any) => binding.unitType === golden.race * 8).constructionState;
  const production = createCampaignProduction({ sessionId: `source-city-race-${golden.race}`, records,
    units: records.filter(record => record.rawFields[0] === 1).map(record => ({ unitType: record.rawFields[1],
      queue: types.getInt32(record.rawFields[1] * 280 + 0xec, true) as 0 | 1 | 2 | 3,
      exitSelector: types.getInt32(record.rawFields[1] * 280 + 0xf0, true) as 0 | 1, exitOffset: { x: 0, y: -3 } })),
    sourceProfiles: [{ unitType: golden.race * 8 as 0 | 8, bankField: 152, id: troop.name,
      finSha256: golden.profiles.sources.find((source: any) => source.source === troop.source).sha256,
      directions: Array.from({ length: 32 }, () => [...troop.delays]) }],
    constructionSources: [configuration],
    teams: [{ team: 1, race: golden.race, credits: bytes.getInt32(0x14, true), costAccumulator: bytes.getInt32(0x18, true),
      base: { x: 32, y: 32 }, slots: Array.from({ length: 5 }, (_, slot) => ({
        health: bytes.getInt32(0x3c + slot * 4, true), level: bytes.getInt32(0xc4 + slot * 4, true), busy: 0 })),
      restrictions: Array.from({ length: 110 }, (_, index) => index).filter(index => golden.beforeTeam[0xda4 + index] !== 0), upgrades: [] }] });
  return { scope: "source-city-only", production, receipts: [],
    ai: { policy: Uint8Array.from(golden.aiBefore.policy), entities: Uint8Array.from(golden.aiBefore.entities), forceOrder: 0,
      navigation: { width: 128, height: 128, families: new Uint8Array(16384).fill(1), nextFamily: new Uint8Array(65536) } },
    inputs: { team: 1, teamBytes: Uint8Array.from(golden.beforeTeam), types: Uint8Array.from(golden.types),
      dependencies: Uint8Array.from(golden.dependencies), weapons: new Uint8Array(80 * 72), matrix: [],
      relations: new Uint8Array(100), visibilityMasks: Array(8).fill(0), occupancy: Array(16384).fill(1023),
      cityDependencies: golden.cityDependencies, population: 6, populationLimit: 10 } };
}

function visit(state: CampaignAiCityState) {
  const host = state.production.constructionHosts![0];
  return { sequence: host.visits, counter: 4, mainHealth: 2400, auxiliaryHealth: host.actors[6]?.health ?? 0,
    registeredSlots: nativeConstructionRegisteredSlots(host) };
}

for (const golden of proof.cases) test(`race ${golden.race}: finite original AI -> paid mode9 -> ready science -> next paid receipt`, () => {
  const initial = cityFixture(golden), pristine = structuredClone(initial);
  const command = { id: "science", sequence: 0, stage: "demand" as const };
  let state = transactCampaignAiCity(initial, command);
  assert.deepEqual(initial, pristine);
  assert.equal(state.receipts[0].selectedRule, 5);
  assert.equal(state.receipts[0].intents[0].dependency, golden.race === 0 ? 2 : 16);
  assert.deepEqual(state.receipts[0].intents[0].packet, golden.packets[0]);
  assert.deepEqual([...state.ai.policy], golden.aiAfter.policy);
  assert.deepEqual([...state.ai.entities], golden.aiAfter.entities);
  assert.deepEqual([state.production.teams[0].credits, state.production.teams[0].costAccumulator], [4000, 2017]);
  assert.deepEqual(state.production.teams[0].pending, {});
  assert.deepEqual(transactCampaignAiCity(state, command), state);
  const paid = state;
  for (let index = 1; index < golden.trace.length; index++) {
    state = stepCampaignAiCityConstruction(state, visit(state), `construction:${index}`);
    const expected = golden.trace[index], team = state.production.teams[0];
    assert.deepEqual([team.slots[3].health, team.slots[3].busy, team.latch], [expected.main.hp, expected.busy, expected.latch]);
    assert.equal(state.inputs.teamBytes[0x7b], expected.busy);
    assert.equal(state.inputs.teamBytes[0xe12], expected.latch);
    if (index === 52) {
      const restored = restoreCampaignAiCity(JSON.parse(JSON.stringify(campaignAiCityCheckpoint(state))), initial);
      assert.deepEqual(restored, state);
      state = restored;
    }
  }
  assert.equal(state.production.teams[0].construction, null);
  assert.equal(state.production.constructionHosts![0].ready, true);
  assert.equal(state.production.constructionHosts![0].actors.length, 15);
  const next = transactCampaignAiCity(state, { id: "next-valid", sequence: 1, stage: "demand" });
  assert.deepEqual(next.receipts[1].intents[0].packet, golden.packets[1]);
  assert.equal(next.production.teams[0].credits, 3650);
  assert.equal(next.production.teams[0].costAccumulator, 2367);
  assert.equal(next.production.teams[0].queues[0].items.length, 1);
  assert.deepEqual(restoreCampaignAiCity(JSON.parse(JSON.stringify(campaignAiCityCheckpoint(next))), initial), next);
  assert.deepEqual(transactCampaignAiCity(next, command), next);
  assert.throws(() => reduceCampaignProduction(paid.production, { id: "fake-finish", team: 1,
    action: { type: "construction", constructionId: paid.production.teams[0].construction!.id, nativeId: 18,
      transition: "arrival-created" } }), /caller-fabricated/);
});

test("source profile hashes are actual FIN files, and malformed source/occupied fixed slots fail closed", () => {
  for (const golden of proof.cases) {
    const config = constructionConfiguration(golden);
    for (const profile of Object.values(config.profiles)) assert.equal(createHash("sha256")
      .update(readFileSync(new URL(profile.source, root))).digest("hex"), profile.sha256);
    for (const mutate of [
      (copy: any) => { copy.profiles.build.directions[0][0] = 3; },
      (copy: any) => { copy.profiles.build.sha256 = "0".repeat(64); },
      (copy: any) => { copy.fixedSlots[6] = { nativeId: 21, unitType: 92, health: 800 }; },
      (copy: any) => { copy.footprint[0].occupant = 152; },
      (copy: any) => { copy.map.width = 34; },
      (copy: any) => { copy.fixedSlots[0] = null; },
    ]) {
      const copy = structuredClone(config);
      mutate(copy);
      const before = structuredClone(copy);
      assert.throws(() => createNativeConstructionHost(copy));
      assert.deepEqual(copy, before);
    }
  }
});

test("phase-3 external death, reordered visits, stale sequence and forged checkpoint reject without mutation", () => {
  const initial = cityFixture(proof.cases[0]);
  let state = transactCampaignAiCity(initial, { id: "science", sequence: 0, stage: "demand" });
  while (state.production.constructionHosts![0].actors[3]!.phase !== 3) {
    state = stepCampaignAiCityConstruction(state, visit(state), `phase3:${visit(state).sequence}`);
  }
  const pristine = structuredClone(state);
  for (const input of [{ ...visit(state), mainHealth: 0 }, { ...visit(state), auxiliaryHealth: 0 },
    { ...visit(state), sequence: 0 }, { ...visit(state), registeredSlots: [...visit(state).registeredSlots].reverse() },
    { ...visit(state), counter: 3 }]) {
    assert.throws(() => stepCampaignAiCityConstruction(state, input, "bad-visit"));
    assert.deepEqual(state, pristine);
  }
  for (const mutate of [
    (copy: any) => { copy.production.constructionHosts[0].actors[3].health = 0; },
    (copy: any) => { copy.production.constructionHosts[0].configuration.profiles.build.first++; },
    (copy: any) => { copy.production.teams[0].credits++; },
    (copy: any) => { copy.receipts[0].intents[0].packet[3] = 2; },
  ]) {
    const copy = structuredClone(state);
    mutate(copy);
    assert.throws(() => restoreCampaignAiCity(copy, initial));
  }
  assert.throws(() => restoreCampaignCityProduction(state.production, { ...initial.production, constructionHosts: [] }));
});

test("original restrictions block science; unsupported harvester demand rolls back its native debit", () => {
  const initial = cityFixture(proof.cases[0]);
  const harvester = structuredClone(initial);
  new DataView(harvester.ai.policy.buffer).setInt32(0x1faa, -1, true);
  const before = structuredClone(harvester);
  assert.throws(() => transactCampaignAiCity(harvester, { id: "unsupported-harvester", sequence: 0, stage: "demand" }), /Unsupported next native unit/);
  assert.deepEqual(harvester, before);
  const blocked = structuredClone(initial) as any;
  blocked.production.teams[0].restrictions.push(2);
  blocked.inputs.teamBytes[0xda4 + 2] = 1;
  const debit = reduceCampaignProduction(blocked.production, { id: "blocked:credits", team: 1,
    action: { type: "sync-credits", expectedPreviousCredits: 6000, credits: 4000 } });
  assert.throws(() => reduceCampaignProduction(debit, { id: "blocked", team: 1,
    action: { type: "receive-prepaid-city", dependency: 2, slot: 3, level: 0, expectedCredits: 4000,
      provenance: { code: "campaign-ai", receiptKey: "blocked", sourceSha256: proof.sha256 } } }), /eligible/);
});

for (const golden of proof.cases) test(`race ${golden.race}: actual mode9 constructor and every normal registered visit`, () => {
  const config = constructionConfiguration(golden);
  let host = receiveNativeConstruction(createNativeConstructionHost(config), "source-city-receipt");
  assert.deepEqual(golden.lifecycleInterceptedCalls, []);
  for (const [index, expected] of golden.trace.entries()) {
    if (index > 0) host = visitNativeConstruction(host, { sequence: index - 1, counter: 4,
      mainHealth: 2400, auxiliaryHealth: host.actors[6]?.health ?? 0,
      registeredSlots: nativeConstructionRegisteredSlots(host) });
    assert.deepEqual([host.busy, host.latch], [expected.busy, expected.latch], `visit ${index}`);
    for (const [slot, actor] of [[3, expected.main], [6, expected.auxiliary]] as const) {
      const actual = host.actors[slot];
      if (!actual) { assert.equal(actor.status, 0); continue; }
      assert.deepEqual([actual.nativeId, actual.unitType, actual.team, actual.health, actual.status,
        actual.registered ? actual.nativeId : 65535, actual.task, actual.phase, actual.movementCounter,
        actual.animation.profile, actual.animation.frame, actual.animation.delay, actual.animation.mode],
      [actor.id, actor.type, actor.team, actor.hp, actor.status, actor.activeSlot, actor.task, actor.phase,
        actor.movementCounter, actor.animation.state, actor.animation.frame, actor.animation.delay, actor.animation.mode],
      `visit ${index} slot ${slot}`);
    }
    const auxiliary = host.actors[6];
    assert.deepEqual([host.actors[3]!.position.x, host.actors[3]!.position.y], expected.position);
    if (auxiliary) assert.deepEqual([auxiliary.position.x, auxiliary.position.height, auxiliary.position.y], expected.auxiliaryPosition);
    if ([1, 52, 135, 195, golden.trace.length - 1].includes(index)) {
      assert.deepEqual(restoreNativeConstructionHost(JSON.parse(JSON.stringify(host)), config), host);
    }
  }
  assert.equal(host.ready, true);
  assert.equal(host.visits, golden.race === 0 ? 186 : 246);
  assert.equal(host.reservedAuxiliary, null);
  assert.equal(host.actors[6]!.status, 1);
  assert.equal(host.actors[6]!.registered, false);
  assert.throws(() => receiveNativeConstruction(host, "overwrite"), /occupied/);
});
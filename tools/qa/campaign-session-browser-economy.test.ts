import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CampaignSession, type CampaignSessionInput, type CampaignSessionOptions } from "../../src/engine/campaign-session";
import { createBrowserAiSelectorConfiguration } from "../../src/engine/browser-campaign-runtime";
import { createBrowserCampaignEconomyProfile, sourceBrowserEconomyHarvesters } from "../../src/engine/browser-campaign-economy-source";
import { BrowserCampaignEconomy } from "../../src/engine/browser-campaign-economy";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { NavigationGrid } from "../../src/engine/grid";
import { createLegacyInfantryFamilyMask } from "../../src/engine/legacy-navigation";
import { loadSourceProductionOptions, sourceProductionVisits } from "../../src/engine/source-production-options";
import { transportHostState } from "../../src/engine/transport-host";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { parseScenario } from "../extractors/data/scenario";
import { parseMapBundle } from "../extractors/maps/map";
import { parseTriggerScript } from "../extractors/data/triggers";
import { parseMissionMessages } from "../extractors/data/messages";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
const units = parseUnitStats(read("raw_cd/DC/GAMESTAT/GAMESTAT.TXT").toString());
const weapons = parseWeaponStats(read("raw_cd/DC/GAMESTAT/WEAPSTAT.TXT").toString());

function options(faction: "human" | "alien" = "human"): CampaignSessionOptions {
  const name = `${faction.toUpperCase()}02`, stem = `${faction.toUpperCase()}/${name}`;
  const asset = (extension: string) => read(`raw_cd/DC/SCENARIO/${stem}.${extension}`);
  const source = parseScenario(asset("SCN").toString());
  const map = parseMapBundle(asset("MAP"), asset("MTG"), asset("PTH"));
  return { sessionId: name, source, units, weapons,
    runtimeProfile: "browser-adapted", browserAi: createBrowserAiSelectorConfiguration(source),
    messages: parseMissionMessages(asset("MSG").toString()), triggers: parseTriggerScript(asset("TRO").toString()),
    map, pathGrid: map.pathGrid, tags: map.tagGrid,
    commanders: [{ team: 0, unitType: faction === "human" ? 69 : 73, sprite: faction === "human" ? "TRSC" : "GRAY" }],
    directionBits: Array.from({ length: 64 }, () => [0, 0] as const), fixedStepMilliseconds: 50,
    orientationSteps: 1, resourceScales: "configured-startup" };
}

test("session economy: unowned receipts reject atomically", () => {
  const session = new CampaignSession(options());
  const before = session.checkpoint();
  const result = session.step({ clockMilliseconds: 50, economyIncome: [] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.diagnostics[0].message, /source profile ownership/);
  assert.deepEqual(session.checkpoint(), before);
});

async function ownedOptions(faction: "human" | "alien" = "human") {
  const initial = options(faction);
  const browserEconomy = await createBrowserCampaignEconomyProfile({ scope: "browser-adapted-economy-v1",
    world: new CampaignSession(initial).snapshot.world,
    teams: initial.source.teams as Parameters<typeof createBrowserCampaignEconomyProfile>[0]["teams"], units });
  return { ...initial, browserEconomy };
}

test("session economy: cumulative income, feedback, fork and schema3 replay preserve balances", async () => {
  const initial = await ownedOptions();
  const session = new CampaignSession(initial);
  const receipt = { scope: initial.browserEconomy.scope, profileId: initial.browserEconomy.profileId,
    sessionId: initial.sessionId, team: 0, earnedTotal: 25 };
  assert.equal(session.snapshot.world.exomoney[0], 0);
  assert.ok(session.step({ clockMilliseconds: 50, economyIncome: [receipt] }).ok);
  assert.ok(session.step({ clockMilliseconds: 100, economyIncome: [receipt] }).ok);
  assert.equal(session.snapshot.world.exomoney[0], 25);
  assert.equal(session.snapshot.controller.runtime.statistics["0,1"], 25);
  const saved = session.checkpoint();
  assert.equal(saved.schemaVersion, 3);
  const restored = CampaignSession.restore(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored.snapshot, session.snapshot);
  assert.deepEqual(session.fork().snapshot, session.snapshot);
  assert.ok(restored.step({ clockMilliseconds: 150, economyIncome: [receipt] }).ok);
  assert.equal(restored.snapshot.world.exomoney[0], 25);
});

function receipt(initial: Awaited<ReturnType<typeof ownedOptions>>, earnedTotal: number, team = 0) {
  return { scope: initial.browserEconomy.scope, profileId: initial.browserEconomy.profileId,
    sessionId: initial.sessionId, team, earnedTotal };
}

function advance(session: CampaignSession, extra: Omit<CampaignSessionInput, "clockMilliseconds"> = {}) {
  const snapshot = session.snapshot;
  const input = { clockMilliseconds: snapshot.world.clockMilliseconds + 50,
    ...(snapshot.production ? { productionVisits: sourceProductionVisits(snapshot.world, snapshot.production, 150) } : {}), ...extra };
  const result = session.step(input);
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}

test("session economy: same-frame casualty and income preserve both statistic owners", async () => {
  const initial = await ownedOptions("alien"), session = new CampaignSession(initial);
  const before = session.snapshot;
  const victim = before.world.entities.find(actor => actor.team === 1 && actor.unitType === 86)!;
  assert.ok(victim);
  const updates = [{ type: "combat-death" as const, slot: victim.rawSlot!, generation: victim.generation! }];
  advance(session, { updates, economyIncome: [receipt(initial, 25)] });
  const state = session.snapshot;
  const lossId = JSON.stringify([initial.sessionId, victim.key, victim.generation]);
  assert.deepEqual(state.controller.consumedLosses[lossId], { id: lossId, victimTeam: 1, victimType: 86 });
  const expected = { ...before.world.statistics, "1,3": 1, "1,0,86": 1, "0,1": 25 };
  assert.deepEqual(state.controller.runtime.statistics, expected);
  assert.deepEqual(state.world.statistics, state.controller.runtime.statistics);
  for (const economyIncome of [[receipt(initial, 25)], [], [receipt(initial, 40)]]) {
    advance(session, { updates, economyIncome });
    if (economyIncome[0]?.earnedTotal === 40) expected["0,1"] = 40;
    assert.deepEqual(session.snapshot.world.statistics, expected);
    assert.deepEqual(session.snapshot.controller.runtime.statistics, expected);
    assert.deepEqual(session.snapshot.controller.consumedLosses, state.controller.consumedLosses);
    assert.equal(session.snapshot.world.exomoney[0], expected["0,1"]);
  }
  const saved = session.checkpoint(), restored = CampaignSession.restore(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored.checkpoint(), saved);
  for (const candidate of [session, restored]) advance(candidate, { updates, economyIncome: [receipt(initial, 45)] });
  assert.deepEqual(restored.checkpoint(), session.checkpoint());
});

test("session economy: dynamic casualty and zero-delta receipt remain exactly once", async () => {
  const initial = await ownedOptions(), session = new CampaignSession(initial);
  advance(session, { economyIncome: [receipt(initial, 25)] });
  const before = session.snapshot;
  const victim = before.world.entities.find(actor => actor.team < 8 && !actor.resource
    && !before.staticSlots.includes(actor.rawSlot!) && before.world.entityBytes![actor.rawSlot! * 220 + 0x2c] === 1)!;
  assert.ok(victim);
  const updates = [{ type: "combat-death" as const, slot: victim.rawSlot!, generation: victim.generation! }];
  const expected = { ...before.world.statistics, [`${victim.team},3`]: 1, [`${victim.team},0,${victim.unitType}`]: 1 };
  for (let frame = 0; frame < 3; frame++) {
    advance(session, { updates, economyIncome: [receipt(initial, 25)] });
    assert.deepEqual(session.snapshot.world.statistics, expected);
    assert.deepEqual(session.snapshot.controller.runtime.statistics, expected);
    assert.equal(Object.keys(session.snapshot.controller.consumedLosses).length, 1);
    assert.equal(session.snapshot.browserEconomyLedger!.earned[0], 25);
  }
  assert.deepEqual(CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint()))).checkpoint(), session.checkpoint());
});

test("session economy: static casualty survives paid production, TRO namespaces and replay", async () => {
  const initial = await ownedOptions("alien");
  const loaded = await loadSourceProductionOptions({ sessionId: initial.sessionId,
    mission: { faction: "alien", units, scenario: JSON.parse(read("public/assets/generated/data/scenarios/ALIEN/ALIEN02.json").toString()) },
    rawScenario: read("raw_cd/DC/SCENARIO/ALIEN/ALIEN02.SCN"),
    configuration: { profile: "user-selected-source-campaign-fresh", mode: 0, localTeam: 0, race: 1 },
    loadBytes: async url => read(`public${url}`) });
  assert.ok(loaded.production);
  const session = new CampaignSession({ ...initial, production: loaded.production, triggers: [
    { id: 0, mode: "norm", flag: 1, condition: "s(1,0,86)==1", actions: [
      { name: "exomoney", arguments: [0, 50] }, { name: "setarray", arguments: [0, 91] },
      { name: "ai", arguments: [2, 3] },
    ] },
  ] });
  for (let tick = 0; tick < 7; tick++) advance(session);
  const before = session.snapshot;
  const victim = before.world.entities.find(actor => actor.team === 1 && actor.unitType === 86)!;
  assert.ok(victim && before.staticSlots.includes(victim.rawSlot!));
  const updates = [{ type: "combat-death" as const, slot: victim.rawSlot!, generation: victim.generation! }];
  const commands = [
    { id: "casualty-buy", team: 0, action: { type: "reserve" as const, dependency: loaded.choices[0].dependency } },
    { id: "casualty-dispatch", team: 0, action: { type: "dispatch" as const, dependency: loaded.choices[0].dependency } },
  ];
  const frame = advance(session, { updates, economyIncome: [receipt(initial, 400)], productionCommands: commands });
  assert.deepEqual(frame.entry.fired, [0]);
  assert.equal(session.browserAiProjection!.selectors.modes[2], 3);
  const expected = { ...before.world.statistics, "1,3": 1, "1,0,86": 1, "0,1": 400, "0,2,0": 91 };
  assert.deepEqual(session.snapshot.world.statistics, expected);
  assert.deepEqual(session.snapshot.controller.runtime.statistics, expected);
  assert.equal(session.snapshot.world.exomoney[0], 50);
  assert.equal(session.snapshot.production!.teams[0].credits, 50);
  const saved = session.checkpoint(), restored = CampaignSession.restore(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored.checkpoint(), saved);
  for (const candidate of [session, restored]) {
    advance(candidate, { updates, economyIncome: [receipt(initial, 400)], productionCommands: commands });
    advance(candidate, { economyIncome: [receipt(initial, 425)] });
    assert.deepEqual(candidate.snapshot.world.statistics, { ...expected, "0,1": 425 });
    assert.deepEqual(candidate.snapshot.controller.runtime.statistics, candidate.snapshot.world.statistics);
    assert.equal(candidate.snapshot.world.exomoney[0], 75);
    assert.equal(candidate.snapshot.production!.teams[0].credits, 75);
    assert.equal(candidate.snapshot.browserEconomyLedger!.earned[0], 425);
    assert.equal(Object.keys(candidate.snapshot.controller.consumedLosses).length, 1);
  }
  assert.deepEqual(restored.checkpoint(), session.checkpoint());
});

test("session economy: late failure rolls casualty counters, loss receipt and earned ledger back together", async () => {
  const initial = await ownedOptions("alien"), session = new CampaignSession(initial);
  const victim = session.snapshot.world.entities.find(actor => actor.team === 1 && actor.unitType === 86)!;
  assert.ok(victim);
  const updates = [{ type: "combat-death" as const, slot: victim.rawSlot!, generation: victim.generation! }];
  const before = session.checkpoint(), journal = session.journalStats;
  for (let retry = 0; retry < 2; retry++) {
    const failed = session.step({ clockMilliseconds: 50, updates, economyIncome: [receipt(initial, 25)],
      reservations: [{ slot: 799, generation: 99999, tileX: 0, tileY: 0 }] });
    assert.equal(failed.ok, false);
    if (!failed.ok) assert.match(failed.diagnostics[0].message, /Invalid reservation unit/);
    assert.deepEqual(session.checkpoint(), before);
    assert.deepEqual(session.journalStats, journal);
  }
  advance(session, { updates, economyIncome: [receipt(initial, 25)] });
  assert.equal(session.snapshot.world.statistics["1,3"], 1);
  assert.equal(session.snapshot.world.statistics["1,0,86"], 1);
  assert.equal(session.snapshot.world.statistics["0,1"], 25);
  assert.equal(session.snapshot.browserEconomyLedger!.earned[0], 25);
  assert.equal(Object.keys(session.snapshot.controller.consumedLosses).length, 1);
  assert.deepEqual(CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint()))).checkpoint(), session.checkpoint());
});

test("session economy: original ALIEN02 objective observes six source deaths alongside income", async () => {
  const initial = await ownedOptions("alien"), session = new CampaignSession(initial);
  const victims = session.snapshot.world.entities.filter(actor => actor.team === 1 && actor.unitType === 86);
  assert.equal(victims.length, 6);
  const updates = victims.map(victim => ({ type: "combat-death" as const, slot: victim.rawSlot!, generation: victim.generation! }));
  for (let tick = 0; tick < 7; tick++) advance(session);
  const frame = advance(session, { updates, economyIncome: [receipt(initial, 25)] });
  assert.ok(frame.entry.fired.includes(4));
  assert.equal(frame.controller.runtime.statistics["1,0,86"], 6);
  assert.equal(frame.controller.runtime.statistics["1,3"], 6);
  assert.equal(frame.controller.runtime.statistics["0,1"], 25);
  assert.equal(frame.controller.runtime.bail?.resultCode, 0);
  assert.equal(frame.controller.runtime.bail?.reasonCode, 1);
  assert.equal(Object.keys(frame.controller.consumedLosses).length, 6);
  assert.deepEqual(frame.controller.blocks, initial.triggers);
  const saved = session.checkpoint(), restored = CampaignSession.restore(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored.checkpoint(), saved);
  for (const candidate of [session, restored]) advance(candidate, { updates, economyIncome: [receipt(initial, 25)] });
  assert.deepEqual(restored.checkpoint(), session.checkpoint());
  assert.equal(session.snapshot.world.statistics["1,0,86"], 6);
});

test("session economy: original HUMAN02 commander casualty arms recovery rather than a fabricated loss", async () => {
  const initial = await ownedOptions(), session = new CampaignSession(initial);
  for (let tick = 0; tick < 300 && !session.snapshot.world.entities.some(actor => actor.team === 0 && actor.unitType === 69
    && session.snapshot.world.entityBytes![actor.rawSlot! * 220 + 0x2c] === 1); tick++) advance(session);
  const victim = session.snapshot.world.entities.find(actor => actor.team === 0 && actor.unitType === 69)!;
  assert.ok(victim);
  const updates = [{ type: "combat-death" as const, slot: victim.rawSlot!, generation: victim.generation! }];
  let frame = advance(session, { updates, economyIncome: [receipt(initial, 25)] });
  while ((frame.cycleCounter & 7) !== 0) frame = advance(session, { updates, economyIncome: [receipt(initial, 25)] });
  assert.ok(frame.entry.fired.includes(18));
  assert.equal(frame.controller.runtime.statistics["0,0,69"], 1);
  assert.equal(frame.controller.runtime.statistics["0,3"], 1);
  assert.equal(frame.controller.runtime.statistics["0,1"], 25);
  assert.ok(frame.controller.runtime.statistics["0,2,0"] > 0);
  assert.equal(frame.controller.runtime.lives[19], 1);
  assert.equal(frame.controller.runtime.bail, null);
  assert.deepEqual(frame.world.statistics, frame.controller.runtime.statistics);
  assert.deepEqual(frame.controller.blocks, initial.triggers);
  assert.deepEqual(CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint()))).checkpoint(), session.checkpoint());
});

test("session economy: canonical fresh source profile and exclusive ownership reject fabricated configuration", async () => {
  const initial = await ownedOptions();
  for (const change of [
    { runtimeProfile: "strict-native", browserAi: undefined }, { browserAi: undefined },
    { resourceInitialIncome: Array(8).fill(0) },
    { resourceLifecycle: { animations: [], types: [], bindings: [] } },
    { resourceScales: { rateScale: 512, reserveScale: 256 } },
    { browserEconomy: { ...initial.browserEconomy, profileId: "__proto__" } },
    { browserEconomy: { ...initial.browserEconomy, sessionId: "constructor" } },
    { browserEconomy: { ...initial.browserEconomy, initialCredits: { ...initial.browserEconomy.initialCredits, 0: 100 } } },
    { browserEconomy: { ...initial.browserEconomy, nodes: initial.browserEconomy.nodes.slice(1) } },
    { browserEconomy: { ...initial.browserEconomy, nodes: initial.browserEconomy.nodes.map(node => ({ ...node, amount: node.amount + 1 })) } },
    { browserEconomy: { ...initial.browserEconomy, harvesters: [{ key: "fabricated" }] } },
    { browserEconomy: { ...initial.browserEconomy, dropoffs: [] } },
    { browserEconomy: { ...initial.browserEconomy, policy: { ...initial.browserEconomy.policy, extractionPeriodTicks: 44 } } },
    { browserEconomy: { ...initial.browserEconomy, extra: true } },
  ]) assert.throws(() => new CampaignSession({ ...initial, ...change } as CampaignSessionOptions));
  const changedSource = structuredClone(initial);
  (changedSource.source.teams[7] as { money: number }).money += 1;
  changedSource.browserAi = createBrowserAiSelectorConfiguration(changedSource.source);
  assert.throws(() => new CampaignSession(changedSource), /fresh source/);
  const sparse = structuredClone(initial);
  delete (sparse.browserEconomy.nodes as unknown[])[0];
  Object.assign(sparse.browserEconomy.nodes, { extra: "compensating array key" });
  assert.throws(() => new CampaignSession(sparse), /sparse array/);
  const polluted = structuredClone(initial);
  Object.setPrototypeOf(polluted.browserEconomy.initialCredits, { extra: 100 });
  assert.throws(() => new CampaignSession(polluted), /prototype/);
  const fresh = new CampaignSession(initial).snapshot;
  assert.deepEqual(fresh.world.exomoney, Object.fromEntries(initial.source.teams.map(team => [team.index, team.money])));
  assert.deepEqual(fresh.browserEconomyLedger!.earned, {});
});

test("session economy: dense receipt preflight, team identities, regressions and global reserve bound are atomic", async () => {
  const initial = await ownedOptions(), session = new CampaignSession(initial);
  advance(session, { economyIncome: [receipt(initial, 25)] });
  const before = session.checkpoint(), journal = session.journalStats;
  const sparse = [receipt(initial, 26), receipt(initial, 26)];
  delete sparse[0];
  Object.assign(sparse, { extra: receipt(initial, 26) });
  const polluted = Object.setPrototypeOf({ ...receipt(initial, 26) }, { earnedTotal: 500 });
  const unknown = JSON.parse(JSON.stringify(receipt(initial, 26)).replace('"team":0', '"__proto__":{},"team":0'));
  const reserve = initial.browserEconomy.nodes.reduce((total, node) => total + node.amount, 0);
  for (const economyIncome of [sparse, [polluted], [unknown],
    [{ ...receipt(initial, 26), profileId: "constructor" }], [{ ...receipt(initial, 26), sessionId: "__proto__" }],
    [receipt(initial, 26, 8)], [receipt(initial, -1)], [receipt(initial, NaN)], [receipt(initial, 26.5)],
    [receipt(initial, 24)], [receipt(initial, 30), receipt(initial, 29)],
    [receipt(initial, reserve + 1)], [receipt(initial, reserve), receipt(initial, 1, 1)],
  ]) {
    assert.equal(session.step({ clockMilliseconds: 100, economyIncome }).ok, false);
    assert.deepEqual(session.checkpoint(), before);
    assert.deepEqual(session.journalStats, journal);
  }
  advance(session, { economyIncome: [receipt(initial, 25), receipt(initial, 25), receipt(initial, 25, 7)] });
  assert.equal(session.snapshot.world.exomoney[0], 25);
  assert.equal(session.snapshot.world.exomoney[7], initial.source.teams[7].money! + 25);
  assert.equal(session.snapshot.world.statistics["7,1"], 25);
});

test("session economy: checkpoint mutations reject source, ledger, history and schema inconsistencies", async () => {
  const initial = await ownedOptions(), session = new CampaignSession(initial);
  advance(session, { economyIncome: [receipt(initial, 25)] });
  const saved = session.checkpoint();
  const changes: ((copy: any) => void)[] = [
    copy => { copy.schemaVersion = 2; },
    copy => { delete copy.state.browserEconomyLedger; },
    copy => { delete copy.options.browserEconomy; },
    copy => { copy.options.browserEconomy.nodes[0].amount += 1; },
    copy => { copy.options.browserEconomy.initialCredits[7] += 1; },
    copy => { copy.options.browserEconomy.profileId = "fake"; },
    copy => { copy.state.browserEconomyLedger.earned[0] += 1; },
    copy => { copy.state.browserEconomyLedger.earned.constructor = 1; },
    copy => { copy.state.browserEconomyLedger.sessionId = "wrong"; },
    copy => { copy.state.world.exomoney[0] += 1; },
    copy => { copy.state.world.statistics["0,1"] += 1; },
    copy => { delete copy.state.aiSelectorInputs[0].economyIncome; },
    copy => { copy.state.aiSelectorInputs[0].economyIncome[0].earnedTotal += 1; },
    copy => { copy.state.aiSelectorInputs.pop(); },
  ];
  for (const change of changes) {
    const copy = JSON.parse(JSON.stringify(saved));
    change(copy);
    assert.throws(() => CampaignSession.restore(copy), String(change));
  }
  assert.deepEqual(CampaignSession.restore(JSON.parse(JSON.stringify(saved))).checkpoint(), saved);
});

test("session economy: TRO exomoney plus income survives feedback and replay without resetting either", async () => {
  const initial = await ownedOptions();
  const session = new CampaignSession({ ...initial, triggers: [
    { id: 0, mode: "norm", flag: 1, condition: "1", actions: [{ name: "exomoney", arguments: [0, 50] }] },
    { id: 1, mode: "norm", flag: 1, condition: "s(0,1)>24", actions: [{ name: "ai", arguments: [2, 3] }] },
  ] });
  for (let tick = 0; tick < 8; tick++) advance(session);
  assert.equal(session.snapshot.world.exomoney[0], 50);
  advance(session, { economyIncome: [receipt(initial, 25)] });
  for (let tick = 0; tick < 7; tick++) advance(session, { economyIncome: [receipt(initial, 25)] });
  assert.equal(session.snapshot.world.exomoney[0], 75);
  assert.equal(session.snapshot.world.statistics["0,1"], 25);
  assert.equal(session.snapshot.controller.runtime.statistics["0,1"], 25);
  assert.equal(session.browserAiProjection!.selectors.modes[2], 3);
  assert.deepEqual(CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint()))).checkpoint(), session.checkpoint());
});

test("session economy: later TRO failure rolls income back and the same receipt can be retried", async () => {
  const initial = await ownedOptions();
  const session = new CampaignSession({ ...initial, messages: [], triggers: [
    { id: 0, mode: "norm", flag: 1, condition: "1", actions: [{ name: "exomoney", arguments: [0, 50] }] },
    { id: 1, mode: "norm", flag: 1, condition: "1", actions: [{ name: "msg", arguments: [0, 0, 29, 0, 0] }] },
  ] });
  for (let tick = 0; tick < 7; tick++) advance(session);
  const before = session.checkpoint();
  for (let retry = 0; retry < 2; retry++) {
    const failed = session.step({ clockMilliseconds: 400, economyIncome: [receipt(initial, 25)] });
    assert.equal(failed.ok, false);
    if (!failed.ok) assert.match(failed.diagnostics[0].message, /Missing message/);
    assert.deepEqual(session.checkpoint(), before);
  }
});

for (const faction of ["human", "alien"] as const) {
  test(`session economy ${faction}: original carrier, extraction, 350 debit, FIN spawn, rollback and restore`, async () => {
    const initial = await ownedOptions(faction), profile = initial.browserEconomy;
    const stem = `${faction.toUpperCase()}/${faction.toUpperCase()}02`;
    const loaded = await loadSourceProductionOptions({ sessionId: initial.sessionId,
      mission: { faction, units, scenario: JSON.parse(read(`public/assets/generated/data/scenarios/${stem}.json`).toString()) },
      rawScenario: read(`raw_cd/DC/SCENARIO/${stem}.SCN`),
      configuration: { profile: "user-selected-source-campaign-fresh", mode: 0, localTeam: 0, race: faction === "human" ? 0 : 1 },
      loadBytes: async url => read(`public${url}`) });
    assert.ok(loaded.production);
    const session = new CampaignSession({ ...initial, production: loaded.production, journalLimit: 1 });
    assert.equal(session.snapshot.world.exomoney[0], 0);
    assert.equal(session.snapshot.production!.teams[0].credits, 0);
    assert.equal(profile.harvesters.filter(actor => actor.team === 0).length, 0);
    const simulation = new DeterministicSimulation(new NavigationGrid(initial.map.width, initial.map.height,
      Uint16Array.from(createLegacyInfantryFamilyMask({ ...initial.map, pathGrid: initial.pathGrid }))),
    { initialResources: { [faction]: 0 } });
    for (const node of profile.nodes) simulation.addStaticTarget({ faction, team: 8, cell: node.cell,
      maxHealth: Math.max(1, node.amount), footprint: [node.cell] });
    const bindings = profile.harvesters.map(actor => ({ key: actor.key, simulationId: simulation.addUnit(actor.options) }));
    const owner = new BrowserCampaignEconomy(profile, simulation, bindings);
    for (let tick = 0; tick < 300 && !session.snapshot.world.entities.some(actor => actor.team === 0
      && actor.unitType === (faction === "human" ? 6 : 14)); tick++) advance(session);
    const harvester = sourceBrowserEconomyHarvesters(session.snapshot.world, units).find(actor => actor.team === 0)!;
    assert.ok(harvester);
    assert.equal(harvester.typeId, faction === "human" ? 6 : 14);
    const simulationId = simulation.addUnit(harvester.options);
    owner.bindHarvester(simulation, harvester, simulationId);
    const node = profile.nodes.find(candidate => candidate.rateWord > 0
      && owner.harvest(simulation, [simulationId], candidate.key, 0).length > 0);
    assert.ok(node);
    const earn = (minimum: number) => {
      for (let tick = 0; tick < 4000 && owner.income[0].earnedTotal < minimum; tick++) {
        simulation.advance(); owner.observe(simulation);
      }
      assert.ok(owner.income[0].earnedTotal >= minimum);
    };
    earn(350);
    const firstEarned = owner.income[0].earnedTotal;
    assert.equal(node.amount - owner.checkpoint().remaining[node.key], firstEarned);
    const commands = [
      { id: "buy", team: 0, action: { type: "reserve" as const, dependency: loaded.choices[0].dependency } },
      { id: "dispatch", team: 0, action: { type: "dispatch" as const, dependency: loaded.choices[0].dependency } },
    ];
    assert.equal(loaded.choices[0].cost, 350);
    const unfunded = session.snapshot;
    assert.equal(session.step({ clockMilliseconds: unfunded.world.clockMilliseconds + 50,
      productionVisits: sourceProductionVisits(unfunded.world, unfunded.production!, 150), productionCommands: commands }).ok, false);
    assert.deepEqual(session.snapshot, unfunded);
    advance(session, { economyIncome: owner.income, productionCommands: commands });
    assert.equal(session.snapshot.world.exomoney[0], firstEarned - 350);
    advance(session, { economyIncome: owner.income, productionCommands: commands });
    assert.equal(session.snapshot.production!.teams[0].credits, firstEarned - 350);
    const saved = JSON.parse(JSON.stringify(session.checkpoint()));
    const restored = CampaignSession.restore(saved);
    assert.deepEqual(restored.checkpoint(), session.checkpoint());
    const beforeKeys = new Set(session.snapshot.world.entities.map(actor => actor.key));
    earn(firstEarned + 25);
    const newEarned = owner.income[0].earnedTotal;
    let spawned = false;
    for (let visit = 0; visit < 250; visit++) {
      const candidate = session.fork();
      advance(candidate, { economyIncome: owner.income });
      const created = candidate.snapshot.world.entities.find(actor => !beforeKeys.has(actor.key)
        && actor.team === 0 && actor.unitType === (faction === "human" ? 0 : 8));
      if (created) {
        const before = session.checkpoint(), snapshot = session.snapshot;
        assert.equal(snapshot.browserEconomyLedger!.earned[0], firstEarned);
        const failed = session.step({ clockMilliseconds: snapshot.world.clockMilliseconds + 50,
          productionVisits: sourceProductionVisits(snapshot.world, snapshot.production!, 150), economyIncome: owner.income,
          reservations: [{ slot: 799, generation: 99999, tileX: 0, tileY: 0 }] });
        assert.equal(failed.ok, false);
        if (!failed.ok) assert.match(failed.diagnostics[0].message, /Invalid reservation unit/);
        assert.deepEqual(session.checkpoint(), before);
        advance(session, { economyIncome: owner.income });
        advance(restored, { economyIncome: owner.income });
        assert.deepEqual(session.checkpoint(), candidate.checkpoint());
        assert.equal(transportHostState(session.snapshot.world).slots[created.rawSlot!]!.key, created.key);
        spawned = true;
        break;
      }
      advance(session, { economyIncome: [receipt(initial, firstEarned)] });
      advance(restored, { economyIncome: [receipt(initial, firstEarned)] });
    }
    assert.ok(spawned, "Actual FIN must allocate the produced type 0/8 host actor");
    assert.deepEqual(restored.checkpoint(), session.checkpoint());
    advance(session, { economyIncome: owner.income, productionCommands: commands });
    assert.equal(session.snapshot.world.exomoney[0], newEarned - 350);
    assert.equal(session.snapshot.production!.teams[0].credits, newEarned - 350);
    assert.equal(session.snapshot.world.statistics["0,1"], newEarned);
    assert.equal(session.snapshot.browserEconomyLedger!.earned[0], newEarned);
    assert.equal(simulation.snapshot.resources[faction], 0);
    assert.deepEqual(session.snapshot.world.source, initial.source);
    assert.deepEqual(session.snapshot.controller.blocks, initial.triggers);
    assert.deepEqual(CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint()))).checkpoint(), session.checkpoint());
  });
}
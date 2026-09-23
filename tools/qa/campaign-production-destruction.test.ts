import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CampaignSession, type CampaignSessionInput, type CampaignSessionOptions } from "../../src/engine/campaign-session";
import { productionChoices } from "../../src/engine/campaign-production";
import { createBrowserAiSelectorConfiguration } from "../../src/engine/browser-campaign-runtime";
import { producerProfiles, sourceProductionTeamSeeds } from "../../src/engine/source-production-options";
import { transportHostState } from "../../src/engine/transport-host";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { NavigationGrid } from "../../src/engine/grid";
import { parseTriggerScript } from "../extractors/data/triggers";
import { parseScenario } from "../extractors/data/scenario";
import { parseDependencies, parseUnitStats, parseWeaponStats } from "../extractors/data/tables";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const units = parseUnitStats(read("raw_cd/DC/GAMESTAT/GAMESTAT.TXT"));
const weapons = parseWeaponStats(read("raw_cd/DC/GAMESTAT/WEAPSTAT.TXT"));
const records = parseDependencies(read("raw_cd/DC/GAMESTAT/DEPEND.TXT"));

function fixture(race: 0 | 1 = 0, team = 0): Omit<CampaignSessionOptions, "source"> & { source: ReturnType<typeof parseScenario> } {
  const original = parseScenario(read("raw_cd/DC/SCENARIO/HUMAN/HUMAN02.SCN"));
  const source = { ...original, placementRows: [], teams: original.teams.map(entry => ({ ...entry, race,
    money: 4000, dependencies: [], coordinateRows: [[0, 0], entry.index === team ? [50, 50] : [0, 0]] as const,
    cityRows: [[1, -1, 1, -1, 1, -1, 1, -1, 1, -1], ...entry.cityRows.slice(1)] })) };
  const offsets = [[0, -3], [2, 3], [-4, 0], [-4, 3]];
  return { sessionId: `adapted-destruction:${race}:${team}`, source, units, weapons, triggers: [], messages: [],
    runtimeProfile: "browser-adapted", browserAi: createBrowserAiSelectorConfiguration(source),
    map: { width: 128, height: 128 }, pathGrid: new Uint8Array(128 * 128).fill(1), tags: new Uint8Array(128 * 128),
    commanders: [{ team, unitType: race ? 73 : 69, sprite: race ? "GRAY" : "TRSC" }],
    directionBits: Array.from({ length: 64 }, () => [0, 0] as const), fixedStepMilliseconds: 16, orientationSteps: 1,
    production: { records, units: records.filter(entry => entry.rawFields[0] === 1).map(entry => {
      const unitType = entry.rawFields[1], raw = units[unitType].rawTail;
      const queue = raw[10] as 0 | 1 | 2 | 3, exitSelector = raw[12] as 0 | 1;
      const [x, y] = exitSelector && (queue === 1 || queue === 2) ? [-5, -1] : offsets[queue];
      return { unitType, queue, exitSelector, exitOffset: { x, y } };
    }), sourceProfiles: producerProfiles(JSON.parse(read(`public/assets/generated/animations/${race ? "ALBU" : "HUBU"}.json`)), race),
    teams: [sourceProductionTeamSeeds(source, units)[team]] } };
}

function advance(session: CampaignSession, extra: Omit<CampaignSessionInput, "clockMilliseconds"> = {}) {
  const state = session.snapshot;
  const result = session.step({ clockMilliseconds: state.world.clockMilliseconds + 16,
    productionVisits: state.production!.teams.map(team => ({ team: team.team, queue: 0, population: 0, populationLimit: 150 })), ...extra });
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}

function purchase(race: 0 | 1 = 0, team = 0) {
  const dependency = records.find(entry => entry.rawFields[0] === 1 && entry.rawFields[1] === race * 8)!.id;
  return [{ id: "reserve", team, action: { type: "reserve" as const, dependency } },
    { id: "dispatch", team, action: { type: "dispatch" as const, dependency } },
    { id: "pending", team, action: { type: "reserve" as const, dependency } }];
}

function death(session: CampaignSession, slot: number) {
  const entity = session.snapshot.world.entities.find(candidate => candidate.rawSlot === slot)!;
  return { type: "combat-death" as const, slot, generation: entity.generation! };
}

for (const race of [0, 1] as const) for (const team of [0, 1]) {
  test(`adapted destruction: race ${race} team ${team} active factory cancellation and replay`, () => {
    const session = new CampaignSession(fixture(race, team));
    advance(session, { productionCommands: purchase(race, team) });
    const saved = JSON.parse(JSON.stringify(session.checkpoint()));
    const restored = CampaignSession.restore(saved);
    const before = session.snapshot;
    const update = death(session, team * 15 + 1);
    const frame = advance(session, { updates: [update] });
    assert.deepEqual(advance(restored, { updates: [update] }), frame);
    const production = frame.production!.teams[0];
    assert.equal(production.credits, 3650);
    assert.equal(production.costAccumulator, 350);
    assert.equal(frame.world.exomoney[team], 3650);
    assert.equal(production.slots[1].health, 0);
    assert.equal(production.queues[0].items.length, 0);
    assert.equal(production.queues[0].activeTicket, null);
    assert.deepEqual(transportHostState(frame.world).productionExits, []);
    assert.equal(transportHostState(frame.world).ground[47 * 128 + 50], -1);
    assert.equal(frame.world.statistics[`${team},3`], 1);
    assert.equal(frame.world.entities.find(entity => entity.rawSlot === update.slot)!.health, 0);
    assert.equal(productionChoices(frame.production!, team).find(choice => choice.dependency === purchase(race, team)[0].action.dependency)!.maxAdditional, 0);
    const after = JSON.parse(JSON.stringify(session.checkpoint()));
    assert.deepEqual(CampaignSession.restore(after).checkpoint(), after);
    advance(session, { updates: [update] });
    assert.equal(session.snapshot.world.statistics[`${team},3`], 1);
    assert.equal(session.snapshot.world.exomoney[team], 3650);
    assert.equal(before.production!.teams[0].slots[1].health > 0, true);
  });
}

test("adapted destruction: strict native production still rejects external factory death atomically", () => {
  const options = fixture();
  const session = new CampaignSession({ ...options, runtimeProfile: "strict-native", browserAi: undefined });
  const before = session.checkpoint();
  const result = session.step({ clockMilliseconds: 16, updates: [death(session, 1)],
    productionVisits: [{ team: 0, queue: 0, population: 0, populationLimit: 150 }] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(JSON.stringify(result.diagnostics), /native destruction\/construction ownership/);
  assert.deepEqual(session.checkpoint(), before);
});

for (const race of [0, 1] as const) for (const slot of [0, 1, 2, 3, 4]) {
  test(`adapted destruction: race ${race} fixed slot ${slot} retains zero-health body and source loss once`, () => {
    const session = new CampaignSession(fixture(race, 1));
    const update = death(session, 15 + slot);
    const before = session.snapshot;
    const victim = before.world.entities.find(entity => entity.rawSlot === update.slot)!;
    const frame = advance(session, { updates: [update, update] });
    assert.equal(frame.production!.teams[0].slots[slot].health, 0);
    assert.equal(frame.world.buildingSlots[`1,${slot}`], 0);
    assert.equal(frame.world.statistics["1,3"], 1);
    assert.equal(frame.world.statistics[`1,0,${victim.unitType}`], 1);
    assert.equal(frame.world.exomoney[1], 4000);
    assert.equal(frame.world.entityBytes![update.slot * 220 + 0x2c], 10);
    assert.equal(frame.entry.requests.some(request => request.type === "unregister"), false);
    assert.equal(transportHostState(frame.world).browserCasualties?.length ?? 0, 0);
    for (const other of [0, 1, 2, 3, 4].filter(index => index !== slot)) {
      assert.equal(frame.production!.teams[0].slots[other].health, before.production!.teams[0].slots[other].health);
    }
    const checkpoint = JSON.parse(JSON.stringify(session.checkpoint()));
    assert.deepEqual(CampaignSession.restore(checkpoint).checkpoint(), checkpoint);
  });
}

for (const race of [0, 1] as const) for (const phase of ["pending", "queued", "spawned"] as const) {
  test(`adapted destruction: race ${race} ${phase} accounting boundary`, () => {
    const options = fixture(race);
    const production = phase === "queued" ? { ...options.production!, teams: options.production!.teams.map(team =>
      ({ ...team, producerDelays: [100, 0, 0, 0] })) } : options.production;
    const session = new CampaignSession({ ...options, production });
    advance(session, { productionCommands: phase === "pending" ? purchase(race).slice(0, 1) : purchase(race) });
    if (phase === "spawned") {
      for (let tick = 0; tick < 100 && !session.snapshot.production!.requests.some(request => request.type === "unit-allocated"); tick++) advance(session);
      assert.ok(session.snapshot.production!.requests.some(request => request.type === "unit-allocated"));
    }
    const before = JSON.parse(JSON.stringify(session.checkpoint()));
    const restored = CampaignSession.restore(before);
    const updates = [death(session, 1)];
    assert.deepEqual(advance(restored, { updates }), advance(session, { updates }));
    const state = session.snapshot, team = state.production!.teams[0];
    assert.equal(team.credits, phase === "pending" ? 4000 : 3650);
    assert.equal(team.costAccumulator, phase === "pending" ? 0 : 350);
    assert.equal(state.world.exomoney[0], team.credits);
    assert.equal(team.queues[0].items.length, 0);
    assert.equal(team.pending[purchase(race)[0].action.dependency], 0);
    const host = transportHostState(state.world);
    assert.equal(host.ground[47 * 128 + 50], phase === "spawned" ? 152 : -1);
    assert.equal(state.world.entities.filter(entity => entity.rawSlot! >= 152).length, phase === "spawned" ? 1 : 0);
    assert.deepEqual(CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint()))).checkpoint(), session.checkpoint());
  });
}

for (const race of [0, 1] as const) test(`adapted destruction: race ${race} dfiddle cancels work without casualties`, () => {
  const options = fixture(race), dependency = purchase(race)[0].action.dependency;
  const triggers = parseTriggerScript(`0 norm 1 (c==0)\ndfiddle 0 ${dependency} 1\nend\n1 norm 1 (c>0)\ndfiddle 0 ${dependency} 0\nend`);
  const session = new CampaignSession({ ...options, triggers });
  advance(session, { productionCommands: purchase(race) });
  for (let tick = 1; tick < 8; tick++) advance(session);
  let state = session.snapshot;
  assert.equal(state.production!.teams[0].credits, 3650);
  assert.equal(state.production!.teams[0].costAccumulator, 350);
  assert.equal(state.production!.teams[0].queues[0].items.length, 0);
  assert.equal(state.world.statistics["0,3"], 0);
  assert.equal(transportHostState(state.world).ground[47 * 128 + 50], -1);
  assert.equal(productionChoices(state.production!, 0).find(choice => choice.dependency === dependency)!.maxAdditional, 0);
  const restored = CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint())));
  for (let tick = 8; tick < 16; tick++) assert.deepEqual(advance(restored), advance(session));
  state = session.snapshot;
  assert.ok(productionChoices(state.production!, 0).find(choice => choice.dependency === dependency)!.maxAdditional > 0);
  assert.equal(state.production!.teams[0].queues[0].items.length, 0);
});

test("adapted destruction: later command rejection rolls back death, refund, source loss and exit release", () => {
  const session = new CampaignSession(fixture());
  advance(session, { productionCommands: purchase() });
  const before = session.checkpoint();
  const result = session.step({ clockMilliseconds: 32, updates: [death(session, 1)],
    productionVisits: [{ team: 0, queue: 0, population: 0, populationLimit: 150 }],
    productionCommands: [{ id: "impossible", team: 0, action: { type: "reserve", dependency: purchase()[0].action.dependency } }] });
  assert.equal(result.ok, false);
  assert.deepEqual(session.checkpoint(), before);
  assert.equal(transportHostState(session.snapshot.world).ground[47 * 128 + 50], 1022);
  advance(session, { updates: [death(session, 1)] });
  assert.equal(session.snapshot.world.exomoney[0], 3650);
});

for (const race of [0, 1] as const) test(`adapted destruction: race ${race} same-frame death wins over pending FIN completion`, () => {
  let session = new CampaignSession(fixture(race));
  advance(session, { productionCommands: purchase(race).slice(0, 2) });
  let completion: CampaignSession | undefined;
  for (let tick = 0; tick < 100; tick++) {
    const next = session.fork();
    const frame = advance(next);
    if (frame.entry.requests.some(request => request.type === "create")) { completion = next; break; }
    session = next;
  }
  assert.ok(completion);
  const restored = CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint())));
  const updates = [death(session, 1)];
  const killed = advance(session, { updates });
  assert.deepEqual(advance(restored, { updates }), killed);
  assert.equal(killed.entry.requests.some(request => request.type === "create"), false);
  assert.equal(killed.world.exomoney[0], 3650);
  assert.equal(killed.production!.teams[0].costAccumulator, 350);
  const spawned = advance(completion, { updates: [death(completion, 1)] });
  assert.equal(spawned.world.entities.filter(entity => entity.rawSlot! >= 152).length, 1);
  assert.equal(spawned.world.exomoney[0], 3650);
  assert.equal(transportHostState(spawned.world).ground[47 * 128 + 50], 152);
});

for (const race of [0, 1] as const) test(`adapted destruction: race ${race} actual engine shots release footprint before host cancellation`, () => {
  const session = new CampaignSession(fixture(race));
  advance(session, { productionCommands: purchase(race) });
  const victim = session.snapshot.world.entities.find(entity => entity.rawSlot === 1)!;
  const simulation = new DeterministicSimulation(new NavigationGrid(7, 3));
  const target = simulation.addStaticTarget({ faction: race ? "alien" : "human", team: 0,
    cell: { x: 3, y: 1 }, maxHealth: victim.health, footprint: [{ x: 3, y: 1 }, { x: 4, y: 1 }] });
  const attacker = simulation.addUnit({ faction: race ? "human" : "alien", team: 1, cell: { x: 2, y: 1 },
    weapon: { damage: 100, rangeCells: 3, cooldownTicks: 1 } });
  simulation.queue({ type: "attack", unitIds: [attacker], targetId: target });
  const simulationRestored = DeterministicSimulation.restore(JSON.parse(JSON.stringify(simulation.checkpoint())));
  let shots = 0;
  for (let tick = 0; tick < 100 && !simulation.deathEvents.length; tick++) {
    simulation.advance(); simulationRestored.advance(); shots += simulation.combatEvents.length;
    assert.deepEqual(simulationRestored.checkpoint(), simulation.checkpoint());
  }
  assert.ok(shots > 0);
  assert.equal(simulation.deathEvents[0].targetId, target);
  assert.equal(simulation.grid.isPassable(3, 1), true);
  assert.equal(simulation.grid.isPassable(4, 1), true);
  const frame = advance(session, { updates: simulation.deathEvents.map(() => death(session, 1)) });
  assert.equal(frame.world.buildingSlots["0,1"], 0);
  assert.equal(frame.world.statistics["0,3"], 1);
  assert.equal(frame.world.exomoney[0], 3650);
  assert.equal(frame.entry.requests.some(request => request.type === "unregister"), false);
  assert.deepEqual(CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint()))).checkpoint(), session.checkpoint());
});

test("adapted destruction: stale generation cannot destroy or refund a current producer", () => {
  const session = new CampaignSession(fixture());
  advance(session, { productionCommands: purchase() });
  const before = session.checkpoint();
  const result = session.step({ clockMilliseconds: 32, updates: [{ ...death(session, 1), generation: 1 }],
    productionVisits: [{ team: 0, queue: 0, population: 0, populationLimit: 150 }] });
  assert.equal(result.ok, false);
  assert.deepEqual(session.checkpoint(), before);
});

test("adapted destruction: only the original all-five-base condition creates HUMAN02 LOSS", () => {
  const options = fixture();
  const triggers = parseTriggerScript(read("raw_cd/DC/SCENARIO/HUMAN/HUMAN02.TRO")).filter(block =>
    block.condition.includes("b(0,0)") && block.actions.some(action => action.name === "bail"));
  assert.equal(triggers.length, 1);
  const session = new CampaignSession({ ...options, triggers });
  advance(session, { updates: [death(session, 0)] });
  for (let tick = 1; tick < 8; tick++) advance(session);
  assert.equal(session.snapshot.controller.runtime.bail, null);
  assert.equal(session.snapshot.world.statistics["0,10"], 0);
  advance(session, { updates: [1, 2, 3, 4].map(slot => death(session, slot)) });
  for (let tick = 9; tick < 16; tick++) advance(session);
  const finalState = session.snapshot;
  assert.ok(finalState.controller.runtime.bail);
  assert.equal(finalState.controller.runtime.bail.resultCode, 1);
  assert.equal(session.snapshot.world.statistics["0,3"], 5);
  assert.deepEqual(CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint()))).checkpoint(), session.checkpoint());
});

test("adapted destruction: legacy pre-casualty checkpoint migrates metadata only after full replay", () => {
  const session = new CampaignSession(fixture());
  advance(session, { productionCommands: purchase() });
  const current = session.checkpoint();
  const legacy = JSON.parse(JSON.stringify(current));
  delete legacy.state.world.browserCasualtyPickup;
  assert.deepEqual(CampaignSession.restore(legacy).checkpoint(), current);
  legacy.state.production.teams[0].credits += 1;
  assert.throws(() => CampaignSession.restore(legacy), /complete source caller replay/);
});

test("adapted destruction: legacy owner omission cannot erase commander casualty ownership", () => {
  const session = new CampaignSession(fixture());
  const legacy = JSON.parse(JSON.stringify(session.checkpoint()));
  delete legacy.state.world.browserCasualtyPickup;
  const id = JSON.stringify([legacy.options.sessionId, "placement:0", 0]);
  legacy.state.controller.consumedLosses[id] = { id, victimTeam: 0, victimType: 69 };
  assert.throws(() => CampaignSession.restore(legacy), /Casualty pickup state requires/);
});

test("adapted destruction: cancellation releases only its ticket and preserves another live factory", () => {
  const options = fixture();
  const source = { ...options.source, teams: options.source.teams.map(team => team.index === 1
    ? { ...team, coordinateRows: [[0, 0], [70, 70]] as const } : team) };
  const teams = sourceProductionTeamSeeds(source, units).filter(team => team.team < 2);
  const session = new CampaignSession({ ...options, source, browserAi: createBrowserAiSelectorConfiguration(source),
    production: { ...options.production!, teams } });
  advance(session, { productionCommands: [...purchase(), ...purchase(0, 1).map(command => ({ ...command, id: `enemy:${command.id}` }))] });
  const before = session.snapshot;
  const survivor = transportHostState(before.world).productionExits!.find(exit => exit.team === 1)!;
  assert.ok(survivor);
  const frame = advance(session, { updates: [death(session, 1)] });
  const host = transportHostState(frame.world);
  assert.deepEqual(host.productionExits, [survivor]);
  assert.equal(host.ground[47 * 128 + 50] & 1023, 1023);
  assert.equal(host.ground[67 * 128 + 70] & 1023, 1022);
  const enemy = frame.production!.teams.find(team => team.team === 1)!;
  assert.equal(enemy.credits, 3300);
  assert.equal(enemy.queues[0].items.length, 1);
  assert.equal(enemy.queues[0].activeTicket, survivor.ticket);
  assert.equal(frame.world.statistics["1,3"], 0);
  assert.deepEqual(CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint()))).checkpoint(), session.checkpoint());
});

test("adapted destruction: base death preserves source-eligible production at the surviving factory", () => {
  const session = new CampaignSession(fixture());
  advance(session, { productionCommands: purchase() });
  const frame = advance(session, { updates: [death(session, 0)] });
  const choice = productionChoices(frame.production!, 0).find(entry => entry.dependency === purchase()[0].action.dependency)!;
  assert.equal(choice.maxAdditional, 9);
  assert.equal(choice.canDispatch, true);
  assert.equal(choice.canReleasePending, true);
  assert.equal(frame.production!.teams[0].queues[0].items.length, 1);
  assert.equal(frame.production!.teams[0].credits, 3300);
  assert.equal(frame.production!.teams[0].costAccumulator, 350);
  assert.equal(frame.world.buildingSlots["0,0"], 0);
  assert.equal(frame.world.buildingSlots["0,1"] > 0, true);
  assert.equal(frame.world.statistics["0,0,16"], 1);
  assert.equal(transportHostState(frame.world).ground[47 * 128 + 50], 1022);
  assert.equal(transportHostState(frame.world).browserCasualties?.length ?? 0, 0);
  assert.equal(frame.entry.requests.some(request => request.type === "unregister"), false);
});
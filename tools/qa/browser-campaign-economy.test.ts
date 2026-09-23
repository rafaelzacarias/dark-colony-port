import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BrowserCampaignEconomy, consumeBrowserEconomyIncome, initializeBrowserEconomyWorld } from "../../src/engine/browser-campaign-economy";
import { createBrowserCampaignEconomyProfile, sourceBrowserEconomyHarvesters } from "../../src/engine/browser-campaign-economy-source";
import { CampaignSession } from "../../src/engine/campaign-session";
import { createCampaignWorld, type CampaignWorld } from "../../src/engine/campaign-world";
import { createBrowserAiSelectorConfiguration } from "../../src/engine/browser-campaign-runtime";
import { reduceCampaignProduction, stepCampaignProductionProducer } from "../../src/engine/campaign-production";
import { loadSourceProductionOptions, sourceProductionPopulation, sourceProductionPopulationLimit } from "../../src/engine/source-production-options";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { NavigationGrid } from "../../src/engine/grid";
import { createLegacyInfantryFamilyMask } from "../../src/engine/legacy-navigation";
import { prepareCampaignResourceRate, transportHostState } from "../../src/engine/transport-host";
import type { CampaignMissionData } from "../../src/game-data";
import { parseScenario } from "../extractors/data/scenario";
import { parseMapBundle } from "../extractors/maps/map";
import { parseTriggerScript } from "../extractors/data/triggers";
import { parseMissionMessages } from "../extractors/data/messages";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
const units: CampaignMissionData["units"] = JSON.parse(read("public/assets/generated/data/units.json").toString()).records;
const weapons = JSON.parse(read("public/assets/generated/data/weapons.json").toString()).records;

async function fixture(faction: "human" | "alien") {
  const name = `${faction.toUpperCase()}02`, stem = `${faction.toUpperCase()}/${name}`;
  const rawScenario = read(`raw_cd/DC/SCENARIO/${stem}.SCN`);
  const source = parseScenario(rawScenario.toString());
  const asset = (extension: string) => read(`raw_cd/DC/SCENARIO/${stem}.${extension}`);
  const map = parseMapBundle(asset("MAP"), asset("MTG"), asset("PTH"));
  const session = new CampaignSession({ sessionId: name, source, units, weapons,
    runtimeProfile: "browser-adapted", browserAi: createBrowserAiSelectorConfiguration(source),
    messages: parseMissionMessages(asset("MSG").toString()), triggers: parseTriggerScript(asset("TRO").toString()), map,
    pathGrid: map.pathGrid, tags: map.tagGrid, commanders: [{ team: 0, unitType: faction === "human" ? 69 : 73,
      sprite: faction === "human" ? "TRSC" : "GRAY" }],
    directionBits: Array.from({ length: 64 }, () => [0, 0] as const), fixedStepMilliseconds: 50,
    orientationSteps: 1, resourceScales: "configured-startup" });
  const profile = await createBrowserCampaignEconomyProfile({ scope: "browser-adapted-economy-v1",
    world: session.snapshot.world, teams: source.teams, units });
  const initialWorld = initializeBrowserEconomyWorld(profile, session.snapshot.world);
  const grid = new NavigationGrid(map.width, map.height, Uint16Array.from(createLegacyInfantryFamilyMask(map)));
  const simulation = new DeterministicSimulation(grid, { initialResources: { [faction]: source.teams[0].money } });
  for (const node of profile.nodes) simulation.addStaticTarget({ faction, team: 8, cell: node.cell,
    maxHealth: Math.max(1, node.amount), footprint: [] });
  const bindings = profile.harvesters.map(actor => ({ key: actor.key, simulationId: simulation.addUnit(actor.options) }));
  const owner = new BrowserCampaignEconomy(profile, simulation, bindings);
  for (let tick = 1; tick <= 300 && !session.snapshot.world.entities.some(actor => actor.team === 0 && actor.unitType === (faction === "human" ? 6 : 14)); tick += 1) {
    const frame = session.step({ clockMilliseconds: tick * 50 });
    assert.ok(frame.ok, JSON.stringify(frame));
  }
  const world = { ...session.snapshot.world, exomoney: initialWorld.exomoney };
  const harvester = sourceBrowserEconomyHarvesters(world, units).find(actor => actor.team === 0)!;
  assert.ok(harvester, `${name} must retain a real team0 harvester`);
  const unitId = simulation.addUnit(harvester.options);
  owner.bindHarvester(simulation, harvester, unitId);
  bindings.push({ key: harvester.key, simulationId: unitId });
  const mission = { faction, units, scenario: JSON.parse(read(`public/assets/generated/data/scenarios/${stem}.json`).toString()) };
  return { faction, world, source, profile, simulation, bindings, owner, unitId, harvester, mission, rawScenario };
}

function startHarvest(context: Awaited<ReturnType<typeof fixture>>) {
  for (const node of context.profile.nodes.filter(entry => entry.rateWord > 0)) {
    if (context.owner.harvest(context.simulation, [context.unitId], node.key, 0).length) return node;
  }
  assert.fail("Expected reachable source VENT from unchanged harvester placement");
}

function step(context: Pick<Awaited<ReturnType<typeof fixture>>, "simulation" | "owner">, count = 1) {
  for (let tick = 0; tick < count; tick += 1) {
    context.simulation.advance();
    context.owner.observe(context.simulation);
  }
}

async function concurrentDepletionFixture(cells = [{ x: 4, y: 3 }, { x: 5, y: 4 }], extractionPeriodTicks = 1) {
  const teams = Array.from({ length: 8 }, (_, index) => ({ index, money: 0, coordinateRows: [] }));
  const source = { id: "synthetic-concurrent-depletion", teams,
    placementRows: [[4, 4, 40, 3, 5], ...cells.map(cell => [cell.x, cell.y, 6, 0, 0])] };
  const created = createCampaignWorld({ sessionId: source.id, source, units, messages: [],
    resourceInitialization: { width: 10, height: 10, firstSlot: 152, scales: { rateScale: 256, reserveScale: 256 } } });
  assert.ok(created.ok, JSON.stringify(created));
  const profile = await createBrowserCampaignEconomyProfile({ scope: "browser-adapted-economy-v1",
    world: created.value, teams, units, extractionPeriodTicks });
  const world = initializeBrowserEconomyWorld(profile, created.value);
  const simulation = new DeterministicSimulation(new NavigationGrid(10, 10, new Uint16Array(100).fill(1)),
    { initialResources: { human: 0 } });
  for (const node of profile.nodes) simulation.addStaticTarget({ faction: "human", team: 8, cell: node.cell,
    maxHealth: node.amount, footprint: [node.cell] });
  const bindings = profile.harvesters.map(actor => ({ key: actor.key, simulationId: simulation.addUnit(actor.options) }));
  const owner = new BrowserCampaignEconomy(profile, simulation, bindings);
  assert.equal(profile.harvesters.length, cells.length);
  assert.equal(new Set(bindings.map(binding => binding.key)).size, cells.length);
  assert.equal(profile.nodes[0].amount, 5);
  assert.equal(profile.nodes[0].rateWord, 3);
  const targets = [{ x: 3, y: 4 }, { x: 4, y: 3 }, { x: 5, y: 4 }];
  const legacyOrders = bindings.map((binding, index) => {
    const target = cells[index].x === 4 && cells[index].y === 3 ? cells[index]
      : cells[index].x === 5 && cells[index].y === 4 ? cells[index] : targets[index];
    simulation.queue({ type: "move", unitIds: [binding.simulationId], target });
    return { simulationId: binding.simulationId, nodeKey: profile.nodes[0].key, target,
      phase: "moving" as const, progressTicks: 0 };
  });
  const legacy = new BrowserCampaignEconomy(profile, simulation, bindings, { ...owner.checkpoint(), orders: legacyOrders });
  return { world, profile, simulation, bindings, owner: legacy, node: profile.nodes[0], ids: bindings.map(binding => binding.simulationId) };
}

function assertDepletedContinuation(context: Awaited<ReturnType<typeof concurrentDepletionFixture>>) {
  const { owner, simulation, ids, node, profile, bindings, world } = context;
  const saved = owner.checkpoint();
  assert.equal(saved.remaining[node.key], 0);
  assert.equal(saved.earned[0], 5);
  assert.equal(Object.values(saved.earned).reduce((sum, amount) => sum + amount, 0),
    profile.nodes.reduce((sum, sourceNode) => sum + sourceNode.amount - saved.remaining[sourceNode.key], 0));
  assert.deepEqual(saved.orders, []);
  assert.equal(simulation.snapshot.resources.human, 0);
  const consumed = consumeBrowserEconomyIncome(world, owner.initialLedger, owner.income);
  assert.equal(consumed.earnedDelta, 5);
  assert.equal(consumed.world.exomoney[0], 5);
  assert.equal(consumed.world.statistics["0,1"], 5);
  assert.equal(world.exomoney[0], 0);
  let restoredSimulation = DeterministicSimulation.restore(JSON.parse(JSON.stringify(simulation.checkpoint())));
  let restoredOwner = new BrowserCampaignEconomy(profile, restoredSimulation, bindings, JSON.parse(JSON.stringify(saved)));
  for (let frame = 0; frame < 2; frame += 1) {
    const before = restoredOwner.checkpoint();
    const beforeSimulation = restoredSimulation.checkpoint();
    assert.deepEqual(restoredOwner.observe(restoredSimulation), owner.income);
    assert.deepEqual(restoredOwner.observe(restoredSimulation), owner.income);
    assert.deepEqual(restoredOwner.checkpoint(), before);
    assert.deepEqual(restoredOwner.harvest(restoredSimulation, ids, node.key, 0), []);
    assert.deepEqual(restoredSimulation.checkpoint(), beforeSimulation);
    step(context);
    step({ simulation: restoredSimulation, owner: restoredOwner });
    assert.deepEqual(restoredOwner.checkpoint(), owner.checkpoint());
    assert.deepEqual(restoredSimulation.checkpoint(), simulation.checkpoint());
    assert.deepEqual(restoredOwner.checkpoint().orders, []);
    assert.equal(restoredOwner.checkpoint().earned[0], 5);
    const repeated = consumeBrowserEconomyIncome(consumed.world, consumed.ledger, restoredOwner.income);
    assert.equal(repeated.earnedDelta, 0);
    assert.deepEqual(repeated.world, consumed.world);
    assert.deepEqual(repeated.ledger, consumed.ledger);
    restoredSimulation = DeterministicSimulation.restore(JSON.parse(JSON.stringify(restoredSimulation.checkpoint())));
    restoredOwner = new BrowserCampaignEconomy(profile, restoredSimulation, bindings,
      JSON.parse(JSON.stringify(restoredOwner.checkpoint())));
  }
  owner.stop(simulation, ids);
  assert.deepEqual(owner.harvest(simulation, ids, node.key, 0), []);
  step(context, 2);
  assert.deepEqual(owner.checkpoint().orders, []);
  assert.equal(owner.checkpoint().earned[0], 5);
}

test("concurrent depletion: legacy adjacent source profile clears earlier extractor after final partial extraction", async () => {
  const context = await concurrentDepletionFixture();
  const { owner, simulation, ids, node } = context;
  assert.deepEqual(owner.harvest(simulation, ids, node.key, 0), []);
  step(context);
  assert.deepEqual(owner.checkpoint().orders.map(order => order.phase), ["extracting", "extracting"]);
  const before = owner.checkpoint();
  owner.observe(simulation); owner.observe(simulation);
  assert.deepEqual(owner.checkpoint(), before);
  step(context);
  assertDepletedContinuation(context);
});

test("concurrent depletion: synthetic unequal progress cancels an earlier incomplete extractor", async () => {
  const context = await concurrentDepletionFixture(undefined, 3);
  const { owner, simulation, ids, node } = context;
  const saved = owner.checkpoint();
  context.owner = new BrowserCampaignEconomy(context.profile, simulation, context.bindings,
    { ...saved, orders: saved.orders.filter(order => order.simulationId === ids[1]) });
  step(context, 4);
  assert.equal(context.owner.checkpoint().earned[0], 3);
  step(context);
  context.owner = new BrowserCampaignEconomy(context.profile, simulation, context.bindings,
    { ...context.owner.checkpoint(), orders: [saved.orders[0], ...context.owner.checkpoint().orders] });
  step(context);
  assert.deepEqual(context.owner.checkpoint().orders.map(order => [order.simulationId, order.phase, order.progressTicks]),
    [[ids[0], "extracting", 0], [ids[1], "extracting", 2]]);
  assert.equal(context.owner.checkpoint().remaining[node.key], 2);
  step(context);
  assertDepletedContinuation(context);
});

test("concurrent depletion: synthetic nonarriving movers before and after extractor lose depleted orders", async () => {
  const context = await concurrentDepletionFixture([{ x: 1, y: 1 }, { x: 4, y: 3 }, { x: 8, y: 8 }]);
  const { owner, simulation, ids, node } = context;
  assert.deepEqual(owner.harvest(simulation, ids, node.key, 0), []);
  step(context, 2);
  const before = owner.checkpoint();
  assert.equal(before.earned[0], 3);
  assert.deepEqual(before.orders.map(order => order.phase), ["moving", "extracting", "moving"]);
  step(context);
  for (const order of before.orders.filter(entry => entry.phase === "moving")) {
    const unit = simulation.snapshot.units.find(entry => entry.id === order.simulationId)!;
    assert.notDeepEqual([unit.xSubcells, unit.ySubcells], [(order.target.x + 0.5) * 1024, (order.target.y + 0.5) * 1024]);
  }
  assertDepletedContinuation(context);
});

test("concurrent depletion: unsynchronized calls and invalid checkpoints preserve inputs", async () => {
  const context = await concurrentDepletionFixture();
  const { owner, simulation, ids, node, profile, bindings, world } = context;
  owner.harvest(simulation, ids, node.key, 0);
  step(context);
  const before = owner.checkpoint();
  const invalid = { ...before, remaining: { [node.key]: 0 }, earned: { ...before.earned, 0: 5 } };
  const inputs = structuredClone({ profile, bindings, invalid, world, simulation: simulation.checkpoint() });
  assert.throws(() => new BrowserCampaignEconomy(profile, simulation, bindings, invalid), /invalid checkpoint order/);
  assert.deepEqual({ profile, bindings, invalid, world, simulation: simulation.checkpoint() }, inputs);
  assert.deepEqual(owner.checkpoint(), before);
  simulation.advance();
  const unobserved = simulation.checkpoint();
  assert.throws(() => owner.harvest(simulation, ids, node.key, 0), /observe simulation/);
  assert.throws(() => owner.stop(simulation, ids), /observe simulation/);
  assert.deepEqual(owner.checkpoint(), before);
  assert.deepEqual(simulation.checkpoint(), unobserved);
  simulation.advance();
  const skipped = simulation.checkpoint();
  assert.throws(() => owner.observe(simulation), /one observation/);
  assert.deepEqual(owner.checkpoint(), before);
  assert.deepEqual(simulation.checkpoint(), skipped);
  const ledger = owner.initialLedger;
  const receipts = [{ ...owner.income[0], earnedTotal: 5 }, { ...owner.income[0], earnedTotal: 4 }];
  const beforeIncome = structuredClone({ world, ledger, receipts });
  assert.throws(() => consumeBrowserEconomyIncome(world, ledger, receipts), /regressed/);
  assert.deepEqual({ world, ledger, receipts }, beforeIncome);
});

for (const faction of ["human", "alien"] as const) {
  test(`${faction}: original SCN zero money, source pose, finite reserve and earned 350-credit FIN spawn`, async () => {
    const context = await fixture(faction);
    const { profile, simulation, owner, unitId, world, source, harvester } = context;
    assert.equal(world.exomoney[0], 0);
    assert.equal(simulation.snapshot.resources[faction], 0);
    assert.equal(harvester.options.speedSubcellsPerTick, 160);
    assert.equal(harvester.options.health, 800);
    assert.equal(harvester.typeId, faction === "human" ? 6 : 14);
    assert.equal(harvester.options.harvester, undefined);
    const sourceActor = world.entities.find(actor => actor.key === harvester.key)!;
    assert.equal(simulation.snapshot.units.find(unit => unit.id === unitId)!.xSubcells, (sourceActor.tileX + 0.5) * 1024);
    assert.deepEqual(profile.nodes.map(node => [node.amount, node.rateWord]),
      world.entities.filter(entity => entity.unitType === 40).map(entity => [entity.health, entity.resource!.rateWord]));
    assert.equal(profile.nodes.length, faction === "human" ? 4 : 3);
    assert.deepEqual(profile.dropoffs.find(base => base.team === 0)?.cell,
      { x: source.teams[0].coordinateRows[1][0], y: source.teams[0].coordinateRows[1][1] });
    const production = await loadSourceProductionOptions({ sessionId: world.sessionId, mission: context.mission,
      rawScenario: context.rawScenario, configuration: { profile: "user-selected-source-campaign-fresh", mode: 0,
        race: faction === "human" ? 0 : 1, localTeam: 0 }, loadBytes: async url => read(`public${url}`) });
    assert.ok(production.state);
    const choice = production.choices[0];
    assert.equal(choice.cost, 350);
    assert.throws(() => reduceCampaignProduction(production.state!, { id: "unfunded", team: 0,
      action: { type: "reserve", dependency: choice.dependency } }));
    const node = startHarvest(context);
    const order = owner.checkpoint().orders[0];
    assert.deepEqual(order.target, node.cell);
    for (let tick = 0; tick < 4000 && (owner.income.find(receipt => receipt.team === 0)?.earnedTotal ?? 0) < 350; tick += 1) {
      step(context);
      const unit = simulation.snapshot.units.find(entry => entry.id === unitId)!;
      if (owner.checkpoint().earned[0] > 0) assert.deepEqual([unit.xSubcells, unit.ySubcells],
        [(node.cell.x + 0.5) * 1024, (node.cell.y + 0.5) * 1024]);
    }
    const receipt = owner.income.find(entry => entry.team === 0)!;
    assert.ok(receipt.earnedTotal >= 350, JSON.stringify(owner.checkpoint()));
    assert.equal(node.amount - owner.checkpoint().remaining[node.key], receipt.earnedTotal);
    const consumed = consumeBrowserEconomyIncome(world, owner.initialLedger, owner.income);
    assert.equal(consumed.world.exomoney[0], receipt.earnedTotal);
    assert.equal(consumed.world.statistics["0,1"], receipt.earnedTotal);
    assert.equal(world.exomoney[0], 0);
    assert.equal(consumeBrowserEconomyIncome(consumed.world, consumed.ledger, owner.income).earnedDelta, 0);
    let state = reduceCampaignProduction(production.state, { id: "earned", team: 0,
      action: { type: "sync-credits", expectedPreviousCredits: 0, credits: consumed.world.exomoney[0] } });
    state = reduceCampaignProduction(state, { id: "buy", team: 0, action: { type: "reserve", dependency: choice.dependency } });
    state = reduceCampaignProduction(state, { id: "dispatch", team: 0, action: { type: "dispatch", dependency: choice.dependency } });
    let productionWorld: CampaignWorld = { ...consumed.world, exomoney: { ...consumed.world.exomoney, 0: state.teams[0].credits } };
    assert.equal(productionWorld.exomoney[0], receipt.earnedTotal - 350);
    const beforeCount = productionWorld.entities.length;
    for (let visit = 0; visit < 250 && productionWorld.entities.length === beforeCount; visit += 1) {
      const next = stepCampaignProductionProducer(state, productionWorld, { team: 0, queue: 0,
        population: sourceProductionPopulation(productionWorld, 0),
        populationLimit: sourceProductionPopulationLimit(productionWorld, 150) }, `fin:${visit}`);
      state = next.production; productionWorld = next.world;
    }
    assert.equal(productionWorld.entities.length, beforeCount + 1);
    const created = productionWorld.entities.find(entity => !world.entities.some(original => original.key === entity.key))!;
    assert.equal(created.unitType, faction === "human" ? 0 : 8);
    assert.equal(created.team, 0);
    assert.equal(transportHostState(productionWorld).slots[created.rawSlot!]!.key, created.key);
    assert.equal(state.teams[0].credits, receipt.earnedTotal - 350);
    assert.equal(consumeBrowserEconomyIncome(productionWorld, consumed.ledger, owner.income).world.exomoney[0], receipt.earnedTotal - 350);
    assert.equal(simulation.snapshot.resources[faction], 0);
  });
}

test("Stop interrupts movement and extraction without teleport; reissue and restored progress are deterministic", async () => {
  const context = await fixture("human");
  const node = startHarvest(context);
  step(context, 5);
  const beforeStop = context.simulation.snapshot.units.find(unit => unit.id === context.unitId)!;
  context.owner.stop(context.simulation, [context.unitId]);
  step(context, 30);
  const afterStop = context.simulation.snapshot.units.find(unit => unit.id === context.unitId)!;
  assert.deepEqual([afterStop.id, afterStop.xSubcells, afterStop.ySubcells], [beforeStop.id, beforeStop.xSubcells, beforeStop.ySubcells]);
  assert.equal(context.owner.income.find(entry => entry.team === 0)!.earnedTotal, 0);
  assert.deepEqual(context.owner.harvest(context.simulation, [context.unitId], node.key, 0), [context.unitId]);
  for (let tick = 0; tick < 4000 && context.owner.checkpoint().orders[0]?.phase !== "extracting"; tick += 1) step(context);
  assert.equal(context.owner.checkpoint().orders[0]?.phase, "extracting");
  step(context, 7);
  assert.equal(context.owner.checkpoint().orders[0].progressTicks, 7);
  const simulation = DeterministicSimulation.restore(JSON.parse(JSON.stringify(context.simulation.checkpoint())));
  const owner = new BrowserCampaignEconomy(context.profile, simulation, context.bindings,
    JSON.parse(JSON.stringify(context.owner.checkpoint())));
  step(context, 100); step({ simulation, owner }, 100);
  assert.deepEqual(owner.checkpoint(), context.owner.checkpoint());
  assert.deepEqual(simulation.checkpoint(), context.simulation.checkpoint());
  const earned = context.owner.income.find(entry => entry.team === 0)!.earnedTotal;
  context.owner.stop(context.simulation, [context.unitId]);
  step(context, 40);
  assert.equal(context.owner.income.find(entry => entry.team === 0)!.earnedTotal, earned);
  assert.equal(context.owner.checkpoint().orders.length, 0);
});

test("selection filtering, dormant VENT, unreachable order, replay guards and no fabricated source", async () => {
  const context = await fixture("alien");
  const { owner, simulation, unitId, profile } = context;
  const dormant = profile.nodes.find(node => node.rateWord === 0)!;
  assert.deepEqual(owner.harvest(simulation, [unitId], dormant.key, 0), []);
  const active = profile.nodes.find(node => node.rateWord > 0)!;
  assert.deepEqual(owner.harvest(simulation, [unitId], active.key, 1), []);
  assert.deepEqual(owner.harvest(simulation, [999999], active.key, 0), []);
  assert.deepEqual(owner.harvest(simulation, [999999, unitId, unitId], active.key, 0), [unitId]);
  const before = owner.checkpoint();
  owner.observe(simulation); owner.observe(simulation);
  assert.deepEqual(owner.checkpoint(), before);
  assert.throws(() => new BrowserCampaignEconomy(profile, simulation, context.bindings,
    { ...before, earned: { ...before.earned, 0: 1 } }), /conservation/);
  assert.throws(() => consumeBrowserEconomyIncome(context.world, owner.initialLedger,
    [{ ...owner.income[0], profileId: "wrong" }]), /identity/);
  simulation.advance(); simulation.advance();
  assert.throws(() => owner.observe(simulation), /one observation/);
  const emptyWorld = { ...context.world, clockMilliseconds: 0, entities: context.world.entities.filter(entity => entity.unitType !== 40
    && entity.unitType !== 6 && entity.unitType !== 14), buildingSlots: {} };
  const empty = await createBrowserCampaignEconomyProfile({ scope: profile.scope, world: emptyWorld,
    teams: context.source.teams, units });
  assert.deepEqual(empty.nodes, []); assert.deepEqual(empty.harvesters, []); assert.deepEqual(empty.dropoffs, []);
});

test("actual scripted newrate activates its source VENT; unreachable routes leave orders and reserves intact", async () => {
  const context = await fixture("human");
  const action = parseTriggerScript(read("raw_cd/DC/SCENARIO/HUMAN/HUMAN02.TRO").toString())
    .flatMap(block => block.actions).find(entry => entry.name === "newrate")!;
  const [rate, tileX, tileY] = action.arguments as number[];
  const changed = prepareCampaignResourceRate(context.world, { id: "original-newrate", triggerId: 8,
    actionIndex: 0, action, command: { kind: "newrate", rate, tileX, tileY } });
  assert.ok(changed.ok, JSON.stringify(changed));
  const node = context.profile.nodes.find(entry => entry.cell.x === tileX && entry.cell.y === tileY)!;
  assert.equal(context.owner.checkpoint().rates[node.key], 0);
  const beforeReserve = context.owner.checkpoint().remaining;
  context.owner.synchronizeSourceRates(changed.value.world);
  assert.equal(context.owner.checkpoint().rates[node.key], rate);
  assert.deepEqual(context.owner.checkpoint().remaining, beforeReserve);
  for (const [offsetX, offsetY] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    context.simulation.grid.costs[context.simulation.grid.index(tileX + offsetX, tileY + offsetY)] = 0;
  }
  const before = context.owner.checkpoint();
  assert.deepEqual(context.owner.harvest(context.simulation, [context.unitId], node.key, 0), []);
  assert.deepEqual(context.owner.checkpoint(), before);
});

test("finite source reserve exhausts exactly; no income after depletion and consumed ledger rejects regression atomically", async () => {
  const context = await fixture("alien");
  const node = startHarvest(context);
  for (let tick = 0; tick < 15000 && context.owner.checkpoint().remaining[node.key] > 0; tick += 1) step(context);
  const saved = context.owner.checkpoint();
  assert.equal(saved.remaining[node.key], 0);
  assert.equal(saved.earned[0], node.amount);
  assert.equal(saved.orders.length, 0);
  step(context, 40);
  assert.equal(context.owner.checkpoint().earned[0], node.amount);
  assert.deepEqual(context.owner.harvest(context.simulation, [context.unitId], node.key, 0), []);
  const consumed = consumeBrowserEconomyIncome(context.world, context.owner.initialLedger, context.owner.income);
  const receipt = context.owner.income.find(entry => entry.team === 0)!;
  assert.throws(() => consumeBrowserEconomyIncome(consumed.world, consumed.ledger,
    [{ ...receipt, earnedTotal: receipt.earnedTotal + 1 }, { ...receipt, earnedTotal: receipt.earnedTotal - 1 }]), /regressed/);
  assert.equal(consumed.world.exomoney[0], node.amount);
  assert.equal(consumed.ledger.earned[0], node.amount);
});
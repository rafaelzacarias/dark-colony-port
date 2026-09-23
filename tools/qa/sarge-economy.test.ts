import assert from "node:assert/strict";
import test from "node:test";
import { BrowserCampaignEconomy, consumeBrowserEconomyIncome, type BrowserEconomyProfile } from "../../src/engine/browser-campaign-economy";
import { DeterministicSimulation } from "../../src/engine/simulation";
import { NavigationGrid } from "../../src/engine/grid";
import { createCampaignWorld } from "../../src/engine/campaign-world";

function fixture(rate = 25, reserve = 1000, movementPlane: "ground" | "air" = "ground") {
  const simulation = new DeterministicSimulation(new NavigationGrid(64, 64, new Uint16Array(4096).fill(1)),
    { teamAlliances: Array.from({ length: 8 }, () => Array(8).fill(1)), initialResources: { human: 0, alien: 0 } });
  const options = { faction: "alien" as const, team: 1, cell: { x: 31, y: 30 }, movementPlane, health: 800, maxHealth: 800,
    speedSubcellsPerTick: 1024, positionSubcells: { x: 31.5 * 1024, y: 30.5 * 1024 } };
  const collector = { key: "collector", slot: 153, generation: 0, team: 1, typeId: 14 as const, options };
  const simulationId = simulation.addUnit(options);
  const thiefId = simulation.addUnit({ faction: "human", team: 0, cell: { x: 30, y: 30 },
    weapon: { damage: 1, rangeCells: 8, cooldownTicks: 1 } });
  const thief = { key: "sarge", slot: 154, generation: 0, simulationId: thiefId, team: 0, typeId: 4 as const };
  const profile: BrowserEconomyProfile = { scope: "browser-adapted-economy-v1", sessionId: "source-split-controls",
    profileId: "source-split-controls", policy: { ticksPerSecond: 20, extractionPeriodTicks: 1,
      delivery: "direct-team-credit", timing: "adapted-not-native" },
    initialCredits: Object.fromEntries(Array.from({ length: 8 }, (_, team) => [team, 0])),
    harvesters: [collector], dropoffs: [],
    nodes: [{ key: "vent", slot: 152, sourceRow: 0, cell: { x: 31, y: 31 }, amount: reserve, rateWord: rate }] };
  const bindings = [{ key: collector.key, simulationId }];
  const owner = new BrowserCampaignEconomy(profile, simulation, bindings);
  owner.harvest(simulation, [simulationId], "vent", 1);
  simulation.advance(); owner.observe(simulation);
  return { simulation, owner, profile, bindings, collector, simulationId, thief };
}
type Context = ReturnType<typeof fixture>;
function frame(context: Context, visible = true) {
  const groundWords = Array<number>(4096).fill(1023);
  for (const unit of context.simulation.snapshot.units) {
    const slot = unit.id === context.simulationId ? 153 : 154;
    groundWords[unit.cellY * 64 + unit.cellX] = (slot | (visible ? 0x40000000 : 0)) >>> 0;
  }
  return context.owner.interceptionFrame(context.simulation,
    { width: 64, height: 64, groundWords, teamVisibilityMasks: [0x40000000, 0, 0, 0, 0, 0, 0, 0] });
}
function deploy(context: Context, visible = true) {
  context.owner.activateIncomeInterception(context.simulation, { type: "deploy", actor: context.thief });
  context.owner.observeInterception(context.simulation, frame(context, visible));
}
function step(context: Context, visible = true) {
  context.owner.haltDeployed(context.simulation);
  context.simulation.advance();
  context.owner.observe(context.simulation, context.owner.checkpoint().incomeInterception ? frame(context, visible) : undefined);
}
function fork(context: Context): Context {
  const simulation = DeterministicSimulation.restore(JSON.parse(JSON.stringify(context.simulation.checkpoint())));
  return { ...context, simulation, owner: new BrowserCampaignEconomy(context.profile, simulation, context.bindings,
    JSON.parse(JSON.stringify(context.owner.checkpoint()))) };
}
function account(context: Context) {
  const saved = context.owner.checkpoint();
  const lost = saved.incomeInterception?.ledger.reduce((sum, entry) => sum + entry.dissipated, 0) ?? 0;
  assert.equal(Object.values(saved.earned).reduce((sum, value) => sum + value, 0) + lost + saved.remaining.vent,
    context.profile.nodes[0].amount);
  assert.deepEqual(context.simulation.snapshot.resources, { human: 0, alien: 0 });
}

test("SARGE economy: allied different-team source extraction splits 25 into 12/12, replay before/after link", () => {
  const context = fixture();
  const before = fork(context);
  deploy(context); deploy(before);
  const linked = fork(context);
  for (const owner of [context, before, linked]) {
    step(owner, false); step(owner, false); account(owner);
    assert.equal(owner.owner.checkpoint().earned[0], 24);
    assert.equal(owner.owner.checkpoint().earned[1], 24);
    assert.equal(owner.owner.checkpoint().incomeInterception!.ledger[0].dissipated, 2);
  }
  assert.deepEqual(before.owner.checkpoint(), context.owner.checkpoint());
  assert.deepEqual(linked.owner.checkpoint(), context.owner.checkpoint());
  assert.deepEqual(fork(context).owner.checkpoint(), context.owner.checkpoint());
  const world = createCampaignWorld({ sessionId: context.profile.sessionId,
    source: { id: "controlled", teams: [], placementRows: [] }, messages: [], units: [] });
  assert.ok(world.ok);
  const initial = { ...world.value, exomoney: { ...context.profile.initialCredits } };
  const consumed = consumeBrowserEconomyIncome(initial, context.owner.initialLedger, context.owner.income);
  assert.equal(consumed.earnedDelta, 48);
  assert.equal(consumed.world.statistics["0,1"], 24);
  assert.equal(consumeBrowserEconomyIncome(consumed.world, consumed.ledger, context.owner.income).earnedDelta, 0);
});

test("SARGE economy: one-credit cycles dissipate, never carry, no acquisition retry without redeployment", () => {
  const context = fixture(1, 5);
  deploy(context, false);
  step(context);
  assert.equal(context.owner.checkpoint().earned[0], 0);
  assert.equal(context.owner.checkpoint().earned[1], 1);
  context.owner.activateIncomeInterception(context.simulation, { type: "undeploy", key: "sarge", generation: 0 });
  deploy(context);
  for (let cycle = 0; cycle < 4; cycle++) step(context);
  assert.equal(context.owner.checkpoint().earned[0], 0);
  assert.equal(context.owner.checkpoint().earned[1], 1);
  assert.equal(context.owner.checkpoint().incomeInterception!.ledger[0].dissipated, 4);
  account(context);
  assert.deepEqual(fork(context).owner.checkpoint(), context.owner.checkpoint());
});

test("SARGE economy: deployment halts movement; undeployment releases it and pays collector in full", () => {
  const context = fixture(); deploy(context); step(context);
  const pose = context.simulation.snapshot.units.find(unit => unit.id === context.thief.simulationId)!;
  context.simulation.queue({ type: "move", unitIds: [pose.id], target: { x: 29, y: 30 } });
  step(context);
  assert.equal(context.simulation.snapshot.units.find(unit => unit.id === pose.id)!.xSubcells, pose.xSubcells);
  context.owner.activateIncomeInterception(context.simulation, { type: "undeploy", key: "sarge", generation: 0 });
  context.simulation.queue({ type: "move", unitIds: [pose.id], target: { x: 29, y: 30 } });
  step(context);
  assert.notEqual(context.simulation.snapshot.units.find(unit => unit.id === pose.id)!.xSubcells, pose.xSubcells);
  assert.equal(context.owner.checkpoint().earned[0], 24);
  assert.equal(context.owner.checkpoint().earned[1], 49);
  account(context);
});

test("SARGE economy: collector movement or either death clears the link once and replays", () => {
  for (const change of ["collector-move", "collector-death", "sarge-death"] as const) {
    const context = fixture(); deploy(context); step(context);
    if (change === "collector-move") {
      context.simulation.queue({ type: "move", unitIds: [context.simulationId], target: { x: 32, y: 30 } });
    } else {
      const dead = change === "collector-death" ? context.simulationId : context.thief.simulationId;
      const saved = context.simulation.checkpoint();
      context.simulation = DeterministicSimulation.restore({ ...saved, units: saved.units.map(unit =>
        unit.id === dead ? { ...unit, health: 0, activity: "die" as const } : unit) });
    }
    const mirror = fork(context);
    for (let tick = 0; tick < 2; tick++) { step(context); step(mirror); }
    assert.equal(context.owner.checkpoint().earned[0], 12);
    assert.equal(context.owner.checkpoint().incomeInterception!.deployments.length, 0);
    assert.deepEqual(mirror.owner.checkpoint(), context.owner.checkpoint()); account(context);
  }
});

test("SARGE economy: missing activation, stale frames and checkpoint tampering", () => {
  const plain = fixture(); step(plain);
  assert.equal(plain.owner.checkpoint().incomeInterception, undefined);
  assert.equal(plain.owner.checkpoint().earned[1], 25);
  const context = fixture(); deploy(context); step(context);
  const saved = context.owner.checkpoint(), state = saved.incomeInterception!;
  for (const incomeInterception of [
    { ...state, deployments: [...state.deployments, ...state.deployments] },
    { ...state, deployments: state.deployments.map(actor => ({ ...actor, partner: { ...actor.partner!, generation: 1 } })) },
    { ...state, ledger: state.ledger.map(entry => ({ ...entry, dissipated: 0 })) },
    { ...state, ledger: [...state.ledger, ...state.ledger] },
    { ...state, scope: "browser-adapted-income-interception-v1" },
  ]) assert.throws(() => new BrowserCampaignEconomy(context.profile, context.simulation, context.bindings,
    { ...saved, incomeInterception } as typeof saved), /checkpoint/);
  assert.throws(() => context.owner.observeInterception(context.simulation, { ...frame(context), tick: 0 }), /stale/);
  assert.deepEqual(context.owner.checkpoint(), saved);
});

test("SARGE economy: deployed armed mobile binding cannot fire, undeployed weapon resumes", () => {
  const context = fixture();
  context.simulation.setTeamAlliances(Array.from({ length: 8 }, (_, team) => Array.from({ length: 8 }, (_, other) => Number(team === other))));
  deploy(context);
  context.simulation.queue({ type: "attack", unitIds: [context.thief.simulationId], targetId: context.simulationId });
  step(context);
  assert.equal(context.simulation.combatEvents.some(event => event.type === "shot" && event.attackerId === context.thief.simulationId), false);
  context.owner.activateIncomeInterception(context.simulation, { type: "undeploy", key: "sarge", generation: 0 });
  context.simulation.queue({ type: "attack", unitIds: [context.thief.simulationId], targetId: context.simulationId });
  step(context);
  assert.ok(context.simulation.combatEvents.some(event => event.type === "shot" && event.attackerId === context.thief.simulationId));
});

test("SARGE economy: same-team, airborne and stopped collectors are not deployed counterparts", () => {
  for (const kind of ["same-team", "air", "stopped"] as const) {
    const context = fixture(25, 1000, kind === "air" ? "air" : "ground");
    if (kind === "same-team") {
      const options = { faction: "human" as const, team: 1, cell: { x: 30, y: 29 } };
      const simulationId = context.simulation.addUnit(options);
      context.thief = { ...context.thief, simulationId, team: 1 };
    } else if (kind === "stopped") context.owner.stop(context.simulation, [context.simulationId]);
    deploy(context); step(context);
    assert.equal(context.owner.checkpoint().incomeInterception!.deployments[0].partner, undefined);
    assert.equal(context.owner.checkpoint().earned[0], 0);
  }
});
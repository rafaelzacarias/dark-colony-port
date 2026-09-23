import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { BrowserCampaignEconomy, type BrowserEconomyProfile } from "../../src/engine/browser-campaign-economy";
import { initializeCampaignPlacements } from "../../src/engine/campaign-session";
import { initializeBrowserCasualtyPickup } from "../../src/engine/browser-casualty-pickup";
import { initializeTransportHost, stepTransportHost, transportHostState, updateTransportHostUnit } from "../../src/engine/transport-host";
import { NavigationGrid } from "../../src/engine/grid";
import { DeterministicSimulation } from "../../src/engine/simulation";

function fixture() {
  const simulation = new DeterministicSimulation(new NavigationGrid(10, 10, new Uint16Array(100).fill(1)));
  const harvesters: BrowserEconomyProfile["harvesters"] = [1, 2].map(slot => ({
    key: `collector:${slot}`, slot, generation: 0, team: 0, typeId: 6,
    options: { faction: "human", team: 0, cell: { x: slot, y: 2 },
      positionSubcells: { x: (slot + 0.5) * 1024, y: 2560 }, maxHealth: 800, health: 800, speedSubcellsPerTick: 160 },
  }));
  const profile: BrowserEconomyProfile = { scope: "browser-adapted-economy-v1", profileId: "center-test", sessionId: "center-test",
    policy: { ticksPerSecond: 20, extractionPeriodTicks: 2, delivery: "direct-team-credit", timing: "adapted-not-native" },
    initialCredits: { 0: 0 }, harvesters, dropoffs: [],
    nodes: [{ key: "vent", slot: 152, sourceRow: 0, cell: { x: 4, y: 4 }, amount: 5, rateWord: 3 }] };
  const bindings = harvesters.map(actor => ({ key: actor.key, simulationId: simulation.addUnit(actor.options) }));
  const owner = new BrowserCampaignEconomy(profile, simulation, bindings);
  return { simulation, profile, bindings, owner, ids: bindings.map(binding => binding.simulationId) };
}

test("centered mining: physical path, queued contention, earned credits and exact save continuation", () => {
  const { simulation, profile, bindings, owner, ids } = fixture();
  const before = simulation.snapshot.units[0];
  assert.deepEqual(owner.harvest(simulation, ids, "vent", 0), [ids[0]]);
  assert.deepEqual(owner.checkpoint().orders[0].target, { x: 4, y: 4 });
  assert.deepEqual(simulation.snapshot.units[0], before);
  assert.deepEqual(owner.harvest(simulation, [ids[1]], "vent", 0), []);
  for (let tick = 0; tick < 8; tick += 1) { simulation.advance(); owner.observe(simulation); }
  const restoredSimulation = DeterministicSimulation.restore(JSON.parse(JSON.stringify(simulation.checkpoint())));
  const restoredOwner = new BrowserCampaignEconomy(profile, restoredSimulation, bindings, JSON.parse(JSON.stringify(owner.checkpoint())));
  for (let tick = 0; tick < 80; tick += 1) {
    const prior = simulation.snapshot.units[0];
    simulation.advance(); owner.observe(simulation);
    const current = simulation.snapshot.units[0];
    assert.ok(Math.hypot(current.xSubcells - prior.xSubcells, current.ySubcells - prior.ySubcells) <= 162);
    restoredSimulation.advance(); restoredOwner.observe(restoredSimulation);
    assert.deepEqual(restoredSimulation.checkpoint(), simulation.checkpoint());
    assert.deepEqual(restoredOwner.checkpoint(), owner.checkpoint());
  }
  const collector = simulation.snapshot.units[0];
  assert.deepEqual([collector.cellX, collector.cellY, collector.xSubcells, collector.ySubcells], [4, 4, 4608, 4608]);
  assert.equal(collector.health, 800);
  assert.equal(owner.checkpoint().earned[0], 5);
  assert.deepEqual(owner.checkpoint().orders, []);
  const depleted = owner.checkpoint();
  assert.deepEqual(owner.harvest(simulation, ids, "vent", 0), []);
  assert.deepEqual(owner.checkpoint(), depleted);
});

function advance(context: ReturnType<typeof fixture>, count = 1) {
  for (let tick = 0; tick < count; tick += 1) {
    context.simulation.advance(); context.owner.observe(context.simulation);
  }
}

test("centered mining: queued Stop releases the reservation without moving or paying", () => {
  const context = fixture();
  const { simulation, owner, ids } = context;
  const before = simulation.snapshot.units[0];
  assert.deepEqual(owner.harvest(simulation, [ids[0]], "vent", 0), [ids[0]]);
  assert.deepEqual(owner.harvest(simulation, [ids[1]], "vent", 0), []);
  owner.stop(simulation, [ids[0]]);
  assert.deepEqual(owner.harvest(simulation, [ids[1]], "vent", 0), [ids[1]]);
  advance(context);
  assert.deepEqual([simulation.snapshot.units[0].xSubcells, simulation.snapshot.units[0].ySubcells],
    [before.xSubcells, before.ySubcells]);
  assert.equal(owner.checkpoint().earned[0], 0);
  assert.deepEqual(owner.checkpoint().orders.map(order => order.simulationId), [ids[1]]);
});

test("centered mining: stopped extractor remains a physical blocker until it walks away", () => {
  const context = fixture();
  const { simulation, owner, ids } = context;
  owner.harvest(simulation, [ids[0]], "vent", 0);
  while (owner.checkpoint().orders[0]?.phase === "moving") advance(context);
  owner.stop(simulation, [ids[0]]);
  assert.deepEqual(owner.checkpoint().orders, []);
  assert.deepEqual(owner.harvest(simulation, [ids[1]], "vent", 0), []);
  simulation.queue({ type: "move", unitIds: [ids[0]], target: { x: 6, y: 4 } });
  advance(context, 15);
  assert.deepEqual(owner.harvest(simulation, [ids[1]], "vent", 0), [ids[1]]);
  assert.equal(owner.checkpoint().earned[0], 0);
});

test("centered mining: actual combat death releases a reserved vent", () => {
  const context = fixture();
  const { simulation, owner, ids } = context;
  owner.harvest(simulation, [ids[0]], "vent", 0);
  const attacker = simulation.addUnit({ faction: "alien", team: 1, cell: { x: 1, y: 3 },
    weapon: { damage: 800, rangeCells: 8, cooldownTicks: 1 } });
  simulation.queue({ type: "attack", unitIds: [attacker], targetId: ids[0] });
  advance(context);
  assert.equal(simulation.snapshot.units.find(unit => unit.id === ids[0])!.health, 0);
  assert.ok(simulation.deathEvents.some(event => event.targetId === ids[0]));
  assert.deepEqual(owner.checkpoint().orders, []);
  assert.deepEqual(owner.harvest(simulation, [ids[1]], "vent", 0), [ids[1]]);
  assert.equal(owner.checkpoint().earned[0], 0);
});

test("centered mining: impassable center, sealed route, mobile and unrelated static blockers reject atomically", () => {
  for (const kind of ["terrain", "route", "mobile", "static"] as const) {
    const { simulation, owner, ids } = fixture();
    if (kind === "terrain") simulation.grid.costs[44] = 0;
    if (kind === "route") for (const index of [34, 43, 45, 54]) simulation.grid.costs[index] = 0;
    if (kind === "mobile") simulation.addUnit({ faction: "human", team: 0, cell: { x: 4, y: 4 } });
    if (kind === "static") simulation.addStaticTarget({ faction: "human", team: 8,
      cell: { x: 4, y: 4 }, footprint: [{ x: 4, y: 4 }], maxHealth: 5 });
    const before = { economy: owner.checkpoint(), simulation: simulation.checkpoint() };
    assert.deepEqual(owner.harvest(simulation, ids, "vent", 0), [], kind);
    assert.deepEqual({ economy: owner.checkpoint(), simulation: simulation.checkpoint() }, before, kind);
  }
});

test("centered mining: duplicate centered or mixed legacy reservations fail restore", () => {
  const { simulation, owner, ids, profile, bindings } = fixture();
  owner.harvest(simulation, [ids[0]], "vent", 0);
  const saved = owner.checkpoint();
  for (const target of [{ x: 4, y: 4 }, { x: 4, y: 3 }]) {
    assert.throws(() => new BrowserCampaignEconomy(profile, simulation, bindings, { ...saved,
      orders: [...saved.orders, { ...saved.orders[0], simulationId: ids[1], target }] }), /contested centered/);
  }
});

test("centered mining: legacy adjacent save restores exactly and reissue walks to the center", () => {
  const context = fixture();
  const { simulation, ids, profile, bindings } = context;
  const target = { x: 4, y: 3 };
  simulation.queue({ type: "move", unitIds: [ids[0]], target });
  context.owner = new BrowserCampaignEconomy(profile, simulation, bindings, { ...context.owner.checkpoint(),
    orders: [{ simulationId: ids[0], nodeKey: "vent", target, phase: "moving", progressTicks: 0 }] });
  while (context.owner.checkpoint().orders[0]?.phase === "moving") advance(context);
  advance(context);
  const saved = JSON.parse(JSON.stringify(context.owner.checkpoint()));
  const restoredSimulation = DeterministicSimulation.restore(JSON.parse(JSON.stringify(simulation.checkpoint())));
  const restoredOwner = new BrowserCampaignEconomy(profile, restoredSimulation, bindings, saved);
  assert.deepEqual(restoredOwner.checkpoint(), saved);
  assert.deepEqual(restoredSimulation.checkpoint(), simulation.checkpoint());
  const before = restoredSimulation.snapshot.units[0];
  assert.deepEqual(restoredOwner.harvest(restoredSimulation, [ids[0]], "vent", 0), [ids[0]]);
  assert.deepEqual(restoredOwner.checkpoint().orders[0].target, { x: 4, y: 4 });
  assert.deepEqual(restoredSimulation.snapshot.units[0], before);
  for (let tick = 0; tick < 8; tick += 1) { restoredSimulation.advance(); restoredOwner.observe(restoredSimulation); }
  assert.deepEqual([restoredSimulation.snapshot.units[0].cellX, restoredSimulation.snapshot.units[0].cellY], [4, 4]);
  assert.equal(restoredOwner.checkpoint().orders[0].phase, "extracting");
});

test("centered mining: legacy blocked-vent save keeps adjacent extraction without teleport or blocker removal", () => {
  const context = fixture();
  const { simulation, ids, profile, bindings } = context;
  const target = { x: 4, y: 3 };
  simulation.addStaticTarget({ faction: "human", team: 8, cell: { x: 4, y: 4 }, maxHealth: 5, footprint: [{ x: 4, y: 4 }] });
  simulation.queue({ type: "move", unitIds: [ids[0]], target });
  context.owner = new BrowserCampaignEconomy(profile, simulation, bindings, { ...context.owner.checkpoint(),
    orders: [{ simulationId: ids[0], nodeKey: "vent", target, phase: "moving", progressTicks: 0 }] });
  while (context.owner.checkpoint().orders[0]?.phase === "moving") advance(context);
  const saved = JSON.parse(JSON.stringify(context.owner.checkpoint()));
  const restoredSimulation = DeterministicSimulation.restore(JSON.parse(JSON.stringify(simulation.checkpoint())));
  const restoredOwner = new BrowserCampaignEconomy(profile, restoredSimulation, bindings, saved);
  assert.deepEqual(restoredOwner.checkpoint(), saved);
  const before = restoredSimulation.checkpoint();
  assert.deepEqual(restoredOwner.harvest(restoredSimulation, ids, "vent", 0), []);
  assert.deepEqual(restoredOwner.checkpoint(), saved);
  assert.deepEqual(restoredSimulation.checkpoint(), before);
  for (let tick = 0; tick < 2; tick += 1) {
    advance(context); restoredSimulation.advance(); restoredOwner.observe(restoredSimulation);
  }
  assert.equal(restoredOwner.checkpoint().earned[0], 3);
  assert.deepEqual(restoredOwner.checkpoint(), context.owner.checkpoint());
  assert.deepEqual(restoredSimulation.checkpoint(), simulation.checkpoint());
});

test("centered mining: adapted host preserves source VENT identity and strict native still rejects unowned extraction", () => {
  const units = JSON.parse(readFileSync(new URL("../../public/assets/generated/data/units.json", import.meta.url), "utf8")).records;
  const created = initializeCampaignPlacements({ sessionId: "center-host", units, messages: [],
    source: { id: "center-host", teams: Array.from({ length: 8 }, (_, index) => ({ index, race: 0, coordinateRows: [[], []], cityRows: [] })),
      placementRows: [[4, 4, 40, 3, 5], [3, 4, 6, 0, -1]] },
    map: { width: 10, height: 10 }, resourceScales: "configured-startup" });
  assert.ok(created.ok, JSON.stringify(created));
  const initialized = initializeTransportHost(created.value, { width: 10, height: 10, groundEligible: Array(100).fill(true),
    definitions: [{ unitType: 6, health: 800, movementSpeed: 40, plane: "ground" }],
    highWater: created.value.placementState!.highWater, sides: Array(8).fill(0), directionBits: [],
    fixedStepMilliseconds: 50, orientationSteps: 1 });
  assert.ok(initialized.ok, JSON.stringify(initialized));
  const source = initialized.value.entities.find(entity => entity.unitType === 40)!;
  const collector = initialized.value.entities.find(entity => entity.unitType === 6)!;
  const position = transportHostState(initialized.value).slots[source.rawSlot!]!.position;
  const moved = updateTransportHostUnit(initialized.value, { type: "position", slot: collector.rawSlot!,
    generation: collector.generation, position });
  assert.ok(moved.ok, JSON.stringify(moved));
  const strictBefore = structuredClone(moved.value);
  const strict = stepTransportHost(moved.value);
  assert.equal(strict.ok, false);
  assert.match(JSON.stringify(strict), /Resource extraction.*unsupported/);
  assert.deepEqual(moved.value, strictBefore);
  const adapted = stepTransportHost(initializeBrowserCasualtyPickup(moved.value, { runtimeProfile: "browser-adapted" }));
  assert.ok(adapted.ok, JSON.stringify(adapted));
  const host = transportHostState(adapted.value);
  assert.equal(host.ground[44], collector.rawSlot);
  assert.equal(host.slots[source.rawSlot!]!.key, source.key);
  assert.deepEqual(host.slots[source.rawSlot!]!.position, position);
  assert.equal(host.slots[source.rawSlot!]!.health, 5);
  assert.deepEqual(adapted.value.exomoney, moved.value.exomoney);
  assert.deepEqual(adapted.value.entityBytes, moved.value.entityBytes);
});
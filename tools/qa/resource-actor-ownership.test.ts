import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { NavigationGrid } from "../../src/engine/grid.ts";
import { DeterministicSimulation, type ResourceActorStateProfile, type ResourceActorToken } from "../../src/engine/simulation.ts";
import { CampaignSession, createCampaignSession, type CampaignSessionOptions } from "../../src/engine/campaign-session.ts";
import { defenseOptionsFromLegacy } from "../../src/engine/legacy-balance.ts";
import { sourceResourceProfiles } from "../../src/engine/source-resource-options.ts";
import { transportHostState, type HostSlot, type ResourceHostBinding } from "../../src/engine/transport-host.ts";
import { parseScenario } from "../extractors/data/scenario.ts";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables.ts";

function profile(overrides: Partial<ResourceActorStateProfile> = {}): ResourceActorStateProfile {
  return { nativeIdentity: { slot: 153, generation: 0, key: "fixture:153:0" },
    sourceTypeIndex: 6, team: 0, xQ8: 384, yQ8: 384, health: 800, maxHealth: 800,
    speedSubcellsPerTick: 512, weapon: null, harvester: null,
    sourceDefense: { targetClass: 0, armorFactor: 256, sourceTypeIndex: 6 }, vision: { dayRangeCells: 4, nightRangeCells: 2 },
    occupancy: [{ x: 1, y: 1 }], status: 1, task: "idle", taskWords: [65535, 0, 0],
    taskOwner: { provenance: "constructor", evidence: "scripted constructor fixture, not moving handoff", state: {
      direction: 160, pendingOrder: 0, order: 0, released: false,
      animation: { profile: "EXPLSTAND", frame: 0, delay: 0, mode: 0 }, stack: [{ opcode: 1, words: [65535, 0, 0] }],
    } }, ...overrides };
}

function fixture() {
  const simulation = new DeterministicSimulation(new NavigationGrid(8, 8));
  const simulationId = simulation.addUnit({ faction: "human", team: 0, cell: { x: 1, y: 1 }, maxHealth: 800 });
  const token = simulation.registerResourceActor({ simulationId, slot: 153, generation: 0, key: "fixture:153:0" }, profile());
  return { simulation, token, simulationId };
}

function rejectedAtomically(simulation: DeterministicSimulation, action: () => void) {
  const before = simulation.checkpoint();
  assert.throws(action);
  assert.deepEqual(simulation.checkpoint(), before);
}

function idleReturn() {
  const state = profile();
  return profile({ taskOwner: { provenance: "source-idle", evidence: "explicit scripted resume owner, not native parity",
    state: { ...state.taskOwner.state, released: true, order: 255 } } });
}

function acknowledgement(token: ResourceActorToken, state = idleReturn()) {
  return { hostReleased: true as const, ownershipGeneration: token.ownershipGeneration,
    sourceIdle: { sourceTypeIndex: 6 as const, evidence: state.taskOwner.evidence,
      directionSigned: -96, taskWords: state.taskWords } };
}

test("movement completion captures final Q8 only on actual path completion", () => {
  const simulation = new DeterministicSimulation(new NavigationGrid(8, 8));
  const unitId = simulation.addUnit({ faction: "human", cell: { x: 1, y: 1 }, speedSubcellsPerTick: 512 });
  simulation.queue({ type: "move", unitIds: [unitId], target: { x: 2, y: 1 } });
  simulation.advance();
  assert.deepEqual(simulation.movementFinishedEvents, []);
  simulation.advance();
  assert.deepEqual(simulation.movementFinishedEvents, [{ unitId, tick: 1, finalXQ8: 640, finalYQ8: 384 }]);
  const restored = DeterministicSimulation.restore(JSON.parse(JSON.stringify(simulation.checkpoint())));
  assert.deepEqual(restored.movementFinishedEvents, simulation.movementFinishedEvents);
  restored.advance();
  assert.deepEqual(restored.movementFinishedEvents, []);
});

test("bound movement events retain native generation but cannot supply a task owner", () => {
  const { simulation, token, simulationId } = fixture();
  simulation.queue({ type: "move", unitIds: [simulationId], target: { x: 2, y: 1 } });
  rejectedAtomically(simulation, () => simulation.claimResourceActor(token, profile()));
  simulation.advance();
  assert.deepEqual(simulation.movementFinishedEvents, []);
  rejectedAtomically(simulation, () => simulation.claimResourceActor(token, profile()));
  simulation.advance();
  assert.deepEqual(simulation.movementFinishedEvents, [{ unitId: simulationId, tick: 1,
    finalXQ8: 640, finalYQ8: 384, nativeIdentity: token }]);
  rejectedAtomically(simulation, () => simulation.claimResourceActor(token, profile()));
});

test("claim suppresses commands, incoming combat and synthetic income without changing ID", () => {
  const { simulation, token, simulationId } = fixture();
  const enemy = simulation.addUnit({ faction: "alien", team: 1, cell: { x: 3, y: 1 }, weapon: { damage: 10, rangeCells: 3, cooldownTicks: 1 } });
  const node = simulation.addResourceNode({ cell: { x: 1, y: 1 }, amount: 100 });
  const claimed = simulation.claimResourceActor(token, profile());
  for (const command of [
    { type: "move" as const, unitIds: [simulationId], target: { x: 2, y: 1 } },
    { type: "stop" as const, unitIds: [simulationId] },
    { type: "attack" as const, unitIds: [simulationId], targetId: enemy },
    { type: "attack" as const, unitIds: [enemy], targetId: simulationId },
    { type: "harvest" as const, unitIds: [simulationId], resourceId: node, dropoff: { x: 1, y: 1 } },
    { type: "inspire" as const, unitIds: [simulationId], team: 0 },
  ]) rejectedAtomically(simulation, () => simulation.queue(command));
  rejectedAtomically(simulation, () => simulation.removeUnit(simulationId));
  rejectedAtomically(simulation, () => simulation.claimResourceActor(token, profile()));
  for (let tick = 0; tick < 8; tick += 1) simulation.advance();
  assert.equal(simulation.snapshot.units[0].id, simulationId);
  assert.equal(simulation.snapshot.units[0].xSubcells, 1536);
  assert.equal(simulation.snapshot.units[0].health, 800);
  assert.equal(simulation.snapshot.resources.human, 0);
  assert.equal(simulation.snapshot.resourceNodes[0].remaining, 100);
  assert.deepEqual(simulation.combatEvents, []);
  assert.equal(simulation.resourceActors[0].ownershipGeneration, claimed.ownershipGeneration);
});

test("claim rejects queued target orders and active combat, including a future stop", () => {
  for (const mode of ["future-stop", "queued-attack", "active-attack"] as const) {
    const { simulation, token, simulationId } = fixture();
    const enemy = simulation.addUnit({ faction: "alien", team: 1, cell: { x: 3, y: 1 }, weapon: { damage: 1, rangeCells: 4, cooldownTicks: 2 } });
    if (mode === "future-stop") simulation.queue({ type: "stop", unitIds: [simulationId] }, 10);
    else simulation.queue({ type: "attack", unitIds: [enemy], targetId: simulationId });
    if (mode === "active-attack") simulation.advance();
    rejectedAtomically(simulation, () => simulation.claimResourceActor(token, profile()));
  }
});

test("host publication is copied and atomic, updates mutable type/defense/selection and occupancy", () => {
  const { simulation, token, simulationId } = fixture();
  const claimed = simulation.claimResourceActor(token, profile());
  const deployed = profile({ sourceTypeIndex: 47, health: 760, maxHealth: 1000, xQ8: 640,
    occupancy: [{ x: 2, y: 1 }], sourceDefense: { targetClass: 3, armorFactor: 512, sourceTypeIndex: 47 },
    task: "extraction", taskWords: [152, 0, 0], taskOwner: { provenance: "resume", evidence: "host committed task12",
      state: { ...profile().taskOwner.state, animation: { profile: "EDPLYSTAND", frame: 2, delay: 3, mode: 0 },
        stack: [{ opcode: 1, words: [65535, 0, 0] }, { opcode: 12, words: [152, 0, 0] }] } } });
  rejectedAtomically(simulation, () => simulation.publishResourceActors([
    { token: claimed, profile: deployed }, { token: { ...claimed, simulationId: 999 }, profile: deployed },
  ]));
  rejectedAtomically(simulation, () => simulation.publishResourceActors([{ token: claimed, profile: { ...deployed, taskWords: [999, 0, 0] } }]));
  simulation.publishResourceActors([{ token: claimed, profile: deployed }]);
  assert.equal(simulation.snapshot.units[0].id, simulationId);
  assert.equal(simulation.snapshot.units[0].health, 760);
  assert.equal(simulation.snapshot.units[0].maxHealth, 1000);
  assert.equal(simulation.snapshot.units[0].cellX, 2);
  assert.equal(simulation.snapshot.units[0].resourceActor!.profile.sourceTypeIndex, 47);
  deployed.taskOwner.state.stack[1].words[1] = 77;
  assert.equal(simulation.resourceActors[0].profile.taskWords[1], 0);
  const copy = simulation.resourceActors[0];
  assert.equal(copy.profile.taskWords, copy.profile.taskOwner.state.stack.at(-1)!.words);
  const mover = simulation.addUnit({ faction: "human", cell: { x: 3, y: 1 }, speedSubcellsPerTick: 1024 });
  simulation.queue({ type: "move", unitIds: [mover], target: { x: 2, y: 1 } });
  simulation.advance();
  assert.equal(simulation.snapshot.units.find((unit) => unit.id === mover)!.cellX, 3);
  const restored = DeterministicSimulation.restore(JSON.parse(JSON.stringify(simulation.checkpoint())));
  assert.deepEqual(restored.checkpoint(), simulation.checkpoint());
  assert.equal(restored.resourceActors[0].profile.taskWords[1], 0);
});

test("return requires generation, host release, source idle payload and actual signed direction", () => {
  const { simulation, token, simulationId } = fixture();
  const claimed = simulation.claimResourceActor(token, profile());
  rejectedAtomically(simulation, () => simulation.releaseResourceActor(claimed, acknowledgement(claimed), idleReturn()));
  simulation.requestResourceActorReturn(claimed);
  simulation.publishResourceActors([{ token: claimed, profile: idleReturn() }]);
  rejectedAtomically(simulation, () => simulation.advance());
  const restored = DeterministicSimulation.restore(JSON.parse(JSON.stringify(simulation.checkpoint())));
  for (const owner of [simulation, restored]) {
    rejectedAtomically(owner, () => owner.releaseResourceActor(claimed,
      { ...acknowledgement(claimed), ownershipGeneration: 0 }, idleReturn()));
    rejectedAtomically(owner, () => owner.releaseResourceActor(claimed,
      { ...acknowledgement(claimed), hostReleased: false } as never, idleReturn()));
    rejectedAtomically(owner, () => owner.releaseResourceActor(claimed,
      { ...acknowledgement(claimed), sourceIdle: { ...acknowledgement(claimed).sourceIdle, directionSigned: 0 } }, idleReturn()));
    rejectedAtomically(owner, () => owner.releaseResourceActor(claimed, acknowledgement(claimed), profile()));
    owner.releaseResourceActor(claimed, acknowledgement(claimed), idleReturn());
    const edited = JSON.parse(JSON.stringify(owner.checkpoint()));
    edited.resourceActors[0].releaseAcknowledgement.sourceIdle.directionSigned = 0;
    assert.throws(() => DeterministicSimulation.restore(edited));
    owner.queue({ type: "move", unitIds: [simulationId], target: { x: 2, y: 1 } });
    owner.advance(); owner.advance();
    assert.equal(owner.snapshot.units[0].cellX, 2);
    assert.equal(owner.snapshot.units[0].id, simulationId);
  }
  assert.deepEqual(restored.checkpoint(), simulation.checkpoint());
});

test("direct restore validates owner, task payload, pending return, profiles and conflicting queues", () => {
  const { simulation, token } = fixture();
  const claimed = simulation.claimResourceActor(token, profile());
  simulation.requestResourceActorReturn(claimed);
  for (const mutate of [
    (saved: any) => { saved.resourceActors[0].generation += 1; },
    (saved: any) => { saved.resourceActors[0].key += "stale"; },
    (saved: any) => { saved.resourceActors[0].ownershipGeneration += 1; saved.resourceActors[0].pendingReturn.ownershipGeneration += 1; },
    (saved: any) => { saved.resourceActors[0].admission = null; },
    (saved: any) => { saved.resourceActors[0].owner = "simulation"; },
    (saved: any) => { saved.resourceActors[0].pendingReturn.ownershipGeneration += 1; },
    (saved: any) => { saved.resourceActors[0].profile.taskWords[1] = 123; },
    (saved: any) => { saved.resourceActors[0].profile.sourceTypeIndex = 47; },
    (saved: any) => { saved.resourceActors[0].profile.taskOwner.state.direction = -1; },
    (saved: any) => { saved.resourceActors[0].profile.xQ8 += 1; },
    (saved: any) => { saved.units[0].activity = "move"; },
    (saved: any) => { saved.nextCommandSequence = 1; saved.commands.push({ tick: 0, sequence: 0,
      command: { type: "stop", unitIds: [token.simulationId] } }); },
  ]) {
    const saved = JSON.parse(JSON.stringify(simulation.checkpoint()));
    mutate(saved);
    assert.throws(() => DeterministicSimulation.restore(saved));
  }
  const legacy = new DeterministicSimulation(new NavigationGrid(4, 4)).checkpoint();
  const { resourceActors, resourceActorEvents, movementFinishedEvents, ...old } = legacy;
  assert.equal(DeterministicSimulation.restore(old).snapshot.tick, 0);
});

test("combat death emits once after restore; source removal never manufactures a kill", () => {
  const { simulation, token } = fixture();
  const claimed = simulation.claimResourceActor(token, profile());
  simulation.publishResourceActors([{ token: claimed, profile: profile({ health: 0, task: "death", taskWords: [0, 0],
    taskOwner: { provenance: "resume", evidence: "host combat death", state: { ...profile().taskOwner.state,
      stack: [{ opcode: 10, words: [0, 0] }] } } }) }]);
  const restored = DeterministicSimulation.restore(JSON.parse(JSON.stringify(simulation.checkpoint())));
  for (const owner of [simulation, restored]) {
    owner.advance();
    assert.deepEqual(owner.deathEvents, [{ type: "death", tick: 0, targetId: token.simulationId }]);
    owner.advance();
    assert.deepEqual(owner.deathEvents, []);
  }
  const removal = fixture();
  const removed = removal.simulation.claimResourceActor(removal.token, profile());
  removal.simulation.removeResourceActor(removed, "remove-noncombat");
  assert.equal(removal.simulation.snapshot.units.length, 0);
  removal.simulation.advance();
  assert.deepEqual(removal.simulation.deathEvents, []);
  assert.equal(removal.simulation.resourceActorEvents[0].type, "remove-noncombat");
  assert.deepEqual(DeterministicSimulation.restore(removal.simulation.checkpoint()).snapshot, removal.simulation.snapshot);
  rejectedAtomically(removal.simulation, () => removal.simulation.publishResourceActors([{ token: removed, profile: profile() }]));
});

test("zero-HP noncombat removal does not emit death, and slot reuse requires a newer generation", () => {
  const { simulation, token } = fixture();
  const claimed = simulation.claimResourceActor(token, profile());
  simulation.publishResourceActors([{ token: claimed, profile: profile({ health: 0, task: "removal", taskWords: [1, 0],
    taskOwner: { provenance: "resume", evidence: "explicit host noncombat removal", state: { ...profile().taskOwner.state,
      stack: [{ opcode: 10, words: [1, 0] }] } } }) }]);
  simulation.advance();
  assert.deepEqual(simulation.deathEvents, []);
  assert.deepEqual(simulation.resourceActorEvents, []);
  simulation.removeResourceActor(claimed, "remove-noncombat");
  const simulationId = simulation.addUnit({ faction: "human", team: 0, cell: { x: 1, y: 1 }, maxHealth: 800 });
  const nativeIdentity = { slot: 153, generation: 1, key: "fixture:153:1" };
  rejectedAtomically(simulation, () => simulation.claimResourceActor({ ...token, simulationId }, profile()));
  const next = simulation.claimResourceActor({ ...nativeIdentity, simulationId, ownershipGeneration: 0 }, profile({ nativeIdentity }));
  assert.equal(next.generation, 1);
  rejectedAtomically(simulation, () => simulation.publishResourceActors([{ token: claimed, profile: profile() }]));
  assert.deepEqual(DeterministicSimulation.restore(simulation.checkpoint()).checkpoint(), simulation.checkpoint());
});

test("a stopped or stationary order is not a movement completion", () => {
  const { simulation, simulationId } = fixture();
  simulation.queue({ type: "move", unitIds: [simulationId], target: { x: 1, y: 1 } });
  simulation.advance();
  assert.deepEqual(simulation.movementFinishedEvents, []);
  simulation.queue({ type: "move", unitIds: [simulationId], target: { x: 4, y: 1 } });
  simulation.advance();
  simulation.queue({ type: "stop", unitIds: [simulationId] });
  simulation.advance();
  assert.deepEqual(simulation.movementFinishedEvents, []);
});

for (const race of [0, 1] as const) test(`race ${race}: scripted same-tile resource session earns real credits, preserves actor ID and replays both checkpoints`, () => {
  const raw = (path: string) => readFileSync(new URL(`../../raw_cd/DC/${path}`, import.meta.url)).toString();
  const units = parseUnitStats(raw("GAMESTAT/GAMESTAT.TXT"));
  const weapons = parseWeaponStats(raw("GAMESTAT/WEAPSTAT.TXT"));
  const original = parseScenario(raw("SCENARIO/HUMAN/HUMAN02.SCN"));
  const metadata = Object.fromEntries(["VENT", "EXPL", "SLUG"].map((stem) => [stem,
    JSON.parse(readFileSync(new URL(`../../public/assets/generated/animations/${stem}.json`, import.meta.url)).toString())]));
  const binding = (slot: number, bank: string, direction: number): ResourceHostBinding => ({ slot, generation: 0,
    state: { direction, pendingOrder: 0, order: 0, released: false,
      animation: { profile: bank, frame: 0, delay: 0, mode: 0 }, stack: [{ opcode: 1, words: [65535, 0, 0] }] } });
  const lifecycle = sourceResourceProfiles(metadata as Parameters<typeof sourceResourceProfiles>[0]);
  const options: CampaignSessionOptions = {
    sessionId: "SCRIPTED-SAME-TILE-RESOURCE-OWNERSHIP-NOT-ORIGINAL-MISSION", source: { ...original,
      placementRows: [[60, 60, 40, 22, 10000], [60, 60, race === 0 ? 6 : 14, 0, 800]],
      teams: original.teams.map((team) => ({ ...team, race, money: 1000 })) },
    units, weapons, triggers: [], messages: [], map: { width: 128, height: 128 },
    pathGrid: new Uint8Array(128 * 128).fill(1), tags: new Uint8Array(128 * 128),
    commanders: [{ team: 0, unitType: race === 0 ? 69 : 73, sprite: race === 0 ? "TRSC" : "GRAY" }], directionBits: [[0, 0]],
    fixedStepMilliseconds: 50, orientationSteps: 1, resourceScales: { rateScale: 256, reserveScale: 256 },
    resourceInitialIncome: Array(8).fill(0), resourceLifecycle: { ...lifecycle,
      bindings: [binding(152, "VENTSTAND", 0), binding(153, race === 0 ? "EXPLSTAND" : "SLUGSTAND", race === 0 ? 160 : 128)] },
  };
  const created = createCampaignSession(options);
  assert.ok(created.ok, JSON.stringify(created));
  if (!created.ok) return;
  const session = created.value;
  const simulation = new DeterministicSimulation(new NavigationGrid(128, 128));
  const initialHost = transportHostState(session.snapshot.world);
  const initial = initialHost.slots[153]!;
  const project = (host: HostSlot): ResourceActorStateProfile => {
    assert.ok((race === 0 ? [6, 47] : [14, 48]).includes(host.unitType));
    const sourceTypeIndex = host.unitType as 6 | 14 | 47 | 48;
    const stat = units.find((entry) => entry.index === sourceTypeIndex)!;
    assert.ok(host.resourceTask);
    assert.ok(["idle", "extraction", "retraction", "removal", "death"].includes(host.task));
    return profile({ nativeIdentity: { slot: host.slot, generation: host.generation, key: host.key },
      sourceTypeIndex, team: host.team, xQ8: host.position.x, yQ8: host.position.y, health: host.health, maxHealth: stat.health,
      sourceDefense: { ...defenseOptionsFromLegacy(stat, 0), sourceTypeIndex },
      occupancy: [{ x: host.position.x >> 8, y: host.position.y >> 8 }], status: host.status,
      task: host.task as ResourceActorStateProfile["task"], taskWords: host.taskWords,
      taskOwner: { provenance: host.task === "idle" ? "constructor" : "resume",
        evidence: "scripted original FIN + native constructor direction/task words; committed transport host", state: host.resourceTask } });
  };
  const simulationId = simulation.addUnit({ faction: race === 0 ? "human" : "alien", team: initial.team,
    cell: { x: 60, y: 60 }, maxHealth: initial.health, health: initial.health });
  const token = simulation.claimResourceActor({ simulationId, slot: initial.slot, generation: initial.generation,
    key: initial.key, ownershipGeneration: 0 }, project(initial));
  const resourceFrameSource = { teams: options.source.teams.map(({ index }) => ({ index, ai: 0 })),
    aiMultipliers: Array(8).fill(256), localTeam: 0, cancellationGate: 0 };
  let restoredSession: CampaignSession | undefined;
  let restoredSimulation: DeterministicSimulation | undefined;
  for (let update = 1; update <= 48; update += 1) {
    const input = { clockMilliseconds: update * 50, resourceFrameSource };
    const result = session.step(input);
    assert.ok(result.ok, JSON.stringify(result));
    if (!result.ok) return;
    const frame = result.value;
    const host = transportHostState(frame.world).slots[153]!;
    simulation.publishResourceActors([{ token, profile: project(host) }]);
    simulation.advance();
    assert.equal(simulation.snapshot.units[0].id, simulationId);
    assert.equal(simulation.snapshot.units[0].resourceActor!.profile.sourceTypeIndex, host.unitType);
    assert.equal(simulation.snapshot.units[0].resourceActor!.key, initial.key);
    assert.equal(frame.world.exomoney[0], 1000 + (frame.world.statistics["0,1"] ?? 0));
    assert.deepEqual(simulation.snapshot.resources, { human: 0, alien: 0 }, "no synthetic simulation credit or grant");
    assert.deepEqual(simulation.deathEvents, []);
    if (restoredSession && restoredSimulation) {
      const replay = restoredSession.step(input);
      assert.deepEqual(replay, result);
      assert.ok(replay.ok);
      if (!replay.ok) return;
      restoredSimulation.publishResourceActors([{ token, profile: project(transportHostState(replay.value.world).slots[153]!) }]);
      restoredSimulation.advance();
      assert.deepEqual(restoredSimulation.checkpoint(), simulation.checkpoint());
    }
    if (update === 24) {
      restoredSession = CampaignSession.restore(JSON.parse(JSON.stringify(session.checkpoint())));
      restoredSimulation = DeterministicSimulation.restore(JSON.parse(JSON.stringify(simulation.checkpoint())));
    }
  }
  assert.ok(session.snapshot.world.statistics["0,1"] > 0);
  assert.equal(simulation.resourceActors[0].profile.sourceTypeIndex, race === 0 ? 47 : 48);
  assert.equal(transportHostState(session.snapshot.world).slots[152]!.team, 8);
  assert.equal(simulation.snapshot.units.length, 1, "neutral source is never a synthetic combat actor");
});
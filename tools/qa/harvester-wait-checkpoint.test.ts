import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CampaignSession, type CampaignResourceHandoff, type CampaignSessionOptions } from "../../src/engine/campaign-session";
import { sourceResourceProfiles } from "../../src/engine/source-resource-options";
import { transportHostState, type ResourceHostBinding } from "../../src/engine/transport-host";
import { NavigationGrid } from "../../src/engine/grid";
import { DeterministicSimulation, type ResourceActorStateProfile } from "../../src/engine/simulation";
import { defenseOptionsFromLegacy } from "../../src/engine/legacy-balance";

const root = new URL("../../public/assets/generated/", import.meta.url);
const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const source = json("data/scenarios/HUMAN/HUMAN02.json");
const profiles = sourceResourceProfiles(Object.fromEntries(["VENT", "EXPL", "SLUG"].map(stem =>
  [stem, json(`animations/${stem}.json`)])) as Parameters<typeof sourceResourceProfiles>[0]);
const frameSource = { teams: source.teams.map(({ index }: { index: number }) => ({ index, ai: 0 })),
  aiMultipliers: Array(8).fill(256), localTeam: 0, cancellationGate: 0 };
const clone = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value));

function fixture(race: 0 | 1) {
  const mobileSlot = 152, sourceSlot = 153;
  const binding: ResourceHostBinding = { slot: mobileSlot, generation: 0, state: {
    direction: 0, animation: { profile: race === 0 ? "EXPLSTAND" : "SLUGSTAND", frame: 0, delay: 0, mode: 0 },
    pendingOrder: 0, order: 255, released: false,
    stack: [{ opcode: 1, words: [65535, 800, 0] }, { opcode: 3, words: [7, 800] }],
    nativeIdle: { randomIndex: 82, observer: 255, specialOrder: 0, confusion: 0,
      secondaryAnimationPending: 0, secondaryAnimationsInactive: true, groundWord: 0x40000000 | mobileSlot },
  } };
  const map = json("maps/HUMAN/HUMAN02.json");
  const options: CampaignSessionOptions = {
    sessionId: `source-separated-synthetic-wait-checkpoint-${race}`,
    source: { id: source.id, rawHeader: source.rawHeader,
      placementRows: [[67, 48, race === 0 ? 6 : 14, 0, 800], [69, 48, 40, 22, 12000]],
      teams: source.teams.map((team: object) => ({ ...team, race })) },
    units: json("data/units.json").records, weapons: json("data/weapons.json").records,
    triggers: [], messages: [], map: { width: 96, height: 84 },
    pathGrid: Uint8Array.from(readFileSync(new URL(`maps/HUMAN/${map.files.pathGrid}`, root))), tags: new Uint8Array(96 * 84),
    commanders: [{ team: 0, unitType: race === 0 ? 69 : 73, sprite: race === 0 ? "TRSC" : "GRAY" }],
    directionBits: [[0, 0]], fixedStepMilliseconds: 50, orientationSteps: 1,
    resourceScales: { rateScale: 256, reserveScale: 256 }, resourceInitialIncome: Array(8).fill(0),
    resourceLifecycle: { ...profiles, bindings: [{ slot: sourceSlot, generation: 0, state: { direction: 0,
      animation: { profile: "VENTSTAND", frame: 0, delay: 0, mode: 0 }, pendingOrder: 0, order: 0,
      released: false, stack: [{ opcode: 1, words: [65535, 0, 0] }] } }] },
  };
  return { session: new CampaignSession(options), binding, mobileSlot };
}
function step(session: CampaignSession, handoffs?: CampaignResourceHandoff[]) {
  return session.step({ clockMilliseconds: (session.snapshot.cycleCounter + 1) * 50,
    resourceFrameSource: frameSource, ...(handoffs ? { resourceHandoffs: handoffs } : {}) });
}
function handoff(session: CampaignSession, binding: ResourceHostBinding): CampaignResourceHandoff {
  const world = session.snapshot.world;
  return { action: "bind", evidence: "explicit synthetic idle/wait fixture, not movement completion",
    expected: transportHostState(world).slots[binding.slot]!,
    rawEntity: Array.from(world.entityBytes!.slice(binding.slot * 220, (binding.slot + 1) * 220)), state: binding.state };
}

for (const race of [0, 1] as const) test(`race ${race}: native wait handoff/checkpoint retains guards, payload and RNG atomically`, () => {
  const { session, binding, mobileSlot } = fixture(race);
  assert.equal(session.snapshot.world.exomoney[0], 0);
  const entry = handoff(session, binding), before = session.checkpoint();
  for (const change of [
    (value: CampaignResourceHandoff) => { Object.assign(value.state.nativeIdle!, { observer: 0 }); },
    (value: CampaignResourceHandoff) => { value.state.nativeIdle!.groundWord = 1023; },
    (value: CampaignResourceHandoff) => { Object.assign(value.state.nativeIdle!, { randomIndex: 256 }); },
    (value: CampaignResourceHandoff) => { value.state.stack[1].words[0] = 8; },
    (value: CampaignResourceHandoff) => { value.state.stack[0].words[2] = 1; },
    (value: CampaignResourceHandoff) => { value.state.pendingOrder = 1; value.state.order = 13; },
  ]) {
    const invalid = clone(entry); change(invalid);
    assert.equal(step(session, [invalid]).ok, false);
    assert.deepEqual(session.checkpoint(), before);
  }
  assert.equal(session.step({ clockMilliseconds: 50, resourceHandoffs: [entry],
    resourceFrameSource: { ...frameSource, aiMultipliers: [] } }).ok, false);
  assert.deepEqual(session.checkpoint(), before);
  const first = step(session, [entry]);
  assert.ok(first.ok, JSON.stringify(first));
  const restored = CampaignSession.restore(clone(session.checkpoint()));
  assert.deepEqual(restored.checkpoint(), session.checkpoint());
  const bad = clone(session.checkpoint());
  (bad.state.world.entityBytes as number[])[mobileSlot * 220 + 0x35] = 0;
  assert.throws(() => CampaignSession.restore(bad), /raw native idle guards/);
  const expectedWaits = [5, 4, 3, 2, 1, 0, null, 7, 6];
  for (const remaining of expectedWaits) {
    assert.deepEqual(step(session), step(restored));
    const entity = transportHostState(session.snapshot.world).slots[mobileSlot]!;
    assert.deepEqual(entity.resourceTask!.stack, remaining === null ? [{ opcode: 1, words: [65535, 800, 0] }] :
      [{ opcode: 1, words: [65535, 800, 0] }, { opcode: 3, words: [remaining, 800] }]);
    assert.equal(entity.taskWords, entity.resourceTask!.stack.at(-1)!.words);
    assert.equal(entity.resourceTask!.nativeIdle!.randomIndex, 82);
  }
  assert.deepEqual(CampaignSession.restore(clone(session.checkpoint())).checkpoint(), session.checkpoint());
  assert.equal(session.snapshot.world.exomoney[0], 0);
  assert.equal(session.snapshot.world.statistics["0,1"], 0);
});

for (const race of [0, 1] as const) test(`race ${race}: explicit wait ownership survives claim, deployment and restore without generic harvesting`, () => {
  const { session, binding, mobileSlot } = fixture(race);
  const host = transportHostState(session.snapshot.world).slots[mobileSlot]!;
  const simulation = new DeterministicSimulation(new NavigationGrid(96, 84));
  const simulationId = simulation.addUnit({ faction: race === 0 ? "human" : "alien", team: 0,
    cell: { x: 67, y: 48 }, maxHealth: 800 });
  const units = json("data/units.json").records;
  const sourceTypeIndex = race === 0 ? 6 : 14;
  const stat = units.find((unit: { index: number }) => unit.index === sourceTypeIndex);
  const profile: ResourceActorStateProfile = { nativeIdentity: { slot: mobileSlot, generation: 0, key: host.key },
    sourceTypeIndex, team: 0, xQ8: host.position.x, yQ8: host.position.y, health: 800, maxHealth: 800,
    speedSubcellsPerTick: 512, weapon: null, harvester: null,
    sourceDefense: { ...defenseOptionsFromLegacy(stat, 0), sourceTypeIndex }, vision: null,
    occupancy: [{ x: 67, y: 48 }], status: 1, task: "idle", taskWords: binding.state.stack[1].words,
    taskOwner: { provenance: "resume", evidence: "source-separated synthetic wait ownership fixture, not combat/movement certification",
      state: binding.state } };
  const token = { simulationId, slot: mobileSlot, generation: 0, key: host.key, ownershipGeneration: 0 };
  const before = simulation.checkpoint();
  const invalid = clone(profile);
  delete invalid.taskOwner.state.nativeIdle;
  assert.throws(() => simulation.claimResourceActor(token, invalid));
  assert.deepEqual(simulation.checkpoint(), before);
  const claimed = simulation.claimResourceActor(token, profile);
  assert.deepEqual(DeterministicSimulation.restore(clone(simulation.checkpoint())).checkpoint(), simulation.checkpoint());
  const deployedType = race === 0 ? 47 : 48;
  const taskOwner = clone(profile.taskOwner);
  taskOwner.state.stack.push({ opcode: 12, words: [153, 1, 0] });
  taskOwner.state.animation = { profile: race === 0 ? "EXPLDEPLOY" : "SLUGDEPLOY", frame: 0, delay: 0, mode: 1 };
  const deployed: ResourceActorStateProfile = { ...profile, sourceTypeIndex: deployedType,
    sourceDefense: { ...defenseOptionsFromLegacy(units.find((unit: { index: number }) => unit.index === deployedType), 0),
      sourceTypeIndex: deployedType }, task: "extraction", taskOwner, taskWords: taskOwner.state.stack.at(-1)!.words };
  simulation.publishResourceActors([{ token: claimed, profile: deployed }]);
  const restored = DeterministicSimulation.restore(clone(simulation.checkpoint()));
  assert.deepEqual(restored.checkpoint(), simulation.checkpoint());
  assert.equal(restored.resourceActors[0].profile.taskOwner.state.nativeIdle!.randomIndex, 82);
  assert.equal(restored.resourceActors[0].profile.harvester, null);
  assert.equal(restored.snapshot.resources.human, 0);
  assert.equal(restored.snapshot.resources.alien, 0);
});
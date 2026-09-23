import assert from "node:assert/strict";
import test from "node:test";
import { sourceNativeVisibilityPlane } from "../../src/engine/source-native-combat-mission";
import { MissionView } from "../../src/mission-view";
import { CampaignSession } from "../../src/engine/campaign-session";
import { createNativeCombatMissionFixture, nativeCombatInput } from "./fixtures/native-combat-mission";
import { transportHostState } from "../../src/engine/transport-host";
import { readFileSync } from "node:fs";
import type { SourceNativeVisibilityFrame } from "../../src/engine/source-native-visibility-host";

const canvas = () => ({ width: 512, height: 452, getContext: () => null }) as unknown as HTMLCanvasElement;
const stage = {} as HTMLElement;
const callbacks = { onStats() {}, onUnitsChanged() {} };

function phase(view: MissionView, sequence: number, counter: number, producerSlots: number[] = []): SourceNativeVisibilityFrame {
  const bytes = view.campaignSnapshot!.world.entityBytes!;
  const eligible = Array.from({ length: 800 }, (_, slot) => slot).filter(slot => bytes[slot * 220 + 0x2c]
    && bytes[slot * 220 + 7] <= 7 && ![1, 2].includes(bytes[slot * 220 + 0xcb]));
  return { sequence, counter, producerSlots, excludedProducerSlots: eligible.filter(slot => !producerSlots.includes(slot)) };
}

test("MissionView native visibility bits: runtime orientation, directed mask and detached local exploration", () => {
  const dimensions = { width: 3, height: 2 };
  const visibility = { ...dimensions, groundWords: Uint32Array.of(0x40000000, 0x20000000, 0x00800000,
    0x80000000, 0xa0000000, 0x00400000) };
  assert.deepEqual([...sourceNativeVisibilityPlane(visibility, dimensions, 0x40000000)], [1, 0, 0, 0, 0, 0]);
  assert.deepEqual([...sourceNativeVisibilityPlane(visibility, dimensions, 0x60800000)], [1, 1, 1, 0, 1, 0]);
  const explored = sourceNativeVisibilityPlane(visibility, dimensions, 0x80000000);
  assert.deepEqual([...explored], [0, 0, 0, 1, 1, 0]);
  explored.fill(0);
  assert.equal(visibility.groundWords[3], 0x80000000);
  assert.throws(() => sourceNativeVisibilityPlane(visibility, { width: 2, height: 3 }, 0x40000000), /dimensions/);
  assert.throws(() => sourceNativeVisibilityPlane({ ...visibility, groundWords: new Uint32Array(5) }, dimensions, 0x40000000), /dimensions/);
});

test("MissionView native visibility phase: source planes, atomic journal, exact restore and no actor clock", async () => {
  const fixture = await createNativeCombatMissionFixture(false, { localTeam: 0, localMask: 0x40000000, daylight: 0, crtSeed: 1 });
  let publications = 0;
  const view = new MissionView(canvas(), stage, { ...callbacks, onUnitsChanged() {
    publications++;
    assert.equal(view.checkpoint().session!.state.world.transportState.nativeCombat!.visibility!.sequence, publications);
  } }, fixture.mission);
  assert.equal(view.missionDiagnostic, undefined);
  const initial = view.checkpoint(), host = initial.session!.state.world.transportState;
  assert.equal(initial.session!.state.world.entities.length, 21);
  assert.deepEqual(view.visibility, Uint8Array.from(host.nativeAiTasks!.ground, word => Number(Boolean(word & 0x40000000))));
  assert.deepEqual(view.explored, Uint8Array.from(host.nativeAiTasks!.ground, word => word >>> 31));
  const input = { visibilityFrame: phase(view, 1, 1) };
  const partial = view.advanceNativeVisibility(input);
  assert.equal(partial.visibilityEvent.executed, false);
  assert.deepEqual(partial.visibility.groundWords, Uint32Array.from(host.nativeAiTasks!.ground));
  assert.deepEqual(view.simulation.checkpoint(), initial.simulation);
  assert.deepEqual(view.campaignSnapshot!.world.entityBytes, Uint8Array.from(initial.session!.state.world.entityBytes!));
  partial.visibility.groundWords.fill(0);
  assert.deepEqual(view.visibility, Uint8Array.from(host.nativeAiTasks!.ground, word => Number(Boolean(word & 0x40000000))));
  const savedPartial = view.checkpoint();
  assert.throws(() => view.advanceNativeVisibility(input), /sequence/);
  assert.throws(() => view.advanceNativeVisibility({ ...input, clockMilliseconds: 16 } as never), /Exclusive/);
  assert.throws(() => view.advanceNativeVisibility({ visibilityFrame: { ...phase(view, 2, 0), excludedProducerSlots: [] } }), /partition/);
  assert.deepEqual(view.checkpoint(), savedPartial);
  const nativePhase = CampaignSession.prototype.stepVisibilityForNativeView;
  try {
    CampaignSession.prototype.stepVisibilityForNativeView = function(input) {
      const result = nativePhase.call(this, input);
      if (result.ok) result.value.transport.slots.find(actor => actor?.health)! .health--;
      return result;
    };
    assert.throws(() => view.advanceNativeVisibility({ visibilityFrame: phase(view, 2, 0) }), /projection identity/);
    assert.deepEqual(view.checkpoint(), savedPartial, "late projection rejection rolls back the accepted candidate phase");
    assert.equal(publications, 1);
  } finally { CampaignSession.prototype.stepVisibilityForNativeView = nativePhase; }
  const result = view.advanceNativeVisibility({ visibilityFrame: phase(view, 2, 0) });
  assert.deepEqual(result.visibilityEvent.phases, ["clear", "compute"]);
  assert.deepEqual(view.visibility, Uint8Array.from(result.visibility.groundWords, word => Number(Boolean(word & 0x40000000))));
  assert.deepEqual(view.explored, Uint8Array.from(result.visibility.groundWords, word => word >>> 31));
  assert.equal(view.visibility.some(Boolean), false);
  assert.deepEqual(view.simulation.checkpoint(), initial.simulation);
  assert.equal(view.campaignSnapshot!.world.clockMilliseconds, initial.session!.state.world.clockMilliseconds);
  assert.equal(view.campaignSnapshot!.world.entities.length, 21);
  const saved = view.checkpoint(), providers = await fixture.recreateProviders();
  const mission = { ...fixture.mission, sourceNativeCombat: { ...fixture.mission.sourceNativeCombat!,
    options: { ...fixture.mission.sourceNativeCombat!.options, ...providers } } };
  const restored = MissionView.restore(canvas(), stage, { onStats() {}, onUnitsChanged() {} }, mission, saved);
  assert.deepEqual(restored.checkpoint(), saved);
  const tampered = structuredClone(saved);
  tampered.state.explored[0] ^= 1;
  assert.throws(() => MissionView.restore(canvas(), stage, callbacks, mission, tampered), /exploration projection/);
  assert.equal(publications, 2);
  const guarded = new MissionView(canvas(), stage, callbacks, fixture.mission);
  const beforeGuard = guarded.campaignSnapshot;
  guarded.simulation.queue({ type: "stop", unitIds: [] });
  assert.throws(() => guarded.advanceNativeVisibility({ visibilityFrame: phase(guarded, 1, 0) }), /projection mutated/);
  assert.deepEqual(guarded.campaignSnapshot, beforeGuard);
  const unowned = structuredClone(fixture.mission);
  assert.throws(() => new MissionView(canvas(), stage, callbacks, unowned), /authenticated configuration identity/);
  const mismatched = await createNativeCombatMissionFixture(false, { localTeam: 1, localMask: 0x20000000, daylight: 0, crtSeed: 1 });
  assert.throws(() => new MissionView(canvas(), stage, callbacks, mismatched.mission), /local team 0/);
  assert.throws(() => new MissionView(canvas(), stage, callbacks, { ...fixture.mission, faction: "alien" }), /matching player faction/);
  const normal = await createNativeCombatMissionFixture();
  const normalView = new MissionView(canvas(), stage, callbacks, normal.mission);
  assert.throws(() => normalView.advanceNativeVisibility({ visibilityFrame: phase(normalView, 1, 0) }), /visibility owner/);
  const originalConfiguration = fixture.mission.sourceNativeCombat!.options.nativeCombat.visibility;
  Object.assign(fixture.mission.sourceNativeCombat!.options, { nativeCombat: { ...fixture.mission.sourceNativeCombat!.options.nativeCombat,
    visibility: { ...originalConfiguration, localMask: 0 } } });
  assert.throws(() => view.advanceNativeVisibility({ visibilityFrame: phase(view, 3, 0) }), /configuration changed/);
});

test("MissionView native visibility natural cells: compute, clear, movement masks, raw actors and pending attack", async context => {
  const fixture = await createNativeCombatMissionFixture(false, { localTeam: 0, localMask: 0x40000000, daylight: 0, crtSeed: 1 });
  const mission = { ...fixture.mission, sourceNativeCombat: { ...fixture.mission.sourceNativeCombat!,
    playerCommands: { scope: "bounded-semantic-queue" as const, localTeam: 0 as const } } };
  let sounds = 0;
  const view = new MissionView(canvas(), stage, { ...callbacks, onNativeDeathSound() { sounds++; } }, mission);
  await view.initializeNativeCombatPresentation(async url => Uint8Array.from(readFileSync(new URL(
    `../../${url.startsWith("/assets/") ? `public${url}` : url.slice(1)}`, import.meta.url))));
  for (let counter = 1; counter <= 16; counter++) view.advanceNativeCombat(nativeCombatInput(view.campaignSnapshot!));
  const before = view.checkpoint(), initial = view.campaignSnapshot!, host = transportHostState(initial.world);
  const source = host.slots.find(actor => actor?.key.startsWith("transport:") && actor.team === 0)!;
  const target = host.slots.find(actor => actor?.key.startsWith("transport:") && actor.team === 5)!;
  const targetCell = (target.position.y >>> 8) * host.width + (target.position.x >>> 8);
  assert.deepEqual(view.visibility, Uint8Array.from(host.nativeAiTasks!.ground, word => Number(Boolean(word & 0x40000000))));
  assert.equal(view.explored.some(Boolean), false, "movement sight must not invent exploration before a phase");
  const result = view.advanceNativeVisibility({ visibilityFrame: phase(view, 1, 0, [source.slot]) });
  const naturalCells = [...view.explored].flatMap((bit, cell) => bit ? [cell] : []);
  assert.ok(naturalCells.length > 0);
  assert.equal(view.visibility[targetCell], 1);
  assert.equal(view.explored[targetCell], 1);
  assert.deepEqual(view.explored, Uint8Array.from(result.visibility.groundWords, word => word >>> 31));
  assert.deepEqual(view.visibility, Uint8Array.from(result.visibility.groundWords, word => Number(Boolean(word & 0x40000000))));
  assert.deepEqual(view.simulation.checkpoint(), before.simulation);
  assert.equal(view.campaignSnapshot!.cycleCounter, 16);
  assert.equal(view.campaignSnapshot!.world.clockMilliseconds, initial.world.clockMilliseconds);
  const current = view.campaignSnapshot!, currentHost = transportHostState(current.world);
  assert.equal(currentHost.tick, host.tick);
  assert.equal(currentHost.nativeAiTasks!.rngCursor, host.nativeAiTasks!.rngCursor);
  for (let index = 0; index < initial.world.entityBytes!.length; index++) {
    if (index % 220 !== 0xca) assert.equal(current.world.entityBytes![index], initial.world.entityBytes![index]);
  }
  for (const actor of currentHost.slots) if (actor?.nativeAiTask) {
    assert.deepEqual(actor.nativeAiTask.raw, Array.from(current.world.entityBytes!.slice(actor.slot * 220, (actor.slot + 1) * 220)));
  }
  for (const original of fixture.initial.entities) assert.ok(current.world.entities.some(actor => actor.key === original.key));
  assert.equal(current.world.entities.length, 23);
  assert.equal(view.resourceSources.length, 4);
  assert.equal(sounds, 0);
  view.replaceSelection([view.nativeBindings.find(binding => binding.slot === source.slot)!.simulationId]);
  const targetNow = currentHost.slots[target.slot]!;
  const queued = view.queueNativePlayerOrder({ type: "Attack", destination: { column: fixture.column + 1, row: fixture.row },
    target: { slot: targetNow.slot, generation: targetNow.generation, key: targetNow.key, raw: [...targetNow.nativeAiTask!.raw] } });
  assert.ok(queued.ok, JSON.stringify(queued));
  const pending = view.nativeCommandStatus.pending;
  view.advanceNativeVisibility({ visibilityFrame: phase(view, 2, 1, [source.slot]) });
  assert.deepEqual(view.nativeCommandStatus.pending, pending);
  const saved = view.checkpoint(), providers = await fixture.recreateProviders();
  const external = { ...mission, sourceNativeCombat: { ...mission.sourceNativeCombat,
    options: { ...mission.sourceNativeCombat.options, ...providers } } };
  const restored = MissionView.restore(canvas(), stage, callbacks, external, saved);
  assert.deepEqual(restored.checkpoint(), saved);
  const stale = structuredClone(saved);
  assert.equal(stale.state.nativeCommand!.command.type, "Attack");
  if (stale.state.nativeCommand!.command.type === "Attack") (stale.state.nativeCommand!.command.target.raw as number[])[0xca] ^= 1;
  assert.throws(() => MissionView.restore(canvas(), stage, callbacks, external, stale), /Stale/);
  const cleared = view.advanceNativeVisibility({ visibilityFrame: phase(view, 3, 16) });
  assert.equal(view.visibility.some(Boolean), false);
  assert.deepEqual(view.explored, Uint8Array.from(cleared.visibility.groundWords, word => word >>> 31));
  assert.deepEqual([...view.explored].flatMap((bit, cell) => bit ? [cell] : []), naturalCells);
  assert.deepEqual(view.nativeCommandStatus.pending, pending, "visibility never rebases expected raw bytes");
  const beforeRejected = view.checkpoint();
  assert.throws(() => view.advanceNativeCombat(nativeCombatInput(view.campaignSnapshot!)), /Hidden|hidden|acquisition/);
  assert.deepEqual(view.checkpoint(), beforeRejected);
  assert.equal(sounds, 0);
  context.diagnostic(`Natural source producer ${source.slot}: ${naturalCells.length} explored cells, target cell ${targetCell}; clear retains exact bit31`);
});
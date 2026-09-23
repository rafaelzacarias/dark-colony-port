import assert from "node:assert/strict";
import test from "node:test";
import { CampaignSession } from "../../src/engine/campaign-session";
import { MissionView } from "../../src/mission-view";
import type { SkirmishCallbacks } from "../../src/simulation-view";
import type { SourceNativeCombatFrame } from "../../src/engine/source-native-combat-mission";
import { createNativeCombatMissionFixture, nativeCombatPacket } from "./fixtures/native-combat-mission";

test("MissionView native visibility sound: natural exploration, separate lethal commit and exactly-once consumer", async context => {
  const fixture = await createNativeCombatMissionFixture(true, { localTeam: 0, localMask: 0x40000000, daylight: 0, crtSeed: 1 }, true);
  const canvas = { width: 512, height: 452, getContext: () => null } as unknown as HTMLCanvasElement;
  const stage = {} as HTMLElement;
  const sounds: Parameters<NonNullable<SkirmishCallbacks["onNativeDeathSound"]>>[0][] = [];
  const callbacks = { onStats() {}, onUnitsChanged() {}, onNativeDeathSound: undefined as SkirmishCallbacks["onNativeDeathSound"] };
  const view = new MissionView(canvas, stage, callbacks, fixture.mission);
  let registeredSlots: number[] = [];
  const next = (packets?: number[][]): SourceNativeCombatFrame => {
    const state = view.nativeCombatFrameState, counter = state.cycleCounter + 1;
    return { clockMilliseconds: counter * 16, nativeAiFrame: { counter, task6Budget: 0, registeredSlots, sound: fixture.soundFrame! },
      ...(packets ? { nativeAiReceipt: { id: `view-visibility-sound:${counter}`, packets,
        expected: state.actors.flatMap(actor => actor.raw ? [{ slot: actor.slot, generation: actor.generation, key: actor.key, raw: actor.raw }] : []) } } : {}) };
  };
  for (let counter = 1; counter <= 16; counter++) view.advanceNativeCombat(next());
  const added = view.nativeCombatFrameState.actors.filter(actor => actor.key.startsWith("transport:"));
  const source = added.find(actor => actor.team === 0)!, target = added.find(actor => actor.team === 5)!;
  registeredSlots = [source.slot, target.slot].sort((left, right) => left - right);
  view.advanceNativeCombat(next([nativeCombatPacket(source.slot, fixture.column + 2, fixture.row, 7)]));
  for (let count = 0; count < 40; count++) view.advanceNativeCombat(next());
  view.advanceNativeCombat(next([nativeCombatPacket(target.slot, fixture.column, fixture.row)]));
  while (view.nativeCombatFrameState.cycleCounter < 613) view.advanceNativeCombat(next());
  const beforeVisibility = view.checkpoint(), host = beforeVisibility.session!.state.world.transportState;
  assert.equal(host.slots[target.slot]!.health, 25);
  assert.equal(host.nativeCombat!.journal.flatMap(entry => entry.impacts).length, 31);
  const targetCell = (host.slots[target.slot]!.position.y >>> 8) * view.grid.width + (host.slots[target.slot]!.position.x >>> 8);
  assert.equal(view.explored[targetCell], 0);
  const bytes = beforeVisibility.session!.state.world.entityBytes!;
  const eligible = Array.from({ length: 800 }, (_, slot) => slot).filter(slot => bytes[slot * 220 + 0x2c]
    && bytes[slot * 220 + 7] <= 7 && ![1, 2].includes(bytes[slot * 220 + 0xcb]));
  const result = view.advanceNativeVisibility({ visibilityFrame: { sequence: 1, counter: 0, producerSlots: [source.slot],
    excludedProducerSlots: eligible.filter(slot => slot !== source.slot) } });
  assert.equal(view.visibility[targetCell], 1);
  assert.equal(view.explored[targetCell], 1);
  assert.deepEqual(view.explored, Uint8Array.from(result.visibility.groundWords, word => word >>> 31));
  assert.deepEqual(view.simulation.checkpoint(), beforeVisibility.simulation);
  view.advanceNativeVisibility({ visibilityFrame: { sequence: 2, counter: 16, producerSlots: [], excludedProducerSlots: eligible } });
  assert.equal(view.visibility[targetCell], 0);
  assert.equal(view.explored[targetCell], 1);
  assert.equal(sounds.length, 0);
  const beforeLethal = view.checkpoint();
  assert.deepEqual(beforeLethal.session!.state.world.transportState.nativeCombat!.soundState, host.nativeCombat!.soundState);
  assert.equal(beforeLethal.session!.state.world.transportState.nativeAiTasks!.rngCursor, host.nativeAiTasks!.rngCursor);
  assert.throws(() => view.advanceNativeCombat(next()), /no owner/);
  assert.deepEqual(view.checkpoint(), beforeLethal, "missing consumer rejects the complete lethal transaction");
  const callbackFailure = new Error("owned consumer failed after observing committed lethal state");
  callbacks.onNativeDeathSound = request => {
    assert.equal(view.nativeCombatFrameState.cycleCounter, 614);
    const committed = view.checkpoint();
    assert.equal(committed.session!.state.world.transportState.slots[target.slot]!.health, 0);
    assert.equal(view.visibility[targetCell], 0);
    assert.equal(view.explored[targetCell], 1);
    sounds.push(request);
    throw callbackFailure;
  };
  const nativeStep = CampaignSession.prototype.stepForNativeView;
  try {
    CampaignSession.prototype.stepForNativeView = function(input) {
      const result = nativeStep.call(this, input);
      if (result.ok) result.value.transport.slots[source.slot]!.health--;
      return result;
    };
    assert.throws(() => view.advanceNativeCombat(next()), /projection identity/);
    assert.deepEqual(view.checkpoint(), beforeLethal);
    assert.equal(sounds.length, 0);
  } finally { CampaignSession.prototype.stepForNativeView = nativeStep; }
  assert.throws(() => view.advanceNativeCombat(next()), error => error instanceof AggregateError && error.errors.includes(callbackFailure));
  assert.equal(sounds.length, 1);
  assert.equal(sounds[0].slot, target.slot);
  assert.equal(sounds[0].id, 28);
  const committed = view.checkpoint();
  const providers = await fixture.recreateProviders();
  const restored = MissionView.restore(canvas, stage, callbacks, { ...fixture.mission, sourceNativeCombat: {
    ...fixture.mission.sourceNativeCombat!, options: { ...fixture.mission.sourceNativeCombat!.options, ...providers },
  } }, committed);
  assert.deepEqual(restored.checkpoint(), committed);
  assert.equal(sounds.length, 1, "restore must not publish historical audio");
  registeredSlots = [target.slot];
  const followup = next();
  view.advanceNativeCombat(followup);
  restored.advanceNativeCombat(followup);
  assert.deepEqual(restored.checkpoint(), view.checkpoint());
  assert.equal(sounds.length, 1);
  assert.equal(view.campaignSnapshot!.world.entities.length, 23);
  for (const original of fixture.initial.entities) assert.ok(view.campaignSnapshot!.world.entities.some(entity => entity.key === original.key));
  context.diagnostic(`Natural cell ${targetCell}: bit31 survives clear; actor614 delivers sound28 once after commit; fresh full-history restore agrees`);
});
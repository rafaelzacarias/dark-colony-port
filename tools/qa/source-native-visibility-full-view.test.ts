import assert from "node:assert/strict";
import test from "node:test";
import { MissionView } from "../../src/mission-view";
import { createNativeCombatMissionFixture } from "./fixtures/native-combat-mission";

test("full fresh HUMAN02 visibility uses existing view methods and restores every producer", async context => {
  const started = performance.now();
  const fixture = await createNativeCombatMissionFixture(false, { localTeam: 0, localMask: 0x40000000, daylight: 0, crtSeed: 1 });
  const canvas = () => ({ width: 512, height: 452, getContext: () => null }) as unknown as HTMLCanvasElement;
  const stage = {} as HTMLElement, callbacks = { onStats() {}, onUnitsChanged() {} };
  const view = new MissionView(canvas(), stage, callbacks, fixture.mission);
  const initial = view.checkpoint();
  const producerSlots = [0, 1, 5, 152, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165];
  const visibilityFrame = { sequence: 1, counter: 16, producerSlots, excludedProducerSlots: [] };
  const result = view.advanceNativeVisibility({ visibilityFrame });
  assert.deepEqual(result.visibilityEvent, { ...visibilityFrame, executed: true, phases: ["clear", "compute"],
    writes: 10487, rngCursor: 0, crtSeed: 1 });
  assert.equal(view.visibility.filter(Boolean).length, 411);
  assert.equal(view.explored.filter(Boolean).length, 411);
  assert.deepEqual(view.visibility, Uint8Array.from(result.visibility.groundWords, word => Number(Boolean(word & 0x40000000))));
  assert.deepEqual(view.explored, Uint8Array.from(result.visibility.groundWords, word => word >>> 31));
  const saved = view.checkpoint();
  assert.equal(saved.session!.state.world.entities.length, 21);
  assert.deepEqual(saved.session!.state.world.entities, initial.session!.state.world.entities);
  assert.deepEqual(saved.session!.state.nativeSourceInputs, [{ visibilityFrame }]);
  assert.deepEqual(saved.session!.state.world.transportState.nativeCombat!.visibility!.journal, [result.visibilityEvent]);
  assert.equal(saved.session!.state.cycleCounter, initial.session!.state.cycleCounter);
  assert.equal(saved.session!.state.world.clockMilliseconds, initial.session!.state.world.clockMilliseconds);
  assert.deepEqual(saved.simulation, initial.simulation);
  result.visibility.groundWords.fill(0);
  view.visibility.fill(0);
  view.explored.fill(0);
  assert.deepEqual(view.checkpoint(), saved);
  const providers = await fixture.recreateProviders();
  const mission = { ...fixture.mission, sourceNativeCombat: { ...fixture.mission.sourceNativeCombat!,
    options: { ...fixture.mission.sourceNativeCombat!.options, ...providers } } };
  const restored = MissionView.restore(canvas(), stage, callbacks, mission, saved);
  assert.deepEqual(restored.checkpoint(), saved);
  assert.equal(restored.visibility.filter(Boolean).length, 411);
  assert.equal(restored.explored.filter(Boolean).length, 411);
  const changed = structuredClone(saved);
  const journal = changed.session!.state.world.transportState.nativeCombat!.visibility!.journal;
  journal[0] = { ...journal[0], excludedProducerSlots: [5] };
  assert.throws(() => MissionView.restore(canvas(), stage, callbacks, mission, changed), /replay|visibility/i);
  context.diagnostic(JSON.stringify({ actors: 21, selected: 14, excluded: [], explored: 411, sight: 411,
    milliseconds: performance.now() - started, browser: false }));
});
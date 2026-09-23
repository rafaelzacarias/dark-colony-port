import assert from "node:assert/strict";
import test from "node:test";
import { MissionView } from "../../src/mission-view";
import type { SkirmishCallbacks } from "../../src/simulation-view";
import { CampaignSession } from "../../src/engine/campaign-session";
import type { SourceNativeCombatFrame, SourceNativeCombatMission } from "../../src/engine/source-native-combat-mission";
import { transportHostState } from "../../src/engine/transport-host";
import { createNativeCombatMissionFixture, nativeCombatInput, nativeCombatPacket } from "./fixtures/native-combat-mission";

const canvas = () => ({ width: 512, height: 452, getContext: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) }) as unknown as HTMLCanvasElement;
const stage = {} as HTMLElement, callbacks = { onStats() {}, onUnitsChanged() {} };
const create = (mission: SourceNativeCombatMission, consumer: SkirmishCallbacks = callbacks) => {
  const view = new MissionView(canvas(), stage, consumer, mission);
  assert.equal(view.missionDiagnostic, undefined);
  return view;
};

test("MissionView explicit authenticated combat: actual hit projection, reaction, rollback and external restore", async context => {
  const sounds: Parameters<NonNullable<SkirmishCallbacks["onNativeDeathSound"]>>[0][] = [];
  const consumer: SkirmishCallbacks = { ...callbacks, onNativeDeathSound: request => { sounds.push(request); } };
  const { mission, column, row, recreateProviders, initial } = await createNativeCombatMissionFixture();
  const view = create(mission, consumer), oracle = new CampaignSession(mission.sourceNativeCombat!.options);
  const before = view.checkpoint(), random = view.simulation.random.state;
  assert.equal(initial.entities.length, 21);
  view.update(0); view.update(10000);
  assert.deepEqual(view.checkpoint(), before, "wallclock must not invent native visits");
  assert.throws(() => view.advanceNativeCombat({ clockMilliseconds: 16 } as SourceNativeCombatFrame), /explicit visits/);
  assert.deepEqual(view.checkpoint(), before);
  assert.throws(() => view.advanceNativeCombat({ ...nativeCombatInput(view.campaignSnapshot!), updates: [] } as SourceNativeCombatFrame), /native receipts only/);
  assert.throws(() => view.stopSelected(), /native receipt/);
  view.setOrderMode("move");
  assert.throws(() => view.commandAt(256, 226), /native Move\/Attack receipt/);
  assert.equal(view.simulation.checkpoint().commands.length, 0);
  const step = (packets?: number[][]) => {
    const input = nativeCombatInput(view.campaignSnapshot!, packets);
    const expected = oracle.step(input);
    if (!expected.ok) assert.fail(JSON.stringify(expected.diagnostics));
    view.advanceNativeCombat(input);
    assert.deepEqual(sounds, [], "warm/nonlethal commits must not invent sound requests");
    assert.deepEqual(view.campaignSnapshot, oracle.snapshot);
    const host = transportHostState(view.campaignSnapshot!.world);
    for (const binding of view.nativeBindings) {
      const simulated = [...view.simulation.snapshot.units, ...view.simulation.snapshot.staticTargets].find(entry => entry.id === binding.simulationId)!;
      const actor = host.slots[binding.slot]!;
      assert.deepEqual([simulated.health, simulated.xSubcells, simulated.ySubcells], [actor.health, actor.position.x * 4, actor.position.y * 4]);
    }
    assert.equal(view.simulation.random.state, random);
    assert.equal(view.simulation.combatEvents.length, 0);
    assert.equal(view.simulation.checkpoint().commands.length, 0);
    assert.ok(view.simulation.checkpoint().units.every(unit => unit.weapon === null && unit.harvester === null && unit.path.length === 0));
    if (expected.value.cycleCounter % 16 === 0) context.diagnostic(`native frame ${expected.value.cycleCounter} agrees with direct host`);
    return host;
  };
  for (let count = 0; count < 16; count++) step();
  const allocated = transportHostState(view.campaignSnapshot!.world).slots.filter(actor => actor?.key.startsWith("transport:"));
  assert.equal(allocated.length, 2);
  const source = allocated.find(actor => actor!.team === 0)!, target = allocated.find(actor => actor!.team === 5)!;
  step([nativeCombatPacket(source.slot, column + 2, row, 7)]);
  for (let count = 0; count < 40; count++) step();
  step([nativeCombatPacket(target.slot, column, row)]);
  let hit = false;
  while (view.campaignSnapshot!.cycleCounter < 95) {
    const host = step();
    if (host.nativeCombat!.journal.at(-1)!.impacts.length) { hit = true; break; }
  }
  assert.ok(hit, "must project a real positive nonlethal impact");
  const hitHost = transportHostState(view.campaignSnapshot!.world);
  assert.equal(view.campaignSnapshot!.cycleCounter, 87);
  assert.equal(view.campaignSnapshot!.world.entities.length, 23);
  for (const original of initial.entities) assert.ok(view.campaignSnapshot!.world.entities.some(entity => entity.key === original.key));
  assert.equal(hitHost.nativeCombat!.journal.flatMap(entry => entry.spawns).length, 1);
  assert.equal(hitHost.nativeCombat!.journal.flatMap(entry => entry.impacts).length, 1);
  assert.equal(hitHost.nativeCombat!.journal.flatMap(entry => entry.reclaimed).length, 1);
  assert.ok(hitHost.slots[target.slot]!.health > 0 && hitHost.slots[target.slot]!.health < target.health);
  context.diagnostic(`frame87 hit HP ${target.health}->${hitHost.slots[target.slot]!.health}; one launch/impact/reclaim`);
  const saved = JSON.parse(JSON.stringify(view.checkpoint()));
  const providers = await recreateProviders();
  const external = { ...mission, sourceNativeCombat: { ...mission.sourceNativeCombat!, options: { ...mission.sourceNativeCombat!.options, ...providers } } };
  const restored = MissionView.restore(canvas(), stage, consumer, external, saved);
  assert.deepEqual(sounds, [], "restore must not dispatch presentation effects");
  assert.deepEqual(restored.checkpoint(), saved);
  const reactionInput = nativeCombatInput(view.campaignSnapshot!);
  restored.advanceNativeCombat(reactionInput); step();
  assert.deepEqual(restored.checkpoint(), view.checkpoint());
  const reacted = transportHostState(view.campaignSnapshot!.world).slots[target.slot]!.nativeAiTask!.raw;
  assert.deepEqual([reacted[0xc7], reacted[0xc8], reacted[0xc9], reacted[0x22]], [0, 1, 1, 1]);
  for (const mutate of [
    (copy: typeof saved) => { copy.simulation.units[0].health--; },
    (copy: typeof saved) => { copy.simulation.units[0].xSubcells++; },
    (copy: typeof saved) => { copy.simulation.staticTargets[0].health--; },
    (copy: typeof saved) => { copy.simulation.randomState ^= 1; },
  ]) {
    const copy = structuredClone(before); mutate(copy);
    assert.throws(() => MissionView.restore(canvas(), stage, callbacks, external, copy), /native combat projection/);
  }
  const missing = { ...mission, sourceNativeCombat: { ...mission.sourceNativeCombat!, options: { ...mission.sourceNativeCombat!.options,
    nativeCombat: undefined } } } as unknown as SourceNativeCombatMission;
  assert.throws(() => MissionView.restore(canvas(), stage, callbacks, missing, saved), /Invalid MissionView checkpoint|bounded session/);
  while (view.campaignSnapshot!.cycleCounter < 95) step();
  const lateBefore = view.checkpoint(), journal = view.campaignJournal;
  assert.throws(() => view.advanceNativeCombat(nativeCombatInput(view.campaignSnapshot!)), /unsupported source native allocation/);
  assert.deepEqual(view.checkpoint(), lateBefore);
  assert.deepEqual(view.campaignJournal, journal);
  assert.deepEqual(sounds, [], "late source failure must not dispatch sound");
  const guardView = create(mission, consumer);
  const baseline = guardView.campaignSnapshot;
  guardView.simulation.queue({ type: "stop", unitIds: guardView.selectedIds });
  assert.throws(() => guardView.advanceNativeCombat(nativeCombatInput(guardView.campaignSnapshot!)), /projection mutated/);
  assert.deepEqual(guardView.campaignSnapshot, baseline);
  assert.deepEqual(sounds, [], "projection guard must not dispatch sound");
});
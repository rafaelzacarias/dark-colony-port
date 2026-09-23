import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { sourceNativeCombatSessionOptions, sourceNativeCombatActorSample, type SourceNativeCombatMission } from "../../src/engine/source-native-combat-mission";
import { MissionView } from "../../src/mission-view";
import { transportHostState } from "../../src/engine/transport-host";
import { createNativeCombatMissionFixture, nativeCombatInput, nativeCombatPacket } from "./fixtures/native-combat-mission";
import { SOURCE_NATIVE_COMBAT_DEATH_FIELDS, SOURCE_NATIVE_COMBAT_REACTION_FIELDS } from "../../src/engine/source-native-combat-options";
import { parseFin } from "../extractors/animations/fin";
import { createFinFrameLookup, type FinAnimationData, type FinAtlasFrame } from "../../src/render/fin-animation";
import { composeFinSample } from "../../src/render/fin-composition";

const canvas = () => ({ width: 512, height: 452, getContext: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) }) as unknown as HTMLCanvasElement;
const stage = {} as HTMLElement, callbacks = { onStats() {}, onUnitsChanged() {} };
const originalFin = () => parseFin(readFileSync(new URL("../../raw_cd/DC/ANIMATE/TRSC.FIN", import.meta.url)));

test("native combat FIN samples original death and reaction banks without elapsed animation", async () => {
  const { mission } = await createNativeCombatMissionFixture(true);
  const view = new MissionView(canvas(), stage, callbacks, mission);
  for (let counter = 1; counter <= 16; counter++) view.advanceNativeCombat(nativeCombatInput(view.campaignSnapshot!, undefined, []));
  const host = transportHostState(view.campaignSnapshot!.world);
  const actor = structuredClone(host.slots.find(actor => actor?.nativeAiTask && actor.unitType === 0)!);
  const profile = host.nativeAiTasks!.configuration.profiles[actor.nativeAiTask!.profile];
  const animation = originalFin();
  const generated: FinAnimationData = JSON.parse(readFileSync(new URL("../../public/assets/generated/animations/TRSC.json", import.meta.url), "utf8"));
  const atlases = Object.fromEntries([...new Set(animation.timeline.flatMap(frame => frame.children.map(child => child.sprite)))].map(sprite =>
    [sprite, JSON.parse(readFileSync(new URL(`../../public/assets/generated/sprites/SPRITES/${sprite}.json`, import.meta.url), "utf8")) as { frames: FinAtlasFrame[] }]));
  const lookup = createFinFrameLookup(atlases);
  const raw = Uint8Array.from(actor.nativeAiTask!.raw), words = new DataView(raw.buffer);
  actor.status = 10; actor.health = 0;
  for (const field of SOURCE_NATIVE_COMBAT_DEATH_FIELDS) for (let direction = 0; direction < 256; direction += 8) {
    raw[9] = direction; words.setUint32(0x14, field.id, true); raw[0x1a] = 1;
    const nativeDirection = (((direction + 8) & 255) >> 4) * 2;
    raw[0x18] = profile.fin[field.id][nativeDirection].length - 1; raw[0x19] = 7;
    words.setUint32(0x1c, SOURCE_NATIVE_COMBAT_REACTION_FIELDS[2].id, true);
    raw[0x20] = 0; raw[0x21] = 3; raw[0x22] = 1;
    actor.nativeAiTask!.raw = [...raw];
    const actual = sourceNativeCombatActorSample(generated, actor, profile, "TRSC");
    assert.deepEqual(actual, sourceNativeCombatActorSample(animation, actor, profile, "TRSC"));
    assert.equal(actual.primary.delay, 7);
    assert.equal(actual.primary.frame, raw[0x18]);
    assert.equal(actual.secondary?.delay, 3);
    assert.ok(actual.primary.state.startsWith(field.name));
    assert.equal(actual.sample.children.length, actual.primary.sample.children.length + actual.secondary!.sample.children.length);
    const parts = composeFinSample(actual.sample, lookup);
    assert.ok(parts.length > 0 && parts.every(part => part.frame && !part.diagnostics.includes("missing-atlas-frame")));
    raw[0x18] = 0; raw[0x1a] = 2; raw[0x22] = 2;
    actor.nativeAiTask!.raw = [...raw];
    const completed = sourceNativeCombatActorSample(animation, actor, profile, "TRSC");
    assert.equal(completed.primary.sample.finished, true);
    assert.equal(completed.primary.frame, 0);
    assert.equal(completed.secondary, undefined);
    assert.ok(completed.primary.sample.children.length > 0);
    assert.ok(composeFinSample(completed.sample, lookup).every(part => part.frame));
  }
  actor.nativeAiTask!.raw[0x14] = 255;
  assert.throws(() => sourceNativeCombatActorSample(animation, actor, profile, "TRSC"), /Unsupported source native combat FIN/);
});

test("native combat mission rejects relabelled nonlethal and lethal providers", () => {
  for (const lethal of [false, true]) {
    const mission = { sourceNativeCombat: {
      scope: lethal ? "source-separated-type0-weapon1-bounded-lethal" : "source-separated-type0-weapon1-nonlethal",
      options: { nativeAiTasks: {}, nativeCombat: {
        scope: lethal ? "source-separated-type0-weapon1-nonlethal" : "source-separated-type0-weapon1-bounded-lethal",
        ...(lethal ? {} : { death: {} }),
      } },
    } } as unknown as SourceNativeCombatMission;
    assert.throws(() => sourceNativeCombatSessionOptions(mission), /scope does not match authenticated/);
  }
});

test("MissionView bounded lethal projection retains death until native unregister and valid reuse", async context => {
  const { mission, column, row, initial, recreateProviders } = await createNativeCombatMissionFixture(true);
  let view = new MissionView(canvas(), stage, callbacks, mission);
  assert.equal(view.missionDiagnostic, undefined);
  assert.equal(initial.entities.length, 21);
  const random = view.simulation.random.state;
  const animation = originalFin();
  let completedWhileRegistered = false, secondaryReaction = false;
  let beforeDeath: ReturnType<MissionView["checkpoint"]> | undefined;
  let registeredSlots: number[] = [];
  const step = (packets?: number[][]) => {
    view.advanceNativeCombat(nativeCombatInput(view.campaignSnapshot!, packets, registeredSlots));
    return transportHostState(view.campaignSnapshot!.world);
  };
  for (let counter = 1; counter <= 16; counter++) step();
  const added = transportHostState(view.campaignSnapshot!.world).slots.filter(actor => actor?.key.startsWith("transport:"));
  const source = added.find(actor => actor!.team === 0)!, target = added.find(actor => actor!.team === 5)!;
  const binding = view.nativeBindings.find(entry => entry.slot === target.slot)!;
  registeredSlots = [source.slot, target.slot].sort((left, right) => left - right);
  step([nativeCombatPacket(source.slot, column + 2, row, 7)]);
  for (let count = 0; count < 40; count++) step();
  step([nativeCombatPacket(target.slot, column, row)]);
  while (view.campaignSnapshot!.cycleCounter < 784) {
    const host = step(), counter = view.campaignSnapshot!.cycleCounter;
    const victim = host.slots[target.slot]!;
    const projected = view.simulation.snapshot.units.find(unit => unit.id === binding.simulationId);
    if (counter < 614) assert.ok(projected && projected.health > 0);
    if (counter === 613) beforeDeath = view.checkpoint();
    if (counter >= 614 && counter < 764) {
      assert.equal(victim.status, 10);
      assert.equal(victim.health, 0);
      assert.equal(host.registry[target.slot], target.key);
      assert.equal(host.ground.includes(target.slot), false);
      assert.equal(host.nativeCombat!.death!.pending[0].visits, counter - 614);
      assert.equal(projected?.health, 0);
      assert.equal(projected?.activity, "die");
      const sample = sourceNativeCombatActorSample(animation, victim,
        host.nativeAiTasks!.configuration.profiles[victim.nativeAiTask!.profile], "TRSC");
      secondaryReaction ||= !!sample.secondary;
      if (counter > 614) assert.ok(sample.primary.state.startsWith("TRSCDIE"));
      if (sample.primary.state.startsWith("TRSCDIE") && sample.primary.sample.finished) {
        completedWhileRegistered = true;
        assert.ok(sample.primary.sample.children.length > 0);
      }
      if ([615, 649].includes(counter)) context.diagnostic(JSON.stringify({ counter, primary: sample.primary,
        secondary: sample.secondary }));
      registeredSlots = [target.slot];
    }
    if (counter === 649) {
      const saved = view.checkpoint();
      const providers = await recreateProviders();
      const external = { ...mission, sourceNativeCombat: { ...mission.sourceNativeCombat!,
        options: { ...mission.sourceNativeCombat!.options, ...providers } } };
      const before = MissionView.restore(canvas(), stage, callbacks, external, beforeDeath!);
      assert.deepEqual(before.checkpoint(), beforeDeath);
      view = MissionView.restore(canvas(), stage, callbacks, external, saved);
      assert.deepEqual(view.checkpoint(), saved);
      for (const mutate of [
        (copy: typeof saved) => { const unit = copy.simulation.units.find(unit => unit.id === binding.simulationId)!; unit.health = 1; unit.activity = "idle"; },
        (copy: typeof saved) => { copy.simulation.units.find(unit => unit.id !== binding.simulationId)!.health--; },
        (copy: typeof saved) => { copy.simulation.staticTargets[0].health--; },
      ]) {
        const changed = structuredClone(saved); mutate(changed);
        assert.throws(() => MissionView.restore(canvas(), stage, callbacks, external, changed), /native combat projection/);
      }
      const originalCheckpoint = view.simulation.checkpoint.bind(view.simulation);
      view.simulation.checkpoint = () => { const changed = originalCheckpoint(); changed.staticTargets[0].health--; return changed; };
      assert.throws(() => view.advanceNativeCombat(nativeCombatInput(view.campaignSnapshot!, undefined, registeredSlots)), /projection mutated/);
      view.simulation.checkpoint = originalCheckpoint;
      assert.deepEqual(view.checkpoint(), saved);
      const clockBefore = view.checkpoint(); view.update(0); view.update(100000);
      assert.deepEqual(view.checkpoint(), clockBefore);
    }
    if (counter === 764) {
      assert.equal(victim.status, 0);
      assert.equal(host.registry[target.slot], null);
      assert.equal(projected, undefined);
      assert.equal(host.nativeCombat!.journal.flatMap(entry => entry.impacts).length, 32);
      registeredSlots = [];
    }
    if (counter === 784) {
      assert.equal(victim.generation, target.generation + 1);
      assert.equal(victim.health, 800);
      const rebound = view.nativeBindings.find(entry => entry.slot === target.slot && entry.generation === victim.generation)!;
      assert.notEqual(rebound.simulationId, binding.simulationId);
      assert.equal(view.simulation.snapshot.units.find(unit => unit.id === rebound.simulationId)?.health, 800);
      const saved = view.checkpoint(), providers = await recreateProviders();
      view = MissionView.restore(canvas(), stage, callbacks, { ...mission, sourceNativeCombat: { ...mission.sourceNativeCombat!,
        options: { ...mission.sourceNativeCombat!.options, ...providers } } }, saved);
      assert.deepEqual(view.checkpoint(), saved);
    }
    if ([613, 614, 649, 763, 764, 784].includes(counter)) context.diagnostic(`counter ${counter}: status ${victim.status}, HP ${victim.health}`);
  }
  for (const original of initial.entities) assert.ok(view.campaignSnapshot!.world.entities.some(entity => entity.key === original.key));
  assert.equal(view.simulation.random.state, random);
  assert.equal(view.simulation.combatEvents.length, 0);
  assert.equal(view.simulation.deathEvents.length, 0);
  assert.ok(completedWhileRegistered, "FIN completion must not unregister a native corpse");
  assert.ok(secondaryReaction, "must retain the actual secondary reaction during death");
  context.diagnostic("Bounded original death FIN sample and reaction verified; projectile effects and source sound dispatch remain unsupported by this view");
});
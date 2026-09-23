import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { CampaignSession } from "../../src/engine/campaign-session";
import { transportHostState, validateNativeAiTaskAlignment, cloneTransportHostWorld, type TransportHostState, type HostSlot } from "../../src/engine/transport-host";
import { sourceNativeCombatActorSample, sourceNativeCombatSessionOptions } from "../../src/engine/source-native-combat-mission";
import { sourceNativeCombatBankFields } from "../../src/engine/source-native-combat-options";
import { MissionView } from "../../src/mission-view";
import { parseFin } from "../extractors/animations/fin";
import { createNativeCombatAlienFixture, alienVisibilityFrame } from "./fixtures/native-combat-alien";
import { nativeCombatInput, nativeCombatPacket } from "./fixtures/native-combat-mission";
import { decodeLegacyAiTaskStack } from "../../src/engine/legacy-ai-task";

const canvas = () => ({ width: 512, height: 452, getContext: () => null,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 512, height: 452 }) }) as unknown as HTMLCanvasElement;
const stage = {} as HTMLElement, callbacks = { onStats() {}, onUnitsChanged() {} };

test("ALIEN runtime: full fresh visibility and genuine allocated native attack", async context => {
  const fixture = await createNativeCombatAlienFixture();
  const session = new CampaignSession(fixture.options);
  const view = new MissionView(canvas(), stage, callbacks, fixture.mission);
  assert.equal(view.missionDiagnostic, undefined);
  assert.equal(sourceNativeCombatSessionOptions(fixture.mission), fixture.options);
  assert.throws(() => sourceNativeCombatSessionOptions({ ...fixture.mission, sourceNativeCombat: {
    ...fixture.mission.sourceNativeCombat!, scope: "source-separated-type0-weapon1-nonlethal" } }), /scope does not match/);
  assert.throws(() => sourceNativeCombatSessionOptions({ ...fixture.mission, sourceNativeCombat: {
    ...fixture.mission.sourceNativeCombat!, scope: "source-separated-type0-weapon1-bounded-lethal" } }), /scope does not match/);
  const viewBefore = view.checkpoint(), simulationRandom = view.simulation.random.state;
  view.update(10000);
  assert.deepEqual(view.checkpoint(), viewBefore, "wallclock is not an ALIEN scheduler");
  assert.equal(session.snapshot.world.entities.length, 44);
  const fresh = new CampaignSession(fixture.options);
  const visibilityFrame = alienVisibilityFrame(fresh, 1);
  assert.equal(visibilityFrame.producerSlots.length, 41);
  assert.deepEqual(visibilityFrame.excludedProducerSlots, []);
  const visible = fresh.stepVisibilityForNativeView({ visibilityFrame });
  assert.ok(visible.ok, JSON.stringify(visible));
  assert.equal(visible.value.visibility.groundWords.filter(word => word >>> 31).length, 452);
  const initial = session.snapshot;
  const checkpoints: ReturnType<CampaignSession["checkpoint"]>[] = [fresh.checkpoint()];
  let beforeLaunch: ReturnType<CampaignSession["checkpoint"]> | undefined;
  let afterLaunch: ReturnType<CampaignSession["checkpoint"]> | undefined;
  const fireStates = new Set<string>();
  const step = (packets?: number[][]) => {
    const before = afterLaunch ? undefined : session.checkpoint(), input = nativeCombatInput(session.snapshot, packets);
    const result = session.stepForNativeView(input);
    assert.ok(result.ok, JSON.stringify(result));
    view.advanceNativeCombat(input);
    assert.deepEqual(view.campaignSnapshot, session.snapshot);
    assert.equal(view.simulation.random.state, simulationRandom);
    assert.equal(view.simulation.combatEvents.length, 0);
    assert.equal(view.simulation.checkpoint().commands.length, 0);
    for (const binding of view.nativeBindings) {
      const actor: HostSlot = result.value.transport.slots[binding.slot]!;
      const simulated = [...view.simulation.snapshot.units, ...view.simulation.snapshot.staticTargets]
        .find(unit => unit.id === binding.simulationId)!;
      assert.deepEqual([simulated.health, simulated.xSubcells, simulated.ySubcells],
        [actor.health, actor.position.x * 4, actor.position.y * 4]);
    }
    const combat = transportHostState(session.snapshot.world).nativeCombat!;
    if (combat.journal.at(-1)!.spawns.length && !afterLaunch) {
      beforeLaunch = before!; afterLaunch = session.checkpoint();
    }
    return transportHostState(session.snapshot.world);
  };
  for (let count = 0; count < 16; count++) step();
  const allocated = transportHostState(session.snapshot.world).slots.filter(actor => actor?.key.startsWith("transport:"));
  assert.equal(allocated.length, 2);
  const source = allocated.find(actor => actor!.team === 0)!, target = allocated.find(actor => actor!.team === 1)!;
  assert.deepEqual(allocated.map(actor => [actor!.unitType, actor!.health]), [[8, 800], [8, 800]]);
  assert.equal(session.snapshot.world.entities.length, 46);
  const revealed = session.stepVisibilityForNativeView({ visibilityFrame: alienVisibilityFrame(session, 1, [source.slot]) });
  assert.ok(revealed.ok, JSON.stringify(revealed));
  view.advanceNativeVisibility({ visibilityFrame: alienVisibilityFrame(session, 1, [source.slot]) });
  assert.deepEqual(view.campaignSnapshot, session.snapshot);
  step([nativeCombatPacket(target.slot, fixture.column - 1, fixture.row),
    nativeCombatPacket(source.slot, fixture.column + 2, fixture.row, 7)]);
  let hit = false;
  while (session.snapshot.cycleCounter < 95) {
    const host = step();
    const actor = host.slots[source.slot]!;
    const sample = sourceNativeCombatActorSample(fixture.animation, actor,
      host.nativeAiTasks!.configuration.profiles[actor.nativeAiTask!.profile], "GRAY");
    assert.deepEqual(session.nativeViewActorSample(fixture.animation, actor.slot, actor.generation, "GRAY"), sample);
    assert.match(sample.primary.state, /^GRAY/);
    if (sample.primary.state.startsWith("GRAYFIRE")) fireStates.add(sample.primary.state);
    if (host.nativeCombat!.journal.at(-1)!.impacts.length) { hit = true; break; }
  }
  assert.ok(hit, "actual type8 native receipt must launch and hit");
  const host = transportHostState(session.snapshot.world);
  assert.equal(host.slots[target.slot]!.health, 775);
  assert.equal(host.nativeCombat!.journal.flatMap(entry => entry.spawns).length, 1);
  assert.equal(host.nativeCombat!.journal.flatMap(entry => entry.impacts).length, 1);
  assert.equal(host.nativeCombat!.journal.flatMap(entry => entry.reclaimed).length, 1);
  const spawn = host.nativeCombat!.journal.flatMap(entry => entry.spawns)[0];
  assert.equal(spawn.source, source.slot);
  assert.equal(spawn.weapon, 15);
  const travelBank = Buffer.from(spawn.raw).readUInt32LE(32);
  assert.equal(travelBank, 0x2000f);
  assert.deepEqual(host.nativeCombat!.configuration.tables.fin[travelBank], Array.from({ length: 32 }, () => [2]));
  assert.ok(fireStates.size > 0, "actual firing actor projects a GRAY FIRE bank");
  assert.equal(host.nativeCombat!.configuration.policy, 1);
  assert.deepEqual(session.snapshot.world.source, fixture.initial.source);
  assert.deepEqual(session.snapshot.world.exomoney, initial.world.exomoney);
  for (const actor of host.slots) if (actor && !actor.nativeAiTask) {
    assert.deepEqual(session.snapshot.world.entityBytes!.slice(actor.slot * 220, (actor.slot + 1) * 220),
      initial.world.entityBytes!.slice(actor.slot * 220, (actor.slot + 1) * 220), "unsupported originals stay passive, not removed");
  }
  for (const original of fixture.initial.entities) assert.ok(session.snapshot.world.entities.some(entity => entity.key === original.key));
  assert.ok(beforeLaunch && afterLaunch);
  const hitCheckpoint = session.checkpoint(), hitViewCheckpoint = view.checkpoint();
  checkpoints.push(beforeLaunch, afterLaunch, hitCheckpoint);
  const providers = await fixture.recreateProviders();
  assert.notEqual(providers.nativeCombat.visibility, fixture.options.nativeCombat.visibility);
  assert.deepEqual(providers.nativeCombat, fixture.options.nativeCombat);
  for (const checkpoint of checkpoints) {
    const restored = CampaignSession.restore(checkpoint, undefined, providers.nativeAiTasks, undefined, providers.nativeCombat);
    assert.deepEqual(restored.checkpoint(), checkpoint);
    if (checkpoint.state.cycleCounter > 0 && checkpoint.state.cycleCounter < hitCheckpoint.state.cycleCounter) {
      while (restored.snapshot.cycleCounter < hitCheckpoint.state.cycleCounter) {
        const result = restored.step(nativeCombatInput(restored.snapshot));
        assert.ok(result.ok, JSON.stringify(result));
      }
      assert.deepEqual(restored.checkpoint(), hitCheckpoint, "fresh fifth provider replays exact launch/hit state");
    }
  }
  const restoredView = MissionView.restore(canvas(), stage, callbacks, { ...fixture.mission,
    sourceNativeCombat: { ...fixture.mission.sourceNativeCombat!, options: { ...fixture.options, ...providers } } }, hitViewCheckpoint);
  assert.deepEqual(restoredView.checkpoint(), hitViewCheckpoint);
  const turningCounters: number[] = [], reactionStates = new Set<string>();
  while (session.snapshot.cycleCounter < 146) {
    const current = step(), counter = session.snapshot.cycleCounter;
    const damaged = current.slots[target.slot]!;
    const sample = sourceNativeCombatActorSample(fixture.animation, damaged,
      current.nativeAiTasks!.configuration.profiles[damaged.nativeAiTask!.profile], "GRAY");
    assert.deepEqual(session.nativeViewActorSample(fixture.animation, damaged.slot, damaged.generation, "GRAY"), sample);
    if (sample.secondary) reactionStates.add(sample.secondary.state);
    if (decodeLegacyAiTaskStack(damaged.nativeAiTask!.raw).map(span => span.task).join().startsWith("1,4"))
      turningCounters.push(counter);
    if (counter === 32) assert.equal(damaged.health, 775);
  }
  const continued = transportHostState(session.snapshot.world);
  const launches = continued.nativeCombat!.journal.filter(entry => entry.spawns.length).map(entry => entry.counter);
  const hits = continued.nativeCombat!.journal.filter(entry => entry.impacts.length).map(entry => entry.counter);
  assert.deepEqual(launches, Array.from({ length: 8 }, (_, index) => 25 + index * 17));
  assert.deepEqual(hits, [26, ...launches.slice(1)]);
  assert.equal(continued.slots[target.slot]!.health, 600);
  assert.equal(session.snapshot.world.entities.length, 46);
  assert.ok(reactionStates.size > 1);
  for (const original of fixture.initial.entities) assert.ok(session.snapshot.world.entities.some(entity => entity.key === original.key));
  while (session.snapshot.cycleCounter < 400) step();
  const finalHost = transportHostState(session.snapshot.world);
  const finalLaunches = finalHost.nativeCombat!.journal.filter(entry => entry.spawns.length).map(entry => entry.counter);
  const finalHits = finalHost.nativeCombat!.journal.filter(entry => entry.impacts.length).map(entry => entry.counter);
  assert.deepEqual(finalLaunches, Array.from({ length: 23 }, (_, index) => 25 + index * 17));
  assert.deepEqual(finalHits, [26, ...finalLaunches.slice(1)]);
  assert.equal(finalHost.slots[target.slot]!.health, 225);
  assert.equal(session.snapshot.world.entities.length, 46);
  for (const original of fixture.initial.entities) assert.ok(session.snapshot.world.entities.some(entity => entity.key === original.key));
  const checkpoint400 = session.checkpoint();
  const fresh400 = await fixture.recreateProviders();
  assert.notEqual(fresh400.nativeAiTasks, providers.nativeAiTasks);
  assert.notEqual(fresh400.nativeCombat, providers.nativeCombat);
  const restored400 = CampaignSession.restore(JSON.parse(JSON.stringify(checkpoint400)), undefined,
    fresh400.nativeAiTasks, undefined, fresh400.nativeCombat);
  assert.deepEqual(restored400.checkpoint(), checkpoint400, "all-owned full checkpoint400 restores with fresh providers");
  while (session.snapshot.cycleCounter < 416) {
    const input = nativeCombatInput(session.snapshot);
    const expected = session.step(input), actual = restored400.step(input);
    assert.ok(expected.ok, JSON.stringify(expected));
    assert.deepEqual(actual, expected);
  }
  assert.deepEqual(restored400.checkpoint(), session.checkpoint(), "fresh restore remains exact through the next shot");
  const nextHost = transportHostState(session.snapshot.world);
  assert.equal(nextHost.slots[target.slot]!.health, 200);
  assert.equal(nextHost.nativeCombat!.journal.at(-1)!.spawns.length, 1);
  assert.equal(nextHost.nativeCombat!.journal.at(-1)!.impacts.length, 1);
  const selected = session.step(nativeCombatInput(session.snapshot, undefined, [target.slot, source.slot]));
  assert.ok(!selected.ok);
  assert.match(JSON.stringify(selected.diagnostics), /Checkpoint unknown field/);
  assert.throws(() => CampaignSession.restore(hitCheckpoint, undefined, providers.nativeAiTasks), /combat|source/i);
  for (const mutation of [{ sourceType: 0 }, { weapon: 16 }, { policy: 0 },
    { scope: "source-separated-type0-weapon1-nonlethal" }, { death: {} }]) {
    assert.throws(() => new CampaignSession({ ...fixture.options,
      nativeCombat: { ...fixture.options.nativeCombat, ...mutation } as typeof fixture.options.nativeCombat }), /authenticated/);
    const world = cloneTransportHostWorld(session.snapshot.world), changed = world.transportState as TransportHostState;
    Object.assign(changed.nativeCombat!, { configuration: { ...changed.nativeCombat!.configuration, ...mutation } });
    assert.throws(() => validateNativeAiTaskAlignment(world, changed), /authenticated/);
  }
  context.diagnostic(JSON.stringify({ counter: session.snapshot.cycleCounter, source: source.slot, target: target.slot,
    hp400: finalHost.slots[target.slot]!.health, hp416: nextHost.slots[target.slot]!.health,
    corridor: [fixture.column, fixture.row], travelBank, fireStates: [...fireStates],
    launches: finalLaunches, hits: finalHits, turningCounters, reactionStates: [...reactionStates], restoredThrough: 400,
    launchCounter: afterLaunch.state.cycleCounter, hitCounter: hitCheckpoint.state.cycleCounter }));
});

test("ALIEN FIN projection: source FIREA/B and six reaction banks, never type8 death", async () => {
  const fixture = await createNativeCombatAlienFixture(), session = new CampaignSession(fixture.options);
  const host = transportHostState(session.snapshot.world);
  const actor = structuredClone(host.slots.find(actor => actor?.nativeAiTask && actor.unitType === 8)!);
  const profile = host.nativeAiTasks!.configuration.profiles[actor.nativeAiTask!.profile];
  const original = parseFin(readFileSync(new URL("../../raw_cd/DC/ANIMATE/GRAY.FIN", import.meta.url)));
  const fields = sourceNativeCombatBankFields(8);
  assert.deepEqual(fields.map(field => field.name), ["GRAYSTAND", "GRAYMOVE", "GRAYFIREA", "GRAYFIREB",
    "GRAYBLOODA", "GRAYBLOODB", "GRAYBLOODC", "GRAYBLOODD", "GRAYBLOODE", "GRAYBLOODG"]);
  for (const field of fields) for (let direction = 0; direction < 256; direction += 8) {
    const raw = Buffer.from(actor.nativeAiTask!.raw);
    raw[9] = direction;
    const offset = field.offset >= 0xbc ? 0x1c : 0x14;
    raw.writeUInt32LE(field.id, offset); raw[offset + 4] = 0; raw[offset + 5] = 0; raw[offset + 6] = 1;
    if (offset === 0x14) raw[0x22] = 2;
    actor.nativeAiTask!.raw = [...raw];
    const sample = sourceNativeCombatActorSample(fixture.animation, actor, profile, "GRAY");
    assert.deepEqual(sample, sourceNativeCombatActorSample(original, actor, profile, "GRAY"));
    assert.ok((offset === 0x14 ? sample.primary : sample.secondary)!.state.startsWith(field.name));
  }
  const raw = Buffer.from(actor.nativeAiTask!.raw);
  raw.writeUInt32LE(0x100ac, 0x14);
  actor.nativeAiTask!.raw = [...raw];
  assert.throws(() => sourceNativeCombatActorSample(fixture.animation, actor, profile, "GRAY"), /Unsupported source native combat FIN/);
});
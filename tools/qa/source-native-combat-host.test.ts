import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CampaignSession, initializeCampaignSession, type CampaignSessionInput, type CampaignSessionOptions } from "../../src/engine/campaign-session";
import { createSourceNativeCombatProof, createSourceNativeCombatSoundProof, SOURCE_NATIVE_COMBAT_DEATH_FIELDS } from "../../src/engine/source-native-combat-options";
import { createSourceNativeCombatOptions, createSourceNativeCombatOwner, stepSourceNativeCombatProjectiles,
  guardSourceNativeProjectileGeometry, validateSourceNativeCombatConfiguration } from "../../src/engine/source-native-combat-host";
import type { LegacyAiRegisteredWorld } from "../../src/engine/legacy-ai-task";
import { createSourceNativeTaskOptions, isAuthenticatedSourceNativeTaskConfiguration, sourceNativeTaskValue,
  isImmutableSourceNativeTaskConfiguration, withSourceNativeCombatTasks } from "../../src/engine/source-native-task-options";
import { cloneTransportHostWorld, stepTransportHost, transportHostState, reserveTransportProductionExit, allocateTransportProductionExit } from "../../src/engine/transport-host";
import type { CampaignWorld } from "../../src/engine/campaign-world";
import type { LegacyNativeProjectileFrame } from "../../src/engine/legacy-native-projectiles";
import { parseScenario } from "../extractors/data/scenario";
import { parseUnitStats, parseWeaponStats } from "../extractors/data/tables";
import { parseMapBundle } from "../extractors/maps/map";
import { parseTriggerScript } from "../extractors/data/triggers";
import { prepareNativeDeathSoundEffects } from "../../src/mission-view";
import type { SkirmishCallbacks } from "../../src/simulation-view";

async function fixture(death = false, audio = false) {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url));
  const raw = (path: string) => read(`raw_cd/DC/${path}`);
  const animationRegistry = raw("ANIM.DAT");
  const assets = { executable: raw("DC.EXE"), gameStat: raw("GAMESTAT/GAMESTAT.TXT"), weaponStat: raw("GAMESTAT/WEAPSTAT.TXT"),
    boomStat: raw("GAMESTAT/BOOMSTAT.TXT"), damageMatrix: raw("GAMESTAT/MBULLET.TXT"), scenario: raw("SCENARIO/HUMAN/HUMAN02.SCN"),
    troopFin: raw("ANIMATE/TRSC.FIN"), troopSprite: raw("SPRITES/TRSC.SPR"), animationRegistry,
    registryFins: Object.fromEntries(animationRegistry.toString().trim().split(/\s+/).map(name => [name.toUpperCase(), raw(`ANIMATE/${name.toUpperCase()}`)])),
    map: raw("SCENARIO/HUMAN/HUMAN02.MAP"), mtg: raw("SCENARIO/HUMAN/HUMAN02.MTG"), pth: raw("SCENARIO/HUMAN/HUMAN02.PTH"),
    animations: Object.fromEntries(["TRSC", "GRAY", "REAP", "BARR"].map(stem => [stem, read(`public/assets/generated/animations/${stem}.json`)])) };
  const map = parseMapBundle(assets.map, assets.mtg, assets.pth);
  const options: CampaignSessionOptions = { sessionId: "source-separated-combat-caller", source: parseScenario(assets.scenario.toString()),
    units: parseUnitStats(assets.gameStat.toString()), weapons: parseWeaponStats(assets.weaponStat.toString()), triggers: [], messages: [],
    map, pathGrid: map.pathGrid, tags: map.tagGrid, commanders: [{ team: 0, unitType: 69, sprite: "TRSC" }],
    directionBits: [], fixedStepMilliseconds: 16, orientationSteps: 1,
    resourceScales: "configured-startup" };
  const initial = initializeCampaignSession(options);
  assert.ok(initial.ok, JSON.stringify(initial));
  const configuration = await createSourceNativeTaskOptions({ assets, world: initial.value.world });
  const proof = await createSourceNativeCombatProof(assets);
  const host = transportHostState(initial.value.world), profile = configuration.profiles[0];
  const cell = host.ground.findIndex((slot, cell) => {
    const column = cell % host.width, row = Math.floor(cell / host.width);
    if (slot !== -1 || column < 12 || column > host.width - 12 || row < 12 || row > host.height - 12) return false;
    for (let offsetY = -8; offsetY <= 8; offsetY++) for (let offsetX = -8; offsetX <= 8; offsetX++) {
      const index = cell + offsetY * host.width + offsetX;
      if ((profile.ground[index] & 1023) !== 1023 || (profile.air[index] & 1023) !== 1023) return false;
    }
    return [-2, -1, 0, 1, 2, 3].every(offset => host.groundEligible[cell + offset] && profile.families[cell] !== 0
      && profile.families[cell + offset] === profile.families[cell] && profile.air[cell + offset] >>> 10 === 0);
  });
  assert.ok(cell >= 0, "real clear source PTH corridor required");
  const column = cell % host.width, row = Math.floor(cell / host.width);
  const triggers = parseTriggerScript(`1 norm 1 (c>0)
reinforce2 0 ${column} ${row} 0 1 0 0 0 0 0 0 0 0
reinforce2 5 ${column - 2} ${row} 0 1 0 0 0 0 0 0 0 0
end
${death ? `3 norm 1 (c>48)
reinforce2 5 ${column - 2} ${row} 0 1 0 0 0 0 0 0 0 0
end` : `2 norm 1 (c>5)
reinforce2 0 ${column + 3} ${row} 92 1 0 0 0 0 0 0 0 0
end`}
`);
  const bounded = initializeCampaignSession({ ...options, triggers });
  assert.ok(bounded.ok, JSON.stringify(bounded));
  const boundConfiguration = await createSourceNativeTaskOptions({ assets, world: bounded.value.world });
  const sound = audio ? await createSourceNativeCombatSoundProof({ executable: assets.executable,
    soundTable: raw("SOUND/SOUND2.DAT"), bindings: raw("SOUND/SLIST.DAT") }, {
    policy: "explicit-caller-boundary", state: { descriptor: [4, 0, 0, 28, 90, 153, 154, 0, 0, 0, 0, 0, 0], randomSeed: 1 },
    initialized: true, disabled: false, listener: { x: column * 256 + 128, y: row * 256 + 128 },
  }) : undefined;
  const combat = await createSourceNativeCombatOptions({ configuration: boundConfiguration, proof, death, sound });
  return { options: { ...options, ...combat, triggers }, column, row, initial: bounded.value.world, configuration: boundConfiguration, proof, assets };
}

for (const death of [true, false]) test(`native combat rejects external unit updates for every original actor (${death ? "lethal" : "nonlethal"})`, async () => {
  const { options } = await fixture(death), session = new CampaignSession(options);
  const before = session.checkpoint(), journal = session.journal;
  const host = before.state.world.transportState as ReturnType<typeof transportHostState>;
  const colony = before.state.world.entities.find(entity => entity.rawSlot === 5)!;
  assert.equal(colony.generation, 0);
  assert.equal(host.slots[5]!.nativeAiTask, undefined);
  assert.ok(host.slots.some(actor => actor?.nativeAiTask));
  const guard = /Native combat owned updates require explicit phase ownership transfer/;
  const frame: CampaignSessionInput = { clockMilliseconds: 16,
    nativeAiFrame: { counter: 1, task6Budget: 0, ...(death ? { registeredSlots: [] } : {}) } };
  const updatesFor = (slot: number, generation: number): NonNullable<CampaignSessionInput["updates"]> => [
    { type: "combat-death", slot, generation },
    { type: "complete-removal", slot, generation },
    { type: "position", slot, generation, position: { x: 256, y: 256 } },
  ];
  for (const entity of [colony, ...before.state.world.entities.filter(entity => entity !== colony)]) {
    for (const update of updatesFor(entity.rawSlot!, entity.generation!)) {
      const result = session.step({ ...frame, updates: [update] });
      assert.equal(result.ok, false, `${update.type} ${update.slot}:${update.generation}`);
      assert.match(JSON.stringify(result), guard);
      const after = session.checkpoint();
      assert.deepEqual(after.state.world.entityBytes, before.state.world.entityBytes, "all raw actor bytes unchanged");
      assert.deepEqual((after.state.world.transportState as typeof host).nativeCombat, host.nativeCombat,
        "source counters, pending death, registry, projectiles and native journal unchanged");
      assert.deepEqual(after.state.controller, before.state.controller, "no victim loss consumed");
      assert.deepEqual(after, before, "entire checkpoint and caller history unchanged");
      assert.deepEqual(session.journal, journal);
    }
  }
  const accepted = session.step({ ...frame, updates: [] });
  assert.ok(accepted.ok, JSON.stringify(accepted));
  const committed = session.checkpoint(), committedJournal = session.journal;
  const fresh = await fixture(death);
  assert.deepEqual(CampaignSession.restore(committed, undefined, fresh.options.nativeAiTasks, undefined,
    fresh.options.nativeCombat).checkpoint(), committed);
  for (const update of updatesFor(5, 0)) {
    const changed = structuredClone(committed);
    Object.assign(changed.state.nativeAiInputs![0], { updates: [update] });
    assert.throws(() => CampaignSession.restore(changed, undefined, fresh.options.nativeAiTasks, undefined,
      fresh.options.nativeCombat), guard);
    assert.deepEqual(session.checkpoint(), committed);
    assert.deepEqual(session.journal, committedJournal);
  }
});

test("visible sound explicit caller state commits every frame, forks privately and replays with fresh providers", async () => {
  const { options, configuration, proof } = await fixture(true, true), session = new CampaignSession(options);
  await assert.rejects(createSourceNativeCombatOptions({ configuration, proof, sound: options.nativeCombat.sound }), /explicit lethal ownership/);
  await assert.rejects(createSourceNativeCombatOptions({ configuration, proof, death: true,
    sound: structuredClone(options.nativeCombat.sound!) }), /authenticated source audio/);
  const sound = { initialized: true, disabled: false, listener: { x: -2147483648, y: 2147483647 } };
  const frame: CampaignSessionInput = { clockMilliseconds: 16, nativeAiFrame: { counter: 1, task6Budget: 0, registeredSlots: [], sound } };
  const before = session.checkpoint();
  assert.equal(session.step({ ...frame, nativeAiFrame: { counter: 1, task6Budget: 0, registeredSlots: [] } }).ok, false);
  assert.deepEqual(session.checkpoint(), before);
  const directBefore = session.snapshot.world;
  const invalidDirect = stepTransportHost(directBefore, undefined, { ...frame.nativeAiFrame!, sound: { ...sound, initialized: false } });
  assert.equal(invalidDirect.ok, false);
  assert.deepEqual(directBefore, session.snapshot.world);
  const late = session.step({ ...frame, reservations: [{ slot: 799, generation: 0, tileX: 0, tileY: 0 }] });
  assert.equal(late.ok, false); assert.match(JSON.stringify(late), /Invalid reservation unit/);
  assert.deepEqual(session.checkpoint(), before);
  const result = session.step(frame); assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.value.entry.requests, []);
  const checkpoint = session.checkpoint(), host = checkpoint.state.world.transportState as ReturnType<typeof transportHostState>;
  const audio = host.nativeCombat!;
  assert.deepEqual(audio.soundState, options.nativeCombat.sound!.initial);
  assert.deepEqual(audio.journal[0].sound, { input: sound, before: audio.soundState, after: audio.soundState });
  assert.deepEqual(audio.journal[0].soundRequests, []);
  sound.listener.x = 0;
  assert.deepEqual(session.checkpoint(), checkpoint);
  const currentHost = (value: CampaignSession) => (Reflect.get(value, "current") as CampaignSession["snapshot"]).world.transportState as typeof host;
  const fork = session.fork(), parentAudio = currentHost(session).nativeCombat!, forkAudio = currentHost(fork).nativeCombat!;
  assert.equal(forkAudio.configuration, parentAudio.configuration);
  assert.notEqual(forkAudio.soundState, parentAudio.soundState);
  assert.notEqual(forkAudio.soundState!.descriptor, parentAudio.soundState!.descriptor);
  assert.notEqual(forkAudio.journal[0].sound, parentAudio.journal[0].sound);
  assert.notEqual(forkAudio.journal[0].soundRequests, parentAudio.journal[0].soundRequests);
  const clonedWorld = cloneTransportHostWorld(session.snapshot.world), clonedAudio = (clonedWorld.transportState as typeof host).nativeCombat!;
  (clonedAudio.soundState!.descriptor as number[])[1] = 3;
  assert.deepEqual(session.checkpoint(), checkpoint);
  const fresh = await fixture(true, true);
  const restored = CampaignSession.restore(checkpoint, undefined, fresh.options.nativeAiTasks, undefined, fresh.options.nativeCombat);
  assert.deepEqual(restored.checkpoint(), checkpoint);
  const next = { clockMilliseconds: 32, nativeAiFrame: { counter: 2, task6Budget: 0, registeredSlots: [], sound } };
  const continued = restored.step(next); assert.ok(continued.ok, JSON.stringify(continued));
  assert.deepEqual(continued.value.entry.requests, []);
  for (const field of ["state", "descriptor", "journal", "input"] as const) {
    const changed = structuredClone(checkpoint), changedAudio = (changed.state.world.transportState as typeof host).nativeCombat!;
    if (field === "state") Object.assign(changedAudio.soundState!, { randomSeed: 2 });
    if (field === "descriptor") (changedAudio.soundState!.descriptor as number[])[1] = 2;
    if (field === "journal") changedAudio.journal[0].soundRequests = [{ id: 28 } as never];
    if (field === "input") Object.assign(changed.state.nativeAiInputs![0].nativeAiFrame!.sound!, { disabled: true });
    assert.throws(() => CampaignSession.restore(changed, undefined, fresh.options.nativeAiTasks, undefined,
      fresh.options.nativeCombat), /caller replay/);
  }
});

test("visible sound controlled original projectile boundary uses authenticated host tables, not natural mission visibility", async context => {
  const native = JSON.parse(readFileSync(process.env.DC_NATIVE_DEATH_SOUND_TRACE ?? "/tmp/dc-death-sound-platform-20260919-a19.json", "utf8")) as {
    before: { actors: string; game: string; ground: string; air: string; extra: string; typeStatistics: string;
      statistics: number[]; rngCursor: number; soundSeed: number; soundDescriptor: number[] };
    after: { actors: string; soundSeed: number; soundDescriptor: number[]; rngCursor: number };
    world: LegacyAiRegisteredWorld; counter: number; target: number; listener: { x: number; y: number };
    visibility: { label: string }; calls: { id: number; volume: number; pan: number }[];
  };
  assert.match(native.visibility.label, /controlled bit31.*NOT normal mission/);
  const { options } = await fixture(true, true), owner = createSourceNativeCombatOwner(options.nativeCombat);
  assert.deepEqual(owner.soundState, { descriptor: native.before.soundDescriptor, randomSeed: native.before.soundSeed });
  const decode = (value: string) => Buffer.from(value, "base64");
  const words = (buffer: Buffer, width: 2 | 4, signed = false) => Array.from({ length: buffer.length / width }, (_, index) =>
    width === 4 ? signed ? buffer.readInt32LE(index * width) : buffer.readUInt32LE(index * width)
      : signed ? buffer.readInt16LE(index * width) : buffer.readUInt16LE(index * width));
  const game = decode(native.before.game), nativeTypes = Buffer.from(native.world.combat!.typeTable);
  const actualTypes = Buffer.from(options.nativeCombat.tables.typeTable);
  const banks = [0x7c, 0x80, 0xa0, 0xa4, 0xac, 0xb0, 0xb4, 0xbc, 0xc0, 0xc4, 0xc8, 0xcc, 0xd0, 0xd4];
  const relocate = (value: string) => {
    const bytes = decode(value);
    for (let slot = 0; slot < 800; slot++) if (bytes[slot * 220 + 0x2c] && bytes[slot * 220 + 6] === 0) {
      for (const offset of [0x14, 0x1c, 0x24]) {
        const address = bytes.readUInt32LE(slot * 220 + offset), field = banks.find(field => nativeTypes.readUInt32LE(field) === address);
        if (field !== undefined) bytes.writeUInt32LE(actualTypes.readUInt32LE(field), slot * 220 + offset);
      }
    }
    return bytes;
  };
  owner.projectiles = { records: [...game.subarray(0x32ca8, 0x32ca8 + 2024 * 40)], highWater: game.readInt32LE(0x7d24),
    heads: [game.readInt16LE(0x468e8), game.readInt16LE(0x468ea)], statistics: native.before.statistics };
  owner.death = { registry: words(game.subarray(0x468ec, 0x468ec + 1600), 2, true),
    typeStatistics: words(decode(native.before.typeStatistics), 4, true), pending: [],
    commanderSlots: Array.from({ length: 8 }, (_, team) => game.readInt16LE(team * 0xe30 + 0x1934)) };
  const profile = { ...native.world, air: words(decode(native.before.air), 2), extra: words(decode(native.before.extra), 2) };
  const ground = words(decode(native.before.ground), 4), actors = relocate(native.before.actors), saved = structuredClone(owner);
  const result = stepSourceNativeCombatProjectiles(owner, actors, profile, ground, native.before.rngCursor, native.counter,
    { initialized: true, disabled: false, listener: native.listener });
  assert.deepEqual(owner, saved);
  assert.deepEqual(result.actors, [...relocate(native.after.actors)]);
  assert.equal(result.rngCursor, native.after.rngCursor);
  assert.deepEqual(result.death!.soundState, { descriptor: native.after.soundDescriptor, randomSeed: native.after.soundSeed });
  assert.deepEqual(result.soundRequests.map(({ id, volume, pan }) => ({ id, volume, pan })),
    native.calls.map(({ id, volume, pan }) => ({ id, volume: volume | 0, pan: pan | 0 })));
  assert.equal(result.soundRequests[0].slot, native.target);
  const muted = stepSourceNativeCombatProjectiles(owner, actors, profile, ground, native.before.rngCursor, native.counter,
    { initialized: true, disabled: true, listener: native.listener });
  assert.deepEqual(muted.soundRequests, []); assert.deepEqual(muted.death!.soundState, owner.soundState);
  assert.equal(muted.rngCursor, result.rngCursor);
  const withoutAudio = await fixture(true);
  const unowned = { ...owner, configuration: withoutAudio.options.nativeCombat, soundState: undefined };
  assert.throws(() => stepSourceNativeCombatProjectiles(unowned, actors, profile, ground, native.before.rngCursor, native.counter), /visible-sound-owner-required/);
  const forged = { ...owner, configuration: structuredClone(owner.configuration) };
  (forged.configuration.sound!.configuration.sounds[0].parameters as number[])[0] = 3;
  assert.throws(() => stepSourceNativeCombatProjectiles(forged, actors, profile, ground, native.before.rngCursor, native.counter,
    { initialized: true, disabled: false, listener: native.listener }), /authenticated/);
  context.diagnostic(JSON.stringify({ boundary: "controlled original projectile; not natural mission", requests: result.soundRequests,
    audioBefore: owner.soundState, audioAfter: result.death!.soundState, combatBefore: native.before.rngCursor, combatAfter: result.rngCursor }));
});

test("visible sound transport publication at controlled fresh-session kill is atomic; natural moves do not set bit31", async context => {
  const { options, column, row } = await fixture(true, true), session = new CampaignSession(options);
  const current = () => Reflect.get(session, "current") as CampaignSession["snapshot"];
  const host = () => current().world.transportState as ReturnType<typeof transportHostState>;
  const sound = { initialized: true, disabled: false, listener: { x: column * 256 + 128, y: row * 256 + 128 } };
  let registeredSlots: number[] = [];
  const next = (packets?: number[][]): CampaignSessionInput => {
    const counter = current().cycleCounter + 1;
    return { clockMilliseconds: counter * 16, nativeAiFrame: { counter, task6Budget: 0, registeredSlots: [...registeredSlots], sound },
      ...(packets ? { nativeAiReceipt: { id: `audio-order:${counter}`, packets,
        expected: host().slots.flatMap(actor => actor?.nativeAiTask ? [{ slot: actor.slot,
          generation: actor.generation, key: actor.key, raw: actor.nativeAiTask.raw }] : []) } } : {}) };
  };
  for (let counter = 1; counter <= 16; counter++) assert.ok(session.step(next()).ok);
  const added = host().slots.filter(actor => actor?.key.startsWith("transport:"));
  const source = added.find(actor => actor!.team === 0)!, target = added.find(actor => actor!.team === 5)!;
  registeredSlots = [source.slot, target.slot].sort((left, right) => left - right);
  assert.ok(session.step(next([packet(source.slot, column + 2, row, 7)])).ok);
  for (let count = 0; count < 40; count++) assert.ok(session.step(next()).ok);
  assert.ok(session.step(next([packet(target.slot, column, row)])).ok);
  while (current().cycleCounter < 613) {
    const result = session.step(next()); assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value.entry.requests.some(request => request.type === "native-death-sound"), false);
  }
  const original = session.snapshot.world, beforeHost = original.transportState as ReturnType<typeof transportHostState>;
  const victim = beforeHost.slots[target.slot]!, cell = (victim.position.y >>> 8) * beforeHost.width + (victim.position.x >>> 8);
  const actualWord = beforeHost.nativeAiTasks!.ground[cell];
  assert.equal(actualWord & 0x80000000, 0, "natural source move history does not prove renderer visibility");
  assert.notEqual(actualWord & (0x40000000 >>> target.team), 0, "original move sets the real team history bit");
  assert.equal(victim.health, 25, "no health injection: 31 actual nonlethal source hits");
  assert.equal(beforeHost.nativeCombat!.journal.flatMap(entry => entry.impacts).length, 31);
  const controlled = session.fork();
  const controlledState = Reflect.get(controlled, "current") as CampaignSession["snapshot"];
  const controlledHost = controlledState.world.transportState as typeof beforeHost;
  controlledHost.nativeAiTasks!.ground[cell] = (actualWord | 0x80000000) >>> 0;
  const controlledBefore = controlled.checkpoint(), controlledJournal = controlled.journal;
  const failed = controlled.step({ ...next(), reservations: [{ slot: 799, generation: 0, tileX: 0, tileY: 0 }] });
  assert.equal(failed.ok, false); assert.match(JSON.stringify(failed), /Invalid reservation unit/);
  assert.deepEqual(controlled.checkpoint(), controlledBefore); assert.deepEqual(controlled.journal, controlledJournal);
  const directInput = cloneTransportHostWorld(controlledState.world), directBefore = structuredClone(directInput);
  const direct = stepTransportHost(directInput, undefined, next().nativeAiFrame);
  assert.ok(direct.ok, JSON.stringify(direct)); assert.deepEqual(directInput, directBefore);
  const published = controlled.step(next()); assert.ok(published.ok, JSON.stringify(published));
  const requests = published.value.entry.requests.filter(request => request.type === "native-death-sound");
  assert.equal(requests.length, 1);
  const soundRequest = requests[0];
  assert.equal(soundRequest.counter, 614); assert.equal(soundRequest.slot, target.slot);
  assert.equal(soundRequest.generation, target.generation); assert.equal(soundRequest.id, 28);
  assert.equal(soundRequest.x, victim.position.x); assert.equal(soundRequest.y, victim.position.y);
  const committed = controlled.checkpoint();
  const received: Parameters<NonNullable<SkirmishCallbacks["onNativeDeathSound"]>>[0][] = [];
  prepareNativeDeathSoundEffects([], undefined)();
  prepareNativeDeathSoundEffects([], request => received.push(request))();
  assert.equal(received.length, 0);
  assert.throws(() => prepareNativeDeathSoundEffects(published.value.entry.requests, undefined), /explicit postcommit consumer/);
  const dispatch = prepareNativeDeathSoundEffects(published.value.entry.requests, request => {
    assert.deepEqual(controlled.checkpoint(), committed, "consumer observes committed native state");
    received.push(structuredClone(request));
    assert.notEqual(request, soundRequest);
    assert.notEqual(request.source, soundRequest.source);
    Reflect.set(request.source, "source", "consumer-local");
    dispatch();
  });
  assert.equal(received.length, 0, "preparing effects is not presentation");
  dispatch(); dispatch();
  assert.deepEqual(received, requests, "deliver the complete actual host request exactly once, including source metadata");
  const presentationFailure = new Error("QA consumer failure");
  let attempts = 0;
  const throwing = prepareNativeDeathSoundEffects(published.value.entry.requests, () => { attempts++; throw presentationFailure; });
  assert.throws(throwing, (error: unknown) => error instanceof AggregateError &&
    /presentation failed after commit/.test(error.message) && error.errors[0] === presentationFailure);
  throwing();
  assert.equal(attempts, 1);
  assert.deepEqual(controlled.checkpoint(), committed, "consumer mutation/failure cannot alter host state or statistics");
  const directHost = direct.value.transportState as typeof beforeHost;
  assert.deepEqual(directHost.requests.filter(request => request.type === "native-death-sound"), requests);
  const controlledAudio = (published.value.world.transportState as typeof beforeHost).nativeCombat!;
  assert.equal(controlledAudio.soundState!.randomSeed, 1103527590);
  assert.equal(controlledAudio.soundState!.descriptor[1], 2);
  assert.deepEqual(controlledAudio.journal.at(-1)!.soundRequests, requests.map(({ type: _type, generation: _generation, counter: _counter, ...request }) => request));
  const natural = session.step(next()); assert.ok(natural.ok, JSON.stringify(natural));
  assert.equal(host().slots[target.slot]!.health, 0);
  assert.deepEqual(host().nativeCombat!.soundState, options.nativeCombat.sound!.initial);
  assert.equal(host().nativeAiTasks!.rngCursor, (published.value.world.transportState as typeof beforeHost).nativeAiTasks!.rngCursor);
  assert.equal(natural.value.entry.requests.some(request => request.type === "native-death-sound"), false);
  const continuation = controlled.step({ clockMilliseconds: 615 * 16,
    nativeAiFrame: { counter: 615, task6Budget: 0, registeredSlots: [target.slot], sound } });
  assert.ok(continuation.ok, JSON.stringify(continuation));
  assert.equal(continuation.value.entry.requests.some(request => request.type === "native-death-sound"), false);
  const nextAudio = (continuation.value.world.transportState as typeof beforeHost).nativeCombat!;
  assert.deepEqual(nextAudio.soundState, controlledAudio.soundState);
  assert.equal(nextAudio.death!.pending[0].visits, 1);
  const fresh = await fixture(true, true), checkpoint = session.checkpoint();
  assert.deepEqual(CampaignSession.restore(checkpoint, undefined, fresh.options.nativeAiTasks, undefined,
    fresh.options.nativeCombat).checkpoint(), checkpoint);
  assert.throws(() => CampaignSession.restore(controlled.checkpoint(), undefined, fresh.options.nativeAiTasks, undefined,
    fresh.options.nativeCombat), /caller replay/, "manual visible injection is not an authenticated natural session");
  context.diagnostic(JSON.stringify({ classification: "fresh source kill; controlled bit31 only for positive audio branch",
    counter: 614, naturalWord: actualWord, naturalRequests: 0, controlledRequests: requests,
    crtBefore: options.nativeCombat.sound!.initial, crtAfter: controlledAudio.soundState,
    combatBefore: beforeHost.nativeAiTasks!.rngCursor, combatAfter: host().nativeAiTasks!.rngCursor,
    naturalReplay: true, injectedVisibilityReplayRejected: true }));
});

test("bounded lethal provider reconstructs fresh full source death state", async () => {
  const { options, proof } = await fixture(true);
  const evidence = JSON.parse(readFileSync(process.env.DC_NATIVE_COMBAT_FRESH_TRACE ?? "/tmp/dc-lethal-host-fresh-poison-20260919-A19.json", "utf8"));
  assert.equal(evidence.binarySha256, proof.hashes.executable);
  assert.equal(evidence.sourceProof.scenarioSha256, proof.hashes.scenario);
  assert.deepEqual(evidence.initializers, [{ entry: "0x419d60", poisonedClearBytes: [384, 0x3700] }]);
  assert.deepEqual(options.nativeCombat.death!.initial, { registry: evidence.initial.registry,
    typeStatistics: evidence.initial.typeStatistics, commanderSlots: evidence.initial.commanderSlots, pending: [] });
  assert.deepEqual(options.nativeCombat.death!.statistics, evidence.initial.statistics);
  const session = new CampaignSession(options);
  const host = transportHostState(session.snapshot.world);
  assert.deepEqual(host.nativeCombat!.death, options.nativeCombat.death!.initial);
  assert.deepEqual(host.nativeCombat!.projectiles.statistics, evidence.initial.statistics);
  const native = JSON.parse(readFileSync("/tmp/dc-death-complete-20260919-222344.json", "utf8"));
  const sourceType = Buffer.from(native.targetWorld.typeBytes), actualType = Buffer.from(options.nativeCombat.tables.typeTable);
  for (const field of SOURCE_NATIVE_COMBAT_DEATH_FIELDS) {
    assert.equal(actualType.readUInt32LE(field.offset), field.id);
    assert.deepEqual(options.nativeCombat.tables.fin[field.id], native.targetWorld.fin[sourceType.readUInt32LE(field.offset)]);
  }
  for (const offset of [0xe8, 0x100]) assert.equal(actualType.readInt32LE(offset), sourceType.readInt32LE(offset));
  assert.equal(actualType[0x60], sourceType[0x60]);
  for (const change of [
    (config: typeof options.nativeCombat) => { (config.death!.initial.registry as number[])[152] = -1; },
    (config: typeof options.nativeCombat) => { (config.death!.initial.typeStatistics as number[])[0] = 1; },
    (config: typeof options.nativeCombat) => { (config.death!.initial.commanderSlots as number[])[0] = 0; },
    (config: typeof options.nativeCombat) => { (config.death!.statistics as number[])[12] = 0; },
  ]) {
    const changed = structuredClone(options.nativeCombat); change(changed);
    assert.throws(() => validateSourceNativeCombatConfiguration(changed), /authenticated/);
  }
  const checkpoint = session.checkpoint();
  for (const slots of [[0], [800], [152, 152], [153, 152], [799]]) {
    const result = session.step({ ...input(session), nativeAiFrame: { counter: 1, task6Budget: 0, registeredSlots: slots } });
    assert.equal(result.ok, false); assert.match(JSON.stringify(result), /registered source slot list|Checkpoint integer/);
    assert.deepEqual(session.checkpoint(), checkpoint);
  }
  const exotic = Object.assign(Object.create({ toJSON: () => options.nativeCombat }), structuredClone(options.nativeCombat));
  assert.throws(() => validateSourceNativeCombatConfiguration(exotic), /plain records/);
  const shared = structuredClone(options.nativeCombat);
  Object.assign(shared, { unknown: new Uint8Array(new SharedArrayBuffer(8)) });
  assert.throws(() => validateSourceNativeCombatConfiguration(shared), /plain records/);
});

test("bounded lethal session completes real repeated hits and 150 registered death visits", async context => {
  const { options, column, row } = await fixture(true), session = new CampaignSession(options);
  const fresh = await fixture(true);
  const state = () => Reflect.get(session, "current") as CampaignSession["snapshot"];
  const hostState = () => state().world.transportState as ReturnType<typeof transportHostState>;
  let registeredSlots: number[] = [];
  const next = (packets?: number[][]): CampaignSessionInput => {
    const counter = state().cycleCounter + 1;
    return { clockMilliseconds: counter * 16, nativeAiFrame: { counter, task6Budget: 0, registeredSlots: [...registeredSlots] },
      ...(packets ? { nativeAiReceipt: { id: `combat-order:${counter}`, packets,
        expected: hostState().slots.flatMap(actor => actor?.nativeAiTask ? [{ slot: actor.slot,
          generation: actor.generation, key: actor.key, raw: actor.nativeAiTask.raw }] : []) } } : {}) };
  };
  for (let counter = 1; counter <= 16; counter++) {
    const result = session.step(next()); assert.ok(result.ok, JSON.stringify(result));
  }
  const added = transportHostState(session.snapshot.world).slots.filter(actor => actor?.key.startsWith("transport:"));
  const source = added.find(actor => actor!.team === 0)!, target = added.find(actor => actor!.team === 5)!;
  registeredSlots = [source.slot, target.slot].sort((left, right) => left - right);
  assert.ok(session.step(next([packet(source.slot, column + 2, row, 7)])).ok);
  for (let count = 0; count < 40; count++) assert.ok(session.step(next()).ok);
  assert.ok(session.step(next([packet(target.slot, column, row)])).ok);
  let lethalCounter = 0;
  let beforeLethal: ReturnType<CampaignSession["checkpoint"]> | undefined;
  let dying: ReturnType<CampaignSession["checkpoint"]> | undefined;
  const rollback = () => {
    const before = session.checkpoint(), journal = session.journal;
    const result = session.step({ ...next(), reservations: [{ slot: 799, generation: 0, tileX: 0, tileY: 0 }] });
    assert.equal(result.ok, false); assert.match(JSON.stringify(result), /Invalid reservation unit/);
    assert.deepEqual(session.checkpoint(), before); assert.deepEqual(session.journal, journal);
  };
  for (let counter = 59; counter <= 1000; counter++) {
    if (counter === 614) { beforeLethal = session.checkpoint(); rollback(); }
    if (counter === 615) rollback();
    const result = session.step(next());
    assert.ok(result.ok, `counter ${counter}: ${JSON.stringify(result)}`);
    const host = hostState(), victim = host.slots[target.slot]!;
    if (victim.status === 10 && !lethalCounter) {
      lethalCounter = counter;
      assert.ok(victim.health <= 0);
      assert.equal(host.registry[target.slot], target.key);
      assert.equal(host.ground.includes(target.slot), false);
      assert.equal(host.nativeCombat!.death!.pending[0].visits, 0);
      assert.equal(session.snapshot.world.statistics["5,3"], 1);
      registeredSlots = [target.slot];
    }
    if (counter === 615) {
      dying = session.checkpoint();
      assert.equal(host.nativeCombat!.death!.pending[0].visits, 1);
      assert.equal(victim.nativeAiTask!.raw[0x1a], 1);
    }
    if (victim.status === 0) {
      assert.equal(counter, lethalCounter + 150);
      assert.equal(host.registry[target.slot], null);
      assert.equal(session.snapshot.world.entities.some(entity => entity.rawSlot === target.slot), false);
      assert.deepEqual(host.nativeCombat!.death!.pending, []);
      assert.equal(host.nativeCombat!.journal.flatMap(entry => entry.impacts).length, 32);
      context.diagnostic(JSON.stringify({ lethalCounter, removalCounter: counter, health: victim.health }));
      const removed = session.checkpoint();
      for (const checkpoint of [beforeLethal!, dying!, removed]) {
        assert.throws(() => CampaignSession.restore(checkpoint, undefined, fresh.options.nativeAiTasks), /externally authenticated provider/);
        const restored = CampaignSession.restore(checkpoint, undefined, fresh.options.nativeAiTasks, undefined, fresh.options.nativeCombat);
        assert.deepEqual(restored.checkpoint(), checkpoint);
      }
      const changed = structuredClone(dying!);
      const changedCombat = (changed.state.world.transportState as typeof host).nativeCombat!;
      changedCombat.death = { ...changedCombat.death!, pending: [{ ...changedCombat.death!.pending[0], visits: 2 }] };
      assert.throws(() => CampaignSession.restore(changed, undefined, fresh.options.nativeAiTasks, undefined,
        fresh.options.nativeCombat), /caller replay/);
      registeredSlots = [];
      const invalidBefore = session.checkpoint();
      const invalid = session.step({ ...next(), nativeAiFrame: { ...next().nativeAiFrame!, registeredSlots: [target.slot] } });
      assert.equal(invalid.ok, false); assert.match(JSON.stringify(invalid), /registered source slot list/);
      assert.deepEqual(session.checkpoint(), invalidBefore);
      while (state().cycleCounter < 784) assert.ok(session.step(next()).ok);
      const reused = hostState().slots[target.slot]!;
      assert.equal(reused.slot, target.slot); assert.equal(reused.generation, target.generation + 1);
      assert.notEqual(reused.key, target.key); assert.equal(reused.health, 800);
      assert.equal(hostState().nativeCombat!.death!.registry[target.slot], target.slot);
      assert.deepEqual(hostState().nativeCombat!.death!.pending, []);
      const rebound = hostState().nativeAiTasks!.configuration.bindings.find(binding => binding.slot === target.slot)!;
      assert.equal(rebound.key, reused.key); assert.equal(rebound.generation, reused.generation);
      assert.equal(state().world.statistics["5,3"], 1);
      const reusedCheckpoint = session.checkpoint();
      assert.deepEqual(CampaignSession.restore(reusedCheckpoint, undefined, fresh.options.nativeAiTasks, undefined,
        fresh.options.nativeCombat).checkpoint(), reusedCheckpoint);
      return;
    }
  }
  assert.fail("real registered death must remove the victim");
});

function packet(slot: number, column: number, row: number, order = 2): number[] {
  const payload = Buffer.alloc(15);
  payload[0] = 5; payload.writeInt16LE(slot, 1); payload[3] = order;
  payload[4] = 7; payload[5] = 1; payload.writeInt16LE(1, 6); payload.writeUInt16LE(column * 256 + 128, 8);
  payload.writeUInt16LE(row * 256 + 128, 10); payload.writeInt16LE(slot, 12);
  const framed = Buffer.alloc(17); framed.writeUInt16LE(17); framed.set(payload, 2);
  return [...framed];
}

function input(session: CampaignSession, packets?: number[][]): CampaignSessionInput {
  const snapshot = session.snapshot, counter = snapshot.cycleCounter + 1;
  const host = transportHostState(snapshot.world);
  return { clockMilliseconds: counter * 16, nativeAiFrame: { counter, task6Budget: 0 },
    ...(packets ? { nativeAiReceipt: { id: `combat-order:${counter}`, packets,
      expected: host.slots.flatMap(actor => actor?.nativeAiTask ? [{ slot: actor.slot, generation: actor.generation,
        key: actor.key, raw: actor.nativeAiTask.raw }] : []) } } : {}) };
}

test("combat provider snapshots async arguments and excludes unproved schedulers", async () => {
  const { options, configuration, proof, assets, initial } = await fixture();
  const shared = (bytes: Uint8Array) => {
    const copy = new Uint8Array(new SharedArrayBuffer(bytes.length)); copy.set(bytes); return copy;
  };
  const taskAssets = { ...assets, executable: shared(assets.executable), scenario: shared(assets.scenario),
    animations: Object.fromEntries(Object.entries(assets.animations).map(([name, bytes]) => [name, shared(bytes)])) };
  const taskWorld = { ...structuredClone(initial), entityBytes: shared(initial.entityBytes!),
    typeMovementClasses: shared(initial.typeMovementClasses!),
    placementState: { ...initial.placementState, renatBytes: shared(initial.placementState.renatBytes) } };
  const taskPending = createSourceNativeTaskOptions({ assets: taskAssets, world: taskWorld });
  taskAssets.executable.fill(0); taskAssets.scenario.fill(0); Object.values(taskAssets.animations).forEach(bytes => bytes.fill(0));
  taskWorld.entityBytes.fill(0); taskWorld.typeMovementClasses.fill(0); taskWorld.placementState.renatBytes.fill(0);
  assert.deepEqual(await taskPending, configuration);
  const request = { configuration, proof }, pending = createSourceNativeCombatOptions(request);
  request.proof = { ...proof, randomTable: Array<number>(256).fill(0) };
  const recreated = await pending;
  assert.deepEqual(recreated.nativeCombat, options.nativeCombat);
  assert.ok(Object.isFrozen(recreated.nativeCombat.tables.typeTable));
  const forged = structuredClone(recreated.nativeCombat);
  (forged.tables.typeTable as number[])[0x48] ^= 1;
  assert.throws(() => validateSourceNativeCombatConfiguration(forged), /authenticated/);
  assert.throws(() => new CampaignSession({ ...options, production: {} as never }), /excludes production/);
  assert.throws(() => new CampaignSession({ ...options, resourceLifecycle: {} as never }), /excludes production/);
  assert.throws(() => new CampaignSession({ ...options, campaignAi: {} as never }), /excludes production/);
  const world = new CampaignSession(options).snapshot.world, before = structuredClone(world);
  const exit = { key: "unowned-production", team: 0, queue: 0 as const, ticket: "unowned", unitType: 0, tile: { x: 1, y: 1 } };
  for (const call of [reserveTransportProductionExit, allocateTransportProductionExit]) {
    const result = call(world, exit);
    assert.equal(result.ok, false); assert.match(JSON.stringify(result), /shared scheduler/);
    assert.deepEqual(world, before);
  }
});

test("combat composition authenticates the complete call-time configuration snapshot", async () => {
  const { options, configuration, proof, initial } = await fixture();
  const mutable = structuredClone(configuration);
  assert.ok(isAuthenticatedSourceNativeTaskConfiguration(mutable));
  const pending = withSourceNativeCombatTasks(mutable, proof);
  Object.assign(mutable, { rngCursor: 137, counter: 12, task6Budget: 9 });
  (mutable.bindings[0].raw as number[])[0] ^= 1;
  (mutable.profiles.find(profile => profile.typeId !== 0)!.families as number[])[0] ^= 1;
  const composed = await pending;
  assert.equal(composed.sourceId, options.nativeAiTasks.sourceId);
  assert.ok(sourceNativeTaskValue(composed) === sourceNativeTaskValue(options.nativeAiTasks),
    "source identity must bind the exact call-time configuration values");
  assert.ok(isAuthenticatedSourceNativeTaskConfiguration(composed));
  assert.ok(isAuthenticatedSourceNativeTaskConfiguration(structuredClone(composed)));
  const clean = await withSourceNativeCombatTasks(structuredClone(configuration), proof);
  assert.deepEqual(composed, clean);
  const session = new CampaignSession({ ...options, nativeAiTasks: composed });
  assert.deepEqual(session.snapshot.world.source, initial.source);
  assert.ok(session.step(input(session)).ok);
  assert.deepEqual(CampaignSession.restore(session.checkpoint(), undefined, clean, undefined,
    options.nativeCombat).checkpoint(), session.checkpoint());
  const unrecognized = Object.assign(Object.create({ toJSON: () => ({ ...configuration, rngCursor: 137 }) }),
    structuredClone(configuration));
  assert.equal(isAuthenticatedSourceNativeTaskConfiguration(unrecognized), false);
  assert.ok(isAuthenticatedSourceNativeTaskConfiguration(structuredClone(unrecognized)));
  await assert.rejects(withSourceNativeCombatTasks(unrecognized, proof), /plain records/);
  const concealed = Object.assign(Object.create({ toJSON: () => configuration }), structuredClone(configuration),
    { rngCursor: 137 });
  assert.equal(isAuthenticatedSourceNativeTaskConfiguration(concealed), false);
  assert.equal(isAuthenticatedSourceNativeTaskConfiguration(structuredClone(concealed)), false);
  await assert.rejects(withSourceNativeCombatTasks(concealed, proof), /plain records/);
});

test("immutable configuration forks isolate actors, planes, pools, history, journals and dynamic bindings", async () => {
  const { options } = await fixture(), parent = new CampaignSession(options);
  for (let counter = 1; counter <= 15; counter++) assert.ok(parent.step({ clockMilliseconds: counter * 16,
    nativeAiFrame: { counter, task6Budget: 0 } }).ok);
  const left = parent.fork(), right = parent.fork();
  const current = (session: CampaignSession) => Reflect.get(session, "current") as CampaignSession["snapshot"];
  const host = (session: CampaignSession) => current(session).world.transportState as ReturnType<typeof transportHostState>;
  const original = host(parent).nativeAiTasks!.configuration;
  assert.ok(isImmutableSourceNativeTaskConfiguration(original));
  for (const sibling of [left, right]) {
    assert.equal(host(sibling).nativeAiTasks!.configuration, original);
    assert.equal(host(sibling).nativeCombat!.configuration, host(parent).nativeCombat!.configuration);
    assert.notEqual(Reflect.get(sibling, "entries")[0], Reflect.get(parent, "entries")[0]);
    assert.notEqual(current(sibling).world.entityBytes, current(parent).world.entityBytes);
    assert.notEqual(current(sibling).nativeAiInputs, current(parent).nativeAiInputs);
    assert.notEqual(current(sibling).nativeAiInputs![0].nativeAiFrame, current(parent).nativeAiInputs![0].nativeAiFrame);
    for (const field of ["slots", "ground", "flying", "registry", "generations", "requests"] as const)
      assert.notEqual(host(sibling)[field], host(parent)[field]);
    const slot = original.bindings[0].slot;
    assert.notEqual(host(sibling).slots[slot], host(parent).slots[slot]);
    assert.notEqual(host(sibling).slots[slot]!.nativeAiTask!.raw, host(parent).slots[slot]!.nativeAiTask!.raw);
    assert.notEqual(host(sibling).nativeAiTasks!.ground, host(parent).nativeAiTasks!.ground);
    assert.notEqual(host(sibling).nativeCombat!.projectiles.records, host(parent).nativeCombat!.projectiles.records);
    assert.notEqual(host(sibling).nativeCombat!.projectiles.heads, host(parent).nativeCombat!.projectiles.heads);
    assert.notEqual(host(sibling).nativeCombat!.projectiles.statistics, host(parent).nativeCombat!.projectiles.statistics);
    assert.notEqual(host(sibling).nativeCombat!.journal, host(parent).nativeCombat!.journal);
    assert.notEqual(host(sibling).nativeCombat!.journal[0], host(parent).nativeCombat!.journal[0]);
  }
  const before = parent.checkpoint(), journal = parent.journal;
  assert.ok(left.step({ clockMilliseconds: 256, nativeAiFrame: { counter: 16, task6Budget: 0 } }).ok);
  const extended = host(left).nativeAiTasks!.configuration;
  assert.notEqual(extended, original);
  assert.ok(isImmutableSourceNativeTaskConfiguration(extended));
  assert.equal(extended.bindings.length, original.bindings.length + 2);
  assert.equal(host(right).nativeAiTasks!.configuration, original);
  assert.deepEqual(parent.checkpoint(), before);
  assert.deepEqual(right.checkpoint(), before);
  assert.deepEqual(parent.journal, journal);
  assert.deepEqual(right.journal, journal);
  assert.equal(left.journal.length, journal.length + 1);
  const exposed = left.snapshot, exposedHost = transportHostState(exposed.world);
  (exposedHost.nativeAiTasks!.configuration.profiles[0].typeBytes as number[])[8] ^= 1;
  assert.equal(isAuthenticatedSourceNativeTaskConfiguration(exposedHost.nativeAiTasks!.configuration), false);
  assert.ok(isAuthenticatedSourceNativeTaskConfiguration(extended));
  const checkpoint = left.checkpoint();
  (checkpoint.options.nativeAiTasks!.profiles[0].typeBytes as number[])[8] ^= 1;
  (checkpoint.options.nativeCombat!.tables.typeTable as number[])[8] ^= 1;
  assert.doesNotThrow(() => validateSourceNativeCombatConfiguration(host(left).nativeCombat!.configuration));
  assert.ok(isAuthenticatedSourceNativeTaskConfiguration(Reflect.get(left, "options").nativeAiTasks));
  const copy = cloneTransportHostWorld(current(left).world);
  const copiedHost = copy.transportState as ReturnType<typeof transportHostState>;
  assert.equal(copiedHost.nativeAiTasks!.configuration, extended);
  copiedHost.nativeAiTasks!.ground[0] ^= 1;
  copiedHost.nativeAiTasks!.rngCursor ^= 1;
  (copiedHost.nativeCombat!.projectiles.records as number[])[0] ^= 1;
  copiedHost.nativeCombat!.journal[0].rngAfter ^= 1;
  (copiedHost.slots[extended.bindings[0].slot]!.nativeAiTask!.raw as number[])[0] ^= 1;
  assert.notDeepEqual(copy, current(left).world);
  assert.deepEqual(parent.checkpoint(), before);
  assert.deepEqual(right.checkpoint(), before);
  const next = { clockMilliseconds: 272, nativeAiFrame: { counter: 17, task6Budget: 0 } };
  assert.ok(left.step(next).ok);
  assert.equal(current(parent).cycleCounter, 15);
  assert.equal(current(right).cycleCounter, 15);
});

test("session construction rejects shared storage throughout retained options", async () => {
  const { options } = await fixture();
  const sharedGrid = new Uint8Array(new SharedArrayBuffer(options.pathGrid.length));
  sharedGrid.set(options.pathGrid);
  assert.throws(() => new CampaignSession({ ...options, pathGrid: sharedGrid }), /SharedArrayBuffer/);
  const sharedTags = new Uint8Array(new SharedArrayBuffer(options.tags.length));
  sharedTags.set(options.tags);
  assert.throws(() => new CampaignSession({ ...options, tags: sharedTags }), /SharedArrayBuffer/);
  const buffer = new SharedArrayBuffer(32);
  for (const storage of [buffer, new DataView(buffer, 8, 8), new Uint16Array(buffer, 8, 4),
    new Int32Array(buffer), new Float64Array(buffer), new BigInt64Array(buffer),
    new Map([[new DataView(buffer), "key"]]), new Map([["value", new Uint8Array(buffer)]]),
    new Set([new DataView(buffer)]), new Error("shared cause", { cause: new DataView(buffer) })]) {
    const metadata = { storage, self: undefined as unknown };
    metadata.self = metadata;
    const supplied = { ...options, messages: [{ id: 1, text: "retained", metadata }] };
    assert.throws(() => new CampaignSession(supplied), /SharedArrayBuffer/);
  }
});

test("session private input snapshots retain types and replay after caller mutation", async () => {
  const { options } = await fixture();
  const supplied = structuredClone(options), session = new CampaignSession(supplied);
  const before = session.checkpoint();
  supplied.pathGrid[0] ^= 1;
  supplied.tags[0] ^= 1;
  (supplied.nativeAiTasks.bindings[0].raw as number[])[0] ^= 1;
  assert.deepEqual(session.checkpoint(), before);
  const frame = input(session);
  assert.ok(session.step(frame).ok);
  const stepped = session.checkpoint();
  Object.assign(frame.nativeAiFrame!, { counter: 137 });
  assert.deepEqual(session.checkpoint(), stepped);
  assert.deepEqual(CampaignSession.restore(stepped, undefined, options.nativeAiTasks, undefined,
    options.nativeCombat).checkpoint(), stepped);
  const rejected = session.step({ ...input(session), updates: Object.assign([], {
    storage: new DataView(new SharedArrayBuffer(16)),
  }) });
  assert.equal(rejected.ok, false);
  assert.match(JSON.stringify(rejected), /SharedArrayBuffer/);
  assert.deepEqual(session.checkpoint(), stepped);
  const buffer = new ArrayBuffer(32), storage = { view: new DataView(buffer, 8, 8),
    words: new Uint16Array(buffer, 8, 4), values: new Map([["large", 7n]]), self: undefined as unknown };
  storage.self = storage;
  storage.view.setUint16(0, 123, true);
  const typedOptions = { ...options, nativeAiTasks: undefined, nativeCombat: undefined,
    messages: [{ id: 1, text: "retained", storage }] };
  const typed = new CampaignSession(typedOptions);
  storage.view.setUint16(0, 456, true);
  const retained = Reflect.get(typed.checkpoint().options.messages[0], "storage") as typeof storage;
  assert.ok(retained.view instanceof DataView);
  assert.ok(retained.words instanceof Uint16Array);
  assert.equal(retained.view.byteOffset, 8);
  assert.equal(retained.view.byteLength, 8);
  assert.equal(retained.view.getUint16(0, true), 123);
  assert.equal(retained.view.buffer, retained.words.buffer);
  assert.equal(retained.values.get("large"), 7n);
  assert.equal(retained.self, retained);
});

test("authenticated original mixed world: dynamic source troops launch, hit, react and replay atomically", async context => {
  const fixtureValue = await fixture(), { options, column, row } = fixtureValue;
  const session = new CampaignSession(options);
  let early: ReturnType<CampaignSession["checkpoint"]> | undefined;
  for (let count = 0; count < 16; count++) {
    const result = session.step(input(session)); assert.ok(result.ok, JSON.stringify(result));
    if (count === 0) early = session.checkpoint();
  }
  let host = transportHostState(session.snapshot.world);
  const added = host.slots.filter(actor => actor?.key.startsWith("transport:"));
  assert.equal(added.length, 2);
  const source = added.find(actor => actor!.team === 0)!, target = added.find(actor => actor!.team === 5)!;
  assert.equal(source.unitType, 0); assert.equal(target.unitType, 0);
  const move = session.step(input(session, [packet(source.slot, column + 2, row, 7)]));
  assert.ok(move.ok, JSON.stringify(move));
  for (let count = 0; count < 40; count++) {
    const result = session.step(input(session)); assert.ok(result.ok, JSON.stringify(result));
  }
  const follow = session.step(input(session, [packet(target.slot, column, row)]));
  assert.ok(follow.ok, JSON.stringify(follow));
  let hit = false;
  let beforeHit: CampaignWorld | undefined;
  for (let count = 0; count < 120; count++) {
    beforeHit = session.snapshot.world;
    const result = session.step(input(session)); assert.ok(result.ok, JSON.stringify(result));
    host = transportHostState(session.snapshot.world);
    if (host.nativeCombat!.journal.at(-1)!.impacts.length) { hit = true; break; }
  }
  assert.ok(hit, "must execute a real positive hit, not just reject unsupported profiles");
  const hitState = session.checkpoint(), hitHost = host;
  assert.ok(hitHost.slots[target.slot]!.health < target.health);
  assert.equal(hitHost.slots[target.slot]!.nativeAiTask!.raw[0xc8], 1);
  assert.equal(hitHost.slots[target.slot]!.nativeAiTask!.raw[0xc9], 1);
  assert.equal(hitHost.nativeCombat!.projectiles.highWater, 1);
  assert.deepEqual(hitHost.nativeCombat!.projectiles.heads, [0, -1]);
  assert.equal(hitHost.nativeCombat!.journal.at(-1)!.reclaimed.length, 1);
  const reaction = session.step(input(session)); assert.ok(reaction.ok, JSON.stringify(reaction));
  const reacted = transportHostState(session.snapshot.world).slots[target.slot]!.nativeAiTask!.raw;
  assert.equal(reacted[0xc7], 0); assert.equal(reacted[0xc8], 1); assert.equal(reacted[0xc9], 1);
  assert.equal(reacted[0x22], 1);
  const lethal = structuredClone(beforeHit!);
  const lethalHost = transportHostState(lethal), lethalActor = lethalHost.slots[target.slot]!;
  lethalActor.health = 1;
  new DataView(lethal.entityBytes!.buffer).setInt32(target.slot * 220 + 12, 1, true);
  lethalActor.nativeAiTask!.raw = Array.from(lethal.entityBytes!.slice(target.slot * 220, (target.slot + 1) * 220));
  const lethalWorld = { ...lethal, transportState: lethalHost,
    entities: lethal.entities.map(entity => entity.rawSlot === target.slot ? { ...entity, health: 1 } : entity) };
  const lethalBefore = structuredClone(lethalWorld);
  const denied = stepTransportHost(lethalWorld, undefined, { counter: hitState.state.cycleCounter, task6Budget: 0 });
  assert.equal(denied.ok, false); assert.match(JSON.stringify(denied), /death-owner-required/);
  assert.deepEqual(lethalWorld, lethalBefore, "late projectile failure rolls back actor visits, pool, RNG, planes and health");
  const combat = transportHostState(beforeHit!).nativeCombat!, profile = options.nativeAiTasks.profiles[0];
  const frame: LegacyNativeProjectileFrame = { phase: "after-actor-visits", projectiles: combat.projectiles,
    actors: [...beforeHit!.entityBytes!], rngCursor: transportHostState(beforeHit!).nativeAiTasks!.rngCursor,
    tables: combat.configuration.tables, world: { width: profile.width, height: profile.height,
      ground: transportHostState(beforeHit!).nativeAiTasks!.ground, air: profile.air, extra: profile.extra,
      families: profile.families, relations: combat.configuration.relations, policy: 0 } };
  assert.ok(frame.projectiles.heads[1] >= 0, "guard must inspect an actual travelling projectile");
  assert.doesNotThrow(() => guardSourceNativeProjectileGeometry(frame, combat.configuration));
  const uncovered = [...frame.actors];
  uncovered[target.slot * 220 + 6] = 8;
  uncovered[target.slot * 220 + 7] = 1;
  assert.equal(combat.configuration.relations[1], 1, "negative candidate is allied but not same-team");
  assert.throws(() => guardSourceNativeProjectileGeometry({ ...frame, actors: uncovered }, combat.configuration), /before alliance filter/);
  for (const mutate of [
    (checkpoint: typeof hitState) => { ((checkpoint.state.world.transportState as typeof host).nativeCombat!.projectiles.statistics as number[])[0]++; },
    (checkpoint: typeof hitState) => { (checkpoint.state.world.transportState as typeof host).nativeAiTasks!.rngCursor ^= 1; },
    (checkpoint: typeof hitState) => { (checkpoint.state.world.transportState as typeof host).nativeCombat!.journal[0].rngAfter ^= 1; },
    (checkpoint: typeof hitState) => { (checkpoint.state.nativeAiInputs as CampaignSessionInput[]).pop(); },
  ]) {
    const changed = structuredClone(early!); mutate(changed);
    assert.throws(() => CampaignSession.restore(changed, undefined, options.nativeAiTasks, undefined, options.nativeCombat), /replay|caller history/);
  }
  assert.deepEqual(session.snapshot.world.source, fixtureValue.initial.source);
  for (const original of fixtureValue.initial.entities) assert.ok(session.snapshot.world.entities.some(entity => entity.key === original.key));
  assert.throws(() => CampaignSession.restore(hitState, undefined, options.nativeAiTasks), /externally authenticated provider/);
  const restored = CampaignSession.restore(hitState, undefined, options.nativeAiTasks, undefined, options.nativeCombat);
  assert.deepEqual(restored.checkpoint(), hitState);
  assert.ok(restored.step(input(restored)).ok);
  assert.deepEqual(restored.checkpoint(), session.checkpoint());
  while (session.snapshot.cycleCounter < 95) {
    const result = session.step(input(session)); assert.ok(result.ok, JSON.stringify(result));
  }
  const lateBefore = session.checkpoint(), lateJournal = session.journal;
  const late = session.step(input(session));
  assert.equal(late.ok, false); assert.match(JSON.stringify(late), /unsupported source native allocation/);
  assert.deepEqual(session.checkpoint(), lateBefore);
  assert.deepEqual(session.journal, lateJournal, "late bounded caller failure cannot publish session or combat journal");
  const before = session.checkpoint(), failed = session.step({ ...input(session), nativeAiFrame: { counter: -1, task6Budget: 0 } });
  assert.equal(failed.ok, false); assert.deepEqual(session.checkpoint(), before);
  const spawns = hitHost.nativeCombat!.journal.flatMap(entry => entry.spawns).length;
  const impacts = hitHost.nativeCombat!.journal.flatMap(entry => entry.impacts).length;
  context.diagnostic(JSON.stringify({ spawns, impacts, reactionVisits: 1, originalActors: fixtureValue.initial.entities.length,
    allocated: added.length, frames: hitHost.nativeCombat!.journal.length }));
});
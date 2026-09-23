import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCueCatalog, normalizeAudioSource } from "../../src/audio/cues";
import { beginLegacyNativeDeath, reduceLegacyNativeDeathVisit, type LegacyNativeDeathSound } from "../../src/engine/legacy-native-death";
import { reduceLegacyNativeProjectiles, type LegacyNativeProjectileFrame } from "../../src/engine/legacy-native-projectiles";
import type { LegacyAiRegisteredWorld } from "../../src/engine/legacy-ai-task";

interface Snapshot {
  actors: string; game: string; ground: string; air: string; extra: string; typeStatistics: string;
  statistics: number[]; rngCursor: number; soundDescriptor: number[]; soundSeed: number;
}
interface Evidence {
  binarySha256: string; source: number; target: number; counter: number;
  before: Snapshot; after: Snapshot; world: LegacyAiRegisteredWorld;
  initial: { boom: number[]; projectileFin: LegacyNativeProjectileFrame["tables"]["fin"] };
  sourceHashes: Record<string, string>; listener: { x: number; y: number }; startupDescriptor: number[];
  calls: { id: number; volume: number; pan: number; descriptor: number }[];
  entries: string[]; rngWrites: { address: string; value: number }[];
  visibility: { label: string; cell: number; before: number; after: number };
  runtimeIntercepts: { address: string; boundary: string }[]; healthRewrites: unknown[];
  platformCalls: { method: string; arguments: number[] }[];
  categoryCount: number; sourceSoundRows: { id: number; raw116: number[] }[];
  cases: { label: string; listener: { x: number; y: number }; disabled: boolean;
    before: Snapshot; after: Snapshot; calls: Evidence["calls"]; rngWrites: Evidence["rngWrites"];
    firstVisit: Snapshot; visitRngWrites: Evidence["rngWrites"]; visitCalls: Evidence["calls"];
    platformCalls: Evidence["platformCalls"] }[];
}
const evidence: Evidence = JSON.parse(process.env.DC_NATIVE_DEATH_SOUND_TRACE
  ? readFileSync(process.env.DC_NATIVE_DEATH_SOUND_TRACE, "utf8")
  : execFileSync("python3", ["-B", fileURLToPath(new URL("native-death-sound-native.py", import.meta.url))], {
    encoding: "utf8", maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
  }));
const catalog = createCueCatalog(readFileSync(new URL("../../raw_cd/DC/SOUND/SOUND2.DAT", import.meta.url), "utf8"),
  readFileSync(new URL("../../raw_cd/DC/SOUND/SLIST.DAT", import.meta.url), "utf8"));
const decode = (value: string) => Buffer.from(value, "base64");
const words = (buffer: Buffer, width: 2 | 4, signed = false) => Array.from({ length: buffer.length / width }, (_, index) =>
  width === 4 ? signed ? buffer.readInt32LE(index * width) : buffer.readUInt32LE(index * width)
    : signed ? buffer.readInt16LE(index * width) : buffer.readUInt16LE(index * width));
function frame(snapshot = evidence.before): LegacyNativeProjectileFrame {
  const game = decode(snapshot.game), world = evidence.world;
  const combat = world.combat;
  assert.ok(combat);
  const sound: LegacyNativeDeathSound = {
    configuration: { executableSha256: evidence.binarySha256, soundTableSha256: evidence.sourceHashes["SOUND2.DAT"],
      bindingsSha256: evidence.sourceHashes["SLIST.DAT"], categoryCount: evidence.categoryCount,
      sounds: catalog.bindings.find(item => item.id === 0 && item.group === "DEA")!.soundIds
        .map(id => catalog.sounds.find(item => item.id === id)!) },
    state: { descriptor: snapshot.soundDescriptor, randomSeed: snapshot.soundSeed },
    initialized: true, disabled: false, listener: evidence.listener,
  };
  return { phase: "after-actor-visits", actors: [...decode(snapshot.actors)], rngCursor: snapshot.rngCursor,
    projectiles: { records: [...game.subarray(0x32ca8, 0x32ca8 + 2024 * 40)], highWater: game.readInt32LE(0x7d24),
      heads: [game.readInt16LE(0x468e8), game.readInt16LE(0x468ea)], statistics: snapshot.statistics },
    death: { counter: evidence.counter, sound, state: {
      registry: words(game.subarray(0x468ec, 0x468ec + 1600), 2, true), typeStatistics: words(decode(snapshot.typeStatistics), 4, true),
      commanderSlots: Array.from({ length: 8 }, (_, team) => game.readInt16LE(team * 0xe30 + 0x1934)), pending: [],
    } },
    world: { width: world.width, height: world.height, ground: words(decode(snapshot.ground), 4),
      air: words(decode(snapshot.air), 2), extra: words(decode(snapshot.extra), 2), families: world.families,
      relations: combat.relations, policy: 0 },
    tables: { typeTable: combat.typeTable, weapons: world.weapons, randomTable: world.randomTable,
      damageTable: combat.damageTable, boom: evidence.initial.boom, fin: { ...evidence.initial.projectileFin, ...world.fin } } };
}

test("actual native visible lethal projectile emits source DEA and preserves every combat byte and RNG", () => {
  const input = frame(), saved = structuredClone(input), expected = frame(evidence.after);
  assert.match(evidence.visibility.label, /controlled bit31.*NOT normal mission/);
  assert.equal(evidence.visibility.before & 0x80000000, 0);
  assert.notEqual(input.world.ground[evidence.visibility.cell] & 0x80000000, 0);
  assert.deepEqual(evidence.healthRewrites, []);
  assert.deepEqual(evidence.entries, ["0x441930", "0x416308", "0x434d48", "0x431da8", "0x431bf4", "0x431d79", "0x430f50",
    "0x708600", "0x708610", "0x708620", "0x708630", "0x44e22d", "0x45a7a6"]);
  assert.deepEqual(evidence.runtimeIntercepts.map(item => item.boundary), ["GetStatus", "SetVolume", "SetPan", "Play"]
    .map(method => `DirectSoundBuffer::${method} platform only`));
  const result = reduceLegacyNativeProjectiles(input);
  assert.ok(result.supported, JSON.stringify(result)); assert.ok(result.death);
  assert.deepEqual(input, saved);
  assert.deepEqual(result.actors, expected.actors);
  assert.deepEqual(result.projectiles, expected.projectiles);
  assert.deepEqual(result.death.state.registry, expected.death!.state.registry);
  assert.deepEqual(result.death.state.typeStatistics, expected.death!.state.typeStatistics);
  assert.deepEqual(result.death.state.commanderSlots, expected.death!.state.commanderSlots);
  for (const plane of ["ground", "air", "extra"] as const) assert.deepEqual(result.death[plane], expected.world[plane]);
  assert.equal(result.rngCursor, expected.rngCursor);
  assert.deepEqual(result.randomAdvances, evidence.rngWrites.filter(item => item.address === "0x479204").map(item => item.value));
  assert.deepEqual(result.death.soundState, expected.death!.sound!.state);
  assert.deepEqual(result.soundRequests.map(({ id, volume, pan }) => ({ id, volume, pan })),
    evidence.calls.map(({ id, volume, pan }) => ({ id, volume: volume | 0, pan: pan | 0 })));
  assert.equal(result.soundRequests[0].source.source, "SOUND/TROPDEA3.WAV");
  assert.deepEqual(result.soundRequests[0].source.parameters, [2, 1, 0, 0]);
  const direct = beginLegacyNativeDeath({ ...input, ...input.death!, statistics: input.projectiles.statistics,
    source: evidence.source, target: evidence.target, weapon: 1, damage: 25 });
  assert.ok(direct.supported);
  assert.deepEqual(direct.soundRequests, result.soundRequests);
  assert.deepEqual(direct.soundState, result.death.soundState);
});

test("original SOUND2 scanner and SLIST loader match the preloaded source catalog", () => {
  assert.equal(evidence.categoryCount, 106);
  assert.deepEqual(evidence.startupDescriptor, [4, 0, 0, 28, 90, 153, 154, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(evidence.sourceSoundRows.map(item => item.id), [28, 90, 153, 154]);
  for (const { id, raw116 } of evidence.sourceSoundRows) {
    const raw = Buffer.from(raw116), source = catalog.sounds.find(item => item.id === id)!;
    assert.equal(normalizeAudioSource(raw.subarray(1, 65).toString().split("\0")[0]), source.source);
    assert.deepEqual([raw[0], raw[65], raw.readInt32LE(68), raw[73]], source.parameters);
    assert.equal(raw[72], 1);
  }
});

for (const native of evidence.cases) test(`native visible death sound matrix: ${native.label}`, () => {
  const base = frame(native.before), input = { ...base, death: { ...base.death!, sound: {
    ...base.death!.sound!, listener: native.listener, disabled: native.disabled,
  } } }, saved = structuredClone(input), expected = frame(native.after);
  const result = reduceLegacyNativeProjectiles(input);
  assert.ok(result.supported, JSON.stringify(result)); assert.ok(result.death);
  assert.deepEqual(input, saved);
  assert.deepEqual(result.actors, expected.actors);
  assert.deepEqual(result.projectiles, expected.projectiles);
  for (const field of ["registry", "typeStatistics", "commanderSlots"] as const)
    assert.deepEqual(result.death.state[field], expected.death!.state[field]);
  for (const plane of ["ground", "air", "extra"] as const) assert.deepEqual(result.death[plane], expected.world[plane]);
  assert.equal(result.rngCursor, expected.rngCursor);
  assert.deepEqual(result.randomAdvances, native.rngWrites.filter(item => item.address === "0x479204").map(item => item.value));
  assert.deepEqual(result.death.soundState, expected.death!.sound!.state);
  assert.deepEqual(result.soundRequests.map(({ id, volume, pan }) => ({ id, volume, pan })),
    native.calls.map(({ id, volume, pan }) => ({ id, volume: volume | 0, pan: pan | 0 })));
  assert.deepEqual(native.platformCalls.map(item => item.method), native.calls.length ? ["GetStatus", "SetVolume", "SetPan", "Play"] : []);
  if (native.calls.length) {
    assert.equal(native.platformCalls[1].arguments[1] | 0, native.calls[0].volume === 1 ? 0 : native.calls[0].volume | 0);
    assert.equal(native.platformCalls[2].arguments[1] | 0, native.calls[0].pan | 0);
    assert.deepEqual(native.platformCalls[3].arguments.slice(1), [0, 0, 0]);
  }
  for (const request of result.soundRequests) {
    assert.equal(request.id, native.before.soundDescriptor[3 + native.before.soundDescriptor[1]]);
    assert.deepEqual(request.source, catalog.sounds.find(item => item.id === request.id));
    assert.equal(request.slot, evidence.target); assert.equal(request.category, 0); assert.equal(request.event, 3);
    assert.equal(request.x, Buffer.from(input.actors).readUInt16LE(evidence.target * 220));
    assert.equal(request.y, Buffer.from(input.actors).readUInt16LE(evidence.target * 220 + 4));
  }
  const registered = reduceLegacyNativeDeathVisit({ ...input, actors: result.actors, state: result.death.state,
    statistics: result.projectiles.statistics, rngCursor: result.rngCursor, counter: evidence.counter + 1,
    slot: evidence.target, world: { ...input.world, ...result.death },
    sound: { ...input.death.sound, state: result.death.soundState! } });
  assert.ok(registered.supported, JSON.stringify(registered));
  const visit = frame(native.firstVisit);
  assert.deepEqual(registered.actors, visit.actors);
  assert.deepEqual(registered.statistics, visit.projectiles.statistics);
  assert.deepEqual(result.projectiles, visit.projectiles);
  for (const field of ["registry", "typeStatistics", "commanderSlots"] as const)
    assert.deepEqual(registered.state[field], visit.death!.state[field]);
  for (const plane of ["ground", "air", "extra"] as const) assert.deepEqual(registered[plane], visit.world[plane]);
  assert.equal(registered.rngCursor, visit.rngCursor);
  assert.deepEqual(registered.randomAdvances, native.visitRngWrites.filter(item => item.address === "0x479204").map(item => item.value));
  assert.deepEqual(registered.soundState, visit.death!.sound!.state);
  assert.deepEqual(registered.soundRequests, native.visitCalls);
  const beforeGame = decode(native.before.game), afterGame = decode(native.after.game);
  for (let offset = 0; offset < beforeGame.length; offset++) if (beforeGame[offset] !== afterGame[offset])
    assert.ok((offset >= 0x7d28 && offset < 0x7d28 + 800 * 220)
      || (offset >= 0x32ca8 && offset < 0x32ca8 + 2024 * 40) || (offset >= 0x468e8 && offset < 0x468ec),
    `unowned game write ${offset.toString(16)}`);
});

test("native matrix genuinely dispatches all four source sounds and preserves audio RNG on suppressed requests", () => {
  assert.deepEqual([...new Set(evidence.cases.flatMap(item => item.calls.map(call => call.id)))].sort((left, right) => left - right), [28, 90, 153, 154]);
  for (const label of ["muted", "outside-distance", "distance-edge-rejected", "invisible"]) {
    const native = evidence.cases.find(item => item.label === label)!;
    assert.deepEqual(native.calls, []); assert.deepEqual(native.rngWrites, []);
    assert.equal(native.before.soundSeed, native.after.soundSeed);
    assert.deepEqual(native.before.soundDescriptor, native.after.soundDescriptor);
  }
  assert.equal(evidence.cases.find(item => item.label === "distance-edge-admitted")!.calls[0].volume | 0, -7999);
  assert.equal(evidence.cases.find(item => item.label === "right-pan")!.calls[0].pan | 0, -10);
});

test("missing or malformed source sound rejects atomically without dropping visible requests", () => {
  const base = frame(), sound = base.death!.sound!;
  const mutate = (change: (value: LegacyNativeDeathSound) => unknown): LegacyNativeDeathSound => {
    const copy = structuredClone(sound); change(copy); return copy;
  };
  const descriptor = (offset: number, value: number) => mutate(copy => (copy.state.descriptor as number[])[offset] = value);
  const poisoned: unknown[] = [null, {}, { ...sound, configuration: null }, { ...sound, state: null },
    { ...sound, listener: null }, { ...sound, initialized: false }, { ...sound, disabled: 1 },
    { ...sound, listener: { x: NaN, y: 0 } }, { ...sound, listener: { x: 0, y: 2147483648 } },
    ...["executableSha256", "soundTableSha256", "bindingsSha256"].map(field => ({ ...sound,
      configuration: { ...sound.configuration, [field]: "forged" } })),
    { ...sound, configuration: { ...sound.configuration, categoryCount: 0 } },
    { ...sound, configuration: { ...sound.configuration, sounds: [] } },
    { ...sound, configuration: { ...sound.configuration, sounds: [null, ...sound.configuration.sounds.slice(1)] } },
    { ...sound, configuration: { ...sound.configuration, sounds: sound.configuration.sounds.map(item => ({ ...item, source: "SOUND/OTHER.WAV" })) } },
    { ...sound, configuration: { ...sound.configuration, sounds: sound.configuration.sounds.map(item => ({ ...item, parameters: new Array(4) })) } },
    ...[-1, 0x100000000, NaN, 0.5].map(randomSeed => ({ ...sound, state: { ...sound.state, randomSeed } })),
    { ...sound, state: { ...sound.state, descriptor: [] } },
    { ...sound, state: { ...sound.state, descriptor: null } },
    descriptor(0, 0), descriptor(0, 5), descriptor(1, 4), descriptor(1, -1), descriptor(2, 1), descriptor(3, 29), descriptor(12, 1),
    mutate(copy => delete (copy.state.descriptor as number[])[3]),
  ];
  for (const invalid of poisoned) {
    const input = { ...base, death: { ...base.death!, sound: invalid as LegacyNativeDeathSound } }, saved = structuredClone(input);
    assert.deepEqual(reduceLegacyNativeProjectiles(input), { supported: false, diagnostic: "invalid-native-death-source-sound" });
    assert.deepEqual(beginLegacyNativeDeath({ ...input, ...input.death, statistics: input.projectiles.statistics,
      source: evidence.source, target: evidence.target, weapon: 1, damage: 25 }),
    { supported: false, diagnostic: "invalid-native-death-source-sound" });
    assert.deepEqual(input, saved);
  }
  const absent = { ...base, death: { ...base.death!, sound: undefined } }, saved = structuredClone(absent);
  assert.deepEqual(reduceLegacyNativeProjectiles(absent), { supported: false, diagnostic: "native-death-visible-sound-owner-required" });
  assert.deepEqual(absent, saved);
});

test("successive deaths consume the previous owned sound state, not a new random selection", () => {
  let state = frame().death!.sound!.state;
  for (const native of evidence.cases.filter(item => item.label.startsWith("source-selection-"))) {
    const base = frame(native.before);
    assert.deepEqual(state, base.death!.sound!.state);
    const input = { ...base, death: { ...base.death!, sound: { ...base.death!.sound!, state, listener: native.listener } } };
    const result = reduceLegacyNativeProjectiles(input);
    assert.ok(result.supported && result.death?.soundState);
    state = result.death.soundState;
    assert.deepEqual(state, frame(native.after).death!.sound!.state);
  }
});

test("late projectile failure publishes neither selected audio nor partial death state", () => {
  const base = frame(), weapons = Buffer.from(base.tables.weapons);
  weapons.writeInt32LE(1, 72 + 64); weapons.writeUInt32LE(0xdeadbeef, 72 + 48);
  const input = { ...base, tables: { ...base.tables, weapons: [...weapons] } };
  const saved = structuredClone(input);
  const result = reduceLegacyNativeProjectiles(input);
  assert.equal(result.supported, false);
  assert.deepEqual(result, { supported: false, diagnostic: "native-projectile-fin-required" });
  assert.deepEqual(input, saved);
});
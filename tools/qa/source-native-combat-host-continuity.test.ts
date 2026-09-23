import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { reduceLegacyAiRegisteredVisit, type LegacyAiRegisteredWorld } from "../../src/engine/legacy-ai-task";
import { guardSourceNativeProjectileGeometry, stepSourceNativeCombatDeath, stepSourceNativeCombatProjectiles,
  type SourceNativeCombatOwner } from "../../src/engine/source-native-combat-host";
import { reduceLegacyNativeDeathVisit } from "../../src/engine/legacy-native-death";
import { reduceLegacyNativeProjectiles, type LegacyNativeProjectileFrame } from "../../src/engine/legacy-native-projectiles";

interface Snapshot {
  actors: string; game: string; ground: string; air: string; extra: string; typeStatistics: string;
  statistics: number[]; rngCursor: number;
}
interface Visit {
  counter: number; owner: string;
  after: Partial<Record<"actors" | "game" | "ground" | "air" | "extra" | "typeStatistics", number[][]>>
    & { statistics?: number[]; rngCursor?: number };
  writes: { address: string; value: number }[];
}
const decode = (value: string) => Buffer.from(value, "base64");
const words = (buffer: Buffer, width: 2 | 4, signed = false) => Array.from({ length: buffer.length / width }, (_, index) =>
  width === 2 ? signed ? buffer.readInt16LE(index * 2) : buffer.readUInt16LE(index * 2)
    : signed ? buffer.readInt32LE(index * 4) : buffer.readUInt32LE(index * 4));

for (const [name, path, shotsExpected, phasesExpected, finalCounter] of [
  ["base", "/tmp/dc-death-complete-20260919-222344.json", 32, 1880, 678],
  ["overkill", "/tmp/dc-death-overkill-20260919-222804.json", 45, 2543, 899],
] as const) test(`host adapters ${name}: reject oracle-only configuration; reducers continue every original phase from first hit`, () => {
  const evidence = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(evidence.binarySha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  assert.equal(evidence.completed, true);
  assert.deepEqual(evidence.runtimeIntercepts, []); assert.deepEqual(evidence.healthRewrites, []);
  const initial: Snapshot = evidence.before, game = decode(initial.game);
  const profile: LegacyAiRegisteredWorld = evidence.targetWorld;
  const death = { registry: words(game.subarray(0x468ec, 0x468ec + 1600), 2, true),
    typeStatistics: words(decode(initial.typeStatistics), 4, true),
    commanderSlots: Array.from({ length: 8 }, (_, team) => game.readInt16LE(0x1934 + team * 0xe30)), pending: [] };
  const owner: SourceNativeCombatOwner = { configuration: {
    scope: "source-separated-type0-weapon1-bounded-lethal", runtimeReady: true,
    sourceType: 0, weapon: 1,
    taskSourceId: "adapter-oracle-only-not-a-provider", sourceTypeCount: 106, geometryTypes: [0], policy: evidence.policy,
    relations: profile.combat!.relations, scanOffsets: profile.combat!.scanOffsets,
    tables: { typeTable: profile.combat!.typeTable, weapons: profile.weapons, boom: evidence.initial.boom,
      damageTable: profile.combat!.damageTable, randomTable: profile.randomTable,
      fin: { ...evidence.initial.projectileFin, ...profile.fin } },
    death: { initial: death, statistics: initial.statistics } }, death,
    projectiles: { records: [...game.subarray(0x32ca8, 0x32ca8 + 2024 * 40)], highWater: game.readInt32LE(0x7d24),
      heads: [game.readInt16LE(0x468e8), game.readInt16LE(0x468ea)], statistics: initial.statistics }, journal: [] };
  let actors = Uint8Array.from(decode(initial.actors)), ground = words(decode(initial.ground), 4), rngCursor = initial.rngCursor;
  const air = words(decode(initial.air), 2), extra = words(decode(initial.extra), 2);
  assert.equal(evidence.policy, name === "base" ? 0 : 1);
  assert.equal(owner.configuration.sound, undefined);
  const beforeRejection = structuredClone({ owner, actors, ground, rngCursor });
  const firstCounter = (evidence.visits as Visit[])[0].counter;
  assert.throws(() => stepSourceNativeCombatProjectiles(owner, actors, { ...profile, air, extra }, ground, rngCursor, firstCounter),
    /externally authenticated configuration required/);
  assert.throws(() => stepSourceNativeCombatDeath(owner, actors, { ...profile, air, extra }, ground, rngCursor, firstCounter, evidence.target),
    /externally authenticated configuration required/);
  assert.deepEqual({ owner, actors, ground, rngCursor }, beforeRejection);
  let oracle = initial, shots = 1, hits = 1, deathVisits = 0, task6Budget = 0, lastCounter = 0;
  for (const visit of evidence.visits as Visit[]) {
    if (lastCounter !== visit.counter) task6Budget = 0;
    lastCounter = visit.counter;
    let randomAdvances: readonly number[];
    if (visit.owner === "projectile") {
      const input: LegacyNativeProjectileFrame = { phase: "after-actor-visits", actors: [...actors],
        projectiles: owner.projectiles, rngCursor, tables: owner.configuration.tables,
        death: { counter: visit.counter, state: owner.death! },
        world: { width: profile.width, height: profile.height, ground, air, extra,
          families: profile.families, relations: owner.configuration.relations, policy: evidence.policy } };
      guardSourceNativeProjectileGeometry(input, owner.configuration);
      const result = reduceLegacyNativeProjectiles(input);
      assert.ok(result.supported, result.supported ? undefined : `${visit.owner}:${visit.counter}: ${result.diagnostic}`);
      assert.ok(result.death);
      assert.deepEqual(result.soundRequests, []);
      assert.equal(result.death.soundState, undefined);
      actors = Uint8Array.from(result.actors); ground = [...result.death.ground]; rngCursor = result.rngCursor;
      owner.projectiles = result.projectiles; owner.death = result.death.state;
      hits += result.impacts.length; randomAdvances = result.randomAdvances;
    } else if (visit.owner === "target" && owner.death!.pending.length) {
      const result = reduceLegacyNativeDeathVisit({ actors: [...actors], statistics: owner.projectiles.statistics,
        state: owner.death!, counter: visit.counter, slot: evidence.target, rngCursor, tables: owner.configuration.tables,
        world: { width: profile.width, height: profile.height, ground, air, extra } });
      assert.ok(result.supported, result.supported ? undefined : `${visit.owner}:${visit.counter}: ${result.diagnostic}`);
      actors = Uint8Array.from(result.actors); ground = [...result.ground]; rngCursor = result.rngCursor;
      owner.projectiles = { ...owner.projectiles, statistics: result.statistics }; owner.death = result.state;
      deathVisits++; randomAdvances = result.randomAdvances;
      assert.deepEqual(result.removed, deathVisits === 150 ? [evidence.target] : []);
    } else {
      const slot = visit.owner === "target" ? evidence.target : evidence.source;
      const sourceWorld: LegacyAiRegisteredWorld = visit.owner === "target" ? profile : evidence.sourceWorld;
      const result = reduceLegacyAiRegisteredVisit({ slot, raw: [...actors.slice(slot * 220, (slot + 1) * 220)],
        counter: visit.counter, rngCursor, task6Budget, projectiles: owner.projectiles,
        world: { ...sourceWorld, ground, air, extra, combat: { ...sourceWorld.combat!, actors: Object.fromEntries(
          Array.from({ length: 800 }, (_, actor) => [actor, [...actors.slice(actor * 220, (actor + 1) * 220)]])) } } });
      assert.ok(result.supported, `${visit.owner}:${visit.counter}: ${JSON.stringify(result)}`);
      assert.ok(result.projectiles);
      actors.set(result.raw, slot * 220); ground = [...result.ground]; rngCursor = result.rngCursor;
      owner.projectiles = result.projectiles; task6Budget = result.task6Budget;
      shots += result.spawns.length; randomAdvances = result.randomAdvances;
    }
    const expected = { ...oracle };
    for (const key of ["actors", "game", "ground", "air", "extra", "typeStatistics"] as const) {
      if (!visit.after[key]) continue;
      const buffer = decode(oracle[key]);
      for (const [offset, value] of visit.after[key]!) buffer[offset] = value;
      expected[key] = buffer.toString("base64");
    }
    expected.statistics = visit.after.statistics ?? oracle.statistics;
    expected.rngCursor = visit.after.rngCursor ?? oracle.rngCursor;
    const expectedGame = decode(expected.game);
    assert.deepEqual(Buffer.from(actors), decode(expected.actors), `${visit.owner}:${visit.counter}: actors`);
    assert.deepEqual(Buffer.from(owner.projectiles.records), expectedGame.subarray(0x32ca8, 0x32ca8 + 2024 * 40));
    assert.equal(owner.projectiles.highWater, expectedGame.readInt32LE(0x7d24));
    assert.deepEqual(owner.projectiles.heads, [expectedGame.readInt16LE(0x468e8), expectedGame.readInt16LE(0x468ea)]);
    assert.deepEqual(owner.projectiles.statistics, expected.statistics);
    assert.deepEqual(owner.death!.registry, words(expectedGame.subarray(0x468ec, 0x468ec + 1600), 2, true));
    assert.deepEqual(owner.death!.typeStatistics, words(decode(expected.typeStatistics), 4, true));
    assert.deepEqual(owner.death!.commanderSlots, Array.from({ length: 8 }, (_, team) => expectedGame.readInt16LE(0x1934 + team * 0xe30)));
    assert.deepEqual(ground, words(decode(expected.ground), 4));
    assert.deepEqual(air, words(decode(expected.air), 2)); assert.deepEqual(extra, words(decode(expected.extra), 2));
    assert.equal(rngCursor, expected.rngCursor);
    assert.deepEqual(randomAdvances, visit.writes.filter(write => write.address === "0x479204").map(write => write.value));
    oracle = expected;
  }
  assert.equal(shots, shotsExpected); assert.equal(hits, shotsExpected);
  assert.equal(evidence.visits.length, phasesExpected); assert.equal(lastCounter, finalCounter);
  assert.equal(deathVisits, 150); assert.deepEqual(owner.death!.pending, []);
  assert.equal(Buffer.from(actors).readInt32LE(evidence.target * 220 + 12), name === "base" ? 0 : -10);
  assert.equal(owner.death!.registry[evidence.target], -1);
});
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodeLegacyAiTaskStack, reduceLegacyAiRegisteredVisit, stageLegacyAiTaskPendingVisit,
  type LegacyAiRegisteredFrame, type LegacyAiRegisteredWorld } from "../../src/engine/legacy-ai-task";
import { reduceLegacyNativeProjectiles, type LegacyNativeProjectileFrame } from "../../src/engine/legacy-native-projectiles";
import { createNativeCombatAlienFixture } from "./fixtures/native-combat-alien";
import { acquireLegacySourceCombatTarget } from "../../src/engine/legacy-source-combat-acquisition";
import { nativeType8ContinuationTraces } from "./fixtures/native-proof-trace";

interface Metadata {
  rngCursor: number; task6Budget: number; highWater: number; heads: [number, number]; statistics: number[];
}
interface Initial extends Metadata {
  kind: "initial"; mission: string; slots: number[]; policy: number; binarySha256: string;
  world: LegacyAiRegisteredWorld;
  profiles: Record<number, LegacyAiRegisteredWorld>;
  projectileFin: LegacyNativeProjectileFrame["tables"]["fin"];
  buffers: Record<string, string>;
  originalActors: string;
}
interface Visit extends Metadata {
  kind: "visit"; counter: number; slot: number | null;
  changes: Record<string, [number, number][]>; hashes: Record<string, string>;
  groundWrites: unknown[]; randomWrites: number[];
  entries: { entry: string; edx: number }[];
  scans: { slot: number; radius: number; maxIndex: number; target: number }[];
}
const paths = nativeType8ContinuationTraces();
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const words = (bytes: Buffer) => Array.from({ length: bytes.length / 4 }, (_, index) => bytes.readUInt32LE(index * 4));
const encodeWords = (values: readonly number[]) => {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => bytes.writeUInt32LE(value, index * 4));
  return bytes;
};

for (const path of paths) {
  const [initial, ...visits] = readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line)) as [Initial, ...Visit[]];
  const frameBefore = (select: (visit: Visit, raw: number[]) => boolean): LegacyAiRegisteredFrame => {
    const buffers = Object.fromEntries(Object.entries(initial.buffers).map(([name, value]) => [name, Buffer.from(value, "base64")]));
    let metadata: Metadata = initial, previousCounter = 16;
    for (const visit of visits) {
      const raw = visit.slot === null ? [] : [...buffers.actors.subarray(visit.slot * 220, (visit.slot + 1) * 220)];
      if (visit.slot !== null && select(visit, raw)) return {
        slot: visit.slot, raw, counter: visit.counter, rngCursor: metadata.rngCursor,
        task6Budget: previousCounter === visit.counter ? metadata.task6Budget : 0,
        projectiles: { records: [...buffers.records], highWater: metadata.highWater, heads: metadata.heads, statistics: metadata.statistics },
        world: { ...initial.profiles[visit.slot], ground: words(buffers.ground), combat: { ...initial.world.combat!, actors:
          Object.fromEntries(Array.from({ length: 800 }, (_, slot) => [slot, [...buffers.actors.subarray(slot * 220, (slot + 1) * 220)]])) } },
      };
      for (const [name, changes] of Object.entries(visit.changes)) for (const [index, value] of changes) buffers[name][index] = value;
      metadata = visit; previousCounter = visit.counter;
    }
    throw new Error("required native input boundary missing");
  };
  test(`fresh ${initial.mission} type8 damaged continuation through counter${visits.at(-1)!.counter}`, context => {
    assert.equal(initial.kind, "initial");
    assert.equal(initial.binarySha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
    assert.equal(initial.policy, 1);
    assert.equal(visits.length, (visits.at(-1)!.counter - 16) * 3);
    assert.ok(visits.at(-1)!.counter >= 200);
    assert.deepEqual(initial.world.combat!.scanOffsets.slice(809), [[16, 0], [0, 16], [0, -16], [-16, 0], [99, 99]]);
    const expected = Object.fromEntries(Object.entries(initial.buffers).map(([name, value]) => [name, Buffer.from(value, "base64")]));
    const originalActors = Buffer.from(initial.originalActors, "base64");
    const startActors = Buffer.from(expected.actors);
    for (const [index, slot] of initial.slots.entries()) {
      assert.equal(originalActors[slot * 220 + 0x2c], 0, "original dynamic allocation uses an empty slot");
      assert.equal(expected.registry.readInt16LE(slot * 2), slot, "constructor registered the actual actor");
      assert.equal(startActors[slot * 220 + 6], 8);
      assert.equal(startActors[slot * 220 + 7], index === 0 ? 1 : 0);
      assert.equal(startActors.readInt32LE(slot * 220 + 12), 800);
      assert.equal(Buffer.from(initial.profiles[slot].typeBytes).readInt32LE(0xd8), 6);
    }
    let actors = Buffer.from(expected.actors), ground = words(expected.ground);
    let projectiles = { records: [...expected.records], highWater: initial.highWater,
      heads: initial.heads, statistics: initial.statistics };
    let rngCursor = initial.rngCursor, task6Budget = initial.task6Budget, previousCounter = 16;
    const launches: number[] = [], hits: number[] = [], turns: number[] = [], reactions: number[] = [];
    for (const visit of visits) {
      if (visit.counter !== previousCounter) { task6Budget = 0; previousCounter = visit.counter; }
      const beforeHealth = initial.slots.map(slot => actors.readInt32LE(slot * 220 + 12));
      for (const [name, changes] of Object.entries(visit.changes)) for (const [index, value] of changes) expected[name][index] = value;
      const label = `${initial.mission} counter ${visit.counter} slot ${visit.slot}`;
      if (visit.slot === null) {
        const combat = initial.world.combat!;
        const result = reduceLegacyNativeProjectiles({ phase: "after-actor-visits", actors: [...actors], projectiles, rngCursor,
          world: { ...initial.world, ground, relations: combat.relations, policy: initial.policy },
          tables: { typeTable: combat.typeTable, weapons: initial.world.weapons, damageTable: combat.damageTable,
            boom: initial.world.nativeFire!.spread, randomTable: initial.world.randomTable, fin: initial.projectileFin } });
        assert.ok(result.supported, `${label}: ${JSON.stringify(result)}`);
        actors = Buffer.from(result.actors);
        projectiles = { ...result.projectiles, records: [...result.projectiles.records], heads: [...result.projectiles.heads],
          statistics: [...result.projectiles.statistics] };
        rngCursor = result.rngCursor;
        assert.deepEqual(result.randomAdvances, visit.randomWrites, label);
        assert.equal(visit.groundWrites.length, 0, label);
        if (result.impacts.length) hits.push(visit.counter);
      } else {
        const slot = visit.slot, profile = initial.profiles[slot];
        const actorMap = Object.fromEntries(Array.from({ length: 800 }, (_, index) =>
          [index, [...actors.subarray(index * 220, (index + 1) * 220)]]));
        const input = { slot, raw: actorMap[slot], world: { ...profile, ground,
          combat: { ...initial.world.combat!, actors: actorMap } }, counter: visit.counter, rngCursor, task6Budget, projectiles };
        const result = reduceLegacyAiRegisteredVisit(input);
        assert.ok(result.supported, `${label}: ${JSON.stringify(result)}`);
        actors.set(result.raw, slot * 220);
        ground = [...result.ground];
        projectiles = { ...result.projectiles!, records: [...result.projectiles!.records], heads: [...result.projectiles!.heads],
          statistics: [...result.projectiles!.statistics] };
        rngCursor = result.rngCursor; task6Budget = result.task6Budget;
        assert.deepEqual(result.randomAdvances, visit.randomWrites, label);
        assert.deepEqual(result.groundWrites, visit.groundWrites, label);
        assert.deepEqual(result.raw, [...expected.actors.subarray(slot * 220, (slot + 1) * 220)], label);
        if (result.spawns.length) launches.push(visit.counter);
        if (decodeLegacyAiTaskStack(result.raw).map(span => span.task).join().startsWith("1,4")) turns.push(visit.counter);
        if (input.raw[0xc7] && !result.raw[0xc7]) reactions.push(visit.counter);
      }
      assert.equal(digest(actors), visit.hashes.actors, `${label} all800 actors`);
      assert.equal(digest(Buffer.from(projectiles.records)), visit.hashes.records, `${label} all2024 projectiles`);
      assert.equal(digest(encodeWords(ground)), visit.hashes.ground, `${label} ground`);
      for (const name of ["air", "extra", "registry"]) {
        assert.equal(visit.changes[name].length, 0, `${label} ${name} unchanged`);
        assert.equal(digest(expected[name]), visit.hashes[name], label);
      }
      assert.equal(rngCursor, visit.rngCursor, label);
      assert.equal(task6Budget, visit.task6Budget, label);
      assert.equal(projectiles.highWater, visit.highWater, label);
      assert.deepEqual(projectiles.heads, visit.heads, label);
      assert.deepEqual(projectiles.statistics, visit.statistics, label);
      for (const [index, slot] of initial.slots.entries()) {
        const health = actors.readInt32LE(slot * 220 + 12);
        assert.ok(health > 0 && health <= beforeHealth[index], `${label} nonlethal`);
        if (actors[slot * 220 + 0xc8]) assert.deepEqual([...actors.subarray(slot * 220 + 0xc8, slot * 220 + 0xca)], [1, 1]);
      }
    }
    assert.equal(launches[0], 25);
    assert.equal(hits[0], 26);
    assert.ok(launches.length > 5 && hits.length > 5, "genuine repeated fire, not a one-hit fixture");
    if (visits.at(-1)!.counter >= 400) assert.ok(turns.length > 0, "source type8 idle-turn-wait returns");
    assert.ok(reactions.length > 1, "source six-bank damage reaction continues");
    assert.ok(visits.some(visit => visit.counter === 32 && visit.scans.some(scan => scan.radius === 16 && scan.maxIndex === 813)));
    for (let slot = 0; slot < 800; slot++) if (!initial.slots.includes(slot)) {
      assert.deepEqual(actors.subarray(slot * 220, (slot + 1) * 220), startActors.subarray(slot * 220, (slot + 1) * 220),
        `original actor ${slot} remains unchanged and present`);
    }
    context.diagnostic(JSON.stringify({ mission: initial.mission, launches, hits, turns, reactions,
      finalHealth: initial.slots.map(slot => actors.readInt32LE(slot * 220 + 12)) }));
  });

  if (initial.mission === "ALIEN02") test("ALIEN authenticated counter32 uses exactly the native 814-point scan prefix", async () => {
    const fixture = await createNativeCombatAlienFixture();
    const scanOffsets = fixture.options.nativeCombat.scanOffsets;
    assert.equal(scanOffsets.length, 814);
    assert.deepEqual(scanOffsets, initial.world.combat!.scanOffsets);
    assert.deepEqual(scanOffsets.at(-1), [99, 99]);
    assert.equal(scanOffsets.filter(point => point[0] === 99).length, 17);
    const scan = frameBefore(visit => visit.counter === 32 && visit.slot === initial.slots[0]);
    const input = { ...scan, world: { ...scan.world, combat: { ...scan.world.combat!, scanOffsets } } };
    const before = structuredClone(input);
    assert.deepEqual(reduceLegacyAiRegisteredVisit(input), reduceLegacyAiRegisteredVisit(scan));
    assert.ok(reduceLegacyAiRegisteredVisit(input).supported);
    assert.deepEqual(input, before);
    const world = { ...input.world, ...input.world.combat };
    const complete = acquireLegacySourceCombatTarget(input.slot, input.raw, world, 16);
    assert.ok(complete.supported);
    assert.equal(complete.target, -1);
    assert.deepEqual(acquireLegacySourceCombatTarget(input.slot, input.raw,
      { ...world, scanOffsets: [...scanOffsets, [Infinity]] }, 16), complete, "nothing after the required sentinel is read");
    assert.deepEqual(acquireLegacySourceCombatTarget(input.slot, input.raw, world, 17),
      { supported: false, diagnostic: "incomplete-source-scan-offsets" });
    const armed = frameBefore(visit => visit.counter === 32 && visit.slot === initial.slots[1]);
    const armedWorld = { ...armed.world, ...armed.world.combat!, scanOffsets: scanOffsets.slice(0, 74) };
    const acquired = acquireLegacySourceCombatTarget(armed.slot, armed.raw, armedWorld, 4);
    assert.ok(acquired.supported);
    assert.equal(acquired.target, initial.slots[0]);
    assert.deepEqual(acquireLegacySourceCombatTarget(armed.slot, armed.raw,
      { ...armedWorld, scanOffsets: scanOffsets.slice(0, 73) }, 4),
    { supported: false, diagnostic: "incomplete-source-scan-offsets" }, "finding a target does not replace the final required sentinel");
    for (const length of [809, 813]) {
      const incomplete = { ...input, world: { ...input.world, combat: { ...input.world.combat!,
        scanOffsets: scanOffsets.slice(0, length) } } };
      const before = structuredClone(incomplete);
      assert.deepEqual(reduceLegacyAiRegisteredVisit(incomplete),
        { supported: false, diagnostic: "incomplete-source-scan-offsets" });
      assert.deepEqual(incomplete, before);
    }
  });

  test(`fresh ${initial.mission} type8 source scan and damaged-state guards remain atomic`, () => {
    const scan = frameBefore(visit => visit.counter === 32 && visit.slot === initial.slots[0]);
    assert.ok(scan.raw[0xc8] && scan.raw[0xc9], "guard starts from actual projectile damage");
    assert.ok(reduceLegacyAiRegisteredVisit(scan).supported);
    const reject = (input: LegacyAiRegisteredFrame, diagnostic: string) => {
      const before = structuredClone(input);
      assert.deepEqual(reduceLegacyAiRegisteredVisit(input), { supported: false, diagnostic });
      assert.deepEqual(input, before, "rejection leaves all caller buffers intact");
    };
    reject({ ...scan, world: { ...scan.world, combat: { ...scan.world.combat!,
      scanOffsets: scan.world.combat!.scanOffsets.slice(0, 809) } } }, "incomplete-source-scan-offsets");
    reject({ ...scan, world: { ...scan.world, combat: { ...scan.world.combat!,
      scanOffsets: scan.world.combat!.scanOffsets.slice(0, 813) } } }, "incomplete-source-scan-offsets");
    const turning = frameBefore((_visit, raw) => decodeLegacyAiTaskStack(raw).map(span => span.task).join() === "1,4,3");
    assert.ok(reduceLegacyAiRegisteredVisit(turning).supported);
    const putWord = (offset: number, value: number) => {
      const raw = Buffer.from(turning.raw); raw.writeUInt16LE(value, offset); return [...raw];
    };
    for (const [offset, value] of [[0x46, 0], [0x48, 0], [0x4a, 4], [0x4c, 256], [0x4e, 46], [0x50, 1]]) {
      reject({ ...turning, raw: putWord(offset, value) }, "unowned-native-idle-turn-payload");
    }
    const typeBytes = Buffer.from(turning.world.typeBytes), typeTable = Buffer.from(turning.world.combat!.typeTable);
    typeBytes.writeInt32LE(1, 0xdc); typeTable.set(typeBytes, 8 * 280);
    reject({ ...turning, world: { ...turning.world, typeBytes: [...typeBytes],
      combat: { ...turning.world.combat!, typeTable: [...typeTable] } } }, "unowned-native-idle-turn-payload");
    for (const offset of [0xc8, 0xc9]) {
      const raw = [...turning.raw]; raw[offset] = 0;
      reject({ ...turning, raw }, "unowned-native-damage-feedback");
    }
    const lethal = Buffer.from(turning.raw); lethal.writeInt32LE(0, 12);
    reject({ ...turning, raw: [...lethal] }, "unowned-native-auxiliary-work");
    const missingFin = { ...turning.world.fin };
    delete missingFin[Buffer.from(turning.world.typeBytes).readUInt32LE(0xbc)];
    reject({ ...turning, world: { ...turning.world, fin: missingFin } }, "invalid-source-fin-profile");
    const before = structuredClone(turning), stale = [...turning.raw]; stale[0xc7] ^= 1;
    assert.deepEqual(stageLegacyAiTaskPendingVisit(turning, { slot: turning.slot, team: turning.raw[7],
      expectedRaw: stale, pendingNativeTask: false }), { supported: false, diagnostic: "native-pending-entity-owner-mismatch" });
    assert.deepEqual(turning, before);
  });
}
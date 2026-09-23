import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodeLegacyAiTaskStack, reduceLegacyAiRegisteredVisit, type LegacyAiRegisteredFrame,
  type LegacyAiRegisteredWorld } from "../../src/engine/legacy-ai-task";
import { reduceLegacyNativeProjectiles, type LegacyNativeProjectileFrame } from "../../src/engine/legacy-native-projectiles";
import { nativeProofTrace } from "./fixtures/native-proof-trace";

interface Metadata {
  rngCursor: number; task6Budget: number; highWater: number; heads: [number, number]; statistics: number[];
}
interface Visit extends Metadata {
  counter: number; slot: number | null; changes: Record<string, [number, number][]>;
  hashes?: Record<string, string>; groundWrites?: unknown[]; randomWrites: number[];
  entries?: { entry: string; edx: number }[];
  scans?: { slot: number; radius: number; maxIndex: number; target: number }[];
}
interface Initial extends Metadata {
  mission: string; binarySha256: string; originalSlots: number[]; slots: number[]; policy: number;
  originalActors: string; profiles: Record<number, LegacyAiRegisteredWorld>; world: LegacyAiRegisteredWorld;
  projectileFin: LegacyNativeProjectileFrame["tables"]["fin"]; buffers: Record<string, string>;
  prefix: Metadata & { buffers: Record<string, string>; visits: Visit[] };
}
const path = nativeProofTrace(process.env.DC_NATIVE_TYPE2_ORIGINAL_TRACE,
  "native-type8-continuation-native.py", ["--owned-originals", "--limit", "400"]);
const [initial, ...visits] = readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line)) as [Initial, ...Visit[]];
const words = (bytes: Buffer) => Array.from({ length: bytes.length / 4 }, (_, index) => bytes.readUInt32LE(index * 4));
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const boundaries: LegacyAiRegisteredFrame[] = [];

test("original ALIEN02 type2 all-owned native idle replay", context => {
  assert.equal(initial.mission, "ALIEN02");
  assert.equal(initial.binarySha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  assert.ok(initial.originalSlots.includes(181));
  const original = Buffer.from(initial.originalActors, "base64").subarray(181 * 220, 182 * 220);
  assert.equal(original[6], 2);
  assert.equal(original[0x36], 0);
  assert.equal(initial.profiles[181].nativeFire, undefined);
  let runtimeBoundary: { counter: number; slot: number; diagnostic: string; scans: Visit["scans"] } | undefined;
  const replay = (start: Metadata & { buffers: Record<string, string> }, phases: Visit[], previousCounter: number) => {
    const expected = Object.fromEntries(Object.entries(start.buffers).map(([name, value]) => [name, Buffer.from(value, "base64")]));
    let actors = Buffer.from(expected.actors), ground = words(expected.ground);
    let projectiles = { records: [...expected.records], highWater: start.highWater, heads: start.heads, statistics: start.statistics };
    let rngCursor = start.rngCursor, task6Budget = start.task6Budget;
    for (const visit of phases) {
      if (visit.counter !== previousCounter) { task6Budget = 0; previousCounter = visit.counter; }
      const label = `counter ${visit.counter} slot ${visit.slot}`;
      for (const [name, changes] of Object.entries(visit.changes)) for (const [offset, value] of changes) expected[name][offset] = value;
      if (visit.slot === null) {
        const combat = initial.world.combat!;
        const result = reduceLegacyNativeProjectiles({ phase: "after-actor-visits", actors: [...actors], projectiles, rngCursor,
          world: { ...initial.world, ground, relations: combat.relations, policy: initial.policy },
          tables: { typeTable: combat.typeTable, weapons: initial.world.weapons, damageTable: combat.damageTable,
            boom: initial.world.nativeFire!.spread, randomTable: initial.world.randomTable, fin: initial.projectileFin } });
        assert.ok(result.supported, `${label}: ${JSON.stringify(result)}`);
        actors = Buffer.from(result.actors); rngCursor = result.rngCursor;
        projectiles = { ...result.projectiles, records: [...result.projectiles.records], heads: [...result.projectiles.heads], statistics: [...result.projectiles.statistics] };
        assert.deepEqual(result.randomAdvances, visit.randomWrites, label);
      } else {
        const slot = visit.slot, profile = initial.profiles[slot];
        const actorMap = Object.fromEntries(Array.from({ length: 800 }, (_, index) => [index, [...actors.subarray(index * 220, (index + 1) * 220)]]));
        const input: LegacyAiRegisteredFrame = { slot, raw: actorMap[slot], counter: visit.counter, rngCursor, task6Budget, projectiles,
          world: { ...profile, ground, combat: { ...initial.world.combat!, actors: actorMap } } };
        if (slot === 181 && visit.counter >= 145 && visit.counter <= 150) boundaries.push(structuredClone(input));
        const result = reduceLegacyAiRegisteredVisit(input);
        assert.ok(result.supported, `${label}: ${JSON.stringify(result)} input=${JSON.stringify(decodeLegacyAiTaskStack(input.raw))}`);
        if (profile.typeId !== 8 && !runtimeBoundary) {
          const runtimeInput = { ...input, world: { ...input.world, combat: undefined, nativeFire: undefined } };
          const before = structuredClone(runtimeInput), runtimeResult = reduceLegacyAiRegisteredVisit(runtimeInput);
          assert.deepEqual(runtimeInput, before);
          if (!runtimeResult.supported) runtimeBoundary = { counter: visit.counter, slot,
            diagnostic: runtimeResult.diagnostic, scans: visit.scans };
          else assert.deepEqual(runtimeResult, result, `${label} runtime passive profile agrees until explicit guard`);
        }
        actors.set(result.raw, slot * 220); ground = [...result.ground]; rngCursor = result.rngCursor; task6Budget = result.task6Budget;
        projectiles = { ...result.projectiles!, records: [...result.projectiles!.records], heads: [...result.projectiles!.heads], statistics: [...result.projectiles!.statistics] };
        assert.deepEqual(result.randomAdvances, visit.randomWrites, label);
        if (visit.groundWrites) assert.deepEqual(result.groundWrites, visit.groundWrites, label);
        if (initial.originalSlots.includes(slot)) assert.equal(input.raw[0x36], 0, `${label} no issued original order`);
      }
      assert.deepEqual(actors, expected.actors, `${label} all800 raw220`);
      assert.deepEqual(ground, words(expected.ground), `${label} ground`);
      assert.deepEqual(Buffer.from(projectiles.records), expected.records, `${label} pool`);
      assert.deepEqual([rngCursor, task6Budget, projectiles.highWater, projectiles.heads, projectiles.statistics],
        [visit.rngCursor, visit.task6Budget, visit.highWater, visit.heads, visit.statistics], label);
      for (const name of ["air", "extra", "registry"]) assert.equal(visit.changes[name].length, 0, `${label} ${name}`);
      if (visit.hashes) for (const name of Object.keys(expected)) assert.equal(digest(expected[name]), visit.hashes[name], `${label} ${name} hash`);
    }
    return { actors, rngCursor };
  };
  const prefix = replay(initial.prefix, initial.prefix.visits, 0);
  assert.equal(initial.prefix.visits.length, initial.originalSlots.length * 16);
  const allocated = Buffer.from(initial.buffers.actors, "base64");
  for (const slot of initial.originalSlots) assert.deepEqual(prefix.actors.subarray(slot * 220, (slot + 1) * 220),
    allocated.subarray(slot * 220, (slot + 1) * 220), `original ${slot} prefix is not rebased`);
  assert.equal(prefix.rngCursor, initial.rngCursor, "allocation and receipts preserve shared RNG continuity");
  replay(initial, visits, 16);
  assert.ok(visits.at(-1)!.counter >= 400);
  assert.deepEqual(boundaries.map(frame => frame.counter), [145, 146, 147, 148, 149, 150]);
  const turning = boundaries.find(frame => frame.counter === 147)!;
  assert.deepEqual(decodeLegacyAiTaskStack(turning.raw).map(span => [span.task, ...span.words]),
    [[1, 65535, 800, 3], [4, 96], [3, 45, 800]]);
  const reject = (input: LegacyAiRegisteredFrame, diagnostic: string) => {
    const before = structuredClone(input);
    assert.deepEqual(reduceLegacyAiRegisteredVisit(input), { supported: false, diagnostic });
    assert.deepEqual(input, before, "failed admission is atomic");
  };
  for (const [offset, value] of [[0x46, 0], [0x48, 0], [0x4a, 4], [0x4c, 256], [0x4e, 46], [0x50, 1]]) {
    const raw = Buffer.from(turning.raw); raw.writeUInt16LE(value, offset);
    reject({ ...turning, raw: [...raw] }, "unowned-native-idle-turn-payload");
  }
  for (const typeId of [3, 69, 73]) {
    const raw = [...turning.raw]; raw[6] = typeId;
    const typeTable = [...turning.world.combat!.typeTable]; typeTable.splice(typeId * 280, 280, ...turning.world.typeBytes);
    reject({ ...turning, raw, world: { ...turning.world, typeId,
      combat: { ...turning.world.combat!, typeTable } } }, "unowned-native-idle-turn-payload");
  }
  const typeBytes = Buffer.from(turning.world.typeBytes); typeBytes.writeInt32LE(1, 0xdc);
  const typeTable = [...turning.world.combat!.typeTable]; typeTable.splice(2 * 280, 280, ...typeBytes);
  reject({ ...turning, world: { ...turning.world, typeBytes: [...typeBytes],
    combat: { ...turning.world.combat!, typeTable } } }, "unowned-native-idle-turn-payload");
  for (const offset of [0x10, 0xcb]) {
    const raw = [...turning.raw]; raw[offset] = 1;
    reject({ ...turning, raw }, "unowned-native-auxiliary-work");
  }
  const damaged = [...turning.raw]; damaged[0xc8] = 1; damaged[0xc9] = 1;
  reject({ ...turning, raw: damaged }, "unowned-native-damage-feedback");
  const idle = boundaries.find(frame => frame.counter === 146)!;
  const profile = Buffer.from(idle.world.typeBytes), weapon = profile.readInt32LE(0x18 + profile[0x30 + idle.raw[7]] * 4);
  assert.equal(runtimeBoundary, undefined, "current passive runtime profile matches all native originals through400");
  assert.equal(weapon, 7);
  const source146 = visits.find(visit => visit.slot === 181 && visit.counter === 146)!;
  assert.deepEqual(source146.randomWrites, [181, 182]);
  assert.deepEqual(source146.scans!.map(scan => [scan.radius, scan.target]), [[2, -1], [16, -1]]);
  assert.ok(!visits.some(visit => visit.slot === 181 && visit.entries!.some(entry =>
    ["0x414ce4", "0x44492c", "0x441710"].includes(entry.entry))), "original181 never routes or fires through400");
  for (const distance of [1, 5]) {
    const targetSlot = initial.slots[1], target = Buffer.from(idle.world.combat!.actors[targetSlot]);
    const column = (idle.raw[0] | idle.raw[1] << 8) >> 8, row = (idle.raw[4] | idle.raw[5] << 8) >> 8;
    target.writeUInt16LE((column + distance) * 256 + 128, 0); target.writeUInt16LE(row * 256 + 128, 4);
    target[7] = 0;
    const ground = [...idle.world.ground]; ground[row * idle.world.width + column + distance] = (targetSlot | idle.world.enemyMask) >>> 0;
    const relations = [...idle.world.combat!.relations]; relations[idle.raw[7] * 10] = 0;
    const control: LegacyAiRegisteredFrame = { ...idle, world: { ...idle.world, ground, combat: {
      ...idle.world.combat!, relations, actors: { ...idle.world.combat!.actors, [targetSlot]: [...target] } } } };
    const before = structuredClone(control), result = reduceLegacyAiRegisteredVisit(control);
    assert.ok(!result.supported, "synthetic negative target must not admit new combat owners");
    assert.equal(result.diagnostic, distance === 1 ? "native-fire-owner-required" : "native-acquisition-path-owner-required");
    assert.equal(result.combatHandoff!.target, targetSlot);
    assert.deepEqual(control, before, "synthetic combat rejection preserves caller state");
  }
  context.diagnostic(JSON.stringify({ originals: initial.originalSlots, through: visits.at(-1)!.counter,
    runtimeBoundary,
    original181: { team: original[7], x: original.readUInt16LE(0), y: original.readUInt16LE(4), weapon,
      range: Buffer.from(idle.world.weapons).readInt32LE(weapon * 72 + 20), teamControl: idle.world.teamControl },
    boundaries: boundaries.map(frame => ({ counter: frame.counter, rng: frame.rngCursor, stack: decodeLegacyAiTaskStack(frame.raw) })) }));
});
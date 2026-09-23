import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CampaignSession } from "../../src/engine/campaign-session";
import { decodeLegacyAiTaskStack, reduceLegacyAiRegisteredVisit,
  type LegacyAiRegisteredWorld } from "../../src/engine/legacy-ai-task";
import { createSourceNativeCombatOwner, sourceNativeCombatVisitWorld,
  stepSourceNativeCombatProjectiles } from "../../src/engine/source-native-combat-host";
import { sourceNativeCombatBankFields } from "../../src/engine/source-native-combat-options";
import { sourceNativeCombatActorSample } from "../../src/engine/source-native-combat-mission";
import { transportHostState } from "../../src/engine/transport-host";
import { createNativeCombatAlienFixture } from "./fixtures/native-combat-alien";
import { nativeType8ContinuationTraces } from "./fixtures/native-proof-trace";

interface Metadata {
  rngCursor: number; task6Budget: number; highWater: number; heads: [number, number]; statistics: number[];
}
interface Initial extends Metadata {
  kind: "initial"; mission: string; slots: number[]; binarySha256: string; policy: number;
  world: LegacyAiRegisteredWorld; profiles: Record<number, LegacyAiRegisteredWorld>;
  buffers: Record<string, string>;
}
interface Visit extends Metadata {
  kind: "visit"; counter: number; slot: number | null;
  changes: Record<string, [number, number][]>;
  groundWrites: unknown[]; randomWrites: number[];
}

test("ALIEN authenticated host replays the native two-actor schedule through400 without rebasing", async context => {
  const path = nativeType8ContinuationTraces().find(path =>
    JSON.parse(readFileSync(path, "utf8").split("\n")[0]).mission === "ALIEN02");
  assert.ok(path, "the native continuation evidence must include ALIEN02");
  const [initial, ...visits] = readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line)) as [Initial, ...Visit[]];
  assert.equal(initial.kind, "initial");
  assert.equal(initial.binarySha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  assert.equal(initial.policy, 1);
  assert.equal(visits.at(-1)!.counter, 400);
  assert.equal(visits.length, 1152);
  const fixture = await createNativeCombatAlienFixture();
  const { nativeCombat, nativeAiTasks } = fixture.options;
  assert.deepEqual(nativeCombat.scanOffsets, initial.world.combat!.scanOffsets);
  const sourceType = Buffer.from(initial.profiles[initial.slots[0]].typeBytes);
  const banks = new Map(sourceNativeCombatBankFields(8).map(field => [sourceType.readUInt32LE(field.offset), field.id]));
  const nativeTravel = Buffer.from(initial.world.weapons).readUInt32LE(15 * 72 + 44);
  const relocateActors = (bytes: Buffer) => {
    const result = Buffer.from(bytes);
    for (const slot of initial.slots) for (const offset of [0x14, 0x1c, 0x24]) {
      const address = slot * 220 + offset, bank = result.readUInt32LE(address);
      const mapped = banks.get(bank);
      if (mapped !== undefined) result.writeUInt32LE(mapped, address);
    }
    return result;
  };
  const relocateRecords = (bytes: Buffer, highWater: number) => {
    const result = Buffer.from(bytes);
    for (let slot = 0; slot < highWater; slot++) if (result.readUInt32LE(slot * 40 + 32) === nativeTravel)
      result.writeUInt32LE(0x2000f, slot * 40 + 32);
    return [...result];
  };
  const words = (bytes: Buffer) => Array.from({ length: bytes.length / 4 }, (_, index) => bytes.readUInt32LE(index * 4));
  const expected = Object.fromEntries(Object.entries(initial.buffers).map(([name, value]) => [name, Buffer.from(value, "base64")]));
  const originalActors = relocateActors(expected.actors);
  const template = transportHostState(new CampaignSession(fixture.options).snapshot.world).slots.find(actor => actor?.unitType === 8 && actor.nativeAiTask)!;
  const owner = createSourceNativeCombatOwner(nativeCombat);
  owner.projectiles = { records: relocateRecords(expected.records, initial.highWater), highWater: initial.highWater,
    heads: [...initial.heads], statistics: [...initial.statistics] };
  let actors = Buffer.from(originalActors), ground = words(expected.ground), rngCursor = initial.rngCursor;
  let task6Budget = initial.task6Budget, previousCounter = 16;
  const profiles = nativeAiTasks.profiles.filter(profile => profile.typeId === 8);
  const launches: number[] = [], hits: number[] = [], turns: number[] = [], samples200: unknown[] = [];
  for (const visit of visits) {
    if (visit.counter !== previousCounter) { previousCounter = visit.counter; task6Budget = 0; }
    for (const [name, changes] of Object.entries(visit.changes)) for (const [index, value] of changes) expected[name][index] = value;
    const label = `counter${visit.counter} slot${visit.slot}`;
    if (visit.slot === null) {
      const result = stepSourceNativeCombatProjectiles(owner, actors, profiles[0], ground, rngCursor, visit.counter);
      actors = Buffer.from(result.actors);
      owner.projectiles = result.projectiles;
      rngCursor = result.rngCursor;
      assert.deepEqual(result.randomAdvances, visit.randomWrites, label);
      if (result.impacts.length) hits.push(visit.counter);
    } else {
      const slot = visit.slot, raw = [...actors.subarray(slot * 220, (slot + 1) * 220)], profile = profiles[raw[7]];
      const world = sourceNativeCombatVisitWorld(nativeCombat, profile, actors, ground);
      const result = reduceLegacyAiRegisteredVisit({ slot, raw, world, counter: visit.counter,
        projectiles: owner.projectiles, rngCursor, task6Budget });
      assert.ok(result.supported, `${label}: ${JSON.stringify(result)}`);
      actors.set(result.raw, slot * 220);
      ground = [...result.ground];
      owner.projectiles = result.projectiles!;
      rngCursor = result.rngCursor; task6Budget = result.task6Budget;
      assert.deepEqual(result.randomAdvances, visit.randomWrites, label);
      assert.deepEqual(result.groundWrites, visit.groundWrites, label);
      if (result.spawns.length) launches.push(visit.counter);
      if (decodeLegacyAiTaskStack(result.raw).map(span => span.task).join().startsWith("1,4")) turns.push(visit.counter);
      const sample = sourceNativeCombatActorSample(fixture.animation, { ...template, slot, team: raw[7],
        nativeAiTask: { ...template.nativeAiTask!, raw: [...result.raw] } }, profile, "GRAY");
      if (visit.counter === 200) samples200.push({ slot, primary: sample.primary.state, secondary: sample.secondary?.state });
    }
    assert.deepEqual(actors, relocateActors(expected.actors), `${label} all800 raw actors`);
    assert.deepEqual(owner.projectiles.records, relocateRecords(expected.records, visit.highWater), `${label} all2024 projectile records`);
    assert.deepEqual(ground, words(expected.ground), `${label} ground`);
    assert.equal(rngCursor, visit.rngCursor, label);
    assert.equal(task6Budget, visit.task6Budget, label);
    assert.equal(owner.projectiles.highWater, visit.highWater, label);
    assert.deepEqual(owner.projectiles.heads, visit.heads, label);
    assert.deepEqual(owner.projectiles.statistics, visit.statistics, label);
    for (const name of ["air", "extra", "registry"]) assert.equal(visit.changes[name].length, 0, `${label} unchanged ${name}`);
  }
  assert.deepEqual(launches, Array.from({ length: 23 }, (_, index) => 25 + index * 17));
  assert.deepEqual(hits, [26, ...launches.slice(1)]);
  assert.ok(turns.includes(367));
  assert.equal(actors.readInt32LE(initial.slots[0] * 220 + 12), 225);
  for (let slot = 0; slot < 800; slot++) if (!initial.slots.includes(slot))
    assert.deepEqual(actors.subarray(slot * 220, (slot + 1) * 220), originalActors.subarray(slot * 220, (slot + 1) * 220));
  let lethalCounter = 0;
  const continuedHits: number[] = [];
  for (let counter = 401; counter <= 552; counter++) {
    let budget = 0;
    for (const slot of initial.slots) {
      const raw = [...actors.subarray(slot * 220, (slot + 1) * 220)], profile = profiles[raw[7]];
      const result = reduceLegacyAiRegisteredVisit({ slot, raw, counter, task6Budget: budget, rngCursor,
        projectiles: owner.projectiles, world: sourceNativeCombatVisitWorld(nativeCombat, profile, actors, ground) });
      assert.ok(result.supported, `continued counter${counter} slot${slot}: ${JSON.stringify(result)}`);
      actors.set(result.raw, slot * 220);
      ground = [...result.ground];
      owner.projectiles = result.projectiles!;
      rngCursor = result.rngCursor; budget = result.task6Budget;
    }
    const beforeOwner = structuredClone(owner), beforeActors = Buffer.from(actors), beforeGround = [...ground];
    if (counter === 552) {
      assert.equal(actors.readInt32LE(initial.slots[0] * 220 + 12), 25);
      assert.throws(() => stepSourceNativeCombatProjectiles(owner, actors, profiles[0], ground, rngCursor, counter),
        /native-projectile-death-owner-required/);
      assert.deepEqual(owner, beforeOwner);
      assert.deepEqual(actors, beforeActors);
      assert.deepEqual(ground, beforeGround);
      lethalCounter = counter;
      break;
    }
    const result = stepSourceNativeCombatProjectiles(owner, actors, profiles[0], ground, rngCursor, counter);
    actors = Buffer.from(result.actors);
    owner.projectiles = result.projectiles;
    rngCursor = result.rngCursor;
    if (result.impacts.length) continuedHits.push(counter);
    if (counter === 416) assert.equal(actors.readInt32LE(initial.slots[0] * 220 + 12), 200);
  }
  assert.deepEqual(continuedHits, Array.from({ length: 8 }, (_, index) => 416 + index * 17));
  assert.equal(lethalCounter, 552);
  context.diagnostic(JSON.stringify({ phases: visits.length, launches, hits, turns, samples200, hp400: 225,
    continuedHits, lethalCounter,
    boundary: "native source-separated two-actor input; not a full CampaignSession checkpoint" }));
});
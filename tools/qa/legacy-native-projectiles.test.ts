import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { reduceLegacyAiRegisteredVisit, type LegacyAiRegisteredWorld } from "../../src/engine/legacy-ai-task";
import { reduceLegacyNativeProjectiles, type LegacyNativeProjectileFrame } from "../../src/engine/legacy-native-projectiles";
import { validLegacyNativeProjectileState } from "../../src/engine/legacy-native-fire";

interface Pool { records: string; highWater: number; heads: [number, number]; statistics: number[] }
interface Snapshot { projectiles: Pool; actors: string; rngCursor: number; randomWrites: number[] }
interface Evidence {
  fire: { slot: number; received: number[]; world: LegacyAiRegisteredWorld; fin: LegacyAiRegisteredWorld["fin"];
    visits: { before: { projectiles: Pool; rngCursor: number; counter: number; task6Budget: number }; raw: number[] }[] };
  initial: Snapshot; visits: Snapshot[]; policy: number; boom: number[];
  projectileFin?: LegacyNativeProjectileFrame["tables"]["fin"];
  expectedHits?: number; spatialBefore: string; spatialAfter: string;
  projectileGround: number[]; projectileAir: number[];
  projectileFamilies: number[];
  wallInput: { cell: number; raw24: number[] } | null;
  continuation?: { registered: { before: Snapshot; after: Snapshot; counter: number }[]; afterTravel: Snapshot };
  fixture: { shots: number; armorLevel: number | null; airSlot: number | null; airCollision: boolean; distance: number; reuse: boolean; miss: boolean };
}
const trace = process.env.DC_NATIVE_PROJECTILE_TRACE;
const evidence: Evidence[] = (trace ? readFileSync(trace, "utf8") : execFileSync("python3", ["-B",
  fileURLToPath(new URL("native-projectiles-native.py", import.meta.url)), "--suite",
], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
  env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
})).trim().split("\n").map(line => JSON.parse(line));
const pool = (value: Pool) => ({ ...value, records: [...Buffer.from(value.records, "base64")] });
function frame(current: Evidence): LegacyNativeProjectileFrame {
  const world = current.fire.world, combat = world.combat!;
  return { phase: "after-actor-visits", projectiles: pool(current.initial.projectiles),
    actors: [...Buffer.from(current.initial.actors, "base64")], rngCursor: current.initial.rngCursor,
    world: { width: world.width, height: world.height, ground: current.projectileGround, air: current.projectileAir, extra: world.extra,
      families: current.projectileFamilies, relations: combat.relations, policy: current.policy },
    tables: { typeTable: combat.typeTable, weapons: world.weapons, damageTable: combat.damageTable,
      boom: current.boom, randomTable: world.randomTable, fin: current.projectileFin ?? {} } };
}
test("poisoned source reuse fixtures retain all bytes and all three allocated slots", () => {
  const reused = evidence.filter(current => current.fixture.reuse);
  assert.equal(reused.length, 12);
  const expected = Buffer.alloc(2024 * 40, 0xa5);
  expected.writeInt16LE(2, 20);
  expected.writeInt16LE(-1, 60);
  expected.writeInt16LE(1, 100);
  for (const current of reused) {
    const initial = pool(current.fire.visits[0].before.projectiles);
    assert.equal(initial.highWater, 3);
    assert.deepEqual(initial.heads, [0, -1]);
    assert.deepEqual(Buffer.from(initial.records), expected);
    assert.equal(validLegacyNativeProjectileState(initial), true);
    for (const snapshot of [current.initial, ...current.visits]) {
      assert.equal(snapshot.projectiles.highWater, 3);
      assert.equal(validLegacyNativeProjectileState(pool(snapshot.projectiles)), true);
    }
  }
});

test("TypeScript rejects an orphaned reuse control before projectile dispatch", () => {
  const current = evidence.find(entry => entry.fixture.reuse && entry.fixture.shots === 1)!;
  const input = frame(current);
  const records = Buffer.from(input.projectiles.records);
  records.writeInt16LE(-1, 100);
  records.writeUInt16LE(0xa5a5, 60);
  const invalid = { ...input, projectiles: { ...input.projectiles, records: [...records] } };
  const saved = structuredClone(invalid);
  assert.equal(validLegacyNativeProjectileState(invalid.projectiles), false);
  assert.deepEqual(reduceLegacyNativeProjectiles(invalid), { supported: false, diagnostic: "invalid-native-projectile-pool" });
  assert.deepEqual(invalid, saved);
});

test("allocated projectile slots must remain reachable from exactly one pool list", () => {
  const current = evidence.find(entry => entry.visits.at(-1)!.projectiles.highWater === 1 &&
    entry.visits.at(-1)!.projectiles.heads[1] === -1)!;
  assert.ok(current);
  const reclaimed = pool(current.visits.at(-1)!.projectiles);
  assert.equal(validLegacyNativeProjectileState(reclaimed), true);
  const orphaned = { ...reclaimed, heads: [-1, -1] as [number, number] };
  const before = structuredClone(orphaned);
  assert.equal(validLegacyNativeProjectileState(orphaned), false);
  const result = reduceLegacyNativeProjectiles({ ...frame(current), projectiles: orphaned });
  assert.equal(result.supported, false);
  assert.deepEqual(orphaned, before);
});
for (const [index, current] of evidence.entries()) test(`source fire to native travel damage and pool reclamation ${index}`, () => {
  const fire = current.fire;
  let raw: readonly number[] = fire.received, projectiles = pool(fire.visits[0].before.projectiles);
  let rngCursor = fire.visits[0].before.rngCursor, launches = 0;
  for (const visit of fire.visits) {
    const before = visit.before;
    const launched = reduceLegacyAiRegisteredVisit({ slot: fire.slot, raw, world: { ...fire.world, fin: fire.fin },
      counter: before.counter, task6Budget: before.task6Budget, rngCursor, projectiles });
    assert.ok(launched.supported, JSON.stringify(launched));
    launches += launched.spawns.length;
    assert.deepEqual(launched.raw, visit.raw);
    raw = launched.raw; projectiles = { ...launched.projectiles!, records: [...launched.projectiles!.records],
      heads: [...launched.projectiles!.heads], statistics: [...launched.projectiles!.statistics] }; rngCursor = launched.rngCursor;
  }
  assert.equal(launches, current.fixture.shots);
  assert.deepEqual(projectiles, pool(current.initial.projectiles));
  let input: LegacyNativeProjectileFrame = { ...frame(current), projectiles, rngCursor };
  let hits = 0;
  let totalDamage = 0;
  let sawImpactAnimation = false;
  for (const expected of current.visits) {
    const saved = structuredClone(input), result = reduceLegacyNativeProjectiles(input);
    assert.deepEqual(input, saved);
    if (current.fixture.airSlot !== null && !result.supported) {
      assert.equal(current.fixture.airCollision, true);
      assert.equal(result.diagnostic, "native-projectile-airborne-target-unowned");
      const slot = current.fixture.airSlot, offset = slot * 220;
      const native = Buffer.from(expected.actors, "base64"), previous = Buffer.from(input.actors);
      assert.equal(input.actors[offset + 6], 5);
      assert.ok(previous.readUInt16LE(offset + 2) > 0);
      assert.ok(native.readInt32LE(offset + 12) < previous.readInt32LE(offset + 12), "source actually collided with aircraft");
      assert.ok(input.world.air.some(value => (value & 1023) === slot));
      return;
    }
    assert.ok(result.supported, JSON.stringify(result));
    assert.deepEqual(result.projectiles, pool(expected.projectiles), "all 80960 pool bytes, heads, high-water and statistics");
    assert.deepEqual(result.actors, [...Buffer.from(expected.actors, "base64")], "all 800 raw220 actors");
    assert.equal(result.rngCursor, expected.rngCursor);
    assert.deepEqual(result.randomAdvances, expected.randomWrites);
    hits += result.impacts.length;
    totalDamage += result.impacts.reduce((total, hit) => total + hit.damage, 0);
    const records = new DataView(Uint8Array.from(result.projectiles.records).buffer);
    for (let slot = result.projectiles.heads[1]; slot !== -1; slot = records.getInt16(slot * 40 + 20, true))
      sawImpactAnimation ||= records.getInt16(slot * 40 + 28, true) === 2;
    input = { ...input, projectiles: result.projectiles, actors: result.actors, rngCursor: result.rngCursor };
  }
  assert.equal(hits, current.expectedHits ?? 1);
  assert.equal(current.spatialAfter, current.spatialBefore, "native ground and registered actors untouched by nonlethal projectiles");
  assert.equal(input.projectiles.heads[1], -1);
  const sourceType = raw[6], sourceTeam = raw[7];
  if (!current.fixture.miss && current.fixture.armorLevel === null) {
    const level = fire.world.typeBytes[0x30 + sourceTeam];
    assert.equal(totalDamage, current.fixture.shots * ([69, 73].includes(sourceType) ? 40 : [25, 31, 37][level]));
    assert.equal(sawImpactAnimation, [69, 73].includes(sourceType));
  }
  if (current.fixture.armorLevel !== null) {
    assert.equal(input.tables.typeTable[8 * 280 + 0x38 + 2], current.fixture.armorLevel);
    assert.equal(totalDamage, current.fixture.armorLevel === 1 ? (current.policy === 0 ? 29 : 21) : (current.policy === 0 ? 24 : 18));
  }
  if (current.wallInput) {
    assert.equal(current.wallInput.raw24[12], 0);
    assert.equal(input.world.families[current.wallInput.cell], 0);
    assert.equal(hits, current.fixture.miss ? 0 : 1, "ordinary native shots do not collide with a PTH wall");
  }
  if (current.fixture.airSlot !== null) {
    assert.equal(current.fixture.airCollision, false, "intersecting aircraft must reject before committing damage");
    const offset = current.fixture.airSlot * 220;
    assert.equal(input.actors[offset + 6], 5);
    assert.ok(input.world.air.some(value => (value & 1023) === current.fixture.airSlot));
    assert.deepEqual(input.actors.slice(offset, offset + 220), frame(current).actors.slice(offset, offset + 220));
    assert.equal(hits, 0);
  }
  if (current.continuation) {
    const actors = Object.fromEntries(Array.from({ length: 800 }, (_, slot) => [slot, input.actors.slice(slot * 220, (slot + 1) * 220)]));
    let continuationPool = input.projectiles, continuationRng = input.rngCursor;
    let sourceRaw = input.actors.slice(fire.slot * 220, (fire.slot + 1) * 220);
    for (const visit of current.continuation.registered) {
      const result = reduceLegacyAiRegisteredVisit({ slot: fire.slot, raw: sourceRaw,
        world: { ...fire.world, fin: fire.fin, combat: { ...fire.world.combat!, actors } }, counter: visit.counter,
        task6Budget: 0, rngCursor: continuationRng, projectiles: continuationPool });
      assert.ok(result.supported, JSON.stringify(result));
      assert.deepEqual(result.projectiles, pool(visit.after.projectiles));
      assert.deepEqual(result.raw, [...Buffer.from(visit.after.actors, "base64").subarray(fire.slot * 220, (fire.slot + 1) * 220)]);
      assert.equal(result.rngCursor, visit.after.rngCursor);
      continuationPool = result.projectiles!; continuationRng = result.rngCursor; sourceRaw = result.raw;
    }
    assert.equal(continuationPool.highWater, input.projectiles.highWater, "naturally reclaimed slot reused without allocation");
    assert.equal(continuationPool.heads[1], 0);
    const nextActors = [...input.actors]; nextActors.splice(fire.slot * 220, 220, ...sourceRaw);
    const result = reduceLegacyNativeProjectiles({ ...input, actors: nextActors, projectiles: continuationPool, rngCursor: continuationRng });
    assert.ok(result.supported, JSON.stringify(result));
    assert.deepEqual(result.projectiles, pool(current.continuation.afterTravel.projectiles));
    assert.deepEqual(result.actors, [...Buffer.from(current.continuation.afterTravel.actors, "base64")]);
    assert.equal(result.rngCursor, current.continuation.afterTravel.rngCursor);
  }
});

test("unsupported damage paths reject the entire pass without publishing staged movement or RNG", () => {
  const initial = frame(evidence[0]);
  const first = reduceLegacyNativeProjectiles(initial);
  assert.ok(first.supported && first.impacts.length === 1);
  const target = first.impacts[0].target, damage = first.impacts[0].damage;
  const change = (value: readonly number[], offset: number, replacement: number, width = 1) => {
    const result = Uint8Array.from(value), view = new DataView(result.buffer);
    if (width === 4) view.setInt32(offset, replacement, true);
    else result[offset] = replacement;
    return [...result];
  };
  const weapon = new DataView(Uint8Array.from(initial.projectiles.records).buffer).getInt16(12, true) * 72;
  const source = evidence[0].fire.slot * 220;
  const cases: [LegacyNativeProjectileFrame, string][] = [
    [{ ...initial, actors: change(initial.actors, target * 220 + 12, damage, 4) }, "native-projectile-death-owner-required"],
    [{ ...initial, actors: change(initial.actors, target * 220 + 12, damage - 1, 4) }, "native-projectile-death-owner-required"],
    [{ ...initial, actors: change(initial.actors, source + 0xd6, 1) }, "native-projectile-source-inspire-unowned"],
    [{ ...initial, actors: change(initial.actors, target * 220 + 0x2c, 10) }, "unowned-native-projectile-target-status"],
    [{ ...initial, tables: { ...initial.tables, weapons: change(initial.tables.weapons, weapon + 28, 1, 4) } }, "unowned-native-projectile-profile"],
    [{ ...initial, tables: { ...initial.tables, weapons: change(initial.tables.weapons, weapon + 12, -100, 4) } }, "unowned-native-projectile-profile"],
    [{ ...initial, projectiles: { ...initial.projectiles, heads: [0, 0] } }, "invalid-native-projectile-pool"],
    [{ ...initial, phase: "before-actor-visits" as LegacyNativeProjectileFrame["phase"] }, "native-projectile-caller-phase-required"],
  ];
  for (const [input, diagnostic] of cases) {
    const saved = structuredClone(input);
    assert.deepEqual(reduceLegacyNativeProjectiles(input), { supported: false, diagnostic });
    assert.deepEqual(input, saved);
  }
  const admitted = { ...initial, actors: change(initial.actors, target * 220 + 12, damage + 1, 4) };
  const result = reduceLegacyNativeProjectiles(admitted);
  assert.ok(result.supported);
  assert.equal(result.impacts[0].health, 1);
  assert.equal(result.actors[target * 220 + 0x2c], 1, "no synthetic instant death");
});

test("missing impact FIN rejects after staged damage and RNG without exposing either", () => {
  const current = evidence.find(item => item.fire.received[6] === 69)!;
  let input = frame(current);
  for (const expected of current.visits) {
    const result = reduceLegacyNativeProjectiles(input);
    assert.ok(result.supported);
    if (result.impacts.length) {
      const invalid = { ...input, tables: { ...input.tables, fin: {} } }, saved = structuredClone(invalid);
      assert.deepEqual(reduceLegacyNativeProjectiles(invalid), { supported: false, diagnostic: "native-projectile-fin-required" });
      assert.deepEqual(invalid, saved);
      assert.equal(result.randomAdvances.length, 1);
      return;
    }
    input = { ...input, projectiles: pool(expected.projectiles), actors: [...Buffer.from(expected.actors, "base64")], rngCursor: expected.rngCursor };
  }
  assert.fail("commander must reach the original impact RNG and FIN branch");
});
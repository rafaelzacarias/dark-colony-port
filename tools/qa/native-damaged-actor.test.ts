import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { reduceLegacyAiRegisteredVisit, type LegacyAiRegisteredWorld } from "../../src/engine/legacy-ai-task";
import { applyLegacyAiActorPacket } from "../../src/engine/legacy-ai-policy";
import { reduceLegacyNativeProjectiles, type LegacyNativeProjectileFrame } from "../../src/engine/legacy-native-projectiles";

interface Pool { records: string; highWater: number; heads: [number, number]; statistics: number[] }
interface Snapshot { raw: number[]; actors: string; auxiliarySha256: string; rngCursor: number; task6Budget: number; ground: number[]; projectiles: Pool }
interface Evidence {
  slot: number; world: LegacyAiRegisteredWorld;
  activity?: "moving" | "firing"; distance?: number; sourceWorld?: LegacyAiRegisteredWorld;
  activeReceipt?: { packet: string; before: Snapshot; after: Snapshot };
  repeated: boolean; receipt: { before: number[]; after: number[] } | null;
  warmup: number; registry: number[];
  projectile: {
    fire: { slot: number; world: LegacyAiRegisteredWorld; fin: LegacyAiRegisteredWorld["fin"];
      nearbyEnemy: { enemyRaw: number[] } };
    initial: { actors: string; rngCursor: number; projectiles: Pool };
    visits: { actors: string; rngCursor: number; projectiles: Pool; randomWrites: number[] }[];
    projectileFin: LegacyNativeProjectileFrame["tables"]["fin"]; policy: number; boom: number[];
    projectileGround: number[]; projectileAir: number[]; projectileFamilies: number[];
  };
  visits: { before: Snapshot; after: Snapshot; counter: number; owner: "source" | "target" | "projectile";
    entries: { entry: string; source?: number }[];
    randomWrites: number[]; groundWrites: unknown[] }[];
}
const trace = process.env.DC_NATIVE_DAMAGED_ACTOR_TRACE;
const native = trace ? undefined : spawn("python3", ["-B",
  fileURLToPath(new URL("native-damaged-actor-native.py", import.meta.url)), "--suite"], {
  stdio: ["ignore", "pipe", "inherit"],
  env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
});
const nativeExit = native && new Promise<number | null>((resolve, reject) => {
  native.on("error", reject); native.on("close", resolve);
});
const lines = createInterface({ input: trace ? createReadStream(trace) : native!.stdout!, crlfDelay: Infinity });
let firstEvidence: Evidence | undefined;
let evidenceIndex = 0;
const pool = (value: Pool) => ({ ...value, records: [...Buffer.from(value.records, "base64")] });
const actors = (value: string) => [...Buffer.from(value, "base64")];
function projectileFrame(current: Evidence, state: { actors: readonly number[]; rngCursor: number; projectiles: ReturnType<typeof pool> }, ground = current.projectile.projectileGround): LegacyNativeProjectileFrame {
  const source = current.projectile, world = source.fire.world, combat = world.combat!;
  return { ...state, phase: "after-actor-visits",
    world: { width: world.width, height: world.height, ground, air: source.projectileAir,
      extra: world.extra, families: source.projectileFamilies, relations: combat.relations, policy: source.policy },
    tables: { typeTable: combat.typeTable, weapons: world.weapons, damageTable: combat.damageTable,
      boom: source.boom, randomTable: world.randomTable, fin: source.projectileFin } };
}

for await (const line of lines) {
  if (!line.trim()) continue;
  const current: Evidence = JSON.parse(line), index = evidenceIndex++;
  firstEvidence ??= current;
  await test(`original damaged actor registered continuation ${index} ${current.activity ?? "idle"} ${current.distance ?? ""}`, () => {
  assert.ok(current.registry.includes(current.slot));
  assert.ok(current.registry.includes(current.projectile.fire.slot));
  const nativeInitial = current.activeReceipt?.before ?? current.projectile.initial;
  let state = { actors: actors(nativeInitial.actors), rngCursor: nativeInitial.rngCursor, projectiles: pool(nativeInitial.projectiles) };
  for (const expected of current.activity ? [] : current.projectile.visits) {
    const result = reduceLegacyNativeProjectiles(projectileFrame(current, state));
    assert.ok(result.supported, JSON.stringify(result));
    assert.deepEqual(result.actors, actors(expected.actors));
    assert.deepEqual(result.projectiles, pool(expected.projectiles));
    assert.equal(result.rngCursor, expected.rngCursor);
    assert.deepEqual(result.randomAdvances, expected.randomWrites);
    state = { actors: [...result.actors], rngCursor: result.rngCursor, projectiles: {
      ...result.projectiles, records: [...result.projectiles.records], heads: [...result.projectiles.heads], statistics: [...result.projectiles.statistics] } };
  }
  if (current.activeReceipt) {
    assert.deepEqual(current.activeReceipt.before, { ...current.activeReceipt.after, raw: current.activeReceipt.before.raw,
      actors: current.activeReceipt.before.actors });
    const payload = Buffer.from(current.activeReceipt.packet, "hex"), packet = Buffer.alloc(payload.length + 2);
    packet.writeUInt16LE(packet.length); payload.copy(packet, 2);
    const received = Uint8Array.from(state.actors);
    applyLegacyAiActorPacket(received, packet);
    assert.deepEqual([...received], actors(current.activeReceipt.after.actors));
    state.actors = [...received];
  } else {
  assert.equal(state.actors[current.slot * 220 + 0xc7], 255);
  const damaged = state.actors.slice(current.slot * 220, (current.slot + 1) * 220);
  const constructor = current.projectile.fire.nearbyEnemy.enemyRaw;
  assert.ok(Buffer.from(damaged).readInt32LE(12) > 0);
  assert.ok(Buffer.from(damaged).readInt32LE(12) < Buffer.from(constructor).readInt32LE(12));
  assert.deepEqual(damaged.filter((_, offset) => ![12, 13, 14, 15, 0xc7, 0xc8, 0xc9].includes(offset)),
    constructor.filter((_, offset) => ![12, 13, 14, 15, 0xc7, 0xc8, 0xc9].includes(offset)));
  }
  if (current.receipt) {
    assert.deepEqual(state.actors.slice(current.slot * 220, (current.slot + 1) * 220), current.receipt.before);
    const received = [...current.receipt.before]; received[0x36] = 1; received[0x37] = 13;
    assert.deepEqual(received, current.receipt.after);
    state.actors.splice(current.slot * 220, 220, ...received);
  }
  let ground: readonly number[] = current.world.ground;
  for (const expected of current.visits) {
    assert.equal(expected.before.auxiliarySha256, current.visits[0].before.auxiliarySha256);
    assert.equal(expected.after.auxiliarySha256, expected.before.auxiliarySha256, "air/extra/registry unchanged");
    assert.deepEqual(state.actors, actors(expected.before.actors));
    assert.deepEqual(state.projectiles, pool(expected.before.projectiles));
    assert.equal(state.rngCursor, expected.before.rngCursor);
    assert.deepEqual(ground, expected.before.ground);
    if (expected.owner === "projectile") {
      const result = reduceLegacyNativeProjectiles(projectileFrame(current, state, [...ground]));
      assert.ok(result.supported, JSON.stringify(result));
      assert.deepEqual(result.actors, actors(expected.after.actors));
      assert.deepEqual(result.projectiles, pool(expected.after.projectiles));
      assert.equal(result.rngCursor, expected.after.rngCursor);
      assert.deepEqual(result.randomAdvances, expected.randomWrites);
      assert.deepEqual(expected.after.ground, ground);
      assert.deepEqual(expected.groundWrites, []);
      state = { actors: [...result.actors], rngCursor: result.rngCursor, projectiles: {
        ...result.projectiles, records: [...result.projectiles.records], heads: [...result.projectiles.heads], statistics: [...result.projectiles.statistics] } };
      continue;
    }
    const slot = expected.owner === "target" ? current.slot : current.projectile.fire.slot;
    const world = expected.owner === "target" ? current.world : current.sourceWorld ?? { ...current.projectile.fire.world, fin: current.projectile.fire.fin };
    const actorMap = Object.fromEntries(Array.from({ length: 800 }, (_, actor) => [actor, state.actors.slice(actor * 220, (actor + 1) * 220)]));
    const input = { slot, raw: state.actors.slice(slot * 220, (slot + 1) * 220),
      world: { ...world, ground, combat: { ...world.combat!, actors: actorMap } },
      rngCursor: state.rngCursor, task6Budget: expected.before.task6Budget,
      counter: expected.counter, projectiles: state.projectiles };
    const saved = structuredClone(input);
    const result = reduceLegacyAiRegisteredVisit(input);
    assert.deepEqual(input, saved);
    assert.ok(result.supported, `${expected.owner} counter ${expected.counter}: ${JSON.stringify(result)}`);
    state.actors.splice(slot * 220, 220, ...result.raw);
    assert.deepEqual(state.actors, actors(expected.after.actors), `all raw220 ${expected.owner} counter ${expected.counter}`);
    assert.deepEqual(result.ground, expected.after.ground);
    assert.deepEqual(result.groundWrites, expected.groundWrites);
    assert.deepEqual(result.randomAdvances, expected.randomWrites);
    assert.equal(result.rngCursor, expected.after.rngCursor);
    assert.equal(result.task6Budget, expected.after.task6Budget);
    assert.deepEqual(result.projectiles, pool(expected.after.projectiles));
    state.rngCursor = result.rngCursor;
    state.projectiles = { ...result.projectiles!, records: [...result.projectiles!.records],
      heads: [...result.projectiles!.heads], statistics: [...result.projectiles!.statistics] };
    ground = result.ground;
  }
  const targets = current.visits.filter(visit => visit.owner === "target");
  if (current.activity) {
    const actorRaw = (snapshot: Snapshot, slot = current.slot) => Buffer.from(snapshot.actors, "base64").subarray(slot * 220, (slot + 1) * 220);
    const tasks = (raw: Buffer) => Array.from({ length: raw[0x38] + 1 }, (_, level) => raw[0x39 + level * 2]);
    const hits = current.visits.filter(visit => visit.owner === "projectile"
      && actorRaw(visit.after).readInt32LE(12) < actorRaw(visit.before).readInt32LE(12));
    assert.ok(hits.length > 0, "actual projectile damage to the ordered target");
    assert.ok(hits.every(visit => actorRaw(visit.after).readInt32LE(12) > 0));
    for (let offset = 0; offset < current.visits.length; offset += 3) {
      const round = current.visits.slice(offset, offset + 3);
      assert.deepEqual(round.map(visit => visit.owner), ["target", "source", "projectile"]);
      assert.ok(round.every(visit => visit.counter === round[0].counter));
      assert.equal(round[1].before.task6Budget, round[0].after.task6Budget);
      assert.equal(round[2].before.task6Budget, round[1].after.task6Budget);
    }
    if (current.activity === "moving") {
      assert.ok(hits.some(visit => tasks(actorRaw(visit.before)).at(-1) === 5
        && targets.some(target => target.counter === visit.counter
          && actorRaw(target.before).readUInt16LE(0) !== actorRaw(target.after).readUInt16LE(0))), "impact during actual native displacement");
      assert.ok(targets.some(visit => visit.before.raw[0xc8] === 1
        && actorRaw(visit.before).readUInt16LE(0) !== actorRaw(visit.after).readUInt16LE(0)), "damaged actor continues moving");
    } else {
      assert.ok(hits.some(visit => tasks(actorRaw(visit.before)).includes(11)), "impact during genuine native firing/reload");
      assert.ok(targets.some(visit => visit.before.raw[0xc8] === 1
        && visit.entries.some(entry => entry.entry === "0x441710" && entry.source === current.slot)), "damaged target fires again");
      assert.ok(current.visits.some(visit => visit.owner === "projectile"
        && actorRaw(visit.after, current.projectile.fire.slot).readInt32LE(12)
          < actorRaw(visit.before, current.projectile.fire.slot).readInt32LE(12)), "return fire damages the original shooter");
    }
    for (const visit of current.visits) for (const slot of [current.slot, current.projectile.fire.slot]) {
      assert.ok(actorRaw(visit.after, slot).readInt32LE(12) > 0, "compared schedule ends before lethal damage");
    }
    return;
  }
  assert.ok(targets.some(visit => visit.after.raw[0x22] === 2), "reaction actually completes");
  for (const visit of targets) assert.deepEqual(visit.after.raw.slice(0xc8, 0xca), [1, 1]);
  if (current.warmup === 253) assert.equal(targets[0].randomWrites[0], 0, "reaction wraps the shared RNG cursor");
  if (current.repeated) {
    assert.equal(current.visits.filter(visit => visit.owner === "projectile").length, 3);
    const pending = targets.filter(visit => visit.before.raw[0xc7] && visit.before.raw[0x22] === 1);
    assert.ok(pending.length > 10, "new real hits arrive during a busy reaction");
    assert.ok(pending.every(visit => visit.after.raw[0xc7] === visit.before.raw[0xc7]));
    assert.ok(pending.some(visit => visit.after.raw[0x22] === 2), "pending survives the completion visit");
    assert.equal(targets.filter(visit => visit.before.raw[0xc7] && !visit.after.raw[0xc7]).length, 3);
  }
});
  if (current.activity) await test(`damaged ${current.activity} source omissions and lethal boundaries reject atomically ${index}`, () => {
    const expected = current.visits.find(visit => visit.owner === "target" && visit.before.raw[0xc8] === 1
      && (current.activity === "moving" ? visit.before.raw[0x39 + visit.before.raw[0x38] * 2] === 5
        : visit.entries.some(entry => entry.entry === "0x441710" && entry.source === current.slot)));
    assert.ok(expected, "negative cases start from a genuinely damaged active visit");
    const actorBytes = actors(expected.before.actors);
    const base = { slot: current.slot, raw: expected.before.raw,
      world: { ...current.world, ground: expected.before.ground, combat: { ...current.world.combat!, actors:
        Object.fromEntries(Array.from({ length: 800 }, (_, slot) => [slot, actorBytes.slice(slot * 220, (slot + 1) * 220)])) } },
      counter: expected.counter, rngCursor: expected.before.rngCursor, task6Budget: expected.before.task6Budget,
      projectiles: pool(expected.before.projectiles) };
    assert.ok(reduceLegacyAiRegisteredVisit(base).supported);
    const reactionBank = Buffer.from(base.world.typeBytes).readUInt32LE(0xbc);
    const missingReaction = { ...base.world.fin }; delete missingReaction[reactionBank];
    const invalidDirection = { ...base.world.fin, [reactionBank]: base.world.fin[reactionBank].map((frames, direction) => direction === 31 ? [] : frames) };
    const mismatch = [...base.world.typeBytes]; mismatch[0] ^= 1;
    const cases = [
      { ...base, world: { ...base.world, fin: missingReaction } },
      { ...base, world: { ...base.world, fin: invalidDirection } },
      { ...base, world: { ...base.world, typeBytes: mismatch } },
      ...[0, -1].map(hp => { const raw = Buffer.from(base.raw); raw.writeInt32LE(hp, 12); return { ...base, raw: [...raw] }; }),
    ];
    for (const input of cases) {
      const saved = structuredClone(input), result = reduceLegacyAiRegisteredVisit(input);
      assert.equal(result.supported, false, JSON.stringify(result)); assert.deepEqual(input, saved);
      assert.equal("raw" in result, false); assert.equal("projectiles" in result, false);
    }
    if (current.activity === "firing") {
      for (const world of [{ ...base.world, combat: undefined }, { ...base.world, nativeFire: undefined },
        { ...base.world, nativeFire: { ...base.world.nativeFire!, frames: {} } }]) {
        const input = { ...base, world }, saved = structuredClone(input);
        const result = reduceLegacyAiRegisteredVisit(input);
        assert.equal(result.supported, false, JSON.stringify(result)); assert.deepEqual(input, saved);
        assert.equal("raw" in result, false); assert.equal("projectiles" in result, false);
      }
    }
    const impact = current.visits.find(visit => visit.owner === "projectile"
      && Buffer.from(visit.after.raw).readInt32LE(12) < Buffer.from(visit.before.raw).readInt32LE(12));
    assert.ok(impact);
    const healthy = projectileFrame(current, { actors: actors(impact.before.actors), rngCursor: impact.before.rngCursor,
      projectiles: pool(impact.before.projectiles) }, impact.before.ground);
    assert.ok(reduceLegacyNativeProjectiles(healthy).supported);
    const lethalActors = Buffer.from(healthy.actors); lethalActors.writeInt32LE(1, current.slot * 220 + 12);
    for (const input of [{ ...healthy, actors: [...lethalActors] }, { ...healthy, tables: { ...healthy.tables, weapons: [] } }]) {
      const saved = structuredClone(input), result = reduceLegacyNativeProjectiles(input);
      assert.equal(result.supported, false, "lethal damage or missing projectile source weapons"); assert.deepEqual(input, saved);
      assert.equal("actors" in result, false); assert.equal("projectiles" in result, false);
    }
  });
}
if (nativeExit) assert.equal(await nativeExit, 0, "original native capture exits successfully");

test("damaged actor admission rejects unsupported feedback, death and missing source timelines atomically", () => {
  assert.ok(firstEvidence);
  const current = firstEvidence, before = current.visits[0].before;
  const base = { slot: current.slot, raw: before.raw, world: current.world, counter: current.visits[0].counter,
    rngCursor: before.rngCursor, task6Budget: before.task6Budget, projectiles: pool(before.projectiles) };
  const changed = (offset: number, value: number) => {
    const raw = [...base.raw]; raw[offset] = value;
    return { ...base, raw };
  };
  const cases = [changed(0xc8, 0), changed(0xc9, 2), ...[0xca, 0xcb, 0xcc, 0xcf, 0xd0, 0xd6].map(offset => changed(offset, 1)),
    changed(0x22, 0), changed(0x20, 255), changed(0x2c, 10)];
  for (const hp of [0, -1]) {
    const raw = Buffer.from(base.raw); raw.writeInt32LE(hp, 12);
    cases.push({ ...base, raw: [...raw] });
  }
  for (const type of [2, 3, 69, 73]) {
    const raw = [...base.raw]; raw[6] = type;
    const typeBytes = current.world.combat!.typeTable.slice(type * 280, (type + 1) * 280);
    cases.push({ ...base, raw, world: { ...base.world, typeId: type, typeBytes } });
  }
  const typeBytes = Buffer.from(base.world.typeBytes); typeBytes.writeInt32LE(0, 0xd8);
  const typeTable = [...base.world.combat!.typeTable]; typeTable.splice(base.raw[6] * 280, 280, ...typeBytes);
  cases.push({ ...base, world: { ...base.world, typeBytes: [...typeBytes], combat: { ...base.world.combat!, typeTable } } });
  const fin = { ...base.world.fin };
  delete fin[Buffer.from(base.world.typeBytes).readUInt32LE(0xbc)];
  cases.push({ ...base, world: { ...base.world, fin } });
  const randomTable = [...base.world.randomTable]; randomTable[(base.rngCursor + 1) & 255] = -1;
  cases.push({ ...base, world: { ...base.world, randomTable } });
  for (const input of cases) {
    const saved = structuredClone(input);
    const result = reduceLegacyAiRegisteredVisit(input);
    assert.equal(result.supported, false, JSON.stringify(result));
    assert.deepEqual(input, saved);
  }
});
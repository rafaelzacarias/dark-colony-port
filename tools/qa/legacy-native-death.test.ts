import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { reduceLegacyNativeProjectiles, type LegacyNativeProjectileFrame } from "../../src/engine/legacy-native-projectiles";
import { reduceLegacyNativeDeathVisit, type LegacyNativeDeathState } from "../../src/engine/legacy-native-death";
import { decodeLegacyAiTaskStack, reduceLegacyAiRegisteredVisit, type LegacyAiRegisteredWorld } from "../../src/engine/legacy-ai-task";

interface Snapshot {
  actors: string; game: string; ground: string; air: string; extra: string; typeStatistics: string;
  statistics: number[]; rngCursor: number;
}
interface Visit {
  counter: number; owner: string; health: number; status: number;
  after: Partial<Record<"actors" | "game" | "ground" | "air" | "extra" | "typeStatistics", number[][]>> & { statistics?: number[]; rngCursor?: number };
  entries: { entry: string }[];
  writes: { address: string; value: number }[];
}
interface Evidence {
  binarySha256: string; completed: boolean; runtimeIntercepts: unknown[]; healthRewrites: unknown[];
  before: Snapshot; visits: Visit[]; target: number; source: number; policy: number;
  targetWorld: LegacyAiRegisteredWorld; sourceWorld: LegacyAiRegisteredWorld;
  initial: { boom: number[]; projectileFin: LegacyNativeProjectileFrame["tables"]["fin"] };
}
const trace = process.env.DC_NATIVE_DEATH_TRACE;
const evidence: Evidence = JSON.parse(trace ? readFileSync(trace, "utf8") : execFileSync("python3", ["-B",
  fileURLToPath(new URL("native-death-native.py", import.meta.url)),
], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024,
  env: { ...process.env, PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" } }));
const decode = (text: string) => Buffer.from(text, "base64");
const words = (buffer: Buffer, width: 2 | 4, signed = false) => Array.from({ length: buffer.length / width }, (_, index) =>
  width === 4 ? signed ? buffer.readInt32LE(index * width) : buffer.readUInt32LE(index * width)
    : signed ? buffer.readInt16LE(index * width) : buffer.readUInt16LE(index * width));
function next(before: Snapshot, visit: Visit): Snapshot {
  const after = { ...before };
  for (const key of ["actors", "game", "ground", "air", "extra", "typeStatistics"] as const) {
    if (!visit.after[key]) continue;
    const buffer = decode(before[key]);
    for (const [offset, value] of visit.after[key]!) buffer[offset] = value;
    after[key] = buffer.toString("base64");
  }
  after.rngCursor = visit.after.rngCursor ?? before.rngCursor;
  after.statistics = visit.after.statistics ?? before.statistics;
  return after;
}
function frame(snapshot: Snapshot, counter: number, state?: LegacyNativeDeathState): LegacyNativeProjectileFrame {
  const world = evidence.targetWorld, game = decode(snapshot.game), combat = world.combat!;
  return { phase: "after-actor-visits", actors: [...decode(snapshot.actors)], rngCursor: snapshot.rngCursor,
    projectiles: { records: [...game.subarray(0x32ca8, 0x32ca8 + 2024 * 40)], highWater: game.readInt32LE(0x7d24),
      heads: [game.readInt16LE(0x468e8), game.readInt16LE(0x468ea)], statistics: snapshot.statistics },
    death: { counter, state: state ?? { registry: words(game.subarray(0x468ec, 0x468ec + 1600), 2, true),
      typeStatistics: words(decode(snapshot.typeStatistics), 4, true),
      commanderSlots: Array.from({ length: 8 }, (_, team) => game.readInt16LE(team * 0xe30 + 0x1934)), pending: [] } },
    world: { width: world.width, height: world.height, ground: words(decode(snapshot.ground), 4),
      air: words(decode(snapshot.air), 2), extra: words(decode(snapshot.extra), 2), families: world.families,
      relations: combat.relations, policy: evidence.policy },
    tables: { typeTable: combat.typeTable, weapons: world.weapons, randomTable: world.randomTable,
      damageTable: combat.damageTable, boom: evidence.initial.boom, fin: { ...evidence.initial.projectileFin, ...world.fin } } };
}

function registeredFrame(input: LegacyNativeProjectileFrame, slot: number, world: LegacyAiRegisteredWorld, counter: number, task6Budget = 0) {
  return { slot, raw: input.actors.slice(slot * 220, (slot + 1) * 220), counter,
    rngCursor: input.rngCursor, task6Budget, projectiles: input.projectiles,
    world: { ...world, ground: input.world.ground, air: input.world.air, extra: input.world.extra,
      combat: { ...world.combat!, actors: Object.fromEntries(Array.from({ length: 800 }, (_, actorSlot) =>
        [actorSlot, input.actors.slice(actorSlot * 220, (actorSlot + 1) * 220)])) } } };
}

test("original real shots chain only TypeScript state through lethal impact and all 150 death visits", () => {
  assert.equal(evidence.binarySha256, "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b");
  assert.equal(evidence.completed, true);
  assert.deepEqual(evidence.runtimeIntercepts, []); assert.deepEqual(evidence.healthRewrites, []);
  let oracle = evidence.before, current = frame(evidence.before, evidence.visits[0].counter);
  let deathVisits = 0, lethal = 0, hits = 1, shots = 1, nestedWaits = 0, nestedTurns = 0, task6Budget = 0;
  const damage = evidence.policy === 0 ? 25 : 18;
  assert.equal(Buffer.from(evidence.targetWorld.typeBytes).readInt32LE(0x44), 800);
  assert.equal(Buffer.from(current.actors).readInt32LE(evidence.target * 220 + 12), 800 - damage);
  for (const visit of evidence.visits) {
    const expected = next(oracle, visit);
    if (visit.counter !== current.death!.counter) task6Budget = 0;
    current = { ...current, death: { counter: visit.counter, state: current.death!.state } };
    for (const [offset] of visit.after.game ?? []) {
      assert.ok((offset >= 0x530 && offset < 0x534) || (offset >= 0x7d28 && offset < 0x7d28 + 800 * 220)
        || (offset >= 0x32ca8 && offset < 0x32ca8 + 2024 * 40) || (offset >= 0x468e8 && offset < 0x468ec + 1600),
      `unowned game write ${offset.toString(16)}`);
    }
    let randomAdvances: readonly number[];
    if (visit.owner === "projectile") {
      const result = reduceLegacyNativeProjectiles(current);
      assert.ok(result.supported, `${visit.counter}: ${JSON.stringify(result)}`); assert.ok(result.death);
      const began = result.death.state.pending.length > current.death!.state.pending.length;
      assert.equal(began, visit.entries.some(entry => entry.entry === "0x416308"));
      if (began) {
        lethal++;
        assert.equal(visit.counter, evidence.policy === 0 ? 528 : 749);
        assert.equal(Buffer.from(result.actors).readInt32LE(evidence.target * 220 + 12), evidence.policy === 0 ? 0 : -10);
      }
      hits += result.impacts.length;
      current = { ...current, actors: result.actors, projectiles: result.projectiles, rngCursor: result.rngCursor,
        death: { counter: visit.counter, state: result.death.state }, world: { ...current.world,
          ground: result.death.ground, air: result.death.air, extra: result.death.extra } };
      randomAdvances = result.randomAdvances;
    } else if (visit.owner === "target" && current.death!.state.pending.length) {
      const result = reduceLegacyNativeDeathVisit({ ...current, state: current.death!.state,
        statistics: current.projectiles.statistics, counter: visit.counter, slot: evidence.target });
      assert.ok(result.supported, `${visit.counter}: ${JSON.stringify(result)}`);
      deathVisits++;
      assert.deepEqual(result.removed, deathVisits === 150 ? [evidence.target] : []);
      current = { ...current, actors: result.actors, rngCursor: result.rngCursor,
        projectiles: { ...current.projectiles, statistics: result.statistics },
        death: { counter: visit.counter, state: result.state },
        world: { ...current.world, ground: result.ground, air: result.air, extra: result.extra } };
      randomAdvances = result.randomAdvances;
    } else {
      const slot = visit.owner === "source" ? evidence.source : evidence.target;
      const world = visit.owner === "source" ? evidence.sourceWorld : evidence.targetWorld;
      const input = registeredFrame(current, slot, world, visit.counter, task6Budget);
      const shape = decodeLegacyAiTaskStack(input.raw).map(span => span.task).join();
      if (shape === "1,4,3") nestedWaits++;
      if (shape === "1,4") nestedTurns++;
      const result = reduceLegacyAiRegisteredVisit(input);
      assert.ok(result.supported, `${visit.owner} ${visit.counter}: ${JSON.stringify(result)}`);
      assert.ok(result.projectiles);
      const actors = [...current.actors]; actors.splice(slot * 220, 220, ...result.raw);
      current = { ...current, actors, projectiles: result.projectiles, rngCursor: result.rngCursor,
        world: { ...current.world, ground: result.ground } };
      task6Budget = result.task6Budget;
      shots += result.spawns.length;
      randomAdvances = result.randomAdvances;
    }
    const expectedFrame = frame(expected, visit.counter);
    assert.deepEqual(current.actors, expectedFrame.actors, `${visit.owner} ${visit.counter}: all 800 actors`);
    assert.deepEqual(current.projectiles, expectedFrame.projectiles);
    assert.deepEqual(current.death!.state.registry, expectedFrame.death!.state.registry);
    assert.deepEqual(current.death!.state.typeStatistics, expectedFrame.death!.state.typeStatistics);
    assert.deepEqual(current.death!.state.commanderSlots, expectedFrame.death!.state.commanderSlots);
    assert.deepEqual(current.world, expectedFrame.world);
    assert.equal(current.rngCursor, expectedFrame.rngCursor);
    assert.deepEqual(randomAdvances, visit.writes.filter(write => write.address === "0x479204").map(write => write.value));
    oracle = expected;
  }
  assert.equal(lethal, 1); assert.equal(deathVisits, 150); assert.deepEqual(current.death!.state.pending, []);
  assert.equal(hits, evidence.policy === 0 ? 32 : 45);
  assert.equal(shots, hits);
  assert.equal(nestedWaits, evidence.policy === 0 ? 16 : 0);
  assert.equal(nestedTurns, evidence.policy === 0 ? 1 : 0);
  assert.equal(evidence.visits.length, evidence.policy === 0 ? 1880 : 2543);
  assert.equal(current.death!.counter, evidence.policy === 0 ? 678 : 899);
  assert.equal(current.actors[evidence.target * 220 + 0x2c], 0);
  assert.equal(current.death!.state.registry[evidence.target], -1);
});

test("nested idle turn guards reject malformed payloads atomically", context => {
  let snapshot = evidence.before;
  for (const visit of evidence.visits) {
    const raw = [...decode(snapshot.actors).subarray(evidence.target * 220, (evidence.target + 1) * 220)];
    if (visit.owner === "target" && raw[0x2c] === 1
      && decodeLegacyAiTaskStack(raw).map(span => span.task).join() === "1,4,3") {
      const base = registeredFrame(frame(snapshot, visit.counter), evidence.target, evidence.targetWorld, visit.counter);
      const poisonedWord = (offset: number, value: number) => {
        const poisoned = Buffer.from(base.raw); poisoned.writeUInt16LE(value, offset);
        return { ...base, raw: [...poisoned] };
      };
      const cases: [ReturnType<typeof registeredFrame>, string][] = [
        ...[[0x46, evidence.source], [0x48, 0], [0x48, 32768], [0x4a, 0], [0x4a, 4],
          [0x4c, 256], [0x4e, 16], [0x50, 1]].map(([offset, value]): [ReturnType<typeof registeredFrame>, string] =>
          [poisonedWord(offset, value), "unowned-native-idle-turn-payload"]),
        [{ ...base, raw: base.raw.map((value, offset) => offset === 0x3e ? 5 : value) }, "invalid-native-task-stack"],
        [{ ...base, raw: base.raw.map((value, offset) => offset === 0x3d ? 11 : value) }, "invalid-native-task-stack"],
        [{ ...base, world: { ...base.world, ground: base.world.ground.map(value => (value & 1023) === base.slot
          ? (value | 1023) >>> 0 : value) } }, "native-origin-occupancy-mismatch"],
        [{ ...base, world: { ...base.world, fin: {} } }, "invalid-source-fin-profile"],
      ];
      const specialType = [...base.world.typeBytes]; specialType[0xdc] = 1;
      const typeTable = [...base.world.combat.typeTable]; typeTable.splice(0, 280, ...specialType);
      cases.push([{ ...base, world: { ...base.world, typeBytes: specialType,
        combat: { ...base.world.combat, typeTable } } }, "unowned-native-idle-turn-payload"]);
      for (const [input, diagnostic] of cases) {
        const saved = structuredClone(input);
        assert.deepEqual(reduceLegacyAiRegisteredVisit(input), { supported: false, diagnostic });
        assert.deepEqual(input, saved);
      }
      return;
    }
    snapshot = next(snapshot, visit);
  }
  context.skip("this native capture has no nested idle turn; base capture covers the guard");
});

function lethalFrame(): LegacyNativeProjectileFrame {
  let current = evidence.before;
  for (const visit of evidence.visits) {
    if (visit.entries.some(entry => entry.entry === "0x416308")) return frame(current, visit.counter);
    current = next(current, visit);
  }
  throw new Error("missing native lethal impact");
}

test("lethal rejection is atomic for absent state, FIN, visible effects, commanders and unowned victims", () => {
  const initial = lethalFrame(), target = evidence.target, cell = initial.world.ground.findIndex(value => (value & 1023) === target);
  const ground = [...initial.world.ground]; ground[cell] = (ground[cell] | 0x80000000) >>> 0;
  const commanders = [...initial.death!.state.commanderSlots]; commanders[initial.actors[evidence.source * 220 + 7]] = evidence.source;
  const actors = [...initial.actors]; actors[target * 220 + 6] = 8;
  const cases: [LegacyNativeProjectileFrame, string][] = [
    [{ ...initial, death: undefined }, "native-projectile-death-owner-required"],
    [{ ...initial, tables: { ...initial.tables, fin: {} } }, "native-death-source-fin-required"],
    [{ ...initial, world: { ...initial.world, ground } }, "native-death-visible-sound-owner-required"],
    [{ ...initial, death: { ...initial.death!, state: { ...initial.death!.state, commanderSlots: commanders } } }, "native-death-killer-branch-unowned"],
    [{ ...initial, actors }, "unowned-native-death-profile"],
    [{ ...initial, death: { ...initial.death!, state: { ...initial.death!.state, typeStatistics: [] } } }, "invalid-native-death-state"],
  ];
  for (const [input, diagnostic] of cases) {
    const saved = structuredClone(input);
    assert.deepEqual(reduceLegacyNativeProjectiles(input), { supported: false, diagnostic });
    assert.deepEqual(input, saved);
  }
});

test("registered removal is monotonic and never follows FIN completion or a repeated visit", () => {
  const input = lethalFrame(), started = reduceLegacyNativeProjectiles(input);
  assert.ok(started.supported && started.death);
  let visit = { ...input, actors: started.actors, state: started.death.state, statistics: started.projectiles.statistics,
    world: { ...input.world, ...started.death }, slot: evidence.target, counter: input.death!.counter + 1 };
  const first = reduceLegacyNativeDeathVisit(visit);
  assert.ok(first.supported);
  assert.equal(first.state.registry[evidence.target], evidence.target); assert.deepEqual(first.removed, []);
  const duplicate = { ...visit, actors: first.actors, state: first.state, rngCursor: first.rngCursor };
  assert.deepEqual(reduceLegacyNativeDeathVisit(duplicate), { supported: false, diagnostic: "invalid-native-death-visit" });
  let completedAnimation = false;
  for (let count = 2; count <= 150; count++) {
    const prior: ReturnType<typeof reduceLegacyNativeDeathVisit> = count === 2 ? first : reduceLegacyNativeDeathVisit(visit);
    assert.ok(prior.supported);
    visit = { ...visit, actors: prior.actors, state: prior.state, rngCursor: prior.rngCursor, counter: visit.counter + 1 };
    if (prior.actors[evidence.target * 220 + 0x1a] === 2) {
      completedAnimation = true;
      assert.equal(prior.state.registry[evidence.target], evidence.target);
    }
  }
  const final = reduceLegacyNativeDeathVisit(visit);
  assert.ok(final.supported); assert.deepEqual(final.removed, [evidence.target]); assert.ok(completedAnimation);
  assert.deepEqual(reduceLegacyNativeDeathVisit({ ...visit, actors: final.actors, state: final.state, counter: visit.counter + 1 }),
    { supported: false, diagnostic: "invalid-native-death-state" });
});
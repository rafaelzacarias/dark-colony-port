import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { finSourceDuration } from "../../src/render/fin-animation";
import { decodeLegacyAiTaskStack, reduceLegacyAiTask, type LegacyAiTaskWorld } from "../../src/engine/legacy-ai-task";

interface Snapshot { entry: string; raw: number[]; stack: { task: number; offset: number; words: number[] }[]; rngCursor: number; ground?: number[] }
interface NativeCase { unitType: number; slot: number; order: number; count: number; counter: number; mode: number;
  before: number[]; received: number[]; initializers: Snapshot[]; taskVisits: Snapshot[];
  world: LegacyAiTaskWorld; runtimeIntercepts: unknown[]; sourceSlot: number | null; faction: string;
  fin: Record<number, number[][]>; animations: { sources: { source: string; sha256: string }[] } }
const trace = process.env.DC_NATIVE_ACTOR_TASK_TRACE;
const evidence = (trace ? readFileSync(trace, "utf8") : execFileSync("python3", [fileURLToPath(new URL("nativeactor-task-native.py", import.meta.url)), "--suite"], {
  encoding: "utf8", maxBuffer: 128 * 1024 * 1024,
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" },
})).trim().split("\n").map(line => JSON.parse(line) as NativeCase);

const root = new URL("../../", import.meta.url);
const stems = readFileSync(new URL("raw_cd/DC/GAMESTAT/GAMESTAT.TXT", root), "utf8").split(/\r?\n/)
  .filter(line => line.trim() && !line.trimStart().startsWith("%")).slice(1).map(line => line.trim().split(/\s+/)[0]);
interface Fin { source: { sha256: string }; states: { name: string; firstTimelineIndex: number; lastTimelineIndex: number; validRange: boolean }[];
  timeline: { field2: number }[] }
test("native FIN banks and PTH hashes match source metadata", () => {
  for (const current of evidence) {
    const pth = readFileSync(new URL(`raw_cd/DC/SCENARIO/${current.faction}/${current.faction}02.PTH`, root));
    assert.equal(createHash("sha256").update(pth).digest("hex"), current.world.pthSha256);
    assert.deepEqual(current.world.families, [...pth.subarray(65536)]);
    const stem = stems[current.unitType], fin = JSON.parse(readFileSync(new URL(`public/assets/generated/animations/${stem}.json`, root), "utf8")) as Fin;
    assert.equal(current.animations.sources.find(source => source.source.endsWith(`/${stem}.FIN`))?.sha256, fin.source.sha256);
    const census = new DataView(Uint8Array.from(current.world.typeBytes).buffer);
    for (const [family, offset] of [["STAND", 0x80], ["MOVE", 0x7c]] as const) {
      const bank = census.getUint32(offset, true);
      if (!(bank in current.fin)) continue;
      const candidates = Array.from({ length: 16 }, (_, index) => fin.states.find(state => state.name === `${stem}${family}${(12 - index + 16) & 15}`));
      const directions = Array.from({ length: 32 }, (_, direction) => {
        const offsets = [0, ...Array.from({ length: 15 }, (_, index) => [index + 1, -index - 1]).flat(), 16];
        const state = offsets.map(offset => candidates[((direction + offset + 32) & 31) >> 1]).find(Boolean);
        assert.ok(state?.validRange);
        return fin.timeline.slice(state.firstTimelineIndex, state.lastTimelineIndex + 1).map(frame => finSourceDuration(frame.field2));
      });
      assert.deepEqual(current.fin[bank], directions, `${stem}${family} native FIN`);
    }
  }
});

test("later native task8 visits use current occupancy and nonzero waypoint cursors", () => {
  for (const current of evidence) {
    for (let index = 0; index < current.taskVisits.length; index++) {
      const entry = current.taskVisits[index];
      if (entry.entry !== "0x416104" || entry.stack.at(-1)?.words[0] === 0 || !entry.ground) continue;
      const exit = current.taskVisits[index + 1];
      assert.ok(exit && ["0x41618d", "0x416157"].includes(exit.entry));
      const result = reduceLegacyAiTask({ slot: current.slot, raw: entry.raw,
        world: { ...current.world, ground: entry.ground }, boundary: "task-handler-entry" });
      assert.ok(result.supported, JSON.stringify(result));
      assert.deepEqual(result.raw, exit.raw);
      assert.deepEqual(result.stack, exit.stack);
      assert.equal(entry.rngCursor, exit.rngCursor);
    }
  }
});

for (const [index, current] of evidence.entries()) {
  test(`native initializer and next task8 ${index}: type=${current.unitType} order=${current.order} points=${current.count} counter=${current.counter}`, () => {
    assert.deepEqual(current.runtimeIntercepts, []);
    if (current.mode === 17) {
      assert.equal(current.received[0x36], current.before[0x36]);
      assert.equal(current.initializers.length, 0);
      return;
    }
    assert.equal(current.received[0x36], 1);
    const before = current.initializers.find(entry => entry.entry === "0x412014")!;
    const after = current.initializers.find(entry => entry.entry === "0x4120f1")!;
    assert.ok(before && after);
    const initialized = reduceLegacyAiTask({ slot: current.slot, raw: before.raw, world: current.world, boundary: "initializer-entry" });
    if (new DataView(Uint8Array.from(current.world.typeBytes).buffer).getInt32(12, true) <= 0) {
      assert.deepEqual(initialized, { supported: false, diagnostic: "unowned-native-movement-class" });
      assert.equal(current.sourceSlot !== null, true);
      return;
    }
    assert.ok(initialized.supported, JSON.stringify(initialized));
    assert.deepEqual(initialized.raw, after.raw);
    assert.deepEqual(initialized.stack, after.stack);
    assert.equal(initialized.registeredVisitComplete, false);
    const entry = current.taskVisits.find(visit => visit.entry === "0x416104")!;
    const exit = current.taskVisits.find(visit => ["0x41618d", "0x416157"].includes(visit.entry))!;
    assert.ok(entry && exit);
    assert.deepEqual(initialized.raw, entry.raw);
    const visited = reduceLegacyAiTask({ slot: current.slot, raw: initialized.raw, world: current.world, boundary: "task-handler-entry" });
    const inputWords = new DataView(Uint8Array.from(entry.raw).buffer);
    const originX = inputWords.getUint16(0, true) >> 8, originY = inputWords.getUint16(4, true) >> 8;
    const targetX = inputWords.getUint16(0xa6, true) >> 8;
    const sourceCell = originY * current.world.width + originX;
    const obstructed = Array.from({ length: Math.abs(targetX - originX) }, (_, index) =>
      sourceCell + (index + 1) * Math.sign(targetX - originX)).some(cell => current.world.families[cell] !== current.world.families[sourceCell]
        || (current.world.ground[cell] & 1023) !== 1023);
    if (current.count && obstructed) {
      assert.deepEqual(visited, { supported: false, diagnostic: "native-obstructed-path-owner-required" });
      assert.deepEqual(initialized.raw, entry.raw);
      return;
    }
    assert.ok(visited.supported, JSON.stringify(visited));
    const differences = visited.raw.flatMap((value, offset) => value === exit.raw[offset] ? [] : [`${offset.toString(16)}:${value}!=${exit.raw[offset]}`]);
    assert.deepEqual(differences, []);
    assert.deepEqual(visited.stack, exit.stack);
    assert.equal(entry.rngCursor, exit.rngCursor);
    assert.deepEqual(visited.raw.slice(0x14, 0x2c), entry.raw.slice(0x14, 0x2c));
    if (current.count) {
      assert.equal(visited.nextOwner, "native-task6-movement");
      const blocked = reduceLegacyAiTask({ slot: current.slot, raw: visited.raw, world: current.world, boundary: "task-handler-entry" });
      assert.deepEqual(blocked, { supported: false, diagnostic: "native-task6-movement-owner-required" });
    }
  });
}

test("unowned paths and orders reject without mutating actor or source world", () => {
  const current = evidence.find(entry => entry.mode === 7 && entry.count > 0)!;
  const before = current.initializers[0].raw;
  for (const order of [0, 1, 9, 13, 14, 255]) {
    const raw = [...before]; raw[0x37] = order;
    const copy = [...raw];
    assert.equal(reduceLegacyAiTask({ slot: current.slot, raw, world: current.world, boundary: "initializer-entry" }).supported, false);
    assert.deepEqual(raw, copy);
  }
  const raw = current.taskVisits.find(entry => entry.entry === "0x416104")!.raw;
  const world = structuredClone(current.world);
  const view = new DataView(Uint8Array.from(raw).buffer);
  const cell = (view.getUint16(4, true) >> 8) * world.width + (view.getUint16(0, true) >> 8) + 1;
  const occupied = { ...world, ground: world.ground.map((value, index) => index === cell ? 152 : value) };
  const saved = structuredClone({ raw, occupied });
  assert.equal(reduceLegacyAiTask({ slot: current.slot, raw, world: occupied, boundary: "task-handler-entry" }).supported, false);
  assert.deepEqual({ raw, occupied }, saved);
  assert.deepEqual(decodeLegacyAiTaskStack(raw), current.taskVisits.find(entry => entry.entry === "0x416104")!.stack);
});
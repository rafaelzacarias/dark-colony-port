import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { decodeLegacyHarvesterMovement, reduceLegacyHarvesterMovement,
  sourceLegacyHarvesterMovementWorld } from "../../src/engine/legacy-harvester-movement";
import { legacyHarvesterIdleDiagnostic } from "../../src/engine/legacy-harvester-idle";

interface Snapshot { raw: number[]; randomIndex: number; ground: number[]; pathBytes: number[];
  stack: { opcode: number; offset: number; words: number[] }[] }
interface NativeCase { unitType: 6 | 14; order: number; mobileFirst: boolean; mobileSlot: number;
  stopAfter: number | null; counterOverride: number | null; runtimeInterceptions: unknown[]; randomWrites: unknown[];
  banks: { stand: number; move: number; preservedIdle: number }; animations: Record<number, number[][]>;
  visits: { update: number; boundary: string; state: Snapshot }[];
  writes: { update: number; eip: string; address: number; size: number; before: number; after: number }[];
  trace: { update: number; before: Snapshot; after: Snapshot }[] }
const root = new URL("../../", import.meta.url);
const evidence = JSON.parse(process.env.DC_HARVESTER_BOUNDARY_TRACE
  ? readFileSync(process.env.DC_HARVESTER_BOUNDARY_TRACE, "utf8")
  : execFileSync("python3", [fileURLToPath(new URL("tools/qa/harvester-movement-boundary-native.py", root))], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1",
      PYTHONPATH: "/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918" } })) as { cases: NativeCase[] };
const pth = readFileSync(new URL("raw_cd/DC/SCENARIO/HUMAN/HUMAN02.PTH", root));
const fin = Object.fromEntries(["VENT", "EXPL", "SLUG"].map(stem => [stem,
  JSON.parse(readFileSync(new URL(`public/assets/generated/animations/${stem}.json`, root), "utf8"))])) as
  Parameters<typeof sourceLegacyHarvesterMovementWorld>[0]["fin"];
function world(current: NativeCase) {
  return sourceLegacyHarvesterMovementWorld({ typeId: current.unitType, pth, fin, banks: current.banks });
}
for (const current of evidence.cases.filter(current => current.counterOverride === null)) {
  test(`every native movement visit ${current.unitType}/${current.order}/${current.mobileFirst}/Stop=${current.stopAfter}`, async () => {
    const profile = await world(current);
    for (const bank of Object.keys(profile.animations)) assert.deepEqual(profile.animations[Number(bank)], current.animations[Number(bank)]);
    assert.deepEqual(current.runtimeInterceptions, []); assert.deepEqual(current.randomWrites, []);
    let state = decodeLegacyHarvesterMovement(current.trace[0].before.raw, current.mobileSlot,
      current.trace[0].before.randomIndex, current.trace[0].before.ground);
    const events: { update: number; arrived: boolean }[] = [];
    for (const visit of current.trace) {
      if (visit.before.raw[6] !== current.unitType || visit.before.stack.some(task => task.opcode > 8)) break;
      if (visit.update === (current.stopAfter ?? -2) + 1) {
        const raw = [...state.raw]; raw[0x36] = 1; raw[0x37] = 13;
        state = decodeLegacyHarvesterMovement(raw, state.slot, state.randomIndex, state.ground);
      }
      assert.deepEqual(state.raw, visit.before.raw, `input ${visit.update}`);
      const result = reduceLegacyHarvesterMovement(state, profile);
      assert.ok(result.supported, `visit ${visit.update}: ${JSON.stringify(result)}`);
      const changed = result.state.raw.flatMap((value, index) => value !== visit.after.raw[index]
        ? [`${index.toString(16)}:${value}!=${visit.after.raw[index]}`] : []);
      assert.deepEqual(changed, [], `raw visit ${visit.update}`);
      assert.deepEqual(result.state.ground, visit.after.ground, `ground visit ${visit.update}`);
      assert.equal(result.state.randomIndex, visit.after.randomIndex);
      assert.deepEqual(result.state.stack, visit.after.stack.map(task => ({ task: task.opcode, words: task.words })));
      assert.deepEqual(result.state.pathBytes, visit.after.pathBytes);
      assert.deepEqual(result.visits.map(entry => ({ boundary: entry.boundary, raw: entry.state.raw, ground: entry.state.ground,
        randomIndex: entry.state.randomIndex, pathBytes: entry.state.pathBytes })),
        current.visits.filter(entry => entry.update === visit.update).map(entry => ({ boundary: entry.boundary, raw: entry.state.raw,
          ground: entry.state.ground, randomIndex: entry.state.randomIndex, pathBytes: entry.state.pathBytes })),
        `dispatch chronology ${visit.update}`);
      assert.deepEqual(result.groundWrites, current.writes.filter(entry => entry.update === visit.update && entry.address >= 0xd20000)
        .map(entry => ({ eip: entry.eip, cell: (entry.address - 0xd20000) / 4, size: entry.size, before: entry.before, after: entry.after })),
        `ground chronology ${visit.update}`);
      if (result.idleEvent) {
        const event = result.idleEvent;
        assert.equal(legacyHarvesterIdleDiagnostic(event.state, { ...profile, groundCell: event.groundCell, groundWord: event.groundWord }), null);
        assert.deepEqual(event.raw, visit.after.raw);
        assert.deepEqual(event.state.stack, [{ task: 1, words: [65535, 800, 0] }, { task: 3, words: [7, 800] }]);
        events.push({ update: visit.update, arrived: event.arrived });
      }
      if (state.pending && [4, 5].includes(state.stack.at(-1)!.task)) {
        assert.equal(result.state.pending, 1); assert.equal(result.state.order, 13); assert.equal(result.idleEvent, null);
      }
      state = JSON.parse(JSON.stringify(result.state));
    }
    assert.ok(events.length > 0);
    if (current.stopAfter === null) {
      assert.deepEqual(events, [{ update: current.unitType === 6 ? 25 : 28, arrived: true }]);
      assert.equal(state.xQ8, 17280 + 12 * 40);
      assert.equal(profile.commandTarget[0] - state.xQ8, 32);
      assert.equal((state.xQ8 / 8) - (67.5 * 32), 60);
    }
  });
}

test("unsupported branches, task aliases, path and ground reject before mutation", async () => {
  const current = evidence.cases.find(current => current.stopAfter === null && current.counterOverride === null)!;
  const profile = await world(current);
  const initial = current.trace[0].before;
  const state = decodeLegacyHarvesterMovement(initial.raw, current.mobileSlot, initial.randomIndex, initial.ground);
  const rawChange = (offset: number, value: number) => {
    const raw = [...state.raw]; raw[offset] = value;
    return decodeLegacyHarvesterMovement(raw, state.slot, state.randomIndex, state.ground);
  };
  assert.equal(reduceLegacyHarvesterMovement(rawChange(9, 0), profile).supported, true);
  const inputs = [rawChange(0x35, 0), rawChange(0xcb, 1), rawChange(0xd0, 1),
    rawChange(0xc7, 1), rawChange(0xc8, 1), rawChange(0x10, 1), rawChange(0x37, 4), { ...state, xQ8: 17792 },
    { ...state, ground: [1023, state.slot, 1023] }, { ...state, pathBytes: [0] }];
  for (const input of inputs) {
    const before = structuredClone(input);
    assert.equal(reduceLegacyHarvesterMovement(input, profile).supported, false);
    assert.deepEqual(input, before);
  }
  for (const invalid of [{ ...profile, census: { ...profile.census, speedQ8: 0 } }, { ...profile, tripWords: [1023, 2047, 1023] },
    { ...profile, animations: {} }]) {
    assert.equal(reduceLegacyHarvesterMovement(state, invalid).supported, false);
    assert.deepEqual(state.raw, initial.raw);
  }
  const invalidPth = Uint8Array.from(pth); invalidPth[65536 + 48 * 96 + 68] = 0;
  const blocked = await sourceLegacyHarvesterMovementWorld({ typeId: 6, pth: invalidPth, fin, banks: current.banks });
  assert.equal(reduceLegacyHarvesterMovement(state, blocked).supported, false);
  const changedElsewhere = Uint8Array.from(pth); changedElsewhere[65536] = 0;
  const notHashGated = await sourceLegacyHarvesterMovementWorld({ typeId: 6, pth: changedElsewhere, fin, banks: current.banks });
  assert.equal(reduceLegacyHarvesterMovement(state, { ...notHashGated, pthSha256: "metadata-not-an-admission-gate" }).supported, true);
  const overlap = [...initial.raw]; overlap[0x3c] = 4;
  assert.throws(() => decodeLegacyHarvesterMovement(overlap, state.slot, 0, state.ground), /noncanonical-native-task-span/);
});

test("eight arrivals and twelve Stops are mandatory; synthetic native overshoot is retained, not admitted as a fresh route", async () => {
  assert.equal(evidence.cases.filter(current => current.counterOverride === null && current.stopAfter === null).length, 8);
  assert.equal(evidence.cases.filter(current => current.stopAfter !== null).length, 12);
  for (const current of evidence.cases.filter(current => current.counterOverride !== null)) {
    const update = current.unitType === 6 ? 11 : 14;
    const entry = current.trace.find(visit => visit.update === update)!;
    const decode = (snapshot: Snapshot) => decodeLegacyHarvesterMovement(snapshot.raw, current.mobileSlot, snapshot.randomIndex, snapshot.ground);
    const before = decode(entry.before), after = decode(entry.after);
    assert.equal(after.xQ8 - before.xQ8, current.counterOverride === 0 ? 0 : 40);
    assert.equal(reduceLegacyHarvesterMovement(before, await world(current)).supported, false);
    if (current.counterOverride === 0) assert.deepEqual(after.stack, before.stack.slice(0, -1));
    if (current.counterOverride !== 6) continue;
    const zeroEntry = current.trace.find(visit => visit.update === update + 6)!;
    const popped = decode(zeroEntry.after);
    assert.equal(popped.xQ8, before.xQ8 + 6 * 40);
    assert.equal(popped.xQ8 - (68 * 256 + 128), 24);
    assert.equal(popped.xQ8, decode(zeroEntry.before).xQ8);
    assert.deepEqual(popped.stack, decode(zeroEntry.before).stack.slice(0, -1));
  }
});
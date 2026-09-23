import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { MAX_MISSION_SAVE_BYTES, readMissionSave, writeMissionSave, type SavedMission } from "../../src/mission-save";

function save(): SavedMission {
  return { version: 1, faction: "human", missionNumber: 1, savedAt: "2026-09-19T00:00:00.000Z",
    checkpoint: { kind: "mission-view", version: 1, tick: 42 }, controlGroups: Array.from({ length: 10 }, () => [1, 2]) };
}

test("mission save commits atomically, survives readers and detaches input and output", async () => {
  const factory = new IDBFactory();
  assert.equal(await readMissionSave(factory), null);
  const source = save();
  await writeMissionSave(source, factory);
  const loaded = await readMissionSave(factory);
  assert.deepEqual(loaded, source);
  (loaded!.checkpoint as { tick: number }).tick = 999;
  assert.deepEqual(await readMissionSave(factory), source);
  await writeMissionSave({ ...source, faction: "alien", missionNumber: 2 }, factory);
  assert.equal((await readMissionSave(factory))!.faction, "alien");
});

test("invalid and oversized saves leave the previous committed record untouched", async () => {
  const factory = new IDBFactory();
  const source = save();
  await writeMissionSave(source, factory);
  for (const invalid of [{ ...source, version: 2 }, { ...source, missionNumber: 16 },
    { ...source, savedAt: "invalid" }, { ...source, checkpoint: null }, { ...source, controlGroups: [[-1]] },
    { ...source, checkpoint: { text: "x".repeat(MAX_MISSION_SAVE_BYTES) } }]) {
    await assert.rejects(writeMissionSave(invalid as SavedMission, factory));
    assert.deepEqual(await readMissionSave(factory), source);
  }
});

test("storage failures are surfaced rather than reported as successful saves", async () => {
  const factory = { open() { throw new Error("storage denied"); } } as unknown as IDBFactory;
  await assert.rejects(writeMissionSave(save(), factory), /storage denied/);
  await assert.rejects(readMissionSave(factory), /storage denied/);
});
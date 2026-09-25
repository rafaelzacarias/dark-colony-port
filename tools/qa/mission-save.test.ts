import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { listMissionSaves, MAX_MISSION_SAVE_BYTES, MISSION_SAVE_SLOTS, readMissionSave, writeMissionSave, type SavedMission } from "../../src/mission-save";

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
  await assert.rejects(listMissionSaves(factory), /storage denied/);
});

test("manual slots are independent and Continue reads the last committed save", async () => {
  const factory = new IDBFactory();
  assert.deepEqual(await listMissionSaves(factory), MISSION_SAVE_SLOTS.map(slot => ({ slot, save: null })));
  const first = save();
  const second = { ...first, faction: "alien" as const, missionNumber: 7 };
  await writeMissionSave(first, factory, "slot-1");
  await writeMissionSave(second, factory, "slot-2");
  assert.deepEqual(await readMissionSave(factory), second);
  assert.deepEqual(await readMissionSave(factory, "slot-1"), first);
  assert.deepEqual(await readMissionSave(factory, "slot-2"), second);
  assert.equal(await readMissionSave(factory, "slot-3"), null);
  await assert.rejects(writeMissionSave({ ...first, checkpoint: null }, factory, "slot-2"));
  assert.deepEqual(await readMissionSave(factory, "slot-2"), second);
  assert.deepEqual(await readMissionSave(factory), second);
  await writeMissionSave({ ...first, missionNumber: 3 }, factory, "slot-1");
  assert.equal((await readMissionSave(factory))!.missionNumber, 3);
  assert.deepEqual(await readMissionSave(factory, "slot-2"), second);
});

test("upgrading the original single-save database preserves it in slot 1", async () => {
  const factory = new IDBFactory();
  await new Promise<void>((resolve, reject) => {
    const request = factory.open("dark-colony-mission-save", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("missions");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction("missions", "readwrite");
      transaction.objectStore("missions").put(JSON.stringify(save()), "latest");
      transaction.oncomplete = () => { request.result.close(); resolve(); };
      transaction.onabort = () => reject(transaction.error);
    };
  });
  const migrated = await listMissionSaves(factory);
  assert.deepEqual(migrated[0], { slot: "slot-1", save: save() });
  assert.equal(migrated[1].save, null);
  assert.equal(migrated[2].save, null);
  await writeMissionSave({ ...save(), missionNumber: 4 }, factory, "slot-3");
  assert.deepEqual(await readMissionSave(factory, "slot-1"), save());
  assert.equal((await readMissionSave(factory))!.missionNumber, 4);
});
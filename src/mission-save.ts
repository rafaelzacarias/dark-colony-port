import { campaignMissionStem } from "./game-data";
import type { Faction } from "./engine";
import { restoreControlGroups } from "./ui/control-groups";

export interface SavedMission {
  readonly version: 1;
  readonly faction: Faction;
  readonly missionNumber: number;
  readonly savedAt: string;
  readonly checkpoint: unknown;
  readonly controlGroups?: readonly (readonly number[])[];
}

export const MAX_MISSION_SAVE_BYTES = 32 * 1024 * 1024;
const DATABASE = "dark-colony-mission-save";
const STORE = "missions";
export const MISSION_SAVE_SLOTS = ["slot-1", "slot-2", "slot-3"] as const;
export type MissionSaveSlot = typeof MISSION_SAVE_SLOTS[number];
export interface MissionSaveEntry {
  readonly slot: MissionSaveSlot;
  readonly save: SavedMission | null;
}

function parseSave(json: string): SavedMission {
  if (new TextEncoder().encode(json).byteLength > MAX_MISSION_SAVE_BYTES) throw new Error("Mission save exceeds 32 MiB");
  const value = JSON.parse(json) as SavedMission;
  if (!value || value.version !== 1 || typeof value.savedAt !== "string" ||
    !Number.isFinite(Date.parse(value.savedAt)) || !value.checkpoint || typeof value.checkpoint !== "object") {
    throw new Error("Invalid mission save envelope");
  }
  campaignMissionStem(value.faction, value.missionNumber);
  if (value.controlGroups !== undefined) restoreControlGroups(value.controlGroups, []);
  return value;
}

async function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE, 2);
    request.onupgradeneeded = event => {
      if (event.oldVersion === 0) request.result.createObjectStore(STORE);
      else {
        const store = request.transaction!.objectStore(STORE);
        const latest = store.get("latest");
        latest.onsuccess = () => {
          if (latest.result !== undefined) store.put(latest.result, "slot-1");
        };
      }
    };
    request.onerror = () => reject(request.error ?? new Error("Mission storage unavailable"));
    let blocked = false;
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Close other game tabs, then retry opening saved games"));
    };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

export async function writeMissionSave(save: SavedMission, factory: IDBFactory = indexedDB,
  slot: MissionSaveSlot = "slot-1"): Promise<void> {
  if (!MISSION_SAVE_SLOTS.includes(slot)) throw new Error("Invalid mission save slot");
  const json = JSON.stringify(save);
  parseSave(json);
  const database = await openDatabase(factory);
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error("Mission save was not committed"));
      transaction.onerror = () => reject(transaction.error ?? new Error("Mission save failed"));
      transaction.objectStore(STORE).put(json, "latest");
      transaction.objectStore(STORE).put(json, slot);
    });
  } finally { database.close(); }
}

export async function readMissionSave(factory: IDBFactory = indexedDB,
  slot?: MissionSaveSlot): Promise<SavedMission | null> {
  if (slot !== undefined && !MISSION_SAVE_SLOTS.includes(slot)) throw new Error("Invalid mission save slot");
  const database = await openDatabase(factory);
  try {
    const json = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).get(slot ?? "latest");
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error ?? new Error("Mission save read failed"));
      transaction.onerror = () => reject(transaction.error ?? new Error("Mission save read failed"));
    });
    if (json === undefined) return null;
    if (typeof json !== "string") throw new Error("Invalid stored mission save");
    return parseSave(json);
  } finally { database.close(); }
}

export async function listMissionSaves(factory: IDBFactory = indexedDB): Promise<readonly MissionSaveEntry[]> {
  const database = await openDatabase(factory);
  try {
    const records = await new Promise<unknown[]>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readonly");
      const requests = MISSION_SAVE_SLOTS.map(slot => transaction.objectStore(STORE).get(slot));
      transaction.oncomplete = () => resolve(requests.map(request => request.result));
      transaction.onabort = () => reject(transaction.error ?? new Error("Saved games could not be read"));
      transaction.onerror = () => reject(transaction.error ?? new Error("Saved games could not be read"));
    });
    return MISSION_SAVE_SLOTS.map((slot, index) => {
      const json = records[index];
      if (json === undefined) return { slot, save: null };
      if (typeof json !== "string") throw new Error(`Invalid stored mission save in ${slot}`);
      return { slot, save: parseSave(json) };
    });
  } finally { database.close(); }
}
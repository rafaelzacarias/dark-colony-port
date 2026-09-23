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
    const request = factory.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error ?? new Error("Mission storage unavailable"));
    request.onblocked = () => reject(new Error("Mission storage upgrade is blocked by another tab"));
    request.onsuccess = () => resolve(request.result);
  });
}

export async function writeMissionSave(save: SavedMission, factory: IDBFactory = indexedDB): Promise<void> {
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
    });
  } finally { database.close(); }
}

export async function readMissionSave(factory: IDBFactory = indexedDB): Promise<SavedMission | null> {
  const database = await openDatabase(factory);
  try {
    const json = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).get("latest");
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error ?? new Error("Mission save read failed"));
      transaction.onerror = () => reject(transaction.error ?? new Error("Mission save read failed"));
    });
    if (json === undefined) return null;
    if (typeof json !== "string") throw new Error("Invalid stored mission save");
    return parseSave(json);
  } finally { database.close(); }
}
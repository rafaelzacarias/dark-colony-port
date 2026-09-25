import { readFileSync } from "node:fs";
import { campaignConstructionPolicy, loadCampaignMission } from "../../../src/game-data";
import type { Faction } from "../../../src/engine";

/** The MissionView checkpoint of a saved `{ view }` file, for deriving a restore's release configuration. */
export function savedView(path?: string): unknown {
  return path === undefined ? undefined : (JSON.parse(readFileSync(path, "utf8")) as { view: unknown }).view;
}

/** Loads a campaign mission with the same runtime profile and construction policy as main's startCampaign. */
export function loadReleaseMission(faction: Faction, missionNumber: number, checkpoint?: unknown) {
  const runtimeProfile = missionNumber >= 2 ? "browser-adapted" as const : undefined;
  return loadCampaignMission(faction, missionNumber, runtimeProfile,
    campaignConstructionPolicy(faction, missionNumber, runtimeProfile, checkpoint));
}

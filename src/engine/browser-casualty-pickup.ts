import type { CampaignWorld } from "./campaign-world";

export interface BrowserCasualtyPickupOwner {
  readonly runtimeProfile: "browser-adapted";
}

export interface BrowserCasualtyPickup {
  readonly slot: number;
  readonly generation: number;
  readonly lossId: string;
  readonly carrierId: number | null;
  readonly disposition: "scheduled" | "suppressed";
  collected: boolean;
}

export function sourceUnitIsCommander(unitType: number): boolean {
  return Number.isInteger(unitType) && unitType >= 69 && unitType <= 76;
}

export function initializeBrowserCasualtyPickup(world: CampaignWorld, owner: BrowserCasualtyPickupOwner): CampaignWorld {
  if (owner.runtimeProfile !== "browser-adapted") throw new Error("Casualty pickup requires browser-adapted ownership");
  return { ...world, browserCasualtyPickup: { runtimeProfile: "browser-adapted" } };
}

export function browserCasualtyPickupPolicy(world: CampaignWorld, team: number, unitType: number):
  "unowned" | "ordinary" | "suppressed" | "automatic" {
  if (!world.browserCasualtyPickup) return "unowned";
  if (world.browserCasualtyPickup.runtimeProfile !== "browser-adapted") throw new Error("Invalid casualty pickup owner");
  if (!Number.isInteger(team) || team < 0 || team > 7) throw new Error("Invalid casualty team");
  if (!sourceUnitIsCommander(unitType)) return "ordinary";
  const flag = world.adaptedTro?.noPickup[team] ?? 0;
  if (flag !== 0 && flag !== 1) throw new Error("Invalid casualty nopickup flag");
  return flag === 1 ? "suppressed" : "automatic";
}
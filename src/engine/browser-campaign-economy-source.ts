import type { CampaignWorld } from "./campaign-world";
import { SUBCELLS_PER_CELL } from "./constants";
import type { LegacyUnitStat } from "./legacy-balance";
import { initializeLegacyResource } from "./legacy-resource";
import type { BrowserEconomyProfile } from "./browser-campaign-economy";

export interface BrowserEconomySourceTeam {
  readonly index: number;
  readonly money: number;
  readonly coordinateRows: readonly (readonly number[])[];
}

export function sourceBrowserEconomyHarvesters(world: CampaignWorld, units: readonly LegacyUnitStat[]): BrowserEconomyProfile["harvesters"] {
  const requireSource = (condition: unknown, message: string): void => {
    if (!condition) throw new RangeError(`Browser economy source: ${message}`);
  };
  const harvesters: BrowserEconomyProfile["harvesters"][number][] = [];
  for (const entity of world.entities.filter(entry => (entry.unitType === 6 || entry.unitType === 14) && entry.health > 0)) {
    const stat = units.find(unit => unit.index === entity.unitType);
    requireSource(stat && Number.isInteger(stat.movementSpeed) && stat.movementSpeed > 0
      && stat.weapons.every(weapon => weapon === -1) && entity.rawSlot !== null
      && entity.team >= 0 && entity.team < 8, "invalid source harvester census");
    let xQ8 = entity.tileX * 256 + 128, yQ8 = entity.tileY * 256 + 128;
    if (world.entityBytes) {
      requireSource(world.entityBytes.length === 800 * 220, "incomplete source entity bytes");
      const raw = new DataView(world.entityBytes.buffer, world.entityBytes.byteOffset, world.entityBytes.byteLength);
      const offset = entity.rawSlot! * 220;
      requireSource(raw.getUint8(offset + 6) === entity.unitType && raw.getUint8(offset + 7) === entity.team
        && raw.getInt32(offset + 12, true) === entity.health, "source harvester raw identity mismatch");
      xQ8 = raw.getUint16(offset, true); yQ8 = raw.getUint16(offset + 4, true);
    }
    harvesters.push({ key: entity.key, slot: entity.rawSlot!, generation: entity.generation, team: entity.team,
      typeId: entity.unitType as 6 | 14, options: {
        faction: entity.unitType === 6 ? "human" : "alien", team: entity.team,
        cell: { x: Math.floor(xQ8 / 256), y: Math.floor(yQ8 / 256) },
        positionSubcells: { x: xQ8 * SUBCELLS_PER_CELL / 256, y: yQ8 * SUBCELLS_PER_CELL / 256 },
        speedSubcellsPerTick: stat!.movementSpeed * SUBCELLS_PER_CELL / 256,
        maxHealth: entity.maxHealth, health: entity.health,
      } });
  }
  return harvesters;
}

export async function createBrowserCampaignEconomyProfile(input: {
  readonly scope: "browser-adapted-economy-v1";
  readonly world: CampaignWorld;
  readonly teams: readonly BrowserEconomySourceTeam[];
  readonly units: readonly LegacyUnitStat[];
  readonly extractionPeriodTicks?: number;
}): Promise<BrowserEconomyProfile> {
  const { world, teams, units } = structuredClone(input);
  const requireSource = (condition: unknown, message: string): void => {
    if (!condition) throw new RangeError(`Browser economy source: ${message}`);
  };
  requireSource(input.scope === "browser-adapted-economy-v1" && world.clockMilliseconds === 0, "explicit fresh adapted world required");
  requireSource(teams.length === 8 && teams.every((team, index) => team.index === index
    && Number.isSafeInteger(team.money) && (!Object.hasOwn(world.exomoney, index) || world.exomoney[index] === team.money)),
  "SCN initial money mismatch");
  const extractionPeriodTicks = input.extractionPeriodTicks ?? 20;
  requireSource(Number.isSafeInteger(extractionPeriodTicks) && extractionPeriodTicks > 0, "invalid adapted extraction period");
  const vent = units.find(unit => unit.index === 40);
  requireSource(vent, "missing source VENT stats");
  const nodes: BrowserEconomyProfile["nodes"][number][] = [];
  for (const entity of world.entities.filter(entry => entry.unitType === 40)) {
    const row = entity.sourceRow === null ? undefined : world.source.placementRows[entity.sourceRow];
    requireSource(row && row[2] === 40 && entity.rawSlot !== null && entity.resource, "VENT missing SCN binding");
    const decoded = initializeLegacyResource({ slot: entity.rawSlot!, tileX: row![0], tileY: row![1],
      sourceRate: row![3], sourceReserve: row![4], scales: { rateScale: 256, reserveScale: 256 }, typeReserve: vent!.health });
    requireSource(entity.tileX === row![0] && entity.tileY === row![1] && entity.health === decoded.reserve
      && entity.resource!.rateWord === decoded.rateWord && decoded.reserve >= 0 && decoded.rateWord <= 32767,
    "VENT reserve/rate differs from source Q8 startup");
    nodes.push({ key: entity.key, slot: entity.rawSlot!, sourceRow: entity.sourceRow!,
      cell: { x: entity.tileX, y: entity.tileY }, amount: decoded.reserve, rateWord: decoded.rateWord });
  }
  const harvesters = sourceBrowserEconomyHarvesters(world, units);
  const dropoffs: BrowserEconomyProfile["dropoffs"][number][] = [];
  for (const team of teams) {
    const base = team.coordinateRows[1];
    if (base && base[0] !== 0 && base[1] !== 0 && world.buildingSlots?.[`${team.index},0`] > 0) {
      dropoffs.push({ team: team.index, cell: { x: base[0], y: base[1] } });
    }
  }
  const configuration = {
    scope: input.scope, sessionId: world.sessionId,
    policy: { ticksPerSecond: 20 as const, extractionPeriodTicks, delivery: "direct-team-credit" as const,
      timing: "adapted-not-native" as const },
    initialCredits: Object.fromEntries(teams.map(team => [team.index, team.money])), nodes, harvesters, dropoffs,
  };
  const bytes = new TextEncoder().encode(JSON.stringify({ source: world.source, configuration }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const profileId = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  return { ...configuration, profileId };
}
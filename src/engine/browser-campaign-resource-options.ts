import { assetUrl } from "../asset-url";
import { sha256Hex as sha256 } from "../sha256";
import type { CampaignMissionData } from "../game-data";
import { parseScenario } from "../../tools/extractors/data/scenario";
import { missionPaletteBank } from "../render/palette-init";
import type { FinAnimationData } from "../render/fin-animation";
import { initializeCampaignSession } from "./campaign-session";
import { initializeLegacyResource } from "./legacy-resource";
import { sourceBrowserCampaignSessionOptions } from "./source-browser-campaign-options";

export interface SourceBrowserResourceMetadata {
  readonly scope: "browser-adapted-resource-metadata-v1";
  readonly source: { readonly path: string; readonly sha256: string };
  readonly paletteBank: string;
  readonly animation: FinAnimationData & {
    readonly schemaVersion: 1;
    readonly formatTag: 29;
    readonly source: { readonly path: string; readonly sha256: string };
  };
  readonly resources: readonly {
    readonly sourceRow: number;
    readonly key: string;
    readonly slot: number;
    readonly unitType: 40;
    readonly team: 8;
    readonly cell: { readonly x: number; readonly y: number };
    readonly reserve: number;
    readonly health: number;
    readonly rateWord: number;
  }[];
}

function requireSource(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Browser resource source: ${message}`);
}

function freeze<Value>(value: Value): Value {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export async function loadBrowserCampaignResourceOptions(mission: CampaignMissionData,
  readBytes: (url: string) => Promise<Uint8Array> = async url => {
    const response = await fetch(url);
    requireSource(response.ok, `cannot load ${url}: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }): Promise<SourceBrowserResourceMetadata> {
  requireSource(typeof mission.scenario.rawScenario === "string", "original SCN bytes required");
  const rawScenario = Uint8Array.from(atob(mission.scenario.rawScenario), character => character.charCodeAt(0));
  requireSource(await sha256(rawScenario) === mission.scenario.source.sha256, "raw SCN hash mismatch");
  const source = parseScenario(atob(mission.scenario.rawScenario));
  for (const field of ["id", "title", "terrainBank", "rawHeader", "placementRows"] as const) {
    requireSource(JSON.stringify(source[field]) === JSON.stringify(mission.scenario[field]), `mission ${field} differs from SCN`);
  }
  requireSource(mission.scenario.teams.length === source.teams.length, "SCN team count mismatch");
  for (const team of source.teams) for (const field of ["index", "enabled", "race", "money", "ai", "teamColor",
    "coordinateRows", "cityRows", "allies"] as const) {
    requireSource(JSON.stringify(team[field]) === JSON.stringify(mission.scenario.teams[team.index]?.[field]),
      `mission team ${team.index} ${field} differs from SCN`);
  }
  const bytes = await readBytes(assetUrl("/assets/generated/animations/VENT.json"));
  requireSource(await sha256(bytes) === "9ced90e6312ebfb2cf8e083c0ba48c418351c89f559329bed7fbdd1f8fbb5604",
    "VENT generated FIN hash mismatch");
  const animation = JSON.parse(new TextDecoder().decode(bytes)) as SourceBrowserResourceMetadata["animation"];
  requireSource(animation.schemaVersion === 1 && animation.formatTag === 29 && animation.source.path === "VENT.FIN"
    && animation.source.sha256 === "9f43206aba24f71a4a0cb7df841e09ebde2a243dc20310cd34644fed2c3ea84a",
  "unverified VENT FIN metadata");
  const initialized = initializeCampaignSession(sourceBrowserCampaignSessionOptions({ ...mission,
    scenario: { ...mission.scenario, ...source } }));
  requireSource(initialized.ok, initialized.ok ? "" : JSON.stringify(initialized.diagnostics));
  const world = initialized.value.world;
  const vent = mission.units.find(unit => unit.index === 40);
  requireSource(vent?.sprite === "VENT", "missing source VENT stats");
  const resources = world.entities.filter(entity => entity.unitType === 40).map(entity => {
    requireSource(entity.sourceRow !== null && entity.rawSlot !== null && entity.resource, "missing resource source identity");
    const row = source.placementRows[entity.sourceRow];
    requireSource(row?.[2] === 40, "resource row is not type 40");
    const decoded = initializeLegacyResource({ slot: entity.rawSlot, tileX: row[0], tileY: row[1],
      sourceRate: row[3], sourceReserve: row[4], typeReserve: vent.health,
      scales: { rateScale: 256, reserveScale: 256 } });
    requireSource(entity.team === 8 && entity.tileX === row[0] && entity.tileY === row[1]
      && entity.health === decoded.reserve && entity.resource.rateWord === decoded.rateWord,
    "resource actor differs from original SCN constructor");
    return { sourceRow: entity.sourceRow, key: entity.key, slot: entity.rawSlot, unitType: 40 as const, team: 8 as const,
      cell: { x: entity.tileX, y: entity.tileY }, reserve: decoded.reserve, health: entity.health, rateWord: decoded.rateWord };
  });
  requireSource(resources.length === source.placementRows.filter(row => row[2] === 40 && row[3] !== -1).length,
    "resource actors missing from source world");
  return freeze({ scope: "browser-adapted-resource-metadata-v1", source: { ...mission.scenario.source },
    paletteBank: missionPaletteBank(source.terrainBank), animation, resources });
}
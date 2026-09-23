import { assetUrl } from "./asset-url";
import {
  unitOptionsFromLegacy,
  type Faction,
  type LegacyUnitOptions,
  type LegacyUnitStat,
  type LegacyWeaponStat,
} from "./engine";
import type { RuntimeTriggerBlock } from "./engine/trigger-runtime";
import { initializeCampaignSession, type CampaignSessionUnit } from "./engine/campaign-session";
import { loadSourceProductionOptions, type SourceProductionBootConfiguration, type SourceProductionOptions } from "./engine/source-production-options";
import { loadSourceResourceOptions, selectSourceResourceConfiguration } from "./engine/source-resource-options";
import { loadBrowserCampaignResourceOptions, type SourceBrowserResourceMetadata } from "./engine/browser-campaign-resource-options";
import { auditMissionTriggerSupport } from "./engine/mission-controller";
import { createBrowserAiSelectorConfiguration } from "./engine/browser-campaign-runtime";
import { prepareSourceBrowserCampaignMission, type SourceBrowserCampaignMission } from "./engine/source-browser-campaign-options";
import { createBrowserConstructionConfiguration, type BrowserConstructionPolicy } from "./engine/browser-construction";
import type { DependencyRecord } from "../tools/extractors/data/tables";
import { VERIFIED_NATIVE_MBULLET_SHA256, type LegacyDamageMatrix } from "./engine/legacy-balance";
import {
  initializePublishedMissionPalette, missionPaletteBank, scenarioPaletteSelectors, validateMissionPaletteManifest,
} from "./render/palette-init";

interface DataEnvelope<T> {
  readonly schemaVersion: number;
  readonly records: readonly T[];
}

export interface SkirmishBalance {
  readonly humanCombat: LegacyUnitOptions;
  readonly alienCombat: LegacyUnitOptions;
  readonly humanHarvester: LegacyUnitOptions;
  readonly alienHarvester: LegacyUnitOptions;
}

export interface MissionScenario {
  readonly schemaVersion: 1;
  readonly source: { readonly path: string; readonly sha256: string };
  readonly rawScenario?: string;
  readonly terrainBank: string;
  readonly id: string;
  readonly title: string;
  readonly outcomes?: readonly { readonly reasonCode: number; readonly text: string; readonly rawText: string }[];
  readonly rawHeader: readonly string[];
  readonly teams: readonly {
    readonly index: number;
    readonly enabled: number;
    readonly race: number;
    readonly money: number;
    readonly ai: number;
    readonly teamColor: number;
    readonly coordinateRows: readonly [readonly number[], readonly number[]];
    readonly cityRows: readonly (readonly number[])[];
    readonly allies: readonly number[];
  }[];
  readonly placementRows: readonly (readonly number[])[];
}

export interface MissionMapMetadata {
  readonly schemaVersion: 2;
  readonly width: number;
  readonly height: number;
  readonly terrainBank: string;
  readonly referencesPerCell: 2;
  readonly files: {
    readonly tileReferences: string;
    readonly tileRecordIndices: string;
    readonly attributes: string;
    readonly pathGrid: string;
    readonly tags: string;
  };
}

export interface MissionTerrainMetadata {
  readonly schemaVersion: 1;
  readonly atlas: { readonly file: string; readonly width: number; readonly height: number };
  readonly tiles: readonly {
    readonly key: number;
    readonly x: number;
    readonly y: number;
    readonly width: 32;
    readonly height: 32;
  }[];
}

interface MissionTriggerEnvelope {
  readonly schemaVersion: 1;
  readonly blocks: readonly RuntimeTriggerBlock[];
}

interface MissionMessageEnvelope {
  readonly schemaVersion: 1;
  readonly messages: readonly { readonly id: number; readonly text: string }[];
}

export interface MissionBriefingEnvelope {
  readonly schemaVersion: 1;
  readonly rawText: string;
  readonly plainText: string;
  readonly objectives: readonly string[];
}

export interface CampaignMissionData {
  readonly faction: Faction;
  readonly scenario: MissionScenario;
  readonly triggers: readonly RuntimeTriggerBlock[];
  readonly messages: readonly { readonly id: number; readonly text: string }[];
  readonly briefing: MissionBriefingEnvelope;
  readonly map: MissionMapMetadata;
  readonly tileReferences: Uint16Array;
  readonly tileRecordIndices: Uint16Array;
  readonly attributes: Uint16Array;
  readonly pathGrid: Uint8Array;
  readonly tags: Uint8Array;
  readonly terrain: MissionTerrainMetadata;
  readonly terrainAtlasUrl: string;
  readonly units: readonly CampaignSessionUnit[];
  readonly weapons: readonly LegacyWeaponStat[];
  readonly damageMatrix?: LegacyDamageMatrix;
  readonly sourceResource?: Awaited<ReturnType<typeof loadSourceResourceOptions>>;
  readonly browserResource?: SourceBrowserResourceMetadata;
  readonly sourceProduction?: {
    readonly configuration: SourceProductionBootConfiguration;
    readonly initialPopulationCeiling: 150;
    readonly production?: SourceProductionOptions;
  };
}

export interface MissionDamageMatrixEnvelope {
  readonly schemaVersion: 1;
  readonly source: { readonly path: string; readonly sha256: string };
  readonly percentages: readonly (readonly number[])[];
  readonly coefficients: LegacyDamageMatrix;
}

const DATA_ROOT = assetUrl("/assets/generated/data");
const MAP_ROOT = assetUrl("/assets/generated/maps");
const TERRAIN_ROOT = assetUrl("/assets/generated/terrain");
export function campaignMissionStem(faction: Faction, missionNumber = 1): string {
  if ((faction !== "human" && faction !== "alien") ||
      !Number.isInteger(missionNumber) || missionNumber < 1 || missionNumber > 15) {
    throw new RangeError("Campaign requires human or alien and an integer mission number in 01..15");
  }
  const prefix = faction.toUpperCase();
  return `${prefix}/${prefix}${String(missionNumber).padStart(2, "0")}`;
}

export function campaignResultAction(missionNumber: number,
  outcome: { readonly ready: boolean; readonly resultCode: number } | null,
): { readonly kind: "next" | "retry"; readonly missionNumber: number } | null {
  campaignMissionStem("human", missionNumber);
  if (!outcome?.ready) return null;
  if (outcome.resultCode !== 0) return { kind: "retry", missionNumber };
  return missionNumber === 15 ? null : { kind: "next", missionNumber: missionNumber + 1 };
}

export function campaignPreflight(scenario: MissionScenario, blocks: readonly RuntimeTriggerBlock[],
  runtimeProfile?: "browser-adapted"): readonly string[] {
  const diagnostics: string[] = [];
  try { missionPaletteBank(scenario.terrainBank); } catch (error) {
    diagnostics.push(error instanceof Error ? error.message : String(error));
  }
  if (!["0", "1"].includes(scenario.rawHeader[1])) diagnostics.push("Unsupported source palette phase");
  try { scenarioPaletteSelectors(scenario.teams); } catch (error) {
    diagnostics.push(error instanceof Error ? error.message : String(error));
  }
  diagnostics.push(...auditMissionTriggerSupport(blocks, runtimeProfile === "browser-adapted" ? { browserAi: true, runtimeProfile } : undefined)
    .map((entry) => `TRO ${entry.triggerId ?? "program"}: ${entry.message}`));
  return diagnostics;
}

export async function loadCampaignResourceOptions(mission: CampaignMissionData,
  readBytes?: (url: string) => Promise<Uint8Array>, runtimeProfile?: "browser-adapted"): Promise<NonNullable<CampaignMissionData["sourceResource"]>> {
  if (typeof mission.scenario.rawScenario !== "string") throw new Error("Missing original SCN bytes for resources");
  const { rawScenario, ...source } = mission.scenario;
  const sessionId = `${source.id}:browser`;
  const initialized = initializeCampaignSession({ sessionId, source, units: mission.units, weapons: mission.weapons,
    ...(runtimeProfile === "browser-adapted" ? { runtimeProfile, browserAi: createBrowserAiSelectorConfiguration(source) } : {}),
    triggers: mission.triggers, messages: mission.messages, map: mission.map, pathGrid: mission.pathGrid, tags: mission.tags,
    commanders: [{ team: 0, unitType: mission.faction === "human" ? 69 : 73, sprite: mission.faction === "human" ? "TRSC" : "GRAY" }],
    directionBits: [[0, 0]], fixedStepMilliseconds: 50, orientationSteps: 1, resourceScales: "configured-startup" });
  if (!initialized.ok) throw new Error(JSON.stringify(initialized.diagnostics));
  return loadSourceResourceOptions({ sessionId, mission, world: initialized.value.world,
    rawScenario: Uint8Array.from(atob(rawScenario), (character) => character.charCodeAt(0)),
    configuration: selectSourceResourceConfiguration({ profile: "user-selected-source-campaign-fresh", mode: 0,
      localTeam: 0, race: mission.faction === "human" ? 0 : 1 }, "native-constructor"), loadBytes: readBytes });
}

async function loadJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return (await response.json()) as T;
}

async function loadBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function loadTable<T>(name: string): Promise<readonly T[]> {
  const envelope = await loadJson<DataEnvelope<T>>(`${DATA_ROOT}/${name}.json`);
  if (envelope.schemaVersion !== 1 || !Array.isArray(envelope.records)) {
    throw new Error(`Unsupported ${name} data schema`);
  }
  return envelope.records;
}

async function validateCampaignPalette(scenario: MissionScenario): Promise<void> {
  const root = assetUrl("/assets/generated/indexed");
  interface AssetDigest { path: string; bytes: number; sha256: string }
  interface TextureDescriptor extends AssetDigest { width: number; height: number; format: string }
  const bytes = (path: string) => {
    if (!/^[A-Za-z0-9_./-]+$/.test(path) || path.startsWith("/") || path.split("/").includes("..")) {
      throw new RangeError("Invalid indexed-root-relative asset path");
    }
    return loadBytes(`${root}/${path}`);
  };
  const digest = async (data: Uint8Array) => {
    const hash = await crypto.subtle.digest("SHA-256", Uint8Array.from(data).buffer);
    return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("");
  };
  const [manifestBytes, checksumBytes] = await Promise.all([bytes("index.json"), bytes("index.sha256")]);
  if (new TextDecoder().decode(checksumBytes).trim() !== `${await digest(manifestBytes)}  index.json`) {
    throw new Error("Indexed manifest checksum mismatch");
  }
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
    schemaVersion: number; verifiedInitialPalettes: string[];
    palettes: { name: string; metadata: string }[]; outputs: AssetDigest[];
  };
  const bank = validateMissionPaletteManifest(scenario.terrainBank, manifest);
  if (!Array.isArray(manifest.palettes) || !Array.isArray(manifest.outputs)) {
    throw new RangeError("Invalid indexed palette manifest entries");
  }
  const loadAsset = async (path: string) => {
    const entry = manifest.outputs.find((output) => output.path === path);
    if (!entry) throw new Error(`Asset absent from indexed manifest: ${path}`);
    const data = await bytes(path);
    if (data.length !== entry.bytes || await digest(data) !== entry.sha256) {
      throw new Error(`Indexed asset size/hash mismatch: ${path}`);
    }
    return data;
  };
  const entry = manifest.palettes.find((palette) => palette.name === bank);
  if (!entry) throw new RangeError(`Missing indexed palette: ${bank}`);
  const metadata = JSON.parse(new TextDecoder().decode(await loadAsset(entry.metadata))) as {
    schemaVersion: number; name: string; verifiedInitialUse: boolean;
    display: TextureDescriptor; remap: TextureDescriptor;
  };
  if (metadata.schemaVersion !== 1 || metadata.name !== bank || metadata.verifiedInitialUse !== true) {
    throw new RangeError(`Indexed ${bank} palette schema mismatch`);
  }
  const validateTexture = (descriptor: TextureDescriptor, height: number, format: string) => {
    const output = descriptor && manifest.outputs.find((entry) => entry.path === descriptor.path);
    if (!descriptor || descriptor.width !== 256 || descriptor.height !== height || descriptor.format !== format ||
        descriptor.bytes !== 256 * height * (format === "RGB8UI" ? 3 : 1) ||
        !output || output.bytes !== descriptor.bytes || output.sha256 !== descriptor.sha256) {
      throw new RangeError(`Indexed ${bank} palette texture descriptor mismatch`);
    }
  };
  validateTexture(metadata.display, 1, "RGB8UI");
  validateTexture(metadata.remap, 768, "R8UI");
  const [display, remap] = await Promise.all([loadAsset(metadata.display.path), loadAsset(metadata.remap.path)]);
  initializePublishedMissionPalette(scenario, display, remap);
}

async function loadDamageMatrix(): Promise<LegacyDamageMatrix> {
  const envelope = await loadJson<MissionDamageMatrixEnvelope>(`${DATA_ROOT}/damage-matrix.json`);
  if (envelope?.schemaVersion !== 1) throw new Error("Unsupported MBULLET damage matrix schema");
  if (envelope.source?.path !== "GAMESTAT/MBULLET.TXT" ||
      envelope.source.sha256 !== VERIFIED_NATIVE_MBULLET_SHA256) {
    throw new Error("Unverified MBULLET damage matrix source");
  }
  for (const matrix of [envelope.percentages, envelope.coefficients]) {
    if (!Array.isArray(matrix) || matrix.length !== 9 ||
        matrix.some((row) => !Array.isArray(row) || row.length !== 10 ||
          row.some((value) => !Number.isInteger(value) || value < 0 || value > 32767))) {
      throw new Error("MBULLET damage matrix requires 9x10 non-negative integer values in 0..32767");
    }
  }
  if (envelope.coefficients.some((row, rowIndex) => row.some((coefficient, columnIndex) =>
    coefficient !== Math.trunc(envelope.percentages[rowIndex][columnIndex] * 0.01 * 256)))) {
    throw new Error("MBULLET damage matrix Q8 coefficients do not match source percentages");
  }
  return envelope.coefficients;
}

function uint16LittleEndian(bytes: Uint8Array): Uint16Array {
  if (bytes.byteLength % 2 !== 0) throw new Error("u16 mission layer has an odd byte length");
  const values = new Uint16Array(bytes.byteLength / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < values.length; index += 1) values[index] = view.getUint16(index * 2, true);
  return values;
}

function unit(records: readonly LegacyUnitStat[], index: number, sprite: string): LegacyUnitStat {
  const record = records.find((candidate) => candidate.index === index);
  if (!record || record.sprite !== sprite) {
    throw new Error(`Missing original unit ${index} (${sprite})`);
  }
  return record;
}

export async function loadSkirmishBalance(): Promise<SkirmishBalance> {
  const [units, weapons] = await Promise.all([
    loadTable<CampaignSessionUnit>("units"),
    loadTable<LegacyWeaponStat>("weapons"),
  ]);
  return {
    humanCombat: unitOptionsFromLegacy(unit(units, 0, "TRSC"), weapons),
    alienCombat: unitOptionsFromLegacy(unit(units, 8, "GRAY"), weapons),
    humanHarvester: unitOptionsFromLegacy(unit(units, 6, "EXPL"), weapons),
    alienHarvester: unitOptionsFromLegacy(unit(units, 14, "SLUG"), weapons),
  };
}

export function campaignConstructionPolicy(faction: Faction, missionNumber: number,
  runtimeProfile?: "browser-adapted", checkpoint?: unknown): BrowserConstructionPolicy | undefined {
  if (checkpoint !== undefined) {
    const saved = (checkpoint as { session?: { options?: { browserConstruction?: {
      policy?: { completionVisits?: number }; supportedSlots?: readonly number[]; supportedActions?: BrowserConstructionPolicy["supportedActions"];
    } } } } | null)?.session?.options?.browserConstruction;
    return saved ? { completionVisits: saved.policy?.completionVisits ?? NaN,
      ...(saved.supportedSlots !== undefined ? { supportedSlots: saved.supportedSlots } : {}),
      ...(saved.supportedActions !== undefined ? { supportedActions: saved.supportedActions } : {}) } : undefined;
  }
  return runtimeProfile === "browser-adapted" && missionNumber >= 4
    ? { completionVisits: 120, supportedSlots: faction === "alien" && missionNumber === 10 ? [0, 1, 2, 3, 4] : [1, 2, 3, 4], supportedActions: ["purchase", "upgrade"] }
    : undefined;
}

export async function loadCampaignMission(faction: Faction, missionNumber = 1,
  runtimeProfile?: "browser-adapted", construction?: BrowserConstructionPolicy): Promise<SourceBrowserCampaignMission> {
  const stem = campaignMissionStem(faction, missionNumber);
  if (runtimeProfile !== undefined && runtimeProfile !== "browser-adapted") throw new TypeError("Unknown campaign runtime profile");
  try {
    if (construction && (runtimeProfile !== "browser-adapted"
      || construction.supportedSlots === undefined && (faction !== "alien" || missionNumber !== 10))) {
      throw new TypeError("Browser construction supports only explicitly adapted ALIEN10");
    }
    return await loadCampaignMissionSource(faction, stem, runtimeProfile, missionNumber, construction);
  } catch (error) {
    throw new Error(`Unsupported mission ${stem}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function loadCampaignMissionSource(faction: Faction, stem: string,
  runtimeProfile?: "browser-adapted", missionNumber = 1, construction?: BrowserConstructionPolicy): Promise<SourceBrowserCampaignMission> {
  const index = await loadJson<{ schemaVersion: number; files: { damageMatrix: string; scenarios: readonly {
    source: string; metadata: string; triggers: string | null; messages: string | null; briefing: string | null;
  }[] } }>(`${DATA_ROOT}/index.json`);
  const entry = index.files.scenarios.find(({ source }) => source === `${stem}.SCN`);
  if (index.schemaVersion !== 1 || !entry || entry.metadata !== `scenarios/${stem}.json` ||
      entry.triggers !== `triggers/${stem}.json` || entry.messages !== `messages/${stem}.json` ||
      entry.briefing !== `briefings/${stem}.json`) {
    throw new Error("Missing indexed source scenario, TRO, messages or briefing");
  }
  if (index.files.damageMatrix !== "damage-matrix.json") throw new Error("Missing indexed MBULLET damage matrix");
  const mapDirectory = stem.slice(0, stem.lastIndexOf("/"));
  const [scenario, triggerEnvelope, messageEnvelope, briefing, map, units, weapons, damageMatrix] = await Promise.all([
    loadJson<MissionScenario>(`${DATA_ROOT}/scenarios/${stem}.json`),
    loadJson<MissionTriggerEnvelope>(`${DATA_ROOT}/triggers/${stem}.json`),
    loadJson<MissionMessageEnvelope>(`${DATA_ROOT}/messages/${stem}.json`),
    loadJson<MissionBriefingEnvelope>(`${DATA_ROOT}/briefings/${stem}.json`),
    loadJson<MissionMapMetadata>(`${MAP_ROOT}/${stem}.json`),
    loadTable<CampaignSessionUnit>("units"),
    loadTable<LegacyWeaponStat>("weapons"),
    loadDamageMatrix(),
  ]);
  if (
    scenario.schemaVersion !== 1 ||
    triggerEnvelope.schemaVersion !== 1 ||
    messageEnvelope.schemaVersion !== 1 ||
    briefing.schemaVersion !== 1 ||
    map.schemaVersion !== 2 || map.referencesPerCell !== 2
  ) {
    throw new Error(`Unsupported ${stem} mission schema`);
  }
  if (scenario.terrainBank.toLowerCase() !== map.terrainBank.toLowerCase()) {
    throw new Error(`${stem} terrain bank mismatch`);
  }
  if (scenario.source.path !== `${stem}.SCN` || scenario.id.toUpperCase() !== stem.split("/")[1]) {
    throw new Error("Source scenario identity does not match requested mission");
  }
  if (!Number.isInteger(map.width) || !Number.isInteger(map.height) ||
      map.width < 1 || map.height < 1 || map.width > 255 || map.height > 255) {
    throw new Error("Unsupported native map dimensions");
  }
  if (typeof scenario.rawScenario !== "string") throw new Error("Missing original SCN bytes for production");
  const sourceProduction = await loadSourceProductionOptions({
    sessionId: `${scenario.id}:browser`, mission: { faction, scenario, units },
    rawScenario: Uint8Array.from(atob(scenario.rawScenario), (character) => character.charCodeAt(0)),
    configuration: { profile: "user-selected-source-campaign-fresh", mode: 0, localTeam: 0,
      race: faction === "human" ? 0 : 1 },
    ...(construction ? { deferEmptyCentralBase: true } : {}),
    ...(runtimeProfile === "browser-adapted" ? {
      adaptedCollectors: { runtimeProfile, completionVisits: 120 },
      ...(missionNumber >= 3 ? { adaptedUnits: { runtimeProfile, completionVisits: 120 }, adaptedUpgrades: { runtimeProfile } } : {}),
    } : {}),
  });
  const diagnostics = campaignPreflight(scenario, triggerEnvelope.blocks, runtimeProfile);
  if (diagnostics.length) throw new Error(diagnostics.join("; "));
  if (!briefing.plainText.trim()) throw new Error("Missing source briefing text");
  for (const block of triggerEnvelope.blocks) for (const action of block.actions) {
    if (action.name === "bail" && !scenario.outcomes?.some(({ reasonCode }) => reasonCode === action.arguments[1])) {
      throw new Error(`TRO ${block.id}: missing source outcome ${action.arguments[1]}`);
    }
    if (action.name === "msg" && !messageEnvelope.messages.some(({ id }) => id === action.arguments[2])) {
      throw new Error(`TRO ${block.id}: missing source message ${action.arguments[2]}`);
    }
  }
  const terrainStem = missionPaletteBank(map.terrainBank);
  await validateCampaignPalette(scenario);
  const [referenceBytes, recordBytes, attributeBytes, pathGrid, tags, terrain] = await Promise.all([
    loadBytes(`${MAP_ROOT}/${mapDirectory}/${map.files.tileReferences}`),
    loadBytes(`${MAP_ROOT}/${mapDirectory}/${map.files.tileRecordIndices}`),
    loadBytes(`${MAP_ROOT}/${mapDirectory}/${map.files.attributes}`),
    loadBytes(`${MAP_ROOT}/${mapDirectory}/${map.files.pathGrid}`),
    loadBytes(`${MAP_ROOT}/${mapDirectory}/${map.files.tags}`),
    loadJson<MissionTerrainMetadata>(`${TERRAIN_ROOT}/${terrainStem}.json`),
  ]);
  if (terrain.schemaVersion !== 1 || !terrain.tiles.length) throw new Error("Unsupported terrain atlas schema");
  const tileReferences = uint16LittleEndian(referenceBytes);
  const tileRecordIndices = uint16LittleEndian(recordBytes);
  const attributes = uint16LittleEndian(attributeBytes);
  const cellCount = map.width * map.height;
  if (tileReferences.length !== cellCount * 2 || tileRecordIndices.length !== cellCount * 2 ||
      attributes.length !== cellCount || pathGrid.length !== cellCount || tags.length !== cellCount ||
      tileRecordIndices.some((index) => index >= terrain.tiles.length)) {
    throw new Error(`${stem} generated map layer length mismatch`);
  }
  const mission: CampaignMissionData = {
    faction,
    scenario,
    triggers: triggerEnvelope.blocks,
    messages: messageEnvelope.messages,
    briefing,
    map,
    tileReferences,
    tileRecordIndices,
    attributes,
    pathGrid,
    tags,
    terrain,
    terrainAtlasUrl: `${TERRAIN_ROOT}/${terrain.atlas.file}`,
    units,
    weapons,
    damageMatrix,
    sourceProduction: { configuration: sourceProduction.configuration,
      initialPopulationCeiling: sourceProduction.initialPopulationCeiling,
      ...(sourceProduction.production ? { production: sourceProduction.production } : {}) },
  };
  const browserConstruction = construction ? await createBrowserConstructionConfiguration({
    runtimeProfile: "browser-adapted", mission, completionVisits: construction.completionVisits,
    ...(construction.supportedSlots !== undefined ? { supportedSlots: construction.supportedSlots } : {}),
    ...(construction.supportedActions !== undefined ? { supportedActions: construction.supportedActions } : {}) }) : undefined;
  const prepared = { ...mission, ...(browserConstruction ? { browserConstruction } : {}) };
  const sourced = scenario.placementRows.some((row) => row[2] === 40)
    ? runtimeProfile === "browser-adapted"
      ? { ...prepared, browserResource: await loadBrowserCampaignResourceOptions(prepared) }
      : { ...mission, sourceResource: await loadCampaignResourceOptions(mission, undefined, runtimeProfile) }
    : prepared;
  if (runtimeProfile !== "browser-adapted") return sourced;
  const dependencies = await loadTable<DependencyRecord>("dependencies");
  return { ...sourced, ...await prepareSourceBrowserCampaignMission(sourced, dependencies) };
}

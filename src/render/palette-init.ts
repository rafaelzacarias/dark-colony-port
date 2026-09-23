import { lightingRow, readNativeGifPalette, RemapTable } from "./palette.js";

export const NATIVE_FIN_BRIGHTNESS = 16;
export const NATIVE_VISIBLE_TERRAIN_BRIGHTNESS = 16;
export const NATIVE_REMEMBERED_TERRAIN_BRIGHTNESS = 10;

export interface PaletteScenarioTeam {
  readonly index: number;
  readonly teamColor: number;
}

export interface PaletteScenario {
  readonly terrainBank: string;
  readonly rawHeader: readonly string[];
  readonly teams: readonly PaletteScenarioTeam[];
}

function integer(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer in ${minimum}..${maximum}`);
  }
}

export function scenarioPaletteSelector(teamIndex: number, teamColor: number): number {
  integer(teamIndex, 0, 7, "SCN team index");
  integer(teamColor, -2147483648, 2147483647, "SCN team color");
  return teamColor >= 0 && teamColor <= 7 ? teamColor : teamIndex;
}

export function scenarioPaletteSelectors(teams: readonly PaletteScenarioTeam[]): Uint8Array {
  if (teams.length !== 8) throw new RangeError("Expected all eight native SCN team slots");
  const seen = new Set<number>();
  const selectors = new Uint8Array(8);
  for (const team of teams) {
    const selector = scenarioPaletteSelector(team.index, team.teamColor);
    if (seen.has(team.index)) throw new RangeError("Duplicate SCN team index");
    seen.add(team.index);
    selectors[team.index] = selector;
  }
  return selectors;
}

export function entityPaletteSelector(
  ownerByte: number, overrideByte: number, selectors: Uint8Array,
): number {
  integer(ownerByte, 0, 255, "entity owner byte");
  integer(overrideByte, 0, 255, "entity override byte");
  if (selectors.length !== 8 || selectors.some((selector) => selector > 7)) {
    throw new RangeError("Expected eight validated team palette selectors");
  }
  return selectors[(overrideByte === 8 ? ownerByte : overrideByte) & 7];
}

export function finBodyPaletteLookup(ownerByte: number, overrideByte: number, selectors: Uint8Array) {
  return {
    bank: 2 as const,
    brightness: NATIVE_FIN_BRIGHTNESS,
    selector: entityPaletteSelector(ownerByte, overrideByte, selectors),
  };
}

export function terrainPaletteLookup(dayNightBlend: number, brightness: number) {
  integer(dayNightBlend, 0, 256, "native day/night blend");
  integer(brightness, 0, 16, "terrain visibility brightness");
  return { bank: 0 as const, brightness, selector: Math.trunc(7 * dayNightBlend / 256) };
}

export function terrainInterpolatedRow(
  startBrightness: number, endBrightness: number, pixel: number, dayNightBlend: number,
): number {
  integer(startBrightness, 0, 16, "start brightness");
  integer(endBrightness, 0, 16, "end brightness");
  integer(pixel, 0, 31, "interpolation pixel");
  const brightness = Math.trunc((endBrightness * pixel + startBrightness * (31 - pixel)) / 31);
  const lookup = terrainPaletteLookup(dayNightBlend, brightness);
  return lightingRow(lookup.brightness, lookup.selector);
}

export const VERIFIED_TERRAIN_PALETTES: readonly string[] = Object.freeze(["ATLANTIS", "DESERT", "HTRAIN", "JUNGLE"]);

export function missionPaletteBank(terrainBank: string): string {
  const bank = terrainBank.toUpperCase();
  const name = bank.slice(0, -4);
  if (!bank.endsWith(".BTS") || !VERIFIED_TERRAIN_PALETTES.includes(name)) {
    throw new RangeError(`Unverified mission terrain palette: ${terrainBank}`);
  }
  return name;
}

export function validateMissionPaletteManifest(terrainBank: string, manifest: {
  readonly schemaVersion: number;
  readonly verifiedInitialPalettes: readonly string[];
}): string {
  const bank = missionPaletteBank(terrainBank);
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.verifiedInitialPalettes) ||
      !manifest.verifiedInitialPalettes.includes(bank)) {
    throw new RangeError("Unsupported indexed manifest or unverified initial palette");
  }
  return bank;
}

export function initializePublishedMissionPalette(
  scenario: PaletteScenario, display: Uint8Array, remap: Uint8Array,
): ReturnType<typeof initializeMissionPalette> {
  if (display.length !== 768 || display.subarray(0, 3).some((value) => value !== 0) ||
      display.subarray(765).some((value) => value !== 255)) {
    throw new RangeError("Expected published native RGB8 display palette with black/white endpoints");
  }
  const tableEnvelope = new Uint8Array(13 + 768);
  tableEnvelope.set(new TextEncoder().encode("GIF89a"));
  tableEnvelope[10] = 0x87;
  tableEnvelope.set(display, 13);
  return initializeMissionPalette(scenario, tableEnvelope, remap);
}

export function initializeMissionPalette(
  scenario: PaletteScenario, gif: Uint8Array, rmp: Uint8Array,
) {
  missionPaletteBank(scenario.terrainBank);
  const phaseText = scenario.rawHeader[1];
  if (phaseText !== "0" && phaseText !== "1") {
    throw new RangeError("Expected native SCN day/night phase 0 or 1");
  }
  const dayNightBlend = Number(phaseText) * 256;
  return {
    palette: readNativeGifPalette(gif),
    remap: new RemapTable(rmp),
    teamSelectors: scenarioPaletteSelectors(scenario.teams),
    dayNightBlend,
    visibleTerrain: terrainPaletteLookup(dayNightBlend, NATIVE_VISIBLE_TERRAIN_BRIGHTNESS),
  };
}

export function initializeDesertMissionPalette(
  scenario: PaletteScenario, desertGif: Uint8Array, desertRmp: Uint8Array,
) {
  if (missionPaletteBank(scenario.terrainBank) !== "DESERT") {
    throw new RangeError("Only DESERT mission initialization is accepted by this compatibility helper");
  }
  return initializeMissionPalette(scenario, desertGif, desertRmp);
}
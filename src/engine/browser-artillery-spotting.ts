import { areHostile, type TeamAlliances } from "./diplomacy";
import { withinSourceWeaponRange, type Faction } from "./simulation";

export const HUMAN_ARTILLERY_UNIT_TYPE = 3 as const;
export const ALIEN_ARTILLERY_UNIT_TYPE = 11 as const;
export const ARTILLERY_UNIT_TYPES = Object.freeze([
  HUMAN_ARTILLERY_UNIT_TYPE,
  ALIEN_ARTILLERY_UNIT_TYPE,
] as const);

export type BrowserArtilleryUnitType = typeof ARTILLERY_UNIT_TYPES[number];
export type BrowserArtillerySprite = "BARR" | "ATRIL";
export type ArtilleryWeaponUpgradeLevel = 0 | 1 | 2;

export const HUMAN_SCOUT_UNIT_TYPE = 5 as const;
export const ALIEN_SCOUT_UNIT_TYPE = 13 as const;
export const AVII_SCOUT_UNIT_TYPE = 24 as const;
export const SCOUT_SPOTTER_UNIT_TYPES = Object.freeze([
  HUMAN_SCOUT_UNIT_TYPE,
  ALIEN_SCOUT_UNIT_TYPE,
  AVII_SCOUT_UNIT_TYPE,
] as const);

export type BrowserScoutSpotterUnitType = typeof SCOUT_SPOTTER_UNIT_TYPES[number];
export type BrowserScoutSpotterSprite = "SCGM" | "ORTU" | "AVII";

export const ARTILLERY_WEAPON_RANGES_BY_LEVEL = Object.freeze([12, 14, 16] as const);
export const ARTILLERY_WEAPON_RANGES_BY_ID: Readonly<Record<number, number>> = Object.freeze({
  10: 12,
  11: 14,
  12: 16,
  24: 12,
  25: 14,
  26: 16,
});

export const DEFAULT_UNSPOTTED_ARTILLERY_SIGHT_CELLS = 4 as const;
export const DEFAULT_SCOUT_RANGE_BONUS_CELLS = 4 as const;
export const SCGM_OBSERVATION_RANGE_CELLS = 8 as const;
export const ORTU_OBSERVATION_RANGE_CELLS = 8 as const;
export const AVII_OBSERVATION_RANGE_CELLS = 11 as const;

export const HTRAIN5_SPOTTING_MESSAGE_ID = 10 as const;
export const HTRAIN5_SPOTTING_MESSAGE_TEXT = "BARRAGER'S Firing Range Increased By The OSPREY IV" as const;
export const ATRAIN5_SPOTTING_MESSAGE_ID = 10 as const;
export const ATRAIN5_SPOTTING_MESSAGE_TEXT = "ATRIL Firing Range Increased By ORTU" as const;

export interface BrowserArtilleryProfile {
  readonly unitType: BrowserArtilleryUnitType;
  readonly sprite: BrowserArtillerySprite;
  readonly faction: 0 | 1;
  readonly factionName: Faction;
  readonly turnSpeed: 5;
  readonly movementSpeed: 15;
  /** Unspotted self-observation sight in training / night (BARR) or day (ATRIL). */
  readonly observationDay: 4 | 7;
  readonly observationNight: 4 | 7;
  /** Raw GAMESTAT.TXT observation fields (`units.json`). */
  readonly gamestatObservationDay: 7 | 4;
  readonly gamestatObservationNight: 4 | 7;
  readonly weapons: readonly [number, number, number];
  readonly weaponRanges: readonly [12, 14, 16];
  readonly armorUpgradePercentages: readonly [125, 150];
  readonly targetClass: 3;
  readonly health: 400;
  readonly primaryScoutUnitType: 5 | 13;
  readonly primaryScoutSprite: "SCGM" | "ORTU";
  readonly trainingMissionId: "HTRAIN5" | "ATRAIN5";
  readonly trainingMessageId: 10;
  readonly trainingMessageText: string;
}

export interface BrowserScoutSpotterProfile {
  readonly unitType: BrowserScoutSpotterUnitType;
  readonly sprite: BrowserScoutSpotterSprite;
  readonly faction: 0 | 1;
  readonly factionName: Faction;
  readonly turnSpeed: 10 | 25;
  readonly movementSpeed: 47 | 35;
  /** Effective scout observation radius (`8` for `SCGM`/`ORTU`, `11` for `AVII`). */
  readonly observationDay: 8 | 11;
  readonly observationNight: 8 | 11;
  /** Raw GAMESTAT.TXT observation fields (`units.json`). */
  readonly gamestatObservationDay: 8 | 4;
  readonly gamestatObservationNight: 8 | 6;
  readonly weapons: readonly [number, number, number];
  readonly armorUpgradePercentages: readonly [number, number];
  readonly targetClass: 2;
  readonly health: 800 | 250;
  readonly movementPlane: "air";
}

export const BROWSER_ARTILLERY_PROFILES: Readonly<Record<BrowserArtilleryUnitType, BrowserArtilleryProfile>> = Object.freeze({
  3: Object.freeze({
    unitType: HUMAN_ARTILLERY_UNIT_TYPE,
    sprite: "BARR",
    faction: 0,
    factionName: "human",
    turnSpeed: 5,
    movementSpeed: 15,
    observationDay: 4,
    observationNight: 4,
    gamestatObservationDay: 7,
    gamestatObservationNight: 4,
    weapons: Object.freeze([10, 11, 12] as const),
    weaponRanges: ARTILLERY_WEAPON_RANGES_BY_LEVEL,
    armorUpgradePercentages: Object.freeze([125, 150] as const),
    targetClass: 3,
    health: 400,
    primaryScoutUnitType: HUMAN_SCOUT_UNIT_TYPE,
    primaryScoutSprite: "SCGM",
    trainingMissionId: "HTRAIN5",
    trainingMessageId: HTRAIN5_SPOTTING_MESSAGE_ID,
    trainingMessageText: HTRAIN5_SPOTTING_MESSAGE_TEXT,
  }),
  11: Object.freeze({
    unitType: ALIEN_ARTILLERY_UNIT_TYPE,
    sprite: "ATRIL",
    faction: 1,
    factionName: "alien",
    turnSpeed: 5,
    movementSpeed: 15,
    observationDay: 4,
    observationNight: 7,
    gamestatObservationDay: 4,
    gamestatObservationNight: 7,
    weapons: Object.freeze([24, 25, 26] as const),
    weaponRanges: ARTILLERY_WEAPON_RANGES_BY_LEVEL,
    armorUpgradePercentages: Object.freeze([125, 150] as const),
    targetClass: 3,
    health: 400,
    primaryScoutUnitType: ALIEN_SCOUT_UNIT_TYPE,
    primaryScoutSprite: "ORTU",
    trainingMissionId: "ATRAIN5",
    trainingMessageId: ATRAIN5_SPOTTING_MESSAGE_ID,
    trainingMessageText: ATRAIN5_SPOTTING_MESSAGE_TEXT,
  }),
});

export const BROWSER_SCOUT_SPOTTER_PROFILES: Readonly<Record<BrowserScoutSpotterUnitType, BrowserScoutSpotterProfile>> = Object.freeze({
  5: Object.freeze({
    unitType: HUMAN_SCOUT_UNIT_TYPE,
    sprite: "SCGM",
    faction: 0,
    factionName: "human",
    turnSpeed: 10,
    movementSpeed: 47,
    observationDay: SCGM_OBSERVATION_RANGE_CELLS,
    observationNight: SCGM_OBSERVATION_RANGE_CELLS,
    gamestatObservationDay: 8,
    gamestatObservationNight: 8,
    weapons: Object.freeze([37, 44, 45] as const),
    armorUpgradePercentages: Object.freeze([125, 150] as const),
    targetClass: 2,
    health: 800,
    movementPlane: "air",
  }),
  13: Object.freeze({
    unitType: ALIEN_SCOUT_UNIT_TYPE,
    sprite: "ORTU",
    faction: 1,
    factionName: "alien",
    turnSpeed: 10,
    movementSpeed: 47,
    observationDay: ORTU_OBSERVATION_RANGE_CELLS,
    observationNight: ORTU_OBSERVATION_RANGE_CELLS,
    gamestatObservationDay: 8,
    gamestatObservationNight: 8,
    weapons: Object.freeze([37, 44, 45] as const),
    armorUpgradePercentages: Object.freeze([125, 150] as const),
    targetClass: 2,
    health: 800,
    movementPlane: "air",
  }),
  24: Object.freeze({
    unitType: AVII_SCOUT_UNIT_TYPE,
    sprite: "AVII",
    faction: 1,
    factionName: "alien",
    turnSpeed: 25,
    movementSpeed: 35,
    observationDay: AVII_OBSERVATION_RANGE_CELLS,
    observationNight: AVII_OBSERVATION_RANGE_CELLS,
    gamestatObservationDay: 4,
    gamestatObservationNight: 6,
    weapons: Object.freeze([53, 53, 53] as const),
    armorUpgradePercentages: Object.freeze([120, 140] as const),
    targetClass: 2,
    health: 250,
    movementPlane: "air",
  }),
});

export interface BrowserUnitIdentityInput {
  readonly id?: number;
  readonly unitType?: number | string;
  readonly index?: number;
  readonly type?: number | string;
  readonly sourceTypeIndex?: number;
  readonly sprite?: string;
  readonly faction?: number | Faction;
  readonly team?: number;
  readonly owner?: number;
  readonly weapons?: readonly number[];
  readonly weaponId?: number;
  readonly weaponLevel?: number;
  readonly upgradeLevel?: number;
  readonly weaponRange?: number;
  readonly weaponRangeCells?: number;
  readonly weapon?: {
    readonly id?: number;
    readonly weaponId?: number;
    readonly range?: number;
    readonly rangeCells?: number;
  } | null;
  readonly observationRange?: number;
  readonly sightRange?: number;
  readonly selfSightRange?: number;
  readonly unspottedRange?: number;
  readonly observationDay?: number;
  readonly observationNight?: number;
  readonly dayRangeCells?: number;
  readonly nightRangeCells?: number;
  readonly vision?: {
    readonly dayRangeCells: number;
    readonly nightRangeCells: number;
  } | null;
  readonly x?: number;
  readonly y?: number;
  readonly cellX?: number;
  readonly cellY?: number;
  readonly tileX?: number;
  readonly tileY?: number;
  readonly cell?: { readonly x: number; readonly y: number };
  readonly cells?: readonly { readonly x: number; readonly y: number }[];
  readonly health?: number;
  readonly maxHealth?: number;
  readonly activity?: string;
  readonly dead?: boolean;
  readonly dying?: boolean;
  readonly status?: number;
}

export type BrowserUnitTypeOrSpriteInput =
  | number
  | string
  | BrowserUnitIdentityInput
  | null
  | undefined;

export type BrowserArtilleryActorInput =
  | number
  | string
  | BrowserUnitIdentityInput;

export type BrowserScoutSpotterInput =
  | number
  | string
  | BrowserUnitIdentityInput;

export type BrowserArtilleryTargetInput =
  | { readonly x: number; readonly y: number }
  | { readonly cellX: number; readonly cellY: number }
  | { readonly tileX: number; readonly tileY: number }
  | { readonly cell: { readonly x: number; readonly y: number } }
  | readonly [number, number]
  | BrowserUnitIdentityInput;

export interface WeaponRangeLookupRecord {
  readonly id: number;
  readonly range: number;
}

export type WeaponRangeLookup =
  | ReadonlyMap<number, number>
  | Readonly<Record<number, number>>
  | readonly WeaponRangeLookupRecord[]
  | { readonly records: readonly WeaponRangeLookupRecord[] };

export interface BrowserArtillerySpottingOptions {
  readonly isNight?: boolean;
  readonly timeOfDay?: "day" | "night";
  readonly daylightPermille?: number;
  readonly weaponLevel?: number;
  readonly upgradeLevel?: number;
  readonly weaponId?: number;
  readonly weaponRange?: number;
  readonly weaponRangeCells?: number;
  readonly weapons?: WeaponRangeLookup;
  readonly selfSightRange?: number;
  readonly unspottedRange?: number;
  readonly useGamestatDaySight?: boolean;
  readonly scoutRangeBonus?: number;
  readonly bonusRangeCells?: number;
  readonly includeScoutRangeBonus?: boolean;
  readonly team?: number;
  readonly owner?: number;
  readonly faction?: number | Faction;
  readonly artillery?: BrowserArtilleryActorInput;
  readonly target?: BrowserArtilleryTargetInput;
  readonly teamAlliances?: TeamAlliances;
  readonly alliances?: TeamAlliances;
  readonly sharedVision?: readonly (readonly number[])[];
  readonly isAllied?: (scout: BrowserUnitIdentityInput) => boolean;
  readonly isCellVisible?: (x: number, y: number) => boolean;
  readonly requireTargetWithinScoutSight?: boolean;
}

export interface ResolvedArtilleryEffectiveRange {
  readonly isArtillery: boolean;
  readonly unitType: BrowserArtilleryUnitType | null;
  readonly sprite: BrowserArtillerySprite | null;
  readonly weaponLevel: ArtilleryWeaponUpgradeLevel;
  readonly weaponId: number | null;
  readonly selfSightRange: number;
  readonly unspottedRange: number;
  readonly weaponRange: number;
  readonly fullWeaponRange: number;
  readonly scoutRangeBonus: number;
  readonly maxScoutRangeBonus: number;
  readonly spottedRange: number;
  readonly spottedRangeWithBonus: number;
  readonly bonusWeaponRange: number;
  readonly hasActiveScout: boolean;
  readonly isSpotted: boolean;
  readonly spottingScouts: readonly BrowserUnitIdentityInput[];
  readonly effectiveRange: number;
  readonly effectiveRangeWithBonus: number;
  readonly canArtilleryAcquireTarget: (
    target: BrowserArtilleryTargetInput,
    overrideOptions?: BrowserArtillerySpottingOptions,
  ) => boolean;
  readonly canAcquireTarget: (
    target: BrowserArtilleryTargetInput,
    overrideOptions?: BrowserArtillerySpottingOptions,
  ) => boolean;
  readonly isCellVisible: (x: number, y: number) => boolean;
}

function normalizeSprite(sprite: unknown): string | null {
  if (typeof sprite !== "string") return null;
  const trimmed = sprite.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}

function numericTypeFromObject(input: BrowserUnitIdentityInput): number | null {
  for (const candidate of [input.unitType, input.index, input.type, input.sourceTypeIndex]) {
    if (typeof candidate === "number" && Number.isInteger(candidate)) return candidate;
  }
  return null;
}

function spriteFromObject(input: BrowserUnitIdentityInput): string | null {
  for (const candidate of [input.sprite, input.unitType, input.type]) {
    const normalized = normalizeSprite(candidate);
    if (normalized) return normalized;
  }
  return null;
}

export function resolveArtilleryUnitType(
  unitTypeOrSprite: BrowserUnitTypeOrSpriteInput,
  sprite?: string,
  sourceTypeIndex?: number,
): BrowserArtilleryUnitType | null {
  if (typeof unitTypeOrSprite === "number") {
    if (unitTypeOrSprite === HUMAN_ARTILLERY_UNIT_TYPE || unitTypeOrSprite === ALIEN_ARTILLERY_UNIT_TYPE) {
      return unitTypeOrSprite;
    }
    return null;
  }
  if (typeof unitTypeOrSprite === "string") {
    const normalized = normalizeSprite(unitTypeOrSprite);
    if (normalized === "BARR") return HUMAN_ARTILLERY_UNIT_TYPE;
    if (normalized === "ATRIL") return ALIEN_ARTILLERY_UNIT_TYPE;
    return null;
  }
  if (unitTypeOrSprite && typeof unitTypeOrSprite === "object") {
    const numType = numericTypeFromObject(unitTypeOrSprite);
    if (numType !== null) {
      if (numType === HUMAN_ARTILLERY_UNIT_TYPE || numType === ALIEN_ARTILLERY_UNIT_TYPE) {
        if (Array.isArray(unitTypeOrSprite.weapons) && unitTypeOrSprite.weapons.length > 0 && unitTypeOrSprite.weapons[0] < 0) {
          return null;
        }
        return numType;
      }
      return null;
    }
    const objSprite = spriteFromObject(unitTypeOrSprite);
    if (objSprite === "BARR" || objSprite === "ATRIL") {
      if (Array.isArray(unitTypeOrSprite.weapons) && unitTypeOrSprite.weapons.length > 0 && unitTypeOrSprite.weapons[0] < 0) {
        return null;
      }
      return objSprite === "BARR" ? HUMAN_ARTILLERY_UNIT_TYPE : ALIEN_ARTILLERY_UNIT_TYPE;
    }
  }
  const fallbackSprite = normalizeSprite(sprite);
  if (fallbackSprite === "BARR") return HUMAN_ARTILLERY_UNIT_TYPE;
  if (fallbackSprite === "ATRIL") return ALIEN_ARTILLERY_UNIT_TYPE;
  if (sourceTypeIndex === HUMAN_ARTILLERY_UNIT_TYPE || sourceTypeIndex === ALIEN_ARTILLERY_UNIT_TYPE) {
    return sourceTypeIndex;
  }
  return null;
}

/**
 * Recognizes Human Artillery `BARR` (unit type `3`) and Alien Artillery `ATRIL` (unit type `11`).
 */
export function isArtilleryUnit(unitTypeOrSprite: BrowserUnitTypeOrSpriteInput): boolean {
  return resolveArtilleryUnitType(unitTypeOrSprite) !== null;
}

export function getArtilleryProfile(unitTypeOrSprite: BrowserUnitTypeOrSpriteInput): BrowserArtilleryProfile | null {
  const unitType = resolveArtilleryUnitType(unitTypeOrSprite);
  return unitType !== null ? BROWSER_ARTILLERY_PROFILES[unitType] : null;
}

export function resolveScoutSpotterUnitType(
  unitTypeOrSprite: BrowserUnitTypeOrSpriteInput,
  sprite?: string,
  sourceTypeIndex?: number,
): BrowserScoutSpotterUnitType | null {
  if (typeof unitTypeOrSprite === "number") {
    if (
      unitTypeOrSprite === HUMAN_SCOUT_UNIT_TYPE ||
      unitTypeOrSprite === ALIEN_SCOUT_UNIT_TYPE ||
      unitTypeOrSprite === AVII_SCOUT_UNIT_TYPE
    ) {
      return unitTypeOrSprite;
    }
    return null;
  }
  if (typeof unitTypeOrSprite === "string") {
    const normalized = normalizeSprite(unitTypeOrSprite);
    if (normalized === "SCGM") return HUMAN_SCOUT_UNIT_TYPE;
    if (normalized === "ORTU") return ALIEN_SCOUT_UNIT_TYPE;
    if (normalized === "AVII") return AVII_SCOUT_UNIT_TYPE;
    return null;
  }
  if (unitTypeOrSprite && typeof unitTypeOrSprite === "object") {
    const numType = numericTypeFromObject(unitTypeOrSprite);
    if (numType !== null) {
      if (
        numType === HUMAN_SCOUT_UNIT_TYPE ||
        numType === ALIEN_SCOUT_UNIT_TYPE ||
        numType === AVII_SCOUT_UNIT_TYPE
      ) {
        return numType;
      }
      return null;
    }
    const objSprite = spriteFromObject(unitTypeOrSprite);
    if (objSprite === "SCGM") return HUMAN_SCOUT_UNIT_TYPE;
    if (objSprite === "ORTU") return ALIEN_SCOUT_UNIT_TYPE;
    if (objSprite === "AVII") return AVII_SCOUT_UNIT_TYPE;
  }
  const fallbackSprite = normalizeSprite(sprite);
  if (fallbackSprite === "SCGM") return HUMAN_SCOUT_UNIT_TYPE;
  if (fallbackSprite === "ORTU") return ALIEN_SCOUT_UNIT_TYPE;
  if (fallbackSprite === "AVII") return AVII_SCOUT_UNIT_TYPE;
  if (
    sourceTypeIndex === HUMAN_SCOUT_UNIT_TYPE ||
    sourceTypeIndex === ALIEN_SCOUT_UNIT_TYPE ||
    sourceTypeIndex === AVII_SCOUT_UNIT_TYPE
  ) {
    return sourceTypeIndex;
  }
  return null;
}

/**
 * Recognizes Human Scout `SCGM` (unit type `5`), Alien Scout `ORTU` (unit type `13`), and `AVII` (unit type `24`).
 */
export function isScoutSpotterUnit(unitTypeOrSprite: BrowserUnitTypeOrSpriteInput): boolean {
  return resolveScoutSpotterUnitType(unitTypeOrSprite) !== null;
}

export function getScoutSpotterProfile(unitTypeOrSprite: BrowserUnitTypeOrSpriteInput): BrowserScoutSpotterProfile | null {
  const unitType = resolveScoutSpotterUnitType(unitTypeOrSprite);
  return unitType !== null ? BROWSER_SCOUT_SPOTTER_PROFILES[unitType] : null;
}

function resolveNightFlag(
  isNight?: boolean | "day" | "night" | { readonly isNight?: boolean; readonly timeOfDay?: "day" | "night"; readonly daylightPermille?: number },
): boolean {
  if (typeof isNight === "boolean") return isNight;
  if (isNight === "night") return true;
  if (isNight === "day") return false;
  if (isNight && typeof isNight === "object") {
    if (typeof isNight.isNight === "boolean") return isNight.isNight;
    if (isNight.timeOfDay === "night") return true;
    if (isNight.timeOfDay === "day") return false;
    if (typeof isNight.daylightPermille === "number" && Number.isFinite(isNight.daylightPermille)) {
      return isNight.daylightPermille < 500;
    }
  }
  return false;
}

/**
 * Returns the scout's effective observation radius from GAMESTAT (`8` for `SCGM`/`ORTU`, `11` for `AVII`).
 */
export function scoutObservationRange(
  unit: BrowserScoutSpotterInput | null | undefined,
  isNight: boolean | "day" | "night" | { readonly isNight?: boolean; readonly timeOfDay?: "day" | "night"; readonly daylightPermille?: number } = false,
): number {
  if (unit === null || unit === undefined) return 0;
  const night = resolveNightFlag(isNight);
  const scoutType = resolveScoutSpotterUnitType(unit);
  const profile = scoutType !== null ? BROWSER_SCOUT_SPOTTER_PROFILES[scoutType] : null;

  if (typeof unit === "object") {
    if (typeof unit.observationRange === "number" && Number.isFinite(unit.observationRange)) {
      return Math.max(0, Math.trunc(unit.observationRange));
    }
    if (typeof unit.sightRange === "number" && Number.isFinite(unit.sightRange)) {
      return Math.max(0, Math.trunc(unit.sightRange));
    }
    const dayRange = unit.vision?.dayRangeCells ?? unit.dayRangeCells ?? unit.observationDay;
    const nightRange = unit.vision?.nightRangeCells ?? unit.nightRangeCells ?? unit.observationNight;
    if (scoutType === AVII_SCOUT_UNIT_TYPE) {
      // AVII (type 24) raw GAMESTAT fields are 4/6, while its effective scout spotting radius is 11.
      const isRawAviiStat = dayRange === 4 && nightRange === 6;
      if (!isRawAviiStat) {
        const chosen = night ? (nightRange ?? dayRange) : (dayRange ?? nightRange);
        if (typeof chosen === "number" && Number.isFinite(chosen)) {
          return Math.max(0, Math.trunc(chosen));
        }
      }
      return AVII_OBSERVATION_RANGE_CELLS;
    }
    const chosen = night ? (nightRange ?? dayRange) : (dayRange ?? nightRange);
    if (typeof chosen === "number" && Number.isFinite(chosen)) {
      return Math.max(0, Math.trunc(chosen));
    }
  }

  if (profile) {
    return night ? profile.observationNight : profile.observationDay;
  }
  return 0;
}

function isEntityAlive(entity: BrowserUnitIdentityInput | null | undefined): boolean {
  if (!entity) return false;
  if (entity.dead === true || entity.dying === true) return false;
  if (entity.activity === "die" || entity.activity === "death") return false;
  if (entity.status !== undefined && (entity.status === 0 || entity.status === 10)) return false;
  if (typeof entity.health === "number" && entity.health <= 0) return false;
  return true;
}

function resolvePoints(input: BrowserArtilleryTargetInput | BrowserArtilleryActorInput | null | undefined): readonly { readonly x: number; readonly y: number }[] {
  if (!input || typeof input === "number" || typeof input === "string") return [];
  if (Array.isArray(input)) {
    const [x, y] = input;
    if (typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)) {
      return [{ x: Math.trunc(x), y: Math.trunc(y) }];
    }
    return [];
  }
  const obj = input as BrowserUnitIdentityInput;
  if (Array.isArray(obj.cells) && obj.cells.length > 0) {
    return obj.cells.map((cell) => ({ x: Math.trunc(cell.x), y: Math.trunc(cell.y) }));
  }
  if (obj.cell && typeof obj.cell.x === "number" && typeof obj.cell.y === "number") {
    return [{ x: Math.trunc(obj.cell.x), y: Math.trunc(obj.cell.y) }];
  }
  const x = obj.cellX ?? obj.x ?? obj.tileX;
  const y = obj.cellY ?? obj.y ?? obj.tileY;
  if (typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)) {
    return [{ x: Math.trunc(x), y: Math.trunc(y) }];
  }
  return [];
}

function resolveFactionName(value: number | Faction | undefined, fallback?: Faction): Faction | undefined {
  if (value === "human" || value === 0) return "human";
  if (value === "alien" || value === 1) return "alien";
  return fallback;
}

function resolveObserverAffiliation(
  options?: BrowserArtillerySpottingOptions,
): { readonly team?: number; readonly faction?: Faction } {
  const art = options?.artillery;
  const artObj = art && typeof art === "object" ? art : undefined;
  const artProfile = art !== undefined ? getArtilleryProfile(art) : null;
  const team = options?.team ?? options?.owner ?? artObj?.team ?? artObj?.owner;
  const faction = resolveFactionName(
    options?.faction ?? artObj?.faction,
    artProfile?.factionName,
  );
  return {
    ...(typeof team === "number" && Number.isInteger(team) ? { team } : {}),
    ...(faction !== undefined ? { faction } : {}),
  };
}

function isScoutAlliedWithObserver(
  scout: BrowserUnitIdentityInput,
  options?: BrowserArtillerySpottingOptions,
): boolean {
  if (options?.isAllied) return options.isAllied(scout);
  const observer = resolveObserverAffiliation(options);
  const scoutTeam = scout.team ?? scout.owner;
  if (scoutTeam !== undefined && scoutTeam >= 8) return false;
  const alliances = options?.teamAlliances ?? options?.alliances;
  const sharedVision = options?.sharedVision;
  if (observer.team !== undefined && scoutTeam !== undefined) {
    if (observer.team === scoutTeam) return true;
    if (alliances?.[observer.team]?.[scoutTeam] === 1) return true;
    if (sharedVision?.[observer.team]?.[scoutTeam] === 1) return true;
    return false;
  }
  const scoutProfile = getScoutSpotterProfile(scout);
  const scoutFaction = resolveFactionName(scout.faction, scoutProfile?.factionName);
  if (observer.faction !== undefined && scoutFaction !== undefined) {
    // AVII (type 24) has raw faction 1 in GAMESTAT.TXT, but when paired without team IDs,
    // allow explicit faction match or AVII spotter unless teams explicitly conflict.
    if (observer.faction === scoutFaction) return true;
    if (scoutProfile?.unitType === AVII_SCOUT_UNIT_TYPE && scout.faction === undefined) return true;
    return false;
  }
  return true;
}

function isTargetHostileToObserver(
  target: BrowserArtilleryTargetInput,
  options?: BrowserArtillerySpottingOptions,
): boolean {
  if (!target || typeof target !== "object" || Array.isArray(target)) return true;
  const targetObj = target as BrowserUnitIdentityInput;
  if (!isEntityAlive(targetObj)) return false;
  const artObj = options?.artillery && typeof options.artillery === "object" ? options.artillery : undefined;
  if (artObj?.id !== undefined && targetObj.id !== undefined && artObj.id === targetObj.id) {
    return false;
  }
  const observer = resolveObserverAffiliation(options);
  const targetTeam = targetObj.team ?? targetObj.owner;
  if (targetTeam !== undefined && targetTeam >= 8) return false;
  const targetFaction = resolveFactionName(targetObj.faction);
  const alliances = options?.teamAlliances ?? options?.alliances;
  if (observer.team !== undefined && targetTeam !== undefined) {
    return areHostile(
      { faction: observer.faction ?? "human", team: observer.team },
      { faction: targetFaction ?? "alien", team: targetTeam },
      alliances,
    );
  }
  if (observer.faction !== undefined && targetFaction !== undefined) {
    return observer.faction !== targetFaction;
  }
  return true;
}

function isEligibleScoutCandidate(
  scout: BrowserUnitIdentityInput,
  options?: BrowserArtillerySpottingOptions,
): boolean {
  if (!isEntityAlive(scout)) return false;
  const hasTypeIdentifier =
    scout.unitType !== undefined ||
    scout.index !== undefined ||
    scout.type !== undefined ||
    scout.sourceTypeIndex !== undefined ||
    scout.sprite !== undefined;
  if (hasTypeIdentifier && !isScoutSpotterUnit(scout)) return false;
  return isScoutAlliedWithObserver(scout, options);
}

function normalizeScoutsList(
  scouts: Iterable<BrowserScoutSpotterInput> | BrowserScoutSpotterInput | null | undefined,
): readonly BrowserUnitIdentityInput[] {
  if (!scouts) return [];
  const items: BrowserScoutSpotterInput[] =
    typeof scouts === "object" && Symbol.iterator in scouts
      ? [...(scouts as Iterable<BrowserScoutSpotterInput>)]
      : [scouts as BrowserScoutSpotterInput];
  const result: BrowserUnitIdentityInput[] = [];
  for (const item of items) {
    if (typeof item === "number") {
      result.push({ unitType: item });
    } else if (typeof item === "string") {
      result.push({ sprite: item });
    } else if (item && typeof item === "object") {
      result.push(item);
    }
  }
  return result;
}

/**
 * Checks whether a single scout spots a target point `(dx*dx + dy*dy <= (obsRange + 1)*(obsRange + 1))`
 * using the `DC.EXE` ring convention.
 */
export function withinScoutObservationRing(dx: number, dy: number, obsRange: number): boolean {
  if (!Number.isFinite(obsRange) || obsRange < 0) return false;
  const limit = Math.trunc(obsRange) + 1;
  return dx * dx + dy * dy <= limit * limit;
}

/**
 * Checks whether any living allied scout spots the target (`dx*dx + dy*dy <= (obsRange + 1)*(obsRange + 1)`
 * using the `DC.EXE` ring convention).
 */
export function isTargetSpottedByScout(
  target: BrowserArtilleryTargetInput | null | undefined,
  scouts: Iterable<BrowserScoutSpotterInput> | BrowserScoutSpotterInput | null | undefined,
  options?: BrowserArtillerySpottingOptions,
): boolean {
  if (!target) return false;
  if (typeof target === "object" && !Array.isArray(target) && !isEntityAlive(target as BrowserUnitIdentityInput)) {
    return false;
  }
  const targetPoints = resolvePoints(target);
  if (targetPoints.length === 0) return false;

  const isNight = resolveNightFlag(options);
  for (const scout of normalizeScoutsList(scouts)) {
    if (!isEligibleScoutCandidate(scout, options)) continue;
    const obsRange = scoutObservationRange(scout, isNight);
    if (obsRange <= 0) continue;
    const scoutPoints = resolvePoints(scout);
    if (scoutPoints.length === 0) continue;
    const scoutCell = scoutPoints[0];
    for (const point of targetPoints) {
      const dx = point.x - scoutCell.x;
      const dy = point.y - scoutCell.y;
      if (withinScoutObservationRing(dx, dy, obsRange)) {
        return true;
      }
    }
  }
  return false;
}

function resolveWeaponRangeFromLookup(weaponId: number, lookup?: WeaponRangeLookup): number | null {
  if (lookup instanceof Map) {
    const found = lookup.get(weaponId);
    if (typeof found === "number" && Number.isFinite(found) && found > 0) return Math.trunc(found);
  } else if (Array.isArray(lookup) || (lookup && typeof lookup === "object" && "records" in lookup)) {
    const records = "records" in lookup ? lookup.records : lookup;
    const record = records.find((entry) => entry.id === weaponId);
    if (record && Number.isFinite(record.range) && record.range > 0) return Math.trunc(record.range);
  } else if (lookup && typeof lookup === "object") {
    const value = (lookup as Readonly<Record<number, number>>)[weaponId];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.trunc(value);
  }
  const defaultRange = ARTILLERY_WEAPON_RANGES_BY_ID[weaponId];
  return defaultRange !== undefined ? defaultRange : null;
}

function resolveUpgradeLevel(
  artilleryObj: BrowserUnitIdentityInput | undefined,
  options?: BrowserArtillerySpottingOptions,
): ArtilleryWeaponUpgradeLevel {
  const rawLevel =
    options?.weaponLevel ??
    options?.upgradeLevel ??
    artilleryObj?.weaponLevel ??
    artilleryObj?.upgradeLevel ??
    0;
  if (!Number.isFinite(rawLevel)) return 0;
  const clamped = Math.max(0, Math.min(2, Math.trunc(rawLevel)));
  return clamped as ArtilleryWeaponUpgradeLevel;
}

export function resolveArtillerySelfSightRange(
  artillery: BrowserArtilleryActorInput,
  options?: BrowserArtillerySpottingOptions,
): number {
  for (const explicit of [
    options?.selfSightRange,
    options?.unspottedRange,
    typeof artillery === "object" && artillery ? artillery.selfSightRange : undefined,
    typeof artillery === "object" && artillery ? artillery.unspottedRange : undefined,
    typeof artillery === "object" && artillery ? artillery.observationRange : undefined,
    typeof artillery === "object" && artillery ? artillery.sightRange : undefined,
  ]) {
    if (typeof explicit === "number" && Number.isFinite(explicit) && explicit >= 0) {
      return Math.trunc(explicit);
    }
  }

  const artObj = typeof artillery === "object" && artillery ? artillery : undefined;
  const profile = getArtilleryProfile(artillery);

  const dayFromUnit = artObj?.vision?.dayRangeCells ?? artObj?.dayRangeCells ?? artObj?.observationDay;
  const nightFromUnit = artObj?.vision?.nightRangeCells ?? artObj?.nightRangeCells ?? artObj?.observationNight;

  const defaultDay = profile
    ? (options?.useGamestatDaySight ? profile.gamestatObservationDay : profile.observationDay)
    : DEFAULT_UNSPOTTED_ARTILLERY_SIGHT_CELLS;
  const defaultNight = profile ? profile.observationNight : DEFAULT_UNSPOTTED_ARTILLERY_SIGHT_CELLS;

  // For BARR (type 3), GAMESTAT has observationDay=7, observationNight=4; unless useGamestatDaySight is requested,
  // BARR's unspotted artillery self-sight is 4 cells (matching HTRAIN5 and BARR's short self-sight cap).
  const isRawBarrGamestat =
    profile?.unitType === HUMAN_ARTILLERY_UNIT_TYPE &&
    dayFromUnit === 7 &&
    nightFromUnit === 4 &&
    !options?.useGamestatDaySight;

  const dayRange = isRawBarrGamestat
    ? profile.observationDay
    : (typeof dayFromUnit === "number" && Number.isFinite(dayFromUnit) ? Math.trunc(dayFromUnit) : defaultDay);
  const nightRange =
    typeof nightFromUnit === "number" && Number.isFinite(nightFromUnit) ? Math.trunc(nightFromUnit) : defaultNight;

  if (typeof options?.daylightPermille === "number" && Number.isFinite(options.daylightPermille)) {
    const light = Math.max(0, Math.min(1000, Math.trunc(options.daylightPermille)));
    return Math.max(0, Math.floor((dayRange * light + nightRange * (1000 - light)) / 1000));
  }

  const isNight = resolveNightFlag(options);
  return Math.max(0, isNight ? nightRange : dayRange);
}

export function resolveArtilleryWeaponRange(
  artillery: BrowserArtilleryActorInput,
  options?: BrowserArtillerySpottingOptions,
): { readonly weaponLevel: ArtilleryWeaponUpgradeLevel; readonly weaponId: number | null; readonly weaponRange: number } {
  const artObj = typeof artillery === "object" && artillery ? artillery : undefined;
  const profile = getArtilleryProfile(artillery);
  const weaponLevel = resolveUpgradeLevel(artObj, options);

  const explicitWeaponId =
    options?.weaponId ??
    artObj?.weaponId ??
    artObj?.weapon?.weaponId ??
    artObj?.weapon?.id ??
    (Array.isArray(artObj?.weapons) && artObj.weapons[weaponLevel] !== undefined && artObj.weapons[weaponLevel] >= 0
      ? artObj.weapons[weaponLevel]
      : undefined) ??
    (profile ? profile.weapons[weaponLevel] : null);

  for (const explicitRange of [
    options?.weaponRange,
    options?.weaponRangeCells,
    artObj?.weaponRange,
    artObj?.weaponRangeCells,
    artObj?.weapon?.rangeCells,
    artObj?.weapon?.range,
  ]) {
    if (typeof explicitRange === "number" && Number.isFinite(explicitRange) && explicitRange > 0) {
      return {
        weaponLevel,
        weaponId: explicitWeaponId ?? null,
        weaponRange: Math.trunc(explicitRange),
      };
    }
  }

  if (typeof explicitWeaponId === "number" && explicitWeaponId >= 0) {
    const fromLookup = resolveWeaponRangeFromLookup(explicitWeaponId, options?.weapons);
    if (fromLookup !== null) {
      return {
        weaponLevel,
        weaponId: explicitWeaponId,
        weaponRange: fromLookup,
      };
    }
  }

  return {
    weaponLevel,
    weaponId: explicitWeaponId ?? null,
    weaponRange: ARTILLERY_WEAPON_RANGES_BY_LEVEL[weaponLevel],
  };
}

/**
 * Checks whether an artillery unit can acquire a given target, either within its own short self-observation range
 * (`unspottedRange`) or across its full artillery weapon range (`spottedRange`) when spotted by an allied scout.
 * Integrates with `withinSourceWeaponRange` (`dx*dx + dy*dy < (R + 1)*(R + 1)`).
 */
export function canArtilleryAcquireTarget(
  artillery: BrowserArtilleryActorInput,
  target: BrowserArtilleryTargetInput | null | undefined,
  scouts?: Iterable<BrowserScoutSpotterInput> | BrowserScoutSpotterInput | null,
  options?: BrowserArtillerySpottingOptions,
): boolean {
  if (!target) return false;
  const artObj = typeof artillery === "object" && artillery ? artillery : undefined;
  if (artObj && !isEntityAlive(artObj)) return false;

  const mergedOptions: BrowserArtillerySpottingOptions = {
    ...options,
    artillery: options?.artillery ?? artillery,
  };
  if (!isTargetHostileToObserver(target, mergedOptions)) return false;

  const artilleryPoints = resolvePoints(artillery);
  const targetPoints = resolvePoints(target);
  if (artilleryPoints.length === 0 || targetPoints.length === 0) return false;
  const artilleryCell = artilleryPoints[0];

  const selfSight = resolveArtillerySelfSightRange(artillery, mergedOptions);
  const { weaponRange } = resolveArtilleryWeaponRange(artillery, mergedOptions);
  const unspottedRange = Math.min(selfSight, weaponRange);

  const includeBonus =
    mergedOptions.includeScoutRangeBonus === true ||
    (typeof mergedOptions.scoutRangeBonus === "number" && mergedOptions.scoutRangeBonus > 0) ||
    (typeof mergedOptions.bonusRangeCells === "number" && mergedOptions.bonusRangeCells > 0);
  const bonusCells = includeBonus
    ? Math.max(0, Math.trunc(mergedOptions.scoutRangeBonus ?? mergedOptions.bonusRangeCells ?? DEFAULT_SCOUT_RANGE_BONUS_CELLS))
    : 0;
  const spottedRange = weaponRange + bonusCells;

  // 1. Target within the artillery's own unspotted self-sight range:
  for (const point of targetPoints) {
    const dx = artilleryCell.x - point.x;
    const dy = artilleryCell.y - point.y;
    if (withinSourceWeaponRange(dx, dy, unspottedRange)) {
      if (!mergedOptions.isCellVisible || mergedOptions.isCellVisible(point.x, point.y)) {
        return true;
      }
    }
  }

  // 2. Target outside self-sight range: requires an active allied scout spotting the target (or active scout when requireTargetWithinScoutSight === false)
  const eligibleScouts = normalizeScoutsList(scouts).filter((scout) => isEligibleScoutCandidate(scout, mergedOptions));
  if (eligibleScouts.length === 0) return false;

  const scoutsHaveCoordinates = eligibleScouts.some((scout) => resolvePoints(scout).length > 0);
  const targetSpotted =
    mergedOptions.requireTargetWithinScoutSight === false || !scoutsHaveCoordinates
      ? eligibleScouts.length > 0
      : isTargetSpottedByScout(target, eligibleScouts, mergedOptions);

  if (!targetSpotted) return false;

  for (const point of targetPoints) {
    const dx = artilleryCell.x - point.x;
    const dy = artilleryCell.y - point.y;
    if (withinSourceWeaponRange(dx, dy, spottedRange)) {
      return true;
    }
  }
  return false;
}

/**
 * Resolves the artillery's unspotted self-sight-limited range vs its scout-spotted full weapon range
 * (plus optional scout range bonus `+4` cells when a friendly scout is spotting), and returns a
 * `canArtilleryAcquireTarget` predicate integrated with `withinSourceWeaponRange`.
 */
export function resolveArtilleryEffectiveRange(
  artillery: BrowserArtilleryActorInput,
  scouts?: Iterable<BrowserScoutSpotterInput> | BrowserScoutSpotterInput | null,
  options?: BrowserArtillerySpottingOptions,
): ResolvedArtilleryEffectiveRange {
  const mergedOptions: BrowserArtillerySpottingOptions = {
    ...options,
    artillery: options?.artillery ?? artillery,
  };
  const unitType = resolveArtilleryUnitType(artillery);
  const profile = unitType !== null ? BROWSER_ARTILLERY_PROFILES[unitType] : null;
  const selfSightRange = resolveArtillerySelfSightRange(artillery, mergedOptions);
  const { weaponLevel, weaponId, weaponRange } = resolveArtilleryWeaponRange(artillery, mergedOptions);
  const unspottedRange = Math.min(selfSightRange, weaponRange);

  const maxScoutRangeBonus = Math.max(
    0,
    Math.trunc(mergedOptions.scoutRangeBonus ?? mergedOptions.bonusRangeCells ?? DEFAULT_SCOUT_RANGE_BONUS_CELLS),
  );
  const includeBonus =
    mergedOptions.includeScoutRangeBonus === true ||
    mergedOptions.scoutRangeBonus !== undefined ||
    mergedOptions.bonusRangeCells !== undefined;
  const configuredBonus = includeBonus ? maxScoutRangeBonus : 0;

  const eligibleScouts = normalizeScoutsList(scouts).filter((scout) => isEligibleScoutCandidate(scout, mergedOptions));
  const spottingScouts =
    mergedOptions.target !== undefined
      ? eligibleScouts.filter((scout) =>
          resolvePoints(scout).length === 0 || isTargetSpottedByScout(mergedOptions.target, [scout], mergedOptions),
        )
      : eligibleScouts;

  const hasActiveScout = spottingScouts.length > 0;
  const scoutRangeBonus = hasActiveScout ? configuredBonus : 0;
  const spottedRange = weaponRange + configuredBonus;
  const spottedRangeWithBonus = weaponRange + maxScoutRangeBonus;
  const effectiveRange = hasActiveScout ? spottedRange : unspottedRange;
  const effectiveRangeWithBonus = hasActiveScout ? spottedRangeWithBonus : unspottedRange;

  const acquirePredicate = (
    target: BrowserArtilleryTargetInput,
    overrideOptions?: BrowserArtillerySpottingOptions,
  ): boolean =>
    canArtilleryAcquireTarget(artillery, target, scouts, {
      ...mergedOptions,
      ...overrideOptions,
    });

  const artilleryPoints = resolvePoints(artillery);
  const isCellVisible = (x: number, y: number): boolean => {
    if (mergedOptions.isCellVisible?.(x, y)) return true;
    if (artilleryPoints.length > 0) {
      const origin = artilleryPoints[0];
      if (withinSourceWeaponRange(origin.x - x, origin.y - y, unspottedRange)) return true;
    }
    return isTargetSpottedByScout({ x, y }, eligibleScouts, mergedOptions);
  };

  return Object.freeze({
    isArtillery: unitType !== null,
    unitType,
    sprite: profile?.sprite ?? null,
    weaponLevel,
    weaponId,
    selfSightRange,
    unspottedRange,
    weaponRange,
    fullWeaponRange: weaponRange,
    scoutRangeBonus,
    maxScoutRangeBonus,
    spottedRange,
    spottedRangeWithBonus,
    bonusWeaponRange: spottedRangeWithBonus,
    hasActiveScout,
    isSpotted: hasActiveScout,
    spottingScouts: Object.freeze(spottingScouts),
    effectiveRange,
    effectiveRangeWithBonus,
    canArtilleryAcquireTarget: acquirePredicate,
    canAcquireTarget: acquirePredicate,
    isCellVisible,
  });
}

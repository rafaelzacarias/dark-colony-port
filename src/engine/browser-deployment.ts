import { areHostile } from "./diplomacy";
import type { GridPoint } from "./grid";
import {
  browserMineOptions,
  validateBrowserMineOptions,
  type BrowserMineOptions,
  type BrowserMineSource,
} from "./browser-mines";
import {
  copyLegacyDamageProfile,
  copyLegacyDefenseProfile,
  defenseOptionsFromLegacy,
  unitOptionsFromLegacy,
  type LegacyCombatOptions,
  type LegacyDamageMatrix,
  type LegacyDamageProfile,
  type LegacyDefenseProfile,
  type LegacyUnitOptions,
  type LegacyUnitStat,
  type LegacyWeaponStat,
} from "./legacy-balance";
import type { Faction, UnitVisionStats, WeaponStats } from "./simulation";

export const TASK_13_ID = 13 as const;
export const DEPLOYMENT_TASK_ID = 13 as const;
export const DEPLOYMENT_INITIAL_COUNTDOWN_TICKS = 50 as const;
export const TASK_13_COUNTDOWN_TICKS = 50 as const;
export const DEPLOYMENT_SOUND_EVENT = 5 as const;
export const DEPLOYMENT_SOUND_GROUP = "DPY" as const;
export const DEPLOYMENT_FIN_BANK_ADDRESS = 0x4f1914 as const;
export const DEPLOYMENT_FIN_BANK_OFFSET = 0x94 as const;
export const STAND_FIN_BANK_ADDRESS = 0x4f1900 as const;
export const STAND_FIN_BANK_OFFSET = 0x80 as const;
export const DEPLOYMENT_FIN_FAMILY = "DEPLOY" as const;

export const EMPTY_MINE_CELL_SLOT = 0x3ff as const;
export const MINE_SLOT_MASK = 0x3ff as const;
export const MINE_SLOT_CLEAR_MASK = 0xfc00 as const;
export const COLONY_DEPLOY_MANHATTAN_LIMIT = 7 as const;

export const MINE_MAX_CHARGES = 3 as const;
export const MINE_CHARGE_HP_DEDUCTION = 300 as const;
export const MINE_MIN_CHARGE_HIT_HP = 1 as const;
export const MINE_IDEAL_CHARGE_POOL_HP = 900 as const;
export const MINE_GAMESTAT_HEALTH = 800 as const;
export const MINE_WEAPON_ID = 38 as const;
export const MINE_WEAPON_CLASS = 6 as const;
export const TURRET_WEAPON_CLASS = 5 as const;

export const HUMAN_MOBILE_TURRET_UNIT_TYPE = 1 as const;
export const ALIEN_MOBILE_TURRET_UNIT_TYPE = 9 as const;
export const HUMAN_DEPLOYED_TURRET_UNIT_TYPE = 41 as const;
export const ALIEN_DEPLOYED_TURRET_UNIT_TYPE = 42 as const;

export const HUMAN_MOBILE_MINE_UNIT_TYPE = 43 as const;
export const ALIEN_MOBILE_MINE_UNIT_TYPE = 44 as const;
export const HUMAN_DEPLOYED_MINE_UNIT_TYPE = 45 as const;
export const ALIEN_DEPLOYED_MINE_UNIT_TYPE = 46 as const;

export const HUMAN_SARGE_UNIT_TYPE = 4 as const;
export const ALIEN_PSYC_UNIT_TYPE = 12 as const;
export const HUMAN_DEPLOYED_SARGE_UNIT_TYPE = 77 as const;
export const ALIEN_DEPLOYED_PSYC_UNIT_TYPE = 78 as const;

export const HUMAN_DEPLOYED_HARVESTER_UNIT_TYPE = 47 as const;
export const ALIEN_DEPLOYED_HARVESTER_UNIT_TYPE = 48 as const;
export const HUMAN_MOBILE_HARVESTER_UNIT_TYPE = 6 as const;
export const ALIEN_MOBILE_HARVESTER_UNIT_TYPE = 14 as const;

export const HUMAN_TURRET_WEAPON_IDS = Object.freeze([34, 35, 36] as const);
export const ALIEN_TURRET_WEAPON_IDS = Object.freeze([40, 41, 42] as const);

export const MOBILE_TURRET_UNIT_TYPES = Object.freeze([
  HUMAN_MOBILE_TURRET_UNIT_TYPE,
  ALIEN_MOBILE_TURRET_UNIT_TYPE,
] as const);

export const DEPLOYED_TURRET_UNIT_TYPES = Object.freeze([
  HUMAN_DEPLOYED_TURRET_UNIT_TYPE,
  ALIEN_DEPLOYED_TURRET_UNIT_TYPE,
] as const);

export const MOBILE_MINE_UNIT_TYPES = Object.freeze([
  HUMAN_MOBILE_MINE_UNIT_TYPE,
  ALIEN_MOBILE_MINE_UNIT_TYPE,
] as const);

export const DEPLOYED_MINE_UNIT_TYPES = Object.freeze([
  HUMAN_DEPLOYED_MINE_UNIT_TYPE,
  ALIEN_DEPLOYED_MINE_UNIT_TYPE,
] as const);

export const STEALTH_MOBILE_UNIT_TYPES = Object.freeze([
  HUMAN_SARGE_UNIT_TYPE,
  ALIEN_PSYC_UNIT_TYPE,
] as const);

export const STEALTH_DEPLOYED_UNIT_TYPES = Object.freeze([
  HUMAN_DEPLOYED_SARGE_UNIT_TYPE,
  ALIEN_DEPLOYED_PSYC_UNIT_TYPE,
] as const);

export const DEPLOYED_HARVESTER_UNIT_TYPES = Object.freeze([
  HUMAN_DEPLOYED_HARVESTER_UNIT_TYPE,
  ALIEN_DEPLOYED_HARVESTER_UNIT_TYPE,
] as const);

export const MOBILE_HARVESTER_UNIT_TYPES = Object.freeze([
  HUMAN_MOBILE_HARVESTER_UNIT_TYPE,
  ALIEN_MOBILE_HARVESTER_UNIT_TYPE,
] as const);

export const TEAM_SURVIVAL_EXCLUDED_UNIT_TYPES = Object.freeze([
  HUMAN_DEPLOYED_TURRET_UNIT_TYPE,
  ALIEN_DEPLOYED_TURRET_UNIT_TYPE,
  HUMAN_DEPLOYED_MINE_UNIT_TYPE,
  ALIEN_DEPLOYED_MINE_UNIT_TYPE,
] as const);

export const TASK_13_SOURCE_UNIT_TYPES = Object.freeze([
  HUMAN_MOBILE_TURRET_UNIT_TYPE,
  ALIEN_MOBILE_TURRET_UNIT_TYPE,
  HUMAN_MOBILE_MINE_UNIT_TYPE,
  ALIEN_MOBILE_MINE_UNIT_TYPE,
  HUMAN_SARGE_UNIT_TYPE,
  ALIEN_PSYC_UNIT_TYPE,
  HUMAN_DEPLOYED_SARGE_UNIT_TYPE,
  ALIEN_DEPLOYED_PSYC_UNIT_TYPE,
  HUMAN_DEPLOYED_HARVESTER_UNIT_TYPE,
  ALIEN_DEPLOYED_HARVESTER_UNIT_TYPE,
] as const);

export const TASK_13_TARGET_UNIT_TYPES = Object.freeze([
  HUMAN_DEPLOYED_TURRET_UNIT_TYPE,
  ALIEN_DEPLOYED_TURRET_UNIT_TYPE,
  HUMAN_DEPLOYED_MINE_UNIT_TYPE,
  ALIEN_DEPLOYED_MINE_UNIT_TYPE,
  HUMAN_DEPLOYED_SARGE_UNIT_TYPE,
  ALIEN_DEPLOYED_PSYC_UNIT_TYPE,
  HUMAN_SARGE_UNIT_TYPE,
  ALIEN_PSYC_UNIT_TYPE,
  HUMAN_MOBILE_HARVESTER_UNIT_TYPE,
  ALIEN_MOBILE_HARVESTER_UNIT_TYPE,
] as const);

export type MobileTurretUnitType = typeof MOBILE_TURRET_UNIT_TYPES[number];
export type DeployedTurretUnitType = typeof DEPLOYED_TURRET_UNIT_TYPES[number];
export type MobileMineUnitType = typeof MOBILE_MINE_UNIT_TYPES[number];
export type DeployedMineUnitType = typeof DEPLOYED_MINE_UNIT_TYPES[number];
export type StealthMobileUnitType = typeof STEALTH_MOBILE_UNIT_TYPES[number];
export type StealthDeployedUnitType = typeof STEALTH_DEPLOYED_UNIT_TYPES[number];
export type DeployedHarvesterUnitType = typeof DEPLOYED_HARVESTER_UNIT_TYPES[number];
export type MobileHarvesterUnitType = typeof MOBILE_HARVESTER_UNIT_TYPES[number];
export type Task13SourceUnitType = typeof TASK_13_SOURCE_UNIT_TYPES[number];
export type Task13TargetUnitType = typeof TASK_13_TARGET_UNIT_TYPES[number];
export type TeamSurvivalExcludedUnitType = typeof TEAM_SURVIVAL_EXCLUDED_UNIT_TYPES[number];

export type Task13DeploymentCategory = "turret" | "mine" | "stealth" | "harvester";
export type Task13DeploymentDirection = "deploy" | "undeploy";

export type Task13SourceSprite =
  | "TURR"
  | "XENO"
  | "ENGI"
  | "SLOM"
  | "SARG"
  | "PSYC"
  | "SARGSTL"
  | "PSYCSTL"
  | "EDPLY"
  | "SDPL";

export type Task13TargetSprite =
  | "T"
  | "XDEPLOY"
  | "HMINE"
  | "SARGSTL"
  | "PSYCSTL"
  | "SARG"
  | "PSYC"
  | "EXPL"
  | "SLUG";

export interface Task13DeploymentProfile {
  readonly sourceType: Task13SourceUnitType;
  readonly targetType: Task13TargetUnitType;
  readonly fromType: Task13SourceUnitType;
  readonly toType: Task13TargetUnitType;
  readonly sourceSprite: Task13SourceSprite;
  readonly targetSprite: Task13TargetSprite;
  readonly faction: 0 | 1;
  readonly factionName: Faction;
  readonly category: Task13DeploymentCategory;
  readonly direction: Task13DeploymentDirection;
  readonly reversible: boolean;
  readonly oneWay: boolean;
  readonly reverseType: Task13SourceUnitType | null;
  readonly sourceWeapons: readonly [number, number, number];
  readonly targetWeapons: readonly [number, number, number];
  readonly weapons: readonly [number, number, number];
  readonly targetIsStatic: boolean;
  readonly removesMobileFromGroundPlane: boolean;
  readonly writesMineObjectPlane: boolean;
  readonly requiresEmptyMineCell: boolean;
  readonly requiresEnemyColonyProximity: boolean;
  readonly enemyColonyManhattanLimit: 7 | null;
  readonly taskId: 13;
  readonly countdownTicks: 50;
  readonly soundEvent: 5;
  readonly soundGroup: "DPY";
  readonly finBankAddress: 0x4f1914;
  readonly finStatePrefix: string;
}

function createProfile(profile: Omit<Task13DeploymentProfile,
  | "fromType"
  | "toType"
  | "factionName"
  | "oneWay"
  | "weapons"
  | "taskId"
  | "countdownTicks"
  | "soundEvent"
  | "soundGroup"
  | "finBankAddress"
>): Task13DeploymentProfile {
  return Object.freeze({
    ...profile,
    fromType: profile.sourceType,
    toType: profile.targetType,
    factionName: profile.faction === 0 ? "human" : "alien",
    oneWay: !profile.reversible,
    weapons: profile.targetWeapons,
    taskId: TASK_13_ID,
    countdownTicks: DEPLOYMENT_INITIAL_COUNTDOWN_TICKS,
    soundEvent: DEPLOYMENT_SOUND_EVENT,
    soundGroup: DEPLOYMENT_SOUND_GROUP,
    finBankAddress: DEPLOYMENT_FIN_BANK_ADDRESS,
  });
}

/**
 * DC.EXE Task-13 (`0x416784` -> `0x417B0C..0x417D73`) unit deployment conversion table.
 */
export const TASK_13_DEPLOYMENT_PROFILES: Readonly<Record<Task13SourceUnitType, Task13DeploymentProfile>> = Object.freeze({
  1: createProfile({
    sourceType: 1,
    targetType: 41,
    sourceSprite: "TURR",
    targetSprite: "T",
    faction: 0,
    category: "turret",
    direction: "deploy",
    reversible: false,
    reverseType: null,
    sourceWeapons: Object.freeze([-1, -1, -1] as const),
    targetWeapons: HUMAN_TURRET_WEAPON_IDS,
    targetIsStatic: true,
    removesMobileFromGroundPlane: true,
    writesMineObjectPlane: false,
    requiresEmptyMineCell: false,
    requiresEnemyColonyProximity: false,
    enemyColonyManhattanLimit: null,
    finStatePrefix: "TURRDEPLOY",
  }),
  9: createProfile({
    sourceType: 9,
    targetType: 42,
    sourceSprite: "XENO",
    targetSprite: "XDEPLOY",
    faction: 1,
    category: "turret",
    direction: "deploy",
    reversible: false,
    reverseType: null,
    sourceWeapons: Object.freeze([-1, -1, -1] as const),
    targetWeapons: ALIEN_TURRET_WEAPON_IDS,
    targetIsStatic: true,
    removesMobileFromGroundPlane: true,
    writesMineObjectPlane: false,
    requiresEmptyMineCell: false,
    requiresEnemyColonyProximity: false,
    enemyColonyManhattanLimit: null,
    finStatePrefix: "XENODEPLOY",
  }),
  43: createProfile({
    sourceType: 43,
    targetType: 45,
    sourceSprite: "ENGI",
    targetSprite: "HMINE",
    faction: 0,
    category: "mine",
    direction: "deploy",
    reversible: false,
    reverseType: null,
    sourceWeapons: Object.freeze([-1, -1, -1] as const),
    targetWeapons: Object.freeze([38, 38, 38] as const),
    targetIsStatic: true,
    removesMobileFromGroundPlane: true,
    writesMineObjectPlane: true,
    requiresEmptyMineCell: true,
    requiresEnemyColonyProximity: false,
    enemyColonyManhattanLimit: null,
    finStatePrefix: "ENGIDEPLOY",
  }),
  44: createProfile({
    sourceType: 44,
    targetType: 46,
    sourceSprite: "SLOM",
    targetSprite: "HMINE",
    faction: 1,
    category: "mine",
    direction: "deploy",
    reversible: false,
    reverseType: null,
    sourceWeapons: Object.freeze([-1, -1, -1] as const),
    targetWeapons: Object.freeze([38, 38, 38] as const),
    targetIsStatic: true,
    removesMobileFromGroundPlane: true,
    writesMineObjectPlane: true,
    requiresEmptyMineCell: true,
    requiresEnemyColonyProximity: false,
    enemyColonyManhattanLimit: null,
    finStatePrefix: "SLOMDEPLOY",
  }),
  4: createProfile({
    sourceType: 4,
    targetType: 77,
    sourceSprite: "SARG",
    targetSprite: "SARGSTL",
    faction: 0,
    category: "stealth",
    direction: "deploy",
    reversible: true,
    reverseType: 77,
    sourceWeapons: Object.freeze([13, 14, 14] as const),
    targetWeapons: Object.freeze([-1, -1, -1] as const),
    targetIsStatic: false,
    removesMobileFromGroundPlane: false,
    writesMineObjectPlane: false,
    requiresEmptyMineCell: false,
    requiresEnemyColonyProximity: true,
    enemyColonyManhattanLimit: COLONY_DEPLOY_MANHATTAN_LIMIT,
    finStatePrefix: "SARGDEPLOY",
  }),
  12: createProfile({
    sourceType: 12,
    targetType: 78,
    sourceSprite: "PSYC",
    targetSprite: "PSYCSTL",
    faction: 1,
    category: "stealth",
    direction: "deploy",
    reversible: true,
    reverseType: 78,
    sourceWeapons: Object.freeze([30, 27, 28] as const),
    targetWeapons: Object.freeze([-1, -1, -1] as const),
    targetIsStatic: false,
    removesMobileFromGroundPlane: false,
    writesMineObjectPlane: false,
    requiresEmptyMineCell: false,
    requiresEnemyColonyProximity: true,
    enemyColonyManhattanLimit: COLONY_DEPLOY_MANHATTAN_LIMIT,
    finStatePrefix: "PSYCDEPLOY",
  }),
  77: createProfile({
    sourceType: 77,
    targetType: 4,
    sourceSprite: "SARGSTL",
    targetSprite: "SARG",
    faction: 0,
    category: "stealth",
    direction: "undeploy",
    reversible: true,
    reverseType: 4,
    sourceWeapons: Object.freeze([-1, -1, -1] as const),
    targetWeapons: Object.freeze([13, 14, 14] as const),
    targetIsStatic: false,
    removesMobileFromGroundPlane: false,
    writesMineObjectPlane: false,
    requiresEmptyMineCell: false,
    requiresEnemyColonyProximity: false,
    enemyColonyManhattanLimit: null,
    finStatePrefix: "SSTLDEPLOY",
  }),
  78: createProfile({
    sourceType: 78,
    targetType: 12,
    sourceSprite: "PSYCSTL",
    targetSprite: "PSYC",
    faction: 1,
    category: "stealth",
    direction: "undeploy",
    reversible: true,
    reverseType: 12,
    sourceWeapons: Object.freeze([-1, -1, -1] as const),
    targetWeapons: Object.freeze([30, 27, 28] as const),
    targetIsStatic: false,
    removesMobileFromGroundPlane: false,
    writesMineObjectPlane: false,
    requiresEmptyMineCell: false,
    requiresEnemyColonyProximity: false,
    enemyColonyManhattanLimit: null,
    finStatePrefix: "PSTLDEPLOY",
  }),
  47: createProfile({
    sourceType: 47,
    targetType: 6,
    sourceSprite: "EDPLY",
    targetSprite: "EXPL",
    faction: 0,
    category: "harvester",
    direction: "undeploy",
    reversible: false,
    reverseType: null,
    sourceWeapons: Object.freeze([-1, -1, -1] as const),
    targetWeapons: Object.freeze([-1, -1, -1] as const),
    targetIsStatic: false,
    removesMobileFromGroundPlane: false,
    writesMineObjectPlane: false,
    requiresEmptyMineCell: false,
    requiresEnemyColonyProximity: false,
    enemyColonyManhattanLimit: null,
    finStatePrefix: "EXPLDEPLOY",
  }),
  48: createProfile({
    sourceType: 48,
    targetType: 14,
    sourceSprite: "SDPL",
    targetSprite: "SLUG",
    faction: 1,
    category: "harvester",
    direction: "undeploy",
    reversible: false,
    reverseType: null,
    sourceWeapons: Object.freeze([-1, -1, -1] as const),
    targetWeapons: Object.freeze([-1, -1, -1] as const),
    targetIsStatic: false,
    removesMobileFromGroundPlane: false,
    writesMineObjectPlane: false,
    requiresEmptyMineCell: false,
    requiresEnemyColonyProximity: false,
    enemyColonyManhattanLimit: null,
    finStatePrefix: "SLUGDEPLOY",
  }),
});

export function isTask13DeployableUnitType(unitType: number): unitType is Task13SourceUnitType {
  return Number.isInteger(unitType) && Object.hasOwn(TASK_13_DEPLOYMENT_PROFILES, unitType);
}

export const isDeployableUnitType = isTask13DeployableUnitType;

export function getTask13DeploymentProfile(unitType: number): Task13DeploymentProfile | null {
  return isTask13DeployableUnitType(unitType) ? TASK_13_DEPLOYMENT_PROFILES[unitType] : null;
}

export const getDeploymentProfile = getTask13DeploymentProfile;

export function resolveTask13TargetUnitType(unitType: number): Task13TargetUnitType | null {
  return getTask13DeploymentProfile(unitType)?.targetType ?? null;
}

export const resolveDeployedUnitType = resolveTask13TargetUnitType;

export function isReversibleDeploymentUnitType(unitType: number): boolean {
  return getTask13DeploymentProfile(unitType)?.reversible ?? false;
}

export function isMobileTurretUnitType(unitType: number): unitType is MobileTurretUnitType {
  return unitType === HUMAN_MOBILE_TURRET_UNIT_TYPE || unitType === ALIEN_MOBILE_TURRET_UNIT_TYPE;
}

export function isDeployedTurretUnitType(unitType: number): unitType is DeployedTurretUnitType {
  return unitType === HUMAN_DEPLOYED_TURRET_UNIT_TYPE || unitType === ALIEN_DEPLOYED_TURRET_UNIT_TYPE;
}

export function isMobileMineUnitType(unitType: number): unitType is MobileMineUnitType {
  return unitType === HUMAN_MOBILE_MINE_UNIT_TYPE || unitType === ALIEN_MOBILE_MINE_UNIT_TYPE;
}

export function isDeployedMineUnitType(unitType: number): unitType is DeployedMineUnitType {
  return unitType === HUMAN_DEPLOYED_MINE_UNIT_TYPE || unitType === ALIEN_DEPLOYED_MINE_UNIT_TYPE;
}

export function isStealthDeployUnitType(unitType: number): unitType is StealthMobileUnitType | StealthDeployedUnitType {
  return (
    unitType === HUMAN_SARGE_UNIT_TYPE ||
    unitType === ALIEN_PSYC_UNIT_TYPE ||
    unitType === HUMAN_DEPLOYED_SARGE_UNIT_TYPE ||
    unitType === ALIEN_DEPLOYED_PSYC_UNIT_TYPE
  );
}

export function isDeployedHarvesterUnitType(unitType: number): unitType is DeployedHarvesterUnitType {
  return unitType === HUMAN_DEPLOYED_HARVESTER_UNIT_TYPE || unitType === ALIEN_DEPLOYED_HARVESTER_UNIT_TYPE;
}

/**
 * DC.EXE `0x416640..0x41677A`: Manhattan distance `< 7` (`0..6`) check to a colony coordinate.
 */
export function isWithinEnemyColonyDeployRange(
  unitX: number,
  unitY: number,
  colonyX: number,
  colonyY: number,
): boolean {
  if (![unitX, unitY, colonyX, colonyY].every(Number.isFinite)) return false;
  return (
    Math.abs(Math.trunc(unitX) - Math.trunc(colonyX)) +
      Math.abs(Math.trunc(unitY) - Math.trunc(colonyY)) <
    COLONY_DEPLOY_MANHATTAN_LIMIT
  );
}

export const isWithinColonyDeployManhattanDistance = isWithinEnemyColonyDeployRange;

export interface ColonyLocation {
  readonly x?: number;
  readonly y?: number;
  readonly cellX?: number;
  readonly cellY?: number;
  readonly tileX?: number;
  readonly tileY?: number;
  readonly base?: readonly [number, number] | { readonly x: number; readonly y: number };
  readonly coordinateRows?: readonly (readonly number[])[];
  readonly team?: number;
  readonly index?: number;
  readonly faction?: Faction;
  readonly health?: number;
  readonly active?: boolean;
}

function resolveColonyCoordinates(colony: ColonyLocation): { readonly x: number; readonly y: number; readonly valid: boolean } {
  if (colony.active === false || (colony.health !== undefined && colony.health <= 0)) {
    return { x: 0, y: 0, valid: false };
  }
  let rawX: number | undefined;
  let rawY: number | undefined;
  if (colony.x !== undefined && colony.y !== undefined) {
    rawX = colony.x;
    rawY = colony.y;
  } else if (colony.cellX !== undefined && colony.cellY !== undefined) {
    rawX = colony.cellX;
    rawY = colony.cellY;
  } else if (colony.tileX !== undefined && colony.tileY !== undefined) {
    rawX = colony.tileX;
    rawY = colony.tileY;
  } else if (Array.isArray(colony.base) && colony.base.length >= 2) {
    rawX = colony.base[0];
    rawY = colony.base[1];
  } else if (colony.base && typeof colony.base === "object" && "x" in colony.base && "y" in colony.base) {
    rawX = (colony.base as { readonly x: number; readonly y: number }).x;
    rawY = (colony.base as { readonly x: number; readonly y: number }).y;
  } else if (colony.coordinateRows && colony.coordinateRows.length >= 2 && colony.coordinateRows[1].length >= 2) {
    rawX = colony.coordinateRows[1][0];
    rawY = colony.coordinateRows[1][1];
  }
  if (rawX === undefined || rawY === undefined || !Number.isFinite(rawX) || !Number.isFinite(rawY)) {
    return { x: 0, y: 0, valid: false };
  }
  const x = Math.trunc(rawX);
  const y = Math.trunc(rawY);
  // In DC.EXE 0x416762..0x416776, a team's colony base is active only when both X != 0 and Y != 0 (unless active: true is explicit)
  if ((x === 0 || y === 0) && colony.active !== true && colony.coordinateRows !== undefined) {
    return { x, y, valid: false };
  }
  return { x, y, valid: true };
}

export function hasEnemyColonyWithinDeployRange(input: {
  readonly unitX: number;
  readonly unitY: number;
  readonly unitTeam?: number;
  readonly unitFaction?: Faction;
  readonly colonies: readonly ColonyLocation[];
  readonly teamAlliances?: readonly (readonly number[])[];
}): boolean {
  const { unitX, unitY, unitTeam, unitFaction, colonies, teamAlliances } = input;
  for (const colony of colonies) {
    const coords = resolveColonyCoordinates(colony);
    if (!coords.valid) continue;
    const colonyTeam = colony.team ?? colony.index;
    if (unitTeam !== undefined && colonyTeam !== undefined) {
      if (colonyTeam === unitTeam || colonyTeam >= 8) continue;
      if (teamAlliances) {
        const actorA = { team: unitTeam, faction: unitFaction ?? ("human" as Faction) };
        const actorB = { team: colonyTeam, faction: colony.faction ?? (unitFaction === "human" ? "alien" : "human") };
        if (!areHostile(actorA, actorB, teamAlliances)) continue;
      }
    }
    if (isWithinEnemyColonyDeployRange(unitX, unitY, coords.x, coords.y)) {
      return true;
    }
  }
  return false;
}

/**
 * DC.EXE `0x41686C..0x4168BA`: Mine cell-occupancy gate (`(word & 0x3FF) === 0x3FF`).
 */
export function isMineCellSlotEmpty(slotWord: number): boolean {
  if (!Number.isInteger(slotWord)) return false;
  if (slotWord === -1) return true;
  return (slotWord & MINE_SLOT_MASK) === EMPTY_MINE_CELL_SLOT;
}

/**
 * DC.EXE `0x417D93..0x417DC5`: Clear low 10 bits of mine/object cell word and write deployed mine slot.
 */
export function writeMineCellSlotWord(previousWord: number, slot: number): number {
  if (!Number.isInteger(slot) || slot < 0 || slot >= EMPTY_MINE_CELL_SLOT) {
    throw new RangeError(`Mine slot must be an integer in 0..${EMPTY_MINE_CELL_SLOT - 1}`);
  }
  const baseWord = Number.isInteger(previousWord) ? previousWord & 0xffff : EMPTY_MINE_CELL_SLOT;
  return ((baseWord & MINE_SLOT_CLEAR_MASK) | (slot & MINE_SLOT_MASK)) & 0xffff;
}

export interface ExistingMineCandidate {
  readonly id?: number;
  readonly unitType?: number;
  readonly sourceTypeIndex?: number;
  readonly cellX?: number;
  readonly cellY?: number;
  readonly x?: number;
  readonly y?: number;
  readonly tileX?: number;
  readonly tileY?: number;
  readonly xSubcells?: number;
  readonly ySubcells?: number;
  readonly health?: number;
  readonly activity?: string;
  readonly mine?: { readonly sourceTypeIndex?: number } | null;
}

export interface MineCellOccupancyInput {
  readonly cellX?: number;
  readonly cellY?: number;
  readonly x?: number;
  readonly y?: number;
  readonly tileX?: number;
  readonly tileY?: number;
  readonly cell?: GridPoint;
  readonly mineCellWord?: number;
  readonly objectSlotWord?: number;
  readonly minePlane?: ArrayLike<number>;
  readonly width?: number;
  readonly height?: number;
  readonly staticTargets?: readonly ExistingMineCandidate[];
  readonly existingMines?: readonly ExistingMineCandidate[];
}

function resolveCellCoordinates(input: {
  readonly cellX?: number;
  readonly cellY?: number;
  readonly x?: number;
  readonly y?: number;
  readonly tileX?: number;
  readonly tileY?: number;
  readonly cell?: GridPoint;
  readonly xSubcells?: number;
  readonly ySubcells?: number;
}): { readonly x: number; readonly y: number } {
  const x =
    input.cell?.x ??
    input.cellX ??
    input.tileX ??
    input.x ??
    (input.xSubcells !== undefined ? Math.floor(input.xSubcells / 1024) : 0);
  const y =
    input.cell?.y ??
    input.cellY ??
    input.tileY ??
    input.y ??
    (input.ySubcells !== undefined ? Math.floor(input.ySubcells / 1024) : 0);
  return { x: Math.trunc(x), y: Math.trunc(y) };
}

function isLivingStaticMine(candidate: ExistingMineCandidate): boolean {
  if (candidate.health !== undefined && candidate.health <= 0) return false;
  if (candidate.activity === "die" || candidate.activity === "death") return false;
  if (candidate.mine !== undefined && candidate.mine !== null) return true;
  const type = candidate.unitType ?? candidate.sourceTypeIndex;
  return type === HUMAN_DEPLOYED_MINE_UNIT_TYPE || type === ALIEN_DEPLOYED_MINE_UNIT_TYPE;
}

/**
 * DC.EXE `0x41686C..0x4168BA`: `ENGI` (`43`) and `SLOM` (`44`) can only deploy if the target cell's
 * mine/object slot is empty (`0x3FF` / no existing static mine on that cell).
 */
export function canDeployMineAtCell(input: MineCellOccupancyInput): boolean {
  const { x, y } = resolveCellCoordinates(input);
  if (input.width !== undefined && input.height !== undefined) {
    if (x < 0 || y < 0 || x >= input.width || y >= input.height) return false;
  }
  const slotWord = input.mineCellWord ?? input.objectSlotWord;
  if (slotWord !== undefined && !isMineCellSlotEmpty(slotWord)) {
    return false;
  }
  if (input.minePlane) {
    const width = input.width ?? 256;
    const index = y * width + x;
    if (index < 0 || index >= input.minePlane.length) return false;
    if (!isMineCellSlotEmpty(input.minePlane[index])) return false;
  }
  const targets = [...(input.staticTargets ?? []), ...(input.existingMines ?? [])];
  for (const target of targets) {
    if (!isLivingStaticMine(target)) continue;
    const targetCell = resolveCellCoordinates(target);
    if (targetCell.x === x && targetCell.y === y) return false;
  }
  return true;
}

export type DeploymentRejectionReason =
  | "unsupported-unit-type"
  | "unit-not-alive"
  | "unit-not-idle"
  | "harvester-undeploy-locked"
  | "enemy-colony-out-of-range"
  | "mine-cell-occupied";

export interface DeploymentStartCheckInput extends MineCellOccupancyInput {
  readonly unitType: number;
  readonly health?: number;
  readonly activity?: string;
  readonly dead?: boolean;
  readonly dying?: boolean;
  readonly status?: number;
  readonly requireIdle?: boolean;
  readonly harvesterUndeployLocked?: boolean;
  readonly unitTeam?: number;
  readonly team?: number;
  readonly unitFaction?: Faction;
  readonly enemyColonies?: readonly ColonyLocation[];
  readonly colonies?: readonly ColonyLocation[];
  readonly enemyColony?: ColonyLocation;
  readonly nearestEnemyColonyDistance?: number;
  readonly requireEnemyColonyProximity?: boolean;
  readonly teamAlliances?: readonly (readonly number[])[];
}

export interface DeploymentEligibilityResult {
  readonly eligible: boolean;
  readonly canDeploy: boolean;
  readonly profile: Task13DeploymentProfile | null;
  readonly reason?: DeploymentRejectionReason;
}

/**
 * Evaluates all `DC.EXE` `0x416784..0x4168BA` deployment start gates for a unit.
 */
export function evaluateTask13DeploymentEligibility(input: DeploymentStartCheckInput): DeploymentEligibilityResult {
  const profile = getTask13DeploymentProfile(input.unitType);
  if (!profile) {
    return { eligible: false, canDeploy: false, profile: null, reason: "unsupported-unit-type" };
  }
  if (
    input.dead === true ||
    input.dying === true ||
    input.activity === "die" ||
    input.activity === "death" ||
    (input.health !== undefined && input.health <= 0) ||
    (input.status !== undefined && (input.status === 0 || input.status === 10))
  ) {
    return { eligible: false, canDeploy: false, profile, reason: "unit-not-alive" };
  }
  if (input.requireIdle && input.activity !== undefined && input.activity !== "idle") {
    return { eligible: false, canDeploy: false, profile, reason: "unit-not-idle" };
  }
  if (profile.category === "harvester" && input.harvesterUndeployLocked === true) {
    return { eligible: false, canDeploy: false, profile, reason: "harvester-undeploy-locked" };
  }
  if (profile.requiresEnemyColonyProximity) {
    const { x, y } = resolveCellCoordinates(input);
    if (input.nearestEnemyColonyDistance !== undefined) {
      if (
        !Number.isFinite(input.nearestEnemyColonyDistance) ||
        input.nearestEnemyColonyDistance < 0 ||
        input.nearestEnemyColonyDistance >= COLONY_DEPLOY_MANHATTAN_LIMIT
      ) {
        return { eligible: false, canDeploy: false, profile, reason: "enemy-colony-out-of-range" };
      }
    } else {
      const colonyList =
        input.enemyColonies ??
        input.colonies ??
        (input.enemyColony ? [input.enemyColony] : undefined);
      if (colonyList !== undefined) {
        const withinRange = hasEnemyColonyWithinDeployRange({
          unitX: x,
          unitY: y,
          unitTeam: input.unitTeam ?? input.team,
          unitFaction: input.unitFaction ?? profile.factionName,
          colonies: colonyList,
          teamAlliances: input.teamAlliances,
        });
        if (!withinRange) {
          return { eligible: false, canDeploy: false, profile, reason: "enemy-colony-out-of-range" };
        }
      } else if (input.requireEnemyColonyProximity === true) {
        return { eligible: false, canDeploy: false, profile, reason: "enemy-colony-out-of-range" };
      }
    }
  }
  if (profile.requiresEmptyMineCell && !canDeployMineAtCell(input)) {
    return { eligible: false, canDeploy: false, profile, reason: "mine-cell-occupied" };
  }
  return { eligible: true, canDeploy: true, profile };
}

export function canStartTask13Deployment(input: DeploymentStartCheckInput): boolean {
  return evaluateTask13DeploymentEligibility(input).eligible;
}

export const canDeployUnit = canStartTask13Deployment;

export interface Task13DeploymentState {
  readonly unitId?: number;
  readonly slot?: number;
  readonly team?: number;
  readonly sourceType: Task13SourceUnitType;
  readonly targetType: Task13TargetUnitType;
  readonly sourceSprite: Task13SourceSprite;
  readonly targetSprite: Task13TargetSprite;
  readonly category: Task13DeploymentCategory;
  readonly direction: Task13DeploymentDirection;
  readonly cellX: number;
  readonly cellY: number;
  readonly taskId: 13;
  readonly initialCountdownTicks: 50;
  readonly countdownTicks: number;
  readonly elapsedTicks: number;
  readonly soundEvent: 5;
  readonly soundGroup: "DPY";
  readonly soundTriggered: boolean;
  readonly finBankAddress: 0x4f1914;
  readonly finStatePrefix: string;
  readonly animationMode: 1 | 2;
  readonly completed: boolean;
}

export interface StartTask13DeploymentInput extends DeploymentStartCheckInput {
  readonly unitId?: number;
  readonly slot?: number;
  readonly localTeam?: number;
}

export type StartTask13DeploymentResult =
  | {
      readonly ok: true;
      readonly started: true;
      readonly profile: Task13DeploymentProfile;
      readonly state: Task13DeploymentState;
    }
  | {
      readonly ok: false;
      readonly started: false;
      readonly profile: Task13DeploymentProfile | null;
      readonly reason: DeploymentRejectionReason;
    };

/**
 * DC.EXE `0x416784..0x41694D`: Starts Task 13 (`0x0D`) with initial countdown `50` ticks (`0x32`),
 * `DPY` FIN animation (`0x4F1914`, mode `1`), and `DPY` sound event `5` (`0x416918`).
 */
export function startTask13Deployment(input: StartTask13DeploymentInput): StartTask13DeploymentResult {
  const eligibility = evaluateTask13DeploymentEligibility(input);
  if (!eligibility.eligible || !eligibility.profile) {
    return {
      ok: false,
      started: false,
      profile: eligibility.profile,
      reason: eligibility.reason ?? "unsupported-unit-type",
    };
  }
  const profile = eligibility.profile;
  const { x, y } = resolveCellCoordinates(input);
  const team = input.unitTeam ?? input.team;
  const soundTriggered = input.localTeam === undefined || team === undefined || team === input.localTeam;
  const state: Task13DeploymentState = Object.freeze({
    ...(input.unitId !== undefined ? { unitId: input.unitId } : {}),
    ...(input.slot !== undefined ? { slot: input.slot } : {}),
    ...(team !== undefined ? { team } : {}),
    sourceType: profile.sourceType,
    targetType: profile.targetType,
    sourceSprite: profile.sourceSprite,
    targetSprite: profile.targetSprite,
    category: profile.category,
    direction: profile.direction,
    cellX: x,
    cellY: y,
    taskId: TASK_13_ID,
    initialCountdownTicks: DEPLOYMENT_INITIAL_COUNTDOWN_TICKS,
    countdownTicks: DEPLOYMENT_INITIAL_COUNTDOWN_TICKS,
    elapsedTicks: 0,
    soundEvent: DEPLOYMENT_SOUND_EVENT,
    soundGroup: DEPLOYMENT_SOUND_GROUP,
    soundTriggered,
    finBankAddress: DEPLOYMENT_FIN_BANK_ADDRESS,
    finStatePrefix: profile.finStatePrefix,
    animationMode: 1,
    completed: false,
  });
  return { ok: true, started: true, profile, state };
}

export function stepTask13Deployment(
  state: Task13DeploymentState,
  options: { readonly ticks?: number; readonly animationMode?: 1 | 2 } = {},
): Task13DeploymentState {
  if (state.completed) return state;
  const ticks = options.ticks === undefined ? 1 : Math.max(0, Math.trunc(options.ticks));
  const nextCountdown = Math.max(0, state.countdownTicks - ticks);
  const elapsedTicks = state.elapsedTicks + (state.countdownTicks - nextCountdown);
  const completed = nextCountdown === 0 || options.animationMode === 2;
  const animationMode: 1 | 2 = completed ? 2 : 1;
  return Object.freeze({
    ...state,
    countdownTicks: nextCountdown,
    elapsedTicks,
    animationMode,
    completed,
  });
}

export interface Task13DeploymentCompletionResult {
  readonly sourceType: Task13SourceUnitType;
  readonly targetType: Task13TargetUnitType;
  readonly sourceSprite: Task13SourceSprite;
  readonly targetSprite: Task13TargetSprite;
  readonly faction: 0 | 1;
  readonly factionName: Faction;
  readonly category: Task13DeploymentCategory;
  readonly direction: Task13DeploymentDirection;
  readonly targetIsStatic: boolean;
  readonly removesMobileFromGroundPlane: boolean;
  readonly writesMineObjectPlane: boolean;
  readonly minePlaneWord?: number;
  readonly standFinBankAddress: 0x4f1900;
  readonly animationMode: 0;
  readonly taskPopped: true;
  readonly profile: Task13DeploymentProfile;
}

/**
 * DC.EXE `0x417B0C..0x417DF5`: Completes Task 13 when animation state reaches `2` (or countdown completes),
 * converting unit type, updating the mine/object plane for `43`/`44`, resetting to STAND (`0x4F1900`), and popping Task 13 (`0x412014`).
 */
export function completeTask13Deployment(
  stateOrSourceType: Task13DeploymentState | number,
  options: { readonly previousMineCellWord?: number; readonly slot?: number } = {},
): Task13DeploymentCompletionResult {
  const sourceType = typeof stateOrSourceType === "number" ? stateOrSourceType : stateOrSourceType.sourceType;
  const profile = getTask13DeploymentProfile(sourceType);
  if (!profile) {
    throw new RangeError(`Unit type ${sourceType} has no Task-13 deployment profile`);
  }
  const slot = options.slot ?? (typeof stateOrSourceType === "object" ? stateOrSourceType.slot : undefined);
  const minePlaneWord =
    profile.writesMineObjectPlane && slot !== undefined
      ? writeMineCellSlotWord(options.previousMineCellWord ?? EMPTY_MINE_CELL_SLOT, slot)
      : undefined;
  return Object.freeze({
    sourceType: profile.sourceType,
    targetType: profile.targetType,
    sourceSprite: profile.sourceSprite,
    targetSprite: profile.targetSprite,
    faction: profile.faction,
    factionName: profile.factionName,
    category: profile.category,
    direction: profile.direction,
    targetIsStatic: profile.targetIsStatic,
    removesMobileFromGroundPlane: profile.removesMobileFromGroundPlane,
    writesMineObjectPlane: profile.writesMineObjectPlane,
    ...(minePlaneWord !== undefined ? { minePlaneWord } : {}),
    standFinBankAddress: STAND_FIN_BANK_ADDRESS,
    animationMode: 0,
    taskPopped: true,
    profile,
  });
}

export type UnitsSourceInput =
  | readonly LegacyUnitStat[]
  | { readonly records: readonly LegacyUnitStat[] }
  | LegacyUnitStat;

export type WeaponsSourceInput =
  | readonly LegacyWeaponStat[]
  | { readonly records: readonly LegacyWeaponStat[] };

export type DamageMatrixSourceInput =
  | LegacyDamageMatrix
  | { readonly coefficients: LegacyDamageMatrix };

export interface BrowserDeploymentDataSources {
  readonly runtimeProfile?: string;
  readonly units?: UnitsSourceInput;
  readonly weapons: WeaponsSourceInput;
  readonly damageMatrix?: DamageMatrixSourceInput;
}

function unwrapUnits(units: UnitsSourceInput): readonly LegacyUnitStat[] {
  if (Array.isArray(units)) return units;
  if ("records" in units && Array.isArray(units.records)) return units.records;
  return [units as LegacyUnitStat];
}

function unwrapWeapons(weapons: WeaponsSourceInput): readonly LegacyWeaponStat[] {
  if (Array.isArray(weapons)) return weapons;
  if ("records" in weapons && Array.isArray(weapons.records)) return weapons.records;
  throw new TypeError("Invalid weapons source table");
}

function unwrapDamageMatrix(matrix: DamageMatrixSourceInput | undefined): LegacyDamageMatrix | undefined {
  if (!matrix) return undefined;
  if (Array.isArray(matrix)) return matrix as LegacyDamageMatrix;
  if ("coefficients" in matrix && Array.isArray(matrix.coefficients)) return matrix.coefficients;
  throw new TypeError("Invalid damage matrix source table");
}

function resolveUnitStat(
  unitOrType: LegacyUnitStat | number,
  unitsSource?: UnitsSourceInput,
): LegacyUnitStat {
  if (typeof unitOrType === "object" && unitOrType !== null) {
    return unitOrType;
  }
  if (!unitsSource) {
    throw new RangeError(`Unit stat table is required to resolve unit type ${unitOrType}`);
  }
  const found = unwrapUnits(unitsSource).find((entry) => entry.index === unitOrType);
  if (!found) {
    throw new RangeError(`Missing unit stat record for unit type ${unitOrType}`);
  }
  return found;
}

export interface BrowserDeployedTurretOptions {
  readonly runtimeProfile: "browser-adapted";
  readonly faction: Faction;
  readonly sourceTypeIndex: DeployedTurretUnitType;
  readonly unitType: DeployedTurretUnitType;
  readonly mobileUnitType: MobileTurretUnitType;
  readonly sprite: "T" | "XDEPLOY";
  readonly weaponLevel: 0 | 1 | 2;
  readonly armorLevel: 0 | 1 | 2;
  readonly weaponId: 34 | 35 | 36 | 40 | 41 | 42;
  readonly maxHealth: number;
  readonly health: number;
  readonly footprint: readonly GridPoint[];
  readonly vision: UnitVisionStats;
  readonly weapon: WeaponStats & { readonly sourceDamage: LegacyDamageProfile };
  readonly sourceDefense: LegacyDefenseProfile & { readonly sourceTypeIndex: DeployedTurretUnitType };
  readonly team?: number;
  readonly cell?: GridPoint;
}

function validateTurretUnitStat(unit: LegacyUnitStat): asserts unit is LegacyUnitStat & { readonly index: DeployedTurretUnitType } {
  if (!isDeployedTurretUnitType(unit.index)) {
    throw new RangeError(`Unsupported deployed turret unit type: ${unit.index}`);
  }
  const expectedSprite = unit.index === 41 ? "T" : "XDEPLOY";
  const expectedFaction = unit.index === 41 ? 0 : 1;
  const expectedWeapons = unit.index === 41 ? HUMAN_TURRET_WEAPON_IDS : ALIEN_TURRET_WEAPON_IDS;
  if (
    unit.sprite !== expectedSprite ||
    unit.faction !== expectedFaction ||
    unit.movementSpeed !== 0 ||
    !Number.isInteger(unit.health) ||
    unit.health <= 0 ||
    unit.weapons.length !== 3 ||
    unit.weapons.some((id, idx) => id !== expectedWeapons[idx])
  ) {
    throw new RangeError(`Invalid deployed turret GAMESTAT record for type ${unit.index}`);
  }
}

/**
 * Validates and builds stationary turret weapon options for `41` (`T`, weapons `[34, 35, 36]`) and
 * `42` (`XDEPLOY`, weapons `[40, 41, 42]`) across weapon levels `0..2`.
 */
export function browserTurretWeaponOptions(
  source: BrowserDeploymentDataSources,
  unitOrType: LegacyUnitStat | number,
  weaponLevel = 0,
  combatOptions?: Partial<Pick<LegacyCombatOptions, "callerFactor" | "specialFlag">>,
): WeaponStats & { readonly sourceDamage: LegacyDamageProfile } {
  let unit = resolveUnitStat(unitOrType, source.units);
  if (isMobileTurretUnitType(unit.index)) {
    const targetType = resolveTask13TargetUnitType(unit.index)!;
    unit = resolveUnitStat(targetType, source.units);
  }
  validateTurretUnitStat(unit);
  if (!Number.isInteger(weaponLevel) || weaponLevel < 0 || weaponLevel > 2) {
    throw new RangeError(`Invalid turret weapon level: ${weaponLevel}`);
  }
  const weapons = unwrapWeapons(source.weapons);
  const damageMatrix = unwrapDamageMatrix(source.damageMatrix);
  if (!damageMatrix || damageMatrix.length !== 9) {
    throw new RangeError("Turret weapon resolution requires a 9-row damage matrix");
  }
  for (const row of damageMatrix) {
    copyLegacyDamageProfile({
      coefficients: row,
      callerFactor: combatOptions?.callerFactor ?? 256,
      specialFlag: combatOptions?.specialFlag ?? false,
    });
  }
  const weaponId = unit.weapons[weaponLevel];
  const weaponStat = weapons.find((entry) => entry.id === weaponId);
  if (
    !weaponStat ||
    weaponStat.rawPrefix !== TURRET_WEAPON_CLASS ||
    weaponStat.shots !== 0 ||
    weaponStat.damage <= 0 ||
    weaponStat.range <= 0 ||
    weaponStat.rateOfFire <= 0
  ) {
    throw new RangeError(`Unsupported stationary turret weapon ${unit.index}:${weaponId}`);
  }
  const sourceDamage = copyLegacyDamageProfile({
    coefficients: damageMatrix[weaponStat.rawPrefix],
    callerFactor: combatOptions?.callerFactor ?? 256,
    specialFlag: combatOptions?.specialFlag ?? false,
  });
  return Object.freeze({
    damage: weaponStat.damage,
    rangeCells: weaponStat.range,
    cooldownTicks: weaponStat.rateOfFire,
    ...(weaponStat.speed !== undefined && weaponStat.speed > 0 && weaponStat.speed <= 1024
      ? { projectileSpeed: weaponStat.speed, weaponId: weaponStat.id, splash: weaponStat.shots }
      : {}),
    sourceDamage,
  });
}

/**
 * Validates and builds stationary turret defense options for `41` (`T`) and `42` (`XDEPLOY`) across armor levels `0..2`.
 */
export function browserTurretDefenseOptions(
  unitOrSource: LegacyUnitStat | BrowserDeploymentDataSources,
  armorLevelOrUnitType = 0,
  maybeArmorLevel?: number,
): LegacyDefenseProfile & { readonly sourceTypeIndex: DeployedTurretUnitType } {
  let unit: LegacyUnitStat;
  let armorLevel: number;
  if ("weapons" in unitOrSource && !("index" in unitOrSource)) {
    unit = resolveUnitStat(armorLevelOrUnitType, unitOrSource.units);
    armorLevel = maybeArmorLevel ?? 0;
  } else {
    unit = unitOrSource as LegacyUnitStat;
    armorLevel = armorLevelOrUnitType;
  }
  if (isMobileTurretUnitType(unit.index) && "units" in unitOrSource) {
    unit = resolveUnitStat(resolveTask13TargetUnitType(unit.index)!, unitOrSource.units);
  }
  validateTurretUnitStat(unit);
  const baseDefense = defenseOptionsFromLegacy(unit, armorLevel);
  return Object.freeze({
    ...baseDefense,
    sourceTypeIndex: unit.index,
  });
}

/**
 * Builds and validates complete stationary turret options for `41` (`T`) and `42` (`XDEPLOY`),
 * accepting either the deployed turret type (`41`/`42`) or the mobile turret type (`1`/`9`).
 */
export function browserDeployedTurretOptions(
  source: BrowserDeploymentDataSources,
  unitOrType: LegacyUnitStat | number,
  options: {
    readonly weaponLevel?: number;
    readonly armorLevel?: number;
    readonly callerFactor?: number;
    readonly specialFlag?: boolean;
    readonly cell?: GridPoint;
    readonly team?: number;
    readonly health?: number;
  } = {},
): BrowserDeployedTurretOptions {
  if (source.runtimeProfile !== undefined && source.runtimeProfile !== "browser-adapted") {
    throw new RangeError(`Unsupported turret runtime profile: ${source.runtimeProfile}`);
  }
  let unit = resolveUnitStat(unitOrType, source.units);
  if (isMobileTurretUnitType(unit.index)) {
    unit = resolveUnitStat(resolveTask13TargetUnitType(unit.index)!, source.units);
  }
  validateTurretUnitStat(unit);
  const weaponLevel = options.weaponLevel ?? 0;
  const armorLevel = options.armorLevel ?? 0;
  if (!Number.isInteger(weaponLevel) || weaponLevel < 0 || weaponLevel > 2) {
    throw new RangeError(`Invalid turret weapon level: ${weaponLevel}`);
  }
  if (!Number.isInteger(armorLevel) || armorLevel < 0 || armorLevel > 2) {
    throw new RangeError(`Invalid turret armor level: ${armorLevel}`);
  }
  const weapon = browserTurretWeaponOptions(source, unit, weaponLevel, {
    callerFactor: options.callerFactor,
    specialFlag: options.specialFlag,
  });
  const sourceDefense = browserTurretDefenseOptions(unit, armorLevel);
  const maxHealth = unit.health;
  const health = options.health ?? maxHealth;
  if (!Number.isInteger(health) || health <= 0 || health > maxHealth) {
    throw new RangeError(`Invalid deployed turret health: ${health}`);
  }
  const footprint = options.cell ? Object.freeze([Object.freeze({ x: options.cell.x, y: options.cell.y })]) : Object.freeze([]);
  const result: BrowserDeployedTurretOptions = Object.freeze({
    runtimeProfile: "browser-adapted",
    faction: unit.faction === 0 ? "human" : "alien",
    sourceTypeIndex: unit.index,
    unitType: unit.index,
    mobileUnitType: unit.index === 41 ? 1 : 9,
    sprite: unit.index === 41 ? "T" : "XDEPLOY",
    weaponLevel: weaponLevel as 0 | 1 | 2,
    armorLevel: armorLevel as 0 | 1 | 2,
    weaponId: unit.weapons[weaponLevel] as 34 | 35 | 36 | 40 | 41 | 42,
    maxHealth,
    health,
    footprint,
    vision: Object.freeze({
      dayRangeCells: unit.observationDay,
      nightRangeCells: unit.observationNight,
    }),
    weapon,
    sourceDefense,
    ...(options.team !== undefined ? { team: options.team } : {}),
    ...(options.cell !== undefined ? { cell: Object.freeze({ x: options.cell.x, y: options.cell.y }) } : {}),
  });
  validateBrowserDeployedTurretOptions(result);
  return result;
}

export function validateBrowserDeployedTurretOptions(options: BrowserDeployedTurretOptions): void {
  if (!options || typeof options !== "object") {
    throw new RangeError("Invalid deployed turret options object");
  }
  if (
    options.runtimeProfile !== "browser-adapted" ||
    !isDeployedTurretUnitType(options.sourceTypeIndex) ||
    options.unitType !== options.sourceTypeIndex ||
    options.mobileUnitType !== (options.sourceTypeIndex === 41 ? 1 : 9) ||
    options.sprite !== (options.sourceTypeIndex === 41 ? "T" : "XDEPLOY") ||
    options.faction !== (options.sourceTypeIndex === 41 ? "human" : "alien") ||
    ![0, 1, 2].includes(options.weaponLevel) ||
    ![0, 1, 2].includes(options.armorLevel)
  ) {
    throw new RangeError("Invalid deployed turret identity or levels");
  }
  const expectedWeapons = options.sourceTypeIndex === 41 ? HUMAN_TURRET_WEAPON_IDS : ALIEN_TURRET_WEAPON_IDS;
  const expectedWeaponId = expectedWeapons[options.weaponLevel];
  const expectedDamages = [100, 125, 150] as const;
  const expectedArmorFactors = [256, 204, 170] as const;
  if (
    options.weaponId !== expectedWeaponId ||
    options.weapon.weaponId !== expectedWeaponId ||
    options.weapon.damage !== expectedDamages[options.weaponLevel] ||
    options.weapon.rangeCells !== 6 ||
    options.weapon.cooldownTicks !== 15 ||
    options.weapon.projectileSpeed !== 60 ||
    options.weapon.splash !== 0 ||
    options.maxHealth !== 800 ||
    !Number.isInteger(options.health) ||
    options.health <= 0 ||
    options.health > options.maxHealth ||
    options.sourceDefense.targetClass !== 6 ||
    options.sourceDefense.armorFactor !== expectedArmorFactors[options.armorLevel] ||
    options.sourceDefense.sourceTypeIndex !== options.sourceTypeIndex
  ) {
    throw new RangeError("Invalid deployed turret weapon or defense stats");
  }
  copyLegacyDamageProfile(options.weapon.sourceDamage);
  copyLegacyDefenseProfile(options.sourceDefense);
}

/**
 * Validates and builds mobile unit options for reversible/undeployed mobile targets (`4`, `12`, `6`, `14`, `1`, `9`, `43`, `44`)
 * using `unitOptionsFromLegacy` and `defenseOptionsFromLegacy`.
 */
export function browserMobileDeploymentUnitOptions(
  source: BrowserDeploymentDataSources,
  unitOrType: LegacyUnitStat | number,
  levels: {
    readonly weaponLevel?: number;
    readonly armorLevel?: number;
    readonly callerFactor?: number;
    readonly specialFlag?: boolean;
  } = {},
): LegacyUnitOptions & { readonly unitType: number; readonly sprite: string } {
  const unit = resolveUnitStat(unitOrType, source.units);
  const weapons = unwrapWeapons(source.weapons);
  const damageMatrix = unwrapDamageMatrix(source.damageMatrix);
  const weaponLevel = levels.weaponLevel ?? 0;
  const armorLevel = levels.armorLevel ?? 0;
  const baseOptions = unitOptionsFromLegacy(
    unit,
    weapons,
    weaponLevel,
    damageMatrix
      ? {
          matrix: damageMatrix,
          armorLevel,
          callerFactor: levels.callerFactor ?? 256,
          specialFlag: levels.specialFlag ?? false,
        }
      : undefined,
  );
  return Object.freeze({
    ...baseOptions,
    unitType: unit.index,
    sprite: unit.sprite,
  });
}

export interface BrowserDeployedMineOptions {
  readonly runtimeProfile: "browser-adapted";
  readonly faction: Faction;
  readonly sourceTypeIndex: DeployedMineUnitType;
  readonly unitType: DeployedMineUnitType;
  readonly mobileUnitType: MobileMineUnitType;
  readonly sprite: "HMINE";
  readonly weaponId: 38;
  readonly armorLevel: 0 | 1 | 2;
  readonly maxHealth: number;
  readonly health: number;
  readonly chargePoolHealth: 900;
  readonly maxCharges: 3;
  readonly chargesRemaining: number;
  readonly chargeHpDeduction: 300;
  readonly minChargeHitHp: 1;
  readonly footprint: readonly [];
  readonly sourceDefense: LegacyDefenseProfile & { readonly sourceTypeIndex: DeployedMineUnitType };
  readonly mine: BrowserMineOptions;
  readonly team?: number;
  readonly cell?: GridPoint;
}

function validateMineUnitStat(unit: LegacyUnitStat): asserts unit is LegacyUnitStat & { readonly index: DeployedMineUnitType } {
  if (!isDeployedMineUnitType(unit.index)) {
    throw new RangeError(`Unsupported deployed mine unit type: ${unit.index}`);
  }
  const expectedFaction = unit.index === 45 ? 0 : 1;
  if (
    unit.sprite !== "HMINE" ||
    unit.faction !== expectedFaction ||
    unit.movementSpeed !== 0 ||
    !Number.isInteger(unit.health) ||
    unit.health <= 0 ||
    unit.weapons.some((id) => id !== MINE_WEAPON_ID)
  ) {
    throw new RangeError(`Invalid deployed mine GAMESTAT record for type ${unit.index}`);
  }
}

/**
 * Validates and builds deployed mine (`45`/`46` `HMINE`) options from `units.json`, `weapons.json`, and `damage-matrix.json`,
 * accepting either the deployed mine type (`45`/`46`) or the mobile mine type (`43` `ENGI` / `44` `SLOM`).
 */
export function browserDeployedMineOptions(
  source: BrowserDeploymentDataSources,
  unitOrType: LegacyUnitStat | number,
  options: {
    readonly armorLevel?: number;
    readonly cell?: GridPoint;
    readonly team?: number;
    readonly health?: number;
    readonly maxHealth?: number;
    readonly chargesRemaining?: number;
  } = {},
): BrowserDeployedMineOptions {
  if (source.runtimeProfile !== undefined && source.runtimeProfile !== "browser-adapted") {
    throw new RangeError(`Unsupported mine runtime profile: ${source.runtimeProfile}`);
  }
  let unit = resolveUnitStat(unitOrType, source.units);
  if (isMobileMineUnitType(unit.index)) {
    unit = resolveUnitStat(resolveTask13TargetUnitType(unit.index)!, source.units);
  }
  validateMineUnitStat(unit);
  const armorLevel = options.armorLevel ?? 0;
  if (!Number.isInteger(armorLevel) || armorLevel < 0 || armorLevel > 2) {
    throw new RangeError(`Invalid mine armor level: ${armorLevel}`);
  }
  const weapons = unwrapWeapons(source.weapons);
  const damageMatrix = unwrapDamageMatrix(source.damageMatrix);
  const mineSource: BrowserMineSource = {
    runtimeProfile: "browser-adapted",
    weapons,
    damageMatrix,
  };
  const mine = browserMineOptions(mineSource, unit);
  if (!mine) {
    throw new RangeError(`Failed to build adapted mine options for unit ${unit.index}`);
  }
  const baseDefense = defenseOptionsFromLegacy(unit, armorLevel);
  const sourceDefense = Object.freeze({
    ...baseDefense,
    sourceTypeIndex: unit.index,
  });
  const maxHealth = options.maxHealth ?? unit.health;
  const health = options.health ?? maxHealth;
  const chargesRemaining = options.chargesRemaining ?? MINE_MAX_CHARGES;
  if (
    !Number.isInteger(maxHealth) ||
    maxHealth <= 0 ||
    !Number.isInteger(health) ||
    health <= 0 ||
    health > Math.max(maxHealth, MINE_IDEAL_CHARGE_POOL_HP) ||
    !Number.isInteger(chargesRemaining) ||
    chargesRemaining < 1 ||
    chargesRemaining > MINE_MAX_CHARGES
  ) {
    throw new RangeError("Invalid deployed mine health or charge count");
  }
  const result: BrowserDeployedMineOptions = Object.freeze({
    runtimeProfile: "browser-adapted",
    faction: unit.faction === 0 ? "human" : "alien",
    sourceTypeIndex: unit.index,
    unitType: unit.index,
    mobileUnitType: unit.index === 45 ? 43 : 44,
    sprite: "HMINE",
    weaponId: MINE_WEAPON_ID,
    armorLevel: armorLevel as 0 | 1 | 2,
    maxHealth,
    health,
    chargePoolHealth: MINE_IDEAL_CHARGE_POOL_HP,
    maxCharges: MINE_MAX_CHARGES,
    chargesRemaining,
    chargeHpDeduction: MINE_CHARGE_HP_DEDUCTION,
    minChargeHitHp: MINE_MIN_CHARGE_HIT_HP,
    footprint: Object.freeze([] as const),
    sourceDefense,
    mine,
    ...(options.team !== undefined ? { team: options.team } : {}),
    ...(options.cell !== undefined ? { cell: Object.freeze({ x: options.cell.x, y: options.cell.y }) } : {}),
  });
  validateBrowserDeployedMineOptions(result);
  return result;
}

export function validateBrowserDeployedMineOptions(options: BrowserDeployedMineOptions): void {
  if (!options || typeof options !== "object") {
    throw new RangeError("Invalid deployed mine options object");
  }
  const expectedArmorFactors = [256, 213, 182] as const;
  if (
    options.runtimeProfile !== "browser-adapted" ||
    !isDeployedMineUnitType(options.sourceTypeIndex) ||
    options.unitType !== options.sourceTypeIndex ||
    options.mobileUnitType !== (options.sourceTypeIndex === 45 ? 43 : 44) ||
    options.sprite !== "HMINE" ||
    options.faction !== (options.sourceTypeIndex === 45 ? "human" : "alien") ||
    options.weaponId !== MINE_WEAPON_ID ||
    ![0, 1, 2].includes(options.armorLevel) ||
    options.maxCharges !== MINE_MAX_CHARGES ||
    !Number.isInteger(options.chargesRemaining) ||
    options.chargesRemaining < 1 ||
    options.chargesRemaining > MINE_MAX_CHARGES ||
    options.chargeHpDeduction !== MINE_CHARGE_HP_DEDUCTION ||
    options.minChargeHitHp !== MINE_MIN_CHARGE_HIT_HP ||
    options.footprint.length !== 0 ||
    options.sourceDefense.targetClass !== 7 ||
    options.sourceDefense.armorFactor !== expectedArmorFactors[options.armorLevel] ||
    options.sourceDefense.sourceTypeIndex !== options.sourceTypeIndex
  ) {
    throw new RangeError("Invalid deployed mine metadata or defense profile");
  }
  validateBrowserMineOptions(options.mine);
  copyLegacyDefenseProfile(options.sourceDefense);
}

/**
 * DC.EXE `0x41310F..0x41312D`:
 * When a mine (`45` or `46`) fires/detonates, `HP -= 300` (`sub eax, 12Ch`),
 * clamping to `1` (`mov eax, 1`) if `HP - 300 <= 0` during the charge hit.
 */
export function deductMineChargeHp(currentHp: number, unitType: number = HUMAN_DEPLOYED_MINE_UNIT_TYPE): number {
  if (!Number.isFinite(currentHp)) {
    throw new RangeError(`Mine HP must be finite: ${currentHp}`);
  }
  const hp = Math.trunc(currentHp);
  if (!isDeployedMineUnitType(unitType)) {
    return Math.max(0, hp);
  }
  if (hp <= 0) return 0;
  const afterSub = hp - MINE_CHARGE_HP_DEDUCTION;
  return afterSub <= 0 ? MINE_MIN_CHARGE_HIT_HP : afterSub;
}

export const clampMineChargeHitHp = deductMineChargeHp;

export interface MineChargeDetonationInput {
  readonly unitType?: number;
  readonly health?: number;
  readonly hp?: number;
  readonly currentHp?: number;
  readonly chargesRemaining?: number;
  readonly charges?: number;
}

export interface MineChargeDetonationResult {
  readonly unitType: DeployedMineUnitType;
  readonly hpBefore: number;
  readonly healthBefore: number;
  readonly previousHealth: number;
  readonly rawHpAfterSub: number;
  readonly chargeHitHp: number;
  readonly clampedHp: number;
  readonly clampedToOne: boolean;
  readonly hpAfter: number;
  readonly healthAfter: number;
  readonly newHealth: number;
  readonly health: number;
  readonly hpDeducted: number;
  readonly selfDamage: number;
  readonly chargesBefore: number;
  readonly previousCharges: number;
  readonly chargesRemaining: number;
  readonly chargesAfter: number;
  readonly charges: number;
  readonly maxCharges: 3;
  readonly detonated: boolean;
  readonly destroyed: boolean;
  readonly depleted: boolean;
  readonly alive: boolean;
}

export function resolveMineChargesFromHp(hp: number): number {
  if (!Number.isFinite(hp) || Math.trunc(hp) <= 0) return 0;
  return Math.min(MINE_MAX_CHARGES, Math.max(1, Math.ceil(Math.trunc(hp) / MINE_CHARGE_HP_DEDUCTION)));
}

/**
 * DC.EXE `0x41310F` 3-charge mine detonation helper:
 * - Deducts `300` HP (`0x12C`) per detonation
 * - Clamps to `1` during the charge hit when `HP - 300 <= 0`
 * - Tracks `3` charges (`900 -> 600 -> 300 -> 0` or `800 -> 500 -> 200 -> 0`, `chargesRemaining: 3 -> 2 -> 1 -> 0`)
 * - Destroys the mine (`hpAfter = 0`, `chargesRemaining = 0`, `destroyed = true`) when the 3rd charge is expended.
 */
export function applyMineChargeDetonation(
  input: MineChargeDetonationInput | number,
  explicitChargesRemaining?: number,
): MineChargeDetonationResult {
  const normalized: MineChargeDetonationInput =
    typeof input === "number"
      ? { health: input, chargesRemaining: explicitChargesRemaining }
      : input;
  const rawUnitType = normalized.unitType ?? HUMAN_DEPLOYED_MINE_UNIT_TYPE;
  if (!isDeployedMineUnitType(rawUnitType)) {
    throw new RangeError(`Unsupported mine unit type for 0x41310F charge deduction: ${rawUnitType}`);
  }
  const rawHp = normalized.health ?? normalized.hp ?? normalized.currentHp ?? MINE_IDEAL_CHARGE_POOL_HP;
  if (!Number.isFinite(rawHp)) {
    throw new RangeError(`Mine health must be finite: ${rawHp}`);
  }
  const hpBefore = Math.max(0, Math.trunc(rawHp));
  const rawCharges = normalized.chargesRemaining ?? normalized.charges ?? explicitChargesRemaining;
  const chargesBefore =
    hpBefore <= 0
      ? 0
      : rawCharges !== undefined
        ? Math.max(0, Math.min(MINE_MAX_CHARGES, Math.trunc(rawCharges)))
        : resolveMineChargesFromHp(hpBefore);

  if (hpBefore <= 0 || chargesBefore <= 0) {
    return Object.freeze({
      unitType: rawUnitType,
      hpBefore,
      healthBefore: hpBefore,
      previousHealth: hpBefore,
      rawHpAfterSub: hpBefore,
      chargeHitHp: 0,
      clampedHp: 0,
      clampedToOne: false,
      hpAfter: 0,
      healthAfter: 0,
      newHealth: 0,
      health: 0,
      hpDeducted: hpBefore,
      selfDamage: hpBefore,
      chargesBefore: 0,
      previousCharges: 0,
      chargesRemaining: 0,
      chargesAfter: 0,
      charges: 0,
      maxCharges: MINE_MAX_CHARGES,
      detonated: false,
      destroyed: true,
      depleted: true,
      alive: false,
    });
  }

  const rawHpAfterSub = hpBefore - MINE_CHARGE_HP_DEDUCTION;
  const clampedToOne = rawHpAfterSub <= 0;
  const chargeHitHp = deductMineChargeHp(hpBefore, rawUnitType);
  const chargesRemaining = Math.max(0, chargesBefore - 1);
  const destroyed = chargesRemaining === 0 || clampedToOne;
  const hpAfter = destroyed ? 0 : chargeHitHp;
  const hpDeducted = hpBefore - hpAfter;

  return Object.freeze({
    unitType: rawUnitType,
    hpBefore,
    healthBefore: hpBefore,
    previousHealth: hpBefore,
    rawHpAfterSub,
    chargeHitHp,
    clampedHp: chargeHitHp,
    clampedToOne,
    hpAfter,
    healthAfter: hpAfter,
    newHealth: hpAfter,
    health: hpAfter,
    hpDeducted,
    selfDamage: hpDeducted,
    chargesBefore,
    previousCharges: chargesBefore,
    chargesRemaining,
    chargesAfter: chargesRemaining,
    charges: chargesRemaining,
    maxCharges: MINE_MAX_CHARGES,
    detonated: true,
    destroyed,
    depleted: destroyed,
    alive: !destroyed,
  });
}

export const detonateMineCharge = applyMineChargeDetonation;

/**
 * Simulates the full 3-charge lifecycle of a deployed mine (`45` or `46`) until depletion.
 */
export function simulateMineChargeLifecycle(
  initialHp: number = MINE_IDEAL_CHARGE_POOL_HP,
  unitType: DeployedMineUnitType = HUMAN_DEPLOYED_MINE_UNIT_TYPE,
): readonly MineChargeDetonationResult[] {
  const steps: MineChargeDetonationResult[] = [];
  let currentHp = initialHp;
  let currentCharges: number = MINE_MAX_CHARGES;
  while (currentHp > 0 && currentCharges > 0) {
    const step = applyMineChargeDetonation({
      unitType,
      health: currentHp,
      chargesRemaining: currentCharges,
    });
    steps.push(step);
    currentHp = step.hpAfter;
    currentCharges = step.chargesRemaining;
    if (!step.detonated || step.destroyed) break;
  }
  return Object.freeze(steps);
}

/**
 * DC.EXE `0x40DE20..0x40DEA9` team-survival unit filter predicate:
 * Excludes deployed mines `45` (`0x2D`), `46` (`0x2E`) and deployed turrets `41` (`0x29`), `42` (`0x2A`).
 */
export function isTeamSurvivalEligibleUnitType(unitType: number): boolean {
  if (!Number.isInteger(unitType) || unitType < 0 || unitType > 109) {
    return false;
  }
  return (
    unitType !== HUMAN_DEPLOYED_TURRET_UNIT_TYPE &&
    unitType !== ALIEN_DEPLOYED_TURRET_UNIT_TYPE &&
    unitType !== HUMAN_DEPLOYED_MINE_UNIT_TYPE &&
    unitType !== ALIEN_DEPLOYED_MINE_UNIT_TYPE
  );
}

export interface TeamSurvivalCandidate {
  readonly slot?: number;
  readonly rawSlot?: number | null;
  readonly team?: number;
  readonly unitType: number;
  readonly status?: number;
  readonly health?: number;
  readonly activity?: string;
  readonly dead?: boolean;
  readonly dying?: boolean;
}

/**
 * DC.EXE `0x40DE20..0x40DEA9`: Returns `true` if `team` has at least one active surviving entity
 * that is not a colony base marker (`slot < 120 && slot % 15 === 5`) and whose `unitType` passes
 * `isTeamSurvivalEligibleUnitType` (excluding deployed turrets `41, 42` and deployed mines `45, 46`).
 */
export function hasTeamSurvivingUnits(
  team: number,
  entities: readonly TeamSurvivalCandidate[],
): boolean {
  if (!Number.isInteger(team) || team < 0 || team > 7) return false;
  for (const entity of entities) {
    if (entity.team !== team) continue;
    const slot = entity.slot ?? entity.rawSlot ?? undefined;
    if (slot !== undefined && slot !== null && slot >= 0 && slot < 120 && slot % 15 === 5) {
      continue;
    }
    if (entity.status !== undefined && (entity.status === 0 || entity.status === 10)) {
      continue;
    }
    if (entity.health !== undefined && entity.health <= 0) {
      continue;
    }
    if (entity.dead === true || entity.dying === true || entity.activity === "die" || entity.activity === "death") {
      continue;
    }
    if (!isTeamSurvivalEligibleUnitType(entity.unitType)) {
      continue;
    }
    return true;
  }
  return false;
}

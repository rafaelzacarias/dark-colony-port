import { validateScenarioCityRow } from "./legacy-scenario-levels";

export interface LegacyColonyTeam {
  readonly index: number;
  readonly race: number;
  readonly coordinateRows: readonly [readonly number[], readonly number[]];
  readonly cityRows: readonly (readonly number[])[];
}

export interface LegacyColonyUnit {
  readonly index: number;
  readonly sprite: string;
  readonly health: number;
}

export interface LegacyColonyPoint {
  readonly x: number;
  readonly y: number;
}

export interface LegacyColonyBuilding {
  readonly nativeId: number;
  readonly team: number;
  readonly slot: number;
  readonly unitType: number;
  readonly sprite: string;
  readonly health: number;
  readonly maxHealth: number;
  readonly nativeState: 1;
  readonly nativePosition: LegacyColonyPoint;
  readonly position: LegacyColonyPoint;
  readonly footprint: readonly LegacyColonyPoint[];
}

export interface LegacyColonySlot {
  readonly nativeId: number;
  readonly team: number;
  readonly slot: number;
  readonly sourceLevel: number | null;
  readonly upgradeLevel: number;
  readonly health: number;
  readonly slotState: 0 | 1;
  readonly entity: LegacyColonyBuilding | null;
}

export interface LegacyColonyProjection {
  readonly slots: readonly LegacyColonySlot[];
  readonly buildings: readonly LegacyColonyBuilding[];
  readonly buildingSlots: Readonly<Record<string, number>>;
}

const UNIT_TYPES = [
  [[16, 17, 18, 20, 22, 81], [16, 17, 19, 21, 22, 81]],
  [[28, 29, 30, 32, 34, 81], [28, 29, 31, 33, 34, 81]],
] as const;

const POSITION_OFFSETS = [[-64, 15], [0, 0], [32, 64], [64, 10], [-32, 65], [0, 32]] as const;
const FOOTPRINT_OFFSETS = [
  [[-3, 0], [-2, 0], [-3, 1], [-2, 1]],
  [[-1, -1], [0, -1], [-1, -2], [0, -2]],
  [[0, 2], [1, 2], [0, 3], [1, 3]],
  [[1, 0], [2, 0], [1, 1], [2, 1]],
  [[-1, 2], [-1, 3], [-2, 2], [-2, 3]],
] as const;

export function legacyColonyFootprint(baseX: number, baseY: number, slot: number): readonly LegacyColonyPoint[] {
  if (!Number.isInteger(slot) || slot < 0 || slot > 4) throw new RangeError("invalid colony footprint slot");
  return FOOTPRINT_OFFSETS[slot].map(([offsetX, offsetY]) => ({ x: baseX + offsetX, y: baseY + offsetY }));
}

function integer(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`unsupported colony ${label}: ${value}`);
  }
  return value;
}

export function projectLegacyColony(
  teams: readonly LegacyColonyTeam[],
  units: readonly LegacyColonyUnit[],
): LegacyColonyProjection {
  const slots: LegacyColonySlot[] = [];
  const buildings: LegacyColonyBuilding[] = [];
  const buildingSlots: Record<string, number> = {};
  const seenTeams = new Set<number>();
  const unitByType = new Map(units.map((unit) => [unit.index, unit]));
  const getUnit = (type: number): LegacyColonyUnit => {
    const unit = unitByType.get(type);
    if (!unit) throw new RangeError(`missing colony unit type ${type}`);
    integer(unit.health, 1, 0x7fffffff, `unit ${type} health`);
    return unit;
  };

  for (const team of teams) {
    integer(team.index, 0, 7, "team");
    integer(team.race, 0, 1, "race");
    if (seenTeams.has(team.index)) throw new RangeError(`duplicate colony team ${team.index}`);
    seenTeams.add(team.index);
    const base = team.coordinateRows[1];
    if (base.length !== 2) throw new RangeError(`colony team ${team.index} requires a base coordinate pair`);
    const baseX = integer(base[0], 0, 255, "base x");
    const baseY = integer(base[1], 0, 255, "base y");
    const city = team.cityRows[0];
    validateScenarioCityRow(city);

    for (let slot = 0; slot < 6; slot += 1) {
      const nativeId = team.index * 15 + slot;
      const sourceLevel = slot === 5 ? null : integer(city[slot * 2], 0, 2, "level");
      const sourceHealth = slot === 5 ? 1 : integer(city[slot * 2 + 1], -1, 0x7fffffff, "health");
      const present = slot === 5 ? baseX !== 0 && baseY !== 0 : baseX !== 0 && sourceLevel !== null && sourceLevel > 0;
      const upgradeLevel = present && sourceLevel !== null ? sourceLevel - 1 : 0;
      const health = !present ? 0 : sourceHealth === -1
        ? getUnit(UNIT_TYPES[0][upgradeLevel][slot]).health
        : sourceHealth;
      let entity: LegacyColonyBuilding | null = null;
      if (health !== 0) {
        const unitType = UNIT_TYPES[team.race][upgradeLevel][slot];
        const unit = getUnit(unitType);
        const [offsetX, offsetY] = POSITION_OFFSETS[slot];
        const nativePosition = {
          x: (baseX * 256 + offsetX * 8) & 0xffff,
          y: (baseY * 256 + offsetY * 8) & 0xffff,
        };
        entity = {
          nativeId, team: team.index, slot, unitType, sprite: unit.sprite,
          health, maxHealth: unit.health, nativeState: 1, nativePosition,
          position: { x: nativePosition.x / 256, y: nativePosition.y / 256 },
          footprint: slot === 5 ? [] : legacyColonyFootprint(baseX, baseY, slot),
        };
        buildings.push(entity);
      }
      slots.push({ nativeId, team: team.index, slot, sourceLevel, upgradeLevel, health,
        slotState: entity ? 1 : 0, entity });
      if (slot < 5) buildingSlots[`${team.index},${slot}`] = health;
    }
  }
  return { slots, buildings, buildingSlots };
}
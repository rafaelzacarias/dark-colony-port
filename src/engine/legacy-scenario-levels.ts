export interface SourceScenarioUpgradeTeam {
  readonly index: number;
  readonly race: number;
  readonly cityRows: readonly (readonly number[])[];
}

export interface SourceScenarioUpgradeLevels {
  readonly team: number;
  readonly sourceTypeIndex: number;
  readonly weaponLevel: number;
  readonly armorLevel: number;
  readonly origin: "type-initialization" | "scenario-unit-row";
}

const SCENARIO_UPGRADE_TYPES = [
  [0, 2, 3, 6, 43, 5, 1, 4],
  [8, 10, 11, 14, 44, 13, 9, 12],
] as const;

function integer(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`unsupported ${label}: ${value}`);
  }
}

export function validateScenarioCityRow(row: readonly number[] | undefined): asserts row is readonly number[] {
  if (!row || (row.length !== 10 && row.length !== 12)) {
    throw new RangeError("scenario city row requires five or six City pairs");
  }
  for (const value of row) integer(value, -0x80000000, 0x7fffffff, "scenario city integer");
  for (let slot = 0; slot < 5; slot += 1) {
    integer(row[slot * 2], 0, 2, "colony level");
    integer(row[slot * 2 + 1], -1, 0x7fffffff, "colony health");
  }
}

export function sourceScenarioUpgradeLevels(
  team: SourceScenarioUpgradeTeam,
  sourceTypeIndex: number,
): SourceScenarioUpgradeLevels {
  integer(team.index, 0, 7, "source team");
  integer(team.race, 0, 1, "scenario race");
  integer(sourceTypeIndex, 0, 105, "source type");
  if (team.cityRows.length !== 9) {
    throw new RangeError("scenario requires one city row and eight unit rows");
  }
  validateScenarioCityRow(team.cityRows[0]);
  const unitRows = team.cityRows.slice(1);
  for (const row of unitRows) {
    if (row.length !== 5) throw new RangeError("scenario unit row requires five integers");
    for (const value of row) integer(value, -0x80000000, 0x7fffffff, "scenario unit integer");
    integer(row[2], 0, 2, "scenario weapon level");
    integer(row[3], 0, 2, "scenario armor level");
  }
  const rowIndex = (SCENARIO_UPGRADE_TYPES[team.race] as readonly number[]).indexOf(sourceTypeIndex);
  return Object.freeze({
    team: team.index, sourceTypeIndex,
    weaponLevel: rowIndex < 0 ? 0 : unitRows[rowIndex][2],
    armorLevel: rowIndex < 0 ? 0 : unitRows[rowIndex][3],
    origin: rowIndex < 0 ? "type-initialization" : "scenario-unit-row",
  });
}
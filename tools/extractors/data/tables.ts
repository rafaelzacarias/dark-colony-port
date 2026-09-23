import { parseLegacyDamageMatrix, type LegacyDamageMatrix } from "../../../src/engine/legacy-balance";

export interface DamageMatrixRecord {
  readonly percentages: readonly (readonly number[])[];
  readonly coefficients: LegacyDamageMatrix;
}

export function parseDamageMatrix(text: string): DamageMatrixRecord {
  const coefficients = parseLegacyDamageMatrix(text);
  const percentages = records(text).slice(2).map((line) => line.split(/\s+/).map(Number));
  return { percentages, coefficients };
}

export interface UnitStatRecord {
  readonly index: number;
  readonly sprite: string;
  readonly faction: number;
  readonly turnSpeed: number;
  readonly movementSpeed: number;
  readonly observationDay: number;
  readonly observationNight: number;
  readonly weapons: readonly [number, number, number];
  readonly armorUpgradePercentages: readonly [number, number];
  readonly targetClass: number;
  readonly health: number;
  readonly rawTail: readonly number[];
}

export interface WeaponStatRecord {
  readonly id: number;
  readonly visualClass: string;
  readonly soundId: number;
  readonly rateOfFire: number;
  readonly damage: number;
  readonly speed: number;
  readonly range: number;
  readonly shots: number;
  readonly reload: number;
  readonly magicChewing: number;
  readonly rawPrefix: number;
  readonly rawTail: readonly number[];
}

export interface DependencyRecord {
  readonly id: number;
  readonly cost: number;
  readonly interfaceId: number;
  readonly rawFields: readonly number[];
  readonly dependencies: readonly number[];
}

export class LegacyTableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyTableError";
  }
}

function records(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("%"));
}

function integer(value: string, context: string): number {
  if (!/^-?\d+$/.test(value)) throw new LegacyTableError(`${context} is not an integer: ${value}`);
  return Number(value);
}

function countedRows(text: string, label: string): string[][] {
  const lines = records(text);
  if (lines.length === 0) throw new LegacyTableError(`${label} is empty`);
  const declared = integer(lines[0], `${label} count`);
  const rows = lines.slice(1).map((line) => line.split(/\s+/));
  if (rows.length !== declared) {
    throw new LegacyTableError(`${label} declares ${declared} records; found ${rows.length}`);
  }
  return rows;
}

export function parseUnitStats(text: string): readonly UnitStatRecord[] {
  return countedRows(text, "GAMESTAT").map((tokens, index) => {
    if (tokens.length !== 33) {
      throw new LegacyTableError(`GAMESTAT record ${index} has ${tokens.length} tokens; expected 33`);
    }
    const values = tokens.slice(1).map((value, column) => integer(value, `GAMESTAT ${index}:${column + 1}`));
    return {
      index,
      sprite: tokens[0],
      faction: values[0],
      turnSpeed: values[1],
      movementSpeed: values[2],
      observationDay: values[3],
      observationNight: values[4],
      weapons: [values[5], values[6], values[7]],
      armorUpgradePercentages: [values[8], values[9]],
      targetClass: values[10],
      health: values[11],
      rawTail: values.slice(10),
    };
  });
}

export function parseWeaponStats(text: string): readonly WeaponStatRecord[] {
  return countedRows(text, "WEAPSTAT").map((tokens, index) => {
    if (tokens.length !== 13) {
      throw new LegacyTableError(`WEAPSTAT record ${index} has ${tokens.length} tokens; expected 13`);
    }
    const values = [tokens[0], ...tokens.slice(2)].map((value, column) =>
      integer(value, `WEAPSTAT ${index}:${column}`),
    );
    return {
      id: values[0],
      visualClass: tokens[1],
      rawPrefix: values[1],
      soundId: values[2],
      rateOfFire: values[3],
      damage: values[4],
      speed: values[5],
      range: values[6],
      shots: values[7],
      reload: values[8],
      magicChewing: values[9],
      rawTail: values.slice(10),
    };
  });
}

export function parseDependencies(text: string): readonly DependencyRecord[] {
  return countedRows(text, "DEPEND").map((tokens, index) => {
    if (tokens.length < 7 || tokens.at(-1) !== "-1") {
      throw new LegacyTableError(`DEPEND record ${index} is malformed`);
    }
    const values = tokens.map((value, column) => integer(value, `DEPEND ${index}:${column}`));
    const kind = values[3];
    const start = kind === 1 ? 5 : kind === 0 || kind === 2 ? 7 : null;
    if (start === null || values.length < start + 1 || values.slice(0, -1).some((value) => value < 0)) {
      throw new LegacyTableError(`DEPEND record ${index} has invalid metadata or an early terminator`);
    }
    return {
      id: values[0],
      cost: values[1],
      interfaceId: values[2],
      rawFields: values.slice(3, start),
      dependencies: values.slice(start, -1),
    };
  });
}

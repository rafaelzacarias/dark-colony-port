export const HUMAN_HEALER_UNIT_TYPE = 49 as const;
export const ALIEN_HEALER_UNIT_TYPE = 50 as const;
export const HEALER_UNIT_TYPES = Object.freeze([HUMAN_HEALER_UNIT_TYPE, ALIEN_HEALER_UNIT_TYPE] as const);

export type BrowserHealerUnitType = typeof HEALER_UNIT_TYPES[number];
export type BrowserHealerSprite = "BEON" | "ZISP";
export type BrowserHealerPass = 0 | 1;
export type BrowserHealerPlane = "ground" | "air";

export const HEALER_MAX_CHARGE = 32 as const;
export const HEALER_INITIAL_CHARGE = 32 as const;
export const HEALER_MIN_CHARGE = 4 as const;
export const HEALER_SCAN_RADIUS = 7 as const;
export const HEALER_DEPLOY_MANHATTAN_LIMIT = 7 as const;
export const DEFAULT_HEALER_UNIT_COST = 300 as const;

export interface BrowserHealerProfile {
  readonly unitType: BrowserHealerUnitType;
  readonly sprite: BrowserHealerSprite;
  readonly faction: 0 | 1;
  readonly dependencyId: 83 | 84;
  readonly cost: 900;
  readonly interfaceId: 135 | 134;
  readonly health: 400;
  readonly maxCharge: 32;
  readonly minHealCharge: 4;
  readonly scanRadius: 7;
  readonly deployManhattanLimit: 7;
}

export const BROWSER_HEALER_PROFILES: Readonly<Record<BrowserHealerUnitType, BrowserHealerProfile>> = Object.freeze({
  49: Object.freeze({
    unitType: 49,
    sprite: "BEON",
    faction: 0,
    dependencyId: 83,
    cost: 900,
    interfaceId: 135,
    health: 400,
    maxCharge: HEALER_MAX_CHARGE,
    minHealCharge: HEALER_MIN_CHARGE,
    scanRadius: HEALER_SCAN_RADIUS,
    deployManhattanLimit: HEALER_DEPLOY_MANHATTAN_LIMIT,
  }),
  50: Object.freeze({
    unitType: 50,
    sprite: "ZISP",
    faction: 1,
    dependencyId: 84,
    cost: 900,
    interfaceId: 134,
    health: 400,
    maxCharge: HEALER_MAX_CHARGE,
    minHealCharge: HEALER_MIN_CHARGE,
    scanRadius: HEALER_SCAN_RADIUS,
    deployManhattanLimit: HEALER_DEPLOY_MANHATTAN_LIMIT,
  }),
});

/**
 * Unit production costs from GAMESTAT/DEPEND.TXT (`rawFields[0] === 1`, `rawFields[1] === unitType`).
 * Spawned unit types without a dependency record fall back to `DEFAULT_HEALER_UNIT_COST` (300).
 */
export const DEFAULT_DEPENDENCY_UNIT_COSTS: Readonly<Record<number, number>> = Object.freeze({
  0: 350,
  1: 900,
  2: 600,
  3: 1000,
  4: 1500,
  5: 600,
  6: 1500,
  8: 350,
  9: 900,
  10: 600,
  11: 1000,
  12: 1500,
  13: 600,
  14: 1500,
  43: 450,
  44: 450,
  49: 900,
  50: 900,
});

export interface DependencyCostRecord {
  readonly id?: number;
  readonly cost: number;
  readonly rawFields: readonly number[];
}

export type UnitCostLookup =
  | ReadonlyMap<number, number>
  | Readonly<Record<number, number>>
  | readonly DependencyCostRecord[]
  | { readonly records: readonly DependencyCostRecord[] };

export interface BrowserHealerCandidate {
  readonly id: number;
  readonly unitType?: number;
  readonly unitCost?: number;
  readonly owner?: number;
  readonly team?: number;
  readonly x?: number;
  readonly y?: number;
  readonly cellX?: number;
  readonly cellY?: number;
  readonly tileX?: number;
  readonly tileY?: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly pass?: BrowserHealerPass;
  readonly movementPlane?: "ground" | "air";
  readonly plane?: "ground" | "air" | "flying";
  readonly activity?: string;
  readonly dead?: boolean;
  readonly dying?: boolean;
  readonly status?: number;
}

export interface BrowserHealerActor {
  readonly id?: number;
  readonly unitType?: number;
  readonly owner?: number;
  readonly team?: number;
  readonly x?: number;
  readonly y?: number;
  readonly cellX?: number;
  readonly cellY?: number;
  readonly sourceX?: number;
  readonly sourceY?: number;
  readonly charge?: number;
  readonly health?: number;
  readonly activity?: string;
  readonly dead?: boolean;
  readonly dying?: boolean;
}

export interface BrowserHealerScanInput {
  readonly healer?: BrowserHealerActor;
  readonly healerId?: number;
  readonly owner?: number;
  readonly team?: number;
  readonly sourceX?: number;
  readonly sourceY?: number;
  readonly cellX?: number;
  readonly cellY?: number;
  readonly charge?: number;
  readonly width?: number;
  readonly height?: number;
  readonly candidates: readonly BrowserHealerCandidate[];
  readonly unitCosts?: UnitCostLookup;
  readonly fallbackUnitCost?: number;
}

export interface CostScaledHealOutcome {
  readonly missingHp: number;
  readonly unitCost: number;
  readonly fullChargeCost: number;
  readonly hpPerCharge: number;
  readonly healedHp: number;
  readonly chargeBefore: number;
  readonly chargeAfter: number;
  readonly chargeSpent: number;
  readonly partial: boolean;
}

export interface BrowserHealerHealEvent extends CostScaledHealOutcome {
  readonly id: number;
  readonly targetId: number;
  readonly unitType: number;
  readonly x: number;
  readonly y: number;
  readonly cellX: number;
  readonly cellY: number;
  readonly pass: BrowserHealerPass;
  readonly plane: BrowserHealerPlane;
  readonly radius: number;
  readonly previousHealth: number;
  readonly newHealth: number;
  readonly maxHealth: number;
}

export interface BrowserHealerScanResult {
  readonly healerId: number;
  readonly initialCharge: number;
  readonly charge: number;
  readonly finalCharge: number;
  readonly chargeSpent: number;
  readonly healed: readonly BrowserHealerHealEvent[];
  readonly candidates: readonly BrowserHealerCandidate[];
  readonly healthByUnitId: ReadonlyMap<number, number>;
  readonly stoppedByLowCharge: boolean;
  readonly recharged: boolean;
}

export interface BrowserHealerState {
  readonly unitId: number;
  readonly unitType: BrowserHealerUnitType;
  readonly charge: number;
}

export interface BrowserHealerUnitCostState {
  readonly unitId: number;
  readonly unitType?: number;
  readonly unitCost?: number;
}

export interface BrowserHealerCheckpoint {
  readonly healers: readonly BrowserHealerState[];
  readonly unitCosts?: readonly BrowserHealerUnitCostState[];
}

export function isHealerUnitType(unitType: number): unitType is BrowserHealerUnitType {
  return unitType === HUMAN_HEALER_UNIT_TYPE || unitType === ALIEN_HEALER_UNIT_TYPE;
}

export function resolveHealerUnitType(
  unitType?: number,
  sprite?: string,
  sourceTypeIndex?: number,
): BrowserHealerUnitType | null {
  if (unitType !== undefined && isHealerUnitType(unitType)) return unitType;
  if (sprite === "BEON") return HUMAN_HEALER_UNIT_TYPE;
  if (sprite === "ZISP") return ALIEN_HEALER_UNIT_TYPE;
  if (sourceTypeIndex !== undefined && isHealerUnitType(sourceTypeIndex)) return sourceTypeIndex;
  return null;
}

export function getHealerProfile(unitType: number): BrowserHealerProfile | null {
  return isHealerUnitType(unitType) ? BROWSER_HEALER_PROFILES[unitType] : null;
}

export function verifiedHealerSprite(unitType: number): BrowserHealerSprite | null {
  return getHealerProfile(unitType)?.sprite ?? null;
}

export function isHealerUnitStat(unit: {
  readonly index: number;
  readonly sprite?: string;
  readonly faction?: number;
  readonly health?: number;
}): boolean {
  const profile = getHealerProfile(unit.index);
  if (!profile) return false;
  if (unit.sprite !== undefined && unit.sprite !== profile.sprite) return false;
  if (unit.faction !== undefined && unit.faction !== profile.faction) return false;
  if (unit.health !== undefined && unit.health !== profile.health) return false;
  return true;
}

export function buildUnitCostTable(
  source: readonly DependencyCostRecord[] | { readonly records: readonly DependencyCostRecord[] },
): ReadonlyMap<number, number> {
  const records = "records" in source ? source.records : source;
  const table = new Map<number, number>();
  for (const record of records) {
    if (record.rawFields.length >= 2 && record.rawFields[0] === 1) {
      const unitType = record.rawFields[1];
      if (Number.isInteger(unitType) && unitType >= 0 && Number.isFinite(record.cost) && record.cost > 0) {
        table.set(unitType, Math.trunc(record.cost));
      }
    }
  }
  return table;
}

export function resolveUnitHealCost(
  unitType: number | undefined,
  costs?: UnitCostLookup,
  fallbackCost: number = DEFAULT_HEALER_UNIT_COST,
): number {
  const safeFallback = Number.isFinite(fallbackCost) && fallbackCost > 0
    ? Math.trunc(fallbackCost)
    : DEFAULT_HEALER_UNIT_COST;
  if (unitType === undefined || !Number.isInteger(unitType) || unitType < 0) {
    return safeFallback;
  }
  if (costs instanceof Map) {
    const found = costs.get(unitType);
    if (found !== undefined && Number.isFinite(found) && found > 0) return Math.trunc(found);
  } else if (Array.isArray(costs) || (costs && typeof costs === "object" && "records" in costs)) {
    const table = buildUnitCostTable(
      costs as readonly DependencyCostRecord[] | { readonly records: readonly DependencyCostRecord[] },
    );
    const found = table.get(unitType);
    if (found !== undefined && found > 0) return found;
  } else if (costs && typeof costs === "object") {
    const record = costs as Readonly<Record<number, number>>;
    const found = record[unitType];
    if (found !== undefined && Number.isFinite(found) && found > 0) return Math.trunc(found);
  }
  const defaultCost = DEFAULT_DEPENDENCY_UNIT_COSTS[unitType];
  return defaultCost !== undefined && defaultCost > 0 ? defaultCost : safeFallback;
}

/**
 * DC.EXE 0x413CA7 (`cmp dl, 4; jae 0x413CB4`): healing requires `charge >= 4`.
 */
export function canHealerHeal(charge: number): boolean {
  return Number.isFinite(charge) && Math.trunc(charge) >= HEALER_MIN_CHARGE;
}

/**
 * DC.EXE `[esi+0Ah]` recharge: `charge = Math.min(32, charge + 1)` clamped to `0..32`.
 */
export function rechargeHealer(charge: number, amount = 1): number {
  const base = Number.isFinite(charge) ? Math.max(0, Math.min(HEALER_MAX_CHARGE, Math.trunc(charge))) : 0;
  const delta = Number.isFinite(amount) ? Math.max(0, Math.trunc(amount)) : 0;
  return Math.min(HEALER_MAX_CHARGE, base + delta);
}

/**
 * DC.EXE 0x413F11..0x413F2E:
 * `fullChargeCost = Math.trunc((missingHp * 64) / unitCost)` (`shl 8; sar 2; idiv unitCost`).
 */
export function calculateFullHealChargeCost(
  missingHp: number,
  unitCost: number,
  fallbackCost: number = DEFAULT_HEALER_UNIT_COST,
): number {
  const safeMissing = Number.isFinite(missingHp) ? Math.max(0, Math.trunc(missingHp)) : 0;
  const safeCost = Number.isFinite(unitCost) && Math.trunc(unitCost) > 0
    ? Math.trunc(unitCost)
    : (Number.isFinite(fallbackCost) && Math.trunc(fallbackCost) > 0 ? Math.trunc(fallbackCost) : DEFAULT_HEALER_UNIT_COST);
  return Math.trunc((safeMissing * 64) / safeCost);
}

/**
 * DC.EXE 0x413E30..0x413E47:
 * `hpPerCharge = Math.trunc((unitCost * 36) / 256)` (`(eax * 9 * 4) >> 8`).
 */
export function calculateHpPerCharge(
  unitCost: number,
  fallbackCost: number = DEFAULT_HEALER_UNIT_COST,
): number {
  const safeCost = Number.isFinite(unitCost) && Math.trunc(unitCost) > 0
    ? Math.trunc(unitCost)
    : (Number.isFinite(fallbackCost) && Math.trunc(fallbackCost) > 0 ? Math.trunc(fallbackCost) : DEFAULT_HEALER_UNIT_COST);
  return Math.trunc((safeCost * 36) / 256);
}

/**
 * DC.EXE 0x413E17..0x413FE0 cost-scaled healing & charge math.
 */
export function calculateCostScaledHeal(
  missingHp: number,
  charge: number,
  unitCost: number,
  fallbackCost: number = DEFAULT_HEALER_UNIT_COST,
): CostScaledHealOutcome {
  const safeMissing = Number.isFinite(missingHp) ? Math.max(0, Math.trunc(missingHp)) : 0;
  const safeCharge = Number.isFinite(charge) ? Math.max(0, Math.min(HEALER_MAX_CHARGE, Math.trunc(charge))) : 0;
  const safeCost = Number.isFinite(unitCost) && Math.trunc(unitCost) > 0
    ? Math.trunc(unitCost)
    : (Number.isFinite(fallbackCost) && Math.trunc(fallbackCost) > 0 ? Math.trunc(fallbackCost) : DEFAULT_HEALER_UNIT_COST);
  const fullChargeCost = calculateFullHealChargeCost(safeMissing, safeCost, fallbackCost);
  const hpPerCharge = calculateHpPerCharge(safeCost, fallbackCost);

  if (safeMissing <= 0 || safeCharge < HEALER_MIN_CHARGE) {
    return {
      missingHp: safeMissing,
      unitCost: safeCost,
      fullChargeCost,
      hpPerCharge,
      healedHp: 0,
      chargeBefore: safeCharge,
      chargeAfter: safeCharge,
      chargeSpent: 0,
      partial: false,
    };
  }

  if (fullChargeCost <= safeCharge) {
    const nextCharge = Math.max(0, safeCharge - fullChargeCost);
    return {
      missingHp: safeMissing,
      unitCost: safeCost,
      fullChargeCost,
      hpPerCharge,
      healedHp: safeMissing,
      chargeBefore: safeCharge,
      chargeAfter: nextCharge,
      chargeSpent: safeCharge - nextCharge,
      partial: false,
    };
  }

  const healedHp = Math.min(safeMissing, Math.max(1, safeCharge * hpPerCharge));
  return {
    missingHp: safeMissing,
    unitCost: safeCost,
    fullChargeCost,
    hpPerCharge,
    healedHp,
    chargeBefore: safeCharge,
    chargeAfter: 0,
    chargeSpent: safeCharge,
    partial: true,
  };
}

/**
 * DC.EXE 0x416640..0x41677A deploy-eligibility Manhattan range check:
 * `abs(x - sourceX) + abs(y - sourceY) < 7` (Manhattan distance 0..6).
 */
export function isWithinHealerDeployRange(
  sourceX: number,
  sourceY: number,
  x: number,
  y: number,
): boolean {
  return Math.abs(Math.trunc(x) - Math.trunc(sourceX)) + Math.abs(Math.trunc(y) - Math.trunc(sourceY)) < HEALER_DEPLOY_MANHATTAN_LIMIT;
}

export function isWithinHealerScanRadius(
  sourceX: number,
  sourceY: number,
  x: number,
  y: number,
): boolean {
  return Math.max(Math.abs(Math.trunc(x) - Math.trunc(sourceX)), Math.abs(Math.trunc(y) - Math.trunc(sourceY))) <= HEALER_SCAN_RADIUS;
}

function resolveCandidateCell(candidate: BrowserHealerCandidate): { readonly x: number; readonly y: number } {
  const x = candidate.cellX ?? candidate.x ?? candidate.tileX ?? 0;
  const y = candidate.cellY ?? candidate.y ?? candidate.tileY ?? 0;
  return { x: Math.trunc(x), y: Math.trunc(y) };
}

function resolveCandidatePass(candidate: BrowserHealerCandidate): BrowserHealerPass {
  if (candidate.pass === 0 || candidate.pass === 1) return candidate.pass;
  if (candidate.movementPlane === "air" || candidate.plane === "air" || candidate.plane === "flying") return 1;
  return 0;
}

function resolveCandidateOwner(candidate: BrowserHealerCandidate): number | undefined {
  return candidate.owner ?? candidate.team;
}

function isCandidateAlive(candidate: BrowserHealerCandidate, currentHealth: number): boolean {
  if (currentHealth <= 0) return false;
  if (candidate.dead === true || candidate.dying === true) return false;
  if (candidate.activity === "die" || candidate.activity === "death") return false;
  if (candidate.status !== undefined && (candidate.status === 0 || candidate.status === 10)) return false;
  return true;
}

export function canHealerDeployAt(input: BrowserHealerScanInput): boolean {
  const healer = input.healer;
  if (healer && (healer.dead === true || healer.dying === true || healer.activity === "die" || healer.activity === "death"
    || (healer.health !== undefined && healer.health <= 0))) {
    return false;
  }
  const initialCharge = Math.max(0, Math.min(HEALER_MAX_CHARGE, Math.trunc(input.charge ?? healer?.charge ?? HEALER_INITIAL_CHARGE)));
  if (!canHealerHeal(initialCharge)) return false;

  const healerId = input.healerId ?? healer?.id ?? -1;
  const healerOwner = input.owner ?? input.team ?? healer?.owner ?? healer?.team ?? 0;
  const sourceX = Math.trunc(input.sourceX ?? input.cellX ?? healer?.sourceX ?? healer?.cellX ?? healer?.x ?? 0);
  const sourceY = Math.trunc(input.sourceY ?? input.cellY ?? healer?.sourceY ?? healer?.cellY ?? healer?.y ?? 0);
  const width = Math.trunc(input.width ?? 256);
  const height = Math.trunc(input.height ?? 256);

  for (const candidate of input.candidates) {
    if (candidate.id === healerId) continue;
    if (!isCandidateAlive(candidate, Math.trunc(candidate.health))) continue;
    if (resolveCandidateOwner(candidate) !== healerOwner) continue;
    const missingHp = Math.trunc(candidate.maxHealth) - Math.trunc(candidate.health);
    if (missingHp <= 0) continue;
    const { x, y } = resolveCandidateCell(candidate);
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    if (isWithinHealerDeployRange(sourceX, sourceY, x, y)) return true;
  }
  return false;
}

/**
 * DC.EXE 0x413C20..0x414068 neighborhood healing scan:
 * - Outer radius `r = 0..7` (`[ebp-40h] < 8`)
 * - `x` from `sourceX - r` to `sourceX + r`
 * - `y` from `sourceY - r` to `sourceY + r`
 * - Two passes per cell (`pass = 0` ground layer, `pass = 1` air layer)
 * - Stops immediately when `charge < 4` (`0x413CA7`, `0x414005`).
 */
export function scanBrowserHealerNeighborhood(input: BrowserHealerScanInput): BrowserHealerScanResult {
  const healer = input.healer;
  const healerId = input.healerId ?? healer?.id ?? -1;
  const healerOwner = input.owner ?? input.team ?? healer?.owner ?? healer?.team ?? 0;
  const sourceX = Math.trunc(input.sourceX ?? input.cellX ?? healer?.sourceX ?? healer?.cellX ?? healer?.x ?? 0);
  const sourceY = Math.trunc(input.sourceY ?? input.cellY ?? healer?.sourceY ?? healer?.cellY ?? healer?.y ?? 0);
  const width = Math.trunc(input.width ?? 256);
  const height = Math.trunc(input.height ?? 256);
  const fallbackCost = input.fallbackUnitCost ?? DEFAULT_HEALER_UNIT_COST;
  const costTable = Array.isArray(input.unitCosts) || (input.unitCosts && typeof input.unitCosts === "object" && "records" in input.unitCosts)
    ? buildUnitCostTable(input.unitCosts as readonly DependencyCostRecord[] | { readonly records: readonly DependencyCostRecord[] })
    : input.unitCosts;

  const initialCharge = Math.max(0, Math.min(HEALER_MAX_CHARGE, Math.trunc(input.charge ?? healer?.charge ?? HEALER_INITIAL_CHARGE)));
  let charge = initialCharge;
  const healed: BrowserHealerHealEvent[] = [];
  const healthByUnitId = new Map<number, number>();
  for (const candidate of input.candidates) {
    healthByUnitId.set(candidate.id, Math.trunc(candidate.health));
  }

  if (healer && (healer.dead === true || healer.dying === true || healer.activity === "die" || healer.activity === "death"
    || (healer.health !== undefined && healer.health <= 0))) {
    return {
      healerId,
      initialCharge,
      charge,
      finalCharge: charge,
      chargeSpent: 0,
      healed,
      candidates: input.candidates.map((candidate) => ({ ...candidate })),
      healthByUnitId,
      stoppedByLowCharge: false,
      recharged: false,
    };
  }

  const byCellAndPass = new Map<string, BrowserHealerCandidate[]>();
  for (const candidate of input.candidates) {
    const { x, y } = resolveCandidateCell(candidate);
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const pass = resolveCandidatePass(candidate);
    const key = `${x},${y},${pass}`;
    const bucket = byCellAndPass.get(key);
    if (bucket) bucket.push(candidate);
    else byCellAndPass.set(key, [candidate]);
  }

  let stoppedByLowCharge = false;

  outer: for (let r = 0; r <= HEALER_SCAN_RADIUS; r += 1) {
    for (let x = sourceX - r; x <= sourceX + r; x += 1) {
      for (let y = sourceY - r; y <= sourceY + r; y += 1) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        for (let pass = 0 as BrowserHealerPass; pass <= 1; pass = (pass + 1) as BrowserHealerPass) {
          if (!canHealerHeal(charge)) {
            stoppedByLowCharge = true;
            break outer;
          }
          const occupants = byCellAndPass.get(`${x},${y},${pass}`);
          if (!occupants) continue;
          for (const candidate of occupants) {
            if (!canHealerHeal(charge)) {
              stoppedByLowCharge = true;
              break outer;
            }
            if (candidate.id === healerId) continue;
            const currentHealth = healthByUnitId.get(candidate.id) ?? Math.trunc(candidate.health);
            if (!isCandidateAlive(candidate, currentHealth)) continue;
            if (resolveCandidateOwner(candidate) !== healerOwner) continue;
            const maxHealth = Math.trunc(candidate.maxHealth);
            const missingHp = maxHealth - currentHealth;
            if (missingHp <= 0) continue;

            const unitType = candidate.unitType ?? -1;
            const unitCost = candidate.unitCost !== undefined && Number.isFinite(candidate.unitCost) && candidate.unitCost > 0
              ? Math.trunc(candidate.unitCost)
              : resolveUnitHealCost(unitType >= 0 ? unitType : undefined, costTable, fallbackCost);
            const outcome = calculateCostScaledHeal(missingHp, charge, unitCost, fallbackCost);
            if (outcome.healedHp <= 0) continue;

            const newHealth = Math.min(maxHealth, currentHealth + outcome.healedHp);
            healthByUnitId.set(candidate.id, newHealth);
            charge = outcome.chargeAfter;

            healed.push({
              ...outcome,
              id: candidate.id,
              targetId: candidate.id,
              unitType,
              x,
              y,
              cellX: x,
              cellY: y,
              pass,
              plane: pass === 1 ? "air" : "ground",
              radius: r,
              previousHealth: currentHealth,
              newHealth,
              maxHealth,
            });
          }
        }
        if (!canHealerHeal(charge)) {
          stoppedByLowCharge = true;
          break outer;
        }
      }
    }
  }

  const updatedCandidates = input.candidates.map((candidate) => {
    const updatedHealth = healthByUnitId.get(candidate.id);
    return updatedHealth !== undefined && updatedHealth !== candidate.health
      ? { ...candidate, health: updatedHealth }
      : { ...candidate };
  });

  return {
    healerId,
    initialCharge,
    charge,
    finalCharge: charge,
    chargeSpent: initialCharge - charge,
    healed,
    candidates: updatedCandidates,
    healthByUnitId,
    stoppedByLowCharge,
    recharged: false,
  };
}

/**
 * Runs a healer neighborhood scan; when not healing on a recharge cadence, recharges `charge = Math.min(32, charge + 1)`.
 */
export function stepBrowserHealer(
  input: BrowserHealerScanInput & { readonly rechargeOnIdle?: boolean },
): BrowserHealerScanResult {
  const result = scanBrowserHealerNeighborhood(input);
  if (result.healed.length === 0 && (input.rechargeOnIdle ?? true)) {
    const nextCharge = rechargeHealer(result.finalCharge, 1);
    return {
      ...result,
      charge: nextCharge,
      finalCharge: nextCharge,
      recharged: nextCharge > result.initialCharge,
    };
  }
  return result;
}

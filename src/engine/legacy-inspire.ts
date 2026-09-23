export interface LegacyInspireProfile {
  readonly capability: number;
  readonly recharge: number;
  readonly multiplierQ8: number;
  readonly visitBudget: number;
}

export const LEGACY_INSPIRE_NATIVE_RANDOM_TABLE: readonly number[] = Object.freeze([
  16838,5758,10113,17515,31051,5627,23010,7419,16212,4086,2749,12767,9084,12060,32225,17543,
  25089,21183,25137,25566,26966,4978,20495,10311,11367,30054,17031,13145,19882,25736,30524,28505,
  28394,22102,24851,19067,12754,11653,6561,27096,13628,15188,32085,4143,6967,31406,24165,13403,
  25562,24834,31353,920,10444,24803,7962,19318,1422,31327,10457,1945,14479,29983,18751,3894,
  18670,8259,16248,7757,15629,13306,28606,13990,11738,12516,1414,5262,17116,22825,3181,13134,
  25343,8022,11233,7536,9760,9979,29071,1201,21336,13061,22160,24005,30729,7644,27475,31693,
  25514,14139,22088,26521,5202,9171,4434,28317,24582,6815,4586,9653,26306,7174,18451,23448,
  6473,32434,8193,14110,24748,28210,29320,32049,12956,14162,4166,14997,7793,32310,21391,19799,
  7926,14905,25885,2582,15610,5000,8052,30965,20120,32380,15639,26204,24385,12475,15725,17265,
  3214,19471,11376,4697,25543,23297,14619,23087,3123,31549,18065,24256,18973,20901,25613,6157,
  9899,9267,22413,9598,18526,13711,10046,14566,18536,15988,19878,13626,4273,8387,1171,32017,
  3752,12388,21191,11483,18122,11744,18528,15585,5363,20159,5641,18176,9575,28578,27363,27685,
  29344,19489,17713,5511,21461,22626,8645,3496,26703,6270,13870,11529,27499,4500,8607,5808,
  15725,12457,16542,16474,11531,17222,3952,17024,19894,24015,18247,11276,26278,19365,8746,21976,
  18092,25851,29088,29163,2231,26233,29732,21106,5411,9874,5448,9344,27589,17574,1191,6789,
  695,11735,20364,17040,17892,5035,26979,1092,850,12390,20195,668,20531,29989,12281,23902,
]);

export function verifiedLegacyInspireDeployFin(typeId: number): "TRSC" | "GRAY" | null {
  return typeId === 69 ? "TRSC" : typeId === 73 ? "GRAY" : null;
}

export interface LegacyInspireState {
  readonly charge: number;
  readonly timer: number;
  readonly casterSlot: number;
}

export interface LegacyInspireSlot {
  readonly team: number;
  readonly multiplierQ8: number;
  readonly primaryWeapon: number;
}

export interface LegacyInspireScanInput {
  readonly xQ8: number;
  readonly yQ8: number;
  readonly casterSlot: number;
  readonly casterTeam: number;
  readonly visitBudget: number;
  readonly width: number;
  readonly height: number;
  readonly ground: ArrayLike<number>;
  readonly air: ArrayLike<number>;
  readonly slots: Readonly<Record<number, LegacyInspireSlot>>;
  readonly randomTable: ArrayLike<number>;
  readonly randomIndex: number;
}

export interface LegacyInspireWrite {
  readonly targetSlot: number;
  readonly timer: number;
  readonly casterSlot: number;
}

export interface LegacyInspireScanResult {
  readonly casterCharge: 0;
  readonly writes: readonly LegacyInspireWrite[];
  readonly randomIndex: number;
  readonly remainingBudget: number;
  readonly coordinateVisits: number;
}

export interface LegacyInspireTask13Frame {
  readonly animationMode: number;
  readonly casterTypeId: number;
  readonly casterSlot: number;
  readonly xQ8: number;
  readonly yQ8: number;
}

export interface LegacyInspireTask13Host {
  continuePendingOrder(casterSlot: number): void;
  clearCasterCharge(casterSlot: number): void;
  readScanContext(casterSlot: number): Omit<LegacyInspireScanInput, "casterSlot" | "xQ8" | "yQ8" | "visitBudget">;
  commitScan(result: LegacyInspireScanResult): void;
}

export function completeLegacyInspireTask13(
  frame: LegacyInspireTask13Frame,
  host: LegacyInspireTask13Host,
): LegacyInspireScanResult | null {
  if (frame.animationMode !== 2) return null;
  const { casterTypeId, casterSlot, xQ8, yQ8 } = frame;
  const profile = getLegacyInspireProfile(casterTypeId);
  if (!profile) throw new RangeError(`task 13 is not Inspire for type ${casterTypeId}`);
  host.continuePendingOrder(casterSlot);
  host.clearCasterCharge(casterSlot);
  const result = scanLegacyInspireEffect({
    ...host.readScanContext(casterSlot), casterSlot, xQ8, yQ8, visitBudget: profile.visitBudget,
  });
  host.commitScan(result);
  return result;
}

export function getLegacyInspireProfile(typeId: number): LegacyInspireProfile | null {
  if (!Number.isInteger(typeId) || typeId < 69 || typeId > 76) return null;
  const level = (typeId - 69) % 4;
  return {
    capability: 0xc4,
    recharge: 1,
    multiplierQ8: [332, 358, 384, 409][level],
    visitBudget: 6 + 2 * level,
  };
}

export function getLegacyInspireChargeGates(charge: number): {
  readonly uiChargeReady: boolean;
  readonly deployChargeReady: boolean;
} {
  return { uiChargeReady: charge > 32, deployChargeReady: charge >= 32 };
}

export function updateLegacyInspireCounters(
  state: LegacyInspireState,
  nativeCounter: number,
  recharge: number,
): LegacyInspireState {
  return {
    charge: (nativeCounter & 31) === 0 ? Math.min(255, state.charge + recharge) : state.charge,
    timer: (nativeCounter & 15) === 0 && state.timer !== 0 ? state.timer - 1 : state.timer,
    casterSlot: state.casterSlot,
  };
}

export function* legacyInspireScanCoordinates(
  xQ8: number,
  yQ8: number,
): Generator<readonly [number, number]> {
  const tileX = xQ8 >> 8;
  const tileY = yQ8 >> 8;
  for (let ring = 0; ring <= 10; ring++) {
    for (let transverse = -20; transverse <= 20; transverse++) {
      yield [tileX - ring, tileY + transverse];
      yield [tileX + ring, tileY + transverse];
      yield [tileX + transverse, tileY - ring];
      yield [tileX + transverse, tileY + ring];
    }
  }
}

export function scanLegacyInspireEffect(input: LegacyInspireScanInput): LegacyInspireScanResult {
  if (!Number.isInteger(input.visitBudget) || input.visitBudget <= 0) {
    throw new RangeError("Inspire scan requires a positive native visit budget");
  }
  if (input.randomTable.length !== 256) throw new RangeError("Inspire requires a 256-entry native RNG table");
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height)
    || input.width <= 0 || input.height <= 0
    || input.ground.length !== input.width * input.height || input.air.length !== input.width * input.height) {
    throw new RangeError("Inspire requires complete native occupancy planes");
  }
  const writes: LegacyInspireWrite[] = [];
  let randomIndex = input.randomIndex & 255;
  let remainingBudget = input.visitBudget;
  let coordinateVisits = 0;
  scan: for (const [tileX, tileY] of legacyInspireScanCoordinates(input.xQ8, input.yQ8)) {
    coordinateVisits++;
    if (tileX < 0 || tileY < 0 || tileX >= input.width || tileY >= input.height) continue;
    const cell = tileY * input.width + tileX;
    for (const plane of [input.ground, input.air]) {
      const targetSlot = plane[cell] & 0x3ff;
      if (targetSlot >= 1022) continue;
      const target = input.slots[targetSlot];
      if (!target) throw new RangeError(`missing occupied Inspire slot ${targetSlot}`);
      if (target.team !== input.casterTeam || target.multiplierQ8 !== 0 || target.primaryWeapon === -1) continue;
      randomIndex = (randomIndex + 1) & 255;
      writes.push({ targetSlot, timer: 20 + (input.randomTable[randomIndex] & 15), casterSlot: input.casterSlot & 0xffff });
      if (--remainingBudget === 0) break scan;
    }
  }
  return { casterCharge: 0, writes, randomIndex, remainingBudget, coordinateVisits };
}

export function applyLegacyInspireWrite(
  state: LegacyInspireState,
  write: LegacyInspireWrite,
): LegacyInspireState {
  return { charge: state.charge, timer: write.timer, casterSlot: write.casterSlot };
}

export function resolveLegacyInspireMultiplierQ8(
  state: Pick<LegacyInspireState, "timer" | "casterSlot">,
  currentSlots: Readonly<Record<number, LegacyInspireSlot>>,
): number {
  if (state.timer === 0) return 256;
  const caster = currentSlots[state.casterSlot];
  if (!caster) throw new RangeError(`unresolved Inspire caster slot ${state.casterSlot}`);
  return caster.multiplierQ8;
}

export function legacyInspireCentersAim(timer: number): boolean {
  return timer !== 0;
}

export function applyLegacyInspireDamageQ8(
  baseDamage: number,
  matchupQ8: number,
  inspireQ8: number,
  armorQ8: number,
): number {
  const matched = Math.imul(baseDamage, matchupQ8) >> 8;
  const inspired = Math.imul(matched, inspireQ8) >> 8;
  return Math.imul(inspired, armorQ8) >> 8;
}
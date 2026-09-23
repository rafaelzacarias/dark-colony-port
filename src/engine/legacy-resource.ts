export interface LegacyResourceScales {
  rateScale: number;
  reserveScale: number;
}

export interface LegacyResourceAnimationProfile {
  readonly id: string;
  readonly directions: readonly (readonly number[])[];
}

export interface LegacyResourceAnimation {
  profile: string;
  frame: number;
  delay: number;
  mode: 0 | 1 | 2 | 3;
}

export function resetLegacyResourceAnimation(current: LegacyResourceAnimation,
  profile: string, mode: LegacyResourceAnimation["mode"]): LegacyResourceAnimation {
  return current.profile === profile && current.mode === mode ? { ...current } : { profile, frame: 0, delay: 0, mode };
}

export function advanceLegacyResourceAnimation(current: LegacyResourceAnimation,
  profile: LegacyResourceAnimationProfile, direction: number): LegacyResourceAnimation {
  integer(direction, 0, 255, "direction");
  integer(current.frame, 0, 255, "animation.frame");
  integer(current.delay, 0, 255, "animation.delay");
  integer(current.mode, 0, 3, "animation.mode");
  if (profile.id !== current.profile) throw new RangeError("Animation profile identity mismatch");
  const delays = profile.directions[(((direction + 8) & 255) >>> 4) * 2];
  if (!delays?.length || delays.length > 255 || delays.some((delay) => !Number.isInteger(delay) || delay < 0 || delay > 255)) {
    throw new RangeError("Missing native direction timeline/delay bytes");
  }
  const next = { ...current };
  if (next.mode === 2) return next;
  const advanced = next.delay === 0;
  if (advanced) next.frame = (next.frame + 1) & 255;
  if (next.frame >= delays.length) {
    next.frame = 0;
    if (next.mode === 1) return { ...next, mode: 2 };
    if (next.mode === 3) return { ...next, frame: delays.length - 1 };
    next.delay = delays[0];
  } else if (advanced) next.delay = delays[next.frame];
  next.delay = (next.delay - 1) & 255;
  return next;
}

export interface LegacyResourceSource {
  slot: number;
  xQ8: number;
  yQ8: number;
  typeId: 40;
  owner: 8;
  status: 1;
  rateWord: number;
  reserve: number;
  countdownWord: number;
}

function integer(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer in ${minimum}..${maximum}`);
  }
  return value;
}

function signed32(value: number, name: string): number {
  return integer(value, -2147483648, 2147483647, name);
}

function word(value: number, name: string): number {
  return integer(value, 0, 65535, name);
}

function signedWord(value: number): number {
  return (value << 16) >> 16;
}

export function scaleLegacyResource(value: number, scale: number): number {
  return Math.trunc(Math.imul(signed32(value, "value"), signed32(scale, "scale")) / 256) | 0;
}

export function initializeLegacyResource(input: {
  slot: number;
  tileX: number;
  tileY: number;
  sourceRate: number;
  sourceReserve: number;
  scales: LegacyResourceScales;
  typeReserve: number;
}): LegacyResourceSource {
  const slot = integer(input.slot, 0, 799, "slot");
  const tileX = integer(input.tileX, 0, 255, "tileX");
  const tileY = integer(input.tileY, 0, 255, "tileY");
  if (input.sourceRate === -1) {
    throw new RangeError("SCN fourth field -1 takes the native non-entity branch at 0x41c4f7");
  }
  const typeReserve = signed32(input.typeReserve, "typeReserve");
  const reserve = scaleLegacyResource(input.sourceReserve, input.scales.reserveScale);
  return {
    slot, xQ8: tileX * 256 + 128, yQ8: tileY * 256 + 128,
    typeId: 40, owner: 8, status: 1,
    rateWord: scaleLegacyResource(input.sourceRate, input.scales.rateScale) & 65535,
    reserve: reserve < 0 ? typeReserve : reserve,
    countdownWord: 65535,
  };
}

export function changeLegacyResourceRate(oldRateWord: number, literalRate: number, rateScale: number): {
  rateWord: number;
  activationSound: boolean;
} {
  word(oldRateWord, "oldRateWord");
  integer(literalRate, 0, 255, "literalRate");
  return {
    rateWord: scaleLegacyResource(literalRate, rateScale) & 65535,
    activationSound: oldRateWord === 0 && literalRate !== 0,
  };
}

export interface LegacyResourceCountdown {
  countdownWord: number;
  transition: "dormant" | "reset" | "waiting" | "activate";
  extractorType: 47 | 48 | null;
  resetSourceAnimation: boolean;
  clearSourceDirection: boolean;
}

export function advanceLegacyResourceCountdown(input: {
  rateWord: number;
  countdownWord: number;
  sourceAnimationState: number;
  occupantType: number | null;
}): LegacyResourceCountdown {
  const rate = word(input.rateWord, "rateWord");
  const countdown = word(input.countdownWord, "countdownWord");
  integer(input.sourceAnimationState, 0, 255, "sourceAnimationState");
  if (input.occupantType !== null) integer(input.occupantType, 0, 255, "occupantType");
  const result: LegacyResourceCountdown = {
    countdownWord: countdown, transition: "waiting", extractorType: null,
    resetSourceAnimation: false, clearSourceDirection: false,
  };
  if (rate === 0) return { ...result, transition: "dormant", resetSourceAnimation: true };
  const eligible = input.occupantType === 6 || input.occupantType === 14;
  if (input.sourceAnimationState === 2 && (input.occupantType === null || eligible)) {
    return { ...result, countdownWord: 50, transition: "reset",
      resetSourceAnimation: true, clearSourceDirection: true };
  }
  if (!eligible) return { ...result, countdownWord: 50, transition: "reset" };
  if (countdown === 0) return result;
  const next = (countdown - 1) & 65535;
  if (signedWord(next) > 0) return { ...result, countdownWord: next };
  return { ...result, countdownWord: next, transition: "activate",
    extractorType: input.occupantType === 6 ? 47 : 48, resetSourceAnimation: true };
}

export interface LegacyResourcePartner {
  typeId: number;
  status: number;
  creditGate: number;
}

export interface LegacyResourceExtractionInput {
  reserve: number;
  rateWord: number;
  nativeCounter: number;
  aiField: number;
  aiMultiplier: number;
  creditGate: number;
  partner: LegacyResourcePartner | null;
}

export interface LegacyResourceExtraction {
  transition: "waiting" | "deplete" | "extract";
  reserve: number;
  extracted: number;
  ownerCreditDelta: number;
  ownerIncomeDelta: number;
  ownerCycleDelta: number;
  partnerCreditDelta: number;
  partnerIncomeDelta: number;
  clearPartner: boolean;
}

export function extractLegacyResource(input: LegacyResourceExtractionInput): LegacyResourceExtraction {
  const reserve = signed32(input.reserve, "reserve");
  const rate = signedWord(word(input.rateWord, "rateWord"));
  integer(input.nativeCounter, 0, 0xffffffff, "nativeCounter");
  signed32(input.aiField, "aiField");
  signed32(input.aiMultiplier, "aiMultiplier");
  signed32(input.creditGate, "creditGate");
  const result: LegacyResourceExtraction = {
    transition: "waiting", reserve, extracted: 0, ownerCreditDelta: 0, ownerIncomeDelta: 0,
    ownerCycleDelta: 0, partnerCreditDelta: 0, partnerIncomeDelta: 0, clearPartner: false,
  };
  if (((reserve - rate) | 0) <= 0) return { ...result, transition: "deplete" };
  if ((input.nativeCounter & 15) !== 0) return result;
  const extracted = input.aiField !== 0 ? scaleLegacyResource(rate, input.aiMultiplier) : rate;
  let share = extracted;
  let partnerCredit = 0;
  let clearPartner = false;
  if (input.partner !== null) {
    const partner = input.partner;
    integer(partner.typeId, 0, 255, "partner.typeId");
    integer(partner.status, 0, 255, "partner.status");
    signed32(partner.creditGate, "partner.creditGate");
    if (partner.status !== 0 && partner.status !== 10 && (partner.typeId === 77 || partner.typeId === 78)) {
      share = Math.trunc(extracted / 2) | 0;
      if (partner.creditGate !== 0) partnerCredit = share;
    } else if ([4, 12, 77, 78].includes(partner.typeId)) {
      clearPartner = true;
    } else {
      throw new RangeError("Native partner assertion at 0x413a9d: expected type 4, 12, 77 or 78");
    }
  }
  const ownerCredit = input.creditGate !== 0 ? share : 0;
  return {
    transition: "extract", reserve: (reserve - extracted) | 0, extracted,
    ownerCreditDelta: ownerCredit, ownerIncomeDelta: ownerCredit,
    ownerCycleDelta: input.creditGate !== 0 ? 1 : 0,
    partnerCreditDelta: partnerCredit, partnerIncomeDelta: partnerCredit, clearPartner,
  };
}
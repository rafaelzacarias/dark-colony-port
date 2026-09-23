export const LEGACY_NATIVE_SCHEDULER_EXE_SHA256 =
  "65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b";

export type LegacyNativeSchedulerSource = Readonly<{
  executableSha256: string;
  rngTable: readonly number[];
  selectors: readonly (readonly Readonly<{ weight: number; action: number }>[])[];
  selectorScale: Readonly<{ significand: number; exponent: number }>;
}>;

const authenticated = new WeakSet<LegacyNativeSchedulerSource>();
const authenticatedPlans = new WeakSet<LegacyNativeSchedulerPlan>();

export async function authenticateLegacyNativeSchedulerSource(executable: Uint8Array): Promise<LegacyNativeSchedulerSource> {
  const bytes = Uint8Array.from(executable);
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((value) => value.toString(16).padStart(2, "0")).join("");
  if (digest !== LEGACY_NATIVE_SCHEDULER_EXE_SHA256) throw new RangeError("Unrecognized scheduler executable");
  const view = new DataView(bytes.buffer);
  const header = view.getUint32(0x3c, true);
  const sections = header + 24 + view.getUint16(header + 20, true);
  const imageBase = view.getUint32(header + 52, true);
  const read = (address: number) => {
    const relative = address - imageBase;
    for (let index = 0; index < view.getUint16(header + 6, true); index++) {
      const section = sections + index * 40;
      const start = view.getUint32(section + 12, true);
      const size = view.getUint32(section + 16, true);
      if (relative >= start && relative + 4 <= start + size) {
        return view.getUint32(view.getUint32(section + 20, true) + relative - start, true);
      }
    }
    throw new RangeError("Scheduler table is outside executable sections");
  };
  const selectors = Array.from({ length: 4 }, (_, mode) => {
    const table = read(read(0x47936c + mode * 4));
    const rows: Readonly<{ weight: number; action: number }>[] = [];
    for (let index = 0; index < 32; index++) {
      const weight = read(table + index * 8);
      if (weight === 0) return Object.freeze(rows);
      rows.push(Object.freeze({ weight, action: read(table + index * 8 + 4) }));
    }
    throw new RangeError("Unterminated scheduler selector table");
  });
  const source = Object.freeze({ executableSha256: digest,
    rngTable: Object.freeze(Array.from({ length: 256 }, (_, index) => read(0x478e04 + index * 4))),
    selectors: Object.freeze(selectors),
    selectorScale: Object.freeze({ significand: (read(0x473810) & 0xfffff) * 0x100000000 + read(0x47380c) + 2 ** 52,
      exponent: ((read(0x473810) >>> 20) & 0x7ff) - 1023 - 52 }) });
  authenticated.add(source);
  return source;
}

function requireSource(source: LegacyNativeSchedulerSource): void {
  if (!authenticated.has(source)) throw new RangeError("Scheduler requires authenticated source identity");
}

function integer(value: number, minimum: number, maximum: number, name: string): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError(`Invalid scheduler ${name}`);
}

export type LegacyNativeSchedulerClock = Readonly<{
  counter: number;
  troCounter: number;
  resourceClock: number;
  period: number;
  transition: number;
  dayPhase: number;
  daylight: number;
}>;

export type LegacyNativeSchedulerPhaseKind =
  | "census" | "population-flags" | "platform-flags"
  | "visibility-clear" | "visibility-compute" | "visibility-dirty"
  | "clock" | "population-cap" | "relations" | "daylight" | "path-stamp"
  | "trigger-prelude" | "trigger-scan" | "commander-cleanup" | "income"
  | "team-maintenance" | "registered-actors" | "projectiles" | "frame-record"
  | "frame-report" | "ai-local-enter" | "ai" | "ai-local-exit" | "timing" | "timing-feedback";

export type LegacyNativeSchedulerPhase = Readonly<{
  sequence: number;
  kind: LegacyNativeSchedulerPhaseKind;
  address: number;
  end: number;
  clock: LegacyNativeSchedulerClock;
  inputBoundary: "current-phase-entry";
}>;

export type LegacyNativeSchedulerPlan = Readonly<{
  scope: "source-authenticated-dispatch-only";
  admitted: false;
  executableWholeGame: false;
  before: LegacyNativeSchedulerClock;
  after: LegacyNativeSchedulerClock;
  phases: readonly LegacyNativeSchedulerPhase[];
}>;

export function planLegacyNativeSchedulerCycle(
  source: LegacyNativeSchedulerSource, clock: LegacyNativeSchedulerClock,
): LegacyNativeSchedulerPlan {
  requireSource(source);
  integer(clock.counter, 0, 0xffffffff, "packet counter");
  integer(clock.troCounter, 0, 0x7ffffffe, "TRO counter");
  integer(clock.resourceClock, 0, 0x7ffffffe, "resource clock");
  integer(clock.period, 1, 0x7fffffff, "day period");
  integer(clock.transition, 1, 0x7fffffff, "day transition");
  integer(clock.dayPhase, 0, 1, "day phase");
  integer(clock.daylight, 0, 256, "daylight");
  const before = Object.freeze({ ...clock });
  let current = before;
  const phases: LegacyNativeSchedulerPhase[] = [];
  const add = (kind: LegacyNativeSchedulerPhaseKind, address: number, end: number) => {
    phases.push(Object.freeze({ sequence: phases.length, kind, address, end, clock: current,
      inputBoundary: "current-phase-entry" }));
  };
  const visibility = () => {
    add("visibility-clear", 0x4456f0, 0x4456f0);
    add("visibility-compute", 0x44a6d4, 0x44a6d4);
    add("visibility-dirty", 0x439f40, 0x439f4f);
  };
  add("census", 0x419702, 0x4197b4);
  add("population-flags", 0x4197b4, 0x41981c);
  add("platform-flags", 0x41981c, 0x419880);
  if (current.troCounter === 0) visibility();
  add("clock", 0x41989e, 0x4198c3);
  current = Object.freeze({ ...current, troCounter: current.troCounter + 1, resourceClock: current.resourceClock + 1 });
  add("population-cap", 0x4198c3, 0x4198ce);
  add("relations", 0x4198ce, 0x419990);
  add("daylight", 0x419990, 0x419a28);
  let resourceClock = current.resourceClock, dayPhase = current.dayPhase, daylight = current.daylight;
  if (resourceClock > current.period) {
    resourceClock = 0;
    dayPhase = 1 - dayPhase;
  }
  if (resourceClock <= current.transition) {
    if (resourceClock > 0x7fffff) throw new RangeError("Unsupported overflowing native daylight shift");
    const ratio = Math.trunc((resourceClock << 8) / current.transition);
    daylight = dayPhase === 0 ? 256 - ratio : ratio;
  }
  current = Object.freeze({ ...current, resourceClock, dayPhase, daylight });
  add("path-stamp", 0x44461c, 0x444628);
  if ((clock.counter & 15) === 0) visibility();
  if ((clock.counter & 7) === 0) {
    add("trigger-prelude", 0x419a5b, 0x419aa8);
    add("trigger-scan", 0x43e4d0, 0x43e4d0);
    add("commander-cleanup", 0x419aaf, 0x419b2e);
  }
  if ((clock.counter & 15) === 0) add("income", 0x419b3a, 0x419b7e);
  add("team-maintenance", 0x419b7e, 0x419bb8);
  add("registered-actors", 0x419bb8, 0x419c0e);
  add("projectiles", 0x44293c, 0x44293c);
  add("frame-record", 0x44ac28, 0x44ac28);
  add("frame-report", 0x419c2e, 0x419cbc);
  add("ai-local-enter", 0x419cbc, 0x419cc6);
  add("ai", 0x41ac2c, 0x41aca7);
  add("ai-local-exit", 0x419cce, 0x419cd5);
  add("timing", 0x419cd5, 0x419d3a);
  if ((clock.counter & 31) === 0) add("timing-feedback", 0x419580, 0x4196f4);
  const plan = Object.freeze({ scope: "source-authenticated-dispatch-only" as const, admitted: false as const, executableWholeGame: false as const,
    before, after: current, phases: Object.freeze(phases) });
  authenticatedPlans.add(plan);
  return plan;
}

export function beginLegacyNativeSchedulerClockPacket(
  source: LegacyNativeSchedulerSource, clock: LegacyNativeSchedulerClock,
): LegacyNativeSchedulerPlan {
  integer(clock.counter, 0, 0xffffffff, "packet counter before increment");
  return planLegacyNativeSchedulerCycle(source, { ...clock, counter: (clock.counter + 1) >>> 0 });
}

export type LegacyNativeSchedulerCoverage = Readonly<{
  consumers: Readonly<Partial<Record<LegacyNativeSchedulerPhaseKind, string>>>;
  registeredTypes: readonly number[];
  aiModes: readonly number[];
  synchronousReceipts: readonly ("actor" | "unit-production" | "city-production")[];
}>;

export function requireLegacyNativeSchedulerCoverage(plan: LegacyNativeSchedulerPlan, coverage: LegacyNativeSchedulerCoverage): void {
  if (!authenticatedPlans.has(plan)) throw new RangeError("Scheduler requires an authenticated phase plan");
  for (const phase of plan.phases) {
    if (!coverage.consumers[phase.kind]?.trim()) throw new RangeError(`Missing scheduler consumer: ${phase.kind}`);
  }
  for (const receipt of ["actor", "unit-production", "city-production"] as const) {
    if (!coverage.synchronousReceipts.includes(receipt)) throw new RangeError(`Missing synchronous ${receipt} consumer`);
  }
}

export function nextLegacyNativeRegisteredVisit(
  source: LegacyNativeSchedulerSource,
  input: Readonly<{ index: number; highWater: number; registry: readonly number[]; types: readonly number[] }>,
  coverage: LegacyNativeSchedulerCoverage,
) {
  requireSource(source);
  integer(input.index, 0, 800, "registry index");
  integer(input.highWater, 0, 799, "registry high water");
  if (input.registry.length !== 800 || input.types.length !== 800) throw new RangeError("Complete current registry/types required");
  if (input.index > input.highWater) return { kind: "complete" as const, nextIndex: input.index };
  const slot = input.registry[input.index];
  integer(slot, -1, 799, "registered slot");
  if (slot === -1) return { kind: "empty-slot" as const, slot: input.index, clearByteOffset: 0x12,
    task6Budget: 0, nextIndex: input.index + 1 };
  const type = input.types[slot];
  integer(type, 0, 105, "registered type");
  if (!coverage.registeredTypes.includes(type)) throw new RangeError(`Unsupported registered type ${type} at slot ${slot}`);
  return { kind: "actor" as const, address: 0x419248, slot, type, task6Budget: 0,
    nextIndex: input.index + 1, citySourceSlot: slot < 120 ? { team: Math.trunc(slot / 15), index: slot % 15 } : null };
}

export function advanceLegacyNativeAiSchedule(
  source: LegacyNativeSchedulerSource,
  input: Readonly<{ counter: number; nextTeam: number; modes: readonly number[] }>,
  coverage: LegacyNativeSchedulerCoverage,
) {
  requireSource(source);
  integer(input.counter, 0, 0xffffffff, "AI counter");
  integer(input.nextTeam, 0, 7, "AI next team");
  if (input.modes.length !== 8) throw new RangeError("Complete current AI modes required");
  input.modes.forEach((mode) => integer(mode, 0, 4, "AI mode"));
  const nextTeam = (input.counter & 3) !== 0 || input.counter === 4 ? input.nextTeam : (input.nextTeam + 1) % 8;
  const candidates = (input.counter & 3) !== 0 ? [] : input.counter === 4 ? [0, 1, 2, 3, 4, 5, 6, 7] : [nextTeam];
  const selectors = candidates.filter((team) => input.modes[team] !== 0).map((team) => {
    const mode = input.modes[team];
    if (!coverage.aiModes.includes(mode)) throw new RangeError(`Unsupported AI mode ${mode} for team ${team}`);
    return { address: 0x41ab20, team, mode, callbacks: source.selectors[mode - 1] };
  });
  return { nextTeam, selectors };
}

export function selectLegacyNativePolicy(
  source: LegacyNativeSchedulerSource, input: Readonly<{ mode: number; weights: readonly number[]; rngCursor: number }>,
) {
  requireSource(source);
  integer(input.mode, 1, 4, "selector mode");
  if (input.mode !== 3 && input.mode !== 4) throw new RangeError("Unowned mode-1/2 policy-weight callback effects");
  integer(input.rngCursor, 0, 255, "RNG cursor");
  const callbacks = source.selectors[input.mode - 1];
  if (input.weights.length !== callbacks.length) throw new RangeError("Every original policy weight is required");
  if (input.weights.some((weight) => weight !== (input.mode === 3 ? 1 : 0))) {
    throw new RangeError("Policy weights do not match original constant mode-3/4 callbacks");
  }
  let sum = 0, selected = -1, rngCursor = input.rngCursor;
  const draws: { index: number; cursor: number; value: number; weight: number; cumulative: number }[] = [];
  input.weights.forEach((weight, index) => {
    integer(weight, 0, 0x7fffffff - sum, "policy weight");
    sum += weight;
    rngCursor = (rngCursor + 1) & 255;
    const value = source.rngTable[rngCursor];
    let product = BigInt(value) * BigInt(sum) * BigInt(source.selectorScale.significand);
    let exponent = source.selectorScale.exponent;
    const shift = product.toString(2).length - 64;
    if (shift > 0) {
      const remainder = product & ((1n << BigInt(shift)) - 1n);
      product >>= BigInt(shift);
      const half = 1n << BigInt(shift - 1);
      if (remainder > half || remainder === half && (product & 1n) !== 0n) product++;
      exponent += shift;
    }
    const greater = exponent < 0 ? (BigInt(weight) << BigInt(-exponent)) > product
      : BigInt(weight) > (product << BigInt(exponent));
    if (greater) selected = index;
    draws.push({ index, cursor: rngCursor, value, weight, cumulative: sum });
  });
  return { rngCursor, selected, action: selected < 0 ? null : callbacks[selected].action, draws };
}

export type LegacyNativeSchedulerCursor = Readonly<{
  nextPhase: number;
  rngCursor: number;
  crtSeed: number;
}>;

export function advanceLegacyNativeSchedulerPhase(
  plan: LegacyNativeSchedulerPlan, cursor: LegacyNativeSchedulerCursor,
  receipt: Readonly<{ sequence: number; kind: LegacyNativeSchedulerPhaseKind; consumer: string;
    rngBefore: number; rngAfter: number; crtBefore: number; crtAfter: number; complete: boolean;
    clockBefore: LegacyNativeSchedulerClock; clockAfter: LegacyNativeSchedulerClock }>,
  coverage: LegacyNativeSchedulerCoverage,
): LegacyNativeSchedulerCursor {
  requireLegacyNativeSchedulerCoverage(plan, coverage);
  integer(cursor.nextPhase, 0, plan.phases.length - 1, "phase cursor");
  integer(cursor.rngCursor, 0, 255, "phase RNG cursor");
  integer(cursor.crtSeed, 0, 0xffffffff, "phase CRT cursor");
  integer(receipt.rngAfter, 0, 255, "phase RNG result");
  integer(receipt.crtAfter, 0, 0xffffffff, "phase CRT result");
  const phase = plan.phases[cursor.nextPhase];
  const nextClock = plan.phases[cursor.nextPhase + 1]?.clock ?? plan.after;
  const matchingClock = (actual: LegacyNativeSchedulerClock, expected: LegacyNativeSchedulerClock) =>
    (Object.keys(expected) as (keyof LegacyNativeSchedulerClock)[]).every((key) => actual[key] === expected[key]);
  if (receipt.sequence !== phase.sequence || receipt.kind !== phase.kind || !receipt.complete
    || receipt.consumer !== coverage.consumers[phase.kind]
    || receipt.rngBefore !== cursor.rngCursor || receipt.crtBefore !== cursor.crtSeed
    || !matchingClock(receipt.clockBefore, phase.clock) || !matchingClock(receipt.clockAfter, nextClock)) {
    throw new RangeError("Incomplete, reordered, or stale scheduler phase receipt");
  }
  return Object.freeze({ nextPhase: cursor.nextPhase + 1, rngCursor: receipt.rngAfter, crtSeed: receipt.crtAfter });
}

export function legacyNativeSchedulerConsumerInputs(
  plan: LegacyNativeSchedulerPlan, cursor: LegacyNativeSchedulerCursor,
  input: Readonly<{ localTeam: number; cancellationGate: number; visibilityMask: number }>,
) {
  if (!authenticatedPlans.has(plan)) throw new RangeError("Scheduler requires an authenticated phase plan");
  integer(cursor.nextPhase, 0, plan.phases.length - 1, "consumer phase");
  integer(cursor.rngCursor, 0, 255, "consumer RNG cursor");
  integer(cursor.crtSeed, 0, 0xffffffff, "consumer CRT cursor");
  integer(input.localTeam, 0, 7, "local team");
  integer(input.cancellationGate, 0, 1, "resource cancellation gate");
  integer(input.visibilityMask, 0, 0xffffffff, "current visibility mask");
  const phase = plan.phases[cursor.nextPhase];
  return {
    phase: phase.kind, packetCounter: phase.clock.counter, troCounter: phase.clock.troCounter,
    resourceClock: phase.clock.resourceClock, rngCursor: cursor.rngCursor, crtSeed: cursor.crtSeed,
    actorFrame: phase.kind === "registered-actors" ? { counter: phase.clock.resourceClock, task6Budget: 0,
      rngCursor: cursor.rngCursor, counterAddress: 0x530 } : null,
    resourceFrame: phase.kind === "registered-actors" ? { nativePhaseCounter: phase.clock.resourceClock,
      localTeam: input.localTeam, cancellationGate: input.cancellationGate } : null,
    cityVisit: phase.kind === "registered-actors" ? { counter: phase.clock.counter, counterAddress: 0x94c } : null,
    visibilityFrame: phase.kind === "visibility-clear" || phase.kind === "visibility-compute"
      ? { counter: phase.clock.counter, daylight: phase.clock.daylight, localTeam: input.localTeam,
        localMask: input.visibilityMask } : null,
    aiFrame: phase.kind === "ai" ? { counter: phase.clock.counter, transport: "synchronous" as const } : null,
  };
}

export type LegacyNativeSchedulerTiming = Readonly<{
  ringIndex: number;
  durations: readonly number[];
  timestamps: readonly number[];
  periods: readonly number[];
}>;

function validateTiming(timing: LegacyNativeSchedulerTiming): void {
  integer(timing.ringIndex, 0, 63, "timing ring index");
  for (const values of [timing.durations, timing.timestamps, timing.periods]) {
    if (values.length !== 64) throw new RangeError("Complete native 64-slot timing rings required");
    values.forEach((value) => integer(value, 0, 0xffffffff, "timing sample"));
  }
}

export function recordLegacyNativeSchedulerTiming(
  source: LegacyNativeSchedulerSource, timing: LegacyNativeSchedulerTiming,
  input: Readonly<{ startTick: number; endTick: number; framePeriod: number }>,
): LegacyNativeSchedulerTiming {
  requireSource(source);
  validateTiming(timing);
  Object.values(input).forEach((value) => integer(value, 0, 0xffffffff, "external timing input"));
  const durations = [...timing.durations], timestamps = [...timing.timestamps], periods = [...timing.periods];
  durations[timing.ringIndex] = (input.endTick - input.startTick) >>> 0;
  timestamps[timing.ringIndex] = input.startTick;
  periods[timing.ringIndex] = input.framePeriod;
  return Object.freeze({ ringIndex: (timing.ringIndex + 1) % 64,
    durations: Object.freeze(durations), timestamps: Object.freeze(timestamps), periods: Object.freeze(periods) });
}

export function computeLegacyNativeSchedulerTimingFeedback(
  source: LegacyNativeSchedulerSource, timing: LegacyNativeSchedulerTiming,
  input: Readonly<{ tick: number; teamLatencies: readonly number[]; requestedLatency: number }>,
) {
  requireSource(source);
  validateTiming(timing);
  integer(input.tick, 0, 0xffffffff, "feedback tick");
  integer(input.requestedLatency, 0, 0xffffffff, "requested latency");
  if (input.teamLatencies.length !== 8) throw new RangeError("Complete team timing observations required");
  input.teamLatencies.forEach((value) => integer(value, 0, 0xffffffff, "team latency"));
  const sum = (values: readonly number[]) => values.reduce((total, value) => (total + value) >>> 0, 0);
  const averagePeriod = sum(timing.periods) >>> 6;
  if (averagePeriod === 0) throw new RangeError("Native timing feedback would divide by zero");
  const elapsed = (input.tick - timing.timestamps[timing.ringIndex]) >>> 0;
  const workload = elapsed === 0 ? 0 : Math.trunc((Math.imul(sum(timing.durations), 10000) >>> 0) / elapsed);
  const quotient = Math.trunc((Math.imul(workload, averagePeriod) >>> 0) / 3500);
  const period = Math.max(33, Math.min(660, quotient));
  const maximum = Math.max(...input.teamLatencies);
  const populationCeiling = maximum > 250 ? 40 : maximum > 200 ? 50 : maximum > 150 ? 60
    : maximum > 100 ? 75 : maximum > 66 ? 100 : 150;
  return { period, populationCeiling, latency: Math.max(input.requestedLatency, maximum),
    elapsed, averagePeriod, workload, packetOwners: [0x421394, 0x42125c] as const };
}

export function advanceLegacyNativeSchedulerFlags(
  source: LegacyNativeSchedulerSource,
  input: Readonly<{ pathStamp: number; visibilityDirty: number; phase: "path-stamp" | "visibility-dirty" }>,
) {
  requireSource(source);
  integer(input.pathStamp, 0, 0xffffffff, "path stamp");
  integer(input.visibilityDirty, 0, 1, "visibility dirty flag");
  if (input.phase !== "path-stamp" && input.phase !== "visibility-dirty") throw new RangeError("Unsupported scheduler flag phase");
  return { pathStamp: input.phase === "path-stamp" ? (input.pathStamp + 2) >>> 0 : input.pathStamp,
    visibilityDirty: input.phase === "visibility-dirty" ? 1 : input.visibilityDirty };
}
export interface SourceDayNight {
  readonly phase: 0 | 1;
  readonly cycleLength: number;
  readonly elapsed: number;
  readonly transitionTicks: number;
  readonly blend: number;
}

export function sourceDayNightFromHeader(header: readonly string[]): SourceDayNight {
  const [phase, cycleLength, elapsed, transitionTicks] = header.slice(1, 5).map(Number);
  if ((phase !== 0 && phase !== 1) || !Number.isInteger(cycleLength) || cycleLength <= 0 ||
    !Number.isInteger(elapsed) || elapsed < 0 || !Number.isInteger(transitionTicks) ||
    transitionTicks <= 0 || transitionTicks > cycleLength) throw new RangeError("Invalid source day/night header");
  return { phase, cycleLength, elapsed, transitionTicks, blend: phase * 256 };
}

export function advanceSourceDayNight(state: SourceDayNight): SourceDayNight {
  let elapsed = state.elapsed + 1;
  let phase = state.phase;
  let blend = state.blend;
  if (elapsed > state.cycleLength) { elapsed = 0; phase = phase === 0 ? 1 : 0; }
  if (elapsed <= state.transitionTicks) {
    const fraction = Math.trunc(elapsed * 256 / state.transitionTicks);
    blend = phase === 0 ? 256 - fraction : fraction;
  }
  return { ...state, phase, elapsed, blend };
}
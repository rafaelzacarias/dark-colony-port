export interface FrameStatistics {
  readonly fps: number;
  readonly averageFps: number;
  readonly lowFps: number;
  readonly frameMilliseconds: number;
  readonly samples: number;
}

const WINDOW_MS = 5000;
const UPDATE_MS = 250;
const CAPACITY = 2048;

export function createFrameStatistics() {
  const times = new Float64Array(CAPACITY), durations = new Float64Array(CAPACITY);
  let start = 0, count = 0, previous: number | undefined, published: number | undefined;
  function reset(): void {
    start = count = 0;
    previous = published = undefined;
  }
  return {
    reset,
    sample(now: number): FrameStatistics | null {
      if (!Number.isFinite(now) || now < 0 || previous !== undefined && now <= previous) {
        throw new RangeError("Frame timestamps must be finite, nonnegative, and increasing");
      }
      if (previous === undefined) { previous = published = now; return null; }
      const duration = now - previous;
      previous = now;
      while (count && (now - times[start] > WINDOW_MS || count === CAPACITY)) {
        start = (start + 1) % CAPACITY; count--;
      }
      const next = (start + count++) % CAPACITY;
      times[next] = now; durations[next] = duration;
      if (now - published! < UPDATE_MS) return null;
      published = now;
      const samples: number[] = [];
      let total = 0, recentTotal = 0, recentCount = 0;
      for (let index = 0; index < count; index++) {
        const slot = (start + index) % CAPACITY, duration = durations[slot];
        total += duration; samples.push(duration);
        if (now - times[slot] < 1000) { recentTotal += duration; recentCount++; }
      }
      samples.sort((a, b) => b - a);
      const slowCount = Math.max(1, Math.ceil(count * 0.01));
      const slowTotal = samples.slice(0, slowCount).reduce((sum, value) => sum + value, 0);
      return { fps: 1000 * recentCount / recentTotal, averageFps: 1000 * count / total,
        lowFps: 1000 * slowCount / slowTotal, frameMilliseconds: recentTotal / recentCount, samples: count };
    },
  };
}

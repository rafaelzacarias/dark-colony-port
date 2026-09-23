const DEFAULT_NONZERO_SEED = 0x6d2b_79f5;

export class DeterministicRandom {
  #state: number;

  constructor(seed: number) {
    const normalized = seed >>> 0;
    this.#state = normalized === 0 ? DEFAULT_NONZERO_SEED : normalized;
  }

  get state(): number {
    return this.#state;
  }

  nextUint32(): number {
    let value = this.#state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.#state = value >>> 0;
    return this.#state;
  }

  nextInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 0x1_0000_0000) {
      throw new RangeError(`maxExclusive must be an integer in [1, 2^32]; received ${maxExclusive}`);
    }
    const range = 0x1_0000_0000;
    const limit = Math.floor(range / maxExclusive) * maxExclusive;
    let value: number;
    do value = this.nextUint32();
    while (value >= limit);
    return value % maxExclusive;
  }
}

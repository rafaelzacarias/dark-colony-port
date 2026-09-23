export interface FixedStepResult {
  readonly steps: number;
  readonly droppedSteps: number;
  readonly interpolation: number;
}

export class FixedStepClock {
  readonly stepMilliseconds: number;
  readonly maximumStepsPerFrame: number;
  #accumulator = 0;

  constructor(stepMilliseconds: number, maximumStepsPerFrame = 8) {
    if (!Number.isFinite(stepMilliseconds) || stepMilliseconds <= 0) {
      throw new RangeError("stepMilliseconds must be positive");
    }
    if (!Number.isInteger(maximumStepsPerFrame) || maximumStepsPerFrame <= 0) {
      throw new RangeError("maximumStepsPerFrame must be a positive integer");
    }
    this.stepMilliseconds = stepMilliseconds;
    this.maximumStepsPerFrame = maximumStepsPerFrame;
  }

  consume(elapsedMilliseconds: number, step: () => void): FixedStepResult {
    if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds < 0) {
      throw new RangeError("elapsedMilliseconds must be finite and non-negative");
    }
    this.#accumulator += elapsedMilliseconds;
    let steps = 0;
    while (this.#accumulator >= this.stepMilliseconds && steps < this.maximumStepsPerFrame) {
      step();
      this.#accumulator -= this.stepMilliseconds;
      steps += 1;
    }
    const droppedSteps = Math.floor(this.#accumulator / this.stepMilliseconds);
    if (droppedSteps > 0) this.#accumulator -= droppedSteps * this.stepMilliseconds;
    return {
      steps,
      droppedSteps,
      interpolation: this.#accumulator / this.stepMilliseconds,
    };
  }

  reset(): void {
    this.#accumulator = 0;
  }
}

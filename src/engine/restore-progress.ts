export interface RestoreProgress {
  readonly phase: "replay";
  readonly done: number;
  readonly total: number;
}

/** Drives a restore to completion synchronously, exactly as before progress reporting existed. */
export function runRestoreSteps<Result>(steps: Generator<RestoreProgress, Result>): Result {
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/**
 * Drives a restore while yielding to the event loop every `budgetMilliseconds`, so a progress bar can repaint.
 * Returns undefined when `isCurrent` reports that the caller abandoned this load.
 */
export async function runRestoreStepsAsync<Result>(steps: Generator<RestoreProgress, Result>,
  onProgress: (progress: RestoreProgress) => void, isCurrent: () => boolean = () => true,
  budgetMilliseconds = 30): Promise<Result | undefined> {
  let sliceStart = performance.now();
  let step = steps.next();
  while (!step.done) {
    if (performance.now() - sliceStart >= budgetMilliseconds) {
      onProgress(step.value);
      await new Promise(resolve => setTimeout(resolve, 0));
      if (!isCurrent()) { steps.return(undefined as never); return undefined; }
      sliceStart = performance.now();
    }
    step = steps.next();
  }
  return step.value;
}

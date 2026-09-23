export function createAtlasCache<Value>(
  load: (name: string) => Promise<Value>,
  limits = { retained: 64, concurrent: 4, pending: 128 },
) {
  if (Object.values(limits).some((value) => !Number.isInteger(value) || value < 1)) {
    throw new RangeError("Atlas cache limits must be positive integers");
  }
  const cached = new Map<string, Value>();
  const pending = new Map<string, Promise<Value>>();
  const queue: (() => void)[] = [];
  let active = 0;
  const pump = (): void => {
    while (active < limits.concurrent && queue.length) queue.shift()!();
  };
  return {
    load(name: string): Promise<Value> {
      const key = name.toUpperCase();
      if (!/^[A-Z0-9_-]+$/.test(key)) return Promise.reject(new Error(`Invalid atlas name: ${name}`));
      if (cached.has(key)) {
        const value = cached.get(key)!;
        cached.delete(key);
        cached.set(key, value);
        return Promise.resolve(value);
      }
      const existing = pending.get(key);
      if (existing) return existing;
      if (pending.size >= limits.pending) return Promise.reject(new Error("Atlas pending limit exceeded"));
      const promise = new Promise<Value>((resolve, reject) => {
        queue.push(() => {
          active += 1;
          const finish = (): void => {
            pending.delete(key);
            active -= 1;
            pump();
          };
          void Promise.resolve().then(() => load(key)).then((value) => {
            cached.set(key, value);
            while (cached.size > limits.retained) cached.delete(cached.keys().next().value!);
            finish();
            resolve(value);
          }, (error: unknown) => {
            finish();
            reject(error);
          });
        });
      });
      pending.set(key, promise);
      pump();
      return promise;
    },
    get size(): number { return cached.size; },
    get pending(): number { return pending.size; },
  };
}
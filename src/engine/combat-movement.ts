import { guardCommands, type GuardObserver } from "./guard-ai";
import type { GridPoint } from "./grid";
import type { CombatEvent, SimulationCommand, SimulationSnapshot } from "./simulation";

interface MovementIntent {
  readonly target: GridPoint;
  readonly engage: boolean;
  interrupted: boolean;
  pending: boolean;
}

export interface CombatMovementCheckpoint {
  readonly version: 1;
  readonly intents: readonly { readonly id: number; readonly intent: MovementIntent }[];
  readonly pendingManual: readonly number[];
}

export class CombatMovementOrders {
  readonly #intents = new Map<number, MovementIntent>();
  readonly #pendingManual = new Set<number>();

  checkpoint(): CombatMovementCheckpoint {
    return structuredClone({ version: 1, intents: [...this.#intents].map(([id, intent]) => ({ id, intent })),
      pendingManual: [...this.#pendingManual] });
  }

  static restore(value: unknown): CombatMovementOrders {
    const require = (valid: boolean): void => { if (!valid) throw new RangeError("Invalid combat movement checkpoint"); };
    const record = (input: unknown, keys: string[]): Record<string, unknown> => {
      require(input !== null && typeof input === "object" && Object.getPrototypeOf(input) === Object.prototype);
      const descriptors = Object.getOwnPropertyDescriptors(input);
      require(Reflect.ownKeys(input as object).length === keys.length && keys.every((key) =>
        !!descriptors[key] && "value" in descriptors[key] && descriptors[key].enumerable === true));
      return input as Record<string, unknown>;
    };
    const array = (input: unknown): unknown[] => {
      require(Array.isArray(input) && Object.getPrototypeOf(input) === Array.prototype);
      const entries = input as unknown[];
      require(Reflect.ownKeys(entries).length === entries.length + 1);
      for (let index = 0; index < entries.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(entries, index);
        require(!!descriptor && "value" in descriptor && descriptor.enumerable === true);
      }
      return entries;
    };
    const integer = (input: unknown, minimum: number): number => {
      require(typeof input === "number" && Number.isSafeInteger(input) && input >= minimum);
      return input as number;
    };
    const boolean = (input: unknown): boolean => { require(typeof input === "boolean"); return input as boolean; };
    const saved = record(value, ["version", "intents", "pendingManual"]);
    require(saved.version === 1);
    const result = new CombatMovementOrders();
    for (const entry of array(saved.intents)) {
      const binding = record(entry, ["id", "intent"]);
      const id = integer(binding.id, 1);
      require(!result.#intents.has(id));
      const intent = record(binding.intent, ["target", "engage", "interrupted", "pending"]);
      const target = record(intent.target, ["x", "y"]);
      result.#intents.set(id, { target: { x: integer(target.x, 0), y: integer(target.y, 0) },
        engage: boolean(intent.engage), interrupted: boolean(intent.interrupted), pending: boolean(intent.pending) });
    }
    for (const entry of array(saved.pendingManual)) {
      const id = integer(entry, 1);
      require(!result.#pendingManual.has(id) && !result.#intents.has(id));
      result.#pendingManual.add(id);
    }
    return result;
  }

  move(unitIds: readonly number[], target: GridPoint, engage: boolean): void {
    for (const id of unitIds) {
      this.#pendingManual.delete(id);
      this.#intents.set(id, { target: { ...target }, engage, interrupted: false, pending: true });
    }
  }

  cancel(unitIds: readonly number[]): void {
    for (const id of unitIds) {
      this.#intents.delete(id);
      this.#pendingManual.add(id);
    }
  }

  interrupted(id: number): boolean { return this.#intents.get(id)?.interrupted ?? false; }

  update(snapshot: SimulationSnapshot, observers: readonly GuardObserver[], shots: readonly CombatEvent[]): readonly SimulationCommand[] {
    const units = new Map(snapshot.units.map((unit) => [unit.id, unit]));
    for (const id of this.#intents.keys()) {
      const unit = units.get(id);
      if (!unit || unit.activity === "die") this.#intents.delete(id);
      else {
        const intent = this.#intents.get(id)!;
        if (unit.activity === "idle" && !intent.interrupted && !intent.pending) this.#intents.delete(id);
      }
    }
    const eligibleObservers = observers.filter(({ id }) => {
      const intent = this.#intents.get(id);
      return !this.#pendingManual.has(id) && !(intent?.pending && !intent.engage);
    });
    const commands = [...guardCommands(snapshot, eligibleObservers.map((observer) => ({ ...observer,
      engageWhileMoving: this.#intents.get(observer.id)?.engage ?? observer.engageWhileMoving,
    })), shots)];
    const commanded = new Set<number>();
    for (const command of commands) {
      if (command.type !== "attack") continue;
      for (const id of command.unitIds) {
        commanded.add(id);
        const intent = this.#intents.get(id);
        if (intent && (units.get(id)?.activity === "move" || intent.pending)) intent.interrupted = true;
      }
    }
    const resume = new Map<string, { target: GridPoint; unitIds: number[] }>();
    for (const [id, intent] of [...this.#intents].sort(([left], [right]) => left - right)) {
      if (!intent.interrupted || units.get(id)?.activity !== "idle" || commanded.has(id)) continue;
      const key = `${intent.target.x},${intent.target.y}`;
      const group = resume.get(key) ?? { target: intent.target, unitIds: [] };
      group.unitIds.push(id);
      resume.set(key, group);
      intent.interrupted = false;
    }
    for (const { target, unitIds } of resume.values()) commands.push({ type: "move", unitIds, target });
    for (const intent of this.#intents.values()) intent.pending = false;
    this.#pendingManual.clear();
    return commands;
  }
}
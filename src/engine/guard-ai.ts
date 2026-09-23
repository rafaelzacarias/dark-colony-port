import { SUBCELLS_PER_CELL } from "./constants";
import { areHostile } from "./diplomacy";
import type { CombatEvent, SimulationCommand, SimulationSnapshot } from "./simulation";

export interface GuardObserver {
  readonly id: number;
  readonly dayRangeCells: number;
  readonly nightRangeCells: number;
  readonly engageWhileMoving?: boolean;
  readonly targetCanDamage?: (targetId: number) => boolean;
  readonly autonomousAttack?: boolean;
}

export class GuardAttackOrders {
  readonly #targets = new Map<number, number>();

  checkpoint(): readonly { id: number; targetId: number }[] {
    return [...this.#targets].sort(([left], [right]) => left - right).map(([id, targetId]) => ({ id, targetId }));
  }

  static restore(value: unknown): GuardAttackOrders {
    const result = new GuardAttackOrders();
    if (!Array.isArray(value)) throw new RangeError("Invalid guard attack checkpoint");
    for (const entry of value) {
      if (!entry || Object.getPrototypeOf(entry) !== Object.prototype || Object.keys(entry).length !== 2 ||
        !Number.isSafeInteger(entry.id) || entry.id < 1 || !Number.isSafeInteger(entry.targetId) || entry.targetId < 1 ||
        result.#targets.has(entry.id)) throw new RangeError("Invalid guard attack checkpoint");
      result.#targets.set(entry.id, entry.targetId);
    }
    return result;
  }

  cancel(unitIds: readonly number[]): void {
    for (const id of unitIds) this.#targets.delete(id);
  }

  observers(snapshot: SimulationSnapshot, observers: readonly GuardObserver[]): readonly GuardObserver[] {
    const units = new Map(snapshot.units.map(unit => [unit.id, unit]));
    for (const [id, targetId] of this.#targets) {
      const unit = units.get(id);
      if (!unit || unit.health <= 0 || unit.activity !== "attack" || unit.targetId !== targetId) this.#targets.delete(id);
    }
    return observers.map(observer => ({ ...observer,
      autonomousAttack: observer.autonomousAttack || this.#targets.has(observer.id) }));
  }

  record(commands: readonly SimulationCommand[]): void {
    for (const command of commands) {
      if (!("unitIds" in command)) continue;
      this.cancel(command.unitIds);
      if (command.type === "attack") for (const id of command.unitIds) this.#targets.set(id, command.targetId);
    }
  }
}

export function guardCommands(
  snapshot: SimulationSnapshot,
  observers: readonly GuardObserver[],
  shots: readonly CombatEvent[] = [],
): readonly SimulationCommand[] {
  const commands: SimulationCommand[] = [];
  const units = new Map(snapshot.units.map((unit) => [unit.id, unit]));
  for (const observer of [...observers].sort((left, right) => left.id - right.id)) {
    const guard = units.get(observer.id);
    if (!guard || guard.activity === "die" || guard.health <= 0 || guard.activity === "harvest" || guard.activity === "build") continue;
    const assigned = guard.targetId === null ? undefined : units.get(guard.targetId) ??
      snapshot.staticTargets.find(({ id }) => id === guard.targetId);
    const eligibility = new Map<number, boolean>();
    const canDamage = (targetId: number): boolean => {
      if (!eligibility.has(targetId)) eligibility.set(targetId, observer.targetCanDamage?.(targetId) ?? true);
      return eligibility.get(targetId)!;
    };
    if (guard.activity === "attack" && assigned && assigned.health > 0 && areHostile(guard, assigned, snapshot.teamAlliances)
      && (!observer.autonomousAttack || canDamage(assigned.id))) continue;
    if (guard.activity === "move" && observer.engageWhileMoving === false) continue;
    const radius = Math.floor((observer.dayRangeCells * snapshot.daylightPermille +
      observer.nightRangeCells * (1000 - snapshot.daylightPermille)) / 1000) * SUBCELLS_PER_CELL;
    const visible = [...snapshot.units, ...snapshot.staticTargets].filter((target) => areHostile(guard, target, snapshot.teamAlliances) &&
      target.health > 0 && (!("activity" in target) || target.activity !== "die") &&
      Math.abs(target.xSubcells - guard.xSubcells) + Math.abs(target.ySubcells - guard.ySubcells) <= radius && canDamage(target.id));
    const attacker = shots.filter((shot) => shot.targetId === guard.id)
      .map((shot) => units.get(shot.attackerId))
      .filter((unit) => unit && unit.health > 0 && unit.activity !== "die" && areHostile(guard, unit, snapshot.teamAlliances)
        && canDamage(unit.id))
      .sort((left, right) => left!.id - right!.id)[0];
    const target = attacker ?? visible.sort((left, right) => {
      const leftDistance = Math.abs(left.xSubcells - guard.xSubcells) + Math.abs(left.ySubcells - guard.ySubcells);
      const rightDistance = Math.abs(right.xSubcells - guard.xSubcells) + Math.abs(right.ySubcells - guard.ySubcells);
      return leftDistance - rightDistance || left.id - right.id;
    })[0];
    if (target) commands.push({ type: "attack", unitIds: [guard.id], targetId: target.id });
    else if (guard.activity === "attack") commands.push({ type: "stop", unitIds: [guard.id] });
  }
  return commands;
}
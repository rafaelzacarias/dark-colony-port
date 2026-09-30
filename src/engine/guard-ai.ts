import { areHostile } from "./diplomacy";
import { acquireBrowserTarget, AcquisitionIndex, type AcquisitionTraits } from "./browser-target-acquisition";
import type { CombatEvent, SimulationCommand, SimulationSnapshot } from "./simulation";

export interface GuardObserver {
  readonly id: number;
  readonly dayRangeCells: number;
  readonly nightRangeCells: number;
  readonly engageWhileMoving?: boolean;
  readonly targetCanDamage?: (targetId: number) => boolean;
  readonly autonomousAttack?: boolean;
  /** Weapon range in cells (0x435c14 scan radius); defaults to the current sight radius. */
  readonly weaponRangeCells?: number;
  readonly splash?: boolean;
  /** Mobile actors only: the idle scan beyond weapon range (0x414a87) is skipped for immobile ones. */
  readonly mobile?: boolean;
  /** Original team flag selecting the radius-16 idle scan instead of 9 (damaged) / 4. */
  readonly wideScan?: boolean;
  readonly targetTraits?: (targetId: number) => AcquisitionTraits;
  readonly isCellVisible?: (x: number, y: number) => boolean;
  readonly grid?: { readonly width: number; readonly height: number };
  readonly cellsOf?: (targetId: number) => readonly { readonly x: number; readonly y: number }[] | undefined;
}

// 0x414bb7/0x414bc7: idle scan radius after a weapon-range miss, for a team without the wide flag.
const DAMAGED_IDLE_SCAN_CELLS = 9;
const UNDAMAGED_IDLE_SCAN_CELLS = 4;
const WIDE_IDLE_SCAN_CELLS = 16;

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
  let index: AcquisitionIndex | undefined;
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
    const sight = Math.floor((observer.dayRangeCells * snapshot.daylightPermille +
      observer.nightRangeCells * (1000 - snapshot.daylightPermille)) / 1000);
    const width = observer.grid?.width, height = observer.grid?.height;
    index ??= new AcquisitionIndex(snapshot, width, height, observer.cellsOf);
    const scan = (radiusCells: number): number | null => acquireBrowserTarget({ snapshot, guardId: guard.id, radiusCells,
      splash: observer.splash, width, height, canDamage, traits: observer.targetTraits, cellsOf: observer.cellsOf,
      isCellVisible: observer.isCellVisible ?? ((x, y) => Math.abs(x - guard.cellX) + Math.abs(y - guard.cellY) <= sight) },
    index);
    // Move tasks skip acquisition, attack-move (0x415ae5) only scans weapon range and idle (0x414a87) also scans wider.
    let found = scan(observer.weaponRangeCells ?? sight);
    if (found === null && guard.activity !== "move" && observer.mobile !== false) {
      const damaged = shots.some(shot => shot.targetId === guard.id);
      found = scan(observer.wideScan ? WIDE_IDLE_SCAN_CELLS : damaged ? DAMAGED_IDLE_SCAN_CELLS : UNDAMAGED_IDLE_SCAN_CELLS);
    }
    const target = found === null ? undefined : { id: found };
    if (target) commands.push({ type: "attack", unitIds: [guard.id], targetId: target.id });
    else if (guard.activity === "attack") commands.push({ type: "stop", unitIds: [guard.id] });
  }
  return commands;
}
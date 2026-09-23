import { LEGACY_INSPIRE_NATIVE_RANDOM_TABLE } from "./legacy-inspire";

export interface LegacyMobileIdleTask {
  readonly task: number;
  readonly words: readonly number[];
}

export interface LegacyMobileIdleState {
  readonly slot: number;
  readonly typeId: number;
  readonly team: number;
  readonly activity: string;
  readonly status: number;
  readonly hp: number;
  readonly xQ8: number;
  readonly yQ8: number;
  readonly direction: number;
  readonly observer: number;
  readonly specialOrder: number;
  readonly confusion: number;
  readonly secondaryAnimationPending: number;
  readonly secondaryAnimationsInactive: boolean;
  readonly pending: number;
  readonly order: number;
  readonly charge: number;
  readonly randomIndex: number;
  readonly stack: readonly LegacyMobileIdleTask[];
  readonly animation: { readonly bank: number; readonly frame: number; readonly delay: number; readonly mode: number };
}

export interface LegacyMobileIdleWorld {
  readonly width: number;
  readonly height: number;
  readonly ground: ArrayLike<number>;
  readonly air: ArrayLike<number>;
  readonly auxiliary: ArrayLike<number>;
  readonly slots: Readonly<Record<number, { readonly team: number; readonly status: number }>>;
  readonly selfDiplomacy: number;
  readonly standBank: number;
  readonly sourceFin: "TRSC" | "GRAY";
  readonly standDirections: readonly { readonly frameCount: number; readonly delay: number }[];
}

export type LegacyMobileIdleOperation = "dispatch" | "initialize" | "continue";
export type LegacyMobileIdleResult = {
  readonly supported: false;
  readonly diagnostic: string;
} | {
  readonly supported: true;
  readonly state: LegacyMobileIdleState;
  readonly randomAdvances: readonly { readonly index: number; readonly value: number; readonly field: "turn-gate" | "turn-direction" }[];
  readonly transitions: readonly { readonly kind: "push" | "pop" | "reset"; readonly task: number }[];
  readonly handoff: "idle" | "deploy";
};

function integer(value: number, minimum: number, maximum: number): boolean {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

export function legacyMobileIdleDiagnostic(
  state: LegacyMobileIdleState,
  world: LegacyMobileIdleWorld,
  operation: LegacyMobileIdleOperation,
): string | null {
  if (state.activity !== "idle") return `unsupported-activity:${state.activity}`;
  if (![0, 8, 69, 73].includes(state.typeId)) return "unsupported-source-type";
  if (!integer(state.slot, 152, 799) || !integer(state.team, 0, 7)
    || state.status !== 1 || !integer(state.hp, 1, 32767)) return "unsupported-entity-state";
  if (state.observer !== 255 || state.specialOrder !== 0 || state.confusion !== 0
    || state.secondaryAnimationPending !== 0 || state.secondaryAnimationsInactive !== true) {
    return "unsupported-observer-or-auxiliary-work";
  }
  if (!integer(state.direction, 0, 255) || !integer(state.charge, 0, 255)
    || !integer(state.randomIndex, 0, 255) || !integer(state.pending, 0, 1)
    || !integer(state.order, 0, 255)) return "invalid-native-byte-state";
  if (state.pending && state.order !== 1 && state.order !== 13) return `unsupported-pending-order:${state.order}`;
  if (state.pending && state.order === 13 && state.typeId !== 69 && state.typeId !== 73) {
    return "unsupported-deploy-type";
  }
  const expectedFin = state.typeId === 0 || state.typeId === 69 ? "TRSC" : "GRAY";
  if (world.sourceFin !== expectedFin || !integer(world.standBank, 1, 0xffffffff)
    || world.standDirections.length !== 32
    || world.standDirections.some((direction) => direction.frameCount !== 1 || direction.delay !== 2)
    || state.animation.bank !== world.standBank || state.animation.frame !== 0
    || !integer(state.animation.delay, 0, 2) || ![0, 1, 2].includes(state.animation.mode)) {
    return "unsupported-source-fin-state";
  }
  if (!integer(world.width, 1, 256) || !integer(world.height, 1, 256)
    || !integer(state.xQ8, 0, world.width * 256 - 1)
    || !integer(state.yQ8, 0, world.height * 256 - 1) || world.selfDiplomacy !== 1) {
    return "unsupported-spatial-or-diplomacy-state";
  }
  for (const [plane, maximum] of [[world.ground, 0xffffffff], [world.air, 65535], [world.auxiliary, 65535]] as const) {
    if (plane.length !== world.width * world.height) return "incomplete-occupancy";
    for (let cell = 0; cell < plane.length; cell++) {
      if (!integer(plane[cell], 0, maximum)) return "invalid-occupancy";
      const slot = plane[cell] & 1023;
      if (slot >= 1022) continue;
      const occupant = world.slots[slot];
      if (!occupant || !integer(slot, 0, 799)) return "unresolved-occupant";
      if (occupant.team !== state.team || occupant.status !== 1) return "guard-combat-not-owned";
    }
  }
  if ((world.ground[(state.yQ8 >> 8) * world.width + (state.xQ8 >> 8)] & 1023) !== state.slot
    || world.slots[state.slot]?.team !== state.team || world.slots[state.slot]?.status !== 1) {
    return "inconsistent-source-occupancy";
  }
  const tasks = state.stack.map((entry) => entry.task).join(",");
  const idleStack = ["1", "1,3", "1,4", "1,4,3"].includes(tasks);
  if (operation === "initialize" ? tasks !== "" : !idleStack && !(operation === "continue" && tasks === "13")) {
    return `unsupported-task-stack:${tasks}`;
  }
  for (const entry of state.stack) {
    const length = entry.task === 1 ? 3 : entry.task === 3 ? 2 : 1;
    if (entry.words.length !== length || entry.words.some((word) => !integer(word, 0, 65535))) return "invalid-task-payload";
    if (entry.task === 1 && (entry.words[0] !== 65535 || entry.words[1] > 32767 || entry.words[2] > 3)) {
      return "unsupported-idle-payload";
    }
    if (entry.task === 3 && (entry.words[0] > 45 || entry.words[1] > 32767)) return "unsupported-wait-payload";
    if (entry.task === 4 && entry.words[0] > 255) return "unsupported-turn-payload";
    if (entry.task === 13 && entry.words[0] !== 50) return "unsupported-deploy-payload";
  }
  if (operation === "dispatch" && state.animation.mode === 1) return "deploy-animation-not-owned";
  return null;
}

export function reduceLegacyMobileIdle(
  input: LegacyMobileIdleState,
  world: LegacyMobileIdleWorld,
  operation: LegacyMobileIdleOperation,
): LegacyMobileIdleResult {
  const diagnostic = legacyMobileIdleDiagnostic(input, world, operation);
  if (diagnostic) return { supported: false, diagnostic };
  const state = { ...input, animation: { ...input.animation }, stack: input.stack.map((entry) => ({ task: entry.task, words: [...entry.words] })) };
  const randomAdvances: { index: number; value: number; field: "turn-gate" | "turn-direction" }[] = [];
  const transitions: { kind: "push" | "pop" | "reset"; task: number }[] = [];
  let handoff: "idle" | "deploy" = "idle";
  const push = (task: number, words: number[]) => {
    state.stack.push({ task, words });
    transitions.push({ kind: "push", task });
  };
  const pop = () => transitions.push({ kind: "pop", task: state.stack.pop()!.task });
  const draw = (field: "turn-gate" | "turn-direction") => {
    state.randomIndex = (state.randomIndex + 1) & 255;
    const value = LEGACY_INSPIRE_NATIVE_RANDOM_TABLE[state.randomIndex];
    randomAdvances.push({ index: state.randomIndex, value, field });
    return value;
  };
  const initialize = () => push(1, [65535, state.hp & 65535, 0]);
  const continueOrder = () => {
    state.stack = [];
    transitions.push({ kind: "reset", task: 0 });
    const order = state.pending ? state.order : 1;
    if (state.pending) {
      state.pending = 0;
      state.order = 255;
    }
    if (order === 13 && state.charge >= 32) {
      if (state.animation.mode !== 1) state.animation = { bank: world.standBank, frame: 0, delay: 0, mode: 1 };
      push(13, [50]);
      handoff = "deploy";
    } else initialize();
  };
  if (operation === "initialize") initialize();
  else if (operation === "continue") continueOrder();
  else {
    for (let dispatch = 0; dispatch < 8; dispatch++) {
      const task = state.stack.at(-1)!;
      if (task.task === 3) {
        if (state.pending || task.words[1] !== state.hp) {
          pop();
          continue;
        }
        if (task.words[0] === 0) pop();
        else task.words[0]--;
        break;
      }
      if (task.task === 4) {
        let delta = task.words[0] - state.direction;
        if (delta > 128) delta -= 256;
        if (delta < -128) delta += 256;
        state.direction = (state.direction + Math.sign(delta) * Math.min(Math.abs(delta), 10)) & 255;
        if (state.direction !== task.words[0]) break;
        pop();
        continue;
      }
      if (state.pending) {
        continueOrder();
        if (state.stack.at(-1)?.task === 13) break;
        continue;
      }
      if (state.animation.mode !== 0) state.animation = { bank: world.standBank, frame: 0, delay: 0, mode: 0 };
      if (task.words[1] > state.hp) task.words[2] = 0;
      task.words[1] = state.hp;
      if ((draw("turn-gate") & 15) === 0) push(4, [draw("turn-direction") & 255]);
      const duration = task.words[2] < 3 ? 15 : 45;
      if (task.words[2] < 3) task.words[2]++;
      push(3, [duration, state.hp]);
      break;
    }
  }
  return { supported: true, state, randomAdvances, transitions, handoff };
}

export function legacyMobileIdleInspireDiagnostic(
  state: LegacyMobileIdleState,
  world: LegacyMobileIdleWorld,
): string | null {
  const diagnostic = legacyMobileIdleDiagnostic(state, world, "dispatch");
  if (diagnostic) return diagnostic;
  if (state.typeId !== 69 && state.typeId !== 73) return "unsupported-deploy-type";
  if (state.pending) return "pending-order-already-owned";
  if (state.charge < 32) return "insufficient-inspire-charge";
  if (state.stack.some((entry) => entry.task === 4)) return "native-turn-defers-command";
  return null;
}
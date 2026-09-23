export interface LegacyHarvesterIdleState {
  readonly slot: number;
  readonly typeId: number;
  readonly team: number;
  readonly status: number;
  readonly hp: number;
  readonly xQ8: number;
  readonly yQ8: number;
  readonly direction: number;
  readonly randomIndex: number;
  readonly pending: number;
  readonly order: number;
  readonly observer: number;
  readonly specialOrder: number;
  readonly confusion: number;
  readonly secondaryAnimationPending: number;
  readonly secondaryAnimationsInactive: boolean;
  readonly stack: readonly { readonly task: number; readonly words: readonly number[] }[];
  readonly animation: { readonly bank: number; readonly frame: number; readonly delay: number; readonly mode: number };
}

export interface LegacyHarvesterIdleWorld {
  readonly width: number;
  readonly height: number;
  readonly selectedWeapon: number;
  readonly standBank: number;
  readonly preservedIdleBank: number;
  readonly groundWord: number;
  readonly groundCell: number;
  readonly animations: Readonly<Record<number, readonly (readonly number[])[]>>;
}

export type LegacyHarvesterIdleResult =
  | { readonly supported: false; readonly diagnostic: string }
  | { readonly supported: true; readonly state: LegacyHarvesterIdleState; readonly randomAdvances: readonly never[] };

function integer(value: number, minimum: number, maximum: number): boolean {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

export function legacyHarvesterIdleDiagnostic(
  state: LegacyHarvesterIdleState,
  world: LegacyHarvesterIdleWorld,
): string | null {
  if (state.typeId !== 6 && state.typeId !== 14) return "unsupported-source-type";
  if (!integer(state.slot, 152, 799) || !integer(state.team, 0, 7)
    || state.status !== 1 || !integer(state.hp, 1, 32767)) return "unsupported-entity-state";
  if (world.selectedWeapon !== -1 && world.selectedWeapon !== 0xffffffff) return "weapon-branch-not-owned";
  if (state.pending !== 0) return "pending-order-not-owned";
  if (!integer(state.order, 0, 255) || !integer(state.direction, 0, 255)
    || !integer(state.randomIndex, 0, 255)) return "invalid-native-byte-state";
  if (state.observer !== 255 || state.specialOrder !== 0 || state.confusion !== 0
    || state.secondaryAnimationPending !== 0 || state.secondaryAnimationsInactive !== true) {
    return "observer-or-auxiliary-work-not-owned";
  }
  if (!integer(world.width, 1, 256) || !integer(world.height, 1, 256)
    || !integer(state.xQ8, 0, world.width * 256 - 1) || !integer(state.yQ8, 0, world.height * 256 - 1)
    || world.groundCell !== (state.yQ8 >> 8) * world.width + (state.xQ8 >> 8)
    || !integer(world.groundWord, 0, 0xffffffff) || (world.groundWord & 1023) !== state.slot) {
    return "inconsistent-ground-occupancy";
  }
  const tasks = state.stack.map((task) => task.task).join(",");
  if (tasks !== "1" && tasks !== "1,3") return "task-owner-required";
  const idle = state.stack[0];
  if (idle.words.length !== 3 || idle.words[0] !== 65535 || !integer(idle.words[1], 0, 32767)
    || idle.words[2] !== 0) return "unsupported-idle-payload";
  const wait = state.stack[1];
  if (wait && (wait.words.length !== 2 || !integer(wait.words[0], 0, 7)
    || !integer(wait.words[1], 0, 32767))) return "unsupported-wait-payload";
  if (![world.standBank, world.preservedIdleBank].every((bank) => integer(bank, 1, 0xffffffff))) {
    return "missing-source-fin-bank";
  }
  for (const bank of [world.standBank, world.preservedIdleBank, state.animation.bank]) {
    const directions = world.animations[bank];
    if (!directions || directions.length !== 32 || directions.some((delays) => delays.length === 0
      || delays.length > 256 || delays.some((delay) => !integer(delay, 0, 255)))) return "invalid-source-fin-bank";
  }
  const direction = (((state.direction + 8) & 255) >> 4) * 2;
  if (!integer(state.animation.frame, 0, world.animations[state.animation.bank][direction].length - 1)
    || !integer(state.animation.delay, 0, 255) || !integer(state.animation.mode, 0, 2)) return "invalid-animation-state";
  return null;
}

export function reduceLegacyHarvesterIdle(
  input: LegacyHarvesterIdleState,
  world: LegacyHarvesterIdleWorld,
): LegacyHarvesterIdleResult {
  const diagnostic = legacyHarvesterIdleDiagnostic(input, world);
  if (diagnostic) return { supported: false, diagnostic };
  const state = { ...input, animation: { ...input.animation },
    stack: input.stack.map((task) => ({ task: task.task, words: [...task.words] })) };
  const wait = state.stack[1];
  if (wait) {
    if (wait.words[1] !== state.hp) state.stack.pop();
    else {
      if (wait.words[0] === 0) state.stack.pop();
      else wait.words[0]--;
      return { supported: true, state, randomAdvances: [] };
    }
  }
  if (state.animation.bank !== world.preservedIdleBank
    && (state.animation.bank !== world.standBank || state.animation.mode !== 0)) {
    state.animation = { bank: world.standBank, frame: 0, delay: 0, mode: 0 };
  }
  state.stack.push({ task: 3, words: [7, state.hp] });
  return { supported: true, state, randomAdvances: [] };
}
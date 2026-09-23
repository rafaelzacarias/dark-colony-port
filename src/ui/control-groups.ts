export interface ControlGroupUnit {
  readonly id: number;
  readonly owned: boolean;
  readonly health: number;
  readonly activity?: string;
}

export interface ControlGroups {
  readonly groups: readonly (readonly number[])[];
  readonly awaitingDigit: boolean;
}

export interface ControlGroupKey {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  readonly repeat?: boolean;
  readonly editable?: boolean;
}

export interface ControlGroupResult {
  readonly state: ControlGroups;
  readonly handled: boolean;
  readonly selection: readonly number[] | null;
}

export function createControlGroups(): ControlGroups {
  return { groups: Array.from({ length: 10 }, () => []), awaitingDigit: false };
}

export function restoreControlGroups(value: unknown, units: readonly ControlGroupUnit[]): ControlGroups {
  if (!Array.isArray(value) || value.length !== 10 || value.some((group) => !Array.isArray(group) ||
    group.length > 800 || group.some((id) => !Number.isSafeInteger(id) || id < 1))) {
    throw new Error("Invalid saved control groups");
  }
  return pruneControlGroups({ groups: value.map((group) => [...group]), awaitingDigit: false }, units);
}

export function pruneControlGroups(state: ControlGroups, units: readonly ControlGroupUnit[]): ControlGroups {
  const eligible = new Set(units.filter(isEligible).map(({ id }) => id));
  return {
    groups: Array.from({ length: 10 }, (_, digit) => cleanIds(state.groups[digit] ?? [], eligible)),
    awaitingDigit: state.awaitingDigit,
  };
}

function isEligible(unit: ControlGroupUnit): boolean {
  return unit.owned && unit.health > 0 && unit.activity !== "die";
}

function cleanIds(ids: readonly number[], eligible: ReadonlySet<number>): number[] {
  return [...new Set(ids.filter((id) => eligible.has(id)))].sort((left, right) => left - right);
}

export function reduceControlGroupKey(
  previous: ControlGroups,
  input: ControlGroupKey,
  selectedIds: readonly number[],
  units: readonly ControlGroupUnit[],
  ctrlNumberAlias = false,
): ControlGroupResult {
  const state = pruneControlGroups(previous, units);
  const cancelled = { ...state, awaitingDigit: false };
  if (input.editable || input.altKey || input.metaKey || input.shiftKey) {
    return { state: cancelled, handled: false, selection: null };
  }
  const digit = /^[0-9]$/.test(input.key) ? Number(input.key) : null;
  const createAlias = Boolean(ctrlNumberAlias && input.ctrlKey && digit !== null);
  if (input.ctrlKey && !createAlias) return { state: cancelled, handled: false, selection: null };
  const arm = input.key.toLowerCase() === "g";
  if (input.repeat) return { state, handled: arm || digit !== null, selection: null };
  if (arm) return { state: { ...state, awaitingDigit: true }, handled: true, selection: null };
  if (digit === null) return { state: cancelled, handled: false, selection: null };
  if (state.awaitingDigit || createAlias) {
    const eligible = new Set(units.filter(isEligible).map(({ id }) => id));
    const groups = state.groups.map((ids, index) => index === digit ? cleanIds(selectedIds, eligible) : ids);
    return { state: { groups, awaitingDigit: false }, handled: true, selection: null };
  }
  return { state: cancelled, handled: true, selection: [...state.groups[digit]] };
}

export interface ControlGroupBindingOptions {
  readonly getUnits: () => readonly ControlGroupUnit[];
  readonly getSelectedIds: () => readonly number[];
  readonly onRecall: (ids: readonly number[]) => void;
  readonly ctrlNumberAlias?: boolean;
  readonly isEnabled?: () => boolean;
}

export function bindControlGroups(target: EventTarget, options: ControlGroupBindingOptions) {
  let state = createControlGroups();
  const cancel = () => { state = { ...state, awaitingDigit: false }; };
  const keydown = (event: Event) => {
    const keyboard = event as KeyboardEvent;
    if (options.isEnabled?.() === false || event.defaultPrevented) {
      cancel();
      return;
    }
    const editable = event.composedPath().some((node) => {
      const element = node as HTMLElement;
      return element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName ?? "");
    });
    const result = reduceControlGroupKey(state, {
      key: keyboard.key,
      ctrlKey: keyboard.ctrlKey,
      altKey: keyboard.altKey,
      metaKey: keyboard.metaKey,
      shiftKey: keyboard.shiftKey,
      repeat: keyboard.repeat,
      editable: editable || keyboard.isComposing,
    }, options.getSelectedIds(), options.getUnits(), options.ctrlNumberAlias);
    state = result.state;
    if (result.handled) event.preventDefault();
    if (result.selection !== null) options.onRecall(result.selection);
  };
  target.addEventListener("keydown", keydown);
  target.addEventListener("blur", cancel, true);
  target.addEventListener("focusin", cancel);
  return {
    get state(): ControlGroups { return pruneControlGroups(state, options.getUnits()); },
    restore(groups: unknown): void { state = restoreControlGroups(groups, options.getUnits()); },
    reset(): void { state = createControlGroups(); },
    dispose(): void {
      target.removeEventListener("keydown", keydown);
      target.removeEventListener("blur", cancel, true);
      target.removeEventListener("focusin", cancel);
      state = createControlGroups();
    },
  };
}
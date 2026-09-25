import { CAMERA_PAN_CELLS_PER_SECOND, CAMERA_PAN_MAX_FRAME_MS } from "./camera-pan";

export interface MobileControlsCallbacks {
  onPan(dx: number, dy: number): void;
  onSelectScreen(): void;
  onBuildMenu(): void;
  onClearSelection(): void;
  onStop(): void;
  onMove(): void;
  onAssault(): void;
  onOptions(): void;
}

export interface MobileControlsState {
  visible: boolean;
  enabled: boolean;
  selectedCount: number;
  orderMode: string;
  movementStance: string;
  buildOpen: boolean;
}

/** Deliberately UA-only: a narrow viewport or touch screen does not make a phone. */
export function isPhoneUserAgent(userAgent: string): boolean {
  if (/\b(?:iPad|iPod|Tablet|PlayBook|Kindle|Silk|TouchPad)\b/i.test(userAgent)) return false;
  return /\biPhone\b/i.test(userAgent)
    || (/\bAndroid\b/i.test(userAgent) && /\bMobile\b/i.test(userAgent))
    || /\b(?:Windows Phone|Windows CE|IEMobile|BlackBerry\d*|BB10|webOS|PalmOS|KaiOS|SymbianOS)\b/i.test(userAgent);
}

type PanAction = "pan-up" | "pan-left" | "pan-right" | "pan-down";
type CommandAction = "select-screen" | "build" | "clear" | "stop" | "move" | "assault" | "options";
type Action = PanAction | CommandAction;

const DIRECTIONS: Record<PanAction, readonly [number, number]> = {
  "pan-up": [0, 1], "pan-left": [-1, 0], "pan-right": [1, 0], "pan-down": [0, -1],
};
const ICONS: Record<Action, string> = {
  "pan-up": "M6 15l6-6 6 6",
  "pan-left": "M15 6l-6 6 6 6",
  "pan-right": "M9 6l6 6-6 6",
  "pan-down": "M6 9l6 6 6-6",
  "select-screen": "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 12h8m-4-4v8",
  build: "M3 10h8v11H3zM13 3h8v8h-8zM13 14h8v7h-8zM7 3v4M5 5h4",
  clear: "M6 6l12 12M6 18L18 6",
  stop: "M6 6h12v12H6z",
  move: "M4 18v-6h15m-5-5l5 5-5 5",
  assault: "M12 3v4m0 10v4M3 12h4m10 0h4M8 8h8v8H8z",
  options: "M4 6h16M4 12h16M4 18h16",
};
const PAN_CELLS_PER_SECOND = CAMERA_PAN_CELLS_PER_SECOND;
const TAP_CELLS = 0.35;
const MAX_TICK_MS = CAMERA_PAN_MAX_FRAME_MS;

/**
 * The caller supplies RAF timestamps to tick(); no timers or animation loop are owned here.
 * Pan distances are world cells, with positive Y pointing up.
 */
export function createMobileControls(parent: HTMLElement, callbacks: MobileControlsCallbacks) {
  const document = parent.ownerDocument;
  const window = document.defaultView;
  const root = document.createElement("section");
  root.id = "mobile-controls";
  root.className = "mobile-command-deck";
  root.hidden = true;
  root.setAttribute("aria-label", "Mobile command deck");

  const header = document.createElement("div");
  header.className = "mobile-command-header";
  const heading = document.createElement("span");
  heading.className = "mobile-command-heading";
  heading.textContent = "COMMAND DECK";
  const status = document.createElement("span");
  status.className = "mobile-command-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  header.append(heading, status);

  const body = document.createElement("div");
  body.className = "mobile-command-body";
  const dpad = document.createElement("div");
  dpad.className = "mobile-command-dpad";
  dpad.setAttribute("role", "group");
  dpad.setAttribute("aria-label", "Camera: hold arrows to pan");
  const commands = document.createElement("div");
  commands.className = "mobile-command-actions";
  commands.setAttribute("role", "group");
  commands.setAttribute("aria-label", "Unit commands");
  body.append(dpad, commands);
  root.append(header, body);

  const buttons = new Map<Action, HTMLButtonElement>();
  const held = new Map<number, { action: PanAction; button: HTMLButtonElement; panned: boolean }>();
  const listeners: (() => void)[] = [];
  let visible = false;
  let enabled = false;
  let disposed = false;
  let lastTick: number | null = null;

  function listen(target: EventTarget, type: string, handler: EventListener, options?: AddEventListenerOptions) {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  }
  function interactive() {
    return !disposed && visible && enabled && !document.hidden;
  }
  function releaseCapture(button: HTMLButtonElement, pointerId: number) {
    try {
      if (button.hasPointerCapture(pointerId)) button.releasePointerCapture(pointerId);
    } catch {
      // The browser may already have released a cancelled or detached pointer.
    }
  }
  function setHeld(button: HTMLButtonElement) {
    button.classList.toggle("is-held", [...held.values()].some(value => value.button === button));
  }
  function finishPointer(event: PointerEvent, tap: boolean) {
    const pointer = held.get(event.pointerId);
    if (!pointer) return;
    held.delete(event.pointerId);
    if (!held.size) lastTick = null;
    setHeld(pointer.button);
    releaseCapture(pointer.button, event.pointerId);
    if (tap && !pointer.panned && interactive()) {
      const [dx, dy] = DIRECTIONS[pointer.action];
      callbacks.onPan(dx * TAP_CELLS, dy * TAP_CELLS);
    }
  }
  function cancel() {
    const pointers = [...held.entries()];
    held.clear();
    lastTick = null;
    for (const [pointerId, { button }] of pointers) {
      setHeld(button);
      releaseCapture(button, pointerId);
    }
  }
  function button(action: Action, label: string, accessibleLabel: string, container: HTMLElement) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "mobile-command-button";
    element.dataset.mobileAction = action;
    element.disabled = true;
    element.setAttribute("aria-label", accessibleLabel);
    element.title = accessibleLabel;
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("focusable", "false");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", ICONS[action]);
    icon.append(path);
    const text = document.createElement("span");
    text.textContent = label;
    element.append(icon, text);
    container.append(element);
    buttons.set(action, element);
    return element;
  }
  function panButton(action: PanAction, label: string) {
    const element = button(action, label, `Pan camera ${label.toLowerCase()} (hold)`, dpad);
    listen(element, "pointerdown", event => {
      const pointer = event as PointerEvent;
      if (!interactive() || element.disabled || pointer.button !== 0 || held.has(pointer.pointerId)) return;
      event.preventDefault();
      if (!held.size) lastTick = null;
      held.set(pointer.pointerId, { action, button: element, panned: false });
      setHeld(element);
      try {
        element.setPointerCapture(pointer.pointerId);
      } catch {
        // Window release listeners also cover browsers that reject capture.
      }
    });
    listen(element, "pointerup", event => finishPointer(event as PointerEvent, true));
    listen(element, "pointercancel", event => finishPointer(event as PointerEvent, false));
    listen(element, "lostpointercapture", event => finishPointer(event as PointerEvent, false));
    listen(element, "click", event => {
      const click = event as PointerEvent;
      // Keyboard/AT clicks have no pointer type or click count; physical taps were handled above.
      if (!interactive() || element.disabled || click.detail !== 0 || click.pointerType) return;
      const [dx, dy] = DIRECTIONS[action];
      callbacks.onPan(dx * TAP_CELLS, dy * TAP_CELLS);
    });
  }
  function commandButton(action: CommandAction, label: string, accessibleLabel: string,
    callback: () => void, container = commands) {
    const element = button(action, label, accessibleLabel, container);
    listen(element, "click", () => {
      if (interactive() && !element.disabled) callback();
    });
    return element;
  }

  panButton("pan-up", "Up");
  panButton("pan-left", "Left");
  const optionsButton = commandButton("options", "Options", "Mission options", callbacks.onOptions, dpad);
  optionsButton.setAttribute("aria-haspopup", "dialog");
  panButton("pan-right", "Right");
  panButton("pan-down", "Down");
  commandButton("select-screen", "Select screen", "Select friendly units on screen", callbacks.onSelectScreen);
  const buildButton = commandButton("build", "Build", "Open build menu", callbacks.onBuildMenu);
  buildButton.setAttribute("aria-haspopup", "dialog");
  const moveButton = commandButton("move", "Move", "Set move order", callbacks.onMove);
  const assaultButton = commandButton("assault", "Assault", "Set assault order", callbacks.onAssault);
  commandButton("stop", "Stop", "Stop selected units", callbacks.onStop);
  commandButton("clear", "Clear", "Clear selection", callbacks.onClearSelection);

  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "lostpointercapture",
    "mousedown", "mousemove", "mouseup", "touchstart", "touchmove", "touchend", "touchcancel",
    "click", "dblclick", "keydown", "keyup", "wheel"]) {
    listen(root, type, event => event.stopPropagation());
  }
  for (const type of ["contextmenu", "dragstart"]) {
    listen(root, type, event => { event.stopPropagation(); event.preventDefault(); });
  }
  if (window) {
    listen(window, "pointerup", event => finishPointer(event as PointerEvent, true));
    listen(window, "pointercancel", event => finishPointer(event as PointerEvent, false));
    listen(window, "blur", cancel);
  }
  listen(document, "visibilitychange", cancel);

  const stage = parent.querySelector(".preview-stage");
  if (stage?.parentElement === parent) stage.after(root);
  else parent.append(root);

  function setAttribute(element: HTMLElement, name: string, value: string) {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }

  return {
    root,
    update(state: MobileControlsState) {
      if (disposed) return;
      visible = state.visible;
      enabled = state.enabled;
      if (!visible || !enabled) cancel();
      if (root.hidden !== !visible) root.hidden = !visible;
      if (parent.classList.contains("mobile-controls-visible") !== visible) {
        parent.classList.toggle("mobile-controls-visible", visible);
      }
      const count = Number.isFinite(state.selectedCount) ? Math.max(0, Math.floor(state.selectedCount)) : 0;
      for (const [action, element] of buttons) {
        const needsSelection = action === "clear" || action === "stop" || action === "move" || action === "assault";
        const disabled = !visible || !enabled || (needsSelection && count === 0);
        if (element.disabled !== disabled) element.disabled = disabled;
      }
      const movement = state.orderMode === "move" || state.orderMode === "assault"
        ? state.orderMode : state.movementStance;
      const assault = movement === "assault";
      const move = movement === "move";
      setAttribute(moveButton, "aria-pressed", String(move));
      setAttribute(assaultButton, "aria-pressed", String(assault));
      setAttribute(buildButton, "aria-pressed", String(state.buildOpen));
      setAttribute(buildButton, "aria-expanded", String(state.buildOpen));
      const mode = !enabled ? "Paused" : state.buildOpen ? "Build menu"
        : count === 0 ? "Select units" : assault ? "Assault" : move ? "Move" : "Ready";
      const message = `${count} selected / ${mode}`;
      if (status.textContent !== message) status.textContent = message;
    },
    tick(time: number) {
      if (!interactive() || !held.size) { lastTick = null; return; }
      if (!Number.isFinite(time)) { lastTick = null; return; }
      if (lastTick === null) { lastTick = time; return; }
      const elapsed = Math.min(MAX_TICK_MS, Math.max(0, time - lastTick));
      lastTick = time;
      if (!elapsed) return;
      const actions = new Set<PanAction>();
      for (const pointer of held.values()) {
        actions.add(pointer.action);
        pointer.panned = true;
      }
      const dx = Number(actions.has("pan-right")) - Number(actions.has("pan-left"));
      const dy = Number(actions.has("pan-up")) - Number(actions.has("pan-down"));
      const length = Math.hypot(dx, dy);
      if (length) {
        const distance = PAN_CELLS_PER_SECOND * elapsed / 1000;
        callbacks.onPan(dx / length * distance, dy / length * distance);
      }
    },
    cancel,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancel();
      for (const remove of listeners) remove();
      listeners.length = 0;
      root.remove();
      parent.classList.remove("mobile-controls-visible");
    },
  };
}

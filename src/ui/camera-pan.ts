export const CAMERA_PAN_CELLS_PER_SECOND = 12;
export const CAMERA_PAN_MAX_FRAME_MS = 80;
const TAP_CELLS = 0.35;

const directions: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1],
};

export function createCameraPan(canvas: HTMLCanvasElement, callbacks: {
  readonly isEnabled: () => boolean;
  readonly onPan: (x: number, y: number) => void;
}) {
  const document = canvas.ownerDocument, window = document.defaultView;
  const held = new Map<string, { panned: boolean }>();
  const removeListeners: (() => void)[] = [];
  let edgeX = 0, edgeY = 0, lastTime: number | null = null, disposed = false;
  const enabled = () => !disposed && !document.hidden && callbacks.isEnabled();
  function listen(target: EventTarget, type: string, listener: EventListener, capture = false): void {
    target.addEventListener(type, listener, capture);
    removeListeners.push(() => target.removeEventListener(type, listener, capture));
  }
  function cancel(): void {
    held.clear();
    edgeX = edgeY = 0;
    lastTime = null;
  }
  function clearEdge(): void {
    edgeX = edgeY = 0;
    if (!held.size) lastTime = null;
  }
  listen(canvas, "pointermove", event => {
    const pointer = event as PointerEvent;
    if (!enabled() || pointer.pointerType !== "mouse" || pointer.buttons !== 0) { clearEdge(); return; }
    const bounds = canvas.getBoundingClientRect();
    const x = pointer.clientX - bounds.left, y = pointer.clientY - bounds.top;
    const margin = Math.min(20, Math.min(bounds.width, bounds.height) * 0.05);
    if (x < 0 || y < 0 || x > bounds.width || y > bounds.height || margin <= 0) { clearEdge(); return; }
    edgeX = x < margin ? -1 : x > bounds.width - margin ? 1 : 0;
    edgeY = y < margin ? 1 : y > bounds.height - margin ? -1 : 0;
    if (!edgeX && !edgeY && !held.size) lastTime = null;
  });
  listen(canvas, "pointerleave", clearEdge);
  listen(canvas, "pointerdown", clearEdge);
  if (window) {
    listen(window, "keyup", event => {
      const key = event as KeyboardEvent, state = held.get(key.key);
      if (!state) return;
      held.delete(key.key);
      key.preventDefault();
      if (!held.size && !edgeX && !edgeY) lastTime = null;
      if (!state.panned && enabled()) {
        const [x, y] = directions[key.key];
        callbacks.onPan(x * TAP_CELLS, y * TAP_CELLS);
      }
    }, true);
    listen(window, "blur", cancel);
    listen(window, "resize", cancel);
  }
  listen(document, "visibilitychange", cancel);
  listen(document, "focusin", cancel);
  return {
    keyDown(event: KeyboardEvent): boolean {
      if (!Object.hasOwn(directions, event.key) || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return false;
      if (!enabled()) { cancel(); return false; }
      event.preventDefault();
      if (!event.repeat && !held.has(event.key)) held.set(event.key, { panned: false });
      return true;
    },
    tick(time: number): void {
      if (!enabled()) { cancel(); return; }
      if ((!held.size && !edgeX && !edgeY) || !Number.isFinite(time)) { lastTime = null; return; }
      if (lastTime === null) { lastTime = time; return; }
      const elapsed = Math.min(CAMERA_PAN_MAX_FRAME_MS, Math.max(0, time - lastTime));
      lastTime = time;
      let x = 0, y = 0;
      if (held.size) for (const [key, state] of held) {
        const direction = directions[key];
        x += direction[0]; y += direction[1];
        if (elapsed > 0) state.panned = true;
      }
      else { x = edgeX; y = edgeY; }
      const length = Math.hypot(x, y);
      if (length && elapsed > 0) {
        const distance = CAMERA_PAN_CELLS_PER_SECOND * elapsed / 1000;
        callbacks.onPan(x / length * distance, y / length * distance);
      }
    },
    cancel,
    dispose(): void {
      if (disposed) return;
      disposed = true; cancel();
      removeListeners.forEach(remove => remove());
    },
  };
}

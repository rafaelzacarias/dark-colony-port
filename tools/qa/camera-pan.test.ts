import assert from "node:assert/strict";
import test from "node:test";
import { createCameraPan, CAMERA_PAN_CELLS_PER_SECOND } from "../../src/ui/camera-pan";

function fixture() {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { hidden: false, defaultView: window });
  const canvas = Object.assign(new EventTarget(), { ownerDocument: document,
    getBoundingClientRect: () => ({ left: 30, top: 50, width: 512, height: 452 }) });
  let enabled = true;
  const pans: [number, number][] = [];
  const controller = createCameraPan(canvas as unknown as HTMLCanvasElement, {
    isEnabled: () => enabled, onPan: (x, y) => pans.push([x, y]),
  });
  const key = (name: string, repeat = false) => Object.assign(new Event("keydown", { cancelable: true }),
    { key: name, repeat, ctrlKey: false, metaKey: false, altKey: false }) as KeyboardEvent;
  return { controller, pans, window, document,
    enable(value: boolean) { enabled = value; },
    down(name: string, repeat = false) { const event = key(name, repeat); return { handled: controller.keyDown(event), event }; },
    up(name: string) { window.dispatchEvent(Object.assign(new Event("keyup", { cancelable: true }), { key: name })); },
    pointer(x: number, y: number, pointerType = "mouse", buttons = 0) {
      canvas.dispatchEvent(Object.assign(new Event("pointermove"), { clientX: x, clientY: y, pointerType, buttons }));
    },
    leave() { canvas.dispatchEvent(new Event("pointerleave")); },
    total() { return pans.reduce(([x, y], pan) => [x + pan[0], y + pan[1]], [0, 0]); },
  };
}

for (const hz of [30, 60, 120]) test(`held arrows pan continuously at ${hz} Hz without keyboard-repeat tile jumps`, () => {
  const f = fixture();
  const down = f.down("ArrowRight");
  assert.equal(down.handled, true);
  assert.equal(down.event.defaultPrevented, true);
  assert.equal(f.pans.length, 0);
  f.controller.tick(0);
  for (let frame = 1; frame <= hz; frame++) {
    f.down("ArrowRight", true);
    f.controller.tick(frame * 1000 / hz);
  }
  assert.ok(Math.abs(f.total()[0] - CAMERA_PAN_CELLS_PER_SECOND) < 1e-9);
  assert.equal(f.pans.length, hz);
  assert.ok(f.pans.every(([x, y]) => x > 0 && x < 1 && y === 0));
  f.up("ArrowRight");
  f.controller.tick(2000);
  assert.equal(f.pans.length, hz);
  f.controller.dispose();
});

test("camera keyboard taps stay small, diagonals normalize, and opposed keys do not jump on release", () => {
  const f = fixture();
  f.down("ArrowUp"); f.up("ArrowUp");
  assert.deepEqual(f.pans, [[0, 0.35]]);
  f.pans.length = 0;
  f.down("ArrowUp"); f.down("ArrowRight");
  f.controller.tick(0); f.controller.tick(50);
  assert.ok(Math.abs(Math.hypot(...f.total()) - 0.6) < 1e-9);
  f.controller.cancel(); f.pans.length = 0;
  f.down("ArrowLeft"); f.down("ArrowRight");
  f.controller.tick(100); f.controller.tick(150);
  f.up("ArrowLeft"); f.up("ArrowRight");
  assert.deepEqual(f.pans, []);
  assert.equal(f.down("toString").handled, false);
  f.controller.dispose();
});

test("mouse-edge panning is continuous and does not react to touch, drags, or leaving the canvas", () => {
  const f = fixture();
  f.pointer(541, 51);
  f.controller.tick(0); f.controller.tick(50);
  assert.ok(f.pans[0][0] > 0 && f.pans[0][1] > 0);
  assert.ok(Math.abs(Math.hypot(...f.pans[0]) - 0.6) < 1e-9);
  for (const cancel of [
    () => f.pointer(541, 51, "touch"),
    () => f.pointer(541, 51, "mouse", 1),
    () => f.leave(),
    () => f.pointer(200, 200),
  ]) {
    f.pointer(541, 51);
    cancel();
    const count = f.pans.length;
    f.controller.tick(1000);
    assert.equal(f.pans.length, count);
  }
  f.controller.dispose();
});

test("menus, blur, hidden pages, resizing and disposal cancel held input; long frames are bounded", () => {
  const f = fixture();
  f.down("ArrowUp"); f.controller.tick(0); f.controller.tick(1000);
  assert.deepEqual(f.pans, [[0, 0.96]]);
  for (const cancel of [
    () => f.window.dispatchEvent(new Event("blur")),
    () => f.window.dispatchEvent(new Event("resize")),
    () => f.document.dispatchEvent(new Event("visibilitychange")),
    () => f.document.dispatchEvent(new Event("focusin")),
    () => { f.enable(false); f.controller.tick(2000); f.enable(true); },
    () => f.controller.cancel(),
  ]) {
    f.down("ArrowUp");
    cancel();
    const count = f.pans.length;
    f.down("ArrowUp", true);
    f.controller.tick(3000); f.controller.tick(3050);
    f.up("ArrowUp");
    assert.equal(f.pans.length, count);
  }
  f.controller.dispose();
  f.pointer(541, 51); f.down("ArrowRight");
  f.controller.tick(4000); f.controller.tick(4050);
  assert.equal(f.pans.length, 1);
});

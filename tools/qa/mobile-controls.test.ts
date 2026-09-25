import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createMobileControls,
  isPhoneUserAgent,
  type MobileControlsState,
} from "../../src/ui/mobile-controls";

test("phone UA gate accepts phones, without reading browser or viewport globals", () => {
  const phones = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Android 14; Mobile; rv:129.0) Gecko/129.0 Firefox/129.0",
    "Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1; Microsoft; Lumia 950) AppleWebKit/537.36 Chrome/52.0.2743.116 Mobile Safari/537.36 Edge/15.15063",
    "Mozilla/5.0 (compatible; MSIE 9.0; Windows Phone OS 7.5; Trident/5.0; IEMobile/9.0)",
    "BlackBerry9700/5.0.0.862 Profile/MIDP-2.1 Configuration/CLDC-1.1 VendorID/331",
    "Mozilla/5.0 (BB10; Touch) AppleWebKit/537.35+ Version/10.3.1.2576 Mobile Safari/537.35+",
    "Mozilla/5.0 (webOS/1.4.0; U; en-US) AppleWebKit/532.2 Version/1.0 Mobile/1.0 Safari/532.2 Pre/1.0",
    "Mozilla/5.0 (Mobile; Nokia 8110 4G; rv:48.0) Gecko/48.0 Firefox/48.0 KAIOS/2.5",
    "Mozilla/5.0 (SymbianOS/9.4; Series60/5.0 Nokia5800d-1/51.0.006) AppleWebKit/525",
    "mozilla/5.0 (linux; android 15; pixel 9) mobile safari/537.36",
  ];
  for (const ua of phones) assert.equal(isPhoneUserAgent(ua), true, ua);
});

test("phone UA gate rejects desktops, tiny touch laptops, tablets and unknown agents", () => {
  const notPhones = [
    "",
    " ",
    "Mobile",
    "Android",
    "Mozilla/5.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; Touch) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64; rv:129.0) Gecko/20100101 Firefox/129.0",
    "Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 Version/17.6 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.6 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14; SM-X810) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Android 14; Tablet; rv:129.0) Gecko/129.0 Firefox/129.0",
    "Mozilla/5.0 (Linux; Android 9; Tablet) Mobile Safari/537.36",
    "Mozilla/5.0 (PlayBook; U; RIM Tablet OS 2.1.0) AppleWebKit/536.2+ Version/7.2.1.0 Safari/536.2+",
    "Mozilla/5.0 (hp-tablet; Linux; hpwOS/3.0.5; U; en-US) AppleWebKit/534.6 TouchPad/1.0",
    "Mozilla/5.0 (Linux; Android 11; KFTRWI) AppleWebKit/537.36 Silk/123.4 Mobile Safari/537.36",
    "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
    "not-an-iPhoneClone AndroidLike MobileLike",
  ];
  for (const ua of notPhones) assert.equal(isPhoneUserAgent(ua), false, ua);
});

// A small EventTarget-backed DOM, following the other UI lifecycle tests without importing them.
class TestTarget extends EventTarget {
  readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean) {
    if (callback) {
      const callbacks = this.listeners.get(type) ?? new Set();
      callbacks.add(callback);
      this.listeners.set(type, callbacks);
    }
    super.addEventListener(type, callback, options);
  }
  override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean) {
    if (callback) this.listeners.get(type)?.delete(callback);
    super.removeEventListener(type, callback, options);
  }
  get listenerCount() {
    return [...this.listeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0);
  }
}

class TestElement extends TestTarget {
  readonly children: TestElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly captured = new Set<number>();
  parentElement: TestElement | null = null;
  id = "";
  className = "";
  type = "";
  title = "";
  hidden = false;
  disabled = false;
  rejectCapture = false;
  textWrites = 0;
  attributeWrites = 0;
  private text = "";
  readonly classList = {
    contains: (token: string) => this.className.split(/\s+/).includes(token),
    toggle: (token: string, force?: boolean) => {
      const classes = new Set(this.className.split(/\s+/).filter(Boolean));
      const add = force ?? !classes.has(token);
      if (add) classes.add(token); else classes.delete(token);
      this.className = [...classes].join(" ");
      return add;
    },
    remove: (token: string) => { this.classList.toggle(token, false); },
  };
  constructor(readonly ownerDocument: TestDocument, readonly tagName: string) { super(); }
  get textContent() { return this.text; }
  set textContent(value: string) { this.text = value; this.textWrites += 1; }
  append(...children: TestElement[]) {
    for (const child of children) {
      child.remove();
      child.parentElement = this;
      this.children.push(child);
    }
  }
  after(element: TestElement) {
    const parent = this.parentElement!;
    element.remove();
    element.parentElement = parent;
    parent.children.splice(parent.children.indexOf(this) + 1, 0, element);
  }
  remove() {
    if (this.parentElement) {
      this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
      this.parentElement = null;
    }
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
    this.attributeWrites += 1;
  }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  querySelector(selector: string): TestElement | null {
    return this.descendants().find(element => selector.startsWith(".")
      ? element.classList.contains(selector.slice(1)) : element.tagName === selector.toUpperCase()) ?? null;
  }
  descendants(): TestElement[] {
    return this.children.flatMap(child => [child, ...child.descendants()]);
  }
  setPointerCapture(id: number) {
    if (this.rejectCapture) throw new Error("Capture unavailable");
    this.captured.add(id);
  }
  hasPointerCapture(id: number) { return this.captured.has(id); }
  releasePointerCapture(id: number) {
    if (this.captured.delete(id)) emit(this, "lostpointercapture", { pointerId: id });
  }
}

class TestDocument extends TestTarget {
  readonly defaultView = new TestTarget();
  readonly elements: TestElement[] = [];
  hidden = false;
  createElement(tag: string) {
    const element = new TestElement(this, tag.toUpperCase());
    this.elements.push(element);
    return element;
  }
  createElementNS(_namespace: string, tag: string) { return this.createElement(tag); }
}

function emit(target: TestTarget, type: string, properties: Record<string, unknown> = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, { value });
  let stopped = false;
  const stop = event.stopPropagation.bind(event);
  event.stopPropagation = () => { stopped = true; stop(); };
  const path: TestTarget[] = [target];
  if (target instanceof TestElement) {
    for (let parent = target.parentElement; parent; parent = parent.parentElement) path.push(parent);
    path.push(target.ownerDocument, target.ownerDocument.defaultView);
  }
  for (const current of path) {
    current.dispatchEvent(event);
    if (stopped) break;
  }
  return event;
}

const READY: MobileControlsState = {
  visible: true, enabled: true, selectedCount: 3, orderMode: "move", movementStance: "move", buildOpen: false,
};

function fixture() {
  const document = new TestDocument();
  const parent = document.createElement("section");
  parent.className = "preview-panel";
  const stage = document.createElement("div");
  stage.className = "preview-stage";
  const footer = document.createElement("footer");
  parent.append(stage, footer);
  const pans: [number, number][] = [];
  const actions: string[] = [];
  const controls = createMobileControls(parent as unknown as HTMLElement, {
    onPan: (dx, dy) => { pans.push([dx, dy]); },
    onSelectScreen: () => { actions.push("select-screen"); },
    onBuildMenu: () => { actions.push("build"); },
    onClearSelection: () => { actions.push("clear"); },
    onStop: () => { actions.push("stop"); },
    onMove: () => { actions.push("move"); },
    onAssault: () => { actions.push("assault"); },
    onOptions: () => { actions.push("options"); },
  });
  const root = controls.root as unknown as TestElement;
  const buttons = root.descendants().filter(element => element.tagName === "BUTTON");
  const button = (action: string) => {
    const element = buttons.find(candidate => candidate.dataset.mobileAction === action);
    assert.ok(element, `Missing button: ${action}`);
    return element;
  };
  const down = (action: string, id = 1, properties = {}) => emit(button(action), "pointerdown", {
    pointerId: id, pointerType: "touch", button: 0, ...properties,
  });
  const up = (action: string, id = 1) => emit(button(action), "pointerup", { pointerId: id });
  const click = (action: string, detail = 0, pointerType = "") => emit(button(action), "click", { detail, pointerType });
  return { document, parent, stage, footer, controls, root, buttons, button, down, up, click, pans, actions };
}

test("deck starts hidden, follows the stage, and uses labelled native 44px-target buttons", t => {
  const f = fixture();
  t.after(() => f.controls.dispose());
  assert.deepEqual(f.parent.children, [f.stage, f.root, f.footer]);
  assert.equal(f.root.id, "mobile-controls");
  assert.equal(f.root.hidden, true);
  assert.equal(f.buttons.length, 11);
  for (const button of f.buttons) {
    assert.equal(button.type, "button");
    assert.ok(button.getAttribute("aria-label"));
    assert.equal(button.disabled, true);
  }
  f.controls.update(READY);
  assert.equal(f.root.hidden, false);
  assert.equal(f.parent.classList.contains("mobile-controls-visible"), true);
  f.controls.update({ ...READY, visible: false });
  assert.equal(f.root.hidden, true);
  assert.equal(f.parent.classList.contains("mobile-controls-visible"), false);
});

test("selection gating, callbacks, pressed modes and live status change only when necessary", t => {
  const f = fixture();
  t.after(() => f.controls.dispose());
  f.controls.update({ ...READY, selectedCount: 0 });
  for (const action of ["clear", "stop", "move", "assault"]) {
    assert.equal(f.button(action).disabled, true);
    f.click(action);
  }
  assert.deepEqual(f.actions, []);
  for (const action of ["select-screen", "build", "options"]) {
    assert.equal(f.button(action).disabled, false);
    f.click(action);
  }
  assert.deepEqual(f.actions, ["select-screen", "build", "options"]);
  f.controls.update(READY);
  for (const action of ["clear", "stop", "move", "assault"]) f.click(action, 1, "touch");
  assert.deepEqual(f.actions.slice(3), ["clear", "stop", "move", "assault"]);
  assert.equal(f.button("move").getAttribute("aria-pressed"), "true");
  assert.equal(f.button("assault").getAttribute("aria-pressed"), "false");
  f.controls.update({ ...READY, orderMode: "context", movementStance: "assault", buildOpen: true });
  assert.equal(f.button("move").getAttribute("aria-pressed"), "false");
  assert.equal(f.button("assault").getAttribute("aria-pressed"), "true");
  assert.equal(f.button("build").getAttribute("aria-expanded"), "true");
  assert.equal(f.button("build").getAttribute("aria-pressed"), "true");
  const status = f.root.descendants().find(element => element.getAttribute("role") === "status")!;
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(status.textContent, "3 selected / Build menu");
  const writes = status.textWrites;
  const attributeWrites = f.buttons.map(button => button.attributeWrites);
  for (let frame = 0; frame < 100; frame += 1) {
    f.controls.update({ ...READY, orderMode: "context", movementStance: "assault", buildOpen: true });
  }
  assert.equal(status.textWrites, writes);
  assert.deepEqual(f.buttons.map(button => button.attributeWrites), attributeWrites);
  f.controls.update({ ...READY, enabled: false });
  assert.ok(f.buttons.every(button => button.disabled));
  const previousActions = f.actions.length;
  for (const button of f.buttons) f.click(button.dataset.mobileAction);
  assert.equal(f.actions.length, previousActions);
  assert.equal(f.pans.length, 0);
  assert.equal(status.textContent, "3 selected / Paused");
});

test("context orders retain movement stance and native dialogs remain callback-only", t => {
  const f = fixture();
  t.after(() => f.controls.dispose());
  for (const movementStance of ["move", "assault"]) {
    f.controls.update({ ...READY, orderMode: "context", movementStance });
    assert.equal(f.button("move").getAttribute("aria-pressed"), String(movementStance === "move"));
    assert.equal(f.button("assault").getAttribute("aria-pressed"), String(movementStance === "assault"));
  }
  assert.equal(f.button("build").getAttribute("aria-haspopup"), "dialog");
  assert.equal(f.button("options").getAttribute("aria-haspopup"), "dialog");
  f.click("build");
  assert.deepEqual(f.actions, ["build"]);
  f.controls.update({ ...READY, enabled: false, buildOpen: true });
  assert.equal(f.button("build").getAttribute("aria-pressed"), "true");
  assert.ok(f.buttons.every(button => button.disabled));
  f.controls.update(READY);
  f.click("options");
  assert.deepEqual(f.actions, ["build", "options"]);
  f.controls.update({ ...READY, enabled: false });
  assert.equal(f.button("build").getAttribute("aria-pressed"), "false");
  assert.ok(f.buttons.every(button => button.disabled));
});

test("brief pan taps move once, up is positive world Y, and keyboard clicks remain usable", t => {
  const f = fixture();
  t.after(() => f.controls.dispose());
  f.controls.update(READY);
  assert.equal(f.down("pan-up").defaultPrevented, true);
  assert.equal(f.button("pan-up").hasPointerCapture(1), true);
  f.up("pan-up");
  assert.deepEqual(f.pans, [[0, 0.35]]);
  assert.equal(f.button("pan-up").hasPointerCapture(1), false);
  f.click("pan-up", 1, "touch");
  f.click("pan-up", 0, "touch");
  assert.equal(f.pans.length, 1);
  f.click("pan-up");
  f.click("pan-left");
  f.click("pan-down");
  assert.deepEqual(f.pans.slice(1), [[0, 0.35], [-0.35, 0], [0, -0.35]]);
  f.down("pan-right", 2, { pointerType: "mouse", button: 2 });
  f.up("pan-right", 2);
  assert.equal(f.pans.length, 4);
});

test("hold pan uses elapsed milliseconds, caps long gaps and never owns an animation timer", t => {
  const f = fixture();
  t.after(() => f.controls.dispose());
  f.controls.update(READY);
  f.down("pan-right");
  f.controls.tick(0);
  f.controls.tick(20);
  f.controls.tick(60);
  f.controls.tick(10_000);
  assert.deepEqual(f.pans, [[0.24, 0], [0.48, 0], [0.96, 0]]);
  f.controls.tick(10_000);
  f.controls.tick(9_000);
  f.controls.tick(NaN);
  f.controls.tick(Infinity);
  assert.equal(f.pans.length, 3);
  f.up("pan-right");
  f.controls.tick(20_000);
  assert.equal(f.pans.length, 3);
  const source = readFileSync(new URL("../../src/ui/mobile-controls.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b(?:setInterval|setTimeout|requestAnimationFrame)\s*\(/);
});

test("multi-touch pans normalized diagonals, releases independently and ignores duplicate directions", t => {
  const f = fixture();
  t.after(() => f.controls.dispose());
  f.controls.update(READY);
  f.down("pan-up", 1);
  f.down("pan-right", 2);
  f.down("pan-up", 3);
  f.controls.tick(0);
  f.controls.tick(50);
  assert.ok(Math.abs(f.pans[0][0] - f.pans[0][1]) < 1e-10);
  assert.ok(Math.abs(Math.hypot(...f.pans[0]) - 0.6) < 1e-10);
  emit(f.button("pan-up"), "pointercancel", { pointerId: 1 });
  assert.equal(f.button("pan-up").classList.contains("is-held"), true);
  emit(f.button("pan-up"), "lostpointercapture", { pointerId: 3 });
  assert.equal(f.button("pan-up").classList.contains("is-held"), false);
  f.controls.tick(100);
  assert.deepEqual(f.pans[1], [0.6, 0]);
  f.up("pan-right", 2);
  f.controls.tick(150);
  assert.equal(f.pans.length, 2);
});

test("opposed directions cancel without producing a spurious tap on release", t => {
  const f = fixture();
  t.after(() => f.controls.dispose());
  f.controls.update(READY);
  f.down("pan-left", 1);
  f.down("pan-right", 2);
  f.controls.tick(0);
  f.controls.tick(50);
  assert.deepEqual(f.pans, []);
  f.up("pan-left", 1);
  assert.deepEqual(f.pans, []);
  f.controls.tick(100);
  assert.deepEqual(f.pans, [[0.6, 0]]);
});

test("all lifecycle cancellations release held pointers and never resume or synthesize taps", t => {
  for (const reason of ["pointercancel", "lostpointercapture", "blur", "visibilitychange", "hidden", "disabled", "cancel"]) {
    const f = fixture();
    t.after(() => f.controls.dispose());
    f.controls.update(READY);
    f.down("pan-up");
    if (reason === "pointercancel" || reason === "lostpointercapture") {
      emit(f.button("pan-up"), reason, { pointerId: 1 });
    } else if (reason === "blur") {
      emit(f.document.defaultView, reason);
    } else if (reason === "visibilitychange") {
      f.document.hidden = true;
      emit(f.document, reason);
      f.document.hidden = false;
      emit(f.document, reason);
    } else if (reason === "hidden") {
      f.controls.update({ ...READY, visible: false });
    } else if (reason === "disabled") {
      f.controls.update({ ...READY, enabled: false });
    } else {
      f.controls.cancel();
    }
    assert.equal(f.button("pan-up").hasPointerCapture(1), false, reason);
    assert.equal(f.button("pan-up").classList.contains("is-held"), false, reason);
    f.controls.update(READY);
    f.controls.tick(0);
    f.controls.tick(100);
    f.up("pan-up");
    f.click("pan-up", 1, "touch");
    assert.deepEqual(f.pans, [], reason);
    f.down("pan-up", 2);
    f.up("pan-up", 2);
    assert.deepEqual(f.pans, [[0, 0.35]], `${reason}: a new gesture works`);
  }
});

test("window release fallback prevents stuck holds when pointer capture is unavailable", t => {
  const f = fixture();
  t.after(() => f.controls.dispose());
  f.controls.update(READY);
  f.button("pan-up").rejectCapture = true;
  f.down("pan-up");
  f.controls.tick(0);
  f.controls.tick(50);
  emit(f.document.defaultView, "pointerup", { pointerId: 1 });
  f.controls.tick(100);
  assert.deepEqual(f.pans, [[0, 0.6]]);
  assert.equal(f.button("pan-up").classList.contains("is-held"), false);
});

test("control pointer, mouse, touch and keyboard events cannot bubble into game handlers", t => {
  const f = fixture();
  t.after(() => f.controls.dispose());
  f.controls.update(READY);
  const types = ["pointerdown", "pointermove", "pointerup", "pointercancel", "lostpointercapture",
    "mousedown", "mousemove", "mouseup", "touchstart", "touchmove", "touchend", "touchcancel",
    "click", "dblclick", "keydown", "keyup", "wheel", "contextmenu", "dragstart"];
  let leaked = 0;
  for (const type of types) f.parent.addEventListener(type, () => { leaked += 1; });
  for (const type of types) emit(f.button("options"), type, { detail: 0, key: "Enter", pointerId: 99 });
  assert.equal(leaked, 0);
  assert.equal(emit(f.button("options"), "keydown", { key: "Tab" }).defaultPrevented, false);
  assert.equal(emit(f.button("options"), "contextmenu").defaultPrevented, true);
});

test("dispose removes the dock, capture and every listener, and is safe to call twice", () => {
  const f = fixture();
  f.controls.update(READY);
  f.down("pan-up");
  assert.ok(f.document.defaultView.listenerCount > 0);
  f.controls.dispose();
  f.controls.dispose();
  assert.equal(f.root.parentElement, null);
  assert.deepEqual(f.parent.children, [f.stage, f.footer]);
  assert.equal(f.parent.classList.contains("mobile-controls-visible"), false);
  assert.equal(f.document.listenerCount, 0);
  assert.equal(f.document.defaultView.listenerCount, 0);
  assert.ok(f.document.elements.every(element => element.listenerCount === 0 && element.captured.size === 0));
  f.controls.update(READY);
  f.controls.tick(0);
  f.controls.tick(100);
  f.up("pan-up");
  f.click("options");
  assert.deepEqual(f.pans, []);
  assert.deepEqual(f.actions, []);
  assert.equal(f.parent.classList.contains("mobile-controls-visible"), false);
});

test("phone stylesheet gates every selector and reserves stage space in both orientations", () => {
  const css = readFileSync(new URL("../../src/ui/mobile-controls.css", import.meta.url), "utf8");
  const selectors = [...css.matchAll(/([^{}]+)\{/g)].map(match => match[1].trim());
  for (const selector of selectors) {
    if (selector.startsWith("@media")) continue;
    for (const item of selector.split(",")) {
      assert.ok(item.trim().startsWith(".asset-lab.phone-controls-enabled.mission-running"), item);
    }
  }
  assert.match(css, /height:\s*100dvh/);
  assert.match(css, /min-height:\s*0/);
  assert.match(css, /grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto/);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+calc\(224px/);
  assert.match(css, /min-width:\s*44px/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /safe-area-inset-right/);
  assert.match(css, /touch-action:\s*none/);
  assert.match(css, /touch-action:\s*manipulation/);
  assert.match(css, /prefers-reduced-motion/);
  const canvas = css.match(/\.asset-lab\.phone-controls-enabled\.mission-running \.preview-panel\.mobile-controls-visible #mission-canvas\s*\{([^}]+)\}/)?.[1];
  assert.ok(canvas, "Canvas touch rules must be scoped to an active phone deck");
  assert.match(canvas, /touch-action:\s*none/);
  assert.match(canvas, /-webkit-touch-callout:\s*none/);
  assert.match(canvas, /user-select:\s*none/);
});

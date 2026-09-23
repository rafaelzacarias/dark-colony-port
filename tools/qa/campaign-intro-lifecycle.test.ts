import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { cancelCampaignIntro, showCampaignIntro } from "../../src/ui/campaign-intro";

class IntroElement extends EventTarget {
  readonly children: IntroElement[] = [];
  readonly selectors = new Map<string, IntroElement>();
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  className = "";
  innerHTML = "";
  textContent = "";
  scrollTop = 0;
  clientHeight = 100;
  scrollHeight = 100;
  isConnected = true;
  closed = false;
  focusCount = 0;
  constructor(readonly tagName = "DIV") { super(); }
  append(...children: IntroElement[]) { this.children.push(...children); }
  appendChild(child: IntroElement) { this.append(child); return child; }
  replaceChildren(...children: IntroElement[]) { this.children.length = 0; this.append(...children); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  querySelector(selector: string): IntroElement {
    if (!this.selectors.has(selector)) {
      const button = selector.match(/data-intro-action="(\w+)"/);
      const element = new IntroElement(button ? "BUTTON" : "DIV");
      if (button) element.dataset.introAction = button[1];
      this.selectors.set(selector, element);
    }
    return this.selectors.get(selector)!;
  }
  querySelectorAll() { return []; }
  closest() { return this.tagName === "BUTTON" ? this : null; }
  showModal() {}
  close() { this.closed = true; }
  remove() { this.isConnected = false; }
  focus() { this.focusCount += 1; }
}

function browserStub() {
  const asset = JSON.parse(readFileSync(new URL("../../public/assets/data/campaign-intro-human.json", import.meta.url), "utf8"));
  const briefing = JSON.parse(readFileSync(new URL("../../public/assets/generated/data/briefings/HUMAN/HUMAN01.json", import.meta.url), "utf8"));
  const body = new IntroElement("BODY");
  const previousFocus = new IntroElement("BUTTON");
  const windowStub = new EventTarget() as EventTarget & { getSelection: () => null };
  windowStub.getSelection = () => null;
  let pagehideListeners = 0;
  const add = windowStub.addEventListener.bind(windowStub);
  const remove = windowStub.removeEventListener.bind(windowStub);
  windowStub.addEventListener = (...args) => { if (args[0] === "pagehide") pagehideListeners += 1; add(...args); };
  windowStub.removeEventListener = (...args) => { if (args[0] === "pagehide") pagehideListeners -= 1; remove(...args); };
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  let current = true;
  let requestSignal: AbortSignal | undefined;
  const globals: Record<string, unknown> = {
    HTMLElement: IntroElement,
    document: {
      body, activeElement: previousFocus,
      createElement: (tag: string) => new IntroElement(tag.toUpperCase()),
      createElementNS: (_namespace: string, tag: string) => new IntroElement(tag.toUpperCase()),
      createTextNode: (text: string) => Object.assign(new IntroElement("TEXT"), { textContent: text }),
    },
    window: windowStub,
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id: number) => { frames.delete(id); },
    fetch: async (_url: string, options: RequestInit) => {
      requestSignal = options.signal ?? undefined;
      return { ok: true, json: async () => asset };
    },
  };
  const descriptors = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  return {
    briefing, body, frames, windowStub, previousFocus,
    isCurrent: () => current,
    stale: () => { current = false; },
    signal: () => requestSignal,
    listeners: () => pagehideListeners,
    frame: () => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(performance.now());
    },
    restore: () => {
      cancelCampaignIntro();
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

function dispatch(dialog: IntroElement, type: "click" | "keydown", target: IntroElement, key?: string) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, { target: { value: target }, key: { value: key } });
  dialog.dispatchEvent(event);
}

test("intro lifecycle: click/Enter/Space finish each full source stage before deploying", async () => {
  const browser = browserStub();
  try {
    const pending = showCampaignIntro(browser);
    await setImmediate();
    const dialog = browser.body.children[0];
    const scene = dialog.querySelector(".campaign-intro-scene");
    dispatch(dialog, "click", scene);
    assert.equal(scene.dataset.stage, "overview");
    dispatch(dialog, "keydown", scene, "Enter");
    assert.equal(scene.dataset.stage, "briefing");
    assert.equal(dialog.querySelector(".campaign-intro-readable").textContent, browser.briefing.plainText);
    dispatch(dialog, "keydown", scene, " ");
    assert.equal(scene.dataset.stage, "briefing");
    dispatch(dialog, "keydown", scene, "Enter");
    assert.equal(await pending, "deploy");
    assert.equal(browser.frames.size, 0);
    assert.equal(browser.listeners(), 0);
    assert.equal(browser.signal()?.aborted, true);
    assert.equal(dialog.isConnected, false);
    assert.equal(dialog.closed, true);
    assert.equal(browser.previousFocus.focusCount, 1);
  } finally { browser.restore(); }
});

test("intro lifecycle: skip, Escape, exit, stale token and pagehide settle and clean up", async () => {
  for (const action of ["skip", "escape", "exit", "stale", "pagehide"] as const) {
    const browser = browserStub();
    try {
      const pending = showCampaignIntro(browser);
      await setImmediate();
      const dialog = browser.body.children[0];
      if (action === "skip") dispatch(dialog, "click", dialog.querySelector('[data-intro-action="skip"]'));
      if (action === "escape") dispatch(dialog, "keydown", dialog, "Escape");
      if (action === "exit") cancelCampaignIntro();
      if (action === "stale") { browser.stale(); browser.frame(); }
      if (action === "pagehide") browser.windowStub.dispatchEvent(new Event("pagehide"));
      assert.equal(await pending, action === "skip" ? "deploy" : "cancel");
      assert.equal(browser.frames.size, 0);
      assert.equal(browser.listeners(), 0);
      assert.equal(browser.signal()?.aborted, true);
      assert.equal(dialog.isConnected, false);
    } finally { browser.restore(); }
  }
});

test("intro lifecycle: new launch aborts the previous intro without removing the replacement", async () => {
  const browser = browserStub();
  try {
    const first = showCampaignIntro(browser);
    await setImmediate();
    const second = showCampaignIntro(browser);
    assert.equal(await first, "cancel");
    await setImmediate();
    assert.equal(browser.body.children[0].isConnected, false);
    assert.equal(browser.body.children[1].isConnected, true);
    assert.equal(browser.listeners(), 1);
    cancelCampaignIntro();
    assert.equal(await second, "cancel");
    assert.equal(browser.frames.size, 0);
    assert.equal(browser.listeners(), 0);
  } finally { browser.restore(); }
});
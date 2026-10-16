import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { campaignIntroTokens } from "../../src/ui/campaign-intro";
import {
  closeEncyclopediaModal,
  ENCYCLOPEDIA_CATEGORY_TABS,
  ENCYCLOPEDIA_TURNTABLE_INTERVAL_MS,
  encyclopediaTokens,
  isEncyclopediaModalOpen,
  loadEncyclopediaData,
  openEncyclopediaModal,
  parseEncyclopediaIndex,
  type EncyclopediaData,
  type EncyclopediaSpriteMetadata,
} from "../../src/ui/encyclopedia";

const repoRoot = new URL("../../", import.meta.url);
const readRepoFile = (relativePath: string): Buffer =>
  readFileSync(new URL(relativePath, repoRoot));
const sha256Hex = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

class StubElement extends EventTarget {
  readonly children: StubElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  readonly classList = {
    classes: new Set<string>(),
    add: (...tokens: string[]) => tokens.forEach((token) => this.classList.classes.add(token)),
    remove: (...tokens: string[]) => tokens.forEach((token) => this.classList.classes.delete(token)),
    contains: (token: string) => this.classList.classes.has(token),
  };
  parentElement: StubElement | null = null;
  className = "";
  textContent = "";
  title = "";
  type = "";
  tabIndex = -1;
  scrollTop = 0;
  width = 0;
  height = 0;
  preload = "";
  muted = false;
  currentTime = 0;
  paused = true;
  src = "";
  playCount = 0;
  pauseCount = 0;
  loadCount = 0;
  isConnected = true;
  open = false;
  closed = false;
  focusCount = 0;
  drawCalls: {
    readonly sx: number;
    readonly sy: number;
    readonly sw: number;
    readonly sh: number;
    readonly dx: number;
    readonly dy: number;
    readonly dw: number;
    readonly dh: number;
  }[] = [];

  constructor(readonly tagName = "DIV") {
    super();
  }

  append(...nodes: (StubElement | string)[]): void {
    for (const node of nodes) {
      if (typeof node === "string") {
        const textNode = new StubElement("#TEXT");
        textNode.textContent = node;
        textNode.parentElement = this;
        this.children.push(textNode);
      } else {
        node.parentElement = this;
        node.isConnected = true;
        this.children.push(node);
      }
    }
  }

  appendChild(node: StubElement): StubElement {
    this.append(node);
    return node;
  }

  replaceChildren(...nodes: (StubElement | string)[]): void {
    for (const child of this.children) {
      child.parentElement = null;
      child.isConnected = false;
    }
    this.children.length = 0;
    this.append(...nodes);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === "src") this.src = value;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
    if (name === "src") this.src = "";
  }

  matches(selector: string): boolean {
    if (selector.startsWith(".")) {
      const targetClass = selector.slice(1);
      return (
        this.className.split(/\s+/).includes(targetClass) ||
        this.classList.contains(targetClass)
      );
    }
    const dataAttr = selector.match(/^\[data-([a-z-]+)(?:="([^"]*)")?\]$/);
    if (dataAttr) {
      const camelKey = dataAttr[1].replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
      const actual = this.dataset[camelKey];
      if (actual === undefined) return false;
      return dataAttr[2] === undefined || actual === dataAttr[2];
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  closest<T extends StubElement = StubElement>(selector: string): T | null {
    let cursor: StubElement | null = this;
    while (cursor) {
      if (cursor.matches(selector)) return cursor as T;
      cursor = cursor.parentElement;
    }
    return null;
  }

  querySelector<T extends StubElement = StubElement>(selector: string): T | null {
    for (const child of this.children) {
      if (child.matches(selector)) return child as T;
      const found = child.querySelector<T>(selector);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll<T extends StubElement = StubElement>(selector: string): T[] {
    const results: T[] = [];
    for (const child of this.children) {
      if (child.matches(selector)) results.push(child as T);
      results.push(...child.querySelectorAll<T>(selector));
    }
    return results;
  }

  getContext(contextId: string) {
    if (contextId !== "2d") return null;
    return {
      clearRect: () => {},
      drawImage: (
        _img: unknown,
        sx: number,
        sy: number,
        sw: number,
        sh: number,
        dx: number,
        dy: number,
        dw: number,
        dh: number,
      ) => {
        this.drawCalls.push({ sx, sy, sw, sh, dx, dy, dw, dh });
      },
    };
  }

  async play(): Promise<void> {
    this.paused = false;
    this.playCount += 1;
  }

  pause(): void {
    this.paused = true;
    this.pauseCount += 1;
  }

  load(): void {
    this.loadCount += 1;
  }

  showModal(): void {
    this.open = true;
  }

  close(): void {
    this.open = false;
    this.closed = true;
  }

  remove(): void {
    this.isConnected = false;
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx >= 0) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }

  focus(): void {
    this.focusCount += 1;
  }
}

class StubImage {
  decoding = "async";
  complete = true;
  naturalWidth = 800;
  naturalHeight = 1000;
  onload: (() => void) | null = null;
  private _src = "";
  get src(): string {
    return this._src;
  }
  set src(value: string) {
    this._src = value;
    queueMicrotask(() => this.onload?.());
  }
}

function createBrowserEnv() {
  const data = JSON.parse(
    readRepoFile("public/assets/data/encyclopedia.json").toString("utf8"),
  ) as EncyclopediaData;
  const body = new StubElement("BODY");
  const previousFocus = new StubElement("BUTTON");
  const windowStub = new EventTarget();
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;

  const globals: Record<string, unknown> = {
    HTMLElement: StubElement,
    Image: StubImage,
    document: {
      body,
      activeElement: previousFocus,
      createElement: (tag: string) => new StubElement(tag.toUpperCase()),
      createTextNode: (text: string) => {
        const node = new StubElement("#TEXT");
        node.textContent = text;
        return node;
      },
    },
    window: windowStub,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame: (id: number) => {
      frames.delete(id);
    },
    fetch: async (url: string) => {
      const cleanPath = url.replace(/^\/+/, "");
      const fullPath = `public/${cleanPath}`;
      if (!existsSync(new URL(fullPath, repoRoot))) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      const json = JSON.parse(readRepoFile(fullPath).toString("utf8"));
      return { ok: true, status: 200, json: async () => json };
    },
  };

  const savedDescriptors = Object.fromEntries(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }

  return {
    data,
    body,
    previousFocus,
    frames,
    stepAnimationFrame: (timestamp: number) => {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const cb of callbacks) cb(timestamp);
    },
    restore: () => {
      closeEncyclopediaModal();
      for (const [key, descriptor] of Object.entries(savedDescriptors)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

function dispatchClick(dialog: StubElement, target: StubElement): void {
  const event = new Event("click", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "target", { value: target });
  dialog.dispatchEvent(event);
}

function dispatchKeydown(dialog: StubElement, key: string): void {
  const event = new Event("keydown", { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    target: { value: dialog },
    key: { value: key },
    ctrlKey: { value: false },
    metaKey: { value: false },
    altKey: { value: false },
  });
  dialog.dispatchEvent(event);
}

test("encyclopedia.json matches raw_cd/DC/INTRFACE/ENCYCLO.TXT, all 25 ENCYCLO/*.TXT hashes, and on-disk assets", () => {
  const data = JSON.parse(
    readRepoFile("public/assets/data/encyclopedia.json").toString("utf8"),
  ) as EncyclopediaData;

  assert.equal(data.schemaVersion, 1);
  assert.equal(data.source.path, "raw_cd/DC/INTRFACE/ENCYCLO.TXT");

  const indexBytes = readRepoFile(data.source.path);
  assert.equal(sha256Hex(indexBytes), data.source.sha256);

  assert.equal(data.background, "/assets/generated/interface/ENCY.GIF");
  const bgBytes = readRepoFile(`public${data.background}`);
  assert.ok(bgBytes.length > 0, "ENCY.GIF exists and is non-empty");

  const expectedIndex = parseEncyclopediaIndex(indexBytes.toString("utf8"));
  assert.equal(expectedIndex.length, 25);
  assert.equal(data.entries.length, 25);

  const alienEntries = data.entries.filter((e) => e.category === "alien");
  const humanEntries = data.entries.filter((e) => e.category === "human");
  const artifactEntries = data.entries.filter((e) => e.category === "artifact");
  assert.equal(alienEntries.length, 10);
  assert.equal(humanEntries.length, 10);
  assert.equal(artifactEntries.length, 5);
  assert.deepEqual(
    artifactEntries.map((e) => e.title),
    ["Tektaara", "Maktor", "Solaris", "LunaTek", "Kaox"],
  );

  data.entries.forEach((entry, idx) => {
    const expected = expectedIndex[idx];
    assert.equal(entry.key, expected.key);
    assert.equal(entry.title, expected.title);
    assert.equal(entry.category, expected.category);

    assert.equal(entry.textSource.path, `raw_cd/DC/ENCYCLO/${entry.key}.TXT`);
    const textBytes = readRepoFile(entry.textSource.path);
    assert.equal(sha256Hex(textBytes), entry.textSource.sha256);

    const rawText = textBytes.toString("utf8");
    assert.deepEqual(entry.tokens, encyclopediaTokens(rawText));
    assert.deepEqual(entry.tokens, campaignIntroTokens(rawText));
    const plainFromTokens = entry.tokens.map((t) => t.text).join("");
    const expectedPlain = rawText.replace(/~\d/g, "").replace(/\r/g, "").trim();
    assert.equal(plainFromTokens, expectedPlain);

    assert.equal(entry.spriteAtlas, `/assets/generated/sprites/ENCYCLO/${entry.key}.png`);
    assert.equal(entry.spriteMetadata, `/assets/generated/sprites/ENCYCLO/${entry.key}.json`);
    assert.equal(entry.audio, `/assets/generated/media/audio/ENCYCLO/${entry.key}.ogg`);

    const atlasBytes = readRepoFile(`public${entry.spriteAtlas}`);
    const metadataBytes = readRepoFile(`public${entry.spriteMetadata}`);
    const audioBytes = readRepoFile(`public${entry.audio}`);
    assert.ok(atlasBytes.length > 0, `Missing or empty ${entry.spriteAtlas}`);
    assert.ok(metadataBytes.length > 0, `Missing or empty ${entry.spriteMetadata}`);
    assert.ok(audioBytes.length > 0, `Missing or empty ${entry.audio}`);

    const spriteMeta = JSON.parse(metadataBytes.toString("utf8")) as EncyclopediaSpriteMetadata;
    assert.ok(spriteMeta.frames.length >= 65, `${entry.key} has turntable frames`);
    assert.equal(spriteMeta.frames[0].width, 320);
    assert.equal(spriteMeta.frames[0].height, 200);
  });
});

test("openEncyclopediaModal renders entries, switches categories/entries, animates turntable, and stops audio on close", async () => {
  const env = createBrowserEnv();
  try {
    const loaded = await loadEncyclopediaData({ forceReload: true });
    assert.equal(loaded.entries.length, 25);

    const modal = await openEncyclopediaModal();
    await setImmediate();

    assert.equal(isEncyclopediaModalOpen(), true);
    const dialog = modal.dialog as unknown as StubElement;
    const audio = modal.audio as unknown as StubElement;
    const canvas = modal.canvas as unknown as StubElement;

    assert.equal(dialog.open, true);
    assert.equal(
      dialog.querySelector(".encyclopedia-scene")?.style.backgroundImage,
      'url("/assets/generated/interface/ENCY.GIF")',
    );

    // Verify all 4 category filter tabs exist
    const tabs = dialog.querySelectorAll("[data-encyclopedia-category]");
    assert.deepEqual(
      tabs.map((tab) => [tab.dataset.encyclopediaCategory, tab.textContent]),
      ENCYCLOPEDIA_CATEGORY_TABS.map((tab) => [tab.id, tab.label]),
    );

    // Initially "All" (25 entries) and first entry "GRAY" ("Gray") selected
    assert.equal( dialog.querySelectorAll("[data-encyclopedia-entry]").length, 25);
    assert.equal(modal.getState().category, "all");
    assert.equal(modal.getState().activeKey, "GRAY");
    assert.equal(dialog.querySelector(".encyclopedia-title")?.textContent, "Gray");
    assert.match(dialog.querySelector(".encyclopedia-readable")?.textContent ?? "", /GRAY WARRIOR/);
    assert.equal(audio.src, "/assets/generated/media/audio/ENCYCLO/GRAY.ogg");
    assert.equal(audio.paused, false);
    assert.equal(canvas.width, 320);
    assert.equal(canvas.height, 200);
    assert.equal(canvas.dataset.key, "GRAY");
    assert.equal(canvas.dataset.frameIndex, "1");
    assert.equal(canvas.dataset.anchorX, "131");
    assert.equal(canvas.dataset.anchorY, "21");
    assert.ok(canvas.drawCalls.length > 0);
    assert.equal(canvas.drawCalls.at(-1)?.dx, 131);
    assert.equal(canvas.drawCalls.at(-1)?.dy, 21);

    // Advance turntable animation frame
    env.stepAnimationFrame( performance.now() + ENCYCLOPEDIA_TURNTABLE_INTERVAL_MS * 2 + 10);
    assert.notEqual(canvas.dataset.frameIndex, "1");

    // Toggle turntable to static view
    const toggleBtn = dialog.querySelector('[data-encyclopedia-action="toggle-turntable"]')!;
    dispatchClick(dialog, toggleBtn);
    assert.equal(modal.getState().viewMode, "static");

    // Switch category to "human" -> 10 human entries, selects "TROOP" ("Trooper") and plays TROOP.ogg
    const humanTab = dialog.querySelector('[data-encyclopedia-category="human"]')!;
    const prevPauseCount = audio.pauseCount;
    dispatchClick(dialog, humanTab);
    await setImmediate();

    assert.equal(modal.getState().category, "human");
    assert.equal(dialog.querySelectorAll("[data-encyclopedia-entry]").length, 10);
    assert.equal(modal.getState().activeKey, "TROOP");
    assert.equal(dialog.querySelector(".encyclopedia-title")?.textContent, "Trooper");
    assert.ok(audio.pauseCount > prevPauseCount, "Stopped previous GRAY audio before playing TROOP");
    assert.equal(audio.src, "/assets/generated/media/audio/ENCYCLO/TROOP.ogg");
    assert.equal(audio.paused, false);

    // Click another entry in the Human category ("CYBO" -> "S.A.R.G.E")
    const cyboButton = dialog.querySelector('[data-encyclopedia-entry="CYBO"]')!;
    dispatchClick(dialog, cyboButton);
    await setImmediate();

    assert.equal(modal.getState().activeKey, "CYBO");
    assert.equal(dialog.querySelector(".encyclopedia-title")?.textContent, "S.A.R.G.E");
    assert.match(dialog.querySelector(".encyclopedia-readable")?.textContent ?? "", /REMOTE ASSASSINATION CYBORG/);
    assert.equal(audio.src, "/assets/generated/media/audio/ENCYCLO/CYBO.ogg");
    assert.equal(canvas.dataset.key, "CYBO");

    // Switch category to "artifact" -> 5 artifact entries, selects "TKT" ("Tektaara")
    const artifactTab = dialog.querySelector('[data-encyclopedia-category="artifact"]')!;
    dispatchClick(dialog, artifactTab);
    await setImmediate();

    assert.equal(modal.getState().category, "artifact");
    assert.equal(dialog.querySelectorAll("[data-encyclopedia-entry]").length, 5);
    assert.equal(modal.getState().activeKey, "TKT");
    assert.equal(dialog.querySelector(".encyclopedia-title")?.textContent, "Tektaara");
    assert.equal(audio.src, "/assets/generated/media/audio/ENCYCLO/TKT.ogg");

    // Replay narration button works
    const playCountBeforeNarrate = audio.playCount;
    const narrateBtn = dialog.querySelector('[data-encyclopedia-action="narrate"]')!;
    dispatchClick(dialog, narrateBtn);
    await setImmediate();
    assert.equal(audio.playCount, playCountBeforeNarrate + 1);

    // Close modal via Escape key -> stops audio, cleans up RAF & DOM, restores focus
    dispatchKeydown(dialog, "Escape");
    await modal.closed;

    assert.equal(isEncyclopediaModalOpen(), false);
    assert.equal(audio.paused, true);
    assert.equal(audio.src, "");
    assert.equal(env.frames.size, 0);
    assert.equal(dialog.closed, true);
    assert.equal(dialog.isConnected, false);
    assert.equal(env.previousFocus.focusCount, 1);

    // Reopen with initialKey and close via Back/Close button
    const secondModal = await openEncyclopediaModal({ initialKey: "ENGI" });
    await setImmediate();
    const secondDialog = secondModal.dialog as unknown as StubElement;
    const secondAudio = secondModal.audio as unknown as StubElement;
    assert.equal(secondModal.getState().activeKey, "ENGI");
    assert.equal(secondDialog.querySelector(".encyclopedia-title")?.textContent, "Sentinel");
    assert.equal(secondAudio.src, "/assets/generated/media/audio/ENCYCLO/ENGI.ogg");
    assert.equal(secondAudio.paused, false);

    const closeBtn = secondDialog.querySelector('[data-encyclopedia-action="close"]')!;
    dispatchClick(secondDialog, closeBtn);
    await secondModal.closed;
    assert.equal(secondAudio.paused, true);
    assert.equal(secondAudio.src, "");
    assert.equal(secondDialog.closed, true);
    assert.equal(secondDialog.isConnected, false);
  } finally {
    env.restore();
  }
});

test("main.ts wires Encyclopedia styles, button, and modal opener", () => {
  const mainSource = readRepoFile("src/main.ts").toString("utf8");
  assert.match(mainSource, /import "\.\/ui\/encyclopedia\.css";/);
  assert.match(mainSource, /openEncyclopediaModal/);
  assert.match(mainSource, /data-open-encyclopedia/);
});


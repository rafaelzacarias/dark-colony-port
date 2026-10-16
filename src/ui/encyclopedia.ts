import { assetUrl } from "../asset-url";

export type EncyclopediaCategory = "alien" | "human" | "artifact";
export type EncyclopediaFilterCategory = "all" | EncyclopediaCategory;
export type EncyclopediaViewMode = "turntable" | "static";

export interface EncyclopediaToken {
  readonly style: number;
  readonly text: string;
}

export interface EncyclopediaEntry {
  readonly key: string;
  readonly title: string;
  readonly category: EncyclopediaCategory;
  readonly textSource: {
    readonly path: string;
    readonly sha256: string;
  };
  readonly tokens: readonly EncyclopediaToken[];
  readonly spriteAtlas: string;
  readonly spriteMetadata: string;
  readonly audio: string;
}

export interface EncyclopediaData {
  readonly schemaVersion: 1;
  readonly source: {
    readonly path: string;
    readonly sha256: string;
  };
  readonly background: string;
  readonly entries: readonly EncyclopediaEntry[];
}

export interface EncyclopediaSpriteFrame {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly encodedBytes?: number;
  readonly empty: boolean;
}

export interface EncyclopediaSpriteMetadata {
  readonly schemaVersion?: number;
  readonly atlas?: {
    readonly file: string;
    readonly width: number;
    readonly height: number;
  };
  readonly frames: readonly EncyclopediaSpriteFrame[];
}

export const ENCYCLOPEDIA_CATEGORY_TABS: readonly {
  readonly id: EncyclopediaFilterCategory;
  readonly label: string;
}[] = [
  { id: "all", label: "All" },
  { id: "human", label: "Human" },
  { id: "alien", label: "Taar / Alien" },
  { id: "artifact", label: "Corporations & Artifacts" },
] as const;

export const ENCYCLOPEDIA_TURNTABLE_INTERVAL_MS = 80;

export function encyclopediaTokens(raw: string): EncyclopediaToken[] {
  const tokens: EncyclopediaToken[] = [];
  let style = 4;
  for (const part of raw.replace(/\r/g, "").trim().split(/(~\d)/)) {
    if (/^~\d$/.test(part)) style = Number(part[1]);
    else if (part) tokens.push({ style, text: part });
  }
  return tokens;
}

export function parseEncyclopediaIndex(raw: string): {
  readonly key: string;
  readonly title: string;
  readonly category: EncyclopediaCategory;
  readonly index: number;
}[] {
  const lines = raw
    .replace(/\r/g, "")
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const categories: readonly EncyclopediaCategory[] = ["alien", "human", "artifact"];
  const parsed: {
    readonly key: string;
    readonly title: string;
    readonly category: EncyclopediaCategory;
    readonly index: number;
  }[] = [];
  let cursor = 0;
  for (const category of categories) {
    if (cursor >= lines.length) break;
    const count = Number(lines[cursor++]);
    for (let i = 0; i < count && cursor + 2 < lines.length; i++) {
      const titleLine = lines[cursor++];
      const pathLine = lines[cursor++];
      const indexLine = lines[cursor++];
      const title = titleLine.replace(/:$/, "").trim();
      const key = pathLine.replace(/^encyclo\//i, "").trim().toUpperCase();
      parsed.push({ key, title, category, index: Number(indexLine) });
    }
  }
  return parsed;
}

let cachedDataPromise: Promise<EncyclopediaData> | undefined;
const spriteMetadataCache = new Map<string, Promise<EncyclopediaSpriteMetadata>>();

export async function loadEncyclopediaData(
  options?: { readonly signal?: AbortSignal; readonly forceReload?: boolean } | AbortSignal,
): Promise<EncyclopediaData> {
  const signal = options instanceof AbortSignal ? options : options?.signal;
  const forceReload = options instanceof AbortSignal ? false : Boolean(options?.forceReload);
  if (!forceReload && !signal && cachedDataPromise) {
    return await cachedDataPromise;
  }
  const request = (async () => {
    const response = await fetch(assetUrl("/assets/data/encyclopedia.json"), signal ? { signal } : undefined);
    if (!response.ok) {
      throw new Error(`Encyclopedia data unavailable (${response.status})`);
    }
    const data = (await response.json()) as EncyclopediaData;
    if (data.schemaVersion !== 1 || !Array.isArray(data.entries) || data.entries.length === 0) {
      throw new Error("Invalid encyclopedia asset");
    }
    return data;
  })();
  if (!signal) {
    cachedDataPromise = request;
    request.catch(() => {
      if (cachedDataPromise === request) cachedDataPromise = undefined;
    });
  }
  return await request;
}

export async function loadEncyclopediaSpriteMetadata(
  metadataPath: string,
  signal?: AbortSignal,
): Promise<EncyclopediaSpriteMetadata> {
  if (!signal && spriteMetadataCache.has(metadataPath)) {
    return await spriteMetadataCache.get(metadataPath)!;
  }
  const request = (async () => {
    const response = await fetch(assetUrl(metadataPath), signal ? { signal } : undefined);
    if (!response.ok) {
      throw new Error(`Encyclopedia sprite metadata unavailable (${response.status})`);
    }
    const metadata = (await response.json()) as EncyclopediaSpriteMetadata;
    if (!Array.isArray(metadata.frames) || metadata.frames.length === 0) {
      throw new Error(`Invalid encyclopedia sprite metadata: ${metadataPath}`);
    }
    return metadata;
  })();
  if (!signal) {
    spriteMetadataCache.set(metadataPath, request);
    request.catch(() => {
      if (spriteMetadataCache.get(metadataPath) === request) {
        spriteMetadataCache.delete(metadataPath);
      }
    });
  }
  return await request;
}

export interface EncyclopediaModalOptions {
  readonly parent?: HTMLElement;
  readonly data?: EncyclopediaData;
  readonly initialCategory?: EncyclopediaFilterCategory;
  readonly initialKey?: string;
  readonly initialViewMode?: EncyclopediaViewMode;
  readonly muted?: boolean;
  readonly autoplayAudio?: boolean;
  readonly onMutedChange?: (muted: boolean) => void;
  readonly onClose?: () => void;
}

export interface EncyclopediaModalHandle {
  readonly dialog: HTMLDialogElement;
  readonly audio: HTMLAudioElement;
  readonly canvas: HTMLCanvasElement;
  readonly closed: Promise<void>;
  readonly close: () => void;
  readonly selectCategory: (category: EncyclopediaFilterCategory) => void;
  readonly selectEntry: (key: string) => void;
  readonly setViewMode: (mode: EncyclopediaViewMode) => void;
  readonly stepFrame: (delta: number) => void;
  readonly playNarration: () => Promise<void>;
  readonly stopNarration: () => void;
  readonly getState: () => {
    readonly category: EncyclopediaFilterCategory;
    readonly activeKey: string;
    readonly viewMode: EncyclopediaViewMode;
    readonly frameIndex: number;
    readonly muted: boolean;
    readonly audioPlaying: boolean;
  };
}

let activeModalClose: (() => void) | undefined;

export function closeEncyclopediaModal(): void {
  activeModalClose?.();
}

export function isEncyclopediaModalOpen(): boolean {
  return activeModalClose !== undefined;
}

function categoryBadgeLabel(category: EncyclopediaCategory): string {
  if (category === "human") return "HUMAN COLONIAL FORCES";
  if (category === "alien") return "TAAR / ALIEN FORCES";
  return "CORPORATIONS & ARTIFACTS";
}

export async function openEncyclopediaModal(
  options: EncyclopediaModalOptions = {},
): Promise<EncyclopediaModalHandle> {
  closeEncyclopediaModal();

  const controller = new AbortController();
  const { signal } = controller;
  const previousFocus = typeof document !== "undefined" ? document.activeElement : null;
  const parent = options.parent ?? document.body;

  let closedResolved = false;
  let resolveClosed: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const dialog = document.createElement("dialog");
  dialog.className = "encyclopedia-modal";
  dialog.setAttribute("aria-label", "Dark Colony Encyclopedia");

  const scene = document.createElement("div");
  scene.className = "encyclopedia-scene";
  scene.style.backgroundImage = `url("${assetUrl("/assets/generated/interface/ENCY.GIF")}")`;

  // Left header (entry title & category label inside top-left box of ENCY.GIF)
  const header = document.createElement("header");
  header.className = "encyclopedia-header";
  const categoryBadge = document.createElement("p");
  categoryBadge.className = "encyclopedia-category-badge";
  const titleHeading = document.createElement("h1");
  titleHeading.className = "encyclopedia-title";
  header.append(categoryBadge, titleHeading);

  // Left description panel (scrollable styled ~0..~9 tokens inside bottom-left box of ENCY.GIF)
  const descriptionRegion = document.createElement("div");
  descriptionRegion.className = "encyclopedia-description";
  descriptionRegion.tabIndex = 0;
  descriptionRegion.setAttribute("role", "region");
  descriptionRegion.setAttribute("aria-label", "Encyclopedia entry description");
  const readableText = document.createElement("div");
  readableText.className = "encyclopedia-readable";
  const styledTokens = document.createElement("div");
  styledTokens.className = "encyclopedia-tokens";
  descriptionRegion.append(readableText, styledTokens);

  // Top-right 320x200 sprite viewport (Frame 0 bounds + Frames 1..N rotating turntable)
  const viewport = document.createElement("div");
  viewport.className = "encyclopedia-viewport";
  const canvas = document.createElement("canvas");
  canvas.className = "encyclopedia-canvas";
  canvas.width = 320;
  canvas.height = 200;
  canvas.setAttribute("aria-label", "Unit 3D turntable preview");
  const spriteFrame = document.createElement("div");
  spriteFrame.className = "encyclopedia-sprite-frame";
  spriteFrame.setAttribute("aria-hidden", "true");
  viewport.append(canvas, spriteFrame);

  // Transport & narration bar below the 320x200 viewport
  const transport = document.createElement("div");
  transport.className = "encyclopedia-transport";

  const makeActionButton = (action: string, label: string, title: string): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "encyclopedia-action-button";
    button.dataset.encyclopediaAction = action;
    button.textContent = label;
    button.title = title;
    button.setAttribute("aria-label", title);
    return button;
  };

  const prevEntryButton = makeActionButton("prev-entry", "◀ Prev", "Previous encyclopedia entry");
  const nextEntryButton = makeActionButton("next-entry", "Next ▶", "Next encyclopedia entry");
  const prevFrameButton = makeActionButton("prev-frame", "⟲", "Rotate angle counter-clockwise");
  const turntableButton = makeActionButton("toggle-turntable", "360° Rotate", "Toggle 3D turntable rotation");
  const nextFrameButton = makeActionButton("next-frame", "⟳", "Rotate angle clockwise");
  const narrateButton = makeActionButton("narrate", "🔊 Narrate", "Play voice narration");
  const muteButton = makeActionButton("mute", "Sound: On", "Toggle voice narration mute");

  transport.append(
    prevEntryButton,
    prevFrameButton,
    turntableButton,
    nextFrameButton,
    nextEntryButton,
    narrateButton,
    muteButton,
  );

  // Right-bottom browser: category filter tabs + entry list
  const browserPanel = document.createElement("section");
  browserPanel.className = "encyclopedia-browser";
  browserPanel.setAttribute("aria-label", "Encyclopedia index");

  const tabsNav = document.createElement("div");
  tabsNav.className = "encyclopedia-tabs";
  tabsNav.setAttribute("role", "tablist");
  tabsNav.setAttribute("aria-label", "Encyclopedia categories");

  const tabButtons = new Map<EncyclopediaFilterCategory, HTMLButtonElement>();
  for (const tab of ENCYCLOPEDIA_CATEGORY_TABS) {
    const tabButton = document.createElement("button");
    tabButton.type = "button";
    tabButton.className = "encyclopedia-tab";
    tabButton.setAttribute("role", "tab");
    tabButton.dataset.encyclopediaCategory = tab.id;
    tabButton.textContent = tab.label;
    tabButtons.set(tab.id, tabButton);
    tabsNav.append(tabButton);
  }

  const entriesList = document.createElement("div");
  entriesList.className = "encyclopedia-entries";
  entriesList.setAttribute("role", "group");
  entriesList.setAttribute("aria-label", "Encyclopedia entries");

  browserPanel.append(tabsNav, entriesList);

  // Footer with authentic BACK button
  const footer = document.createElement("footer");
  footer.className = "encyclopedia-footer";
  const closeButton = makeActionButton("close", "Back", "Close Encyclopedia (Escape)");
  closeButton.classList.add("encyclopedia-close");
  footer.append(closeButton);

  // Hidden audio element for OGG voice narration
  const audio = document.createElement("audio");
  audio.className = "encyclopedia-audio";
  audio.preload = "auto";

  scene.append(header, descriptionRegion, viewport, transport, browserPanel, footer, audio);
  dialog.append(scene);

  let categoryFilter: EncyclopediaFilterCategory = options.initialCategory ?? "all";
  let viewMode: EncyclopediaViewMode = options.initialViewMode ?? "turntable";
  let muted = Boolean(options.muted);
  const autoplayAudio = options.autoplayAudio ?? true;
  let audioPlaying = false;
  let activeKey = "";
  let entries: readonly EncyclopediaEntry[] = [];
  const entryButtons = new Map<string, HTMLButtonElement>();

  let currentMetadata: EncyclopediaSpriteMetadata | undefined;
  let currentImage: HTMLImageElement | undefined;
  let currentTurntableIndex = 0;
  let lastFrameTimestamp = 0;
  let animationFrameId = 0;
  let spriteLoadToken = 0;

  const stopNarration = (): void => {
    audioPlaying = false;
    narrateButton.dataset.playing = "false";
    try {
      audio.pause();
    } catch {
      // Ignore pause errors in stub environments
    }
    try {
      audio.currentTime = 0;
    } catch {
      // Ignore currentTime errors in stub environments
    }
  };

  const updateMuteUI = (): void => {
    audio.muted = muted;
    muteButton.textContent = muted ? "Sound: Off" : "Sound: On";
    muteButton.setAttribute("aria-pressed", String(!muted));
  };

  const updateTurntableUI = (): void => {
    const rotating = viewMode === "turntable";
    turntableButton.textContent = rotating ? "360° Rotate" : "Static View";
    turntableButton.setAttribute("aria-pressed", String(rotating));
    viewport.dataset.viewMode = viewMode;
    canvas.dataset.turntable = String(rotating);
  };

  const playNarration = async (): Promise<void> => {
    if (signal.aborted || !activeKey) return;
    const entry = entries.find((item) => item.key === activeKey);
    if (!entry) return;
    const expectedSrc = assetUrl(entry.audio);
    if (audio.getAttribute("src") !== expectedSrc) {
      audio.src = expectedSrc;
      audio.setAttribute("src", expectedSrc);
    }
    audio.dataset.key = entry.key;
    audio.muted = muted;
    try {
      audio.currentTime = 0;
    } catch {
      // Ignore in stub environments
    }
    try {
      audioPlaying = true;
      narrateButton.dataset.playing = "true";
      await audio.play();
    } catch {
      audioPlaying = false;
      narrateButton.dataset.playing = "false";
    }
  };

  audio.addEventListener(
    "ended",
    () => {
      audioPlaying = false;
      narrateButton.dataset.playing = "false";
    },
    { signal },
  );

  const getTurntableFrames = (metadata: EncyclopediaSpriteMetadata): readonly EncyclopediaSpriteFrame[] => {
    const rotating = metadata.frames.slice(1).filter((frame) => !frame.empty && frame.width > 0 && frame.height > 0);
    return rotating.length > 0 ? rotating : metadata.frames.filter((frame) => !frame.empty);
  };

  const paintCurrentSpriteFrame = (): void => {
    const entry = entries.find((item) => item.key === activeKey);
    if (!entry || !currentMetadata) return;

    const baseFrame = currentMetadata.frames[0] ?? {
      index: 0,
      x: 0,
      y: 0,
      width: 320,
      height: 200,
      anchorX: 0,
      anchorY: 0,
      empty: false,
    };
    const viewportWidth = baseFrame.width || 320;
    const viewportHeight = baseFrame.height || 200;
    if (canvas.width !== viewportWidth) canvas.width = viewportWidth;
    if (canvas.height !== viewportHeight) canvas.height = viewportHeight;

    const turntableFrames = getTurntableFrames(currentMetadata);
    const activeFrame =
      turntableFrames[currentTurntableIndex % Math.max(1, turntableFrames.length)] ?? baseFrame;

    const atlasUrl = assetUrl(entry.spriteAtlas);
    canvas.dataset.key = entry.key;
    canvas.dataset.spriteAtlas = atlasUrl;
    canvas.dataset.spriteMetadata = assetUrl(entry.spriteMetadata);
    canvas.dataset.frameIndex = String(activeFrame.index);
    canvas.dataset.frameCount = String(turntableFrames.length);
    canvas.dataset.anchorX = String(activeFrame.anchorX);
    canvas.dataset.anchorY = String(activeFrame.anchorY);
    viewport.dataset.frameIndex = String(activeFrame.index);

    // Update CSS sprite overlay/fallback positioned at anchorX/anchorY inside 320x200 viewport
    spriteFrame.style.left = `${(activeFrame.anchorX / viewportWidth) * 100}%`;
    spriteFrame.style.top = `${(activeFrame.anchorY / viewportHeight) * 100}%`;
    spriteFrame.style.width = `${(activeFrame.width / viewportWidth) * 100}%`;
    spriteFrame.style.height = `${(activeFrame.height / viewportHeight) * 100}%`;
    spriteFrame.style.backgroundImage = `url("${atlasUrl}")`;
    spriteFrame.style.backgroundPosition = `-${activeFrame.x}px -${activeFrame.y}px`;

    // Draw on 2D canvas when available and image is decoded
    const ctx = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
    if (ctx) {
      ctx.clearRect(0, 0, viewportWidth, viewportHeight);
      if (currentImage && currentImage.complete && currentImage.naturalWidth > 0) {
        ctx.drawImage(
          currentImage,
          activeFrame.x,
          activeFrame.y,
          activeFrame.width,
          activeFrame.height,
          activeFrame.anchorX,
          activeFrame.anchorY,
          activeFrame.width,
          activeFrame.height,
        );
        spriteFrame.dataset.canvasRendered = "true";
      } else {
        spriteFrame.dataset.canvasRendered = "false";
      }
    }
  };

  const loadEntrySprite = async (entry: EncyclopediaEntry): Promise<void> => {
    const token = ++spriteLoadToken;
    const atlasUrl = assetUrl(entry.spriteAtlas);
    const metadataUrl = assetUrl(entry.spriteMetadata);
    canvas.dataset.key = entry.key;
    canvas.dataset.spriteAtlas = atlasUrl;
    canvas.dataset.spriteMetadata = metadataUrl;
    currentMetadata = undefined;
    currentImage = undefined;
    currentTurntableIndex = 0;

    if (typeof Image !== "undefined") {
      const img = new Image();
      img.decoding = "async";
      img.src = atlasUrl;
      img.onload = () => {
        if (token !== spriteLoadToken || signal.aborted) return;
        currentImage = img;
        paintCurrentSpriteFrame();
      };
      currentImage = img;
    }

    try {
      const metadata = await loadEncyclopediaSpriteMetadata(entry.spriteMetadata, signal);
      if (token !== spriteLoadToken || signal.aborted) return;
      currentMetadata = metadata;
      currentTurntableIndex = 0;
      lastFrameTimestamp = typeof performance !== "undefined" ? performance.now() : 0;
      paintCurrentSpriteFrame();
    } catch {
      if (token !== spriteLoadToken || signal.aborted) return;
    }
  };

  const renderDescription = (entry: EncyclopediaEntry): void => {
    categoryBadge.textContent = categoryBadgeLabel(entry.category);
    titleHeading.textContent = entry.title;
    readableText.textContent = entry.tokens.map((token) => token.text).join("");
    const spans = entry.tokens.map((token) => {
      const span = document.createElement("span");
      span.className = `encyclopedia-ink-${token.style}`;
      span.textContent = token.text;
      return span;
    });
    styledTokens.replaceChildren(...spans);
    descriptionRegion.scrollTop = 0;
  };

  const visibleEntries = (): readonly EncyclopediaEntry[] =>
    categoryFilter === "all"
      ? entries
      : entries.filter((entry) => entry.category === categoryFilter);

  const renderEntryList = (): void => {
    for (const [catId, button] of tabButtons.entries()) {
      const active = catId === categoryFilter;
      button.setAttribute("aria-selected", String(active));
      button.dataset.active = String(active);
    }

    const filtered = visibleEntries();
    entryButtons.clear();
    const buttons = filtered.map((entry) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "encyclopedia-entry-button";
      button.dataset.encyclopediaEntry = entry.key;
      button.dataset.category = entry.category;
      const active = entry.key === activeKey;
      button.dataset.active = String(active);
      button.setAttribute("aria-current", active ? "true" : "false");
      button.textContent = entry.title;
      entryButtons.set(entry.key, button);
      return button;
    });
    entriesList.replaceChildren(...buttons);
  };

  const selectEntry = (key: string): void => {
    const normalizedKey = key.trim().toUpperCase();
    const entry = entries.find((item) => item.key === normalizedKey);
    if (!entry) return;

    const changed = activeKey !== entry.key;
    activeKey = entry.key;
    scene.dataset.activeEntry = entry.key;
    scene.dataset.activeCategory = entry.category;

    for (const [entryKey, button] of entryButtons.entries()) {
      const isSelected = entryKey === entry.key;
      button.dataset.active = String(isSelected);
      button.setAttribute("aria-current", isSelected ? "true" : "false");
    }

    renderDescription(entry);
    void loadEntrySprite(entry);

    if (changed) {
      stopNarration();
      const audioSrc = assetUrl(entry.audio);
      audio.src = audioSrc;
      audio.setAttribute("src", audioSrc);
      audio.dataset.key = entry.key;
      if (autoplayAudio && !muted) {
        void playNarration();
      }
    }
  };

  const selectCategory = (nextCategory: EncyclopediaFilterCategory): void => {
    categoryFilter = nextCategory;
    scene.dataset.categoryFilter = nextCategory;
    const filtered = visibleEntries();
    renderEntryList();
    if (!filtered.some((entry) => entry.key === activeKey) && filtered.length > 0) {
      selectEntry(filtered[0].key);
    }
  };

  const setViewMode = (mode: EncyclopediaViewMode): void => {
    viewMode = mode;
    updateTurntableUI();
    paintCurrentSpriteFrame();
  };

  const stepFrame = (delta: number): void => {
    if (!currentMetadata) return;
    const frames = getTurntableFrames(currentMetadata);
    if (frames.length === 0) return;
    viewMode = "static";
    updateTurntableUI();
    currentTurntableIndex =
      ((currentTurntableIndex + delta) % frames.length + frames.length) % frames.length;
    paintCurrentSpriteFrame();
  };

  const stepEntry = (delta: number): void => {
    const filtered = visibleEntries();
    if (filtered.length === 0) return;
    const currentIdx = Math.max(0, filtered.findIndex((item) => item.key === activeKey));
    const nextIdx = ((currentIdx + delta) % filtered.length + filtered.length) % filtered.length;
    selectEntry(filtered[nextIdx].key);
  };

  const cleanup = (): void => {
    if (closedResolved) return;
    closedResolved = true;
    controller.abort();
    if (typeof cancelAnimationFrame === "function" && animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = 0;
    }
    stopNarration();
    audio.removeAttribute("src");
    audio.src = "";
    if (typeof audio.load === "function") {
      try {
        audio.load();
      } catch {
        // Ignore in stub environments
      }
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", onPageHide);
    }
    try {
      dialog.close();
    } catch {
      // Ignore if already closed
    }
    dialog.remove();
    if (activeModalClose === cleanup) {
      activeModalClose = undefined;
    }
    if (previousFocus && typeof (previousFocus as HTMLElement).focus === "function") {
      const focusTarget = previousFocus as HTMLElement & { isConnected?: boolean };
      if (focusTarget.isConnected !== false) {
        focusTarget.focus();
      }
    }
    options.onClose?.();
    resolveClosed();
  };

  const onPageHide = (): void => cleanup();
  activeModalClose = cleanup;

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", onPageHide);
  }

  dialog.addEventListener(
    "click",
    (event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target === dialog) {
        cleanup();
        return;
      }
      const tabButton =
        typeof target.closest === "function"
          ? target.closest<HTMLButtonElement>("[data-encyclopedia-category]")
          : target.dataset?.encyclopediaCategory
            ? (target as HTMLButtonElement)
            : null;
      if (tabButton?.dataset.encyclopediaCategory) {
        selectCategory(tabButton.dataset.encyclopediaCategory as EncyclopediaFilterCategory);
        return;
      }

      const entryButton =
        typeof target.closest === "function"
          ? target.closest<HTMLButtonElement>("[data-encyclopedia-entry]")
          : target.dataset?.encyclopediaEntry
            ? (target as HTMLButtonElement)
            : null;
      if (entryButton?.dataset.encyclopediaEntry) {
        selectEntry(entryButton.dataset.encyclopediaEntry);
        return;
      }

      const actionButton =
        typeof target.closest === "function"
          ? target.closest<HTMLButtonElement>("[data-encyclopedia-action]")
          : target.dataset?.encyclopediaAction
            ? (target as HTMLButtonElement)
            : null;
      if (!actionButton?.dataset.encyclopediaAction) return;

      const action = actionButton.dataset.encyclopediaAction;
      if (action === "close") {
        cleanup();
      } else if (action === "narrate") {
        void playNarration();
      } else if (action === "mute") {
        muted = !muted;
        updateMuteUI();
        if (muted) stopNarration();
        options.onMutedChange?.(muted);
      } else if (action === "toggle-turntable") {
        setViewMode(viewMode === "turntable" ? "static" : "turntable");
      } else if (action === "prev-frame") {
        stepFrame(-1);
      } else if (action === "next-frame") {
        stepFrame(1);
      } else if (action === "prev-entry") {
        stepEntry(-1);
      } else if (action === "next-entry") {
        stepEntry(1);
      }
    },
    { signal },
  );

  dialog.addEventListener(
    "keydown",
    (event) => {
      const keyEvent = event as KeyboardEvent;
      if (keyEvent.ctrlKey || keyEvent.metaKey || keyEvent.altKey) return;
      if (keyEvent.key === "Escape") {
        event.preventDefault();
        cleanup();
      } else if (keyEvent.key === "ArrowLeft") {
        stepFrame(-1);
      } else if (keyEvent.key === "ArrowRight") {
        stepFrame(1);
      }
    },
    { signal },
  );

  dialog.addEventListener(
    "cancel",
    (event) => {
      event.preventDefault();
      cleanup();
    },
    { signal },
  );

  updateMuteUI();
  updateTurntableUI();
  parent.append(dialog);
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  }
  closeButton.focus();

  const tick = (now: number): void => {
    if (signal.aborted) return;
    if (viewMode === "turntable" && currentMetadata) {
      const frames = getTurntableFrames(currentMetadata);
      if (frames.length > 1 && now - lastFrameTimestamp >= ENCYCLOPEDIA_TURNTABLE_INTERVAL_MS) {
        const steps = Math.max(1, Math.floor((now - lastFrameTimestamp) / ENCYCLOPEDIA_TURNTABLE_INTERVAL_MS));
        currentTurntableIndex = (currentTurntableIndex + steps) % frames.length;
        lastFrameTimestamp = now;
        paintCurrentSpriteFrame();
      }
    }
    if (typeof requestAnimationFrame === "function") {
      animationFrameId = requestAnimationFrame(tick);
    }
  };

  if (typeof requestAnimationFrame === "function") {
    animationFrameId = requestAnimationFrame(tick);
  }

  try {
    const loadedData = options.data ?? (await loadEncyclopediaData(signal));
    if (!signal.aborted) {
      scene.style.backgroundImage = `url("${assetUrl(loadedData.background)}")`;
      entries = loadedData.entries;
      renderEntryList();
      const filtered = visibleEntries();
      const requestedKey = options.initialKey?.trim().toUpperCase();
      const initialEntry =
        (requestedKey ? entries.find((item) => item.key === requestedKey) : undefined) ??
        filtered[0] ??
        entries[0];
      if (initialEntry) {
        selectEntry(initialEntry.key);
      }
    }
  } catch (error) {
    if (!signal.aborted) {
      cleanup();
      throw error;
    }
  }

  return {
    dialog,
    audio,
    canvas,
    closed,
    close: cleanup,
    selectCategory,
    selectEntry,
    setViewMode,
    stepFrame,
    playNarration,
    stopNarration,
    getState: () => {
      const frames = currentMetadata ? getTurntableFrames(currentMetadata) : [];
      const activeFrame = frames[currentTurntableIndex % Math.max(1, frames.length)];
      return {
        category: categoryFilter,
        activeKey,
        viewMode,
        frameIndex: activeFrame?.index ?? 0,
        muted,
        audioPlaying,
      };
    },
  };
}

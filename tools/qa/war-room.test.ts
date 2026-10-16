import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import {
  closeWarRoomModal,
  isWarRoomModalOpen,
  loadCampaignScenesData,
  openWarRoomModal,
  parseSceneTable,
  SKIRMISH_ENVIRONMENT_FILTERS,
  SKIRMISH_PLAYER_FILTERS,
  WAR_ROOM_TABS,
  warRoomBriefingTokens,
  type CampaignScenesData,
  type MissionBriefingData,
  type SkirmishMapRecord,
  type WarRoomFaction,
} from "../../src/ui/war-room";

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
    remove: (...tokens: string[]) =>
      tokens.forEach((token) => this.classList.classes.delete(token)),
    contains: (token: string) => this.classList.classes.has(token),
  };
  parentElement: StubElement | null = null;
  className = "";
  private _textContent = "";
  title = "";
  type = "";
  tabIndex = -1;
  scrollTop = 0;
  preload = "";
  muted = false;
  disabled = false;
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

  constructor(readonly tagName = "DIV") {
    super();
  }

  get textContent(): string {
    if (this.children.length === 0) return this._textContent;
    return this._textContent + this.children.map((c) => c.textContent).join("");
  }

  set textContent(value: string) {
    this.children.length = 0;
    this._textContent = value;
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
    this._textContent = "";
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

function createBrowserEnv() {
  const data = JSON.parse(
    readRepoFile("public/assets/data/campaign-scenes.json").toString("utf8"),
  ) as CampaignScenesData;
  const body = new StubElement("BODY");
  const previousFocus = new StubElement("BUTTON");
  const windowStub = new EventTarget();

  const globals: Record<string, unknown> = {
    HTMLElement: StubElement,
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
    restore: () => {
      closeWarRoomModal();
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

test("campaign-scenes.json matches HSCENE.TXT, GSCENE.TXT, all 30 briefings, all 30 voiceovers, and all 56 MPLAYER maps on disk", () => {
  const data = JSON.parse(
    readRepoFile("public/assets/data/campaign-scenes.json").toString("utf8"),
  ) as CampaignScenesData;

  assert.equal(data.schemaVersion, 1);
  assert.equal(data.sources.human.path, "raw_cd/DC/GAMESTAT/HSCENE.TXT");
  assert.equal(data.sources.alien.path, "raw_cd/DC/GAMESTAT/GSCENE.TXT");

  const hsceneBytes = readRepoFile(data.sources.human.path);
  const gsceneBytes = readRepoFile(data.sources.alien.path);
  assert.equal(sha256Hex(hsceneBytes), data.sources.human.sha256);
  assert.equal(sha256Hex(gsceneBytes), data.sources.alien.sha256);

  const parsedHuman = parseSceneTable(hsceneBytes.toString("latin1"), "human");
  const parsedAlien = parseSceneTable(gsceneBytes.toString("latin1"), "alien");
  assert.equal(data.campaigns.human.length, 15);
  assert.equal(data.campaigns.alien.length, 15);
  assert.deepEqual(data.tribes, parsedHuman.tribes);

  for (const [faction, scenes, expectedScenes] of [
    ["human", data.campaigns.human, parsedHuman.scenes],
    ["alien", data.campaigns.alien, parsedAlien.scenes],
  ] as const) {
    scenes.forEach((scene, index) => {
      const expected = expectedScenes[index];
      assert.equal(scene.missionNumber, index + 1);
      assert.equal(scene.faction, faction);
      assert.equal(scene.scnPath, expected.scnPath);
      assert.equal(scene.title, expected.title);
      assert.equal(scene.location, expected.location);
      assert.equal(scene.scenarioStem, expected.scenarioStem);
      assert.equal(scene.introAvi, expected.introAvi);
      assert.equal(scene.outroAvi, expected.outroAvi);
      assert.deepEqual(scene.params, expected.params);
      assert.equal(scene.flag, expected.flag);
      assert.deepEqual(scene.objectives, expected.objectives);
      assert.equal(scene.briefingPath, expected.briefingPath);
      assert.equal(scene.voicePath, expected.voicePath);

      // Verify briefing JSON and raw TXT SHA-256 on disk
      const briefingBytes = readRepoFile(`public${scene.briefingPath}`);
      assert.ok(briefingBytes.length > 0, `Missing briefing ${scene.briefingPath}`);
      const briefingJson = JSON.parse(briefingBytes.toString("utf8")) as MissionBriefingData;
      assert.equal(scene.briefingSourceSha256, briefingJson.source.sha256);

      const rawBriefingTxt = readRepoFile(`raw_cd/DC/SCENARIO/${briefingJson.source.path}`);
      assert.equal(sha256Hex(rawBriefingTxt), scene.briefingSourceSha256);

      const tokens = warRoomBriefingTokens(briefingJson.rawText);
      assert.equal(tokens.map((t) => t.text).join(""), briefingJson.plainText);

      // Verify voiceover OGG on disk
      const voiceBytes = readRepoFile(`public${scene.voicePath}`);
      assert.ok(voiceBytes.length > 0, `Missing voiceover ${scene.voicePath}`);

      // Verify resolved intro/outro MP4 & WebM cutscenes on disk
      assert.ok(scene.introVideo?.mp4 && scene.introVideo?.webm);
      assert.ok(scene.outroVideo?.mp4 && scene.outroVideo?.webm);
      assert.ok(readRepoFile(`public${scene.introVideo.mp4}`).length > 0);
      assert.ok(readRepoFile(`public${scene.introVideo.webm}`).length > 0);
      assert.ok(readRepoFile(`public${scene.outroVideo.mp4}`).length > 0);
      assert.ok(readRepoFile(`public${scene.outroVideo.webm}`).length > 0);
    });
  }

  // Verify all 56 MPLAYER skirmish maps on disk
  const onDiskMapFiles = readdirSync(new URL("public/assets/generated/maps/MPLAYER", repoRoot))
    .filter((f) => f.endsWith(".json"))
    .sort();
  assert.equal(onDiskMapFiles.length, 56);
  assert.equal(data.skirmishMaps.length, 56);
  assert.deepEqual(
    data.skirmishMaps.map((m) => `${m.stem}.json`),
    onDiskMapFiles,
  );

  for (const map of data.skirmishMaps) {
    assert.equal(map.mapPath, `/assets/generated/maps/MPLAYER/${map.stem}.json`);
    const mapBytes = readRepoFile(`public${map.mapPath}`);
    assert.equal(sha256Hex(mapBytes), map.mapSha256);

    const mapJson = JSON.parse(mapBytes.toString("utf8")) as { width: number; height: number };
    assert.equal(map.width, mapJson.width);
    assert.equal(map.height, mapJson.height);
    assert.equal(map.family, map.stem.slice(0, 2));
    assert.equal(
      map.environment,
      map.stem[0] === "A" ? "atlantis" : map.stem[0] === "D" ? "desert" : "jungle",
    );
    assert.equal(map.maxPlayers, Number(map.stem[1]));

    const hasScn = existsSync(
      new URL(`public/assets/generated/data/scenarios/MPLAYER/${map.stem}.json`, repoRoot),
    );
    const hasTro = existsSync(
      new URL(`public/assets/generated/data/triggers/MPLAYER/${map.stem}.json`, repoRoot),
    );
    assert.equal(map.hasScenarioData, hasScn && hasTro);
  }
});

test("openWarRoomModal renders Human/Alien missions and 56 Skirmish maps, controls voiceovers, invokes callbacks, and cleans up", async () => {
  const env = createBrowserEnv();
  try {
    const loaded = await loadCampaignScenesData({ forceReload: true });
    assert.equal(loaded.campaigns.human.length, 15);
    assert.equal(loaded.campaigns.alien.length, 15);
    assert.equal(loaded.skirmishMaps.length, 56);

    const watchedCutscenes: { stem: string; mission: number; kind: string }[] = [];
    const launchedCampaigns: { faction: WarRoomFaction; missionNumber: number; title: string }[] = [];
    const launchedSkirmishes: SkirmishMapRecord[] = [];

    const modal = await openWarRoomModal({
      onWatchCutscene: (stem, scene, kind) => {
        watchedCutscenes.push({ stem, mission: scene.missionNumber, kind });
      },
      onLaunchCampaignMission: (faction, missionNumber, scene) => {
        launchedCampaigns.push({ faction, missionNumber, title: scene.title });
      },
      onLaunchSkirmish: (mapEntry) => {
        launchedSkirmishes.push(mapEntry);
      },
    });
    await setImmediate();

    assert.equal(isWarRoomModalOpen(), true);
    const dialog = modal.dialog as unknown as StubElement;
    const audio = modal.audio as unknown as StubElement;
    assert.equal(dialog.open, true);

    // Verify all 3 primary tabs render
    const tabs = dialog.querySelectorAll("[data-war-room-tab]");
    assert.deepEqual(
      tabs.map((tab) => [tab.dataset.warRoomTab, tab.textContent]),
      WAR_ROOM_TABS.map((tab) => [tab.id, tab.label]),
    );

    // 1. Human Campaign tab initially active (Mission 1: RED LANDING / CHRYSE BASIN)
    assert.equal(modal.getState().tab, "human");
    assert.equal(modal.getState().activeFaction, "human");
    assert.equal(modal.getState().activeMissionNumber, 1);
    assert.equal(dialog.querySelectorAll("[data-war-room-mission]").length, 15);
    assert.equal(dialog.querySelector(".war-room-mission-title")?.textContent, "RED LANDING");
    assert.equal(dialog.querySelector(".war-room-mission-location")?.textContent, "CHRYSE BASIN");
    assert.match(dialog.querySelector(".war-room-readable")?.textContent ?? "", /MINING COLONIES/);
    assert.equal(audio.src, "/assets/generated/media/audio/MISSION/H1.ogg");
    assert.equal(audio.paused, false);

    // Select Human Mission 6 (ANCIENT LEGACY / THE UNDERGROUND) -> stops H1.ogg and plays H6.ogg
    const prevPauseCount = audio.pauseCount;
    const human06Btn = dialog.querySelector('[data-war-room-mission="6"]')!;
    dispatchClick(dialog, human06Btn);
    await setImmediate();

    assert.equal(modal.getState().activeMissionNumber, 6);
    assert.equal(dialog.querySelector(".war-room-mission-title")?.textContent, "ANCIENT LEGACY");
    assert.equal(
      dialog.querySelector(".war-room-mission-location")?.textContent,
      "THE UNDERGROUND",
    );
    assert.ok(audio.pauseCount > prevPauseCount, "Stopped previous H1.ogg before playing H6.ogg");
    assert.equal(audio.src, "/assets/generated/media/audio/MISSION/H6.ogg");
    assert.equal(audio.paused, false);

    // Stop Voice and Play Briefing Voice buttons
    const stopVoiceBtn = dialog.querySelector('[data-war-room-action="stop-voice"]')!;
    dispatchClick(dialog, stopVoiceBtn);
    assert.equal(audio.paused, true);

    const playVoiceBtn = dialog.querySelector('[data-war-room-action="play-voice"]')!;
    const playCountBefore = audio.playCount;
    dispatchClick(dialog, playVoiceBtn);
    await setImmediate();
    assert.equal(audio.playCount, playCountBefore + 1);
    assert.equal(audio.paused, false);

    // Watch Cutscene button stops voiceover and invokes callback with LENZ
    const watchBtn = dialog.querySelector('[data-war-room-action="watch-cutscene"]')!;
    dispatchClick(dialog, watchBtn);
    await setImmediate();
    assert.equal(audio.paused, true);
    assert.deepEqual(watchedCutscenes.at(-1), { stem: "LENZ", mission: 6, kind: "intro" });

    // 2. Switch to Taar / Alien Campaign tab -> stops Human audio, loads ALIEN01, plays G1.ogg
    const alienTab = dialog.querySelector('[data-war-room-tab="alien"]')!;
    dispatchClick(dialog, alienTab);
    await setImmediate();

    assert.equal(modal.getState().tab, "alien");
    assert.equal(modal.getState().activeFaction, "alien");
    assert.equal(modal.getState().activeMissionNumber, 1);
    assert.equal(dialog.querySelectorAll("[data-war-room-mission]").length, 15);
    assert.equal(dialog.querySelector(".war-room-mission-title")?.textContent, "FIRST STRIKE");
    assert.equal(dialog.querySelector(".war-room-mission-location")?.textContent, "CYDONIA REGION");
    assert.match(
      dialog.querySelector(".war-room-readable")?.textContent ?? "",
      /MIND LINK ESTABLISHED/,
    );
    assert.equal(audio.src, "/assets/generated/media/audio/MISSION/G1.ogg");
    assert.equal(audio.paused, false);

    // Select Alien Mission 15 (FINAL EVACUATION / DESTINY ONE)
    const alien15Btn = dialog.querySelector('[data-war-room-mission="15"]')!;
    dispatchClick(dialog, alien15Btn);
    await setImmediate();
    assert.equal(modal.getState().activeMissionNumber, 15);
    assert.equal(dialog.querySelector(".war-room-mission-title")?.textContent, "FINAL EVACUATION");
    assert.equal(dialog.querySelector(".war-room-mission-location")?.textContent, "DESTINY ONE");
    assert.equal(audio.src, "/assets/generated/media/audio/MISSION/G15.ogg");

    // 3. Switch to Council Wars / Skirmish Maps (56 Maps) tab -> tears down audio & renders 56 maps
    const skirmishTab = dialog.querySelector('[data-war-room-tab="skirmish"]')!;
    dispatchClick(dialog, skirmishTab);
    await setImmediate();

    assert.equal(modal.getState().tab, "skirmish");
    assert.equal(audio.paused, true);
    assert.equal(audio.src, "");
    assert.equal(dialog.querySelectorAll("[data-skirmish-map]").length, 56);
    assert.equal(modal.getState().filteredSkirmishCount, 56);

    // Verify environment filters (All=56, Desert=30, Jungle=25, Atlantis=1)
    assert.equal(
      dialog.querySelectorAll("[data-skirmish-environment]").length,
      SKIRMISH_ENVIRONMENT_FILTERS.length,
    );
    assert.equal(
      dialog.querySelectorAll("[data-skirmish-players]").length,
      SKIRMISH_PLAYER_FILTERS.length,
    );

    dispatchClick(dialog, dialog.querySelector('[data-skirmish-environment="desert"]')!);
    assert.equal(modal.getState().filteredSkirmishCount, 30);
    assert.equal(dialog.querySelectorAll("[data-skirmish-map]").length, 30);

    dispatchClick(dialog, dialog.querySelector('[data-skirmish-players="4"]')!);
    assert.equal(modal.getState().filteredSkirmishCount, 10);
    assert.equal(dialog.querySelectorAll("[data-skirmish-map]").length, 10);

    // Select D4PLAY03 ("Napalm Valley")
    const d4play03Card = dialog.querySelector('[data-skirmish-map="D4PLAY03"]')!;
    dispatchClick(dialog, d4play03Card);
    assert.equal(modal.getState().activeSkirmishStem, "D4PLAY03");
    assert.equal(modal.getState().activeSkirmishMap?.title, "Napalm Valley");

    // Reset filters to All and test Atlantis (1 map: A2PLAY01)
    dispatchClick(dialog, dialog.querySelector('[data-skirmish-players="all"]')!);
    dispatchClick(dialog, dialog.querySelector('[data-skirmish-environment="atlantis"]')!);
    assert.equal(modal.getState().filteredSkirmishCount, 1);
    assert.equal(modal.getState().activeSkirmishStem, "A2PLAY01");

    // Close via Escape -> cleans up DOM and restores focus
    dispatchKeydown(dialog, "Escape");
    await modal.closed;
    assert.equal(isWarRoomModalOpen(), false);
    assert.equal(dialog.closed, true);
    assert.equal(dialog.isConnected, false);
    assert.equal(env.previousFocus.focusCount, 1);

    // Reopen on Alien Mission 15 and click Launch Mission
    const campaignModal = await openWarRoomModal({
      initialTab: "alien",
      initialMissionNumber: 15,
      onLaunchCampaignMission: (faction, missionNumber, scene) => {
        launchedCampaigns.push({ faction, missionNumber, title: scene.title });
      },
    });
    await setImmediate();
    const campaignDialog = campaignModal.dialog as unknown as StubElement;
    const launchMissionBtn = campaignDialog.querySelector(
      '[data-war-room-action="launch-mission"]',
    )!;
    dispatchClick(campaignDialog, launchMissionBtn);
    await campaignModal.closed;
    assert.deepEqual(launchedCampaigns, [
      { faction: "alien", missionNumber: 15, title: "FINAL EVACUATION" },
    ]);
    assert.equal(campaignModal.audio.paused, true);
    assert.equal(campaignModal.audio.src, "");

    // Reopen on Skirmish tab and click Launch Skirmish
    const skirmishModal = await openWarRoomModal({
      initialTab: "skirmish",
      initialSkirmishStem: "J8PLAY07",
      onLaunchSkirmish: (mapEntry) => {
        launchedSkirmishes.push(mapEntry);
      },
    });
    await setImmediate();
    const skirmishDialog = skirmishModal.dialog as unknown as StubElement;
    const launchSkirmishBtn = skirmishDialog.querySelector(
      '[data-war-room-action="launch-skirmish"]',
    )!;
    dispatchClick(skirmishDialog, launchSkirmishBtn);
    await skirmishModal.closed;
    assert.equal(launchedSkirmishes.length, 1);
    assert.equal(launchedSkirmishes[0].stem, "J8PLAY07");
    assert.equal(launchedSkirmishes[0].environment, "jungle");
    assert.equal(launchedSkirmishes[0].maxPlayers, 8);
  } finally {
    env.restore();
  }
});

test("main.ts wires War Room styles, buttons, modal opener, Enter key deployment/undeployment, ambient audio, and theater mode", () => {
  const mainSource = readRepoFile("src/main.ts").toString("utf8");
  const styleSource = readRepoFile("src/style.css").toString("utf8");
  assert.match(mainSource, /import "\.\/ui\/war-room\.css";/);
  assert.match(mainSource, /openWarRoomModal/);
  assert.match(mainSource, /data-open-war-room/);
  assert.match(
    mainSource,
    /event\.key === "Enter" && \(skirmish\.deploymentSelection\?\.canUndeploy \|\| skirmish\.deploymentSelection\?\.canDeploy\)/,
  );
  assert.match(mainSource, /const ambientScheduler = new AmbientAudioScheduler\(\)/);
  assert.match(mainSource, /ambientScheduler\.step\(\{ profile, tick: stats\.tick, daylightPermille \}\)/);
  assert.match(mainSource, /showCampaignIntro\(\{ faction, missionNumber, briefing: mission\.briefing/);
  assert.match(mainSource, /data-toggle-theater/);
  assert.match(styleSource, /\.asset-lab\.theater-mode/);
  assert.match(styleSource, /image-rendering: pixelated/);
});


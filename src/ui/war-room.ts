import { assetUrl } from "../asset-url";
import { playCinematic } from "./cinematics";

export type WarRoomFaction = "human" | "alien";
export type WarRoomTab = "human" | "alien" | "skirmish";
export type SkirmishEnvironment = "atlantis" | "desert" | "jungle";
export type SkirmishEnvironmentFilter = "all" | SkirmishEnvironment;
export type SkirmishPlayersFilter = "all" | 2 | 4 | 6 | 8;
export type SkirmishMapFamily = "A2" | "D2" | "D4" | "D8" | "J2" | "J4" | "J6" | "J8";

export interface WarRoomBriefingToken {
  readonly style: number;
  readonly text: string;
}

export interface CampaignVideoAsset {
  readonly stem: string;
  readonly mp4: string | null;
  readonly webm: string | null;
}

export interface CampaignSceneRecord {
  readonly missionNumber: number;
  readonly faction: WarRoomFaction;
  readonly scnPath: string;
  readonly title: string;
  readonly location: string;
  readonly scenarioStem: string;
  readonly introAvi: string;
  readonly outroAvi: string;
  readonly introVideoStem?: string | null;
  readonly outroVideoStem?: string | null;
  readonly introVideo?: CampaignVideoAsset | null;
  readonly outroVideo?: CampaignVideoAsset | null;
  readonly params: readonly [number, number, number];
  readonly flag: number;
  readonly objectives: readonly number[];
  readonly briefingPath: string;
  readonly briefingSourceSha256: string;
  readonly voicePath: string;
}

export interface SkirmishMapRecord {
  readonly stem: string;
  readonly title?: string;
  readonly family: SkirmishMapFamily;
  readonly environment: SkirmishEnvironment;
  readonly maxPlayers: 2 | 4 | 6 | 8;
  readonly width: number;
  readonly height: number;
  readonly mapPath: string;
  readonly mapSha256?: string;
  readonly scenarioPath?: string | null;
  readonly triggersPath?: string | null;
  readonly hasScenarioData: boolean;
}

export interface CampaignScenesData {
  readonly schemaVersion: 1;
  readonly sources: {
    readonly human: {
      readonly path: string;
      readonly sha256: string;
    };
    readonly alien: {
      readonly path: string;
      readonly sha256: string;
    };
  };
  readonly tribes?: readonly string[];
  readonly campaigns: {
    readonly human: readonly CampaignSceneRecord[];
    readonly alien: readonly CampaignSceneRecord[];
  };
  readonly skirmishMaps: readonly SkirmishMapRecord[];
}

export interface MissionBriefingData {
  readonly schemaVersion: number;
  readonly source: {
    readonly path: string;
    readonly sha256: string;
  };
  readonly rawText: string;
  readonly plainText: string;
  readonly objectives: readonly string[];
}

export const WAR_ROOM_TABS: readonly {
  readonly id: WarRoomTab;
  readonly label: string;
}[] = [
  { id: "human", label: "Human Campaign (15 Missions)" },
  { id: "alien", label: "Taar / Alien Campaign (15 Missions)" },
  { id: "skirmish", label: "Council Wars / Skirmish Maps (56 Maps)" },
] as const;

export const SKIRMISH_ENVIRONMENT_FILTERS: readonly {
  readonly id: SkirmishEnvironmentFilter;
  readonly label: string;
}[] = [
  { id: "all", label: "All" },
  { id: "desert", label: "Desert" },
  { id: "jungle", label: "Jungle" },
  { id: "atlantis", label: "Atlantis" },
] as const;

export const SKIRMISH_PLAYER_FILTERS: readonly {
  readonly id: SkirmishPlayersFilter;
  readonly label: string;
}[] = [
  { id: "all", label: "All" },
  { id: 2, label: "2P" },
  { id: 4, label: "4P" },
  { id: 6, label: "6P" },
  { id: 8, label: "8P" },
] as const;

export function warRoomBriefingTokens(rawText: string): WarRoomBriefingToken[] {
  const tokens: WarRoomBriefingToken[] = [];
  let style = 4;
  for (const part of rawText.replace(/\r/g, "").trim().split(/(~\d)/)) {
    if (/^~\d$/.test(part)) style = Number(part[1]);
    else if (part) tokens.push({ style, text: part });
  }
  return tokens;
}

export function parseSceneTable(
  raw: string,
  faction: WarRoomFaction,
): {
  readonly tribes: readonly string[];
  readonly scenes: readonly Omit<
    CampaignSceneRecord,
    "briefingSourceSha256" | "introVideo" | "outroVideo"
  >[];
} {
  const lines = raw.replace(/\r/g, "").split("\n");
  const tribes = lines.slice(0, 8).map((line) => line.replace(/\.\s*$/, "").trim());
  const count = Number(lines[8]?.trim());
  const rest = lines
    .slice(9)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (!Number.isInteger(count) || count <= 0 || rest.length !== count * 9) {
    throw new Error(`Invalid scene table for ${faction}: expected ${count * 9} lines, got ${rest.length}`);
  }
  const scenes: Omit<CampaignSceneRecord, "briefingSourceSha256" | "introVideo" | "outroVideo">[] = [];
  for (let i = 0; i < count; i++) {
    const base = i * 9;
    const missionNumber = i + 1;
    const scnPath = rest[base];
    const title = rest[base + 1];
    const location = rest[base + 2];
    const scenarioStem = rest[base + 3];
    const introAvi = rest[base + 4];
    const outroAvi = rest[base + 5];
    const parsedParams = rest[base + 6].split(/\s+/).map(Number);
    if (parsedParams.length !== 3 || parsedParams.some((n) => !Number.isFinite(n))) {
      throw new Error(`Invalid scene params on ${faction} mission ${missionNumber}`);
    }
    const params: readonly [number, number, number] = [
      parsedParams[0],
      parsedParams[1],
      parsedParams[2],
    ];
    const flag = Number(rest[base + 7]);
    const rawObjectives = rest[base + 8].split(/\s+/).map(Number);
    if (rawObjectives.at(-1) !== -1) {
      throw new Error(`Missing -1 terminator on ${faction} mission ${missionNumber} objectives`);
    }
    const objectives = rawObjectives.slice(0, -1);
    const numStr = String(missionNumber).padStart(2, "0");
    const upperFaction = faction === "human" ? "HUMAN" : "ALIEN";
    const briefingPath = `/assets/generated/data/briefings/${upperFaction}/${upperFaction}${numStr}.json`;
    const voicePrefix = faction === "human" ? "H" : "G";
    const voicePath = `/assets/generated/media/audio/MISSION/${voicePrefix}${missionNumber}.ogg`;
    const introVideoStem = introAvi.replace(/^avi\//i, "").replace(/\.avi$/i, "").toUpperCase();
    const outroVideoStem = outroAvi.replace(/^avi\//i, "").replace(/\.avi$/i, "").toUpperCase();
    scenes.push({
      missionNumber,
      faction,
      scnPath,
      title,
      location,
      scenarioStem,
      introAvi,
      outroAvi,
      introVideoStem,
      outroVideoStem,
      params,
      flag,
      objectives,
      briefingPath,
      voicePath,
    });
  }
  return { tribes, scenes };
}

let cachedScenesPromise: Promise<CampaignScenesData> | undefined;
const briefingCache = new Map<string, Promise<MissionBriefingData>>();

export async function loadCampaignScenesData(
  options?: { readonly signal?: AbortSignal; readonly forceReload?: boolean } | AbortSignal,
): Promise<CampaignScenesData> {
  const signal = options instanceof AbortSignal ? options : options?.signal;
  const forceReload = options instanceof AbortSignal ? false : Boolean(options?.forceReload);
  if (!forceReload && !signal && cachedScenesPromise) {
    return await cachedScenesPromise;
  }
  const request = (async () => {
    const response = await fetch(
      assetUrl("/assets/data/campaign-scenes.json"),
      signal ? { signal } : undefined,
    );
    if (!response.ok) {
      throw new Error(`Campaign scenes data unavailable (${response.status})`);
    }
    const data = (await response.json()) as CampaignScenesData;
    if (
      data.schemaVersion !== 1 ||
      !Array.isArray(data.campaigns?.human) ||
      !Array.isArray(data.campaigns?.alien) ||
      !Array.isArray(data.skirmishMaps)
    ) {
      throw new Error("Invalid campaign scenes asset");
    }
    return data;
  })();
  if (!signal) {
    cachedScenesPromise = request;
    request.catch(() => {
      if (cachedScenesPromise === request) cachedScenesPromise = undefined;
    });
  }
  return await request;
}

export async function loadMissionBriefingData(
  briefingPath: string,
  signal?: AbortSignal,
): Promise<MissionBriefingData> {
  if (!signal && briefingCache.has(briefingPath)) {
    return await briefingCache.get(briefingPath)!;
  }
  const request = (async () => {
    const response = await fetch(assetUrl(briefingPath), signal ? { signal } : undefined);
    if (!response.ok) {
      throw new Error(`Mission briefing unavailable (${response.status}): ${briefingPath}`);
    }
    const data = (await response.json()) as MissionBriefingData;
    if (typeof data.rawText !== "string" || typeof data.plainText !== "string") {
      throw new Error(`Invalid mission briefing asset: ${briefingPath}`);
    }
    return data;
  })();
  if (!signal) {
    briefingCache.set(briefingPath, request);
    request.catch(() => {
      if (briefingCache.get(briefingPath) === request) {
        briefingCache.delete(briefingPath);
      }
    });
  }
  return await request;
}

export interface WarRoomModalOptions {
  readonly parent?: HTMLElement;
  readonly data?: CampaignScenesData;
  readonly initialTab?: WarRoomTab;
  readonly initialMissionNumber?: number;
  readonly initialSkirmishStem?: string;
  readonly initialEnvironmentFilter?: SkirmishEnvironmentFilter;
  readonly initialPlayersFilter?: SkirmishPlayersFilter;
  readonly muted?: boolean;
  readonly autoplayAudio?: boolean;
  readonly onMutedChange?: (muted: boolean) => void;
  readonly onWatchCutscene?: (
    stem: string,
    scene: CampaignSceneRecord,
    kind: "intro" | "outro",
  ) => void | Promise<unknown>;
  readonly onLaunchCampaignMission?: (
    faction: WarRoomFaction,
    missionNumber: number,
    scene: CampaignSceneRecord,
  ) => void;
  readonly onLaunchSkirmish?: (mapEntry: SkirmishMapRecord) => void;
  readonly onClose?: () => void;
}

export interface WarRoomModalHandle {
  readonly dialog: HTMLDialogElement;
  readonly audio: HTMLAudioElement;
  readonly closed: Promise<void>;
  readonly close: () => void;
  readonly selectTab: (tab: WarRoomTab) => void;
  readonly selectMission: (missionNumber: number) => void;
  readonly selectSkirmishMap: (stem: string) => void;
  readonly setEnvironmentFilter: (environment: SkirmishEnvironmentFilter) => void;
  readonly setPlayersFilter: (players: SkirmishPlayersFilter) => void;
  readonly playBriefingVoice: () => Promise<void>;
  readonly stopBriefingVoice: () => void;
  readonly watchCutscene: (kind?: "intro" | "outro") => Promise<void>;
  readonly launchMission: () => void;
  readonly launchSkirmish: (stem?: string) => void;
  readonly getState: () => {
    readonly tab: WarRoomTab;
    readonly activeFaction: WarRoomFaction;
    readonly activeMissionNumber: number;
    readonly activeScene: CampaignSceneRecord;
    readonly activeSkirmishStem: string;
    readonly activeSkirmishMap: SkirmishMapRecord | undefined;
    readonly environmentFilter: SkirmishEnvironmentFilter;
    readonly playersFilter: SkirmishPlayersFilter;
    readonly filteredSkirmishCount: number;
    readonly muted: boolean;
    readonly audioPlaying: boolean;
  };
}

let activeWarRoomClose: (() => void) | undefined;

export function closeWarRoomModal(): void {
  activeWarRoomClose?.();
}

export function isWarRoomModalOpen(): boolean {
  return activeWarRoomClose !== undefined;
}

function tabBackgroundPath(tab: WarRoomTab): string {
  if (tab === "human") return "/assets/generated/interface/SHUMAN.GIF";
  if (tab === "alien") return "/assets/generated/interface/STORY.GIF";
  return "/assets/generated/interface/NET.GIF";
}

function environmentLabel(env: SkirmishEnvironment): string {
  if (env === "atlantis") return "Atlantis";
  if (env === "desert") return "Desert";
  return "Jungle";
}

export async function openWarRoomModal(
  options: WarRoomModalOptions = {},
): Promise<WarRoomModalHandle> {
  closeWarRoomModal();

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
  dialog.className = "war-room-modal";
  dialog.setAttribute("aria-label", "Dark Colony War Room & Briefing Archive");

  const sceneContainer = document.createElement("div");
  sceneContainer.className = "war-room-scene";

  // Top bar: title + 3 primary tabs
  const topbar = document.createElement("header");
  topbar.className = "war-room-topbar";

  const brand = document.createElement("div");
  brand.className = "war-room-brand";
  const kicker = document.createElement("p");
  kicker.className = "war-room-kicker";
  kicker.textContent = "STRATEGIC ARCHIVE & COUNCIL WARS";
  const heading = document.createElement("h1");
  heading.className = "war-room-heading";
  heading.textContent = "WAR ROOM";
  brand.append(kicker, heading);

  const tabsNav = document.createElement("div");
  tabsNav.className = "war-room-tabs";
  tabsNav.setAttribute("role", "tablist");
  tabsNav.setAttribute("aria-label", "War Room modes");

  const tabButtons = new Map<WarRoomTab, HTMLButtonElement>();
  for (const tabInfo of WAR_ROOM_TABS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "war-room-tab";
    btn.setAttribute("role", "tab");
    btn.dataset.warRoomTab = tabInfo.id;
    btn.textContent = tabInfo.label;
    tabButtons.set(tabInfo.id, btn);
    tabsNav.append(btn);
  }

  topbar.append(brand, tabsNav);

  // Body container holding Campaign panel & Skirmish panel
  const body = document.createElement("div");
  body.className = "war-room-body";

  // 1. Campaign Panel (Human 1..15 / Alien 1..15)
  const campaignPanel = document.createElement("section");
  campaignPanel.className = "war-room-campaign-panel";
  campaignPanel.setAttribute("aria-label", "Campaign missions and briefing archive");

  const missionList = document.createElement("div");
  missionList.className = "war-room-mission-list";
  missionList.setAttribute("role", "listbox");
  missionList.setAttribute("aria-label", "Campaign missions");

  const briefingColumn = document.createElement("div");
  briefingColumn.className = "war-room-briefing-column";

  const briefingHeader = document.createElement("div");
  briefingHeader.className = "war-room-briefing-header";

  const headerTitleGroup = document.createElement("div");
  const missionBadge = document.createElement("p");
  missionBadge.className = "war-room-mission-badge";
  const missionTitle = document.createElement("h2");
  missionTitle.className = "war-room-mission-title";
  const missionLocation = document.createElement("p");
  missionLocation.className = "war-room-mission-location";
  headerTitleGroup.append(missionBadge, missionTitle, missionLocation);

  const sceneMeta = document.createElement("div");
  sceneMeta.className = "war-room-scene-meta";
  briefingHeader.append(headerTitleGroup, sceneMeta);

  const briefingTranscript = document.createElement("div");
  briefingTranscript.className = "war-room-briefing-transcript";
  briefingTranscript.tabIndex = 0;
  briefingTranscript.setAttribute("role", "region");
  briefingTranscript.setAttribute("aria-label", "Mission briefing transcript");
  const readableTranscript = document.createElement("div");
  readableTranscript.className = "war-room-readable";
  const styledTranscript = document.createElement("div");
  styledTranscript.className = "war-room-tokens";
  briefingTranscript.append(readableTranscript, styledTranscript);

  const objectivesBox = document.createElement("div");
  objectivesBox.className = "war-room-objectives-box";
  const objectivesHeading = document.createElement("p");
  objectivesHeading.className = "war-room-objectives-heading";
  objectivesHeading.textContent = "MISSION OBJECTIVES";
  const objectivesList = document.createElement("ul");
  objectivesList.className = "war-room-objectives-list";
  objectivesBox.append(objectivesHeading, objectivesList);

  const makeActionButton = (action: string, label: string, title: string): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "war-room-action-button";
    button.dataset.warRoomAction = action;
    button.textContent = label;
    button.title = title;
    button.setAttribute("aria-label", title);
    return button;
  };

  const campaignActions = document.createElement("div");
  campaignActions.className = "war-room-campaign-actions";
  const voiceControlsGroup = document.createElement("div");
  voiceControlsGroup.className = "war-room-filter-group";
  const playVoiceButton = makeActionButton(
    "play-voice",
    "Play Briefing Voice",
    "Play mission briefing voiceover",
  );
  const stopVoiceButton = makeActionButton(
    "stop-voice",
    "Stop Voice",
    "Stop mission briefing voiceover",
  );
  const watchCutsceneButton = makeActionButton(
    "watch-cutscene",
    "Watch Cutscene",
    "Watch mission cutscene",
  );
  const watchOutroButton = makeActionButton(
    "watch-outro-cutscene",
    "Watch Defeat Cutscene",
    "Watch alternate/defeat cutscene",
  );
  voiceControlsGroup.append(
    playVoiceButton,
    stopVoiceButton,
    watchCutsceneButton,
    watchOutroButton,
  );

  const launchMissionButton = makeActionButton(
    "launch-mission",
    "Launch Mission",
    "Launch selected campaign mission",
  );
  launchMissionButton.classList.add("war-room-primary-button");
  campaignActions.append(voiceControlsGroup, launchMissionButton);

  briefingColumn.append(briefingHeader, briefingTranscript, objectivesBox, campaignActions);
  campaignPanel.append(missionList, briefingColumn);

  // 2. Council Wars / Skirmish Maps Panel (56 Maps)
  const skirmishPanel = document.createElement("section");
  skirmishPanel.className = "war-room-skirmish-panel";
  skirmishPanel.setAttribute("aria-label", "Council Wars and Skirmish Maps");
  skirmishPanel.setAttribute("hidden", "");

  const skirmishToolbar = document.createElement("div");
  skirmishToolbar.className = "war-room-skirmish-toolbar";

  const envFilterGroup = document.createElement("div");
  envFilterGroup.className = "war-room-filter-group";
  envFilterGroup.setAttribute("role", "group");
  envFilterGroup.setAttribute("aria-label", "Filter by environment");
  const envLabel = document.createElement("span");
  envLabel.className = "war-room-filter-label";
  envLabel.textContent = "Environment:";
  envFilterGroup.append(envLabel);

  const envFilterButtons = new Map<SkirmishEnvironmentFilter, HTMLButtonElement>();
  for (const item of SKIRMISH_ENVIRONMENT_FILTERS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "war-room-filter-button";
    btn.dataset.skirmishEnvironment = item.id;
    btn.textContent = item.label;
    envFilterButtons.set(item.id, btn);
    envFilterGroup.append(btn);
  }

  const playersFilterGroup = document.createElement("div");
  playersFilterGroup.className = "war-room-filter-group";
  playersFilterGroup.setAttribute("role", "group");
  playersFilterGroup.setAttribute("aria-label", "Filter by player count");
  const playersLabel = document.createElement("span");
  playersLabel.className = "war-room-filter-label";
  playersLabel.textContent = "Players:";
  playersFilterGroup.append(playersLabel);

  const playerFilterButtons = new Map<SkirmishPlayersFilter, HTMLButtonElement>();
  for (const item of SKIRMISH_PLAYER_FILTERS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "war-room-filter-button";
    btn.dataset.skirmishPlayers = String(item.id);
    btn.textContent = item.label;
    playerFilterButtons.set(item.id, btn);
    playersFilterGroup.append(btn);
  }

  const skirmishSummary = document.createElement("span");
  skirmishSummary.className = "war-room-skirmish-summary";
  skirmishToolbar.append(envFilterGroup, playersFilterGroup, skirmishSummary);

  const skirmishContent = document.createElement("div");
  skirmishContent.className = "war-room-skirmish-content";

  const skirmishGrid = document.createElement("div");
  skirmishGrid.className = "war-room-skirmish-grid";
  skirmishGrid.setAttribute("role", "listbox");
  skirmishGrid.setAttribute("aria-label", "Skirmish maps");

  const skirmishInspector = document.createElement("aside");
  skirmishInspector.className = "war-room-skirmish-inspector";
  skirmishInspector.setAttribute("aria-label", "Selected skirmish map details");

  const inspectorDetails = document.createElement("div");
  inspectorDetails.className = "war-room-inspector-details";
  const inspectorBadge = document.createElement("p");
  inspectorBadge.className = "war-room-mission-badge";
  const inspectorTitle = document.createElement("h2");
  inspectorTitle.className = "war-room-mission-title";
  const inspectorSubtitle = document.createElement("p");
  inspectorSubtitle.className = "war-room-mission-location";
  const inspectorRows = document.createElement("div");
  inspectorDetails.append(inspectorBadge, inspectorTitle, inspectorSubtitle, inspectorRows);

  const launchSkirmishButton = makeActionButton(
    "launch-skirmish",
    "Launch Skirmish",
    "Launch Council Wars / Skirmish on selected map",
  );
  launchSkirmishButton.classList.add("war-room-primary-button");

  skirmishInspector.append(inspectorDetails, launchSkirmishButton);
  skirmishContent.append(skirmishGrid, skirmishInspector);
  skirmishPanel.append(skirmishToolbar, skirmishContent);

  body.append(campaignPanel, skirmishPanel);

  // Footer: mute button + close button
  const footer = document.createElement("footer");
  footer.className = "war-room-footer";
  const muteButton = makeActionButton("mute", "Sound: On", "Toggle briefing voiceover mute");
  const closeButton = makeActionButton("close", "Back", "Close War Room (Escape)");
  closeButton.classList.add("war-room-close");
  footer.append(muteButton, closeButton);

  // Hidden audio element for mission voiceover playback (H1..15.ogg / G1..15.ogg)
  const audio = document.createElement("audio");
  audio.className = "war-room-audio";
  audio.preload = "auto";

  sceneContainer.append(topbar, body, footer, audio);
  dialog.append(sceneContainer);

  const data = options.data ?? (await loadCampaignScenesData({ signal }));

  let currentTab: WarRoomTab = options.initialTab ?? "human";
  let activeFaction: WarRoomFaction = currentTab === "alien" ? "alien" : "human";
  let activeMissionByFaction: Record<WarRoomFaction, number> = {
    human:
      options.initialMissionNumber &&
      options.initialMissionNumber >= 1 &&
      options.initialMissionNumber <= 15
        ? options.initialMissionNumber
        : 1,
    alien:
      options.initialMissionNumber &&
      options.initialMissionNumber >= 1 &&
      options.initialMissionNumber <= 15
        ? options.initialMissionNumber
        : 1,
  };
  let environmentFilter: SkirmishEnvironmentFilter = options.initialEnvironmentFilter ?? "all";
  let playersFilter: SkirmishPlayersFilter = options.initialPlayersFilter ?? "all";
  let activeSkirmishStem =
    options.initialSkirmishStem?.trim().toUpperCase() ||
    data.skirmishMaps[0]?.stem ||
    "A2PLAY01";
  let muted = Boolean(options.muted);
  const autoplayAudio = options.autoplayAudio ?? true;
  let audioPlaying = false;
  let briefingLoadToken = 0;

  const missionButtons = new Map<number, HTMLButtonElement>();
  const skirmishButtons = new Map<string, HTMLButtonElement>();

  const getActiveScene = (): CampaignSceneRecord => {
    const list = data.campaigns[activeFaction];
    const num = activeMissionByFaction[activeFaction];
    return list.find((item) => item.missionNumber === num) ?? list[0];
  };

  const filteredSkirmishMaps = (): readonly SkirmishMapRecord[] =>
    data.skirmishMaps.filter((map) => {
      if (environmentFilter !== "all" && map.environment !== environmentFilter) return false;
      if (playersFilter !== "all" && map.maxPlayers !== playersFilter) return false;
      return true;
    });

  const getActiveSkirmishMap = (): SkirmishMapRecord | undefined =>
    data.skirmishMaps.find((item) => item.stem === activeSkirmishStem) ??
    filteredSkirmishMaps()[0] ??
    data.skirmishMaps[0];

  const stopBriefingVoice = (): void => {
    audioPlaying = false;
    playVoiceButton.dataset.playing = "false";
    playVoiceButton.setAttribute("aria-pressed", "false");
    try {
      audio.pause();
    } catch {
      // Ignore in stub environments
    }
    try {
      audio.currentTime = 0;
    } catch {
      // Ignore in stub environments
    }
  };

  const teardownAudio = (): void => {
    stopBriefingVoice();
    audio.removeAttribute("src");
    audio.src = "";
    if (typeof audio.load === "function") {
      try {
        audio.load();
      } catch {
        // Ignore in stub environments
      }
    }
  };

  const updateMuteUI = (): void => {
    audio.muted = muted;
    muteButton.textContent = muted ? "Sound: Off" : "Sound: On";
    muteButton.setAttribute("aria-pressed", String(!muted));
  };

  const playBriefingVoice = async (): Promise<void> => {
    if (signal.aborted || currentTab === "skirmish") return;
    const scene = getActiveScene();
    if (!scene) return;
    const expectedSrc = assetUrl(scene.voicePath);
    if (audio.getAttribute("src") !== expectedSrc) {
      audio.src = expectedSrc;
      audio.setAttribute("src", expectedSrc);
    }
    audio.dataset.faction = scene.faction;
    audio.dataset.missionNumber = String(scene.missionNumber);
    audio.muted = muted;
    try {
      audio.currentTime = 0;
    } catch {
      // Ignore in stub environments
    }
    try {
      audioPlaying = true;
      playVoiceButton.dataset.playing = "true";
      playVoiceButton.setAttribute("aria-pressed", "true");
      await audio.play();
    } catch {
      audioPlaying = false;
      playVoiceButton.dataset.playing = "false";
      playVoiceButton.setAttribute("aria-pressed", "false");
    }
  };

  audio.addEventListener(
    "ended",
    () => {
      audioPlaying = false;
      playVoiceButton.dataset.playing = "false";
      playVoiceButton.setAttribute("aria-pressed", "false");
    },
    { signal },
  );

  const renderBriefingTranscript = (briefing: MissionBriefingData): void => {
    const tokens = warRoomBriefingTokens(briefing.rawText);
    readableTranscript.textContent = tokens.map((token) => token.text).join("");
    const spans = tokens.map((token) => {
      const span = document.createElement("span");
      span.className = `war-room-ink-${token.style}`;
      span.textContent = token.text;
      return span;
    });
    styledTranscript.replaceChildren(...spans);
    briefingTranscript.scrollTop = 0;

    const objectiveItems = (
      briefing.objectives.length > 0 ? briefing.objectives : [briefing.plainText]
    ).map((obj) => {
      const li = document.createElement("li");
      li.className = "war-room-objective-item";
      li.textContent = obj;
      return li;
    });
    objectivesList.replaceChildren(...objectiveItems);
  };

  const loadAndRenderBriefing = async (scene: CampaignSceneRecord): Promise<void> => {
    const token = ++briefingLoadToken;
    readableTranscript.textContent = "Loading briefing transcript...";
    styledTranscript.replaceChildren();
    objectivesList.replaceChildren();
    try {
      const briefing = await loadMissionBriefingData(scene.briefingPath, signal);
      if (token !== briefingLoadToken || signal.aborted) return;
      renderBriefingTranscript(briefing);
    } catch {
      if (token !== briefingLoadToken || signal.aborted) return;
      readableTranscript.textContent = "Briefing transcript unavailable.";
    }
  };

  const renderMissionList = (): void => {
    const scenes = data.campaigns[activeFaction];
    const currentNum = activeMissionByFaction[activeFaction];
    missionButtons.clear();
    const buttons = scenes.map((scene) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "war-room-mission-button";
      btn.setAttribute("role", "option");
      btn.dataset.warRoomMission = String(scene.missionNumber);
      btn.dataset.faction = scene.faction;
      const isSelected = scene.missionNumber === currentNum;
      btn.dataset.active = String(isSelected);
      btn.setAttribute("aria-selected", String(isSelected));

      const numSpan = document.createElement("span");
      numSpan.className = "war-room-mission-num";
      numSpan.textContent = `Mission ${String(scene.missionNumber).padStart(2, "0")}`;

      const nameSpan = document.createElement("strong");
      nameSpan.className = "war-room-mission-name";
      nameSpan.textContent = scene.title;

      const locSpan = document.createElement("span");
      locSpan.className = "war-room-mission-loc";
      locSpan.textContent = scene.location;

      btn.append(numSpan, nameSpan, locSpan);
      missionButtons.set(scene.missionNumber, btn);
      return btn;
    });
    missionList.replaceChildren(...buttons);
  };

  const updateActiveMissionUI = (triggerAudio: boolean): void => {
    const scene = getActiveScene();
    if (!scene) return;

    sceneContainer.dataset.activeFaction = scene.faction;
    sceneContainer.dataset.activeMission = String(scene.missionNumber);

    for (const [num, btn] of missionButtons.entries()) {
      const active = num === scene.missionNumber;
      btn.dataset.active = String(active);
      btn.setAttribute("aria-selected", String(active));
    }

    const factionTitle = scene.faction === "human" ? "HUMAN CAMPAIGN" : "TAAR / ALIEN CAMPAIGN";
    missionBadge.textContent = `${factionTitle} · MISSION ${String(scene.missionNumber).padStart(2, "0")}`;
    missionTitle.textContent = scene.title;
    missionLocation.textContent = scene.location;

    const makeMetaTag = (text: string): HTMLElement => {
      const tag = document.createElement("span");
      tag.className = "war-room-meta-tag";
      tag.textContent = text;
      return tag;
    };
    const introStem =
      scene.introVideo?.stem ??
      scene.introVideoStem ??
      scene.introAvi.replace(/^avi\//i, "").replace(/\.avi$/i, "").toUpperCase();
    const outroStem =
      scene.outroVideo?.stem ??
      scene.outroVideoStem ??
      scene.outroAvi.replace(/^avi\//i, "").replace(/\.avi$/i, "").toUpperCase();

    sceneMeta.replaceChildren(
      makeMetaTag(`SCN: ${scene.scnPath.toUpperCase()}`),
      makeMetaTag(`VICTORY AVI: ${introStem}`),
      makeMetaTag(`DEFEAT AVI: ${outroStem}`),
    );

    watchCutsceneButton.dataset.cutsceneStem = introStem;
    watchCutsceneButton.disabled = !introStem;
    watchCutsceneButton.textContent = introStem ? `Watch Cutscene (${introStem})` : "Watch Cutscene";

    watchOutroButton.dataset.cutsceneStem = outroStem;
    watchOutroButton.disabled = !outroStem;
    watchOutroButton.textContent = outroStem ? `Defeat Cutscene (${outroStem})` : "Defeat Cutscene";

    launchMissionButton.dataset.faction = scene.faction;
    launchMissionButton.dataset.missionNumber = String(scene.missionNumber);
    launchMissionButton.textContent = `Launch ${scene.faction === "human" ? "Human" : "Alien"} Mission ${scene.missionNumber}`;

    void loadAndRenderBriefing(scene);

    stopBriefingVoice();
    const voiceUrl = assetUrl(scene.voicePath);
    audio.src = voiceUrl;
    audio.setAttribute("src", voiceUrl);
    audio.dataset.faction = scene.faction;
    audio.dataset.missionNumber = String(scene.missionNumber);
    if (triggerAudio && autoplayAudio && !muted && currentTab !== "skirmish") {
      void playBriefingVoice();
    }
  };

  const renderSkirmishInspector = (): void => {
    const mapEntry = getActiveSkirmishMap();
    if (!mapEntry) {
      inspectorBadge.textContent = "NO MAP MATCHING FILTERS";
      inspectorTitle.textContent = "--";
      inspectorSubtitle.textContent = "Adjust environment or player count filters";
      inspectorRows.replaceChildren();
      launchSkirmishButton.disabled = true;
      return;
    }

    launchSkirmishButton.disabled = false;
    launchSkirmishButton.dataset.skirmishStem = mapEntry.stem;
    inspectorBadge.textContent = `COUNCIL WARS · ${mapEntry.family} SERIES`;
    inspectorTitle.textContent = mapEntry.title || mapEntry.stem;
    inspectorSubtitle.textContent = `${mapEntry.stem} · ${environmentLabel(mapEntry.environment).toUpperCase()}`;

    const rowsData: readonly [string, string][] = [
      ["Map Stem", mapEntry.stem],
      ["Environment", environmentLabel(mapEntry.environment)],
      ["Max Players", `${mapEntry.maxPlayers}P (${mapEntry.maxPlayers} Players)`],
      ["Dimensions", `${mapEntry.width} × ${mapEntry.height} cells`],
      ["Scenario Readiness", mapEntry.hasScenarioData ? "Scenario Ready" : "Map Only"],
      ["Map Asset", mapEntry.mapPath],
    ];
    const rowElements = rowsData.map(([label, value]) => {
      const row = document.createElement("div");
      row.className = "war-room-inspector-row";
      const k = document.createElement("span");
      k.textContent = label;
      const v = document.createElement("strong");
      v.textContent = value;
      row.append(k, v);
      return row;
    });
    inspectorRows.replaceChildren(...rowElements);
  };

  const renderSkirmishList = (): void => {
    for (const [envId, btn] of envFilterButtons.entries()) {
      const active = envId === environmentFilter;
      btn.dataset.active = String(active);
      btn.setAttribute("aria-pressed", String(active));
    }
    for (const [playersId, btn] of playerFilterButtons.entries()) {
      const active = playersId === playersFilter;
      btn.dataset.active = String(active);
      btn.setAttribute("aria-pressed", String(active));
    }

    const filtered = filteredSkirmishMaps();
    if (!filtered.some((m) => m.stem === activeSkirmishStem) && filtered.length > 0) {
      activeSkirmishStem = filtered[0].stem;
    }
    skirmishSummary.textContent = `${filtered.length} / ${data.skirmishMaps.length} MAPS`;

    skirmishButtons.clear();
    const cards = filtered.map((map) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "war-room-skirmish-card";
      card.setAttribute("role", "option");
      card.dataset.skirmishMap = map.stem;
      card.dataset.environment = map.environment;
      card.dataset.maxPlayers = String(map.maxPlayers);
      card.dataset.dimensions = `${map.width}x${map.height}`;
      card.dataset.hasScenarioData = String(map.hasScenarioData);
      const isSelected = map.stem === activeSkirmishStem;
      card.dataset.active = String(isSelected);
      card.setAttribute("aria-selected", String(isSelected));

      const topRow = document.createElement("div");
      topRow.className = "war-room-card-top";
      const stemSpan = document.createElement("strong");
      stemSpan.className = "war-room-card-stem";
      stemSpan.textContent = map.stem;
      const playersSpan = document.createElement("span");
      playersSpan.className = "war-room-card-players";
      playersSpan.textContent = `${map.maxPlayers}P`;
      topRow.append(stemSpan, playersSpan);

      const titleSpan = document.createElement("span");
      titleSpan.className = "war-room-card-title";
      titleSpan.textContent = map.title || map.stem;

      const badgesRow = document.createElement("div");
      badgesRow.className = "war-room-card-badges";

      const envBadge = document.createElement("span");
      envBadge.className = "war-room-badge";
      envBadge.dataset.environment = map.environment;
      envBadge.textContent = environmentLabel(map.environment);

      const dimBadge = document.createElement("span");
      dimBadge.className = "war-room-badge";
      dimBadge.textContent = `${map.width}×${map.height}`;

      const readyBadge = document.createElement("span");
      readyBadge.className = "war-room-badge";
      readyBadge.dataset.scenarioReady = String(map.hasScenarioData);
      readyBadge.textContent = map.hasScenarioData ? "Scenario Ready" : "Map Only";

      badgesRow.append(envBadge, dimBadge, readyBadge);
      card.append(topRow, titleSpan, badgesRow);
      skirmishButtons.set(map.stem, card);
      return card;
    });

    skirmishGrid.replaceChildren(...cards);
    renderSkirmishInspector();
  };

  const selectTab = (nextTab: WarRoomTab, forceRender = false): void => {
    if (!forceRender && currentTab === nextTab) return;
    currentTab = nextTab;
    sceneContainer.dataset.activeTab = nextTab;
    sceneContainer.style.backgroundImage = `url("${assetUrl(tabBackgroundPath(nextTab))}")`;

    for (const [tabId, btn] of tabButtons.entries()) {
      const active = tabId === nextTab;
      btn.setAttribute("aria-selected", String(active));
      btn.dataset.active = String(active);
    }

    if (nextTab === "skirmish") {
      teardownAudio();
      campaignPanel.setAttribute("hidden", "");
      skirmishPanel.removeAttribute("hidden");
      renderSkirmishList();
    } else {
      activeFaction = nextTab;
      skirmishPanel.setAttribute("hidden", "");
      campaignPanel.removeAttribute("hidden");
      renderMissionList();
      updateActiveMissionUI(true);
    }
  };

  const selectMission = (missionNumber: number): void => {
    if (!Number.isInteger(missionNumber) || missionNumber < 1 || missionNumber > 15) return;
    const changed = activeMissionByFaction[activeFaction] !== missionNumber;
    activeMissionByFaction[activeFaction] = missionNumber;
    if (currentTab === "skirmish") {
      selectTab(activeFaction, true);
      return;
    }
    updateActiveMissionUI(changed || audio.paused);
  };

  const selectSkirmishMap = (stem: string): void => {
    const normalized = stem.trim().toUpperCase();
    const mapEntry = data.skirmishMaps.find((m) => m.stem === normalized);
    if (!mapEntry) return;
    activeSkirmishStem = mapEntry.stem;
    sceneContainer.dataset.activeSkirmishMap = mapEntry.stem;
    for (const [cardStem, card] of skirmishButtons.entries()) {
      const active = cardStem === mapEntry.stem;
      card.dataset.active = String(active);
      card.setAttribute("aria-selected", String(active));
    }
    renderSkirmishInspector();
  };

  const setEnvironmentFilter = (environment: SkirmishEnvironmentFilter): void => {
    environmentFilter = environment;
    sceneContainer.dataset.environmentFilter = environment;
    renderSkirmishList();
  };

  const setPlayersFilter = (players: SkirmishPlayersFilter): void => {
    playersFilter = players;
    sceneContainer.dataset.playersFilter = String(players);
    renderSkirmishList();
  };

  const watchCutscene = async (kind: "intro" | "outro" = "intro"): Promise<void> => {
    const scene = getActiveScene();
    if (!scene) return;
    const rawAvi = kind === "intro" ? scene.introAvi : scene.outroAvi;
    const stem =
      (kind === "intro"
        ? scene.introVideo?.stem ?? scene.introVideoStem
        : scene.outroVideo?.stem ?? scene.outroVideoStem) ??
      rawAvi.replace(/^avi\//i, "").replace(/\.avi$/i, "").toUpperCase();
    if (!stem) return;
    stopBriefingVoice();
    if (options.onWatchCutscene) {
      await options.onWatchCutscene(stem, scene, kind);
      return;
    }
    await playCinematic(stem, {
      muted,
      onMutedChange: (nextMuted) => {
        muted = nextMuted;
        updateMuteUI();
        options.onMutedChange?.(muted);
      },
    });
  };

  const cleanup = (): void => {
    if (closedResolved) return;
    closedResolved = true;
    controller.abort();
    teardownAudio();
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", onPageHide);
    }
    try {
      dialog.close();
    } catch {
      // Ignore if already closed
    }
    dialog.remove();
    if (activeWarRoomClose === cleanup) {
      activeWarRoomClose = undefined;
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

  const launchMission = (): void => {
    const scene = getActiveScene();
    if (!scene) return;
    const faction = scene.faction;
    const missionNumber = scene.missionNumber;
    cleanup();
    options.onLaunchCampaignMission?.(faction, missionNumber, scene);
  };

  const launchSkirmish = (stem?: string): void => {
    if (stem) {
      selectSkirmishMap(stem);
    }
    const mapEntry = getActiveSkirmishMap();
    if (!mapEntry) return;
    cleanup();
    options.onLaunchSkirmish?.(mapEntry);
  };

  const onPageHide = (): void => cleanup();
  activeWarRoomClose = cleanup;

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

      const tabBtn =
        typeof target.closest === "function"
          ? target.closest<HTMLButtonElement>("[data-war-room-tab]")
          : target.dataset?.warRoomTab
            ? (target as HTMLButtonElement)
            : null;
      if (tabBtn?.dataset.warRoomTab) {
        selectTab(tabBtn.dataset.warRoomTab as WarRoomTab);
        return;
      }

      const missionBtn =
        typeof target.closest === "function"
          ? target.closest<HTMLButtonElement>("[data-war-room-mission]")
          : target.dataset?.warRoomMission
            ? (target as HTMLButtonElement)
            : null;
      if (missionBtn?.dataset.warRoomMission) {
        selectMission(Number(missionBtn.dataset.warRoomMission));
        return;
      }

      const envBtn =
        typeof target.closest === "function"
          ? target.closest<HTMLButtonElement>("[data-skirmish-environment]")
          : target.dataset?.skirmishEnvironment
            ? (target as HTMLButtonElement)
            : null;
      if (envBtn?.dataset.skirmishEnvironment) {
        setEnvironmentFilter(envBtn.dataset.skirmishEnvironment as SkirmishEnvironmentFilter);
        return;
      }

      const playersBtn =
        typeof target.closest === "function"
          ? target.closest<HTMLButtonElement>("[data-skirmish-players]")
          : target.dataset?.skirmishPlayers
            ? (target as HTMLButtonElement)
            : null;
      if (playersBtn?.dataset.skirmishPlayers) {
        const raw = playersBtn.dataset.skirmishPlayers;
        setPlayersFilter(raw === "all" ? "all" : (Number(raw) as 2 | 4 | 6 | 8));
        return;
      }

      const mapCard =
        typeof target.closest === "function"
          ? target.closest<HTMLButtonElement>("[data-skirmish-map]")
          : target.dataset?.skirmishMap
            ? (target as HTMLButtonElement)
            : null;
      if (mapCard?.dataset.skirmishMap) {
        selectSkirmishMap(mapCard.dataset.skirmishMap);
        return;
      }

      const actionBtn =
        typeof target.closest === "function"
          ? target.closest<HTMLButtonElement>("[data-war-room-action]")
          : target.dataset?.warRoomAction
            ? (target as HTMLButtonElement)
            : null;
      if (!actionBtn?.dataset.warRoomAction) return;

      const action = actionBtn.dataset.warRoomAction;
      if (action === "close") {
        cleanup();
      } else if (action === "play-voice") {
        void playBriefingVoice();
      } else if (action === "stop-voice") {
        stopBriefingVoice();
      } else if (action === "watch-cutscene") {
        void watchCutscene("intro");
      } else if (action === "watch-outro-cutscene") {
        void watchCutscene("outro");
      } else if (action === "launch-mission") {
        launchMission();
      } else if (action === "launch-skirmish") {
        launchSkirmish();
      } else if (action === "mute") {
        muted = !muted;
        updateMuteUI();
        if (muted) stopBriefingVoice();
        options.onMutedChange?.(muted);
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

  dialog.addEventListener(
    "keydown",
    (event) => {
      const keyEvent = event as KeyboardEvent;
      if (keyEvent.key === "Escape") {
        keyEvent.preventDefault();
        cleanup();
      }
    },
    { signal },
  );

  updateMuteUI();
  parent.append(dialog);
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }

  selectTab(currentTab, true);
  closeButton.focus();

  return {
    dialog,
    audio,
    closed,
    close: cleanup,
    selectTab: (tab) => selectTab(tab),
    selectMission,
    selectSkirmishMap,
    setEnvironmentFilter,
    setPlayersFilter,
    playBriefingVoice,
    stopBriefingVoice,
    watchCutscene,
    launchMission,
    launchSkirmish,
    getState: () => ({
      tab: currentTab,
      activeFaction,
      activeMissionNumber: activeMissionByFaction[activeFaction],
      activeScene: getActiveScene(),
      activeSkirmishStem,
      activeSkirmishMap: getActiveSkirmishMap(),
      environmentFilter,
      playersFilter,
      filteredSkirmishCount: filteredSkirmishMaps().length,
      muted,
      audioPlaying: !audio.paused && audioPlaying,
    }),
  };
}

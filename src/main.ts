import "./style.css";
import { assetUrl } from "./asset-url";
import { SIMULATION_TICKS_PER_SECOND, type Faction } from "./engine";
import { campaignConstructionPolicy, campaignResultAction, loadCampaignMission, loadSkirmishBalance } from "./game-data";
import { MissionView } from "./mission-view";
import { SkirmishView, type SkirmishStats } from "./simulation-view";
import { WebAudioManager } from "./audio";
import { NativeMissionMusic } from "./audio/native-mission-music";
import { bindControlGroups, createRadar, ORIGINAL_HUD, snapshotRadarEntities } from "./ui";
import { createMissionCursorController, loadMissionCursorAnimation, MISSION_CURSOR_FALLBACKS, type MissionCursor } from "./ui/mission-cursor";
import { readMissionSave, writeMissionSave, type MissionSaveSlot, type SavedMission } from "./mission-save";
import type { LegacyCampaignImportConsent } from "./engine/campaign-session-legacy-import";
import { baseMenuEntries, createBaseMenu } from "./ui/base-menu";
import { createMobileControls, isPhoneUserAgent } from "./ui/mobile-controls";
import { createMobileMissionMenu, type MobileMissionMenuState } from "./ui/mobile-mission-menu";
import { createMissionSaveMenu } from "./ui/mission-save-menu";
import { createCameraPan } from "./ui/camera-pan";
import { createFrameStatistics } from "./ui/frame-statistics";
import { createCampaignMissionPicker } from "./ui/campaign-mission-picker";
import { cancelCampaignIntro, shouldShowCampaignIntro, showCampaignIntro, type CampaignLaunchReason } from "./ui/campaign-intro";
import { cancelCinematic, INTRO_CINEMATIC, outcomeCinematic, playCinematic } from "./ui/cinematics";
import "./ui/campaign-intro.css";
import "./ui/mobile-controls.css";
import "./ui/mobile-mission-menu.css";
import "./ui/game-menu.css";

interface SpriteIndexArchive {
  readonly source: string;
  readonly metadata: string;
  readonly atlas: string;
  readonly encoding: "compressed" | "raw";
  readonly frameCount: number;
  readonly emptyFrameCount: number;
  readonly atlasWidth: number;
  readonly atlasHeight: number;
}

interface SpriteIndex {
  readonly archiveCount: number;
  readonly frameCount: number;
  readonly archives: readonly SpriteIndexArchive[];
}

interface SpriteFrame {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly encodedBytes: number;
  readonly empty: boolean;
}

interface SpriteMetadata {
  readonly paletteScale: "6-bit" | "8-bit";
  readonly frames: readonly SpriteFrame[];
}

interface AnimationIndexEntry {
  readonly source: string;
  readonly status: "invalid" | "parsed" | "unsupported";
  readonly metadata?: string;
}

interface AnimationIndex {
  readonly entries: readonly AnimationIndexEntry[];
}

interface AnimationState {
  readonly name: string;
  readonly firstTimelineIndex: number;
  readonly lastTimelineIndex: number;
  readonly validRange: boolean;
}

interface AnimationChild {
  readonly sprite: string;
  readonly frame: number;
}

interface AnimationMetadata {
  readonly states: readonly AnimationState[];
  readonly timeline: readonly { readonly children: readonly AnimationChild[] }[];
}

interface TerrainIndexEntry {
  readonly source: { readonly path: string };
  readonly metadata: string;
  readonly atlas: string;
  readonly keySpace: number;
  readonly tileCount: number;
}

interface TerrainIndex {
  readonly bankCount: number;
  readonly tileCount: number;
  readonly banks: readonly TerrainIndexEntry[];
}

interface TerrainMetadata {
  readonly paletteScale: "6-bit" | "8-bit";
  readonly atlas: { readonly width: number; readonly height: number };
  readonly tiles: readonly {
    readonly key: number;
    readonly x: number;
    readonly y: number;
    readonly width: 32;
    readonly height: 32;
  }[];
}

interface MediaEntry {
  readonly kind: "audio" | "video";
  readonly source: string;
  readonly outputs: readonly {
    readonly path: string;
    readonly bytes: number;
    readonly mimeType: string;
    readonly codecs: readonly string[];
  }[];
}

interface MediaIndex {
  readonly audioCount: number;
  readonly videoCount: number;
  readonly entries: readonly MediaEntry[];
}

type AssetMode = "campaign" | "media" | "simulation" | "sprites" | "terrain";
type GameSessionMode = "campaign" | "simulation";

const ASSET_ROOT = assetUrl("/assets/generated/sprites");
const ANIMATION_ROOT = assetUrl("/assets/generated/animations");
const TERRAIN_ROOT = assetUrl("/assets/generated/terrain");
const MEDIA_ROOT = assetUrl("/assets/generated/media");
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app mount point");

app.innerHTML = `
  <main class="asset-lab main-menu-active">
    <header class="topbar">
      <div class="brand-lockup">
        <span class="brand-mark" aria-hidden="true">DC</span>
        <div><h1>Dark Colony</h1><p id="dataset-title">SOURCE MISSION LOADER</p></div>
      </div>
      <div class="top-actions">
        <div class="dataset-switch" aria-label="Asset type">
          <button type="button" data-mode="campaign" class="selected">MISSION</button>
          <button type="button" data-mode="sprites">SPRITES</button>
          <button type="button" data-mode="terrain">TERRAIN</button>
          <button type="button" data-mode="media">MEDIA</button>
          <button type="button" data-mode="simulation">SIM</button>
        </div>
        <div class="build-state"><i></i><span>DECODER ONLINE</span></div>
      </div>
    </header>

    <section class="workbench">
      <aside class="archive-panel" aria-label="Campaign and archive browser">
        <div class="archive-tools">
          <label id="archive-tools-label" for="archive-filter">MISSIONS</label>
          <input id="archive-filter" type="search" placeholder="Filter archives" autocomplete="off" />
          <span id="archive-summary">LOADING INDEX</span>
        </div>
        <div id="archive-list" class="archive-list" role="listbox" aria-label="Decoded sprite archives"></div>
      </aside>

      <section class="preview-panel" aria-label="Game and asset preview">
        <div class="preview-heading">
          <div><p id="archive-path">AWAITING ASSET INDEX</p><h2 id="archive-name">NO ARCHIVE</h2></div>
          <div class="preview-modes">
            <select id="animation-state" aria-label="Animation state" disabled>
              <option value="">RAW FRAMES</option>
            </select>
            <span id="encoding-badge">--</span>
          </div>
        </div>
        <div id="preview-stage" class="preview-stage">
          <section id="campaign-launcher" class="campaign-launcher campaign-picker-enabled" aria-labelledby="campaign-launch-title" inert>
            <header class="start-menu-brand">
              <p>THE BATTLE FOR MARS</p>
              <h2 id="campaign-launch-title">Dark <span>Colony</span></h2>
              <small>BROWSER EDITION</small>
            </header>
            <div class="start-menu-panel">
              <nav data-menu-screen="home" class="start-menu-actions" aria-label="Main menu">
                <button id="continue-mission" type="button" hidden>Continue</button>
                <button type="button" data-menu-open="new">New game</button>
                <button type="button" data-menu-load>Load game</button>
                <button type="button" data-menu-open="options">Options</button>
              </nav>
              <section data-menu-screen="new" aria-labelledby="new-game-title" hidden>
                <h3 id="new-game-title">New campaign</h3>
                <p class="start-menu-hint">Choose your side. Your saved games will not be replaced.</p>
                <div class="faction-selector">
                  <button type="button" class="human" data-campaign-faction="human">
                    <picture class="mission-picker-portrait"><img src="${assetUrl("/assets/generated/sprites/INTRFACE/HCOM.png")}" alt="" /></picture>
                    <strong>Human</strong><small>Begin the human campaign</small>
                  </button>
                  <button type="button" class="alien" data-campaign-faction="alien">
                    <picture class="mission-picker-portrait"><img src="${assetUrl("/assets/generated/sprites/INTRFACE/ACOM.png")}" alt="" /></picture>
                    <strong>Alien</strong><small>Begin the alien campaign</small>
                  </button>
                </div>
                <details class="mission-select-details"><summary>Mission select</summary>
                  <div id="campaign-mission-picker"></div>
                </details>
              </section>
              <section data-menu-screen="options" aria-labelledby="menu-options-title" hidden>
                <h3 id="menu-options-title">Options</h3>
                <div class="start-menu-actions">
                  <button id="menu-sound" type="button" aria-pressed="false">Sound: off</button>
                  <button id="play-intro" type="button">Watch introduction</button>
                  <button id="open-asset-browser" type="button">Extras: asset browser</button>
                </div>
                <p class="start-menu-hint">The opening movie never plays automatically. Mission briefings remain available when starting a campaign.</p>
              </section>
              <button id="menu-back" type="button" hidden>Back to main menu</button>
              <p id="continue-status" role="status" hidden></p>
            </div>
            <footer class="start-menu-footer">Human &amp; alien campaigns <span>Manual saves / 3 slots / This device</span></footer>
          </section>
          <div id="mission-shell" class="mission-shell" hidden>
            <img class="mission-frame-art" src="${assetUrl("/assets/generated/interface/INTRFACE.GIF")}" alt="" />
            <canvas id="mission-canvas" tabindex="0" aria-label="Dark Colony mission viewport"></canvas>
            <div id="campaign-controls" class="campaign-controls" hidden>
              <canvas id="mission-radar" aria-label="Mission radar" hidden></canvas>
              <div class="legacy-portrait" aria-hidden="true"><img id="legacy-portrait-image" alt="" /></div>
              <strong id="campaign-faction">HUMAN01</strong>
              <span id="campaign-selection">1 SELECTED</span>
              <div id="mission-base-menu" class="original-base-menu"></div>
              <p id="mission-message"></p>
              <button id="mission-music-control" type="button" title="Play mission music" aria-label="Play mission music" hidden>&#9654;</button>
              <audio id="mission-soundtrack" preload="none" muted hidden></audio>
              <div id="mission-options-menu" class="original-options-menu" role="group" aria-label="Game options" hidden>
                <button id="exit-campaign" class="original-menu-button" type="button" title="Quit to missions" aria-label="Quit to missions"></button>
                <button id="save-mission" class="original-menu-button" type="button" title="Save game" aria-label="Save mission"></button>
                <label id="mission-mute-label" class="original-menu-button" title="Options: mute sound"><input id="mission-mute" type="checkbox" checked /> MUTE</label>
                <button id="mission-allies" class="original-menu-button" type="button" title="Allies menu (unavailable)" aria-label="Allies menu (unavailable)" disabled></button>
                <button id="mission-pause" class="original-menu-button" type="button" title="Pause (unavailable)" aria-label="Pause (unavailable)" disabled></button>
                <button id="show-objectives" class="original-menu-button" type="button" title="Objectives (J)" aria-label="Objectives"></button>
                <button id="select-all-units" class="legacy-text-command" type="button">SELECT ALL</button>
                <button id="load-mission" class="legacy-text-command" type="button">LOAD GAME</button>
                <span id="save-mission-status" role="status" aria-live="polite"></span>
              </div>
              <div class="legacy-command-grid" hidden>
                <button id="stop-units" type="button" title="Stop selected units" aria-label="Stop selected units">
                  <span class="legacy-button-sprite button-stop"></span>
                </button>
                <button id="move-units" type="button" title="Move only (M)" aria-label="Move only" aria-pressed="false">
                  <span class="legacy-button-sprite button-move"></span>
                </button>
                <button id="assault-units" type="button" title="Move and attack (A)" aria-label="Move and attack" aria-pressed="true">
                  <span class="legacy-button-sprite button-assault"></span>
                </button>
                <button id="waypoint-units" type="button" title="Set waypoints (W)" aria-label="Set waypoints">
                  <span class="legacy-button-sprite button-waypoints"></span>
                </button>
                <button id="patrol-units" type="button" title="Patrol route (P)" aria-label="Patrol route" aria-pressed="false">
                  <span class="legacy-button-sprite button-waypoints"></span><span class="command-key">P</span>
                </button>
                <button id="inspire-units" type="button" title="Inspire Troops (select a lieutenant)" aria-label="Inspire Troops (select a lieutenant)" disabled>
                  <span class="legacy-button-sprite button-inspire"></span>
                </button>
                <button id="deploy-units" type="button" title="Deploy SARGE" aria-label="Deploy SARGE" aria-pressed="false" hidden>
                  <span class="legacy-button-sprite button-deploy"></span>
                </button>
              </div>
            </div>
            <section id="objectives-panel" class="objectives-panel" aria-labelledby="objectives-title" hidden>
              <p>MISSION DATA / READ ONLY</p>
              <h3 id="objectives-title">MISSION OBJECTIVES</h3>
              <ul id="objectives-list"></ul>
              <button id="close-objectives" type="button">RETURN TO BATTLE</button>
            </section>
            <section id="mission-result" class="objectives-panel" aria-labelledby="mission-result-title" hidden>
              <h3 id="mission-result-title">MISSION RESULT</h3>
              <p id="mission-result-detail"></p>
              <button id="mission-result-action" type="button" hidden>NEXT MISSION</button>
              <button id="mission-result-exit" type="button">MISSIONS</button>
            </section>
            <div class="legacy-status-strip">
              <span id="legacy-mission-name" hidden>HUMAN01</span>
              <span id="frame-statistics" aria-label="Frame-rate statistics">FPS -- AVG -- LOW --</span>
              <span id="legacy-tick">TICK 0</span>
            </div>
          </div>
          <div id="selection-box" class="selection-box" hidden></div>
          <canvas id="sprite-canvas" aria-label="Decoded sprite frame"></canvas>
          <video id="media-video" controls playsinline hidden></video>
          <div id="audio-stage" hidden><audio id="media-audio" controls></audio></div>
          <div id="load-state" class="load-state" role="status" aria-live="polite">LOADING</div>
          <span id="frame-watermark" class="frame-watermark">FRAME --</span>
        </div>
        <div class="transport" aria-label="Frame controls">
          <button id="previous-frame" type="button" title="Previous frame" aria-label="Previous frame">&#8249;</button>
          <button id="toggle-playback" type="button" title="Play animation" aria-label="Play animation">&#9654;</button>
          <button id="next-frame" type="button" title="Next frame" aria-label="Next frame">&#8250;</button>
          <input id="frame-slider" type="range" min="0" max="0" value="0" aria-label="Frame" />
          <output id="frame-position" for="frame-slider">0 / 0</output>
        </div>
        <dl class="frame-data">
          <div><dt id="frame-label">FRAME</dt><dd id="frame-size">--</dd></div>
          <div><dt id="anchor-label">ANCHOR</dt><dd id="frame-anchor">--</dd></div>
          <div><dt id="atlas-label">ATLAS</dt><dd id="atlas-size">--</dd></div>
          <div><dt id="palette-label">PALETTE</dt><dd id="palette-scale">--</dd></div>
          <div><dt id="payload-label">PAYLOAD</dt><dd id="payload-size">--</dd></div>
        </dl>
      </section>
    </section>

    <footer class="statusbar">
      <span id="decoder-status">INDEX PENDING</span>
      <span>RGBA / LOSSLESS PNG</span>
      <span>60 FPS VIEWPORT</span>
    </footer>
  </main>
`;

function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing element: ${selector}`);
  return found;
}

const archiveFilter = element<HTMLInputElement>("#archive-filter");
const archiveToolsLabel = element<HTMLLabelElement>("#archive-tools-label");
const archiveList = element<HTMLDivElement>("#archive-list");
const archiveSummary = element<HTMLSpanElement>("#archive-summary");
const archivePath = element<HTMLParagraphElement>("#archive-path");
const archiveName = element<HTMLHeadingElement>("#archive-name");
const animationState = element<HTMLSelectElement>("#animation-state");
const encodingBadge = element<HTMLSpanElement>("#encoding-badge");
const previewStage = element<HTMLDivElement>("#preview-stage");
const assetLab = element<HTMLElement>(".asset-lab");
const phoneControlsEnabled = isPhoneUserAgent(navigator.userAgent);
assetLab.classList.toggle("phone-controls-enabled", phoneControlsEnabled);
const canvas = element<HTMLCanvasElement>("#sprite-canvas");
const missionShell = element<HTMLDivElement>("#mission-shell");
const missionCanvas = element<HTMLCanvasElement>("#mission-canvas");
const radarCanvas = element<HTMLCanvasElement>("#mission-radar");
const missionMute = element<HTMLInputElement>("#mission-mute");
const missionMusicControl = element<HTMLButtonElement>("#mission-music-control");
const missionSoundtrackMedia = element<HTMLAudioElement>("#mission-soundtrack");
Object.assign(missionMusicControl.style, {
  position: "absolute", left: "600px", top: "458px", width: "26px", height: "18px",
  minHeight: "0", padding: "0", fontSize: "11px", lineHeight: "16px",
});
radarCanvas.width = ORIGINAL_HUD.radar.width;
radarCanvas.height = ORIGINAL_HUD.radar.height;
Object.assign(radarCanvas.style, {
  left: `${ORIGINAL_HUD.radar.x}px`, top: `${ORIGINAL_HUD.radar.y}px`,
  width: `${ORIGINAL_HUD.radar.width}px`, height: `${ORIGINAL_HUD.radar.height}px`,
});
const selectionBox = element<HTMLDivElement>("#selection-box");
const loadState = element<HTMLDivElement>("#load-state");
const frameWatermark = element<HTMLSpanElement>("#frame-watermark");
const previousFrame = element<HTMLButtonElement>("#previous-frame");
const togglePlayback = element<HTMLButtonElement>("#toggle-playback");
const nextFrame = element<HTMLButtonElement>("#next-frame");
const frameSlider = element<HTMLInputElement>("#frame-slider");
const framePosition = element<HTMLOutputElement>("#frame-position");
const frameSize = element<HTMLElement>("#frame-size");
const frameAnchor = element<HTMLElement>("#frame-anchor");
const atlasSize = element<HTMLElement>("#atlas-size");
const paletteScale = element<HTMLElement>("#palette-scale");
const payloadSize = element<HTMLElement>("#payload-size");
const frameLabel = element<HTMLElement>("#frame-label");
const anchorLabel = element<HTMLElement>("#anchor-label");
const atlasLabel = element<HTMLElement>("#atlas-label");
const paletteLabel = element<HTMLElement>("#palette-label");
const payloadLabel = element<HTMLElement>("#payload-label");
const decoderStatus = element<HTMLSpanElement>("#decoder-status");
const datasetTitle = element<HTMLParagraphElement>("#dataset-title");
const previewPanel = element<HTMLElement>(".preview-panel");
const mediaVideo = element<HTMLVideoElement>("#media-video");
const mediaAudio = element<HTMLAudioElement>("#media-audio");
const audioStage = element<HTMLDivElement>("#audio-stage");
const campaignLauncher = element<HTMLElement>("#campaign-launcher");
const campaignControls = element<HTMLDivElement>("#campaign-controls");
const campaignFactionLabel = element<HTMLElement>("#campaign-faction");
const campaignSelection = element<HTMLSpanElement>("#campaign-selection");
const missionMessage = element<HTMLParagraphElement>("#mission-message");
const legacyPortraitImage = element<HTMLImageElement>("#legacy-portrait-image");
const missionOptionsMenu = element<HTMLElement>("#mission-options-menu");
const commandGrid = element<HTMLElement>(".legacy-command-grid");
const legacyMissionName = element<HTMLSpanElement>("#legacy-mission-name");
const legacyTick = element<HTMLSpanElement>("#legacy-tick");
const frameStatisticsLabel = element<HTMLSpanElement>("#frame-statistics");
const frameStatistics = createFrameStatistics();
const stopUnits = element<HTMLButtonElement>("#stop-units");
const deployUnits = element<HTMLButtonElement>("#deploy-units");
const inspireUnits = element<HTMLButtonElement>("#inspire-units");

function updateDeploymentControl(): void {
  const selection = skirmish instanceof MissionView ? skirmish.deploymentSelection : undefined;
  deployUnits.hidden = !selection || (!selection.canDeploy && !selection.canUndeploy);
  const inspire = skirmish instanceof MissionView ? skirmish.inspireSelection : undefined;
  inspireUnits.hidden = !deployUnits.hidden;
  inspireUnits.disabled = !inspire?.ready;
  const inspireLabel = !inspire?.canInspire ? "Inspire Troops (select a lieutenant)"
    : inspire.ready ? "Inspire Troops" : `Inspire Troops (recharging ${inspire.chargePercent}%)`;
  if (inspireUnits.title !== inspireLabel) {
    inspireUnits.title = inspireLabel;
    inspireUnits.setAttribute("aria-label", inspireLabel);
  }
  const label = selection?.canUndeploy ? "Undeploy SARGE" : "Deploy SARGE";
  deployUnits.title = label;
  deployUnits.setAttribute("aria-label", label);
  deployUnits.setAttribute("aria-pressed", String(Boolean(selection?.canUndeploy)));
}
const moveUnits = element<HTMLButtonElement>("#move-units");
const selectAllUnits = element<HTMLButtonElement>("#select-all-units");
const exitCampaign = element<HTMLButtonElement>("#exit-campaign");
const showObjectives = element<HTMLButtonElement>("#show-objectives");
const objectivesPanel = element<HTMLElement>("#objectives-panel");
const missionResult = element<HTMLElement>("#mission-result");
const missionResultTitle = element<HTMLElement>("#mission-result-title");
const missionResultDetail = element<HTMLElement>("#mission-result-detail");
missionResultDetail.style.maxHeight = "180px";
missionResultDetail.style.overflowY = "auto";
missionResultDetail.style.overflowWrap = "anywhere";
const missionResultAction = element<HTMLButtonElement>("#mission-result-action");
const objectivesList = element<HTMLUListElement>("#objectives-list");
const closeObjectives = element<HTMLButtonElement>("#close-objectives");
const campaignFactionButtons = [
  ...document.querySelectorAll<HTMLButtonElement>("[data-campaign-faction]"),
];
const campaignMissionPicker = createCampaignMissionPicker(element<HTMLElement>("#campaign-mission-picker"),
  ({ faction, missionNumber, runtimeProfile }) => void startCampaign(faction, missionNumber, undefined, undefined, { runtimeProfile }));
const modeButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-mode]")];

let spriteIndex: SpriteIndex | null = null;
let animationIndex: AnimationIndex | null = null;
let terrainIndex: TerrainIndex | null = null;
let mediaIndex: MediaIndex | null = null;
let assetMode: AssetMode = "campaign";
let selectedArchive = 0;
let selectedFrame = 0;
let sequencePosition = 0;
let metadata: SpriteMetadata | null = null;
let animationMetadata: AnimationMetadata | null = null;
let activeSequence: readonly number[] | null = null;
let atlasImage: HTMLImageElement | null = null;
let loadingToken = 0;
(import.meta as ImportMeta & { hot?: { dispose(callback: () => void): void } }).hot
  ?.dispose(() => {
    ++loadingToken;
    cancelCampaignIntro();
    cancelCinematic();
    mobileControls?.dispose();
    mobileMenu?.dispose();
    saveMenu.dispose();
    cameraPan.dispose();
  });
let playing = false;
let previousAnimationTime = 0;
let activeAtlasWidth = 0;
let activeAtlasHeight = 0;
let skirmish: SkirmishView | MissionView | null = null;
let pendingMission: MissionView | null = null;
let diagnosticCleanupMission: MissionView | null | undefined;
let failedLegacyImport: { faction: Faction; missionNumber: number; checkpoint: unknown;
  groups?: readonly (readonly number[])[] } | null = null;
const saveMissionButton = element<HTMLButtonElement>("#save-mission");
const continueMissionButton = element<HTMLButtonElement>("#continue-mission");
const saveMissionStatus = element<HTMLElement>("#save-mission-status");
const continueStatus = element<HTMLElement>("#continue-status");
let gameSessionMode: GameSessionMode | null = null;
let campaignFaction: Faction | null = null;
let campaignMissionNumber = 1;
let campaignRuntimeProfile: "browser-adapted" | undefined;
let missionDragStart: { readonly x: number; readonly y: number; readonly pointerId: number } | null = null;
let missionDragMoved = false;
let missionPointer: { x: number; y: number } | null = null;
let missionCursorController: ReturnType<typeof createMissionCursorController> | undefined;
let missionCursorState: MissionCursor = "default";
let appliedMissionCursorStyle = "";
let audio: WebAudioManager | undefined;
let missionMusic: NativeMissionMusic | undefined;
let radar: ReturnType<typeof createRadar> | null = null;
let lastProductionKey = "", lastRadarKey = "", lastUiTick = -1, uiDeferrals = 0, uiRefreshDue = true;
const controlGroups = bindControlGroups(window, {
  isEnabled: () => activeMission() !== null && objectivesPanel.hidden && missionResult.hidden && !saveMenu.isOpen,
  getUnits: () => {
    const mission = activeMission();
    return mission?.simulation.snapshot.units.map((unit) => ({ ...unit, owned: mission.isOwnedUnit(unit.id) })) ?? [];
  },
  getSelectedIds: () => activeMission()?.selectedIds ?? [],
  onRecall: (ids) => { requestUnitMenu(); activeMission()?.replaceSelection(ids); },
});

function activeMission(): MissionView | null {
  return assetMode === "campaign" && gameSessionMode === "campaign" && !missionShell.hidden && skirmish instanceof MissionView
    ? skirmish : null;
}

function resetMissionControls(): void {
  frameStatistics.reset();
  frameStatisticsLabel.textContent = "FPS -- AVG -- LOW --";
  cameraPan.cancel();
  mobileControls?.cancel();
  mobileMenu?.close();
  diagnosticCleanupMission = undefined;
  failedLegacyImport = null;
  baseMenu.reset();
  unitMenuRequested = true;
  unitMenuJump = false;
  missionOptionsMenu.hidden = true;
  commandGrid.hidden = true;
  legacyPortraitImage.parentElement!.hidden = false;
  saveMissionStatus.textContent = "";
  saveMissionStatus.title = "";
  saveMissionButton.disabled = false;
  continueMissionButton.disabled = false;
  missionMusic?.stop();
  missionMusicControl.hidden = true;
  pendingMission?.dispose();
  pendingMission = null;
  if (skirmish instanceof MissionView) skirmish.dispose();
  radar?.dispose();
  radar = null;
  lastProductionKey = "";
  lastRadarKey = "";
  lastUiTick = -1;
  uiDeferrals = 0;
  radarCanvas.hidden = true;
  controlGroups.reset();
  audio?.stopAll();
  missionDragStart = null;
  missionDragMoved = false;
  missionPointer = null;
  missionCanvas.style.cursor = "default";
  selectionBox.hidden = true;
  missionMessage.textContent = "";
  missionMessage.title = "";
  if (gameSessionMode === "campaign") {
    skirmish?.resetClock();
    skirmish = null;
    gameSessionMode = null;
  }
  campaignFaction = null;
  updateMobileControls();
}

function updateMissionRadar(mission: MissionView): void {
  if (!radar) return;
  const visible = mission.visibility;
  radar.render({
    visible, explored: mission.explored, view: mission.cameraView,
    entities: snapshotRadarEntities(mission.simulation.snapshot, (entity) => mission.isOwnedUnit(entity.id)),
  });
}

const baseMenu = createBaseMenu(element<HTMLElement>("#mission-base-menu"), {
  isEnabled: (mission) => activeMission() === mission && objectivesPanel.hidden && missionResult.hidden,
  onTabChange: (tab) => {
    if (tab === "build") unitMenuRequested = false;
    const mission = activeMission();
    if (mission) updateMissionProduction(mission);
  },
});
// Units auto-selected on arrival do not replace the build grid; only player selection input requests the unit orders.
let unitMenuRequested = true;
let unitMenuJump = false;
const requestUnitMenu = () => { unitMenuRequested = true; unitMenuJump = true; };

let lastMobileMenuKey = "";
const mobileMenu = phoneControlsEnabled ? createMobileMissionMenu(assetLab, {
  onPurchase: key => {
    const mission = mobileInputMission();
    const entry = mission && baseMenuEntries(mission).find(candidate => candidate.key === key);
    if (!mission || !entry || !entry.enabled || entry.submitting || entry.maxStage < 1) {
      return { ok: false, message: entry?.reason || "This order is no longer available." };
    }
    const accepted = entry.source === "production" ? mission.purchaseProduction(entry.dependency)
      : mission.purchaseConstruction(entry.dependency);
    lastMobileMenuKey = "";
    updateMobileControls();
    return { ok: accepted, message: accepted ? `Order accepted: ${entry.text.replace(/\s+/g, " ").trim()}`
      : "Order not accepted. Check PETRA, prerequisites, and pending orders." };
  },
  onSave: () => { mobileMenu?.close(); saveMissionButton.click(); },
  onLoad: () => { mobileMenu?.close(); openLoadMenu(); },
  onToggleMute: () => {
    missionMute.checked = !missionMute.checked;
    missionMute.dispatchEvent(new Event("change"));
    updateMobileControls();
  },
  onExit: exitToMainMenu,
  onClose: () => { mobileControls?.cancel(); lastMobileMenuKey = ""; },
}) : null;
const saveMenu = createMissionSaveMenu(assetLab, {
  onSave: saveCurrentMission,
  onLoad: save => { void startCampaign(save.faction, save.missionNumber, save.checkpoint, save.controlGroups); },
  onClose: () => { skirmish?.resetClock(); },
});
const cameraPan = createCameraPan(missionCanvas, {
  isEnabled: () => {
    const mission = activeMission();
    return mission !== null && !document.hidden && objectivesPanel.hidden && missionResult.hidden && !missionDragStart
      && !mobileMenu?.isOpen && !saveMenu.isOpen && !mission.missionDiagnostic && !mission.missionOutcome?.ready
      && !document.querySelector(".cinematic-player[open], .campaign-intro[open]");
  },
  onPan: (x, y) => activeMission()?.panByCells(x, y, false),
});
const mobileControls = phoneControlsEnabled ? createMobileControls(previewPanel, {
  // Held input runs before update(), which draws the new camera position in the same animation frame.
  onPan: (x, y) => withMobileMission(mission => mission.panByCells(x, y, false)),
  onSelectScreen: () => withMobileMission(mission => {
    requestUnitMenu();
    const bounds = missionCanvas.getBoundingClientRect();
    mission.selectUnitsInClientRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
  }),
  onBuildMenu: () => openMobileMenu("build"),
  onClearSelection: () => withMobileMission(mission => mission.clearSelection()),
  onStop: () => withMobileMission(mission => mission.stopSelected()),
  onMove: () => withMobileMission(() => setMissionOrder("move")),
  onAssault: () => withMobileMission(() => setMissionOrder("assault")),
  onOptions: () => openMobileMenu("options"),
}) : null;

function mobileInputMission(): MissionView | null {
  const mission = phoneControlsEnabled ? activeMission() : null;
  return mission && objectivesPanel.hidden && missionResult.hidden && !document.hidden
    && !mission.missionDiagnostic && !mission.missionOutcome?.ready
    && !saveMenu.isOpen && !document.querySelector(".cinematic-player[open]") ? mission : null;
}

function withMobileMission(action: (mission: MissionView) => void): void {
  const mission = mobileInputMission();
  if (!mission || mobileMenu?.isOpen) return;
  if (missionDragStart) cancelMissionDrag();
  action(mission);
}

function mobileMenuState(mission: MissionView): MobileMissionMenuState {
  const entries = baseMenuEntries(mission);
  const credits = mission.productionMenu[0]?.credits
    ?? mission.constructionMenu.find((choice): choice is Extract<typeof choice, { credits: number }> => "credits" in choice)?.credits;
  return {
    title: mission.mission.scenario.title,
    entries, credits,
    objectives: mission.mission.briefing.objectives.length ? mission.mission.briefing.objectives : [mission.mission.briefing.plainText],
    enabled: mobileInputMission() === mission,
    muted: missionMute.checked,
    saveDisabled: saveMissionButton.disabled,
    saveStatus: [saveMissionStatus.textContent, saveMissionStatus.title].filter(Boolean).join(": "),
  };
}

function openMobileMenu(tab: "build" | "options"): void {
  const mission = mobileInputMission();
  if (!mission || !mobileMenu) return;
  cancelMissionDrag();
  mobileControls?.cancel();
  if (tab === "build") { unitMenuRequested = false; unitMenuJump = false; }
  baseMenu.setTab(tab);
  updateMissionProduction(mission);
  mobileMenu.open(tab, mobileMenuState(mission));
  lastMobileMenuKey = "";
  updateMobileControls();
}

function updateMobileControls(): void {
  if (!mobileControls) return;
  const mission = activeMission();
  const visible = mission !== null && missionResult.hidden && !mission.missionDiagnostic && !mission.missionOutcome?.ready;
  const enabled = mobileInputMission() !== null;
  if (!visible) mobileMenu?.close();
  mobileControls.update({
    visible, enabled: enabled && !mobileMenu?.isOpen,
    selectedCount: mission?.selectedIds.length ?? 0,
    orderMode: mission?.orderMode ?? "context",
    movementStance: mission?.movementStance ?? "assault",
    buildOpen: mobileMenu?.buildOpen ?? false,
  });
  if (mission && mobileMenu?.isOpen) {
    const key = `${lastUiTick}|${enabled}|${missionMute.checked}|${saveMissionButton.disabled}|${saveMissionStatus.textContent}|${saveMissionStatus.title}`;
    if (key !== lastMobileMenuKey) {
      lastMobileMenuKey = key;
      mobileMenu.update(mobileMenuState(mission));
    }
  }
}

// MAINE group 40 (unit orders) replaces the Building tab contents while units are selected, as in the original sidebar.
function updateMissionProduction(mission: MissionView): void {
  const selected = mission.selectedIds.length;
  if (unitMenuJump && selected > 0) baseMenu.setTab("build");
  unitMenuJump = false;
  const { tab, buildEntries } = baseMenu.render(mission);
  const units = tab === "build" && selected > 0 && (unitMenuRequested || buildEntries === 0);
  commandGrid.hidden = !units;
  element<HTMLElement>(".original-base-grid").classList.toggle("covered", units);
  missionOptionsMenu.hidden = tab !== "options";
  legacyPortraitImage.parentElement!.hidden = !(tab === "build" && !units && buildEntries === 0);
}

function spriteAssetUrl(relativePath: string): string {
  return `${ASSET_ROOT}/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as T;
}

function image(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const result = new Image();
    result.decoding = "async";
    result.addEventListener("load", () => resolve(result), { once: true });
    result.addEventListener("error", () => reject(new Error(`Could not load ${url}`)), { once: true });
    result.src = url;
  });
}

function currentArchive(): SpriteIndexArchive | null {
  if (assetMode !== "sprites") return null;
  return spriteIndex?.archives[selectedArchive] ?? null;
}

function currentStem(): string {
  return currentArchive()?.source.split("/").at(-1)?.replace(/\.SPR$/i, "").toLowerCase() ?? "";
}

function directAnimationEntry(): AnimationIndexEntry | null {
  const stem = currentStem();
  return (
    animationIndex?.entries.find(
      (entry) =>
        entry.status === "parsed" &&
        entry.source.replace(/\.FIN$/i, "").toLowerCase() === stem,
    ) ?? null
  );
}

function sequenceForState(state: AnimationState): number[] {
  if (!animationMetadata || !metadata || !state.validRange) return [];
  const stem = currentStem();
  const sequence: number[] = [];
  let previousFrame: number | null = null;
  for (let index = state.firstTimelineIndex; index <= state.lastTimelineIndex; index += 1) {
    const child = animationMetadata.timeline[index]?.children.find(
      (candidate) =>
        candidate.sprite.toLowerCase() === stem && candidate.frame < metadata!.frames.length,
    );
    if (child) previousFrame = child.frame;
    if (previousFrame !== null) sequence.push(previousFrame);
  }
  return sequence;
}

function populateAnimationStates(): void {
  animationState.replaceChildren(new Option("RAW FRAMES", ""));
  animationState.disabled = true;
  activeSequence = null;
  sequencePosition = 0;
  if (!animationMetadata) return;

  animationMetadata.states.forEach((state, index) => {
    const sequence = sequenceForState(state);
    if (sequence.length === 0) return;
    animationState.add(new Option(state.name, String(index)));
  });
  animationState.disabled = animationState.options.length === 1;
}

function setInspectorLabels(anchor = "ANCHOR"): void {
  frameLabel.textContent = "FRAME";
  anchorLabel.textContent = anchor;
  atlasLabel.textContent = "ATLAS";
  paletteLabel.textContent = "PALETTE";
  payloadLabel.textContent = "PAYLOAD";
}

function updateSkirmishStats(stats: SkirmishStats): void {
  frameSize.textContent = stats.tick.toLocaleString();
  frameAnchor.textContent = stats.selectedCell;
  atlasSize.textContent = stats.daylight;
  paletteScale.textContent = stats.selectedState;
  payloadSize.textContent = stats.healthAndResources;
  if (assetMode === "campaign") {
    const mission = activeMission();
    if (mission) {
      // Menu and radar inputs change at most once per 50 ms tick; rebuilding them every frame was ~19% of a live H13 frame.
      // The simulation tick already fills its own frame, so the rebuild waits for the next frame (at most 2 frames late).
      const tickFrame = stats.tick !== lastUiTick;
      lastUiTick = stats.tick;
      uiRefreshDue = !tickFrame || uiDeferrals >= 2;
      uiDeferrals = uiRefreshDue ? 0 : uiDeferrals + 1;
      const productionKey = `${stats.tick}|${mission.selectedIds.join(",")}|${mission.orderMode}|${mission.movementStance}`;
      if (uiRefreshDue && productionKey !== lastProductionKey) { lastProductionKey = productionKey; updateMissionProduction(mission); }
      moveUnits.setAttribute("aria-pressed", String(mission.movementStance === "move"));
      element<HTMLButtonElement>("#assault-units").setAttribute("aria-pressed", String(mission.movementStance === "assault"));
      element<HTMLButtonElement>("#patrol-units").setAttribute("aria-pressed", String(mission.orderMode === "patrol"));
      element<HTMLButtonElement>("#waypoint-units").setAttribute("aria-pressed", String(mission.orderMode === "waypoints"));
      updateMissionCursor();
    }
    const ownedUnits = skirmish?.simulation.snapshot.units.filter(
      (unit) => mission?.isOwnedUnit(unit.id) && unit.health > 0 && unit.activity !== "die",
    ).length ?? 0;
    campaignSelection.textContent = `${stats.selectedCount} SELECTED`;
    updateDeploymentControl();
    missionMessage.textContent = stats.missionMessage ?? "";
    missionMessage.title = stats.missionMessage ?? "";
        const diagnostic = stats.missionDiagnostic ?? mission?.missionDiagnostic;
        const outcome = mission?.missionOutcome;
        if (diagnostic) {
          if (diagnosticCleanupMission !== mission) {
            diagnosticCleanupMission = mission;
            missionMusic?.stop();
            audio?.stopAll();
            cancelMissionDrag();
          }
          missionMusicControl.hidden = true;
          missionMessage.textContent = "MISSION STOPPED";
          missionMessage.title = diagnostic;
          missionResult.hidden = false;
          objectivesPanel.hidden = true;
          missionResultTitle.textContent = "MISSION STOPPED";
          missionResultDetail.textContent = diagnostic;
          missionResultAction.hidden = mission === null;
          missionResultAction.textContent = "RETRY MISSION";
          saveMissionButton.disabled = true;
        } else if (outcome?.ready) {
          if (missionResult.hidden) {
            missionMusic?.stop();
            missionMusicControl.hidden = true;
            audio?.stopAll();
            const scene = campaignFaction && outcomeCinematic(campaignFaction, campaignMissionNumber, outcome.resultCode);
            if (scene) void showCinematic(scene);
          }
          missionResult.hidden = false;
          objectivesPanel.hidden = true;
          missionResultTitle.textContent = outcome.resultCode === 0 ? "MISSION COMPLETE" : "MISSION FAILED";
          missionResultDetail.textContent = mission?.mission.scenario.outcomes?.find(
            ({ reasonCode }) => reasonCode === outcome.reasonCode)?.text ??
            `Result ${outcome.resultCode} / reason ${outcome.reasonCode}`;
          const action = campaignResultAction(campaignMissionNumber, outcome);
          missionResultAction.hidden = action === null;
          missionResultAction.textContent = action?.kind === "retry" ? "RETRY MISSION" : "NEXT MISSION";
        }
    if (mission) {
      const view = mission.cameraView, radarKey = `${stats.tick}|${view.x},${view.y},${view.width},${view.height}`;
      if (uiRefreshDue && radarKey !== lastRadarKey) { lastRadarKey = radarKey; updateMissionRadar(mission); }
    }
    legacyTick.textContent = `TICK ${stats.tick.toLocaleString()}`;
    archiveSummary.textContent = `${stats.selectedCount} SELECTED / ${ownedUnits} UNITS`;
    decoderStatus.textContent = `${campaignFaction?.toUpperCase() ?? "MISSION"} / TICK ${stats.tick.toLocaleString()}`;
  } else {
    archiveSummary.textContent = `${SIMULATION_TICKS_PER_SECOND} TPS / ${stats.unitCount} UNITS`;
    decoderStatus.textContent = `${SIMULATION_TICKS_PER_SECOND} TPS / TICK ${stats.tick.toLocaleString()}`;
  }
}

function drawFrame(): void {
  if (assetMode === "media") return;
  if (assetMode === "simulation") {
    skirmish?.render();
    return;
  }

  const bounds = previewStage.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(bounds.width));
  const height = Math.max(1, Math.floor(bounds.height));
  canvas.width = Math.floor(width * pixelRatio);
  canvas.height = Math.floor(height * pixelRatio);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = false;

  const frame = metadata?.frames[selectedFrame];
  if (!frame || !atlasImage || frame.empty) return;
  const fit = Math.min((width - 64) / frame.width, (height - 64) / frame.height, 8);
  const scale = fit >= 1 ? Math.max(1, Math.floor(fit)) : Math.max(0.1, fit);
  const destinationWidth = frame.width * scale;
  const destinationHeight = frame.height * scale;

  context.drawImage(
    atlasImage,
    frame.x,
    frame.y,
    frame.width,
    frame.height,
    Math.round((width - destinationWidth) / 2),
    Math.round((height - destinationHeight) / 2),
    destinationWidth,
    destinationHeight,
  );
}

function updateFrame(): void {
  const frame = metadata?.frames[selectedFrame];
  const count = activeSequence?.length ?? metadata?.frames.length ?? 0;
  const position = activeSequence ? sequencePosition : selectedFrame;
  frameSlider.max = String(Math.max(0, count - 1));
  frameSlider.value = String(position);
  framePosition.value = count === 0 ? "0 / 0" : `${position + 1} / ${count}`;
  frameWatermark.textContent = count === 0 ? "FRAME --" : `FRAME ${String(selectedFrame).padStart(3, "0")}`;
  frameSize.textContent = frame ? (frame.empty ? "EMPTY" : `${frame.width} x ${frame.height}`) : "--";
  frameAnchor.textContent = frame ? `${frame.anchorX}, ${frame.anchorY}` : "--";
  atlasSize.textContent = activeAtlasWidth > 0 ? `${activeAtlasWidth} x ${activeAtlasHeight}` : "--";
  paletteScale.textContent = metadata?.paletteScale ?? "--";
  payloadSize.textContent = frame ? `${frame.encodedBytes.toLocaleString()} B` : "--";
  drawFrame();
}

function setPlaybackPosition(index: number): void {
  const count = activeSequence?.length ?? metadata?.frames.length ?? 0;
  if (count === 0) return;
  const position = (index + count) % count;
  if (activeSequence) {
    sequencePosition = position;
    selectedFrame = activeSequence[position];
  } else {
    selectedFrame = position;
  }
  updateFrame();
}

function stepFrame(delta: number): void {
  setPlaybackPosition((activeSequence ? sequencePosition : selectedFrame) + delta);
}

function setPlayback(next: boolean): void {
  playing = next;
  togglePlayback.textContent = playing ? "Ⅱ" : "▶";
  togglePlayback.title = playing ? "Pause animation" : "Play animation";
  togglePlayback.setAttribute("aria-label", togglePlayback.title);
  if (playing) previousAnimationTime = performance.now();
}

function renderArchiveList(): void {
  const query = archiveFilter.value.trim().toLowerCase();
  archiveList.replaceChildren();

  if (assetMode === "campaign" && !campaignFaction) {
    for (const faction of ["human", "alien"] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.role = "option";
      button.dataset.campaignFaction = faction;
      button.innerHTML = `<strong></strong><span></span><em>01</em>`;
      button.querySelector("strong")!.textContent = `${faction.toUpperCase()} MISSION`;
      button.querySelector("span")!.textContent = `${faction.toUpperCase()}01 / DESERT`;
      button.addEventListener("click", () => void startCampaign(faction));
      archiveList.append(button);
    }
    return;
  }

  if (assetMode === "simulation" || assetMode === "campaign") {
    const selectedIds = new Set(skirmish?.selectedIds ?? []);
    const units = (skirmish?.simulation.snapshot.units ?? []).filter(
      (unit) => assetMode !== "campaign" || unit.faction === campaignFaction,
    );
    units.forEach((unit) => {
      const label = `${unit.faction} unit ${unit.id} ${unit.cellX} ${unit.cellY}`;
      if (query && !label.includes(query)) return;
      const button = document.createElement("button");
      button.type = "button";
      button.role = "option";
      button.dataset.unitId = String(unit.id);
      button.dataset.faction = unit.faction;
      button.dataset.cell = `${unit.cellX},${unit.cellY}`;
      button.className = selectedIds.has(unit.id) ? "selected" : "";
      button.setAttribute("aria-selected", String(selectedIds.has(unit.id)));
      button.innerHTML = `<strong></strong><span></span><em></em>`;
      button.querySelector("strong")!.textContent = skirmish instanceof MissionView
        ? skirmish.unitName(unit.id)
        : unit.faction.toUpperCase();
      button.querySelector("span")!.textContent = `UNIT ${String(unit.id).padStart(2, "0")} · ${unit.cellX},${unit.cellY}`;
      button.querySelector("em")!.textContent = unit.activity.toUpperCase();
      button.addEventListener("click", (event) => skirmish?.selectUnit(unit.id, event.shiftKey));
      archiveList.append(button);
    });
    return;
  }

  if (assetMode === "media") {
    mediaIndex?.entries.forEach((entry, index) => {
      if (query && !entry.source.toLowerCase().includes(query)) return;
      const button = document.createElement("button");
      const parts = entry.source.split("/");
      const filename = parts.pop() ?? entry.source;
      button.type = "button";
      button.role = "option";
      button.className = index === selectedArchive ? "selected" : "";
      button.setAttribute("aria-selected", String(index === selectedArchive));
      button.innerHTML = `<strong></strong><span></span><em></em>`;
      button.querySelector("strong")!.textContent = filename.replace(/\.(AVI|WAV)$/i, "");
      button.querySelector("span")!.textContent = parts.join("/");
      button.querySelector("em")!.textContent = entry.kind.toUpperCase();
      button.addEventListener("click", () => void loadMedia(index));
      archiveList.append(button);
    });
    return;
  }

  if (assetMode === "terrain") {
    terrainIndex?.banks.forEach((bank, index) => {
      if (query && !bank.source.path.toLowerCase().includes(query)) return;
      const button = document.createElement("button");
      button.type = "button";
      button.role = "option";
      button.className = index === selectedArchive ? "selected" : "";
      button.setAttribute("aria-selected", String(index === selectedArchive));
      button.innerHTML = `<strong></strong><span></span><em></em>`;
      button.querySelector("strong")!.textContent = bank.source.path.replace(/\.BTS$/i, "");
      button.querySelector("span")!.textContent = "SCENARIO";
      button.querySelector("em")!.textContent = bank.tileCount.toLocaleString();
      button.addEventListener("click", () => void loadTerrainBank(index));
      archiveList.append(button);
    });
    return;
  }

  if (!spriteIndex) return;
  spriteIndex.archives.forEach((archive, index) => {
    if (query && !archive.source.toLowerCase().includes(query)) return;
    const button = document.createElement("button");
    const parts = archive.source.split("/");
    const filename = parts.pop() ?? archive.source;
    button.type = "button";
    button.role = "option";
    button.className = index === selectedArchive ? "selected" : "";
    button.setAttribute("aria-selected", String(index === selectedArchive));
    button.innerHTML = `<strong></strong><span></span><em></em>`;
    button.querySelector("strong")!.textContent = filename.replace(/\.SPR$/i, "");
    button.querySelector("span")!.textContent = parts.join("/");
    button.querySelector("em")!.textContent = String(archive.frameCount).padStart(3, "0");
    button.addEventListener("click", () => void loadArchive(index));
    archiveList.append(button);
  });
}

async function loadArchive(index: number): Promise<void> {
  if (!spriteIndex) return;
  const archive = spriteIndex.archives[index];
  const token = ++loadingToken;
  stopMedia();
  previewPanel.classList.remove("simulation-active");
  setInspectorLabels();
  selectedArchive = index;
  selectedFrame = 0;
  sequencePosition = 0;
  metadata = null;
  animationMetadata = null;
  activeSequence = null;
  atlasImage = null;
  activeAtlasWidth = archive.atlasWidth;
  activeAtlasHeight = archive.atlasHeight;
  setPlayback(false);
  loadState.hidden = false;
  loadState.textContent = "DECODING";
  archivePath.textContent = archive.source.split("/").slice(0, -1).join("/") || "DC";
  archiveName.textContent = archive.source.split("/").at(-1)?.replace(/\.SPR$/i, "") ?? archive.source;
  encodingBadge.textContent = archive.encoding.toUpperCase();
  animationState.replaceChildren(new Option("RAW FRAMES", ""));
  animationState.disabled = true;
  renderArchiveList();
  updateFrame();

  try {
    const animationEntry = directAnimationEntry();
    const [nextMetadata, nextImage, nextAnimation] = await Promise.all([
      json<SpriteMetadata>(spriteAssetUrl(archive.metadata)),
      image(spriteAssetUrl(archive.atlas)),
      animationEntry?.metadata
        ? json<AnimationMetadata>(
            `${ANIMATION_ROOT}/${animationEntry.metadata.split("/").map(encodeURIComponent).join("/")}`,
          )
        : Promise.resolve(null),
    ]);
    if (token !== loadingToken) return;
    metadata = nextMetadata;
    atlasImage = nextImage;
    animationMetadata = nextAnimation;
    populateAnimationStates();
    loadState.hidden = true;
    decoderStatus.textContent = `${archive.frameCount.toLocaleString()} FRAMES READY`;
    updateFrame();
  } catch (error) {
    if (token !== loadingToken) return;
    loadState.textContent = "ASSET ERROR";
    decoderStatus.textContent = error instanceof Error ? error.message.toUpperCase() : "ASSET ERROR";
  }
}

async function loadTerrainBank(index: number): Promise<void> {
  if (!terrainIndex) return;
  const bank = terrainIndex.banks[index];
  const token = ++loadingToken;
  stopMedia();
  previewPanel.classList.remove("simulation-active");
  setInspectorLabels("KEY");
  selectedArchive = index;
  selectedFrame = 0;
  sequencePosition = 0;
  metadata = null;
  animationMetadata = null;
  activeSequence = null;
  atlasImage = null;
  activeAtlasWidth = 0;
  activeAtlasHeight = 0;
  setPlayback(false);
  loadState.hidden = false;
  loadState.textContent = "DECODING";
  archivePath.textContent = "SCENARIO";
  archiveName.textContent = bank.source.path.replace(/\.BTS$/i, "");
  encodingBadge.textContent = "KEYED RAW";
  animationState.replaceChildren(new Option("RAW TILES", ""));
  animationState.disabled = true;
  renderArchiveList();
  updateFrame();

  try {
    const [terrain, nextImage] = await Promise.all([
      json<TerrainMetadata>(`${TERRAIN_ROOT}/${encodeURIComponent(bank.metadata)}`),
      image(`${TERRAIN_ROOT}/${encodeURIComponent(bank.atlas)}`),
    ]);
    if (token !== loadingToken) return;
    metadata = {
      paletteScale: terrain.paletteScale,
      frames: terrain.tiles.map((tile, tileIndex) => ({
        index: tileIndex,
        x: tile.x,
        y: tile.y,
        width: tile.width,
        height: tile.height,
        anchorX: tile.key,
        anchorY: 0,
        encodedBytes: 1024,
        empty: false,
      })),
    };
    atlasImage = nextImage;
    activeAtlasWidth = terrain.atlas.width;
    activeAtlasHeight = terrain.atlas.height;
    loadState.hidden = true;
    decoderStatus.textContent = `${bank.tileCount.toLocaleString()} TILES READY`;
    updateFrame();
  } catch (error) {
    if (token !== loadingToken) return;
    loadState.textContent = "ASSET ERROR";
    decoderStatus.textContent = error instanceof Error ? error.message.toUpperCase() : "ASSET ERROR";
  }
}

function stopMedia(): void {
  mediaVideo.pause();
  mediaAudio.pause();
  mediaVideo.removeAttribute("src");
  mediaVideo.replaceChildren();
  mediaAudio.removeAttribute("src");
  mediaVideo.hidden = true;
  audioStage.hidden = true;
  canvas.hidden = false;
  previewPanel.classList.remove("media-active");
}

function configureArchiveBrowser(label: string, placeholder: string, disabled = false): void {
  archiveToolsLabel.textContent = label;
  archiveFilter.placeholder = placeholder;
  archiveFilter.disabled = disabled;
}

function hideCampaignUi(): void {
  missionResult.hidden = true;
  ++loadingToken;
  resetMissionControls();
  campaignMissionPicker.setDisabled(false);
  campaignFactionButtons.forEach((button) => { button.disabled = false; });
  campaignLauncher.hidden = true;
  campaignControls.hidden = true;
  missionShell.hidden = true;
  objectivesPanel.hidden = true;
  assetLab.classList.remove("mission-running");
  assetLab.classList.remove("main-menu-active");
  previewPanel.classList.remove("campaign-active", "campaign-launcher-active");
}

function showCampaignLauncher(): void {
  cancelCampaignIntro();
  missionResult.hidden = true;
  ++loadingToken;
  resetMissionControls();
  continueMissionButton.disabled = false;
  campaignMissionPicker.setDisabled(false);
  campaignFactionButtons.forEach((button) => { button.disabled = false; });
  skirmish?.resetClock();
  skirmish = null;
  gameSessionMode = null;
  campaignFaction = null;
  stopMedia();
  previewPanel.classList.remove("simulation-active");
  previewPanel.classList.add("campaign-launcher-active");
  campaignLauncher.hidden = false;
  campaignLauncher.inert = false;
  assetLab.classList.add("main-menu-active");
  showMenuScreen("home");
  campaignControls.hidden = true;
  missionShell.hidden = true;
  objectivesPanel.hidden = true;
  assetLab.classList.remove("mission-running");
  canvas.hidden = true;
  metadata = null;
  animationMetadata = null;
  activeSequence = null;
  atlasImage = null;
  setPlayback(false);
  configureArchiveBrowser("MISSIONS", "Choose a mission", true);
  datasetTitle.textContent = "SOURCE MISSION LOADER";
  archivePath.textContent = "ORIGINAL MISSION DATA";
  archiveName.textContent = "CHOOSE YOUR FACTION";
  encodingBadge.textContent = "30 MISSIONS";
  animationState.replaceChildren(new Option("MISSION SELECT", ""));
  animationState.disabled = true;
  frameLabel.textContent = "MISSION";
  anchorLabel.textContent = "THEATRE";
  atlasLabel.textContent = "SOURCE";
  paletteLabel.textContent = "FACTIONS";
  payloadLabel.textContent = "STATUS";
  frameSize.textContent = "01";
  frameAnchor.textContent = "DESERT";
  atlasSize.textContent = "SCN";
  paletteScale.textContent = "2";
  payloadSize.textContent = "READY";
  frameWatermark.textContent = "";
  archiveSummary.textContent = "30 SOURCE MISSIONS / 2 FACTIONS";
  decoderStatus.textContent = "MISSION DATA READY";
  loadState.hidden = true;
  renderArchiveList();
  void refreshMissionSave();
}

async function refreshMissionSave(): Promise<void> {
  const token = loadingToken;
  continueMissionButton.hidden = true;
  continueStatus.hidden = true;
  try {
    const stored = await readMissionSave();
    if (token !== loadingToken || campaignLauncher.hidden) return;
    continueMissionButton.hidden = stored === null;
    continueMissionButton.textContent = stored
      ? `CONTINUE ${stored.faction.toUpperCase()} ${String(stored.missionNumber).padStart(2, "0")}` : "CONTINUE";
    continueMissionButton.title = stored ? `Saved ${new Date(stored.savedAt).toLocaleString()}` : "";
  } catch (error) {
    if (token !== loadingToken || campaignLauncher.hidden) return;
    continueStatus.hidden = false;
    continueStatus.textContent = `SAVE UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function checkpointRuntimeProfile(checkpoint: unknown): "browser-adapted" | undefined {
  if (!checkpoint || typeof checkpoint !== "object" || !("session" in checkpoint)) return undefined;
  const session = checkpoint.session;
  if (!session || typeof session !== "object" || !("options" in session)) return undefined;
  const options = session.options;
  if (!options || typeof options !== "object" || !("runtimeProfile" in options)) return undefined;
  if (options.runtimeProfile === undefined || options.runtimeProfile === "browser-adapted") return options.runtimeProfile;
  throw new TypeError("Unknown saved campaign runtime profile");
}

async function startCampaign(faction: Faction, missionNumber = 1, checkpoint?: unknown,
  groups?: readonly (readonly number[])[], profile?: { runtimeProfile?: "browser-adapted" },
  legacyConsent?: LegacyCampaignImportConsent,
  launchReason: CampaignLaunchReason = legacyConsent ? "import" : checkpoint !== undefined ? "continue" : "fresh"): Promise<void> {
  if (assetMode !== "campaign") return;
  cancelCampaignIntro();
  cancelCinematic();
  const token = ++loadingToken;
  resetMissionControls();
  missionResult.hidden = true;
  missionResultAction.hidden = true;
  void audio?.unlock();
  missionMusic?.prepareFromGesture();
  skirmish = null;
  gameSessionMode = null;
  missionShell.hidden = true;
  campaignControls.hidden = true;
  objectivesPanel.hidden = true;
  assetLab.classList.remove("mission-running");
  campaignLauncher.hidden = false;
  campaignLauncher.inert = true;
  campaignMissionPicker.setDisabled(true);
  campaignFactionButtons.forEach((button) => { button.disabled = true; });
  continueMissionButton.disabled = true;
  loadState.hidden = false;
  loadState.textContent = `DEPLOYING ${faction.toUpperCase()} ${String(missionNumber).padStart(2, "0")}`;
  try {
    const runtimeProfile = checkpoint !== undefined ? checkpointRuntimeProfile(checkpoint)
      : profile ? profile.runtimeProfile : missionNumber >= 2 ? "browser-adapted" : undefined;
    const construction = campaignConstructionPolicy(faction, missionNumber, runtimeProfile, checkpoint);
    const mission = await loadCampaignMission(faction, missionNumber, runtimeProfile, construction);
    if (token !== loadingToken) return;
    if (shouldShowCampaignIntro(faction, missionNumber, launchReason, checkpoint)) {
      loadState.hidden = true;
      const decision = await showCampaignIntro({ briefing: mission.briefing, isCurrent: () => token === loadingToken });
      if (token !== loadingToken) return;
      if (decision === "cancel") { showCampaignLauncher(); return; }
      loadState.hidden = false;
    }
    let nextSkirmish: MissionView | null = null;
    const isCurrent = () => token === loadingToken && nextSkirmish !== null && skirmish === nextSkirmish && activeMission() === nextSkirmish;
    const callbacks = {
        onStats: (stats: SkirmishStats) => { if (isCurrent()) updateSkirmishStats(stats); },
        onUnitsChanged: () => {
          if (isCurrent()) renderArchiveList();
        },
      };
    const imported = legacyConsent
      ? MissionView.importLegacy(missionCanvas, previewStage, callbacks, mission, checkpoint, legacyConsent, audio) : undefined;
    nextSkirmish = imported ? imported.view : checkpoint === undefined
      ? new MissionView(missionCanvas, previewStage, callbacks, mission, audio)
      : MissionView.restore(missionCanvas, previewStage, callbacks, mission, checkpoint, audio);
    pendingMission = nextSkirmish;
    await nextSkirmish.initialize();
    if (token !== loadingToken) { nextSkirmish.dispose(); return; }
    if (nextSkirmish.missionDiagnostic) throw new Error(nextSkirmish.missionDiagnostic);
    nextSkirmish.enableDiagonalGroundMovement();
    pendingMission = null;
    skirmish = nextSkirmish;
    gameSessionMode = "campaign";
    campaignFaction = faction;
    campaignMissionNumber = missionNumber;
    campaignRuntimeProfile = runtimeProfile;
    previewPanel.classList.remove("campaign-launcher-active");
    previewPanel.classList.add("simulation-active", "campaign-active");
    campaignLauncher.hidden = true;
    campaignControls.hidden = false;
    canvas.hidden = true;
    missionCanvas.hidden = false;
    missionShell.hidden = false;
    if (groups !== undefined) controlGroups.restore(groups);
    if (!nextSkirmish.terrainImage) throw new Error("Mission terrain image unavailable");
    radar = createRadar({
      canvas: radarCanvas, source: mission, atlas: nextSkirmish.terrainImage,
      onNavigate: ({ point }) => {
        const active = activeMission();
        if (active && objectivesPanel.hidden) {
          active.setCameraCenter(point.x, point.y);
          updateMissionRadar(active);
        }
      },
    });
    radarCanvas.hidden = false;
    assetLab.classList.add("mission-running");
    assetLab.classList.remove("main-menu-active");
    configureArchiveBrowser("SQUAD", "Filter squad");
    datasetTitle.textContent = `${faction.toUpperCase()} SOURCE MISSION / ${String(missionNumber).padStart(2, "0")}`;
    archivePath.textContent = mission.scenario.source.path;
    archiveName.textContent = `${mission.scenario.title.toUpperCase()} · SOURCE MISSION`;
    campaignFactionLabel.textContent = mission.scenario.title.toUpperCase();
    campaignFactionLabel.title = `${faction.toUpperCase()} / ${mission.scenario.title.toUpperCase()}${runtimeProfile ? " / BROWSER ADAPTED" : ""}`;
    legacyMissionName.textContent = runtimeProfile ? "BROWSER ADAPTED" : mission.scenario.title.toUpperCase();
    legacyMissionName.hidden = runtimeProfile === undefined;
    legacyPortraitImage.src = assetUrl(`/assets/generated/sprites/INTRFACE/${faction === "human" ? "HCOM" : "ACOM"}.png`);
    objectivesList.replaceChildren(
      ...(mission.briefing.objectives.length ? mission.briefing.objectives : [mission.briefing.plainText]).map((objective) => {
        const item = document.createElement("li");
        item.textContent = objective;
        return item;
      }),
    );
    encodingBadge.textContent = `${SIMULATION_TICKS_PER_SECOND} TPS${runtimeProfile ? " / BROWSER ADAPTED" : ""}`;
    animationState.replaceChildren(new Option("SOURCE MISSION", ""));
    animationState.disabled = true;
    frameLabel.textContent = "TICK";
    anchorLabel.textContent = "CELL";
    atlasLabel.textContent = "DAYLIGHT";
    paletteLabel.textContent = "STATE";
    payloadLabel.textContent = "HP / PETRA";
    nextSkirmish.resetClock();
    layoutMissionShell();
    loadState.hidden = true;
    renderArchiveList();
    nextSkirmish.render();
    if (imported) {
      saveMissionStatus.textContent = "IMPORTED / UNSAVED";
      saveMissionStatus.title = imported.notice;
    }
    if (isCurrent() && missionResult.hidden && !nextSkirmish.missionDiagnostic && !nextSkirmish.missionOutcome?.ready) {
      void missionMusic?.start();
    }
  } catch (error) {
    if (token !== loadingToken) return;
    hideCampaignUi();
    campaignLauncher.hidden = true;
    previewPanel.classList.remove("simulation-active");
    previewPanel.classList.add("campaign-launcher-active");
    assetLab.classList.add("main-menu-active");
    const diagnostic = error instanceof Error ? error.message : String(error);
    loadState.hidden = true;
    loadState.textContent = `UNSUPPORTED MISSION ${faction.toUpperCase()} ${String(missionNumber).padStart(2, "0")}: ${diagnostic}`;
    decoderStatus.textContent = loadState.textContent;
    missionCanvas.hidden = true;
    missionShell.hidden = false;
    missionResult.hidden = false;
    missionResultTitle.textContent = "MISSION UNAVAILABLE";
    missionResultDetail.textContent = loadState.textContent;
    missionResultAction.hidden = true;
    const session = (checkpoint as { session?: { replayPolicy?: unknown; options?: { runtimeProfile?: unknown } } } | null)?.session;
    if (!legacyConsent && session?.options?.runtimeProfile === "browser-adapted" && !Object.hasOwn(session, "replayPolicy")) {
      failedLegacyImport = { faction, missionNumber, checkpoint, groups };
      missionResultAction.textContent = "Import legacy save";
      missionResultAction.hidden = false;
    }
    layoutMissionShell();
  } finally {
    if (token === loadingToken) {
      campaignLauncher.inert = false;
      campaignMissionPicker.setDisabled(false);
      campaignFactionButtons.forEach((button) => { button.disabled = false; });
      continueMissionButton.disabled = false;
    }
  }
}

async function loadMedia(index: number): Promise<void> {
  if (!mediaIndex) return;
  const entry = mediaIndex.entries[index];
  ++loadingToken;
  stopMedia();
  previewPanel.classList.remove("simulation-active");
  selectedArchive = index;
  selectedFrame = 0;
  metadata = null;
  animationMetadata = null;
  activeSequence = null;
  atlasImage = null;
  activeAtlasWidth = 0;
  activeAtlasHeight = 0;
  setPlayback(false);
  canvas.hidden = true;
  previewPanel.classList.add("media-active");
  archivePath.textContent = entry.source.split("/").slice(0, -1).join("/") || "DC";
  archiveName.textContent = entry.source.split("/").at(-1)?.replace(/\.(AVI|WAV)$/i, "") ?? entry.source;
  encodingBadge.textContent = [...new Set(entry.outputs.flatMap(({ codecs }) => codecs))]
    .join(" / ")
    .toUpperCase();
  animationState.replaceChildren(new Option("BROWSER MEDIA", ""));
  animationState.disabled = true;
  loadState.hidden = true;
  frameWatermark.textContent = "";
  const outputBytes = entry.outputs.reduce((total, output) => total + output.bytes, 0);
  decoderStatus.textContent = `${entry.kind.toUpperCase()} / ${outputBytes.toLocaleString()} B`;
  renderArchiveList();

  if (entry.kind === "video") {
    const preferred = [...entry.outputs].sort((left, right) =>
      left.mimeType === "video/webm" ? -1 : right.mimeType === "video/webm" ? 1 : 0,
    );
    for (const output of preferred) {
      const source = document.createElement("source");
      source.src = `${MEDIA_ROOT}/${output.path.split("/").map(encodeURIComponent).join("/")}`;
      source.type = output.mimeType;
      mediaVideo.append(source);
    }
    mediaVideo.hidden = false;
    mediaVideo.load();
  } else {
    const output = entry.outputs[0];
    mediaAudio.src = `${MEDIA_ROOT}/${output.path.split("/").map(encodeURIComponent).join("/")}`;
    audioStage.hidden = false;
    mediaAudio.load();
  }
}

async function loadSkirmish(): Promise<void> {
  ++loadingToken;
  stopMedia();
  hideCampaignUi();
  previewPanel.classList.add("simulation-active");
  canvas.hidden = false;
  metadata = null;
  animationMetadata = null;
  activeSequence = null;
  atlasImage = null;
  activeAtlasWidth = 0;
  activeAtlasHeight = 0;
  setPlayback(false);
  archivePath.textContent = "DETERMINISTIC TEST RANGE";
  archiveName.textContent = "HUMAN / ALIEN SKIRMISH";
  encodingBadge.textContent = `${SIMULATION_TICKS_PER_SECOND} TPS`;
  animationState.replaceChildren(new Option("LIVE STATE", ""));
  animationState.disabled = true;
  frameLabel.textContent = "TICK";
  anchorLabel.textContent = "CELL";
  atlasLabel.textContent = "DAYLIGHT";
  paletteLabel.textContent = "STATE";
  payloadLabel.textContent = "HP / PETRA";
  loadState.hidden = false;
  loadState.textContent = "INITIALIZING";
  configureArchiveBrowser("UNITS", "Filter units");

  if (!skirmish || gameSessionMode !== "simulation") {
    const balance = await loadSkirmishBalance();
    skirmish = new SkirmishView(canvas, previewStage, {
      onStats: updateSkirmishStats,
      onUnitsChanged: () => renderArchiveList(),
    }, balance, { playerFaction: "human", scriptedDemo: true });
    gameSessionMode = "simulation";
    await skirmish.initialize();
  }
  skirmish.resetClock();
  loadState.hidden = true;
  renderArchiveList();
  skirmish.render();
}

function switchMode(mode: AssetMode): void {
  if (assetMode === mode && metadata) return;
  skirmish?.resetClock();
  assetMode = mode;
  selectedArchive = 0;
  archiveFilter.value = "";
  modeButtons.forEach((button) => button.classList.toggle("selected", button.dataset.mode === mode));
  if (mode !== "campaign") hideCampaignUi();
  if (mode === "campaign") {
    datasetTitle.textContent = "SOURCE MISSION LOADER";
    showCampaignLauncher();
  } else if (mode === "simulation") {
    datasetTitle.textContent = "SKIRMISH CORE / PHASE 3";
    archiveSummary.textContent = `${SIMULATION_TICKS_PER_SECOND} TPS / -- UNITS`;
    renderArchiveList();
    void loadSkirmish();
  } else if (mode === "media") {
    configureArchiveBrowser("MEDIA", "Filter media");
    datasetTitle.textContent = "MEDIA ARCHIVE / PHASE 2";
    archiveSummary.textContent = `${mediaIndex?.audioCount ?? 0} AUDIO / ${mediaIndex?.videoCount ?? 0} VIDEO`;
    renderArchiveList();
    void loadMedia(0);
  } else if (mode === "terrain") {
    configureArchiveBrowser("TERRAIN", "Filter terrain");
    datasetTitle.textContent = "TERRAIN ARCHIVE / PHASE 2";
    archiveSummary.textContent = `${terrainIndex?.bankCount ?? 0} BANKS / ${(terrainIndex?.tileCount ?? 0).toLocaleString()} TILES`;
    renderArchiveList();
    void loadTerrainBank(0);
  } else {
    configureArchiveBrowser("ARCHIVES", "Filter archives");
    datasetTitle.textContent = "SPRITE ARCHIVE / PHASE 2";
    archiveSummary.textContent = `${spriteIndex?.archiveCount ?? 0} FILES / ${(spriteIndex?.frameCount ?? 0).toLocaleString()} FRAMES`;
    renderArchiveList();
    void loadArchive(0);
  }
}

function animate(time: number): void {
  renderMissionCursor(performance.now());
  updateMobileControls();
  mobileControls?.tick(time);
  cameraPan.tick(time);
  if (assetMode === "simulation" || assetMode === "campaign") {
      if (saveMenu.isOpen) skirmish?.resetClock();
      else skirmish?.update(time);
  const mission = activeMission();
  if (mission && !document.hidden && !saveMenu.isOpen) {
    const stats = frameStatistics.sample(time);
    if (stats) {
      frameStatisticsLabel.textContent = `FPS ${Math.round(stats.fps)} AVG ${Math.round(stats.averageFps)} LOW ${Math.round(stats.lowFps)}`;
      const detail = `FPS: last second. Average and 1% low: last 5 seconds. Frame time: ${stats.frameMilliseconds.toFixed(1)} ms.`;
      frameStatisticsLabel.title = detail;
      frameStatisticsLabel.setAttribute("aria-label", `${frameStatisticsLabel.textContent}. ${detail}`);
    }
  } else frameStatistics.reset();
  const musicEnabled = mission !== null && missionResult.hidden && !mission.missionDiagnostic && !mission.missionOutcome?.ready;
  if (musicEnabled) missionMusic?.update(time);
  missionMusicControl.dataset.state = missionMusic?.state ?? "idle";
  missionMusicControl.hidden = !musicEnabled || missionMute.checked || missionMusic?.state !== "blocked";
      requestAnimationFrame(animate);
      return;
    }
  if (playing && time - previousAnimationTime >= 125) {
    const elapsedFrames = Math.max(1, Math.floor((time - previousAnimationTime) / 125));
    previousAnimationTime += elapsedFrames * 125;
    stepFrame(elapsedFrames);
  }
  requestAnimationFrame(animate);
}

function layoutMissionShell(): void {
  if (missionShell.hidden) return;
  const bounds = previewStage.getBoundingClientRect();
  const scale = Math.max(0.1, Math.min(bounds.width / 640, bounds.height / 480));
  missionShell.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

function renderMissionCursor(now: number): void {
  if (!missionPointer || assetMode !== "campaign") return;
  const style = missionCursorController?.styleAt(missionCursorState, now) ?? MISSION_CURSOR_FALLBACKS[missionCursorState];
  if (appliedMissionCursorStyle !== style) {
    missionCanvas.style.cursor = style;
    appliedMissionCursorStyle = style;
  }
}

function trackMissionPointer(event: PointerEvent): void {
  const bounds = missionCanvas.getBoundingClientRect();
  missionPointer = event.clientX >= bounds.left && event.clientX < bounds.right
    && event.clientY >= bounds.top && event.clientY < bounds.bottom ? { x: event.clientX, y: event.clientY } : null;
}

function updateMissionCursor(): void {
  const mission = activeMission();
  const state = mission && missionPointer && objectivesPanel.hidden && missionResult.hidden
    ? mission.cursorAt(missionPointer.x, missionPointer.y, missionDragMoved) : "default";
  missionCanvas.dataset.cursorState = state;
  missionCursorState = state;
  renderMissionCursor(performance.now());
}

function setMissionOrder(mode: "move" | "assault" | "patrol" | "waypoints"): void {
  const mission = activeMission();
  if (!mission || !objectivesPanel.hidden || !missionResult.hidden) return;
  mission.setOrderMode(mode);
  missionCanvas.focus();
  mission.render();
  updateMissionCursor();
}

archiveFilter.addEventListener("input", renderArchiveList);
modeButtons.forEach((button) =>
  button.addEventListener("click", () => switchMode(button.dataset.mode as AssetMode)),
);
previousFrame.addEventListener("click", () => stepFrame(-1));
nextFrame.addEventListener("click", () => stepFrame(1));
togglePlayback.addEventListener("click", () => setPlayback(!playing));
frameSlider.addEventListener("input", () => setPlaybackPosition(Number(frameSlider.value)));
canvas.addEventListener("click", (event) => {
  if (assetMode === "simulation" || assetMode === "campaign") {
    skirmish?.commandAt(event.clientX, event.clientY, event.shiftKey);
  }
});
missionCanvas.addEventListener("pointerdown", (event) => {
  if (assetMode !== "campaign" || event.button !== 0 || !objectivesPanel.hidden || !missionResult.hidden) return;
  if (missionDragStart || (event.pointerType === "touch" && !event.isPrimary) || mobileMenu?.isOpen) return;
  if (phoneControlsEnabled && event.pointerType === "touch") event.preventDefault();
  trackMissionPointer(event);
  missionDragStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  missionDragMoved = false;
  missionCanvas.setPointerCapture(event.pointerId);
});
missionCanvas.addEventListener("pointerenter", (event) => {
  trackMissionPointer(event);
  updateMissionCursor();
});
missionCanvas.addEventListener("pointermove", (event) => {
  trackMissionPointer(event);
  updateMissionCursor();
  if (!missionDragStart || event.pointerId !== missionDragStart.pointerId) return;
  const deltaX = event.clientX - missionDragStart.x;
  const deltaY = event.clientY - missionDragStart.y;
  if (!missionDragMoved && Math.hypot(deltaX, deltaY) < 6) return;
  missionDragMoved = true;
  updateMissionCursor();
  const stageBounds = previewStage.getBoundingClientRect();
  selectionBox.hidden = false;
  selectionBox.style.left = `${Math.min(missionDragStart.x, event.clientX) - stageBounds.left}px`;
  selectionBox.style.top = `${Math.min(missionDragStart.y, event.clientY) - stageBounds.top}px`;
  selectionBox.style.width = `${Math.abs(deltaX)}px`;
  selectionBox.style.height = `${Math.abs(deltaY)}px`;
});
missionCanvas.addEventListener("pointerup", (event) => {
  trackMissionPointer(event);
  if (!missionDragStart || event.button !== 0 || event.pointerId !== missionDragStart.pointerId) return;
  if (!objectivesPanel.hidden || !missionResult.hidden || !activeMission()) {
    cancelMissionDrag();
    return;
  }
  if (skirmish instanceof MissionView) {
    requestUnitMenu();
    if (missionDragMoved) {
      skirmish.selectUnitsInClientRect(
        missionDragStart.x,
        missionDragStart.y,
        event.clientX,
        event.clientY,
        event.shiftKey,
      );
    } else {
      skirmish.commandAt(event.clientX, event.clientY, event.shiftKey);
    }
  }
  cancelMissionDrag();
});
function cancelMissionDrag(): void {
  const pointerId = missionDragStart?.pointerId;
  missionDragStart = null;
  missionDragMoved = false;
  selectionBox.hidden = true;
  if (pointerId !== undefined && missionCanvas.hasPointerCapture(pointerId)) missionCanvas.releasePointerCapture(pointerId);
  updateMissionCursor();
}
missionCanvas.addEventListener("pointercancel", event => {
  if (event.pointerId === missionDragStart?.pointerId) cancelMissionDrag();
});
missionCanvas.addEventListener("lostpointercapture", event => {
  if (event.pointerId === missionDragStart?.pointerId) cancelMissionDrag();
});
window.addEventListener("blur", cancelMissionDrag);
document.addEventListener("visibilitychange", () => {
  frameStatistics.reset();
  if (document.hidden) { cancelMissionDrag(); mobileControls?.cancel(); }
});
missionCanvas.addEventListener("pointerleave", () => {
  missionPointer = null;
  updateMissionCursor();
});
missionCanvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  if (phoneControlsEnabled) return;
  if (skirmish instanceof MissionView && objectivesPanel.hidden && missionResult.hidden) skirmish.clearSelection();
});
campaignFactionButtons.forEach((button) =>
  button.addEventListener("click", () => void startCampaign(button.dataset.campaignFaction as Faction)),
);
selectAllUnits.addEventListener("click", () => { requestUnitMenu(); skirmish?.selectAllPlayerUnits(); });
stopUnits.addEventListener("click", () => {
  if (skirmish instanceof MissionView) skirmish.stopSelected();
});
deployUnits.addEventListener("click", () => {
  if (!(skirmish instanceof MissionView) || !objectivesPanel.hidden || !missionResult.hidden) return;
  if (skirmish.deploymentSelection.canUndeploy) skirmish.undeploySelected();
  else skirmish.deploySelected();
  updateDeploymentControl();
});
inspireUnits.addEventListener("click", () => {
  if (!(skirmish instanceof MissionView) || !objectivesPanel.hidden || !missionResult.hidden) return;
  skirmish.inspireSelected();
  updateDeploymentControl();
});
moveUnits.addEventListener("click", () => {
  setMissionOrder("move");
});
element<HTMLButtonElement>("#assault-units").addEventListener("click", () => setMissionOrder("assault"));
element<HTMLButtonElement>("#patrol-units").addEventListener("click", () => {
  setMissionOrder("patrol");
});
element<HTMLButtonElement>("#waypoint-units").addEventListener("click", () => {
  setMissionOrder("waypoints");
});
function exitToMainMenu(): void {
  if (activeMission() && !window.confirm("Return to the main menu? Progress since your last manual save will be lost.")) return;
  showCampaignLauncher();
}

function openLoadMenu(): void {
  if (activeMission() && !window.confirm("Load a saved game? Unsaved progress in this mission will be lost when you load a slot.")) return;
  cancelMissionDrag();
  mobileControls?.cancel();
  saveMenu.open("load");
}

exitCampaign.addEventListener("click", exitToMainMenu);
element<HTMLButtonElement>("#load-mission").addEventListener("click", openLoadMenu);
saveMissionButton.addEventListener("click", () => {
  const mission = activeMission();
  if (!mission || mission.missionDiagnostic || mission.missionOutcome?.ready || !missionResult.hidden || !objectivesPanel.hidden) return;
  cancelMissionDrag();
  mobileControls?.cancel();
  saveMenu.open("save");
});
async function saveCurrentMission(slot: MissionSaveSlot): Promise<void> {
  const mission = activeMission();
  if (!mission || mission.missionDiagnostic || mission.missionOutcome?.ready || !missionResult.hidden || !objectivesPanel.hidden) {
    throw new Error("This mission is no longer available to save.");
  }
  const token = loadingToken;
  saveMissionButton.disabled = true;
  saveMissionStatus.textContent = "SAVING";
  saveMissionStatus.title = "";
  try {
    const save: SavedMission = { version: 1, faction: mission.playerFaction, missionNumber: campaignMissionNumber,
      savedAt: new Date().toISOString(), checkpoint: mission.checkpoint(), controlGroups: controlGroups.state.groups };
    await writeMissionSave(save, indexedDB, slot);
    if (token === loadingToken) {
      saveMissionStatus.textContent = "SAVED";
      saveMissionStatus.title = `Slot ${slot.slice(-1)}`;
    }
  } catch (error) {
    if (token === loadingToken) {
      saveMissionStatus.textContent = "SAVE FAILED";
      saveMissionStatus.title = error instanceof Error ? error.message : String(error);
    }
    throw error;
  } finally { if (token === loadingToken) saveMissionButton.disabled = false; }
}
continueMissionButton.addEventListener("click", async () => {
  const token = loadingToken;
  continueMissionButton.disabled = true;
  try {
    const save = await readMissionSave();
    if (token !== loadingToken) return;
    if (!save) throw new Error("No saved game is available. Start a new campaign or choose Load game.");
    void startCampaign(save.faction, save.missionNumber, save.checkpoint, save.controlGroups);
  } catch (error) {
    if (token !== loadingToken) return;
    continueStatus.hidden = false;
    continueStatus.textContent = `LOAD FAILED: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    if (token === loadingToken) continueMissionButton.disabled = false;
  }
});
element<HTMLButtonElement>("#mission-result-exit").addEventListener("click", showCampaignLauncher);
element<HTMLButtonElement>("#play-intro").addEventListener("click", () => void showCinematic(INTRO_CINEMATIC));
function showMenuScreen(screen: "home" | "new" | "options"): void {
  campaignLauncher.querySelectorAll<HTMLElement>("[data-menu-screen]").forEach(panel => {
    panel.hidden = panel.dataset.menuScreen !== screen;
  });
  element<HTMLButtonElement>("#menu-back").hidden = screen === "home";
  if (screen === "options") updateMenuSound();
  campaignLauncher.scrollTop = 0;
  campaignLauncher.querySelector<HTMLButtonElement>(`[data-menu-screen="${screen}"] button:not([hidden])`)?.focus({ preventScroll: true });
}
campaignLauncher.querySelectorAll<HTMLButtonElement>("[data-menu-open]").forEach(button => {
  button.addEventListener("click", () => showMenuScreen(button.dataset.menuOpen === "new" ? "new" : "options"));
});
element<HTMLButtonElement>("#menu-back").addEventListener("click", () => showMenuScreen("home"));
element<HTMLButtonElement>("[data-menu-load]").addEventListener("click", openLoadMenu);
element<HTMLButtonElement>("#open-asset-browser").addEventListener("click", () => switchMode("sprites"));
function updateMenuSound(): void {
  const button = element<HTMLButtonElement>("#menu-sound");
  button.textContent = missionMute.checked ? "Sound: off" : "Sound: on";
  button.setAttribute("aria-pressed", String(!missionMute.checked));
}
element<HTMLButtonElement>("#menu-sound").addEventListener("click", () => {
  missionMute.checked = !missionMute.checked;
  missionMute.dispatchEvent(new Event("change"));
});

async function showCinematic(name: string): Promise<void> {
  const outcome = await playCinematic(name, {
    muted: missionMute.checked,
    onMutedChange: (muted) => {
      missionMute.checked = muted;
      missionMute.dispatchEvent(new Event("change"));
    },
  });
  if (outcome === "failed") console.warn(`Cinematic ${name} could not be played`);
}
missionResultAction.addEventListener("click", () => {
  if (failedLegacyImport && !missionResult.hidden) {
    const failed = failedLegacyImport;
    if (!window.confirm("Import this unversioned legacy save? Its original population policy cannot be identified. "
      + "I acknowledge this ambiguity and consent to full replay validation and migration to current population rules. "
      + "The stored save stays unchanged until I choose Save.")) return;
    void startCampaign(failed.faction, failed.missionNumber, failed.checkpoint, failed.groups, undefined,
      { policy: "legacy-unmaintained-population-v0", acknowledgeAmbiguousUnversionedSave: true });
    return;
  }
  const mission = activeMission();
  if (!mission || missionResult.hidden) return;
  if (mission.missionDiagnostic) {
    void startCampaign(mission.playerFaction, campaignMissionNumber, undefined, undefined, { runtimeProfile: campaignRuntimeProfile },
      undefined, "retry");
    return;
  }
  const action = campaignResultAction(campaignMissionNumber, mission.missionOutcome);
  if (action) void startCampaign(mission.playerFaction, action.missionNumber, undefined, undefined,
    action.missionNumber === campaignMissionNumber ? { runtimeProfile: campaignRuntimeProfile } : undefined,
    undefined, action.missionNumber === campaignMissionNumber ? "retry" : "next");
});
showObjectives.addEventListener("click", () => { cancelMissionDrag(); objectivesPanel.hidden = false; updateMissionCursor(); });
closeObjectives.addEventListener("click", () => { objectivesPanel.hidden = true; });
missionMute.addEventListener("change", () => {
  updateMenuSound();
  audio?.setMuted(missionMute.checked);
  missionMusic?.setMuted(missionMute.checked);
  if (!missionMute.checked) void audio?.unlock();
});
missionMusicControl.addEventListener("click", () => {
  const mission = activeMission();
  if (mission && missionResult.hidden && !mission.missionDiagnostic && !mission.missionOutcome?.ready) {
    void missionMusic?.retryFromGesture();
  }
});
const missionResizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(layoutMissionShell);
missionResizeObserver?.observe(previewStage);
window.addEventListener("pagehide", (event) => {
  ++loadingToken;
  resetMissionControls();
  if (!event.persisted) {
    missionResizeObserver?.disconnect();
    missionMusic?.dispose();
    void audio?.dispose();
  }
});
animationState.addEventListener("change", () => {
  setPlayback(false);
  const stateIndex = Number(animationState.value);
  const state = animationState.value === "" ? null : animationMetadata?.states[stateIndex];
  activeSequence = state ? sequenceForState(state) : null;
  sequencePosition = 0;
  setPlaybackPosition(0);
});
window.addEventListener("resize", () => {
  layoutMissionShell();
  drawFrame();
});
window.addEventListener("keydown", (event) => {
  if (mobileMenu?.isOpen || saveMenu.isOpen || document.querySelector(".cinematic-player[open], .campaign-intro[open]")) return;
  if (event.defaultPrevented || event.composedPath().some((node) => node instanceof HTMLElement
    && (node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName)))) return;
  if (!campaignLauncher.hidden) {
    if (event.key === "Escape" && !campaignLauncher.inert) {
      event.preventDefault();
      showMenuScreen("home");
    }
    return;
  }
  if (!missionResult.hidden) {
    if (event.key === "Escape") showCampaignLauncher();
    return;
  }
  if (!objectivesPanel.hidden && event.key !== "Escape" && event.key.toLowerCase() !== "j") return;
  if (assetMode === "campaign" && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
    event.preventDefault();
    requestUnitMenu();
    skirmish?.selectAllPlayerUnits();
    return;
  }
  if (assetMode === "campaign" && event.key === "Escape" && campaignFaction) {
    if (!objectivesPanel.hidden) {
      objectivesPanel.hidden = true;
      return;
    }
    exitToMainMenu();
    return;
  }
  if (assetMode === "campaign" && (event.ctrlKey || event.metaKey || event.altKey)) { cameraPan.cancel(); return; }
  if (assetMode === "campaign" && skirmish instanceof MissionView) {
    const key = event.key.toLowerCase();
    if (key === "j") {
      event.preventDefault();
      cancelMissionDrag();
      objectivesPanel.hidden = !objectivesPanel.hidden;
      updateMissionCursor();
      return;
    }
    if (key === "s") {
      event.preventDefault();
      skirmish.stopSelected();
      return;
    }
    if (key === "m" || key === "a") {
      event.preventDefault();
      setMissionOrder(key === "m" ? "move" : "assault");
      return;
    }
    if (key === "p" || key === "w") {
      event.preventDefault();
      setMissionOrder(key === "p" ? "patrol" : "waypoints");
      return;
    }
    if (event.key === "F2") {
      event.preventDefault();
      requestUnitMenu();
      skirmish.selectVisibleInfantry();
      return;
    }
    if (cameraPan.keyDown(event)) return;
  }
  if (event.key === "ArrowLeft") stepFrame(-1);
  if (event.key === "ArrowRight") stepFrame(1);
  if (event.key === " ") {
    event.preventDefault();
    setPlayback(!playing);
  }
});

async function initialize(): Promise<void> {
  campaignLauncher.inert = true;
  loadState.hidden = false;
  loadState.textContent = "LOADING GAME DATA";
  try {
    [spriteIndex, animationIndex, terrainIndex, mediaIndex] = await Promise.all([
      json<SpriteIndex>(`${ASSET_ROOT}/index.json`),
      json<AnimationIndex>(`${ANIMATION_ROOT}/index.json`),
      json<TerrainIndex>(`${TERRAIN_ROOT}/index.json`),
      json<MediaIndex>(`${MEDIA_ROOT}/index.json`),
    ]);
    audio = new WebAudioManager({ mediaIndex, baseUrl: MEDIA_ROOT, muted: missionMute.checked });
    missionMusic = new NativeMissionMusic(mediaIndex, {
      baseUrl: MEDIA_ROOT, muted: missionMute.checked, mediaFactory: () => missionSoundtrackMedia,
    });
    try { missionCursorController = createMissionCursorController(await loadMissionCursorAnimation()); }
    catch (error) { console.warn("Original cursors unavailable; using system cursor states", error); }
    showCampaignLauncher();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    loadState.textContent = `GAME DATA UNAVAILABLE: ${message}`;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Retry";
    retry.addEventListener("click", () => void initialize());
    loadState.append(retry);
    decoderStatus.textContent = message;
  }
}

requestAnimationFrame(animate);
void initialize();
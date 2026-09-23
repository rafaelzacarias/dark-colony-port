import "./style.css";
import { assetUrl } from "./asset-url";
import { createElement as createIcon, Save, SatelliteDish } from "lucide";
import { SIMULATION_TICKS_PER_SECOND, type Faction } from "./engine";
import { campaignConstructionPolicy, campaignResultAction, loadCampaignMission, loadSkirmishBalance } from "./game-data";
import { MissionView } from "./mission-view";
import { SkirmishView, type SkirmishStats } from "./simulation-view";
import { WebAudioManager } from "./audio";
import { NativeMissionMusic } from "./audio/native-mission-music";
import { bindControlGroups, createRadar, ORIGINAL_HUD, snapshotRadarEntities } from "./ui";
import { createMissionCursorController, loadMissionCursorAnimation, MISSION_CURSOR_FALLBACKS, type MissionCursor } from "./ui/mission-cursor";
import { readMissionSave, writeMissionSave, type SavedMission } from "./mission-save";
import type { LegacyCampaignImportConsent } from "./engine/campaign-session-legacy-import";
import { createProductionPanel } from "./ui/production-panel";
import { createConstructionPanel } from "./ui/construction-panel";
import { createCampaignMissionPicker } from "./ui/campaign-mission-picker";
import { cancelCampaignIntro, shouldShowCampaignIntro, showCampaignIntro, type CampaignLaunchReason } from "./ui/campaign-intro";
import "./ui/campaign-intro.css";

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
  <main class="asset-lab">
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
          <section id="campaign-launcher" class="campaign-launcher campaign-picker-enabled" aria-labelledby="campaign-launch-title" hidden>
            <header>
              <p>ORIGINAL SCENARIO DATA / 30 MISSIONS</p>
              <h3 id="campaign-launch-title">Choose a mission</h3>
            </header>
            <div id="campaign-mission-picker"></div>
            <div class="faction-selector">
              <button type="button" class="human" data-campaign-faction="human">
                <picture class="mission-picker-portrait"><img src="${assetUrl("/assets/generated/sprites/INTRFACE/HCOM.png")}" alt="" /></picture>
                <span>01</span><strong>Human Mission</strong><small>HUMAN01 · SCN, MAP and initial TRO state</small>
              </button>
              <button type="button" class="alien" data-campaign-faction="alien">
                <picture class="mission-picker-portrait"><img src="${assetUrl("/assets/generated/sprites/INTRFACE/ACOM.png")}" alt="" /></picture>
                <span>01</span><strong>Alien Mission</strong><small>ALIEN01 · SCN, MAP and initial TRO state</small>
              </button>
            </div>
            <button id="continue-mission" type="button" hidden>CONTINUE</button>
            <p id="continue-status" role="status" hidden></p>
          </section>
          <div id="mission-shell" class="mission-shell" hidden>
            <img class="mission-frame-art" src="${assetUrl("/assets/generated/interface/INTRFACE.GIF")}" alt="" />
            <canvas id="mission-canvas" tabindex="0" aria-label="Dark Colony mission viewport"></canvas>
            <div id="campaign-controls" class="campaign-controls" hidden>
              <canvas id="mission-radar" aria-label="Mission radar" hidden></canvas>
              <div class="legacy-portrait" aria-hidden="true"><img id="legacy-portrait-image" alt="" /></div>
              <section id="mission-production" aria-label="Base production" hidden>
                <div class="production-balance">PETRA <output id="production-credits">0</output></div>
                <div id="production-choices"></div>
              </section>
              <div id="mission-base-tabs" role="tablist" aria-label="Base actions" hidden>
                <button type="button" role="tab" data-base-tab="build" aria-controls="mission-construction" aria-selected="true">Build</button>
                <button type="button" role="tab" data-base-tab="units" aria-controls="mission-production" aria-selected="false">Units</button>
              </div>
              <section id="mission-construction" aria-label="Fixed-site construction" hidden></section>
              <strong id="campaign-faction">HUMAN01</strong>
              <span id="campaign-selection">1 SELECTED</span>
              <p id="mission-message"></p>
              <label id="mission-mute-label"><input id="mission-mute" type="checkbox" checked /> MUTE</label>
              <button id="mission-music-control" type="button" title="Play mission music" aria-label="Play mission music" hidden>&#9654;</button>
              <audio id="mission-soundtrack" preload="none" muted hidden></audio>
              <div class="legacy-command-grid">
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
                <button id="inspire-units" type="button" title="Inspire Troops: native effect and cooldown not yet verified" aria-label="Inspire Troops (unavailable)" disabled>
                  <span class="legacy-button-sprite button-inspire"></span>
                </button>
                <button id="deploy-units" type="button" title="Deploy SARGE" aria-label="Deploy SARGE" aria-pressed="false" hidden></button>
              </div>
              <button id="select-all-units" class="legacy-text-command" type="button">SELECT ALL</button>
              <button id="exit-campaign" class="legacy-text-command" type="button">MISSIONS</button>
              <button id="show-objectives" class="legacy-text-command" type="button" title="Objectives (J)">OBJECTIVES</button>
              <button id="save-mission" class="legacy-text-command" type="button" title="Save mission" aria-label="Save mission"></button>
              <span id="save-mission-status" role="status" aria-live="polite"></span>
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
              <span id="legacy-mission-name" style="position:absolute;right:100%;width:128px;padding-right:8px;text-align:right;white-space:nowrap" hidden>HUMAN01</span>
              <span id="legacy-tick">TICK 0</span>
            </div>
          </div>
          <div id="selection-box" class="selection-box" hidden></div>
          <canvas id="sprite-canvas" aria-label="Decoded sprite frame"></canvas>
          <video id="media-video" controls playsinline hidden></video>
          <div id="audio-stage" hidden><audio id="media-audio" controls></audio></div>
          <div id="load-state" class="load-state">LOADING</div>
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
const missionProduction = element<HTMLElement>("#mission-production");
const productionCredits = element<HTMLOutputElement>("#production-credits");
const productionChoices = element<HTMLElement>("#production-choices");
const legacyMissionName = element<HTMLSpanElement>("#legacy-mission-name");
const legacyTick = element<HTMLSpanElement>("#legacy-tick");
const stopUnits = element<HTMLButtonElement>("#stop-units");
const deployUnits = element<HTMLButtonElement>("#deploy-units");
deployUnits.append(createIcon(SatelliteDish, { width: 18, height: 18, "aria-hidden": "true" }));

function updateDeploymentControl(): void {
  const selection = skirmish instanceof MissionView ? skirmish.deploymentSelection : undefined;
  deployUnits.hidden = !selection || (!selection.canDeploy && !selection.canUndeploy);
  element<HTMLButtonElement>("#inspire-units").hidden = !deployUnits.hidden;
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
  ?.dispose(() => { ++loadingToken; cancelCampaignIntro(); });
let playing = false;
let previousAnimationTime = 0;
let activeAtlasWidth = 0;
let activeAtlasHeight = 0;
let skirmish: SkirmishView | MissionView | null = null;
let pendingMission: MissionView | null = null;
let diagnosticCleanupMission: MissionView | null | undefined;
let savedMission: SavedMission | null = null;
let failedLegacyImport: { faction: Faction; missionNumber: number; checkpoint: unknown;
  groups?: readonly (readonly number[])[] } | null = null;
const saveMissionButton = element<HTMLButtonElement>("#save-mission");
const continueMissionButton = element<HTMLButtonElement>("#continue-mission");
const saveMissionStatus = element<HTMLElement>("#save-mission-status");
const continueStatus = element<HTMLElement>("#continue-status");
saveMissionButton.append(createIcon(Save, { width: 12, height: 12, "aria-hidden": "true" }));
let gameSessionMode: GameSessionMode | null = null;
let campaignFaction: Faction | null = null;
let campaignMissionNumber = 1;
let campaignRuntimeProfile: "browser-adapted" | undefined;
let missionDragStart: { readonly x: number; readonly y: number } | null = null;
let missionDragMoved = false;
let missionPointer: { x: number; y: number } | null = null;
let missionCursorController: ReturnType<typeof createMissionCursorController> | undefined;
let missionCursorState: MissionCursor = "default";
let appliedMissionCursorStyle = "";
let audio: WebAudioManager | undefined;
let missionMusic: NativeMissionMusic | undefined;
let radar: ReturnType<typeof createRadar> | null = null;
const controlGroups = bindControlGroups(window, {
  isEnabled: () => activeMission() !== null && objectivesPanel.hidden && missionResult.hidden,
  getUnits: () => {
    const mission = activeMission();
    return mission?.simulation.snapshot.units.map((unit) => ({ ...unit, owned: mission.isOwnedUnit(unit.id) })) ?? [];
  },
  getSelectedIds: () => activeMission()?.selectedIds ?? [],
  onRecall: (ids) => activeMission()?.replaceSelection(ids),
});

function activeMission(): MissionView | null {
  return assetMode === "campaign" && gameSessionMode === "campaign" && !missionShell.hidden && skirmish instanceof MissionView
    ? skirmish : null;
}

function resetMissionControls(): void {
  diagnosticCleanupMission = undefined;
  failedLegacyImport = null;
  constructionPanel.reset();
  baseTabs.hidden = true;
  baseTab = "build";
  missionProduction.hidden = true;
  productionChoices.replaceChildren();
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
}

function updateMissionRadar(mission: MissionView): void {
  if (!radar) return;
  const visible = mission.visibility;
  radar.render({
    visible, explored: mission.explored, view: mission.cameraView,
    entities: snapshotRadarEntities(mission.simulation.snapshot, (entity) => mission.isOwnedUnit(entity.id)),
  });
}

const productionPanel = createProductionPanel({ region: missionProduction, portrait: legacyPortraitImage.parentElement!,
  credits: productionCredits, choices: productionChoices }, (mission) => activeMission() === mission && objectivesPanel.hidden && missionResult.hidden);

const constructionPanel = createConstructionPanel(element<HTMLElement>("#mission-construction"),
  (mission) => activeMission() === mission && objectivesPanel.hidden && missionResult.hidden);

const baseTabs = element<HTMLElement>("#mission-base-tabs");
let baseTab = "build";
for (const button of baseTabs.querySelectorAll<HTMLButtonElement>("button")) {
  button.addEventListener("click", () => {
    baseTab = button.dataset.baseTab!;
    const mission = activeMission();
    if (mission) updateMissionProduction(mission);
  });
}

function updateMissionProduction(mission: MissionView): void {
  productionPanel.render(mission);
  const hasConstruction = constructionPanel.render(mission);
  baseTabs.hidden = !hasConstruction;
  missionProduction.classList.toggle("with-base-tabs", hasConstruction);
  if (hasConstruction) {
    element<HTMLElement>("#mission-construction").hidden = baseTab !== "build";
    missionProduction.hidden = baseTab !== "units";
    legacyPortraitImage.parentElement!.hidden = true;
    for (const button of baseTabs.querySelectorAll<HTMLButtonElement>("button")) {
      button.setAttribute("aria-selected", String(button.dataset.baseTab === baseTab));
    }
  }
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
      updateMissionProduction(mission);
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
    if (mission) updateMissionRadar(mission);
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
    savedMission = stored;
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
  if (assetMode === "simulation" || assetMode === "campaign") {
      skirmish?.update(time);
  const mission = activeMission();
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
  trackMissionPointer(event);
  missionDragStart = { x: event.clientX, y: event.clientY };
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
  if (!missionDragStart) return;
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
  if (!missionDragStart || event.button !== 0) return;
  if (!objectivesPanel.hidden || !missionResult.hidden || !activeMission()) {
    cancelMissionDrag();
    return;
  }
  if (skirmish instanceof MissionView) {
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
  missionDragStart = null;
  missionDragMoved = false;
  selectionBox.hidden = true;
  updateMissionCursor();
});
function cancelMissionDrag(): void {
  missionDragStart = null;
  missionDragMoved = false;
  selectionBox.hidden = true;
  updateMissionCursor();
}
missionCanvas.addEventListener("pointercancel", cancelMissionDrag);
missionCanvas.addEventListener("pointerleave", () => {
  missionPointer = null;
  updateMissionCursor();
});
missionCanvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  if (skirmish instanceof MissionView && objectivesPanel.hidden && missionResult.hidden) skirmish.clearSelection();
});
campaignFactionButtons.forEach((button) =>
  button.addEventListener("click", () => void startCampaign(button.dataset.campaignFaction as Faction)),
);
selectAllUnits.addEventListener("click", () => skirmish?.selectAllPlayerUnits());
stopUnits.addEventListener("click", () => {
  if (skirmish instanceof MissionView) skirmish.stopSelected();
});
deployUnits.addEventListener("click", () => {
  if (!(skirmish instanceof MissionView) || !objectivesPanel.hidden || !missionResult.hidden) return;
  if (skirmish.deploymentSelection.canUndeploy) skirmish.undeploySelected();
  else skirmish.deploySelected();
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
exitCampaign.addEventListener("click", showCampaignLauncher);
saveMissionButton.addEventListener("click", async () => {
  const mission = activeMission();
  if (!mission || mission.missionDiagnostic || mission.missionOutcome?.ready || !missionResult.hidden || !objectivesPanel.hidden) return;
  const token = loadingToken;
  saveMissionButton.disabled = true;
  saveMissionStatus.textContent = "SAVING";
  try {
    const save: SavedMission = { version: 1, faction: mission.playerFaction, missionNumber: campaignMissionNumber,
      savedAt: new Date().toISOString(), checkpoint: mission.checkpoint(), controlGroups: controlGroups.state.groups };
    await writeMissionSave(save);
    savedMission = save;
    if (token === loadingToken) saveMissionStatus.textContent = "SAVED";
  } catch (error) {
    if (token === loadingToken) {
      saveMissionStatus.textContent = "SAVE FAILED";
      saveMissionStatus.title = error instanceof Error ? error.message : String(error);
    }
  } finally { if (token === loadingToken) saveMissionButton.disabled = false; }
});
continueMissionButton.addEventListener("click", () => {
  if (savedMission) void startCampaign(savedMission.faction, savedMission.missionNumber, savedMission.checkpoint, savedMission.controlGroups);
});
element<HTMLButtonElement>("#mission-result-exit").addEventListener("click", showCampaignLauncher);
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
  if (event.defaultPrevented || event.composedPath().some((node) => node instanceof HTMLElement
    && (node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName)))) return;
  if (!missionResult.hidden) {
    if (event.key === "Escape") showCampaignLauncher();
    return;
  }
  if (!objectivesPanel.hidden && event.key !== "Escape" && event.key.toLowerCase() !== "j") return;
  if (assetMode === "campaign" && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
    event.preventDefault();
    skirmish?.selectAllPlayerUnits();
    return;
  }
  if (assetMode === "campaign" && event.key === "Escape" && campaignFaction) {
    if (!objectivesPanel.hidden) {
      objectivesPanel.hidden = true;
      return;
    }
    showCampaignLauncher();
    return;
  }
  if (assetMode === "campaign" && (event.ctrlKey || event.metaKey || event.altKey)) return;
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
      skirmish.selectVisibleInfantry();
      return;
    }
    const movement = key === "arrowleft"
      ? [-4, 0]
      : key === "arrowright"
        ? [4, 0]
        : key === "arrowup"
          ? [0, 4]
          : key === "arrowdown"
            ? [0, -4]
            : null;
    if (movement) {
      event.preventDefault();
      skirmish.panByCells(movement[0], movement[1]);
      return;
    }
  }
  if (event.key === "ArrowLeft") stepFrame(-1);
  if (event.key === "ArrowRight") stepFrame(1);
  if (event.key === " ") {
    event.preventDefault();
    setPlayback(!playing);
  }
});

async function initialize(): Promise<void> {
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
    loadState.textContent = "INDEX UNAVAILABLE";
    decoderStatus.textContent = error instanceof Error ? error.message.toUpperCase() : "INDEX ERROR";
  }
}

requestAnimationFrame(animate);
void initialize();
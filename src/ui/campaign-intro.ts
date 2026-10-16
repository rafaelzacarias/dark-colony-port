import { assetUrl } from "../asset-url";
import { createElement as createIcon, ArrowRight, SkipForward, X } from "lucide";

export type CampaignFaction = "human" | "alien";
export type CampaignLaunchReason = "fresh" | "continue" | "import" | "retry" | "next";
export type IntroStage = "overview" | "briefing" | "deploy" | "cancel";
export interface IntroState {
  readonly stage: IntroStage;
  readonly startedAt: number;
  readonly complete: boolean;
}
export const INTRO_CHARACTERS_PER_SECOND = 35;

export function campaignIntroDataPath(faction: CampaignFaction): string {
  return `/assets/data/campaign-intro-${faction}.json`;
}

export function missionBriefingVoicePath(faction: CampaignFaction, missionNumber: number): string {
  if (!Number.isInteger(missionNumber) || missionNumber < 1 || missionNumber > 15) {
    throw new RangeError(`Invalid mission number for briefing voiceover: ${missionNumber}`);
  }
  return `/assets/generated/media/audio/MISSION/${faction === "human" ? "H" : "G"}${missionNumber}.ogg`;
}

export function shouldShowCampaignIntro(faction: string, missionNumber: number,
  reason: CampaignLaunchReason, checkpoint?: unknown, options?: { readonly allowAlien?: boolean }): boolean {
  const allowedFaction = faction === "human" || (options?.allowAlien === true && faction === "alien");
  return allowedFaction && missionNumber === 1 && reason === "fresh" && checkpoint === undefined;
}

export function introVisibleCharacters(state: IntroState, now: number, length: number): number {
  return state.complete ? length : Math.min(length,
    Math.floor(Math.max(0, now - state.startedAt) * INTRO_CHARACTERS_PER_SECOND / 1000));
}

export function reduceCampaignIntro(state: IntroState, action: "advance" | "skip" | "cancel",
  now: number, length: number): IntroState {
  if (state.stage === "deploy" || state.stage === "cancel") return state;
  if (action === "skip" || action === "cancel") return { ...state, stage: action === "skip" ? "deploy" : "cancel" };
  if (introVisibleCharacters(state, now, length) < length) return { ...state, complete: true };
  return { stage: state.stage === "overview" ? "briefing" : "deploy", startedAt: now, complete: false };
}

export interface IntroToken {
  readonly style: number;
  readonly text: string;
}

export interface CampaignIntroAsset {
  readonly schemaVersion: 1;
  readonly source: { readonly path: string; readonly sha256: string };
  readonly tokens: readonly IntroToken[];
  readonly scene: { readonly title: string; readonly location: string; readonly speaker?: string };
}

export function campaignIntroTokens(rawText: string): IntroToken[] {
  const tokens: IntroToken[] = [];
  let style = 4;
  for (const part of rawText.replace(/\r/g, "").trim().split(/(~\d)/)) {
    if (/^~\d$/.test(part)) style = Number(part[1]);
    else if (part) tokens.push({ style, text: part });
  }
  return tokens;
}

let activeIntro: AbortController | undefined;

export function cancelCampaignIntro(): void {
  activeIntro?.abort();
}

export async function showCampaignIntro(options: {
  readonly faction?: CampaignFaction;
  readonly missionNumber?: number;
  readonly briefing: { readonly plainText: string; readonly rawText: string };
  readonly isCurrent: () => boolean;
}): Promise<"deploy" | "cancel"> {
  cancelCampaignIntro();
  const faction: CampaignFaction = options.faction ?? "human";
  const missionNumber = options.missionNumber ?? 1;
  const factionLabel = faction === "human" ? "Human" : "Alien";
  const controller = new AbortController();
  activeIntro = controller;
  const { signal } = controller;
  let frame = 0;
  let dialog: HTMLDialogElement | undefined;
  let voiceAudio: HTMLAudioElement | undefined;
  let settle: ((result: "deploy" | "cancel") => void) | undefined;
  const stopVoiceAudio = () => {
    if (!voiceAudio) return;
    const currentAudio = voiceAudio;
    voiceAudio = undefined;
    try {
      currentAudio.pause?.();
      currentAudio.removeAttribute?.("src");
      currentAudio.src = "";
      currentAudio.load?.();
    } catch {
      // Ignore cleanup errors in non-DOM test environments
    }
  };
  const previousFocus = document.activeElement;
  const pagehide = () => controller.abort();
  const monitor = () => {
    if (!options.isCurrent()) controller.abort();
    if (!signal.aborted) frame = requestAnimationFrame(monitor);
  };
  signal.addEventListener("abort", () => {
    stopVoiceAudio();
    settle?.("cancel");
  }, { once: true });
  window.addEventListener("pagehide", pagehide);
  frame = requestAnimationFrame(monitor);
  try {
    const response = await fetch(assetUrl(campaignIntroDataPath(faction)), { signal });
    if (!response.ok) throw new Error(`${factionLabel} overview unavailable (${response.status})`);
    const asset = await response.json() as CampaignIntroAsset;
    if (signal.aborted || !options.isCurrent()) return "cancel";
    if (asset.schemaVersion !== 1 || !asset.tokens?.length || !asset.scene?.title) {
      throw new Error(`Invalid ${faction} overview asset`);
    }
    const briefingTokens = campaignIntroTokens(options.briefing.rawText);
    if (briefingTokens.map((token) => token.text).join("") !== options.briefing.plainText) {
      throw new Error("Briefing style tokens do not match full source text");
    }
    const speaker = asset.scene.speaker || (faction === "human" ? "LEUT. Rutkoni" : "Commander");
    const portraitLabel = faction === "human" ? "Leut. Rutkoni" : speaker;
    dialog = document.createElement("dialog");
    dialog.className = "campaign-intro";
    dialog.setAttribute("aria-label", `${factionLabel} campaign predeployment`);
    dialog.innerHTML = `
      <div class="campaign-intro-scene" data-stage="overview" data-faction="${faction}">
        <div class="campaign-intro-globe" role="img" aria-label="Mission globe"></div>
        <div class="campaign-intro-portrait" role="img" aria-label="${portraitLabel}"></div>
        <div class="campaign-intro-strip" aria-hidden="true"></div>
        <p class="campaign-intro-speaker">${speaker}</p>
        <h1 class="campaign-intro-title"></h1>
        <p class="campaign-intro-location"></p>
        <div class="campaign-intro-text" tabindex="0" role="region" aria-label="${factionLabel} overview">
          <div class="campaign-intro-typed" aria-hidden="true"></div>
          <div class="campaign-intro-readable"></div>
        </div>
      </div>
      <footer class="campaign-intro-controls">
        <button type="button" data-intro-action="cancel" title="Cancel intro (Escape)"></button>
        <button type="button" data-intro-action="skip" title="Skip overview and briefing; deploy now"></button>
        <button type="button" data-intro-action="advance"></button>
      </footer>`;
    const scene = dialog.querySelector<HTMLElement>(".campaign-intro-scene")!;
    scene.dataset.faction = faction;
    const text = dialog.querySelector<HTMLElement>(".campaign-intro-text")!;
    const typed = dialog.querySelector<HTMLElement>(".campaign-intro-typed")!;
    const readable = dialog.querySelector<HTMLElement>(".campaign-intro-readable")!;
    dialog.querySelector(".campaign-intro-speaker")!.textContent = speaker;
    dialog.querySelector(".campaign-intro-title")!.textContent = asset.scene.title;
    dialog.querySelector(".campaign-intro-location")!.textContent = asset.scene.location;
    const advance = dialog.querySelector<HTMLButtonElement>('[data-intro-action="advance"]')!;
    const advanceLabel = document.createElement("span");
    advance.append(createIcon(ArrowRight), advanceLabel);
    for (const [action, icon, label] of [["cancel", X, "Missions"], ["skip", SkipForward, "Skip to deployment"]] as const) {
      dialog.querySelector(`[data-intro-action="${action}"]`)!.append(createIcon(icon), document.createTextNode(label));
    }
    dialog.querySelectorAll("svg").forEach((icon) => icon.setAttribute("aria-hidden", "true"));
    let state: IntroState = { stage: "overview", startedAt: performance.now(), complete: false };
    let tokens: readonly IntroToken[] = asset.tokens;
    let length = 0;
    let lastVisible = -1;
    let spans: HTMLElement[] = [];
    const playBriefingVoice = () => {
      stopVoiceAudio();
      const AudioCtor = (typeof window !== "undefined" && (window as unknown as { Audio?: new (src?: string) => HTMLAudioElement }).Audio)
        ?? (globalThis as { Audio?: new (src?: string) => HTMLAudioElement }).Audio;
      if (!AudioCtor) return;
      try {
        voiceAudio = new AudioCtor(assetUrl(missionBriefingVoicePath(faction, missionNumber)));
        void Promise.resolve(voiceAudio.play?.()).catch(() => {});
      } catch {
        voiceAudio = undefined;
      }
    };
    const setStage = () => {
      tokens = state.stage === "overview" ? asset.tokens : briefingTokens;
      length = tokens.reduce((sum, token) => sum + token.text.length, 0);
      scene.dataset.stage = state.stage;
      text.setAttribute("aria-label", state.stage === "overview" ? `${factionLabel} overview` : "Full mission briefing");
      readable.textContent = tokens.map((token) => token.text).join("");
      spans = tokens.map((token) => {
        const span = document.createElement("span");
        span.className = `campaign-intro-ink-${token.style}`;
        return span;
      });
      typed.replaceChildren(...spans);
      text.scrollTop = 0;
      lastVisible = -1;
      if (state.stage === "briefing") playBriefingVoice();
    };
    const paint = (now: number) => {
      const visible = introVisibleCharacters(state, now, length);
      if (visible === lastVisible) return;
      const follow = text.scrollTop + text.clientHeight >= text.scrollHeight - 24;
      let remaining = visible;
      tokens.forEach((token, index) => {
        spans[index].textContent = token.text.slice(0, Math.max(0, remaining));
        remaining -= token.text.length;
      });
      lastVisible = visible;
      if (follow) text.scrollTop = text.scrollHeight;
      advanceLabel.textContent = visible < length ? "Show full text" : state.stage === "overview" ? "Briefing" : "Deploy";
    };
    const act = (action: "advance" | "skip" | "cancel") => {
      const previousStage = state.stage;
      state = reduceCampaignIntro(state, action, performance.now(), length);
      if (state.stage === "deploy" || state.stage === "cancel") {
        stopVoiceAudio();
        settle?.(state.stage);
        return;
      }
      if (state.stage !== previousStage) setStage();
      paint(performance.now());
    };
    dialog.addEventListener("click", (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>("[data-intro-action]");
      if (button) act(button.dataset.introAction as "advance" | "skip" | "cancel");
      else if (!(window.getSelection()?.toString())) act("advance");
    }, { signal });
    dialog.addEventListener("keydown", (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Escape") {
        event.preventDefault();
        act("cancel");
      } else if (event.key === "Enter" || event.key === " ") {
        if (event.repeat) { event.preventDefault(); return; }
        if ((event.target as Element).closest("button")) return;
        event.preventDefault();
        act("advance");
      }
    }, { signal });
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); act("cancel"); }, { signal });
    setStage();
    paint(performance.now());
    document.body.append(dialog);
    const result = new Promise<"deploy" | "cancel">((resolve) => { settle = resolve; });
    dialog.showModal();
    advance.focus();
    cancelAnimationFrame(frame);
    const tick = (now: number) => {
      if (!options.isCurrent()) { controller.abort(); return; }
      paint(now);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return await result;
  } catch (error) {
    if (signal.aborted) return "cancel";
    throw error;
  } finally {
    stopVoiceAudio();
    controller.abort();
    cancelAnimationFrame(frame);
    window.removeEventListener("pagehide", pagehide);
    dialog?.close();
    dialog?.remove();
    if (activeIntro === controller) activeIntro = undefined;
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  }
}
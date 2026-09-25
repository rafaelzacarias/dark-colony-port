import { assetUrl } from "../asset-url";

export type CinematicFaction = "human" | "alien";

// GAMESTAT/HSCENE.TXT and GSCENE.TXT: per mission [victory AVI, defeat AVI]; DC.EXE 403b48 plays +0xc82 on victory, +0x1082 otherwise.
export const CAMPAIGN_CINEMATICS: Readonly<Record<CinematicFaction, readonly (readonly [victory: string, defeat: string])[]>> = {
  human: [
    ["HVAD2", "AVHD4"], ["DESNIGHT", "HTRAN8"], ["HVAD5", "HTRAN10"], ["BODYS", "HTRAN4"], ["CAPTURE", "LIZARDS"],
    ["LENZ", "SYLUNGE"], ["BARBQ", "HTRAN7"], ["HVAD", "HTRAN5"], ["STRATUS", "HTRAN3"], ["HDTEMP", "AVHD5"],
    ["KAOXMAKT", "ATAVHD"], ["HVAD6", "AVHD"], ["HJTEMP", "HTRAN1"], ["ULTIMATE", "SYLUNGE"], ["HENDING", "AFIELD"],
  ],
  alien: [
    ["AVHD4", "HVAD2"], ["AVHD5", "ATRAN3"], ["JTALK3", "JCRAWL"], ["ESCAPE", "ATRAN2"], ["SCRUB", "WASTE"],
    ["DTALK2", "ATRAN6"], ["JTALK2", "BODYS"], ["TICK", "ATRAN7"], ["TEKTAARA", "CRAWL"], ["LIZARDS", "ATRAN1"],
    ["AVHD", "HVAD"], ["JTALK1", "ATRAN4"], ["ADTEMP", "HVAD5"], ["PORTALIS", "CRAWL"], ["AENDING", "COUNCIL"],
  ],
};

/** DC.EXE plays avi/intro.avi at startup (404fe4) and from the main-menu intro action (404df8). */
export const INTRO_CINEMATIC = "INTRO";

export function outcomeCinematic(faction: CinematicFaction, missionNumber: number, resultCode: number): string | undefined {
  const scene = CAMPAIGN_CINEMATICS[faction][missionNumber - 1];
  return scene && (resultCode === 0 ? scene[0] : scene[1]);
}

export function cinematicSources(name: string): readonly { readonly src: string; readonly type: string }[] {
  const root = assetUrl("/assets/generated/media/video/AVI");
  return [
    { src: `${root}/${encodeURIComponent(name)}.mp4`, type: "video/mp4" },
    { src: `${root}/${encodeURIComponent(name)}.webm`, type: "video/webm" },
  ];
}

let active: AbortController | undefined;

export function cancelCinematic(): void {
  active?.abort();
}

export function cinematicPlaying(): boolean {
  return active !== undefined;
}

/** Plays one original AVI conversion full-screen; resolves when it ends, fails, or the player skips it. */
export async function playCinematic(name: string, options: { readonly muted: boolean; readonly onMutedChange?: (muted: boolean) => void }): Promise<"ended" | "skipped" | "failed"> {
  cancelCinematic();
  const controller = new AbortController();
  active = controller;
  const { signal } = controller;
  const previousFocus = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "cinematic-player";
  dialog.setAttribute("aria-label", `Cinematic ${name}`);
  dialog.dataset.cinematic = name;
  const video = document.createElement("video");
  video.playsInline = true;
  video.preload = "auto";
  video.muted = options.muted;
  for (const { src, type } of cinematicSources(name)) {
    const source = document.createElement("source");
    source.src = src;
    source.type = type;
    video.append(source);
  }
  const controls = document.createElement("footer");
  const sound = document.createElement("button");
  sound.type = "button";
  sound.dataset.cinematicAction = "sound";
  const skip = document.createElement("button");
  skip.type = "button";
  skip.dataset.cinematicAction = "skip";
  skip.textContent = "Skip";
  skip.title = "Skip cinematic (Escape)";
  const prompt = document.createElement("button");
  prompt.type = "button";
  prompt.className = "cinematic-start";
  prompt.textContent = "Play cinematic";
  prompt.hidden = true;
  const paintSound = () => {
    sound.textContent = video.muted ? "Sound off" : "Sound on";
    sound.setAttribute("aria-pressed", String(!video.muted));
  };
  paintSound();
  controls.append(sound, skip);
  dialog.append(video, prompt, controls);
  let settle: (result: "ended" | "skipped" | "failed") => void = () => {};
  const result = new Promise<"ended" | "skipped" | "failed">((resolve) => { settle = resolve; });
  signal.addEventListener("abort", () => settle("skipped"), { once: true });
  video.addEventListener("ended", () => settle("ended"), { signal });
  video.addEventListener("error", () => settle("failed"), { signal });
  // The final source is only attempted after every earlier one failed.
  video.lastElementChild?.addEventListener("error", () => settle("failed"), { signal });
  sound.addEventListener("click", (event) => {
    event.stopPropagation();
    video.muted = !video.muted;
    paintSound();
    options.onMutedChange?.(video.muted);
  }, { signal });
  skip.addEventListener("click", (event) => { event.stopPropagation(); settle("skipped"); }, { signal });
  const start = async () => {
    prompt.hidden = true;
    try {
      await video.play();
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof DOMException && error.name === "NotAllowedError" && !video.muted) {
        video.muted = true;
        paintSound();
        try { await video.play(); return; } catch { /* fall through to the explicit prompt */ }
      }
      if (!signal.aborted) prompt.hidden = false;
    }
  };
  prompt.addEventListener("click", (event) => { event.stopPropagation(); void start(); }, { signal });
  dialog.addEventListener("click", () => settle("skipped"), { signal });
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); settle("skipped"); }, { signal });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape" || ((event.key === "Enter" || event.key === " ") && !(event.target as Element).closest("button"))) {
      event.preventDefault();
      settle("skipped");
    }
  }, { signal });
  window.addEventListener("pagehide", () => controller.abort(), { signal });
  document.body.append(dialog);
  dialog.showModal();
  skip.focus();
  void start();
  try {
    return await result;
  } finally {
    controller.abort();
    video.pause();
    video.removeAttribute("src");
    video.replaceChildren();
    video.load();
    dialog.close();
    dialog.remove();
    if (active === controller) active = undefined;
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  }
}

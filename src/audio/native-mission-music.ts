import { assetUrl } from "../asset-url";
import { normalizeAudioSource, resolveAudioAsset, type MediaAudioIndex } from "./cues";
import type { AudioCue, AudioVoice } from "./index";
import { MissionSoundtrack, type SoundtrackPolicy } from "./soundtrack";

export const NATIVE_MISSION_SOUNDTRACK: SoundtrackPolicy = Object.freeze({
  kind: "explicit-playlist",
  sources: Object.freeze(["CDDA/TRACK02", "CDDA/TRACK03", "CDDA/TRACK04", "CDDA/TRACK05"]),
  repeat: "none",
});

export type StreamingMedia = Pick<HTMLAudioElement,
  "src" | "muted" | "volume" | "loop" | "preload" | "paused" | "ended" | "error"
  | "play" | "pause" | "load" | "removeAttribute" | "addEventListener" | "removeEventListener">;

const SILENT_UNLOCK = "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAESsAAABAAgAZGF0YQIAAACAgA==";

export class StreamingMusicAudio {
  private media?: StreamingMedia;
  private voice?: AudioVoice;
  private generation = 0;
  private disposed = false;
  private muted: boolean;

  constructor(
    private readonly index: MediaAudioIndex,
    private readonly options: {
      readonly mediaFactory?: () => StreamingMedia;
      readonly baseUrl?: string;
      readonly muted?: boolean;
    } = {},
  ) { this.muted = options.muted ?? false; }

  private element(): StreamingMedia {
    if (!this.media) {
      this.media = this.options.mediaFactory?.() ?? new Audio();
      this.media.preload = "none";
      this.media.loop = false;
      this.media.muted = this.muted;
      this.media.volume = 0.7 * 0.25;
    }
    return this.media;
  }

  private clear(): void {
    this.media?.pause();
    this.media?.removeAttribute("src");
    this.media?.load();
  }

  async unlock(): Promise<boolean> {
    if (this.disposed || this.muted) return false;
    this.stop();
    const generation = this.generation;
    try {
      const media = this.element();
      media.src = SILENT_UNLOCK;
      await media.play();
      return generation === this.generation && !this.disposed;
    } catch {
      return false;
    } finally {
      if (generation === this.generation) this.clear();
    }
  }

  async play(cue: AudioCue): Promise<AudioVoice | undefined> {
    if (this.disposed || this.muted || cue.signal?.aborted) return undefined;
    const url = resolveAudioAsset(this.index, cue.assetId, this.options.baseUrl);
    if (!url) return undefined;
    const fallback = this.index.entries.find((entry) => entry.kind === "audio" &&
      normalizeAudioSource(entry.source) === normalizeAudioSource(cue.assetId))?.outputs.find((output) => output.mimeType === "audio/mpeg");
    const fallbackUrl = fallback ? `${(this.options.baseUrl ?? assetUrl("/assets/generated/media/")).replace(/\/$/, "")}/${fallback.path}` : undefined;
    return this.playSource(cue, url, fallbackUrl);
  }

  private async playSource(cue: AudioCue, url: string, fallbackUrl?: string): Promise<AudioVoice | undefined> {
    if (this.disposed || this.muted || cue.signal?.aborted) return undefined;
    this.stop();
    const generation = this.generation;
    const media = this.element();
    let active = true;
    let decoderFailure = false;
    let finish!: (reason: "ended" | "stopped") => void;
    const finished = new Promise<"ended" | "stopped">((resolve) => { finish = resolve; });
    const release = (reason: "ended" | "stopped") => {
      if (!active) return;
      active = false;
      media.removeEventListener("ended", ended);
      media.removeEventListener("pause", paused);
      media.removeEventListener("error", failed);
      cue.signal?.removeEventListener("abort", stopped);
      if (generation === this.generation) {
        this.voice = undefined;
        this.clear();
      }
      finish(reason);
    };
    const ended = () => { if (media.ended) release(this.muted ? "stopped" : "ended"); };
    const paused = () => { if (media.paused && !media.ended) release("stopped"); };
    const failed = () => {
      if (!media.error) return;
      decoderFailure = media.error.code === 3 || media.error.code === 4;
      release("stopped");
    };
    const stopped = () => release("stopped");
    const voice: AudioVoice = {
      get active() { return active; }, finished, stop: stopped, setPosition() {},
    };
    this.voice = voice;
    media.src = url;
    media.addEventListener("ended", ended);
    media.addEventListener("pause", paused);
    media.addEventListener("error", failed);
    cue.signal?.addEventListener("abort", stopped, { once: true });
    try {
      await media.play();
      if (generation !== this.generation || cue.signal?.aborted || this.disposed) {
        stopped();
        return undefined;
      }
      return voice;
    } catch {
      decoderFailure ||= media.error?.code === 3 || media.error?.code === 4;
      stopped();
      if (decoderFailure && fallbackUrl && generation === this.generation && !cue.signal?.aborted && !this.disposed) {
        return this.playSource(cue, fallbackUrl);
      }
      return undefined;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.media) this.media.muted = muted;
  }

  stop(): void {
    this.voice?.stop();
    this.generation++;
    this.clear();
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
  }
}

export class NativeMissionMusic {
  private readonly stream: StreamingMusicAudio;
  private readonly soundtrack: MissionSoundtrack;
  private active = false;
  private lastPoll = 0;
  private muted: boolean;

  constructor(index: MediaAudioIndex, options: ConstructorParameters<typeof StreamingMusicAudio>[1] = {}) {
    this.stream = new StreamingMusicAudio(index, options);
    this.soundtrack = new MissionSoundtrack(this.stream, index);
    this.muted = options.muted ?? false;
  }

  get state() { return this.soundtrack.state; }

  prepareFromGesture(): void {
    this.stop();
    void this.stream.unlock();
  }

  start(): Promise<boolean> {
    if (this.state === "disposed") return Promise.resolve(false);
    this.active = true;
    return this.soundtrack.start(NATIVE_MISSION_SOUNDTRACK);
  }

  retryFromGesture(): Promise<boolean> {
    if (!this.active || this.muted || this.state === "disposed") return Promise.resolve(false);
    this.stream.stop();
    return this.start();
  }

  update(now: number): void {
    if (!this.active || !Number.isFinite(now) || now - this.lastPoll <= 5000) return;
    this.lastPoll = now;
    if (this.state === "completed" && !this.muted) void this.start();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.stream.setMuted(muted);
  }

  stop(): void {
    this.active = false;
    this.soundtrack.stop();
    this.stream.stop();
  }

  dispose(): void {
    this.stop();
    this.soundtrack.dispose();
    this.stream.dispose();
  }
}
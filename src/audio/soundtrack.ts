import { resolveAudioAsset, type MediaAudioIndex } from "./cues";
import type { AudioEngine, AudioVoice } from "./index";

export interface SoundtrackPolicy {
  readonly kind: "explicit-playlist";
  readonly sources: readonly string[];
  readonly repeat: "none" | "all";
}

export type SoundtrackState = "idle" | "loading" | "playing" | "completed" | "blocked" | "disposed";

export class MissionSoundtrack {
  private voice?: AudioVoice;
  private controller?: AbortController;
  private generation = 0;
  private currentState: SoundtrackState = "idle";

  constructor(
    private readonly audio: Pick<AudioEngine, "play">,
    private readonly mediaIndex: MediaAudioIndex,
  ) {}

  get state(): SoundtrackState { return this.currentState; }

  async start(policy: SoundtrackPolicy): Promise<boolean> {
    if (this.currentState === "disposed") return false;
    this.stop();
    if (policy.kind !== "explicit-playlist" || !["none", "all"].includes(policy.repeat)
      || policy.sources.length < 1 || policy.sources.length > 32
      || policy.sources.some((source) => !resolveAudioAsset(this.mediaIndex, source))) {
      this.currentState = "blocked";
      return false;
    }
    const sources = [...policy.sources];
    this.controller = new AbortController();
    return this.playNext(sources, policy.repeat, 0, this.generation, this.controller.signal);
  }

  private async playNext(
    sources: readonly string[], repeat: SoundtrackPolicy["repeat"], index: number,
    generation: number, signal: AbortSignal,
  ): Promise<boolean> {
    this.currentState = "loading";
    let voice: AudioVoice | undefined;
    try {
      voice = await this.audio.play({ assetId: sources[index], gain: 0.25, priority: 10, loop: false, signal });
    } catch {
      voice = undefined;
    }
    if (generation !== this.generation || signal.aborted) {
      voice?.stop();
      return false;
    }
    if (!voice) {
      this.currentState = "blocked";
      return false;
    }
    this.voice = voice;
    this.currentState = "playing";
    void voice.finished.then((reason) => {
      if (generation !== this.generation || signal.aborted) return;
      this.voice = undefined;
      if (reason !== "ended") {
        this.currentState = "blocked";
        return;
      }
      const next = index + 1;
      if (next === sources.length && repeat === "none") {
        this.currentState = "completed";
        return;
      }
      void this.playNext(sources, repeat, next % sources.length, generation, signal);
    });
    return true;
  }

  stop(): void {
    if (this.currentState === "disposed") return;
    this.generation++;
    this.controller?.abort();
    this.controller = undefined;
    this.voice?.stop();
    this.voice = undefined;
    this.currentState = "idle";
  }

  dispose(): void {
    this.stop();
    this.currentState = "disposed";
  }
}
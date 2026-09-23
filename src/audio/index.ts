import { resolveAudioCandidates, spatialAudio, type AudioListener, type AudioPosition, type MediaAudioIndex } from "./cues";

export * from "./cues";
export * from "./soundtrack";
export { legacyCueCatalog } from "./legacy-cues";

export interface AudioCue {
  readonly assetId: string;
  readonly gain?: number;
  readonly pan?: number;
  readonly priority?: number;
  readonly loop?: boolean;
  readonly position?: AudioPosition;
  readonly listener?: AudioListener;
  readonly signal?: AbortSignal;
}

export interface AudioVoice {
  readonly active: boolean;
  readonly finished: Promise<"ended" | "stopped">;
  stop(): void;
  setPosition(position: AudioPosition, listener: AudioListener): void;
}

export interface AudioEngine {
  unlock(): Promise<boolean>;
  resume(): Promise<void>;
  play(cue: AudioCue): Promise<AudioVoice | undefined>;
  setGain(gain: number): void;
  setMuted(muted: boolean): void;
  stopAll(): void;
  dispose(): Promise<void>;
}

export interface AudioManagerOptions {
  readonly mediaIndex: MediaAudioIndex;
  readonly baseUrl?: string;
  readonly maxCacheBytes?: number;
  readonly maxCacheEntries?: number;
  readonly maxVoices?: number;
  readonly maxPendingLoads?: number;
  readonly maxPendingPlays?: number;
  readonly gain?: number;
  readonly muted?: boolean;
  readonly contextFactory?: () => AudioContext;
  readonly fetch?: typeof globalThis.fetch;
}

interface CachedBuffer {
  readonly buffer: AudioBuffer;
  readonly bytes: number;
}

interface PendingBuffer {
  readonly epoch: number;
  readonly controller: AbortController;
  readonly promise: Promise<AudioBuffer | undefined>;
}

interface ActiveVoice {
  readonly priority: number;
  readonly stop: () => void;
}

function clamp(value: number, minimum: number, maximum: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
}

function limit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError("Audio limits must be positive safe integers");
  return value;
}

export class WebAudioManager implements AudioEngine {
  private readonly cache = new Map<string, CachedBuffer>();
  private readonly pending = new Map<string, PendingBuffer>();
  private readonly voices = new Set<ActiveVoice>();
  private readonly unlockSources = new Set<AudioBufferSourceNode>();
  private readonly maxCacheBytes: number;
  private readonly maxCacheEntries: number;
  private readonly maxVoices: number;
  private readonly maxPendingLoads: number;
  private readonly maxPendingPlays: number;
  private context?: AudioContext;
  private master?: GainNode;
  private cacheBytes = 0;
  private pendingPlays = 0;
  private epoch = 0;
  private unlocked = false;
  private disposed = false;
  private gain: number;
  private muted: boolean;

  constructor(private readonly options: AudioManagerOptions) {
    this.maxCacheBytes = limit(options.maxCacheBytes, 32 * 1024 * 1024);
    this.maxCacheEntries = limit(options.maxCacheEntries, 64);
    this.maxVoices = limit(options.maxVoices, 24);
    this.maxPendingLoads = limit(options.maxPendingLoads, 4);
    this.maxPendingPlays = limit(options.maxPendingPlays, 32);
    this.gain = clamp(options.gain ?? 0.7, 0, 1, 0.7);
    this.muted = options.muted ?? false;
  }

  get stats() {
    return {
      cacheEntries: this.cache.size, cacheBytes: this.cacheBytes,
      activeVoices: this.voices.size, pendingLoads: this.pending.size,
      pendingPlays: this.pendingPlays, unlocked: this.unlocked && this.context?.state === "running",
      disposed: this.disposed,
    };
  }

  async unlock(): Promise<boolean> {
    if (this.disposed) return false;
    try {
      if (!this.context) {
        this.context = this.options.contextFactory?.() ?? new AudioContext();
        this.master = this.context.createGain();
        this.updateMaster();
        this.master.connect(this.context.destination);
      }
      const context = this.context;
      const source = context.createBufferSource();
      source.buffer = context.createBuffer(1, 1, context.sampleRate);
      source.onended = () => this.releaseUnlockSource(source);
      this.unlockSources.add(source);
      source.connect(context.destination);
      source.start();
      await context.resume();
      this.unlocked = !this.disposed && context.state === "running";
      return this.unlocked;
    } catch {
      this.unlocked = false;
      for (const source of this.unlockSources) this.releaseUnlockSource(source, true);
      return false;
    }
  }

  async resume(): Promise<void> {
    await this.unlock();
  }

  setGain(gain: number): void {
    this.gain = clamp(gain, 0, 1, 0);
    this.updateMaster();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.updateMaster();
  }

  private updateMaster(): void {
    if (this.master && this.context) this.master.gain.setValueAtTime(this.muted ? 0 : this.gain, this.context.currentTime);
  }

  private releaseUnlockSource(source: AudioBufferSourceNode, stop = false): void {
    source.onended = null;
    if (stop) {
      try { source.stop(); } catch {}
    }
    source.disconnect();
    source.buffer = null;
    this.unlockSources.delete(source);
  }

  private async load(urls: readonly string[]): Promise<AudioBuffer | undefined> {
    const url = urls[0];
    const cached = this.cache.get(url);
    if (cached) {
      this.cache.delete(url);
      this.cache.set(url, cached);
      return cached.buffer;
    }
    const existing = this.pending.get(url);
    if (existing) return existing.epoch === this.epoch ? existing.promise : undefined;
    if (this.pending.size >= this.maxPendingLoads || !this.context) return undefined;
    const context = this.context;
    const epoch = this.epoch;
    const controller = new AbortController();
    const promise = (async () => {
      let buffer: AudioBuffer | undefined;
      for (const candidate of urls) {
        if (controller.signal.aborted || this.disposed || epoch !== this.epoch) return undefined;
        const response = await (this.options.fetch ?? globalThis.fetch)(candidate, { signal: controller.signal });
        if (!response.ok) throw new Error(`Audio HTTP ${response.status}`);
        const encoded = await response.arrayBuffer();
        if (controller.signal.aborted || this.disposed || epoch !== this.epoch) return undefined;
        try {
          buffer = await context.decodeAudioData(encoded);
          break;
        } catch {
          if (controller.signal.aborted || this.disposed || epoch !== this.epoch) return undefined;
        }
      }
      if (!buffer) return undefined;
      if (controller.signal.aborted || this.disposed || epoch !== this.epoch) return undefined;
      const bytes = buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
      if (bytes > this.maxCacheBytes) return undefined;
      while (this.cache.size >= this.maxCacheEntries || this.cacheBytes + bytes > this.maxCacheBytes) {
        const oldest = this.cache.keys().next().value;
        if (oldest === undefined) break;
        this.cacheBytes -= this.cache.get(oldest)!.bytes;
        this.cache.delete(oldest);
      }
      this.cache.set(url, { buffer, bytes });
      this.cacheBytes += bytes;
      return buffer;
    })();
    this.pending.set(url, { epoch, controller, promise });
    try {
      return await promise;
    } finally {
      if (this.pending.get(url)?.promise === promise) this.pending.delete(url);
    }
  }

  async play(cue: AudioCue): Promise<AudioVoice | undefined> {
    if (cue.signal?.aborted || this.disposed || !this.unlocked || this.context?.state !== "running" || this.muted
      || this.pendingPlays >= this.maxPendingPlays) return undefined;
    const urls = resolveAudioCandidates(this.options.mediaIndex, cue.assetId, this.options.baseUrl);
    if (!urls.length) return undefined;
    const epoch = this.epoch;
    this.pendingPlays++;
    try {
      const buffer = await this.load(urls);
      if (!buffer || cue.signal?.aborted || this.disposed || epoch !== this.epoch || this.muted || this.context.state !== "running") return undefined;
      return this.startVoice(buffer, cue);
    } catch {
      return undefined;
    } finally {
      this.pendingPlays--;
    }
  }

  private startVoice(buffer: AudioBuffer, cue: AudioCue): AudioVoice | undefined {
    const priority = clamp(cue.priority ?? 50, -1000, 1000, 50);
    if (this.voices.size >= this.maxVoices) {
      let victim: ActiveVoice | undefined;
      for (const voice of this.voices) if (!victim || voice.priority < victim.priority) victim = voice;
      if (!victim || victim.priority > priority) return undefined;
      victim.stop();
    }
    const context = this.context!;
    const source = context.createBufferSource();
    const gain = context.createGain();
    const panner = context.createStereoPanner();
    const baseGain = clamp(cue.gain ?? 1, 0, 1, 0);
    const spatial = cue.position && cue.listener ? spatialAudio(cue.position, cue.listener) : undefined;
    source.buffer = buffer;
    source.loop = cue.loop ?? false;
    gain.gain.value = baseGain * (spatial?.gain ?? 1);
    panner.pan.value = spatial?.pan ?? clamp(cue.pan ?? 0, -1, 1, 0);
    let active = true;
    let finish!: (reason: "ended" | "stopped") => void;
    const finished = new Promise<"ended" | "stopped">((resolve) => { finish = resolve; });
    const abort = () => release(true);
    const release = (stop: boolean) => {
      if (!active) return;
      active = false;
      cue.signal?.removeEventListener("abort", abort);
      source.onended = null;
      if (stop) {
        try { source.stop(); } catch {}
      }
      source.disconnect();
      gain.disconnect();
      panner.disconnect();
      source.buffer = null;
      this.voices.delete(record);
      finish(stop ? "stopped" : "ended");
    };
    const record: ActiveVoice = { priority, stop: () => release(true) };
    source.onended = () => release(false);
    this.voices.add(record);
    cue.signal?.addEventListener("abort", abort, { once: true });
    try {
      source.connect(gain);
      gain.connect(panner);
      panner.connect(this.master!);
      source.start();
    } catch (error) {
      release(true);
      throw error;
    }
    return {
      get active() { return active; },
      finished,
      stop: record.stop,
      setPosition: (position, listener) => {
        if (!active) return;
        const next = spatialAudio(position, listener);
        panner.pan.setValueAtTime(next.pan, context.currentTime);
        gain.gain.setValueAtTime(baseGain * next.gain, context.currentTime);
      },
    };
  }

  stopAll(): void {
    this.epoch++;
    for (const request of this.pending.values()) request.controller.abort();
    for (const voice of this.voices) voice.stop();
    for (const source of this.unlockSources) this.releaseUnlockSource(source, true);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unlocked = false;
    this.stopAll();
    this.cache.clear();
    this.cacheBytes = 0;
    this.master?.disconnect();
    try {
      if (this.context && this.context.state !== "closed") await this.context.close();
    } catch {
      return;
    }
  }
}

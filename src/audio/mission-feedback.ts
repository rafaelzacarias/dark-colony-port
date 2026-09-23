import { resolveUnitCue, type AudioListener, type AudioPosition, type UnitAudioEvent } from "./cues";
import { legacyCueCatalog } from "./legacy-cues";
import type { AudioCue, AudioEngine } from "./index";
import type { CombatEvent, DeathEvent } from "../engine/simulation";

export interface FeedbackActor extends AudioPosition {
  readonly unitType: number;
  readonly weaponId: number;
}

export function createMissionAudioFeedback(audio: Pick<AudioEngine, "play"> | undefined, nativeCombat: boolean): MissionAudioFeedback | undefined {
  return audio && !nativeCombat ? new MissionAudioFeedback(audio) : undefined;
}

export class MissionAudioFeedback {
  readonly #variants = new Map<string, number>();
  #lifetime = new AbortController();
  #response: AbortController | undefined;
  #lastResponse = -Infinity;
  #nextEventTick = 0;
  #disposed = false;

  constructor(private readonly audio: Pick<AudioEngine, "play">,
    private readonly now: () => number = () => performance.now()) {}

  #cue(event: UnitAudioEvent) {
    const first = resolveUnitCue(legacyCueCatalog, event);
    if (!first) return undefined;
    const { group, id } = first.evidence;
    const key = `${group}:${id}`;
    const count = legacyCueCatalog.bindings.find(binding => binding.group === group && binding.id === id)!.soundIds.length;
    const variant = this.#variants.get(key) ?? 0;
    this.#variants.set(key, (variant + 1) % count);
    return resolveUnitCue(legacyCueCatalog, event, variant);
  }

  #play(cue: AudioCue): void {
    void this.audio.play(cue).catch(() => undefined);
  }

  response(type: "unit-selected" | "unit-move", unitType: number): void {
    if (this.#disposed) return;
    this.#response?.abort();
    this.#response = undefined;
    const now = this.now();
    if (!Number.isFinite(now) || now - this.#lastResponse < 150) return;
    const cue = this.#cue({ type, unitType });
    if (!cue) return;
    this.#lastResponse = now;
    this.#response = new AbortController();
    this.#play({ ...cue, signal: this.#response.signal });
  }

  present(frame: {
    readonly tick: number;
    readonly shots: readonly CombatEvent[];
    readonly deaths: readonly DeathEvent[];
    readonly actors: ReadonlyMap<number, FeedbackActor>;
    readonly listener: AudioListener;
  }): void {
    if (this.#disposed || frame.tick <= this.#nextEventTick) return;
    const eligible = (tick: number) => tick >= this.#nextEventTick && tick < frame.tick;
    for (const event of frame.shots) {
      if (!eligible(event.tick)) continue;
      const actor = frame.actors.get(event.attackerId);
      if (!actor) continue;
      const cue = this.#cue({ type: "unit-attack", weaponId: actor.weaponId });
      if (cue) this.#play({ ...cue, position: { x: actor.x, y: actor.y }, listener: frame.listener, signal: this.#lifetime.signal });
    }
    for (const event of frame.deaths) {
      if (!eligible(event.tick)) continue;
      const actor = frame.actors.get(event.targetId);
      if (!actor) continue;
      const cue = this.#cue({ type: "unit-death", unitType: actor.unitType });
      if (cue) this.#play({ ...cue, position: { x: actor.x, y: actor.y }, listener: frame.listener, signal: this.#lifetime.signal });
    }
    this.#nextEventTick = frame.tick;
  }

  reset(tick: number): void {
    this.#lifetime.abort();
    this.#response?.abort();
    this.#response = undefined;
    this.#lifetime = new AbortController();
    this.#nextEventTick = tick;
    this.#variants.clear();
    this.#lastResponse = -Infinity;
  }

  dispose(): void {
    this.reset(this.#nextEventTick);
    this.#disposed = true;
  }
}
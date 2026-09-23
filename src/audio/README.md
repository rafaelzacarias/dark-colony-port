# Audio Integration

This subsystem does not install event handlers or autoplay anything. Load the
existing media index through the application's asset loader, then create one
manager for the application:

```ts
import { WebAudioManager, legacyCueCatalog, resolveUnitCue } from "./audio";

const audio = new WebAudioManager({ mediaIndex });

async function onStartGesture() {
  const ready = await audio.unlock();
  // Start the game even when audio is unavailable.
  return ready;
}

const selected = resolveUnitCue(legacyCueCatalog, {
  type: "unit-selected", unitType: 0,
});
if (selected) void audio.play(selected);

const moved = resolveUnitCue(legacyCueCatalog, {
  type: "unit-move", unitType: 8,
}, variantIndex);
if (moved) void audio.play(moved);

const fired = resolveUnitCue(legacyCueCatalog, {
  type: "unit-attack", weaponId: activeLegacyWeaponId,
}, variantIndex);
if (fired) void audio.play({
  ...fired,
  position: { x: unitX, y: unitY },
  listener: { x: cameraX, y: cameraY, halfWidth: viewHalfWidth, audibleRadius: 24 },
});

audio.setGain(0.7);
audio.setMuted(true);
audio.stopAll();
await audio.dispose();
```

Call `unlock()` directly inside the start/click/touch handler, before any other
`await`. It synchronously creates the context, starts a silent one-sample buffer,
and requests resume. Await its result before the first audible cue. `resume()`
is a compatibility alias. Playback never resumes a suspended context by itself.
Call `unlock()` again from a gesture if the browser suspends audio.

`play()` accepts a source identifier from the media index, not an arbitrary URL.
It returns a voice handle or `undefined` for locked/muted/unavailable audio,
failed fetch/decode, cancellation, exhausted limits, or oversized buffers.
Handles expose `active`, `stop()`, `setPosition(position, listener)`, and a
`finished` promise resolving to `"ended"` for natural completion or `"stopped"`
for cancellation, explicit stop, eviction or disposal. An optional cue `signal`
cancels that play without cancelling another caller's shared buffer load.
Positions, camera coordinates, half-width and audible radius use the same units.
Pan is horizontal and clamped; attenuation is linear radial distance.

## Source Evidence

- `legacy-cues.ts` is generated from SOUND/SOUND2.DAT and SOUND/SLIST.DAT,
  with SHA-256 provenance. It contains 200 sounds and 244 binding rows.
- SLIST `SEL` binds unit type to selection; `ACK` binds unit type to order
  acknowledgment. The move event uses that acknowledgment, not a movement loop.
- SLIST `GUN` binds **weapon ID**, not unit type. Fire it when a shot actually
  occurs, not when an attack command is issued. GAMESTAT/GAMESTAT.TXT identifies
  Security troops (unit 0) with weapons 1/2/3 and Grey Warriors (unit 8) with
  weapons 15/16/17. The caller supplies the actual weapon at its current level.
- Repeated sound IDs are retained as source weights. Supply a nonnegative integer
  variant index to select deterministically; the resolver does not use randomness.
- Unknown IDs have no fallback. The table wins over filename suffixes: unit 73's
  first `SEL` is sound 198, GCACK2.WAV. Numeric SOUND2 parameters and SLIST values
  after `-1` are retained, but their unverified meanings are not applied.
- H1/G1 and other short clips are not classified as mission narration. There is
  no narration binding or mission-start autoplay.

## Limits and Lifecycle

Defaults: 64 cached buffers, 32 MiB decoded PCM cache, 24 active voices,
4 simultaneous loads/decodes, and 32 pending play calls. Cache entries use LRU;
same-asset loads share a single decode. Each buffer must fit the byte budget.
The byte limit covers cached PCM, not browser decode scratch memory or buffers
still held by active voices. Active voices and in-flight requests are separately
bounded. Oversized files are rejected after decoding.

Higher numeric priority wins; at capacity an incoming voice replaces the oldest
voice with the lowest priority only if its priority is at least as high. Source
responses use priority 70, weapon sounds 40, and explicit playback defaults to 50.
Gain is clamped to 0..1. Mute preserves the chosen gain and suppresses new cues;
existing voices continue silently until unmuted or stopped.

`stopAll()` stops/disconnects voices and aborts pending requests. Uncancellable
decodes retain their load slot until completion but cannot start stale audio or
repopulate the cache. Cached completed buffers remain reusable. `dispose()` also
clears the cache and closes the context; it is terminal and idempotent. A supplied
`contextFactory` must return a context owned exclusively by this manager.

`MissionSoundtrack` provides optional, explicit source-playlist scheduling over
this manager. It has no default playlist, gesture handlers, or application wiring.
See [the scheduling contract](../../docs/audio-scheduling.md) for policy, limits,
mission cleanup requirements and the unresolved native-order evidence blocker.
This remains a buffer player, not a streaming music player; long CD tracks may
exceed the default cache budget. No ambient or CD-to-mission assignments are inferred.

## Reproduction

From the repository root:

```sh
node --import tsx tools/extractors/audio-cues/index.ts
node --import tsx --test tools/qa/audio.test.ts tools/qa/audio-scheduling.test.ts
```

The extractor writes only `src/audio/legacy-cues.ts`. No ingestion integration or
changes to the application entry points are required. Tests check source hashes,
exact extracted mappings, all 200 media resolutions, and a fake Web Audio graph.
Audible output and real browser autoplay policies still require browser/device QA.
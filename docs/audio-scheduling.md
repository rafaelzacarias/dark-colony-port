# Mission Soundtrack Scheduling

## Acceptance Boundary

Implemented: a bounded, independently tested scheduling mechanism using explicit
source identifiers from the converted media index. Not implemented: native
in-mission track assignment/order, a production soundtrack selector, or automatic
mission music. This does **not** close Phase4 native audio parity or justify
acceptance of all phases. No application entry point is changed.

## Evidence

- [Disc extraction](../tools/extractors/disc/extract.ts) emits `CDDA/TRACKnn`
  from parsed MDS track numbers and records hashes of source PCM and encoded Ogg.
- [The media index](../public/assets/generated/media/index.json) maps
  `CDDA/TRACK02` through `CDDA/TRACK05` to `cd/TRACK02.ogg` through
  `cd/TRACK05.ogg`. Focused tests verify those converted files against their
  indexed SHA-256 hashes. They do not rerun extraction or validate audibility.
- The inspected audio docs, source sound tables, research/docs search and disc
  metadata establish no music-call binding to mission/faction, native start
  trigger, track order, repeat rule, or combat-driven transitions. Disc numbering
  proves identity, not gameplay order. SLIST cue mappings are not music mappings.

Native wiring remains blocked on source call-site or reproducible original-game
evidence for those decisions. There is no guessed human/alien playlist.

## Explicit Policy

Create one `MissionSoundtrack(audio, mediaIndex)` per mission audio lifecycle.
Construction performs no playback, fetching, unlocking or timer registration.
`start()` requires a policy with `kind: "explicit-playlist"`, an ordered `sources`
array, and `repeat: "none" | "all"`. Sources must resolve to converted audio/ogg
entries; URLs, missing sources and playlists outside 1..32 entries are rejected
as a whole. This policy describes a caller/user choice, not recovered native
behavior. Repeated sources are allowed; there is no sorting or randomization.

Playback uses gain 0.25, priority 10 and non-looping voices. Only natural completion
advances to the next source; `repeat: "all"` wraps that exact order. There is no
prefetch, crossfade, gapless guarantee, combat selection, narration or ambient
fallback. The scheduler snapshots the playlist and retains one active voice.
Replacement stops the prior voice and invalidates its pending work.

The shared manager retains its existing voice, pending-play, load and LRU limits.
Music competes at low priority and may be evicted by cues. A failure, mute at a
track boundary, suspension, eviction or exhausted budget yields `blocked`; there
is no skip/retry loop. `completed` means a nonrepeating list ended naturally.
Explicit `start()` can retry; `stop()` returns to `idle`; `dispose()` is terminal.

## Memory And Cancellation

The default decoded cache is still 32 MiB. At 44.1 kHz stereo Float32, track 05
alone is 69,910,848 bytes; tracks 02/04 also exceed the default. A caller could
deliberately choose 96 MiB for common 44.1/48 kHz contexts, but must account for
actual device resampling and competing cues. Oversized tracks fail closed.
The scheduler never raises limits. Streaming long music remains outside scope.

A per-cue `AbortSignal` suppresses playback after a stale load/decode and stops an
active voice. It does not abort a shared fetch or discard reusable decoded PCM.
An uncancellable decode retains its bounded slot until completion; repeated
replacements cannot bypass manager limits. `audio.stopAll()` on mission exit
aborts fetches and prevents stale decodes from refilling the cache. Completed
cached buffers remain reusable under the existing budget.

## Wiring Requirements

Production wiring is deliberately deferred. A future explicit user-controlled
mode can be added without claiming native parity; a native default needs evidence.

1. Present an explicit source/playlist choice and repeat choice, or provide a
   verified source policy. Do not silently turn deployment into music consent.
2. Use the same `WebAudioManager` and media index as mission cues. Decide a bounded
   PCM budget explicitly; do not allocate an unbounded second music cache.
3. Call `audio.unlock()` synchronously inside the user gesture before any other
   `await`. Await success, mission initialization and the current mission token
   before `soundtrack.start(policy)`. Never unlock from a completion callback.
4. Keep `audio.setMuted()` as the shared mute control. Active music continues
   silently while muted; a muted track boundary blocks advancement. Unmuting alone
   does not restart a blocked playlist. Retry only within the explicit workflow.
5. In `resetMissionControls`, call `soundtrack.stop()` before `audio.stopAll()`.
   Apply the same ordering on result/exit, mission replacement, failed load, and
   any other path ending the mission. Dispose the scheduler on final teardown.
6. If suspension occurs, require another gesture to unlock and explicitly restart
   the schedule. Surface `blocked` without claiming which underlying resource or
   browser policy failed; the manager deliberately returns a generic unavailable
   result.

The existing mission lifecycle, cue unlock, mute and exit behavior is unchanged.

## Verification

```sh
node --import tsx --test tools/qa/audio.test.ts tools/qa/audio-scheduling.test.ts
npm run typecheck
```

Tests cover source/output hashes, explicit order/repeat, playlist bounds and
snapshotting, stale replacement callbacks, pending cancellation, disposal,
natural versus forced completion, gesture/mute behavior, low-priority interruption,
long-track budget rejection and mission-exit cleanup. Web Audio is faked; the
long-track test models decoded sizes without decoding real PCM.

Before shipping a wired mode, run orchestrator-owned browser/device QA for audible
Opus playback, real decode/resampling costs, gesture unlock (including iOS), mute
across track boundaries, background suspension, voice contention and exit during
fetch/decode. No shared browser or external browser window was used for this work.
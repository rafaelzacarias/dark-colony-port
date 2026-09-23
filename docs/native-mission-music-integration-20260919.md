# Native Mission Music Integration

## Integrated Browser Follow-Up

The orchestrator tested the existing embedded tab without opening another window.
Its decoder rejected valid Ogg Opus with `DEMUXER_ERROR_NO_SUPPORTED_STREAMS`
despite `canPlayType` returning `probably`. Direct inspection of VS Code's FFmpeg
library found no Opus decoder, while MP3/Vorbis decoders were present. Packet,
page CRC and fresh-encoding comparisons found no corruption in the source Ogg.

The CD exporter now preserves Ogg and additionally emits deterministic MP3 from
the original PCM. Streaming retries that alternative once after an initial
decode/unsupported-format error (codes 3/4). Network errors and autoplay denial
do not trigger codec retries. A failed alternative blocks normally. No second
media element or full-track PCM cache is allocated.

Real embedded checks passed: TRACK02.mp3 ready/playing with progressing time;
mute/unmute kept the same stream; real ended events after accelerated seeks
advanced to 03, 04 and 05; mission exit removed the source and paused playback;
exactly one mission media element remained. Expected aborted Ogg requests and
seek/exit cancellations are not successful Ogg decode evidence. Physical
audibility, gapless transitions, real-user gesture permission and iOS/WebKit
remain unverified. The final application gate passed 416 tests with two optional
browser skips, plus typechecking and production build.

## Evidence And Scope

Implemented from the complete
[native CD report](native-cd-audio-20260919.md), including its safe web policy.
The implementation is in
[native-mission-music.ts](../src/audio/native-mission-music.ts), with lifecycle
hooks in [main.ts](../src/main.ts) and dedicated
[fake-media tests](../tools/qa/native-mission-music.test.ts).
The existing WebAudioManager, explicit MissionSoundtrack scheduler, and their
tests are unchanged. MissionView, game-data, progression/fog behavior, and
shared acceptance documents were not edited by this task.

Verified here: 43 focused audio tests pass, followed by a clean TypeScript
typecheck. This includes the existing converted-CD Ogg SHA-256 checks and the
new exact mapping assertion against the converted media index:

| Physical track | Source | Streaming output |
| --- | --- | --- |
| 2 | CDDA/TRACK02 | /assets/generated/media/cd/TRACK02.ogg |
| 3 | CDDA/TRACK03 | /assets/generated/media/cd/TRACK03.ogg |
| 4 | CDDA/TRACK04 | /assets/generated/media/cd/TRACK04.ogg |
| 5 | CDDA/TRACK05 | /assets/generated/media/cd/TRACK05.ogg |

```sh
node --import tsx --test tools/qa/native-mission-music.test.ts tools/qa/audio-scheduling.test.ts tools/qa/audio.test.ts
npm run typecheck
```

No browser, physical device, additional agent, or full test suite was used.
Browser lifecycle integration, real audibility, and native audible parity are
NOT accepted by these unit/type checks. Existing report evidence is reused;
this task does not claim a new native executable or disc extraction audit.

## Runtime Contract

- The unchanged explicit scheduler receives 02, 03, 04, 05 with repeat none.
  Only a natural media end advances. Pause, media error, or rejected play
  blocks, clears the source, and requires explicit retry; no automatic error
  recovery, track skipping, or invented timeout is added.
- A single persistent HTMLAudioElement streams the files. There is no music
  fetch/arrayBuffer/decodeAudioData path, PCM cache, prefetch element, or timer.
  At most three media listeners are attached during playback and zero remain
  after end/stop/disposal. Forty complete runs test element/listener bounds.
  The browser still owns its internal network/decoder buffering; this is not
  an absolute process-memory byte limit or a gapless guarantee.
- Deployment calls both the shared sound-effects unlock and music priming
  synchronously before its first await. Music priming plays a 46-byte silent
  WAV on that same element, then clears it. No CD track plays while loading or
  in the launcher. A current, successfully initialized, nonfailed mission
  starts at 02. Priming success does not guarantee later browser permission.
- On an eligible active mission update, elapsed time strictly greater than
  5000 ms advances the last-poll timestamp, including during playing/blocked
  states. Only completed, unmuted runs restart at 02. The timestamp starts at
  zero and survives mission replacement; inactive updates do not change it.
  This is not a five-second wait measured from track 05 completion. It uses
  the web animation timestamp, not native 32-bit timeGetTime wrap semantics.
- The existing MUTE checkbox controls both sound effects and streamed music.
  A playing track continues silently when muted. Unmuting before its end
  restores that track. Muted starts and natural ends while muted block the
  sequence, including the final-track boundary. Unmute alone never retries a
  blocked sequence; the explicit music control starts a fresh 02 run.
  A completed run whose boundary was unmuted stays completed while muted and
  can recover on an eligible unmuted poll. These are safe web choices, not
  recovered native mute/volume semantics.
- Exit, replacement, retry, load cancellation, initialization failure, ready
  results, runtime mission diagnostics, and pagehide stop music and clear its
  source. The soundtrack is stopped before shared audio stopAll. Nonpersisted
  pagehide disposes both owners; persisted pagehide stops without terminal
  disposal. A restored page has no resumed mission/music intent.
- Abort/generation guards protect pending play and priming promises. Late
  completions cannot clear a newer source or restart a cancelled mission.
- Volume is 0.7 times 0.25, matching the current web master/cue defaults, not a
  native CD volume measurement. The media path shares mute through the main
  lifecycle owner, not through WebAudioManager's decoded voice pool. Device
  volume support and relative sound-effect/music loudness require listening.

## Orchestrator Browser Handoff

Use the existing Vite origin and the orchestrator-owned shared browser tab.
No new browser session/server was started by this task.

Selectors and observables:

- Deployment: `[data-campaign-faction="human"]` or
  `[data-campaign-faction="alien"]` (use the visible launcher control).
- Music element: `#mission-soundtrack`. Inspect `getAttribute("src")`,
  `currentSrc`, `paused`, `ended`, `muted`, `error`, and `currentTime`.
  It has no controls and stays hidden. There should be exactly one such
  element; the separate asset-browser `#media-audio` is not mission music.
- Explicit retry: `#mission-music-control`, accessible name
  `Play mission music`. It is next to MUTE and appears only for a blocked,
  unmuted active mission. Its `data-state` mirrors the scheduler on mission
  animation updates: idle/loading/playing/completed/blocked/disposed.
- Mute: `#mission-mute`; exit: `#exit-campaign`; results:
  `#mission-result`, `#mission-result-action`, `#mission-result-exit`.

Required checks still awaiting browser evidence:

1. Fresh launcher: no CD requests or audible music. Deploy with a real click;
   establish whether TRACK02 starts after mission initialization. If gesture
   priming does not authorize delayed playback, verify the explicit control
   appears and a real click on it starts TRACK02. A programmatic dispatch is
   not evidence of user-activation permission. Check the 26x18 control's fit
   beside MUTE at desktop/mobile mission scaling.
2. Verify audible 02 -> 03 -> 04 -> 05 and no per-track loop. For accelerated
   lifecycle checks, seek the actual element near its finite duration and
   allow a real ended event; dispatchEvent("ended") alone is intentionally
   ignored unless the element reports ended. Record real transitions and gaps
   separately from accelerated checks. End 05 and verify restart only on a
   subsequent eligible update. Exact threshold correctness is covered by the
   fake clock tests; throttled embedded rAF is not a native timing measurement.
3. Mute while playing: actual silence, no overlapping replacement; unmute
   before the boundary resumes audibility. Mute through a boundary, including
   05: blocked, source cleared, no poll restart. Unmute and click the explicit
   control: fresh 02. Start deployment muted: no priming/CD play; unmute still
   requires the explicit control.
4. Exercise pause(), network/media failure, and real autoplay rejection:
   blocked with no automatic retry after more than five seconds. Restore the
   condition, then use the explicit control. Verify failed/old requests cannot
   stop replacement playback.
5. Exercise mission exit, ready win/loss, retry/next-mission, mode switch,
   cancellation during delayed loading, unavailable mission, runtime
   diagnostic, and pagehide. Source must be removed and playback stopped;
   delayed work must not resurrect music in a launcher/result/replacement.
   Use existing orchestrator mission/outcome fixtures; no new gameplay hooks
   were added. Nonpersisted pagehide is terminal: reload before further tests.
6. Repeat replacements and retries: still one mission media element, no music
   PCM decoded through AudioContext, no increasing live sources/listeners, and
   no idle CD playback. Verify real-device silence/audibility and the shared
   mute on desktop and target mobile browsers, including codec support.

Hardware seek latency, continuous disc sector behavior, gapless Ogg handoff,
autoplay/device policy, focus/suspension behavior beyond observable pause, and
exact audible start time remain unverified. Waiting/stalled events have no
invented retry timeout. Do not mark all phases or native audio parity accepted
without the corresponding browser/device/native evidence.
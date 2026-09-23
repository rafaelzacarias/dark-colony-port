# Effect Audio Codec Accessibility

## Embedded Verification

Orchestrator follow-up decoded both exported candidates for all 259 source
effects through a real AudioContext: zero Opus decodes and 259 successful PCM
decodes. BEAT decodes only its available samples; no missing audio was recovered.
Real WebAudioManager selection, acknowledgment and weapon plays each fetched one
Ogg then one PCM fallback. Analyzer output was non-silent; the three decoded
buffers occupied 427,220 bytes. Replaying selection fetched nothing. stopAll and
dispose cleared voices/pending work and closed the probe context. This is signal
and lifecycle evidence, not physical-speaker or trusted-user-gesture certification.
The earlier handoff below records the implementation author's scope before this
orchestrator test, not a remaining claim that browser decoding is untested.

## Scope And Evidence

The embedded browser reportedly lacks an Opus decoder in its media FFmpeg library.
That does not establish whether its separate Web Audio `decodeAudioData` path can
decode Opus. Actual embedded Web Audio testing belongs to the orchestrator and was
not performed in this change. No browser, shared page, or full test suite was used.
This is a codec accessibility change, not evidence of native audio parity.

The generated index previously exposed only Ogg/Opus for all 259 source WAVs.
All 259 contain PCM format tag 1, using mono/stereo and 8/16-bit samples:

| Channels | Rate | Bits | Files |
| --- | --- | --- | --- |
| 2 | 22050 | 16 | 56 |
| 1 | 8000 | 8 | 4 |
| 1 | 22050 | 8 | 7 |
| 1 | 11025 | 8 | 189 |
| 1 | 10548 | 8 | 1 |
| 1 | 22050 | 16 | 1 |
| 2 | 44100 | 16 | 1 |

Publication on 2026-09-19 added 259 WAV output records: 13,008,816 bytes from
13,009,773 source bytes. 248 files are byte-for-byte originals. Ten malformed
containers were rewritten as minimal PCM WAVs without changing sample bytes:
ARTACK, BARR1SEL, CYWEA, GRAY3WEA, LENSDPLY, MORTDEA, REZIN, TEKDPLY, TINGLE,
WHALE (all under SOUND). Nine have missing padding before trailing metadata;
REZIN has an invalid trailing LIST length.

SOUND/BEAT.WAV is truncated: it declares 34,758 data bytes but contains only 192.
Its alternative preserves those available samples and fixes the header. It is
marked `conversion: "truncated-source-pcm"`, not represented as complete audio.
Other rewritten files use `rewrapped-pcm`; unchanged files use `original`.
The longest published effect is 5.555 seconds. The default 32 MiB decoded cache
budget remains unchanged; it is still enforced on actual decoded Float32 bytes.

## Runtime API

`resolveAudioCandidates(index: MediaAudioIndex, source: string, baseUrl?: string): readonly string[]`
returns at most two index-declared URLs: first `audio/ogg`, then `audio/wav`.
Default base: `/assets/generated/media/`. Relative output paths must not contain
traversal, absolute URLs, backslashes, query strings, or percent escapes.
WAV-only and Ogg-only entries both work. Missing exports never cause guessed URLs.
`resolveAudioAsset(...)` remains compatible and returns the first candidate.

`WebAudioManager.play(cue)` keeps its existing API. Decode rejection advances
once to the next exported candidate in the same shared pending load. Successful
fallback is cached under the primary URL, avoiding another failed Opus decode
while cached. There is no global codec blacklist or eager fallback prefetch.

Network, HTTP, response-body failures, cancellation and decoded-budget rejection
do not initiate fallback. `stopAll()`/`dispose()` invalidate the whole load and
prevent late decodes from starting fallback, filling cache, or playing. Per-cue
abort retains existing semantics: it suppresses that play without canceling a
shared load needed by other plays. Pending-load/play limits, priority, LRU cache,
gain, and unlock semantics are unchanged. No runtime request targets raw_cd.

## Bounded Publication

Run only after other exporters and reproduction tasks have finished:

```sh
node --import tsx tools/extractors/media/effect-wav.ts raw_cd/DC public/assets/generated/media
```

API: `publishEffectWavs(sourceDirectory: string, mediaDirectory: string)` returns
`{ count, sourceBytes, outputBytes, original, repaired }`. The CLI prints that JSON.
It processes only index-declared audio sources ending in `.wav`, at most 512
files / 32 MiB source bytes. All source sizes and SHA-256 values must match before
publication. Unsupported PCM layouts or compressed formats fail closed; this
corpus needs no FFmpeg. Rewrapping uses a parsed PCM format/data chunk, retains
sample rate/channel/bit depth, and never invents missing samples.

Files are content-addressed as `effect-pcm/<output-sha256>.wav` under generated
media. Source records/hashes remain intact, each output has its own size/hash and
conversion provenance, and `outputBytes` is recomputed. Video/CDDA/Ogg records
and media bytes are not reencoded. All validation precedes output writes. Existing
content-addressed files must match; the index is replaced by atomic rename only
after the outputs exist. The original index is rechecked before rename.

The index check is not a cross-exporter lock. Do not run concurrent exporters.
A failed publication can leave unreferenced content-addressed WAVs, never a
partially rewritten index. Reruns are deterministic and idempotent. The main
media exporter is intentionally unchanged and replaces its directory: reproduction
must run this command afterwards, before comparing/deploying generated artifacts.

## Browser Probe Handoff

In the existing embedded page, reload the generated media index without cache.
Do not infer Web Audio capability from `canPlayType`, video playback, or the
FFmpeg diagnostic alone. Sequentially decode both candidates for all 259 WAV
sources using a real AudioContext and freshly fetched ArrayBuffers. Record source,
URL, HTTP status, success/error name/message, channels, frames, sample rate,
duration and decoded bytes (`length * numberOfChannels * 4`). Release each buffer
before the next source and close the probe context. Web Audio may resample to the
context rate; compare duration/channels, not exact source frame count.

Minimal one-source probe, executable from the app origin:

```js
const { resolveAudioCandidates } = await import('/src/audio/cues.ts');
const index = await fetch('/assets/generated/media/index.json', { cache: 'no-store' }).then(response => response.json());
const context = new AudioContext();
const results = [];
for (const url of resolveAudioCandidates(index, 'SOUND/TRP1SEL.WAV')) {
  const response = await fetch(url, { cache: 'no-store' });
  try {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const decoded = await context.decodeAudioData(await response.arrayBuffer());
    results.push({ url, status: response.status, duration: decoded.duration,
      channels: decoded.numberOfChannels, frames: decoded.length,
      sampleRate: decoded.sampleRate, bytes: decoded.length * decoded.numberOfChannels * 4 });
  } catch (error) {
    results.push({ url, status: response.status, error: `${error.name}: ${error.message}` });
  }
}
await context.close();
console.table(results);
```

After a trusted gesture, verify `WebAudioManager.unlock()` and play selection,
acknowledgment, and weapon cues. If Opus succeeds, only Ogg should be requested.
If it fails, exactly one WAV should follow and subsequent cached plays should
fetch neither. To force the branch on an Opus-capable context, inject a
`contextFactory` whose `decodeAudioData` rejects only OggS buffers with
`EncodingError` and delegates WAVs to the bound real decoder. Do not globally
patch AudioContext. Check abort/stop during each attempt, muted/locked playback,
and unchanged default budgets. Include BEAT and the ten repaired files in direct
decode probes. Report decoded accessibility separately from audible verification.

## Automated Checks

```sh
node --import tsx --test tools/qa/audio.test.ts tools/extractors/media/effect-wav.test.ts
npm run typecheck
```

Tests verify every actual original/alternative hash and PCM payload, unchanged
Ogg hashes/signatures and non-effect records, deterministic publication, source
integrity failure, candidate ordering/path safety, real encoded bytes under fake
codec rejection, shared-load caching, budgets, retry exhaustion, cancellation,
and no fallback on fetch/body/HTTP failure. Browser decoder support remains an
explicit outstanding orchestrator check.
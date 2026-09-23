# ALIEN01 Repair, 2026-09-21

## Status And Scope

The user-facing ALIEN01 startup failure is fixed in the current default browser
guard model. This is not original native scheduler/AI/combat parity or campaign
completion. The requested work window is 18:13-20:13 PDT. Final affected checks completed
by 19:46 PDT, with the repaired Alien mission left ready in the shared browser.

Phases 1-2 retain their previously accepted, pinned scope. Phases 3-5 remain
partial and not accepted. Original ALIEN02 admission and its shared native
scheduling/resource/production/combat gates remain blocked; repairing ALIEN01
does not promise ALIEN02 within this two-hour window. Earlier reports are
preserved as historical evidence, not rewritten as new acceptance.

## Root Cause And Recovery

[MissionView](../src/mission-view.ts#L100) now resolves
`missionAnimationArchives("SAUC")` to `["SAWS", "SAUC"]`. Carrier `MIDDLE` is
owned by SAUC; loading only SAWS caused the fatal opening at tick 16. Science
`SAUCSTAND` still resolves through SAWS, and MINDHIV/SAUC2 behavior is preserved.
Six regression cases use actual hashed assets, rather than invented FIN states.

The default original ALIEN01 delivers four type-8 GRAY units and the type-73
commander, all at full 800 HP, by tick 107. Main's browser evidence reaches
tick 220 with rendering and no error, including a fresh mobile Retry. Public
Move/Stop coverage moves all five. Complete browser outcomes are recorded below.

[Main UI recovery](../src/main.ts) keeps Continue enabled for the existing Human
save after failure, offers Retry/Missions, and makes runtime errors visible even
when objectives/results had been hidden. The runtime guard performs stop/audio
cleanup once, without an `audio.load()` or permission-retry loop over 120 updates.
The modifier guard ignores Ctrl/Meta/Alt mission shortcuts after intentional
Ctrl/Cmd+A and Escape handling; plain controls remain unchanged. Final isolated
main coverage is 18/18, including parent-container resize observation. Earlier
ten/fourteen UI and fifteen audio checks overlap and are not additive totals.

## Browser Input And Save Safety

Main reports trusted Playwright M-key and pointerdown events with
`isTrusted: true` reaching the actual main handler. All five selected units move
over the next 100 updates, ticks 346 to 446. This is positive real-input delivery
evidence for this path; the older round-13 synthetic-only finding remains
historical, not a blanket current limitation. It does not certify every device
or the separate opt-in native command pipeline.

The browser's in-memory checkpoint at tick 340 restores exactly after real-Canvas
initialization of the restored view. Real Ctrl+S, Meta+S and Alt+M keyboard input
issues zero Stop commands and leaves the mode at context; plain S issues one
Stop and plain M enters move mode. No Save action or IndexedDB write was made by
the browser tests; all saves remain untouched and Continue retains the existing
Human save. Browser
measurements over 120 deterministic CPU updates were 26.3 ms median, 38 ms p95,
and 49.9 ms maximum. These are not rAF FPS, sustained pacing or GPU measurements.

## Mobile Recovery

Main reports a fresh loss at viewport 390x844 with shell bounds left 0, right
390, top 275.75, bottom 568.25. The result panel spans x 20.71875..291.28125 and
y 297.6875..485.2417, inside the shell and viewport. Initially the viewport tool
changed dimensions without a window resize event, leaving desktop shell bounds
outside the viewport. Main added a parent `ResizeObserver`, retaining window
resize support; the final 18/18 checks cover both paths.

On the fresh mobile result, locator-click stability timed out in the hidden page;
a coordinate mouse click at the Retry action's center delivered a trusted event.
Retry started fresh ALIEN01, reaching tick 220 with five units, no diagnostic and
a fitted shell. This is mouse-input recovery at mobile dimensions, not touch or
sustained mobile-performance certification. Main supplied
`/tmp/dc-alien-mobile-final-20260921.png`. Main inspected it: the embedded
compositor retained a stale scale despite the correct current DOM bounds.
Mobile fit is therefore geometry/input evidence, not fresh screenshot proof.

## Render Cost

The [construction-visual lookup repair](default-al01-mission-view-performance-20260921.md)
returns early when construction is unconfigured, eliminating repeated full-state
clones from default rendering. Configured construction validation remains intact.
In the real-asset software Canvas call fixture, over 120 updates:

| Work | Before p50 / p95 (ms) | After p50 / p95 (ms) |
| --- | ---: | ---: |
| Update including render | 35.13 / 47.52 | 22.33 / 26.29 |
| Render within update | 17.57 / 30.25 | 4.52 / 4.93 |

Select All fell from 52.61 to 5.51 ms in the single recorded sample. State hashes
and draw counts are unchanged. This fixture records drawing calls, not pixels;
its timings exclude main's DOM/radar work and do not establish browser FPS.

## Effects Evidence

The [mode5 layer-1 extension](phase4-mode5-effect-20260919.md#source-layer-1-extension-2026-09-21)
uses actual VENT/GLIT and CENT/GLAT source effects across four palettes. Its native
matrix has 320 exact normal framebuffers, including 96 layer-1 frames, plus
32 mirrored rejection controls. Source-mode 66/66 and legacy-mode 37/37 focused
checks passed separately. Unsupported mirror/elevation cases remain closed;
this is not full-scene ordering or visual parity.

The [CENT indexed-source warning investigation](alien-glat-mode5-binding-20260921.md)
did not reproduce the reported metadata warning with fresh real assets. Its
94 combined, one CENT-source and two opening checks total 97 focused passes.
No speculative runtime fix was made for that warning. Fresh initialization
does not explain or disprove the earlier live warning. Global scene-order and
unsupported-effect warnings remain; a null mission diagnostic does not certify
global visual parity or absence of every warning.

## Original Mission Outcomes

The [initialized Node playthrough](alien-initialized-playthrough-20260921.md)
retains the complete original nine-block TRO, source actors/stats and legal public
commands, with no actor, HP, credits or visibility injection. It reaches ready
win at tick 6945 and loss at tick 2465, restoring at tick 1000 and continuing.
Real assets and FIN composition execute, but Canvas/image operations are stubbed
and later rendering is sampled. This is source-aware API strategy, not a
human-information-only player or browser pixel proof.

The [browser runner](alien-playthrough-browser-20260921.md) shares the public
strategy through [source-playthrough-strategy.ts](../tools/qa/fixtures/source-playthrough-strategy.ts)
and [alien-playthrough-browser.ts](../tools/qa/fixtures/alien-playthrough-browser.ts).
Main now reports both completed runs on the actual main-loader default original
ALIEN01 view, with real rendering on every tick and public-API controlled time:

| Browser result | Ready tick | Shots | Deaths | Commands | Outcome / reason | Diagnostic |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Win | 6945 | 785 | 45 | 88 | 0 / 1 | null |
| Loss | 2465 | 267 | 1 | 10 | 1 / 2 | null |

The browser harness temporarily wrapped the app update for exclusive clock
ownership and restored that wrapper after each run. This is test-only clock
control, with no actor, damage or funds injection and no sampled rendering. The
source-aware planner is API automation, not manual play, native-game parity or
real-time pacing proof. Separate Node call-fixture outcomes and restoration are
supporting evidence, not the source of these real-browser claims.

## Existing Validation

This documentation-only handoff reads existing evidence; it launches no agents,
browser, tests or full suite.

- `/tmp/dc-alien-fix-full-20260921.log`: completed full check, **2,803 tests,
  2,799 passed, zero failed, four skipped**. Typecheck/build passed. JavaScript
  652.99 kB / gzip 204.69 kB; build 4.15 s; over-500-kB warning retained.
- That full run represents an earlier state; later modifier/observer changes
  have isolated evidence below, not a new full-suite certification.
- `/tmp/dc-alien-final-focused-20260921.log`: footer now confirmed,
  **112 tests, 112 passed, zero failed, zero skipped**. The two long-playthrough
  cases explicitly assert the existing recorded traces, not fresh executions.
  This count is separate from, and never added to, the full-suite count.
- `/tmp/dc-alien-main-final-20260921.log`: **18 tests, 18 passed, zero failed,
  zero skipped**, covering final main recovery, modifiers and resize behavior.
  Main separately reports final strict TypeScript and build passing: JavaScript
  **653.14 kB / gzip 204.76 kB**, **4.42 s**, with the over-500-kB warning retained.
  The 18-test log confirms tests; those final build figures are main's handoff,
  not the earlier full-run bundle figures or an additional suite total.

The settled affected run `/tmp/dc-alien-settled-final-20260921.log` passed
**118 tests, zero failures and zero skips**, including fresh complete win/loss
executions. This is a focused run, not another full-suite total.

## Final Handoff

Main restored the original prototype update and instance Stop methods, removed
temporary listeners and all `__alien*` test globals, and restored viewport1440.
The fresh ALIEN01 view remained at tick228 with five selected units and no
diagnostic; normal clock ownership was restored. Save preservation is
confirmed separately above. ALIEN01 is repaired within the default browser guard
path; ALIEN02 remains closed and the earlier all-phase goal remains unmet.

Next bounded source step: isolate one still-rejected mirrored CENT/GLAT mode5
layer-1 case, capture the original native destination writes/framebuffer, and
compare the same indexed source and palette in the adapter. Keep rejection until
that case matches, including clipping and restore invariance; this is a practical
effect-admission step, not permission to suppress global warnings or open ALIEN02.
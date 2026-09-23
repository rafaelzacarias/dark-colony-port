# Default AL01 MissionView CPU Performance

## Scope

Only MissionView's construction-visual lookup changed. No shared session,
native scheduler/combat, main UI, package, asset, browser, or simulation-rate
changes. Default AL01 has no native combat or bounded-harvest owner. This is
not a bounded native-profile benchmark.

The QA harness loads actual default AL01 through `loadCampaignMission`,
initializes MissionView with real generated JSON, binary data and PNG headers,
then runs normal `update` calls at 50 ms intervals. All startup renders are
enabled. At tick 220, the source has delivered five player units. Select All
and a public Move command queue the group toward a reachable point eight path
cells toward source tag 4. Measure all 120 updates, ticks 221 through 340,
including every render; no direct simulation stepping, hidden actors,
disabled effects, reduced tick rate, or skipped AI.

There are 52 simulation entities including static targets at tick 220. The
report also separates mobile units from static targets. There are 111 fetched
asset URLs and 21 loaded PNGs, including the corrected SAUC archive binding.

## Finding And Fix

`constructionVisuals` cloned two CampaignSession snapshots and a transport
state before discovering that default AL01 had no configured construction
hosts. Render queried it once for auxiliaries and again per scene-bound sprite.
The repeated work also affected synchronous selection renders.

The getter now returns immediately when construction has no configured owner.
Configured construction uses one current snapshot and retains the registered
actor/type/team/health/position/height validation. There is no persistent cache,
dynamic-type classification, visibility memoization, or actor admission change.

## Measurements

Same Node process shape, real asset fixture, getter timers and V8 CPU sampling
enabled in both runs. Milliseconds; p50/p95 across 120 actual updates:

| Work | Before p50 / p95 | After p50 / p95 |
| --- | ---: | ---: |
| Update including render | 35.13 / 47.52 | 22.33 / 26.29 |
| Update excluding render | 17.59 / 21.67 | 17.79 / 21.74 |
| Render within update | 17.57 / 30.25 | 4.52 / 4.93 |

Select All, one sample at tick 220 including synchronous render, fell from
52.61 to 5.51 ms. Public Move enqueue was 4.86 vs 4.75 ms. Initialization was
87.39 vs 81.14 ms; these one-off figures are not percentile measurements.

Across the measured 120 frames:

- Construction getter: 241 calls, 1613.05 ms before versus 0.22 ms after.
- Session snapshot reads: 722 -> 240 (one update read and one render read per frame).
- Separate stationary render at tick 340: nine -> one session snapshot reads.
- Simulation snapshot reads: 1200 in both runs, 8.93 vs 8.60 ms total. These
  small copies are not the identified cost; standalone render already reads one.
- Session journal reads: zero. No render-time history query was observed.
- Unit-change callbacks: exactly 120. No callback was suppressed or deferred.
- Palette sprite draw calls: identical 524, including the final standalone render.
- Simulation/campaign/selection/exploration hash identical before and after:
  `fd1b71694fa374f628c14b4af2e65f52dbd81a27c7d620eb1987d91e01509544`.

CPU sampling attributed the dominant old work to session snapshots and
`structuredClone`, consistent with the getter timers. Counters are inclusive,
so nested getter times must not be summed as independent costs.

## Browser Handoff

This uses the existing software canvas **call fixture**, not a rasterizer.
It loads real assets and runs actual render control flow, palette generation,
FIN sampling and composition calls, but image drawing itself is recorded.
WebGL2 is unavailable, so terrain explicitly uses RGBA fallback. No pixel,
GPU, indexed terrain, per-sprite `createMissionSceneFrame`, native shadow
readback, or browser FPS claim follows from these timings. Mode3 remains an
explicit separate API; the benchmark asserts it is not called by normal updates.

As a CPU-budget inference only, 20 updates/s plus 60 renders/s using these
medians changes from about 1406 to 627 ms of work per second, before browser
and UI costs. The measured tick+render still takes 22.33 ms at p50; this is
not proof of smooth 60 FPS. Real browser visibility, shadow/readback counts,
scene-frame creation, cache behavior, and frame pacing remain unverified.

Callbacks in this harness only count calls, so main's DOM/radar work is excluded.
Main still receives one `onUnitsChanged` per advancing update and synchronous
selection callbacks. Commander/type-8 selection, upgrade UI, radar and archive
rebuild costs belong to the main UI owner; they were not edited or timed here.
The remaining roughly 18 ms update cost and roughly 4.4 ms resource-source
render lookup are reported, not bypassed or moved into native scheduling work.

## Verification

```sh
node --import tsx tools/qa/mission-view-default.perf.ts --profile
node --import tsx --test tools/qa/mission-view-default.test.ts
```

The focused tests require actual five-unit delivery, legal movement, all 120
ticks/renders/callbacks, unchanged final state and draw count, bounded snapshot
reads, plus live configured construction actors, detached output and rejection
of inconsistent actor health. No wall-clock thresholds are used in tests.

Evidence logs: `/tmp/dc-default-al01-before-20260921-p02.log`,
`/tmp/dc-default-al01-after-20260921-p03.log`,
`/tmp/dc-default-al01-regression-20260921-p05.log` (2 passing), and
`/tmp/dc-default-al01-types-20260921-p07.log` (scoped strict/noUnused clean).
No browser, full suite, subagents, package or asset changes were used.
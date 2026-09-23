# Adapted Frame Performance

Runtime scope: `src/engine/campaign-session.ts` and `src/mission-view.ts` only.
No AI policy, active-team selection, combat, pickup rules, assets or packages changed by this work.

## Changes

- Cache deeply frozen, detached TRO/AI projections by committed session state.
- Compute production visits through the existing census/cap guards with a slots/registry-only transport input.
- Publish a distinct `BrowserViewFrame`: controller bail/statistics, detached world, one shared detached presentation transport, and current entry. It is not a checkpoint or an operational transport snapshot.
- The frame omits production and replay history. Its transport carries slots, registry, generations, carriers and coordinate FIFOs, not historical requests or collision/configuration planes. Source entity bytes remain available for harvester identity checks.
- Keep full `snapshot`, `browserViewSnapshot`, journal and checkpoint APIs unchanged. Public presentation arrays remain detached and mutable; cached TRO/AI arrays remain deeply frozen.
- Retain append-only transport/production request prefixes outside adapted transaction clones, then reattach them atomically before publication. Preserve full production journals and duplicate-ID guards. Native paths retain full cloning.
- HUD callbacks use a detached resource/credits/statistics/production projection without request/journal history. Empty native-resource publication does not clone transport.

## Measurement

Fresh HUMAN02 source mission, real `MissionView.update`, null canvas, 5,005 consecutive ticks. No injected counters, statistics, raw-world edits or synthetic historical arrays. Only existing AI/guards operate; no player purchase strategy or initialized renderer. This is not a battle/playthrough completion proof.

Each point has five uninstrumented timing frames immediately before the indicated tick, then five instrumented frames beginning at that tick. Bytes are the sum of V8 serialized `structuredClone` inputs, not heap/RSS or checkpoint size. With five samples, p95 is the sample maximum.

Baseline was reconstructed in an isolated temporary source copy by reversing only this work's runtime changes. No shared workspace files were reverted. Both runs use the same harness. Historical M02 rerun timings were not used.

| Tick | Baseline p50 / p95 ms | Optimized p50 / p95 ms | Baseline clone bytes p50 | Optimized clone bytes p50 |
| --- | --- | --- | --- | --- |
| 1,000 | 28.085 / 28.800 | 15.177 / 15.417 | 2,973,210 | 1,617,703 |
| 2,000 | 28.044 / 28.260 | 15.089 / 15.305 | 2,974,129 | 1,617,095 |
| 5,000 | 28.024 / 28.778 | 15.221 / 16.005 | 3,014,728 | 1,639,360 |

At 2,000: p50 -46.19%, p95 -45.84%, cloned bytes -45.63%.
At 5,000: p50 -45.69%, p95 -44.38%, cloned bytes -45.62%.
Optimized 1,000 to 5,000 growth: p50 +0.29%, p95 +3.81%, cloned bytes +1.34%.
Total wall time: 144.57 s baseline, 78.45 s optimized (-45.74%).

Artifacts: `/tmp/dc-perf-baseline-r2.{json,log,exit.json}` and `/tmp/dc-perf-optimized-r2.{json,log,exit.json}`. Intermediate first-run artifacts are not the final comparison.

Run with:

```sh
DC_FRAME_PERF=/tmp/adapted-frame-report.json node --import tsx --test --test-name-pattern='^adapted frame performance:' tools/qa/adapted-frame-performance.test.ts
```

## Checks And Limits

- New projection controls: detached source/transport mutation, immutable cache, fork isolation, failed-frame rollback, JSON restore and subsequent full-step/view-step equivalence pass.
- Six fast browser-profile controls pass; four existing session-sharing controls pass.
- Five TRO view controls pass. Human and alien real earned-purchase/mid-period restore/late-failure/no-double-credit controls pass after request separation.
- Scoped strict TypeScript check passes.
- An additional ALIEN strategy test failed its assertion that an actor issued an order at or after tick 1136 (`mission-browser-campaign.test.ts`, assertion near line 394). It did pass selector activation and team decision assertions. [Subsequent source diagnosis](ai-post1136-20260922.md) reproduced an order issued against pre-advance tick 1135 during activation frame 1136; the actor then moved on that retained order. Stronger activation-order/movement/deduplication tests pass without a policy change. No baseline performance attribution is claimed.
- Request prefixes and replay inputs still retain complete history and shallow-copy their pointer arrays at commit. Production journals still grow with meaningful events and are scanned/cloned by the existing reducer for deduplication. This change does not claim constant total memory or eliminate every asymptotic cost.
- The measured fixture makes no purchases; purchase correctness is covered separately, not late paid-production throughput. No full mission, browser, full suite or new package/asset work was used for the performance measurement.
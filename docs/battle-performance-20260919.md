# Phase 5: Bounded Battle Performance and Retention

Measured 2026-09-19, Node v24.7.0, macOS arm64, Apple M4 Pro, 14 logical CPUs.
Harness: [tools/qa/battle-benchmark.ts](../tools/qa/battle-benchmark.ts).
Only this report and the new harness were edited. No gameplay edits, browser, additional agents, full suite, or development-server changes were used.

## Practical Gate

The measured CPU-side workload **passes p95 wall latency <=20 ms and p99 <=50 ms** for all five cases. These are declared benchmark gates, not proof of render FPS or native parity. A strict **every update <=20 ms fails** for 512 synthetic units and both source missions. Both source missions also fail a strict every-update <=50 ms gate. No result is silently averaged into a pass.

**Original-run retention finding:** the live campaign journal grew by one entry per update without eviction. The subsequent [session retention addendum](session-retention.md) fixes that per-frame diagnostic growth and measures 10,000 source frames. All-memory long-session boundedness is still not established.

## Reproduce

From the workspace root, run one-shot, synchronous commands:

```sh
node --expose-gc --import tsx tools/qa/battle-benchmark.ts --self-check
node --expose-gc --import tsx tools/qa/battle-benchmark.ts > "/tmp/darkcolony-battle-$(date +%Y%m%d-%H%M%S)-$$.jsonl" 2>&1
```

Default source mode is **required**: missing generated source assets fail, never silently fall back to generic values. `--source=skip` explicitly requests synthetic-only coverage. `--mission-ticks=2400` extends each source mission to 120 simulated seconds; **this report used the permitted bounded 1,000-update / 50-second source runs**, not 120 seconds. `--self-check` only runs the small synthetic replay check.

Completed evidence: `/tmp/darkcolony-battle-isolated-1789817059390-33307.jsonl`, timestamp `2026-09-19T11:24:19.521Z`, revision `phase5-battle-v1`, exit 0 and terminal JSON record `{"kind":"complete","passed":true}`. Temporary logs are local artifacts, not durable repository files; essential results are reproduced below. The completion flag means assertions/completion succeeded, not that every performance or retention gate passed.

Two preliminary full-run attempts were interrupted by unrelated shared-terminal Ctrl-C and are excluded. The completed run used a synchronous Node launcher that waited for an interrupt-isolated, finite child, with stdout/stderr in the unique log. Other work was active on this machine: these are practical observations under contention, not isolated-machine microbenchmarks. No sleep or polling loop was used. The developer server was not contacted or reconfigured; shared CPU contention cannot be ruled out.

## Workload and Measurement

- Seed is exactly `0xdc1997` / `14424471`. Synthetic sizes are **total armed units**, split 64/64, 128/128, and 256/256 between human/team 0 and alien/team 1. These are not per-faction totals of 128/256/512.
- All sizes use the same `128 x 64` NavigationGrid, 256 blocked cells, four-neighbor shared navigation and real simulation pathfinding/reservation code. Pair index `i` has origin `(8*(i%16), 4*floor(i/16))`; obstacle offset `(3,1)`, initial human `(1,1)`, alien `(6,1)`. All 256 obstacles exist at every size. Grid-cost SHA-256 is `9ce6f84ec9605ef0b3099b5b812253eeb96d7615764f4991d7ac74fb06699dae`.
- Synthetic values are deliberately **generic**, not legacy balance: health 1,000,000,000; movement 256 subcells/update; damage 1; range 3 cells; cooldown 5 ticks. High health sustains both sides for the whole run; death/removal throughput is not covered. One shared grid is used, but short local pair routes are not a congested cross-map army test.
- At each 200-tick boundary, every unit receives a move order: human alternates local x=4/1 at y=1; alien stays x=6 and alternates y=2/1. At offset 60, both units attack their counterpart. Obstacles force detours. All sizes execute exactly 2,400 updates = 120 simulated seconds at 20 TPS. The 16-unit replay fixture runs twice for 400 updates before measurement, warming some engine paths; there is no discarded per-case warmup.
- Synthetic measured blocks include order submission, `advance()`, two fresh snapshot reads, event reads, engagement bookkeeping and tick assertions. Snapshot/event history is not retained. Movement count means a unit's subcell position changed between samples, not an emitted movement event; shots/deaths are actual event counts.
- Real HUMAN01 and ALIEN01 cases use the actual MissionView constructor, extracted scenario, triggers, messages, briefing, units, weapons, damage matrix, desert terrain metadata and map navigation/tag buffers. The harness disables only rendering, supplies inert canvas/stage/callbacks, does not initialize visual/audio assets, and calls `update(tick*50)` directly after `update(0)`. No rAF is involved. Every 100 ticks it queues deterministic free-neighbor moves for delivered owned units through the simulation API. This bypasses pointer input and is not UI/native-input coverage.
- Source scenario values and placements are not rescaled or replaced. No opt-in production/resource host configuration is injected beyond what the current MissionView constructor enables. Source mission coverage is therefore the current constructor's runtime scope, not every optional campaign subsystem. Both missions remained unfinished with no diagnostic and advanced every requested tick. Source shots were **zero**; these are moving source-session measurements, not source battle certification.
- Per-update wall latency uses `performance.now()`. CPU samples use process user+system CPU deltas, in milliseconds; V8 worker threads can make CPU time exceed wall time. Percentiles are nearest-rank. Measurement overhead is included, and all ticks, including command bursts and quiet cooldown ticks, are included.
- Loop wall elapsed includes the midpoint heap/checkpoint/journal probe, but excludes construction and final evidence serialization/teardown. `wholeCaseWallMs` in the raw log includes those additional costs. GC/checkpoint/journal probes are outside per-update timings. Timing arrays and scalar/set/map engagement counters are bounded by the case length/entity count; there is no array of accumulated snapshots or journal copies.

## Timing Results

Milliseconds per update; elapsed is seconds for the whole measured update loop.

| Case | Updates | Wall p50 | Wall p95 | Wall p99 | Wall max | Loop elapsed | >20 ms | >50 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Synthetic 128 | 2400 | 0.183 | 0.582 | 1.558 | 7.854 | 0.627 | 0 | 0 |
| Synthetic 256 | 2400 | 0.324 | 1.348 | 3.845 | 18.488 | 1.318 | 0 | 0 |
| Synthetic 512 | 2400 | 0.635 | 4.534 | 10.784 | 47.845 | 3.411 | 12 | 0 |
| HUMAN01 | 1000 | 11.554 | 14.877 | 15.863 | 51.351 | 11.884 | 1 | 1 |
| ALIEN01 | 1000 | 11.692 | 14.256 | 15.239 | 52.409 | 11.926 | 2 | 1 |

| Case | CPU p50 | CPU p95 | CPU p99 | CPU max |
| --- | ---: | ---: | ---: | ---: |
| Synthetic 128 | 0.184 | 0.774 | 3.418 | 13.523 |
| Synthetic 256 | 0.324 | 2.110 | 5.768 | 35.895 |
| Synthetic 512 | 0.635 | 5.081 | 11.653 | 66.776 |
| HUMAN01 | 11.609 | 15.517 | 18.023 | 52.145 |
| ALIEN01 | 11.693 | 14.825 | 18.308 | 54.830 |

The source-session path costs substantially more than the generic engine loop even with only 35/37 final mobile units. These are separate workloads and must not be extrapolated into a claim that a 512-unit source MissionView meets budget.

## Engagement and Determinism

| Case | Moved units | Fired units | Position-change count | Shot events | Last-quarter shots | Active updates |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Synthetic 128 | 128 | 128 | 23040 | 42240 | 10496 | 586 |
| Synthetic 256 | 256 | 256 | 46080 | 84480 | 20992 | 586 |
| Synthetic 512 | 512 | 512 | 92160 | 168960 | 41984 | 586 |
| HUMAN01 | 6 | 0 | 1399 | 0 | not asserted | 984 |
| ALIEN01 | 5 | 0 | 422 | 0 | not asserted | 100 |

Each synthetic side fired exactly half the total shots. Human/alien position changes were 16384/6656, 32768/13312 and 65536/26624. Each synthetic shot did 1 damage; all cases had zero death events. HUMAN01 movement split was 415 human / 984 alien; ALIEN01 was 0 human / 422 alien. Each source case issued 49 move commands. Source fixtures do not assert every faction/unit engages; their non-idle check is delivery plus meaningful movement. Synthetic fixtures assert **every** unit moves and fires, at least `10*unitCount` position changes and shots, and at least `unitCount` shots in the final quarter. Quiet ticks are expected from cooldowns and the explicit move/attack schedule.

The two 16-unit/400-tick self-check runs matched their full final checkpoint SHA-256 and event counts: 480 position changes, 880 shots, all 16 units moved/fired, hash `a6b9cb3c31603c4bfda9eaedb33c1233d85edeb28c8f4adbf62504f4a665588e`. This is the repeated deterministic test; large/source cases were measured once, not falsely presented as two-run determinism proofs.

| Case | Final checkpoint SHA-256 |
| --- | --- |
| Synthetic 128 | `39bf7a50bda30d176d7467ac2fae7be68c85d5b7bf1a18a13dff1eb17b7af750` |
| Synthetic 256 | `41b09a45f8092f5749644fc68e31f940cec8735a4f780d4b54cb42b5fa9be42d` |
| Synthetic 512 | `99576400e2f5bf966e53b22a09d03eef21b64b4c27714987d879730f0e9ccded` |
| HUMAN01 simulation | `1b2761562c5775a1cb3f8fd676ba9b92c95dbda9f35ff386137a89659d4dc7d4` |
| ALIEN01 simulation | `49dac0d52e44a79f6215cd3e8721caaf7fcd4fd04732debf7cbc5ff65de6b913` |

Each consumed source file's SHA-256 is in the JSONL log, including binary map buffers. Ordered source-manifest hashes are HUMAN01 `d1d1a34872e709ded11d992545ce9e041c5663caa431819b950abe7aecaa050c` and ALIEN01 `fc85d81fb468c3364cc7af2804b98b59e54e576dfc854ac48b906b668fe2e710`. Shared unit/weapon/damage-matrix file hashes are respectively `547dc37143a8b889ca6bf963043da6f9afc2fb1b065fb965ef4a28ffd277a794`, `8ae4aa9b507b573e19909e28476c7d8530790f12c12ee53cf26e07152898c57a`, and `2b733d29c16761af049a4a7272d2162d02829dc39598bed051e31b6d1fb7b9f6`.

## Retention

All numbers below are **heapUsed bytes after explicit GC**, not averages, RSS, external ArrayBuffer bytes, GPU memory or peak transient allocation. Samples occur at start/mid/end. The outer before/after measurements bracket a function scope, so simulation/view/source objects are no longer returned or held by the harness; only compact result records survive. JIT/module caches and earlier case results remain process-global, so after-scope deltas are not automatically leaks. Negative deltas are possible.

| Case | Before case | Live start | Live midpoint | Live end | After scope GC | After-minus-before |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Synthetic 128 | 9695200 | 9760200 | 10021000 | 10062992 | 9846448 | +151248 |
| Synthetic 256 | 9734272 | 9850928 | 10079240 | 10135528 | 9846480 | +112208 |
| Synthetic 512 | 9733824 | 10003128 | 9136248 | 9151032 | 8691520 | -1042304 |
| HUMAN01 | 8592216 | 9965520 | 11917416 | 12206368 | 10136800 | +1544584 |
| ALIEN01 | 9876104 | 10779352 | 11597656 | 11796664 | 10079576 | +203472 |

HUMAN01 heap after `dispose()` **while still referenced** was 12186224 bytes; ALIEN01 was 11782648. Disposal releases renderer resources, not the session object graph. Dropping the owning view is required for collection. These finite samples do not prove a general leak-free application teardown.

All sampled command queues were empty. Synthetic reservation owners were 0 at start and exactly 128/256/512 at midpoint and end, with zero remaining path points at the latter probes. They are retained destinations, not an ever-growing queue. HUMAN01 reservations/owners were 0 -> 41 -> 40, with 7 -> 6 remaining path points; ALIEN01 was 0 -> 42 -> 42 with 5 -> 5 remaining path points. Reservation ownership can include source static occupancy and exceed the mobile-unit count. No sampled source-damage diagnostics occurred.

Both source journals were **0 -> 500 -> 1000 entries**. The last entry was 136 bytes of JSON at midpoint and 137 bytes at end; this is **not** an estimate of total heap or total journal bytes. The harness reads/clones the public journal only at evidence boundaries and immediately reduces it to scalar counts, never accumulates journal snapshots. Heap changes include runtime state, warmup and bounded harness counters, so attributing every byte to the journal would be unjustified.

The root cause is explicit in [src/engine/campaign-session.ts](../src/engine/campaign-session.ts): `entries` is an array, every successful `step` appends a structured clone, and the journal getter clones the full history. Version-2 `checkpoint()` contains current state/options but not `entries`; restoring version 2 starts a new empty live journal. Saving in version 2 alone does not clear or cap the running journal. At 20 TPS this array adds 72,000 entries per simulated hour. The measured growth is linear, not evidence of exponential growth.

**Proposed fix, not implemented:** make normal runtime diagnostic history a configurable bounded ring buffer (or disabled recording), with total-entry/dropped-entry counters and a separately enabled streaming/full replay recorder for tooling that requires history. Preserve identity provenance and current host state independently; do not truncate gameplay-relevant state to cap a diagnostic log. Validate consumers of the journal/replay APIs, version-1 migration, version-2 continuation, outcome/death handling, and long-session post-GC plateaus before claiming the retention gate is closed. Expose cheap journal length/retention counters so diagnostics need not clone history.

## Verification and Remaining Gates

### Subsequent Journal Retention Fix

The unbounded `entries` implementation and proposed fix above describe the
original benchmark revision. The implemented ring now defaults to 4096 entries,
supports explicit `journalLimit: "all"`, and exposes cheap retention counters.
See [Live Session Diagnostic Retention](session-retention.md) for checkpoint
semantics, 20k idle/10k source evidence and residual event-growing collections.
These measurements do not replace the battle timing or whole-view heap gates.

Passed: two-run deterministic engagement self-check, all five finite workloads and their assertions, editor diagnostics for the harness, and a focused strict TypeScript no-emit check of the harness/import graph. The interrupted initial type-check is excluded; the completed check exited 0. No full suite was run.

Still unverified: 120-second source session duration, source-scale 128/256/512 combat, congested long-distance pathfinding, deaths/churn, opt-in campaign configurations, stable long-session heap, GPU rendering/composition, actual rAF pacing/FPS, browser allocation behavior, WebKit/iOS audio/rendering, native pointer/touch/keyboard input and native game fidelity. Passing these CPU percentile gates does not certify any of those surfaces.
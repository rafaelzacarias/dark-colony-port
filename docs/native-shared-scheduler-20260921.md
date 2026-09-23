# Native Shared Scheduler: Bounded Dispatch Contract

## Scope

New isolated files only:

- [Portable scheduler](../src/engine/legacy-native-scheduler.ts)
- [Native observer and instruction controls](../tools/qa/native-scheduler-native.py)
- [Focused comparisons](../tools/qa/legacy-native-scheduler.test.ts)
- [Natural full-policy composition](../tools/qa/legacy-native-scheduler-policy.test.ts)
- [Concrete bounded transaction host](../src/engine/native-scheduler-host.ts)
- [Native policy owner adapter](../src/engine/source-native-policy.ts)
- [Host native suffix observer](../tools/qa/native-scheduler-host-native.py)
- [Host policy tests](../tools/qa/native-scheduler-host.test.ts)
- [Host transaction tests](../tools/qa/native-scheduler-host-cycle.test.ts)

No existing runtime, admission gate, session, browser, assets, or package changes.
No agents, full suite, or real-time clock loop. The dispatch primitive explicitly reports
`source-authenticated-dispatch-only`, `admitted: false`, and
`executableWholeGame: false`. It does not remove existing owner exclusivity.
The new host executes the bounded post-projectile suffix described below, not
the complete plan. Its successful transactions also retain `admitted: false`
and `executableWholeGame: false`.

The primitive authenticates a private copy of DC.EXE against SHA-256
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`, reads
the PE sections, and extracts selector descriptors at `0x47936c`, the 256-word
shared random table at `0x478e04`, and the original binary64 selector constant
at `0x47380c`. Source and plan identities cannot be replaced by structural
copies. Mutable checkpoints must be re-derived with freshly authenticated bytes.

## Original Caller Order

The initial actor-first hypothesis was falsified by the first native cycle.
`0x41cb2c` consumes a clock-packet count. For EACH requested cycle,
`0x41cb4e` increments `game+0x94c`, then `0x41cb54` calls `0x4196f4`.
This is not a browser tick or an assumed 16/20/30 Hz clock.

| Order | Source | Consumer contract |
| --- | --- | --- |
| 1 | `0x419702..0x4197b4` | Rebuild full 8-team/110-type census and population from registry indices 152..799. |
| 2 | `0x4197b4..0x41981c` | Population-limit commander flags using the PREVIOUS population cap. |
| 3 | `0x41981c..0x419880` | Read explicit platform tick into timing ring; update source frame flags. |
| 4 | `0x419880` | If `0x52c == 0`: clear `0x4456f0`, compute `0x44a6d4`, dirty `0x439f40`, before clock increment and relation refresh. |
| 5 | `0x41989e..0x4198c3` | Increment `0x530` and `0x52c` independently. |
| 6 | `0x41e6ac`, `0x4198ce..0x419990` | Recompute population cap, alliance cache, and team visibility masks. |
| 7 | `0x419990..0x419a28` | Day rollover and transition calculation from actual SCN period/transition. |
| 8 | `0x44461c` | Add two to path-search stamp `0x47a980`. |
| 9 | `0x419a30` | If `(0x94c & 15) == 0`: clear, compute, dirty, in that order. |
| 10 | `0x419a4e` | If `(0x94c & 7) == 0`: publish day variables, `0x43feac`, original TRO `0x43e4d0`, then commander cleanup. |
| 11 | `0x419b31` | If `(0x94c & 15) == 0`: recurring colony income for teams with source base HP nonzero. |
| 12 | `0x419b7e..0x419bb8` | Reset selector-5 accounting and decrement team delay if greater than one. |
| 13 | `0x419bb8..0x419c0e` | Live inclusive registry loop; dispatch each registered value through `0x419248`; clear byte `+0x12` for an empty index. |
| 14 | `0x419c0e` | Whole projectile phase `0x44293c`. |
| 15 | `0x44ac28`, `0x419c2e..0x419cbc` | Record frame and conditionally emit native local-controller frame report. |
| 16 | `0x419cbc..0x419cd5` | Enable synchronous local packets with `0x42163c(1)`, run `0x41ac2c`, disable with `0x42163c(0)`. |
| 17 | `0x419cd5..0x419d3a` | Read explicit end tick, store elapsed and current period, advance 64-slot ring. |
| 18 | `0x419d40` | Every 32 packet counters: original timing feedback `0x419580`, including period/latency packets and population ceiling. |

`0x439f40` is NOT AI: it sets `0x4796a8 = 1` to dirty the visibility-dependent
display. `0x419580` is NOT the per-frame world entry: it computes periodic
feedback after the world work. Its period output does not retroactively change
the elapsed history or become a browser scheduling policy.

## Clock and RNG Bindings

- `0x94c`: clock-packet counter. Visibility cadence, TRO scan cadence, recurring
  colony income, AI round-robin, timing-feedback cadence, and CITY startup use it.
- `0x530`: SCN day/resource elapsed counter. Actor maintenance at `0x4192c0`
  and `0x4192f0` uses its low five/four bits. Resource task income at `0x4139d7`
  uses its low four bits; task `0x4140dc` uses its low two bits at `0x41410a`.
- `0x52c`: separate monotonically incremented TRO counter; also gates the first
  visibility pass. It is not the day/resource elapsed counter.
- `0x534`, `0x538`, `0x53c`, `0x540`: period, transition, phase, daylight.
  Rollover is strict `elapsed > period`, then elapsed becomes zero and phase
  becomes `1 - phase`. During `elapsed <= transition`, native signed division
  computes Q8 daylight; outside transition, previous daylight is retained.
- HUMAN02 initial day state is phase 0, period 6300, elapsed 5100, transition 75.
  The first actor cycle therefore sees resource clock 5101, packet counter 1.
  No `530 == 94c` normalization is valid.
- Global `0x478e00` task-6 budget is reset to zero before EVERY registry index,
  including empty indices, not merely once per world cycle. Nested task dispatch
  owns increments within one registered visit.
- Combat/policy random cursor is `0x479204`, preincremented modulo 256 by
  `0x411db4`. CRT random state is separate. Both flow through ordered phase
  receipts without reset. The scheduler itself does not consume random values
  except its explicitly requested selector operation.

`legacyNativeSchedulerConsumerInputs` makes the mapping explicit:
`actorFrame.counter` and `resourceFrame.nativePhaseCounter` come from `0x530`;
`cityVisit.counter` and `visibilityFrame.counter` come from `0x94c`.
Use the current RNG at EACH actor/selector handoff, not the world-entry RNG.
Current local team, cancellation gate, and refreshed visibility mask remain
required external world observations; they are not guessed by the scheduler.

## AI and Registry Decisions

`0x41ac2c` returns without selectors unless `(0x94c & 3) == 0`. At counter 4 it
visits all nonzero-mode teams in ascending order without advancing its stored
team cursor. On later eligible counters it increments that cursor modulo eight
FIRST and visits only that team if its mode is nonzero. The word at AI-state
offset zero is not updated by this routine.

`0x41ab20` calls each source weight callback, then consumes one random value
even when the returned weight is zero. Mode 3 has constant weight one and calls
`0x44be40`; mode 4 has zero weight and performs no action but still draws once.
The bounded pure selector rejects modes 1/2 and altered mode-3/4 weights.
Those other modes need consumers for their actual weight-callback effects.
The binary64 scale and 64-bit extended significand comparison are preserved;
no assumed fresh/random seed or browser selection heuristic is introduced.

Registered iteration is NOT a frozen sorted actor list. It reads current
`game+0x7d20` and signed registry words at `game+0x468ec` at each iteration.
Dispatch uses the registry VALUE, while empty-slot clearing uses its INDEX.
The native late ALIEN capture creates slot 207 during an earlier actor visit,
then dispatches slot 207 within the same cycle, at packet counter 1200.
The observer records registry
deltas at each actor return; tests replay them before requesting the next visit.
Fixed CITY slots expose `{team: floor(slot/15), index: slot%15}` for slots below
120; this identity is not permission to use a generic troop consumer.

## Required Handoff Contract

1. Authenticate the source once. Use `beginLegacyNativeSchedulerClockPacket`
   for a single original packet increment, or `planLegacyNativeSchedulerCycle`
   at an already-incremented `0x4196f4` boundary. Never do both increments.
2. Require a named consumer for EVERY emitted phase, an explicit registered
   type set, an explicit AI mode set, and synchronous actor/unit/CITY receipt
   consumers. Absence rejects. A string identifies a consumer; it is NOT proof
   that its implementation covers the source behavior.
3. Stage the entire world outside this pure module. Supply current world state
   at each phase, not a precomputed world-entry snapshot. Census, cap, relations,
   troop/resource/CITY dispatch, visibility, TRO, income, production allocation,
   projectiles, frame report, transport, FIN, and sound each remain their owners'
   responsibility. There is no unknown-phase skip or no-op fallback.
4. In the registered phase, request one index at a time using the CURRENT
   registry/high-water/types. Execute its owner, update all shared state and RNG,
   then request the next index. Reject unsupported types even if currently idle.
5. At AI phase entry derive selectors from CURRENT team modes. Mode-3 weight
   selection precedes the whole policy. Its command receipts execute synchronously
   inside `0x421725 -> 0x41defc`, including `0x41c7f8` units and `0x41c8d4` CITY
   when emitted. Do not move paid production after the AI-local bracket or debit
   it twice. Newly registered actors are subject to the caller's next live loop.
6. Complete each phase with matching sequence/kind/consumer, exact before/after
   clocks, and continuous combat/CRT RNG. Missing, reordered, incomplete, stale,
   or unexpected clock-transform receipts reject. A full plan cannot silently
   accept TRO/consumer changes to the planned day parameters.
7. Commit or publish only after every phase succeeds. The scheduler does not
   execute consumers, clone their state, provide rollback, certify their raw-byte
   correctness, or authenticate a saved whole-game checkpoint.

Explicit ticks drive the 64-slot timing-ring and feedback primitives. The
feedback follows x86 uint32 sums/products, zero-elapsed branch, period clamp
33..660, and source population thresholds 66/100/150/200/250. Native divide-by-zero
inputs and overflowing day-transition shifts are rejected, not normalized.

## Native Evidence and Limits

The observer reuses the existing full-SCN/local-session research fixture. It
executes original SCN/TRO scanners, local server/client ready handshake, queued
clock packets, whole `0x4196f4` cycles, full registered visits, projectiles, and
natural AI callbacks. No runtime task/AI/production/CITY/visibility/projectile
handler is replaced, and no SCN/TRO timing or health is changed. Original
`0x453421..0x453790` decodes MAP terrain before SCN placement; PE BSS is zeroed
as required rather than filled with raw file-header bytes.

Explicit external boundaries during cycles are allocator `0x40bcc0`, clock
wrapper `0x40b030`, audio-output method at `0x70c000`, and observed debug-output
sinks. CRT seed 1 and selected mode-0 campaign configuration are explicit fixture
inputs, not recovered installed settings. External clock values follow the
original local server's currently queued period and are recorded per call.

IMPORTANT: setup is not a stub-free executable startup. The inherited SCN fixture
still substitutes asset-loading entries `0x43c388` with preloaded native-parsed
type/dependency/animation tables and `0x435f30` with the prepared source map/path
object. They are disclosed in `setupLoaderSubstitutions`, removed before world
execution, and not silently counted as platform sinks. A requirement forbidding
these even during asset setup remains unmet; the claim is handler-unmodified
WORLD SERVICE cycles over the complete original SCN, not original full startup.

Fresh 32-cycle captures for both missions compare every emitted phase, all
registered types (including neutral resources and fixed CITY), clocks, selector
weights/draws/actions, phase RNG/CRT continuity, flags, and timing packets.
The late ALIEN run reaches 1200 native cycles; team 1 first completes all four
policy groups at packet counter 1160, with group RNG 123->123, 123->124,
124->124, 124->124. Seven actors consume those orders in subsequent original
visits. This does not certify a complete portable mission or general combat.

HUMAN completes 14,160 untouched native world cycles. Target team 2 first
completes all four groups at counter 14,124, with group RNG 109->109,
109->110, 110->110, 110->110. No target-team order consumption is observed
after that activation within this captured prefix; unlike ALIEN, subsequent
target feedback is NOT established. The trace records 81 order consumptions
overall, which must not be mislabeled as target-team feedback.

| Activation boundary | HUMAN02 | ALIEN02 |
| --- | --- | --- |
| Packet `0x94c` | 14124 | 1160 |
| Entry `0x52c` -> actor `0x52c` | 14123 -> 14124 | 1159 -> 1160 |
| Entry `0x530` -> actor `0x530` | 320 -> 321 | 108 -> 109 |
| World entry RNG | 106 | 109 |
| Actor-loop entry RNG | 106 | 121 |
| Projectile / selector entry RNG | 108 | 122 |
| Full-policy entry / world-exit RNG | 109 / 110 | 123 / 124 |
| Entry / post-actor CRT state | 2759217992 / 3312555489 | 1 / 1 |

These values include intervening TRO and registered-actor work. Giving the
policy the world-entry RNG, or running policy before projectiles/actors, is
incorrect even when all separated owners individually match their fixtures.

The separate composition test feeds the actual source selector result into the
UNCHANGED `computeLegacyAiFullPolicy` at natural ALIEN counters 1160 and 1192.
Both calls match all 27,712 policy bytes, all 800 raw 220-byte actors, the entire
3,632-byte team, ordered emitted packets, force-order state, and final RNG.
The first call initializes a previously absent policy; the next reuses it.
These calls emit actor orders only, so this is not a claim that the existing
pure policy owner executes production receipts. No isolated policy fixture,
synthetic troop state, or post-hoc raw-byte normalization is used.

Native instruction controls separately cover eight day-clock cases and six
nonzero/zero elapsed timing cases. They are labeled isolated inputs and are
never substituted into the natural mission history.

Run only the owned test:

```sh
node --import tsx --test tools/qa/legacy-native-scheduler.test.ts
node --import tsx --test tools/qa/legacy-native-scheduler-policy.test.ts
```

Optional `DC_NATIVE_SCHEDULER_HUMAN_TRACE` and
`DC_NATIVE_SCHEDULER_ALIEN_TRACE` select saved native JSON captures. The native
composition test accepts `DC_NATIVE_SCHEDULER_POLICY_TRACE`; otherwise it runs
the actual 1200-cycle ALIEN prefix with the late observation window. The native
probe accepts `--updates`, `--from-counter`, and `--controls`. Python requires
the existing Capstone/Unicorn paths used by the repository's native probes.
Long prefixes execute all prior native cycles but store detailed scheduler
events only from the requested counter; this is not an initialization shortcut.

## Final Verification

- Both owned test files: 14 passed, zero failed/skipped. Fresh 32-cycle runs for
   both missions and both late activation windows passed. The late windows cover
   49 HUMAN cycles / 3,920 registered visits and 49 ALIEN cycles / 2,990 visits.
- Strict ES2022/ES2023 DOM typecheck with no-unused checks passed for the new
   module and both tests. Editor diagnostics are clean.
- Final comparison log: `/tmp/dc-scheduler-both-activation-tests-20260921-s29.log`.
- HUMAN capture: `/tmp/dc-scheduler-natural-HUMAN-20260921-s12.json`, SHA-256
   `1ead3e1cc54b809b0ec5181bb96c7b4dc29ff423b6bfbcbde1cd8cc5d0c45142`.
   This earlier observer revision predates per-actor registry-delta and whole
   policy snapshots; the unchanged late registry matches exactly. It does not
   provide a HUMAN whole-policy byte comparison.
- ALIEN capture: `/tmp/dc-scheduler-policy-capture-ALIEN-20260921-s23.json`, SHA-256
   `7bda9de67762a5e1dc9486b5c871696dbf3569d432a8e43573f02333d834c429`.
   Includes dynamic registry deltas and both natural whole-policy snapshots.
- Actual resource extraction, general CITY lifecycle, combat, arbitrary type
   handlers, sound playback, and receipt execution still require their separately
   verified consumers. Observing them in native execution does not add those
   implementations to this dispatcher. No whole-game executable ownership,
   original startup, browser cadence, or next-mission admission is claimed.

## Concrete Host Transaction

`NativeSchedulerHost` owns one explicit current-native boundary at `0x419cbc`,
AFTER registered visits, projectiles, frame recording, and frame reporting.
It executes the contiguous suffix through `0x419d4d`:

1. Set the original local-receipt byte (`0x49d620`) to one.
2. Run `advanceLegacyNativeAiSchedule` from current `game+0x94c`, the current
    eight raw team selectors (`team+0x24`), and current AI-state cursor.
3. Execute mode-4 selectors, including their zero-weight RNG draw. For mode 3,
    call the configured team's concrete `sourceNativePolicy` owner. Selection
    consumes RNG BEFORE `computeLegacyAiFullPolicy`; synchronous actor receipts
    execute inside that owner between the four groups. Publish its actual team,
    policy allocation/heap, shared actor pool, force-order byte, and shared RNG
    into the staged native world before the next team.
4. Clear the local-receipt byte.
5. Record the explicit end tick in the real 64-slot timing ring. At counter
    multiples of 32, compute the original feedback and population ceiling, and
    return ordered period/latency transport requests only after commit.

These are concrete imported owners, not caller callbacks or completion
certificates. Configuration is frozen and identity-branded; policy owners are
identity-branded and privately retain copied tables/navigation. Structural
copies and shared mutable buffers reject. Labels in `consumers` describe the
fixed implementation; supplying a label cannot install or certify a consumer.

The host copies the full `0x471b0` game buffer, AI-state bytes, every current
policy allocation, ground plane, census, and both RNG states. The input is an
explicit externally established native boundary, NOT a whole-world startup
certificate or a CampaignSession snapshot converted into native-looking bytes.
The executable authenticates the scheduler tables; policy tables and the
current boundary remain explicit inputs, not a new all-asset authentication
provider. Native captures are test oracles, never embedded runtime profiles.

Only after all suffix consumers succeed does the private state change. Failed
policy/receipt/timing work publishes neither state nor requests. A consumed
boundary cannot be consumed again; callers need a new actual boundary supplied
by the preceding world owners. There is no browser clock loop, inferred frame
rate, automatic next-world-cycle advance, checkpoint restore, or claim that
separately supplied boundaries form a portable uninterrupted mission.

### Readiness And Rejections

`selectorOwner` implements the real `AiSelectorSchedulingOwner` interface. Its
callback checks the source and current committed raw selectors, then queries
whole-cycle coverage. A completed suffix does NOT make this callback ready.
`wholeCycleReadiness` and `transactWholeCycle` expose the missing phases and the
exact live registry slot/type and unsupported selector team. The current first
whole-cycle blocker is `census`; registered type 16/CITY and type 40/resource
are explicitly reported in HUMAN02, not silently skipped as idle.

Fresh HUMAN02 counter 4 reaches an exact AI rejection at mode-3 team 3 when no
policy owner is configured; team 4 is also reported by the readiness query.
The real `prepareAiSelector` API rejects this host as not ready on a complete
source HUMAN02 CampaignWorld with RENAT and resources retained. Readiness does
not depend on `productionLifecycleExecuted: false`, and successful mode-4
draws cannot certify mode-3 execution or future world cycles.

Paid unit/CITY requests explicitly reject the entire transaction with
`Unsupported native scheduler phase ai: synchronous unit|city production receipt`.
The policy owner can compute these intents, but its public whole-call API does
not interleave a concrete paid receipt before subsequent groups. The existing
CampaignAi transaction applies production after that computation; wrapping it
here would not prove original synchronous ordering. No debit or pending actor
receipt escapes a rejected candidate.

Timing output is a committed request for `0x421394`/`0x42125c`, not a completed
wire send. Original transport remains outside this host. The source sends are
observed and their values/order compared, but packet sequence/framing and
remote receipt are not claimed. All game-buffer bytes still compare exactly.

### Native Host Evidence

The new observer adds read-only hooks to the existing handler-unmodified
world-service fixture. Its inherited setup loader substitutions remain exactly
as disclosed above; no actor, production, policy, visibility, or projectile
handler is stubbed. No oracle buffer or pointer is normalized for comparison.

- ALIEN02 fresh counters 1, 4, 16, 32: complete raw suffix equality, both
   mode-4 draws at counter 4, cursor rotation, timing-ring advance and counter-32
   feedback requests. Source file:
   `/tmp/dc-scheduler-host-fresh-native-20260921-h10.json`.
- ALIEN02 counters 1160, 1184, 1192 after executing the entire original 1200-cycle
   prefix: complete game/AI/policy/ground/census/RNG/CRT equality, first policy
   allocation, policy reuse, nonempty synchronous actor orders and timing
   feedback. Source file:
   `/tmp/dc-scheduler-host-late-native-20260921-h14.json`.
- Every positive compares the whole game buffer, not selected or normalized
   fields. Actor packets compare against original `0x421725` emission bytes.
   `0x421648` entry still has the previous/uninitialized two-byte length header;
   treating those pre-framing bytes as a completed native packet was rejected
   by the first test. Neither side is rewritten to manufacture equality.
- Late invalid end tick rolls back actual policy allocation, orders, raw world,
   force state and RNG; retry matches the native exit. Missing periodic tick,
   duplicate consumption, copied identities, caller mutations and shared buffers
   also reject or remain isolated.
- A separately labeled funded/unrestricted team control reaches a real paid
   production intent and proves atomic rejection. It is not a natural mission
   golden or a production execution claim.

Owned host checks: 11 passed, zero failures/skips in
`/tmp/dc-scheduler-host-human-readiness-20260921-h20.log`.
Final host plus dispatch/policy regression slice: **25 passed, zero failures or
skips**, `/tmp/dc-scheduler-host-final-tests-20260921-h22.log`. Both short original
world captures were regenerated because the older `s09` observer output lacks
the timing-return event; no implementation or comparison was weakened.
Strict ES2022/ES2023 DOM checking with no-unused checks passed for the modules
and all four focused test files (`/tmp/dc-scheduler-host-final-types-20260921-h21.log`).
Editor diagnostics and document links are clean.

Golden SHA-256:

- Fresh: `edf875086bab9a0e60c2a18ae9b4348f5faa1e97594eef62384fb63899b1c7c6`.
- Late: `73e936e957983f71fd2e323b7e68bbb6cef354c2dc3feed17412a2f460dba6be`.

```sh
node --import tsx --test tools/qa/native-scheduler-host.test.ts tools/qa/native-scheduler-host-cycle.test.ts
```

Optional cached captures: `DC_NATIVE_SCHEDULER_POLICY_TRACE` (existing policy
oracle), `DC_NATIVE_SCHEDULER_HOST_FRESH_TRACE`, `DC_NATIVE_SCHEDULER_HOST_TRACE`
(late ALIEN), and `DC_NATIVE_SCHEDULER_HOST_HUMAN_TRACE` (fresh HUMAN counter 4).
Without them the tests execute the original probes. The new probe accepts
`--mission`, `--updates`, and an explicit comma-separated `--counters` list.

### Next Whole-Cycle Work

CampaignSession and transport-host were deliberately left unchanged. The next
integration must stage a coherent current CampaignWorld AND native owner state,
not convert the browser session's counter into `0x94c` or replace its step API.
It must compose census, previous-cap flags, explicit platform tick/flags,
TRO-zero first visibility BEFORE clock/relation refresh, independent increments
of `0x530`/`0x52c`, cap/relations/day/path stamp, conditional visibility/TRO/income,
team maintenance, and every live registry index. TRO `c` must read `0x52c` with
the source signed-shift semantics, not the packet counter or a browser tick.

At each index read current high-water and registry, reset TASK6 budget even
for empty indices, and delegate CITY/resource/simple-idle/actor visits to their
actual current-state owners. Type 16 or 40 needs its full registered preamble
and return effects; an existing isolated lifecycle reducer is not a no-op
registered visit. Update shared raw/semantic identities, planes and RNG before
the next index, then execute projectiles and frame recording/reporting before
joining this suffix.

For paid AI, the next algorithm is initialization/preparation/demand, immediate
mode-9/CITY or mode-10/prepaid-unit receipt into the real production/world
owners, then groups 0..3 with synchronous actor receipts and current shared
buffers. Verify a native call that actually emits paid production; the current
actor-only golden cannot certify it. Finally consume timing transport requests
and replay the complete committed cycle before exposing whole-cycle readiness.
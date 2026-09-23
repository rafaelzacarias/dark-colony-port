# Native Registered Phase: Fresh Full-Array Boundary

## September 22 Occupancy Review Fixes

P1: both the host constructor and direct transaction reject `SharedArrayBuffer`
and shared-backed views throughout the retained state before cloning. This
includes all three occupancy planes and nested route/FIN data. Plain data shapes
are required; accessors are rejected without invocation, so they cannot replace
a checked plane during cloning. The existing frozen host/configuration identity
and detached input, result, and snapshot copies are preserved. Unshared
`Uint32Array` ground and `Uint16Array` air/extra planes remain supported without
coercing or truncating current occupancy values.

P2: every plane must have exactly `width * height` cells. Each index must be an
own property containing an integer in `0..0xffffffff` for ground or `0..65535`
for air/extra. Sparse arrays, explicit `undefined`, inherited numeric entries,
fractions, negative values, NaN, overflow, and short planes reject before any
actor visit. No missing trip cell is treated as empty.

Focused regressions cover both factions, including packet-8 trip cells HUMAN
523 / ALIEN 5191. Typed planes reproduce the full native packet-8 result
(35/50 visits). A late primary-FIN failure at HUMAN183 follows RNAT182's exact
+30 Q8 movement. ALIEN198 is the final actor, so its analogous negative fixture
corrupts the following empty registry entry. Both preserve the entire caller
and host state and deterministic retries. Shared typed planes, shared DataViews, raw
shared planes, nested shared buffers, snapshot/result mutations, retained input
mutations, and host configuration replacement have explicit controls.

Verification uses only the existing
[registered tests](../tools/qa/native-registered-host.test.ts) and
[ground-route tests](../tools/qa/legacy-native-ground-route.test.ts), cached
native captures, and scoped strict TypeScript checks. The latest isolated run
passes **20 tests, zero failures/skips**, plus `--strict --noUnusedLocals
--noUnusedParameters` (ES2022, ES2023/DOM). Evidence is in
`/tmp/dc-occupancy-final-tests-20260922-o07.log` and
`/tmp/dc-occupancy-final-types-20260922-o07.log`; this is independent of the
older full run already in progress. This does not widen source
consumers, scheduler admission, or whole-world execution. No agents, browser,
full suite, packages, or assets are involved.

## September 22 Final Route Integration

With authenticated task9/ground routing, `occupiedPath: true`, and the new
`randomizedEndpoint: true`, all original registered boundaries1..32 now complete:
**HUMAN 1,039 + ALIEN 1,592 = 2,631 exact visits**, with no exclusions. Pending7 uses
the existing typed helper; endpoint correction uses the actual source draws and
search, not captured output or RNG rebasing.

Each phase is independently seeded at its native boundary, **not a contiguous
TypeScript whole-world simulation**. Intervening TRO/scheduler work and mission
admission remain unimplemented. HUMAN33 rejects atomically at slot170/type25's
task7; ALIEN also matches33..40. No further owner was extended.
See [full source proof, runtime options, and tests](native-route-gaps-20260922.md).
The sections below retain the earlier, narrower configurations and milestones;
their next-blocker statements are historical, not the current combined scope.

## September 22 Ground-Route Continuation

The optional authenticated ground-route owner now completes packets **1..15**
for both full original missions: **427 HUMAN + 708 ALIEN = 1,135 exact visits**
in complete phases. Packet 8 includes all 35/50 registered actors and the actual
RNAT slots 182/198, six-step paths (`47 44 44` / `44 22 44`), real MOVE FIN,
task-6 reservation, turn, and first +30 Q8 step. Full game/planes/dependencies,
RNG/CRT, and route scratch match without HP, funds, or source-position changes.

The new source owner implements the original circular-bucket path search,
distance, and nibble serializer, not generic A*. All 38 native path triples
through packet 40 match full scratch and 25,955 ordered writes. Separate direct
native controls prove dynamic occupancy, odd-offset/zero-count serialization,
and 91/88-step routes truncated to 32 nibbles. Actual source grids are 96x84.

**The next blocker is packet 16**, HUMAN slot 156/type 8 and ALIEN slot 168/type 0:
pending opcode 9 enters task 9 at `0x416198`, then ordinary troop routing and
movement. Packets 16..40 remain atomic rejections, not completed portable cycles.
Both native histories ran all 40 cycles (1,327/2,008 visits); exact portable
completed prefixes total 627/1,208, including rejected-phase diagnostics.

See [native ground-route proof and runtime contract](native-ground-route-20260922.md)
for source configuration, scratch ownership, captures, tests, and concrete next
dispatch. The existing no-route configuration still has the seven-phase limit
described below; its ten tests pass unchanged. No scheduler/session admission
was broadened. Six new focused tests and scoped strict typechecking pass.

## September 22 Continuation

Only the registered owner, its native observer, focused tests, and this document
changed in this continuation. No scheduler admission, CampaignSession, transport
host, inherited setup substitution, asset, package, or global acceptance changes.

**The requested 32 complete portable phases remain blocked.** Both original
32-cycle histories execute without runtime core interception. The portable owner
now verifies longer ascending prefixes before rejecting atomically:

| Mission | Native visits in 32 cycles | Exact completed prefix visits | RNAT visits included | Carrier descent visits included |
| --- | ---: | ---: | ---: | ---: |
| HUMAN02 | 1,039 | 547 | 96 | 17 DROP |
| ALIEN02 | 1,592 | 1,040 | 40 | 17 SAUC |

Prefix counts include the existing 147/308 calls in seven fully successful
phases. They are **not** 32 full-phase results, nor committed results from failed
phases. Complete-phase counts remain 7 + 7, with 455 exact visits total.

Source mapping correction: decimal type 25 is RNAT, type 26 is SPID. They are
not DROP/SAUC transports. The actual carriers are decimal 92/93. Packet 8 adds
14 HUMAN RNAT actors and six ALIEN RNAT actors before the registered loop; all
are visited in that same original cycle, proven against the live registry at
world entry and registered entry. No TRO action or actor was removed.

The owner adds authenticated RNAT idle/wait behavior, pending Move/Attack
initialization, and task-8 waypoint staging. At HUMAN slot 182 / ALIEN slot 198,
the uncommitted raw220 handoff exactly matches original entry to `0x414ce4`,
including mode 1 and flight flag 0. The original dispatch continues through
tasks 8, 6, 4, 5. The next missing functions are ground route search `0x44492c`,
distance `0x44302c`, and path serialization `0x4430b0`, including path scratch
and shared globals. Existing bounded horizontal troop movement and generic A*
are not those owners. No callback or oracle-output replay substitutes for them.

Both actual carriers first appear at packet 16, slot 7, in task 22. Their
observed 17 descent visits through packet 32 now match raw220, FIN advancement,
height, payload, full game/dependency deltas, RNG, and task budget. The admitted
branch requires the original fixed-slot reservation, six-word payload,
velocity 0, acceleration 6, source base height 600/1200, descent direction 0,
positive step <= 50, and sound handle -1. Height uses the entry step and the
stored step decrements once. Descent completion, sound, horizontal approach,
payload delivery, spawn, ascent, and pool release remain closed. No carrier
payload spawn occurs in the observed first 32 registered phases.

FIN identity matters: DROPSTAND0 comes from DROP.FIN; SAUCSTAND0 is in
**SAWS.FIN**, not SAUC.FIN. The latter's MIDDLE state has 20 frames and is not
the observed four-frame SAUC stand bank. The factory authenticates the original
cross-file states; it does not truncate MIDDLE or alter the inherited loader.
`carrierFin` records actual current directional timelines at each native
boundary and must match authenticated source content before a carrier visit.
Omitting SAWS, changing the current bank, reservation, sound handle, or completion
boundary rejects. No claim is made for other carrier FIN fields.

Failed transactions expose detached `completedVisits` and, where reached, a
typed `handoff` with `registeredVisitComplete: false`; neither is committed
state. Host snapshots stay unchanged, retries are exact, and mutating the
diagnostic raw bytes cannot affect the host. Subsequent phases consume explicit
original phased inputs, not the preceding portable failure's candidate.

The observer now records actual task dispatch and helper entry/return ABI plus
first-before/final-after bytes for every touched non-stack address. Tests replay
every ordered write across all 64 observed phases, reconstruct the entire game
buffer (including financial dwords and registry), and check shared RNG/CRT at
original phase entry/exit. This is oracle consistency for unsupported phases,
not portable implementation parity for those writes. Source counters stay
independent: HUMAN resource `0x530` starts 5101, ALIEN starts 5701; packet
`0x94c` starts 1 in both. No clock or RNG rebase is used.

Final native captures:

- `/tmp/dc-registered-HUMAN-32-20260922-p06.json`, SHA-256
  `ba2f760c5bdf4f32d4be0378b366eec5c4f4cf0e54dccefb2926027430f3955c`.
- `/tmp/dc-registered-ALIEN-32-20260922-p06.json`, SHA-256
  `3cd43896d69eccea403a19fc9f0f056d41bd41deeb8a2f06d52edf1f5608ca6b`.

Verification: all ten owned tests pass with no skips in
`/tmp/dc-registered-final-20260922-t09.log`; strict ES2022 / ES2023,DOM with
no-unused checks passes in `/tmp/dc-registered-types-20260922-v03.log`.
Editor diagnostics and document links are clean. No browser, agents, full suite,
or admission verification was run. Wall time checked at 2026-09-22 00:32 PDT.

The sections below describe the original September 21 baseline; the corrected
type mapping and expanded prefix evidence above supersede their limitations.

## Result

The new portable owner completes the **entire registered phase** at original
packet counters 1 through 7 for both fresh full-SCN missions. No registered
actors are excluded, status-modified, or replaced by unknown-type no-ops.

| Mission | Initial resource counter | Visits per complete phase | Exact phases | Exact visits |
| --- | ---: | ---: | ---: | ---: |
| HUMAN02 | 5101 | 21 | 7 | 147 |
| ALIEN02 | 5701 | 44 | 7 | 308 |

This is **not 32 successful portable phases**. Both native captures execute all
32 original world cycles. Their registered phases contain 1,039 HUMAN visits and
1,592 ALIEN visits. Portable phases 8 through 32 reject atomically; they are
tested rejection results, not positive comparisons. There are 455 positive
registered calls, including 65 calls at the first actual complete phase.

## Owned Files

- [Pure owner and source factory](../src/engine/native-registered-host.ts)
- [Focused exact comparisons and controls](../tools/qa/native-registered-host.test.ts)
- [Original native observer](../tools/qa/native-registered-host-native.py)
- [Scheduler entry adapter](../src/engine/native-scheduler-host.ts)

The only edit to an existing shared runtime file is
`createNativeSchedulerRegisteredHost`. It authenticates the scheduler source and
constructs the independently verified one-shot registered host. It does not
feed a post-projectile snapshot backwards into actors or advertise a complete
world cycle. Existing suffix ownership, selector readiness, and all admission
guards remain unchanged. No production bridge or sourceNativePolicy edits.

## Configuration And State

`createNativeRegisteredConfiguration` privately copies and authenticates the
original EXE, GAMESTAT, DEPEND, SCN, and binary FIN assets before asynchronous
work. It derives type scalars, source upgrades, dependency metadata, RNG table,
CITY category mapping, directional stand timelines, and the TOWR damaged-bank
fallback. Runtime behavior does not read native JSON outputs or precomputed
actor transitions. FIN parsing uses the existing binary parser and duration
decoder, not generated metadata.

Bank addresses are explicit relocation inputs, distinct from animation content.
Tests bind them to original loaded bank addresses to compare unnormalized raw
records. Each supported type needs a distinct nonzero relocation, including
types absent from the chosen mission. The factory validates assets and profiles;
it does **not** authenticate an arbitrary supplied current-world snapshot or
claim to implement native SCN startup. The current world is an explicit caller
boundary, as with the existing native scheduler suffix.

`NativeRegisteredCaller` requires the actual `0x419bb8` boundary, current
`0x94c` packet counter, independent `0x530` resource counter, and explicit global
mode 0. Counters must agree with current game bytes. It never substitutes UI
counter 1 for source counter 5101 or 5701.

The transaction copies the complete `0x471b0` game buffer, ground/air/extra
planes, dependency state, RNG, CRT state, production-dirty byte, and task-6
budget. It rereads signed registry values and inclusive live high water at each
index. Dispatch uses the value; an empty index clears that index's actor `+0x12`.
The task-6 budget resets before every index, including empty indices. No actor
array is prefiltered or frozen for iteration.

Each successful receipt contains raw before/after, RNG and budget before/after,
high water, and all changed game/dependency bytes for that actor. The host commits
only after the full array completes. Failure exposes index/slot/type/task/caller
without a candidate state. Retry is deterministic; returned snapshots and
receipts cannot mutate committed state. A consumed host cannot execute twice.

## Concrete Consumers

- Shared registered preamble advances all three FIN channels and source-counter
  maintenance; unsupported damage, auxiliary work, or animation banks reject.
- Ordinary idle/wait/turn uses original shared RNG and source scalar controls.
  A conservative current-world scan proves there is no visible eligible hostile
  before admitting the no-target branch. It is not a general acquisition owner.
- Unarmed static idle uses the source seven-count wait. SCN `+0xcb == 1` follows
  the original resource-counter-mod-4 proximity scan and rejects capture/sound
  transitions instead of freezing HP or ignoring the callback.
- Fixed CITY task 19 at startup uses packet counter <= 3, resets the real stand
  bank, clears busy/latch state, restores idle payload, and runs the ordered
  dependency availability refresh. It writes global production-dirty state.
- Fixed CITY idle consumes the actual category, readiness, empty FIFO, delay,
  and health-dependent FIN choice. Native TOWR HP 1 is retained: its damaged
  banks genuinely alias stand. Other damaged CITY banks remain unsupported.
- Neutral type 40 uses the existing resource countdown and FIN owners with rate
  at raw `+0x32`, not an idle payload word. Extractor activation rejects until
  its constructor consumer is composed.

Fresh HUMAN types are 8, 16, 17, 40, 81, 84, 86. Fresh ALIEN types are 0, 2, 8,
10, 28, 29, 40, 41, 81, 86, 89, 91. Neither initial capture contains type 1 or 5.
The source-derived profile set is their union; unknown types are never skipped.

## First Missing Consumers

At packet 8, original triggers have introduced type-25 RNAT actors before
the registered loop. Baseline rejection was HUMAN slot 170 and ALIEN slot 193.
Within that same native phase, HUMAN slot 182 and ALIEN slot 198 already perform
pending-order acceptance, path construction, movement task dispatch, occupancy
and path scratch writes. Adding only a type-25 idle profile would therefore not
complete the phase. Later native phases include carriers 92/93 task 22, CITY
production, commander 69, and ordinary movement tasks 4/5/6.

These require the ground-path and carrier/production consumers with shared
memory and registry effects. Existing bounded horizontal troop movement is not
proof for the observed RNAT path. The current owner deliberately does not
weaken those guards, import oracle deltas as runtime code, or edit another
owner's production modules. General projectiles, census, TRO, visibility, income,
AI, timing transport, full-cycle commit and next-mission admission remain outside
this isolated registered phase.

## Native Evidence

The new observer composes the existing native scheduler probe. It runs original
fresh SCN initialization and complete world history, not repeated fabricated
actor snapshots. All registered visits execute original x86 handlers. It records
before/after records, task IDs, live high water, per-visit registry deltas, all
non-stack writes, full phase game/planes/dependencies, RNG/CRT, and loaded FIN
tables for test evidence. Final captures report zero runtime core interceptions.

The inherited setup substitutions remain: preloaded source-parsed type/animation
tables at `0x43c388`, prepared map/path at `0x435f30`, and explicit platform
boundaries. This is not a stub-free original executable startup claim.

Successful phases compare every actor's game/dependency byte delta, intermediate
production-dirty value, raw220 output, RNG and task budget, plus the entire phase
state. All external writes in those phases are accounted for: dependencies,
`0x478e00`, `0x479204`, and `0x479684`. Ground, air, extra, CRT, other game bytes,
and projectile storage remain exact and unchanged by these visits. The first
32 captures have no within-visit registry delta; dynamic same-loop allocation
is therefore **not** claimed as native-positive evidence here. The implementation
uses live reads, and separate controls verify value/index distinction and
inclusive high-water clearing.

Final captures:

- `/tmp/dc-registered-HUMAN-32-r04.json`, SHA-256
  `167acabc11e7f94aa9fa983daafe47ed0c416797678e3f79513782fb5769d500`.
- `/tmp/dc-registered-ALIEN-32-r04.json`, SHA-256
  `920c26dd628de370f6b0add094970f8242fdefd9ffb595d12b7bf0a2f34b932a`.

Focused verification: six owned tests passed, no skips. Three existing scheduler
source identity/admission/immutable-boundary tests passed. Strict ES2022 with
ES2023/DOM libraries and no-unused checks passed for the owned TypeScript slice;
editor diagnostics are clean. Logs are `/tmp/dc-registered-final-tests-r09.log`,
`/tmp/dc-registered-scheduler-admission-r01.log`, and
`/tmp/dc-registered-types-r03.log`.

Run only the focused test:

```sh
node --import tsx --test tools/qa/native-registered-host.test.ts
```

Optional `DC_REGISTERED_HUMAN_TRACE` and `DC_REGISTERED_ALIEN_TRACE` select saved
captures; otherwise it runs each fresh 32-cycle native probe once. No agents,
browser, full suite, package changes, or asset changes were used.
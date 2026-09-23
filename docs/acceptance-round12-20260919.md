# Round 12 Acceptance Status

Date: 2026-09-19. Current synthesis of completed evidence, not a new test run.
Phases 1-2 remain accepted only in their pinned scope. **Phases 3-5 remain partial,
not complete and NOT accepted**; the user goal of all-phase completion is not met. Existing acceptance
gates are unchanged. The [round 11 report](acceptance-round11-20260920.md) and
earlier reports remain historical, including their original dates and results.

## Previous Clean Gate

Recorded command: `npm run check` (typecheck, full test suite, build).
Evidence: `/tmp/dc-round12-final-recheck-20260919.log`.

| Result | Recorded value |
| --- | --- |
| Tests | 2,601 |
| Passed / failed / skipped | 2,597 / 0 / 4 |
| Typecheck / build | Passed / passed |
| JavaScript / gzip | 603.79 kB / 189.33 kB |
| Build warning | Chunk larger than 500 kB remains |

Some latest nested-turn guard changes/tests may have landed after this run
started. This is the actual completed gate, not certification that every latest
edit was included. Separately, current base/overkill verification records
**seven passes and one inapplicable skip**, with **129 passing neighbors**.
The skip is the overkill capture's absent nested-turn case. These are separate
focused results, not additions to the full-gate totals. Scoped TypeScript passed.
Evidence: `/tmp/dc-prelethal-chain-base-20260919-02.log`,
`/tmp/dc-prelethal-chain-overkill-20260919-02.log`,
`/tmp/dc-prelethal-neighbors-20260919-03.log`, and
`/tmp/dc-prelethal-types-20260919-03.log`.

## Authenticated Nonlethal Combat

The [bounded host/session owner](source-native-combat-host.md) and
[MissionView integration](mission-native-combat.md) now execute actual
authenticated type-0/weapon-1 nonlethal launch, travel, impact, reclamation and
damaged continuation. All **21 original HUMAN02 actors plus two source
allocations** remain. The separately declared bounded caller is explicit QA,
not original HUMAN02 TRO or original mission admission. Normal screen
Move/Attack commands remain disabled for this path.

The [browser QA fixture](native-combat-browser.md) reconstructs providers from
original asset bytes. Its Buffer bootstrap is QA-only. Browser-fetch/Node-peer
tests compare all **126 source hashes** and configuration/world parity;
serialized configuration is not an authentication provider. Automated
hit/restore/reaction/rollback evidence does not establish browser restore.

MAIN's completed shared-browser observation at **frame87** records projectile0
impact, source171, target170, substep2, damage25, target HP775, reclaim0
(projectile slot0), and23 actors. The screenshot has **135,196 colored pixels**
and no diagnostic. This is a bounded nonlethal presentation observation, not
proof of general native effects, audio or mission scheduling. The browser
first restore attempt was interrupted by HMR. The uninterrupted rerun passed
exact checkpoint equality with recreated providers, frame88 damage flags
`[0,1,1]`, continuation to frame95, and frame96 rejection with unchanged state.
At viewport390 the combat canvas spans x12..363 (width351), with no mission
diagnostic; the mobile screenshot was inspected.

The old VENT rendering blocker is superseded for this bounded view: all four
source VENT actors retain source-proved **fresh frozen poses**. This does not
advance or certify native resource animation cadence, extraction or lifecycle.
No actor removal or replacement resource scheduler is claimed.

## Pure Owners And Rendering

The [lethal death owner](native-death-owner.md) is pure and opt-in through the
projectile reducer's optional death fields. Fresh-source evidence has32 real
hits reaching HP0, and45 real hits reaching HP-10; both remove the victim only
after150 registered death visits. The latest nested-task guard enables continuous
TypeScript state from the captured boundary **after the first real hit**, through
all **1880/2543 remaining phases**, with no native snapshot rebasing. The
unrecorded constructor/first shot is not claimed as TypeScript replay.

The later opt-in host/provider/session/view admission is recorded in the death
integration addendum below. It does not admit whole-mission lethal combat,
commander-statistics branches or a shared mission scheduler. Pure-owner evidence
alone does not establish those integrations.

[Damaged movement and reciprocal duels](native-damaged-actor.md) now cover
**782 registered visits and239 projectile phases**, including real displacement
and return fire. This is bounded pure-owner evidence, not a type8 combat-provider
admission or general movement/retaliation policy.

[Mode2 shadow rendering](mode2-shadow-native-20260919.md) is integrated into the
live scene with the shared mode2/mode5 readback budget. **54 checks** cover
**256 native framebuffers**. MAIN additionally observed the actual Canvas path
for source Desert ALBU timeline13 child2: exact output, **9,317 readback pixels,
one read, one write, zero body draws, 2,666 changed pixels, zero mismatches**.
A desktop snapshot and mobile screenshot were captured. At viewport390 the
mode2 canvas spans x12..348 (width336), retaining 2,666 changed pixels, zero
mismatches and zero body draws. This does not
expand the bounded clipping/palette/camera envelope, prove global scene ordering,
or establish native animation cadence or full renderer parity.

## Authentication And Performance

The [immutable-task configuration work](trusted-immutable-task-config-20260919.md)
fixes the snapshot race and SharedArrayBuffer session guard. Independent review
found no alias in the reviewed boundaries. Mutable external data remains
detached; provider authentication and replay are not replaced by identity alone.

The same20 advances improved from **23.52s to8.47s**; ordinary advances improved
from **991ms to277ms**. These measurements are **not realtime** or60-FPS
acceptance. Browser provider parity, pure native equality and a nonblank
screenshot do not substitute for sustained native cadence/performance.

## Next Blocked Work

1. Normal bounded Attack/Stop and an owned native clock are the next vertical
   slice: normal input must produce authenticated, journaled native receipts,
   preserve pending Stop ordering, and replay/roll back through the same owner.
   Ordinary advances still cost about277ms; the clock cannot yet run playably.
   Wall-clock guesses or skipped native visits do not satisfy this gate.
2. Source-owned natural visibility and audio history remain required. Controlled
   exploration bit31 and explicit current CRT seed/DEA state are not mission
   history; the native startup research below does not install a runtime owner. Original
   TRO/AI, resources, production and combat still need shared caller ordering,
   RNG ownership and scheduling; commander branches remain outside this scope.
3. Broader type/weapon/route coverage, construction/effect presentation, native
   cadence, ordinary-input device workflows and sustained performance/memory
   budgets remain open. Bounded browser restore and mobile layout checks pass;
   frozen VENT poses are not resource cadence or complete renderer parity.

This documentation update ran no agents, code changes, full suite or browser.
It records the completed gate and MAIN observations separately from later
focused evidence; it makes no all-phase acceptance claim.

## Death Integration Addendum (2026-09-20)

This supersedes the earlier lethal-host and browser-pending limitations, not the
acceptance criteria. **Phases 1-2 remain accepted only in their pinned scope;
phases 3-5 are NOT accepted, and all user goals are not met.**

### Gate Status At Read

The latest full suite, `/tmp/dc-round12-death-final-20260920.log`, **finished**:
**2,634 tests, 2,628 passed, two failed, four skipped**, duration
**1,644,887 ms** (log precision: 1,644,887.041542 ms). Its only failures were the
two external-oracle fixtures in
[source-native-combat-host-continuity.test.ts](../tools/qa/source-native-combat-host-continuity.test.ts):
the host correctly required an externally authenticated configuration.

The correction is **test-only, not a runtime fix**: both fixtures now assert
host-adapter rejection of oracle configuration, then compare the pure reducers
through 1880/2543 phases. The source-geometry guard remains intact. Recorded
focused evidence `/tmp/dc-continuity-final-20260920-FCNfG2` has **two passes,
zero failures**; scoped types are clean (empty diagnostics in
`/tmp/dc-continuity-strict-final-20260920-GokbgJ`). This is pure-owner continuity plus
host rejection coverage, **not host-continuity parity**.

The previous clean gate remains **2,601 tests, 2,597 passed, zero failed, four
skipped**, with typecheck/build passed. Neither adding the two focused passes to
2,628 nor combining separate runs establishes a **2,630-pass clean full gate**.
No corrected full-gate rerun is claimed or needed for this docs-only update.
MAIN's separate final typecheck and build passed after the last fixes:
619.53 kB JavaScript, 194.35 kB gzip, build 4.37 seconds. The over-500-kB
warning remains. This is not a replacement full-suite run. No completion is claimed
here. The latest full run started before the external-update guard fix below
and may not include it; its six focused passes remain separate evidence.

### Opt-In Host And View

[Source combat host](source-native-combat-host.md) now accepts optional
`death: true`, with authenticated death FIN, session-owned team/type statistics,
registry and lifecycle, atomic publication and fresh-provider replay. The scope
is `source-separated-type0-weapon1-bounded-lethal`; default nonlethal behavior
is unchanged. This is explicit bounded caller admission, not original HUMAN02
TRO, whole-mission admission or a shared scheduler.

The actual fresh session retains all21 original actors, adds two real source
allocations, and reaches HP0 after32 real hits at counter614. The victim remains
registered/dying for150 native death visits, unregisters at764, and its slot is
reused at784 with a new generation and HP800. Host evidence includes
`/tmp/dc-lethal-host-restore-20260919-A15.log`. Separately, the pure32/45-shot
chains reach HP0/-10 and continuously execute1880/2543 remaining phases **after
the captured first real hit**, with no oracle rebasing; they do not replay the
uncaptured constructor/first shot. Current pure-owner/rejection evidence:
`/tmp/dc-continuity-final-20260920-FCNfG2`. The historical
`/tmp/dc-lethal-host-continuity-20260919-A14.log` must not be read as authenticated
host-adapter continuity parity. The fresh-source host/provider lifecycle at
614/764/784 is separate positive evidence.

[MissionView](mission-native-combat.md) maps native FIN primary and active
secondary bank/frame/delay/mode to source samples, without elapsed-time guesses.
FIN completion does not remove a still-registered corpse; native unregister and
generation reuse control projection. Exact fresh-provider restores at613,649,784,
HP-tamper rejection and this lifecycle are covered by the completed
`/tmp/dc-view-death-restore-20260919-r1.log`: **one pass, zero failures,
1,009.139 seconds**. This is bounded Node integration, not lethal browser pixels.

### Audio Boundary

Optional visible death sound authenticates EXE/SOUND2/SLIST bytes and hashes,
keeps the CRT seed separate from combat RNG, and requires explicit current
13-byte DEA descriptor/seed plus listener and initialized/disabled flags. Input,
before/after state and ordered sound requests are journaled. The explicit seed
does not prove the current mission seed/history. A real32-hit controlled-bit31
kill produces a host request; movement alone does **not** establish the cell's
persistent exploration bit31, which the sound gate tests. Bit31 is **not current
visibility**. The natural cohort emits no sound; the controlled bit31 fork is
not valid natural visibility history and is rejected on restore. Evidence:
`/tmp/dc-visible-evidence-20260919-b13.log`.

MissionView requires a consumer for sound-producing transactions and rejects
an absent consumer before publication. `onNativeDeathSound` delivers only after
commit, once per request; consumer errors throw `AggregateError` after commit,
without rollback or retry. Restore never replays historical audio. The real
positive host request and isolated delivery helper are tested, alongside the
nonlethal view/restore guards; **positive full-view audio is not tested**.
Evidence: `/tmp/dc-postcommit-sound-focused-20260920-02.log` and
`/tmp/dc-postcommit-sound-host-final-20260920-05.log`. Native volume/pan to
WebAudio and audible playback remain unproved.

### Read-Only Native Research

`/tmp/dc-visibility-positive-20260920-r6.log` distinguishes persistent exploration
bit31 from current team visibility. Original clear `0x4456f0` applies
`0x807fffff`, preserving bit31 while clearing visibility bits. Native compute
`0x44a6d4` gives **411 explored / 411 visible** cells; clear gives **411 / 0**;
recompute restores **411 / 411** and the identical full ground hash. This is
native source evidence, not an installed runtime visibility owner or proof of
the exact victim's history at death.

`/tmp/dc-crt-bootstrap-positive-20260920-r8.log` proves native startup
`0x45a7cb -> 0x4645d5 -> 0x469749`: initializer `0x469749` writes seed1 at
`0x469754` to thread storage `+0xc`. The first native `rand` returns **16838**
and advances the seed to **1103527590**. Only platform `VirtualQuery` and
`GetCurrentThreadId` are stubbed. Startup seed1 is source-proved; the exact
current seed/DEA consumer history at the victim's death remains unproved.
Neither research result installs a runtime owner, makes the controlled host
request a natural-history proof, or establishes a positive full-view callback
or audible browser playback.

### Review And Browser Limits

Independent P2 review found generic death injection into unowned original slot5.
The [CampaignSession guard](campaign-session-native-combat-updates-20260920.md)
now rejects **all nonempty external updates whenever `host.nativeCombat` exists**,
in both scopes, not just updates to native-task actors. Empty/absent updates and
internally owned native requests remain valid. Replay-tamper rejection and
unchanged state/journals on rollback are covered. Recorded focused verification:
**six passes, zero failures** in
`/tmp/dc-p2-external-updates-final-20260920-01.log`; scoped typecheck passed
(`/tmp/dc-p2-external-updates-types-20260920-01.log`, empty diagnostics).

MAIN's actual nonlethal browser restore is recorded as exact/true, with damage
flags `[0,1,1]`, continuation to95 and rejection at96 with unchanged state.
Mode2 mobile checks passed; cleanup returned to the launcher at viewport1440.
These are earlier observations, not a new browser run. **No new lethal browser
pixel test exists.** This addendum ran no agents, code changes, tests or browser;
it only checked existing evidence and documentation paths.
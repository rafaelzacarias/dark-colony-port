# Native Construction Lifecycle - 2026-09-19

Source-only follow-up: [native-construction-host-20260919.md](native-construction-host-20260919.md)
now proves actual mode9 receipt plus the normal 186/246-visit production owner.
It does not integrate Session/world or resolve the lethal phase3 gate below.

## Decision

**Normal construction, queued idle-order handling, direct-hit guard checks,
and eight source-backed timed nonlethal attacks pass. The combined lifecycle
gate remains blocked on reachable lethal destruction.** This is native
execution through final latch release, not merely successful FIN parsing.
It does not accept campaign production or any containing project phase.

Only this report and
[construction-lifecycle-20260919.py](../tools/research/construction-lifecycle-20260919.py)
are owned. No runtime, main, game-data, existing research, browser, agents, or
full test suite were changed or run. This follows the
[independent QA check](phase-acceptance-20260919.md#next-discriminating-native-check)
and extends, without modifying, the
[earlier bounded probe](production-runtime-audit.md).

| Gate | Result |
| --- | --- |
| Real source building, native main/auxiliary transitions, final latch release | Pass for types 20/92 and 32/93 under the fixture below |
| Initialization counter 3 versus 4 | Pass for both races; distinct native branches executed |
| Native initializer versus seeded first-frame delay | Pass; the old synthetic assumption is not real initialization |
| Queued idle order through opcode-4 consumer | Pass in ten cases; deferred until normal completion, not active cancellation |
| Direct-hit busy-building / team-8 auxiliary guards | Pass in six building cases and four adversarial auxiliary candidate cases |
| Native spawn, target enumeration, launch, effect selection, collision and timed damage | Pass in eight bounded weapon-1/profile-0 cases; not a destruction contract |
| Interruption cleanup | Not accepted; two departure-death component counterexamples lack legal launch/effect-profile state |
| Production workflow / campaign integration | Not accepted; not exercised |

## Reproduction And Boundaries

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 tools/research/construction-lifecycle-20260919.py
```

The default command emits JSON and **exits 1**, deliberately. It retains the 26
original cases: 24 bounded passes and two blocked death components, and adds
eight passes in `timedWeaponCases`. A separate
`negativeControls` array retains all six original invalid-entry injections and
asserts their unresolved cleanup at update 513. Their old failing assertions
were not converted into native-behavior acceptance. No lifecycle call is
intercepted in any of these 40 runs. `timedWeaponNonlethal` is a separate gate;
it cannot turn the combined lifecycle or interruption-cleanup gate green.

`--probe queued-order|projectile|auxiliary-guard|damage|timed-weapon --phase 0|1|2|3
--race 0|1` runs one counter-4 case. Use phases 1 or 3 for `auxiliary-guard`.
`damage` deliberately bypasses collision and is diagnostic, not a valid death
contract. `--disassemble START END` is read-only and is not a gate. Do not hide
the default exit status with an unconditional success wrapper.

Executable SHA-256 must equal
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
JSON includes source-table hashes, ANIM.DAT hash, selected FIN hashes, source
timeline ranges, raw field2 values, converted delay bytes, selected bank/state,
per-dispatch snapshots, native write PCs, and executed-entry counts.

Source setup:

- Reuses native GAMESTAT scanner destinations and post-scan conversion from
  the existing Inspire source fixture; no invented building HP or durations.
- Executes the existing DEPEND source parser and asserts dependency 2 has
  metadata `[0,3,0,0]`, dependency 16 `[0,3,0,1]`. These are constructible
  slot-3, level-0 buildings, not an arbitrary decorative type.
- Parses actual tag-29 FINs registered by ANIM.DAT. Resolves states across
  files, not by assuming `unitName.FIN` exists. Raw timeline headers and state
  ranges are marshalled into the native timing-record layout. Native
  `0x425b21..0x425b6f` performs delay conversion on every loaded timeline entry.
- Native `0x4265e0`, `0x4260a8`, `0x43c18c..0x43c217` select and bind STAND and
  BUILDSTAND/BUILD banks. Native `0x43bf46..0x43c099` also binds death variants
  for the interruption probe. A zero death-variant divisor encountered during
  development was fixed by this source binding, not retained as a blocker.

Remaining setup interceptions are exactly:

| Address | Host service supplied |
| --- | --- |
| `0x4254d4` | Case-insensitive lookup in parsed source FIN state registry |
| `0x46cb74` | Only the observed `%s%s` and `%s%d` formatting forms; other forms fail |
| `0x46d51a` | Bounded string concatenation; native segment-register instruction is unavailable in this fixture |

**There are zero intercepted calls during the construction lifecycle itself.**
The final assertions enforce this. Initialization `0x41822c`, task allocation
`0x411dd8`, reset/continuation `0x412014`, auxiliary creation `0x418504`, native
spawn `0x41b750/0x41af14`, movement `0x4182e8/0x4183b8`, auxiliary handler
`0x4186e0`, main handler `0x4187e4`, eligibility `0x437bc4`, and animation update
`0x4264c8` execute original instructions.

This is not a complete native boot or full FIN renderer. Sprite child render
records are not marshalled; the construction updater uses frame count and delay.
The timed attack additionally marshals the eight source timeline event slots
(name lookup and signed offsets), binds attack banks through `0x43b970`, and
executes the native launch-event reader `0x4263d8`. Missing registered event
dependencies fail closed. This does not implement rendering.
The fixture seeds team 1 / slot 3 / entity 18, source maximum HP 2400, object
status 1, empty task storage, and auxiliary slot 21 inactive. Auxiliary type
92 or 93 is spawned natively with source HP 800 and team byte 8. Map dimensions
are a host fixture. Interruption cases now install three bounded occupancy
planes and four slot-3 footprint cells using the executable's offsets at
`0x47abe8 + slot*64`. Colony origin is `(32,32)`; the cells are `(33,32)`,
`(34,32)`, `(33,33)`, `(34,33)`. Native `0x434d48 -> 0x4453a8` accepts and
clears all four cells without interception. This does not prove complete native
colony placement or auxiliary spatial registration. Native audio is
uninitialized. Sound routines take their inactive path; audible sound
and enabled-audio behavior are not proven. Initial main coordinates are zero
in the original cases; timed attacks place it at the installed footprint's
`(33,32)` cell center.
The initialization counter is held at 3 or 4; full game-clock cadence is not run.

## Actual Profiles

| Type / Role | Source State | FIN / Inclusive Timeline | Converted Delays |
| --- | --- | --- | --- |
| 20, human science lab | SCNCPODSTAND0 | HUBU.FIN, 22..22 | `[2]` |
| 20, construction | SCNCPODBUILD0 | DROP.FIN, 94..135 | 42 entries of 2 |
| 92, human auxiliary | DROPSTAND0 | DROP.FIN, 72..81 | 10 entries of 2 |
| 32, alien science building | MINDHIVSTAND0 | ALBU.FIN, 3..4 | `[4,4]` |
| 32, construction | MINDHIVBUILD0 | SAUC2.FIN, 0..71 | 72 entries of 2 |
| 93, alien auxiliary | SAUCSTAND0 | SAWS.FIN, 475..478 | 4 entries of 2 |

Types 92 and 93 are **race alternatives**, not sequential construction stages.
Both arrival and departure use the same auxiliary type for the selected race.

## Executed Normal Lifecycle

The probe executes the original outer entity loop `0x419bb8..0x419c0e`.
It traverses the native active-ID array in ascending slots and skips `-1`.
With main ID 18 and auxiliary ID 21, main runs before auxiliary. Creation at
the earlier slot makes the auxiliary eligible later in that same update.
The native entity dispatcher `0x419248` advances animation channels before
dispatching tasks through `0x479310`; nonzero task returns can continue within
the same entity update. Counts below are **outer-loop calls**, not milliseconds,
seconds, browser ticks, or an assumed original-game frame rate.

Main status stays 1 and HP stays 2400 throughout normal construction. Auxiliary
status stays 1 / HP 800 after creation, including while unregistered. The trace
separately reports status, active slot, task depth, task, phase, movement counter,
animation frame/countdown/mode, source timeline, busy, and latch. A task word is
labelled as a phase only for actions `0x13` and `0x14`.

| Transition | Human Update | Alien Update | Main Phase / Animation | Busy / Latch |
| --- | --- | --- | --- | --- |
| Native initialization | 0 | 0 | 0; STAND mode 2, frame 0, delay 0 | 1 / 0 |
| Acquire latch; spawn incoming auxiliary | 1 | 1 | 1; BUILD mode 2, frame 0, delay 0 | 1 / 1 |
| Incoming movement pops action `0x16` | 51 | 51 | 1; still frozen | 1 / 1 |
| Auxiliary action `0x14` starts main BUILD and unregisters itself | 52 | 52 | 2; mode 1, frame 0, delay 0 | 1 / 1 |
| Main animation ends; native busy clear; spawn departure | 135 | 195 | 3; STAND mode 0, frame 0, delay 0 | 0 / 1 |
| Departure movement pops action `0x16` | 184 | 244 | 3; standing animation advances | 0 / 1 |
| Auxiliary action `0x14` writes phase 4 and unregisters | 185 | 245 | 4; standing animation continues | 0 / 1 |
| Main releases latch and performs native order reset | 186 | 246 | Action 1 replaces construction action | 0 / 0 |

Arrival action `0x14` first sets its own phase 0 -> 1 and returns 1. The dispatcher
immediately calls it again: it initializes parent BUILD mode 1, sets parent
phase 2 (`0x418799`), and unregisters the auxiliary (`0x4187cf`). Departure
executes it once, setting parent phase 4 (`0x4187a0`). Thus there are exactly
two auxiliary creations and three continuation-handler calls per normal build.
No parent phase is assigned by the harness after initialization.

The incoming movement uses native counter 50 down to 0; outgoing movement uses
0 up to 50. These are constants executed from the auxiliary movement code,
not guessed FIN durations. The native return convention and slot order account
for the additional continuation and final-release updates.

**Status is not the scheduling predicate.** Unregistration writes
`game+0x468ec+2*id = 0xffff`, but leaves auxiliary status 1 and task `0x14` in
memory. Dispatching it merely because status is nonzero would erroneously
overwrite the parent's next phase. The final probe uses the actual outer loop.

At counter 3, both races take phase 0 -> 5, then clear busy/latch and reset to
action 1 in the first update. No auxiliary is created. Transient phase 5 and
latch 0 -> 1 -> 0 are captured by native write hooks despite occurring inside
one call. Counter 4 exercises the complete auxiliary path above.

## Timing Discriminator

Native initializer `0x42630c` resets frame and countdown to zero when bank or
mode changes. The first native update sees countdown zero and advances to frame
1. It does **not** start with the first source delay loaded by the harness.

| Real Construction Bank | Native Initializer | Artificially Seed First Delay | Old `sum(delays)+1` |
| --- | --- | --- | --- |
| SCNCPODBUILD0 | 83 animation updates | 85 updates | 85 |
| MINDHIVBUILD0 | 143 animation updates | 145 updates | 145 |

Both columns execute the original animation updater against the same source
bank. For these positive-delay profiles the native-zero-delay result is
`sum(delays[1:])+1`. This is a bounded arithmetic comparison, not permission to
replace the animation and auxiliary state machine with a timer. Other profiles,
zero converted delays, same-bank/same-mode initialization, and wall-clock
cadence are not generalized from these two cases.

## Interruption: Fixture Versus Behavior

### Invalid Internal Entries Retained

The six original injections remain negative controls. Raw `0x412014` replaces
task storage immediately; it is not the command consumer. Isolated `0x416308`
does not run damage or its paired footprint-removal call. Neither is evidence
of legal cancellation or destruction. No phase, busy, latch, or animation
completion is forced by these controls.

| Injection | Counter / Phase | End Busy / Latch | Observation |
| --- | --- | --- | --- |
| `0x412014`, order reset | 3 / 0 | 1 / 0 | Action 1 replaces construction before latch acquisition |
| `0x412014`, order reset | 4 / 0 | 1 / 0 | Same retained busy state |
| `0x412014`, order reset | 4 / 1 | 1 / 1 | Arrival auxiliary writes 4 into replacement action-1 task word |
| `0x412014`, order reset | 4 / 2 | 1 / 1 | Animation can finish, but construction handler no longer owns completion |
| `0x412014`, order reset | 4 / 3 | 0 / 1 | Departure auxiliary writes 4 into replacement task storage; latch stays set |
| `0x416308`, death entry | 4 / 2 | 1 / 1 | Status becomes 10; action 10 reaches word 150, then status 0 and active slot -1; busy/latch remain set |

All six still fail cleanup at outer update 513, without emulator crashes or
lifecycle interceptions. They refute the old adapter assumption, not the game.

### Queued Idle Is Not Active Cancellation

The command table at `0x479384` maps opcode 4 to `0x41ce54`. That consumer reads
a little-endian entity ID through `0x43ac24`, followed by an order byte. It
writes pending flag `entity+0x36 = 1` and order `entity+0x37`; it does not call
reset. Order 1 maps through `0x4792bc` to native idle initializer `0x412654`.

The probe executes this consumer at counter/phase `(3,0)`, `(4,0)`, `(4,1)`,
`(4,2)`, `(4,3)` for both races. Goldens require unchanged construction task,
phase and HP immediately after decoding; normal phases and auxiliary counts;
unchanged completion at updates 1/186/246; retained footprint and colony HP;
and pending flag 0 / order 255 after final reset. Only at normal completion
does `0x4120bb..0x4120e1` consume the queued order.

This establishes the native command-consumer contract. It does not establish
that the ordinary UI offers an active construction cancel, or authorize an
active-build refund. Pending-request UI refunds are a different operation.

### Direct Projectile Guards

The projectile path `0x442570..0x442750` calls collision lookup `0x434f6c` at
`0x4425e4`. The probe supplies bounded occupancy and actual source type, armor,
weapon-1 damage, and MBULLET coefficients. Matrix conversion executes
`0x43b24b..0x43b2ef` with its column cursor EDI explicitly zeroed per row;
armor initialization executes `0x43bd46..0x43bdae`.

| Candidate | Native Evidence | Executed Golden |
| --- | --- | --- |
| Main building at phases 0/1/2 | `0x4351ee..0x4351f7` rejects reserved-ID slot busy != 0 | Six race/phase cases return -1, never enter damage, and finish normal construction with HP 2400 |
| Incoming or departing auxiliary | `0x43515a..0x43515d` rejects team 8 | Four race/phase cases return -1, never enter damage, retain HP 800, and finish normal construction |
| Main building at phase 3 | Busy is already 0, so the same guard permits collision | Two cases return ID 18 and reach native damage/death/removal; upstream legality still blocked below |

The auxiliary test deliberately presents an auxiliary ID in an otherwise empty
air cell, then restores the cell. This is an **adversarial guard fixture**, not
proof that the auxiliary occupies that cell or can receive a legal death order.
No auxiliary task/status/team/HP is overwritten. Direct-hit rejection is not
universal invulnerability: the separate area-effect occupancy scan
`0x441bec`, especially `0x44206e..0x44219b`, does not repeat the direct-hit
busy/team-8 guards. Its real blast profile and occupancy are not reproduced.

### Native Timed Weapon Contract

The eight `timed-weapon` cases are distinct from the component injections.
They install actual WEAPSTAT scanner destinations and execute native flag,
lifetime and weapon-1 animation-bank post-processing. BOOMSTAT's actual `0 1`
header is parsed by `0x43b407..0x43b49e`: width 1 at `0x4f90e0` selects the
direct-damage branch. Unused area and effect-render records are not marshalled.
All four combat source-table hashes and the converted weapon record are emitted.

At the requested construction phase, `0x41b750 -> 0x41af14` spawns a real type-0
trooper at `(30,32)`, team 0, source HP 800, native ID/active slot 152. Native
spawn installs ground occupancy and idle action 1. No source status, task,
weapon, HP or target is forced after spawn. The main starts at source HP 2400.
The bounded fixture marks its four actual footprint cells visible to team 0;
`0x41993f..0x41996a` computes the own-team visibility mask. Full fog updating,
UI commands, diplomacy initialization and native map boot remain outside scope.

The real path is:

1. Ascending native active-slot dispatch, including the attacker, via `0x419bb8`.
2. Idle target search `0x435c14 -> 0x435570`, enumerating the installed planes.
3. Attack `0x41481c -> 0x412d00`, source FIN events and launch `0x441710`.
4. Native action-11 cooldown `0x4121d8`, using weapon rate 15, consumed by the
  entity dispatcher. No host firing schedule or impact batching is used.
5. `0x44293c`, called after entity updates as at native `0x419c0e`, performs
  four native projectile substeps `0x4423f8` per outer update.
6. Collision `0x434f6c`, effect selection `0x442767`, damage call `0x442877`.

Real candidate records show building 18 reaching the busy rejection branch
`0x435974` 32-56 times in each pre-departure-start case. There are no launches
or damage while busy. Once busy clears, native search selects it and projectiles
collide with it. The direct-hit guard still executes, now with busy 0. This
proves target-search protection for this profile, not universal immunity to
in-flight projectiles or area damage during construction.

| Race / Attack Start Phase | Launch Updates | Impact Updates | HP At Latch Release |
| --- | --- | --- | --- |
| Human / 0 | 146, 163, 180 | 147, 164, 181 | 2388 |
| Human / 1 | 147, 164, 181 | 148, 165, 182 | 2388 |
| Human / 2 | 151, 168, 185 | 152, 169, 186 | 2388 |
| Human / 3 | 136, 153, 170 | 137, 154, 171 | 2388 |
| Alien / 0 | 240 | 241 | 2396 |
| Alien / 1 | 241 | 242 | 2396 |
| Alien / 2 | 198, 215, 232 | 199, 216, 233 | 2388 |
| Alien / 3 | 196, 213, 230 | 197, 214, 231 | 2388 |

Each impact deals four HP. Multiple launches are 17 outer updates apart,
including native cooldown/task-return behavior. Human phase-2's last impact
occurs in the projectile stage of update 186, after entity-stage latch release.
It must not be counted as an impact strictly before latch release.

An initial new assertion of three hits in every case was **native-disproved**:
after repeated empty searches, `0x414c8b..0x414cb0` selects a 45-count action-3
idle wait instead of 15. Alien phase-0 starts that wait at 193; busy clears at
195 with 43 remaining, action 3 pops at 239, and firing starts at 240. Phase-1
is offset by one update. The final goldens require these wait-call arguments
and the still-active wait at busy clear, not just a relaxed hit-count bound.
None of the original failing assertions was changed.

All eight finish with native busy/latch 0/0 at updates 186/246, main active and
footprint intact, attacker active with HP 800, and auxiliary inactive with HP
800. No death, removal or footprint-cleanup entry executes. Full plane scans
at attack start find no auxiliary ID in ground, air or hidden occupancy,
including phases 1 and 3 when its native active slot is present. Native spawn's
team-8 branch `0x41b3d1 -> 0x41b488` skips spatial registration. This is evidence
against a direct auxiliary candidate in this fixture, not a fabricated air cell
and not proof of immunity to every area-effect path.

### Coordinated Death Component And Exact Blocker

On a native collision result, the probe resumes at `0x442775` and executes the
actual call at `0x442877 -> 0x441930`. Native lethal damage calls death entry
at `0x441ae9`, then removal `0x434d48` at `0x441af2`. Reserved-ID removal calls
`0x4453a8` at `0x434d5b`; it validates footprint ownership, clears cells and
resets the applicable producer queue. Death entry clears colony HP at
`0x416392` and recomputes eligibility. None of those calls clears construction
busy/latch or cancels the auxiliary continuation.

With source weapon 1, matrix class 0 versus building armor class 9 gives four
HP damage per impact. The two phase-3 component cases batch 600 impacts before
the next outer dispatch. Both reproduce these **asserted component results**:

- HP and colony HP become 0; all four footprint cells become 1023.
- Exactly one death entry, removal and footprint cleanup execute natively.
- The departure auxiliary completes and unregisters with status 1 / HP 800.
- Its `0x4187a0` writes word 4 into the parent's replacement death task, rather
  than a construction task. Death eventually reaches word 150 and unregisters.
- At update 513, main status 0, both active slots -1, busy 0, latch 1.

**This is not accepted as a faithful reachable stuck latch.** The fixture has
not executed legal weapon launch/rate-of-fire scheduling, and it skips the
effect-profile selection at `0x442750..0x442775`. Batching 600 collisions is
not proof that lethal damage can arrive within the departure interval through
real command flow. Source blast profiles and real auxiliary spatial occupancy
are also missing, so area-effect death and legal auxiliary death remain open.
The JSON marks both cases `componentGolden: true`, `accepted: false`, with
this blocker; it does not silently bless the retained latch.

The timed check above closes weapon-1 launch/effect/collision timing, but does
**not** make these two batched death components reachable. One source trooper
does only 4 or 12 damage by normal release; it cannot reproduce their lethal
2400-HP transition in the tested interval. No coordinated cancellation owner
has been established. Do not invent a latch clear, refund, auxiliary kill or
generation check and label it native parity.

### Unresolved Branch And Required Original-Game Reference

The precise unresolved branch is a **reachable lethal impact while the main
still owns construction phase 3 and the departure auxiliary is active**:
`0x442877 -> 0x441930 -> 0x441ae9/0x416308 -> 0x441af2/0x434d48`, followed by
the auxiliary's `0x4187a0` parent-task write and subsequent real game updates.
Does an unmodelled later owner release `team+0x19aa`, or does the original game
retain the component counterexample's latch? The timed nonlethal runs cannot
choose between these outcomes. Area-effect `0x441bec -> 0x44219b` is separately
unresolved and must not inherit the direct-hit guard result.

Required reference: an original-game save plus deterministic input replay (or
debugger trace) using the pinned executable and source tables, for each race,
with science-building construction and legally accumulated lethal fire during
departure. Capture the source units' types, weapon levels, HP, active slots,
coordinates, cooldown tasks, projectile/effect records, actual occupancy and
visibility, and the damage history from source HP. Do not lower HP or inject
death/status/task state to manufacture the transition. If such a direct-fire
setup is unreachable, provide the original attack/target rejection trace and
a source-backed area-weapon attempt instead; a video alone cannot settle the
internal latch or occupancy branch.

At the last nonlethal update, lethal impact, auxiliary continuation, and through
death unregistration plus subsequent ordinary updates, record entity/colony HP,
busy, latch, active IDs, construction/death task words, all footprint planes,
and write PCs. Also attempt the next ordinary construction order after death
to establish whether a later owner recovers the latch. No such original-game
reference was available or executed here. **Combined acceptance remains red.**

## Bounded Owner Contract

The normal-path evidence supports implementation of these responsibilities,
but **not shipping an interruption-capable production workflow yet**:

1. Own main reserved identity, construction task storage, team latch, slot busy,
   and reserved auxiliary identity together. Keep HP/status distinct from
   readiness and active-list membership.
2. Resolve real source STAND and BUILDSTAND/BUILD banks across ANIM.DAT's FIN
   registry. Apply native signed field2 conversion and byte countdown semantics.
   Initialize frame/countdown to zero on bank/mode change.
3. Preserve the counter <=3 fallback. With a real construction bank and counter
   >3, acquire the latch and execute the auxiliary arrival before mode-1 BUILD.
4. Advance native animation before task dispatch; honor immediate continuation
   returns and active-ID traversal. Unregister auxiliary after its continuation,
   even though status is still 1.
5. Clear busy on main mode-2 completion at phase 2; enter phase 3 and dispatch
   departure while retaining the team latch. Release the latch only after the
   auxiliary has advanced parent phase to 4 and main executes that phase.
6. Queue native idle-order requests without replacing construction task storage;
  consume them through normal final reset. This is not an active cancel/refund.
7. Apply direct-collision busy-building and team-8 guards only to that caller;
  do not assume the area-effect caller has the same guards.
8. Keep supported interruption blocked until a legal launch/death flow and
  main/aux cleanup ordering are proven. The observed death/removal pair owns
  colony HP and footprint, but does not establish construction latch cleanup.
  Do not equate successful parsing, HP presence,
   animation completion, or busy clear with complete construction acceptance.

Blocked exits, population, refunds, harvesting/deposits, active deletion through
its real caller, enabled audio/rendering, UI transactions, and campaign wiring
remain separate unaccepted gates. No ordinary-input mission or production win
is claimed.
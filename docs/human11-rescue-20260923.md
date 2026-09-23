# HUMAN11 Rescue: Recalled Attempt

## Tactical Bottleneck Continuation

2026-09-23. One continuation from the healthy tick12398 checkpoint is recorded
under `/tmp/dc-h11-tactical-20260923-1790190672339`.

**Actual outcome: BOUNDED_NO_WIN, tick17895, outcome null, no runtime diagnostic.**
Original TORT losses remain7/7. Trip13 did not fire; there is no pending/ready
WIN and no proof was launched. Commander1 remains alive, idle, 99 HP at
(124,128). Both ordinary survivors died. This is a tactical failure, not a
runtime blocker or a claim that the mission is unwinnable. No retry followed.

| Actual event | Observed result |
| --- | --- |
| Enemy44 killed | tick12556, eight REAP shots / damage800; return damage99 |
| Enemy53 killed | tick12706, eight REAP shots / damage800; return damage99 |
| Enemy58 killed | tick13067, eight REAP shots / damage800; return damage352 |
| REAP5 killed | tick13696 at (28,87), enemy35 dealt three shots / damage225 |
| REAP6 killed | tick15704 at (26,91), enemy35 dealt eight shots / damage600 |
| REAP6 return fire | ten shots / damage500 against enemy35; one damage100 shot against enemy103 |
| Enemy35 final state | type12, team2, alive300/800 HP, idle near (26,93) |
| Commands / shot events / deaths | 35 / 96 / 5 |

Enemy35 has range9, cooldown30, damage75 against REAP; REAP deals50 against
its class4 defense. The first calculated duel succeeded, but it did not cover
the whole route. Later ordinary waypoint orders entered fog while this
long-range defender could fire. At tick13660 the driver still ordered REAP5
toward (26,93), an unseen destination. Once enemy35 was visible to REAP6,
the driver rejected an unexposed route and the remaining exchange, but did
not escape its range; autonomous attacks continued until REAP6 died. The
policy also permanently excludes the commander as a runner, even after all
ordinary troops die. These are limitations of this attempted tactic, not
evidence that every legal combat/distraction or commander option is exhausted.

Final exact serialized state:
`/tmp/dc-h11-tactical-20260923-1790190672339/checkpoint.json`, SHA256
`743f9b487f8f5c126ff96d8dde40cc74a23d39de476cb34898305287c1a84e32`.
The original healthy tick12398 input remains unchanged, SHA256
`dba30673b1febcffa11c69f2295faf54d7795c59f25be6cd44ef07d89793d1b8`.
Full ordinary restore and exact initial equality took233870ms; stepping and
final artifacts took167833ms. Launcher total404284ms, below18 minutes.
Worker94928 exited0; supervisor94927/launcher94926 exited with nonacceptance,
not runtime failure; all three are reaped. Runtime/source/fetched assets stayed
unchanged. Controls plus actual-artifact checks passed16/16 in
`artifact-tests-1790191115959.log`; `final-audit.json` contains the final state
and receipts. Passing evidence checks does not mean mission acceptance.

The checkpoint has commander1 at (124,128), 99 HP; REAP5 at (74,67), 734 HP;
REAP6 at (127,128), 547 HP; and visible hostile type8 enemy44 at (67,67),
800 HP. REAP range2 cannot kite enemy range4. Both cooldowns are 15 ticks.
The runtime's unchanged `calculateLegacyDamage` gives REAP-to-type8 damage100
and type8-to-REAP damage11: eight stationary shots can clear this defender.
The QA estimate includes the complete approach, current own cooldown, a
20-tick planning margin, an immediate enemy shot and rounded-up return volleys.
It authorizes combat only with at least150 HP left by that estimate, and rejects
zero damage or unsupported damage profiles. It is a planning bound, not a
guarantee about future visible threats, movement or actual outcome.

The runner first tries an unexposed source-grid route. When none exists, it
may approach a currently visible compatible hostile through its range, using
the actual engine path and excluding other visible threat ranges and static
obstacles. In-range public assault is allowed only after ownership, visibility,
hostility, cursor, source compatibility and Manhattan distance checks. The
other ordinary guard can attack an in-range visible blocker under the same
survival check. Commander guard and all pending-WIN guards remain protected;
there is no commander extraction fallback. Historical death cells are no
longer permanent walls after the current threat is removed. No allied/enemy
orders or combat effects are injected.

Pre-play controls: 12/12 passed, scoped strict TypeScript passed:
`/tmp/dc-h11-tactical-controls-a3.log`, `/tmp/dc-h11-tactical-types-a3.log`.
Restore/initialization allowance600s, play/artifacts180s, proof600s; shared
supervisor cap1070s, outer cap1075s. Proof starts only if its entire allowance
fits the shared cap; otherwise pending/ready saves and post-pending orders
remain available for separate verification. No second forward attempt is
authorized or launched. Only the H11 harness, its tests and this document are
edited; Node only, no agents, browser, full suite or source/runtime changes.

## Latest Exact Resume: Living Force, Guarded Bottleneck, No WIN

2026-09-23. One bounded continuation restored the entire unchanged tick6974
checkpoint from `/tmp/dc-h11-third-actual-1790189063362/checkpoint.json`.
The independent original H11 loader hash matched
`19a89ee0fd016e7ee7a9c46568e1356f6d4c6ea0ab5c7afce6133af676899765`;
ordinary `MissionView.restore` completed full authentication and exact whole-view
equality before any player input. Restore took 133841 ms. The current runtime's
source-authentication addition did not reject or alter this valid mission/save;
this is an H11 observation, not a claim about every canonical mission.

**Actual result: BOUNDED_NO_WIN at tick12398.** Original trip13 remains
unreached, no pending/ready outcome exists, and no proof worker was launched.
The new latest healthy whole checkpoint is
`/tmp/dc-h11-resume-20260923-1790189900405/checkpoint.json`.
The original tick6974 file remains byte-identical, SHA256
`5252a72c411b62c0d741d48ced00e886f71d2366b2c1e2ec39472fdd4c7a4f59`.

| Measurement | Exact-resume result |
| --- | --- |
| Original TORT losses | 7/7, unchanged |
| Commander1 | Alive, 99 HP, unchanged cover (124,128) |
| Ordinary REAP5 | Alive, 734 HP, moved from (112,117) to (74,67) |
| Ordinary REAP6 | Alive, 547 HP, unchanged cover (127,128) |
| Public moves / shots / deaths | 11 / 0 / 0 |
| Step and final-artifact time | 167166 ms, within 180000 ms allowance |
| Worker / supervisor / launcher | 84265 / 84264 / 84263, all reaped |
| Conditional exact WIN proof | Not started; 300000 ms allowance unused |

The driver now accepts explicit `--resume=/absolute/path/checkpoint.json`,
refuses output reuse, authenticates with the independent loader and requires
exact initial equality. It never edits the input checkpoint or source identity.
Resume has a 140000 ms restore allowance plus 180000 ms stepping/artifact
allowance; the existing conditional proof cap remains 300000 ms. One run only
was launched, with no fresh opening, second continuation or cold replay retry.

For this continuation, REAP5 received short public move commands whose actual
engine paths were checked against visible hostile ranges and two-cell exclusions
around the three previous runner deaths. Safe queued paths were allowed to
finish, not reset every planning cycle. Commander and REAP6 stayed under the
existing guard policy, which also applies during pending WIN. That pending
protection was not exercised here because no WIN trigger fired.

At tick7860, REAP5 exposed **team2 type8 enemy44 at (67,67), 800 HP,
weapon range4**, across the six-cell-wide approach. It stopped at (74,67),
outside fire range, and remained there until the bounded attempt ended.
`terminal-obstacle-audit.json` checks every original trip13 destination against
the final source navigation grid: 21 passable destinations are reachable when
range exposure is permitted (shortest path121 cells), but **zero are reachable
while excluding the enemy's actual Manhattan radius4**, even with all historical
danger exclusions removed. Radius3 still permits all21. Therefore the blocker
is not merely the QA's extra two-cell safety margin or a bad gate coordinate.
An unexposed walking bypass does not exist in this state. Progress requires a
different legal combat/distraction tactic or accepting runner exposure; neither
was attempted after the single-run budget. This does not establish that H11 is
unwinnable, nor that the 99-HP commander can safely clear the defender.

Artifacts: `/tmp/dc-h11-resume-20260923-1790189900405`, including exact resume
receipt, recorded waypoint paths/public commands, result, healthy final save,
integrity, process receipts and terminal-obstacle audit. Worker exited0 in
302661 ms; supervisor exited1 because mission acceptance is false, not because
of a runtime diagnostic. Runtime/source/fetched assets remained unchanged
through the run. The process audit found no remaining owned PIDs or groups.
Only the H11 driver, its tests and this document were edited; no runtime,
source/funds/health/fog modification, browser, agents or full suite was used.

## Third Tactic Reinvoked: Completed Bounded Progress, No WIN

2026-09-23. Exactly one fresh original H11 attempt ran through the unchanged
current [driver](../tools/qa/human11-rescue.ts), using the existing Node
NullCanvas fixture. **BOUNDED_NO_WIN at tick6974**, no source outcome and no
runtime diagnostic. This was actual gameplay, not the interrupted tick401
attempt, a modeled result, or a WIN acceptance.

Artifacts: `/tmp/dc-h11-third-actual-1790189063362`.
The worker completed normally in 226521 ms; its supervised receipt is
226702 ms, exit0, no signal. The supervisor completed in 226913 ms with exit1
because WIN acceptance was false. The configured play hard cap is 240000 ms;
the existing loop stops at 225000 ms to reserve 15000 ms for final artifacts,
or earlier on ready outcome/diagnostic, with an additional 40000-tick ceiling.
There is no tick241 cutoff. No gameplay retry or continuation was launched.

| Measurement | Actual third-tactic run |
| --- | --- |
| TORT killed | 7/7, seventh at tick3654 / 113352 ms |
| Original source gates | TRO1, TRO2, TRO11; neither trip9 nor trip13 fired |
| Commander | Alive, 99 HP at (124,128), unchanged after the seventh kill |
| Final survivors | Commander1, REAP5: 734 HP, REAP6: 547 HP |
| Public commands / shot events / deaths | 935 / 365 / 26 |
| Explicit attacks / explicit TORT attacks | 14 / 2; no explicit team3 attacks |
| Team0 / team1 / team2 / team3 losses | 3 / 7 / 11 / 5 |
| Final runner | REAP5 at (112,117), moving toward original trip13 |
| Pending / ready WIN / ready LOSS | None |
| Proof | Not started; conditional 300000 ms allowance unused |

The concrete strategy limitation is the unescorted chamber route. Original
TRSC2 died at tick2663 at (66,77); replacement TRSC3 died at tick4476 at
(67,70); replacement REAP4 died at tick6721 at (68,67). All three died in the
central approach before reaching the chamber at x9..16, y125..132. Trip9-first
was already the current tactic, not an untried alternative. The seventh TORT
death selected original TRO11 and switched the ordinary runner to trip13;
REAP5 replaced the third lost runner at tick6740 and remained far from that
gate when the budget ended. No route-blocked diagnostic occurred. Repeated
unescorted replacements consumed the available time and force; this is not
evidence that a different legal route or escort could not win. Original H11
has no player base, producer or funds to replace these losses.

Final checkpoint, seven-kill checkpoint, complete journal, source manifests,
integrity and exit receipts were recorded. No pending checkpoint exists, so
there is no pending-to-ready replay claim. `strategy-audit.json` records the
death positions and routing milestones. Pre-play controls passed 10/10;
post-play controls and actual-artifact assertions passed 15/15 in
`artifact-tests-1790189311856.log`. These validate evidence, not mission WIN.

Runtime, fetched assets, original sources and both QA files remained unchanged
across the recorded run and final audit. The loaded and final runtime manifest
SHA256 is `5f2cb68c6ca3d6dda756cbf4ab0591254540f26643a37817f4a25eb06f9abe8c`.
Worker59416 and supervisor59415 were reaped; the process audit found no
remaining members of their groups. A shared-terminal SIGINT appeared, but the
isolated groups and parent handlers preserved the full bounded execution.
Only this document was edited for this reinvocation. No runtime/source cheats,
health/funds/fog edits, agents, full suite or browser were used.

## Protected Commander Follow-up: Interrupted, No WIN Proof

2026-09-23. Only the rescue driver, its test and this document were edited.
The prior run has no periodic tick4076 save: its only checkpoint is ready LOSS.
It cannot legitimately resume before the commander's death. No hash guard was
bypassed or old save rewritten. One fresh Node/NullCanvas attempt was launched
at `/tmp/dc-h11-protected-1790188686062`; no second attempt was made.

The strategy now selects an owned ordinary infantry runner for original MTG
trip9 immediately, keeping the other five original units (including commander)
coordinated against TORT. If trip9 fires first, original TRO12 wins after seven
losses. If the seventh loss occurs first, only the ordinary runner switches to
original trip13. The commander is never an extraction fallback, even when no
troop survives. After the seventh kill, protected roles precede all attack logic:
public Stop at a safe position, or a local retreat selected from visible cells
using visible compatible threats. The same protection runs during pending WIN.
This policy is not a demonstrated guarantee that every chosen cell stays safe.

Pending public orders, including stops and blocked aiming/camera changes, are
recorded for exact chronological replay from the unmodified pending checkpoint.
Acceptance requires a living commander, actual ready source WIN and exact full
pending-to-ready save replay with matching hashes. A one-time seven-kill prefix
save is also enabled; no such prefix was reached in this attempt.

The shared terminal returned another task's output, followed by an interrupt
while recovering the real process status. The H11 worker and supervisor were
gone when checked. Its final persisted observation is **tick401 / 12599 ms**:
0/7 TORT killed, 104 public commands, no shots or deaths, TRO1 only, no outcome.
There is no result, final save, pending save, integrity-at-exit record or exit
receipt. `interruption-audit.json` preserves the last observation and file list;
it is explicitly **not** a runtime checkpoint or source-outcome proof. The
empty process receipt is `/tmp/dc-h11-owned-processes-a3.log`.

This is an interrupted attempt, not ready LOSS, bounded strategic failure or
verified WIN. The remaining gameplay obligation is the entire chamber/kill
choreography with commander survival, followed by the <=300-second proof.
The <=240-second play cap and conditional <=300-second proof cap are unchanged.
No further play was launched under the one-attempt constraint. After the
interruption, worker process groups were isolated and the bounded supervisor
was made resilient to shared-terminal SIGINT; that supervision change has not
been exercised by another gameplay attempt.

Pre-play focused controls and historical artifact checks passed; scoped strict
TypeScript checking was clean. These checks do not substitute for actual play.
Final controls passed **10/10**, including real process-group isolation of a
tiny non-game child: `/tmp/dc-h11-protected-final-controls-a8.log`.
Final scoped strict types are clean in `/tmp/dc-h11-protected-final-types-a7.log`.
The partial-journal audit passed in `/tmp/dc-h11-protected-partial-audit-a6.log`:
104 owned move commands, only ordinary troop2 routed to the chamber, commander
still at 800 HP, no fabricated checkpoint or WIN proof. These are evidence and
control checks, not acceptance of the mission goal.
No runtime, asset, funding, health, fog or source-gate edits, agents, full suite,
browser or external browser windows were used. The missing final integrity
receipt means this interrupted run cannot claim an unchanged runtime window.

## Previous Completed Result: Not Accepted

2026-09-23. **Seven of seven TORT killed, followed by original-source ready
LOSS. No ready WIN and no acceptance PASS.** One fresh six-unit attempt was
run, with no continuation/retry after it. The old 3/7 artifacts remain intact.

Latest artifacts: `/tmp/dc-h11-recalled-1790187944949`.
The latest driver remains [human11-rescue.ts](../tools/qa/human11-rescue.ts).
Only that driver, its [test](../tools/qa/human11-rescue.test.ts), and this
document were edited. Runtime, original sources and fetched asset hashes
remained unchanged throughout the sampled play window and final artifact audit.

### What Changed And Why

The old assault left the strongest unit, commander69 with 800 HP and range6,
idle at home while five troops split into separate prison engagements. It also
used Euclidean firing distances, while actual mobile combat uses Manhattan
distance; some alleged firing positions therefore required further movement.
Mobile fire requires stationary attack updates, not continued move orders.

The revised QA driver includes all six original units, uses Manhattan firing
positions, shares a visible focus, pauses advancing units for stragglers during
the prison approach, filters attacks by the source damage matrix, prioritizes
visible TORT, and retreats from perceived compatible threats when a genuine
range advantage exists. It refreshes dead static blockers and records damage
and death positions. Explicit attacks require ownership, visibility, hostility,
source compatibility and in-range attack cursor permission. No hidden attacks,
grants, resurrection, synthetic triggers or production were used.

### Actual Outcome

| Measurement | Recalled run |
| --- | --- |
| Play budget / actual worker time | 240000 / 222919 ms |
| TORT deaths | 7/7; last at tick4076 |
| Source progression | TRO11 enabled trip13; trip13 never fired |
| Commander after clearing, tick4201 | 428 HP at (104,122) |
| Commander death | tick7251, (5,113) |
| Final state | tick7457, ready LOSS, result1/reason2, original TRO10 |
| Surviving original infantry | id2: 800 HP at (31,91); id3: 200 HP at (31,99) |
| Commands / shot events / deaths | 1538 / 455 / 28 |
| Explicit attacks / TORT attacks | 25 / 5; zero explicit team3 attacks |
| Range-retreat orders | 126 |
| Team0 / team1 / team2 / team3 losses | 4 / 7 / 14 / 3 |
| WIN proof | Not started; conditional 300000 ms allowance unused |
| Worker / supervisor | 34532 / 34531, reaped; supervisor exit1 for non-PASS |

This is a demonstrated improvement from three to seven objective kills, **not
a mission victory**. Automatic combat also killed three team3 units; none was
an explicit selected target or claimed as owned/rescued reinforcements.

The extraction branch still moves survivors independently once all victims are
dead, bypassing prison-approach cohesion. The faster commander reached the west
route ahead of the infantry and died to accumulated defender fire before
trip13. Its final incoming hits included GRAY id30 (4 damage) and type12 id35
(29 damage). Thus the successful prison tactic did not establish a safe
extraction tactic. No second strategy patch or actual run was attempted.

The WIN condition is not merely seven losses: after TRO11, a team0 unit must
enter trip13. `S==0` permits ordinary infantry, but the independent TRO10
commander-death condition remains active and issued `bail 1 2` first. The final
checkpoint preserves ready LOSS; remaining infantry cannot reverse that outcome
through public orders, and no LOSS restore proof was requested or performed.

There is no replacement-production recovery: the literal starting roster is
commander69, two TRSC0 and three REAP2, all ground, each initially 800 HP; team0
has zero credits, no base/producer/collector and no original aircraft. The TRO
has no reinforcement or conversion grant. This explains the finite-force
constraint, not an inherent impossibility of winning with a better strategy.

### Verification

Six focused controls and scoped strict TypeScript checking passed before play.
Ten checks including preserved historical artifacts passed before the run;
ten actual artifact checks passed afterward. Test success validates evidence
and guards, **not mission acceptance**. The driver exits nonzero unless actual
ready WIN has an exact full pending-to-ready replay and unchanged sampled
runtime/assets. No agents, full suite, browser or external browser were used.

Logs: `/tmp/dc-h11-recalled-preflight-1790187933181.log`,
`/tmp/dc-h11-recalled-types-1790187894709.log`,
`/tmp/dc-h11-recalled-artifacts-1790188202834.log`.
The unique play log, result, checkpoint, journal, integrity, worker receipt and
supervisor report are under the artifact directory; its sibling
`-launcher-exit.json` records the 223218 ms supervisor run and non-PASS exit1.

## Historical Protected-Commander Attempt

2026-09-23. **No WIN. No demonstrated runtime blocker.** The single authorized
attempt reached the prison, killed three of seven team-1 TORT targets, and lost
all five assault units. The commander remained idle at (150,27), 800/800 HP.
This is a failed assault strategy, not another short startup result and not a
source LOSS: the mission outcome remained null.

Owned files: [driver](../tools/qa/human11-rescue.ts),
[tests](../tools/qa/human11-rescue.test.ts), and this report only. No runtime,
shared driver, scenario, generated asset, cost, health, alliance, AI, statistic,
or trigger-life edit was made by this work. No agents, full suite, browser, or
external Chromium was used. Rendering used the existing Node NullCanvas fixture.

## Actual Result

Artifact directory: `/tmp/dc-human11-rescue-owned-20260923-r01`.

| Measurement | Actual |
| --- | --- |
| Status | `BOUNDED_NO_WIN`, no runtime diagnostic |
| Final tick | 5584 |
| Worker wall time | 166308 ms, hard cap 180000 ms |
| Launcher wall time | 166514 ms |
| Commands / shot events / deaths | 210 / 239 / 15 |
| Explicit targeted attacks | 5, all against visible hostile team2 |
| Team1 losses | 3, all type88; four TORT remain at 5 HP |
| Team0 losses | 5: both type0 TRSC and all three type2 REAP |
| Team2 losses | 7 |
| Team3 losses | 0 |
| Fired source blocks | 1, 2; not 9, 10, 11, 12, or 13 |
| Commander | Unmoved at (150,27), 800 HP |
| Pending/ready WIN | Neither reached |
| Restore proof | Not started; conditional 300000 ms allowance unused |
| Worker / supervisor | PIDs 4625 / 4623, exit0, no signal; reaped |

The three TORT deaths occurred through natural combat acquisition, not an
explicit targeted TORT command. The driver approached reachable firing cells
but issued too few attacks and its nearby-enemy engagements split the force
around the prison. All five assault units died near (105..122,120..126).
No second attempt or checkpoint continuation was run during that historical round.

Every TORT had a reachable source-grid firing position for every assault unit
at initialization. No route-blocked event or runtime diagnostic occurred.
The evidence therefore does **not** support an unreachable-map, friendly-target,
counter-accounting, or startup blocker. It also does not prove the untouched
original executable's full rescue behavior or that this strategy could win.

## Original Semantics

The [briefing](../raw_cd/DC/SCENARIO/HUMAN/HUMAN11.TXT) requires locating P.O.W.s
and the artifact chamber, and explicitly orders extermination of soldiers
already under alien control. The [SCN](../raw_cd/DC/SCENARIO/HUMAN/HUMAN11.SCN)
contains these distinct groups:

| Team | Source race / color / AI | Roster and relation |
| --- | --- | --- |
| 0 | Human / 0 / 0 | Commander69, two TRSC0, three REAP2; all ground |
| 1 | Human / 0 / 4 | Seven stationary TORT88, source HP5; hostile to team0 |
| 2 | Alien / 2 / 4 | 84 original actors; source AI retained |
| 3 | Human / 0 / 0 | Eleven TRSC0 in the prison area; never explicitly targeted |

Same source color is not ownership or alliance. Team0's alliance row is all
zero. Team1 allies with teams2/3; team3 allies with teams0/1/2. The implemented
observer-row relation is asymmetric: team3 regards team0 as allied, while team0
does not have that reciprocal bit. This replay did not change that relation,
select team3, or claim its troops as rescued/owned reinforcements.

The [literal TRO](../raw_cd/DC/SCENARIO/HUMAN/HUMAN11.TRO) has two legal WIN orders:

1. Team0 enters trip9: disable TRO11 and enable TRO12. Seven team1 victim losses
   then satisfy `s(1,3)==7`, causing TRO12 `bail 0 1`.
2. Seven team1 victim losses occur first: TRO11 disables trip9 and enables
   trip13. A team0 unit entering trip13 then causes `bail 0 1`.

`s(1,3)` is the victim-team loss total, not the killer-team count, a rescued-unit
count, or a special type check. These seven source victims are type88.
`S` is the triggering team. Trip13's `(S==0)` does not require a commander or
artifact unit; tests evaluate it for types0,2,69. Ordinary-troop trip13 is a
legal source route, **not an actual success observed in this run**.

MTG IDs9/13 alternate across the chamber's cells at x9..16, y125..132; low six
tag bits are decoded with the original Y inversion. The driver planned to
clear the prison first and then move an ordinary troop onto an actual trip13
cell. It never injected a trip, changed trigger lives, or set a statistic.

No HUMAN11 TRO action changes alliances, calls `newtype`, or grants units via
`reinforce`/`reinforce2`. A hardcoded original-executable TORT rescue/conversion
is not established by this script inspection and is not claimed absent from
the original game. No such conversion was invented for this replay.

## Revision And Evidence

`source.json` records literal SCN/TRO/TXT/MAP/MTG/PTH hashes, parsed teams,
unit/weapon definitions and loaded mission hash. `play-before-spawn.json` and
`integrity.json` record the runtime manifest before module loading, at worker
entry and at completion, plus every fetched generated asset hash.
No differences were observed across those sampled boundaries. These are disk
revision receipts, not proof of atomic loading during concurrent edits.

The manifest hash sampled for this run and the final artifact test was:
`9b9164b2d883800778aa210166f9e93b18cfea384d38a59ba5c613ef7dfd64d7`.
`end-revision.json` contains the full current hash record, timestamp, and any
differences since play. Another agent owns A10 runtime changes; this report
describes the loaded/sampled revision, **not a stable-current runtime claim**.

Other evidence: `initial.json` has all source actors and 35 firing-route checks;
`journal.jsonl` records public commands, visibility/hostility permissions and
source firings; `checkpoint.json` is a final saved state, not a restoration
proof; `result.json`, `play-exit.json`, `run.json`, and the sibling launcher
exit receipt distinguish a completed worker from a mission victory.

## Verification

Eight focused tests passed, zero failures/skips:
`/tmp/dc-h11-rescue-final-r05-tests.log`.
Final scoped strict TypeScript checking passed for the driver and expanded
tests: `/tmp/dc-h11-rescue-final-r05-types.log` (empty error log, exit0).
Both completed check processes have exit0/no-signal receipts in
`/tmp/dc-h11-rescue-final-r05-receipts.json`. The play supervisor and worker
were also checked with signal0 and both returned `ESRCH` (no live process).

Artifact-only checks, without another mission run:

```sh
DC_H11_RESCUE_ARTIFACTS=/tmp/dc-human11-rescue-owned-20260923-r01 \
  node --import tsx --test tools/qa/human11-rescue.test.ts
```

The standalone driver refuses to reuse an existing output directory and has
one hard-capped play worker plus an optional hard-capped proof worker only
after actual ready WIN. It does not automatically retry a failed strategy.
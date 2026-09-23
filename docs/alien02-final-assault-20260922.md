# ALIEN02 Final Assault

## Verified WIN

Actual original ready WIN reached by r05 at tick32689, resultCode0/reasonCode1,
with original statistic `1,0,86 = 6`. Pending WIN was saved at32488, ready201
ticks later. Full guarded JSON pending restore and201-frame replay passed with
exact whole-checkpoint equality. The worker exited0, no signal, after652482ms
in its independent proof phase. No worker process group remained.

Expected and restored checkpoint SHA256 both equal:
`dd06165505d48ebabb8527b58bed88c4a7ff6ab794ee704bcb696d0e5b24a01d`.
Original mission source hash remains
`c0f75714432dcd1f06779303361997426f386984ce226f49e92a740646e6e003`;
original tick27000 source checkpoint hash remains
`dd2e3491de69ea997c2d9c5daf491eddedc5da0c1e6a88facb5a515f506cd137`.

Artifacts: `/tmp/dc-al02-finish-20260922-r05/` contains `pending-win.json`,
`checkpoint.json` (ready), `play-result.json`, chronological `journal.jsonl`
and phase `supervisor.jsonl`, plus `restored-ready.json`, `proof.json`,
`result.json`, `exit.json` and independent `acceptance-audit.json` (accepted).
Compact ready evidence:
`ready-evidence-1790141511486.json` in that directory.

Final focused gates: three tests passed and strict scoped TypeScript passed,
receipts `/tmp/dc-al02-winner-tests-1790141543184.log.exit.json` and
`/tmp/dc-al02-winner-types-1790141543184.log.exit.json`, both code0.
Only the assault QA driver, its test and this report were edited. This proves
ALIEN02 completion under the original-script browser-adapted MissionView,
with null-canvas rendering, not browser visual fidelity or the entire game.

R05 resumed the legitimately earned r03 tick29880 goal4/6 checkpoint. Its
authenticated restore took581seconds, and play took80411ms, independently
budgeted. Goal placement10/sim11 died32207, placement9/sim10 died32487.
The original TRO published pending WIN on the next frame,32488.
This continuation issued49accepted public orders,347shots and7deaths.
Ready survivors: collector50 HP800, commander51 HP34, infantry90 HP325 and
107HP250. No purchases, grants, health changes, enemy changes or fog changes.

The decisive QA correction was per-actor range-aware targeting: public direct
attacks only from within the actor's saved original weapon range, otherwise
public movement along footprint-aware routes to a firing position. This avoids
the generic direct-attack pursuit sending infantry across the northern turret.
Actors already inside the resource exclusion zone may route out of it. Nearby
defenders take priority over objective structures, preserving the assault force.

The preceding r04 continuation reached5/6 at30637 but lost its combat force
by30903, leaving the final objective145HP. It exited1 at30920. That failed
branch remains intact; r05 resumed the earlier viable r03 checkpoint instead.

## Latest Actual Attempt

The corrected r03 assault reached original statistic `1,0,86 = 4` at
tick29022. It issued210accepted public orders and recorded285shots/9deaths.
Stages0/1/2 were reached at27520/28360/28600. Objective placement8/sim9 died
at29022. The original six actors took the southern route; infantry108 died
at29051 and105at29763. Four survivors at29880: commander51 HP736, infantry84
HP400,90HP325,107HP250. Five defenders died before a final defender18 died
at29844. Credits remain150, no purchases or state grants.

The driver then falsely declared a700-tick route stall at29880 because it
only counted route shortening/objective deaths, ignoring ongoing combat.
The final force shot occurred at29843, only37ticks before the stop.
The QA-only correction refreshes progress on positive damage dealt by a
controlled combatant. Scoped strict types passed:
`/tmp/dc-al02-combat-progress-types-1790139801367.log.exit.json`, code0.
Continuation r04 uses r03's full guarded tick29880 checkpoint and keeps the
four cleared objective keys. Runtime, assets, HP, credits and enemies untouched.

Current winning proof paths additionally require exact original
`missionStatistics["1,0,86"] === 6`, alongside ready resultCode0 and whole
checkpoint equality. Focused controls pass:
`/tmp/dc-al02-six-objective-controls-1790140157661.log.exit.json`, code0.
The in-flight r04 started before this additional redundant assertion; its
persisted statistics must therefore also be inspected in the final evidence.

### Earlier R02 Order Failure

No WIN. Follow-up `/tmp/dc-al02-finish-20260922-r02` completed full guarded
restore in approximately 533 seconds, then advanced from tick27000 to tick32000
in 137.673 seconds. It recorded zero accepted move/attack commands, zero shots,
zero deaths, unchanged surviving force and 150 credits. Objective remains3/6.
The public initial stop command did run. Exit code1, no termination signal.

The journal exposed a QA selector defect: it repeatedly chose visible actor41,
team8, at13,51, the resource source excluded from clickable combat entities by
MissionView. The public assault cursor returned `blocked`, but the planner
returned early instead of issuing the flank movement. The running version also
had an old 5000-tick cap; its `stepping-budget` reason is misleading because it
stopped on that tick cap, not the 600-second wall budget.

The driver now falls through from rejected attacks to movement, preserves
strategy metadata for later continuation, and removes the arbitrary tick cap.
The r03 assault described above validated actual movement and objective damage.
The original checkpoint is the recommended retry point; replaying 5000 idle
ticks from the intermediate checkpoint has no tactical benefit.

The optional `--check-input` control initially failed three times trying to
locate a visible resource in a fresh mission (two at tick0, one at tick1).
That fresh-visibility assumption was removed. Its narrowed movement control
passed in `/tmp/dc-al02-input-check-20260922-r04`: original actor1 moved from
subcells17920,79360 to17920,78336 after a public `move` click and40frames,
ending tick41 with no diagnostic. This proves the shared click coordinates
and actual movement, not the late resource-rejection fallback.

All three focused regressions pass in
`/tmp/dc-al02-three-controls-1790139497160.log.exit.json`, code0: terrain
routes/source immutability, altered-proof rejection/worker cleanup, and
original public movement/worker cleanup. The corrected actual assault r03
completed at `/tmp/dc-al02-finish-20260922-r03`, exit1, followed by continuation
r04 at `/tmp/dc-al02-finish-20260922-r04`; no WIN claimed yet.

All four run/control workers and supervisors were reaped. Audit:
`/tmp/dc-al02-final-audit-1790139103570.json`. Original checkpoint SHA256 remains
`dd2e3491de69ea997c2d9c5daf491eddedc5da0c1e6a88facb5a515f506cd137`.
The first launch named r01 never started or created a log. The actual r02
output contains `checkpoint.json`, `play-result.json`, `result.json`,
`journal.jsonl`, `supervisor.jsonl` and `exit.json`. No pending WIN exists.

## Independent Phase Budgets

The follow-up driver reserves 900 seconds for authenticated restore, a full
600 seconds for simulation stepping, and a separate 900 seconds for the exact
pending-to-ready proof. Restore time is no longer subtracted from play time.
The supervisor gives stepping another 30 seconds only for final artifact
serialization; it does not extend the simulation loop. The worker runs in its
own process group, phase overruns receive SIGKILL, and the supervisor records
the reaped child's code/signal in `exit.json`.

The ready checkpoint and `play-result.json` are persisted before beginning
proof. An incomplete or unverified run returns a nonzero exit code. All
public-command, source authentication, fog and replay guards remain enabled.
The follow-up run is `/tmp/dc-al02-finish-20260922-r02`; its actual result is
recorded above. The older attempt below remains historical evidence.

The new [preflight regression](../tools/qa/alien02-final-assault.test.ts)
passed, checking all six original actor IDs, four continuous terrain routes,
excluded defense zones and byte-identical source checkpoint after execution.
Receipt: `/tmp/dc-al02-own-tests-1790138660752.log.exit.json`, code0.
The combined strict driver/test check was blocked by concurrent runtime
type errors in campaign-production at lines 434 and 458 (`number | null`
passed to `number | undefined`); no runtime changes were made here.
Receipt: `/tmp/dc-al02-own-types-1790138677430.log.exit.json`, code2.
The subsequent strict driver/test check passed, code0:
`/tmp/dc-al02-proof-types-1790138869596.log.exit.json`. This predates the later
input-control additions; those have no reported editor diagnostics but have
the execution failures described above.

Separate proof is available with `--proof=/absolute/path/to/assault-output`.
It reads the persisted `pending-win.json` and `checkpoint.json`, checks both
source hashes, fully restores pending, checks exact pre-initialize equality,
requires pending resultCode0, and replays exactly the observed tick difference.
It then requires ready resultCode0 and exact whole-checkpoint equality, writing
`proof.json` and `restored-ready.json` in its own `DC_FINAL_OUTPUT` directory.
The original checkpoint authentication and original TRO/SCN checks also run.

Both focused controls passed in
`/tmp/dc-al02-proof-guard-tests-1790138803356.log.exit.json`, code0: legitimate
terrain preflight and rejection of an altered proof source before restore.
The latter verifies separate 900-second phase allocations and that the failed
proof worker was reaped. This is negative-guard coverage, not a winning replay.

## Previous Result

No WIN. The single bounded play attempt was stopped after 417.462 seconds
inside authenticated restore, before any player command or simulation update.
The source checkpoint remains tick27000, objective3/6. This is execution-budget
exhaustion, not evidence that the southern strategy loses or that the force is
exhausted. Live enemy observations, live footprint route checks, combat, and
pending-to-ready restoration were not reached.

The child PID60701 was identity-checked before SIGKILL; its parent recorded
termination with signalSIGKILL. At the preceding observation it had consumed
6:26 CPU over 6:25 elapsed. A one-second system sample showed active V8
structured-clone serialization/deserialization and a 1.3GB footprint, not an
idle process. This sample does not identify exact TypeScript hot functions.
The strategy requires a successful authenticated restore within the total
budget before its tactical feasibility can be tested. No replay validation
was removed or bypassed to obtain a result.

## Scope

Independent QA driver: [alien02-final-assault.ts](../tools/qa/alien02-final-assault.ts).
No existing strategy, runtime, package, asset, main documentation, or browser changes.
This is an original-script browser-adapted MissionView attempt, not a full-game or
native-parity claim. Rendering uses the existing null-canvas source fixture.

## Starting Evidence

- Save: `/tmp/dc-m02-alien-win-SptQgw/checkpoint.json`, tick 27000.
- Checkpoint SHA256: `dd2e3491de69ea997c2d9c5daf491eddedc5da0c1e6a88facb5a515f506cd137`.
- Mission SHA256: `c0f75714432dcd1f06779303361997426f386984ce226f49e92a740646e6e003`.
- Original victory: `s(1,0,86)>5`; starting progress 3/6.
- Commander 51: 736 HP, cell 8,75, saved weapon damage160/range6.
- Infantry 84/90/105/107/108: 800/800/700/800/800 HP, near 14,50.
- Collector 50: 800 HP, cell 14,51; depleted source, left safe.
- Credits: 150. No purchase, resource grant, health edit, or hidden direct attack.
- Remaining mission-known objective sites: 88,55; 93,53; 89,51.

## Strategy

Commit all five surviving infantry and the commander. Stop the former assembly
orders and move through 30,65 -> 55,65 -> 78,65 -> 85,57. Do not wait for an
unaffordable eight-infantry force. Leave the collector out of the defended
3500-resource site at 65,54.

The preflight found terrain paths for all six combatants. The middle leg has 60
cells, not 25: the barrier requires a detour. Routes remain at least 11 cells
from 65,54 and more than 19 cells from turret 81,38 before the final approach.
The final point resolves to passable 86,57. Preflight does not establish combat
safety; live route planning also checks runtime static footprints.

Only current fog-visible hostile actors may become direct attack targets.
Mission-known sites may guide movement while hidden. Commands use public
selection, camera, order mode, cursor, and commandAt APIs. Death events identify
cleared objectives; actual original TRO statistics and outcome decide victory.

## Bounds And Verification

The play child has a 895-second hard SIGKILL cap. Stepping is limited to 600
seconds and 5000 ticks, reduced to reserve the measured restore duration plus
30 seconds for verification. A 700-tick route stall or loss of the combat force
also stops the attempt. Every order, combat event, progress observation, and
result is journaled chronologically.

A WIN claim requires original ready resultCode0 plus a JSON restore of the
actual pending-win checkpoint, replay through ready, and exact final checkpoint
equality. A serialized checkpoint alone is not a restore proof.

## Artifacts

- Preflight: `/tmp/dc-final-assault-preflight-a7/preflight.json` and journal.
- Route summary: `/tmp/dc-final-assault-route-summary-b2.json`.
- Scoped TypeScript check: `/tmp/dc-final-assault-types-a9.log.exit.json`, code0.
- Inspection attempt a2 was interrupted by shared-terminal SIGINT before play.
- Inspection a4 reached its 180-second restore cap; zero assault orders.
- Bounded play attempt: `/tmp/dc-final-assault-run-b1/`.
- Child exit receipt: `/tmp/dc-final-assault-run-b1.log.exit.json`.
- Explicit bounded result: `/tmp/dc-final-assault-run-b1/bounded-stop.json`.
- Chronological journal: `/tmp/dc-final-assault-run-b1/journal.jsonl` contains
	only the source-authenticated restore-start event; no assault orders.
- CPU sample: `/tmp/dc-final-assault-restore-sample-b6.txt`.

Preflight and scoped TypeScript checks passed. The complete assault command
loop and its winning-boundary branch remain unverified because restore did
not complete. The original script still requires the other three sites.
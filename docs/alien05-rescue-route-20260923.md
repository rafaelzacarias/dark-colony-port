# AL05 Single Bounded Rescue Attempt

## Latest Forward Continuation: Tick 16629, No WIN

Latest checkpoint:
`/tmp/dc-al05-detour-20260923-d03/checkpoint.json`

**The rescue is not finished.** Commander52 is at **(23,36)**, exact subcells
**(24236,37376)**, **257/800 HP**, tick **16629**. Trip8 is still live; trips10
and17 were not reached,18/19 remain disabled. There is no outcome or diagnostic,
and no pending WIN, so no900s proof worker was launched. The final checkpoint
was saved but not independently restored. Public Stop for52 is pending before
the next update; the saved actor still says `move` until that command executes.

### Actual Legal Play

One forward-only quicksave chain used three worker segments, with no rollback
or alternate branch. The initialization and play budgets were cumulative,
not reset on resume: **469,585.166ms initialization /500,000ms** and
**85,547.523ms play /300,000ms**. The remaining initialization allowance cannot
cover another approximately150-163s restore; no fourth segment was attempted.

| Segment | Exact Input Tick | Final Tick | Final Cell | HP | Public Commands | Init / Play Seconds |
| --- | ---: | ---: | --- | ---: | ---: | --- |
| d01 | 14370 | 14581 | (23,33) | 632 | 79 | 151.812 /8.025 |
| d02 | 14581 | 15402 | (25,37) | 262 | 14 | 154.479 /31.011 |
| d03 | 15402 | 16629 | (23,36) | 257 | 373 | 163.294 /46.511 |

Directories are `/tmp/dc-al05-detour-20260923-d01/`, `d02/`, and `d03/` under
that same prefix. Every input matched ordinary restore both before and after
initialization. The original14370 input and intermediate input saves remained
unchanged. Only owned commander52 was commanded through public selection,
Stop, Move and visible Assault APIs. No health, source predicates, visibility,
terrain, units or source script were changed.

- At14370 the first public command was **Stop**, cancelling the original
  unsafe move before the next advancing update; the following Move targeted
  (23,38) with an engine-A* checked segment.
- d01 exposed route reversal as different enemies became visible and ended
  on the200tick progress guard. The forward continuation retained safe route
  prefixes instead of reversing immediately.
- d02 produced visible damage against29,28 and27, but closing enemies caused
  **370HP loss**. Longer own range was not sufficient without retreating.
- d03 used checked standoff retreats, recorded **46 commander shots**, visible
  damage against27,6,5 and26, and lost5HP. Damage observations are not a kill
  census; other actors can also damage the same targets.
- Final visible hostile25 is at **(23,44),400HP,range12**. The commander has
  range6. The run hit a fractional-position waypoint reissue loop and the
  200tick progress guard. This is a QA planner limit, not mission impossibility.

### Complete Map Evidence

`d03/map-audit-fractional.json` is a read-only, post-run map audit. It contains
every reachable cell and frontier cell, all original trip8 goals, all checked
border cells, current visible-threat sightlines and the corrected next route.
It uses the actual fractional position **(23.16796875,36)**, known static
blockers and currently visible actors only.

- Safe component: **487 cells**, **155 frontier cells**, no trip8 goal.
- Terrain/known-obstacle component: **3,162 cells**, **1,051 frontier cells**;
  reachable trip8 cells are **(49,30),(49,29),(49,28),(50,28)**.
- All65 cells at **x44..48/y12..24** are impassable in the saved source grid.
  No invented northern/eastern waypoint was substituted for source terrain.
- No range6 firing cell can outrange the currently visible range12 hostile25.
  Engine combat uses Manhattan range without terrain occlusion; the report
  labels this explicitly instead of claiming a physical line-of-sight model.
- A safe **prefix** still exists: **(23,36)->(24,36)->(25,36)->(25,37)**,
  toward source goal(49,30). Its public engine A* was checked, but it was
  **not executed**. The full goal route remains guarded under this policy.

The earlier in-run `reachable-frontier.json` used integer-cell clearance;
the fractional audit supersedes its489cell safe-component count. The planner
now uses one fractional safety origin for route search, prefix retention,
retreat and queue monitoring. This last repair passed focused regressions
but was **not gameplay-retried** within the remaining initialization budget.

### Verification And Scope

Focused tests: **15 passed,0 failed,3 historical-artifact tests skipped**.
`DC_AL05_RESCUE_CURRENT` enables the original14370 terrain test;
`DC_AL05_RESCUE_CHAIN=/tmp/dc-al05-detour-20260923` verifies all actual segments,
input hashes, exact restores, public actor IDs, the first Stop, damage/shot
evidence, pending final Stop and cumulative budgets. Scoped TypeScript passed.

All runtime and fetched-asset integrity differences were empty. The three
supervisors/workers exited0 and were reaped; the final process audit found no
remaining rescue process. Exit0 means clean harness completion, not WIN.
Final checkpoint SHA256:
`ada2377ca390c65b03449c31ba33c944a6780f8a4fe33f5f3a9f1577b08fa5c3`.
Only this document, the rescue runner and its tests were edited. No agents,
full suite, live-browser changes or native-parity claim. NullCanvas execution
is actual browser-adapted MissionView simulation, not visual browser testing.

## Prior Corrected Continuation: Tick 14370, No WIN

Latest checkpoint:
`/tmp/dc-al05-rescue-source-route-20260923-c03-1790177290562/checkpoint.json`

The corrected planner uses authenticated controller lives, not the stale QA
`fired:[4]`. Trip 2 was already consumed; no replacement event was fabricated.
The first corrected source stage is **support-trip8**, not hostile trip 3.

- First command: tick **14230**, commander52 public Move to **(26,21)**.
- First observed cell advance: tick **14235**, **(26,17)**, support-trip8,
  **632/800 HP**, no visible hostile threat.
- Final: tick **14370**, **(25,33)**, subcells **(26112,34656)**, still632HP.
- Three public Move commands, only owned commander52: destinations(26,21),
  (29,30), (25,38). Existing movement was allowed to finish before replacement.
- Newly visible hostile **29**, team2, **(25,41)**, **800HP**, weapon range4.
  No safe public route or currently legal health-winning assault was found.
  This is a conservative QA policy blocker, not proof that the mission cannot
  be completed. The commander has range6 but was not yet in legal attack range.
- Current source goal cells: **(49,30),(50,30),(51,30),(49,29),(50,29),
  (51,29),(49,28),(50,28)**. Primary terrain route goal was(49,30).
- Trips8/10/17 still have life1; trip2 life0;18/19 remain disabled. No source
  rescue, extraction, pending WIN or LOSS occurred.
- Twelve living visible team5 allies remain around(20..29,18..20), not at the
  commander. They were never selected or commanded; no effective escort is
  claimed. Player commander52 maps to real source slot203/gen0/type73/GRAY;
  team7 has the authenticated type72/TRSC role but has not spawned yet.

**The final movement queue is still active:** pathIndex8, reservation3833,
next cell(25,34), final destination(25,38). No Stop was issued. Its remaining
path approaches the newly revealed hostile; do not blindly advance this save.

### Preflight Correction

One ordinary exact restore first exposed a second QA defect before any game
tick or command: all65 invented northeast goals at x44..48/y12..24 are
impassable in the saved original grid. Removing the north-only mask did not
make those goal cells passable. This zero-step preflight exited1 after150s:
`/tmp/dc-al05-rescue-continued-20260923-c02-1790176970437/`.

A cheap real-checkpoint terrain test then proved the original trip8 route to
(49,30), terrain-only next waypoint(29,25). The QA intermediate band was
removed. Actual restored public obstacles and visible allies refined the
first waypoint to(26,21), recorded in `planner-preflight.json` before play.
The subsequent single gameplay continuation advanced145ticks in4,298.550ms
and stopped immediately at the revealed hazard, not after a repeated300s
static stage. The200tick no-net-advance guard is covered by a focused test;
this run stopped before reaching it.

### Restore And Evidence

Input remained the original tick14225 checkpoint documented below. Both
ordinary `MissionView.restore(..., saved.view)` and `await view.initialize()`
matched the entire saved view exactly, hash
`f75af8ef0c0c6a458b09185e50d18a7222e54e6a5f4631cea46c594915385be0`.
No import/migration, replay-policy insertion, source edit or cold opening was
used. Gameplay-run initialization150,510.096ms; total156,223ms. Each restore
used the900s cap and play the300s cap; both initializations together were
approximately300.3s. No pending state exists, so no900s proof worker ran.

Loader shape is `{sourceHash, view, fired, commands, steppingMs, stage, blocked,
planner}`; only `view` goes to ordinary restore after
`authenticateMission05Resume(mission, saved)`. Source lives are at
`view.session.state.controller.runtime.lives`. Preserve the absent
`view.session.replayPolicy` marker. `fired` is historical QA metadata, not the
source of stage truth. The driver remains pinned to input tick14225; a future
resume must explicitly change that guard and input, not silently cold-start.

Final file SHA256:
`6aa20663191133c8b5b4879e4d05a7798113d64d506177056dfd45609dd21319`.
Final whole-view SHA256:
`5891b49694a2f1c2822719045c9ac468b04a6708c55f0ceb7d07707a82bd1b4b`.
The final14370 checkpoint was saved, **not independently restored**.

Artifacts include `initial-restore.json`, `initialized-restore.json`,
`planner-preflight.json`, `first-stage-progress.json`, `journal.jsonl`,
`checkpoint.json`, `result.json`, `integrity.json`, `exit.json`, and
`final-audit-c03.json`. Runtime/asset differences[], input/source identity
unchanged, policy marker still absent. Both preflight and gameplay launchers,
supervisors and workers were reaped; final owned active/alive lists[].
Only this QA driver, its tests and this existing document were edited.
No main/H05/runtime/assets/funds/health/fog/source changes, agents, fullsuite,
browser visual verification or native-parity claim.

Focused controls use `DC_AL05_RESCUE_INPUT` for the real terrain test,
`DC_AL05_RESCUE_ARTIFACTS` for the historical run below, and
`DC_AL05_RESCUE_CONTINUATION` for the new continuation evidence.

## Prior Result: Tick 14225

One actual continuation, no retry: **no source WIN or LOSS**. The commander
escaped north and triggered original support trip 2, but a new QA journal-cursor
defect prevented the planned eastward continuation. This is a driver failure,
not evidence that the rescue route is impassable.

Exact progress save:
`/tmp/dc-al05-rescue-actual-20260923-r01/checkpoint.json`

- Tick **14225**, commander **52**, cell **(26,16)**, subcells **(27052,16896)**.
- **632/800 HP**, activity `move`, queued path `(25,16) -> (26,16)`, index 1,
  reserved destination 1818. No public Stop was issued at finalization.
- Recorded QA stage `support-trip2` is stale. Source trip 2 lives changed 1 -> 0;
  trip 4 was already consumed. Trips 8/10/17 remain live; 18/19 remain disabled.
- Twelve living team-5 allies are visible near (20..29,18..20). They are allied,
  not player-owned; only the commander is selectable as owned.
- First periodic observation of allied support: tick 4200. Exact activation
  tick was missed and is not claimed.
- No pending WIN exists, so no pending-to-ready proof was run. Final checkpoint
  was saved but not independently restored. Initial restore was exact.

Checkpoint file SHA-256:
`014b0d33a830ca794159f764c1b2409fa852cd5fd85aae64f211ef0af60eef65`

Whole final view SHA-256:
`f75af8ef0c0c6a458b09185e50d18a7222e54e6a5f4631cea46c594915385be0`

## Plan And Failure

Original briefing asks for PETRA-7 scouting to obtain Roswell Taar assistance.
Original TRO trip 2 releases 13 team-5 infantry. Its MTG cells lie at
(25..29,12..16), immediately north of the input commander. Trip 3 instead
reinforces hostile teams; it was not treated as support. Intended stages were
trip 2, northern/eastern passage around x44/y12..24, support trips 8/10,
rescue trip 17 near (76,45), then extraction trip 18. The failed southern
approach around (25,39) was excluded.

First public move at4091 targeted (25,16). The route used source terrain and
only currently visible threats, with checked public waypoint paths. Direct
assaults required visibility, `canAutoTarget`, actual Manhattan weapon range,
and a calculated surviving-health reserve. No hidden enemies were commanded
against; the eastward passage and rescue stages were never reached.

The public session journal is a bounded ring. The new driver tracked array
length, which stopped changing after rollover, and missed the trip-2 event.
It repeatedly alternated (25,16)/(26,16), issuing997 public commands across the
attempt. The commander lost96HP. An earlier live update suggesting no further
damage was incorrect. Final combat/death arrays are not cumulative counters;
their length deltas in the audit do not prove zero shots or deaths.

After the process exited, only the new QA driver was corrected to track
`cycleCounter`, with a rolling-journal regression and a reached-trip stall
guard. This corrected revision was tested but **not gameplay-retried**.
The raw wrapper's `fired:[4]` and stage remain untouched as actual evidence;
future continuation must use authenticated controller state, not that stale
QA metadata. Do not replay or force support predicates.

## Bounds And Integrity

Input was unchanged:
`/tmp/dc-al05-visible-current-1790167187850/alien/checkpoint.json`, tick4091.
Both ordinary restore and initialized restore exactly matched whole-view hash
`740ac8c3ffbe94f53349529ee43ef47ea40083c298d288d34b3e39cc144ca59c`.

Initialization41,428.979ms within100s; play290,004.970ms within300s.
Supervisor elapsed332,837ms; exit0 indicates clean harness completion only,
not WIN. Checkpoints were written every100ticks and at the final stop.
Supervisor40713 and worker40714 were reaped, no deadline expiry or signal.
Final audit found no owned active process. No proof worker was launched.

Runtime changes[], fetched-asset changes[], input and source identity unchanged.
Existing mission05/H05 runner and proof files were not edited. No runtime,
assets, funds, health, fog or source predicates were modified; no agents or full
suite. This was real browser-adapted MissionView with NullCanvas, not browser
visual verification or native parity.

Artifacts are in `/tmp/dc-al05-rescue-actual-20260923-r01/`:
`source.json`, `initial-restore.json`, `initialized-restore.json`,
`journal.jsonl`, `checkpoint.json`, `result.json`, `integrity.json`,
`exit.json`, and `final-audit-a1.json`. The audit distinguishes the driver
hash loaded during play from its post-run corrected revision.

Implementation: [alien05-rescue-route.ts](../tools/qa/alien05-rescue-route.ts).
Focused controls: [alien05-rescue-route.test.ts](../tools/qa/alien05-rescue-route.test.ts).
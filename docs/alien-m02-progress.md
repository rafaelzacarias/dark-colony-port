# ALIEN02 Tactical Continuation

## Starting Evidence

The legitimate reservation-fixed run at
`/tmp/dc-m02-alien-win-H63tB1/checkpoint.json` stopped at tick 13000 with
0/6 original type-86 goals destroyed. Its adjacent journal reports 10655
earned, 9450 spent on 27 infantry purchases, and 1205 credits. No victory
or loss was pending. The checkpoint is used directly, not a repeated cold run.

The final snapshot has six healthy player infantry (84, 90, 91, 92, 93, 94),
collector 50 at (14,51), and commander 51 at (8,75), health 736.
Infantry positions are respectively (20,48), (15,49), (14,52), (14,48),
(16,47), and (29,53). The saved expedition is empty. Enemy 32 at (17,47),
health 338, is attacking infantry 92. All six goals remain intact:

| Goal | Position | Health |
| --- | --- | --- |
| placement:8 | 88,55 | 250 |
| placement:9 | 93,53 | 250 |
| placement:10 | 89,51 | 250 |
| placement:13 | 26,22 | 300 |
| placement:14 | 24,18 | 300 |
| placement:15 | 32,15 | 300 |

Eighteen hostile mobile actors and one hostile armed static (12 at 81,38,
health 800) survive. Resource reserves total 7345: 3845 at placement:42,
where the collector is extracting, plus 3500 at placement:41.

## Tactical Diagnosis

The late journal shows repeated four-unit sorties toward placement:13.
From ticks 11780 through 12320, their waypoint repeatedly advances toward
(26,21), while the force is strung out. The route was computed from the
soldier closest to the destination. At 12380 the survivors are retargeted
to visible escort 32; at 12500 the sub-four expedition is recalled to the
collector. This pattern destroys progress without destroying a goal.

The collector reserve also inhibits reinforcement: at six infantry and
1205 credits, the old purchase policy refuses another 350-credit infantry
purchase despite the healthy extracting collector. Merely raising the
desired army does not bypass that gate.

Scout orders already use passable approaches around resource footprints;
the final collector has an active extraction order, so resource scouting
is not the immediate 13k blocker. No visibility repair or hidden-target
attack was added.

## QA-Only Changes

Changes are confined to
[the strategy fixture](../tools/qa/fixtures/browser-campaign-playthrough.ts),
[its strategy tests](../tools/qa/browser-campaign-playthrough.test.ts), and
this document. The requested top-level fixture filename does not exist.

- Assemble at least eight expedition troops with two economy guards.
- Start protecting collector replacement funds after ten infantry, not six;
  a missing collector still takes purchase priority with all public gates.
- Keep an existing expedition while at least two members survive.
- Compute the next public assault waypoint from the rear soldier.
- Prioritize nearby currently visible objective actors over escorts. Hidden
  or distant objectives cannot become direct attack targets through this rule.

Sixteen strategy controls pass, including original source victory/loss
contracts, legal production, scout approach, reserve guards, group membership,
rear routing, and visible-goal priority. Log:
`/tmp/dc-alien-m02-strategy-1790133374729.log`.
Scoped strict TypeScript and editor diagnostics report no errors.

## Original Loader Continuation

The unchanged original-loader harness ran with `DC_M02_RESUME` set
to the tick-13000 checkpoint, `DC_M02_REQUIRE_OUTCOME=WIN`, rendering disabled
except the harness's final sample, and restore verification enabled.
The simulation allowance is 600 seconds; the process cap is 900 seconds to
leave time for checkpoint restoration. Log:
`/tmp/dc-alien-m02-resume-1790133395841.log`.

The checkpoint was accepted. The first public purchase at tick 13000 costs
350 from the real 1205-credit balance. An eight-infantry expedition
(91 through 98) starts goal-directed orders at tick 13840. At view tick
15462, infantry 91's real shot kills target 14 (placement:13 at 26,22),
with combat tick 15461. The original objective reaches 1/6. At tick 16000,
the collector and commander remain alive with eight infantry, but the
first wave has suffered heavy losses and replacements are regrouping.
Income is 12905, spending 12600, and credits 305. This establishes actual
progress from the checkpoint, not a ready victory.

**Result: FAIL, no ready WIN or LOSS.** Simulation stopped at tick **18000**
with the QA diagnostic `QA wall-clock deadline exceeded (600000ms)`.
The actual view checkpoint has **no runtime diagnostic** and null outcome.
The final original objective is **1/6**, not a victory.

| Final Accounting | Value |
| --- | --- |
| Earned / published | 14405 / 14405 |
| Purchases / spent | 39 / 13650 |
| Credits | 755 |
| Remaining source reserve | 3595 |
| Cumulative shots / deaths | 1798 / 65 |

The final collector is extracting the last 95 units at placement:42.
Placement:41 at (65,54) retains 3500, near the intact eastern enemies.
Only 12 additional infantry purchases were made during this continuation.
The original six raw source hashes and loaded mission hash match the starting
run; the loaded strategy hash matches the tested file. Provenance check:
`/tmp/dc-alien-m02-provenance-20260922-r11.log`.

## Final Force And Obstacle

The saved tick-18000 checkpoint, not an extrapolated strategy estimate, contains:

| Player Role / ID | Position | Health |
| --- | --- | --- |
| Collector 50 | 14,51 | 800 |
| Commander 51 | 8,75 | 736 |
| Guard 84 | 14,50 | 800 |
| Guard 90 | 15,51 | 800 |
| Expedition 99 | 18,47 | 300 |
| Expedition 100 | 20,48 | 800 |
| Expedition 101 | 23,48 | 800 |
| Expedition 102 | 22,48 | 800 |
| Expedition 103 | 18,46 | 800 |
| Expedition 104 | 16,46 | 800 |
| Expedition 105 | 15,48 | 800 |
| Expedition 106 | 25,47 | 800 |

Five goals survive: (24,18), (32,15), (88,55), (93,53), (89,51).
Fourteen enemy mobiles remain: two northern defenders at (30,17)/(30,18),
four patrols around (62..67,52..55), six around the eastern goal cluster,
and two at (83,39)/(85,37). Armed static 12 at (81,38) still has 800 health.
This census is report-only; the strategy does not receive hidden enemies as
legal direct targets.

The reserve gate was a real recruitment blocker, and the larger wave killed
a real goal. It did not solve sustained assault. The first wave was largely
lost; rebuilding and rallying the second consumed most remaining simulation
time. At the final save eight expedition soldiers are still far south of
the northern goals. Its last public waypoints remain around (19,47), with
purpose `source-objective:placement:13`, although that site is dead.
The saved `cleared` list is empty: clearing requires a later visible-site
scan, which the combat branch can defer. Rear-based routing and goal
priority therefore remain only a partial improvement, not a demonstrated
winning policy. No additional untested tactical change was applied afterward.

## Save And Timing Limits

Artifacts: `/tmp/dc-m02-alien-win-cXh7TF/` contains the journal,
result summary, and parseable **tick-18000 checkpoint** with strategy state.
This is the latest legitimate continuation candidate; do not repeat the
cold 13000 ticks. Compatibility restoration of the starting checkpoint
succeeded, but exact round-trip verification of the final checkpoint did
**not** finish. No pending victory occurred, so there is **no pending-to-ready
exact restore proof** and no claim that the fullgame judge passes.

The configured 900-second `spawnSync` timeout sent SIGTERM while the harness
was restoring the final save. The child did not exit on that signal and was
identity-checked and force-killed. Actual total duration was **928.264 seconds**,
so the requested 900-second total cap was **not met**. Exit record:
`/tmp/dc-alien-m02-resume-1790133395841.log.exit.json`.
Both owned parent and child are confirmed absent in
`/tmp/dc-alien-m02-closed-20260922-r14.log`. No retry was launched.

Only the QA fixture, its strategy tests, and this document were edited.
Runtime, source files, health, money, counters, fog, and enemy orders were
not edited. This is original-loader Node/NullCanvas evidence, not browser
pixels, native timing parity, or complete campaign acceptance.

The earlier 4/6 run in
[the endjudge report](m02-endjudge-20260922.md) is historical evidence only;
it is not a successful result for this policy or checkpoint.
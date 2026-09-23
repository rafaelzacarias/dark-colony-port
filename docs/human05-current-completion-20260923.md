# Actual H05 Current-Policy Attempt

## Latest Continuation: R04 Source Loss

The fresh continuation from the verified tick-12087 wave ended in **SOURCE_LOSS**,
not WIN, at tick 16321 (`resultCode:1`, `reasonCode:2`, `ready:true`). Original
trigger 2 fired at source cycle 16120 after both player buildings were destroyed.
The barracks was observed destroyed at tick 14537. No runtime diagnostic occurred.

No additional city destruction goal completed: team 2 remains fully destroyed;
team 1 slots remain `4800,2400,3600,3600,0`; recovery triggers 18 and 17 and exit
trigger 15 never fired. There WAS partial combat damage: simulation target 37,
source `colony:17` / slot 17 / type 19 at (41,26), ended at 1388/3600 HP, a real
2212-HP reduction. The source entity health and buildingSlots still show 3600;
those source projections must not be interpreted as per-shot simulation health.
The final state retains ten infantry, the original collector and 2198 credits,
but is terminal and is NOT a healthy continuation.

Latest terminal artifact:
`/tmp/dc-h05-current-city-r04-1790169816005/human/checkpoint.json`.
Its whole-view SHA-256 is
`eeb265948c33bc20d5e25ab2ff960f3794e7fb74bbd5e7a83bcdc09766b3d026`.
Ordinary restore AND initialization were exact, including current-policy marker,
with no differences. This is a LOSS roundtrip, not pending-to-ready WIN proof;
neither `pending-win.json` nor `proof.json` exists.

The latest verified nonterminal input remains unchanged:
`/tmp/dc-h05-current-wave-r03-1790168693048/human/checkpoint.json` (tick 12087).
Do not resume the terminal r04 save for progression. R04 also has intermediate
`healthy-*.json` snapshots, but they have not had independent exact roundtrip
verification and must not be substituted for a proven healthy checkpoint.

H05-only QA changes filter visible direct and defensive targets through the
existing `simulation.canAutoTarget` projection. Alien tactics and runtime were
not edited. Assembly/flank/assault gates remained intact: flank at tick 13937,
assault at 14087. This target filter is insufficient to win: the army damaged
the original type-19 city building while the player's base was lost. A future
attempt needs better base defense/force allocation, not grants or source edits.
The supervisor now reserves estimated final replay time inside its unchanged
1140-second overall cap. No next strategy change or retry was attempted here.

Fresh stepping: 218.821 seconds of a new 600-second allowance, `priorStepMs:0`.
Inherited serialized stepping is only reported: cumulative 809.718 seconds.
Initial exact restore/initialize took approximately 295.5 seconds; final proof
approximately 499 seconds. Worker total: 1015.840 seconds (16m56s), below 20min.
Public continuation issued 547 commands, bought nine infantry for 3150 credits,
recorded 1551 shots and 25 deaths across all teams. All purchases were paid.
Runtime/assets/resume hashes stayed unchanged. Worker exit code 1 means actual
non-WIN, not timeout: `expired:false`, `reaped:true`, signal null. Final audit
found launcher/supervisor/worker PIDs 65110/65111/65112 all gone.

Checks: six focused strategy/route/budget tests passed, scoped strict QA types
passed, and both actual input-guard and final evidence tests passed in
`/tmp/dc-h05-current-final-verified-1790170858163.log`. The evidence test explicitly
distinguishes SOURCE_LOSS from healthy continuation and retains strict city,
recovery and exact pending/ready requirements for any future WIN. One initial
test assertion expected `LOSS` instead of the existing `SOURCE_LOSS` label;
that assertion was corrected and the same check rerun successfully.
Summary: `/tmp/dc-h05-r04-final-summary-1790170876127.json`.
No agents, full suite, A05 execution, browser acceptance or runtime edits.

## Starting Evidence

The validated outer import described in
[campaign-session-legacy-import-20260923.md](campaign-session-legacy-import-20260923.md)
is the input, not the session-only migration artifact:
`/tmp/dc-view-import-actual-r1-H05-current-outer.json`.
It starts at tick 1000 with `current-population-v1`. Ordinary MissionView restore
and initialization are checked for exact equality before any public command.
Original source identity and the checkpoint's absent optional production profiles
remain authenticated. No runtime, source, funds, health, fog or scripts are edited.

The original commander is **already dead at tick 1000**: unit 44/type 69 is absent
from live simulation and source entities, `statistics["0,0,69"]` is 1, and source
trigger 14 has fired. The import did not cause this. Consequently the actual source
route is team 2 city destruction, trigger 1 betrayal, team 1 city destruction,
trigger 18 enabling trip 17, trip 17 granting a replacement commander and enabling
trip 15, then trip 15 extraction. No commander is resurrected by QA.

## Human-Only Strategy

[mission05-playthrough.ts](../tools/qa/mission05-playthrough.ts) now separates the
human commander return/protection order from army assaults. Progressing movement
is retained; a stalled or visibly unsafe protective route can be replanned.
Human rendezvous points come from an actual source-grid path, not arbitrary offset
coordinates. The army assembles, advances through the defended approach, and then
attacks the source city. Only visible enemies are directly targeted; original
source city coordinates are used for legal scouting orders. Existing harvesting
and paid infantry production fund reinforcements. The saved optional upgrade
profile is not replaced or enabled. The alien strategy is unchanged.

Source gates are explicit: 9 or 17 enables the trip-15 objective; 18 alone routes
to trip 17. The strategy stops after 2500 ticks without city-state or combat-death
progress, or saves before its stepping allowance expires. A harness stop is not
a source WIN. Every non-winning final save goes through exact ordinary restore
and initialization; a WIN requires the existing exact pending-to-ready proof.

## Attempts

1. `/tmp/dc-h05-current-attempt-r01-1790168071653/human`: tick 1000 to 3501.
   The direct approach destroyed two defenses but depleted the army. No city
   building was destroyed. It stopped on the explicit city-progress guard, not
   a supervisor timeout. The final save restored and initialized exactly.
2. `/tmp/dc-h05-current-flank-r02-1790168355639/human`: a new branch from the same
   unchanged tick-1000 input to 3701. The proposed offset flank was unreachable
   in source terrain, so no new movement command was issued. It retained 19
   combat units plus the collector and 2666 credits. Exact restored/initialized
   checkpoint hash: `bd92e07b5cec46e20673669975820b0d92dd0d706dad22322085e3c37472c53e`.
3. `/tmp/dc-h05-current-wave-r03-1790168693048/human`: continues attempt 2's actual
   tick-3701 current save with reachable rendezvous points. It stopped at tick
   12087 with team 2 destroyed and a healthy, exactly restorable continuation.

All three use unique absolute logs and the existing worker supervisor. The first
two workers exited normally with code 1 for non-WIN and were reaped. Aggregate
new stepping allowance is below 600 seconds; worker proof cap is 900 seconds and
total worker cap is 1140 seconds. This is source-backed Node MissionView/NullCanvas
evidence, not browser visual acceptance or native-parity evidence.

## Final Outcome And Continuation

**No WIN, pending WIN, or extraction occurred.** The actual result is
`HARNESS_LIMIT`, outcome `null`, diagnostic `null`, explicit stopping reason
`supervised-save-before-step-budget-exhaustion`. This was a planned save and
proof, not a killed worker or generic timeout failure.

- Tick 12087; source trigger 1 fired at source cycle 9200 and was observed at
   tick 9201. Fired IDs: `20,14,3,5,4,1`.
- Team 2 building slots: `0,0,0,0,0`. Both actual buildings were destroyed by
   army combat, and the unchanged TRO emitted the betrayal and reinforcements.
- Team 1 building slots remain `4800,2400,3600,3600,0`. Triggers 18, 17 and 15
   have not fired. The remaining task is to clear team 1, then route to 17 and 15.
- Player buildings remain at 4800 and 2400 HP. There are 21 living infantry and
   one collector, 706 credits, 13156 cumulative earned credits, and no visible
   enemy at the final observation. Infantry HP ranges from 100 to 800; no health
   was restored. The betrayal counterattack diverted the army back toward home;
   the next public-command continuation must reassemble for the team-1 assault.
- Cumulative strategy counters: 1069 commands, 47 purchases, 16450 spent,
   4312 shots and 56 total deaths (not all player deaths). These include the
   inherited tick-1000 history and the retained branch's subsequent actions.

Validated current outer checkpoint:
`/tmp/dc-h05-current-wave-r03-1790168693048/human/checkpoint.json`.
Its `view` SHA-256 is
`90f1ab2b6e8bf46295673dfc36cc3a395c5f7135e5e2520eb1d475f996680edb`.
Independent ordinary MissionView restore **and initialization** reproduced the
entire view checkpoint exactly, with zero differences and the current-policy
marker retained. Evidence is the adjacent `current-roundtrip.json`; no
`pending-win.json` or `proof.json` exists because no source WIN occurred.

The final worker used 397.0 seconds stepping, about 322.4 seconds final replay
proof, and 812.5 seconds total including initial restore. Aggregate new stepping
across all three attempts was 560.9 seconds, below 600. All supervisors reported
`expired:false`, `reaped:true`, signal `null`; non-WIN process exit code 1 is
intentional. Final process audit found all owned attempt workers and launchers
gone: `/tmp/dc-h05-final-summary-r01.json`.

Every completed run reported unchanged loaded runtime and assets and unchanged
resume bytes. The original legacy H05 input still has SHA-256
`476a6dfddce6c2c205752edc2f27ed00318b51457cbb732c30a516f4284e8fae`.
No A05 run, runtime edit, save normalization, free production or synthetic
victory was performed. Commander protection cannot be claimed as actual-play
evidence here because the starting commander was already dead.

## Focused Checks

Five focused movement, human stage/objective, corridor-path and bounds controls
passed with no failures/skips:
`/tmp/dc-h05-wave-controls-r04-1790168654133.log`.
Scoped strict TypeScript passed:
`/tmp/dc-h05-final-types-r02-1790169008674.log`.
The actual evidence test
[mission05-current-human.test.ts](../tools/qa/mission05-current-human.test.ts)
passed against the final attempt: source progress, exact current replay, policy
markers, targeting visibility, input integrity and worker reaping.
Initial passing execution: `/tmp/dc-h05-actual-artifacts-r01-1790169209184.log`.
No agents or full suite were used.
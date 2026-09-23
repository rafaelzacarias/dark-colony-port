# Campaign 07-09 Status

Latest A09 follow-up: **not completed**. The dedicated public escort attempts below did not produce WIN. The latest actual source run lost its commander at tick 2744 and stopped at tick 2906 with original LOSS pending. No pending-to-ready WIN proof exists for this follow-up.

## Scope

Owned files: [driver](../tools/qa/campaign-07-09.ts), [focused tests](../tools/qa/campaign-07-09.test.ts), and this report. No runtime, original source, assets, prior fixtures, or other mission drivers edited. No agents or full-suite runs.

The driver uses the actual `loadCampaignMission(..., "browser-adapted")` and public `MissionView` controls, with the existing real-asset source-render/NullCanvas fixture. This is not browser-pixel or native-runtime parity verification. Direct attacks require current visibility and hostility. Only player-owned units receive orders. No predicates, counters, health, funds, fog, or enemy/NPC orders are injected.

## Source Contracts

| Mission | Original win and required gates | Driver coverage and limits |
| --- | --- | --- |
| H07 | TRO 2: all five CITY slots of teams 2 and 3 zero. Loss if player CITY or allied team 7 CITY disappears. | Public economy, production, source-city scouting, visible combat. No complete Aerogen-defense or research/artifact strategy. |
| A07 | TRO 7 enables win 2 if team 1 CITY falls first; otherwise TRO 12 breaks the team-1 alliance and enables win 13. Must eliminate teams 2, 7, and ultimately 1. | Branch-aware CITY priorities; no orders to the allied team. Full betrayal sequence unverified. |
| H08 | TRO 4: teams 2 and 3 CITY zero. TRO 8 loss at `s(7,3)>11`. | Economy/combat opening only; finding and saving source team-7 survivors is not implemented as a complete rescue strategy. |
| A08 | Player trips 1 then 5 issue source waypoints. Team-6 trip 20 enables player trip 6. Team-6 trip 13 enables player trip 12; trip 14 breaks alliance. Team-6 commander death triggers 9, recovery 19 enables CITY win 18 against team 7. | Public commander trip route and observed gate waits. NPC waypoints remain exclusively source-owned. Full escort, ambush, recovery, and final assault unverified. |
| H09 | TRO 1: teams 1 and 2 CITY zero AND `s(4,3)==12` breeding-pod deaths. Original malformed `b(1,3)&&==0` preserved. | Source CITY and team-4 scouting, visible combat. Full 12-pod clearance unverified. |
| A09 | Commander-type trip 2 schedules `c+60`; norm 5 enables commander trip 3; trip 3 schedules `c+3`; norm 6 wins. Commander loss triggers TRO 1. | Prioritized public commander route, safe waiting approach, original timed gates, pending-to-ready whole-checkpoint replay. |

SCN/TRO/TXT/MAP/MTG/PTH hashes are recorded per mission. Original TXT briefings and full parsed source contracts are included in `source.json`. MTG tag coordinates retain the native vertical inversion.

## Execution And Continuation

Run the group with an absolute path and a unique output directory:

```sh
node --import /Users/rafael/Downloads/darkcolony/node_modules/tsx/dist/loader.mjs /Users/rafael/Downloads/darkcolony/tools/qa/campaign-07-09.ts --output=/tmp/dc-0709-UNIQUE
```

The group runs A09 first (180 seconds), then the other five (45 seconds each, at most 1,200 ticks). Combined play cap is 405 seconds, allowing the earlier failed strategy attempt within the requested 600-second aggregate. Replay has its own cumulative 480-second cap. Every worker is synchronously reaped, with SIGKILL at its deadline. A unique `worker.log` and `exit.json` identify each run.

`checkpoint.json` contains the unmodified public view checkpoint, complete mission hash, and runtime hashes. `source.json`, `initial.json`, `journal.jsonl`, `campaign-journal.json`, `integrity.json`, and `result.json` preserve provenance and exact inputs. `--mission=A09 --resume=/absolute/checkpoint.json` resumes only when source and runtime hashes match. Guarded restore is never bypassed. A serialized checkpoint alone is not a validated round trip.

Ready outcomes are initially `UNVERIFIED_WIN` or `UNVERIFIED_LOSS`. The separate verification worker restores `pending.json`, checks the exact restored checkpoint, performs only public updates through the original ready tick, and compares the entire resulting checkpoint with the saved ready checkpoint. Only successful comparison yields `WIN` or `LOSS`.

## Initial Evidence

The first completed A09 route reached trip 4 at tick 994 and trip 2 at 1042. Waiting in place let enemy fire kill commander simulation ID 4: source LOSS pending at 1992, ready at 2193. Final public input at tick 1000 was `move` to `(115,12)`, cursor `move`, visible true. This was a strategy failure, not a runtime diagnostic. Artifacts: `/tmp/dc-0709-exclusive-r05`. Loss replay was not run; this attempt remains unverified. The revised strategy approaches the source extraction area while its original timer expires.

Focused tests: six passed, zero failed/skipped, `/tmp/dc-0709-controls-r06.log` and `.exit.json`. Strict scoped TypeScript check: exit 0, `/tmp/dc-0709-types-final-r07.log` and `.exit.json`. Later actual-run outcomes and exact replay evidence are recorded below when available.

## Actual Results

**No verified WIN achieved. This is a partial implementation and bounded handoff, not six completed gameplay drivers.** All six actual missions loaded and initialized using unchanged original sources. No runtime diagnostic was observed in the completed probes; wall deadlines are not runtime feature failures.

| Mission | Loaded / public control | Final observed outcome | Remaining feature or strategy gap |
| --- | --- | --- | --- |
| H07 | Yes / 13 commands | Incomplete at tick 116; source startup 6 fired | Aerogen defense, research/excavation and final two-hive assault not validated |
| A07 | Yes / 102 commands | Incomplete at tick 462; no source blocks fired | Three-city battle and betrayal branch not reached |
| H08 | Yes / 50 commands | Incomplete at tick 399; source startup 5 fired | Survivor rescue/ownership and Aerogen-loss gate not exercised |
| A08 | Yes / 1 command | Incomplete at tick 113; blocks 25 and 4 fired | Commander route started; NPC waypoint/trip chain and recovery not reached |
| H09 | Yes / 17 commands | Incomplete at tick 340; source startup 7 fired | Twelve breeding-pod deaths and both CITY goals not reached |
| A09 | Yes / public commander route | **Exact-replay original ready LOSS, tick 2313** | Reached original pending WIN, but commander died before ready; protection/escort strategy required |

Group artifacts: `/tmp/dc-0709-group-owned-r08`. The five secondary runs hit their wall limits before 1,200 ticks. Their exact final public inputs were:

- H07: tick 80, ID 69, move `(32,12)`, `source-city-scout`, visible.
- A07: tick 440, ID 71, move `(45,67)`, `source-city-scout`, visible.
- H08: tick 360, ID 78, move `(85,3)`, `source-city-scout`, visible.
- A08: tick 80, ID 81, move `(17,25)`, `source-escort-trip-1`, unexplored.
- H09: tick 320, ID 86, move `(32,32)`, `source-city-scout`, visible.

All these clicks used client `(256,226)` after public camera centering, with cursor `move`. Full input journals, checkpoints, source hashes, runtime hashes, and reaped-worker receipts are retained. No direct hidden-target attack was used. Saved incomplete checkpoints have source provenance; only the A09 continuation and outcome proof received guarded replay validation.

### A09 Exact Outcome

The first prioritized group worker was killed at its 180-second hard cap. It left an authentic tick-1200 checkpoint: commander ID 4, source type 73, HP 704 at `(118,19)`. It had reached original trips 4 at 994 and 2 at 1042. No outcome was pending. That checkpoint was restored unchanged by `/tmp/dc-0709-a09-continuation-r09`.

The continuation observed:

1. Original norm 5 at tick 2016 enabled extraction trip 3.
2. Public input at tick 2040: ID 4, `move` to `(118,21)`, visible, cursor `move`, client `(256,226)`.
3. Original trip 3 fired at 2047.
4. Original norm 6 issued WIN pending at 2096 (`resultCode:0`, `reasonCode:1`). The driver stopped issuing commands once an outcome became pending.
5. Commander death fired original LOSS block 1 at 2112, superseding that pending WIN.
6. LOSS became ready at 2313 (`resultCode:1`, `reasonCode:2`).

This is a concrete tactical failure, not proof of a runtime defect. The solo commander was down to HP 74 at tick 2000 while eleven other owned units remained unused. A continuation strategy should bring support or preserve the commander through the pending period, not alter TRO precedence or suppress the death predicate. Stealth/disease and complete escort tactics are not implemented or validated here.

Independent guarded replay in `/tmp/dc-0709-a09-proof-r10` restored the complete pending-WIN checkpoint at 2096 and reproduced ready LOSS at 2313 after 217 public updates, with no gameplay commands. Whole ready-checkpoint SHA-256 matched exactly:

`ccdfbdbae5262076d6e1c5167f97e98f2aafd494b646c0213307287ef8d4f82f`

Source mission hash: `a7f4b46866182e94b349fce48796fe496836d23b4c53881c7b9cfd7a28e539e7`. Proof worker exited 0 in 52.450 seconds. Runtime/source/loaded-asset integrity checks were unchanged for both continuation and proof. This exact LOSS does not satisfy the requested at-least-one-WIN acceptance criterion.

### Budgets And Tests

The serial group used 401.480 seconds including worker startup. Final continuation used 84.658 seconds, including guarded restore. The earlier completed solo attempt plus the brief interrupted launch keep aggregate play below 600 seconds. The separate exact replay used 52.450 seconds, below 480 seconds. No further gameplay attempts were made after that allowance.

Final focused gate: **8/8 passed, zero failures/cancellations/skips**, `/tmp/dc-0709-final-evidence-r12.log` and `.exit.json`. It covers original goal parsing (including malformed H09), A07 alliance sequencing, A08 NPC gates, A09 waiting/extraction staging, ready classification, all six real source-authenticated checkpoints, visibility on direct attacks, integrity, and the exact pending-WIN-to-ready-LOSS artifact proof.

```sh
DC_0709_GROUP=/tmp/dc-0709-group-owned-r08 DC_0709_CONTINUATION=/tmp/dc-0709-a09-continuation-r09 DC_0709_PROOF=/tmp/dc-0709-a09-proof-r10 node --import /Users/rafael/Downloads/darkcolony/node_modules/tsx/dist/loader.mjs --test /Users/rafael/Downloads/darkcolony/tools/qa/campaign-07-09.test.ts
```

## A09 Public Escort Follow-up, 2026-09-23

Additional owned files: [dedicated driver](../tools/qa/alien09-escort.ts) and [tactics/artifact tests](../tools/qa/alien09-escort.test.ts). No runtime, original TRO, assets, other mission strategies, or existing checkpoints were edited. Both completed attempts started fresh with the actual `loadCampaignMission("alien", 9, "browser-adapted")`, real assets, and NullCanvas. No agents, external/headless browser, full suite, health/funds/fog/damage injection, or loss suppression was used. The historical tick-1200 checkpoint was not reused or rebased.

The driver uses public selection, camera, order-mode and pointer commands. It orders all twelve starting IDs, including the commander, rather than leaving eleven unused. Direct targets must pass the alien player's current visibility and diplomacy filters. The initial strategy used assault groups throughout transit. The revised strategy uses move-only transit, attacks visible threats near the commander, limits the commander's lead over ground guards before trip 2, and waits north of extraction. After trip 3 it permits retreat throughout pending WIN; the proof worker restores the pending checkpoint with the normal guards, replays persisted commands at their original ticks, and compares the entire ready checkpoint. **That WIN replay path was not reached or validated by actual gameplay.**

| Actual attempt | First original failure | Final state | Public commands | Surviving starting units | Worker time |
| --- | --- | --- | --- | --- | --- |
| `e11` | Commander death, TRO 1 at tick 1856 | Ready LOSS at 2057 | 100, including 27 visible direct attacks | 8/12 | 67.951 s |
| `e14` | Commander death, TRO 1 at tick 2744 | Pending LOSS at 2906 | 167, including 47 visible direct attacks | 2/12 | 101.867 s |

Artifacts: `/tmp/dc-a09-escort-20260923-e11` and `/tmp/dc-a09-escort-20260923-e14`. Both contain source/runtime fingerprints, initial and final checkpoints, original campaign journal, public input journal, command list, integrity report, result and exit receipt. All twelve IDs received commands in each attempt. Hidden direct attacks: **zero** in both. Commands after pending: **zero**, because the first pending outcome in each was commander-death LOSS, not WIN.

The revised run reached original trip 4 at 2069 and trip 2 at 2116 with commander HP 532. Its slower escorted approach therefore started the original `c+60` timer later than the old solo run. Norm 5, trip 3 and norm 6 were never reached. The last commander input was move at tick 2720 to `(120,32)`, HP 47, visible, cursor `move`, client `(256,226)`. The commander died at 2744. At the 2906 stop, only ID 5/type 10/HP 225 at `(119,28)` and ID 6/type 10/HP 151 at `(118,29)` survived. The northern waiting point was not safe from pursuing enemies. The remaining failure is tactical protection and continued evasion, not a demonstrated runtime diagnostic; diagnostics were null throughout the completed runs.

The first implementation also failed at tick 0 before any command because the nearest trip-2 tag cell was unreachable; fallback across the original tag cells was added and tested. A separate early launch, `e08`, was interrupted by the shared terminal after its three tick-0 commands, without a final checkpoint/exit receipt. No process from it remained at the subsequent process check. Signal-isolated workers were used afterward. Do not count that interrupted launch as a completed run or exact replay.

Completed play-worker time, including the 0.387-second tick-0 failure: **170.205 seconds**. The early interrupted launch has no measured final duration, so an exact all-launch aggregate cannot be certified. The final attempt had a reduced 105-second hard cap; it stopped normally before that cap. Proof-worker time: **0 seconds**; no WIN justified starting the separate 300-second proof budget. No further gameplay was run after the second failure. All supervised workers were synchronously reaped, including play PIDs 99035, 10517 and 17346; the final process audit found zero active owned A09 processes. Audit: `/tmp/dc-a09-escort-final-audit-20260923-e15.json`.

Current source mission hash for both completed attempts:
`868b66292741f409d726fb0dbd71fda919b541a4367c96a9d832c41405b35309`

Latest final-checkpoint hash, **not an exact continuation proof**:
`4be5803299cdaaec236ab92ce78ffe0cbbccca243c33fd2adaaafd95b065d184`

Runtime/source/loaded-asset changes during both runs: zero. Eight focused tactics checks and the scoped strict TypeScript check passed before the revised actual run. Two additional artifact checks verify the actual loss states, source identity, checkpoints, visible targets, all-unit command coverage and reaped exits without relabeling either failure as a victory.

```sh
DC_A09_ESCORT_ARTIFACTS=/tmp/dc-a09-escort-20260923 node --import /Users/rafael/Downloads/darkcolony/node_modules/tsx/dist/loader.mjs --test /Users/rafael/Downloads/darkcolony/tools/qa/alien09-escort.test.ts
```
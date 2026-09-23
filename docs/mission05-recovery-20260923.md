# Mission05 Bounded Recovery - 2026-09-23

## H05 Survivor Continuation C01

One authorized attempt resumes only
`/tmp/dc-h05-final-partition-20260923-r05/human/checkpoint.json`, tick21385,
using its `current-population-v1` marker and ordinary authenticated restore.
No legacy import, fresh fallback, source/runtime edits, agent or full suite.
Output: `/tmp/dc-h05-continuation-20260923-c01/human/`.

Read-only JSON inspection before initialization found28 infantry and one800HP
collector,2514 credits and1636 reserve on the active22-rate resource node.
Both player buildings remain4800/2400. The actual visible enemy central/type16
has4792HP at38,24; producer/type17 has1432HP at40,24. The building-slot values
4800/2400 are not their current damaged entity HP. No mobile base threat is
visible. The commander remains dead; only the actual18 ->17 ->15 source chain
may replace the commander and complete extraction.

The opt-in `DC_H05_CONTINUE=1` QA policy retains four base guards and two collector
guards, increases local base guards up to eight for visible threats, and recruits
remaining eligible infantry into the expedition without a12-member cap. It
retains live attack targets and progressing move orders. Source City goals stay
selected until destroyed; changing goals no longer restarts assembly. The save
includes QA assault-stage/goal state. Purchases may spend the actual initial
credits plus subsequent real income, never synthetic income or a grant.

Limits: initialize900s, play at most600s, total1080s including initialization and
final save. Remaining play shrinks to fit the total, with30s reserved before
stepping and15s before the play deadline for saving. The external supervisor
enforces phase/total limits even during synchronous restoration. Non-WIN never
enters a final restore. A source WIN pending/ready is saved and explicitly marked
unproved; a separate ordinary pending-to-ready replay has a900s proof budget.
No second gameplay attempt is authorized in this batch.

Five H05 policy tests pass, including small surviving expeditions, visible-threat
guard reinforcement, actual saved funds, depleted income and total-budget math.
Scoped strict TypeScript passed for the driver, policy tests and current-artifact
tests. Logs: `/tmp/dc-h05-continuation-controls-20260923-04.log` and
`/tmp/dc-h05-continuation-types-20260923-04.log`.

The supervisor reached stepping after534281ms and allocated515915ms of play,
reducing the nominal600s to preserve the1080s total. At24485 the producer was
destroyed and the remaining visible central had2048HP; at25185 it had108HP.
The base remained4800/2400, with26 living owned units and235 credits. No pending
WIN existed at that observation. Partial City damage must be read from visible
simulation targets, not the source world's still-live nominal City health.
Source block18 then fired at25235 after the last central died. At25500 the
owned400HP infantry77 was moving at38,5 toward trip17; no commander replacement
or WIN had yet fired. This establishes actual City completion, not extraction.

Separate proof, only after `pending-win.json` and a ready `checkpoint.json`
exist: run the same driver with `DC_M05_PROOF` set to the C01 `human` directory,
`DC_M05_OUTPUT` set to a new proof directory, and `--run --faction=human`.
Unset `DC_H05_CONTINUE`, `DC_H05_FINAL_RETRY` and `DC_M05_RESUME` for that command.
This is a handoff instruction, not a proof executed by this attempt.

### Completed C01 Result

**Actual source WIN, ready at26344; exact final replay still unproved.** The
explicit harness status is `SOURCE_WIN_PROOF_PENDING`, not a completed replay
claim. Source18 fired25235, trip17 fired25835 and trip15 fired26143. Pending
WIN26143 has `resultCode=0`, `reasonCode=1`, `ready=false`; final26344 has
the same result/reason with `ready=true`. The commander was created by trip17,
not QA injection; final commander157/type69 has700HP at17,16.

- Last central/id35 and producer/id36 both0HP; all team1/team2 City slots zero.
- Player base/producer4800/2400;16 living owned units:14 infantry, one collector
  and the source-replaced commander. Final credits405.
- Real new income3841,17 purchases costing5950, using2514 initial credits:
  `2514 + 3841 - 5950 = 405`. No grants, healing or respawn cheat.
- Ordinary initial restore and initialized restore both exact at21385.
- Play367710.049ms; total905998ms (15m5.998s), below1080000ms. Initialize-to-step
  was534281ms, within900000ms. No deadline expired and no signal terminated it.
- Final view SHA-256:
  `a2a23d3f7a4a4548de9670e23f179c439f16dc5d0f8fdfb3fd624d10e6e5446b`.
- Runtime/helper changes empty, fetched-asset changes empty, original input
  unchanged. No final non-WIN restore and no second gameplay attempt.
- Supervisor10954 and worker10955 exited and were reaped; no active H05 driver
  or artifact-test process remained at the final audit. Exit1 is intentional
  because exact replay proof is deferred, not because source WIN failed.

`pending-win.json` and `checkpoint.json` in the C01 `human` output are ready for
the separate900s proof. `proof-deferred.json` records26143 ->26344;
`final-summary.json` records exact HP, funds, force, budgets, hashes and process
checks. `proof.json` does not exist and no pending-to-ready equality is claimed.

The two actual-artifact tests passed with zero failures/skips in
`/tmp/dc-h05-c01-event-artifact-check-1790174309708.log`; its exit receipt is0,
audit worker13335 exited. Together with five policy controls, seven tests pass.
Scoped QA TypeScript and documentation checks passed. The main agent can run:

```sh
env -u DC_H05_CONTINUE -u DC_H05_FINAL_RETRY -u DC_M05_RESUME \
  DC_M05_PROOF=/tmp/dc-h05-continuation-20260923-c01/human \
  DC_M05_OUTPUT=/tmp/dc-h05-c01-proof-20260923 \
  node --import /Users/rafael/Downloads/darkcolony/node_modules/tsx/dist/loader.mjs \
  /Users/rafael/Downloads/darkcolony/tools/qa/mission05-playthrough.ts --run --faction=human
```

## Final H05 Partition Retry

One authorized continuation starts at tick12087 from
`/tmp/dc-h05-current-wave-r03-1790168693048/human/checkpoint.json`.
The previous r04 branch ended in source LOSS at16321 after both player
buildings died; damaging the team1 lab from3600 to1388 did not produce another
City death. It is not a winning checkpoint or a branch to resume.

The local strategy defect was army-wide reassignment: any visible base threat
sent every infantry unit to that target, otherwise every unit left for the
city assault. Progress journals contain no visible enemy at x>80, so the
attackers' exact base-raid positions are not established by that journal.
Known visible city threats include turrets at34,30 and47,30 and team3 infantry
near34,25 and35,24. No hidden mobile position is used for commands.

The healthy input contains21 infantry:18 at800HP and three at100/200/500HP,
plus the800HP collector at90,18. Forward infantry are around60..68,30..37;
northern infantry are spread along71..101,3..17. Player buildings are99,7
and101,7. The final policy retains eight healthy base guards, two healthy
collector guards and an expedition capped at12. Initially only eight healthy
raiders remain after reserving defense; it does not invent four reinforcements.
Surviving role membership is stable even when visible enemies appear.

Defenders use public move to legal Manhattan weapon-range positions and public
Stop to clear movement suppression and allow existing auto-guard. They do not
receive expedition or pursuit orders. New infantry purchases require new real
credited income since resume, less retry spending, as well as actual credits.
Existing resource orders are retained only while their node has positive
remaining reserve and rate. Source-known remaining cities are ranked by
reachable firing positions, excluding type81 helpers. Visible structure damage
is calculated from the actual infantry weapon and target defense class; direct
attacks still require public visibility and live damage eligibility.

The `DC_H05_FINAL_RETRY=1` option requires HUMAN and a saved input, caps play
at500s, and is invoked here with480s. Planning stops15s early for the final save.
Initial loaded-source authentication and exact ordinary initialized restore
remain mandatory. A non-WIN saves its actual result without another full
roundtrip; `currentRoundtripExact=false` explicitly prevents a restore claim.
WIN still requires team1 destruction, source18, trip17 replacement, trip15,
all enemy City slots zero, and exact full pending-to-ready checkpoint replay.
The separate900s initial/proof limits are not stepping time. No cold branch,
runtime/source/assets edits, agents, full suite or other-mission verification.

Run artifacts: `/tmp/dc-h05-final-partition-20260923-r05/human/`.
Five focused H05 strategy/budget tests passed in
`/tmp/dc-h05-final-controls-20260923-r03.log`.
During this retry, visible defense records identified team1 infantry107 at104,7
fromtick12137 and infantry92 at98,10 fromtick12687. Those are newly observed
positions, not inferred hidden targets. At19787 both player buildings remained
at4800/2400, while enemy City slots2/3 had reached zero. Actual infantry damage
against the visible lab's target class9 was4 per shot. This is genuine defense
and demolition progress, not yet the required source18/17/15 WIN chain.

### Completed Actual Result

**HARNESS_LIMIT, not WIN or LOSS**, tick12087 ->21385. Actual new stepping
was465020.268084ms (465.020s), below the500s maximum. Finalization saved before
the480s stage budget. No second gameplay attempt, cold branch or final non-WIN
restore was run. The two completed-artifact assertions passed in
`/tmp/dc-h05-final-artifact-complete-r06.log`, exit0. Together with five focused
controls, seven checks passed. Scoped strict QA TypeScript passed in
`/tmp/dc-h05-final-types-20260923-r03.log`; editor and documentation links passed.

- Player base/producer4800/2400, collector800HP;29 living owned units.
- Team1 lab/type19 and type21 City destroyed; base4800 and producer2400 remain.
- Fired20,14,3,5,4,1;18/17/15 absent. No pending WIN, ready WIN or proof artifact.
- New income10208,24 purchases costing8400; final credits2514.681 public
  commands and2527 shots during this retry. No grants, healing or source edits.
- All eight base guard IDs and both collector guard IDs retained their roles.
  Expedition reached12 members using paid infantry and replacements.
- Final view SHA-256:
  `0a0f4b1cf539591b06df304fe23a7cf720f500274e4e7ddaac44194d4b0ceb69`.
- Runtime/helper and fetched-asset changes empty; input checkpoint unchanged.
  `initial-restore.json` and `initialized-restore.json` prove exact initial
  restore. `nonwin-final-save.json` explicitly records no final replay proof.
- Supervisor93626 and worker93627 exited, code1 for non-WIN, no signal,
  `expired=false`, `reaped=true`. No owned H05 gameplay or audit waiter remains.

Total supervisor wall time was1664622ms, mostly initial authenticated restore:
the recorded initialize-to-step interval was1196824ms. The nominal900s phase
timer did not enforce that synchronous restore bound; it is not claimed met.
The requested500s stepping bound was met. No time was spent restoring a terminal
LOSS, and this run produced no source LOSS at all.

Remaining strategy limit: accessible goals were lab41,26, then42,24, then
producer40,24. The initial expedition reached flank14837 and assault14987.
Changing City goals reset assembly, but no new flank/assault transition occurred
before the final budget; replacement members were still dispersed. Thus stable
defense and two City kills are established, not completion of team1 destruction
or commander replacement/extraction. This final saved branch was not rerun.
`final-summary.json` and `strategy-summary.json` contain the measured details.

## Validated Session Import Follow-Up

The later [explicit legacy session import](campaign-session-legacy-import-20260923.md)
isolated both original rejects without modifying either checkpoint. H05 tick1000
authenticated under the old unmaintained-population policy, migrated by current
replay with only six aggregate-statistic differences, and passed exact ordinary
session restore. The separate current session artifact is
`/tmp/dc-legacy-import-actual-1790166652522-H05-current-session.json`.

A05 tick2000 remains rejected: even old population replay differs at controller
revision (277 saved versus254 replayed) and nine transport receipt IDs. No bypass,
normalization or A05 migration was admitted. Actual bounded checks took157.3s;
original bytes/hashes are unchanged. This proves session compatibility only, not
outer-view migration, continued gameplay or any historical victory. Main/UI and
MissionView were not changed; ordinary restore has no legacy fallback.

## Frozen Runtime Actual Attempts After Building Upgrades

Both attempts completed concurrently in **145417ms total wall time**. Neither
produced pending WIN, ready WIN, or a pending-to-ready proof. Only QA files and
this document changed; no runtime edits, agents, full suite, saved-diagnostic
clearing, source rewrites, objective injection, or migration bypass.

Artifacts: `/tmp/dc-m05-frozen-20260923-r02/`, with `human/` and `alien/`
subdirectories. The reproducible two-worker launcher is
[mission05-recovery-run.mjs](../tools/qa/mission05-recovery-run.mjs); the existing
[driver](../tools/qa/mission05-playthrough.ts) owns normal authenticated restore,
public gameplay commands and exact pending-to-ready verification.

### Restore Results

- H05 tick9555 remained read-only and was **not submitted for progression**:
  its occupancy diagnostic is latched. The inventory found a healthy tick1000
  save at `/tmp/dc-m05-opening-1790145350338/human/checkpoint.json`, but no later
  healthy periodic checkpoint. That save was submitted instead.
- A05 used the documented tick2000 save, commander356HP, at
  `/tmp/dc-m05-a05-route-1790145424299/alien/checkpoint.json`.
- Both passed loaded-mission identity compatibility, then normal
  `CampaignSession.restore` rejected them with
  `ai: checkpoint differs from complete source caller replay`.
  Each `resume-rejected.json` records the original error and labels the save
  `UNRECOVERABLE_WITHOUT_VALIDATED_MIGRATION`. The exact differing replay field
  was not isolated; selector/message changes must not be asserted as its proven
  cause. No validated migration exists in this attempt, and no historical public
  journal replay or tick9555 occupancy-boundary verification was achieved.
- Both therefore used genuinely fresh current-source openings. The rejected
  snapshots, hashes and diagnostics were not patched.

### Actual Fresh Gameplay

| Mission | Final Tick | Observed Result | Source Goal Evidence |
| --- | ---: | --- | --- |
| H05 | 3141 | `HARNESS_LIMIT`, no diagnostic/outcome | Blocks20,14; commander loss statistic `0,0,69=1`; team1 city `4800,2400,3600,3600,0`, team2 `4800,2400,0,0,0`; no15 |
| A05 | 4000 | `HARNESS_LIMIT`, no diagnostic/outcome | Block4 only; living commander73,728HP at21,18; loss statistic `0,0,73=0`; no rescue17/extraction18/WIN19 |

H05 issued683 commands, paid7000 for20 purchases, earned3300, fired893 shots,
and retained12 owned units. A05 issued362 commands, fired38 shots and made no
purchases. The A05 public short-waypoint, visible-mine-avoiding route toward17
did not reach rescue during this modest attempt. These are incomplete strategy
runs, not new demonstrated runtime blockers and not victories.

Phase budgets remain initialization900s, play600s, proof900s, additionally
bounded by **1140s total per worker**. Rejected-save fresh fallbacks use at most
120s/4000ticks of play. Actual play was117004ms H05 and109483ms A05. Proof was
not entered. Both supervisors exited normally with code1, no signal or timeout,
and reaped workers53005/53004; supervisors53002/53003 also exited.

### Integrity And Verification

Both results are `filesystem-stable`: all124 runtime/helper fingerprints
unchanged, as were all283 H05 and225 A05 fetched assets. Full before/after
fingerprint maps are in each `integrity.json`; `batch.json` contains unchanged
input-file hashes, including the unplayed diagnostic-bearing H05 save:

- Healthy H05 input: `476a6dfddce6c2c205752edc2f27ed00318b51457cbb732c30a516f4284e8fae`.
- A05 input: `59af05ac272dd25c76868aaa28c5812d7437c510caf9faaed77241d538b7dff0`.
- Latched H05 input: `4b76981febaa7b82bac37f49138b6496a57514258020c2274339d15b7d982186`.
- Fresh H05 final view: `31bfccbcb9427491489fa23cfabc5a304d58dc5f203afe31cf49213af75e812c`.
- Fresh A05 final view: `8d818b7540897c3e4c8bfd720161bebef7183c3356f7a068f79bb87936116f33`.

**9 tests passed, zero failures/skips** in
`/tmp/dc-m05-frozen-artifacts-owned01.log` (exit receipt alongside it).
The [Mission05 tests](../tools/qa/mission05-playthrough.test.ts) use
`DC_M05_RECOVERY_ARTIFACTS=/tmp/dc-m05-frozen-20260923-r02` to validate actual
reported statistics and city health against each saved source world, exact
checkpoint hashes, unfulfilled goals, proof absence, live-file fingerprints,
immutable inputs and absence of the four worker/supervisor PIDs. The adjacent
five message controls remain controlled evidence, not natural WIN evidence.
New healthy periodic saves are retained at1000-tick intervals; they are not
claimed restore-validated merely because their JSON is readable.
Final strict QA TypeScript and documentation-link checks passed:
`/tmp/dc-m05-frozen-final-types-owned01.log` and `.exit.json`. The same receipt
confirms batch launcher53001 is gone; no owned run remains active.

## Previous Authorized Continuation Attempt

The later request authorized actual H05/A05 continuations and edits only to
the existing Mission05 QA files and this document. The historical recovery
restrictions and commands below do not describe this new attempt.

The driver now authenticates the complete saved loaded-mission identity against
the current original mission. Only absent `adaptedUnitProfiles` and
`adaptedUpgrades` are allowed when the saved session also omits those fields,
matching MissionView's compatibility policy. Original SCN/TRO and map/profile
identity remain checked; MissionView still performs full authenticated restore.
The old loader hash is retained as provenance, not substituted into the save.
Neither source checkpoint nor its diagnostic was modified.

Each continuation has a fresh bounded play stage of at most600000ms, separately
from900000ms initialization/restoration, finalization and exact proof phases.
Prior saved stepping time remains in the cumulative report. Module-start runtime
hashes and end hashes are recorded: source-file drift labels the gameplay result
`historical-loaded-revision`, not a current-revision proof. Changed fetched assets
remain disqualifying. Pending-to-ready proof still restores the full pending
checkpoint and requires exact full ready-checkpoint equality in the same process.
A05 now targets rescue17/extraction18 directly, with short public move orders
and visible-mine avoidance; no injected triggers, state, credits or objectives.

Focused controls passed: **2 tests, zero failures/skips**, including original
mission initialization, legacy optional-field acceptance, and source/profile/
trigger tamper rejection. Log: `/tmp/dc-m05-owned-controls-r02.log` and
`.exit.json`. Both edited QA files had no editor diagnostics. Scoped TypeScript
checking was blocked by concurrent duplicate declarations in
[browser-income-interception.ts](../src/engine/browser-income-interception.ts):
`/tmp/dc-m05-owned-types-r01.log` and `.exit.json`.

Actual launch outcomes, not mission victories:

| Mission | Input | Outcome | Launcher Child PID |
| --- | --- | --- | --- |
| H05 | Existing tick9555 checkpoint documented below | Import-time TransformError; no restore or play | 76360 |
| A05 | Existing tick2000 checkpoint, commander356HP | Import-time TransformError; no restore or play | 77219 |

Both exited with code1 before supervisor/worker initialization because
`browser-income-interception.ts` contained duplicate exports, including
`BROWSER_INCOME_INTERCEPTION_SOURCE` at line199. The runtime owner was not
modified. Logs and completed launch receipts:
`/tmp/dc-m05-human-actual-r01.log`, `/tmp/dc-m05-human-actual-r01.exit.json`,
`/tmp/dc-m05-alien-actual-r01.log`, `/tmp/dc-m05-alien-actual-r01.exit.json`.
No natural WIN or pending-to-ready proof was produced for either faction.
Once the runtime owner's module imports successfully, the same checkpoints
can be retried through the bounded supervisor; do not bypass the import or
authentication failure.

## Status

Third recovery after two reported network failures. This recovery reads existing
artifacts and runs focused tests only: no new playthrough, save restoration,
agents, full suite, browser, runtime edits, or production/construction edits.
The network failures are not themselves evidence of game-runtime failure.

Both current original-source browser-adapted missions load and initialize.
Neither has a discovered natural WIN proof. The Mission05 artifact inventory
contains no `pending-win.json` or `proof.json`. Existing successful controls
below must not be reported as completed missions.

## Saved States

Paths below are existing temporary artifacts, not durable repository fixtures.
Saved view hashes were recomputed from `JSON.stringify(saved.view)` and agree
with the corresponding recorded result hashes.

### HUMAN05

- Save: `/tmp/dc-m05-human-full-1790145526624/human/checkpoint.json`.
- Frozen simulation tick **9555**, `RUNTIME_BLOCKER`, no outcome. Diagnostic:
  `[{"code":"invalid-input","message":"Occupied or ineligible ground cell 101,4"}]`.
- Fired blocks: `20,14,3,5,1,4`. Team 2's five city health slots are zero:
  betrayal block 1 actually fired. Team 1 remains `4800,2400,3600,3600,0`.
  Commander death block 14 fired; recovery block 18, trip 17 and WIN trip 15
  have not fired. Player base/producer health: `4800,2400`.
- Sixteen living owned units: collector type 6, HP800 at `(90,18)`, and fifteen
  type-0 troops. No living commander. Credits2112, earned10362, purchases35,
  spent12250, commands1834, shots3382, deaths41. Aggregate stepping335918.114458ms.
- Saved view SHA-256:
  `ec9d22a353517ffe5753de6dfc4278cc48fcc46c5372f662bec1da6e393a6345`.
- Saved loaded-mission hash:
  `a45e0935c3428afdf3340dbd53a6b8c377eaf4c74a4079c55dadeceb35a89152`.
  Fresh preflight hash:
  `e977334d8ff8452562c2a1ad4a71c0faed75348d87cd7d9471e520d3386754fe`.
  **Not currently resumable through the harness's source-hash guard.** This
  hash covers the loaded mission object, not just original SCN/TRO bytes.
  Comparing saved and fresh `sourceIdentity` finds exactly one difference:
  `sourceProduction.production.adaptedUpgrades` is now
  `{runtimeProfile: "browser-adapted"}` (previously absent).
  The saved diagnostic is a separate obstacle; do not clear it or rewrite hashes.

The exact historical owner is occupancy reconstruction in
[campaign-session.ts](../src/engine/campaign-session.ts): `rebuildOccupancy`.
The saved host cell is index549, ground-eligible, with occupant sentinel1022.
Its production exit reservation belongs to team0, queue0, type0,
ticket `input:browser:9501:dispatch:0`, at `(101,4)`. Saved actors240/241/242
at that cell are already status10/HP0; the prior diagnostic probe found no
simulation unit there. This points to production-exit reservation handling,
not impassable terrain. The committed save does not identify the rolled-back
incoming actor, so a precise rejected-transition reproduction is still absent.
Current code explicitly admits a browser-adapted reserved exit in this path;
the historical failure has **not** been reproduced against current changes.

### ALIEN05

Best surviving continuation candidate:
`/tmp/dc-m05-a05-route-1790145424299/alien/checkpoint.json`.

- Tick **2000**, `HARNESS_LIMIT`, no outcome or diagnostic. Commander52/type73,
  HP356 at `(63,23)`, moving; only one living owned unit.
- Fired `4,2,3,8,9`; rescue17/extraction18/WIN19 not reached. Credits, income,
  purchases and spending all zero; commands25, shots279, deaths5.
- Saved stepping35817.244ms. View SHA-256:
  `77484c3178ee68d35cfe750ba959faab36dec37abb84c1c75f2cc21b8b017da8`.
- Saved and fresh loaded-mission hash both:
  `5f729f664f2204cc532f85d82f6afeca80106f98adf5ee5cecde3ce026230b1d`.
  Identity matches, but current-runtime restore compatibility was not tested.

Later branches are terminal losses, not better continuation checkpoints:

| Directory under `/tmp` | Tick | Recorded result |
| --- | ---: | --- |
| `dc-m05-alien-full-1790145860343/alien` | 2601 | Ready LOSS, blocks `4,2,3,8,9,11,7` |
| `dc-m05-alien-allied-1790146276923/alien` | 977 | Ready LOSS, blocks `4,2,7` |
| `dc-m05-alien-detour-1790146640331/alien` | 2793 | Ready LOSS, blocks `4,2,3,8,9,10,11,7` |
| `dc-m05-alien-avoid-1790147714776/alien` | 2761 | Ready LOSS, blocks `4,2,3,8,9,10,7` |

All four have resultCode1/reasonCode2/ready=true, no living owned units, and
no recorded runtime diagnostic. The latest avoidance branch records aggregate
stepping151598.29475ms, commands30, shots675, deaths15. Its total wall time was
481901ms despite only about20s of new stepping: do not assume late restoration
fits a five-minute tool call. These are observed source losses, not exact
pending-to-ready loss restore proofs. Inspected completed run integrity receipts
have empty `changed` and `changedAssets`; runtime files have changed since then.

## Original Circuits And Existing Evidence

- [HUMAN05.TRO](../raw_cd/DC/SCENARIO/HUMAN/HUMAN05.TRO): block20 opening;
  all five team2 city slots zero triggers1, breaking both directed alliances,
  changing AI, reinforcing and messaging. Both enemy cities cleared triggers9
  and enables15. Commander loss triggers14, disables9 and enables18; team1
  cleared then enables recovery trip17, which reinforces69 and enables15.
  Player-team trip15 executes original `bail 0 1`. Player city cleared is LOSS2.
- [ALIEN05.TRO](../raw_cd/DC/SCENARIO/ALIEN/ALIEN05.TRO): opening4 delivers73;
  trip17 spawns team7/type72 at `(85,44)` and enables18. Trip18 abducts teams7
  and0, sets array1 to `c+10`, and enables19;19 waits for `c>s(0,2,1)` and
  executes `bail 0 1`. Commander loss triggers7 and `bail 1 2`. The QA route's
  sequence `2,8,10,16,17,18` is a strategy, not an extra source WIN predicate.
- [Commander mapping evidence](source-browser-commanders-20260922.md): A05
  controlled rescue/extraction uses team7/type72, slot204/generation0, extraction
  tick112/carrier3, pending WIN by360 with exact checkpoint continuation.
  Predicates are controlled; this is not public legal playthrough evidence.
- [H05 message5](human05-messages-20260922.md) is resolved by parsing original
  `text 5.`. The old missing-message blocker is obsolete.
- [World message rollover](campaign-world-messages-20260922.md) retains16
  presentation messages. Its session-follow-up section is historical:
  current `scanEvent` collects committed adapted message events, and
  [session-message tests](../tools/qa/campaign-session-messages.test.ts) cover
  all18 H05 messages, controlled sequence `20,1,9,14,18,17,15`, restore,
  continuation, strict rejection and rollback. Controlled deaths/reservations
  do not establish natural H05 victory.
- [Mine evidence](browser-mines-20260922.md): unchanged A05, four type45 mines;
  public movement detonates one at view756, source loss statistic once, full
  save/restore plus continuation. Explicit radius1/full-damage adaptation,
  not original weighted7x7 splash parity. Existing log:
  `/tmp/dc-mines-al05-public-17.log`. No new mine playthrough was run here.

## Recovery Verification

[Mission05 tests](../tools/qa/mission05-playthrough.test.ts): **2 passed**, zero
failures/skips, 2240ms wall time, under a240000ms SIGKILL cap. This verifies
bounded status classification, original source contracts and both real view
initializations, not progression or old-save replay.

- Log: `/tmp/dc-m05-third-recovery-tests-1790157059588.log` and `.exit.json`.
- Fresh preflights: `/tmp/dc-m05-preflight-28445-1790157061342/`.
- Saved-state/hash/cell report: `/tmp/dc-m05-third-recovery-states-1790157093271.json`.
- Identity diff: `/tmp/dc-m05-h05-identity-diff-1790157214366.json`.
- Process audit: `/tmp/dc-m05-third-recovery-processes-1790157103501.json`, empty:
  no Mission05 worker remained active at inspection.
- Session-message tests: **5 passed**, zero failures/skips, 6098ms wall time
  under the same240000ms cap. Log:
  `/tmp/dc-m05-third-recovery-messages-1790157190843.log` and `.exit.json`.
  This includes the original H05 controlled18-message sequence and exact replay.

Total current focused verification: **7 passed**. Historical rescue and mine
proofs were read, not rerun. All executed recovery commands completed within
five minutes; no external network request or package installation was needed.

No actual test defect was found in Mission05's two tests; neither harness nor
test was edited. No claim of current integrity-stable long-run readiness while
production/construction changes are ongoing.

## Subsequent Commands

Run from `/Users/rafael/Downloads/darkcolony`. These play commands were **not
executed** in this recovery. Wait for runtime owners to finish and re-run tests
first. Use the supervisor, not `DC_M05_WORKER=1`, so children are reaped. Each
run writes to a unique output root with a faction subdirectory.

```sh
node --import tsx --test tools/qa/mission05-playthrough.test.ts tools/qa/campaign-session-messages.test.ts
```

H05: do not attempt the incompatible diagnostic-bearing save. After ownership
settles, use a short fresh public-command opening first, not a full mission:

```sh
DC_M05_OUTPUT="/tmp/dc-m05-h05-stable-$(date +%s)" \
DC_M05_STEP_MS=45000 DC_M05_MAX_TICKS=1000 \
node --import tsx tools/qa/mission05-playthrough.ts --run --faction=human
```

A05: only after an authorized late-restore budget and strategy review, resume
the living tick2000 save. Account for prior branches:151598.29475 total spent
minus35817.244 already in this save is115781.05075 additional prior milliseconds.
The example grants about45s more stepping, not a new600s allowance:

```sh
DC_M05_OUTPUT="/tmp/dc-m05-a05-stable-$(date +%s)" \
DC_M05_RESUME=/tmp/dc-m05-a05-route-1790145424299/alien/checkpoint.json \
DC_M05_PRIOR_STEP_MS=115781.05075 \
DC_M05_STEP_MS=196598 DC_M05_MAX_TICKS=1000 \
node --import tsx tools/qa/mission05-playthrough.ts --run --faction=alien
```

The unchanged A05 strategy has losing continuations; this is a bounded diagnostic
command, not a winning-policy recommendation. Restoration/finalization/proof
each have a separate900000ms supervisor phase budget. A step cap is **not** a
total wall-clock cap. Do not issue this late-restore command through a tool call
limited to five minutes; arrange a separately authorized supervised run first.
For another five-minute-limited session, stick to the focused tests and artifact
inspection. Do not force source hashes, clear diagnostics, inject trips/losses,
grant credits, rewrite source objectives, or disable integrity checking.

If a future run records a ready WIN plus `pending-win.json`, separate proof mode
is `DC_M05_PROOF=<faction-output-directory>` with `--run --faction=<faction>` and
a new `DC_M05_OUTPUT`. It must verify exact pending-to-ready checkpoint equality;
there is no existing Mission05 proof directory ready for that command today.
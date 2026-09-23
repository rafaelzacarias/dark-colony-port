# A14 Bounded Mission QA

2026-09-23. **ALIEN14 verified WIN on the captured loaded runtime revision.**
Fresh original mission, existing campaign13-15 public planner, Node/NullCanvas.
No browser was opened. No runtime, mining, main, view, existing QA, QA tsconfig,
source, funds, health, fog, statistics or trigger file was edited. Only the new
[supervisor](../tools/qa/mission-a14-bounded-20260923.mjs),
[acceptance tests](../tools/qa/mission-a14-bounded-20260923.test.mjs) and this report
were authored. No subagent, native probe or full suite was run.

## Actual Outcome

Artifact root: `/tmp/dc-a14-bounded-20260923-atrb8T`.

| Evidence | Result |
| --- | --- |
| Start | Fresh A14 tick0, no resume |
| Runtime profile | Existing `browser-adapted`, authentic source assets |
| Original objective | Trip3 `(S==0)`, original `bail 0 1`, firing recorded in campaign journal |
| Pending WIN | Tick1194 |
| Ready WIN | Tick1395, result0, reason1, ready=true |
| Public commands / shots / deaths | 223 / 186 / 2 |
| Play | 30675ms, parent-enforced 180000ms cap |
| Proof | 17872ms, same process and cached runtime modules |
| Total supervisor time | 48714ms, child cutoff295000ms, total acceptance cap300000ms |
| Exact restore | Pending JSON restored unchanged; 201 public updates; complete ready checkpoint equal |
| Exit | Worker61300 exit0, signal=null, reaped; supervisor61298 also absent |

Expected and restored ready-view SHA256:
`c10b64aa8fe4931b0505a6768be7ea6a00319138483a9ce18fa5c6b744f7d273`.

The unchanged existing harness executes only `--worker --case=A14`, not its
six-mission group. Its natural public route reaches the original chamber trip.
After play, the new wrapper restores the actual pending save in the same Node
process using cached MissionView/game-data modules and verifies all 201 updates
against the actual ready save. No native-path blocker or mission diagnostic
occurred. This is adapted-runtime source-goal proof, not native execution parity,
browser pixels/input, mining acceptance or complete campaign acceptance.

## Revision And Drift

Loaded-runtime manifest SHA256:
`4f13c56fb454366529979e8bfe756a841fbabce2231c1f6dd11be4ef85a77a4a`.

`loaded-modules.json` records107 loaded workspace modules with raw source,
post-load and evaluated-code hashes. Exact raw source bytes are preserved under
`loaded-source/`. The driver's loaded source hash matches the prelaunch hash.
Play and restore run in one process, avoiding a proof against newly reloaded
runtime modules after a concurrent edit. All195 assets fetched by the proof
match the play hashes; original source and fetched-asset drift lists are empty.

No loaded-module drift occurred during execution. The final read-only audit at
`2026-09-23T17:12:19.342Z` also found no drift in either loaded modules or the
existing harness's broader runtime baseline, including nonloaded main files.
These are time-bounded observations, not a claim about later disk revisions.
`currentRuntimeClaim` is deliberately false. Subsequent mining/main changes
require their own validation; this retained same-process historical proof does
not certify them. No Git metadata was available, so revision identity is a
content-hash manifest, not a commit identifier.

## Tests And Cleanup

Two focused read-only acceptance tests passed: 2pass, 0fail, 0skip, 313ms.
They verify the original trip, command journal, whole-checkpoint equality,
same-process proof identity, preserved source hashes, authentic fetched assets,
hard bounds and absent owned processes. Syntax and module-load-hook smoke checks
also passed. No simulation was rerun by these acceptance tests.

- Actual log: `/tmp/dc-a14-bounded-actual-20260923-1790183417.log`.
- Acceptance log: `/tmp/dc-a14-acceptance-20260923-1790183520.log`.
- Root evidence: `launch.json`, `loaded-modules.json`, `play-finished.json`,
  `worker-result.json`, `summary.json`, `final-audit.json`, `worker.log`.
- A14 evidence: source contract/classes, initial state, public command journal,
  campaign journal, pending WIN, ready checkpoint, restored-ready, proof and
  integrity JSON under the root's `A14/` directory.
- Final audit: worker61300 and supervisor61298 absent with ESRCH; no orphans.

The [H14 report](mission-h14-bounded-20260923.md) retained9 distinct historical
WINs. A14 adds one distinct completion, giving10 retained WINs and20 missions
still completion-unverified. The prior nine were not replayed in this task.
No further mission was attempted.

Read-only acceptance reproduction:

```sh
DC_A14_BOUNDED_ARTIFACTS=/tmp/dc-a14-bounded-20260923-atrb8T node --test tools/qa/mission-a14-bounded-20260923.test.mjs
```
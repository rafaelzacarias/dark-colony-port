# ALIEN05 Frozen Rescue Route

## Current Continuation: 2026-09-23

One actual continuation was run from the unchanged tick-4000 input after four
fast strategy tests and scoped strict TypeScript passed. No second playrun was
made. Only the mission05 QA driver, its tests, and this document were edited.

Artifacts: `/tmp/dc-al05-visible-current-1790167187850/alien`.
Current checkpoint: `/tmp/dc-al05-visible-current-1790167187850/alien/checkpoint.json`.
Current source outcome is **null**, neither WIN nor LOSS. The harness stopped
at tick **4091**, with block 4 alone fired, block 17 unreached, commander 52 at
cell **(25,20)**, subcells **(25628,20992)**, **728/800 HP**, activity `move`.
The conservative route gate stopped this attempt; it does not establish that
the mission or even the current passage is unwinnable. No pending WIN exists.

### Exact Restore Evidence

Ordinary `MissionView.restore` and subsequent `initialize` both exactly matched
the input before any command or update. `session.replayPolicy` remained absent.
Both `initial-restore.json` and `initialized-restore.json` record tick 4000,
zero field differences, and matching whole-view SHA-256:

`8d818b7540897c3e4c8bfd720161bebef7183c3356f7a068f79bb87936116f33`

After play stopped, a second ordinary restore and initialization exactly matched
the complete current checkpoint, without advancing it. `current-roundtrip.json`
records tick 4091, `exact: true`, `initialized: true`, outcome null, and matching
expected/actual whole-view SHA-256:

`740ac8c3ffbe94f53349529ee43ef47ea40083c298d288d34b3e39cc144ca59c`

### Visible Route Evidence

The original movement finished at (21,20), observed at tick 4010, before the first
new order. The QA planner tested all 14 original block-17 MTG cells, including
(76,45), with complete paths and candidate east/north passages. It did not route
to rescue spawn (85,44). Not every goal/passage was reachable under the filters:
the first decision produced 22 full candidates covering 11 distinct MTG goals
and passages (21,20)/(33,20); the next also admitted northern passage (25,10).
Threat input was restricted to currently visible hostile actors and their actual
public-checkpoint weapon ranges. Source placement positions were not used as
hidden enemy threats. Terrain/static navigation was the normal public path grid.

Five new public move orders were issued: tick 4010 to (29,24), 4030 to (18,25),
4040 to (29,26), 4060 to (18,24), and 4080 to (29,26). Every
chosen waypoint had its public path checked against the visible hazard mask.
Visibility changes caused east/west oscillation; this policy has not solved that
problem. At tick 4090, the visible threats included actor 7 near (30,21.594),
range 2, and actor 9 near (16.367,20), range 4. With two-cell safety margins,
the planner found no complete route with an admissible public waypoint and
latched its stop. The loop advanced one further tick before checking that latch.

The resulting checkpoint still has a queued move, not a public Stop command.
Any later continuation must reassess the current visible passage before stepping;
it must not assume the old queued path remains safe. The raw result calls this
`HARNESS_LIMIT` / `queued-route-stalled`, but it was a **visible-route gate**, not
a 300-tick stall, time expiry, commander death, or source LOSS.

### Integrity And Limits

The supervisor elapsed 87,814 ms, exit 1, no signal, `expired: false`, reaped.
The actual new stepping consumed approximately 2,875 ms of its 600,000 ms cap;
the recorded `steppingMs` 112,358.884 includes 109,483.396 from the input save.
Commands increased 362 -> 367; combat events 38 -> 39; deaths stayed 1 (historical),
with no new deaths, purchases, spending, income, or commander damage.

Runtime/source assets were unchanged during this run. `source.json` and
`integrity.json` retain all process-load hashes, including MissionView; the loaded
source identity SHA-256 was
`5f729f664f2204cc532f85d82f6afeca80106f98adf5ee5cecde3ce026230b1d`.
`final-audit.json` records the compact route evidence, checkpoint file hash,
loaded/after MissionView hashes, and no live owned launcher/supervisor/worker
PIDs (20358/20359/20360). The input file is unchanged. No runtime/source edits,
agents, full suite, hidden attack commands, or browser/native-parity claims.

The loaded and after-run MissionView SHA-256 were both
`16d9536a197935b088931df10da55ba516eea3a942771a5bdaf9e6615d9fa1b6`.
Current checkpoint file SHA-256 (the wrapper, not only the view):
`3980795bb96e5185329bc2518c76aba07bad21d863aa168a0e49ae7861aa3107`.
Final `cleanup-audit.json` found no owned run PIDs or remaining mission05 QA
processes. Five focused strategy/artifact tests passed in
`/tmp/dc-al05-artifact-final-1790167586009.log`; scoped strict types passed in
`/tmp/dc-al05-types-final-1790167613035.log`. Editor diagnostics were clean.

## Previous Attempts (Historical)

## Result

No ready WIN or pending-to-ready WIN proof was obtained. The first actual
continuation reached a source LOSS; the later continuation stopped before
stepping because the current runtime no longer restored the frozen save exactly.
Neither attempt exhausted its time budget. No cold opening or migration was run.

Input: `/tmp/dc-m05-frozen-20260923-r02/alien/checkpoint.json`.
Tick 4000, only block 4 fired, commander simulation ID 52, type 73,
728/800 HP at cell (21,18). The input remained unchanged throughout.

## Route Diagnosis

The actual saved commander speed is 188 subcells/tick. Its position is
(22016,19380) subcells, path index 2, reserved destination 2149, and queued path
is (22,18), (21,18), (21,19), (21,20). Thus the immediate legitimate action is
to let the existing movement finish at (21,20).

The old driver replanned every 10 ticks using three-cell waypoints. Simulation
move orders clear the previous path; if between centers, the replacement path
first returns to the current cell center. Repeated orders can therefore undo
partial progress. There is exactly one player-owned unit in this save, so the
escort loop is empty: self-bodyguard formation does not explain this case.

Original MTG block 17 has 14 cells, including (76,45), (75,47), and (81,51).
Original TRO block 17 spawns the rescued commander at (85,44); that spawn
coordinate is not itself the MTG trip target. Block 18 has 21 extraction cells,
including (77,44), (77,45), and (83,51). It abducts teams 7 and 0 and enables
the original delayed WIN block 19.

## Owned Changes

Only the mission05 QA driver, its tests, and this document were edited.
Moving units retain their queue; subsequent waypoints use up to 12 cells and
are checked against public-path routing and visible hazards. Occupied visible
unit cells are avoided. A 40-tick no-subcell-progress exception permits public
rerouting, while a 300-tick stall stops with precise movement evidence. Nearby
escorts are not ordered onto the commander. No hidden direct attacks are used.

Initial restore and post-initialization checkpoints must exactly match the
input. Any mismatch stops without a fresh fallback. Runtime and driver hashes
are captured at process load; no code was edited while an owned run was active.
The final driver saves every 100 ALIEN ticks and logs visible movement every 50.

## Actual Evidence

First stable run: `/tmp/dc-alien05-route-actual-1790166323114/alien`.
Both initial restore checks were exact. The whole-view SHA-256 was
`8d818b7540897c3e4c8bfd720161bebef7183c3356f7a068f79bb87936116f33`.
Only three new move commands were issued: tick 4010 to (29,24), tick 4080 to
(26,33), and tick 4150 to (26,43). The commander died at tick 4489, at
(25,39); death was observed on update 4490. Block 7 fired at cycle 4496,
and source LOSS became ready at tick 4697. Blocks 17/18/19 never fired.
The final status was SOURCE_LOSS, route17-unreached, not a deadline.
The final command's precise obstruction was not captured before death; it
must not be claimed proven to be a specific hidden unit or mine.

Supervisor elapsed 63,540 ms, exit 1, reaped. Source assets and loaded runtime
fingerprints stayed unchanged; no purchases, spending, or earned credits.

An intervening attempt, `/tmp/dc-alien05-route-recovery-1790166482708/alien`,
was externally interrupted during initialization and reaped after 10,573 ms.

Final isolated retry: `/tmp/dc-alien05-route-isolated-1790166528082/alien`.
It stopped at tick 4000 after 42,706 ms, before any order or simulation step.
The only checkpoint difference was `view.session.replayPolicy`: absent in the
input, but restored as `"current-population-v1"`. Restored hash:
`8d0acf417d4ed5cf0d32c6215560cb5d36a93beec833ebc520bb662db7a6ce9f`.
Runtime files campaign-session and campaign-session-legacy-import changed
between attempts. This is a current frozen-save compatibility regression,
not permission to migrate the current input. No runtime files were edited here.

## Verification And Next Action

Three focused route/bounds/field-difference tests passed; scoped strict
TypeScript and editor diagnostics passed. Final control logs:
`/tmp/dc-alien05-route-recovery-tests-1790166468574.log` and
`/tmp/dc-alien05-route-recovery-types-1790166468574.log`.
The visible-occupancy/40-tick recovery revision is unit-tested but has not
advanced the actual mission because exact initial restore now rejects it.

The compatibility owner must preserve the absent replayPolicy on this CURRENT
save; migration work on old saves must not silently rewrite it. Then resume
the unchanged tick-4000 input, finish the queued (21,20) target, and use the
tested cadence toward an original block-17 cell, followed by block 18.
If movement again stalls near (25,39), inspect the now-recorded visible
occupancy and queued next cell and issue a public lateral waypoint; do not
restart the same command at every decision or continue waiting under fire.

Acceptance still requires actual ready WIN and exact pending-to-ready restore.
Limits remain 600 s stepping, 900 s proof, and 1,140 s overall per run.
No agents, full suite, runtime/asset/funds/health/fog edits, or browser claims.
Final process audit `/tmp/dc-alien05-final-audit-1790166627065.json` found none
of the six owned supervisor/worker PIDs alive.
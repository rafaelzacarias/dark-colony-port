# M02 Collector Playthrough

## Scope And Strategy

QA-only changes. No runtime, asset, health, funds, fog, objective, enemy-order,
or source-script changes. Fresh actual browser-adapted HUMAN02 and ALIEN02;
public selection, command, purchase and harvest APIs only. NullCanvas search
does not establish browser pixels, audio or native timing parity.

The strategy prioritizes a missing live collector over infantry: dependency 7
(HUMAN type 6) or 21 (ALIEN type 14), source cost 1500. It respects the public
enabled flag, pending/queued counts, affordability and the collector exit
at base offset (-4,0). Once six troops exist, infantry spending retains a
1500-credit replacement reserve. No duplicate replacement is bought while
one is pending/queued. Newly delivered collectors use the existing visible,
active, finite, positive-rate, threat-screened public harvest path. Rear guards
now gather at the worker instead of halfway between worker and home. Existing
four-to-eight-unit expeditions and commander protection remain.

## Focused Verification

- 13 strategy/source-contract tests passed before the long runs.
- Scoped strict TypeScript compile passed for the fixture and both test files.
- Updated production controls admit explicit adapted collectors (120 visits),
  while retaining the actual original catalog, cost, queue and exit checks.
- Purchase controls cover both factions, insufficient funds, disabled source
  dependencies, pending/queued replacements, occupied exit, missing capability,
  replacement reserve, startup troops and army cap.
- Controls log: `/tmp/dc-collector-controls-1790130470288.log`.
- Evidence-capture compile: `/tmp/dc-collector-evidence-types-1790130496928.log`.
- Follow-up scout-footprint regression: 14/14 controls passed in
  `/tmp/dc-collector-scout-regression-1790131348901.log`.
- Final strict/no-unused compile passed:
  `/tmp/dc-collector-final-types-1790131372470.log`.

## Bounded Attempts

Fresh runs, maximum 36000 ticks. The first HUMAN attempt used 720000 ms stepping;
the separate ALIEN attempt used 850000 ms but stopped after about 40 seconds
on a runtime diagnostic. Rendering per event is disabled; final source render
dispatch remains. The fixture preserves command,
combat, economy, selector, objective, health and source-hash evidence. A compact
result is written before expensive final save/restore. A real WIN additionally
requires a pending-winning checkpoint and exact continuation to ready victory.

Runner log: `/tmp/dc-m02-collector-fresh-17901305.log`.
Runner completion: `/tmp/dc-m02-collector-fresh-17901305.exit.json`.
HUMAN journal: `/tmp/dc-m02-human-win-jhb017/journal.jsonl`.

HUMAN stepping finished at tick 14316 with harness status FAIL solely from
`QA wall-clock deadline exceeded (720000ms)`. Source outcome is null: not WIN
or LOSS. Objective 10/27, delivered/published income 12000, spending 10500,
credits 1500, 30 infantry purchases, 3780 shots, 55 total deaths, 290 player
commands. Commander health 648 at (61,53), original collector health 444 at
(68,48); neither required replacement. Currency balances exactly. The original
late team-2 selector activation was journaled at tick 14100 (observer cadence
20); all ten initial objective actors had died by tick 5000.

HUMAN artifacts in `/tmp/dc-m02-human-win-jhb017/`: `journal.jsonl`,
`result-summary.json`, `checkpoint.json`. The completed journal proves the
final tick-14316 exact checkpoint round-trip passed. Total test time was
1023770 ms, approximately 304 seconds beyond the stepping deadline for
save/restore/teardown. This overhead exceeded the intended run cost and led
to the early-proof harness follow-up below. A SIGTERM was sent to the owned
combined child after its long restore appeared unfinished in an earlier log
snapshot. The final log shows both mission results and both restore proofs
completed, followed by 13 cancelled trailing controls. Those cancellations
are not clean test passes; independent focused and short runs passed instead.
Diagnostic extraction: `/tmp/dc-collector-human-final-diagnostic-1790131290762.json`.

Concrete QA defect: the first source `placement:17` is depleted, while other
reserves remain 3500/3500/7000. Scouts repeatedly clicked the resource footprint
at (53,27), producing `blocked-command`, so the collector had no active harvest
order. The follow-up fixes scouting to choose a passable, footprint-free route
waypoint, tested against a blocked resource, map edge and unreachable grid.
It is a QA strategy fix, not a runtime repair. This edit occurred after the
bounded process loaded its modules; that process continued using its initial
strategy. No full-playthrough success is claimed for the scout follow-up.

## ALIEN Result And Runtime Handoff

Fresh final-policy attempt: `/tmp/dc-m02-collector-alien-fresh-17901317.log`,
exit code 1. Journal directory `/tmp/dc-m02-alien-win-ATZfv7/` contains
`journal.jsonl`, `early-checkpoint.json`, `result-summary.json`, `checkpoint.json`.

The first combined process also completed ALIEN with its initially loaded
strategy: `/tmp/dc-m02-alien-win-OVxQLs/journal.jsonl`. It reached the same
tick 1222, funds, health, objective and diagnostic, with 60 commands rather
than 61, and passed an exact final tick-1222 checkpoint round-trip. Its total
test time was 61718 ms. Its per-faction strategy-file hash was read from disk
after the scout edit, not from the already-loaded module; use the HUMAN
harness hash for that shared process's initial strategy. The separate fresh
ALIEN process removes that strategy-version ambiguity.

At tick 1222: harness FAIL, source outcome null, objective 0/6, credits 1325,
delivered/published income 1325, spending 0, purchases 0, shots 68, total deaths
1, public commands 61. Collector type 14/id 50 is alive at (4,79), health
800/800, extracting `placement:38`; commander type 73/id 51 is alive at (7,75),
health 800/800. Source reserves are 8175/3500/5000. No collector was lost or
replaced in either bounded attempt, so real replacement-after-loss execution
is NOT proven here; priority/affordability/queue guards are covered by controls.

Exact runtime diagnostic:

```json
[{"code":"invalid-input","message":"Invalid reservation unit"}]
```

Rejecting validator: [campaign-session.ts](../src/engine/campaign-session.ts#L2031).
Reservation producer: [mission-view.ts](../src/mission-view.ts#L1532).
Natural team-1 selector 4 -> 3 was observed at tick 1140. At tick 1220, carrier
slot 22 was approaching and slot 23 departing; player casualties were one
type-10 unit, not the collector. No production was involved. Next runtime fix:
capture the offending reservation slot/generation at 1222 and compare its
pre/post transport-update entity status; investigate a stale reservation for
an actor retired during the same session step. This is a hypothesis, not a
verified offending-slot identification. Do not bypass the source validator.

Detailed adjacent events:
`/tmp/dc-collector-alien-diagnostic-1790131682095.json`.
Saved reservation metadata:
`/tmp/dc-collector-alien-reservation-state-1790131712585.json`.

Reproduction, using a new unique label:

```sh
DC_M02_DEADLINE_MS=850000 DC_M02_RENDER_EVERY=0 DC_M02_VERIFY_RESTORE=1 DC_M02_RESTORE_AT=200 node /Users/rafael/Downloads/darkcolony/tools/qa/browser-campaign-playthrough-run.mjs alien 36000 win UNIQUE-LABEL
```

## Restore And Audit Limits

The follow-up harness supports one `DC_M02_RESTORE_AT` exact checkpoint proof,
preserves the final save, and avoids a redundant full non-winning restore.
Every actual WIN still requires pending-to-ready winning-boundary replay.
Both fresh 80-tick controls passed exact tick-40 round-trips (16/16 including
the 14 focused controls): `/tmp/dc-m02-collector-early-proof-17901316.log`.
Control journals: `/tmp/dc-m02-human-win-jOjwwi/journal.jsonl` and
`/tmp/dc-m02-alien-win-aaxJDq/journal.jsonl`. These are UNKNOWN controls, not wins.
The long ALIEN attempt passed an exact tick-200 round-trip. Its final tick-1222
save was preserved, not independently restored. No winning-boundary proof ran.
The initial ALIEN attempt separately passed final tick-1222 restore, and HUMAN
passed final tick-14316 restore. No source-ready outcome was produced by restore.

The read-only [journal auditor](../tools/qa/browser-campaign-playthrough-audit.mjs)
passed against all three attempts and both controls, checking real purchase prices,
funds, visible finite harvests and currency balance. Consolidated artifact:
`/tmp/dc-collector-complete-audit-17901320.json`.
Final owned-slice strict/no-unused compile passed:
`/tmp/dc-collector-handoff-types-1790131758856.log`.

No source-ready WIN was reached. HUMAN needs the tested scout-path follow-up
and enough post-reinforcement execution budget; ALIEN first needs the runtime
reservation diagnostic repaired by its owner. No runtime files were edited.

A QA wall-clock failure is not an original mission LOSS. An UNKNOWN bounded
outcome is not evidence that the mission is unwinnable.
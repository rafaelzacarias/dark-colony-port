# Mission 06 Recovery

## Actual Status

H06 now has a proven original-script browser-adapted win: pending at tick 1546,
ready at tick 1747, with exact pending-to-ready checkpoint replay. Stepping took
33.025 seconds and restore/proof 21.236 seconds, inside the unchanged separate
600/900-second budgets. Runtime and fetched assets stayed unchanged during this
run. A06 still has no proven win. No acceptance threshold was relaxed.

The source-backed trip fix and separate A06 census investigation are documented
in [mission06-trip-fix-20260923.md](mission06-trip-fix-20260923.md). Acceptance
artifacts: `/tmp/dc-h06-trip-acceptance-1790151891256/human/`.

## Prior Recovery Runs

H06 reproduced its first runtime failure at tick 295:

```json
[{"code":"invalid-input","message":"Unknown trip trigger 7"}]
```

The original HUMAN06.TRO has no trip block 7. The runtime reservation-trip guard
rejects that event. The QA worker did not filter events, reroute around the
failure, change the original script, or edit the runtime.

| Run | Status | Tick | Stepping | Outcome | Integrity |
| --- | --- | ---: | ---: | --- | --- |
| Recovered H06 retry | RUNTIME_BLOCKER | 295 | 5.843 s | null | unchanged |
| Prior A06 r2 | HARNESS_LIMIT | 9764 | 597.017 s | null | unchanged |
| New A06 retry | RUNTIME_CHANGED | 10247 | 597.028 s | null | concurrent runtime edits |

The new A06 run ended with no surviving mobile units, 750 credits, zero income,
and Citadel building slots 2,0 through 2,4 at 4800/2400/2400/2400/0. Before the
integrity check its play-result was HARNESS_LIMIT, not a source loss. Its final
status is RUNTIME_CHANGED because another worker changed
`src/engine/campaign-production.ts` and `src/engine/transport-host.ts` during the
run. Assets were unchanged. These independent changes were not undone.

## Runtime Evidence

The actual `sourceProductionPopulation(world, 0)` helper reports 26 registered
actors in the prior A06 checkpoint and 24 in the new checkpoint; both saved
worlds have `statistics["0,6"] === 0`. Selector 6 is registered population, not
kills. Original A06 block 14 requires `(s(0,6)>19)` before its reinforcements,
AI activation, and additional resource rates. This discrepancy needs runtime
owner investigation; the QA worker did not inject the missing census or force
the trigger. It does not prove that a corrected runtime would win.

Type 94 is supported as a stationary source vision artifact. No undocumented
LUNATEK deployment command was invented. Source movement fields, including
class-2 air, are used by the QA planner instead of hard-coded aircraft types.

## QA Changes

Only mission06 QA and this report were edited:

- Source-derived air classification with ground/auxiliary/stationary controls.
- Air approach destinations use source weapon range instead of the enemy cell.
- Collectors can scout resource coordinates from original timed `newrate`
  actions using ordinary public move orders, then harvest only visible sources.
- Acceptance artifacts must contain an actual pending win and ready win,
  identical source identities, increasing ticks, and exact checkpoint hashes.

Commands remain owned-unit selection, camera/order mode, public commandAt,
visible harvest, and enabled paid production. No enemy commands, actor/HP/fund
injection, fog changes, source changes, or result injection were used. The
NullCanvas loader harness is not a browser-input or native-executable parity
proof. The purchase policy can stall below collector cost after losing its
collector; this is a remaining planner limitation, not a runtime exception.

## Evidence And Checks

- H06: `/tmp/dc-m06-human-recovered-1790150375066/human/`.
- Prior A06: `/tmp/dc-m06-alien-owned-r2/alien/`.
- New A06: `/tmp/dc-m06-alien-recovered-1790150624811/alien/`.
- Consolidated receipts/census: `/tmp/dc-m06-final-evidence-1790151321525.json`.
- Final focused tests: `/tmp/dc-m06-proof-controls-1790150971251.log`:
  5 passed, 0 failed, 2 actual-win artifact tests skipped because no wins exist.
- Scoped strict typecheck: `/tmp/dc-m06-final-types-1790151048704.log`, exit 0.
- Final process audit: `/tmp/dc-m06-finish-audit-1790151292258.json`, no owned
  mission06 worker or completion observer remaining.

Stepping retained the 600-second hard supervisor budget. Restore/proof retains
its separate 900-second budget, but no win reached that proof phase. Both new
workers exited with code 1, no signal, and `expired:false`. No agents or full
suite were launched. Existing files and prior temporary artifacts were retained.

H06's trip-7 gate and unchanged pending-to-ready exact-restore acceptance are now
resolved by the follow-up above. A06 still needs its selector-6 aggregate census
refresh corrected and a separate original-script acceptance run. Full-game
completion remains unproven.
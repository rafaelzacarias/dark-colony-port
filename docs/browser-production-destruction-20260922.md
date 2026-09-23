# Browser-Adapted Colony Destruction

## Ownership And Accounting

The runtime change is limited to `campaign-session.ts` and
`campaign-production.ts`. No MissionView, main, game-data, simulation, transport,
asset, package or original mission source was edited for this fix.

`synchronizeBrowserProductionColony` is an explicit browser-adapted owner, not a
native destruction implementation. The session first applies the current
slot/generation combat update, records the source victim loss once, and publishes
raw host HP/status. Colony synchronization then requires those published fields
and a matching combat-death receipt before accepting a new zero-health building.
It rejects healing/construction, stale identities and native combat, task,
resource or construction owners. The strict-native colony mismatch guard remains.
Caller production commands still accept only reserve, release-pending and
dispatch; callers cannot submit destruction, refunds or producer-completion events.

For an owned production team, all five fixed colony health fields are refreshed.
DEPEND eligibility is recomputed after health or adapted `dfiddle` restrictions
change. Work that is no longer eligible is cancelled according to this explicit
adaptation:

| Boundary | Credits | Cost accumulator | Result |
| --- | --- | --- | --- |
| Reserved, not dispatched | Return exact DEPEND cost | Unchanged | Clear pending count |
| Dispatched, waiting to start | No refund | Keep spent cost | Remove cancelled ticket |
| Active FIN animation / incomplete allocation | No refund | Keep spent cost | Cancel head and its exit reservation |
| Unit already allocated with real receipt | No refund | Keep spent cost | Preserve spawned unit and occupancy |

The original infantry DEPEND remains satisfied when only central slot 0 is
destroyed and the slot-1 factory survives. That case preserves its active queue,
pending reservation and purchase availability. Destruction does not disable
unrelated source-eligible production merely because it belongs to the same team.

Native probes establish pending release and population-cap refunds, but not
producer-destruction refunds. This policy deliberately makes no native refund
parity claim. Existing native cap refunds and successful allocation accounting are
unchanged. Historical evidence:
[production runtime audit](production-runtime-audit.md) and
[production contract](campaign-production.md).

Only a cancelled active ticket's exact session/team/queue/ticket/type/tile
reservation can be released. Its sentinel changes from 1022 to host-empty -1
(low ten bits 1023); no other queue or allocated unit is cleared. A destroyed
adapted factory subsequently performs no producer visit work. The unit choices
consume the recomputed eligibility, so unavailable purchases are disabled.

The death update remains the owner of statistics and status 10. A base is not a
commander and is not automatically unregistered or collected. The simulation's
existing real death processing releases building footprints before host feedback;
this change adds no corpse obstacle. TRO building predicates see world and
production health zero without any objective injection or credit award.

Frame ordering remains engine death, session updates, cancellation, producer
visit. Thus death on the would-complete frame prevents allocation without a
refund; death after allocation preserves the actual unit and its paid cost.
Original HUMAN02 LOSS still requires the original all-five-slot base predicate
or the original type-86 loss predicate. `s(0,10)` is not a base-health alias.

## Checkpoints

Destruction and restriction changes replay through the complete saved source
caller history; no externally supplied refund or cancellation callback is added.
Before, active, queued, after-allocation and after-destruction JSON saves are
checked for exact continuation. Failed later commands roll the complete staged
death, statistic, refund and reservation release back together.

The older actual endjudge saves predate the casualty-owner metadata. A narrowly
bounded migration admits an absent browser casualty marker only for explicitly
adapted saves with no casualty collection state and no consumed commander loss.
It adds only that marker and still requires complete source caller replay equality
for every other field. It does not clear diagnostics or repair corrupted state.

The private shared-history/fork implementation is unchanged. Colony cancellation
runs only when health or restrictions change, not on every idle frame.

## Verification

All 34 focused controls pass in
`/tmp/dc-production-destruction-final34-r1.log`, including two legacy-save
migration controls, another team's reserved exit, and survival of source-eligible
production after slot-0 death. Scoped strict
TypeScript with noUnusedLocals/noUnusedParameters passes in
`/tmp/dc-production-destruction-final-types-r6.log`.

Neighboring checks: 58/59 pass in
`/tmp/dc-production-destruction-neighbors-r1.log`, including all 19 production,
15 session-economy, four sharing and nine M02 source/strategy controls. The one
failure is the existing adapted-TRO opening census expecting six type37 failures
that no longer occur; it does not exercise production and was not changed here.
Seven existing strict-native session/FIN/accounting controls also pass in
`/tmp/dc-production-native-session-guards-r1.log` (the 20k idle stress test was
not selected).

Run the focused controls:

```sh
node --import tsx --test tools/qa/campaign-production-destruction.test.ts
```

## Actual HUMAN02 Resumption

The diagnostic final save at simulation tick 17877 is retained unchanged. The
healthy existing `/tmp/dc-m02-human-win-DoSizD/checkpoint.json` at tick 4110 has
identical source options and all 4110 caller inputs exactly equal to the prefix of
that final endjudge save. The opt-in
[resumption test](../tools/qa/campaign-production-endjudge.test.ts) uses actual
`MissionView.restore`, original assets and the old journal's public commands.
It writes and restores a full file-backed checkpoint at 17876, then compares
continuation through 17900 and restores the final checkpoint again. It never
edits save health, credits, objectives or diagnostic flags.

The new pre-destruction file is
`/tmp/dc-production-endjudge-resume-4xGf5D/before-destruction.json`.
An independent comparison found all 17876 caller inputs exactly equal to the
original endjudge prefix. Actor 19 is slot 0/generation 0/key `colony:0`, with
actual simulation health 4 of 4800; objective is 11/27, credits 30, dispatched
cost 5250. Source hash remains
`809e3d82939c7a133547127a4a36394f24efb5058fd7f38d934368b7e8bc7540`.
Comparison artifact: `/tmp/dc-production-endjudge-boundary-evidence-r1.json`.

```sh
DC_PRODUCTION_ENDJUDGE=1 node --max-old-space-size=8192 --import tsx --test tools/qa/campaign-production-endjudge.test.ts
```

The actual continuation reaches **17900 without a diagnostic**. The restored
17876 view and the uninterrupted view have identical complete checkpoints at
17900, with per-frame simulation/progress equality across the death boundary.

| Actual HUMAN02 state at 17900 | Value |
| --- | --- |
| Original objective | 11/27 |
| Outcome | null, neither WIN nor LOSS |
| Actor 19 / slot 0 / type 16 | HP 0, status 10, retained body |
| Source type-16 victim losses | Exactly 1 |
| Production slot 0 / slot 1 health | 0 / 2400 |
| Source income / dispatched cost / current credits | 5280 / 5250 / 30 |
| Paid purchases / unique deaths / shots | 15 / 71 / 3595 |
| Pending / active production | None at this actual boundary |

The surviving slot-1 factory means the original all-five-slot loss condition is
false. No outcome was invented to replace the previous diagnostic. Active queue
cancellation is proven by the focused controls, not falsely attributed to this
actual run, whose queue was already empty. Post-destruction artifact:
`/tmp/dc-production-endjudge-resume-4xGf5D/after-destruction.json`; independent
accounting extract: `/tmp/dc-production-endjudge-after-evidence-r1.json`.

The last full restore of the 17900 file **passes**, and the owned test exits 0.
Result: `/tmp/dc-production-endjudge-resume-4xGf5D/result.json`;
log: `/tmp/dc-production-endjudge-owned-r2.log`; exit record:
`/tmp/dc-production-endjudge-owned-r2.log.exit.json`. The uncached final capture
is `/tmp/dc-production-endjudge-fresh-result-r4.json`.

[The compact result artifact](browser-production-destruction-results-20260922.json)
records the accounting, source hashes and validation boundaries. The harness
reports UNKNOWN only because 17900 is the selected tick limit; diagnostic and
outcome are both null. This is a **PASS for the reported runtime blocker**, not
an M02 victory, browser rendering, full campaign completion or native destruction
parity claim. No agents, browser, full suite, packages or asset changes were used.
# Refined Legal M02 Strategy

Scope: QA fixture, tests and documentation only. No runtime, original data,
funds, health, fog, enemy orders or trigger edits. No agents or external browser.

## Confirmed Missing Capability

The actual original loader and initialized public view expose only infantry
production: HUMAN dependency 9/type 0, ALIEN dependency 23/type 8, cost 350.
Both start with zero credits, so disabled initial infantry is expected.
Collectors are absent from the menu, not merely disabled for affordability:

| Faction | Collector | Source dependency | Cost | Queue | Exit offset |
| --- | --- | --- | --- | --- | --- |
| HUMAN | EXPL/type 6 | 7 | 1500 | 2 | (-4,0) |
| ALIEN | SLUG/type 14 | 21 | 1500 | 2 | (-4,0) |

These are decoded catalog IDs, not guessed UI or dependency indices.
All source unit queue records load, but
[producerProfiles](../src/engine/source-production-options.ts#L52) creates
only one base-infantry profile per race. The
[profile type and validator](../src/engine/campaign-production.ts#L34)
admit only types 0/8. The
[production choice filter](../src/engine/campaign-production.ts#L335)
marks other source units unsupported, and
[the public UI projection](../src/engine/source-production-options.ts#L149)
removes them. Producer visits are also restricted to queue 0. Loading arbitrary
additional FIN records alone is therefore insufficient. Restoring collector
purchase requires source-proven queue-2 production, profile validation, producer
visits, allocation and public menu support in the owning runtime, outside this
QA task. No fake profile, purchase, replacement spawn or resurrection is used.

Actual-view evidence: `/tmp/dc-m02-human-win-5s0iOj/journal.jsonl` and
`/tmp/dc-m02-alien-win-r5TVqz/journal.jsonl`, `production-capability` events.
Both 80-tick starts and exact checkpoint round-trips passed in
`/tmp/dc-m02-refined-smoke-17901226.log`. This proves a missing replacement
feature, not that every legal strategy is unwinnable with the original collector.

## Strategy And Checks

Stable expeditions use 4-8 troops, retain their membership while at least four
survive, and regroup depleted survivors. At least two nearby troops remain
outside a new expedition. The commander stays near home; guards protect home
and the collector; harvest targets must be active, visible, finite and free of
nearby visible enemies. Purchases require earned credits and a clear original
infantry exit. Routes approach source-known objectives through passable cells
outside static footprints. No invisible attack bypass is used.

Original HUMAN02 requires 27 team-2 victim losses, including the natural
17-actor reinforcement at tick 14096. ALIEN02 requires six team-1 type-86
communication-site losses, not arbitrary structures. Commander death alone is
not rewritten as mission LOSS. Only an original ready outcome counts as WIN.

Ten focused tests passed (`/tmp/dc-refined-unit-1790122541556.log`), including
wave size, stable membership, retreat threshold, original goals and result
classification. Strict compilation of the three touched QA TypeScript files
passed (`/tmp/dc-refined-types-1790122952337.log`).
Both 80-tick public command replays and final checkpoint round-trips also passed
(`/tmp/dc-refined-replay-1790123423753.log`). These are short UNKNOWN-outcome
controls, not winning replays or browser presentation acceptance.

## Bounded Attempts

The first strategy uses at most 16000 ticks and 600000 ms per faction, actual
loader assets, NullCanvas search, public commands and unchanged original rules.
Exclusive execution log: `/tmp/dc-refined-wave1-owned-17901231.log`.
HUMAN intermediate evidence at tick 10000: objective 10/27, earned 10846,
23 purchases costing 8050, credits 2796, collector health 800, no diagnostic,
358234 ms elapsed. All ten initial goal actors were eliminated; the remaining
17 require the original late reinforcement. Journal:
`/tmp/dc-m02-human-win-wEHVKn/journal.jsonl`.
HUMAN completed at tick 14075: QA FAIL solely from the 600000 ms deadline,
objective 10/27, no original outcome, 2033 shots, 52 deaths, 27 purchases,
spent 9450, income 12000, credits 2550. Commander and original collector
survived. Final checkpoint round-trip passed. Total test time was 782008 ms,
including approximately 182 seconds outside the stepping budget for save,
restore and teardown. This is not an original mission LOSS or proof of a
runtime logic defect. It stopped 21 ticks before the source late activation.

ALIEN intermediate tick 5000: objective 0/6, income 6050, 17 purchases,
100 credits, original collector alive and extracting, eight expedition actors
advancing. Journal: `/tmp/dc-m02-alien-win-6w7OKV/journal.jsonl`.

The second and final tactic canonicalizes group IDs to suppress redundant
orders, uses move to regroup, scouts the next active source with 4-6 guards
before permitting visible harvest, and approaches the literal HUMAN late
reinforcement location after initial goal actors are cleared. Ten controls and
strict compilation pass in `/tmp/dc-refined-wave2-controls-17901243.log`.
The test harness now requires a genuine pending winning outcome checkpoint
and exact restored continuation to the final ready state for any new WIN.
That winning-only branch has compiled but has not yet run to a real victory.

No victory, winning replay or general mission failure is claimed here.
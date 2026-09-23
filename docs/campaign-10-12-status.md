# Campaign 10-12 Status

2026-09-23. Owned files only: [shared driver](../tools/qa/campaign-10-12.ts),
[focused tests](../tools/qa/campaign-10-12.test.ts), and this report. Runtime,
source assets, costs, funding, counters, enemy control, and existing fixtures
were not edited by this work. No agents or full suite were launched.

## Actual Results

Original-source, current `browser-adapted` loader and public `MissionView`
commands, using the existing source-render NullCanvas fixture. These are Node
simulation replays, not browser visual or original executable parity proofs.

Artifact root: `/tmp/dc-campaign-10-12-owned-20260923-r01`.
The root `group.json` records six reaped workers and **487034 ms** total play
wall time, within the 600000 ms group limit. No ready WIN was obtained;
therefore no pending-to-ready restoration ran. Restore allowance: 480000 ms.

| Mission | Literal source WIN | Actual result | Next blocker or limit |
| --- | --- | --- | --- |
| H10 | TRO18: team 2 city slots 0..4 all zero | Bounded, tick 1761; 180 map commands, 198 shots; 1914 earned | Assault incomplete. SARGE income is live, not a missing feature. |
| A10 | TRO1: team 1 city slots 0..4 all zero | Runtime blocker at tick 0 | `Browser research: source research dependency mismatch`; no public play reached. |
| H11 | TRO12: `s(1,3)==7` after trip9, or trip13 `S==0` after TRO11 | Ready source LOSS, tick 5193; 202 map commands, 679 shots, 21 deaths | Commander killed; team-1 loss count stayed 0. Strategy failed; no proven runtime blocker. |
| A11 | TRO3: team 1 city slots 0..4 all zero | Bounded, tick 2137; surviving infantry/aircraft attacking near city | Assault/economy incomplete. Trips12/16 only display messages; neither wins. |
| H12 | TRO3: teams 1 and 2 city slots 0..4 all zero | Bounded, tick 411; 30 map commands, no shots; 330 earned | Short real-play window; no proven runtime blocker. |
| A12 | TRO6: teams 2 and 7 city slots 0..4 all zero | Bounded, tick 81; production requested, no map commands/shots; 75 earned | Startup consumed the bounded window; no proven runtime blocker. |

H11 fired source blocks 1, 9, 10. Block9 disables 11 and enables 12; killing
the seven team-1 units must then satisfy block12. The alternate ordering kills
them first, fires block11, disables 9 and enables trip13. Ordinary player troops
may trip these `S==0` conditions; neither requires a special artifact unit.
This driver reached trip9 but did not kill the required team-1 units before
the commander's source loss. It never wrote the loss counters or trigger lives.

## Main Repair Handoff

### Research Loader Repair

2026-09-23: the original A10 regression reproduced the constructor diagnostic
with `sourceProduction.production === undefined`. Empty player city/factory
slots make production unavailable; they do not remove the source DEPEND table.
The research owner was incorrectly receiving `[]` from that optional catalog.
The source factory now prepares a separate research configuration from the
whole SHA-256-authenticated DEPEND asset. MissionView consumes that configuration;
the existing research definition, price, prerequisite, owner and source guards
are unchanged. No production capability, source asset, credit or cost changed.

The immediate original A10 constructor + initialize regression passed (1/1,
`/tmp/dc-research-a10-fixed-20260923-02.log`). Final focused verification passed
**8/8 tests, zero failures/cancellations/skips**, in 20.136 seconds:
`/tmp/dc-research-owner07-1790187301928.log`. Strict scoped TypeScript exited 0,
with an empty `/tmp/dc-research-owner07-1790187301928.log.types.log`.
The isolated launcher receipt is `/tmp/dc-research-owner07-exit.json`;
both child processes exited 0 without signals.

- Original A10 actually initializes and advances 200 ordinary 50ms updates
	without diagnostic; full checkpoint JSON restore is exact, followed by eight
	equal continuation updates. Player credits remain 1500. Original SCN hash,
	restrictions `[34,53,55]`, unchanged mission data and 300 fetched assets
	(including source map layers) are checked. DEPEND14 remains 2000.
- All 30 original missions load and initialize their session research observer,
	including those without production. This is **not** 30 full MissionView
	playthroughs or a new campaign completion result.
- Changed DEPEND14 price, an unrelated DEPEND21 record, byte-only changes and
	forged configuration objects reject. Existing definition, health/actor,
	source/owner, research save and discovery controls pass.

Runtime changes are limited to the new
[source research owner](../src/engine/source-browser-research.ts), its prepared
configuration in [the source factory](../src/engine/source-browser-campaign-options.ts),
and the single configuration-selection expression in
[MissionView](../src/mission-view.ts). The validator in
[browser-research.ts](../src/engine/browser-research.ts) remains unchanged.
Focused tests: [source loader](../tools/qa/browser-research-source-loader.test.ts)
and [existing owner controls](../tools/qa/browser-research.test.ts).
Node/NullCanvas only; no browser, agents, full suite, money grants, price changes
or source-asset edits. No first-hive purchase or WIN is claimed. Funding remains
unresolved: **1500 available versus 2000 required, a 500-credit deficit**.

The earlier group run's A10 failure was the research configuration validator in
[browser-research.ts](../src/engine/browser-research.ts#L54), which requires
canonical dependency prices, raw fields, and prerequisites. The exact exception
is recorded in `A10/result.json`. That historical driver run stopped at
initialization; its artifacts have not been rewritten by this repair.

The separate original first-hive question remains unresolved:
1500 starting credits versus the 2000 DEPEND14 central price. No funds, price,
free construction, enemy control, or allied income transfer was invented.
The intended public call is `purchaseConstruction(14)`, but this run did **not**
reach it. Original A10 TRO6 supplies a commander after `c>20`; it contains no
explicit collector/base/money grant before the no-city loss at `c>180`.
See [the native funding investigation](alien10-first-hive-economy-20260923.md).
An initialization repair is necessary before this driver can test another
legal route; it is not evidence that a funding workaround exists.

## Commands And Evidence

All map orders use `replaceSelection([ownedId])`, `setCameraCenter`,
`setOrderMode("move" | "assault")`, `cursorAt`, and `commandAt` with the
existing fixture's coordinate conversion. Attack commands require current
visibility and hostile targets. Original SCN/TRO/MTG coordinates are allowed
only as move/scout destinations, not hidden attack targets. No simulation
queue, health update, statistic update, enemy selection, or trigger override
is used.

Economy/production use `harvestSelected(sourceSlot)` on visible resources and
affordable `purchaseProduction(dependency)`: human collector7/infantry9,
alien collector21/infantry23. Source type4/type12 uses `stopSelected()` followed
by `deploySelected()`. H10 air scouts original trips1/2/5, which supply SARGE
units. Deployment and earnings are journaled. A11's original opening and
commander recovery are allowed to run without altered timers or grants.

Each mission directory contains `source.json` (SCN/TRO/TXT hashes and literal
objectives), `journal.jsonl`, `result.json`, `integrity.json`, `exit.json`, and a
unique `play-*.log`. Successful initialization additionally writes `initial.json`,
`latest.json`, `checkpoint.json`, and `campaign-journal.json`. A10 correctly has
no initialized checkpoint. The launch receipt is
`/tmp/dc-campaign-10-12-owned-20260923-r01-exit.json`: supervisor exit0, no signal.
Worker exit0 means evidence was written, **not** mission victory.

The shared driver implements full JSON pending restore, exact immediate
checkpoint equality, natural continuation to ready WIN, and whole-ready-save
equality. None of that is claimed exercised here because no mission won.
Only a successful proof plus unchanged integrity can upgrade a result to WIN.

## Verification

Initial seven literal-source/permission checks passed:
`/tmp/dc-group1012-contract-a1-1790179240479.log`.
Initial scoped TypeScript check passed with an empty log:
`/tmp/dc-group1012-types-direct-a4.log`.

The expanded test file contains all-six artifact permission checks, hard budget
guards, and an all-30 current-loader source-hash check. Follow-up validation
was affected by shared-terminal command replacement and interrupts; an isolated
attempt hit its 60-second cap. **Do not count the all-30 check as passed from
these interrupted logs.** The initial scoped compiler result predates the
expanded artifact tests. Final verification details are recorded below when
an attributable completed run is available.

Reproduce from the repository root (this starts a new, separately budgeted run):

```sh
node --import tsx tools/qa/campaign-10-12.ts --run --output=/tmp/dc-1012-NEW-UNIQUE
DC_1012_ARTIFACTS=/tmp/dc-campaign-10-12-owned-20260923-r01 node --import tsx --test tools/qa/campaign-10-12.test.ts
node --import tsx tools/qa/campaign-10-12.ts --audit --output=/tmp/dc-campaign-10-12-owned-20260923-r01
```

**Verified campaign wins in this group: 0/6. No all-missions completion claim.**
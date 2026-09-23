# Bounded Player Harvest

## Integrated Follow-Up

The app's ES2022 configuration now passes: runtime imports follow repository
conventions and native path reversal uses a copied array rather than ES2023-only
`toReversed`. The final integrated gate passed 1,534 tests, zero failures, four
skips, plus typechecking and build. Earlier compiler blockers below are resolved.

Successful native Move/Harvest/Stop returns to context selection. Staged frames
own an independent CombatMovementOrders instance; late failure cannot consume a
live pending infantry intent. Both issues have focused regression coverage.
Cursor preview uses a one-entry cache keyed by session/tick, actor ownership,
mode and target/source identity; actual commands never trust the cache.

Real embedded browser source-separated fixture: zero initial credits, 352 earned,
350 spent, one source-profile troop produced, deployed save/restore, Stop/retraction
and a new move with the same harvester ID. Native frame sampling resets looping
movement to frame zero when turning selects a shorter direction bank. Human/alien
per-update FIN regressions and a second browser round trip pass without missing
timeline warnings. Desktop/mobile-width rendering was checked and fixtures removed.

This does not attach `nativeHarvest` to the default original mission loader or
admit original HUMAN02/ALIEN02. Their active AI and shared-world prerequisites
remain unresolved. The bounded factory still requires explicit source-separated
configuration; there is no fake original campaign or silently removed script.

## Enabled Contract

`MissionView.commandAt` now routes a visible neutral VENT hit to native Harvest
for one selected configured harvester. `harvestSelected(sourceSlot)` exposes the
same command without pointer coordinates. VENT remains team 8, identified by
slot/generation/key, outside combat simulation. The existing `move` cursor is
used; no unverified dig-frame mapping or main-panel button was added.

The native movement reducer owns the actual actor. The simulation reports
`activity: "move"`, has no browser path, weapon or generic harvester, and stores
the native raw220/movement snapshot under its external resource owner. Host
visits run in registered slot order, including sources before or after the
mobile. Native arrival publishes idle/wait directly; deployment changes the
same simulation ID to 47/48 with current source stats and FIN. Credits, income,
reserve, retraction and removal come from the existing resource host.

Commands admit only one active bounded route at a time: straight 1-3 cells,
all eight directions, same nonzero PTH family, clear owned ground and secondary
planes, no trip cells. Admission also checks that source activation does not
precede native idle arrival. Far, occupied, multi-leg, busy and unsupported
routes return a command diagnostic/blocked cursor without modifying either
graph or killing the mission. There is no teleport or browser path fallback.

Stop queues native order13. Turning/stepping finish at the native acceptance
boundary, including Stop after entering the destination cell. Release is
acknowledged with the actual idle/wait payload. The next frame reclaims native
idle ownership; another native move can also claim directly after release.
Stopping on an active VENT does not disable its native activation rules.

## Required Fresh Configuration

Use `sourceBoundedHarvestConfiguration` from `source-resource-options.ts`, then
attach its result to `mission.sourceResource.resourceLifecycle.nativeHarvest`.
It requires:

- Explicit `scope: "source-separated-bounded"` and an evidence label.
- Full original PTH bytes, dimensions, actual MTG tags, verified VENT/EXPL/SLUG
  FIN metadata, source unit census, and source bank addresses for each type.
- Explicit native raw220 idle bindings with slot, generation, ground word,
  RNG index and `constructor` or `restored-idle` provenance. Constructors check
  the source 160/128 headings and fresh task/animation fields.
- The normal source resource lifecycle, complete side/frame configuration,
  SCN money and eight initial income values. No funds are granted by this flow.

The generated configuration carries executable/PTH/FIN fingerprints and
`randomScope: "isolated-index-no-draws", sharedRandomDraws: 0`. Index zero is
only used by the explicitly labeled seeded test profile; it is not inferred
for a native global mission. Both mover and idle preserve the supplied index.
Session admission checks the profile against its actual PTH/MTG and census.

## Atomicity And Saves

Commands stage session/simulation candidates. Bounded frames fork view state,
session and simulation; failed publication or a late frame failure discards
the candidate. Presentation callbacks run after commit. No native Inspire
callbacks or synthetic movement-finished events are introduced.

New bounded saves use view version2, session snapshot version3 and simulation
version2. Existing versions remain accepted. View restore requires the same
fresh mission/configuration and validates cross-graph actor identity, task,
position, source type and health. Session restore checks raw aliases, immutable
movement profiles, banks, reservations and unchanged isolated RNG. Movement,
idle/wait, deployment, retraction, release, task10 and unregister are covered.

## Focused Acceptance

`tools/qa/bounded-harvest-player.test.ts` uses the real HUMAN02 VENT row
`[69,48,40,22,12000]`, original PTH/MTG/FIN and explicitly seeded human/alien
harvesters. Tests issue public pointer/Harvest/Stop commands in both source-first
and mobile-first orders. Initial credits are zero; earned native income funds
an existing source base-production purchase at its original cost. No exomoney
action or funds grant is used. A separately labeled reserve22/HP270 fixture
tests near-depletion removal without pretending it is a fresh original SCN.

Tests cover blocked commands, constructor headings, movement Stop, Stop in the
destination cell, post-release idle, phase restores, tampered saves and a late
failure with unchanged view/session/simulation graphs.

Final focused run: 67 passed, 0 failed across the player-command, live resource,
resource ownership, idle/wait checkpoint, original-native host, live production
and resource session lifecycle tests. No agents, browser or full suite were run.

## Remaining Gates

- Unchanged original HUMAN02/ALIEN02 TRO/AI admission remains blocked; no trigger
  filtering is done by the application. Source-separated tests are labeled.
- Global native RNG ownership, dynamic replanning, longer/multi-leg routes and
  concurrent bounded moves are not admitted.
- Native harvester combat is not certified. Existing external-owner combat
  rejection remains in force; no weapon or generic damage fallback is added.
- Browser timing and visual QA were not run, as requested.
- Project `npm run typecheck` currently has unrelated native-module compiler
  blockers: `.ts` imports in legacy AI with the app's flag disabled, and
  `legacy-harvester-movement.ts` using `toReversed` with project lib ES2022.
  The touched slice is checked with ES2023 and `allowImportingTsExtensions`.
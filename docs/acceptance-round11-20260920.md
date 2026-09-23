# Acceptance Round 11

2026-09-20. Independent evidence audit, updated by a docs-only reconciliation
of the five owned round11 documents. No subagents, code edits, test execution,
full-suite rerun or browser execution by this auditor. Browser outcomes below
are main-verified evidence, not an independent browser rerun.

**Phases 1-2 remain accepted in their pinned scope. Phases 3-5 remain partial,
not accepted. The requested all-phases-accepted goal is not met.** Original
acceptance gates are unchanged; bounded proofs do not replace them.

## Read Gates

| Evidence read | Actual outcome |
| --- | --- |
| `/tmp/dc-round11-verified-20260920.log` | **Latest completed `npm run check`: 2,510 tests, 2,506 passed, zero failed, four skipped. Typecheck and production build passed.** JS bundle 573.75 kB, gzip 180.54 kB; Vite's over-500-kB warning remains. |
| `/tmp/dc-round11-recheck-20260920.log` | Superseded earlier `npm run check`: 2,494 tests, **2,490 passed, zero failed, four skipped**. Typecheck and production build passed. JS bundle 572.87 kB, gzip 180.23 kB; over-500-kB warning. |
| `/tmp/dc-round11-combat-final-20260920.log` | Superseded failed attempt: typecheck stopped at TS18047, `observer.rawSlot` possibly null in the science fixture at then-line 114. No test totals or build success recorded. **Never a 2,503-pass gate.** |
| `/tmp/dc-round11-private-source-20260920.log` | Focused combat-source run: **nine tests passed, zero failed, zero skipped**. Includes private/shared byte snapshot controls; comparisons report four fire rows, nine projectile rows, five reuse rows. |

The completed verified gate supersedes the earlier pending-gate finding. The
science fixture guard now rejects both null and undefined (`observer?.rawSlot ==
null`). The earlier failure remains a historical outcome, not a current blocker.
The nine-test combat proof covers the review TOCTOU fix: source/registry bytes,
including SharedArrayBuffer-backed inputs, are privately copied before the first
await so authentication and parsing consume the same detached snapshots.

## Current Scope

- Existing legal HUMAN01 and ALIEN01 workflows are real original first-mission
  paths, not merely a sandbox. Their bounded command/API evidence does not
  establish manual-input campaign completion or native gameplay parity. Existing
  transports and classified static occupancy are not missing wholesale; see
  [prior phase gates](phase-acceptance-20260919.md) and
  [source playthroughs](source-playthrough-20260919.md).
- [Source task options](source-native-task-options.md) authenticate actual source
  bundles and the complete fresh world. The initial transport handshake now calls
  `validateSourceNativeWorld` before constructor writes. This supersedes fixture-only
  configuration and unwired-attestation claims, not general mission admission.
- [Science CITY](campaign-session-city-20260919.md) now reaches the session and
  [MissionView](../src/mission-view.ts): both races have source-bounded paid
  receipts, exact registered visits and restore coverage. The
  [observer tests](../tools/qa/science-construction-observer.test.ts) also assert
  ordinary local sight and missing-visit rollback. There is no public Build
  dispatch: `constructionMenu.requestEnabled` remains false. This fixture is
  seeded with 6,000 credits, team1 and six linked witness actors, with an optional
  local team0 observer; it is explicitly not original mission02 admission.
- [Fire](native-fire-owner.md) and [projectiles](native-projectile-owner.md) have
  pure ordinary-fire/nonlethal owners with strict complete-pool validation.
  They are not absent, but the new combat ownership is not admitted through the
  live host/session. Orphaned pool records are not accepted to rescue old traces.
- [Damaged actors](native-damaged-actor.md) now implement ordinary type-0/8
  nonlethal feedback and have **332 registered visits
  (224 target, 108 shooter) plus 14 projectile passes** across eight native cases.
  Dedicated targets cover idle, interrupted wait and pending Stop. Damaged moving
  or firing targets and a retaliating duel remain unproved; lethal damage and
  death/unregistration are not admitted. Providers do not emit the required
  reaction banks; live host/session admission remains closed.
- [Combat source proof](source-native-combat-options.md) authenticates type 0 /
  weapon 1 and all 106 registry FIN files. Travel/impact FIN absence is proved
  from that complete source registry, not missing transport data or fabricated
  zeros. The proof and fragment retain `runtimeReady: false`; complete target
  tables and transactional combat ownership remain open. Current code copies
  source and registry byte arrays privately before its first await, including
  SharedArrayBuffer-backed inputs; the nine-test log covers this latest repair.

## Browser Boundary

Main verified both factions' observer fixtures in the shared embedded browser
under normal fog/source sight. These are **main-verified bounded fixture results,
not independently reproduced or browser-complete acceptance**.

| Fixture / Frame | Main-Verified Outcome |
| --- | --- |
| Human50 | Nonblank, 27,615 colored pixels. |
| Human70 | Nonblank, 41,202 colored pixels; exact checkpoint restore and missing-visit rollback true. |
| Human186 | Complete, busy0/latch0, task1, HP2400, auxiliary removed; 23,244 colored pixels. |
| Alien initial attempt | Failed: WARHIVE/BIOHIV archives missing. Fixed `missionAnimationArchives` to include both through ALBU, with two regression tests; superseded by the successful rerun below. |
| Alien70 after fix | Nonblank, 51,336 colored pixels; restore equality, missing-visit rejection and unchanged state all true. |
| Alien195 | Nonblank, 51,469 colored pixels; busy0, latch1, phase3, auxiliary generation1, departing true. |
| Alien246 / mobile | Complete, busy0/latch0, task1, HP2400, auxiliary removed; 27,375 colored pixels. At viewport390, canvas spans x12..363 (width351), with no horizontal overflow; screenshot inspected. |

The reusable [science browser QA fixture](../tools/qa/fixtures/science-browser.ts)
uses the labeled seeded 6,000-credit/team1/six-linked-witness setup and optional
local team0 observer. It does not admit original mission2. Mode2 WARHIVE warnings,
mirrored/elevated mode5 source effects and global presentation ordering remain
open: **no full visual parity**. There is no sustained 60 FPS, memory or
cross-device claim. The temporary views and globals were disposed and removed;
the shared browser returned to the launcher at width1440, retaining the existing save.

## Superseded Audit Findings

The initial audit found source-task documentation delegating transport wiring,
CITY documentation denying visual/view checkpoint integration, and combat-proof
documentation treating the next damaged visit as blocked wholesale and reporting
eight tests. Those were stale slice summaries: the
[host](../src/engine/transport-host.ts) installs the guard, MissionView/observer
integration exists, and bounded damaged continuation plus nine combat-proof
tests are now recorded. This docs-only update corrects all three documents.
The original two-file audit and its pending replacement-gate/alien-browser
findings are superseded by the evidence above, including frame246/mobile.

## Next Acceptance Gates

1. Preserve the distinction between bounded fixture evidence and original mission
  admission. The replacement full gate and both-race construction browser checks
  are recorded above; explicit skips and the bundle warning remain.
2. Admit source-complete combat profiles and actor/projectile state through an
   atomic live host/session with shared RNG scheduling and checkpoint replay;
   prove damaged moving/firing targets and lethal/destruction lifecycles before
   enabling them. Keep original mission2 AI blocked until policy, tasks, paths,
   acquisition, production/occupancy and shared scheduling are jointly owned.
3. Complete unrestricted harvesting, construction/interruption, upgrades and
   abilities; finish global presentation ordering, mirrored/elevated effects,
   remaining modes and ambient scheduling under the original gates.
4. Demonstrate ordinary-input later-campaign completion, independent original-game
   comparisons, WebKit/iOS/device behavior and sustained rendering/memory budgets.
   Test totals, the bundle build and observer screenshots cannot certify these.
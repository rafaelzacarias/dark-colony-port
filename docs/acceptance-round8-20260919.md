# Final Delta Acceptance, Round 8

## Final Orchestrator Results

This addendum supersedes the pending verification/cleanup statements below.
**1,534 tests passed, zero failed, four skipped; typecheck and production build
passed.** Current editor diagnostics are clean. Phases 1-2 retain their accepted
scope; Phases 3-5 remain unaccepted for the reasons in this independent review.

Embedded browser checks used the explicitly source-separated fixture, not an
altered original campaign. A visible VENT command moved/deployed the actor from
zero funds, earned 352, spent 350 on one source-profile troop, restored while
deployed, retracted on Stop and moved again with the same ID. Exactly one troop
was produced. Browser rendering exposed a shorter directional movement-bank
cursor issue; the native looping-bank frame-zero rule fixed it. A second real
Canvas/WebGL round trip completed with zero unsupported-timeline warnings.
Per-update original FIN checks now cover both races and both slot orders.

The independent review's context-mode and combat-controller aliasing bugs were
fixed and regression-tested. Cursor admission is cached in one transient entry;
commands still perform fresh full validation. Unknown-version tests now use an
actually unsupported version, retaining compatibility with newly supported saves.

Desktop screenshot and 390-pixel-width fixture checks passed. The renderer and
fixture were disposed, temporary DOM/global probes removed, and the tab returned
to its original desktop launcher. No native/OS window was opened or source mission
AI gate disabled. The original saved mission remains untouched.

2026-09-19. Independent current-source/document review only. This review creates
only this file and runs no tests, probes, browser, agents, typecheck or build.
**Phases 1-2 retain their previously accepted pinned scope. Phases 3-5 remain
partial, not accepted. The request to enable all phases in the actual game is
not fulfilled.** Current integrated gate/count: **pending orchestrator**.
Round 7's 966-pass gate is historical, not certification of this revision.
Shared-browser fixture cleanup is also **pending orchestrator**; this review
does not claim the launcher was restored or fixtures disposed.

## Principal Finding: Fixture Is Not Default Mission Admission

The public Harvest path is implemented, but **normal users cannot be told that
harvesting is now enabled in the unchanged original campaign**.

- [Game-data loading](../src/game-data.ts) calls
  `loadSourceResourceOptions`. Its [resource loader](../src/engine/source-resource-options.ts#L147)
  returns source FIN profiles and original neutral VENT bindings, with
  `missionAdmission: "not-evaluated"`. The lifecycle construction near the end
  of that function does **not** attach `nativeHarvest`.
- [The optional factory](../src/engine/source-resource-options.ts#L59),
  `sourceBoundedHarvestConfiguration`, requires explicit
  `source-separated-bounded` scope, raw actor/bank bindings, original PTH/FIN
  metadata and an isolated RNG index. Defining/exporting this factory does not
  configure the ordinary mission loader. Current application-source search
  finds no factory call in that loader.
- [MissionView](../src/mission-view.ts#L100) conditionally admits resource actor
  types 6/14/47/48 only with that configuration. Its native public command path
  operates on those externally owned actors; a visible VENT by itself is not
  enough to enable player harvesting.
- [The explicit fixture](../tools/qa/fixtures/bounded-harvest.ts) attaches the
  configuration, seeds a type-6 or type-14 actor, keeps only that actor and the
  selected HUMAN02 VENT placement, supplies `triggers: []`, and labels its SCN
  identity `fixture-not-original-mission`. Its alien variant is still a
  source-separated HUMAN02-map experiment, not unchanged ALIEN02 gameplay.
  The production variant adds source-backed base-production options separately.

Original HUMAN02/ALIEN02 active-AI admission remains rejected. The application
does not filter original scripts to bypass this gate; empty fixture triggers
are explicit test setup. Source hashes authenticate assets and bounded inputs,
not unchanged mission composition, complete native startup, or global gameplay.

## Accepted Delta And Evidence Attribution

**Mirrored normal-body mask:** [the rendering report](phase4-mirrored-body-20260919.md)
records live admission of source mode 0 / mirror 1, with unchanged original
TRSC timeline 276. Eight native 192x192 palette-index framebuffers and eight
32x32 crops match, alongside the earlier four unmirrored cases. Recording-context
tests exercise the live consumer. This closes a real mirrored-body subgate,
not complete native display-palette/shadow/RMP, mode-1 body/shadow, global queue,
effect, elevation or arbitrary physical-buffer-edge parity. The live fixture
itself is non-occluding; native comparisons establish actual pixel removal.

**AI computation:** [initializer/preparation/group-1 evidence](ai-policy-runtime-20260919.md)
and [demand/rule evidence](ai-demand-rule-20260919.md) establish executable TS
reducers with full-buffer native goldens, not merely wrappers or native-only
research. Initialization, assignment, observation, a bounded group-1 invocation,
and all 18 ordered first-zero demand rules are implemented. The reports attribute
7 active tests/26 controls and 107 demand tests to their focused runs; this
review neither reruns nor adds these overlapping counts into a full-suite total.
The pipeline still returns `readyWholeCall: false` / `admitted: false`.
Production intents debit credits but remain `pending-owner`: no certified packet
receipt, queue insertion or producer lifecycle follows automatically. Group-0/2/3
decision gaps and group-1 retarget/release/create branches remain. Natural native
world history is reference evidence, not a live TS scheduler; historical demand
inputs were not captured by those post-demand group snapshots. Mode 3 stays closed.

**Player Harvest:** [the bounded integration](bounded-harvest-player-20260919.md)
and [public-command tests](../tools/qa/bounded-harvest-player.test.ts) now cover
visible VENT targeting through view/session/simulation, actual native movement,
deployment/income/retraction, Stop, restore and another move with the same actor
identity. The mover is no longer east-only: all eight straight directions over
1-3 cells are supported under same nonzero PTH-family, clear ground/secondary
planes, no-trip and arrival-timing constraints. Only one bounded route is active;
isolated-index/no-shared-draw RNG is explicit. No teleport, generic browser route,
funds grant, weapon fallback or command-admission bypass supplies success.
Atomic staging and ownership checkpoints are substantive implementation, but
native global combat for externally owned actors remains unsupported, as do
concurrent/long/multileg/dynamic routes and shared mission RNG ownership.

**Economy/browser result, supplied by the orchestrator:** source-separated
human/alien seeded 6/14 fixtures start with zero credits, earn 352 and afford a
350-cost source production purchase. The reported fresh shared-browser run with
original assets agrees at 353 ticks, produces one spawn, and preserves the
harvester ID through Stop and a new move. This is real bounded live workflow
evidence, not an original mission, an ordinary-input campaign completion, or a
result independently reproduced by this audit. The reported shorter-animation-bank
frame fix has new per-step FIN regressions passing four human/alien and slot-order
cases. These later reports supersede the bounded integration document's earlier
"browser not run" status for this fixture only. Its old compiler-blocker paragraph
is not adopted as the current gate result; current full validation is pending.

**Cursor and transaction follow-up:** [current view code](../src/mission-view.ts#L1250)
keys the cursor cache by session reference and tick and keeps one admission entry,
including actor ownership, order mode and target/source identity. The
[hot-path test](../tools/qa/mission-cursor-hotpath.test.ts) checks 800 hits with zero
session snapshot reads, misses/invalidation, restore and fresh-view behavior.
The orchestrator reports approximately 315x faster hits in that local CPU
benchmark; this is not rendered FPS, a device guarantee or whole-game speedup.
Actual commands still fork, call `session.commandResource`, validate and commit;
they do not trust the cursor cache. The staged view now restores its own combat
movement state, and successful native commands reset to context selection.
The reported rollback/context-reset review defects are fixed in current source;
this audit does not claim a fresh regression execution.

## Phase Decision

| Phase | Decision and remaining acceptance gate |
| --- | --- |
| 1-2 | Retain existing accepted pinned source/asset scope, without expanding it into native gameplay acceptance. |
| 3 | Not accepted. Bounded AI/resource computations and fixture transactions are real, but original mission active-AI admission, shared scheduler/task/occupancy/RNG ownership, general harvesting, complete construction/upgrades/abilities and remaining combat lifecycle fidelity are not complete. |
| 4 | Not accepted. Mode-0 mirrored masking and bounded resource presentation improve the live path; full source composition/order, mode-1 shadow/body and effects, complete original gameplay controls and device audio evidence remain unmet. |
| 5 | Not accepted. Current integrated gate and browser cleanup are pending. Existing API/fixture runs do not replace ordinary-input unchanged campaign progression, independent original-game comparison, WebKit/iOS/device checks or sustained rendered battle FPS/memory evidence. |

## Next Minimal Original-Mission Owner

The next actionable owner is the **campaign-session/transport active-AI
transaction**, not another standalone harvester helper or removal of a guard.
Start by connecting demand's exact debit plus mode-9/10 intents to one atomic
receipt/production transaction, preserving credits without a second charge and
proving rollback. Keep mode 3 rejected while completing the missing group
branches, natural scheduler visits, order receipt and subsequent task feedback
under shared world/RNG ownership. Existing native initialization/history goldens
are ready inputs to that work, not permission to admit the whole mission today.

After those admission prerequisites, the real game-data/resource loader must
derive and attach native harvester ownership from actual source actors and the
mission's shared state, including production-created actors, rather than injecting
the seeded fixture's banks/isolated RNG profile. Verify unchanged SCN/TRO hashes
and a legal player route to acquisition, harvesting and spending in that admitted
mission. Merely attaching today's bounded factory cannot certify the original
campaign, and lifting AI admission alone cannot enable Harvest without this
loader/ownership integration.

The orchestrator owns the in-flight full gate, its final count and shared-browser
cleanup. Until those results arrive, none is counted as passed here; even a green
suite would not waive the remaining phase requirements above.
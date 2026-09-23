# Phase 3-5 Delta Acceptance, Round 6

2026-09-19. **Phases 1-2 remain accepted within their pinned scope, unchanged.
Phases 3, 4 and 5 remain partial, not accepted.** The advances below close real
subgates, not the containing phases. Requirements remain those recorded in the
[architecture phase gates](../ARCHITECTURE.md#phase-gates) and acceptance reports;
older statements that these integrations are entirely absent are superseded.

## Review Boundary

Orchestrator final verification supersedes the pending statements below:
**866 tests passed, zero failed, four skips; typecheck and production build passed.**
The focused native activation check passed after its assertions were updated to
the new source/profile metadata structure. The final mobile-only CSS rebuild hit
one transient ENOTEMPTY generated-directory error; the unchanged command passed
on retry. No source files were deleted to recover it.

Embedded browser follow-up passed the shared production-panel handler against an
explicitly synthetic base/funds fixture: one 350-credit debit, duplicate pending
click blocked, exact-one native-profile unit created, insufficient-funds disabling,
and completed-state restore. Original HUMAN01 retained no factory menu. Modal
checks used synthetic pointer events (capture stubbed) and the actual J handler:
click/drag release after Objectives opened dispatched no command/selection; normal
click still dispatched. A mobile rule hiding the production name was found and
fixed; all row controls fit at 390-pixel width, including maximum signed32 credits.
The shared tab was restored to the launcher with fixtures removed.

This independent review owns only this new document. It inspected current source
and evidence reports; it ran no agents, browser, tests, native probes or full
suite. Execution results below are attributed to their reports or the supplied
orchestrator handoff, not independently rerun. No native window was launched or
requested; embedded-only preference and existing authorization remain unchanged.

**The current full suite is pending the orchestrator. No current total or green
gate is asserted.** Historical suite totals do not certify this revision. The
obsolete activation assertion is now updated in
[tools/qa/legacy-ai.test.ts](../tools/qa/legacy-ai.test.ts#L269), including both new
bounds and `completeWorldHistory === false`; its focused passing result remains
pending confirmation. A changed assertion alone is not a passing check.

## Accepted Subgates And Limits

| Delta | Accepted evidence | Boundary that remains |
| --- | --- | --- |
| Ordered trigger feedback | Live `scanEvent` calls `executeMissionTransaction` for the complete event, refreshing staged host/census feedback after each command. Same-block expressions and subsequent conditions observe ordered effects; late failure rolls back the enclosing session transaction. Adapter command mutation, sparse/inherited receipts and reused/accessor receipts are covered by the reported **52 focused checks**. | Supported actions/statistic producers only; no mode-3 admission or reversible external adapter I/O. The count is the supplied focused result, not a full-suite count. See [ordered feedback](ordered-trigger-feedback.md) and [live caller](../src/engine/campaign-session.ts#L473). |
| Bounded production, live wiring | Actual raw SCN/hash-validated configuration reaches MissionView and CampaignSession; UI reads canonical credits and stages reserve/dispatch, source visits drive native-FIN completion, and slot/generation binds the produced unit once. Current restore validation checks allocated-event provenance against production and host requests. | HUMAN01/ALIEN01 genuinely have no owned factory: no menu or invented grant. Original HUMAN02 still rejects `TRO 17: ai`; no TRO filtering. This is base TRSC/GRAY support, not complete construction/upgrades, opponent production or income. See [production integration](live-production-ui-20260919.md), [purchase/step owner](../src/mission-view.ts#L624), [restore validator](../src/engine/campaign-session.ts#L952). |
| Production panel execution | Orchestrator reports a **synthetic browser fixture** passed actual panel purchase, credit deduction, native-FIN timing, exact spawn and restore. | Synthetic base/funds/source-separate scenario, not original HUMAN02 or an authentic campaign economy. The older production report's post-completion restore failure is superseded for this reported fixture and current validator, not converted into a new independently executed result. |
| Modal input and render snapshot | Orchestrator reports the captured-mouseup modal guard fixed and its synthetic browser input regression passed. The source-backed render-call fixture reports one snapshot per actual `render()` for both opening missions. | Synthetic input regression is not an ordinary-input mission playthrough. The snapshot fixture uses recording Canvas2D/image stand-ins, not browser raster or FPS evidence. See [render-call evidence](scene-queue-provenance-20260919.md). |
| Unchanged opening-mission outcomes | Both actual MissionView constructors admit complete, hash-checked HUMAN01/ALIEN01 data. Legal public commands produce all four intended outcomes with original enemies, source stats and exact replay. | Canvas has no rendering context. This is public-command API automation with source-aware planning, not manual play, browser input, native executable gameplay or reference parity. Details below and in [source playthrough](source-playthrough-20260919.md). |
| Resource startup configuration | Native constructor establishes eight percentages of 100; startup converts them to eight Q8 multipliers of 256. Local team 0, fresh cancellation gate 0, initial income and source rows/FIN bindings are bounded, checked inputs. | No named Easy/Normal/Hard mapping. Fresh initialization is not resume state. Loader/frame helpers and opt-in resource sessions do not wire live MissionView income or supply missing mobile task ownership. See [resource options](source-resource-options.md). |
| Native scene helpers and provenance | Bounded clip/order helper matches original comparator/cutoff and complete framebuffer fixtures. Ordinary submission seed, raw-slot traversal, source child order and Q10-to-Q8/projection rules are proved within documented bounds. | `composeSceneFrame` is **not live**. Traversal is not full admission; diagnostic FIN fallback remains. No native campaign screenshot equivalence. See [occlusion](scene-occlusion.md) and [queue provenance](scene-queue-provenance-20260919.md). |
| Raw SCN reproduction | **3,630 files / 482,845,897 bytes**, all identical to isolated output; 108 original SCNs roundtrip byte-exactly with hashes and prior parsed fields preserved. | Incremental DATA re-export against the retained reproduced corpus, not a fresh full re-decode or runtime acceptance. Existing P1/P2 scope is unchanged. See [asset reproduction](asset-reproduction-20260919.md). |

## Source Playthrough Results

| Unchanged mission | Intended outcome | Ready tick | Replay |
| --- | --- | ---: | --- |
| HUMAN01 | Win | 4769 | Exact |
| HUMAN01 | Loss | 2481 | Exact |
| ALIEN01 | Win | 7241 | Exact |
| ALIEN01 | Loss | 2465 | Exact |

The [runner](../tools/qa/source-playthrough.ts) uses selection, camera, order-mode
and `commandAt` APIs plus normal `update`; it does not inject damage, funds,
units, enemy orders or visibility. All nine TRO blocks remain in each mission.
Victory counters are HUMAN `s(4,3)=3` and ALIEN `s(1,0,82)=11`; defeats record
the original commander losses. Each successful trace replays from a fresh
constructor with matching commands, complete combat-event hash and final
state/statistics/outcome/bindings hash. The corrected alien itinerary changes
planner destinations only, not the mission. Earlier incomplete attempts are
not passes. This closes source-backed deterministic outcome/replay evidence,
not the independent input, rendering, native-AI or original-game reference gates.

## Native AI: Progress Without Admission

[Activation research](ai-policy-runtime-20260919.md) now reaches **HUMAN02 14096**
and **ALIEN02 1136** updates with all four groups returning. HUMAN emits only
empty packets and proves no actor-order consumption. ALIEN decodes ten packets,
seven actor-bearing; seven actors consume pending mode-7 orders and change task
stacks during separate dispatcher visits at the **frozen activation clock**.
That is genuine bounded native execution, not continued movement/combat history.

The final selector is explicitly invoked, not proof that the round-robin
scheduler selected that team then. `admitted` and `completeWorldHistory` remain
**false**. The contiguous world-service prefix stops at
`0x4198f0 -> 0x41e820`, faulting at `0x41e830`: native relation objects at
`game+0x471a0/+0x471a4` are missing. Thus evolving alliance/visibility, combat/loss
history and activation policy inputs remain uncertified. This is a harness
initialization gap, not an asserted defect in the original game. Prior movement
bank and MSG stops are resolved, not current blockers. The browser's existing
guard combat is real, but is not complete native mission-2 policy.

## Phase Decisions And Exact Remaining Gates

| Phase | Status | Unmet recorded requirements |
| --- | --- | --- |
| P3: Simulation | **Partial, not accepted** | Complete native AI decisions, scheduling and actor-task/world-history integration; live harvesting/deposit income and incoming-harvester/general mobile idle handoff; complete production/construction/upgrades and legal destruction/cancellation/refund lifecycle; shared task/occupancy/RNG ownership including Inspire; original movement/routing classes, cadence/projectile/impact/specials and evolving visibility/timing parity. Source outcome/replay, ordered feedback, checkpoints and bounded base production are accepted subgates, not substitutes. |
| P4: Presentation | **Partial, not accepted** | Live native scene queue with complete city/ordinary/auxiliary/map-object/effect admission and capacity accounting; raw indexed foreground coverage masks; camera/viewport-edge and equal-key behavior; shadow, mirror, elevated and effect passes/FIN events; complete construction/resource/upgrade/ability HUD and presentation, native ambient scheduling. Existing palette/fog/radar/CD work is retained; device audibility/gapless parity remains unverified. |
| P5: Testing | **Partial, not accepted** | Ordinary-input wins/losses through actual mission UI, playable later-campaign progression, original-game reference comparison, WebKit/iOS/device evidence, sustained rendering FPS and combat-memory behavior, and the pending current integrated suite. API playthroughs, synthetic browser cases and CPU/helper/native-slice evidence each cover only their stated contracts. |

## Strongest Next Checks

1. **Unblock authentic native AI history first.** Recover and execute the real
   constructors/team-dependency initialization for both relation objects, then
   rerun the contiguous `0x4198f0` world-service prefix through alliance/visibility
   updates without success stubs. Continue unchanged HUMAN02/ALIEN02 history with
   original scheduling and evolving clock through activation, packet decoding,
   subsequent actor tasks and combat/loss updates. Require valid relation/mask
   state and recorded actor-bearing behavior, not merely four callback returns;
   retain HUMAN empty-order rejection and `completeWorldHistory=false` until
   that evidence exists. Do not infer a TS policy or admit HUMAN02 from frozen
   ALIEN task-consumption snapshots.
2. **Close the actual economy owner boundary.** Supply native-backed incoming
   harvester task transfer and general mobile idle handling, then connect fresh
   resource options/current frame state to MissionView's transactional session.
   Demonstrate real reserve depletion and income changing the same canonical
   credits consumed by purchase, including rollback and in-flight restore.
   Synthetic funding or constructor defaults reused after resume cannot pass.
3. **Before enabling the scene plan**, prove complete caller admission and
   camera behavior, supply masks from raw indexed foreground coverage, and
   compare the bounded live draw against the native framebuffer with holes,
   reflections, multiple children and viewport edges. Keep unsupported
   modes/ties diagnostic; one snapshot per frame is not this gate.

These are follow-up engineering/verification requirements, not work executed
by this review. The orchestrator owns the pending focused AI confirmation and
full-suite result; neither is silently waived or represented as passing here.
# Final Delta Acceptance, Round 9

## Final Orchestrator Verification

This addendum supersedes the pending-result statements below. **2,035 tests
passed, zero failed, four skipped; project typecheck and production build passed.**
Editor diagnostics are clean. Phases 1-2 retain acceptance; Phases 3-5 remain
unaccepted, including the native actor-task boundary described in this review.

The embedded browser loaded unchanged HUMAN01 and advanced 220 deterministic
ticks. Six native mode-1 shadow writes occurred with selection both off and on;
all selection/health overlays followed the shadow pass. The visible frame was
captured without obsolete TRSC shadow warnings. Over 120 synchronous renders of
the 35-unit scene, draw work measured 9.6 ms median, 11.5 ms p95, 14 ms maximum.
This is not rAF FPS, a sustained battle, WebKit/device evidence or native campaign
visual parity. Fixtures, globals and DOM reports were disposed/removed; the shared
tab is back at the launcher, with no external window opened.

The experimental actor-task probe still fails before accepted task initialization.
It was not included as successful native evidence. The full-policy stage-downgrade
and sub-step pending-order mutations are repaired and regression-tested. No
unsupported task, city receipt or original mission action was replaced by a no-op.

2026-09-19. Independent read-only source/document review, with this new report
as the only owned edit. No agents, browser, tests, native probes, full suite,
typecheck, build or external tools were run. Orchestrator results below are
attributed reports, not independently reproduced measurements. Source assets
are reported unchanged this round; this review did not recompute their hashes.

**Phases 1-2 retain their existing accepted pinned scope. Phases 3-5 remain
partial, not accepted. All-phase acceptance is not achieved.** The current
integrated suite, typecheck/build and render-frame measurement remain pending
orchestrator confirmation. No in-flight final log was read or its count assumed;
round 8's 1,534 passes are historical, not this revision's gate.

## Closed Deltas

**Complete AI computation is implemented.** The
[whole-policy report](ai-full-policy-20260919.md) establishes initialization,
preparation/assignment/observation, demand and groups 0/1/2/3 in original order,
including group-one retarget/release/create. `readyWholeCall: true` is now
correct for computation. The reported 513 focused passes and separate group-0/3
goldens are evidence for that slice, not additive full-suite totals. Round 8's
missing-group/computation blocker is superseded, not retained as a new hurdle.

The whole-call oracle executes original `0x44be40` through return from
pre-action demand inputs, including both transport timings and paid emissions.
Its provenance is `source-preaction-reconstructed-bounds`. Historical natural
HUMAN/ALIEN group captures lack the corresponding pre-demand inputs: they do
not prove historical demand against the actual evolving original world. Neither
generic bounded inputs nor source hashes turn this into natural-world parity.

**Atomic session receipts and paid troop production are implemented.** The
[full-policy session report](campaign-ai-full-policy-20260919.md) and current
[transaction implementation](../src/engine/campaign-ai.ts#L435) provide the
public session path, full shared-pool validation, actual slot/generation checks,
ordered receipts, owned RNG/force state, journal and checkpoint replay. Mode-5
receipt writes `+0x36/+0x37`; mode-7 writes waypoints `+0xa6/+0xa8` and count
`+0xc6`. These are real receiver mutations, not task execution or writes to the
AI objective field `+0x11`.

Prepaid mode-10 FIFO admission avoids a second debit and reaches actual native
FIN producer completion and slot allocation in the bounded fixture. This is a
genuine production result, not synthetic spawning. Mode-9 construction remains
explicitly rejected. Constructor-backed session/native comparisons are stronger
than attaching unrelated policy actors to a live world, but remain bounded
session evidence, not original mission scheduling or global RNG admission.

**Both latest review defects are fixed in current source.** The exported
transaction rejects a partial stage under full-policy configuration before its
duplicate-receipt path. The
[elapsed-time host entry](../src/engine/transport-host.ts#L1217) checks pending
native AI before changing `remainderMilliseconds`, including 1 ms; fixed-step
entry also rejects before ticking. The orchestrator reports five focused
regressions passing. This review inspected the guards and regression assertions,
but did not execute them.

**Native mode-1 shadow/body is implemented and automatically live.** The
[mode-1 report](phase4-mode1-shadow-20260919.md) proves source RMP remapping,
normal/mirrored shadow and body, team rows and common unchanged TRSC/GRAY FIN
children. It compares 256 native backing frames after each pass and final Canvas
RGBA results across all four source palettes. These are controlled source
placements, not four natural campaigns. The shipped RMP, not approximate
darkening or regenerated colors, controls the shadow.

The orchestrator moved selection rings/health overlays after world composition
to avoid contaminating indexed destination colors and now reports actual
`mode1Results`. Current [view code](../src/mission-view.ts#L1476) queues overlays;
[draw diagnostics](../src/mission-view.ts#L1782) consult the runtime result.
Reported unchanged HUMAN01 startup-220 captures, selected and unselected,
each record six shadow `putImageData` calls, with no obsolete TRSC shadow warning.
A real visible screenshot is reported. The actual BEAC effect remains diagnostic.
This closes the old claim that mode-1 shadows are wholly fallback; it does not
certify the complete scene queue, effects or native scene parity.

Subsequent scoped work adds [bounded native mode-5 effects](phase4-mode5-effect-20260919.md)
for nonmirrored ground-level BEAC/GLIT/GLAT children through the existing loader
and frame adapter. The earlier BEAC diagnostic statement above describes this
review's snapshot. Mirrored effects and native global order remain gated;
this later increment does not change Phase 4 acceptance.

## Current Risk And Shortest Blocker

**The missing owner is native actor task consumption, not AI computation or
packet receipt.** Targeted receipts deliberately leave
`pending-native-task-hand-off`. The next host advance must reject until an owner
accepts pending orders/waypoints into the native task stack on the same live
slot/generation and raw actor state. Empty native packets do not establish task
consumption. Clearing the marker, assigning a generic movement destination or
replaying receiver writes would hide the gap, not close it.

The attempted new native actor-task probe stopped at constructor `0x41b750`
after three unsuccessful attempts. It is unfinished research with **no accepted
behavior**; it supplies neither a dispatcher implementation nor an oracle for
handoff. Original active mode-3 preflight must remain closed, including unchanged
HUMAN02/ALIEN02. Complete computation alone is not mission admission.

**Next most needed:** implement and compare one real receipt-to-task acceptance
on a constructor-backed live actor. Preserve identity/generation, raw pending
fields, ordered waypoints and native FIN/auxiliary task state; observe exactly
when the accepting task consumes them, then prove the next native task visit and
checkpoint/restore continuation without duplicate consumption. Keep unsupported
tasks rejected. This is the smallest actionable step toward the existing
original-mission gate, not permission to open that gate after one fixture.
Original scheduler/world inputs and shared occupancy/RNG ownership still have to
cover the admitted mission path; historical demand must not be substituted.

## Phase Decision

| Phase | Decision |
| --- | --- |
| 1-2 | Retain existing accepted source/asset scope; no new asset certification or gameplay expansion. |
| 3 | Not accepted. Complete AI computation, atomic receipts and bounded paid production are closed subgates. Native task consumption and original scheduling/world ownership remain the immediate blocker; existing general harvesting, construction/upgrades/abilities and combat lifecycle gaps are not waived. |
| 4 | Not accepted. Mode-1 shadow/body and post-world overlays are real implemented progress. Complete native scene ordering/queue/effects and the remaining original-game presentation/control/device requirements are not certified. |
| 5 | Not accepted. Current integrated gate and render-frame cost are pending. Reported browser captures do not establish ordinary-input later-campaign completion, independent original-game comparison, device coverage or sustained battle FPS/memory. |

No 60-FPS claim follows from six readback/write calls, native pixel goldens,
a visible screenshot or earlier CPU-only benchmarks. Current render-frame cost
must be reported separately when measured. A green integrated suite would close
that verification gate, not erase the concrete original-mission/task and scene
gaps above. This report supersedes only the stale round-8 AI-computation,
receipt-owner and wholly-missing-mode-1 statements; it does not move or waive the
remaining acceptance criteria.
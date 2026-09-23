# Gameplay Fixes And Mission Work

## Delivered

- Removed diagnostic red rectangles and crosses from FIN composition and
  MissionView missing-state, timeline-error, and carrier-error fallbacks.
  Console diagnostics, genuine mission errors, source artwork, selection
  rings, and health bars remain intact.
- Default simulation fires only without displacement, a pending path leg, or
  a movement destination reservation. Arrival steps do not fire. Assault
  stops to fire and resumes movement; Move Only remains obedient under fire.
- Generic presentation now selects Move during pursuit/displacement instead of
  showing Attack frames merely because the unit's order is attack. Native FIN
  ownership is unchanged.

## Verification

The shared embedded browser ran the actual ALIEN01 launcher/view for 1,000
rendered ticks using public commands and an explicit QA clock. All 98 observed
shots had unchanged shooter coordinates and no retained movement path/reservation.
The instrumented Canvas recorded zero diagnostic-red rectangles. Mission diagnostic
was null. This is browser API automation, not a sustained frame-rate claim.
Temporary update/drawing hooks and globals were removed and the normal clock
restored. The existing saved game was not overwritten.

[Four original opening-mission outcomes](stationary-fire-playthrough-20260921.md)
and their exact replays audited 34,120 ticks and 4,194 shots with zero movement
violations, using original mission data and real-asset Canvas stubs.

Final affected gate: `/tmp/dc-request-final-focused-20260922.log`, **70 passed,
zero failures/skips**, including animation, combat, rendering, checkpoints and
later-mission initialization. Final typecheck/build passed: JavaScript 662.70 kB,
207.76 kB gzip, build 4.54 seconds. The chunk-size warning remains.

The earlier full run had **2,935 passes, 11 failures and four skips**. Its stale
expectations and missing native trace inputs were repaired and verified separately;
see [the exact inventory](full-gate-repair-20260922.md). A clean full-suite rerun
of every final change is not claimed. Focused counts must not be added together
as a full-suite total.

## Additional Missions

[Verified balance profiles](additional-ordinary-profiles-20260922.md), strict
checkpoint support and the source CAM/CAMM archive mapping allow unchanged
HUMAN11 and ALIEN14 to initialize, render, advance and restore through tick201.
Their 108/78 original actors and 92/66 mobile weapons are retained. This is
startup/continuation evidence, not verified victory, campaign progression, or
permission to skip mission2. No new launcher mission or automatic skip was added.

For HUMAN02/ALIEN02, source work now covers selector transactions, Alien weapon15
profiles and continuation, native route search/serialization, task9, pending
movement, registered actor dispatch, and synchronous production boundaries.
[Registered route integration](native-route-gaps-20260922.md) matches 32 native
phases per faction (1,039/1,592 visits) from independently captured phase inputs.
It does not establish contiguous TypeScript world cycles.

[Fresh-world integration](native-world-cycle-20260922.md) still lacks the complete
source-derived startup image and ordered whole-world transaction. Its census,
clock, cap, relation and daylight segments are verified separately. Both mission2
gates remain closed, and full game/all-phase acceptance is not claimed.

Review fixes also reject shared-backed or sparse occupancy planes before the
registered host can retain or mutate them. This preserves rollback and detached
snapshots; malformed inputs are not normalized into passable terrain.

## Work Window

The requested six-hour window began at 22:07 PDT on September21. A later agent
return exceeded that window; no claim of meeting the deadline is made. New
feature work stopped once that overrun was observed, followed by final validation
and removal of browser instrumentation.
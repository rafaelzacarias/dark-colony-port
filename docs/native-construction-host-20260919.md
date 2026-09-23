# Source-Only Native CITY Receipt

2026-09-19. Bounded owner: `transactCampaignAiCity` in
[campaign-ai.ts](../src/engine/campaign-ai.ts), prepaid CITY and native-visit
events in [campaign-production.ts](../src/engine/campaign-production.ts), and
[native-construction-host.ts](../src/engine/native-construction-host.ts).

## Accepted Subset

- Original seven-byte mode9 `[7,0,9,3,0,team,0]`, dependency 2 / 16,
  human type20 / alien type32, first science building only. Level1, other
  buildings, replacing an existing building and active cancellation reject.
- Original DEPEND cost/prerequisites/restrictions and source maximum HP2400.
  AI debits credits once. Receipt adds 2000 to accounting without a second
  debit, writes City HP/level/busy, installs the fixed science actor and claims
  its four configured clear static footprint cells atomically in production.
- Fifteen fixed colony identities use `team*15+slot`. Exo/base are externally
  initialized prerequisite identities, not constructed fake actors. Science
  occupies slot3; slot6 is reserved before receipt commit and reused for both
  auxiliary creations (type92/93, team8, HP800). No mobile allocation counter
  is incremented. Auxiliary status1 survives unregistration.
- Normal counter >3 only. Each call represents one ascending registered
  fixed-colony outer visit, not elapsed time. Main runs before auxiliary;
  creation makes slot6 eligible later in that same visit. Incoming task22
  decrements 50..0 and pops on zero entry. Outgoing task22 increments 0..50
  and pops on reaching50. Height is source base900/1412 plus `3*counter^2`.
- Native zero-delay FIN initialization and animation preamble precede tasks.
  Arrival task20 continues twice in one visit; departure continues once.
  Human/alien busy clears at visit135/195; latch releases at186/246. Main
  remains HP2400/status1 and finishes task1. The unregistered auxiliary does
  not execute during BUILD or after release.

The six original FIN profiles and file hashes are retained in the configuration
and checkpoint. The tested constructor direction is zero; this is not general
FIN/render ownership. Source coordinates use the fixed slot3 constructor offset
`base*256+(512,80)` and auxiliary `base*256+(512,256)`.

## Executable Evidence

[native-construction-host-native.py](../tools/qa/native-construction-host-native.py)
checks executable SHA256
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
It loads original GAMESTAT/DEPEND and FIN timing records; initializes Exo and
base through `444f14` and completes their initial counter3 visit. It then
creates five troops and one harvester with `41b750 -> 41af14` and prepares
finite census lists with the unchanged executable rule table. This is an
explicit source-separated census, not a whole policy boot or natural mission.

Original `457940` selects rule5 and dependency2/16. Capturing only transport
emission `421648` yields the exact mode9 frame. Actual `41defc -> 41c8d4 ->
444f14 -> 41822c + 437bc4` executes; there are no receipt/lifecycle stubs.
The actual registered outer loop `419bb8..419c0e` runs to latch release.
The fixture has an explicit scenario restriction on factory dependency3/17:
without it, completed science enables the next factory receipt, which is
outside this owner. With it, the next original demand emits base troop
mode10; its actual consumer executes and queues one troop. Both races pass.

[native-construction-host.test.ts](../tools/qa/native-construction-host.test.ts)
compares every normal visit: task/phase, HP/status, registration, animation
frame/delay/mode and main/auxiliary coordinates. The finite AI test compares
original policy/entity buffers and emitted packets, completes production to
HP2400/busy0/latch0, then commits the next native troop receipt (credits3650,
accounting2367 from initial6000/17). It checks duplicate receipts, restore
during BUILD and after the next receipt, source hashes, blocked prerequisites,
occupied slots/cells, fabricated callbacks, stale/reordered visits, external
death and altered checkpoints. Seven focused tests pass.

Reproduce from repository root; no temporary policy capture is required:

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 -B tools/qa/native-construction-host-native.py > /tmp/city-native.json
DC_CITY_TRACE=/tmp/city-native.json node --import tsx --test tools/qa/native-construction-host.test.ts
```

## Checkpoints

`campaignAiCityCheckpoint(state)` serializes native byte planes as JSON arrays,
source profiles/hashes, fixed-slot identities, footprint, every visit and sealed
AI receipt. `restoreCampaignAiCity(checkpoint, authenticatedInitialState)`
recomputes native demand and replays production/visits; it does not trust stored
completion flags. `restoreCampaignCityProduction` and
`restoreNativeConstructionHost` provide narrower replay checks. External source
configuration is mandatory. Changed source evidence, money, actors, FIN state,
registry, footprint, receipt packets or unmatched events reject.

## Minimal Orchestrator Integration

The source-only implementation below now has a bounded session/world join in
[CampaignSession CITY acceptance](campaign-session-city-20260919.md). Explicit
`constructionSources` enables first-science mode9 in the existing full AI
transaction; without it mode9 still rejects. The original-mission gate stays
closed. The original source-only evidence and API remain available.

The original integration requirements were:

1. Authenticate `constructionSources` when creating production and retain the
   external initial AI/source configuration for restore. Validate current real
   Exo/base identities/HP, empty science/auxiliary slots and all four static
   footprint cells against the host configuration. This owner is explicitly
   `source-city-only`; do not silently cast it to the existing session scope.
2. Route the proved CITY intent through the prepaid receipt, then allocate the
   **actual** transport/world fixed science identity, reserve auxiliary slot6
   and install footprint/registration/raw constructor state in the same
   candidate commit. The new module owns a typed semantic actor graph, not a
   complete raw220 transport constructor or a world adapter. Never use an
   `initialize-science` request alone as evidence that the world was updated.
3. Call `stepCampaignAiCityConstruction(state, visit, eventId)` only at the
   native registered outer-visit boundary. Supply the actual counter, observed
   HP and ascending registered fixed-slot list (including Exo/base); compare
   them with `nativeConstructionRegisteredSlots`. Commit all main/auxiliary
   task, FIN, movement, registration, City busy/latch and footprint projections
   together. Newly created slot6 must receive its later same-pass visit, never
   an extra visit; unregistered status1 is not dispatchable.
4. Reject external damage/death, removal, footprint/identity conflict, queued
   orders or unsupported tasks before mutating any owner. Restore both the
   source-only graph and the actual world with cross-graph checks before
   resuming. The source-only checkpoint is not a Session/world checkpoint.

Source-only receipt rollback does not imply world rollback. A coupled adapter,
full shared scheduler/RNG/task/FIN ownership and joint checkpoint validation
remain required. Normal construction does not resolve legally reachable lethal
phase3 destruction; the blocked gate and negative controls in
[construction-lifecycle-20260919.md](construction-lifecycle-20260919.md) remain
unchanged. Even nonlethal external HP changes are rejected by this normal-only
runtime subset.
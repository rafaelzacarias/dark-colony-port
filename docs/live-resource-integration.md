# Bounded LIVE Source Resource Integration

2026-09-19. Latest bounded work owns RESOURCE-only
[MissionView](../src/mission-view.ts), incoming handoff input in
[campaign-session](../src/engine/campaign-session.ts),
[view tests](../tools/qa/live-resource-integration.test.ts) and
[handoff tests](../tools/qa/live-resource-handoff.test.ts).
No main, style, scene mask, transport scheduler, simulation engine, production
admission, game-data or original asset changes in this increment.
**The end-to-end LIVE moving-harvester round trip is still blocked.**

## Admission And UI Hooks

- `CampaignMissionData.sourceResource` carries explicit scales, initial income,
  constructor bindings, FIN banks, fresh configuration and frame-source inputs.
- `loadCampaignResourceOptions(mission, loadBytes?)` initializes a fresh base
  session world using the supplied complete SCN teams, placements and TRO, then
  calls the hash-validated source loader. It does not filter AI, add an extractor,
  move a source, seed money or admit a mission. The normal mission loader calls
  it for source-bearing missions only after its unchanged preflight.
- `MissionView.resourceSources` projects actual neutral type-40 records by
  native slot/generation/key, owner **8**, Q8 position, reserve/HP, status,
  rate/countdown and canonical resource task state. Returned objects are copies.
  There is no faction, simulation ID, combat target, weapon or fake ninth team.
- VENT rendering uses the host's direction, FIN bank and exact frame, including
  the native direction fallback search. It does not advance an independent
  animation clock. Fog still controls visibility; host removal removes the
  source projection without a combat death.
- `resourceWorkflow` exposes source clock, canonical `world.exomoney` credits,
  resource enablement and an explicit `harvestEnabled: false` diagnostic.
  Existing `productionMenu` reads canonical session production credits.

The selected `native-constructor` profile proves eight percentages 100, startup
multipliers 256, fresh local team 0, cancellation gate 0 and eight income zeros.
The returned `evidence` carries the original SCN hash and executable SHA-256
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
This is the bounded executed constructor/SCN evidence documented in
[source resource options](source-resource-options.md), not a recovered menu
configuration, named difficulty or permanent resume default.

The admitted view path retains the selected fresh AI/multiplier/local-team/gate
inputs unchanged. There is no mutable native configuration owner wired here;
changing those inputs requires a new explicit owner/checkpoint contract.
Session stepping derives live full32 colony HP and advances the source clock.
Original HUMAN02 and ALIEN02 still reject their unsupported AI TRO at preflight.

## Implemented Ownership Boundaries

The simulation's `registerResourceActor`, `claimResourceActor`,
`publishResourceActors`, `requestResourceActorReturn`, `releaseResourceActor`
and `movementFinishedEvents` are implemented, not proposals. See
[resource actor ownership](resource-actor-ownership.md). Simulation ownership
suppression, native type publication and removal-versus-death events belong to
that API. This increment does not claim/publish a view actor before a session
frame, so a failed session cannot leave a partially claimed view actor.

`CampaignSessionInput.resourceHandoffs` now performs incoming `bind` and
outgoing `release` within the same staged transaction as the resource frame.
Each entry supplies `evidence`, the complete `expected` HostSlot (including
slot/generation/key), its expected 220 `rawEntity` bytes, and `state`.
Duplicate slots, stale identities/positions/bytes, pending bind orders and
unknown task fields fail before commit. Later frame failure rolls back the
entire batch, source clock, economy and journal. This is a session transaction,
not yet a cross-simulation prepare/commit protocol.

Bind delegates to the host's existing bounded native-idle admission. Release
requires the exact current released host task: mobile 6/14, positive HP,
pending 0, order 255, canonical `[65535, HP-low, HP-high]`, actual direction,
and reset source stand FIN state. It relinquishes the resource task without
redispatching idle. The caller must own the next mobile visit. Evidence is
caller-supplied provenance, not an executable proof certificate. Expected raw
bytes detect stale session state; they do not manufacture a native movement
snapshot or certify the supplied incoming task.

## Remaining LIVE Gates

[Eight native round trips](harvester-handoff-20260919.md) and
`reduceLegacyHarvesterIdle` prove the bounded 6/14 idle behavior with zero RNG.
They do not supply the following missing live adapters:

1. Simulation `movementFinishedEvents` supplies final Q8 and identity, but not
  native task stack, direction, FIN, observer/auxiliary bytes, source countdown
  at the after-mobile boundary or packed ground flags. Snapshot idle or a
  destination reservation is not a substitute. No raw task is guessed here.
2. `ResourceHostEntityState.stack` and bind/activation currently exclude opcode
  3; the proven movement exit contains `1,3`. `stepResources` rejects mobile
  idle/wait visits instead of scheduling the new helper. Source-first same-tile
  constructor activation works; mobile-first fails atomically. Waiting until
  activation or deleting the wait task would violate the native slot order.
  Fixing this requires the transport scheduler owner, outside this increment.
3. The view lacks a checkpointed noncombat actor adapter for both simulation
  and host ownership, including native FIN publication and acknowledged idle
  return. Until that exists it rejects external resource records on restore
  and 6/14/47/48 registration, even without a damage matrix. There is no
  generic harvester/combat fallback and no certified source defense claim.

`resourceWorkflow.gates` reports these boundaries. Harvest UI and external
order-13 UI remain disabled, including visible VENT context; original mission02
AI preflight remains blocked. No extra production types, FIN banks, credits or
RNG hooks were added. Actual adjacent-move -> income -> production -> retract
-> same-ID move, all mode/slot-order combinations and live depletion publication
are **not accepted**. Existing host depletion semantics are unchanged: HP over
270 loses 270, HP at most 270 enters removal without a combat-kill claim.

## Checkpoints And Audio

MissionView preserves resource session options and delegates payload/position/HP
ownership to the current schema-2 session snapshot. The source clock is
`session.state.sourceDayNight`, not a trigger counter or a fresh-header restart.
Restore additionally compares simulation and session source clocks. Missing
clocks and edited initial bindings fail. Native source projections are rebuilt
from the restored host, not serialized as independent combat objects.

Committed source-sound requests resolve SLIST **XTR row 1**, sound **183**,
`SOUND/ERUPT.WAV`, through the existing catalog. Playback is nonspatial, once per
committed frame request. Restore does not replay prior requests. No audio asset
was published or substituted; deployment/retraction audio is not claimed LIVE.

## Verification And Fixture Boundaries

The focused view tests isolate original source rows, remap their slots and omit
TRO only in explicitly labeled fixtures. Original source loader validation runs
before isolation. Tests cover both unchanged mission02 rejections, owner-8
projection, copied payload/position state, source clock continuation, option and
clock tampering, and once-only eruption playback across restore.

Separate labeled same-tile source/extractor fixtures use proven constructor
directions 160/128, idle words `[65535,0,0]` and original FIN banks. They verify
native session deployment and positive settlement, while requiring the LIVE
view to reject the missing external owner. They are not original placements or
proof of movement/idle handoff. The existing production-session resource test
checks that native settlement reaches canonical production credits while
preserving pending reservations and checkpoint continuation, without grants.

```sh
node --import tsx --test tools/qa/live-resource-integration.test.ts
node --import tsx --test tools/qa/live-resource-handoff.test.ts
node --import tsx --test tools/qa/source-resource-options.test.ts
node --import tsx --test --test-name-pattern='resource lifecycle income' tools/qa/campaign-production-session.test.ts
npm run typecheck
```

The new handoff fixture uses the original HUMAN02 `[69,48,40,22,12000]` source
row and PTH, checks the original SCN SHA-256, and explicitly inserts a synthetic
same-tile human/alien harvester. It does not claim original placements or native
movement parity. Six tests cover input/raw-state tampering, batch and late-frame
rollback, canonical income, deployed restore, cancellation failure, exact release,
unchanged identity, and explicit mobile-first/wait-stack rejection. No RNG hooks
are supplied; the host direction cursor stays unchanged. This is not proof of
the live simulation's native RNG cursor.

No agents, browser, full suite or asset publication. Node tests exercise view
logic with a null canvas context; pixel rendering is not browser-verified.
Latest increment: 7 view tests, 6 incoming-handoff tests, 4 native harvester
helper tests and the targeted production-income test passed (18 total).
Repository `npm run typecheck` passed after the focused tests. The native helper
run covers eight original movement round trips separately from the session
fixture. Source-options and unrelated production-view suites were not rerun in
this increment. No end-to-end LIVE acceptance is claimed.
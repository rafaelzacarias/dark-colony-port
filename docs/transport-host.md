# Transport Host

[transport-host.ts](../src/engine/transport-host.ts) executes the effects of
[legacy-transport.ts](../src/engine/legacy-transport.ts) against a deterministic,
serializable unit registry and collision grid. It implements the existing
`CampaignTransportAdapter` contract without changing the view, simulation or
mission controller. It is ready for explicit host integration, not wired into
the running game and not a native engine emulator.

## Integration

1. Call `initializeTransportHost(world, options)` with all 800 raw slots and
   explicitly bound `CampaignEntity.rawSlot` values. Active raw slots without
   entities are rejected; no native slot assignments are guessed from placements.
2. Supply map dimensions and ground eligibility, native high-water count,
   all eight source side fields, and definitions with health, source movement
   speed and a resolved ground/flying class. `transportHostDefinition` copies
   these values from `LegacyUnitStat`, with the plane supplied explicitly.
3. Supply a finite stream of direction-bit pairs, positive
   `fixedStepMilliseconds`, and positive integer `orientationSteps`. These are
   browser policy, not a reconstruction of native RNG or scheduler timing.
4. Pass `createTransportHostAdapter()` to `createCampaignWorldAdapter` or
   `stepCampaignWorld`. Every successful `scheduled` receipt owns a real reducer
   carrier, fixed slot, registry entry and descent task. No intent-only receipt
   is returned. The campaign adapter handles inactive-target no-op receipts.
5. Drive `stepTransportHost` once per browser simulation step, or
   `advanceTransportHost(world, elapsedSimulationMilliseconds)` for accumulated
   fixed steps. Do not use both for the same elapsed interval. Withhold simulation
   time while paused. Neither API changes the campaign wall clock or bail timer.
6. Commit the returned world before exposing its append-only `requests` journal
   to the simulation/render bridge. Keep a committed journal cursor; requests
   carry slot and generation so an old removal cannot affect a replacement.

Every mutating API returns `TriggerResult`. It clones its input, performs real
state changes in that clone, and returns a new world. Allocation, initialization,
motion and collision are not deferred to a hidden side effect. Failed preparation
or stepping returns diagnostics with the input unchanged, including direction
cursor, cargo, FIFO and request journal. This transactional stop is a browser
error policy, not an emulation of native assertions or an automatic retry queue.
The caller must resolve the diagnostic before retrying. A batch of elapsed steps
is atomic, including rollback of earlier steps in that batch on failure.

Command IDs are idempotent within the host. Reusing an ID with a different payload
is rejected. `transportHostState(world)` returns a detached snapshot. Its plain
arrays/records round-trip through JSON; the surrounding world's `entityBytes`
still requires a typed-array-aware serializer such as `structuredClone`.

## Tasks And Creation

The reducer controls descent, payload order, pickup, ascent and release. Vertical
pop calls defer processing; orientation completes only after the configured
number of steps. Horizontal motion then advances by the carrier definition's
`movementSpeed` in native256 units per browser step. Movement is straight-line
Euclidean interpolation with integer position truncation. Orientation completion
can start movement in that step, and arrival redispatches payload handling.

This uses the source speed rather than a fixed flight delay, but is **not** the
native direction quantization, turning or horizontal task implementation. Word
wrapping of initial offsets comes from the reducer. Browser movement uses the
resulting numeric positions, not a guessed shortest wrapped route. The slot's
position is current during approach; the reducer's position snaps on arrival.
Carriers are aerial transport tasks and do not occupy payload collision cells.

One `reinforce` owns five padded, ordered groups. The first `(0,0)` special mode
and unsupported types are rejected. Each payload attempt checks ground occupancy.
An actual creation allocates a slot, sets health/type/team, registers the unit,
occupies its movement plane, adds a campaign entity and appends a `create`
request. Only then is cargo acknowledged to the reducer. A blocked payload
retains cargo and schedules orientation/movement to the next ground destination;
there is no instant troop formation expansion.

`findTransportPosition` implements the documented source search: radii from zero
through `max(width,height)-1`, the entire square each time, X ascending outside
Y ascending, skipping out-of-map cells. Ground requires eligibility and vacancy;
flying requires its own plane's vacancy. Payload fallback always searches from
the original requested tile on the ground plane. Actual creation searches from
its requested position using the unit's plane. Type 40's special placement path
is deliberately diagnosed, not approximated.

Explicit browser-adapted sessions additionally validate live static ground
actors when inspecting arrivals, selecting destinations and allocating payloads.
This closes the SCN-static registration gap without changing the strict/native
contract, search order or view positions. Colony footprints use the existing
eligibility mask; auxiliary mines and owner-8 markers remain nonblocking. See
[HUMAN07 delivery verification](transport-human07-20260922.md) for the root cause,
source classification and bounded original-scene/replay tests.

`reinforce2` loops groups and members synchronously. With a matching coordinate
FIFO it appends types only; otherwise each iteration creates a real unit. FIFO
records retain no action team. `consumeTransportFifo(world, index, producerTeam)`
performs one real creation with the producer's team before popping the type.
The native producer gates and 450-step timer are external, not automatically
invented by this host. The ten-dword record capacity is enforced with a diagnostic
instead of allowing the native unchecked overflow to corrupt adjacent records.

## Slots And Removal

All 800 slot entries, per-slot generation counters and registry entries are
retained. Carrier slots are `15*payloadTeam + 7 + poolIndex`; their entity team
is 8. Eight independent reservations exist per payload team. Release preserves
the slot and registry, records idle task count 60, and makes the reservation
reusable. Reuse resets the slot and increments its generation. Repeated native
idle animation/task processing after release is not simulated.

Dynamic allocation starts at slot 152. The verified allocator scans up to the
exclusive high-water count and selects the **last** status-zero slot. If none
exists, it appends at high water. Native growth asserts when the incremented
count reaches 800; the host diagnoses that boundary without wrapping or using a
reserved carrier slot. Reusing a slot clears its old 220-byte projection.

`abduct` captures the actual full-width commander slot. Preparation does not
alter the target. After landing, the reducer checks the current position/status;
targets beyond native256 Manhattan distance 256 are chased, and status 0/10
targets are skipped. Capture follows native slot identity, not a fabricated
passenger object. At pickup, the host sets status 10 and task 10 `(1,0)`, then
clears collision in effect order. HP, team, type and registry membership remain;
no victim loss is emitted.

`updateTransportHostUnit` is the explicit external-unit port:

- `position` updates a live unit's native position, tile projection and collision.
- `combat-death` sets modeled health to zero, clears collision and appends one
  `MissionVictimLoss` with the campaign session/key/generation identity. Forward
  that loss to the controller once; do not also report the same death through
  a second bridge. Native combat task stacks/animation are not emulated.
- `complete-removal` acknowledges externally verified cleanup, sets status zero,
  clears the registry and removes the campaign entity. It requires status 10 and
  a matching generation. There is no unconditional 150-tick cleanup timer:
  native task-10 progression depends on definition field `+0x100`.

`transportHostCensus` counts registered payload units by `team,type`, not carriers.
Removing/dead units remain counted until explicit unregister, independently of
their combat-loss event. Generation checks reject stale unit updates.

## Projection And Ownership Limits

The host owns slots, registry, positions and collision after initialization.
Route external movement/death/cleanup through its unit port. Do not modify the
same raw fields behind its back or attach it over pre-expanded startup troops.
The host does not reconcile arbitrary external `newtype` or raw-slot mutations;
that integration needs an explicit ownership handoff before those paths are
combined. Renderer/simulation IDs for newly created campaign entities remain
unbound until the downstream bridge handles the creation request.

Raw bytes project position, height, type, team, status and verified noncombat
task-reset fields. The source removal helper resets `+0x38` to -1 before pushing
task 10; task push leaves top 0, opcode at `+0x39`, word-start offset 0 at `+0x3a`,
word-end offset 2 at `+0x3c`, and `(1,0)` at `+0x46/+0x48`. Animation/effect handles,
full native entity initialization and transport task-stack encoding are not
claimed. Browser health and task state live in `HostSlot`, not guessed raw fields.
Collision is explicit single-cell ground/flying occupancy; compound native
footprints and collision-cleanup internals remain outside this host.

## Evidence And Checks

Lifecycle, square order, pickup semantics and source speed address are documented
in [transport-decoding.md](transport-decoding.md). Additional disassembly against
its recorded executable hash establishes:

- `0x41b675..0x41b6ae`: start at 152; overwrite candidate on every status-zero slot.
- `0x41b6b9..0x41b6c9`: grow the high-water count, assert at 800.
- `0x416252..0x416262`: removal status/field/task reset.
- `0x411e7e`, `0x411f4a..0x411f69`: stack top, opcode and word-offset bookkeeping.

Run:

```sh
node --import tsx --test tools/qa/transport-host.test.ts tools/qa/legacy-transport.test.ts
npm run typecheck
```

Tests cover source-ordered payloads, blocked square search, movement-plane
relocation, source-speed gating, vertical pop/release boundaries, synchronous
creation and FIFO order, rollback, full-width commander chase, death versus
noncombat removal, registry lifetime, slot/pool reuse, generation guards,
idempotent campaign preparation, fixed-step partitioning and stable snapshots.
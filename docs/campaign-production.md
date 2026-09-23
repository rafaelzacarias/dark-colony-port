# Campaign Production Owner

2026-09-19. [campaign-production.ts](../src/engine/campaign-production.ts) is a
serializable command reducer plus an executable bridge to the existing transport
allocator. Opt-in source-clock session integration is now implemented for base
TRSC/GRAY only; see [production session](campaign-production-session.md) for its
native proof, exact inputs and replay contract. No view integration, complete
production phase, campaign workflow or destruction contract is accepted.

## Implemented Transaction

The tested path is DEPEND 9 / type 0 / team 1:

1. `reserve` removes the source cost 350 from that team's available credits.
2. `dispatch` transfers the reservation into producer FIFO 0 and adds 350 to
   the separate cost accumulator. It does not charge credits again.
3. The source producer selects a free exit, passes population/delay gates and
   starts its actual production animation. The host emits `producer-started`
   and calls `reserveCampaignProductionExit` on that started snapshot. Commit
   the started production snapshot and returned reserved world together.
4. Original `0x4264c8` runs against the real FIN production bank. At the actual
   `0x4147dc` spawn boundary the host emits `producer-completed`, mode 2.
5. The reducer emits a serializable `allocate-unit` request. The head remains
   in the FIFO, producer ready remains 0, and no further completion is accepted.
6. `allocateCampaignProductionUnit` uses `allocateTransportProductionExit` at
   the source-derived exact exit. This reuses the host's existing native-slot
   allocator, stats, registry and collision installation, not a second allocator
   or a reinforcement command. There is no position search on this path.
   The test obtains slot 152 / generation 0, team 1, type 0, HP 800, tile (50,47).
7. Only a real `create` receipt dequeues the head and restores ready 1. Credits
   stay spent; successful completion does not reduce the cost accumulator.

The returned production/world pair must be committed together. Allocation
failure throws with both inputs unchanged, retaining the paid head for retry.
This rollback policy is adapter safety, **not proof of native allocator-failure
refund/retry semantics**. Coordinate reinforcement FIFOs are explicitly rejected:
an `applied` reinforcement receipt that only appends to another FIFO is not a
production allocation. Commit the pair before consuming creation requests.

Native production calls `0x41b750 -> 0x41af14`. The old `reinforce2` reuse was
incorrect: its vacancy search skipped reserved `1022`, spawned beside the exit,
left the reservation behind and then dequeued production. General reinforcement
searching and coordinate FIFO behavior remain unchanged.

## Exact Exit Reservation

The host persists `productionExits` alongside collision state. The ownership key
is `JSON.stringify([sessionId, team, queue, headTicket])`; its record also binds
the intended unit type and tile. `reserveCampaignProductionExit` derives these
from the active source queue, never from UI-supplied coordinates. The lower-level
`reserveTransportProductionExit` only installs `1022` on a free, eligible cell,
or accepts an identical existing reservation idempotently. It cannot adopt an
unowned native sentinel. Two teams, queues or tickets cannot own the same exit
on the same movement plane, even if their colony coordinates coincide.

Allocation checks the active ticket, source queue/type/exit and map bounds, then
the type's movement plane and ground eligibility. It accepts either a free cell
with no reservation or `1022` with the exact owner. Unrelated occupants, unowned
sentinels, stale reservations and identity/type/location mismatches fail closed.
The reservation is replaced with the allocated slot and its ownership record
removed only in the returned world. Slot exhaustion preserves both input states,
including the sentinel, owner, credits, FIFO, registry, generations and high-water.
Free exact allocation remains supported; it does not authorize guessing ownership
of an already reserved cell. Persist reservation metadata with transport state.

## State And Ownership

`createCampaignProduction` copies and recursively freezes the catalog, unit
selectors and team seeds. Its snapshots contain only JSON objects, arrays,
strings and numbers: no Maps, Sets, closures or hidden factory state. Source
objects remain caller-owned and can be changed without changing the owner.
`productionSnapshot` detaches/freezes a trusted checkpoint; it is not a validator
for untrusted save-file contents.

Each team owns credits, cost accumulator, five City HP/level/busy records,
weapon/armor levels, scenario restrictions, pending reservations, **four distinct
typed FIFOs**, producer ready/delay/active-head state, construction phase and latch.
Two teams of the same race never share an account. TOWR is not the sixth City
pair and is not made constructible. Seeds require idle City slots; resume active
work from the complete production snapshot, not a fresh City seed.

Source adapters must provide:

- All DEPEND records with IDs intact. The checked source header is **80**, not
  65; IDs are sparse and include 83/84. The native scan covers IDs 0..109.
- GAMESTAT token 21 queue and token 23 exit selector, plus the signed exit offset
  at `0x41add0 + queue*24 + exitSelector*8`. Do not derive the producer from
  dependency prerequisites. Tests extract all 18 selectors and offsets natively.
- Actual per-team money, race, base, City state, SCN restrictions and initial
  weapon/armor bytes. Decode City through the existing source-level adapter.

The transport host continues to own dynamic raw slots, generations, registry and
collision. Production owns colony/economy facts; construction requests must be
projected to existing reserved colony IDs, not new dynamic building slots. Do
not run faction-wide simulation accounting in parallel with this owner.

## Commands And Availability

Commands are one reservation at a time: `reserve`, `release-pending`, then
`dispatch` for one DEPEND ID. Dispatch commits all pending members of that ID
in FIFO order. Use ascending DEPEND ID order when reproducing native dispatcher
`0x437f3c`; arbitrary UI batches are not a reconstructed network packet stream.
Native packet headers are not guessed.

`productionChoices` exposes `interfaceId`, native eligibility, supported status,
pending/queued counts, finite `maxAdditional`, `canDispatch` and
`canReleasePending`. Native eligibility is not synonymous with implemented UI
support. Native states are 0 satisfied, 1 eligible, 2 blocked. Refresh scans by
ID; completed building/upgrade conditions are tested before restrictions, exactly
as native code does. Prerequisite buildings must additionally have busy 0.
Tests compare every active state to x86 for both races, populated level-1 cities,
restrictions and an existing weapon upgrade.

Native pending limits are 50 per unit action and one per building/upgrade.
The owner additionally bounds **committed plus pending members sharing a FIFO**
to `queueSafetyLimit` (default 50, configurable 1..50). This is an explicit adapter
limit, not an inferred native total capacity. The native 800-byte stride does not
authorize 800 orders. The UI must not display an unbounded allowed count.

`release-pending` refunds exactly one undelivered reservation. As native UI lookup
requires state 1, this operation also requires current eligibility. A reservation
whose eligibility changes is retained, not silently dispatched or refunded.
There is no committed-FIFO cancel or active-building cancel/refund. Native queued
idle opcode 4/order 1 is deferred until normal construction reset; it must remain
in the source task host, not be translated into `release-pending`.

Enabled building commands are only first science labs DEPEND 2/16, slot 3,
level 0, race 0/1, type 20/32. The bounded receiver contract has source HP 2400
and cost 2000. Other building levels/types, repairs and duplicate raw-receiver
refunds are not exposed as commands. Upgrade commands use DEPEND prerequisites,
selector/type/level and immediate receiver writes with `1000*level` accounting;
there is no upgrade timer or UI level skip.

## Exact Host Callbacks

This section describes the original callback adapter without `sourceProfiles`.
With validated `sourceProfiles`, the owner advances its serializable FIN clock
through `stepCampaignProductionProducer`; `producer-completed` is rejected.
The session accepts purchase commands and native census/cap inputs only, never
these callbacks. `sync-credits` checks `expectedPreviousCredits` and accepts a
new signed32 `credits` value without changing pending reservations or the cost
accumulator. Resource settlements supply the actual session world balance.

Only the source task/animation/occupancy host may submit these events. UI and AI
submit purchase commands, **never native callbacks**. Events have unique IDs;
construction events additionally match dispatch ID/native entity ID, and producer
events match the exact queue-head ticket. Repeating the same event is idempotent;
reusing its ID with a different payload or giving a stale ticket is rejected.
The append-only journal is replayable from the same seed. Host effects must also
be journaled by the session; production replay alone cannot recreate a world.

| Event/request | Source observation and required host work |
| --- | --- |
| `initialize-science` | Apply receiver `0x41c8d4`, reserved-slot initialization `0x444f14` and action-19 initializer `0x41822c`. State projects HP/level, phase 0/busy 1. Apply identity, footprint and real FIN bindings before committing dispatch. |
| `arrival-created` | Main `0x4187e4` acquires the team latch and creates the incoming race-specific auxiliary through `0x418504`; phase 0 -> 1. |
| `build-started` | Auxiliary `0x418799` writes parent phase 2 and initializes the BUILD bank in mode 1. |
| `build-finished` | Main compares animation mode 2, clears busy at `0x418997`, enters phase 3 and creates departure. Latch stays 1. |
| `departure-finished` | Auxiliary `0x4187a0` writes parent phase 4. |
| `released` | Main `0x418a2d` clears latch and resets order; construction action ends. |
| `producer-wait` | Mirror the actual decrement at `0x4143ed..0x4143f1`, including zero holding. No head removal. A blocked-exit call also clears the blocking entity's `+0x35` at `0x41477f`; the source entity host owns that write. |
| `producer-started` | After free-exit sentinel `0x3ff`, expired delay and population checks, native reserves the appropriate ground/air exit as `0x3fe`, clears ready at `0x414700` and initializes producer `+0x24` at `0x414719`. The source host must call `reserveCampaignProductionExit` with the started snapshot and atomically commit its returned world with that snapshot. Bare collision writes lose ownership and are rejected at allocation. |
| `producer-cap-refund` | Only the ready-branch `0x414603` population rejection: `0x438090` cost refund, accumulator subtraction, head pop and message `0x77` at `0x414648`. Do not turn allocation failure into this callback. |
| `producer-completed` | Actual production animation mode 2 and native `0x4147dc` spawn boundary. Suspend native-equivalent head removal until the allocation transaction succeeds. |
| `allocated` | Host-only receipt from the existing transport allocator: native slot and generation (first generation is 0). It is included in the journal for deterministic production replay. |
| `upgrade-applied` | Immediately project `0x41ca04` weapon/armor writes to combat consumers and dependency/UI state. |

Do not also enqueue/debit/pop in another engine. The native callbacks describe
observations from an equivalent source host, not permission to execute two
independent mutable production owners. The bridge assumes exclusive session
ownership while committing its returned pair.

## Evidence And Limits

[campaign-production.test.ts](../tools/qa/campaign-production.test.ts) executes
the hash-pinned original executable via the existing research harness. It runs
bounded production probes, not the full lifecycle suite or a browser:

- Actual source parsing/cost lookup and all 18 production FIN bank bindings.
- Ground exit blocked, delay 2 -> 1, cap equal to population, below-cap animation
  start, active-animation wait and completion/spawn/pop. Census values are injected;
  native census enumeration is not claimed. FIFO copy and spawn are intercepted
   in these producer probes; the constructor is executed separately below.
- Unintercepted `0x41b750 -> 0x41af14` for both free `1023` and reserved `1022`
   at `(50,47)`: `0x41b444` clears the occupancy bits and `0x41b45c` installs
   slot 152, with team 1/type 0, active registry 152 and high-water 153. These
   are two writes within the constructor, not an intermediate committed world.
- A type-0 real FIN animation through native producer start, animation updates,
  completion and spawn arguments. No host-seeded completion delay.
- Human and alien normal construction with queued idle during phase 2: busy clears
  at 135/195, final latch releases at 186/246 outer calls. Zero lifecycle calls
  are intercepted; real FIN and main/auxiliary task transitions drive assertions.
- Credit/reservation/FIFO safety, all four producer queues, exact native eligibility,
  upgrades, immutable snapshots, replay and allocation failure rollback.
- Exact free/reserved placement, slot 152 generation 0 and reuse generation 1,
  reservation consumption, conflicting team/queue/ticket/type rejection, map and
  movement-plane checks, occupied-exit rejection with free neighbors, cap rollback,
  and unchanged reinforcement neighbor searching around a production reservation.

Run only this slice:

```sh
node --import tsx --test tools/qa/campaign-production.test.ts tools/qa/legacy-production.test.ts tools/qa/transport-host.test.ts
npm run typecheck
```

Tests require Python with Capstone and Unicorn. They honor `PYTHONPATH` and also
use the existing `/tmp/dc-re-capstone-20260918` and
`/tmp/dc-trigger-unicorn-20260918` installations. Missing native dependencies fail,
not skip. Source executable SHA-256 must be
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.

No countdown is advertised: `buildTimeTicks: null` in the legacy catalog is not
a completed production implementation. The callback adapter waits for actual
source events; the opt-in session advances original validated FIN profiles with
the shared native animation updater. Measured call counts are trace assertions,
not browser milliseconds or a replacement clock. Counter <=3/fallback construction, legal lethal
destruction, queue destruction refunds, native overflow/allocator failure and
general interruption cleanup remain outside the supported transaction.

## Required Live Coupling

The opt-in session now implements the following coupling for validated base
TRSC/GRAY. Main and view remain untouched. Other production hosts must:

1. Commit `producer-started` with `reserveCampaignProductionExit` at the native
   reservation boundary, before animation updates. Do not write a bare `1022`
   or claim an existing unowned sentinel using coordinates alone.
2. At source animation completion, call `allocateCampaignProductionUnit` and
   commit its returned production/world pair together. Keep the completed paid
   head and reservation on failure; never issue a population refund for failure.
3. Persist and restore `transportState.productionExits` with both snapshots,
   including team/queue/ticket/type/tile. Old reserved snapshots without an owner
   need explicit source reconciliation, not implicit adoption by this API.
4. Consume the single creation request with its slot/generation to bind downstream
   simulation/rendering. Do not re-spawn or independently dequeue the head.

Source scheduling beyond the explicit one-visit-per-session-step contract and
destruction/cancellation cleanup remain integration obligations. The opt-in
session admits and verifies replay checkpoints as documented in the session
handoff; this does not admit arbitrary native mid-game snapshots.

References: [production audit](production-runtime-audit.md),
[construction lifecycle](construction-lifecycle-20260919.md),
[City layout](scenario-city-layout.md), [transport host](transport-host.md).
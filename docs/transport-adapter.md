# Transport Adapter

[legacy-transport.ts](../src/engine/legacy-transport.ts) is a pure, deterministic
command/result reducer based on [transport-decoding.md](transport-decoding.md).
It is not wired into the simulation. No existing startup formation, trigger,
census, renderer, movement, or mission-exit behavior is changed.

## Integration Contract

Create state with `createTransportState()`. Pass state and a `TransportCommand`
to `reduceTransport`; persist the returned state and execute effects in order.
Inputs and outputs are readonly by contract, not runtime-frozen. The reducer
does not mutate inputs; consumers must not mutate returned states or effects.
Both state and command streams are JSON serializable for replay.

- `reinforce`: supply payload team 0..7, the native side field, exactly five
  ordered byte-sized type/count groups, tile coordinates, and two direction bits.
  Pad omitted trailing pairs with `(0,0)` before calling. Type zero is valid.
  Leading `(0,0)` special mode and a leading type-255 pickup marker are rejected.
- `abduct`: resolve the actual registered commander slot and provide its status
  and native position. Null/invalid references are diagnosed; status 0/10 does
  nothing. The full unsigned 16-bit slot is retained, never narrowed to a byte.
- `initialize-carrier`: reinitialize the fixed entity slot and reset its tasks.
  Each payload team reserves the first free of eight entries; slot is
  `15*team + 7 + poolIndex`. Entity team is always 8, not the payload team.
  Type is 93 for side field 1, otherwise 92. Pool exhaustion is a diagnostic,
  not a silent drop or an internal retry queue.
- `invoke`: one native task invocation, not elapsed milliseconds. Descent takes
  51 invocations; the last height calculation is base+3 on call 50 and call 51
  pops without calculating base height. Ascent calculates steps 0..49 in 50
  invocations, ending at base+7203. Both pop calls return `redispatch: false`.
- `orient`: delegate direction quantization/orientation to the host. Reply
  `oriented` only when it completes; execute the resulting `move` effect and
  reply `arrived` only when native movement completes. Invoking these waiting
  phases has no effect. Arrival snaps adapter position to stored destination.
- On payload `invoke`, answer `inspect-occupancy` with `occupancy`. Vacant
  occupancy emits one `create-unit`; run the actual native-compatible allocator,
  update collision/census, then reply `created` with success. Only successful
  acknowledgement consumes cargo. Creation may relocate according to unit
  movement class; adapter destination remains the carrier's destination.
- Blocked occupancy or remaining cargo emits `select-position`. Use the original
  requested tile, ground plane, native radius/square scan order and eligibility
  checks, then reply `next-position` in native256 coordinates. Null diagnoses
  a full map and retains cargo. Orientation/movement must finish before another
  payload attempt. Failed allocation similarly diagnoses and retains cargo;
  this failure handshake is an adapter boundary, not an invented native retry.
- Pickup first consumes its marker (`redispatch: true`), then requests the
  captured slot's current commander state. Answer `commander`, including current
  status and position. Active targets beyond Manhattan distance 256 cause a new
  orientation/move request to their current position. Supply fresh state after
  every chase; status 0/10 skips removal and starts departure.
- At distance <=256, apply `remove-noncombat` then `clear-collision` in order
  before further invocation. Implement the native task reset, status 10,
  animation, field cleanup and task-10 `(1,0)` setup. Do not zero HP, transfer
  teams, increment combat losses, or immediately unregister/delete the entity.
  Later task-10 cleanup and its conditional registry lifetime belong to the host.
- After ascent pops, a separate `invoke` releases the reservation and emits
  `carrier-released`: preserve the carrier entity and set animation/task-3 idle
  count 60. Reuse resets that same fixed slot. Released records remain until
  reuse, with unique request IDs so replies to prior reservations are rejected.
  Repeated native post-release idle processing belongs to the host.

Replies resolve external operations within their originating task invocation;
they do not each represent another simulation update. Process synchronous
occupancy/creation/search/removal effects before advancing the entity dispatcher.
`redispatch: true` allows continuation in the same entity update (not a timer).
For orientation and movement, the host must first honor the native task's return
and completion semantics, then send its completion reply. Do not automatically
invoke every carrier phase in a tight loop: vertical pops explicitly defer work.
Wrong-phase replies, stale IDs and mismatched commander slots diagnose without
changing state. Diagnostics require an explicit host policy; no automatic retry,
successful extraction, fallback coordinate, or lost cargo is inferred.

## Coordinates, Timing And Limits

All carrier/commander/destination positions are native unsigned-word coordinates
with 256 units per tile. `tileToNative256` uses tile centers; `native256ToTile`
floors. `native256ToSubcells(position, scale)` performs explicit scaling and
does not round; the host owns rounding if its scale cannot represent the result.
Do not compare runtime subcell coordinates directly with pickup radius 256.
Initial direction offsets are independently `512*bit-256`, with word wrapping
at map edges, not terrain clamping or troop formation placement.

Direction bits must come from a deterministic injected source. Replaying them
reproduces this adapter, but native RNG table/state progression is still unported.
No `Math.random`, elapsed-time movement estimate, or guessed orientation duration
is used. Native horizontal speed, quantization, orientation timing, effects and
animation remain host responsibilities. Initial adapter height is the first
descent sample (base+7500); this is not proof of native pre-dispatch rendering.

`bail` is deliberately absent from transport state. The mission controller owns
the independent wrapped wall-clock deadline: exact equality does not expire it.
Neither pickup nor release gates or extends that deadline. Simulation pause
means withholding `invoke`, while the wall-clock exit check remains independent.
Source `c` clock and trigger scanning likewise belong outside this reducer.

`reinforce2` coordinate FIFO/direct creation is a separate synchronous workflow,
not a carrier request. This adapter does not implement it or task-10 cleanup,
restored native task stacks, placement search, movement, or real slot allocation.
Before integration, replace existing pre-expanded reinforcements rather than
layering this adapter over them. No native-game timing or full mission fidelity
is claimed.

## Verification

Run `node --import tsx --test tools/qa/legacy-transport.test.ts` and
`npm run typecheck`. Tests cover invocation counts and heights, explicit waiting,
ordered groups, retained blocked cargo, independent fixed pools/reuse, pickup
chase and range boundaries, inactive/missing references, and serialized replay.
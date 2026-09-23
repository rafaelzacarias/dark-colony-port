# First-Mission Transport Adapter Evidence

Audited 2026-09-18. Scope: `abduct`, `reinforce`, `reinforce2`, their ordering
relative to `bail`, and the source `c` clock. No runtime implementation changed.
This extends the partial transport trace in [trigger-runtime.md](trigger-runtime.md).

## Result

**The transport lifecycle is asynchronous and is not a mission-exit barrier.**
`abduct` creates a carrier task; it does not delete the commander at action time.
Pickup later changes the commander to status 10 and clears collision without
the combat-loss counter writes. The carrier then ascends and releases its pool
reservation. `bail` independently expires after 10,000 wall-clock milliseconds;
it neither waits for pickup nor guarantees that the carrier has departed.

**`reinforce` and `reinforce2` are different operations.** One `reinforce`
action creates one carrier holding five ordered type/count groups. Units are
created sequentially after descent and horizontal approach, with collision-aware
placement. `reinforce2` synchronously attempts each unit: enqueue its type in a
matching coordinate FIFO, or create it immediately if no FIFO matches.

The smallest faithful adapter needs a small carrier state machine, persistent
entity slots, collision-aware creation/removal, and independent simulation and
wall clocks. Static formation offsets, pre-expanded startup troops, instant
commander deletion, and silently ignored transport actions are not faithful.

## Reproduction and Evidence Limits

Executable: [../raw_cd/DC/DC.EXE](../raw_cd/DC/DC.EXE), SHA-256
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
All addresses below are x86-32 virtual addresses, not file offsets.

[../tools/research/transport-audit.py](../tools/research/transport-audit.py)
checks the hash, maps PE sections, verifies 27 exact instruction anchors, and
delegates disassembly/xrefs to the existing
[../tools/research/trigger-audit.py](../tools/research/trigger-audit.py).

```sh
export PYTHONPATH=/private/tmp/dc-re-capstone-20260918:/private/tmp/dc-trigger-unicorn-20260918
python3 tools/research/transport-audit.py verify
python3 tools/research/transport-audit.py probe
python3 tools/research/transport-audit.py mission-evidence
python3 tools/research/transport-audit.py disasm 0x418a48 0x419238
python3 tools/research/transport-audit.py disasm 0x4182e8 0x418503
python3 tools/research/transport-audit.py disasm 0x43e18b 0x43e3c7
python3 tools/research/transport-audit.py disasm 0x41b4a0 0x41b74f
python3 tools/research/transport-audit.py disasm 0x41e190 0x41e20f
```

Capstone is required; `probe` additionally needs the already installed Unicorn
environment above. These are research dependencies, not application dependencies.
`mission-evidence` prints actual TRO lines and hashes of both missions' TRO/SCN.

`probe` executes original instructions for both reinforcement parsers (including
their native numeric conversion), task 21, task 22, the pickup removal
helper/task-stack writes, the `reinforce2` action handler, and its coordinate
FIFO. Animation, collision cleanup, movement setup, ascent setup, idle setup,
creation, and next-cell selection are explicit intercepted boundaries. Thus
the tests prove branching, mutations, group ordering, call order, and vertical
step counts; they do **not** prove full flight duration, rendering, collision
cleanup internals, spawned entity initialization, or original-game playback.
Disassemble from the listed function entries; embedded tables are data.

Verified executable probes:

- Both native reinforcement parsers read ALIEN01's shortened argument line
  and write an omitted fifth type/count pair as `(0,0)`, over nonzero sentinels.
- Active target at fixed-point Manhattan distance 256: removal, collision clear,
  then departure setup. At 257: retarget movement, no removal.
- Target status 0 or 10 during pickup: advance without removal, then depart.
- Pickup preserves type/team and does not directly write either loss table.
- Descent pops after 51 invocations; ascent after 50. With base height 600,
  their last calculated heights are 603 and 7803, respectively.
- Payload `(0,2),(69,1),(0,0),(0,0),(0,0)` calls creation in order `0,0,69`,
  once per payload invocation, and schedules departure after the last.
- Blocked delivery preserves cargo and calls next-cell selection then movement.
  Release clears only the selected reservation and leaves carrier status active.
- `reinforce2` with that payload makes three synchronous creation calls without
  a matching FIFO; with a FIFO it queues `0,0,69` and makes no creation calls.

## Functions and Data

| VA | Role |
| --- | --- |
| `0x43eb5c`, `0x43ec73` | Parse `reinforce` opcode 2 / `reinforce2` opcode 15. Both parse team, X, Y, then five type/count pairs. |
| `0x43e18b` | Opcode 2 passes team in EDX, tile X/Y in EBX/ECX, type/count array pointers on stack to `0x418f4c`. |
| `0x43e1b1` | Opcode 19 selects commander and encodes pickup payload. |
| `0x43e349` | Opcode 15 loops groups then members; calls `0x4404c0` before optional creation `0x41b634`. |
| `0x418f4c` | Allocate/reinitialize pooled carrier and push delivery, approach, and descent tasks. |
| `0x418a48` | Task 21: payload handling, pickup, group delivery, release. |
| `0x4182e8`, `0x4183b8` | Push/update task 22: vertical descent/ascent. |
| `0x412388`, `0x4125bc` | Push/update task 5: horizontal movement, with task 4 orientation preparation. |
| `0x411dd8`, `0x411f74` | Push/pop entity task stack. Top is signed byte entity+0x38; payload storage starts at +0x46. |
| `0x419248`, `0x4194fa` | Per-entity update and indirect task call through `0x479310 + 4*opcode`. |
| `0x416220` | Pickup's noncombat removal: status 10 and cleanup task 10. |
| `0x434d48` | Collision cleanup called after pickup removal. Its complete internal effects are not emulated by this probe. |
| `0x41b4a0`, `0x41b634`, `0x41af14` | Find vacant cell, allocate slot, initialize actual delivered entity. |
| `0x440410`, `0x4404c0`, `0x440520` | Register coordinate FIFO, append unit type, pop unit type. |

Entity base is `game+0x7d28`, stride 220. X and Y are unsigned fixed-point
words at +0 and +4, with 256 units per tile; vertical height is word +2.
Type/team are bytes +6/+7; status is byte +0x2c.

Transport reservation pool: eight bytes per requested team at
`game + 0xe30*team + 0x19ab`. First free index `poolIndex` is selected.
Carrier entity slot is `15*team + 7 + poolIndex`. Pool exhaustion reaches an
assertion; this is not an original silent drop or an inferred retry queue.
The constructor selects type 93 when side field `game+0xe30*team+0xbb8 == 1`,
otherwise type 92. Initialization passes entity team **8**; payload ownership
is stored separately. Do not give the carrier the payload team's census entry.

Task-21 payload layout (word offsets):

| Offset | Meaning |
| --- | --- |
| `+0..+8` | Five packed `(type << 8) | count` words, or pickup marker/list. |
| `+0xa,+0xc` | Original requested tile X/Y, retained for subsequent placement searches. |
| `+0xe` | Phase: 0 initially, 1 processing, 2 departure scheduled/completed. |
| `+0x10` | Group/list cursor, initially 0. |
| `+0x12` | Payload team. |
| `+0x14,+0x16` | Current fixed-point destination X/Y. |
| `+0x18` | Effect handle, copied into vertical tasks. |

## Exact Lifecycle

### Construction and Arrival

1. Reserve the first free carrier entry, initialize its fixed slot, clear its
   old tasks (`0x419061`, `0x41906a`). No passenger is created/removed here.
2. Initial carrier X and Y independently equal tile center minus or plus one
   tile: `tile*256 + 128 + 512*bit - 256`. The two bits come from successive
   original RNG entries (`0x41906f` through `0x4190ea`). This is carrier position,
   **not** the delivered troop formation.
3. Push task 21 with all five words and original destination center.
4. Push horizontal approach via `0x412388`, which pushes movement task 5 and
   orientation task 4. Then push descent task 22 (`0x4191ea`, `0x41922b`).
5. Tasks execute LIFO: **descent -> orientation -> horizontal approach ->
   payload**. The dispatcher retries in the same entity update only when a
   task returns nonzero (`0x41956c`). A task returning zero defers further work.

Vertical task stores initial velocity 0, acceleration 6, base height 600
(type 92) or 1200 (type 93), outbound flag, step, and effect handle.
Height follows `base + velocity*step + trunc(acceleration*step*step/2)`.
Descent starts at step 50; each call computes using the old step and decrements
it, and the following call at zero pops. Ascent starts at zero and pops when
increment reaches 50. Both return zero, including the pop call. No milliseconds
are embedded in these constants. Horizontal movement uses definition dword
`0x4f188c + 280*type` and original direction quantization; fixed arrival delays
cannot replace that task if exact timing is required.

### Abduction and Removal

`abduct selectedSide carrierSide` reads signed commander-slot word
`game+0xe30*selectedSide+0x1934`. It skips status 0/10, otherwise captures the
commander's current tile and calls the constructor for `carrierSide`.
The payload begins `0xff01`, followed by the **full 16-bit entity slot**;
later words are unused for this one-target operation. The handler initializes
only the marker and slot bytes, not the unused tail of its stack buffers.
There is no team transfer and no immediate target mutation.

At task-21 processing, phase becomes 1. Cursor 0 consumes the marker, increments
to 1, and returns 1, allowing another dispatch in that entity update.
The carrier snaps to its stored movement destination before the target test.
For the selected slot:

- If status is 0/10, skip removal and advance the cursor.
- If active and `abs(carrierX-targetX)+abs(carrierY-targetY) > 256`, push a
  move to the target's **current** fixed-point position, update stored destination,
  and return zero. Movement of the target can therefore postpone pickup.
- Otherwise call `0x416220`, then `0x434d48`, then advance the cursor.
- When cursor equals pickup count plus one, set phase 2 and push ascent.

`0x416220` resets task fields +0x38/+0x39/+0x3a, writes status 10, clears +0x13,
sets animation through `0x42630c`, and pushes task 10 with words `(1,0)`.
It does not zero HP, change type/team, immediately unregister the slot, or
execute the combat branch's aggregate/per-type victim-loss increments.
Task 10 at `0x416460` can eventually set status 0 and registry word
`game+0x468ec+2*slot=-1` when its counter reaches 150; progress is conditional
on definition field +0x100. Do not infer an unconditional 150-tick free or
instant removal from the registered census. Exact rendering/animation cleanup
must follow that separate path, not a synthetic death/loss event.

**Missing commander slot:** the action does not test slot -1 before entity
address arithmetic. Status-based skips are verified; a safe meaning for an
invalid commander reference is not. An adapter should diagnose this invariant
violation rather than invent successful extraction.

### Reinforcement Delivery

One action owns one carrier, not one carrier per group. Groups retain source
order; type **0 is valid**, and `(0,4)` means four type-0 units, not termination.
After arrival, task 21 tests ground occupancy at its current destination:
`map+0x804` row plane, dword cell masked with `0x3ff`, vacancy `0x3ff`.

- If vacant, call `0x41b634` once for the current group and payload team;
  decrement that group's count only on this path.
- When the count reaches zero, advance to the next nonzero-count group.
  Exhausting five groups sets phase 2 and pushes ascent immediately.
- If blocked, retain the count. If cargo remains after a successful spawn,
  or after a blocked attempt, find another destination with `0x41b4a0`, push
  horizontal movement, and return zero. There is no batch instant expansion.
- Next-destination search uses the **original requested tile**, not an
  incrementing formation index or the last delivered unit's position.

`0x41b4a0` searches radius 0 through `max(width,height)-1`; at each radius
it scans the whole square, X ascending in the outer loop, Y ascending inside.
It skips out-of-map cells. Ground selection requires map cell-record byte +0xc
nonzero and ground occupancy vacancy; flying selection checks the flying plane.
Task 21 requests ground selection explicitly. The actual unit allocator calls
the same helper using the delivered type's movement class (except type 40).
Thus even the first creation can relocate from an invalid requested tile.
No free cell reaches an assertion, not a clamped coordinate fallback.

Special payload `(type=0,count=0)` in the **first** word has a separate path at
`0x418caa`: it decodes a source entity from later low bytes and writes 150 to
that entity's current task data before departure. This is not an empty delivery
no-op. First-mission ordinary reinforcements have positive first counts; reject
this special mode until its producer is intentionally supported.

### Departure and Pool Release

Payload completion pushes ascent while phase is 2. Only **after ascent pops**
does task 21 run its phase-2 branch (`0x418a8c`): clear the reservation byte,
set animation, push task 3 with count 60 through `0x412274`, return zero.
Task 3 counts down while activity/HP checks remain unchanged; it can end early
on those changes. Phase 2 remains set, so a carrier not reused can repeat this
idle path. This is a pooled carrier, not a new entity deleted at the map edge.
Reuse reinitializes its fixed slot and resets its task stack.

## Reinforce2 and First-Mission Sources

`0x4404c0` scans up to the registered count at `0x4796b4`, entries of 52 bytes
at `0x4fe454`: X, Y, count, then queued type dwords. Matching X/Y appends the
type and returns true, suppressing immediate creation. The queued record does
not retain the action's team. The consumer at `0x4133ed` pops FIFO order and
eventually creates using the occupying producer's team (`0x413459`). Its
450-step timer and type-6/14 producer/structure gates are a different workflow,
not the transport lifecycle. This audit does not claim a complete FIFO producer
adapter. Source registration's loader branch compares type 37 at `0x41c5c0`
and calls `0x440410` at `0x41c622`.

Both first-mission SCNs contain zero type-37 placement rows. For fresh ALIEN01,
the source supports the no-FIFO/direct path at `(66,67)`; restored games must
preserve real queue state. Do not generalize this absence to other missions.

| Mission / Trigger | Transport behavior in execution order |
| --- | --- |
| HUMAN01 / 8, `c>0` | One carrier for team 0 at `(22,2)`, delivering four type 0 then one type 69. |
| HUMAN01 / 1 | One carrier at `(54,19)`, four type 0, team 0. |
| HUMAN01 / 7 | One carrier at `(29,58)`, four type 0, team 0. |
| HUMAN01 / 4 success | Reverse source order: `bail 0 1`, message, `abduct 0 0`. |
| ALIEN01 / 1, `c>0` | Message, then `reinforce2` team 1 at `(66,67)` with type 69 count 1, then carrier for team 0 at `(22,26)` delivering type 73 count 1 followed by type 8 count 4. |
| ALIEN01 / 4 | Team 0 carrier at `(29,63)`, four type 8. |
| ALIEN01 / 6 | Team 1 carrier at `(43,51)`, five type 0. |
| ALIEN01 / 7 | Team 0 carrier at `(22,26)`, three type 8. Its trip region is absent in the source MTG; do not synthesize one. |
| ALIEN01 / 8 | Team 0 carrier at `(72,50)`, two type 8. The source line has four explicit pairs; both original parser probes verify the omitted fifth pair becomes `(0,0)`. |
| ALIEN01 / 10, `c>10` | `abduct 1 1`, independent of mission success. |
| ALIEN01 / 3 success | Message, `abduct 0 0`, then `bail 0 1`. |

Sources: [HUMAN01.TRO](../raw_cd/DC/SCENARIO/HUMAN/HUMAN01.TRO),
[ALIEN01.TRO](../raw_cd/DC/SCENARIO/ALIEN/ALIEN01.TRO),
[ALIEN01.SCN](../raw_cd/DC/SCENARIO/ALIEN/ALIEN01.SCN).
Order across actions is reversed by the trigger list, but **order inside a
reinforcement action's group array is not reversed**.

## Clocks and Bail

The simulation update `0x4196f4` increments `game+0x52c` once at `0x4198bd`.
Expression `c` is `i16(i32(counter) >> 4)` (`0x43d570`). Normal trigger scans
are gated by `(game+0x94c & 7)==0` at `0x419a4e`, before the registered-entity
update loop at `0x419bb8`. Both live and replay update callers increment +0x94c
before invoking the update (`0x41e1f9`, `0x41cb4e`). On a fresh synchronized
start, normal scans occur every eight simulation updates, not every render.

Live scheduling at `0x41e190` subtracts accumulator `game+0x960` from
`timeGetTime()`, then performs catch-up updates while elapsed is **greater
than** interval `game+0x970`, adding that interval to the accumulator each time.
The interval initializes to **66 ms** (`0x41ba2c`), but is mutable (`0x41dc2a`).
Configuration also supplies a requested interval through +0x96c; neither field
establishes a universal 16 Hz clock. Replay can execute a byte-specified number
of updates without a wall-clock wait (`0x41cb2c`).

For a constant live interval `T` ms, one source-c unit represents **16*T ms
of scheduled simulation time**, not necessarily one second. At the initialized
66 ms interval: 1056 ms per c unit; `c>0` first qualifies at update 16,
`c>10` at 176 (11.616 s nominal), `c>1200` at 19216 (1268.256 s nominal).
These are counter thresholds, not guaranteed real-time firing instants under
pause, changing speed, replay, delayed scheduling, or signed-word wrap.

`bail` stores `timeGetTime()+10000`, flag, and result statistics in its handler.
The main loop `0x4011f1` checks **only** pending flag and wrapped clock difference;
it exits when `(deadline-now) mod 2^32 > 0x80000000`. At exact equality to the
deadline it continues. There is no transport-completion condition in this test.
Keep simulation and transports running during the delay; later actions/triggers
can overwrite the pending result. Do not extend the deadline for a moving target
or claim that the 50-step ascent always finishes before it.

## Minimal Adapter Contract and Remaining Blockers

The following are proposed adapter events, not claimed original symbol names:

1. `transportRequested`: reserve pool entry; retain ordered groups or selected
   commander slot; initialize carrier and original RNG-dependent position.
2. `descentComplete`, `approachComplete`: drive the task stack in simulation
   updates, including orientation; never synthesize passenger creation here.
3. `unitDelivered`: on the verified vacant-cell branch, allocate and initialize
   exactly one entity and update occupancy before the next payload attempt.
4. `commanderPickedUp`: only on verified active/range predicate, perform status
   10/task reset/collision cleanup with no synthetic victim-loss statistic.
5. `ascentComplete` then `carrierReleased`: release only the carrier reservation;
   preserve the deferred commander cleanup/census distinction.
6. `bailDeadlineExceeded`: independent wall-clock exit, not extraction success.

Known browser mismatch is confined here to documentation: initial expansion in
[../src/engine/legacy-mission.ts](../src/engine/legacy-mission.ts#L47)
creates both reinforcement kinds before trigger execution, in source action
order, using `FORMATION_OFFSETS` and clamping. It must eventually be replaced
at the adapter boundary, not layered under transport events or it will duplicate
units. No change was made to that file.

Remaining requirements before claiming a faithful runtime integration:

- Bind exact slot allocation, commander registration, collision planes, type
  changes, and registered census to real world state. Do not replace slot
  selection with the first live commander in a compact array.
- Port/reuse original fixed-point movement/orientation and RNG state, or openly
  label timing approximate. This probe stubs these boundaries; full flight
  duration, visual behavior, and collision cleanup are not end-to-end verified.
- Preserve task-10 cleanup/animation and registry lifetime after pickup. The
  observed status-10 write alone does not authorize immediate deletion or a
  loss-counter event.
- Preserve ALIEN01 trigger 8's verified missing trailing zero pair, but do not
  confuse it with the special leading `(0,0)` payload or generalize the probe
  to arbitrary malformed input.
- Full coordinate-FIFO production, loaded-save states, exhausted pool/full-map
  assertions, and invalid commander-slot behavior require explicit support or
  diagnostics. They are not grounds for no-op transport implementations.

No original-game execution or full first-mission completion is claimed. These
are grounded state transitions and narrow executable checks sufficient to
replace the *guessed* lifecycle design, not proof that the current browser
simulation already supplies every required dependency.
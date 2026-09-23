# Production Runtime Audit

Source-only follow-up: [native-construction-host-20260919.md](native-construction-host-20260919.md)
adds actual mode9 science receipt, fixed-slot construction visits and replayable
checkpoints. Session/transport admission and lethal interruption remain blocked.

2026-09-19. Scope: source production/economy integration research only. Owned
files are this report and
[production-audit-20260919.py](../tools/research/production-audit-20260919.py).
No shared runtime, generated data, acceptance gates, or existing documents were
changed. No agents, browser, full suite, package installation, or game boot.

## Decision

**Production is not ready for campaign acceptance.** The missing contract is
not simply a caller for the catalog helper. Native production uses per-team
credits, UI reservations, four typed unit FIFOs, reserved colony identities,
animation-driven completion, and separate slot-busy and team-construction
states. The current generic building countdown cannot stand in for these.

This audit closes bounded native evidence gaps; it does not accept any whole
phase or reduce a completion gate to partial acceptance. Exact source-backed
construction durations, several lifecycle boundaries, authoritative integration,
and campaign workflow verification remain required.

An important correction to the historical handoff: the current
[table parser](../tools/extractors/data/tables.ts) already fixes DEPEND grammar
and GAMESTAT health. A read-only comparison passed for **all 80 generated
dependency records and all 106 generated health values** against today's source
parser. The old parser-corruption finding in
[balance-runtime.md](balance-runtime.md) is not a current blocker for this
snapshot. It does not follow that production is integrated.

## Reproduction

The probe refuses an executable other than SHA-256
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
Addresses below are virtual addresses. Existing Capstone/Unicorn packages suffice:

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 tools/research/production-audit-20260919.py
```

The JSON contains source hashes, all 80 costs/metadata/prerequisite records,
GAMESTAT scanner destinations, all 18 troop queue selectors, 15 raw colony-slot
queries, and **40 focused behavior fixtures**. Assertions execute original x86,
not a replacement production implementation. Successful final native output:
`/tmp/dc-production-final-native-20260919-28.log`. The generated-data comparison
passed in `/tmp/dc-production-generated-20260919-27.log`. These temporary logs
are convenience evidence; rerun the owned script for native reproduction.

The workspace has no Git metadata and other work was concurrent. Uniquely named
logs, rather than interleaved terminal output, were used to determine results.
Runtime observations below describe the files inspected during this audit.

## Timer To Completion

### Tested Building Branch

The initial hypothesis, a scalar build countdown in the action's auxiliary
word, was **falsified**. That word is a phase. Native initialization
`0x41822c` writes phase `0` through action `0x13`'s auxiliary pointer and sets
the colony slot busy byte to `1`. Team 1 / slot 3 / native ID 18 was executed.

Construction update `0x4187e4` controls the following branches:

| Input | Native result |
| --- | --- |
| Phase 0, team latch already 1 | No progress; phase 0 and busy 1 retained |
| Phase 0, latch 0, game counter `game+0x94c = 3` | Phase 5 fallback, then busy 0 and latch 0 in the same call |
| Phase 0, latch 0, counter 4, nonzero construction-animation pointer | Auxiliary construction dispatch `0x418504`; phase 1, busy 1, latch 1 |
| Phase 1, animation state 2 | Still phase 1 and busy 1 |
| Phase 2, animation state 1 | Still phase 2 and busy 1 |
| Phase 2, animation state 2 | Busy cleared, auxiliary dispatch, phase 3; latch remains 1 |
| Phase 3 | Waits; does not itself clear busy or latch |
| Phase 4 | Clears latch and calls order reset |
| Phase 5, animation state 1 / 2 | Holds / clears busy and latch, respectively |

All ten fixtures execute the original animation initializer `0x42630c`.
Phase 0 tests seed a nonzero animation pointer in both counter cases, isolating
the `>3` branch at `0x418868`. Disassembly also shows that a zero construction
animation pointer takes the fallback regardless of that counter. Initial city
placement and later construction therefore must not share an invented fixed delay.

The completion comparison is `entity+0x1a == 2` at `0x418929`; busy clears at
`0x418997`. The team latch is distinct, clearing at `0x418a2d`. HP was unchanged
by the completion fixtures. Nonzero HP is not proof of producer readiness.

### Executed Countdown Chain

The strongest timing probe runs **native animation update `0x4264c8` followed
by native construction update `0x4187e4`**, repeatedly on the same memory. It
starts at phase 2, one-shot animation mode 1, frame 0, and a seeded first-frame
delay. Native animation records have a frame count at `+0x28`, frame records
through `+0x20`, stride 72, and a byte delay at frame `+2`.

| Synthetic frame delays | Calls before completion | Call clearing slot busy |
| --- | --- | --- |
| `[1,1]` | Busy through call 2 | 3 |
| `[2,3]` | Busy through call 5 | 6 |
| `[7,4,2]` | Busy through call 13 | 14 |

The updater decrements the delay; when it enters a call at zero it advances the
frame. At the frame-count boundary it marks mode 2 (`0x426523`). The construction
handler then clears busy, resets the main animation to mode 0, and enters phase
3. For these explicitly initialized positive-delay fixtures, completion takes
`sum(delays)+1` calls. **These are not measured durations for real buildings,
simulation ticks, milliseconds, or seconds.**

Still unverified: source FIN bank/duration initialization for each constructible
type, the auxiliary object's phase-1-to-2 and phase-3-to-4 transitions, actual
update ordering/cadence, first-frame initialization, delay-byte zero/wrap cases,
and construction interruptions. The probe establishes a falsifiable completion
mechanism, not a complete build transaction from UI click to finished building.

## Colony And Queues

Let `T = game + 0xb98 + team*0xe30`. Keep these separate:

| Field | Native location |
| --- | --- |
| Available credits | `T+0x14` |
| Separate cost accumulator | `T+0x18` |
| Race | `T+0x20` |
| Colony base coordinates | `T+0x2c/+0x30` |
| Slot HP / upgrade level / busy byte | `T+0x3c+4*slot` / `T+0xc4+4*slot` / `T+0x78+slot` |
| Unit producer ready / delay byte | `T+0x108+queue` / `T+0x10c+queue` |
| Unit FIFO length / unit-type bytes | `u16(T+0x110+2*queue)` / `T+0x118+800*queue` |
| Scenario dependency restriction | `T+0xda4+dependencyId` |
| Team construction latch | `T+0xe12` |

Reserved colony ID is `team*15+slot`; entity address is
`game+0x7d28+220*nativeId`. Retain the initial projection's positions and
footprints from [colony-runtime.md](colony-runtime.md), but add an actual lifecycle.
The trigger `b(team,slot)` reads slot HP, not busy or animation phase.

Executed slot-to-queue mapper `0x41ae6c`, with type banks read from `0x47afa8`:

| Slot | Human type, level 0 / 1 | Alien type, level 0 / 1 | Producer queue |
| --- | --- | --- | --- |
| 0 | 16 / 16 | 28 / 28 | 2 |
| 1 | 17 / 17 | 29 / 29 | 0 |
| 2 | 18 / 19 | 30 / 31 | 1 |
| 3 | 20 / 21 | 32 / 33 | 4: no unit production in this service |
| 4 | 22 / 22 | 34 / 34 | 3 |
| 5 | 81 / 81 | 81 / 81 | 4 |

Raw bank entries for slots 6..12 are type 25; construction update specifically
uses auxiliary slot `team*15+6` and types 92/93. Those facts do not make these
slots player-constructible buildings. Raw entries/mapper reads for 13/14 are
reported but do not establish valid production semantics for those inactive
slots. DEPEND buildings in this corpus target only slots 0..4.

Executed GAMESTAT scanner argument construction pins zero-based source token
21 to native `+0xec` (queue selector), and token 23 to `+0xf0` (exit selector).
Queue groups from all 18 source troop rows:

| Queue | Unit types | Owning colony slot |
| --- | --- | --- |
| 0 | 0, 8, 43, 44 | 1 |
| 1 | 1, 2, 3, 9, 10, 11 | 2 |
| 2 | 5, 6, 13, 14, 49, 50 | 0 |
| 3 | 4, 12 | 4 |

Types 5/13/49/50 use exit selector 1; the other producible types use 0.
Do not infer the producer from a prerequisite's slot, interface ID, sprite,
faction string, or generic building allocation order.

### Executed Unit Queue Boundaries

`0x41c7f8` appends the packet's count of unit types to the selected FIFO. The
probe seeded `[43]`, appended three type-0 units, and obtained `[43,0,0,0]`,
count `1 -> 4`, credits `777 -> 777`, cost accumulator `100 -> 1150`.
Cost lookup is native and returns 350. The queue selector is seeded to the
source-confirmed value 0; this is not execution of the entire GAMESTAT loader.

Service `0x414314` maps the producer's reserved slot to a queue. On its active
animation branch, `entity+0x2a == 1` waits. The two fixtures produced:

- Animation 1: count 2, head type 0, ready 0, no spawn call.
- Animation 2: one spawn call for type 0/team 1 at `(50,47)` from base `(50,50)`;
  count 1, next head type 43, ready 1.

Spawn `0x41b750` and FIFO memory copy `0x43afde` are explicit stubs in these
fixtures. The native code chooses arguments and executes count/readiness writes;
this does **not** prove actual spawn allocation or occupancy installation.

Follow-up evidence in `tools/qa/campaign-production.test.ts` now executes
`0x41b750 -> 0x41af14` separately with parsed source stats and real FIN bindings,
with zero runtime interceptions. Both exit sentinels `1023` and `1022` at
`(50,47)` produce slot 152/team 1/type 0 at that exact tile. Constructor
`0x41b444` clears the cell's low occupancy bits; `0x41b45c` writes 152. The
registry becomes 152 and high-water becomes 153. This proves direct replacement
of the reserved exit, not reinforcement-style neighbor searching. Reservation
ownership and allocation-failure rollback in the TypeScript bridge are explicit
adapter safety rules; this probe does not establish native failure recovery.

Disassembly-only boundaries in the same service, not claimed as tested:

- The ready branch requires a queued item, a clear exit-cell sentinel `0x3ff`,
  and an expired producer delay byte. The delay decrements at `0x4143ed`.
- With an animation bank, it reserves the air/ground exit as `0x3fe`, marks
  producer ready 0, and starts the troop's animation bank on producer `+0x24`
  in mode 1 (`0x414700..0x414719`). Without a bank, it takes direct spawn.
- Population count `0x41a538` versus `game+0x528` can reject the head, refund
  its cost, decrement the cost accumulator, dequeue it, and set message `0x77`.
- Building-removal code `0x445529..0x445551` clears its queue length and delay
  and resets ready. This does not establish an in-flight destruction refund.

The 800-byte queue stride is storage layout, not permission to enqueue arbitrary
counts. The observed 50 limit below is a UI pending-count limit, not a proven
authoritative total-FIFO capacity. Overflow, blocked exits, allocation failure,
destruction, and active cancellation still need executable boundary tests.

## Costs And Eligibility

All 80 source records were parsed by native `0x4379f3..0x437ba4`, then their
costs returned by `0x438074` were asserted against DEPEND. Examples: dependency
9/type 0 costs 350; 7/type 6 costs 1500; 29/type 43 costs 450; 83/type 49 costs
900; science-lab dependency 2 costs 2000. JSON reports every row.

Native eligibility `0x437bc4` scans active IDs 0..109. States mean:

- `0`: building/upgrade condition currently satisfied, not an available action.
- `1`: action eligible under the dependency/state checks.
- `2`: blocked.

Prerequisites require their state 0; a building prerequisite additionally must
have busy byte 0. The target building's busy byte and per-team scenario
restriction also block availability. These are live conditions, not an
ever-completed set. Eligibility does not perform the credit reservation.

Executed results for dependencies `(0,7,9)`, with other buildings absent:

| Exo HP | Exo busy | Restrict dependency 7 | States `(0,7,9)` |
| --- | --- | --- | --- |
| 0 | 0 | 0 | `(1,2,2)` |
| 4800 | 0 | 0 | `(0,1,2)` |
| 4800 | 1 | 0 | `(0,2,2)` |
| 4800 | 0 | 1 | `(0,2,2)` |

Building checks also compare slot level and race; upgrade checks compare
per-team weapon/armor bytes. This audit does not extrapolate those four
fixtures into exhaustive race, upgrade, restriction, or graph-order coverage.

### UI Reservation And Dispatch

Native UI handler `0x433124` consumes event 4 to increment pending count and
event 5 to decrement it. Interface lookup `0x43812c` requires an active DEPEND
record already in state 1. Native UI event/read/write helpers are stubbed, but
lookup, kind checks, cost arithmetic, limits, and branches execute unmodified.

| Action | Before `(pending, credits)` | After |
| --- | --- | --- |
| Add type-0 troop, cost 350 | `(0,349)` | `(0,349)` |
| Add type-0 troop | `(0,350)` | `(1,0)` |
| Add type-0 troop | `(49,350)` | `(50,0)` |
| Add at limit | `(50,350)` | `(50,350)` |
| Remove pending troop | `(1,0)` | `(0,350)` |
| Remove at zero | `(0,0)` | `(0,0)` |
| Add science lab, cost 2000 | `(0,2000)` | `(1,0)` |
| Add another pending science lab | `(1,2000)` | `(1,2000)` |
| Add another pending upgrade | `(1,1000)` | `(1,1000)` |

These are **pre-dispatch** refunds, not proof of canceling active construction.
The UI reservation and authoritative enqueue must not both subtract credits.

Dispatcher `0x437f3c` scans eligible DEPEND IDs, reads and clears pending counts,
then executes native packet constructors. Captured payloads begin at packet
byte 2; the preceding transport header was not interpreted:

| Kind | Constructor | Payload fields | Executed example |
| --- | --- | --- | --- |
| Building | `0x40c13c` | `9, slot, level, team, 0` | DEP 2: `[9,3,0,1,0]` |
| Unit | `0x40c168` | `10, unitType, team, count, 0` | DEP 9: `[10,0,1,3,0]` |
| Upgrade | `0x40c194` | `12, selector, unitType, level, team, 0` | DEP 30: `[12,0,8,1,1,0]` |

All three fixtures verified pending reset to zero. Packet sink `0x421648` was
stubbed. This proves construction of dispatch arguments, not transport delivery,
input polling cadence, multiplayer validation, or replay ordering.

### Command Handler Effects

Building receiver `0x41c8d4` uses slot/level, sets target HP and level, and invokes
colony initialization `0x444f14`. It does not run a cost-based timer. With source
type-20 maximum 2400, dependency 2 cost 2000, credits 777 and accumulator 100:

- HP 0 or 2399: HP becomes 2400, credits stay 777, accumulator becomes 2100,
  initializer and dependency refresh are called.
- HP 2400 at the same level: credits become 2777, accumulator stays 100,
  initializer is not called.

The initializer and refresh are stubbed only for these command probes. They
are separately investigated above and in the colony audit. The damaged-building
case is a raw receiver fixture, not proof the normal UI offers a repair action.
The receiver's HP helper is race-independent and its cost lookup passes race 0
(`0x41c95f`, `0x41c985`); preserve the observation instead of silently correcting
it. Alien receiver equivalence was not tested here.

Upgrade receiver `0x41ca04` writes weapon/armor level immediately in this
handler. Its accounting amount is `1000*requestedLevel`. Fixtures verified
weapon `0 -> 1` adds 1000 to the accumulator, armor `0 -> 2` adds 2000;
repeating the same requested level refunds 1000/2000 to available credits
instead. No timer exists on the executed upgrade receiver paths. A raw level-2
fixture bypasses eligibility deliberately; it does not authorize UI level skips.

## Integration Contract

1. Load DEPEND records with explicit IDs and retain SCN restriction bytes.
   Expose source queue/exit selectors and resolved native animation profiles;
   `buildTimeTicks: null` remains honest until source timing is established.
2. Own available credits, cost accumulator, pending UI reservations, four unit
   FIFOs, upgrade bytes, slot HP/level/busy, and construction latch **per team**.
   Keep native entity ID separate from simulation ID. Two same-race teams cannot
   share a resource account or producer state.
3. Compute native eligibility from current state. Present actions by
   `interfaceId`, dispatch by DEPEND kind/metadata, and preserve the distinction
   between pending UI count and committed FIFO. Handle each credit reservation
   exactly once; reconcile eligibility changes before dispatch without inventing
   an untested active-cancel refund policy.
4. Building commands update existing reserved slots, not arbitrary placement
   cells. Propagate HP and level to colony/trigger state, object type, collision,
   animation, and readiness. Occupied HP alone must not unlock dependent troops.
5. Advance the original construction phases and troop producer animation state
   on a verified clock. Unit completion must reserve/release the correct exit,
   allocate through the authoritative native-slot host, set ownership/stats, and
   dequeue once. Upgrade completion updates the team's weapon/armor state and
   invalidates eligibility/combat consumers.
6. Route actual campaign action controls through this owner and journal the
   commands/state transitions. Rendering, HUD counts, trigger `b`, combat,
   destruction, saves/replay, and AI must consume the same authoritative state.

Concrete current mismatches:

- [game-data.ts](../src/game-data.ts) does not expose a production catalog on
  `CampaignMissionData`; its `MissionScenario` team type omits dependency
  restrictions. Correct generated JSON alone is not an authoritative adapter.
- [mission-view.ts](../src/mission-view.ts) initializes generic simulation
  resources from team-0 money under a faction key. Colony objects are registered
  as static targets, not native production state machines.
- [simulation.ts](../src/engine/simulation.ts) accepts caller-supplied cost,
  duration, health, and target cell for `build`, charges faction resources, and
  allocates a new building after a generic countdown. This is not the native
  slot/animation/FIFO transaction described here.
- [campaign-session.ts](../src/engine/campaign-session.ts) has clock, update,
  and reservation inputs but no production command/state contract. The separate
  campaign-world `exomoney` value has not been proven to share the native credit
  account or harvesting semantics.
- [main.ts](../src/main.ts) has movement/combat action controls, but no campaign
  DEPEND action panel, production counts, building/upgrade selection dispatch,
  or queued-production status flow.

## Acceptance Gates

| Gate | Evidence now | Still required |
| --- | --- | --- |
| Source costs and metadata | 80 native costs, current generated data comparison pass | Broader phase-2 gates are outside this audit |
| Timer/completion model | Executed animation countdown into busy-clear branch | Real FIN profiles, auxiliary phases, update cadence/order, interruptions |
| Economy/queues | Tested pending spending/refunds, enqueue accounting, one dequeue | Harvest/deposit/exomoney, capacity/population/blocked-exit/destruction/refund boundaries |
| Native colony lifecycle | Initializer and phase/state evidence; slot/queue mapping | Authoritative slot mutation, navigation/occupancy, identity and trigger synchronization |
| Campaign UI dispatch | Three native payloads and nine reservation cases | Actual action UI wired through campaign owner, ownership/restriction validation |
| Campaign acceptance | No claim | Source mission workflow tests proving earned credits -> legal purchase -> completion -> usable entity/upgrade and correct mission effects |

Required next native probe: resolve a real building's construction FIN profile,
execute the auxiliary type-92/93 object transitions alongside the main building,
and drive the native update dispatcher until latch release. Compare source
delays and exact update counts, including the `3/4` initialization boundary.
Then test troop exit blockage/population limit and deletion while active. A
synthetic `buildTicks`, disabled button, helper-only test, or renamed phase gate
cannot replace those requirements.

## Probe Limits

Synthetic memory is intentional and reported. Stubs are: auxiliary pointer
lookup `0x411dd8`; dependency-refresh calls when not the eligibility fixture;
auxiliary construction dispatch `0x418504`; order reset `0x412014`; spawn
`0x41b750`; UI event/count helpers; packet sink `0x421648`; colony initializer
only in building-receiver fixtures; and FIFO copy `0x43afde`. The latter uses
segment-register reloads unsupported by this minimal emulator setup, so the
stub performs only the captured bounded copy. No actual Windows subsystem,
sprite rendering, map allocation, transport, or full game state was emulated.

Native animation initialization, animation countdown, completion branches,
eligibility fixture, source DEPEND parser/cost lookup, packet construction,
receiver arithmetic, queue count/readiness writes, and upgrade writes are not
replaced by stubs. That boundary is the extent of the tested claims.
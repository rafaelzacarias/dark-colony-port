# Native Harvester Movement And Host Wait

The short-route native movement prerequisite is implemented. This remains
**source-separated original-handler evidence**, not full mission admission or
public-command LIVE acceptance. Shared simulation, view, session, transport and
main were not edited in this increment. No browser, agents or full suite.

## Implemented

- [transport-host.ts](../src/engine/transport-host.ts) admits canonical `1,3`
  stacks and delegates mobile idle/wait to `reduceLegacyHarvesterIdle` after
  the FIN preamble. Positive wait decrements; zero pops without redispatch;
  HP mismatch wakes idle in the same visit. Source activation pushes task 12
  over the existing stack. Retraction still emits one release and does not
  redispatch idle on that visit.
- Idle admission requires explicit observer, special-order, confusion,
  secondary-animation guards, packed own-ground word and RNG index. No
  movement-finished boolean manufactures these fields. Unowned branches fail.
- An idle pending Stop `(pending,order)=(1,13)` resets the native idle stack,
  consumes the order to `(0,255)` and pushes wait in that visit. Movement Stop
  is **not** implemented by clearing a browser path or by this idle handler.
- [source-resource-options.ts](../src/engine/source-resource-options.ts) supplies
  the preserved `+0x9c` FUNK banks. Both EXPLFUNK and SLUGFUNK come from EXPL.FIN;
  SLUGFUNK is not in SLUG.FIN. All 32 delay timelines match original native banks.
- [campaign-session.ts](../src/engine/campaign-session.ts) and the resource
  ownership schema in [simulation.ts](../src/engine/simulation.ts) retain the
  wait stack and explicit guards through JSON checkpoints, including canonical
  top-payload aliases. Raw auxiliary guard corruption is rejected. The RNG
  byte is preserved, not reset; this slice consumes no RNG. This is not a new
  shared mission/combat RNG owner.

## Evidence

[harvester-host-native.test.ts](../tools/qa/harvester-host-native.test.ts) compares
all eight original handoff traces, every update from the completed arrival
frame through release: types 6/14, orders 2/7, both slot orders. It compares
position, health, type, direction, pending/order, full logical stack, FIN state,
source reserve and credits. JSON-roundtripped host state is used each update.
Credits start at **0**; source income becomes **44 human / 66 alien**, with no
funds grants. This host test starts at a supplied native arrival, not a live
browser command or simulation claim.

[harvester-wait-checkpoint.test.ts](../tools/qa/harvester-wait-checkpoint.test.ts)
checks session rollback after a later frame failure, bad guards/payloads,
wait-zero timing, restore, RNG 82 retention, and simulation claim/publication
of `1,3` and `1,3,12`. Its ownership fixtures are explicitly synthetic. They
use source defense fields but do **not** certify native harvester combat.
Session and simulation transactions are tested individually, not jointly.

## Implemented Native Movement Owner

[legacy-harvester-movement.ts](../src/engine/legacy-harvester-movement.ts)
implements a pure task owner for direct straight routes of one to three cells
in all eight directions. It takes the actual 220-byte native actor plus
`LegacyHarvesterIdleState`-compatible typed fields, canonical task spans, path
backing, a mapped packed ground census and the native RNG index.
Typed/raw aliases must agree. It never looks up recorded frames or snaps an
arrival. All changes are staged in copies; unsupported input returns a
diagnostic without changing the caller's actor, ground, path or RNG.

`sourceLegacyHarvesterMovementWorld` copies and freezes the route, PTH cell
families, plane mapping, source census, FIN delays and FIN bindings. PTH SHA-256
is provenance metadata, **not an admission gate**. Stand/FUNK timelines come
from `sourceResourceProfiles`; MOVE and the exported `finBindings` use native
32-direction fallback and duration arithmetic. Each binding contains source
file stem, state name and first/last timeline indices. Both SLUGFUNK and
EXPLFUNK come from EXPL.FIN. Bank IDs are explicit source bindings.

The proven input envelope is **source-separated legal constructors on the
original HUMAN02 assets**, not a full running original mission:

- Ground types 6/14, status 1, positive signed-word HP, mobile slots 152..799,
  team 0..7, selected weapon -1. Source speed is **40 Q8**, turn increment **10**
  for both types; different census values are rejected. Actual native auxiliary
  fields, inactive secondary animations, observer 255 and no special/confusion
  work are required. Native trajectory fixtures use team 0; other team-history
  bits follow the generic `0x412572..0x4125af` shift operation.
- Any mapped origin cell and byte direction 0..255, including direction zero
  and off-center Q8 positions. One to three adjacent cells, all following the
  same cardinal/diagonal vector. Native arithmetic must finish each leg inside
  its reserved cell. No origin/destination, slot or trajectory hash whitelist.
- Actual PTH families 1..254, supplied ground-cell mapping and a clear plane.
  Diagonal side cells must also be present and clear. The secondary word plane
  must be explicitly 1023 at required cells: trips/other work are not owned.
  Exactly one ground reservation belongs to the actor; other supplied cells
  are empty. Native team-history bits are preserved.
- Orders 2 and 7; exact reachable per-visit stacks, positions and reservations.
  Pending Stop 13 is retained through turn/step, including counter-zero pop,
  and accepted by the next accepting task. Wait pops before redispatching Stop.
- RNG is explicit and unchanged; randomized fixtures exercise other indices
  as well as 0/82. Synthetic counter overrides remain handler evidence, not
  admitted reachable states. Malformed spans, retargeting, auxiliary work,
  bends, longer routes, obstacles and trips fail before caller mutation.

Task 8 creates task 6 with `[count-1,count,x,y,mode,65535,65535,0]` and the packed
path at `actor+0x86`. The caller explicitly selects `external-direct-straight`:
the browser supplies route policy, **not native motion math**. The 16 backing
bytes are initialized from reverse-consumed route codes. Native codes 0..7
are NW,N,NE,W,E,SW,S,SE. The old two-cell east route still packs `0x44`.
Task 6 reads the indexed nibble, reserves the next ground slot, updates
the waypoint and decrements the index before pushing tasks 5 and 4. The five
ground writes are compared in order, including their widths and old/new values:
`0x415e30` clear destination low bits, `0x415e43` reserve slot, `0x41253b` clear
old slot, `0x412580` mark old team history, `0x4125af` mark new team history.

The existing native FIN step runs **before** task dispatch using the old
direction. Task 4 rotates by 10 with byte wrap and the native -128 tie branch;
on completion it pops and redispatches task 5 in the same visit. Same-bank/mode
resets preserve FIN frame/delay. Task 6 at index -1 pops without redispatch;
the following task-8/task-2-or-7 visit resets idle and pushes the native wait.

Native `0x4413a0` integer angle lookup and `0x441504` sine/cosine lookup feed
`0x412388`: Q11 projection is truncated, divided by the type speed, then the
Q11 velocity components are independently truncated. Source lookup constants
are compared with original memory, not generated using floating-point atan/sin.
This gives cardinal deltas 40 and diagonal components 28 at centered starts;
off-center starts can select intermediate angles and turn again on later legs.
The third centered cardinal leg has seven steps after two six-step legs.

Output includes every internal dispatch boundary and ground write, plus a
`native-harvester-idle` event at `after-mobile-entity-update` when the actual
idle owner is entered. The event carries the full native idle state, raw actor,
ground cell/word and whether its cell is the destination. Tests pass that state
through `legacyHarvesterIdleDiagnostic`; no generic idle or movement-finished
boolean supplies missing guards. A future live adapter must stage this event
with the source claim and ownership transaction; this change does not wire it.

### Original-Native Evidence

[harvester-movement-boundary-native.py](../tools/qa/harvester-movement-boundary-native.py)
runs 26 old bounded cases with zero runtime interceptions and zero runtime RNG writes:
eight unmodified arrivals (two types, orders 2/7, both slot orders), two types
with six packet-Stop timings each, plus three task-5 counter sensitivities per
type. Counter overrides are explicitly labelled synthetic handler input.
Each frame exports all 220 mobile bytes, target coordinates, actual stack
payload boundaries, all 16 path backing bytes and mapped ground words. Every
internal task entry/exit and ordered path/ground write is observed. Executable hash is
checked against `65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.

[legacy-harvester-movement.test.ts](../tools/qa/legacy-harvester-movement.test.ts)
preserves **22 focused tests**. The 20 non-synthetic cases chain reducer output,
JSON-roundtripped after each visit, applying only the real pending Stop packet
at its recorded time. Tests compare all 220 bytes, exact nonoverlapping logical
spans, path backing, ground, RNG, internal redispatch chronology and ordered
ground writes. All 32 source-derived FIN directions match native banks. Two
additional tests require the complete matrix, reject unverified input without
mutation, and check synthetic counter arithmetic. No frame replay feeds the
reducer; no agents, browser or full suite were used.

With `--generalized`, the probe runs **432 trajectories**: 288 direction/length
cases, 48 STOP boundaries (task-5 zero entry, next task-6 leg, task-8 acceptance),
32 seeded random slot/HP/RNG/off-center origins, and 64 arrivals at the four
actual HUMAN02 VENT coordinates `(88,72)`, `(11,68)`, `(69,48)`, `(53,27)`.
It also executes **4096 original turn sweeps**, all 256 initial directions
toward all eight headings for both types. These have no RNG writes.

The generalized probe explicitly injects only the external route result at
`before-first-task6`; this is recorded in `routePolicyWrites`. The initial
unmodified-pathfinder experiment returned a 32-zero-nibble path for nonhorizontal
destinations in this bounded fixture. It is **not** evidence of a working native
pathfinder. Native movement/turn/FIN/occupancy handlers are never replaced.
Fixture memory/context snapshots keep cases independent and inexpensive.

[legacy-harvester-movement-directions.test.ts](../tools/qa/legacy-harvester-movement-directions.test.ts)
passes **436 tests**, comparing every tick and dispatch, all raw bytes, exact
payloads, ground-write chronology, RNG, all 32 FIN descriptors/delay tables and
actual idle handoffs. Command admission is compared with native select/target/
order packets. Negative checks cover blockers/trips/auxiliary work/retarget and
unreachable payloads without mutation; re-admission retains the arrival offset.
Together with the old movement and four idle tests: **462 focused tests**.

## Scene Ownership API

All functions below are exported by
[legacy-harvester-movement.ts](../src/engine/legacy-harvester-movement.ts).

1. `sourceLegacyHarvesterMovementWorld({typeId,pth,fin,banks,width,height,route,plane,census})`
  builds immutable source context. Supply `route: {policy: "external-direct-straight",
  originQ8: [xQ8,yQ8], cells: [[nextX,nextY], ...]}`. `plane.cells` maps each
  `state.ground` entry to `y*width+x`; `plane.tripWords` uses the same order.
  Supply `{speedQ8:40,turnStep:10,ground:true}` from the verified type census.
  Omitted route/plane retains the old `(67,48)->(69,48)` compatibility fixture.
2. `decodeLegacyHarvesterMovement(raw220, slot, randomIndex, ground)` imports
  an actual native actor. Do not manufacture guards or a task stack from a
  generic movement-finished flag. Registry key/generation/session identity is
  the orchestrator's responsibility; the reducer validates slot/ground aliases.
3. `beginLegacyHarvesterMovement(state, world, 2 | 7)` admits an idle actor and
  stages the native selected flag, command target, pending order and `+0xc6`.
  It returns `{supported:true,state,randomAdvances:[]}` or a diagnostic.
  No tick, FIN advance, displacement or caller mutation occurs here.
4. `reduceLegacyHarvesterMovement(state, world)` owns **one native mobile
  update**, including its FIN preamble and all same-tick redispatch. Persist
  the returned raw/task/ground/RNG state together. `groundWrites` and `visits`
  are ordered staged effects, not callbacks. Do not also run browser movement.
5. `queueLegacyHarvesterMovementStop(state, world)` stages only `(1,13)`;
  subsequent reducer updates determine acceptance. It does not cancel a path,
  rotate, pop task 5 early, release the reservation, or snap position.
6. Consume `result.idleEvent` only at `after-mobile-entity-update`. Its `state`,
  `raw`, `groundCell`, `groundWord` and `arrived` are exact; the final state is
  canonical `1,3` with payloads `[65535,hp,0]` and `[7,hp]`. Use
  `legacyHarvesterIdleDiagnostic` to check the existing host idle contract.
  `arrived` compares both cell coordinates; a STOP event is not necessarily
  an arrival. RNG remains in `event.state.randomIndex`, with no draws.

Rendering uses `world.finBindings[state.animation.bank][(((direction+8)&255)>>4)*2]`
and the returned FIN frame/delay/mode. Position is Q8: divide by 256 for cells
or 8 for the 32-pixel scene geometry. Do not derive a fresh direction from the
browser route or reset the FIN bank each frame.

The public VENT adapter must stage command admission, movement ownership,
ground/actor publication and the eventual **native host claim** in the joint
scene/session transaction. The event supplies a real host-compatible idle
state, but does not itself activate a source or award credits. Source activation
still runs inside the original source-entity update, respecting slot order.
After resource release, retain native ownership until the release acknowledgement
commits; do not reapply fresh-constructor direction/animation requirements.

### Preserved Old-Route Evidence

The earlier handoff probe read six words for unspecified movement opcodes;
those were overlapping previews, **not exact task schemas**. Actual spans are:

| Task | Payload in this bounded order-2 corridor |
| --- | --- |
| 2 | zero words |
| 8 | `[1,0]` |
| 6 | `[pathIndex,2,nextX,nextY,0,65535,65535,0]` (8 words) |
| 5 | `[40,0,remaining,oldX,oldY]` (5 words) |
| 4 | `[0]` |

Task 5 tests `words[2]` **on entry**. A positive value adds `(40,0)` Q8 and
decrements the counter; reaching zero does not pop until the next visit.
Zero on entry pops without displacement or redispatch. Six increments per
segment, twice, yield `17280 + 2*6*40 = 17760`, not the requested `17792`.
Y remains 12416. The type-6 constructor turns 160 toward 0 by +10 (wrapping);
type 14 turns 128 toward 0 by -10. Turn finishes at updates 10/13; completed
idle events occur at 25/28. These are observations for this route/start only.

The 32-pixel geometry uses 8 Q8 units per pixel: the requested displacement is
64 pixels, but the native two six-step segments advance 60. The second segment
starts 16 Q8 short and computes `trunc(272/40)=6`, retaining 32 Q8 shortfall.
The synthetic counter-6 override after the first step instead reaches 17560,
**24 Q8 beyond** the first center 17536; counter-zero entry leaves that overshoot
unchanged. Both shortfall and overshoot are retained, not corrected to a center.

The real Stop packet preserves `(pending,order)=(1,13)` through task 4 and
task 5, including the visit popping a zero counter. The next accepting owner
consumes it. For example, human Stop after update 10 keeps moving to 17520,
pops task 5 at 16, and becomes idle/wait at 17. Stop after update 22 does not
pop task 5 early or teleport to the target center. Idle Stop is consumed in
one visit and the host matches its stack and animation bytes.

## Remaining LIVE Gate

The source-native short-route owner and scene entry points are ready for the
orchestrator join. Shared simulation/session/view/transport/main were deliberately
not changed. The adapter must replace generic browser movement while it owns
the actor, then commit the VENT claim and release acknowledgement with the
staged scene/session checkpoints. A stateful callback or omitted RNG cannot
stand in for that transaction. Bent/long routes, replanning, trips, combat,
moving retarget and full original mission admission remain outside this envelope.

The existing combat matrix excludes 6/14/47/48. Own sourceDefense class/armor
fields and the generic native calculation need a focused original-native
verification before admitting these targets; no flat-damage fallback was
introduced. Harvest UI remains disabled. Thus public command -> claim ->
credit -> retraction -> browser control is **still blocked**, not accepted.

## Focused Reproduction

```sh
export PYTHONDONTWRITEBYTECODE=1
export PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918
python3 tools/qa/harvester-movement-boundary-native.py > /tmp/harvester-boundary.json
python3 tools/qa/harvester-movement-boundary-native.py --generalized > /tmp/harvester-directions.json
DC_HARVESTER_DIRECTIONS_TRACE=/tmp/harvester-directions.json \
  node --import tsx --test tools/qa/legacy-harvester-movement-directions.test.ts
DC_HARVESTER_BOUNDARY_TRACE=/tmp/harvester-boundary.json \
  node --import tsx --test tools/qa/legacy-harvester-movement.test.ts
node --import tsx --test tools/qa/harvester-host-native.test.ts
node --import tsx --test tools/qa/harvester-wait-checkpoint.test.ts
```

Without `DC_HARVESTER_HANDOFF_TRACE`, the host test regenerates the original
eight-case handoff probe. Without `DC_HARVESTER_BOUNDARY_TRACE`, it regenerates
the old sensitivity probe. Without `DC_HARVESTER_DIRECTIONS_TRACE`, the direction
test regenerates the generalized probe. Missing native dependencies are not skipped.
Strict movement/idle slice typechecking also passes; standalone `tsc --noEmit`
needs `--allowImportingTsExtensions` for the existing idle test's `.ts` import.
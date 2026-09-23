# Native AI Actor Receipt to Task

Date: 2026-09-19. Status: source-separated bounded full registered movement and
ordinary attack visits with caller-owned native projectile allocation. Original
mission admission remains blocked by joint combat/session integration.

The [native fire owner](native-fire-owner.md) supersedes the pre-launch-only
boundary below when both `world.nativeFire` and `frame.projectiles` are supplied.
Without those inputs, the earlier non-committable handoff contract is unchanged.

The [nonlethal damaged actor owner](native-damaged-actor.md) now consumes ordinary
type0/8 projectile feedback on registered visits with original reaction-bank,
RNG and task semantics. It requires explicit source hit-animation timelines;
lethal/death paths and host/session/source-provider admission remain unchanged.

## Owned Files

- [Reducer](../src/engine/legacy-ai-task.ts)
- [Native oracle](../tools/qa/nativeactor-task-native.py)
- [Focused tests](../tools/qa/legacy-ai-task.test.ts)
- [Full-visit tests](../tools/qa/legacy-ai-task-movement.test.ts)
- [Source acquisition](../src/engine/legacy-source-combat-acquisition.ts)
- [Acquisition tests](../tools/qa/legacy-source-combat-acquisition.test.ts)
- [Pure native fire owner](../src/engine/legacy-native-fire.ts)
- [Native fire evidence and contract](native-fire-owner.md)

The isolated reducer work did not change shared code. The host follow-up below
changes transport/session ownership only; view, main, rendering and campaign AI
remain untouched.

## Native Setup and Evidence

Each case creates a separate Unicorn VM. It uses the existing original fresh-game
initializer, full `0x41b920` SCN scanner, `0x442b7c` PTH loader, source GAMESTAT,
FIN bank binding, relation allocations and campaign configuration. New actors use
`0x41b750` only after this initialization. The former shared minimal constructor
fixture is removed. No task or pathfinder handler is replaced in the oracle.

The probe runs `0x41defc`, then actual registered `0x419248` visits. It observes
`0x412014` entry/return and task8 `0x416104` entry/return inside those visits;
it does not replace registered dispatch with a direct initializer call. It records
all 220 actor bytes, exact stack payload spans, RNG cursor, current occupancy,
source PTH families/hash, native type records and all32 directions of observed FIN
banks. Native FIN timeline records have stride72; tests compare their delays to
source metadata for the stand/move banks.

58 cases / 61 passing tests:

- Types0,8,69,73,2,3, native orders2 (Move) and7 (Attack), with mode5 + mode7.
- Waypoint counts0,1,2,8 and fixed host counters1,9,32; later native task8 cursors1,2,3.
- Source-only mode7 control, both horizontal directions, source-family crossings,
  real ALIEN actors, and poisoned unused task/path storage.
- 55 supported initializer comparisons and47 supported task8 comparisons are
  exact across all220 actor bytes and stack spans. Thirteen task8 calls are
  intentionally rejected by the source-family/occupancy envelope, not counted as
  equivalent supported handlers. Two stationary actor initializers are rejected.

Identity matters: in full fresh ALIEN02, slots160/161 are type86/team1, not mobile
types2/3. They are rejection controls. Actual type2/team2 actors170/181 are also
captured without changing their types or positions. Type3 is constructor-backed
with original BARR GAMESTAT/FIN. Slot numbers from another placement/policy fixture
must not be silently transferred into this full-SCN world.

Complete evidence: `/tmp/dc-nativeactor-complete-20260919-r20.jsonl`.
Tests: `/tmp/dc-nativeactor-final-tests-r20.log`.
Strict slice typecheck: `/tmp/dc-nativeactor-types-r21.log`.
Evidence includes binary/source hashes. These temporary captures are reproducible
with the checked-in probe; they are never runtime reducer lookup data.

## API and Admission

`reduceLegacyAiTask(frame)` is pure and returns either a diagnostic or a new
220-byte actor, decoded stack, completed handler, redispatch flag and next owner.
`decodeLegacyAiTaskStack(raw)` checks exact payload spans, not overlapping previews.

The frame supplies the actual host slot, actor bytes, explicit handler-entry
boundary and source world: dimensions, full PTH family plane, current ground
occupancy, PTH hash and matching native type record/typeId. The caller authenticates
this source configuration; the reducer checks hash shape, not source provenance.
No destination-to-answer map, captured route output, or precomputed path is an
input. Rejects do not change actor or world inputs.

At `initializer-entry`, pending must be1 and order must be2 or7. The supported
ground-mobile envelope requires positive source speed. The native reset preserves
unwritten bytes, clears pending and builds `[2,8]` or `[7,8]`, with task8 words
`[0,0]` or `[0,1]`, then writes order255. This is real task initialization, not a
pending-bit-only acknowledgement.

At `task-handler-entry`, only canonical `[2|7,8]` is owned. Exhausted waypoints
clear count and pop task8. A remaining waypoint is supported only when the actual
origin belongs to this slot and its horizontal route is1..3 cells, all empty and
in the same nonzero source PTH family. The reducer increments the current waypoint,
normalizes the destination to its cell center, packs native direction nibbles and
pushes task6 with eight words. It preserves unused path nibbles/bytes and task6's
unwritten final word. These details are verified with later waypoints and poisoned
storage, not only constructor-zeroed inputs.

These two handlers do not advance FIN or RNG and do not write ground occupancy.
Their incoming animation bytes already include any registered-dispatch preamble.
The oracle also records subsequent native registered visits, but the reducer does
not claim to reproduce those entire visits or the native solver's mutable caches.

## Full Registered Movement Visits

`reduceLegacyAiRegisteredVisit(frame)` now owns an entire `0x419248` update within
the envelope below. The older `reduceLegacyAiTask` handler API remains unchanged:
its `registeredVisitComplete` is still false, and its task6 handoff still rejects.
Do not confuse an exact handler projection with the new complete-visit result.

The complete frame supplies raw220, slot, source world, host counter, RNG cursor
and the actual global task6 budget at `0x478e00`. Its source world extends the
existing type/PTH/ground inputs with both full native word planes (`air` at map
`+0xc04`, `extra` at `+0x1004`), the team's visibility mask (`+0x19c0`) and control
word (`+0xbbc`), source weapon records, all256 RNG values, and native FIN bank
bindings with all32 direction timelines. These are actual source/runtime inputs,
not flags asserting that combat, auxiliary work or RNG can be skipped. The caller
must authenticate the source configuration; a hash-shaped string alone is not proof.

Owned types are ground-mobile0,8,69,73,2,3. Speed comes from GAMESTAT `+12`, turn
limit from `+8`, health from the constructor, and heading is retained exactly.
The captured speeds are25,30,47 and15; type3 has400 HP and turn limit5. There is
no fixed40 speed or fixed160/128 constructor heading. Horizontal step projection
uses the exact axis reduction of the native integer arithmetic; turn wrapping
reuses the existing movement arithmetic. No arrival snap is performed.

The source-family task8 route is still restricted to clear horizontal1..3-cell
segments. The full owner executes scheduler FIN/energy preamble, initialization,
task8, task6 reserve, task4 turn, task5 displacement/pop, task6 completion and base
return to idle in original redispatch order. Reservation checks the old cell's
low10 owner against this slot and requires the destination's low10 to be1023.
It preserves unused path nibbles, payload storage, old auxiliary bytes and native
ground high bits. It publishes ordered ground writes, the new ground plane, full
raw220, exact stack, RNG writes/cursor and task6 budget together, or only a rejection.

Inactive secondary animations and explicit auxiliary-byte guards are required.
The task6 budget must enter in0..9; no implicit reset is fabricated. Destination
trip work rejects. Move's task6 guard0 skips acquisition; Attack's guard1 performs
the source weapon-range guard. Without `world.combat`, visible candidates remain
conservatively rejected. With the explicit source tables below, nonhostile and
ineligible candidates no longer block movement. Hostile acquisition exposes an
exact, non-committable continuation. Idle reproduces its two source scans and
no-target RNG. Projectile launch and special abilities remain outside this owner.

### Pending Receipt Hook

`stageLegacyAiTaskPendingVisit(frame, pending)` is the direct, pure session-facing
hook. `pending` binds slot, team, exact current raw220 and `pendingNativeTask`.
Mismatched ownership, stale bytes, or a tracked receipt without the native pending
bit reject. Only a successful whole visit returns a `pendingHandoff` allowing that
bit to clear. Commit its raw/ground/RNG/budget and pending handoff atomically;
never clear a receipt from the old handler-only API.

Queued Stop arrives through original mode5 for the actual entity slot. Task4/5
finish while preserving pending; the accepting task6 boundary consumes it. Types
0,8,2,3 return to idle exactly. Types69/73 with source special capability and energy
at least32 enter native task13 instead: the reducer rejects that entire accepting
visit with `native-special-stop-owner-required`. The previous committed state still
has Stop pending. Task13 can invoke a special ability and is deliberately not
treated as ordinary Stop/idle, even when the captured animation ends quickly.

### Full-Visit Evidence

84 additional fresh isolated VMs, without task/path substitutions:

- Both Move2 and Attack7, all six types, left/right, source-valid1/2/3-cell routes.
- Midturn and midstep original Stop receipts, including eight closed special-Stop cases.
- Six nearby-enemy Move controls match two whole visits each. Six paired Attack
  controls enter original `0x435c14` then `0x41481c` and reject before any candidate
  mutation is published. Visibility history is produced by an original scout
  receipt/move; the enemy is placed by the original constructor, not a fake root flag.
- 1,650 matched complete visits,570 exact ordered ground writes,64 RNG advances,
  and64 trajectories reaching idle. All220 actor bytes include FIN after every
  visit. The source-metadata tests verify all32 stand/move timelines, not just
  the initial direction. Constructor type/health and actual heading are retained.

Expanded matrix:172 passing tests. Original58-case handler regression:61 passing
tests. Strict scoped ES2022 typecheck passes. Evidence:
`/tmp/dc-ai-task-movement-20260919-g1.jsonl`,
`/tmp/dc-ai-task-final-tests-20260919-g1.log`,
`/tmp/dc-ai-task-original58-20260919-e1.log`,
`/tmp/dc-ai-task-types-20260919-g1.log`.

## Source Combat Acquisition

`LegacyAiRegisteredWorld.combat?: LegacySourceCombatTables` is the optional
factory-facing input. Existing profiles retain conservative behavior. No transport,
session, view, authentication pins or factory were changed by this acquisition work.
The oracle's `--combat-inputs --updates 0` exports refreshed tables without a
nearby-target fixture; Python callers can use `capture(..., combat_inputs=True,
updates=0)`. Pass its `world.combat` together with the matching existing world
inputs and current actor/plane snapshots, not constructor snapshots after movement.
The authentic factory owner must supply and authenticate:

- `typeTable`: all110 source records,280 bytes each, from `0x4f1880`. The moving
  actor's record must exactly equal the existing `world.typeBytes`.
- `relations`:100 runtime bytes, row stride10, at GAME`+0x46f34`. Nonzero means
  allied; type/race similarity does not determine friendship.
- `actors`: current raw220 records keyed by actual occupancy slot. Missing visible
  candidates reject, including a candidate that might prove friendly.
- `cityFlags`:120 bytes, flattened from each team's15 bytes at GAME`+0xc10`.
- `damageTable`: signed16 weapon-class/armor-class rows through `0x4f98d0`.
- `scanOffsets`: signed16 `(x,y)` pairs from `0x434090`, including native `x=99`
  ring sentinels through the supported radius. These are source inputs, not
  selected targets, cached paths or precomputed acquisition answers.

The existing ground/air/extra planes, weapon bytes and `enemyMask` are also used.
Despite its historical API name, `enemyMask` is visibility/history, not a relation
test. Refresh relations and visibility through original world services; SCN alliance
objects alone are insufficient. The new oracle executes `0x41989e..0x419990` after
full fresh SCN/PTH initialization. Without it, the runtime matrix has zero same-team
entries and creates false enemy fixtures. HUMAN02 teams0/1/4 are allied; team2 is
a genuine hostile control.
The older84-case movement corpus predates this refresh. Its nearby-candidate
cases remain byte/rejection regressions, not proof of initialized alliance semantics.

`acquireLegacySourceCombatTarget` implements `0x435c14 -> 0x435570`: source
team-selected weapon, sentinel-ring offsets, ground then air then extra at each
visible cell, reveal class `type+0x68` and candidate`+0xca`, excluded type byte,
city gate, neutral/self exclusion, relation unless actor`+0xd0` is nonzero, and
weapon-class/armor-class compatibility. Candidate status0/10 hits a native assertion
and is not silently discarded. Strict greater-than score replacement preserves tie
order. Splash scoring preserves the original target-based relation lookup inside
its X-outer/Y-inner occupied-neighbor loop; non-splash scoring preserves the unusual
signed health arithmetic. Neither is replaced by nearest-target selection. Native
radius4 accepts `(3,3)`; Manhattan and Euclidean substitutions are wrong. Scans
consume no RNG and write no actor, including the explicit aggro-input control.

Attack7's task6 guard1 calls `0x41481c` when it finds a target, not a task9
constructor. Idle first stores its selected target in the task payload and clears
its wait counter. On a miss, it switches to stand, updates cached HP, and scans
radius16 for controlled teams or9/4 for damaged/undamaged ground actors. A broader
target writes destination coordinates and hands off at `0x414ce4` with mode2.
That routine pushes task6, not task9. Direct order/task9 execution remains unowned;
no fabricated task9 is inserted for Attack7.

`stageLegacySourceCombatFire` owns only the `0x41481c -> 0x412d00` prelude:
actor`+0x10 = (targetTeam << 5) | sourceType[0x64]`, integer source-table direction,
and native turn stepping. It stops at `0x412e13` before firing RNG when aligned,
or `0x4131ae` when still turning. It launches no projectile and writes no target.
Source flags31 and15 are retained; they are not a constant hostile flag.

`stageLegacyAiTaskPendingVisit` returns `supported:false` plus `combatHandoff`
for hostile continuations. It contains `registeredVisitComplete:false`, `expectedRaw`,
fire/path `entryRaw`, exact staged `raw`/stack, target slot/raw, ground and ordered
writes, RNG cursor/advances and task6 budget. `nextOwner` is
`native-projectile-launch-owner`, `native-registered-return-owner`, or
`native-acquisition-path-owner`. There is deliberately no `pendingHandoff`.
Do not commit this prefix or clear a pending receipt from it. Complete the named
continuation and registered remainder in the same candidate transaction first.

The launch owner still needs source fire FIN events/muzzle offsets, variant/spread
inputs, projectile allocation/state, source RNG sequencing, cooldown/task11 and
registered-return behavior. The path owner needs general pursuit paths. Aggro
selection is proven in isolation; registered actors with active auxiliary `+0xd0`
remain outside the existing auxiliary-state envelope.

### Acquisition Evidence

The new `--acquisition-suite` runs76 fresh full-SCN/PTH/FIN VMs with original
constructors, scout receipts and task handlers. It covers all six moving types;
same-team, allied and hostile same/cross-faction targets; actual air types5/13;
reveal classes45/46 and both reveal-mask outcomes; same-cell ground/air competition;
ordered multiple candidates; priority over proximity; and non-Manhattan range.
Explicit reveal-mask, aggro and one-HP retaliation inputs are labelled in
`controlledInputs`; they are not claimed as naturally occurring SCN state.

Goldens compare selected slots and ordered native candidates, full220 candidate
bytes before/after scans, complete nonhostile visits and ground writes, and full220
hostile prefixes. Two positively aligned firing cases continue natively beyond
our handoff: they consume2/3 RNG draws and push task11. The owned prefix consumes
zero. A damaged idle control positively enters radius9 pursuit; its undamaged
counterpart finds no target and consumes the normal idle RNG draw. Tests reject
missing candidate/type/relation/damage/scan inputs and mismatched type records
without modifying any supplied actor or world input.

Verification:77 acquisition tests,85 existing full-visit movement tests and61
original handler tests pass (223 total). Strict scoped ES2022 typechecking and
the input-only factory export check pass. No browser, agents or full suite ran.
Final native evidence: `/tmp/dc-acquire-final-37.jsonl` (76 cases, assembled from
unchanged base cases plus refreshed boundary/priority captures). Results:
`/tmp/dc-acquire-final-tests-37.log`, `/tmp/dc-acquire-movement-regression-37.log`,
`/tmp/dc-acquire-handler-regression-38.log`, `/tmp/dc-acquire-types-final-38.log`,
`/tmp/dc-acquire-factory-check-39.log`. No trace is runtime reducer lookup data.

Reproduce with `DC_SOURCE_COMBAT_TRACE=<jsonl>` and
`node --import tsx --test tools/qa/legacy-source-combat-acquisition.test.ts`;
without the variable the test regenerates the native suite. Native dependencies
use the same `PYTHONPATH` as the existing actor oracle.

## Remaining Admission Boundary

Mode5 marks pending/order. Mode7 alone stores waypoints/count and does **not** mark
pending. A received packet is not permission to call the initializer immediately:
the host must reach an accepting native task boundary in registered order. The
API's boundary describes that event; it is not scheduler authorization.

The full-visit API returns `registeredVisitComplete: true` only for an owned
entire visit, with its source envelope and entity-bound pending handoff. Ordinary
rejections expose no staged result; combat handoffs expose only a non-committable
prefix as described above. This closes the isolated horizontal
movement gate; the bounded host/session transaction is described below. General,
obstructed, cross-family, vertical/diagonal and longer routes, projectile/combat execution,
special Stop/task13, active auxiliary work and task-budget overflow remain closed.
Original all-actor scheduling and shared policy/task RNG ownership remain closed.

## Host Follow-Up

Public contracts live in [transport-host](../src/engine/transport-host.ts) and
[campaign-session](../src/engine/campaign-session.ts). Focused integration tests
are in [native-ai-task-host.test.ts](../tools/qa/native-ai-task-host.test.ts).

`CampaignSessionOptions.nativeAiTasks` is an explicit
`NativeAiTaskConfiguration`, authenticated before session construction with
`await authenticateNativeAiTaskConfiguration(configuration)`. It contains:

- `scope: "source-separated-bounded"` and `sourceId: "nativeactor-v1:<digest>"`.
- Complete `profiles`: PTH families/hash, native type and weapon records, all32
  stand/move FIN timelines, RNG table, ground/air/extra words and team guards.
- `bindings`: exact `slot`, `generation`, `key`, profile index, native constructor
  `raw` (220 bytes), and current host `expectedRaw` (220 bytes).
- Native capture `counter`, `rngCursor`, and `task6Budget`.

Authentication uses Web Crypto SHA-256 against 24 checked-in input digests from
the 84-case original movement corpus, not a caller's `validated` flag or a
hash-shaped source label. The canonical JSON contains `profiles`, bindings
projected to `{slot, profile, raw}`, and the three native counters, with object
keys sorted recursively. Host identity and expected raw are checked separately
against the actual world. The test fixture demonstrates this construction.
Only constructor/source inputs are pinned; no route answers or visit outputs
are runtime data. After a process restart, authenticate the external source
configuration again before restore.

The current pins are deliberately narrow: HUMAN02 plus the actual native
constructor-added slot170. They are not general SCN actor profiles. The session
test creates the same extra actor through source placement where that preserves
native type/team identity. HUMAN02's team1 SCN loader race-remaps types8/73;
those session configurations reject, while the actual host allocation API
provides exact type8/73 constructor identities for the host tests. No source
actor's type, team, HP, coordinates, status, or script order is rewritten to
make a fixture match.

The session constructor performs the fresh-world handshake. The corresponding
host APIs are `initializeTransportHostNativeAiTasks` (install pinned constructor
fields) and `configureTransportHostNativeAiTasks` (require already exact raw).
Installation accepts only the canonical generic initial record or the exact
native constructor, with exact expected bytes and protected pose/HP/status.
It fills all native task/FIN fields; it cannot replace an active or merely
caller-declared initial task. Allocated host records now publish their real HP.
Generic campaign-AI initial records are not silently accepted as native owners.

Each session step requires `nativeAiFrame: {counter, task6Budget}` from the
actual scheduling caller. The owner retains RNG cursor; neither task budget
nor native counter is guessed from milliseconds. Host callers pass this frame
as the third `stepTransportHost` argument; `advanceTransportHost` takes one
frame per fixed update as its fourth argument. Unsupported work, missing frames
and late failures leave elapsed time and the entire input world unchanged.

`nativeAiReceipt` is a journaled receiver input, separate from policy/order
generation: `{id, packets, expected}`. Packets use the native unsequenced total
length header and mode5/mode7 payload. Expected entries bind each configured
owner's slot/generation/key and current raw220. It does not invent a policy
decision or generate a movement packet. Existing `receiveTransportHostAiPolicy`
can likewise deliver packets to configured host actors. Mode7 alone does not
set a configured actor's native pending bit; a zero-recipient packet does not
claim an actor. Unconfigured actors retain the existing conservative handoff
barrier, including route-only receipts, until an actual owner is supplied.

Before any dispatch, all pending actors must have owners. Each registered
visit stages the complete reducer result, including FIN, ordered ground effects,
full raw, RNG and task budget. Clearing the pending bit does not release the
task owner: it remains through movement, return to idle and later idle visits.
Special Stop/task13 and enemy acquisition reject the whole accepting visit.
Conflicting external position/type/HP edits reject rather than overwriting raw.
Static source occupancy omitted by the mobile host plane is accepted only when
backed by actual stationary source actors. Low-slot raw bytes stay untouched.
Real production reservations are projected as native1022 without clearing
resource flags or reservation ownership.

Strict JSON snapshots include the complete owner, raw state and all native
caller inputs. Restore uses
`CampaignSession.restore(checkpoint, expectedCampaignAi, expectedNativeAiTasks)`;
the third argument must be the exact independently authenticated configuration.
Restore validates plane/identity relationships and replays the complete caller
history, including pending receipts. Coordinated raw/owner edits do not suffice.
Midturn and midstep restores each continue100 updates identically. Native-owner
sessions disallow unjournaled resource commands.

Readiness is **bounded registered host/session visits: ready** and
**readyOriginalCandidate: false**. Original missions still include unowned actor
cases, mode9, acquisition/combat, special abilities, arbitrary paths and shared
policy/task RNG. Combined full-policy/task sessions explicitly reject until that
shared scheduler is owned. This follow-up does not admit original AI or modify
mission view, main, rendering, campaign AI, or the pure task reducer.

Focused coverage includes all72 non-enemy movement/Stop cases (the eight native
special-Stop cases are expected rejections), source authentication, generic and
race-remapped constructor rejection, late rollback, elapsed-step rollback,
reservation/resource plane preservation and strict100-update restore.

Verification:77 focused integration tests passed;33 existing host/session tests
passed with one intentional skip; all four native full-policy receipt cases
(both races, deferred/synchronous) passed. Project typecheck and edited-file
diagnostics are clean. Final logs:
`/tmp/dc-native-host-final-20260919-01.log`,
`/tmp/dc-native-host-regression-20260919-01.log`,
`/tmp/dc-native-host-policy-receipts-20260919-01.log`, and
`/tmp/dc-native-host-types-final-20260919-01.log`.

### P1/P2 Runtime Boundary Follow-Up

Direct host visits now revalidate canonical configuration content against the
authenticated source map synchronously, including structured-cloned and JSON
restored configurations. Authentication is not cached by mutable object identity;
changing a profile RNG table or source binding cannot retain authorization.
Runtime profile identity and RNG cursor bounds are also checked. Elapsed-time
advancement validates these invariants before accumulating even a sub-tick.
No per-step asynchronous crypto or freezing of the original object is required.

Production allocation while `nativeAiTasks` is present rejects with
`native-ai-occupancy-owner-required` before clearing a reservation or allocating
an actor. The common allocator also rejects direct/FIFO spawning. New transport
commands, carrier dispatch, and external actor position/death/removal updates
reject with the same boundary. These paths cannot publish unknown actors or
stale native occupancy. FIFO entries, reservation ownership, entity bytes and
allocator state remain unchanged on rejection. Legacy hosts without a native
owner retain their existing allocation and reinforcement behavior.

Ground production reservations remain supported and project to native1022 on
the next visit. Flying reservations reject because the authenticated source air
plane has no mutable reservation owner. Supporting production, reinforcements or
external occupancy changes alongside native tasks requires a future joint owner;
this follow-up deliberately does not claim that combination is implemented.

`advanceTransportHost` requires native frames to be absent without a native
owner, including an empty array. With an owner, the array must contain exactly
`floor((remainderMilliseconds + milliseconds) / fixedStepMilliseconds)` frames:
zero updates require `[]`, and extra frames cannot be silently dropped. This
preflight is independent of loop execution. Resource-frame semantics are unchanged.
Failures preserve elapsed time, tick, raw state, reservations and RNG atomically.

Focused regressions cover cloned RNG/profile-index/cursor tampering through
direct step and zero/sub-tick/full-tick advance, reserved vacant cell31 allocation,
reinforcement/FIFO rejection, external updates, flying reservations, legacy direct
reinforcement, and exact frame counts across accumulated zero/one/multiple updates.
Existing native movement and strict authenticated checkpoint replay remain the
compatibility checks; no session, view, campaign AI or rendering changes are needed.

Verification:92 focused tests passed (80 native host tests plus12 legacy host
tests), including both strict JSON restores and their100-update continuations.
Project typecheck, strict host/test slice typecheck and edited-file diagnostics
passed. The native fixture was reused from cache; no native regeneration, agents,
browser or full-suite run was used. Completed test log and exit-status receipt:
`/tmp/dc-native-owner-isolated-1789859686166.log` and
`/tmp/dc-native-owner-isolated-1789859686166.result.json` (status0).
Typecheck logs: `/tmp/dc-native-owner-project-types-20260919-161257.log` and
`/tmp/dc-native-owner-focused-types-20260919-161300.log`.

### Source Owner Review Guards

The source-attested `nativeactor-source-v2` factory now supports dynamic ground
allocation for types0/8/69/73/2/3; this supersedes the blanket allocation rejection
above only for that factory. Legacy pinned configurations retain their existing
allocation boundary, and worlds without native tasks retain legacy behavior.
Source-owned production reservations, direct allocation, coordinate FIFO insertion
and every nonempty reinforce2 group validate type/team/profile and ground-plane
support before position search, queue mutation, allocation or a successful receipt.
A mixed supported/unsupported batch rejects atomically, as does FIFO consumption
of an unsupported entry. Unsupported type1 reservations and type6 reinforcement
queues can no longer be accepted and become permanently unallocatable.

Both native task installation paths validate all800 current raw slots against
world entities and host identities before any constructor publication. Checks cover
pose/height, signed HP, type/team, native signed-byte status, registry/generation,
world tile coordinates, and neutral resource rate/countdown ownership, including
unowned actors and CITY prerequisites. Active raw slots without host/world identity
reject. The authenticated-config then unowned slot152 HP800->1 review case rejects
without rewriting any input. Unowned constructor records remain unchanged.

`receiveTransportHostAiPolicy` authenticates configuration and validates current
world alignment before inspecting candidate bytes or packets, including empty
receipts, and checks alignment again before return. Synchronous candidate pools
may contain the intended pending-order packet writes; authentication does not demand
that the candidate equal the pre-receipt pool. All work is staged on cloned state.
Direct elapsed-time authentication and exact frame-count checks remain intact.

Native CITY construction and native task scheduling remain an unsupported joint
owner: either installation direction rejects. The separate science mode9 CITY
integration is preserved, not disabled for worlds without native tasks.

Focused review cases live in
[source-native-task-boundary.test.ts](../tools/qa/source-native-task-boundary.test.ts)
and [native-ai-task-host.test.ts](../tools/qa/native-ai-task-host.test.ts).

**Separate unresolved source snapshot requirement:** alignment is consistency,
not provenance. A coherent post-configuration mutation of an unbound actor's raw,
entity and host fields can still pass these guards. Preventing that requires an
independently authenticated immutable expected-world snapshot/digest from the
source factory, checked at installation. This patch does not claim that protection
or change the factory's slot mapping. Runtime receipt candidates must remain free
to carry supported pending-order changes rather than equal a frozen initial pool.

Verification: six new source-boundary cases and28 focused existing/new host,
source-production and CITY cases passed (34 distinct tests). This includes both
science mode9 races, real resource/production coexistence and CITY checkpoint
replay. Strict edited host/test typechecking and editor diagnostics passed.
Evidence: `/tmp/dc-sourceowner-boundary-20260919-05.log`,
`/tmp/dc-sourceowner-regressions-20260919-03.log`, and
`/tmp/dc-sourceowner-types-20260919-02.log`. No agents, browser, full-suite run,
source-factory edit or slot-mapping change was performed by this follow-up.

## Reproduce

Run from the repository root, with the existing Unicorn/Capstone prerequisites:

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 python3 -B tools/qa/nativeactor-task-native.py --suite > /tmp/native-ai-task-new.jsonl
DC_NATIVE_ACTOR_TASK_TRACE=/tmp/native-ai-task-new.jsonl node --import tsx --test tools/qa/legacy-ai-task.test.ts
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 python3 -B tools/qa/nativeactor-task-native.py --movement-suite > /tmp/native-ai-movement-new.jsonl
DC_NATIVE_ACTOR_MOVEMENT_TRACE=/tmp/native-ai-movement-new.jsonl DC_NATIVE_ACTOR_TASK_TRACE=/tmp/native-ai-movement-new.jsonl node --import tsx --test tools/qa/legacy-ai-task-movement.test.ts tools/qa/legacy-ai-task.test.ts
DC_NATIVE_ACTOR_MOVEMENT_TRACE=/tmp/native-ai-movement-new.jsonl node --import tsx --test tools/qa/native-ai-task-host.test.ts
npm run typecheck
```

Without the trace environment variable, the focused tests regenerate the oracle.
`--start`/`--end` select matrix cases, each still using an isolated VM. Only complete
JSON records were retained from interrupted terminal batches. No agents, browser,
or repository-wide test suite were used.
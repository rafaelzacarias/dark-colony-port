# Inspire Troops: Native Evidence

Research date: 2026-09-19. Scope: the already identified MAINE widget 141 /
MAINBUT frame 121, traced beyond its label into executable dispatch and effects.
The component helper and task-completion API below are not wired to the live
runtime. No mission/main/simulation edits, browser, agents, or full test suite
were used.

**Status: uninterrupted native activation is now proved for source types 69/73,
including FIN animation, pending-order continuation, queued stop/redeploy,
death, recovery, and automatic slot reuse. A tested task-13 completion API is
available; the live star remains disabled/unwired in this work.** This is not
approval to replace the star with a guessed aura,
instantaneous damage buff, circular radius, or fixed-seconds cooldown.

Executable: [DC.EXE](../raw_cd/DC/DC.EXE), SHA-256
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
Type source: [GAMESTAT.TXT](../raw_cd/DC/GAMESTAT/GAMESTAT.TXT).
All addresses below are executable virtual addresses, not file offsets.
Entities have stride 220 at `game+0x7d28`; type records have stride 280 at
`0x4f1880`.

## Reproduce

From the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 \
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
python3 tools/research/inspire-audit-20260919.py
```

For just the six uninterrupted lifecycle cases and a machine-readable trace:

```sh
PYTHONDONTWRITEBYTECODE=1 \
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
python3 tools/research/inspire-audit-20260919.py --lifecycle-only --json \
  > /tmp/inspire-lifecycle-trace.json

node --import tsx --test tools/qa/legacy-inspire.test.ts tools/qa/legacy-inspire-lifecycle.test.ts
```

The [research probe](../tools/research/inspire-audit-20260919.py) imports
the existing hash-pinned PE loader. Component emulations have a one-million-
instruction limit; lifecycle calls use the construction probe's 200,000-
instruction limit. It passed the assertions on this executable. It does not boot the
game. Native `sscanf` hit a C-runtime stack access at `0x455710`; the working
fixture instead executes the native argument setup, asserts the `%s` plus 32
`%d` format, marshals ASCII values into those exact destinations, and executes
the native post-parse conversion. It does not claim to emulate `sscanf`.

Serializer enqueue, deploy animation/task-push/rejection, effect task-reset,
and task-to-effect boundaries remain intercepted in the older component probes.
Scan geometry, target predicates, RNG lookup, writes, charge predicates,
command selection, timer arithmetic, scatter, and damage arithmetic execute
the original instructions. These are separate component probes, not one
uninterrupted input-to-projectile execution. The new `lifecycle_case` uses a
single persistent native fixture and asserts **zero runtime intercepted calls**;
it does not replace deployment, animation, task push/reset, effect, or recovery.
Only setup string formatting/name lookup and FIN/type marshaling use the
[construction probe](../tools/research/construction-lifecycle-20260919.py).

## Activation Dispatch

| Native address | Evidence |
| --- | --- |
| `0x433124`, `0x433326` | Main-interface event reader; push-button event kind 1 enters command handling. |
| `0x436560`, `0x43659c` | Special-action widget table `[-1,138,139,140,141,142,142,37]`; index 4 is 141. Predicate accepts entries 1 through 7. |
| `0x43363c` | Accepted special-action widget calls `0x409418`. |
| `0x409418` | Unless `game+0x46f31` or `ui+0x13b` is nonzero, emits payload `[0x1a, playerTeam]` to `0x421770`. These gate fields are not semantically named by this audit. |
| `0x421770` | Appends command terminator 0, then calls transport enqueue `0x421648`. |
| `0x41defc`, table `0x4793e8` | Stream opcode 26 dispatches to `0x41cf8c`. |
| `0x41cf8c` | Scans all 800 slots. Requires `entity+0x12 & (1 << team)` and nonzero type dword `+0x104`; writes entity bytes `+0x36=1`, `+0x37=13`. |
| `0x4120b3`, table `0x4792ec` | Task reset/continuation consumes pending order 13 and calls `0x416784`. |
| `0x416784` | Validates deployment, starts type animation `+0x94`, then pushes task 13 with payload word 50 at `0x416943`. **50 is not an evidenced cooldown.** |
| table `0x479344`, `0x417b0c` | Task 13 waits for entity animation byte `+0x1a == 2`. |
| `0x417cbf` | Nonzero type dword `+0xfc` selects `0x417168`, passing caster position, full slot, and type `+0x100` budget. |

Command 26 is shared deployment, not an Inspire-only opcode. It does not carry
a target point, radius, or explicit unit list. The selected-unit mask controls
which units receive pending orders. The command handler itself does not test
status, ownership byte, or charge; do not mistake that for the full eligibility
contract. Selection construction and subsequent task processing matter.

## Eligibility and Tables

Native row destinations are constructed at `0x43bbc5`; `0x43bd11` converts
the source type `+0xfc` percentage using integer `(value << 8) / 100`.
The probe checked all 106 source rows. Exactly types 69 through 76 have
`type+0x104 & 0x3f == 4`:

| Type IDs | Capability | Recharge `+0xf8` | Damage Q8 `+0xfc` | Visit budget `+0x100` |
| --- | --- | ---: | ---: | ---: |
| 69, 73 | `0xc4` | 1 | 332 | 6 |
| 70, 74 | `0xc4` | 1 | 358 | 8 |
| 71, 75 | `0xc4` | 1 | 384 | 10 |
| 72, 76 | `0xc4` | 1 | 409 | 12 |

UI scan `0x436604` excludes status 0/10 and team 8, checks the map visibility
mask, and follows the nonzero entity `+0x13` branch for selection. The local
ownership predicate `0x41ae78` compares entity team `+7` with `game+0x7d1c`.
`0x416640` accepts these eight caster types directly, bypassing its separate
near-base restriction for other types.

At `0x436839`, capability `0xc4` offers index 4 only when entity charge byte
`+0x0a > 32`. Mixed available special-action indices become index 7 (generic
Deploy), not necessarily the star. Native deployment at `0x416841` instead
accepts `charge >= 32` for a type with nonzero `+0xfc`. The probe tested charge
0, 31, 32, 33, 254, and 255. This UI/executor discrepancy is real.

## Effect and Geometry

`0x417168` first calls task-reset/pending-order continuation `0x412014`.
Then `0x4171b7` clears caster charge to zero, even if no target qualifies.
Coordinates are converted to tiles by shifting eight bits.

The exact native scan order is:

```text
for ring = 0 through 10:
    for transverse = -20 through 20:
        visit(x-ring,       y+transverse)
        visit(x+ring,       y+transverse)
        visit(x+transverse, y-ring)
        visit(x+transverse, y+ring)
```

The four destinations are in the table at `0x417158`; loops are at
`0x4171c7`, `0x4171d9`, and `0x41737a`. There are 1,804 coordinate visits
without early termination. The union satisfies
`max(abs(dx),abs(dy)) <= 20 && min(abs(dx),abs(dy)) <= 10`, clipped to the map.
It is **not a circle, Manhattan-radius test, or nearest-unit sort**.

Each in-bounds visit reads the ground dword plane (`map+0x804` row pointers),
then the air word plane (`map+0xc04`). Both mask the slot with `0x3ff` and skip
sentinels 1022/1023. At `0x4172ae` through `0x4172ea`, a target must have:

- Exactly the caster's team byte, not merely an allied team.
- Zero type dword `+0xfc`, excluding the Inspire-capable caster types.
- Type dword `+0x18 != -1`, the parsed primary weapon field.

This routine performs no additional alive/status check; it trusts occupancy.
No self-exclusion comparison is needed for the observed casters because their
nonzero multiplier excludes them. Ground and air targets are both supported.

Each qualifying visit advances native RNG index `0x479204` modulo 256 and
reads table `0x478e04`. It writes:

- `target+0xd6 = 20 + (randomValue & 15)` at `0x417310`.
- `target+0xd8 = casterSlot` as a word at `0x417319`.

The budget decreases **per qualifying visit**, including repeated visits to
the same entity. A prior timer does not exclude a target; later visits replace
both timer and caster reference. The scan stops when the budget reaches zero.
Consequently, 6/8/10/12 is not a guaranteed distinct-unit count. The fixture
with one ground target at the center produced four writes. A synthetic target
occupying both planes exhausted budget 6 after 83 coordinate visits. That
fixture proves absence of deduplication, not that such dual occupancy occurs
in a normal mission.

## Combat Effect

At `0x412ef7`, a nonzero target timer bypasses random 3-by-3 scatter selection
and sets both indices to 1 (`0x412f64`), yielding zero added tile offset. This
establishes centered aim in that firing path, not an unconditional guarantee
that every projectile hits despite movement or other collision behavior.

At `0x4427f5`, a projectile's source entity with a nonzero timer supplies the
caster slot from `+0xd8`. The code reads the **current caster type** and its
`+0xfc` multiplier at `0x442836`; otherwise the multiplier remains 256.
It passes that factor to damage routine `0x441930`.

`0x4419e5` applies, in order, signed integer shifts by eight after multiplying
base damage by the matchup coefficient, then Inspire, then armor. With all
other factors neutral, base 100 becomes 129/139/150/159 for the four source
levels, not exactly 130/140/150/160. The multiplier is not snapshotted on the
target or projectile. No health increase, movement increase, or faster firing
is established by these field consumers.

## Recharge and Duration

`0x4192c0` checks `game+0x530 & 31 == 0`; on those entity updates it adds type
`+0xf8` to charge, saturating at 255. For these types that is +1. After a cast
sets charge to zero, the executor needs 32 qualifying recharge events; the UI
needs 33. Full recharge needs 255. There is no evidenced fixed cooldown field.

`0x4192f0` checks `game+0x530 & 15 == 0`; `0x419311` decrements a nonzero
Inspire timer. A freshly assigned timer therefore needs 20 through 35 qualifying
decrement events, unless another cast overwrites it. The timer reaching zero
disables the effect without clearing the caster-slot word in this block.

Crucially, `+0x530` is not monotonic: it increments at `0x4198b2` but resets
to zero at `0x4199af` when it exceeds `game+0x534`, toggling day/night. The
registered-entity loop at `0x419bb8` runs afterward and calls `0x419248`.
Zero satisfies both cadence masks, so phase-boundary updates matter. Entity
iteration order also matters when a recipient is stamped on a decrement tick.

The [clock audit](transport-decoding.md) establishes the initialized live
interval of 66 ms and its mutability. Without a day/night reset, 32 or 33
recharge events are roughly 1,024 or 1,056 simulation updates, with initial
phase dependence. Those products are not universal cooldown durations. Do not
hard-code seconds from them.

## Component Checks

Passing native probes cover these discriminating cases:

- Command 26 mutates only selected, capability-bearing slots' pending-order
  bytes; an ordinary selected trooper and unselected commander are untouched.
- Charge 31 rejects deployment; 32 schedules task 13 but fails UI visibility;
  33 passes both.
- Task 13 dispatches the effect only for animation state 2, with actual caster
  coordinates/slot and source budget. States 0, 1, and 3 do not dispatch it.
- `(20,10)` and `(10,20)` qualify; `(20,11)`, `(11,20)`, and `(21,0)` do not.
  Full empty/rejected scans match every one of the 1,804 ordered visits.
- Enemy-team, commander-type, and unarmed targets reject; armed ground and air
  targets accept; duplicate visits consume budget and refresh the timer.
- Counter 16 decrements duration but not charge; counter 32 does both; charge
  saturates and a zero timer does not underflow.
- Nonzero timer centers scatter and selects the current caster's Q8 multiplier;
  zero timer returns to the neutral factor.

## Uninterrupted Lifecycle Trace

`lifecycle_fixture()` loads actual TRSC/GRAY caster states and SCGM air-recipient
states from source FINs. The source names, hashes, ranges and native-converted
delays are included in JSON `profiles`; `trace` resolves the actual facing's
descriptor rather than labeling every direction with bank entry zero.
FIN children/rendering are not emulated. Native binder `0x43c099..0x43c0ea`
resolves deploy `+0x94`; **both types fall back to their stand bank**, whose 32
directional descriptors each contain one frame. Native `0x42630c` initializes
frame and delay to zero, and `0x4264c8` advances the frame immediately when
delay is zero. Consequently mode 1 becomes mode 2 on the next entity update,
without seeding or waiting the stand frame's source delay. This is measured
source behavior, not a chosen cast duration.

Native `0x41b750 -> 0x41af14` allocates casters/recipients, sets their original
task/animation state and registers real ground/air occupancy. The fixture checks
each spatial registration; it does not stamp entity IDs into the map. Initial
selection and charge 255 are explicit fixture inputs. All five units share
team 1 in a controlled mixed-type fixture (default race 0), with caster groups
at (32,32) and (80,80). This is not a decoded mission spawn layout. The native
RNG table/index are never replaced or reseeded, including during spawning,
idle tasks and recovery.

| Stage | Native result |
| --- | --- |
| Stream `[26,1,0]` through `0x41defc` | Original selected handler `0x41cf8c` writes pending order 13 for both casters. No effect yet. |
| Outer dispatch update 1 | `0x419bb8 -> 0x419248` consumes pending 13 through `0x412014`, starts FIN mode 1, pushes task 13/word 50. Charge stays 255. |
| Outer dispatch update 2 | Animation becomes 2 before task dispatch; `0x417b0c` calls `0x417168`. Original continuation executes, then charge clears, then occupancy/RNG produce writes. |
| Ground/air recipients near type 69 | Six total writes exhaust budget; final timers 26 (ground), 24 (air) in the baseline fixture. |
| Ground recipient near type 73 | Three qualifying visits, final timer 32. No synthetic duplicate occupancy. |

Every effect-entry event asserts mode 2. A merged `sequence` index across code
events and memory writes proves one original continuation lies between each
effect entry and its charge-clear write. Each timer write is checked against
the preceding original RNG-index update and executable lookup table.

The six cases are baseline, queued stop, queued redeploy, day/night reset with
caster-first allocation, the same reset with recipient-first allocation, and
native damage/recovery/reuse. They fail on unexpected native faults or any
runtime intercepted call; the JSON `accepted` flag is not a caught-error result.

### Queued Orders

After update 1 but before the effect, stream opcode 5 (`0x41ce54`) queues
order 1 (idle/stop) or another order 13. This leaves task 13 and its animation
intact. Stop is consumed by the effect's continuation but **does not cancel the
already committed effect**. With pending 13, continuation sees charge 255,
starts another mode-1 animation and pushes another task 13, then the first
effect clears charge. Update 3 completes that second task and applies another
effect at charge zero: task completion does not recheck deployment charge.
Do not turn pending stop into cancellation or debit charge before continuation.

At the reset boundary, original `0x419993..0x4199c1` resets counter 48 to 0
against threshold 47. A recipient dispatched after its caster decrements the
fresh timer in that same update; a recipient dispatched first receives the
full stamped timer. Allocation order, not a sorted target list, drives the
native registered-entity loop.

### Death and Slot Reuse

The lifetime case loads source weapon/damage tables and applies 200 native
`0x441930` hits of 4 damage to each caster (800 HP). This is batched native
damage, not a timed projectile firing test. Original lethal damage calls
`0x416308` and spatial removal `0x434d48`; recipients keep positive timers and
read multiplier 332 while casters have status 10.

Death creates recovery auxiliaries through `0x418f4c`. Their source FINs and
native movement binder `0x43be2a..0x43be59` are required: omitting them gives
null animation banks, not evidence that recovery should be skipped. In this
fixture auxiliary slots 22/23 are type 92/team 8. Death task 10 initially holds
word 0 at 1, but **that is not permanent retention**: native recovery writes
150 at `0x418d0e` on update 68. In the same outer dispatch, `0x416532/0x416536`
sets caster status 0 and registration `65535`. Type bytes remain 69/73, so
recipient damage still reads 332 from the reclaimed records.

At update 164, recipient timers are 16/14/22. Two automatic allocations through
`0x41b750`, both with requested slot `-1`, reuse 155 and then 152 for source
type-0 troopers. There is no forced slot assignment, deletion, or type-byte
patch. The existing recipients immediately resolve multiplier **0**, first
for slot 155's recipient and then for slot 152's recipients. Their timers and
stored slot words are unchanged. The reference is an index into the current
native slot record, not a generation-checked handle or snapshotted multiplier.

## Task-Completion Integration API

`completeLegacyInspireTask13(frame, host)` is an Inspire-only completion adapter
for a task the host has **already scheduled**. It is not the star's click
handler and does not start or advance animation. Its contract is:

1. Call only from the current native-equivalent task 13, after that entity's
  counter and animation updates. Modes other than 2 return `null` without
  callbacks. Non-Inspire types throw; other deployments need their own handler.
2. Capture caster slot, Q8 coordinates and current type budget at task entry.
  `host.continuePendingOrder(slot)` must perform the equivalent of `0x412014`:
  reset the current task and consume pending order, or schedule idle. This may
  schedule another deploy while old charge is still visible.
3. `host.clearCasterCharge(slot)` runs only after continuation returns.
  `host.readScanContext(slot)` then supplies current team, complete occupancy,
  current slot/type data and the shared native RNG table/index. Coordinates
  and budget remain those captured before continuation.
4. `host.commitScan(result)` applies every recipient write in order and commits
  the resulting shared RNG index synchronously. No deduplication, lifetime
  filtering or reentrant dispatch may occur within this scan transaction.
  The API does not poll again or reschedule the task itself.

The host still owns selected-command ingestion, pending-order consumption,
source FIN binding/directional animation, task stacks, the registered entity
order, native counter/reset and slot allocation/recovery. None is wired into
mission/main/simulation here. Types 70-72/74-76 have component/profile coverage,
not this uninterrupted FIN lifecycle proof. Full source rendering/audio,
mission selection/transport ingress, timed lethal projectiles, race-1 recovery
and uninterrupted timer expiry at a reset remain outside this trace. The
component tests cover expiry arithmetic including counter zero. No unresolved
transition remains in the demonstrated type-69/73 activation path.

## Pure Component Helper

[legacy-inspire.ts](../src/engine/legacy-inspire.ts) implements the proven
component behavior and the completion adapter above.
[Component tests](../tools/qa/legacy-inspire.test.ts) run with:

```sh
node --import tsx --test tools/qa/legacy-inspire.test.ts
```

All 15 component tests and six new
[lifecycle API tests](../tools/qa/legacy-inspire-lifecycle.test.ts) pass. The older
component probes retain their stated interceptions; the separate native
lifecycle matrix does not use those interceptions. Live integration remains
a host responsibility, not an enabled feature of this helper.

Public API:

| Function | Contract |
| --- | --- |
| `completeLegacyInspireTask13(frame, host)` | On mode 2 only, captures effect arguments, runs original-equivalent continuation, clears charge, reads current scan context, then commits the ordered scan. See the host contract above. |
| `getLegacyInspireProfile(typeId)` | Returns the observed capability, recharge, Q8 multiplier, and visit budget for types 69-76; otherwise `null`. |
| `getLegacyInspireChargeGates(charge)` | Returns `uiChargeReady` (`>32`) and `deployChargeReady` (`>=32`). These are charge predicates only, not complete UI or deployment eligibility. |
| `updateLegacyInspireCounters(state, nativeCounter, recharge)` | Returns new charge/timer/caster-slot state for one entity update using the actual `game+0x530` value. Does not advance a clock or infer seconds. |
| `legacyInspireScanCoordinates(xQ8, yQ8)` | Generates all 1,804 ordered, unclipped coordinate visits using the four native directions and eight-bit tile shift. |
| `scanLegacyInspireEffect(input)` | Returns zero caster charge, ordered recipient writes, updated RNG index, remaining visit budget, and coordinate-visit count. Does not mutate input or perform activation/continuation. |
| `applyLegacyInspireWrite(state, write)` | Returns recipient state with timer and caster reference replaced, preserving charge. Apply writes in order to their `targetSlot`; never deduplicate the scan. |
| `resolveLegacyInspireMultiplierQ8(state, currentSlots)` | Returns 256 if expired; otherwise reads the current stored slot's multiplier, including zero. Missing active caster data throws instead of inventing a lifetime fallback. |
| `legacyInspireCentersAim(timer)` | Reports the proven scatter bypass; does not promise projectile impact. |
| `applyLegacyInspireDamageQ8(base, matchup, inspire, armor)` | Applies low signed 32-bit products and arithmetic shifts after each factor, in that order. This is the evidenced arithmetic block, not the whole damage pipeline. |

State inputs use native byte charge/timer values and a native word caster slot.
Slot records provide the current entity's team and current type's parsed
`multiplierQ8` (`+0xfc`) and `primaryWeapon` (`+0x18`). They are supplied data,
not cached caster profiles. The helper does not parse source type rows.

Scan inputs require Q8 caster coordinates, caster team/full slot, a positive
native visit budget, map dimensions, and complete row-major ground dword/air
word occupancy planes. Packed occupants are masked to ten bits; 1022/1023
skip. An occupied slot missing from supplied records throws. No status,
alliance, existing timer, distance sorting, or distinct-unit filter is added.
`coordinateVisits` includes out-of-bounds attempts, just as the native hook does.

The caller supplies the exact 256-entry native RNG table and current global
index. Each accepted visit advances the index modulo 256 **before** table
lookup. Tests use a synthetic table to distinguish lookup order and wraparound;
they do not substitute that table for native game data. The returned index must
remain part of the shared RNG sequence when integration is eventually approved.

The scan models the effect body **after** the unresolved `0x412014`
continuation. Its zero-charge result is not permission to clear charge on click
or before continuation. The ordered write log preserves repeat refreshes and
per-visit budget consumption, including ground-before-air early termination.

Coverage includes every source caster profile, threshold discrepancy,
recharge-event counts, all 20-35 timer durations, zero/reset counter inputs,
expiry retaining its caster reference, both supplied recipient update orders,
Q8 coordinates, exact scan direction order, cross boundaries, clipping,
sentinels, packed slots, target rejection, duplicate refresh, RNG wraparound,
and the six-write/83-coordinate fixture. Combat tests cover current-slot lookup,
neutral expiry, centered-aim predicate, signed arithmetic, and intermediate Q8
truncation. Reset/order tests compose the helper directly, not the native entity
loop; current-slot tests do not prove native death or reuse behavior.

Remaining blockers are unchanged: uninterrupted animation initialization/update
to state 2; real task push/reset and pending-order continuation, including
interruption and a second order before charge clearing; caster death, type
change, and slot reuse with active recipients; and native expiry sequences at
day/night reset with both caster/recipient update orders. No live button,
main view, mission view, or simulation integration was changed.
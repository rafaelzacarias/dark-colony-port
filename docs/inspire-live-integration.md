# Live Inspire Integration

2026-09-19. Implements the restricted live simulation path justified by the
[native lifecycle evidence](inspire-runtime.md). No mission, main, game-data,
world, session, UI, or transport registration is changed. The star is not wired
by this change. Do not enable it without the owner inputs below.

## Implemented Scope

- Only source types **69 and 73** can execute the new Inspire command, from
  simulation idle or an already committed Inspire task. Other caster levels
  retain component profiles and can be referenced for damage, but cannot cast.
- Update 1 consumes pending order 13 and starts FIN mode 1. Update 2 advances
  the proven single-frame, zero-initial-delay deploy fallback to mode 2 and
  calls `completeLegacyInspireTask13`. TRSC/GRAY source stand states have one
  frame; the native binder expands them to 32 directional descriptors. This
  is a specialization of that FIN lifecycle, not a general animation engine.
- The actual source rows confirm levels 69-72 share TRSC and 73-76 share GRAY.
  Sharing a FIN does **not** extend the uninterrupted lifecycle evidence to
  higher levels; those activations remain rejected.
- Continuation runs before charge clear and scan. Pending stop cannot cancel
  the committed effect. Pending redeploy sees old charge, schedules another
  task, then completes on update 3 even though charge is now zero. Completed
  FIN mode 2 remains observable until the next idle update.
- Recharge uses `(sourceDayNight.elapsed & 31) === 0`; timer decrement uses
  `& 15`. Both include zero after phase reset. Counters execute per entity,
  before its effect, in the supplied native registered order.
- The original ordered occupancy scan, ground-before-air checks, same-team
  armed-target predicate, caster exclusion and duplicate-visit budget come
  from the existing helper. No radius approximation, deduplication, alive
  filter, faction equivalence, or generic PRNG is added.
- The 256 RNG dwords are the actual table at executable VA `0x478e04`.
  Tests compare every value to the SHA-256-pinned DC.EXE. The host supplies the
  current shared index; `SimulationOptions.seed` does not seed Inspire.
- Verified native ordinary hits resolve the target buff's caster slot on
  every hit, then pass that current Q8 factor into the existing damage
  pipeline between matchup and armor. Zero after slot reuse remains zero.
  Valid base profiles are not reclassified as unsupported merely because
  Inspire is active. No other source/weapon/caller family is enabled.

## Required Registration

Construct `DeterministicSimulation(grid, { sourceDayNightHeader, nativeInspire })`.
`sourceDayNightHeader` is mandatory for this adapter; never substitute the
simulation tick or a cooldown in seconds.

`nativeInspire` must implement these synchronous methods:

| Method | Owner responsibility |
| --- | --- |
| `readRegisteredOrder()` | Return ordered `{ slot, generation }` identities, using the actual registered-entity order, not sorted simulation IDs. Include every mapped live simulation unit. Missing, duplicate and stale entries throw. |
| `readPositionQ8(identity)` | Return `{ xQ8, yQ8 }` in native tile-Q8 coordinates at effect entry, before continuation. Do not assume render pixels or simulation subcells are this coordinate system. |
| `readOccupancy()` | Return `{ width, height, ground, air }`, complete row-major native dword/word planes, after continuation. Preserve packed slot bits and 1022/1023 sentinels. Update moving/dead occupants through the spatial owner. |
| `readRandomIndex()` | Read the current global native index, integer 0-255, after continuation. |
| `commitRandomIndex(index)` | Commit the final index synchronously after all ordered writes. |
| `onTaskTransition(identity, task)` | Integrate source task reset/push side effects for `"idle"` or `"deploy"`, including any owner-side RNG/spatial effects. The adapter itself owns pending Inspire/stop and charge gates. This callback sees the old charge. |
| `afterEntityUpdate(identity)` | Execute/synchronize the remaining native entity-task/RNG/spatial work before the next registered entity. Do not repeat Inspire counters, deploy animation or the scan. |

Callbacks must not reenter `advance`, change slot registrations/type profiles,
or dispatch commands synchronously. A scan is one indivisible transaction.
Exceptions mean unsupported/inconsistent host state; they are not a retry or
rollback mechanism. Do not continue a partially failed update.

After `addUnit`, call:

```ts
simulation.registerNativeInspireEntity({
  unitId,
  slot,
  generation,
  typeId: 69,
  team,
  primaryWeapon: 5,
  multiplierQ8: 332,
  charge,
  timer: 0,
  casterSlot: 0,
});
```

All fields are required source state, not defaults. Slots are 0-799 and are
independent of simulation IDs. Generations are nonnegative safe integers
owned by the allocator. Each replacement of a previously registered slot
requires a strictly newer generation. Charge/timer are bytes; casterSlot is
a word. A positive timer requires that referenced slot to resolve before
snapshot or hit evaluation. An expired timer does not read its stored word.

Register recipients and **every occupied native slot** as well. For ordinary
armed targets supply current source `typeId`, `team`, `primaryWeapon`, and
`multiplierQ8: 0`. Use `primaryWeapon: -1` for unarmed records. For native-only
records, static occupants or retained dead records use `unitId: null` and read
their state from `snapshot.nativeInspire`; the external owner must consume
their timers/aim effects itself. Membership in the ordered update list is
explicit. Mapped simulation units must have the same explicit team.

`updateNativeInspireType({ slot, generation }, { typeId, primaryWeapon,
multiplierQ8 })` updates the current type record without clearing recipient
references or copying a multiplier onto them. It rejects a type change during
an active/pending Inspire task. This is only the Inspire registry: the owner
must separately update the entity's actual source combat/render profiles.

`removeUnit(id)` detaches that simulation ID, cancels its local pending cast,
and retains the native slot/type record. Remove its registration identity from
the dispatch list when the native owner unregisters it. Death also cancels
local casting without erasing the record. Replacement registration changes
what existing buffs read, regardless of generation: generation guards owner
operations, **not** the native buff's slot-word reference.

## Commands And Readback

```ts
simulation.queue({ type: "inspire", unitIds: selectedIds, team: playerTeam });
simulation.queue({ type: "stop", unitIds: selectedIds });
```

Selected IDs are explicit; the UI/transport owner must supply the source-valid
selection, local ownership, visibility and interface gates. Wrong-team/dead
units do not cast. A known selected simulation unit lacking a native mapping
throws. Unverified caster types and non-idle initial tasks emit `rejected`.
Move/attack/harvest while Inspire is pending or committed throw rather than
invent interruption semantics. Stop and a second Inspire are the supported
pending orders. The shared native opcode 26 is **not** enabled for other deploy
actions by this API.

Read `nativeInspireState(unitId)` or `snapshot.nativeInspire`. Entries expose
charge, timer, casterSlot, current type/slot/generation, pendingOrder, FIN
animationMode, `uiChargeReady` (>32), `deployChargeReady` (>=32), `centersAim`
and `liveMultiplierQ8`. Charge flags are charge predicates only, not complete
button eligibility. Limit the star to verified 69/73 and valid owner gates.
`inspireEvents` contains this update's deploy/continue/clear/effect/rejected
events, with ordered duplicate writes, final RNG index and scan counts.

## Exactness Boundaries

The current simulation does not provide native occupancy, allocation/recovery,
general task stacks, idle RNG consumption, or source selection/transport.
**These are integration blockers, not optional approximations.** In the native
fixture, recipients consume three RNG entries on update 1, and newly idle
casters consume two on update 3. A no-op owner hook is valid only in a fixture
that explicitly has no corresponding native work, not for an arbitrary mission.
If the orchestrator cannot supply these owners, leave Inspire unsupported.

The live simulation's combat still applies direct batched hits, not the native
projectile lifecycle. `centersAim` exposes the verified scatter bypass for the
firing owner; this adapter does not claim new projectile/accuracy parity.
Inspired hits without an existing verified native ordinary profile emit
`unsupported-inspired-hit-profile`. Native-only air recipients can receive
timers, but this does not authorize unverified air-weapon hit callers.

Death/recovery scheduling and automatic allocator reuse remain owned outside
this module. Retained-record/current-slot behavior is implemented and tested;
native recovery auxiliaries are not recreated. No button, visual FIN playback,
audio, save/session registration, or network command encoding is implemented.

## Focused Verification

```sh
node --import tsx --test tools/qa/inspire-live-integration.test.ts \
  tools/qa/legacy-inspire.test.ts tools/qa/legacy-inspire-lifecycle.test.ts \
  tools/qa/live-native-combat.test.ts tools/qa/simulation-diplomacy.test.ts
```

The new tests pin the native table and source FIN structure, check charge
thresholds, update-2 casting, ordered duplicate writes, stop/redeploy, both
reset orders, expiry, death/type changes and live damage after slot reuse.
Five activation goldens compare all native timer writes and end-of-update
charge/timer/animation/slot state. Other-task RNG consumption is an explicit
owner fixture, not claimed to be implemented by the simulation.

To reproduce the independent uninterrupted trace and compare it directly:

```sh
PYTHONDONTWRITEBYTECODE=1 \
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
python3 tools/research/inspire-audit-20260919.py --lifecycle-only --json \
  > /tmp/inspire-native.json
DC_INSPIRE_NATIVE_TRACE=/tmp/inspire-native.json \
node --import tsx --test tools/qa/inspire-live-integration.test.ts
```

The trace's six accepted cases must have zero runtime interceptions. Activation
comparisons cover its first five cases; the sixth proves native recovery/reuse
independently and is not mislabeled as a simulated recovery implementation.
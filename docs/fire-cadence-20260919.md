# Bounded Native Fire Cadence

## Decision

The ordinary installed-task cadence is proved for TRSC type 0, GRAY type 8,
and commander types 69-76 using their **base weapons only**. An aligned,
continuously eligible explicit-target task launches at native entity updates
**0, 17, 34, 51**, not every 15 updates. Both source attack FIN variants have
no slot-7 muzzle event, so this subset has no FIN-derived launch delay.

The isolated [reducer](../src/engine/legacy-fire-cycle.ts) reproduces this
bounded task behavior. It does not integrate with or modify simulation,
legacy-balance, MissionView, main, damage, or animation presentation. No
browser, agents, full suite, or full game boot was used.

**Integration remains blocked:** command intake can replace/reset task state,
while target loss resumes acquisition/navigation. Neither complete path is
proved here. The reducer returns an explicit terminal `handoff` at those
boundaries instead of guessing cancellation, automatic retargeting, or resume
timing. These are not complete native Stop/Attack-order golden traces.

## Reproduce

From repository root, with Capstone 5 and Unicorn 2 available:

```sh
PYTHONDONTWRITEBYTECODE=1 \
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
python3 tools/research/fire-cadence-20260919.py --full > /tmp/dc-fire-native.json

DC_FIRE_NATIVE_TRACE=/tmp/dc-fire-native.json \
node --import tsx --test tools/qa/legacy-fire-cycle.test.ts

node node_modules/typescript/bin/tsc --noEmit --strict --target ES2022 \
  --module NodeNext --moduleResolution NodeNext --allowImportingTsExtensions \
  --skipLibCheck src/engine/legacy-fire-cycle.ts tools/qa/legacy-fire-cycle.test.ts
```

The `/tmp` dependency paths are local installations, not required fixture data.
Without `--full`, the [probe](../tools/research/fire-cadence-20260919.py) emits
a compact report. `--disassemble START END` prints a hash-gated native slice.
The test's native-comparison case skips unless `DC_FIRE_NATIVE_TRACE` is set;
the verification above ran with it set: **13 passed, zero skipped**. Native
coverage comprises 40 sequence fixtures, ten launch/reload fixtures, four
delay-selector cases, two turning controls, and clock checks.

The PE loader rejects any executable other than SHA-256
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
Source hashes are reported, not hardcoded rejection gates:

| Source | SHA-256 |
| --- | --- |
| GAMESTAT.TXT | `ed13afe21ffea368a5892b49de40ef063014c0a9376c5d5bb5abf1396cb27629` |
| WEAPSTAT.TXT | `391e5603108b73cff4a5d2135ae751a0c8aebb934e6f3d6e5e09c5e807e520d0` |
| TRSC.FIN | `eb94f6f3fff53b9f46f1540abf5287c11f83a7db7957d6288b2330b13e1f3b2a` |
| GRAY.FIN | `077887b708009109740a518bf8cff9c547a21145617dbf5dde575342fe5a641a` |

## What Executes

The fixture reuses the [combat caller probe](../tools/research/combat-callers-20260919.py)
and its hash-gated loader. Type/weapon scanner destinations and type conversion
execute natively; ASCII `sscanf` inputs are marshalled to those destinations.
There is no game/scenario boot. Source FIN state descriptors and relevant frame
headers are marshalled from the raw tag-29 files, not generated JSON or invented
durations. Sprite/resource allocation and rendering are not executed.

Original instructions execute:

- FIN signed duration conversion, `0x425b21..0x425b6f`.
- Native 16-source-direction to 32-runtime-direction lookup completion,
  `0x42623e..0x426303`; source-name lookup uses `(12-direction) & 15`.
- Entity update entry `0x419248`, all three FIN channel updates, and native
  indirect task dispatch at `0x4194fa`.
- Explicit-target task 6, `0x4157ec`, starting from a fixture-installed,
  stationary, strictly in-range target task. No pathfinding result is stubbed.
- Ordinary wrapper `0x41481c`, launch routine `0x412d00`, actual direction and
  turning helpers, source FIN selection/query, projectile allocator and
  constructor `0x441710`, reload push `0x4121d8`, and wait update `0x4121f8`.
- Pending-task reset `0x412014`, its pending callback 1 (`0x412654`), and
  dispatcher continuation up to acquisition entry `0x435c14`.

The **only intercepted callable in the fire fixture is spatial audio output
`0x431da8`**, with its eight stack-argument bytes consumed. No launch, reload,
RNG, FIN, target-liveness, task-reset, allocation, or turning return is replaced.
Every invocation/slice has a one-million-instruction ceiling and verifies EIP
at its declared endpoint. A neutral mode record backs `game+0x544`; ownership
is source team 0, target team 1, with no Inspire or weapon upgrade.

The fixture observes constructor completion and active projectile status 1.
It does **not** execute subsequent projectile flight, collision, damage, or
death. The global entity-before-projectile ordering is disassembly evidence at
`0x419bbe..0x419c13`, not a claim of executing the entire global game update.
The projectile wrapper `0x44293c` is executed with an empty list to verify its
four calls to `0x4423f8` per invocation.

## Weapon Fields

WEAPSTAT token numbering includes ID at token 0 and visual class at token 1.
Records are `0x4f0200 + weaponId*72`. The existing
[parser](../tools/extractors/data/tables.ts) exposes some misleading historical
names; it is deliberately unchanged.

| Token | Native Field | Meaning in Executed Launch Path |
| --- | --- | --- |
| 4, `rateOfFire` | dword `+0x08` | Selected reload-task countdown, in entity task-update calls |
| 8, `shots` | dword `+0x1c` | Effect/BOOMSTAT profile; not number of shots |
| 9, `reload` | dword `+0x20` | Burst length; nonpositive disables counter changes |
| 10, `magicChewing` | dword `+0x24` | Countdown selected when the burst finishes |

`0x413181..0x4131a3` increments entity byte `+0x34` only for positive burst
length, then resets it and selects the completion delay at the threshold.
Executed synthetic controls yield `(delay,counter)` of `(10,1)`, `(10,2)`,
`(30,0)` for a three-shot burst. This does not authorize burst units: the
reducer excludes them, including Scout weapon 37.

| Source Types | Sprite | Base Weapon | Rate | Burst Length/Completion Delay |
| --- | --- | --- | --- | --- |
| 0 | TRSC | 1 | 15 | -1 / -1 |
| 8 | GRAY | 15 | 15 | -1 / -1 |
| 69-72 | TRSC | 5 | 15 | -1 / -1 |
| 73-76 | GRAY | 62 | 15 | -1 / -1 |

Weapon IDs and these fields are asserted against natively parsed source data.
The constructor copies the selected delay into a **16-bit task payload**;
the burst counter is separate and byte-sized. No WEAPSTAT windup field is
established. Type variants, upgraded weapons, special fire, range-boundary
behavior and target status 10 are outside this contract.

## FIN and Launch Order

The type loader at `0x43b970` recognizes FIRE/FIREA/FIREB/FIREC. These source
FINs supply FIREA and FIREB; the fixture installs both in type `+0xa0/+0xa4`
and sets variant count `+0xe4=2`. Native RNG chooses the variant. All eight
source directions of STAND, FIREA and FIREB are read. Both attack variants
have eight entries. FIREA durations are normally 6 (converted to one update),
except GRAY FIREA0's first entry is 0 (converted to two); FIREB entries are 0
(converted to two). Slot-0 NONAME/value residues are not muzzle events.

At `0x412e3f..0x412e7c`, launch selects one-shot animation mode 1 and queries
**event slot 7 across the entire directional state**, using `0x4263d8`.
That query emits event positions and the cumulative **preceding converted
frame durations**, not an animation callback at the currently displayed frame.
Source slot 7 is empty throughout both ordinary attack variants; the executed
fallback supplies one shot with zero position/delay offsets. Projectile
allocation therefore occurs immediately after alignment, before reload push.
There is no source attack FIN event to await for this roster.

For a nonzero marker offset, the constructor would set projectile status 0
and delay `+0x12 = offset << 2`; `0x442456..0x44246a` decrements that delay
per projectile pass and activates on a later zero check. Four passes run per
game update. This general path is **disassembled, not sequence-certified**;
no delayed-marker or multi-marker reducer support is claimed.

Native entity updates advance FIN before task dispatch. After launch sets
frame/countdown bytes to zero, the next FIN update advances the frame before
loading its countdown. FIN completion can return the channel to STAND while
reload remains active. It does not permit an early shot. Separate turning
controls execute a 20-unit heading difference: the first call turns 10 with
no shot; the second turns the remaining 10 and launches. The reducer does not
implement turning; alignment must be supplied after that update's turn attempt.

## Golden Sequences

Update 0 means the first aligned eligible update of the fixture, not mission
time zero. Results hold for all ten source types. Full JSON includes FIN bytes,
reload count, task kind, target reference, pending flag, and launch count for
each update.

| Update | Continuous Task Result |
| --- | --- |
| 0 | Allocate one active projectile, push task 11 with count 15 |
| 1-14 | Counts 14 through 1; no launch |
| 15 | Count becomes 0; task 11 remains installed |
| 16 | Zero check pops task 11; returns 0, ending this task pass |
| 17 | Task 6 launches; count becomes 15 again |
| 34, 51 | Subsequent launches |

Boundary inputs are applied before update 5:

| Case | Executed Native Prefix | Reducer Result |
| --- | --- | --- |
| Continuous | Launches `[0,17,34,51]` | Same launches |
| Pending interruption | Set entity `+0x36/+0x37` to pending/callback 1; count reaches 0 at 15, pops at 16; at 17 reset consumes pending and dispatches acquisition | Launch `[0]`, `handoff: pending-order` at 17 |
| Retarget field | Change installed entity target word `+0x32` from slot 201 to live slot 202 at identical coordinates; no reset or turn needed | Launch `[0,17,34,51]`, slots `[201,202,202,202]` |
| Target gone | Set slot 201 status byte `+0x2c` to 0; reload still expires; at 17 task mode changes to 1 and launch rejects the dead slot | Launch `[0]`, `handoff: target-gone` at 17 |

Pending-interruption execution stops **before** acquisition `0x435c14` in
update 17. Target-gone execution returns from update 17; its next update would
enter mode-1 acquisition. No post-handoff native launch schedule is asserted.
The reducer remains inert after handoff as a fail-closed host boundary, not
because native units necessarily remain inert.

## Public Contract

`createLegacyFireCycle(sourceType)` creates a ready cycle for a newly installed
eligible ordinary task. Do not recreate it on target-reference changes or
every render frame. `stepLegacyFireCycle(state, observation)` returns immutable
state and either a `{weaponId,targetSlot}` launch request or `null`.

- One call represents **one native entity update**, not a browser tick,
  render frame, millisecond, or projectile substep. The caller owns scheduling.
- `targetSlot` is the currently installed, non-reused target slot (0-799),
  already resolved by the host. `targetStatus` accepts only native 0 or 1.
- `pendingOrder` reflects the native pending flag, not a new UI command. During
  reload it must remain latched externally, just as the native fixture does.
- While ready, the source and active target must be stationary and strictly
  in weapon range. `facingAligned` reflects the result of this update's native-
  compatible turning gate; it is irrelevant during reload or handoff.
- Reload decrements positive counts, then spends a separate update popping
  zero. Pending interruption takes precedence over target loss when ready.
- `handoff` requires the host to resolve command/reset/acquisition before
  supplying a newly installed task. It never silently resumes on target revival.
- No health write, damage computation, projectile flight, animation mutation,
  RNG choice, burst, upgrade, slot reuse or special ability is implemented.

The input types do not prove that a caller obeyed these eligibility and task-
installation preconditions. Runtime guards reject unsupported source types,
statuses, slots and malformed countdowns; they cannot validate native world
state. The [tests](../tools/qa/legacy-fire-cycle.test.ts) compare emitted shots
and each reload count directly against the executed native trace.

## Clock Meaning

Native initialization `0x41ba2c` writes **66 milliseconds** to `game+0x970`;
the probe executes that write. The existing scheduler evidence establishes
wall-clock catch-up into `0x4196f4` at `0x41e201` and a mutable interval at
`0x41dc2a`; see [transport timing](transport-decoding.md).

The browser declares **20 simulation ticks per second** in
[constants](../src/engine/constants.ts), and
[SimulationView](../src/simulation-view.ts) constructs its clock with
`1000 / SIMULATION_TICKS_PER_SECOND`, or 50 ms. Neither number is a rendering
FPS claim. FIN's integer `*15/100` conversion also does not prove rendering FPS.

At a maintained 66 ms native interval, 17 updates nominally span 1122 ms.
Seventeen calls made at browser 20 TPS would span 850 ms. Neither taking the
source 15 as browser cooldown nor calling this reducer once per current
browser tick establishes original wall-clock behavior. There is **no guessed
scaling, time accumulator, clock change or runtime hookup in this change**.

## Exact Remaining Blocker

Full order parity requires executing command intake through writes/resets of
entity pending bytes `+0x36/+0x37`, installed target `+0x32`, and task stack,
then continuing `0x435c14 -> 0x435570` acquisition and task-6 navigation using
real occupancy/visibility inputs. This fixture starts with an installed task
and does not supply that world. A real Stop/Attack command may alter reload
earlier than a pending flag alone. Consequently the field-retarget control
must not be advertised as a player-retarget golden trace, nor the pending
callback-1 control as a complete Stop trace. Original wall-clock integration
also needs an explicit native scheduler adapter. Those are the blockers to
live enablement; the isolated reducer intentionally cannot bypass them.
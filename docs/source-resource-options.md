# Source Resource Options

2026-09-19. Isolated implementation:
[source-resource-options.ts](../src/engine/source-resource-options.ts),
[focused goldens](../tools/qa/source-resource-options.test.ts), and
[native probe](../tools/qa/source-resource-options-native.py).
No session, transport, view, main, game-data, generated asset or raw-CD edits.
This closes bounded fresh resource inputs, not complete LIVE mission admission.

## Configuration Selection

```ts
const configuration = selectSourceResourceConfiguration({
  profile: "user-selected-source-campaign-fresh",
  mode: 0,
  localTeam: 0,
  race: mission.faction === "human" ? 0 : 1,
}, "native-constructor");

const options = await loadSourceResourceOptions({
  sessionId, mission, rawScenario, configuration, world, loadBytes,
});
```

The profile is the same explicit user-selected fresh campaign profile used by
[source production](source-production-options.md). No installed native config
artifact was supplied. The constructor selection is deliberate, not an inference
that 100 is a natural percentage. Other modes, teams, races, missing selection,
and edited percentage arrays fail.

The executable SHA-256 is
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
Executed `0x429952..0x4299cd` over poisoned configuration memory proves that
`+0x14c4 + team*4` is **100 for all eight teams**, and mode/race initialize to zero.
The existing selected-header probe executes `0x429f28..0x42a00b` for both races,
signature `0x21340002`, header `[1,0,race,0,0,0,0,0]`. Percentages survive that load.
This is the header path with substituted stream I/O, not a recovered config file
or proof of every field in its remaining path/string/array sections.

Executed startup `0x40177e..0x4017ba` performs signed32 `(percent << 8)`, divides by
100 truncating toward zero, and writes side `+0x19b8 + team*0xe30`: eight **256**
multipliers. The probe checks they remain 256 after the actual SCN reader.
The native configuration object is outside the entire game allocation; placing
it at `0x840000` overlaps native entity storage and is invalid for this probe.

**No Easy/Normal/Hard percentage mapping is established.** The supplied NEWGAMEE,
SHUMANE and LOPTE menus do not establish those named choices. The inspected
percentage writer is the constructor. Therefore the selection API exposes only
`"native-constructor"`; it rejects `"easy"`, `"normal"`, and `"hard"`, rather than
aliasing Normal to 100 or manufacturing difficulty states. A menu setter or
independent source artifact is required before adding those names.

## Fresh Native State

| Input | Executed evidence | Fresh value |
| --- | --- | --- |
| Cancellation gate `game+0x948` | Allocator clear `0x40bddc..0x40bdef`, retained through SCN | 0 |
| Local team `game+0x7d1c` | Game initializer `0x40bf80`, retained through SCN | 0 |
| Income selector 1 | `0x419d60` clears poisoned statistics, retained through SCN | Eight signed32 zeros |
| AI multipliers | Config constructor, startup conversion, retained through SCN | Eight 256s |
| Source clock | Original SCN header | HUMAN02 elapsed 5100; ALIEN02 5700 |
| AI fields | Original ordered SCN teams | Supplied by parsed source, not difficulty inference |

The allocator clears **all `0x471b0` game bytes**, tested from `0xa5` poison.
Mode 0 bypasses the multiplayer local-team assignment at `0x401667` via
`0x4014ed..0x4014f5`. The probe executes `0x41b9ce..0x41c7ee` for HUMAN02 and
ALIEN02 with their original header, teams and complete placement streams.
Integer parsing, team setup, placement allocation, type-40 handling, entity
constructors and FIN/task initialization execute native instructions.

The probe substitutes external asset initialization, terrain/graphics loading,
TRO loading, display initialization, reserved-building construction, alliance
callbacks, time, file open/close and SCN line I/O. The exact addresses are emitted
as `scnExternalBoundaries`; no claim of an uninterrupted launcher or rendered
mission is made. FIN banks are loaded independently using the existing native
FIN decoder/resolver harness, and map pointer planes are explicit fixtures.
The original source rows are not moved or paired with invented extractors.

Fresh gate zero is **not** a permanent or resume default. Executed load block
`0x40d984..0x40d99f` normalizes serialized `0,1,-1` to `0,1,1`; executed
`0x43c500` sets the gate to 1. The save-state restore path `0x43fca8` conditionally
calls that setter at `0x43fd41`; the fresh TRO loader is the distinct `0x43fb90`
path. A current runtime owner must supply changed gate/local-team/AI state.
The loader refuses a progressed world and must not be used to resume it.

`resourceScales` is the existing configured-startup scale pair `{256,256}`;
the earlier native resource initialization probe establishes constructor globals
4, startup shift by 6, and selector-0 publication. It is not an arbitrary scale
configuration API. `resourceInitialIncome` belongs only to fresh initialization.
Original `%Money` remains source-owned; the builder does not change funds.

## Static World Pairing

Raw SCN bytes must match the mission SHA-256 and the existing production loader's
full-source checks. This builder additionally restricts admission to these two
fingerprinted second missions. The world must contain the same parsed source,
session identity and fresh clock, a complete actual native host, and raw entity
records. Missing, moved, stale, released, already-bound or altered resources fail.

| Mission | Source row | Native slot | Tile | Rate | Reserve |
| --- | ---: | ---: | --- | ---: | ---: |
| HUMAN02 | 15 | 166 | 88,72 | 0 | 3500 |
| HUMAN02 | 16 | 167 | 11,68 | 0 | 3500 |
| HUMAN02 | 17 | 168 | 69,48 | 22 | 12000 |
| HUMAN02 | 18 | 169 | 53,27 | 15 | 7000 |
| ALIEN02 | 38 | 190 | 4,80 | 25 | 9500 |
| ALIEN02 | 41 | 191 | 65,54 | 12 | 3500 |
| ALIEN02 | 42 | 192 | 13,51 | 0 | 5000 |

RENAT rows do not consume entity slots. These slots are not `152 + sourceRow`.
Every source has owner 8, status 1, generation 0, constructor direction 0,
VENTSTAND bank, frame/delay/mode **0/0/0**, no pending order, order 0, and task 1
with initial words **`[65535,0,0]`**. The final two words are not reserve/HP.
They differ from the later idle-reset payload produced by other native paths.

The builder compares source entity, host registry/key/generation, native256
position, HP, rate/countdown and raw bytes before returning `resourceLifecycle`.
It does not configure or mutate the input world. Its output is structurally
usable as the existing opt-in session resource options.

## FIN And Harvester State

The loader pins the actual generated VENT, EXPL and SLUG JSON bytes, validates
original FIN source hashes, and resolves all 32 bank directions. Native
`0x4260a8` uses suffix `(12-index)&15` and the exact fallback table at `0x47950c`:
`0,+1,-1,+2,-2,...,+15,-15,16`. Tests compare every duration byte of all 15
stand/deploy/death type bindings, not only direction zero. Original FIN parsing
also agrees with generated states and `field2` values.

Type 40 falls back to VENTSTAND for deployment/death. Mobile types 6/14 use
EXPL/SLUG stand, deploy and death banks; deployed types 47/48 use EDPLY/SDPL
stand/death banks. All five types prove deathVariants=1, removalHoldField=0 and
selectedWeapon=-1. Construction-only BURN/ALBU metadata is fingerprinted by the
native harness but is not needed in these returned resource banks.

There are **no placed harvesters** in either of the two source placement streams.
Detached constructor probes at slots 798/799 are separately identified evidence,
not added mission entities. Their native constructor reads GAMESTAT type `+0xe0`:
EXPL direction **160**, SLUG **128**; both start with stand frame/delay/mode 0/0/0,
task 1, words `[65535,0,0]`, and zero order bytes. Snapshot state labels from the
native harness describe direction zero; the binding keeps actual direction so
the host selects the correct directional timeline.

`sourceHarvesterConstructorBinding(world, snapshot)` validates an explicit fresh
constructor snapshot against an actual registered, unbound mobile host entity.
It returns a copy. It does not fabricate a snapshot, spawn a harvester, bind all
mobile units, resume a deployed unit, or declare preceding movement finished.
Later idle/reset/resume states need their actual task owner's contract.

## Frame And Prerequisites

```ts
const frame = sourceResourceFrame({
  ...currentResourceFrameSource,
  world: currentWorld,
  sourceDayNight: committedSourceDayNight,
});
```

This pure helper derives full32 colony gates from the current world and delegates
the single source-clock advance and validation to `campaignResourceFrame`.
Use returned `resourceFrameSource` only at fresh boot; subsequently supply actual
current AI records, multipliers, local team, gate and order bytes. Commit the
returned clock only with successful host/session dispatch. No trigger-counter
clock, frame-dependent fallback or local simulation loop is introduced.

The returned prerequisites remain explicit: `generic-mobile-idle-owner`,
`incoming-harvester-task-handoff`, and `mission-admission`. `missionAdmission`
is always `"not-evaluated"`. The focused test binds a real constructor-shaped
harvester off-source and verifies the existing host rejects general mobile
idle/wait without mutating the world. No no-op dispatcher closes that gap.
Mission AI/TRO admission and LIVE integration remain their existing owners' work.

Eruption is the already-proven nonspatial category 1/event 7 binding, sound 183,
`SOUND/ERUPT.WAV`. No new audio mapping or playback side effect is introduced.

## Verification

```sh
node --import tsx --test tools/qa/source-resource-options.test.ts
npm run typecheck
```

The focused test runs the original native probe unless `DC_SOURCE_RESOURCE_TRACE`
supplies its matching JSON. It uses the existing Capstone/Unicorn installations
under `/tmp`. Nine tests cover both source missions, all seven native source
rows, every FIN bank direction, config/gate/income evidence, pure frames,
constructor snapshots, transactional mismatches, and explicit mobile-idle failure.
No agents, browser, full suite or changes to excluded shared modules were used.
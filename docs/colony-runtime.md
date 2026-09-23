# Initial Colony Projection

`src/engine/legacy-colony.ts` implements a pure, bounded projection of campaign
SCN City initialization. It does not modify the parser, simulation, controller,
or rendering. Inputs are the existing parsed teams and GAMESTAT unit records.

## HUMAN01 Result

The source is `raw_cd/DC/SCENARIO/HUMAN/HUMAN01.SCN`, not generated JSON.
Team 1 has coordinate rows `(69,65)` and `(76,65)`. The **second** row is the
colony base. City row 0 is:

```text
1 1000 1 1000 0 -1 0 -1 0 -1
```

| Team/slot | Native ID | Unit type / sprite | HP / source maximum | Object state | Team slot state | Runtime position |
| --- | --- | --- | --- | --- | --- | --- |
| 1/0 | 15 | 16 / EXCOPOD | 1000 / 4800 | 1 | 1 | (74,65.46875) |
| 1/1 | 16 | 17 / BRRKPOD | 1000 / 2400 | 1 | 1 | (76,65) |
| 1/2 | 17 | No object | 0 | 0 | 0 | None |
| 1/3 | 18 | No object | 0 | 0 | 0 | None |
| 1/4 | 19 | No object | 0 | 0 | 0 | None |
| 1/5 | 20 | 81 / TOWR | 1 / 1600 | 1 | 1 | (76,66) |

All other HUMAN01 teams have no projected colony objects. TOWR is a separately
initialized base object, not one of the five mission `b` slots. Its initial HP
really is 1, not GAMESTAT's 1600. Its collision footprint is empty.

EXCOPOD occupies `(73,65) (74,65) (73,66) (74,66)`.
BRRKPOD occupies `(75,64) (76,64) (75,63) (76,63)`.
These are runtime grid coordinates; no MAP source-row inversion is applied to
the returned points. Sprite positions are not collision bounding rectangles.

The actual initial `b(1,0..4)` values are **1000, 1000, 0, 0, 0**. They are not
five invented nonzero flags, nor a census of objects with matching unit types.

## Native Chain

Evidence is pinned to DC.EXE SHA-256
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
Code offsets use VA minus `0x400c00`; the tables below use VA minus `0x402400`.

The SCN team pointer is `EDI = game + 0xb98 + team*0xe30`.

1. `0x41c04f..0x41c066` parses coordinate row 0 into `EDI+0x34/+0x38`.
   `0x41c07e..0x41c097` parses coordinate row 1 into `EDI+0x2c/+0x30`.
   `0x41c0b5..0x41c0ca` only substitutes the second row into the first when
   both first-row values are zero. It does not substitute the other way.
2. `0x41c0cd..0x41c1ef` consumes five `(sourceLevel, HP)` pairs from City row 0.
   `0x41c1df` requires base X nonzero; `0x41c0f0` requires positive level.
   Otherwise it writes zero HP and zero upgrade level at `0x41c12d`.
3. `0x41c11d` stores HP at `EDI+0x3c+4*slot`.
   `0x41c120..0x41c124` stores `sourceLevel-1` at `EDI+0xc4+4*slot`.
   These are different fields, not interchangeable presence flags.
4. HP `-1` takes `0x41c102..0x41c116`: call `0x444c3c` with EAX=slot and
   EDX=sourceLevel-1, then fetch `0x4f1880 + unitType*280 + 0x44`.
   This lookup is **race-independent**, even for alien teams. Preserve the
   observed behavior instead of silently substituting the displayed unit's HP.
5. `0x41c176..0x41c1bd` initializes slot 5: both base coordinates nonzero
   yield HP 1 at `EDI+0x50`, otherwise zero. Upgrade at `EDI+0xd8` is zero.
6. `0x41c3ef..0x41c426` invokes `0x444f14` for all 15 slots of all eight teams.
   This projection covers slots 0..5 only; it does not invent slots 6..14.
7. `0x444f2a..0x444f74` computes ID=`team*15+slot`, object pointer
   `game+0x7d28+ID*220`, and the team pointer. Zero stored HP clears object
   byte `+0x2c` and returns (`0x444f77`). Nonzero HP continues initialization.
8. `0x444f8f..0x444ffb` selects type from
   `u32(0x47afa8 + race*120 + upgradeLevel*60 + slot*4)` and writes object
   byte `+6`. `0x445064` copies stored HP to object dword `+0xc`.
9. `0x445097..0x4450fa` initializes object position, state byte `+0x2c=1`,
   and team byte `+7`. `0x41822c` sets team byte `+0x78+slot=1` at
   `0x4182c1`. This team slot state is separate from both HP and object state.
10. `0x43d209..0x43d233` implements `b(team,slot)` by reading the low word of
    `game+team*0xe30+0xbd4+4*slot`, exactly `EDI+0x3c+4*slot`. The expression
    stack interprets it as a signed 16-bit value.

City rows 1..8 are not eight more buildings. The native loop
`0x41c20d..0x41c287` uses them to update per-team unit-table bytes at
`0x4f18b0` and `0x4f18b8` (unit stride 280). This projection leaves those
unrelated fields untouched.

## Tables And Coordinates

First six entries of the 15-entry type banks at `0x47afa8`:

| Race | Upgrade | Slots 0..5 |
| --- | --- | --- |
| 0 | 0 | 16,17,18,20,22,81 |
| 0 | 1 | 16,17,19,21,22,81 |
| 1 | 0 | 28,29,30,32,34,81 |
| 1 | 1 | 28,29,31,33,34,81 |

Position offsets at `0x47ab70`, by slot:
`(-64,15) (0,0) (32,64) (64,10) (-32,65) (0,32)`.
Each native coordinate is `u16(base*256 + offset*8)`; `position` divides that
value by 256, retaining fractions. HUMAN01 EXCOPOD's native coordinates are
`(18944,16760)`. Do not insert the usual mobile-unit half-cell offset.

Collision uses the different table at `0x47abe8`, documented in
[navigation-decoding.md](navigation-decoding.md). Enumeration ends at eight
pairs or the first immediately repeated pair (`0x444de0`, `0x445237`).
For slots 0..4 the resulting four pairs are stored directly in the projection.
`0x41822c` pushes/restores ECX; consequently `0x445136` compares the preserved
slot against 5 and bypasses collision insertion for TOWR. This closes the
previously unresolved bypass interpretation for the initial colony path.

## Integration Contract

```ts
import { projectLegacyColony } from "./engine/legacy-colony";

const colony = projectLegacyColony(scenario.teams, units);
const buildingSlots = colony.buildingSlots;
const initialBuildings = colony.buildings;
```

- `slots`: six records per supplied team, including explicitly empty slots.
  Fields include native ID, source level, native upgrade level, stored HP,
  team slot state, and a nullable initialized entity.
- `buildings`: only initialized entities, with source type/sprite/max HP,
  actual HP, native object state, fractional position, native fixed-point
  position, and collision cells. The list includes TOWR.
- `buildingSlots`: keys `"team,slot"` for slots 0..4 of every supplied team,
  storing exact HP dwords. Pass directly as `TriggerInputs.buildingSlots` or
  the campaign world's existing `buildingSlots` option. The trigger runtime
  already converts these to signed words. Never replace them with `slotState`.

Preserve `nativeId` independently of simulation allocation order; inserting
these objects with ordinary auto-assigned IDs does not satisfy native identity.
Inactive reserved IDs have no entity. A source HP override is not clamped to
GAMESTAT maximum. `maxHealth` is the source type's nominal HP, not a claim that
the native initializer writes a separate maximum-HP object field.

## Verification

```sh
node --import tsx --test tools/qa/legacy-colony.test.ts
npm run typecheck
```

Six tests cover actual SCN/GAMESTAT data, native hash/instruction/data anchors,
zero HP, absent slots, invalid inputs, and nonmutation. The differential test
executes the original loader `0x41c0cd..0x41c1ef`, initializer through
`0x445136` (or its early return), slot-state routine `0x41822c`, footprint
enumerator `0x444de0`, and the `b` VM handler. Eight HUMAN01 teams plus five
boundary fixtures yield 78 slot comparisons. Synthetic, distinct HP values
are seeded into native GAMESTAT memory to detect wrong type/race indexing;
the separate source test verifies the real 4800/2400/1600 defaults and overrides.

The emulator replaces file reading with the actual fixture's City line, but
executes the native integer parser. Animation setup `0x42630c`, order reset
`0x412014`, UI refresh `0x437bc4`, and auxiliary pointer lookup `0x411dd8` are
stubbed. It does not execute map insertion or claim a full game boot.

The existing environment is Capstone in `/tmp/dc-re-capstone-20260918` and
Unicorn in `/tmp/dc-trigger-unicorn-20260918`. To use another installation,
set `DC_COLONY_PYTHONPATH` to a Python module search path containing Capstone 5
and Unicorn 2. Missing native dependencies fail the test rather than silently
skipping it. No browser is required.

## Remaining Boundaries

- Campaign initialization only: game mode 0 (and the same City filtering branch
  for mode 3). Other modes additionally gate slots through
  `gameOptions+0x1524+team` at `0x41c140..0x41c19e`; no multiplayer adapter is
  implemented here. Do not call this API as a general multiplayer loader.
- Supported inputs are teams 0..7, races 0/1, source levels 0..2, coordinates
  0..255, and HP -1 or nonnegative signed dwords. Other inputs are rejected,
  not guessed. This is not a full-corpus acceptance claim.
- This is an initial snapshot, not a building lifecycle. Damage, destruction,
  repairs, upgrades, construction, slots 6..14, and production/statistic side
  effects still require verified updates. The existing removal evidence clears
  slot HP at `0x416392`; merely hiding a sprite will not update `b`.
- The caller must install footprints into navigation and preserve native IDs
  in rendering/combat. This function neither checks MAP bit 31 nor performs
  native occupancy assertions, map mutation, animation, or order setup.
- HUMAN01 building conditions can now be supplied honestly. This does not
  resolve other mission statistic/action adapters or complete mission parity.
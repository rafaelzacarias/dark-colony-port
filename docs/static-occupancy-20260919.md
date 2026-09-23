# Required Noncolony Static Occupancy

Audited 2026-09-19. **The required noncolony footprint/occupancy semantic blocker
is closed for the 108-SCN source corpus and its newtype/reinforcement operands.**
Unsupported required noncolony types: **none (`[]`)**.

This is not full Phase 2 acceptance or live integration. No mission, simulation,
world, main, exporter, generated asset, or shared acceptance document was edited.
The host's empty noncolony footprints still need to consume the proved contract.
Colony projection, resource lifecycle and trigger semantics below reuse existing
evidence; they are not newly certified as complete gameplay systems.

- Research: [static-occupancy-20260919.py](../tools/research/static-occupancy-20260919.py).
- Pure helper: [legacy-static-occupancy.ts](../src/engine/legacy-static-occupancy.ts).
- Tests: [legacy-static-occupancy.test.ts](../tools/qa/legacy-static-occupancy.test.ts).

## Corpus And Reproduction

Run from the repository root. Capstone and Unicorn are research dependencies,
not browser dependencies. The paths below reuse the installed research packages.

```sh
export PYTHONPATH=/private/tmp/dc-re-capstone-20260918:/private/tmp/dc-trigger-unicorn-20260918
python3 tools/research/static-occupancy-20260919.py \
  --probe --constructors --exceptions --reinforcements --include-auxiliary \
  > /tmp/dc-static-occupancy.json
DC_STATIC_NATIVE_TRACE=/tmp/dc-static-occupancy.json \
  node --import tsx --test tools/qa/legacy-static-occupancy.test.ts
node node_modules/typescript/bin/tsc --noEmit --strict --target ES2022 \
  --module NodeNext --moduleResolution NodeNext --allowImportingTsExtensions \
  --skipLibCheck src/engine/legacy-static-occupancy.ts tools/qa/legacy-static-occupancy.test.ts
```

The JSON is the **complete named/hash census**, not a sample manifest:

| JSON field | Coverage |
| --- | --- |
| `sources` | Path, byte count and SHA-256 for DC.EXE, GAMESTAT, all 108 SCN/MAP/PTH/MTG quartets and all 101 TRO: 535 files. |
| `types` | All 106 source type IDs/names, native speed, race, counterpart, movement byte, auxiliary field, classification and every SCN/City/action reference. |
| `actions` | Every `newtype`, `reinforce` and `reinforce2` action, source path, block, arguments and raw text; reinforcement operands also include original-parser byte output and unconsumed text. Zero-count groups are not roots. |
| `nativeScenarios` | All 108 names and real dimensions; original ordered placement streams; static/nonentity row indices, effective types/owners/slots, PTH family, exact cells and writer PCs. |
| `constructorCases` | 138 original constructor/removal cases: 23 required types, owners 0/8/9, both opposite map corners. |
| `reinforcementCases` | All 23 required static positive-count groups, one member each: 10 type-45 mines and 13 type-94 vision entities. Real TRO coordinates and real PTH records reach the original allocator. |
| `exceptionCases` | Four SCN no-entity gates; 27 shifted-plane/status removal cases; duplicate-slot first-match case. |
| `auxiliaryEvidence` | Three executable hashes and extension xrefs; every source O16/OVH/SET filename and hash: 100 O16, 100 OVH, three SET files. |
| `coverage` | Counts, exact required/unsupported/unreferenced type lists and canonical core manifest hash. |

The four multiplayer `63+r%5` action lines do **not** expand to types 63..67.
Original parsers `0x43eb74`/`0x43ec8b` call numeric conversion `0x46d6b0`:
type becomes 63, count becomes zero, the cursor remains at `+r%5`, and the four
remaining groups become `(0,0)`. These lines add no positive-count type root.
All reinforcement actions are compiled through that native parser, including
byte truncation and omitted groups, rather than evaluating source expressions.
Unknown resulting type operands remain explicit in `unsupportedOperands`; the
corpus has none. `newtype` uses argument three, not its X coordinate. City
references use the existing native type bank at `0x47afa8`, not sprite names.

Core manifest digest, SHA-256 of sorted ASCII `path<TAB>sha256<LF>` records:
`497516ed09b15413b1081ea275202ef1c8e7186c7c812dd480ac0d56fffa593f`.

| Source | SHA-256 |
| --- | --- |
| [DC.EXE](../raw_cd/DC/DC.EXE) | `65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b` |
| [GAMESTAT.TXT](../raw_cd/DC/GAMESTAT/GAMESTAT.TXT) | `ed13afe21ffea368a5892b49de40ef063014c0a9376c5d5bb5abf1396cb27629` |
| [DC16.EXE](../raw_cd/DC/DC16.EXE) | `3159a24c69b4299e668d981daca0a21f5a8c1ade7bcc48c9f89379450d27762f` |
| [MAPED.EXE](../raw_cd/DC/MAPED.EXE) | `e8471a0adcade0d0562f0e38ddbc85ebbd0776f50cc7429628dee435fa6a8f7e` |

## Exact Constructor Rule

Definition base is `0x4f1880 + 280*type`; entity base is
`game+0x7d28 + 220*slot`. The probe reuses the source GAMESTAT scanner destinations
and conversion code from the existing Inspire harness, rather than assigning
fields from a guessed table layout. SCN parsing and occupancy instructions run
as original machine code.

`0x41af14` receives game in EAX, tile X/Y in EDX/EBX, type in ECX, and
owner/HP/extra-byte/slot on the stack. Coordinates must be inside actual map
dimensions (`0x41b017`, `0x41b084`); construction does not clamp them. Position
words become `tile*256+128` at `0x41b184..0x41b1b5`.

At `0x41b3d1`, **owner exactly 8 bypasses all three occupancy planes**.
Owner 9 does not. Otherwise the effective entity type selects:

| Priority | Original field/test | Plane | Native cell address | Extent |
| --- | --- | --- | --- | --- |
| 1 | signed dword definition `+0x68 != 0`, `0x41b3f9` | Auxiliary | `*(map+0x1004+4*y)+2*x` | One cell |
| 2 | byte definition `+0x60 != 0`, `0x41b428` | Air | `*(map+0xc04+4*y)+2*x` | One cell |
| 3 | Both tests zero | Ground | `*(map+0x804+4*y)+4*x` | One cell |

Each write is exactly `(previous & ~0x3ff) | slot`. The native ground path
ANDs only the low word with `0xfc00`, then ORs the dword with slot; bits 10..31
survive. Word planes preserve bits 10..15, including loaded MTG tags in air.
There is no vacancy assertion in this constructor: existing low-ten-bit IDs,
including 1022 or another slot, are overwritten. Do not add an invented
rectangle-clear or free-cell predicate to this helper.

There is **no footprint width/height lookup, sprite/FIN bounds lookup, PTH
walkability test, or neighbor loop in this registration branch**. Speed is a
census selector, not an occupancy predicate. A source speed of zero does not
mean no footprint; an airborne class of 7 is nonzero, not an unknown rectangle.
All three branches terminate at registry write `0x41b488`; constructor return is
`0x41b49b`. The rule is bounded source math, not an approximation of visible art.

## Required Type Census

The 2,013 actual zero-speed placement rows produce 519 ground, 42 air, 236
auxiliary and 1,216 no-occupancy registrations. The following counts are source
placement rows before race/counterpart substitution. Reinforcement/newtype
references are additional roots, not pre-expanded startup objects.

| ID | GAMESTAT name | SCN rows | Native classification and occupancy |
| --- | --- | ---: | --- |
| 37 | POOP | 134 | Neutral coordinate-FIFO entity, owner 8, no occupancy |
| 40 | VENT | 1082 | Resource entity, owner 8, no occupancy; separate MAP flag |
| 41 | T | 149 | Stationary unit, ground 1x1 |
| 42 | XDEPLOY | 150 | Stationary unit, ground 1x1 |
| 45 | HMINE | 227 | Mine unit, auxiliary 1x1; also 10 reinforcement groups |
| 46 | HMINE | 9 | Mine unit, auxiliary 1x1; some rows become type 45 |
| 47 | EDPLY | 1 | Deployed extractor unit, ground 1x1 |
| 48 | SDPL | 1 | Deployed extractor unit, ground 1x1 |
| 82 | SALA | 11 | Scenario structure unit, ground 1x1 |
| 83 | CRYO | 2 | Scenario structure unit, ground 1x1 |
| 84 | BEAC | 25 | Beacon unit, ground 1x1; also two newtype targets |
| 85 | FUEL | 13 | Scenario structure unit, ground 1x1 |
| 86 | DISH | 17 | Scenario structure unit, ground 1x1 |
| 87 | FETU | 36 | Scenario structure unit, ground 1x1 |
| 88 | TORT | 22 | Scenario structure unit, ground 1x1 |
| 89 | CENT | 27 | Scenario structure unit, ground 1x1 |
| 90 | FILL | 9 | Scenario structure unit, ground 1x1 |
| 91 | TONG | 10 | Scenario structure unit, ground 1x1 |
| 94 | DOTT | 42 | Vision-sight entity, air 1x1 (class 7); also 13 reinforcement groups |
| 95 | BEEK | 2 | Inactive-beacon unit, ground 1x1 |
| 97 | WATC | 4 | Vision/objective unit, ground 1x1 |
| 98 | CAM | 37 | Vision/objective unit, ground 1x1 |
| 100 | FUEL | 3 | Scenario structure unit, ground 1x1 |

No required SCN type is proved to be a purely decorative sprite-only object.
In particular, do not turn DOTT, WATC or CAM into decoration merely because of
their visual presentation. OVH/O16 imagery and editor SET records are not SCN
entities and do not produce an additional object footprint.

The other 15 required zero-speed definitions are colony types
`16..22, 28..34, 81`: EXCOPOD, BRRKPOD, ROBOPOD, ROBOPOD2, SCNCPOD,
SCNCPOD2, RSCHPOD, BIOHIV, WARHIVE, BRDRHIV, BRDRHIV2, MINDHIV,
MNDHIV2, RSCHIV, TOWR. Their 15-slot ownership/offset path is already described
in [colony-runtime.md](colony-runtime.md) and
[navigation-decoding.md](navigation-decoding.md). Slots 0..4 consume the exact
offset table with consecutive-repeat termination, not a bounding rectangle.
TOWR's colony slot 5 has a legitimate empty footprint. This helper rejects
slots below 120 so those paths cannot accidentally become single-cell objects.

Zero-speed definitions with **no SCN/City/newtype/positive-reinforcement root**:
`35 RSCHIV`, `38 RNAT`, `51..53 ONEF`, `54..56 TWOF`, `57..59 ONEF`,
`60..62 TWOF`, `77 SARGSTL`, `78 PSYCSTL`, `96 PCFO`, `99 FUEL`,
`101 FILL`, `102 FILL`. They are not silently treated as required, nor does this
audit certify their production/transformation/death workflows.

## SCN And Action Exceptions

All 4,377 source placement rows execute in original order in mode 0, beginning
at native ordinary slot 152. The following dispatch comes before assigning any
generic footprint:

1. `0x41c4af..0x41c4ee`: owners 0..7 can substitute the native counterpart when
   team race differs. Read the **effective** type after this step. The report
   includes actual cases of source type 46 becoming 45.
2. `0x41c4f1`: column four `-1` calls metadata registration `0x43fd50`, creates
   no entity and consumes no entity slot. All 601 corpus rows of this kind have
   source types 23, 24, 25, 26 or 36. A synthetic zero-speed type-84 row proves
   this is a row dispatch rule, not an animal-type exclusion list.
3. `0x41c510`: VENT forces owner 8, runs the resource constructor, and ORs
   `0x04000000` into packed MAP cell `*(map+4+4*y)+4*x` at `0x41c58f`.
   This is **not** the ground occupancy plane. Keep rate/reserve behavior from
   [resource-runtime-20260919.md](resource-runtime-20260919.md).
4. `0x41c5c0`: POOP forces owner 8 and registers its coordinate FIFO at
   `0x440410`. With `s(6,0)<=0` and loader local `[ebp-0x14]!=0`, it is skipped
   entirely. A later ordinary row at a registered coordinate can enter the
   FIFO at `0x4404c0` instead of creating a new entity.
5. `0x41c63b`: non-0/non-3 game mode can reserve an ordinary slot without
   constructing an entity for a disabled team. The separate mode-1 fixture
   proves zero plane writes. Do not manufacture a placeholder footprint.

Reuse [scenario-placement-runtime.md](scenario-placement-runtime.md) for full
source slot and nonentity projection; this audit does not replace it.

`reinforce` task 21 and `reinforce2` both reach allocator `0x41b634`, directly
or after transport/FIFO handling. Its search `0x41b4a0` chooses a destination
using the movement byte: ground requires actual PTH family byte `+0xc` nonzero
and vacant ground ID; flying checks vacant air ID. It does not search the
auxiliary plane even for mines. Type 40 bypasses this search. The allocator
then calls the same constructor at `0x41b740`, with no second footprint rule.
The 23 static action groups execute this allocator with their original operands
and PTH contents. Delivery timing and queue scheduling reuse
[transport-decoding.md](transport-decoding.md), not a new formation algorithm.

Both `newtype` occurrences are HUMAN01's BEEK 95 -> BEAC 84. Original handler
`0x43e0fe..0x43e189` changes only entity byte `+6`; it does not re-register or
clear any plane. Both types have zero movement/auxiliary fields, so their
existing ground cell remains. The prior original-instruction fixtures in
[trigger-runtime.md](trigger-runtime.md) establish this path; it is not redone
or replaced by constructor registration here.

## Removal Is A Separate Contract

At `0x434d56`, IDs below 120 dispatch to colony removal `0x4453a8`. Other IDs
use the unsigned position words shifted right eight, then scan:

```text
x = centerX-1 .. centerX+1, skipping outside actual map width
  y = centerY-1 .. centerY+1, skipping outside actual map height
    ground, then air, then auxiliary
    if (cell & 1023) == slot: cell |= 1023; return immediately
```

The writes are `0x434e3a`, `0x434e71`, `0x434ea2`. They preserve high bits.
The first match wins even if duplicate IDs remain elsewhere. No match reaches
the native diagnostic at `0x434ebb`; the pure helper throws instead of inventing
successful cleanup. Owner-8 POOP/VENT objects with no registered cell reach this
diagnostic if this generic removal routine is incorrectly called on them.
Resource depletion's MAP-flag clear belongs to its separate resource lifecycle.

The status byte is not a predicate in this scan: native cases with status
0, 1 and 10 produce the same cell result. Twenty-seven fixtures cover all three
planes, three offsets and those three states; another proves X-before-Y ordering
and first-match-only behavior. Corner fixtures prove map clipping. Thus removing
a static object is not "clear its current rectangle" and is not automatically
equivalent to changing status or removing its rendered sprite.

The original sound pre-call `0x431da8` executes; test ground bit 31 is clear so
it does not enter the audio backend. This audit certifies grid cleanup, not
sound output, death animations, slot release, statistics, or their host timing.

## Auxiliary Reader Evidence

These are bounded native reader/control-flow observations, not inferred from
filename sizes alone. Reproduce with `--auxiliary --executable NAME` and
`--disassemble START END` on the research script.

- DC.EXE: `0x43a893..0x43a8e5` opens extension `ovh`, reads exactly `0x3f00`
  bytes into the caller's overview buffer, or generates/writes that buffer when
  absent. The following `0x43a8ea..0x43a973` constructs a 96x84 table of pointers
  **to** ground cells. It does not copy image bytes into occupancy. X is
  `trunc(mapWidth*overviewX/96)`; Y is `height-1-trunc(height*overviewY/84)`.
- DC16.EXE: `0x404f9e..0x404fa8` registers strings `ovh` at `0x4824d0` and
  `o16` at `0x4824cc` through the extension mapping routine `0x405d20`.
  Its corresponding reader at `0x43ac17..0x43ac7f` requests `ovh` through that
  mapping, reads `0x7e00` bytes into its overview buffer, then calls color
  conversion `0x43ab00`. `0x43ac84..0x43acff` constructs the same ground-pointer
  lookup. The O16 companion is the 16-bit-color overview path, not an object
  collision layer. Neither overview reader supplies the constructor's cells.
- Binary DESERT.SET/JUNGLE.SET belong to MAPED: its reader at `0x41133e` reads
  a count, `0x41134e` reads `count*0xc8c` bytes, then `0x4113cf` switches to BTS
  and calls its separate reader. Reuse [terrain-decoding.md](terrain-decoding.md)
  for this exact evidence. Internal editor records remain unclaimed; they are
  not inputs to the proved SCN constructor occupancy path.
- COLOUR.SET is the third SET, distinct from those editor banks. DC16 has its
  own reference at `0x44f6b8`; indexed-color behavior is separately documented in
  [palette-runtime.md](palette-runtime.md). No color-table bytes are read by
  the registration/cleanup branches above.

## Probe Boundaries And Host Contract

This is original-instruction emulation, not an original-game boot. SCN scanner,
constructor, task initialization, registration, allocator and removal execute
without substituting the occupancy routines. GAMESTAT integer scanner argument
destinations are reused from the existing harness; its ASCII assignment boundary
is explicit there. Animation pointers are fixture defaults, not loaded FINs.

Each fixture uses real MAP dimensions, source PTH prefix and 24-byte native
family records, and actual vertically mapped MTG high bits. MAP attributes are
retained with sentinel low tile-reference bits; this does not emulate BTS
rendering. Ground/auxiliary planes have tagged vacancy sentinels, not a full
colony-initialized game world. The capture records **every write**, including
same-value writes, throughout the allocated MAP/ground/air/auxiliary planes.
For SCN static rows, cleanup is run and the registered cell restored before the
next source row. The allocator fixtures start with vacant planes and isolate one
actual reinforcement group; transport scheduling is not simulated.

Host integration must supply effective owner/type fields, native slot identity
and actual dimensions; distinguish metadata/FIFO/resource/colony dispatch;
apply the single registered cell to the correct plane; preserve high flags;
and consume lifecycle removal separately. A one-cell air/auxiliary registration
must not become a ground pathfinding blocker. Do not re-register on newtype or
clear the resource MAP flag through generic occupancy cleanup.

Verified: final complete native report exits 0; all three focused TypeScript
tests pass with **zero skips**, including all SCN/constructor/reinforcement
traces and source hashes; isolated strict TypeScript check passes. No agents,
browser session, full suite, shared-file integration or exporter run was used.
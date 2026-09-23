# Navigation source investigation

Investigated 2026-09-18. Scope: ground infantry only. This is an executable
evidence ledger, not a runtime navigation contract. **Partial verification;
no walkable-cost decoder exported.** The owned `navigation.ts` was deliberately
not created. No existing extractor, generated asset, or runtime was changed.

## Executable identity

DC.EXE SHA-256:
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
All addresses are x86-32 virtual addresses. Code file offsets are
`VA - 0x400c00`; DGROUP string offsets are `VA - 0x402400`.

## PTH load

- `0x442bee`: references the `pth` extension at `0x476e54`.
- `0x442bfa`: destination is `context + 0x870a4`.
- `0x442c00`: read length is `0x10000` bytes; read call at `0x442c0c`.
- `0x442cf3`: reads one byte per source cell.
- `0x442d04`: stores that byte at offset `0x0c` in a 24-byte cell record.
- `0x442c2c`, `0x442c3a`, `0x442c5a`, `0x442c71`: surrounding border
  records receive `0xff` in the same field.
- `0x442def` through `0x442e03`: prefix lookup uses
  `context[0x870a4 + (row << 8) + column]`. The surrounding loops use row
  and column values 1 through 254 and collect distinct nonzero results into
  per-row lists at `context + 0x970a4` (32-byte stride).

The caller at `0x4539d9` passes `map + 0x1404` as the path context.
PTH bytes after the prefix are loaded in source row order, without a Y flip.

### Verified consumer: families and next-family routes

At `0x444989` and `0x4449a4`, the path routine reads the source and destination
cell fields at offset `0x0c`. Assertions at `0x4449b4` and `0x444a12` name
these `current_family` and `destination_family`, respectively. Their strings
are at `0x476ee4` and `0x476ef8`; `path.c` is at `0x476e6c`.

At `0x444a72` through `0x444a79`, it computes:

```text
currentFamily = prefix[(currentFamily << 8) + destinationFamily]
```

It marks visited families in the byte mask at `0x4fe65c` (`0x444af6`) and
repeats until the destination (`0x444afc`) or 256 iterations (`0x444ae8`).
A zero next-family value reaches the assertion with the text
`There is no path` at `0x476f10`. Thus the prefix is a **256 by 256 next-family
routing table**, and the remaining bytes are **cell family IDs**, not costs.
The table's numeric IDs are not terrain types or relative movement weights.

The local search setup at `0x444540` fills the family mask with `0xff`
(`0x444558` through `0x44456e`). For a zero mode argument it disables family
0 (`0x444573` through `0x44457a`); it always disables family 255
(`0x444583` through `0x444587`). A nonzero mode keeps family 0 enabled.
The collision setup uses the same mode to choose the ground or flying grid;
the grid identities are independently named by the integrity assertions below.

Neighbor expansion at `0x443344` and `0x443353` reads a neighbor's family and
looks it up in that mask. With occupancy filtering enabled (`0x443439`),
ground neighbors also require `(groundCell & 0x3ff) == 0x3ff`, for example
`0x443483` through `0x443496`. This establishes the local eligibility test,
not a complete movement implementation or a terrain-cost equation.

## Separate collision grids

Pointers below are offsets from the map object, not the nested path context:

| Offset | Use |
| --- | --- |
| `+0x004` | MAP packed cells in file row order; four-byte cells. |
| `+0x404` | Reversed row pointers into the same packed MAP cells. |
| `+0x804` | Ground runtime grid; four-byte cells. |
| `+0xc04` | Flying occupancy plus MTG tags; two-byte cells. |
| `+0x1004` | Additional word grid; meaning not resolved here. |

The row-pointer setup is at `0x453436` through `0x4534b6`. In particular,
`+0x404` row `runtimeY` addresses MAP source row `height - 1 - runtimeY`.
Do not confuse MAP's packed tile indices with the ground occupancy IDs:
they are different allocations and their low bits have different meanings.

`0x445570` initializes every ground dword to `0x3ff` (`0x44558d`,
`0x4455a3`); it does not derive that value from MAP attributes. It ORs
`0x3ff` into the two word grids, preserving their upper six bits
(`0x4455c7`, `0x4455ee`).

`0x4352d8` checks grid integrity. It masks ground entries with `0x3ff`
(`0x435320`) and checks all values other than `0x3ff` and `0x3fe` against
object records. The corresponding flying check is at `0x435431`.
Assertion strings at `0x475f60` and `0x475fdc` explicitly distinguish the
ordinary and flying collision grids. Object records have stride 220 bytes
at `gameState + 0x7d28`; state byte `+0x2c` must not be dead (0) or rotting (10).
The full meaning of reserved ID `0x3fe` is not established.

`0x4152f3` through `0x415301` passes the two grids to `0x443250`.
That function stores their pointers at `0x4fe784` and `0x4fe78c`, stores
the mode at `0x47a9b0`, and enables occupancy checks through `0x47a9ac`.
The caller temporarily clears the destination's occupancy
(`0x415295` through `0x4152cb`), runs the local path search at `0x415321`,
then restores occupancy (`0x415326` onward). Consequently a single immutable
source-array cost plane is not equivalent to all original path queries.

## MTG load

- `0x4537fb`: references the `mtg` extension at `0x477e80`.
- `0x45380f`, `0x453881`: reads byte-sized dimensions and compares them
  with MAP dimensions at context offsets `0x9a4b0` and `0x9a4b4`.
- `0x45391a`, `0x45391f`, `0x453922`: reads a byte, shifts left ten,
  and retains the low 16 bits.
- `0x453989` through `0x4539a5`: stores this word in the row-pointer
  table at context offset `0xc00`, indexed by `height - sourceY`, then
  by `2 * sourceX` within the row.

Because the regular word-row table begins at `+0xc04`, the loader's
`+0xc00 + 4*(height - sourceY)` is precisely runtime row
`height - 1 - sourceY`. The loaded word is `(tag << 10) & 0xffff`.

At `0x415e56` through `0x415e63`, a movement-side consumer reads the word
from `+0xc04` and shifts it right ten. A nonzero tag calls `0x43e530`
at `0x415e6e`; zero bypasses the call. The downstream handler is not audited
here. This is not evidence for assigning the MTG byte as a movement cost,
nor proof that tags can be ignored in all gameplay.

## Static Footprints

The verified building collision path uses a constant table at VA
`0x47abe8` (file offset `0x787e8`): 15 records of 64 bytes, each containing
eight pairs of signed little-endian 32-bit offsets. These are grid offsets,
not sprite bounding boxes. Raw records:

| Slot | First four pairs | Remaining four pairs |
| --- | --- | --- |
| 0 | `(-3,0) (-2,0) (-3,1) (-2,1)` | `(-2,1)` repeated |
| 1 | `(-1,-1) (0,-1) (-1,-2) (0,-2)` | `(0,-2)` repeated |
| 2 | `(0,2) (1,2) (0,3) (1,3)` | `(1,3)` repeated |
| 3 | `(1,0) (2,0) (1,1) (2,1)` | `(2,1)` repeated |
| 4 | `(-1,2) (-1,3) (-2,2) (-2,3)` | `(-2,3)` repeated |
| 5 through 12 | `(0,0) (-1,0) (-1,-1) (0,-1)` | `(0,0)` repeated |
| 13 and 14 | `(0,0)` repeated | `(0,0)` repeated |

Insertion at `0x445237` computes `64*slot + 8*entry`, loads the pair
at `0x44524b` and `0x445259`, and adds base coordinates from the current
record's `+0x2c` and `+0x30`. It stops at eight entries or when the current
coordinate repeats the **immediately previous** coordinate (`0x445267`
through `0x445274`). Do not substitute a bounding rectangle or an arbitrary
unique-coordinate termination rule. The conditional at `0x445136` through
`0x445139` bypasses insertion when ECX is 5 after the call to `0x41822c`;
its source-level building-kind mapping has not been verified here.

For each inserted cell, `0x4452a6` asserts MAP packed bit 31 is set, using
the explicitly reversed source row. The assertion text at `0x476ffc` is:

```text
gs->map->load[gs->map->ysize-1-zs][xs]&0x80000000
```

This bit originates from MAP attribute bit 9 (`0x0200 << 22`). It is a
verified requirement on this **building insertion path**, not a universal
infantry walkability flag. Insertion accepts occupancy `0x3ff` or `0x3fe`
(`0x445330` through `0x445348`), clears the low ten bits (`0x44520d` through
`0x445216`), then ORs in the object ID (`0x445227`).

Removal is `0x4453a8`. It divides the object ID by 15: the quotient selects
the side record with stride `0xe30`, the remainder selects the footprint.
Base coordinates are at `gameState + side*0xe30 + 0xbc4/+0xbc8`.
It verifies each cell holds that object ID (`0x445499` through `0x4454a0`)
and ORs `0x3ff` into its low word (`0x44540e`). The caller at `0x434d56`
dispatches IDs below `0x78` to this building removal; other IDs take another
path. This does not establish collision for every neutral/static scenario entity.

## Corpus Checks

The tests independently inspect the source files, not generated outputs.
All 108 MAP/MTG/PTH triples parse, covering 1,345,872 cells. Exact results:

- 416,598 cells have PTH family 0; 929,274 have nonzero families.
- The observed nonzero family IDs are exactly 9 through 250. These numeric
  ranges are corpus observations, not rules to hard-code in a decoder.
- Every nonzero route between distinct nonzero families present in a map
  reaches its destination: 6,246,720 routes, no cycles or zero intermediate
  families, maximum 89 hops. Zero table entries and absent-family pairs are
  not claimed as reachable or covered by this routing check.
- Raw PTH prefix/cell arrays and MTG payloads match the existing parser
  byte-for-byte; attribute words are checked against raw MAP offsets.
- With MAP rows flipped into PTH/runtime coordinates, the following
  counterexample disproves a complete bit-9-only rule:

| MAP attribute bit 9 | Family 0 | Nonzero family |
| --- | ---: | ---: |
| Clear | 95,157 | 929,274 |
| Set | 321,441 | 0 |

The counterexample bounds a claim; it does **not** infer the missing rule
from correlations. No other attribute bits are assigned collision names.

## Blocker and Next Addresses

A pure decoder producing exact infantry walkable costs is withheld because:

1. The full infantry caller/step predicate is not closed. `0x4150a4` calls
   the family-routing routine `0x44492c`; `0x415321` calls local search
   `0x444540`. Their mode selection and later movement checks must be traced
   from the infantry unit definition. MAP bit 9 alone is demonstrably
   insufficient; no alternative attribute formula is established.
2. Costs and diagonal/corner behavior are not established. Expansion starts
   at `0x443298`; directional values are read from `0x47a9b4` at `0x44332d`,
   and accumulated through the routine's neighbor branches. Translating
   those into per-cell costs of 1, PTH IDs, MTG bytes, or attribute-derived
   weights would be an unsupported replacement algorithm.
3. The building footprint machine code is known, but source scenario entity
   types/coordinates are not fully mapped to its side/slot/base fields or
   its bypass branch. IDs outside the building range need their own insertion
   trace. Sprite size is not evidence of collision geometry.
4. MTG's nonzero-tag handler at `0x43e530` and its effect on movement remain
   outside the verified chain. The file cannot simply be called a cost grid.

These are missing semantic links, not a lack of disassembly tooling. No
speculative `navigation.ts`, runtime integration, or regenerated outputs remain.

## Reproduce

From the repository root:

```sh
node --import tsx --test tools/extractors/maps/navigation.test.ts
```

Result: three tests passed, zero skipped. Tests pin the executable SHA-256,
30 instruction byte anchors, five assertion strings, all 15 raw footprint
records, and the full-corpus checks above. Byte anchors protect provenance;
they do not replace control-flow analysis or executing the original game.

Raw disassembly used the already installed Capstone package in
`/tmp/dc-re-capstone-20260918`. For example:

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918 python3 - <<'PY'
from pathlib import Path
from capstone import Cs, CS_ARCH_X86, CS_MODE_32
binary = Path('raw_cd/DC/DC.EXE').read_bytes()
decoder = Cs(CS_ARCH_X86, CS_MODE_32)
for start, end in [(0x442b7c, 0x442e57), (0x44492c, 0x444b92),
                   (0x443298, 0x443940), (0x445237, 0x445353),
                   (0x4453a8, 0x445560), (0x445570, 0x4455fd)]:
    for instruction in decoder.disasm(binary[start-0x400c00:end-0x400c00], start):
        print(hex(instruction.address), instruction.bytes.hex(),
              instruction.mnemonic, instruction.op_str)
PY
```

If that temporary installation is absent, install Capstone into a temporary
directory and point `PYTHONPATH` there. Decode from known instruction starts:
the code section also contains data tables, and arbitrary offsets can yield
plausible but meaningless instructions. No original Windows execution was
performed; this evidence is static disassembly plus source-corpus verification.

## Infantry Caller Follow-Through (2026-09-18)

This addendum closes the **TRSC/GRAY mode selection and coordinate links**
left open above. The earlier refusal to export exact source costs still
stands. A minimal source-family eligibility mask is now exported from
`src/engine/legacy-navigation.ts`; no existing runtime, extractor, or generated
asset was changed. This is static executable analysis, not original Windows
game execution.

### Source Column to Both Path Callers

The movement selector is **numeric column 13 after the sprite token**, or
`parseUnitStats(...)[type].rawTail[2]`. It is **not `rawTail[0]`**.

| Executable anchor | Data flow |
| --- | --- |
| `0x43bac7` | Opens `gamestat/gamestat.txt` via the string at `0x4766f8`. |
| `0x43bb7b` through `0x43bb91` | Computes definition base `0x4f1880 + 280 * recordIndex`. |
| `0x43bc5c`, `0x43bcbb`, `0x43bccc` | Pushes local `[ebp-0x18]` as numeric destination 13 and scans with `%s` followed by 32 `%d` conversions (format at `0x476734`). |
| `0x43bd08` through `0x43bd0e` | Copies the low byte of that local to definition `+0x60`, hence `0x4f18e0 + 280 * type`. |
| `0x41b1cb`, `0x41b1ce` | Unit construction writes the supplied type into entity byte `+6`. |
| `0x414d39`, `0x414d4a`, `0x414d54` | Family-route caller reads entity type, loads the definition byte, saves it at `[ebp-8]`. |
| `0x415086` through `0x4150a4` | Sign-extends that saved byte via the overlapping dword load/shift and passes it to `0x44492c`. |
| `0x4151d0`, `0x4151e8`, `0x4151f2` | Local-search caller reads the same definition byte and saves it at `[ebp-4]`. |
| `0x4152d1` through `0x415301` | Sign-extends the saved byte, retains it at `[ebp-0x28]`, and passes it to collision setup `0x443250`. |
| `0x415306` through `0x415321` | Reloads that retained mode and passes it to local search `0x444540`. |

Counting scan destinations in source order, the first twelve numeric fields
target definition offsets `04,08,0c,14,10,18,1c,20,28,2c,40,44` (hex).
The thirteenth targets the local later copied to `+60`. Thus the loader,
not a comment or source-value correlation, establishes the column link.
The two path calls are separate callers; `0x4150a4` calls `0x44492c`, not
`0x444540` directly.

Actual source records:

| Type | Sprite | `rawTail[0]` | `rawTail[2]` / mode |
| --- | --- | ---: | ---: |
| 0 | TRSC | 0 | 0 |
| 8 | GRAY | 0 | 0 |
| 2 | REAP | 1 | 0 |
| 5 | SCGM | 2 | 1 |

REAP and SCGM are discriminating checks against using the first tail value.
For TRSC and GRAY, mode zero reaches the already established local mask:
family 0 disabled, family 255 disabled, all other family IDs initially enabled
(`0x444558` through `0x444587`). The neighbor family lookup at `0x443344` /
`0x443353` consumes that mask. This proves the **family eligibility component**,
not that every eligible cell can be entered under every game state.

### SCN, Runtime, and Terrain Y

SCN placement coordinates and PTH cell coordinates are already in the same
runtime grid. **Do not flip SCN Y or PTH payload rows to align those two.**
To align raw MAP terrain rows with them, use `terrainY = height - 1 - runtimeY`.

1. At `0x41c47b` through `0x41c4a4`, the placement reader scans six `%d`
  fields (format `0x473a04`). The first two go to `[ebp-0x60]` and
  `[ebp-0x5c]`; the third is the type at `[ebp-0x58]`.
2. Ordinary placement calls at `0x41c678` and `0x41c697` pass those first
  two locals unchanged as EDX/X and EBX/Y to `0x41af14`. The constructor
  saves them at `[ebp-4]` and `[ebp-8]` (`0x41af1e`, `0x41af21`).
3. `0x41b184` through `0x41b1b5` writes `(X << 8) + 0x80` to entity word
  `+0` and `(Y << 8) + 0x80` to word `+4`. No height subtraction occurs.
4. The local caller reads these unsigned words at `0x4151cd` / `0x4151d3`
  and shifts right eight at `0x4151e5` / `0x4151ef`. The family-route
  caller does the same at `0x414db6` through `0x414dd0`.
5. PTH loading starts Y and X at zero (`0x442c78`, `0x442c83`), stores
  those coordinates in cell bytes `+8/+9` (`0x442cd8`, `0x442ce2`), reads
  consecutive family bytes (`0x442cf3`, `0x442d04`), and increments X then
  Y (`0x442d03`, `0x442d0c`). Its family-255 border is outside the payload,
  at X=-1/width and Y=-1/height, not a replacement of the edge cells.
6. MAP row-pointer setup computes `height - runtimeY - 1` (`0x45344c`,
  `0x453452`, `0x45345a`) and stores that terrain row at map `+0x404`
  (`0x453466`). Ground runtime row pointers at `+0x804` remain increasing
  (`0x45346d` through `0x453481`).

For a runtime cell `(x,y)`, the source-array contract is therefore:

```text
SCN position       = (x, y)
PTH family index   = y * width + x
MAP terrain index = (height - 1 - y) * width + x
MTG tag index     = (height - 1 - y) * width + x
```

The MTG formula follows the previously audited loader, not a new cost claim.
Reverse MAP **rows of cells**, retaining each cell's tile-reference order.
If a renderer intentionally keeps raw MAP row order, it must transform all
runtime positions for display instead; do not silently mix both conventions.

### Exported API and Limits

```ts
interface LegacyNavigationSource {
  readonly width: number;
  readonly height: number;
  readonly pathGrid: Uint8Array;
}

function createLegacyInfantryFamilyMask(source: LegacyNavigationSource): Uint8Array;
```

Accepts the existing parsed bundle structurally. Dimensions must be integers
from 1 through 255, and `pathGrid.length` must equal width times height.
Returns a fresh array in PTH/runtime row order: 0 for families 0/255, 1 for
families 1..254. The output is an eligibility bit, **not a decoded source
cost**; neither input families nor their numeric magnitudes become weights.
All IDs are handled by the verified predicate, not the corpus's observed range.

The QA adapter uses `Uint16Array.from(mask)` with `NavigationGrid` and
`findPath`. **Cost 1 and four-neighbor Manhattan A* are browser policy only**.
No original path optimality, costs, diagonals, corner behavior, occupancy,
building footprints, trigger effects, or family-route optimization is claimed.
Keep dynamic collision and other movement checks separate. No runtime
integration or barrel export was added.

### Actual Mission Checks

Both fixtures are 96 by 84. Tests parse the raw SCN/MAP/MTG/PTH files, pin
the two SCN hashes and executable identity, and inspect all type-0/type-8
placements without clamping or substituting reinforcement formations.

| Fixture | Infantry placements | Blocked if PTH is wrongly flipped | Browser-policy route | Cells including endpoints |
| --- | ---: | ---: | --- | ---: |
| HUMAN01 | 30 GRAY | 11 | `(41,12) -> (40,14)` | 4 |
| ALIEN01 | 32 TRSC | 13 | `(49,72) -> (40,70)` | 12 |

The HUMAN01 route is the first leg of the actual initial TRO waypoint
`waypoint 41 12 2 40 14 41 12`; its origin is an SCN placement. The ALIEN01
route joins two actual SCN placements as a QA query, not a claimed source
order. Every route cell is family-eligible and every step is cardinal.
All 62 unflipped placements pass; their terrain cells are addressed using
the row-reversal formula above. The checked attribute-bit observation does
not replace the family predicate or revive the disproved bit-9-only rule.

Reproduce from the repository root:

```sh
node --import tsx --test tools/qa/legacy-navigation.test.ts
PYTHONPATH=/tmp/dc-re-capstone-20260918 python3 tools/research/trigger-audit.py disasm 0x43bb7b 0x43bd11
PYTHONPATH=/tmp/dc-re-capstone-20260918 python3 tools/research/trigger-audit.py disasm 0x414ce4 0x4150a9
PYTHONPATH=/tmp/dc-re-capstone-20260918 python3 tools/research/trigger-audit.py disasm 0x41518c 0x415326
PYTHONPATH=/tmp/dc-re-capstone-20260918 python3 tools/research/trigger-audit.py disasm 0x41c438 0x41c6b4
PYTHONPATH=/tmp/dc-re-capstone-20260918 python3 tools/research/trigger-audit.py disasm 0x41af14 0x41b1d7
PYTHONPATH=/tmp/dc-re-capstone-20260918 python3 tools/research/trigger-audit.py disasm 0x442b7c 0x442d12
PYTHONPATH=/tmp/dc-re-capstone-20260918 python3 tools/research/trigger-audit.py disasm 0x453436 0x4534bd
```

Five focused tests pass with no skips. They cover loader/caller/coordinate
instruction anchors, scan formats, the source-column counterexamples, all
256 family IDs, malformed dimensions/payloads, asymmetric row order, and
the actual mission placements/routes. Byte anchors preserve the audited
binary provenance; the control-flow analysis above supplies their meaning.
# Native Palette Initialization

Status: verified pure DESERT initialization and lookup inputs; not live renderer
integration or phase acceptance. Owned files: this document,
`tools/research/palette-init.py`, `src/render/palette-init.ts`, and
`tools/qa/palette-init.test.ts`. No main/view, existing palette module, shared
extractor, browser, or agent was changed or used.

DC.EXE SHA-256:
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
This extends [palette-runtime.md](palette-runtime.md), using the corrected
[SCN field order](scenario-team-fields.md) and the
[FIN composition boundary](render-composition.md).

## Team Selector Is Closed

SCN parsing stores the scalar preceding `%TeamColour` at
`game + team*0xe30 + 0xc98` (`0x41be65`). Signed values outside 0..7 fall
back to the native team index (`0x41be6b` through `0x41be77`). Dependencies
are not color maps. Disabled slots still have their own declared color.

The render consumer at `0x439909` selects entity byte `+8`; exactly 8 means
use owner byte `+7`. It masks the selected byte with 7, then loads that
same `+0xc98` field. Masking happens **after** the sentinel check: override
24 selects team 0, not the owner. The FIN queue at `0x436094` combines it
with brightness. At `0x43628e`/`0x4362a4`, frame setup explicitly resets
the FIN brightness global `0x47966c` to 16.

```text
team = (overrideByte == 8 ? ownerByte : overrideByte) & 7
selector = scenarioTeam[team].validatedColor
FIN mode 0: bank = 2; row = 128 + selector
```

| Mission | Native Team Slots | FIN Rows | Uniformly Visible Terrain Row |
| --- | --- | --- | --- |
| HUMAN01 | 0,1 -> 0; 2,3,4 -> 2; 5 -> 5; 6 -> 6; 7 -> 7 | 128,128,130,130,130,133,134,135 | 128 |
| ALIEN01 | 0 -> 2; 1 -> 7; 2..7 -> same number | 130,135,130,131,132,133,134,135 | 135 |

These are source team IDs, not browser player/enemy IDs or race IDs. Preserve
the SCN owner on each entity; do not substitute a two-side simulation ID.
This closes SCN initialization, not every multiplayer/runtime color mutation.

## Terrain And Day/Night

Terrain does **not** use the entity team-color selector. At `0x40ac6f`,
the caller reads `game+0x540`, then `0x40ac75` through `0x40ac8b` computes
`variant = trunc(7 * blend / 256)`. The intervening helper `0x439f50`
returns a flag in AL but preserves the variant in EDX. The caller pushes
EDX at `0x40acbc`; `0x4362af`/`0x4362b7` forwards it to terrain drawing.
At `0x453bce`, the terrain lookup rows preserve their high five bits and
replace the low three with this variant.

The SCN scalar phase, cycle length, elapsed ticks, and transition ticks store
at `+0x53c`, `+0x534`, `+0x530`, and `+0x538`, respectively
(`0x41bc55`, `0x41bc79`, `0x41bc9d`, `0x41bcca`). Startup initializes
`blend = phase << 8` at `0x41bcd0` through `0x41bce2`.

- HUMAN01: phase 0, cycle 6750, elapsed 1500, transition 75; blend 0,
  terrain variant 0 (the neutral/desaturation-free endpoint).
- ALIEN01: phase 1, cycle 6750, elapsed 450, transition 75; blend 256,
  terrain variant 7. Do not initialize both campaigns identically.

The update slice `0x419990` through `0x419a28` flips phase and resets
elapsed to zero only when `elapsed > cycleLength`, not on equality.
While `elapsed <= transitionTicks`, let
`fraction = trunc(elapsed * 256 / transitionTicks)`; phase 0 writes
`256 - fraction`, phase 1 writes `fraction`. Otherwise it retains the
previous blend. Native clock cadence and the elapsed-counter increment
are not implemented by the new helper. It initializes loader state only.
The existing browser's synthetic day/night clock is not evidence of this
native state. No extra whole-image RGB darkening multiplier is established.

Terrain visibility samples start at **16** (`0x453cef`/`0x453cff`), become
**10** when the current visibility mask does not intersect the cell
(`0x453d62`), and become **0** when cell bit 31 is clear (`0x453d79`).
The ignore-fog flag bypasses these reductions. Neighbors are averaged and
interpolated: the native 17*17*32 table generator at `0x453a56` computes
`floor((end*pixel + start*(31-pixel))/31) << 3` for pixel 0..31.
Uniform visible neighbors therefore give row `128 + variant`; remembered
interiors give `80 + variant`. Mixed fog boundaries need spatial rows, not
a single whole-map brightness. `terrainInterpolatedRow` implements one
native table segment, not the entire neighborhood assembly.

## Display Palette And Source Indices

The registered loader `0x42bcac` passes one basename to GIF, RGB and RMP
loading (`0x42bd1c`, `0x42bd42`, `0x42bd4f`). For the DESERT contract use
the exact resources listed by `--contract`, not PALETTE.GIF or a preview atlas.
The caller of `initializeDesertMissionPalette` must provide those bytes;
the pure helper validates their layout, not file provenance or SHA-256.

1. Read the GIF global color table at byte 13, 768 RGB8 bytes. Native forces
   index 0 to black and index 255 to white (`0x44e9f2`).
2. Native copies palette storage `+1` to active storage `+0x301`, unchanged
   (`0x42bd21` through `0x42bd30`). No six-bit expansion occurs here.
3. The DirectDraw installer `0x42f370` initializes all 256 index-map entries
   at `+0x601` to identity. It copies RGB8 to DirectDraw entries and sets
   their fourth byte to **4, a palette flag, not alpha** (`0x42f3af`).
4. RGB loading translates cube outputs through that identity map. RMP
   loading preserves its bytes. Do not translate RMP outputs again.

SPR loader `0x44fa98` reads its 768 embedded palette bytes into a temporary
buffer at `0x44fb13`/`0x44fb20`. Raw raster reads at `0x44fc21` and compressed
payload reads at `0x44fd17` retain their original index bytes. There is no
embedded-SPR-RGB -> nearest-active-GIF-color conversion in this path.
BTS likewise retains raster bytes; see [terrain-transforms.md](terrain-transforms.md).

```text
outputIndex = DESERT.RMP[bank*65536 + row*256 + decodedSourceIndex]
displayRGB = nativeDESERTGifPalette[outputIndex*3 .. outputIndex*3+3]
```

## Coverage Is Not Palette Alpha

The current shared [terrain atlas](../tools/extractors/maps/atlas.ts) assigns
alpha zero to source index 0, including background tiles. That is incorrect
for a native background layer. It is intentionally not edited here.

| Source | Coverage Contract |
| --- | --- |
| BTS background | Opaque, including source index 0. |
| BTS foreground | Source zero leaves background visible; retain source-order mask and native mirror rules. |
| Raw SPR | Source zero is transparent. |
| Compressed SPR | Use decoded run coverage: skips transparent, literals covered, including literal zero. |

Never derive alpha from the **remapped output** index. A covered pixel mapped
to black must remain opaque. The native background blitter (dispatch slot at
`0x47c040`) writes zero-index pixels. The compressed literal writer at
`0x4658b9` also writes source zero through bank 2; it does not skip it.

## Deterministic GPU Extraction Contract

`palette-init.py --contract` prints sorted-key JSON with the executable and
six source-resource hashes, all eight team slots for each first mission,
initial bank/row values, palette layout and coverage policy. It writes no
assets. The shared extraction owner should publish:

| Asset | Exact Payload / Metadata |
| --- | --- |
| DESERT display palette | 768 RGB8 bytes from GIF global table with native endpoint overrides. GPU `RGB8UI`, 256x1, matching the existing indexed renderer. |
| DESERT RMP | All 196608 original bytes; `R8UI`, 256x768, Y=`bank*256+row`. No transpose or pretranslation. |
| DESERT BTS index atlas | Original 1024 raster bytes per record, packed in source order; `R8UI`. Retain recordIndex, key, atlas rectangle and the MAP key-to-record resolution. Do not recover indices from RGBA. |
| BTS layer coverage | Background opaque; foreground source-zero mask. Separate coverage texture or layer policy, never one transparent RGBA atlas reused for both layers. |
| Every referenced FIN child SPR | Original decoded indices plus decoder alpha/run-coverage bytes in matching atlas rectangles. Retain frame dimensions, anchorX, anchorY, empty frames, and FIN child/mode/mirror metadata. Include effects' referenced SPRs, not just TRSC/GRAY bodies. |
| Mission palette metadata | Original SCN team index and scalar color for all eight slots; initial phase and native cycle fields; entity owner and override where known. Never infer owner from race. |
| Optional DESERT RGB | 32768 bytes for native RGB555 quantization; not needed for indexed terrain/FIN lookup. |

Use nearest integer sampling, no mipmaps, `UNPACK_ALIGNMENT=1`, no color
conversion or premultiplication of index/coverage/table bytes. Preserve
top-to-bottom source row order. Existing [indexed-webgl.ts](../src/render/indexed-webgl.ts)
already separates coverage and RGB tables. The new helper returns compatible
lookup objects but is deliberately not wired into views.

## Verification And Limits

```sh
node --import tsx --test tools/qa/palette-init.test.ts
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 tools/research/palette-init.py --probe
PYTHONPATH=/tmp/dc-re-capstone-20260918 \
  python3 tools/research/palette-init.py --contract
```

Native execution covers signed SCN fallback, all 65536 owner/override byte
pairs, both initial phase endpoints, all 257 terrain variants, all 9248
interpolation bytes, visibility branches, cycle transition boundaries,
the actual GIF-to-active copy/DirectDraw packing, 4096 DESERT background
pixels including zero, and FIN bank-2 literal writes for all eight selectors.
TypeScript tests pin resource/executable hashes and check both mission
initializations, all team slots, invalid inputs and coverage through the
existing CPU lookup adapter. No browser or GPU visual acceptance is claimed.

Remaining integration: indexed asset publication, actual source owner bytes,
spatial fog-row assembly, original time progression, palette cycling and
complete FIN effect/shadow composition. This does not establish DC16,
short multiplayer RMP layout, every palette mutation, or unsupported FIN
modes. Do not replace an unknown mode with a guessed bank/brightness.
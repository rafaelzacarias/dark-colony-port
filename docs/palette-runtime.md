# Native Indexed Palette Contract

Status: verified lookup layer, not renderer integration or phase acceptance.
Only the four palette-owned files were changed. No browser or subagent was used.

## Evidence Boundary

The audit pins the 32-bit x86 PE executable `raw_cd/DC/DC.EXE` to SHA-256
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
This is not a Win16 executable. DC16.EXE is not covered by these results.

The executable's loader passes the same basename to GIF, RGB, and RMP loading
at `0x42bd1c`, `0x42bd42`, and `0x42bd4f`. Thus pairing these three resources
is evidenced by calls, not by interpreting names such as DESERT or HTRAIN.
The file extensions are separate strings: `gif` at `0x477748`, `rgb` at
`0x477874`, and `rmp` at `0x47789c`.

| Resource | Verified Meaning |
| --- | --- |
| GIF global color table | Active RGB8 palette; native forces index 0 to black and the last entry to white. The supplied runtime parser requires 256 entries. |
| RGB, 32,768 bytes | RGB555 cube to palette-index lookup, not an image or embedded RGB triplets. |
| RMP, 196,608 bytes | Three 65,536-byte index-remapping banks, each 256 rows of 256 output indices. Not three color channels. |
| SPR/BTS embedded palette | Read by the inspected loaders, but not used to recolor their raster data in these paths. Existing 6-bit-scaled preview atlases are not proof of native display colors. |

All 21 RGB files have the expected size. Twenty RMP files have the standard
layout. `raw_cd/DC/SCENARIO/MPLAYER/PALETTE.RMP` is **67,584 bytes**, SHA-256
`364faf322e0e10eda4315d25fd5561c116d613ca5c487d267c5d258a715fc61f`.
Its interpretation remains unverified and the parser rejects it. Do not pad it.

## RGB and Display Indices

The fast quantizer at `0x42bb98` uses:

```text
packed = ((red >> 3) << 10) | ((green >> 3) << 5) | (blue >> 3)
fileIndex = RGB[packed]                 // channels are integers 0..255
displayIndex = indexMap[fileIndex]
```

Native RGB loading (`0x44f07f`) reads exactly `0x8000` bytes into palette-object
storage at `+0xf01`. The loop at `0x44f098` translates every output through the
256-byte map at `+0x601`. Both inspected installers (`0x45024c`, `0x42f370`)
initialize that map to identity. RMP loading at `0x44f254` reads `0x30000`
bytes directly; it does **not** run that RGB post-load translation loop.

`RgbLookupTable.lookup` returns the **file index**. Apply
`translatePaletteIndex` once if using a nonidentity display map. Do not
double-translate RMP output. The RGB generator uses nearest squared RGB
distance, first index on ties, to samples `floor(channel5 * 255 / 31)`;
the fast consumer truncates RGB8 by shifting three bits. These are distinct
operations. The accurate branch of `0x42bb98` scans colors rather than RGB.

`readNativeGifPalette` reads the global RGB8 table and implements the native
black/white endpoint override at `0x44e9f2`. It does not decode GIF pixels.
`lookupPaletteColor` returns an RGB8 triple for an output index. Neither
operation scales 6-bit colors, adds transparency, or performs gamma conversion.

## RMP Banks

For a standard RMP, the byte contract is:

```text
row = brightness * 8 + variant          // brightness 0..31, variant 0..7
outputIndex = RMP[bank * 65536 + row * 256 + inputIndex]
rgb = activeGifPalette[outputIndex]
```

The generator stores bank 0 at `0x44f4fd` and bank 2 at `0x44f513`.
Bank 1 uses independent effect rows, not the brightness/variant interpretation.

| Bank | Verified Use |
| --- | --- |
| 0 | Terrain lookup; brightness plus variant-dependent color/desaturation. |
| 1 | Effect lookup rows, generated from baked color/weight records. Do not call these rows teams. |
| 2 | FIN mode 0 body path: same team-ramp substitution and brightness, but no desaturation of ordinary colors. |

FIN mode 0 dispatches through `0x454664` to `0x454982`, adds two to the
high word of the aligned lookup pointer, draws, and subtracts `0x20000`
at `0x4549e3`. Mode 5 routes through a wrapper that adds `0x10000`
(`0x462444`). This does not establish complete effect-mode composition.

The terrain blitter packs a row byte into AH and the raster index into AL,
then reads `[eax]` (`0x45e760`). Native bases are 64-KiB aligned; a shader
should use the explicit offset above, not emulate pointer-bit tricks.

### Brightness and Team Ramp

These are **generator semantics**, verified by native execution. Existing
file bytes remain authoritative; the runtime does not regenerate RMP tables.

For input indices 138..143, substitute a source palette index before scaling:

```text
variant 0:  96..101
variant 1: 102..107
variant 2: 108..113
variant 3: 114..119
variant 4: 120..125
variant 5: [47, 61, 65, 66, 67, 254]
variant 6: 132..137
variant 7: 138..143
```

These numbers come from `0x44f27d` and the fixed map addressed by `0x47bf86`.
They are not color-name assignments. For other indices, bank 0 first computes
each channel as `floor((10*C*(11-variant) + variant*(3*R+6*G+B))/110)`.
Bank 2 retains the original channel. Both then use
`min(255, floor(C * brightness / 16))`, followed by accurate nearest-palette
quantization. Brightness 16 is unity; 0 is black and 31 is overbright.
Even unity does not guarantee identity indices when colors are duplicated.

### Effects and COLOUR.SET

The descriptor table at `0x47bf08` covers effect rows starting at
`0,16,32,48,80,96,112,128,144,160`, with counts
`16,16,16,32,16,16,16,16,16,16`: 176 rows. The other 80 bank-1 rows
are not generated by this loop and have no verified effect contract.

The records are signed 16-bit `(targetR,targetG,targetB,weight)` values baked
into DC.EXE. `0x44f5c6` through `0x44f6a6` computes, per channel:

```text
base = sourcePaletteChannel >> 2
channel = 4 * (base + truncTowardZero((target - base) * weight / 100))
output = accurateNearestPalette(channelR, channelG, channelB)
```

Do not normalize these records to conventional alpha without more evidence.
They differ from COLOUR.SET: the first baked record is `(0,5,20,9)`, whereas
the text starts `(0,0,31,63)`. No runtime COLOUR.SET loader was established.
The generic API can inspect all bank bytes, but choosing effect rows and the
correct underlying pixel operand is still compositor-owned and unimplemented.

## Dynamic Team Swapping

The native child-render path at `0x439909` chooses the entity byte at `+8`,
except value 8 means use its owner byte at `+7`. It masks the chosen team ID
to three bits and reads `teamTable + teamId * 0xe30 + 0xc98` for the palette
selector. The queue at `0x436094` assembles:

```text
row = (globalBrightnessByte << 3) + (teamPaletteSelector & 7)
```

For the verified normal body path, a renderer can change the selector uniform
without changing the indexed atlas: `bank=2`, `row=lightingRow(brightness, selector)`.
Use the explicit selector, not an assumed `selector == teamId`. Initialization
and mutation of the `+0xc98` field are not traced here. Scenario `%TeamColour`
lists are **not established palette remap arrays** and must not be used as
`sourceIndex -> color` maps. Mapping scenario/configuration to selectors is a
remaining blocker to automatic, original-game team assignment.

## Shader Contract

Use integer textures and nearest sampling, no mipmaps, color conversion, or
premultiplication on index/table textures. Preserve source coverage separately.
Suggested WebGL2 formats:

- Indexed atlas: `R8UI`, original decoded SPR/BTS index bytes.
- RMP: `R8UI`, width 256, height 768; upload `RemapTable.toTextureBytes()`.
- Palette: `RGB8`, width 256, height 1; upload `readNativeGifPalette(...)`.
- Optional RGB cube: `R8UI`, width 32, height 1024. Coordinate is
  `(blue >> 3, (red >> 3) * 32 + (green >> 3))`.
- Set `UNPACK_ALIGNMENT=1`; use `texelFetch` for all lookups.

```glsl
uint sourceIndex = texelFetch(indexAtlas, sourcePixel, 0).r;
uint outputIndex = texelFetch(remapTable,
    ivec2(int(sourceIndex), bank * 256 + row), 0).r;
vec3 color = texelFetch(paletteTexture, ivec2(int(outputIndex), 0), 0).rgb;
```

For body sprites, preserve transparency from **source** zero/decoded coverage,
not output index zero. Native simple sprite drawing tests source zero before
remapping (`0x44fe6a`). Terrain backgrounds are opaque, including index zero;
foreground visibility follows its own mask. Geometry/mirror behavior remains
as documented in [terrain-transforms.md](terrain-transforms.md).

Keep full RMP bytes, including palette-cycling state when that is implemented:
`0x44f7a0` and `0x44f91c` mutate bank-0 columns across all rows. A static
uploaded table is not native palette animation. Existing baked RGBA atlases
cannot recover original palette indices reliably; integration must expose the
decoder's existing index arrays. No shared extractor, main, or view was edited.

## Verification and Blockers

```sh
node --import tsx --test tools/qa/palette.test.ts
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 tools/research/palette-audit.py --probe
PYTHONPATH=/tmp/dc-re-capstone-20260918 \
  python3 tools/research/palette-audit.py
PYTHONPATH=/tmp/dc-re-capstone-20260918 \
  python3 tools/research/palette-audit.py --disasm 0x44f200 0x44f6fc
npm run typecheck
```

The temporary Python paths contain Capstone 5 and Unicorn 2. Install those in
a separate environment if absent. The audit only reads source files and runs
native instructions in isolated memory; it does not launch the game.

Tests exhaust all source-table byte offsets and reject malformed sizes, invalid
selectors, and the short RMP. Native probes cover 32,768 RGB cells, 32,768
post-load translations, 8,192 queue selectors, 72 owner/override combinations,
8,192 generator color cases, 1,024 generator addresses, all 196,608 source RMP
pixel reads, identity-map installation, and GIF endpoint overrides.

Remaining blockers: scenario-to-team-selector initialization; short multiplayer
RMP layout; complete effect/shadow/prepass operands and ordering; spatial and
time-varying brightness selection; palette cycling; DC16 behavior; indexed GPU
integration and visual comparison. Raw table lookup is verified, not complete
game rendering. Unsupported sprite modes must retain existing diagnostics.
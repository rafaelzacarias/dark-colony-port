# Executable-verified terrain transforms

Verified 2026-09-18 against DC.EXE SHA-256
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
Addresses are x86-32 virtual addresses, image base `0x400000`.
See [terrain-decoding.md](terrain-decoding.md) for MAP/BTS record resolution.

## Result

**Raw MAP attribute `0x20` mirrors the background horizontally; `0x40`
mirrors the foreground horizontally.** They are independent flags, not a
rotation enumeration. Neither changes the source row. The low nibble is
not a foreground transform code: its verified consumer computes a vertical
sprite cutoff parameter in multiples of 32 pixels.

For `packed = background | (foreground << 11) | (attribute << 22)`:

| Raw attribute | Packed cell | Verified rendering role |
| --- | --- | --- |
| Bits 0..3, `0x000f` | Bits 22..25 | Vertical sprite cutoff input, described below |
| Bit 5, `0x0020` | Bit 27, `0x08000000` | Background horizontal reflection |
| Bit 6, `0x0040` | Bit 28, `0x10000000` | Foreground horizontal reflection |

Other attribute bits are not assigned new meanings here. All 1024 combinations
of the ten bits surviving the packed shift were executed through the native
selector instructions: only bits 5 and 6 affect this terrain blitter selection.
There is no attribute-selected vertical flip, transpose, or 90-degree rotation
in this verified 32x32 terrain path. This is separate from map-cell/worldY
projection; changing cell placement does not reverse rows within BTS rasters.

## Implementable Table

Use `code = (attribute >>> 5) & 3`. For each destination pixel `(x,y)` in
`0..31`, read the indicated byte offset from the raw 1024-byte source raster.

| Code | `attribute & 0x60` | Background offset | Foreground offset | Native combined blitter |
| --- | --- | --- | --- | --- |
| 0 | `0x00` | `32*y + x` | `32*y + x` | `0x45e3f9` |
| 1 | `0x20` | `32*y + 31-x` | `32*y + x` | `0x45e131` |
| 2 | `0x40` | `32*y + x` | `32*y + 31-x` | `0x45de69` |
| 3 | `0x60` | `32*y + 31-x` | `32*y + 31-x` | `0x45dbd0` |

With resolved foreground index zero, use background only: `0x45e873` for
normal, `0x45e691` for mirrored. A foreground zero palette index leaves the
background visible. Background palette index zero is still a background
pixel, not an instruction to skip drawing.

For a Canvas2D tile destination of width `size`, the layer-local affine
matrices `[a,b,c,d,e,f]` are:

| Layer flag | Matrix |
| --- | --- |
| Clear | `[1,0,0,1,0,0]` |
| Set | `[-1,0,0,1,size,0]` |

Apply after translating to the destination top-left in a screen-oriented
(positive Y downward) canvas coordinate system. The translation is `size`,
not `size-1`, because Canvas transforms image edges, not pixel indices.

```ts
function drawTerrainLayer(
  context: CanvasRenderingContext2D,
  atlas: CanvasImageSource,
  sourceX: number,
  sourceY: number,
  destinationX: number,
  destinationY: number,
  size: number,
  mirrored: boolean,
) {
  context.save();
  context.imageSmoothingEnabled = false;
  context.translate(destinationX, destinationY);
  if (mirrored) context.transform(-1, 0, 0, 1, size, 0);
  context.drawImage(atlas, sourceX, sourceY, 32, 32, 0, 0, size, size);
  context.restore();
}
```

Draw background with `Boolean(attribute & 0x20)`, then nonzero resolved
foreground with `Boolean(attribute & 0x40)`. Use an opaque background atlas
and foreground alpha derived from palette index zero. Do not reflect the
composited tile when the two flags differ. Do not add a vertical reflection
to compensate for upward worldY: project the cell origin separately.
This reproduces geometric transforms, not native palette/light remapping.

## Executable Anchors

| VA | Evidence |
| --- | --- |
| `0x4532c9`, `0x4532d6` | Reads `0x400` raw raster bytes per BTS record. |
| `0x4532f9` to `0x453310` | Assigns successive unchanged raster pointers at record `+4`; advances by `0x400`, descriptor stride 12. |
| `0x450488` to `0x4504da` | Extracts foreground with `shr 11; and 0x7ff`, background with `and 0x7ff`; obtains each descriptor's `+4` raster pointer and foreground `+8` mask pointer. |
| `0x4504e2`, `0x4504e8` | Loads packed byte 3, tests `8`: packed bit 27, raw attribute bit 5. Stores background selector at `[ebp-0x20]`. |
| `0x450507` | Tests packed byte 3 against `0x10`: packed bit 28, raw attribute bit 6. Stores foreground selector at `[ebp-0x34]`. |
| `0x450527` | `test dword [edx],0x3ff800`: detects nonzero resolved foreground. |
| `0x450552` | Background-only indirect call through `0x47c040 + 4*backgroundFlag` for mode zero. |
| `0x45062f` to `0x450654` | Computes `2*foregroundFlag + backgroundFlag`; calls table at `0x47c030`, with an additional mode offset from the view. Probe uses mode zero, whose routines draw 32x32. |
| `0x45e428` to `0x45e444` | Normal: `shl ecx,1` consumes foreground mask MSB first; reads both source rasters left to right, stores at destination `0,1,...`. |
| `0x45e160` to `0x45e180` | Background mirror: source foreground `0,1,...`, background `31,30,...`, destination `0,1,...`; mask MSB first. |
| `0x45de98` to `0x45deb8` | Foreground mirror: `sar ecx,1` consumes mask LSB first; foreground `31,30,...`, background `0,1,...`, destination `0,1,...`. |
| `0x45dc00` to `0x45dc1d` | Both mirrored: mask MSB first, both sources `0,1,...`, stores at destination `31,30,...`. |
| `0x45e672` to `0x45e689` | Next row: destination adds pitch, both source pointers add 32, mask pointer adds 4; repeats 32 rows. Native execution verifies the same row order in all six routines. |

The global raster inputs are background `0x4891ec`, foreground `0x4891e8`,
foreground mask `0x4891f4`, light indices `0x4891f0`, destination `0x4891f8`,
palette/light lookup base `0x4891fc`, light row stride `0x489200`, and
destination pitch `0x489204`. Mask bit 31 corresponds to source column 0.
Pass the **source-order** mask into a native blitter; do not pre-mirror it.
The dispatcher separately copies/reverses coverage into the screen mask
buffer at `0x450568` onward, restoring the original mask pointer before
calling the combined raster routine.

## Low Nibble: Not Rotation

At `0x461120` to `0x461128`:

```text
mov edx,[eax]
sar edx,22
and edx,15
shl edx,5
```

Then `0x461138` to `0x461157` produces this signed 16-bit output:

```text
nibble = (packed >>> 22) & 15
cutoff = spriteHeight + 31 - (localY & 31) - 32*nibble
```

`spriteHeight` is loaded from the caller object's word at `+2`. The caller
at `0x461170` invokes this helper at `0x4611e8`. It consumes the results in
the comparison at `0x46133b`, and copies each column's cutoff to global
word `0x514624` at `0x46146c`/`0x461471`, before the masked sprite draw call
at `0x4614ce`. This establishes a sprite clipping/occlusion role; it does
not establish an editor-facing name or require translating terrain images.

The MAP loader at `0x45375f` tests resolved foreground; when zero,
`0x453770: and word [eax+2],0xfc3f` clears only packed bits 22..25.
Both horizontal reflection flags survive. Thus that clear instruction is
not evidence that the nibble encodes foreground flips.

## Reproduce And Limits

From the repository root, using the existing temporary installations:

```sh
PYTHONPATH=/private/tmp/dc-re-capstone-20260918:/private/tmp/dc-trigger-unicorn-20260918 \
  python3 tools/research/terrain-transforms.py
```

[The probe](../tools/research/terrain-transforms.py) checks the executable hash,
maps its original PE section bytes into Unicorn, and executes unmodified x86.
It passed:

- All 1024 packed-attribute selector combinations and native slot arithmetic.
- 2048 foreground-present/absent loader-clear cases.
- All 16 nibble values at all 32 local Y positions: 512 cutoff results.
- Six native blitters with separate X- and Y-coded source fixtures:
  12,288 output pixels compared, including asymmetric foreground holes.
- Row padding and leading/trailing destination guards unchanged.

Fixtures use an identity palette/light table, a positive 48-byte destination
pitch, and synthetic source-order coverage masks. This isolates geometry
from lighting and transparency preparation. It is native-instruction
emulation of bounded routines, not a full original-game run, a visual asset
comparison, or a test of every view mode. No statistics from tile artwork
were used. No runtime code was changed; no browser was used.
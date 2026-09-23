# Standalone Indexed WebGL2 Backend

Status: required rendering contract implemented, not renderer integration,
real-pixel equivalence proof, or phase acceptance. No external dependencies.
The existing runtime is unchanged. See [palette-runtime.md](palette-runtime.md)
and [terrain-transforms.md](terrain-transforms.md) for verified semantics.

## Ownership And API

`IndexedWebGLRenderer` in [indexed-webgl.ts](../src/render/indexed-webgl.ts)
owns one dedicated HTML canvas WebGL2 context and its GL state. Do not share
the context with another renderer. There is no singleton or automatic fallback.
Construct with `{ remap: RemapTable, palette: Uint8Array }`, where the palette
is the active 768-byte RGB8 table, normally from `readNativeGifPalette`.
This backend does not decode GIFs, guess palettes, apply endpoint overrides,
scale six-bit colors, translate display indices, or rebuild RMP bytes.

`upload({ width, height, indices, coverage })` returns an instance-owned image
handle. Each upload is one complete rectangular raster; atlas subregions must
be extracted by the owner before upload. Source bytes are top-down row-major.
Upload preparation copies inputs, so later caller mutation has no effect.

`render(layers)` clears to transparent black and draws in array order. Each
layer explicitly supplies `{ image, x, y, width, height, mirrorX, lookup }`.
Coordinates are integer drawing-buffer pixels, top-left origin, positive Y
down. Set canvas backing dimensions separately from CSS dimensions. Scaling
uses pixel-center integer nearest addressing; clipping preserves that mapping.
Source and destination dimensions are limited to 1..16384, origins to
-16384..16384, and source dimensions also obey device `MAX_TEXTURE_SIZE`.
These bounds keep shader address multiplication within signed 32-bit range.
There is no vertical reflection, rotation, gamma transform, alpha blending,
or implicit layer grouping. Resize the canvas, then render the complete frame.

Lookup is a discriminated union, with no defaults:

- Terrain: `{ bank: 0, brightness, selector }`.
- Verified normal body path: `{ bank: 2, brightness, selector }`.
- Raw effect-table inspection: `{ bank: 1, row }`.

Brightness is 0..31; selector is 0..7; row is 0..255. The owner must supply
the verified source palette selector, not an inferred team ID or a scenario
`%TeamColour` array. Lighting rows are `brightness * 8 + selector`.
Bank 1 is only raw byte lookup: this API does not establish which effect
rows, destination operands, or composition order any sprite mode needs.
Keep existing unsupported-mode diagnostics in any future integration.

## Texture And Coverage Contract

All textures use unsigned bytes, integer formats, nearest filtering, no
mipmaps, unpack alignment 1, no unpack flip, no premultiplication, and no
unpack color conversion. Every shader read uses `texelFetch` at LOD zero:

| Texture | Format | Dimensions | Address |
| --- | --- | --- | --- |
| Indices | R8UI | source width x height | source pixel |
| Coverage | R8UI | source width x height | same source pixel |
| RMP | R8UI | 256 x 768 | `(sourceIndex, bank * 256 + row)` |
| Palette | RGB8UI | 256 x 1 | `(outputIndex, 0)` |

Integer palette channels are divided by 255 only when writing framebuffer
RGB. Dithering and blending are disabled. No RGB quantization cube is needed
for an already indexed source. RMP output is never translated through an
index map a second time.

Coverage must be selected explicitly:

- `opaque`: every source texel draws, including index zero (terrain background).
- `source-zero`: only original source zero is transparent (simple sprite).
- `mask`: supply one decoded byte per source texel; zero skips and any nonzero
  value draws fully opaque. This is binary coverage, not fractional alpha.

Masks are source-order, not pre-mirrored. A mask can make source zero opaque
or a nonzero source index transparent. Packed native mask words must be
decoded by the caller. Output index zero is an ordinary opaque color for
covered pixels. Mirroring applies to indices and coverage together, separately
on every draw. For terrain, supply background `Boolean(attribute & 0x20)` and
foreground `Boolean(attribute & 0x40)` on their respective layers. Do not
mirror the combined result or reinterpret the attribute's low nibble.

## Failure And Lifecycle

- Missing WebGL2, shader/link failure, failed texture allocation/upload, and
  detected draw errors throw `IndexedWebGLUnavailableError`. Bad inputs throw
  `RangeError` or `TypeError`. Initialization cleans up partially built GL
  resources. Owners should catch unavailable errors and select their fallback.
- A successfully acquired WebGL canvas cannot subsequently become a 2D canvas.
  The owner must retain or create a separate fallback canvas, including when
  shader initialization fails after acquiring the context.
- `ready` is false when disposed, lost, or awaiting explicit reinitialization.
  The loss listener calls `preventDefault` to permit restoration and invalidates
  all image handles. Upload/render reject while unavailable. No automatic loop
  or silent reupload occurs; no CPU raster copies are retained by the renderer.
- On `webglcontextrestored`, the owner calls `reinitialize(tables)`, reuploads
  all images, replaces its handles, and renders again. Calling reinitialize
  while the context is still lost rejects. Restoration alone is not readiness.
- Reinitialization also provides explicit table replacement for changed palette
  or RMP bytes. It destroys all existing resources and invalidates all handles;
  it is not an efficient animation path or an implementation of native cycling.
  Failure after valid input leaves the renderer unready and retryable.
- `releaseImage(handle)` deletes both image textures; repeated release is a
  no-op. Foreign/stale handles cannot be drawn. `dispose()` deletes every owned
  texture, program and VAO and removes its listener. It is idempotent and final;
  it does not force context loss or remove/resize the owner's canvas.

## Verification Boundary

Run `node --import tsx --test tools/qa/indexed-webgl.test.ts` and
`npm run typecheck`. Node tests cover the pure upload/reference contracts:
all 196,608 RMP addresses against `RemapTable.lookup` plus RGB8 palette lookup,
input copying, selector validation, independent mirrors, source masks,
transparent source zero versus remapped zero, and unavailable WebGL rejection.
The reference helper accepts prepared upload objects, not arbitrary byte arrays.
These tests do not execute GLSL or prove browser framebuffer output/lifecycle.

Real pixel QA is still required, using only the main owner's existing embedded
browser tab. This task opens no browser windows or tabs. The owner should:

1. Render asymmetric multirow, odd-width fixtures; compare immediate
   `readPixels` RGBA bytes (bottom-up) with the top-down CPU reference. Include
   all banks, brightness endpoints/unity, selectors, and palette endpoints.
2. Compare all four independent background/foreground mirror combinations,
   asymmetric masks, source-zero transparency, opaque zero, remapped zero,
   overlapping layers, clipped negative origins, resize, and noninteger scaling
   ratios. Reuse one image with different lookup uniforms to verify no stale
   palette state. Check nearest sampling and row alignment at odd widths.
3. Exercise two independent instances and foreign/released handles, then use
   `WEBGL_lose_context` when available to test loss rejection, restoration,
   explicit reinitialization, stale-handle rejection and disposal/listener
   cleanup. Verify owner fallback on a separate canvas when unsupported.
4. Capture desktop/mobile screenshots and inspect actual source assets after
   integration. With `preserveDrawingBuffer: false`, read pixels synchronously
   immediately after `render`, before yielding to browser presentation.

Passing those checks still would not establish team-selector initialization,
spatial lighting, full native effects, palette animation, or phase acceptance.
# Mission Indexed Terrain Surface

Implementation: [src/render/mission-terrain.ts](../src/render/mission-terrain.ts).
CPU acceptance: [tools/qa/mission-terrain.test.ts](../tools/qa/mission-terrain.test.ts).
Asset contract: [tools/extractors/palettes/README.md](../tools/extractors/palettes/README.md).

## API

`await createMissionTerrain(mission, options?)` accepts the existing campaign
mission object without modifying it. It owns a detached HTML canvas with a
WebGL2 context, fixed at 512x452. This is not an `OffscreenCanvas` worker API.
It does not replace or acquire a WebGL context on the existing 2D mission canvas.

`render({ cameraX, cameraY, visible, explored?, phase?, blend?, fog? })` returns
that canvas synchronously. Camera coordinates are the existing camera center in
32-pixel cells, with upward-positive world Y. The caller retains camera clamping.
`visible` and optional `explored` are map-sized `Uint8Array`s in world-row order,
indexed by `worldY * map.width + cellX`; zero is false and nonzero is true.

`phase` is native SCN phase 0 or 1, corresponding to blend 0 or 256. `blend` is
an integer in 0..256. Supply at most one. When omitted, the original SCN initial
phase is used, not the previous render's override. The surface does not advance
the day/night cycle or infer it from simulation opacity or faction.

`status` and `stats` are snapshot getters. `dispose()` is idempotent and releases
all retained tile images, lookup textures, program, VAO and renderer listener.
The CPU index atlas reference in the tile cache is also cleared. Disposed or
lost surfaces must be recreated; context restoration is not automatic.

## Integration

Initialization and fallback policy belong to the caller. Asset integrity,
unsupported-bank, schema and input errors are ordinary errors, not silent
fallbacks. Only `IndexedWebGLUnavailableError` selects the existing 2D path.

```ts
import { createMissionTerrain, type MissionTerrain } from "./render/mission-terrain";
import { IndexedWebGLUnavailableError } from "./render/indexed-webgl";

let terrain: MissionTerrain | null = null;
try {
  terrain = await createMissionTerrain(mission);
} catch (error) {
  if (!(error instanceof IndexedWebGLUnavailableError)) throw error;
  console.warn("Indexed terrain unavailable; retaining 2D terrain", error);
}

function drawMissionBase(context: CanvasRenderingContext2D): void {
  context.save();
  try {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.imageSmoothingEnabled = false;
    context.fillStyle = "#18140e";
    context.fillRect(0, 0, 512, 452);
    if (terrain) {
      try {
        const surface = terrain.render({ cameraX, cameraY, visible, fog: "overlay" });
        context.drawImage(surface, 0, 0);
        return;
      } catch (error) {
        if (!(error instanceof IndexedWebGLUnavailableError)) throw error;
        console.warn("Indexed terrain lost; retaining 2D terrain", error);
        terrain.dispose();
        terrain = null;
      }
    }
    drawExisting2DTerrain(context);
  } finally {
    context.restore();
  }
}

drawMissionBase(context);
drawUnitsAndObjects(context);
drawExistingFog(context);
drawHud(context);
```

The draw functions, camera and visibility variables above denote existing caller
operations; they are not new exported helpers. Call `terrain?.dispose()` when
leaving the mission. Do not dispose the source before copying it.

`preserveDrawingBuffer` is false. Call `render` and `drawImage` in the **same
JavaScript task**, without `await`, timers or an intervening animation frame.
Do not reuse the returned canvas in a later task without rendering again.
The canvas clears transparent outside the map; retain the opaque 2D base fill.
Every background tile texel, including source index zero, is opaque.

## Fog And Lighting

Default `fog: "overlay"` leaves every terrain cell at native brightness 16.
The caller's existing fog pass remains the sole visibility darkening pass.
`visible` is still required and validated but does not darken terrain in this
mode. Do not apply an additional whole-terrain day/night opacity or tint: native
phase is already applied through the RMP selector.

Optional `fog: "palette"` uses uniform cell brightness 16 for visible cells,
10 for explored cells, and 0 for unknown cells. Visible takes precedence over
explored. With no `explored` array, all invisible cells are unknown. In this mode
the caller must not apply its existing fog darkening over the composed terrain
again. Continue hiding unseen entities independently; this module renders only
terrain, not unit visibility or remembered objects.

Both modes use bank 0, selector `trunc(7 * blend / 256)`, and row
`brightness * 8 + selector`. Spatial brightness interpolation is **pending**,
reported as `status.spatialInterpolation`. Uniform palette fog is not a claim
of native pixel-by-pixel visibility interpolation acceptance.

## Source Preservation

The loader reads the published indexed manifest and checksum, terrain and
palette metadata, terrain R8 indices, RGB8 display palette and original RMP.
Every loaded descriptor/binary is checked against the manifest size and SHA-256.
Texture format and dimensions must match their native integer layout. A
publication switch that mixes bytes fails explicitly instead of mixing assets.
For concurrent publication, `options.indexedRoot` can select an immutable
published generation; default is `/assets/generated/indexed`.

Only matching DESERT scenario/map banks marked verified in the manifest are
accepted. There is no guessed bank, palette, team selector or faction alias.
`initializeDesertMissionPalette` receives the original scenario `rawHeader` and
all eight original team slots. The published display bytes already contain the
native GIF table and endpoint overrides. A temporary GIF header/global-table
envelope adapts those exact 768 bytes to that helper's existing parser API. It
is not a reconstructed image and is never image-decoded. Tests compare the
result directly against initialization from the original DESERT.GIF/RMP for
HUMAN01 and ALIEN01. No six-bit expansion, RGB conversion, alpha darkening or
team/race inference occurs.

MAP storage uses `sourceY = map.height - 1 - worldY`; visibility does not undergo
that flip. Screen placement uses the tile's upper world edge `worldY + 1`.
The camera origin is rounded once to integer pixels, so neighboring tile edges
agree even for fractional camera positions. Pixels within each tile retain
top-to-bottom source order. Attribute `0x20` mirrors background X and `0x40`
mirrors foreground X independently; neither flips tile Y.

Records are validated against the published complete key-to-record table.
Missing keys resolve to record zero. Only foreground **MAP key zero** omits a
layer; a nonzero foreground key resolving to record zero must still draw.
Tile bytes are cropped lazily from unchanged atlas rectangles. Background
coverage is opaque; foreground coverage is derived from original source zero,
never from the remapped palette output. The published coverage files need not
be downloaded because these two terrain coverage rules are exact.

## Resources

The tile-layer LRU retains at most 1,024 images by default. `maxCachedImages`
can reduce this bound (integer 1..1024); a frame requiring more entries fails
explicitly. A worst-case fractional camera sees 17x16 cells, at most 544 layer
images. Capacity 544 or higher can hold every possible full frame. A tile used
in both layers occupies two entries because its coverage differs.

Each cached image owns **two** 32x32 R8 textures. Thus the default maximum is
**2,050 textures**, not 1,024: 2,048 tile textures plus shared RMP and palette.
Maximum texture payload is 2,294,528 bytes, excluding driver allocations and the
drawing buffer. No entire atlas is uploaded, so atlas size does not constrain
the GPU texture dimensions. Frame entries are protected during LRU eviction;
only nonrequired images are released. Identical frames do not upload tiles
again. Evicted tiles are reuploaded only if they return to view.

`stats` exposes cumulative `uploads`, `cacheHits`, `evictions`, `frames`, total
downloaded `loadedBytes`, and last successful frame `draws`. It also exposes
`cachedImages`, configured `capacity`, `retainedIndexBytes`, `liveTextures` and
`textureBytes`. Texture bytes are payload estimates, not measured GPU memory.
After context loss, live texture counts are zero even if invalid cached image
handles remain until disposal. `status` exposes state, error, palette, initial
and current blend, original team selectors, last successful fog mode and the
pending interpolation flag.

## Verification

```sh
node --import tsx --test tools/qa/mission-terrain.test.ts
npm run typecheck
```

CPU tests cover explicit frame-plan arrays, source flags, row orientation,
palette row selection, source-zero coverage, exact native initialization,
viewport culling, lazy cache reuse/eviction/disposal, published loader integrity
and explicit unavailable-WebGL behavior. No browser windows are opened by these
tests. Actual GPU presentation and same-task 2D copying remain for main's
embedded-browser integration check; no visual acceptance is claimed here.
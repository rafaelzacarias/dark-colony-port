# Original HUD UI Helpers

These modules do not mount UI or change mission state on import. All exports are
available from `src/ui/index.ts`. The orchestrator owns the DOM, camera, selection,
team mapping, visibility, and mission lifecycle.

## Geometry

`ORIGINAL_HUD` uses logical coordinates in the original 640x480 frame:

| Region | x | y | width | height |
| --- | ---: | ---: | ---: | ---: |
| World | 4 | 4 | 512 | 452 |
| Portrait (existing) | 537 | 113 | 80 | 120 |
| Proposed radar | 520 | 282 | 116 | 116 |

Labels remain at (522,9) and (522,28); message starts at (522,43).

Visually checked against `public/assets/generated/interface/INTRFACE.GIF`:
the lower-right frame contains a narrow strip at approximately y=402-418,
BUILD/DAYS at y=421-449, and another strip/dial below it. Those are not a
square radar opening. The proposed radar fits inside the large right-panel
recess, below the existing portrait and above the y=400 divider. This is a
proposed placement, not a claim about the original game's radar location.
Constrain message/portrait content to avoid extending into this rectangle.
No construction or mission-progression controls are implemented here.

## Radar API

- `createRadar({ canvas, source, atlas, onNavigate })`: caches terrain once,
  binds pointer input, returns `render(frame)` and idempotent `dispose()`.
  Pass the loaded mission as `source` and its decoded terrain atlas as `atlas`.
- `RadarFrame`: `visible`, optional `explored`, `entities`, and `view`.
  Fog arrays are row-major, one entry per map cell. Positive means known/visible.
  `view` is a minimum-X/minimum-Y rectangle in **runtime map cells**, not pixels
  or subcells. Runtime Y increases upward; its screen top is y+height.
- `RadarEntity`: snapshot-like `id`, `cellX`, `cellY`, `health`, optional
  `activity`/`kind`, plus an explicit `owned` boolean. Owned living entities
  remain visible; foreign entities require current visibility. Explored-only
  cells never reveal enemies. Dead, dying, missing, and out-of-map units do not
  produce markers. The helper does not infer ownership from race/faction.
- `snapshotRadarEntities(snapshot, isOwned)`: adapts units/buildings; the ownership
  callback receives the entity and its kind, so ID namespaces can remain distinct.
  Append static mission objects separately if they are not in the simulation.
- `accumulateRadarExploration(previous, visible)`: immutable exploration union.
  Omit exploration for a strict current-visibility-only terrain display.
- `radarMapRect`, `radarClientToMap`, `radarCellAt`, `radarCameraView`,
  `radarViewRect`, `radarMarkers`: deterministic geometry/filtering functions.
- `createRadarTerrain`, `drawRadar`, `bindRadarPointer`: lower-level building
  blocks for other render loops or tests.

Terrain uses the source map dimensions and schema-2 background/foreground
record-index pairs in top-down source row order. MAP attributes independently
mirror background (`0x20`) and foreground (`0x40`) horizontally. Foreground record zero is
skipped. Runtime entity, fog, camera, and picking Y coordinates are inverted
at the presentation boundary. Invalid references remain neutral
gray rather than fabricated terrain. Unknown terrain is opaque black, explored
terrain is dimmed, owned markers green, foreign visible markers red, and the
camera rectangle white. The map preserves aspect ratio with black letterboxing.
Fog is conservatively rounded outward to avoid partially exposed hidden pixels.

Left and right press/drag navigate the camera only. The source README explicitly
documents right-click minimap navigation; left navigation/drag are convenience
extensions. Initial clicks in letterboxing do nothing; captured drags clamp to
map edges. `onNavigate` receives continuous `point`, bounded integer `cell`, and
`button` (0 or 2). Continuous points may equal the far map edge; use the camera
clamp helper or the bounded `cell` as appropriate. CSS scaling is handled using
the canvas bounding rectangle; use a borderless, unpadded canvas.

Pointer cancellation, capture loss, window blur, and disposal release capture.
Disposal removes all listeners and restores the canvas's prior touch action.
Click/context-menu bubbling is stopped so a parent HUD does not issue commands.
There is no timer, animation loop, singleton, or document-wide pointer listener.

## Control Groups

`createControlGroups`, `pruneControlGroups`, and `reduceControlGroupKey` are pure.
Groups 0-9 store unique, numerically sorted IDs. `g` then a digit creates/replaces
a group from the current owned living selection; a digit recalls it. Empty
creation clears a group; empty recall returns an empty selection. All groups
are pruned against the supplied current roster on every reduction. Call the
explicit prune helper on simulation updates when maintaining reducer state yourself.

The `g` sequence is documented in `raw_cd/DC/README.TXT`; number recall is the
requested behavior. `ctrlNumberAlias` is false by default. Repeat events never
create/recall groups. Other keys/modifiers, text editing, composition, and blur
cancel the pending prefix. IDs should not be recycled within a mission; reset
or recreate the binding on mission/player changes.

`bindControlGroups(target, options)` supplies a keyboard adapter with `state`,
`reset()`, and `dispose()`. Use `window` as the target to receive window blur.
Options are `getUnits`, `getSelectedIds`, `onRecall`, optional `isEnabled`, and
optional `ctrlNumberAlias`. Recall invokes the callback even for an empty group.
The callback must replace selection, not toggle or append it.

## Integration Sketch

This sketch uses explicit **orchestrator-provided adapters**, not methods that
already exist on `MissionView`. In particular, the current mission team table
and camera are private. The owning agent must provide those adapters; do not
substitute a faction-only ownership test or pretend these methods already exist.

```ts
import {
  ORIGINAL_HUD, createRadar, bindControlGroups, snapshotRadarEntities,
  radarCameraView, accumulateRadarExploration,
} from "./ui";

const placement = ORIGINAL_HUD.radar;
radarCanvas.width = placement.width;
radarCanvas.height = placement.height;
radarCanvas.setAttribute("aria-label", "Radar");
Object.assign(radarCanvas.style, {
  position: "absolute", border: "0", padding: "0",
  left: `${placement.x / ORIGINAL_HUD.width * 100}%`,
  top: `${placement.y / ORIGINAL_HUD.height * 100}%`,
  width: `${placement.width / ORIGINAL_HUD.width * 100}%`,
  height: `${placement.height / ORIGINAL_HUD.height * 100}%`,
  imageRendering: "pixelated",
});

const viewportCells = {
  width: ORIGINAL_HUD.world.width / tileSize,
  height: ORIGINAL_HUD.world.height / tileSize,
};
const radar = createRadar({
  canvas: radarCanvas, source: mission, atlas: decodedTerrainAtlas,
  onNavigate: ({ point }) => {
    const view = radarCameraView(mission.map, point, viewportCells);
    setCameraCenter({ x: view.x + view.width / 2, y: view.y + view.height / 2 });
    requestRender();
  },
});
const groups = bindControlGroups(window, {
  getUnits: () => getSnapshot().units.map(unit => ({
    ...unit, owned: isOwned(unit, "unit"),
  })),
  getSelectedIds,
  onRecall: replaceSelection,
  isEnabled: isMissionInputActive,
  ctrlNumberAlias: false,
});

let explored = new Uint8Array(mission.map.width * mission.map.height);
function renderRadar() {
  const visible = getPlayerVisibility();
  explored = accumulateRadarExploration(explored, visible);
  radar.render({
    visible, explored,
    entities: snapshotRadarEntities(getSnapshot(), isOwned),
    view: radarCameraView(mission.map, getCameraCenter(), viewportCells),
  });
}

function disposeHud() {
  groups.dispose();
  radar.dispose();
}
```

Use a positioned 4:3 HUD parent whose dimensions follow the original frame.
Render after simulation updates and camera changes. Supply visibility computed
for the actual player/team: the current simulation's faction-wide visibility
must not be used for same-faction opponents if that would reveal their vision.
The helpers cannot correct an already over-permissive visibility mask.

## Verification

`node --import tsx --test tools/qa/ui-controls.test.ts`

`./node_modules/.bin/tsc --project tsconfig.app.json --noEmit --pretty false`

The optional Chromium test uses an existing Playwright installation without
changing project dependencies. Set `UI_BROWSER_MODULE` to its absolute module
path and `UI_BROWSER_EXECUTABLE` to Chromium; `UI_BROWSER_URL` defaults to
`http://127.0.0.1:5173`. Run the same test command with the existing Vite server
running. It uses an isolated page fixture, real HUMAN01 terrain, pixel checks,
desktop/mobile-sized HUD screenshots in the OS temporary directory, and real
left/right pointer input. It does not alter the app's entry point.
# Dark Colony browser port

This repository is a clean-room browser reimplementation scaffold for the 1997
RTS *Dark Colony*. Users must provide their own game disc data.

Phase 1 is complete, and the Phase 2 extraction pipeline is operational. The
mixed-mode MDF/MDS image is validated, every disc file is fingerprinted, all 284
SPR archives decode into deterministic PNG atlases, and 164 standard FIN files
decode into named animation timelines. Four BTS banks decode into 4,764 keyed
terrain tiles, and all 108 MAP/MTG/PTH bundles export to typed binary layers.
All 259 WAVs, 59 AVIs, and four Red Book tracks also convert to browser-native
media. HUMAN01 and ALIEN01 now run as source-driven mission slices using their
original SCN placements, initial TRO reinforcements, 96x84 MAP layers,
GAMESTAT units, and shipped 640x480 interface frame. The remaining TRO runtime
and unresolved MAP composition are not complete. Generated proprietary content
remains ignored and must be produced from a user-owned disc.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- A mounted or extracted Dark Colony disc tree for inventory generation

## GitHub Pages

The game runs as a static site; no application server or database is required.
An Actions deployment is included. See [the deployment guide](docs/github-pages.md)
for repository setup, the separately supplied game-asset bundle, and testing a
repository-prefix URL. The workflow stays disabled until its asset URL and
SHA-256 repository variables are configured. Do not publish the original game
assets unless you have permission to redistribute them.

## Commands

```sh
npm install
npm run extract-assets -- --source raw_cd --output asset_manifest.json
npm test
npm run typecheck
npm run build
npm run dev
```

`extract-assets` writes `asset_manifest.json`, sprite atlases and metadata under
`public/assets/generated/sprites/`, animation timelines under `animations/`,
terrain atlases under `terrain/`, map layers under `maps/`, original mission
tables/scripts under `data/`, and browser-native interface screens under
`interface/`. Pass `--inventory-only` to skip format conversion. `npm run dev`
opens the source mission loader plus the sprite, terrain, media, and simulation
inspection tools. Use `--disc-descriptor <file.mds>` when the descriptor is not
at the default `Dark Colony ISO/Dark Colony.mds` path.

See `ARCHITECTURE.md` for disc geometry, discovered formats, ownership rules,
and phase gates.

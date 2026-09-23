# All Terrain Palette Initialization

Status: source-backed initialization for ATLANTIS, DESERT, HTRAIN and JUNGLE.
Shared indexed assets were republished on 2026-09-19 and campaign palette wiring
is complete. This is preflight/loader evidence, not live campaign, browser, GPU,
or phase acceptance. No browser or full suite was used.

## Native Evidence

The [RMP runtime investigation](rmp-runtime-20260919.md) executes the original
SCN-to-palette-basename chain for all 108 source SCNs: DESERT 45, JUNGLE 42,
HTRAIN 15, ATLANTIS 6. It proves root GIF/RGB/RMP selection through the common
callback, but intercepts GIF/RGB processing. The additional evidence here is
the original executable's GIF table branch, not an inference from RMP size.

DC.EXE SHA-256:
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.

| Address | Source Instruction Evidence |
| --- | --- |
| `0x42bd03..0x42bd1c` | Loads caller basename from frame -0xc into EAX; calls GIF reader `0x44e8dc`, with destination palette storage +1. There is no bank-name comparison. |
| `0x44e979..0x44e9cf` | Reads seven logical-screen bytes after the six-byte GIF signature. Packed byte low three bits determine table size; bit 7 gates the global table. |
| `0x44e9d1..0x44e9e6` | Reads three bytes per table entry from the source file into the palette destination. A successful read proceeds to the endpoint writes. |
| `0x44e9f2..0x44ea1a` | Unconditionally writes first RGB triple to 0 and last RGB triple to 255. No terrain condition or six-bit expansion. |
| `0x42bd21..0x42bd30` | Copies all 768 bytes to active storage unchanged. |
| `0x42bd3c..0x42bd4f` | Reloads the identical caller basename for RGB then RMP. |

The [native-byte regression](../tools/qa/palette-init.test.ts) pins the executable
hash and exact GIF call, table-size/read branch, and endpoint instruction bytes.
It checks all four original GIF signatures, global-table flags and 256-entry
lengths. Thus the native last-entry override is index 255 for every supported
bank. The established [initialization proof](palette-initialization.md) supplies
the bank-independent phase, team fallback, FIN brightness, active copy and
DirectDraw identity-map behavior. This change used static pinned source-byte
evidence, not a new full native boot or an unreported execution probe.

Reproduce the additional disassembly with the existing isolated dependencies:

```sh
PYTHONPATH=/tmp/dc-rmp-probe-20260919 python3 tools/research/rmp-runtime-20260919.py --disasm 0x42bcac 0x42bd60
PYTHONPATH=/tmp/dc-rmp-probe-20260919 python3 tools/research/rmp-runtime-20260919.py --disasm 0x44e940 0x44ea40
```

## Runtime Contract

- [palette-init.ts](../src/render/palette-init.ts): `initializeMissionPalette`
  accepts only the four exact `.BTS` basenames, case-insensitively. Paths,
  arbitrary names and PALETTE.BTS fail. Callers supply matching original GIF/RMP
  bytes; the pure helper checks layout, not provenance. The old DESERT helper
  remains a DESERT-only compatibility wrapper.
- Phase 0/1 initializes blend 0/256. Terrain uses bank 0 and selector
  `trunc(7*blend/256)`; FIN bodies use bank 2, brightness 16 and the SCN team's
  validated color. Visibility and coverage behavior are unchanged.
- [mission-terrain.ts](../src/render/mission-terrain.ts) selects the SCN bank,
  retains map/SCN equality, and requires manifest `verifiedInitialPalettes` plus
  matching palette metadata with `verifiedInitialUse === true`.
- [mission-sprites.ts](../src/render/mission-sprites.ts) now selects that same
  bank from the manifest instead of fixed DESERT URLs. It checks the manifest
  checksum, palette metadata identity/flag, texture descriptors and payload
  sizes/hashes before initialization. Both consumers reject stale verification
  metadata instead of relabeling another bank as DESERT.

## Extraction

[extract.ts](../tools/extractors/palettes/extract.ts) now marks the four proven
terrain triples verified, restricted to triples actually published. PALETTE's
mission-initialization flag stays false. The source bytes, three RMP banks,
RGB555 table and schema version are unchanged. Short RMP rejection is unchanged.

All 108 original SCNs receive actual-bank initialization metadata. Existing
HUMAN01/ALIEN01 paths remain unchanged; other paths retain their SCENARIO-relative
directories under `missions/`. Resolve entries by their source identity/path,
not merely the potentially duplicated mission basename. Extra entries do not
assert that test/spare scenarios are selectable.

The focused extraction test copies only five palette triples and 108 SCNs to
a temporary source tree, publishes in `/tmp`, verifies flags, exact bytes,
teams/phases and the 45/42/15/6 census, then removes that isolated tree.
It does not regenerate sprites, terrain atlases, or shared generated assets.

## Verification

```sh
node --import tsx --test tools/qa/palette-init.test.ts tools/qa/mission-terrain.test.ts tools/qa/mission-sprites.test.ts tools/qa/all-terrain-palettes.test.ts
node --import tsx --test --test-name-pattern='terrain palette metadata|atomic pointer' tools/extractors/palettes/extract.test.ts
```

34 focused tests passed across these commands. Differential checks use original
GIF/RMP bytes for each bank, both initial phases, every team's eight possible
colors, all 257 blends, all 17 terrain brightness levels and all 256 indices.
FIN output checks compare actual RGBA, including covered source index zero.
Loader checks reject missing verification, false descriptor flags, wrong bank
names, missing palette entries, wrong dimensions, corrupt payloads/checksums,
arbitrary banks and mismatched map/SCN banks. WebGL is deliberately unavailable
in the loader fixture: reaching that explicit boundary proves loading only.

## Orchestrator Handoff

Completed within [game-data.ts](../src/game-data.ts),
[campaign-progression.test.ts](../tools/qa/campaign-progression.test.ts), and
this document, plus the authorized extractor publication. No main, view or
engine files were changed by this integration.

`campaignPreflight` now reuses `missionPaletteBank`: only the four exact BTS
basenames, case-insensitively, are accepted. Paths and arbitrary names fail.
Phase/team validation, SCN/map equality, source identity, TRO gates, briefing,
messages, outcomes and map-layer checks remain intact. Tests accept the
controller's existing `newrate`, `setarray` and zero-lives support.

The campaign-local palette fetch helper reuses `validateMissionPaletteManifest`
and `initializePublishedMissionPalette`. It verifies the manifest checksum,
selected metadata size/hash, metadata identity/verification flag, and both
texture descriptors before requesting either palette payload. Both payloads
then require matching size/hash and valid initialized palette bytes. Unknown
banks and mismatched SCN/map banks reject before any indexed fetch. The required
published MBULLET loader and its source/Q8 validation remain unchanged.

### Published Generation

Coordinated command: `npm run extract-indexed` with explicit absolute source and
output arguments. The extractor generated all metadata and checksums; no manual
generated metadata edits were made.

Generation directory ID and manifest SHA-256:
`b86dde044988163b2b255f584b124e7cc74af59564c312b6faaefccacf68647c`.

- Atomic indexed pointer resolves to that immutable generation; checksum matches.
- All 1,162 published output byte counts and SHA-256 values verified.
- `verifiedInitialPalettes`: ATLANTIS, DESERT, HTRAIN, JUNGLE. Their metadata
  `verifiedInitialUse` flags are true; PALETTE remains false.
- 108 unique SCN source identities and source hashes verified. Metadata census:
  DESERT 45, JUNGLE 42, HTRAIN 15, ATLANTIS 6; all retain eight teams and phase/blend.
- Published MBULLET source SHA-256:
  `2244665ec4fc4f344b4ad32ec47e209c79a1a240d48f8f43a6035ceab0ae1d22`.
  Campaign tests compare loaded coefficients with the original source matrix.

### Final Focused Checks

```sh
node --import tsx --test tools/qa/campaign-progression.test.ts
node --import tsx --test tools/qa/palette-init.test.ts tools/qa/mission-terrain.test.ts tools/qa/mission-sprites.test.ts tools/qa/all-terrain-palettes.test.ts
node --import tsx --test --test-name-pattern='terrain palette metadata|atomic pointer' tools/extractors/palettes/extract.test.ts
./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2022,DOM,DOM.Iterable --types node --noUnusedLocals --noUnusedParameters src/game-data.ts tools/qa/campaign-progression.test.ts
```

Results: 135 campaign tests, 32 palette/consumer tests, and two isolated extractor
tests passed (169 total); scoped strict typecheck clean. Campaign cases exercise
all four banks, unknown/path banks, SCN/map mismatch, stale flags, wrong metadata,
descriptor size/hash/format/dimensions, corrupt manifest checksum, corrupt
metadata and both corrupt payloads. Descriptor failures assert that no palette
payload is fetched. Four-bank loader fixtures hold the mission/map layout fixed
to isolate palette selection; they do not claim source mission playability.

The corpus audit emits **preflight-supported only, not live acceptance (10/30)**:

- HUMAN/HUMAN01, HUMAN/HUMAN03, HUMAN/HUMAN07, HUMAN/HUMAN08, HUMAN/HUMAN11,
  HUMAN/HUMAN13.
- ALIEN/ALIEN01, ALIEN/ALIEN03, ALIEN/ALIEN13, ALIEN/ALIEN14.

The other 20 missions retain their existing unsupported controller diagnostics.
The audit compares successful loader results with the current preflight result
set instead of assuming either the old five-mission list or all 30 are playable.

No palette change to main, mission-view or engine is required by this slice.
Their unrelated mission support limits remain in force. This work does not
implement spatial fog interpolation, native clock scheduling, palette cycling,
unsupported FIN modes, custom terrain banks, or the short multiplayer RMP.
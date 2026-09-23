# Indexed GPU Assets

```sh
npm run extract-indexed
npm run test:indexed
```

The standalone command reads `raw_cd/DC` and publishes only
`public/assets/generated/indexed`. Override with `--source <DC directory>` and
`--output <indexed directory>`. Full ingest also calls this extractor; use the
standalone command to avoid regenerating media or existing RGBA atlases.

## File Contract (Schema 1)

All paths inside JSON descriptors are relative to the indexed root, except the
existing FIN index's metadata paths, which remain relative to `animations/`.
Source paths are relative to the input DC directory. Binary files have no header,
padding between rows, compression, palette conversion, or premultiplication.

| Path | Contract |
| --- | --- |
| `index.json` | Counts, palette/terrain/sprite metadata paths, first missions, FIN bindings, diagnostics, input digests and sorted output digests. Each digest has `path`, `bytes`, `sha256`. |
| `index.sha256` | SHA-256 of the exact UTF-8 `index.json` bytes, standard `<hash>  index.json` line. These two files are excluded from `outputs` to avoid self-reference. |
| `palettes/<BANK>.palette.rgb8` | 768 RGB8 bytes from the matching root GIF's global table. Entry 0 forced black, 255 white; no 6-bit expansion. `RGB8UI`, 256x1. |
| `palettes/<BANK>.rmp.r8` | All 196608 original RMP bytes, `R8UI`, 256x768. Address `bank*65536 + row*256 + sourceIndex`; texture Y is `bank*256+row`. No transpose or translation. |
| `palettes/<BANK>.rgb555.bin` | All 32768 original RGB cube bytes. Address `((red>>>3)<<10) \| ((green>>>3)<<5) \| (blue>>>3)`. Optional for rendering, always published here. |
| `palettes/<BANK>.json` | Source hashes, table descriptors, address formulas, verified initial-use flag. |
| `terrain/<BANK>.indices.r8` | Original BTS indices in existing terrain atlas rectangles, one byte per texel. |
| `terrain/<BANK>.background.r8` | Coverage 255 for every tile pixel, including source zero; unused atlas area zero. |
| `terrain/<BANK>.foreground.r8` | Coverage 255 for nonzero source indices, zero otherwise. Never derive coverage from remapped output. |
| `terrain/<BANK>.json` | Source digest, palette name, atlas dimensions, texture descriptors, unchanged `tiles` array (`recordIndex`, `key`, `x`, `y`, `width`, `height`), `keySpace` and complete `keyToRecord` array. Missing keys resolve to record zero, as in `resolveTerrainReferences`; foreground MAP key zero means no foreground. |
| `sprites/<source-without-SPR>.indices.r8` | Original decoded SPR indices; same dimensions and exact frame coordinates as existing RGBA atlas. |
| `sprites/<source-without-SPR>.coverage.r8` | Original parser alpha: raw source-zero matte; compressed skips zero coverage and literals 255, including literal zero. Atlas padding zero. |
| `sprites/<source-without-SPR>.json` | Source digest, encoding/flags, stored byte count, atlas dimensions, texture descriptors, coverage policy, unchanged `frames` array including anchors and empty frames. |
| `animations/index.json`, `animations/<FIN>.json` | Existing FIN extractor schema, retained verbatim: states, timeline children, layer, flags, valueA/valueB, orphan children. Unsupported/invalid FINs remain diagnostics, not invented metadata. |
| `animations/bindings.json` | Original FIN sprite names to indexed SPR metadata paths, or null for missing source archives. No guessed aliases or draw-mode substitutions. |
| `missions/HUMAN01.json`, `missions/ALIEN01.json` | Original eight SCN team slots and scalar colors, validated selectors, raw header, named native cycle fields, initial blend and visible-terrain lookup. Entity owner/override extraction is explicitly not claimed. |
| `missions/<SCENARIO-relative-path>.json` | Same initialization metadata for other source SCNs, with the actual terrain palette. Directories prevent duplicate-basename collisions; the two first-mission paths above remain compatible. |

All indices and coverage are `R8UI`, top-to-bottom source row order, one byte per
pixel. Use nearest integer sampling, no mipmaps, `UNPACK_ALIGNMENT=1`, no image
color conversion, no premultiplication, no upload row flip. Apply native MAP
mirror rules at draw time; atlas bytes remain in source orientation.

ATLANTIS, DESERT, HTRAIN and JUNGLE are marked verified for initial runtime use
when their complete root GIF/RGB/RMP triples are present. PALETTE remains published
without mission-initialization approval. All 108 source SCNs receive initialization
metadata; this does not assert mission playability or renderer acceptance. See
[the all-terrain proof and publication handoff](../../../docs/all-terrain-palettes.md).
Interface palettes are not published. Nonstandard RMP sizes anywhere
in the source tree are diagnosed, including the 67584-byte multiplayer table.

The [legacy variant investigation](../../../docs/phase2-legacy-variants.md)
records the short-RMP and tag -3 FIN evidence, focused corpus tests and exact
remaining blockers. Neither variant is promoted to decoded output.

## Publication

A complete staged build is renamed to the sibling
`.indexed-generations/<index-sha256>/` directory. A relative `indexed` symlink
is then atomically replaced using rename. Build errors cannot replace a working
publication. Previous generations are retained, so readers pinned to a generation
remain valid. No timestamps, machine paths, or process IDs enter generated files.
An existing ordinary output directory is rejected rather than removed.

Deploy the symlink with its sibling generation directory, or dereference it when
packaging. Readers needing a snapshot across a concurrent rebuild should resolve
the symlink once and read that immutable generation. Do not edit published
generation files. Old generations may be removed only when no reader uses them.

## Corpus Verification

Current corpus: 5 palette triples (ATLANTIS, DESERT, HTRAIN, JUNGLE, PALETTE),
4 terrain banks / 4764 tiles, 284 SPR atlases / 9730 frames / 26 empty frames,
164 parsed FINs of 177, and 2 initial missions. There are 1056 hashed outputs,
plus `index.json` and `index.sha256`.

Tests compare every SPR frame and BTS tile rectangle to existing generated
metadata, every source index and coverage byte to the parsers, all key lookups to
the existing resolver, all tables to native inputs, and two complete extractions
for determinism. Asymmetric synthetic fixtures cover compressed literal zero
(the real corpus has no such covered pixels), raw matte, source row order and
empty frames. Publication tests cover generation switching, failure preservation
and refusal to overwrite an ordinary directory. No browser or live-renderer
acceptance is implied.
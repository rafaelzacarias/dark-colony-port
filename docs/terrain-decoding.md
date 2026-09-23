# Verified terrain decoding

Verified against the local source corpus on 2026-09-18. This supersedes the
three-tile-references-per-cell interpretation. No replacement art is generated.

## MAP equation

All values below are little-endian. Let `W = u32(0)`, `H = u32(4)`,
`N = W * H`, and `cell = y * W + x`.

```text
file length            = 8 + 6*N
backgroundKey[cell]    = u16(8 + 4*cell)
foregroundKey[cell]    = u16(8 + 4*cell + 2)
attributes[cell]       = u16(8 + 4*N + 2*cell)
```

The first plane is interleaved background/foreground pairs. The second plane
is one attribute word per cell. It is NOT a third tile plane, and the file is
NOT an array of six-byte cell structures. Treating the attribute words as BTS
keys caused almost all of the previously reported 44.8576% failure rate.

## BTS equation and missing keys

The existing BTS record decoder was correct:

```text
keySpace       = u32(0)
recordCount    = u32(4)
palette        = bytes[8:776]          (256 RGB triples)
recordOffset   = 776 + 1028*recordIndex
key            = u32(recordOffset)
pixels         = bytes[recordOffset+4:recordOffset+1028]
file length    = 776 + 1028*recordCount
```

The original game allocates `keySpace` 16-bit lookup entries, clears them to
zero, then assigns `lookup[key] = recordIndex` for each BTS record in file
order. Both MAP words are passed through this same table.

Consequently an absent, in-range key maps to **record index 0**, not tile key
0. This is an executable-confirmed default, not a nearest-tile heuristic.
The resolved background index 0 remains a background record; resolved
foreground index 0 denotes no foreground. An explicitly present first-record
key also maps to record index 0. Keep the distinction between keys and indices.
Out-of-range keys are rejected by this extractor rather than emulating an
out-of-bounds read. No such keys occur in the corpus.

Missing nonzero keys remain listed in metadata, with separate background and
foreground counts. A resolved index does not prove that the corresponding
source key exists or that absent-key artwork has been recovered.

## Executable evidence

DC.EXE SHA-256:
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.

Addresses below are virtual addresses, image base `0x400000`. For its code
section, `fileOffset = VA - 0x400c00`; for DGROUP strings,
`fileOffset = VA - 0x402400`. Zero section virtual sizes confuse the installed
LLVM objdump, but raw x86-32 decoding works.

| Address | Verified operation |
| --- | --- |
| `0x4531a8` | BTS loader entry; reads two u32 counts and 768 palette bytes. |
| `0x453275` to `0x453299` | Allocates `2*keySpace` bytes and zero-fills the lookup. |
| `0x4532b0` to `0x4532e7` | Reads each u32 key, stores the zero-based record index at `lookup + 2*key`, then reads 1024 pixel bytes. |
| `0x435e6e`, `0x435e73`, `0x435e84`, `0x435e8e` | Calls BTS loader, obtains its lookup pointer, passes it unchanged to MAP loader. |
| `0x453320` | MAP loader entry; reads W and H. |
| `0x4534d1` to `0x45350f` | Reads two u16 values per cell and resolves both through the lookup. |
| `0x453512` to `0x4535ed` | Checks resolved indices using assertions named `backgroundl` and `forgroundl`. |
| `0x4535ed` to `0x453605` | Packs `backgroundIndex | (foregroundIndex << 11)`. |
| `0x453657` to `0x45378b` | Separate second row/column traversal, reading one u16 attribute per cell. |
| `0x4536ab` to `0x4536cb` | ORs `attribute << 22` into the packed cell; sets bit 29 if bit 31 is clear. |
| `0x453732` to `0x45375b` | Uses `attribute >> 10` as a per-tile histogram bucket, for both layers when foreground is present. |
| `0x45375f` to `0x453774` | If resolved foreground is zero, clears packed bits 22..25. |
| `0x406664`, `0x40667c` | Read helpers for 2-byte and 4-byte elements, respectively. |
| `0x46cb5c` | Byte-fill helper used to zero the lookup. |

The third word therefore contains non-tile state. Its upper bits feed a
per-tile histogram; the most frequent bucket is retained by the loader.
The lower ten bits participate in the packed cell state. Names and visual
semantics for individual flags/buckets are **not established here**. Export
the full word unchanged; do not label it as another sprite, brightness, or
collision data without further evidence. Palette/light-table rendering and
the meanings of the separate MTG/PTH data are not solved by this change.

## SET investigation

The two supplied binary SET files satisfy:

```text
DESERT.SET: 2,107,076 = 4 + 656 * 3212
JUNGLE.SET: 2,017,140 = 4 + 628 * 3212
```

MAPED.EXE SHA-256:
`e8471a0adcade0d0562f0e38ddbc85ebbd0776f50cc7429628dee435fa6a8f7e`.
Its code section uses `fileOffset = VA - 0x40fa00`.

At `0x41133e` the editor reads the SET count, then at `0x41134e` multiplies it
by `0xc8c` and reads that many bytes into a separate table. At `0x4113cf` it
changes the filename extension to BTS and calls the BTS reader at `0x41143c`.
The BTS reader at `0x411633` to `0x41164f` independently confirms
`lookup[key] = recordIndex`.

These editor records are not the missing stage in the game's MAP-to-BTS
resolution: the game loader demonstrably uses the BTS lookup directly.
Internal SET field semantics remain unproven and are not exported or guessed.

## Corpus coverage

108 maps, 1,345,872 cells, 4 banks, 4,764 BTS records:

| Plane | Words | Zero words | Direct BTS matches | Absent nonzero keys |
| --- | ---: | ---: | ---: | ---: |
| Background | 1,345,872 | 0 | 1,344,489 | 1,383 |
| Foreground | 1,345,872 | 1,230,788 | 115,038 | 46 |
| Attributes, not tile references | 1,345,872 | 3 | 88,224 accidental numeric matches | Not applicable |

Direct tile coverage: `1,459,527 / 1,460,956 = 99.9021873348684%`.
The 1,429 absent references span 44 bank/key combinations. Every tile word
is in its bank's key space and has deterministic original-game lookup behavior.
The old count included 1,345,869 nonzero attributes, producing 1,259,074
apparent failures out of 2,806,825 nonzero words.

HUMAN01: 9,081 direct references and four absent background references
(key 4092 twice, key 4132 twice). ALIEN01: 8,792 direct references, none absent.

## Runtime contract

The map index and per-map metadata now use **schemaVersion 2**. Old consumers
must not continue using a three-word stride. Terrain metadata retains schema
version 1 with the additive `tiles[].recordIndex` field.

All binary arrays are little-endian and all cell arrays are row-major.
Resolve each binary filename relative to its per-map metadata URL.

| Metadata field | Array length | Interpretation |
| --- | --- | --- |
| `files.tileReferences` | `2*N` u16, `4*N` bytes | Raw source key pairs. `referencesPerCell` is 2. |
| `files.tileRecordIndices` | `2*N` u16, `4*N` bytes | Executable-resolved BTS record-index pairs. |
| `files.attributes` | `N` u16, `2*N` bytes | Raw attribute plane, separate from references. |
| `files.tags` | `N` u8 | Existing MTG payload, unchanged. |
| `files.pathGrid` | `N` u8 | Existing PTH payload, unchanged. |
| `files.pathPreamble` | 65,536 u8 | Existing PTH preamble, unchanged. |

For cell `cell`, use `tileRecordIndices[2*cell]` as the background atlas record
and `tileRecordIndices[2*cell+1]` as foreground. Atlas records are in BTS file
order, so `terrain.tiles[index]` has `recordIndex === index`. Match bank names
case-insensitively through the terrain index; SCN values often use lowercase.
Skip foreground when its **resolved index** is zero. For nonzero foreground,
palette index 0 is transparent, as already encoded in the atlas.

`directBtsReferences` counts nonzero raw keys present in BTS.
`unresolvedReferences` still counts nonzero raw keys absent from BTS, even
though original-game lookup resolves them to index zero. `missingKeys` lists
`{ key, backgroundCount, foregroundCount }`, sorted by key. The explicit
`missingKeyPolicy` is `original-executable-zero-initialized-record-lookup`.
Never replace absent keys with neighbors, averages, SET entries, or inferred art.

## Reproduce

Run from the repository root:

```sh
node --import tsx --test tools/extractors/maps/*.test.ts
node --import tsx tools/extractors/maps/audit.ts raw_cd/DC/SCENARIO
```

The first command passed 7 tests, including the full 108-map corpus gate.
The audit emits NDJSON bank information, independent raw-region statistics,
per-map missing keys, and aggregate counts. It compares every parsed word to
the corresponding source offset. The corpus test skips only if the local CD
scenario directory is absent; it was present in this verification.

Regenerate only the owned asset outputs, without running the shared pipeline:

```sh
node --import tsx --input-type=module -e '
import { extractTerrainBanks, extractMapBundles } from "./tools/extractors/maps/extract.ts";
await extractTerrainBanks("raw_cd/DC/SCENARIO", "public/assets/generated/terrain");
await extractMapBundles("raw_cd/DC/SCENARIO", "public/assets/generated/maps");
'
```

This regeneration was performed. Every exported raw reference plane and
attribute plane was compared byte-for-byte with its source MAP slice; all
108 comparisons passed. All resolved-index buffers had exactly `4*N` bytes.
No shared extraction index, application source, package configuration, or
architecture document was modified by this work. Runtime integration and
visual verification are outside this extractor-only change.
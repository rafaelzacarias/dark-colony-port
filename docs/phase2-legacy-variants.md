# Phase 2 Legacy Variant Investigation

Status: **blocked, not accepted**. This bounded investigation adds corpus and
diagnostic-export regression tests, not a production decoder. No generated
assets, runtime code, shared architecture matrix or acceptance audit were changed.
No additional agents or browser windows were used.

## Selection and Evidence Boundary

The short multiplayer RMP is the closer structural candidate: its 67,584 bytes
can be divided into 264 complete 256-byte rows. The lighting FIN headers do not
fit the standard format at all. However, that arithmetic does **not** verify RMP
bank boundaries, row selection, brightness, team selectors or effect operands.
Neither candidate currently has enough evidence for semantic decoding. The
requested blocker fallback is used instead of padding, retagging or fabricating
output. Supported counts remain 20 standard RMPs and 164 standard FINs.

Sources of evidence:

- [Phase matrix](../ARCHITECTURE.md), read without editing.
- [Native palette contract](palette-runtime.md) and
  [standard FIN composition](render-composition.md).
- Current palette exporter and FIN parser, all 21 RMPs and all 177 FINs.
- Read-only disassembly of DC.EXE, SHA-256
  `65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.

The new native checks pin the executable hash and instruction bytes. They are
static evidence, not an execution probe or proof about every loader in the game.
Older research notes describing a seven-byte standard FIN header contradict the
current decoder and are not used as evidence.

## Short Multiplayer RMP

Source: `raw_cd/DC/SCENARIO/MPLAYER/PALETTE.RMP`.
SHA-256: `364faf322e0e10eda4315d25fd5561c116d613ca5c487d267c5d258a715fc61f`.

Verified observations:

- Length is 67,584 bytes: 65,536 + 2,048, or 264 * 256. These are possible
  partitions, **not** verified bank/row semantics.
- The first 256 bytes are all index 10.
- It is not a byte-for-byte prefix of any of the 20 standard RMP files.
- None of its eight final 256-byte blocks equals any complete row in any of
  those 20 standard files: 122,880 row comparisons.
- All 20 standard tables still round-trip through `RemapTable` byte-for-byte.
  The short table is rejected rather than extended to the standard size.
- The inspected native loader opens the RMP at `0x44f249`, requests `0x30000`
  bytes at `0x44f254`, calls the read routine at `0x44f260`, and jumps toward
  cleanup at `0x44f267`. That path has no short-size conversion dispatch.

Remaining blockers:

1. No verified producer or consumer for this 67,584-byte variant. Find its
   original editor/game-version loader or generator and trace its addressing.
2. No verified interpretation of the 2,048-byte suffix. It must not be labelled
   as teams, effects or a replacement body bank from its size alone.
3. No evidence that padding, repeating rows or borrowing another palette's
   banks reproduces the missing 129,024 bytes of a standard table.
4. No native short-read execution probe or established fallback initialization
   for this input. The standard loader's requested byte count is not evidence
   that its resulting memory is a valid remap table.

The corpus comparisons only rule out exact reuse of shipped standard bytes.
They do not rule out a different palette, an older generator, a truncated file
or other layouts. No indexed texture or palette metadata is emitted for it.

## Legacy Lighting FINs

All eleven files have signed tag -3. The following are raw little-endian header
words, **not** assigned dimensions or timeline/state/sprite counts:

| File | Bytes | Word +2 | Word +4 | Word +6 |
| --- | ---: | ---: | ---: | ---: |
| LIGHT1B.FIN | 190 | 49 | 145 | 2 |
| LIGHT1M.FIN | 116 | 49 | 145 | 2 |
| LIGHT2B.FIN | 116 | 208 | 112 | 2 |
| LIGHT2M.FIN | 116 | 208 | 112 | 2 |
| LIGHT3B.FIN | 116 | 144 | 336 | 2 |
| LIGHT3F.FIN | 2146 | 144 | 336 | 4 |
| LIGHT3M.FIN | 116 | 144 | 336 | 2 |
| LIGHT4B.FIN | 116 | 368 | 241 | 2 |
| LIGHT4F.FIN | 2146 | 368 | 240 | 4 |
| LIGHT4M.FIN | 116 | 368 | 240 | 2 |
| LITE.FIN | 1492 | 84 | 43 | 2 |

All start with ASCII `NONAME` at byte 8. Visible names at 16-byte spacing and
word +6 suggest a name table, but do not establish state ranges or record
semantics. The tests preserve these observations without emitting a schema.

The inspected standard FIN loader at `0x4256a9` requests two bytes and reads
them at `0x4256b7`. It then invokes three word reads at `0x4256c6`,
`0x4256d5` and `0x4256e4`, without branching on the first word in this header
sequence. No legacy conversion was established there. This is **not** a claim
that the executable explicitly rejects tag -3 or has no other loader.

For every legacy file, interpreting the header as standard counts puts the
child-table start beyond EOF. Changing only the tag to 29 still throws a
truncation error. Therefore accepting -3 in `parseFin` would not be a valid fix.

Remaining blockers:

1. Find the legacy loader/writer and prove the header words and name-table
   boundaries, including the role of `NONAME`.
2. Establish record sizes, count/offset relationships and exact EOF consumption
   across both the 116-byte files and the larger variants.
3. Establish whether records contain lighting primitives, animation events or
   sprite placements; prove operand signedness and timing before translating
   them into the standard FIN child schema.
4. Establish runtime use of these files. A filename containing LIGHT does not
   prove compatibility with native palette/shadow effects.

The animation exporter retains all eleven as `unsupported`, with source hashes
and tag -3 diagnostics. Its isolated legacy-only export contains just
`index.json`: no invented timelines, states, children or per-file metadata.
Two exports are byte-identical. The full FIN census remains 164 parsed,
11 unsupported and two invalid (`ANIM.FIN`, `BUILDING.FIN`).

## Verification and Integration

From the repository root:

```sh
node --import tsx --test tools/extractors/palettes/variants.test.ts
```

Result: **4 passed, 0 failed, 0 skipped**. Tests read the real corpus, not
generated assets. The export check copies only eleven small FIN files into a
unique OS temporary directory and removes it afterward. It never publishes to
the shared generated directory. The test is also discovered by `npm test` and
`npm run test:indexed`; it requires the source corpus and pinned DC.EXE.

Reproduce the native disassembly with the existing read-only audit tool:

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918 \
  python3 tools/research/trigger-audit.py disasm 0x4256a9 0x4256e9
PYTHONPATH=/tmp/dc-re-capstone-20260918 \
  python3 tools/research/trigger-audit.py disasm 0x44f200 0x44f27d
```

The temporary Python path must contain Capstone; use an equivalent isolated
environment if absent. Neither command runs the original game.

No regeneration is necessary for this test/documentation change. After a future
evidence-backed decoder is implemented and its schema reviewed, the integration
owner can run `npm run extract-indexed -- --output <isolated-output-path>` to
validate a separate publication, then run `npm run extract-indexed` once under
exclusive ownership of the shared publication. Full `npm run extract-assets`
is only needed if the legacy non-indexed generated animation tree also changes;
it regenerates unrelated assets and must not run concurrently here.

Neither successful tests nor a future decoder alone promote phase 2 or any
other phase. Native effect composition and general static-object semantics
remain separate acceptance work.
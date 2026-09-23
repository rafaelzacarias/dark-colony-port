# Independent Phase 2 Acceptance - 2026-09-19

## Decision

**ACCEPTED: Phase 2 source interpretation and deterministic asset conversion
for the pinned shipped DC.EXE source subset defined below.** The remaining
general noncolony static-semantics blocker is closed. No required unknown
format or occupancy rule is waived. This is not acceptance of every disc file
as playable content, a complete source recording, or native gameplay/rendering
parity. Phases 3, 4 and 5 remain unaccepted; Phase 1 acceptance is unchanged.

This decision reconciles the historical blockers in
[ARCHITECTURE.md](../ARCHITECTURE.md#phase-gates) and the original
[Phase 2 requirement checklist](phase-acceptance-audit.md#phase-2-assets),
against current source and the later closure evidence. The checklist explicitly
requires **required** FIN variants and dependency investigation before treating
malformed files as required content. The
[extractor contract](../tools/extractors/README.md) requires versioned layouts,
bounds checks, fixtures/goldens and deterministic output; it already retains
unsupported/invalid FIN diagnostics. Acceptance does not replace those contracts
with an opening-mission-only gate or permission to guess missing data.

Only this new document is owned by this review. No source, existing document,
generated asset or source inventory is edited. No browser, agents, full suite,
build or asset regeneration is run. **Final integrated full-test/build counts
are pending the orchestrator's final result**, not inherited from the historical
416-test snapshot or assembled by adding overlapping focused-test counts.

## Exact Source Boundary

The executable is DC.EXE SHA-256
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
The supplied 5,151-file source tree is pinned by manifest tree SHA-256
`864a9a581d741252bf0ca86fadaac32e9f504b7be7a379339ce69bdb2a7be531`;
the inventory file SHA-256 is
`c30023c0066ea3ad15ba7c8197ff2c828d5d380c4aee5b4a542d7c91ccb49cd7`.
This workspace has no Git metadata; no commit identity is asserted.

| Accepted interpretation/conversion | Exact extent and evidence |
| --- | --- |
| SPR and standard FIN | All 284 SPRs, 9,730 frames including 26 empty sentinels; 164 parsed standard FINs with states, events, placements, flags and orphan children retained. The complete census remains 177 FINs. The native required graph is 13 manifests, 127 distinct FINs and 187 declared SPR names, all supported. See [runtime dependencies](asset-runtime-dependencies-20260919.md). |
| Terrain and navigation data | Four BTS banks, 4,764 tiles, all 108 MAP/MTG/PTH bundles and 1,345,872 cells; source key fallback, separate attributes, orientation, mirrors, routing prefix and typed planes. Source interpretation does not certify the browser's A* as native routing. |
| Palettes | Standard RGB555 and three-bank RMP layout; five published root GIF/RGB/RMP triples. Exact initial-use semantics for ATLANTIS, DESERT, HTRAIN and JUNGLE, both initial phases and validated team selectors, across all 108 SCNs (6/45/15/42 respectively). PALETTE remains published without mission-initialization approval. The 15 standard INTRFACE RMPs have supported layout but are not published indexed mission triples. See [all-terrain initialization](all-terrain-palettes.md) and [indexed schema](../tools/extractors/palettes/README.md). |
| Tables and scenarios | 106 GAMESTAT rows, 64 weapons, 80 dependency rows with preserved prerequisites, source damage matrix, all 108 SCNs and associated TRO/MSG/briefing/outcome data. Unnamed source fields remain ordered data, not invented runtime semantics. |
| City and initial levels | All 864 teams: 776 ten-field and 88 twelve-field City lines, plus 6,912 following unit rows. Native scanner consumes five City pairs; sixth pair is preserved but not a sixth building configuration. Exact slot/type and initial upgrade mapping is established by [real-parser goldens](scenario-city-layout.md). |
| Static occupancy | All 4,377 ordered placement inputs, required City roots, newtype operands and positive-count native-parsed reinforcement groups; all 23 required zero-speed noncolony types and the separate colony contract. Auxiliary readers are classified by actual consumers, not file-size guesses. See [static occupancy](static-occupancy-20260919.md). |
| Media | All 259 effect WAV sources, 59 AVI conversions with browser alternatives, and four subchannel-free CDDA tracks. PCM alternatives preserve available source samples; BEAT is explicitly incomplete. Codec accessibility is separate from sound scheduling and device audibility. |

The scenario corpus includes campaign, training, multiplayer, test and spare
files, not just the two currently demonstrated opening missions. Neither corpus
inclusion nor loader preflight asserts that every scenario is selectable or
playable. Modified manifests/scripts, custom scenarios, editors, other game
executables and externally imposed working directories are outside this pinned
DC.EXE runtime-dependency proof, not silently supported extensions.

## Why The Exclusions Are Native

The eleven tag -3 FINs, invalid ANIM.FIN/BUILDING.FIN, and all owners of the
twenty missing-sprite diagnostics are outside the shipped startup/UI manifest
closure. Native loaders request literal manifest filenames and eagerly load
declared sprites. GAMESTAT-generated names resolve states in the loaded registry;
the inspected helpers do not load another FIN on a missing state. All shipped
UI `animation` directives are accounted for. These are loader-based exclusions,
not exclusions based on filenames, initial placements, inconvenience or a claim
of proven authoring provenance. Rejections and missing bindings remain visible.

The [RMP closure](rmp-runtime-20260919.md) executes the SCN basename chain for
all 108 originals, native extension/open/CD-fallback logic and complete reads of
the five root tables. Installation lists omit the short multiplayer RMP. The
game does not search scenario subdirectories for the selected root basename.
The 67,584-byte file remains rejected: forced native reads show a zero tail on
first allocation or retained prior bytes on reuse, not a context-independent
compact format that can legitimately be padded or expanded.

O16/OVH are overview image inputs in the corresponding native readers; the
subsequent ground-pointer table is not a copy of their pixels into occupancy.
Binary terrain SET records belong to MAPED, not the SCN constructor. Their
unclaimed editor internals therefore do not leave a required DC.EXE collision
rule unknown. COLOUR.SET is distinct color data. A demonstrated additional
required reader/dependency would reopen the affected gate; no universal
non-use theorem for every executable or custom input is claimed.

## Static Blocker Closure

The retained complete native trace reports 108 scenarios / 4,377 input rows,
2,013 zero-speed entity records and 601 nonentity records. Its captured records
are the static/nonentity subset, not 4,377 static records. It includes 138
constructor/removal cases, 23 static reinforcement groups, exception/removal
fixtures and reader evidence for DC.EXE, DC16.EXE and MAPED.EXE.
`unsupportedRequiredTypes` and `unsupportedOperands` are empty.

Required noncolony IDs are
`37,40,41,42,45,46,47,48,82,83,84,85,86,87,88,89,90,91,94,95,97,98,100`.
Owner 8 bypasses occupancy; otherwise nonzero auxiliary field selects auxiliary,
then nonzero movement byte selects air, otherwise ground. Registration writes
one cell, preserves high flags and overwrites the low ten slot bits. There is
no sprite-bounds rectangle or speed-based occupancy predicate. Generic removal
is the proved clipped X/Y/plane-ordered first-match scan, not rectangle clearing.
Metadata, FIFO, resource MAP flags, race substitution and colony slots retain
their distinct native dispatch. Unreferenced zero-speed types are not proof of
absent production/death behavior; the general registration rule still uses
the actual fields, whose source mapping covers all 106 definitions.

Current [helper](../src/engine/legacy-static-occupancy.ts) implements those
registration/removal contracts. Current
[MissionView registration](../src/mission-view.ts#L362) uses the source-field
adapter for slots >=120 and supplies only a ground registration as a ground
footprint. Colony projection remains separate. Thus the static report's older
"host still needs integration" sentence is superseded for that call site.

This does **not** equate the browser's overlap-safe blocker reference counting
with native overwrite/first-match cleanup, implement full air/auxiliary-plane
simulation, or certify resource, production, death, slot-release and transport
timing. Those are Phase 3 execution requirements; the source occupancy semantics
are now known rather than deferred or guessed.

## Malformed Source And Audio

Malformed source does not itself preclude faithful decoding of bytes that
exist. It precludes claiming recovery of bytes that do not exist.
[The publisher](../tools/extractors/media/effect-wav.ts) validates the original
size/hash, copies available PCM, retains sample format/rate/channels and source
fingerprint, and records an independently hashed content-addressed output.
It never pads the missing audio with synthesized samples. Of 259 references,
248 preserve original files, ten rewrap malformed containers without changing
PCM, and one is labelled `truncated-source-pcm`; these resolve to 256 unique
PCM files. Publication is deterministic and does not mutate the raw source.

BEAT's original 236-byte file has SHA-256
`8fc1bc3fb89185bd8f1c0eb3bbdaa8c4d14e15ed534f039c89b82aab818fda78`.
Its declared 34,758 PCM bytes contain only 192 available bytes: 96 mono 16-bit
frames at 22,050 Hz, approximately 4.354 ms. The absent 34,566 bytes remain
absent. Available PCM SHA-256 is
`d13790174c2f45f4d494d83a72e4394576134fca2cfee28282bde901607c7c5e`;
rewrapped output SHA-256 is
`9b4446ac750fc146c369581e29c181b6a529d05401c22dc4c9eb2d609f301480`.
Acceptance is for this immutable source fingerprint and explicit incomplete
conversion, never for a complete BEAT recording or native audible equivalence.

The supplied orchestrator evidence reports actual Web Audio decoding of all
259 PCM alternatives, with zero successful Opus decodes in that embedded
environment. It also reports 8,192 exact WebGL pixels across all four banks
and both initial phases. These are credited as supplied execution evidence,
not browser runs independently performed by this reviewer. The supporting
audio/palette documents' earlier browser-check handoffs are not themselves
those results. No physical-speaker, WebKit/iOS, full native effect composition,
continuous lighting/fog or campaign-parity claim follows from these probes.

## Reproduction And Review Evidence

[Current reproduction](asset-reproduction-20260919.md) establishes **3,630
published files / 482,395,625 bytes**, zero added/missing/changed files between
publication and isolated output, 1,438 matching JSONs, 2,737 index/source checks
per corpus and 419 additional DATA source checks. Published raw tree SHA-256:
`738cdaf9741648a69cf932e0aa91abdcb714f6926c7500c8b3feec873d959dcf`.
Active indexed generation:
`b86dde044988163b2b255f584b124e7cc74af59564c312b6faaefccacf68647c`.

This is an exhaustive current comparison extending a retained clean full-ingest
baseline with normal DATA/INDEXED/PCM publication, **not a new clean full ingest
of 3,630 files**. Unchanged media/CD bytes were preserved and rehashed, not
retranscoded in the latest refresh. Both Finder-only differences are explicitly
excluded from published assets; unsupported diagnostics remain in reproduction.

This review independently inspected the original contracts, current helper,
MissionView call site, PCM publisher and focused tests; inspected the complete
static report at `/tmp/dc-static-final-4851.json`; and authenticated the recorded
SHA-256 values of `current-comparison-01.json`,
`current-shared-index-checks-01.json` and `current-verify-02.log` under
`/tmp/dc-reproduction-20260919-lB2ic3a8`. The completion log and comparison agree
with the counts above. Existing reports are evidence with their stated native
slice/IO interception boundaries, not original-game boots.

Independent focused execution in this review:

```sh
PYTHONDONTWRITEBYTECODE=1 DC_STATIC_NATIVE_TRACE=/tmp/dc-static-final-4851.json \
	node --import tsx --test tools/qa/legacy-static-occupancy.test.ts \
	tools/qa/static-mission-occupancy.test.ts tools/qa/scenario-city-layout.test.ts
```

**17 tests passed, zero failed or skipped.** This rechecks all 535 static-trace
source hashes, all-106 native field mapping, source-derived ground blocking and
cleanup fixtures, and the actual City scanners across the 108-SCN corpus. It
does not rerun the entire static native research probe or the full suite.

A separate read-only check rehashed every current published path: all 3,630
files / 482,395,625 bytes still match the retained snapshot and published tree
hash, with no extra, missing or changed paths. All 64 retained extractor/ingest
file hashes still match. All 259 current WAV alternatives match deterministic
conversion of their size/hash-verified originals, with the exact 248/10/1
conversion split. BEAT's original/output/PCM hashes, 192 identical available
sample bytes and 96-frame length pass explicit assertions. Complete native
report counts, all three auxiliary-reader reports and both empty unsupported
sets were also asserted. No output was published by these checks.

Historical architecture/audit status text remains untouched. This decision
supersedes only its enumerated Phase 2 blockers for this pinned source subset.
It does not promote Phase 3 faithful runtime, Phase 4 faithful rendering or
Phase 5 end-to-end verification, and supplies no final full-build count.
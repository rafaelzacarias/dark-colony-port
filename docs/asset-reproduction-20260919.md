# Current Raw Scenario Reproduction Acceptance - 2026-09-19

## HUMAN05 Message Correction - 2026-09-22

The historical tree hashes below predate the source-proved `text 5.` parser fix.
[HUMAN05 reproduction evidence](human05-messages-20260922.md) records a fresh
isolated DATA export: 303/303 files match, with only HUMAN05 message JSON changed
(1558 to 1590 bytes). Raw sources, source inventory and DATA index are unchanged;
2737 declared index checks pass. This is not a new full-tree reproduction claim.

## Decision

**PASS: 3,630 published files / 482,845,897 bytes match the isolated output
exactly.** Current comparison: **3,630 identical, 0 changed, 0 added, 0 missing**.
All **1,438 JSON files / 37,834,790 bytes** match both raw and canonical structured
hashes. **108/108 original SCN files** roundtrip exactly through `rawScenario`
base64 in each corpus, including source SHA-256 and every pre-existing field.

This is **incremental reproduction, not a new full re-decode**. Only the normal
DATA exporter ran, targeting the retained isolated output:

```text
/tmp/dc-reproduction-20260919-lB2ic3a8/generated/data
```

The isolated before snapshot exactly matched the prior 3,630-file acceptance,
including physical generation storage. Its new delta is **108 changed scenario
JSONs, 0 additions and 0 removals**, totaling **450,272 additional bytes**.
The sole structured change in each is the new `rawScenario` field. All other
3,522 published files, including **every index**, are byte-identical to that
baseline. The DATA index remains 25,611 bytes, SHA-256
`281fbd721919f6e12cff74a63d2b45b43f4b56b219b127866ba1ea5316f2c351`.

Only this document was edited in the workspace. The existing
[verifier](../tools/qa/asset-reproduction.mjs) was reused unchanged; the additional
runner and reports live in the isolated evidence directory. No shared generated
write, source-inventory write, main/engine/package edit, agent, browser, full
suite, FFmpeg, media export or indexed export was performed by this task.

## Exact Checks

| Check | Count | Result |
| --- | ---: | --- |
| Published path, byte count and SHA-256 equality | 3,630 | PASS |
| JSON raw and canonical structured equality | 1,438 | PASS; no stripped fields |
| Physical generation payload equality | 2,222 | PASS; active and orphan generations |
| SCN exact decoded bytes, canonical base64 and source SHA-256 | 108 per corpus / 216 total | PASS |
| Entire previous scenario object preserved after removing only new `rawScenario` | 108 per corpus / 216 total | PASS |
| Fresh parser fields compared with exported fields | 108 per corpus / 216 total | PASS |
| Declared index/source hash checks | 2,737 per corpus / 5,474 total | 0 failures |
| DATA source-hash checks, including outcomes | 419 per corpus / 838 total | 0 failures |

The independently enumerated raw-source census is exactly 108 SCNs, totaling
335,886 original bytes; both checked source-path lists equal that census.
Parsed-field checks include terrain bank, ID, title, raw header, every team and
placement row. The stronger previous-object check also preserves schema, source
metadata, outcomes and any other existing fields. This is not a comparison of
decoded text: each decoded buffer equals the original file bytes.

Each corpus's 2,737 checks comprise 1 indexed checksum, 1,162 indexed outputs,
604 indexed sources, 644 combined-media output references, 318 WAV/AVI sources
and 8 CD output references. Repeated references do not inflate file counts.

## Current Hashes

Tree hash definitions are unchanged: sorted UTF-8 records of
`path + NUL + bytes + NUL + sha256 + LF`; structured records use
`path + NUL + structuredSha256 + LF` for JSON and raw SHA-256 otherwise.
Family/subset hashes retain their full relative path prefix.

| Corpus | Files | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| Published raw tree | 3,630 | 482,845,897 | `8f6c3536cdaa2242b76e810d8bc2e862af4f46a4eab3c7f211c318d58d95e991` |
| Published structured tree | 3,630 | 482,845,897 | `9a4bfa461afc7ef8da78661955c9844407fc8befcb4594ed1b94f6cdaf835178` |
| All JSON raw tree | 1,438 | 37,834,790 | `f9b867a2411125b912948a0c32c060fb88c74bb3f1e6a14bbc9f82255d76a7be` |
| All JSON structured tree | 1,438 | 37,834,790 | `7115ede1586e2dcebf06a16fd00713acc11c6f024c79feeffa1b74944e699986` |
| DATA raw tree | 303 | 3,766,135 | `2dd9c12e616f82f9f3e06d885df1b301b42208527474edfa004c78815a0024b3` |
| DATA structured tree | 303 | 3,766,135 | `82ee31cf1c5fb014c28201cb71146df5b9b2d12588201b4b83ab40fc7be9f0be` |
| Preserved media, including both indexes | 643 | 195,088,611 | `f55fd9aa3fc8d5eb9a2641253f43570304b859c36fa5af209df76beb25fb6438` |
| Preserved distinct PCM files | 256 | 13,004,380 | `ca47c589f0c84681acd95dcf364d65c86e6e77eff7f93b977fcc1f03a84f3015` |
| Preserved CD files | 9 | 24,495,882 | `c20e7f39245b8b5db30fccfd8c3df1e66e7961fb2af5a712d81ccf5877c18e69` |
| Preserved indexed logical tree | 1,164 | 215,361,696 | `dcf02b5cd3019e542c58fcc4d4bec0ae49423990bcaa3f62e43d21d467336f08` |
| Preserved physical generation payloads | 2,222 | 430,544,906 | `df85d9a1eeade71e116aa0475fee74663cf3519d35fa23c88bc441cf4994d07f` |
| Full shared snapshot | 5,854 | 913,405,147 | `4275c93b5266829424cb6b4a47d0c5551005083a775fe674c948432c3c100247` |
| Full isolated snapshot | 5,852 | 913,390,803 | `86afabf6f3fb30cbfc39493ffa44d5f779d7344f888451b1587dd04f3d0f1540` |

Sprites, animations, terrain, maps and interface retain the family counts, bytes
and hashes in the preceding-refresh report below. All media/PCM/CD outputs were
preserved and rehashed, not decoded or transcoded again. Both indexed links
retain generation `b86dde044988163b2b255f584b124e7cc74af59564c312b6faaefccacf68647c`.

**Only `.DS_Store` is exempted from asset equality.** No `._*`, JSON key,
diagnostic, source hash or generation payload is excluded. The full snapshots
differ only by the same two shared-only Finder files recorded below: root
`.DS_Store` (6,148 bytes) and `.indexed-generations/.DS_Store` (8,196 bytes),
with unchanged hashes. Physical generations are exhaustively compared separately
to avoid double-counting published assets, not omitted. Shared files, directories
and links are identical before/after this run, including Finder metadata.

## Source and Code Pins

Raw source remains **5,151 non-metadata files / 481,383,122 bytes**, SHA-256
`864a9a581d741252bf0ca86fadaac32e9f504b7be7a379339ce69bdb2a7be531`.
Including `.DS_Store`: 5,152 files / 481,389,270 bytes, SHA-256
`7145597aca0c1faab171aa367cacfa4401499df25b5e1de2660f28cb9f5856e3`.
Both the raw source and MDF/MDS snapshots match the prior acceptance and this
run's before snapshot. MDF remains 694,622,448 bytes, SHA-256
`2211981ebb330d205b98ceb32c4d14d02c566ea8b7d5e76fbe63e4094cff80c0`;
MDS remains 838 bytes, SHA-256
`d4a58a192975676b892b57a8a170f00eab11c2a89d2ccadcc00be84380fcbeb9`.
Source inventory remains
`c30023c0066ea3ad15ba7c8197ff2c828d5d380c4aee5b4a542d7c91ccb49cd7`.

Exporter code changed **before** this refresh: DATA export added the raw bytes
and its focused test changed. No other extractor/ingest code changed relative to
the preceding accepted snapshot (Finder metadata is recorded separately).

| Code pin | Bytes | SHA-256 |
| --- | ---: | --- |
| [DATA exporter](../tools/extractors/data/extract.ts) | 9,984 | `d63dfd0f39c7edbc6e7f1358f63649ce127f2ccb7537bcb49c493b4769e2a4f8` |
| [DATA exporter test](../tools/extractors/data/extract.test.ts) | 5,350 | `7a2bdc76f5cecc861a991137ff72b34e7a3b688c664f687baf81cb04d11dcc76` |
| [Unchanged verifier](../tools/qa/asset-reproduction.mjs) | 10,967 | `5d0950657cba6accf062a86e246a7cb063a846f7cc6f18513ffa1d7aabd1135a` |
| DATA subtree, 12 files including tests | 38,557 | `fb943f636665d3294220b14ef9fd347b42468dd5d24389723e7926f1bb81ae46` |
| Palettes subtree, 7 files | 45,585 | `1c6e4bcd87620a4139c4b8c01a5b98d0568ebacb7deefe3e8050c1b97d47a706` |
| Media subtree, 8 files | 30,582 | `1c87a46febf81335e015481ebf7b803544e082a6623354cb61a31fdf46c55680` |
| Ingest subtree, 6 files | 25,236 | `4376702b0a096f805ae638934ea0942b6959009da9d4e4128ea6a9291d9de6ff` |

All 172 tools files were unchanged during this run, tree SHA-256
`f029d14cae0fb3c3c744c66ee31567fd0606240cfa012e28858aca24c70e098d`.
Individual exporter/ingest/verifier pins and full before/after tools and source
snapshots are retained. Subtree hashes use paths relative to `tools`.

Do not reuse the old whole-runtime stability claim: concurrent work changed
[src/mission-view.ts](../src/mission-view.ts) from 80,082 to 80,221 bytes during
verification, SHA-256 `24fea3812f5375cdf643c1ae33480883dd2b06a289c2a853ea6517cb40ec726e`
to `b92063e2d886f75706b6a2e6a2a0ac496438006c6b58e72777b693c9a85fe6e5`.
It is not a DATA exporter dependency. The full 64-file source snapshot changed
from `97b377d899d8f83a8a939a69ca391bd86ee55e2424f3d72b3aa0f2cf08b4691a`
to `371bf6c6f7986dd4219569fef805c7356decf85c7b7fe72a165b565b23bd382c`.
These changes were neither made nor reverted by this task. The summary records
all code additions/changes since the prior run, not just these current pins.

Node v24.7.0, darwin/arm64 was used. Package/configuration files, installed
tsx/TypeScript metadata and source inventory were pinned and unchanged during
this run. Current package SHA-256 is
`26b5b160e74336a32c8711dc3d8490190e0caf57fa898e1d659a09afe6b88764`;
historical package/code pins below do not describe this run. Git provenance is
unavailable because the workspace has no Git repository metadata.

## Commands and Evidence

The normal exporter invocation was exactly:

```sh
node --import tsx --input-type=module -e 'import {extractGameData} from "/Users/rafael/Downloads/darkcolony/tools/extractors/data/extract.ts"; const result = await extractGameData("/Users/rafael/Downloads/darkcolony/raw_cd/DC", "/tmp/dc-reproduction-20260919-lB2ic3a8/generated/data"); console.log(JSON.stringify(result));'
```

All following artifact names are relative to
`/tmp/dc-reproduction-20260919-lB2ic3a8`. The isolated runner
`raw-scenario-refresh-01.mjs` invokes the existing verifier's `self-test`,
`snapshot`, `compare` and `verify-indexes` commands, retaining exact arguments
and cwd. The initial `raw-scenario-run-01.log` records successful DATA export
but was interrupted during the shared after-snapshot. It is **not** completion
evidence. The final runner adds a `--verify-only` resume path; that path reuses
the saved before snapshots and previous scenario objects, performs fresh after
snapshots and never exports again. Completed invocation:

```sh
node --check /tmp/dc-reproduction-20260919-lB2ic3a8/raw-scenario-refresh-01.mjs
node --import /Users/rafael/Downloads/darkcolony/node_modules/tsx/dist/loader.mjs /tmp/dc-reproduction-20260919-lB2ic3a8/raw-scenario-refresh-01.mjs --verify-only > /tmp/dc-reproduction-20260919-lB2ic3a8/raw-scenario-verify-02.log 2>&1
```

The completion marker is `RAW SCENARIO REFRESH COMPLETE`. Reports use exclusive
creation; retain these files and choose new names before another refresh.
The independent SCN census and evidence digests are also recorded in
`raw-scenario-final-facts-01.log`.

| Artifact | SHA-256 |
| --- | --- |
| raw-scenario-refresh-01.mjs (final resume-capable runner) | `ce66ca1664236ce17c7f2e96f6852f90724d37c6f6045ab3e4fd3fbf14e3229f` |
| raw-scenario-run-01.log (partial, export evidence only) | `0cea9c5194e503816be18087eff42d4077a39d459aa0d3b99f0bb6a056d1f9ef` |
| raw-scenario-verify-02.log (completed) | `b83ab08fb4eb1b7bdf68c17f7d8371257d3739c073e18e539242fa8f18a0edf5` |
| raw-scenario-01-summary.json | `98d51768596e6852b91f7c88299d1f2efaf1197120e0ef23bbe41eceb14e7ee1` |
| raw-scenario-01-scenario-checks.json | `971c21504f4a1db349937c93c2a220bb026ee6af2b9c36fc8d3bf17c7e8336dd` |
| raw-scenario-01-data-source-checks.json | `07213e8dbceda06f8ec8de1a71a87b8979bf1518007f23f0c687c8c9d3d8270c` |
| raw-scenario-01-comparison.json | `af8b8e46d712fcefcc71a3297f2186b3c7f363c3eadd78bf9d54e74ff348560b` |
| raw-scenario-01-isolated-index-checks.json and raw-scenario-01-shared-index-checks.json | `5daa67b29559fa740f0106cf670d35944e9c5a90919abfdb0c4c3f87c63185fa` |

The prior truncated-BEAT, FIN and RMP limitations below remain unchanged. Exact
asset reproduction does not establish complete audio, unsupported semantics,
runtime rendering/production correctness or all-phase acceptance.

---

# Previous DATA, Indexed and PCM Refresh - 2026-09-19

This section is historical evidence for the 3,630-file baseline before
`rawScenario` export. Its counts, hashes and run-specific stability statements
are superseded by the current acceptance above.

## Decision

**PASS: all 3,630 current published files / 482,395,625 bytes match the isolated
reproduction exactly.** There are **0 added, 0 missing and 0 changed files**
between current publication and isolated output. All **1,438 JSON files** match
byte-for-byte and by canonical structured hash. Each corpus passes **2,737
declared index/source hash checks, with 0 failures**. An additional **419 DATA
source-hash checks** pass against raw source files.

This is current incremental reproduction evidence, not a new clean full ingest.
The retained isolated corpus matched its accepted 3,267-file snapshot before
running the normal DATA exporter, INDEXED CLI and effect-WAV publisher. Unchanged
baseline media/CD and other families were preserved and exhaustively compared,
not retranscoded. No shared generated assets, source inventory, runtime files or
shared acceptance documents were written. No agents, browser, full suite or
FFmpeg invocation was used in this refresh.

Evidence and reproduced assets are retained at:

```text
/tmp/dc-reproduction-20260919-lB2ic3a8
```

## Current Coverage

| Family | Published files | Bytes | Coverage |
| --- | ---: | ---: | --- |
| sprites | 569 | 26,925,850 | 284 RGBA atlases and metadata; 9,730 frames |
| animations | 165 | 13,694,678 | 164 parsed FIN files and complete 177-file census |
| terrain | 9 | 4,164,960 | 4 banks; 4,764 tiles |
| maps | 757 | 23,390,873 | 108 MAP/MTG/PTH bundles; 1,345,872 cells |
| data | 303 | 3,315,863 | 106 units, 64 weapons, 80 dependencies, damage matrix, 108 scenarios and associated scripts/text |
| interface | 20 | 453,094 | 19 GIF images and index |
| media | 643 | 195,088,611 | 263 Ogg, 4 CD MP3, 59 MP4, 59 WebM, 256 distinct PCM WAVs, 2 indexes |
| indexed | 1,164 | 215,361,696 | 1,162 declared outputs plus index/checksum; 4 terrain banks and 108 SCN mission rows |
| **Total** | **3,630** | **482,395,625** | **Every published file byte-identical** |

INDEXED publishes five palette triples; initial-use verification covers ATLANTIS,
DESERT, HTRAIN and JUNGLE, not the generic PALETTE triple. Both published links
resolve to their own copy of the same generation:

```text
.indexed-generations/b86dde044988163b2b255f584b124e7cc74af59564c312b6faaefccacf68647c
```

The 259 effect-WAV index references resolve to **256 distinct content-addressed
files**, not 259 additional filesystem files. Conversion labels are 248
`original`, 10 `rewrapped-pcm` and 1 `truncated-source-pcm`. Reference-counted
PCM output bytes total 13,008,816; family bytes count each published path once.

Checks per corpus: 1 indexed checksum, 1,162 indexed outputs, 604 indexed sources,
644 combined-media output references, 318 WAV/AVI sources and 8 CD-index output
references. Repeated references are checked but do not inflate file counts.

## Full Comparison

The [verifier](../tools/qa/asset-reproduction.mjs) hashes every file's relative
path, byte count and SHA-256. Structured JSON hashing recursively sorts object
keys, preserving array order and every field. Diagnostics, source hashes,
conversion labels and all indexes participate; formatting-only changes fail
byte acceptance. Symlinks are dereferenced within the snapshot root; external
links and cycles are rejected.

Only files named `.DS_Store` are treated as host metadata. The former `._*`
exclusion was removed and covered by the focused self-test. Physical
`.indexed-generations` storage is reported separately: active assets are counted
once through `indexed/`; orphan generations are not published assets.

Full snapshots contain 5,854 shared versus 5,852 isolated file records, including
logical/physical indexed traversal. All 2,222 physical generation payload files
match: 1,164 active plus 1,058 in the old unreferenced generation. The only
filesystem differences are these two shared-only Finder files:

| Path | Bytes | SHA-256 |
| --- | ---: | --- |
| .DS_Store | 6,148 | `da654b74e90d674c3182c7fa044eb584662ad17513c05f1e6feae3cb0789f5d4` |
| .indexed-generations/.DS_Store | 8,196 | `08bd83129f89ade083da3f8b05f5d6bf776da5b41e4dd51e8f2ca92a557adc80` |

Shared before/after snapshots, including links, generations and metadata, are
identical. Full shared tree hash:
`08340e62af6e0ef7da32d26dee7b26b7c2ec4c0c69c4d26e268e1a229090d93e`.
Full isolated tree hash:
`b872b2cfd77c9e6a2f11e1b0028f1d946da1102e9aea18c3e39cf48c00aad53a`.
These filesystem hashes differ only because of the two Finder files. Absolute
resolved report roots necessarily differ; they are not generated asset fields.

### Published Hashes

Both current corpora have these hashes. Raw tree records are sorted UTF-8
`path + NUL + bytes + NUL + sha256 + LF`. Structured records use
`path + NUL + structuredSha256 + LF` for JSON, or raw SHA-256 otherwise.
Family hashes retain their family prefix in each path.

| Corpus | SHA-256 |
| --- | --- |
| Published raw tree | `738cdaf9741648a69cf932e0aa91abdcb714f6926c7500c8b3feec873d959dcf` |
| Published structured tree | `c3f8f04c792250eaa10a4f97cc6704491cde66f287a8d88dcf9cc5c251d8ea40` |
| sprites | `dfec8deb1825b8f74bd456c353801335e260d818a8883739ca0d6b15983f281e` |
| animations | `71adf5ae1028d659b58d3fb305c3549cf8fa684d33def3536790c815132a18c4` |
| terrain | `12f20dd4193530052e253f9c547edd2392cf6e03a2d7cd933fedcd3a59f39486` |
| maps | `f8ccd7645795017279011acb56c41fa817bb949d4199b0b998305017952b8fb7` |
| data | `df77d5c1431b0d7aaa0a3191c8db5b83eb8bf6c674335b8c4eb786ff68448b44` |
| interface | `f0bb90beff1bb00d21cd622585c32d979e413956742c9106714057fc2eb0e9d6` |
| media | `f55fd9aa3fc8d5eb9a2641253f43570304b859c36fa5af209df76beb25fb6438` |
| indexed logical tree | `dcf02b5cd3019e542c58fcc4d4bec0ae49423990bcaa3f62e43d21d467336f08` |
| Indexed index bytes / generation ID | `b86dde044988163b2b255f584b124e7cc74af59564c312b6faaefccacf68647c` |

## Preservation and Limitations

The retained baseline matched all 3,267 prior published and 1,058 physical
generation files before refresh. This run added exactly 363 published paths:
1 damage-matrix JSON, 106 indexed mission JSON files and 256 unique PCM WAVs.
It changed exactly seven paths: `data/index.json`, `indexed/index.json`,
`indexed/index.sha256`, ATLANTIS/HTRAIN/JUNGLE palette JSONs and `media/index.json`.
Nothing was removed. Per-file delta hashes are in `current-summary-01.json`;
these are changes from the retained baseline, not current comparison failures.

All **386 pre-existing media files other than the combined media index** remain
byte-identical, tree hash
`9c073954bc0646a57a23070b9cb0569b08b54d12042be720c480f9f8f3380d22`.
This includes all **9 CD files**: four Oggs, four MP3s and the CD index, tree hash
`c20e7f39245b8b5db30fccfd8c3df1e66e7961fb2af5a712d81ccf5877c18e69`.
The refresh rehashed the MDF/MDS and every retained output, but did not re-extract
CD PCM or transcode unchanged media. The four MP3s were preserved, not newly
produced in this run. Prior clean ingest/CD reproduction logs remain retained.

### Truncated BEAT

`SOUND/BEAT.WAV` is **236 bytes**, although RIFF declares 34,802 bytes and its
data chunk declares 34,758 bytes. Only **192 PCM bytes** are available after the
44-byte header: 34,566 declared PCM bytes are absent. Source SHA-256:
`8fc1bc3fb89185bd8f1c0eb3bbdaa8c4d14e15ed534f039c89b82aab818fda78`.

The publisher emits a valid 236-byte WAV containing exactly those 192 available
bytes: 96 mono 16-bit frames at 22,050 Hz, approximately **4.354 ms**, not complete
audio. Direct sample comparison passed; available PCM SHA-256:
`d13790174c2f45f4d494d83a72e4394576134fca2cfee28282bde901607c7c5e`.
The media index records `conversion: "truncated-source-pcm"`; the output is
`effect-pcm/9b4446ac750fc146c369581e29c181b6a529d05401c22dc4c9eb2d609f301480.wav`,
with that filename stem as its SHA-256. No missing samples were invented.

FIN limitations still reproduce: 11 unsupported tag -3 files, 2 invalid files
and 20 missing FIN-to-sprite bindings. The 67,584-byte multiplayer RMP remains
unsupported. Byte reproduction does not establish unsupported semantics, audio
completeness, runtime playback, rendering correctness or all-phase acceptance.

## Source and Exporter Pins

The raw source tree matches both the earlier full-ingest source and this run's
before snapshot: **5,151 non-metadata files / 481,383,122 bytes**, tree SHA-256
`864a9a581d741252bf0ca86fadaac32e9f504b7be7a379339ce69bdb2a7be531`.
Including its unchanged 6,148-byte `.DS_Store`, the 5,152-file snapshot hashes to
`7145597aca0c1faab171aa367cacfa4401499df25b5e1de2660f28cb9f5856e3`.
The shared source inventory is unchanged:
`c30023c0066ea3ad15ba7c8197ff2c828d5d380c4aee5b4a542d7c91ccb49cd7`.

| Input / entry point | Bytes | SHA-256 |
| --- | ---: | --- |
| Dark Colony.mdf | 694,622,448 | `2211981ebb330d205b98ceb32c4d14d02c566ea8b7d5e76fbe63e4094cff80c0` |
| Dark Colony.mds | 838 | `d4a58a192975676b892b57a8a170f00eab11c2a89d2ccadcc00be84380fcbeb9` |
| DC/GAMESTAT/MBULLET.TXT | 620 | `2244665ec4fc4f344b4ad32ec47e209c79a1a240d48f8f43a6035ceab0ae1d22` |
| tools/extractors/data/extract.ts | 9,927 | `85adbba80ca194602039bfb9f96d28a8bd428dc307b7c20d04de2e265fc5e068` |
| tools/extractors/palettes/cli.ts | 1,538 | `384580992d1c74c4b6afa6f44e0d80d35dd5a8a1be5bc07a8c98e40f43bbdb55` |
| tools/extractors/palettes/extract.ts | 13,049 | `ac77c42a3c07c258813bc9d6db240a6a2b9ed42665cbe3c84fc2c26d9b3709d8` |
| tools/extractors/media/effect-wav.ts | 8,337 | `7b1ce6d30c610f4611fb88c309026f5c74efcbfd3add112fbe565635c5f7fe96` |
| tools/qa/asset-reproduction.mjs | 10,967 | `5d0950657cba6accf062a86e246a7cb063a846f7cc6f18513ffa1d7aabd1135a` |

Every file under `tools/extractors` and `tools/ingest`, plus the verifier, was
pinned before export and asserted unchanged afterward. Individual pins are in
`current-tools-before-01.json`, `current-tools-after-01.json` and the summary.
Subtree hashes use paths relative to `tools` and include tests:

| Code group | Files | SHA-256 |
| --- | ---: | --- |
| extractors/data/ | 12 | `a6444ef687d9842598bc0cd13d82e876dbf984853b32b2ffcc031dbb39af7d2f` |
| extractors/palettes/ | 7 | `1c6e4bcd87620a4139c4b8c01a5b98d0568ebacb7deefe3e8050c1b97d47a706` |
| extractors/media/ | 8 | `1c87a46febf81335e015481ebf7b803544e082a6623354cb61a31fdf46c55680` |
| src/ (including imported palette helpers) | 54 | `cd01558d2ffd9d3cf12ca3e333e543daa4715b8acbd579fce9d512d64e75ff47` |

The whole `tools` tree is not claimed stable: unrelated research code and Finder
metadata changed concurrently. Exporter dependencies and the entire `src`
snapshot were stable. Node v24.7.0 on darwin/arm64 was used;
`current-environment-01.json` pins package/configuration files and installed
tsx/TypeScript package metadata, all asserted unchanged. This is an on-disk
comparison; no Git provenance is established by this evidence.

## Commands and Evidence

Executed normal exporter commands, with cwd `/Users/rafael/Downloads/darkcolony`:

```sh
node --import tsx --input-type=module -e 'import {extractGameData} from "/Users/rafael/Downloads/darkcolony/tools/extractors/data/extract.ts"; const result = await extractGameData("/Users/rafael/Downloads/darkcolony/raw_cd/DC", "/tmp/dc-reproduction-20260919-lB2ic3a8/generated/data"); console.log(JSON.stringify({unitCount:result.unitCount,weaponCount:result.weaponCount,scenarioCount:result.scenarioCount,files:result.files.scenarios.length}));'
node --import tsx /Users/rafael/Downloads/darkcolony/tools/extractors/palettes/cli.ts --source /Users/rafael/Downloads/darkcolony/raw_cd/DC --output /tmp/dc-reproduction-20260919-lB2ic3a8/generated/indexed
node --import tsx /Users/rafael/Downloads/darkcolony/tools/extractors/media/effect-wav.ts /Users/rafael/Downloads/darkcolony/raw_cd/DC /tmp/dc-reproduction-20260919-lB2ic3a8/generated/media
```

DATA invokes the same `extractGameData` function as full ingest; INDEXED uses
the CLI behind `npm run extract-indexed`; WAV publication uses the shipped
publisher. No alternate decoder or reconstructed output was substituted.

The retained `current-refresh-01.mjs` runner logs every argument vector and cwd.
It pins source/code/disc, verifies baseline continuity, runs the exporters,
snapshots both full trees, compares shared stability and cross-corpus equality,
verifies both indexes, then rechecks source/disc/code/environment. Exact
verification arguments are in `current-verify-02.log`. Completed invocations:

```sh
node tools/qa/asset-reproduction.mjs self-test
node --check /tmp/dc-reproduction-20260919-lB2ic3a8/current-refresh-01.mjs
node /tmp/dc-reproduction-20260919-lB2ic3a8/current-refresh-01.mjs export > /tmp/dc-reproduction-20260919-lB2ic3a8/current-export-01.log 2>&1
node /tmp/dc-reproduction-20260919-lB2ic3a8/current-refresh-01.mjs verify > /tmp/dc-reproduction-20260919-lB2ic3a8/current-verify-02.log 2>&1
node /tmp/dc-reproduction-20260919-lB2ic3a8/current-summary-01.mjs > /tmp/dc-reproduction-20260919-lB2ic3a8/current-summary-01.log 2>&1
```

Before those invocations, `snapshot ROOT REPORT` captured shared publication as
`current-shared-before-01.json` and retained output as
`current-fresh-before-01.json`. The first verification attempt was interrupted
before writing any report; only `current-verify-02.log` is completion evidence.
Dedicated logs, not interleaved terminal output, establish completion. Reports
use exclusive creation: choose unused names for a repeat and keep exporter
destinations isolated. The export runner assumes both before reports exist.

### Evidence Digests

All artifacts are local to the retained temporary directory. The summary records
current totals, every added/changed path and hash, preservation assertions, DATA
source checks, BEAT sample measurements and exporter pins.

| Artifact | SHA-256 |
| --- | --- |
| current-refresh-01.mjs | `3dcf611b8167b23157f33ea530b90be2672b1f907700f0812b981a0880f4b05c` |
| current-export-01.log | `ea6d0f24c480e63fac23a09f6f99bf71f24b340e3902ce3f6a3f09a64dd78d8e` |
| current-verify-02.log | `b9fec1ba05671e1d6eda6342f1eb633916688d1048b8676fc6254c145323a415` |
| current-comparison-01.json | `67ceac047b91fc6cf9ec0d4f12e1729a6c3ffd58a0faf2f66e498b4df49ca6f2` |
| current-fresh-index-checks-01.json and current-shared-index-checks-01.json | `5daa67b29559fa740f0106cf670d35944e9c5a90919abfdb0c4c3f87c63185fa` |
| current-prior-stability-01.json | `13b1c9f15942f54a714f6eabdc7d398073547241bba8172ba8a6d0cc8b1714a5` |
| current-shared-stability-01.json | `a5024cbc1d5c6873fe28b63442c15b7d04c3284f4cd5e495be20c2c2423e3ecd` |
| current-source-continuity-01.json | `55f4916e8b188273f868f7f28ea44e74472b1609b641812becefb7ab629c6c4b` |
| current-disc-continuity-01.json | `a1a4126cdd2ef9010679deffb4037d56daddccd48a4cb0062919c5fb5b8c8ed0` |
| current-environment-01.json | `50f88e4283f101fd2401ba533480094194fbb05a04ecf647e9e23f3e2909f149` |

Earlier full-ingest/CD evidence remains in `extract-run-02.log`, `fresh.json`,
`cd-extract-01.log` and `cd-fresh-after-01.json`. Those establish retained-output
provenance, not current counts. No cross-platform determinism, new full
extraction or complete source audio is claimed.

---

# Historical Full Ingest and CD Refresh - 2026-09-19

This section records the earlier 3,267-file acceptance, not the current tree.

## Decision

**PASS: reproducibility of the currently supported generated corpus in the
recorded environment, with scoped incremental CD reproduction.** The earlier
clean full ingest reproduced 3,263 files / 454,474,203 bytes. The current normal
`--cd-only` command refreshed that retained isolated corpus with four MP3 CD
fallbacks and two updated indexes. All **3,267 current published files /
469,116,548 bytes match exactly**, with no added, missing or changed published
files versus reproduction. All 1,331 JSON files also have identical canonical
structured hashes. The source inventory manifest remains byte-identical.

This refresh did **not** rerun full ingest or transcode unchanged WAV/AVI media.
Before refresh, the retained output matched the original full-ingest snapshot
exactly. After refresh, its only delta was four added MP3 files and two changed
indexes; all four re-encoded CD Ogg files remained byte-identical. Thus current
acceptance extends the prior clean reproduction with an incremental CD run and
an exhaustive current comparison, not a new clean full extraction.

**This does not accept all phases or every legacy format.** Unsupported FIN/RMP
variants, invalid FINs, unresolved sprite bindings, native semantic correctness,
runtime rendering and broader phase gates remain separate. No browser, new
agents, full suite, shared publication update, runtime edit, architecture edit
or shared acceptance-audit edit was performed by this task.

The baseline is the supplied on-disk [generated corpus](../public/assets/generated).
Git commands report `fatal: not a git repository`; its checked-in provenance and
commit identity cannot be established here. This is a measured on-disk comparison,
not an assertion that those assets belong to a particular commit.

## Isolation and Method

Evidence and complete clean output are retained under the unique directory:

```text
/tmp/dc-reproduction-20260919-lB2ic3a8
```

The full [ingest CLI](../tools/ingest/index.ts) supports `--source`, `--output`,
`--assets-output`, and `--disc-descriptor`. It calls the real sprite, animation,
terrain, map, indexed, data, interface, media and CDDA exporters. Both media
video encodings were actually produced by FFmpeg, not replaced by test stubs.
The standalone indexed CLI also supports an alternate output, but was not
needed: full ingest already invokes that exporter.

The new [read-only verifier](../tools/qa/asset-reproduction.mjs) records every
file's relative path, byte count and SHA-256. JSON structured hashing recursively
sorts object keys; it preserves arrays, values and every field. No timestamps,
diagnostics, paths, source hashes or other JSON fields are stripped. It reports
all missing/added/changed files, with JSON-pointer differences for changed JSON.
It returns nonzero for any published-file difference, including formatting-only
changes. Storage/history and host metadata are separately reported, not silently
discarded. Their differences require explicit review, as below.

Tree SHA-256 is over sorted UTF-8 records `path + NUL + bytes + NUL + sha256 + LF`.
Structured tree SHA-256 uses `path + NUL + structuredSha256 + LF` for JSON and
`path + NUL + sha256 + LF` otherwise. Per-family hashes below keep the family
prefix in each path. These are corpus hashes, not hashes of report JSON files.

Symlinks are recorded and resolved inside the snapshot root; external links and
cycles are rejected. The shared `indexed` link was read, never replaced. The
temporary exporter published its own relative link and generation directory.
Snapshots include both the logical indexed paths and physical generation paths;
these duplicate traversals are not counted as additional published assets.

## Coverage

Every row was regenerated by the earlier full ingest and compared again in full
for this refresh, not sampled. Only CD outputs and their indexes were regenerated
in the incremental run.

| Family | Published files | Bytes | Meaningful coverage |
| --- | ---: | ---: | --- |
| sprites | 569 | 26,925,850 | 284 RGBA PNG atlases, 284 metadata files and index; 9,730 frames |
| animations | 165 | 13,694,678 | 164 parsed FIN metadata files and complete 177-file census; 2,547 states, 18,485 timelines, 56,605 children |
| terrain | 9 | 4,164,960 | 4 RGBA PNG banks, 4 metadata files and index; 4,764 tiles |
| maps | 757 | 23,390,873 | 108 MAP/MTG/PTH bundles, 1,345,872 cells; 324 u16 and 324 u8 layers, 109 JSON files |
| data | 302 | 3,313,583 | 106 units, 64 weapons, 80 dependencies, 108 scenarios; 101 trigger, 44 message, 45 briefing files, 4 root JSON files |
| interface | 20 | 453,094 | 19 GIF images and index |
| media | 387 | 181,990,300 | 259 source WAV conversions + 4 CD tracks = 263 Ogg; 4 CD MP3 fallbacks; 59 AVI conversions to both 59 MP4 and 59 WebM; 2 indexes |
| indexed | 1,058 | 215,183,210 | 1,056 declared outputs + index and checksum; complete indices, coverage, palettes, FIN metadata/bindings and 2 initial missions |
| **Total** | **3,267** | **469,116,548** | **All byte-identical; 0 substantive or formatting mismatches** |

Indexed details: 20 palette files (5 root GIF/RGB/RMP triples), 16 terrain files
(4 banks), 852 sprite files (284 archives, including 26 empty frames), 166
animation/binding files, 2 mission files and 2 index/checksum files. Texture
inventory is 585 R8 files, 5 RGB8 files and 5 RGB555 binaries, plus 462 JSON files
and one checksum file. Only DESERT is marked verified for initial palette use;
publishing the other four standard triples does not promote their initialization.

Each current corpus independently passes **2,266 declared-hash checks, 0 failures**:
1 indexed manifest checksum, 1,056 indexed outputs, 498 indexed source inputs,
385 combined media outputs, 318 WAV/AVI sources, and 8 CD output references.
The last eight intentionally repeat the combined media references against the
CD-specific index. Actual CD PCM extraction was exercised again by `--cd-only`; the
read-only verifier does not independently decode the MDF. All four freshly
computed PCM source hashes and resulting files match the baseline indexes.
CD duration is 609.76 seconds across tracks 02-05.

## Output Hashes

Both current publication and incrementally refreshed isolated output have these hashes:

| Corpus | SHA-256 |
| --- | --- |
| Published raw tree | `51c9ea1f90c73670ca2ca2813fbb0af3cf5647853a584f915315be9cd690e7a2` |
| Published structured tree | `e290b6ff0fa26dc49270e98fd7169b7cef5a7d435474896667642dde8b276042` |
| sprites | `dfec8deb1825b8f74bd456c353801335e260d818a8883739ca0d6b15983f281e` |
| animations | `71adf5ae1028d659b58d3fb305c3549cf8fa684d33def3536790c815132a18c4` |
| terrain | `12f20dd4193530052e253f9c547edd2392cf6e03a2d7cd933fedcd3a59f39486` |
| maps | `f8ccd7645795017279011acb56c41fa817bb949d4199b0b998305017952b8fb7` |
| data | `0e09b247d42d1f82bcc781932cf35c0ea1c463211e42a9d30d95dac6e10559fb` |
| interface | `f0bb90beff1bb00d21cd622585c32d979e413956742c9106714057fc2eb0e9d6` |
| media | `a61c24f94fbc6c901a6851c79092563fe2613237ce84be06b62030aeb5958154` |
| indexed logical tree | `51f33e05e5d81ed58716652e4ea200a3876156fe598100030a7245b93aeea866` |
| Indexed index bytes / generation ID | `6f7125d7a78838253a89683cd43ae04e775df61ab06ae3636596b6d410f9b9a2` |
| Source manifest file bytes | `c30023c0066ea3ad15ba7c8197ff2c828d5d380c4aee5b4a542d7c91ccb49cd7` |

Exactly these six published paths differ from the earlier full reproduction:

| Path relative to generated root | Change | Current bytes | SHA-256 |
| --- | --- | ---: | --- |
| media/cd/TRACK02.mp3 | Added | 4,679,470 | `7a6d84dd25e43dcb0dd1faaa9ac7f8466ff755651f27e4c43feb8a5142c79309` |
| media/cd/TRACK03.mp3 | Added | 1,920,939 | `be7464bbe64d3abd9d5b6c002afb1ffe19f29e05d46cc13d9cb603160d033d01` |
| media/cd/TRACK04.mp3 | Added | 3,282,650 | `58938cbcb422fee6af5d35a696a10e179a5c016483fdb5fefd9f47816cd9e16d` |
| media/cd/TRACK05.mp3 | Added | 4,757,210 | `235913761e2f501084a7c4686b4acd8126146cd6bc53327299b8c5d31990ae12` |
| media/cd/index.json | Changed | 3,016 | `03cb164025cb954b7dfcf1fa5931ab97f1487ce190478c40af63c11ee11cac12` |
| media/index.json | Changed | 174,746 | `35d337ec86dda0ac32f8e0ccd100ee922cf32124251fc4601b27f65cf1fe6db1` |

## Source and Code Pins

The earlier full-ingest inventory contains **5,151 source files / 481,383,122 bytes**.
Its source-tree SHA-256 is
`864a9a581d741252bf0ca86fadaac32e9f504b7be7a379339ce69bdb2a7be531`.
The exhaustive raw snapshot additionally records one 6,148-byte host `.DS_Store`,
giving 5,152 entries and tree SHA-256
`7145597aca0c1faab171aa367cacfa4401499df25b5e1de2660f28cb9f5856e3`.
Both raw source snapshots match before/after, including that metadata file.
Individual source pins are retained in `source-before.json` and the inventory.

| Input | Bytes | SHA-256 |
| --- | ---: | --- |
| Dark Colony.mdf | 694,622,448 | `2211981ebb330d205b98ceb32c4d14d02c566ea8b7d5e76fbe63e4094cff80c0` |
| Dark Colony.mds | 838 | `d4a58a192975676b892b57a8a170f00eab11c2a89d2ccadcc00be84380fcbeb9` |
| DC/DC.EXE | 589,312 | `65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b` |
| Short multiplayer RMP | 67,584 | `364faf322e0e10eda4315d25fd5561c116d613ca5c487d267c5d258a715fc61f` |

The disc snapshot is unchanged from the earlier run at incremental-run verification, tree hash
`b8c16229b3a9298ceec166a9f47aab18a37bc04c30e3a4f6241772f70dc211c8`.
The earlier full-ingest code was pinned rather than assuming a clean checkout: all 111 files
under tools hash to `a151a48bf552ca5f89175ff367fdf8a89bff6401d483f67045b0f824239b9205`;
all 51 files under src hash to
`9d22e91e1672db15ba79379c222e59e91e702b98a70186e076de7467d3ea4bdb`.
Both historical code snapshots were unchanged after that extraction; these are
not current whole-repository pins. Package configuration SHA-256 (still current):
`fff13a73ebdf700c5b7b6affee2bbed1a6573a9725c7e48553affd3246ebe8b3`.
TypeScript configurations and installed tsx/TypeScript package metadata hashes
are also recorded in `extract-run-01.log`.

The incremental run pins the current CLI, CD extractor, direct encoding/parser
dependencies and verifier below. All were rehashed after the run and remained
unchanged. The extractors have no separate release version; these file hashes
identify the code used. Both media index schemas remain version 1.

| Current code/tool | Bytes | SHA-256 |
| --- | ---: | --- |
| tools/ingest/index.ts | 7,139 | `e189d9296c887d0c0e1d4176c7682aebc0bcdcb162ff16d8323d7ef160fa1924` |
| tools/extractors/disc/extract.ts | 7,931 | `e8dfea6f58a112929263463019a957879906939d0e106a53b93032f35c932e68` |
| tools/extractors/disc/mds.ts | 3,609 | `2c11841f47eb3d37d84d1b0851525d89afaeaeb51068343f4ae27f46d8e3847c` |
| tools/extractors/media/ogg.ts | 1,949 | `fb0393bf9b540a876851779cb1389f7a64287235be585c5c2d7c701bf14fe486` |
| tools/extractors/media/extract.ts | 8,533 | `a106ab9162c3f8bdfa3dbd7a5bcf9e8c7d834056dd55902bdf7f983558e5bf52` |
| tools/qa/asset-reproduction.mjs | 10,779 | `f3dd83f7a969ae5c5a0581b29bc1e71aa0b1269b0f1a09edf8873ce915cb7b5c` |
| /opt/homebrew/bin/ffmpeg | 440,400 | `0a96da2735695308d964e25fa6f4a0db2e9d24031390360f4c5ff96a4f8938e5` |

Current versions: Node 24.7.0, npm 11.5.1, tsx 4.23.13, TypeScript 5.9.3;
FFmpeg 8.0.1, Homebrew build 8.0.1_4, with libopus and libmp3lame enabled.
`cd-environment-pins-01.json` retains full FFmpeg build/library versions and
installed tsx/TypeScript package metadata hashes. MP3 uses libmp3lame at 192 kb/s,
bitexact flags and no ID3v1/ID3v2 tags; Ogg retains the existing Opus encoding and
canonicalization. No substitute encoder or test stub was used.

## Enumerated Differences

There are **no generated diagnostic, timestamp, relative-path, byte or JSON
semantic differences**. In particular, all unsupported/invalid diagnostics and
source fingerprints reproduce exactly; no diagnostic output was exempted.

Exactly two baseline-only filesystem files were observed:

| Relative path | Bytes | SHA-256 |
| --- | ---: | --- |
| .DS_Store | 6,148 | `373cc2283b4035710f17fe891fda58a29dd388808159353f234195f8e1062935` |
| .indexed-generations/.DS_Store | 6,148 | `e4a602b86fc98630bc45f0b77f7209643dc062660998987239741dbbbbee38e0` |

These are Finder metadata, not exporter outputs. Both remain untouched in the
baseline. The second is reported in the generation-storage partition because
that path prefix takes precedence over the host-metadata partition. No historical
generation payload was missing or changed: all 1,058 physical generation files
match. The current verifier recorded 4,327 baseline entries versus 4,325 isolated entries,
including the duplicate logical/physical indexed traversal.

Both links target the identical relative path
`.indexed-generations/6f7125d7a78838253a89683cd43ae04e775df61ab06ae3636596b6d410f9b9a2`.
Only the resolved absolute roots in verification reports differ, necessarily:
workspace versus `/private/tmp/...` (macOS resolves `/tmp` to `/private/tmp`).
Those report paths are not generated asset fields. Before/after shared snapshots
for the incremental run have identical links and full tree hash
`c11ee71ee2e77b4072232857bbac7ea75cda45d77134ca86858d72a40dafc420`.
The isolated full snapshot hash is
`718f926c26cac947e334908a0235089491b85720d171860b1331b989d0e78d35`;
the only current cross-corpus filesystem differences are the two metadata files above.

## Supported Versus Unsupported

**FIN:** 164 standard files are parsed and reproduced; 11 tag -3 lighting files
remain unsupported: LIGHT1B, LIGHT1M, LIGHT2B, LIGHT2M, LIGHT3B, LIGHT3F, LIGHT3M,
LIGHT4B, LIGHT4F, LIGHT4M, LITE. ANIM.FIN and BUILDING.FIN remain invalid.
They receive census entries/diagnostics, not fabricated animation metadata.
There are also 20 `missing-fin-sprite` diagnostics; no aliases were invented.

**RMP:** the source census has 20 standard 196,608-byte tables and one unsupported
67,584-byte multiplayer table. The focused variant test round-trips all 20
standard tables and confirms rejection of the short one. The indexed exporter
publishes only the 5 applicable root palette triples, not all 20 source tables.
All 21 RMP source fingerprints are retained; the short table emits a diagnostic,
not a texture. Reproduction cannot establish its unknown addressing semantics.

The [legacy-variant investigation](phase2-legacy-variants.md) remains blocked.
Its focused four tests passed here: **4 passed, 0 failed, 0 skipped**.

## Executed Commands and Logs

### Incremental CD Refresh

The existing isolated corpus was reused only after comparing it with `fresh.json`
from the successful full ingest: all 3,263 published and 1,058 physical generation
files still matched. The following commands completed with exit 0. Reports use
exclusive creation; use a fresh report suffix for any repeat. No command targets
shared publication as an exporter output.

```sh
cd /Users/rafael/Downloads/darkcolony
node tools/qa/asset-reproduction.mjs snapshot public/assets/generated /tmp/dc-reproduction-20260919-lB2ic3a8/cd-shared-before-01.json
node tools/qa/asset-reproduction.mjs snapshot /tmp/dc-reproduction-20260919-lB2ic3a8/generated /tmp/dc-reproduction-20260919-lB2ic3a8/cd-fresh-before-01.json
node tools/qa/asset-reproduction.mjs compare /tmp/dc-reproduction-20260919-lB2ic3a8/fresh.json /tmp/dc-reproduction-20260919-lB2ic3a8/cd-fresh-before-01.json /tmp/dc-reproduction-20260919-lB2ic3a8/cd-prior-stability-01.json
node tools/qa/asset-reproduction.mjs snapshot 'Dark Colony ISO' /tmp/dc-reproduction-20260919-lB2ic3a8/cd-disc-before-01.json
node tools/qa/asset-reproduction.mjs compare /tmp/dc-reproduction-20260919-lB2ic3a8/disc-before.json /tmp/dc-reproduction-20260919-lB2ic3a8/cd-disc-before-01.json /tmp/dc-reproduction-20260919-lB2ic3a8/cd-disc-continuity-01.json
npm run extract-assets -- --cd-only --assets-output /tmp/dc-reproduction-20260919-lB2ic3a8/generated --disc-descriptor '/Users/rafael/Downloads/darkcolony/Dark Colony ISO/Dark Colony.mds' > /tmp/dc-reproduction-20260919-lB2ic3a8/cd-extract-01.log 2>&1
node tools/qa/asset-reproduction.mjs snapshot /tmp/dc-reproduction-20260919-lB2ic3a8/generated /tmp/dc-reproduction-20260919-lB2ic3a8/cd-fresh-after-01.json
node tools/qa/asset-reproduction.mjs compare /tmp/dc-reproduction-20260919-lB2ic3a8/cd-shared-before-01.json /tmp/dc-reproduction-20260919-lB2ic3a8/cd-fresh-after-01.json /tmp/dc-reproduction-20260919-lB2ic3a8/cd-comparison-01.json
node tools/qa/asset-reproduction.mjs verify-indexes /tmp/dc-reproduction-20260919-lB2ic3a8/generated /Users/rafael/Downloads/darkcolony/raw_cd/DC /tmp/dc-reproduction-20260919-lB2ic3a8/cd-fresh-index-checks-01.json
node tools/qa/asset-reproduction.mjs verify-indexes public/assets/generated /Users/rafael/Downloads/darkcolony/raw_cd/DC /tmp/dc-reproduction-20260919-lB2ic3a8/cd-shared-index-checks-01.json
node tools/qa/asset-reproduction.mjs snapshot public/assets/generated /tmp/dc-reproduction-20260919-lB2ic3a8/cd-shared-after-01.json
node tools/qa/asset-reproduction.mjs compare /tmp/dc-reproduction-20260919-lB2ic3a8/cd-shared-before-01.json /tmp/dc-reproduction-20260919-lB2ic3a8/cd-shared-after-01.json /tmp/dc-reproduction-20260919-lB2ic3a8/cd-shared-stability-01.json
```

Paths above are shortened relative to the stated cwd where applicable; execution
used absolute verifier/input paths. `cd-extract-01.log` records the normal npm/tsx
invocation and `CD audio tracks: 4 (Ogg + MP3)`. `cd-summary-01.json` records the
asserted four-addition/two-change delta, family totals, current index-check counts,
unchanged code pins, matching inventory manifests and evidence digests. No
unchanged full-media transcode, browser, agent or full-suite run was performed.

### Earlier Full Ingest (Historical Evidence)

All project commands used absolute cwd `/Users/rafael/Downloads/darkcolony`.
The output directory was allocated with:

```sh
cd '/Users/rafael/Downloads/darkcolony' && mktemp -d /tmp/dc-reproduction-20260919-XXXXXXXX
```

The exact successful exporter argument vector was:

```sh
cd '/Users/rafael/Downloads/darkcolony'
npm run extract-assets -- --source /Users/rafael/Downloads/darkcolony/raw_cd --output /tmp/dc-reproduction-20260919-lB2ic3a8/asset_manifest.json --assets-output /tmp/dc-reproduction-20260919-lB2ic3a8/generated --disc-descriptor '/Users/rafael/Downloads/darkcolony/Dark Colony ISO/Dark Colony.mds'
```

It was executed through this synchronous Node launcher to isolate its process
group from other tasks sharing the terminal. This is the actual executed launcher:

```sh
cd '/Users/rafael/Downloads/darkcolony' && node --input-type=module -e 'import { spawn } from "node:child_process"; import { openSync, appendFileSync } from "node:fs"; const log="/tmp/dc-reproduction-20260919-lB2ic3a8/extract-run-02.log"; const fd=openSync(log,"wx"); const args=["run","extract-assets","--","--source","/Users/rafael/Downloads/darkcolony/raw_cd","--output","/tmp/dc-reproduction-20260919-lB2ic3a8/asset_manifest.json","--assets-output","/tmp/dc-reproduction-20260919-lB2ic3a8/generated","--disc-descriptor","/Users/rafael/Downloads/darkcolony/Dark Colony ISO/Dark Colony.mds"]; appendFileSync(log,JSON.stringify({command:"npm",args,cwd:process.cwd()})+"\n"); const child=spawn("npm",args,{cwd:"/Users/rafael/Downloads/darkcolony",detached:true,stdio:["ignore",fd,fd]}); process.on("SIGINT",()=>appendFileSync(log,"Parent received terminal SIGINT; isolated extractor continues.\n")); child.on("error",error=>{appendFileSync(log,String(error)+"\n");process.exitCode=1;}); child.on("close",(code,signal)=>{appendFileSync(log,JSON.stringify({completed:true,code,signal})+"\n");process.exitCode=code??1;});' > /tmp/dc-reproduction-20260919-lB2ic3a8/extract-launch-02.log 2>&1
```

`extract-run-02.log` contains all extractor counts and the completion record
`{"completed":true,"code":0,"signal":null}`. Its initial custom command header
was overwritten by the child file descriptor's initial position; the npm command
header and completion record are intact. Subsequent launcher logs use append mode.

These exact verification commands were executed by the retained `verify.zsh`
script; its full command/exit transcript is `verify-run-01.log`:

```sh
cd /Users/rafael/Downloads/darkcolony
node tools/qa/asset-reproduction.mjs self-test
node tools/qa/asset-reproduction.mjs snapshot /tmp/dc-reproduction-20260919-lB2ic3a8/generated /tmp/dc-reproduction-20260919-lB2ic3a8/fresh.json
node tools/qa/asset-reproduction.mjs compare /tmp/dc-reproduction-20260919-lB2ic3a8/shared-before.json /tmp/dc-reproduction-20260919-lB2ic3a8/fresh.json /tmp/dc-reproduction-20260919-lB2ic3a8/comparison.json
node tools/qa/asset-reproduction.mjs verify-indexes /tmp/dc-reproduction-20260919-lB2ic3a8/generated /Users/rafael/Downloads/darkcolony/raw_cd/DC /tmp/dc-reproduction-20260919-lB2ic3a8/fresh-index-checks.json
node tools/qa/asset-reproduction.mjs verify-indexes /Users/rafael/Downloads/darkcolony/public/assets/generated /Users/rafael/Downloads/darkcolony/raw_cd/DC /tmp/dc-reproduction-20260919-lB2ic3a8/shared-index-checks.json
node tools/qa/asset-reproduction.mjs snapshot /Users/rafael/Downloads/darkcolony/public/assets/generated /tmp/dc-reproduction-20260919-lB2ic3a8/shared-after.json
node tools/qa/asset-reproduction.mjs compare /tmp/dc-reproduction-20260919-lB2ic3a8/shared-before.json /tmp/dc-reproduction-20260919-lB2ic3a8/shared-after.json /tmp/dc-reproduction-20260919-lB2ic3a8/shared-stability.json
node tools/qa/asset-reproduction.mjs snapshot /Users/rafael/Downloads/darkcolony/raw_cd /tmp/dc-reproduction-20260919-lB2ic3a8/source-after.json
node tools/qa/asset-reproduction.mjs compare /tmp/dc-reproduction-20260919-lB2ic3a8/source-before.json /tmp/dc-reproduction-20260919-lB2ic3a8/source-after.json /tmp/dc-reproduction-20260919-lB2ic3a8/source-stability.json
node tools/qa/asset-reproduction.mjs snapshot '/Users/rafael/Downloads/darkcolony/Dark Colony ISO' /tmp/dc-reproduction-20260919-lB2ic3a8/disc-after.json
node tools/qa/asset-reproduction.mjs compare /tmp/dc-reproduction-20260919-lB2ic3a8/disc-before.json /tmp/dc-reproduction-20260919-lB2ic3a8/disc-after.json /tmp/dc-reproduction-20260919-lB2ic3a8/disc-stability.json
node tools/qa/asset-reproduction.mjs snapshot /Users/rafael/Downloads/darkcolony/tools /tmp/dc-reproduction-20260919-lB2ic3a8/tools-after.json
node tools/qa/asset-reproduction.mjs snapshot /Users/rafael/Downloads/darkcolony/src /tmp/dc-reproduction-20260919-lB2ic3a8/src-after.json
```

Every command above exited 0. The fixture check covers raw hashing, canonical key
order, array order, semantic differences, added/missing files and symlink snapshots.
Initial baseline snapshots used the same `snapshot ROOT REPORT` commands with
`shared-before.json`, `source-before.json`, `disc-before.json`, `tools-before.json`
and `src-before.json`; the exact source/code commands are retained in `extract.zsh`
and `extract-run-01.log`, and the shared result in `shared-before.log`.

Summary and focused variant test commands:

```sh
cd '/Users/rafael/Downloads/darkcolony' && node /tmp/dc-reproduction-20260919-lB2ic3a8/summarize.mjs > /tmp/dc-reproduction-20260919-lB2ic3a8/summary-run-01.log 2>&1 && node --import tsx --test tools/extractors/palettes/variants.test.ts > /tmp/dc-reproduction-20260919-lB2ic3a8/variants-test-01.log 2>&1
```

For another run, allocate a **new** `mktemp -d` root and substitute it in all
output/report arguments. Reports use exclusive creation and cannot be overwritten.
Take baseline/source/code snapshots first; never reuse a shared output path.
The verifier itself does not run exporters or write into either corpus.

## Environment and Blockers

- macOS 26.6.2, build 25G83, arm64; Node 24.7.0; npm 11.5.1.
- tsx 4.23.13, TypeScript 5.9.3, Vite 7.3.6, @types/node 22.20.3.
- FFmpeg 8.0.1 at `/opt/homebrew/bin/ffmpeg`, Homebrew build 8.0.1_4,
  Apple clang 17.0.0; libopus, libvpx and libx264 enabled. Full FFmpeg build and
  library versions are retained in `environment.log`. No missing codec/tool
  blocker remained. Equality is established for this environment, not every
  FFmpeg/codec version or platform.
- The terminal session was shared with unrelated ongoing work. The first raw
  snapshot attempt was interrupted; the scripted retry completed source/code
  pins but npm exited 1 before producing generated output. The final isolated
  process-group run completed. Interleaved terminal display was not used as
  evidence: uniquely named logs and explicit completion records were read.
- No Git metadata exists at this location, so commit/checked-in provenance is
  unavailable. File-level code/source pins replace that missing evidence, not
  the claim of version-control provenance.
- No cross-version determinism, second clean full extraction, browser playback,
  visual correctness, native semantic fidelity or all-phase acceptance is
  claimed. The current result combines the earlier independent clean regeneration
  with scoped CD-only regeneration and exact comparison of every current file,
  including actual compressed audio/video bytes. Unchanged non-CD output was
  retained, not regenerated under the current extractor code.

## Evidence Index

All listed artifacts are inside the unique temporary root. They are local
retained evidence, not checked-in copies of the copyrighted corpus.

### Current Incremental Evidence

| Artifact | SHA-256 |
| --- | --- |
| cd-comparison-01.json | `2f0db3bd96d8e59897aecb3dfa0a3766ebc259a1302c67e22fb7f649570cf69c` |
| cd-prior-stability-01.json | `44855b8c8a6a06668e3f7a082d640c35de595e0649c5e04e4b298fbc09c8eded` |
| cd-disc-continuity-01.json | `a1a4126cdd2ef9010679deffb4037d56daddccd48a4cb0062919c5fb5b8c8ed0` |
| cd-environment-pins-01.json | `628d995f1353be14ee4b8527194e6e5fb584fb51b20006adbf7532c60b34c14d` |
| cd-extract-01.log | `b9c1d814cca8697e22f65c0be515641c077862cb15ed916e8687d35843add524` |
| cd-fresh-index-checks-01.json and cd-shared-index-checks-01.json | `9a65a05ab943b05cff44a2642dff79260b6086a721681c93929450e036f2f0e5` |
| cd-shared-stability-01.json | `cba6653e162ddd2c1a532b0b513877235400ac774d5dc3ec1ae997fe06c99609` |
| cd-shared-before-01.json and cd-shared-after-01.json | `9b58031e30a58f488fabb00effaaea817331aa668e46312d04a2454a2d8e4016` |
| cd-fresh-before-01.json | `6eea63c6ea8a2aaf4960d909bfd497cf14644e7c10fc35ee9ecc0281549f6c25` |
| cd-fresh-after-01.json | `2eef470e0705508e759791ea17958554756ff43eb491104cdd814e1eabb8d2b8` |

### Earlier Full-Ingest Evidence

These reports retain the original 3,263-file state and its historical hashes;
they are not the current 3,267-file comparison. The isolated `generated` directory
has since been refreshed by the CD-only command above.

| Artifact | SHA-256 |
| --- | --- |
| comparison.json | `b1a2396eab2a11ab930fb245192261e89031408885ddfc23e43c24d3b9616e4d` |
| summary.json | `83e085b47f212f85d9e969a04b212c339d1b0c4f677feaf6e79644c11692ae49` |
| source-before.json | `4f4852830eb742ace0fc55ec2b8b1d385ac3525395c7a085036315604dd4a73f` |
| disc-before.json | `4649c5be328c3f908e5748e792b57e44898276cc1e91819ecfdf114646d2be29` |
| fresh-index-checks.json and shared-index-checks.json | `ceaca4bed086052549625b2df27e7fc71c2b65403d0f21b1c0a3ed2ef76cb0d9` |
| shared-stability.json | `5018471e601794e5034023ab3651584e983bb68b46fcb05e39e5e52c850c3bdf` |
| source-stability.json | `55f4916e8b188273f868f7f28ea44e74472b1609b641812becefb7ab629c6c4b` |
| disc-stability.json | `a1a4126cdd2ef9010679deffb4037d56daddccd48a4cb0062919c5fb5b8c8ed0` |

`evidence-sha256-01.log` records these report digests. `fresh.json`, the before/after
snapshots, `summary.json` and `coverage-details-01.log` preserve every file hash,
per-family count, diagnostic and source pin needed to inspect this decision.
# RMP Runtime Requirement: Campaign And MPLAYER

Status: **short-RMP setup-path blocker closed by bounded non-runtime evidence;
phase 2 is not accepted**. The short format remains unsupported.

## Decision

The pinned game's shipped campaign/MPLAYER setup does **not** request
[SCENARIO/MPLAYER/PALETTE.RMP](../raw_cd/DC/SCENARIO/MPLAYER/PALETTE.RMP).
It requests root-level terrain palettes derived from the original SCN terrain
line. Display initialization requests root-level PALETTE. All five tables are
196,608 bytes; the native reader returns the complete requested count.

This closes the unresolved basename/path edge in
[asset-runtime-dependencies-20260919.md](asset-runtime-dependencies-20260919.md).
It does not decode the short file, waive its rejection, remove corpus diagnostics,
or prove its historical provenance. It is not evidence for other executables,
editors, modified scripts, custom scenarios, or arbitrary working directories.
The other [phase-2 gates](phase2-legacy-variants.md) are unchanged.

Only this report and the new
[research script](../tools/research/rmp-runtime-20260919.py) were changed.
No parser, runtime, generated asset, shared audit, or existing test was modified.

## Original Sources

Executable: [DC.EXE](../raw_cd/DC/DC.EXE), SHA-256
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
The probe refuses another executable.

Short RMP: 67,584 bytes, SHA-256
`364faf322e0e10eda4315d25fd5561c116d613ca5c487d267c5d258a715fc61f`.

The script reads the original MDF without extracting files. The existing MDS
parser identifies data track 1: mode `0xaa`, start offset 0, sector stride 2,448,
238,019 sectors. Each accessed sector is checked for the raw sync pattern and
Mode 1 header; its 2,048-byte payload begins at offset 16. PyCdlib parses the
ISO9660 directory, rather than searching image bytes for filenames.

**133 files compare byte-for-byte with the disc:** DC.EXE, all 21 RMPs, all
108 SCNs, and the three installation lists. The original disc's SCN path set
also equals the extracted 108-file set, not just a selected sample.

- MDS SHA-256: `d4a58a192975676b892b57a8a170f00eab11c2a89d2ccadcc00be84380fcbeb9`.
- Primary volume descriptor SHA-256: `db9144b3e4d899640a3efb91a0df9348dbfc3e2f43d3b60a8552eaf53729e242`.
- Disc entry `/DC/SCENARIO/MPLAYER/PALETTE.RMP;1` is present and matches the
  short file. It is not an extraction truncation of a standard-length entry.

## Native Basename Chain

| Native Address | Evidence |
| --- | --- |
| `0x4018b3` | Session setup calls SCN loader `0x41b920`; the same setup later calls `0x41e8f0` at `0x401978`. |
| `0x40d8f2` | The other decoded SCN-loader call also enters `0x41b920`. There is not a separate MPLAYER palette rule at this call. |
| `0x41bafc` / `0x41bb0a` | Read the first substantive SCN line with `0x41b8ac` / `0x41b864`. Blank/comment skipping and line-ending removal execute in the probe. |
| `0x41bb0f` / `0x41bb22` | Copy that line into game `+0x548`. The later `scenario/<terrain>` BTS path is separate. |
| `0x41e944` / `0x41e952` / `0x41e969` | Session presentation setup copies game `+0x548` into its local buffer. |
| `0x41e979` / `0x41e982` | `0x46cbec` finds the **last** dot; store NUL there. The helper scans to the end, not the first dot. |
| `0x41e990` | Pass the stem to terrain-specific setup-data reader `0x431130`. This call alone is not palette evidence. |
| `0x41e9b0` / `0x41ea13` | Put the same buffer in EBX and call UI loader `0x4231d0`. |
| `0x4231e7` / `0x423a32` | Save and recover the caller's palette argument at frame `+0x76`. |
| `0x423a3f` / `0x423a4b` | If that argument is non-null, copy it over the UI script's palette field. |
| `0x423a59` / `0x422dd8` | UI setup `0x422d64` passes the nonempty explicit palette to display callback `+0x34`. Background fallback at `0x422df0` is not selected for these SCNs. |
| `0x42c52b` | Registers `0x42bcac` at display `+0x34`; `0x42bfd0` also installs it at `+0x118`. |
| `0x42bd1c`, `0x42bd42`, `0x42bd4f` | Forward the identical basename to GIF, RGB, then RMP reader `0x44f200`. |
| `0x42c49f` / `0x42c4aa` | Display initialization separately passes literal `palette` to registered callback `+0x118`. |

The probe executes the original SCN first-line reader/store, stem transformation,
UI caller preparation, explicit-palette override, and callback-selection slices
for **all 108 original SCNs**. It starts the override fixture with an unrelated
UI palette and background to distinguish caller precedence from coincidental
matching names. All produce the following exact relative RMP requests:

| Request | All SCNs | MPLAYER SCNs | Native Read Requested / Returned |
| --- | ---: | ---: | ---: |
| `desert.rmp` | 45 | 30 | 196608 / 196608 |
| `jungle.rmp` | 42 | 25 | 196608 / 196608 |
| `htrain.rmp` | 15 | 0 | 196608 / 196608 |
| `atlantis.rmp` | 6 | 1 | 196608 / 196608 |
| `palette.rmp` | Display initialization | Display initialization | 196608 / 196608 |

The 108-source superset includes ALIEN (15), HUMAN (16), MPLAYER (56),
MULTI-~1 (7), and TEST (14). Inclusion in this census does not assert that every
test/spare scenario is selectable. No source terrain line yields `palette`,
`mplayer/palette`, or `scenario/mplayer/palette`.

## Package And Native IO

| Original Install List | RMP Entries | Root Tables | Short MPLAYER RMP | SCN Entries |
| --- | ---: | --- | --- | ---: |
| [SMALL.LST](../raw_cd/SMALL.LST) | 5 | All five | Absent | 56 |
| [MEDIUM.LST](../raw_cd/MEDIUM.LST) | 5 | All five | Absent | 56 |
| [LARGE.LST](../raw_cd/LARGE.LST) | 20 | All five, plus 15 INTRFACE tables | Absent | 101 |

The lists preserve directory-qualified destinations. LARGE's 20 entries are
the standard tables, not all 21 disc RMPs. SMALL lacks BTS files locally;
MEDIUM and LARGE list all four `scenario/*.bts`. Neither fact redirects
palette lookup into a scenario directory. These are list-layout checks, not an
execution of the installer.

`0x44f249` calls `0x406288`: the native extension builder `0x406040` appends
`.rmp`, and `0x4062a6` enters `0x405de0` with optional-open flag BL=0.
The extension-alias count at `0x478cd4` starts at zero; the decoded alias
registration routine `0x405d04` has no direct caller or absolute entry pointer
in this executable. The probe executes the builder, not a Python replacement.

The opener first calls native fopen `0x46c89b` with the requested relative
name at `0x405fd1`. On failure, if `0x494988` or `0x478cd9` enables CD fallback,
it prepends `0x494880` and retries at `0x405ebf`. Initialization reads
[HBNFUFL.A01](../raw_cd/DC/HBNFUFL.A01) and formats `%c:\dc\` at
`0x405c2f` through `0x405c3f`; the probe uses drive D as a fixture.

Thus `desert` requests `desert.rmp` first, and, when forced absent locally,
`D:\DC\desert.rmp`. It never tries `scenario/mplayer/desert.rmp` or searches
subdirectories. The same holds for the other four basenames. All five root
RMPs are exercised against each install-list layout and against forced CD-only
availability: **20 native reader cases**, each returning 196,608 bytes.

Working-directory evidence is also bounded: the decoded calls to imported
`SetCurrentDirectoryA` go through `0x45add4`; its two callers are inside
stat-like helper `0x44e62b`. That helper saves the current directory via
`0x45ac95`, temporarily checks a directory, then restores the saved path at
`0x44e6f6`. Its game caller is file-list handling at `0x42b5c9`, not a palette
loader that enters MPLAYER. The unused import thunk has no decoded caller.
The gate assumes a normal successful launch from the game/install root;
an externally imposed or custom working directory is outside this proof.

## Short Read And Tail

The short file is **not a supported compact format**. Two additional probes
deliberately supply its explicit basename, which no audited SCN supplies.
The actual native reader and `fread` execute; descriptor IO supplies the real
source bytes and EOF.

1. `0x44f254` requests `0x30000` bytes. Wrapper `0x406378` sets element size
   one and calls native `fread` at `0x46d00c`.
2. The first descriptor read returns 67,584 bytes. Native `fread` requests
   the remaining 129,024, receives EOF (zero), and returns **67,584**.
3. At `0x44f265` / `0x44f267`, the RMP reader ignores that count and jumps
   to close at `0x44f6ef`. It does not regenerate on a short read.
4. Generation at `0x44f26c` is an **open-failure** branch. The probes fail
   if that branch is entered; neither successful short-file open enters it.

Unread-tail initialization is proved through the allocator, not guessed from
the small initializer loops:

- `0x44f0d0` reuses global `0x47c06c` when nonzero, with **no clearing**.
- On first allocation, it requests `0x3ffff` bytes at `0x44f0e8`, then
  rounds the returned pointer upward to a 64-KiB boundary.
- Allocator `0x40bcc0` writes its allocation header and calls zero-fill
  `0x46cb5c` at `0x40bdea` for the complete requested allocation.
- Initialization writes identity values at `[0,256)` and `[65536,65552)`.
  Both ranges are overwritten by this 67,584-byte file.
- Therefore `[67584,196608)` is **zero on first allocation**, or **retained
  previous-table bytes on reuse**. It is not an arbitrary uninitialized heap
  tail on the proved first-allocation path. The aligned table is fully inside
  the zeroed allocation.

Sentinel checks execute the original allocator and initializer and compare
all 196,608 table bytes. A forced short read after seeding the buffer with the
verified root PALETTE.RMP preserves its entire remaining suffix. The two
resulting memory-image SHA-256 values differ:

- First allocation: `967580b2aa36d2cbfa02720de355fccc60f4767a092e2de262096c594205eb3b`.
- Reused root palette: `87a81daf1bf38b9908f78ddff712cfa91f38f4fa6801c3e53b6467e4f51ee284`.

These are **probe memory images, not exported remap tables**. They do not
establish the short suffix's bank semantics, a producer format, or a
context-independent expansion. No zero-padding or borrowed-bank decoder is
authorized, and the current parser continues rejecting the file.

## Reproduction And Limits

From the repository root, using isolated Python dependencies:

```sh
python3 -m pip install --target /tmp/dc-rmp-probe-20260919 \
  capstone==5.0.9 unicorn==2.1.4 pycdlib==1.20.0
PYTHONPATH=/tmp/dc-rmp-probe-20260919 \
  python3 tools/research/rmp-runtime-20260919.py > /tmp/rmp-runtime-evidence.json
node --import tsx --test --test-name-pattern='short multiplayer RMP|pinned DC.EXE loader' \
  tools/extractors/palettes/variants.test.ts
```

Verified: **108 SCN probes, 20 standard RMP reader cases, two forced short
reads, two allocator/initializer cases, 133 disc comparisons; two existing
regression tests passed**. The JSON includes every SCN's hash and native
basename, every selected disc entry's hash/length, installation-list paths,
literal fopen attempts, native `fread` counts, and descriptor read/EOF events.
`--disasm START END` and `--refs ADDRESS...` support read-only follow-up.

This is sliced original-x86 execution, **not a Windows game boot**. Boundaries:
SCN line IO is supplied from each original file; unrelated setup-data, RNG,
and UI-construction calls are intercepted between inspected slices. The
palette reader runs through the completed RMP call; GIF/RGB processing and
the renderer setter are intercepted, recording their basenames. The exact
`%s.ncy` formatting call, fopen, fclose, CRT locks, and descriptor read are
intercepted. Windows case/separator/trailing-dot normalization is modelled at
fopen. Native extension construction, optional-open/CD retry logic, allocator,
zero-fill, remap initializer, `fread` accumulation/EOF, and unchecked-count
branch execute unchanged. OS errors and full gameplay are not simulated.

No agents, browser, full suite, exporter, or shared publication was used.
The integration owner can use this evidence to close the **runtime-requirement
gap for this short RMP**. The all-source format-support gate and other phase-2
acceptance work remain separate and unchanged.
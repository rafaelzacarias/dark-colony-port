# Asset Runtime Dependencies: Phase 2 Boundary

Status: **research only; phase 2 remains blocked, not accepted**.

## Decision

For the pinned DC.EXE and unchanged shipped animation manifests:

| Population | Classification | Acceptance Consequence |
| --- | --- | --- |
| Eleven tag **-3** lighting FINs | Non-runtime in the proved shipped FIN-manifest graph | Bounded exclusion evidence, not decoder support or permission to remove diagnostics. |
| Invalid ANIM.FIN and BUILDING.FIN | Non-runtime in the same graph | Same boundary; do not confuse ANIM.FIN with the required ANIM.DAT loader list. |
| Twenty missing-fin-sprite names | Non-runtime through their owning FINs in the same graph | All owners are outside the manifest closure. Nineteen names have actual timeline children; they are not harmless declarations by themselves. |
| Short SCENARIO/MPLAYER/PALETTE.RMP | **Unproven runtime requirement; retained blocker** | No proved path selects this exact file, but palette basename/path resolution is not closed sufficiently to exclude it. |

**None of these problem assets is proved required by the audited shipped FIN
load graph.** That is not a claim that all source files are supported, nor a
universal proof that another executable, an editor, a modified manifest, a
custom UI script, or a saved/custom scenario cannot use them. In particular,
"authoring debris" is an unproved provenance claim. The executable-backed
finding is narrower: the shipped manifest loaders do not request these FINs.

No required unsupported resource is waived. If another runtime reader or
manifest is demonstrated, its unsupported dependencies remain blockers. The
full-corpus gate, source census (164 parsed / 11 unsupported / 2 invalid FINs),
20 missing-sprite diagnostics and short-RMP rejection remain unchanged.
Native composition/effects and other phase-2 gates are separate and unchanged.

## Evidence And Scope

Executable: [DC.EXE](../raw_cd/DC/DC.EXE), SHA-256
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.

The owned [research script](../tools/research/asset-dependencies-20260919.py)
reads original sources and calls the existing FIN/SCN parsers without invoking
an exporter. Default output is a JSON graph with manifest hashes, campaign
lists, problem-file hashes, each missing sprite's FIN owners, timeline entries,
states and orphan-child counts. It also emits a deliberately partial set of
1,357 GAMESTAT state-name edges using native-observed suffixes. Same-basename
comparisons are explicitly labelled non-semantic: **GAMESTAT names are not
necessarily FIN filenames**.

Source roots checked:

- [HSCENE.TXT](../raw_cd/DC/GAMESTAT/HSCENE.TXT) and
  [GSCENE.TXT](../raw_cd/DC/GAMESTAT/GSCENE.TXT): 15 campaign missions each.
- [HTSCENE.TXT](../raw_cd/DC/GAMESTAT/HTSCENE.TXT) and
  [GTSCENE.TXT](../raw_cd/DC/GAMESTAT/GTSCENE.TXT): seven training missions each.
- All 108 SCNs, including 56 under MPLAYER. This is a corpus superset, not a
  claim that all test/spare scenarios are selectable. All 108 parse; first
  lines select DESERT, JUNGLE, HTRAIN or ATLANTIS BTS banks. MPLAYER uses the
  DESERT, JUNGLE and ATLANTIS subset.
- [ANIM.DAT](../raw_cd/DC/ANIM.DAT): 106 startup FIN requests.
- All 12 INTRFACE DAT manifests: together with startup, **127 distinct FINs
  and 187 distinct declared sprite names**. Every selected FIN parses and
  none declares any of the 20 missing names. This is a conservative manifest
  superset, not a claim that every UI manifest is used in every session.
- Shipped text UI scripts: the four `animation` directives in
  [DPLAYSE](../raw_cd/DC/INTRFACE/DPLAYSE#L8),
  [LOADGE](../raw_cd/DC/INTRFACE/LOADGE#L8),
  [METAE](../raw_cd/DC/INTRFACE/METAE#L14) and
  [STORYE](../raw_cd/DC/INTRFACE/STORYE#L8) all select
  [LOADG.DAT](../raw_cd/DC/INTRFACE/LOADG.DAT).

## Native Dependency Graph

```text
DC.EXE startup, 0x404fb7
  -> 0x404e8c opens ANIM.DAT
  -> every non-comment, nontrivial line -> 0x425674
  -> animate/<literal filename>
  -> FIN declared sprite table -> 0x42539c
  -> sprite cache miss -> sprites/<literal name> -> registered SPR reader

UI fixed callers / registered "animation" command
  -> 0x4267e8 opens caller-selected DAT
  -> same 0x425674 FIN reader and declared-sprite graph

SCN setup, 0x41b9ce
  -> 0x43c388 table initialization
  -> BOOMSTAT, MBULLET, GAMESTAT and related table setup
  -> construct animation sets / lookup state names in loaded FIN registry
  -> no missing-state-to-new-FIN fallback in the inspected naming helpers

SCN numeric type / production / trigger-created type
  -> GAMESTAT animation prefix + action + direction
  -> previously loaded FIN state -> timeline -> declared child SPR

runtime palette basename [remaining caller/path-resolution gap]
  -> registered 0x42bcac
  -> GIF + RGB + RMP readers with the same basename
  -> 0x44f200 -> extension helper 0x406288 -> open wrapper 0x405de0
```

The SCN type/production/trigger edge describes the type-table dependency, not
a newly executed proof of every production or trigger action. Importantly,
absence from initial placements is **not** used as exclusion evidence.

### FIN Lists And Readers

| Native Address | Operation Inspected |
| --- | --- |
| `0x404eab`, `0x404eb0` | Literal `anim.dat`, passed to the file opener. |
| `0x404eb7` through `0x404f0b` | Read lines, strip CR/LF, skip length <= 1 and leading `%`, call FIN reader at `0x404f06`. |
| `0x4267e8`, `0x426804` | Context list path comes from EDX; opens text list. |
| `0x42687b` through `0x4268cf` | Equivalent line loop; calls FIN reader at `0x4268ca`. |
| `0x42568b` through `0x4256a4` | Format `animate/%s` and open it. The FIN filename is supplied by the list, not derived from a unit name. |
| `0x4256eb` through `0x42571f` | Before states/children, read every eight-byte declared sprite name and call `0x42539c`. |
| `0x4253b5`, `0x4253bf` | Cache lookup; only a hit skips sprite loading. |
| `0x4253c6`, `0x4254b2` | Format `sprites/%s`; on a cache miss call registered sprite reader at context `+0x40`. |
| `0x42c50c` | Registers `0x44fa98` as that SPR reader. |

Decoded executable references find **two direct calls** to `0x425674`, the
two list loops above, and no absolute pointer reference to that entry. This
supports the audited loader boundary; it does not prove that no independent,
unidentified parser exists elsewhere. No wildcard FIN directory enumeration
occurs in either inspected loop.

The ten direct callers of the context list loader are:

| Call Site | List Source |
| --- | --- |
| `0x401ea8` | INTRFACE/CHOO.DAT |
| `0x402693` | INTRFACE/ENCY.DAT |
| `0x403181` | INTRFACE/SHUMAN.DAT |
| `0x40400e` | INTRFACE/WINGAME.DAT |
| `0x4047b3` | INTRFACE/MULTIWIN.DAT |
| `0x404be2` | INTRFACE/INTRG.DAT |
| `0x405758` | INTRFACE/SERVER.DAT |
| `0x405882` | INTRFACE/NET.DAT |
| `0x4108a4` | INTRFACE/TCPWAIT.DAT |
| `0x423060` | UI command argument, not a fixed filename. |

The last path is not ignored: the native command table at `0x4794c8` contains
the string pointer for `animation`, followed at `0x4794cc` by handler
`0x422fe0`. That handler gets the argument at `0x423054` and passes it to
the list loader. All four shipped directives resolve to LOADG.DAT. The census
also includes INTRO.DAT and VICTORY.DAT as a conservative superset.

### Dynamic GAMESTAT Names Are State Names

SCN setup calls `0x43c388` at `0x41b9ce`. Its setup sequence calls BOOMSTAT
initialization at `0x43c393`, MBULLET at `0x43c39a`, and GAMESTAT at
`0x43c3a8`. GAMESTAT opens at `0x43bac7`/`0x43bacc` and parses the counted
records. The shipped count is 106.

For example, GAMESTAT type 16 is `EXCOPOD`, but its `EXCOPODSTAND0` and
`EXCOPODDIE0` states belong to **HUBU.FIN**, already in ANIM.DAT. Inferring
`EXCOPOD.FIN` from the unit column would produce the wrong graph.

The native code passes MOVE, STAND, DIE/DIEA/DIEB/DIEC, DEPLOY, FUNK and FIG
suffixes into animation-set construction. At `0x426175` it formats `%s%s`;
at `0x4261a1` it appends a direction with `%s%d`. The direction loop covers
0..15 in native rotated order. At `0x4261ba` it calls `0x4254d4`, which
concatenates/normalizes the requested state and searches registry `0x4bca38`
via `0x425370` at `0x425537`. Missing sets take the diagnostic/assert path
at `0x4261da`; they do not invoke `0x425674`.

BOOMSTAT has names such as NUKE, GASY and NAPALM, not FIN filenames. Its
construction at `0x43b4a7` also uses the animation-set machinery. Thus
EFFECTS.FIN is not established as required merely because its name sounds
like a generic effects container. The declared effects and dynamic state
names must resolve through loaded FINs. The graph does not claim complete
event execution or all state suffixes have been reproduced.

## Problem FINs

All the following have no membership in any of the 13 manifests:

| Files | Raw/Parser Finding | Runtime Classification |
| --- | --- | --- |
| LIGHT1B, LIGHT1M, LIGHT2B, LIGHT2M | Signed tag -3 | Non-runtime in audited manifest graph. |
| LIGHT3B, LIGHT3F, LIGHT3M | Signed tag -3 | Same. |
| LIGHT4B, LIGHT4F, LIGHT4M, LITE | Signed tag -3 | Same. |
| ANIM.FIN | Standard-parser child remainder: 20 bytes | Same; ANIM.DAT is a separate, required startup list. |
| BUILDING.FIN | Standard-parser child remainder: 790 bytes | Same; do not alias to BUILDNG.FIN or another building asset. |

The lighting stems in the table are FIN filenames. Startup explicitly loads
the **supported** LIGHT1F.FIN and LIGHT2F.FIN. That is not evidence that the
unsupported B/M variants, LIGHT3F or LIGHT4F should be substituted, converted,
or loaded by a hypothetical name-generation rule. No such rule was found in
the inspected loaders. Legacy format semantics remain unresolved as recorded
in [phase2-legacy-variants.md](phase2-legacy-variants.md).

## Missing Sprite Diagnostics

Every owner below is outside the same manifest closure. Counts are timeline
entries containing that sprite, not frame counts or occurrence totals. All
listed orphan-child counts are zero. Every nonzero entry set intersects at
least one valid FIN state range.

| Missing Name | Owning FIN(s) | Timeline Entries | Classification |
| --- | --- | ---: | --- |
| 2way | EFFECTS.FIN | 12 | Non-runtime through excluded owner. |
| abuildng | ABUILDNG.FIN | 21 | Same. |
| atri | TMP.FIN | 104 | Same. |
| atry | EFFECTS.FIN; SPED.FIN | 30; 19 | Same, both owners checked. |
| builtile | BUILTILE.FIN | 10 | Same. |
| glog | GLOG.FIN | 80 | Same. |
| glop | GLOG.FIN | 11 | Same. |
| heat | HEAT.FIN | 25 | Same. |
| pust | PUST.FIN | 11 | Same. |
| rack | RACK.FIN | 33 | Same. |
| resa | RESA.FIN | 14 | Same. |
| resn | RESN.FIN | 14 | Same. |
| scfg | SCFG.FIN | 32 | Same. |
| sniper | PSY_R.FIN | 32 | Same. |
| solar | SOLAR.FIN | 7 | Same. |
| spaq | BLUSPARK.FIN | 16 | Same. |
| spec | BLUSPARK.FIN | 20 | Same. |
| spic | BLUSPARK.FIN | 28 | Same. |
| spoc | BLUSPARK.FIN | 30 | Same. |
| top | TOP.FIN | 0 | Declaration-only, but owner exclusion is still needed. |

If TOP.FIN becomes loaded, its `top` declaration reaches the eager sprite
loader even though no timeline child references it. Therefore declaration-only
status alone does **not** establish non-runtime status. No spelling aliases,
sprite substitutes or empty images are authorized by this research.

## Short Multiplayer RMP

[SCENARIO/MPLAYER/PALETTE.RMP](../raw_cd/DC/SCENARIO/MPLAYER/PALETTE.RMP):
67,584 bytes, SHA-256
`364faf322e0e10eda4315d25fd5561c116d613ca5c487d267c5d258a715fc61f`.

**Classification: unproven; preserve the blocker.**

SCN first-line BTS names do not by themselves prove which RMP is opened.
The inspected SCN reader stores the first line at game `+0x548`
(`0x41bb0f`/`0x41bb22`) and builds the `scenario/<terrain>` input using
`0x406880` at `0x41bb86`. That helper formats `%s/%s`; it is not proof of
a palette search policy. This audit does not claim a closed SCN-to-palette
basename edge.

There is a real relative-basename path to investigate:
[MAINE](../raw_cd/DC/INTRFACE/MAINE#L6) declares `palette palette`, the UI
parser recognizes `palette` at `0x42338d`, and UI setup can call the palette
callback with an explicit palette or background basename at `0x422dd8` /
`0x422df0`. Display initialization also requests literal `palette` at
`0x42c49f`/`0x42c4aa`. Neither establishes that the multiplayer-directory
copy, rather than the root copy, is selected.

The registered palette loader `0x42bcac` is installed at `0x42bfd0` and
`0x42c52b`; it forwards the same basename to GIF (`0x42bd1c`), RGB
(`0x42bd42`) and RMP (`0x42bd4f`). The last is the only decoded direct call
to `0x44f200`. RMP loading calls extension/open helper `0x406288` at
`0x44f249`. That helper calls extension builder `0x406040` and open wrapper
`0x405de0`. Final filesystem resolution/current-directory behavior is not
proved here.

If the RMP opens, `0x44f254` requests `0x30000` bytes, `0x44f260` calls
`0x406378`, and `0x44f267` jumps to cleanup without checking the returned
count. The read wrapper calls `0x46d00c` with element size one. The branch
at `0x44f252` goes to generation only on **open failure**, not on an observed
short read. Allocation/initialization of the unread tail and its later use
remain unverified. This does not establish a safe fallback, an old layout,
or eight usable team/effect rows. No padding or borrowing banks is justified.

## Verification

```sh
python3 tools/research/asset-dependencies-20260919.py
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 tools/research/asset-dependencies-20260919.py --probe-lists
PYTHONPATH=/tmp/dc-re-capstone-20260918 \
  python3 tools/research/asset-dependencies-20260919.py \
  --refs 0x425674 0x4267e8 0x422fe0 0x44f200
```

Default census passed: 13 problem FINs, 20 missing names, 108 parsed SCNs,
44 campaign/training list entries, 13 manifests, 127 selected FINs and 187
declared sprite names. It checks selected FIN parse success and UI animation
directive membership. JSON includes all exact FIN requests and owner edges.

**Native list probe passed all 13 source manifests.** Unicorn executes the
original instructions at `0x404e8c` and `0x4267e8`; every captured request
matches the source list in order. File open/read/close, context-cache reset
and the final FIN reader are intercepted. This proves the list iteration and
selection, not successful real sprite loads, full startup, UI reachability,
or gameplay. Capstone/Unicorn are existing isolated research dependencies;
use equivalent environments if the temporary paths are absent.

Optional disassembly accepts repeated `--disasm START END` pairs. Start at
a known instruction boundary; arbitrary addresses can decode operand bytes
as instructions. The script pins the executable hash and never writes assets.
No browser, shared export, full test suite or new agent was used. Only this
report and the owned script were created/edited.

## Next Discriminating Native Check

Instrument **the resolved filename and read result**, not just caller strings:

1. Trace `0x42bcac` (EDX basename), `0x406288` (basename/extension), and
   `0x405de0` through the actual file-open routine during fresh campaign,
   training and stock multiplayer setup. Record current directory, search
   roots, resolved path, caller and selected scenario. Include UI transitions
   and the literal `palette` path. Keep original source files unchanged.
2. If the resolved path ever equals the short MPLAYER RMP, classify it
   **proved required** for that path. At `0x44f260`, record requested and
   returned byte counts, allocation initialization from `0x44f0d0`, and
   subsequent bank/row reads of the unread 129,024-byte tail. Do not turn
   observed undefined/stale memory into fabricated decoder output.
3. If the short file is never selected, finish a static closure of palette
   callers and filesystem resolution before generalizing a finite run into
   a shipped-multiplayer exclusion. A filename grep or one successful match
   is insufficient. Editor/other-executable provenance needs its own loader.
4. In the same native trace, log FIN opens to check the bounded manifest
   result against actual startup and multiplayer transitions. An unexpected
   FIN open falsifies the exclusion boundary and reopens its dependencies.

These checks can strengthen or falsify the classification. They do not lower
the gate or automatically promote phase 2; unsupported required behavior,
general native effects and existing acceptance work remain blockers.
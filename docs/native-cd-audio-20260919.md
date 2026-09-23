# Native CD Audio Controller Audit

## Outcome

The native mission sequence is now supported by executable evidence: seek
physical CD track 2, play continuously to the end of the disc, then restart at
track 2 when the mission sound-update poll observes stopped playback. On this
disc that is `CDDA/TRACK02 -> TRACK03 -> TRACK04 -> TRACK05`, then a polled restart.
This is not a playlist inferred from disc numbering: the native seek parameter,
unbounded MCI play command, and stopped-state controller establish the policy.

The traced main-menu entry opens the CD device but does not start CD playback.
The shared mission UI initialization starts track 2 without a mission/faction
selection parameter. Mission-loop return and menu Quit issue CD stop. No
separate human, alien, menu, or combat playlist is supported by this evidence.

This unblocks the selection/order evidence requested by
[audio-scheduling.md](audio-scheduling.md). It does not wire playback, close
native audio parity, or establish real-device audibility. Only this report and
[the new audit probe](../tools/research/cd-audio-audit-20260919.py) are owned here;
the scheduling doc, runtime, entry point, and existing probes are unchanged.

## Reproduction And Scope

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 tools/research/cd-audio-audit-20260919.py --probe
```

Requires the existing Capstone 5 / Unicorn 2 installations. No package install
is needed in this workspace. The script reuses the PE loader and SHA-256 gate
from [transport-audit.py](../tools/research/transport-audit.py).

Pinned executable: `raw_cd/DC/DC.EXE`, SHA-256
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
Other revisions, including DC16, are not covered. All addresses below are loaded
32-bit virtual addresses, not raw file offsets.

Useful read-only modes, with the same `PYTHONPATH`:

```sh
python3 tools/research/cd-audio-audit-20260919.py
python3 tools/research/cd-audio-audit-20260919.py --disasm 0x42f7f0 0x42f963
python3 tools/research/cd-audio-audit-20260919.py --disasm 0x451888 0x451913
python3 tools/research/cd-audio-audit-20260919.py --disasm 0x451a80 0x451af1
python3 tools/research/cd-audio-audit-20260919.py --disasm 0x431ef6 0x431f3d
python3 tools/research/cd-audio-audit-20260919.py --xref 0xb8 0xbc 0xc0 0xc4 0xc8 0xcc
```

Disassembly starts must be instruction-aligned. Discovery scans only `AUTO` and
matches exact Capstone operands. It is a linear scan, not a proof excluding all
possible computed calls. The positive call paths below are additionally executed.

## Imports And Controller State

`WINMM.dll!mciSendCommandA` is imported at `0x470570`; the import thunk is
`0x46f3e4`. The CD wrappers call the IAT directly at `0x4513c4..0x451aa3`.
`WINMM.dll!timeGetTime` is at `0x470590`, called by `0x40b030` at `0x40b035`.
The probe prints every discovered direct MCI call address.

| State | Meaning and evidence |
| --- | --- |
| `0x479628` | CD device ID; low 16 bits passed to MCI; open failure stores `-1`. |
| `0x47962c` | Disable/failure latch; nonzero suppresses public start, stop, count, and poll operations. Open failure sets 1 at `0x42f810`. Successful open does not explicitly clear it. |
| `0x4d199c` | Last CD status-poll timestamp; read at `0x431efb`, updated at `0x431f17`. No other direct operand references were found. |
| `game + 0x7d18` | Interface pointer used by mission start and polling. |

There is no persistent CD playlist cursor in the recovered controller. The
wrapper's `track + 1` return value is not stored as a next-track schedule.

Native registration at `0x42fae9..0x42fb1b` and interface copying at
`0x42c65e..0x42c6b8` establish these callback mappings. The probe executes both
blocks, rather than substituting a hand-built callback table.

| Source slot | Interface slot | Target | Operation |
| --- | --- | --- | --- |
| `+0x16c` | `+0xb8` | `0x42f7f0` | Open CD device. |
| `+0x170` | `+0xbc` | `0x42f844` | Start supplied track from `AL`; no call through this interface slot found. |
| `+0x174` | `+0xc0` | `0x42f878` | Stop CD. |
| `+0x178` | `+0xc4` | `0x42f894` | Start fixed track 2. |
| `+0x17c` | `+0xc8` | `0x42f8b8` | Poll/recover playback. |
| `+0x180` | `+0xcc` | `0x42f820` | Query track count. |

## Physical Track Parameters

The selected-track wrapper `0x451888` receives device ID in `AX` and physical
track in `DL`. Native instructions issue the following calls in order:

1. At `0x4518af`, `MCI_SET (0x80d)`, flags `0x400`:
   `dwTimeFormat = 10`, meaning `MCI_FORMAT_TMSF`.
2. At `0x4518d6`, `MCI_SEEK (0x807)`, flags `8` (`MCI_TO`):
   `dwTo = track`. Minutes, seconds, and frames are zero on the success path.
3. At `0x4518f6`, `MCI_PLAY (0x806)`, flags zero. There is no `MCI_FROM`,
   `MCI_TO`, `MCI_NOTIFY`, or per-track end bound.

The apparent increment at `0x4518d5` only prepares the return value, after the
seek parameter has been written. Probes with 2, 3, 4, and 5 verify seek values
2, 3, 4, and 5, respectively, and return values 3, 4, 5, and 6. It is not a
zero-based audio-index conversion and does not skip one track.

Microsoft's [TMSF definition](https://learn.microsoft.com/en-us/windows/win32/multimedia/mci-tmsf-track)
places the physical track in the low byte. The
[MCI_PLAY contract](https://learn.microsoft.com/en-us/windows/win32/multimedia/mci-play)
defaults to current position through end of media when FROM/TO are absent.
[MCI_SEEK](https://learn.microsoft.com/en-us/windows/win32/multimedia/mci-seek)
positions the device and leaves it stopped before the subsequent play.

| Native physical track | Converted source | Indexed output |
| --- | --- | --- |
| 2 | `CDDA/TRACK02` | `cd/TRACK02.ogg` |
| 3 | `CDDA/TRACK03` | `cd/TRACK03.ogg` |
| 4 | `CDDA/TRACK04` | `cd/TRACK04.ogg` |
| 5 | `CDDA/TRACK05` | `cd/TRACK05.ogg` |

These identities come from the existing
[media index](../public/assets/generated/media/index.json) and disc extraction
contract described in [audio-scheduling.md](audio-scheduling.md). This audit
does not reconvert the assets or claim a new PCM/audio hash verification.
The unused next/previous helpers at `0x45150c` and `0x4515f8` must not be used to
infer gameplay policy; no immediate references to them were found in `AUTO`.

## Event Ordering And Timing

### Menu

The menu routine beginning at `0x404b1c` opens CD through interface `+0xb8` at
`0x404ba7`. It subsequently loads `intrface/bintro` (string `0x472468`). Open is
`MCI_OPEN (0x803)`, flags `0x2100` (type plus shareable), type string `cdaudio`
at `0x477b18`. Opening alone issues no play command. Menu choice 12, on the
process-exit path, calls `+0xc0` at `0x404d4d` before further cleanup/exit.
Choices 0 and 1 bypass that stop branch. There is no recovered menu CD track
assignment; this says nothing about AVI sound or menu sound effects.

### Mission Start And Exit

The mission/UI initializer `0x41e8f0`, called at `0x401978`, reaches `0x41ef44`:
load the interface from `game + 0x7d18`, then call `+0xc4` at `0x41ef4f`.
The target `0x42f894` sets `EDX = 2` at `0x42f8a3` before `0x451888`.
There is no mission ID, faction, combat state, or random selector in this path.
The start precedes the later mission-loop call at `0x401a53 -> 0x401168`.
On return, `0x401a58..0x401a5a` invokes `+0xc0`, producing
`MCI_STOP (0x808)`, flags zero, before the following `+0xb4` cleanup call.

Mission start is SET -> SEEK(track 2) -> PLAY. It does not explicitly STOP first
or reopen the device; SEEK itself changes the device state. This is a fresh
track-2 start on this shared initialization path, not continuation from the
previous mission's saved audio position. The probe executes the native start
and stop call-site slices, not a complete mission or its rendering loop.

### Poll And Repeat

The mission sound update `0x431e88` is called at `0x40a75f`. At `0x431ef6` it
reads milliseconds through `0x40b030 -> timeGetTime`. At `0x431f0f` it compares
the signed 32-bit difference `now - [0x4d199c]` with `0x1388` (5000).
`jle` skips the CD poll. Only a strict `> 5000` writes the new timestamp and
calls interface `+0xc8` at `0x431f2a`.

This is an update-driven elapsed-time gate, not an independent five-second
timer, a notification callback, or a delay measured from track completion.
Boundary probes at 0, 4999, 5000, 5001, and 12000 ms confirm this distinction.
The timestamp is global, not stored in the mission or reset in the shown start
path. A stalled/suspended update loop can postpone recovery beyond five seconds.

The status wrapper `0x451a80` requests `MCI_STATUS (0x814)`, flags `0x100`,
item 4 (`MCI_STATUS_MODE`). Its native return classifications are:

| MCI result | Wrapper result | Controller action |
| --- | --- | --- |
| Playing `0x20e` | 0 | None. |
| Paused `0x211` | 0 | None. |
| Open `0x212` | 1 | None. |
| Not ready `0x20c` | 2 | None. |
| Stopped `0x20d` | 3 | Close/reopen/restart. |
| MCI status error | 4 | Close/reopen/restart. |

For stopped or status error, `0x42f8b8` executes:

```text
STATUS(mode) -> CLOSE -> store device=-1 -> OPEN(cdaudio)
  -> SET(TMSF) -> SEEK(track 2) -> PLAY(no bounds)
  -> SET(TMSF) -> PLAY(no bounds)
```

The second SET/PLAY is genuinely present (`0x42f917` or `0x42f958` calls
`0x4513dc`); it does not select a second track. There is no per-track software
advance at 02/03/04 boundaries: the drive continues until end of disc. Disc-end
wrap can occur only when a subsequent eligible poll sees stopped status.

## Probe Boundary And Results

The focused probe reports 28 cases plus four disabled-gate assertions. It
executes original machine instructions for CD wrappers, controller branches,
interface registration/copy, menu and mission call-site slices, and the clock
comparison. Capstone assertions also pin the five direct interface call sites
and the two direct last-poll references.

Explicit external stubs replace only the MCI and timeGetTime IAT destinations:
MCI returns synthetic device ID 7, requested success/error/status results, and
track count 5; the clock returns specified milliseconds. The stub consumes
stdcall arguments from the native stack and records commands, flags, and
relevant structure fields. It does not choose tracks, inject controller
branches, emulate completion waits, or implement an alternative scheduler.
Slices have synthetic object/stack state and bounded instruction counts.

Covered failures include SET/SEEK/PLAY early exits in the selected-track
wrapper and open failure setting device `-1` plus the disable latch. Native
error handling is not a model for safe web retries: the generic selected-track
controller checks for `-1` although its wrapper returns 0 on failure, and the
recovery path does not recheck the disable latch between failed reopen and its
subsequent calls. Do not reproduce these quirks as an automatic browser retry
policy. Recovery with a failing reopen is statically visible but not a separate
end-to-end emulated recovery case in this probe.

No original Windows driver, physical drive, full-game execution, browser,
agents, or full test suite was used. Hardware seek latency, inter-track sector
behavior, output volume, pause/focus behavior outside these paths, exact
audible start time, and all alternate executable revisions remain unverified.

## Safe Minimal Integration Policy

For a future authorized integration, use the existing
[MissionSoundtrack](../src/audio/soundtrack.ts) with this native-informed run:

```ts
{
  kind: "explicit-playlist",
  sources: ["CDDA/TRACK02", "CDDA/TRACK03", "CDDA/TRACK04", "CDDA/TRACK05"],
  repeat: "none",
}
```

1. Do not start CD music in menus. After explicit music consent/gesture unlock
   and successful current-mission initialization, start this sequence at 02.
   Keep the generation/token check and shared audio manager.
2. Advance 02 -> 03 -> 04 -> 05 only on natural completion, as the scheduler
   already does. To approximate native wrap timing, keep a lifecycle-owned
   last-poll timestamp and check it from active mission updates. When elapsed
   is strictly greater than 5000 ms, update it; restart at 02 only if the
   scheduler is `completed`. Check the gate throughout playback, not only
   after track 05 ends. Preserve the poll timestamp across mission replacement
   if matching the recovered global-state layout is required.
3. Do not use `repeat: "all"` while claiming timing parity: it wraps as soon as
   the final voice ends. Do not restart `blocked`, `idle`, or `disposed` states
   from the poll. An error, mute-at-boundary, eviction, or suspension must keep
   the existing explicit retry/gesture workflow. This deliberately improves
   safety over the original MCI-error restart behavior.
4. On mission exit/replacement/result/failure, cancel the polling lifecycle and
   call `soundtrack.stop()` before `audio.stopAll()`; dispose on final teardown.
   The native positive anchor is stop after mission-loop return. Earlier stop
   on web result/failure transitions is a safety choice, not separately proven
   native timing. Never let an old completed callback restart menu playback.
5. Retain the scheduling doc's bounded decode budget, shared mute, cancellation,
   and device-QA requirements. Gain 0.25 and cue priority 10 are existing web
   choices, not recovered native CD settings. Do not allocate another unlimited
   PCM cache or duplicate native SET/PLAY as overlapping web voices.

The existing scheduler has no prefetch/gapless guarantee: separate Ogg fetches
and decodes may introduce gaps where the native drive played continuously.
Thus selection/order and lifecycle intent are unblocked, but exact native audio
parity still needs a bounded continuous-playback strategy and orchestrator-owned
device/audibility QA. No runtime integration is performed by this audit.
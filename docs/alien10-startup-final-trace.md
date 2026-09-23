# ALIEN10 Startup Final Trace

2026-09-23. **Authentic first-hive funding remains unresolved; full-game blocker
remains open.** The requested original startup branch was executed, but an
unmodeled startup sound/file/CRT boundary prevented reaching the first natural
build attempt. No funding or free-build policy is justified by this trace.

## Executed Path

Reused the existing Unicorn/Capstone dependencies and
[ALIEN10 loader probe](../tools/research/alien10-first-hive-20260923.py), retaining
the original executable instructions and full 58-actor SCN result. The temporary
observer extracts only the loader portion; it does **not** run that probe's
direct commander-allocation control or its supplied menu-event control.

Preserved configuration header `[1,0,1,0,0,0,0,0]`, mode 0, pointer `0x850000`.
This remains the existing explicitly selected campaign profile, **not recovered
installed settings**. Reconstructed the caller's `EBP+0x76` game pointer,
preserved `EBP+0x7a` configuration pointer and existing zero byte at `EBP+0x8e`.
This is a post-loader continuation, not a complete process-boot proof.

Observed original instruction path:

```text
4018b8 -> 40196f -> 401978 call 41e8f0
41e90b call 44da88 -> 41e969 call 406568 -> 41e979 call 46cbec
41e990 call 431130 -> 43115d call 40601c
```

Mode 0 takes the original branch past the multiplayer relation loop. The last
call requests `sound/slist.dat`, mode `rt`, return address `0x431162`.

## Watched State

| Field | Before | At boundary | Observed writes |
| --- | ---: | ---: | ---: |
| Team 0 money, game `+0xbac` | 1500 | 1500 | 0 |
| Team 0 accounting, game `+0xbb0` | 0 | 0 | 0 |
| Central city HP, game `+0xbd4` | 0 | 0 | 0 |
| DEPEND-14 cost, global `0x4e7050` | 2000 | 2000 | 0 |

All 15 city HP words remain `[0,0,0,0,0,1,0,0,0,0,0,0,0,0,0]`; slot 5 is
the existing marker, not a constructed central hive. Entire game `0x471b0`
bytes, all 110 DEPEND records, and captured configuration bytes are unchanged.
No entry into `0x433124` or watched command/packet entries `0x437f3c`,
`0x40c13c`, `0x421648`, `0x421725`, `0x421770` occurred in this prefix.
This does not claim absence of later packets or later funding.

## Concrete Boundary

The first run continued into the original file-open implementation. Its nested
CRT allocation reached `0x46b39c: call dword ptr cs:[0x470524]`. That unresolved
IAT slot contains `0x70d80`, whose PE import name is `VirtualAlloc`; Unicorn
stopped with `UC_ERR_FETCH_UNMAPPED` at `0x70d80` after 6,954 instructions.
The second run stopped cleanly at `0x40601c` after 6,439 instructions to capture
the request, without supplying a handle, allocation, return value, or skip.
This is a missing harness service, **not evidence that the original game fails
or that the requested sound file is absent**.

Further authentic execution requires an established native process/platform
context: resolved imports and CRT allocation/file services, original relative
asset-path resolution for `sound/slist.dat` and its subsequent dependencies,
sound initialization state, and initialized native UI/input objects. The
loader harness's supplied object/map handles and load-time file/clock/table/FIN
services do not establish that context. Recover the actual installed settings
and caller state, or explicitly authenticate an equivalent startup environment;
then observe real player input through the first build attempt. Do not disable
the sound initializer, return a fabricated handle, or supply a purchase event
and describe the resulting action as natural.

## Evidence And Scope

- First native run: `/tmp/dc-al10-startup-final-native-20260923-f06.log`.
- Boundary confirmation: `/tmp/dc-al10-startup-final-boundary-20260923-f08.log`.
- Both have adjacent `.exit.json` receipts: observer exit 0, about 3.8 seconds,
  each under a 120-second SIGKILL cap. Observer success does not mean startup
  success; the first log explicitly records the native fault.
- Temporary observer: `/tmp/dc-al10-startup-final-observer-20260923-f04.py`.
- Local disassembly: `/tmp/dc-al10-final-disassembly-20260923-f03.log` and
  `/tmp/dc-al10-final-boundary-disassembly-20260923-f07.log`.
- EXE SHA-256: `65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
  Both logs include all six mission-source hashes and inherited loader
  boundaries; source inputs were verified unchanged.

The prior supplied-event refusal at 1500/2000 remains valid only as a control:
`/tmp/dc-al10-readonly-fullmenu-retry-1790160911759.log`; see
[the earlier economy report](alien10-first-hive-economy-20260923.md).
No funds injection, free queue, forced delivery/purchase, runtime or source-asset
edit, agent, package install, or broader mission run was performed. This report
is the only repository edit; observer and evidence files are under `/tmp`.
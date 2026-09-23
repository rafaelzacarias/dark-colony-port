# Live Session Diagnostic Retention

## Contract

`CampaignSessionOptions.journalLimit` defaults to 4096 successful frames. A
nonnegative safe integer sets capacity; 0 disables diagnostic storage. The
explicit JSON-safe string `"all"` enables unbounded diagnostic history for
tools needing it. Infinity, null, negative and fractional limits are rejected.
Existing callers observing at most 4096 frames retain the same history; callers
requiring an entire longer history must opt into `"all"`. This is diagnostic
history, not an input replay recorder.

The session owns a ring with constant-time append/eviction. It clones only the
new entry per successful frame, never the retained history during append.
`journal` returns a detached chronological suffix, cloning only on explicit
read. `journalStats` returns cheap detached `{ total, retained, dropped }`
counters without reading or cloning entries. Failed inputs change neither
entries nor counters. Entry count is bounded, not the byte size of an unusually
event-heavy frame. Callers retaining returned frames/journals own that memory.

Schema-2 checkpoints keep the configured option but omit diagnostic entries and
counters. Restoring starts all three counters at zero; the first new entry uses
the continued gameplay cycle. Saving alone does not reset the live ring.
Schema-1 migration replays its supplied inputs with the selected/default limit;
total counts replayed successful frames, and only the retained suffix survives.
New sessions do not store a private input history. Old checkpoints without the
option use 4096. Both schemas validate the new option.

Identity provenance, host requests/receipts, gameplay state and production
deduplication are not evicted. MissionView checkpoints already use
`identityProvenance`, independently of `journal`.

## Measured Evidence (2026-09-19)

The first focused idle run completed 20,000 frames plus 100 continuation frames:
4096 retained, 16004 dropped, exact cycles 16005 through 20100 in order.
Direct saves were 457698 bytes at frame 1000 and 457701 at frame 20000.
Direct restore did not call `step`, started with empty diagnostics, and matched
100 subsequent gameplay frames. This initial fixture used a small map with one
source unit. The final regression uses an empty map and one unit definition,
with no source tasks: 423400 save bytes at frame 1000 and 423403 at frame 20000,
again 4096 retained / 16004 dropped after continuation. It took 184.0 seconds;
the existing fixed-size world cloning and feedback work still dominates even
with no tasks. This change bounds diagnostics, not overall per-frame CPU work.

One actual HUMAN01 source session, with original triggers and transport startup,
was measured at two boundaries without accumulating journal snapshots:

| Frame | Total / retained / dropped | Journal JSON bytes | Checkpoint JSON bytes | Heap used bytes |
| --- | --- | ---: | ---: | ---: |
| 1000 | 1000 / 1000 / 0 | 295291 | 628618 | 76428160 |
| 10000 | 10000 / 4096 / 5904 | 569001 | 628622 | 88192488 |

The 10k sample retained exactly cycles 5905 through 10000. At both boundaries:
5 host requests, 1 host receipt, 5 identity events and 1 message. Production was
not enabled. Elapsed time was 172.7 seconds. Although launched with
`--expose-gc`, this test worker reported `explicitGc: false`; heap values are
unforced samples, not a post-GC plateau or proof of all-memory boundedness.
JSON byte counts are serialized sizes, not heap attribution. This is a direct
CampaignSession measurement, not a browser/MissionView battle benchmark.

Verification: 44 focused tests passed across campaign session, production
session and resource lifecycle. The unrelated 20k producer endurance case was
excluded; the opt-in source measurement passed separately. Coverage includes
exact suffix order, detached reads/frames, failed input rollback, capacities
0/1/3, explicit `"all"`, invalid limits, schema-1 migration, schema-2 counter
reset/continuation and identity provenance after diagnostic eviction. Project
typecheck passed. No agents, browser checks or full suite were used.

Reproduce the source measurement explicitly (skipped in normal test runs):

```sh
DC_SESSION_RETENTION=1 node --expose-gc --import tsx --test --test-name-pattern='source session retention' tools/qa/campaign-session.test.ts
```

## Remaining Gates

Runtime production compaction already removes session-generated `sync-credits`,
`producer-idle`, `producer-wait` and `producer-advance` events after every
successful step. No additional compaction or production API change was needed.
Meaningful production journal events remain because the reducer checks event
IDs there for deduplication; production requests also remain event-growing.

Host requests (including identity provenance and resource sound events), host
command receipts, world messages and controller consumed-loss IDs remain
uncapped event-driven collections. Diagnostic eviction must not discard these
without a separate gameplay/replay-safe design. Death/spawn churn, active
production/resource long runs, whole-application post-GC retention and retained
external snapshots remain unverified. The per-frame diagnostic growth gate is
fixed; the all-memory long-session retention gate is not claimed closed.
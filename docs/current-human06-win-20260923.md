# Current Human06 Verified WIN

Fresh current-runtime acceptance on 2026-09-23, using the unchanged
[existing driver](../tools/qa/mission06-playthrough.ts), human only, original
source, public MissionView commands and the original prison-escape objective.
No runtime, QA, source or asset edits; no resumed historical checkpoint, migration,
grants or injected result. Only this report was added to the workspace.

## Result

- Start tick: **0**. Pending WIN: **1546**. Ready WIN: **1747**.
- Outcome: `resultCode: 0`, `reasonCode: 1`, `ready: true`; verified status `WIN`.
- Pending JSON restore plus **201 ticks** reproduced the entire ready checkpoint
  exactly, not just the outcome. Original source trip 1 fired in the campaign journal.
- Current persisted marker: `session.replayPolicy = current-population-v1`;
  session schema 3, MissionView version 1, runtime profile `browser-adapted`.
  Pending and ready markers match. No checkpoint rewriting or migration occurred.
- 290 public commands, 358 shots, 30 deaths, 0 purchases, 0 credits earned/spent.
- Play: **34626 ms**; restore/proof: **24737 ms**; worker total: **60051 ms**;
  launch-to-supervisor-exit wall time: **60330 ms**. Budgets: 600000/900000 ms.
- Supervisor and worker exited 0, no signal, no expired deadline.

The unused original MTG tags remain intact. This run uses the existing runtime
fix documented in [mission06-trip-fix-20260923.md](mission06-trip-fix-20260923.md),
without another native probe or any new runtime adjustment.

## Current Hashes

SHA-256 values from this run, not the historical acceptance:

| Item | SHA-256 |
| --- | --- |
| Ready checkpoint, expected and restored | `d22dff4fb719fdd408372894ea917e945e1ab5cde04a310103929de6a494c148` |
| Runtime manifest, before and after | `5078373bd50753ba5964bb4067f285ec24f249237bac313aee96b65853f74184` |
| Loaded mission sourceHash | `8abf1409c723168f9a02971ff61330c234ffac95f4f90574f4df58e6ac5f5f96` |
| Canonical checkpoint sourceIdentity | `08ac75fbd342d6949f52483b65dbc16bf08594b6933f3d122bd25d6c32638f27` |
| MissionView | `16d9536a197935b088931df10da55ba516eea3a942771a5bdaf9e6615d9fa1b6` |
| CampaignSession | `c9568214e61f8a4a80181b0e997e661a957b8f0b8db3926b876ca66e2618878c` |
| Mission controller | `6db3830156f652ff4d04a40ba8fa8663eae6d6a6187e48df0f836b2a3820a5dc` |
| Unchanged driver | `e19e3f9697835deaf43cdf588c7a8769b36d18023abc6c28f4676c8c3adc9143` |
| HUMAN06.SCN | `8296536bb8b29d995115e571cbc01f6048e18792a539d7b1cfc75e82143489e3` |
| HUMAN06.TRO | `c46c6c2bf51fdd81babbce09bd8fcc69c052fcfbd4d0c9d9d6e9ccc8a1577402` |
| HUMAN06.MAP | `39f109b01536bc59f1db58715b88a01a22ba7002f6efe61581cce80014b5174d` |
| HUMAN06.MTG | `c467372a526b1eac53acf46983082c7e74151f10399ba32694074d286a42f5a4` |
| HUMAN06.PTH | `9863a63959247055ed8a9340239f5320806cd1127ba181fc9e73fb6c74b0ec88` |

The manifest hash is SHA-256 of `JSON.stringify(integrity.before)` or `.after`:
the sorted path-to-SHA-256 map for all source TypeScript files and the two driver
fixtures, 125 files total. Other Mission05 QA changes are excluded. Runtime,
fetched-asset and subsequent current-file differences are all empty. Original
SCN/TRO/MAP/MTG/PTH hashes also match the subsequent audit. No Git metadata is
present in this workspace; this is file-content evidence, not a commit claim.

## Evidence And Checks

Absolute evidence directory: `/tmp/dc-current-human06-20260923-1790171065933/`.

- `human/`: source, initial, pending-win, checkpoint, campaign-journal, proof,
  result, integrity and exit JSON; command journal and supervisor JSONL.
- Root: `launch.json`, `launch-exit.json`, `run.log`, `current-audit.json`,
  `checkpoint-markers.json`.
- Existing actual-artifact acceptance plus bounds and original MTG checks:
  **3 passed, 0 failed, 0 skipped**, exit 0. Log:
  `acceptance-1790171143333.log`; duration 26998 ms including process overhead.
- Strict scoped TypeScript check of driver and its test, including imported
  runtime: **exit 0**, 1659 ms; `types-1790171143333.log`.
- Check receipts: `checks-1790171143333.json`.

The first fresh attempt, `/tmp/dc-current-human06-20260923-1790171022953/`,
was interrupted by the shared terminal during stepping. Its supervisor killed
the worker; it is not acceptance evidence. The successful retry detached the
supervisor from shared-terminal signals. Final process audit found no active
owned supervisor, worker or test process from either attempt.

This proves one complete fresh Human06 mission and exact current-marker restore
through the original-script browser-adapted Node/NullCanvas path. It does not
claim browser pixels, campaign progression, Alien06, full-game completion or
native execution parity. No browser, agents or full test suite were launched.
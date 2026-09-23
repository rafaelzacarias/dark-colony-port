# H14 Bounded Mission QA

2026-09-23. **One new verified mission: HUMAN14. Ledger: 9 distinct WINs,
21 missions completion-unverified. Full game remains unaccepted.** Mining is
the primary repair and was not touched by this QA work.

Only the new [supervisor](../tools/qa/mission-h14-bounded-20260923.mjs),
[read-only acceptance tests](../tools/qa/mission-h14-bounded-20260923.test.mjs),
and this document were authored. The existing campaign13-15 driver, runtime,
other QA files, sources and assets were not edited. No browser of any kind,
external browser script, subagent, native probe, or full suite was launched.

## Actual H14 Completion

Fresh original HUMAN14, `browser-adapted` loader, public MissionView commands,
real source assets and Node/NullCanvas. This is not browser pixels, native
execution parity, mining verification, or campaign progression acceptance.
No source, health, funds, fog, statistics, or trigger overrides were used.

Artifact root: `/tmp/dc-h14-bounded-20260923-BzJVuy`.

| Measurement | Actual result |
| --- | --- |
| Start | Fresh tick0; no historical resume or migration |
| Original objective | TRO trip3 `(S==0)`, original `bail 0 1`; trip recorded in journal |
| Pending WIN | tick765 |
| Ready WIN | tick966; result0, reason1, ready=true |
| Commands / shots / deaths | 138 / 20 / 1 |
| Play child | 22159ms, exit0, no signal, reaped; hard cap180000ms |
| Separate proof child | 14585ms, exit0, no signal, reaped; hard cap330000ms |
| Entire launch | 36782ms; supervisor total36749ms, total cap540000ms |
| Restore | Guarded pending JSON restore, then201 normal updates; entire ready checkpoint equal |
| Integrity | Empty runtime, fetched-asset and original-source difference lists in both workers; play-after equals proof-before |

Exact expected and restored ready-view SHA256:
`e98d08f706da19ecc38d41e6137b7055c99ce9023da276d569aa040cc3e4a6c5`.

Unchanged existing driver SHA256:
`677cff228e0a729fb146acec558d7f45d86b67f49b2ed13f783cc5d89c087c60`.

The supervisor invokes only the existing driver's `--worker --case=H14`,
not its six-mission group. One play child ran, without retry; only its actual
ready WIN authorized a separate `--proof` child. Both phases are synchronously
reaped with SIGKILL hard deadlines. Partial results and exit0 alone cannot
be accepted as WIN.

## Updated Ledger

The eight earlier artifact hashes were recomputed and matched their published
proofs. That is historical evidence preservation, not eight fresh current-code
replays. Only H14 was played and independently replayed in this task.

| Mission | Verified ready tick | Evidence qualification |
| --- | --- | --- |
| H01 | 5177 | Historical complete trace hash retained |
| A01 | 6945 | Historical complete trace hash retained |
| H02 | 21265 | Historical ready-view hash and original outcome retained |
| A02 | 32689 | Historical ready-view hash and original outcome retained |
| H03 | 6713 | Historical ready-view hash and original outcome retained |
| A03 | 12633 | Historical ready-view hash and original outcome retained |
| H05 | 26344 | Historical independent proof; ready-view hash retained |
| H06 | 1747 | Previously fresh current-population proof; ready-view hash retained |
| H14 | 966 | New fresh play plus independent exact proof in this task |

Remaining: H04, H07-13, H15, and A04-15. Their lack of completion evidence
does not establish impossibility. Historical sources/proofs are detailed in
[current verification](current-runtime-verification-20260923.md),
[H05 proof](human05-ready-verification-20260923.md), and
[H06 proof](current-human06-win-20260923.md).

## Latest Non-Winning Evidence

The report discovery was checked against saved result/latest JSON, not merely
assumed from stale conversation context. Inventory:
`discovery-1790182499052.json` under the new artifact root.

| Group | Latest inspected evidence | Next priority |
| --- | --- | --- |
| A05/A06 | A05 tick3170, no outcome, commander-health-reserve; A06 report has only opening tick448 | A05 escort/route survival; A06 actual production/army and CITY assault. Neither accepted as WIN |
| 07-09 | H07 116, A07 462, H08 399, A08 113, H09 340: incomplete. A09 ready LOSS2313 after pending WIN2096; separate prior exact LOSS proof | A09 protection/support through pending delay, not trigger-precedence changes; other missions need substantive strategy work |
| 10-12 | H10 incomplete1761; A10 initialization blocker0; H11 ready LOSS5193; A11 incomplete2137; H12 incomplete411; A12 incomplete81 | A10 diagnostic belongs to runtime owner; H11 commander protection and original seven-target objective; other runs need longer effective strategy, not fabricated income |
| 13-15 prior group | Root `/tmp/dc-campaign1315-original-20260923-r3` contains only H14 artifacts, latest tick100, no result/proof | Do not claim six executed outcomes from that unfinished report. New H14 evidence above supersedes that partial attempt |

Mining remains first priority. The stored A10 diagnostic is exactly
`Browser research: source research dependency mismatch`, in
`/tmp/dc-campaign-10-12-owned-20260923-r01/A10/result.json`; this task did not
rerun A10 or assert that its older diagnostic persists after concurrent changes.
Its independent authentic first-hive question remains1500 original credits
versus2000 cost. The [startup trace](alien10-startup-final-trace.md) stopped at
an unmodeled native platform boundary, not proof of a free hive or later grant.
No runtime repair or funding workaround was made here.

A14 is the next inexpensive candidate because its original trip3 also tests
entering team0, not commander type. It was deliberately not attempted: this
task's single mission allowance was consumed by H14. A05/A09/H11 tactical
failures must not be reclassified as proven runtime defects. Mission15's
special deployment gaps remain reported, not freshly tested here.

## Acceptance And Cleanup

Two focused read-only tests passed, zero failures/cancellations/skips, in3357ms.
They verify original H14 goal/journal, pending-to-ready201 updates, complete
restored save equality, uninterrupted integrity across workers, hard bounds,
worker absence, and all eight retained historical hashes. Syntax check passed;
no complete campaign test suite was run.

- Launch log: `/tmp/dc-h14-bounded-launch-1790182372372.log`, adjacent exit receipt.
- Acceptance log: `/tmp/dc-h14-bounded-acceptance-1790182470551.log`, adjacent exit receipt.
- Root `summary.json`, `play-exit.json`, `proof-exit.json`, and H14 source,
  input journal, pending, ready, restored-ready, proof and integrity files persist.
- Final process audit: launcher46736, supervisor46737, play46738, proof46743,
  acceptance47482 all absent with ESRCH. No owned worker was left running.

Read-only acceptance reproduction, with no browser or simulation stepping:

```sh
DC_H14_BOUNDED_ARTIFACTS=/tmp/dc-h14-bounded-20260923-BzJVuy node --test /Users/rafael/Downloads/darkcolony/tools/qa/mission-h14-bounded-20260923.test.mjs
```
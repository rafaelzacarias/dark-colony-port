# Original Mission04 Public-Command Attempt

## Outcome

**Completion proof not achieved.** Neither H04 nor A04 produced pending or ready WIN; exact pending-to-ready restore was therefore not exercised. No concrete runtime diagnostic was observed. The failures are QA strategy and budget-enforcement failures, not evidence of an engine blocker.

Owned files: [runner](../tools/qa/mission04-playthrough.ts), [tests](../tools/qa/mission04-playthrough.test.ts), and this report only. No runtime, original maps/scripts, health, funds, fog, enemy orders, or shared drivers were edited. No agents were used. This is original-script browser-adapted MissionView with QA NullCanvas, not browser visuals or native parity.

## H04

- Actual player commander simulation38 received public Move calls to trip6, then trip7. Original rescue type72/team1 spawned as slot197/generation0 at source cycle461, `(6,29)`.
- Original block7 executed `abduct 1 1` at cycle529; slot197/generation0 received `remove-noncombat` and `clear-collision` at cycle588. This is actual original-map discovery/extraction, not controlled predicates.
- Final tick12411, outcome `null`, no diagnostic. Player City `[4800,2400,0,0,0]`; enemy team2 hive `[4800,2400,0,0,0]`, unchanged. The assault failed to clear intervening turrets; only two source type42 losses were published.
- 1161 movement/attack/harvest calls, 48 accepted infantry purchases, 1019 combat events, 54 deaths. Original economy: initial3500 + earned13618 - spent16800 =318. Original stats: `s(0,3)=52`, losses `s(0,0,0)=48`, `s(0,0,2)=2`, `s(0,0,69)=2`; `s(2,0,42)=2`. Full original statistics are preserved in the result artifact.
- Source loader hash: `f0529fa781ba35e6da4dee1f3c495da945beb5e74ea9d72d6db6a29729f5aa48`.

## A04

- First actual attempt sent the player commander through original turrets near `(55..57,63..68)`. He died at simulation320, producing original block20 ready LOSS at529, result/reason1/3. This is a strategy failure. A concurrent production-panel change additionally invalidated that attempt's stable-revision claim.
- Revised scouting excluded an eight-cell radius around source-known hostile turrets. It found no route from `(73,58)` to trip16 near `(11,90)`: the commander stayed alive at800HP but never reached the depot. The exclusion is a QA path choice, not proof that the original map is unreachable.
- Final tick2589, outcome `null`, no diagnostic; only blocks21 and1 fired. No trip16, relocation18, City-clear9, rescue/artifact10, or extraction/WIN11 committed.
- Enemy team1 City remained `[4800,2400,2400,2400,0]`; player City remained `[999,999,999,999,0]`. 90 public orders, 90 combat events, 11 deaths; credits/earned/spent/purchases all zero. Original losses `s(0,0,8)=7`, `s(0,0,10)=4`, `s(0,0,73)=0`.
- Source loader hash: `cbfe1e84d397507a07c2f17fbf25065a28d755b2b38d7082e93b4567ef7f0a78`.

## Budget Failure

Final runs configured550000ms stepping per faction, leaving room for earlier short attempts. However, recorded H04 stepping was1376946ms and A04 was1463769ms. Supervisor phase timestamps agree with those intervals, yet both historical exit receipts say `expired:false`. The cause of delayed enforcement is not established. These runs **violate the requested600s budget** and are not bounded acceptance evidence. No further stepping was performed after the audit.

The runner now rejects elapsed-budget violations as `HARNESS_BUDGET_EXCEEDED`, refuses winning proof after over-budget stepping, and checks elapsed phase time before rearming the supervisor. Focused tests cover rejection; a new long-run deadline enforcement test was not performed. Historical artifacts retain their original `HARNESS_LIMIT` labels and are not rewritten.

## Provenance

- Final artifacts: `/tmp/dc-m04-final-r05/{human,alien}/` contains original five-file hashes, loader hash, initial data, actual call/source-event journal, latest/final original stats, full checkpoint, integrity hashes, supervisor phases, and exit receipt. Neither directory contains a winning proof.
- Compact final audit: `/tmp/dc-m04-final-audit-r12.json`; rescue/source-call detail: `/tmp/dc-m04-provenance-r08.json`; budget audit: `/tmp/dc-m04-budget-audit-r10.json`. Final runtime hash changes `[]`, hidden direct attacks0 for each faction, active mission04 processes `[]`.
- Earlier attempt: `/tmp/dc-m04-actual-r02/`. H04 was interrupted with SIGKILL during stepping; A04 exited after source LOSS. Other requested launches never created logs and are not counted as runs. Shared-terminal command substitution/interruption required checking task-owned artifacts rather than trusting echoed output.
- Public calls: `replaceSelection`, `setCameraCenter`, `setOrderMode`, `commandAt`, `harvestSelected`, `purchaseProduction`, and normal `update`. Only visible enemy cells receive direct assault calls. Hidden source-known destinations receive Move calls. All production costs and extraction effects come from original runtime actions.

## Validation And Reproduction

Two focused tests pass; two WIN artifact acceptance tests are skipped because there are no wins. Log: `/tmp/dc-m04-budget-tests-r11.log`. Strict scoped TypeScript before the final budget guard passed with exit0: `/tmp/dc-m04-types-final-r06.json`; post-guard editor diagnostics are clean. No full suite or browser test was run.

```sh
node --import tsx --test tools/qa/mission04-playthrough.test.ts
DC_M04_OUTPUT=/tmp/dc-m04-new-unique node --import tsx tools/qa/mission04-playthrough.ts
```

The second command is preflight only. `--run --faction=human|alien` executes a bounded attempt, but the current strategies are **not winning plans**. Do not repeat long runs without fixing the assault/scouting plans and independently verifying deadline enforcement. `DC_M04_PROOF=/absolute/artifact-directory` supports a separate900s exact restore only when genuine pending and ready checkpoints exist.
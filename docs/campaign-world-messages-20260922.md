# Adapted Message Lifecycle

## Contract

[campaign-world.ts](../src/engine/campaign-world.ts) retains **16 recent messages** for an explicitly browser-adapted owner: either the adapter's browser AI owner or `world.browserCasualtyPickup.runtimeProfile === "browser-adapted"`.

Each ordinary `msg` appends its original command ID, text, message ID, presentation parameters, clock and initial value. Before append, only the newest 15 existing messages are retained. Ordering is chronological execution order, including the controller's reverse action order within each original TRO block. IDs are never renumbered; the final entry remains the latest presentation.

This is an explicit browser presentation adaptation, not a claim about native queue expiration, dismissal, selection or rollover. Strict-native/default worlds still reject message 17. Missing text and `parameter4 === 255` still reject in either profile, even on an empty queue. Rejection of any later command discards the staged evictions, messages and controller changes with the rest of the transaction.

## Focused Evidence

[campaign-world-messages.test.ts](../tools/qa/campaign-world-messages.test.ts) reads the original HUMAN05 SCN, MSG and complete TRO without modifying source files or actions. Controlled building observations, one explicit commander-loss input and trip events produce the source sequence `20,1,9,14,18,17,15`. Reinforcement and resource-rate effects use stand-in receipts; this is not public gameplay or transport/resource parity evidence.

The exact executed message IDs are:

```text
1,2,3,5,6,8,13,10,11,12,7,10,11,12,4,14,15,16
```

All 18 remain in the controlled harness's committed journal. The world retains the last 16, beginning with message 3 and ending with message 16 (`commandId: 5:15:0`, presentation code 2, parameters 3 and 4). Original command IDs, all message fields and receipt ordering are asserted. JSON journal-input replay from the original seed reconstructs the complete journal, controller and world exactly.

The final original `bail 0 1` is pending at clock 600, with deadline 10600. The strict handler rejects command `5:15:1`, message 17 overall, rolling back the whole victory block, including its staged bail and message 16. A separate full-window control fails a later reinforcement after an eviction; both the caller's window and controller remain unchanged, and retry commits once.

Four new tests cover the sequence/replay, strict overflow, late-command rollback and both explicit adapted ownership paths. Existing world tests retain strict overflow and transport rollback coverage. No actual HUMAN05 win, public playthrough, native parity or session checkpoint round-trip is claimed.

## Session Follow-Up Required

[campaign-session.ts](../src/engine/campaign-session.ts) is intentionally not edited:

- `messageStart = staged.world.messages.length` followed by `staged.world.messages.slice(messageStart)` assumes an append-only array. At 15 retained messages followed by three appends, it reports only the final message; at 16 followed by any append, it reports none. The session owner must collect every successfully committed message during command execution, in order, and publish only after the complete outer transaction commits. Do not derive full event history from the bounded final window; a transaction can itself emit more than 16 messages.
- Keep the complete commands, receipts and source-input replay history; do not truncate them with the presentation window. The focused test's journal is a controlled harness journal, not proof that session `entry.messages` already publishes rollover correctly.
- Direct checkpoint validation checks retained message text provenance and imposes no complete-history requirement on `world.messages`. Adapted restore replays all `aiSelectorInputs` and compares the entire state. Replaying those inputs should reconstruct the bounded window without a schema change. The session owner should verify an actual post-overflow checkpoint restore and continuation, full message journal publication, and rollback before considering that integration complete.
- `browserViewSnapshot` already takes `world.messages.slice(-1)`, so its latest-message projection is compatible with this window.

Only the world handler and this new test/documentation are owned by this change. No session, controller, source asset, view or strategy edits are included.
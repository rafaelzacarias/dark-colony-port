# Session Browser Economy Receipts

## Public Handoff

[campaign-session.ts](../src/engine/campaign-session.ts) exports these exact names:

- `BrowserCampaignEconomyProfile`: type alias of the helper's `BrowserEconomyProfile`.
- `BrowserEconomyIncomeReceipt`: type alias of the helper's `BrowserEconomyIncome`.
- `CampaignSessionOptions.browserEconomy?: BrowserCampaignEconomyProfile`.
- `CampaignSessionInput.economyIncome?: readonly BrowserEconomyIncomeReceipt[]`.
- `CampaignSessionState.browserEconomyLedger?: BrowserEconomyIncomeLedger`.

`BrowserEconomyIncomeLedger` is defined in the economy helper and contains
`{ profileId, sessionId, earned: Record<number, number> }`. Receipts contain
`{ scope: "browser-adapted-economy-v1", profileId, sessionId, team, earnedTotal }`.
Omitting receipts leaves the ledger unchanged; cumulative retries add zero.

Build the profile with `createBrowserCampaignEconomyProfile` from a fresh initialized
source world, all eight parsed SCN teams and original GAMESTAT units. Pass it in
`browserEconomy` alongside `runtimeProfile: "browser-adapted"` and the real existing
`browserAi: createBrowserAiSelectorConfiguration(source)`. The constructor recomputes
every profile field and its SHA-256 identity synchronously from the initialized world,
SCN and current units. No asynchronous session constructor or extra startup funds exist.
The admitted extraction policy is 20 ticks at 20 TPS, not native resource cadence;
the transport host's `fixedStepMilliseconds` remains a separate configuration.

Native resource lifecycle, initial native income, combat, AI tasks, native AI selector,
campaign AI and native construction ownership cannot share this economy. Source-backed
ordinary production remains admitted. Generic simulation resources are not an additional
income owner: initialize them from source money, and do not grant free resources or install
generic harvest nodes alongside this owner.

## Transaction And Save

Receipt arrays and records receive recursive plain-JSON/dense-array preflight before cloning.
Unknown fields, prototype pollution, wrong identities/teams, non-finite or fractional amounts,
regressed totals and total earnings exceeding the original combined VENT reserve reject.
All eight initial balances must equal SCN money; profile fields cannot add startup credits,
nodes, harvesters, dropoffs or a different timing policy.

The session consumes only the new delta into world money and `s(team,1)` before production
credit synchronization and commands. Controller feedback receives the same income statistic.
`applyUnitBatch` publishes its current casualty statistics to both the candidate world and
controller before handing the world to income or production. Previously it updated only the
controller: consuming even an empty or zero-delta income batch copied stale world statistics
back over new casualty counts while retaining their consumed loss IDs. Later feedback could
not recover those counts, and retrying the same victim correctly did not count it again.
The fix synchronizes at the casualty owner boundary, not by merging stale snapshots after
income. All team, type, census and array namespaces remain present; income changes only
`s(team,1)` by `earnedTotal - previousEarnedTotal`.
Production owns its existing ticket debit, FIN progress and host allocation. TRO money changes
are preserved independently: `exomoney` sets the balance, so a script assignment of 50 followed
by earned income of 25 leaves 75. Neither operation resets casualty or array statistics.
There is no reset to initial funds or cumulative earnings after a purchase.

All changes remain in the candidate state until the entire step succeeds. Later TRO errors
and failures after FIN host allocation discard money, income ledger, production, host and
history together. The outer owner must also discard its staged simulation/economy candidates.

Economy sessions emit `CampaignSessionCheckpoint.schemaVersion: 3`, with the initial profile
in `options.browserEconomy`, the current ledger in `state.browserEconomyLedger`, and every
step input (including receipts) in the existing `state.aiSelectorInputs`. Journal truncation
does not truncate replay history. `CampaignSession.restore(checkpoint)` rebuilds the fresh
source profile, replays every step, and compares the complete resulting state. Missing ledgers,
schema downgrade, altered histories, balances or profile fields reject. Spent income is not
recredited. `session.fork()` retains the current ledger.

## Trust Boundary

This is an **external trusted adapted owner**, not adversarial funds authentication. MissionView
must supply receipts only from the staged `BrowserCampaignEconomy` after staged simulation
observation; UI actions may issue orders, never choose receipt amounts. The session does not
observe node depletion and cannot distinguish fabricated earnings within the finite reserve
from genuine extraction. Profile hashes and full replay establish consistency with supplied
source data, not cryptographic authenticity of arbitrary save edits. The view separately owns
and validates paired simulation/economy checkpoints, dynamic harvester bindings and depletion.
No native timing, RNG or native-resource ownership is claimed.

## Focused Verification

[Fifteen session tests](../tools/qa/campaign-session-browser-economy.test.ts) cover ownership,
source configuration, cumulative retries, eight-team identity, finite reserve bounds, malformed
inputs, schema mutations, fork/restore, TRO income feedback and rollback. Original HUMAN02 and
ALIEN02 use raw SCN/GAMESTAT and unchanged TRO: source carrier types 6/14, zero player credits,
pure extraction to at least 350, one real 350-credit ticket, and actual FIN host spawn types 0/8.
New income remains unconsumed during a failing post-spawn candidate and succeeds exactly once
on retry. Save/restore before completion and after spending preserves full state.

Six casualty regressions additionally cover same-frame income/death, dynamic death with
zero income delta, duplicate loss IDs, empty receipts, later incremental income, static death
across paid production and TRO `ai`/`exomoney`/`setarray`, and late rollback of counters,
loss IDs and earned ledger together. Complete statistics maps and JSON checkpoint/replay
continuations are compared, not just the casualty key. Controlled original-script cases
confirm that six ALIEN02 type-86 deaths arm trigger 4 victory, and HUMAN02 commander type-69
death arms trigger 18 recovery and trigger 19's life, not a fabricated mission loss.
These controlled casualty inputs are not evidence of legal combat victories.

P1 verification logs: `/tmp/dc-p1-final-economy-r1.log` (15 passed),
`/tmp/dc-p1-final-neighbors-r1.log` (8 nearby session tests passed),
`/tmp/dc-p1-final-contracts-r1.log` (42 controller/world/M02 contract tests passed), and
`/tmp/dc-p1-final-types-r1.log` (strict focused TypeScript compilation, exit 0).
The initial regression was red with a consumed ALIEN02 site loss but `1,3` equal to 0
instead of 1: `/tmp/dc-p1-casualty-red-1790108073527.log`. The one-line owner fix made
that same test green: `/tmp/dc-p1-casualty-green-1790108103098.log`.

These are focused engine tests, not a browser playthrough or complete campaign test. Their
simulation projects source harvesters and VENT blockers, not the full battle occupancy.
No full suite, browser, package changes or asset regeneration is part of this session change.

```sh
node --import tsx --test tools/qa/campaign-session-browser-economy.test.ts
```
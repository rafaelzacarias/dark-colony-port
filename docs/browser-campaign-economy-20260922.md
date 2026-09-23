# Browser-Adapted Campaign Economy

## Ownership

The extraction owner is implemented in [browser-campaign-economy.ts](../src/engine/browser-campaign-economy.ts),
[browser-campaign-economy-source.ts](../src/engine/browser-campaign-economy-source.ts), and
[the focused tests](../tools/qa/browser-campaign-economy.test.ts).
Session receipt integration is implemented in [campaign-session.ts](../src/engine/campaign-session.ts);
see [the session contract](campaign-session-browser-economy-20260922.md).
No MissionView, game-data, native owner, package, or asset edits belong to the session change.
The view integration remains the responsibility of its owner. This is not a claim
that the browser UI is already connected or that native whole-mission timing is reproduced.

## Source And Policy

- Explicit scope: `browser-adapted-economy-v1`. Never install alongside native resource ownership.
- HUMAN02 and ALIEN02 are the original first playable economy missions. Their player money is zero.
  Neither has a placed team-0 harvester. Original TRO carrier deliveries create type 6 near
  `(64,49)` and type 14 near `(6,76)`, respectively. Do not manufacture startup harvesters.
- `createBrowserCampaignEconomyProfile({ scope, world, teams, units })` consumes the fresh,
  fully decoded source world, all eight source teams, and the loaded GAMESTAT records.
  It returns a SHA-256 configuration identity, source `nodes`, initial `harvesters`, actual
  `dropoffs`, initial credits, and an explicit timing policy. Recompute it from source on restore.
- VENT type 40 uses its original placement reserve and rate with Q8 scales of 256.
  `initializeLegacyResource` handles the source negative-reserve GAMESTAT fallback.
  Amount is not multiplied by 256 again, taken from maxHealth, or replaced with free resources.
  HUMAN amounts/rates: `3500/0, 3500/0, 12000/22, 7000/15`.
  ALIEN: `9500/25, 3500/12, 5000/0`.
- GAMESTAT has no generic cargo capacity or extraction-rate default for these harvesters.
  Their speed 40 Q8 becomes 160 simulation subcells per tick; HP, team, slot, generation,
  and raw Q8 position are preserved. No generic weapon or harvester cargo owner is installed.
- The browser policy defaults to one extraction period every **20 ticks at 20 TPS**.
  One period earns `min(current VENT rate, remaining reserve)`, directly for the owning team.
  Dormant rate zero cannot earn. Scripted `newrate` changes are supported explicitly.
  Native 44/66-credit observations are caller/rate context, not universal faction defaults:
  they are not a claim that a browser tick equals a native extraction call.
- Direct credit is an explicit adaptation. There is no invented cargo/dropoff trip or base.
  `dropoffs` reports existing live source base coordinates only; it does not create buildings.
  Exhaustion consumes the final partial period exactly, unlike claiming the native depletion branch.

## Integration Contract

1. At fresh startup build the profile, then use `initializeBrowserEconomyWorld(profile, world)`
   to copy the eight SCN money values. Existing conflicting balances reject. This is startup
   initialization only, never a restore-time or per-frame funds reset. Initialize generic
   simulation resources from SCN money too; never call `grantResources` for this economy.
2. Construct `new BrowserCampaignEconomy(profile, simulation, bindings)`.
   A binding is `{ key, simulationId }`; the profile/state retains source slot/generation/team.
   Initial profiles may correctly contain no harvesters. After a normal source delivery,
   `sourceBrowserEconomyHarvesters(currentWorld, units)` returns source-derived unit options.
   Project the actor through the normal entity pipeline, then call
   `owner.bindHarvester(simulation, actor, actualSimulationId)`. Do not create a second unit.
3. Keep VENT tiles blocked in the simulation using the existing static target footprint.
   `profile.nodes` structurally contains `AddResourceNodeOptions` (`cell`, `amount`) but this
   owner does **not** add generic nodes or use generic `harvest`: that implementation requires
   standing on the resource cell and credits faction balances. Do not install two resource owners.
4. Right-click an actual VENT: `owner.harvest(simulation, selectedIds, nodeKey, localTeam)`.
   It filters mixed/duplicate/non-owned/dead selections, chooses a reachable cardinal adjacent
   tile using existing deterministic A*, and queues normal `move` commands. Static footprints,
   current units, VENTs and other harvest destinations participate in endpoint selection.
   Unreachable/dormant/depleted orders return no accepted IDs. Reissue computes from current pose.
5. After **each** `simulation.advance()`, call `owner.observe(simulation)` once. Arrival must
   be exact cell center and idle before a full period begins. Moving, dead, absent, native-owned,
   or displaced actors cannot extract. Repeated observations of the same tick do not earn twice;
   skipping ticks rejects. UI extraction activity comes from `owner.checkpoint().orders`, since
   the simulation actor remains idle while this external owner extracts.
6. Stop uses `owner.stop(simulation, selectedIds)`. For other Move/Attack orders, first call
   `owner.cancelOrders(selectedIds)`, then queue the normal command. Partial progress is discarded;
   no teleport, actor replacement, cargo credit, or residual extraction follows cancellation.
7. Following committed source-script changes call `owner.synchronizeSourceRates(world)`.
   It validates existing VENT identities and copies current rates, never reserve/credits.
   Changed rates reset partial progress; zero rate cancels the economy order. No regeneration.
8. Configure `CampaignSessionOptions.browserEconomy` with the fresh source profile and pass
   the resulting cumulative `owner.income` as `CampaignSessionInput.economyIncome`.
   Each receipt is `{ scope, profileId, sessionId, team, earnedTotal }`.
   The session validates the complete fresh source profile and uses
   `consumeBrowserEconomyIncome(stagedWorld, savedLedger, receipts)` inside its existing transaction.
   The helper returns `{ world, ledger, earnedDelta }`, adding only the previously unconsumed delta
   to team `exomoney` and income statistic `s(team,1)`. Retries add zero; regressions, wrong identities,
   invalid amounts and money overflow reject without mutating inputs.
9. Apply income before existing production credit synchronization/commands. Production remains
   the sole owner of reservation debit, dispatch, refunds, FIN completion and actual spawn.
   Publish its resulting credits back to world money as usual. Do not debit again for an
   economy receipt, compare income to the current spendable balance, or reset money to earnedTotal.

Profile hashes and cumulative receipts are consistency checks, not adversarial authentication.
Only accept receipts generated by the staged engine owner, not arbitrary UI-provided amounts.
The session bounds cumulative earnings across all teams by the original total node reserve;
it does not observe depletion or authenticate extraction amounts within that bound.
The model intentionally avoids simulated native resource tasks, native task receipts or native RNG claims.

## Checkpoints And Transactions

Persist `owner.checkpoint()` beside the same-tick simulation checkpoint and the session's income ledger.
The session persists its optional `browserEconomyLedger` in schema 3 and replays every input,
including receipts, from its original `options.browserEconomy` and source world on restore.
The economy checkpoint owns source bindings/census, rates, remaining reserves, each actor's destination,
moving/extracting phase, partial period, tick and cumulative per-team income.
Restore with the original profile and saved bindings:

```ts
const simulation = DeterministicSimulation.restore(saved.simulation);
const economy = new BrowserCampaignEconomy(
  profile, simulation, saved.economy.bindings, saved.economy,
);
```

The constructor checks matching identity/tick, source actor bindings, order shape and conservation:
total earned equals total depletion. It does not replay the full campaign or authenticate arbitrary
checkpoint edits. The outer owner must also reconcile saved dynamic actors with its session world.
Never recreate an empty income ledger on restore: it would replay already spent earnings.

After all harvesters are observed, retained orders are filtered against the **final** node reserves
before publishing the checkpoint. A later extractor can exhaust a node after an earlier actor's
order was retained. All orders for that node must then disappear, including incomplete extraction
and still-moving orders. Extraction remains a single ordered pass using `min(rate, remaining)`;
cleanup adds no credit, debit, or reserve remainder. Invalid depleted-node checkpoint orders still
reject on restore; the validator is not relaxed.

For each candidate frame, stage the simulation and economy from their paired checkpoints, stage the
session and its ledger, then advance/observe/consume. Commit all three only after production and
trigger processing succeed. Discard the candidates together on failure. Extraction reserves are
owned here; original resource health/raw bytes remain source/host state, not a second depletion ledger.
The view must render current reserve from the economy checkpoint rather than stale source HP.

## Focused Verification

Six Node tests use original SCN, MAP/MTG/PTH, GAMESTAT, unmodified TRO and generated source production
assets. Both missions run real source carrier delivery with the explicit adapted session profile.
They verify unchanged harvester pose/HP/speed, source reserves, blocked VENT adjacency, zero initial
money, earned income, normal 350-credit reservation and an actual type 0/8 host allocation through
the existing source FIN producer, with no second debit or duplicate receipt credit.

Additional checks cover Stop during travel/extraction, deterministic reissue, JSON checkpoint restore
mid-period, mixed selection, wrong team, dormant/unreachable VENT, original `newrate`, exact exhaustion,
conservation/identity/tick guards and atomic rejection of regressed income.
Four additional synthetic unit controls use `createCampaignWorld` and
`createBrowserCampaignEconomyProfile` with a declared reserve-5/rate-3 VENT, distinct source actors
and bindings, and explicitly configured extraction periods of 1 or 3 ticks. The profile identity
is computed by the helper from that synthetic source and configuration, never edited afterward.
These are not original-mission or native-timing claims. They cover same-frame extraction of 3+2,
unequal progress, nonarriving movers before and after the depleting actor, conserved total earnings
of exactly 5, JSON restore and two successive checkpoint forks, duplicate-tick observations,
idempotent receipt consumption, Stop/depleted reissue returning no accepted IDs, and immutable
rejection of invalid checkpoints, unsynchronized orders, skipped observations and regressed receipts.
The simulation fixture projects harvesters and VENT blockers; the session retains the complete source
world. Full battle occupancy, interactive UI, combat death animation and whole-mission wins are not
claimed by these economy tests. No browser, native oracle reruns or full suite was invoked.

```sh
node --import tsx --test tools/qa/browser-campaign-economy.test.ts
```
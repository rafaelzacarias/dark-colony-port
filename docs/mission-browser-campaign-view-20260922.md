# Browser-Adapted MissionView Candidate

Scope: HUMAN02 and ALIEN02 candidates, not a complete campaign or native AI/economy parity.
Owned files are [MissionView](../src/mission-view.ts),
[source preparation helper](../src/engine/source-browser-campaign-options.ts), and
[focused tests](../tools/qa/mission-browser-campaign.test.ts). Session, game-data, main,
packages and assets were not edited by this slice.

## Loader Contract

Both factories are asynchronous. Prepare once before constructing or restoring the view:

```ts
const prepared = await prepareSourceBrowserCampaignMission(mission, dependencies);
const adaptedMission = { ...mission, ...prepared };
const view = new MissionView(canvas, stage, callbacks, adaptedMission);
```

`prepareSourceBrowserCampaignMission(mission, dependencies)` returns exactly:

- `runtimeProfile: 'browser-adapted'`
- `browserAi: BrowserCampaignAiConfiguration`, factory-owned and not deserializable
- `browserEconomy: BrowserEconomyProfile`, derived from a fresh initialized source world

The exported `SourceBrowserCampaignMission extends CampaignMissionData` declares those
three optional fields. Loader/main must attach all three together for adapted missions.
Keep mission 01 strict unless explicitly opting in. The constructor does not infer an
adapted profile from the mission number, rewrite TRO, manufacture harvesters, or fetch data.

The mission must retain the complete parsed SCN team records, including `aiSlots`, original
base64 `rawScenario`, map/PTH/tags, units, weapons, source production and source resources.
Dependencies are the original parsed dependency table. The helper parses the original SCN
for factory input and retains the mission envelope metadata. Session options come from
`sourceBrowserCampaignSessionOptions(mission)`: source is the exact mission scenario minus
`rawScenario`, and the selector configuration fingerprints that same full object.
Session ID remains `${mission.scenario.id}:browser`.

`sourceResource` stays on the mission for source identity and assets. Its native lifecycle
is deliberately not installed into the adapted session. Native harvest, native combat and
construction ownership cannot be combined with this profile. Startup resources use the
source Q8 scales; the economy profile is passed as `CampaignSessionOptions.browserEconomy`.
Session validates it against fresh source and initializes its cumulative income ledger.

## Frame And Input Flow

Each fixed browser frame forks the current session, simulation, movement state and paired
economy checkpoint. No `CampaignSession.restore()` or history replay occurs per frame.

1. Publish preceding simulation positions/deaths/reservations and cumulative
   `economyIncome` to the session. Existing production receives its normal visits and at
   most one pending purchase. Session consumes only new income before its production work.
2. Apply the complete committed TRO/transport frame, including delivered actors, then
   synchronize source VENT rates. Dynamically delivered 6/14 actors use source HP, position,
   speed and identity through the normal unit registration path, with no generic cargo owner.
3. Plan browser AI once using current session selectors, current simulation HP/poses,
   all current source actors and raw-slot/generation/simulation-ID bindings. Queue each
   returned command once. Clear older movement routes for actors receiving AI commands.
4. Generic guards exclude selector-3 teams. Selector-4 teams retain ordinary reactive
   defense; they do not receive active strategy decisions. Neutral VENTs are obstacles,
   not generic combat targets. AI never changes player selection.
5. Advance simulation once, then observe economy once. Commit all staged owners together.
   The resulting income reaches the session on the following fixed frame. A late failure
   retains the previous simulation, AI, economy, session and pending player purchase/order.

VENT clicks call `harvestSelected(sourceSlot)`, restricted to visible source resources and
the selected live team-0 harvesters. The owner chooses reachable cardinal adjacency.
Stop calls the economy owner once; Move/Attack cancel extraction before their normal
commands. Source rates, remaining reserves and orders are exposed by
`view.browserEconomyState`; `resourceSources` additionally exposes `remaining` and `rate`.
`resourceWorkflow.credits` is spendable session money, not cumulative income or generic
simulation resources. `browserAiState` exposes a detached strategy checkpoint for inspection.

Adapted combat uses the existing generic GAMESTAT damage-matrix/armor implementation,
without claiming certified native target coverage for every placed type. Native admission
and default strict views are unchanged. VENT remains a source-bound static target footprint
and renders through the existing FIN Stand path at browser cadence, not native task timing.
Source reserve is owned by economy, not depleted through source combat HP. Depleted nodes
cannot extract and expose zero remaining reserve without deleting the source world actor.

## Save Schema

`MissionViewCheckpoint` retains version 1/2 and adds optional top-level `browserAi` and
`economy`. Strict views reject either field; adapted views require both. All nested fields
have strict JSON shape checks before semantic validation by the strategy/economy owners.

- `browserAi`: version, runtimeProfile, sourceCanonical, sourceCycle and strategy state
  (fingerprint, lastTick, nextDecisionTick, team RNG/decisions and actor command state).
- `economy`: scope, profileId, sessionId, tick, bindings, source harvester census,
  remaining reserves, current rates, cumulative earned totals and extraction orders.
- Session checkpoint retains `browserEconomyLedger`; simulation retains its normal queued
  commands. At committed tick N, economy tick/sourceCycle are N and strategy lastTick is N-1.

Restore requires fresh source configurations, exact mission identity/options, source-bound
dynamic actors, source rates, income conservation and ledger consistency. It restores the
paired simulation/economy state, including partial extraction; it does not reset balances
from SCN or repay spent earnings. Fingerprints provide consistency, not adversarial save
authentication. Save loading uses the session's existing full replay validation.

## Evidence And Limits

- Original HUMAN02 and ALIEN02: startup, unchanged selectors/zero money, all source VENT
  footprints, real TRO harvester delivery, source speed 160, at least 500 natural view ticks.
- Both factions: Stop/Move cancellation, mid-period fresh-factory JSON restore with identical
  continuation, earned 350-credit purchase, real source FIN type-0/type-8 allocation,
  no second debit/duplicate income, pending-purchase rollback and restore after spending.
- ALIEN02: complete original TRO reaches `ai 1 3` at tick 1136; strategy decisions/orders
  follow without resetting selection, and a post-threshold save continues identically.
- Rejection of unknown top-level/nested fields, wrong strategy fingerprint, missing owners
  and economy conservation errors; controlled post-observation rollback with queued Stop.
- Five strict neighbors passed: HUMAN01/ALIEN01 mid-carrier restore, malformed checkpoint
  rejection, ALIEN01 static occupancy and unchanged strict resource admission.

Natural HUMAN02 AI threshold at 14096 was already verified by the session-owner tests
described in [runtime evidence](browser-campaign-runtime-20260922.md); it was not rerun
through this view. No browser, full suite, package install or asset generation was run.
Rendering, missing future-mission asset aliases, browser frame pacing, all later missions,
full wins and native combat/economy timing remain unverified. Main/loader activation and
HUD presentation remain with their respective owners. Do not label this a full-game result.

A read-only archive existence check found no missing foreseeable HUMAN02 FIN archive,
but ALIEN02 contains source sprite `T`, whose current mapping requests
`/assets/generated/animations/T.json`; that file is absent. This is a concrete ALIEN02
presentation blocker for the loader/asset owner to resolve from source evidence. No alias
was invented here. Archive existence alone does not verify composition, atlas coverage,
palette correctness or rendering.

Focused command: `node --import tsx --test tools/qa/mission-browser-campaign.test.ts`.
Long source tests include intentional full session replay on save restore. The observed
ALIEN02 threshold/restore test took about 236 seconds under concurrent local work; no
20-ms browser-frame performance claim is made.
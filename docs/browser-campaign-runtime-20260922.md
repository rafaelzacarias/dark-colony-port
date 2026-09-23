# Browser-Adapted Campaign Selector Transactions

This is an explicit browser adaptation, not the original native AI scheduler.
Omitting `runtimeProfile` retains the strict-native behavior and its existing
`ai: native policy scheduling owner required` failures. No native policy,
registered-task, production, resource, or shared-RNG guard is removed.

## Session API

The implementation is in [browser-campaign-runtime.ts](../src/engine/browser-campaign-runtime.ts),
[campaign-session.ts](../src/engine/campaign-session.ts),
[campaign-world.ts](../src/engine/campaign-world.ts), and
[mission-controller.ts](../src/engine/mission-controller.ts).

```ts
const session = new CampaignSession({
  ...originalSourceOptions,
  runtimeProfile: "browser-adapted",
  browserAi: createBrowserAiSelectorConfiguration(originalSourceOptions.source),
});
```

The plain configuration is scoped `source-browser-selector`, carries a canonical
fingerprint of the complete parsed SCN, and declares the external
`browser-ai-strategy-v1` processor at `view-before-generic-engine`, owned by
`mission-view`. It is not an `AiSelectorConfiguration` or an `isReady` callback.
Native and browser selector capabilities cannot be combined. Adapted sessions
also reject `campaignAi`, `nativeAiTasks`, and `nativeCombat` ownership.

All eight SCN modes initialize unchanged, including HUMAN02 teams 3 and 4 already
in mode 3. Literal TRO setters use `writeOriginalAiSelector`, preserve source
records, and append ordered events with profile `browser-adapted-v1`. The existing
transaction stages setters and transports before feedback, preserving reverse
action execution, `setlifes`, and rollback on later failures. Audit with
`auditMissionTriggerSupport(blocks, { browserAi: true })`; do not reuse native
`aiSelector: true` to describe this capability.

Adapted startup seeds the zeroed 8-by-12 team-statistics table and original SCN
money, preserving configured resource and production values. This supplies the
initial `s(0,10)` value without modifying HUMAN02 or its counter. It does not add
income timers or claim ongoing ownership of every statistic. Existing optional
player-production and resource owners still require their normal explicit frame
inputs. The selector profile does not automatically install either owner.

`session.browserAiProjection` exposes deeply frozen, detached configuration,
current selectors and events, source cycle, money, and statistics. Strict sessions
return `undefined`. Session snapshots remain detached in the existing API.

## View Integration

Use the existing pure strategy from [browser-campaign-ai.ts](../src/engine/browser-campaign-ai.ts).
The strategy factory must receive the full scenario, units, weapons,
dependencies, and navigation grid. The session does not run its effects.

1. Create the strategy with `createBrowserCampaignAiConfiguration` and initialize
   view state with `initializeBrowserCampaignView(session.browserAiProjection!, strategy)`.
2. Stage all source session frames for the current view frame first.
3. Call `planBrowserCampaignViewFrame(projection, strategy, previousState, observation)`
   once, supplying the complete simulation snapshot and current world actors and
   bindings. The wrapper supplies current session selectors, overriding any
   startup-mode assumption. Modes 0..4 retain the pure strategy's own semantics.
4. Apply returned commands to the staged simulation before generic engine
   advancement. Commit the returned state only with the outer session/view/engine
   transaction. A failed outer transaction retains the old state for retry.
5. Save the returned `BrowserCampaignViewState` as an optional top-level
   `browserAi` field in the MissionView checkpoint, alongside session and simulation.
   Restore it with `restoreBrowserCampaignView(projection, freshStrategy, saved)`.

The wrapper matches source teams and canonical SCN, delegates deterministic
RNG/cadence/actor-state validation to the strategy, and rejects a second plan at
the same simulation tick. The existing strategy's cadence is browser-adapted,
not an original native scheduler. Strategy state belongs to the view and is not
evidence of native world-state parity. The main/view save schema and activation
remain an integration task; no MissionView, game-data, or main file was edited.

## Checkpoints

Session snapshot schemas 2 and 3 accept strict optional `runtimeProfile` and
`browserAi` objects. Unknown profiles, fields, processor declarations, incomplete
SCNs, and source mismatches reject. Browser session restore needs no external
native provider: `CampaignSession.restore(JSON.parse(JSON.stringify(checkpoint)))`.
Every committed caller input is retained independently of journal eviction and
replayed; the entire reconstructed state must match, including selector events,
statistics, money, controller, entities, and transport state. Schema 1 does not
admit browser selector checkpoints. Unjournaled resource mutation remains closed.

The canonical SCN fingerprint checks source consistency, not cryptographic
authentication of an independently rewritten save. Strategy factory fingerprints
separately bind its complete source inputs. Main must retain its normal mission
identity checks and validate the optional view-state field when integrating.

## Focused Verification

[browser-campaign-runtime.test.ts](../tools/qa/browser-campaign-runtime.test.ts)
contains six short controls and two original-source threshold tests:

- All 40 team/mode combinations, incomplete source and native-capability rejection.
- Original startup modes, immutable projections, schema/source/history/raw-state
  tamper rejection, JSON restore and fork continuation.
- Reversed setters and `setlifes`, with earlier selector/transport work rolled
  back after a later missing-message failure.
- Actual pure strategy state, startup mode-3 teams, changed selectors, duplicate
  frame rejection, and fresh-factory JSON state restore.
- Configured original player production coexists with selector transactions and replay.
- Complete original HUMAN02 SCN/TRO: `ai 2 3` first at tick 14096 (`c>880`), followed
  by the original reinforce command. Complete original ALIEN02 SCN/TRO: abduct,
  reinforce, then `ai 1 3` at tick 1136 (`c>70`). Every preceding tick executes;
  no forced counters, rewritten source actions, or scripted AI effects are used.
  Both tests replay the full session and compare subsequent continuation.

These are selector/transport transactions, not full-game playthroughs or native
AI parity. No browser, full suite, package, or asset generation was run.
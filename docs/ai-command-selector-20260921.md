# Original AI Selector Transaction

2026-09-21. Implements the source setter transaction, **not mission admission or
AI scheduling**. No loader, main, browser strategy, rendering, assets, packages,
or existing native-owner exclusion was changed. No production scheduling owner
is installed by this change.

## Native Contract

The original `0x43d840` handler sign-extends action words `+4` (team) and `+6`
(selector), then writes exactly one dword:

```text
i32(game + 0xbbc + team * 0xe30) = selector
```

It does not call policy, reset policy state, allocate tasks, emit orders, or
consume RNG. The native handler does not validate either operand. Original
decimal parsing truncates to words; expressions are not evaluated. The host
accepts only integer literals: team `0..7`, selector `0..4`. It rejects expressions,
overflow/narrowing, negative selectors, and selectors above 4 with source-indexed
`unsupported-action` diagnostics. `writeOriginalAiSelector` separately represents
the signed-word store for native evidence; it does not grant runtime admission.

Selector 0 disables scheduling at the caller; 1..4 index the four implementation
descriptors used by `0x41ab20`. Mode 3 has weight callback `0x44bc5c` (returns 1)
and action `0x44be40`; mode 4 has zero-weight callback `0x44d6e0`. This setter does
not execute any of them or label modes as aggression/difficulty strategies.
SCN literal initialization is admitted only with explicitly selected global mode
0 or 3. Installed menu settings are not inferred.

The parsed SCN definition, including enabled/race/money/AI/colour, dependencies,
alliances, AISlots, coordinates, city rows, header, and placements, remains intact.
With an owner configured, `world.aiSelectors` additionally retains all eight
`initialModes`, current `modes`, and ordered setter `events`. Without an owner,
SCN AI fields remain in `world.source`; no mutable runtime selector is installed.

| Source | Initial selector dwords | First activation |
| --- | --- | --- |
| HUMAN02 | `0 0 4 3 3 0 0 0` | block 17, action 1: `ai 2 3`; `c>880` and `s(0,10)==0`; reverse execution: AI, reinforce |
| ALIEN02 | `0 4 4 0 0 0 0 0` | block 0, action 0: `ai 1 3`; `c>70`; reverse execution: abduct, reinforce, AI |

## Integration API

[ai-command-selector.ts](../src/engine/ai-command-selector.ts) exports:

- `AiSelectorConfiguration`: `scope: "source-native-policy-scheduler"`,
  `sourceId`, full `sourceCanonical`, `profileId`, explicit `globalMode: 0 | 3`,
  and per-team supported `modes`. Use `aiSelectorSourceCanonical(originalScn)`
  to serialize the complete parsed definition deterministically.
- `AiSelectorSchedulingOwner`: configuration plus
  `isReady({world, planned, selectors}): boolean`. This is an external native
  scheduling owner's **pure readiness check**, not the policy callback itself.
  It must check current ownership of subsequent native scheduling/weight/policy,
  packet receipt, task/production, and shared RNG phases for the requested
  team/selector. Returning true merely because a reducer exists is not valid.
- `initializeAiSelectors(source)` and `prepareAiSelector(world, planned, owner)`:
  initialize the eight SCN dwords and prepare only the selector write/event.

The actual caller must consult the committed `world.aiSelectors.modes[team]`
at its original scheduler boundary. This module does not choose a tick, fake an
AI call at TRO execution, or establish actor/world-service/visibility phase order.
Readiness receives detached candidate data, must be deterministic for replay,
and must have no external writes. The candidate is not published until the
enclosing transaction succeeds. Tests use explicitly labeled readiness doubles;
these are not real runtime owners.

`CampaignSessionOptions` takes both `aiSelector` and `aiSelectorOwner`; neither
alone is accepted. `campaignAi` cannot substitute for this owner or be composed
with it here: its bounded/full-policy receipt API does not prove this scheduler.
All preexisting native-task/full-policy/combat exclusions remain in effect.

For lower-level callers, `createCampaignWorldAdapter(transport, owner)` and
`stepCampaignWorld(..., deaths, transport, owner)` expose the same gate. A world
must carry `initializeAiSelectors(source)` before an owned setter. The ordered
session transaction provides real same-block feedback; the existing planning
helper still suspends where later expressions need world feedback.

Default `auditMissionTriggerSupport`, planning, execution, and commit remain
closed to AI. Explicit `{aiSelector: true}` enables syntax auditing/planning only;
it is not certification. Controller execution also requires the adapter capability,
and the owning world adapter independently checks the live owner, source pin,
coverage, and readiness. Main must install a real owner before opting into
auditing; the loader remains unchanged and both missions remain blocked.

## Atomicity And Restore

Each activation event records command ID, original trigger/action indexes and
action (including raw source text), team, before/after dwords, profile ID, and
global mode. Reverse-order writes in one block see prior candidate writes.
A later failed message, transport, VM, feedback, or projection rolls back the
whole session frame: selectors, events, lives, statistics, transport, and history.
Readiness is not a postcommit notification and must never publish effects.

Snapshot schema 2/3 adds optional selector configuration, state, and complete
ordered `aiSelectorInputs`; bounded diagnostic journal eviction does not truncate
this history. The callback is never serialized. Restore requires a fresh external
owner as the sixth argument:

```ts
CampaignSession.restore(checkpoint, expectedCampaignAi, expectedNativeAiTasks,
  expectedConstruction, expectedNativeCombat, expectedAiSelectorOwner);
```

The descriptor must match exactly. Restore initializes from the pinned complete
source, replays every normal/visibility input through the live owner and existing
native guards, and compares the entire state, including exact setter events.
Missing history, unowned state, altered source definitions, or divergent state
reject. Direct resource mutations are blocked in this replay lane. Replay is not
a signature over checkpoint input bytes: a valid, state-equivalent change to an
otherwise unused historical input cannot be distinguished without an external
history digest. Existing native providers are still independently required.

## Focused Evidence

[ai-command-selector-native.py](../tools/qa/ai-command-selector-native.py) reuses
the hash-pinned original image and existing policy probe. It executes 72 direct
handler cases across all eight teams with selectors
`-32768,-1,0,1,2,3,4,5,32767`, compares complete game bytes and all selector dwords,
and verifies unchanged statistics/RNG. Original parser controls prove truncation
and non-expression behavior. Sixteen original SCN scalar stores establish both
initial vectors; the existing selector probe confirms the real mode-4/mode-3
weight/action boundary. This is not another complete fresh-SCN execution; that
separate proof is documented in [ai-policy-runtime-20260919.md](ai-policy-runtime-20260919.md).

```sh
node --import tsx --test tools/qa/ai-command-selector.test.ts \
  tools/qa/ai-command-selector-session.test.ts tools/qa/mission-controller.test.ts
```

The native test regenerates its oracle using
`PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918`.
`DC_AI_SELECTOR_TRACE` can supply an already generated JSON capture. No browser,
full suite, full mission playthrough, or scheduler execution is claimed.
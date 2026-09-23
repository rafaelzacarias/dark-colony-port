# Adapted Automatic Commander Casualty Pickup

## Scope

Implemented in [browser-casualty-pickup.ts](../src/engine/browser-casualty-pickup.ts),
with relevant transport-host and CampaignWorld paths only. This is an explicit
browser-adapted, single-player owner, not an extension of authenticated native
combat. Default worlds have no owner and retain their previous death behavior.
The session integration below now activates and checkpoints this owner.
MissionView, main, assets, packages and the reserved session performance paths
were not edited by this integration.

## Source Evidence

[The bounded probe](../tools/qa/browser-casualty-pickup-native.py) uses original
DC.EXE SHA256 `65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
The existing native GAMESTAT parser fixture runs the original destination setup
and conversions, with ASCII sscanf marshalled at its existing boundary.
Across all 106 source rows, exactly types 69..76 have nonzero type definition
`+0x100` (address `0x4f1980 + type*280`): values 6,8,10,12 for each faction.
Types 69..72 are human TRSC commanders; 73..76 are alien GRAY commanders.
`sourceUnitIsCommander` encodes that verified source-index mapping, not sprite,
current HP, resource metadata, team number, or presence of a commander link.

Original `0x416308` sets actor status 10. At `0x4163d8` it checks that type
field, then game mode byte zero. `0x4163f3..0x416431` tests persistent team
`+0xbb4`: a nonzero value bypasses the automatic carrier call `0x418f4c`.
The branch uses the victim's actual team and tile and encodes its full slot.
There is no base-coordinate/base-alive/commander-link check in this branch.
At the observed carrier entry, HP remains zero. No HP reset was observed.

The probe exercises all eight teams and all eight commander types (64 calls),
eight nopickup controls, an ordinary type, and a nonzero game-mode control:
74 assertions/cases. It stops at carrier entry or the bypass target. It does
not run the original carrier task, full combat scheduler, animation cleanup,
or a recovery constructor. Automatic payload bytes for slot 300 are `00 01 2c`;
this differs from explicit abduct's payload. Adapted collection below is not
claimed to be byte-exact native task execution.

AL08 original block 25 is `norm 1 (1)` / `nopickup 6`. Block 9 still observes
the team-6 commander's class-0 type loss; suppression must not erase that loss.
Explicit `abduct` remains independent of this flag.

## Adapted Contract

- Opt in with `initializeBrowserCasualtyPickup(world, { runtimeProfile: "browser-adapted" })`.
- The returned world has `browserCasualtyPickup: { runtimeProfile: "browser-adapted" }`.
- Submit the existing `updateTransportHostUnit(world, { type: "combat-death", slot, generation })`
  against the still-registered actor. Its one transaction emits the existing
  `combat-death` request/loss and, for eligible commanders, schedules one real
  reserved carrier using the existing transport reducer's movement path.
- The owner consumes `world.adaptedTro.noPickup[team]`, default zero. A flagged
  commander emits its loss but allocates no carrier and consumes no direction.
  Ordinary troops never auto-dispatch. Scripted abduct retains its old guards.
- Scheduled casualties remain status 10, zero HP, registered, collision-free,
  and present in world entities until the carrier reaches them. Early external
  `complete-removal` rejects. The reducer receives a private eligible-target
  projection; the real actor is never made active or healed.
- At arrival, the owner unregisters/removes that generation and emits
  `casualty-picked-up { slot, generation, carrierId }` plus `unregister`.
  The carrier then ascends/releases normally. This arrival-time collection is
  the declared adaptation, not the original task-10/FIN cleanup cadence.
- `transportState.browserCasualties` stores `slot`, `generation`, `lossId`,
  `carrierId`, `disposition: scheduled|suppressed`, and `collected`. Repeating
  the same commander death is idempotent, including after collection; a stale
  generation rejects. A later nopickup change does not cancel an existing trip.
- Full pool/missing directions/source-definition failures roll back the entire
  transaction, including the death request. The caller must roll back/retry its
  outer frame, not discard the error and silently lose the casualty.
- No money, statistics, new commander, health reset, base teleport, victory,
  or loss suppression is performed. No unconditional respawn timer is added.

## Original Mission Outcomes

HUMAN02 block 18 observes first type-69..72 losses, messages, sets array 0 to
`c+45`, and enables block 19. Block 19 later reinforces type 69 at (64,49).
Block 20 handles second losses with a message. ALIEN02 blocks 11/12 similarly
observe types 73..76 and reinforce type 73 at (6,76). The replacements are
script-owned, not spawned by the casualty owner. TRO `c` is raw cycle counter
shifted right four bits. No fixed 5-HP revival is inferred from briefing text.

Both M01 commander-loss conditions still receive the original class-0 loss
before collection and set LOSS. Tests run those unchanged source blocks through
the existing mission controller. Waiting for pickup is not a reason to suppress
an original bail. AL08's commander-loss branches are likewise not rewritten.

## Session and View Handoff

1. Session owner: opt in only for the browser-adapted profile, before submitting
   death updates. Persist/validate `world.browserCasualtyPickup` and the optional
   `transportState.browserCasualties` fields in the explicit checkpoint schema;
  replay initialization and death inputs. CampaignSession now implements this
  activation and schema validation.
2. Submit each simulation death once using its native slot/generation before
   generic removal. Use the returned world atomically. Existing `combat-death`
   requests carry the stable `loss.id = JSON.stringify([sessionId,key,generation])`;
   forward those to the controller exactly once. Do not additionally manufacture
   a loss on collection. Do not remove/reset the original counters.
3. Keep stepping the existing transport host. Preserve the pending zero-HP body
   registration; use `casualty-picked-up`/`unregister` to finalize presentation.
   Carrier types come from the team's existing source side: side 1 uses type 93,
   otherwise 92, neutral actor team 8, reserved slot `team*15+7+poolIndex`.
4. Effects owner: replace MissionView's current unconditional nopickup rejection
   only when this owner is wired into the actual death path. The policy is
   available through `browserCasualtyPickupPolicy(world, team, unitType)`;
   it returns unowned/ordinary/suppressed/automatic. Nopickup with no eligible
   death is a persistent valid policy update, not a frame error.
5. Continue to let original TRO actions schedule recovery reinforcements and
   outcomes. There is no new recovery callback to spawn at a guessed base.

CampaignSession checkpoint admission and complete input replay are now tested.
Browser presentation and the MissionView nopickup guard remain main-owner work;
this is not a completed full-game presentation claim.

## Session Integration API

Use the existing `CampaignSessionOptions` with `runtimeProfile: "browser-adapted"`
and source-derived `browserAi`. No new seed, timer, recovery callback or pickup
input is needed. Initialization calls `initializeBrowserCasualtyPickup` after
the adapted profile guards. Strict sessions remain unowned.

Submit `session.stepForBrowserView({ clockMilliseconds, updates: [{ type:
"combat-death", slot, generation }] })` using the real simulation binding.
`session.step` accepts the same input. The existing batch was still bypassing
the transport death owner, so this integration delegates only adapted commander
death/removal to `updateTransportHostUnit`. It consumes the returned loss once;
ordinary/static behavior and existing resource/native-combat guards are unchanged.
Failed owner dispatch or premature `complete-removal` rolls back the outer frame.
Repeated death of the same generation remains idempotent after collection;
slot reuse with another generation is not the same casualty.

Main/view must handle these `frame.entry.requests` and `CampaignIdentityEvent`
variants (also retained by `session.identityProvenance`):

```ts
{ type: "combat-death", slot, generation,
  loss: { id, victimTeam, victimType } }
{ type: "casualty-picked-up", slot, generation, carrierId }
{ type: "unregister", slot, generation }
{ type: "create", slot, generation, team, unitType, position }
```

The compact browser frame exposes `world.browserCasualtyPickup`,
`transport.slots`, `transport.registry`, and `transport.reducer.carriers`.
Full `session.snapshot` / `session.browserViewSnapshot` and checkpoints retain
`world.transportState.browserCasualties`, including slot/generation, `lossId`,
nullable `carrierId`, `scheduled|suppressed`, and `collected`. Do not assume the
compact frame includes that ledger or controller consumed-loss history.

On `combat-death`, keep the scheduled commander's zero-HP simulation identity
and presentation binding until collection; no generic early remove or fake heal.
Use `browserCasualtyPickupPolicy(world, team, unitType)` to distinguish automatic
and suppressed behavior. The carrier is created in transport state, not through
a combat-unit `create` request: detect new carrier IDs in the carrier projection
and admit source type 92 for SIDE 0, type 93 for SIDE 1, neutral actor team 8.
Finalize the body on `casualty-picked-up`/`unregister`, without another loss.
Scripted replacement arrives independently through the existing `create` path,
with its real identity, selected commander type, source side and map bounds.
Allow persistent `nopickup` effects instead of rejecting them unconditionally.

Schema 2/3 rejects unknown owner/state/event fields, invalid dispositions and
carrier IDs, and pickup ownership or events in strict sessions. Adapted restore
constructs the same initial owner and replays the complete ordered caller inputs;
full state equality detects edited loss IDs, generations, registry, collection,
carrier identity or omitted deaths. Adapted checkpoints predating this required
owner are not silently migrated. Source configuration is retained, not externally
authenticated by this save format.

## Session Timing Results

The original full SCN/TRO M02 sessions use source-derived mappings for all teams,
player types 69/73, 50 ms steps, orientationSteps 1 and deterministic direction
bits. No injected actors, fake health, changed objectives or trigger counters.
Normal scans occur every eight ticks; TRO `c` is `cycleCounter >>> 4`.

| Source | Death | Collection | Original recovery command | Replacement delivered |
| --- | ---: | ---: | ---: | ---: |
| HUMAN02 | 80 | 138 | 816 | 881 |
| ALIEN02 | 120 | 178 | 848 | 913 |

The recovery commands occur 736/728 ticks after death, strictly after `c+45`.
The owner itself never respawns. HUMAN uses slot 171 then 182; ALIEN reuses 199
with a new identity. In-flight and collected checkpoints replay identically,
including the original death, pickup request and continued carriers. After a
second commander death, 850 further ticks produce no extra commander or WIN;
loss count remains two. HUMAN02's second-loss message is not a repeated recovery
rule; ALIEN02 likewise has no repeated recovery rule. These source sessions do
not execute a player win strategy: original objectives still control victory.

Original HUMAN01/ALIEN01 still emit LOSS on the first normal scan after commander
death, in both strict and adapted profiles. Original AL08 team-6 suppression
retains its loss, and block 9 still executes explicit abduct for team 0.

Session verification: five focused tests in
[campaign-session-casualty-pickup.test.ts](../tools/qa/campaign-session-casualty-pickup.test.ts),
plus casualty-owner/transport/world/session-economy neighbors and scoped
strict/noUnused TypeScript. No agents, browser, full suite, package or asset work.

## Verification

- 8 focused tests in [browser-casualty-pickup.test.ts](../tools/qa/browser-casualty-pickup.test.ts):
  delayed real pickup, zero HP, no respawn/free money, one loss, 64 team/type
  combinations, ordinary/strict controls, original AL08 action and explicit
  abduct, all-team suppression, atomic failure, generation checks, serialized
  in-flight continuation, original M01 LOSS and M02 scripted recovery.
- 23 neighboring transport-host/campaign-world tests pass unchanged.
- Strict/noUnused scoped TypeScript check and editor diagnostics are clean.
- 74 bounded original-handler cases pass with parsed source type flags.
- No agents, full suite, browser run, package or asset changes.

```sh
node --import tsx --test tools/qa/browser-casualty-pickup.test.ts
node --import tsx --test tools/qa/transport-host.test.ts tools/qa/campaign-world.test.ts
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 python3 -B tools/qa/browser-casualty-pickup-native.py
```
# Adapted original TRO semantics

## View integration follow-up

[MissionView](../src/mission-view.ts) now reads the exact
`session.adaptedTroProjection` on its isolated candidate after the session TRO
commit and before strategy, generic guards and simulation advance. The outer
view transaction remains the publication boundary for session, AI, economy,
simulation, selection, exploration and presentation. A late economy failure
discards the candidate; no candidate audio is published.

- Directed `teamAlliances` are installed through the detached, validated
   `Simulation.setTeamAlliances` method. Existing attacks recheck hostility in
   combat advance; acquisition and retaliation read the current snapshot.
   Checkpoints retain runtime relations; view restore compares them against the
   replay-validated session projection, never constructor SCN relations.
- Current `state.sharedVision` adds granted teams' living mobile observers to
   each team's existing geometric sight. Direct own sight survives `vision 0 0`.
   Sharing is not transitive, and does not grant selection or commands. Each AI
   team receives its own visibility IDs, not player fog. This remains adapted
   geometric visibility, not native visibility or stealth parity.
- `ally`, `vision`, `ai` and `aimsg` commands invalidate the candidate's AI
   decision cadence immediately. Source base objectives are rebuilt using current
   directed relations, so newly allied bases are no longer hostile objectives.
- `state.aiGroupWeights` reaches the strategy as part of the projection. Selectors
   1..4 map to unit categories 0,2,3,4. The explicitly adapted frequency rule is
   documented in [browser AI](browser-campaign-ai-20260922.md#tro-projection).
   It is not the native demand/production algorithm.
- `dfiddle` is already consumed by session production. The view uses that owner's
   restrictions and eligibility; a restricted local item disappears from its
   production menu and cannot be purchased. There is no second view producer or
   strategy producer to mutate. A remote team without a production owner retains
   the projection but does not acquire a producer.
- **Remaining gate: automatic casualty pickup has no owner here.** The generic
   host casualty path sets death state and removes collision but never creates
   an automatic carrier. The adapted view rejects any committed-candidate
   `noPickup` flag and rolls the entire frame back with an explicit diagnostic.
   This is not an applied pickup effect. Explicit `abduct` remains untouched,
   consistent with the native evidence below. AL08 is not certified playable.

No session/world/controller, type-37, input settings, transport host, package or
asset edits belong to this follow-up. Strict/native paths are unchanged. Modes
1/2 remain unsupported by this strategy; existing generic guards are not a
source strategy implementation. No agents, full suite or browser were run.

Focused results: **35 tests passed**, plus scoped strict/noUnused TypeScript.
This includes 10 simulation diplomacy tests and five `TRO view` controls
passed (H05 original ally actions, H06 original self-vision command plus explicit
grant/revoke controls, AL07 original dfiddle/ally plus a local production control,
AL08 original nopickup rejection, and late rollback). These use controlled
HUMAN02 view fixtures, not natural playthroughs of those missions. All 20 browser
AI tests pass, including five TRO controls: relations/objectives, weight
frequency/zero cancellation, team-scoped sharing, all four channels for both
races, and HUMAN15 original aimsg actions committed through a controlled session
and then consumed from `session.adaptedTroProjection` by actual strategy calls.
The latter preserves source actions but uses a city-free controlled HUMAN02 SCN
with original valid CITY records; it is not a natural HUMAN15 run. Existing native
callback proofs below establish the source offsets, not adapted algorithm parity.

```sh
node --import tsx --test tools/qa/browser-campaign-ai.test.ts tools/qa/simulation-diplomacy.test.ts
node --import tsx --test --test-name-pattern='^TRO view' tools/qa/mission-browser-campaign.test.ts
```

## Original Module Scope and Results

Owned changes: [controller](../src/engine/mission-controller.ts),
[expression runtime](../src/engine/trigger-runtime.ts),
[world](../src/engine/campaign-world.ts),
[session](../src/engine/campaign-session.ts), tests and this evidence.
No main, MissionView, simulation, strategy, package, asset or original source
edits. No agents or browser runs. Existing long playthrough processes were not
modified or stopped. This is a module implementation and an explicit projection
handoff, not a claim that the unchanged UI already applies these effects.

[Full-script census](adapted-tro-census-20260922.json): **13/13 original TROs
pass the explicit adapted audit**, with source hashes, complete block/action
counts and retained strict diagnostics. The earlier
[view census](campaign-adapted-census-20260922.json) is historical and unchanged.

[Bounded session openings](adapted-tro-openings-20260922.json): full original
SCN/TRO/MSG/MAP/MTG/PTH, actual CampaignSession constructor and 16 natural
ticks, no orders, source rewrites or trigger filtering. Seven pass: H04, H05,
H06, H15, A05, A09, A15. Six still reject during initialization:

| Mission | Remaining source placement failure |
| --- | --- |
| H09 | Row 53, type 37 |
| H12 | Row 51, type 37 |
| A07 | Row 47, type 37 |
| A08 | Row 73, type 37 |
| A10 | Row 38, type 37 |
| A12 | Row 27, type 37 |

These are an explicit test blocklist, not deleted placements or admitted
missions. Type 37 remains outside this change. Source selector 1/2 strategy,
late messages/transport, resource admission and complete mission victory are
not certified by this opening census.

## Native evidence

[Bounded native probe](../tools/qa/adapted-tro-native.py) imports the existing
hash-pinned parser harness. Executable SHA-256:
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
Original parser and handler fragments execute in Unicorn; this is not a
native game playthrough. The probe prints original records, expression
bytecode, handler write assertions and AI policy offsets.

| Source | Implemented meaning | Native evidence |
| --- | --- | --- |
| `reinforce` / `reinforce2` | Five original type/count pairs. Missing final fields parse as zero. Adapted decoder admits the mission-used short forms and zero-only excess padding, never drops extra nonzero payload. Existing transport owner still performs scheduling/spawning. | Parsers `0x43eb74`, `0x43ec8b`; five iterations at `0x43ec0f`, `0x43ed26`. Native records include H04's 15 arguments, H05's 12 arguments and H12's five arguments. |
| `exomoney team amount` | Assign `amount & 255` to the team's money dword. Signed int32 literals admitted only in adapted decoding. No invented multiplication, increment, or full32 literal assignment. | Parser `0x43f642`, byte store `0x43f6ad`, byte load/dword assignment `0x43d900..0x43d910`; **920 becomes 152**, 256 becomes 0, -1 becomes 255. Existing mission-actions probe independently passes. |
| `t` | Type byte of the entity that reserved the tagged destination. **Not a timer.** Missing entity type rejects; normal evaluation does not assume a type. | Parser `0x43cba5` emits opcode 0; VM `0x43d14c` reads `game+0x7d2e+220*slot`. Actual `((S==3)&&(t==8))` bytecode `010703000400070800040316` evaluates to 1 for team 3/type 8. |
| H09 `b(1,3)&&==0` | Preserve the original literal and native omitted-operand postfix behavior, including initialized -1 stack sentinel. It is not rewritten to `b(1,3)==0`. | Original full condition compiles without parser faults; isolated bytecode `0701000703000e070000040316`. `(1&&==0)` yields 0; `(0&&==0)` yields 1. |
| `ally a b bit` | Update directed gameplay alliance `[a][b]`; do not change `[b][a]`. Source SCN is immutable. | `0x43d9ed` writes `game+0x46f34+10*a+b`. Original also updates both auxiliary relation bitset directions through `0x41e7d8`; adapted simulation handoff uses the existing observer-row gameplay policy. |
| `vision a b bit` | Set both shared-vision matrix directions. Source `vision 0 0` parses omitted bit as zero. This is **shared team visibility**, not a timed regional reveal. | Parser `0x43f6f7`; handler `0x43da31` updates `game+0x471a4` bitsets in both directions. Probe confirms bits 0->5 and 5->0. Initial self-only matrix agrees with existing native-world-cycle evidence. |
| `dfiddle team dependency bit` | Set/clear the team's dependency restriction. Session applies ordered deltas to production restrictions and refreshes eligibility through the existing production reducer, preserving unrelated derived startup restrictions. | Parser `0x43f934`; `0x43daa4` writes `game+team*0xe30+0x193c+dependency`; eligibility checks this byte at `0x437e35`. |
| `nopickup team` | Set persistent team flag suppressing automatic death/removal pickup. Does not disable explicit `abduct`. | `0x43da7a` writes dword 1 at `game+team*0xe30+0xbb4`; `0x4163f3..0x416431` bypasses automatic carrier creation when set. |
| `aimsg team 2 selector value` | Original selector-3 policy weights for message selectors 1..4; signed word value. Modes 1/2/4 have proven empty message callbacks, mode 0 makes no callback; every admitted invocation retains an evidence event. Unknown policy modes/message shapes reject. **Not a UI message, camera instruction or victory dialog.** | Parser `0x43ea40`, dispatch `0x43d85e` -> `0x41ad68`; mode-3 callback `0x44bf54` stores at `0x6c18`, `0x6c1c`, `0x6c20`, `0x6c24`. Other callbacks `0x4563d0` are `push ebp; mov ebp,esp; pop ebp; ret`. All four mission weight writes executed in probe. |

Existing `c`, `S`, `s`, lives, reverse action order and unknown-mode gates are
unchanged. `c` remains signed-word `(cycleCounter >> 4)`. The adapted parser is
not advertised as a complete original expression VM; unresolved syntax still
rejects.

## Main integration contract

1. At loader audit/standalone plan boundaries use
   `{runtimeProfile: "browser-adapted", browserAi: true}` explicitly. The
   strict/default audit still rejects these new commands and `t`/H09 syntax.
   Session passes the capability automatically from its existing authenticated
   browser selector configuration; it never grants a native scheduling owner.
2. Read `session.adaptedTroProjection` **after a successful outer transaction**.
   Its exported type is `AdaptedTroProjection` from campaign-world. It contains
   `runtimeProfile`, `cycleCounter`, `teamAlliances`, and `state`, deeply frozen
   and detached. Do not mutate SCN teams or initialize from constructor-only
   source alliances after script changes.
3. Apply `teamAlliances` to simulation hostility, order validation and browser
   AI observations. Apply `state.sharedVision` to current team visibility/fog
   sharing, retaining normal direct vision; no duration/region is supplied or
   invented. Neither projection substitutes for native visibility execution.
4. Feed `state.dependencyRestrictions` to adapted non-session producers and
   strategy; session-owned production already consumes actual ordered dfiddle
   deltas. `state.aiGroupWeights[team][selector]` overrides only weights written
   by aimsg. Native selectors 1..4 map to demand categories `[0,2,3,4]`, as used
   by legacy-ai-active at policy `+0x6c18`. These are demand weights, not a new
   queue command. Main/strategy must actually consume them before claiming
   these final missions playable.
5. Feed `state.noPickup[team]` to the adapted automatic casualty pickup path,
   not to explicit mission extraction. The session's existing generic casualty
   update does not itself create automatic pickup carriers. This projection
   does not claim to implement a missing casualty-pickup owner.
6. `state.events` contains `commandId`, original trigger/action indexes,
   `clockMilliseconds`, decoded command, untouched `sourceAction` (including
   raw source when supplied), and exact `evidence` identifier. Process only new
   command IDs, or apply the complete current state idempotently. Never mark
   an effect applied merely because the event was read. The original module task
   did not update the main/UI; see the follow-up status above for the bounded
   view integration and remaining gates.

## Transactions and checkpoints

New optional world fields are `teamAlliances` and `adaptedTro`. They are created
on the first adapted effect, so old snapshots without them remain compatible.
The getter projects initial source alliances and self-only vision before any
effect without changing a snapshot. Schema 2/3 validate exact field sets,
dimensions, bit values, command variants, literal domains and evidence enums.
Adapted state under a strict profile rejects. Complete existing browser caller
history replay must match the saved state, including every new field/event;
changing a relation, weight, flag or event cannot bypass replay.

Late action/transport/feedback failure retains the previous controller,
world, messages, money, lives, event history and flags. The world adapter
checks decoded effect commands against their source action. Unknown commands
still reject rather than consuming lives or producing empty receipts.

## Verification

[Focused regressions](../tools/qa/adapted-tro-semantics.test.ts) cover all 13
complete scripts, every original new effect action, actual natural openings,
H09/native stack examples, t through an actual session reservation and replay,
reinforcement shapes, int32-to-byte money, strict defaults, unknown modes,
production restriction deltas, rollback, immutable projection and checkpoint
tamper/old-snapshot compatibility.

Additional owned/neighboring checks: 110 passed, 1 existing opt-in retention
test skipped across trigger-runtime, trigger-array, mission-controller,
campaign-world, campaign-session and ordered-trigger-feedback. This included
the existing 20k-idle retention test, not a campaign playthrough. Six positive-
prefix `browser profile:` tests passed; long mission02 tests were excluded.
Strict/noUnused scoped TypeScript check passed. No full suite or browser run.

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 -B tools/qa/adapted-tro-native.py
DC_ADAPTED_TRO_CENSUS=docs/adapted-tro-census-20260922.json \
DC_ADAPTED_TRO_OPENINGS=docs/adapted-tro-openings-20260922.json \
  node --import tsx --test tools/qa/adapted-tro-semantics.test.ts
```
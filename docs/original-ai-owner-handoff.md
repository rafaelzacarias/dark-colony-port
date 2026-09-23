# Original AI Owner Handoff

2026-09-19. Read-only source/capture inspection; this document is the only edit.
No gate, mission, TRO, runtime, generated asset, or existing report was changed.
No agents, browser, tests, suite, or native oracle were run. Original SCN/TRO
parsers and the current pure `campaignPreflight` were evaluated for inspection.
Native numbers below come from preserved captures, not fresh execution.

## Decision

**Do not admit original mission 2 on the bounded task implementation.** Complete
policy computation and CampaignSession receipts are already implemented; repeating
them is not the next owner. The remaining original scheduler/task/world binding
is not supplied by the source-separated configuration.

- Smallest existing campaign control: HUMAN01, 33 placements, nine TRO blocks,
  modes 0/4 only, no resources. ALIEN01 is the other existing first-mission control.
- Smallest additional campaign passing the static filter of modes 0/4 throughout,
  no VENT, and no current preflight diagnostics: **ALIEN14**, 91 source rows,
  78 placed actors plus 13 RENAT records, five TRO blocks. HUMAN11 is larger:
  131 rows, 108 placed actors plus 23 RENAT records, eleven blocks. Neither has
  a colony or factory. These are investigation candidates, **not newly certified
  missions**, and do not exercise the full active policy owner.
- Smallest useful preserved *natural active-AI history*: **ALIEN02**, target
  team 1 at frame 1160. Its first actual orders already exceed the bounded actor
  class/path envelope. HUMAN02 is smaller at boot but has mode 3 on teams 3/4
  from the start, with native policy calls at frame 4, not only its late TRO switch.
- No training is an immediate admission alternative. The smallest files require
  unsupported actions/operands, construction, or resources; they are not a way
  to substitute for campaign progression. The campaign loader has no training route.

For parallel work that does not duplicate the actor-task owner, select **native
prepaid city receipt plus construction ownership**, gated on legally reachable
destruction/cleanup. This closes a real full-policy branch but is not by itself
a mission-2 admission claim. If the goal is specifically the first natural
ALIEN02 activation, the immediate owner is instead the registered task dispatcher,
including stationary type 86 and long-route type 69, not city production.

## Actual Loader And Gate

[game-data.ts](../src/game-data.ts#L317) loads indexed original SCN/TRO/MSG/briefing,
maps and tables, authenticates source production, runs preflight, then optionally
loads resources when a placement has type 40. It does **not** populate a
`campaignAi` configuration or run an original selector scheduler.
[source-production-options.ts](../src/engine/source-production-options.ts#L165)
returns production for the local player only, not all AI teams.

Current unchanged mission-2 preflight reports exactly:

| Mission | Complete blocks | Diagnostic |
| --- | ---: | --- |
| HUMAN02 | 20 | TRO 17: unsupported `ai 2 3` |
| ALIEN02 | 12 | TRO 0: unsupported `ai 1 3` |

`newrate`, expression `setarray`, and omitted-lives diagnostics in old audits
are no longer the current blocker. Conversely, preflight is a TRO/palette audit,
**not a scan that rejects initial SCN AI mode 3**. Several later source missions
return no diagnostics despite starting with active AI. That is not admission
evidence. Do not change the gate to exploit this distinction.

[mission-controller.ts](../src/engine/mission-controller.ts#L143) rejects `ai`.
[legacy-ai.ts](../src/engine/legacy-ai.ts#L279) implements mode 0 as no draw and
mode 4 as no policy action with one cursor advance; mode 3 stays blocked. Its
reason text predates completion of policy computation and is not an accurate
list of the remaining owners. [mission-view.ts](../src/mission-view.ts#L1295)
separately applies `combatMovement.update` to armed actors. First-mission browser
guards/waypoint movement are therefore not proof of native selector/task parity.

The full-session tests deliberately replace source placements, city state, funds,
teams and triggers to construct bounded worlds; see
[campaign-ai-full-policy.test.ts](../tools/qa/campaign-ai-full-policy.test.ts#L38).
Their native receipt comparisons are valid for those worlds, not unchanged SCNs.

## Corpus Filter

All arrays below are literal SCN AI values for teams 0..7, including disabled
teams. Do not discard an entry merely because its SCN `enabled` field is zero
without native scheduler evidence. Rows include RENAT, not just allocated actors.
`AI` in the last column means at least one TRO `ai` action; `other` means another
current preflight diagnostic. A dash means no preflight diagnostic, not readiness.

| Campaign | AI array | Rows / VENT / blocks | Diagnostics |
| --- | --- | --- | --- |
| HUMAN01 | 0,4,4,4,4,0,0,0 | 33 / 0 / 9 | - |
| HUMAN02 | 0,0,4,3,3,0,0,0 | 20 / 4 / 20 | AI |
| HUMAN03 | 0,3,3,0,0,0,0,3 | 49 / 14 / 16 | - |
| HUMAN04 | 0,0,3,0,0,0,0,0 | 30 / 9 / 13 | other |
| HUMAN05 | 0,4,3,4,4,4,0,0 | 33 / 9 / 11 | AI, other |
| HUMAN06 | 0,4,4,4,4,4,4,4 | 108 / 0 / 11 | vision, ally |
| HUMAN07 | 0,0,3,3,0,0,0,3 | 56 / 13 / 16 | - |
| HUMAN08 | 0,4,3,3,0,0,0,4 | 67 / 10 / 10 | - |
| HUMAN09 | 0,3,3,4,4,0,0,0 | 90 / 19 / 14 | other |
| HUMAN10 | 0,0,4,4,0,0,0,0 | 34 / 13 / 22 | AI |
| HUMAN11 | 0,4,4,0,0,0,0,0 | 131 / 0 / 11 | - |
| HUMAN12 | 0,3,3,4,1,4,1,1 | 92 / 18 / 34 | other; also unverified mode 1 |
| HUMAN13 | 0,3,3,3,0,0,0,0 | 74 / 22 / 11 | - |
| HUMAN14 | 0,4,4,0,0,0,0,0 | 78 / 0 / 5 | AI |
| HUMAN15 | 0,3,3,3,3,0,0,0 | 80 / 17 / 13 | aimsg |
| ALIEN01 | 0,4,0,0,0,0,0,0 | 46 / 0 / 9 | - |
| ALIEN02 | 0,4,4,0,0,0,0,0 | 43 / 3 / 12 | AI |
| ALIEN03 | 0,3,4,0,0,0,0,0 | 34 / 8 / 11 | - |
| ALIEN04 | 0,4,4,4,4,4,0,0 | 106 / 12 / 19 | AI |
| ALIEN05 | 0,4,4,4,4,4,3,0 | 51 / 0 / 23 | vision |
| ALIEN06 | 0,4,4,4,4,0,0,0 | 91 / 8 / 14 | AI |
| ALIEN07 | 0,3,3,0,0,0,0,3 | 52 / 12 / 13 | dfiddle, ally |
| ALIEN08 | 0,4,4,4,4,3,0,4 | 76 / 2 / 16 | AI, other |
| ALIEN09 | 0,4,0,3,0,0,0,0 | 118 / 0 / 8 | operand t |
| ALIEN10 | 0,3,4,0,0,0,0,3 | 69 / 11 / 13 | vision |
| ALIEN11 | 0,4,4,3,0,0,0,0 | 35 / 12 / 14 | AI |
| ALIEN12 | 0,0,3,0,0,0,0,3 | 55 / 21 / 11 | other |
| ALIEN13 | 0,3,3,0,0,0,0,0 | 86 / 19 / 11 | - |
| ALIEN14 | 0,4,4,0,0,0,0,0 | 91 / 0 / 5 | - |
| ALIEN15 | 0,3,3,3,3,0,0,0 | 62 / 24 / 15 | aimsg |

| Training | AI array | Rows / VENT / blocks | Diagnostics |
| --- | --- | --- | --- |
| HTRAIN1 / ATRAIN1 | 0,0,4,4,4,4,0,0 | 2 / 2 / 7 each | noundeploy |
| HTRAIN2 / ATRAIN2 | 0,4,3,4,4,4,0,0 | 3 / 0 / 8 each | t; alien also noundeploy |
| HTRAIN3 / ATRAIN3 | 0,4,3,4,4,4,0,0 | 9 / 0 / 7 each | AI, noundeploy |
| HTRAIN4 | 0,3,3,4,4,4,0,0 | 109 / 1 / 13 | noundeploy |
| ATRAIN4 | 0,4,3,4,4,4,0,0 | 98 / 1 / 14 | noundeploy |
| HTRAIN5 | 0,0,4,4,4,4,0,0 | 32 / 1 / 13 | AI, noundeploy |
| ATRAIN5 | 0,0,4,4,4,4,0,0 | 28 / 1 / 14 | AI, noundeploy |
| HTRAIN6 | 0,0,0,0,0,0,0,0 | 40 / 3 / 12 | AI, noundeploy |
| ATRAIN6 | 0,4,0,0,0,0,0,0 | 40 / 3 / 11 | AI, noundeploy |
| HTRAIN7 / ATRAIN7 | 0,4,4,0,0,0,0,0 | 22 or 23 / 2 / 9 | t, noundeploy |

HTRAIN2/ATRAIN2 have only a command building plus marker, not a factory, with
2050 credits: removing resource work does not remove construction ownership.
Their placed types are 79/94 and 94/103 respectively. Training 3 places deployed
extractors 47/48 despite having no VENT. No training native full-world capture
was inspected or claimed. HUMAN14's five-block TRO still switches team 2 to 3;
it is not the smaller mode-4-only counterpart of ALIEN14.

## Source Mission Invariants

`sourceMission` here names the required future contract, not an existing flag
that may be set to bypass validation.

1. Preserve complete original SCN bytes/hash, all eight teams, every placement
   and RENAT row, all TRO blocks/actions/lives/order, MSG and outcomes. Keep actual
   MAP/MTG/PTH and source table identities. No filtered triggers or rewritten funds.
2. Retain ordered team fields: race, money, AI, colour, dependency restrictions,
   alliances, AISlots, both coordinate rows, city/upgrade rows. SCN comments follow
   values. Native AI coordinates fall back to base only when both are zero;
   either zero base coordinate additionally restricts dependency IDs 0 and 14.
3. Use explicit selected fresh configuration: mode 0, localTeam 0, actual race;
   native header `[1,0,race,0,0,0,0,0]`. This is not a recovered installed config.
   Eight constructor percentages 100 become eight multipliers 256. Selected
   policy seed 0 is separate from CRT seed 1; own the shared RNG and every draw.
4. Build the real full pool: 800*220 bytes, 800 registry words initially -1,
   exact slot/generation/type/team/status/HP/position, PTH families/next-family/
   counted neighbors, occupancy and relations. Preserve damaged source HP.
   RENAT consumes no actor slot. Do not transplant lightweight-fixture IDs.
5. Match complete 0xe30 team records, four ready bytes 1, empty counts/delays,
   four queue words -1, flags 3, actual cities and policy allocation pointers.
   Full SCN evidence runs all 120 city calls; mission-2 task 19 starts at word 0.
6. Use actual current census/cap and resource/producer state at native phase
   boundaries, not hardcoded cap 150 or boot credits after income. Loader player
   production is not an owner for every selected AI team. Original scheduling
   must support multiple teams while sharing the pool/RNG, not graft one config
   onto eight independently advancing worlds.
7. Execute full policy including demand before groups 0/1/2/3, exact ordered
   paid receipts and accepting registered task visits. Journal/restore the
   scheduler, receipts, policy/team/pool, tasks, path state, RNG, production and
   resources atomically. Pending markers may not be cleared as a substitute.

The full SCN oracle actually enters `0x41b920` through return, including TRO/MSG,
all 180 HUMAN02 / 203 ALIEN02 noncomment lines and real setup functions. Its
prebound source assets/map and external file/time interfaces remain explicit;
it is not a complete original graphics/audio/configuration boot.

## Actual Actors And Resources

| Mission | SCN placement type IDs | Extra city types / fresh registered total |
| --- | --- | --- |
| HUMAN01 | 8 GRAY, 84 BEAC, 95 BEEK | 16,17,81 on team 1; projection, not new native capture |
| ALIEN01 | 0 TRSC, 82 SALA, 89 CENT | no cities |
| HUMAN02 | 8 GRAY, 25 RNAT, 40 VENT, 84 BEAC, 86 DISH | 16,17,81 on team 0; 21 native actors |
| ALIEN02 | 0 TRSC, 2 REAP, 8 GRAY, 10 SCYT, 25 RNAT, 40 VENT, 41 T, 86 DISH, 89 CENT, 91 TONG | 28,29,81 on team 0; 44 native actors |
| ALIEN14 | 0,2,4 SARG,8,10,26 SPID,36 GRUB,73 commander,98 CAM | no cities; static candidate only |
| HUMAN11 | 0,2,8,10,12 PSYC,26,36,69 commander,83 CRYO,87 FETU,88 TORT,97 WATC | no cities; static candidate only |

Both mission-2 city sets use slots 0/1/5 and HP 4800/2400/1. HUMAN02's source
team-2 mobiles are type 8 at slots 156..165. ALIEN02's six team-1 DISH actors
are slots 160,161,162,165,166,167; actual team-2 type-2 actors include 170/181.
Neither mission has placed mobile harvesters. Original initial TRO reinforcement
provides HUMAN02 type 6 and ALIEN02 type 14 to the player, alongside commanders
69/73. These must be real carrier allocations, not constructor fixtures added
to the mission. Later reinforcements and types remain part of the contract.

HUMAN02 VENT slots 166..169 have (rate,reserve) `(0,3500),(0,3500),
(22,12000),(15,7000)`; ALIEN02 slots 190..192 have `(25,9500),(12,3500),(0,5000)`.
All are owner 8. Collection requires actual 6/14 -> 47/48 ownership, source FIN
directions, deploy/income/exhaustion/death, Stop/release, pending orders, legal
movement and restore. Bounded player harvest is not arbitrary AI route ownership.
The resource loader is fingerprint-gated to these two SCNs. Absence of a resource
configuration is permissible only for a genuinely resource-free source contract,
not by dropping type 40 or ignoring deployed harvesters.

## Quantitative Native Evidence

Preserved natural worlds, selected seed 0:

| Observation | HUMAN02 | ALIEN02 |
| --- | --- | --- |
| First observed mode-3 scheduler work | teams 3/4, frame 4, caller 0x41ac71 | team 1, frame 1160, caller 0x41aca1 |
| Later target-team four-group capture | team 2, frame 14124 | team 1, frame 1160 |
| Target mode-7 packets | 3 empty | 10: 7 actor-bearing + 3 empty |
| Target subsequent consumptions | 0 | 7, frame 1161 |
| Complete bounded updates | 14160 | 1200 |
| Observed submitted production packets starting mode 9/10 | 0 | 0 |

HUMAN02 frame 4 records twelve decision/emission entries, six per selected team:
`4598b0,4593a8,463e78,458b44,463e78,459f80`. The late target captures each record
the same six entries. ALIEN02's four groups additionally retain all **16 ordered
callbacks**: `[4578a0,44bbdc,44b920,4598b0]`,
`[4578a0,44bbec,4593a8,463e78]`, `[4578a0,44bbec,458b44,463e78]`,
`[459f24,44bbdc,44b920,459f80]`. Group RNG cursors are 123->123,
123->124, 124->124, 124->124. These are actual group calls, not inferred counts.

The six ALIEN02 DISH actors and slot 199 type 69 all receive Q8 waypoint
`(256,18688)`, tile `(1,73)`. Slot 199 starts at Q8 `(7808,7040)`, tile `(30,27)`.
This is neither a horizontal 1..3-cell route nor a stationary-actor-supported
initializer. Original registered visits consume pending at frame 1161;
[legacy-ai-task.ts](../src/engine/legacy-ai-task.ts) cannot certify those whole
visits. Its `registeredVisitComplete` remains false. HUMAN's 81 other historical
consumptions must not be relabelled as feedback from target team 2.

### Demand Versus Historical Activation

Historical group captures start **after demand**; before-demand team/census/policy
buffers are absent. Do not invent a historical selected rule or debit. The
separate demand oracle reconstructs source inputs and sets population limit 150;
its labels are not natural first-activation captures.

For `source-pipeline`, both mission targets execute exactly:
`4564c8(parameter 8)->1`, `45642c(parameter 1)->0`, then `456448(parameter 1)`.
That is first-zero rule **1**, harvester demand, zero packets and zero debit.
HUMAN02/team2 is race1 with census-category totals `[10,0,0,0,0,0,0,0,0]`;
ALIEN02/team1 is race0 with `[0,0,0,0,0,0,0,0,6]`. Both have zero credits and
no colony base; native source restrictions include IDs 0/14. A missing colony
alone therefore does **not** prove a mode-9 packet on their first activation.

City demand is nevertheless a mandatory earlier-priority branch of full policy:
native controlled `city-missing` / `select-rule-0` chooses predicate `4564c8(8)`
then action `456550(8)`, encoder `40c13c`, debits 2000 and emits city0/level0:
`07000900000200` for HUMAN02/team2, `07000900000100` for ALIEN02/team1.
These controls use 100000 credits and modified city/restriction state, **not
unchanged original mission state**.

| Native controlled first-zero rule | City / level | Source dependency race0 / race1 | Debit |
| --- | --- | --- | ---: |
| 0 | 0 / 0 | 0 / 14 | 2000 |
| 2 | 1 / 0 | 1 / 15 | 1000 |
| 4 | 2 / 0 | 3 / 17 | 2000 |
| 5 | 3 / 0 | 2 / 16 | 2000 |
| 9 | 3 / 1 | 4 / 18 | 2000 |
| 10 | 2 / 1 | 5 / 19 | 2000 |
| 15 | 4 / 0 | 6 / 20 | 3000 |

Each listed selection emits one actual mode-9 packet in each race's control.
Busy/unaffordable city controls select rule 0 but emit nothing and debit zero;
the restricted control skips it and emits a mode-10 combat request costing 900.
Upgrade controls 12/13 emit nothing: HUMAN-labelled race1 selects 12 for both;
ALIEN-labelled race0 is shadowed by rule 4. Do not rewrite rules for coverage.
`harvester-empty` emits one mode-10 type14/team2 or type6/team1 packet, debit
1500. Those also hit a real owner boundary: current paid receipt accepts only
types 0/8, not harvesters or the weighted control's types 1/9.

## Next Owner And Acceptance Contract

[campaign-ai.ts](../src/engine/campaign-ai.ts#L523) validates exact native intent
debits, then returns `unsupported-city` for mode 9 before committing anything.
The next city owner must consume original `0x41c8d4` receipt semantics after
`0x40c13c` emission, without charging twice or routing through UI purchases.
Own source city/level/dependency, accounting, busy/latch, native slot/footprint,
main/auxiliary FIN/tasks, completion, cancellation semantics and destruction.
Stage these with policy/team/entities/RNG and durable receipt retry/restore;
a late unsupported branch must roll back the entire session frame.

Use the actual source-backed dependency2/16 slot3/level0 construction as the
first lifecycle target: types20/32 with auxiliaries92/93, not an invented city.
Existing [construction evidence](construction-lifecycle-20260919.md) establishes
normal counter4 completion/latch release at outer updates186/246, and the
counter3 fast path at update1. It proves queued idle waits until completion,
not active cancellation/refund. It does **not** certify every city in the rule
table; extend profiles from source rather than generalizing those timings.

The construction gate still fails legally reachable lethal interruption cleanup.
Eight timed weapon controls are nonlethal; direct death/reset injections are
negative controls, not legal destruction evidence. Required next golden: source
attacker/weapon/FIN launch, real collision/effect/damage while the construction
state is reachable, through death/unregister, footprint, busy/latch and auxiliary
cleanup, without forced HP/task/phase or bypassed damage. Until that succeeds,
retain `unsupported-city` and the lifecycle gate even if receipt staging works.

Separately, original mission admission needs native scheduler phase ordering,
multi-team state, registered FIN/task dispatch, long/blocked/cross-family routes,
movement/combat and resource ownership on actual source identities. ALIEN02 is
the sharper first integration golden; full HUMAN02 is not an acceptable bounded
class-path substitute. No claim here unlocks all campaign phases.

## Evidence Identity

Local captures were present and read, not regenerated. They are not committed
runtime lookup fixtures. Reproducers and their limitations are in
[ai-policy-runtime-20260919.md](ai-policy-runtime-20260919.md),
[ai-demand-rule-20260919.md](ai-demand-rule-20260919.md), and
[campaign-ai-full-policy-20260919.md](campaign-ai-full-policy-20260919.md).

| Capture under /tmp | SHA-256 |
| --- | --- |
| dc-ai-gap-source-proof-20260919-16.jsonl | 187020b4b33066743e64447b50b520716dc43d021af32678df56422633ec1bb7 |
| dc-ai-gap-natural-human-20260919-25.jsonl | 53245c583dcd87bee5553e6d2e73cb7a1d924706ea28167bc7fdd9f6a8db1466 |
| dc-ai-gap-natural-alien-20260919-24.jsonl | 53c46951c0ffc967d3152d1ce6b167c0317086e23ba3b5fe784df451505f3d59 |
| dc-ai-demand-native-0919-f2.jsonl | 4a9fe987a426f0c8adbf5731f8c3660730ae0357e1dcd12dd91dcc9589e49026 |
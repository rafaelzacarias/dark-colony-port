# Bounded Native Production Session

2026-09-19. Implemented only in
[campaign-production.ts](../src/engine/campaign-production.ts) and
[campaign-session.ts](../src/engine/campaign-session.ts). No main/view, other
engine owner, assets or UI changes. This is bounded engine admission, not a
complete production system or mission playthrough.

## Native Evidence

[campaign-production-session-native.py](../tools/qa/campaign-production-session-native.py)
executes the original executable pinned to SHA-256
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
It reuses the existing source parser and FIN loader, including executed delay
decoding at `0x425b21` and bank binding at `0x43c18c`. The selected unit-type
record field is **+0x98**, not the stand bank +0x80. The producer initializes
its separate animation at **entity+0x24** via `0x414719 -> 0x42630c`:
frame **+0x28**, delay **+0x29**, mode **+0x2a**. It is not construction's
main animation mode at +0x1a.

| Type | Original FIN / selected state | Decoded byte delays | Advancing calls |
| --- | --- | --- | --- |
| 0, TRSC | HUBU.FIN / TRSCBUILD0, timelines 26..47 | 22 frames, each 1 | 22 |
| 8, GRAY | ALBU.FIN / GRAYBUILDSTAND0, timelines 303..334 | `[2, ...26 times 1, ...5 times 2]` | 37 |

The initializer produces frame 0, delay 0, mode 1. The first update therefore
advances past frame 0; summing all frame delays is incorrect. All 32 bank
directions resolve to the same delay sequence for these two bindings. The
owner validates every timeline against these source sequences and hashes:

- HUBU.FIN: `b27b20282999188e37a74872b70a273b370cc1dd219f2f8fa84f5f2f2ca3a5a4`
- ALBU.FIN: `99c3d4e4fa0badeb2cd68361a6f1b57dcf9dfbdd027f820a68d806aa18773fa1`

Runtime clock advancement reuses `advanceLegacyResourceAnimation`; it does not
count down the totals above. Tests parse the actual FIN with `parseFin`, compare
`finSourceDuration(field2)` to native decoded bytes, then compare each session
frame/delay/mode to executed `0x4264c8` followed by `0x414314`.

The bounded producer probe intercepts census, spawn and FIFO copy. It proves
native gate/clock/spawn arguments, not census enumeration. Existing production
tests separately execute uninterrupted `0x41b750 -> 0x41af14` to prove exact
reserved-cell allocation. Session tests use that existing allocator bridge.

## Exact Caller Inputs

Opt in with `CampaignSessionOptions.production`:

- `records`: parsed DEPEND records, all IDs preserved, including sparse 83/84.
- `units`: original GAMESTAT token 21 queue, token 23 exit selector, signed
  offsets from `0x41add0 + queue*24 + exitSelector*8`. The base profiles require
  queue 0, selector 0, offset `(0,-3)`. Do not infer these from prerequisites.
- `sourceProfiles`: JSON `{unitType: 0|8, id, bankField: 152, finSha256,
  directions: number[32][]}`. Resolve the original **unit +0x98** bank, not a
  sprite animation chosen by a renderer. Every delay/name/hash is validated;
  other types/banks and modified timelines fail before any credit reservation.
- `teams`: explicit owner seeds `{team, race, credits, costAccumulator, base,
  slots, restrictions, upgrades, producerDelays}`. `slots` contains five
  `{health, level, busy: 0}` records; `upgrades` contains actual
  `{unitType, weapon, armor}` bytes. `producerDelays` is four native delay bytes;
  only queue 0 may be nonzero in this bounded admission. Source money, race,
  base and City projection must match. Each admitted team must have a live
  slot-1 producer and its race's validated profile. Restrictions and initial
  upgrade/accounting/delay values are caller-owned native facts, not defaults.
- Optional `queueSafetyLimit` retains the existing explicit adapter bound.

Original team fields, with `T = game+0xb98+team*0xe30`: credits `T+0x14`,
accumulator `T+0x18`, race `T+0x20`, base `T+0x2c/+0x30`, HP `T+0x3c+4*slot`,
level `T+0xc4+4*slot`, busy `T+0x78+slot`, restrictions `T+0xda4+DEPEND ID`,
ready `T+0x108+queue`, delay `T+0x10c+queue`. Fresh queues must be empty and
ready; resume through the direct session checkpoint, not a new seed.

Every enabled `step` requires `productionVisits`, exactly one per owned team,
in ascending native team/producer order:

```ts
productionVisits: [{ team: 1, queue: 0, population: actualCensus, populationLimit: actualCap }]
```

`population` is native `0x41a538(EAX=6, EDX=team)`, not a generic entity count;
`populationLimit` is `game+0x528`. This bounded API admits nonnegative signed32
values. The caller must provide the actual values for each visit. It cannot
provide animation mode, elapsed duration, completion flags, exit coordinates
or allocation receipts. A session step advances one native producer visit,
not an elapsed-time catch-up loop or a trigger-clock-derived countdown.

Optional `productionCommands` are `{id, team, action}` with action only
`{type: "reserve"|"release-pending"|"dispatch", dependency}`. IDs are stable
idempotency identities. Internal journal IDs use a separate namespace. Native
callbacks, construction and upgrades are not accepted by this session path.
Use ascending DEPEND dispatch order to reproduce the native dispatcher.

All existing `resourceLifecycle`, `resourceInitialIncome`, `resourceScales`,
`source.rawHeader` and `resourceFrameSource` requirements remain unchanged.
Supply actual AI records, multipliers, local team, cancellation gate and
optional native orders described in [resource handoff](resource-session-handoff.md).

## Transaction And Economy

The session stages unit updates, checks source colony ownership, synchronizes
the existing world balance, applies purchases, and publishes reserved credits
to `world.exomoney`. The resource host then settles into that actual balance.
Production imports it through `sync-credits`, checking `expectedPreviousCredits`
and the new full signed32 `credits`. Pending UI reservations and the cost
accumulator are unchanged by synchronization; refunds retain native signed32
credit wrapping. Dispatch still moves the prepaid cost into accounting once.

Producer visits decrement delay before exit testing. An occupied exit waits
before population checks and clears a real blocker's raw +0x35. Delay 1 can
expire and start in the same visit. A free exit and expired delay reach the
population gate: cap rejection refunds the head, subtracts its accounting,
pops it and journals message 119. Otherwise the owner starts its FIN clock and
atomically reserves exact exit 1022 using `reserveCampaignProductionExit`.

Later visits advance the stored FIN state. Only native clock mode 2 requests
allocation; `allocateCampaignProductionUnit` calls the existing exact-slot
allocator. Successful creation consumes the reservation and dequeues once.
The session journal exposes `productionRequests` alongside host `requests`,
including the one `create` receipt with slot/generation. The live consumer must
bind that identity downstream, never spawn another unit or independently debit.

Movement collision rebuilds retain owned production reservations and reject
movement onto them. Any failure discards the whole session update, including
settlement, animation progress, requests and journals. Allocator exhaustion
leaves the previously committed paid head/clock/reservation intact; it is not a
population refund. A later valid slot release can retry. This rollback is
adapter safety, not reconstructed native allocator-failure behavior.

Triggers run after the production pass; their final `exomoney` is synchronized
again before commit. This is an explicit session ordering contract. No claim is
made that batching all resource visits before all production visits reproduces
every interleaving of the original global entity dispatcher.

## Checkpoints And Limits

New session saves use **schema 2**, kind `campaign-session-snapshot`. Production
remains optional. The direct state includes producer animation, pending/queued
work, economy, semantic command journal, requests, reservations and native slots.
Restore validates source profiles, queue/ticket/exit ownership, source-pinned
catalog/selectors, economy and allocation identities without replaying visits.
Missing or mismatched production state is rejected. Public production snapshots
remain detached and recursively frozen. No callbacks are serialized and all
existing input/ownership requirements remain unchanged.

On commit, the session drops its internally generated `sync-credits`,
`producer-idle`, `producer-wait` and `producer-advance` journal records. These IDs
belong to past session cycles and cannot be submitted through the public command
API. External `input:` command IDs and semantic production events remain, so
repeated commands still deduplicate or reject changed payloads after restoration.
The standalone production reducer is unchanged. Legacy schema-1 replay saves are
still read, with their production journals normalized before comparison; the
next save writes schema 2. See [checkpoint migration](campaign-session-checkpoint.md).

Not admitted: other troop profiles, queues 1..3, construction/upgrades, producer
destruction/City mutations, queued cancellation, arbitrary native mid-game
imports, census enumeration, global scheduling cadence, or downstream unit
combat/render/idle ownership. Other source-unit banks need their actual native
resolution and per-visit clock proof, not guessed durations. No ownership
restriction on these two engine files remains a blocker.

Fixtures use synthetic open terrain, base `(50,50)`, empty triggers, explicit
money/census/cap/delay/accounting, and actual source DEPEND/GAMESTAT/FIN data.
Resource coupling uses real native lifecycle profiles with a synthetic
same-tile source/extractor; it proves settlement synchronization, not a mission
playthrough. No agents, browser or full suite were used.

## Verification

56 focused tests passed, including both native clock transactions and replay,
blocked exit, delay expiry, cap refund, invalid-profile admission, full32 sync,
reservation preservation, slot exhaustion/reuse, actual resource income and
existing owner/session/resource regressions:

```sh
node --import tsx --test tools/qa/campaign-production.test.ts tools/qa/campaign-session.test.ts tools/qa/resource-session-lifecycle.test.ts tools/qa/campaign-production-session.test.ts
npm run typecheck
```

The new test honors `DC_PRODUCTION_SESSION_TRACE` and
`DC_RESOURCE_LIFECYCLE_TRACE` for matching native JSON traces; without them it
executes the original probes. Existing Capstone/Unicorn locations are used.
Unique regression log: `/tmp/dc-production-session-regression-20260919-035537-97259.log`.
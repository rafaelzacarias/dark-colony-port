# Bounded CampaignSession CITY Acceptance

2026-09-19. The existing full-policy/session transaction now accepts the first
native science mode9 alongside base-troop mode10 when production explicitly
supplies `constructionSources`. This is not original mission02 admission.
Updated for the latest verified round11 gate on 2026-09-20: bounded CITY now
also reaches MissionView and joint view/session restore; no public Build dispatch
is enabled.

## Owned Transaction

- `transactCampaignAiProduction` consumes the original AI debit once, commits
  `receive-prepaid-city`, adds the source DEPEND cost to accounting, and installs
  the actual world/transport actor. Missing CITY ownership still returns
  `unsupported-city`. Other buildings, upgrades and replacement remain blocked.
- Science is `team*15+3`, type20/32, HP2400, generation0. Position is
  `base*256+(512,80)`, not a centered tile. The four original footprint cells
  become occupied and ineligible for mobile allocation.
- Slot6 is checked empty at initialization and receipt, then reserved by the
  construction owner. Incoming/outgoing type92/93 constructors use the same
  fixed slot, generations0/1, team8 and HP800. Creation/unregistration requests
  correspond to installed host/world identities. Mobile high-water is unchanged.
- Exo/base and the original implicit slot5 type81/HP1 are external prerequisite
  identities, not actors manufactured by the receipt. Their identity, health,
  registry and source position are checked before and after every session step.
- Main and auxiliary raw220 include native task stack storage, stale popped
  payloads, FIN state, height and second-constructor prior-HP storage. FIN bank
  pointers are relocated to `unitType*280+0x90/0x98` field identities; original
  FIN profiles, delays, hashes and direction0 remain unchanged. This is not a
  claim to preserve process-specific pointer addresses or own general rendering.

`CampaignSessionInput.constructionVisits` is mandatory with CITY configuration.
It contains one `{team, visit}` per active owner, ascending by team, or `[]` when
none is active. Each visit supplies sequence, actual native counter (>3), main
and auxiliary HP, and the exact registered fixed-slot list. Wall-clock
milliseconds never synthesize visits. Base slot1 runs before science slot3 and
auxiliary slot6; an auxiliary created by main receives its later same-pass visit.
Unregistered auxiliaries retain status1 but do not run. Mobile resource work
follows these bounded fixed visits. AI receipts are processed after resource
income; a new CITY begins visiting on the next caller input.

Normal human/alien busy clears at visit135/195, and latch releases at186/246.
HP is2400 from receipt and is never used as a fabricated completion signal.
City HP/level/busy/latch, registry, footprint and AI team fields commit together.
Native base production, income and player pending purchases retain their own
source profiles and accounting. Failed late AI, TRO or actual allocation aborts
the entire candidate, including raw bytes, statistics, credits and all owners.

## Checkpoint Contract

`CampaignSession.restore(checkpoint, expectedAi, expectedNativeTasks,
expectedConstructionSources)` requires an independently provided exact CITY
configuration. The saved configuration is not its own authority. Strict JSON
shape validation and source-host replay run before complete caller replay from
a fresh session. The entire saved state must equal that replay, including empty
reserved slots, generations, raw220, ledger, source profiles, footprint,
registration and caller history. CITY history is retained independently of the
bounded public journal. Unjournaled direct resource mutation is blocked.

## Evidence

- [Native oracle](../tools/qa/campaign-session-city-native.py): executes the
  existing original constructor/registered-loop probe, adding raw220 snapshots
  and the unchanged executable RNG table. No lifecycle callbacks are stubbed.
- [Raw tests](../tools/qa/campaign-session-city-raw.test.ts): every byte of both
  actors at all187/247 snapshots, with only FIN pointer relocation.
- [Session tests](../tools/qa/campaign-session-city.test.ts): actual full-policy
  shared pool -> paid mode9 -> incoming auxiliary -> BUILD -> outgoing auxiliary
  -> real City readiness -> second native mode10; source prerequisites and
  original factory restriction retained. Both races; full caller checkpoint.
- Negative controls cover late AI/TRO, actual mobile pool exhaustion, source and
  checkpoint tampering, missing/reordered visits, legal phase3 lethal death,
  prerequisite death and cancellation. Phase2/3 restores match the next100
  caller steps. Native income, a pending purchase and real troop allocation
  coexist during BUILD and survive restore.

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 -B tools/qa/campaign-session-city-native.py > /tmp/session-city.json
DC_SESSION_CITY_TRACE=/tmp/session-city.json \
  node --import tsx --test tools/qa/campaign-session-city.test.ts
npm run typecheck
```

## Still Missing

External damage, lethal death, cancellation, removal, conflicting orders and
identity/footprint changes reject before committing. The actor is not forced
back alive and the construction gate is not released. The legally reachable
phase3 destruction workflow remains unsupported. Completed construction retains
its bounded final state; general building idle/combat/FIN ownership is not added.

The full-policy computation still reports `runtimeReady:false`; pending mobile
orders still require the existing native task handoff. CITY does not supply
missing enemies, general workflows, shared combat/RNG scheduling or original
mission02 readiness. Full-policy and native actor task configurations retain
their existing shared-scheduler rejection.

The original session-only slice did not change public view/main code and had no
visual science/auxiliary adapter, render-clock integration or joint view checkpoint.
That historical integration boundary is superseded by the round11 work below;
the lack of a public construction command remains current.

## Round11 View Integration

[MissionView](../src/mission-view.ts) now integrates bounded science/auxiliary
presentation, construction visits and joint view/session checkpoint restore.
[Observer coverage](../tools/qa/science-construction-observer.test.ts) includes
normal local source sight and missing-visit rollback. Public Build dispatch is
still disabled: `constructionMenu.requestEnabled` is false.

The [construction fixture](../tools/qa/fixtures/science-construction.ts) and
reusable [browser fixture](../tools/qa/fixtures/science-browser.ts) are explicitly
QA-only: seeded 6,000 credits, team1, six linked witness actors, with an optional
local team0 observer. Neither fixture is an admitted original mission2.

Main verified both races in the shared embedded browser under normal fog/source
sight; this docs-only update did not rerun that browser:

| Fixture / Frame | Main-Verified Result |
| --- | --- |
| Human50 / Human70 | 27,615 / 41,202 colored pixels; exact checkpoint restore and missing-visit rollback true. |
| Alien initial attempt | Missing WARHIVE/BIOHIV archives caused failure. `missionAnimationArchives` now includes both through ALBU; two regression tests cover the fix. This failure is superseded by the rerun. |
| Alien70 after fix | 51,336 colored pixels; restore equality, missing-visit rejection and unchanged state all true. |
| Alien195 | 51,469 colored pixels; busy0, latch1, phase3, auxiliary generation1, departing true. |
| Alien246 / mobile | Pending main's final append; no completed result claimed. |

Mode2 WARHIVE warnings, mirrored/elevated mode5 source effects and global ordering
remain unresolved. These screenshots do not establish full visual parity,
sustained 60 FPS or cross-device acceptance.

Latest gate `/tmp/dc-round11-verified-20260920.log`: 2,510 tests, **2,506 passed,
zero failed, four skipped**, typecheck/build passed; JS 573.75 kB, gzip 180.54 kB,
over-500-kB warning. It supersedes the earlier TS18047 gate stop: the observer
raw-slot guard now rejects both null and undefined. The failed log remains
historical evidence, not a current blocker. See
[round11 acceptance](acceptance-round11-20260920.md): phases1-2 accepted,
phases3-5 partial, all-phases goal not met.
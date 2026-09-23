# Later Mission Checkpoint Join

## Scope

The subsequent archive fix changes only `missionAnimationArchives` in
[mission-view.ts](../src/mission-view.ts), its focused tests, and these notes.
Source sprite `CAM` selects archive `CAMM`; the selector retains prefix `CAM`.
Original CAMM.FIN SHA-256, states, and timeline were verified before editing.
No assets, engine, loader, progression, main UI, or packages were changed by
this follow-up. The checkpoint-schema work described below is prior work.

Only the import and native ordinary profile schema in
[simulation.ts](../src/engine/simulation.ts#L526) changed, plus two small derived
exports in [legacy-balance.ts](../src/engine/legacy-balance.ts).
`VERIFIED_NATIVE_SOURCE_TYPES` and `VERIFIED_NATIVE_WEAPON_IDS` are frozen
enumerations derived directly from the existing verified attacker table.
This retry replaces the previous partial fix's defense-type filter and generic
1..65535 weapon bound; neither defense-only attackers nor arbitrary weapon
integers are structurally admitted.
`copySourceDamageProfile` still requires an exact verified attacker type,
source-type faction, weapon ID, and canonical coefficient row. A valid weapon
enum from a different source still rejects. All other schema fields are unchanged.

No profile labels, source stats, weapon records, TRO actions, or actors were
rewritten. Checkpoint versions, legacy profiles, source identity, unit metadata,
team/weapon/binding checks, navigation and ownership constraints are unchanged.
Moving-fire gating, physics, MissionView, loader, AI admission, default mission
selection, packages, and assets were not edited. No agents, browser, or full
suite were used. Selection remains mission 01; no selector, standalone access,
automatic skips, or admission of mission 02 was added.

## Results

Both tests call the actual `loadCampaignMission(faction, number)` without
replacing any input, then construct the ordinary default MissionView path.

| Mission | Initial / Tick-200 Actors | Mobile / Static | Team-0 Mobile | Created By Tick 200 |
| --- | --- | --- | --- | --- |
| HUMAN11 | 108 / 108 | 92 / 16 | 6 | `[]` |
| ALIEN14 | 78 / 78 | 66 / 12 | 11 | `[]` |

The created-actor inventory is genuinely empty, not omitted. All initial
bindings and mobile weapons remain present. Full original TROs are retained.
Neither mission needs invented player reinforcement to test commands.

Every default tick 1..200 checks simulation tick, mission diagnostics, damage
diagnostics, complete checkpoint equality against a fresh restored run, full
TRO preservation, and every living source actor's binding/team ownership.
Both runs have no mission or damage diagnostic and no outcome at tick 200.

After that uncommanded baseline, public selection/Move/Stop exercise team 0.
Selecting all foreign mobile actors is rejected (86 HUMAN11, 55 ALIEN14).
Move uses an actual free neighboring grid cell, not a modified path or position:

- HUMAN11 actor 1: (150,27) -> (150,26).
- ALIEN14 actor 1: (56,11) -> (56,10).

At tick 201 the actor has an active path and reserved destination. JSON restore
matches exactly, continuation is compared through tick 220, and public Stop
matches at tick 221. No direct simulation commands, actor injection, random
playthrough routes, damage overrides, or forged trigger feedback are used.
Restore negatives cover source stats, current weapon, team, binding identity,
foreign selection, changed TROs, and missing damage matrix. The strict checkpoint
case in the additional-profile test covers all 20 verified source/upgrade combinations and 220
profile mutations, including defense-only attacker IDs and wrong weapon pairs.

## Real Assets

[source-render.ts](../tools/qa/fixtures/source-render.ts) loads actual generated
PNG dimensions and FIN/atlas data and records Canvas2D calls. It does not
rasterize pixels or validate browser/WebGL output, audio, native timing, or
every animation state. No fixture alias or replacement asset was supplied.

Both missions now initialize from real assets and render every tick 1..200,
including ticks 20..200. Fresh JSON restores at ticks 0, 100, and 200 initialize
from the same assets, preserve complete checkpoints, and continue identically
through tick 201. Full original TROs, bindings, source metadata, and mobile
weapons remain unchanged; ALIEN14 explicitly retains type 4 and weapon 14.
No injected actors, dropped weapons, or replacement geometry are used.

| Mission | Bindings | Mobile Weapons | Fetched URLs | Sprite Draws |
| --- | --- | --- | --- | --- |
| HUMAN11 | 108 | 92 | 166 | 2,460 |
| ALIEN14 | 78 | 66 | 122 | 4,510 |

Counts cover the combined render/restore test. ALIEN14 reuses cached atlases
from HUMAN11; the initial isolated ALIEN14 run fetched 147 URLs. Both runs have
zero missing assets, missing-state/unsupported-timeline warnings, or mission/
damage diagnostics. Remaining warnings cover WebGL2 unavailable/RGBA fallback,
unverified 20Hz cadence, native child sorting/shadow passes, and GRAY/SCYT/SARG
event handling. This is not browser pixel verification or original timing parity.

The original [CAMM.FIN](../raw_cd/DC/ANIMATE/CAMM.FIN) hash is
`b26a336a8610b88495367a2f90eb778307dd8041e7875fd55196815c7bac785f`.
Its exact states `CAMSTAND0` / `CAMDIE0`, timeline, and `camm` child name are
preserved in [CAMM.json](../public/assets/generated/animations/CAMM.json).
The existing selector resolves both states with prefix `CAM`; only the archive
filename changes. No source or generated asset was renamed.

The full foreseeable ALIEN14 scan verifies 10 visual sprites, 11 original FIN
archives (DROP, SAWS, SAUC, GRAY, SCYT, SARG, TRSC, REAP, CAMM, GRUB, SPID),
and 6,864 timeline child-frame references against real atlas frames and PNG
bounds. Every archive's hash, states, and timeline match raw source.
No additional asset alias or case correction was needed. Remaining missing
assets in this tested inventory: **none**. Unvisited runtime paths remain unproven.

## Playability Limits

The actual source selectors are retained, including modes 4 on HUMAN11 teams
1/2. Tests assert that no `campaignAi`, `aiSelector`, `nativeAiTasks`, or
`nativeCombat` owner is injected. The ordinary path still uses
[CombatMovementOrders](../src/mission-view.ts#L1777) and verified damage profiles,
not complete source-native actor scheduling. Native scheduling admission still
requires its explicit owner in
[CampaignSession](../src/engine/campaign-session.ts#L416). The checkpoint join
does not extend the source-native task factory's mission hash allowlist or
establish later mission native AI/combat/production compatibility.

Original victory/loss contracts are tested without injecting a result:

- HUMAN11 loss: trigger 10, commander loss statistics for types 69..72,
  `bail 1 2`. Victory triggers 12/13 start disabled. Trip 9 enables 12; trigger
  11 requires `s(1,3)==7` and enables trip 13. Trigger 12 uses the same statistic
  condition. Both victory paths use `bail 0 1`.
- ALIEN14 loss: trigger 18, commander loss statistics for types 73..76,
  `bail 1 2`. Victory is trip 3 `(S==0)`, retaining its original team-1 type-10
  `reinforce2 1 54 50 10 1 ...`, messages, and `bail 0 1`.

That type-10 reinforcement is SCYT. Its ordinary weapon behavior is not removed,
but the default generic cadence is not proof of original native parity. No
winning trip was forced, and no long natural winning traversal was attempted.

No natural winning or losing traversal was completed. Later trip delivery,
combat, scripted births, all visual states, and whole native scheduler behavior
remain unverified. **Zero additional missions are certified fully playable.**
Do not interpret absence of initial errors as permission to skip mission 02 or
expose these missions through the default campaign UI.

## Verification

Archive follow-up: 8 tests passed, zero failed/cancelled/skipped, including both
actual-asset and logical 200-tick runs, movement through tick 221, source archive
inventory, CAM mapping, and existing BIOHIV/WARHIVE mappings:

```sh
node --import tsx --test tools/qa/mission-animation-archives.test.ts \
  tools/qa/later-mission-checkpoint.test.ts
```

Log: `/tmp/dc-cam-alias-restore-20260922-02.log`.
Initial isolated alias/render check: `/tmp/dc-cam-alias-first-20260922-01.log`.
No agents, browser, full suite, or package changes were used.

Prior checkpoint-schema verification:

```sh
node --import tsx --test tools/qa/simulation-checkpoint.test.ts \
  tools/qa/later-mission-checkpoint.test.ts
node --import tsx --test --test-name-pattern='strict checkpoint accepts' \
  tools/qa/additional-ordinary-profiles.test.ts
```

Retry: 21 distinct tests passed, zero failed/cancelled/skipped in the final runs
(15 existing simulation checkpoint tests, 1 profile checkpoint matrix, 5
later-mission tests). The two real-asset tests also passed in the earlier focused
run. The first non-isolated render run was cancelled with a pending-promise
diagnostic; the identical test passed twice in SIGINT-isolated child processes.
No source-native probe or complete balance suite was rerun; the established
38,160-impact proof is upstream evidence, not new proof from this checkpoint fix.
Strict TypeScript including unused locals/parameters passed for the changed
runtime and tests. Editor diagnostics were clean.

- Final test log: `/tmp/dc-later-retry-final-tests-20260922-r04.log` (20 tests).
- Focused profile/render log: `/tmp/dc-later-retry-render-isolated-20260922-r03.log` (3 tests).
- Final strict type log: `/tmp/dc-later-retry-types-isolated-20260922-r06.log`.
- First focused enum check: `/tmp/dc-later-retry-checkpoint-20260922-r01.log` (15 tests).
- Original source TRO/archive inventory: `/tmp/dc-later-handoff-20260922-c09.log`.
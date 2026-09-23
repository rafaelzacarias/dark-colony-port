# ALIEN02 Source Combat Provider

Date: 2026-09-21. Authenticated provider and explicit bounded runtime join;
no original mission admission.

## Source Contract

`createSourceNativeCombatProof(assets)` selects one of two pinned profiles by the
actual SCN digest. HUMAN02/TRSC/type0/weapon1 remains supported. ALIEN02 requires
GRAY FIN and SPR in the existing `troopFin`/`troopSprite` fields, plus exactly all
106 ANIM.DAT FIN files. Common EXE/table/registry hashes are unchanged.

| Original ALIEN Source | SHA-256 |
| --- | --- |
| ALIEN02.SCN | `d76d5901cb996a5dc2f3f72349ba0ec334b5b79a851ef519235a0c8eb5bec91e` |
| GRAY.FIN | `077887b708009109740a518bf8cff9c547a21145617dbf5dde575342fe5a641a` |
| GRAY.SPR | `95e71a6b19ecca1b77a9cba3b69b68f7b07b8fb927f99bcafdeba33030ebd620` |

Proofs are distinct deeply frozen WeakSet-authenticated identities. Copies and
serialization do not authenticate. All supplied private/shared byte buffers,
including the registry corpus, are detached before the first await. Task/host
composition retains its private immutable canonical configuration; mutation of
call-time configuration copies during hashing cannot change the result.
Both direct composition and task extension compare the complete parsed SCN,
not just matching unit upgrades. All44 ALIEN02 actors and all original bindings
remain present; non-type8 profiles are unchanged.

The selected original team is explicitly `localTeam: 0`; its SCN race gives
`policy: 1`, matching the native initializer. HUMAN uses policy0. ALIEN02 type8
has weapon level0 for all eight teams. Only weapon15 is admitted. ALIEN01's
different upgrades are not substituted; weapons16/17 remain outside this provider.
All source armor/upgrade bytes and 106 scalar rows remain source-derived.

## FIN And Geometry

- Type8 stand/move IDs remain the task provider's 17/18. FIREA/B use field IDs
  `0x100a0`/`0x100a4`, with both native raw72 frames and all32 delay banks.
- Reaction count is exactly6, with GRAYBLOODA/B/C/D/E/G at `bc..d0`.
  Missing F is not fabricated; H is not an extra admitted reaction bank.
- GRAY FIREB's empty-name/NONAME events are classified against all13 authenticated
  BOOM source records. They bind no BOOM effect/muzzle; their coordinates at
  raw72 `+12/+14` are retained, not zeroed. `unboundFinEvents` exposes those names.
  Other event dependencies reject. Render child pointers are still outside this
  combat projection, as in the existing native harness.
- Weapon15's actual WEAPSTAT prefix is uppercase `GRAY`. `GRAYBULLET0` exists in
  GRAY.FIN and binds travel bank `0x2000f`, all32 directions `[2]`. It is **not**
  a null-FIN weapon. `GRAYEXPLODE0` and `GRAYEXPL0` are source-proved absent across
  the complete registry; impact pointers/count remain source-initialized zero.
- Native stand FIN/SPR collision fields `48,4c,50,54,58,5c` are exactly
  `[-120,-96,96,360,0,-45]`. Native armor coefficients, MBULLET, BOOM0, RNG and
  every byte of the base weapon record match, after explicit pointer relocation.
- Type8 death banks are not bound. Requesting `death: true` rejects before
  composition; lethal projectile damage still rejects without partial mutation.

## APIs And Main Handoff

Existing function signatures are preserved. Additions/widenings:

| API | Change |
| --- | --- |
| `SourceNativeCombatProof` | `sourceType: 0 \| 8`, `weapon: 1 \| 15`; hash values widened to strings; added `localTeam`, `policy`, `bankFields`, `reactionFields`, `deathFields`, `unboundFinEvents` |
| `weaponFin.travelBank` | `number` rather than literal0; ALIEN has a real `projectileFin` entry |
| `SourceNativeCombatConfiguration` | Required `sourceType`, `weapon`; `policy: 0 \| 1`; geometry type array widened; additive scope `source-separated-type8-weapon15-nonlethal` |
| `sourceNativeTaskMatchesScenario` | Authenticated full-SCN comparison used by detached composition |

`createSourceNativeCombatOptions` returns frozen authenticated `nativeAiTasks`
and `nativeCombat`. `runtimeReady: true` means only this bounded direct-host
contract; proofs/fragments stay false. Host acquisition and projectile guards
read the explicit configuration type/weapon, not profile0 or a type0 alias.

The subsequent [bounded runtime join](source-native-combat-alien-runtime-20260921.md)
admits the explicit scope in the mission adapter and exports
`sourceNativeCombatBankFields(0 | 8)` for type-specific view FIN sampling.
Session/transport authentication and fifth-provider replay already accept the
configured type/weapon; no campaign-session or scheduler change was needed.
No HUMAN scope cast or full-SCN authentication bypass is used. The provider
work itself changed none of those runtime files; its owned continuity-test
configuration literal needed explicit `sourceType: 0` and `weapon: 1`.

## Evidence

[Provider tests](../tools/qa/source-native-combat-options.test.ts) compare all
admitted type8 bank frames and fields across six existing fire captures, three
base projectile captures and five damaged-actor captures. Existing HUMAN checks
remain. Both factions have private/SAB pre-await mutation tests.

[Composition and call tests](../tools/qa/source-native-combat-alien.test.ts)
construct the real full ALIEN02 world and both authenticated providers from
original assets. The positive original-executable boundary is a constructed
type8 opponent, not a naturally occurring SCN battle. One actual team0
registered shot launches weapon15, deals25 damage (HP800 to775), and reclaims
the projectile in one pass. All800 raw220 actor records, all80960 pool bytes,
statistics, heads, RNG and ground match; only explicit FIN pointers relocate.
No oracle data enters a runtime provider or authenticates configuration.

The [counter32 integration](type8-counter32-integration-20260922.md) now
authenticates814 original type8 scan points/17 sentinels. All24 subsequent native
damaged visits in this provider capture pass; truncated809/813 prefixes remain
rejected. The separate fresh ALIEN02 authenticated two-actor host replay reaches
400 with23 hits/HP225. General retaliating combat/mission continuity and full
session400 restore remain unproved. Unknown geometry (including type0
targets in this ALIEN configuration), weapons1/16/17 and lethal hits reject.

The cached damaged trace forces policy0 and therefore cannot prove the original
ALIEN policy1 hit. The new
[provider-only native probe](../tools/qa/source-native-combat-alien-native.py)
reuses the existing original-executable harness with that policy override removed.
The type8 target is made by the original constructor; its armor-level0 scanner
control equals the original source value. No HP rewrite or hit answer is seeded.

Capture and verification:

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 -B tools/qa/source-native-combat-alien-native.py > /tmp/alien-provider.jsonl
DC_SOURCE_NATIVE_ALIEN_COMBAT_TRACE=/tmp/alien-provider.jsonl \
  node --import tsx --test tools/qa/source-native-combat-alien.test.ts
```

Native capture: `/tmp/dc-al-provider-original-policy-20260921-a16.jsonl`.
16 provider tests: `/tmp/dc-al-provider-final-tests-20260921-a21.log`.
Two existing HUMAN host regressions: `/tmp/dc-al-provider-human-host-20260921-a22.log`.
Strict owned/app compile: `/tmp/dc-al-provider-final-types-20260921-a23.log`.
Final tools-project compile: `/tmp/dc-al-provider-tools-types-20260921-a24.log`.
The provider work used no agents, browser, full suite, package/assets changes or
session/transport/view edits. The linked runtime join has separate evidence.
Visible effects/audio, type8 death and whole-mission scheduling remain outside
the bounded contract.
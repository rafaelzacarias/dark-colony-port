# Bounded ALIEN02 Runtime Join

Date: 2026-09-21. Explicit source-separated caller, not original mission admission.

## Contract

- `SourceNativeCombatMission.sourceNativeCombat.scope` now admits exactly
  `source-separated-type8-weapon15-nonlethal` alongside the two existing HUMAN scopes.
  Scope relabelling and type8 death remain rejected.
- Existing `createSourceNativeCombatOptions`, `CampaignSession`, transport
  initialization/alignment, compact native view projection, and fifth-provider
  restore already accept the authenticated configured type8/weapon15/policy1.
  No campaign-session, selector, scheduler, native-view-projection interface, or
  MissionView implementation change was necessary.
- `sourceNativeCombatBankFields(sourceType: 0 | 8)` exports the provider's exact
  bank mapping. `sourceNativeCombatActorSample` and `nativeViewActorSample` now
  resolve GRAY stand/move17/18, FIREA/B `0x100a0/0x100a4`, and all six
  BLOODA/B/C/D/E/G banks. Type8 has no death mapping; HUMAN banks are unchanged.
- Transport errors now include the rejecting slot, type, and caller counter.
  Unsupported visits still roll back the complete transaction.

## Positive Runtime Evidence

[Fixture](../tools/qa/fixtures/native-combat-alien.ts) and
[tests](../tools/qa/source-native-combat-alien-session.test.ts) authenticate original
ALIEN02 SCN/MAP/MTG/PTH, GRAY FIN/SPR, complete registry, EXE and source tables.
All44 original actors, upgrades, teams, zero credits and full SCN are preserved.
Unsupported original actors remain unchanged and passive, not filtered out.

A separate full fresh visibility phase selects all41 eligible original producers,
excludes none, and computes452 explored cells from source. The existing shared
visibility factory already accepts this authenticated ALIEN world.

The bounded combat caller uses a separate QA trigger script, not the original TRO.
At counter16, genuine `reinforce2` constructors allocate team1 slot193 and team0
slot194, both type8/HP800. The actual source PTH supplies the clear same-family
corridor at55,34. A source visibility phase selects slot194, explicitly excluding
the other producers for this bounded battle. No visibility outputs are injected.

At17, the guarded native receipt API accepts team1 Move to54,34 and team0 Attack
toward57,34. Both are legal horizontal source paths. Every owned actor is visited;
there is no registered-slot filter, actor-frame injection, or upgrade rewrite.
At25, slot194 launches weapon15 with non-null travel FIN `0x2000f` and actual
`GRAYFIREB4` presentation. At26, one impact deals25 damage to slot193 (800->775)
and reclaims the projectile. All46 actors remain present.

MissionView's explicit `advanceNativeCombat` / `advanceNativeVisibility` APIs
match the direct session and project native HP/Q8 positions into simulation.
Generic simulation weapons, commands and damage do not run; wallclock adds no visits.
Fresh external task and fifth combat providers restore full visibility history,
prelaunch25 input boundary, active launch25 checkpoint, hit26 checkpoint and view
checkpoint exactly; replay from the prelaunch/launch states reproduces hit26.
All32 quantized headings compare generated GRAY FIN sampling with original FIN
for stand, move, both fire banks and six reactions. These isolated sampling tests
do not inject raw records into the positive session.

## Closed Boundaries

The [2026-09-22 integration](type8-counter32-integration-20260922.md) authenticates
the exact814-point type8 prefix; counter32 now succeeds. The all-owned runtime
continues through146 with8 hits/HP600 and exact fresh-provider checkpoint replay.
Counter147 rejects `unowned-native-idle-turn-payload` on original slot181/type2.
Session/view rollback and restored retry remain exact. The shared session schema
and transport gate do not admit nonlethal selected-slot scheduling; neither was
changed in this integration.

The [type8 owner proof](type8-damaged-continuation-20260921.md) and new authenticated
host replay both verify the separate two-actor schedule through400, including23
hits, HP225, all six reaction banks and natural idle-turn-wait. This is not a
full-session400/restore400 result. Host-only continuation reaches the natural
lethal guard at552; type8 death remains closed.

The higher-level semantic player-order helper still admits only type0; this
positive uses authenticated native receipts, including the explicit opponent
Move. It does not claim local-player UI parity. Other target geometry/weapons,
type8 death, visible projectile raster/audio and whole-mission scheduling remain
closed. No original TRO filtering, credits, default ALIEN02 admission or asset
changes were introduced.

## Verification

Six focused runtime/provider/HUMAN FIN-scope tests pass, with no skips:
`/tmp/dc-al-runtime-regressions-20260921-j09.log`.
Provider byte comparisons use the independent native capture
`/tmp/dc-al-provider-original-policy-20260921-a16.jsonl`, never runtime inputs.
Strict touched-slice compilation uses ES2022, ES2023/DOM libraries and noUnused.
No agents, browser, full suite, package changes or original campaign run.

```sh
DC_SOURCE_NATIVE_ALIEN_COMBAT_TRACE=/tmp/dc-al-provider-original-policy-20260921-a16.jsonl \
  node --import tsx --test \
  --test-name-pattern='^ALIEN|^native combat FIN|^native combat mission rejects' \
  tools/qa/source-native-combat-alien-session.test.ts \
  tools/qa/source-native-combat-alien.test.ts \
  tools/qa/mission-native-combat-death.test.ts
```
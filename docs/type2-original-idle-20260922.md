# Original ALIEN02 Type2 Idle

## Scope

[The reducer](../src/engine/legacy-ai-task.ts) now accepts type2 alongside 0/8
in the existing `1,4` / `1,4,3` idle-turn payload guard. All payload, type+dc,
auxiliary, FIN, occupancy, damage, fire and path guards remain unchanged.
No provider, transport, session implementation or ground-route owner was edited.
Type2 weapon7 firing is not admitted; its runtime profile has no `nativeFire`.

## Actual Source Path

Fresh original ALIEN02 SCN construction gives slot181/type2/team2, HP800,
Q8 position `(6272,5504)` (cell24,21), direction32, selected weapon7/range2,
teamControl4 and type+dc=0. No original actor receives a command or edited raw
state. The actual source constructors allocate type8 slots193/194 at the
existing corridor after the original actors' first16 visits.

At146, `0x4148b0` finds no target in weapon radius2 or area radius16
(`0x435570`, final source prefix index813). Shared RNG draws181/182 select
turn96 and push wait45. Entry147 is exactly:

```text
1:[65535,800,3] -> 4:[96] -> 3:[45,800]
```

The entry RNG is191 after intervening registered actors. Visit147 only
decrements the wait; it neither moves nor draws RNG. The wait pops at192.
Turns193..199 change direction32 ->42 ->52 ->62 ->72 ->82 ->92 ->96.
At199 the same registered callback returns to idle, scans radius2/16 with
no target, draws231, and pushes another wait45. Counters232/233 remain
ordinary wait visits. Slot181 never calls `0x414ce4`, `0x44492c` or
`0x441710` through400. There is no new ground-route work to duplicate here.

The source can pursue after a successful area search via `0x414c1b` calling
`0x414ce4`; that is not this positive trajectory. Synthetic negative target
controls still reject with `native-acquisition-path-owner-required`, or
`native-fire-owner-required` for a target in weapon range. They are explicitly
guard tests, not source-positive evidence or actor-position replacements.

## Verification

[The opt-in native probe](../tools/qa/native-type8-continuation-native.py)
uses `--owned-originals`. All44 originals remain present; all26 with existing
task ownership run in ascending slot order, sharing RNG with the two genuine
allocations. Other original service types remain outside this bounded caller.
There are416 prefix visits (1..16), then11136 actor/projectile phases (17..400).
Counter inputs explicitly set GAME+530 to1..400 for QA. This is not a claim
that the original global scheduler, native historical counter530 or full TRO
schedule has been reproduced.

[The replay](../tools/qa/native-type2-original-idle.test.ts) chains outputs,
compares all800 raw220 records, all2024 projectile records, ground, ordered
writes, shared RNG, task budget, pool heads/high-water and statistics. Prefix
original bytes and RNG join without rebasing. Air, extra and registry remain
unchanged per phase. Current passive profiles without combat tables also
match all original visits through400. Positive boundaries145..150 and malformed
payload/type/flags/damage plus fire/pursuit atomic rejection controls pass.
Final RNG132,23 hits, target HP225; original positions are not modified.

[The all-owned runtime/view test](../tools/qa/source-native-combat-alien-session.test.ts)
also reached400 with all44 originals plus two dynamic actors. The final stronger
acceptance test additionally requires23 hits/HP225, full JSON checkpoint400
restore with fresh providers, and exact continuation to the next hit416/HP200.
That final restore check passes (1 test, zero skips, 602.42s). Session and view
remain equal through400; fresh session restore and continuation remain equal
through416. No new blocker at232 or400 was observed. This bounded ALIEN
restore400 handoff is ready; it is not full original-mission admission.

Six native replay/guard tests pass with zero skips, including both existing
type8 ALIEN01/ALIEN02 continuations. No browser, full suite, packages, assets,
native window or agents were used. General weapons, pursuit/routing, original
full-mission admission and type8 death remain outside this change.

## Evidence

- Fresh native: `/tmp/dc-type2-owned-native-20260922-t05.jsonl`, SHA256
  `a50f92395be41dee89e776826f68993cd441bb92f233d75f1f4a41522caef63b`.
- Native replay/guards: `/tmp/dc-type2-final-native-20260922-t14.log` (6 pass).
- Runtime/view400: `/tmp/dc-type2-runtime-20260922-t08.log` (1 pass).
- Final restore acceptance: `/tmp/dc-type2-restore400-20260922-t13.log`.
- Strict/noUnused touched slice: `/tmp/dc-type2-types-final-20260922-t16.log`.
- Source branch disassembly: `/tmp/dc-type2-idle-disassembly-20260922-t06.log`.

Strict/noUnused exits0; editor diagnostics and both documentation files' local
links are clean. The isolated restore process completed with exit0; the unique
result files, not shared-terminal history, are the execution evidence.

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 -B tools/qa/native-type8-continuation-native.py --owned-originals --limit 400
DC_NATIVE_TYPE2_ORIGINAL_TRACE=/tmp/dc-type2-owned-native-20260922-t05.jsonl \
  node --import tsx --test tools/qa/native-type2-original-idle.test.ts
node --import tsx --test --test-name-pattern='^ALIEN runtime:' \
  tools/qa/source-native-combat-alien-session.test.ts
```
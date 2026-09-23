# Type8 Damaged Continuation

Provider follow-up: [counter32 integration](type8-counter32-integration-20260922.md)
now authenticates814 type8 points and verifies the bounded host through400.
The historical809-point runtime rejection below is superseded; the all-owned
session now stops at unrelated type2 slot181/counter147, not counter32.

## Owned Change

Only the ordinary idle-turn guard in `src/engine/legacy-ai-task.ts` changes:
type8 joins type0 when source type `+0xdc == 0`. The existing task shapes
`1,4` and `1,4,3`, saved HP, wait counts, direction, FIN, occupancy and damage
feedback checks remain enforced. No host or source-provider code changed.

## Counter32 Diagnosis

The original idle callback is `0x4148b0`. After direct weapon-range acquisition,
its wider scan at `0x414b79..0x414bd0` requests radius16 for a controlled team,
radius9 for a damaged local ground actor, otherwise radius4. This is not selected
by `GAME+0x53c`; that field remains the independent projectile damage policy1.
Native `0x435570` consumes the radius without clamping it.

The authenticated provider currently exports809 points from `0x434090`, ending
at the sixteenth sentinel: complete radii0..15. Native radius16 additionally
reads exactly these source entries, in order:

```text
index809: (16, 0)
index810: (0, 16)
index811: (0, -16)
index812: (-16, 0)
index813: (99, 99)
```

The new probe observes entry radius, maximum table index and returned target.
At counter32, the damaged team1 actor scans radius4 through index73 and radius16
through index813; both return-1. No pursuit or general navigation is needed for
this corridor. The scan reducer already computes this correctly when given the
complete source prefix. Appending guessed rings or returning early on a target
is neither necessary nor justified.

Integrator requirement: authenticate814 source points /17 sentinels in the
existing `LegacySourceCombatTables.scanOffsets` field. No new typed config field
or callback is needed for this bounded branch. Keep the original current actor
map, ground/air/extra planes, relations, city flags, damage tables and policy1.
Do not change team control, factions, flags, weapon range, or projectile scope.
The host/provider are deliberately untouched here; their809-point configuration
still rejects counter32 atomically. The existing runtime/restore test confirms it.

## Fresh Native Evidence

`tools/qa/native-type8-continuation-native.py` starts a new original ALIEN01 or
ALIEN02 SCN/MAP/MTG/PTH world, retaining all original actors, teams and upgrades.
It stops the existing constructor oracle before its first test allocation, then
uses original `0x41b750` dynamic allocations for team1 and team0 type8/HP800.
Each mission supplies its own actual empty same-family horizontal corridor;
ALIEN02 remains55,34, slots193/194. Original mode5/7 receipts command opponent
Move and local Attack. The bounded schedule visits both slots in registry order,
then executes the original projectile phase, every counter17..400.

Original terrain loading and visibility workers compute local producer visibility;
other eligible producers are explicitly excluded from this bounded phase, not
deleted or altered. All original actors remain passive and present. No actor
position, direction, health, task, damage flag, RNG cursor or team is injected.
Original GRAY FIN binding includes all six reaction banks. Collision geometry is
source FIN/SPR-derived for types0/8; this positive battle has two type8 participants.

Both missions produce23 actual launches and23 hits. First launch25/hit26;
subsequent launches42,59,...,399. Counter200 has already completed11 hits.
ALIEN02 ends at HP225/800; ALIEN01 retains its source armor selection and ends
at HP87/800. Native lookaround pushes `1,4,3` at366, continues through385,
and returns to ordinary idle/wait while repeated nonlethal fire continues.
Before the owner fix, the first subsequent type8 visit rejected at367.

The replay chains only reducer outputs, comparing all800 raw220 actors, all2024
projectile records, complete ground, ordered ground writes, pool heads/high-water,
statistics, task budget and shared RNG after every phase. Air, extra and registry
hashes are checked unchanged. Across both missions this covers2304 phases, with
no rebase onto intermediate native output. Damage `c8/c9` persist as1; pending
`c7`, secondary FIN busy/completion and subsequent reactions compare exactly.

Visible launch25 originally reached the sound initialization assertion at431c33.
The probe now executes original SOUND2/SLIST scanners and supplies initialized
sound/platform context. It preserves the fresh source-disabled byte1 and natural
exploration bit31, rather than clearing visibility or forcing playback. Only
DirectSound platform methods have boundary stubs. This is not audible playback
or a new type8 death-sound owner. Type8 lethal/death remains closed.

## Reproduction

Final independent captures:

- ALIEN02: `/tmp/dc-type8-al02-native-20260921-c30.jsonl`
- ALIEN01: `/tmp/dc-type8-al01-native-20260921-c24.jsonl`

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 -B tools/qa/native-type8-continuation-native.py \
  --mission ALIEN02 --limit 400 > /tmp/type8-al02.jsonl
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 -B tools/qa/native-type8-continuation-native.py \
  --mission ALIEN01 --limit 400 > /tmp/type8-al01.jsonl
DC_NATIVE_TYPE8_CONTINUATION_TRACE=/tmp/type8-al02.jsonl:/tmp/type8-al01.jsonl \
  node --import tsx --test tools/qa/native-type8-continuation.test.ts
```

Four new checks cover both complete native schedules and atomic negatives:
truncated809/813-point scans, invalid idle/turn/wait payloads, nonzero source+dc,
missing reaction FIN, inconsistent damage flags, lethal HP and stale raw receipts.
Ten existing damaged-actor/HUMAN idle-turn checks pass, with no skips
(`/tmp/dc-type8-regressions-20260921-c26.log`). Strict touched-slice TypeScript
compilation passes (`/tmp/dc-type8-types-result-20260921-c27.log`). The existing
ALIEN runtime launch/hit/rollback/fresh-provider-restore check passes
(`/tmp/dc-type8-hostguard-20260921-c29.log`).

This is a source-separated bounded owner proof, not whole-mission admission,
retaliating duel, default runtime continuation, general routing, or lethal support.
No agents, browser, full suite, packages, assets, host or provider edits.
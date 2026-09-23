# Bounded native lethal death owner

Pure owner only. Host, session, MissionView and source provider are unchanged.
No original-mission, visible-audio or host battle admission. The bounded captured
continuation now chains TypeScript state without prelethal native rebasing.

## APIs

- [legacy-native-death.ts](../src/engine/legacy-native-death.ts): `beginLegacyNativeDeath`, `reduceLegacyNativeDeathVisit`, `LegacyNativeDeathFrame`, `LegacyNativeDeathState`, `LegacyNativeDeathResult`.
- [legacy-native-projectiles.ts](../src/engine/legacy-native-projectiles.ts): `reduceLegacyNativeProjectiles` accepts optional `death: { counter, state }`. Without it, lethal impacts still return `native-projectile-death-owner-required`.
- [native-death-native.py](../tools/qa/native-death-native.py): original x86 probe, no OS window; reuses the projectile/damaged-actor source constructor, collision geometry and FIN setup.
- [legacy-native-death.test.ts](../tools/qa/legacy-native-death.test.ts): continuous TypeScript-owned prelethal/death state, exact native comparisons, atomic rejection and monotonic removal.

`beginLegacyNativeDeath` consumes the **pre-damage** actor buffers and positive, already computed native damage. The projectile reducer invokes it inside its private staged pass. Do not also subtract HP or count the kill in the caller. Unsupported results publish only a diagnostic, never partial state.

`reduceLegacyNativeDeathVisit` consumes the next actual registered visit, not an elapsed-time estimate. Its `counter` must exceed that victim's last committed counter. Gaps advance one visit, not several. Counter wrap, duplicate/reversed visits and already removed actors reject.

## Bounded Envelope

Both killer and victim are source type 0, weapon 1, opposing teams 0..7, mobile slots 152..799. Victim is on the ground, registered, alive before impact, with idle or idle/wait stack and exactly one ground occupancy at its current cell. Native BOOM0 and the existing projectile profile guards remain in force. Source armor, geometry, policy and weapon tables determine damage; no special HP override is used.

Type 0 has `type+100 == 0`, `type+60 == 0`, three death variants at `type+ac/b0/b4`, and seven reaction variants at `type+bc..d4`. Every FIN bank requires all 32 original direction delay arrays. The registered preamble advances primary, reaction and third animation using the existing native FIN helper and quantized actor heading.

At lethal admission, explicitly rejected: type 8 and other victims, active movement/fire/turn stacks, multiple/reserved victim occupancies, aircraft, other weapons, nonzero special/inspire state, persistent death branch `type+100`, killer commander binding, and visible death without the explicit source sound contract below. There is no dummy callback and no suppression of an admitted effect.

## Visible Death Sound

This section adds a **pure owner opt-in**, not host/session/view admission or full
playback. Existing nonvisible death inputs need no new fields. The initial
no-visible-audio-admission statement still applies to normal mission playback.

Original mobile type-0 lethal call order is `0x441930 -> 0x416308 -> 0x434d48 ->
0x431da8 -> 0x431bf4`. The sound is emitted by occupancy release at `0x434db3`,
before freeing the ground cell, not by the first task10 visit. The separate sound
call inside `0x416308` is for slots below 120 (buildings), outside this envelope.
The first ordinary task10 visit still consumes its original death-FIN draw.
No type-8, commander-statistics, aircraft or other death profile was widened.

`0x431da8` tests the actual actor Q8 position against map bounds and cell bit31.
`0x431bf4` uses category `0`, event `3` (`DEA`), positional flag `1`. The native
13-byte descriptor is at `0x4cbc54 + category*104 + event*13` (type0 DEA:
`0x4cbc7b`): byte0 count, byte1 current selection, byte2 preserved, bytes3..12
sound IDs. Original SLIST startup yields `[4,0,0,28,90,153,154,0,0,0,0,0,0]`.
The current byte1 selects **this** sound; it is not a newly sampled index.

After the native sound engine returns, `0x431d89` calls CRT `0x44e22d` and stores
the next index at descriptor+1. This is **not** the native combat/AI table RNG:
`seed = (seed*0x41c64e6d + 0x3039) mod 2^32`, value `(seed >>> 16) & 0x7fff`,
next index `value % 4`. The actual CRT accessor is `0x44e223 -> [0x489118] ->
0x45a7a6`, returning `[0x516a94]+12`. No timer or unowned RNG call occurs in the
captured path. The shared combat cursor `0x479204` does not advance at lethal
sound dispatch; its first following task10 draw still matches natively.

Source spatial arithmetic is signed 32-bit wrapping subtraction/multiplication:
`volume = -((dx*dx + dy*dy) >> 17)`; reject dispatch only if volume `< -8000`.
Pan equals volume when listener.x > actor.x, otherwise its negation. Preserve
native overflow behavior, not floating-point distance. Disabled audio, hidden
cells and out-of-range distance produce no request and no audio RNG advance.
An uninitialized audio engine remains rejected even when disabled.

### Additive Contract

Import types from [legacy-native-death.ts](../src/engine/legacy-native-death.ts).
The direct owner accepts `frame.sound`; projectiles accept `frame.death.sound`:

| Input field | Required source value |
| --- | --- |
| `configuration.executableSha256` | Original EXE hash listed below |
| `configuration.soundTableSha256` | `03b820482ca43f79dda0db4702c1db5dae333b0ca423bd8dd211607a60fe5922` |
| `configuration.bindingsSha256` | `8edca1e2e26e741a8d73a4e7987d51569d62a75d90038e59e19b155d240ec0cc` |
| `configuration.categoryCount` | Original `0x4f98d4 == 106` |
| `configuration.sounds` | Ordered original SOUND2 rows 28,90,153,154 as `{id,source,parameters}` |
| `state.descriptor` | Current full 13-byte type0 DEA descriptor; byte1 must be 0..3, all other source bytes exact |
| `state.randomSeed` | Current unsigned CRT state at `[0x516a94]+12`, shared with every consumer of this CRT stream |
| `initialized`, `disabled` | Booleans from `0x47963d`, `0x47963c`; initialized must be true |
| `listener.{x,y}` | Actual signed dwords `[0x4d1994]+0x108/+0x110` in native Q8 units |

The four normalized source paths are `SOUND/TROPDEA3.WAV`, `SOUND/TROPDEA2.WAV`,
`SOUND/TROPDEA.WAV`, `SOUND/TROPDEA1.WAV`; all have SOUND2 parameters `[2,1,0,0]`.
Use the existing [audio/cues.ts](../src/audio/cues.ts) `createCueCatalog` and
`resolveAudioCandidates`/`resolveAudioAsset` APIs for source parsing and preload.
The requested `native-source-audio` module/API was not present in this checkout;
none was invented or modified. The request's `{id,x,y}` is compatible with the
existing native-fire sound descriptor, with the exact source row added.

Supported direct death results add `soundRequests` and optional `soundState`.
Supported projectile results add top-level `soundRequests` and optional
`death.soundState`. Every request is `{id,x,y,slot,category:0,event:3,volume,pan,
source:{id,source,parameters}}`. These are the arguments selected before native
`0x430f50`; volume `1`, if reached, is its source-default-volume sentinel. The
returned state already contains the **post-dispatch next selection/CRT seed**.
Registered death visits return no sound requests and preserve supplied audio
state; they never replay the lethal sound. Calls without sound input preserve
the old nonvisible behavior, with an empty additive `soundRequests` array.

The external source provider must authenticate actual source bytes and current
state; supplied hash strings alone are not provenance. This pure reducer pins
the known hashes and checks every supplied row/descriptor value, but does not
authenticate a mission's history. Missing visible sound config returns
`native-death-visible-sound-owner-required`; malformed source/config/state
returns `invalid-native-death-source-sound`, without exposing partial state.

Host handoff: preload those four original sounds, pass authenticated config plus
current descriptor/CRT seed/listener/flags, and commit returned sound state with
actors, pool, both statistics tables, planes, death metadata and combat RNG.
Queue requests in original order and dispatch **only after the encompassing
transaction commits**. Journal/replay both audio state and requests, including
suppressed branches; never reseed on each death, sample again in playback, use
combat RNG for audio, or silently discard an unpreloaded request. Any other
consumer of `0x44e22d` or this descriptor needs the same ordered state owner.
The reducer itself does not authenticate host history. The optional
[host/provider/session integration](source-native-combat-host.md#visible-death-sound)
now authenticates source bytes, accepts only explicit caller-boundary audio
state, commits separate CRT/descriptor state and journals postcommit
`native-death-sound` requests. It does not claim original mission audio startup,
natural bit31 visibility, browser playback or a MissionView callback.

### Native Sound Evidence

[native-death-sound-native.py](../tools/qa/native-death-sound-native.py) uses fresh
source constructors and real repeated shots to reach HP25 before lethal counter
528, with **no HP rewrite**. It executes original SLIST row decoding
`0x431237..0x4314ee` and original SOUND2 scanning `0x430830..0x430905` for the four
source rows. It retains existing constructor/FIN/geometry fixture loaders and
their source-file adapters; these are initialization accommodations, not a full
OS/game startup claim. Audio initialized/enabled flags, listener, CRT thread
storage, `srand` seed and DirectSound object pointers are explicit fixture
inputs. Native `srand`, `rand`, descriptor lookup and sound engine run unchanged.

**Visibility is a labeled controlled bit31 fixture, NOT normal mission camera or
visibility-update evidence.** The original ground cell changes from
`536871085` to `2684354733`, and retains bit31 through native occupancy release.
Neither the reducer nor probe clears visibility to avoid sound ownership.

The original `[audio-vtable+0x80]` points to and executes `0x430f50`. Runtime
interceptions are ONLY the four DirectSoundBuffer platform methods: `GetStatus`
at fixture `0x708600` reports an available buffer; `SetVolume` `0x708610`,
`SetPan` `0x708620` and `Play` `0x708630` report success. No death handler, sound
selection, CRT accessor, RNG or timer is stubbed. There is no actual device
playback claim. The first death selects 28, seed1 becomes1103527590, descriptor
index becomes2, while combat cursor stays127; the next task10 visit advances
combat cursor to128 independently.

The 15-case matrix uses original selector warmups (not forced descriptor indices)
and covers all four sounds, CRT wrap, both pan signs, mute, distance rejection,
visibility gating, threshold neighbors and signed-distance overflow. Each case
compares all800 raw actors, all2024 projectile records/heads/high-water, both
statistics tables, registry/commander slots, all three planes, ordered combat
RNG writes, descriptor/CRT state, optional dispatched requests, platform calls
and the next registered death visit. Game-block deltas are checked for unowned
writes. Additional tests chain prior TS sound results and reject malformed
source/descriptor inputs atomically; an explicit malformed impact-FIN control
rejects after staged sound selection without publishing any request or state.

Final oracle: `/tmp/dc-death-sound-platform-20260919-a19.json`.
Focused tests: 21 pass (`/tmp/dc-death-sound-platform-tests-20260919-a20.log`).
Cached nonvisible goldens: 7 pass, 1 preexisting overkill nested-turn skip
(`/tmp/dc-death-sound-cached-isolated-20260919-a13.log`). Existing projectile
tests: 35 pass (`/tmp/dc-death-sound-projectiles-20260919-a14.log`). No browser,
agents, full suite, package, assets, host, session, view or provider edits.
Final scoped strict TypeScript check has no errors in the owned files, but its
transitive dependency check is blocked by the concurrent `transport-host.ts:500`
`nativeCombat.configuration` possibly-undefined error; see
`/tmp/dc-death-sound-final-types-20260919-a23.log`. This is not a passing final
typecheck and the host was deliberately left unchanged.

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 python3 -B tools/qa/native-death-sound-native.py > /tmp/death-sound-native.json
DC_NATIVE_DEATH_SOUND_TRACE=/tmp/death-sound-native.json node --import tsx --test tools/qa/legacy-native-death-sound.test.ts
```

The live registered reducer additionally admits only canonical type-0 idle/turn
stacks `1,4` and `1,4,3`, with source `type+dc == 0`. Existing span decoding fixes
their offsets at 0/3[/4] and lengths at 3/1[/2]. Idle payload must be
`[65535, savedHP, waits]`, with savedHP 1..32767 and waits 1..3; the turn target
must be 0..255. An optional wait must retain that same savedHP and a countdown
0..15 (waits 1/2) or 0..45 (waits 3). Current HP may differ after a real hit.
Other types, task arrangements and malformed payloads are not newly admitted;
all existing FIN, occupancy, auxiliary, combat and projectile guards remain.

No task handler changed: wait runs above turn, its zero-entry pop ends that
visit, and HP/pending-order interruption pops and redispatches. Turn completion
pops and redispatches idle in the same visit. The base native capture proves
16 nested waits beginning at counter 343 and the exposed turn at 359, including
HP changing from 275 to 250 before that turn. Invalid inputs return only a
diagnostic with raw actors, all world data, pool, ground and RNG input unchanged.

## Exact State

The external provider must export original source values, not fixture defaults:

| Contract field | Native source | Ownership |
| --- | --- | --- |
| `actors` | `game+7d28`, 800 records of 220 bytes | Full staged raw actor pool |
| `statistics` / projectile `statistics` | `0x4956e0`, 8 x 12 signed dwords | Shared team accounting, not a second death ledger |
| `state.typeStatistics` | `0x495860`, 10 x 110 x 4 signed dwords | Source per-team/per-type classes |
| `state.registry` | `game+468ec`, 800 signed words | Each slot is itself or -1 |
| `state.commanderSlots` | signed word `game+team*e30+1934`, 8 teams | Must be -1 for the killer in this cohort |
| `state.pending` | Host bookkeeping tied to raw task10 payload | `slot`, `startedAt`, `lastCounter`, `visits`; no replacement for native registry |
| `counter` | `game+530` | Actual caller frame counter |
| `rngCursor`, `tables.randomTable` | `0x479204`, `0x478e04[256]` | Same preincrement/wrap stream as fire, damage and AI |
| `world.ground/air/extra` | Original map occupancy planes | Full planes, flags preserved |
| `tables.typeTable`, `tables.fin` | Original normalized GAMESTAT/FIN bindings | Real geometry, relocated bank identity and direction delays |

Native `0x441930` applies HP subtraction (including negative overkill), the existing c7 arithmetic and c8/c9 latches. For differing teams it adds one to killer team class 2 and killer **source type** class 3. Victim team class 3 and victim type class 0 each gain one. All additions are signed-dword wrapping. Other accounting cells are preserved. The nearby-commander class 11 branch stays closed rather than omitted.

`0x416308` resets the stack header to task10, two zero words at actor+46/+48, status+2c=10, clears +13 and the victim team bit of +12. It preserves unused stack storage and pending-command bytes. `0x434d48` frees the one owned ground cell by OR-ing its low word with 1023, preserving all other cell flags. Registry is **not** cleared at impact.

On the first registered task10 visit (`0x416460`), the ordinary `0x419248` preamble runs first, including any pending reaction RNG. Then one shared RNG draw selects `type+ac+(random%3)*4` and resets primary FIN to mode 1 only if bank/mode changed. Each visit increments the word at actor+46. FIN completion does **not** free the actor. Exactly visit 150 writes status+2c=0 and `registry[slot]=-1` (`0x416532/0x416536`). There is no separate mobile actor free-list write in these source visits. Allocation/reuse of that registry slot belongs to a future allocator join.

The projectile pool's actual 2024 x 40 records, high-water, free/active heads and statistics remain under the existing projectile reducer. Lethal impact reclaims the ordinary weapon1 projectile through that same native path; death does not invent another free-list.

## Integration Handoff

1. Authenticate/reconstruct the original source type/weapon/BOOM/damage tables, real collision geometry, all required FIN timelines and shared RNG. Supply actual registry, type counters, commander links and current planes. No guessed banks, zero-filled counters or fake callbacks.
2. Supply `death.counter` only at the real after-actor-visits projectile phase. Initialize `pending: []` only for a fresh world without in-progress owned deaths. Restore pending metadata through authenticated caller replay, not by trusting a save's counter.
3. On supported travel, atomically publish `actors`, `projectiles` (including shared statistics), `rngCursor` and `death.{state,ground,air,extra}`. Any later failure in the encompassing frame must roll everything back.
4. Route each subsequently registered status10 actor to `reduceLegacyNativeDeathVisit` in the actual scheduler order. Commit its raw pool, registry, statistics, planes, RNG and pending state together. Keep visiting after animation completion until `removed` names the slot. Do not schedule it after removal.
5. Rebind current actor tables for collision/acquisition and journal/replay every caller boundary before enabling host admission. The current host provides no `death` field and continues rejecting lethal damage.

## Original Evidence

EXE SHA-256: `65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.

Fresh constructor HP is 800 in both positive runs. No actor HP writes, handler interception or result substitution are installed by the probe. Runtime hooks only observe code entries and memory writes. Source initialization uses the existing FIN/geometry loader accommodations. The first source shot precedes the recorded continuation; all later shots use real registered source visits and original travel. Once status10 is reached, the fixture stops visiting the killer and records the victim's real registered death visits plus empty projectile passes; this is a bounded caller schedule, not a whole-world scheduler claim.

| Trace under /tmp | Hits | Lethal counter / HP | Removal | Continuation phases |
| --- | --- | --- | --- | --- |
| `dc-death-complete-20260919-222344.json` | 32 x 25 | 528 / 0 | 678 | 1880 |
| `dc-death-overkill-20260919-222804.json` | 45 x 18 | 749 / -10 | 899 | 2543 |

Trace SHA-256 respectively:

- `5067ab4d39057c55c28f6aa9d1ed10e89209a3a92b7d8562a1f76c88e4c57b78`
- `34f86138b90dd5c3c09d6fe9a5010d343836277d25f1d8cfc6d2f1c3dab8b604`

Both runs compare all 800 actors, full projectile pool/heads/high-water, both statistics tables, all occupancy planes, registry, commander slots and shared RNG after every phase. Ordered RNG writes also match. All 150 death visits per run match, including original FIN completion before removal. Overkill also produces a later pending reaction RNG draw. The test checks every game-block delta against the owned actor/pool/registry/counter ranges; unrelated native game state is unchanged.

The former prelethal discontinuity is closed. Only the initial recorded snapshot
seeds TypeScript: HP 775 or 782 after the first original real hit. The next 31
or 44 launches and impacts, shooter and target animation, shared projectile
pool/RNG, lethal transaction and all 150 death visits consume only prior
TypeScript results. Native snapshots are advanced separately for comparison,
never installed as continuation inputs. The tests assert 32/45 total real hits
and shots including the original first shot, 1880/2543 phases, exact lethal HP
0/-10 and removal counters 678/899. This is a continuous proof from the captured
first-hit boundary, not a TypeScript replay of the unrecorded constructor/first
shot or a whole-world scheduler claim.

Verification: 4 base checks and 3 overkill checks pass; the nested-turn negative
test is skipped for overkill because that capture contains no nested turn.
The base test checks 13 malformed/unowned inputs with full input immutability.
All 129 captured neighbors pass: 85 registered movement, 9 damaged-actor and
35 nonlethal projectile checks using the repaired valid-reuse oracle. Strict
ES2022 scoped TypeScript and editor diagnostics pass. Only the task reducer,
death test and this document changed; no full suite, browser or subagents.

Reproduce from the workspace root:

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 python3 -B tools/qa/native-death-native.py > /tmp/dc-death-$(date +%Y%m%d-%H%M%S).json
DC_NATIVE_DEATH_TRACE=/tmp/dc-death-complete-20260919-222344.json node --import tsx --test tools/qa/legacy-native-death.test.ts
DC_NATIVE_DEATH_TRACE=/tmp/dc-death-overkill-20260919-222804.json node --import tsx --test tools/qa/legacy-native-death.test.ts
DC_NATIVE_ACTOR_MOVEMENT_TRACE=/tmp/dc-ai-task-movement-20260919-g1.jsonl DC_NATIVE_DAMAGED_ACTOR_TRACE=/tmp/dc-damaged-native-r4-20260919-1941.jsonl DC_NATIVE_PROJECTILE_TRACE=/tmp/dc-native-projectile-validreuse-20260919-Rxsh1I node --import tsx --test tools/qa/legacy-ai-task-movement.test.ts tools/qa/native-damaged-actor.test.ts tools/qa/legacy-native-projectiles.test.ts
npx tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --lib ES2023,DOM src/engine/legacy-ai-task.ts tools/qa/legacy-native-death.test.ts
```

For a fresh overkill oracle add `--warmup 253 --policy 1`. Omit `DC_NATIVE_DEATH_TRACE` to generate a fresh base oracle in the test. Continuous-chain evidence logs: `/tmp/dc-prelethal-chain-base-20260919-02.log`, `/tmp/dc-prelethal-chain-overkill-20260919-02.log`, `/tmp/dc-prelethal-neighbors-20260919-03.log`, `/tmp/dc-prelethal-types-20260919-03.log`.
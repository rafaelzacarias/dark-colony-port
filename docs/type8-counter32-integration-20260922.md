# Type8 Counter32 Integration

## Source Prefix

[The provider](../src/engine/source-native-combat-options.ts) now reads the exact
profile-specific packed dword prefix from authenticated DC.EXE address `0x434090`.
Type0 stays at809 points/16 sentinels, radii0..15. Type8 uses814 points/17
sentinels, radii0..16. Index0 is `(0,0)`; the additional source words are:

| Index | Dword | Signed coordinates |
| --- | --- | --- |
| 809 | `0x00000010` | `(16,0)` |
| 810 | `0x00100000` | `(0,16)` |
| 811 | `0xfff00000` | `(0,-16)` |
| 812 | `0x0000fff0` | `(-16,0)` |
| 813 | `0x00630063` | `(99,99)` |

The following dword is not part of this prefix. No ring extension, radius
clamping, synthetic coordinate or callback was added. The provider verifies the
sentinel count and terminal sentinel. Source type8, weapon15, policy1, original
SCN upgrades, current actor lookup, planes, damage and relations remain unchanged.
The existing combat host already forwards `scanOffsets`; no host change was needed.

[Counter32 tests](../tools/qa/native-type8-continuation.test.ts) compare the entire
authenticated prefix to native input, reject809/813-point truncations, and reject
radius17. Lookup stops at the required sentinel without reading an invalid suffix.
A radius4 lookup that has already found a real target still rejects if its final
sentinel is missing. HUMAN's809-point prefix is explicitly checked unchanged.

## Verified Continuation

[Authenticated host replay](../tools/qa/source-native-combat-type8-continuation.test.ts)
starts from the original ALIEN02 two-actor native boundary and chains outputs,
never rebasing onto intermediate oracle state. All1152 phases through400 compare
all800 raw220 actors, all2024 projectile records, ground, ordered writes, shared
RNG, budget, heads/high-water and statistics. Original actors remain passive and
present. Source-computed visibility is retained; no visibility output is injected.

There are23 launches/hits: launch25/hit26, then same-tick launch/hit42,59,...,399.
Target HP at400 is225 (`800 - 23*25`); 11 hits have completed by200. Actual GRAY
sampling at200 resolves target `GRAYSTAND12` + `GRAYBLOODD0` and source
`GRAYFIREA4`. Natural idle-turn-wait spans366..385, including the previously
blocked367 visit. No missing FIN binding was observed or added.

Further chained host outputs produce hits416,433,...,535, reaching HP25. The
next projectile phase at552 rejects `native-projectile-death-owner-required`
without mutating its inputs. This suffix is a reducer/host continuation check,
not additional native-oracle coverage or a full-session checkpoint restore.

## Runtime Limit

The historical147 blocker below is superseded by the
[original type2 idle follow-up](type2-original-idle-20260922.md). Its narrow
reducer change now permits the all-owned runtime/view to reach400; the follow-up
records native proof, scope and passing fresh-provider restore400 followed by
the next hit416/HP200. All44 originals and both genuine allocations remain.

[The existing runtime/view test](../tools/qa/source-native-combat-alien-session.test.ts)
retains all44 original actors plus two genuine allocations, the actual corridor,
native receipts and source visibility. Counter32 now succeeds. Its all-owned
schedule reaches146 with8 hits/HP600, exact fresh-provider full checkpoint replay,
and native GRAY projection. Counter147 rejects original slot181/type2's
`unowned-native-idle-turn-payload`; session/view rollback and restored retry agree.

This all-owned schedule is not the native proof's two-actor schedule: other
owned originals also consume shared RNG. A requested nonlethal `registeredSlots`
input is rejected by session validation (`Checkpoint unknown field`); the transport
gate also currently requires lethal ownership. Both files are outside this task's
assigned ownership, so neither gate was changed. Type2 behavior was not muted or
extended. Consequently full-session400, fresh-provider restore400 and its next
shot are **not verified**. The host400 proof must not be presented as that result.

Original ALIEN02 admission remains closed: original AI/TRO/full-service ordering,
general routing, other geometry/weapons, type8 death and visible raster/audio
remain outside this bounded proof. No loader, registered-host or legacy-ai-task
changes; no agents, browser, full suite, packages or assets.

## Evidence

Existing fresh-native captures were reused, not regenerated in this integration:

- ALIEN02: `/tmp/dc-type8-al02-native-20260921-c30.jsonl`, SHA256
  `6b0da6d759251d71d04282493edc7e36dec32740fceebe905e2c3545163fc6e3`.
- ALIEN01: `/tmp/dc-type8-al01-native-20260921-c24.jsonl`, SHA256
  `0fad59ed39429845a210b7c51030c56cb2ac0adf616945c65163bca762665e9a`.
- Earlier policy1 provider capture: `/tmp/dc-al-provider-original-policy-20260921-a16.jsonl`,
  SHA256 `a64de1dbab3d1abc639e737a89fd25719e22caf93ef8d04260b6a29bda26cc8c`.

Eight replay/provider/guard tests pass, zero skips, in23.54s:
`/tmp/dc-type8-integration-final-replays-20260922-i11.log`.
This includes both native missions through400 (23 hits each; HP225/87),
the authenticated host replay/continuation, and all24 formerly blocked provider
reaction visits. The two runtime/FIN tests pass in243.69s:
`/tmp/dc-type8-integration-runtime-boundary-20260922-i07.log`.
Strict touched-slice TypeScript/noUnused passes in1.41s:
`/tmp/dc-type8-integration-types-final-20260922-i13.log`.

```sh
DC_NATIVE_TYPE8_CONTINUATION_TRACE=/tmp/dc-type8-al02-native-20260921-c30.jsonl:/tmp/dc-type8-al01-native-20260921-c24.jsonl \
DC_SOURCE_NATIVE_ALIEN_COMBAT_TRACE=/tmp/dc-al-provider-original-policy-20260921-a16.jsonl \
  node --import tsx --test tools/qa/native-type8-continuation.test.ts \
  tools/qa/source-native-combat-type8-continuation.test.ts tools/qa/source-native-combat-alien.test.ts
node --import tsx --test tools/qa/source-native-combat-alien-session.test.ts
```
# Source Native Combat Proof: HUMAN02 And ALIEN02

## Status

2026-09-21: the same factory also authenticates a separate ALIEN02/type8/weapon15
profile from GRAY FIN/SPR and the complete original registry. See the
[ALIEN provider contract and main handoff](source-native-combat-alien.md).
The type0 details below remain the HUMAN contract; ALIEN host/session admission
is not implied by provider `runtimeReady`.

The standalone proof and detached fragment retain `runtimeReady: false`.
They now feed an actual [bounded combat host/session](source-native-combat-host.md)
whose authenticated `runtimeReady: true` scope is type 0 / weapon 1 nonlethal
combat only. No runtime tables are imported from native traces; storage padding
is not claimed as source evidence. Original mission admission remains closed.

The original proof slice owned only these files:

- [source-native-combat-options.ts](../src/engine/source-native-combat-options.ts)
- [source-native-combat-options.test.ts](../tools/qa/source-native-combat-options.test.ts)
- [source-native-combat-options.md](source-native-combat-options.md)

Its unchanged-host/reducer/factory/assets/packages statement was slice-local,
not a current claim that damaged ownership is absent. The earlier blanket
next-visit `c7..cc` blocker is superseded: the separate
[damaged actor owner](native-damaged-actor.md) implements ordinary type-0/8
nonlethal continuation, with 332 registered visits (224 target, 108 shooter)
and 14 projectile passes across eight cases. The provider now emits all seven
type-0 reaction banks; the bounded host/session consumes them without clearing
unsupported feedback bytes. Type8 now has authenticated source geometry and six
reaction banks; its first damaged idle visit in the new provider capture reaches
the existing bounded acquisition handoff rather than completing a registered visit.

## API

`createSourceNativeCombatProof(assets)` privately copies nine original byte
sources plus the complete listed FIN corpus before its first await, including
SharedArrayBuffer-backed inputs. It then authenticates and parses those same
detached snapshots using fixed SHA-256 digests. This fixes the reviewed TOCTOU
gap between source authentication and consumption:

| Asset Field | Original Source |
| --- | --- |
| `executable` | `raw_cd/DC/DC.EXE` |
| `gameStat` | `raw_cd/DC/GAMESTAT/GAMESTAT.TXT` |
| `weaponStat` | `raw_cd/DC/GAMESTAT/WEAPSTAT.TXT` |
| `boomStat` | `raw_cd/DC/GAMESTAT/BOOMSTAT.TXT` |
| `damageMatrix` | `raw_cd/DC/GAMESTAT/MBULLET.TXT` |
| `scenario` | `raw_cd/DC/SCENARIO/HUMAN/HUMAN02.SCN` |
| `troopFin` | `raw_cd/DC/ANIMATE/TRSC.FIN` |
| `troopSprite` | `raw_cd/DC/SPRITES/TRSC.SPR` |
| `animationRegistry` | `raw_cd/DC/ANIM.DAT` |
| `registryFins` | All 106 ANIM.DAT entries under `raw_cd/DC/ANIMATE/`, keyed by uppercase filename including `.FIN` |

Missing, empty or changed sources reject. Existing table, scenario, FIN, SPR,
upgrade and duration parser APIs are reused. FIN/SPR extraction currently needs
the parsers' Node `Buffer` environment; browser creation is not certified.

ANIM.DAT SHA-256 is
`20e9cf988ed833236ca0687601ab32a2adeaae0d885b39a7507321166bdba3d0`.
The complete FIN corpus SHA-256 is
`a493030cf9233546fed0d2d1dcd6e25dec50394961d3fea656cdb0c5aec9c433`.
Its deterministic input concatenates, in ANIM.DAT order, each uppercase filename,
NUL, ASCII decimal byte length, NUL, and the original file bytes. Length framing
binds bytes to filenames; object insertion order is irrelevant. Extra, renamed,
missing, empty and substituted registry entries reject. This is a fixed corpus
digest, not a digest supplied by the caller or copied from a native trace.
All 106 authentic FINs are accepted by the existing `parseFin` utility. Unsupported
formats are never skipped to manufacture absence. No decoded JSON is trusted.

`isAuthenticatedSourceNativeCombatProof(value)` recognizes only the deeply
frozen object issued in the current process. Serialized, structured-cloned or
forged proofs are not authenticated. Recreate a proof from original bytes after
restore; this is provenance checking, not an in-process security sandbox.

`composeSourceNativeCombatProof({ configuration, proof, team })` requires a
genuine authenticated task-factory configuration and proof with the same complete
SCN, the proof's source type, and a team whose original selected weapon level is
zero (weapon1 or weapon15). It verifies all owned
scalar fields, all eight teams' original weapon/armor levels, the RNG table and
both stand/move banks against the task profile before returning:

- `kind: "source-native-combat-fragment-v1"`, `runtimeReady: false`;
- the task `sourceId`, selected `team`, detached `typeBytes`, and source `proof`.

The fragment applies normalized armor, collision fields, attack and reaction banks to a
copy of the task type record. Neither the input configuration nor world/actors
are mutated. Composition proves agreement of these source projections, not a
new whole-world attestation. Replacing a task configuration's type bytes with
the fragment does **not** retain task authentication or grant combat admission.

## Verified Projection

The host follow-up additionally exports the complete parsed SCN, 106 scalar
rows with scenario levels and exclusion flags, observer-row relations, and809
native scan offsets for type0 (16 static rings). Type8 now uses the exact814-point
source prefix/17 sentinels; see [counter32 integration](type8-counter32-integration-20260922.md).
See the host document for guarded reads
and remaining unproved fields. Seven TRSCBLOODA..G banks bind `bc..d4`, with
reaction count `d8=7`; their timelines match the supplied damaged-actor trace.

- GAMESTAT type-0 scalar fields at `04,08,0c,10,14,18,1c,20,40,44`.
- Complete normalized weapon-1 `weaponBytes` (72 bytes), with `weaponFields`
  covering every four-byte slot. Field `18` uses original `43b935..43b952`
  lifetime arithmetic; `28` and `44` are byte-valued source writes. FIN pointers
  and variant count now follow the source-proved registry resolution below.
- Original HUMAN02 type-0 weapon/armor levels for all eight teams, using
  `sourceScenarioUpgradeLevels`; no scanner-controlled upgrade trace is used
  as a runtime source.
- Armor `24..2c`: base 256 and truncated `25600 / sourcePercentage`, matching
  `43bd46..43bd89`.
- Collision fields `48,4c,50,54,58,5c`: all 32 stand directions, FIN children
  and authentic TRSC SPR frame headers, including native ground minimum bounds.
  Native `43635c` takes the later rectangle's right edge, not a conventional
  maximum; the projection preserves that behavior. The auxiliary `5c` uses the
  pre-clamp bottom. Missing/foreign SPR dependencies and empty geometry reject.
- All 32 raw72 combat frames and delay banks for TRSC stand, move, FIREA and
  FIREB, with the original nearest-direction fallback and source duration rule.
  TRSC has no events: all event/muzzle fields remain zero and unexpected events
  reject. These are the native harness's combat projection: render child
  pointers at raw72 `+4` remain zero, while collision separately follows parsed
  children. This is not a complete render-descriptor reconstruction.
- Full ordinary BOOM record 0 (136 bytes), including size, Q8 damage/spread;
  the other twelve BOOM records are not fabricated or supplied.
- Complete MBULLET signed-Q8 damage coefficients through `parseDamageMatrix`.
- All 256 RNG words read from EXE virtual address `478e04`, with PE section
  mapping; no RNG state/cursor is created or advanced.

`SOURCE_NATIVE_COMBAT_BANK_FIELDS` explicitly binds field identities:

| Type Field | Source Bank | Normalized ID |
| --- | --- | --- |
| `80` | TRSCSTAND | `1` |
| `7c` | TRSCMOVE | `2` |
| `a0` | TRSCFIREA | `0x100a0` |
| `a4` | TRSCFIREB | `0x100a4` |

Stand/move IDs agree with the existing task factory. Attack IDs are disjoint.
Tests look up each original address through its explicit native type field;
they never normalize by incidental pointer ordering. The same IDs index both
raw72 and delay maps. The helper does not relocate actor or projectile records.

## Weapon FIN Resolution

`parseWeaponStats` supplies weapon 1's actual visual prefix, `weapons`; neither
the troop sprite nor a guessed weapon animation name replaces it. The pinned
EXE supplies the lookup suffix strings at `47667c`, `47668c`, and `4766a0`.
The original binder `43b84f..43b8f8` checks travel `BULLET0`, then impact
`EXPLODE0`, falling back to `EXPL0`. Each lookup is case-normalized against
state names parsed from the entire authenticated ANIM.DAT corpus. A required
invalid state range rejects rather than becoming a null lookup.

The returned `weaponFin.sourceFinMapping` explicitly records:

| Lookup | Source Location | Normalized Result |
| --- | --- | --- |
| `WEAPONSBULLET0` | `null` (absent from registry) | `travelBank: 0`, weapon `+2c = 0` |
| `WEAPONSEXPLODE0` | `null` (absent from registry) | Try source `EXPL0` fallback |
| `WEAPONSEXPL0` | `null` (absent from registry) | `impactBanks: []`, `impactVariantCount: 0`, weapon `+40 = 0` |

No impact bank is written, so weapon `+30,+34,+38,+3c` retain their original
image values. The helper verifies that weapon 1 at `4f0248` is within the pinned
PE's uninitialized `.bss` section (flag `0x80`, raw file pointer zero), then
starts from its zero-filled 72-byte record. This also owns the padding around
the byte-valued fields. The zeros are not inferred from oracle outputs.
Source `shots = 0` rules out the BOOM FIN override at `43b8f8..43b935`;
unsupported overrides or present weapon FIN dependencies reject explicitly.

`weaponFin` also exposes `visualPrefix`, `registryHash`, `registryFiles` and
`registryStateCount`. For this authentic weapon, `projectileFin` is explicitly
empty: there is no travel/impact timeline to supply. Zero is reserved for absence
across `weaponBytes`, `weaponFields`, `fireFrames`, `fin` and `projectileFin`;
no bank or synthetic timeline is registered under ID zero. Existing nonzero
type-bank IDs remain unchanged. A single weapon row is not an 80-row weapons
table, and the empty weapon-1 FIN map does not assert absence for other weapons.

This closes the weapon-1 registry boundary, not general non-null weapon FIN
projection. Other prefixes, positive bank allocation/directional fallback,
impact variants and BOOM overrides are not enabled by this proof.

## Evidence

Historical round11 focused proof: **nine tests passed, zero failed, zero skipped** in
`/tmp/dc-round11-private-source-20260920.log`, including private copies of
SharedArrayBuffer-backed inputs before the first await. This supersedes the
earlier eight-test slice result. Exact source-input comparisons cover 4 base type-0 fire
rows and 9 base type-0 projectile rows, including 5 valid-reuse rows, streamed
from the supplied captures:

- `/tmp/dc-native-fire-validreuse-20260919-e27iOo`
- `/tmp/dc-native-projectile-validreuse-20260919-Rxsh1I`

Compared rows assert the executable digest and no runtime interceptions. Tests
compare the complete weapon-1 raw72 input row, scalar fields, all32 type-bank
raw72/delay arrays, original upgrades, damage/RNG, normalized armor, all six
collision fields and all136 ordinary BOOM bytes. Projectile rows also compare
the FIN input map restricted to that weapon's nonzero bank references, and
assert no zero-address FIN entry exists. Other weapons' banks are not discarded
or claimed as absent.
They also exercise fresh authentic HUMAN02 task-factory composition, source
tampering/missing dependencies, immutable input snapshots, nested freezing,
serialization rejection, invalid teams and refusal of altered task configs.
Registry tests independently parse the source corpus, assert real positive
states (`GRAYBULLET0`, `SPAKEXPLODE0`, `TRSCFIREA0`) and all three required
negative lookups, and reject omission of each of the 106 files. Additional
controls cover missing bytes, empty files, renamed keys, authentic FIN
substitution, changes at the first/middle/last registry files, and injected
`WEAPONSBULLET0` metadata. Reordered input keys reproduce identical proofs.

The harness's collision evidence is
`tools/qa/native-projectiles-native.py:source_collision_profiles`: original
armor and FIN/SPR rectangle routines, not manually chosen hit boxes. This
slice reads those existing inputs; it does not claim new executable captures,
new trajectory replay coverage or a complete native game initialization.

Run from any working directory:

```sh
DC_NATIVE_FIRE_TRACE=/tmp/dc-native-fire-validreuse-20260919-e27iOo \
DC_NATIVE_PROJECTILE_TRACE=/tmp/dc-native-projectile-validreuse-20260919-Rxsh1I \
DC_NATIVE_DAMAGED_ACTOR_TRACE=/tmp/dc-damaged-native-r4-20260919-1941.jsonl \
node --import /Users/rafael/Downloads/darkcolony/node_modules/tsx/dist/loader.mjs \
  --test /Users/rafael/Downloads/darkcolony/tools/qa/source-native-combat-options.test.ts
```

There is no implicit native recapture when evidence variables are absent.
Historical eight-test log: `/tmp/dc-combat-registry-second-20260919-02.log`.
Historical scoped typecheck log: `/tmp/dc-combat-registry-types-20260919-04.log`.
That original slice ran no full suite/browser, made no new native capture and
changed no package/shared file. Its gate is superseded by the latest round11
full gate, `/tmp/dc-round11-verified-20260920.log`: 2,510 tests, **2,506 passed,
zero failed, four skipped**, typecheck/build passed; JS 573.75 kB, gzip 180.54 kB,
over-500-kB warning. The earlier TS18047 stop is historical: the science fixture
guard now rejects null and undefined. See [round11 acceptance](acceptance-round11-20260920.md).

## Remaining Boundary

The standalone fragment is not itself an installed runtime owner. The
[host/session follow-up](source-native-combat-host.md) now owns a bounded
type-0/weapon-1 transaction, with authenticated reaction banks, one staged RNG,
dynamic current actors, projectile pool/statistics, nonlethal health, journals
and externally authenticated full caller replay. Its positive source-assets
test preserves the complete original mixed world and executes an actual hit
and damaged next visit; this is no longer a proof-only fallback.

Only type-0 collision geometry/normalized armor and base weapon 1 are admitted.
All106 scalar rows/SCN levels are projected, but unknown candidate geometry is
rejected in each four-substep 3x3 neighborhood before alliance filtering.
Fixed-size reducer padding is inaccessible storage, not evidence for additional
rows. Other targets, aircraft, CITY collision, upgraded weapons, nonzero
muzzle/spread/weapon-FIN effects, lethal death and shared production/resource/AI
schedulers remain closed. The ten provider tests and exact broader verification
counts are recorded in the host document. Original mission2 and all-phases
completion remain unclaimed.
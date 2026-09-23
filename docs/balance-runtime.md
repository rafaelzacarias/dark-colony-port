# Balance and Production Evidence

## Parser Handoff Contract

The owning extractor is unchanged. Its `DependencyRecord.rawFields` must become
`readonly number[]` (or a discriminated 2/4-element tuple), not a fixed four-tuple.
After `id cost interfaceId`, type 1 consumes `type unitType`; types 0 and 2
consume `type value1 value2 value3`. Prerequisites start at token index 5 or 7,
respectively, and end at the final `-1`. Preserve metadata and every prerequisite.
Reject unsupported grammar rather than silently guessing its boundary.

DC.EXE SHA-256:
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
The loader at VA `0x437870` branches at `0x437a58`: type 1 reads one more integer
at `0x437aae`; types 0/2 read three at `0x437a6a`. The shared prerequisite loop
at `0x437b6e` stores integers through `-1`. The 52-byte records at `0x4e6d70`
are indexed by explicit ID, not file order. The five-entry prerequisite storage
includes the sentinel (at most four prerequisites). Count/ID capacity is 110.

Corpus: 106 GAMESTAT rows, 64 WEAPSTAT rows, 80 DEPEND rows, comprising 14
buildings, 18 units, 48 upgrades. All 18 unit rows lose prerequisites with the
current parser. ID 7 must retain `[0]`, ID 9 `[1]`, ID 83 `[4,3,6]`, and ID 84
`[18,15,20]`. ID 83 is not row index 83. Re-extract generated dependencies after
the owner fixes the parser; lost values cannot be restored from `dependencies`
alone.

## Conservative Runtime API

`src/engine/legacy-production.ts` accepts the corrected records through
`createLegacyProductionCatalog`. It rejects known kinds with wrong metadata
widths, invalid integers, duplicate IDs, and unresolved prerequisite IDs. It
does not accept current corrupt troop records. Unknown kinds preserve metadata
and return an unknown check result. Unit/upgrade targets retain their GAMESTAT
indices; building metadata is not guessed into a unit index. Build time is null.

`checkLegacyProductionRequirements(catalog, id, credits, satisfiedDependencyIds)`
checks only the listed direct prerequisite IDs and the source cost. `satisfied`
does NOT mean buildable: caller must still establish faction, scenario unlocks,
current building/upgrade state, producer availability, placement and queue rules.
The function neither infers a prerequisite closure nor spends credits. Native
dependency state is not a permanent "ever completed" set.

No runtime wiring, combat balance changes, AI rules, or parser edits are included.

## GAMESTAT: Confirmed Health Defect

Token numbers below are zero-based, including the sprite string at token 0.
The native scanner arguments at `0x43bbc5..0x43bccc` target a 280-byte unit
record at `0x4f1880 + index*280`. The audit executes the argument construction
and checks destinations, rather than inferring layout from the comment header.

| Tokens | Native Offset | Meaning |
| --- | --- | --- |
| 6, 7, 8 | `+0x18, +0x1c, +0x20` | Weapon IDs by upgrade level |
| 9, 10 | `+0x28, +0x2c` | Armor level 1/2 percentages, not defense/health |
| 11 | `+0x40` | Target class indexing MBULLET columns |
| 12 | `+0x44` | Maximum/default health |

At `0x43bd46..0x43bd86` the loader makes armor factors
`[256, trunc(25600 / token9), trunc(25600 / token10)]`. Damage code selects one
by the per-team armor upgrade byte at `0x4f18b8 + type*280 + team`.
Spawn instructions `0x41b339..0x41b349` copy `+0x44` into entity `+0x0c` when
the supplied health override is <= -1. Explicit overrides remain authoritative.

**Exact parser-owner fix:** in `parseUnitStats`, `health` must use `values[11]`,
not `values[9]` (the numeric array omits the sprite). Expose armor percentages
as `[values[8], values[9]]` and target class as `values[10]`; retire the misleading
`defense` name through a deliberate API migration. Preserve the existing raw
tail or document any changed starting column. Current `rawTail[0]` is target
class and `rawTail[1]` is health. Regenerate units and update consumers/tests.

Examples: TRSC/GRAY health 800, BARR health 400, EXCOPOD health 4800, BRRKPOD
health 2400. The current adapter inherits the parser's incorrect 150/140 values.
It also ignores the class matrix and armor; do not call it source-faithful combat.

## Damage Contract

MBULLET contains 9 weapon-class rows by 10 target-class columns. WEAPSTAT token
2 (currently `rawPrefix`) chooses its row; GAMESTAT token 11 chooses its column.
The loader at `0x43b24b..0x43b2e5` parses each percentage, multiplies by 0.01
then 256, converts to integer and stores a signed 16-bit coefficient. All 90
corpus entries are checked by executing the original parsing/conversion code.

For the arithmetic block `0x4419e5..0x441a12`, with non-overflowing nonnegative
operands, let `C` be that coefficient, `D` weapon damage, `F` the caller-supplied
factor and `A` the selected armor factor:

```text
damage = (C * D) >> 8
damage = (damage * F) >> 8
damage = (damage * A) >> 8
if specialFlag: damage = (damage * 3) >> 2
health -= damage
```

The executable uses signed 32-bit IMUL and arithmetic shifts at each step;
do not collapse them into one floating-point product. The subtraction is at
`0x441a23`, writeback at `0x441a38`; death handling starts when health <= 0.
There is no minimum-one clamp in this block. Example native probe results for
`C=256,D=100,F=256`: armor factors 256/204/170 produce 100/79/66 damage;
the special flag changes 79 to 59. These isolate arithmetic, not all combat.
TRSC's actual class-0 versus class-0 coefficient is 64 (25%), not 256.

The provenance of `F`, the special flag's gameplay meaning, all area effects,
healing, hit selection, and every damage caller remain unresolved. No damage
formula is wired into the runtime on the strength of these partial paths.

## WEAPSTAT and Timing

Native records are 72 bytes at `0x4f0200 + id*72`; IDs are explicit, not row
positions (IDs 27/28 occur after 30). Scanner destinations are executed by the
audit. Existing damage/rate/speed/range columns are correctly positioned.

| Source Token | Native Offset | Verified Use |
| --- | --- | --- |
| 2 | `+0x00` | Weapon class / MBULLET row (`rawPrefix`) |
| 3 | `+0x04` | Sound field |
| 4 | `+0x08` | Ordinary firing delay (`rateOfFire`) |
| 5 | `+0x0c` | Base damage |
| 6 | `+0x10` | Projectile speed |
| 7 | `+0x14` | Range |
| 8 | `+0x1c` | BOOMSTAT-indexed effect/profile, not a shot count |
| 9 | `+0x20` | Burst count (currently named `reload`) |
| 10 | `+0x24` | Burst-completion delay (currently `magicChewing`) |

At `0x413181..0x4131a0`, delay defaults to `+0x08`. If `+0x20 > 0`, increment
the entity's byte counter at `+0x34`; on reaching `+0x20`, reset it and select
`+0x24` instead. Weapon 37 yields selected delays 10, 10, 30. The next call is
`0x4121d8`; its clock domain and update cadence were not established here.
Thus a direct `rateOfFire -> cooldownTicks` mapping is incomplete for bursts,
and no seconds conversion is verified. Preserve -1 sentinels in inactive fields.

At `0x43b935..0x43b952`, the loader computes another field at weapon `+0x18`:

```text
trunc((2 * ((range << 8) + 1024) + 1) / (2 * speed)) + 1
```

Native probe results for `(range,speed)` `(4,60)`, `(12,60)`, `(2,15)` are
35, 69, 103. This is a derived projectile parameter, NOT a build time or firing
delay. Its complete lifetime-consumer semantics remain unverified.

## Production Mapping

DEP record offsets: active `+0`, state `+4`, cost `+8`, interface ID `+12`,
kind `+16`, metadata `+20/+24/+28`, prerequisites `+32` through sentinel.
Native `0x438074` returns cost by dependency ID. `0x438090` matches kind 1 and
unit type before returning cost; `0x4380d8` matches kind 0 and all three metadata
values. Consequently neither interface ID nor file order is a unit type.

Building metadata is `(slot, level, faction)`; native checks at `0x437bfb` use
the slot for building state, compare level, then faction. Upgrade metadata is
`(unitType, selector, level)`; `0x437c50` selects per-team weapon upgrade bytes
for selector 0 or armor bytes for selector 1. The catalog preserves these as
raw fields and leaves building-to-GAMESTAT mapping null.

| Dependency ID | Unit Type | Cost | Required Dependency IDs |
| --- | --- | --- | --- |
| 7 / 21 | 6 / 14 | 1500 | 0 / 14 |
| 9 / 23 | 0 / 8 | 350 | 1 / 15 |
| 29 / 28 | 43 / 44 | 450 | 1,2 / 15,16 |
| 83 / 84 | 49 / 50 | 900 | 4,3,6 / 18,15,20 |

The audit emits every one of the 80 cost/prerequisite records. Native eligibility
`0x437bc4..0x437e9d` also consults existing upgrades/buildings, busy flags and
per-team restrictions. The supplied set in the new API must represent current
satisfied conditions, not merely constructed history. Build durations, queue
progress, refunds, exact producer/placement rules, faction restrictions for every
kind and scenario `%Depend` semantics are not implemented or inferred.

## Verification and Handoff

Run from the repository root (Python dependencies: Capstone 5, Unicorn 2):

```sh
python3 tools/research/balance-audit.py
python3 tools/research/balance-audit.py --verify-exe raw_cd/DC/DC.EXE
node --import tsx --test tools/qa/legacy-production.test.ts
npm run typecheck
```

On this machine the existing research packages are under
`/tmp/dc-re-capstone-20260918` and `/tmp/dc-trigger-unicorn-20260918`; add both to
`PYTHONPATH`. No package installation, browser, or additional agent is required.

The binary mode refuses any other executable hash. It validates 80 original
DEPEND parses, 106 health initializations, all 90 MBULLET conversions, scanner
destinations, four armor cases, six damage cases, three derived projectile cases,
and four firing-delay cases. These are bounded emulations with synthetic memory,
not execution of the whole Windows game. The five TypeScript tests cover corpus
counts, short-row regression fixtures, every direct prerequisite/cost boundary,
unknown metadata preservation, invalid records and fail-closed unknown IDs.

Owner regression fixtures should include shortest troop rows and healer rows,
type-0/2 rows, missing/early terminators, unknown kind, duplicate IDs and missing
references. Enforce native bounds if promising native compatibility: IDs 0..109,
count 1..110, no more than four prerequisites before the sentinel. Re-extract
generated JSON and update GAMESTAT health expectations together. The new catalog
is intentionally not connected until corrected parser output is available.
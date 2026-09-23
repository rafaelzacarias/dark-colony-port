# Additional Ordinary Combat Profiles

## Result

The original profile work changed only [legacy-balance.ts](../src/engine/legacy-balance.ts).
The subsequent [checkpoint join](later-mission-checkpoint-20260922.md) changes only
the profile schema in [simulation.ts](../src/engine/simulation.ts).
The original full HUMAN11 and ALIEN14 data now pass the MissionView constructor
with no mission diagnostic, omitted actor, or silently removed mobile weapon:

| Mission | Source Actors / Bindings | Mobile | Static |
| --- | --- | --- | --- |
| HUMAN11 | 108 / 108 | 92 | 16 |
| ALIEN14 | 78 / 78 | 66 | 12 |

The original result was **constructor and direct simulation-hit verification**.
The checkpoint follow-up now verifies fresh and moving restores and 200 default
ticks for both missions, plus initialized HUMAN11 render. ALIEN14 initialization
still fails on the missing CAM archive alias. Neither result certifies complete
mission playability or campaign completion.

## Newly Admitted Profiles

Weapon and damage lists are ordered by source upgrade level 0, 1, 2. Repeated
weapon 14 for SARG is intentional; PSYC's order is 30, 27, 28, not file order.

| Source Type | Sprite | Type Faction | Weapon IDs | Base Damage | MBULLET Row | Defense Class |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | REAP | 0 | 7, 8, 9 | 100, 125, 150 | 1 | 1 |
| 4 | SARG | 0 | 13, 14, 14 | 200, 250, 250 | 4 | 4 |
| 10 | SCYT | 1 | 21, 22, 23 | 100, 125, 150 | 1 | 1 |
| 12 | PSYC | 1 | 30, 27, 28 | 200, 250, 300 | 4 | 4 |

All four mobile defenses use original percentages 125/150, normalized at
`0x43bd46` into native fields `+0x24/+0x28/+0x2c`: 256/204/170.

| New Static Defense Types | Defense Class | Source Percentages | Native Factors |
| --- | --- | --- | --- |
| 83, 87 | 6 | 120, 140 | 256, 213, 182 |
| 88 | 0 | 120, 140 | 256, 213, 182 |
| 97, 98 | 8 | 120, 140 | 256, 213, 182 |

These static types have source weapons `[-1,-1,-1]`. Defense admission does not
grant an attack or depend on their faction. Class 8 receives zero point damage
from all three admitted matrix rows; it is not converted to a minimum-one hit.

The existing 0/8/69/73 attacks and 24 defense types remain supported, totaling
eight attacker types, 20 type/upgrade combinations, and 33 target types. No
commander weapon-upgrade combinations were added. Existing exported class-0
coefficients and profile mode are unchanged; copies now validate the canonical
row selected by the exact type/faction/weapon combination.

## Original Executable Proof

The opt-in extension of
[live-native-upgraded-hit-20260919.py](../tools/research/live-native-upgraded-hit-20260919.py)
reuses the existing combat-table/scanner pipeline and refuses an EXE other than
SHA-256 `65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
The report also binds GAMESTAT, WEAPSTAT, MBULLET, BOOMSTAT, and each tested SCN
to their original byte hashes.

GAMESTAT and WEAPSTAT values are marshalled into destinations produced by the
original scanner argument construction. Original GAMESTAT postprocessing and
armor normalization execute, as do all 90 MBULLET conversions and BOOMSTAT-0
parsing. The four SCNs separately run the existing original City/unit-row
scanner and actual CRT sscanf, supplying only line I/O. All 106 types' weapon
and armor level bytes match for every team of HUMAN01, ALIEN01, HUMAN11, ALIEN14.
Those byte comparisons distinguish owning-team SCN race from source-type faction.

Every new weapon has effect index 0, BOOMSTAT dimension 1, burst count -1,
and burst-completion delay -1. The source field currently called `shots` is the
effect index, not a burst count. Weapon 7 is not a configured burst weapon.
The probe starts at `0x44275a`, **before** the descriptor branch at `0x442767`.
Each of the 38,160 cases executes `0x442775 -> 0x441930 -> 0x441a38`; none executes
the area-effect routine `0x441bec`.

Coverage is 20 source/upgrade combinations x 106 actual target records x three
armor levels x two phases x three source/target team pairs: (0,1), (7,3), (3,3).
All ten target classes are represented. Each case records the actual native
caller factor, source-team penalty flag, weapon pointer, selected armor factor,
matrix coefficient, and target HP before/after. The same-team pair is an isolated
impact control, not evidence that ordinary acquisition should attack allies.

Two distinct controlled actor slots (200 source, 201 target) and target HP 10000
keep every comparison nonlethal. Source HP is not used to fabricate expected
damage. Team armor bytes and phase are explicit controlled inputs, not a claim
of whole-mission native state. The routine stops after the HP write: death,
reaction, projectile completion, and presentation are not executed by this proof.

Of these cases, 11,880 compare the admitted runtime factories directly; the
remaining targets compare the existing pure damage calculation and stay rejected
by the defense factory. Thus testing all source classes does not unlock them.
Another 648 simulation hits compare native HP for every new attack upgrade,
new defense type, armor level, and phase, including neutral static targets.

## Gates And Remaining Work

New damage factories require exact class, damage, effect index, source faction,
weapon level, and canonical coefficient row. New profiles require both burst
fields explicitly equal to -1. Missing weapon records still throw instead of
turning an armed source actor into an unarmed simulation unit. Every matrix
column has a tamper control. Area callers and nonzero Inspire timers remain
rejected; new profiles also reject per-hit Inspire factors other than 256.
No splash, healing, special ability, burst, invented rate, or range override was
introduced. Native fire/task/projectile owners were not expanded.

**Checkpoint blocker resolved in the separately authorized follow-up:**
[simulation.ts](../src/engine/simulation.ts#L526) uses the exported verified type
registry and retains `copySourceDamageProfile` as the exact type/faction/weapon/row
gate. The obsolete known-failure assertion is now a positive fresh restore test.
All 20 verified source/upgrade combinations round-trip; invalid combinations,
unknown types/weapons, wrong rows, extra fields, and malformed numbers reject.
See the [checkpoint evidence](later-mission-checkpoint-20260922.md) for 200-tick
updates, public commands, moving restore, and the remaining CAM asset handoff.
Updating the schema alone does not prove whole-mission runtime.
The bounded native launch/cadence/flight/reaction owners and any later scripted
unsupported types or abilities still need their own verification.

No MissionView, loader, selector, UI, package, or generated asset was edited.
The only runtime follow-up is the simulation checkpoint schema above.
No agents, browser run, or full suite were used.

## Verification

[additional-ordinary-profiles.test.ts](../tools/qa/additional-ordinary-profiles.test.ts)
regenerates the native report when `DC_ADDITIONAL_ORDINARY_REPORT` is absent.
It preserves complete mission inputs, observes unmodified registration options,
and checks source HP, exact weapon profiles, and complete actor/binding counts.

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 -B tools/research/live-native-upgraded-hit-20260919.py --additional-profiles > /tmp/dc-additional-expanded.json
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 -B tools/research/live-native-upgraded-hit-20260919.py > /tmp/dc-additional-original.json
DC_ADDITIONAL_ORDINARY_REPORT=/tmp/dc-additional-expanded.json \
DC_NATIVE_HIT_REPORT=/tmp/dc-additional-original.json \
  node --import tsx --test tools/qa/additional-ordinary-profiles.test.ts tools/qa/live-native-combat.test.ts
```

Final run: 17 tests passed, zero failed/skipped, including the original 3,456-hit
comparison and first-mission placements/colonies/reinforcements/newtype coverage.
Strict TypeScript with unused-symbol checks passed for the touched slice and
the two focused test files. Editor diagnostics were clean.

Artifacts from this run:

- Expanded report: `/tmp/dc-additional-profiles-expanded-20260922-p09.json`,
  SHA-256 `74653b759a3b9637791ebfca6c2447fda51852257caa35aa5ebd659595d959b0`.
- Original report: `/tmp/dc-additional-profiles-original-20260922-p09.json`,
  SHA-256 `3bf6bade3ed803992bd9ad613f2279be5ff577c8baa13be45cba332279d7ac7a`.
- Tests: `/tmp/dc-additional-profiles-final-tests-20260922-p10.log`.
- Types: `/tmp/dc-additional-profiles-final-types-20260922-p12.log`.
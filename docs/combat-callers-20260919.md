# Native Damage Callers: 2026-09-19

## Decision

**The ordinary-hit arithmetic blocker is resolved for the bounded subset below.
No blanket mission enablement is justified merely by disabling live Inspire and
upgrades.** `specialFlag` is the source type's adverse day/night-phase penalty,
evaluated at impact. It is not universally false, a building flag, a target
armor flag, or a team/faction inferred from ownership.

For a verified ordinary direct hit, an uninspired source supplies factor 256.
Fresh type loading initializes weapon and armor levels to zero for teams 0-7,
including mobile and building types. Scenario loading can override mobile
levels before combat; a save or later command can also invalidate a default.
"No live upgrades" is not proof of zero initial upgrades.

The existing [source profile API](../src/engine/legacy-balance.ts) stores a fixed
flag at registration. It can represent the verified subset during a fixed
native phase, provided all other inputs below remain fixed. It cannot faithfully
span a native phase flip without a per-hit flag/update mechanism. This research
changes no runtime or shared document and does not authorize full combat parity.

## Reproduction and Boundaries

[Probe](../tools/research/combat-callers-20260919.py), from repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 \
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
python3 tools/research/combat-callers-20260919.py
```

Dependencies: Capstone 5 and Unicorn 2. The `/tmp` entries above are the local
dependency installations, not fixture data. The probe imports the existing
[Inspire fixture](../tools/research/inspire-audit-20260919.py), which uses the
[hash-gated PE loader](../tools/research/transport-audit.py). It rejects a
different executable before emulation. Original
[DC.EXE](../raw_cd/DC/DC.EXE) SHA-256:

`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.

All addresses are virtual addresses. Every native slice has a one-million
instruction limit and asserts its terminating EIP. Damage tests execute the
**original helper entry at `0x441930` through its health write at `0x441a38`**,
stopping at `0x441a3e`. No replacement damage implementation or intercepted
helper return is used. Death processing, task changes, retaliation, and remaining
post-hit bookkeeping after that stop are not tested.

These are component fixtures, not game boot or complete firing/flight/collision
tests. Direct-hit fixtures start after a target slot has been selected, at
`0x44275a`; alternate-caller fixtures start at their argument-computation slices.
Same-team hit cases distinguish arithmetic from team selection; they do not prove
that ordinary acquisition or collision would select that target.

Type and weapon `sscanf` argument construction runs natively; ASCII values are
marshalled to those original destinations instead of emulating CRT `sscanf`.
Type Q8 conversion and initialization run natively. MBULLET parsing/conversion
and BOOMSTAT profile-0 ID/dimension parsing run original instructions. Remaining
weapon/BOOMSTAT animation/resource loading is not emulated.

The report emits these source SHA-256 values (only the executable is hash-gated):

| Source | SHA-256 |
| --- | --- |
| GAMESTAT.TXT | `ed13afe21ffea368a5892b49de40ef063014c0a9376c5d5bb5abf1396cb27629` |
| WEAPSTAT.TXT | `391e5603108b73cff4a5d2135ae751a0c8aebb934e6f3d6e5e09c5e807e520d0` |
| MBULLET.TXT | `2244665ec4fc4f344b4ad32ec47e209c79a1a240d48f8f43a6035ceab0ae1d22` |
| BOOMSTAT.TXT | `b80addf8e43bacc66c0ab63f4852f0ef13341f3a914d7305743557968baac33a` |

## Special Flag Provenance

Entities: `game+0x7d28 + slot*220`. Types: `0x4f1880 + type*280`.
The ordinary projectile stores its source slot in the high word of dword `+0xc`.

At `0x442775..0x4427d3`, original instructions read the **current source slot's
type byte `+6`**, then that type's dword `+4`, and compare it with `game+0x53c`:

```text
specialFlag = (sourceTypeFaction == 0 && nativePhase == 1)
           || (sourceTypeFaction == 1 && nativePhase == 0)
```

GAMESTAT token 1 maps to type `+4`: TRSC type 0 has value 0; GRAY type 8 has
value 1. Source ownership byte `+7` is read separately for another argument.
The flag does not inspect target type, target faction, armor, source team, or
visual brightness. Other source-faction values make both comparisons false;
the synthetic value-2 controls do not authorize additional gameplay types.

At `0x4427aa`, factor starts at 256. At `0x4427f5`, only a nonzero source
Inspire timer `+0xd6` replaces it using the current caster slot/type multiplier,
as established by [the fresh Inspire audit](inspire-runtime.md).
At `0x442843/0x44285f/0x442871` the caller pushes source slot, flag, source team.
At `0x442877` it calls the original helper with EAX=game, EDX=target slot,
EBX=weapon record, ECX=factor. The helper reads the flag at frame `+0x14`.

### Day/Night Encoding

Native scanner destinations disambiguate the reversed in-memory observation
order: GAMESTAT token 4 (day) goes to `+0x14`, token 5 (night) to `+0x10`.
TRSC therefore has `+0x10=4,+0x14=7`; GRAY has `7,4`.

`0x4199c1..0x419a28` computes blend `game+0x540`. During the transition window,
phase 0 computes `256 - counter*256/transitionLength`; phase 1 computes
`counter*256/transitionLength`. The observation routine at `0x44a6e9` and
`0x44a7a6..0x44a7dd` uses:

```text
vision = (nightRange * blend + dayRange * (256 - blend)) >> 8
```

Fixtures at counters 0/50/100, transition length 100, prove phase 0 transitions
to day (blend 0) and phase 1 to night (blend 256). Thus humans receive the
penalty in phase 1 and aliens in phase 0. The phase changes **at the start of
the transition**, not when a daylight/brightness threshold crosses 50%.
Do not substitute a rendered `timeOfDay` label or interpolate this damage flag.

`0x419993..0x4199c1` leaves phase/counter unchanged when counter <= phase length;
when counter > phase length it resets counter to zero and sets phase to
`1 - phase`. Threshold fixtures cover both phases at length-1, length, length+1.
The scenario loader writes the initial phase at `0x41bc55`; this audit does not
boot a scenario or certify its complete scheduler/order pipeline.

## Armor and Weapon Initialization

`0x43bd46..0x43bd86` initializes the type's armor factor array:

```text
type+0x24 = 256
type+0x28 = trunc(25600 / GAMESTAT token 9)
type+0x2c = trunc(25600 / GAMESTAT token 10)
```

`0x43bd89..0x43bdae` explicitly clears all eight weapon-level bytes at
`type+0x30..0x37` and all eight armor-level bytes at `type+0x38..0x3f`.
The probe poisons all 16 bytes with `0xa5` first, for **every one of 106 types**,
and verifies the complete zeroing and all reciprocal factors. Zero is an
executed initialization, not an assumption based on blank Unicorn memory.

In the damage helper, `0x441969..0x44199e` reads target entity type/team and
target class. `0x4419c1..0x4419df` selects:

```text
armorLevel  = byte[TYPES + targetType*280 + 0x38 + targetTeam]
armorFactor = dword[TYPES + targetType*280 + 0x24 + 4*armorLevel]
```

No mobile/static branch changes this lookup. TRSC/GRAY factors are
`[256,204,170]`; tested class-9 buildings use `[256,213,182]`. Both start at
**level 0, factor 256**, not the first listed upgrade percentage. The 36
selection fixtures poison other teams' levels and give the source team a
different level, proving that target team is the selector, including buildings.
Team 8 is outside this initialized eight-byte array and outside approval here.

### Initial Scenario Overrides

The eight per-team unit rows parsed at `0x41c229..0x41c249` have five integer
destinations. The third integer lands at frame `-0x70` (weapon level); the
fourth at `-0x6c` (armor level). At `0x41c24e..0x41c287`, scenario race and
row index select a type using table `0x41ad90`, and the team index selects its
level byte. Native table contents:

```text
race 0: 0, 2, 3, 6, 43, 5, 1, 4
race 1: 8, 10, 11, 14, 44, 13, 9, 12
```

The write-slice probes cover the first mapped type for each race, teams 0/3/7,
and level pairs `(0,0),(1,2),(2,1)`. They supply the parsed locals; they do not
execute the scenario file parser. These writes can pre-upgrade TRSC/GRAY.
The class-9 building types below are absent from this particular mapping, so
these eight-row overrides do not upgrade them. Do not generalize that to saved
games, script/command mutations, or all possible initialization paths.

## Caller Coverage

A raw relative-E8 scan of the complete native `AUTO` code section finds exactly
three calls to `0x441930`, also checked against disassembly. This does not prove
the absence of indirect calls or other routines that change health.

| Call Address | Established Behavior |
| --- | --- |
| `0x442877` | Ordinary direct-hit branch. Computes phase flag and current Inspire factor. |
| `0x44219b` | Area-effect occupancy scan in `0x441bec`. Pushes flag 0 at `0x442145`; uses signed high-word effect-cell coefficient, scaled by 256 for different teams or 64 for the exact same team. Neither ordinary phase flag nor Inspire factor is applied in this argument slice. |
| `0x4423b5` | Separate terrain-occupancy effect routine `0x4421b8`; pushes flag 0 at `0x442375`, uses signed high-word effect-cell coefficient directly. Call eligibility includes projectile `+0x18 & 63 == 0`. No gameplay name is assigned to this effect here. |

Alternate-caller fixtures deliberately set adverse phase and a nonzero source
Inspire timer. With a synthetic cell factor 128, the first caller passes 128
for different teams and 32 for the same team; the second passes 128 for both.
Both flags remain zero, and original helper damage is 50/12/50/50 at base 100
and neutral class/armor. These are caller-input controls, not full area-effect
geometry, lifetime, deduplication, or hit-selection acceptance.

`0x44275a..0x44276f` reads the weapon's BOOMSTAT profile `+0x1c` and dispatches
direct hits only when that profile's dimension byte `+0x10 == 1`; otherwise
`0x4428f6` calls the area-effect routine. Native BOOMSTAT parsing at
`0x43b407..0x43b49e` verifies profile 0, dimension 1. Source weapon IDs 1 and 15
both select profile 0, weapon class 0, base damage 100. No splash behavior is
inferred from this direct branch.

## Supported Subset and Inputs

The approval is **damage amount for an already resolved ordinary direct hit**:

- Source TRSC type 0 / base weapon ID 1, or GRAY type 8 / base weapon ID 15.
  The source slot/type remains valid and unchanged through impact; source
  Inspire timer is zero. No active or initial weapon upgrade is present.
- Targets: mobile types 0/8; human class-9 building types 16-22; alien class-9
  building types 28-35. The probe covers all these types. This is a defense
  arithmetic statement, not building availability or weapon ownership approval.
- Source and target teams are 0-7. Target armor level is verified zero for this
  subset, with no scenario/save/command override. Target class comes from its
  source type, including buildings; never substitute a generic static class.
- Use the original MBULLET coefficient row, actual weapon damage/class and
  explicit weapon ID, source type faction, and **native phase at impact**.
  Supply `callerFactor: 256`, `armorLevel: 0`, and the proved phase predicate
  as `specialFlag`. Register source defense on every intended target.
- Preserve scenario health overrides independently of default/max health;
  perform the original separate Q8 truncations and final `*3 >> 2` when flagged.
  Remain within the existing API's nonnegative, nonoverflowing operand bounds.

Actual outcomes for either source's base weapon:

| Target | Coefficient | Favorable Phase | Adverse Phase |
| --- | ---: | ---: | ---: |
| TRSC / GRAY, class 0 | 64 | 25 | 18 |
| Listed buildings, class 9 | 12 | 4 | 3 |

The class-9 coefficient is `trunc(5 * 0.01 * 256) = 12`; base 100 therefore
does **not** produce 5 damage before the phase penalty.

Still excluded: general sources/weapons, nonzero initial upgrades as a mission
integration policy, dynamic upgrades/Inspire, neutral-team indexing, source-slot
death/reuse, healing, area effects, collision/scatter/flight, animation, burst
cadence, retaliation, death handling, and overall mission combat fidelity.
The existing flat-damage fallback for missing profiles is not native evidence.

## Verification Result

The focused probe passed **395 reported cases/records**:

| Group | Count |
| --- | ---: |
| Synthetic source-faction/phase flag truth table | 9 |
| Poisoned type initialization records | 106 |
| Scenario level-write fixtures | 18 |
| Phase-toggle threshold fixtures | 6 |
| Native phase/blend/observation fixtures | 12 |
| Target-team armor selection and flag fixtures | 36 |
| Real TRSC/GRAY direct hits across mobile/building targets | 204 |
| Alternate caller controls | 4 |

Additional assertions verify the three direct call addresses, all 90 native
matrix conversions, source-table scanner formats, profile-0 dimension, and
armor reciprocals. No agents, browser, runtime edits, or full suite were used.
This supersedes the unresolved factor/flag question in
[native-combat-fidelity.md](native-combat-fidelity.md) only for the subset above;
that shared document was intentionally left untouched.
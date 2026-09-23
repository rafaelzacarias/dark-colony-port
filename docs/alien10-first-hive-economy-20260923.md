# ALIEN10 First Hive Economy: Blocked

## Decision

**No authentic first-hive funding or free-base policy was established.** Keep
the original 1500 credits and the DEPEND 14 price of 2000. Reject the unfunded
purchase. Do not grant 500 credits, reduce the price, invent a collector, credit
allied income to team 0, or turn commander delivery into a free construction
receipt. This investigation does not establish that the original mission is
impossible; it establishes that the opening mechanism remains unresolved.

This supplements [the construction owner report](browser-construction-20260923.md).
Only [the dedicated research script](../tools/research/alien10-first-hive-20260923.py)
and this note were edited by this investigation. No runtime/source-asset edits,
agents, full suite, package installation, or original-game UI playthrough.

## Original Mission Inputs

- [ALIEN10.SCN](../raw_cd/DC/SCENARIO/ALIEN/ALIEN10.SCN): team 0 has race 1,
  money 1500, AI 0, home `(119,6)`, and all five main city slots empty.
  Restrictions are 34, 53, 55, not central dependency 14. No player type-14
  collector or type-73..76 commander is placed initially.
- The native loader produces 58 registered actors. Player fixed slot 5 is
  type 81, HP 1, Q8 `(30464,1792)`: the implicit city marker, **not** central
  type 28. Player objects include type 89 at `(111,6)`, five type-90 objects,
  four type-42 defense towers, five type-8 troops and four type-10 troops.
  Type 89 is the GAMESTAT "dropship mind link"; type 90 is "psy-energy store".
  These labels do not prove an income or construction ability.
- Team 2 is allied with team 0 and has central HP 250 and slot-2 HP 100.
  These are team 2's buildings, not team 0's. No collector placement supplies
  an opening player income route.
- [ALIEN10.TRO](../raw_cd/DC/SCENARIO/ALIEN/ALIEN10.TRO): first player delivery
  is `reinforce 0 111 8 73 1 ...` at `c>20`. Further player deliveries are
  commanders after casualty/recovery conditions, not collectors or buildings.
  Trigger 0 loses at `c>180` when all five player main city HP slots are zero.
  The first `newrate` is at `c>300`, then 450, 1500, 1800 and 2500. There is
  no explicit money grant or first-base action in this TRO.
- [The briefing](../raw_cd/DC/SCENARIO/ALIEN/ALIEN10.TXT) orders construction
  of a new hive; [message 4](../raw_cd/DC/SCENARIO/ALIEN/ALIEN10.MSG) directs
  retreat to the southern hive pad when team 2's hive is lost. Neither text
  specifies a free base, money multiplier, or collector delivery.

## Native Money And Prices

Pinned executable SHA-256:
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.

1. Executed original `0x41bd90..0x41c2b0` for all eight actual ALIEN10 team
   rows. Team 0 is **1500 -> 1500**, team 1 **2500 -> 2500**, all others zero.
   At `0x41bddc` the money text is converted to an integer; `0x41bdeb` stores
   it directly at team `+0x14` / game `+0xbac + team*0xe30`. No multiplier.
   Cost accumulator starts zero.
2. Original SCN header writes are separate: `game+0x530=1500`, `+0x534=6750`,
   `+0x538=75`, `+0x53c=0`, `+0x540=0`. The header's 1500 is not another
   deposit or the team-money field. No invented meaning is assigned to it here.
3. Original DEPEND records 0 and 14 both cost **2000**, with building metadata
   `(slot=0,level=0,race=0/1)`. Executed `0x4380d8` for both races and both
   slots 0 and 3: all four return 2000. Central is not accidentally being
   priced as science; they genuinely share that price.
4. Native slot table `0x47afa8` maps central slot 0/level 0 to type **16**
   for humans and **28** for aliens. Dependency **16** means alien science,
   not unit type 16. Use the correct namespace and building lookup.
5. Unit-only helper `0x438090` returns 1500 for types 6/14 but **0** for
   types 16/28/73. Disassembly proves it matches only DEPEND kind 1 and returns
   zero when unmatched. This is **not** a free-base or free-commander rule.
6. Executed live updater `0x437bc4` against the loaded ALIEN10 teams:
   dependency 14 remains eligible/state 1, price 2000; science 16 and collector
   21 remain blocked/state 2. The updater changes eligibility, not cost.
7. Executed actual menu handler `0x433124` with interface 205, purchase event 4,
   and an empty UI queue. Only UI event retrieval and queue access are stubbed;
   dependency selection `0x43812c`, cost lookup and affordability/debit branch
   are original. At 1500 credits, purchase is refused, no queue write occurs,
   and **all 0x471b0 world bytes remain identical**.

## Construction And Income Boundaries

- Paid menu `0x433165` obtains DEPEND cost, `0x4331b9` compares credits,
  and `0x4331c1` debits. Queue sender `0x437f3c` emits through `0x40c13c`.
- Mode-9 receiver `0x41c8d4` is a **prepaid receiver**. Its new-building branch
  adds cost to accounting, sets city HP/level, and calls `0x444f14`. It does
  not itself enforce affordability or debit credits. Directly invoking it on
  an unfunded world would bypass the payer, not prove an authentic free base.
  Its already-complete-building branch refunds; that is not applicable to the
  empty opening slot. The receiver uses race 0 for its price helper, but central
  prices agree across races, so that does not explain a 500-credit difference.
- Constructor `0x444f14` sees empty city HP and leaves its actor inactive.
  The native full SCN loader does not create a player central hive.
- Income service `0x419b2e..0x419b7e` runs on its 16-counter gate and checks
  `game+0xbd4 + team*0xe30 != 0` before adding the team's `+0x19b4` income.
  Team 0's empty central slot fails that check. This is not evidence for an
  unconditional start-up stipend.
- Existing original `newrate` research executes type-40 rate mutation, not a
  credit deposit: [mission02 native probe](../tools/research/mission02-audit-20260919.py).
  ALIEN10's own occurrences begin after its no-build loss threshold, so they
  cannot be assumed to solve the first-base deficit. No `timedunits`, `freebase`
  or `basecost` action appears in ALIEN10's TRO; none is an established native
  opening mechanism in this research.
- Found helper `0x456110`, which scans `0x438220` eligibility and sends a
  building command without charging. A direct-call byte scan found no callers
  of `0x456110` or its predicate wrapper `0x4560d0` in `0x401000..0x474000`.
  Indirect callers were not established. **Do not expose this as a player API**
  or infer reachability from a helper's existence.

## Commander Finding

There is **no initial player commander** in the actual native SCN result.
The intended first commander arrives from TRO, type 73.

A separate bounded control invoked original delivery allocator `0x41b634`
with the source request `(team=0,x=111,y=8,type=73)` on the completed ALIEN10
startup state. It allocated slot 203, actual type/team `(73,0)`, while preserving
credits 1500, all 15 city-health words, and the complete 110-record DEPEND table.
No construction entitlement was demonstrated. This is a constructor control,
**not** natural TRO firing, carrier flight, or later commander-command replay.
It rules out an immediate money/base/price effect of that allocation only.

## Startup Trace Scope

The dedicated script reuses the existing native visibility/SCN harness. It
executes the original complete `0x41b920` SCN loader with original ALIEN10
SCN/MAP/PTH/MTG/TRO/MSG and source FIN data. Exactly two mission-02 file-routing
strings in the imported Python loader function are replaced **in memory** with
mission 10. No executable instruction or asset is patched. Source bytes are
checked unchanged after the run.

This remains a harness-backed loader trace, not a complete process boot or
playthrough. It uses an explicitly selected mode-0 alien campaign profile,
not recovered installed settings. Existing boundaries supply file I/O,
allocation, map handle, clock and pre-parsed source type/dependency tables at
`0x43c388`; FIN lookup/formatting are also harness services. Those boundaries
are listed in the JSON evidence. Original constructors, team scanner, trigger
parser and message parser execute. No world-cycle progression was run.

Disassembly of `0x43c388`, DEPEND scanner `0x437870`, and the live updater
showed no central-price exception in the inspected paths. This is narrower
than proving every possible table mutation in the running original game.

## Reproduction And Evidence

```sh
PYTHONPATH=/tmp/dc-exit-native-deps-r14 python3 -B tools/research/alien10-first-hive-20260923.py
PYTHONPATH=/tmp/dc-exit-native-deps-r14 python3 -B tools/research/alien10-first-hive-20260923.py --startup
```

Both passed in isolated child processes with 120-second SIGKILL caps. Unique
final outputs, each with an empty `.err` companion:

- `/tmp/dc-alien10-hive-probe-20260923-r16.json`, SHA-256
  `6cc297c49c380534f4f983b84518bdef7a18fbb197dbd913f398e09d7df61a04`.
- `/tmp/dc-alien10-hive-startup-20260923-r16.json`, SHA-256
  `5dc30251a169208192e9fe935c6cfeb8c1b1a77964e8476e3116b802149d527f`.
- Relevant additional disassembly: `/tmp/dc-alien10-hive-income-20260923-r12.json`,
  `/tmp/dc-alien10-hive-header-20260923-r14.json`, and earlier r03/r06/r08/r11
  captures. Script `--disassemble START:END` reproduces bounded address ranges.
  `--calls ADDRESS ...` scans candidate relative calls; its arbitrary-prefix
  context can start mid-instruction. Verify candidates from known function
  entries before interpreting them. Absence of direct calls excludes neither
  indirect dispatch nor another executable version.

ALIEN10 SCN SHA-256:
`8055810eaa2db00c6f07b64e806540f054514dfb616afad886d89f71ed8c00b7`.
TRO SHA-256:
`fb00f5b2c26ae45cc3beacb86958b67161c6f5f215c6e0f4ccd86c03a32acda2`.
Other source hashes and exact actor/constructor bytes are in the startup JSON.

## Next Authentic Check

The missing evidence is **a reachable original player action or world event**
between this loader state and a successful first-hive purchase. Capture the
actual original ALIEN10 UI opening through commander delivery and the first
build attempt, recording ordered writes to team-0 money `+0xbac`, accounting
`+0xbb0`, city HP `+0xbd4`, DEPEND-14 cost, and command packets. Include the
executable/assets/configuration identity. Alternatively extend this bounded
harness through those actual world/UI boundaries with no gameplay substitutions.

Until that trace identifies the payer or an explicit native exemption, there
is no positive authentic opening policy to implement. Startup proof, an eligible
button, an unchecked receiver and a funded test control are not that proof.
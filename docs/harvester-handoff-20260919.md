# Native Harvester Movement / Resource Handoff

Executed 2026-09-19. **Eight bounded original-x86 round trips pass**, covering
types 6/14, Move Only / assault, and both mobile/source registered-slot orders.
This is a synthetic legal-constructor fixture using actual HUMAN02 source
coordinates and navigation data, **not a full mission or live host acceptance**.

- Probe: [harvester-handoff-20260919.py](../tools/research/harvester-handoff-20260919.py).
- Isolated owner: [legacy-harvester-idle.ts](../src/engine/legacy-harvester-idle.ts).
- Tests: [legacy-harvester-idle.test.ts](../tools/qa/legacy-harvester-idle.test.ts).
- Existing resource owner boundary: [resource-host-integration.md](resource-host-integration.md).

No shared runtime, browser, agents or full suite were used. The existing
[mobile idle owner](mobile-idle-runtime.md) still supports only 0/8/69/73.

## Fixture And Native Execution

DC.EXE SHA-256:
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
JSON includes HUMAN02 SCN/MAP/PTH/MTG and loaded FIN hashes. The existing
construction loader supplies original GAMESTAT records and source FIN timelines.
FIN name/format marshalling is preparation only. All harness stubs are cleared
before actor construction. There are **zero runtime interceptions**, including
movement, integer pathfinding, turning, occupancy, idle, resource activation,
animation, cancellation and release. Native audio readiness gates remain inactive.

Actual HUMAN02 SCN row: `69 48 40 22 12000`. MAP dimensions are 96 by 84.
Source type 40 is legally constructed at (69,48), neutral team 8, reserve 12000,
rate 22. Mobile 6 or 14 is legally constructed at (67,48), team 0, HP 800.
Constructor directions remain **160 / 128** and initial task 1 is
`[65535,0,0]`. This is not a claim that HUMAN02 initially contains either mobile.
The synthetic team uses the matching race, AI 0, credit gate 1, multiplier 256,
credits/income/phase 0 and mode 0. Only these two actors are registered, slots
152/153, with their assignments reversed in the second ordering.

MAP attribute words are marshalled to the native flag plane; PTH connectivity
and every cell family are source data. Native path cells also require epoch 0,
cost -1, integer x/y at +8/+9, null queue links and border-family 255. Row
pointers have legal padded storage. Native adjacency construction
`0x442e2b..0x442e41` and queue reset `0x442a10` execute before movement.
MTG is fingerprinted, not used to fabricate a rendered terrain/air world.

Omitting PTH x/y produced a bogus all-zero northwest route despite executing the
pathfinder; that intermediate probe is **not** a golden. Merely setting target
coordinates also failed because task 8 requires the native waypoint list.
Neither failure was repaired by teleporting, replacing pathfinding or forcing idle.

Player packets execute their original decoders:

| Entry | Payload / effect |
| --- | --- |
| `0x41dd2c` | Select team 0, mobile slot, terminator -1 |
| `0x41d4f4` | One waypoint, team 0, Q8 destination (17792,12416) |
| `0x41ce9c` | Selected order 2 (Move Only) or 7 (assault) |
| `0x41ce54` | Mobile slot, order 13 for cancellation |

Order 2 initializes task 2 and task 8 mode 0; order 7 initializes task 7 and
task 8 mode 1. Task 8, path task 6, turn task 4 and movement task 5 all execute
original instructions. No direct pending-byte write substitutes for a command.
Packet readers consume every supplied byte. GUI input/network transport is outside
this fixture. Each update executes phase increment `0x41989e..0x4198c3`, clears
the per-update income selector, then runs registered dispatch
`0x419bb8..0x419c0e` including the real entity animation preamble.

## Golden Milestones

Both movement modes have these timings. Cancellation is issued 45 updates after
activation, after deployment has completed. All figures are whole update indices.

| Mobile / visit order | Move complete | Activate | Deploy complete | Cancel | Release |
| --- | ---: | ---: | ---: | ---: | ---: |
| 6, source first | 25 | 67 | 105 | 112 | 115 |
| 6, mobile first | 25 | 66 | 105 | 111 | 114 |
| 14, source first | 28 | 70 | 96 | 115 | 122 |
| 14, mobile first | 28 | 69 | 96 | 114 | 121 |

The final mobile Q8 position is **(17760,12416)**, not the requested cell center
(17792,12416). Native integer stepping ends 32 Q8 units short of that center,
inside the correct VENT cell. Facing becomes **0**, through native turning.
Successful movement consumes pending to 0 and order to 255. Its completed visit
has bottom idle `[65535,800,0]` and top wait `[7,800]`, not constructor payload.

Movement reserves the next ground cell before physical arrival. In the human
trace destination occupancy is reserved at update 17; movement completes at 25.
Writes at `0x415e30/0x415e43` reserve the cell, and
`0x41253b/0x412580/0x4125af` clear the previous cell and preserve/set packed bits.
The old integer tile is carried in task 5; entity +0x2e/+0x30 are **target**
coordinates, not previous-position fields. At completion the original cell's
low ten bits are 1023 and destination low ten bits are the mobile slot; high
`0x40000000` bits remain intact. Occupancy alone is not movement completion.

The source countdown is 42 at the exact after-mobile arrival boundary. With
mobile-first ordering the later source visit decrements it to 41 in that same
update. Activation is therefore not an immediate arrival callback. On the
activation visit, source task 1 enters with countdown 1 and finishes with 50.
It swaps 6->47 or 14->48 and **pushes** task 12 `[sourceSlot,1,0]` above the
existing idle/wait stack. It does not replace that stack with a lone task 12.

Source-first activation is visible to the mobile's subsequent preamble in the
same update: deployment frame 1, delay 1, mode 1 at end of update. Mobile-first
activation occurs after the mobile visit: frame 0, delay 0, mode 1 until the next
update. Direction-zero deployment has 20 human / 14 alien frames, delay 2 each;
do not reuse constructor-direction FIN timing. JSON exports all 32 directional
timelines and the actual selected bank direction, not a representative FIN label.

Cancellation consumes the real order 13, leaving only task 13 `[50]`.
Retraction completes after 3 human / 7 alien further updates. Release returns
6/14, HP 800, the same Q8 position, direction 0, pending 0, order 255, exactly
task 1 `[65535,800,0]`, and mobile stand `(frame,delay,mode)=(0,0,0)`.
**Idle does not redispatch on the release update.** On the next update its
animation preamble advances stand delay to 1 and idle pushes wait `[7,800]`.
Human ends with credits 44/reserve 11956; alien credits 66/reserve 11934.

There are **zero RNG draws** throughout these clear-path round trips and the
post-release idle visits. Mode 2 cases start at index 0; mode 7 cases at 82.
Each retains its exact input index. Movement changes direction here, not RNG.
This does not authorize resetting a live cursor or asserting zero draws for
blocked paths, combat, effects or arbitrary missions.

## Bounded Idle Owner

At `0x414962` the selected weapon is -1. Types 6/14 take the nonweapon branch,
not the armed guard/idle RNG branch used by types 0/8/69/73. At `0x414a11` their
special bank at type +0x9c is preserved, including frame/delay/mode. Other banks
reset to stand mode 0 only when bank/mode differ. `0x414a70` pushes wait 7 with
current HP. Bottom idle's saved HP/repetition words are not refreshed here.

`reduceLegacyHarvesterIdle` models handler dispatch **after** the native
animation/counter preamble. Positive wait decrements; zero wait pops without
redispatch; HP mismatch pops and redispatches to idle in that visit. There is
no RNG draw or direction change. The reducer is pure and fails before mutation.

It requires normal status, positive signed-word HP, observer 255, no special
order/confusion/auxiliary work, an explicitly unarmed source profile, valid FIN
direction banks and the actual packed own-ground cell. Only stacks `1` and
`1,3` are supported. Pending orders, movement, turn, task 12, task 13, deployed
types and armed profiles return diagnostics. This module does not initialize
from render state, advance animation, provide movement, cancel orders, perform
resource effects or own release conversion. The existing resource owner owns
12/13; use the exact released state, not a synthetic constructor.

## Claim / Return Contract

Probe JSON `cases[].handshake` is the bounded evidence event sequence for the
owner implementing `claimResourceActor`. These are native snapshots, **not an
already-wired live API or a new shared ownership mechanism**.

1. `native-movement-completed`, `after-mobile-entity-update`: supplies exact
   slot/type/team/status/HP, Q8 position, direction, RNG cursor, pending/order,
   observer/auxiliary guards, complete logical stack and FIN state. It also
   supplies the source at this precise boundary: slot/type/status, reserve,
   rate word, position, task/countdown, FIN state, packed ground, MAP flags
   and phase. With mobile first this snapshot precedes the source's later visit.
2. `native-resource-activated`, `inside-source-entity-update`: supplies source
   and mobile before/after. Publish type/stack/animation changes synchronously
   before the next registered entity. Do not claim based solely on reserved
   occupancy, synthesize task 1, center the actor, or run deployment twice.
3. `native-resource-released`, `after-mobile-entity-update-no-idle-redispatch`:
   supplies exact task-13 entry and mobile idle exit plus the source state.
   Publish that exit once; run the new idle owner only at its next native visit.

Claim may transfer scheduling ownership at the proved movement-completion
boundary, but must retain the source countdown and run the real source/mobile
visit order until activation. Bind canonical task payloads, not copies that
diverge from the stack. Preserve actor identity, ground bits, FIN direction and
the shared RNG cursor throughout type swaps. Generation/command identity are
host metadata: they must come from the live owner, not from this fixture.

**Remaining live dependency:** the integration owner must supply a genuinely
completed movement state, complete current source/world state, generation,
slot-order scheduler and exclusive command/combat/resource ownership. This
probe does not prove the existing live movement adapter can supply those fields,
or that arbitrary HUMAN02/ALIEN02 runtime worlds are admitted. No shared claim,
simulation, transport, session or rendering implementation was changed.

## Verification

Eight original round trips; **424** complete native idle/wait dispatch frames
matched; **48** separately labelled synthetic handler-entry sensitivity cases
matched (same stand, move-bank reset, preserved once/complete bank, wait zero,
HP-loss wakeup). Four focused tests pass, including rejection without mutation.
Strict TypeScript checking of only the new owner/test passes. No full suite.

```sh
cd /Users/rafael/Downloads/darkcolony
export PYTHONDONTWRITEBYTECODE=1
export PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918
trace=/tmp/harvester-handoff-$(date +%Y%m%d-%H%M%S).json
python3 tools/research/harvester-handoff-20260919.py --suite > "$trace"
DC_HARVESTER_HANDOFF_TRACE="$trace" node --import tsx --test \
  tools/qa/legacy-harvester-idle.test.ts
node node_modules/typescript/bin/tsc --noEmit --strict --noUnusedLocals \
  --noUnusedParameters --skipLibCheck --target ES2022 --module ESNext \
  --moduleResolution bundler --allowImportingTsExtensions --types node \
  src/engine/legacy-harvester-idle.ts tools/qa/legacy-harvester-idle.test.ts
```

Without `DC_HARVESTER_HANDOFF_TRACE` the focused test executes the native probe;
missing Unicorn/Capstone is not silently skipped. The final local evidence is
`/tmp/harvester-native-20260919-golden.json` (temporary, regenerable by the above).
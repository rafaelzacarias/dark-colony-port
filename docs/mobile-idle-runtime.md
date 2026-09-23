# Native Mobile Idle Owner

2026-09-19. New isolated owner: [legacy-mobile-idle.ts](../src/engine/legacy-mobile-idle.ts).
No simulation, view, session, main, command registration, or UI changes.

## Decision

**Conditional support, not general Inspire shipping.** Source types 0, 8, 69,
and 73 have a native-compared idle/wait/turn task reducer. It can supply the
missing idle scheduler work for an explicitly admitted, same-team, noncombat
world. It does not implement guard acquisition, combat, movement, or arbitrary
tasks as no-ops. Any non-idle activity returns a diagnostic without mutation.

Initial idle Inspire is conditionally possible for 69/73 through
`legacyMobileIdleInspireDiagnostic(state, world) === null`. This additionally
requires charge >=32, no already-owned pending order, and no turn task anywhere
in the stack. Native waits can wake for a pending order in the same update;
native turns can defer that order. The existing eager live adapter must not
accept an initial command while a turn is pending. The same timing constraint
applies to an eager stop while idle. This module does not wire either command.

Subsequent idle is supported through the real wait/turn cycle, including after
Inspire completion. General `afterEntityUpdate` remains blocked when guard
combat, other source types, auxiliary animation work, or other activities can
run. In particular, the reference Inspire fixture includes air type 5, which
this four-type owner deliberately rejects. Reproducing its draw totals does
not authorize type 5 as a live owned entity.

## Native Evidence

[mobile-idle-20260919.py](../tools/research/mobile-idle-20260919.py) loads the
original source GAMESTAT rows and TRSC/GRAY FIN descriptors, including native
directional binding and deploy fallback. DC.EXE SHA-256:
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
The JSON records FIN hashes, source profiles, direction, full logical task
stacks, animation state, charge, RNG indices, consumed values, and write EIPs.

The new runtime cases clear every harness stub before native spawning and
dispatch. The original registered dispatcher `0x419bb8..0x419c0e`, entity update
`0x419248`, idle initializer `0x412654`, idle handler `0x4148b0`, wait handler
`0x4122c8`, and turn handler `0x412358` execute without runtime interceptions.
Source-loading lookup/string marshalling is fixture preparation, not runtime
task substitution. The existing independent Inspire baseline also reports
zero runtime interceptions.

There are 32 real-table cases, eight explicitly synthetic uniform-table
sensitivity cases, and the independent reference Inspire baseline. Real-table
cases cover all four types, index wrap, a forced turn branch at initial index
82, up to 120 updates, HP loss, stop, both casters at charges 0/31/32/33/255,
and pending Inspire delayed behind a turn. Entry/exit comparisons occur at the
actual task-dispatch boundary, after the native animation/counter preamble.
Initializer and continuation calls are compared separately, not inferred
from final draw totals.

### Fields And Consumption

| Native work | Proven behavior |
| --- | --- |
| `0x412654` | Push task 1, three words `[65535, hpLow16, 0]`; no RNG, charge, or direction writes. Constructor calls it before setting HP, so fresh spawn has HP word zero. |
| `0x412014` | Reset stack, consume pending initializer or push idle, mark consumed order 255. No intrinsic RNG draw. Pending deploy reads the old charge. |
| Idle no-target branch | Reset to stand mode 0 only if bank/mode changes; refresh saved HP and reset repetition count on HP loss. |
| `0x414c34` | Preincrement shared index modulo 256, read table dword, test low four bits. One draw, not a generic PRNG. |
| `0x414c79` | If the first value's low nibble is zero and source +0xdc is zero, consume a second entry; low byte becomes task-4 target direction. All four tested profiles have +0xdc = 0. |
| Idle wait | Push task 3 above the optional turn: `[15, hpLow16]` for the first three waits, then `[45, hpLow16]`. The turn does not execute on the push update. |
| Wait task | Pending order or changed HP pops and redispatches immediately. Positive count decrements. Count already zero pops but does not redispatch until the next update. |
| Turn task | Source +8 is 10 for all four types. Turn by at most 10 direction units, wrap at 256, shortest signed delta with the native +/-128 tie behavior. On reaching target, pop and redispatch immediately. Pending orders do not bypass an unfinished turn. |
| Charge | Constructor charge is 64. Source +0xf8 is 0 for 0/8, 1 for 69/73; counter 32 recharges casters to 65. Uniform tables of all 0 or all 32767 do not change these charge results. Charge is not a table draw. |
| Uniform sensitivity | All-zero table causes two idle draws and target direction 0; all-32767 table causes one. Actual constructor direction is preserved and supplied explicitly, never replaced with a random facing. These modified tables are not parity goldens. |

The reference Inspire trace reproduces three recipient idle draws on update 1,
none on update 2, and two newly idle caster draws on update 3. Those totals are
not constants in the owner: an encountered zero low nibble adds a direction
draw, and native wait/turn state controls which entities reach idle at all.

### Guard Counterexample

The empty battle is distinct from a visible adjacent hostile. The hostile
fixture supplies packed ground visibility `0x20000000`, the team's visibility
mask at team+0x19c0, explicit diplomacy, and original weapon/damage tables.
Simply placing a different-team unit in a zero-filled map did not exercise
acquisition.

On the first native update, all four types write target slot 153 into idle
word 0 through the real `0x435c14`/`0x435570` path. With the fixture's constructor
directions, types 0 and 73 also reach task 11 and consume two combat RNG entries
at `0x412e2e` and `0x411dc5`. Types 8 and 69 acquire the target but retain task 1
and consume no RNG in that entity update. Neither outcome is idle-no-target
behavior. The reducer rejects the entire supplied hostile world before
animation reset, task writes, or RNG advancement.

## Required Owner State

`LegacyMobileIdleState` requires source slot/type/team/status/HP, native tile-Q8
position, direction, observer byte +0x35, special-order byte +0xcb, confusion
byte +0xd0, auxiliary-animation pending byte +0xc7, both secondary animations
inactive, pending bytes +0x36/+0x37, charge, current global RNG index, logical
task payloads, and main FIN bank/frame/delay/mode. Inactive secondary animations
use mode 2 with a nonempty placeholder bank; an empty bank is not the native
inactivity test. No state is inferred from render coordinates or activity text.

`LegacyMobileIdleWorld` requires complete packed ground, air, and auxiliary
occupancy planes, resolved occupied slots, self-diplomacy byte 1, the actual
stand bank, correct source FIN family, and all 32 bound stand descriptors
(one frame with delay 2). Preserve high occupancy bits and 1022/1023 sentinels.
The source entity must occupy its declared ground cell. The conservative gate
requires every occupied record to be normal status 1 and the same team. It
rejects even invisible or distant foreign occupants; this is a sufficient
noncombat boundary, not a replacement guard scan or alliance model.

Only stacks `1`, `1,3`, `1,4`, and `1,4,3` are admitted for dispatch. Bottom idle
target must be 65535. Task 13 is accepted only for explicit continuation, not
for its animation/effect handler. HP is restricted to positive signed-word
values. Types 70-72/74-76, movement/attack/harvest/death and all other activities,
observer movement, confusion, special orders, active auxiliary animations,
unknown occupants, malformed fields, and other tasks fail before mutation.

## Hook Contract

`reduceLegacyMobileIdle(state, world, operation)` is pure. Success returns a
new state, ordered push/pop/reset transitions, exact RNG advances and values,
and an idle/deploy handoff. Failure returns only `supported: false` and a
diagnostic. There is no partial result to commit or generic unsupported-task
fallback. The source table is reused from the existing Inspire module.

- `initialize` models the literal `0x412654` push onto an empty stack. It does
  not reset an existing stack or advance animations/counters.
- `continue` models `0x412014` reset/initializer work, including explicit
  pending stop or Inspire. It does not run the resulting idle handler.
- `dispatch` models idle/wait/turn handler redispatch after the entity preamble.
  It can hand off a pending deploy but never executes task 13's effect.

For the [live adapter](inspire-live-integration.md), preflight every registered
entity and the complete supplied world before accepting an update, not only
the caster. An external owner must maintain allocation, occupancy, registration
order, source direction/FIN state and other non-Inspire preamble fields.
Do not install this reducer as an unconditional callback:

1. `onTaskTransition` must synchronize the reset/push once. The adapter already
   owns pending Inspire/stop and charge gates. Do not consume its command twice.
   Match the callback's chosen idle/deploy transition using explicit owner
   state while the old charge is still visible.
2. `afterEntityUpdate` runs idle dispatch only when the native entry task was
   in the admitted idle family and task 13 did not run in that entity update.
   Effect completion on update 2 may initialize idle, but must not immediately
   dispatch it: the first caster idle draw belongs to update 3.
3. Advance the source FIN preamble exactly once before task dispatch. Stand
   and deploy share the proven single-frame bank for these casters. Do not
   repeat adapter recharge, timer updates, deploy animation, or effect scan.
4. Commit each accepted entity's state/RNG synchronously before the next
   registered entity. Re-read occupancy and current index at the specified
   effect/continuation boundaries. Do not reseed between entities or hooks.

This is enough for a gated idle-only host to implement these hooks. It is not
a drop-in scheduler for arbitrary missions, an implementation of the spatial
owner, or permission to skip unsupported native work. No shared host was wired.

## RNG Startup

`0x479204` is an initialized executable dword with value zero. The table starts
at `0x478e04`; reads preincrement the index. The startup seed global `0x49469c`
is in zero-filled memory, not a raw initialized data record.

Native setter `0x411da4` stores `argument & 255`. Both direct call boundaries
were executed after poisoning the index to 197: startup slice
`0x40150b..0x401515` uses `0x49469c`; scenario-constructor slice
`0x41b920..0x41b938` uses incoming EBX. Inputs 0, 1, 255, 256 and 0x1234 produce
0, 1, 255, 0 and 52 respectively. The startup call is conditional on its
surrounding mode/flag checks. Zero in the image/BSS does not prove those inputs
remain zero during live menu setup.

**Fresh-menu round-trip and complete startup RNG consumption are not verified.**
These bounded probes do not emulate the whole GUI/OS startup. No default index,
simulation seed mapping, or unconditional menu reset is claimed. The host must
supply the exact current native index, including earlier owners' consumption.

## Verification

[legacy-mobile-idle.test.ts](../tools/qa/legacy-mobile-idle.test.ts): nine focused
tests pass, including direct native state/value comparisons, no runtime
interceptions, initializer/continuation, charge sensitivity, original 3/2
baseline, same-update guard acquisition, and transparent rejection of every
non-idle activity. Narrow reducer/test TypeScript checking is separate from
the repository full suite. No agents or browser are used.

```sh
PYTHONDONTWRITEBYTECODE=1 \
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
python3 tools/research/mobile-idle-20260919.py --suite > /tmp/mobile-idle-native.json
DC_MOBILE_IDLE_NATIVE_TRACE=/tmp/mobile-idle-native.json \
node --import tsx --test tools/qa/legacy-mobile-idle.test.ts
```

Without the trace environment variable the test runs the bounded native probe
itself. Capstone 5 and Unicorn 2 must be available. No fabricated fixture or
silent skip is used when dependencies are absent.
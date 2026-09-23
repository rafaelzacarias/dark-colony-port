# Source-Native Player Orders

The subsequent [bounded MissionView bridge](mission-native-player-orders-20260920.md)
uses the same guards through a frame-free `previewSourceNativePlayerOrder` and
native acquisition lookup; receipt preflight still requires the actual explicit
frame. The evidence below describes the original adapter/probe work, not UI parity.

## Scope

[Adapter](../src/engine/source-native-player-orders.ts),
[tests](../tools/qa/source-native-player-orders.test.ts), and
[fresh x86 probe](../tools/qa/source-native-player-orders-native.py).
This is `typed-native-command-api-not-ui-parity`: one explicit selected type-0
binding, externally supplied local team/frame, authenticated task/combat ownership,
and a deferred receipt submitted to the existing session. No UI selection, click
coordinates, input provenance, mission visibility integration or full mission admission
is established. This follow-up changes only the probe, tests and this document.

MoveOnly is order **2**, Attack is order **7**, and Stop is order **13**, NOT 0.
Order 0 reaches original diagnostic caller `0x41948c`; the zero byte at the end of
a packet is a stream terminator, not a Stop order.

MoveOnly/Attack use one 17-byte framed packet: mode 5 sets pending/order, followed
by mode 7 with one Q8 destination and one recipient. The word at byte offset 14
is the **selected source slot**, not the enemy slot. Attack's target binding is an
adapter guard requiring the current native acquisition result; it does not encode
target locking. Routes remain horizontal, clear, same-PTH-family, one to three cells.
Stop uses `[7,0,5,slotLow,slotHigh,13,0]` and waits for native acceptance.

The adapter validates identities/generations/raw bytes, hostile relations and current
visibility/acquisition; it preflights the existing receiver and host visit on a clone.
Failures return `UnsupportedPath` without publishing an input. No new runtime path
or visibility implementation was added, and no API guard was weakened.

## Changed Probe Boundary

The prior `/tmp/dc-player-orders-attack-20260920-p11.log` failed while trying to
reveal a target by moving a scout, before Attack acquisition/consumption. Its terrain
setup lacked the original loader's packing. The repaired probe reuses only
`load_terrain` from the [visibility probe](../tools/qa/native-visibility-native.py),
running `0x453421..0x453790` over original MAP/BTS before full SCN construction.
All 21 original HUMAN02 actors retain their registry slots; new actors use actual
`0x41b750` constructors. Tests check the resulting type/team bytes, not inferred faction.

The actual `0x40bf80` world initializer establishes local team 0. Original world
service `0x41989e..0x419990`, including mask setter `0x41993f..0x41996a`, establishes
the `0x40000000` team mask and relation cache. Neither is fabricated in the probe.
At explicit visibility counter 16, `0x419a30` executes original clear `0x4456f0`
then compute `0x44a6d4`. No exploration/sight bits are directly written.
The command visit is a separate fresh fixture boundary, not a replay of host frame 80.

As in the bounded visibility owner, only the selected source is a visibility producer.
Other eligible producers are explicitly excluded at `0x44a74c->0x44ab5b`, with
native inactive-slot and high-water checks preserved. This is a declared visibility
setup intervention, not full-world visibility. `runtimeIntercepts: []` describes
command receiver/registered execution; it does not hide the separately reported
visibility producer exclusion or source loader file/allocation boundaries.

The [visibility owner's evidence](native-visibility-owner-20260920.md) remains the
independent 28-case / 196,473-write matrix, trace
`/tmp/dc-visibility-matrix-own31.jsonl`, SHA-256
`66bf4aeab4b08ce1d9e919ee871ea2298aee916bc29e427da8d7bd1cbe66a22c`.
It was not regenerated or modified here. Its original sound-gate proof reaches
`0x431e08` after compute AND clear, demonstrating persistent exploration rather
than playback or current-sight equivalence.

## Positive And Limited Cases

- Canonical source 170/team 0 at (67,48), victim 171/team 2 at (69,48): cell 4677
  changes naturally from `0x000000ab` to `0xc00000ab`; original `0x435570` acquires
  171. The actual command receiver matches all 220 TypeScript receipt bytes.
  This case explicitly uses `consume: false` and proves NO registered completion.
  Attempting its registered visit reached an uninitialized sound diagnostic at
  caller `0x431c33` (`/tmp/dc-player-orders-canonical-20260920-v06.log`); no sound
  helper was stubbed or sound ownership inferred.
- The existing session Attack case uses its actual current source/target cells
  and teams to create a separate fresh native constructor fixture. Its computed
  visibility, original acquisition, full receipt-byte comparison and original
  `0x419248` consumption pass. This is not whole-state parity with the already-moving
  session actor: the fresh native constructor uses the cell center.
- Independently, the existing session consumes that adapter receipt by counter 95:
  pending/order becomes `[0,255]`, base task remains 7, and native combat journals
  contain launch/impact with target HP loss. Damage alone is not the acceptance check.
  Attack therefore retains its bounded API support; arbitrary target locking,
  canonical audible completion and general pursuit remain unproved.
- MoveOnly and Stop each execute fresh native receiver/registered visits and existing
  session consumption. Stop reaches idle; replaying the stale Move receipt rejects
  without checkpoint changes. Guards cover stale/raw/foreign bindings, hidden targets,
  invalid routes, unowned types, unauthenticated owners and receipt overwrite.
- Three additional freshly generated initializer goldens compare receipt/registered
  actor bytes and RNG/task budget for MoveOnly, Attack and Stop. They do not establish
  hostile-target acquisition by themselves. The fourth golden is the order-zero rejection.

## Verification

Owned suite: **5 passed, 0 failed, 0 skipped**, including four fresh command packet
cases (three registered completions plus the canonical receiver-only case), three
initializer parity cases and the order-zero negative control.
Final focused log: `/tmp/dc-player-orders-final-20260920-v11.log`.
Strict TypeScript/no-unused log: `/tmp/dc-player-orders-final-types-20260920-v12.log`.
Documentation links/evidence check: `/tmp/dc-player-orders-docs-20260920-v13.log`.
The strengthened host-consumption check also passed alone in
`/tmp/dc-player-orders-host-consumption-20260920-v10.log`.

Only this test file and the strict adapter/test import slice were run. No full suite,
browser, subagents, package/asset changes, or host/view/session/native-visibility edits.
Existing fire/projectile source oracles remain test evidence, never runtime seeds;
command packet probes are freshly executed, not substituted with those oracles.
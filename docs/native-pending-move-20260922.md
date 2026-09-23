# ALIEN02 Packet 25: Task 6 Pending 7

## Integrated Follow-Up

The exact helper is now wired into the production registered host, before the
ordinary task-6 budget increment. The three tests import that real host; the
obsolete in-memory transpiled host adapter has been removed. The 52-visit phase25
and 1,540-visit boundaries1..31 comparisons pass unchanged.
See [the combined route integration](native-route-gaps-20260922.md) for full
32-boundary results in both worlds, endpoint source proof, and remaining limits.
The original implementation handoff below records the pre-integration evidence.

## Result

[The new pure helper](../src/engine/legacy-native-pending-move.ts) implements the
RNAT/type-25 pending-7 interruption at `0x4157ec -> 0x412014`. It returns an
immutable, identity-authenticated command for the existing registered RNAT task-8
owner at `0x416104`. It never claims a completed registered visit or mutates its
input. No production host integration has been applied by this change.

Original ALIEN02 packet 25, slot 194, HP 750:

- Task 6 enters with pending bytes `+0x36/+0x37 = [1,7]`, waypoint count `+0xc6 = 1`.
- Budget increments from 0 to 1 before pending dispatch. The initializer clears
  the old stack, pushes task 7 with no words and task 8 with words `[0,1]`, and
  changes pending bytes to `[0,255]`. All 220 bytes match original task-8 entry.
- Existing task 8 copies the actual waypoint, advances its cursor, and calls
  `0x414ce4` with route mode 1 and correction flag 0. Existing authenticated
  search/distance/serialization computes the new six-step route, not a recorded
  path or expected-state replay.
- Task 6 executes again, increasing budget to 2. Task 4 completes the turn in
  this same visit, then task 5 moves +30 Q8 in X. Final heading is 0, position
  `(14990,20096)`, and active task is **5**, not 4. RNG remains **105 -> 105**.
- Later actors continue with the same shared state. Whole-packet RNG ends at
  107; it is not reset to slot 194's value.

The source capture contains the original type-25 constructor during packet 8.
This work does not implement or reclassify its constructor/TRO/RENAT ownership,
nor does it replace the previously proven mode-5/mode-7 packet receiver.

## Production Handoff

`native-registered-host.ts` belongs to another agent and was not edited here.
The main owner can apply this exact integration:

1. Import `reduceLegacyNativePendingMove` and `resolveLegacyNativePendingMove`
   from `./legacy-native-pending-move`.
2. Inside the existing `(type === 25 || troopRoute) && opcode === 6 &&
   binding.groundRoute` branch, insert the following **before** the existing
   `++mutable.task6Budget` guard:

```ts
if (type === 25 && raw[0x36]) {
  const pendingFrame = {
    boundary: 0x4157ec as const,
    index,
    slot,
    registeredSlot: game.getInt16(0x468ec + index * 2, true),
    raw,
    rngCursor: mutable.rngCursor,
    task6Budget: mutable.task6Budget,
  };
  const pending = resolveLegacyNativePendingMove(
    reduceLegacyNativePendingMove(pendingFrame), pendingFrame,
  );
  raw.set(pending.raw);
  mutable.task6Budget = pending.task6Budget;
  continue;
}
```

3. Keep the existing nonpending task-6 guard and its increment unchanged. The
   second task-6 dispatch must see budget 1 and increase it to 2. Do not increment
   before calling this helper, reset the budget on redispatch, rerun FIN, or
   return a completed visit at the handoff. Preserve the per-registry-index reset
   and the existing finite dispatcher bound.
4. Let the current task-8 branch consume the new stack and use its existing
   typed source route owner. Its scratch, raw stack, ground reservation, FIN and
   RNG remain on the same staged candidate. Any later error rejects the entire
   phase, including already-computed pending consumption and occupancy changes.

The caller must already have passed the host's authenticated type/FIN/source
configuration and registered preamble checks. This helper is a narrow primitive,
not a new source configuration authority. It leaves all FIN pointers and frame
bytes untouched. Actual source RNAT FIN timelines and original pointer
relocations remain owned by `createNativeRegisteredConfiguration`; no normalized
stand/move IDs are substituted for those original addresses.

The command is bound to exact registry index, slot, current registered value,
220-byte raw record, RNG cursor and preincrement budget. A copied/forged command,
stale waypoint/path/pending bytes, index/RNG/budget mismatch, unsupported opcode,
invalid count, or exhausted incoming budget rejects without mutation. The helper
accepts only budget 0..9. The native budget-limit wait path, other actor types,
other pending opcodes, empty waypoint lists and special `+0xcb` initialization
remain outside this helper's scope. Once consumed, pending is cleared, so the
same command cannot recursively reinitialize its own resulting record.

## Proof And Limits

[Focused tests](../tools/qa/legacy-native-pending-move.test.ts) originally used
a test-only in-memory host insertion. They now invoke the real production host
with the exact integration above and supply no expected output to runtime code.

- **3 tests pass**, no skips. Direct initializer output matches all 220 bytes.
- Original packet 25: **52/52 visits** compare raw before/after, order, task,
  shared RNG, budgets and registry high water. The final complete game,
  dependencies, all occupancy planes, route scratch/globals, production flag,
  CRT state and carrier FIN compare exactly.
- Original boundaries 1..31: **31 complete registered phases / 1,540 visits**
  compare the same whole-phase state and each visit's raw/globals. Every visit
  begins with budget zero. These are explicit original boundary inputs, not
  31 complete shared-world cycles generated by the portable implementation.
- Invalid opcode/count/RNG/scratch and a FIN failure after slot 194 preserve the
  entire host snapshot on repeated attempts. Separate stale command and malformed
  index/pending/RNG/budget controls verify detached, atomic failure.
- Strict ES2022 / ES2023,DOM no-unused typechecking is scoped to these files.

Evidence reuses the unchanged original 40-cycle capture
`/tmp/dc-ground-ALIEN-40-p34.json`, SHA-256
`38ff5df9524b275e3b252c92433731c6aac567aa73c3e682e41c4148d2790e59`.
It reports zero runtime core interceptions; the inherited startup/platform
substitutions are unchanged. Successful isolated test output is
`/tmp/dc-pending-move-isolated-20260922-p11.log`.

```sh
DC_GROUND_ALIEN_TRACE=/tmp/dc-ground-ALIEN-40-p34.json \
  node --import tsx --test tools/qa/legacy-native-pending-move.test.ts
```

Without that environment variable the test regenerates the capture with the
existing original native observer. This run reused the recorded capture; it did
not regenerate it. The unchanged native interpreter/Python prerequisites of the
observer are still required for regeneration.

Packet 32's occupied-path work belongs to the other owner and is not certified
by this change. General path correction, budget-limit waiting, active acquisition,
combat, source whole-world scheduling and mission admission remain separate.
`admitted` and `executableWholeGame` stay false. No agents, browser, full suite,
package/assets changes, legacy-ai-task edits or shared-host edits were used.
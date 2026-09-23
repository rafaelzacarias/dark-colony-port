# Native Nonlethal Damage Feedback

Date: 2026-09-19. Status: native moving-target and reciprocal firing evidence
extended; no new host/session/source-provider admission or original mission
certification. The new comparisons required no runtime change.

## Owner and API

[legacy-ai-task.ts](../src/engine/legacy-ai-task.ts) extends the existing
`reduceLegacyAiRegisteredVisit(frame)` API. No new receipt, task, or public input
field is introduced. The caller supplies the current raw220 actor, actual slot,
counter, task6 budget, shared RNG cursor/table, and authenticated source world.
The dedicated tests also supply current combat actors, native fire tables and
the real projectile pool. Every returned actor/pool/RNG state feeds the next
owned visit or projectile pass; rejection publishes no staged state.

The caller must additionally provide `world.fin` delay timelines for every hit
reaction bank at `typeBytes+0xbc+4*variant`, with all 32 direction bindings.
Missing timelines reject as `invalid-source-fin-profile`. This work does not
teach existing source providers to emit these banks or expand any host's
authenticated configuration. Native bank addresses in the oracle are fixture
identities, not portable runtime configuration.

## Original Behavior

The original registered entry `0x419248` checks secondary animation state using
`0x426334` before advancing animations or dispatching the current task:

- When secondary mode is complete (`actor+0x22 == 2`) and `actor+c7 != 0`,
  `0x4193de..0x41940f` preincrements the shared RNG cursor modulo 256 and selects
  `randomTable[cursor] % reactionCount`. It resets that hit bank at `actor+0x1c`
  to frame0/delay0/mode1 using `0x42630c`.
- `0x419414` clears only `c7`. The projectile-written `c8/c9` latches stay1.
- The primary and secondary animations advance before task dispatch. Secondary
  completion does not consume new pending damage in that same visit: the next
  visit consumes it. An active reaction neither rerolls nor clears `c7`.
- Ordinary task dispatch continues. In the repeated-hit evidence, task3 detects
  changed HP, pops, and redispatches idle with its genuine RNG draw. A pending
  native Stop receipt still reaches the existing order initializer.

This is a secondary animation reaction, not a fabricated retaliation task.
No actor damage bytes, HP, task payloads, FIN state or positions are patched to
make the native output fit the reducer.

## Admission Boundary

Nonzero feedback is admitted only for ordinary types0/8, `c8 == c9 == 1`, and
their demonstrated source reaction counts7/6 respectively. Secondary state must
be the completed stand bank or one of those reaction banks in mode1/2, with an
in-range directional frame. Negative nonzero selector remainders reject.

All existing positive-HP, status1, constructor auxiliary-state, source-record,
occupancy, task-stack, movement, acquisition and fire guards still apply.
`ca..cc`, `cf..d0`, `d6..db` and other previously unsupported auxiliary fields
remain closed. Feedback on types2/3/69/73, incomplete latches, other reaction
counts, missing profiles and noncanonical secondary states reject atomically.
The existing registered task envelope is unchanged; this does not admit a new
task opcode. Dedicated damaged-target comparisons now cover idle, HP-interrupted
wait, pending Stop, type0 displacement on clear horizontal same-family PTH
routes of 1-3 cells, and reciprocal type0/type8 firing duels. No general route,
obstacle avoidance, replanning, or other damaged movement class is established.

Lethal projectile damage, death/unregistration, general special effects,
new reaction tasks and original mission integration remain unsupported.
`combatGate.readyEndToEndCombat` remains false. Its existing required-owner list
is conservative caller orchestration metadata, not a claim that the separate
pure projectile reducer is absent.

## Preserved Evidence

[native-damaged-actor-native.py](../tools/qa/native-damaged-actor-native.py)
reuses the original full-SCN, PTH, FIN, relation and constructor setup in
[nativeactor-task-native.py](../tools/qa/nativeactor-task-native.py) and actual
launch/travel/collision/damage from
[native-projectiles-native.py](../tools/qa/native-projectiles-native.py).
Both actors are asserted present in the original registry. Calls continue at
`0x419248`; no task, reaction, RNG or damage handler is stubbed.

Eight fresh cases cover both target types: single hit, repeated hits, native
mode5 Stop, and RNG warmup253. The latter uses original RNG calls before launch
and proves the reaction's cursor255-to0 wrap. The repeated cases explicitly
advance the shooter's reload for14 visits before the first target visit, then
alternate target/source registered visits and projectile passes. This bounded
caller schedule creates hits during the active reaction without changing actor
bytes; it is not a natural campaign scheduler trace.

[native-damaged-actor.test.ts](../tools/qa/native-damaged-actor.test.ts) chains
332 registered visits (224 target,108 shooter), plus14 projectile passes
including the initial impacts. Comparisons cover all800 raw220 actors, all80960
projectile bytes, pool heads/high-water/statistics, ground and ordered writes,
RNG cursor and every draw, and task6 budget. Native air/extra/registry hashes
remain unchanged. Repeated cases each produce four real nonlethal hits; queued
feedback survives the animation-completion visit and later starts another
reaction. Constructor equality excludes only HP and the three damage bytes.

Prior golden: `/tmp/dc-damaged-native-r4-20260919-1941.jsonl`.
SHA256: `638b218adee38dadb7b2dd831363dfe44694c96059c63144c7d9ff8a13c2250d`.
Original EXE SHA256: `65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.

Reproduce from the repository root, without an original game window:

```sh
golden=$(mktemp /tmp/dc-damaged-native-20260919-XXXXXX)
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 -B tools/qa/native-damaged-actor-native.py --suite > "$golden"
DC_NATIVE_DAMAGED_ACTOR_TRACE="$golden" \
  node --import tsx --test tools/qa/native-damaged-actor.test.ts
```

Prior verification: nine dedicated tests,69 neighboring fire/projectile tests using
the valid-reuse goldens,85 registered-movement tests: **163 passing**. Scoped
strict ES2022 TypeScript check and editor diagnostics pass. Logs:
`/tmp/dc-damaged-compare-r4-20260919-1941.log`,
`/tmp/dc-damaged-neighbors-20260919-1944.log`,
`/tmp/dc-damaged-movement-20260919-1946.log`,
`/tmp/dc-damaged-types-20260919-1944.log`.
No full suite, browser, package/assets, transport, session or provider edits.

## Moving and Firing Follow-Up

Fresh golden: `/tmp/dc-damaged-active-final-20260919-2035.jsonl`.
SHA256: `09b8759bbd3cab3d0593eb76450bc18154235da2f926aea49f681c303c21cc20`.
Use `DC_NATIVE_DAMAGED_ACTOR_TRACE` with this file. The reproduction command
above now captures all13 cases. `--suite --case INDEX` captures one case.
The test reads one JSONL case at a time rather than buffering the full golden.
The first eight JSONL records are byte-for-byte identical to the prior golden.

Five added cases each compare45 rounds, counters17-61, in the order target
registered visit, source registered visit, one projectile phase (`0x44293c`).
Every round shares the current actor pool, ground occupancy, RNG and projectile
pool. Task6 budget resets once per round, not between the two actors. Both
participants remain in the original registry and retain positive HP after
every compared call. This is a bounded original caller, not a campaign scheduler
or a trace approaching the lethal threshold.

| Case | Positive path | Native impact evidence |
| --- | --- | --- |
| 8 | Type0 Move, 1 cell | Counter37 hits during task5 and actual displacement; later returns fire |
| 9 | Type0 Move, 2 cells | Counter37 hits during task5 and actual displacement; later returns fire |
| 10 | Type0 Move, 3 cells | Counters37/55 hit during task5 and actual displacement |
| 11 | Type0 Attack duel | Target hit in task11 at38/55; shooter hit at31/48 |
| 12 | Type8 Attack duel | Target hit in task11 at25/42/59; shooter hit at27/44/61 |

The moving targets continue to displace after damage; the tests explicitly
exclude turn-only impacts from the moving-positive assertion. All three routes
finish in their requested destination cells without snapping positions. Both
duels prove a damaged target launches another shot and return projectiles damage
the original shooter, whose subsequent registered visits are also compared.
Final target/shooter HP is700/750 for type0 and728/746 for type8. No lethal phase
is admitted.

Preparation is explicit and separate from these rounds. The existing source
fixture constructs actual actors, loads SCN/PTH/FIN/collision geometry, and
executes16 original source attack visits producing one real launch. Extra scout
constructors, Move receipts and registered visits explore the source cell and
the target corridor. Scouts are removed with original `0x434d48` before the
comparison; their packets, actor transitions and native teardown are recorded.
This fixture teardown is not a runtime death/unregistration proof. Auxiliary
scouts otherwise intercepted return fire, so a firing animation alone was not
accepted as duel evidence. An exploratory type8 moving case had only a
turn-time hit and is not included as a moving-positive case.

At the first projectile-phase boundary the target receives a real mode5+7
Move/Attack packet through `0x41defc`; the test independently replays its receipt
against all800 actors. Source launch setup remains in `projectile.fire`.
Only the explicit active `visits` are the new compared schedule; the reused
projectile extractor's trailing drain snapshots are not counted. No HP, raw
task, feedback, animation state, heading or position is patched to obtain the
positive paths. No native movement/fire/damage handler is intercepted.

Totals now cover **782 registered visits and239 projectile passes**, including
450 registered visits and225 phases in the five new cases. Comparisons retain
all800 raw220 actors, all80960 projectile bytes, pool heads/high-water/statistics,
current ground and ordered writes, shared RNG and every draw, and task6 budget.
Air/extra/registry hashes remain unchanged throughout the compared schedule.

New negatives start from real damaged moving or launching visits: missing
reaction banks/directions, mismatched source records, missing combat/fire
sources, and missing raw fire FIN reject without input mutation or publishing
actor/projectile state. Separate synthetic negative inputs set HP to0/-1 for
actor admission or1 immediately before a proven impact to require lethal
projectile rejection; missing projectile weapon sources reject too. These
negative mutations are not fed into the original positive oracle.

Final verification: **19 dedicated tests pass**, scoped strict ES2022 target
with ES2023/DOM libraries passes, editor diagnostics clean. No runtime gap was
exposed, so `legacy-ai-task.ts` is unchanged; host/source-provider work remains
outside this change. Only this document and the two damaged-actor QA files were
edited. No new full suite, browser, assets, packages or git operations.

Logs: `/tmp/dc-damaged-active-final-compare-20260919-2035.log`,
`/tmp/dc-damaged-active-types-20260919-2035.log`,
`/tmp/dc-damaged-active-metrics-20260919-2038.log`.
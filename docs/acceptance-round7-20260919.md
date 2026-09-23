# Phase 3-5 Acceptance, Round 7

## Final Orchestrator Addendum

This section supersedes intermediate pending counts and native setup gaps below.
**Phases 1-2 remain accepted; Phases 3-5 remain unaccepted.** Final current-source
gate: **966 passed, zero failed, four skips**, clean typechecking and build.

The [native oracle](ai-policy-runtime-20260919.md) now executes complete original
SCN setup, 120 city calls, team/queue defaults, dependencies, explicit seed setters,
relations, local transport and native PTH initialization. Natural scheduling returns
14,160 HUMAN / 1,200 ALIEN worlds. Target four-group frames are 14,124 and 1,160;
seven ALIEN actors consume orders in world 1,161. HUMAN's zero target consumptions
remain negative evidence. No extra selector or frozen-clock visits supply these
results. TS active AI is still missing; native reference execution is not its port.

[Normal-body masking](mission-scene-adapter-20260919.md) is live for verified
ground/integer source captures, with explicit fallback and no global sorting.
An embedded original-frame fixture exercised one clip/37 spans and nonblank
WebGL terrain. Full source queue/effect/shadow/viewport parity remains open.

[Resource ownership](resource-actor-ownership.md), atomic session handoff and
[native wait/movement](harvester-host-wait-20260919.md) are implemented with
checkpoints and native comparisons. Eight source-separated arrival traces start
with zero funds and produce income 44/66. The mover admits only its proved
corridor/start states, not arbitrary paths; complete LIVE handoff/Harvest remains
disabled. The source loader admits four missions; ten pass pure TRO/palette
preflight. See [precise admission diagnostics](campaign-progression.md).

Remaining requirements are actual TS AI and global task ownership, general
harvesting/construction/abilities, full scene composition and independent ordinary
input, device, reference and sustained performance evidence. Browser probes were
removed; original assets and the existing save were retained.

2026-09-19. **Phases 1-2 retain their accepted pinned scope. Phases 3-5
remain partial. Current full-suite count/status: pending.** Historical 866-test
results do not certify this revision. This review reads current source, the
existing clean capture and static executable disassembly; it runs no native
probe, test, browser, agent, typecheck or build. Only this document is changed.

## Current Evidence

The existing `/tmp/dc-ai-native-world-clean-20260919-r12.jsonl` has SHA-256
`0c5b65be2fd37dffadf82bdc10408c744a40e1e05fdf37b9efc79f9d5cb002b1`
(independently read and hashed, not rerun). It records **14096 HUMAN02 / 1136
ALIEN02** original world entries and returns, null failures and four completed
target groups. Relations, local session/ready/packet transport, PTH cell
coordinates and projectile reclamation are no longer missing dependencies.
HUMAN has 12152 projectile-constructor/reload entries, 12137 reclaims and final
high-water 17. These counts are not a firing-cadence comparison.

The final extra selector consumes actor orders for HUMAN slot **157**, ALIEN
**160,161,162,165,166,167,199**. Round 6's HUMAN-empty-order statement is obsolete.
The [AI report](ai-policy-runtime-20260919.md) reports 14 focused passing tests;
this review does not rerun or promote that count to an integrated-suite result.

## Why The Flags Remain False

Both flags are literal output values in the
[probe](../tools/research/ai-policy-20260919.py#L1723), not computed failure
diagnoses. Complete bounded world execution is established for the supplied
initial state; complete source-world initialization is not. The specific
remaining semantic gaps, in priority order, are:

1. **SCN initialization omits cities and nonzero team defaults.**
   [initialize_source_world](../tools/research/ai-policy-20260919.py#L497)
   loads all eight teams' race/funds/AI/coordinates, scans their nine City/unit
   rows, and executes all placement rows. It is not the complete SCN loader.
   Each team scan stops at `0x41c289`. Static original code immediately after
   that boundary writes four `side+0x108` bytes to 1, four words at
   `side+0xd9c..+0xda2` to -1 and `side+0xe1c` to 3, among other resets
   (`side = game+0xb98+team*0xe30`). The probe leaves these at cleared defaults.
   It then skips `0x41c3ef..0x41c428`, which calls **0x444f14 for 15 slots
   per team, eight teams**, and jumps to placements starting at slot 152.
   City HP fields are parsed, but city actors/footprints are not constructed
   by this startup path. HUMAN02 team 0 has a real base and two enabled
   buildings; absent physical city state is not harmless presentation I/O.
   This is an **omission**, not an installed success-return city stub.
   The separate [colony fixture](../tools/qa/legacy-colony.test.ts#L113)
   does call 0x444f14 but intercepts animation/task/registration and stops
   before footprint continuation; it is not evidence that this AI world did so.
2. **Source dependency/availability setup is incomplete.** The AI initializer
   does not execute the SCN dependency-list writes at `side+0xda4`
   (`0x41bf38`), documented in [team fields](scenario-team-fields.md).
   HUMAN02 team 0's list is nonempty. Color and AI-slot parsing are also not
   a full loader pass; do not assume their effects without tracing consumers.
   Thus source-derived City HP and unit levels do not certify live city
   availability, queues, production rules, collision or battle targets.
3. **Policy RNG startup is implicit.** The AI machine inherits image cursor
   `0x479204 = 0`; it does not execute the startup/SCN seed setters
   `0x40150b..0x401515` / `0x41b920..0x41b938`. Their proven contract is
   `seed & 255`, not an established installed-menu seed; see
   [RNG startup](mobile-idle-runtime.md#rng-startup). Explicit CRT seed 1 is a
   different generator. Mode 4 already consumes its native draw, despite
   emitting no action. Preserve one global cursor across all teams and other
   owners; do not seed each team or optimize away mode-4 draws.
4. **Four-group proof is checkpoint coverage, not scheduler coverage.**
   [The full-world loop](../tools/research/ai-policy-20260919.py#L1633)
   receives native clock packets; original world code increments counters,
   scans TRO and invokes 0x41ac2c. No per-tick counter or HP repair is applied.
   However, group-return capture is gated on `counter == limit`; it then
   explicitly calls 0x41ab20 for the target and visits ordered actors at the
   frozen clock. These visits are not subsequent worlds. Capture team/group
   identity and returns inside historical scheduler visits, then continue
   normal worlds through packet/task feedback. Do not claim that the
   scheduler failed to run merely because this assertion uses an extra call.

The exact effect of correcting these omitted initial states on activation,
orders and battle history has **not been measured**. Existing long-run goldens
cannot certify the corrected world in advance.

## What Is Not A Demonstrated Replacement

- No battle-actor HP clamp, actor relocation, air conversion or modified PTH
  family was found on the clean path. Placements use original constructors;
  GAMESTAT/WEAPSTAT scalar fields and MBULLET conversions are source-backed.
  [FIN loading](../tools/research/ai-policy-20260919.py#L762) copies source
  timeline/bank state from a separate binding fixture, not prerecorded tasks.
- The game and receive buffer execute original clearing and constructor code
  from poisoned storage. Relations/session/PTH also have actual constructor
  evidence. It is incorrect to call the whole host an invented zeroed object.
  Map/MTG planes, some globals and later policy allocations still use explicit
  harness storage/setup; that is not blanket proof of the entire startup.
- File reads, allocation, formatting, FIN lookup, millisecond clock, debug
  logging and unavailable audio output are explicit boundaries. Audio returns
  -1 only at the output method; enclosing sound selection/RNG still executes.
  Local transport is original in-memory delivery, not a network-success stub.
  These boundaries alone do not invalidate a bounded decision comparison.
- `runtimeCoreInterceptions: []` is initialized empty and never populated by
  an interception detector. Source inspection supports the absence of listed
  runtime AI/task/relation replacements, but the array alone proves nothing.

Unrecovered installed settings and absent human/original-game reference are
separate acceptance limits, not evidence of hidden HP/position substitution.
An explicitly seeded source profile can support deterministic reducer work
without first recovering somebody's historical menu settings.

## TypeScript And Harvester Limits

A bounded decision reducer is now a reasonable next implementation target,
using complete native before/after buffers plus branch-changing source-state
controls. It is not justified to infer policy from final packets alone.
[legacy-ai.ts](../src/engine/legacy-ai.ts) implements prelude/cleanup,
group-1/2 order dispatch and inactive selection, not active mission AI.
Missing owners include first assignment 0x457568, observation 0x456ad0,
demand/rules 0x457940/0x4578d0, decisions 0x4593a8/0x458b44, group-0/3
objective/order behavior and persistent scheduler/packet/world transactions.
Native execution of those routines is reference evidence, not their TS port.

[Harvester movement](../src/engine/legacy-harvester-movement.ts#L102) is a real
reducer, not trajectory replay: signed step addition, entry-zero pop, truncated
step count, turn wrap, FIN ordering and Stop chronology are computed. But task
8 emits only east nibble 4; task 6 accepts only that nibble and builds
`[40,0,...]`. Guards pin one PTH hash, three family-70 cells, slots 152/153,
HP 800 and `(67,48)->(69,48)`. This is **both bounded validation and specialized
route logic**, not a general mover hidden behind a removable guard. Arbitrary
routes, obstacles/replanning, diagonals, damaged actors and combat remain out.
Preserving the real 17760-Q8 arrival instead of snapping to 17792 is accepted
within that corridor; it cannot support shipping full AI.

## Phase Gates And Next Work

| Phase | Exact remaining gate / next path |
| --- | --- |
| P3 | First close SCN team defaults/dependencies and actual city constructor/footprint setup, retaining source positions and stats. Establish an explicit shared RNG startup contract; then capture natural scheduler groups and later world feedback. Port one decision boundary at a time against complete-buffer goldens, keeping mode 3 closed until host integration exists. Separately broaden native movement and implement joint view/session/simulation claim, settlement, retraction and acknowledged return. Full construction/upgrades, cancellation/destruction/refunds, shared task/occupancy/RNG, combat cadence/projectile/special/visibility timing remain uncertified. |
| P4 | The [live mask hook](../src/mission-view.ts#L1544) is present for bounded normal bodies; raw indexed coverage is available. Missing are complete native queue admission/counters/ties, city/auxiliary/map-object/effect contributions and shadow/mirror/elevation passes. The [live mask evidence](mission-scene-adapter-20260919.md#live-consumer-follow-up) records fake-device draw calls, not GPU parity; its chosen placement removes no pixels. Resource view admits neutral VENT only; mobile resource ownership, full action/construction/ability HUD and native ambient scheduling remain. Device audibility/gapless behavior is unverified. |
| P5 | Current integrated suite count is pending. Retain opening-mission command-API wins/losses and replay evidence, but require ordinary UI-input outcomes, later-campaign progression, original-game reference comparison, WebKit/iOS/device checks and sustained rendered FPS/memory evidence. Neither native instruction counts nor CPU/helper tests satisfy these gates. |

Host idle/wait `1,3` support now exists; older resource text calling it absent
is superseded by [harvester host evidence](harvester-host-wait-20260919.md).
The [view](../src/mission-view.ts#L655) still disables Harvest and rejects
6/14/47/48 admission. Do not confuse a completed helper with that missing
public-command transaction. Full-suite verification remains the orchestrator's
pending gate, not work performed by this review.
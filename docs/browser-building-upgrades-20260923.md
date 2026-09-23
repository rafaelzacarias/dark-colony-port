# Browser City Building-Level Upgrades

## Status And Ownership

Engine API implemented in [browser-construction.ts](../src/engine/browser-construction.ts).
The final integration now wires CampaignSession, game-data, MissionView and the
existing construction panel. Fresh adapted construction profiles explicitly
enable `supportedActions: ["purchase", "upgrade"]`; saved profiles retain exact
absence or their independently reloaded slots/actions/duration. The ordinary
mission loader still requires opt-in. See [Final Integration](#final-integration).

This extends [fixed-home construction v2](browser-fixed-construction-20260923.md)
with an explicit opt-in for upgrading an existing ready level-0 City slot.
Supported targets are slots 2 and 3, both races, exactly once per slot. No
repair, replacement, relocation, cancellation, refund, level skip, AI ownership,
native scheduler admission or weapon/armor upgrade is added.

## Source Evidence

All four actions are DEPEND **kind `building`**, raw fields
`[0, slot, 1, race]`. Selector 1 is the target building level, not weapon/armor
selector 1. Source costs and prerequisites are used directly, not inferred
from the destination type or another race's catalog.

| Race | Slot | DEP | Cost | Prerequisites | Type | Max HP |
| --- | --- | --- | --- | --- | --- | --- |
| Human | 2 | 5 | 2000 | 3, 2 | 18 -> 19 | 2400 -> 3600 |
| Human | 3 | 4 | 2000 | 2 | 20 -> 21 | 2400 -> 3600 |
| Alien | 2 | 19 | 2000 | 17, 14 | 30 -> 31 | 2400 -> 3600 |
| Alien | 3 | 18 | 2000 | 16 | 32 -> 33 | 2400 -> 3600 |

Research center DEP6/20 requires laboratory DEP4/18. A busy laboratory does
not satisfy it; a living level-1 laboratory does after completion. A destroyed
laboratory does not, even if its upgrade completed earlier.

[The bounded native probe](../tools/qa/browser-construction-upgrades-native.py)
executes original cost lookup `4380d8(slot,1,race)` and building receiver
`41c8d4`, with original parsed DEPEND/GAMESTAT. Twelve cases cover both races,
both slots and incoming HP 1/1200/2400. All write City level 1, full upgraded
HP3600 and add source cost2000 to accounting; receiver credits stay unchanged
because debit belongs to the reservation stage. Executable SHA256 is
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
Initializer `444f14` and eligibility refresh `437bc4` are explicit stubs in
this bounded receiver probe: it does **not** prove the complete native upgrade
animation, actor initialization, interruption or timing lifecycle.

Type selection and unchanged Q8 position/footprint are separately established
by [the colony native-bank checks](../tools/qa/legacy-colony.test.ts) and
[City layout evidence](scenario-city-layout.md). The upgraded actor is **not**
the same type, but remains the same reserved identity. Native City upgrade
level is stored at team `+0xc4+4*slot`, distinct from source SCN `L=level+1`.
There is no invented raw220 actor "level byte": source SCN remains immutable;
the owner records level 0/1 and publishes it through `browserConstructionSlots`.

## Explicit Adapted Policy

Native receiver healing conflicts with this API's no-healing requirement.
Opt-in configurations therefore declare
`policy.upgradeHealth: "adapted-preserve-hp-capped-new-max"`.
Completion uses `min(currentHP, upgradedMaxHP)`, **not** a damage-ratio rescale
and not a refill. With this source table the maximum rises, so current HP is
unchanged. Absolute damage ratio is not preserved. This policy is part of the
source ID suffix and is not presented as native health parity.

Timing remains the v2 policy: 120 committed 50ms visits, adapted and not native.
Level/type remain at level 0 while busy; completion changes the existing world
entity and host actor type, entity maximum, and raw type/HP fields atomically.
Key, slot, generation, simulation binding, position, source fields, registry,
footprint, allocation high-water and all other raw bytes are preserved. No
create request, replacement entity or second actor is emitted.

Source-existing statics retain the session's ineligible-footprint/no-ground-ID
representation. V2-built statics retain their existing slot-valued occupancy.
Damage before and during the upgrade is preserved; observed healing, stale
identity, duplicate entities, raw/host/world HP disagreement and footprint
conflicts reject. Death during work settles `phase: "destroyed"`, without
type change, level gain, resurrection or refund. Dead completed upgrades
also remain unable to satisfy prerequisites through the live-HP gate.

## Exact Engine API

```ts
const configuration = await createBrowserConstructionConfiguration({
  runtimeProfile: "browser-adapted",
  mission,
  completionVisits: 120,
  supportedSlots: [2, 3, 4],
  supportedActions: ["purchase", "upgrade"],
});
const choices = browserConstructionChoices(configuration, state, world);
const choice = choices.find(choice => choice.action === "upgrade" && choice.slot === 3)!;
const next = reduceBrowserConstruction(configuration, state, world, {
  type: "upgrade",
  sequence: state.sequence + 1,
  id: "player:lab-upgrade:1",
  dependency: choice.dependency,
  home: configuration.home,
}, true);
```

- `supportedActions` is optional, sorted, unique, nonempty, and requires
  `supportedSlots`. Legal values: `purchase`, `upgrade`. `['upgrade']` admits
  upgrades only. Omission preserves old purchase-only source IDs, configuration,
  state and choice JSON shapes. No profile is enabled automatically.
- `BrowserConstructionRequest` adds `type: 'upgrade'` with exactly the same
  sequence/id/dependency/home fields as purchase. Sending a level-1 dependency
  as `purchase` still rejects. Unsupported slot/race/dependency, funds,
  current level, busy state, TRO restrictions and live prerequisites are
  checked before debit. Receipt IDs are unique across construction and upgrades.
- Opt-in choices have `action: 'purchase' | 'upgrade'`. Upgrade choices add
  `upgradeState`; existing `state` still refers to the base-construction child
  and may be absent for a source-existing actor. `option.level` is the target;
  read `browserConstructionSlots()[slot].level` for the committed current level.
- Root state adds `upgrades: Record<number, BrowserBuildingUpgradeState>` only
  when upgrades are supported, initially `{}`. Entries contain `receiptId`,
  `dependency`, existing actor `key`, `generation: 0`, `fromLevel: 0`, `level: 1`,
  `phase: 'building' | 'ready' | 'destroyed'`, `elapsedVisits`, `paid`, `health`.
  `level` in a receipt is the target, including before completion or after death.
- Existing root `paid`, `costAccumulator`, `elapsedVisits` and `phase` now
  aggregate base and upgrade receipts. Display each receipt's progress. One
  accepted request advances each previously active receipt once; a receipt
  started by that request stays at visit0. Parallel distinct slots are an
  explicit adapted policy, not proof of native team-latch concurrency.
- Effects retain `construction-started` / `construction-ready`, and upgrades
  additionally carry `action: 'upgrade'`, `level`, `unitType`, `maxHealth`,
  `health`. The existing `key` is authoritative, not a new receipt-derived key.
  A destroyed upgrade emits ready with `busy: 0`, `level: 0`, `health: 0` and
  the unchanged base type. Inspect health/receipt phase; ready is not resurrection.
- Pass `journaledCombat: true` only with an authenticated enclosing damage
  transaction. Raw220, world HP, host HP and `buildingSlots` must already agree.
  Completion preserves the latest observed HP. The enclosing owner must reject
  unjournaled or increasing HP before publishing it, including after completion.

## Session And View Integration Contract

The v2 owner should apply these changes before enabling the new capability:

1. Forward optional `supportedActions` through the mission factory and new-game
   policy, retaining exact absence for old profiles. On restore independently
   authenticate source files and reload the saved exact slots/actions/duration.
   Do not infer capabilities from current defaults or trust serialized config.
2. Extend session request and saved-input schemas to admit `type: 'upgrade'`.
   Extend construction checkpoint/config schemas for the fields above, with
   strict optional presence and receipt keys. Keep exact input replay and
   authenticated configuration equality. `restoreBrowserConstruction` validates
   an owner checkpoint against a supplied world; it is not proof of arbitrary
   world history and does not replace session replay.
3. Use root `phase` for active ticking and `browserConstructionSlots` for all
   five health/level/busy records. Copy current level as well as busy into
   production eligibility; exclude busy producers. Preserve queues and weapon/
   armor levels. Add only the accepted paid delta to production accounting;
   world credits were already debited. Do not debit again or use receipt sums
   as new charges. An upgrade does not change static membership/allocation.
4. Admit damage for active/upgraded **source-existing** slots as well as v2
   construction receipts. Existing `state.slots[slot]` alone excludes them.
   Stage source actor, raw/world/host HP and combat death before reduction.
   Keep the normal generation/key and non-increasing-health checks. Do not
   infer a new actor key from the upgrade receipt ID.
5. On `effect.action === 'upgrade'`, update the existing static target and
   binding, its source type/art/maxHealth and any per-type census projection.
   Do not run the construction create/allocate path. Preload actual generated
   upgraded sprites, and publish the visual/combat type transition only after
   the entire candidate transaction succeeds. Roll back both owners on failure.
6. Menu selection must distinguish `(slot, action)` or dependency, not slot
   alone: slots 2/3 can expose both construction and upgrade rows. Dispatch the
   choice's action and dependency; display `upgradeState` for upgrade progress.
  Save pending upgrade requests and exact capabilities. The final integration
  verification below covers session/view replay, damage/death boundaries and
  actual-view slot4 purchase.

## Verification

Dedicated [owner tests](../tools/qa/browser-construction-upgrades.test.ts):
12 cases passed, all four valid race/slot transitions, source costs/selectors,
damaged HP, live damage, unchanged identity/occupancy/raw bytes, source and
constructed actors, slot4 prerequisite and paid purchase, concurrent distinct
slots, insufficient funds, race/dependency/action mismatch, restrictions,
missing prerequisites, duplicate IDs, current level, busy building, destroyed
upgrade and independently authenticated exact restored continuation.

Native probe: 12 bounded original receiver cases passed. Scoped strict
TypeScript with `noUnusedLocals/noUnusedParameters` passed. Reproduction:

```sh
PYTHONPATH=/tmp/dc-exit-native-deps-r14:/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 -B tools/qa/browser-construction-upgrades-native.py
node --import tsx --test tools/qa/browser-construction-upgrades.test.ts
```

Evidence logs: `/tmp/dc-building-upgrade-native-20260923-u03.json`,
`/tmp/dc-building-upgrade-lifecycle-u12.log` and its exit JSON,
`/tmp/dc-building-upgrade-types-u15.log` and its exit JSON. Tests use controlled
funded source-city fixtures; no earned-income or mission-completion claim.
Final `/tmp/dc-building-upgrade-final-u16.log` and its exit JSON report **17/17
passed**: the 12 dedicated upgrade cases (including the final raw-byte and
mid-upgrade healing assertions), two v1 central controls, two v2 fixed-slot
owner compatibility controls and the original executable type/geometry bank
check. Exit code 0; no cancelled tests. Editor diagnostics are clean.
No agents, full suite, browser run, native full lifecycle or asset changes.

## Final Integration

Feature implementation is frozen after the focused checks below. No research,
theft, unit-panel, source asset or native upgrade-engine changes were needed.

- Session accepts explicit upgrade inputs, strictly validates optional upgrade
  receipt schemas, and authenticates complete input replay against an independently
  loaded construction configuration. Journal entries publish construction effects
  only for explicit action profiles. Legacy absent-action profiles keep their
  configuration/state/input shapes and reject upgrades.
- Production receives all five current health/level/busy records and only the
  accepted paid delta. Existing credit synchronization does not debit again.
  Busy producers stop visits; ready level-1 plants satisfy source tank prerequisites.
  Queues and weapon/armor levels are not replaced.
- Damage admission includes supported source-existing upgrade actors. Source key,
  generation, raw/host/world HP, unchanged footprint, and non-increasing HP remain
  enforced. Death before/during/after work cannot refund, heal or resurrect.
- View completion requires the authenticated ready receipt/effect and preloaded
  generated art. It updates existing static defense, maximum, sprite metadata and
  type census without allocating a replacement or changing the binding. Staged
  views share loaded visual references. Failure rolls back both session and
  simulation before publication.
- The existing construction panel uses dependency IDs for distinct purchase and
  upgrade rows. Upgrade rows show level 1 and a Lucide ArrowUp icon; prices and
  enabled/queued/progress states come from the same source-backed choices.

### Focused Evidence

[Session controls](../tools/qa/browser-building-upgrades-session.test.ts) cover
paid purchase/upgrade/slot4, damage, independently authenticated replay, forged
actions/receipts, exact legacy omission, original source identities, and death
before/during/after upgrades. ALIEN04 controls change initial funds from 0 to
10000 only; source buildings retain HP999. Its original TRO credit reset remains
active, so tank prerequisite eligibility and affordability are checked separately.

[Actual MissionView controls](../tools/qa/browser-building-upgrades-view.test.ts):

- HUMAN07 funding-only source control starts with 10000 rather than 5500 credits.
  Original City, placements, TRO, restrictions, terrain and prices are unchanged.
  Public actions pay 2000 for the laboratory, 2000 for its upgrade and 3000 for
  the research center. The original delivered collector moves to marker (5,32),
  discovers real type63 at tick999/slot208, and preserves exact full-view replay.
  This is not an earned-funding or untouched-opening claim.
- Pending, visit119, completed and discovered checkpoints restore exactly;
  source configuration is independently reloaded. An injected completion
  projection failure leaves the entire session and simulation unchanged.
- ALIEN04 original keys `colony:2`/`colony:3`, simulation IDs, footprint, pose
  and HP999 survive upgrades to types31/33 and maximum3600. Mid-upgrade fork
  continuation is exact. Corrupt maximum, increasing HP and armor reject restore.

[Panel controls](../tools/qa/construction-panel.test.ts) verify source costs,
distinct labels/icons, disabled existing purchases, and dependency-based upgrade
dispatch. Existing v1 and purchase-only v2 controls remain part of the final
focused run. Project and strict QA TypeScript checks pass. No agents or full
suite; Node actual-view/asset checks do not claim browser-pixel verification or
native full-lifecycle parity. The 12 bounded native cases above were not rerun.

Final combined evidence: **38/38 tests passed**, zero failures, skips or
cancellations, exit 0, in 509396ms. Log:
`/tmp/dc-building-upgrade-final-1790161933206.log`; supervisor result:
`/tmp/dc-building-upgrade-final-1790161933206.log.exit.json`.
The final panel compatibility assertion and `npm run typecheck` also passed
after preserving the legacy completed label for an already allocated source
building. Strict QA compilation passed with `noUnusedLocals/noUnusedParameters`.
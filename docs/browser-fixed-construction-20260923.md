# Browser Fixed-Home Construction V2

The subsequent [MissionView/main/UI integration](browser-fixed-construction-ui-20260923.md)
implements the consumer handoff below. The original runtime handoff and its
verification record are retained here; consumer "not yet wired" statements
describe the state before that integration.

Follow-up: [building-level upgrade engine API](browser-building-upgrades-20260923.md)
adds an explicit optional `supportedActions` capability in the construction
owner. The purchase-only v2 contract below remains unchanged when that field
is absent. Upgrade session/view wiring is a separate pending handoff; do not
enable it by widening an existing saved profile.

## Scope

Runtime owner and CampaignSession support for first construction of empty fixed
player slots 0..4, both source races. Explicit browser-adapted opt-in only;
120 committed 50 ms visits after purchase. Existing active buildings advance
once on a tick that accepts another building purchase; the new building starts
at zero visits. This is adapted timing, not native construction/FIN parity.

No relocation, rebuilding, repair, building-level upgrades, AI construction,
cancellation/refund, native owner admission, or automatic mission enablement.
Cancellation is rejected atomically. A destroyed receipt retains its allocation
and paid amount; reaching the timer limit never heals or resurrects it.

MissionView and main were intentionally not edited. The existing central panel
received only an explicit union-type guard. General construction is a session
runtime capability and is **not yet a wired general browser UI workflow**.
Do not enable v2 through main before completing the consumer handoff below.

ALIEN10 still starts with 1500 PETRA against the original 2000 central price.
No credit, collector, source restriction, source asset or historical save was
changed. Positive funded tests are labelled controls, not earned-income proof
or a campaign completion claim.

## Source Buildings

Derived from authenticated generated DEPEND/GAMESTAT and projectLegacyColony.
All five footprints have four source cells; Q8 positions and per-race sprites
come from the same projection used for initial colonies.

| Slot | Building | Human DEP/type | Alien DEP/type | Cost | HP | Maximum level |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Central | 0 / 16 | 14 / 28 | 2000 | 4800 | 0 |
| 1 | Barracks | 1 / 17 | 15 / 29 | 1000 | 2400 | 0 |
| 2 | Vehicle plant | 3 / 18 | 17 / 30 | 2000 | 2400 | 1 |
| 3 | Science laboratory | 2 / 20 | 16 / 32 | 2000 | 2400 | 1 |
| 4 | Research center | 6 / 22 | 20 / 34 | 3000 | 3600 | 0 |

Barracks and laboratory require central; vehicle plant requires barracks and
laboratory. Research center requires a **level-1 laboratory**, DEP 4/18. Live
health and busy state are checked as well as level and TRO restrictions.
The helper also describes source upgrade entries 4/5 and 18/19, but purchases
of those entries are rejected. No initial player city in the inspected original
campaign census supplies laboratory level 1. Slot4 positive tests therefore use
an explicitly modified in-memory source-city fixture, not a claimed original
opening. Implementing empty slot4 does not make its original prerequisite free.

## Public API

```ts
const mission = await loadCampaignMission("human", 10, "browser-adapted", {
  completionVisits: 120,
  supportedSlots: [1, 2, 3, 4],
});
const session = new CampaignSession(sourceBrowserCampaignSessionOptions(mission));
const status = session.browserConstructionStatus!;
const choice = status.choices.find(choice => choice.slot === 3)!;
session.step({
  clockMilliseconds: 50,
  productionVisits: session.browserFrameContext(150).productionVisits,
  browserConstructionRequest: {
    type: "purchase", sequence: status.state.sequence + 1,
    id: "player:building:1", dependency: choice.dependency,
    home: mission.browserConstruction!.home,
  },
});
```

- `BrowserConstructionPolicy`: existing `completionVisits`, optional sorted,
  unique, nonempty `supportedSlots` subset of 0..4. V2 requires exactly 120.
  Missions must have an authenticated nonzero source home. Ordinary absent
  policies stay absent; the legacy duration-only policy remains ALIEN10-only.
- `createBrowserConstructionConfiguration({...})` accepts the same optional
  `supportedSlots`. V2 output adds `configurationVersion: 2`, `supportedSlots`
  and `buildings: SourceBuildingOption[]`. It retains the legacy central
  `building`, `dependency` and `cost` fields for old consumers. Use `buildings`
  or status choices for v2, not those central compatibility fields.
- `sourceBuildingOptions({scenario, units}, records, teamIndex = 0)` returns
  `dependency`, `cost`, `prerequisites`, `level`, `maximumLevel`, `building`.
  This projection helper alone is not a source authentication credential.
- `browserConstructionChoices(configuration, state, world)` and
  `session.browserConstructionStatus.choices` expose supported level-0 choices:
  the above option fields plus `slot`, optional per-slot `state`, current
  `health`, `credits`, `missingDependencies`, `requestEnabled`, `reason`.
  Occupancy/reservations, funds, prerequisites, busy, restrictions and existing
  allocations can disable a choice. The reducer rechecks before debit.
- V2 `state.slots[slot]` contains an individual v1-shaped receipt for every
  supported source-empty slot. Existing source-level buildings are excluded,
  even when their source HP is zero. Root `sequence` is the purchase/visit
  request sequence; child sequences are internal. Root `paid/costAccumulator`
  and `elapsedVisits` are sums, root `receiptId` is null. Display the child
  progress, not the aggregate. A dead child's phase may be `ready` when its
  timer completes; `health === 0` remains authoritative for destruction.
- `browserConstructionSlots(configuration, state, world)` projects the five
  current HP/source-level/busy records for dependency/producer integration.
- Existing owner create/reduce/restore functions accept both versions.
  Start/ready effects now carry arbitrary supported `slot`, `dependency`,
  generation 0, actor key and receipt ID. The key is
  `browser-construction:<slot>:0:<receiptId>`.
- `CampaignSessionInput.browserConstructionDamage` is an optional array of
  `{slot, generation: 0, health}` for live v2-owned buildings. HP must be
  positive and cannot increase. Duplicate slots are rejected. Death still
  uses `updates: [{type: "combat-death", slot, generation: 0}]`.
  The old scalar `browserConstructionHealth` remains for an owned central
  receipt only. Do not submit both damage forms for slot0 in one tick.

## Transactions And Saves

Purchase requires virgin raw slot, generation -1, null registry and no entity
in either world/host representation. Receipt creates generation 0, the exact
source type/HP, raw220, registry, one static entity and four occupied cells.
Resource cells, exit reservations and stationary blockers reject atomically.
No mobile high-water or placement allocator advance occurs.

Session stages ownership, static membership, raw/world health and production
colony state together. It adds only the accepted paid delta to production's
accumulator; later income synchronization cannot undo the debit. Deferred
production initializes from current world credits. Producer visits exclude
busy slots, and source eligibility is refreshed by existing credit/colony
synchronization. Existing queues and upgrade values are not reset.

Checkpoint schemas admit optional per-slot receipts and damage inputs; exact
authenticated option equality and full adapted input replay remain mandatory.
V2 source ID includes SCN, GAMESTAT, DEPEND, terrain layer hashes, duration and
the selected capability subset. A serialized configuration is not a credential.
No mismatch bypass or silent widening of saved capabilities exists.

Missing `supportedSlots` means the old central-only v1 configuration, with its
unchanged source ID and JSON shape. Missing configuration means no construction.
To restore v2, independently load the original mission with the **saved exact
subset** and supply its authenticated configuration to CampaignSession.restore's
existing seventh parameter. Do not infer all slots from a current feature
default, and do not add v2 fields to an old winning save.

## Consumer Coordination

Required before enabling a general MissionView UI:

1. In main, opt new missions into the desired capability subset. Restore must
   pass saved `supportedSlots` alongside saved duration; the existing code only
   extracts duration and would correctly fail v2 option equality. Preserve
   absent options and duration-only v1 saves exactly.
2. In MissionView's construction menu, map `browserConstructionStatus.choices`
   and each child receipt. Pending purchase still uses the dependency and root
   sequence. Do not treat aggregate `phase` or central `configuration.building`
   as the identity of the selected building.
3. Preload all supported generated sprites and project each created fixed slot
   using its source `building` Q8 position, footprint, HP and generation.
   Extend the existing staged static-target transaction and identity binding
   from slot0 to slots1..4; publish only after projection succeeds.
4. Forward damage for every owned slot through `browserConstructionDamage`,
   leaving source-existing buildings and the research subsystem's ownership
   unchanged. Preserve pending requests and all child receipts through saves.
5. Replace the central-only panel's dependency-14 selection with actual choices.
   Do not expose building-level upgrades as purchases in this owner.

The session integration changed only construction request/damage validation,
optional receipt schema, status choices, static-footprint reconstruction,
busy producer filtering and per-slot production publication. No research or
MissionView implementation region was modified.

## Verification

43 distinct focused tests passed across these files (no full suite or agents):

- `browser-construction-fixed-slots.test.ts`: 10 two-race owner/session tests,
  including all five generated types, exact replay, explicit 120 visits,
  concurrency, reservations and both occupancy mirrors, slot4 prerequisite,
  cancellation rejection, rollback, no healing/refund/rebuilding, producer
  readiness and a paid collector spawn after constructing its producer.
- `source-building-options.test.ts`: 2 source catalog/prerequisite controls.
- Existing `browser-construction.test.ts` and
  `browser-construction-view.test.ts`: 5 central-only compatibility controls,
  including absent M02/M03 profiles and existing full-view continuation.
- `campaign-production-collectors.test.ts`: 20 neighboring production controls.
- `legacy-colony.test.ts`: 6 source projection checks, including original
  executable type/position/footprint oracle. Its default old Unicorn path first
  failed to import; rerun passed with
  `DC_COLONY_PYTHONPATH=/tmp/dc-exit-native-deps-r14`.

Final logs: `/tmp/dc-fixedbuild-isolated-1790158704788.log` (4 v2 controls),
`/tmp/dc-fixedbuild-isolated-1790158981423.log` (6 v2 controls),
`/tmp/dc-fixedbuild-isolated-1790158822304.log` (32 neighboring passes and the
environment-only oracle failure), `/tmp/dc-fixedbuild-isolated-1790159086898.log`
(6 successful colony/oracle reruns). Project `npm run typecheck` and strict
`--noUnusedLocals --noUnusedParameters` construction checks passed; final logs
are `/tmp/dc-fixedbuild-project-types-20260923-16.log` and
`/tmp/dc-fixedbuild-types-20260923-16.log`.

No new v2 browser UI run, full-view v2 continuation, building-upgrade lifecycle,
earned ALIEN10 funding, or full-mission playthrough is claimed.
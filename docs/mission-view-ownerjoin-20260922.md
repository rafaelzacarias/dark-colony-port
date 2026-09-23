# MissionView Adapted Owner Join

Changes are limited to [MissionView](../src/mission-view.ts),
[focused tests](../tools/qa/mission-view-ownerjoin.test.ts), and this report.
No session, simulation, renderer, main, package or asset changes were made.
No agents, browser run or full suite were used.

## Runtime Fields

- `frame.world.browserCasualtyPickup.runtimeProfile === "browser-adapted"`
  and the adapted mission profile gate acceptance of persistent `nopickup`.
  A missing owner still fails the frame transaction. The current, source-derived
  `session.adaptedTroProjection` continues to supply relations, shared vision
  and AI policy; it is not reconstructed or mutated by the view.
- `frame.entry.requests` now accepts `casualty-picked-up` only for an owned,
  already-recorded death. Collection removes the simulation body and detaches
  its binding. The following `unregister` is idempotent at the presentation
  boundary; neither event creates another loss.
- Existing `combat-death` submission remains once per simulation identity.
  Dying units emit no position updates. The simulator already retains zero-HP
  bodies, excludes them from movement/combat, and requires explicit removal.
  No timer, fake heal, external death clearing or early `complete-removal` was
  added. Suppressed deaths do not gain a fabricated animation-cleanup owner.
- Existing `frame.transport.reducer.carriers`, `slots` and `registry` remain
  the carrier source. Automatic pickup needs no combat-unit `create` request.
  Existing DROP/SAUC sprite admission and source type92/type93 projection are
  unchanged. Recovery still arrives through the ordinary source `create`
  constructor, with a fresh slot/generation identity and source full health.
- `CampaignSessionInput.type37Frame` comes from
  `observeBrowserType37Frame(world, owner, { snapshot, bindings, spyTeams })`
  after the current simulation updates have been collected and before the
  single session step. The snapshot is the real current simulation; bindings
  exclude detached identities. All eight spy fields are explicitly false in
  this normal browser profile. A persisted true field rejects as uncertified,
  rather than becoming a UI/debug unlock or a `dfiddle` interpretation.
- Private `#type37World` retains the preceding returned compact browser world,
  initialized/restored from the existing source snapshot. It advances with
  every successful frame and staged commit. No per-step full session snapshot,
  transport history or casualty ledger read was added. Normal false-spy visits
  cannot release a FIFO; spy-enabled/current-occupancy delivery is not certified
  by this view path and would require its own source-backed owner.
- Proven hidden source type37 markers remain unbound during restore as well as
  construction. Their original coordinates, FIFO entries, slots and generations
  stay in the source world. They gain no combat, enemy-selection or POOP asset
  binding.
- Current selector modes 1, 2 and 3 exclude their teams from generic guards in
  the same frame as source `ai` actions. Team0 is not categorically excluded:
  mode0 retains its armed guards. Existing generated static footprint obstacles
  passed to browser AI are unchanged.

## Focused Verification

Six tests in [mission-view-ownerjoin.test.ts](../tools/qa/mission-view-ownerjoin.test.ts):

1. HUMAN02 controlled combat/recovery slice: full-health source commander and
   opposing source turret; unchanged original loss/recovery blocks in their
   original table positions, with unrelated blocks disabled. Actual combat
   records death at tick362, collection at420, source replacement at1163.
2. ALIEN02 equivalent slice has the same observed ticks. Both cases verify one
   loss, retained zero-HP body until arrival, correct neutral carrier/sprite,
   removal at collection, and a distinct source replacement identity. Each
   saves once at death dispatch and compares exactly 40 continuation ticks.
   These are controlled integration fixtures, not full original M02 playthroughs.
3. Unchanged original AL08 runs through tick16 with its source `nopickup 6`
   effect, an actual owner, no casualty dispatch and no diagnostic.
4. Removing only the returned AL08 frame owner makes the view reject `nopickup`
   and roll back the frame, retaining equal simulation/session ticks.
5. Original H02 actors with a controlled TRO issue actual team2 selector writes
   1,3,2 over 40 ticks. Generic guard observations exclude all three active
   modes on their command frames; mode0 player guard membership is also checked
   in the combat fixtures.
6. Unchanged H07 runs 40 ticks without artwork initialization. Both original
   markers190/197 at (88,80)/(5,32) retain FIFO `[63,63,63]`, source identity,
   countdowns and all-false spy fields. Every recorded session observation
   matches the helper applied to the preceding actual simulation. A tick20
   save restores and continues identically; no POOP lookup or combat binding.

Three focused existing neighbor tests also pass: source type37 identity guards,
actual idle-collector eligibility and visit450 delivery, and unchanged-source
AL08 session team6 commander death. The latter verifies a retained class-0 loss,
no automatic carrier for team6, and original block9 explicit abduct for team0.
That later AL08 death check is session-level, not a full view combat playthrough.

Strict/noUnused scoped TypeScript for MissionView and the new tests passes.
H07 artwork initialization and spy-enabled rendering remain outside this run;
no asset alias workaround was added here.

```sh
node --import tsx --test tools/qa/mission-view-ownerjoin.test.ts
node --import tsx --test \
  --test-name-pattern='^session casualty: original AL08|^type37 view identity:|^type37 collector handoff:' \
  tools/qa/campaign-session-casualty-pickup.test.ts \
  tools/qa/browser-type37-presentation.test.ts
```
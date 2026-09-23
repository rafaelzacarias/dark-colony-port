# Live bounded production UI

## Runtime integration

- [game-data.ts](../src/game-data.ts) decodes the generated scenario envelope's
  `rawScenario` base64 bytes and calls `loadSourceProductionOptions` with the
  original SCN SHA-256, all eight teams, verified dependencies/units and FIN data.
  Configuration is explicitly `user-selected-source-campaign-fresh`, mode 0,
  local team 0 and race derived from the chosen human/alien faction.
- Only the player's supported base producer is configured. First missions have
  no owned factory and expose no production menu. Opponent AI and opponent
  production are not simulated by this integration.
- [mission-view.ts](../src/mission-view.ts) passes production options/profiles
  into CampaignSession. Each fixed step supplies `sourceProductionVisits` from
  the current native world, including registered population and the native cap
  calculation. The fresh population ceiling remains 150; dynamic ceiling changes
  are not offered by this bounded UI.
- `productionMenu` reads current session production state, including canonical
  credits, source restrictions and bounded queue capacity. `purchaseProduction`
  accepts a dependency ID, not money, population or completion flags. It stages
  one reserve/dispatch pair for the next transactional session step; repeated
  clicks before that step are rejected.
- Completed production uses the existing native `create` request binding, keyed
  by slot/generation, exactly once. Produced TRSC/GRAY units receive source
  weapon damage and defense profiles. The standing portrait is presentation only;
  completion uses the verified FIN producer profile, not UI animation time.
  Missing production portrait assets produce a renderer diagnostic.
- Direct save fingerprints include optional `sourceProduction` and raw SCN bytes.
  Session options omit only the envelope's raw bytes, which are not part of its
  parsed-source schema. Restore validates options/profiles and pending purchases;
  production state and command history remain owned by CampaignSession.

## Selectors And Browser Handoff

The existing campaign launcher uses `[data-campaign-faction="human"]` and
`[data-campaign-faction="alien"]`. Both original first missions must keep
`#mission-production` hidden and contain no `[data-production-buy]` controls.

For an admitted owned source factory:

- `#mission-production`: bounded base-production region in the existing portrait
  position; the commander portrait is hidden only while this region is present.
- `#production-credits`: current native session credits.
- `[data-production-choice]`: supported dependency, with source standing canvas,
  name, cost and `.production-queue` count.
- `[data-production-buy]`: icon button with `Produce TRSC` / `Produce GRAY`
  accessible label. Disabled at zero funds, source restriction, full queue,
  pending submission, mission diagnostic or completed outcome.

For direct browser construction, load generated HUMAN02 scenario, complete TRO,
map layers and unit/weapon/damage metadata, then call `loadSourceProductionOptions`
with `Uint8Array.from(atob(scenario.rawScenario), character => character.charCodeAt(0))`
and the explicit human configuration above. Attach only its configuration,
initialPopulationCeiling and production options to `mission.sourceProduction`,
then construct `new MissionView(canvas, stage, callbacks, mission)`.
Keep every original TRO block: this fixture must report `TRO 17: ai` before
admission, with no session or purchase control. Do not remove AI actions to obtain
a purported original campaign success.

[live-production.test.ts](../tools/qa/live-production.test.ts) also defines
explicitly SYNTHETIC/source-separate human and alien fixtures: original unit and
FIN profiles, a synthetic player base, empty placements, synthetic starting funds
and a synthetic money-changing TRO. These verify pending-click restore,
mid-production restore, one native spawn, source combat profiles and canonical
credit changes. They are not evidence of playable HUMAN02 or native income.

## Blockers And Verification

### Orchestrator Resolution

Completed production restore now validates `production:<session>:<request>:allocated`
against the matching allocation request, unit-allocation receipt and native create
slot/generation. It does not accept arbitrary production-prefixed events. Both
synthetic source-profile race lifecycles and restore pass; the earlier failure
below is historical. Shared panel rendering lives in
[production-panel.ts](../src/ui/production-panel.ts), used by main and the isolated
browser fixture. It retains active-owner/modal guards and updates pending/queued
and credit states from MissionView rather than local balances.

Browser checks passed one synthetic 350-Petra purchase, duplicate-click blocking,
native-FIN completion, exactly one unit, zero credits, disabled next purchase and
post-completion restore. Mobile-width geometry and screenshot checks passed after
fixing the legacy rule that hid the unit-name strong element. Original first
missions still expose no factory. These checks do not certify playable HUMAN02,
whose unchanged AI action remains rejected, or live resource-income integration.
The final full gate passed 866 tests, four skipped, plus typecheck/build.

- Post-completion restore is blocked in the orchestrator-owned engine:
  [campaign-production.ts](../src/engine/campaign-production.ts#L449) emits an
  `allocated` event with ID `production:<sessionId>:<allocation.id>:allocated`,
  but [campaign-session.ts](../src/engine/campaign-session.ts#L961) accepts only
  `input:` / `session:` journal prefixes. Both synthetic races pass pending and
  mid-animation restore, canonical credit change, exact-one native spawn and
  combat-profile assertions, then fail their final restore with
  `Checkpoint production event provenance`. Keep that assertion: no UI-side
  journal rewrite, deletion or restore bypass was added.
- Original HUMAN02's unsupported `ai` action remains an admission blocker. The
  direct MissionView constructor now runs the same existing preflight as the
  data loader, before resource/world initialization.
- Native resource income is not wired into MissionView's session options here.
  The source mission starts at zero credits; no grant or shadow ledger is added.
  Once the owning session/resource integration publishes actual income into
  canonical production state, this UI consumes it without a new funding adapter.
- Without preflight, HUMAN02 also reports type 40 requiring bounded resource
  initialization. This work does not bypass or claim to solve that boundary.
- Original SCN bytes are exported by [extract.ts](../tools/extractors/data/extract.ts).
  Isolated data regeneration changed 108 scenario envelopes; previous parsed
  fields and every non-scenario data output remained identical. Other asset trees
  and package metadata were not regenerated or edited.
- Focused commands: `node --import tsx --test tools/qa/live-production.test.ts
  tools/extractors/data/extract.test.ts`, then `npm run typecheck`.
  Final verification: neighboring MissionView checkpoint + extractor tests
  13/13 passed; original-source live checks 3/3 passed; full live production file
  3 passed, 2 failed at the engine-owned post-completion restore boundary above;
  typecheck passed. All earlier lifecycle assertions in those two tests completed.
  Browser validation belongs to the orchestrator; none was run for this task.
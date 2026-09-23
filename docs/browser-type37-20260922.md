# Adapted Source Type 37

Follow-up: [research/discovery ownership](browser-research-20260923.md) proves
`team+0xbe4` is the slot-4 Research Center health dword, not a separate spy byte.
It supplies an explicit source-health observation and adapted original-UI
discovery overlay. The historical presentation limits below still describe the
default helper; the new opt-in callbacks have not been wired into MissionView.

This covers loader/session/FIFO admission and the scoped normal-spy presentation
handoff below, not a full-game or successful full MissionView startup claim.
Only explicit `browser-adapted` initialization admits type 37. The original
strict `Placement 38 requires native type-37 coordinate queue and selector-6
state` failure for HUMAN07 remains unchanged.

## Native Finding

POOP is a real neutral coordinate-relay actor, not discarded source noise and
not a ordinary combat unit. Original `0x41c5c0..0x41c627` constructs type 37,
owner 8, consuming one actual slot, then calls `0x440410` to register a FIFO.
Selector `s(6,0)>0` OR loader local gate zero admits it; the other branch skips
allocation. This adapter owns only fresh campaign gate zero, selector six zero.
It does not relax the native phase/selector guard or implement random-map setup.

SCN fields are x, y, source type, source owner, HP override, optional script
byte. POOP forces owner 8 and script byte zero; its fifth value is NOT resource
quantity. Negative HP selects the source definition (300 in HUMAN07). RENAT
owner -1 dispatch still precedes POOP. Ordinary rows encountered later at an
already-registered coordinate append their effective, race-substituted type,
without allocating any actor or advancing the slot cursor. Resource rows take
their separate earlier dispatch. Source row order and all opaque fields survive.

[browser-type37-native.py](../tools/qa/browser-type37-native.py) executes the
complete unmodified HUMAN07 loader `0x41b9ce..0x41c7ee`, observes constructor
calls and game-buffer differences, and compares all placement identities with
the existing native scanner harness. No new runtime-call stubs were added;
external file/setup boundaries are exactly those of the existing resource
loader harness. Parsed type records and synthetic empty map planes remain
bounded prerequisites, not full boot/animation proof. Original executable SHA256:
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.

HUMAN07 allocates POOP at 190 and 197; next slot is 202. Its queues are
(88,80) and (5,32), each `[63,63,63]`. The full loader records all eight spy
fields zero, selector six zero and loader gate zero. Twelve complete native
placement streams are also compared to adapted raw220 x/y/type/owner/HP/status/
script-byte fields and exact slots. This is not parity of all 220 bytes.

## State And Consumers

[browser-type37.ts](../src/engine/browser-type37.ts) defines typed serializable
`scenarioMarkers`, source `coordinateQueues`, and `markerSpyTeams`. Source queue
metadata retains marker row, coordinates, captured row identities and types;
the live pending types have ONE owner: existing `transportState.fifos`.
`world.source`, raw SCN base64/fingerprint, and raw allocation order are retained.
Markers retain their original world/entity/host registry identity, no collision
footprint, no simulation actor binding, no combat updates and no census losses.
Inactive markers retain metadata; their native slot may subsequently be reused.

Original `reinforce2` (`0x43e349`) appends types in group/member order when its
coordinate matches a FIFO; otherwise existing synchronous allocation applies.
Queue entries are teamless. The adapter uses the existing transport FIFO and
`consumeTransportFifo`, not fabricated deployments or instant combat units.
The bounded host rejects more than ten pending entries transactionally; native
append itself does not bounds-check, so this is a safety limit, not a new claim
about native overflow behavior. Ten registered source coordinates are supported.

The single original pop caller is `0x4133ed` in task `0x4131bc`: ground occupant
must be type 6/14, its team's `+0xbe4` spy field nonzero, and task byte `+0x39`
equal to 1. Ineligible visits reset countdown to 450. Eligible visits decrement;
at expiration `0x440520` pops, and `0x413459..0x41346a` allocates with the
COLLECTOR'S owner, not the original SCN or reinforce2 owner. An empty pop marks
POOP inactive and unregisters it without a combat loss.

Adapted `CampaignSessionInput.type37Frame` supplies eight `spyTeams` booleans
and registered `idleHarvesterSlots`. Each session step is one ADAPTED visit;
it is not an assertion of native frame cadence, native task animation/effects,
or native spy-unlock provenance. The reducer verifies live collector identity
and actual host ground occupancy, stages the existing FIFO allocator, and
rolls back on allocation failure. No frame means no eligible collector, not
automatic delivery. Missing observation cannot silently turn into a release.
Spy state persists in the checkpoint; frame history and all relay state are
validated by the existing complete session replay. `dfiddle` changes dependency
restrictions at `team+0x193c`, NOT the spy field at `team+0xbe4`.

## View Handoff

The new [browser-type37-presentation.ts](../src/engine/browser-type37-presentation.ts)
owns source identity checks, detached presentation entries and collector
observations. [MissionView](../src/mission-view.ts) changes are limited to the
type37 asset catalog and entity registration. Main and the performance/update
path are untouched.

`missionVisualSprites(mission, world)` excludes a type37 placement only for an
explicit adapted profile, a matching complete canonical SCN fingerprint, a
matching original row/slot/generation/owner/queue and the local team's false spy
field. Without that proof, POOP remains required. This is a placement filter,
not a global sprite blacklist: scripted `newtype`/reinforcement requirements
remain intact. Original strict admission is unchanged.

`isBrowserScenarioMarker(entity, world)` and
`browserScenarioMarkerPresentation(entity, world)` are used before creating any
simulation/static target. Markers retain world/entity/raw220/host identity and
FIFO metadata but receive no view combat binding, selection, health bar or
collision footprint. No source actor or grid occupancy is deleted or rewritten.
The native constructor already places these owner8 markers on neither occupancy
plane. Retired source metadata remains distinguishable from a reused slot by
key/source row/generation. Other objective types are untouched. This matches
native-backed `missionOrdinarySceneAdmission`, including reveal-all.

With spy true, the helper returns `source-art-required`, NOT hidden or admitted
with substitute art. Original POOP artwork is absent from the audited asset
graph; do not invent it, delete the marker, or claim spy-enabled rendering.
Source-backed spy activation and idle collector observations must still be
connected by the main/session update owner. No collector movement/AI discovery
or full mission outcome is certified here. POOP's relay gameplay must not be
mistaken for decoration.

### Integrator API

- `BrowserType37PresentationOwner` requires `runtimeProfile: "browser-adapted"`
  and `sourceCanonical` from the existing `aiSelectorSourceCanonical(world.source)`.
  Both projection and observation reject another source fingerprint/profile.
- `projectBrowserType37Presentation(world, owner, localTeam = 0)` returns detached
  entries with source row, raw slot, generation, owner8, coordinates, source
  captures, live pending FIFO types, active state and `remainingVisits`. The
  projection validates active registry/occupancy and FIFO coordinate identity;
  it does not own or advance the queue. `clockMilliseconds` identifies the
  supplied session world; timing is explicitly `adapted-visits-not-native-frames`.
- `observeBrowserType37Frame(world, owner, { snapshot, bindings, spyTeams? })`
  returns the existing `BrowserType37Frame`. Supply actual simulation snapshot
  and bindings after host position projection. A collector must be a live
  registered 6/14 with matching key/slot/generation/team, idle activity, no
  attack target or native resource owner, exact projected position, actual
  ground occupancy and an active queue at its cell. Stale/duplicate bindings
  reject; missing, moving, dead or displaced units cannot become observations.
- Pass that result as `CampaignSessionInput.type37Frame` for exactly one adapted
  visit. Do not run a second relay reducer, duplicate FIFO storage or synthesize
  a census. The existing session alone decrements 450 eligible visits, resets
  on ineligibility, consumes FIFO in order and allocates for the collector owner.
  No observation means no delivery. Neither helper mutates the supplied world.
- Spy defaults to the persisted eight fields, all false in the original fresh
  loader proof. An explicit observation override is for an external verified
  source/debug owner, not a UI default or a TRO `dfiddle` interpretation. No
  spy unlock, substitute POOP image or spy-enabled rendering was added.

### Presentation Verification

[browser-type37-presentation.test.ts](../tools/qa/browser-type37-presentation.test.ts)
covers identity/fingerprint/profile guards, explicit spy failure, source-specific
sprite exclusion, real simulation collector observations, delivery only at visit
450, detached projections, original FIFO preservation, and session/view restore.
The original seven type37 tests also pass, including all twelve adapted loaders
and session rollback/replay. These are focused Node checks, not browser or pixel
rendering certification. Image loading reads real PNG headers and real generated
JSON; the canvas has no drawing context and uses the existing RGBA fallback.

Two original full view initializations were attempted without source filtering,
map changes or substitute assets: **0/2 complete**, **2/2 type37 asset admissions**.

| Mission | Retained markers | Next native slot | Complete startup blocker |
| --- | ---: | ---: | --- |
| HUMAN07 | 2 | 202 | Missing `animations/XDEPLOY.json` |
| ALIEN06 | 4 | 217 | Constructor: unit cell is not passable at `(12,74)` |

Neither attempt requested POOP. HUMAN07 constructed 66 bound non-marker actors;
ALIEN06 constructed only 9 before the unrelated terrain failure. This is not a
claim that ALIEN06 reached visual initialization. Original source/world marker
metadata and queues survive; a source session step with actual production visits
leaves both missions' queues/countdowns unchanged without collector observations.

The real archive audit removes only POOP from the missing dependencies. Remaining
HUMAN07 archive names are BRDRHIV, BRDRHIV2, HMINE, MNDHIV2, ROBOPOD and XDEPLOY;
ALIEN06 still lacks HMINE, ROBOPOD and XDEPLOY. Those asset mappings and terrain
admission are outside this type37 slice. No full suite, browser, package/asset
changes or agents were used.

## Verified Loaders

| Original mission | Marker queues | Next native slot |
| --- | ---: | ---: |
| HUMAN07 | 2 | 202 |
| HUMAN08 | 2 | 208 |
| HUMAN09 | 4 | 224 |
| HUMAN12 | 8 | 225 |
| HUMAN13 | 3 | 208 |
| ALIEN06 | 4 | 217 |
| ALIEN07 | 1 | 202 |
| ALIEN08 | 1 | 226 |
| ALIEN10 | 4 | 203 |
| ALIEN11 | 2 | 182 |
| ALIEN12 | 3 | 193 |
| ALIEN13 | 3 | 219 |

All twelve real `loadCampaignMission(..., "browser-adapted")` preflights and
session checkpoint restores pass without SCN filtering or fake money. The
loader now forwards the profile to its existing adapted TRO audit, including
HUMAN09's source omitted operand. Exact coordinates, captured types 63..67,
source hashes and matching reinforce2 writers are in the generated
[census](browser-type37-census-20260922.json).

Focused tests: [browser-type37.test.ts](../tools/qa/browser-type37.test.ts).
They cover strict guard, source slot identities, normal spy admission, all
source queue payload allocations, transactional blocked arrival, collector
ownership, actual session scheduling, restore immediately before arrival,
continuation equality, unknown-field/state tampering and forbidden combat.
Neighboring placement/world/transport tests also pass. No browser, full suite,
packages, asset changes or agents were used.

## Reproduce

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 \
  python3 -B tools/qa/browser-type37-native.py > /tmp/type37-native.json
DC_TYPE37_NATIVE=/tmp/type37-native.json \
DC_TYPE37_REPORT=docs/browser-type37-census-20260922.json \
  node --import tsx --test tools/qa/browser-type37.test.ts
```
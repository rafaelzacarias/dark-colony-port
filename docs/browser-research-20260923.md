# Browser Research And Artifact Discovery

Scope: source research owner/projection, adapted MissionView discovery overlay,
collector handoff and narrow session observation validation. Construction remains
a separate owner. No source data, generated assets or dependencies were changed.
The integration acceptance below is not a HUMAN07 victory or native rendering claim.

## Native Correction

The old name `spy` obscured the field's actual ownership. It is a **32-bit
Research Center health field**, not a byte, researched flag or permanent unlock:

`team + 0xb98 + 0x3c + 4*4 == team + 0xbd4 + 4*4 == team + 0xbe4`.

The existing original City scanner `0x41c0cd..0x41c289` fills five building
health slots. Slot 3 is the science laboratory; slot 4 is Research Center.
The capability checker `0x437c05..0x437c25` indexes health at `+0xbd4` and
building level at `+0xc5c`. The excavation predicate `0x413306..0x413360`
reads collector type 6/14, its own team's slot-4 health, and task byte
`+0x39 == 1`. It does not check a separate research-completion flag, busy byte,
dependency restriction or fog state. `dfiddle` writes `+0x193c`, not health.

[browser-research-native.py](../tools/qa/browser-research-native.py) verifies
the executable hash, parses the actual native unit table for center HP 3600,
executes the original City scanner and then the original collector predicate.
Sixteen cases cover both races, absent center despite a positive health literal,
center with HP 3600/1/0, and idle/non-idle task bytes. All pass. The City fixture's
generic default HP table uses sentinels, so these cases deliberately supply
explicit HP from the real parsed center definition, not its `-1` default branch.
Line I/O and mapped memory are fixture boundaries; this is not a full native
construction lifecycle, map occupancy run, rendering run or native frame clock.

Original executable SHA256:
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
Unique native result: `/tmp/dc-research-native-20260923-r04.json`.

| Race | Science Chain | Research Center | Dependency | Cost / Prerequisite |
| --- | --- | --- | --- | --- |
| Human | 20 -> 21, slot 3, DEPEND 2 -> 4 | 22 / RSCHPOD, slot 4 | 6 | 3000 / 4 |
| Alien | 32 -> 33, slot 3, DEPEND 16 -> 18 | 34 / RSCHIV, slot 4 | 20 | 3000 / 18 |

The factory validates the source unit definitions and both base/science/research
dependency chains. These are purchase prerequisites, **not an additional gate on
an already existing center**. Building ownership changes eligibility as soon as
its committed health becomes nonzero; dropping that health to zero disables it.
Do not invent a delay after completion, permanent research latch, or separate
paid spy upgrade. This module does not implement center purchasing/construction.

Unmodified HUMAN07 team 0 starts with an exo center and barracks, but no slot-3
science lab or slot-4 Research Center. Its eight initial slot-4 health gates are
false. The briefing explicitly describes building a Research Center and sending
an EXPLOITER to excavate. An existing positive-health slot-4 center in another
source opening can enable discovery immediately, without buying it again.

## Exact Engine API

[browser-research.ts](../src/engine/browser-research.ts):

- `createBrowserResearchConfiguration({ runtimeProfile: "browser-adapted",
  activation: "source-city-slot4-health", scienceOwner, source, units,
  dependencies })` creates an immutable, factory-owned configuration. Required
  source records are the parsed original tables, not inferred sprites. The
  nonempty `scienceOwner` names the existing owner of committed City health.
- Configuration fields are `kind: "browser-research-source-v1"`,
  `runtimeProfile`, `activation`, `scienceOwner`, `sourceCanonical`, and
  `sourceTablesCanonical`. This is a new explicit opt-in, not a default change
  to any existing runtime profile or CampaignSessionOptions field.
- `observeBrowserResearch(world, configuration, scienceOwner)` reads all eight
  `world.buildingSlots["team,4"]`. Positive health requires matching world and
  host actor key, fixed slot `team*15+4`, generation, race/type, HP, active status
  and registry. Missing/duplicate/foreign/stale ownership rejects. Zero health
  rejects a contradictory live actor. Normal source HP 0..3600 is admitted;
  arbitrary over-max scripted health is outside this bounded profile.
- Its detached state has `kind: "browser-research-state-v1"`, source canonical,
  owner, session ID, world clock, eight team records (team/dependency/unitType/
  health/actor identity), and eight derived `spyTeams`. It never mutates City,
  resources, dependencies, fog, raw actor bytes, queue state or persisted spy.
- `restoreBrowserResearch(world, configuration, saved)` recomputes that entire
  state and checks exact recursive field equality, independent of JSON key
  order. Extra fields, wrong identity/generation/owner/source/session/clock,
  changed health or forged booleans reject. Recreate the configuration from
  original source inputs; a deserialized/copied configuration is not an owner.
  Source consistency is not cryptographic authentication of a forged whole save.

[browser-type37-presentation.ts](../src/engine/browser-type37-presentation.ts):

- `observeBrowserResearchType37Frame(world, presentationOwner, { research,
  scienceOwner, snapshot, bindings })` derives health gates and delegates to
  the existing real collector observer. No caller-supplied spy boolean is used.
  `presentationOwner` remains `{ runtimeProfile: "browser-adapted",
  sourceCanonical: aiSelectorSourceCanonical(world.source) }`.
- Call after projecting actual host positions. Supply the same committed world,
  actual simulation snapshot and native bindings. Only idle, live, registered
  6/14 collectors at an active FIFO coordinate, with exact host position/ground
  occupancy and no attack target or resource-task ownership, are eligible.
  An idle-looking resource-owned worker is excluded until its existing owner
  releases it. This function does not seize a worker or move one itself.
- Pass its returned frame exactly once as `CampaignSessionInput.type37Frame`.
  The existing session/reducer alone owns countdown 450, ineligibility reset,
  FIFO pop, collector-team allocation and source type definition/script-byte
  initialization. Do not run `stepBrowserType37` again from the view or copy
  queues into research state. Session replay remains responsible for that state.
- `projectBrowserType37Discovery(world, presentationOwner, { research,
  scienceOwner, localTeam, presentationPolicy: "adapted-original-cursor-v1",
  isTileVisible })` returns detached entries with the existing source queue,
  slot/generation, pending types and countdown. Visibility requires an active
  marker, that local team's current research gate, and the supplied **ordinary
  tile visibility** predicate. Other teams' centers do not grant shared research.

## Presentation And Integration Boundary

The discovery projection uses actual `CURSOR/CURS.SPR` frame 6 from
`/assets/generated/sprites/CURSOR/CURS.{json,png}`, source SHA256
`c614526158b82e99e3022c974c754c7ad58a7827dac49a48b362989601924c89`.
It is an explicit **adapted UI overlay**, not native POOP art or proof that the
original scene used this cursor. Frame 6's source atlas rectangle is
`x=32,y=32,width=31,height=31`. Use the existing sprite renderer/metadata and
normal terrain-to-screen transform at the marker's tile coordinate.

Returned entries are `presentation: "adapted-discovery-marker"`,
`selectable: false`, `combatBinding: null`, empty `collisionFootprint`, and an
asset descriptor with `role: "adapted-ui-overlay-not-POOP-art"`.
The result explicitly has `revealsTerrain: false`. Do not create a simulation
unit/static target, selection box, weapon, health bar or collision body for it.
Do not reveal map tiles or use reveal-all to bypass research. Keep original
marker entity/host/FIFO metadata; hidden or inactive is not source deletion.

The absent POOP FIN is **not proof that its native visual was invisible**:
native scene code still has spy-gated animation-bank reads. This change avoids
inventing that missing sprite by exposing a separate, labelled adapted overlay.

Integrator callbacks, in order:

1. On explicit adapted setup, create both owners from the original mission and
   the declared City owner. Under the discovery presentation policy, validate
   source marker identities with the existing presentation projection before
   excluding those particular placements from ordinary asset admission and
   combat registration. Do not globally blacklist POOP or scripted type changes.
2. On each committed observation, call `observeBrowserResearchType37Frame` and
   supply it to the one existing session step. Remove the current hard-false
   observation only in that opt-in branch. Use the city owner's committed
   actor/health transition, not a UI purchase click or a fabricated completion.
3. On render, call `projectBrowserType37Discovery` with actual local tile
   visibility and draw only `visible` entries using the descriptor above.
4. On save, optionally store the derived research state next to the view's
   session checkpoint and the selected profile/presentation policy. On restore,
   validate/replay the session first, recreate configuration from original
   mission tables plus the declared owner, compare saved profile fields with
   that configuration, and call `restoreBrowserResearch`. Do not trust saved
   booleans to override City or bypass session FIFO/frame replay. Research has
   no independent journal or unlock history to merge.

These define the integration contract now implemented by MissionView below.
The old presentation helper deliberately still returns `source-art-required`
without the explicit overlay policy; legacy view checkpoints retain false-gate
observations rather than silently upgrading their runtime behavior.

## Focused Verification

[browser-research.test.ts](../tools/qa/browser-research.test.ts) covers real
tables and HUMAN07 opening, lab-vs-center distinction, both races, foreign and
stale owners, destruction, strict JSON state validation, resource-owned/moving/
attacking worker exclusion, public simulation move-away/return commands, source
artifact types 63 then 64 at visits 450/900, source HP/script-byte initialization,
queue/source preservation, original cursor metadata/PNG dimensions, normal
visibility and detached noncombat projection. Controlled fixtures are labelled;
no source mission was rewritten on disk and no fullgame outcome is asserted.

Native reproduction (install probe-only Capstone/Unicorn in an isolated path):

```sh
PYTHONPATH=/tmp/dc-research-native-deps-20260923 python3 -B tools/qa/browser-research-native.py
node --import tsx --test tools/qa/browser-research.test.ts
```

The initial engine-only verification did not cover MissionView. The following
section records the subsequent integration separately.

## MissionView Integration Acceptance

[mission-view.ts](../src/mission-view.ts) now selects
`adapted-original-cursor-v1` for new adapted missions with source markers. It
creates a factory-owned research configuration from original mission units,
dependencies and source, naming `campaign-session-city` as the health owner.
Only validated original marker placements bypass POOP asset admission and combat
registration. Scripted/unproven type37 actors retain ordinary admission rules.

`CampaignSession.browserResearchFrame` applies the proposed unit updates to a
detached state using the existing update batch and City feedback, then calls
`observeBrowserResearchType37Frame`. Thus current collector positions and center
death are observed without committing twice. The returned frame is consumed by
the single existing session step. Positive frame flags require matching source
slot4 health, team/type, generation and live registry ownership. False frames
remain legal for old saves even when a positive-health center exists.

The view retains `browserResearchWorld`, a detached complete source world, for
marker/research projection. The compact browser frame intentionally omits host
occupancy planes and is not sufficient evidence for marker ownership.

`researchDiscovery` uses ordinary player-0 tile visibility and the current
player-0 center gate. The canvas draws original CURSOR/CURS frame6 through the
existing indexed palette routine at the normal tile-to-screen coordinate. Fog
is painted normally afterward. No POOP combat actor, selection, collision,
health bar or fog reveal is created. No explanatory UI text was added.

View checkpoints optionally store `research: { presentationPolicy, state }`.
Restore first replays the source session, recreates the configuration, then
validates the derived research state exactly. Missing `research` preserves the
legacy false observation branch and original checkpoint shape, including a
legacy source-center save with undecremented markers. This is **not** a blanket
claim that every source mission or historical checkpoint has zero research HP.
No new session profile option or research journal is needed; existing serialized
type37 input frames retain their boolean representation.

[browser-research-view.test.ts](../tools/qa/browser-research-view.test.ts) covers:

- Unmodified actual HUMAN07 loading, no initial research, hidden noncombat
   markers, cursor indexed-asset loading and zero POOP requests.
- Explicit in-memory source-City variants with a team0 or team2 center. Only the
   selected City's original slot4 pair changes to `1 3600`; disk SCN/TRO/MAP,
   queues, artifact definitions and source collector delivery remain untouched.
   Team2 research does not unlock player0. This does not test purchasing a center.
- Exact initial view JSON restore, forged derived-state rejection, false-gate
   legacy save/restore with an existing center, source session rejection of a
   forged unlock, projected center-death disable without mutation, exact session
   JSON before/after center death, and post-death unlock rejection with rollback.
- Public movement of HUMAN07's delivered collector to original marker `(5,32)`.
   Eligible visits449/450/899/900 occur at view ticks835/836/1285/1286. Exact full
   view JSON restore passes at all four boundaries. Real source type63/LENS
   actors spawn at slots208/209, team0, HP400, source script byte0. FIFO changes
   `[63,63,63] -> [63,63] -> [63]`; the marker remains source-owned.
- Visible original frame6 canvas draw at both pops, exact screen coordinates,
   unchanged explored fog, no marker binding and no invented ordinary LENS fire.

The source LENS weapon46 has range `-1`, class6, damage8000, rate15 and special
shot selector11. Its special deployment attack is not implemented by ordinary
simulation fire. A tightly checked source artifact helper admits the real mobile
and its art without a generic weapon; JSON restore enforces that absence. It
does not invent a nonnegative range or claim special attack parity. No type96
spawn was encountered in this bounded two-pop run.

Acceptance: 3 integration tests pass in
`/tmp/dc-research-final-integration-r7.log` (258.6s); 16 research/type37 controls
pass in `/tmp/dc-research-final-controls-r8.log`. The older session relay fixture
now supplies a real source center instead of an unsupported hand-set true flag.
Scoped TypeScript validation has unrelated concurrent construction errors in
`browser-construction.ts` and the construction section of `campaign-session.ts`;
the research/view/test slice has no remaining reported type errors.

Canvas acceptance uses the repository's actual-loader source-render test harness
and records draw calls, not browser screenshot/pixel evidence. No browser windows,
agents, full suite, commits or construction lifecycle changes were used. Native
16-case evidence above was not rerun by this integration. Center purchasing,
LENS deployment combat, pixel rendering and HUMAN07 victory remain unverified.
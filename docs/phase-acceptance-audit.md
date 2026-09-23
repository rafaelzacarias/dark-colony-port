# Independent Phase Acceptance Audit

Agent-QA, 2026-09-18. Audit ID: `a71c9`. Repository source was read only.
Only this document and uniquely named temporary probes/reports were written.
No browser window, shared-tab interaction, source fix, extraction, build, or
additional agent was started. The requested `npm run typecheck` may refresh
TypeScript's normal incremental cache. This workspace has no Git metadata.

## Decision

**Do not accept phases 2-4 or claim campaign completion.** Phase 1's existing
acceptance is retained with matching source fingerprints. Phase 5 contains
partial implementation, but its completion gate remains unaccepted. Changing
that wording to "partial" would not close any requirement.

The requested end state, phases 1-4 accepted and phase 5 partial, is blocked
by implementation and verification work outside this read-only assignment.
Passing tests below are real, but several deliberately assert unsupported
behavior, and most exercise helpers rather than the live mission controller.

The acceptance baseline is [../ARCHITECTURE.md](../ARCHITECTURE.md), the source
mission scripts, and the current decoding/runtime documents. A separate
original product specification was not supplied or found. The checklist covers
the requirements named in those repository contracts; it cannot certify
coverage of an unseen external specification or invent its performance limits.

| Phase | Decision | Reason |
| --- | --- | --- |
| 1: Ingestion | Retain accepted | MDF/MDS/manifest hashes match recorded evidence; ingestion contracts pass. Full ISO/ZIP re-extraction was not repeated. |
| 2: Assets | Not accepted; partial | Troop prerequisites are actually lost; palettes, lighting variants and static-object semantics remain incomplete. |
| 3: Simulation | Not accepted; partial | No live mission controller, destructible objective objects, source colony state, faithful transports or mission AI. |
| 4: Presentation | Not accepted; partial | Useful controls and terrain geometry exist, but hidden-target commands, incomplete composition, fog, audio scheduling and missing commands remain. |
| 5: Complete game | Not accepted; partial work exists | Neither opening mission can complete authentically; later missions/progression and release-scale evidence are missing. |

## Executed Evidence

| Check | Actual result | Scope and limit |
| --- | --- | --- |
| `npm run typecheck` | PASS, `TYPECHECK_EXIT=0` | Compilation, not gameplay correctness. |
| `node --import tsx --test tools/qa/*.test.ts` | 98 passed, 0 failed, 2 skipped | Initial runtime/helper snapshot; optional Chromium tests skipped. |
| `env -u UI_BROWSER_MODULE -u UI_BROWSER_EXECUTABLE npm test` | 146 passed, 0 failed, 2 skipped; `TEST_EXIT=0` | Later snapshot also includes the new controller startup test and FIN-duration test. Browser launch was explicitly disabled. |
| Live-class, local-assets probe | Five defect groups reproduced | Real `loadCampaignMission` and `MissionView`; mocked local fetch and no-op canvas, no DOM or browser. Success of these assertions confirms defects, not game acceptance. |
| Editor diagnostics | No errors | Controller, mission view and terrain renderer at check time. |
| SHA-256 | Matches architecture | MDF, MDS, manifest and research executable. |

Temporary evidence paths:

- `/tmp/darkcolony-agent-qa-typecheck-20260918-a71c9.log`
- `/tmp/darkcolony-agent-qa-focused-20260918-a71c9.log`
- `/tmp/darkcolony-agent-qa-full-tests-20260918-a71c9.log`
- `/tmp/darkcolony-agent-qa-probe-20260918-a71c9.ts`
- `/tmp/darkcolony-agent-qa-probe-20260918-a71c9-r2.log`
- `/tmp/darkcolony-agent-qa-fingerprints-20260918-a71c9.log`

The terminal echoed unrelated concurrent work, so only the uniquely named
logs were used for results. Sources changed during the audit: the controller,
FIN-duration helper and balance handoff document appeared while it ran.
The fingerprint report pins the inspected runtime snapshot; this is not a
claim that every subsequent edit was audited. Historical headed-browser claims
in [live-qa.md](live-qa.md) were inspected, not rerun or independently renewed.

## Prioritized Blockers

### P0: No Authentic Mission Completion

1. **The verified trigger/controller path is not live.**
   [../src/mission-view.ts](../src/mission-view.ts#L155) expands startup troops;
   its update path only advances the simulation, combat presentation and patrol
   routes. [../src/game-data.ts](../src/game-data.ts#L96) hard-codes the two
   mission-01 stems. No live call to `createMissionController`, `planMissionStep`,
   trigger dispatch or result transition was found. The newly added
   [../src/engine/mission-controller.ts](../src/engine/mission-controller.ts)
   plans world commands but has no concrete live world adapter; `msg`,
   `waypoint` and `exomoney` are rejected. Its real ALIEN01 startup test
   correctly expects `next === null`, not a successful mission start.

2. **ALIEN01's objective targets cannot be attacked or destroyed.**
   [../src/mission-view.ts](../src/mission-view.ts#L168) diverts every
   zero-speed entity into a render-only static array. The probe loaded all
   eleven team-1/type-82 targets but found zero simulation buildings.
   [../src/engine/simulation.ts](../src/engine/simulation.ts#L476) resolves
   attacks/damage only through its unit collection. Source success requires
   eleven type-82 victim losses; the current world cannot produce them.
   HUMAN01's two inactive beacons likewise have no live type-change path.

3. **HUMAN01 colony state is omitted.**
   [../tools/extractors/data/scenario.ts](../tools/extractors/data/scenario.ts)
   preserves team city rows, AI slots and alliances, but the live loader/view
   uses trailing placements and team-0 money. The source team-1 city section
   contains active colony entries. Their building-slot state, damage, removal
   and occupancy are not instantiated. Supplying zeros for `b(1,0..4)` would
   immediately invent the all-colony-lost failure, not implement it.

4. **Transport and time semantics are replaced, not integrated.**
   [../src/engine/legacy-mission.ts](../src/engine/legacy-mission.ts#L47)
   treats `reinforce` and `reinforce2` as the same instant formation expansion,
   ignores trigger lives, and applies `c>0` at constructor tick zero. The
   executable distinguishes carrier delivery from direct/FIFO production.
   `abduct` is asynchronous; `bail` independently expires strictly after its
   wrapped 10,000-ms deadline. See [transport-decoding.md](transport-decoding.md).
   No instant deletion, arbitrary delivery timer, filtered action list, or
   wait-for-carrier victory barrier is an authentic substitute.

### P1: Integration Correctness

5. **Enemies are passive.** No acquisition or retaliation is implemented in
   the live combat path. A two-unit fixture using original TRSC/GRAY stats
   stayed idle/full-health for 200 ticks; after the player attacked, the Gray
   died while the player remained at 150/150. The fixture does not prove
   original AI timing, but it proves there is no response at all. Campaign AI
   flags and alliances are not consumed. Scripted patrol movement is not AI.

6. **Fog-hidden targets accept attack commands.**
   [../src/mission-view.ts](../src/mission-view.ts#L398) searches all enemy
   units without consulting `visibility`. In both real mission datasets,
   centering on unseen enemy `(49,72)` and issuing the normal canvas command
   assigned that enemy to all five selected units. The probe confirms queue
   eligibility, not browser pixel output. Add a live command regression that
   hidden targets cannot be acquired through pointer input.

7. **Troop prerequisites are corrupted.**
   [../tools/extractors/data/tables.ts](../tools/extractors/data/tables.ts#L119)
   starts every prerequisite list at token 7. Type-1 troop rows start it at
   token 5. All 18 troop rows lose prerequisites: ID 7 yields `[]` instead of
   `[0]`, ID 9 yields `[]` instead of `[1]`, ID 83 yields `[6]` instead of
   `[4,3,6]`. The existing fixture covers only a type-0 building. Fixing the
   parser also requires re-exporting generated dependency data and testing
   all three record kinds. [balance-runtime.md](balance-runtime.md) independently
   records the executable branch; its conservative catalog helper is not
   integration with production.

8. **Team identity is missing from authoritative combat.** Team ownership
   exists only in a view-side map; simulation allegiance is the two race
   strings. A synthetic nonowned, same-race unit cannot be attacked: its click
   issues Move. This demonstrates the representational limitation, not that
   first-mission human allies should be attacked. The engine cannot generally
   implement SCN alliance rules, team-specific resources or victim counters
   from faction alone. Preserve original team/type/slot identity in world state.

9. **Static occupancy and original removal are missing.** Render-only objects
   never reserve cells; even generic engine buildings are outside the unit
   movement reservation loop. PTH eligibility is not building collision.
   Dead units remain in snapshots; no original registry/status lifecycle or
   exactly-once combat-loss producer is connected. Abduction must not count
   as a combat loss. Source footprint tables alone do not prove the mapping
   from scenario objects to footprints.

### P2: Presentation and Control Gaps

10. **Terrain geometry is not complete terrain presentation.** Independent
    background/foreground mirrors and Y projection pass. The renderer paints
    both terrain layers before units and never consumes the verified low-nibble
    sprite cutoff, so terrain cannot correctly occlude sprites. The extractor
    makes palette-zero pixels transparent for both layers, while the native
    background path writes them; current code shares one atlas for both.
    The latter is a contract mismatch, with actual affected map-pixel counts
    not measured by this audit. Keep it separate from the proven mirror fix.

11. **FIN helper capability exceeds live composition.**
    [../src/mission-view.ts](../src/mission-view.ts#L614) chooses only the first
    matching body child, discards other sprites/effects and their offsets,
    and centers the frame instead of applying source anchors. It samples at
    a fixed `20/3` FPS. The new `finSourceDuration` helper has no live caller.
    Passing child/anchor/duration helper tests does not validate this consumer.

12. **World fog differs from radar fog.** The world draws all terrain and then
    a 72%-opaque dark overlay for every currently invisible cell, without an
    explored mask. Radar distinguishes opaque unknown from explored darkness.
    The world therefore exposes unknown terrain and lacks persistent exploration
    presentation. No original-game visual baseline was available to certify
    the correct fog algorithm; the current two views are internally inconsistent.

13. **Action controls are a limited subset.** Stop queues a command; Move/M
    only focuses the canvas, with no explicit move-order mode; Patrol and
    Waypoints are visibly disabled. Assault, Dig, Deploy, abilities, production
    and upgrade commands are absent from this campaign HUD. Preserve those
    honest disabled states until implemented. A focus-only button test is not
    a Move-mode behavior test. Keyboard/radar block input under objectives,
    but world pointer handlers do not share that guard; test overlay/pointer
    capture before claiming modal input isolation.

## Requirement Checklist

`PASS` below is scoped to the stated contract. `PASS-H` means historical
evidence was inspected but not rerun. `FAIL` means unmet acceptance, including
missing evidence; it does not necessarily mean the corresponding unit test fails.

### Phase 1: Ingestion

| Requirement | Verdict | Concrete evidence / missing evidence |
| --- | --- | --- |
| MDF/MDS provenance and geometry | PASS / PASS-H | Fresh hashes match; geometry/CD001/ISO validation is historical. |
| ZIP identity and byte-exact ISO/tree extraction | PASS-H | Recorded ZIP-stream and 5,151-file equality; not repeated. |
| Deterministic content-addressed inventory | PASS | Manifest file hash matches; scanner determinism test passes. Full raw-tree rescan not performed. |
| Distinguish redistributables, authoring data and media | PASS | Ingest classification tests pass, including numbered outcome text. |
| Preserve CD audio outside ISO data track | PASS / PASS-H | Geometry/payload tests pass; four real converted tracks are historical evidence. |
| Strict TypeScript baseline | PASS | Explicit exit-zero log. |

### Phase 2: Assets

| Requirement | Verdict | Concrete evidence / missing evidence |
| --- | --- | --- |
| SPR frames, compression, anchors, deterministic RGBA | PASS | Parser/PNG/atlas tests; historical complete 284-archive corpus decode. |
| Standard FIN structure/states and anomaly preservation | PASS | Standard parser tests and real TRSC/GRAY binary-to-generated checks. |
| All required FIN variants and semantics | FAIL | Eleven lighting variants unsupported; two invalid authoring files are explicitly rejected, not assumed playable. Determine actual runtime dependencies before treating malformed files as required content. |
| BTS layout, key resolution and reproducible atlases | PASS | Bank/atlas tests; native zero-lookup semantics retained. Background-opacity limitation remains separate. |
| All MAP/MTG/PTH bundles and raw planes | PASS | Full 108-map corpus and routing-chain tests, 1,345,872 cells. |
| Terrain layer orientation and mirror flags | PASS | Orientation and independent `0x20`/`0x40` transform tests; native evidence document. |
| RGB/RMP/team palettes and lighting semantics | FAIL | No complete decoder/shader contract or calibrated palette rendering. |
| Static footprints, slots and relevant auxiliary layers | FAIL | Some native footprint tables verified; live type/slot mapping absent; O16/OVH and editor SET semantics not fully established. |
| WAV/AVI/CDDA browser conversion and determinism | PASS / PASS-H | Container normalization and extractor contracts pass; actual FFprobe/corpus playback is historical, not rerun. |
| GAMESTAT/WEAPSTAT faithful named fields | PASS, limited | Source-column parser tests pass; unnamed tail semantics are not certified. |
| DEPEND prerequisite preservation | FAIL | All 18 troop rows lose prerequisites in the real corpus probe. |
| SCN/TRO/MSG/briefing data preservation | PASS, limited | Parser tests pass, including trigger metadata in extractor output; live reduced interfaces/consumers do not establish runtime support. |
| Reproducible complete current generated corpus | FAIL evidence | No new clean export/hash comparison of all generated files; parser repair will require regeneration. |

### Phase 3: Simulation

| Requirement | Verdict | Concrete evidence / missing evidence |
| --- | --- | --- |
| Fixed-step, seeded RNG, stable command replay | PASS, scoped | Clock/RNG/replay tests cover prototype simulation, not a complete mission. |
| Source infantry passability and collision-aware groups | PASS, scoped | PTH family mask, formations, swept reservations and Stop tests. |
| Original movement/routing/timing and all movement classes | FAIL | Uniform-cost four-neighbor A* is browser policy; original routing/costs, flying occupancy and calibration incomplete. |
| Unit damage/range/cooldown mechanics | PASS, scoped | Simultaneous damage and event replay pass for simplified combat. |
| Armor, weapon delivery/specials and source balance | FAIL | Defense, shots, projectile speed, reload/special behavior and original time conversion not implemented by live adapter. |
| Team alliances, ownership, AI and combat response | FAIL | Race-only allegiance; passive-enemy probe; source AI/alliance fields ignored. |
| Economy, resources, construction | FAIL full gate | Generic harvest/paid-node construction tests pass; campaign source producers, resources, dependencies and queues are not connected. |
| Production and upgrades | FAIL | Dependency data corrupt; conservative standalone checks are not a production system. |
| TRO expression/lives/order primitives | PASS, scoped | Signed VM, exact statistics namespaces, action order and lives tests. |
| Live normal/trip scheduler and complete mission actions | FAIL | No live controller call or successful reservation-to-MTG dispatch; new controller rejects real startup actions. |
| Static objects/colony/building slots/removal/statistics | FAIL | Zero mission simulation buildings, untargetable objectives, absent colony state and loss events. |
| Reinforcement, extraction and independent result clock | FAIL | Prototype immediate troops; no carrier/FIFO/commander lifecycle or live delayed result. |
| Serializable full state and resume/replay | FAIL | Snapshot tests do not restore orders, cooldowns, paths, trigger lives, transports, slots and result deadlines. No mission round-trip evidence. |
| Deterministic day/night visibility parity | FAIL full gate | Simplified vision tests pass; triangular day/night and Manhattan sight are not source-calibrated. |

### Phase 4: Presentation

| Requirement | Verdict | Concrete evidence / missing evidence |
| --- | --- | --- |
| Source HUD, fixed logical world, scaling and radar geometry | PASS / PASS-H | Geometry tests; prior 512x452 desktop/mobile browser evidence, not rerun. |
| Selection, drag box, Stop, camera, groups, radar and objectives | PASS, subset | Reducer/pointer helpers and historical browser tests; full action surface remains absent. |
| Visibility-safe pointer commands and team targeting | FAIL | Both real missions accept unseen attack targets; team combat limitation reproduced. |
| Complete original unit/build/upgrade controls | FAIL | Missing/disabled actions and focus-only Move; no source command-to-state end-to-end matrix. |
| Terrain geometry, lookup and transforms | PASS | Current focused tests plus full source layout corpus. |
| Terrain/sprite occlusion, background opacity and fog | FAIL | Cutoff ignored; shared alpha atlas; world lacks unknown/explored distinction. |
| FIN directional body playback | PASS, limited | Real-state selection tests and prior browser playback; actual timing still calibrated. |
| Full children, anchors, effects, source durations, palette lighting | FAIL | Live consumer does not use complete composition or new duration helper. |
| Audio unlock/mute/limits/selection/shot responses | PASS / PASS-H | Catalog and lifecycle tests; historical connected non-silent browser playback. Not physical speaker verification. |
| Combat effects, ambient and CD soundtrack scheduling | FAIL | Complete in-mission scheduling and source behavior evidence missing. |
| Browser video and audio compatibility | FAIL full gate | Chromium historical playback exists; current production/WebKit evidence missing. |

### Phase 5: Complete Game

| Requirement | Verdict | Concrete evidence / missing evidence |
| --- | --- | --- |
| Authentic mission-01 win and loss, both factions | FAIL | Neither live world/controller can produce all required results. |
| Missions 02-15 and campaign progression/results | FAIL | Loader hard-codes mission 01; no completion-to-next-mission integration. |
| Briefings/cutscenes/outcomes in actual campaign flow | FAIL | Converted/inspectable media is not campaign sequencing. |
| Original-game behavioral and visual comparisons | FAIL evidence | Bounded x86 probes are not original gameplay recordings or end-to-end references. |
| WebKit and production-build end-to-end acceptance | FAIL evidence | Not run here; existing harness targets Vite development/Chromium. |
| Battle-scale FPS, memory and deterministic replay budgets | FAIL evidence | No agreed numerical budgets or repeatable battle-scale reports in the inspected gates. |

## Minimum Authentic First-Mission Gate

This is a separately named, reduced milestone, **not** acceptance of phases
2-4 or the full original game. It may defer unrelated missions, encyclopedia,
production not exercised by these missions, and nonessential presentation
polish only with explicit scope agreement. It may not substitute objective
counters, omit threatening enemies, fake transports, or bypass source failures.

1. Load real SCN team/city/placement state, unit types, slots, alliances,
   collision and complete TRO metadata. Preserve team/type identity through
   damage, type changes and removal. Initialize real building-slot/statistic
   values; missing fields must be diagnosed, not made zero.
2. Drive normal scans in source order on the verified eight-update cadence;
   use signed `c = counter >> 4`, not render frames or unbounded seconds.
   Dispatch trip events only after a successful next-cell reservation using
   reversed MTG rows and six-bit IDs. Preserve lives, reverse action order
   and rearming. Retain the distinction between the source update clock and
   the browser's current 20 TPS policy.
3. Implement every used world action: `msg`, `waypoint`, `exomoney`, `newtype`,
   `reinforce`, `reinforce2`, `abduct`, `setlifes`, `bail`. Support audited
   no-FIFO ALIEN01 behavior without claiming a general producer implementation.
   Reject unimplemented paths before mission entry, not after a nominal win.
4. Implement source-relevant AI/combat, destructible static targets, colony
   survival and exactly-once victim-loss events. A noncombat pickup does not
   create a victim loss. Match movement/combat timing sufficiently to preserve
   the mission's threats and deadlines; record remaining calibration limits.
5. HUMAN01: activate the source beacons via type 95 to 84 without changing
   team; traverse the real trip regions, including tag 7's ring and untagged
   center; trigger 7 rearms trigger 4. Victory is armed trigger 4 with
   `s(4,3)>2`, not a generic enemy count. Preserve timeout `c>1200`, colony
   failure when all five `b(1,slot)==0`, and commander-loss equality predicates
   for types 69-72. Do not impose extra predicates absent from the script.
6. ALIEN01: destroy all eleven team-1/type-82 objective entities, generating
   `s(1,0,82)>10`, not capture/ownership conversion or attacker kills. Preserve
   player commander loss `s(0,0,73)==1`, timed enemy commander abduction at
   `c>10`, source reinforcements/messages, and the absence of an MTG tag-7
   region. Do not invent one to exercise a dormant trigger.
7. Deliver/retrieve through the verified asynchronous carrier tasks. Run the
   world throughout the independent bail delay; allow subsequent result
   overwrites. Transition strictly after the wrapped deadline, preserving raw
   success/failure codes and reason-specific outcome text. Carrier departure
   is not the exit gate.
8. Produce deterministic controller/world event traces and replay hashes for
   wins and losses in both missions. Add negative controls: wrong trip team,
   failed reservations, not-yet-armed victory, 10 versus 11 target losses,
   duplicate losses, dead/moving pickup targets, blocked delivery, exact
   deadline equality, clock wrap and later result overwrite.
9. Demonstrate both wins and all distinct source failure branches through
   normal UI input in the shared embedded browser when the main owner grants
   interaction. Verify selection, attack/Stop, occlusion/fog, objectives,
   result screen and return/restart with no debug state edits or forced wins.
   Use deterministic Node clocks for timing tests if embedded rAF is suspended;
   disclose the browser limitation rather than launching another window.

## Missing Evidence and Source Constraints

- **Available evidence is substantial:** matching MDF/MDS and executable,
  original scripts/maps/tables, generated assets, parser fixtures and bounded
  native-instruction probes. There is no basis to declare the whole project
  impossible merely because a format was previously unknown.
- **Not yet established:** complete colony/building initialization, world
  action consumers, AI/combat/timing calibration, registry cleanup and full
  transport movement/creation behavior. Transport probes deliberately intercept
  some movement, collision and creation boundaries; their documented results
  must not be inflated into complete lifecycle proof.
- **Native evidence is not full-game validation:** no original-game reference
  playthrough, mission win/loss capture, pixel comparison, or synchronized
  original-vs-browser trace was produced by this audit.
- **Runtime coverage is missing:** tests must exercise the controller connected
  to authoritative world state, actual static damage and statistics, successful
  source actions and real result transitions. Hand-seeded counters, mock adapter
  receipts and unsupported-action tests alone cannot satisfy that gate.
- **Release evidence is missing:** production-preview and WebKit playthroughs,
  campaign progression, full-state restore/replay, repeated mission cleanup,
  battle-scale frame-time/memory measurements, and agreed numerical budgets.
- **Documentation needs reconciliation by its owners:** the older trigger
  document's partial abduction discussion is superseded by the later transport
  trace; navigation's later verified infantry caller narrows its earlier
  blockers; README's unresolved MAP-composition wording predates the solved
  layout/mirrors. New production/duration/controller helpers remain separate
  from live support. Do not use stale notes as evidence either for or against
  an implementation that has since changed.

Next acceptance order: repair dependency preservation; define persistent world
identity/colony/static combat state; finish action and transport adapters;
connect and test the controller; prove both first-mission result paths; then
close the remaining full phase-2/3/4 contracts and phase-5 release evidence.
Source/data owners must make those changes. This audit does not authorize or
perform them, and does not advance any phase gate on their behalf.
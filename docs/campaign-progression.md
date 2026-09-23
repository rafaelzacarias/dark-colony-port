# Bounded Campaign Progression

## Source Boundary

`loadCampaignMission(faction, missionNumber = 1)` accepts integer numbers 1 through
15 only. Paths are zero-padded within the selected faction, for example
`HUMAN/HUMAN02`. Invalid numbers and factions reject before fetching.

The generated data index lists the complete numbered `HUMAN01` through `HUMAN15`
and `ALIEN01` through `ALIEN15` source sets, including scenario, TRO, messages,
and briefing paths. The browser follows that numeric source order; it does not
insert DEMO/training/multiplayer scenarios, wrap, skip unavailable missions, or
claim a reverse-engineered native unlock/save protocol. Tests compare every
generated TRO block with its original source script, including unsupported actions.

## Results

- A ready source result code 0 offers NEXT MISSION, requiring an explicit click.
- Nonzero ready results offer RETRY MISSION for the same faction and number.
- Pending outcomes offer neither action. Merely rendering results does not load.
- Success at 15 offers exit only. No mission 16, wraparound, or invented ending.
- MISSIONS remains available. Returning to the launcher starts a fresh mission 01;
  there is no persisted campaign progress or unlock state.
- Result text comes from SCN outcome reason codes. Objectives use the extracted
  objective list, or the source briefing plain text when that list is empty.
- Missing or unsupported next missions show the requested number and diagnostic;
  they never fall back to 01. Long diagnostics scroll while exit stays reachable.

## Preflight Gates

Before constructing a view, the loader validates indexed source paths, schema,
requested scenario identity, map dimensions and layer lengths, terrain bank
agreement, tile indices, source message/outcome references, and briefing text.
All TRO blocks are audited, including dormant blocks: VM syntax/lives/bail/setlifes/setarray
use the unified controller audit; world actions use its decoder. Native omitted
lives initialize to zero without rewriting source metadata. Newrate now has a
transactional resource-state consumer and command-time statistics snapshots.
Undefined setlifes targets reject. Nothing is silently removed or executed as a no-op.

ATLANTIS, DESERT, HTRAIN and JUNGLE are admitted using the verified indexed
manifest. Source phase/team selectors, metadata hashes, payload descriptors,
sizes and hashes are validated. Arbitrary or unverified banks still reject.

Before making the view active, its existing initialization loads terrain,
foreseeable FIN/sprite assets and indexed sprite resources. The launcher now checks
`missionDiagnostic`, because initialization records errors instead of throwing.
Failures dispose the pending view and show the diagnostic, not a blank session.
Existing indexed-terrain RGBA fallback policy is unchanged; this is not a new
claim of indexed/WebGL rendering parity or complete asset integrity verification.

## Verified Support And Blockers

The corpus audit distinguishes two boundaries:

- **Pure TRO/palette preflight: 10/30**, HUMAN01/03/07/08/11/13 and
  ALIEN01/03/13/14.
- **Full source loader admission: 4/30**, HUMAN01/11 and ALIEN01/14. All four
  lack type-40 source placements and return no `sourceResource` options.

Neither boundary certifies combat-roster support, completion or playability.
The loader now constructs source-resource options for type-40 missions after
preflight. The six additional rejections are pinned to these exact diagnostics,
not treated as arbitrary failures that happen to leave a count of four:

| Mission | Full loader diagnostic after preflight |
| --- | --- |
| HUMAN03 | `Source resource: unproved SCN resource mapping` |
| HUMAN07 | `Placement 38 requires native type-37 coordinate queue and selector-6 state` |
| HUMAN08 | `Placement 45 requires native type-37 coordinate queue and selector-6 state` |
| HUMAN13 | `Placement 32 requires native type-37 coordinate queue and selector-6 state` |
| ALIEN03 | `Source resource: unproved SCN resource mapping` |
| ALIEN13 | `Placement 46 requires native type-37 coordinate queue and selector-6 state` |

The four placement diagnostics are returned as JSON arrays with code
`missing-input`; every loader error has the requested `Unsupported mission
FACTION/FACTIONnn: ` prefix. HUMAN03 and ALIEN03 initialize the resource world
but fail its mapping gate. The other four fail world initialization before
that mapping gate is reached.

The resource adapter currently proves only the original HUMAN02 and ALIEN02
SCNs, pinned respectively to SHA-256
`bed27b613d20fb8b2533369d949adb4e90b96922372e7df3e7957140d44c90ab` and
`d76d5901cb996a5dc2f3f72349ba0ec334b5b79a851ef519235a0c8eb5bec91e`.
These mappings encode source-row/native-slot/position/rate/reserve evidence,
not a generic all-mission resource decoder. Refusing other hashes is the
current evidence boundary, not grounds to relax validation. Even a changed
SCN with a matching recomputed metadata hash remains unproved. Resource-only
fixtures omit TRO explicitly and return `missionAdmission: not-evaluated`;
neither mission02 is admitted by the full loader.

The earlier ten-loader result was not ten playable missions. Neutral resource
owner 8 is outside the eight ordinary SCN teams and needs a resource owner,
not a combat faction or invented ninth team. Removing the resource options
does not restore valid runtime sessions: the focused regression check, using
unchanged SCNs/TRO and the pre-resource session options, rejects HUMAN03/07/08/13
and ALIEN03 with `Type 40 requires explicit bounded resource initialization`;
ALIEN13 encounters its placement-46 type-37 gate first. This verifies existing
runtime blockers rather than a newly lost playable mission. No archived
pre-integration executable was available for a historical runtime comparison.

| Immediate next mission | Blocking evidence |
| --- | --- |
| HUMAN02 | TRO 17 `ai` has no implemented native policy consumer |
| ALIEN02 | TRO 0 `ai` has no implemented native policy consumer |

Further missions also encounter unsupported conditions/actions/argument forms.
The bounded resource lifecycle does not establish LIVE moving-harvester handoff
or general RENAT spawning. See [live resource integration](live-resource-integration.md).
Progression stops at the first unavailable mission rather than skipping to
another source scenario.

## Verification Scope

Run `node --import tsx --test tools/qa/campaign-progression.test.ts` and
`npm run typecheck`. Coverage includes paths/default/bounds, source order and TRO
retention, ready-success progression, failure retry, no progression on failure or
pending outcomes, end boundary, separate exact preflight/admission sets and
per-rejection diagnostics, missing assets, source identity, invalid resources,
dormant unsupported actions, and palette constraints. Additional resource checks
cover source-free first missions, original SCN bytes and pinned hashes, missing
or tampered raw SCN/metadata, self-consistent but unpinned SCNs, all three
VENT/EXPL/SLUG generated FIN hashes, and failure without resource initialization.
The focused file passes 169 tests, including subtests.

No browser, shared full suite, build, native campaign sequence oracle, full mission
completion, audio/media sequence, or ending-media gate was run for this change.
UI integration is typechecked, not browser-certified. Fog edits and source allies
are retained; mission-view and engine implementation are outside this change.
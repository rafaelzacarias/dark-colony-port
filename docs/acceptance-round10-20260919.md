# Acceptance Round 10

**Phases 1-2 retain their accepted pinned scope. Phases 3-5 remain partial,
not accepted. All-phase acceptance is not achieved.** This is the orchestrator's
integration record, not an independent native-gameplay certification.

## Verification

- Final `npm run check`: **2,295 passed, zero failed, four skipped**; TypeScript
  and Vite production build passed. Vite reports a minified chunk over 500 kB;
  that warning is not suppressed or called a performance pass.
- Native actor evidence covers 58 isolated handler cases and 1,650 complete
  bounded visits. Authenticated host/session tests include identity, occupancy,
  pending-order timing, whole-visit rollback and checkpoint continuation.
- Original mode-5 evidence covers 96 source framebuffers/crops, Canvas comparisons
  and all 262,144 palette source/destination pairs. Embedded browser follow-up
  rendered a controlled BEAC placement with one exact write, 648 changed pixels
  and no fallback sprite draw. Source images and tables were unchanged.
- Browser fixtures and globals were removed; launcher and existing save retained.
  No native window was opened. No original mission AI gate was bypassed.

## Implemented Deltas

[Native AI tasks](native-ai-task.md) now implement source-derived Move/Attack
initialization and bounded task8/6/5/4 registered visits with FIN, turn/step,
ordered reservations and idle return. The host retains ownership after pending
receipt consumption, validates source configuration at direct entry points,
requires actual counter/task-budget frames, and restores midturn/midstep state.
This supersedes the former failing-constructor probe and wholly missing task
owner statements. Constructor-backed HUMAN02 slot170 pins are deliberately
narrow, not general SCN or production-created actor admission.

Review repairs reject altered authenticated configurations before ticking or
elapsed-time accumulation, reject unsupported production/occupancy mutation
before allocation commits, and reject extra native frames on unconfigured hosts.
Special commander Stop/task13 and enemy acquisition still reject atomically;
they are not treated as normal idle or silently discarded.

AI retry receipts now carry canonical SHA-256 integrity over the full receipt,
using pinned `@noble/hashes` 2.4.0, also recorded in the lockfile. Full source
recomputation is required before old receipts receive a seal. Sparse histories,
source/stage mismatches, absent native intents and contradictory packet/group/
candidate/RNG/disposition mutations are rejected. This is mutation detection,
not authentication against a caller coherently rewriting both data and digest.
Existing session source/provenance validation remains in force.

[Mode-5 rendering](phase4-mode5-effect-20260919.md) uses original bank-1
`RMP[sourceIndex][destinationIndex]`, coverage and ground cutoff. The published
sprite loader registers the source indexed metadata consumed by the existing live
frame adapter. Destination aliases must map consistently; unknown colors,
translucency, unsupported metadata and exceeded budgets fall back atomically.
No approximate opacity, glow, nearest-color quantization or fabricated shadow is
used. Readback is bounded per adapter frame, not a whole-game GPU-memory promise.

## Remaining Gates

P3 still requires original-mission source ownership across all relevant actors,
paths, acquisition/combat and shared policy/task RNG; unrestricted harvesting,
full construction/upgrades/abilities; dynamic allocation/occupancy and destruction
lifecycle. The bounded native task owner and production spawning currently cannot
be combined arbitrarily. Original mode-3 mission admission remains closed.

P4 still requires global source queue/effect ordering, mirrored/elevated mode-5,
modes 2/3/4, remaining gameplay presentation and ambient scheduling. P5 still
requires ordinary-input later-campaign completion, independent original-game
reference comparison, WebKit/iOS/device behavior and sustained rendering/memory
acceptance. Native slices, synthetic source-separated fixtures, browser effect
checks and increasing test totals do not replace those gates.
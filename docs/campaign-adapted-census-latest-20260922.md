# Latest Adapted Campaign Census

Generated: 2026-09-22T23:31:50.826Z

Actual original loader + MissionView.initialize + natural update(50ms), no injected orders or source edits

Post-census correction: [HUMAN05 message 5](human05-messages-20260922.md) was
present in the original MSG under `text 5.` and lost by extraction. The corrected
export now passes the adapted loader and focused source/native equality tests.
The historical counts and live results below are retained; no all-30 live rerun
is claimed by that focused fix.

- Canvas2D/WebGL/Image stubs: real source assets read, no GPU/native parity claim
- 200 ticks only: no campaign completion or late-trigger coverage claim
- Census assertions verify coverage/integrity, not admission of every mission
- Strict mission 01; explicit browser-adapted missions 02-15. No manufactured actors or commands.
- Successful census assertions are not mission behavior passes or full-game certification.

Totals: 29/30 loaded; 28/30 asset initialized; 27/30 reached frame 200; 26/30 without a currently observed bounded blocker.

Source SCN/TRO/MAP files compared before/after: 90; unchanged: true.

| Mission | Load | Asset init | Frame 200 | Compatibility | First failure |
| --- | --- | --- | --- | --- | --- |
| HUMAN/HUMAN01 | true | true | true | bounded-runtime-only | none |
| HUMAN/HUMAN02 | true | true | true | bounded-runtime-only | none |
| HUMAN/HUMAN03 | true | true | true | bounded-runtime-only | none |
| HUMAN/HUMAN04 | true | true | true | bounded-runtime-only | none |
| HUMAN/HUMAN05 | false | false | false | failed | Unsupported mission HUMAN/HUMAN05: TRO 1: missing source message 5 |
| HUMAN/HUMAN06 | true | true | true | bounded-runtime-only | none |
| HUMAN/HUMAN07 | true | true | false | failed | unit cell is not passable: 15,11 |
| HUMAN/HUMAN08 | true | true | true | bounded-runtime-only | none |
| HUMAN/HUMAN09 | true | true | true | bounded-runtime-only | none |
| HUMAN/HUMAN10 | true | true | true | bounded-runtime-only | none |
| HUMAN/HUMAN11 | true | true | true | bounded-runtime-only | none |
| HUMAN/HUMAN12 | true | true | true | bounded-runtime-only | none |
| HUMAN/HUMAN13 | true | true | true | bounded-runtime-only | none |
| HUMAN/HUMAN14 | true | true | true | bounded-runtime-only | none |
| HUMAN/HUMAN15 | true | true | true | bounded-runtime-only | none |
| ALIEN/ALIEN01 | true | true | true | bounded-runtime-only | none |
| ALIEN/ALIEN02 | true | true | true | bounded-runtime-only | none |
| ALIEN/ALIEN03 | true | true | true | bounded-runtime-only | none |
| ALIEN/ALIEN04 | true | true | true | bounded-runtime-only | none |
| ALIEN/ALIEN05 | true | true | true | failed-static-weapon-adapter | none |
| ALIEN/ALIEN06 | true | false | false | failed | unit cell is not passable: 12,74 |
| ALIEN/ALIEN07 | true | true | true | bounded-runtime-only | none |
| ALIEN/ALIEN08 | true | true | true | bounded-runtime-only | none |
| ALIEN/ALIEN09 | true | true | true | bounded-runtime-only | none |
| ALIEN/ALIEN10 | true | true | true | bounded-runtime-only | none |
| ALIEN/ALIEN11 | true | true | true | bounded-runtime-only | none |
| ALIEN/ALIEN12 | true | true | true | bounded-runtime-only | none |
| ALIEN/ALIEN13 | true | true | true | bounded-runtime-only | none |
| ALIEN/ALIEN14 | true | true | true | bounded-runtime-only | none |
| ALIEN/ALIEN15 | true | true | true | bounded-runtime-only | none |

## Remaining Blocks

- Fatal HUMAN/HUMAN05: loader, tick null: Unsupported mission HUMAN/HUMAN05: TRO 1: missing source message 5 (src/game-data.ts:loadCampaignMission).
- Fatal HUMAN/HUMAN07: natural-steps, tick 82: unit cell is not passable: 15,11 (src/engine/simulation.ts:DeterministicSimulation.addUnit).
- Fatal ALIEN/ALIEN06: constructor, tick 0: unit cell is not passable: 12,74 (src/engine/simulation.ts:DeterministicSimulation.addUnit).
- Placement HUMAN/HUMAN07: rejected addUnit at (15,11), tick 82; rejected source actors transport:203:0, slot 203, type 0/TRSC, plane ground; overlapping static actors placement:8, slot 160, type 41.
- Placement ALIEN/ALIEN06: rejected addUnit at (12,74), tick 0; rejected source actors placement:9, slot 161, type 13/ORTU, plane air; overlapping static actors none.
- Nonfatal behavior HUMAN/HUMAN07: 45: Missing dedicated mine detonation/splash owner (nonfatal behavior failure).
- Nonfatal behavior ALIEN/ALIEN05: 45: Missing dedicated mine detonation/splash owner (nonfatal behavior failure).
- Selector evidence incomplete ALIEN/ALIEN06: see per-team observedSelectors; enum membership is not execution proof.
- Full-game outcomes, late TRO execution, native parity, mine detonation and spy-visible type37 presentation are not certified by 200 natural frames.
- Placement repairs must prove the source actor type/slot and ground/air occupancy plane; generic collision skipping is not an acceptable fix.

Exact phase snapshots, statistics, first thrown stacks, static-call arguments/source actors, selector decisions and original hashes are in the companion JSON.

## Integration Handoff

- HUMAN05: resolve original message 5 ownership in the loader/message source. Do not manufacture text or rewrite the TRO. This blocks loading, before any live entity/statistics exist.
- HUMAN07: original TRO block 6 (`reinforce 0 16 12 69 1 0 5 ...`) delivers ground actor `transport:203:0`, slot 203, type 0/TRSC. At simulation tick 82, `MissionView.#applySessionFrame -> #registerEntity -> DeterministicSimulation.addUnit` rejects (15,11), occupied by original `placement:8`, slot 160, type 41/T, simulation ID 9. Ground delivery placement/occupancy coordination needs repair; the turret itself was registered with a weapon. Do not ignore its collision footprint.
- ALIEN06: constructor registration rejects original `placement:9`, source row 9, slot 161, type 13/ORTU at (12,74). Source occupancy projection says air; the generic `addUnit` guard checks ground passability. No admitted static footprint overlaps this cell. Repair source-backed type/plane admission and movement semantics, not a RAMP/static workaround or global collision exemption.
- Nonfatal behavior: type 45 mines are actually registered without detonation in HUMAN07 and ALIEN05. Types 45/46 still require their dedicated source detonation/splash owner; this census does not prove type 46 execution. ALIEN05 reaches frame 200 but remains a behavior failure.
- Execution evidence: selector 1 has natural strategy decisions; selector 3 also executes. No original startup selector 2 or selector-2 visit was observed in this 200-frame window. The current 1/2 strategy path exists, but mode 2 execution is not certified here. ALIEN06 is blocked before strategy execution. Neither configuration nor enum membership alone earns a behavior pass.
- Integration evidence: both turret types 41/42 have actual registered weapon metadata. Real asset initialization has zero failed asset reads and zero POOP requests; hidden adapted type37 markers are not claimed rendered. Existing explicit animation aliases remain in place with the additional archive fallback. Pickup/TRO/resource integration was exercised only where naturally reached; late effects and full-game outcomes remain unverified.

## Reproduction And Integrity

From the workspace root:

```sh
DC_ADAPTED_CENSUS_OUTPUT=docs/campaign-adapted-census-latest-20260922 \
	node --import tsx --test tools/qa/campaign-adapted-census.test.ts
```

The output option is an extensionless report stem. The runner emits both JSON and Markdown. The integration handoff above is a post-run evidence review.

Final census: 231886 ms, one census test passed (coverage/integrity assertions, not all-mission behavior). Scoped TypeScript validation passed. Only QA/report files were edited; no runtime edits, agents, browser, full suite, packages or assets. All 90 original SCN/TRO/MAP hashes match their manifest and remained identical before/after. Runtime source and both historical census reports also remained byte-identical throughout the reruns.

Historical JSON SHA-256: `c8b39bf4c99ca6bdf5eb1f027df2eaf7a41ca797bf756b21a55ff56f0cc6db01`.
Historical Markdown SHA-256: `9f26c0e20e27d33373413c622c911534bbe3087172c959e2026d710b18191b8c`.

QA instrumentation note: an intermediate run exhausted Node's heap because mock call history retained every complete session frame. The final runner resets that history each tick and keeps only the latest frame for failure identity evidence; the successful final report is from the corrected runner.

Post-run metadata correction: HUMAN05's unattempted constructor phase was explicitly added after artifact validation found an inherited-object-property omission. The runner now uses a null-prototype phase dictionary. No execution result, snapshot, hash, timing or failure evidence was altered.

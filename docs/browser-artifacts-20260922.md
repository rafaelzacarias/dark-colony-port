# Source Type94 Artifact Support

## Runtime Ownership

- [browser-artifacts.ts](../src/engine/browser-artifacts.ts) recognizes only source type94/DOTT, faction -1, zero speed, 300 HP, all three weapons -1, original 22-word tail, movement class7 and auxiliary field0. Missing or mismatched source metadata rejects; this is not blanket admission of movement classes 2..7 or other artifacts.
- [campaign-session.ts](../src/engine/campaign-session.ts) changes only the import and initialization definition filter. Browser-adapted type94 uses the existing host `flying` occupancy plane, consistent with `projectLegacyStaticOccupancy` for nonzero movement class and zero auxiliary field. It remains zero-speed. Source typeMovementClasses stays 7. Strict/native sessions still omit this definition. The independently owned messages section is untouched.
- [mission-view.ts](../src/mission-view.ts) changes only the import, artifact registration guard, visibility observers and draw action selection. Existing zero-speed static registration supplies source HP/defense and an empty ground footprint, without weapon, mine, mobile selection or movement. Type94 supplies its authored observation radius and renders its authored Stand state, never a fabricated attack/move animation.
- [source-browser-campaign-options.ts](../src/engine/source-browser-campaign-options.ts) is unchanged: the complete original units already flow through it. No portrait/preload code, source SCN/TRO/GAMESTAT, generated assets, simulation combat, or transport-host code changed.

## Original Data

[GAMESTAT.TXT](../raw_cd/DC/GAMESTAT/GAMESTAT.TXT) labels type94 `Vision sight`: DOTT, faction -1, speed0, day/night8, weapons -1/-1/-1, target class8, HP300, movement class7. Neighbor type83 is CRYO, zero-speed unarmed HP800, movement class0; it already uses the static path and is not a commander/combat substitute for type94.

Real generated [DOTT.json](../public/assets/generated/animations/DOTT.json) contains `DOTTSTAND0`, referencing sprite `dott`, frame0. The [sprite metadata](../public/assets/generated/sprites/SPRITES/DOTT.json) is a single 1x1 frame, not a missing visible unit illustration. SPR SHA256 `5782fe0197c7c957686c65e2121bc96ae5b96396fc2d782b2312edbdfdeed977`; FIN SHA256 `005e22d43a95de00ab4099b4a51949cae7296807449cb4c80b8f30448f04b277`.

## Focused Proof

[browser-artifacts.test.ts](../tools/qa/browser-artifacts.test.ts) and the updated [source-browser-commanders.test.ts](../tools/qa/source-browser-commanders.test.ts) passed 3/3 in `/tmp/dc-artifact-controls-1790143616528.log`:

1. Controlled A04 retains every original action in block10. New team0/type94 at6,6 has HP300, registered identity and air-plane host occupancy, no ground occupancy. Exact full session JSON restoration immediately before and after spawn. Malformed type94 metadata rejects; strict profile does not admit it.
2. Actual original AL03, public commander Move, checkpoint350 -> committed trip8 at351. Enabled WIN block3; artifact `transport:194:0`, simulation49, team0 at92,10, HP300. Static, unarmed, unselectable, no ground blockage. Exact complete MissionView JSON restoration at350 and351, identical continuation to355. Original DOTT FIN loaded and existing generated atlas rendered through QA NullCanvas without missing-state/timeline warnings. This is not browser pixel evidence.
3. Controlled A04 complete spawn/commander extraction/WIN-pending chain, no excluded type94 action. Commander slot260/generation0, team4/type69/TRSC; carrier5, extraction176, noncombat removal, unchanged loss accounting, exact extraction restore and continuation to360. This is not a natural A04 playthrough or ready-WIN claim.

AL03 boundary artifacts: `/tmp/dc-artifact-al03-boundary-84520-1790143629608/`. `checkpoint.json`, `after-spawn.json`, `artifact-proof.json`; before checkpoint SHA256 `78aa7944e9c5a210d5ae98aa289bbfc800e10bfa763903706dd5b7737e210c5e`, after `0d744e458ddffda2111c56a4054a6d9da454008a7137d4a1a317cd458010a5e0`. Original loader mission hash unchanged: `c7b092f45420bc1fb761ec1007d05e985cb3554296dc4b22956f5ce993ccd4a4`.

Scoped strict TypeScript passed `/tmp/dc-artifact-owned-types-1790144175355.log`. No agents, full suite, broad spy work, or HUMAN03 playthrough ran.

## Natural AL03 Run

First original-driver attempt `/tmp/dc-artifact-al03-win-1790143729589/` passed trip8/type94, then stopped at518 on separate runtime diagnostic `Occupied or ineligible ground cell 46,9`, during additional purchases. No source outcome. That occupancy runtime was not changed.

Follow-up 2026-09-23: [the production exit runtime fix](production-exit-collision-20260923.md) reproduces this original public-input failure, corrects browser-adapted reservation/vacancy scheduling, and replays through700 with seven completed purchases and exact save continuation. The earlier stop-purchasing workaround below is historical, not the runtime fix.

The [mission03-playthrough.ts](../tools/qa/mission03-playthrough.ts) AL03 strategy now stops purchases after discovery, filters targets with zero source damage coefficients, approaches valid firing positions, and chooses surviving City goals. HUMAN03 behavior remains unchanged. An intermediate run `/tmp/dc-artifact-al03-win-1790143777120/` stalled attacking source type84, target class8 with zero weapon coefficient, and was explicitly cancelled by verified worker PID; its cancellation and exit receipts remain. It is not a source loss.

## Verified AL03 WIN

Final run `/tmp/dc-artifact-al03-win-1790144281382/` resumed the legitimate original-driver tick400 checkpoint `/tmp/dc-m03-a03-regression-79364-1790143263905/checkpoint.json`. That opening had already reached trip8 with the actual commander and committed type94; no checkpoint values, original source files, combat stats, economy, enemies or fog were edited.

- Pending WIN **12432**, ready WIN **12633**, source result/reason **0/1**. Enemy City slots0..4 all zero; player City remains `[4800,2400,0,0,0]`.
- Full JSON pending restoration plus **201** normal updates produced exact whole ready-checkpoint equality. Expected/actual SHA256 **`b92a9ce36bbc1c1da36e9090407c1216f69d2a1884d5dc1d748becbc5ee44574`**.
- Source mission SHA256 remains `c7b092f45420bc1fb761ec1007d05e985cb3554296dc4b22956f5ce993ccd4a4`. Runtime hashes unchanged during the final run; integrity includes fetched asset hashes.
- Type94 remains simulation49, HP300, static and unarmed with identical saved metadata/target across pending and ready. No fabricated combat or commander role.
- Final run: 256 public commands, 4014 combat events, 18 deaths, no additional purchases. Opening: 25 commands and four purchases totaling1400. Economy: original3500 + earned13838 - spent1400 =15938. Commander was lost during the actual assault; surviving troops completed the source City condition.
- Worker exit0, total639424ms including initial restore, play and exact proof. No expiry. `/tmp/dc-artifact-final-a5-report.json` records proof, exit receipt and zero active mission03 workers.
- Final evidence-only acceptance test passed in `/tmp/dc-artifact-final-proof-1790144920821.log`; it checks exact hashes, original result, City, integrity, exit and type94 persistence. Six additional narrow checks passed in `/tmp/dc-artifact-compat-1790144235518.log`, including unchanged M01/M02 serialized options, commander guards and actual AL03 opening. No HUMAN03 playthrough rerun.

Artifacts include `source.json`, `initial.json`, `pending-win.json`, `checkpoint.json`, `proof.json`, `result.json`, `integrity.json`, `journal.jsonl` and `exit.json`. This is original-script browser-adapted MissionView under Node/QA NullCanvas, not browser pixel fidelity or native parity.

Reproduce the focused boundary checks with `DC_ARTIFACT_ACTUAL=1 node --import tsx --test tools/qa/browser-artifacts.test.ts`. Supply `DC_AL03_ARTIFACT_PROOF=/absolute/winning-directory` to include the saved ready-WIN acceptance check. The existing M03 runner accepts `--run --faction=alien`; do not run both factions merely to verify this slice.
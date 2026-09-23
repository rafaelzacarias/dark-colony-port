# Current Runtime Verification

Audit date: 2026-09-23. Workspace: `/Users/rafael/Downloads/darkcolony`.

## Subsequent Continuation

The audit below is retained as historical evidence, not a claim that its 279
checks were rerun after these changes.

- [HUMAN05 now has an independently verified original WIN](human05-ready-verification-20260923.md): pending26143 to ready26344, exact whole-checkpoint replay over201 normal updates. This adds an eighth mission to the historical completion ledger;22 remain unverified.
- [HUMAN06 was freshly reverified](current-human06-win-20260923.md) on the updated runtime: pending1546 to ready1747, exact replay. Actual isolated-browser Continue, WIN, Next Mission to HUMAN07, and HUMAN07 Save/reload/Continue also passed through [the main UI harness](../tools/qa/current-human06-main-ui.mjs). Evidence: `/tmp/dc-h06-main-ui-2mRuzy/`. Browser rendering bookkeeping differs from the Node checkpoint; no frame-pacing or physical-touch claim.
- [Explicit legacy import](campaign-session-legacy-import-20260923.md) authenticates the complete old replay, rejects non-population or behavioral divergence, and requires consent. H05 tick1000 migrated and passed outer-view restore plus100 updates; the old A05 tick2000 save remains rejected. Stored bytes remain unchanged until explicit Save. Ordinary restore never falls back to legacy rules.
- Verified unversioned current saves retain absent `replayPolicy` through restore, forks and continuation. New and explicitly migrated saves receive `current-population-v1`. Final checks passed five session/population controls and one outer-view control; typecheck/build passed, with only the existing Vite chunk-size advisory.
- [ALIEN05 remains incomplete](alien05-rescue-route-20260923.md). Latest continuation is `/tmp/dc-al05-detour-20260923-d03/checkpoint.json`, tick16629, commander257HP at23,36, with a public Stop queued. The final save has not been independently restored. Original rescue remains unreached; route tests are not mission acceptance.

Full-game acceptance still fails. ALIEN10's authentic opening remains unresolved;
legacy import does not make all historical saves compatible, and historical WINs
must not be promoted to fresh current-runtime proofs.

## Verdict

- **Scoped runtime checks PASS:** npm typecheck/build and **279 tests passed, 0 failed, 0 cancelled, 0 skipped**. Every feature PASS below is limited to the tests actually executed.
- **Runtime/assets freeze PASS; extended QA-tree freeze FAIL:** no source, asset, scenario or configuration drift; three unrelated tooling files changed during the audit. The original baseline was retained, not reset.
- **Historical evidence retained: 7/7 WIN hashes match.** These are not seven current-runtime mission replay passes. All 62 inventoried artifact files remained unchanged.
- **Full game FAIL / not accepted:** 23 missions remain completion-unverified under this audit's seven-proof ledger, and ALIEN10's authentic first-hive mechanism remains unresolved. Unverified does not mean impossible.
- **Historical-save compatibility NOT VERIFIED:** all five inspected adapted ready saves contain aggregate population values inconsistent with the corrected current census. Selective per-type counts agree. No old save was rewritten, migrated or silently accepted.

Only this new document was authored in the workspace. No runtime/QA edits, agents, full suite, package installation, native probe, browser launch or full-mission replay was performed. npm build generated its normal outputs/cache. Existing dedicated tests were selected by local filenames and positive name filters; excluded tests are not counted as passes or reported skips.

## Evidence And Commands

Audit directory, abbreviated **A** below: `/tmp/dc-runtime-verification-20260923-audit01`.
All logs have unique absolute paths. Shared-terminal output sometimes belonged to other work; results below come from persisted receipts and their matching logs, not terminal echoes.

| Command group | Result | Wall time | Hard cap | Log under A |
| --- | --- | --- | --- | --- |
| `npm --prefix /Users/rafael/Downloads/darkcolony run typecheck` | exit 0 | 5.824 s | 120 s | `typecheck-1790162567725.log` |
| `npm --prefix /Users/rafael/Downloads/darkcolony run build` | exit 0 | 10.884 s | 120 s | `build-1790162573550.log` |
| Scoped core | 242/242, exit 0 | 36.756 s | 180 s | `scoped-core-1790162608011.log` |
| Scoped guards | 12/12, exit 0 | 2.092 s | 90 s | `scoped-guards-1790162659167.log` |
| Scoped integration | 21/21, exit 0 | 133.176 s | 240 s | `scoped-integration-1790162685845.log` |
| Actual public AL03 artifact boundary | 1/1, exit 0 | 29.084 s | 120 s | `actual-artifact-1790162819025.log` |
| Selective type counts | 3/3, exit 0 | 3.851 s | 60 s | `selective-counts-1790162894300.log` |

All processes returned normally, without a signal or deadline expiry. Supervisors used `spawnSync` with `killSignal: "SIGKILL"` and the caps above. Test commands used the absolute Node executable, absolute `node_modules/tsx/dist/loader.mjs`, `--test --test-reporter=tap`, and absolute test paths. Core, guards and integration used `--test-concurrency=2`. Exact argument arrays, environments, child PIDs and elapsed times are preserved in A's corresponding `*-receipt.json`; core/guards totals are also in `*-summary.json`.

Available: Node **24.7.0**, npm **11.5.1**, local `tsc`, `tsx`, Vite, Python 3 and Git. `rg` is unavailable on PATH, so editor filename/text search was used. Git exits 128 because this folder is **not a Git repository**; no commit identity or Git cleanliness is claimed. Receipts: `availability-before.json`, `final-integrity-summary.json`.

Build output: Vite 7.3.6, 1,977 transformed modules, JavaScript 829.79 kB / gzip 257.61 kB. **The only build warning is the advisory about chunks larger than 500 kB after minification.** It is non-fatal and accepted for this audit; no compile error or test failure is hidden as a warning.

## Executed Feature Scope

| Feature | Tested scope and verdict | Explicit limit |
| --- | --- | --- |
| New production units / collectors | **PASS:** both-faction source costs, prerequisites, queues, cap/refund rules, source exits, ground/air ownership, blocked completion, destruction and JSON continuation; production-panel controls | Not every new unit's special ability or browser presentation |
| Unit weapon/armor upgrades | **PASS:** paid source levels, live equipment, unchanged wounded HP, upgraded subsequent spawn, damage calculation, exact view continuation and tamper rejection | Controlled funded fixtures, not campaign completion |
| Building upgrades / construction | **PASS:** source catalogs, upgrade lifecycle, paid laboratory session, damaged original actors, death before/during/after, fixed-slot view placement, completion/producer access, capability/legacy guards, AL10 unfunded rejection | Funded controls are not an authentic AL10 funding route; the long H07 building-to-research view test was not run |
| Messages | **PASS:** bounded-window rollover, receipt order, rollback, strict rejection, original H05 loader/message action and missing-source guards | Controlled H05 sequence, not a whole H05 win; native table probe excluded |
| Research | **PASS, module scope:** center versus laboratory dependency, both-race ownership/health/restore guards, public simulated idle collector at visit450, FIFO excavation and ordinary-visibility discovery | Research MissionView/pixels and long live discovery tests not rerun |
| Income theft | **PASS, policy/economy scope:** SARGE source scan order, allied different-team target, persistent link, odd-credit loss, death/movement unlink, deploy/undeploy movement/fire suppression and replay | Actual HUMAN10 public deployment test and browser controls not rerun |
| Targeting | **PASS:** automatic acquisition/retention uses effective damage, armor/matrix factors and air class; allied/hidden/dead guards; explicit zero-damage attack remains intentional | Not a campaign-wide autonomous strategy certification |
| Population / selective type counts | **PASS:** aggregate selector6 casualty registration, removal, rollback, alliances, strict startup and stale-save rejection; selective selector1 objective removal, reinforce2/newtype and same-block feedback | Old winning saves are not fresh restore passes; see below |
| Trips | **PASS, guard scope:** H06 generated unknown tags, enabled-trip eligibility and strict atomic unknown-trip rejection | H06 tick295 public path and complete H06 WIN were not rerun |
| Production exits / collision | **PASS:** both-faction infantry/collector/air occupancy, interpolated footprints, plane isolation, single debit/allocation, blocked session restoration and collision controls | Historical AL03 tick518-to700 purchase replay was not run |

### Dedicated Files

Core, all tests in these files:

- [campaign-production-adapted-units.test.ts](../tools/qa/campaign-production-adapted-units.test.ts), [campaign-production-collectors.test.ts](../tools/qa/campaign-production-collectors.test.ts), [campaign-production-adapted-upgrades.test.ts](../tools/qa/campaign-production-adapted-upgrades.test.ts).
- [browser-construction-upgrades.test.ts](../tools/qa/browser-construction-upgrades.test.ts), [construction-panel.test.ts](../tools/qa/construction-panel.test.ts), [production-panel.test.ts](../tools/qa/production-panel.test.ts).
- [campaign-session-messages.test.ts](../tools/qa/campaign-session-messages.test.ts), [campaign-world-messages.test.ts](../tools/qa/campaign-world-messages.test.ts), [browser-research.test.ts](../tools/qa/browser-research.test.ts).
- [browser-income-interception.test.ts](../tools/qa/browser-income-interception.test.ts), [sarge-native-policy.test.ts](../tools/qa/sarge-native-policy.test.ts), [sarge-economy.test.ts](../tools/qa/sarge-economy.test.ts). The source-policy tests do not execute the native binary.
- [simulation-auto-target.test.ts](../tools/qa/simulation-auto-target.test.ts), [production-exit-reservations.test.ts](../tools/qa/production-exit-reservations.test.ts), [collision.test.ts](../tools/qa/collision.test.ts).

Guards: [campaign-session-selector6.test.ts](../tools/qa/campaign-session-selector6.test.ts), [mission06-trips.test.ts](../tools/qa/mission06-trips.test.ts), [browser-campaign-ai.test.ts](../tools/qa/browser-campaign-ai.test.ts), [human05-messages.test.ts](../tools/qa/human05-messages.test.ts), using this exact positive filter:

```text
^selector6 feedback: (casualties|alliances)|^HUMAN06 generated MTG trip: (source|eligibility|strict)|^browser AI damage eligibility:|^HUMAN05 messages: (adapted|actual|missing)
```

Integration, all tests: [mission-view-adapted-upgrades.test.ts](../tools/qa/mission-view-adapted-upgrades.test.ts), [mission-view-legacy-roster-restore.test.ts](../tools/qa/mission-view-legacy-roster-restore.test.ts), [browser-building-upgrades-session.test.ts](../tools/qa/browser-building-upgrades-session.test.ts), [browser-construction-view.test.ts](../tools/qa/browser-construction-view.test.ts), [browser-construction-fixed-view.test.ts](../tools/qa/browser-construction-fixed-view.test.ts).

Selective counts: [campaign-session.test.ts](../tools/qa/campaign-session.test.ts), using only:

```text
^ALIEN01 eleven objective losses|^ordered resumption observes real reinforce2 census|^same-block source actions refresh census
```

These are controlled session checks, not an additional complete mission replay. The file's long idle/default tests were excluded.

### One Actual Public Boundary

[browser-artifacts.test.ts](../tools/qa/browser-artifacts.test.ts#L65) ran with `DC_ARTIFACT_ACTUAL=1` and `--test-name-pattern=^browser artifact: actual AL03`.

Fresh original AL03 loader, normal public commands and source script reached tick350; exact whole-view restore preceded the trip8/type94 spawn at351, followed by exact post-spawn restore and continuation to355. Actor `transport:194:0`, simulation49, team0, HP300 remained inert and unselectable. DOTT animation was fetched; NullCanvas draw/warning checks passed. This is not browser pixel evidence.

Output: `/tmp/dc-artifact-al03-boundary-38065-1790162819223`. Current loader hash: `8e60b35fb58aec1c5f344f61a4b70f46f1d13bb54514d924dacb4fb81061e77c`. Pre-spawn view hash: `49483f38c8594b1c74e1210419193e4170ff8ee87f3d94eb001ac673a677d700`; post-spawn: `8ee38c915a383be22851aa697dc6c7dd1dc442f7eb4aa066d9b9883f5b59129b`.

The driver's expected tick350 status is `HARNESS_LIMIT`, with no outcome, not WIN. The boundary test passed in 29.084 s. No completed-mission acceptance is inferred from this bounded stop.

## Freeze Fingerprints

SHA256 manifests: A's `fingerprint-before.json` and `fingerprint-after.json`. Files are sorted by relative path with `localeCompare`; each record contains path, byte length and file SHA256. Aggregate hashes are SHA256 of `JSON.stringify(records)`. The baseline includes 6,303 files: runtime source, generated/public assets, original scenarios, tools and seven root entry/configuration/manifest files. It excludes docs, dependencies, generated build output/cache, raw non-scenario disc files and the ISO.

| Group | Files | SHA256, identical before and after |
| --- | --- | --- |
| Runtime source | 127 | `3b3abd277e4512dd6100794f7eeccb56d42e274d1fd741bd14a2b5fefea2a69e` |
| Public assets | 4,692 | `05437a90d85eb50b79051ca27161c11d858a1082f8abb4270779590dd660bd2e` |
| Original scenario tree | 1,035 | `f6058b6ac90a2b38fc887501032e1c70fb0fa338b459009692e794f113d419fd` |

The seven root files also have zero differences. **The wider source/assets/QA manifest is NOT stable:** before `1ef15c11747a2c3fc5e43b027ef761b6575cc2da32db58294ba756db004e0726`, after `b2f7ae9971f7ee519108fe0c2daaf3cd2758f57d2560edb36ad37d1b31bea456`.

Its only changes are `tools/.DS_Store`, [mission05-playthrough.test.ts](../tools/qa/mission05-playthrough.test.ts), and [mission05-playthrough.ts](../tools/qa/mission05-playthrough.ts). These were not edited, selected or imported by this audit's tests. Nothing was reverted. Exact before/after file hashes appear in `final-integrity-summary.json`. That receipt's `runtimeStable:false` describes the **entire extended manifest**, including tools; the runtime-only groups above are unchanged. A whole-QA-revision freeze cannot be claimed.

## Seven Historical WINs

All seven expected hashes from the prior reports were independently recomputed after the runtime checks and matched. M01 hashes cover complete trace files; the other five cover `JSON.stringify(checkpoint.view)`, not the outer strategy wrapper. Each saved result is original ready WIN, result/reason0/1. No complete win was replayed during this audit.

| Mission | Ready tick | Retained artifact | Matching SHA256 |
| --- | --- | --- | --- |
| HUMAN01 | 5177 | `/tmp/dc-stationary-human-win-OewBBU/trace.jsonl` | `cebcc273f217a19ac5ad88ea3b21e40d825b3fc5eb96e04381e4504f52cc3212` |
| ALIEN01 | 6945 | `/tmp/dc-stationary-alien-win-5BdXa6/trace.jsonl` | `0104fd9e28e621f1eba0dd73831a286e66b8d1b32fb6fafff70b42f758c242ea` |
| HUMAN02 | 21265 | `/tmp/dc-human02-final-assault-xg3kSr/checkpoint.json` | `d11d9953ed5f00b7ea8ce1e8285389c8bda9446fadfdf17efe7fb0126f041c34` |
| ALIEN02 | 32689 | `/tmp/dc-al02-finish-20260922-r05/checkpoint.json` | `dd06165505d48ebabb8527b58bed88c4a7ff6ab794ee704bcb696d0e5b24a01d` |
| HUMAN03 | 6713 | `/tmp/dc-m03-human-b1/human/checkpoint.json` | `ca43a92265d677cfa0f98c5af27538ea5992e746fe3e6230953eb4dc98fd373e` |
| ALIEN03 | 12633 | `/tmp/dc-artifact-al03-win-1790144281382/checkpoint.json` | `b92a9ce36bbc1c1da36e9090407c1216f69d2a1884d5dc1d748becbc5ee44574` |
| HUMAN06 | 1747 | `/tmp/dc-h06-trip-acceptance-1790151891256/human/checkpoint.json` | `c88b95ad4b18545b3c199b875b2bc55f9885ec19293adee4505beb039e27d44a` |

M01's retained result/repeat-verified/suite-complete records agree. HUMAN02's separate `/tmp/dc-human02-pending-ready-verify-74yiQk/` receipt records exact pending21064 -> ready21265, 201 updates, exit0. The other retained proof records likewise describe historical pending-to-ready equality. Historical source/runtime identities are not today's loader identity: for example, old AL03 loader `c7b092f45420bc1fb761ec1007d05e985cb3554296dc4b22956f5ce993ccd4a4` differs from the current bounded-run hash above.

A's `historical-artifact-audit.json` records the inspections; `historical-artifacts-before.json` / `historical-artifacts-after.json` inventory 62 files with **zero changes**. Independently checked SCN/TRO/MAP/MTG/PTH receipts for both M03s and H06 also match current original files (15/15). This audit did not reconstruct M02's resumed ancestry or authenticate every historical loaded asset anew.

### Old Saves And Corrected Counts

[refreshFeedback](../src/engine/campaign-session.ts#L573) recomputes browser-adapted aggregate selector6 from registered slots152..799, team<8, without filtering health or status. Corpses remain counted until unregistered; fixed city slots and neutral teams do not count. Selective selector1 uses its separate registered-entity projection at [the per-type loop](../src/engine/campaign-session.ts#L604).

All five adapted ready snapshots store team0 aggregate0; recomputing the current rule on their retained registries gives:

| Save | Saved team0 selector6 | Current rule | Selective selector1 discrepancies, all eight teams / 110 types |
| --- | --- | --- | --- |
| HUMAN02 | 0 | 42 | 0 |
| ALIEN02 | 0 | 56 | 0 |
| HUMAN03 | 0 | 32 | 0 |
| ALIEN03 | 0 | 19 | 0 |
| HUMAN06 | 0 | 22 | 0 |

The full audit JSON lists other affected teams. These are **observed stored-state mismatches**, not a claimed fresh historical restore exception: expensive complete old-save restores were deliberately not attempted. Current guarded restore requires complete source-caller replay equality at [campaign-session.ts](../src/engine/campaign-session.ts#L1810), whose error is `ai: checkpoint differs from complete source caller replay`. Recomputed feedback can invalidate these snapshots; current regression coverage proves stale aggregate rejection, not old-WIN compatibility.

The passing legacy-roster view tests construct compatible old-option fixtures on today's runtime. They do not establish that the historical winning checkpoints load. Corrected aggregate population must not be reverted or injected into old expected files just to recover a PASS. Main repair/acceptance owner: explicit versioned compatibility in [CampaignSession.restore](../src/engine/campaign-session.ts#L1754) and [MissionView](../src/mission-view.ts), followed by separately budgeted exact historical replay. Preserve original artifacts and expected hashes. No repair was made in this audit.

## Remaining Acceptance Gates

No executed test failed, so there is no failing-test runtime patch to hand off. The failed extended-freeze gate is exactly the three-file tooling drift above; coordinate a broader freeze separately rather than reset this receipt.

ALIEN10 remains unresolved: original credits1500 versus DEPEND14 cost2000, empty player city, and no authenticated first-hive funding/free-base action. [The first-hive investigation](alien10-first-hive-economy-20260923.md) remains the relevant boundary. Successful funded construction and correct unfunded rejection do not resolve it.

The seven-proof ledger leaves **HUMAN04, HUMAN05, HUMAN07-15 and ALIEN04-15: 23 missions** without completion verification in this audit. Other concurrent mission work is neither adjudicated nor promoted here. Whole-campaign progression/save-load, browser input/pixels/audio, all mission wins and native gameplay parity remain unverified. **Full-game FAIL remains mandatory despite the green scoped tests and preserved historical hashes.**
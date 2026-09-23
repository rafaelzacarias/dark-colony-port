# Full Gate Harness Repair

## Original Gate

Source: `/tmp/dc-gameplay-missions-full-20260922.log`, 314,103 bytes,
last modified `2026-09-22T09:40:41.459Z`. This is the completed historical
run, not a snapshot of all concurrent edits made afterward.

- `npm run typecheck` passed.
- Test summary: **2,950 tests; 2,935 pass; 11 fail; 4 skipped**.
- Suites, cancelled, and todo: **0** each. Duration: **1,977,897.899958 ms**
  (32 minutes 57.898 seconds).
- `npm run build` was not reached because `check` uses `&&`.
- There are **10 underlying failures plus 1 failed parent**. The failure
  recap repeats the leaf failures; it must not be counted as a second run.

| Test / Failure | Count | Cause / Resolution |
| --- | ---: | --- |
| [campaign-progression.test.ts](../tools/qa/campaign-progression.test.ts): resource-only mission02, human and alien | 2 + 1 parent | Obsolete `/ai:.*not verified/`; current owner reports the exact missing native policy scheduling owner at TRO 17 / 0. Assert the complete diagnostic arrays. |
| [live-production.test.ts](../tools/qa/live-production.test.ts): unchanged HUMAN02 retains full TRO | 1 | Same obsolete diagnostic expectation; exact TRO 17 array now asserted. |
| [live-resource-integration.test.ts](../tools/qa/live-resource-integration.test.ts): human / alien unchanged mission02 AI preflight | 2 | Same obsolete diagnostic expectation; exact faction-specific arrays now asserted. |
| [mode2-scene.test.ts](../tools/qa/mode2-scene.test.ts): missing mask in a shadow-only stretched row | 1 | Expected a removed `strokeRect` overlay. Current fallback draws `save, translate, scale, drawImage, restore`. Exact call order, zero read/write counts, unchanged pixels, and failure diagnostics remain asserted. |
| [native-type2-original-idle.test.ts](../tools/qa/native-type2-original-idle.test.ts): module load | 1 | Mandatory `DC_NATIVE_TYPE2_ORIGINAL_TRACE` assertion. Now captures original owned actors with the existing probe when unset. |
| [native-type8-continuation.test.ts](../tools/qa/native-type8-continuation.test.ts): module load | 1 | Mandatory `DC_NATIVE_TYPE8_CONTINUATION_TRACE` assertion. Now captures both original missions through 400 when unset. |
| [source-native-combat-alien.test.ts](../tools/qa/source-native-combat-alien.test.ts): authenticated registered fire / projectile bytes | 1 | Mandatory original-policy provider trace. Now runs its existing provider probe when unset. |
| [source-native-combat-type8-continuation.test.ts](../tools/qa/source-native-combat-type8-continuation.test.ts): authenticated host replay through400 | 1 | Mandatory ALIEN02 continuation trace. Now uses the same auto-capture helper. |

The four pre-existing skips were:

- `source session retention at 1000 and 10000 frames`.
- `matches the executed native per-update countdown and handoff traces`.
- `optional Chromium: original HUD, source terrain, fog pixels, scaled input and disposal`.
- `optional Chromium: real HUD lifecycle against the promised MissionView boundary`.

## Changes And Proof

Only eight QA test files, the new
[native-proof-trace.ts](../tools/qa/fixtures/native-proof-trace.ts), and this
document changed in this repair. No runtime, simulation, balance, MissionView,
renderer, browser, package, or asset changes; no agents or Git commands.

The helper preserves explicit trace overrides, including failure on invalid
explicit files. Without an override it executes the existing original-native
probe, writes stdout to a unique OS temporary directory, caches that path within
the test process, and cleans generated files on normal process exit. It does
not substitute runtime-generated answers or skip native assertions. Probe
failure remains a test failure with stderr. Python/Unicorn/Capstone and original
source files are still required for regeneration, as in neighboring native tests.
The existing `PYTHONPATH` is retained and the repository's established local
dependency directories are appended.

Fresh source generation uses:

| Evidence | Existing Probe / Arguments |
| --- | --- |
| Type8 ALIEN02 / ALIEN01 | [native-type8-continuation-native.py](../tools/qa/native-type8-continuation-native.py) `--mission ALIEN02 --limit 400` and `--mission ALIEN01 --limit 400` |
| Type2 original actors | Same probe, `--owned-originals --limit 400` (default mission ALIEN02) |
| Original-policy provider | [source-native-combat-alien-native.py](../tools/qa/source-native-combat-alien-native.py), no extra arguments |

The diagnostic expectations follow current
[auditMissionTriggerSupport](../src/engine/mission-controller.ts#L120) and
[campaignPreflight](../src/game-data.ts#L150). The fallback expectation follows
[drawFinComposition](../src/render/fin-composition.ts#L68). No assertion was
replaced with an either-old-or-new allowance, and mission admission remains closed.

## Focused Results

| Verification | Pass / Fail / Skip | Authoritative Log |
| --- | --- | --- |
| Four native suites with documented cached env | 9 / 0 / 0 | `/tmp/dc-fullgate-repair-native-cached-1790094411234.log` |
| Type8 suite with trace env removed, fresh captures | 5 / 0 / 0 | `/tmp/dc-fullgate-repair-type8-autocapture-1790094343700.log` |
| Type2, provider, host replay with all three trace envs removed | 4 / 0 / 0 | `/tmp/dc-fullgate-repair-other-autocapture-20260922-r03.log` |
| Five failed preflight checks plus parent/nested tamper checks | 22 / 0 / 0 | `/tmp/dc-fullgate-repair-preflight-20260922-r02.log` |
| Entire small mode2 scene suite | 10 / 0 / 0 | `/tmp/dc-fullgate-repair-mode2-20260922-r04.log` |
| Strict touched-file TypeScript, ES2022 / ES2023,DOM | exit 0 | `/tmp/dc-fullgate-repair-types-20260922-r05.log` |

**41 distinct checks passed, 50 passing executions**, because the nine native
checks ran once with cached evidence and once with fresh no-env evidence.
The preflight repair also reached 16 nested SCN/FIN tamper tests that the early
failures had prevented from running. Editor diagnostics were clean.

No full-suite or build rerun was performed. These results fix the recorded
failures, but do not certify a current green full gate under concurrent edits.
All test processes were spawned with absolute paths and detached process groups;
unique log files, rather than interleaved terminal output, are the evidence.

## Canonical Cache Environment

All paths below were present and SHA256-checked. Complete sizes/hashes and the
original log inventory are retained in
`/tmp/dc-fullgate-repair-inventory-20260922-r06.json`.
The type8/type2/provider hashes agree with the source reports:
[type8 counter32](type8-counter32-integration-20260922.md),
[type2 original idle](type2-original-idle-20260922.md), and
[ALIEN provider](source-native-combat-alien.md).

```sh
export DC_NATIVE_TYPE8_CONTINUATION_TRACE=/tmp/dc-type8-al02-native-20260921-c30.jsonl:/tmp/dc-type8-al01-native-20260921-c24.jsonl
export DC_NATIVE_TYPE2_ORIGINAL_TRACE=/tmp/dc-type2-owned-native-20260922-t05.jsonl
export DC_SOURCE_NATIVE_ALIEN_COMBAT_TRACE=/tmp/dc-al-provider-original-policy-20260921-a16.jsonl
export DC_REGISTERED_HUMAN_TRACE=/tmp/dc-registered-HUMAN-32-20260922-p06.json
export DC_REGISTERED_ALIEN_TRACE=/tmp/dc-registered-ALIEN-32-20260922-p06.json
export DC_GROUND_HUMAN_TRACE=/tmp/dc-ground-HUMAN-40-p34.json
export DC_GROUND_ALIEN_TRACE=/tmp/dc-ground-ALIEN-40-p34.json
export DC_OCCUPIED_TRACE=/tmp/dc-occupied-human16-o01.json
export DC_ENDPOINT_TRACE=/tmp/dc-two-route-endpoint-human32-20260922-r06.json
```

Focused reproduction of the four native suites, without a full-suite run:

```sh
python3 -c 'import signal, subprocess
signal.signal(signal.SIGINT, signal.SIG_IGN)
root = "/Users/rafael/Downloads/darkcolony/"
names = ["native-type2-original-idle", "native-type8-continuation",
         "source-native-combat-alien", "source-native-combat-type8-continuation"]
raise SystemExit(subprocess.call(["node", "--import", root + "node_modules/tsx/dist/loader.mjs",
    "--test", "--test-reporter=tap", *[root + "tools/qa/" + name + ".test.ts" for name in names]],
    cwd=root, start_new_session=True))'
```

Unset the first three exports to exercise auto-capture. Explicit supplied
captures remain authoritative; a stale or wrong-format capture must fail.

## Route Harness Audit

No route harness change was necessary. These already regenerate when env is
absent; they do **not** require a default retained `/tmp` trace. Most keep
captured JSON in memory, rather than creating automatic trace files. Their
`/tmp` Python dependency search paths are separate from trace requirements.

| Consumer | Optional Env | Unset Behavior |
| --- | --- | --- |
| [native-registered-host.test.ts](../tools/qa/native-registered-host.test.ts) | `DC_REGISTERED_HUMAN_TRACE`, `DC_REGISTERED_ALIEN_TRACE` | Registered-host probe, mission HUMAN / ALIEN, `--updates 32`. |
| [legacy-native-ground-route.test.ts](../tools/qa/legacy-native-ground-route.test.ts), [legacy-native-task-nine.test.ts](../tools/qa/legacy-native-task-nine.test.ts) | `DC_GROUND_HUMAN_TRACE`, `DC_GROUND_ALIEN_TRACE` | Ground-route probe, mission HUMAN / ALIEN, `--updates 40`; per-mission in-process cache. |
| [legacy-native-pending-move.test.ts](../tools/qa/legacy-native-pending-move.test.ts) | `DC_GROUND_ALIEN_TRACE` | Ground-route probe, `--mission ALIEN --updates 40`. |
| [legacy-native-ground-route-occupied.test.ts](../tools/qa/legacy-native-ground-route-occupied.test.ts) | `DC_OCCUPIED_TRACE`; ground envs for host gates | Ground-route probe, `--mission HUMAN --updates 16 --occupied`; host gates use separate 40-update mission captures. |
| [legacy-native-ground-route-endpoint.test.ts](../tools/qa/legacy-native-ground-route-endpoint.test.ts) | `DC_ENDPOINT_TRACE` | Ground-route probe, `--mission HUMAN --updates 32 --endpoint`. A plain ground40 capture is not endpoint evidence. |

The route cache hashes match [native-route-gaps](native-route-gaps-20260922.md)
where recorded. Route tests were inspected, not rerun in this repair, since
they were not among the failures.

## Concurrent Checkpoint Handoff

The archived gate has no additional-ordinary-profile/checkpoint failure and
does not include the new additional-profile tests. Do not add a later owner's
failure to its eleven failures, or treat old passing results as validation of
that owner's subsequent changes.

The reported newer balance/checkpoint issue belongs to the separate owner:
[additional-ordinary-profiles.test.ts](../tools/qa/additional-ordinary-profiles.test.ts),
[simulation.ts](../src/engine/simulation.ts), and
[later-mission-checkpoint.test.ts](../tools/qa/later-mission-checkpoint.test.ts)
were not edited or rerun here. The current
[checkpoint handoff](later-mission-checkpoint-20260922.md) reports a corrected
profile schema and 21 distinct passing checks from that owner's work. It also
reports ALIEN14's missing CAM animation archive as a remaining visual blocker;
that is not a harness fix and requires the MissionView owner's handoff.
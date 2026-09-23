# Research Save Compatibility P1

## Review Follow-Up

Independent review found that the initial repair authenticated research only
on missions with active artifact markers. An unbranded configuration, including
forged table data, could therefore enter the private compatibility cache on
marker-free H01. The original test set did not cover that case.

The final implementation validates every supplied or privately retained research
configuration before construction and before compatibility caching, using the
source-owned configuration registry and exact scenario identity. Observation
uses the same validator. H01 regressions now reject both unbranded copies and
forged table data on constructor and restore paths, while valid legacy snapshots
retain their exact identities. The source-loader rejection test was updated to
expect immediate construction rejection rather than a later diagnostic.

Final combined gate: all 11 tests in `mission-view-legacy-research-restore.test.ts`
and `browser-research-source-loader.test.ts` passed, including all-30 research
initialization and original A10 200-tick restoration. Project build passed with
only the existing chunk-size advisory. This closes the reviewed configuration
bypass; it does not solve A10's funding deficit or establish a campaign WIN.

2026-09-23. The independent-review P1 is fixed in the MissionView restore
authentication path. Adding `browserResearch` to every adapted mission changed
the canonical source identity, rejecting legitimate pre-change saves with
`Invalid MissionView checkpoint: enum`, even when session options were unchanged.

## Compatibility Rule

[MissionView](../src/mission-view.ts) retains the existing optional production
profile/upgrade compatibility branches. After those branches, an adapted mission
with current research metadata may use a derived mission without that one field
**only when the entire saved source identity equals the canonical derived
mission**. The ordinary validator still requires exact canonical equality, and
the complete saved session options must match the independently constructed
session options. Unexpected fields, unrelated omissions, modified source hashes,
modified research dependencies, and present-but-invalid research metadata fail.

The pinned mission retains the legacy identity through checkpoint, restore,
continuation, and subsequent save. A private WeakMap associates that derived
mission with the current source-authenticated research configuration. Marker
missions use that configuration before the existing production-record fallback;
the configuration is never read from the saved identity or saved options. The
existing absent research-state policy remains unchanged.

The [source factory](../src/engine/source-browser-campaign-options.ts) is unchanged
by this fix. Fresh adapted missions still serialize their authenticated research
configuration. Research authentication remains independent of a production
catalog, including ALIEN10. Strict missions do not enter this compatibility path.
No generic canonical-field omission, saved-config trust, session schema change,
commander-role change, or replacement of optional-production handling was added.

## Verification

The new [regressions](../tools/qa/mission-view-legacy-research-restore.test.ts)
construct controlled pre-fix missions by removing only the newly added research
metadata from current authenticated loader results. They do not claim replay of
archived late-game saves or compatibility with unrelated historical role changes.

- Reviewer's adapted H01 missing-field reproduction: exact JSON restore.
- H02, A02, H05: exact JSON restore, 60 additional ticks, unchanged identity,
  complete options and commander mappings, and exact save/restore again.
- H05 additionally combines absent research metadata with both already-supported
  legacy production omissions, preserving the original options exactly.
- H07: pre-fix research state restored through the private authenticated fallback,
  exact 60-tick continuation, and restore using both current and pinned missions.
- Strict H01: unchanged mission object and exact 60-tick continuation.
- Source identity/configuration/options tampering and unbranded current research
  configuration rejected.
- Existing A10 test: original initialization, 200 updates, exact JSON restore,
  eight continuation ticks, 1500 credits, no production catalog, 300 fetched
  asset hashes unchanged. Whole-DEPEND price, unrelated-record and byte-only
  hash rejection controls pass.
- Existing H03/A03 legacy-production tests: exact 100-tick continuations pass.

12 focused tests passed; zero failures, cancellations, or skips in final runs.
Strict scoped TypeScript and editor diagnostics passed. The initial expanded
run was cancelled after four passing tests; it is not counted. Its isolated
rerun completed all eight tests successfully.

Evidence (each final log has an adjacent `.exit.json` with code 0):

| Check | Log |
| --- | --- |
| New regressions, 8 passed | `/tmp/dc-p1-research-compat-20260923-04.log` |
| A10 and DEPEND, 2 passed | `/tmp/dc-p1-research-a10-20260923-03.log` |
| Scoped TypeScript | `/tmp/dc-p1-research-types-20260923-05.log` |
| Legacy production, 2 passed | `/tmp/dc-p1-research-roster-20260923-06.log` |

Rerun from the workspace root:

```sh
node --import tsx --test tools/qa/mission-view-legacy-research-restore.test.ts
node --import tsx --test --test-name-pattern='^research source loader: (original ALIEN10|whole DEPEND)' tools/qa/browser-research-source-loader.test.ts
node --import tsx --test --test-name-pattern='^legacy roster restore (human|alien)03:' tools/qa/mission-view-legacy-roster-restore.test.ts
```

Only MissionView, the new regression file, and this note were edited. No agents,
full suite, browser, source assets, or unrelated runtime modules were used or
changed. This does not resolve ALIEN10's separate first-hive funding blocker or
claim compatibility for a previously non-initializing A10 view.
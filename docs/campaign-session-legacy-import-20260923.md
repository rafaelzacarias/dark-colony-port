# Explicit Legacy Session Import

## Policy And Scope

`CampaignSession.restore` still requires complete source caller replay equality.
It does not retry legacy semantics. Unversioned schema 2/3 browser checkpoints
are interpreted as current semantics by ordinary restore. New browser checkpoints
write top-level `replayPolicy: "current-population-v1"`; unknown policies reject.
The schema version alone does not identify the historical population semantics.
Strict-native checkpoints and their external provider checks are unchanged.

Explicit opt-in API in [campaign-session.ts](../src/engine/campaign-session.ts):

```ts
const imported = CampaignSession.importLegacy(oldSessionCheckpoint, {
  policy: "legacy-unmaintained-population-v0",
  acknowledgeAmbiguousUnversionedSave: true,
});
// imported.session, imported.checkpoint, imported.differences, imported.notice
```

The old policy is private to authentication replay: aggregate population feedback
is left unmaintained, as before the current registered-slot census. It is not a
selectable gameplay option or a legacy-runtime checkpoint format. The returned
session always uses current population feedback. Import admits only unversioned
browser-adapted full-history snapshots, retains JSON/schema/source/provider checks,
and refuses missing casualty ownership rather than normalizing it.

Legacy replay must equal the **entire** old state. A current replay runs alongside
it: at initialization and every input boundary, every non-population state field
must agree. Journal comparisons additionally cover fired blocks, action traces,
command identities, receipts, messages, requests and bail. Only `world.statistics`
and `controller.runtime.statistics` keys `[0-7],6`, plus those same aggregate keys
inside journal command statistics, may differ. This catches a transient predicate
branch even when its final state reconverges. A rejected candidate is never exposed.
No full-state normalization, hash replacement, diagnostic clearing, source changes
or save writes occur inside the API.

An unversioned, replay-consistent old state is inherently indistinguishable from
a current state deliberately edited into that exact historical state. Explicit
acknowledgement is mandatory for this reason. Marked current saves cannot enter
import, and ordinary restore continues rejecting stale zero population. Full replay
is consistency authentication, not a signature over source data or caller history:
a replay-equivalent history edit is not detectable without independent provenance.
As before, the outer loader must authenticate original source identity/options.

`LegacyCampaignImportError` includes a code, cycle counter, differing paths/values
and an actionable current-source restart message. The session API returns a
**CampaignSession checkpoint**, not a validated replacement for the outer
MissionView/strategy envelope. The explicit view/UI integration below provides
that additional validation; ordinary restore never retries legacy semantics.

## MissionView API And UI

[mission-view.ts](../src/mission-view.ts) now exposes:

```ts
const imported = MissionView.importLegacy(
  canvas, stage, callbacks, mission, checkpoint,
  {
   policy: "legacy-unmaintained-population-v0",
   acknowledgeAmbiguousUnversionedSave: true,
  },
  audio,
);
// imported.view, imported.checkpoint, imported.notice, imported.differences
```

Both restore and import share independent source identity and exact session-option
authentication against the loaded mission. Existing absent adapted-unit/upgrade
profile pins and the saved optional research policy are preserved. Main still
loads the existing checkpoint-pinned construction capability via
`campaignConstructionPolicy`; import does not rewrite these controls or identity.
Source/options rejection precedes `CampaignSession.importLegacy`.

Only the returned current session replaces the session field of a detached view
candidate. Ordinary `MissionView.restore` then runs its full current replay and
simulation, actor binding, economy, AI, source world and UI-state checks. The new
outer checkpoint is rebuilt using the validated view's `checkpoint()`, with the
migration notice returned separately. Diagnostics are not cleared. Failed temporary
views are disposed. The supplied checkpoint and original envelope are not modified.

The [main.ts](../src/main.ts) flow is:

1. Continue first attempts strict ordinary restore.
2. An unversioned browser-adapted failure exposes **Import legacy save** in the
  existing failure panel. Marked checkpoints do not receive this action.
3. Clicking opens a browser confirmation that explicitly acknowledges ambiguous
  historical population policy, full replay validation and current-rule migration.
  Cancel leaves the failure panel and stored save unchanged.
4. Confirm attempts import. Rejection shows the source error/path, preserves the
  original stored save, and does not automatically retry.
5. Success opens the mission with **IMPORTED / UNSAVED** and the migration notice
  in the status title. Existing control groups are restored without rewriting.
6. Only the existing **Save** action builds a new saved envelope from the live view
  and commits it through the existing atomic IndexedDB transaction. Import itself
  never writes, backs up, replaces or deletes the stored envelope. Leaving without
  Save leaves the original available for Continue.

No CampaignSession, storage, asset or other runtime module was edited for this
integration. The current unversioned marker-preservation/fork behavior remains
unchanged and is covered by the existing session control.

## Original Save Evidence

First, a current-only diagnostic isolated exact fields without changing acceptance:
`/tmp/dc-legacy-diagnostic-1790166229759.json` (both replays completed in about 66s).
The actual import and ordinary-current-restore check then completed in 157.3s:
`/tmp/dc-legacy-import-actual-1790166652522-report.json`.

### H05, Tick 1000

Original: `/tmp/dc-m05-opening-1790145350338/human/checkpoint.json`.
Input SHA-256, unchanged:
`476a6dfddce6c2c205752edc2f27ed00318b51457cbb732c30a516f4284e8fae`.

Full old-state authentication passed. Current state differs only at population keys
`0,6: 0 -> 27`, `1,6: 0 -> 4`, `2,6: 0 -> 5`, each in both world and controller
statistics (six fields total). Every non-derived state field and per-input source
journal behavior matched. No controller/outcome/world fields were normalized.

New current session checkpoint:
`/tmp/dc-legacy-import-actual-1790166652522-H05-current-session.json`.
JSON round-trip through ordinary `CampaignSession.restore` reproduced it exactly.
Import plus that independent current restore took 78.95s.

### A05, Tick 2000

Original: `/tmp/dc-m05-a05-route-1790145424299/alien/checkpoint.json`.
Input SHA-256, unchanged:
`59af05ac272dd25c76868aaa28c5812d7437c510caf9faaed77241d538b7dff0`.

Rejected with `legacy-authentication-failed`, after 78.32s. Old population semantics
remove the 14 aggregate-statistic differences, but **do not authenticate the save**:

| Field | Saved | Legacy Replay |
| --- | --- | --- |
| `controller.revision` | 277 | 254 |
| `world.transportState.receipts[3..5].id` | `184:3:2`, `184:3:1`, `184:3:0` | `182:3:2`, `182:3:1`, `182:3:0` |
| `world.transportState.receipts[6..7].id` | `213:8:1`, `213:8:0` | `210:8:1`, `210:8:0` |
| `world.transportState.receipts[8..11].id` | `268:9:3`, `268:9:2`, `268:9:1`, `268:9:0` | `250:9:3`, `250:9:2`, `250:9:1`, `250:9:0` |

These ten remaining fields are not permitted derived differences. Their historical
cause is not established here. No A05 current checkpoint was emitted; restart the
mission from current sources. Population policy alone must not be reported as the
cause or a fix for this rejection.

## Focused Verification

- Four fast import controls passed, zero skips/failures:
  `/tmp/dc-legacy-import-controls-1790166631746.log`.
- Existing population/casualty and stale-zero controls plus the diagnostic helper
  passed: `/tmp/dc-legacy-controls-1790166425882.log`.
- Actual H05/A05 test passed, one test, zero skips/failures:
  `/tmp/dc-legacy-import-actual-1790166652522.log`.
- Scoped strict TypeScript passed:
  `/tmp/dc-legacy-import-types-1790166811735.log`.
- Each completed command has a unique `.log.exit.json` receipt. Actual tests assert
  original file bytes unchanged. No gameplay beyond the saved 1000/2000 inputs,
  agents, full suite, UI/assets changes or historical WIN proof was attempted.

Tests: [campaign-session-legacy-import.test.ts](../tools/qa/campaign-session-legacy-import.test.ts).
`DC_LEGACY_DIAGNOSTIC_OUTPUT` enables the original current-only diff report;
`DC_LEGACY_IMPORT_OUTPUT` enables bounded original import artifacts. Both are opt-in
because their original input files live in `/tmp`. Normal fast controls use small
source-backed fixtures instead of depending on those temporary files.

## Outer View Verification

[mission-view-legacy-import.test.ts](../tools/qa/mission-view-legacy-import.test.ts)
adds fast controls for explicit consent, source/options rejection before calling
the session importer, absent optional production profiles, current markers,
source actor binding, schema-valid economy-rate mismatch, AI frame alignment,
selection and preserved diagnostics. The final focused gate also includes the
existing session import/marker/fork controls and atomic storage tests: **8 passed,
zero failed/cancelled/skipped**, `/tmp/dc-view-import-final-controls-r2.log`.

The opt-in `DC_LEGACY_VIEW_OUTPUT` actual outer test passed in 178.6 seconds:
`/tmp/dc-view-import-actual-r1.log`, report
`/tmp/dc-view-import-actual-r1-report.json`.

- Original H05 tick 1000 authenticated and imported with exactly the same six
  population differences listed above. Every other outer-view field, all session
  options, caller inputs, health, funds and non-population session state were
  unchanged. The new envelope preserves the original strategy metadata and adds
  the returned migration notice:
  `/tmp/dc-view-import-actual-r1-H05-current-outer.json`.
- Independent ordinary MissionView restore reproduced the imported checkpoint
  exactly. Both initialized views then advanced 100 ordinary updates to tick 1100
  with no diagnostic and identical full checkpoints:
  `/tmp/dc-view-import-actual-r1-H05-current-1100.json`.
- Original A05 tick 2000 still rejected with `legacy-authentication-failed`, the
  same controller revision and nine receipt-ID differences. No A05 replacement
  was emitted. Both original file byte arrays and SHA-256 values above were
  unchanged.

This is Node source-backed MissionView/NullCanvas continuation evidence, not a
historical gameplay win or native parity claim.

[mission-legacy-import-ui.mjs](../tools/qa/mission-legacy-import-ui.mjs) exercises
the actual main handlers in an isolated headless Chromium context, using a short
source-backed H05 tick-2 legacy fixture. It passed strict-failure, modal cancel,
modal consent, imported-unsaved, explicit Save and authenticated rejection checks.
Raw IndexedDB strings stayed identical through failure, cancellation, success
before Save and rejected import. Explicit Save emitted a current-policy checkpoint
with the original control groups. No browser page errors occurred.

UI log: `/tmp/dc-view-import-ui-r2.log`. Report and reviewed desktop/mobile
screenshots:
`/var/folders/ql/l6htjzt524z177vst3ntm98h0000gn/T/dc-legacy-import-ui-0SVjAi/`.
The 390px mobile failure action remained visible within viewport bounds; desktop
imported status fitted the existing save row. No user browser storage was used.
`LIVE_QA_URL`, `PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE` configure this harness.

Project typecheck passed: `/tmp/dc-view-import-ui-types-r2.log`. Each execution has
an adjacent `.exit.json` receipt. Initial shared-terminal cancellation and an
overbroad UI error locator were corrected and rerun; only completed passing runs
are counted above. Browser contexts were closed and bounded test children reaped.
No agents or full suite were run.
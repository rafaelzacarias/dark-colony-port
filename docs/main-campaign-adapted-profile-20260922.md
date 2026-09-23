# Main campaign profile routing

## Behavior

- Fresh mission 01 retains the strict loader default. Fresh mission numbers 02+
  request `loadCampaignMission(faction, number, "browser-adapted")`.
- The existing ready-success Next action starts mission 02 for either faction.
  Launcher entry points remain mission 01; no mission picker or admission list
  was added. Later loader failures still produce the existing actionable error.
- Continue selects metadata using `checkpoint.session.options.runtimeProfile`,
  not the mission number. An absent marker keeps older saves strict, including
  higher-numbered saves. Unknown markers fail without fallback or save writes.
- Main records the selected profile in `campaignRuntimeProfile`. Diagnostic and
  failed-outcome Retry preserve it; advancing to another mission uses fresh-start
  selection. Save retains the existing version-1 envelope and the view's original
  checkpoint, whose session options carry the profile.

## Visible status and controls

The running HUD displays `BROWSER ADAPTED` beside the bottom tick counter using
the existing mission-name span. It has a fixed 128px allocation outside the
72px tick strip. The faction tooltip and inspector encoding badge also identify
the adapted profile. Mission 01 keeps its original faction text and hides the
adapted badge, including after switching back from an adapted mission.

The profile means browser-adapted behavior, not exact native scheduler parity.
Main forwards loader metadata unchanged to the view. Existing production-panel
callbacks, earned-credit rendering, resource cursor handling, and the disabled
Inspire control are unchanged. No edits to MissionView, game-data, CSS, assets,
packages, or native API guards are included.

## Verification

[Main UI tests](../tools/qa/main-campaign-ui.test.ts) cover both factions' strict
01 start, actual Next handler to adapted 02, Save/Continue, visible badge state,
strict-label reset, unknown saved profiles, and strict/adapted higher-mission
Continue and Retry. Higher-mission routing uses mocks, not an admission claim.

The same test file loads real HUMAN02 and ALIEN02 data, checks adapted AI,
economy and source-production metadata, creates real view checkpoints, passes
them through JSON, reloads metadata independently and verifies exact restored
checkpoint equality. Calling the real loader without a profile still rejects
unsupported strict mission 02. Existing failure recovery, keyboard, resize,
stale initialization and save-completion controls remain covered.

Strict TypeScript validation includes main and its tests with no-unused checks.
Verification is Node-only: no browser, full suite, or later-mission playthrough
was run. Badge placement has not been visually verified in a browser.
# Native combat external updates

`CampaignSession.applyUnitBatch` rejects every nonempty caller `updates` batch when
`host.nativeCombat` exists, in both lethal and nonlethal configurations. The guard
is `requireSession(!host.nativeCombat, "Native combat owned updates require explicit phase ownership transfer")`.
It covers `combat-death`, `complete-removal`, and `position` for every actor,
including original colony slot 5 without `nativeAiTask`. No transfer API is added.

Absent or empty updates remain valid. Native-host requests are generated internally,
not routed through this caller batch. Sessions without native combat retain their
existing update rules. Restore replays caller history through the same guard.

The `native combat rejects external unit updates` tests in
`tools/qa/source-native-combat-host.test.ts` cover all original actors in both scopes,
unchanged raw bytes, counters, pending deaths, registries, losses, checkpoints and
journals, valid fresh-provider restore, and rejected tampered caller history.
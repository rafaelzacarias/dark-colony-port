# Native Combat VENT Presentation

The bounded native-combat view can present all four original HUMAN02 neutral
VENTs without installing resource lifecycle ownership. Only the VENT rendering
guard changes. Normal missions still require their resource FIN/task owner;
other native actors retain their existing presentation limitations.

## Source Proof

[The native probe](../tools/qa/source-native-combat-presentation-native.py) reuses
the existing source-resource scanner, executes original HUMAN02 SCN initialization
at `0x41b9ce..0x41c7ee`, and captures raw220 plus the actual type-table stand field.
It retains the scanner's documented external loading/CITY boundaries, and does
not execute resource visits. This is constructor evidence, not a natural mission
trajectory or full original startup admission.

- Executable SHA-256: `65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
- HUMAN02 SCN SHA-256: `bed27b613d20fb8b2533369d949adb4e90b96922372e7df3e7957140d44c90ab`.
- Slots 166..169, source rows 15..18, type 40, owner 8, direction 0.
- Original primary FIN: bank equals `type40+0x80`, frame 0, delay 0, mode 0.
- In this probe the bank address is `0x49d624`; this address is not a runtime constant.
- Original secondary/tertiary FIN: same bank, frame/delay 0, mode 2.
- Idle task 1, depth 0, pending/current order 0, payload `[65535, 0, 0]`.
- Native direction fallback resolves `VENTSTAND0`, source timeline 19.

The authenticated campaign projection currently has zero FIN pointers and omits
the original secondary/tertiary constructor modes. It is not a byte-identical
native FIN instance. Presentation therefore uses the proven **source field
identity**, not a fabricated pointer or an installed task. The existing
[resource options loader](../src/engine/source-resource-options.ts) authenticates
the SCN resource bindings, generated FIN bytes and VENT profiles. The new adapter
reconstructs the fresh source world and verifies its native-task attestation
before using those bindings. The source unit is immobile and unarmed.

## Runtime Boundary

[The presentation adapter](../src/engine/source-native-combat-presentation.ts)
returns a copied source composition sample, separate from `resourceTask`.
[MissionView](../src/mission-view.ts) prepares it during `initialize()`; the
explicit `initializeNativeCombatPresentation(loadBytes?)` entry also supports
Node-only getter checks without terrain or image setup.

Every getter validates the current committed world against the captured VENT
raw220, host record, registry/generation, entity, source and session identity.
Missing/additional VENTs, lifecycle installation, owner/task changes, raw FIN,
orders, position, HP or resource fields reject. A native combat candidate is
validated before commit when presentation is prepared. Restore reauthenticates
presentation during initialization; no presentation payload is trusted from a save.

The primary sample never reads wallclock, animation ticks or simulation activity.
No raw bytes, FIN pointers, resource counters, credits, tasks, RNG or fog are
written. VENTs are neither omitted nor force-revealed. Existing visibility and
depth sorting remain in effect, and Harvest remains disabled.

## Focused Verification

[The focused test](../tools/qa/source-native-combat-presentation.test.ts) uses the
existing Node combat fixture, checks all four native constructor captures,
unchanged preparation checkpoint, one committed native combat frame, frozen
samples after clock changes, and a composition draw stub with 16 atlas draw calls.
It rejects 20 raw-byte mutations, host/registry/resource changes, missing actors,
forged FIN/configuration and normal-mission presentation admission. Four tests
pass; scoped strict TypeScript validation passes. No browser or full suite runs.

```sh
node --import tsx --test tools/qa/source-native-combat-presentation.test.ts
```

The test regenerates the native constructor trace unless
`DC_NATIVE_COMBAT_PRESENTATION_TRACE` points to a saved trace. Local evidence:
`/tmp/dc-vent-original-constructor-r1.json` and
`/tmp/dc-vent-presentation-focused-r6.log`.

## Remaining Limits

There is no resource visit scheduler, natural VENT animation cadence, eruption,
claim/extraction/depletion or general resource simulation here. A changed VENT
requires an authenticated lifecycle owner, not continuation of this frozen pose.
The composition still reports existing `native-draw-mode:3` and
`native-draw-mode:5` diagnostics for source effect children and retains the
renderer diagnostic outlines; exact native blending is not proved. Other actors'
FIN/secondary animation, natural mission cadence and browser visuals remain
outside this change. No host, session, combat provider, shared renderer, fixture,
package or asset implementation was edited.
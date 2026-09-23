# Mission Save And Continue

The mission HUD save icon commits one latest save to IndexedDB. The launcher
offers Continue when a valid envelope exists. It does not overwrite original
game saves, change source assets, or store a native DC save format.

The saved envelope contains faction, mission number, timestamp, the validated
MissionView checkpoint and ten squad control groups. Storage commits atomically;
failure leaves the previous save intact and displays a failure state. Serialized
size is limited to 32 MiB. Storage denial and incompatible source/state report
errors instead of silently starting a new mission. No automatic save is made.

Continue reloads current mission assets, validates the complete source fingerprint
and nested simulation/session state, restores the view without replaying historical
audio, then loads renderer resources. Group restoration prunes dead/foreign IDs
after mission activation. New saves use direct session schema 2; schema-1 saves
remain readable but their initial replay can be slow. Ordinary restore preserves
tick, paths/orders/cooldowns, carrier state, selection, camera, exploration, route
drafts and committed outcomes. Wall-clock interpolation is reset, not resumed with
the time spent away. Music restarts through the ordinary mission lifecycle.

## Verification

- Atomic storage, detached data, malformed/oversized save rejection and denied
  storage are tested using fake IndexedDB.
- Engine, campaign session and MissionView continuation tests compare 100 future
  ticks, including combat, carriers, waypoints, deaths and delayed outcomes.
- Direct session saves grew three bytes between 1,000 and 20,000 idle ticks in
  bounded fixtures. Measured full-view restore was approximately 200 ms, versus
  replay's earlier multi-second growth. These are local measurements, not a
  device-wide latency promise.
- Embedded browser Save -> Exit -> Continue retained an actual HUMAN01 tick-220
  snapshot, selected units and plotted route. A second run saved group 1 and
  recalled all five troop IDs after Continue. Keyboard handlers were triggered
  through DOM events, not certified native pointer/keyboard automation.
- Desktop and 390-pixel-width screenshots/layout checks show the save strip
  inside the existing HUD without horizontal overflow or underlying text overlap.
  Source audio stopped on exit. The shared tab was returned to the launcher with
  the saved test mission available under Continue.

The final integration gate passed 782 tests, with four explicit skips, clean
typechecking and a successful Vite build. Save/resume closes this implemented
workflow, not full Phase 3-5 or native save-file compatibility.
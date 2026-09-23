# Mission Input and Combat Orders

## Source Evidence

`raw_cd/DC/INTRFACE/MAINE` selects `intrface/mainbut`:

| Widget | MAINBUT frame | Meaning |
| --- | ---: | --- |
| 150 | 62 | Stop |
| 33 | 63 | Move Only |
| 35 | 65 | Move & Attack |
| 36 | 66 | Set Waypoints |
| 141 | 121 | Inspire Troops |

The older BUTTON/BDF frame 65 Patrol label does not describe MAINBUT frame 65.
No separate Patrol button was found in this MAINE unit-command group. The
browser retains its two-endpoint Patrol command with a P-labelled control.
Inspire Troops is identified but disabled: eligibility, radius, effect and
cooldown are not yet verified. No speculative buff is applied.

CURS.FIN names resolve to SPRITES/CURS first frames: DEFAULT 0, UNITSELECT 3,
DRAWBOX 6, MOVE 9, ATTACK 15. Browser cursors use these original images with
centre hotspots; animation and native hotspot parity are not claimed. Blocked
ground uses the system not-allowed cursor. Hover and commands share one visible
entity hit test; body bounds are approximate, not sprite-pixel picking.

## Browser Behavior

- M: direct movement, without automatic en-route engagement.
- A: assault movement, acquiring enemies, pursuing to weapon range, then
  resuming the destination. This is the initial terrain-order stance.
- P: patrol between origin and destination, engaging and resuming after combat.
- W: plot ordered waypoints using the stance at route creation. Click the final
  point again to activate, matching HTRAIN4/ATRAIN4 training instructions.
  Numbered markers and dashed links preview the draft; its final point is
  highlighted. These preview graphics are browser-specific.
  Plotting does not replace existing orders until confirmed. Selection changes,
  another order mode, or Stop discard the draft. Confirmed assault routes resume
  after combat; completed routes do not restart.
- S: cancel movement, attack and saved route; subsequent idle guard acquisition
  is allowed. This is not a hold-fire command.
- Explicit hostile clicks pursue that target, including static targets on
  impassable cells; automatic acquisition does not replace the selected target.
- Armed idle/assault units retaliate against attackers outside acquisition
  sight. Move Only remains obedient even under fire until the movement ends.

Nearest-visible targeting with stable ID ties, retaliation priority and the
default assault stance are browser policies, not claims of native AI parity.
Cursor state resets on deselection, drag cancellation and mission exit.

## Stopped-Only Fire (2026-09-21)

The normal browser simulation in [simulation.ts](../src/engine/simulation.ts)
separates pursuit from weapon emission. Only a valid in-range Attack may fire,
and the tick requires unchanged X/Y subcell coordinates across that unit's
update, no remaining path segment, and no reserved leg destination. Activity
labels alone do not determine whether the unit is stationary.

- An out-of-range Attack advances its path and cannot fire that step, even if
  it arrives in range, exhausts the path, or is blocked without displacement.
  The next stationary update may shoot. A target leaving range resumes pursuit.
- An in-range Attack cancels the remaining path and leg reservation before
  firing, without snapping or otherwise moving the unit. An Attack command
  replacing Move may therefore fire immediately if that step has no movement.
  Physical occupancy of both cells under a partially advanced unit remains.
- Move replaces Attack and cannot shoot while walking, blocked on a pending
  path, or arriving. Move Only suppresses guard/retaliation until the order
  finishes. Idle guard acquisition may resume on the following update.
  Assault retains its destination and resumes it after combat.
- Cooldown still decrements once per eligible unit update, including movement.
  Only an emitted shot resets it; no deferred-shot queue or catch-up burst is
  added. Damage, source upgrades/ranges/cooldowns, RNG consumers, update order,
  and simultaneous end-of-step damage/death resolution are unchanged.

The focused reproduction found an uncleared `reservedDestination` when pursuit
stopped mid-leg. It did **not** reproduce physical displacement and a shot in
one step: pursuit already returned before shooting. The repair clears that
reservation and makes the stationary gate explicit at the tick's fire call.
It changes no presentation code or experimental native registered-task cadence.

Verification: 21 combat-event/movement tests, 51 neighboring guard, collision,
static-target and checkpoint tests, and three existing source upgrade/damage
tests passed; scoped strict TypeScript and editor diagnostics were clean.
The new regressions cover partial legs, actual shot-step coordinates, command
precedence, arrival deferral, resumed pursuit, cooldown, deterministic restore,
and Move Only under fire both walking and blocked. Existing mutual lethal-shot
tests retain simultaneous deaths. No focused failures remain. No browser,
full suite, native oracle, or fresh mission win/loss playthrough was run; no
playthrough expectation was changed, and full AL01/HUMAN01 outcomes are not
re-certified by these simulation checks.

## Verification

Focused tests cover immediate order precedence, direct movement, assault
combat/resumption, retaliation, explicit pursuit beyond sight, static targets,
patrol resumption after combat, ordered waypoints and live cursor hit tests.
Waypoint regressions also advance ticks before confirmation, cancel drafts via
each selection control, preserve pre-existing movement, and resume after combat.

The shared embedded tab loaded native cursor images and checked select, move,
attack, blocked and default states plus target retention using deterministic
simulation ticks. HUD artwork was screenshot-reviewed. Synthetic events checked
drag/cancel and M/A/P/W handlers. Embedded automation emitted mouse movement
but no mouse-down or shortcut events, so native pointer capture and real input
playthrough are not certified by this run. No external browser window was used.

The waypoint follow-up used the same embedded tab: deterministic ticks verified
no premature movement and completion at the final point; canvas-pixel checks and
screenshots verified the numbered preview. At a 390x844 viewport the HUD measured
390x292.5, with no horizontal overflow and the draft intact. The hidden tab needed
an explicit resize event to refresh its screenshot. This remains API-driven QA,
not a claim of native mouse/touch playthrough acceptance.
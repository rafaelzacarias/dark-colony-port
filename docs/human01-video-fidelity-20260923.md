# Human 01 Reference Fidelity

Reference: user-provided `/Users/rafael/Downloads/darkcolony.mp4`, duration
298.075 seconds, 640x360, 30 fps, stereo AAC at 44100 Hz. Original source
interface layouts are 640x480; the reference recording is not evidence that
the remake should stretch that layout to 16:9.

## Review Method

Inspected a chronological sample every ten seconds across the complete video,
the briefing at38 seconds, and denser combat/movement sequences around80,
120-136 and152-153 seconds. These are decoded frames, not a claim of continuous
playback or measured input latency. Camera scrolling prevents a reliable unit
speed estimate from these samples.

Audio was decoded and measured, and runtime sound wiring was inspected.
No direct listening or speech transcription was available. Track identity,
spoken lines, reference cue timing, stereo mix and perceived loudness therefore
remain unverified. See [the audio audit](reference-audio-intro-audit-20260923.md).
No reference file or original game asset was modified. Browser verification
used only the embedded browser.

## Reference Comparison

| Reference evidence | Difference in remake | Current disposition |
| --- | --- | --- |
| Opening, approximately0-35s: HUMAN OVERVIEW progressively appears in a source-art text screen | Fresh missions previously went straight to the map | Implemented source HSTORY text, typed reveal, reveal/advance and skip controls |
| 38s and55s: RED LANDING, CHRYSE BASIN, Rutkoni portrait, wireframe globe and full transmission/objectives | Briefing previously appeared only as an optional objectives panel | Implemented full predeployment briefing with original background/portrait/globe crops; globe and portrait are static, lower instruments remain incomplete |
| First minute into gameplay: landing sequence precedes player action | Source landing and reinforcement scripts already exist | Retained; no simulation starts before Deploy. Saved Continue/import/retry bypass the new introduction |
| Cursor through movement and combat, especially120-123s: changing green bracket/target shapes | Cursor loader retained only the first FIN frame | Implemented all source cursor timeline frames;100ms per entry under the existing20Hz presentation policy. Exact original cursor clock/hotspots are not certified |
| Combat120-125.5s: distinct flashes and orange effects, units form firing lines | Damage events and repeating FIREA animation do not share one presentation clock | Still open: synchronize fire animation, muzzle flash, audio and damage receipts without retuning damage based on appearance alone |
| Bodies126-136s remain on terrain | Corpse UI still drew black HP backplates | Fixed: dead actors retain original Die frames but no health/selection overlays |
| Marching152-153s: loose column and varied headings | Ground routes are four-connected; eight-direction artwork does not produce diagonal movement | High-priority follow-up: movement-specific diagonal routing with corner/occupancy checks, no blanket change to shared grid neighbors |
| Combat and movement samples | Facing changes restart FIN animation; group destinations are assigned without preserving formation orientation | Follow-up: preserve walk phase across turns and improve group path/arrival behavior; measure before/after with deterministic commands |
| Combat targets | Autonomous guard retention can chase a distant living target despite a nearer threat | Code-proven behavior, not proven incorrect by this video alone. Separate automatic pursuit limits from explicit player attack persistence |
| Throughout gameplay: effects, voices and messages reinforce actions | Selection/order variants were always the first clip; ordinary unit deaths lacked sound | Added bounded response variation and source-mapped trooper/gray death cues; muted startup remains intentional |
| Landing, messages and combat effects | Transport loops, message cue timing, general ambience and independent impact/explosion ownership are incomplete | Still open. Existing sound filenames do not establish the correct event or playback timing |
| Approximately280-290s: mission-complete/fade transition into a source-art Victory screen with portrait, medal and statistics | Current result UI is primarily a generic result/next-mission action | Still open: source-art debrief, original available statistics and medal presentation; retain functional progression |

## Implemented In This Iteration

- [campaign-intro.ts](../src/ui/campaign-intro.ts) and
  [campaign-intro.css](../src/ui/campaign-intro.css): source overview and complete
  styled briefing. Explicitly adapted35-character/second typing; no mandatory
  forty-second delay or invented narration. Escape/Missions cancels; Skip goes
  directly to deployment; first Advance reveals remaining text.
- [mission-cursor.ts](../src/ui/mission-cursor.ts): cached frame sequences and
  wall-clock animation, preserving the first-frame API. DEFAULT0/1/2,
  UNITSELECT3/4/5, MOVE9/10/11, ATTACK15/16/17 and DRAWBOX6/6/8. State changes
  restart phase; pointer motion within one state does not. No per-frame atlas
  cropping or additional hit testing.
- [mission-view.ts](../src/mission-view.ts) and audio helpers: source-mapped
  death voices, spatial placement and duplicate suppression; selection and
  acknowledgement variation with bounded response overlap. No invented impact
  selector or commander death fallback. Explicit native combat paths retain
  their own sound ownership. Corpse overlays are suppressed without removing
  the corpse animation.
- [main.ts](../src/main.ts): cancellable intro gate before constructing the
  mission, cursor presentation updates, saved-game/retry bypass and cleanup.
  Default sound/music mute remains enabled.

## Verification

27 focused tests passed across intro reducer/main/lifecycle, cursor animation,
audio feedback and corpse rendering. Log:
`/tmp/dc-reference-fidelity-final-20260923.log`. Project typecheck and production
build passed; Vite's existing chunk-size advisory remains. Separate worker
checks covered additional existing audio and rendering regressions; they are
not counted as part of this27-test combined gate.

Embedded browser at1280x900 and390x844:

- Fresh Human01 displays overview, then the full796-character source briefing;
  the mission stays hidden until deployment. All1016 overview characters can
  be revealed immediately by the user.
- Source globe/portrait/background crops render. Mobile text remains14px,
  scrollable and inside the viewport; controls remain reachable with no
  horizontal overflow.
- Escape cancels; fresh launch followed by Skip enters HUMAN01. Mute remains
  checked. Saved/retry bypass is covered by integration tests, not a new
  persistent-save browser run in this iteration.
- Loaded attack-cursor images at0/100/200ms are distinct and300ms loops to the
  first image. This checks the actual cached browser images, not OS cursor
  capture in screenshots or original30fps playback timing.

The embedded page can throttle animation callbacks. Consequently the screenshot
checks and deterministic sequence samples do not certify smooth real-time
playback. No audible comparison or full Human01 winning replay was performed
after these presentation edits.

## Next Priorities

1. Movement and turning: remove axis-only route artifacts, preserve animation
   phase, and test group crossing/arrival without overlap or corner cutting.
2. Combat presentation: one event-driven attack cycle and independently owned
   effects, with a shared test timeline for frames, sounds and damage events.
3. Automatic AI: bounded pursuit, nearer active-threat response and unreachable
   target recovery, while preserving explicit player orders.
4. Complete sound and debriefing: verify the recording's actual audible cues,
   then add grounded transport/message/impact events and the source Victory
   screen. Animate globe/instruments only after their frame ordering is known.

The remake is closer to the reference, but these changes do not establish
complete audiovisual or gameplay parity.
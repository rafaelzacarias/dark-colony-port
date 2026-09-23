# ALIEN02 Reservation Pickup

## Root Cause

The original `/tmp/dc-m02-alien-win-ATZfv7/early-checkpoint.json` at tick 200,
replayed with its unchanged `journal.jsonl`, reproduces the failure at the
frozen simulation tick 1222. The rejected session attempt is cycle 1223.

Exact offending reservation: slot **193**, generation **0**, destination
**(31, 58)**, key `transport:193:0`, simulation ID **45**. This is the live
team-1 type-69 commander, not carrier slot 22 or the player's collector.
Before the step: status 1, health 800, native position (8064,14919).
Carrier ID 2/slot 22 targets commander slot 193. After transport advancement:
status 10, health still 800, position (8064,14966), task `removal`, task words
`[1,0]`; the host emits `remove-noncombat` and `clear-collision` for 193:0.

MissionView correctly reports the live mobile's destination reservation.
CampaignSession previously validated that historical event only *after*
advancing transport, when the same actor had already been picked up.
The strict inactive-unit guard therefore rolled back a valid step.

## Fix

[campaign-session.ts](../src/engine/campaign-session.ts) validates reservation
identity, generation, active status, static exclusion and MTG destination after
input updates are applied, before transport advancement. It retains the
validated trip's team/type payload and dispatches it at the original trigger
scan point. No mobile reservations are filtered out. Same-input combat deaths,
missing/stale/static identities and already-retired actors still reject
atomically. Errors now include the offending slot, generation and status.

No MissionView or transport-owner change was necessary. Original assets,
mission scripts, settled playthrough strategy, funds and health are unchanged.
The tagged-trip control changes only an isolated test fixture, never the
original mission or public-input playthrough.

## Verification

[campaign-reservation-pickup.test.ts](../tools/qa/campaign-reservation-pickup.test.ts)
covers original ALIEN02 noncombat pickup, retained tagged team/type trip,
strict invalid-reference/dead/static rejection, rollback and exact session
checkpoint restore/continuation. Two default tests pass; the external-artifact
test is opt-in. Log: `/tmp/dc-reservation-tagged-1790132705293.log`.

Before the fix, diagnostic-only replay reproduced the exact rejection:
`/tmp/dc-m02-reservation-probe-20260922-01.log` and
`/tmp/dc-m02-alien-win-dNoZBX/journal.jsonl`.

After the fix, the artifact test independently restores the original failed
final checkpoint exactly, restores the original early checkpoint exactly,
then replays its public input journal. At tick 1222 it matches the original
68 shots, one death, 61 commands, zero purchases/spending, 1325 credits/income,
objective 0/6 and null source outcome. Cycle 1223 commits the exact 193:0
reservation and pickup. Continuation reaches tick 1500 with no diagnostic,
1675 earned/published credits, balanced currency and UNKNOWN bounded outcome.
Log: `/tmp/dc-reservation-artifact-1790132259254.log`.

Run the optional reproduction with `DC_RESERVATION_ARTIFACT` set to the
artifact directory and `node --import tsx --test` on the new test file.

Ten neighboring tests pass: existing HUMAN01 trip dispatch, failed-input
rollback, transport pickup/death/reuse and browser-profile contracts.
Log: `/tmp/dc-reservation-neighbors-1790132657358.log`.
Scoped strict TypeScript passed:
`/tmp/dc-reservation-types-1790132657358.log`.

## Long Run

Fresh unchanged ALIEN02 public strategy, maximum 36000 ticks, stepping budget
800000 ms, hard process cap 900000 ms, exact early restore at tick 200,
no redundant final non-winning restore. Final checkpoint remains enabled;
a real WIN still requires the harness's pending-to-ready replay proof.

Runner: `/tmp/dc-reservation-alien-long-1790132356513.log`.
Journal: `/tmp/dc-m02-alien-win-H63tB1/journal.jsonl`.
Run in progress when this section was first written; no WIN claimed.

All playthrough verification here uses the existing NullCanvas source-render
harness, not browser raster/audio or native timing parity.
# HUMAN02 Final Assault

## Scope

The dedicated [resume wrapper](../tools/qa/human02-final-assault.ts) resumes
`/tmp/dc-m02-human-win-jhb017/checkpoint.json` at tick 14316. It uses the existing
[public strategy](../tools/qa/fixtures/browser-campaign-playthrough.ts) without
editing that fixture or runtime. No cold 14000-tick simulation, browser session,
agents, health/fog/currency edits, enemy commands, or source-script changes are
part of this attempt. Rendering uses the existing Node canvas stub; browser
presentation and full-game acceptance remain separate.

## Admission

The saved and current actual-loader mission hashes both equal
`72fc56880bbeb11d9644ab7a986d35c8722a7eeb282ebd85b83274066c71fec1`.
The current browser-adapted collector configuration uses 120 completion visits.
The full checkpoint restored and initialized successfully at tick 14316 with
`s(2,3) = 10`, taking approximately 265 seconds on the shared machine.
No compatibility migration or relaxed save validation was needed.

Original HUMAN02 trigger 6 requires `(s(2,3)>26)`, meaning 27 team-2 victims.
Trigger 17 naturally activated at tick 14096 in the saved history; its original
`reinforce 2 47 6 8 10 10 7 ...` delivers ten type-8 and seven type-10 actors.
Once the ten initial victims are confirmed dead, the existing strategy scouts
toward the source-known `(47,6)` destination. Attacks and harvest commands still
obey normal visibility. Source knowledge is not a claim of human-only knowledge.

## Limits And Proof

The attempt permits at most 600 seconds of stepping. The actual stepping budget
is further shortened to reserve evidence/proof time within 900 seconds total.
The external launcher hard-kills its child after 895 seconds using `SIGKILL`.
Unique logs and a new continuation checkpoint are written without overwriting
the legitimate input checkpoint. A nonwinning outcome receives no redundant
final restore.

WIN requires the actual ready result `{resultCode:0,reasonCode:1,ready:true}`,
27 or more source casualties, a captured pending-win checkpoint, an exact
pending checkpoint round-trip, and continuation to the same complete ready
checkpoint. Failure to obtain this evidence is not a verified WIN.

## Evidence

- Compatibility preflight: `/tmp/dc-human02-compatibility-1790136435912.log`.
- Bounded run log: `/tmp/dc-human02-final-assault-run-1790136450062.log`.
- Run artifact directory: `/tmp/dc-human02-final-assault-xg3kSr/`.
- `compatibility.json` records raw SCN/TRO/TXT/MAP/MTG/PTH hashes, loader hash,
  input checkpoint hash, source production configuration, and runtime hashes.
- `journal.jsonl` records public commands, actual combat, source statistics,
  and outcomes. `restored-start.json` records initial diagnostic state.
- At tick 18000, the real objective had advanced to 21/27, with only the
  commander alive among player mobile units. The commander continued fighting
  the incoming original team-2 reinforcements without health or damage edits.

## Observed Winning Boundary

The objective reached **27/27**. Original trigger 6 emitted pending WIN at
**tick 21064**, followed by the actual ready outcome
`{resultCode:0,reasonCode:1,ready:true}` at **tick 21265**. The resumed run
advanced 6949 ticks; its ready result was recorded approximately 664 seconds
after process startup, including the 265-second initial restoration.

`pending-win.json` contains the actual pending checkpoint and `checkpoint.json`
contains the ready checkpoint plus strategy. `result.json` contains the real
objective, outcome, surviving actors, resource state, and command totals. The
commander survived with 236 HP. Published earnings were 12000, total spending
10500, and credits 1500; no purchases occurred during this continuation.

The starting main base had 36 simulation HP and died at observation tick 14381;
the collector died at 14869. No further purchases were made. The fixture
prioritizes collector replacement, but dependency 7 requires the now-destroyed
slot-0 producer. The remaining 1500 credits and 14000 reserve therefore did not
become reinforcements. This tactical weakness did not prevent the commander
from completing the original casualty objective in this attempt.

## Final Acceptance: Restore Proof Incomplete

**An actual original ready WIN was observed, but the requested verified WIN
acceptance was not completed.** The pending-to-ready restore attempt exceeded
the remaining total budget. The launcher killed child PID 50903 with `SIGKILL`
at 895104 ms, reporting `ETIMEDOUT`. It did not write
`winning-restore-proof.json`, and no exact pending round-trip or complete
201-tick continuation equivalence is claimed. No runtime diagnostic was
observed before the ready result; the blocking requirement is the expensive
full-history save replay within the total time cap, not remaining victims.

Exit evidence is
`/tmp/dc-human02-final-assault-run-1790136450062.log.exit.json`.
The stepping phase ended after approximately 399 seconds, below the 600-second
maximum. Restoration/proof/evidence remained inside the externally enforced
900-second total limit. No redundant nonwinning restore was run, and no
second mission attempt was started. The owned runner and parent were absent
from the final process inspection; no owned active process remains.

The pending and ready checkpoints are retained for a separately budgeted proof
attempt. Such a follow-up should compare exact pending round-trip and exact
ready checkpoint after 201 updates, without rerunning the cold opening or
altering the recorded goal, funds, health, source scripts, or fog.

## Validation

The actual-loader compatibility preflight passed. Strict TypeScript validation
and editor diagnostics for the new wrapper passed. Artifact checks confirmed
the 27/27 objective, pending/ready ticks, actual ready result, strategy tick,
and currency balance. Local documentation links passed. The attempted extra
strategy-control command produced no dedicated log amid shared-terminal
interference, so it is not counted as a test pass. Runtime and the shared
fixture remain unedited by this attempt.
# HUMAN05 Independent Ready Verification - 2026-09-23

**PASS: original-source WIN, exact entire MissionView checkpoint replay.**
The frozen C01 pending checkpoint at26143 was fully guard-restored and advanced
through201 normal updates to26344. The result equals the actual saved ready
checkpoint, without normalization or ignored fields.

## Method And Scope

- Input directory: `/tmp/dc-h05-continuation-20260923-c01/human/`.
- Proof directory: `/tmp/dc-h05-independent-proof-20260923-r01/human/`.
- Used the existing [Mission05 driver](../tools/qa/mission05-playthrough.ts)
  with `DC_M05_PROOF`, not another assault or gameplay strategy run.
- Both loaded mission identities authenticated against current original H05.
  Full `MissionView.restore` retained complete session replay guards, including
  the saved26143-tick history and `current-population-v1` marker.
- The driver's ordinary `resetClock(); update(0)` anchors the update timestamp;
  it does not skip simulation time. Exactly201 subsequent50ms updates produced
  tick26344. No phase, counter, HP, funds, source, or input checkpoint patches.
- The driver uses `assert.deepEqual(actual, ready.view)` on the complete view
  checkpoint. The outer QA strategy wrapper is not a runtime checkpoint.
- No runtime/helper edits, driver edits, agents, full suite, browser visuals,
  or native-parity claim. Only this report and a distinct read-only QA test
  were added to the workspace.

## Exact Result

| Measurement | Result |
| --- | --- |
| Pending | 26143, resultCode0, reasonCode1, ready=false |
| Ready | 26344, resultCode0, reasonCode1, ready=true |
| Ordinary updates | 201 |
| Proof elapsed | 678644ms, below independent900000ms limit |
| Worker total | 679440ms |
| Supervisor total | 679680ms |
| Launcher total | 679850ms |
| Exit | 0, no signal, expired=false, reaped=true |

Expected and actual entire ready-view SHA-256:
`a2a23d3f7a4a4548de9670e23f179c439f16dc5d0f8fdfb3fd624d10e6e5446b`.
Pending-view SHA-256:
`e2b071689f5747c624c0699140bc26200537a6914b55eae5f5cfec4997eda330`.
Loaded original mission SHA-256:
`e977334d8ff8452562c2a1ad4a71c0faed75348d87cd7d9471e520d3386754fe`.

H05's source objective is all enemy City slots zero followed by the actual
rescue/extraction chain, not H02's27-target objective. Both pending and ready
have team1/team2 slots0..4 zero. Original journal confirms18 at25235,17 at25835,
and15 at26143. The original commander-replacement chain remains unchanged.

## Integrity

All127 runtime/helper fingerprints equal C01's final map before and after
proof. All283 fetched assets and original SCN/TRO/MAP/MTG/PTH hashes are
unchanged. Serialized runtime fingerprint-map SHA-256:
`9bbebb2a4094970f37fea6860912be7eff1774956db0416950d69f4e30d59271`.

Unchanged file-byte SHA-256 values:

- C01 pending: `7672a57db40f7242f2a70c979b81e2ba377fb044c2279ef665f3ddcf24b4cf29`.
- C01 actual ready: `07e7a1c2bfee7310903df493835071b549dc58aa8eb676eb655769b564db2716`.
- Original C01 input, r05 tick21385:
  `5de185a1cc67c5a1aa087e00be3c476f14c9a8fc720ab0901a394bd569184a51`.

The original C01 result still says `SOURCE_WIN_PROOF_PENDING`; it was preserved
as historical evidence. The separate proof result now establishes exact WIN.
There was no replay difference and no presentation-bookkeeping fix was needed.

## Acceptance

Four tests passed, zero failures/skips: two existing C01 saved-input/artifact
checks and two new [independent verification checks](../tools/qa/human05-ready-verification.test.ts).
Final log: `/tmp/dc-h05-ready-final-acceptance-1790175729360.log` and its exit
receipt. Scoped strict TypeScript passed for the new test.

An earlier acceptance observer raced the launcher's exit: it saw the completed
receipt while the launcher PID still existed. Exact proof had already passed.
Verification now runs after exit, retaining the strict ESRCH assertions. No
proof rerun, artifact edits, or weakened checkpoint comparison were involved.

Final audit: `/tmp/dc-h05-independent-proof-20260923-r01-final-audit.json`.
Worker27584, supervisor27583, launcher27582 and acceptance processes31090/32353
are absent; active H05 driver/artifact-test process list is empty.
Preflight input/source hashes are in the sibling `-preflight.json`; proof,
integrity, source, result, and exit receipts are in the proof directory.

To rerun only the read-only acceptance checks:

```sh
DC_H05_READY_PROOF=/tmp/dc-h05-independent-proof-20260923-r01 \
DC_H05_CURRENT_ARTIFACTS=/tmp/dc-h05-continuation-20260923-c01/human \
DC_H05_CURRENT_RESUME=/tmp/dc-h05-final-partition-20260923-r05/human/checkpoint.json \
node --import /Users/rafael/Downloads/darkcolony/node_modules/tsx/dist/loader.mjs \
  --test tools/qa/human05-ready-verification.test.ts tools/qa/mission05-current-human.test.ts
```
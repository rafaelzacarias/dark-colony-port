# HUMAN05 Original Message 5

## Result

Fixed an extractor bug, not a missing original message. The unchanged original
[HUMAN05.MSG](../raw_cd/DC/SCENARIO/HUMAN/HUMAN05.MSG) contains `text 5.` followed by
`WARNING...WARNING...WARNING...`. The old anchored numeric-header regex treated
both lines as part of message 4. The corrected
[parser](../tools/extractors/data/messages.ts) accepts this terminal period.
It does not introduce a general malformed-header fallback.

The adapted HUMAN05 loader now succeeds with all original messages, SCN bytes
and TRO actions preserved. No changes to game-data, runtime profiles, session,
view, main, production, source assets, packages or missing-message guards.
No empty string, invented dialogue, skipped command or missing-entry no-op.

## Original Executable Evidence

[Native probe](../tools/qa/human05-messages-native.py) executes the original x86
loader and handler with the complete original MSG bytes, without a GUI.

- EXE SHA-256: `65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
- MSG SHA-256: `882d5020a7bdf427c8637c0724655dbb7ea0befbd13088a0df895571827f84f0`.
- SCN begins `jungle.bts`, `human05`, `Human`. Disassembly of `0x41bb99`
  through `0x41bc10` shows the second-line filename construction and call to
  `0x44d6f0`, with message state at `game + 0x46f9c`.
- The bounded probe supplies that SCN-derived filename, not a full SCN boot.
  The loader requests `SCENARIO/HUMAN/human05`, extension `msg`, mode `r`.
  It does not select a language alternative or numeric outcome extension.
- Loader `0x44d6f0` clears 30 pointers. Header token reader `0x40670c` and
  integer parser `0x406780` call the original base-10 conversion `0x46d6b0`.
  It accepts the numeric prefix of `5.`. The observed identifiers are exactly
  1 through 16. Store `0x44d873` uses `table + id * 4`, not sequential position.
- All 16 native strings equal both the corrected parser and published JSON,
  after stripping only the file-reader CR/LF from native strings.
- The actual original TRO action is **`msg 0 0 5 3 3`**, not `msg 2 0 5 3 8`.
  Original parser `0x43fa3c` and handler `0x43d877` reach queue insertion
  `0x44d918`: id-5 text, presentation 0, parameters 3/3, initial value 31,
  one queued entry, with the supplied platform clock 123456.
- Negative control removes only table pointer 5 after that successful call.
  Lookup reaches diagnostic branch `0x44d93d`, whose disassembly calls
  `0x46c996` and assertion `0x46cb3e`. Missing text is **not a verified no-op**.

Only file open/read/close, allocator and millisecond clock are intercepted.
Numeric conversion, header recognition, pointer indexing, action parsing and
queue insertion execute original instructions. This does not certify native
window drawing, message rollover, arbitrary malformed headers or full playthrough.

HUMAN05 has only [HUMAN05.001](../raw_cd/DC/SCENARIO/HUMAN/HUMAN05.001) and
[HUMAN05.002](../raw_cd/DC/SCENARIO/HUMAN/HUMAN05.002) outcome files, matching
TRO bail reason codes 1/2. There is no HUMAN05.005. Outcome files neither supply
nor replace MSG id 5.

## Reproduction

[Guarded refresh](../tools/qa/human05-messages-refresh.ts) runs the unchanged
normal DATA exporter into a new temporary directory, compares every output,
and publishes only [HUMAN05.json](../public/assets/generated/data/messages/HUMAN/HUMAN05.json).
All 303 DATA files now equal that isolated extraction; 302 stayed byte-identical.
The sole change separates id 5 from id 4, preserving the other 14 messages.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Previous HUMAN05 message JSON | 1558 | `914f26efde62e10130a58763c04c40597ecb5f73a8f2fb8599b6e33a9d42051b` |
| Corrected HUMAN05 message JSON | 1590 | `3b54cec2b683d1a4fd3732a2cad5aa6896cbed7f9b42c16d607010218d2d0fcb` |

Source inventory remains `c30023c0066ea3ad15ba7c8197ff2c828d5d380c4aee5b4a542d7c91ccb49cd7`;
DATA index remains `281fbd721919f6e12cff74a63d2b45b43f4b56b219b127866ba1ea5316f2c351`.
Original HUMAN05 SCN/TRO/MSG/001/002 hashes match the source inventory.
The existing asset verifier reports **2737 checks, 0 failures**. No index or
manifest update is necessary: DATA indexes name this file, not its output hash.
No other generated family or dist copy was regenerated.

## Verification

[Focused tests](../tools/qa/human05-messages.test.ts), parser tests and exporter
tests: **10 passed, 0 failed, 0 skipped**. Coverage includes native full-table
equality, adapted loading, outcome identities, actual-source action with an
applied receipt, and missing-message rejection in strict-default and adapted
profiles. The action test isolates that original action in an explicit always-true
fixture controller on the fully initialized source world; it is not a natural
execution of the full original trigger.

Reproduce from the workspace root:

```sh
PYTHONPATH=/tmp/dc-re-capstone-20260918:/tmp/dc-trigger-unicorn-20260918 python3 -B tools/qa/human05-messages-native.py
node --import tsx tools/qa/human05-messages-refresh.ts
node --import tsx --test tools/qa/human05-messages.test.ts tools/extractors/data/messages.test.ts tools/extractors/data/extract.test.ts
```

The native probe uses the existing local Capstone/Unicorn dependencies; no
packages were installed. Focused strict TypeScript and editor checks pass.
No agents, browser, full suite or new all-30 live census was run. The old
HUMAN05 missing-message loader blocker is resolved with no remaining message
ownership decision. Natural mission progression and other census blockers are
outside this fix.
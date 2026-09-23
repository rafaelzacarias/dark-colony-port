# SCN Team Field Order

The native loader reads nonempty, non-comment rows. `%Race`, `%Money`, `%AI`,
`%TeamColour`, `%Depend`, `%TeamAllies`, and `%AISlots` are trailing comments
in the shipped files, not field headers. The former parser incorrectly assigned
each comment the following row and shifted all fields.

Evidence is from DC.EXE SHA-256
`65028ee7dca7db0fffd32160e282a5b360d8cf505fd55b53d1002063357a582b`.
Code file offset equals VA minus `0x400c00`.

At `0x41b89d`, the line reader compares the first byte to `%` and loops to
read another line. Empty lines are skipped immediately before that check.
The required-line wrapper is `0x41b8ac`.

The team scan sets EDI to `game + 0xb98 + team*0xe30`. Its four sequential
scalar destinations are:

| Field | Store VA | EDI Offset | Game/Side Offset |
| --- | --- | --- | --- |
| Race | `0x41bdc0` | `0x20` | `0xbb8` |
| Funds | `0x41bdeb` | `0x14` | `0xbac` |
| AI | `0x41be32` | `0x24` | `0xbbc` |
| Color selector | `0x41be65` | `0x100` | `0xc98` |

Color outside 0..7 falls back to the team number (`0x41be6b..0x41be77`).
The next terminated list sets per-dependency bytes at EDI+0xda4
(`0x41bf38`), followed by eight ally values (`0x41bf66..0x41bff7`).
The following AI-slot row is read, then two coordinate rows are parsed.
Their native destinations are EDI+0x34/+0x38 and EDI+0x2c/+0x30. The corrected
export keeps these as `coordinateRows`; it does not guess extra semantics.
City data remains the existing raw nine-row section.

ALIEN01 team 0 is `(race=1, funds=0, AI=0, color=2)`; team 1 is
`(race=0, funds=0, AI=4, color=7)`. The former `teamColors` list actually held
dependency IDs, while the former `dependencies` list held alliances.

Regression tests pin the executable hash and five instruction anchors, parse
the actual ALIEN01 source, and verify typed values and list widths. All 108
scenario JSON files have been regenerated. The browser uses declared team race
for combat ownership rather than a generic object's sprite faction.

This correction does not implement native colony allocation, building slot
updates, scenario restrictions, or complete production behavior.
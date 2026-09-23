import assert from "node:assert/strict";
import test from "node:test";

import { MessageFormatError, parseMissionMessages } from "./messages";

test("parses numbered mission messages and preserves internal lines", () => {
  assert.deepEqual(parseMissionMessages("text 1\nREADY FOR LANDING\n\ntext 2\nLINE ONE\nLINE TWO\n"), [
    { id: 1, text: "READY FOR LANDING" },
    { id: 2, text: "LINE ONE\nLINE TWO" },
  ]);
});

test("rejects malformed and duplicate mission messages", () => {
  assert.throws(() => parseMissionMessages("orphan\n"), MessageFormatError);
  assert.throws(() => parseMissionMessages("text 1\na\ntext 1\nb\n"), MessageFormatError);
});

test("parses the original HUMAN05 punctuated text 5 header without merging dialogue", () => {
  assert.deepEqual(parseMissionMessages("text 4\nRETURNING\n\ntext 5.\nWARNING\n\ntext 6\nATTACKING\n"), [
    { id: 4, text: "RETURNING" },
    { id: 5, text: "WARNING" },
    { id: 6, text: "ATTACKING" },
  ]);
});

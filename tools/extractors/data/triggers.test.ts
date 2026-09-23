import assert from "node:assert/strict";
import test from "node:test";

import { parseTriggerScript, TriggerFormatError } from "./triggers";

test("parses TRO blocks while preserving conditions and action arguments", () => {
  assert.deepEqual(
    parseTriggerScript(`1 norm 1 (c>0)
reinforce 0 22 2 0 4 69 1 0 0
msg 2 0 1 3 8
end

2 trip 1 (S==0)
newtype 54 17 84
end
`),
    [
      {
        id: 1,
        mode: "norm",
        flag: 1,
        condition: "(c>0)",
        actions: [
          {
            name: "reinforce",
            arguments: [0, 22, 2, 0, 4, 69, 1, 0, 0],
            raw: "reinforce 0 22 2 0 4 69 1 0 0",
          },
          { name: "msg", arguments: [2, 0, 1, 3, 8], raw: "msg 2 0 1 3 8" },
        ],
      },
      {
        id: 2,
        mode: "trip",
        flag: 1,
        condition: "(S==0)",
        actions: [
          { name: "newtype", arguments: [54, 17, 84], raw: "newtype 54 17 84" },
        ],
      },
    ],
  );
});

test("accepts an empty TRO and rejects unterminated blocks", () => {
  assert.deepEqual(parseTriggerScript("\r\n"), []);
  assert.throws(() => parseTriggerScript("1 norm 1 (c>0)\nmsg 1 2 3\n"), TriggerFormatError);
});

test("preserves the shipped alternate header with no flag", () => {
  assert.deepEqual(parseTriggerScript("8 norm (s(1,0,86)>2)\nbail 0 1\nend\n"), [
    {
      id: 8,
      mode: "norm",
      flag: null,
      condition: "(s(1,0,86)>2)",
      actions: [{ name: "bail", arguments: [0, 1], raw: "bail 0 1" }],
    },
  ]);
});
